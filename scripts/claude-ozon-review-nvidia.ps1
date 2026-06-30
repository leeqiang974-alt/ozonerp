param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Task,

  [string]$BaseUrl = "http://127.0.0.1:4000",

  [string]$Model = "nvidia-qwen-next",

  [int]$Port = 4000,

  [string]$ApiKeyFile = "D:\Desktop\api\nividiaapi.txt",

  [int]$TimeoutSeconds = 120,

  [string]$OutputPath = "",

  [string]$PromptOutputPath = ""
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

  $hasVerdictPrefix = $text -match "^(OK|Important|Critical)\b"
  if ($text -match "^(Important|Critical)\s*$") {
    return $true # verdict-only review output
  }

  if (-not $hasVerdictPrefix -and $text.Length -lt 20) {
    return $true # too-short review output
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

function Test-ContradictoryReviewOutput {
  param(
    [object[]]$ReviewOutput,
    [int]$ChangedFileCount
  )

  if ($ChangedFileCount -le 0) {
    return $false
  }

  $text = ($ReviewOutput | Out-String).Trim()
  return $text -match "(?is)无变更文件列表|无变更文件|没有变更文件|未提供.*变更文件|请提供.*变更文件|no changed files|no local changed files|empty changed-file list"
}

function Repair-MojibakeText {
  param([string]$Text)

  if (-not $Text -or $Text -notmatch "[ÃÂ]|[åæç][\u0080-\u00BF]") {
    return $Text
  }

  $chars = $Text.ToCharArray()
  $bytes = New-Object byte[] $chars.Length
  for ($i = 0; $i -lt $chars.Length; $i++) {
    $code = [int][char]$chars[$i]
    if ($code -gt 255) {
      return $Text
    }
    $bytes[$i] = [byte]$code
  }

  try {
    return [System.Text.Encoding]::UTF8.GetString($bytes)
  } catch {
    return $Text
  }
}

function Invoke-ClaudeNvidiaReview {
  param(
    [string]$PromptForReview,
    [int]$ReviewTimeoutSeconds
  )

  $job = Start-Job -ScriptBlock {
    param($BaseUrlForJob, $ModelForJob, $AuthTokenForJob, $PromptForJob)
    $bodyObject = @{
      model = $ModelForJob
      messages = @(
        @{
          role = "user"
          content = $PromptForJob
        }
      )
      temperature = 0.1
      max_tokens = 1800
    }
    $body = $bodyObject | ConvertTo-Json -Depth 8
    $bodyBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($body)
    $headers = @{
      Authorization = "Bearer $AuthTokenForJob"
    }
    $response = Invoke-RestMethod `
      -Uri "$BaseUrlForJob/v1/chat/completions" `
      -Method Post `
      -Headers $headers `
      -ContentType "application/json; charset=utf-8" `
      -Body $bodyBytes
    return $response.choices[0].message.content
  } -ArgumentList $BaseUrl, $Model, $env:ANTHROPIC_AUTH_TOKEN, $PromptForReview

  if (-not (Wait-Job $job -Timeout $ReviewTimeoutSeconds)) {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    throw "Claude NVIDIA review timed out after $ReviewTimeoutSeconds seconds using model $Model. Check NVIDIA model health or pass -Model with a responsive LiteLLM alias."
  }

  try {
    $jobResult = Receive-Job $job -ErrorAction Stop
  } catch {
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    throw "Claude NVIDIA direct review failed using model ${Model}: $($_.Exception.Message)"
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  return @(Repair-MojibakeText -Text (($jobResult | Out-String).Trim()))
}

function Write-ReviewTextFile {
  param(
    [string]$Path,
    [object[]]$Content
  )

  if ($Path -eq "") {
    return
  }

  $resolved = if ([System.IO.Path]::IsPathRooted($Path)) {
    $Path
  } else {
    Join-Path $root $Path
  }
  $dir = Split-Path -Parent $resolved
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force $dir | Out-Null
  }
  $Content | Set-Content -Encoding UTF8 $resolved
}

function Get-ChangedFilesForPrompt {
  $files = @()
  $files += @(git diff --name-only -- 2>$null)
  $files += @(git diff --cached --name-only -- 2>$null)
  $files += @(git ls-files --others --exclude-standard 2>$null)

  return @($files |
    Where-Object { $_ -and $_.Trim() -ne "" } |
    Sort-Object -Unique)
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

$changedFiles = Get-ChangedFilesForPrompt
$changedFilesForPrompt = if ($changedFiles.Count -gt 0) {
  ($changedFiles | ForEach-Object { "- $_" }) -join "`n"
} else {
  "- No local changed files detected."
}

$prompt = @"
You are the Ozon ERP architecture and product reviewer.

You cannot use tools in this NVIDIA/LiteLLM review mode.
Do not output tool calls, XML-like tool call markers, JSON tool calls, or requests to read files.
Use only the project rules included below.
Do not invent file paths.
Only reference files from the changed-file list below, or files explicitly named in the project rules or requested change.
If you are unsure which file owns an issue, say "current diff" or "relevant module file" instead of naming a guessed path.

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

Current changed files from local git:
$changedFilesForPrompt

Return a concise implementation brief in Chinese with:
1. Business problem restatement.
2. Affected ERP module ownership boundary.
3. Safety gates that must not be bypassed.
4. Files from the changed-file list to inspect or change; do not invent file paths.
5. Tests likely to add or run.
6. Acceptance criteria.
7. Risks or conflicts with existing project rules.

Requested change:
$Task
"@

Write-ReviewTextFile -Path $PromptOutputPath -Content @($prompt)

$result = Invoke-ClaudeNvidiaReview -PromptForReview $prompt -ReviewTimeoutSeconds $TimeoutSeconds
if (-not $result) {
  throw "Claude NVIDIA review returned no output using model $Model."
}

$firstReviewInvalid = (Test-InvalidReviewOutput -ReviewOutput $result) -or (Test-ContradictoryReviewOutput -ReviewOutput $result -ChangedFileCount $changedFiles.Count)
if ($firstReviewInvalid) {
  Write-Output "Retrying Claude NVIDIA review with a stricter plain-text prompt because the first response was invalid."
  $strictPrompt = @"
Return plain Chinese text only.
Do not use tools, XML tags, JSON tool calls, markdown code fences, or requests to inspect files.
Start with one of: Critical, Important, OK.
Never return only Critical or Important; include a concrete reason grounded in the changed-file list or project rules.
The changed-file list is non-empty when it contains bullet paths; never say there are no changed files if bullet paths are present below.

$prompt
"@
  $result = Invoke-ClaudeNvidiaReview -PromptForReview $strictPrompt -ReviewTimeoutSeconds $TimeoutSeconds
}

if (Test-InvalidReviewOutput -ReviewOutput $result) {
  throw "Claude NVIDIA review returned invalid tool-call-like output using model $Model. Treat this review as failed and retry with another model alias or after model health recovers."
}

if (Test-ContradictoryReviewOutput -ReviewOutput $result -ChangedFileCount $changedFiles.Count) {
  throw "Claude NVIDIA review contradicted the non-empty changed-file list using model $Model. Treat this review as failed and retry with another model alias or inspect the saved prompt with -PromptOutputPath."
}

Write-ReviewTextFile -Path $OutputPath -Content $result

$result
