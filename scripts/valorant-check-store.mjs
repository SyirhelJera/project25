#!/usr/bin/env node
// scripts/valorant-check-store.mjs
//
// Fetches your personal Valorant daily storefront and writes it straight into the shared
// app_data row — the same row/anon-key the app itself already reads and writes with no login
// (see README.md "Persistence"), so no extra credentials are needed to save the result.
//
// Runs LOCALLY, on your own machine, deliberately. Riot's fraud/bot detection rejects this
// exact reauth flow when it comes from a cloud/datacenter IP (a Supabase Edge Function, in an
// earlier version of this script) — silently downgrading it to "must log in interactively
// again" instead of the normal silent reauth. Running from your own device, the same one that
// did the original interactive login, doesn't trip that check. See README.md for why this
// isn't a GitHub Actions / Edge Function job.
//
// Usage:
//   node scripts/valorant-login.mjs         (first, and again whenever the session expires —
//                                             every ~1-3 weeks)
//   node scripts/valorant-check-store.mjs   (run this daily — see README.md for setting up a
//                                             Windows Task Scheduler task to automate it)
//
// No npm dependencies — only valorant-login.mjs needs puppeteer, kept in scripts/package.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '.valorant-session.json');
const RIOT_USER_AGENT = 'RiotClient/60 rso-auth (Windows;10;;Professional, x64)';
const VALORANT_API_BASE = 'https://valorant-api.com/v1';

function readSupabaseConfig(){
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'persistence.js'), 'utf8');
  const url = /const SUPABASE_URL = '([^']*)'/.exec(src)?.[1];
  const anonKey = /const SUPABASE_ANON_KEY = '([^']*)'/.exec(src)?.[1];
  if (!url || !anonKey) throw new Error("Could not read SUPABASE_URL/SUPABASE_ANON_KEY from js/persistence.js");
  return { url, anonKey };
}

function parseFragment(url){
  const hashIdx = url.indexOf('#');
  return new URLSearchParams(hashIdx >= 0 ? url.slice(hashIdx + 1) : '');
}

function firstCostValue(cost){
  if (!cost) return 0;
  const vals = Object.values(cost);
  return vals.length ? vals[0] : 0;
}

async function writeAppData(mutate){
  const { url, anonKey } = readSupabaseConfig();
  const getResp = await fetch(`${url}/rest/v1/app_data?id=eq.shared&select=data`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const rows = await getResp.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.data) throw new Error('Could not read app_data row');
  const appData = row.data;
  mutate(appData);
  const patchResp = await fetch(`${url}/rest/v1/app_data?id=eq.shared`, {
    method: 'PATCH',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ data: appData, updated_at: new Date().toISOString() }),
  });
  if (!patchResp.ok) throw new Error(`Failed to save to Supabase: HTTP ${patchResp.status}`);
}

async function recordError(message){
  await writeAppData(appData => {
    appData.valorant = appData.valorant || {};
    appData.valorant.dailyStoreError = message;
  });
}

async function main(){
  if (!fs.existsSync(SESSION_FILE)) {
    console.error('No saved session found. Run `node scripts/valorant-login.mjs` first.');
    process.exitCode = 1;
    return;
  }
  const { ssid } = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (!ssid) {
    console.error('Saved session file is missing an ssid value. Run valorant-login.mjs again.');
    process.exitCode = 1;
    return;
  }

  // 1. Silent reauth using the saved cookie.
  const authResp = await fetch(
    'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid',
    { redirect: 'manual', headers: { Cookie: `ssid=${ssid}`, 'User-Agent': RIOT_USER_AGENT } },
  );
  const location = authResp.headers.get('location') || '';
  const frag = parseFragment(location);
  const accessToken = frag.get('access_token');
  const idToken = frag.get('id_token');
  if (!accessToken || !idToken) {
    console.error('Reauth failed — session likely expired. Run `node scripts/valorant-login.mjs` again.');
    console.error(`(status: ${authResp.status}, redirected to: ${location || '<none>'})`);
    await recordError('Valorant session expired — run scripts/valorant-login.mjs again on this machine.').catch(()=>{});
    process.exitCode = 1;
    return;
  }

  // 2. Entitlements token.
  const entResp = await fetch('https://entitlements.auth.riotgames.com/api/token/v1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': RIOT_USER_AGENT },
    body: '{}',
  });
  if (!entResp.ok) { console.error('Entitlements request failed:', entResp.status); process.exitCode = 1; return; }
  const { entitlements_token: entitlementsToken } = await entResp.json();

  // 3. PUUID.
  const userResp = await fetch('https://auth.riotgames.com/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': RIOT_USER_AGENT },
  });
  const userInfo = await userResp.json();
  const puuid = userInfo?.sub;
  if (!puuid) { console.error('Could not resolve PUUID.'); process.exitCode = 1; return; }

  // 4. Shard.
  const geoResp = await fetch('https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': RIOT_USER_AGENT },
    body: JSON.stringify({ id_token: idToken }),
  });
  const geo = await geoResp.json();
  const shard = geo?.affinities?.live;
  if (!shard) { console.error('Could not resolve shard.'); process.exitCode = 1; return; }

  // 5. Current client version.
  const verResp = await fetch(`${VALORANT_API_BASE}/version`);
  const verData = await verResp.json();
  const clientVersion = verData?.data?.riotClientVersion;

  const clientPlatform = Buffer.from(JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  })).toString('base64');

  // 6. The actual storefront. v2 GET 404s (empty body, i.e. wrong route rather than a rejected
  // auth) as of mid-2026 — Riot moved this to v3 POST. Try v3 first, fall back to v2 GET for
  // safety in case that changes again.
  const commonHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'X-Riot-Entitlements-JWT': entitlementsToken,
    'X-Riot-ClientVersion': clientVersion || '',
    'X-Riot-ClientPlatform': clientPlatform,
    'User-Agent': RIOT_USER_AGENT,
  };
  let storeResp = await fetch(`https://pd.${shard}.a.pvp.net/store/v3/storefront/${puuid}`, {
    method: 'POST',
    headers: { ...commonHeaders, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!storeResp.ok) {
    console.log(`v3 storefront POST failed (HTTP ${storeResp.status}), trying v2 GET as fallback`);
    storeResp = await fetch(`https://pd.${shard}.a.pvp.net/store/v2/storefront/${puuid}`, {
      headers: commonHeaders,
    });
  }
  if (!storeResp.ok) {
    const body = await storeResp.text().catch(() => '');
    console.error('Storefront request failed:', storeResp.status, 'body:', body.slice(0, 500) || '<empty>');
    await recordError(`Storefront request failed (HTTP ${storeResp.status}).`).catch(()=>{});
    process.exitCode = 1;
    return;
  }
  const store = await storeResp.json();

  // 7. Resolve skin/bundle uuids into display names, images, prices via valorant-api.com
  // (public, keyless — same reference API the app already uses for rank tier icons).
  const offerUuids = store?.SkinsPanelLayout?.SingleItemOffers || [];
  const costsByUuid = {};
  (store?.SkinsPanelLayout?.SingleItemStoreOffers || []).forEach(o => { costsByUuid[o.OfferID] = o.Cost; });
  const items = await Promise.all(offerUuids.map(async (uuid) => {
    const price = firstCostValue(costsByUuid[uuid]);
    try {
      const r = await fetch(`${VALORANT_API_BASE}/weapons/skinlevels/${uuid}`);
      const j = await r.json();
      return { uuid, name: j?.data?.displayName || 'Unknown skin', imageUrl: j?.data?.displayIcon || '', price };
    } catch {
      return { uuid, name: 'Unknown skin', imageUrl: '', price };
    }
  }));

  let bundle = null;
  const bundleId = store?.FeaturedBundle?.Bundle?.DataAssetID;
  if (bundleId) {
    try {
      const r = await fetch(`${VALORANT_API_BASE}/bundles/${bundleId}`);
      const j = await r.json();
      bundle = {
        name: j?.data?.displayName || 'Featured Bundle',
        imageUrl: j?.data?.displayIcon || '',
        price: firstCostValue(store?.FeaturedBundle?.Bundle?.TotalBaseCost) || 0,
        remainingSeconds: store?.FeaturedBundle?.BundleRemainingDurationInSeconds || 0,
      };
    } catch { /* featured bundle is a nice-to-have — a lookup failure shouldn't fail the whole check */ }
  }

  await writeAppData(appData => {
    appData.valorant = appData.valorant || {};
    appData.valorant.dailyStore = { checkedAt: Date.now(), items, bundle };
    appData.valorant.dailyStoreError = '';
  });

  console.log(`Store updated: ${items.length} skin(s)${bundle ? ' + featured bundle' : ''}.`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
