#!/usr/bin/env node
// scripts/tft-live.mjs
//
// Live lobby tracker for Teamfight Tactics: who the other seven players in the game you are in
// RIGHT NOW are, and — the point of the thing — how high each of them has ever climbed. A Silver
// lobby with a former Challenger in it plays nothing like a Silver lobby, and the in-game
// scoreboard only ever shows you names.
//
// This runs LOCALLY, driven by scripts/valorant-local-server.mjs's POST /tft-live route, which the
// TFT panel polls while it is open. It can also be run straight from a terminal:
//
//   node scripts/tft-live.mjs
//
// It has to be local, but for a completely different reason than the Valorant scripts next to it.
// Nothing here touches Riot's auth endpoints, replays a session, or authenticates as anybody — the
// two halves are:
//
//   1. The League/TFT client's own loopback API (the "LCU"), which is how the roster is known at
//      all. It is only reachable from this machine, its port and password live in a lockfile only
//      a local process can read, and it serves a self-signed certificate — so a web page simply
//      cannot call it, no matter where that page is hosted. Every call made here is a GET.
//   2. MetaTFT's public profile API, the same third-party index js/tft.js already syncs from.
//      That half needs no helper and could run in the browser; it runs here so one poll is one
//      request from the page instead of nine.
//
// Nothing here is ever written to disk or to Supabase. A lobby is other people's accounts and is
// meaningless ten minutes later — it lives in this process's memory and is thrown away, the same
// ruling as valorant-live.mjs and state.valorant.live.
//
// No npm dependencies — nothing in scripts/ needs `npm install`.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ tunables */

const ROSTER_TTL_MS = 60 * 60 * 1000;  // a lobby's roster is fixed for the whole game; this is
                                       // only a ceiling so a forgotten game can't pin memory
const RANK_TTL_MS = 10 * 60 * 1000;    // how long a player's MetaTFT ranks are reused
const RANK_CONCURRENCY = 4;            // parallel MetaTFT lookups per lobby
const LCU_TIMEOUT = 5000;
const META_TIMEOUT = 8000;

const METATFT_API = 'https://api.metatft.com/public';
// Ranked standard. MetaTFT keys rating history by queue, and 1160 (Double Up) is a separate
// ladder with four teams instead of eight — mixing it in would misreport a player's peak. Same
// constant, same reason, as TFT_RANKED_QUEUE in js/tft.js.
const RANKED_QUEUE = '1100';

/* The lockfile is written by whichever client is running and deleted when it exits, so its mere
   presence is the "is the client up?" test. Two candidates because Riot is midway through
   splitting TFT out of the League client into its own TFTClient.exe — a machine can have either,
   or both installed and only one running. TFT_LCU_LOCKFILE overrides for a non-default install
   drive, which is the case this list cannot enumerate. */
function lockfileCandidates(){
  const out = [];
  if (process.env.TFT_LCU_LOCKFILE) out.push(process.env.TFT_LCU_LOCKFILE);
  const roots = [
    'C:\\Riot Games', 'D:\\Riot Games', 'E:\\Riot Games',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Riot Games') : null,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Riot Games') : null,
  ].filter(Boolean);
  for (const root of roots) {
    out.push(path.join(root, 'Teamfight Tactics', 'Live', 'lockfile'));
    out.push(path.join(root, 'Teamfight Tactics', 'lockfile'));
    out.push(path.join(root, 'League of Legends', 'lockfile'));
  }
  // macOS, for completeness — the rest of scripts/ is Windows-first but nothing here is
  if (process.platform === 'darwin') {
    out.push('/Applications/League of Legends.app/Contents/LoL/lockfile');
  }
  return out;
}

class TftLiveError extends Error {
  constructor(code, message){ super(message); this.code = code; }
}

/* Read the first lockfile that exists AND parses. A stale file left behind by a crash is the
   normal failure here, and it looks identical to a live one — it is only caught later, when the
   port refuses the connection, which is why connectLcu() turns that into 'client_closed' rather
   than an error the user is asked to act on. */
function readLockfile(){
  for (const file of lockfileCandidates()) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    // name:pid:port:password:protocol
    const parts = raw.trim().split(':');
    if (parts.length < 5) continue;
    const port = Number(parts[2]);
    if (!port || !parts[3]) continue;
    return { file, port, password: parts[3], protocol: parts[4] };
  }
  return null;
}

/* The LCU serves a self-signed certificate, so its own agent turns verification off. This is
   deliberately scoped to this one agent rather than done with NODE_TLS_REJECT_UNAUTHORIZED=0,
   which would also disable it for the MetaTFT calls below — and for anything else sharing the
   local server's process. */
const lcuAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function lcuGet(lock, apiPath){
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1',
      port: lock.port,
      path: apiPath,
      method: 'GET',
      agent: lcuAgent,
      headers: {
        Authorization: 'Basic ' + Buffer.from('riot:' + lock.password).toString('base64'),
        Accept: 'application/json',
      },
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* non-JSON bodies are all errors here */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.setTimeout(LCU_TIMEOUT, () => { req.destroy(new Error('timed out')); });
    req.on('error', reject);
    req.end();
  });
}

/* Turn "is there a client and will it talk to us" into one answer. A missing lockfile and a
   lockfile whose port is dead are the same thing to the user — the client isn't running — so both
   come back as 'client_closed' rather than as an error to be fixed. */
async function connectLcu(){
  const lock = readLockfile();
  if (!lock) throw new TftLiveError('client_closed', 'The League / TFT client isn\'t running on this machine.');
  try {
    const me = await lcuGet(lock, '/lol-summoner/v1/current-summoner');
    if (me.status === 401) throw new TftLiveError('lcu_auth', 'The client rejected the lockfile credentials — restart the client.');
    if (!me.json || !me.json.puuid) throw new TftLiveError('client_closed', 'The client is starting up but isn\'t signed in yet.');
    return { lock, me: me.json };
  } catch (err) {
    if (err instanceof TftLiveError) throw err;
    // ECONNREFUSED against a lockfile that exists = the file is stale
    throw new TftLiveError('client_closed', 'The League / TFT client isn\'t running on this machine.');
  }
}

/* The platform code the rest of this file looks profiles up with. It is the client's own answer,
   so it can't drift from the account actually playing — and it is the same vocabulary
   TFT_REGIONS uses in js/tft.js ('sg2', not the 'sea' MetaTFT shows in its URLs). */
async function readRegion(lock){
  try {
    const r = await lcuGet(lock, '/riotclient/region-locale');
    const reg = r.json && r.json.region;
    if (typeof reg === 'string' && reg) return reg.toLowerCase();
  } catch { /* fall through — the caller's configured region is a fine default */ }
  return '';
}

/* ---------------------------------------------------------------- the roster */

/* Every phase the client reports, reduced to the three this panel distinguishes. The names are
   the LCU's own. 'Reconnect' is in the in-game list on purpose: it is what the client says when
   a game is running that you are not currently attached to, which is exactly when someone is most
   likely to be looking at this panel on a second screen. */
const PHASE_INGAME = new Set(['GameStart', 'InProgress', 'Reconnect']);
const PHASE_LOBBY = new Set(['Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect']);
const PHASE_ENDED = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);

/* Pull the eight players out of a gameflow session.

   Two shapes carry them and they do not always both arrive: `teamOne` is the richer record (it
   also carries summonerId) but is empty in some phases, while `playerChampionSelections` is
   populated as soon as the game exists. Read both and take whichever has puuids — for TFT all
   eight sit on teamOne, since there are no two sides. */
function rosterPuuids(gameData){
  const fromTeams = []
    .concat(gameData.teamOne || [], gameData.teamTwo || [])
    .map(p => p && p.puuid)
    .filter(Boolean);
  if (fromTeams.length) return Array.from(new Set(fromTeams));
  return Array.from(new Set(
    (gameData.playerChampionSelections || []).map(p => p && p.puuid).filter(Boolean)
  ));
}

/* Resolve one LCU puuid to a Riot ID.

   This step is what makes the whole feature work, and it is not optional. The client reports
   puuids in UUID form (3d6b9381-c711-…), while MetaTFT indexes profiles under Riot's *encrypted*
   puuid (vjRP7aB2K7d0ei7…) — the same account, two different identifiers, and there is no way to
   convert one into the other. So the roster is turned into Riot IDs here, using the client's own
   name lookup, and MetaTFT is asked by Riot ID instead. Don't "simplify" this into a
   lookup_by_puuid call: it answers 404 for every player in the lobby. */
async function resolveRiotId(lock, puuid){
  const r = await lcuGet(lock, '/lol-summoner/v2/summoners/puuid/' + encodeURIComponent(puuid));
  const s = r.json;
  if (!s || !s.gameName) return null;
  return {
    puuid,
    name: s.gameName,
    tag: s.tagLine || '',
    level: s.summonerLevel || 0,
    // Riot lets an account hide its profile; MetaTFT honours that, so the lookup below will come
    // back empty and the row says so rather than looking like a failed fetch
    hidden: !!s.is_profile_hidden || s.privacy === 'PRIVATE',
  };
}

/* ------------------------------------------------------- MetaTFT rank lookups */

async function metaFetch(url){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), META_TIMEOUT);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* One player's ranks, reduced to the three facts the panel shows.

   MetaTFT's profile carries `rating_history` keyed by set — TFTSet14, TFTSet15, … — and each set
   holds, per queue, both where the player finished and `peak_rating`, the highest they ever got
   that set. That is where "peak rank" comes from; it is a stored fact on their side, not
   something reconstructed from a match list, so it reaches back through sets this app never saw.

   Three values come out, and each answers a different question:
     cur      where they are now      — newest set they have played
     setPeak  their peak THIS set     — how far they have already fallen, if at all
     best     their peak EVER         — the smurf detector, and the headline

   `rating_text` is passed through verbatim rather than parsed here. js/tft.js already owns the
   ladder (TFT_TIERS, tftParseRatingText()) and needs the tier key anyway to pick a crest and a
   colour, so parsing here would mean two tables that have to agree. */
async function fetchPlayerRanks(region, name, tag){
  const url = METATFT_API + '/profile/lookup_by_riotid/'
    + encodeURIComponent(region) + '/' + encodeURIComponent(name) + '/' + encodeURIComponent(tag);
  const res = await metaFetch(url);
  if (res.status === 404) return { found: false, queued: true };
  if (!res.ok) return { found: false };
  const prof = await res.json();
  const hist = (prof && prof.rating_history) || {};

  const sets = Object.keys(hist).filter(k => hist[k] && hist[k][RANKED_QUEUE]);
  if (!sets.length) return { found: true, unranked: true };

  /* "Now" is the most recently *touched* set, not the highest-numbered one. Sorting by the
     record's own timestamp rather than by set name gets that right without having to know which
     set is live, and it keeps working through Riot's mid-set naming (TFTSet9_2, TFTSet8_2) that
     no numeric sort orders correctly. */
  const newest = sets
    .slice()
    .sort((a, b) => String(hist[a][RANKED_QUEUE].timestamp || '').localeCompare(String(hist[b][RANKED_QUEUE].timestamp || '')))
    .pop();
  const curRow = hist[newest][RANKED_QUEUE];

  let best = null;
  for (const k of sets) {
    const row = hist[k][RANKED_QUEUE];
    // pre-Set 9 records carry a rating but no peak — skip rather than treat the final rating as
    // one, which would understate an old account's real high
    if (!row.peak_rating || !row.peak_rating_numeric) continue;
    if (!best || row.peak_rating_numeric > best.numeric) {
      best = { text: row.peak_rating, numeric: row.peak_rating_numeric, set: k };
    }
  }

  return {
    found: true,
    cur: { text: curRow.rating_text || '', numeric: curRow.rating_numeric || 0, set: newest, games: curRow.num_games || 0 },
    setPeak: curRow.peak_rating ? { text: curRow.peak_rating, numeric: curRow.peak_rating_numeric || 0, set: newest } : null,
    best,
  };
}

/* Ranks are cached by account rather than by lobby: you meet the same people repeatedly on a
   ladder, and a player's peak does not move inside a ten-minute window. Keyed by region too, so
   the same Riot ID on two shards can't collide. */
const rankCache = new Map();
async function cachedRanks(region, p){
  const key = region + '/' + p.name.toLowerCase() + '#' + p.tag.toLowerCase();
  const hit = rankCache.get(key);
  if (hit && (Date.now() - hit.at) < RANK_TTL_MS) return hit.value;
  let value;
  try {
    value = await fetchPlayerRanks(region, p.name, p.tag);
  } catch {
    // a failed lookup is NOT cached — the next poll should try again, and caching the failure
    // would leave the row blank for the rest of the game
    return { found: false, error: true };
  }
  rankCache.set(key, { at: Date.now(), value });
  return value;
}

async function mapLimited(items, limit, fn){
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

/* ----------------------------------------------------------------- the lobby */

/* One resolved roster per gameId. The eight players in a TFT game cannot change once it has
   started, so the LCU name lookups and the MetaTFT calls behind them run exactly once per game
   however long the panel is left open — the same memoization, for the same reason, that
   valorant-live.mjs applies to a coregame roster. */
const rosterCache = new Map();
function pruneRosters(){
  const now = Date.now();
  for (const [k, v] of rosterCache) if (now - v.at > ROSTER_TTL_MS) rosterCache.delete(k);
}

const EMPTY = phase => ({ ok: true, fetchedAt: Date.now(), phase, players: [] });

/**
 * The current TFT lobby, or { phase:'none' } when there isn't one.
 * Throws TftLiveError for the conditions the page has to show the user.
 */
export async function getTftLobby(opts = {}){
  pruneRosters();
  const { lock, me } = await connectLcu();

  const phaseRes = await lcuGet(lock, '/lol-gameflow/v1/gameflow-phase');
  const rawPhase = typeof phaseRes.json === 'string' ? phaseRes.json : 'None';
  if (!PHASE_INGAME.has(rawPhase) && !PHASE_LOBBY.has(rawPhase) && !PHASE_ENDED.has(rawPhase)) {
    return Object.assign(EMPTY('none'), { rawPhase });
  }

  const sessRes = await lcuGet(lock, '/lol-gameflow/v1/session');
  const gd = sessRes.json && sessRes.json.gameData;
  if (!gd) return Object.assign(EMPTY('none'), { rawPhase });

  const queue = gd.queue || {};
  /* Gate on the game MODE, not on a list of queue ids. TFT ships new ranked-adjacent queues
     regularly (Hyper Roll, Double Up, the rotating cabinet modes) and a queue-id allowlist would
     silently show nothing the first week of each. Everything with gameMode 'TFT' is a lobby worth
     showing; whether it is the ranked ladder is reported separately. */
  if (queue.gameMode !== 'TFT') {
    return Object.assign(EMPTY('other-game'), { rawPhase, queueName: queue.name || '' });
  }

  const puuids = rosterPuuids(gd);
  if (!puuids.length) return Object.assign(EMPTY(PHASE_LOBBY.has(rawPhase) ? 'queued' : 'none'), { rawPhase });

  const phase = PHASE_INGAME.has(rawPhase) ? 'ingame' : (PHASE_ENDED.has(rawPhase) ? 'ended' : 'queued');
  const region = (await readRegion(lock)) || opts.region || '';
  const gameId = gd.gameId || 0;
  const cacheKey = gameId + ':' + region;

  let entry = rosterCache.get(cacheKey);
  if (opts.refresh) { rankCache.clear(); entry = null; }
  if (!entry) {
    const people = (await mapLimited(puuids, RANK_CONCURRENCY, p => resolveRiotId(lock, p).catch(() => null)))
      .filter(Boolean);
    entry = { at: Date.now(), people };
    rosterCache.set(cacheKey, entry);
  }

  const players = await mapLimited(entry.people, RANK_CONCURRENCY, async person => {
    const row = {
      name: person.name,
      tag: person.tag,
      riotId: person.name + '#' + person.tag,
      level: person.level,
      self: person.puuid === me.puuid,
      hidden: person.hidden,
      found: false,
    };
    if (person.hidden || !region) return row;
    const ranks = await cachedRanks(region, person);
    return Object.assign(row, ranks);
  });

  return {
    ok: true,
    fetchedAt: Date.now(),
    phase,
    rawPhase,
    gameId,
    region,
    queueId: queue.id || 0,
    queueName: queue.name || 'Teamfight Tactics',
    ranked: queue.type === 'RANKED_TFT' || queue.id === 1100,
    self: me.gameName ? (me.gameName + '#' + me.tagLine) : '',
    players,
  };
}

export { TftLiveError };

/* Terminal use: node scripts/tft-live.mjs — the same one-shot the route serves, printed. */
// Same entry test as valorant-live.mjs, so importing this from the local server can't run it.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  getTftLobby({ refresh: true })
    .then(snap => {
      if (snap.phase === 'none') { console.log('No TFT game in progress.'); return; }
      if (snap.phase === 'other-game') { console.log('In a game, but not TFT' + (snap.queueName ? ` (${snap.queueName})` : '') + '.'); return; }
      console.log(`${snap.queueName} · ${snap.region} · ${snap.players.length} players · ${snap.phase}`);
      snap.players
        .slice()
        .sort((a, b) => ((b.best && b.best.numeric) || 0) - ((a.best && a.best.numeric) || 0))
        .forEach(p => {
          const mark = p.self ? '>>' : '  ';
          const peak = p.best ? `${p.best.text} (${p.best.set})` : (p.hidden ? 'profile hidden' : '—');
          const now = p.cur ? `${p.cur.text} · ${p.cur.games}g` : '—';
          console.log(`${mark} ${p.riotId.padEnd(24)} peak ${peak.padEnd(28)} now ${now}`);
        });
    })
    .catch(err => {
      console.error(err instanceof TftLiveError ? `${err.code}: ${err.message}` : err);
      process.exitCode = 1;
    });
}
