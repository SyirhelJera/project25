// scripts/valorant-lib.mjs
//
// Shared, dependency-free helpers for the Valorant local scripts (valorant-login.mjs,
// valorant-check-store.mjs, valorant-local-server.mjs): saved-session storage, reading/writing
// the shared Supabase app_data row, and the actual Riot storefront fetch. Deliberately doesn't
// import puppeteer — only valorant-login.mjs's browser-login flow needs it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SESSION_FILE = path.join(__dirname, '.valorant-session.json');
const RIOT_USER_AGENT = 'RiotClient/60 rso-auth (Windows;10;;Professional, x64)';
const VALORANT_API_BASE = 'https://valorant-api.com/v1';

// Sessions are stored as { accounts: { <label>: { ssid, savedAt } } } so multiple Riot accounts
// can be tracked at once. Transparently upgrades the older single-session file shape (which had
// `ssid`/`savedAt` at the top level) into an account labeled "default" the first time it's read.
export function loadSessions(){
  if(!fs.existsSync(SESSION_FILE)) return {};
  const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (raw && raw.ssid && !raw.accounts) return { default: { ssid: raw.ssid, savedAt: raw.savedAt } };
  return raw.accounts || {};
}
export function saveSessions(accounts){
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ accounts }, null, 2));
}

export function readSupabaseConfig(){
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

export async function writeAppData(mutate){
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

export async function recordAccountResult(label, result){
  await writeAppData(appData => {
    appData.valorant = appData.valorant || {};
    appData.valorant.dailyStores = appData.valorant.dailyStores || {};
    appData.valorant.dailyStores[label] = result;
  });
}

export async function recordAccountError(label, message){
  await writeAppData(appData => {
    appData.valorant = appData.valorant || {};
    appData.valorant.dailyStores = appData.valorant.dailyStores || {};
    // keep whatever store data this account last successfully fetched — only the error changes
    appData.valorant.dailyStores[label] = { ...(appData.valorant.dailyStores[label] || {}), error: message };
  });
}

// Removes a deleted account's store data from the shared app_data row so it stops showing up in
// the Valorant tab (the account dropdown, "All accounts" view, etc.) once its saved session is
// gone. Called after the session itself is removed from loadSessions()/saveSessions().
export async function deleteAccountStore(label){
  await writeAppData(appData => {
    if (appData.valorant && appData.valorant.dailyStores) delete appData.valorant.dailyStores[label];
  });
}

// Redeems a saved `ssid` cookie for a fresh access/id token pair, the same silent reauth Riot's
// own client does. Throws a user-facing error if the cookie is missing, wrong, or expired —
// shared by checkAccountStore() below and valorant-login.mjs's loginAccount() (which uses it
// just to confirm a freshly-pasted cookie actually works before saving it).
export async function silentReauth(ssid){
  const authResp = await fetch(
    'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid',
    { redirect: 'manual', headers: { Cookie: `ssid=${ssid}`, 'User-Agent': RIOT_USER_AGENT } },
  );
  const location = authResp.headers.get('location') || '';
  const frag = parseFragment(location);
  const accessToken = frag.get('access_token');
  const idToken = frag.get('id_token');
  if (!accessToken || !idToken) {
    throw new Error('That session cookie is invalid or expired — log in again in your browser and copy a fresh ssid value.');
  }
  return { accessToken, idToken };
}

// Runs the full silent-reauth -> storefront fetch for one saved Riot session. Returns
// { checkedAt, items, bundle, error:'' } on success or throws an Error with a user-facing message.
export async function checkAccountStore(label, ssid){
  let accessToken, idToken;
  try {
    ({ accessToken, idToken } = await silentReauth(ssid));
  } catch {
    throw new Error(`Valorant session expired — run \`node scripts/valorant-login.mjs ${label}\` again to save a fresh cookie.`);
  }

  // 2. Entitlements token.
  const entResp = await fetch('https://entitlements.auth.riotgames.com/api/token/v1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': RIOT_USER_AGENT },
    body: '{}',
  });
  if (!entResp.ok) throw new Error(`Entitlements request failed (HTTP ${entResp.status}).`);
  const { entitlements_token: entitlementsToken } = await entResp.json();

  // 3. PUUID.
  const userResp = await fetch('https://auth.riotgames.com/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': RIOT_USER_AGENT },
  });
  const userInfo = await userResp.json();
  const puuid = userInfo?.sub;
  if (!puuid) throw new Error('Could not resolve PUUID.');

  // 4. Shard.
  const geoResp = await fetch('https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': RIOT_USER_AGENT },
    body: JSON.stringify({ id_token: idToken }),
  });
  const geo = await geoResp.json();
  const shard = geo?.affinities?.live;
  if (!shard) throw new Error('Could not resolve shard.');

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
    console.log(`  v3 storefront POST failed (HTTP ${storeResp.status}), trying v2 GET as fallback`);
    storeResp = await fetch(`https://pd.${shard}.a.pvp.net/store/v2/storefront/${puuid}`, {
      headers: commonHeaders,
    });
  }
  if (!storeResp.ok) {
    const body = await storeResp.text().catch(() => '');
    console.error('  storefront body:', body.slice(0, 500) || '<empty>');
    throw new Error(`Storefront request failed (HTTP ${storeResp.status}).`);
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

  return { checkedAt: Date.now(), items, bundle, error: '' };
}
