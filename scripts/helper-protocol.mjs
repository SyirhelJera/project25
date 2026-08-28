#!/usr/bin/env node
// scripts/helper-protocol.mjs
//
// Registers a `p25helper://` URL protocol so the web app's "Start" button can launch the local
// helper. Run once:
//
//   node scripts/helper-protocol.mjs register
//   node scripts/helper-protocol.mjs unregister
//   node scripts/helper-protocol.mjs status
//
// Why this exists at all: stopping the helper from the app is easy — it's listening, so the Stop
// button just calls POST /shutdown. Starting it cannot work the same way, because by then there is
// nothing to call. A registered URL protocol is the only mechanism a browser offers for "hand this
// off to a program on my machine", so that's the other half of the toggle.
//
// It writes to HKCU only (per-user, no admin) — HKCU\Software\Classes\p25helper.
//
// SECURITY — the two rules that make this safe, neither of which may be relaxed:
//
//   1. The command line contains NO `%1`. Windows only appends the clicked URL as an argument when
//      the command asks for it, so with no `%1` nothing from the URL — from ANY page, not just
//      this app — can reach the process. The handler is a doorbell, not a parameterised call.
//      Adding `%1` here would turn every website on the internet into something that can pass
//      arguments to a program on this machine. Don't.
//   2. It launches ONE fixed script, this repo's valorant-local-server.vbs, by absolute path
//      resolved here at registration time.
//
// What a hostile page can therefore do is start a server that already refuses every meaningful
// request without the token it has no way to learn — and the browser still asks the user before
// handing off, the first time at minimum. That is the whole of the exposure, and it's why the
// registration is opt-in and separate from the app rather than something the page can arrange.
//
// No npm dependencies — nothing in scripts/ needs `npm install`.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_VBS = path.join(__dirname, 'valorant-local-server.vbs');
const SCHEME = 'p25helper';
const KEY = `HKCU\\Software\\Classes\\${SCHEME}`;

function reg(args){
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err && err.message || '') });
    });
  });
}

async function register(){
  if (process.platform !== 'win32') {
    console.error('This registers a Windows URL protocol; nothing to do on ' + process.platform + '.');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(TARGET_VBS)) {
    console.error('Could not find ' + TARGET_VBS + ' — run this from inside the repo.');
    process.exitCode = 1;
    return;
  }
  // wscript rather than node: the .vbs is what starts the server with no console window, and it
  // is already the documented always-on entry point. One fixed path, and deliberately no %1.
  const command = `wscript.exe "${TARGET_VBS}"`;

  const steps = [
    [KEY, '/ve', '/d', `URL:Project 25 Local Helper`, '/f'],
    [KEY, '/v', 'URL Protocol', '/d', '', '/f'],
    [`${KEY}\\shell\\open\\command`, '/ve', '/d', command, '/f'],
  ];
  for (const s of steps) {
    const r = await reg(['add', ...s]);
    if (!r.ok) { console.error('Failed writing ' + s[0] + ': ' + r.err.trim()); process.exitCode = 1; return; }
  }
  console.log(`Registered ${SCHEME}:// -> ${command}`);
  console.log('');
  console.log('The app\'s "Start" button under Settings -> Local helper will now work.');
  console.log('Your browser will ask for permission the first time; tick "always allow" to stop it asking.');
}

async function unregister(){
  const r = await reg(['delete', KEY, '/f']);
  console.log(r.ok ? `Removed ${SCHEME}://` : `Nothing to remove (${r.err.trim() || 'no such key'}).`);
}

async function status(){
  const r = await reg(['query', `${KEY}\\shell\\open\\command`, '/ve']);
  if (!r.ok) { console.log(`${SCHEME}:// is NOT registered. Run: node scripts/helper-protocol.mjs register`); return; }
  console.log(`${SCHEME}:// is registered:`);
  console.log(r.out.trim());
}

const cmd = (process.argv[2] || 'status').toLowerCase();
if (cmd === 'register') register();
else if (cmd === 'unregister' || cmd === 'remove') unregister();
else if (cmd === 'status') status();
else {
  console.error('Usage: node scripts/helper-protocol.mjs [register|unregister|status]');
  process.exitCode = 1;
}
