param(
  [string]$ProjectRoot = '',
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 8000
)

$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$backend = Join-Path $ProjectRoot 'backend'
$logDir = Join-Path $backend 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Keep the API independent from an interactive terminal. If uvicorn exits,
# record the exit and restart after a short backoff. A restart never submits
# products itself; FastAPI startup only recovers persisted rows and the batch
# worker remains idempotent on Ozon task_id.
while ($true) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outLog = Join-Path $logDir "backend-$stamp.out.log"
  $errLog = Join-Path $logDir "backend-$stamp.err.log"
  Push-Location $backend
  try {
    & 'C:\Python314\python.exe' -m uvicorn app.main:app --host $BindHost --port $Port --workers 1 1>>$outLog 2>>$errLog
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  Add-Content -Path (Join-Path $logDir 'watchdog.log') -Value "$(Get-Date -Format o) uvicorn exited code=$exitCode; restarting in 3s"
  Start-Sleep -Seconds 3
}
