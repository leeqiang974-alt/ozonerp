import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LIVE_CONFIRMATION, scopeHash } from "../src/readVerificationHarness.js";
import {
  ReadOperatorReceiptRepository,
  buildReadOperatorReceipt,
  validateReadOperatorReceipt,
} from "../src/readOperatorReceipt.js";

const plan = {
  store: { id: "2367028-1" },
  environment: "seller-production-cn-1-2026-07-17",
  scope: { name: "single_offer", offerCount: 1 },
  endpoints: ["/v3/product/list", "/v3/product/info/list"],
  readOnly: true,
  writeAttempted: false,
  confirm: LIVE_CONFIRMATION,
};

const result = {
  observedAt: "2026-07-17T01:02:03.000Z",
  storeRef: scopeHash("2367028-1"),
  environmentRef: scopeHash(plan.environment),
  scopeRef: scopeHash(plan.scope),
  readSucceeded: true,
  observedFailure: false,
  readOnly: true,
  writeAttempted: false,
  resultHash: scopeHash({ observations: [{ endpoint: "/v3/product/list", status: "success" }], scope: plan.scope }),
  observations: [
    { endpoint: "/v3/product/list", status: "success", responseHash: scopeHash({ keyCount: 1 }) },
    { endpoint: "/v3/product/info/list", status: "success", responseHash: scopeHash({ keyCount: 2 }) },
  ],
};

test("client-shaped read operator receipt stays invalid until repository persistence", () => {
  const local = buildReadOperatorReceipt(plan, result);
  assert.equal(local.persisted, false);
  assert.equal(validateReadOperatorReceipt(local).ok, false);
  assert.ok(validateReadOperatorReceipt(local).errors.includes("READ_OPERATOR_RECEIPT_NOT_PERSISTED"));
});

test("server read operator repository persists hash-only bounded receipt", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-read-operator-"));
  const repository = new ReadOperatorReceiptRepository({ file: path.join(dir, "receipts.json") });
  const saved = await repository.record(plan, result);
  assert.equal(saved.ok, true);
  assert.equal(saved.receipt.origin, "server_observed");
  assert.equal(saved.receipt.verificationEligible, true);
  assert.equal(validateReadOperatorReceipt(saved.receipt).ok, true);
  const listed = await repository.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].endpointCoverageComplete, true);
  assert.doesNotMatch(JSON.stringify(listed[0]), /apiKey|rawResponse|SAFE-OFFER/);
});

test("signed-session read receipt binds only auth class and token fingerprint", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-read-operator-signed-session-"));
  const repository = new ReadOperatorReceiptRepository({ file: path.join(dir, "receipts.json") });
  const sessionRefHash = scopeHash("signed-session-token-fingerprint");
  const saved = await repository.record(plan, {
    ...result,
    signedSessionBound: true,
    authSource: "session_bearer",
    sessionRefHash,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.receipt.signedSessionBound, true);
  assert.equal(saved.receipt.authSource, "session_bearer");
  assert.equal(saved.receipt.sessionRefHash, sessionRefHash);
  assert.doesNotMatch(JSON.stringify(saved.receipt), /signed-session-token-fingerprint|apiKey|cookie|token/i);
  assert.equal(validateReadOperatorReceipt(saved.receipt).ok, true);
});

test("signed-session receipt rejects a missing or non-session credential binding", () => {
  const receipt = buildReadOperatorReceipt(plan, {
    ...result,
    signedSessionBound: true,
    authSource: "static_secret",
    sessionRefHash: "",
  }, { persisted: true });
  const validation = validateReadOperatorReceipt(receipt);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("READ_OPERATOR_RECEIPT_SIGNED_SESSION_SOURCE_INVALID"));
  assert.ok(validation.errors.includes("READ_OPERATOR_RECEIPT_SIGNED_SESSION_REF_INVALID"));
});

test("category dictionary read is visible as a unified server receipt", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-category-read-receipt-"));
  const repository = new ReadOperatorReceiptRepository({ file: path.join(dir, "receipts.json") });
  const categoryScope = { name: `category_read:${scopeHash({ descriptionCategoryId: 17028673, typeId: 95183 })}`, offerCount: 0 };
  const categoryPlan = {
    store: { id: "2367028-1" },
    environment: "seller-production-cn-1-2026-07-17",
    scope: categoryScope,
    endpoints: ["/v1/description-category/tree", "/v1/description-category/attribute", "/v1/description-category/attribute/values"],
    readOnly: true,
    writeAttempted: false,
    confirm: LIVE_CONFIRMATION,
    maxAgeMs: 24 * 60 * 60 * 1000,
  };
  const saved = await repository.record(categoryPlan, {
    storeRef: scopeHash(categoryPlan.store.id),
    environmentRef: scopeHash(categoryPlan.environment),
    scopeRef: scopeHash(categoryScope),
    readSucceeded: true,
    observedFailure: false,
    readOnly: true,
    writeAttempted: false,
    observations: categoryPlan.endpoints.map((endpoint) => ({ endpoint, status: "success", responseHash: scopeHash({ endpoint }) })),
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.receipt.endpointCoverageComplete, true);
  assert.deepEqual(saved.receipt.endpoints, [...categoryPlan.endpoints].sort());
  assert.equal((await repository.list()).length, 1);
});

test("receipt repository fails closed when an individual stored entry is forged or truncated", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-read-operator-entry-corrupt-"));
  const file = path.join(dir, "receipts.json");
  const corrupt = JSON.stringify({ schemaVersion: 1, receipts: [{ origin: "server_observed", verificationLevel: "server_observed", persisted: true, storeRefHash: scopeHash("store"), environmentRefHash: scopeHash("env") }] });
  await fs.writeFile(file, corrupt, "utf8");
  const repository = new ReadOperatorReceiptRepository({ file });
  await assert.rejects(repository.list(), (error) => error?.code === "READ_OPERATOR_RECEIPT_ENTRY_INVALID" && error?.entryIndex === 0);
  assert.equal(await fs.readFile(file, "utf8"), corrupt);
});

test("operator receipt rejects write posture and unallowlisted endpoints", () => {
  const receipt = buildReadOperatorReceipt({ ...plan, endpoints: ["/v3/product/list"] }, {
    ...result,
    writeAttempted: true,
    observations: [{ endpoint: "/v1/product/import", status: "success" }],
  }, { persisted: true });
  const validation = validateReadOperatorReceipt(receipt);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("READ_OPERATOR_RECEIPT_WRITE_POSTURE_INVALID"));
  assert.ok(validation.errors.includes("READ_OPERATOR_RECEIPT_ENDPOINT_COVERAGE_INCOMPLETE"));
});

test("failed endpoint observations never count as complete read coverage", () => {
  const receipt = buildReadOperatorReceipt(plan, {
    ...result,
    readSucceeded: false,
    observedFailure: true,
    failureScenario: "permission_denied",
    observations: [
      { endpoint: "/v3/product/list", status: "success", responseHash: scopeHash({ keyCount: 1 }) },
      { endpoint: "/v3/product/info/list", status: 403, statusCode: 403 },
    ],
  }, { persisted: true });
  assert.equal(receipt.endpointCoverageComplete, false);
  const validation = validateReadOperatorReceipt(receipt);
  assert.equal(validation.ok, true);
});

test("receipt repository rejects a forged success with failed endpoint observations", () => {
  const receipt = buildReadOperatorReceipt(plan, {
    ...result,
    readSucceeded: true,
    observedFailure: false,
    observations: [
      { endpoint: "/v3/product/list", status: "success", responseHash: scopeHash({ keyCount: 1 }) },
      { endpoint: "/v3/product/info/list", status: 403, statusCode: 403 },
    ],
  }, { persisted: true });
  // Simulate a tampered durable entry: endpoint names and success state claim
  // completeness even though the bounded observation is a failure.
  receipt.endpointCoverageComplete = true;
  receipt.status = "success";
  receipt.readSucceeded = true;
  assert.equal(validateReadOperatorReceipt(receipt).ok, false);
  assert.ok(validateReadOperatorReceipt(receipt).errors.includes("READ_OPERATOR_RECEIPT_ENDPOINT_COVERAGE_TAMPERED"));
  assert.ok(validateReadOperatorReceipt(receipt).errors.includes("READ_OPERATOR_RECEIPT_SUCCESS_STATE_INVALID"));
});

test("receipt repository requires a response hash before exposing server evidence", () => {
  const receipt = buildReadOperatorReceipt(plan, result, { persisted: true });
  delete receipt.responseHash;
  assert.equal(validateReadOperatorReceipt(receipt).ok, false);
  assert.ok(validateReadOperatorReceipt(receipt).errors.includes("READ_OPERATOR_RECEIPT_RESPONSE_HASH_INVALID"));
});

test("server-observed failed reads remain persistable failure evidence", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-read-operator-failure-"));
  const repository = new ReadOperatorReceiptRepository({ file: path.join(dir, "receipts.json") });
  const saved = await repository.record(plan, {
    ...result,
    readSucceeded: false,
    observedFailure: true,
    failureScenario: "permission_denied",
    observations: [
      { endpoint: "/v3/product/list", status: 403, statusCode: 403 },
      { endpoint: "/v3/product/info/list", status: 403, statusCode: 403 },
    ],
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.receipt.status, "failed");
  assert.equal(saved.receipt.endpointCoverageComplete, false);
});

test("reader failure without endpoint observations remains persisted failure evidence", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-read-operator-reader-failure-"));
  const repository = new ReadOperatorReceiptRepository({ file: path.join(dir, "receipts.json") });
  const saved = await repository.record(plan, {
    observedAt: "2026-07-17T01:02:03.000Z",
    storeRef: scopeHash("2367028-1"),
    environmentRef: scopeHash(plan.environment),
    scopeRef: scopeHash(plan.scope),
    readSucceeded: false,
    observedFailure: true,
    failureScenario: "reader_exception",
    readOnly: true,
    writeAttempted: false,
    observations: [],
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.receipt.status, "failed");
  assert.equal(saved.receipt.endpointCoverageComplete, false);
  assert.equal(validateReadOperatorReceipt(saved.receipt).ok, true);
});
