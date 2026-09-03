# Project 25

A single-page, installable web app for tracking personal goals, habits, finances, fitness, and a few extras — built as a personal "life dashboard." No build step, no framework: plain HTML/CSS/JS that runs directly in the browser, with an optional Supabase backend for persistence and a few AI-powered extras.

## What it does

Project 25 is organized into tabs (left sidebar), each a self-contained tracker:

| Tab | Purpose |
|---|---|
| **Goals** | A dashboard — the goals you're working on as a carousel, a day-by-day completion heat map against the pinned countdown, and overall progress with five counters. Each counter opens the goal list in a sheet (filters, sorting, add field), and a carousel card opens that one goal in its own sheet. Goals carry subtasks, tiers (F/B/A/S/S+/Mythical), star/"working on" flags, target dates, per-goal color/image, AI-suggested subtasks, and a "locked until net worth X" mechanic. Drives the XP/level system. |
| **Habits** | Daily habit tracker with week/month grid views, streaks, a "streak restore" mechanic (3/month), optional linking to a checklist (completing the checklist auto-checks the habit), and protected-day exemptions (Settings) so a vacation/sick/event day doesn't break a streak. An expanded card also carries a stats strip (days done all-time, this month, this week, best streak, consistency, last done), and the list can be sorted by any of those — sorting is a view only, so the manual drag order is kept and restored by picking Manual order again (dragging is disabled while a sort is active). |
| **Finance** | Six sub-tabs. *Accounts*: multi-currency accounts (savings/credit/lent/custom) with transfers between them, a net-worth-over-time trend chart, and a this-period earnings/spending-by-category breakdown. *Debts*: money you lent out and money you owe, one card per person (same look as an account card), repaid in full or in any number of small portions, with an optional link to a real account so the cash movement is logged there too. *Money Goals*: save $X by date, with logged contributions. *Wishlist*: things you want to buy — name, cost, and an optional picture per item, shown as a card grid, each with its own saved-so-far progress. *Subscriptions*: recurring costs with a monthly rollup. *Currency*: a converter with live or manual exchange rates. Feeds into net worth. |
| **Fitness** | Weight log with a trend chart (BMI-zone shaded bands, moving average, zoomable), BMI/BMR/TDEE calculator (Mifflin-St Jeor), a calorie target derived from a target weight + pace, and a daily calorie-intake log whose **Calorie Budget Check** measures your real maintenance from intake vs. the scale — see [Calorie budget check](#calorie-budget-check), and a **Sleep** pane: bed/wake times per night, average duration, sleep debt, bedtime consistency and an optional quality rating, charted against a nightly goal. A night is normally recorded from the quick-actions sleep toggle rather than typed, and the pane's **battery** charges as you sleep and drains across the day so you can see what a short night is costing you at 4pm — see [Sleep tracker](#sleep-tracker). |
| **Games** | Two games behind one tab, picked by a sub-nav strip; the choice persists (`state.games.active`). **Valorant** — three sub-tabs of its own, see the row below. **TFT** — a manual Teamfight Tactics rank tracker: log where each game left your rank (tier, division, LP, and optionally the 1st–8th placement) and set a target rank with an optional deadline. Shows LP remaining to the target, an estimate of how many more games that takes at your recent LP-per-game average, whether your current pace gets you there **before the set ends** (rank resets with it, so that's the real deadline — the set is auto-detected, its end date is entered once), an LP history chart with tier-boundary gridlines, and placement stats (average placement, top-4 rate, 1st rate) scoped to the chart's zoom range. Auto-synced from a MetaTFT profile (Riot ID + region, refreshed when you open the panel), with manual entry kept as the fallback. Placements assume standard ranked (queue 1100), not Double Up. See "TFT rank sync" below. |
| ↳ *Valorant* | Three sub-tabs. *Live Match*: the lobby you're in right now — your team and the enemy team with each player's rank, peak, level and who queued together as a party; in competitive, whether each player is on a comfort pick and their win rate on that agent; in deathmatch, the lobby's average rank and its highest-ranked player. When the game ends it holds the **final standing** (deathmatch placements, or competitive Victory/Defeat with the round score) plus everyone's K/D/A until your next match starts. Read live from the local helper and never stored, see "Live Match". *RR Tracker*: competitive rank/RR history for one or more Riot accounts via the HenrikDev API, with a rank-adjusted RR history chart, tier icons, and last-played-agent art (via valorant-api.com). *Shop Tracker*: two panes, picked by a Store/Owned Skins toggle next to the account switcher (`state.valorant.storeMode`, persisted). *Store* is the week's featured bundle (shown once at the top — it's the same for every account; click it for its contents), priced at what Riot actually charges for it with the buy-it-separately total struck through beside it and the promo items it throws in free marked as such in the contents list, then per account, headed by its equipped player card, level and VP/KC balances, that account's Night Market when one is running (discounted skins with the % off on each tile), its daily VP skin offers, and its weekly Kingdom Credit accessory shop (sprays/gun buddies/player cards/titles) — each under its own countdown header. The per-account skin wishlist opens as a modal from the ★ icon in the store card's top-right corner — it flags matches in *all four* panels (daily offers, night market, bundle contents, accessory shop), turns that icon red when one is live, and can push a phone notification naming which panel the hit is in. It also prices itself: each entry shows its VP cost and the list totals at the bottom with the same top-up plan, taking each price from the firmest source available: one you typed, then today's store, then a real price remembered from any past store check (`state.valorant.skinPrices`, harvested on every render), then the skin's content tier as an estimate (marked `~`). **Melee skins are never estimated** — Riot tags nearly all of them one content tier while pricing them anywhere from 1,750 to 5,950 VP, so a tier tells you nothing; they show as unpriced until a store check sees one or you type the number. Every row's price is an editable field for exactly that reason. Free-text entries like "Vandal" name a gun rather than a skin, so they're excluded and counted separately. Clicking any VP-priced item (daily offer, night-market skin, or the bundle) also opens a **top-up calculator**: what it costs, what that account's wallet holds, what you're short, and which VP packages cover the shortfall most cheaply — including any third-party seller you've saved, with the official-only cost shown beside it for comparison. The same planner is available free-standing from the ◆ icon in the card's corner — type any VP figure and it plans for it, in either "it costs this much" (subtracts the picked account's balance) or "I need this much more" (takes the figure as the shortfall). Prices are per region, so they're typed in once under Settings → Valorant Points Prices. *Owned Skins* is the collection browser for the picked account. A quiet dot in the switcher row reports whether the local helper is up, with the explanation behind its ⓘ — the helper's actual controls are in Settings, since this tab renders from saved data and works with it off. All of it fed by local-only scripts, see "Setup". Any tile opens a preview modal with the art at full size; player cards show their horizontal, vertical, and square crops together. |
| **Checklists** | Reusable checklists with configurable auto-reset (daily/weekly/monthly/yearly), subgroups, a pomodoro-style "Play" mode that walks through items one at a time with a per-item timer (optionally with background music from a YouTube Music / YouTube playlist — see "Session music"), and miss-streak exemptions for reset periods that overlap a protected day (Settings). |
| **Notes** | A Workflowy-style outliner — every note is one row and can hold sub-notes, nested as deep as you like, with collapsible branches, a one-line title plus an optional longer body, keyboard-first editing (Enter for a new note, Tab/Shift+Tab to nest and un-nest, Shift+Enter for the body, Backspace on an empty row to remove it), **checkboxes** (turn any note into a task with ☑; parents show a done/total chip for their task children), **#tags** typed inline in a title and surfaced as a clickable filter bar, **markdown** note bodies (headings, bold/italic/strikethrough, inline + fenced code, links, lists, quotes, rules — rendered when you're not editing, raw textarea when you are), search that keeps a match's ancestor path visible, pinned notes in a strip at the top, and drag-to-reorder/reparent a whole subtree by grabbing the row itself — no handle (◀▶▲▼ buttons stand in on touch, where HTML5 drag events don't fire). A note you never typed anything into isn't kept: it's discarded as soon as focus leaves it, so an abandoned row never becomes a permanent blank line. A blank note that has picked up a body or children counts as content and stays. |
| **Jobs** | Job-application tracker — one card per application (company/role profile, company photo, salary, source, links, key contacts, resume version + optional Drive-hosted PDF), a status pipeline (prospect → applied → interviewing → offer / rejected / ghosted) with counts, filtering, sorting and free-text search (company/contact/title/location/source), free-text subcategories shown as a color-customizable pill on the card, starring/favoriting (starred applications pin to the top of the default order, plus a "★ Starred only" toolbar toggle that narrows whatever the chips/search already selected), per-application notes, auto-ghosting of applications with no news after 30 days, and a separate store of job-site logins ("🔑 Accounts", each with an optional site photo). Persists to its own storage resource, see "Persistence" below. |
| **Time** | Three panes behind a toggle. *Clock*: a live analog dial mapped to the current 12-hour half, with an optional fasting eating-window ring and custom time blocks (Sleep, Work, Gym…) drawn as colored wedges; the sidebar carries a chip for the block you're in right now. *Countdowns*: days-remaining widgets for arbitrary dates; one can be pinned to show on the Goals page. *Calendar*: a read-only agenda of your real Google Calendar, grouped by day — see "Google Calendar" below. |
| **Mantras** | Short phrases; one is shown (rerollable) on the Goals page each day. |
| **Board** | A personal board of advisers — a roster of AI personas (Truth-Teller, Pragmatist, Visionary, Health Anchor, Outsider, plus eight more to hire and any number you write yourself), a prompt maker that turns a decision into one block of markdown, and a log of past consults with the answer pasted back. Nothing here calls a model: it builds the prompt and hands it to whichever AI tool you already use. See "Board of Advisers" below. |
| **Insights** | The one cross-tracker view — every other tab answers "how is *this* going", this one answers "how am I doing". Four sections of summary cards: *Today* (level/XP, habits done, dailies done, and a "needs you" count), *Trends* (net worth, weight, habit consistency and daily activity, each a headline figure with a ▲▼ delta and a 90-day sparkline), *Pipelines* (goal completion, money goals/debts/subscriptions, the job funnel, the next countdowns) and *Games* (Valorant RR — with a chip row to pick which tracked account the card reads, defaulting to whichever one the Valorant tab has selected — and TFT LP with progress toward your goal rank). Every card is a doorway: it summarises, then links into the tab that owns the data, where the real chart lives. Nothing here is a new number — each figure is read through the owning tab's own helper, so the two can never disagree. Read-only; it never writes to `state`. |
| **Settings** | Theme (light/dark/iOS light/iOS dark), avatar visibility, net worth display currency, protected days (vacation/sick/event — exempts Habits streaks and Checklists miss-streaks, and rings those days on the habit calendars and the Goals heat map in a configurable color), backup restore, and the **access log** — every device this dashboard has been opened on and roughly where from. See "Access log" below. |

**Gamification layer:** completing goals and checklist items earns XP (weighted by goal tier) that drives a level shown on the profile card; the profile also shows a hand-drawn SVG avatar whose hair/build reflects age, chest emblem reflects level, and outfit/crown reflects net worth. Net worth = a manually-entered figure + everything tracked in Finance. The Net Worth and Fitness Level rows each carry a ▲/▼ trend marker (`trendMarker()` in `js/core.js`) — net worth against the newest `netWorthHistory` point from an earlier day, fitness against the previous `weightLog` entry. Arrow direction and color are independent: rising net worth is a green ▲, but rising weight is a red ▲ and losing weight a green ▼.

## Architecture

**No build step.** `index.html` loads Google Fonts, the Supabase JS SDK (CDN), `styles.css`, and then a fixed sequence of `<script>` tags from `js/` — load order matters because later files call functions/reference DOM refs defined in earlier ones:

```
pin.js → core.js → persistence.js → protecteddays.js → nav.js → goals.js → habits.js →
countdowns.js → settings.js → backups.js → access.js → mantras.js → motivation.js → music.js →
checklists.js → notes.js → scratch.js → finance.js → wishlist.js → jobs.js → fitness.js →
valorant.js → clock.js → calendar.js → tft.js → board.js → insights.js → main.js
```

`pin.js` is first and is the exception to the rule above — it depends on nothing, not even `el()`, because it is the PIN gate and no change to this order may be able to leave the door open (see "PIN gate"). Its `<script>` tag is also the only one not at the end of the body: it sits directly under the gate markup at the top. `tft.js` sits after `valorant.js` on purpose: it owns `showGameSubTab()`, which calls `renderValorant()` and `syncValLivePolling()`. The same list is precached by hand in `sw.js` — a name missing there installs fine and then boots offline with that tab's render function undefined, so the two must be edited together (and `SHELL_CACHE` bumped).

All modules share one global `state` object (defined in `core.js`) and a handful of small globals (`el()`, `uid()`, `escapeHtml()`, date helpers). There's no bundler, no npm dependencies, and no per-module scoping — everything is written as top-level script blocks that close over the same `state`.

- **`pin.js`** — the PIN gate (loads before everything else). Decides `owner` vs `guest` and exports `p25GateReady` / `p25IsOwner()` / `p25IsGuest()` / `p25Lock()`; see "PIN gate".
- **`core.js`** — global `state` shape, currency constants, tiny DOM/date helper functions.
- **`persistence.js`** — the `load()`/`save()` layer (see below); also owns the setup/offline/conflict banners.
- **`protecteddays.js`** — the vacation/sick/event exemption list (Settings tab): `isDateProtected()`/`dateRangeOverlapsProtected()` are the boolean fast path consumed by `habits.js` (streaks) and `checklists.js` (miss-streaks); `protectedDayFor()`/`protectedDayLabel()` return the covering entry and its display name for UI that also has to *show* the exemption and say why — the habit week/month calendars and the goals heat map, which ring protected days in `var(--protected-day, var(--violet))`.
- **`main.js`** — `renderAll()`, theme switching, kicks off `load()`.
- **`nav.js`** — tab switching, mobile sticky-header shrink. (The hold-and-drag mobile tab switcher that used to live here is gone; its bottom-right corner is now `quickactions.js`.)
- **`quickactions.js`** — the fixed bottom-right quick-actions bar. Today: the sleep toggle, see [Sleep tracker](#sleep-tracker).
- One file per feature area (`goals.js`, `habits.js`, `finance.js`, `fitness.js`, `valorant.js`, `tft.js`, `checklists.js`, `notes.js`, `scratch.js`, `countdowns.js`, `calendar.js`, `mantras.js`, `backups.js`, `settings.js`, `access.js`, `protecteddays.js`) — each owns its own render function (e.g. `renderGoals()`) and wires its own DOM event listeners directly (no central router/dispatcher).
- **`insights.js`** — the Insights tab, and the one file that reads across all the others. It loads last for that reason. Read-only: it never mutates `state` and never calls `save()`.
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
  calendar: {                          // Google Calendar (js/calendar.js) — PREFERENCES ONLY.
    calendarIds: [], lookaheadDays, bubbleDays, bubbleCount, bubbleEnabled, bubbleSound,
    bubbleCountdowns                   // fold state.countdowns into the bubble stack too
  },                                   // ✕ on a bubble is session-only and records nothing.
                                       // The fetched EVENTS are never stored either — they'd ride
                                       // in this blob on every save from every tab, and they're
                                       // stale within the hour. Same ruling as valorant.live below.
  mantras: [ { id, text } ],
  board: {                             // Board of Advisers (js/board.js) — AI personas + consults
    advisers: [ { id, presetKey, emoji, name, lens, color, hired, createdAt } ],
                                       // `lens` is the text written into the prompt under the
                                       // adviser's name; presetKey '' = hand-written. Seeded with
                                       // five defaults by applyLoadedState() the first time the
                                       // key is absent — absent, not empty, so firing everyone
                                       // stays fired instead of re-seeding on the next reload
    sessions: [ { id, createdAt, question, adviserIds, attach, prompt, response } ],
                                       // newest first, hard-capped at BOARD_SESSION_CAP (25) —
                                       // this rides the shared blob, so it can't grow unbounded
    prefs: { attach:{}, rules, tool }  // which context sources are ticked, the output contract,
  },                                   // and the last AI tool used
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
             calorieLog:[{date,kcal}], kcalOffset, activityLog:[{id,date,name,mins,kcal}],
             measureLog:[{date,checks:[]}],
             progressPhotos:[{id,filename,driveFileId,driveViewLink,uploadedAt}] },
                                       // progressPhotos holds only Drive metadata — the photo
                                       // itself is uploaded to Google Drive, never stored in state.
                                       // calorieLog is its own dated array rather than a field on
                                       // weightLog: the weigh-in and the day it measures are
                                       // different dates, and either can exist alone. kcalOffset
                                       // (1 default / 0) is which day the log row's kcal box
                                       // attributes to relative to the weigh-in date.
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
              storeMode,                   // 'store' | 'owned' — which Shop Tracker pane is showing
              vp: { currency, packages:[{vp,price}], offers:[{id,name,vp,price}], useOffers },
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
                                       // the daily skins, used by the widget's countdown and by the
                                       // "Daily Offers" section header). Both panels stack in one
                                       // column, each under a header carrying its own countdown.
                                       // Entries written before accessories were added simply have
                                       // no `accessories` key, so that section shows a
                                       // re-run-the-check note until their next check fills it in.
                                       // Player-card offers also
                                       // carry art:{wide,large,small} — the three crops the preview
                                       // modal shows side by side (openValItemPreview() in valorant.js);
                                       // every other accessory type has art:null and one image.
                                       // Each entry also carries `bundle` (the week's featured
                                       // bundle: name, art, remainingSeconds from checkedAt, and
                                       // `items` — its contents, taken from the storefront's own
                                       // item list rather than valorant-api's bundle record. It
                                       // is priced twice, like a night-market offer: `price` is
                                       // what the contents cost bought one by one and
                                       // `discountPrice` is what Riot charges for the bundle.
                                       // The two differ by thousands of VP whenever the bundle
                                       // has promo items in it — the free melee/buddy/card a
                                       // launch bundle is sold on, flagged `isPromo` on the item
                                       // and priced into the bundle total only — so the paid
                                       // figure is the one shown and the base one follows it
                                       // struck through. Each item carries the same two prices.
                                       // A store checked before this was recorded has no
                                       // discountPrice and falls back to the base total),
                                       // `nightMarket` ({offers,remainingSeconds}, null the ~11
                                       // months a year it isn't running; each offer carries
                                       // price, discountPrice and discountPercent), `identity`
                                       // (the equipped player card: cardName + the same three
                                       // crops, plus `level`) and `wallet` ({vp,rad,kc}).
                                       // Riot features one bundle for everybody, so the Shop
                                       // Tracker renders it once above all accounts, from
                                       // whichever account was checked most recently — see
                                       // valFeaturedBundleHtml() in valorant.js. The other three
                                       // are per account: nightMarket is a personal set of
                                       // discounts, `identity` is what the account headers draw
                                       // as an avatar so several tracked accounts are tellable
                                       // apart at a glance, and `wallet` is the balance shown
                                       // beside it so a price can be read against it. All are
                                       // best-effort lookups that degrade to absent rather than
                                       // failing a store check, so pre-existing entries simply
                                       // don't have them.
                                       // ownedSkins is the same shape/origin, but for every owned
                                       // weapon skin (sorted by tier), written by the Local
                                       // Helper's "🎨 Check Owned Skins" button — see
                                       // checkAccountOwnedSkins() in scripts/valorant-lib.mjs.
                                       // wishlist holds gun/skin names to watch for, added either by
                                       // free text or by picking a real skin (with image + uuid)
                                       // from the search-as-you-type list backed by
                                       // valorant-api.com/v1/weapons/skins — see ensureValSkinDb()
                                       // in valorant.js.
                                       // `vp` feeds the top-up calculator in the item preview
                                       // (valVpPlan() in valorant.js): `packages` are Riot's
                                       // tiers, which are the same everywhere, with prices typed
                                       // in per region/currency — price 0 means "not sold here"
                                       // and is left out of a cost comparison. `offers` are
                                       // third-party sellers (a discounted top-up shop):
                                       // {id,name,vp,price,on} rows pooled with the official
                                       // tiers, grouped in Settings by `name` (renaming a group
                                       // renames its rows; its checkbox sets `on` across them, so
                                       // a seller can be benched without losing its prices),
                                       // dropped from consideration entirely when useOffers is
                                       // false or the row's `on` is false, and
                                       // always reported alongside what the official-only route
                                       // would have cost. The search is an unbounded coin change
                                       // that deliberately looks *past* the shortfall, since bulk
                                       // VP is cheaper per point; it minimises money, then number
                                       // of purchases, then leaves more VP over. With no prices
                                       // anywhere it minimises VP bought instead — nothing else
                                       // is knowable then. The same planner totals a whole
                                       // wishlist (renderValWishlistTotal()). No API publishes VP
                                       // prices, so pricing an entry walks: typed > in the store
                                       // now > skinPrices (real prices harvested from past checks)
                                       // > content tier, an estimate and shown as one. Melee is
                                       // excluded from the tier step entirely — see
                                       // ensureValMeleeSkins() in valorant.js for why a tier
                                       // cannot price a melee skin.
                                       // wishlist is matched (case-insensitive substring)
                                       // against every panel a check records — daily offers,
                                       // night market, the featured bundle's contents and the
                                       // accessory shop — to flag tiles, badge the bundle banner
                                       // and light up the red nav-bar tick. valOfferedItems()
                                       // in valorant.js flattens the four; collectOfferedItems()
                                       // in scripts/valorant-lib.mjs is its twin, used so the
                                       // ntfy push watches the same four rather than only the
                                       // daily offers (which is all either used to do).
                                       // localServerUrl/localServerToken point Settings ->
                                       // "Valorant Local Helper" (token + Add Account) and the
                                       // Valorant tab's account dropdown/Check Store/Delete at
                                       // scripts/valorant-local-server.mjs (also local-only) so
                                       // those can be buttons instead of terminal commands — see
                                       // "Setup" below.
  games: { active },                   // 'valorant' | 'tft' — which game the Games tab is showing.
                                       // Persisted, unlike the Time/Finance sub-navs: those are two
                                       // views of one concern, these are two different games. Also
                                       // gates the Live Match poll (syncValLivePolling() runs only
                                       // when Games is on Valorant AND its Live sub-tab is open).
                                       // Defaulted in core.js as well as applyLoadedState(), because
                                       // syncValLivePolling() can fire before a load finishes.
  tft: { entries: [ {id,date,createdAt,tier,division,lp,placement,src,srcKey} ],
         target: { tier, division, lp, date, startValue, setAt },
         season: { set, endDate },
         sync: { region, riotId, auto, lastSyncedAt, lastError, cutoffs } },
                                       // season.set is detected from synced records (tft_set_name);
                                       // season.endDate is typed by hand, because Riot announces it
                                       // in patch notes and nothing exposes it (MetaTFT and the set
                                       // tables were both checked). It's the deadline the pace line
                                       // races, since rank RESETS when a set ends — LP not earned
                                       // by then has to be earned again. tftMergeSynced() clears
                                       // endDate when it sees the set name change, so a rollover
                                       // can't leave a stale date quietly skewing the pace.
                                       // target.date is the pre-hoist version of the same idea,
                                       // kept only so applyLoadedState() can migrate it across.
                                       // src:'' is hand-typed, 'metatft' came from tftSync().
                                       // srcKey is MetaTFT's own rating-change timestamp and is
                                       // what makes re-syncing idempotent — a known srcKey is
                                       // skipped rather than re-added. Hand-typed rows carry no
                                       // srcKey, so a sync can never duplicate or overwrite one.
                                       // sync.region is the PLATFORM code (sg2, na1, euw1...), not
                                       // the routing region MetaTFT shows in its own profile URLs:
                                       // a /player/sea/... profile is indexed under sg2.
                                       // Manual Teamfight Tactics log — no API path exists (the
                                       // HenrikDev key above is Valorant-only; Riot's official TFT
                                       // API needs a personal key that expires every 24h).
                                       // Every record is a rank checkpoint that MAY carry a
                                       // placement: placement:null is a plain rank check (starting
                                       // rank, decay, soft reset) — it still plots and still moves
                                       // LP, but it isn't a game played, so it's excluded from the
                                       // placement stats and the LP-per-game average. LP deltas are
                                       // DERIVED from consecutive entries, never stored, so editing
                                       // a record can't leave a stale delta behind. createdAt is the
                                       // tiebreak ordering several games on the same day — see
                                       // tftSortedEntries() in js/tft.js, the only place ordering
                                       // happens. Capped at 500 entries: this rides in the shared
                                       // row, which is re-uploaded in full on every save from any tab.
                                       // Rank power = tierIndex*100 + LP, the same trick as the RR
                                       // chart's valOf(). Master, Grandmaster and Challenger share
                                       // ONE step (28): in TFT they're one LP pool and GM/Challenger
                                       // are ladder cutoffs, not LP thresholds — separate steps would
                                       // rank "Master 400 LP" above "Challenger 0 LP". The cost is
                                       // that a GM/Challenger target needs the current cutoff LP
                                       // typed into target.lp; the UI says so rather than guessing.
                                       // target.startValue anchors the progress bar at where the
                                       // climb started, so a Diamond target set from Platinum doesn't
                                       // show 85% before a single game.
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
                                       // kept out of the sidebar (visibleNavItems()). Presentation
                                       // only — the view and its data are untouched. 'settings' is
                                       // never hideable and is filtered out on load too, so a bad
                                       // saved value can't lock the settings screen away; if the
                                       // active tab is hidden, applyTabVisibility() falls through
                                       // to the first visible one
  hideTabIcons: false,                 // Settings -> "Tab Icons": drops the per-tab logos for a
                                       // text-only nav (mobile's icon-only strip switches to
                                       // labels) — applyTabIcons(), all three in js/settings.js
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

### PIN gate

`js/pin.js` + `#pinGate` in `index.html`. The app asks for a 6-digit PIN before it opens, and there are two of them:

- the **owner** PIN opens everything;
- the **guest** PIN opens a **read-only** app, minus the scratch page (`js/scratch.js`).

Neither PIN is written down here or in the source. `pin.js` holds an FNV-1a/32 hash of each (`'p25.gate.v1:' + pin`), which buys exactly one thing: a casual `grep` of the repo for six digits turns up nothing. To change or add one, print the hash and edit `PIN_ROLES` at the top of `js/pin.js`:

```
node -e "const p=process.argv[1];let h=0x811c9dc5;const s='p25.gate.v1:'+p;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}console.log(h.toString(16))" 123456
```

**This is a soft gate, not authentication, and it is important to be clear-eyed about that.** The whole file ships to the browser, the PIN space is a million wide, and the Supabase row behind the app stays unauthenticated whichever PIN was typed (see the next section — anyone with the link can already read that row with `curl`). What the gate is actually good for: the dashboard doesn't open itself to whoever picks up an unlocked laptop, and a guest gets a deliberately smaller version of the app. Don't put anything behind it that would be a real problem to lose.

How it hangs together:

- **It loads first**, before `core.js`, and its markup is the first thing in `<body>` — so the door is painted before anything behind it, and it stays shut if the script never runs at all. It depends on nothing else in `js/` (not even `el()`), so no change to the script order can leave it open.
- **The boot waits on it.** `js/main.js` calls `load()` from `window.p25GateReady.then(…)` rather than racing it, because the role decides which storage resources may be *fetched*: `loadScratchData()` returns immediately for a guest, so a guest's browser never holds the scratch content at all. Hiding a way in while the text sits in memory would be a curtain, not a door. An already-unlocked session resolves on the first microtask, so a reload pays nothing for the wait.
- **Unknown fails closed.** `p25IsGuest()` answers `true` for a role that hasn't been decided yet, and the three scratch guards are phrased as "not the owner" rather than "is a guest" — if `pin.js` were somehow absent, that loses an easter egg instead of leaking one.
- **The role is never passed in from outside.** There is no `p25SetRole()` and `unlock()` isn't exported; typing the owner's PIN into this file's own handler is the only way to become the owner.
- **`sessionStorage` for the role, `localStorage` for the two things that must outlive the tab** — the 30-second lockout after 5 wrong tries (so reloading isn't the way past it) and the trusted-device record below. Closing the tab ends an untrusted session, which is the whole point of a door; a reload doesn't, because re-typing a PIN after an accidental refresh mid-edit teaches you to hate the gate.

#### Trusted devices

An owner unlock with **Trust this device** ticked (it is by default) writes a record to `localStorage`, and from then on that browser profile opens straight through with no PIN. Untick the box on a machine that isn't yours.

- **`localStorage` *is* the device identity** — already per-origin and per-browser-profile. Nothing is fingerprinted and nothing is sent anywhere.
- **Only an owner unlock trusts.** A guest PIN never writes a record however the box is set: a guest session is meant to end with the tab, and a device that silently came back as a guest would be a second, quieter way in that nobody chose. The Settings card says so outright, since the ticked box gave no sign it would be ignored.
- **The 90-day window is idle-based and slides** — it counts from the last visit, not from when trust was granted, so a device in regular use is never asked again while one that dropped out of rotation for three months asks once. A `seen` in the future (clock moved back, or the value was edited) counts as expired.
- **A session role beats device trust.** That's what lets a guest session survive a reload on a trusted device — otherwise handing someone the laptop in guest mode would come back as the owner the first time they refreshed.
- **🔒 Lock now deletes the trust record as well as the session**, and has to: leaving it would let the reload walk straight back in and the button would do nothing. So Lock means exactly one thing — "ask me for the PIN again" — and re-trusting is one ticked box away on the screen it takes you to. It's also how to hand the device over untrusted: Lock, then let them in with the guest PIN.
- **There is no remote revocation.** A lost laptop can't be un-trusted from another device; the record is local and the gate resolves before any data is fetched. Changing the owner PIN doesn't help either — an already-trusted device never checks it again. If that ever matters, it's the same answer as everything else in this section: Supabase Auth + RLS.

**What trusting a device trades away**: on that device the gate no longer asks, so it stops being any protection against whoever picks it up. That's the deliberate point — your own machines shouldn't nag — but it leaves the gate guarding only devices that aren't yours, which is worth little by itself given the data behind it is readable by anyone with the URL.
- **The keypad is the input** — no text field, so a phone never raises a soft keyboard over the keys. A hardware keyboard works too (digits, Backspace), and focus is pulled back into the gate if Tab tries to walk into the page behind it.
- **Guests still see the app is gated**: Settings → Data → *Lock screen* reports which PIN got in and offers **🔒 Lock now** (clears the session role and reloads). Its wording never names the scratch page — a guest is told they have "a restricted version", because the scratch page's entire design is that nothing in the UI admits it exists.
- `document.body` carries `data-role="owner" | "guest" | "locked"`, which is the CSS half of the same answer, for anything that wants to hide an owner-only control without a line of script.
- **It holds the document still while it's up** (`html.pin-gate-locked`) and puts the page back to the top on the way out. Not cosmetic: the mobile navbar is `position:sticky; top:0`, and a sticky element is re-pinned only by the scroll machinery — so a document that scrolled under the gate left the bar parked off-screen until the next swipe. `releasePage()` also re-fires `scroll` and `resize` so `nav.js`'s `onScroll()` and `measureNav()` run before the first paint of the app. For the same reason nothing auto-focuses a key on a touch screen (focusing scrolls it into view) — the same rule as `scratchWantsAutoFocus()` in `scratch.js`.

#### Guests are read-only

A guest can read every tab (bar scratch) and change nothing. The rule has **one definition** — `p25CanWrite()` in `pin.js`, reached everywhere through the one-line `appCanWrite()` wrapper in `core.js` — and it is enforced at the *bottom* of each write path rather than by disabling controls, so there is nothing to remember when the next feature is added:

| Write path | Where it's refused |
|---|---|
| all four storage resources | `doSave()`, `doSaveJobs()`, `doSaveNotes()`, `doSaveScratch()` — ahead of the local mirror too |
| Supabase Storage (every image in the app) | `uploadCompressedImage()` / `deleteStorageImage()` in `core.js` |
| Google Drive uploads | `driveUploadPhoto()` (fitness), the résumé upload (jobs) |
| backup restore | `doRestore()`, before the Edge Function is called |
| AI subtask suggestions | `goals.js` — no data written, but it spends the owner's rate-limited Anthropic quota |
| the local helper's six action routes | `startValHelper`, `stopValHelper`, `commitValAcctRename`, `runValStoreCheck`, `startValLoginWindow`, add-account save |

Read paths are untouched: `manage-backups` list, `google-calendar`, `pinterest-feed`, MetaTFT sync, and the helper's `/status`, `/live` and `/tft-live` polls all still work.

Two consequences worth knowing about, both deliberate:

- **A guest's edits look like they worked until the page reloads.** Every mutation happens in memory and the tab re-renders; only the save is refused. Intercepting mutations across twenty-odd files isn't feasible without a rewrite, and the save layer is the one true choke point — so instead the guest gets a standing **Read-only** banner at the top of every tab (`showReadOnlyBanner()`), which pulses once the first time a write is actually refused. Blocking at the save layer is also what makes the guarantee airtight: `force` doesn't get past it either, since that flag means "the user chose to overwrite a conflict", never "the rules are off".
- **A guest's visit is not recorded in the access log.** The only way to record one is `save()`, which re-uploads the whole shared blob — including whatever else the guest had touched in memory. An accurate log and an honest read-only rule can't both be had, and the read-only rule wins; the same return also stops a guest's IP being sent to the geo lookup service for a row that could never be saved.

### Persistence — two modes, no auth

`js/persistence.js` picks a storage backend at load time:

1. **Inside Claude (claude.ai)** — if `window.storage` exists, uses that built-in key/value API directly. No setup, no Supabase involved.
2. **Deployed elsewhere (e.g. GitHub Pages)** — falls back to Supabase. **There is no login.** Every visitor reads/writes the *same shared row* (`app_data` table, `id = 'shared'`) via the anon key baked into `persistence.js`. Anyone with the link can view and edit the data.

Key mechanics in this layer:
- **Optimistic concurrency**: `save()` tracks `lastKnownUpdatedAt` and does a conditional `UPDATE ... WHERE updated_at = <last known>`. If another tab/device saved in between, the conditional update matches zero rows and a conflict banner appears (reload vs. force-overwrite).
- **Offline cache**: state is mirrored to `localStorage` after every successful load/save; if a live load fails, the app falls back to that cached copy and shows an offline banner. This is read-fallback only — it doesn't queue writes, it just keeps `save()`'s existing conflict check as the safety net once connectivity returns.
- **Debounced saves** for high-frequency inputs (typing in number fields) to stay within free-tier request limits; discrete actions (clicks, checkbox toggles) save immediately.
- `save()` is a no-op until a load has genuinely completed (`loadedOk`), so a failed/ambiguous load can never clobber remote data with in-memory defaults.
- **Jobs, Notes and the scratch page are each stored separately** — `app_data` rows `id = 'jobs'`, `id = 'notes'` and `id = 'scratch'` (or the `app-data-jobs` / `app-data-notes` / `app-data-scratch` keys in Claude-storage mode), owned by `saveJobs()`/`loadJobsData()` in `js/jobs.js`, `saveNotes()`/`loadNotesData()` in `js/notes.js` and `saveScratch()`/`loadScratchData()` in `js/scratch.js`. Reason: the shared row is re-serialized and re-uploaded *in full* on every save from *any* tab, so a long list of job applications would be re-sent every time an unrelated habit got ticked. Notes is the sharper case — it debounce-saves on every keystroke, so leaving the outline in the shared row would mean re-uploading every goal, habit, finance record and Valorant store in the app for each paragraph typed. Each dedicated resource reimplements the same safety properties (its own `loadedOk` gate, optimistic-concurrency conflict detection, offline cache, serialized save chain) and shows its own conflict/offline banners inside its own tab. No extra SQL setup — the rows are created by the app on first save. `state.jobSiteAccounts` deliberately stays in the shared row. The Jobs and Notes loaders also carry a permanent migration guard: whenever one finds its dedicated resource absent, it seeds it from any pre-split array still embedded in the shared row, and durably writes that seed *before* the shared row's next save strips the legacy copy. `loadScratchData()` has no such guard and takes no `parsedMainState` — `state.scratch` shipped with its own row and has never lived in the shared blob, so there is nothing to rescue.
- **The scratch page rides the same machinery, minus the compaction.** `scratch.js:serializeScratch()` writes `{ html, updatedAt }` whole — the ~45% win above comes from per-record key overhead across many small records, which a single string doesn't have — and it doubles as the outbound sanitizer boundary. It holds a stack of pages (`{ pages:[{id,html,updatedAt}], activeId }`), navigated by swipe on touch, hold-Tab-and-scroll on desktop, or the dot row; `activeId` is persisted so reopening lands where you left off, page names are derived from each page's first line, and trailing blank pages are swept on close. The surface is `contenteditable` rather than a `<textarea>` so it can hold tickboxes, links and pasted images; everything crossing either boundary goes through `sanitizeScratchHtml()`, which re-parses with `DOMParser` and rebuilds against an allowlist rather than filtering. Pasted images are uploaded via `uploadCompressedImage()` and stored as Storage **URLs**, never base64 — this page is re-sent whole on every debounce fire, so an inlined photo would be re-uploaded every 1.5s while you typed. A photo can also be **lifted out of the text and dropped anywhere on the sheet**, overlapping the writing and the other photos: drag an image to lift and move it in one gesture (long-press first on a phone), use the ⊕ button on its hover outline to send it back into the text, `[` and `]` to change which photo is on top, and drag a file straight onto the sheet to have it land floating where you let go. The position rides on the image as `data-x`/`data-y`/`data-z` attributes that the sanitizer validates the same way it validates `width` — x is a percentage of the column so a layout placed on a laptop still reads on a phone. Transparency survives all of this: `uploadCompressedImage()` only keeps its JPEG re-encode for images that have no alpha to lose, and a floating image is painted with no background and no rounded corners, so a cut-out PNG composites against whatever is underneath it. Both older row shapes upgrade in place on load: the original plain-`<textarea>` build (`{ text }`) and the single-page build (`{ html }`) each become one page. It shares the 1.5s debounce and flush-on-hide/unload, and caps at 300k chars. Its conflict banner is blunter on purpose — "load theirs" discards the entire page rather than one record, so the displaced draft is offered back with a **Put mine back** button.
- **Notes uses a compact wire format.** `notes.js:serializeNotes()` is the only thing allowed to serialize `state.notes`; it omits every field sitting at its default (`parentId: null`, `body: ''`, `collapsed`/`pinned` false, `updatedAt === createdAt`), which `applyLoadedNotesState()` puts straight back on load. An outliner is mostly short titles, so the fixed per-record key overhead otherwise dominates the payload — measured at ~45% smaller on a representative tree, off both upload *and* download. The typing debounce here is 1.5s rather than the shared `debouncedSave()`'s 700ms, since note bodies are written as continuous prose and every fired timer is a full re-upload of the outline; pending writes are flushed on tab-hide and unload so nothing is lost.

### Supabase backend

Six Edge Functions (`supabase/functions/`), called via `supabase.functions.invoke(...)` so secrets never reach the browser:

- **`manage-backups`** — lets the client list/restore daily backups from a private Storage bucket (`backups`) without ever exposing the `service_role` key to the browser. Read-only from the client's perspective.
- **`suggest-subtasks`** — proxies "suggest subtasks for this goal" to the Anthropic API (`claude-haiku-4-5`) using a server-side `ANTHROPIC_API_KEY` secret, with a shared daily call cap (`ai_usage` table, 30/day) and a 300-token cap per call.
- **`upload-fitness-photo`** — uploads a Fitness tab progress photo straight to a Google Drive folder on the app owner's behalf. Uses a one-time-obtained Google OAuth refresh token (server secret) to mint a fresh access token per call, so uploads are fully automatic — no per-upload consent prompt. Only the returned Drive file id/link are saved into app state; the image bytes themselves live only in Drive.
- **`upload-resume`** — same pattern as `upload-fitness-photo`, for the Jobs tab's per-application resume PDF attachment: uploads straight to a Google Drive folder named "Uploaded Resumes" (auto-created on first use if it doesn't exist, or pinned to a specific folder via the optional `GOOGLE_DRIVE_RESUMES_FOLDER_ID` secret), reusing the same `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN` secrets as the fitness-photo function — no separate Google OAuth setup needed if that's already configured. Only the Drive file id/link are saved into app state; the PDF bytes live only in Drive.

- **`google-calendar`** — reads the app owner's Google Calendar for the Time tab's Calendar pane. Same server-side-refresh-token pattern as the two Drive functions, but with its **own** secret `GOOGLE_CALENDAR_REFRESH_TOKEN` rather than reusing `GOOGLE_REFRESH_TOKEN`: that one carries only `drive.file`, so making it work here would mean re-consenting it into a combined token that Fitness photos and resume uploads both already depend on. Scope is `calendar.readonly`, so nothing on either side of this wire can create, edit or delete a real event. Two actions — `{action:'calendars'}` returns the account's calendar list for the picker, `{action:'events', calendarIds}` returns the merged agenda. Calendar ids are validated against `CAL_ID_RE` before being interpolated into the API path, which is the whole SSRF guard (same role `USERNAME_RE` plays in `pinterest-feed`), and the fan-out is capped at 10 calendars / 250 events / a 60-day window. Events are **trimmed server-side** to `{id, calendarId, summary, location, htmlLink, allDay, startIso, endIso, startMs}` — Google's raw item also carries attendee email addresses, descriptions and conference join links, and this app's browser context is an unauthenticated shared row, so none of that crosses the wire.

- **`pinterest-feed`** — reads a Pinterest profile's public RSS feeds and returns its pins as JSON. No secret is involved — it exists purely because Pinterest serves no CORS headers, so the browser can't read those files itself. The Motivation tab uses it for **Pinterest collections**: a category with `source: 'pinterest'` replaces its images with 25 random pins the first time the app is opened on a new day (`cat.lastSync` holds the day key), so the slideshow shows something different every morning. Images stay as `i.pinimg.com` URLs — nothing is copied into Storage, so a refresh leaves nothing behind. The 📌 on a thumbnail copies that pin into an ordinary category called **Saved Pins**, which the daily refresh never touches. The username is validated against `^[A-Za-z0-9_][A-Za-z0-9_-]{0,58}$` server-side — it's interpolated into the fetched URLs' paths, so that check is the whole SSRF guard.

  **Video pins.** The same function has a second action, `{ resolve: [pinUrl, …] } → { videos: { [pinUrl]: mp4Url } }`, which is how a collection plays video pins rather than showing their cover frame as a still. It's separate from the feed read because RSS carries only a pin's cover `<img>` — determining whether a pin is a video means fetching the pin *page* and pulling the mp4 out of the JSON embedded in it (unescape `\/`, then match `v*.pinimg.com/videos/….mp4`, preferring the 720p rendition; `.m3u8`/HLS variants are excluded since `<video>` can't play them outside Safari). Doing that for the whole merged pool of 138–378 pins would dwarf the feed read itself, for pins about to be discarded — so the client picks its 25 first and asks about only those, through the same 6-wide worker pool. Client-side (`resolvePinterestVideos()` in `js/motivation.js`) the call is deliberately **fire-and-forget after the images are already on screen and saved**: nothing about the collection depends on it, so a slow or failed resolve just leaves the pins as stills, exactly as they behaved before this existed. Results are patched back **by record id, never by index**, since another sync or a delete may have rewritten the list mid-flight. Pin URLs arriving from the client are validated against `PIN_URL_RE` server-side — same role as the username check, and the whole SSRF guard for this action.

  Playback matters for cost: the mp4 is handed to the browser and loaded **straight from `v1.pinimg.com`**, never proxied through the function, so video costs Supabase exactly as little as the stills do. One reused `<video>` element sits over the two crossfading `<img>` layers, so the cover image is both the poster and the fallback; `preload="none"` plus dropping `src` on the way out stop a slide you passed through from buffering in the background, and the one-ahead prefetch deliberately warms only the *cover*, never the clip. A video slide holds until its `ended` event instead of the 5s image beat, capped at 30s so one long pin can't park the slideshow. Autoplay refusal (`NotAllowedError`) drops the whole session to stills until the next tap — a tap being the user gesture that makes `play()` allowed — while an individual unplayable clip is remembered per-URL so it degrades alone; `AbortError` is ignored outright, since it just means you tapped through to the next slide mid-play.

  **Why it fetches every board, not just `/<user>/feed.rss`.** That profile feed is a fixed window of the ~25 most recent saves and has no pagination — `?page=` and `?limit=` are ignored — so on its own the collection could only ever show what you pinned lately. Each *board* feed (`/<user>/<board>.rss`) has its own ~26-item window, and a board you last added to a year ago returns year-old pins, so merging every board is what reaches back into the archive: measured 138–378 unique pins across real profiles versus 23 from the profile feed alone. Board slugs are scraped from the profile page's own HTML (`"/<user>/<slug>/"`, minus a reserved-slug list) and fetched through a 6-wide worker pool, ~3.5s for a full merge. Best-effort by design — Pinterest lazy-loads boards past the first screenful, so a profile with dozens of boards yields the first ~10–15, and any discovery failure falls back to the profile feed alone. Note this reads the profile's *own* pins throughout: the logged-in home feed (pins from accounts you follow) is private, with no RSS or public API.

**Backups**: `scripts/backup-supabase.sh` (run daily by `.github/workflows/backup-supabase.yml` via cron at 07:00 UTC) pulls both `app_data` rows (`shared` + `jobs`) with the service-role key and uploads them as `<YYYY-MM-DD>.json` to a private Storage bucket. The Settings tab can list and restore from these via the `manage-backups` function. The file is an array of `{id, data}` objects — **consumers must key off `.id`, never array position** (rows come back ordered by id, so `jobs` precedes `shared`). Backup files written before Jobs was split out have the older single-row shape `[{"data":{…}}]` with no `id` key; `manage-backups` detects and handles both, and restore recovers Jobs data from the legacy embedded copy when a backup predates the split.

**Daily Valorant store check — deliberately *not* an Edge Function.** An earlier version of this ran as a Supabase Edge Function on a GitHub Actions cron, like the backup above. It doesn't work: fetching your personal storefront requires silently re-authenticating to Riot's internal client API, and Riot's fraud/bot detection flags that reauth as low-trust and forces an interactive login again whenever it comes from a cloud/data-center IP (Supabase's Edge Function infrastructure, in this case) instead of your own device. Rather than fight that detection, `scripts/valorant-check-store.mjs` runs **locally, on your own machine** — the same device/IP that did the original login, which Riot's risk engine already trusts — and writes into the shared `app_data` row via a small Postgres function (`valorant_set_daily_store`, see the SQL comment in `scripts/valorant-lib.mjs`) called through the same public anon key the app itself already uses (see "Persistence" above; there's no login on this app, so no extra credential is needed to write there). That function patches just `valorant.dailyStores[label]` server-side with `jsonb_set` — earlier versions read the *entire* row into the script, mutated it, then wrote the whole thing back, which meant every check (and every tracked account) round-tripped the whole row, images and all. See "Setup" below.

**A session is sometimes two cookies — `ssid`, and for some accounts `clid`.** This one cost a whole debugging session, so it's worth stating precisely.

`ssid` is the session. `clid` is a **three-character auth-cluster code** (`ec1`, `as1`, …) telling Riot which cluster holds that session. Omit it and the reauth goes to the default cluster: fine if that's where your session lives, a `303 -> authenticate.riotgames.com/login` if it isn't. That bounce is **byte-for-byte the expired-session response**, so an account on a non-default cluster reports "Valorant session expired" forever, and re-copying the `ssid` never helps — which is exactly how it presented.

Two properties matter for anything built on this. It is **validated, not merely required**: for an account whose session is on `ec1`, every other code tested (`as1`, `eu1`, `na1`, `sg1`, `ap1`, `us1`, and a junk value) was rejected. And it is **not discoverable** — an unauthenticated request to the authorize endpoint is handed `clid=as1` regardless of whose session you then present, so there is nothing to derive it from. It has to come from the browser that logged in, where it sits beside `ssid` under `auth.riotgames.com`. Riot's full cluster list is unknown, so guessing codes is not a fallback worth building.

Hence the shape of the code: `silentReauth()` sends the **whole saved jar** (`sessionCookieHeader()`), `loginAccount()` stores **whatever cookies it was handed** rather than a fixed two, and the login window captures the entire `riotgames.com` jar — so the next cookie Riot decides to require needs no change here. `tdid` and `csid` were tested and are *not* required. A session with no `clid` that Riot refuses fails as "session **incomplete**" rather than "expired": deliberately different words, because "sign in again" and "you also need the clid cookie" are different instructions, and `js/valorant.js` matches that word to offer 🔑 Re-login.

**Getting the initial session — deliberately *not* an automated browser login either.** An earlier version of `scripts/valorant-login.mjs` used Puppeteer to open a real, visible Chrome window at Riot's login page. That doesn't work either: Riot's fraud detection fingerprints automation-controlled browsers (e.g. `navigator.webdriver`, other DevTools-Protocol tells) independently of the IP check above, and silently rejects the login — surfaced as a misleading "username or password may be incorrect" even with correct credentials, regardless of whether Chromium or a real installed Chrome drives it. Getting around that would mean actively evading a fraud-detection system built specifically to block this kind of automated access, which this project won't do (same principle as not automating past the login captcha). So `valorant-login.mjs` doesn't touch a browser at all: you log into `playvalorant.com` yourself, in your own completely normal browser, then copy the resulting `ssid` session cookie out of DevTools and either paste it when the script prompts for it or paste it into the Valorant tab's "+ Add Account" field. Everything downstream of that (the daily check, the local server) is plain `fetch()` calls with that cookie — no browser involved.

**"Log in with browser" — the DevTools trip removed, the ruling above intact.** Sessions expire every 1-3 weeks, and the fix was five manual steps every time, so `scripts/valorant-login-window.mjs` (offered as **🌐 Log in with browser** inside the Add-account / Re-login dialog, and runnable on its own) automates the *copy*, never the *login*. It is deliberately **opt-in rather than the default**: the buttons that fix a session open a paste dialog, and a window only opens if you ask for one there — pasting two cookies you already have on screen beats a window that opens itself. The distinction is the whole design, and it's worth being precise about which half Riot objects to:

- It launches **your own default browser** — resolved from the Windows `https` handler in the registry, falling back to Chrome, then Brave, then Edge, and overridable with `VALORANT_LOGIN_BROWSER` — with `--app=<Riot's own authorize URL>` and a fresh `--user-data-dir`, so what opens is a small, signed-out, otherwise ordinary window of the browser you already use. **No driver, no `--enable-automation`, no injected script, nothing typed into the form** — you sign in there exactly as you would anywhere else, captcha and 2FA and all. (Chromium-family only: the cookie read below is the DevTools Protocol, which Firefox and Safari don't speak, so a Firefox default falls through to the list rather than failing.)
- **Nothing hides anything from Riot.** There is not one anti-detection flag in that argv, and none may be added. The moment this needs to *disguise* the window, it has become the thing this project refuses to do — at that point the answer is the manual paste (still there, in the tab and in `valorant-login.mjs`), not a better disguise.
- The cookie is read through the browser's own debugging endpoint (`--remote-debugging-port=0`, port discovered from the profile's `DevToolsActivePort` file) at the **browser** target level, via `Storage.getCookies`. The page target is never attached to and no protocol domain is ever enabled on it, so nothing observable from the login page changes. It is a read of your own cookie jar on your own machine — the DevTools copy-paste it replaces, minus the tedium.
- It takes the **whole Riot cookie jar**, not one cookie, and waits until both `ssid` and `clid` are present before trying to save. That is its real advantage over the manual paste, which is easy to do half of — and it means a future cookie requirement needs no change here.
- The profile directory (`scripts/.valorant-login-profile`, gitignored) is created fresh per attempt and **deleted the moment the cookie is saved**: it holds a live Riot session, and one copy of that in `.valorant-session.json` is enough. It's also what makes each attempt a signed-out window rather than a second view of your everyday browser.
- Each poll runs the found cookie through the same `silentReauth()` the paste path uses before saving, so a cookie that exists but isn't a finished login just means the loop keeps waiting. Ten-minute timeout, one window at a time machine-wide, and the window is killed and the profile wiped on success, cancel, timeout or error alike.

  What this does *not* do is make an unattended login possible: something still has to be watching for the window and typing a password into it. That's the point. It removes the DevTools detour, not the human.

  **The local helper server is not required for any of this.** `node scripts/valorant-login-window.mjs` (or double-clicking `scripts\valorant-login-window.cmd`) is the whole job on its own: window opens, you sign in, `scripts/.valorant-session.json` is rewritten in place. With one saved account it refreshes that one without being told which; with several it asks. The helper's `/login-window` routes are a second front door onto the same function — what the tab's buttons need, not what the flow needs.

**Local Helper server — a browser-to-localhost bridge, not a cloud service.** `scripts/valorant-local-server.mjs` is an optional plain `node:http` server that only ever binds to `127.0.0.1`. It exists so the Valorant tab's "Check Store Now", "+ Add Account", and "🗑 Delete" buttons can trigger `valorant-check-store.mjs`/`valorant-login.mjs`/account removal (via functions imported from `scripts/valorant-lib.mjs`) without you opening a terminal each time. The deployed page (an `https://` origin) calling an `http://127.0.0.1` server works because loopback addresses are a "potentially trustworthy origin" under the Secure Contexts spec — browsers don't treat it as mixed content — but every request still needs a token: on first run the server generates one (saved to `scripts/.valorant-local-token.json`, gitignored) and prints it once for you to paste into the tab's "Local Helper" panel. Without a matching token, `/check`, `/login`, `/login-window*`, and `/delete-account` all 401; `/status` (which only lists saved account *labels*, never session cookies, plus whether a login window is currently open) needs no token, just enough to drive the connection indicator and the account picker. The three `/login-window` routes are start/status/cancel rather than one blocking call, because signing in takes minutes and no browser should be asked to hold a request open that long — which also means a login window survives a page reload, and `/status` reporting it is what lets the reloaded page pick it back up instead of offering to open a second one.

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

### TFT rank sync

The TFT tracker fills itself from a **MetaTFT** profile. Unlike every other live-data feature in this app it needs no key, no local helper and no Edge Function: MetaTFT's `public/` endpoints answer with a permissive CORS header (they reflect the request `Origin`), so `js/tft.js` fetches them straight from the page.

Set it up by entering your **Riot ID** (`Name#TAG`) and **region** in the row at the top of the TFT panel, then pressing ↻ Sync now. With "Auto-sync on open" ticked it also refreshes whenever you open the panel, rate-limited to once every 5 minutes — it's on entry rather than on a timer, because the data only changes when you play and a background poll would keep hitting someone else's API from a tab left open.

**Region is the platform code** (`sg2`, `na1`, `euw1`, …), not the routing region MetaTFT shows in its own URLs. A profile that lives at `/player/sea/Name-TAG` is indexed under `sg2`; asking for `sea` returns "Summoner Not found", which looks like a wrong Riot ID rather than a wrong region.

Two endpoints do the work, and they carry complementary halves of a record:

| Endpoint | Gives |
|---|---|
| `public/profile/lookup_by_riotid/{region}/{name}/{tag}` | Current rank, and the last 40 matches with **placements but no LP** |
| `public/profile/rating_changes/{region}/{name}/{tag}?queue=1100` | One point per ranked game — **LP but no placement** |
| `public/promotion_thresholds/latest` | Live Grandmaster/Challenger LP cutoffs per region |

`tftMergeSynced()` pairs them on time: a rating point lands about a minute after the game that produced it (measured median 1.3 min across a full match page), which recovers the one-record-per-game shape the rest of the tab is built on. Pairing is deliberately conservative — nearest rating point at or after the match, within 45 minutes, and a point already claimed by one match is never reassigned. A missing rating point therefore costs one placement rather than shifting every later placement onto the wrong game. Rating points that pair with nothing still import (they're older than the 40-match window), so the LP chart is complete even where the placement stats aren't.

Four things worth knowing:

- **Their `rating_numeric` is the same scale as `tftValue()`.** `GOLD I 4 LP` is 1504 in both; `MASTER I 0 LP` is 2800 in both; `CHALLENGER I 864 LP` is 3664, i.e. Challenger sharing Master's base — independent confirmation that Master/GM/Challenger are one LP pool. The code still parses `rating_text` rather than reading the number, because the number alone can't tell those three tiers apart.
- **Only the current set is imported.** LP resets between sets, so mixing them would draw a several-hundred-LP cliff that never happened as a real loss.
- **One account at a time.** Every imported row is stamped with the account it came from (`acct`), and syncing a *different* Riot ID or region clears the previous account's imported games before merging — there's one chart and no per-account switch, so two ladders drawn as one line would show a climb that never happened. Changing either field syncs straight away for that reason, rather than leaving the old account's games on screen until the next open. Three things keep that safe: hand-typed rows are never touched, placements are carried across the purge by rating-point timestamp so a row that comes straight back out of the same fetch doesn't lose one it's now too old to re-pair, and a `rating_changes` call that *failed* is passed as `null` rather than an empty list, so a network blip can never be read as "this account has no games" and empty the log.
- **It's an undocumented API.** It can change shape or start requiring a key with no notice, which is why manual entry stays: a failed sync writes a message and changes nothing else. Don't remove the add form.

`sw.js` lists `api.metatft.com` in `LIVE_DATA_HOSTS` so rank data always hits the network — without that, its cache-first branch would serve a stale rank forever. `raw.communitydragon.org` (the rank crests) is deliberately *not* listed: that art is immutable and worth having offline.

### VOD review mistake tally

The Valorant tab's fourth pane (`#valSubtabVod`, `js/valorant.js`) is a counter for the mistakes you catch while reviewing your own demos: one row per mistake, a `+1` you tap as you spot it, and a range toggle across **Today / Last 7 days / All time**. Rows are ordered by the count currently being shown, so the top row always answers "what am I doing most" for the range you asked about. Each row is a single line in one hairline-divided list — a review turns up a dozen mistakes and the pane is useless if three of them fill the screen — so the all-time/last-logged detail is the row title and the share-of-the-busiest comparison is a 2px rule on the row's bottom edge. A search box appears once there are more than six mistakes and filters the rows only: the summary and the meter scale still come from the whole list, so filtering can never make a rare mistake look like the worst one, and the query lives in a module variable rather than in state. A summary line above the list states the total for the range and names the most common mistake; the add form and its chip row sit *below* the list inside a closed disclosure, because logging is the frequent act and adding is not.

- **A name too long for the row slides.** Hovering or focusing a clipped name animates it across to show the rest and back, holding at each end for a beat. The overflow distance and a proportional duration are measured per row by `markValVodClipped()` after every render (CSS can know neither) and written as `--vod-shift` / `--vod-dur`; rows that fit are untouched. It is off under `prefers-reduced-motion`, which costs nothing — the row's `title` already carries the full name. That is also why the name is a span rather than a live input: an input cannot slide its own text, and twelve boxed fields read as a form rather than a tally, so clicking one swaps in the edit field sitting hidden beside it. Committing the edit updates the span in place and never re-renders — a click on the same row's `+` is what usually ends an edit, and rebuilding the list on focusout would destroy that button between mousedown and click.
- **It is a counter, not a journal.** The question is which mistake repeats, and a per-clip notes field would turn a five-second tap into writing. Names are editable inline; a mistake is keyed by `id`, so renaming keeps its whole history.
- **How red a row is, is its share of the worst one.** The rows form a gradient from the mistake to fix down to the ones that barely happen: the count, the meter and a wash behind the row are all mixed toward `--danger` by that ratio, emitted per row as `--vod-heat` (and a 13%-strength `--vod-heat-soft` for the wash) because `color-mix()` wants a percentage directly. The wash fades out by 78% across the row, so the count and the buttons always sit on a plain surface; the count is `color-mix()`ed *into* `--text` rather than used raw, which keeps it over 4.5:1 in all four themes; and a row with nothing logged in the current range has zero heat, so an untouched list is plain.
- **Counts are per-day buckets** — `state.valorant.vod.mistakes[].days['YYYY-MM-DD']` — not a running total. That's the only reason the range toggle can exist without storing one record per press. `−` decrements *today's* bucket and deletes the key at zero. `VOD_DAY_CAP` (400) trims the oldest keys, because this rides the shared blob that is re-uploaded in full on every save from any tab.
- **The last-7-days window is calendar days**, via `localDateStr()` on each of the last seven dates, never `now − 7×24h` — a millisecond window cuts off part-way through the oldest day.
- **One field searches and adds.** Typing filters the rows and the suggestion rail together; the same text becomes a new mistake on Enter or on the `Add “…”` button that appears beside it, so there is no separate add form to find. Committing clears the query as well — leaving it filtered would hide every row but the one just added, which reads as the rest having gone. The suggestion chips are seeds, not a taxonomy: each adds an ordinary row that can be renamed or deleted, chips disappear as they are used, and they live on one horizontally-scrolling line so two dozen of them cost 32px instead of a wall. Adding a name that already exists bumps the existing row instead of stacking a near-duplicate beside it.

### TFT live lobby

The **Live Lobby** sub-tab of the TFT panel shows the **eight players in the game you are in right now** and, for each, **the highest rank that account has ever held**. TFT matches on current LP, so a Silver lobby routinely contains someone who was Challenger two sets ago; the in-game scoreboard only ever shows you names.

The TFT panel has two sub-tabs, `Rank | Live Lobby`. Unlike the Games strip above it (Valorant/TFT, which persists), this one **resets to Rank every time you enter** — they're two views of one game, not two games, and the reset is what stops merely opening the tab from starting the lobby poll. The poll runs **only** while the Live Lobby pane is the one on screen and the browser tab is visible, so it costs nothing the rest of the time.

Unlike the rank sync above, this one **needs the local helper running** — `node scripts/valorant-local-server.mjs`, the same process and the same pasted token the Valorant panels use (or let `local-helper-watch.mjs` start it for you — see "Tying the helper to the Riot client" below). Open Games → TFT → Live Lobby and the card fills itself in while you play. The `Auto` checkbox turns the poll off; ⟳ forces a fresh read past both caches.

It works in two halves, and only the first of them has to be local:

1. **The roster** comes from the League/TFT client's own loopback API (the "LCU"). A web page cannot call it at any hosting arrangement: it serves a self-signed certificate, and its port and password live in a `lockfile` that only a process on the same machine can read. `scripts/tft-live.mjs` reads `/lol-gameflow/v1/session`, which carries all eight players in `gameData.teamOne`. Every call it makes is a GET; nothing authenticates as anybody, and no Riot auth endpoint is involved — so **this is not the Valorant situation** and none of the fraud-detection reasoning in "Daily Valorant store check" applies to it.
2. **The ranks** come from MetaTFT, the same public index the sync above uses. That half needs no helper and could run in the browser; it runs in the helper so one poll costs the page one request instead of nine.

**The puuid bridge is the part that isn't obvious.** The client reports players by puuid in UUID form (`3d6b9381-c711-…`), while MetaTFT indexes profiles under Riot's *encrypted* puuid (`vjRP7aB2K7d0ei7…`). Same account, two different identifiers, and there is no way to convert one into the other. So the roster is turned into Riot IDs first, via the client's own `/lol-summoner/v2/summoners/puuid/{puuid}`, and MetaTFT is asked by Riot ID. `lookup_by_puuid` exists and answers 404 for every player in a lobby — don't "simplify" the chain into it.

Peak rank itself is a stored fact on MetaTFT's side, not something reconstructed from a match list: `rating_history` is keyed by set, and each set carries `peak_rating` alongside the final rating. That is what lets the card reach back through sets this app never saw. Three numbers come out of it, answering different questions — where they are now (their most recently played set), their peak *this* set, and their peak *ever*, which is what the list is sorted by.

Things worth knowing:

- **Nothing is stored.** `state.tft.lobby` holds preferences only; the roster lives in memory in `js/tft.js` and in the helper, and is thrown away — the same ruling as `state.valorant.live`, for the same reason. The panel polls every few seconds and `doSave()` re-uploads the whole shared row on every save from any tab.
- **Gated on game mode, not queue id.** Anything with `gameMode: 'TFT'` shows; whether it's the ranked ladder is reported separately. A queue-id allowlist would go blank for the first week of every new mode Riot ships.
- **The gap to peak is quoted in the unit that's true at that distance** — tiers across tiers, divisions within a tier, LP within a division. `tftValue()`'s scale is rank *power*, where a step is a division, so subtracting two of them and calling the answer LP describes a loss that cannot happen (Diamond II down to Silver II differs by 1640 on that scale).
- **Caching.** The helper memoizes the resolved roster per `gameId` — the eight players in a TFT game cannot change once it starts — and each account's ranks for 10 minutes. A *failed* rank lookup is never cached, so a blip doesn't leave a row blank for the rest of the game.
- **A profile can legitimately be blank.** Riot lets an account hide its profile, and MetaTFT may not have indexed a new one yet. Each of those says so on the row rather than showing an empty column, which would read as a failed fetch.
- `TFT_LCU_LOCKFILE` overrides the lockfile path for a non-default install drive. Both the League client and the standalone `TFTClient.exe` are checked.

The helper answers `client_closed` whenever the game isn't running, which is most of the time — the page treats that as an ordinary state, keeps the slow poll, and collapses the card to a single line rather than backing off and looking broken the moment you finally launch.

### Tying the helper to the Riot client

`scripts/local-helper-watch.mjs` runs the local helper for exactly as long as a Riot client is open, and stops it when there isn't one. Start it instead of the server itself:

```
node scripts/local-helper-watch.mjs
wscript scripts\local-helper-watch.vbs     # same thing, no console window
```

Put a shortcut to the `.vbs` in `shell:startup` and the helper simply exists whenever you're playing and never otherwise. It polls the process list every 10s for `RiotClientServices.exe`, `LeagueClient.exe`, `TFTClient.exe` or Valorant's own executables; **any** one of them counts. `RIOT_WATCH_PROCESSES` (comma-separated) replaces that list for an install these names don't cover.

Three details that matter:

- **Starting is immediate, stopping takes two consecutive misses (~20s).** The Riot Client genuinely disappears and comes back while handing off to a game, and acting on a single miss would kill the helper at the moment the TFT lobby card is about to need it. There is no equivalent cost to starting early.
- **It never touches a server it didn't start.** Before spawning it checks whether something already answers on the port, and `stopHelper()` only ever kills its own child — so running the watcher can't disturb a helper you started by hand, and killing the watcher takes its own helper down with it rather than orphaning it.
- **A failed process list reads as "don't know", not as "nothing is running."** Otherwise a transient hiccup reading the process table would stop the helper mid-game.

**The trade-off, because it's a real one:** "Check Store Now", "+ Add Account" and "Check Owned Skins" go through this same helper and work fine with no game running — they only need the saved session cookie. Under the watcher those buttons are dead while Riot is closed, and the tab will say the helper isn't running. If you'd rather have them always available, run `scripts/valorant-local-server.vbs` from startup instead. Either way the **scheduled daily store check is unaffected** — `valorant-check-store.mjs` is a separate process that never talks to this server.

### Turning the helper on and off from the app

**Settings → Local helper** has a **▶ Start helper** / **■ Stop helper** pair, and the same control appears wherever the helper being down is actually noticed: in the **ⓘ Helper** dialog on the Shop Tracker, and in the **TFT → Live Lobby** card's own header — sending you to Settings to switch on the thing the panel in front of you is complaining about was the whole problem. The two game-tab copies are marked `data-helper-mode="start-only"`: they offer a way *in* and render nothing once the helper is up, because a Stop button has no business sitting in a game panel's header. Slots are plain markup (`[data-helper-slot]`) filled by `renderValHelperPower()`, and the buttons carry `data-helper-power` rather than ids — three copies of one id is invalid markup and only the first would ever be wired up — so the clicks are delegated from `document` once instead of being re-attached on every repaint. The two directions work by completely different mechanisms, and that asymmetry is forced rather than chosen:

- **Stop** is an ordinary request. The helper is listening, so the button calls `POST /shutdown`, which is token-gated like every other write route — a page that merely knows the port is open can't switch it off. The server replies *before* scheduling its exit (otherwise the socket dies mid-reply and the page reports a failure for something that worked), then `server.close()` drains in-flight connections, with an unref'd 1.5s timer as the backstop for a keep-alive socket the browser is holding.
- **Start** cannot be a request at all — by then nothing is listening. It hands off to a registered `p25helper://` URL protocol, which Windows resolves to `scripts/valorant-local-server.vbs`. Register it once:

```
node scripts/helper-protocol.mjs register      # status | unregister
```

That writes one key under `HKCU\Software\Classes\p25helper` — per-user, no admin, removable with `unregister`. Your browser asks permission the first time; tick "always allow" and it stops asking.

**The security rule that makes it safe, and must not be relaxed: the registered command contains no `%1`.** Windows only appends the clicked URL as an argument when the command asks for it, so with no `%1` nothing from the URL — from any page on the internet, not just this app — reaches the process. The handler is a doorbell, not a parameterised call; adding `%1` would turn every website into something that can pass arguments to a program on your machine. What a hostile page can actually achieve is starting a server that refuses every meaningful request without a token it has no way to learn, after the browser has asked you first. That is the whole exposure, and it's why registration is a separate opt-in command rather than something the page can arrange for itself.

Neither button can confirm its own result — the protocol hand-off returns nothing to the page, and a shutdown closes the socket that would have reported it — so both fall through to the same test: poll `/status` until it flips. That poll is **bounded by wall-clock, not by a probe count**: a fetch to a port with nothing on it costs Chrome ~2s to give up on, and a fixed number of tries stretched the button's "Starting…" state to ~24s. Overshooting the 15s window is harmless, because a helper that appears later is still picked up by the background status poll, which retracts the "nothing started" note rather than leaving it contradicting the green dot above it. If the hand-off produced nothing, that note is the only symptom of the handler not being registered — and it can't tell that apart from you dismissing the browser prompt, so it says so without claiming to know which.

### Calorie budget check

The BMI/calorie calculator at the bottom of the Fitness tab is Mifflin-St Jeor plus a five-step activity dropdown, split into two fieldsets (“About you” and “Your plan”) because how much you weigh and how fast you want to move are two different questions, and printing one answer — the daily calorie target, in the one accent-coloured card — above four quieter supporting figures rather than five identical boxes that all claimed to be the point. For any individual that is routinely a few hundred kcal out — which is the entire size of a deficit — so the number it prints is a starting guess, not an answer. The **Calorie Budget Check** panel settles the question from the outside instead: eat a known amount, watch what the scale does over the same stretch, and the energy balance falls out of the two.

**Three panes.** The tab is split behind one sub-nav (`showFitnessSubTab()`): **Weight** — the hero card, the trend chart, and the calendar that feeds both — **Photos**, and **Calories** (the budget check and the BMI/TDEE calculator). They are three views of one concern rather than three different things, so the choice is **not persisted and resets to Weight on entry**: the Time tab’s rule, not the Games tab’s. You open this tab to read where you are and to log today, both of which are the first card of the Weight pane, and landing on whichever pane you left last would bury them.

**The hero** (`renderFitnessHero()`, `.fit-hero`) is the first card of that pane: today’s reading at ~3× the size of anything else on the screen, the BMI band and the change since Settings → Trend Comparison as two chips beside it, a rail from where this started to the target with today marked on it, and the log row folded in under a hairline. The tab used to open on the trend chart, which meant the largest object on the screen was a plot of a figure that existed nowhere on that screen — the current weight was a form field on a *different* sub-tab. Three rules hold it up. **Every figure comes from the helper that already owns it** — `getFitnessTier()` for the band, `fitnessTrendDelta()` for the arrow (extracted from `updateFitnessLevelUI()`, which now calls it too, so the profile card’s ▲▼ and the hero’s chip can never disagree about which weigh-in “since” names). The **rail is anchored to the first weigh-in**, not to a starting weight typed somewhere: the log is the only record of where this began, and an editable anchor would move the start line every time the calculator was touched — and it is skipped entirely, for a sentence naming what to set instead, when either end is missing or the two coincide, because a rail with no length reads as a broken control. And the band’s colour **rides on a dot rather than on the word**: `getFitnessTier()` returns the raw `--gold`/`--success`/`--danger` hues, which sit near 3:1 on a pale card — fine for a mark, short of AA for a 12.5px label — so the label stays `--text` and carries the meaning in words, which is also what keeps it legible in greyscale.

Two things the split forced. A chart drawn while its pane is `display:none` measures a zero-width wrapper and falls back to the 780-unit default, rendering desktop-scaled type on a phone — so `showFitnessSubTab()` redraws whichever pane just became visible, rather than waiting for a resize that may never come. And the calorie chart **needed its own `ResizeObserver`**: it used to ride the weight chart’s, which was sound while the two shared a column and always resized together, and is not once the weight pane can be hidden while the calorie pane is the one being resized. The log banner sits **above** the strip, since it is about the day rather than any one pane, and its "Log now" switches to Weight before focusing a field — a `display:none` input cannot take focus.

**Logging.** One row records both halves and it writes to **today only** — it used to carry a date picker, which cost most of the line on a phone to serve the rare case, and backfilling now belongs to the calendar below where you can see which days are missing. Because that row writes to today, and today may be the very day open in the calendar editor beneath it, `addWeightLogEntry()` resets `weightCalEditorFor` before re-rendering: the editor only rebuilds when the day or the unit changes, so its fields would otherwise go on showing what they held before the entry. The two readings still land on two different dates: you weigh in the morning *after* the day you ate, so the kcal box attributes to the day before the weigh-in by default (`state.fitness.kcalOffset`, switchable to same-day for anyone who logs food at night). The hint under the row spells out both dates rather than leaving "yesterday" implicit. Either field alone is a complete entry — weight-only logging behaves exactly as it did before calories existed — and below it the two logs are drawn as a **month calendar** rather than a list: the question this section actually raises is "which days am I missing" — the Budget Check’s two gates are literally counts of logged days — and a gap is invisible between two list rows and obvious in a grid. Each cell carries the weigh-in (with a ▲/▼ against the previous one), the day’s calories in gold when they fall on the wrong side of the budget, and a dash on a past day that has a weigh-in but no food logged. Clicking any day opens one editor panel beneath the grid — a panel rather than a popover, since two number fields and two buttons don’t fit beside a 50px cell on a phone, and a popover would have to chase a cell that moves when the month does. Both of its fields write to **that exact day**: the add row’s day-before offset is a property of the morning routine, not of a date you picked deliberately. Emptying one field deletes just that half of the day, "Clear day" deletes both, and any past date can be filled in this way — including one that has never been logged at all, which had no row to click when this was a list. The month on show and the open day are view state only, never persisted, the same rule the chart zooms follow.

**Goal comparison.** A progress photo of yours sits beside the physique you are working toward (`state.fitness.dreamPhoto`, one photo rather than a list — a carousel of aspirations is a different feature, and uploading again replaces it). It is also the **only** place progress photos live: a carousel of photo cards used to sit above it showing the same records a second time, and it is gone — this pane took over its two jobs, since the arrows already stepped through every photo and tapping either photo maximises it in a body-level overlay (`#photoViewOverlay`, the app’s 1000 modal tier, outside `#view-fitness` for the reason `#valItemPreviewOverlay` is outside `#view-games`) and the Drive link, Remove and — for the goal photo — Replace live in there. The first goal photo is picked by clicking the empty goal card itself, so the control always sits with the thing it acts on rather than in a row of two buttons where the once-a-month one was as loud as the daily one. They sat on the card at first, a few pixels from the ‹ › arrows — one mis-tap from deleting the photo you were trying to step past. Behind an open-the-photo step, deleting is deliberate, and the picture gets the room it wanted anyway. Inside the overlay Remove is pinned far left and Close far right, so the destructive control is never where a thumb lands reaching for the safe one. Which means the unavailable note has to stay on screen in the mode where Edge Functions are missing, rather than the block hiding itself: with nothing else showing photos, a silent disappearance reads as lost data. It reuses the progress photos’ own Drive path: `driveUploadPhoto()` is the shared round trip and the two callers differ only in what they name the file and where they put the record, so here too only the Drive id/link/thumbnail reach `state` and never the bytes. The block hides itself entirely where Drive uploads are unavailable rather than leaving a heading over empty space.

The left side opens on **today’s photo, or the most recent one before it**, and the arrows step through the rest — so the same panel doubles as a before/after against any photo you already have. Which one is showing is view state only, never persisted. Three details matter. The photos are **sorted by `uploadedAt`, not by array position**: the two normally agree because progress photos are only ever appended, but the arrows are labelled "earlier" and "later" and the counter reads "2 / 3", and both are lies the moment a restored backup returns them in another order. Each side is captioned with the weigh-in that was true when the photo was taken (`weightAtOrBefore()` — that day’s, else the most recent before it), so an old photo carries the weight it actually shows rather than today’s, and the strip underneath states the one figure the pairing exists for: what has changed since. And the images are **`object-fit:contain`, not `cover`** — cropping a physique to fill a box is the wrong thing to do to the subject of the comparison, and two photos cropped differently cannot be compared at all. Two columns at every width, phones included: side by side *is* the feature, and stacking them would leave you scrolling between the two things you are trying to hold in one glance.

**Weights carry two decimals.** `roundWeight()` (hundredths) is used for anything that is a *reading* — a weigh-in, a target, or the difference between two of them — while `roundDisp()` stays at tenths for derived summaries and axis labels, where a gridline at 72.42 or a headline reading "1.24 kg to go on the 5-day avg" is false precision about a smoothed figure. The split is not cosmetic: the input fields are pre-filled from state and written back on save, so rounding a stored 73.65 down to 73.7 for display meant the next save persisted 73.7 and the real reading was gone. The three weight inputs step by 0.01 to match.

**Measurement conditions.** A weigh-in is only comparable to the one before it if it was taken the same way, so each day carries four tick boxes, ordered the way the morning actually runs — no eating after 7 PM (the night before), ate only after 8 AM, no water before weighing, no heavy clothes (`WEIGH_CHECKS`). Tick all four and the day is **tinted blue** on the calendar with its weight value underlined in the same blue: the reading was taken under the same protocol as every other tinted day, so a jump can be read as a real change rather than as a measurement artefact. A tint rather than a badge because the question is which *stretches* of the month are comparable, and a glyph per cell answers one day at a time; the underline is a second, non-colour channel so the meaning survives greyscale and colour blindness. Blue deliberately — not the green/red the weight deltas own, not the violet the selection owns, so it cannot be misread as either (`--ok-blue`, 5.3:1 at worst on the light surfaces and 5.5:1 on the dark ones). The tint rule sits ahead of `.sel` and `.today` in the sheet so those interactive states still win on a tinted day, and a legend appears under the grid naming the count — only in a month that has one, so the calendar stays bare until the tint needs explaining.

Four rules. Only the **ticked keys** are stored (`state.fitness.measureLog`), which keeps a day with nothing ticked out of the array entirely and means adding a condition later leaves old days honestly short of it rather than retroactively declaring them controlled — which is exactly what happened when "no heavy clothes" was added as a fourth: days ticked under the old three read as "3 of 4" and lose their tint until the new box is ticked, because nobody actually verified the clothing on those mornings. The ✓ appears only on a day that **has a weigh-in** — it qualifies a reading, and on a day with nothing weighed there is no reading to qualify (the editor says so instead: "all conditions met — log a weight to mark the day"). Ticking a box re-renders the editor, so the handler calls `applyWeightDayFields()` first, the same rule adding an activity follows. And it is a **label, not a filter**: the trend regression, the measured maintenance and the suggested budget all still read every weigh-in, controlled or not. Restricting them to controlled days only would be a defensible next step, but it is a change to what the figures mean and would silently drop most of the data on a month when the boxes went unticked.

**Activities.** The day editor also records what you *did* — any number of entries per day, so `state.fitness.activityLog` is a flat dated array like the other two rather than a field on either. Pick a type, give it minutes or a figure, and it's logged; the type carries a MET (the standard multiple of resting metabolic rate, `kcal/min = MET × 3.5 × kg / 200`, i.e. `MET × kg × hours`) so a duration alone is enough. That estimate is offered as the kcal box's **placeholder** and used only when the box is left empty — never written into the field, so a number off a watch always wins and nothing is overwritten under the caret. The weight it estimates against is that day's own weigh-in when there is one, so backfilling last month uses last month's weight. In the grid an active day is marked with the emoji of its **heaviest** activity, sharing the day number’s row (a flex row rather than a floating corner glyph, so a big emoji cannot land on top of a five-character weight in a 44px column) — a 10-minute stretch after an hour’s run should not be what the day shows, and ties keep the earlier entry so the mark is stable. An emoji rather than a third line of figures because seven columns on a 360px screen have no room for one, and it says what you did as well as that you did something. The emoji is looked up from the stored name on read rather than saved onto the record (the never-goes-stale trick again, so a record written before this existed still gets a mark and an unrecognised name falls back to ⚡), and it is aria-hidden because the cell’s `aria-label` already names every activity in words.

**Logged burn is displayed and never added to anything**, which is the one rule to keep here. The Budget Check's maintenance figure is *measured* — intake against what the scale did — so it already contains every calorie burned that week, whether or not the walk was logged; adding logged exercise on top would count it twice, and the formula's TDEE double-counts it a third time through its activity multiplier. So `calorieReview()` carries `burnTotal` / `avgBurn` for display and uses neither in any calculation, the panel's activity card says outright that it is already inside the maintenance figure, and the day note reports burn (and net intake, for anyone eating exercise calories back) as readings of the day rather than inputs to it. The honest value of this data is context: why one week's deficit ran deeper than the budget said it would.

One structural note: adding or removing an activity re-renders the editor, which would otherwise discard a weight you had half-typed above it — so those handlers call `applyWeightDayFields()` first. Same rule as the scratch pad's `commitScratchSurface()`: anything that rebuilds the surface banks it first.

**The maths** (`calorieReview()` in `js/fitness.js`, all of it measured — the formula's TDEE appears only as the thing being checked, never as an input):

| Figure | How |
|---|---|
| Avg intake | Mean over the days *actually logged*, never over the window — a skipped day is unknown, and counting it as zero would invent a deficit that never happened. |
| Weight trend | Least squares across every weigh-in in the window, not last-minus-first: a single watery morning at either end moves an endpoint difference by most of a kilo, which over a 7-day window is a ~1,100 kcal/day error — larger than the thing being measured. |
| Real maintenance | `avgIntake − slopeKgPerDay × 7700`. Ate, minus banked, is burned. |
| Suggested budget | That maintenance, shifted by the planned pace (`fitnessPaceWeekly()`). With no target weight the plan is to hold, so it lands on maintenance. |

Two gates keep it from answering with noise: the estimate reads the average as if it held all window long, so it needs **at least half the window's days logged** (minimum 4), and it needs **3+ weigh-ins spanning 5+ days** before it will read a slope. Short of either, the panel names the one that's missing and still shows whatever it can — an empty card would just look broken.

The BMR → TDEE → daily-target ladder lives in `fitnessBmr()` / `fitnessTdee()` / `fitnessPaceWeekly()` / `fitnessCalorieTarget()`, shared with `calcFitness()`, so this panel and the calculator card can never print two different answers to "what is my daily target".

**The verdict** is one chip plus the evidence it came from, and the words repeat whatever the colour says so it survives greyscale. Within 60 kcal of the suggestion reads *green* ("Budget is working") — that is inside the noise of food logging itself, and shaving 30 kcal off would be false precision. An adjustment reads *violet*, not red: being 300 kcal out is a dial to turn, not a failure. Red is kept for the one case that genuinely is one — the weight moving **away** from the target. On the chart, which side of the budget line counts as the miss follows the goal: over-budget days on a cut, under-budget days on a bulk.

Bars rather than a line, because intake is a set of separate days and an unlogged day has to read as a gap — a line would quietly interpolate straight across it. The range buttons aren't persisted, matching the weight chart's zoom, and open on **7D** — the most current answer the panel can give. It is also the noisiest: a week gives the regression fewer weigh-ins, so the maintenance figure moves around more than the 14D one does, and the two gates bite sooner on a week with a gap in it. 14D is one tap away and is the steadier read. The weight chart opens on **1M** for the matching reason — that is the window a cut or a bulk is actually judged over. The chart is sized the same way as the weight chart (type and gutters in rendered pixels, converted into viewBox units by `k`) and has no `ResizeObserver` of its own: it rides the weight chart's, since the two sit in the same column at the same width.

### Sleep tracker

The Fitness tab's fourth pane (`renderSleep()` and the `SLEEP` section of `js/fitness.js`, `#fittab-sleep`) plus the **quick-actions bar** that feeds it (`js/quickactions.js`).

**A night is two clock times, not a number of hours.** Records are `{date, bed:'HH:MM', wake:'HH:MM', mins, quality?}` in `state.fitness.sleepLog` — the same flat dated-array shape as `weightLog` and `calorieLog`, riding the same shared blob. Typing "7.5" would be a calculation you had already had to do, and the two times are also what the bedtime-consistency figure is measured from. `mins` is derived at write time rather than at read time, so the wrap across midnight is resolved once instead of on every repaint.

**A night is filed under the date you WOKE UP on.** A sleep crossing midnight otherwise belongs to two dates and neither holds the whole of it. That one rule is why the manual log row says "last night", and why the toggle stamps the wake date rather than the bed date.

**The toggle is the intended way in; the fields are for corrections.** The bottom-right quick-actions bar carries one button: 🌙 *Sleep* stamps `state.fitness.sleepPending` with the current time, and ☀️ *Awake* reads the elapsed time off the clock, writes the night through `upsertSleepLog()` and clears the stamp. The Sleep pane's bed/wake fields are a form you fill in afterwards, from memory, asking for exactly the two times you are least able to type — you press "going to sleep" with the lights already off. They stay for fixing a time and for backfilling a night the toggle missed.

Five rules hold the toggle up. The pending night is **one timestamp in `state`, never a running timer** — the app is shut for the whole of what is being measured, so anything in memory would be gone by morning; elapsed is always `now − stamp`, which is also why a reload, a sleeping phone and a second device all agree about it. It writes through **fitness.js's own `upsertSleepLog()`**, never straight into `state.fitness.sleepLog`, so the record shape and the wake-date rule keep one owner. Both ends **confirm before writing an implausible night** rather than silently recording one — under 20 minutes reads as a mis-tap, over 16 hours as a toggle you forgot to end, and both would quietly poison every average in the pane; cancelling *discards* the timer, because the alternative is a pill stuck on a number you have already declined with no other way to clear it. The pill **counts up once a minute and only while a night is actually running** (and not while the tab is hidden, where the interval is throttled anyway — it redraws on the way back instead). And the bar is **hidden outright for a read-only guest**: guest edits normally look applied until reload, the standing cost documented in CLAUDE.md, but this control's entire state is one write, and a toggle that flips, counts all night and then loses the night is worse than one that was never offered.

**The battery** (`sleepBattery()` / `renderSleepBattery()`, in the Sleep hero's rail slot) is the pane's live reading: how much of last night you are still running on, right now. A full night charges it to 100% and it empties across the hours you would normally be awake, so a short night both starts lower *and* runs out earlier — a static "you slept 6h" says what happened, this says what it is costing you at 4pm. The maths is one line and claims to be nothing more: charge is `min(1, slept / goal)`, the waking day is `24h − goal` (16h on an 8h goal), and the level is the charge minus how far into that day you are. On an 8h goal a full night reads 100% on waking, 50% eight hours later and flat at the sixteenth hour; five hours reads 63% on waking and is flat by mid-afternoon. Four rules. It charges from the **last finished night**, and while the quick-actions toggle is running it is **charging** instead — a battery that ignored the night in progress would sit at 0% at the exact moment you are doing the thing that fills it. The waking day is `24h − goal` rather than a typed figure, the only definition under which 100% means "a full night ago" and 0% means "you are due the next one", and it moves correctly when the goal does. A night older than 30 hours is drawn as a **prompt, not a flat battery**: 0% is a claim about right now, and if the newest record is Tuesday's the honest answer is that there is no reading. And it redraws on a **minute timer that exists only while this pane is the visible one and the tab is in front** — the same gate `syncValLivePolling()` and `syncTftLobbyPolling()` use, for the same reason. Visually it is a battery rather than another rail — a nub on the right, quarter ticks drawn *over* the fill so they stay readable as it passes them — because the Weight hero carries a progress rail in the same slot and the two panes must not look like they are saying the same thing about different numbers.

**The review panel** (`sleepReview()`) is the calorie panel's contract repeated: one function works out everything the verdict, the stat cards and the chart state, so the three can never disagree about the same window. Averages are over the nights **actually logged**, never over the window — a missing night is unknown, and counting it as zero would invent an all-nighter. **Sleep debt only ever sums the shortfalls**: a long lie-in does not give back the sleep an earlier night lost, so letting surplus cancel shortfall would read a wrecked week with one 11-hour Sunday as a week with no debt at all. Bedtimes are placed on a **midnight-centred axis** (23:30 is −30, 00:30 is +30) before the spread is taken, or someone who goes to bed either side of midnight reads as varying by 23 hours rather than by one. Consistency is reported as a clause of the duration verdict and never as its own — a steady five hours is not a good week. The chart is the intake chart's geometry for the intake chart's reasons: bars because nights are separate quantities and an unlogged night has to read as a gap, a zero baseline because a truncated one draws six hours as half of eight, a dashed goal line as a neutral annotation over them, and its own `ResizeObserver` since this pane can be the one being resized while the other three are `display:none`.

**The bar replaced the mobile tab switcher** that used to hold that corner — a hold-and-slide FAB that was a second way to do what the navbar already does, occupying the one screen position reachable with a thumb from every tab. `z-index` stays 900 and the ladder still reads the same way: above the mobile sticky sidebar (40), below the scratch mode (950) and the 1000 modal tier, and below `.cal-bubble-stack` (920), which is right — the stack is top-right and transient, this is bottom-right and permanent.

**Circadian rhythm** (`circadianStats()` / `renderCircadianRhythm()` / `renderCircadianChart()`, below the review) is an actogram: one row per calendar day, a bar wherever you were actually asleep, positioned by clock time rather than stacked into a total. It exists because the review above only answers "how much" — a person who averages 8h a night by sleeping 11pm-7am one day and 3am-11am the next has a perfectly good average and no rhythm at all, and a duration bar chart cannot show that; only plotting bed and wake times *on the clock* can. `circadianStats()` reads each day's longest session only (`sleepDayAgg()`'s `main`), the same choice `sleepReview()` makes for bedtime consistency — a nap's bed/wake time is real but is not "when you sleep", and mixing it in would blur a genuinely late chronotype with someone who merely naps at odd hours. The verdict is a regularity chip (Regular / Somewhat irregular / Irregular, from the average of the bedtime and wake-time standard deviations) plus the usual bedtime and wake time in words, so the chart and the sentence can never disagree.

The x-axis mixes two zero points on purpose: the bed edge uses `bedAxis()`'s midnight-centred convention (18:00 onward reads negative, "the evening before"), the wake edge uses plain clock hours — because a bed time clusters in the evening and a wake time clusters in the morning, and forcing both onto one zero point is what would make the row wrap. The domain defaults to 16:00-the-evening-before through 16:00-same-day and only widens for data that actually needs it, so a normal week's rows aren't stretched thin to fit one outlier nap. Rows compress as the window widens (14D reads as thick week-and-a-half bars, 60D as thin but legible two months) rather than growing the chart without bound, and day labels thin out past 20 rows for the same reason. A session under three hours draws in gold rather than violet — a nap, not the night — and two dashed lines (violet for the usual bedtime, gold for the usual wake) let you see at a glance which nights actually drifted from the pattern rather than only knowing the aggregate spread. Every session down to naps is fed to it, unaggregated, because "when did each thing happen" is exactly what this chart is for and `sleepDayAgg()`'s day-total would collapse two sessions on one date into a single misleading bar. Its own `ResizeObserver`, the calorie/sleep chart rule: this section can be the one being resized while its siblings are `display:none`.

### Google Calendar

The Time tab's third pane (`js/calendar.js`) is a **read-only** agenda of your real Google Calendar,
grouped by day — Today / Tomorrow / weekday — with all-day items floated to the top of their day. A
chip row picks which calendars to merge; an empty selection means "just the account's own calendar",
which is what it shows before you've ever touched the picker. Everything comes from the
`google-calendar` Edge Function above, so no Google credential, consent popup or access token ever
exists in the browser. The scope is `calendar.readonly`: this app has no way to change a real event,
by design and not merely by omission.

**The fetched events are never persisted anywhere** — they live in a module-level `calEvents` and
nothing else. This is the same ruling as the Live Match panel: `doSave()`'s rest-destructure carries
any top-level `state` key into the shared blob, and that blob is re-serialized and re-uploaded *in
full* on every save from every tab, so a fortnight of events would be re-sent every time you ticked
an unrelated habit — for data that's stale within the hour and one button away. `state.calendar`
therefore holds preferences only (`calendarIds`, `lookaheadDays`, `bubbleDays`, `bubbleCount`,
`bubbleEnabled`, `bubbleSound`). The cost, stated rather than papered over: **there is no offline agenda.** Open with no
network and the pane shows its error line, and no bubble appears.

**`singleEvents=true` is load-bearing** on the server's events call. Without it a weekly standup
comes back *once*, as a master event carrying an `RRULE`, and this app would have to implement
recurrence expansion itself; with it Google returns the concrete instances that fall in the window.
`orderBy=startTime` is only legal alongside it, which is the other half of the reason. The other
Google quirk is handled server-side too: an all-day event carries `start.date` (`"2026-08-25"`, no
zone) where a timed one carries `start.dateTime`, and parsing that bare date reads it as **UTC**
midnight — which lands on the wrong local day either side of Greenwich. Both ends append `T00:00:00`
to make it local midnight instead, which is why the day grouping agrees with what Google shows you.

**The "coming up" bubble** fires once per page load, from `maybeShowCalendarBubble()` in
`renderAll()` — the same "no-op unless conditions are met" slot `maybeSyncPinterestCategories()`
occupies, and `renderAll()` runs at the end of `load()`, which is exactly "when I first open the
app". Its fetch is async on purpose, so it never delays first paint or `hideLoadScreen()`; the bubble
simply appears when the function returns. It shows the **next `bubbleCount` events on the calendar,
whatever they are** — as long as they land within `bubbleDays` (default 7) — as a stack of cards.
`#calBubbleStack` is the fixed, always-present `aria-live` container (a live region has to exist
*before* the content it announces is put into it) and owns the positioning; the cards inside it are
ordinary flow items, so a second or third just extends the column downward. It carries
`pointer-events:none` with `auto` on the cards, or it would swallow clicks aimed at the app in the
gaps between them and whenever it is empty. Cards are rebuilt on every show, so the click and
keydown handlers are **delegated from the stack** rather than attached per card. The ding fires once
for the batch, not once per card. It auto-hides after 12s, ✕ clears one card, and a
click anywhere outside the stack clears all of them — all three play the card back out the way it
came in, faster than it arrived, since an exit that lingers reads as sluggish where an entrance that
lingers reads as deliberate — getting on with something else takes a
notification down, rather than leaving you to dismiss it card by card first. Removal is driven by a **timer**, not an `animationend` listener: the animation is switched off
under `prefers-reduced-motion`, that event would then never fire, and the card would sit on screen
forever — the removal must not depend on the decoration happening. For the same reason the
reduced-motion path detaches immediately rather than waiting out a delay that animates nothing.
`hideCalBubbles()` animates; `clearCalBubbles()` is the synchronous twin used by
`showCalBubbles()`'s reset, which can't animate because the next batch is appended on the very next
line and cards on their way out would still be in the stack. That outside-click
listener is registered only while the stack is up and removed with it, and it runs in the **capture**
phase on purpose: in the bubble phase it would fire after the stack's own handler, which removes the
card on ✕, so the button would already be detached, `closest('#calBubbleStack')` would find nothing,
and dismissing one card would read as a click outside and take the whole stack with it.
All of it lasts for **this app open only**, recording nothing anywhere.

That last part was a deliberate retreat. Dismissals used to persist as `{id, startMs}` in state
until the event started, which was right while this only looked an hour ahead — waving off "Dentist
in 40 minutes" shouldn't have it return on every reload for the rest of the hour. Over a seven-day
horizon the same rule silenced an event for a *week*, and since ✕ is the obvious way to clear a card
off the screen, tidying up quietly burned the next few days of reminders with no way back short of
the console. Nothing replaces it because nothing needs to: the stack is built once per page load and
auto-hides, so removing the card already *is* "gone for this session" — a session-scoped list would
have been state no second reader ever consults. It also retires a bug it carried, where the prune
dropped any entry whose `startMs` was past, so dismissing an all-day event happening *today* (whose
`startMs` is midnight) never stuck in the first place.

All-day events count. They were excluded while this only looked an hour ahead — "starts at local
midnight" is not something to warn about 40 minutes in advance — but over a week's horizon a holiday
or a birthday is exactly what "what's next" means. Today's all-day event is matched on its *day*
rather than on `startMs`, which sits at midnight and would otherwise test as already past.

**The "now until" card** leads the stack whenever an event is already under way (`calNowEvent()`).
Without it the bubble goes quiet in the one window where it has the most to say: open the app twenty
minutes into a two-hour meeting and the next thing on the calendar is whatever *follows* it, so the
card reads "in 1h 40m" and says nothing about the block you're actually sitting in — or, on an empty
afternoon, nothing appears at all. It reads **"now until 3:00 PM · 25m left"**, naming the day only
when the event runs past midnight, and it's a `.cal-bubble.is-now`: same colour and same deep link
as any other Calendar card, with a 2px border, a 9% wash of the calendar's accent, a ⏱ chip and
rings that keep pulsing rather than stopping after two, because it's the only card describing
something happening right now. (That last one is spelled out again under `prefers-reduced-motion`,
since `.cal-bubble.is-now::after` outranks `.cal-bubble::after` and a media query adds no
specificity of its own.)

Four rules hold it up. It is **extra, not one of the counted slots** — `bubbleCount` means "how many
things coming up", and quietly answering that with the meeting you are already in would displace the
card it was asked for, so `nextCalBubbleEvents()` builds the upcoming list to `bubbleCount` as
before and prepends this one. **Timed events only**: an all-day event is "in progress" from local
midnight to local midnight, so a "now until" for one would read "now until Tomorrow 12:00 AM", and
today's all-day event is already carried by the ordinary card, whose `calRelative()` renders its
midnight start as plain "now"; countdowns fall out for the same reason by construction, since
`countdownBubbleEvents()` marks them `allDay`. **At most one, the one ending soonest** — overlapping
meetings are real and nothing here can tell which of them you're in, so the choice is between
spending the whole stack on that ambiguity and answering the question the card exists to answer,
which is when you're free. And it's a **copy** of the record, stamped `source:'now'`, never the
event itself: `calEvents` is what the agenda pane renders from, and marking it in place would follow
the event into those rows and into the next walk. The end time is parsed here rather than
server-side — the Edge Function passes `endIso` straight through without deriving a millisecond twin
for it — through `calEventEndMs()`, which appends the same `T00:00:00` to an all-day date and falls
back to the start for anything unparseable, so a bad end reads as an event that has already finished
rather than leaking `NaN` into every comparison it touches. No dedupe is needed against the upcoming
list: `startMs >= now` is exactly the test that drops the events this card is built from.

The horizon is measured in **calendar days** via countdowns.js's `daysLeft()`, not as `now + N×24h`,
because a millisecond horizon cuts off partway through the seventh day: a 10am meeting a week out
was excluded at 08:24 and included at 11:00, while the bubble called it "in 7 days" either way. It's
also clamped to `lookaheadDays`, since the bubble can only ever see events the agenda actually
fetched. `calRelative()` speaks the same unit — a duration inside today ("in 2h 10m"), a day count
past it ("tomorrow", "in 5 days"), with the one exception that something under 12 hours away but
after midnight still reads as a duration. The bubble spells the date out only when the phrase
doesn't already imply it, so "tomorrow · 9:00 AM" but "in 5 days · Mon, Aug 31 9:00 AM".

`bubbleEnabled` is the one preference here with a UI: **Settings → Tracking → Calendar
reminder**, a `.unit-toggle` wired in `renderSettings()` like the others. Switching it off also hides
a bubble that is on screen at that moment, and stops the app reading your calendar on load at
all — the early return in `maybeShowCalendarBubble()` happens before the fetch, so the Edge
Function isn't called. The pane is unaffected either way, since it fetches on its own.
`bubbleCount` (1–5), `bubbleDays` (1–60) and `bubbleCountdowns` sit under it as **How many to
show** / **How far ahead to look** / **Include countdowns**, all hidden together while the reminder
is off. `bubbleSound` and `lookaheadDays` stay console-only knobs.

**Countdowns can ride in the same stack** (`bubbleCountdowns`, on by default, Settings → Tracking).
A countdown is already shaped like an all-day event — a label and a date — so `countdownBubbleEvents()`
maps one onto the same record the rest of the file consumes rather than giving it a parallel path
through the card builder, the sorting and the wording; `calBubbleCandidates()` merges both sources
and re-sorts, so a birthday and a standup interleave by date rather than by origin. The date string
gets the same `T00:00:00` treatment as an all-day `start.date`, for the same UTC reason. A countdown
card shows ⏳ rather than 📅, takes the app's own `var(--violet)` instead of a Google colour (which
needs no contrast correction, being a themed token the app already uses for text), carries no time
at all — `calEventTime()` would render the literal word "all-day", which is true of the record and
meaningless on a card counting down to a birthday — and **deep-links to the Countdowns pane**, since
sending you to an agenda that doesn't contain what you just clicked would be a dead end.

Two consequences worth knowing. The bubble now works with **no Supabase at all** — countdowns are
local, so `maybeShowCalendarBubble()` skips the fetch and still fills the stack in `window.storage`
mode or off `file://`. And the agenda's fetch window is `calAgendaDays()` = `max(lookaheadDays,
bubbleDays)` rather than `lookaheadDays` alone: without that, choosing "next 30 days" would quietly
show countdowns that far out while calendar events stopped at day 14, because day 14 is all that was
ever fetched.

**The bubble is coloured by the calendar the event is on.** The per-calendar `backgroundColor` is
resolved server-side and attached to every event, rather than being correlated on the page — the
client's calendar list is only fetched when the Calendar pane is opened, and the bubble fires on
load, before that has ever happened. The `"primary"` alias needs its own entry in that map, since
`calendarList` reports the account's own calendar under its email address with `primary:true`, so a
request for the literal string `primary` — what an untouched picker sends — would match nothing.

Client side, `calAccentFor()` turns that hex into **two** values, because one can't do both jobs.
`--cal-accent` is the calendar's colour untouched, painting the **spine**, the ping rings and the
wash behind the icon chip — shapes, where fidelity is what makes two calendars tell apart.
`--cal-accent-ink` is that same colour dragged toward the theme until it clears WCAG AA against
`--surface`, and is used only where the accent becomes something to read: the countdown line and
the icon glyph. Correcting one shared value for both instead would crush "Banana" to a dark olive
just so eleven words of 11.5px text could sit on white. The surface luminance is read live off
`--surface` rather than hardcoded per theme, and the nudge loop tests the *rounded* colour, since
rounding to whole channels is exactly what turns a 4.50 into a failing 4.49.

**The accent is spent in one place, not four.** The card's own edge is a neutral `--border` hairline
and the colour lives in a 4px spine down its left side (a `::before`, so the card's radius rounds
it and `::after` stays free for the ping). It used to be the whole 1px border, which is not a colour
signal at all: half of Google's palette is pale by design — it is drawn as small blocks on a white
grid — so "Banana" on white was a border you could not see, on a card whose only reason to be
coloured is telling two calendars apart. For the same reason the icon chip is a *wash* of the accent
with the corrected ink on top, rather than a solid fill of the raw colour with an emoji on it. And
the same spine, at 3px, now runs down every `.cal-row` in the agenda and every chip in the picker
carries the calendar's dot — the picker colour-codes five calendars, and the agenda is the list it
filters, so that is the one place those colours are worth anything. The ping is a `box-shadow`
spread rather than `transform:scale()`: a card is about 340×62, so scaling by 1.07 pushed the ring
12px out at the sides and 2px at the top, which is a smear rather than a ring.

**The picker chips are a toggle and are drawn as one.** The selected chip used to be
`background:var(--cal-ink); color:#fff` with the *raw* colour — white on "Banana" is about 1.6:1,
the exact failure `calAccentFor()` was written for on the bubble and which this strip simply never
got. It is now a wash of the calendar's colour with `--cal-ink-text` (the corrected value) on top,
which also spares the eye a row of five saturated Google colours side by side. Each chip carries the
calendar's dot whether it is on or off, so which calendar owns which colour is legible without
switching one off to find out, and each carries `aria-pressed` — without it a screen reader
announces "Work, button" whether that calendar is on the agenda or not.

Three placement rules it depends on. The bubble is a **body-level sibling of `.main`**, never inside
`#view-time` — `.view{display:none}` would hide it whenever the Time tab wasn't the active one, and
reaching you on whatever tab you opened is the entire point (the same reason `#valItemPreviewOverlay`
sits outside `#view-games`). It sits **top right, tucked under the navbar**, offset by
`--nav-h` — the sticky bar's measured height, published by `js/nav.js` and kept live by a
`ResizeObserver`, so the bubble follows the bar as it shrinks on scroll. That property is exactly
`0` above the mobile breakpoint, where the nav is a left sidebar and the corner is already clear, so
one rule serves both layouts; it also already includes `env(safe-area-inset-top)`, so adding the
inset again would double-count it. Its `z-index:920` is picked against the ladder: above the mobile
sticky sidebar (40) so a bar mid-shrink can't clip it, below the scratch page (950) and below the
1000 modal tier, because a notification must never sit on top of a dialog — and it appears *later*
in the DOM than `#scratchOverlay`, so the number is what keeps it under rather than the source order. And
**the whole card is the click target** — there is no View button — and it **reuses nav.js's own
click ladder** (`item.click()`, then `showTimeSubTab('calendar')` *after* it, never instead of it),
exactly as `insGoTo()` does: the ladder itself calls `showTimeSubTab('clock')`, so a sub-tab set
first is immediately overwritten. The ✕ inside calls `stopPropagation()`, or dismissing would also
navigate. It keeps `role="status"` rather than becoming a `role="button"` — being *announced* on
arrival is its first job, and a button role would silence that — so `tabindex`, a `title` and an
Enter/Space handler are what carry the keyboard path, since `cursor:pointer` announces nothing.

One smaller trap worth knowing: the calendar picker's chips are `.cal-chip`, deliberately **not**
`.finance-subnav-btn` even though they look like one. `showTimeSubTab()` owns every
`#view-time .finance-subnav-btn` and strips `.active` off all of them, which would blank the chips on
every sub-tab switch.

### Board of Advisers

A standing panel of perspectives to run a decision past. It is a **prompt workshop, not an AI client** — nothing in the tab calls a model, and it has no API key, no Edge Function, no rate limit and no bill. It assembles a prompt; you take that prompt to whichever tool you already pay for.

That is a deliberate choice rather than a missing feature. The app already has one server-side model call (`suggest-subtasks`), and routing board consults through the same path would mean a per-consult cost, a shared daily cap, and answers from a model this app picks instead of the one you are subscribed to. Copy-and-paste costs one click and removes all three.

**Three panes** under a sub-nav, always opening on Ask (unlike Games, the choice is not persisted — they are three views of one job):

- **Ask** — the situation, a chip per adviser to pick who sits on this particular consult, checkboxes for the context to attach, the output contract, and the generated prompt.
- **The Board** — the roster. `+ Hire an adviser` opens a library of 13 presets (an already-hired one stays listed but greyed, so the library reads as a complete set); `+ Create custom` writes one from scratch. Every field of every adviser is editable, preset or not, and firing one is a `confirm()` away.
- **History** — the most recent 25 consults, each expanding to a field for pasting the board's answer back. Saved answers render through the same `renderMarkdown()` the Notes bodies use.

**The generated prompt** is four markdown sections — the roster (one `###` heading and lens per selected adviser), the situation, the context pack, and the output contract. The contract defaults to: persona breakdown first with no preamble, 2–3 sentences per adviser in a distinct voice, advisers must reference and challenge each other by name, and a closing `📊 Board Consensus` with a 3-step compromise. It is a plain textarea, so it is editable, and so is the finished prompt — a hand-edit sticks until an input above it changes or you press Rebuild.

**The context pack** is what makes the answers specific: `buildBoardContext()` summarizes your own dashboard — goal progress and target dates, net worth and the last 30 days by spending category, habit streaks, tasks you keep failing, weight and BMI, upcoming countdowns, job-pipeline counts. Everything is derived (counts, totals, percentages) and capped per section, reusing the existing helpers rather than recomputing: `goalProgress()`, `getNetWorthNum()`, `categoryTotalsForPeriod()`, `calcStreak()`, `getStrugglingItems()`, `daysLeft()`. It deliberately does **not** call `calcFitness()`, which renders into the Fitness tab rather than returning anything.

> **What may never go into the context pack.** This is the one function in the app whose output is meant to leave the machine, so the exclusion list at the top of the builder is a safety rule, not a formatting preference: never `state.jobSiteAccounts` (plaintext site passwords), never `state.valorant.apiKey` or `localServerToken`, never note bodies. Every context source is **opt-in and defaults to off** — attaching your finances is a deliberate tick each time, not a setting configured once and forgotten.

**Hand-off** copies the prompt first and opens the tool second, so a link that cannot carry the prompt is an inconvenience rather than a dead end. ChatGPT, Claude and Perplexity accept a `?q=` prefill; **Gemini does not** — Google exposes no such parameter, so that button opens the app bare and relies on the clipboard write. Past ~6000 characters the prefill is dropped for every tool rather than sending a silently truncated prompt. The copy helper also carries a `document.execCommand` fallback that `jobAccountCopy()` does not need: `navigator.clipboard` is undefined on a non-secure origin, and opening `index.html` straight off the filesystem is a supported way to run this app.

Consults ride in the shared `app_data` row, which is why they are capped at 25 rather than kept forever — every save re-uploads that blob whole, and a consult carries a full prompt plus a pasted answer. The cap is `BOARD_SESSION_CAP` in `js/core.js` and is enforced both when saving and when loading.

### Access log

Settings → Data → **Access log**: every device this dashboard has been opened on, and roughly where from. It exists because this app's data row is **unauthenticated** — anyone with the link can read and write it (see "Persistence — two modes, no auth") — so "has anyone but me opened this?" previously had no answer at all. Everything lives in `js/access.js`; the log itself is `state.access.log` in the shared row.

**Sessions, not page loads.** A reload, a restored tab, or a PWA relaunch an hour later is the same sitting, so an open matching the newest entry's device *and* network within six hours bumps that entry's `lastAt`/`visits` instead of appending. Without that the list is a wall of identical rows and the one genuinely new device is invisible in it. The newest 100 sessions are kept — the log rides the shared blob, which is re-uploaded in full on every save from every tab, so the cap is load-bearing rather than cosmetic.

**A bump usually costs no write.** Recording an access is the only write in this app that happens without the user doing anything, and the shared row uses optimistic-concurrency conflict detection — so a phone opening the app while the laptop has it open would hand the laptop a conflict banner it did nothing to earn. Only a genuinely new entry, or a bump more than five minutes after the last one, saves; anything smaller stays in memory and rides the next ordinary save.

**Location is IP-level, never GPS.** The browser Geolocation API is deliberately unused: it prompts, and a permission dialog on every app open to fill in a log nobody asked to see is a worse trade than a coarser answer. The lookup goes to `ipwho.is`, falling back to `ipapi.co` then `get.geojs.io` — all keyless with permissive CORS, so the browser calls them directly, the same reasoning that lets the TFT sync call MetaTFT with no Edge Function in between. Their hosts must stay in `sw.js`'s `LIVE_DATA_HOSTS`: the service worker's cross-origin branch is cache-first, and a cached lookup would pin the answer to whatever network the app was first opened on and have every later session claim that place. A failed lookup (offline, blocked by an ad blocker, over the free tier's daily cap) still logs the device — the row just reads "Location unavailable".

**Same device, new network is a new row.** The location arrives after the device half has already been recorded, so if it comes back with a different IP than the entry that was just bumped, the bump is handed back and a row of its own is started. That is what makes the log answer "where", rather than showing one merged row per device.

**Two switches and a Clear, because this stores your own IP** in that same unauthenticated row. *Logging off* stops recording entirely; *Device only* keeps the device history and never contacts the lookup service at all. Both default to on for data saved before the feature existed, since a log with nothing in it has nothing to show.

Device identification prefers `navigator.userAgentData` where it exists — it names Edge, Opera and Brave properly, which UA-string sniffing cannot, since every Chromium browser puts "Chrome" in its UA — and falls back to ordered UA regexes for Safari and Firefox. An iPad reports the Macintosh UA verbatim, so `maxTouchPoints` is the only thing separating the two and is checked first. The browser *version* is deliberately left out of the fingerprint that merges sessions: a background update mid-session must not split one sitting into two rows.

### External APIs used

| API | Used for | Auth |
|---|---|---|
| HenrikDev Valorant API (`api.henrikdev.xyz`) | Rank/RR/match history lookups | Free key, user-supplied, stored in `state.valorant.apiKey` |
| MetaTFT (`api.metatft.com`) | TFT rank/LP history + placements | No key. Public endpoints, permissive CORS — called straight from the browser |
| Community Dragon (`raw.communitydragon.org`) | TFT rank crest art | No key. Immutable, so cached offline by `sw.js` |
| valorant-api.com | Rank tier icons, agent art, skin/bundle names & images, accessory-shop item names & art (sprays/buddies/player cards/titles), weapon skin catalog + content tiers (reference data) | None (public) |
| open.er-api.com | Live currency exchange rates ("Fetch Live Rates" button) | None (public) |
| ipwho.is, ipapi.co, get.geojs.io | City-level location for the Settings access log (whichever answers first) | No key. Permissive CORS, called straight from the browser |
| Pinterest RSS (`pinterest.com/<user>/feed.rss` + each `/<user>/<board>.rss`, via the `pinterest-feed` function) | The daily 25 random pins in a Motivation "Pinterest collection" | None (public profile + board feeds) |
| Pinterest pin pages + `v*.pinimg.com` (via the `pinterest-feed` function's `resolve` action) | Finding which of the 25 picked pins are videos, and their mp4 URL — the clip itself then streams from the CDN to the browser, not through the function | None (public pin pages) |
| Anthropic API (via `suggest-subtasks` function) | Goal subtask suggestions | Server-side secret only |
| Google Drive API (via `upload-fitness-photo`/`upload-resume` functions) | Auto-storing fitness progress photos and Jobs-tab resume PDFs | Server-side OAuth refresh token only |
| Google Calendar API (via the `google-calendar` function) | The Time tab’s read-only agenda and the “coming up” bubble | Server-side OAuth refresh token only (`calendar.readonly`) |
| Riot internal client API (`auth.riotgames.com`, `pd.*.a.pvp.net`, via `scripts/valorant-check-store.mjs`) | Daily personal store rotation + weekly accessory shop + (via the Local Helper's "Check Owned Skins") owned-skin entitlements | Local session cookie only, never leaves your machine — see "Setup" |
| Riot internal client API (`glz-{region}-1.{shard}.a.pvp.net` + `pd.*.a.pvp.net`, via `scripts/valorant-live.mjs`) | The live lobby: roster, every player's rank/peak/season record, parties, and competitive agent win rates | Local session cookie only, never leaves your machine — see "Live Match" above |
| League/TFT client loopback API (`https://127.0.0.1:{port}`, via `scripts/tft-live.mjs`) | Who is in the TFT lobby you're in right now, and their Riot IDs | Lockfile credentials read from disk on the same machine; read-only GETs, never leaves your machine — see "TFT live lobby" above |
| YouTube IFrame Player API (`www.youtube.com/iframe_api`) | Background music during a checklist Play session, from a YouTube / YouTube Music playlist | None — public playlists only, no key |
| ntfy.sh (via `scripts/valorant-lib.mjs`) | Optional phone push when a wishlisted skin rotates in | None — a topic name of your choosing, stored locally in `scripts/.valorant-notify-config.json` |

### PWA / offline

`manifest.json` + `sw.js` make the app installable. The service worker precaches the static app shell (HTML/CSS/JS/icons/fonts/supabase-js) with a network-first strategy for same-origin/navigation requests and cache-first for cross-origin static assets — but it deliberately **never** intercepts `*.supabase.co`, `api.henrikdev.xyz`, `valorant-api.com`, YouTube (`youtube.com`/`ytimg.com`, the session-music player), the IP-geolocation hosts behind the access log (`ipwho.is`/`ipapi.co`/`get.geojs.io`), or `127.0.0.1`/`localhost` (the Valorant Local Helper) requests, so those always hit the network live instead of serving a stale cached response (this is also why `persistence.js`'s own online/offline handling sees real network state). The loopback entry matters more than it looks: the helper's `GET /status` heartbeat is cross-origin, so without it the connection dot could keep reporting "connected" against a server that had already been stopped.

## Setup

1. Open `index.html` directly, or serve the folder statically (any static host works — no build step). `node scripts/serve.mjs` is a zero-install loopback static server for that (`http://localhost:8025`); use it rather than `file://` if you want session music, which YouTube won't embed into an origin-less page — see "Session music".
2. **If deploying outside Claude** (e.g. GitHub Pages), create a Supabase project and:
   - Run the SQL in the comment at the top of `js/persistence.js` to create the `app_data` table + open RLS policy.
   - Replace `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/persistence.js`.
   - Deploy the five Edge Functions in `supabase/functions/` (`manage-backups`, `suggest-subtasks`, `upload-fitness-photo`, `upload-resume`, `google-calendar`) and set their secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and the Google secrets below).
   - Create the private `backups` Storage bucket and the `ai_usage` table (`day text primary key, count int`) if you want backups / AI subtask limits to work.
   - For scheduled backups, set the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret so `.github/workflows/backup-supabase.yml` can run.
   - **For goal/finance icon uploads and the daily Valorant store check's writes** — run `supabase/setup-egress-fix.sql` once in the SQL editor. It creates the public `icons` Storage bucket + policies (goal/finance images upload here instead of being embedded as base64 in `app_data`) and the three Postgres functions (`valorant_set_daily_store`, `valorant_set_daily_store_error`, `valorant_delete_daily_store`) `scripts/valorant-lib.mjs` calls instead of reading/writing the whole row. Skipping this doesn't break anything — icon uploads fall back to base64 and the Valorant scripts fall back to erroring per-account — it just means you're not getting the egress savings.
   - **For Fitness progress-photo uploads** (one-time setup, needed for `upload-fitness-photo`):
     1. In [Google Cloud Console](https://console.cloud.google.com), create a project, enable the **Google Drive API**, and create an **OAuth 2.0 Client ID** (type: Desktop app is simplest).
     2. Using that client ID/secret, complete an OAuth consent once with scope `https://www.googleapis.com/auth/drive.file` (e.g. via [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground), using your own client ID/secret under its settings gear) and copy the resulting **refresh token**.
     3. (Optional) create/choose a Drive folder for progress photos and copy its folder ID from the URL.
     4. Set the Supabase Edge Function secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and optionally `GOOGLE_DRIVE_FOLDER_ID`.
     5. Note: to show photos in-app without proxying image bytes through Supabase, the function sets each uploaded photo's Drive sharing to "anyone with the link can view" and points the carousel's `<img>` tags straight at Drive. Anyone who obtains a photo's (long, unguessable) file ID could view it — turn this off by removing the `permissions` call in `upload-fitness-photo/index.ts` if that's not an acceptable trade-off for you.
   - **For Jobs-tab resume PDF attachments** (needed for `upload-resume`) — reuses the exact same `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN` secrets set up above for Fitness photos, so if those are already set there's nothing new to configure: the function finds (or creates, on first upload) a Drive folder literally named "Uploaded Resumes" on its own. Set the optional secret `GOOGLE_DRIVE_RESUMES_FOLDER_ID` only if you'd rather pin uploads to a specific existing folder instead of the by-name lookup. Same link-viewable sharing trade-off as progress photos applies to the "View in Drive" links.
   - **For the Time tab's Calendar pane** (one-time setup, needed for `google-calendar`). Quickest route: `node scripts/google-calendar-token.mjs`, which runs the whole loopback OAuth flow locally and prints the refresh token plus the `secrets set` lines to paste — it works with either OAuth client type and passes `prompt=consent`, so it re-issues a refresh token on every run instead of only the first. The manual equivalent, if you'd rather not run a script:
     1. In the same [Google Cloud Console](https://console.cloud.google.com) project, enable the **Google Calendar API**.
     2. Complete an OAuth consent once with scope `https://www.googleapis.com/auth/calendar.readonly` (same OAuth Playground route as above, own client ID/secret under the settings gear) and copy the resulting **refresh token**.
     3. Set the Supabase Edge Function secret `GOOGLE_CALENDAR_REFRESH_TOKEN` to it. Deliberately a **separate secret** from `GOOGLE_REFRESH_TOKEN` — see that function's bullet above for why.
     4. **If you had to make a new OAuth client for this** — likely, since the Playground needs a *Web application* client with `https://developers.google.com/oauthplayground` as a redirect URI, and the Drive setup above suggests a *Desktop app* one — also set `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` to that new client's pair. A refresh token is bound to the client that issued it, and handing it to a different one fails with `invalid_client`, which names nothing useful. Leave both unset if one client covers everything.
     5. Note: if that Cloud project's OAuth consent screen is still in **Testing** publishing status, Google expires refresh tokens after 7 days. If the calendar starts failing weekly and nothing else changed, that's why — publish the consent screen.
   - **For the daily Valorant store check** — this one runs **locally on your own machine**, not as an Edge Function (see "Daily Valorant store check" above for why) — recurring, not one-time. Supports tracking more than one Riot account's store side by side, each saved under a label you choose. No `npm install` needed anywhere in `scripts/` — it's plain Node built-ins end to end:
     1. In your own normal browser, log into `https://playvalorant.com`. Open DevTools (F12) → Application tab → Cookies → `https://auth.riotgames.com` → copy the values of **both** the `ssid` and the `clid` cookie (see "A session is two cookies" above — `ssid` alone is refused as though it had expired). Note DevTools only lists cookies for origins the current page touched, so if `auth.riotgames.com` isn't in the list, open a tab straight at `https://auth.riotgames.com/` first.
        - **Or skip steps 1-2 entirely**: `node scripts/valorant-login-window.mjs [label]` — or double-click `scripts\valorant-login-window.cmd` — opens a small, signed-out window of your default browser on Riot's login page, waits for you to sign in there, and saves the session under that label by itself. Nothing else needs to be running: not the local helper, not the app. Omit the label to refresh the account you already have saved (it asks which, if you track more than one). The Valorant tab's **🌐 Log in with browser** button runs the same thing through the local helper, for when the tab is already open. It's the manual copy automated, not the login — see "Log in with browser" above for exactly where that line sits and why nothing in it may ever try to disguise the window.
        - *Why isn't the login itself automated?* An earlier version tried, via a Puppeteer-driven browser window — see "Getting the initial session" above for why that doesn't work (Riot's fraud detection rejects automation-controlled browsers outright) and won't be re-added.
     2. Run `node scripts/valorant-login.mjs [label]` (e.g. `node scripts/valorant-login.mjs main`; omit `[label]` to use "default") and paste each cookie when prompted — or non-interactively, `node scripts/valorant-login.mjs main <ssid> <clid>`. It validates the cookie with a quick silent reauth (so a bad paste fails immediately) and saves it under that label to `scripts/.valorant-session.json` (gitignored — never committed, never sent anywhere but Riot).
        - **To track another account**, repeat both steps with a different label, e.g. `node scripts/valorant-login.mjs smurf` — a fresh label doesn't touch any other saved account.
     3. Run `node scripts/valorant-check-store.mjs`. It re-authenticates using every saved session, pulls each account's personal daily storefront **and its accessory shop** — plus, from the same storefront response, the featured bundle (with its contents) and the **Night Market** when one is running, and, as one extra request each on the auth ladder that's already been climbed, the equipped player card and the wallet balances. Everything after the daily offers is best-effort, so none of it can fail a check that otherwise worked. It resolves skin/bundle/accessory/card names and images via valorant-api.com, and writes the result into `state.valorant.dailyStores[label]` on the shared `app_data` row directly (same public anon key the app itself uses — no service-role key needed for this), plus a local copy in `scripts/.valorant-latest-store.json` for the desktop widget below. Pass a single label (e.g. `node scripts/valorant-check-store.mjs main`) to check just that one account instead of all of them.
     4. **Run step 3 daily** for the Valorant tab to actually show "today's" store for each tracked account. See "Automating the daily check" below for a Windows Task Scheduler setup so you don't have to run it by hand.
     5. **Each saved session expires in roughly 1-3 weeks** (Riot's own limit, not configurable), independently per account. When one does, `valorant-check-store.mjs` writes a "session expired" message into that account's entry in `state.valorant.dailyStores` (shown as a banner under that account's store section on the Valorant tab) instead of failing silently — other accounts keep updating normally. When you see that, the **🔑 Re-login** button on that banner opens the Add-account dialog locked to that account: paste a fresh `ssid` (and `clid` if Riot asks for it) and it keeps its name, wishlist, store history and owned-skin list, then re-runs its store check as soon as it lands. The same dialog offers **🌐 Log in with browser** if you'd rather not touch DevTools. With nothing else running, `node scripts/valorant-login.mjs "<label>" <ssid> <clid>` or `node scripts/valorant-login-window.mjs "<label>"` do the same from a terminal.
   - **Automating the daily check (Windows Task Scheduler)**: open Task Scheduler → Create Basic Task → trigger "Daily" at a time your PC is normally on → action "Start a program" → Program: `node`, Arguments: `scripts\valorant-check-store.mjs`, "Start in": this project's folder. A single scheduled run checks every saved account. Since the check needs your own machine's session, it only runs while the PC is on — a missed day just means yesterday's store stays shown until the next successful run.
   - **Optional: push notification when a wishlisted skin rotates in** — fires a phone push (via [ntfy.sh](https://ntfy.sh), free, no account needed) right after `valorant-check-store.mjs`/`valorant-local-server.mjs` writes a new store result, if any item matches that account's wishlist. Opt-in — skipping this changes nothing else.
     1. Run `supabase/setup-valorant-notify.sql` once in the Supabase SQL editor (same place `setup-egress-fix.sql` was run) — adds a read-only RPC so the script can fetch one account's wishlist without pulling the whole `app_data` row.
     2. Install the [ntfy app](https://ntfy.sh) (iOS/Android) and subscribe to a topic name of your choosing — pick something hard to guess, since anyone who knows a public ntfy topic can also subscribe to it.
     3. Create `scripts/.valorant-notify-config.json` (gitignored) with `{"ntfyTopic": "your-topic-name"}`.
     4. That's it — every `valorant-check-store.mjs` run (scheduled or manual) or "Check Store Now" click pushes a notification for any current wishlist match, even if a previous run already flagged the same skin earlier the same day.
   - **Optional: trigger Check/Add Account from the Valorant tab itself** instead of a terminal, via `scripts/valorant-local-server.mjs` — a small local bridge (loopback-only, no other network access) that the tab's "Local Helper" panel talks to:
     1. Run `node scripts/valorant-local-server.mjs`. It prints a token and keeps running in that terminal — leave it open while you use the buttons.
     2. Paste the printed token into the Valorant tab's "Local Helper" → "Local Helper Token" field and click Save Token. The panel's status dot turns on once it can reach the server.
     3. **Adding an account without leaving the Valorant tab**: the Shop Tracker card has a **＋** button beside the ★, which opens an Add-account dialog — a name, then either **🌐 Log in with browser** or a pasted `ssid`. The `clid` field there is genuinely optional: the `ssid` is tried on its own first and Riot decides whether that's enough, so you only fill it in if you're asked to. A successful add runs that account's first store check straight away. Settings still holds the rest of the account admin (delete, token, manual check).
     4. **Check Store Now** runs the same check as step 3 above (for the account picked in the switcher, or "All") and refreshes the tab with the result. **+ Add Account** runs the same cookie-save as steps 1-2 above: log into `playvalorant.com` in your own browser first (same DevTools cookie copy as step 1), then type a label and paste the cookie into the panel's fields and click the button. **🌐 Log in with browser** does the same save without the DevTools trip — type a label, click it, and a small signed-out browser window opens on Riot's login page on *this* machine; sign in there and the session saves itself under that label (Cancel closes it; reusing an existing label refreshes that account, which is what the store banner's **🔑 Re-login** button does). **🗑 Delete** removes the saved session for whichever specific account is picked in the dropdown (disabled for "All accounts") — it deletes that label from `scripts/.valorant-session.json` and clears its store data, after a confirmation prompt since you'd need to repeat steps 1-2 to re-add it.
     5. This is a convenience on top of the CLI, not a replacement for it — the daily automated check (previous bullet) still needs the Task Scheduler entry, since nobody's expected to leave a browser tab open and click a button every day. The local server is for one-off checks, adding new accounts, and removing ones you no longer want tracked.
     6. The token gates `/check`, `/live`, `/login`, `/login-window`, `/login-window-status`, `/login-window-cancel`, and `/delete-account`; regenerate it by deleting `scripts/.valorant-local-token.json` and restarting the server if you ever want to invalidate it.
     7. **Leaving it running (recommended once Live Match is in use).** The server is only useful while it's up, and Live Match wants it up whenever you're playing — so start it at login instead of from a terminal. Double-click `scripts\valorant-local-server.vbs` (identical to `node scripts/valorant-local-server.mjs`, minus the console window), or for a hands-off setup press <kbd>Win</kbd>+<kbd>R</kbd> → `shell:startup` and drop a **shortcut to that .vbs** in the folder that opens. If you'd rather it *not* sit there all day, shortcut `scripts\local-helper-watch.vbs` instead — same startup folder, but it runs the helper only while a Riot client is open (see "Tying the helper to the Riot client" above, including what that costs you). Same trick as the desktop widget below. It's idle when nothing is asking it anything — the Live Match panel only polls while its sub-tab is on screen and the browser tab is visible — so leaving it up costs nothing. Two notes: it needs `node` on PATH (it is, if `node scripts/serve.mjs` works from a plain terminal), and because it's windowless you stop it from Task Manager (`node.exe`) rather than with Ctrl+C. If you'd rather have it restart itself on failure, use Task Scheduler instead with an "At log on" trigger, program `node`, arguments `scripts\valorant-local-server.mjs`, "Start in" set to this folder, and *Restart the task if it fails* under Settings.
     8. **Live Match** is the one thing that *only* works through this server — there's no CLI equivalent you'd run on a schedule, because it's about the game you're in right now. With the server running and the token saved, open the Valorant tab → **Live Match** and it fills in on its own once you're in a queue. It polls only while that sub-tab is the one on screen and the browser tab is visible, so it costs nothing when you're not looking at it. If it says it can't work out your region, set it manually under Settings → Valorant → Live Match (Riot's geo endpoint only returns a shard; the NA shard also serves LATAM and BR). You don't have to tell it which account you're on — with several saved sessions it finds the one that's playing (see "Live Match" above); the dropdown pins a specific one if you'd rather. You can also run `node scripts/valorant-live.mjs` from a terminal to print the same lobby as a table (add a label to pin one account), which is the quickest way to check the Riot side is working.
   - **Optional: desktop widget (`scripts/valorant-widget.ps1`)** — today's store as a small always-on-top panel on the Windows desktop, instead of opening the app. Plain WinForms driven by PowerShell, so there's nothing to install (no Electron, no Rainmeter, no `npm install` — same "no build step" rule as the rest of the repo).
     1. Run `powershell -ExecutionPolicy Bypass -File scripts\valorant-widget.ps1`, or double-click `scripts\valorant-widget.vbs` (identical, minus the console window that briefly flashes otherwise). For a widget that's always there, put a shortcut to the `.vbs` in `shell:startup`.
     2. It reads `scripts/.valorant-latest-store.json` — a local mirror of the last result per account, written by `writeStoreSnapshot()` in `valorant-lib.mjs` on **every** check, whether that came from the CLI, the scheduled task, or the tab's "Check Store Now". No Supabase read, no `app_data` row pulled: the widget refreshes for free. Skin art is downloaded once into `scripts/.valorant-widget-cache/`. Until the first check runs, the widget just says so.
     3. Drag anywhere to move it (position remembered in `scripts/.valorant-widget-config.json`); click the account label to cycle accounts when more than one is tracked; **⟳** runs a fresh check for the shown account (`node scripts/valorant-check-store.mjs <label>`, same as the terminal); **x** closes it. Wishlisted skins get a gold ★ and edge stripe — matched at check time by the same rule the ntfy push uses, so it works whether or not you set that up. A "session expired" message shows in the widget too, same as the tab's banner.
     4. Unless started with `-NoAutoCheck`, it runs a check by itself when the rotation it's showing has already ended (at most once every 30 minutes) — so a widget left running overnight has today's store by the time you look at it, whether or not you also set up the scheduled task. Failures inside the UI are appended to `scripts/.valorant-widget.log` rather than lost, since the window has nowhere to print them.
   - **Picking and renaming accounts.** The Shop Tracker's account switcher is a row of chips rather than a dropdown: one per tracked account, each showing that account's equipped player card (already fetched by the store check), plus a ★ when one of its wishlisted skins is in today's store and a ⚠ when its session needs re-logging in. "All" appears only once there's more than one account to combine. Selecting a chip filters the store, the wishlist and the owned-skin list together, and the choice persists in `state.valorant.selectedStoreLabel`.

     The ✎ on the selected chip renames that account. This is a **migration, not a text edit** — the label is the key in the helper's `.valorant-session.json`, the widget's `.valorant-latest-store.json`, and `dailyStores` / `ownedSkins` / `wishlist` (plus `live.label`) in the shared row. `POST /rename-account` moves the two local files and the page moves its own state and saves, which carries the Supabase side; the page only touches its state **after** the helper has agreed, so a failure leaves both halves still agreeing on the old name rather than disagreeing. Renaming therefore needs the helper running, and a name already in use is refused. Renaming by hand instead — editing the session file, say — is what leaves orphaned per-account wishlists behind, since nothing moves them.

   - **Optional: "🎨 Check Owned Skins"** — same Local Helper panel, one more button. Re-authenticates the picked account (or every saved account, for "All accounts"), fetches every entitlement type Riot has on file for it, and figures out which one is "weapon skins" by checking which bucket's item ids actually resolve against valorant-api.com's skin catalog (rather than trusting a hardcoded Riot item-type id, which turned out to be unreliable). Owning any one level of a skin entitles you to all of its levels, so entitlements are deduped back to one entry per skin rather than showing a 4-level skin 4 times. Writes the result — each owned skin's name, image, content tier, and weapon type — into `state.valorant.ownedSkins[label]`, shown as the "Owned Skins" pane of the Shop Tracker's Store/Owned Skins toggle, styled the same as the store itself, for whichever account is picked in that tab's account dropdown (not shown for "All accounts", same as the wishlist), sortable by tier, name, or weapon type (Sidearm/SMG/Shotgun/Rifle/Sniper/Heavy/Melee).
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
  pin.js                            the PIN gate — owner vs guest, gets in before anything else (loads first)
  core.js                           state shape, constants, helpers
  persistence.js                    load()/save(), Claude-storage vs Supabase, offline/conflict handling
  protecteddays.js                  vacation/sick/event exemption list (Settings) — consumed by habits.js/checklists.js
  main.js                           renderAll(), theme switching, boot (load())
  nav.js                            tab switching, mobile gestures
  quickactions.js                   fixed bottom-right quick-actions bar (the sleep toggle)
  music.js                          background music for a checklist Play session (YouTube IFrame player)
  board.js                          Board of Advisers — adviser roster, prompt maker, consult log (no API calls)
  goals.js / habits.js / finance.js / fitness.js / valorant.js / motivation.js /
  checklists.js / notes.js / countdowns.js / mantras.js / backups.js / settings.js
  insights.js
  access.js                         Settings → Data → Access log: records this visit's device + rough location, renders the list
                                     one file per feature tab
supabase/functions/
  manage-backups/                   list/restore daily backups
  suggest-subtasks/                 AI goal-subtask suggestions (Anthropic, rate-limited)
  upload-fitness-photo/             uploads a Fitness progress photo to Google Drive
  upload-resume/                    uploads a Jobs-tab resume PDF to Google Drive ("Uploaded Resumes" folder)
  google-calendar/                  read-only Google Calendar agenda for the Time tab (server-side OAuth refresh token)
  pinterest-feed/                   merges a Pinterest profile's public RSS feeds — profile + every board (CORS proxy for Motivation's Pinterest collections); also resolves mp4 URLs for video pins
scripts/serve.mjs                   `node scripts/serve.mjs` → serves the app at http://localhost:8025 (loopback, no install); needed for session music, which YouTube won't embed into a file:// page
scripts/google-calendar-token.mjs   run LOCALLY once → the calendar.readonly refresh token (loopback OAuth, no install)
scripts/backup-supabase.sh          daily snapshot → Supabase Storage
scripts/valorant-lib.mjs            shared, dependency-free helpers (sessions, Supabase writes, the storefront + owned-skins fetch)
scripts/valorant-login.mjs          run LOCALLY to save a pasted Riot session cookie under a labeled account
scripts/valorant-login-window.mjs   run LOCALLY, standalone — opens a small signed-out window of your default browser on Riot's login page, waits for you to sign in, and rewrites that account's saved cookie; also powers the tab's "Log in with browser" / "Re-login" buttons
scripts/valorant-login-window.cmd   double-clickable version of the above (keeps its console — it reports progress and may ask which account)
scripts/valorant-check-store.mjs    run LOCALLY (daily, e.g. via Task Scheduler) to update the store for every saved account
scripts/valorant-live.mjs           run LOCALLY — the live lobby (roster, ranks, parties, agent win rates); powers the tab's Live Match panel, also runnable as a CLI
scripts/tft-live.mjs                run LOCALLY — the live TFT lobby (all 8 players and each one's peak rank); reads the League/TFT client's own loopback API, powers the TFT tab's lobby card, also runnable as a CLI
scripts/valorant-local-server.mjs   run LOCALLY (optional) — loopback-only HTTP bridge so the Valorant tab's buttons can trigger the scripts above, and the Live Match / TFT lobby panels can poll for your current game
scripts/valorant-local-server.vbs   starts that server with no console window; shortcut this from shell:startup to have it always running
scripts/local-helper-watch.mjs      run LOCALLY (optional) — starts the local helper when a Riot client opens and stops it when it closes; use instead of the server if you'd rather it not be up all day
scripts/local-helper-watch.vbs      starts that watcher with no console window; shortcut this from shell:startup
scripts/helper-protocol.mjs         run LOCALLY once — registers the p25helper:// URL protocol so the app's "Start helper" button can launch the server (register | unregister | status)
scripts/valorant-widget.ps1         run LOCALLY (optional) — always-on-top desktop widget showing today's store (WinForms, no installs)
scripts/valorant-widget.vbs         launches the widget with no console flash; shortcut this from shell:startup
scripts/.valorant-session.json      gitignored — saved Riot sessions by label, created by valorant-login.mjs
scripts/.valorant-login-profile/    gitignored — throwaway browser profile for the login window; created per attempt, deleted as soon as the cookie is saved
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
