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
// exported for valorant-live.mjs, which builds its own (memoized) auth ladder for the live-match
// panel — see the comment above its ensureLiveAuth(). The two ladders below stay as they are.
export const RIOT_USER_AGENT = 'RiotClient/60 rso-auth (Windows;10;;Professional, x64)';
export const VALORANT_API_BASE = 'https://valorant-api.com/v1';
const NOTIFY_CONFIG_FILE = path.join(__dirname, '.valorant-notify-config.json');
const STORE_SNAPSHOT_FILE = path.join(__dirname, '.valorant-latest-store.json');

// Sessions are stored as { accounts: { <label>: { ssid, savedAt } } } so multiple Riot accounts
// can be tracked at once. Transparently upgrades the older single-session file shape (which had
// `ssid`/`savedAt` at the top level) into an account labeled "default" the first time it's read.
export function loadSessions(){
  if(!fs.existsSync(SESSION_FILE)) return {};
  const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (raw && raw.ssid && !raw.accounts) return { default: { ssid: raw.ssid, clid: raw.clid, savedAt: raw.savedAt } };
  return raw.accounts || {};
}
export function saveSessions(accounts){
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ accounts }, null, 2));
}

// Local mirror of the last store result per account, written alongside the Supabase write below
// purely so scripts/valorant-widget.ps1 (the desktop widget) has something to read without
// pulling the whole shared app_data row — or any network at all — every time it refreshes.
// Shape: { updatedAt, accounts: { <label>: { ...checkAccountStore() result, wishlisted:[names] } } }.
// Nothing else consumes this file: it's a cache, safe to delete, and rewritten by the next check.
export function readStoreSnapshot(){
  if(!fs.existsSync(STORE_SNAPSHOT_FILE)) return { updatedAt: 0, accounts: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_SNAPSHOT_FILE, 'utf8'));
    return { updatedAt: raw.updatedAt || 0, accounts: raw.accounts || {} };
  } catch {
    return { updatedAt: 0, accounts: {} };
  }
}

// Never throws: the widget's convenience cache must not be able to fail a store check.
export function writeStoreSnapshot(label, entry){
  try {
    const snap = readStoreSnapshot();
    snap.accounts[label] = entry;
    snap.updatedAt = Date.now();
    fs.writeFileSync(STORE_SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
  } catch (err) {
    console.error(`  (could not write local widget snapshot: ${err.message})`);
  }
}

// The widget reads this file and nothing else (see the comment on writeStoreSnapshot), so a
// rename that skipped it would leave the widget showing the old name until the next check.
export function renameStoreSnapshot(from, to){
  try {
    const snap = readStoreSnapshot();
    if (!(from in snap.accounts)) return;
    snap.accounts[to] = snap.accounts[from];
    delete snap.accounts[from];
    snap.updatedAt = Date.now();
    fs.writeFileSync(STORE_SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
  } catch { /* cache-only — the next check rewrites it under the new name anyway */ }
}

export function deleteStoreSnapshot(label){
  try {
    const snap = readStoreSnapshot();
    if (!(label in snap.accounts)) return;
    delete snap.accounts[label];
    snap.updatedAt = Date.now();
    fs.writeFileSync(STORE_SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
  } catch { /* cache-only — a stale entry here is harmless */ }
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

// Every purchasable thing in one store check, flattened and tagged with the panel it came from.
// The wishlist is matched against all of it: a skin you're waiting for can arrive inside the
// featured bundle or the night market just as easily as in the four daily offers, and a
// gun buddy or card can arrive in the accessory shop — a watch that only ever read `items` stayed
// silent through all three.
export function collectOfferedItems(result){
  const out = [];
  (result?.items || []).forEach(it => out.push({ name: it.name, source: 'daily store' }));
  (result?.nightMarket?.offers || []).forEach(it => out.push({ name: it.name, source: 'night market' }));
  (result?.bundle?.items || []).forEach(it => out.push({ name: it.name, source: 'bundle' }));
  (result?.accessories || []).forEach(it => out.push({ name: it.name, source: 'accessory shop' }));
  return out;
}

export async function recordAccountResult(label, result){
  // Wishlist first, then the local snapshot, then Supabase: the snapshot is what the desktop
  // widget reads, so writing it before the network call means a Supabase outage leaves the widget
  // showing today's real store rather than yesterday's. callRpc still throws on failure, so the
  // caller's error handling is unchanged.
  const wishlist = await fetchWishlist(label);
  const offered = collectOfferedItems(result);
  writeStoreSnapshot(label, {
    ...result,
    wishlisted: offered.filter(it => wishlistMatchesForItem(it.name, wishlist).length).map(it => it.name),
  });
  await callRpc('valorant_set_daily_store', { p_label: label, p_result: result });
  await notifyWishlistMatches(label, offered, wishlist).catch(err => console.error(`  wishlist notify failed: ${err.message}`));
}

export async function recordAccountError(label, message){
  // Mirror the failure into the snapshot too (keeping the last known items visible underneath),
  // so the widget can show "session expired" the same way the Valorant tab's banner does.
  const prev = readStoreSnapshot().accounts[label] || {};
  writeStoreSnapshot(label, { ...prev, error: message, erroredAt: Date.now() });
  await callRpc('valorant_set_daily_store_error', { p_label: label, p_message: message });
}

// Removes a deleted account's store data from the shared app_data row so it stops showing up in
// the Valorant tab (the account dropdown, "All accounts" view, etc.) once its saved session is
// gone. Called after the session itself is removed from loadSessions()/saveSessions().
export async function deleteAccountStore(label){
  deleteStoreSnapshot(label);
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

// Reads one account's wishlist via the read-only valorant_get_wishlist RPC (see
// supabase/setup-valorant-notify.sql). Returns [] on any failure — including the RPC simply not
// existing, which is the normal state for anyone who hasn't run that SQL file — because both
// callers (the ntfy push below, the widget snapshot above) treat a wishlist as a nice-to-have.
export async function fetchWishlist(label){
  try {
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
    if (!resp.ok) return [];
    const wishlist = await resp.json();
    return Array.isArray(wishlist) ? wishlist : [];
  } catch {
    return [];
  }
}

// Checks label's wishlist against everything this run found for sale — collectOfferedItems()
// flattens all four panels, and each entry may carry a `source` so the push can say *where* the
// hit is (a bundle is a very different call from a daily offer). No dedupe: every run that finds
// a wishlist match pushes a notification, even if a previous run today already flagged the same
// skin. `wishlist` is passed in by recordAccountResult() (which already fetched it for the widget
// snapshot) to avoid a second RPC round trip; it's fetched here when called without one.
export async function notifyWishlistMatches(label, items, wishlist){
  const config = loadNotifyConfig();
  if (!config) return;

  const list = wishlist || await fetchWishlist(label);
  if (!list.length) return;

  const matched = (items || []).filter(it => wishlistMatchesForItem(it.name, list).length);
  if (!matched.length) return;

  await fetch(`https://ntfy.sh/${encodeURIComponent(config.ntfyTopic)}`, {
    method: 'POST',
    headers: { Title: 'Valorant shop alert', Priority: 'high', Tags: 'gun' },
    body: `${label}: ${matched.map(it => it.source ? `${it.name} (${it.source})` : it.name).join(', ')} — wishlisted and on sale right now!`,
  });
}

// Redeems a saved `ssid` cookie for a fresh access/id token pair, the same silent reauth Riot's
// own client does. Throws a user-facing error if the cookie is missing, wrong, or expired —
// shared by checkAccountStore() below and valorant-login.mjs's loginAccount() (which uses it
// just to confirm a freshly-pasted cookie actually works before saving it).
// The exact URL clicking "Sign In" on playvalorant.com navigates to — Riot's own web client's
// OAuth entry point. silentReauth() replays it with a saved cookie; valorant-login-window.mjs
// opens it in a real browser window so a human can sign in there and mint a fresh one.
export const RIOT_AUTHORIZE_URL = 'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid';

// A saved session is a small cookie jar, not one cookie. `ssid` identifies the session and
// `clid` identifies the client it was issued to, and Riot requires BOTH: an ssid-only request is
// answered with 303 -> authenticate.riotgames.com/login, which is indistinguishable from a genuinely
// expired session and is exactly why a freshly-copied cookie could still read as "session expired".
// The rest are sent when present because they cost nothing and the browser sends them too; only
// ssid and clid are known to matter (tdid and csid were tested and don't).
const SESSION_COOKIE_NAMES = ['ssid', 'clid', 'csid', 'tdid', 'ccid', 'asid', 'sub'];

// Accepts a session record ({ssid, clid, ...}) or, for callers that predate the clid requirement,
// a bare ssid string — which will fail the reauth, but with a message that says why.
export function sessionCookieHeader(session){
  const jar = typeof session === 'string' ? { ssid: session } : (session || {});
  return SESSION_COOKIE_NAMES.filter(n => jar[n]).map(n => `${n}=${jar[n]}`).join('; ');
}

export async function silentReauth(session){
  const jar = typeof session === 'string' ? { ssid: session } : (session || {});
  if (!jar.ssid) throw new Error('No saved session for this account.');

  const authResp = await fetch(
    RIOT_AUTHORIZE_URL,
    { redirect: 'manual', headers: { Cookie: sessionCookieHeader(jar), 'User-Agent': RIOT_USER_AGENT } },
  );
  const location = authResp.headers.get('location') || '';
  const frag = parseFragment(location);
  const accessToken = frag.get('access_token');
  const idToken = frag.get('id_token');
  if (!accessToken || !idToken) {
    // Worth separating from "expired": with no clid the reauth goes to Riot's default auth
    // cluster, which only works if that's where this session happens to live (it does for some
    // accounts, not others). Retrying the same ssid can't fix it — the clid cookie can.
    // The word "incomplete" is load-bearing: js/valorant.js matches it to offer Re-login.
    if (!jar.clid) {
      throw new Error('Valorant session incomplete — Riot refused it with only the ssid cookie. It also needs "clid", which sits right beside ssid under auth.riotgames.com.');
    }
    throw new Error('That session is invalid or expired — log in again to save a fresh one.');
  }
  return { accessToken, idToken };
}

// The accessory shop (Kingdom Credits, refreshes weekly) sells sprays/buddies/cards/titles rather
// than gun skins, so each offer has to be resolved against a *different* valorant-api.com endpoint
// depending on Riot's ItemTypeID for its reward. These type uuids are stable, community
// reverse-engineered constants — an unrecognized one degrades to a nameless "Accessory" tile
// rather than failing the whole store check (Riot has added new accessory types before).
const ACCESSORY_ITEM_TYPES = {
  'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475': { label: 'Spray', path: 'sprays', icon: d => d.fullTransparentIcon || d.displayIcon || '' },
  'dd3bf334-87f3-40bd-b043-682a57a8dc3a': { label: 'Gun Buddy', path: 'buddies/levels', icon: d => d.displayIcon || '' },
  // player cards come with three crops of the same art; the wide banner is the one that fills a
  // grid tile without shrinking to a sliver next to the square spray/buddy icons — but all three
  // are kept in `art` so the tile's preview modal can show the vertical version too (that's the
  // one that actually renders on your in-game profile, and it's not derivable from the others)
  '3f296c07-64c3-494c-923b-fe692a4fa1bd': {
    label: 'Player Card',
    path: 'playercards',
    icon: d => d.wideArt || d.displayIcon || d.smallArt || '',
    art: d => ({ wide: d.wideArt || '', large: d.largeArt || '', small: d.smallArt || '' }),
  },
  // titles are pure text — no art of any kind exists for them, so the tile renders titleText instead
  'de7caa6b-adf7-4588-bbd1-143831e786c6': { label: 'Player Title', path: 'playertitles', icon: () => '' },
  'e7c63390-eda7-46e0-bb7a-a6abdacd2433': { label: 'Skin', path: 'weapons/skinlevels', icon: d => d.displayIcon || '' },
};

// Resolves one accessory-store reward ({ItemTypeID, ItemID}) into display data. Never throws —
// an unknown type or a failed lookup still returns a renderable tile, same posture as the
// per-skin lookups in checkAccountStore().
async function resolveAccessoryReward(reward){
  const uuid = reward?.ItemID || '';
  const type = ACCESSORY_ITEM_TYPES[reward?.ItemTypeID];
  if (!type) return { uuid, name: 'Unknown item', imageUrl: '', text: '', type: 'Accessory', art: null };
  try {
    const r = await fetch(`${VALORANT_API_BASE}/${type.path}/${uuid}`);
    const d = (await r.json())?.data || {};
    return {
      uuid,
      name: d.displayName || type.label,
      imageUrl: type.icon(d),
      text: d.titleText || '',
      type: type.label,
      // only player cards ship multiple crops; everything else has a single icon and stays null
      art: type.art ? type.art(d) : null,
    };
  } catch {
    return { uuid, name: `Unknown ${type.label}`, imageUrl: '', text: '', type: type.label, art: null };
  }
}

// The player card equipped on the account right now, resolved into the same three crops a player
// card gets in the accessory shop (see ACCESSORY_ITEM_TYPES above). Purely cosmetic — the Valorant
// tab shows it beside each account's store header so several tracked accounts are tellable apart
// at a glance without reading their labels. Never throws: a failure here degrades to no avatar,
// same posture as the featured-bundle lookup, since neither is worth failing a store check over.
async function fetchEquippedIdentity(shard, puuid, headers){
  try {
    const r = await fetch(`https://pd.${shard}.a.pvp.net/personalization/v2/players/${puuid}/playerloadout`, { headers });
    if (!r.ok) {
      // noisy enough to notice if Riot moves this route (the tab would otherwise just quietly
      // stop drawing avatars), quiet enough that it can't be mistaken for a failed store check
      console.log(`  (loadout lookup skipped: HTTP ${r.status})`);
      return null;
    }
    const ident = (await r.json())?.Identity || {};
    const cardId = ident.PlayerCardID;
    if (!cardId) return null;
    const c = await fetch(`${VALORANT_API_BASE}/playercards/${cardId}`);
    const d = (await c.json())?.data || {};
    return {
      cardName: d.displayName || 'Player Card',
      // small = the square avatar the tab draws; wide/large are only read by the preview modal
      cardSmall: d.smallArt || d.displayIcon || '',
      cardWide: d.wideArt || '',
      cardLarge: d.largeArt || '',
      // arrives in the same payload, so it costs nothing — and it's a second cheap way to tell
      // two accounts apart when they happen to run the same card
      level: ident.HideAccountLevel ? 0 : (ident.AccountLevel || 0),
    };
  } catch {
    return null;
  }
}

// Currency uuids Riot keys the wallet by. Stable, community reverse-engineered constants like the
// accessory item types above — an unknown one is simply not read rather than mis-labelled.
const CURRENCY_VP  = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';
const CURRENCY_RAD = 'e59aa87c-4cbf-517a-5983-6e81511be9b7';
const CURRENCY_KC  = '85ca954a-41f2-ce94-9b45-8ca3dd39a00d';

// What the account can actually afford, so a 1,775 VP offer can be read against a balance instead
// of from memory. Same never-throws posture as the bundle/identity lookups: the store is still
// worth showing when the wallet call fails.
async function fetchWallet(shard, puuid, headers){
  try {
    const r = await fetch(`https://pd.${shard}.a.pvp.net/store/v1/wallet/${puuid}`, { headers });
    if (!r.ok) {
      console.log(`  (wallet lookup skipped: HTTP ${r.status})`);
      return null;
    }
    const balances = (await r.json())?.Balances || {};
    return {
      vp: balances[CURRENCY_VP] || 0,
      rad: balances[CURRENCY_RAD] || 0,
      kc: balances[CURRENCY_KC] || 0,
    };
  } catch {
    return null;
  }
}

// Runs the full silent-reauth -> storefront fetch for one saved Riot session. Returns
// { checkedAt, items, itemsRemainingSeconds, bundle, accessories, accessoriesRemainingSeconds,
//   nightMarket, identity, wallet, error:'' } on success, or throws an Error with a user-facing
// message. Everything after the daily offers is best-effort: bundle, nightMarket, identity and
// wallet each degrade to null rather than failing a check that otherwise worked.
export async function checkAccountStore(label, session){
  let accessToken, idToken;
  try {
    ({ accessToken, idToken } = await silentReauth(session));
  } catch (err) {
    // silentReauth() already distinguishes "expired" from "incomplete"; keep its wording rather
    // than flattening both into one misleading message, and add the way out.
    // JSON.stringify quotes the label: these names routinely contain spaces and a #, either of
    // which turns the suggested command into something the shell mangles.
    throw new Error(`${err.message} Hit Re-login below to paste fresh cookies, or run \`node scripts/valorant-login.mjs ${JSON.stringify(label)} <ssid> <clid>\`.`);
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
      // What's *in* the bundle, resolved from the storefront's own item list rather than
      // valorant-api's bundle record: this one carries each item's base and discounted price, and
      // it's the list Riot is actually selling today. A bundle mixes skins with sprays/buddies/
      // cards, which is exactly what resolveAccessoryReward() already knows how to resolve — the
      // Item shape here ({ItemTypeID, ItemID}) is the same one the accessory shop uses.
      const bundleItems = await Promise.all((store?.FeaturedBundle?.Bundle?.Items || []).map(async (entry) => {
        const info = await resolveAccessoryReward(entry?.Item || {});
        // IsPromoItem is Riot's own flag for the things a bundle throws in for nothing — the melee
        // on a launch bundle, a gun buddy, a card. It's recorded rather than inferred from a zero
        // DiscountedPrice, because a store checked before this existed reports 0 for "not known"
        // too, and guessing there would relabel a paid item as free.
        return {
          ...info,
          price: entry?.BasePrice || 0,
          discountPrice: entry?.DiscountedPrice || 0,
          isPromo: !!entry?.IsPromoItem,
        };
      }));
      // A bundle has two totals and they are not the same number: TotalBaseCost is what its
      // contents add up to bought one by one, TotalDiscountedCost is what Riot actually charges
      // for the bundle — the promo items above are priced into the second one only, so on a launch
      // bundle the two differ by thousands of VP. Recording the base cost as the price (which is
      // all this used to do) put a figure on the banner that nobody is ever asked to pay, so the
      // real one rides alongside it under the same `discountPrice` name every other discounted
      // offer here already uses. The totals sit on FeaturedBundle.Bundles[] in the current
      // storefront and on the legacy .Bundle object in older responses — read both, since which of
      // them carries the money has changed before.
      const featured = store?.FeaturedBundle || {};
      const totals = (featured.Bundles || []).find(x => x?.DataAssetID === bundleId)
        || (featured.Bundles || [])[0]
        || featured.Bundle || {};
      const baseCost = firstCostValue(totals.TotalBaseCost)
        || firstCostValue(featured.Bundle?.TotalBaseCost) || 0;
      bundle = {
        name: j?.data?.displayName || 'Featured Bundle',
        imageUrl: j?.data?.displayIcon || '',
        price: baseCost,
        discountPrice: firstCostValue(totals.TotalDiscountedCost) || 0,
        remainingSeconds: store?.FeaturedBundle?.BundleRemainingDurationInSeconds || 0,
        items: bundleItems,
      };
    } catch { /* featured bundle is a nice-to-have — a lookup failure shouldn't fail the whole check */ }
  }

  // Night Market — the same storefront response, and the panel that's absent most of the year:
  // a personal set of discounted skins Riot opens for a couple of weeks per act. Nothing else in
  // the store is time-limited in a way you can actually miss, so it's recorded whenever it's
  // there and simply null the rest of the time. Rewards resolve like every other skin offer.
  let nightMarket = null;
  const bonusOffers = store?.BonusStore?.BonusStoreOffers || [];
  if (bonusOffers.length) {
    const offers = await Promise.all(bonusOffers.map(async (entry) => {
      const offer = entry?.Offer || {};
      const info = await resolveAccessoryReward((offer.Rewards || [])[0] || {});
      return {
        ...info,
        price: firstCostValue(offer.Cost),
        discountPrice: firstCostValue(entry?.DiscountCosts),
        discountPercent: entry?.DiscountPercent || 0,
      };
    }));
    nightMarket = {
      offers,
      remainingSeconds: store?.BonusStore?.BonusStoreRemainingDurationInSeconds || 0,
    };
  }

  // 8. Accessory shop — same storefront response, separate panel in-game: Kingdom Credit offers
  // (sprays, gun buddies, player cards, titles) on their own weekly rotation. Kept as its own
  // array rather than folded into `items` above, since these have a different currency, a
  // different refresh timer, and no VP price band to guess a rarity color from.
  const accessoryOffers = store?.AccessoryStore?.AccessoryStoreOffers || [];
  const accessories = await Promise.all(accessoryOffers.map(async (entry) => {
    const offer = entry?.Offer || {};
    // Rewards is an array, but an accessory offer has always been a single item — take the first
    // and ignore any extras rather than inventing a multi-item tile for a case that doesn't occur.
    const info = await resolveAccessoryReward((offer.Rewards || [])[0] || {});
    return { ...info, price: firstCostValue(offer.Cost) };
  }));

  // 9. Equipped player card and wallet — not part of the storefront at all, but both ride along on
  // the same auth ladder that's already been climbed above, so they're cheap here and would each
  // cost a whole reauth anywhere else.
  const identity = await fetchEquippedIdentity(shard, puuid, commonHeaders);
  const wallet = await fetchWallet(shard, puuid, commonHeaders);

  return {
    checkedAt: Date.now(),
    items,
    // Seconds left on the daily skin rotation as of checkedAt — the widget counts down from it
    // rather than assuming a fixed reset hour. An extra key here is harmless for the app, which
    // reads dailyStores entries field by field.
    itemsRemainingSeconds: store?.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds || 0,
    bundle,
    accessories,
    accessoriesRemainingSeconds: store?.AccessoryStore?.AccessoryStoreRemainingDurationInSeconds || 0,
    nightMarket,
    identity,
    wallet,
    error: '',
  };
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
export async function checkAccountOwnedSkins(label, session){
  let accessToken, idToken;
  try {
    ({ accessToken, idToken } = await silentReauth(session));
  } catch (err) {
    throw new Error(`${err.message} Hit Re-login to paste fresh cookies, or run \`node scripts/valorant-login.mjs ${JSON.stringify(label)} <ssid> <clid>\`.`);
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
