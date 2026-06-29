import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { llmConfig, resolveApiKeyForProvider } from "../src/llmListing.js";
import {
  buildAiCacheKey,
  callAiTask,
  chooseProviderForTask,
  extractJsonPayload,
} from "../src/aiTaskRouter.js";

test("chooseProviderForTask routes repetitive tasks to deepseek by default", () => {
  assert.equal(chooseProviderForTask("translate_title", { hasDeepseekKey: true }).provider, "deepseek");
  assert.equal(chooseProviderForTask("match_candidate_basic", { hasDeepseekKey: true }).provider, "deepseek");
});

test("buildAiCacheKey is stable for equivalent object input", () => {
  const a = buildAiCacheKey("translate_title", { b: 2, a: 1 }, { provider: "deepseek", model: "deepseek-chat" });
  const b = buildAiCacheKey("translate_title", { a: 1, b: 2 }, { provider: "deepseek", model: "deepseek-chat" });
  assert.equal(a, b);
});

test("extractJsonPayload strips fenced JSON", () => {
  assert.deepEqual(extractJsonPayload("```json\n{\"ok\":true}\n```"), { ok: true });
});

test("llmConfig supports APIMart GPT-5 compatible key files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apimart-key-"));
  const keyFile = path.join(dir, "apid-api.txt");
  const oldEnv = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    APIMART_API_KEY_FILE: process.env.APIMART_API_KEY_FILE,
    APIMART_API_KEY: process.env.APIMART_API_KEY,
    APIB_API_KEY: process.env.APIB_API_KEY,
    GPT5_API_KEY: process.env.GPT5_API_KEY,
    APIMART_MODEL: process.env.APIMART_MODEL,
  };
  try {
    await writeFile(keyFile, "google_75073's initial token\nsk-test-apimart-key\n", "utf8");
    process.env.AI_PROVIDER = "apib";
    process.env.APIMART_API_KEY_FILE = keyFile;
    delete process.env.APIMART_API_KEY;
    delete process.env.APIB_API_KEY;
    delete process.env.GPT5_API_KEY;
    delete process.env.APIMART_MODEL;

    const config = llmConfig();
    assert.equal(config.provider, "apimart");
    assert.equal(config.enabled, true);
    assert.equal(config.baseUrl, "https://api.apib.ai/v1");
    assert.equal(config.model, "gpt-5-nano-2025-08-07");
    assert.equal(resolveApiKeyForProvider("gpt5"), "sk-test-apimart-key");
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("callAiTask caches successful task responses", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ai-cache-"));
  const cacheFile = path.join(dir, "cache.json");
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      statusText: "OK",
      text: async () => JSON.stringify({ choices: [{ message: { content: "{\"keyword\":\"宠物碗\"}" } }] }),
    };
  };

  const first = await callAiTask({
    taskType: "translate_title",
    systemPrompt: "sys",
    userPrompt: "user",
    responseFormat: "json",
    cacheFile,
    fetchImpl,
    providerConfig: {
      provider: "deepseek",
      enabled: true,
      baseUrl: "https://example.test",
      model: "deepseek-chat",
      apiKey: "k",
    },
  });
  const second = await callAiTask({
    taskType: "translate_title",
    systemPrompt: "sys",
    userPrompt: "user",
    responseFormat: "json",
    cacheFile,
    fetchImpl,
    providerConfig: {
      provider: "deepseek",
      enabled: true,
      baseUrl: "https://example.test",
      model: "deepseek-chat",
      apiKey: "k",
    },
  });

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.deepEqual(second.json, { keyword: "宠物碗" });
  await rm(dir, { recursive: true, force: true });
});

test("callAiTask uses Responses API for APIMart provider", async () => {
  let requestedUrl = "";
  let requestedBody = null;
  const result = await callAiTask({
    taskType: "product_intelligence",
    systemPrompt: "sys",
    userPrompt: "user",
    responseFormat: "json",
    disableCache: true,
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      requestedBody = JSON.parse(options.body);
      return {
        ok: true,
        statusText: "OK",
        text: async () => JSON.stringify({
          output: [
            { type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] },
          ],
        }),
      };
    },
    providerConfig: {
      provider: "apimart",
      enabled: true,
      baseUrl: "https://api.apib.ai/v1",
      model: "gpt-5-nano-2025-08-07",
      apiKey: "k",
    },
  });

  assert.equal(requestedUrl, "https://api.apib.ai/v1/responses");
  assert.equal(requestedBody.model, "gpt-5-nano-2025-08-07");
  assert.equal(requestedBody.instructions, "sys");
  assert.equal(requestedBody.input, "user");
  assert.equal(requestedBody.max_output_tokens, 1024);
  assert.deepEqual(requestedBody.reasoning, { effort: "minimal" });
  assert.deepEqual(result.json, { ok: true });
});
