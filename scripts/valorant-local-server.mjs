#!/usr/bin/env node
// scripts/valorant-local-server.mjs
//
// Small local HTTP bridge so the "Local Helper" panel on the Valorant tab can trigger
// valorant-login.mjs and valorant-check-store.mjs with a button click instead of a terminal
// command. This has to run on the SAME machine that owns the Riot login session — see
// README.md for why these scripts run locally at all (Riot's bot detection) — and only ever
// binds to 127.0.0.1, never the network.
//
// First run generates a random token, printed below and saved to
// scripts/.valorant-local-token.json (gitignored, never committed). Paste that token into the
// Valorant tab's "Local Helper" section once — every request must include it, so a page that
// merely knows this server is listening on your machine can't drive your Riot login or write to
// your Supabase data without it.
//
// Usage:
//   node scripts/valorant-local-server.mjs
//   (leave it running in a terminal while you use the Valorant tab; Ctrl+C to stop)
//
// No npm dependencies — nothing in scripts/ needs `npm install`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadSessions, saveSessions, checkAccountStore, recordAccountResult, recordAccountError, deleteAccountStore, checkAccountOwnedSkins, recordOwnedSkinsResult, recordOwnedSkinsError, deleteAccountOwnedSkins, renameStoreSnapshot } from './valorant-lib.mjs';
import { loginAccount } from './valorant-login.mjs';
import { startLoginWindow, getLoginWindowStatus, cancelLoginWindow } from './valorant-login-window.mjs';
import { getLiveMatch, getLiveMatchAuto, flushMatchCache } from './valorant-live.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '.valorant-local-token.json');
const PORT = Number(process.env.VALORANT_LOCAL_PORT) || 8787;

function loadOrCreateToken(){
  if (fs.existsSync(TOKEN_FILE)) {
    const { token } = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (token) return token;
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2));
  return token;
}
const TOKEN = loadOrCreateToken();

// The Valorant tab may be served from an https:// origin (GitHub Pages, Supabase, wherever)
// while this server is a plain http://127.0.0.1 — browsers treat that as a same-trust-level
// request (localhost is a "potentially trustworthy origin" per the Secure Contexts spec) but
// still require these CORS headers, echoing the caller's Origin, for the page to read the
// response. Access-Control-Allow-Private-Network answers Chrome's Private Network Access
// preflight, which some versions send before a public page can reach a loopback address.
function withCors(res, origin){
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
function sendJson(res, status, body, origin){
  withCors(res, origin);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readJsonBody(req){
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') { withCors(res, origin); res.writeHead(204); res.end(); return; }

  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${PORT}`); }
  catch { sendJson(res, 400, { ok: false, error: 'Bad request.' }, origin); return; }

  // GET /status — no token required; only reveals which account labels are saved, not their
  // session cookies, so the app can show a connection indicator and populate the account picker.
  // loginWindow rides along for the same reason: a login window outlives the page that opened it
  // (a reload, a second tab), and a page that can't see one is a page offering to open a second.
  if (req.method === 'GET' && url.pathname === '/status') {
    let accounts = [];
    try { accounts = Object.keys(loadSessions()); } catch { /* no session file yet — empty list */ }
    sendJson(res, 200, { ok: true, accounts, loginWindow: getLoginWindowStatus() }, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/check') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const sessions = loadSessions();
    const labels = body.label ? [body.label] : Object.keys(sessions);
    if (!labels.length) { sendJson(res, 400, { ok: false, error: 'No saved accounts. Add one first.' }, origin); return; }

    const results = {};
    let anyFailed = false;
    for (const label of labels) {
      const sess = sessions[label];
      if (!sess || !sess.ssid) {
        results[label] = { ok: false, error: 'No saved session for this account.' };
        anyFailed = true;
        continue;
      }
      console.log(`Checking store for "${label}"...`);
      try {
        const result = await checkAccountStore(label, sess);
        await recordAccountResult(label, result);
        results[label] = { ok: true, items: result.items.length, accessories: result.accessories.length, bundle: !!result.bundle, nightMarket: !!result.nightMarket };
        console.log(`  done: ${result.items.length} skin(s)${result.accessories.length ? ` + ${result.accessories.length} accessory offer(s)` : ''}${result.bundle ? ' + featured bundle' : ''}${result.nightMarket ? ` + NIGHT MARKET (${result.nightMarket.offers.length} offers)` : ''}.`);
      } catch (err) {
        results[label] = { ok: false, error: err.message };
        await recordAccountError(label, err.message).catch(() => {});
        anyFailed = true;
        console.error(`  failed: ${err.message}`);
      }
    }
    sendJson(res, 200, { ok: !anyFailed, results }, origin);
    return;
  }

  // POST /check-inventory — same per-account loop as /check above, but for every owned skin (see
  // checkAccountOwnedSkins() in valorant-lib.mjs), sorted by tier, instead of the daily storefront.
  // Kept as a separate endpoint/button rather than folded into /check so a plain store check
  // never costs the extra Riot reauth + valorant-api.com catalog fetch this needs.
  if (req.method === 'POST' && url.pathname === '/check-inventory') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const sessions = loadSessions();
    const labels = body.label ? [body.label] : Object.keys(sessions);
    if (!labels.length) { sendJson(res, 400, { ok: false, error: 'No saved accounts. Add one first.' }, origin); return; }

    const results = {};
    let anyFailed = false;
    for (const label of labels) {
      const sess = sessions[label];
      if (!sess || !sess.ssid) {
        results[label] = { ok: false, error: 'No saved session for this account.' };
        anyFailed = true;
        continue;
      }
      console.log(`Checking owned skins for "${label}"...`);
      try {
        const result = await checkAccountOwnedSkins(label, sess);
        await recordOwnedSkinsResult(label, result);
        results[label] = { ok: true, skins: result.skins.length };
        console.log(`  done: ${result.skins.length} owned skin(s) found.`);
      } catch (err) {
        results[label] = { ok: false, error: err.message };
        await recordOwnedSkinsError(label, err.message).catch(() => {});
        anyFailed = true;
        console.error(`  failed: ${err.message}`);
      }
    }
    sendJson(res, 200, { ok: !anyFailed, results }, origin);
    return;
  }

  // POST /live — the current lobby for one account: who's in it, their ranks, who queued
  // together, and (competitive only) whether they're on an agent they actually play. Unlike
  // /check and /check-inventory this writes NOTHING: no Supabase row, no snapshot file. A live
  // lobby is stale within minutes and is full of other people's puuids, so it lives in
  // valorant-live.mjs's memory and is thrown away — see README.md, "Live Match".
  //
  // POST rather than GET for the token (same as every other route here), and because the service
  // worker skips non-GET outright, so a cached lobby can never be served back to the page.
  //
  // This is a poll endpoint: the Valorant tab hits it every few seconds while the panel is open.
  // Almost every one of those calls costs exactly one small request to Riot — getLiveMatch()
  // memoizes the whole roster against the match id, because a live match's players can't change.
  if (req.method === 'POST' && url.pathname === '/live') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const sessions = loadSessions();
    const label = (body.label || '').trim();
    const opts = {
      region: body.region, depth: body.depth,
      enemyStats: body.enemyStats, refresh: !!body.refresh,
    };
    if (label && !(sessions[label] && sessions[label].ssid)) {
      sendJson(res, 200, { ok: false, code: 'no_session', error: `No saved session for "${label}".` }, origin);
      return;
    }
    try {
      // no label = "whichever account is actually playing" — the panel's default, since the
      // whole point is that you don't tell it anything. See getLiveMatchAuto() for why that
      // costs the same one request per poll as naming an account outright.
      const snapshot = label
        ? await getLiveMatch(label, sessions[label], opts)
        : await getLiveMatchAuto(sessions, opts);
      sendJson(res, 200, snapshot, origin);
    } catch (err) {
      // codes the browser acts on: session_expired/no_session stop the poll loop, everything
      // else backs off and retries
      sendJson(res, 200, {
        ok: false,
        code: err && err.code ? err.code : 'riot_unreachable',
        error: (err && err.message) || String(err),
        shard: err && err.shard, tried: err && err.tried,
      }, origin);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const label = (body.label || '').trim();
    const ssid = (body.ssid || '').trim();
    const clid = (body.clid || '').trim();
    if (!label) { sendJson(res, 400, { ok: false, error: 'Missing account label.' }, origin); return; }
    if (!ssid) { sendJson(res, 400, { ok: false, error: 'Missing ssid cookie.' }, origin); return; }
    // clid is optional on the way in: an ssid-only session works when it lives on Riot's default
    // auth cluster, and loginAccount() validates before saving either way — so the honest answer
    // ("this one also needs clid") comes from Riot rather than from a guess made here.
    try {
      await loginAccount(label, clid ? { ssid, clid } : { ssid });
      sendJson(res, 200, { ok: true }, origin);
    } catch (err) {
      sendJson(res, 200, { ok: false, error: err.message || String(err) }, origin);
    }
    return;
  }

  // POST /login-window — the same cookie save as /login, except the cookie is fetched rather than
  // pasted: opens a small throwaway browser window on Riot's login page, waits for the human to
  // sign in there, and lifts the resulting ssid out of that window's own cookie jar. See the
  // header of valorant-login-window.mjs for why this is not the automated login the README rules
  // out (nothing drives the form, nothing hides from Riot).
  //
  // Signing in takes as long as it takes, so this starts the job and returns immediately; the
  // page polls /login-window-status. Holding an HTTP request open for ten minutes would just
  // give the browser a request to time out on.
  if (req.method === 'POST' && url.pathname === '/login-window') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const label = (body.label || '').trim();
    if (!label) { sendJson(res, 400, { ok: false, error: 'Missing account label.' }, origin); return; }
    try {
      const status = startLoginWindow(label);
      console.log(`Opened a login window for "${label}" — waiting for sign-in...`);
      sendJson(res, 200, { ok: true, ...status }, origin);
    } catch (err) {
      sendJson(res, 200, { ok: false, error: err.message || String(err) }, origin);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/login-window-status') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const status = getLoginWindowStatus();
    if (status.status === 'done') console.log(`Login window: saved a fresh session for "${status.label}".`);
    else if (status.status === 'error') console.error(`Login window failed: ${status.error}`);
    sendJson(res, 200, { ok: true, ...status }, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/login-window-cancel') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const cancelled = cancelLoginWindow();
    if (cancelled) console.log('Login window cancelled.');
    sendJson(res, 200, { ok: true, cancelled }, origin);
    return;
  }

  // POST /rename-account — the label is the key everywhere (session file, widget snapshot, and
  // the per-account entries in the shared Supabase row), so a rename is a migration rather than a
  // text edit. This half owns the two local files; the page owns its own state and saves it, which
  // is what carries the Supabase side.
  if (req.method === 'POST' && url.pathname === '/rename-account') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const from = (body.from || '').trim();
    const to = (body.to || '').trim();
    if (!from || !to) { sendJson(res, 400, { ok: false, error: 'Missing account name.' }, origin); return; }
    if (from === to) { sendJson(res, 200, { ok: true, unchanged: true }, origin); return; }

    const sessions = loadSessions();
    if (to in sessions) { sendJson(res, 200, { ok: false, error: `"${to}" is already a tracked account.` }, origin); return; }
    if (from in sessions) {
      sessions[to] = sessions[from];
      delete sessions[from];
      saveSessions(sessions);
      console.log(`Renamed account "${from}" to "${to}".`);
    } else {
      // a label with store data but no live session (an account whose session was deleted, or one
      // added on another machine) is still worth renaming — the page's own data moves either way
      console.log(`No saved session for "${from}"; renaming its stored data only.`);
    }
    renameStoreSnapshot(from, to);
    sendJson(res, 200, { ok: true }, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/delete-account') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const label = (body.label || '').trim();
    if (!label) { sendJson(res, 400, { ok: false, error: 'Missing account label.' }, origin); return; }
    const sessions = loadSessions();
    if (label in sessions) {
      delete sessions[label];
      saveSessions(sessions);
      console.log(`Deleted saved session for "${label}".`);
    } else {
      // no local session for this label — still worth clearing any leftover Supabase
      // dailyStores/ownedSkins entry (e.g. a stale label from a previous, already-deleted session)
      console.log(`No saved session for "${label}"; clearing any leftover store/inventory data only.`);
    }
    try {
      await deleteAccountStore(label);
      await deleteAccountOwnedSkins(label);
    } catch (err) {
      // the session is already gone locally, which is what matters most — a Supabase write
      // hiccup here just means a stale dailyStores/ownedSkins[label] entry lingers until the
      // next check
      console.error(`  (could not clear its store/inventory data from Supabase: ${err.message})`);
    }
    sendJson(res, 200, { ok: true }, origin);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found.' }, origin);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Valorant local helper listening on http://127.0.0.1:${PORT} (loopback only)`);
  console.log(`\nToken — paste this into the Valorant tab's "Local Helper" section once:\n`);
  console.log(`  ${TOKEN}\n`);
  console.log('Leave this running while you use the Valorant tab\'s Check/Add Account buttons.');
  console.log('The Live Match panel polls this server too — it stays idle until that tab is open.');
  console.log('Ctrl+C to stop.');
});

// valorant-live.mjs's match cache is write-behind (a stats sweep resolves dozens of matches in a
// burst, and rewriting the file per match would cost more than the fetches). Ctrl+C must not
// throw away whatever hasn't been flushed yet.
let shuttingDown = false;
function shutdown(){
  if (shuttingDown) return;
  shuttingDown = true;
  flushMatchCache();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { try { flushMatchCache(); } catch { /* nothing left to do */ } });
