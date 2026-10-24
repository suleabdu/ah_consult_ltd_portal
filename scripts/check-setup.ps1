# Run from the PROJECT ROOT (the folder that contains "supabase"):   powershell -ExecutionPolicy Bypass -File .\scripts\check-setup.ps1
$files = @('supabase/functions/_shared/lib.ts','supabase/functions/_shared/crypto.ts','supabase/functions/_shared/pay.ts','supabase/functions/_shared/sync.ts')
$fns = 'create-application','cancel-application','submit-application','admin-register','admin-delete','admin-settings','verify-payment','payment-webhook','upperlink-webhook','sheet-sync','sheet-review','admin-sync'
$fns | ForEach-Object { $files += "supabase/functions/$_/index.ts" }
(1..24) | ForEach-Object { $n = '{0:d3}' -f $_; if (-not (Get-ChildItem supabase/migrations -Filter "${n}_*.sql" -ErrorAction SilentlyContinue)) { $files += "supabase/migrations/${n}_*.sql" } }
$bad = $false
foreach ($f in $files) {
  if (Test-Path $f) { Write-Host "OK       $f" -ForegroundColor Green }
  else { Write-Host "MISSING  $f" -ForegroundColor Red; $bad = $true }
}
$cli = Get-Command supabase -ErrorAction SilentlyContinue
if ($cli) { Write-Host "OK       Supabase CLI found" -ForegroundColor Green } else { Write-Host "MISSING  Supabase CLI (install with Scoop or use npx supabase)" -ForegroundColor Red; $bad = $true }
if ($bad) { Write-Host "`nFix the MISSING lines above, then run this again." -ForegroundColor Yellow } else { Write-Host "`nEverything is in place. Next: scripts/deploy-functions.ps1" -ForegroundColor Green }
