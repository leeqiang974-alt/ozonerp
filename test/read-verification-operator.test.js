import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_CONFIRMATION, READ_ENDPOINTS, scopeHash } from "../src/readVerificationHarness.js";
import { validateReadOperatorPlan, validateReadOperatorReceipt, buildReadOperatorExecutionSummary, buildReadOperatorPlanBinding, validateReadOperatorPlanBinding, buildReadOperatorRecoveryState } from "../src/readVerificationOperator.js";

const endpoint = [...READ_ENDPOINTS][0] || "/v3/product/list";
const basePlan = { store: { id: "store-1" }, environment: "env-1", scope: { name: "single_offer", offerCount: 1 }, endpoints: [endpoint], readOnly: true, writeAttempted: false, confirm: LIVE_CONFIRMATION, maxAgeMs: 60 * 60 * 1000 };

test("operator plan accepts explicit read-only scope", () => {
  const result = validateReadOperatorPlan(basePlan);
  assert.equal(result.ok, true);
  assert.deepEqual(result.endpoints, [endpoint]);
});

test("plan binding is stable for the approved plan and rejects store/scope drift", () => {
  const binding = buildReadOperatorPlanBinding(basePlan);
  assert.match(binding, /^sha256:[a-f0-9]{64}$/);
  assert.equal(validateReadOperatorPlanBinding(basePlan, binding).ok, true);
  assert.equal(validateReadOperatorPlanBinding({ ...basePlan, store: { id: "other-store" } }, binding).ok, false);
  assert.equal(validateReadOperatorPlanBinding({ ...basePlan, scope: { name: "single_offer", offerCount: 2 } }, binding).ok, false);
  assert.equal(validateReadOperatorPlanBinding(basePlan, "").ok, false);
});

test("operator plan rejects missing store and scope", () => {
  const result = validateReadOperatorPlan({ ...basePlan, store: {}, scope: {}, endpoints: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_STORE_REQUIRED"));
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_ENDPOINT_SCOPE_REQUIRED"));
});

test("operator plan binding includes endpoint request scope without credentials", () => {
  const plan = {
    ...basePlan,
    endpoints: ["/v3/product/list", "/v3/product/info/list", "/v4/product/info/stocks"],
    scope: { name: "single_offer", offerCount: 2, offerIds: ["SKU-1", "SKU-2"], cursor: "next" },
  };
  const validation = validateReadOperatorPlan(plan);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.scope.offerIds, ["SKU-1", "SKU-2"]);
  assert.equal(validation.scope.cursor, "next");
  assert.equal(JSON.stringify(validation).includes("apiKey"), false);
  const binding = buildReadOperatorPlanBinding(plan);
  assert.equal(validateReadOperatorPlanBinding(plan, binding).ok, true);
  assert.equal(validateReadOperatorPlanBinding({ ...plan, scope: { ...plan.scope, cursor: "other" } }, binding).ok, false);
});

test("import-info plan preserves task_id through operator validation and binding", () => {
  const plan = {
    ...basePlan,
    endpoints: ["/v1/product/import/info"],
    scope: { name: "import_task", taskId: 172549793 },
  };
  const validation = validateReadOperatorPlan(plan);
  assert.equal(validation.ok, true);
  assert.equal(validation.scope.taskId, 172549793);
  const binding = buildReadOperatorPlanBinding(plan);
  assert.equal(validateReadOperatorPlanBinding(plan, binding).ok, true);
  assert.equal(validateReadOperatorPlanBinding({ ...plan, scope: { ...plan.scope, taskId: 172549794 } }, binding).ok, false);
});

test("operator plan rejects unallowlisted endpoint and write posture", () => {
  const result = validateReadOperatorPlan({ ...basePlan, endpoints: ["/v1/write"], readOnly: false, writeAttempted: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_ENDPOINT_NOT_ALLOWLISTED"));
  assert.equal(result.readOnly, false);
});

test("operator plan rejects invalid confirmation and freshness", () => {
  const result = validateReadOperatorPlan({ ...basePlan, confirm: "", maxAgeMs: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_CONFIRMATION_REQUIRED"));
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_FRESHNESS_INVALID"));
});

test("receipt binding rejects drift and stale timestamp", () => {
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const result = validateReadOperatorReceipt({ ...basePlan, maxAgeMs: 60 * 1000 }, { verificationLevel: "server_observed", persisted: true, storeRefHash: scopeHash("store-1"), environmentRefHash: scopeHash("env-1"), scopeRefHash: scopeHash({ name: "single_offer", offerCount: 1 }), endpoints: [endpoint], checkedAt: old }, Date.now());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_RECEIPT_STALE"));
});

test("execution summary returns safe hashes only", () => {
  const receipt = { verificationLevel: "server_observed", persisted: true, storeRefHash: scopeHash("store-1"), environmentRefHash: scopeHash("env-1"), scopeRefHash: scopeHash({ name: "single_offer", offerCount: 1 }), checkedAt: new Date().toISOString(), status: "success", endpoints: [endpoint], responseHash: "sha256:" + "c".repeat(64) };
  const summary = buildReadOperatorExecutionSummary(basePlan, receipt);
  assert.equal(summary.receiptValid, true);
  assert.equal(summary.storeRefHash.startsWith("sha256:"), true);
  assert.equal("storeId" in summary, false);
});

test("receipt binding rejects a same-shape receipt from another store or environment", () => {
  const result = validateReadOperatorReceipt(basePlan, {
    verificationLevel: "server_observed",
    persisted: true,
    storeRefHash: scopeHash("other-store"),
    environmentRefHash: scopeHash("other-env"),
    scopeRefHash: scopeHash({ name: "single_offer", offerCount: 1 }),
    endpoints: [endpoint],
    checkedAt: new Date().toISOString(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_RECEIPT_STORE_MISMATCH"));
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_RECEIPT_ENVIRONMENT_MISMATCH"));
});

test("receipt binding rejects an endpoint outside the planned scope", () => {
  const result = validateReadOperatorReceipt(basePlan, {
    verificationLevel: "server_observed",
    persisted: true,
    storeRefHash: scopeHash("store-1"),
    environmentRefHash: scopeHash("env-1"),
    scopeRefHash: scopeHash({ name: "single_offer", offerCount: 1 }),
    endpoints: [endpoint, [...READ_ENDPOINTS].find((candidate) => candidate !== endpoint)],
    checkedAt: new Date().toISOString(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_RECEIPT_ENDPOINT_SCOPE_MISMATCH"));
});

test("receipt binding rejects an incomplete endpoint coverage", () => {
  const result = validateReadOperatorReceipt(basePlan, {
    verificationLevel: "server_observed",
    persisted: true,
    storeRefHash: scopeHash("store-1"),
    environmentRefHash: scopeHash("env-1"),
    scopeRefHash: scopeHash({ name: "single_offer", offerCount: 1 }),
    endpoints: [],
    checkedAt: new Date().toISOString(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "READ_OPERATOR_RECEIPT_ENDPOINT_COVERAGE_INCOMPLETE"));
});

test("unknown or timed-out read stays needs_review and a different idempotency key cannot bypass reconciliation", () => {
  const first = buildReadOperatorRecoveryState(basePlan, {
    status: "unknown",
    readSucceeded: false,
    observedFailure: true,
    failureScenario: "timeout",
  }, { requestedIdempotencyKey: "retry-key-1" });
  const second = buildReadOperatorRecoveryState(basePlan, {
    status: "unknown",
    readSucceeded: false,
    observedFailure: true,
    failureScenario: "timeout",
  }, { requestedIdempotencyKey: "retry-key-2" });
  assert.equal(first.status, "needs_review");
  assert.equal(first.code, "READ_TIMEOUT_RECONCILIATION_REQUIRED");
  assert.equal(first.retryAllowed, false);
  assert.equal(first.callerIdempotencyKeyIgnored, true);
  assert.equal(first.operationKey, second.operationKey);
  assert.equal(second.retryAllowed, false);
});

test("a complete read recovery key is derived from plan scope, not a caller retry token", () => {
  const result = buildReadOperatorRecoveryState(basePlan, {
    status: "success",
    readSucceeded: true,
    observedFailure: false,
  }, { requestedIdempotencyKey: "arbitrary-client-key" });
  assert.equal(result.status, "ready");
  assert.equal(result.retryAllowed, true);
  assert.match(result.operationKey, /^sha256:[a-f0-9]{64}$/);
});
