# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project 25 is a single-user personal dashboard (goals, habits, finance, fitness, Valorant stats,
checklists, countdowns, mantras) implemented as **one self-contained HTML file**: `index.html`
(~4000 lines — inline `<style>`, inline body markup, inline `<script>` IIFE). There is no build
step, no bundler, no package.json, no test suite, and no framework. Two external `<script>` tags
are loaded from CDNs: `xlsx.full.min.js` (SheetJS, for Excel export/import) and
`@supabase/supabase-js` (persistence).

Supporting pieces:
- `supabase/functions/suggest-subtasks/index.ts` — a Supabase Edge Function (Deno) that proxies
  "AI subtask suggestion" requests to the Anthropic API server-side.
- `scripts/backup-supabase.sh` + `.github/workflows/backup-supabase.yml` — a daily cron job that
  snapshots the shared data row into private Supabase Storage.

## Running / developing

There is no dev server, build, lint, or test command — this is intentional, not an oversight.

- **Run it**: open `index.html` directly in a browser (or serve it statically). All UI logic lives
  in the single inline `<script>` block starting around line 994.
- **Verify a change**: reload the file in a browser and click through the affected tab. There is no
  automated test suite, so manual verification in-browser is the only check available.
- **Edit the edge function locally**: `supabase/functions/suggest-subtasks/index.ts` is a Deno
  script; use the Supabase CLI (`supabase functions serve` / `supabase functions deploy
  suggest-subtasks`) if making changes, since there's no separate Node toolchain in this repo.
- **Backup script**: `scripts/backup-supabase.sh` requires `SUPABASE_SERVICE_ROLE_KEY` in the
  environment and `jq` installed; it scrapes `SUPABASE_URL` straight out of `index.html` via `sed`,
  so keep the `const SUPABASE_URL = '...'` line's exact quoting intact.

## Architecture (all inside `index.html`)

**Two supported runtime modes**, detected at load time (see `usingClaudeStorage` /
`supabaseConfigured` near line 1042):
1. **Inside Claude (claude.ai)** — uses the built-in `window.storage` API automatically.
2. **Deployed elsewhere (e.g. GitHub Pages)** — falls back to Supabase. There is **no login**;
   every visitor reads/writes the same shared row (`SHARED_ROW_ID = 'shared'` in the `app_data`
   table). Anyone with the link can view and edit all data.

**State**: a single in-memory `state` object (goals, habits, countdowns, mantras, checklists,
finance, fitness, valorant, profile, focus, darkMode) is the source of truth. All mutations go
through this object, followed by `save()` and a `render*()` call for the affected tab — there is no
reactive framework, so every mutating handler must explicitly re-render.

- `load()` fetches persisted JSON and hands it to `applyLoadedState()`, which merges in defaults
  for any field missing from older saved data (schema migrations happen inline here, not via a
  separate migration system — when adding a new state field, add its default-backfill logic here).
- `save()` is a no-op until `loadedOk` is true — this guards against a failed/ambiguous load
  clobbering real remote data with in-memory defaults. Preserve this guard when touching
  persistence code.
- `debouncedSave()` collapses rapid-fire writes (e.g. keystrokes) into one write after a pause;
  discrete actions (clicks, checkbox toggles, blur/change) call `save()` directly instead.
  `flushPendingSave()` runs on `beforeunload`/tab-hide so a debounced edit isn't lost.

**Tabs/views**: sidebar `.nav-item[data-tab="..."]` elements toggle `.view.active` sections in the
main pane. Each tab has a paired `render<Tab>()` function (`renderGoals`, `renderHabits`,
`renderFinance`, `renderFitness`, `renderValorant`, `renderChecklists`, `renderCountdowns`,
`renderMantras`, `renderSettings`, plus sub-renderers like `renderFinanceAccounts`,
`renderFinanceSubs`, `renderMoneyGoals`, `renderWeightLog`, `renderWeightChart`,
`renderValorantChart`). `renderAll()` re-renders every tab and is called once after `load()`
resolves. Each render function nukes and rebuilds its section's DOM from `state` — there's no
diffing, so keep render functions idempotent.

**External API integrations** (all client-side `fetch` calls, no server proxy except the AI one):
- `open.er-api.com` — live currency exchange rates for the Finance converter (user-triggered,
  rates are otherwise user-editable, not auto-refreshed).
- `api.henrikdev.xyz/valorant` (`HENRIK_BASE`) — Valorant match/MMR data, using a user-supplied API
  key stored in `state.valorant.apiKey`.
- `valorant-api.com/v1` (`VALORANT_API_BASE`) — public, keyless lookup for rank tier icons and
  agent data, cached in-memory via `valTierIconPromise`/`valAgentPromise` so it's fetched once.
- `supabase.functions.invoke('suggest-subtasks', ...)` — the only AI-backed feature. The Anthropic
  API key never reaches the browser; it's a Supabase secret used only inside the edge function.

## Key conventions to preserve

- **Single-file discipline**: this app is deliberately kept as one HTML file for easy
  copy/paste deployment (e.g. to GitHub Pages) with zero build step. Don't split it into modules
  or introduce a bundler/framework unless explicitly asked.
- **No user auth / shared-row model**: when touching persistence, remember every non-Claude
  deployment shares one row with no per-user isolation — don't add features that assume private
  per-user data without calling that out.
- **Secrets stay server-side**: the Anthropic API key and the Supabase service-role key must never
  be embedded in `index.html` or any client-reachable code — they live only as Supabase/GitHub
  Actions secrets, read via `Deno.env.get()` in the edge function or `env:` in the workflow. The
  `SUPABASE_ANON_KEY` in `index.html` is the public anon key and is expected to be there.
- **Cost guardrails on the AI feature**: `suggest-subtasks/index.ts` enforces `DAILY_LIMIT` (total
  calls/day, tracked in the `ai_usage` table) and `MAX_TOKENS` per call, and uses the cheapest
  Claude model (`claude-haiku-4-5-20251001`) for this simple task. Keep these guardrails if you
  extend the AI feature or add another one.
- **CSS custom properties for theming**: colors live in `:root` and are overridden under
  `body.dark-mode` (see top of `index.html`). Add new colors as variables in both blocks rather
  than hardcoding hex values in component rules.
- **Backfill-on-load migrations**: when adding a new field to any part of `state`, add its default
  in both the initial `state` literal (line ~1003) and in `applyLoadedState()` so existing saved
  data upgrades cleanly instead of crashing on `undefined`.
