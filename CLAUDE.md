# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project 25 — a single-page personal life-dashboard web app (goals, habits, finance, fitness, Valorant tracking, checklists, countdowns, mantras). See `README.md` for the full feature/architecture writeup (data model, persistence internals, Supabase Edge Functions, Valorant local-script setup) — it's kept accurate and detailed; read it before making non-trivial changes rather than re-deriving structure from the code.

## No build step

Plain HTML/CSS/JS, no npm, no bundler, no framework.

- **Run/test the app**: open `index.html` directly in a browser, or run `node scripts/serve.mjs` and open `http://localhost:8025` (plain `node:http` static server, no install). There is still no build, lint, or test command in this repo. Session music is the one feature that needs the served form — YouTube refuses to embed its player into a `file://` page (error 153), see README's "Session music". That section also covers the two playback modes (`state.sessionMusic.mode`): the in-app iframe player can't see a Premium account, because a cross-site frame only gets YouTube's cookies when the browser allows them there — `external` mode hands the playlist to YouTube Music instead. Don't try to "fix" the ads inside the embed; the mode picker is the fix.
- **Scripts in `scripts/`** (Valorant helpers, backup): plain Node.js built-ins only, run directly with `node scripts/<file>.mjs` — no `npm install` anywhere in the project.
- Supabase Edge Functions live in `supabase/functions/*/index.ts`, deployed via the Supabase CLI (not part of this repo's build).

## Architecture essentials

- `index.html` loads a **fixed sequence** of `<script>` tags from `js/` — order matters, later files reference functions/globals defined in earlier ones:
  ```
  core.js → persistence.js → protecteddays.js → nav.js → goals.js → habits.js →
  countdowns.js → insights.js → backups.js → mantras.js → checklists.js → notes.js →
  finance.js → wishlist.js → jobs.js → fitness.js → valorant.js → clock.js → main.js
  ```
- All modules share one global `state` object (shape defined/defaulted in `core.js` / `persistence.js:applyLoadedState()`) and small globals (`el()`, `uid()`, `escapeHtml()`, date helpers). No modules, no per-file scoping, no virtual DOM — each tab's `render*()` rebuilds that section's `innerHTML` from `state` on every change, and `save()` runs after essentially every mutation.
- One file per feature tab (`goals.js`, `habits.js`, `finance.js`, `fitness.js`, `valorant.js`, `checklists.js`, `notes.js`, `countdowns.js`, `mantras.js`, `clock.js`, `wishlist.js`, `jobs.js`, `backups.js`, `insights.js`, `protecteddays.js`), each owning its own render function and DOM listeners — no central router.
- **`notes.js` is the one tree in the app.** `state.notes` is a *flat* array; nesting is a `parentId` link and sibling order is the array's own order, so moving a subtree relocates exactly one record and its descendants follow. Three rules it depends on: the title `<input>` is live and its `input` handler must never call `renderNotes()` (that would rebuild the field mid-keystroke and drop the caret — `debouncedSaveNotes()` only); user text is assigned via `.value`, never interpolated into a `value="…"` attribute, because `escapeHtml()` does **not** escape double quotes; and `repairNoteTree()` runs at the top of every render, because a dangling or cyclic `parentId` makes a note unreachable from the roots and therefore invisible, which reads as data loss.
- **Notes rendering rules.** Clicking a row expands/collapses it and must *never* fall through to opening the text editor — folding the outline and starting to type are separate gestures (title field or ✎ button). Collapsing hides children **and** the body, which is what gives a childless note something to fold. Tags aren't stored: they're parsed out of the title by `noteTags()` on read, so renaming a note retags it and nothing can go stale. `renderMarkdown()` is hand-rolled (no bundler here) and is safe only because `escapeHtml()` runs on the whole source **first** — every rule after that operates on escaped text and emits only its own tags; link hrefs are additionally quote-stripped and scheme-checked against `MD_SAFE_URL`. Don't add a rule that interpolates source text into an attribute.
- **Persistence** (`js/persistence.js`): inside Claude.ai uses `window.storage`; deployed elsewhere falls back to Supabase, writing to a shared unauthenticated row (`app_data`, `id='shared'`) with optimistic-concurrency conflict detection and a localStorage offline cache. **Jobs and Notes are the exceptions** — each persists to its own resource (`id='jobs'` via `js/jobs.js`, `id='notes'` via `js/notes.js`); see "Data safety" below. Read README's "Persistence — two modes, no auth" section before touching load/save logic.
- **Valorant tooling is intentionally local-only** (`scripts/valorant-*.mjs`, run on the user's own machine, not as a cloud/Edge Function) — this is a deliberate anti-fraud-detection workaround documented at length in the README ("Daily Valorant store check", "Getting the initial session"). Don't try to "fix" this by moving it back to a cloud function.
- **The desktop widget** (`scripts/valorant-widget.ps1`, WinForms via PowerShell — the "no build step" rule applies to it too, so don't propose Electron/Tauri) renders from `scripts/.valorant-latest-store.json` **only**, never from Supabase. That file is written by `writeStoreSnapshot()` in `valorant-lib.mjs`, called from `recordAccountResult()`/`recordAccountError()`, so it stays current no matter which entry point ran the check. Anything new that records a store result must go through those two functions or the widget silently keeps showing yesterday's store. Note `recordAccountResult()` writes the snapshot *before* the Supabase RPC on purpose — a Supabase outage shouldn't blank the widget.

## Working conventions

- Images (goal/finance icons, fitness progress photos) are stored as Supabase Storage / Google Drive URLs in `state`, never as embedded base64 — keep new image-handling code consistent with that (`uploadCompressedImage()` in `core.js`).
- New fields on `state` get defaults added in `persistence.js:applyLoadedState()` so old saved data upgrades in place — this repo does not use migration scripts. **Two exceptions:** new *job-record* fields go in `jobs.js:applyLoadedJobsState()` and new *note-record* fields in `notes.js:applyLoadedNotesState()` instead (see below). Everything else, including `state.jobSiteAccounts`, still belongs in `applyLoadedState()`.
- Adding a whole new top-level `state` key needs no change to `doSave()` — the rest-destructure carries it automatically.
- Gitignored local secrets: `scripts/.valorant-session.json`, `scripts/.valorant-local-token.json`, `scripts/.valorant-notify-config.json` — never commit these or print their contents.

## Data safety — do / don't

Two tabs persist to their **own** resource instead of the shared blob:

| Tab | Row id | `window.storage` key | Owner file — save / load / hydrate |
|---|---|---|---|
| Jobs | `jobs` | `app-data-jobs` | `js/jobs.js` — `saveJobs()` / `loadJobsData()` / `applyLoadedJobsState()` |
| Notes | `notes` | `app-data-notes` | `js/notes.js` — `saveNotes()` / `loadNotesData()` / `applyLoadedNotesState()` |

Each mirrors `persistence.js`'s safety properties (own `loadedOk`-style gate, conflict detection, offline cache, serialized save chain) and has its own scoped conflict/offline banners rather than the global ones. Rationale: the shared blob is re-serialized and re-uploaded *in full* on every save from *any* tab, so a long application list — or a whole notes outline — would be re-sent on every unrelated edit. Notes is the sharper case: it debounce-saves per keystroke, so in the blob every paragraph typed would re-upload every goal, habit and finance record in the app.

**Never — each of these loses data silently, with no error:**
- Call plain `save()` after mutating `state.jobs` or `state.notes`. It won't persist; the edit vanishes on reload. Use `saveJobs()` / `saveNotes()` (`debouncedSaveNotes()` for per-keystroke fields). Conversely, `state.jobSiteAccounts` stays on `save()` — it deliberately remains in the shared blob.
- Re-add `state.jobs` or `state.notes` hydration to `applyLoadedState()` — it would overwrite the dedicated row with a stale shared-blob copy.
- Replace `const { jobs, notes, ...mainState } = state` in `doSave()` with a hand-written key list. A jsonb write **replaces** the column rather than merging, so any key missing from that object is destroyed on the next save from any tab.
- Serialize `state.notes` anywhere except `notes.js:serializeNotes()`. It's the wire format, and it deliberately omits fields sitting at their default (~45% smaller); `applyLoadedNotesState()` restores them on the way back in. Writing raw `state.notes` isn't wrong, just wasteful — but *reading* a compact record without going through the hydrator is, since `parentId`/`body` will be `undefined`.
- Remove the standing migration in `loadJobsData()` / `loadNotesData()` (seeds the dedicated resource from a pre-split embedded copy whenever it finds the row absent). It is not a run-once script — any browser/device that hasn't loaded the current code yet still depends on it.
- Add a row to `scripts/backup-supabase.sh` without also reading it out in `manage-backups/index.ts` **and** applying it in `backups.js:doRestore()`. A row that is backed up but never restored looks safe and isn't.
- Rename the row ids / storage keys (`shared`, `jobs`, `notes`, `app-data-jobs`, `app-data-notes`), or delete the `jobs`/`notes` rows as though they were strays.
- `git revert` past `e666ca9` without first copying the `jobs` row's contents back into `shared.data.jobs` — older code doesn't know the row exists.

**Requires a deploy step — editing the file alone does nothing:**
- Any `supabase/functions/*/index.ts` change → `npx supabase functions deploy <name>` (repo is already CLI-linked).
- Changing the backup file shape in `scripts/backup-supabase.sh` → redeploy `manage-backups` in the same sitting, or restores break. Backup files hold all three rows as `[{id,data},…]`; consumers must key off `.id`, **never** array position (rows come back id-ordered, so `jobs` and `notes` both precede `shared`). The `jobs`/`notes` rows may each legitimately be absent. Pre-split backups use the older `[{data}]` shape with no `id` key — every one of these shapes must keep working.

**Deliberate limits — don't "fix" these:**
- Site Accounts passwords sit in plaintext in the shared unauthenticated row; the masking is UI-only. A documented trade-off, not an oversight.
- Jobs auto-ghosting only flips `applied` → `ghosted` at 30 days, never `interviewing` — only one date is tracked, so it can't fairly judge a stalled interview.
