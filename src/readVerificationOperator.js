import { DEPRECATED_READ_ENDPOINTS, LIVE_CONFIRMATION, READ_ENDPOINTS, scopeHash } from "./readVerificationHarness.js";
import { validateReadinessEvidenceReceipt } from "./readinessEvidenceReceipt.js";

export const READ_OPERATOR_MIN_FRESHNESS_MS = 60 * 1000;
export const READ_OPERATOR_MAX_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

const text = (value) => String(value ?? "").trim();
const hashPattern = /^sha256:[a-f0-9]{64}$/i;

const REQUEST_SCOPE_ARRAY_KEYS = ["offerIds", "productIds"];
const REQUEST_SCOPE_TEXT_KEYS = [
  "cursor", "lastId", "since", "to", "sortDir", "dir", "status",
  "cutoffFrom", "cutoffTo", "deliveringDateFrom", "deliveringDateTo",
  "language", "visibility",
];
const REQUEST_SCOPE_NUMBER_KEYS = ["descriptionCategoryId", "typeId", "attributeId", "taskId", "offset"];

function normalizeReadRequestScope(scope = {}) {
  const input = scope && typeof scope === "object" && !Array.isArray(scope) ? scope : {};
  const normalized = {
    name: text(input.name || input.kind),
    offerCount: Math.max(0, Math.min(1000, Number(input.offerCount || 0))),
  };
  for (const key of REQUEST_SCOPE_ARRAY_KEYS) {
    if (Array.isArray(input[key])) normalized[key] = [...new Set(input[key].map(text).filter(Boolean))].slice(0, 1000);
  }
  for (const key of REQUEST_SCOPE_TEXT_KEYS) {
    const value = text(input[key]);
    if (value) normalized[key] = value.slice(0, 200);
  }
  for (const key of REQUEST_SCOPE_NUMBER_KEYS) {
    const value = Number(key === "taskId" ? (input.taskId ?? input.task_id) : input[key]);
    if (Number.isSafeInteger(value) && value >= 0) normalized[key] = value;
  }
  return normalized;
}

export function validateReadOperatorPlan(plan = {}) {
  const errors = [];
  const store = plan.store && typeof plan.store === "object" ? plan.store : {};
  const storeId = text(store.id || store.clientId);
  const environment = text(plan.environment);
  const scope = normalizeReadRequestScope(plan.scope);
  const scopeName = text(scope.name);
  const endpoints = Array.isArray(plan.endpoints) ? [...new Set(plan.endpoints.map(text).filter(Boolean))] : [];
  const invalidEndpoints = endpoints.filter((endpoint) => !READ_ENDPOINTS.has(endpoint));
  const maxAgeMs = Number(plan.maxAgeMs);
  if (!storeId) errors.push({ code: "READ_OPERATOR_STORE_REQUIRED", message: "必须先选择明确店铺。" });
  if (!environment) errors.push({ code: "READ_OPERATOR_ENVIRONMENT_REQUIRED", message: "必须填写本次读取环境标识。" });
  if (!scopeName) errors.push({ code: "READ_OPERATOR_SCOPE_REQUIRED", message: "必须填写明确的读取范围。" });
  if (!endpoints.length) errors.push({ code: "READ_OPERATOR_ENDPOINT_SCOPE_REQUIRED", message: "必须列出本次读取端点范围。" });
  if (invalidEndpoints.length) errors.push({ code: "READ_OPERATOR_ENDPOINT_NOT_ALLOWLISTED", message: "端点不在受控只读白名单内。", endpoints: invalidEndpoints });
  if (plan.readOnly !== true || plan.writeAttempted === true) errors.push({ code: "READ_OPERATOR_READ_ONLY_REQUIRED", message: "运维入口必须明确只读且未尝试写入。" });
  if (text(plan.confirm) !== LIVE_CONFIRMATION) errors.push({ code: "READ_OPERATOR_CONFIRMATION_REQUIRED", message: "必须人工确认本次只读操作。" });
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < READ_OPERATOR_MIN_FRESHNESS_MS || maxAgeMs > READ_OPERATOR_MAX_FRESHNESS_MS) errors.push({ code: "READ_OPERATOR_FRESHNESS_INVALID", message: "新鲜度窗口必须在 1 分钟至 7 天之间。" });
  return { ok: errors.length === 0, errors, readOnly: plan.readOnly === true && plan.writeAttempted !== true, storeRefPresent: Boolean(storeId), environmentPresent: Boolean(environment), scope: { ...scope, name: scopeName }, endpoints: endpoints.filter((endpoint) => READ_ENDPOINTS.has(endpoint)).sort(), freshness: { maxAgeMs: Number.isFinite(maxAgeMs) ? maxAgeMs : null, minAgeMs: READ_OPERATOR_MIN_FRESHNESS_MS, maxAllowedAgeMs: READ_OPERATOR_MAX_FRESHNESS_MS } };
}

/**
 * Stable, non-secret binding for the exact plan that was locally approved.
 * Confirmation text is intentionally excluded; it is validated separately and
 * must never become a durable token.  A save request must present this binding
 * together with the same plan, so approving plan A cannot persist evidence for B.
 */
export function buildReadOperatorPlanBinding(plan = {}) {
  const validation = validateReadOperatorPlan(plan);
  if (!validation.ok) return "";
  return scopeHash({
    storeRef: scopeHash(text(plan.store?.id || plan.store?.clientId)),
    environmentRef: scopeHash(text(plan.environment)),
    scope: validation.scope,
    endpoints: validation.endpoints,
    deprecatedEndpoints: validation.endpoints.filter((endpoint) => DEPRECATED_READ_ENDPOINTS.has(endpoint)),
    maxAgeMs: validation.freshness.maxAgeMs,
    readOnly: validation.readOnly,
  });
}

export function validateReadOperatorPlanBinding(plan = {}, binding = "") {
  const expected = buildReadOperatorPlanBinding(plan);
  const supplied = text(binding);
  return {
    ok: Boolean(expected && supplied && supplied === expected),
    reasonCode: expected && supplied ? "READ_OPERATOR_PLAN_BINDING_MISMATCH" : "READ_OPERATOR_PLAN_BINDING_REQUIRED",
    expected,
  };
}

/**
 * Return the stable identity of a read operation.  A transport retry token or
 * caller supplied Idempotency-Key is deliberately not part of this identity:
 * if a read times out, the seller must reconcile the same approved scope
 * before treating another attempt as a new operation.
 */
export function buildReadOperatorOperationKey(plan = {}) {
  const validation = validateReadOperatorPlan(plan);
  const storeId = text(plan.store?.id || plan.store?.clientId);
  if (!storeId || !text(plan.environment) || !validation.scope?.name) return "";
  return scopeHash({
    storeRefHash: scopeHash(storeId),
    environmentRefHash: scopeHash(text(plan.environment)),
    scope: validation.scope,
    endpoints: validation.endpoints,
  });
}

/**
 * Local-only projection used by the operator summary CLI.  It validates a
 * plan without loading credentials or invoking a transport, and deliberately
 * omits the confirmation token and raw store/environment values.
 */
export function buildReadOperatorPlanSummary(plan = {}) {
  const validation = validateReadOperatorPlan(plan);
  return {
    summaryType: "controlled_read_operator_plan",
    ok: validation.ok,
    readOnly: validation.readOnly,
    storeRefPresent: validation.storeRefPresent,
    environmentPresent: validation.environmentPresent,
    scope: validation.scope,
    endpoints: validation.endpoints,
    deprecatedEndpoints: validation.endpoints.filter((endpoint) => DEPRECATED_READ_ENDPOINTS.has(endpoint)),
    freshness: validation.freshness,
    errors: validation.errors.map(({ code, message, endpoints }) => ({
      code,
      message,
      ...(Array.isArray(endpoints) ? { endpoints } : {}),
    })),
    sideEffect: "仅校验本地计划；不会联网、读取店铺、写入 Ozon 或保存凭据。",
  };
}

/**
 * Summarize a bounded batch of store plans before any live read is considered.
 * This is deliberately local and hash-only: it helps the operator verify that
 * all selected stores have an explicit, non-duplicated read scope without
 * exposing store ids, credentials, or making a request.
 */
export function buildReadOperatorPlanMatrixSummary(plans = [], { expectedPrimaryStoreCount = null } = {}) {
  const entries = Array.isArray(plans) ? plans : [];
  const summaries = entries.map((plan) => {
    const summary = buildReadOperatorPlanSummary(plan);
    const storeId = text(plan?.store?.id || plan?.store?.clientId);
    const storeRefHash = storeId ? scopeHash(storeId) : "";
    const environment = text(plan?.environment);
    const environmentRefHash = environment ? scopeHash(environment) : "";
    const scopeRefHash = summary.scope?.name ? scopeHash(summary.scope) : "";
    const planBinding = buildReadOperatorPlanBinding(plan);
    const nextAction = summary.ok
      ? "人工确认当前店铺、环境和端点范围后，由服务端执行受控只读并保存脱敏回执。"
      : "先修复当前店铺计划的阻断项，再重新生成受控只读计划。";
    return {
      ok: summary.ok,
      // Seller-facing context only; keep the opaque hash for evidence and
      // never expose client ids or API keys in the matrix.
      storeLabel: text(plan?.store?.name || plan?.store?.label).slice(0, 120),
      storeRefHash,
      environmentRefHash,
      scopeRefHash,
      planBinding,
      endpoints: summary.endpoints,
      deprecatedEndpoints: summary.deprecatedEndpoints,
      scope: summary.scope,
      errors: summary.errors,
      nextAction,
      // This is an explicit expectation, not a claim that a live read has
      // happened.  Keeping the binding and missing endpoint coverage beside
      // the plan gives the seller a concrete receipt contract to reconcile
      // after the server execution route returns.
      receipt: {
        status: "not_started",
        verificationLevel: "configuration_declared",
        persisted: false,
        storeRefHash,
        environmentRefHash,
        scopeRefHash,
        endpointCoverage: {
          requested: summary.endpoints,
          observed: [],
          missing: summary.endpoints,
          complete: false,
        },
        nextAction: "执行后检查同一店铺、环境、范围和端点的服务端脱敏回执；未保存回执不能升级真实读取等级。",
      },
    };
  });
  const seen = new Set();
  const duplicateStoreIndexes = [];
  summaries.forEach((entry, index) => {
    if (!entry.storeRefHash) return;
    if (seen.has(entry.storeRefHash)) duplicateStoreIndexes.push(index);
    seen.add(entry.storeRefHash);
  });
  const validCount = summaries.filter((entry) => entry.ok).length;
  const errors = [];
  if (!summaries.length) errors.push({ code: "READ_OPERATOR_PLAN_MATRIX_EMPTY", message: "至少需要一个明确店铺的只读计划。" });
  const expectedCount = Number(expectedPrimaryStoreCount);
  if (Number.isSafeInteger(expectedCount) && expectedCount > 0 && summaries.length !== expectedCount) {
    errors.push({ code: "READ_OPERATOR_PLAN_MATRIX_CANONICAL_SCOPE_MISMATCH", message: "受控只读计划数量与 canonical 主店铺数量不一致，不能作为四店铺计划证据。", expectedCount, actualCount: summaries.length });
  }
  if (duplicateStoreIndexes.length) errors.push({ code: "READ_OPERATOR_PLAN_MATRIX_DUPLICATE_STORE", message: "批量只读计划包含重复店铺，必须拆分或去重。", indexes: duplicateStoreIndexes });
  return {
    summaryType: "controlled_read_operator_plan_matrix",
    ok: summaries.length > 0 && validCount === summaries.length && errors.length === 0,
    total: summaries.length,
    validCount,
    duplicateStoreIndexes,
    stores: summaries,
    errors,
    sideEffect: "仅校验批量只读计划；不会联网、读取店铺、写入 Ozon 或保存凭据。",
  };
}

/** Validate a single plan against a server-verified, hash-only session proof. */
export function buildReadOperatorSessionGate(plan = {}, { sessionProof = null } = {}) {
  const planCheck = validateReadOperatorPlan(plan);
  const errors = [...planCheck.errors];
  const proof = sessionProof && typeof sessionProof === "object" && !Array.isArray(sessionProof) ? sessionProof : {};
  const authSource = text(proof.authSource).toLowerCase();
  const proofRefHash = text(proof.proofRefHash);
  const proofLevel = text(proof.verificationLevel).toLowerCase();
  if (proof.verified !== true || proofLevel !== "server_verified" || !hashPattern.test(proofRefHash) || !["session_cookie", "session_bearer"].includes(authSource)) {
    errors.push({ code: "READ_OPERATOR_SIGNED_SESSION_REQUIRED", message: "真实读取前必须提供服务端验证过的 signed session；静态密钥或空证明不能通过。" });
  }
  const environment = text(plan.environment);
  const proofEnvironment = text(proof.environment);
  if (!proofEnvironment || !environment || proofEnvironment !== environment) {
    errors.push({ code: "READ_OPERATOR_SESSION_ENVIRONMENT_MISMATCH", message: "signed session 的环境必须与只读计划使用同一环境标识。" });
  }
  const storeId = text(plan.store?.id || plan.store?.clientId);
  const proofStores = [...new Set((Array.isArray(proof.storeIds) ? proof.storeIds : []).map(text).filter(Boolean))];
  if (!storeId || !proofStores.includes(storeId)) {
    errors.push({ code: "READ_OPERATOR_SESSION_SCOPE_REQUIRED", message: "signed session 必须明确覆盖当前只读计划的店铺范围。" });
  }
  return {
    gateType: "controlled_read_signed_session_preflight",
    ok: errors.length === 0,
    executionAllowed: false,
    verificationLevel: "configuration_declared",
    storeRefHash: storeId ? scopeHash(storeId) : "",
    environmentRefHash: environment ? scopeHash(environment) : "",
    proofRefHash: hashPattern.test(proofRefHash) && proofLevel === "server_verified" ? proofRefHash : "",
    authSource: ["session_cookie", "session_bearer"].includes(authSource) && proof.verified === true ? authSource : "",
    sessionProofVerification: "declaration_only",
    errors,
    sideEffect: "仅校验单店只读 session 前置边界；不会联网、读取 Ozon、写入 Ozon 或保存 Token/凭据。",
    nextAction: errors.length
      ? "先由服务端签发匹配环境和店铺范围的短期 session，修复计划后再执行受控只读。"
      : "单店计划和 signed session 声明匹配；仍需服务端再次验签和人工确认后执行读取。",
  };
}

/**
 * Local-only gate for the canonical four-store read runbook.  The matrix is
 * deliberately not a credential/session verifier: a caller must provide a
 * server-verified session proof declaration, matching environment and the
 * exact canonical store scope before a later live runner may be considered.
 * This function never opens a transport and never upgrades a receipt.
 */
export function buildCanonicalReadOperatorSessionGate(plans = [], {
  canonicalStores = [],
  sessionProof = null,
  expectedPrimaryStoreCount = 4,
} = {}) {
  const matrix = buildReadOperatorPlanMatrixSummary(plans, { expectedPrimaryStoreCount });
  const errors = [...matrix.errors];
  const canonicalIds = [...new Set((Array.isArray(canonicalStores) ? canonicalStores : [])
    .map((store) => text(store?.id || store?.clientId)).filter(Boolean))];
  if (canonicalIds.length !== expectedPrimaryStoreCount) {
    errors.push({ code: "READ_OPERATOR_CANONICAL_STORE_SCOPE_REQUIRED", message: "canonical 主店铺范围必须恰好包含四个 primary 店铺。" });
  }
  const canonicalSet = new Set(canonicalIds);
  const planIds = [...new Set((Array.isArray(plans) ? plans : [])
    .map((plan) => text(plan?.store?.id || plan?.store?.clientId)).filter(Boolean))];
  const missingCanonical = canonicalIds.filter((id) => !planIds.includes(id));
  const unexpectedPlans = planIds.filter((id) => !canonicalSet.has(id));
  if (missingCanonical.length || unexpectedPlans.length) {
    errors.push({ code: "READ_OPERATOR_CANONICAL_STORE_SCOPE_MISMATCH", message: "读取计划必须逐一覆盖 canonical 四店铺，不能漏店或混入其他店铺。" });
  }
  const firstPlan = Array.isArray(plans) && plans.length ? plans[0] : {};
  const singleSessionGate = buildReadOperatorSessionGate(firstPlan, { sessionProof });
  errors.push(...singleSessionGate.errors.filter((error) => !matrix.errors.some((item) => item.code === error.code)));
  const proof = sessionProof && typeof sessionProof === "object" && !Array.isArray(sessionProof) ? sessionProof : {};
  const authSource = text(proof.authSource).toLowerCase();
  const proofRefHash = text(proof.proofRefHash);
  const proofLevel = text(proof.verificationLevel).toLowerCase();
  const planEnvironments = [...new Set((Array.isArray(plans) ? plans : []).map((plan) => text(plan?.environment)).filter(Boolean))];
  const proofEnvironment = text(proof.environment);
  if (!proofEnvironment || planEnvironments.length !== 1 || planEnvironments[0] !== proofEnvironment) {
    errors.push({ code: "READ_OPERATOR_SESSION_ENVIRONMENT_MISMATCH", message: "signed session 的环境必须与四店铺计划使用同一环境标识。" });
  }
  const proofStores = [...new Set((Array.isArray(proof.storeIds) ? proof.storeIds : []).map(text).filter(Boolean))];
  if (proofStores.length !== canonicalIds.length || canonicalIds.some((id) => !proofStores.includes(id))) {
    errors.push({ code: "READ_OPERATOR_SESSION_SCOPE_REQUIRED", message: "signed session 必须明确覆盖 canonical 四店铺范围。" });
  }
  return {
    gateType: "canonical_four_store_signed_session_preflight",
    ok: errors.length === 0,
    executionAllowed: false,
    verificationLevel: "configuration_declared",
    canonicalStoreCount: canonicalIds.length,
    planStoreCount: planIds.length,
    storeRefs: canonicalIds.map((id) => scopeHash(id)).sort(),
    environmentRefHash: proofEnvironment ? scopeHash(proofEnvironment) : "",
    authSource: ["session_cookie", "session_bearer"].includes(authSource) && proof.verified === true ? authSource : "",
    proofRefHash: hashPattern.test(proofRefHash) && proofLevel === "server_verified" ? proofRefHash : "",
    sessionProofVerification: "declaration_only",
    errors,
    sideEffect: "仅校验四店铺 signed session 前置边界；不会联网、读取 Ozon、写入 Ozon 或保存 Token/凭据。",
    nextAction: errors.length
      ? "先由服务端签发匹配环境和四店铺范围的短期 session，修复计划缺店/越界后再逐店执行受控只读。"
      : "四店铺计划和 signed session 声明匹配；仍需人工确认，并由服务端再次验证 session 后执行读取。",
  };
}

/**
 * Audit the boundary between a local plan preview and a live read.  This is
 * intentionally a pure function: it never loads credentials or calls a
 * transport.  A live invocation must provide an audit artifact path so an
 * operator cannot accidentally perform an unrecorded read.  The artifact is
 * still only a local/client-side record; it must not be treated as a durable
 * server_observed receipt until the server receipt repository validates it.
 */
export function buildReadOperatorExecutionPreflight(plan = {}, {
  executeLive = false,
  outputPath = "",
  credentialAvailable = true,
  outputExists = false,
  allowOverwrite = false,
} = {}) {
  const summary = buildReadOperatorPlanSummary(plan);
  const errors = [...summary.errors];
  const requested = executeLive === true;
  const artifactPath = text(outputPath);
  // Keep the execution boundary auditable without returning any raw store,
  // environment, or filesystem value.  The hashes below are the minimum
  // binding an operator can compare with a later server receipt.
  const storeId = text(plan?.store?.id || plan?.store?.clientId);
  const executionPlan = {
    storeRefHash: storeId ? scopeHash(storeId) : "",
    environmentRefHash: text(plan?.environment) ? scopeHash(text(plan.environment)) : "",
    scopeRefHash: summary.scope?.name ? scopeHash(summary.scope) : "",
    endpoints: summary.endpoints,
    planBinding: buildReadOperatorPlanBinding(plan),
  };
  if (requested && !artifactPath) {
    errors.push({ code: "READ_OPERATOR_AUDIT_OUTPUT_REQUIRED", message: "真实只读执行必须指定脱敏审计输出文件；缺少输出文件时停止执行。" });
  }
  const pathSegments = artifactPath.split(/[\\/]+/);
  const unsafeArtifactPath = artifactPath === "-"
    || artifactPath.includes("\0")
    || pathSegments.includes("..")
    || !/\.json$/i.test(artifactPath)
    || /(?:ozonapi|\.env|credential|secret|api[-_]?key)/i.test(artifactPath);
  if (requested && artifactPath && unsafeArtifactPath) {
    errors.push({ code: "READ_OPERATOR_AUDIT_OUTPUT_UNSAFE", message: "审计输出必须是独立的 JSON 文件，不能指向凭据、环境或密钥文件。" });
  }
  if (requested && outputExists === true && allowOverwrite !== true) {
    errors.push({ code: "READ_OPERATOR_AUDIT_OUTPUT_EXISTS", message: "审计输出文件已存在；为避免覆盖历史证据，必须改用新文件或显式允许覆盖。" });
  }
  if (requested && credentialAvailable !== true) {
    errors.push({ code: "READ_OPERATOR_CREDENTIAL_REQUIRED", message: "真实只读执行缺少店铺凭据；停止执行。" });
  }
  return {
    preflightType: "controlled_read_execution_preflight",
    ok: errors.length === 0,
    executionRequested: requested,
    executionAllowed: requested && errors.length === 0,
    execution: requested ? (errors.length === 0 ? "allowed" : "blocked") : "not_requested",
    outputPathPresent: Boolean(artifactPath),
    outputExists: requested ? outputExists === true : false,
    overwriteAllowed: requested ? allowOverwrite === true : false,
    outputPathHash: artifactPath ? scopeHash(artifactPath) : "",
    executionPlan,
    credentialAvailable: requested ? credentialAvailable === true : false,
    errors: errors.map(({ code, message, endpoints }) => ({
      code,
      message,
      ...(Array.isArray(endpoints) ? { endpoints } : {}),
    })),
    sideEffect: "本审计仅校验执行边界；不会联网、读取店铺、写入 Ozon 或保存凭据。",
  };
}

export function validateReadOperatorReceipt(plan = {}, receipt = {}, now = Date.now()) {
  const planCheck = validateReadOperatorPlan(plan);
  const errors = [...planCheck.errors];
  const receiptStore = text(receipt.storeRefHash || receipt.storeHash);
  const receiptEnvironment = text(receipt.environmentRefHash || receipt.environmentHash);
  const receiptScope = text(receipt.scopeRefHash || receipt.scopeHash || receipt.scopeRef);
  const expectedStore = text(plan.store?.id || plan.store?.clientId) ? scopeHash(text(plan.store?.id || plan.store?.clientId)) : "";
  const expectedEnvironment = text(plan.environment) ? scopeHash(text(plan.environment)) : "";
  const expectedScope = planCheck.scope?.name ? scopeHash(planCheck.scope) : "";
  if (receipt.verificationLevel !== "server_observed" || receipt.persisted !== true) errors.push({ code: "READ_OPERATOR_RECEIPT_NOT_PERSISTED", message: "回执不是服务端持久化的 server_observed 证据。" });
  if (!hashPattern.test(receiptStore) || !hashPattern.test(receiptEnvironment)) errors.push({ code: "READ_OPERATOR_RECEIPT_SCOPE_HASH_INVALID", message: "回执缺少有效店铺/环境哈希。" });
  if (expectedStore && receiptStore && receiptStore !== expectedStore) errors.push({ code: "READ_OPERATOR_RECEIPT_STORE_MISMATCH", message: "回执店铺哈希与当前运维计划不一致。" });
  if (expectedEnvironment && receiptEnvironment && receiptEnvironment !== expectedEnvironment) errors.push({ code: "READ_OPERATOR_RECEIPT_ENVIRONMENT_MISMATCH", message: "回执环境哈希与当前运维计划不一致。" });
  if (!hashPattern.test(receiptScope) || receiptScope !== expectedScope) errors.push({ code: "READ_OPERATOR_RECEIPT_SCOPE_MISMATCH", message: "回执读取范围哈希与当前运维计划不一致。" });
  const receiptEndpoints = [...new Set((Array.isArray(receipt.endpoints) ? receipt.endpoints : []).map(text).filter(Boolean))].sort();
  const expectedEndpoints = [...planCheck.endpoints].sort();
  if (receiptEndpoints.some((endpoint) => !READ_ENDPOINTS.has(endpoint))) errors.push({ code: "READ_OPERATOR_RECEIPT_ENDPOINT_NOT_ALLOWLISTED", message: "回执包含不在受控只读白名单中的端点。" });
  if (expectedEndpoints.length && receiptEndpoints.some((endpoint) => !expectedEndpoints.includes(endpoint))) {
    errors.push({ code: "READ_OPERATOR_RECEIPT_ENDPOINT_SCOPE_MISMATCH", message: "回执端点覆盖与当前运维计划不一致。" });
  }
  // A persisted receipt with no (or only a subset of) observed endpoints is
  // not evidence for the approved read scope.  Keep this separate from the
  // unexpected-endpoint error so the seller task can explain that coverage
  // must be completed rather than treating the receipt as a binding failure.
  const missingEndpoints = expectedEndpoints.filter((endpoint) => !receiptEndpoints.includes(endpoint));
  if (missingEndpoints.length) {
    errors.push({ code: "READ_OPERATOR_RECEIPT_ENDPOINT_COVERAGE_INCOMPLETE", message: "回执未覆盖运维计划中的全部只读端点。", endpoints: missingEndpoints });
  }
  const checkedAtMs = Date.parse(String(receipt.checkedAt || ""));
  const age = Number.isFinite(checkedAtMs) ? now - checkedAtMs : Infinity;
  if (!Number.isFinite(checkedAtMs) || checkedAtMs > now) errors.push({ code: "READ_OPERATOR_RECEIPT_TIME_INVALID", message: "回执时间无效或来自未来。" });
  if (Number.isFinite(plan.maxAgeMs) && age > Number(plan.maxAgeMs)) errors.push({ code: "READ_OPERATOR_RECEIPT_STALE", message: "回执已超过运维计划的新鲜度窗口。" });
  return { ok: errors.length === 0, errors, receiptValid: errors.length === 0, freshness: { checkedAt: Number.isFinite(checkedAtMs) ? new Date(checkedAtMs).toISOString() : "", ageMs: Number.isFinite(age) ? age : null } };
}

export function buildReadOperatorExecutionSummary(plan = {}, receipt = {}, now = Date.now()) {
  const validation = validateReadOperatorReceipt(plan, receipt, now);
  return { receiptValid: validation.receiptValid, status: String(receipt.status || "unknown"), verificationLevel: String(receipt.verificationLevel || ""), storeRefHash: text(receipt.storeRefHash || receipt.storeHash), environmentRefHash: text(receipt.environmentRefHash || receipt.environmentHash), endpoints: Array.isArray(receipt.endpoints) ? receipt.endpoints.map(text).filter(Boolean).sort() : [], responseHash: hashPattern.test(text(receipt.responseHash)) ? text(receipt.responseHash) : "", freshness: validation.freshness, errors: validation.errors.map((error) => error.code) };
}

/**
 * Model recovery after an interrupted/unknown read.  Reads have no write side
 * effect, but an incomplete response is still not evidence that can be
 * silently replaced by a retry.  The operation key is derived only from the
 * approved plan, so changing a caller idempotency key cannot bypass review.
 */
export function buildReadOperatorRecoveryState(plan = {}, receipt = {}, {
  requestedIdempotencyKey = "",
} = {}) {
  const status = text(receipt.status).toLowerCase();
  const scenario = text(receipt.failureScenario).toLowerCase();
  const unknownOutcome = receipt.readSucceeded === false
    || receipt.observedFailure === true
    || ["unknown", "failed", "error", "partial"].includes(status)
    || /timeout|timed.?out|unknown|network|dependency|5xx|server/i.test(scenario);
  const timeout = /timeout|timed.?out|deadline/i.test(`${scenario} ${text(receipt.errorType)}`.toLowerCase());
  const operationKey = buildReadOperatorOperationKey(plan);
  const needsReview = unknownOutcome || !operationKey;
  return {
    status: needsReview ? "needs_review" : "ready",
    code: !operationKey
      ? "READ_OPERATION_SCOPE_INVALID"
      : timeout
        ? "READ_TIMEOUT_RECONCILIATION_REQUIRED"
        : unknownOutcome
          ? "READ_UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED"
          : "READ_OPERATION_RECONCILED",
    operationKey,
    retryAllowed: !needsReview,
    retryPolicy: needsReview ? "reconcile_same_plan_before_retry" : "same_plan_only",
    callerIdempotencyKeyIgnored: Boolean(text(requestedIdempotencyKey)),
    nextAction: needsReview
      ? "保留当前回执和操作范围，先按同一店铺/环境/范围核对端点结果；核对完成前禁止用新幂等键重试。"
      : "操作范围已完成核对，可按同一计划继续读取。",
  };
}

/**
 * Build a seller-safe report for a controlled read operation.  The report is
 * deliberately a projection: it contains hashes, allowlisted endpoint names,
 * failure classifications and freshness only.  Raw responses, credentials,
 * environment text and store identifiers never cross this boundary.
 */
export function buildReadOperatorReport(plan = {}, receipt = {}, now = Date.now()) {
  const summary = buildReadOperatorExecutionSummary(plan, receipt, now);
  const recovery = buildReadOperatorRecoveryState(plan, receipt);
  const planCheck = validateReadOperatorPlan(plan);
  const requested = [...new Set(planCheck.endpoints)].sort();
  const observed = [...new Set((Array.isArray(receipt.endpoints) ? receipt.endpoints : [])
    .map(text)
    .filter((endpoint) => READ_ENDPOINTS.has(endpoint)))].sort();
  const requestedSet = new Set(requested);
  const observedSet = new Set(observed);
  const missing = requested.filter((endpoint) => !observedSet.has(endpoint));
  const unexpected = observed.filter((endpoint) => !requestedSet.has(endpoint));
  const endpointComplete = requested.length > 0 && missing.length === 0 && unexpected.length === 0;

  const rawScenarios = [...new Set([
    ...(Array.isArray(receipt.failureScenarios) ? receipt.failureScenarios : []),
    receipt.failureScenario,
  ].map(text).filter(Boolean))].slice(0, 10);
  const scenarios = rawScenarios.map((scenario) => {
    const normalized = scenario.toLowerCase();
    if (/permission|forbidden|unauthor|401|403/.test(normalized)) return "permission_denied";
    if (/rate|throttl|429/.test(normalized)) return "rate_limited";
    if (/server|dependency|network|5xx/.test(normalized)) return "server_or_dependency_failure";
    if (/timeout/.test(normalized)) return "timeout";
    return "observed_read_failure";
  }).filter((scenario, index, list) => list.indexOf(scenario) === index);
  const serverObservedPersisted = receipt.verificationLevel === "server_observed" && receipt.persisted === true;
  // A CLI/client artifact can carry a live-read label from the injected
  // harness, but until the server receipt repository persists and validates
  // it, it must not be presented as server-observed evidence.
  const artifactStatus = serverObservedPersisted ? "server_observed_persisted" : "client_artifact_not_persisted";
  const permissionScenarioObserved = scenarios.includes("permission_denied");
  const rateLimitScenarioObserved = scenarios.includes("rate_limited");
  const serverFailureScenarioObserved = scenarios.includes("server_or_dependency_failure");
  const permissionFailureVerified = serverObservedPersisted
    && permissionScenarioObserved
    && receipt.permissionFailureVerified === true;
  const rateLimitFailureVerified = serverObservedPersisted
    && rateLimitScenarioObserved
    && receipt.rateLimitFailureVerified === true;
  const serverFailureVerified = serverObservedPersisted
    && serverFailureScenarioObserved
    && receipt.serverFailureVerified === true;
  const observedFailure = receipt.observedFailure === true || scenarios.length > 0 || receipt.readSucceeded === false;
  if (observedFailure && scenarios.length === 0) scenarios.push("observed_read_failure");
  const stale = summary.errors.includes("READ_OPERATOR_RECEIPT_STALE");
  const coverageIncomplete = summary.errors.includes("READ_OPERATOR_RECEIPT_ENDPOINT_COVERAGE_INCOMPLETE");
  const invalid = !summary.receiptValid;
  let nextStep = "保存本次安全回执并继续人工审计；本报告不会触发任何写入。";
  if (invalid && stale) nextStep = "重新执行同一店铺、环境和范围的受控只读读取，保存新回执。";
  else if (invalid && coverageIncomplete) nextStep = "补齐回执中的缺失只读端点覆盖后，再重新执行受控读取。";
  else if (invalid) nextStep = "先修复只读计划或回执绑定错误，再重新执行受控读取。";
  else if (permissionFailureVerified) nextStep = "检查店铺授权和角色权限，修复后重新执行受控只读读取。";
  else if (rateLimitFailureVerified) nextStep = "等待限流窗口结束后，按原范围重新执行受控只读读取。";
  else if (!endpointComplete) nextStep = "补齐缺失的只读端点覆盖后，再判定本次读取是否完整。";
  else if (observedFailure) nextStep = "保留失败分类和回执哈希，先处理读取依赖或服务异常，再重新读取。";

  return {
    reportType: "controlled_read_operator_report",
    receiptValid: summary.receiptValid,
    status: ["success", "failed", "error", "forbidden", "unauthorized", "rate_limited", "partial", "unknown"].includes(summary.status.toLowerCase()) ? summary.status.toLowerCase() : "unknown",
    verificationLevel: serverObservedPersisted
      ? "server_observed"
      : summary.verificationLevel === "locally_tested" ? "locally_tested" : "",
    artifactStatus,
    readOnly: receipt.readOnly !== false && receipt.writeAttempted !== true,
    storeRefHash: summary.storeRefHash,
    environmentRefHash: summary.environmentRefHash,
    scope: planCheck.scope,
    endpointCoverage: { requested, observed, missing, unexpected, complete: endpointComplete },
    failure: {
      observed: observedFailure,
      scenarios,
      permissionVerified: permissionFailureVerified,
      rateLimitVerified: rateLimitFailureVerified,
      serverVerified: serverFailureVerified,
    },
    freshness: { ...summary.freshness, maxAgeMs: planCheck.freshness.maxAgeMs, stale },
    responseHash: summary.responseHash,
    recovery,
    errors: summary.errors,
    nextStep,
  };
}

/**
 * Convert a bounded read observation into the task a seller can act on.
 * HTTP/status details remain an implementation diagnostic; the normal UI
 * should show a reason, one next action, and the side effect guarantee.
 */
export function buildReadFailureSellerTask(receipt = {}) {
  // Server receipts intentionally keep only bounded observation metadata.  Use
  // those observations as failure evidence too; otherwise a persisted 403/429
  // receipt would be rendered as a generic failure and the seller would lose
  // the actionable permission/rate-limit recovery step.
  const evidence = [
    ...(Array.isArray(receipt.failureEvidence) ? receipt.failureEvidence : []),
    ...(Array.isArray(receipt.observations) ? receipt.observations : []),
  ];
  const statusCodes = evidence
    .map((entry) => Number(entry?.statusCode || entry?.httpStatus || 0))
    .filter((status) => Number.isInteger(status) && status >= 100 && status <= 599);
  const status = String(receipt.status || "").toLowerCase();
  const readStatus = String(receipt.readStatus || "").toLowerCase();
  // A successful response can still be unusable after its freshness window.
  // Do this check before the generic "ready" fallback: stale evidence must
  // never tell a seller that the current store state is safe to act on.
  const stale = receipt.stale === true
    || String(receipt.freshnessStatus || "").toLowerCase() === "stale"
    || status === "stale"
    || receipt.freshness?.stale === true;
  const partial = receipt.partial === true
    || readStatus === "partial"
    || receipt.coverageComplete === false
    || receipt.endpointCoverageComplete === false;
  const permission = statusCodes.some((code) => code === 401 || code === 403)
    || ["forbidden", "unauthorized", "permission_denied"].includes(status)
    || /permission|forbidden|unauthor/i.test(String(receipt.failureScenario || ""));
  const rateLimited = statusCodes.includes(429) || ["rate_limited", "throttled", "too_many_requests"].includes(status)
    || /rate|throttl|429/i.test(String(receipt.failureScenario || ""));
  const timeout = /timeout|timed.?out|deadline/i.test([
    receipt.failureScenario,
    receipt.errorType,
    receipt.reasonCode,
    ...evidence.map((entry) => [entry?.failureScenario, entry?.errorType, entry?.reasonCode].filter(Boolean).join(" ")),
  ].filter(Boolean).join(" "));
  const serverFailure = statusCodes.some((code) => code >= 500)
    || ["dependency_failed", "network_error", "server_error"].includes(status);
  let task;
  if (stale) {
    task = { status: "needs_review", code: "READ_EVIDENCE_STALE", title: "只读证据已过期", nextAction: "按同一店铺和读取范围重新执行只读回查；新鲜回执返回前不要修改商品、库存或订单。" };
  } else if (permission) {
    task = { status: "blocked", code: "READ_PERMISSION_REQUIRED", title: "店铺只读权限不足", nextAction: "检查该店铺 Seller API 授权和账号角色，修复后重新执行只读读取。" };
  } else if (rateLimited) {
    task = { status: "waiting", code: "READ_RATE_LIMITED", title: "读取受到限流", nextAction: "等待限流窗口结束后，按原店铺和范围重新读取；不要连续点击重试。" };
  } else if (timeout) {
    task = { status: "needs_review", code: "READ_TIMEOUT_RECONCILIATION_REQUIRED", title: "只读读取超时，结果需要核对", nextAction: "保留同一店铺、环境、范围和操作计划，先核对当前端点回执；核对完成前不要用新幂等键重试。" };
  } else if (serverFailure || receipt.readSucceeded === false || ["failed", "error", "unknown"].includes(status)) {
    task = { status: "needs_review", code: "READ_DEPENDENCY_FAILED", title: "店铺状态暂时无法读取", nextAction: "检查只读连接或稍后重试；在重新读取前不要据此修改商品、库存或订单。" };
  } else if (partial) {
    task = { status: "needs_review", code: "READ_EVIDENCE_PARTIAL", title: "只读证据不完整", nextAction: "继续读取下一页并补齐缺失商品详情，再判断本次结果。" };
  } else {
    task = { status: "ready", code: "READ_EVIDENCE_READY", title: "只读证据已读取", nextAction: "查看同步时间和范围；只有完整且新鲜的证据才能推进后续操作。" };
  }
  return {
    ...task,
    sideEffect: "本次仅读取和保存脱敏证据，不会写入 Ozon、不修改商品、库存或订单。",
  };
}
