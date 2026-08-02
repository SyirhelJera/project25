# Project 25

A single-page, installable web app for tracking personal goals, habits, finances, fitness, and a few extras — built as a personal "life dashboard." No build step, no framework: plain HTML/CSS/JS that runs directly in the browser, with an optional Supabase backend for persistence and a few AI-powered extras.

## What it does

Project 25 is organized into tabs (left sidebar), each a self-contained tracker:

| Tab | Purpose |
|---|---|
| **Goals** | Freeform goal list with subtasks, tiers (F/B/A/S/S+/Mythical), star/"working on" flags, target dates, per-goal color/image, AI-suggested subtasks, and a "locked until net worth X" mechanic. Drives the XP/level system. |
| **Habits** | Daily habit tracker with week/month grid views, streaks, a "streak restore" mechanic (3/month), optional linking to a checklist (completing the checklist auto-checks the habit), and protected-day exemptions (Settings) so a vacation/sick/event day doesn't break a streak. |
| **Finance** | Multi-currency accounts (savings/credit/lent/custom), transfers between accounts, subscriptions with monthly-cost rollup, "money goals" (save $X by date, with logged contributions), a currency converter with live or manual exchange rates, a net-worth-over-time trend chart, and a this-month spending-by-category breakdown. Feeds into net worth. |
| **Fitness** | Weight log with a trend chart (BMI-zone shaded bands, moving average, zoomable), BMI/BMR/TDEE calculator (Mifflin-St Jeor), and a calorie target derived from a target weight + pace. |
| **Valorant** | Tracks competitive rank/RR history for one or more Riot accounts via the HenrikDev API, with a rank-adjusted RR history chart, tier icons, and last-played-agent art (via valorant-api.com). |
| **Checklists** | Reusable checklists with configurable auto-reset (daily/weekly/monthly/yearly), subgroups, a pomodoro-style "Play" mode that walks through items one at a time with a per-item timer, and miss-streak exemptions for reset periods that overlap a protected day (Settings). |
| **Countdowns** | Days-remaining widgets for arbitrary dates; one can be pinned to show on the Goals page. |
| **Mantras** | Short phrases; one is shown (rerollable) on the Goals page each day. |
| **Settings** | Theme (light/dark/iOS light/iOS dark), avatar visibility, net worth display currency, protected days (vacation/sick/event — exempts Habits streaks and Checklists miss-streaks), and backup restore. |

**Gamification layer:** completing goals and checklist items earns XP (weighted by goal tier) that drives a level shown on the profile card; the profile also shows a hand-drawn SVG avatar whose hair/build reflects age, chest emblem reflects level, and outfit/crown reflects net worth. Net worth = a manually-entered figure + everything tracked in Finance.

## Architecture

**No build step.** `index.html` loads Google Fonts, the Supabase JS SDK (CDN), `styles.css`, and then a fixed sequence of `<script>` tags from `js/` — load order matters because later files call functions/reference DOM refs defined in earlier ones:

```
core.js → persistence.js → protecteddays.js → nav.js → goals.js → habits.js →
countdowns.js → insights.js → backups.js → mantras.js → checklists.js →
finance.js → fitness.js → valorant.js → main.js
```

All modules share one global `state` object (defined in `core.js`) and a handful of small globals (`el()`, `uid()`, `escapeHtml()`, date helpers). There's no bundler, no npm dependencies, and no per-module scoping — everything is written as top-level script blocks that close over the same `state`.

- **`core.js`** — global `state` shape, currency constants, tiny DOM/date helper functions.
- **`persistence.js`** — the `load()`/`save()` layer (see below); also owns the setup/offline/conflict banners.
- **`protecteddays.js`** — the vacation/sick/event exemption list (Settings tab): `isDateProtected()`/`dateRangeOverlapsProtected()` are consumed by `habits.js` (streaks) and `checklists.js` (miss-streaks).
- **`main.js`** — `renderAll()`, theme switching, kicks off `load()`.
- **`nav.js`** — tab switching, mobile sticky-header shrink, swipe-to-switch-tabs gesture.
- One file per feature area (`goals.js`, `habits.js`, `finance.js`, `fitness.js`, `valorant.js`, `checklists.js`, `countdowns.js`, `mantras.js`, `backups.js`, `insights.js`, `protecteddays.js`) — each owns its own render function (e.g. `renderGoals()`) and wires its own DOM event listeners directly (no central router/dispatcher).
- **`sw.js`** — service worker; precaches the app shell for offline use (see PWA section).

Rendering is done by tearing down and rebuilding `innerHTML` for the relevant section on every state change (no virtual DOM, no diffing) — `save()` is called after essentially every mutation, and most mutations are followed by a call to that tab's own `render*()`.

### Data model

Everything lives in one JSON blob (`state`), persisted as a single row/key. Rough shape (see `core.js` / `persistence.js:applyLoadedState()` for the authoritative version and defaults/migrations applied on load):

```
state = {
  goals: [ { id, title, subtasks:[{id,title,done,requiresId}], tier, starred, workingOn,
             targetDate, completedAt, financeTarget, financeSaved, requiredNetWorth,
             color, imageUrl, checkin, ... } ],
                                       // imageUrl is a public Supabase Storage URL (uploaded via
                                       // uploadCompressedImage() in core.js), not an embedded
                                       // base64 image — keeps it off the app_data row entirely
  habits: [ { id, name, completions:{date:true}, streakRestores:{monthKey:count}, ... } ],
                                       // calcStreak()/habitBrokenGapDate() (habits.js) treat any
                                       // date covered by state.protectedDays below as excused —
                                       // it doesn't break a streak, but doesn't inflate it either
  countdowns: [ { id, label, date, pinned, createdAt } ],
  mantras: [ { id, text } ],
  checklists: [ { id, name, items:[{id,text,done,durationMin,skipCount,missStreak}], resetFreq,
                  lastResetKey, linkedHabitId, group } ],
                                       // skipCount = lifetime times skipped in a Play Session;
                                       // missStreak = consecutive reset periods left undone at
                                       // reset time — both feed the Checklists tab's "struggling
                                       // tasks" panel (getStrugglingItems() in checklists.js).
                                       // missStreak is NOT incremented for a reset period that
                                       // overlaps a protected day (see state.protectedDays below
                                       // and resetPeriodRange() in checklists.js)
  checklistExp: number,               // running XP total from checklist items (survives resets)
  finance: {
    accounts: [ {id,type,name,balance,currency,imageUrl,transactions:[{id,amount,note,category,createdAt}],...} ],
    subscriptions: [ {id,name,amount,currency,cycle,nextDate,imageUrl,...} ],
                                       // account/subscription imageUrl: same Storage-URL scheme
                                       // as goals.imageUrl above, not embedded base64
    moneyGoals: [ {id,name,target,currency,deadline,contributions:[...],...} ],
    rates: { USD:1, PHP:58.5, ... },  // "units per 1 USD", user-editable or live-fetched
    netWorthHistory: [ {date, value} ] // one snapshot/day (USD), captured on save() — see snapshotNetWorth()
  },
  fitness: { currentWeight, targetWeight, height, age, sex, activity, pace, unit, weightLog:[{date,kg}],
             progressPhotos:[{id,filename,driveFileId,driveViewLink,uploadedAt}] },
                                       // progressPhotos holds only Drive metadata — the photo
                                       // itself is uploaded to Google Drive, never stored in state
  valorant: { apiKey, accounts:[{id,name,tag,region,platform,current,history:[...],...}], selectedAccountId,
              dailyStores: { [label]: {checkedAt,items,bundle,error} },
              ownedSkins: { [label]: {checkedAt,skins:[{uuid,name,imageUrl,tierName,tierRank,weaponType}],error} },
              ownedSkinsCollapsed,
              wishlist: [ {id,name,imageUrl,skinUuid,createdAt} ],
              localServerUrl, localServerToken },
                                       // dailyStores is keyed by the label chosen when running
                                       // scripts/valorant-login.mjs (e.g. "main","smurf"), one
                                       // entry per tracked Riot account — written by
                                       // scripts/valorant-check-store.mjs (run locally) — see below.
                                       // ownedSkins is the same shape/origin, but for every owned
                                       // weapon skin (sorted by tier), written by the Local
                                       // Helper's "🎨 Check Owned Skins" button — see
                                       // checkAccountOwnedSkins() in scripts/valorant-lib.mjs.
                                       // wishlist holds gun/skin names to watch for, added either by
                                       // free text or by picking a real skin (with image + uuid)
                                       // from the search-as-you-type list backed by
                                       // valorant-api.com/v1/weapons/skins — see ensureValSkinDb()
                                       // in valorant.js. Matched against dailyStores items
                                       // (case-insensitive substring) to highlight store items and
                                       // light up the red nav-bar tick — see
                                       // valWishlistMatchesForItem() in valorant.js.
                                       // localServerUrl/localServerToken point Settings ->
                                       // "Valorant Local Helper" (token + Add Account) and the
                                       // Valorant tab's account dropdown/Check Store/Delete at
                                       // scripts/valorant-local-server.mjs (also local-only) so
                                       // those can be buttons instead of terminal commands — see
                                       // "Setup" below.
  profile: { name, age, netWorth, netWorthCurrency, hideAvatar },
  focus: { date, pick },              // today's "focus task" suggestion
  playSession: { checklistId, itemId, startedAt, durationSec, log, skippedIds } | null,
  theme: 'light' | 'dark' | 'ios-light' | 'ios-dark',
  protectedDays: [ { id, type:'vacation'|'sick'|'event', label, startDate, endDate, createdAt } ]
                                       // global exemption list (Settings tab) — startDate/endDate
                                       // are inclusive YYYY-MM-DD strings (endDate===startDate for
                                       // a single day); see protecteddays.js
}
```

New fields are back-filled with defaults in `applyLoadedState()` so old saved data upgrades in place without a migration step.

### Persistence — two modes, no auth

`js/persistence.js` picks a storage backend at load time:

1. **Inside Claude (claude.ai)** — if `window.storage` exists, uses that built-in key/value API directly. No setup, no Supabase involved.
2. **Deployed elsewhere (e.g. GitHub Pages)** — falls back to Supabase. **There is no login.** Every visitor reads/writes the *same shared row* (`app_data` table, `id = 'shared'`) via the anon key baked into `persistence.js`. Anyone with the link can view and edit the data.

Key mechanics in this layer:
- **Optimistic concurrency**: `save()` tracks `lastKnownUpdatedAt` and does a conditional `UPDATE ... WHERE updated_at = <last known>`. If another tab/device saved in between, the conditional update matches zero rows and a conflict banner appears (reload vs. force-overwrite).
- **Offline cache**: state is mirrored to `localStorage` after every successful load/save; if a live load fails, the app falls back to that cached copy and shows an offline banner. This is read-fallback only — it doesn't queue writes, it just keeps `save()`'s existing conflict check as the safety net once connectivity returns.
- **Debounced saves** for high-frequency inputs (typing in number fields) to stay within free-tier request limits; discrete actions (clicks, checkbox toggles) save immediately.
- `save()` is a no-op until a load has genuinely completed (`loadedOk`), so a failed/ambiguous load can never clobber remote data with in-memory defaults.

### Supabase backend

Three Edge Functions (`supabase/functions/`), called via `supabase.functions.invoke(...)` so secrets never reach the browser:

- **`manage-backups`** — lets the client list/restore daily backups from a private Storage bucket (`backups`) without ever exposing the `service_role` key to the browser. Read-only from the client's perspective.
- **`suggest-subtasks`** — proxies "suggest subtasks for this goal" to the Anthropic API (`claude-haiku-4-5`) using a server-side `ANTHROPIC_API_KEY` secret, with a shared daily call cap (`ai_usage` table, 30/day) and a 300-token cap per call.
- **`upload-fitness-photo`** — uploads a Fitness tab progress photo straight to a Google Drive folder on the app owner's behalf. Uses a one-time-obtained Google OAuth refresh token (server secret) to mint a fresh access token per call, so uploads are fully automatic — no per-upload consent prompt. Only the returned Drive file id/link are saved into app state; the image bytes themselves live only in Drive.

**Backups**: `scripts/backup-supabase.sh` (run daily by `.github/workflows/backup-supabase.yml` via cron at 07:00 UTC) pulls the current `app_data` row with the service-role key and uploads it as `<YYYY-MM-DD>.json` to a private Storage bucket. The Settings tab can list and restore from these via the `manage-backups` function.

**Daily Valorant store check — deliberately *not* an Edge Function.** An earlier version of this ran as a Supabase Edge Function on a GitHub Actions cron, like the backup above. It doesn't work: fetching your personal storefront requires silently re-authenticating to Riot's internal client API, and Riot's fraud/bot detection flags that reauth as low-trust and forces an interactive login again whenever it comes from a cloud/data-center IP (Supabase's Edge Function infrastructure, in this case) instead of your own device. Rather than fight that detection, `scripts/valorant-check-store.mjs` runs **locally, on your own machine** — the same device/IP that did the original login, which Riot's risk engine already trusts — and writes into the shared `app_data` row via a small Postgres function (`valorant_set_daily_store`, see the SQL comment in `scripts/valorant-lib.mjs`) called through the same public anon key the app itself already uses (see "Persistence" above; there's no login on this app, so no extra credential is needed to write there). That function patches just `valorant.dailyStores[label]` server-side with `jsonb_set` — earlier versions read the *entire* row into the script, mutated it, then wrote the whole thing back, which meant every check (and every tracked account) round-tripped the whole row, images and all. See "Setup" below.

**Getting the initial session — deliberately *not* an automated browser login either.** An earlier version of `scripts/valorant-login.mjs` used Puppeteer to open a real, visible Chrome window at Riot's login page. That doesn't work either: Riot's fraud detection fingerprints automation-controlled browsers (e.g. `navigator.webdriver`, other DevTools-Protocol tells) independently of the IP check above, and silently rejects the login — surfaced as a misleading "username or password may be incorrect" even with correct credentials, regardless of whether Chromium or a real installed Chrome drives it. Getting around that would mean actively evading a fraud-detection system built specifically to block this kind of automated access, which this project won't do (same principle as not automating past the login captcha). So `valorant-login.mjs` doesn't touch a browser at all anymore: you log into `playvalorant.com` yourself, in your own completely normal browser, then copy the resulting `ssid` session cookie out of DevTools and either paste it when the script prompts for it or paste it into the Valorant tab's "+ Add Account" field. Everything downstream of that (the daily check, the local server) is plain `fetch()` calls with that cookie — no browser involved.

**Local Helper server — a browser-to-localhost bridge, not a cloud service.** `scripts/valorant-local-server.mjs` is an optional plain `node:http` server that only ever binds to `127.0.0.1`. It exists so the Valorant tab's "Check Store Now", "+ Add Account", and "🗑 Delete" buttons can trigger `valorant-check-store.mjs`/`valorant-login.mjs`/account removal (via functions imported from `scripts/valorant-lib.mjs`) without you opening a terminal each time. The deployed page (an `https://` origin) calling an `http://127.0.0.1` server works because loopback addresses are a "potentially trustworthy origin" under the Secure Contexts spec — browsers don't treat it as mixed content — but every request still needs a token: on first run the server generates one (saved to `scripts/.valorant-local-token.json`, gitignored) and prints it once for you to paste into the tab's "Local Helper" panel. Without a matching token, `/check`, `/login`, and `/delete-account` all 401; `/status` (which only lists saved account *labels*, never session cookies) needs no token, just enough to drive the connection indicator and the account picker.

### External APIs used

| API | Used for | Auth |
|---|---|---|
| HenrikDev Valorant API (`api.henrikdev.xyz`) | Rank/RR/match history lookups | Free key, user-supplied, stored in `state.valorant.apiKey` |
| valorant-api.com | Rank tier icons, agent art, skin/bundle names & images, weapon skin catalog + content tiers (reference data) | None (public) |
| open.er-api.com | Live currency exchange rates ("Fetch Live Rates" button) | None (public) |
| Anthropic API (via `suggest-subtasks` function) | Goal subtask suggestions | Server-side secret only |
| Google Drive API (via `upload-fitness-photo` function) | Auto-storing fitness progress photos | Server-side OAuth refresh token only |
| Riot internal client API (`auth.riotgames.com`, `pd.*.a.pvp.net`, via `scripts/valorant-check-store.mjs`) | Daily personal store rotation + (via the Local Helper's "Check Owned Skins") owned-skin entitlements | Local session cookie only, never leaves your machine — see "Setup" |
| ntfy.sh (via `scripts/valorant-lib.mjs`) | Optional phone push when a wishlisted skin rotates in | None — a topic name of your choosing, stored locally in `scripts/.valorant-notify-config.json` |

### PWA / offline

`manifest.json` + `sw.js` make the app installable. The service worker precaches the static app shell (HTML/CSS/JS/icons/fonts/supabase-js) with a network-first strategy for same-origin/navigation requests and cache-first for cross-origin static assets — but it deliberately **never** intercepts `*.supabase.co`, `api.henrikdev.xyz`, or `valorant-api.com` requests, so those always hit the network live instead of serving a stale cached response (this is also why `persistence.js`'s own online/offline handling sees real network state).

## Setup

1. Open `index.html` directly, or serve the folder statically (any static host works — no build step).
2. **If deploying outside Claude** (e.g. GitHub Pages), create a Supabase project and:
   - Run the SQL in the comment at the top of `js/persistence.js` to create the `app_data` table + open RLS policy.
   - Replace `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/persistence.js`.
   - Deploy the three Edge Functions in `supabase/functions/` (`manage-backups`, `suggest-subtasks`, `upload-fitness-photo`) and set their secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and the Google Drive secrets below).
   - Create the private `backups` Storage bucket and the `ai_usage` table (`day text primary key, count int`) if you want backups / AI subtask limits to work.
   - For scheduled backups, set the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret so `.github/workflows/backup-supabase.yml` can run.
   - **For goal/finance icon uploads and the daily Valorant store check's writes** — run `supabase/setup-egress-fix.sql` once in the SQL editor. It creates the public `icons` Storage bucket + policies (goal/finance images upload here instead of being embedded as base64 in `app_data`) and the three Postgres functions (`valorant_set_daily_store`, `valorant_set_daily_store_error`, `valorant_delete_daily_store`) `scripts/valorant-lib.mjs` calls instead of reading/writing the whole row. Skipping this doesn't break anything — icon uploads fall back to base64 and the Valorant scripts fall back to erroring per-account — it just means you're not getting the egress savings.
   - **For Fitness progress-photo uploads** (one-time setup, needed for `upload-fitness-photo`):
     1. In [Google Cloud Console](https://console.cloud.google.com), create a project, enable the **Google Drive API**, and create an **OAuth 2.0 Client ID** (type: Desktop app is simplest).
     2. Using that client ID/secret, complete an OAuth consent once with scope `https://www.googleapis.com/auth/drive.file` (e.g. via [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground), using your own client ID/secret under its settings gear) and copy the resulting **refresh token**.
     3. (Optional) create/choose a Drive folder for progress photos and copy its folder ID from the URL.
     4. Set the Supabase Edge Function secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and optionally `GOOGLE_DRIVE_FOLDER_ID`.
     5. Note: to power the in-app photo carousel without proxying image bytes through Supabase, the function sets each uploaded photo's Drive sharing to "anyone with the link can view" and points the carousel's `<img>` tags straight at Drive. Anyone who obtains a photo's (long, unguessable) file ID could view it — turn this off by removing the `permissions` call in `upload-fitness-photo/index.ts` if that's not an acceptable trade-off for you.
   - **For the daily Valorant store check** — this one runs **locally on your own machine**, not as an Edge Function (see "Daily Valorant store check" above for why) — recurring, not one-time. Supports tracking more than one Riot account's store side by side, each saved under a label you choose. No `npm install` needed anywhere in `scripts/` — it's plain Node built-ins end to end:
     1. In your own normal browser, log into `https://playvalorant.com`. Open DevTools (F12) → Application tab → Cookies → `https://auth.riotgames.com` → copy the value of the `ssid` cookie.
        - *Why not just automate this step?* An earlier version did, via a Puppeteer-driven browser window — see "Getting the initial session" above for why that no longer works (Riot's fraud detection rejects automation-controlled browsers outright) and won't be re-added.
     2. Run `node scripts/valorant-login.mjs [label]` (e.g. `node scripts/valorant-login.mjs main`; omit `[label]` to use "default") and paste the cookie when prompted — or non-interactively, `node scripts/valorant-login.mjs main <ssid>`. It validates the cookie with a quick silent reauth (so a bad paste fails immediately) and saves it under that label to `scripts/.valorant-session.json` (gitignored — never committed, never sent anywhere but Riot).
        - **To track another account**, repeat both steps with a different label, e.g. `node scripts/valorant-login.mjs smurf` — a fresh label doesn't touch any other saved account.
     3. Run `node scripts/valorant-check-store.mjs`. It re-authenticates using every saved session, pulls each account's personal daily storefront, resolves skin/bundle names and images via valorant-api.com, and writes the result into `state.valorant.dailyStores[label]` on the shared `app_data` row directly (same public anon key the app itself uses — no service-role key needed for this). Pass a single label (e.g. `node scripts/valorant-check-store.mjs main`) to check just that one account instead of all of them.
     4. **Run step 3 daily** for the Valorant tab to actually show "today's" store for each tracked account. See "Automating the daily check" below for a Windows Task Scheduler setup so you don't have to run it by hand.
     5. **Each saved session expires in roughly 1-3 weeks** (Riot's own limit, not configurable), independently per account. When one does, `valorant-check-store.mjs` writes a "session expired" message into that account's entry in `state.valorant.dailyStores` (shown as a banner under that account's store section on the Valorant tab) instead of failing silently — other accounts keep updating normally. When you see that, just repeat steps 1-2 with that same label.
   - **Automating the daily check (Windows Task Scheduler)**: open Task Scheduler → Create Basic Task → trigger "Daily" at a time your PC is normally on → action "Start a program" → Program: `node`, Arguments: `scripts\valorant-check-store.mjs`, "Start in": this project's folder. A single scheduled run checks every saved account. Since the check needs your own machine's session, it only runs while the PC is on — a missed day just means yesterday's store stays shown until the next successful run.
   - **Optional: push notification when a wishlisted skin rotates in** — fires a phone push (via [ntfy.sh](https://ntfy.sh), free, no account needed) right after `valorant-check-store.mjs`/`valorant-local-server.mjs` writes a new store result, if any item matches that account's wishlist. Opt-in — skipping this changes nothing else.
     1. Run `supabase/setup-valorant-notify.sql` once in the Supabase SQL editor (same place `setup-egress-fix.sql` was run) — adds a read-only RPC so the script can fetch one account's wishlist without pulling the whole `app_data` row.
     2. Install the [ntfy app](https://ntfy.sh) (iOS/Android) and subscribe to a topic name of your choosing — pick something hard to guess, since anyone who knows a public ntfy topic can also subscribe to it.
     3. Create `scripts/.valorant-notify-config.json` (gitignored) with `{"ntfyTopic": "your-topic-name"}`.
     4. That's it — every `valorant-check-store.mjs` run (scheduled or manual) or "Check Store Now" click pushes a notification for any current wishlist match, even if a previous run already flagged the same skin earlier the same day.
   - **Optional: trigger Check/Add Account from the Valorant tab itself** instead of a terminal, via `scripts/valorant-local-server.mjs` — a small local bridge (loopback-only, no other network access) that the tab's "Local Helper" panel talks to:
     1. Run `node scripts/valorant-local-server.mjs`. It prints a token and keeps running in that terminal — leave it open while you use the buttons.
     2. Paste the printed token into the Valorant tab's "Local Helper" → "Local Helper Token" field and click Save Token. The panel's status dot turns on once it can reach the server.
     3. **Check Store Now** runs the same check as step 3 above (for the account picked in the dropdown, or "All accounts") and refreshes the tab with the result. **+ Add Account** runs the same cookie-save as steps 1-2 above: log into `playvalorant.com` in your own browser first (same DevTools cookie copy as step 1), then type a label and paste the cookie into the panel's fields and click the button. **🗑 Delete** removes the saved session for whichever specific account is picked in the dropdown (disabled for "All accounts") — it deletes that label from `scripts/.valorant-session.json` and clears its store data, after a confirmation prompt since you'd need to repeat steps 1-2 to re-add it.
     4. This is a convenience on top of the CLI, not a replacement for it — the daily automated check (previous bullet) still needs the Task Scheduler entry, since nobody's expected to leave a browser tab open and click a button every day. The local server is for one-off checks, adding new accounts, and removing ones you no longer want tracked.
     5. The token gates `/check`, `/login`, and `/delete-account` (all three would let a page write to your Supabase data, save a session cookie, or remove one); regenerate it by deleting `scripts/.valorant-local-token.json` and restarting the server if you ever want to invalidate it.
   - **Optional: "🎨 Check Owned Skins"** — same Local Helper panel, one more button. Re-authenticates the picked account (or every saved account, for "All accounts"), fetches every entitlement type Riot has on file for it, and figures out which one is "weapon skins" by checking which bucket's item ids actually resolve against valorant-api.com's skin catalog (rather than trusting a hardcoded Riot item-type id, which turned out to be unreliable). Owning any one level of a skin entitles you to all of its levels, so entitlements are deduped back to one entry per skin rather than showing a 4-level skin 4 times. Writes the result — each owned skin's name, image, content tier, and weapon type — into `state.valorant.ownedSkins[label]`, shown as a collapsible "Owned Skins" card styled the same as the daily store above, for whichever account is picked in the Shop Tracker's account dropdown (not shown for "All accounts", same as the wishlist), sortable by tier, name, or weapon type (Sidearm/SMG/Shotgun/Rifle/Sniper/Heavy/Melee).
     1. Run `supabase/setup-valorant-inventory.sql` once in the Supabase SQL editor (same place `setup-egress-fix.sql` was run) — adds the three RPC functions this write needs. Skipping this doesn't break anything else; the button just errors per-account until it's run.
     2. Uses the same saved session/local server as "Check Store Now" above — no separate login step.
     3. Riot doesn't expose a historical purchase price for already-owned items via any API — a skin's content tier (Select/Deluxe/Premium/Exclusive/Ultra) is the closest available stand-in, since tier is what actually determines a skin's price bracket in Valorant. "Sort by tier" and "sort by price" are therefore the same ordering here.
     4. The entitlement-bucket detection and tier resolution are based on community reverse-engineering of undocumented Riot/valorant-api.com response shapes — if this ever starts erroring or miscategorizing tiers, see the comments above `fetchSkinCatalog()` and `checkAccountOwnedSkins()` in `scripts/valorant-lib.mjs`.
3. No `npm install`, no bundler, anywhere in this project — just static files for the app, plain Node built-ins for every script in `scripts/`.

## File map

```
index.html                          all view markup (one <div class="view"> per tab)
styles.css                          all styling (theme variables for light/dark/iOS variants)
manifest.json, sw.js, icons/        PWA installability + offline shell caching
js/
  core.js                           state shape, constants, helpers (loads first)
  persistence.js                    load()/save(), Claude-storage vs Supabase, offline/conflict handling
  protecteddays.js                  vacation/sick/event exemption list (Settings) — consumed by habits.js/checklists.js
  main.js                           renderAll(), theme switching, boot (load())
  nav.js                            tab switching, mobile gestures
  goals.js / habits.js / finance.js / fitness.js / valorant.js /
  checklists.js / countdowns.js / mantras.js / backups.js / insights.js
                                     one file per feature tab
supabase/functions/
  manage-backups/                   list/restore daily backups
  suggest-subtasks/                 AI goal-subtask suggestions (Anthropic, rate-limited)
  upload-fitness-photo/             uploads a Fitness progress photo to Google Drive
scripts/backup-supabase.sh          daily snapshot → Supabase Storage
scripts/valorant-lib.mjs            shared, dependency-free helpers (sessions, Supabase writes, the storefront + owned-skins fetch)
scripts/valorant-login.mjs          run LOCALLY to save a pasted Riot session cookie under a labeled account
scripts/valorant-check-store.mjs    run LOCALLY (daily, e.g. via Task Scheduler) to update the store for every saved account
scripts/valorant-local-server.mjs   run LOCALLY (optional) — loopback-only HTTP bridge so the Valorant tab's buttons can trigger the two scripts above
scripts/.valorant-session.json      gitignored — saved Riot sessions by label, created by valorant-login.mjs
scripts/.valorant-local-token.json  gitignored — token valorant-local-server.mjs requires on every request, created on first run
scripts/.valorant-notify-config.json  gitignored — {"ntfyTopic": "..."}, opts into the wishlist-match push notification
supabase/setup-valorant-notify.sql  run once — adds the read-only RPC the wishlist-match notification uses
supabase/setup-valorant-inventory.sql  run once — adds the RPCs the "Check Owned Skins" button uses
.github/workflows/backup-supabase.yml   cron trigger for the backup script
```
