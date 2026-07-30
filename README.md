# Project 25

A single-page, installable web app for tracking personal goals, habits, finances, fitness, and a few extras — built as a personal "life dashboard." No build step, no framework: plain HTML/CSS/JS that runs directly in the browser, with an optional Supabase backend for persistence and a few AI-powered extras.

## What it does

Project 25 is organized into tabs (left sidebar), each a self-contained tracker:

| Tab | Purpose |
|---|---|
| **Goals** | Freeform goal list with subtasks, tiers (F/B/A/S/S+/Mythical), star/"working on" flags, target dates, per-goal color/image, AI-suggested subtasks, and a "locked until net worth X" mechanic. Drives the XP/level system. |
| **Habits** | Daily habit tracker with week/month grid views, streaks, a "streak restore" mechanic (3/month), and optional linking to a checklist (completing the checklist auto-checks the habit). |
| **Finance** | Multi-currency accounts (savings/credit/lent/custom), transfers between accounts, subscriptions with monthly-cost rollup, "money goals" (save $X by date, with logged contributions), and a currency converter with live or manual exchange rates. Feeds into net worth. |
| **Fitness** | Weight log with a trend chart (BMI-zone shaded bands, moving average, zoomable), BMI/BMR/TDEE calculator (Mifflin-St Jeor), and a calorie target derived from a target weight + pace. |
| **Valorant** | Tracks competitive rank/RR history for one or more Riot accounts via the HenrikDev API, with a rank-adjusted RR history chart, tier icons, and last-played-agent art (via valorant-api.com). |
| **Checklists** | Reusable checklists with configurable auto-reset (daily/weekly/monthly/yearly), subgroups, and a pomodoro-style "Play" mode that walks through items one at a time with a per-item timer. |
| **Countdowns** | Days-remaining widgets for arbitrary dates; one can be pinned to show on the Goals page. |
| **Mantras** | Short phrases; one is shown (rerollable) on the Goals page each day. |
| **About Me** | Free-text appearance details (race, hair, eyes, clothing, background) used only to steer AI avatar generation. |
| **Settings** | Theme (light/dark/iOS light/iOS dark), avatar visibility, net worth display currency, and backup restore. |

**Gamification layer:** completing goals and checklist items earns XP (weighted by goal tier) that drives a level shown on the profile card; the profile also shows a generated avatar (hand-drawn SVG by default) whose hair/build reflects age, chest emblem reflects level, and outfit/crown reflects net worth. Net worth = a manually-entered figure + everything tracked in Finance.

## Architecture

**No build step.** `index.html` loads Google Fonts, the Supabase JS SDK (CDN), `styles.css`, and then a fixed sequence of `<script>` tags from `js/` — load order matters because later files call functions/reference DOM refs defined in earlier ones:

```
core.js → persistence.js → aboutme.js → nav.js → goals.js → habits.js →
countdowns.js → insights.js → backups.js → mantras.js → checklists.js →
finance.js → fitness.js → valorant.js → main.js
```

All modules share one global `state` object (defined in `core.js`) and a handful of small globals (`el()`, `uid()`, `escapeHtml()`, date helpers). There's no bundler, no npm dependencies, and no per-module scoping — everything is written as top-level script blocks that close over the same `state`.

- **`core.js`** — global `state` shape, currency constants, tiny DOM/date helper functions.
- **`persistence.js`** — the `load()`/`save()` layer (see below); also owns the setup/offline/conflict banners.
- **`main.js`** — `renderAll()`, theme switching, kicks off `load()`.
- **`nav.js`** — tab switching, mobile sticky-header shrink, swipe-to-switch-tabs gesture.
- One file per feature area (`goals.js`, `habits.js`, `finance.js`, `fitness.js`, `valorant.js`, `checklists.js`, `countdowns.js`, `mantras.js`, `aboutme.js`, `backups.js`, `insights.js`) — each owns its own render function (e.g. `renderGoals()`) and wires its own DOM event listeners directly (no central router/dispatcher).
- **`sw.js`** — service worker; precaches the app shell for offline use (see PWA section).

Rendering is done by tearing down and rebuilding `innerHTML` for the relevant section on every state change (no virtual DOM, no diffing) — `save()` is called after essentially every mutation, and most mutations are followed by a call to that tab's own `render*()`.

### Data model

Everything lives in one JSON blob (`state`), persisted as a single row/key. Rough shape (see `core.js` / `persistence.js:applyLoadedState()` for the authoritative version and defaults/migrations applied on load):

```
state = {
  goals: [ { id, title, subtasks:[{id,title,done,requiresId}], tier, starred, workingOn,
             targetDate, completedAt, financeTarget, financeSaved, requiredNetWorth,
             color, imageUrl, checkin, ... } ],
  habits: [ { id, name, completions:{date:true}, streakRestores:{monthKey:count}, ... } ],
  countdowns: [ { id, label, date, pinned, createdAt } ],
  mantras: [ { id, text } ],
  checklists: [ { id, name, items:[{id,text,done,durationMin,skipCount,missStreak}], resetFreq,
                  lastResetKey, linkedHabitId, group } ],
                                       // skipCount = lifetime times skipped in a Play Session;
                                       // missStreak = consecutive reset periods left undone at
                                       // reset time — both feed the Checklists tab's "struggling
                                       // tasks" panel (getStrugglingItems() in checklists.js)
  checklistExp: number,               // running XP total from checklist items (survives resets)
  finance: {
    accounts: [ {id,type,name,balance,currency,transactions:[...],...} ],
    subscriptions: [ {id,name,amount,currency,cycle,nextDate,...} ],
    moneyGoals: [ {id,name,target,currency,deadline,contributions:[...],...} ],
    rates: { USD:1, PHP:58.5, ... }   // "units per 1 USD", user-editable or live-fetched
  },
  fitness: { currentWeight, targetWeight, height, age, sex, activity, pace, unit, weightLog:[{date,kg}],
             progressPhotos:[{id,filename,driveFileId,driveViewLink,uploadedAt}] },
                                       // progressPhotos holds only Drive metadata — the photo
                                       // itself is uploaded to Google Drive, never stored in state
  valorant: { apiKey, accounts:[{id,name,tag,region,platform,current,history:[...],...}], selectedAccountId },
  profile: { name, age, netWorth, netWorthCurrency, avatarImage, race, skinTone, hairColor,
             hairStyle, eyeColor, clothing, background, hideAvatar },
  focus: { date, pick },              // today's "focus task" suggestion
  playSession: { checklistId, itemId, startedAt, durationSec, log, skippedIds } | null,
  theme: 'light' | 'dark' | 'ios-light' | 'ios-dark'
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

Four Edge Functions (`supabase/functions/`), called via `supabase.functions.invoke(...)` so secrets never reach the browser:

- **`generate-avatar`** — builds a prompt from fixed vocabularies (age bracket / fitness tier / net-worth tier, always derived from real stats) plus optional free-text About Me fields, then proxies to Pollinations.ai's free, keyless image API (`image.pollinations.ai`). Returns a base64 data URL. Manual trigger only (button click), never automatic.
- **`manage-backups`** — lets the client list/restore daily backups from a private Storage bucket (`backups`) without ever exposing the `service_role` key to the browser. Read-only from the client's perspective.
- **`suggest-subtasks`** — proxies "suggest subtasks for this goal" to the Anthropic API (`claude-haiku-4-5`) using a server-side `ANTHROPIC_API_KEY` secret, with a shared daily call cap (`ai_usage` table, 30/day) and a 300-token cap per call.
- **`upload-fitness-photo`** — uploads a Fitness tab progress photo straight to a Google Drive folder on the app owner's behalf. Uses a one-time-obtained Google OAuth refresh token (server secret) to mint a fresh access token per call, so uploads are fully automatic — no per-upload consent prompt. Only the returned Drive file id/link are saved into app state; the image bytes themselves live only in Drive.

**Backups**: `scripts/backup-supabase.sh` (run daily by `.github/workflows/backup-supabase.yml` via cron at 07:00 UTC) pulls the current `app_data` row with the service-role key and uploads it as `<YYYY-MM-DD>.json` to a private Storage bucket. The Settings tab can list and restore from these via the `manage-backups` function.

### External APIs used

| API | Used for | Auth |
|---|---|---|
| HenrikDev Valorant API (`api.henrikdev.xyz`) | Rank/RR/match history lookups | Free key, user-supplied, stored in `state.valorant.apiKey` |
| valorant-api.com | Rank tier icons, agent art (reference data) | None (public) |
| open.er-api.com | Live currency exchange rates ("Fetch Live Rates" button) | None (public) |
| Pollinations.ai (via `generate-avatar` function) | AI avatar images | None (public, proxied server-side) |
| Anthropic API (via `suggest-subtasks` function) | Goal subtask suggestions | Server-side secret only |
| Google Drive API (via `upload-fitness-photo` function) | Auto-storing fitness progress photos | Server-side OAuth refresh token only |

### PWA / offline

`manifest.json` + `sw.js` make the app installable. The service worker precaches the static app shell (HTML/CSS/JS/icons/fonts/supabase-js) with a network-first strategy for same-origin/navigation requests and cache-first for cross-origin static assets — but it deliberately **never** intercepts `*.supabase.co` requests, so `persistence.js`'s own online/offline handling sees real network state instead of a stale cached API response.

## Setup

1. Open `index.html` directly, or serve the folder statically (any static host works — no build step).
2. **If deploying outside Claude** (e.g. GitHub Pages), create a Supabase project and:
   - Run the SQL in the comment at the top of `js/persistence.js` to create the `app_data` table + open RLS policy.
   - Replace `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/persistence.js`.
   - Deploy the four Edge Functions in `supabase/functions/` (`generate-avatar`, `manage-backups`, `suggest-subtasks`, `upload-fitness-photo`) and set their secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and the Google Drive secrets below).
   - Create the private `backups` Storage bucket and the `ai_usage` table (`day text primary key, count int`) if you want backups / AI subtask limits to work.
   - For scheduled backups, set the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret so `.github/workflows/backup-supabase.yml` can run.
   - **For Fitness progress-photo uploads** (one-time setup, needed for `upload-fitness-photo`):
     1. In [Google Cloud Console](https://console.cloud.google.com), create a project, enable the **Google Drive API**, and create an **OAuth 2.0 Client ID** (type: Desktop app is simplest).
     2. Using that client ID/secret, complete an OAuth consent once with scope `https://www.googleapis.com/auth/drive.file` (e.g. via [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground), using your own client ID/secret under its settings gear) and copy the resulting **refresh token**.
     3. (Optional) create/choose a Drive folder for progress photos and copy its folder ID from the URL.
     4. Set the Supabase Edge Function secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and optionally `GOOGLE_DRIVE_FOLDER_ID`.
3. No `npm install`, no bundler — just static files.

## File map

```
index.html                          all view markup (one <div class="view"> per tab)
styles.css                          all styling (theme variables for light/dark/iOS variants)
manifest.json, sw.js, icons/        PWA installability + offline shell caching
js/
  core.js                           state shape, constants, helpers (loads first)
  persistence.js                    load()/save(), Claude-storage vs Supabase, offline/conflict handling
  main.js                           renderAll(), theme switching, boot (load())
  nav.js                            tab switching, mobile gestures
  goals.js / habits.js / finance.js / fitness.js / valorant.js /
  checklists.js / countdowns.js / mantras.js / aboutme.js / backups.js / insights.js
                                     one file per feature tab
supabase/functions/
  generate-avatar/                  AI avatar image proxy (Pollinations)
  manage-backups/                   list/restore daily backups
  suggest-subtasks/                 AI goal-subtask suggestions (Anthropic, rate-limited)
  upload-fitness-photo/             uploads a Fitness progress photo to Google Drive
scripts/backup-supabase.sh          daily snapshot → Supabase Storage
.github/workflows/backup-supabase.yml   cron trigger for the backup script
```
