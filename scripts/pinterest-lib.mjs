// scripts/pinterest-lib.mjs
//
// Reads YOUR Pinterest home feed — the algorithmic one you see at pinterest.com when you're
// signed in, with the pins from accounts and topics Pinterest picks for you.
//
// Why this is local-only, and not another Edge Function like pinterest-feed:
//
//   The home feed is the one Pinterest surface with no public route at all. Its official API has
//   189 endpoints and not one of them returns it (checked against Pinterest's own OpenAPI spec):
//   /search/pins searches only your OWN pins, and there is no recommendations, related or feed
//   resource. The pidgets JSON the Edge Function uses is public precisely because it serves
//   embeddable widgets, and a personalised feed is not embeddable. So the only thing that can
//   read your home feed is something holding your logged-in session.
//
//   That session cookie is full account access — it can pin, unpin, follow, message and change
//   your account. This app's shared Supabase row is UNAUTHENTICATED (see README's "Persistence"),
//   so a cookie of that power must never go into `state`, never into a Supabase row, and never
//   through an Edge Function. It lives in one gitignored file on the machine you signed in on and
//   is read by a process running as you. That is the same ruling already recorded for the Riot
//   session in scripts/valorant-lib.mjs, for the same reason and with the same file layout.
//
// What it talks to: www.pinterest.com/resource/UserHomefeedResource/get/, which is the exact
// call the website's own front end makes to fill the page. It is undocumented and can change
// without notice — hence every read here is defensive, and a failure degrades to "the app falls
// back to the public pidgets path" rather than to an error.
//
// Nothing here writes anything to Pinterest. Every request is a GET, and the only resource
// touched is the feed itself.
//
// Usage (standalone, no server involved):
//   node scripts/pinterest-login.mjs          save a session by pasting cookies
//   node scripts/pinterest-feed.mjs           print what the feed returns, to check it works
//
// No npm dependencies — nothing in scripts/ needs `npm install`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SESSION_FILE = path.join(__dirname, '.pinterest-session.json');

const HOME_FEED_URL = 'https://www.pinterest.com/resource/UserHomefeedResource/get/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;

// Pinterest pages this feed with an opaque `bookmark` rather than an offset, so unlike every other
// source in this feature it is not capped at one window — you can keep asking. These two bound
// how far one refresh walks: enough for the collection's 25 picks many times over, without
// hammering a private endpoint for pins that get thrown away.
const PAGE_SIZE = 50;
const MAX_PAGES = 6;

// The two cookies that actually matter. The whole pinterest.com jar is stored (the Riot ruling:
// save what you were handed, so a new requirement needs no code change), but these are the two
// whose absence means "this isn't a signed-in session" rather than "this might still work".
const REQUIRED_COOKIES = ['_pinterest_sess'];

// Pinterest sets `_pinterest_sess` and `csrftoken` for signed-OUT visitors too — they are the
// session, not the login — so their presence says nothing about being logged in. `_auth` is the
// flag that does: "1" signed in, "0" not. Checking it is what stops a jar scraped a moment too
// early (or from a window where the sign-in never completed) being saved as though it worked.
export function looksSignedIn(cookies){
  return !!cookies && cookies._auth === '1' && !!cookies._pinterest_sess;
}

/* ---------- the session file ---------- */

export function loadSession(){
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (raw && typeof raw === 'object' && raw.cookies && typeof raw.cookies === 'object') return raw;
  } catch { /* absent or unreadable — treated as "no session", never as an error */ }
  return null;
}

export function saveSession(cookies, meta = {}){
  const jar = {};
  for (const [k, v] of Object.entries(cookies || {})) {
    // Cookie names/values go straight into a request header, so anything with a separator in it
    // could inject a second cookie or a second header line. Drop rather than escape: a cookie
    // that needs escaping is not one Pinterest set.
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k)) continue;
    if (typeof v !== 'string' || !v || /[;\r\n]/.test(v)) continue;
    jar[k] = v;
  }
  for (const need of REQUIRED_COOKIES) {
    if (!jar[need]) throw new Error(`That cookie set has no "${need}" — it isn't a signed-in Pinterest session.`);
  }
  const rec = { cookies: jar, savedAt: Date.now(), ...meta };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(rec, null, 2));
  // The file holds a live login. 0600 where the platform honours it; Windows inherits the
  // directory ACL, which is already per-user.
  try { fs.chmodSync(SESSION_FILE, 0o600); } catch { /* best effort */ }
  return rec;
}

export function deleteSession(){
  try { fs.rmSync(SESSION_FILE, { force: true }); return true; } catch { return false; }
}

export function sessionStatus(){
  const s = loadSession();
  if (!s) return { saved: false };
  return { saved: true, savedAt: s.savedAt || 0, username: s.username || '' };
}

function cookieHeader(session){
  return Object.entries(session.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

/* ---------- the feed ---------- */

// One page of the home feed. Returns { pins, bookmark } or throws. The thrown errors carry a
// `code` so the caller can tell "you need to sign in again" (which the app should say out loud)
// from "Pinterest is being difficult" (which it should ride out quietly).
async function fetchHomeFeedPage(session, bookmark){
  const options = {
    // What the site's own front end sends. `static_feed:false` is what asks for the personalised
    // feed rather than a canned one; the field set decides how fat each pin record comes back.
    field_set_key: 'hf_grid',
    in_nux: false,
    prependPartner: false,
    static_feed: false,
    page_size: PAGE_SIZE,
    ...(bookmark ? { bookmarks: [bookmark] } : {}),
  };
  const qs = new URLSearchParams({
    source_url: '/',
    data: JSON.stringify({ options, context: {} }),
  });

  let resp;
  try {
    resp = await fetch(`${HOME_FEED_URL}?${qs}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/javascript, */*, q=0.01',
        'Cookie': cookieHeader(session),
        // Pinterest refuses a resource call that doesn't look like its own front end's XHR. The
        // CSRF header must echo the csrftoken COOKIE — that pairing is the whole check, and it is
        // why the cookie jar has to be saved whole rather than just the session id.
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': session.cookies.csrftoken || '',
        'X-Pinterest-PWS-Handler': 'www/index.js',
        'X-APP-VERSION': 'ea8ac91',
        'Referer': 'https://www.pinterest.com/',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const e = new Error(`Couldn't reach Pinterest: ${(err && err.message) || err}`);
    e.code = 'network';
    throw e;
  }

  // A signed-out session is bounced to the login page rather than refused outright, so a redirect
  // is the expired-session signal — the same shape as Riot's 303 to authenticate.riotgames.com.
  if (resp.status >= 300 && resp.status < 400) {
    const e = new Error('Your Pinterest session has expired — sign in again to refresh it.');
    e.code = 'expired';
    throw e;
  }
  if (resp.status === 401 || resp.status === 403) {
    const e = new Error('Pinterest refused the session — it has expired or been signed out elsewhere.');
    e.code = 'expired';
    throw e;
  }
  if (!resp.ok) {
    const e = new Error(`Pinterest answered ${resp.status}.`);
    e.code = 'http';
    throw e;
  }

  let body;
  try { body = await resp.json(); }
  catch {
    // An HTML body on a 200 means we were served the login page — same meaning as the redirect.
    const e = new Error('Pinterest returned a page instead of feed data — the session is probably expired.');
    e.code = 'expired';
    throw e;
  }

  const rr = body && body.resource_response;
  const data = rr && Array.isArray(rr.data) ? rr.data : null;
  if (!data) {
    const e = new Error('Pinterest returned an unexpected shape for the home feed.');
    e.code = 'shape';
    throw e;
  }
  return { pins: data, bookmark: (rr.bookmark || '') };
}

// Walks up to MAX_PAGES of the feed and returns normalized pin records. `wanted` stops the walk
// early once there are plainly enough — the collection keeps 25, so there is no reason to pull six
// pages when two answered the question.
export async function getHomeFeed({ wanted = 150, keywords = [], exclude = [], session: given = null } = {}){
  // `session` is passed in when a candidate jar is being TESTED rather than used: nothing may be
  // written to disk until it has proved it can read the feed. Saving first and verifying after is
  // what left a signed-OUT jar sitting in the session file, which then presented as "expired" on
  // every refresh while the collection quietly fell back to the public path.
  const session = given || loadSession();
  if (!session) {
    const e = new Error('No Pinterest session saved on this machine yet.');
    e.code = 'no_session';
    throw e;
  }

  const include = parseTerms(keywords);
  const block = parseTerms(exclude);
  const out = [];
  const seen = new Set();
  let bookmark = '';
  let pagesRead = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { pins, bookmark: next } = await fetchHomeFeedPage(session, bookmark);
    pagesRead++;
    for (const raw of pins) {
      const rec = normalizeFeedPin(raw);
      if (!rec || seen.has(rec.pinId)) continue;
      seen.add(rec.pinId);
      out.push(rec);
    }
    // "-end-" is what Pinterest sends when there is nothing after this page.
    if (!next || next === '-end-') break;
    bookmark = next;
    if (filterFeedPins(out, include, block).length >= wanted) break;
  }

  const kept = filterFeedPins(out, include, block);
  return {
    // A filter that matches nothing falls back to the unfiltered feed rather than emptying the
    // collection — the same ruling the Edge Function's `matched: 0` carries.
    pins: kept.length ? kept : out,
    total: out.length,
    matched: kept.length,
    pages: pagesRead,
  };
}

// Proves a candidate jar before anything is written. Returns the number of pins it could read.
// Throws with a `code` the caller can show: `signed_out` is a different sentence from `expired`.
export async function verifySession(cookies){
  // `_auth: '0'` is a definite no, and worth its own sentence — it is what a jar scraped before the
  // sign-in finished looks like. Its ABSENCE proves nothing (the paste path only ever has the two
  // cookies you can see in DevTools), so that case falls through to the real read, which is the
  // actual proof either way.
  if (cookies && cookies._auth === '0') {
    const e = new Error('Those cookies are from a signed-out Pinterest session (_auth=0) — the sign-in had not finished.');
    e.code = 'signed_out';
    throw e;
  }
  if (!cookies || !cookies._pinterest_sess) {
    const e = new Error('No _pinterest_sess cookie in that set.');
    e.code = 'signed_out';
    throw e;
  }
  const probe = await getHomeFeed({ wanted: 1, session: { cookies } });
  if (!probe.total) {
    const e = new Error('Signed in, but the home feed came back empty.');
    e.code = 'empty';
    throw e;
  }
  return probe.total;
}

/* ---------- normalising ---------- */

// Into the exact record shape supabase/functions/pinterest-feed emits, so js/motivation.js can't
// tell the two sources apart and nothing downstream — the picker, the video resolve, Saved Pins —
// needs to know which one answered.
function normalizeFeedPin(raw){
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;

  // A promoted pin is an advert. The home feed carries them inline; a slideshow you look at every
  // morning is the last place they belong.
  if (raw.is_promoted || raw.is_promoted_by_pinner || raw.ad_match_reason) return null;

  const images = raw.images || {};
  let src = '';
  for (const key of ['736x', '564x', '474x', '236x', 'orig']) {
    const u = images[key] && images[key].url;
    if (typeof u === 'string' && u) { src = u; break; }
  }
  const m = src.match(/^https:\/\/i\.pinimg\.com\/(?:\d+x|originals)\/([A-Za-z0-9/._-]+)$/);
  if (!m) return null;
  const imgPath = m[1];

  const link = `https://www.pinterest.com/pin/${id}/`;
  const desc = clean(raw.grid_title || raw.description || raw.auto_alt_text || '');
  const boardName = clean((raw.board && raw.board.name) || '');
  return {
    id: link,
    url: `https://i.pinimg.com/736x/${imgPath}`,
    fallbackUrl: `https://i.pinimg.com/236x/${imgPath}`,
    link,
    title: desc.slice(0, 200),
    pinId: id,
    boardName,
    desc,
  };
}

function clean(s){
  return String(s || '')
    .replace(/&#(\d{1,7});/g, (_m, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ' '; } })
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

/* ---------- keywords ----------
   The same rules the Edge Function documents at length: whole-word with plural tolerance rather
   than prefix (or "car" matches "hair care" and "cardigan"), board name as the primary evidence
   with descriptions as the fill, and excludes matched against both. Duplicated rather than shared
   because this runs in Node and that runs in Deno, and this repo has no bundler to share a module
   across the two — so if the matching rules change, they change in both places. */

const words = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const sameWord = (a, b) => a === b || a === b + 's' || b === a + 's' || a === b + 'es' || b === a + 'es';

function hasTerm(text, term){
  if (!term.length || term.length > text.length) return false;
  outer:
  for (let i = 0; i + term.length <= text.length; i++) {
    for (let j = 0; j < term.length; j++) if (!sameWord(text[i + j], term[j])) continue outer;
    return true;
  }
  return false;
}

function parseTerms(list){
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const w = words(t.slice(0, 40));
    if (w.length && w.length <= 6) out.push(w);
    if (out.length >= 20) break;
  }
  return out;
}

function filterFeedPins(list, include, exclude){
  if (!include.length && !exclude.length) return list;
  const on = [], maybe = [];
  for (const p of list) {
    const board = words(p.boardName);
    const desc = words(p.desc);
    if (exclude.length && (exclude.some(t => hasTerm(board, t)) || exclude.some(t => hasTerm(desc, t)))) continue;
    if (!include.length) { on.push(p); continue; }
    if (include.some(t => hasTerm(board, t))) on.push(p);
    else if (include.some(t => hasTerm(desc, t))) maybe.push(p);
  }
  return on.length >= 60 ? on : on.concat(maybe);
}

// What crosses to the page. pinId/boardName/desc are this file's own bookkeeping, exactly as they
// are in the Edge Function, and are stripped for the same reason: the client reads none of them.
export function forWire(p){
  const { pinId: _a, boardName: _b, desc: _c, ...rest } = p;
  return rest;
}
