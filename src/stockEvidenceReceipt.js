import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const STOCK_READ_ENDPOINTS = [
  "/v3/product/list",
  "/v3/product/info/list",
  "/v4/product/info/stocks",
  "/v2/warehouse/list",
];
const ENDPOINT_STATUS = new Set(["completed", "partial", "failed"]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(String(value || ""), "utf8").digest("hex")}`;
}

function isoDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function failure(reasonCode, message) {
  return { ok: false, status: 400, reasonCode, message };
}

function hashShape(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function endpointEvidenceHash(attempt) {
  return sha256(canonicalJson({
    endpoint: attempt.endpoint,
    status: attempt.status,
    errorCount: attempt.errorCount,
    pageCount: attempt.pageCount,
    paginationComplete: attempt.paginationComplete,
    paginationCursorRepeated: attempt.paginationCursorRepeated,
  }));
}

function receiptHashPayload(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    evidenceType: receipt.evidenceType,
    origin: receipt.origin,
    id: receipt.id || "",
    persisted: receipt.persisted,
    persistedAt: receipt.persistedAt || "",
    verificationEligible: receipt.verificationEligible,
    environmentRef: receipt.environmentRef,
    storeRef: receipt.storeRef,
    offerRefs: receipt.offerRefs,
    warehouseRefs: receipt.requestScope?.warehouseRefs || [],
    requestScope: receipt.requestScope,
    checkedAt: receipt.checkedAt,
    partial: receipt.partial,
    completeForRequestedIds: receipt.completeForRequestedIds,
    endpointStatuses: receipt.endpointStatuses,
    missingEvidenceRefs: receipt.missingEvidenceRefs,
  };
}

export function buildStockEvidenceReceipt(evidence = {}, options = {}) {
  if (evidence.readOnly !== true) return failure("STOCK_RECEIPT_READ_ONLY_REQUIRED", "只允许保存只读库存证据回执。");
  if (evidence.requestScoped !== true) return failure("STOCK_RECEIPT_REQUEST_SCOPE_REQUIRED", "库存证据必须绑定明确请求范围。");
  const environment = String(options.environment || "").trim();
  if (!environment) return failure("STOCK_RECEIPT_ENVIRONMENT_REQUIRED", "必须声明证据环境。");
  const storeId = String(evidence.storeId || "").trim();
  if (!storeId) return failure("STOCK_RECEIPT_STORE_REQUIRED", "库存证据缺少店铺。");
  const offerIds = [...new Set((Array.isArray(evidence.offerIds) ? evidence.offerIds : [])
    .map((offerId) => String(offerId || "").trim()).filter(Boolean))];
  if (!offerIds.length || offerIds.length > 100) return failure("STOCK_RECEIPT_OFFERS_REQUIRED", "库存证据必须包含 1 到 100 个 Offer。");
  const warehouseIds = [...new Set((Array.isArray(evidence.warehouseIds) ? evidence.warehouseIds : [])
    .map((warehouseId) => Number(warehouseId)).filter((warehouseId) => Number.isSafeInteger(warehouseId) && warehouseId > 0))];
  // A stock receipt is seller-actionable only for an exact
  // (offer_id, warehouse_id) scope. Accepting an empty warehouse set would
  // let any returned warehouse row look like current inventory for the target.
  if (!warehouseIds.length) return failure("STOCK_RECEIPT_WAREHOUSES_REQUIRED", "库存证据必须绑定至少一个目标仓库 ID；没有精确仓库范围时不能保存可用回执。");
  if (warehouseIds.length > 100) return failure("STOCK_RECEIPT_WAREHOUSES_LIMIT_EXCEEDED", "库存证据绑定的仓库不能超过 100 个。");
  // A caller cannot promote a hand-built `completeForRequestedIds` flag into
  // a write-safe receipt.  For a complete receipt, retain the exact observed
  // Offer × warehouse rows and require an explicit current quantity for every
  // requested tuple.  Partial receipts remain useful for diagnostics but are
  // never eligible for real-read verification.
  if (evidence.completeForRequestedIds === true && evidence.partial !== true) {
    const observed = Array.isArray(evidence.currentStocks) ? evidence.currentStocks : [];
    const known = (row) => {
      const raw = row?.stock ?? row?.quantity ?? row?.present;
      return raw !== undefined && raw !== null && raw !== ""
        && Number.isSafeInteger(Number(raw)) && Number(raw) >= 0;
    };
    const complete = offerIds.every((offerId) => warehouseIds.every((warehouseId) => observed.some((row) => (
      String(row?.offer_id || row?.offerId || "").trim() === offerId
      && Number(row?.warehouse_id || row?.warehouseId || 0) === warehouseId
      && known(row)
    ))));
    if (!complete) return failure("STOCK_RECEIPT_EXACT_TUPLES_REQUIRED", "完整库存回执必须包含每个 Offer × warehouse 的当前数量证据。");
  }
  const checkedAt = isoDate(evidence.checkedAt);
  if (!checkedAt) return failure("STOCK_RECEIPT_CHECKED_AT_REQUIRED", "库存证据缺少有效读取时间。");
  const attempts = Array.isArray(evidence.endpointAttempts) ? evidence.endpointAttempts : [];
  const attemptsByEndpoint = new Map(attempts.map((attempt) => [String(attempt?.endpoint || ""), attempt]));
  if (attempts.length !== STOCK_READ_ENDPOINTS.length
    || STOCK_READ_ENDPOINTS.some((endpoint) => !attemptsByEndpoint.has(endpoint))
    || attempts.some((attempt) => !STOCK_READ_ENDPOINTS.includes(String(attempt?.endpoint || "")) || !ENDPOINT_STATUS.has(String(attempt?.status || "")))) {
    return failure("STOCK_RECEIPT_ENDPOINTS_INVALID", "库存证据端点状态不完整或无效。");
  }
  const endpointStatuses = STOCK_READ_ENDPOINTS.map((endpoint) => {
    const attempt = attemptsByEndpoint.get(endpoint);
    const rawErrorCount = Number(attempt.errorCount || 0);
    const normalized = {
      endpoint,
      status: String(attempt.status),
      errorCount: Number.isFinite(rawErrorCount) ? Math.min(1000, Math.max(0, Math.floor(rawErrorCount))) : 0,
      pageCount: Number.isSafeInteger(Number(attempt.pageCount)) ? Math.min(100, Math.max(0, Number(attempt.pageCount))) : 0,
      paginationComplete: attempt.paginationComplete === undefined ? null : attempt.paginationComplete === true,
      paginationCursorRepeated: attempt.paginationCursorRepeated === true,
    };
    return { ...normalized, evidenceHash: endpointEvidenceHash(normalized) };
  });
  const receipt = {
    schemaVersion: 1,
    evidenceType: "stock_reconciliation_read",
    origin: "server_observed",
    persisted: false,
    verificationEligible: false,
    environmentRef: sha256(environment),
    storeRef: sha256(storeId),
    offerRefs: offerIds.map(sha256).sort(),
    requestScope: {
      requestScoped: true,
      offerCount: offerIds.length,
      maxOffers: 100,
      warehouseCount: warehouseIds.length,
      warehouseRefs: warehouseIds.map((warehouseId) => sha256(String(warehouseId))).sort(),
    },
    checkedAt,
    partial: evidence.partial === true,
    completeForRequestedIds: evidence.completeForRequestedIds === true && evidence.partial !== true,
    endpointStatuses,
    missingEvidenceRefs: [...new Set((Array.isArray(evidence.missingEvidence) ? evidence.missingEvidence : []).map(sha256))].sort(),
  };
  receipt.responseHash = sha256(canonicalJson(receiptHashPayload(receipt)));
  return { ok: true, receipt };
}

export function validateStockEvidenceReceipt(receipt = {}) {
  const reasonCodes = [];
  if (receipt.schemaVersion !== 1 || receipt.evidenceType !== "stock_reconciliation_read") reasonCodes.push("STOCK_RECEIPT_SCHEMA_INVALID");
  if (receipt.origin !== "server_observed") reasonCodes.push("STOCK_RECEIPT_ORIGIN_INVALID");
  const validVerificationState = (receipt.persisted === false && receipt.verificationEligible === false)
    || (receipt.persisted === true && receipt.verificationEligible === true
      && /^stock:[0-9a-f-]{36}$/i.test(String(receipt.id || "")) && Boolean(isoDate(receipt.persistedAt)));
  if (!validVerificationState) reasonCodes.push("STOCK_RECEIPT_VERIFICATION_STATE_INVALID");
  if (!hashShape(receipt.environmentRef) || !hashShape(receipt.storeRef)) reasonCodes.push("STOCK_RECEIPT_SCOPE_HASH_INVALID");
  if (!Array.isArray(receipt.offerRefs) || !receipt.offerRefs.length || receipt.offerRefs.length > 100 || receipt.offerRefs.some((ref) => !hashShape(ref))) {
    reasonCodes.push("STOCK_RECEIPT_OFFER_REFS_INVALID");
  }
  if (!isoDate(receipt.checkedAt)) reasonCodes.push("STOCK_RECEIPT_CHECKED_AT_INVALID");
  if (receipt.requestScope?.requestScoped !== true
    || Number(receipt.requestScope?.offerCount || 0) !== receipt.offerRefs?.length
    || receipt.requestScope?.maxOffers !== 100
    || !Array.isArray(receipt.requestScope?.warehouseRefs)
    || Number(receipt.requestScope?.warehouseCount || 0) !== receipt.requestScope.warehouseRefs.length
    || receipt.requestScope.warehouseRefs.some((ref) => !hashShape(ref))) reasonCodes.push("STOCK_RECEIPT_REQUEST_SCOPE_INVALID");
  if (!Array.isArray(receipt.missingEvidenceRefs) || receipt.missingEvidenceRefs.some((ref) => !hashShape(ref))) {
    reasonCodes.push("STOCK_RECEIPT_MISSING_REFS_INVALID");
  }
  if (!Array.isArray(receipt.endpointStatuses) || receipt.endpointStatuses.length !== STOCK_READ_ENDPOINTS.length) {
    reasonCodes.push("STOCK_RECEIPT_ENDPOINT_STATUSES_INVALID");
  } else {
    for (const endpoint of STOCK_READ_ENDPOINTS) {
      const status = receipt.endpointStatuses.find((item) => item?.endpoint === endpoint);
      if (!status
        || !ENDPOINT_STATUS.has(status.status)
        || !Number.isSafeInteger(status.pageCount)
        || status.pageCount < 0 || status.pageCount > 100
        || (status.paginationComplete !== null && typeof status.paginationComplete !== "boolean")
        || typeof status.paginationCursorRepeated !== "boolean"
        || status.evidenceHash !== endpointEvidenceHash(status)) {
        reasonCodes.push("STOCK_RECEIPT_ENDPOINT_STATUSES_INVALID");
        break;
      }
    }
  }
  const expectedHash = sha256(canonicalJson(receiptHashPayload(receipt)));
  if (!hashShape(receipt.responseHash) || receipt.responseHash !== expectedHash) reasonCodes.push("STOCK_RECEIPT_RESPONSE_HASH_INVALID");
  return { ok: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

export function evaluateStockRealReadVerification(receipts = [], { environment = "", storeId = "", offerIds = [], warehouseIds = [], maxAgeMs = Number.POSITIVE_INFINITY, now = Date.now() } = {}) {
  const declared = String(environment || "").trim();
  const environmentRef = sha256(declared);
  const declaredStore = String(storeId || "").trim();
  const storeRef = declaredStore ? sha256(declaredStore) : "";
  const requestedOfferRefs = [...new Set((Array.isArray(offerIds) ? offerIds : []).map((value) => String(value || "").trim()).filter(Boolean).map(sha256))].sort();
  const requestedWarehouseRefs = [...new Set((Array.isArray(warehouseIds) ? warehouseIds : []).map((value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value > 0).map((value) => sha256(String(value))))].sort();
  const sameRefs = (left = [], right = []) => left.length === right.length && left.every((value, index) => value === right[index]);
  const candidates = (Array.isArray(receipts) ? receipts : []).filter((receipt) => (
    receipt?.persisted === true
    && receipt?.verificationEligible === true
    && receipt?.origin === "server_observed"
    && receipt?.environmentRef === environmentRef
    // A receipt is never useful as a seller-facing inventory claim without
    // the exact current store.  The old optional filter allowed an
    // environment-only query to aggregate identical Offer/warehouse scopes
    // from different stores and present them as one verification result.
    && Boolean(storeRef)
    && receipt?.storeRef === storeRef
    && (!requestedOfferRefs.length || sameRefs(receipt?.offerRefs || [], requestedOfferRefs))
    && (!requestedWarehouseRefs.length || sameRefs(receipt?.requestScope?.warehouseRefs || [], requestedWarehouseRefs))
    && validateStockEvidenceReceipt(receipt).ok
  ));
  const ageLimit = Number.isFinite(Number(maxAgeMs)) && Number(maxAgeMs) >= 0 ? Number(maxAgeMs) : Number.POSITIVE_INFINITY;
  const nowMs = Number.isFinite(new Date(now).getTime()) ? new Date(now).getTime() : Date.now();
  const eligible = candidates.filter((receipt) => {
    if (!Number.isFinite(ageLimit)) return true;
    const checkedMs = new Date(receipt.checkedAt).getTime();
    return Number.isFinite(checkedMs) && checkedMs <= nowMs && nowMs - checkedMs <= ageLimit;
  });
  const successes = eligible.filter((receipt) => (
    receipt.partial === false
    && receipt.completeForRequestedIds === true
    && receipt.endpointStatuses.every((attempt) => attempt.status === "completed")
  ));
  const failures = eligible.filter((receipt) => (
    receipt.endpointStatuses.some((attempt) => ["partial", "failed"].includes(attempt.status))
  ));
  return {
    verificationLevel: declared && declaredStore && successes.length > 0 && failures.length > 0 ? "real_read_verified" : "locally_tested",
    environmentRef,
    persistedCount: declared && declaredStore ? eligible.length : 0,
    staleCount: declared && declaredStore ? Math.max(0, candidates.length - eligible.length) : 0,
    maxAgeMs: Number.isFinite(ageLimit) ? ageLimit : null,
    successCount: declared ? successes.length : 0,
    failureCount: declared ? failures.length : 0,
    failureScenarios: failures.length ? ["observed_read_failure"] : [],
    criteria: {
      explicitEnvironment: Boolean(declared),
      explicitStore: Boolean(declaredStore),
      serverObservedOnly: true,
      completeRequestedReadRequired: true,
      controlledEndpointFailureRequired: true,
      freshnessRequired: Number.isFinite(ageLimit),
    },
  };
}

export class StockEvidenceReceiptRepository {
  constructor({ file = path.resolve("data", "stock-evidence-receipts.json"), now = () => new Date().toISOString() } = {}) {
    this.file = path.resolve(file);
    this.now = now;
    this.writeChain = Promise.resolve();
  }

  async list() {
    let raw;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.receipts)) throw new Error("invalid schema");
      return parsed.receipts;
    } catch (cause) {
      const error = new Error("Stock evidence receipt storage is corrupt.", { cause });
      error.code = "STOCK_RECEIPT_STORE_CORRUPT";
      throw error;
    }
  }

  async recordServerObservation(input = {}) {
    if (input.recordEvidence !== true) return failure("STOCK_RECEIPT_CONFIRMATION_REQUIRED", "必须明确确认保存库存证据回执。");
    const built = buildStockEvidenceReceipt(input.evidence || {}, { environment: input.environment });
    if (!built.ok) return built;
    const persistedAt = isoDate(this.now());
    if (!persistedAt) return failure("STOCK_RECEIPT_PERSISTED_AT_INVALID", "回执保存时间无效。");
    const receipt = {
      ...built.receipt,
      id: `stock:${randomUUID()}`,
      persisted: true,
      verificationEligible: true,
      persistedAt,
    };
    receipt.responseHash = sha256(canonicalJson(receiptHashPayload(receipt)));
    const validation = validateStockEvidenceReceipt(receipt);
    if (!validation.ok) return failure("STOCK_RECEIPT_VALIDATION_FAILED", "库存证据回执校验失败。");
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const receipts = await this.list();
      const next = { schemaVersion: 1, receipts: [receipt, ...receipts].slice(0, 5000) };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", flag: "wx" });
        await fs.rename(temporary, this.file);
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
    await this.writeChain;
    return { ok: true, receipt };
  }
}
