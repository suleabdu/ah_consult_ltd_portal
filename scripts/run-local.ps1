param([int]$Port = 8888)
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Server = Join-Path $Root 'scripts/local_server.py'
Write-Host "AH STUDENT HUB local frontend: http://localhost:$Port"
Write-Host "Clean URLs enabled (for example /admin-dashboard and /apply)."
python $Server --port $Port
