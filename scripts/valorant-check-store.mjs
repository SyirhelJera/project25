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
// Usage:
//   node scripts/valorant-login.mjs [label]    (first, and again whenever a session expires —
//                                                every ~1-3 weeks; a new label tracks another
//                                                account alongside existing ones)
//   node scripts/valorant-check-store.mjs       (run this daily — checks every saved account —
//                                                see README.md for a Windows Task Scheduler setup)
//   node scripts/valorant-check-store.mjs main   (check only the "main" account)
//
// No npm dependencies — only valorant-login.mjs needs puppeteer, kept in scripts/package.json.

import { loadSessions, checkAccountStore, recordAccountResult, recordAccountError } from './valorant-lib.mjs';

async function main(){
  const sessions = loadSessions();
  const requestedLabel = (process.argv[2] || '').trim();
  const labels = requestedLabel ? [requestedLabel] : Object.keys(sessions);

  if (!labels.length) {
    console.error('No saved session found. Run `node scripts/valorant-login.mjs` first.');
    process.exitCode = 1;
    return;
  }

  let anyFailed = false;
  for (const label of labels) {
    const sess = sessions[label];
    if (!sess || !sess.ssid) {
      console.error(`No saved session for "${label}". Run \`node scripts/valorant-login.mjs ${label}\` first.`);
      anyFailed = true;
      continue;
    }
    console.log(`Checking store for "${label}"...`);
    try {
      const result = await checkAccountStore(label, sess);
      await recordAccountResult(label, result);
      // the night market is called out separately because it's the one panel that isn't always
      // there — a run that finds it is worth noticing in a log you'd otherwise skim
      console.log(`  done: ${result.items.length} skin(s)${result.accessories.length ? ` + ${result.accessories.length} accessory offer(s)` : ''}${result.bundle ? ' + featured bundle' : ''}${result.nightMarket ? ` + NIGHT MARKET (${result.nightMarket.offers.length} offers)` : ''}.`);
    } catch (err) {
      console.error(`  failed: ${err.message}`);
      await recordAccountError(label, err.message).catch(()=>{});
      anyFailed = true;
    }
  }

  if (anyFailed) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
