param(
  [string]$Model = "nvidia-kimi-k2",

  [int]$Port = 4000,

  [string]$ApiKeyFile = "D:\Desktop\api\nividiaapi.txt",

  [string]$Prompt = "",

  [string]$PermissionMode = "plan",

  [decimal]$MaxBudgetUsd = 0.50,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ClaudeArgs
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-PortListening {
  param([int]$PortToCheck)
  return [bool](Get-NetTCPConnection -LocalPort $PortToCheck -State Listen -ErrorAction SilentlyContinue)
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

$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$Port"
$env:ANTHROPIC_AUTH_TOKEN = if ($env:LITELLM_MASTER_KEY) { $env:LITELLM_MASTER_KEY } else { "ozon-local-litellm" }
$env:ANTHROPIC_MODEL = $Model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = $Model
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $Model
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $Model

Write-Output "Claude Code is using NVIDIA via LiteLLM: $Model"
if ($Prompt -ne "") {
  $promptArgs = @(
    "-p",
    "--model",
    $Model,
    "--tools",
    "",
    "--disable-slash-commands",
    "--permission-mode",
    $PermissionMode,
    "--max-budget-usd",
    "$MaxBudgetUsd",
    $Prompt
  )
  & claude @promptArgs
} else {
  & claude @ClaudeArgs
}
