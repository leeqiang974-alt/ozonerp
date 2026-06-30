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
  assert.match(config, /model_name:\s*nvidia-qwen-next/);
  assert.match(config, /model:\s*openai\/qwen\/qwen3-next-80b-a3b-instruct/);
});
