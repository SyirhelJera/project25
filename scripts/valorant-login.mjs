#!/usr/bin/env node
// scripts/valorant-login.mjs
//
// One-time (and periodic, every ~1-3 weeks — Riot expires the resulting cookie) local helper
// that gets a reauth cookie for scripts/valorant-check-store.mjs to use.
//
// Riot's direct username/password login endpoint now requires solving an hCaptcha, which no
// script should try to bypass — captchas exist specifically to block automated logins, and
// defeating one isn't something this tool does. Instead, this opens a real, visible browser
// window at Riot's actual login page: you log in there completely normally — captcha, OTP,
// whatever Riot asks for, all handled by you in a genuine browser — and once you land back on
// playvalorant.com this script reads the resulting `ssid` cookie out of that same browser
// session. Your credentials are typed into Riot's own page, never seen by this script.
//
// The cookie is saved to .valorant-session.json in this folder (gitignored, never committed,
// never leaves your machine) — NOT set as a cloud secret. See README.md for why the daily
// check runs locally instead of via GitHub Actions / a Supabase Edge Function.
//
// Setup (first time only):
//   cd scripts && npm install
// Usage:
//   node valorant-login.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '.valorant-session.json');

const AUTHORIZE_URL = 'https://auth.riotgames.com/authorize'
  + '?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in'
  + '&client_id=play-valorant-web-prod'
  + '&response_type=token%20id_token'
  + '&nonce=1'
  + '&scope=account%20openid';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to complete login, including any MFA/captcha

async function main(){
  console.log('Opening a browser window — log in to your Riot account normally there.');
  console.log('Any captcha or one-time code Riot shows you is fine to solve there; that\'s a');
  console.log('real browser, not this script.\n');

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(AUTHORIZE_URL, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForFunction(
      () => location.href.includes('access_token='),
      { timeout: LOGIN_TIMEOUT_MS },
    );
  } catch {
    console.error('\nTimed out waiting for login to complete (5 min). Closing the browser —');
    console.error('run this again when you\'re ready to log in.');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const cookies = await page.cookies('https://auth.riotgames.com');
  const ssid = cookies.find(c => c.name === 'ssid')?.value;
  await browser.close();

  if (!ssid) {
    console.error('\nLogin succeeded but no ssid cookie was found on auth.riotgames.com —');
    console.error('cannot continue. If this persists, Riot may have changed its cookie setup.');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(SESSION_FILE, JSON.stringify({ ssid, savedAt: Date.now() }, null, 2));

  console.log('\nLogin succeeded — session saved locally to scripts/.valorant-session.json');
  console.log('(gitignored, never committed, never sent anywhere but Riot).');
  console.log('\nNow run: node scripts/valorant-check-store.mjs');
  console.log('(today, and daily going forward — see README.md for a Windows Task Scheduler setup)');
  console.log('\nThis session is good for roughly 1-3 weeks. When the daily check starts failing');
  console.log('(see the error banner on the Valorant tab), just run this script again.');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
