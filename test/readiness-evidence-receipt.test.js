import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ReadinessEvidenceReceiptRepository,
  buildReadinessEvidenceReceipt,
  evaluateRealReadVerification,
  validateReadinessEvidenceReceipt,
} from "../src/readinessEvidenceReceipt.js";

function inspection({ readStatus = "completed", state = "pending_moderation", readError = "", requestedOfferCount = 1, coverageComplete = true, endpointAttempts = ["/v3/product/list", "/v3/product/info/list"] } = {}) {
  return {
    readOnly: true,
    jobId: "job-secret-1",
    storeId: "store-secret-1",
    evidenceSummary: {
      readStatus,
      state,
      live: state === "ready_for_sale",
      offerCount: 1,
      requestedOfferCount,
      coverageComplete,
      endpointAttempts,
      endpointAttempted: endpointAttempts.length > 0,
      operationEvidence: endpointAttempts.map((operationPath) => ({
        operationPath,
        responseHash: `sha256:${"a".repeat(64)}`,
        verificationLevel: "server_observed",
      })),
    },
    sellerView: {
      evidenceAt: "2026-07-12T11:00:00.000Z",
      offers: [{ offerId: "OFFER-SECRET", productId: 9001, moderationStatus: state === "ready_for_sale" ? "ready" : "pending", errorCount: 0 }],
    },
    hiddenFailureText: readError,
    rawResponse: { apiKey: "must-not-persist", items: [{ huge: true }] },
  };
}

function persistedReceipt(receipt) {
  return {
    ...receipt,
    id: "readiness:00000000-0000-4000-8000-000000000001",
    persisted: true,
    verificationEligible: true,
    origin: "server_observed",
    persistedAt: "2026-07-12T11:01:00.000Z",
  };
}

test("readiness evidence receipt is deterministic and excludes secrets and raw responses", () => {
  const receipt = buildReadinessEvidenceReceipt(inspection({ state: "ready_for_sale" }), {
    environment: "seller-production-cn-1",
    endpointVersions: ["/v3/product/list", "/v3/product/info/list"],
    requestScope: "single_auto_listing_job",
  });
  const serialized = JSON.stringify(receipt);
  assert.match(receipt.jobRef, /^sha256:/);
  assert.match(receipt.storeRef, /^sha256:/);
  assert.match(receipt.environmentRef, /^sha256:/);
  assert.equal(receipt.success, true);
  assert.equal(receipt.readStatus, "completed");
  assert.equal(receipt.checkedAt, "2026-07-12T11:00:00.000Z");
  assert.equal(receipt.offerSummary[0].moderationStatus, "ready");
  assert.match(receipt.responseHash, /^sha256:/);
  assert.doesNotMatch(serialized, /job-secret|store-secret|OFFER-SECRET|must-not-persist|rawResponse|apiKey/);
});

test("completed reads for pending or unknown states cannot become successful readiness evidence", () => {
  const pending = buildReadinessEvidenceReceipt(inspection(), {
    environment: "seller-production-cn-1",
  });
  const missingCoverage = buildReadinessEvidenceReceipt(inspection({ state: "ready_for_sale", coverageComplete: null }), {
    environment: "seller-production-cn-1",
  });
  assert.equal(pending.state, "pending_moderation");
  assert.equal(pending.success, false);
  assert.equal(missingCoverage.coverageComplete, false);
  assert.equal(missingCoverage.success, false);
});

test("zero-offer or missing endpoint attempts can never produce successful real-read evidence", () => {
  const zeroOffer = buildReadinessEvidenceReceipt(inspection({ requestedOfferCount: 0, endpointAttempts: [] }), {
    environment: "seller-production-cn-1",
  });
  const missingDetailAttempt = buildReadinessEvidenceReceipt(inspection({ endpointAttempts: ["/v3/product/list"] }), {
    environment: "seller-production-cn-1",
  });
  assert.equal(zeroOffer.success, false);
  assert.equal(zeroOffer.endpointAttempted, false);
  assert.equal(missingDetailAttempt.success, false);
  const failure = {
    ...buildReadinessEvidenceReceipt(inspection({ readStatus: "dependency_failed" }), { environment: "seller-production-cn-1" }),
    persisted: true,
    origin: "server_observed",
  };
  const forgedSuccess = { ...zeroOffer, persisted: true, origin: "server_observed", success: true };
  assert.equal(evaluateRealReadVerification([forgedSuccess, failure], { environment: "seller-production-cn-1" }).verificationLevel, "locally_tested");
});

test("partial Offer coverage cannot produce a successful readiness receipt", () => {
  const receipt = buildReadinessEvidenceReceipt(inspection({ coverageComplete: false }), {
    environment: "seller-production-cn-1",
  });
  assert.equal(receipt.readStatus, "completed");
  assert.equal(receipt.coverageComplete, false);
  assert.equal(receipt.success, false);
});

test("real read verification excludes receipts older than the configured freshness window", () => {
  const receipt = persistedReceipt(buildReadinessEvidenceReceipt(inspection({ state: "ready_for_sale" }), { environment: "seller-production-cn-1" }));
  const verification = evaluateRealReadVerification([receipt], {
    environment: "seller-production-cn-1",
    maxAgeMs: 60 * 60 * 1000,
    now: "2026-07-13T12:00:00.000Z",
  });
  assert.equal(verification.persistedCount, 0);
  assert.equal(verification.staleCount, 1);
  assert.equal(verification.verificationLevel, "locally_tested");
});

test("readiness evidence repository records only explicit local evidence actions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-readiness-receipts-"));
  const file = path.join(dir, "receipts.json");
  const repository = new ReadinessEvidenceReceiptRepository({ file });
  try {
    const skipped = await repository.record({ recordEvidence: false, inspection: inspection(), environment: "seller-production-cn-1" });
    assert.equal(skipped.ok, false);
    assert.equal(skipped.reasonCode, "READINESS_EVIDENCE_CONFIRMATION_REQUIRED");
    assert.deepEqual(await repository.list(), []);

    const saved = await repository.record({
      recordEvidence: true,
      inspection: inspection(),
      environment: "seller-production-cn-1",
      endpointVersions: ["/v3/product/list", "/v3/product/info/list"],
      requestScope: "single_auto_listing_job",
    });
    assert.equal(saved.ok, true);
    assert.equal((await repository.list()).length, 1);
    assert.equal(saved.receipt.persisted, true);
    assert.equal(saved.receipt.origin, "client_asserted");
    assert.match(saved.receipt.id, /^readiness:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("readiness evidence repository fails closed on corrupt JSON or schema without overwriting it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-readiness-receipts-corrupt-"));
  const file = path.join(dir, "receipts.json");
  const repository = new ReadinessEvidenceReceiptRepository({ file });
  try {
    for (const corrupt of ["{not-json", JSON.stringify({ receipts: "not-an-array" })]) {
      await fs.writeFile(file, corrupt, "utf8");
      await assert.rejects(repository.list(), (error) => (
        error?.code === "READINESS_RECEIPT_STORE_CORRUPT"
        && !String(error.message).includes(file)
      ));
      await assert.rejects(repository.record({
        recordEvidence: true,
        inspection: inspection(),
        environment: "seller-production-cn-1",
      }), (error) => error?.code === "READINESS_RECEIPT_STORE_CORRUPT");
      assert.equal(await fs.readFile(file, "utf8"), corrupt);
      await assert.rejects(repository.list(), (error) => (
        error?.code === "READINESS_RECEIPT_STORE_CORRUPT"
        && !String(error.message).includes(file)
      ));
      await assert.rejects(repository.record({
        recordEvidence: true,
        inspection: inspection(),
        environment: "seller-production-cn-1",
      }), (error) => error?.code === "READINESS_RECEIPT_STORE_CORRUPT");
      assert.equal(await fs.readFile(file, "utf8"), corrupt);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("separate repository instances serialize read-modify-write and retain every receipt", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-readiness-receipts-lock-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "receipts.json");
  const repositories = Array.from({ length: 12 }, () => new ReadinessEvidenceReceiptRepository({ file }));
  const results = await Promise.all(repositories.map((repository, index) => repository.record({
    recordEvidence: true,
    inspection: inspection({ readError: `worker-${index}` }),
    environment: "seller-production-cn-1",
  })));
  assert.equal(results.filter((result) => result.ok).length, repositories.length);
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(stored.receipts.length, repositories.length);
  assert.equal(new Set(stored.receipts.map((receipt) => receipt.id)).size, repositories.length);
  assert.equal(await fs.access(`${file}.lock`).then(() => true, () => false), false);
});

test("receipt writes preserve the previous valid snapshot for recovery", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-readiness-receipts-backup-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "receipts.json");
  const repository = new ReadinessEvidenceReceiptRepository({ file });
  await repository.record({ recordEvidence: true, inspection: inspection(), environment: "seller-production-cn-1" });
  await repository.record({ recordEvidence: true, inspection: inspection({ readStatus: "partial" }), environment: "seller-production-cn-1" });
  const backup = JSON.parse(await fs.readFile(`${file}.bak`, "utf8"));
  assert.equal(backup.receipts.length, 1);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).receipts.length, 2);
});

test("real read verification requires persisted success and failure receipts in one explicit environment", () => {
  const success = persistedReceipt(buildReadinessEvidenceReceipt(inspection({ state: "ready_for_sale" }), { environment: "seller-production-cn-1" }));
  const failure = persistedReceipt(buildReadinessEvidenceReceipt(inspection({ readStatus: "dependency_failed", readError: "timeout" }), { environment: "seller-production-cn-1" }));
  assert.equal(evaluateRealReadVerification([success], { environment: "seller-production-cn-1" }).verificationLevel, "locally_tested");
  const verified = evaluateRealReadVerification([success, failure], { environment: "seller-production-cn-1" });
  assert.equal(verified.verificationLevel, "real_read_verified");
  assert.equal(verified.successCount, 1);
  assert.equal(verified.failureCount, 1);
  assert.deepEqual(verified.failureScenarios, ["observed_read_failure"]);
  assert.equal(verified.failureCoverage.observedFailureVerified, true);
  assert.equal(verified.failureCoverage.permissionFailureVerified, false);
  assert.match(verified.failureCoverage.note, /不代表权限失败覆盖/);
});

test("real read verification isolates receipts by explicit store scope", () => {
  const storeA = persistedReceipt(buildReadinessEvidenceReceipt(inspection({ state: "ready_for_sale" }), { environment: "seller-production-cn-1" }));
  const storeB = persistedReceipt(buildReadinessEvidenceReceipt({ ...inspection({ state: "ready_for_sale" }), storeId: "store-b" }, { environment: "seller-production-cn-1" }));
  const result = evaluateRealReadVerification([storeA, storeB], { environment: "seller-production-cn-1", storeId: "store-b" });
  assert.equal(result.storeRef !== null, true);
  assert.equal(result.persistedCount, 1);
  assert.equal(result.successCount, 1);
});

test("unknown, missing dependency, and tampered failure scenarios cannot satisfy observed failure criteria", () => {
  const success = persistedReceipt(buildReadinessEvidenceReceipt(inspection(), { environment: "seller-production-cn-1" }));
  const unknown = persistedReceipt(buildReadinessEvidenceReceipt(inspection({ readStatus: "unknown" }), { environment: "seller-production-cn-1" }));
  const missing = persistedReceipt(buildReadinessEvidenceReceipt(inspection({ readStatus: "dependency_not_provided" }), { environment: "seller-production-cn-1" }));
  const tampered = { ...unknown, failureScenario: "permission_denied_verified" };
  const result = evaluateRealReadVerification([success, unknown, missing, tampered], { environment: "seller-production-cn-1" });
  assert.equal(result.verificationLevel, "locally_tested");
  assert.equal(result.failureCount, 0);
  assert.equal(result.failureCoverage.permissionFailureVerified, false);
});

test("real-read evaluator rejects a forged success or missing server operation evidence", () => {
  const valid = persistedReceipt(buildReadinessEvidenceReceipt(inspection({ state: "ready_for_sale" }), {
    environment: "seller-production-cn-1",
  }));
  assert.equal(validateReadinessEvidenceReceipt(valid).ok, true);
  const forged = { ...valid, success: true, responseHash: valid.responseHash.replace(/[0-9a-f]/, "f") };
  assert.equal(validateReadinessEvidenceReceipt(forged).ok, false);
  const missingOperation = { ...valid, operationEvidence: [] };
  assert.equal(evaluateRealReadVerification([missingOperation], { environment: "seller-production-cn-1" }).verificationLevel, "locally_tested");
});

test("client asserted receipts can never upgrade real read verification", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-readiness-origin-"));
  const repository = new ReadinessEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  try {
    await repository.record({ recordEvidence: true, inspection: inspection(), environment: "seller-production-cn-1" });
    await repository.record({
      recordEvidence: true,
      inspection: inspection({ readStatus: "dependency_failed", readError: "fabricated" }),
      environment: "seller-production-cn-1",
    });
    const clientOnly = evaluateRealReadVerification(await repository.list(), { environment: "seller-production-cn-1" });
    assert.equal(clientOnly.verificationLevel, "locally_tested");
    assert.equal(clientOnly.persistedCount, 0);

    const observed = await repository.recordServerObservation({
      recordEvidence: true,
      inspection: inspection(),
      environment: "seller-production-cn-1",
    });
    assert.equal(observed.receipt.origin, "server_observed");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("empty environment verification stays local and exposes no eligible count", () => {
  const receipt = persistedReceipt(buildReadinessEvidenceReceipt(inspection(), { environment: "seller-production-cn-1" }));
  const verification = evaluateRealReadVerification([receipt], { environment: "" });
  assert.equal(verification.verificationLevel, "locally_tested");
  assert.equal(verification.persistedCount, 0);
  assert.equal(verification.criteria.explicitEnvironment, false);
});

test("readiness receipt keeps bounded operation evidence references", () => {
  const receipt = buildReadinessEvidenceReceipt({
    jobId: "job-1",
    storeId: "store-1",
    evidenceSummary: {
      readStatus: "completed",
      requestedOfferCount: 1,
      endpointAttempts: ["/v3/product/list", "/v3/product/info/list"],
      operationEvidence: [{ operationPath: "/v3/product/list", responseHash: `sha256:${"b".repeat(64)}`, verificationLevel: "server_observed", secret: "drop" }],
    },
    sellerView: { evidenceAt: "2026-07-15T00:00:00.000Z" },
  }, { environment: "local" });
  assert.equal(receipt.operationEvidence.length, 1);
  assert.equal(receipt.operationEvidence[0].operationPath, "/v3/product/list");
  assert.doesNotMatch(JSON.stringify(receipt), /secret|drop/);
});

test("readiness receipt keeps bounded failure scenario evidence without raw errors", () => {
  const receipt = buildReadinessEvidenceReceipt({
    jobId: "job-1",
    storeId: "store-1",
    evidenceSummary: {
      readStatus: "partial",
      requestedOfferCount: 1,
      endpointAttempts: ["/v3/product/list"],
      endpointFailures: [{ endpoint: "/v3/product/info/list", statusCode: 403, reasonCode: "forbidden", error: "api-key-secret" }],
    },
  }, { environment: "local" });
  assert.deepEqual(receipt.failureEvidence, [{ endpoint: "/v3/product/info/list", reasonCode: "forbidden", statusCode: 403 }]);
  assert.doesNotMatch(JSON.stringify(receipt), /api-key-secret|error/);
});
