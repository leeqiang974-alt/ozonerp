import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const STATUSES = new Set(["completed", "partial", "failed"]);
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const hash = (value) => `sha256:${createHash("sha256").update(String(value || ""), "utf8").digest("hex")}`;
const iso = (value) => { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; };

function failureScenarioForAttempt(attempt = {}) {
  const explicit = String(attempt.failureScenario || attempt.reasonCode || "").trim();
  if (explicit) return explicit.slice(0, 80);
  const rawStatus = attempt.statusCode ?? attempt.httpStatus
    ?? (typeof attempt.status === "number" ? attempt.status : null);
  const status = Number(rawStatus);
  if (status === 401 || status === 403) return `${status}_FORBIDDEN`;
  if (status === 429) return "429_RATE_LIMIT";
  if (status >= 500 && status <= 599) return `${status}_SERVER_ERROR`;
  return "";
}

function normalizedAttemptStatus(attempt = {}) {
  const text = String(attempt.status || "").trim();
  if ([...STATUSES].includes(text)) return text;
  const numeric = Number(attempt.statusCode ?? attempt.httpStatus ?? attempt.status);
  return Number.isFinite(numeric) && numeric >= 400 ? "failed" : text;
}

export function buildFbsReceiptSellerView(receipt = {}, { now = Date.now(), maxAgeMs = 60 * 60 * 1000 } = {}) {
  const checkedAtMs = Date.parse(String(receipt.checkedAt || ""));
  const age = Number(now) - checkedAtMs;
  const stale = !Number.isFinite(checkedAtMs) || age < 0 || age > Math.max(0, Number(maxAgeMs));
  const endpointStatuses = Array.isArray(receipt.endpointStatuses) ? receipt.endpointStatuses : [];
  const endpointFailed = endpointStatuses.some((item) => item?.status === "failed");
  const endpointPartial = endpointStatuses.some((item) => item?.status === "partial");
  const failureText = [...(Array.isArray(receipt.failureScenarios) ? receipt.failureScenarios : []), ...endpointStatuses.map((item) => item?.failureScenario || item?.reasonCode || "")].join(" ").toLowerCase();
  const permissionFailure = /401|403|permission|forbidden|unauthor/.test(failureText);
  const rateLimitFailure = /429|rate.?limit|throttl/.test(failureText);
  const timeoutFailure = /timeout|timed.?out|deadline/.test(failureText);
  let status = "needs_review";
  let nextAction = "重新读取当前店铺和订单范围；只读证据未形成可判断的完整范围。";
  if (stale) {
    status = "stale";
    nextAction = "回执已过期，重新读取当前店铺和订单范围；不要用旧回执安排履约。";
  } else if (permissionFailure) {
    status = "needs_review";
    nextAction = "Seller API 权限不足；检查当前店铺授权和 ERP 会话范围后，再用同一订单范围重新读取。";
  } else if (rateLimitFailure) {
    status = "needs_review";
    nextAction = "Seller API 返回限流；等待限流窗口后，用同一订单范围重新读取，不要重复发起履约动作。";
  } else if (timeoutFailure) {
    status = "needs_review";
    nextAction = "订单读取超时；保留当前 cursor 和范围，先重新核对同一页回执，再继续读取。";
  } else if (endpointFailed || endpointPartial || receipt.partial === true) {
    status = "partial";
    nextAction = "检查失败的订单或商品详情读取，再继续当前 cursor；证据不完整时不要备货、发运或取消。";
  } else if (receipt.hasNext === true) {
    status = "partial";
    nextAction = "继续读取回执中的下一批 cursor；当前批次不能代表全部订单范围。";
  } else if (receipt.datasetComplete === true) {
    status = "complete";
    nextAction = "当前订单范围的只读回执完整；履约动作仍需单独的权限、确认和写后回查。";
  }
  return {
    status,
    stale,
    verificationLevel: receipt.origin === "server_observed" ? "server_observed" : "locally_tested",
    nextAction,
    sideEffect: "仅使用服务端保存的 FBS 只读回执；不会备货、发运、取消或打印标签。",
  };
}

// Keep the persisted scope to the fields the FBS reader actually sends.  A
// caller must not be able to smuggle arbitrary query values into a receipt,
// and two pages must hash to the same scope only when their effective query
// is identical.
function normalizeRequestScope(scope = {}) {
  const number = Number(scope.limit);
  const limit = Number.isFinite(number) ? Math.min(100, Math.max(1, Math.floor(number))) : 100;
  const offsetNumber = Number(scope.offset);
  const offset = Number.isFinite(offsetNumber) ? Math.max(0, Math.floor(offsetNumber)) : 0;
  const warehouseNumber = Number(scope.warehouseId);
  const cursor = String(scope.cursor || "").trim().slice(0, 512);
  const sortDir = String(scope.sortDir || scope.sort_dir || "").trim().toUpperCase();
  const result = {
    since: iso(scope.since),
    to: iso(scope.to),
    status: String(scope.status || "").trim().slice(0, 64),
    warehouseId: Number.isFinite(warehouseNumber) && warehouseNumber > 0 ? warehouseNumber : null,
    limit,
    offset,
  };
  // Cursor pages are distinct evidence scopes. Do not collapse page 1 and
  // page 2 into one receipt just because their date/status filters match.
  if (cursor || scope.pagination === "cursor") {
    result.cursor = cursor;
    result.sortDir = sortDir === "ASC" ? "ASC" : "DESC";
    result.pagination = "cursor";
  }
  return result;
}

export function buildFbsEvidenceReceipt(model = {}, { environment = "" } = {}) {
  const env = String(environment || "").trim();
  if (model.readOnly !== true) return { ok: false, reasonCode: "FBS_RECEIPT_READ_ONLY_REQUIRED" };
  if (model.requestScoped !== true) return { ok: false, reasonCode: "FBS_RECEIPT_SCOPE_REQUIRED" };
  if (!env) return { ok: false, reasonCode: "FBS_RECEIPT_ENVIRONMENT_REQUIRED" };
  const storeId = String(model.storeId || "").trim();
  if (!storeId) return { ok: false, reasonCode: "FBS_RECEIPT_STORE_REQUIRED" };
  const checkedAt = iso(model.checkedAt);
  if (!checkedAt) return { ok: false, reasonCode: "FBS_RECEIPT_CHECKED_AT_REQUIRED" };
  const attempts = Array.isArray(model.endpointAttempts) ? model.endpointAttempts : [];
  if (attempts.length < 2 || attempts.some((attempt) => !STATUSES.has(normalizedAttemptStatus(attempt)))) {
    return { ok: false, reasonCode: "FBS_RECEIPT_ENDPOINTS_INVALID" };
  }
  const allEndpointsCompleted = attempts.every((attempt) => normalizedAttemptStatus(attempt) === "completed");
  const missingEvidence = Array.isArray(model.missingEvidence) ? model.missingEvidence : [];
  // Do not persist a caller-declared complete dataset when its own page,
  // pagination, endpoint, or missing-evidence fields contradict completion.
  // This keeps an old/partial workflow receipt from masquerading as a full
  // fulfillment range in the seller summary.
  const datasetComplete = model.datasetComplete === true
    && model.pageComplete === true
    && model.partial !== true
    && model.hasNext !== true
    && allEndpointsCompleted
    && missingEvidence.length === 0;
  const receipt = {
    schemaVersion: 1,
    evidenceType: "fbs_order_read",
    origin: "server_observed",
    persisted: false,
    environmentRef: hash(env),
    storeRef: hash(storeId),
    checkedAt,
    requestScope: normalizeRequestScope(model.requestScope),
    // Compare receipts without duplicating potentially identifying search values.
    scopeHash: hash(canonical(normalizeRequestScope(model.requestScope))),
    partial: model.partial === true,
    hasNext: model.hasNext === true,
    pageComplete: model.pageComplete === true,
    datasetComplete,
    readCoverage: model.readCoverage?.status || (datasetComplete ? "complete" : "partial"),
    sourceCount: Math.min(100, Math.max(0, Number(model.orders?.length || 0))),
    missingEvidenceRefs: [...new Set(missingEvidence.map((item) => hash(String(item).slice(0, 120))))].slice(0, 100),
    endpointStatuses: attempts.map((attempt) => ({
      source: String(attempt.source || "unknown"),
      status: normalizedAttemptStatus(attempt),
      errorCount: Math.min(100, Math.max(0, Number(attempt.errorCount || 0))),
      ...(failureScenarioForAttempt(attempt) ? { failureScenario: failureScenarioForAttempt(attempt) } : {}),
    })),
    failureScenarios: [...new Set([
      ...(Array.isArray(model.failureScenarios) ? model.failureScenarios : []),
      ...attempts.map((attempt) => failureScenarioForAttempt(attempt)),
    ].map((value) => String(value || "").trim().slice(0, 80)).filter(Boolean))].slice(0, 10),
    verificationLevel: "server_observed",
  };
  receipt.responseHash = hash(canonical(receipt));
  return { ok: true, receipt };
}

export class FbsEvidenceReceiptRepository {
  constructor({ file = path.resolve("data", "fbs-evidence-receipts.json") } = {}) { this.file = file; this.writeChain = Promise.resolve(); }
  async list() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!Array.isArray(parsed?.receipts)) throw new Error("invalid schema");
      return parsed.receipts;
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      const wrapped = new Error("FBS evidence receipt storage is corrupt.", { cause: error });
      wrapped.code = "FBS_RECEIPT_STORE_CORRUPT";
      throw wrapped;
    }
  }

  // Select a receipt only when environment, store and effective page scope
  // all match.  This prevents a later page (or a different date/status
  // batch) from being presented as the latest evidence for the current page.
  async findLatest({ environment = "", storeId = "", requestScope = {}, maxAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
    const environmentRef = environment ? hash(String(environment).trim()) : "";
    const storeRef = storeId ? hash(String(storeId).trim()) : "";
    const scopeHash = hash(canonical(normalizeRequestScope(requestScope)));
    const maxAge = Number.isFinite(Number(maxAgeMs)) ? Math.max(0, Number(maxAgeMs)) : 60 * 60 * 1000;
    const current = Number(now);
    const receipts = await this.list();
    return receipts
      .filter((receipt) => {
        if (receipt?.persisted !== true || receipt?.origin !== "server_observed") return false;
        if (environmentRef && receipt.environmentRef !== environmentRef) return false;
        if (storeRef && receipt.storeRef !== storeRef) return false;
        if (receipt.scopeHash !== scopeHash) return false;
        const checkedAtMs = Date.parse(String(receipt.checkedAt || ""));
        if (!Number.isFinite(checkedAtMs) || checkedAtMs > current) return false;
        return current - checkedAtMs <= maxAge;
      })
      .sort((left, right) => Date.parse(String(right.checkedAt || "")) - Date.parse(String(left.checkedAt || "")))[0] || null;
  }
  async recordServerObservation({ recordEvidence = false, model = {}, environment = "" } = {}) {
    if (recordEvidence !== true) return { ok: false, status: 400, reasonCode: "FBS_RECEIPT_CONFIRMATION_REQUIRED" };
    const built = buildFbsEvidenceReceipt(model, { environment });
    if (!built.ok) return { ...built, status: 400 };
    const receipt = { ...built.receipt, id: `fbs:${randomUUID()}`, persisted: true, persistedAt: new Date().toISOString() };
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const receipts = await this.list();
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify({ schemaVersion: 1, receipts: [receipt, ...receipts].slice(0, 5000) }, null, 2), "utf8");
    });
    await this.writeChain;
    return { ok: true, receipt };
  }
}
