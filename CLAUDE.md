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
  finance.js → fitness.js → valorant.js → clock.js → main.js
  ```
- All modules share one global `state` object (shape defined/defaulted in `core.js` / `persistence.js:applyLoadedState()`) and small globals (`el()`, `uid()`, `escapeHtml()`, date helpers). No modules, no per-file scoping, no virtual DOM — each tab's `render*()` rebuilds that section's `innerHTML` from `state` on every change, and `save()` runs after essentially every mutation.
- One file per feature tab (`goals.js`, `habits.js`, `finance.js`, `fitness.js`, `valorant.js`, `checklists.js`, `countdowns.js`, `mantras.js`, `clock.js`, `backups.js`, `insights.js`, `protecteddays.js`), each owning its own render function and DOM listeners — no central router.
- **Persistence** (`js/persistence.js`): inside Claude.ai uses `window.storage`; deployed elsewhere falls back to Supabase, writing to one shared unauthenticated row (`app_data`, `id='shared'`) with optimistic-concurrency conflict detection and a localStorage offline cache. See README's "Persistence — two modes, no auth" section before touching load/save logic.
- **Valorant tooling is intentionally local-only** (`scripts/valorant-*.mjs`, run on the user's own machine, not as a cloud/Edge Function) — this is a deliberate anti-fraud-detection workaround documented at length in the README ("Daily Valorant store check", "Getting the initial session"). Don't try to "fix" this by moving it back to a cloud function.

## Working conventions

- Images (goal/finance icons, fitness progress photos) are stored as Supabase Storage / Google Drive URLs in `state`, never as embedded base64 — keep new image-handling code consistent with that (`uploadCompressedImage()` in `core.js`).
- New fields on `state` should get defaults added in `persistence.js:applyLoadedState()` so old saved data upgrades in place — this repo does not use migration scripts.
- Gitignored local secrets: `scripts/.valorant-session.json`, `scripts/.valorant-local-token.json`, `scripts/.valorant-notify-config.json` — never commit these or print their contents.
