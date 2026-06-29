param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Task,

  [string]$BaseUrl = "http://127.0.0.1:4000",

  [string]$Model = "nvidia-kimi-k2",

  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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

$result = & claude -p --model $Model --tools "" --disable-slash-commands --permission-mode plan --max-budget-usd 1.00 $prompt

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
