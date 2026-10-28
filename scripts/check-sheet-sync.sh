#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_URL:?Set SUPABASE_URL to your project URL}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY to the public anon key}"
: "${ADMIN_ACCESS_TOKEN:?Set ADMIN_ACCESS_TOKEN to a current session access token for an approved administrator}"
case "$SUPABASE_URL" in https://*.supabase.co|http://127.0.0.1:54321|http://localhost:54321) ;; *) echo "Refusing unexpected SUPABASE_URL. Use your HTTPS Supabase project URL or local Supabase URL." >&2; exit 2;; esac
curl --fail-with-body --silent --show-error \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${ADMIN_ACCESS_TOKEN}" \
  "${SUPABASE_URL%/}/functions/v1/sheet-sync?check=1"
