param(
  [string]$ProjectRoot = '',
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 8000,
  [string]$EnableBackgroundWrites = '0'
)

$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$backend = Join-Path $ProjectRoot 'backend'
$logDir = Join-Path $backend 'logs'
$venvPython = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
$python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { 'C:\Python314\python.exe' }
if (-not (Test-Path -LiteralPath $python)) {
  throw "Python executable was not found. Checked project virtual environment and $python"
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# A watchdog restart must never silently re-enable Ozon external write workers.
# Operators opt in through the scheduled-task argument only after a read-only
# verification has completed.
$env:OZON_ENABLE_BACKGROUND_WRITES = $EnableBackgroundWrites
# The process runs from backend/ below, so a relative secret path would create
# or read backend/.local-secrets instead of the project-wide key used by the
# migrated PostgreSQL credentials.
$env:ERP_LOCAL_SECRET_KEY_PATH = Join-Path $ProjectRoot '.local-secrets\credential-fernet.key'

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
    & $python -m uvicorn app.main:app --host $BindHost --port $Port --workers 1 1>>$outLog 2>>$errLog
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  Add-Content -Path (Join-Path $logDir 'watchdog.log') -Value "$(Get-Date -Format o) uvicorn exited code=$exitCode; restarting in 3s"
  Start-Sleep -Seconds 3
}
