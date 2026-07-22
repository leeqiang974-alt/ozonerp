import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { READ_ENDPOINTS, scopeHash } from "./readVerificationHarness.js";

const MAX_RECEIPTS = 5000;
const HASH = /^sha256:[a-f0-9]{64}$/i;
const SIGNED_SESSION_SOURCES = new Set(["session_cookie", "session_bearer"]);

function text(value = "") {
  return String(value || "").trim();
}

function normalizedEndpoints(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(text)
    .filter((endpoint) => READ_ENDPOINTS.has(endpoint)))].sort();
}

function observationSucceeded(item = {}) {
  if (!item || !text(item.endpoint)) return false;
  const statusCode = Number(item?.statusCode ?? item?.httpStatus);
  if (Number.isInteger(statusCode) && statusCode >= 400) return false;
  const status = text(item?.status).toLowerCase();
  return !["failed", "error", "unknown", "partial", "blocked", "forbidden", "unauthorized", "rate_limited", "server_error"].includes(status);
}

export function buildReadOperatorReceipt(plan = {}, result = {}, {
  persisted = false,
  persistedAt = "",
  id = "",
} = {}) {
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const endpoints = normalizedEndpoints(observations.map((item) => item?.endpoint));
  const requestedEndpoints = normalizedEndpoints(plan.endpoints);
  const endpointCoverageComplete = requestedEndpoints.length > 0
    && requestedEndpoints.every((endpoint) => observations.some((item) => text(item?.endpoint) === endpoint && observationSucceeded(item)));
  const checkedAt = text(result.observedAt) || new Date().toISOString();
  const receipt = {
    schemaVersion: 1,
    id: text(id) || `read-operator:${randomUUID()}`,
    origin: "server_observed",
    persisted: persisted === true,
    verificationLevel: "server_observed",
    verificationEligible: persisted === true,
    persistedAt: text(persistedAt) || (persisted ? new Date().toISOString() : ""),
    storeRefHash: text(result.storeRef),
    environmentRefHash: text(result.environmentRef),
    scopeRefHash: text(result.scopeRef),
    checkedAt,
    environmentDeclared: Boolean(text(plan.environment)),
    scope: plan.scope && typeof plan.scope === "object" ? {
      name: text(plan.scope.name || plan.scope.kind),
      offerCount: Math.max(0, Math.min(1000, Number(plan.scope.offerCount || 0))),
    } : null,
    requestedEndpoints,
    endpoints,
    endpointCoverageComplete,
    status: result.readSucceeded === true && result.observedFailure !== true ? "success" : "failed",
    readSucceeded: result.readSucceeded === true,
    observedFailure: result.observedFailure === true,
    failureScenario: text(result.failureScenario),
    permissionFailureVerified: result.permissionFailureVerified === true,
    rateLimitFailureVerified: result.rateLimitFailureVerified === true,
    serverFailureVerified: result.serverFailureVerified === true,
    readOnly: result.readOnly !== false,
    writeAttempted: result.writeAttempted === true,
    // A server-observed receipt may optionally carry proof that the exact
    // request was authenticated by a signed ERP session.  Persist only the
    // credential class and a one-way token fingerprint; never persist a token,
    // cookie, or decoded session payload.
    signedSessionBound: result.signedSessionBound === true,
    authSource: SIGNED_SESSION_SOURCES.has(text(result.authSource)) ? text(result.authSource) : "",
    sessionRefHash: HASH.test(text(result.sessionRefHash)) ? text(result.sessionRefHash) : "",
    responseHash: HASH.test(text(result.resultHash)) ? text(result.resultHash) : scopeHash({ observations, scope: plan.scope || {} }),
    observations: observations.slice(0, 100).map((item) => ({
      endpoint: text(item?.endpoint),
      status: text(item?.status || "unknown").slice(0, 40),
      ...(Number.isInteger(Number(item?.statusCode)) ? { statusCode: Number(item.statusCode) } : {}),
      responseHash: HASH.test(text(item?.responseHash)) ? text(item.responseHash) : "",
    })).filter((item) => item.endpoint),
  };
  return receipt;
}

export function validateReadOperatorReceipt(receipt = {}) {
  const errors = [];
  if (receipt.schemaVersion !== 1) errors.push("READ_OPERATOR_RECEIPT_SCHEMA_INVALID");
  if (receipt.origin !== "server_observed" || receipt.verificationLevel !== "server_observed") errors.push("READ_OPERATOR_RECEIPT_ORIGIN_INVALID");
  if (receipt.persisted !== true || receipt.verificationEligible !== true) errors.push("READ_OPERATOR_RECEIPT_NOT_PERSISTED");
  if (!/^read-operator:[0-9a-f-]{36}$/i.test(text(receipt.id))) errors.push("READ_OPERATOR_RECEIPT_ID_INVALID");
  if (!HASH.test(text(receipt.storeRefHash)) || !HASH.test(text(receipt.environmentRefHash)) || !HASH.test(text(receipt.scopeRefHash))) errors.push("READ_OPERATOR_RECEIPT_SCOPE_INVALID");
  if (!text(receipt.checkedAt) || !Number.isFinite(Date.parse(receipt.checkedAt))) errors.push("READ_OPERATOR_RECEIPT_TIME_INVALID");
  if (receipt.readOnly !== true || receipt.writeAttempted === true) errors.push("READ_OPERATOR_RECEIPT_WRITE_POSTURE_INVALID");
  if (receipt.signedSessionBound === true) {
    if (!SIGNED_SESSION_SOURCES.has(text(receipt.authSource))) errors.push("READ_OPERATOR_RECEIPT_SIGNED_SESSION_SOURCE_INVALID");
    if (!HASH.test(text(receipt.sessionRefHash))) errors.push("READ_OPERATOR_RECEIPT_SIGNED_SESSION_REF_INVALID");
  }
  if (!HASH.test(text(receipt.responseHash))) errors.push("READ_OPERATOR_RECEIPT_RESPONSE_HASH_INVALID");
  const requested = normalizedEndpoints(receipt.requestedEndpoints);
  const observed = normalizedEndpoints(receipt.endpoints);
  // A failed server-observed operation is still useful evidence even when the
  // reader failed before it could produce an observation for every endpoint.
  // Do not silently accept an incomplete successful receipt: only an explicit
  // observed failure may use this exception, and it remains status=failed.
  const failedRead = receipt.status === "failed"
    && (receipt.observedFailure === true || receipt.readSucceeded === false);
  if (!requested.length || (!failedRead && requested.some((endpoint) => !observed.includes(endpoint)))) {
    errors.push("READ_OPERATOR_RECEIPT_ENDPOINT_COVERAGE_INCOMPLETE");
  }
  if (observed.some((endpoint) => !READ_ENDPOINTS.has(endpoint))) errors.push("READ_OPERATOR_RECEIPT_ENDPOINT_NOT_ALLOWLISTED");
  const observationByEndpoint = new Map((Array.isArray(receipt.observations) ? receipt.observations : [])
    .map((item) => [text(item?.endpoint), item]));
  const computedComplete = requested.length > 0
    && requested.every((endpoint) => observationSucceeded(observationByEndpoint.get(endpoint) || {}));
  // A forged receipt must not turn a complete endpoint name list into a
  // successful read when one endpoint actually failed.  The repository is the
  // durable evidence gate, so recompute coverage from bounded observations and
  // require success receipts to agree with that result.
  if (receipt.endpointCoverageComplete !== computedComplete) errors.push("READ_OPERATOR_RECEIPT_ENDPOINT_COVERAGE_TAMPERED");
  if (receipt.status === "success" && (receipt.readSucceeded !== true || !computedComplete)) {
    errors.push("READ_OPERATOR_RECEIPT_SUCCESS_STATE_INVALID");
  }
  if (receipt.status === "failed" && receipt.readSucceeded === true) errors.push("READ_OPERATOR_RECEIPT_FAILURE_STATE_INVALID");
  return { ok: errors.length === 0, errors };
}

export class ReadOperatorReceiptRepository {
  constructor({ file = path.resolve("data/read-operator-receipts.json") } = {}) {
    this.file = path.resolve(file);
    this.lockFile = `${this.file}.lock`;
    this.writeChain = Promise.resolve();
  }

  async list() {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.receipts)) throw new Error("invalid schema");
      // The envelope being valid is not enough: a forged or truncated entry
      // must never flow into the matrix/receipt API as server_observed
      // evidence.  Fail closed before returning any entries, while leaving
      // the on-disk artifact untouched for operator recovery.
      const invalid = parsed.receipts.findIndex((receipt) => !validateReadOperatorReceipt(receipt || {}).ok);
      if (invalid >= 0) {
        const error = new Error(`invalid receipt entry at index ${invalid}`);
        error.code = "READ_OPERATOR_RECEIPT_ENTRY_INVALID";
        error.entryIndex = invalid;
        throw error;
      }
      return parsed.receipts;
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      if (error?.code === "READ_OPERATOR_RECEIPT_ENTRY_INVALID") throw error;
      const wrapped = new Error("Read operator receipt storage is corrupt.", { cause: error });
      wrapped.code = "READ_OPERATOR_RECEIPT_STORE_CORRUPT";
      throw wrapped;
    }
  }

  async record(plan = {}, result = {}) {
    const receipt = buildReadOperatorReceipt(plan, result, { persisted: true });
    const validation = validateReadOperatorReceipt(receipt);
    if (!validation.ok) return { ok: false, status: 400, reasonCode: "READ_OPERATOR_RECEIPT_VALIDATION_FAILED", details: validation.errors };
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const release = await this.acquireLock();
      try {
        const receipts = await this.list();
        await this.atomicWrite({ schemaVersion: 1, receipts: [receipt, ...receipts].slice(0, MAX_RECEIPTS) });
      } finally {
        await release();
      }
    });
    await this.writeChain;
    return { ok: true, receipt };
  }

  async acquireLock() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const handle = await fs.open(this.lockFile, "wx");
        return async () => { await handle.close().catch(() => {}); await fs.rm(this.lockFile, { force: true }).catch(() => {}); };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const stat = await fs.stat(this.lockFile);
          if (Date.now() - stat.mtimeMs > 30_000) await fs.rm(this.lockFile, { force: true });
        } catch (statError) { if (statError?.code !== "ENOENT") throw statError; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const error = new Error("Read operator receipt storage lock timeout.");
    error.code = "READ_OPERATOR_RECEIPT_STORE_LOCK_TIMEOUT";
    throw error;
  }

  async atomicWrite(store) {
    const temporary = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", flag: "wx" });
    try { await fs.rename(temporary, this.file); } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
  }
}
