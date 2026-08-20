#!/usr/bin/env node
// scripts/valorant-login-window.mjs
//
// Opens a small, throwaway browser window on Riot's own login page, waits for YOU to sign in
// there by hand, then picks the resulting session cookies straight out of that window and saves
// them under a label — so refreshing an expired session doesn't mean a trip through DevTools.
//
// Note "cookies", plural: Riot needs `ssid` AND `clid` together (see silentReauth() in
// valorant-lib.mjs). That is the main practical advantage this has over the manual paste — the
// cookie jar is taken whole, so the next cookie Riot decides to require is already there.
//
// ---------------------------------------------------------------------------------------------
// Why this is NOT the Puppeteer login the README says won't come back
//
// The thing Riot's fraud detection rejects is an *automation-controlled* browser driving the
// login: `navigator.webdriver` set, the automation switches on, a driver typing into the form.
// This script does none of that, and deliberately cannot:
//
//   * The window is a plain installed Edge/Chrome/Brave launched with `--app=` and a fresh
//     `--user-data-dir`. No `--enable-automation`, no driver, no injected script, and nothing
//     here touches the login form — you type your own password into Riot's own page.
//   * Nothing is done to hide anything from Riot. There is no anti-detection flag in the argv
//     below, and none may be added: the moment this needs to *hide* from fraud detection it has
//     become the thing this project refuses to do (same principle as not automating the captcha).
//   * The cookie is read through the browser's own debugging endpoint at the BROWSER target
//     level (`Storage.getCookies`) — the page target is never attached to and no protocol domain
//     is ever enabled on it, so nothing observable from the login page changes. It is a read of
//     your own cookie jar, on your own machine, and is the exact equivalent of the DevTools
//     copy-paste it replaces.
//
// If Riot ever does refuse a login in this window, the answer is to log in normally and paste
// the cookie the old way (that path is still there, in the tab and in valorant-login.mjs) — not
// to start fingerprint-spoofing.
// ---------------------------------------------------------------------------------------------
//
// The profile directory (scripts/.valorant-login-profile, gitignored) is created fresh for each
// attempt and deleted the moment the cookie is saved: it is a live Riot session on disk, and
// there is no reason to keep a second copy of it once .valorant-session.json has one.
//
// The local helper server is NOT needed for this. Run it on its own and it opens the window,
// waits, and rewrites scripts/.valorant-session.json in place — that's the whole job:
//
//   node scripts/valorant-login-window.mjs            (refreshes your saved account; asks which,
//                                                      if you track more than one)
//   node scripts/valorant-login-window.mjs main       (that label specifically — a new label adds
//                                                      an account, an existing one refreshes it)
//   scripts\valorant-login-window.cmd                 (same thing, double-clickable)
//
// scripts/valorant-local-server.mjs also imports it, which is how the Valorant tab's "Log in with
// browser" / "Re-login" buttons drive the same flow — but that's a second front door, not a
// requirement.
//
// No npm dependencies — CDP is spoken over Node's built-in fetch + WebSocket.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RIOT_AUTHORIZE_URL, loadSessions } from './valorant-lib.mjs';
import { loginAccount } from './valorant-login.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '.valorant-login-profile');

// How long to leave the window open waiting for a sign-in before giving up. Generous on purpose:
// a real login can involve a password manager, an email code and a 2FA app.
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const COOKIE_POLL_MS = 1500;

// ---- finding a browser -----------------------------------------------------------------------

// Chromium-family only — the cookie read below is the DevTools Protocol, which Firefox and
// Safari don't speak. That's the one hard constraint; everything else here is about opening the
// browser you actually use rather than whichever one a hardcoded list happens to name first.
const CHROMIUM_EXE = /(chrome|msedge|brave|vivaldi|opera|chromium)\.exe$/i;

// Windows records the browser you picked for https links, so ask it instead of guessing. Returns
// null — not an error — when the answer is unusable (Firefox as your default, a ProgId with no
// command, a path that's since moved); the candidate list below then takes over.
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
  // e.g. ChromeHTML -> "C:\Program Files\Google\Chrome\Application\chrome.exe" --single-argument %1
  const cmd = (q(['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve']).match(/REG_\w+\s+(.+)/) || [])[1] || '';
  const exe = (cmd.match(/^"([^"]+)"/) || cmd.match(/^(\S+\.exe)/i) || [])[1];
  if (!exe || !CHROMIUM_EXE.test(exe)) return null;
  try { return fs.existsSync(exe) ? exe : null; } catch { return null; }
}

// Only consulted when the default browser can't be resolved or isn't Chromium. Chrome first —
// it's the common default; Edge last because it's the one that's merely always installed.
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

// Throws rather than falling through when VALORANT_LOGIN_BROWSER is set but wrong: you asked for
// a specific browser, and quietly opening a different one is the least helpful possible answer.
function findBrowser(){
  const env = (process.env.VALORANT_LOGIN_BROWSER || '').trim();
  if (env) {
    if (!fs.existsSync(env)) throw new Error(`VALORANT_LOGIN_BROWSER points at "${env}", which doesn't exist.`);
    return env;
  }
  const preferred = defaultBrowserPath();
  if (preferred) return preferred;
  for (const exe of browserCandidates()) {
    try { if (fs.existsSync(exe)) return exe; } catch { /* unreadable path — try the next */ }
  }
  return null;
}

// ---- tiny CDP client -------------------------------------------------------------------------

// One request/response pair over the browser-level WebSocket. Node has had a global WebSocket
// since 22, so this needs no dependency; the protocol itself is just JSON with an id to match on.
function cdpSend(ws, pending, method, params){
  const id = pending.nextId++;
  return new Promise((resolve, reject) => {
    pending.map.set(id, { resolve, reject });
    try { ws.send(JSON.stringify({ id, method, params: params || {} })); }
    catch (err) { pending.map.delete(id); reject(err); }
    setTimeout(() => {
      if (pending.map.delete(id)) reject(new Error(`CDP ${method} timed out.`));
    }, 10000);
  });
}

function openCdp(wsUrl){
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = { map: new Map(), nextId: 1 };
    ws.addEventListener('message', ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      const waiter = msg && msg.id != null ? pending.map.get(msg.id) : null;
      if (!waiter) return;                       // an event, or a reply we already timed out on
      pending.map.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message || 'CDP error'));
      else waiter.resolve(msg.result);
    });
    ws.addEventListener('open', () => resolve({ ws, pending }));
    ws.addEventListener('error', () => reject(new Error('Could not talk to the login window.')));
    ws.addEventListener('close', () => {
      // whatever was in flight will never be answered now
      for (const waiter of pending.map.values()) waiter.reject(new Error('Login window closed.'));
      pending.map.clear();
    });
  });
}

// Chromium writes the port it actually bound to here once it's listening — the documented way to
// use `--remote-debugging-port=0` and avoid racing another process for a fixed port number.
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

// ---- process/profile housekeeping --------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

function killBrowser(child){
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    // a Chromium window is a process tree; child.kill() on Windows leaves the renderers behind
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  } catch { /* already gone */ }
}

// The profile holds a live Riot session, so this is cleanup that matters rather than tidiness.
// Windows can hold the files a moment longer than the process, hence the retries.
async function removeProfile(){
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); return true; }
    catch { await sleep(300); }
  }
  return false;
}

// ---- the job ---------------------------------------------------------------------------------

// Only ever one window at a time: two would race for the same profile directory, and there is no
// sensible reading of "log in twice at once" anyway.
let job = null;

export function getLoginWindowStatus(){
  if (!job) return { status: 'idle' };
  return { status: job.status, label: job.label, error: job.error || '', startedAt: job.startedAt };
}

export function cancelLoginWindow(){
  if (!job || !isLoginWindowBusy()) return false;
  job.cancelled = true;
  return true;
}

export function isLoginWindowBusy(){
  return !!job && (job.status === 'opening' || job.status === 'waiting');
}

// Starts the window and returns immediately — the caller polls getLoginWindowStatus(), because
// signing in takes as long as it takes and no HTTP request should be held open for ten minutes.
export function startLoginWindow(label){
  if (isLoginWindowBusy()) throw new Error('A login window is already open — finish or cancel that one first.');
  const exe = findBrowser();
  if (!exe) {
    throw new Error('No Chromium-based browser found (checked your default browser, then Chrome, Brave and Edge). Set VALORANT_LOGIN_BROWSER to the browser\'s .exe path, or paste the ssid cookie manually instead.');
  }
  job = { label, status: 'opening', error: '', startedAt: Date.now(), cancelled: false };
  const current = job;
  runLoginWindow(current, exe).catch(err => {
    current.status = 'error';
    current.error = (err && err.message) || String(err);
  });
  return getLoginWindowStatus();
}

async function runLoginWindow(current, exe){
  await removeProfile();                          // always a fresh, signed-out window
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // Nothing in here hides the browser from Riot — see the header comment. `--app` is just the
  // chromeless window shape, and the fresh profile is what makes it a *mini* session rather than
  // your everyday browser (and what lets it be deleted afterwards).
  const child = spawn(exe, [
    `--app=${RIOT_AUTHORIZE_URL}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--remote-debugging-port=0',
    '--window-size=520,780',
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
    } catch {
      // window closed mid-poll, or the browser is busy navigating — the loop conditions above
      // decide whether that's fatal on the next pass
      cookies = [];
    }

    // Take the whole Riot jar rather than hunting one cookie: silentReauth() decides which of
    // them matter, and a login isn't finished until the set actually works.
    const jar = {};
    for (const c of cookies) {
      if (c.value && /(^|\.)riotgames\.com$/.test(String(c.domain || ''))) jar[c.name] = c.value;
    }
    if (jar.ssid && jar.clid) {
      try {
        // loginAccount() silent-reauths before saving, so a half-finished login (cookies set
        // before the flow completed) fails here and the loop simply carries on waiting.
        await loginAccount(current.label, jar);
        await finish('done', '');
        return;
      } catch { /* not a usable session yet — keep waiting */ }
    }

    await sleep(COOKIE_POLL_MS);
  }

  await finish('error', 'Timed out waiting for the sign-in (10 minutes).');
}

// ---- CLI -------------------------------------------------------------------------------------

function ask(question){
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// Refreshing an expired session is what this is for, so the common case — one saved account —
// shouldn't need you to remember and retype its label.
async function pickLabel(){
  const arg = (process.argv[2] || '').trim();
  if (arg) return arg;
  let saved = [];
  try { saved = Object.keys(loadSessions()); } catch { /* no session file yet */ }
  if (!saved.length) return 'default';
  if (saved.length === 1) return saved[0];
  console.log('Saved accounts: ' + saved.join(', '));
  return (await ask(`Which one? (or type a new label) [${saved[0]}]: `)) || saved[0];
}

async function main(){
  const label = await pickLabel();
  let exe = null;
  try { exe = findBrowser(); } catch { /* startLoginWindow reports it properly below */ }
  console.log(`Opening a login window for "${label}"${exe ? ` in ${path.basename(exe)}` : ''}...`);
  console.log('Sign in there as you normally would. It is a fresh, empty browser profile — signed');
  console.log('out of everything — and it is deleted again the moment the session cookie is saved.\n');
  startLoginWindow(label);

  let last = '';
  for (;;) {
    const s = getLoginWindowStatus();
    if (s.status !== last) { console.log(`  ${s.status}${s.error ? ': ' + s.error : ''}`); last = s.status; }
    if (s.status === 'done') {
      console.log(`\nSaved to scripts/.valorant-session.json under "${label}".`);
      console.log(`Now run: node scripts/valorant-check-store.mjs ${label}`);
      return;
    }
    if (s.status === 'error' || s.status === 'cancelled') { process.exitCode = 1; return; }
    await sleep(500);
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('valorant-login-window.mjs');
if (isMain) {
  process.on('SIGINT', () => { cancelLoginWindow(); });
  main().catch(err => { console.error(err); process.exitCode = 1; });
}
