// scripts/pinterest-login-window.mjs
//
// Opens a browser window at Pinterest's login page, waits for you to sign in, and lifts the
// resulting cookie jar out of that window into scripts/.pinterest-session.json.
//
// This automates the cookie COPY, never the login — the same line scripts/valorant-login-window.mjs
// draws, and the same rules keep it there:
//
//   * No anti-detection flag may ever be added to the argv below. `--app` is a window shape and
//     the throwaway profile is what makes this a separate mini-session; nothing here pretends to
//     be something it isn't. The moment it needs to disguise the window, the answer is the manual
//     paste path (scripts/pinterest-login.mjs), which is exactly why that path stays.
//   * The cookie read is Storage.getCookies on the BROWSER target only. It never attaches to the
//     page and never enables a domain on it, so nothing observable from Pinterest's side changes.
//   * The throwaway profile is wiped on every terminal state, because it holds a live Pinterest
//     login until it is.
//
// It is a job with polling rather than a blocking request, because signing in takes as long as it
// takes and no HTTP request should be held open for ten minutes.
//
// Usage (standalone — no server, no app, no tab involved):
//   node scripts/pinterest-login-window.mjs
//
// Chromium-family browsers only, because the cookie read is CDP. Set PINTEREST_LOGIN_BROWSER to a
// browser's executable path to override which one is used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveSession, verifySession, looksSignedIn } from './pinterest-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '.pinterest-login-profile');
const LOGIN_URL = 'https://www.pinterest.com/login/';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
// Tighter than the Valorant one: Pinterest sets its signed-in cookie the instant the redirect
// lands, and a window closed by hand a moment later must not beat the poll to it.
const COOKIE_POLL_MS = 900;
const CHROMIUM_EXE = /(chrome|msedge|brave|vivaldi|opera|chromium)\.exe$/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- finding a browser (same ladder as the Valorant one) ---- */

function defaultBrowserPath(){
  if (process.platform !== 'win32') return null;
  const q = args => {
    try {
      const r = spawnSync('reg', args, { encoding: 'utf8', windowsHide: true });
      return r.status === 0 ? (r.stdout || '') : '';
    } catch { return ''; }
  };
  const progId = (q([
    'query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
    '/v', 'ProgId',
  ]).match(/ProgId\s+REG_\w+\s+(\S+)/) || [])[1];
  if (!progId) return null;
  const cmd = (q(['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve']).match(/REG_\w+\s+(.+)/) || [])[1] || '';
  const exe = (cmd.match(/^"([^"]+)"/) || cmd.match(/^(\S+\.exe)/i) || [])[1];
  if (!exe || !CHROMIUM_EXE.test(exe)) return null;
  try { return fs.existsSync(exe) ? exe : null; } catch { return null; }
}

function browserCandidates(){
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  if (process.platform === 'win32') {
    return [
      path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      path.join(pf86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/brave-browser', '/usr/bin/microsoft-edge'];
}

function findBrowser(){
  const env = (process.env.PINTEREST_LOGIN_BROWSER || '').trim();
  if (env) {
    if (!fs.existsSync(env)) throw new Error(`PINTEREST_LOGIN_BROWSER points at "${env}", which doesn't exist.`);
    return env;
  }
  const preferred = defaultBrowserPath();
  if (preferred) return preferred;
  for (const exe of browserCandidates()) {
    try { if (fs.existsSync(exe)) return exe; } catch { /* unreadable path — try the next */ }
  }
  return null;
}

/* ---- tiny CDP client ---- */

function cdpSend(ws, pending, method, params){
  const id = pending.nextId++;
  return new Promise((resolve, reject) => {
    pending.map.set(id, { resolve, reject });
    try { ws.send(JSON.stringify({ id, method, params: params || {} })); }
    catch (err) { pending.map.delete(id); reject(err); }
    setTimeout(() => {
      if (pending.map.has(id)) { pending.map.delete(id); reject(new Error(`CDP ${method} timed out.`)); }
    }, 10000).unref?.();
  });
}

function openCdp(wsUrl){
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = { nextId: 1, map: new Map() };
    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const p = msg.id && pending.map.get(msg.id);
      if (!p) return;
      pending.map.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
      else p.resolve(msg.result);
    });
    ws.addEventListener('open', () => resolve({ ws, pending }));
    ws.addEventListener('error', () => reject(new Error('Could not attach to the login window.')));
  });
}

async function readDevToolsPort(deadline){
  const file = path.join(PROFILE_DIR, 'DevToolsActivePort');
  while (Date.now() < deadline) {
    try {
      const first = fs.readFileSync(file, 'utf8').split('\n')[0].trim();
      if (first && Number(first) > 0) return Number(first);
    } catch { /* not written yet */ }
    await sleep(200);
  }
  throw new Error('The login window did not start in time.');
}

/* ---- process/profile housekeeping ---- */

function killBrowser(child){
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  } catch { /* already gone */ }
}

async function removeProfile(){
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); return true; }
    catch { await sleep(300); }
  }
  return false;
}

/* ---- the job ---- */

let job = null;

export function getPinterestLoginStatus(){
  if (!job) return { status: 'idle' };
  return { status: job.status, error: job.error || '', startedAt: job.startedAt };
}

export function cancelPinterestLogin(){
  if (!job || !isPinterestLoginBusy()) return false;
  job.cancelled = true;
  return true;
}

export function isPinterestLoginBusy(){
  return !!job && (job.status === 'opening' || job.status === 'waiting');
}

export function startPinterestLogin(){
  if (isPinterestLoginBusy()) throw new Error('A Pinterest login window is already open — finish or cancel that one first.');
  const exe = findBrowser();
  if (!exe) {
    throw new Error('No Chromium-based browser found (checked your default browser, then Chrome, Brave and Edge). Set PINTEREST_LOGIN_BROWSER to the browser\'s .exe path, or paste the cookies manually instead.');
  }
  job = { status: 'opening', error: '', startedAt: Date.now(), cancelled: false };
  const current = job;
  runLoginWindow(current, exe).catch(err => {
    current.status = 'error';
    current.error = (err && err.message) || String(err);
  });
  return getPinterestLoginStatus();
}

async function runLoginWindow(current, exe){
  await removeProfile();                          // always a fresh, signed-out window
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const child = spawn(exe, [
    `--app=${LOGIN_URL}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--remote-debugging-port=0',
    '--window-size=560,820',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore', windowsHide: false });

  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', err => { exited = true; current.error = current.error || err.message; });

  let ws = null;
  const finish = async (status, error) => {
    current.status = status;
    if (error) current.error = error;
    try { if (ws) ws.ws.close(); } catch { /* already closed */ }
    killBrowser(child);
    await removeProfile();
  };

  const deadline = current.startedAt + LOGIN_TIMEOUT_MS;
  try {
    const port = await readDevToolsPort(Math.min(deadline, Date.now() + 30000));
    const verResp = await fetch(`http://127.0.0.1:${port}/json/version`);
    const version = await verResp.json();
    if (!version.webSocketDebuggerUrl) throw new Error('The login window did not expose a debugging endpoint.');
    ws = await openCdp(version.webSocketDebuggerUrl);
  } catch (err) {
    await finish('error', (err && err.message) || 'Could not open the login window.');
    return;
  }

  current.status = 'waiting';

  while (Date.now() < deadline) {
    if (current.cancelled) { await finish('cancelled', 'Cancelled.'); return; }
    if (exited) { await finish('cancelled', 'The login window was closed before sign-in finished.'); return; }

    let cookies = [];
    try {
      const res = await cdpSend(ws.ws, ws.pending, 'Storage.getCookies');
      cookies = (res && res.cookies) || [];
    } catch { cookies = []; }

    // The whole pinterest.com jar, not one hand-picked cookie — the Riot ruling: store what you
    // were handed, so a new Pinterest requirement needs no code change here.
    const jar = {};
    for (const c of cookies) {
      if (c.value && /(^|\.)pinterest\.[a-z.]+$/.test(String(c.domain || ''))) jar[c.name] = c.value;
    }
    // `_pinterest_sess` and `csrftoken` are set for signed-OUT visitors too, so waiting on those
    // captured a logged-out jar the moment the login page loaded. `_auth === '1'` is the flag that
    // actually means signed in, and the feed read after it is the proof.
    //
    // Nothing is written until BOTH pass. The earlier order — save, then verify, then throw —
    // left a signed-out jar in the session file whenever the verify failed, and the app then
    // reported "expired" on every refresh while quietly falling back to the public path.
    if (looksSignedIn(jar)) {
      try {
        await verifySession(jar);
        saveSession(jar);
        await finish('done', '');
        return;
      } catch { /* not a usable session yet — keep waiting, having written nothing */ }
    }

    await sleep(COOKIE_POLL_MS);
  }

  await finish('error', 'Timed out waiting for the sign-in (10 minutes).');
}

/* ---- CLI ---- */

async function main(){
  console.log('Opening a Pinterest login window...');
  try { startPinterestLogin(); }
  catch (err) { console.error(err.message); process.exit(1); }

  for (;;) {
    const s = getPinterestLoginStatus();
    if (s.status === 'done') { console.log('Saved your Pinterest session to scripts/.pinterest-session.json'); return; }
    if (s.status === 'error' || s.status === 'cancelled') { console.error(s.error || s.status); process.exit(1); }
    await sleep(500);
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pinterest-login-window.mjs');
if (isMain) main();
