#!/usr/bin/env bash
# Run from the PROJECT ROOT (the folder that contains "supabase"):   bash scripts/check-setup.sh
bad=0
for f in supabase/functions/_shared/{lib,crypto,pay,sync}.ts; do [ -f "$f" ] && echo "OK       $f" || { echo "MISSING  $f"; bad=1; }; done
for d in create-application cancel-application submit-application admin-register admin-delete admin-settings verify-payment payment-webhook upperlink-webhook sheet-sync sheet-review admin-sync; do f="supabase/functions/$d/index.ts"; [ -f "$f" ] && echo "OK       $f" || { echo "MISSING  $f"; bad=1; }; done
for n in $(seq -w 1 24); do ls supabase/migrations/${n}_*.sql >/dev/null 2>&1 && echo "OK       migration $n" || { echo "MISSING  migration $n"; bad=1; }; done
command -v supabase >/dev/null && echo "OK       Supabase CLI found" || { echo "MISSING  Supabase CLI"; bad=1; }
[ $bad -eq 0 ] && echo "Everything is in place. Next: bash scripts/deploy-functions.sh" || echo "Fix the MISSING lines above, then run this again."
