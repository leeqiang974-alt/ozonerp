import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_READ_ENDPOINTS, LIVE_CONFIRMATION, READ_ENDPOINTS } from "../src/readVerificationHarness.js";
import { buildCanonicalReadOperatorSessionGate, buildReadOperatorExecutionPreflight, buildReadOperatorPlanMatrixSummary, buildReadOperatorPlanSummary, buildReadOperatorSessionGate } from "../src/readVerificationOperator.js";
import { readFile } from "node:fs/promises";

const [firstEndpoint] = [...READ_ENDPOINTS];
const basePlan = {
  store: { id: "store-1" },
  environment: "staging-read",
  scope: { name: "single_offer", offerCount: 1 },
  endpoints: [firstEndpoint].filter(Boolean),
  readOnly: true,
  writeAttempted: false,
  confirm: LIVE_CONFIRMATION,
  maxAgeMs: 60 * 60 * 1000,
};

test("read operator plan summary is runnable and never exposes confirmation or credentials", () => {
  const summary = buildReadOperatorPlanSummary(basePlan);
  assert.equal(summary.ok, true);
  assert.equal(summary.storeRefPresent, true);
  assert.equal(summary.environmentPresent, true);
  assert.equal("confirm" in summary, false);
  assert.equal("apiKey" in summary, false);
  assert.match(summary.sideEffect, /不会联网/);
});

test("invalid read plan remains local and actionable", () => {
  const summary = buildReadOperatorPlanSummary({});
  assert.equal(summary.ok, false);
  assert.ok(summary.errors.some((error) => error.code === "READ_OPERATOR_STORE_REQUIRED"));
  assert.match(summary.sideEffect, /不会联网/);
});

test("live execution is blocked without an audit output artifact", () => {
  const preflight = buildReadOperatorExecutionPreflight(basePlan, {
    executeLive: true,
    credentialAvailable: true,
  });
  assert.equal(preflight.executionAllowed, false);
  assert.equal(preflight.execution, "blocked");
  assert.ok(preflight.errors.some((error) => error.code === "READ_OPERATOR_AUDIT_OUTPUT_REQUIRED"));
  assert.match(preflight.sideEffect, /不会联网/);
});

test("live execution preflight never exposes credential values", () => {
  const preflight = buildReadOperatorExecutionPreflight(basePlan, {
    executeLive: true,
    outputPath: "audit.json",
    credentialAvailable: false,
  });
  assert.equal(preflight.executionAllowed, false);
  assert.ok(preflight.errors.some((error) => error.code === "READ_OPERATOR_CREDENTIAL_REQUIRED"));
  assert.equal("apiKey" in preflight, false);
  assert.equal(JSON.stringify(preflight).includes("secret"), false);
});

test("live execution rejects credential-like audit output paths", () => {
  const preflight = buildReadOperatorExecutionPreflight(basePlan, {
    executeLive: true,
    outputPath: "D:/Desktop/api/ozonapi.txt",
    credentialAvailable: true,
  });
  assert.equal(preflight.executionAllowed, false);
  assert.ok(preflight.errors.some((error) => error.code === "READ_OPERATOR_AUDIT_OUTPUT_UNSAFE"));
  assert.equal(JSON.stringify(preflight).includes("ozonapi.txt"), false);
});

test("live execution preflight exposes only the minimum hashed executable plan", () => {
  const preflight = buildReadOperatorExecutionPreflight(basePlan, {
    executeLive: true,
    outputPath: "audit.json",
    credentialAvailable: true,
  });
  assert.equal(preflight.executionAllowed, true);
  assert.match(preflight.outputPathHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(preflight.executionPlan.storeRefHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(preflight.executionPlan.environmentRefHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(preflight.executionPlan.scopeRefHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(preflight.executionPlan.planBinding, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(preflight.executionPlan.endpoints, basePlan.endpoints);
  assert.equal(JSON.stringify(preflight).includes("store-1"), false);
  assert.equal(JSON.stringify(preflight).includes("staging-read"), false);
  assert.equal(JSON.stringify(preflight).includes("audit.json"), false);
});

test("live execution rejects stdout and traversal audit output paths", () => {
  for (const outputPath of ["-", "../audit.json", "reports/../../audit.json"]) {
    const preflight = buildReadOperatorExecutionPreflight(basePlan, {
      executeLive: true,
      outputPath,
      credentialAvailable: true,
    });
    assert.equal(preflight.executionAllowed, false, outputPath);
    assert.ok(preflight.errors.some((error) => error.code === "READ_OPERATOR_AUDIT_OUTPUT_UNSAFE"), outputPath);
  }
});

test("live execution does not overwrite an existing audit artifact by default", () => {
  const blocked = buildReadOperatorExecutionPreflight(basePlan, {
    executeLive: true,
    outputPath: "audit.json",
    outputExists: true,
    credentialAvailable: true,
  });
  assert.equal(blocked.executionAllowed, false);
  assert.ok(blocked.errors.some((error) => error.code === "READ_OPERATOR_AUDIT_OUTPUT_EXISTS"));

  const allowed = buildReadOperatorExecutionPreflight(basePlan, {
    executeLive: true,
    outputPath: "audit.json",
    outputExists: true,
    allowOverwrite: true,
    credentialAvailable: true,
  });
  assert.equal(allowed.executionAllowed, true);
  assert.equal(allowed.outputExists, true);
  assert.equal(allowed.overwriteAllowed, true);
});

test("read operator plan matrix validates distinct stores without exposing ids", () => {
  const matrix = buildReadOperatorPlanMatrixSummary([
    basePlan,
    { ...basePlan, store: { id: "store-2" } },
  ]);
  assert.equal(matrix.ok, true);
  assert.equal(matrix.total, 2);
  assert.equal(matrix.validCount, 2);
  assert.equal(matrix.duplicateStoreIndexes.length, 0);
  assert.equal(matrix.stores[0].storeRefHash.startsWith("sha256:"), true);
  assert.equal(JSON.stringify(matrix).includes("store-1"), false);
  assert.match(matrix.sideEffect, /不会联网/);
});

test("read operator matrix exposes environment/store/endpoint receipt contract without claiming execution", () => {
  const matrix = buildReadOperatorPlanMatrixSummary([basePlan]);
  const entry = matrix.stores[0];
  assert.match(entry.storeRefHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(entry.environmentRefHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(entry.scopeRefHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(entry.planBinding, /^sha256:[a-f0-9]{64}$/);
  assert.match(entry.nextAction, /服务端执行/);
  assert.equal(entry.receipt.status, "not_started");
  assert.equal(entry.receipt.verificationLevel, "configuration_declared");
  assert.equal(entry.receipt.persisted, false);
  assert.deepEqual(entry.receipt.endpointCoverage.requested, entry.endpoints);
  assert.deepEqual(entry.receipt.endpointCoverage.missing, entry.endpoints);
  assert.equal(entry.receipt.endpointCoverage.complete, false);
  assert.match(entry.receipt.nextAction, /未保存回执/);
  assert.equal(JSON.stringify(entry).includes("store-1"), false);
});

test("read operator matrix keeps seller store names while masking store ids", () => {
  const matrix = buildReadOperatorPlanMatrixSummary([
    { ...basePlan, store: { id: "store-1", name: "主店铺" } },
  ]);
  assert.equal(matrix.stores[0].storeLabel, "主店铺");
  assert.equal(JSON.stringify(matrix).includes("store-1"), false);
});

test("canonical read matrix rejects a plan count that is not the four primary stores", () => {
  const matrix = buildReadOperatorPlanMatrixSummary([
    basePlan,
    { ...basePlan, store: { id: "store-2" } },
  ], { expectedPrimaryStoreCount: 4 });
  assert.equal(matrix.ok, false);
  assert.ok(matrix.errors.some((error) => error.code === "READ_OPERATOR_PLAN_MATRIX_CANONICAL_SCOPE_MISMATCH"));
  assert.equal(JSON.stringify(matrix).includes("store-1"), false);
});

test("canonical four-store read gate blocks missing signed session before any transport", () => {
  const plans = ["store-1", "store-2", "store-3", "store-4"].map((id) => ({ ...basePlan, store: { id } }));
  const gate = buildCanonicalReadOperatorSessionGate(plans, {
    canonicalStores: plans.map((plan) => plan.store),
    sessionProof: null,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.executionAllowed, false);
  assert.ok(gate.errors.some((error) => error.code === "READ_OPERATOR_SIGNED_SESSION_REQUIRED"));
  assert.match(gate.nextAction, /session/);
  assert.match(gate.sideEffect, /不会联网/);
});

test("single-store controlled read gate rejects a static-key-only live plan", () => {
  const gate = buildReadOperatorSessionGate(basePlan, { sessionProof: { verified: true, authSource: "static_secret", environment: basePlan.environment, storeIds: [basePlan.store.id] } });
  assert.equal(gate.ok, false);
  assert.equal(gate.executionAllowed, false);
  assert.ok(gate.errors.some((error) => error.code === "READ_OPERATOR_SIGNED_SESSION_REQUIRED"));
  assert.match(gate.nextAction, /服务端签发/);
});

test("canonical four-store read gate binds environment and exact store scope", () => {
  const plans = ["store-1", "store-2", "store-3", "store-4"].map((id) => ({ ...basePlan, store: { id } }));
  const gate = buildCanonicalReadOperatorSessionGate(plans, {
    canonicalStores: plans.map((plan) => plan.store),
    sessionProof: { verified: true, verificationLevel: "server_verified", proofRefHash: "sha256:" + "a".repeat(64), authSource: "session_bearer", environment: "other-env", storeIds: ["store-1"] },
  });
  assert.equal(gate.ok, false);
  assert.ok(gate.errors.some((error) => error.code === "READ_OPERATOR_SESSION_ENVIRONMENT_MISMATCH"));
  assert.ok(gate.errors.some((error) => error.code === "READ_OPERATOR_SESSION_SCOPE_REQUIRED"));
  assert.equal(JSON.stringify(gate).includes("store-1"), false);
});

test("canonical four-store read gate accepts only a server-verified matching session declaration", () => {
  const plans = ["store-1", "store-2", "store-3", "store-4"].map((id) => ({ ...basePlan, store: { id } }));
  const gate = buildCanonicalReadOperatorSessionGate(plans, {
    canonicalStores: plans.map((plan) => plan.store),
    sessionProof: { verified: true, verificationLevel: "server_verified", proofRefHash: "sha256:" + "a".repeat(64), authSource: "session_bearer", environment: "staging-read", storeIds: plans.map((plan) => plan.store.id) },
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.executionAllowed, false);
  assert.equal(gate.verificationLevel, "configuration_declared");
  assert.match(gate.nextAction, /人工确认/);
});

test("read operator plan matrix blocks duplicate or invalid store plans", () => {
  const matrix = buildReadOperatorPlanMatrixSummary([
    basePlan,
    { ...basePlan, scope: { name: "all_offers", offerCount: 10 } },
    { ...basePlan, store: { id: "store-2" }, confirm: "" },
  ]);
  assert.equal(matrix.ok, false);
  assert.deepEqual(matrix.duplicateStoreIndexes, [1]);
  assert.equal(matrix.validCount, 2);
  assert.ok(matrix.errors.some((error) => error.code === "READ_OPERATOR_PLAN_MATRIX_DUPLICATE_STORE"));
  assert.ok(matrix.stores[2].errors.some((error) => error.code === "READ_OPERATOR_CONFIRMATION_REQUIRED"));
});

test("canonical store matrix CLI remains a local plan generator", async () => {
  const source = await readFile(new URL("../scripts/read-operator-matrix.mjs", import.meta.url), "utf8");
  assert.match(source, /loadStores/);
  assert.match(source, /buildReadOperatorPlanMatrixSummary/);
  assert.match(source, /canonicalStoreCount/);
  assert.match(source, /execution: "not_started"/);
  assert.match(source, /DEFAULT_API_FILE/);
  assert.match(source, /buildApiEvidenceSummary/);
  assert.match(source, /SELLER_API_DOCUMENT_STALE/);
  assert.match(source, /buildCanonicalReadOperatorSessionGate/);
  assert.match(source, /buildReadEndpointRequest/);
  assert.match(source, /validateInitialEndpointScope/);
  assert.match(source, /--endpoints/);
  assert.match(source, /session-proof/);
  assert.match(source, /DEFAULT_OPERATOR_ENDPOINTS/);
  assert.match(source, /"\/v3\/product\/list", "\/v2\/warehouse\/list"/);
  assert.doesNotMatch(source, /ozonRequest|runReadVerification/);
});

test("fresh controlled-read plans exclude deprecated FBS v3 operations", () => {
  assert.equal(CURRENT_READ_ENDPOINTS.has("/v3/posting/fbs/list"), false);
  assert.equal(CURRENT_READ_ENDPOINTS.has("/v3/posting/fbs/unfulfilled/list"), false);
  assert.equal(CURRENT_READ_ENDPOINTS.has("/v4/posting/fbs/list"), true);
  assert.equal(CURRENT_READ_ENDPOINTS.has("/v4/posting/fbs/unfulfilled/list"), true);
  assert.equal(READ_ENDPOINTS.has("/v3/posting/fbs/list"), true);
});
