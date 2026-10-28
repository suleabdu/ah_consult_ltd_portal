$ErrorActionPreference = 'Stop'
if (-not $env:SUPABASE_URL) { throw 'Set SUPABASE_URL to your Supabase project URL.' }
if (-not $env:SUPABASE_ANON_KEY) { throw 'Set SUPABASE_ANON_KEY to your public anon key.' }
if (-not $env:ADMIN_ACCESS_TOKEN) { throw 'Set ADMIN_ACCESS_TOKEN to a current session access token for an approved administrator.' }
if ($env:SUPABASE_URL -notmatch '^https://[^/]+\.supabase\.co/?$' -and $env:SUPABASE_URL -notmatch '^http://(localhost|127\.0\.0\.1):54321/?$') {
  throw 'Refusing unexpected SUPABASE_URL. Use your HTTPS Supabase project URL or local Supabase URL.'
}
$headers = @{
  apikey = $env:SUPABASE_ANON_KEY
  Authorization = "Bearer $($env:ADMIN_ACCESS_TOKEN)"
}
$uri = $env:SUPABASE_URL.TrimEnd('/') + '/functions/v1/sheet-sync?check=1'
Invoke-RestMethod -Uri $uri -Method Get -Headers $headers | ConvertTo-Json -Depth 8
