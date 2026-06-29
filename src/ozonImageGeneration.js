import { resolveApiKeyForProvider } from "./llmListing.js";

const DEFAULT_APIMART_IMAGE_BASE_URL = "https://api.apib.ai/v1";
const DEFAULT_APIMART_IMAGE_MODEL = "gpt-image-2";

function cleanBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_APIMART_IMAGE_BASE_URL).replace(/\/$/, "");
}

function normalizeStringList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function pickTaskId(data) {
  return data?.data?.[0]?.task_id
    || data?.task_id
    || data?.id
    || data?.result?.task_id
    || "";
}

function extractImageUrls(data) {
  const images = Array.isArray(data?.result?.images) ? data.result.images : [];
  return images.flatMap((image) => normalizeStringList(image?.url));
}

export function imageGenerationConfig(options = {}) {
  const apiKey = options.apiKey ?? resolveApiKeyForProvider("apimart");
  return {
    provider: "apimart",
    enabled: Boolean(apiKey),
    baseUrl: cleanBaseUrl(
      options.baseUrl
        || process.env.APIMART_IMAGE_BASE_URL
        || process.env.APIB_IMAGE_BASE_URL
        || process.env.APIMART_BASE_URL
        || process.env.APIB_BASE_URL
        || DEFAULT_APIMART_IMAGE_BASE_URL,
    ),
    model: options.model
      || process.env.APIMART_IMAGE_MODEL
      || process.env.APIB_IMAGE_MODEL
      || DEFAULT_APIMART_IMAGE_MODEL,
  };
}

export function normalizeImageGenerationRequest(input = {}, options = {}) {
  const config = imageGenerationConfig(options);
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("prompt is required");

  const imageUrls = normalizeStringList(input.imageUrls || input.image_urls);
  const request = {
    model: input.model || config.model,
    prompt,
    n: Number(input.n || 1),
    size: String(input.size || "1:1").trim(),
    resolution: String(input.resolution || "1k").trim(),
  };
  if (imageUrls.length) request.image_urls = imageUrls.slice(0, 16);
  return request;
}

export async function submitGptImage2Generation(input = {}, options = {}) {
  const config = imageGenerationConfig(options);
  const apiKey = options.apiKey ?? resolveApiKeyForProvider("apimart");
  if (!apiKey) throw new Error("APIMart API key is not configured");
  const request = normalizeImageGenerationRequest(input, {
    ...options,
    model: options.model || input.model || config.model,
  });
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${config.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const text = await response.text?.() ?? "";
  const data = text ? parseJsonSafe(text) : await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || response.statusText || "image generation failed");
  }
  return {
    ok: true,
    provider: config.provider,
    model: request.model,
    taskId: pickTaskId(data),
    request,
    raw: data,
  };
}

export async function getImageGenerationTask(taskId, options = {}) {
  const id = String(taskId || "").trim();
  if (!id) throw new Error("taskId is required");
  const config = imageGenerationConfig(options);
  const apiKey = options.apiKey ?? resolveApiKeyForProvider("apimart");
  if (!apiKey) throw new Error("APIMart API key is not configured");
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${config.baseUrl}/tasks/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text?.() ?? "";
  const data = text ? parseJsonSafe(text) : await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || response.statusText || "image task query failed");
  }
  return {
    ok: true,
    provider: config.provider,
    taskId: data?.id || id,
    status: data?.status || "",
    progress: data?.progress ?? null,
    cost: data?.cost ?? null,
    creditsCost: data?.credits_cost ?? null,
    actualTime: data?.actual_time ?? null,
    estimatedTime: data?.estimated_time ?? null,
    imageUrls: extractImageUrls(data),
    raw: data,
  };
}
