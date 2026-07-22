import { mapReasonCode } from "./reasonCodes.js";

let sentry = null;
let sentryEnabled = false;
const counters = {
  requests: 0,
  responses2xx: 0,
  responses4xx: 0,
  responses5xx: 0,
  errors: 0,
  events: 0,
};

// Observability is an untrusted boundary: errors and business events may carry
// an upstream response, credentials, or seller identifiers.  Keep this policy
// here so logs, Sentry breadcrumbs, and HTTP error summaries cannot diverge.
const SECRET_KEY = /(api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?secret|password|authorization|cookie|set-cookie|credential)/i;
const RAW_PAYLOAD_KEY = /^(raw|payload|body|request|response|details|headers|stack|cause)$/i;
const IDENTIFIER_KEY = /^(offer[_-]?id|sku|product[_-]?id|task[_-]?id)$/i;
const MAX_STRING = 240;
const MAX_DEPTH = 4;
const MAX_ITEMS = 40;

function scrubText(value) {
  let text = String(value);
  // Do not persist bearer/API credentials even when an upstream service puts
  // them in a human-readable error message.
  text = text.replace(/((?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?secret|password|authorization|cookie)\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]");
  text = text.replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]");
  text = text.replace(/((?:offer[_-]?id|sku|product[_-]?id|task[_-]?id)\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED_IDENTIFIER]");
  return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
}

export function sanitizeObservabilityValue(value, depth = 0) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return scrubText(value);
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => sanitizeObservabilityValue(item, depth + 1));
  if (typeof value !== "object") return String(value);
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS)) {
    if (SECRET_KEY.test(key) || RAW_PAYLOAD_KEY.test(key)) continue;
    if (IDENTIFIER_KEY.test(key)) {
      output[key] = "[REDACTED_IDENTIFIER]";
      continue;
    }
    output[scrubText(key)] = sanitizeObservabilityValue(item, depth + 1);
  }
  return output;
}

export function buildSafeErrorSummary(error = {}) {
  const status = Number(error.status || 0);
  const code = String(error.code || "").slice(0, 80);
  const message = scrubText(error.message || "Internal server error");
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(String(error.requestId || "")) ? String(error.requestId) : "";
  return {
    ...(status ? { status } : {}),
    ...(code ? { code } : {}),
    message,
    ...(requestId ? { requestId } : {}),
    ...(Number.isFinite(Number(error.attempts)) ? { attempts: Math.max(1, Math.min(20, Number(error.attempts))) } : {}),
  };
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

export async function initServerObservability() {
  const dsn = env("SENTRY_DSN", "");
  if (!dsn) return { enabled: false };
  try {
    const mod = await import("@sentry/node");
    sentry = mod;
    mod.init({
      dsn,
      environment: env("APP_ENV", process.env.NODE_ENV || "dev"),
      release: env("APP_RELEASE", "ozon-erp@local"),
      tracesSampleRate: Number(env("SENTRY_TRACES_SAMPLE_RATE", "0.2")),
    });
    sentryEnabled = true;
    return { enabled: true };
  } catch {
    sentryEnabled = false;
    return { enabled: false };
  }
}

export function requestContextMiddleware(req, _res, next) {
  counters.requests += 1;
  req.obs = {
    startTime: Date.now(),
    routeName: `${req.method} ${req.path}`,
    tags: {},
  };
  next();
}

export function captureException(error, context = {}) {
  if (!sentryEnabled || !sentry) return;
  const summary = buildSafeErrorSummary(error);
  const safeError = new Error(summary.message);
  safeError.name = String(error?.name || "Error").slice(0, 80);
  if (summary.code) safeError.code = summary.code;
  if (summary.status) safeError.status = summary.status;
  if (summary.requestId) safeError.requestId = summary.requestId;
  sentry.captureException(safeError, {
    tags: sanitizeObservabilityValue(context.tags || {}),
    extra: sanitizeObservabilityValue(context.extra || {}),
  });
}

export function trackEvent(eventName, payload = {}) {
  counters.events += 1;
  const line = JSON.stringify({
    type: "biz_event",
    eventName: scrubText(eventName),
    ...sanitizeObservabilityValue(payload),
    ts: new Date().toISOString(),
  });
  console.log(line);
  if (sentryEnabled && sentry) {
    sentry.addBreadcrumb({
      category: "biz",
      level: "info",
      message: eventName,
      data: sanitizeObservabilityValue(payload),
    });
  }
}

export function finalizeRequest(req, res, next) {
  if (!req.obs) return next();
  const durationMs = Date.now() - req.obs.startTime;
  const status = res.statusCode;
  if (status >= 500) counters.responses5xx += 1;
  else if (status >= 400) counters.responses4xx += 1;
  else counters.responses2xx += 1;
  if (sentryEnabled && sentry) {
    sentry.addBreadcrumb({
      category: "http",
      level: status >= 500 ? "error" : "info",
      message: req.obs.routeName,
      data: { status, durationMs },
    });
  }
  next();
}

export function errorHandler(error, req, res, _next) {
  counters.errors += 1;
  const reasonCode = mapReasonCode(error?.message || "");
  captureException(error, {
    tags: {
      route: req?.path || "",
      reasonCode,
    },
    extra: {
      method: req?.method,
      bodyKeys: req?.body && typeof req.body === "object" ? Object.keys(req.body).slice(0, 20) : [],
    },
  });
  // Never reflect upstream details/raw payloads to the browser.  The caller
  // gets a bounded summary and request id for support correlation only.
  const safeSummary = buildSafeErrorSummary({ ...error, code: error.code || reasonCode });
  res.status(error.status || 500).json({
    ...safeSummary,
    // Preserve the established HTTP contract while omitting upstream details.
    error: safeSummary.message,
    reasonCode,
  });
}

export function buildObservabilitySummary({ env = process.env, now = Date.now(), uptimeSeconds = process.uptime() } = {}) {
  const sentryConfigured = Boolean(String(env.SENTRY_DSN || "").trim());
  const errorRate = counters.requests ? counters.errors / counters.requests : 0;
  const alerts = [];
  if (counters.responses5xx > 0) alerts.push({ code: "HTTP_5XX_SEEN", severity: "high", nextAction: "检查最近错误与依赖服务，不自动重试写入" });
  if (counters.errors > 0 && errorRate >= 0.1) alerts.push({ code: "ERROR_RATE_HIGH", severity: "high", nextAction: "检查部署版本和依赖健康，不把摘要当作根因" });
  if (!sentryConfigured) alerts.push({ code: "SENTRY_NOT_CONFIGURED", severity: "info", nextAction: "生产环境配置错误采集后再进行告警演练" });
  return {
    ok: true,
    readOnly: true,
    instanceId: String(env.OZON_ERP_INSTANCE_ID || env.HOSTNAME || "local-instance").slice(0, 120),
    processId: process.pid,
    generatedAt: new Date(now).toISOString(),
    uptimeSeconds: Math.max(0, Number(uptimeSeconds || 0)),
    sentryConfigured,
    sentryEnabled,
    counters: { ...counters },
    errorRate,
    alerts,
    sideEffect: "仅返回当前进程的内存摘要；未发送告警、未执行自动修复、未暴露请求体。",
  };
}