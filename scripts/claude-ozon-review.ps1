param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Task,

  [string]$Model = "sonnet",

  [string]$OutputPath = "",

  [switch]$Bare,

  [switch]$UseExistingAnthropicEnv
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $UseExistingAnthropicEnv) {
  $anthropicEnvNames = @(
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL"
  )
  foreach ($name in $anthropicEnvNames) {
    Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
  }
}

$authStatusRaw = & claude auth status --json 2>$null
try {
  $authStatus = $authStatusRaw | ConvertFrom-Json
} catch {
  $authStatus = $null
}

if (-not $authStatus -or -not $authStatus.loggedIn) {
  Write-Output "Claude Code is installed, but official OAuth is not logged in for this clean Ozon ERP environment."
  Write-Output "Open a normal PowerShell window, then run:"
  Write-Output "  cd `"$root`""
  Write-Output "  claude auth login"
  Write-Output "After login, rerun this script."
  exit 2
}

$prompt = @"
You are the Ozon ERP architecture and product reviewer.

Read CLAUDE.md first, then review this requested change before Codex implements it.

Return a concise implementation brief in Chinese with:
1. Business problem restatement.
2. Affected ERP module ownership boundary.
3. Safety gates that must not be bypassed.
4. Files likely to inspect or change.
5. Tests likely to add or run.
6. Acceptance criteria.
7. Risks or conflicts with existing project rules.

Requested change:
$Task
"@

$args = @("-p")

if ($Bare) {
  $args += "--bare"
}

$args += @(
  "--model", $Model,
  "--permission-mode", "plan",
  "--max-budget-usd", "1.00",
  $prompt
)

$result = & claude @args

if ($OutputPath -ne "") {
  $resolved = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
  } else {
    Join-Path $root $OutputPath
  }
  $dir = Split-Path -Parent $resolved
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force $dir | Out-Null
  }
  $result | Set-Content -Encoding UTF8 $resolved
}

$result
