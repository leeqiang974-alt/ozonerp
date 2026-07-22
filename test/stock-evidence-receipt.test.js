import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StockEvidenceReceiptRepository,
  buildStockEvidenceReceipt,
  evaluateStockRealReadVerification,
  validateStockEvidenceReceipt,
} from "../src/stockEvidenceReceipt.js";

function evidence() {
  return {
    ok: true,
    readOnly: true,
    requestScoped: true,
    storeId: "store-secret-1",
    offerIds: ["OFFER-SECRET-1", "OFFER-SECRET-2"],
    warehouseIds: [501],
    checkedAt: "2026-07-12T14:00:00.000Z",
    currentStocks: [
      { offer_id: "OFFER-SECRET-1", warehouse_id: 501, present: 7, reserved: 0 },
      { offer_id: "OFFER-SECRET-2", warehouse_id: 501, present: 4, reserved: 1 },
    ],
    partial: true,
    completeForRequestedIds: false,
    endpointAttempts: [
      { endpoint: "/v3/product/list", status: "completed", errorCount: 0, pageCount: 1, paginationComplete: true },
      { endpoint: "/v3/product/info/list", status: "partial", errorCount: 1, rawError: "API key=secret" },
      { endpoint: "/v4/product/info/stocks", status: "completed", errorCount: 0, pageCount: 2, paginationComplete: true },
      { endpoint: "/v2/warehouse/list", status: "completed", errorCount: 0, pageCount: 1, paginationComplete: true },
    ],
    missingEvidence: ["embedded_errors:product_details", "product_detail:OFFER-SECRET-2"],
    rawResponse: { apiKey: "must-not-persist", stocks: [{ secret: true }] },
  };
}

test("stock evidence receipt is deterministic and stores only deidentified read evidence", () => {
  const first = buildStockEvidenceReceipt(evidence(), { environment: "seller-production-cn-1" });
  const second = buildStockEvidenceReceipt(structuredClone(evidence()), { environment: "seller-production-cn-1" });
  assert.equal(first.ok, true);
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal(first.receipt.origin, "server_observed");
  assert.equal(first.receipt.persisted, false);
  assert.equal(first.receipt.verificationEligible, false);
  assert.match(first.receipt.storeRef, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.receipt.offerRefs.length, 2);
  assert.equal(first.receipt.requestScope.offerCount, 2);
  assert.equal(first.receipt.requestScope.requestScoped, true);
  assert.equal(first.receipt.requestScope.warehouseCount, 1);
  assert.match(first.receipt.requestScope.warehouseRefs[0], /^sha256:/);
  assert.equal(first.receipt.endpointStatuses[1].status, "partial");
  assert.equal(first.receipt.endpointStatuses.find((entry) => entry.endpoint === "/v4/product/info/stocks").pageCount, 2);
  assert.equal(first.receipt.endpointStatuses.find((entry) => entry.endpoint === "/v4/product/info/stocks").paginationComplete, true);
  assert.match(first.receipt.endpointStatuses[1].evidenceHash, /^sha256:/);
  assert.match(first.receipt.responseHash, /^sha256:/);
  assert.equal(validateStockEvidenceReceipt(first.receipt).ok, true);
  assert.doesNotMatch(JSON.stringify(first.receipt), /store-secret|OFFER-SECRET|apiKey|must-not-persist|rawError|"stocks":/);
});

test("stock evidence receipt builder fails closed on incomplete scope or unknown endpoints", () => {
  assert.equal(buildStockEvidenceReceipt({ ...evidence(), readOnly: false }, { environment: "env" }).reasonCode, "STOCK_RECEIPT_READ_ONLY_REQUIRED");
  assert.equal(buildStockEvidenceReceipt({ ...evidence(), requestScoped: false }, { environment: "env" }).reasonCode, "STOCK_RECEIPT_REQUEST_SCOPE_REQUIRED");
  assert.equal(buildStockEvidenceReceipt({ ...evidence(), offerIds: [] }, { environment: "env" }).reasonCode, "STOCK_RECEIPT_OFFERS_REQUIRED");
  assert.equal(buildStockEvidenceReceipt({ ...evidence(), warehouseIds: [] }, { environment: "env" }).reasonCode, "STOCK_RECEIPT_WAREHOUSES_REQUIRED");
  assert.equal(buildStockEvidenceReceipt(evidence(), { environment: "" }).reasonCode, "STOCK_RECEIPT_ENVIRONMENT_REQUIRED");
  const unknown = evidence();
  unknown.endpointAttempts[0].endpoint = "/v1/unknown/write";
  assert.equal(buildStockEvidenceReceipt(unknown, { environment: "env" }).reasonCode, "STOCK_RECEIPT_ENDPOINTS_INVALID");
});

test("complete stock receipt cannot be promoted without exact current Offer x warehouse rows", () => {
  const incomplete = { ...evidence(), partial: false, completeForRequestedIds: true, currentStocks: [] };
  assert.equal(buildStockEvidenceReceipt(incomplete, { environment: "env" }).reasonCode, "STOCK_RECEIPT_EXACT_TUPLES_REQUIRED");
  const complete = { ...evidence(), partial: false, completeForRequestedIds: true };
  assert.equal(buildStockEvidenceReceipt(complete, { environment: "env" }).ok, true);
});

test("stock evidence receipt validator rejects tampering and cannot upgrade verification", () => {
  const built = buildStockEvidenceReceipt(evidence(), { environment: "env" }).receipt;
  assert.equal(validateStockEvidenceReceipt({ ...built, origin: "client_asserted" }).ok, false);
  assert.equal(validateStockEvidenceReceipt({ ...built, offerRefs: ["plain-offer"] }).ok, false);
  assert.equal(validateStockEvidenceReceipt({ ...built, responseHash: "sha256:tampered" }).ok, false);
  assert.equal(Object.hasOwn(built, "verificationLevel"), false);
  assert.equal(Object.hasOwn(built, "realReadVerified"), false);
});

test("stock receipt repository persists only server observations and fails closed on corruption", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stock-receipts-"));
  const file = path.join(dir, "receipts.json");
  const repository = new StockEvidenceReceiptRepository({ file, now: () => "2026-07-12T14:05:00.000Z" });
  try {
    assert.equal((await repository.recordServerObservation({ recordEvidence: false, evidence: evidence(), environment: "env" })).reasonCode, "STOCK_RECEIPT_CONFIRMATION_REQUIRED");
    const saved = await repository.recordServerObservation({ recordEvidence: true, evidence: evidence(), environment: "env" });
    assert.equal(saved.ok, true);
    assert.equal(saved.receipt.persisted, true);
    assert.equal(saved.receipt.verificationEligible, true);
    assert.match(saved.receipt.id, /^stock:[0-9a-f-]{36}$/i);
    assert.equal((await repository.list()).length, 1);

    const corrupt = JSON.stringify({ schemaVersion: 1, receipts: "invalid" });
    await fs.writeFile(file, corrupt, "utf8");
    await assert.rejects(repository.list(), (error) => error?.code === "STOCK_RECEIPT_STORE_CORRUPT");
    await assert.rejects(repository.recordServerObservation({ recordEvidence: true, evidence: evidence(), environment: "env" }), (error) => error?.code === "STOCK_RECEIPT_STORE_CORRUPT");
    assert.equal(await fs.readFile(file, "utf8"), corrupt);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("stock real read verification requires same-environment persisted success and controlled endpoint failure", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stock-verification-"));
  const repository = new StockEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  try {
    const successEvidence = { ...evidence(), partial: false, completeForRequestedIds: true,
      endpointAttempts: evidence().endpointAttempts.map((attempt) => ({ ...attempt, status: "completed", errorCount: 0 })) };
    const success = await repository.recordServerObservation({ recordEvidence: true, evidence: successEvidence, environment: "env-1" });
    assert.equal(evaluateStockRealReadVerification([success.receipt], { environment: "env-1" }).verificationLevel, "locally_tested");
    assert.equal(evaluateStockRealReadVerification([success.receipt], { environment: "env-1" }).persistedCount, 0);
    const failure = await repository.recordServerObservation({ recordEvidence: true, evidence: evidence(), environment: "env-1" });
    const verified = evaluateStockRealReadVerification([success.receipt, failure.receipt], { environment: "env-1", storeId: evidence().storeId });
    assert.equal(verified.verificationLevel, "real_read_verified");
    assert.equal(verified.successCount, 1);
    assert.equal(verified.failureCount, 1);
    assert.equal(evaluateStockRealReadVerification([success.receipt, failure.receipt], { environment: "" }).verificationLevel, "locally_tested");
    assert.equal(evaluateStockRealReadVerification([success.receipt, failure.receipt], { environment: "other" }).persistedCount, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("stock real read verification excludes receipts outside the freshness window", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stock-freshness-"));
  const repository = new StockEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  try {
    const successEvidence = { ...evidence(), partial: false, completeForRequestedIds: true,
      endpointAttempts: evidence().endpointAttempts.map((attempt) => ({ ...attempt, status: "completed", errorCount: 0 })) };
    const saved = await repository.recordServerObservation({ recordEvidence: true, evidence: successEvidence, environment: "env-1" });
    const verification = evaluateStockRealReadVerification([saved.receipt], {
      environment: "env-1",
      storeId: evidence().storeId,
      maxAgeMs: 60 * 60 * 1000,
      now: "2026-07-13T14:00:00.000Z",
    });
    assert.equal(verification.persistedCount, 0);
    assert.equal(verification.staleCount, 1);
    assert.equal(verification.verificationLevel, "locally_tested");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("stock real read verification never mixes stores in the same environment", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stock-store-scope-"));
  const repository = new StockEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  try {
    const successEvidence = { ...evidence(), storeId: "store-A", partial: false, completeForRequestedIds: true,
      endpointAttempts: evidence().endpointAttempts.map((attempt) => ({ ...attempt, status: "completed", errorCount: 0 })) };
    await repository.recordServerObservation({ recordEvidence: true, evidence: successEvidence, environment: "shared-env" });
    await repository.recordServerObservation({ recordEvidence: true, evidence: { ...evidence(), storeId: "store-B" }, environment: "shared-env" });
    const receipts = await repository.list();
    const scoped = evaluateStockRealReadVerification(receipts, {
      environment: "shared-env", storeId: "store-B", offerIds: evidence().offerIds, warehouseIds: evidence().warehouseIds,
    });
    assert.equal(scoped.persistedCount, 1);
    assert.equal(scoped.successCount, 0);
    assert.equal(scoped.failureCount, 1);
    assert.equal(scoped.verificationLevel, "locally_tested");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("stock verification never aggregates an environment without the current store", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stock-store-required-"));
  const repository = new StockEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  try {
    const successEvidence = { ...evidence(), storeId: "store-A", partial: false, completeForRequestedIds: true,
      endpointAttempts: evidence().endpointAttempts.map((attempt) => ({ ...attempt, status: "completed", errorCount: 0 })) };
    const saved = await repository.recordServerObservation({ recordEvidence: true, evidence: successEvidence, environment: "shared-env" });
    const withoutStore = evaluateStockRealReadVerification([saved.receipt], { environment: "shared-env" });
    assert.equal(withoutStore.persistedCount, 0);
    assert.equal(withoutStore.successCount, 0);
    assert.equal(withoutStore.criteria.explicitStore, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
