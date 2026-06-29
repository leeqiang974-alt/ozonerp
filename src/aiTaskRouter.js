import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { llmConfig, resolveApiKeyForProvider } from "./llmListing.js";

const DATA_DIR = path.resolve("data");
const DEFAULT_CACHE_FILE = path.join(DATA_DIR, "ai-task-cache.json");
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TASK_TIMEOUT_MS || 12_000);
const CACHE_VERSION = "v1";
const LIGHT_TASKS = new Set([
  "translate_title",
  "match_candidate_basic",
  "error_classify",
  "listing_field_draft",
  "keyword_expand",
]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

async function readCache(cacheFile = DEFAULT_CACHE_FILE) {
  try {
    const data = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    return {};
  }
}

async function writeCache(cacheFile = DEFAULT_CACHE_FILE, cache = {}) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const tmp = `${cacheFile}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify(cache, null, 2);
  await fs.writeFile(tmp, payload, "utf8");
  try {
    await fs.rename(tmp, cacheFile);
  } catch {
    await fs.writeFile(cacheFile, payload, "utf8");
    try { await fs.unlink(tmp); } catch {}
  }
}

export function chooseProviderForTask(taskType, options = {}) {
  const forced = process.env[`AI_TASK_PROVIDER_${String(taskType || "").toUpperCase()}`] || process.env.AI_TASK_PROVIDER;
  if (forced) return { provider: forced };
  if (LIGHT_TASKS.has(String(taskType || "")) && options.hasDeepseekKey !== false) return { provider: "deepseek" };
  return { provider: llmConfig().provider };
}

function providerConfigForTask(taskType) {
  const base = llmConfig();
  const chosen = chooseProviderForTask(taskType, { hasDeepseekKey: Boolean(resolveApiKeyForProvider("deepseek")) });
  if (chosen.provider === base.provider) {
    return { ...base, apiKey: resolveApiKeyForProvider(base.provider) };
  }
  if (["apimart", "apib", "gpt5", "gpt-5"].includes(String(chosen.provider || "").toLowerCase())) {
    return {
      provider: "apimart",
      enabled: Boolean(resolveApiKeyForProvider("apimart")),
      baseUrl: process.env.APIMART_BASE_URL || process.env.APIB_BASE_URL || "https://api.apib.ai/v1",
      model: process.env.APIMART_MODEL || process.env.APIB_MODEL || process.env.GPT5_MODEL || "gpt-5-nano-2025-08-07",
      apiKey: resolveApiKeyForProvider("apimart"),
    };
  }
  if (chosen.provider === "deepseek") {
    return {
      provider: "deepseek",
      enabled: Boolean(resolveApiKeyForProvider("deepseek")),
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      apiKey: resolveApiKeyForProvider("deepseek"),
    };
  }
  return { ...base, apiKey: resolveApiKeyForProvider(base.provider) };
}

export function buildAiCacheKey(taskType, input, provider = {}) {
  const body = stableStringify({
    version: CACHE_VERSION,
    taskType,
    provider: provider.provider || "",
    model: provider.model || "",
    input,
  });
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function extractJsonPayload(text = "") {
  const value = String(text || "").trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ? fenced[1].trim() : value;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const json = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(json);
}

function parseChatCompletionText(raw = "") {
  const text = String(raw || "");
  if (!/^data:\s*/m.test(text)) {
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
  }
  const chunks = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, "").trim())
    .filter((line) => line && line !== "[DONE]");
  const parsed = [];
  for (const chunk of chunks) {
    try { parsed.push(JSON.parse(chunk)); } catch {}
  }
  const content = parsed.map((item) => item.choices?.[0]?.delta?.content || item.choices?.[0]?.message?.content || "").join("");
  const last = parsed[parsed.length - 1] || {};
  return {
    ...last,
    choices: [{ message: { content } }],
    stream: true,
    chunks: parsed.length,
  };
}

function modelTextFromResponse(data = {}) {
  if (typeof data.output_text === "string") return data.output_text;
  const outputText = (data.output || [])
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || part.output_text || "")
    .join("");
  return outputText || data.choices?.[0]?.message?.content || "";
}

export async function callAiTask(input = {}) {
  const taskType = String(input.taskType || "generic");
  const provider = input.providerConfig || providerConfigForTask(taskType);
  if (!provider.enabled) {
    return { ok: false, cached: false, provider: provider.provider, model: provider.model, error: `AI provider disabled: ${provider.provider}` };
  }

  const payload = {
    systemPrompt: input.systemPrompt || "",
    userPrompt: input.userPrompt || "",
    responseFormat: input.responseFormat || "text",
    temperature: Number(input.temperature ?? 0.1),
    maxTokens: Number(input.maxTokens || 1024),
  };
  const cacheKey = buildAiCacheKey(taskType, payload, provider);
  const cacheFile = input.cacheFile || DEFAULT_CACHE_FILE;
  const cache = input.disableCache ? {} : await readCache(cacheFile);
  if (!input.disableCache && cache[cacheKey]) {
    return { ...cache[cacheKey], cached: true };
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, Number(input.timeoutMs || DEFAULT_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    const fetchImpl = input.fetchImpl || fetch;
    const useResponsesApi = provider.provider === "apimart";
    response = await fetchImpl(provider.baseUrl.replace(/\/$/, "") + (useResponsesApi ? "/responses" : "/chat/completions"), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: "Bearer " + provider.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(useResponsesApi
        ? {
            model: provider.model,
            instructions: payload.systemPrompt || undefined,
            input: payload.userPrompt,
            max_output_tokens: Math.max(payload.maxTokens, 512),
            reasoning: { effort: "minimal" },
          }
        : {
            model: provider.model,
            temperature: payload.temperature,
            max_tokens: payload.maxTokens,
            ...(provider.provider === "bigmodel" ? { thinking: { type: "disabled" } } : {}),
            ...(provider.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
            ...(payload.responseFormat === "json" && provider.provider === "modelscope" ? { response_format: { type: "json_object" } } : {}),
            messages: [
              ...(payload.systemPrompt ? [{ role: "system", content: payload.systemPrompt }] : []),
              { role: "user", content: payload.userPrompt },
            ],
          }),
    });
  } catch (error) {
    return { ok: false, cached: false, provider: provider.provider, model: provider.model, error: error?.name === "AbortError" ? "AI 请求超时" : (error?.message || "AI 请求失败") };
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  const data = parseChatCompletionText(raw);
  if (!response.ok) {
    return { ok: false, cached: false, provider: provider.provider, model: provider.model, error: data?.error?.message || data?.message || response.statusText, raw: data };
  }

  const content = modelTextFromResponse(data);
  let result = {
    ok: true,
    cached: false,
    provider: provider.provider,
    model: provider.model,
    content,
    raw: data,
  };
  if (payload.responseFormat === "json") {
    try {
      result = { ...result, json: extractJsonPayload(content) };
    } catch (error) {
      result = { ok: false, cached: false, provider: provider.provider, model: provider.model, content, error: "AI JSON解析失败: " + error.message, raw: data };
    }
  }

  if (!input.disableCache && result.ok) {
    cache[cacheKey] = {
      ...result,
      taskType,
      cached: false,
      raw: undefined,
      cachedAt: new Date().toISOString(),
    };
    await writeCache(cacheFile, cache);
  }
  return result;
}

export async function getAiTaskCacheStats(cacheFile = DEFAULT_CACHE_FILE) {
  const cache = await readCache(cacheFile);
  const byTask = {};
  for (const entry of Object.values(cache)) {
    const taskType = String(entry?.taskType || "unknown");
    byTask[taskType] = Number(byTask[taskType] || 0) + 1;
  }
  return { entries: Object.keys(cache).length, byTask };
}
