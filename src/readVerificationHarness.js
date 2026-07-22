import { createHash } from "node:crypto";

// Seller API read operations are commonly POST endpoints (the request carries
// filters/pagination in JSON).  Method alone is therefore not a safety gate:
// keep the endpoint allowlist authoritative and reject every unlisted path.
export const READ_ENDPOINTS = new Set([
  // Category/type and attribute dictionaries are read-only evidence used by
  // the 1688 -> Ozon listing path.  Keep them in the same allowlist as the
  // operator receipt pipeline so a category read cannot disappear into a
  // cache-only side channel.
  "/v1/description-category/tree",
  "/v1/description-category/attribute",
  "/v1/description-category/attribute/values",
  "/v3/product/list",
  "/v3/product/info/list",
  "/v1/product/import/info",
  "/v4/product/info/stocks",
  "/v2/warehouse/list",
  // v3 FBS list paths remain accepted only for deprecated-plan compatibility;
  // new plans must use the v4 operations below.
  "/v3/posting/fbs/list",
  "/v3/posting/fbs/unfulfilled/list",
  "/v4/posting/fbs/list",
  "/v4/posting/fbs/unfulfilled/list",
]);
export const DEPRECATED_READ_ENDPOINTS = new Set([
  "/v3/posting/fbs/list",
  "/v3/posting/fbs/unfulfilled/list",
]);
// New controlled-read plans must never advertise the deprecated FBS v3
// operations. Keep READ_ENDPOINTS broad for replaying/validating historical
// receipts, but use this set when constructing a fresh live-read plan.
export const CURRENT_READ_ENDPOINTS = new Set(
  [...READ_ENDPOINTS].filter((endpoint) => !DEPRECATED_READ_ENDPOINTS.has(endpoint)),
);
const READ_METHODS = new Set(["GET", "POST"]);
const MODES = new Set(["offline_fixture", "live_read"]);
const LIVE_CONFIRMATION = "I_CONFIRM_READ_ONLY";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function scopeHash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function safeStoreRef(store = {}) {
  const id = String(store.id || store.clientId || "").trim();
  return id ? scopeHash(id) : "";
}

function safeScope(scope = {}) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const name = String(scope.name || scope.kind || "").trim();
  if (!name || name.length > 100) return null;
  const normalized = { name, offerCount: Math.max(0, Math.min(1000, Number(scope.offerCount || 0))) };
  // Keep the bounded request scope intact.  The controlled-read operator
  // uses the same plan for request construction; dropping FBS date filters
  // here would make a plan appear valid but silently block both v4 FBS
  // endpoints at execution time.
  for (const key of ["offerIds", "productIds"]) {
    if (Array.isArray(scope[key])) normalized[key] = [...new Set(scope[key].map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 1000);
  }
  for (const key of [
    "cursor", "lastId", "since", "to", "sortDir", "dir", "status",
    "cutoffFrom", "cutoffTo", "deliveringDateFrom", "deliveringDateTo",
    "language", "visibility",
  ]) {
    const value = String(scope[key] ?? "").trim();
    if (value) normalized[key] = value.slice(0, 200);
  }
  for (const key of ["descriptionCategoryId", "typeId", "attributeId", "taskId", "offset"]) {
    const value = Number(key === "taskId" ? (scope.taskId ?? scope.task_id) : scope[key]);
    if (Number.isSafeInteger(value) && value >= 0) normalized[key] = value;
  }
  return normalized;
}

function responseHash(value) {
  return scopeHash(value == null ? {} : value);
}

function numericStatus(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : 0;
}

function classifyObservation(item = {}) {
  const statusCode = numericStatus(item.statusCode ?? item.httpStatus ?? item.status);
  const status = String(item?.status || "").trim().toLowerCase();
  const permissionFailure = statusCode === 401 || statusCode === 403 || ["unauthorized", "forbidden", "permission_denied"].includes(status);
  const rateLimitFailure = statusCode === 429 || ["rate_limited", "throttled", "too_many_requests"].includes(status);
  const serverFailure = statusCode >= 500 || ["server_error", "dependency_failed", "network_error"].includes(status);
  const observedFailure = permissionFailure || rateLimitFailure || serverFailure || statusCode >= 400 || ["failed", "error", "unknown"].includes(status);
  return { statusCode, observedFailure, permissionFailure, rateLimitFailure, serverFailure };
}

function fail(reasonCode, message, extra = {}) {
  return { ok: false, status: 400, reasonCode, message, ...extra };
}

/**
 * Run a bounded read-only verification. Offline mode never creates a network
 * request. Live mode is still opt-in and requires a caller-supplied reader,
 * explicit confirmation, and an injected request dependency.
 */
export async function runReadVerification({
  store = {},
  environment = "",
  scope = {},
  mode = "offline_fixture",
  confirm = "",
  reader,
  request,
  now = () => new Date().toISOString(),
} = {}) {
  const environmentName = String(environment || "").trim();
  const normalizedScope = safeScope(scope);
  if (!safeStoreRef(store)) return fail("READ_VERIFY_STORE_REQUIRED", "只读验证必须绑定店铺。", { mode });
  if (!environmentName) return fail("READ_VERIFY_ENVIRONMENT_REQUIRED", "只读验证必须绑定显式环境。", { mode });
  if (!normalizedScope) return fail("READ_VERIFY_SCOPE_REQUIRED", "只读验证必须绑定读取范围。", { mode });
  if (!MODES.has(mode)) return fail("READ_VERIFY_MODE_INVALID", "只读验证模式无效。", { mode });
  if (typeof reader !== "function") return fail("READ_VERIFY_READER_REQUIRED", "必须注入离线 fixture 或只读读取器。", { mode });
  if (mode === "live_read" && confirm !== LIVE_CONFIRMATION) {
    return fail("READ_VERIFY_CONFIRMATION_REQUIRED", "真实只读验证必须显式确认，且不会执行写入。", { mode });
  }
  if (mode === "live_read" && typeof request !== "function") {
    return fail("READ_VERIFY_REQUEST_DEPENDENCY_REQUIRED", "真实只读验证必须注入网络依赖，默认不会联网。", { mode });
  }

  const readRequest = async (endpoint, options = {}) => {
    if (mode !== "live_read") throw new Error("READ_VERIFY_NETWORK_DISABLED");
    const method = String(options.method || "GET").toUpperCase();
    if (!READ_METHODS.has(method)) throw new Error("READ_VERIFY_WRITE_METHOD_BLOCKED");
    const normalizedEndpoint = String(endpoint || "").trim().split("?", 1)[0];
    if (!READ_ENDPOINTS.has(normalizedEndpoint)) throw new Error("READ_VERIFY_ENDPOINT_NOT_ALLOWLISTED");
    // GET has no request body; POST is accepted only for the documented
    // read-only endpoints above and needs its filter body for pagination.
    return request(normalizedEndpoint, {
      ...options,
      method,
      ...(method === "GET" ? { body: undefined } : {}),
    });
  };
  let result;
  try {
    result = await reader({
      mode,
      store: { id: String(store.id || ""), clientId: String(store.clientId || "") },
      environment: environmentName,
      scope: normalizedScope,
      readRequest,
    });
  } catch (error) {
    return fail("READ_VERIFY_READER_FAILED", "只读验证读取失败，未执行任何写入。", {
      mode,
      verificationLevel: mode === "live_read" ? "server_observed" : "locally_tested",
      readSucceeded: false,
      observedFailure: true,
      failureScenario: "observed_read_failure",
      permissionFailureVerified: false,
      storeRef: safeStoreRef(store),
      environmentRef: scopeHash(environmentName),
      scopeRef: scopeHash(normalizedScope),
      errorType: error?.code || error?.name || "READ_FAILED",
    });
  }
  const observations = Array.isArray(result?.observations)
    ? result.observations
    : (result && typeof result === "object" && (
      result.ok === false
      || result.error
      || numericStatus(result.statusCode ?? result.httpStatus ?? result.status) >= 400
    ) ? [result] : []);
  const classifications = observations.map(classifyObservation);
  const observedFailure = classifications.some((item) => item.observedFailure);
  const permissionFailureVerified = mode === "live_read" && classifications.some((item) => item.permissionFailure);
  const rateLimitFailureVerified = mode === "live_read" && classifications.some((item) => item.rateLimitFailure);
  const serverFailureVerified = mode === "live_read" && classifications.some((item) => item.serverFailure);
  const failureScenario = classifications.some((item) => item.permissionFailure)
    ? "permission_denied"
    : classifications.some((item) => item.rateLimitFailure)
      ? "rate_limited"
      : classifications.some((item) => item.serverFailure)
        ? "server_or_dependency_failure"
        : observedFailure ? "observed_read_failure" : "";
  const safeObservations = observations.slice(0, 100).map((item) => {
    const statusCode = numericStatus(item.statusCode ?? item.httpStatus ?? item.status);
    return {
    endpoint: String(item?.endpoint || "").slice(0, 160),
    status: String(item?.status || "unknown").slice(0, 40),
    ...(statusCode ? { statusCode } : {}),
    responseHash: responseHash(item?.responseSummary || item?.response || {}),
    };
  });
  return {
    ok: true,
    mode,
    verificationLevel: mode === "live_read" ? "server_observed" : "locally_tested",
    readSucceeded: !observedFailure,
    observedFailure,
    failureScenario,
    // This describes the injected response only.  It is not a readiness
    // receipt and cannot by itself upgrade an environment to real_read_verified.
    permissionFailureVerified,
    rateLimitFailureVerified,
    serverFailureVerified,
    readOnly: true,
    writeAttempted: false,
    storeRef: safeStoreRef(store),
    environmentRef: scopeHash(environmentName),
    scopeRef: scopeHash(normalizedScope),
    scope: normalizedScope,
    observedAt: String(now()),
    observations: safeObservations,
    resultHash: responseHash({ observations: safeObservations, scope: normalizedScope }),
  };
}

export { LIVE_CONFIRMATION };
