#!/usr/bin/env bash
# Run from the PROJECT ROOT (the folder that contains "supabase"):   bash scripts/check-setup.sh
bad=0
for f in supabase/functions/_shared/{lib,crypto,pay,sync,guards}.ts; do [ -f "$f" ] && echo "OK       $f" || { echo "MISSING  $f"; bad=1; }; done
for d in create-application cancel-application submit-application admin-register admin-delete admin-settings verify-payment payment-webhook upperlink-webhook sheet-sync admin-sync communication-worker document-issue student-document document-branding document-verify; do f="supabase/functions/$d/index.ts"; [ -f "$f" ] && echo "OK       $f" || { echo "MISSING  $f"; bad=1; }; done
n_expected=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l); last=$(ls supabase/migrations/*.sql 2>/dev/null | tail -1 | sed -E "s#.*/([0-9]{3})_.*#\1#"); [ "$((10#$last))" -eq "$n_expected" ] && echo "OK       $n_expected migrations, numbered 001-$last with no gaps" || { echo "PROBLEM  migrations are not contiguous (found $n_expected files, last is $last)"; bad=1; }
command -v supabase >/dev/null && echo "OK       Supabase CLI found" || { echo "MISSING  Supabase CLI"; bad=1; }
[ $bad -eq 0 ] && echo "Everything is in place. Next: bash scripts/deploy-functions.sh" || echo "Fix the MISSING lines above, then run this again."
