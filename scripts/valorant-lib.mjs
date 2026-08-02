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
const NOTIFY_CONFIG_FILE = path.join(__dirname, '.valorant-notify-config.json');

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

// These three calls used to GET the entire app_data row (every embedded image and all, see
// js/persistence.js's comment on why that row can be large), mutate one key in JS, then PATCH
// the whole thing back — meaning every daily store check, "Check Store Now" click, and account
// deletion pulled the *whole* shared row over the wire just to touch one small field. They now
// call three Postgres functions (jsonb_set/delete server-side, no read at all) created by
// running supabase/setup-egress-fix.sql once in the Supabase SQL editor.
async function callRpc(fn, args){
  const { url, anonKey } = readSupabaseConfig();
  const resp = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!resp.ok) throw new Error(`Failed to save to Supabase: HTTP ${resp.status} ${await resp.text().catch(() => '')}`);
}

export async function recordAccountResult(label, result){
  await callRpc('valorant_set_daily_store', { p_label: label, p_result: result });
  await notifyWishlistMatches(label, result.items).catch(err => console.error(`  wishlist notify failed: ${err.message}`));
}

export async function recordAccountError(label, message){
  await callRpc('valorant_set_daily_store_error', { p_label: label, p_message: message });
}

// Removes a deleted account's store data from the shared app_data row so it stops showing up in
// the Valorant tab (the account dropdown, "All accounts" view, etc.) once its saved session is
// gone. Called after the session itself is removed from loadSessions()/saveSessions().
export async function deleteAccountStore(label){
  await callRpc('valorant_delete_daily_store', { p_label: label });
}

// Same three-RPC pattern as the daily-store functions above, but for the owned-skins snapshot
// (see checkAccountOwnedSkins()) — a separate key (valorant.ownedSkins[label]) so it doesn't
// collide with or get overwritten by dailyStores. Requires
// supabase/setup-valorant-inventory.sql to have been run once.
export async function recordOwnedSkinsResult(label, result){
  await callRpc('valorant_set_owned_skins', { p_label: label, p_result: result });
}
export async function recordOwnedSkinsError(label, message){
  await callRpc('valorant_set_owned_skins_error', { p_label: label, p_message: message });
}
export async function deleteAccountOwnedSkins(label){
  await callRpc('valorant_delete_owned_skins', { p_label: label });
}

// Push notification (via ntfy.sh) when a wishlisted skin rotates into the store. Opt-in: silently
// does nothing until scripts/.valorant-notify-config.json exists (gitignored, see README), so
// nobody's daily check breaks just because they haven't set this up.
function loadNotifyConfig(){
  if(!fs.existsSync(NOTIFY_CONFIG_FILE)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(NOTIFY_CONFIG_FILE, 'utf8'));
    return cfg && cfg.ntfyTopic ? cfg : null;
  } catch {
    return null;
  }
}

// Same case-insensitive, either-direction substring match as valWishlistMatchesForItem in
// js/valorant.js — kept in sync with that since matching is now duplicated server-side here.
function wishlistMatchesForItem(itemName, wishlist){
  const lower = (itemName || '').toLowerCase();
  return (wishlist || []).filter(w => {
    const wl = (w.name || '').toLowerCase().trim();
    return wl && (lower.includes(wl) || wl.includes(lower));
  });
}

// Fetches label's wishlist (via the read-only valorant_get_wishlist RPC — see
// supabase/setup-valorant-notify.sql), checks it against this run's store items, and fires an
// ntfy.sh push for any matches. No dedupe: every run that finds a wishlist match pushes a
// notification, even if a previous run today already flagged the same skin.
export async function notifyWishlistMatches(label, items){
  const config = loadNotifyConfig();
  if (!config) return;

  const { url, anonKey } = readSupabaseConfig();
  const resp = await fetch(`${url}/rest/v1/rpc/valorant_get_wishlist`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_label: label }),
  });
  if (!resp.ok) return;
  const wishlist = await resp.json();
  if (!Array.isArray(wishlist) || !wishlist.length) return;

  const matched = (items || []).filter(it => wishlistMatchesForItem(it.name, wishlist).length);
  if (!matched.length) return;

  await fetch(`https://ntfy.sh/${encodeURIComponent(config.ntfyTopic)}`, {
    method: 'POST',
    headers: { Title: 'Valorant shop alert', Priority: 'high', Tags: 'gun' },
    body: `${label}: ${matched.map(it => it.name).join(', ')} just rotated into today's store!`,
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

// Known tier names, ordered lowest -> highest rarity/price. valorant-api.com's contenttiers
// objects don't reliably expose a numeric rank, and Riot's tier devNames vary in casing/prefix
// (e.g. "EONS/Deluxe", "Deluxe"), so tier resolution below matches by substring against this list
// instead of trusting a specific field — same "don't trust the exact shape" posture as the rest
// of this file's Riot/valorant-api.com calls.
const SKIN_TIERS = ['Select', 'Deluxe', 'Premium', 'Exclusive', 'Ultra'];
function resolveTierRank(devNameOrDisplayName){
  const s = (devNameOrDisplayName || '').toLowerCase();
  for (let i = SKIN_TIERS.length - 1; i >= 0; i--) {
    if (s.includes(SKIN_TIERS[i].toLowerCase())) return i;
  }
  return -1; // unrecognized tier (e.g. the free "Standard" tier) — sorts below everything named
}

// Bulk-fetches the skin catalog from valorant-api.com once, building a skin-LEVEL uuid ->
// {skinUuid, name, imageUrl, tierName, tierRank, weaponType} lookup, where name/imageUrl/tier
// come from the *parent skin*, not the individual level — Riot grants a separate entitlement per
// level (unlocking a skin unlocks all of its levels/finishers at once), so without collapsing
// back to skinUuid a 4-level skin would show up as 4 entries.
//
// Pulls from two different endpoints for two different reasons, rather than just the nested
// /v1/weapons (which would seem to have everything in one call): a first version of this used
// only /v1/weapons and got every owned skin's tier resolving to nothing (skin.contentTierUuid
// came back missing there) — /v1/weapons/skins is the flat, known-reliable source for tier, name,
// and icon. /v1/weapons is used *only* for its category field, since a skin has no weapon type of
// its own — only its parent weapon does, and that field isn't on the flat list.
//
// Also used to recognize which of Riot's entitlement-type buckets is "skins" (see
// checkAccountOwnedSkins() below): whichever bucket's ItemIDs actually appear in this map.
async function fetchSkinCatalog(){
  const [skinsResp, weaponsResp, tiersResp] = await Promise.all([
    fetch(`${VALORANT_API_BASE}/weapons/skins`),
    fetch(`${VALORANT_API_BASE}/weapons`),
    fetch(`${VALORANT_API_BASE}/contenttiers`),
  ]);
  const skinsJson = await skinsResp.json();
  const weaponsJson = await weaponsResp.json();
  const tiersJson = await tiersResp.json();

  const tiersByUuid = {};
  (tiersJson?.data || []).forEach(t => {
    tiersByUuid[t.uuid] = { name: t.displayName || t.devName || 'Unknown', rank: resolveTierRank(t.devName || t.displayName) };
  });

  const weaponTypeBySkinUuid = {};
  (weaponsJson?.data || []).forEach(weapon => {
    // category comes back like "EEquippableCategory::Rifle" — just want the "Rifle" part.
    const weaponType = (weapon.category || '').split('::').pop() || 'Other';
    (weapon.skins || []).forEach(skin => { if (skin?.uuid) weaponTypeBySkinUuid[skin.uuid] = weaponType; });
  });

  const levelsByUuid = {};
  let unresolvedTierCount = 0;
  (skinsJson?.data || []).forEach(skin => {
    const tier = tiersByUuid[skin.contentTierUuid];
    if (!tier) unresolvedTierCount++;
    (skin.levels || []).forEach(level => {
      if (!level?.uuid) return;
      levelsByUuid[level.uuid] = {
        skinUuid: skin.uuid,
        name: skin.displayName || 'Unknown skin',
        imageUrl: skin.displayIcon || level.displayIcon || '',
        tierName: tier ? tier.name : 'Standard',
        tierRank: tier ? tier.rank : -1,
        weaponType: weaponTypeBySkinUuid[skin.uuid] || 'Other',
      };
    });
  });
  // Debug visibility — if this count is anywhere near the total skin count, contentTierUuid (or
  // the contenttiers lookup) isn't resolving and every owned skin will render the same "Standard"
  // gray, same failure mode this replaced.
  console.log(`  [skin catalog] ${(skinsJson?.data||[]).length} skin(s), ${unresolvedTierCount} with no tier resolved.`);
  return levelsByUuid;
}

// Runs the full silent-reauth -> every-owned-skin fetch for one saved Riot session. Fetches ALL
// entitlement types at once (rather than guessing Riot's internal itemTypeId for "skins", which
// turned out to be unreliable) and picks out whichever type bucket's ItemIDs actually resolve
// against the skin catalog above — sidesteps needing to know that ID at all. Returns
// { checkedAt, skins, error:'' } on success or throws with a user-facing message, same
// shape/contract as checkAccountStore() above. Runs its own reauth independently rather than
// sharing a session with checkAccountStore() — a little more Riot traffic per manual click, but
// keeps that already-working function untouched.
export async function checkAccountOwnedSkins(label, ssid){
  let accessToken, idToken;
  try {
    ({ accessToken, idToken } = await silentReauth(ssid));
  } catch {
    throw new Error(`Valorant session expired — run \`node scripts/valorant-login.mjs ${label}\` again to save a fresh cookie.`);
  }

  const entResp = await fetch('https://entitlements.auth.riotgames.com/api/token/v1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': RIOT_USER_AGENT },
    body: '{}',
  });
  if (!entResp.ok) throw new Error(`Entitlements request failed (HTTP ${entResp.status}).`);
  const { entitlements_token: entitlementsToken } = await entResp.json();

  const userResp = await fetch('https://auth.riotgames.com/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': RIOT_USER_AGENT },
  });
  const userInfo = await userResp.json();
  const puuid = userInfo?.sub;
  if (!puuid) throw new Error('Could not resolve PUUID.');

  const geoResp = await fetch('https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': RIOT_USER_AGENT },
    body: JSON.stringify({ id_token: idToken }),
  });
  const geo = await geoResp.json();
  const shard = geo?.affinities?.live;
  if (!shard) throw new Error('Could not resolve shard.');

  // pd.*.a.pvp.net rejects requests missing these two (HTTP 400) — same requirement as the
  // storefront fetch in checkAccountStore() above, just easy to miss since this endpoint's
  // headers aren't documented anywhere official.
  const verResp = await fetch(`${VALORANT_API_BASE}/version`);
  const verData = await verResp.json();
  const clientVersion = verData?.data?.riotClientVersion;
  const clientPlatform = Buffer.from(JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  })).toString('base64');

  // No itemTypeId in the path this time — fetch every entitlement type at once and figure out
  // which bucket is "skins" ourselves (see the catalog-overlap check below).
  const entitlementsResp = await fetch(`https://pd.${shard}.a.pvp.net/store/v1/entitlements/${puuid}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Riot-Entitlements-JWT': entitlementsToken,
      'X-Riot-ClientVersion': clientVersion || '',
      'X-Riot-ClientPlatform': clientPlatform,
      'User-Agent': RIOT_USER_AGENT,
    },
  });
  if (!entitlementsResp.ok) {
    const body = await entitlementsResp.text().catch(() => '');
    console.error('  entitlements body:', body.slice(0, 500) || '<empty>');
    throw new Error(`Owned-skins lookup failed (HTTP ${entitlementsResp.status}).`);
  }
  const entData = await entitlementsResp.json();
  const groups = entData?.EntitlementsByTypes || [];
  console.log(`  [entitlements] ${groups.length} item-type group(s): ${groups.map(g => `${g.ItemTypeID} (${(g.Entitlements||[]).length})`).join(', ') || '(none)'}`);

  const skinCatalog = await fetchSkinCatalog();
  console.log(`  [skin catalog] ${Object.keys(skinCatalog).length} skin level(s) known.`);

  // The group whose ItemIDs overlap the skin catalog most is "skins" — sidesteps needing to know
  // Riot's itemTypeId for that bucket, which turned out to be unreliable to guess (see git history
  // for the itemTypeId this used to hardcode).
  let bestGroup = null, bestOverlap = -1;
  groups.forEach(g => {
    const overlap = (g.Entitlements || []).reduce((n, e) => n + (skinCatalog[e.ItemID] ? 1 : 0), 0);
    if (overlap > bestOverlap) { bestOverlap = overlap; bestGroup = g; }
  });
  console.log(`  [owned skins] best-matching group: ${bestGroup ? bestGroup.ItemTypeID : '(none)'} with ${bestOverlap} skin-level entitlement(s) recognized.`);

  // Dedupe by parent skin — owning any one level entitles you to all of that skin's levels, so
  // without this a skin with 4 levels would show up as 4 separate entries.
  const bySkinUuid = new Map();
  ((bestGroup && bestGroup.Entitlements) || []).forEach(e => {
    const info = skinCatalog[e.ItemID];
    if (info && !bySkinUuid.has(info.skinUuid)) bySkinUuid.set(info.skinUuid, info);
  });
  const skins = [...bySkinUuid.entries()].map(([uuid, info]) => ({
    uuid, name: info.name, imageUrl: info.imageUrl, tierName: info.tierName, tierRank: info.tierRank, weaponType: info.weaponType,
  }));
  skins.sort((a,b) => b.tierRank - a.tierRank || a.name.localeCompare(b.name));
  console.log(`  [owned skins] ${skins.length} distinct skin(s) after deduping levels.`);

  return { checkedAt: Date.now(), skins, error: '' };
}
