param(
  [string]$ProjectRoot = '',
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 5500
)

$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$frontend = Join-Path $ProjectRoot 'frontend'
$logDir = Join-Path $frontend 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Keep the static ERP interface independent from an interactive terminal.
# The server is read-only; a restart only restores the local web UI.
while ($true) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outLog = Join-Path $logDir "frontend-$stamp.out.log"
  $errLog = Join-Path $logDir "frontend-$stamp.err.log"
  Push-Location $frontend
  try {
    $env:OZON_FRONTEND_BIND_HOST = $BindHost
    $env:OZON_FRONTEND_PORT = [string]$Port
    & 'C:\Python314\python.exe' 'serve_threaded.py' 1>>$outLog 2>>$errLog
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  Add-Content -Path (Join-Path $logDir 'watchdog.log') -Value "$(Get-Date -Format o) frontend exited code=$exitCode; restarting in 3s"
  Start-Sleep -Seconds 3
}
