#!/usr/bin/env node
// scripts/local-helper-watch.mjs
//
// Runs valorant-local-server.mjs for exactly as long as a Riot client is open, and not a moment
// longer. Start this once (or from shell:startup) instead of the server itself:
//
//   node scripts/local-helper-watch.mjs
//   wscript scripts\local-helper-watch.vbs      (same thing, no console window)
//
// Why this exists: the helper is only *useful* while you're playing — the TFT lobby card reads the
// game client's loopback API, and Live Match reads a lobby you're only in while Valorant is up. A
// server sitting idle the other twenty-three hours is a loopback port open for no reason. So the
// Riot client's own lifetime is the signal: launcher up, helper up; launcher gone, helper gone.
//
// The trade-off, stated plainly because it is a real one: "Check Store Now", "+ Add Account" and
// "Check Owned Skins" on the Valorant tab go through this same helper, and those work perfectly
// well with no game running — they only need the saved session cookie. Under this watcher those
// buttons are dead while Riot is closed, and the tab will say the helper isn't running. That is
// the deliberate consequence of tying the two together; if you want them always available, run
// scripts/valorant-local-server.vbs from startup instead of this file. The scheduled daily store
// check (valorant-check-store.mjs) is unaffected either way — it's a separate process that never
// touches this server.
//
// No npm dependencies — nothing in scripts/ needs `npm install`.

import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'valorant-local-server.mjs');
const PORT = Number(process.env.VALORANT_LOCAL_PORT) || 8787;

const POLL_MS = 10000;
/* Consecutive empty polls before the helper is stopped. The Riot Client genuinely disappears and
   comes back during a game launch (it restarts itself handing off to the game), so acting on a
   single miss would kill the helper at the exact moment the TFT lobby card is about to need it.
   Starting, by contrast, is immediate — there is no cost to being early. */
const MISSES_BEFORE_STOP = 2;

/* Any one of these counts as "Riot is open". The launcher is listed first because it is the one
   that's up whichever game you play, but it is not sufficient on its own: it can exit after
   handing off, so the game clients are watched too. Lowercased at compare time — tasklist's
   casing is not guaranteed. */
const DEFAULT_RIOT_PROCESSES = [
  'riotclientservices.exe',   // the launcher, up whenever anything Riot is
  'leagueclient.exe',         // League / TFT client
  'tftclient.exe',            // standalone TFT client
  'valorant.exe',             // Valorant launcher shim
  'valorant-win64-shipping.exe',
];
// RIOT_WATCH_PROCESSES replaces that list (comma-separated) for an install whose executables this
// can't know about — and it is how the start/stop behaviour is exercised without a Riot client.
const RIOT_PROCESSES = (process.env.RIOT_WATCH_PROCESSES || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const WATCHED = RIOT_PROCESSES.length ? RIOT_PROCESSES : DEFAULT_RIOT_PROCESSES;

function log(msg){
  console.log(new Date().toLocaleTimeString() + '  ' + msg);
}

/* One `tasklist` per poll rather than one per process name: it is a single small native call and
   the whole list is cheaper to filter here than to ask for five times. Non-Windows falls through
   to `ps`, which keeps this runnable for anyone reading it on another OS — the rest of scripts/
   is Windows-first, but nothing in this file has to be. */
function runningProcesses(){
  return new Promise(resolve => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'tasklist' : 'ps';
    const args = isWin ? ['/FO', 'CSV', '/NH'] : ['-A', '-o', 'comm'];
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // a failed process list must read as "don't know", never as "nothing is running" — the
      // latter would stop the helper on a transient hiccup
      resolve(err ? null : String(stdout).toLowerCase());
    });
  });
}

async function riotIsOpen(){
  const list = await runningProcesses();
  if (list === null) return null;           // unknown — the caller holds its current state
  return WATCHED.some(name => list.includes(name));
}

/* Is something already serving on the port? Used only to decide whether to spawn: if a helper is
   already up — because it was started by hand, or by a second copy of this watcher — this one
   leaves it completely alone. It also never stops a server it did not start (see stopHelper),
   so the two rules together mean running this cannot disturb a helper you are relying on. */
function portInUse(){
  return fetch('http://127.0.0.1:' + PORT + '/status', { signal: AbortSignal.timeout(2000) })
    .then(() => true)
    .catch(() => false);
}

let child = null;      // only ever the server WE spawned
let misses = 0;

function startHelper(){
  child = spawn(process.execPath, [SERVER], {
    cwd: path.dirname(__dirname),
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  const started = child;
  log(`Riot is open — started the local helper (pid ${child.pid}).`);
  child.on('exit', code => {
    // only clear if this is still the current child; a stop() that already replaced it has run
    if (child === started) {
      child = null;
      if (code !== 0 && code !== null) log(`Helper exited with code ${code} — will restart on the next poll.`);
    }
  });
  child.on('error', err => {
    if (child === started) child = null;
    log('Could not start the helper: ' + err.message);
  });
}

function stopHelper(reason){
  if (!child) return;
  log('Riot is closed — stopping the local helper' + (reason ? ' (' + reason + ')' : '') + '.');
  const c = child;
  child = null;
  try { c.kill(); } catch { /* already gone */ }
}

async function tick(){
  const open = await riotIsOpen();
  if (open === null) return;               // couldn't read the process list; change nothing

  if (open) {
    misses = 0;
    if (!child && !(await portInUse())) startHelper();
    return;
  }

  if (!child) { misses = 0; return; }
  if (++misses >= MISSES_BEFORE_STOP) {
    stopHelper();
    misses = 0;
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { stopHelper('watcher exiting'); process.exit(0); });
}
// a watcher that died without taking the helper with it would leave exactly the orphan this
// whole file exists to prevent
process.on('exit', () => { if (child) { try { child.kill(); } catch {} } });

log(`Watching for [${WATCHED.join(', ')}] every ${POLL_MS / 1000}s. The local helper will run only while one is open.`);
tick();
setInterval(tick, POLL_MS);
