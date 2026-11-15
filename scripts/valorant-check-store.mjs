#!/usr/bin/env node
// scripts/valorant-check-store.mjs
//
// Fetches the personal Valorant daily storefront for every account saved via valorant-login.mjs
// and writes them straight into the shared app_data row — the same row/anon-key the app itself
// already reads and writes with no login (see README.md "Persistence"), so no extra credentials
// are needed to save the result.
//
// Runs LOCALLY, on your own machine, deliberately. Riot's fraud/bot detection rejects this
// exact reauth flow when it comes from a cloud/datacenter IP (a Supabase Edge Function, in an
// earlier version of this script) — silently downgrading it to "must log in interactively
// again" instead of the normal silent reauth. Running from your own device, the same one that
// did the original interactive login, doesn't trip that check. See README.md for why this
// isn't a GitHub Actions / Edge Function job.
//
// This same check also runs from the Valorant tab's "Check Store Now" button, via
// scripts/valorant-local-server.mjs (which imports checkAccountStore() from valorant-lib.mjs,
// the same function this CLI uses) — running this file directly is just the terminal path.
//
// Each account whose store check succeeds also gets its owned-skins list refreshed
// (checkAccountOwnedSkins(), what the tab's "🎨 Check Owned Skins" button runs), so buying a skin
// shows up in the Owned Skins pane by the next day without anyone clicking anything. That half is
// best-effort, on purpose, in three ways: it's skipped when the store check failed (the same
// session would fail the same way, and a dead session is already on the store banner); a failure
// is logged but NOT written to ownedSkins[label] and doesn't fail the run, because that pane
// shows an error *instead of* the list, and yesterday's list is worth more than a transient
// valorant-api.com blip; and it never touches the store result, which is recorded before it
// starts. The Check Store Now button deliberately doesn't do this (see /check-inventory in
// valorant-local-server.mjs) — once a day is when the extra reauth + catalog fetch is worth it.
//
// When an account's session has died, this run does what a script may about it: pushes a phone
// notification (if ntfy is set up — see notifySessionExpired()) and opens Riot's sign-in page in
// your everyday browser. Signing in and handing the cookies over stay yours — see askForSignIn()
// below for why this stops there.
//
// Usage:
//   node scripts/valorant-login.mjs [label]    (first, and again whenever a session expires —
//                                                every ~1-3 weeks; a new label tracks another
//                                                account alongside existing ones)
//   node scripts/valorant-check-store.mjs       (run this daily — checks every saved account —
//                                                see README.md for a Windows Task Scheduler setup)
//   node scripts/valorant-check-store.mjs main   (check only the "main" account)
//   node scripts/valorant-check-store.mjs --no-browser
//                                               (don't open the sign-in page for an expired
//                                                session; still pushes — also VALORANT_AUTO_LOGIN=0)
//
// No npm dependencies — only valorant-login.mjs needs puppeteer, kept in scripts/package.json.

import { spawn } from 'node:child_process';
import { loadSessions, checkAccountStore, recordAccountResult, recordAccountError, checkAccountOwnedSkins, recordOwnedSkinsResult, isSessionError, notifySessionExpired, RIOT_AUTHORIZE_URL } from './valorant-lib.mjs';

const cliArgs = process.argv.slice(2);
const requestedLabel = (cliArgs.find(a => !a.startsWith('--')) || '').trim();
const openBrowser = !cliArgs.includes('--no-browser') && process.env.VALORANT_AUTO_LOGIN !== '0';

// One account, start to finish: the store, then (only if that worked) the owned-skins list.
// Returns the store failure message, or '' on success.
async function checkAccount(label){
  const sess = loadSessions()[label];
  if (!sess || !sess.ssid) {
    console.error(`No saved session for "${label}". Run \`node scripts/valorant-login.mjs ${JSON.stringify(label)}\` first.`);
    return 'No saved session for this account.';
  }
  console.log(`Checking store for "${label}"...`);
  try {
    const result = await checkAccountStore(label, sess);
    await recordAccountResult(label, result);
    // the night market is called out separately because it's the one panel that isn't always
    // there — a run that finds it is worth noticing in a log you'd otherwise skim
    console.log(`  done: ${result.items.length} skin(s)${result.accessories.length ? ` + ${result.accessories.length} accessory offer(s)` : ''}${result.bundles.length ? ` + ${result.bundles.length} featured bundle(s)` : ''}${result.nightMarket ? ` + NIGHT MARKET (${result.nightMarket.offers.length} offers)` : ''}.`);
  } catch (err) {
    console.error(`  failed: ${err.message}`);
    await recordAccountError(label, err.message).catch(()=>{});
    return err.message || String(err); // no owned-skins refresh on a session that just failed — see the header comment
  }

  console.log(`Checking owned skins for "${label}"...`);
  try {
    const owned = await checkAccountOwnedSkins(label, sess);
    await recordOwnedSkinsResult(label, owned);
    console.log(`  done: ${owned.skins.length} owned skin(s).`);
  } catch (err) {
    // not recorded and not a failed run — the pane keeps the last good list (see the header)
    console.error(`  owned skins skipped: ${err.message}`);
  }
  return '';
}

// Whether this machine has a desktop to put a page on. False for a phone running a copy of this
// script (Termux reports 'android') and for a Linux box with no display.
function hasDesktop(){
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  return process.platform === 'linux' && !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

// Opens a URL the way clicking a link does: the OS hands it to your default browser, in your own
// profile, with nothing added — no flags, no debugging port, no separate profile, nothing reading
// it afterwards. rundll32 rather than `cmd /c start`, because the URL carries `&`, which cmd would
// take for a command separator.
function openInDefaultBrowser(url){
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  return new Promise(resolve => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}

// What a script may do about a dead session: tell you, and put Riot's sign-in page in front of
// you. Signing in and handing the cookies over stay yours — 🔑 Re-login in the Valorant tab,
// which re-checks the store the moment they land.
//
// Why your everyday browser, and not valorant-login-window.mjs's throwaway window that would copy
// the cookies for you: Riot refuses sign-ins in that window. The captcha passes, the credentials
// are right, and the answer is still "Your username or password may be incorrect" — the response
// the old Puppeteer login got (README, "Getting the initial session"). That window is remotely
// debuggable and starts from an empty profile, and something about it trips Riot's automation
// checks; finding out which and hiding it is the line this project doesn't cross. Opening it from
// here every morning would also hand Riot a failed login with correct credentials every morning,
// which is how an account ends up locked. A normal browser is the one thing Riot accepts.
//
// Once per run, however many accounts expired — one browser holds one Riot session at a time, so
// a tab per account would only be a pile of identical pages. And only from a machine with a
// desktop: the other place this script runs, a phone holding a COPY of the session file, goes
// stale whenever the PC signs in again, and a push from there would announce a session the PC
// had already fixed, every morning, until the file was copied over.
async function askForSignIn(labels){
  const names = labels.map(l => JSON.stringify(l)).join(', ');
  if (!hasDesktop()) {
    console.log(`\n${names} need${labels.length === 1 ? 's' : ''} a fresh sign-in, on the PC — no desktop here, so no page opened and no push.`);
    return;
  }
  const opened = openBrowser && await openInDefaultBrowser(RIOT_AUTHORIZE_URL);
  await notifySessionExpired(labels, { pageOpened: opened });

  const line = '-'.repeat(76);
  console.log(`\n${line}`);
  console.log(`  Needs a fresh sign-in: ${names}`);
  console.log(opened ? "  Riot's sign-in page is open in your browser." : '  Sign in at https://playvalorant.com in your own browser.');
  console.log('  1. Sign in there as that account, the way you normally would.');
  console.log('  2. F12 -> Application -> Cookies -> https://auth.riotgames.com: copy "ssid" and "clid".');
  console.log("  3. Valorant tab -> 🔑 Re-login on that account's banner -> paste both. It re-checks");
  console.log('     the store as soon as they save (needs the local helper running). From a terminal');
  console.log('     instead: node scripts/valorant-login.mjs "<account>", then run this script again.');
  if (labels.length > 1) {
    console.log('  For the next account, sign in from a private/incognito window rather than signing');
    console.log('  out — signing out may end the session you just copied.');
  }
  console.log(line);
}

async function main(){
  const labels = requestedLabel ? [requestedLabel] : Object.keys(loadSessions());

  if (!labels.length) {
    console.error('No saved session found. Run `node scripts/valorant-login.mjs` first.');
    process.exitCode = 1;
    return;
  }

  const failed = new Map(); // label -> the store error it ended on
  for (const label of labels) {
    const error = await checkAccount(label);
    if (error) failed.set(label, error);
  }

  const needSignIn = [...failed].filter(([, error]) => isSessionError(error)).map(([label]) => label);
  if (needSignIn.length) await askForSignIn(needSignIn);

  if (failed.size) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
