# Deploys every function. Run from the PROJECT ROOT after:  supabase login   and   supabase link --project-ref YOUR_REF
#   powershell -ExecutionPolicy Bypass -File .\scripts\deploy-functions.ps1
$open = 'admin-register','payment-webhook','upperlink-webhook','document-verify','document-branding'      # external providers call these; each handler must verify its provider signature or shared secret
$all  = 'create-application','cancel-application','submit-application','admin-register','admin-delete','admin-settings','verify-payment','payment-webhook','upperlink-webhook','sheet-sync','admin-sync','communication-worker','document-issue','student-document','document-branding','document-verify'
foreach ($f in $all) {
  Write-Host "`n=== Deploying $f ===" -ForegroundColor Cyan
  if ($open -contains $f) { supabase functions deploy $f --no-verify-jwt } else { supabase functions deploy $f }
  if ($LASTEXITCODE -ne 0) { Write-Host "`nFAILED on $f. If the message mentions Docker, start Docker Desktop (or update the CLI and add --use-api). Fix it, then run this script again." -ForegroundColor Red; exit 1 }
}
Write-Host "`nAll functions deployed." -ForegroundColor Green
