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
    Start-Process -FilePath node -ArgumentList "src/server.js" -WorkingDirectory $projectDir -WindowStyle Hidden
    Start-Sleep -Seconds 1
    Start-Process -FilePath node -ArgumentList "src/dailyDistributor.js" -WorkingDirectory $projectDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
    Write-Output "Started server + distributor."
    Show-Status
  }
  default {
    Show-Status
  }
}

