# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project 25 — a single-page personal life-dashboard web app (goals, habits, finance, fitness, Valorant tracking, checklists, countdowns, mantras). See `README.md` for the full feature/architecture writeup (data model, persistence internals, Supabase Edge Functions, Valorant local-script setup) — it's kept accurate and detailed; read it before making non-trivial changes rather than re-deriving structure from the code.

## No build step

Plain HTML/CSS/JS, no npm, no bundler, no framework.

- **Run/test the app**: open `index.html` directly in a browser, or serve the folder statically. There is no dev server, build, lint, or test command in this repo.
- **Scripts in `scripts/`** (Valorant helpers, backup): plain Node.js built-ins only, run directly with `node scripts/<file>.mjs` — no `npm install` anywhere in the project.
- Supabase Edge Functions live in `supabase/functions/*/index.ts`, deployed via the Supabase CLI (not part of this repo's build).

## Architecture essentials

- `index.html` loads a **fixed sequence** of `<script>` tags from `js/` — order matters, later files reference functions/globals defined in earlier ones:
  ```
  core.js → persistence.js → protecteddays.js → nav.js → goals.js → habits.js →
  countdowns.js → insights.js → backups.js → mantras.js → checklists.js →
  finance.js → wishlist.js → jobs.js → fitness.js → valorant.js → clock.js → main.js
  ```
- All modules share one global `state` object (shape defined/defaulted in `core.js` / `persistence.js:applyLoadedState()`) and small globals (`el()`, `uid()`, `escapeHtml()`, date helpers). No modules, no per-file scoping, no virtual DOM — each tab's `render*()` rebuilds that section's `innerHTML` from `state` on every change, and `save()` runs after essentially every mutation.
- One file per feature tab (`goals.js`, `habits.js`, `finance.js`, `fitness.js`, `valorant.js`, `checklists.js`, `countdowns.js`, `mantras.js`, `clock.js`, `wishlist.js`, `jobs.js`, `backups.js`, `insights.js`, `protecteddays.js`), each owning its own render function and DOM listeners — no central router.
- **Persistence** (`js/persistence.js`): inside Claude.ai uses `window.storage`; deployed elsewhere falls back to Supabase, writing to a shared unauthenticated row (`app_data`, `id='shared'`) with optimistic-concurrency conflict detection and a localStorage offline cache. **Jobs is the one exception** — it persists to its own resource (`id='jobs'`) via `js/jobs.js`; see "Data safety" below. Read README's "Persistence — two modes, no auth" section before touching load/save logic.
- **Valorant tooling is intentionally local-only** (`scripts/valorant-*.mjs`, run on the user's own machine, not as a cloud/Edge Function) — this is a deliberate anti-fraud-detection workaround documented at length in the README ("Daily Valorant store check", "Getting the initial session"). Don't try to "fix" this by moving it back to a cloud function.

## Working conventions

- Images (goal/finance icons, fitness progress photos) are stored as Supabase Storage / Google Drive URLs in `state`, never as embedded base64 — keep new image-handling code consistent with that (`uploadCompressedImage()` in `core.js`).
- New fields on `state` get defaults added in `persistence.js:applyLoadedState()` so old saved data upgrades in place — this repo does not use migration scripts. **One exception:** new *job-record* fields go in `jobs.js:applyLoadedJobsState()` instead (see below). Everything else, including `state.jobSiteAccounts`, still belongs in `applyLoadedState()`.
- Adding a whole new top-level `state` key needs no change to `doSave()` — the rest-destructure carries it automatically.
- Gitignored local secrets: `scripts/.valorant-session.json`, `scripts/.valorant-local-token.json`, `scripts/.valorant-notify-config.json` — never commit these or print their contents.

## Data safety — do / don't

Jobs persists to its **own** resource (`app_data` row `id='jobs'`, or the `app-data-jobs` `window.storage` key), separate from the shared blob every other tab uses. `js/jobs.js` owns `saveJobs()` / `loadJobsData()` / `applyLoadedJobsState()`, mirroring `persistence.js`'s safety properties (own `loadedOk`-style gate, conflict detection, offline cache, serialized save chain). Rationale: the shared blob is re-serialized and re-uploaded *in full* on every save from *any* tab, so a long application list would be re-sent on every unrelated edit.

**Never — each of these loses data silently, with no error:**
- Call plain `save()` after mutating `state.jobs`. It won't persist; the edit vanishes on reload. Use `saveJobs()`. Conversely, `state.jobSiteAccounts` stays on `save()` — it deliberately remains in the shared blob.
- Re-add `state.jobs` hydration to `applyLoadedState()` — it would overwrite the dedicated row with a stale shared-blob copy.
- Replace `const { jobs, ...mainState } = state` in `doSave()` with a hand-written key list. A jsonb write **replaces** the column rather than merging, so any key missing from that object is destroyed on the next save from any tab.
- Remove the standing migration in `loadJobsData()` (seeds the dedicated resource from a pre-split embedded copy whenever it finds the row absent). It is not a run-once script — any browser/device that hasn't loaded the current code yet still depends on it.
- Rename the row ids / storage keys (`shared`, `jobs`, `app-data-jobs`), or delete the `jobs` row as though it were a stray.
- `git revert` past `e666ca9` without first copying the `jobs` row's contents back into `shared.data.jobs` — older code doesn't know the row exists.

**Requires a deploy step — editing the file alone does nothing:**
- Any `supabase/functions/*/index.ts` change → `npx supabase functions deploy <name>` (repo is already CLI-linked).
- Changing the backup file shape in `scripts/backup-supabase.sh` → redeploy `manage-backups` in the same sitting, or restores break. Backup files hold both rows as `[{id,data},…]`; consumers must key off `.id`, **never** array position (rows come back id-ordered, so `jobs` precedes `shared`). Pre-split backups use the older `[{data}]` shape with no `id` key — both must keep working.

**Deliberate limits — don't "fix" these:**
- Site Accounts passwords sit in plaintext in the shared unauthenticated row; the masking is UI-only. A documented trade-off, not an oversight.
- Jobs auto-ghosting only flips `applied` → `ghosted` at 30 days, never `interviewing` — only one date is tracked, so it can't fairly judge a stalled interview.
