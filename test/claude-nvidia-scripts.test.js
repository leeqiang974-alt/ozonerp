import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Claude NVIDIA review wrapper uses a responsive default model and starts LiteLLM", async () => {
  const [reviewScript, config] = await Promise.all([
    readFile(new URL("../scripts/claude-ozon-review-nvidia.ps1", import.meta.url), "utf8"),
    readFile(new URL("../config/litellm-nvidia.yaml", import.meta.url), "utf8"),
  ]);

  assert.match(reviewScript, /\[string\]\$Model\s*=\s*"nvidia-qwen-next"/);
  assert.match(reviewScript, /Test-PortListening/);
  assert.match(reviewScript, /start-nvidia-litellm\.ps1/);
  assert.match(reviewScript, /\[int\]\$TimeoutSeconds\s*=\s*120/);
  assert.match(reviewScript, /Test-InvalidReviewOutput/);
  assert.match(reviewScript, /Claude NVIDIA direct review failed/);
  assert.match(reviewScript, /Invoke-RestMethod/);
  assert.match(reviewScript, /chat\/completions/);
  assert.match(reviewScript, /UTF8Encoding/);
  assert.match(reviewScript, /Repair-MojibakeText/);
  assert.match(reviewScript, /returned invalid tool-call-like output/);
  assert.match(reviewScript, /Retrying Claude NVIDIA review with a stricter plain-text prompt/);
  assert.match(config, /model_name:\s*nvidia-qwen-next/);
  assert.match(config, /model:\s*openai\/qwen\/qwen3-next-80b-a3b-instruct/);
});

test("Claude NVIDIA review wrapper anchors reviews to current diff files", async () => {
  const reviewScript = await readFile(
    new URL("../scripts/claude-ozon-review-nvidia.ps1", import.meta.url),
    "utf8",
  );

  assert.match(reviewScript, /git diff --name-only/);
  assert.match(reviewScript, /\$changedFilesForPrompt/);
  assert.match(reviewScript, /Do not invent file paths/);
  assert.match(reviewScript, /Current changed files from local git/);
  assert.match(reviewScript, /Only reference files from the changed-file list/);
});

test("Claude NVIDIA review wrapper rejects one-word non-verdict output", async () => {
  const reviewScript = await readFile(
    new URL("../scripts/claude-ozon-review-nvidia.ps1", import.meta.url),
    "utf8",
  );

  assert.match(reviewScript, /OK\|Important\|Critical/);
  assert.match(reviewScript, /Length -lt 20/);
  assert.match(reviewScript, /too-short review output/);
  assert.match(reviewScript, /verdict-only review output/);
  assert.match(reviewScript, /Never return only Critical or Important/);
});

test("Claude NVIDIA review wrapper can save the actual prompt for debugging", async () => {
  const reviewScript = await readFile(
    new URL("../scripts/claude-ozon-review-nvidia.ps1", import.meta.url),
    "utf8",
  );

  assert.match(reviewScript, /\[string\]\$PromptOutputPath\s*=\s*""/);
  assert.match(reviewScript, /Write-ReviewTextFile/);
  assert.match(reviewScript, /PromptOutputPath/);
  assert.match(reviewScript, /Set-Content -Encoding UTF8/);
});

test("Claude NVIDIA review wrapper rejects responses that deny a non-empty changed-file list", async () => {
  const reviewScript = await readFile(
    new URL("../scripts/claude-ozon-review-nvidia.ps1", import.meta.url),
    "utf8",
  );

  assert.match(reviewScript, /Test-ContradictoryReviewOutput/);
  assert.match(reviewScript, /ChangedFileCount/);
  assert.match(reviewScript, /无变更文件列表/);
  assert.match(reviewScript, /未提供.*变更文件/);
  assert.match(reviewScript, /review contradicted the non-empty changed-file list/);
  assert.match(reviewScript, /The changed-file list is non-empty/);
});
