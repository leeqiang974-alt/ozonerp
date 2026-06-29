import { mapReasonCode } from "./reasonCodes.js";

let sentry = null;
let sentryEnabled = false;

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
  req.obs = {
    startTime: Date.now(),
    routeName: `${req.method} ${req.path}`,
    tags: {},
  };
  next();
}

export function captureException(error, context = {}) {
  if (!sentryEnabled || !sentry) return;
  sentry.captureException(error, {
    tags: context.tags || {},
    extra: context.extra || {},
  });
}

export function trackEvent(eventName, payload = {}) {
  const line = JSON.stringify({
    type: "biz_event",
    eventName,
    ...payload,
    ts: new Date().toISOString(),
  });
  console.log(line);
  if (sentryEnabled && sentry) {
    sentry.addBreadcrumb({
      category: "biz",
      level: "info",
      message: eventName,
      data: payload,
    });
  }
}

export function finalizeRequest(req, res, next) {
  if (!req.obs) return next();
  const durationMs = Date.now() - req.obs.startTime;
  const status = res.statusCode;
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
  res.status(error.status || 500).json({
    error: error.message,
    details: error.details,
    reasonCode,
  });
}

