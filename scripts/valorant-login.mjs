#!/usr/bin/env node
// scripts/valorant-login.mjs
//
// Saves a Riot session cookie under a label, for scripts/valorant-check-store.mjs to reuse.
// Supports multiple Riot accounts: each cookie is saved under a label you choose, so you can
// track the daily store for more than one account (e.g. a main and a smurf) side by side.
//
// This does NOT open or automate a browser. Earlier versions did (via Puppeteer), but Riot's
// fraud detection rejects login attempts that come through an automation-controlled browser —
// even a real, "headful" Chrome driven via the DevTools Protocol gets fingerprinted (e.g.
// `navigator.webdriver`) and silently blocked, surfaced as a misleading "username or password
// may be incorrect" error even with correct credentials. Rather than try to defeat that
// detection — it exists for the same reason this project already refuses to automate Riot's
// captcha — logging in has to happen in your own, completely normal, human-driven browser. This
// script only saves the resulting session cookie.
//
// How to get the cookie:
//   1. In your own browser, go to https://playvalorant.com and log in normally.
//   2. Open DevTools (F12) -> Application tab -> Cookies -> https://auth.riotgames.com
//   3. Copy the value of the `ssid` cookie.
//
// loginAccount(label, ssid) is also imported directly by scripts/valorant-local-server.mjs, so
// the "+ Add Account" button on the Valorant tab can save a cookie the same way.
//
// Usage:
//   node scripts/valorant-login.mjs [label]         (prompts for the cookie)
//   node scripts/valorant-login.mjs [label] <ssid>   (non-interactive)
//   e.g. node scripts/valorant-login.mjs main
//   [label] defaults to "default" — save again with the same label later to refresh that
//   account's session (e.g. once it expires); a different label adds another tracked account.
//
// No npm dependencies — nothing in scripts/ needs `npm install` anymore.

import readline from 'node:readline';
import { loadSessions, saveSessions, silentReauth } from './valorant-lib.mjs';

// Confirms `ssid` actually works (a quick silent reauth) before saving it under `label` — so a
// mistyped or already-expired cookie fails immediately here instead of silently breaking the
// next scheduled check. Throws if the cookie doesn't work.
export async function loginAccount(label, ssid){
  await silentReauth(ssid);
  const accounts = loadSessions();
  accounts[label] = { ssid, savedAt: Date.now() };
  saveSessions(accounts);
  console.log(`Session for "${label}" saved locally to scripts/.valorant-session.json`);
}

function promptForSsid(){
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Paste the ssid cookie value: ', answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function main(){
  const label = (process.argv[2] || '').trim() || 'default';
  let ssid = (process.argv[3] || '').trim();

  console.log(`Saving a session for "${label}".\n`);
  console.log('If you haven\'t already: log into https://playvalorant.com in your own normal');
  console.log('browser, then open DevTools (F12) -> Application -> Cookies ->');
  console.log('https://auth.riotgames.com, and copy the value of the "ssid" cookie.\n');

  if (!ssid) ssid = await promptForSsid();
  if (!ssid) { console.error('No cookie value entered.'); process.exitCode = 1; return; }

  try {
    await loginAccount(label, ssid);
  } catch (err) {
    console.error('\n' + err.message);
    process.exitCode = 1;
    return;
  }

  console.log('(gitignored, never committed, never sent anywhere but Riot).');
  console.log('\nNow run: node scripts/valorant-check-store.mjs');
  console.log('(checks the store for every saved account — today, and daily going forward; see');
  console.log('README.md for a Windows Task Scheduler setup)');
  console.log('\nTo track another account, run this script again with a different label, e.g.:');
  console.log('  node scripts/valorant-login.mjs smurf');
  console.log('\nEach session is good for roughly 1-3 weeks. When one expires (see the error banner');
  console.log('on the Valorant tab), just log in again in your browser, grab a fresh ssid value,');
  console.log('and run this script again with that same label.');
}

// Only run the CLI flow when this file is executed directly (`node valorant-login.mjs`), not
// when valorant-local-server.mjs imports loginAccount() from it.
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('valorant-login.mjs');
if (isMain) main().catch(err => { console.error(err); process.exitCode = 1; });
