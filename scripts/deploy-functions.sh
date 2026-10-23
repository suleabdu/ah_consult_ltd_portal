#!/usr/bin/env bash
# Deploys every function. Run from the PROJECT ROOT after:  supabase login  and  supabase link --project-ref YOUR_REF
for f in create-application cancel-application submit-application admin-register admin-delete admin-settings verify-payment payment-webhook upperlink-webhook sheet-sync sheet-review admin-sync; do
  echo; echo "=== Deploying $f ==="
  case "$f" in payment-webhook|upperlink-webhook|sheet-review) flag="--no-verify-jwt";; *) flag="";; esac
  supabase functions deploy "$f" $flag || { echo "FAILED on $f. If it mentions Docker, start Docker Desktop (or update the CLI and add --use-api). Fix it and run again."; exit 1; }
done
echo; echo "All functions deployed."
