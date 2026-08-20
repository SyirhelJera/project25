#!/usr/bin/env node
// scripts/valorant-live.mjs
//
// Live match tracker: who's in the lobby you're in *right now*, what rank they are, who queued
// together, and — in competitive — whether each player is on an agent they actually play.
//
// Like every other Valorant script here this runs LOCALLY, on the machine that owns the Riot
// session (see README.md — Riot's fraud detection rejects this reauth flow from cloud IPs). It is
// driven by scripts/valorant-local-server.mjs's POST /live route, which the Valorant tab's
// "Live Match" panel polls; it can also be run straight from a terminal:
//
//   node scripts/valorant-live.mjs [label]
//
// Nothing here is ever written to Supabase. A live lobby is wrong within minutes and is full of
// other people's puuids — it lives in this process's memory and is thrown away. The only thing
// that touches disk is a cache of reduced match summaries (see MATCH_CACHE_FILE below).
//
// No npm dependencies — nothing in scripts/ needs `npm install`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSessions, saveSessions, silentReauth, RIOT_USER_AGENT, VALORANT_API_BASE } from './valorant-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCH_CACHE_FILE = path.join(__dirname, '.valorant-match-cache.json');

/* ------------------------------------------------------------------ tunables */

const AUTH_TTL_MS = 45 * 60 * 1000;   // Riot access tokens last ~1h; refresh a little early
const REF_TTL_MS = 6 * 60 * 60 * 1000; // client version + act list only change on patch day
const SNAPSHOT_KEEP = 4;               // recent lobbies kept memoized — a match occupies two
                                       // slots, pregame and coregame (see the snapshot store)

const TIMEOUT = {
  auth: 8000, probe: 5000, presence: 6000, match: 8000,
  names: 8000, mmr: 8000, party: 6000, history: 8000, details: 15000,
};
const LIMIT = { mmr: 4, party: 4, history: 3, details: 2 };

const DEFAULT_DEPTH = 10;        // comp matches per player for the comfort/win-rate window
const MAX_NEW_DETAILS = 40;      // uncached match-details fetches per lobby; cache hits are free
const ENOUGH_RESOLVED = 8;       // stop early once everyone has at least this many matches
const SHARED_FOR_STACK = 3;      // shared recent matches that imply a premade (inferred fallback)
const SAME_TEAM_FOR_STACK = 2;   // ...and the sharper version: shared AND on the same side

// An MMR lookup that failed for a reason that could go away — a 429 while the previous lobby's
// stats sweep was still running, a timeout, a blip — is retried on later polls instead of leaving
// that player showing a dash for the whole match. 'forbidden' is not in here: Riot refusing to
// share a rank is an answer, and asking again every few seconds wouldn't change it.
const RANK_RETRYABLE = new Set(['timeout', 'ratelimited', 'unavailable']);
const RANK_RETRY_MAX = 5;
const RANK_RETRY_WAIT_MS = 7000;

/* ------------------------------------------------------------------ errors */

// Carries a machine-readable code so the browser can tell "keep polling" (riot_unreachable) from
// "stop and tell the user" (session_expired).
export class LiveError extends Error {
  constructor(code, message, extra){
    super(message);
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

/* ------------------------------------------------------------------ plumbing */

// Every Riot call in this file goes through here. Never throws and never rejects: a timeout, a
// DNS failure and a 403 all come back as an inspectable object, because at poll rate the
// difference between "not in a game" and "the network blipped" has to be decided by the caller,
// not by an exception unwinding the whole request.
async function fetchJson(url, opts = {}, timeoutMs = 8000){
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { /* Riot occasionally returns HTML */ } }
    return { ok: res.ok, status: res.status, json, text, headers: res.headers, failed: false };
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, status: 0, json: null, text: '', failed: true, timedOut, error: err && err.message };
  }
}

// Bounded-concurrency map. Riot rate-limits, and match-details bodies are multi-megabyte, so
// nothing in here ever fans out with a bare Promise.all over player-sized lists.
async function pool(items, limit, fn){
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ reference data */

// valorant-api.com is public and keyless — the same reference API the browser already uses for
// tier icons. Only two things are needed server-side: the client version (a required Riot header)
// and the act list (to know which SeasonalInfo entry is "now", and to normalize old peak ranks —
// see normalizeTier()). Both change on patch day at most, hence the 6h cache.
let refCache = { at: 0, clientVersion: '', currentActId: '', actStart: {} };

async function ensureRefData(){
  if (refCache.at && Date.now() - refCache.at < REF_TTL_MS) return refCache;

  const [ver, seasons] = await Promise.all([
    fetchJson(`${VALORANT_API_BASE}/version`, {}, TIMEOUT.auth),
    fetchJson(`${VALORANT_API_BASE}/seasons`, {}, TIMEOUT.auth),
  ]);

  const clientVersion = ver.json?.data?.riotClientVersion || refCache.clientVersion || '';
  const actStart = {};
  let currentActId = '';
  const now = Date.now();
  for (const s of (seasons.json?.data || [])) {
    // episodes and acts are both in this list; acts are the ones with a parent episode
    if (!s.parentUuid) continue;
    const start = Date.parse(s.startTime);
    const end = Date.parse(s.endTime);
    actStart[s.uuid] = start;
    if (now >= start && now <= end) currentActId = s.uuid;
  }

  refCache = { at: Date.now(), clientVersion, currentActId, actStart };
  return refCache;
}

// Ascendant was inserted between Diamond and Immortal in Episode 5 Act 1 (2022-06-22), which
// pushed Immortal 1-3 from tiers 21-23 up to 24-26 and Radiant from 24 to 27. A peak rank read
// out of a pre-Ascendant act therefore has to be shifted before it can be compared with, or
// rendered on, today's scale — otherwise an old Radiant shows up as "Ascendant 3".
const ASCENDANT_EPOCH = Date.parse('2022-06-22T00:00:00Z');
function normalizeTier(tier, actStartMs){
  if (!tier || !actStartMs || actStartMs >= ASCENDANT_EPOCH) return tier;
  if (tier >= 24) return 27;        // old Radiant
  if (tier >= 21) return tier + 3;  // old Immortal 1-3
  return tier;
}

/* ------------------------------------------------------------------ auth */

// The auth ladder, memoized per account label.
//
// checkAccountStore()/checkAccountOwnedSkins() in valorant-lib.mjs each run their own ladder from
// scratch, which is right for them: they fire a handful of times a day, so a fresh reauth per call
// costs nothing and keeps those functions self-contained (see the comment above
// checkAccountOwnedSkins()). This panel is different — it polls every few seconds while you're in
// a game. Re-running silentReauth() at that rate would be several Riot auth round-trips a minute,
// per account, which is exactly the traffic shape the whole local-only architecture exists to
// avoid. Holding the token for its natural lifetime is the safe behaviour here, not an
// optimization. This is the only place in the repo that caches a Riot session; don't copy the
// pattern into the store/inventory checks, and don't fold their ladders into this one.
const liveAuth = new Map();

export function invalidateLiveAuth(label){ liveAuth.delete(label); }

export async function ensureLiveAuth(label, sess, opts = {}){
  const cached = liveAuth.get(label);
  if (cached && !opts.force && Date.now() < cached.expiresAt) return cached;

  let accessToken, idToken;
  try {
    ({ accessToken, idToken } = await silentReauth(sess));
  } catch (err) {
    throw new LiveError('session_expired',
      `${err.message} Run \`node scripts/valorant-login-window.mjs ${label}\` on that machine to sign in again.`);
  }

  const entResp = await fetchJson('https://entitlements.auth.riotgames.com/api/token/v1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': RIOT_USER_AGENT },
    body: '{}',
  }, TIMEOUT.auth);
  const entitlementsToken = entResp.json?.entitlements_token;
  if (!entitlementsToken) throw new LiveError('auth_failed', `Entitlements request failed (HTTP ${entResp.status}).`);

  const userResp = await fetchJson('https://auth.riotgames.com/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': RIOT_USER_AGENT },
  }, TIMEOUT.auth);
  const puuid = userResp.json?.sub;
  if (!puuid) throw new LiveError('auth_failed', 'Could not resolve PUUID.');

  const geoResp = await fetchJson('https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': RIOT_USER_AGENT },
    body: JSON.stringify({ id_token: idToken }),
  }, TIMEOUT.auth);
  const shard = geoResp.json?.affinities?.live;
  if (!shard) throw new LiveError('auth_failed', 'Could not resolve shard.');

  const { clientVersion } = await ensureRefData();
  const clientPlatform = Buffer.from(JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  })).toString('base64');

  const auth = {
    label, accessToken, entitlementsToken, puuid, shard,
    region: '', glzBase: '', hostVerified: false,
    pdBase: `https://pd.${shard}.a.pvp.net`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Riot-Entitlements-JWT': entitlementsToken,
      'X-Riot-ClientVersion': clientVersion || '',
      'X-Riot-ClientPlatform': clientPlatform,
      'User-Agent': RIOT_USER_AGENT,
    },
    expiresAt: Date.now() + AUTH_TTL_MS,
  };
  liveAuth.set(label, auth);
  return auth;
}

// One wrapper so a token that expired mid-poll is retried exactly once rather than surfacing as a
// spurious "not in a match". A second failure is a real session problem.
async function riotFetch(auth, sess, url, opts, timeoutMs){
  let res = await fetchJson(url, { ...opts, headers: { ...auth.headers, ...(opts && opts.headers) } }, timeoutMs);
  if (res.status === 401) {
    invalidateLiveAuth(auth.label);
    const fresh = await ensureLiveAuth(auth.label, sess, { force: true });
    Object.assign(auth, fresh);   // callers hold a reference; keep it pointing at live credentials
    res = await fetchJson(url, { ...opts, headers: { ...auth.headers, ...(opts && opts.headers) } }, timeoutMs);
    if (res.status === 401) throw new LiveError('session_expired',
      `Valorant session expired — run \`node scripts/valorant-login-window.mjs ${auth.label}\` on that machine to sign in again.`);
  }
  return res;
}

/* ------------------------------------------------------------------ region / glz host */

// riot-geo hands back the *shard* (affinities.live) and nothing else, but the live-match
// endpoints live on glz-{region}-1.{shard}.a.pvp.net and need both halves. Region and shard are
// the same string almost everywhere; the exception is the NA shard, which also hosts LATAM and BR.
const REGION_CANDIDATES = { na: ['na', 'latam', 'br'], eu: ['eu'], ap: ['ap'], kr: ['kr'] };

function glzHost(region, shard){ return `https://glz-${region}-1.${shard}.a.pvp.net`; }

// Probes against parties/v1 rather than core-game/v1: a wrong host and "you're simply not in a
// game" are indistinguishable through core-game (both 404), which makes it useless as a probe.
// The party endpoint answers 200 whenever VALORANT is running, so it separates the two cases —
// but it also 404s on the *correct* host when the game is closed, so a 200 is treated as proof
// and a Riot-shaped error only as a hint. A region is written back to the session file only when
// it was proven, never when it was guessed.
export async function resolveGlzHost(auth, sess, opts = {}){
  const shard = auth.shard;
  const candidates = REGION_CANDIDATES[shard] || [shard];

  const explicit = (opts.override || process.env.VALORANT_REGION || '').trim().toLowerCase();
  if (explicit) {
    auth.region = explicit;
    auth.glzBase = glzHost(explicit, shard);
    auth.hostVerified = false;
    return auth;
  }
  if (auth.glzBase && auth.hostVerified) return auth;

  const saved = (loadSessions()[auth.label] || {}).region;
  if (saved && candidates.includes(saved)) {
    auth.region = saved;
    auth.glzBase = glzHost(saved, shard);
    auth.hostVerified = true;   // it was verified when it was written
    return auth;
  }

  // sequential on purpose — three simultaneous authed requests to wrong hosts is the noisiest
  // possible way to ask this question
  const tried = [];
  let fallback = '';
  for (const region of candidates) {
    tried.push(region);
    const res = await fetchJson(`${glzHost(region, shard)}/parties/v1/players/${auth.puuid}`,
      { headers: auth.headers }, TIMEOUT.probe);
    if (res.ok) {
      auth.region = region;
      auth.glzBase = glzHost(region, shard);
      auth.hostVerified = true;
      persistRegion(auth.label, region);
      return auth;
    }
    // a Riot-shaped JSON error means the host exists and answered; a transport failure means it
    // didn't. Keep the first host that at least answered as a guess for this run.
    if (!fallback && !res.failed && res.json && (res.json.errorCode || res.json.httpStatus)) fallback = region;
  }

  const guess = fallback || (candidates.includes(shard) ? shard : candidates[0]);
  if (!guess) throw new LiveError('region_unresolved',
    `Could not work out your Valorant region for shard "${shard}". Set it manually under Settings → Valorant → Live Match.`,
    { shard, tried });

  auth.region = guess;
  auth.glzBase = glzHost(guess, shard);
  auth.hostVerified = false;    // unproven: don't persist, and let a later 200 confirm it
  return auth;
}

// A guessed host that turns out to answer a presence call was the right one after all — promote
// it once, so later polls take the early return in resolveGlzHost() instead of re-reading the
// session file every few seconds.
function confirmHost(auth){
  if (auth.hostVerified) return;
  auth.hostVerified = true;
  persistRegion(auth.label, auth.region);
}

function persistRegion(label, region){
  try {
    const sessions = loadSessions();
    if (!sessions[label] || sessions[label].region === region) return;
    sessions[label].region = region;
    saveSessions(sessions);
  } catch { /* the region is re-probed next run; not worth failing a poll over */ }
}

/* ------------------------------------------------------------------ match cache */

// Reduced per-match summaries, keyed by matchId. Match details never change once a game is over,
// so a hit here is permanent and free — which is the whole reason a ten-player agent-stats sweep
// is affordable at all. The multi-megabyte response this is distilled from is parsed, reduced,
// and dropped in the same tick; raw match-details never leave this process.
//
// Safe to delete at any time: it refetches. Gitignored.
let matchCache = null;
let matchCacheDirty = false;
let matchCacheFlushAt = 0;

function readMatchCache(){
  if (matchCache) return matchCache;
  try {
    const raw = JSON.parse(fs.readFileSync(MATCH_CACHE_FILE, 'utf8'));
    matchCache = (raw && raw.version === 1 && raw.matches) ? raw.matches : {};
  } catch { matchCache = {}; }
  return matchCache;
}

function putMatchCache(matchId, entry){
  readMatchCache()[matchId] = entry;
  matchCacheDirty = true;
  // write-behind: an enrichment sweep resolves dozens of matches in a burst, and rewriting the
  // whole file per match would cost more than the fetches
  if (Date.now() - matchCacheFlushAt > 5000) flushMatchCache();
}

export function flushMatchCache(){
  if (!matchCacheDirty || !matchCache) return;
  try {
    const ids = Object.keys(matchCache);
    if (ids.length > 5000) {
      ids.sort((a, b) => (matchCache[b].startTime || 0) - (matchCache[a].startTime || 0));
      const kept = {};
      for (const id of ids.slice(0, 4000)) kept[id] = matchCache[id];
      matchCache = kept;
    }
    fs.writeFileSync(MATCH_CACHE_FILE, JSON.stringify({ version: 1, updatedAt: Date.now(), matches: matchCache }));
    matchCacheDirty = false;
    matchCacheFlushAt = Date.now();
  } catch { /* a cache that can't be written just means slower lookups next time */ }
}

/* ------------------------------------------------------------------ game mode */

// Riot names the queue in MatchmakingData.QueueID when matchmaking produced the game; custom
// games have no queue, so the ModeID asset path is the fallback. Both are community-known
// constants — an unrecognized one degrades to a playable "Other" rather than failing the lobby.
const QUEUE_LABELS = {
  competitive: 'Competitive', unrated: 'Unrated', deathmatch: 'Deathmatch',
  spikerush: 'Spike Rush', swiftplay: 'Swiftplay', hurm: 'Team Deathmatch',
  ggteam: 'Escalation', onefa: 'Replication', snowball: 'Snowball Fight', newmap: 'New Map',
};
// Deathmatch is the only free-for-all here: Team Deathmatch (hurm) and Escalation have real teams.
const FFA_QUEUES = new Set(['deathmatch']);

function resolveMode(match){
  const queueId = (match?.MatchmakingData?.QueueID || '').toLowerCase();
  const modeUrl = match?.ModeID || '';
  const custom = !queueId && /CustomGame/i.test(match?.ProvisioningFlow || '');

  let id = queueId;
  if (!id) {
    const m = modeUrl.toLowerCase();
    if (custom) id = 'custom';
    else if (m.includes('deathmatch') && !m.includes('hurm')) id = 'deathmatch';
    else if (m.includes('hurm')) id = 'hurm';
    else if (m.includes('quickbomb')) id = 'spikerush';
    else if (m.includes('gungame')) id = 'ggteam';
    else if (m.includes('oneforall')) id = 'onefa';
    else if (m.includes('swiftplay')) id = 'swiftplay';
    else if (m.includes('snowball')) id = 'snowball';
    else id = 'other';
  }
  return {
    id,
    label: QUEUE_LABELS[id] || (id === 'custom' ? 'Custom Game' : 'Other'),
    queueId,
    modeUrl,
    isRanked: !!match?.MatchmakingData?.IsRanked || !!match?.IsRanked,
    teamBased: !FFA_QUEUES.has(id),
  };
}

/* ------------------------------------------------------------------ presence + roster */

// Coregame first, then pregame: if you're in a live game that's the answer, and only if you
// aren't is it worth asking whether you're in agent select.
async function fetchPresence(auth, sess){
  const core = await riotFetch(auth, sess, `${auth.glzBase}/core-game/v1/players/${auth.puuid}`, {}, TIMEOUT.presence);
  if (core.ok && core.json?.MatchID) {
    confirmHost(auth);
    return { phase: 'coregame', matchId: core.json.MatchID };
  }
  const pre = await riotFetch(auth, sess, `${auth.glzBase}/pregame/v1/players/${auth.puuid}`, {}, TIMEOUT.presence);
  if (pre.ok && pre.json?.MatchID) {
    confirmHost(auth);
    return { phase: 'pregame', matchId: pre.json.MatchID };
  }
  // 404 from both is the overwhelmingly common case: not in a game. A transport failure is not.
  if (core.failed && pre.failed) throw new LiveError('riot_unreachable', 'Could not reach Riot.');
  return { phase: 'none', matchId: null };
}

function identityOf(p){
  const ident = p?.PlayerIdentity || {};
  return {
    incognito: !!ident.Incognito,
    levelHidden: !!ident.HideAccountLevel,
    level: ident.HideAccountLevel ? null : (ident.AccountLevel || null),
  };
}

// The rank badge Riot ships *inside the match itself* — the same one drawn under a player's name
// on the loading screen and the in-game scoreboard. It's tier-only (no RR) and it belongs to
// whichever act earned it, so it isn't a substitute for /mmr/v1. What it is, is unrefusable: it
// arrives with the roster, for every player including the enemy team, at no extra request and
// with nothing to rate-limit. So it's used as the floor under everyone's rank — the panel shows
// it immediately, and the real number overwrites it the moment MMR resolves. Before this, an
// enemy MMR lookup that got squeezed out (see rememberSnapshot()) left that player showing a dash
// for the entire game, because the ranks stage only ever ran once.
function badgeOf(p){
  const b = p?.SeasonalBadgeInfo || {};
  const rank = b.Rank || 0;
  if (!rank) return { badgeTier: 0, badgeLeaderboard: 0 };
  return {
    badgeTier: normalizeTier(rank, refCache.actStart[b.SeasonID]) || 0,
    badgeLeaderboard: b.LeaderboardRank || 0,
  };
}

async function fetchCoreGameRoster(auth, sess, matchId){
  const res = await riotFetch(auth, sess, `${auth.glzBase}/core-game/v1/matches/${matchId}`, {}, TIMEOUT.match);
  if (!res.ok) return null;
  const m = res.json || {};
  const players = (m.Players || [])
    .filter(p => !p.IsCoach)
    .map(p => ({
      puuid: p.Subject,
      teamId: p.TeamID || '',
      agentUuid: (p.CharacterID || '').toLowerCase(),
      agentLocked: true,
      ...identityOf(p),
      ...badgeOf(p),
    }));
  return { players, mapId: m.MapID || '', mode: resolveMode(m) };
}

// Pregame only ever exposes your own team — Riot doesn't hand out the enemy roster before the
// barrier drops, and nothing here tries to work around that.
async function fetchPregameRoster(auth, sess, matchId){
  const res = await riotFetch(auth, sess, `${auth.glzBase}/pregame/v1/matches/${matchId}`, {}, TIMEOUT.match);
  if (!res.ok) return null;
  const m = res.json || {};
  const team = m.AllyTeam || (m.Teams || [])[0] || {};
  const players = (team.Players || []).map(p => ({
    puuid: p.Subject,
    teamId: team.TeamID || 'Blue',
    agentUuid: (p.CharacterID || '').toLowerCase(),
    agentLocked: String(p.CharacterSelectionState || '').toLowerCase() === 'locked',
    ...identityOf(p),
    ...badgeOf(p),
  }));
  return { players, mapId: m.MapID || '', mode: resolveMode(m), enemyTeamSize: m.EnemyTeamSize || 0 };
}

async function fetchNames(auth, sess, puuids){
  const res = await riotFetch(auth, sess, `${auth.pdBase}/name-service/v2/players`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(puuids),
  }, TIMEOUT.names);
  const out = {};
  for (const row of (Array.isArray(res.json) ? res.json : [])) {
    if (row && row.Subject) out[row.Subject] = { name: row.GameName || '', tag: row.TagLine || '' };
  }
  return out;
}

/* ------------------------------------------------------------------ MMR */

async function fetchMmr(auth, sess, puuid){
  const url = `${auth.pdBase}/mmr/v1/players/${puuid}`;
  let res = await riotFetch(auth, sess, url, {}, TIMEOUT.mmr);
  // ten of these go out at once the instant a match starts, which is also when the last lobby's
  // match-details sweep is still winding down — a 429 here is a "come back in a second", not an
  // answer about this player
  if (res.status === 429) {
    const wait = Math.min(5000, (Number(res.headers?.get('retry-after')) || 2) * 1000);
    await sleep(wait);
    res = await riotFetch(auth, sess, url, {}, TIMEOUT.mmr);
  }
  if (!res.ok) {
    // deliberately returns ONLY the error: the caller Object.assign()s this onto the player, and
    // overwriting tier with null here would wipe the badge rank that's already on screen
    return {
      rankError: res.failed ? 'timeout'
        : (res.status === 429 ? 'ratelimited'
        : (res.status === 403 || res.status === 404 ? 'forbidden' : 'unavailable')),
    };
  }
  const { currentActId, actStart } = refCache;
  const bySeason = res.json?.QueueSkills?.competitive?.SeasonalInfoBySeasonID || {};

  const cur = currentActId ? bySeason[currentActId] : null;
  let peakTier = 0, peakSeason = '';
  for (const [seasonId, info] of Object.entries(bySeason)) {
    const t = normalizeTier(info?.CompetitiveTier || 0, actStart[seasonId]);
    if (t > peakTier) { peakTier = t; peakSeason = seasonId; }
  }

  return {
    tier: cur?.CompetitiveTier ?? 0,
    rr: cur?.RankedRating ?? 0,
    peakTier: peakTier || null,
    peakSeason,
    peakLegacy: !!peakSeason && peakSeason !== currentActId,
    seasonWins: cur?.NumberOfWins || 0,
    seasonGames: cur?.NumberOfGames || 0,
    leaderboardRank: cur?.LeaderboardRank || 0,
    rankError: '',
    rankSource: 'mmr',
  };
}

/* ------------------------------------------------------------------ parties */

// Riot exposes each player's current party id, which is the only *authoritative* way to know who
// queued together. It has restricted this for non-friends before, so a 403/404 here is treated as
// "unknown", never as "solo" — and groupParties() falls back to the inferred signal below.
async function fetchParty(auth, sess, puuid){
  const res = await riotFetch(auth, sess, `${auth.glzBase}/parties/v1/players/${puuid}`, {}, TIMEOUT.party);
  if (!res.ok) return null;
  return res.json?.CurrentPartyID || null;
}

// Your own party, in full. The call above only ever yields an *id*, and an id on its own groups
// nobody — a bucket of one isn't a stack. This is what turns it into "these three queued
// together", and it's the one piece of party data Riot never withholds, because it's yours. So
// however coy Riot is about the rest of the lobby, your own premade is never a guess.
async function fetchPartyMembers(auth, sess, partyId){
  const res = await riotFetch(auth, sess, `${auth.glzBase}/parties/v1/parties/${partyId}`, {}, TIMEOUT.party);
  if (!res.ok) return null;
  return (res.json?.Members || []).map(m => m && m.Subject).filter(Boolean);
}

// Buckets players by whatever party signal is available and labels the groups A, B, C… per team,
// in the order they first appear. Solo players get no group at all — a badge on everyone would
// carry no information.
function groupParties(players, { inferredPairs } = {}){
  const buckets = new Map();   // key -> [puuid]
  for (const p of players) {
    if (!p.party || !p.party.id) continue;
    if (!buckets.has(p.party.id)) buckets.set(p.party.id, []);
    buckets.get(p.party.id).push(p.puuid);
  }

  // fallback: union-find over "played together often enough recently" pairs, used only for
  // players Riot didn't give us a party id for
  if (inferredPairs && inferredPairs.length) {
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const seen = new Set();
    for (const [a, b] of inferredPairs) { for (const x of [a, b]) if (!seen.has(x)) { seen.add(x); parent.set(x, x); } }
    for (const [a, b] of inferredPairs) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }
    const byRoot = new Map();
    for (const x of seen) {
      const owner = players.find(p => p.puuid === x);
      if (!owner || (owner.party && owner.party.id)) continue;   // authoritative data wins
      const r = find(x);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(x);
    }
    let n = 0;
    for (const members of byRoot.values()) {
      if (members.length < 2) continue;
      buckets.set(`inferred:${n++}`, members);
    }
  }

  const stacks = [];
  const labelCounter = new Map();   // teamId -> next letter index
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const first = players.find(p => p.puuid === members[0]);
    const teamId = first ? first.teamId : '';
    const idx = labelCounter.get(teamId) || 0;
    labelCounter.set(teamId, idx + 1);
    const group = String.fromCharCode(65 + idx);
    const inferred = key.startsWith('inferred:');
    for (const puuid of members) {
      const p = players.find(q => q.puuid === puuid);
      if (p) p.party = { id: inferred ? key : p.party.id, group, size: members.length, inferred };
    }
    stacks.push({ group, teamId, size: members.length, puuids: members.slice(), inferred });
  }
  for (const p of players) if (p.party && !p.party.group) p.party = null;   // solo
  return stacks;
}

// Re-runs the grouping as better evidence arrives (histories land, then same-team co-occurrence).
// Clearing the previous *inferred* assignments first is not optional: groupParties() buckets on
// p.party.id, and a synthetic `inferred:0` id left over from the last pass would be re-read as if
// it were one of Riot's, quietly merging two passes' groups into one oversized stack.
function rebuildStacks(snap, inferredPairs){
  for (const p of snap.players) if (p.party && p.party.inferred) p.party = null;
  snap.lobby.stacks = groupParties(snap.players, { inferredPairs });
}

/* ------------------------------------------------------------------ agent stats */

async function fetchHistory(auth, sess, puuid, depth){
  const url = `${auth.pdBase}/match-history/v1/history/${puuid}?startIndex=0&endIndex=${depth}&queue=competitive`;
  const res = await riotFetch(auth, sess, url, {}, TIMEOUT.history);
  if (!res.ok) return null;
  return (res.json?.History || []).map(h => h.MatchID).filter(Boolean);
}

// Fetches one match and reduces it to the handful of bytes the comfort/win-rate maths needs.
// Returns the cached summary when there is one, so the caller can count "new fetches" separately.
async function fetchMatchSummary(auth, sess, matchId){
  const cache = readMatchCache();
  if (cache[matchId]) return { summary: cache[matchId], cached: true };

  let res = await riotFetch(auth, sess, `${auth.pdBase}/match-details/v1/matches/${matchId}`, {}, TIMEOUT.details);
  if (res.status === 429) {
    const wait = Math.min(5000, (Number(res.headers?.get('retry-after')) || 2) * 1000);
    await sleep(wait);
    res = await riotFetch(auth, sess, `${auth.pdBase}/match-details/v1/matches/${matchId}`, {}, TIMEOUT.details);
    if (res.status === 429) return { summary: null, cached: false, rateLimited: true };
  }
  if (!res.ok || !res.json) return { summary: null, cached: false };

  const d = res.json;
  const wonByTeam = {};
  const teams = {};
  for (const t of (d.teams || [])) {
    wonByTeam[t.teamId] = !!t.won;
    teams[t.teamId] = { won: !!t.won, roundsWon: t.roundsWon || 0 };
  }
  const players = {};
  for (const p of (d.players || [])) {
    if (!p.subject) continue;
    players[p.subject] = {
      agentUuid: (p.characterId || '').toLowerCase(),
      won: !!wonByTeam[p.teamId],
      teamId: p.teamId || '',
      k: p.stats?.kills || 0, d: p.stats?.deaths || 0, a: p.stats?.assists || 0,
      // combat score — the number the in-game scoreboard actually sorts a competitive team by,
      // and the tiebreak for a deathmatch standing
      s: p.stats?.score || 0,
    };
  }
  const summary = {
    queueId: d.matchInfo?.queueID || '',
    startTime: d.matchInfo?.gameStartMillis || 0,
    players, teams,
  };
  putMatchCache(matchId, summary);
  return { summary, cached: false };
}

/* ------------------------------------------------------------------ final scoreboard */

// How a finished match gets its result. Nothing live exposes a running scoreboard — core-game
// hands out the roster and nothing else — so the standing comes from match-details once Riot has
// published the match, which is also the same call (and the same cache) the win-rate sweep uses.
//
// Riot takes a moment to write a just-finished match, so a 404 straight after the final round is
// normal rather than an answer. This retries on a widening backoff for ~2.5 minutes before
// admitting defeat, which is well inside how long you'd sit looking at the panel afterwards.
const FINAL_RETRY_WAITS = [0, 5000, 12000, 25000, 45000, 60000];

function markEnded(snap){
  if (snap.phase === 'ended') return;
  snap.phase = 'ended';
  snap.endedAt = Date.now();
  snap.final = { state: 'pending', note: '', rows: [], teams: {}, myTeamWon: null, place: 0 };
}

function applyFinal(snap, summary){
  const rows = [];
  for (const p of snap.players) {
    const r = summary.players[p.puuid];
    if (!r) continue;
    rows.push({
      puuid: p.puuid, kills: r.k || 0, deaths: r.d || 0, assists: r.a || 0,
      score: r.s || 0, won: !!r.won, place: 0,
    });
  }
  // Deathmatch has no teams — the standing IS the leaderboard, and the in-game one ranks by
  // kills. Everything else is a team result, where combat score is what the scoreboard sorts by.
  const ffa = !snap.mode.teamBased;
  rows.sort(ffa
    ? (a, b) => b.kills - a.kills || b.score - a.score || a.deaths - b.deaths
    : (a, b) => b.score - a.score || b.kills - a.kills);
  if (ffa) rows.forEach((r, i) => { r.place = i + 1; });

  snap.final.rows = rows;
  snap.final.teams = summary.teams || {};
  if (ffa) {
    const mine = rows.find(r => r.puuid === snap.me.puuid);
    snap.final.place = mine ? mine.place : 0;
  } else {
    const mine = summary.teams ? summary.teams[snap.me.teamId] : null;
    snap.final.myTeamWon = mine ? mine.won : null;
  }
  snap.final.state = 'done';
  // this is the one thing worth writing through immediately — it's the end of a session, and
  // the next thing that happens is often the process being closed
  flushMatchCache();
}

function ensureFinalScoreboard(snap, auth, sess){
  if (!snap.final || snap.final.state !== 'pending' || snap._finalRunning) return;
  snap._finalRunning = true;
  (async () => {
    for (const wait of FINAL_RETRY_WAITS) {
      if (wait) await sleep(wait);
      if (snap._finalCancelled) return;
      let summary = null;
      try { summary = (await fetchMatchSummary(auth, sess, snap.matchId)).summary; }
      catch { /* a transient failure is not an answer — keep waiting for Riot */ }
      if (summary) { applyFinal(snap, summary); return; }
    }
    snap.final.state = 'unavailable';
    snap.final.note = 'Riot hasn’t published this match’s scoreboard.';
  })().catch(() => {
    snap.final.state = 'unavailable';
    snap.final.note = 'Could not read the final scoreboard.';
  }).finally(() => { snap._finalRunning = false; });
}

// First rule that matches wins. Thresholds are deliberately conservative at the top end: calling
// someone a "main" off two games would make the label worthless.
function classifyComfort(stats, agentUuid){
  if (!stats || stats.error || stats.totalGames < 4) return { label: 'unknown', share: 0, note: '' };
  const games = stats.gamesOnAgent;
  const share = stats.totalGames ? games / stats.totalGames : 0;
  const top = stats.topAgents[0];
  const isTop = !!top && top.agentUuid === agentUuid && top.games === games;
  const note = `${games} of last ${stats.totalGames} comp games`;

  let label;
  if (games >= 4 && share >= 0.40 && isTop) label = 'main';
  else if (games >= 3 && share >= 0.20) label = 'comfort';
  else if (games >= 1) label = 'situational';
  else label = 'off-agent';
  return { label, share, note };
}

/* ------------------------------------------------------------------ lobby aggregates */

// Composite rating used for *averaging only*. The RR cap matters: Immortal/Radiant RankedRating
// is a combined score that runs into the hundreds, so one Radiant at 380 RR would otherwise drag
// a lobby average up by nearly three whole tiers.
function eloOf(tier, rr){ return (tier || 0) * 100 + Math.min(Math.max(rr || 0, 0), 99); }

function computeLobby(players, mode){
  // An unranked-this-act player with an Ascendant peak is not a Bronze, and in deathmatch half the
  // lobby is typically unplaced — so peak stands in for a missing current rank. Players with
  // neither are excluded outright rather than averaged in as a zero.
  const rated = [];
  let peakDerivedCount = 0, unknownCount = 0;
  for (const p of players) {
    const tier = p.tier || 0;
    if (tier > 0) { rated.push({ p, tier, rr: p.rr || 0, fromPeak: false }); continue; }
    if (p.peakTier) { rated.push({ p, tier: p.peakTier, rr: 0, fromPeak: true }); peakDerivedCount++; continue; }
    unknownCount++;
  }

  const lobby = {
    rankedCount: rated.length, peakDerivedCount, unknownCount,
    avgElo: 0, avgTier: 0, avgTierFloor: 0, avgTierRr: 0,
    highest: null, teams: {}, stacks: [],
  };
  if (!rated.length) return lobby;

  const avgElo = rated.reduce((s, r) => s + eloOf(r.tier, r.rr), 0) / rated.length;
  lobby.avgElo = Math.round(avgElo);
  lobby.avgTier = Number((avgElo / 100).toFixed(2));
  lobby.avgTierFloor = Math.floor(avgElo / 100);
  lobby.avgTierRr = Math.round(avgElo - lobby.avgTierFloor * 100);

  // Deliberately a *different* comparator from the average: raw RR, uncapped. Two Immortal 3s at
  // 350 and 20 RR are genuinely different players, and "who is the highest rank here" is the one
  // question where that difference is the whole point.
  const best = rated.slice().sort((x, y) => (y.tier - x.tier) || ((y.p.rr || 0) - (x.p.rr || 0)))[0];
  lobby.highest = { puuid: best.p.puuid, tier: best.tier, rr: best.p.rr || 0, fromPeak: best.fromPeak };

  if (mode.teamBased) {
    for (const teamId of new Set(rated.map(r => r.p.teamId).filter(Boolean))) {
      const inTeam = rated.filter(r => r.p.teamId === teamId);
      const teamElo = inTeam.reduce((s, r) => s + eloOf(r.tier, r.rr), 0) / inTeam.length;
      lobby.teams[teamId] = {
        avgElo: Math.round(teamElo),
        avgTier: Number((teamElo / 100).toFixed(2)),
        avgTierFloor: Math.floor(teamElo / 100),
        avgTierRr: Math.round(teamElo - Math.floor(teamElo / 100) * 100),
        count: inTeam.length,
      };
    }
  }
  return lobby;
}

/* ------------------------------------------------------------------ snapshot store */

// One snapshot per `phase:matchId`, mutated in place as the background stages land. Keeping the
// last few means the pregame -> coregame handover can carry resolved ranks across instead of
// refetching them — and keying on the phase is what makes that handover happen at all, since a
// match keeps one id from agent select to the final round while its roster doubles in size.
const snapshots = new Map();

// The most recent lobby that had a real roster, kept deliberately after the match ends so the
// panel can keep showing the game you just played — with its final scoreboard — instead of
// blanking to "not in a match" the second you hit the end-of-game screen. Replaced only when a
// new match is captured. Global rather than per-label: you play one game at a time, and with
// auto-detect the account that just finished isn't necessarily the one being probed next tick.
let lastLobby = null;

function isLivePhase(phase){ return phase === 'pregame' || phase === 'coregame'; }

// `key` is `phase:matchId` — see the comment where it's built in getLiveMatch().
function rememberSnapshot(key, snap){
  // The moment the barrier drops, the agent-select sweep is grinding through match-details to
  // answer a question that has already been answered. Leaving it running isn't just wasted
  // traffic: those bodies are multi-megabyte and Riot rate-limits per account, so it lands
  // squarely on top of the new snapshot's ten MMR lookups — which is precisely why the enemy
  // team used to sit on dashes, the enemy five being the only ranks pregame hadn't resolved.
  for (const [id, old] of snapshots) if (id !== key) old.aborted = true;
  snapshots.set(key, snap);
  while (snapshots.size > SNAPSHOT_KEEP) snapshots.delete(snapshots.keys().next().value);
  if (lastLobby && lastLobby !== snap) lastLobby._finalCancelled = true;   // stop a stale retry loop
  lastLobby = snap;
}

// By match id rather than by key, because a caller holding a match id doesn't know (or care)
// which phase it's in — and the id survives the pregame -> coregame handover. Map iteration is
// insertion-ordered, so the last match is the newest, i.e. the live game rather than the agent
// select it grew out of.
export function getLiveSnapshot(matchId){
  let found = null;
  for (const snap of snapshots.values()) if (snap.matchId === matchId) found = snap;
  return found;
}
export function getLastLobby(){ return lastLobby; }

// Carries already-resolved per-player data (ranks, parties, agent stats) from any recent snapshot
// into a new one, keyed by puuid. Agent select and the live game are two snapshots holding five
// of the same people, so without this the barrier dropping would cost a second round of MMR
// lookups for your own team, for no new information.
function carryOver(players){
  for (const snap of snapshots.values()) {
    for (const old of snap.players) {
      const p = players.find(q => q.puuid === old.puuid);
      if (!p) continue;
      // only a *resolved* rank is worth carrying: a badge tier is already on the new roster, and
      // an old snapshot's failed lookup must not be inherited as though it had been answered
      if (p.rankSource !== 'mmr' && old.rankSource === 'mmr') {
        Object.assign(p, {
          tier: old.tier, rr: old.rr, peakTier: old.peakTier, peakSeason: old.peakSeason,
          peakLegacy: old.peakLegacy, seasonWins: old.seasonWins, seasonGames: old.seasonGames,
          leaderboardRank: old.leaderboardRank, rankError: old.rankError, rankSource: 'mmr',
        });
      }
      if (!p.name && old.name) { p.name = old.name; p.tag = old.tag; }
      if (!p.party && old.party) p.party = old.party;
      // agent stats are per-agent, so they only carry if the player is still on the same agent
      if (!p.agentStats && old.agentStats && old.agentUuid === p.agentUuid) {
        p.agentStats = old.agentStats; p.comfort = old.comfort;
      }
      if (!p._history && old._history) p._history = old._history;
    }
  }
}

/* ------------------------------------------------------------------ background stages */

// The MMR pass. Unlike the roster this is *not* a once-per-match job: a lookup can fail for
// reasons that have nothing to do with the player (see RANK_RETRYABLE), and the enemy team is
// systematically the most exposed to that, because their five lookups are the ones fired at the
// exact moment the barrier drops. Re-entrant and idempotent, so kickRankRetry() can call it again
// on a later poll; players already resolved from MMR are skipped.
async function resolveRanks(snap, auth, sess){
  if (snap._ranksRunning || snap.aborted) return;
  const pending = snap.players.filter(p => p.rankSource !== 'mmr');
  if (!pending.length) { snap.stages.ranks = 'done'; return; }

  snap._ranksRunning = true;
  snap.stages.ranksAttempts = (snap.stages.ranksAttempts || 0) + 1;
  try {
    await pool(pending, LIMIT.mmr, async (p) => {
      if (snap.aborted) return;
      p.rankError = '';
      try { Object.assign(p, await fetchMmr(auth, sess, p.puuid)); }
      catch (err) { p.rankError = err.code === 'session_expired' ? 'forbidden' : 'unavailable'; }
    });
  } finally {
    snap._ranksRunning = false;
    snap._ranksNextAt = Date.now() + RANK_RETRY_WAIT_MS;
  }

  const unresolved = snap.players.filter(p => p.rankSource !== 'mmr');
  snap.stages.ranksPending = unresolved.length;
  snap.stages.ranksRetrying = unresolved.some(p => RANK_RETRYABLE.has(p.rankError))
    && snap.stages.ranksAttempts < RANK_RETRY_MAX;
  snap.stages.ranks = !unresolved.length ? 'done'
    : (snap.stages.ranksRetrying ? 'loading'
    : (unresolved.length === snap.players.length ? 'failed' : 'partial'));
  snap.lobby = { ...computeLobby(snap.players, snap.mode), stacks: snap.lobby.stacks || [] };
}

// Cheap, and fired from the memoized poll path rather than the build path: a poll that would
// otherwise cost one presence request picks up the ranks that a rate limit swallowed a few
// seconds earlier.
function kickRankRetry(snap, auth, sess){
  if (!snap.stages || !snap.stages.ranksRetrying || snap._ranksRunning || snap.aborted) return;
  if (snap.stages.ranksAttempts >= RANK_RETRY_MAX) return;
  if (Date.now() < (snap._ranksNextAt || 0)) return;
  resolveRanks(snap, auth, sess).catch(() => { snap.stages.ranks = 'partial'; });
}

// Ranks + parties, once per matchId. The party half genuinely is once-only — Riot either shares a
// player's party id or it doesn't, and that answer doesn't change mid-match.
async function runRanksStage(snap, auth, sess){
  await resolveRanks(snap, auth, sess);

  const needParty = snap.players.filter(p => !p.party);
  let partyOk = 0, partyOthers = 0;
  await pool(needParty, LIMIT.party, async (p) => {
    if (snap.aborted) return;
    try {
      const id = await fetchParty(auth, sess, p.puuid);
      if (id) { p.party = { id, group: '', size: 0, inferred: false }; partyOk++; if (!p.isSelf) partyOthers++; }
    } catch { /* unknown, not solo */ }
  });
  // ...and expand your own id into its members, which is the only group here Riot will spell out
  const mine = snap.players.find(p => p.isSelf);
  if (!snap.aborted && mine && mine.party && mine.party.id) {
    try {
      const members = await fetchPartyMembers(auth, sess, mine.party.id);
      for (const p of (members ? snap.players : [])) {
        if (p.isSelf || !members.includes(p.puuid)) continue;
        p.party = { id: mine.party.id, group: '', size: 0, inferred: false };
        partyOthers++;
      }
    } catch { /* your own party is a bonus, not a requirement */ }
  }

  // Riot answers the per-player call for you and, in practice, for nobody else. So "we got a
  // reply" is not the same claim as "we can see who queued with whom": report the second one, so
  // the panel can say the stacks are inferred instead of implying Riot confirmed them.
  snap.stages.parties = partyOthers ? 'done' : (partyOk ? 'self-only' : 'unavailable');
  snap.lobby = { ...computeLobby(snap.players, snap.mode), stacks: [] };
  rebuildStacks(snap, null);
}

// Agent stats. Competitive only — deathmatch doesn't have comfort picks, and a DM lobby is 14
// people, so skipping it there is both what the panel needs and what keeps it fast.
async function runStatsStage(snap, auth, sess, opts){
  const depth = opts.depth;
  // Two different target lists on purpose. A match history is a list of matchIds — one small
  // response per player — and it is the only free evidence there is for who queued with whom, so
  // it's read for the WHOLE lobby regardless of the enemy-stats setting. That setting is about
  // the expensive half (multi-megabyte match-details), and turning it off shouldn't also cost you
  // the enemy team's stacks, which is the question you can't answer by looking at the screen.
  const historyTargets = snap.players;
  const targets = opts.enemyStats
    ? snap.players
    : snap.players.filter(p => p.teamId === snap.me.teamId);
  const wantsStats = new Set(targets.map(p => p.puuid));

  snap.stages.statsTotal = targets.length;
  snap.stages.stats = 'loading';

  // 1. histories (cheap, matchIds only) — these alone also tell us who has been queueing together
  await pool(historyTargets, LIMIT.history, async (p) => {
    if (snap.aborted) return;
    if (p._history) return;
    const ids = await fetchHistory(auth, sess, p.puuid, depth);
    p._history = ids;
    // no history at all (lookup refused, or a genuinely fresh account) settles this player now —
    // there is nothing to fetch details for, and "unknown" is the honest answer
    if ((!ids || !ids.length) && wantsStats.has(p.puuid)) {
      p.agentStats = emptyStats(depth, ids ? '' : 'Could not read this player\'s match history.');
      p.comfort = classifyComfort(p.agentStats, p.agentUuid);
      snap.stages.statsDone++;
    }
  });
  if (snap.aborted) { snap.stages.stats = 'partial'; return; }

  inferStacks(snap, null);

  // 2. one pass over the *union* of everyone's match ids. A single match-details response carries
  //    all ten of its own participants, so a premade's overlapping histories collapse into
  //    roughly one set of fetches instead of one per player.
  const withHistory = targets.filter(p => Array.isArray(p._history) && p._history.length);
  const sets = new Map(withHistory.map(p => [p.puuid, new Set(p._history)]));
  const resolved = new Map(withHistory.map(p => [p.puuid, []]));

  // round-robin, newest first, allies before enemies: a run that gets cut short then leaves
  // everyone with a shallow sample rather than the last three players with nothing at all
  const ordered = [...withHistory].sort((a, b) =>
    (a.teamId === snap.me.teamId ? 0 : 1) - (b.teamId === snap.me.teamId ? 0 : 1));
  const wanted = [];
  const seen = new Set();
  for (let i = 0; i < depth; i++) {
    for (const p of ordered) {
      const id = p._history[i];
      if (id && !seen.has(id)) { seen.add(id); wanted.push(id); }
    }
  }

  let newFetches = 0;
  let rateLimited = false;
  const coPlay = new Map();
  const enough = () => withHistory.every(p => (resolved.get(p.puuid) || []).length >= Math.min(ENOUGH_RESOLVED, depth));

  await pool(wanted, LIMIT.details, async (matchId) => {
    if (snap.aborted || rateLimited) return;
    const cached = readMatchCache()[matchId];
    if (!cached) {
      if (newFetches >= MAX_NEW_DETAILS || enough()) return;
      newFetches++;
    }
    let summary;
    try {
      const r = await fetchMatchSummary(auth, sess, matchId);
      if (r.rateLimited) { rateLimited = true; return; }
      summary = r.summary;
    } catch { return; }
    if (!summary) return;
    noteCoPlay(coPlay, snap.players, summary);
    // attribute only to players whose OWN history contains this match, so each player's window
    // stays exactly their own last N rather than absorbing a team-mate's older games
    for (const [puuid, set] of sets) {
      if (!set.has(matchId)) continue;
      const row = summary.players[puuid];
      if (row) resolved.get(puuid).push(row);
    }
  });

  // the details just fetched carry each past match's *teams*, which is a far sharper premade
  // signal than raw overlap — so the grouping is redone now that it's available
  inferStacks(snap, coPlay);

  for (const p of withHistory) {
    const rows = resolved.get(p.puuid) || [];
    p.agentStats = buildAgentStats(rows, p.agentUuid, depth);
    p.agentStats.partial = rows.length < Math.min(depth, (p._history || []).length);
    p.comfort = classifyComfort(p.agentStats, p.agentUuid);
    snap.stages.statsDone++;
  }

  const anyPartial = withHistory.some(p => p.agentStats && p.agentStats.partial);
  snap.stages.stats = snap.aborted || rateLimited || anyPartial ? 'partial' : 'done';
  if (rateLimited) snap.stages.statsNote = 'Riot rate-limited match lookups — stopped early.';
  flushMatchCache();
}

function emptyStats(depth, error){
  return { gamesOnAgent: 0, winsOnAgent: 0, totalGames: 0, sampleDepth: depth,
    overallWins: 0, topAgents: [], partial: false, error: error || '' };
}

function buildAgentStats(rows, agentUuid, depth){
  const byAgent = new Map();
  let overallWins = 0;
  for (const r of rows) {
    if (r.won) overallWins++;
    const cur = byAgent.get(r.agentUuid) || { agentUuid: r.agentUuid, games: 0, wins: 0 };
    cur.games++; if (r.won) cur.wins++;
    byAgent.set(r.agentUuid, cur);
  }
  const topAgents = [...byAgent.values()].sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 3);
  const mine = byAgent.get(agentUuid);
  return {
    gamesOnAgent: mine ? mine.games : 0,
    winsOnAgent: mine ? mine.wins : 0,
    totalGames: rows.length,
    sampleDepth: depth,
    overallWins,
    topAgents,
    partial: false,
    error: '',
  };
}

const coKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Tallies, for every pair of *this* lobby's players, how many of the past matches we already
// fetched they were both in — and how many of those they were in on the same side. Free: these
// summaries were fetched for the win-rate sweep, and each one carries all ten of its own
// participants, so the enemy team's pairings fall out of matches nobody in this lobby "owns".
function noteCoPlay(co, players, summary){
  const present = players.filter(p => summary.players[p.puuid]);
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i], b = present[j];
      const cur = co.get(coKey(a.puuid, b.puuid)) || { together: 0, sameTeam: 0 };
      cur.together++;
      if (summary.players[a.puuid].teamId === summary.players[b.puuid].teamId) cur.sameTeam++;
      co.set(coKey(a.puuid, b.puuid), cur);
    }
  }
}

// Free premade signal, for the players Riot won't hand out a party id for — which, in practice,
// is everyone but you. Two rules, either of which is enough:
//
//   - they were on the SAME TEAM together in 2+ of their recent competitive matches. Meeting the
//     same stranger twice in ten games is unusual; being *drafted onto their team* twice is not
//     something matchmaking does by accident. This is the good rule, and it only exists once the
//     match-details sweep has run (a history alone is a list of ids, with no sides in it).
//   - failing that, heavy raw overlap — 3+ shared matches, sides unknown. This is the rule that
//     covers a lobby where details got rate-limited or the sweep was cut short.
//
// Everything here is flagged inferred:true so the UI says "likely" rather than stating it as fact.
function inferStacks(snap, coPlay){
  const withHistory = snap.players.filter(p => Array.isArray(p._history) && p._history.length);
  if (withHistory.length < 2) return;
  const pairs = [];
  for (let i = 0; i < withHistory.length; i++) {
    const setA = new Set(withHistory[i]._history);
    for (let j = i + 1; j < withHistory.length; j++) {
      const a = withHistory[i], b = withHistory[j];
      if (a.teamId !== b.teamId) continue;   // a party is always on one team
      const shared = b._history.filter(id => setA.has(id)).length;
      const co = coPlay ? coPlay.get(coKey(a.puuid, b.puuid)) : null;
      if ((co && co.sameTeam >= SAME_TEAM_FOR_STACK) || shared >= SHARED_FOR_STACK) {
        pairs.push([a.puuid, b.puuid]);
      }
    }
  }
  rebuildStacks(snap, pairs.length ? pairs : null);
}

/* ------------------------------------------------------------------ orchestrator */

function publicSnapshot(snap){
  // everything else is already wire-shaped; this just drops the internal scratch fields
  const { aborted, _finalRunning, _finalCancelled, _ranksRunning, _ranksNextAt, ...wire } = snap;
  return { ...wire, players: snap.players.map(({ _history, ...p }) => p) };
}

/**
 * The one entry point. Returns a wire-ready snapshot of the current lobby, or
 * { phase:'none' } when there isn't one. Throws LiveError for conditions the caller must show.
 *
 * Cost per call, once a lobby has been built: exactly one presence request. Everything else is
 * memoized against the matchId, because a coregame roster cannot change.
 */
export async function getLiveMatch(label, sess, opts = {}){
  const depth = Math.max(5, Math.min(20, Number(opts.depth) || DEFAULT_DEPTH));
  const enemyStats = opts.enemyStats !== false;

  await ensureRefData();
  const auth = await ensureLiveAuth(label, sess);
  await resolveGlzHost(auth, sess, { override: opts.region });

  const presence = await fetchPresence(auth, sess);
  const session = { shard: auth.shard, region: auth.region };

  if (presence.phase === 'none') {
    // stop any pre-match stats sweep — those are about who you were *about* to play, and that
    // question stopped mattering when the game ended
    for (const snap of snapshots.values()) snap.aborted = true;
    // ...but keep the lobby itself on screen, now with its result, until a new game replaces it
    if (lastLobby) {
      markEnded(lastLobby);
      ensureFinalScoreboard(lastLobby, auth, sess);
      lastLobby.fetchedAt = Date.now();
      return publicSnapshot(lastLobby);
    }
    return { ok: true, label, fetchedAt: Date.now(), session, phase: 'none', matchId: null, players: [] };
  }

  // Keyed by phase AND match id, because a match keeps the same id from agent select through to
  // the live game — the roster behind it does not. Pregame exposes your team and nobody else
  // (Riot doesn't reveal the enemy before the barrier drops), so a cache keyed on the id alone
  // answers every poll for the rest of the match with the five-player agent-select roster: the
  // enemy team never appears, the phase never leaves 'Agent Select', and the match ends with a
  // half-empty scoreboard. Treating the phase as part of the question makes the barrier dropping
  // a cache miss, which is exactly what it is — and carryOver() then lifts the ally ranks and
  // stats already resolved in pregame straight into the new snapshot, so the upgrade costs only
  // the five lookups that are genuinely new.
  const snapKey = `${presence.phase}:${presence.matchId}`;
  const existing = snapshots.get(snapKey);
  if (existing && !opts.refresh) {
    existing.fetchedAt = Date.now();
    // free ride on a poll that was going to cost one presence request anyway: pick up any rank
    // that a rate limit or a timeout swallowed a few seconds ago
    kickRankRetry(existing, auth, sess);
    // pregame is the one thing that legitimately changes *within* a phase: agents lock in over
    // ~90 seconds. Re-read just the agent columns; ranks and stats stay memoized.
    if (presence.phase === 'pregame') {
      const fresh = await fetchPregameRoster(auth, sess, presence.matchId);
      if (fresh) {
        for (const p of fresh.players) {
          const cur = existing.players.find(q => q.puuid === p.puuid);
          if (cur) { cur.agentUuid = p.agentUuid; cur.agentLocked = p.agentLocked; }
        }
      }
    }
    return publicSnapshot(existing);
  }

  const roster = presence.phase === 'coregame'
    ? await fetchCoreGameRoster(auth, sess, presence.matchId)
    : await fetchPregameRoster(auth, sess, presence.matchId);
  // a 404 here after a 200 presence means the match ended between the two calls
  if (!roster || !roster.players.length) {
    return { ok: true, label, fetchedAt: Date.now(), session, phase: 'none', matchId: null, players: [] };
  }

  const players = roster.players.map(p => ({
    puuid: p.puuid,
    isSelf: p.puuid === auth.puuid,
    teamId: p.teamId,
    party: null,
    name: '', tag: '',
    incognito: p.incognito,
    level: p.level, levelHidden: p.levelHidden,
    agentUuid: p.agentUuid, agentLocked: p.agentLocked,
    tier: null, rr: null, peakTier: null, peakSeason: '', peakLegacy: false,
    seasonWins: 0, seasonGames: 0, leaderboardRank: 0, rankError: '',
    badgeTier: p.badgeTier || 0, rankSource: '',
    agentStats: null, comfort: null,
    _history: null,
  }));
  carryOver(players);
  // Paint the in-match rank badge for anyone MMR hasn't answered for yet — see badgeOf(). This is
  // what puts a rank on the enemy team in the first second of a game rather than a row of dashes,
  // and what's left standing if the MMR lookup never succeeds at all.
  for (const p of players) {
    if (p.rankSource === 'mmr' || !p.badgeTier) continue;
    p.tier = p.badgeTier;
    p.rr = 0;
    p.rankSource = 'badge';
    if (!p.leaderboardRank) p.leaderboardRank = roster.players.find(q => q.puuid === p.puuid)?.badgeLeaderboard || 0;
  }

  const names = await fetchNames(auth, sess, players.map(p => p.puuid));
  for (const p of players) {
    const n = names[p.puuid];
    if (n) { p.name = n.name; p.tag = n.tag; }
  }

  const me = players.find(p => p.isSelf) || { puuid: auth.puuid, teamId: '' };
  const statsApplies = roster.mode.id === 'competitive';

  const snap = {
    ok: true, label,
    fetchedAt: Date.now(), builtAt: Date.now(),
    session,
    phase: presence.phase,
    matchId: presence.matchId,
    stages: {
      roster: 'done',
      // a badge tier is a placeholder, not an answer — 'done' means every player has a real MMR
      // reading, or the panel would stop waiting for the RR that's still on its way
      ranks: players.every(p => p.rankSource === 'mmr') ? 'done' : 'loading',
      ranksAttempts: 0, ranksPending: 0, ranksRetrying: false,
      parties: 'loading',
      stats: statsApplies ? 'loading' : 'skipped',
      statsDone: 0, statsTotal: 0, statsNote: '',
    },
    mode: roster.mode,
    map: { id: roster.mapId },
    me: { puuid: me.puuid, teamId: me.teamId },
    players,
    lobby: { ...computeLobby(players, roster.mode), stacks: [] },
    aborted: false,
  };
  rememberSnapshot(snapKey, snap);

  // Return the roster now; ranks and stats land over the next few polls. The panel paints a
  // usable lobby in well under a second rather than blocking on a minute of match lookups.
  runRanksStage(snap, auth, sess)
    .then(() => statsApplies && !snap.aborted ? runStatsStage(snap, auth, sess, { depth, enemyStats }) : null)
    .catch(err => {
      snap.stages.statsNote = (err && err.message) || String(err);
      if (snap.stages.ranks === 'loading') snap.stages.ranks = 'failed';
      if (snap.stages.stats === 'loading') snap.stages.stats = 'failed';
    });

  return publicSnapshot(snap);
}

/* ------------------------------------------------------------------ auto account detection */

// Which of several saved accounts is actually playing right now.
//
// Riot has no "who is logged in" endpoint we can reach from here, so the answer is found by
// asking each saved session whether it's in a game — the presence check is the cheapest call in
// the whole file. The cost control is that it asks about ONE account per poll rather than all of
// them: while nothing is happening there's nothing to be quick about, so idle traffic stays at a
// single request per tick no matter how many accounts are saved (with N accounts a new match is
// noticed within N ticks). Once an account IS in a game the rotation locks onto it and stops
// asking about the others entirely.
const autoState = { locked: '', cursor: 0, cooldown: new Map(), lastError: '' };
const AUTO_COOLDOWN_MS = 10 * 60 * 1000;

export function resetAutoAccount(){
  autoState.locked = ''; autoState.cursor = 0; autoState.cooldown.clear(); autoState.lastError = '';
}

export async function getLiveMatchAuto(sessions, opts = {}){
  const labels = Object.keys(sessions).filter(l => sessions[l] && sessions[l].ssid);
  if (!labels.length) throw new LiveError('no_session', 'No saved accounts. Add one first.');

  const tag = (snap, checked) => Object.assign(snap, {
    auto: { enabled: true, checked, locked: autoState.locked, accounts: labels },
  });

  if (labels.length === 1) return tag(await getLiveMatch(labels[0], sessions[labels[0]], opts), labels[0]);

  const now = Date.now();
  const usable = labels.filter(l => !(autoState.cooldown.get(l) > now));
  if (!usable.length) {
    throw new LiveError('session_expired',
      autoState.lastError || 'Every saved Valorant session has expired — save a fresh cookie for at least one account.');
  }

  // A dead session mustn't be retried every few seconds just because it's next in the rotation;
  // park it for a while and keep looking at the others. Anything else (network, region) is about
  // us rather than this account, so it propagates.
  const probe = async (label) => {
    try {
      const snap = await getLiveMatch(label, sessions[label], opts);
      autoState.cooldown.delete(label);
      return snap;
    } catch (err) {
      if (err && (err.code === 'session_expired' || err.code === 'no_session')) {
        autoState.cooldown.set(label, Date.now() + AUTO_COOLDOWN_MS);
        autoState.lastError = err.message;
        return null;
      }
      throw err;
    }
  };

  // 1. stay on whoever was already in a game — this is the steady state, and it's one request.
  //    Only a *live* phase holds the lock: an 'ended' snapshot is the previous game being kept
  //    on screen, and staying locked to it would mean never noticing the next one.
  if (autoState.locked && usable.includes(autoState.locked)) {
    const snap = await probe(autoState.locked);
    if (snap && isLivePhase(snap.phase)) return tag(snap, autoState.locked);
    autoState.locked = '';
    // that account just left a game. Spend one extra request checking the next one right away
    // rather than making a smurf-swap wait a whole rotation to be noticed.
  }

  // 2. otherwise ask about exactly one account, moving through them in turn
  const pool = usable.filter(l => l !== autoState.locked);
  if (!pool.length) return tag({ ok: true, label: '', fetchedAt: Date.now(), phase: 'none', matchId: null, players: [] }, '');
  autoState.cursor = (autoState.cursor + 1) % pool.length;
  const label = pool[autoState.cursor];
  const snap = await probe(label);
  // a parked account mustn't wipe the game you just finished off the screen
  if (!snap) {
    const kept = getLastLobby();
    if (kept && kept.phase === 'ended') return tag(publicSnapshot(kept), label);
    return tag({ ok: true, label, fetchedAt: Date.now(), phase: 'none', matchId: null, players: [] }, label);
  }
  if (isLivePhase(snap.phase)) autoState.locked = label;
  return tag(snap, label);
}

/* ------------------------------------------------------------------ CLI */

const TIER_NAMES = ['Unranked', '', '', 'Iron 1', 'Iron 2', 'Iron 3', 'Bronze 1', 'Bronze 2', 'Bronze 3',
  'Silver 1', 'Silver 2', 'Silver 3', 'Gold 1', 'Gold 2', 'Gold 3', 'Platinum 1', 'Platinum 2', 'Platinum 3',
  'Diamond 1', 'Diamond 2', 'Diamond 3', 'Ascendant 1', 'Ascendant 2', 'Ascendant 3',
  'Immortal 1', 'Immortal 2', 'Immortal 3', 'Radiant'];
const tierName = t => (t == null ? '—' : (TIER_NAMES[t] || `Tier ${t}`));

async function main(){
  const sessions = loadSessions();
  const labels = Object.keys(sessions);
  if (!labels.length) {
    console.error('No saved accounts. Run `node scripts/valorant-login.mjs <label>` first.');
    process.exit(1);
  }
  const label = process.argv[2] || '';
  if (label && !(sessions[label] && sessions[label].ssid)) {
    console.error(`No saved session for "${label}". Known accounts: ${labels.join(', ')}`);
    process.exit(1);
  }

  let snap;
  try {
    if (label) {
      snap = await getLiveMatch(label, sessions[label]);
    } else {
      // no account named: find whichever one is playing. getLiveMatchAuto() checks one per call
      // by design (it's built for a poll loop), so from a one-shot CLI just turn the rotation
      // enough times to have asked about all of them.
      for (let i = 0; i < labels.length; i++) {
        snap = await getLiveMatchAuto(sessions);
        if (snap.phase !== 'none') break;
      }
    }
  } catch (err) {
    console.error(`${err.code ? `[${err.code}] ` : ''}${err.message}`);
    process.exit(1);
  }

  const shown = snap.label || label || '(none)';
  console.log(`Account "${shown}"${snap.session ? ` — shard ${snap.session.shard}, region ${snap.session.region}` : ''}`);
  if (snap.auto && snap.auto.accounts.length > 1) {
    console.log(`(auto-detect across ${snap.auto.accounts.length} saved accounts — pass a label to pin one)`);
  }
  if (snap.phase === 'none') { console.log('Not in a match.'); flushMatchCache(); return; }

  // the HTTP route hands the roster back immediately and lets the browser poll for the rest; from
  // a terminal there is nothing to poll, so wait for the background stages to settle
  const live = getLiveSnapshot(snap.matchId);
  const deadline = Date.now() + 180000;
  while (live && Date.now() < deadline &&
         (live.stages.ranks === 'loading' || live.stages.stats === 'loading' ||
          (live.final && live.final.state === 'pending'))) {
    await sleep(500);
  }
  snap = publicSnapshot(getLiveSnapshot(snap.matchId) || snap);

  const phaseTxt = snap.phase === 'pregame' ? 'Agent Select' : (snap.phase === 'ended' ? 'FINAL' : 'In Game');
  console.log(`${snap.mode.label} · ${phaseTxt} · ${snap.map.id.split('/').pop() || '?'}`);

  const final = snap.final && snap.final.state === 'done' ? snap.final : null;
  const finalBy = new Map((final ? final.rows : []).map(r => [r.puuid, r]));
  if (snap.phase === 'ended') {
    if (final) {
      if (snap.mode.teamBased) {
        const scores = Object.entries(final.teams).map(([, t]) => t.roundsWon).sort((a, b) => b - a);
        const result = final.myTeamWon == null ? 'Result unknown' : (final.myTeamWon ? 'VICTORY' : 'DEFEAT');
        console.log(`${result}${scores.length >= 2 ? ` ${scores[0]}-${scores[1]}` : ''}`);
      } else if (final.place) {
        console.log(`You placed ${final.place} of ${final.rows.length}`);
      }
    } else if (snap.final) {
      console.log(snap.final.note || 'Waiting for Riot to publish the scoreboard…');
    }
  }
  if (snap.lobby.rankedCount) {
    console.log(`Lobby avg ≈ ${tierName(snap.lobby.avgTierFloor)} (${snap.lobby.avgTierRr} RR) — ${snap.lobby.rankedCount} of ${snap.players.length} ranked`);
    const hi = snap.players.find(p => p.puuid === snap.lobby.highest.puuid);
    console.log(`Highest: ${hi ? `${hi.name}#${hi.tag}` : '?'} — ${tierName(snap.lobby.highest.tier)} (${snap.lobby.highest.rr} RR)`);
  }
  console.log('');

  // once there's a scoreboard it decides the order — that's what a standing is
  const rows = snap.players.slice().sort((a, b) => {
    if (final) {
      const ra = finalBy.get(a.puuid), rb = finalBy.get(b.puuid);
      if (!snap.mode.teamBased) return (ra ? ra.place : 99) - (rb ? rb.place : 99);
      const side = (a.teamId === snap.me.teamId ? 0 : 1) - (b.teamId === snap.me.teamId ? 0 : 1);
      return side || ((rb ? rb.score : 0) - (ra ? ra.score : 0));
    }
    return (a.teamId === snap.me.teamId ? 0 : 1) - (b.teamId === snap.me.teamId ? 0 : 1) || (b.tier || 0) - (a.tier || 0);
  });
  for (const p of rows) {
    const r = finalBy.get(p.puuid);
    const side = snap.mode.teamBased ? (p.teamId === snap.me.teamId ? 'ALLY ' : 'ENEMY') : (r && r.place ? `#${String(r.place).padEnd(4)}` : '     ');
    const who = p.incognito ? '(incognito)' : `${p.name}#${p.tag}`;
    const stack = p.party ? ` [${p.party.inferred ? '~' : ''}${p.party.group}${p.party.size}]` : '';
    // "(badge)" rather than "0RR": that tier came off the match's own rank badge, which has no RR
    const rank = p.rankSource === 'badge'
      ? `${tierName(p.tier)} (badge)`
      : `${tierName(p.tier)}${p.rr != null ? ` ${p.rr}RR` : ''}`;
    let tail = '';
    if (r) {
      tail = ` · ${r.kills}/${r.deaths}/${r.assists}${snap.mode.teamBased ? ` (${r.score} acs)` : ''}`;
    } else if (p.agentStats && p.comfort) {
      const s = p.agentStats;
      const wr = s.gamesOnAgent >= 3 ? ` ${Math.round(s.winsOnAgent / s.gamesOnAgent * 100)}%` : '';
      tail = ` · ${p.comfort.label} (${s.winsOnAgent}-${s.gamesOnAgent - s.winsOnAgent}${wr})`;
    }
    console.log(`${side} ${(p.isSelf ? '> ' : '  ')}${who.padEnd(22)}${stack.padEnd(6)} ${rank.padEnd(18)} peak ${tierName(p.peakTier).padEnd(12)}${tail}`);
  }
  flushMatchCache();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(err => { console.error(err); flushMatchCache(); process.exit(1); });
}
