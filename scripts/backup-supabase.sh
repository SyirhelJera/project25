#!/usr/bin/env bash
# Daily snapshot of the shared app_data row, uploaded to a private Supabase Storage
# bucket ("backups"). Uses the service_role key (passed in via env, kept only as a
# GitHub Actions secret — never committed) so it bypasses RLS entirely and doesn't
# depend on client-facing policies, and nothing sensitive ever touches this public repo.
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
  "$SUPABASE_URL/rest/v1/app_data?id=eq.shared&select=data" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Fetch failed with HTTP $HTTP_CODE:" >&2
  cat "$TMP" >&2
  exit 1
fi

# An empty/missing row must never silently overwrite a real day's backup with nothing.
if ! jq -e 'type == "array" and length > 0 and .[0].data != null' "$TMP" > /dev/null 2>&1; then
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
