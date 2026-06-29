param(
  [int]$Port = 4000,

  [string]$ApiKeyFile = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($ApiKeyFile -ne "") {
  if (-not (Test-Path -LiteralPath $ApiKeyFile)) {
    Write-Output "NVIDIA API key file not found: $ApiKeyFile"
    exit 2
  }
  $rawKeyText = Get-Content -Raw -LiteralPath $ApiKeyFile
  $match = [regex]::Match($rawKeyText, "nvapi-[A-Za-z0-9_\-]+")
  if (-not $match.Success) {
    Write-Output "No nvapi-* key was found in: $ApiKeyFile"
    exit 2
  }
  $env:NVIDIA_API_KEY = $match.Value
}

if (-not $env:NVIDIA_API_KEY) {
  Write-Output "NVIDIA_API_KEY is missing."
  Write-Output "Create an API key on https://build.nvidia.com/models, then set it in this PowerShell session:"
  Write-Output '  $env:NVIDIA_API_KEY="nvapi-..."'
  exit 2
}

if (-not $env:LITELLM_MASTER_KEY) {
  $env:LITELLM_MASTER_KEY = "ozon-local-litellm"
}

$env:LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES = "true"

litellm --config .\config\litellm-nvidia.yaml --host 127.0.0.1 --port $Port
