param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir

function Get-TargetProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and (
      $_.CommandLine -like "*src/server.js*" -or
      $_.CommandLine -like "*src/dailyDistributor.js*"
    )
  }
}

function Show-Status {
  $targets = Get-TargetProcesses
  if ($targets) {
    $targets | Select-Object ProcessId, CommandLine | Format-Table -AutoSize
  } else {
    Write-Output "No server/distributor process running."
  }
  $listen = netstat -ano | findstr LISTENING | findstr :5178
  if ($listen) { $listen } else { Write-Output "Port 5178 not listening." }
}

function Test-ServerReady {
  $server = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -like "*src/server.js*"
  }
  if (-not $server) { return $false }
  # Match the listener to the actual server PID.  A stale listener from an
  # unrelated process must not make startup look successful.
  $serverPids = @($server | ForEach-Object { [string]$_.ProcessId })
  $listenLines = @(netstat -ano | Select-String "LISTENING" | Select-String ":5178")
  $matchingListener = $listenLines | Where-Object {
    $parts = ([string]$_).Trim() -split "\s+"
    $serverPids -contains [string]$parts[-1]
  }
  if (-not $matchingListener) { return $false }
  # A bound socket alone is not enough: verify the unauthenticated liveness
  # route responds.  This remains liveness-only and does not claim business
  # readiness, Seller API connectivity, or durable persistence.
  try {
    $probe = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:5178/api/healthz"
    return $probe.StatusCode -eq 200 -and ([string]$probe.Content -match '"readiness"\s*:\s*"liveness_only"')
  } catch {
    return $false
  }
}

function Test-DurableDatabaseConfiguration {
  # The current JobRepository has a Supabase adapter only. A DATABASE_URL by
  # itself is a migration declaration, not a runtime backend, and would let
  # the launcher start with an unintended JSON fallback.
  $supabaseUrl = [string]$env:SUPABASE_URL
  $serviceRoleKey = [string]$env:SUPABASE_SERVICE_ROLE_KEY
  if ([string]::IsNullOrWhiteSpace($supabaseUrl) -or [string]::IsNullOrWhiteSpace($serviceRoleKey)) {
    return $false
  }
  $parsedSupabase = $null
  $validSupabase = [Uri]::TryCreate($supabaseUrl.Trim(), [UriKind]::Absolute, [ref]$parsedSupabase)
  return $validSupabase -and $parsedSupabase.Scheme -eq "https" -and -not [string]::IsNullOrWhiteSpace($parsedSupabase.Host)
}

function Assert-Started {
  # A child process can exit immediately after Start-Process (bad config, missing
  # migration, port collision). Do not report a successful start until the server
  # process and its listener are both observable.
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    if (Test-ServerReady) { return }
    Start-Sleep -Seconds 1
  }
  throw "Server did not become ready: verify node logs, port 5178, and startup configuration."
}

function Assert-NoExistingTargets {
  # Starting a second server/distributor from the launcher can create a port
  # collision or duplicate background polling before the new process fails.
  # Stop/status first so the operator gets an explicit recovery action rather
  # than a misleading partial start.
  $targets = @(Get-TargetProcesses)
  if ($targets.Count -gt 0) {
    $ids = ($targets | ForEach-Object { [string]$_.ProcessId }) -join ", "
    throw "Refusing to start: an ERP server/distributor is already running (PID $ids). Run ops.ps1 status or stop first."
  }
}

function Assert-StartupPrerequisites {
  $hostValue = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
  $loopback = @("127.0.0.1", "localhost", "::1") -contains $hostValue
  $authConfigured = -not [string]::IsNullOrWhiteSpace($env:OZON_ERP_AUTH_SECRET) -or -not [string]::IsNullOrWhiteSpace($env:AUTH_SECRET)
  $automationEnabled = $env:OZON_SERVER_AUTO_HEAL -eq "1" -or $env:OZON_DISTRIBUTOR_AUTORUN -eq "1"
  # Keep the operational launcher aligned with runtimeStartupDecision. This
  # explicit branch makes the dangerous combination visible in the launch
  # error (the general external-host check remains below for non-automation).
  if (-not $loopback -and $automationEnabled -and -not $authConfigured) {
    throw "Refusing to start: external automation requires OZON_ERP_AUTH_SECRET or AUTH_SECRET."
  }
  if (-not $loopback -and -not $authConfigured) {
    throw "Refusing to start: external HOST requires OZON_ERP_AUTH_SECRET or AUTH_SECRET."
  }
  # Session revocation is process-local until a shared epoch/revocation store
  # is implemented. The production preflight already requires an explicit
  # single-instance declaration; enforce the same boundary before spawning a
  # hidden external process so `ops.ps1 start` cannot bypass deployment safety.
  if (-not $loopback -and $env:OZON_ERP_AUTH_SINGLE_INSTANCE -ne "1") {
    throw "Refusing to start: external deployment requires OZON_ERP_AUTH_SINGLE_INSTANCE=1 until shared session revocation is configured."
  }
  $durableRequired = $env:OZON_REQUIRE_DURABLE_STORAGE -eq "1" -or $env:REQUIRE_DURABLE_STORAGE -eq "1"
  $databaseConfigured = Test-DurableDatabaseConfiguration
  if ($durableRequired -and -not $databaseConfigured) {
    throw "Refusing to start: durable storage is required; configure SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY (DATABASE_URL alone has no runtime adapter)."
  }
  $directWritesEnabled = $env:ENABLE_DIRECT_OZON_WRITES -eq "1"
  $adminConfigured = -not [string]::IsNullOrWhiteSpace($env:OZON_ERP_ADMIN_SECRET)
  # The server-side runtime gate requires the separate administrator secret
  # whenever direct writes are enabled, including loopback development. Keep
  # the script preflight aligned so it fails before spawning a hidden process
  # that would immediately exit with the same configuration error.
  if ($directWritesEnabled -and -not $adminConfigured) {
    throw "Refusing to start: direct writes require OZON_ERP_ADMIN_SECRET."
  }
  $storeScopeRequired = $env:OZON_ERP_REQUIRE_STORE_SCOPE -eq "1" -or $env:REQUIRE_STORE_SCOPE -eq "1"
  $allowedStoreIds = if ($env:OZON_ERP_ALLOWED_STORE_IDS) { $env:OZON_ERP_ALLOWED_STORE_IDS } else { $env:OZON_ERP_STORE_IDS }
  if ($storeScopeRequired -and [string]::IsNullOrWhiteSpace($allowedStoreIds)) {
    throw "Refusing to start: store scope is required; configure an explicit allowed store scope."
  }
  $principalScopeRequired = $env:OZON_ERP_REQUIRE_PRINCIPAL_SCOPE -eq "1"
  $principalStoreIds = $env:OZON_ERP_AUTH_STORE_IDS
  if (-not $loopback -and $principalScopeRequired -and [string]::IsNullOrWhiteSpace($principalStoreIds)) {
    throw "Refusing to start: external deployment requires OZON_ERP_AUTH_STORE_IDS when principal scope is required."
  }
}

switch ($Action) {
  "stop" {
    $targets = Get-TargetProcesses
    if ($targets) {
      $targets | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
      Write-Output ("Stopped " + $targets.Count + " process(es).")
    } else {
      Write-Output "Nothing to stop."
    }
    Show-Status
  }
  "start" {
    Assert-NoExistingTargets
    Assert-StartupPrerequisites
    Start-Process -FilePath node -ArgumentList "src/server.js" -WorkingDirectory $projectDir -WindowStyle Hidden
    Assert-Started
    # Do not launch the background distributor until the server has passed the
    # liveness probe.  If startup fails (bad config, port collision, migration
    # gate), no orphaned automation process should remain to confuse recovery.
    Start-Process -FilePath node -ArgumentList "src/dailyDistributor.js" -WorkingDirectory $projectDir -WindowStyle Hidden
    Write-Output "Started server + distributor."
    Show-Status
  }
  default {
    Show-Status
  }
}
