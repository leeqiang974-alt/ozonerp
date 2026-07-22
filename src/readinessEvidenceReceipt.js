import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const DEFAULT_ENDPOINT_VERSIONS = ["/v3/product/list", "/v3/product/info/list"];
const ALLOWED_REQUEST_SCOPES = new Set(["single_auto_listing_job", "single_offer", "controlled_fixture"]);
const ALLOWED_READ_STATUSES = new Set(["completed", "partial", "dependency_failed", "dependency_not_provided", "no_offers", "unknown"]);
const ALLOWED_STATES = new Set(["accepted", "imported", "pending_moderation", "moderation_failed", "ready_for_sale", "unknown"]);
const ALLOWED_MODERATION_STATUSES = new Set(["ready", "pending", "failed", "unknown"]);
const ALLOWED_IMPORT_STATUSES = new Set(["accepted", "imported", "failed", "unknown"]);
const VERIFIED_FAILURE_SCENARIOS = new Set(["observed_read_failure"]);

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

function normalizedDate(value) {
  const parsed = new Date(value || "");
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function normalizedEndpoints(value) {
  const endpoints = Array.isArray(value) ? value : DEFAULT_ENDPOINT_VERSIONS;
  return [...new Set(endpoints
    .map((endpoint) => String(endpoint || "").trim())
    .filter((endpoint) => /^\/v\d+\/[a-z0-9/_-]{1,120}$/i.test(endpoint)))]
    .slice(0, 10)
    .sort();
}

function normalizedOperationEvidence(value) {
  return (Array.isArray(value) ? value : []).slice(0, 10).map((entry) => ({
    operationPath: String(entry?.operationPath || "").trim(),
    responseHash: /^sha256:[a-f0-9]{64}$/i.test(String(entry?.responseHash || "")) ? String(entry.responseHash) : "",
    verificationLevel: String(entry?.verificationLevel || "locally_tested"),
  })).filter((entry) => entry.operationPath && entry.responseHash);
}

function normalizedFailureEvidence(value) {
  return (Array.isArray(value) ? value : []).slice(0, 10).map((entry) => ({
    endpoint: String(entry?.endpoint || entry?.operationPath || "").trim().slice(0, 160),
    reasonCode: String(entry?.reasonCode || entry?.code || entry?.status || "observed_read_failure").trim().slice(0, 80),
    ...(Number.isInteger(Number(entry?.statusCode)) ? { statusCode: Number(entry.statusCode) } : {}),
  })).filter((entry) => entry.endpoint || entry.reasonCode);
}

function hashShape(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/i.test(value);
}

function receiptResponseSummary(receipt) {
  return {
    readStatus: receipt.readStatus,
    state: receipt.state,
    live: receipt.live === true,
    offers: Array.isArray(receipt.offerSummary) ? receipt.offerSummary : [],
    requestedOfferCount: receipt.requestedOfferCount,
    coverageComplete: receipt.coverageComplete === true,
    endpointAttempts: Array.isArray(receipt.endpointAttempts) ? receipt.endpointAttempts : [],
    operationEvidence: Array.isArray(receipt.operationEvidence) ? receipt.operationEvidence : [],
    failureEvidence: Array.isArray(receipt.failureEvidence) ? receipt.failureEvidence : [],
  };
}

function receiptSuccessState(receipt) {
  return receipt.readStatus === "completed"
    && receipt.state === "ready_for_sale"
    && receipt.live === true
    && receipt.coverageComplete === true
    && receipt.endpointAttempted === true
    && DEFAULT_ENDPOINT_VERSIONS.every((endpoint) => Array.isArray(receipt.endpointAttempts) && receipt.endpointAttempts.includes(endpoint));
}

function offerSummary(offers = []) {
  return (Array.isArray(offers) ? offers : []).slice(0, 100).map((offer) => ({
    offerRef: sha256(offer?.offerId || offer?.offer_id || ""),
    productRef: sha256(offer?.productId || offer?.product_id || ""),
    importStatus: ALLOWED_IMPORT_STATUSES.has(String(offer?.importStatus || "")) ? String(offer.importStatus) : "unknown",
    moderationStatus: ALLOWED_MODERATION_STATUSES.has(String(offer?.moderationStatus || "")) ? String(offer.moderationStatus) : "unknown",
    errorCount: Math.min(100, Math.max(0, Number(Array.isArray(offer?.errors) ? offer.errors.length : offer?.errorCount || 0))),
  }));
}

export function buildReadinessEvidenceReceipt(inspection = {}, options = {}) {
  const evidence = inspection?.evidenceSummary || inspection?.evidence || {};
  const environment = String(options.environment || "").trim();
  const rawReadStatus = String(evidence.readStatus || "unknown").trim();
  const readStatus = ALLOWED_READ_STATUSES.has(rawReadStatus) ? rawReadStatus : "unknown";
  const checkedAt = normalizedDate(inspection?.sellerView?.evidenceAt || options.checkedAt);
  const offers = offerSummary(inspection?.sellerView?.offers || evidence.offers);
  const requestedOfferCount = Math.min(100, Math.max(0, Number(evidence.requestedOfferCount || 0)));
  // Evidence must be explicit: an omitted coverage flag is unknown, never complete.
  const coverageComplete = evidence.coverageComplete === true;
  const endpointAttempts = normalizedEndpoints(evidence.endpointAttempts || []);
  const operationEvidence = normalizedOperationEvidence(evidence.operationEvidence);
  const failureEvidence = normalizedFailureEvidence(evidence.endpointFailures || evidence.failureEvidence);
  const requiredEndpointAttempts = DEFAULT_ENDPOINT_VERSIONS.every((endpoint) => endpointAttempts.includes(endpoint));
  const endpointAttempted = requestedOfferCount > 0 && endpointAttempts.length > 0;
  const state = ALLOWED_STATES.has(String(evidence.state || "")) ? String(evidence.state) : "unknown";
  const live = evidence.live === true;
  // A successful read receipt proves the seller outcome, not merely that an API
  // returned rows. Pending/unknown moderation states must remain local evidence.
  const success = readStatus === "completed"
    && state === "ready_for_sale"
    && live
    && coverageComplete
    && endpointAttempted
    && requiredEndpointAttempts;
  const responseSummary = {
    readStatus,
    state,
    live,
    offers,
    requestedOfferCount,
    coverageComplete,
    endpointAttempts,
    operationEvidence,
    failureEvidence,
  };
  return {
    schemaVersion: 1,
    jobRef: sha256(inspection.jobId),
    storeRef: sha256(inspection.storeId),
    environmentRef: sha256(environment),
    environmentDeclared: Boolean(environment),
    checkedAt,
    endpointVersions: normalizedEndpoints(options.endpointVersions),
    requestScope: ALLOWED_REQUEST_SCOPES.has(options.requestScope) ? options.requestScope : "single_auto_listing_job",
    success,
    requestedOfferCount,
    endpointAttempts,
    operationEvidence,
    failureEvidence,
    endpointAttempted,
    coverageComplete,
    failureScenario: success ? "" : (readStatus === "dependency_failed" ? "observed_read_failure" : "unverified_read_state"),
    readStatus,
    state: responseSummary.state,
    live: responseSummary.live,
    offerSummary: offers,
    responseHash: sha256(canonicalJson(responseSummary)),
  };
}

/**
 * Validate the durable, hash-bound shape before a receipt can enter the
 * real-read evaluator.  A caller may submit a JSON-looking object, but it
 * cannot turn it into server evidence by merely setting `origin` or
 * `persisted`; the repository adds the durable state and re-validates it.
 */
export function validateReadinessEvidenceReceipt(receipt = {}) {
  const reasonCodes = [];
  if (receipt.schemaVersion !== 1) reasonCodes.push("READINESS_RECEIPT_SCHEMA_INVALID");
  if (receipt.origin !== "server_observed") reasonCodes.push("READINESS_RECEIPT_ORIGIN_INVALID");
  if (receipt.persisted !== true || receipt.verificationEligible !== true
    || !/^readiness:[0-9a-f-]{36}$/i.test(String(receipt.id || ""))
    || !normalizedDate(receipt.persistedAt)) reasonCodes.push("READINESS_RECEIPT_PERSISTENCE_INVALID");
  if (!receipt.environmentDeclared || !hashShape(receipt.environmentRef)) reasonCodes.push("READINESS_RECEIPT_ENVIRONMENT_INVALID");
  if (!hashShape(receipt.jobRef) || !hashShape(receipt.storeRef)) reasonCodes.push("READINESS_RECEIPT_SCOPE_HASH_INVALID");
  if (!normalizedDate(receipt.checkedAt)) reasonCodes.push("READINESS_RECEIPT_CHECKED_AT_INVALID");
  if (!Number.isSafeInteger(Number(receipt.requestedOfferCount)) || Number(receipt.requestedOfferCount) <= 0) {
    reasonCodes.push("READINESS_RECEIPT_OFFER_COUNT_INVALID");
  }
  if (receipt.endpointAttempted !== true
    || !Array.isArray(receipt.endpointAttempts)
    || DEFAULT_ENDPOINT_VERSIONS.some((endpoint) => !receipt.endpointAttempts.includes(endpoint))) {
    reasonCodes.push("READINESS_RECEIPT_ENDPOINTS_INVALID");
  }
  const operationEvidence = Array.isArray(receipt.operationEvidence) ? receipt.operationEvidence : [];
  if (receiptSuccessState(receipt)) {
    for (const endpoint of DEFAULT_ENDPOINT_VERSIONS) {
      const operation = operationEvidence.find((item) => item?.operationPath === endpoint);
      if (!operation || !hashShape(operation.responseHash) || operation.verificationLevel !== "server_observed") {
        reasonCodes.push("READINESS_RECEIPT_OPERATION_EVIDENCE_INVALID");
        break;
      }
    }
  }
  const expectedSuccess = receiptSuccessState(receipt);
  if (receipt.success !== expectedSuccess) reasonCodes.push("READINESS_RECEIPT_SUCCESS_TAMPERED");
  if (!hashShape(receipt.responseHash) || receipt.responseHash !== sha256(canonicalJson(receiptResponseSummary(receipt)))) {
    reasonCodes.push("READINESS_RECEIPT_RESPONSE_HASH_INVALID");
  }
  return { ok: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

export function evaluateRealReadVerification(receipts = [], { environment = "", storeId = "", maxAgeMs = Number.POSITIVE_INFINITY, now = Date.now() } = {}) {
  const environmentRef = sha256(String(environment || "").trim());
  const storeRef = String(storeId || "").trim() ? sha256(String(storeId).trim()) : "";
  const candidates = (Array.isArray(receipts) ? receipts : []).filter((receipt) => (
    receipt?.persisted === true
    && receipt?.verificationEligible === true
    && receipt?.origin === "server_observed"
    && receipt?.environmentDeclared === true
    && receipt?.environmentRef === environmentRef
    && (!storeRef || receipt?.storeRef === storeRef)
    && Boolean(normalizedDate(receipt?.checkedAt))
    && Number(receipt?.requestedOfferCount || 0) > 0
    && receipt?.endpointAttempted === true
    && DEFAULT_ENDPOINT_VERSIONS.every((endpoint) => Array.isArray(receipt?.endpointAttempts) && receipt.endpointAttempts.includes(endpoint))
    && validateReadinessEvidenceReceipt(receipt).ok
  ));
  const ageLimit = Number.isFinite(Number(maxAgeMs)) && Number(maxAgeMs) >= 0 ? Number(maxAgeMs) : Number.POSITIVE_INFINITY;
  const nowMs = Number.isFinite(new Date(now).getTime()) ? new Date(now).getTime() : Date.now();
  const eligible = candidates.filter((receipt) => {
    if (!Number.isFinite(ageLimit)) return true;
    const checkedMs = new Date(receipt.checkedAt).getTime();
    return Number.isFinite(checkedMs) && checkedMs <= nowMs && nowMs - checkedMs <= ageLimit;
  });
  const successes = eligible.filter((receipt) => (
    receipt.success === true
    && DEFAULT_ENDPOINT_VERSIONS.every((endpoint) => receipt.endpointAttempts.includes(endpoint))
  ));
  const failures = eligible.filter((receipt) => (
    receipt.success === false && VERIFIED_FAILURE_SCENARIOS.has(receipt.failureScenario)
  ));
  return {
    verificationLevel: successes.length > 0 && failures.length > 0 ? "real_read_verified" : "locally_tested",
    environmentRef,
    storeRef: storeRef || null,
    persistedCount: eligible.length,
    staleCount: Math.max(0, candidates.length - eligible.length),
    maxAgeMs: Number.isFinite(ageLimit) ? ageLimit : null,
    successCount: successes.length,
    failureCount: failures.length,
    successDates: [...new Set(successes.map((receipt) => receipt.checkedAt.slice(0, 10)))].sort(),
    failureDates: [...new Set(failures.map((receipt) => receipt.checkedAt.slice(0, 10)))].sort(),
    failureScenarios: [...new Set(failures.map((receipt) => receipt.failureScenario))].sort(),
    failureCoverage: {
      observedFailureVerified: failures.length > 0,
      permissionFailureVerified: false,
      note: "当前通用失败回执只证明受控只读调用出现过失败，不代表权限失败覆盖，也不代表限流或各类错误均已覆盖。",
    },
    criteria: {
      explicitEnvironment: Boolean(String(environment || "").trim()),
      explicitStoreScope: Boolean(storeRef),
      persistedSuccessRequired: true,
      persistedFailureScenarioRequired: true,
      requestedOfferRequired: true,
      listAndDetailEndpointAttemptsRequired: true,
      completeOfferCoverageRequired: true,
      freshnessRequired: Number.isFinite(ageLimit),
    },
  };
}

export class ReadinessEvidenceReceiptRepository {
  constructor({ file = path.resolve("data", "readiness-evidence-receipts.json") } = {}) {
    this.file = path.resolve(file);
    this.writeChain = Promise.resolve();
    // writeChain only serializes calls within one Node instance.  The lock is
    // required because the API server may be clustered/restarted and each
    // process otherwise performs a read/modify/write against the same JSON
    // snapshot, silently dropping another process' receipt.
    this.lockFile = `${this.file}.lock`;
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
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.receipts)) throw new Error("invalid schema");
      return parsed.receipts;
    } catch (cause) {
      const error = new Error("Readiness evidence receipt storage is corrupt.", { cause });
      error.code = "READINESS_RECEIPT_STORE_CORRUPT";
      throw error;
    }
  }

  async record(input = {}) {
    return this.recordWithOrigin(input, "client_asserted");
  }

  async recordServerObservation(input = {}) {
    return this.recordWithOrigin(input, "server_observed");
  }

  async recordWithOrigin(input = {}, origin = "client_asserted") {
    if (input.recordEvidence !== true) {
      return { ok: false, status: 400, reasonCode: "READINESS_EVIDENCE_CONFIRMATION_REQUIRED" };
    }
    if (!String(input.environment || "").trim()) {
      return { ok: false, status: 400, reasonCode: "READINESS_EVIDENCE_ENVIRONMENT_REQUIRED" };
    }
    const receipt = {
      ...buildReadinessEvidenceReceipt(input.inspection || {}, input),
      id: `readiness:${randomUUID()}`,
      origin: origin === "server_observed" ? "server_observed" : "client_asserted",
      persisted: true,
      verificationEligible: origin === "server_observed",
      persistedAt: new Date().toISOString(),
    };
    if (origin === "server_observed") {
      receipt.responseHash = sha256(canonicalJson(receiptResponseSummary(receipt)));
      const validation = validateReadinessEvidenceReceipt(receipt);
      if (!validation.ok) return { ok: false, status: 400, reasonCode: "READINESS_RECEIPT_VALIDATION_FAILED", details: validation.reasonCodes };
    }
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const release = await this.acquireFileLock();
      try {
        // Read while holding the inter-process lock.  Reading before locking
        // would still permit two repository instances to overwrite each other.
        const receipts = await this.list();
        const next = { schemaVersion: 1, receipts: [receipt, ...receipts].slice(0, 5000) };
        await this.atomicWrite(next);
      } finally {
        await release();
      }
    });
    await this.writeChain;
    return { ok: true, receipt };
  }

  async acquireFileLock() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const handle = await fs.open(this.lockFile, "wx");
        await handle.writeFile(`${process.pid}\n`, "utf8");
        return async () => {
          await handle.close().catch(() => {});
          await fs.rm(this.lockFile, { force: true }).catch(() => {});
        };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const stat = await fs.stat(this.lockFile);
          // A crashed process must not permanently block evidence recording.
          if (Date.now() - stat.mtimeMs > 30_000) await fs.rm(this.lockFile, { force: true });
        } catch (statError) {
          if (statError?.code !== "ENOENT") throw statError;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const error = new Error(`Readiness evidence receipt storage lock timeout: ${this.file}`);
    error.code = "READINESS_RECEIPT_STORE_LOCK_TIMEOUT";
    throw error;
  }

  async atomicWrite(store) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const backup = `${this.file}.bak`;
    try {
      await fs.writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", flag: "wx" });
      // Keep the prior valid snapshot for a recovery drill.  Never replace it
      // until the new temporary file is fully written.
      try {
        await fs.copyFile(this.file, backup);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await fs.rename(temporary, this.file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }
}
