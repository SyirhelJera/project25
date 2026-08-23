#!/usr/bin/env bash
# Daily snapshot of the app_data rows, uploaded to a private Supabase Storage
# bucket ("backups"). Uses the service_role key (passed in via env, kept only as a
# GitHub Actions secret — never committed) so it bypasses RLS entirely and doesn't
# depend on client-facing policies, and nothing sensitive ever touches this public repo.
#
# Four rows are backed up: "shared" (every tab's data), "jobs" (the Jobs tab), "notes" (the Notes
# outliner) and "scratch" (the hidden scratch page). The latter three have their own rows so they
# aren't re-uploaded on every unrelated save — see js/jobs.js, js/notes.js and js/scratch.js. The resulting file is an array of {id, data} objects;
# consumers MUST key off .id, never array position. Files written before those splits have fewer
# rows — or, oldest of all, the single-row shape [{"data":{...}}] with no "id" key at all — and
# supabase/functions/manage-backups/index.ts handles every one of those shapes.
#
# ANY row added here must also be read out in manage-backups/index.ts and applied by the restore
# path in js/backups.js, and that function redeployed in the same sitting. A row backed up but
# never restored is worse than not backing it up: it looks safe and isn't.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY env var must be set}"

SUPABASE_URL=$(sed -n "s/.*const SUPABASE_URL = '\([^']*\)'.*/\1/p" js/persistence.js | head -1)
if [[ -z "$SUPABASE_URL" ]]; then
  echo "Could not extract SUPABASE_URL from js/persistence.js" >&2
  exit 1
fi

DATE=$(date -u +%F)
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

HTTP_CODE=$(curl -sS -o "$TMP" -w '%{http_code}' \
  "$SUPABASE_URL/rest/v1/app_data?id=in.(shared,jobs,notes,scratch)&select=id,data&order=id.asc" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Fetch failed with HTTP $HTTP_CODE:" >&2
  cat "$TMP" >&2
  exit 1
fi

# An empty/missing row must never silently overwrite a real day's backup with nothing.
# The "shared" row is mandatory and must have non-null data (same strictness as before the splits).
# The "jobs", "notes" and "scratch" rows are each optional — absent is legitimate for an account that
# has never used that tab — but if one IS present, null data is an anomaly and fails just like the
# shared case.
if ! jq -e '
  type == "array"
  and ([.[] | select(.id=="shared")] | length == 1)
  and ([.[] | select(.id=="shared")][0].data != null)
  and ([.[] | select(.id=="jobs")] | length <= 1)
  and (([.[] | select(.id=="jobs")] | length == 0) or ([.[] | select(.id=="jobs")][0].data != null))
  and ([.[] | select(.id=="notes")] | length <= 1)
  and (([.[] | select(.id=="notes")] | length == 0) or ([.[] | select(.id=="notes")][0].data != null))
  and ([.[] | select(.id=="scratch")] | length <= 1)
  and (([.[] | select(.id=="scratch")] | length == 0) or ([.[] | select(.id=="scratch")][0].data != null))
' "$TMP" > /dev/null 2>&1; then
  echo "Response doesn't look like a real, non-empty row — refusing to upload:" >&2
  cat "$TMP" >&2
  exit 1
fi

UPLOAD_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$SUPABASE_URL/storage/v1/object/backups/$DATE.json" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  --data-binary "@$TMP")

if [[ "$UPLOAD_CODE" != "200" ]]; then
  echo "Upload to Storage failed with HTTP $UPLOAD_CODE" >&2
  exit 1
fi

echo "Backup uploaded: backups/$DATE.json (Supabase Storage, private bucket)"
