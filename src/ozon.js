import { OZON_API_BASE } from "./config.js";

const OZON_REQUEST_TIMEOUT_MS = Number(process.env.OZON_REQUEST_TIMEOUT_MS || 30_000);
const OZON_THROTTLE_MS = Number(process.env.OZON_THROTTLE_MS || 40);
const throttleTails = new Map();
const lastRequestAt = new Map();

// Seller API uses POST for many read operations, but HTTP method alone is not
// enough evidence that replaying a request is safe.  Keep this list narrow and
// explicit: callers may opt into retrySafe only for endpoints that are known to
// be read-only in the current local API evidence matrix.  Write endpoints must
// never become retryable merely because a caller passed retrySafe=true.
export const RETRY_SAFE_POST_READ_ENDPOINTS = new Set([
  "/v1/product/import/info",
  "/v2/warehouse/list",
  "/v3/posting/fbs/list",
  "/v3/posting/fbs/unfulfilled/list",
  "/v4/posting/fbs/list",
  "/v4/posting/fbs/unfulfilled/list",
  "/v3/product/list",
  "/v3/product/info/list",
  "/v4/product/info/prices",
  "/v4/product/info/stocks",
  "/v1/actions/products",
  "/v1/actions/candidates",
]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dependencyOptions(options = {}) {
  return {
    fetch: options.fetch || globalThis.fetch,
    sleep: options.sleep || defaultSleep,
    now: options.now || Date.now,
    random: options.random || Math.random,
    throttleMs: Math.max(0, Number(options.throttleMs ?? OZON_THROTTLE_MS)),
    timeoutMs: Math.max(1_000, Number(options.timeoutMs ?? OZON_REQUEST_TIMEOUT_MS)),
    maxRetries: Math.max(0, Number(options.maxRetries ?? 2)),
  };
}

function endpointThrottleKey(store = {}, path = "") {
  return `${String(store.clientId || store.id || "unknown")}:${String(path)}`;
}

async function throttle(store, path, deps) {
  if (!deps.throttleMs) return;
  const key = endpointThrottleKey(store, path);
  const previous = throttleTails.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  throttleTails.set(key, tail);
  await previous;
  try {
    if (lastRequestAt.has(key)) {
      const waitMs = deps.throttleMs - (deps.now() - lastRequestAt.get(key));
      if (waitMs > 0) await deps.sleep(waitMs);
    }
    lastRequestAt.set(key, deps.now());
  } finally {
    release();
    if (throttleTails.get(key) === tail) throttleTails.delete(key);
  }
}

function requestIdFrom(response) {
  return response?.headers?.get?.("x-request-id")
    || response?.headers?.get?.("x-o3-trace-id")
    || response?.headers?.get?.("request-id")
    || "";
}

function parseRetryAfter(response, now) {
  const value = String(response?.headers?.get?.("retry-after") || "").trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - now()) : null;
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

function backoffMs(attempt, random) {
  const base = Math.min(5_000, 250 * (2 ** Math.max(0, attempt - 1)));
  return Math.round(base + base * 0.25 * random());
}

function enrichError(error, { status = 0, details = null, requestId = "", attempts = 1 } = {}) {
  error.status = Number(status || error.status || 0);
  error.details = details ?? error.details ?? null;
  error.requestId = String(requestId || error.requestId || "");
  error.attempts = attempts;
  return error;
}

async function executeRequest(store, path, body, method, options = {}) {
  const deps = dependencyOptions(options);
  const retrySafeRequested = options.retrySafe === true;
  if (method === "POST" && retrySafeRequested && !RETRY_SAFE_POST_READ_ENDPOINTS.has(String(path))) {
    const error = new Error(`Ozon retrySafe is not allowlisted for POST endpoint: ${path}`);
    error.code = "OZON_RETRY_SAFE_ENDPOINT_NOT_ALLOWLISTED";
    error.path = String(path);
    error.method = method;
    throw error;
  }
  const retryAllowed = method === "GET" || (method === "POST" && retrySafeRequested);
  const maxAttempts = 1 + (retryAllowed ? deps.maxRetries : 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await throttle(store, path, deps);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    let response;
    try {
      response = await deps.fetch(`${OZON_API_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Client-Id": store.clientId,
          "Api-Key": store.apiKey,
          "Content-Type": "application/json",
        },
        ...(method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
      });
    } catch (cause) {
      clearTimeout(timer);
      const timeout = cause?.name === "AbortError";
      const error = enrichError(new Error(timeout ? `Ozon request timeout: ${path}` : (cause?.message || "Ozon request failed"), { cause }), {
        attempts: attempt,
      });
      if (retryAllowed && attempt < maxAttempts) {
        await deps.sleep(backoffMs(attempt, deps.random));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (response.ok) return data;

    const requestId = requestIdFrom(response);
    const message = data?.message || data?.error || response.statusText;
    const error = enrichError(new Error(`Ozon ${response.status}: ${message}`), {
      status: response.status,
      details: data,
      requestId,
      attempts: attempt,
    });
    if (retryAllowed && retryableStatus(response.status) && attempt < maxAttempts) {
      const retryAfterMs = parseRetryAfter(response, deps.now);
      await deps.sleep(retryAfterMs ?? backoffMs(attempt, deps.random));
      continue;
    }
    throw error;
  }
  throw new Error("Ozon request failed");
}

export async function ozonRequest(store, path, body = {}, options = {}) {
  return executeRequest(store, path, body, "POST", options);
}

export async function ozonGetRequest(store, path, options = {}) {
  return executeRequest(store, path, null, "GET", options);
}

export function defaultFbsDateRange() {
  const to = new Date();
  const since = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  return {
    since: since.toISOString(),
    to: to.toISOString(),
  };
}
