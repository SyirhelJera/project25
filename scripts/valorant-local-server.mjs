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
import { loadSessions, saveSessions, checkAccountStore, recordAccountResult, recordAccountError, deleteAccountStore, checkAccountOwnedSkins, recordOwnedSkinsResult, recordOwnedSkinsError, deleteAccountOwnedSkins } from './valorant-lib.mjs';
import { loginAccount } from './valorant-login.mjs';

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
  if (req.method === 'GET' && url.pathname === '/status') {
    let accounts = [];
    try { accounts = Object.keys(loadSessions()); } catch { /* no session file yet — empty list */ }
    sendJson(res, 200, { ok: true, accounts }, origin);
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
        const result = await checkAccountStore(label, sess.ssid);
        await recordAccountResult(label, result);
        results[label] = { ok: true, items: result.items.length, bundle: !!result.bundle };
        console.log(`  done: ${result.items.length} skin(s)${result.bundle ? ' + featured bundle' : ''}.`);
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
        const result = await checkAccountOwnedSkins(label, sess.ssid);
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

  if (req.method === 'POST' && url.pathname === '/login') {
    const body = await readJsonBody(req);
    if (body.token !== TOKEN) { sendJson(res, 401, { ok: false, error: 'Invalid token.' }, origin); return; }
    const label = (body.label || '').trim();
    const ssid = (body.ssid || '').trim();
    if (!label) { sendJson(res, 400, { ok: false, error: 'Missing account label.' }, origin); return; }
    if (!ssid) { sendJson(res, 400, { ok: false, error: 'Missing session cookie.' }, origin); return; }
    try {
      await loginAccount(label, ssid);
      sendJson(res, 200, { ok: true }, origin);
    } catch (err) {
      sendJson(res, 200, { ok: false, error: err.message || String(err) }, origin);
    }
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
  console.log('Ctrl+C to stop.');
});
