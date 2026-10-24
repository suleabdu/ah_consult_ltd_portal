param([int]$Port = 8888)
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location (Join-Path $Root 'frontend')
Write-Host "AH STUDENT HUB local frontend: http://localhost:$Port"
python -m http.server $Port
