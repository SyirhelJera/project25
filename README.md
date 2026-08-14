# Project 25

A single-page, installable web app for tracking personal goals, habits, finances, fitness, and a few extras — built as a personal "life dashboard." No build step, no framework: plain HTML/CSS/JS that runs directly in the browser, with an optional Supabase backend for persistence and a few AI-powered extras.

## What it does

Project 25 is organized into tabs (left sidebar), each a self-contained tracker:

| Tab | Purpose |
|---|---|
| **Goals** | A dashboard — the goals you're working on as a carousel, a day-by-day completion heat map against the pinned countdown, and overall progress with five counters. Each counter opens the goal list in a sheet (filters, sorting, add field), and a carousel card opens that one goal in its own sheet. Goals carry subtasks, tiers (F/B/A/S/S+/Mythical), star/"working on" flags, target dates, per-goal color/image, AI-suggested subtasks, and a "locked until net worth X" mechanic. Drives the XP/level system. |
| **Habits** | Daily habit tracker with week/month grid views, streaks, a "streak restore" mechanic (3/month), optional linking to a checklist (completing the checklist auto-checks the habit), and protected-day exemptions (Settings) so a vacation/sick/event day doesn't break a streak. |
| **Finance** | Six sub-tabs. *Accounts*: multi-currency accounts (savings/credit/lent/custom) with transfers between them, a net-worth-over-time trend chart, and a this-period earnings/spending-by-category breakdown. *Debts*: money you lent out and money you owe, one card per person (same look as an account card), repaid in full or in any number of small portions, with an optional link to a real account so the cash movement is logged there too. *Money Goals*: save $X by date, with logged contributions. *Wishlist*: things you want to buy — name, cost, and an optional picture per item, shown as a card grid, each with its own saved-so-far progress. *Subscriptions*: recurring costs with a monthly rollup. *Currency*: a converter with live or manual exchange rates. Feeds into net worth. |
| **Fitness** | Weight log with a trend chart (BMI-zone shaded bands, moving average, zoomable), BMI/BMR/TDEE calculator (Mifflin-St Jeor), and a calorie target derived from a target weight + pace. |
| **Valorant** | Three sub-tabs. *Live Match*: the lobby you're in right now — your team and the enemy team with each player's rank, peak, level and who queued together as a party; in competitive, whether each player is on a comfort pick and their win rate on that agent; in deathmatch, the lobby's average rank and its highest-ranked player. When the game ends it holds the **final standing** (deathmatch placements, or competitive Victory/Defeat with the round score) plus everyone's K/D/A until your next match starts. Read live from the local helper and never stored, see "Live Match". *RR Tracker*: competitive rank/RR history for one or more Riot accounts via the HenrikDev API, with a rank-adjusted RR history chart, tier icons, and last-played-agent art (via valorant-api.com). *Shop Tracker*: each account's daily VP skin offers and its weekly Kingdom Credit accessory shop (sprays/gun buddies/player cards/titles) — one at a time, via a Skins/Accessories toggle next to the account switcher (`state.valorant.storeMode`, persisted) — a per-account skin wishlist that highlights matches (and can push a phone notification), and an owned-skins browser — all fed by local-only scripts, see "Setup". Any tile opens a preview modal with the art at full size; player cards show their horizontal, vertical, and square crops together. |
| **Checklists** | Reusable checklists with configurable auto-reset (daily/weekly/monthly/yearly), subgroups, a pomodoro-style "Play" mode that walks through items one at a time with a per-item timer (optionally with background music from a YouTube Music / YouTube playlist — see "Session music"), and miss-streak exemptions for reset periods that overlap a protected day (Settings). |
| **Notes** | A Workflowy-style outliner — every note is one row and can hold sub-notes, nested as deep as you like, with collapsible branches, a one-line title plus an optional longer body, keyboard-first editing (Enter for a new note, Tab/Shift+Tab to nest and un-nest, Shift+Enter for the body, Backspace on an empty row to remove it), **checkboxes** (turn any note into a task with ☑; parents show a done/total chip for their task children), **#tags** typed inline in a title and surfaced as a clickable filter bar, **markdown** note bodies (headings, bold/italic/strikethrough, inline + fenced code, links, lists, quotes, rules — rendered when you're not editing, raw textarea when you are), search that keeps a match's ancestor path visible, pinned notes in a strip at the top, and drag-to-reorder/reparent a whole subtree by grabbing the row itself — no handle (◀▶▲▼ buttons stand in on touch, where HTML5 drag events don't fire). A note you never typed anything into isn't kept: it's discarded as soon as focus leaves it, so an abandoned row never becomes a permanent blank line. A blank note that has picked up a body or children counts as content and stays. |
| **Jobs** | Job-application tracker — one card per application (company/role profile, company photo, salary, source, links, key contacts, resume version + optional Drive-hosted PDF), a status pipeline (prospect → applied → interviewing → offer / rejected / ghosted) with counts, filtering, sorting and free-text search (company/contact/title/location/source), free-text subcategories shown as a color-customizable pill on the card, starring/favoriting (starred applications pin to the top of the default order, plus a "★ Starred only" toolbar toggle that narrows whatever the chips/search already selected), per-application notes, auto-ghosting of applications with no news after 30 days, and a separate store of job-site logins ("🔑 Accounts", each with an optional site photo). Persists to its own storage resource, see "Persistence" below. |
| **Time** | Two panes behind a toggle. *Countdowns*: days-remaining widgets for arbitrary dates; one can be pinned to show on the Goals page. *Clock*: a live analog dial mapped to the current 12-hour half, with an optional fasting eating-window ring and custom time blocks (Sleep, Work, Gym…) drawn as colored wedges; the sidebar carries a chip for the block you're in right now. |
| **Mantras** | Short phrases; one is shown (rerollable) on the Goals page each day. |
| **Settings** | Theme (light/dark/iOS light/iOS dark), avatar visibility, net worth display currency, protected days (vacation/sick/event — exempts Habits streaks and Checklists miss-streaks, and rings those days on the habit calendars and the Goals heat map in a configurable color), and backup restore. |

**Gamification layer:** completing goals and checklist items earns XP (weighted by goal tier) that drives a level shown on the profile card; the profile also shows a hand-drawn SVG avatar whose hair/build reflects age, chest emblem reflects level, and outfit/crown reflects net worth. Net worth = a manually-entered figure + everything tracked in Finance. The Net Worth and Fitness Level rows each carry a ▲/▼ trend marker (`trendMarker()` in `js/core.js`) — net worth against the newest `netWorthHistory` point from an earlier day, fitness against the previous `weightLog` entry. Arrow direction and color are independent: rising net worth is a green ▲, but rising weight is a red ▲ and losing weight a green ▼.

## Architecture

**No build step.** `index.html` loads Google Fonts, the Supabase JS SDK (CDN), `styles.css`, and then a fixed sequence of `<script>` tags from `js/` — load order matters because later files call functions/reference DOM refs defined in earlier ones:

```
core.js → persistence.js → protecteddays.js → nav.js → goals.js → habits.js →
countdowns.js → insights.js → backups.js → mantras.js → checklists.js → notes.js →
finance.js → fitness.js → valorant.js → main.js
```

All modules share one global `state` object (defined in `core.js`) and a handful of small globals (`el()`, `uid()`, `escapeHtml()`, date helpers). There's no bundler, no npm dependencies, and no per-module scoping — everything is written as top-level script blocks that close over the same `state`.

- **`core.js`** — global `state` shape, currency constants, tiny DOM/date helper functions.
- **`persistence.js`** — the `load()`/`save()` layer (see below); also owns the setup/offline/conflict banners.
- **`protecteddays.js`** — the vacation/sick/event exemption list (Settings tab): `isDateProtected()`/`dateRangeOverlapsProtected()` are the boolean fast path consumed by `habits.js` (streaks) and `checklists.js` (miss-streaks); `protectedDayFor()`/`protectedDayLabel()` return the covering entry and its display name for UI that also has to *show* the exemption and say why — the habit week/month calendars and the goals heat map, which ring protected days in `var(--protected-day, var(--violet))`.
- **`main.js`** — `renderAll()`, theme switching, kicks off `load()`.
- **`nav.js`** — tab switching, mobile sticky-header shrink, hold-and-drag tab switcher.
- One file per feature area (`goals.js`, `habits.js`, `finance.js`, `fitness.js`, `valorant.js`, `checklists.js`, `notes.js`, `countdowns.js`, `mantras.js`, `backups.js`, `insights.js`, `protecteddays.js`) — each owns its own render function (e.g. `renderGoals()`) and wires its own DOM event listeners directly (no central router/dispatcher).
- **`sw.js`** — service worker; precaches the app shell for offline use (see PWA section).

Rendering is done by tearing down and rebuilding `innerHTML` for the relevant section on every state change (no virtual DOM, no diffing) — `save()` is called after essentially every mutation, and most mutations are followed by a call to that tab's own `render*()`.

### Data model

Everything lives in one JSON blob (`state`), persisted as a single row/key. Rough shape (see `core.js` / `persistence.js:applyLoadedState()` for the authoritative version and defaults/migrations applied on load):

```
state = {
  goals: [ { id, title, subtasks:[{id,title,done,requiresId}], tier, starred, workingOn,
             workingOnAt,                // set each time workingOn is flipped on; the "N days so
                                         // far / to finish" line counts from here, falling back to
                                         // createdAt for goals never marked as worked on
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
  notes: [ { id, title, body, parentId, collapsed, pinned, task, done, createdAt, updatedAt } ],
                                       // the Notes outliner — deliberately a FLAT array. Nesting
                                       // is the parentId link (null = top level) and sibling order
                                       // is this array's own order (childrenOf() filters, and
                                       // filter preserves order), so a subtree does NOT have to be
                                       // contiguous: moving a note relocates one record and its
                                       // descendants follow, still pointing at it. No `order` ints
                                       // to renumber, no nested children[] to recurse through.
                                       // repairNoteTree() in notes.js re-roots dangling parentIds
                                       // and breaks cycles before every render — either would make
                                       // a note unreachable from the roots and so invisible.
                                       // Like `jobs`, this key does NOT live in the shared row —
                                       // it has its own resource, see "Persistence" below.
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
    debts: [ {id,direction,person,amount,currency,dueDate,note,imageUrl,open,createdAt,
              accountId,accountTxId,
              payments:[{id,amount,note,accountId,accountTxId,createdAt}]} ],
                                       // direction: 'lent' (they owe you) | 'borrowed' (you owe).
                                       // amount is the *original* principal — what's outstanding is
                                       // always derived (principal − payments, clamped at 0) by
                                       // debtRemaining(), never stored, so a payment can't drift out
                                       // of sync with a balance. accountId/accountTxId are the
                                       // optional link to the account transaction the debt (or that
                                       // one payment) created; blank means no account was involved.
                                       // Outstanding debts feed net worth like the account types
                                       // they mirror (owed-to-you = asset, you-owe = liability, via
                                       // debtsNetWorth()), and the account transactions they log
                                       // carry the DEBT_TX_PREFIX note so isTransferTx() keeps them
                                       // out of the spending/earnings breakdown — being repaid isn't
                                       // income, it's your own money coming back.
    rates: { USD:1, PHP:58.5, ... },  // "units per 1 USD", user-editable or live-fetched
    netWorthHistory: [ {date, value} ] // one snapshot/day (USD), captured on save() — see snapshotNetWorth()
  },
  fitness: { currentWeight, targetWeight, height, age, sex, activity, pace, unit, weightLog:[{date,kg}],
             progressPhotos:[{id,filename,driveFileId,driveViewLink,uploadedAt}] },
                                       // progressPhotos holds only Drive metadata — the photo
                                       // itself is uploaded to Google Drive, never stored in state
  wishlist: [ {id,name,cost,contributions:[{id,amount,createdAt}],imageUrl,favorite,bought,createdAt} ],
                                       // imageUrl: same Storage-URL scheme as goals.imageUrl above.
                                       // contributions is logged via "+ Add Funds" in the detail
                                       // modal (click a card — renderWishlistDetail() in
                                       // wishlist.js), same shape as finance.moneyGoals'
                                       // contributions above. cost/saved are always shown in
                                       // Settings' Net Worth Display Currency (state.profile.
                                       // netWorthCurrency), not a per-item currency. favorite pins
                                       // a card to the top of its section (star, upper-left).
                                       // "funded" (contributions total >= cost) and "bought"
                                       // (explicitly marked via the modal) are distinct states —
                                       // an item can be funded without being bought yet, or bought
                                       // without ever being funded through this app. Cards land in
                                       // one of three sections: active, then a collapsible "Funded"
                                       // group, then a collapsible "Bought" group — see
                                       // renderWishlist()/appendWishlistSection() in wishlist.js.
  valorant: { apiKey, accounts:[{id,name,tag,region,platform,current,history:[...],...}], selectedAccountId,
              dailyStores: { [label]: {checkedAt,items,bundle,error} },
              ownedSkins: { [label]: {checkedAt,skins:[{uuid,name,imageUrl,tierName,tierRank,weaponType}],error} },
              ownedSkinsCollapsed,
              wishlist: [ {id,name,imageUrl,skinUuid,createdAt} ],
              localServerUrl, localServerToken,
              live: { enabled, label, regionOverride, historyDepth, showEnemyStats, showIncognito } },
                                       // `live` is PREFERENCES ONLY — no lobby, roster, or puuid is
                                       // ever stored here or anywhere else. The Live Match panel
                                       // reads it live from the local helper and throws it away;
                                       // see "Live Match" below before adding a write path.
                                       // dailyStores is keyed by the label chosen when running
                                       // scripts/valorant-login.mjs (e.g. "main","smurf"), one
                                       // entry per tracked Riot account — written by
                                       // scripts/valorant-check-store.mjs (run locally) — see below.
                                       // Each entry holds both storefront panels: `items` (the four
                                       // daily VP skin offers) and `accessories` (the Kingdom Credit
                                       // accessory shop — sprays/gun buddies/player cards/titles, on
                                       // a weekly rotation, with accessoriesRemainingSeconds counting
                                       // down from checkedAt; itemsRemainingSeconds is the same for
                                       // the daily skins, used by the desktop widget's countdown).
                                       // Only one panel is on screen at a time
                                       // (the Skins/Accessories toggle above the store). Entries
                                       // written before accessories were added simply have no
                                       // `accessories` key, so the Accessories view shows a
                                       // re-run-the-check note until their next check fills it in.
                                       // Player-card offers also
                                       // carry art:{wide,large,small} — the three crops the preview
                                       // modal shows side by side (openValItemPreview() in valorant.js);
                                       // every other accessory type has art:null and one image.
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
  focus: { date, pick },              // vestigial: the "today's focus" panel it fed was removed
                                       // from the Goals tab. Still loaded so old saves stay valid;
                                       // nothing writes it any more.
  playSession: { checklistId, itemId, startedAt, durationSec, log, skippedIds } | null,
  sessionMusic: { url, enabled, volume, shuffle,
                  playlists: [ { id, name, url } ] },
                                       // background music for a Play session (js/music.js) — `url`
                                       // is the playlist currently loaded (any YouTube/YouTube Music
                                       // link), `playlists` the saved shortlist you switch between
                                       // mid-session; the row whose url matches `url` is the active
                                       // one, so there's no separate activeId to keep in sync.
                                       // volume 0-100. Settings only; no playback state persisted.
  theme: 'light' | 'dark' | 'ios-light' | 'ios-dark',
  tabOrder: [ '<tab key>', … ],        // sidebar tab order (Settings -> "Navbar Tabs");
                                       // empty means index.html's own order. Tabs missing from a
                                       // stale saved order fall in at the end — applyTabOrder()
  hiddenTabs: [ '<tab key>', … ],      // Settings -> "Navbar Tabs", the Shown/Hidden pill: tabs
                                       // kept out of the sidebar and the mobile switcher sheet
                                       // (both read visibleNavItems()). Presentation
                                       // only — the view and its data are untouched. 'settings' is
                                       // never hideable and is filtered out on load too, so a bad
                                       // saved value can't lock the settings screen away; if the
                                       // active tab is hidden, applyTabVisibility() falls through
                                       // to the first visible one
  hideTabIcons: false,                 // Settings -> "Tab Icons": drops the per-tab logos for a
                                       // text-only nav (mobile's icon-only strip switches to
                                       // labels) — applyTabIcons(), all three in js/insights.js
  trendWindow: '0',                    // Settings -> "Trend Comparison": how far back the Net
                                       // Worth / Fitness Level ▲▼ arrows measure. '0' = against
                                       // the previous reading (the original behaviour); 'week' /
                                       // 'month' anchor to the start of this calendar week
                                       // (Monday) or month; '7'|'30'|'90'|'365' are rolling day
                                       // counts. A string, since those last two kinds mix. Each
                                       // takes the newest reading on or before that date, falling
                                       // back to the oldest one held. trendCutoffKey() in core.js
                                       // decides; read by renderGoals() and updateFitnessLevelUI().
                                       // Loads from the older `trendWindowDays` key if present
  protectedDays: [ { id, type:'vacation'|'sick'|'event', label, startDate, endDate, createdAt } ]
                                       // global exemption list (Settings tab) — startDate/endDate
                                       // are inclusive YYYY-MM-DD strings (endDate===startDate for
                                       // a single day); see protecteddays.js
  protectedDayColor: ''                  // color protected days are ringed in, on the habit
                                       // calendars AND the goals heat map — hence top-level rather
                                       // than part of mosaicColors. '' = the theme's violet;
                                       // applyProtectedDayColor() (main.js) pushes it to the
                                       // --protected-day custom property on <body>
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
- **Jobs and Notes are each stored separately** — `app_data` rows `id = 'jobs'` and `id = 'notes'` (or the `app-data-jobs` / `app-data-notes` keys in Claude-storage mode), owned by `saveJobs()`/`loadJobsData()` in `js/jobs.js` and `saveNotes()`/`loadNotesData()` in `js/notes.js`. Reason: the shared row is re-serialized and re-uploaded *in full* on every save from *any* tab, so a long list of job applications would be re-sent every time an unrelated habit got ticked. Notes is the sharper case — it debounce-saves on every keystroke, so leaving the outline in the shared row would mean re-uploading every goal, habit, finance record and Valorant store in the app for each paragraph typed. Each dedicated resource reimplements the same safety properties (its own `loadedOk` gate, optimistic-concurrency conflict detection, offline cache, serialized save chain) and shows its own conflict/offline banners inside its own tab. No extra SQL setup — the rows are created by the app on first save. `state.jobSiteAccounts` deliberately stays in the shared row. Both loaders also carry a permanent migration guard: whenever one finds its dedicated resource absent, it seeds it from any pre-split array still embedded in the shared row, and durably writes that seed *before* the shared row's next save strips the legacy copy.
- **Notes uses a compact wire format.** `notes.js:serializeNotes()` is the only thing allowed to serialize `state.notes`; it omits every field sitting at its default (`parentId: null`, `body: ''`, `collapsed`/`pinned` false, `updatedAt === createdAt`), which `applyLoadedNotesState()` puts straight back on load. An outliner is mostly short titles, so the fixed per-record key overhead otherwise dominates the payload — measured at ~45% smaller on a representative tree, off both upload *and* download. The typing debounce here is 1.5s rather than the shared `debouncedSave()`'s 700ms, since note bodies are written as continuous prose and every fired timer is a full re-upload of the outline; pending writes are flushed on tab-hide and unload so nothing is lost.

### Supabase backend

Five Edge Functions (`supabase/functions/`), called via `supabase.functions.invoke(...)` so secrets never reach the browser:

- **`manage-backups`** — lets the client list/restore daily backups from a private Storage bucket (`backups`) without ever exposing the `service_role` key to the browser. Read-only from the client's perspective.
- **`suggest-subtasks`** — proxies "suggest subtasks for this goal" to the Anthropic API (`claude-haiku-4-5`) using a server-side `ANTHROPIC_API_KEY` secret, with a shared daily call cap (`ai_usage` table, 30/day) and a 300-token cap per call.
- **`upload-fitness-photo`** — uploads a Fitness tab progress photo straight to a Google Drive folder on the app owner's behalf. Uses a one-time-obtained Google OAuth refresh token (server secret) to mint a fresh access token per call, so uploads are fully automatic — no per-upload consent prompt. Only the returned Drive file id/link are saved into app state; the image bytes themselves live only in Drive.
- **`upload-resume`** — same pattern as `upload-fitness-photo`, for the Jobs tab's per-application resume PDF attachment: uploads straight to a Google Drive folder named "Uploaded Resumes" (auto-created on first use if it doesn't exist, or pinned to a specific folder via the optional `GOOGLE_DRIVE_RESUMES_FOLDER_ID` secret), reusing the same `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN` secrets as the fitness-photo function — no separate Google OAuth setup needed if that's already configured. Only the Drive file id/link are saved into app state; the PDF bytes live only in Drive.

- **`pinterest-feed`** — reads a Pinterest profile's public RSS feeds and returns its pins as JSON. No secret is involved — it exists purely because Pinterest serves no CORS headers, so the browser can't read those files itself. The Motivation tab uses it for **Pinterest collections**: a category with `source: 'pinterest'` replaces its images with 25 random pins the first time the app is opened on a new day (`cat.lastSync` holds the day key), so the slideshow shows something different every morning. Images stay as `i.pinimg.com` URLs — nothing is copied into Storage, so a refresh leaves nothing behind. The 📌 on a thumbnail copies that pin into an ordinary category called **Saved Pins**, which the daily refresh never touches. The username is validated against `^[A-Za-z0-9_][A-Za-z0-9_-]{0,58}$` server-side — it's interpolated into the fetched URLs' paths, so that check is the whole SSRF guard.

  **Video pins.** The same function has a second action, `{ resolve: [pinUrl, …] } → { videos: { [pinUrl]: mp4Url } }`, which is how a collection plays video pins rather than showing their cover frame as a still. It's separate from the feed read because RSS carries only a pin's cover `<img>` — determining whether a pin is a video means fetching the pin *page* and pulling the mp4 out of the JSON embedded in it (unescape `\/`, then match `v*.pinimg.com/videos/….mp4`, preferring the 720p rendition; `.m3u8`/HLS variants are excluded since `<video>` can't play them outside Safari). Doing that for the whole merged pool of 138–378 pins would dwarf the feed read itself, for pins about to be discarded — so the client picks its 25 first and asks about only those, through the same 6-wide worker pool. Client-side (`resolvePinterestVideos()` in `js/motivation.js`) the call is deliberately **fire-and-forget after the images are already on screen and saved**: nothing about the collection depends on it, so a slow or failed resolve just leaves the pins as stills, exactly as they behaved before this existed. Results are patched back **by record id, never by index**, since another sync or a delete may have rewritten the list mid-flight. Pin URLs arriving from the client are validated against `PIN_URL_RE` server-side — same role as the username check, and the whole SSRF guard for this action.

  Playback matters for cost: the mp4 is handed to the browser and loaded **straight from `v1.pinimg.com`**, never proxied through the function, so video costs Supabase exactly as little as the stills do. One reused `<video>` element sits over the two crossfading `<img>` layers, so the cover image is both the poster and the fallback; `preload="none"` plus dropping `src` on the way out stop a slide you passed through from buffering in the background, and the one-ahead prefetch deliberately warms only the *cover*, never the clip. A video slide holds until its `ended` event instead of the 5s image beat, capped at 30s so one long pin can't park the slideshow. Autoplay refusal (`NotAllowedError`) drops the whole session to stills until the next tap — a tap being the user gesture that makes `play()` allowed — while an individual unplayable clip is remembered per-URL so it degrades alone; `AbortError` is ignored outright, since it just means you tapped through to the next slide mid-play.

  **Why it fetches every board, not just `/<user>/feed.rss`.** That profile feed is a fixed window of the ~25 most recent saves and has no pagination — `?page=` and `?limit=` are ignored — so on its own the collection could only ever show what you pinned lately. Each *board* feed (`/<user>/<board>.rss`) has its own ~26-item window, and a board you last added to a year ago returns year-old pins, so merging every board is what reaches back into the archive: measured 138–378 unique pins across real profiles versus 23 from the profile feed alone. Board slugs are scraped from the profile page's own HTML (`"/<user>/<slug>/"`, minus a reserved-slug list) and fetched through a 6-wide worker pool, ~3.5s for a full merge. Best-effort by design — Pinterest lazy-loads boards past the first screenful, so a profile with dozens of boards yields the first ~10–15, and any discovery failure falls back to the profile feed alone. Note this reads the profile's *own* pins throughout: the logged-in home feed (pins from accounts you follow) is private, with no RSS or public API.

**Backups**: `scripts/backup-supabase.sh` (run daily by `.github/workflows/backup-supabase.yml` via cron at 07:00 UTC) pulls both `app_data` rows (`shared` + `jobs`) with the service-role key and uploads them as `<YYYY-MM-DD>.json` to a private Storage bucket. The Settings tab can list and restore from these via the `manage-backups` function. The file is an array of `{id, data}` objects — **consumers must key off `.id`, never array position** (rows come back ordered by id, so `jobs` precedes `shared`). Backup files written before Jobs was split out have the older single-row shape `[{"data":{…}}]` with no `id` key; `manage-backups` detects and handles both, and restore recovers Jobs data from the legacy embedded copy when a backup predates the split.

**Daily Valorant store check — deliberately *not* an Edge Function.** An earlier version of this ran as a Supabase Edge Function on a GitHub Actions cron, like the backup above. It doesn't work: fetching your personal storefront requires silently re-authenticating to Riot's internal client API, and Riot's fraud/bot detection flags that reauth as low-trust and forces an interactive login again whenever it comes from a cloud/data-center IP (Supabase's Edge Function infrastructure, in this case) instead of your own device. Rather than fight that detection, `scripts/valorant-check-store.mjs` runs **locally, on your own machine** — the same device/IP that did the original login, which Riot's risk engine already trusts — and writes into the shared `app_data` row via a small Postgres function (`valorant_set_daily_store`, see the SQL comment in `scripts/valorant-lib.mjs`) called through the same public anon key the app itself already uses (see "Persistence" above; there's no login on this app, so no extra credential is needed to write there). That function patches just `valorant.dailyStores[label]` server-side with `jsonb_set` — earlier versions read the *entire* row into the script, mutated it, then wrote the whole thing back, which meant every check (and every tracked account) round-tripped the whole row, images and all. See "Setup" below.

**Getting the initial session — deliberately *not* an automated browser login either.** An earlier version of `scripts/valorant-login.mjs` used Puppeteer to open a real, visible Chrome window at Riot's login page. That doesn't work either: Riot's fraud detection fingerprints automation-controlled browsers (e.g. `navigator.webdriver`, other DevTools-Protocol tells) independently of the IP check above, and silently rejects the login — surfaced as a misleading "username or password may be incorrect" even with correct credentials, regardless of whether Chromium or a real installed Chrome drives it. Getting around that would mean actively evading a fraud-detection system built specifically to block this kind of automated access, which this project won't do (same principle as not automating past the login captcha). So `valorant-login.mjs` doesn't touch a browser at all anymore: you log into `playvalorant.com` yourself, in your own completely normal browser, then copy the resulting `ssid` session cookie out of DevTools and either paste it when the script prompts for it or paste it into the Valorant tab's "+ Add Account" field. Everything downstream of that (the daily check, the local server) is plain `fetch()` calls with that cookie — no browser involved.

**Local Helper server — a browser-to-localhost bridge, not a cloud service.** `scripts/valorant-local-server.mjs` is an optional plain `node:http` server that only ever binds to `127.0.0.1`. It exists so the Valorant tab's "Check Store Now", "+ Add Account", and "🗑 Delete" buttons can trigger `valorant-check-store.mjs`/`valorant-login.mjs`/account removal (via functions imported from `scripts/valorant-lib.mjs`) without you opening a terminal each time. The deployed page (an `https://` origin) calling an `http://127.0.0.1` server works because loopback addresses are a "potentially trustworthy origin" under the Secure Contexts spec — browsers don't treat it as mixed content — but every request still needs a token: on first run the server generates one (saved to `scripts/.valorant-local-token.json`, gitignored) and prints it once for you to paste into the tab's "Local Helper" panel. Without a matching token, `/check`, `/login`, and `/delete-account` all 401; `/status` (which only lists saved account *labels*, never session cookies) needs no token, just enough to drive the connection indicator and the account picker.

**Live Match — ephemeral, in-memory, never persisted.** The Valorant tab's third sub-tab shows the lobby you're in *right now*: your team and the enemy team, each player's rank, peak rank and account level, who queued together as a party, and — in competitive — whether each player is on an agent they actually play, with their recent win rate on it. In deathmatch it shows the lobby's average rank and its highest-ranked player instead, since comfort picks don't mean anything there (and a DM lobby is 14 people, so skipping that lookup is also what keeps it fast).

It runs through the Local Helper (`POST /live` → `scripts/valorant-live.mjs`), for the same reason as the store check above: the live-match endpoints need a silent reauth, which only works from your own machine. **Nothing it reads is written to Supabase** — there's no SQL function to install and no setup step beyond the session you already saved. A lobby is wrong within minutes and is full of other people's puuids, so it lives in the local server's memory and is thrown away; `state.valorant.live` holds preferences only.

Three things make a *polling* feature acceptable here, given that avoiding gratuitous Riot traffic is the whole reason these scripts are local in the first place:

- **A coregame roster can't change** — nobody joins a live match — so ranks, parties and agent stats are fetched **once per lobby** and memoized. Steady state is one small presence request every 8–15 seconds. Agent select is the one exception: agents lock in over ~90 seconds, so only those columns are re-read. Note that a lobby is keyed by *phase and match id*, not the id alone: a match keeps one id from agent select through to the final round, while its roster doubles in size when the barrier drops — so the phase has to be part of the cache key, or every poll for the rest of the match answers with the five-player agent-select roster and the enemy team never appears at all. The handover is still cheap: the ally ranks and stats resolved during agent select are carried across by puuid, so only the enemy five are actually looked up.
- **The access token is cached in memory for 45 minutes.** This is the only place in the repo that holds a Riot session between calls — `checkAccountStore()`/`checkAccountOwnedSkins()` each run their own ladder from scratch, which is right for them at a few calls a day. At poll rate that would be several auth round-trips a minute, which is exactly the traffic shape the local-only architecture exists to avoid. Caching here is the safe behaviour, not an optimization.
- **Match details never change**, so the win-rate sweep reduces each (multi-megabyte) response to a few dozen bytes and caches it permanently in `scripts/.valorant-match-cache.json` (gitignored, safe to delete). The sweep also fetches the *union* of everyone's recent match ids rather than one set per player — a single match-details response carries all ten of its own participants, so a premade's overlapping histories collapse into roughly one set of fetches. It's capped at 40 uncached fetches per lobby and stops early once everyone has a usable sample; anyone cut short is marked partial rather than shown a wrong number.

**The match doesn't vanish when it ends.** Hitting the end-of-game screen used to blank the panel back to "not in a match", which is exactly the wrong moment to lose the lobby. Instead the last game stays on screen — with its **final standing** — until a new one is captured. In deathmatch that's the leaderboard: every player placed 1st…14th by kills (score, then fewest deaths, break ties), with K/D/A, and the ♛ moving from "highest rank in the lobby" to whoever actually finished on top. In competitive it's Victory/Defeat with the round score, each team's rows ordered by combat score, and the same K/D/A per player. The comfort-pick column is what gets replaced: before the game, what someone was *likely* to do is the interesting thing; afterwards, what they actually did is strictly better information, and it lands in the same slot so nothing moves.

Nothing exposes a *running* scoreboard — core-game hands out the roster and nothing else — so the result comes from `match-details` once Riot has published the match, through the same call and the same disk cache the win-rate sweep already uses. A 404 in the first seconds after the final round is normal rather than an answer, so it retries on a widening backoff for about two and a half minutes; until then the score column shows skeletons and the tile says it's waiting. This is still memory-only: it survives a browser refresh (the local helper is holding it), not a restart of the helper itself.

**It works out which account you're playing on by itself.** With more than one saved session, the panel defaults to "Auto" rather than making you remember which login you're on: Riot has no "who is signed in" endpoint reachable from here, so instead each saved session is asked whether *it* is in a game — the presence check being the cheapest call there is. The cost control is that it asks about **one account per poll**, cycling: while nothing is happening there's nothing to be quick about, so idle traffic stays at a single request per tick no matter how many accounts are saved (with N accounts a new match is noticed within N polls, i.e. a few seconds). The moment an account *is* in a game the rotation locks onto it and stops asking about the others entirely, and when that match ends it unlocks and spends one extra request looking straight away, so swapping to a smurf mid-session is picked up immediately. A session that's expired gets parked for 10 minutes rather than retried every few seconds. The status line names whichever account it settled on, and the dropdown can still pin one explicitly.

Two smaller notes. **Riot's geo endpoint returns a *shard*, not a *region***, and the live-match hosts are `glz-{region}-1.{shard}.a.pvp.net` — which need both. The region is probed once against the party endpoint (the correct host answers 200 while VALORANT is running; core-game can't be used, since it 404s both for a wrong host *and* for "you're simply not in a game") and remembered in `scripts/.valorant-session.json`. The NA shard is the only ambiguous one — it also serves LATAM and BR. Settings → Valorant → Live Match has a manual override for when the probe can't tell. And **win rates always show their sample size**: a percentage only appears once there are at least 3 games behind it, shown next to the raw record and against that player's own overall win rate in the same window, because "62% on Jett" only means something beside "48% overall". **Ranks always show something.** Every player's rank has two sources. The authoritative one is `/mmr/v1`, which is where the RR, the peak, and the season record come from — but it's ten lookups fired at the exact moment the barrier drops, and Riot rate-limits per account, so the enemy five (the only ranks not already resolved during agent select) are systematically the ones that get squeezed out. Two things stop that showing up as a column of dashes. First, the roster Riot hands out with the match carries each player's **rank badge** — the one drawn under their name in game — which is tier-only, arrives at no extra request, and can't be refused; it's painted immediately and labelled "in-game badge" (no RR) until the real number lands on top of it. Second, a lookup that failed for a reason that might pass — a 429, a timeout — is **retried on later polls** instead of being treated as an answer, riding along on a poll that was going to cost one presence request anyway. Riot refusing outright is still an answer and isn't retried. The other half of the fix is upstream: when agent select becomes a live game, the pregame lobby's match-details sweep is now cancelled, because leaving multi-megabyte fetches running is what was crowding out the new lobby's rank lookups in the first place.

**Who queued with who** is answered by three signals, in descending order of certainty. Riot will always describe *your own* party in full (`/parties/v1/parties/{id}`), so your premade is never a guess. For everyone else it hands out a party id inconsistently at best. Failing that, it's inferred from recent competitive histories — which are read for the **whole** lobby, including the enemy team, regardless of the "enemy stats" setting, because a history is a cheap list of match ids and it's the only free evidence there is. Two players count as a premade if they were on the *same side* in 2+ of those matches (meeting a stranger twice in ten games happens; being drafted onto their team twice does not), or, when match details couldn't be read to establish sides, if they simply share 3+ recent matches. Inferred groups are drawn as a dashed `~A2` chip and described as "likely", never as fact; a legend under the roster spells out what the chips mean, and says why there are none when there are none.

### Session music

A checklist Play session can run a playlist in the background (`js/music.js`, controls in the strip at the bottom of the Play card: ▶/⏸, ⏭, volume, and ⚙ for the playlist list, the playback mode, shuffle, and an on/off switch). Settings live in `state.sessionMusic` and are shared like everything else in the row.

**Saved playlists.** Paste a link and press ＋ to keep it; each saved row switches with one ▶ tap (mid-session too — the tap is itself the gesture YouTube needs, so the new playlist starts immediately), renames in place, and removes with ×. Pasting a link that resolves to an already-saved id selects that entry instead of stacking a duplicate, so a `/watch?…&list=` and a `/playlist?list=` copy of the same playlist can't both end up in the list.

YouTube Music playlists **are** YouTube playlists — the `list=` id in a `music.youtube.com` link is the same id `youtube.com` serves — so this is one lazily-loaded [YouTube IFrame Player](https://developers.google.com/youtube/iframe_api_reference) with no API key, no OAuth, and nothing to deploy. The API script is only fetched once a session actually starts with a playlist configured, so the app still opens instantly and offline for anyone who never sets one. Paste either a playlist URL or a bare id; the `VL` prefix YT Music puts on library links is stripped automatically.

Three limits come from YouTube, not from this code:

- **Auto-generated feeds have no embeddable playlist.** Liked Music (`LM`), Watch Later (`WL`), Liked Videos (`LL`) and per-song radio mixes (`RDAMVM…`, `RDMM…`, `SR…` — what you get from Share while a *song* is playing) are rejected with an explanation rather than failing silently inside the iframe. Two `RD` forms *are* recoverable and handled: `RDAMPL<id>` (radio built from a playlist) is unwrapped to the real id, and YT Music's own curated playlists (`RDCLAK…`/`RDTMAK…`) are passed straight through. A playlist that's private, or whose owner disabled embedding, surfaces as player error 101/150 — make it Public or Unlisted.

  Errors print in full in the ⚙ panel (which opens itself), because the strip is one ellipsised line — a message telling you what to paste instead is useless truncated.
- **Audio can only start from a user gesture.** Pressing Play on a checklist is one, so a fresh session starts the music by itself. A session *resumed* on page load isn't, so the playlist is only cued and the ▶ button waits for a click.
- **The page needs a real origin.** This is the one part of the app that doesn't work when `index.html` is opened straight off disk: a `file://` page has no origin and sends no `Referer`, so the player refuses with **error 153** (undocumented, but that's what it means) no matter which playlist you use. Run `node scripts/serve.mjs` and open `http://localhost:8025` instead — same files, nothing to install. The error message in the ⚙ panel says as much when it detects `file://`.

The player iframe is created at **640×360 on purpose**: YouTube serves the smallest rendition that covers the player's viewport, and the low ones carry a matching low-bitrate audio track (a 160×90 player gets 144p video with ~48kbps audio, which sounds terrible). 360p pairs with ~128kbps audio. `setPlaybackQuality()` is ignored by the player now, so size is the only lever. Its wrapper clips it to 1px so nothing shows — clipping hides the iframe without shrinking its viewport, so the quality choice is unaffected. The wasted video frames are the price of listenable audio; a larger player would only buy more of them.

The player element stays in the layout at 1px/transparent behind the Play card (including while the overlay is minimized) — `display:none` or detaching it suspends playback in some browsers. Music is owned by the session: `stopPlaySession()` destroys the player, so it never outlives the overlay.

**Ads, even with a Premium account.** The in-app player is a *cross-site* iframe: it's `www.youtube.com` inside a page served from somewhere else. YouTube recognises your account in there only if the browser hands it your `youtube.com` cookies in that third-party position, and a signed-out player serves ads no matter what the account owns. Nothing in `js/music.js` can change that — it's a property of the frame, not of how the player is configured (it already uses the real `www.youtube.com` host rather than `youtube-nocookie.com`, sets no `sandbox`, and the page sends no restrictive referrer policy or CSP). Where it stands per browser:

| Where | Third-party cookies | Fix |
|---|---|---|
| Chrome / Edge, normal window | Allowed by default | Usually already ad-free; make sure the Premium account is the one signed in *in that profile* |
| Chrome Incognito / Tracking Protection on | Blocked | `chrome://settings/cookies` → allow, or add a `[*.]youtube.com` exception |
| Safari | Blocked (Prevent Cross-Site Tracking) | Settings → Privacy → turn it off |
| Firefox | Partitioned unconditionally (Total Cookie Protection) | Shield icon in the URL bar → turn off Enhanced Tracking Protection for this site |
| Installed PWA / iOS home-screen app | Own storage jar, has never seen the login | **No setting fixes this** — use the external mode below |

**Playback mode — `state.sessionMusic.mode`.** The ⚙ panel picks between the two:

- `embed` (default) — the iframe player described above. Controllable from the strip, subject to the table.
- `external` — ▶ turns into ↗ and hands the playlist to `music.youtube.com/watch?list=<id>` in a new tab, which on a phone deep-links straight into the YouTube Music app. That's a first-party page, so Premium applies, there are no ads, and you get real background playback and lock-screen controls (which a clipped 1px iframe never gave you on mobile anyway). The playlist id is the same one `parsePlaylistUrl()` normalizes for the embed, so saved playlists, `VL`/`RDAMPL` stripping and the unsupported-feed messages all behave identically.

  Two things you give up, both stated in the ⚙ panel rather than hidden: the strip's ⏭ and volume are disabled (they can't reach another tab, let alone another app), and the music **outlives the session** — `stopSessionMusic()` owns the embed, but a YouTube Music tab is not ours to close. External mode also never opens anything on its own: starting or resuming a session just arms the ↗ button, since throwing the screen over to YouTube the instant you press Play on a checklist would be worse than one extra tap (and a resumed session has no user gesture to open a window with anyway).

### External APIs used

| API | Used for | Auth |
|---|---|---|
| HenrikDev Valorant API (`api.henrikdev.xyz`) | Rank/RR/match history lookups | Free key, user-supplied, stored in `state.valorant.apiKey` |
| valorant-api.com | Rank tier icons, agent art, skin/bundle names & images, accessory-shop item names & art (sprays/buddies/player cards/titles), weapon skin catalog + content tiers (reference data) | None (public) |
| open.er-api.com | Live currency exchange rates ("Fetch Live Rates" button) | None (public) |
| Pinterest RSS (`pinterest.com/<user>/feed.rss` + each `/<user>/<board>.rss`, via the `pinterest-feed` function) | The daily 25 random pins in a Motivation "Pinterest collection" | None (public profile + board feeds) |
| Pinterest pin pages + `v*.pinimg.com` (via the `pinterest-feed` function's `resolve` action) | Finding which of the 25 picked pins are videos, and their mp4 URL — the clip itself then streams from the CDN to the browser, not through the function | None (public pin pages) |
| Anthropic API (via `suggest-subtasks` function) | Goal subtask suggestions | Server-side secret only |
| Google Drive API (via `upload-fitness-photo`/`upload-resume` functions) | Auto-storing fitness progress photos and Jobs-tab resume PDFs | Server-side OAuth refresh token only |
| Riot internal client API (`auth.riotgames.com`, `pd.*.a.pvp.net`, via `scripts/valorant-check-store.mjs`) | Daily personal store rotation + weekly accessory shop + (via the Local Helper's "Check Owned Skins") owned-skin entitlements | Local session cookie only, never leaves your machine — see "Setup" |
| Riot internal client API (`glz-{region}-1.{shard}.a.pvp.net` + `pd.*.a.pvp.net`, via `scripts/valorant-live.mjs`) | The live lobby: roster, every player's rank/peak/season record, parties, and competitive agent win rates | Local session cookie only, never leaves your machine — see "Live Match" above |
| YouTube IFrame Player API (`www.youtube.com/iframe_api`) | Background music during a checklist Play session, from a YouTube / YouTube Music playlist | None — public playlists only, no key |
| ntfy.sh (via `scripts/valorant-lib.mjs`) | Optional phone push when a wishlisted skin rotates in | None — a topic name of your choosing, stored locally in `scripts/.valorant-notify-config.json` |

### PWA / offline

`manifest.json` + `sw.js` make the app installable. The service worker precaches the static app shell (HTML/CSS/JS/icons/fonts/supabase-js) with a network-first strategy for same-origin/navigation requests and cache-first for cross-origin static assets — but it deliberately **never** intercepts `*.supabase.co`, `api.henrikdev.xyz`, `valorant-api.com`, YouTube (`youtube.com`/`ytimg.com`, the session-music player), or `127.0.0.1`/`localhost` (the Valorant Local Helper) requests, so those always hit the network live instead of serving a stale cached response (this is also why `persistence.js`'s own online/offline handling sees real network state). The loopback entry matters more than it looks: the helper's `GET /status` heartbeat is cross-origin, so without it the connection dot could keep reporting "connected" against a server that had already been stopped.

## Setup

1. Open `index.html` directly, or serve the folder statically (any static host works — no build step). `node scripts/serve.mjs` is a zero-install loopback static server for that (`http://localhost:8025`); use it rather than `file://` if you want session music, which YouTube won't embed into an origin-less page — see "Session music".
2. **If deploying outside Claude** (e.g. GitHub Pages), create a Supabase project and:
   - Run the SQL in the comment at the top of `js/persistence.js` to create the `app_data` table + open RLS policy.
   - Replace `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/persistence.js`.
   - Deploy the four Edge Functions in `supabase/functions/` (`manage-backups`, `suggest-subtasks`, `upload-fitness-photo`, `upload-resume`) and set their secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and the Google Drive secrets below).
   - Create the private `backups` Storage bucket and the `ai_usage` table (`day text primary key, count int`) if you want backups / AI subtask limits to work.
   - For scheduled backups, set the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret so `.github/workflows/backup-supabase.yml` can run.
   - **For goal/finance icon uploads and the daily Valorant store check's writes** — run `supabase/setup-egress-fix.sql` once in the SQL editor. It creates the public `icons` Storage bucket + policies (goal/finance images upload here instead of being embedded as base64 in `app_data`) and the three Postgres functions (`valorant_set_daily_store`, `valorant_set_daily_store_error`, `valorant_delete_daily_store`) `scripts/valorant-lib.mjs` calls instead of reading/writing the whole row. Skipping this doesn't break anything — icon uploads fall back to base64 and the Valorant scripts fall back to erroring per-account — it just means you're not getting the egress savings.
   - **For Fitness progress-photo uploads** (one-time setup, needed for `upload-fitness-photo`):
     1. In [Google Cloud Console](https://console.cloud.google.com), create a project, enable the **Google Drive API**, and create an **OAuth 2.0 Client ID** (type: Desktop app is simplest).
     2. Using that client ID/secret, complete an OAuth consent once with scope `https://www.googleapis.com/auth/drive.file` (e.g. via [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground), using your own client ID/secret under its settings gear) and copy the resulting **refresh token**.
     3. (Optional) create/choose a Drive folder for progress photos and copy its folder ID from the URL.
     4. Set the Supabase Edge Function secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and optionally `GOOGLE_DRIVE_FOLDER_ID`.
     5. Note: to power the in-app photo carousel without proxying image bytes through Supabase, the function sets each uploaded photo's Drive sharing to "anyone with the link can view" and points the carousel's `<img>` tags straight at Drive. Anyone who obtains a photo's (long, unguessable) file ID could view it — turn this off by removing the `permissions` call in `upload-fitness-photo/index.ts` if that's not an acceptable trade-off for you.
   - **For Jobs-tab resume PDF attachments** (needed for `upload-resume`) — reuses the exact same `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN` secrets set up above for Fitness photos, so if those are already set there's nothing new to configure: the function finds (or creates, on first upload) a Drive folder literally named "Uploaded Resumes" on its own. Set the optional secret `GOOGLE_DRIVE_RESUMES_FOLDER_ID` only if you'd rather pin uploads to a specific existing folder instead of the by-name lookup. Same link-viewable sharing trade-off as progress photos applies to the "View in Drive" links.
   - **For the daily Valorant store check** — this one runs **locally on your own machine**, not as an Edge Function (see "Daily Valorant store check" above for why) — recurring, not one-time. Supports tracking more than one Riot account's store side by side, each saved under a label you choose. No `npm install` needed anywhere in `scripts/` — it's plain Node built-ins end to end:
     1. In your own normal browser, log into `https://playvalorant.com`. Open DevTools (F12) → Application tab → Cookies → `https://auth.riotgames.com` → copy the value of the `ssid` cookie.
        - *Why not just automate this step?* An earlier version did, via a Puppeteer-driven browser window — see "Getting the initial session" above for why that no longer works (Riot's fraud detection rejects automation-controlled browsers outright) and won't be re-added.
     2. Run `node scripts/valorant-login.mjs [label]` (e.g. `node scripts/valorant-login.mjs main`; omit `[label]` to use "default") and paste the cookie when prompted — or non-interactively, `node scripts/valorant-login.mjs main <ssid>`. It validates the cookie with a quick silent reauth (so a bad paste fails immediately) and saves it under that label to `scripts/.valorant-session.json` (gitignored — never committed, never sent anywhere but Riot).
        - **To track another account**, repeat both steps with a different label, e.g. `node scripts/valorant-login.mjs smurf` — a fresh label doesn't touch any other saved account.
     3. Run `node scripts/valorant-check-store.mjs`. It re-authenticates using every saved session, pulls each account's personal daily storefront **and its accessory shop**, resolves skin/bundle/accessory names and images via valorant-api.com, and writes the result into `state.valorant.dailyStores[label]` on the shared `app_data` row directly (same public anon key the app itself uses — no service-role key needed for this), plus a local copy in `scripts/.valorant-latest-store.json` for the desktop widget below. Pass a single label (e.g. `node scripts/valorant-check-store.mjs main`) to check just that one account instead of all of them.
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
     5. The token gates `/check`, `/live`, `/login`, and `/delete-account`; regenerate it by deleting `scripts/.valorant-local-token.json` and restarting the server if you ever want to invalidate it.
     6. **Leaving it running (recommended once Live Match is in use).** The server is only useful while it's up, and Live Match wants it up whenever you're playing — so start it at login instead of from a terminal. Double-click `scripts\valorant-local-server.vbs` (identical to `node scripts/valorant-local-server.mjs`, minus the console window), or for a hands-off setup press <kbd>Win</kbd>+<kbd>R</kbd> → `shell:startup` and drop a **shortcut to that .vbs** in the folder that opens. Same trick as the desktop widget below. It's idle when nothing is asking it anything — the Live Match panel only polls while its sub-tab is on screen and the browser tab is visible — so leaving it up costs nothing. Two notes: it needs `node` on PATH (it is, if `node scripts/serve.mjs` works from a plain terminal), and because it's windowless you stop it from Task Manager (`node.exe`) rather than with Ctrl+C. If you'd rather have it restart itself on failure, use Task Scheduler instead with an "At log on" trigger, program `node`, arguments `scripts\valorant-local-server.mjs`, "Start in" set to this folder, and *Restart the task if it fails* under Settings.
     7. **Live Match** is the one thing that *only* works through this server — there's no CLI equivalent you'd run on a schedule, because it's about the game you're in right now. With the server running and the token saved, open the Valorant tab → **Live Match** and it fills in on its own once you're in a queue. It polls only while that sub-tab is the one on screen and the browser tab is visible, so it costs nothing when you're not looking at it. If it says it can't work out your region, set it manually under Settings → Valorant → Live Match (Riot's geo endpoint only returns a shard; the NA shard also serves LATAM and BR). You don't have to tell it which account you're on — with several saved sessions it finds the one that's playing (see "Live Match" above); the dropdown pins a specific one if you'd rather. You can also run `node scripts/valorant-live.mjs` from a terminal to print the same lobby as a table (add a label to pin one account), which is the quickest way to check the Riot side is working.
   - **Optional: desktop widget (`scripts/valorant-widget.ps1`)** — today's store as a small always-on-top panel on the Windows desktop, instead of opening the app. Plain WinForms driven by PowerShell, so there's nothing to install (no Electron, no Rainmeter, no `npm install` — same "no build step" rule as the rest of the repo).
     1. Run `powershell -ExecutionPolicy Bypass -File scripts\valorant-widget.ps1`, or double-click `scripts\valorant-widget.vbs` (identical, minus the console window that briefly flashes otherwise). For a widget that's always there, put a shortcut to the `.vbs` in `shell:startup`.
     2. It reads `scripts/.valorant-latest-store.json` — a local mirror of the last result per account, written by `writeStoreSnapshot()` in `valorant-lib.mjs` on **every** check, whether that came from the CLI, the scheduled task, or the tab's "Check Store Now". No Supabase read, no `app_data` row pulled: the widget refreshes for free. Skin art is downloaded once into `scripts/.valorant-widget-cache/`. Until the first check runs, the widget just says so.
     3. Drag anywhere to move it (position remembered in `scripts/.valorant-widget-config.json`); click the account label to cycle accounts when more than one is tracked; **⟳** runs a fresh check for the shown account (`node scripts/valorant-check-store.mjs <label>`, same as the terminal); **x** closes it. Wishlisted skins get a gold ★ and edge stripe — matched at check time by the same rule the ntfy push uses, so it works whether or not you set that up. A "session expired" message shows in the widget too, same as the tab's banner.
     4. Unless started with `-NoAutoCheck`, it runs a check by itself when the rotation it's showing has already ended (at most once every 30 minutes) — so a widget left running overnight has today's store by the time you look at it, whether or not you also set up the scheduled task. Failures inside the UI are appended to `scripts/.valorant-widget.log` rather than lost, since the window has nowhere to print them.
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
  music.js                          background music for a checklist Play session (YouTube IFrame player)
  goals.js / habits.js / finance.js / fitness.js / valorant.js / motivation.js /
  checklists.js / notes.js / countdowns.js / mantras.js / backups.js / insights.js
                                     one file per feature tab
supabase/functions/
  manage-backups/                   list/restore daily backups
  suggest-subtasks/                 AI goal-subtask suggestions (Anthropic, rate-limited)
  upload-fitness-photo/             uploads a Fitness progress photo to Google Drive
  upload-resume/                    uploads a Jobs-tab resume PDF to Google Drive ("Uploaded Resumes" folder)
  pinterest-feed/                   merges a Pinterest profile's public RSS feeds — profile + every board (CORS proxy for Motivation's Pinterest collections); also resolves mp4 URLs for video pins
scripts/serve.mjs                   `node scripts/serve.mjs` → serves the app at http://localhost:8025 (loopback, no install); needed for session music, which YouTube won't embed into a file:// page
scripts/backup-supabase.sh          daily snapshot → Supabase Storage
scripts/valorant-lib.mjs            shared, dependency-free helpers (sessions, Supabase writes, the storefront + owned-skins fetch)
scripts/valorant-login.mjs          run LOCALLY to save a pasted Riot session cookie under a labeled account
scripts/valorant-check-store.mjs    run LOCALLY (daily, e.g. via Task Scheduler) to update the store for every saved account
scripts/valorant-live.mjs           run LOCALLY — the live lobby (roster, ranks, parties, agent win rates); powers the tab's Live Match panel, also runnable as a CLI
scripts/valorant-local-server.mjs   run LOCALLY (optional) — loopback-only HTTP bridge so the Valorant tab's buttons can trigger the scripts above, and the Live Match panel can poll for your current lobby
scripts/valorant-local-server.vbs   starts that server with no console window; shortcut this from shell:startup to have it always running
scripts/valorant-widget.ps1         run LOCALLY (optional) — always-on-top desktop widget showing today's store (WinForms, no installs)
scripts/valorant-widget.vbs         launches the widget with no console flash; shortcut this from shell:startup
scripts/.valorant-session.json      gitignored — saved Riot sessions by label, created by valorant-login.mjs
scripts/.valorant-local-token.json  gitignored — token valorant-local-server.mjs requires on every request, created on first run
scripts/.valorant-notify-config.json  gitignored — {"ntfyTopic": "..."}, opts into the wishlist-match push notification
scripts/.valorant-latest-store.json gitignored — local mirror of the last store result per account; the widget's only data source
scripts/.valorant-match-cache.json  gitignored — reduced per-match summaries for Live Match win rates (safe to delete; refetches)
scripts/.valorant-widget-config.json  gitignored — widget window position + last shown account
scripts/.valorant-widget-cache/     gitignored — downloaded skin art for the widget (safe to delete; re-downloads)
scripts/.valorant-widget.log        gitignored — widget errors, appended (WinForms swallows them otherwise)
supabase/setup-valorant-notify.sql  run once — adds the read-only RPC the wishlist-match notification uses
supabase/setup-valorant-inventory.sql  run once — adds the RPCs the "Check Owned Skins" button uses
.github/workflows/backup-supabase.yml   cron trigger for the backup script
```
