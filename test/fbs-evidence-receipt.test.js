import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFbsEvidenceReceipt, buildFbsReceiptSellerView, FbsEvidenceReceiptRepository } from "../src/fbsEvidenceReceipt.js";

const model = (overrides = {}) => ({
  readOnly: true, requestScoped: true, storeId: "store-1", checkedAt: "2026-07-14T08:00:00.000Z", partial: false, hasNext: false,
  requestScope: { limit: 100, offset: 0, since: "2026-07-13T00:00:00.000Z", to: "2026-07-14T00:00:00.000Z" },
  orders: [{ posting_number: "POST-1" }], missingEvidence: [],
  endpointAttempts: [{ source: "fbs_postings", status: "completed", errorCount: 0 }, { source: "product_details", status: "completed", errorCount: 0 }],
  ...overrides,
});

test("FBS receipt is server-safe and preserves partial/page evidence", () => {
  const result = buildFbsEvidenceReceipt(model({ partial: true, hasNext: true, pageComplete: false, datasetComplete: false, readCoverage: { status: "partial" }, missingEvidence: ["product_quantity:secret"] }), { environment: "production-readonly" });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.partial, true);
  assert.equal(result.receipt.hasNext, true);
  assert.equal(result.receipt.sourceCount, 1);
  assert.equal(result.receipt.pageComplete, false);
  assert.equal(result.receipt.datasetComplete, false);
  assert.equal(result.receipt.readCoverage, "partial");
  assert.match(result.receipt.scopeHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.receipt.storeRef, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result.receipt), /POST-1|secret/);
});

test("FBS receipt carries an explicit complete dataset boundary", () => {
  const result = buildFbsEvidenceReceipt(model({ pageComplete: true, datasetComplete: true, readCoverage: { status: "complete" } }), { environment: "production-readonly" });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.datasetComplete, true);
  assert.equal(result.receipt.readCoverage, "complete");
});

test("FBS receipt downgrades contradictory completion claims", () => {
  const result = buildFbsEvidenceReceipt(model({ pageComplete: false, datasetComplete: true, hasNext: true }), { environment: "production-readonly" });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.datasetComplete, false);
  assert.equal(result.receipt.readCoverage, "partial");
});

test("FBS receipt persists only the effective page scope and does not leak caller fields", () => {
  const result = buildFbsEvidenceReceipt(model({ requestScope: {
    since: "2026-07-13T00:00:00.000Z", to: "2026-07-14T00:00:00.000Z", status: "awaiting_packaging",
    warehouseId: 501, limit: 100, offset: 100, apiKey: "secret",
  } }), { environment: "production-readonly" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.receipt.requestScope, {
    since: "2026-07-13T00:00:00.000Z", to: "2026-07-14T00:00:00.000Z", status: "awaiting_packaging",
    warehouseId: 501, limit: 100, offset: 100,
  });
  assert.doesNotMatch(JSON.stringify(result.receipt), /apiKey|secret/);
});

test("FBS receipt refuses to persist without a store binding", () => {
  const result = buildFbsEvidenceReceipt(model({ storeId: "" }), { environment: "production-readonly" });
  assert.equal(result.reasonCode, "FBS_RECEIPT_STORE_REQUIRED");
});

test("FBS receipt repository requires explicit confirmation and persists server observation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-fbs-receipts-"));
  const repository = new FbsEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  try {
    assert.equal((await repository.recordServerObservation({ model: model(), environment: "production-readonly" })).reasonCode, "FBS_RECEIPT_CONFIRMATION_REQUIRED");
    const saved = await repository.recordServerObservation({ recordEvidence: true, model: model(), environment: "production-readonly" });
    assert.equal(saved.ok, true);
    assert.equal(saved.receipt.origin, "server_observed");
    assert.equal((await repository.list()).length, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("FBS receipt latest lookup is bound to page scope and freshness", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-fbs-receipt-scope-"));
  const repository = new FbsEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  const base = model({ checkedAt: "2026-07-14T08:00:00.000Z" });
  try {
    await repository.recordServerObservation({ recordEvidence: true, model: base, environment: "production-readonly" });
    assert.ok(await repository.findLatest({
      environment: "production-readonly", storeId: "store-1", requestScope: base.requestScope,
      now: Date.parse("2026-07-14T08:30:00.000Z"), maxAgeMs: 60 * 60 * 1000,
    }));
    assert.equal(await repository.findLatest({
      environment: "production-readonly", storeId: "store-1", requestScope: { ...base.requestScope, offset: 100 },
      now: Date.parse("2026-07-14T08:30:00.000Z"), maxAgeMs: 60 * 60 * 1000,
    }), null);
    assert.equal(await repository.findLatest({
      environment: "production-readonly", storeId: "store-1", requestScope: base.requestScope,
      now: Date.parse("2026-07-14T10:01:00.000Z"), maxAgeMs: 60 * 60 * 1000,
    }), null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("FBS cursor receipts keep page cursor in the persisted scope hash", () => {
  const first = buildFbsEvidenceReceipt(model({ requestScope: { ...model().requestScope, cursor: "", sortDir: "DESC", pagination: "cursor" } }), { environment: "production-readonly" });
  const second = buildFbsEvidenceReceipt(model({ requestScope: { ...model().requestScope, cursor: "cursor-page-2", sortDir: "DESC", pagination: "cursor" } }), { environment: "production-readonly" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.receipt.requestScope.pagination, "cursor");
  assert.equal(second.receipt.requestScope.cursor, "cursor-page-2");
  assert.notEqual(first.receipt.scopeHash, second.receipt.scopeHash);
});

test("FBS receipt seller view turns cursor and freshness evidence into a safe next action", () => {
  const base = buildFbsEvidenceReceipt(model({ checkedAt: "2026-07-14T08:00:00.000Z", hasNext: true }), { environment: "production-readonly" });
  const partial = buildFbsReceiptSellerView(base.receipt, { now: Date.parse("2026-07-14T08:10:00.000Z") });
  assert.equal(partial.status, "partial");
  assert.match(partial.nextAction, /下一批 cursor/);
  assert.equal(partial.verificationLevel, "server_observed");
  assert.match(partial.sideEffect, /不会备货/);

  const stale = buildFbsReceiptSellerView(base.receipt, { now: Date.parse("2026-07-14T10:01:00.000Z") });
  assert.equal(stale.status, "stale");
  assert.match(stale.nextAction, /过期/);
});

test("FBS receipt seller view maps permission, rate-limit, and timeout failures to recovery actions", () => {
  const base = model({ checkedAt: "2026-07-14T08:00:00.000Z", endpointAttempts: [
    { source: "fbs_postings", status: "failed", errorCount: 1, reasonCode: "403_FORBIDDEN" },
    { source: "product_details", status: "partial", errorCount: 0 },
  ] });
  const receipt = buildFbsEvidenceReceipt(base, { environment: "production-readonly" }).receipt;
  const permission = buildFbsReceiptSellerView(receipt, { now: Date.parse("2026-07-14T08:10:00.000Z") });
  assert.match(permission.nextAction, /权限/);

  const neutralReceipt = { ...receipt, endpointStatuses: [{ source: "fbs_postings", status: "failed", errorCount: 1 }, { source: "product_details", status: "partial", errorCount: 0 }] };
  const limited = buildFbsReceiptSellerView({ ...neutralReceipt, failureScenarios: ["429 rate_limit"] }, { now: Date.parse("2026-07-14T08:10:00.000Z") });
  assert.match(limited.nextAction, /限流/);

  const timeout = buildFbsReceiptSellerView({ ...neutralReceipt, failureScenarios: ["request_timeout"] }, { now: Date.parse("2026-07-14T08:10:00.000Z") });
  assert.match(timeout.nextAction, /cursor/);
});

test("FBS receipt preserves numeric HTTP permission status for seller recovery", () => {
  const receipt = buildFbsEvidenceReceipt({
    ...model(),
    endpointAttempts: [
      { source: "fbs_postings", status: "failed", statusCode: 403, errorCount: 1 },
      { source: "product_details", status: "completed", errorCount: 0 },
    ],
    datasetComplete: true,
  }, { environment: "production-readonly" });
  assert.equal(receipt.ok, true);
  assert.match(receipt.receipt.failureScenarios.join(" "), /403_FORBIDDEN/);
  const seller = buildFbsReceiptSellerView(receipt.receipt, { now: Date.parse("2026-07-14T08:10:00.000Z") });
  assert.equal(seller.status, "needs_review");
  assert.match(seller.nextAction, /权限不足/);
});

test("FBS receipt normalizes a numeric status field before persisting", () => {
  const receipt = buildFbsEvidenceReceipt({
    ...model(),
    endpointAttempts: [
      { source: "fbs_postings", status: 429, errorCount: 1 },
      { source: "product_details", status: "completed", errorCount: 0 },
    ],
    datasetComplete: true,
  }, { environment: "production-readonly" });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.receipt.endpointStatuses[0].status, "failed");
  assert.match(receipt.receipt.failureScenarios.join(" "), /429_RATE_LIMIT/);
});
