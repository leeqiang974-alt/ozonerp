import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_CONFIRMATION, READ_ENDPOINTS, scopeHash } from "../src/readVerificationHarness.js";
import { buildReadFailureSellerTask, buildReadOperatorReport } from "../src/readVerificationOperator.js";

const [firstEndpoint, secondEndpoint] = [...READ_ENDPOINTS];
const basePlan = {
  store: { id: "store-1" },
  environment: "staging-read",
  scope: { name: "single_offer", offerCount: 1 },
  endpoints: [firstEndpoint, secondEndpoint].filter(Boolean),
  readOnly: true,
  writeAttempted: false,
  confirm: LIVE_CONFIRMATION,
  maxAgeMs: 60 * 60 * 1000,
};
const hash = (letter) => `sha256:${letter.repeat(64)}`;
const binding = { storeRefHash: scopeHash("store-1"), environmentRefHash: scopeHash("staging-read"), scopeRefHash: scopeHash({ name: "single_offer", offerCount: 1 }) };

test("read operator report exposes safe endpoint coverage and freshness", () => {
  const checkedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const report = buildReadOperatorReport(basePlan, {
    verificationLevel: "server_observed",
    persisted: true,
    ...binding,
    checkedAt,
    status: "success",
    readSucceeded: true,
    endpoints: [firstEndpoint],
    responseHash: hash("c"),
  });

  assert.equal(report.receiptValid, false);
  assert.deepEqual(report.endpointCoverage.requested, [firstEndpoint, secondEndpoint].filter(Boolean).sort());
  assert.deepEqual(report.endpointCoverage.observed, [firstEndpoint].filter(Boolean));
  assert.deepEqual(report.endpointCoverage.missing, [secondEndpoint].filter(Boolean));
  assert.equal(report.endpointCoverage.complete, false);
  assert.equal(report.freshness.stale, false);
  assert.match(report.nextStep, /补齐|覆盖/);
  assert.equal("rawResponse" in report, false);
  assert.equal("apiKey" in report, false);
  assert.equal("environment" in report, false);
});

test("read operator report preserves failure scenario and gives a safe recovery action", () => {
  const report = buildReadOperatorReport(basePlan, {
    verificationLevel: "server_observed",
    persisted: true,
    ...binding,
    checkedAt: new Date().toISOString(),
    status: "forbidden",
    readSucceeded: false,
    observedFailure: true,
    failureScenario: "permission_denied",
    permissionFailureVerified: true,
    endpoints: [firstEndpoint, secondEndpoint].filter(Boolean),
    responseHash: hash("c"),
    response: { apiKey: "must-not-escape", secret: "must-not-escape" },
  });

  assert.deepEqual(report.failure.scenarios, ["permission_denied"]);
  assert.equal(report.failure.permissionVerified, true);
  assert.match(report.nextStep, /权限|授权/);
  assert.equal("response" in report, false);
  assert.equal(JSON.stringify(report).includes("secret"), false);
  assert.equal(JSON.stringify(report).includes("must-not-escape"), false);
});

test("permission and rate-limit verification flags require matching server-observed scenarios", () => {
  const clientAsserted = buildReadOperatorReport(basePlan, {
    verificationLevel: "locally_tested",
    persisted: true,
    ...binding,
    checkedAt: new Date().toISOString(),
    status: "forbidden",
    readSucceeded: false,
    failureScenario: "permission_denied",
    permissionFailureVerified: true,
    endpoints: [firstEndpoint],
  });
  assert.equal(clientAsserted.failure.permissionVerified, false);

  const mismatchedServerFlag = buildReadOperatorReport(basePlan, {
    verificationLevel: "server_observed",
    persisted: true,
    ...binding,
    checkedAt: new Date().toISOString(),
    status: "failed",
    readSucceeded: false,
    permissionFailureVerified: true,
    endpoints: [firstEndpoint],
  });
  assert.equal(mismatchedServerFlag.failure.permissionVerified, false);
});

test("live client artifact is not labeled as persisted server evidence", () => {
  const report = buildReadOperatorReport(basePlan, {
    verificationLevel: "server_observed",
    persisted: false,
    ...binding,
    checkedAt: new Date().toISOString(),
    status: "success",
    readSucceeded: true,
    endpoints: [firstEndpoint, secondEndpoint].filter(Boolean),
    responseHash: hash("c"),
  });
  assert.equal(report.receiptValid, false);
  assert.equal(report.verificationLevel, "");
  assert.equal(report.artifactStatus, "client_artifact_not_persisted");
});

test("stale or invalid read receipt remains non-actionable", () => {
  const report = buildReadOperatorReport({ ...basePlan, maxAgeMs: 60 * 1000 }, {
    verificationLevel: "server_observed",
    persisted: true,
    ...binding,
    checkedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    status: "success",
    endpoints: [firstEndpoint, secondEndpoint].filter(Boolean),
  });

  assert.equal(report.receiptValid, false);
  assert.equal(report.freshness.stale, true);
  assert.match(report.nextStep, /重新执行|新回执/);
  assert.ok(report.errors.includes("READ_OPERATOR_RECEIPT_STALE"));
});

test("untrusted status and failure text are reduced to safe classifications", () => {
  const report = buildReadOperatorReport(basePlan, {
    verificationLevel: "server_observed",
    persisted: true,
    ...binding,
    checkedAt: new Date().toISOString(),
    status: "secret-api-key-should-not-escape",
    failureScenario: "opaque-secret-value",
    endpoints: [firstEndpoint, secondEndpoint].filter(Boolean),
  });
  assert.equal(report.status, "unknown");
  assert.deepEqual(report.failure.scenarios, ["observed_read_failure"]);
  assert.equal(JSON.stringify(report).includes("secret-api-key"), false);
});

test("read failures become seller tasks instead of raw HTTP statuses", () => {
  const cases = [
    [{ failureEvidence: [{ statusCode: 403 }] }, "READ_PERMISSION_REQUIRED", /授权/],
    [{ failureEvidence: [{ statusCode: 429 }] }, "READ_RATE_LIMITED", /限流/],
    [{ failureScenario: "request_timeout" }, "READ_TIMEOUT_RECONCILIATION_REQUIRED", /同一店铺|幂等键/],
    [{ readStatus: "partial", coverageComplete: false }, "READ_EVIDENCE_PARTIAL", /下一页|详情/],
  ];
  for (const [receipt, code, action] of cases) {
    const task = buildReadFailureSellerTask(receipt);
    assert.equal(task.code, code);
    assert.match(task.nextAction, action);
    assert.match(task.sideEffect, /不会写入 Ozon/);
  }
});

test("persisted server observations retain permission and partial recovery guidance", () => {
  const permission = buildReadFailureSellerTask({
    status: "failed",
    failureScenario: "observed_read_failure",
    observations: [{ endpoint: firstEndpoint, status: "failed", statusCode: 403 }],
    endpointCoverageComplete: false,
  });
  assert.equal(permission.code, "READ_PERMISSION_REQUIRED");
  const partial = buildReadFailureSellerTask({
    status: "success",
    readSucceeded: true,
    endpointCoverageComplete: false,
  });
  assert.equal(partial.code, "READ_EVIDENCE_PARTIAL");
});

test("stale successful evidence is never presented as ready", () => {
  const task = buildReadFailureSellerTask({
    status: "success",
    readSucceeded: true,
    stale: true,
    coverageComplete: true,
  });
  assert.equal(task.code, "READ_EVIDENCE_STALE");
  assert.equal(task.status, "needs_review");
  assert.match(task.nextAction, /重新执行|新鲜回执/);
  assert.match(task.sideEffect, /不会写入 Ozon/);
});
