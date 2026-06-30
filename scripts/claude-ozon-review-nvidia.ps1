param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Task,

  [string]$BaseUrl = "http://127.0.0.1:4000",

  [string]$Model = "nvidia-qwen-next",

  [int]$Port = 4000,

  [string]$ApiKeyFile = "D:\Desktop\api\nividiaapi.txt",

  [int]$TimeoutSeconds = 120,

  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-PortListening {
  param([int]$PortToCheck)
  return [bool](Get-NetTCPConnection -LocalPort $PortToCheck -State Listen -ErrorAction SilentlyContinue)
}

function Test-InvalidReviewOutput {
  param([object[]]$ReviewOutput)

  $text = ($ReviewOutput | Out-String).Trim()
  if ($text -eq "") {
    return $true
  }

  $invalidPatterns = @(
    "(?is)<\s*(function_calls|tool_call|tool_calls|invoke|antml:function_calls)\b",
    "(?is)</\s*(function_calls|tool_call|tool_calls|invoke|antml:function_calls)\s*>",
    "(?is)^\s*\{\s*`"(tool|tool_call|tool_calls|function_call)`"\s*:",
    "(?is)`"tool_calls`"\s*:\s*\[",
    "(?is)`"function_call`"\s*:\s*\{"
  )

  foreach ($pattern in $invalidPatterns) {
    if ($text -match $pattern) {
      return $true
    }
  }

  return $false
}

function Invoke-ClaudeNvidiaReview {
  param(
    [string]$PromptForReview,
    [int]$ReviewTimeoutSeconds
  )

  $job = Start-Job -ScriptBlock {
    param($ModelForJob, $PromptForJob)
    $claudeOutput = & claude -p --model $ModelForJob --tools "" --disable-slash-commands --permission-mode plan --max-budget-usd 1.00 $PromptForJob 2>&1
    [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = @($claudeOutput)
    }
  } -ArgumentList $Model, $PromptForReview

  if (-not (Wait-Job $job -Timeout $ReviewTimeoutSeconds)) {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    throw "Claude NVIDIA review timed out after $ReviewTimeoutSeconds seconds using model $Model. Check NVIDIA model health or pass -Model with a responsive LiteLLM alias."
  }

  $jobResult = Receive-Job $job
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  if ($jobResult.ExitCode -ne 0) {
    $errorText = ($jobResult.Output | Out-String).Trim()
    throw "Claude NVIDIA review failed with exit code $($jobResult.ExitCode): $errorText"
  }

  return $jobResult.Output
}

if (-not (Test-PortListening -PortToCheck $Port)) {
  Write-Output "Starting local NVIDIA LiteLLM gateway on 127.0.0.1:$Port ..."
  Start-Process `
    -FilePath "powershell" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      ".\scripts\start-nvidia-litellm.ps1",
      "-ApiKeyFile",
      $ApiKeyFile,
      "-Port",
      "$Port"
    ) `
    -WorkingDirectory $root `
    -WindowStyle Hidden | Out-Null

  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortListening -PortToCheck $Port) {
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-PortListening -PortToCheck $Port)) {
    throw "NVIDIA LiteLLM gateway did not start on port $Port."
  }
}

$env:ANTHROPIC_BASE_URL = $BaseUrl
$env:ANTHROPIC_AUTH_TOKEN = if ($env:LITELLM_MASTER_KEY) { $env:LITELLM_MASTER_KEY } else { "ozon-local-litellm" }
$env:ANTHROPIC_MODEL = $Model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = $Model
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $Model
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $Model

$prompt = @"
You are the Ozon ERP architecture and product reviewer.

You cannot use tools in this NVIDIA/LiteLLM review mode.
Do not output tool calls, XML-like tool call markers, JSON tool calls, or requests to read files.
Use only the project rules included below.

Project rules:
- Ozon ERP is a seller operating workbench, not a developer diagnostics page.
- Every screen must explain the business issue, cause, safe next action, and what happens after clicking.
- Module boundaries are strict:
  Dashboard = today/current product/risk/next action.
  Sourcing = 1688 source collection and candidate parsing.
  Listing = Ozon draft, category, attributes, title, description, images, pricing, preflight, submit gate.
  Workflow console = blocked nodes, diagnostics, field location, retry, source replacement, submit gates.
  Research/materials = Ozon reference, image style, guidance, image generation suggestions.
  Products = Ozon product list/status/price/anomalies.
  Warehouse = warehouse, stock read/write, stock failures.
  Orders = FBS order states.
  Promotions = Ozon promotions, promotion products, joinable products, removal from promotions only.
- If promotions shows listing fields such as category, description, listing title, collected product images, or attribute forms, treat it as a routing/content ownership bug.
- Never bypass Ozon preflight, explicit human confirmation, payload validation, workflow locks, paused states, waiting_human, browser human-verification pause, GPT/image cost confirmation, or blocked pricing risk.
- UI rule: title, ownership contract, task entry card, key business panel, then collapsed advanced content.
- Development rule: add/update focused tests first, implement scoped change, run targeted tests, npm test, npm run lint, then update SESSION_HANDOFF.

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

$result = Invoke-ClaudeNvidiaReview -PromptForReview $prompt -ReviewTimeoutSeconds $TimeoutSeconds
if (-not $result) {
  throw "Claude NVIDIA review returned no output using model $Model."
}

if (Test-InvalidReviewOutput -ReviewOutput $result) {
  Write-Output "Retrying Claude NVIDIA review with a stricter plain-text prompt because the first response was invalid."
  $strictPrompt = @"
Return plain Chinese text only.
Do not use tools, XML tags, JSON tool calls, markdown code fences, or requests to inspect files.
Start with one of: Critical, Important, OK.

$prompt
"@
  $result = Invoke-ClaudeNvidiaReview -PromptForReview $strictPrompt -ReviewTimeoutSeconds $TimeoutSeconds
}

if (Test-InvalidReviewOutput -ReviewOutput $result) {
  throw "Claude NVIDIA review returned invalid tool-call-like output using model $Model. Treat this review as failed and retry with another model alias or after model health recovers."
}

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
