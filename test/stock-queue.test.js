import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStockReconciliationPlan,
  classifyStockErrors,
  dryRunStockJobReconciliation,
  evaluateStockReconciliation,
  pickWarehouse,
  rankWarehousesForStock,
  reconcileDryRunStockJob,
  reconcileStockWriteWithReadback,
  stockJobWarehouseRecommendation,
  summarizeStockWriteResult,
  summarizeStockQueueOperations,
  stockDryRunSellerView,
  stockWriteOutcomeRequiresReview,
  validateStockDryRunInput,
  workflowStockNodeFromJob,
  productImportReadiness,
} from "../src/stockQueue.js";

test("stock queue does not treat rejected or unknown import states as inventory-ready", () => {
  assert.equal(productImportReadiness({ offer_id: "A", product_id: 1, status: "rejected" }).ready, false);
  assert.equal(productImportReadiness({ offer_id: "B", product_id: 2, status: "moderation_failed" }).reasonCode, "PRODUCT_IMPORT_NOT_READY");
  assert.equal(productImportReadiness({ offer_id: "C", product_id: 3, status: "imported" }).ready, true);
  assert.equal(productImportReadiness({ offer_id: "D", product_id: 4 }).reasonCode, "PRODUCT_IMPORT_STATUS_UNKNOWN");
});

test("stock write result summary preserves per-tuple failures and treats empty acknowledgement as unknown", () => {
  const summary = summarizeStockWriteResult({ result: [
    { offer_id: "A", warehouse_id: 100 },
    { offer_id: "B", warehouse_id: 100, error: { code: "DENIED", message: "not allowed" } },
    { offer_id: "C", warehouse_id: 100, errors: [{ code: "BAD_STOCK" }] },
  ] });
  assert.equal(summary.status, "partial");
  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.failedCount, 2);
  assert.equal(summary.items.find((item) => item.offer_id === "B").status, "failed");
  assert.equal(summary.items.find((item) => item.offer_id === "B").errors[0].code, "DENIED");
  assert.equal(summary.readbackRequired, true);
  assert.equal(summarizeStockWriteResult({ result: [] }).status, "unknown");
});

test("stock write transport failures remain needs_review instead of becoming replayable failures", () => {
  assert.equal(stockWriteOutcomeRequiresReview({ code: "ETIMEDOUT", message: "Ozon request timeout" }), true);
  assert.equal(stockWriteOutcomeRequiresReview({ status: 502, message: "upstream unavailable" }), true);
  assert.equal(stockWriteOutcomeRequiresReview({ status: 400, message: "invalid warehouse" }), false);
  assert.equal(stockWriteOutcomeRequiresReview({ message: "商品尚未创建" }), false);
});

test("stock queue operations summary is read-only and highlights stale workers", () => {
  const now = Date.parse("2026-01-01T01:00:00.000Z");
  const summary = summarizeStockQueueOperations([
    { id: "a", storeId: "store-a", status: "pending", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", storeId: "store-a", status: "failed", reasonCode: "STOCK_WRITE_FAILED", updatedAt: "2026-01-01T00:30:00.000Z" },
    { id: "c", storeId: "store-b", status: "checking_task", updatedAt: "2025-12-31T23:00:00.000Z" },
  ], { now, staleAfterMs: 30 * 60 * 1000 });
  assert.equal(summary.readOnly, true);
  assert.deepEqual(summary.byStatus, { pending: 1, failed: 1, checking_task: 1 });
  assert.deepEqual(summary.byReason, { STOCK_WRITE_FAILED: 1 });
  assert.deepEqual(summary.byStore, { "store-a": 2, "store-b": 1 });
  assert.equal(summary.staleRunning, 1);
  assert.equal(summary.needsReview, 0);
  assert.equal(summary.unresolvedReadback, 0);
  assert.match(summary.sideEffect, /未读取 Ozon/);
});

test("stock queue operations summary exposes unresolved write readback as a seller action", () => {
  const summary = summarizeStockQueueOperations([
    {
      id: "needs-readback",
      storeId: "store-a",
      status: "needs_review",
      reasonCode: "STOCK_WRITE_READBACK_REQUIRED",
      result: { readback: { status: "unknown" } },
    },
    {
      id: "partial-readback",
      storeId: "store-a",
      status: "failed",
      result: { readback: { status: "mismatch" } },
    },
  ]);
  assert.equal(summary.needsReview, 1);
  assert.equal(summary.unresolvedReadback, 2);
  assert.ok(summary.nextActions.some((item) => /Offer\/仓库 tuple/.test(item)));
});

test("stock dry-run input validation accepts bounded normalized evidence", () => {
  const result = validateStockDryRunInput({
    targetStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }],
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.targetStocks[0].offer_id, "SKU-1");
});

test("stock dry-run input validation rejects non-arrays and over-limit groups", () => {
  const nonArray = validateStockDryRunInput({
    targetStocks: {}, products: [], warehouses: [], currentStocks: [],
  });
  assert.equal(nonArray.ok, false);
  assert.equal(nonArray.status, 400);
  assert.equal(nonArray.reasonCode, "STOCK_DRY_RUN_ARRAY_REQUIRED");

  const tooMany = validateStockDryRunInput({
    targetStocks: Array.from({ length: 101 }, (_, index) => ({ offer_id: `SKU-${index}`, warehouse_id: 100, stock: 1 })),
    products: [], warehouses: [], currentStocks: [],
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.reasonCode, "STOCK_DRY_RUN_LIMIT_EXCEEDED");
});

test("stock dry-run input validation rejects malformed target and evidence rows", () => {
  const malformedTarget = validateStockDryRunInput({
    targetStocks: [{ offer_id: "", warehouse_id: 0, stock: -1 }],
    products: [], warehouses: [], currentStocks: [],
  });
  assert.equal(malformedTarget.ok, false);
  assert.equal(malformedTarget.reasonCode, "STOCK_DRY_RUN_TARGET_INVALID");

  const malformedEvidence = validateStockDryRunInput({
    targetStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 1 }],
    products: [{ offer_id: "SKU-1", product_id: 0 }],
    warehouses: [], currentStocks: [],
  });
  assert.equal(malformedEvidence.ok, false);
  assert.equal(malformedEvidence.reasonCode, "STOCK_DRY_RUN_EVIDENCE_INVALID");
});

test("stock dry-run rejects duplicate target Offer/warehouse tuples before execution", () => {
  const result = validateStockDryRunInput({
    targetStocks: [
      { offer_id: "SKU-1", warehouse_id: 100, stock: 1 },
      { offer_id: "SKU-1", warehouse_id: 100, stock: 2 },
    ],
    products: [],
    warehouses: [],
    currentStocks: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "STOCK_DRY_RUN_DUPLICATE_TARGET");
  assert.match(result.error, /SKU-1::100/);
});

test("stock job dry-run has zero network dependency and blocks missing evidence", () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("network forbidden in dry-run");
  };
  try {
    const result = dryRunStockJobReconciliation({
      job: { id: "job-1", storeId: "store-1", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 5 }] },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.executable, false);
    assert.deepEqual(result.missingEvidence.sort(), ["currentStocks", "products", "warehouses"]);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stock dry-run requires an explicit store binding before it can be executable", () => {
  const result = dryRunStockJobReconciliation({
    job: { id: "job-no-store", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 5 }] },
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }],
  });
  assert.equal(result.executable, false);
  assert.ok(result.missingEvidence.includes("storeId"));
});

test("stock job dry-run returns executable diff without scheduling a write", () => {
  const input = {
    job: { id: "job-2", storeId: "store-1", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }] },
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }],
  };
  const first = dryRunStockJobReconciliation(input);
  const second = dryRunStockJobReconciliation({ ...input, currentStocks: [...input.currentStocks] });
  assert.equal(first.status, "ready");
  assert.equal(first.executable, true);
  assert.deepEqual(first.diff, [{ offer_id: "SKU-1", warehouse_id: 100, current: 3, target: 8, delta: 5 }]);
  assert.match(first.idempotencyKey, /^stock:sha256:/);
  assert.equal(second.idempotencyKey, first.idempotencyKey);
});

test("stock dry-run treats a tuple without an explicit current quantity as unknown, never as zero", () => {
  const result = dryRunStockJobReconciliation({
    job: { id: "job-unknown-quantity", storeId: "store-1", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 0 }] },
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100 }],
  });
  assert.equal(result.executable, false);
  assert.equal(result.blockers[0].code, "CURRENT_STOCK_NOT_OBSERVED");
  assert.equal(result.blockers[0].warehouse_id, 100);
  assert.equal(stockDryRunSellerView(result).unknownTuples[0].current, null);
});

test("stock dry-run seller view explains differences and the safe next step", () => {
  const ready = stockDryRunSellerView(dryRunStockJobReconciliation({
    job: { id: "job-ui", storeId: "store-1", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }] },
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }],
  }));
  assert.equal(ready.statusLabel, "可以进入人工确认");
  assert.equal(ready.changeCount, 1);
  assert.match(ready.nextAction, /确认差异/);
  assert.equal(ready.changes[0].direction, "增加");

  const blocked = stockDryRunSellerView(dryRunStockJobReconciliation({
    job: { id: "job-blocked", storeId: "store-1", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }] },
  }));
  assert.equal(blocked.statusLabel, "暂不能继续");
  assert.match(blocked.blockers.join(" "), /商品状态证据/);
  assert.match(blocked.nextAction, /补齐/);
  assert.ok(blocked.blockerDetails.length > 0);
  assert.match(blocked.sideEffect, /禁止换幂等键重复写入/);

  const tupleBlocked = stockDryRunSellerView(dryRunStockJobReconciliation({
    job: { id: "job-tuple", storeId: "store-1", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }] },
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [],
  }));
  assert.equal(tupleBlocked.blockerDetails[0].offer_id, "SKU-1");
  assert.equal(tupleBlocked.blockerDetails[0].warehouse_id, 100);
  assert.match(tupleBlocked.blockers.join(" "), /Offer SKU-1/);
  assert.deepEqual(tupleBlocked.unknownTuples, [{ offer_id: "SKU-1", warehouse_id: 100, current: null }]);
  assert.deepEqual(tupleBlocked.targetTuples, [{ offer_id: "SKU-1", warehouse_id: 100, target: 8 }]);
  assert.match(tupleBlocked.blockers.join(" "), /仓库 100/);
  assert.match(tupleBlocked.nextAction, /Offer SKU-1 \/ 仓库 100/);

  const unchanged = stockDryRunSellerView(dryRunStockJobReconciliation({
    job: { id: "job-unchanged", storeId: "store-1", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }] },
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }],
  }));
  assert.equal(unchanged.statusLabel, "无需变更");
  assert.match(unchanged.nextAction, /不要创建写入任务/);
});

test("stock job dry-run reconciliation evaluates only supplied mock write and readback", () => {
  const dryRun = dryRunStockJobReconciliation({
    job: { id: "job-3", storeId: "store-1", stocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }] },
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }],
  });
  const accepted = reconcileDryRunStockJob({ dryRun, writeResponse: { result: [] } });
  assert.equal(accepted.status, "needs_review");
  assert.equal(accepted.reconciled, false);
  const reconciled = reconcileDryRunStockJob({
    dryRun,
    writeResponse: { result: [] },
    readback: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }],
  });
  assert.equal(reconciled.status, "reconciled");
  assert.equal(reconciled.idempotencyKey, dryRun.idempotencyKey);
});

test("stock queue write acknowledgement stays unresolved until exact tuple readback matches", async () => {
  const calls = [];
  const result = await reconcileStockWriteWithReadback({
    storeId: "store-1",
    stocks: [{ offer_id: "SKU-1", warehouse_id: 501, stock: 8 }],
    writeResponse: { result: [{ offer_id: "SKU-1", warehouse_id: 501 }] },
    readEndpoint: async (endpoint) => {
      calls.push(endpoint);
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 8, reserved: 0 }] }] };
      if (endpoint === "/v2/warehouse/list") return { result: [{ warehouse_id: 501, status: "created", is_rf: true }] };
      throw new Error("unexpected endpoint");
    },
    now: new Date("2026-07-17T12:00:00.000Z"),
  });
  assert.deepEqual(calls, ["/v3/product/list", "/v3/product/info/list", "/v4/product/info/stocks", "/v2/warehouse/list"]);
  assert.equal(result.reconciliation.status, "reconciled");
  assert.equal(result.reconciliation.reconciled, true);
  assert.equal(result.reconciliation.total, 1);
});

test("stock queue readback remains unresolved when the exact tuple is absent", async () => {
  const result = await reconcileStockWriteWithReadback({
    storeId: "store-1",
    stocks: [{ offer_id: "SKU-1", warehouse_id: 501, stock: 8 }],
    writeResponse: { result: [{ offer_id: "SKU-1", warehouse_id: 501 }] },
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 502, present: 8, reserved: 0 }] }] };
      if (endpoint === "/v2/warehouse/list") return { result: [{ warehouse_id: 501, status: "created", is_rf: true }] };
      throw new Error("unexpected endpoint");
    },
  });
  assert.equal(result.reconciliation.reconciled, false);
  assert.equal(result.reconciliation.status, "mismatch");
  assert.match(result.evidence.missingEvidence.join(" "), /current_stock:SKU-1:501/);
});

test("stock queue readback cannot promote an empty write acknowledgement", async () => {
  const result = await reconcileStockWriteWithReadback({
    storeId: "store-1",
    stocks: [{ offer_id: "SKU-1", warehouse_id: 501, stock: 8 }],
    writeResponse: { result: [] },
    readEndpoint: async () => ({ result: [] }),
  });
  assert.equal(result.reconciliation.status, "unknown");
  assert.equal(result.reconciliation.reconciled, false);
});

test("mixed stock acknowledgement preserves per-tuple failure and never reports success", () => {
  const result = reconcileDryRunStockJob({
    dryRun: {
      executable: true,
      idempotencyKey: "stock:partial",
      plan: {
        ready: true,
        idempotencyKey: "stock:partial",
        changes: [
          { offer_id: "SKU-OK", warehouse_id: 501, target: 8 },
          { offer_id: "SKU-BAD", warehouse_id: 501, target: 4 },
        ],
      },
    },
    writeResponse: {
      result: [
        { offer_id: "SKU-OK", warehouse_id: 501 },
        { offer_id: "SKU-BAD", warehouse_id: 501, errors: [{ code: "INVALID_STOCK", message: "bad target" }] },
      ],
    },
    readback: [{ offer_id: "SKU-OK", warehouse_id: 501, stock: 8 }],
  });
  assert.equal(result.status, "partial");
  assert.equal(result.reconciled, false);
  assert.equal(result.matched, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.items.find((item) => item.offer_id === "SKU-BAD").status, "write_failed");
});

test("stock reconciliation preflight blocks products, warehouses, and offers that are not ready", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [
      { offer_id: "READY", product_id: 10, status: "selling" },
      { offer_id: "MODERATING", product_id: 11, status: "moderating" },
    ],
    warehouses: [
      { warehouse_id: 100, status: "created", is_rf: true },
      { warehouse_id: 200, status: "disabled", is_rf: true },
    ],
    currentStocks: [{ offer_id: "READY", warehouse_id: 100, stock: 0 }],
    targetStocks: [
      { offer_id: "READY", warehouse_id: 100, stock: 5 },
      { offer_id: "MODERATING", warehouse_id: 100, stock: 2 },
      { offer_id: "MISSING", warehouse_id: 100, stock: 1 },
      { offer_id: "READY", warehouse_id: 200, stock: 3 },
    ],
  });

  assert.equal(plan.ready, false);
  assert.deepEqual(plan.blockers.map((item) => item.code).sort(), [
    "OFFER_NOT_FOUND",
    "PRODUCT_NOT_READY",
    "WAREHOUSE_NOT_READY",
  ]);
  assert.deepEqual(plan.changes, [{ offer_id: "READY", warehouse_id: 100, current: 0, target: 5, delta: 5 }]);
});

test("stock reconciliation requires explicit sale-ready product evidence", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [
      { offer_id: "NO-STATUS", product_id: 10 },
      { offer_id: "IMPORTED", product_id: 11, status: "imported" },
    ],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [],
    targetStocks: [
      { offer_id: "NO-STATUS", warehouse_id: 100, stock: 2 },
      { offer_id: "IMPORTED", warehouse_id: 100, stock: 2 },
    ],
  });

  assert.equal(plan.ready, false);
  assert.deepEqual(plan.blockers.map((item) => item.code), ["PRODUCT_NOT_READY", "PRODUCT_NOT_READY"]);
});

test("stock dry-run explains the product-to-inventory transition for an in-review product", () => {
  const dryRun = dryRunStockJobReconciliation({
    job: { id: "job-product-review", storeId: "store-1", stocks: [{ offer_id: "REVIEW", warehouse_id: 100, stock: 2 }] },
    products: [{ offer_id: "REVIEW", product_id: 10, status: "moderating" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "REVIEW", warehouse_id: 100, stock: 0 }],
  });
  const view = stockDryRunSellerView(dryRun);
  assert.equal(dryRun.executable, false);
  assert.equal(view.blockerDetails[0].observed_status, "moderating");
  assert.match(view.blockers.join(" "), /商品状态为 moderating/);
  assert.match(view.nextAction, /等待 Ozon 商品导入\/审核完成/);
});

test("stock dry-run distinguishes an unconfirmed product status from a known non-sale state", () => {
  const dryRun = dryRunStockJobReconciliation({
    job: { id: "job-product-unknown", storeId: "store-1", stocks: [{ offer_id: "UNKNOWN", warehouse_id: 100, stock: 2 }] },
    products: [{ offer_id: "UNKNOWN", product_id: 10 }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "UNKNOWN", warehouse_id: 100, stock: 0 }],
  });
  const view = stockDryRunSellerView(dryRun);
  assert.equal(view.blockerDetails[0].observed_status, "unknown");
  assert.match(view.blockers.join(" "), /商品状态尚未确认/);
  assert.match(view.nextAction, /重新读取商品详情和审核状态/);
});

test("stock readiness blocks stale sale-status evidence even when the old status was selling", () => {
  const dryRun = dryRunStockJobReconciliation({
    job: { id: "job-product-stale", storeId: "store-1", stocks: [{ offer_id: "STALE", warehouse_id: 100, stock: 2 }] },
    products: [{ offer_id: "STALE", product_id: 10, status: "selling", statusFreshness: "stale" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "STALE", warehouse_id: 100, stock: 0 }],
  });
  const view = stockDryRunSellerView(dryRun);
  assert.equal(dryRun.executable, false);
  assert.equal(view.blockerDetails[0].observed_status, "selling");
  assert.match(view.nextAction, /读取已过期/);
});

test("stock readiness blocks old or invalid product status timestamps", () => {
  const old = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "OLD", product_id: 10, status: "selling", checkedAt: "2026-07-14T08:00:00.000Z" }],
    warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "OLD", warehouse_id: 501, stock: 1 }],
    targetStocks: [{ offer_id: "OLD", warehouse_id: 501, stock: 2 }],
  });
  assert.equal(old.ready, false);
  assert.equal(old.blockers[0].code, "PRODUCT_NOT_READY");

  const invalid = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "INVALID", product_id: 10, status: "selling", checkedAt: "not-a-date" }],
    warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "INVALID", warehouse_id: 501, stock: 1 }],
    targetStocks: [{ offer_id: "INVALID", warehouse_id: 501, stock: 2 }],
  });
  assert.equal(invalid.ready, false);
  assert.equal(invalid.blockers[0].code, "PRODUCT_NOT_READY");
});

test("stock reconciliation blocks an explicitly hidden product even when status says selling", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "HIDDEN", product_id: 21, status: "selling", visible: false }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "HIDDEN", warehouse_id: 100, stock: 0 }],
    targetStocks: [{ offer_id: "HIDDEN", warehouse_id: 100, stock: 2 }],
  });
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.blockers.map((item) => item.code), ["PRODUCT_NOT_READY"]);
  assert.equal(plan.changes.length, 0);
});

test("stock reconciliation requires explicit created warehouse evidence", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "READY", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, is_rf: true }],
    currentStocks: [{ offer_id: "READY", warehouse_id: 100, stock: 1 }],
    targetStocks: [{ offer_id: "READY", warehouse_id: 100, stock: 2 }],
  });
  assert.equal(plan.ready, false);
  assert.ok(plan.blockers.some((item) => item.code === "WAREHOUSE_NOT_READY"));
});

test("stock reconciliation blocks a created warehouse when fulfillment mode is unknown", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "READY", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [{ offer_id: "READY", warehouse_id: 100, stock: 1 }],
    targetStocks: [{ offer_id: "READY", warehouse_id: 100, stock: 2 }],
    requireWarehouseModeEvidence: true,
  });
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.blockers, [{
    code: "WAREHOUSE_NOT_READY",
    offer_id: "READY",
    warehouse_id: 100,
  }]);
  assert.deepEqual(plan.changes, []);
});

test("seller dry-run remains blocked when target warehouse mode is unknown", () => {
  const dryRun = dryRunStockJobReconciliation({
    job: { id: "job-mode-unknown", storeId: "store-1", stocks: [{ offer_id: "READY", warehouse_id: 100, stock: 2 }] },
    products: [{ offer_id: "READY", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [{ offer_id: "READY", warehouse_id: 100, stock: 1 }],
    requireWarehouseModeEvidence: true,
  });
  const view = stockDryRunSellerView(dryRun);
  assert.equal(dryRun.executable, false);
  assert.equal(view.statusLabel, "暂不能继续");
  assert.match(view.blockers.join(" "), /仓库尚未明确可用/);
  assert.match(view.nextAction, /补齐/);
});

test("stock reconciliation never treats an unobserved warehouse stock row as zero", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "READY", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [],
    targetStocks: [{ offer_id: "READY", warehouse_id: 100, stock: 2 }],
  });
  assert.equal(plan.ready, false);
  assert.ok(plan.blockers.some((item) => item.code === "CURRENT_STOCK_NOT_OBSERVED"));
  assert.deepEqual(plan.changes, []);
});

test("stock reconciliation computes current to target diff and stable idempotency key", () => {
  const input = {
    storeId: "store-1",
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }],
    targetStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }],
  };
  const first = buildStockReconciliationPlan(input);
  const second = buildStockReconciliationPlan({ ...input, targetStocks: [...input.targetStocks] });
  assert.equal(first.ready, true);
  assert.deepEqual(first.changes, [{ offer_id: "SKU-1", warehouse_id: 100, current: 3, target: 8, delta: 5 }]);
  assert.match(first.idempotencyKey, /^stock:sha256:[a-f0-9]{64}$/);
  assert.equal(second.idempotencyKey, first.idempotencyKey);
});

test("stock reconciliation blocks duplicate target and ambiguous current tuples", () => {
  const duplicateTarget = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 3 }],
    targetStocks: [
      { offer_id: "SKU-1", warehouse_id: 100, stock: 8 },
      { offer_id: "SKU-1", warehouse_id: 100, stock: 9 },
    ],
  });
  assert.equal(duplicateTarget.ready, false);
  assert.equal(duplicateTarget.changes.length, 0);
  assert.equal(duplicateTarget.blockers.filter((item) => item.code === "DUPLICATE_TARGET_STOCK_TUPLE").length, 2);

  const ambiguousCurrent = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [
      { offer_id: "SKU-1", warehouse_id: 100, stock: 3 },
      { offer_id: "SKU-1", warehouse_id: 100, stock: 4 },
    ],
    targetStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 8 }],
  });
  assert.equal(ambiguousCurrent.ready, false);
  assert.deepEqual(ambiguousCurrent.changes, []);
  assert.equal(ambiguousCurrent.blockers[0].code, "CURRENT_STOCK_AMBIGUOUS");
});

test("accepted stock write remains pending reconciliation until readback matches", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "SKU-1", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 1 }],
    targetStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 5 }],
  });
  const accepted = evaluateStockReconciliation({ plan, writeResult: { result: [] } });
  assert.equal(accepted.status, "needs_review");
  assert.equal(accepted.reconciled, false);

  const reconciled = evaluateStockReconciliation({
    plan,
    writeResult: { result: [] },
    observedStocks: [{ offer_id: "SKU-1", warehouse_id: 100, stock: 5 }],
  });
  assert.equal(reconciled.status, "reconciled");
  assert.equal(reconciled.reconciled, true);
});

test("stock write readback treats a tuple without quantity as unresolved", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "ZERO", product_id: 10, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created", is_rf: true }],
    currentStocks: [{ offer_id: "ZERO", warehouse_id: 100, stock: 1 }],
    targetStocks: [{ offer_id: "ZERO", warehouse_id: 100, stock: 0 }],
  });
  const reconciliation = evaluateStockReconciliation({
    plan,
    writeResult: { result: [{ offer_id: "ZERO", warehouse_id: 100 }] },
    observedStocks: [{ offer_id: "ZERO", warehouse_id: 100 }],
  });
  assert.equal(reconciliation.status, "mismatch");
  assert.equal(reconciliation.reconciled, false);
  assert.equal(reconciliation.items[0].status, "missing");
});

test("stock readback reports partial, mismatch, and failed outcomes", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [
      { offer_id: "A", product_id: 1, status: "selling" },
      { offer_id: "B", product_id: 2, status: "selling" },
    ],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [
      { offer_id: "A", warehouse_id: 100, stock: 0 },
      { offer_id: "B", warehouse_id: 100, stock: 0 },
    ],
    targetStocks: [
      { offer_id: "A", warehouse_id: 100, stock: 4 },
      { offer_id: "B", warehouse_id: 100, stock: 7 },
    ],
  });
  const partial = evaluateStockReconciliation({
    plan,
    writeResult: { result: [] },
    observedStocks: [
      { offer_id: "A", warehouse_id: 100, stock: 4 },
      { offer_id: "B", warehouse_id: 100, stock: 6 },
    ],
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.items.find((item) => item.offer_id === "B").status, "mismatch");

  const mismatch = evaluateStockReconciliation({
    plan,
    writeResult: { result: [] },
    observedStocks: [
      { offer_id: "A", warehouse_id: 100, stock: 0 },
      { offer_id: "B", warehouse_id: 100, stock: 0 },
    ],
  });
  assert.equal(mismatch.status, "mismatch");

  const failed = evaluateStockReconciliation({
    plan,
    writeResult: { result: [{ offer_id: "A", warehouse_id: 100, errors: [{ code: "DENIED" }] }] },
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.accepted, false);
});

test("conflicting duplicate post-write readback tuples remain needs_review", () => {
  const plan = buildStockReconciliationPlan({
    storeId: "store-1",
    products: [{ offer_id: "DUP", product_id: 1, status: "selling" }],
    warehouses: [{ warehouse_id: 100, status: "created" }],
    currentStocks: [{ offer_id: "DUP", warehouse_id: 100, stock: 1 }],
    targetStocks: [{ offer_id: "DUP", warehouse_id: 100, stock: 5 }],
  });
  const result = evaluateStockReconciliation({
    plan,
    writeResult: { result: [] },
    observedStocks: [
      { offer_id: "DUP", warehouse_id: 100, stock: 5 },
      { offer_id: "DUP", warehouse_id: 100, stock: 7 },
    ],
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.ambiguousTuples, ["DUP::100"]);
  assert.equal(result.items[0].status, "ambiguous");
});

test("classifyStockErrors retries warehouse status only when a replacement exists", () => {
  const errors = [{ code: "WAREHOUSE_WRONG_STATUS", message: "warehouse unavailable" }];

  assert.deepEqual(classifyStockErrors(errors, { replacementWarehouseId: 1020 }), {
    shouldRetry: true,
    reasonCode: "STOCK_WAREHOUSE_INVALID",
  });
  assert.deepEqual(classifyStockErrors(errors, { replacementWarehouseId: 0 }), {
    shouldRetry: false,
    reasonCode: "STOCK_WAREHOUSE_INVALID",
  });
});

test("classifyStockErrors maps non-warehouse stock failures without retry", () => {
  assert.deepEqual(classifyStockErrors([{ code: "UNKNOWN", message: "stock is invalid" }]), {
    shouldRetry: false,
    reasonCode: "STOCK_WRITE_FAILED",
  });
});

test("classifyStockErrors retries while Ozon product tags are still validating", () => {
  assert.deepEqual(classifyStockErrors([{ code: "PRODUCT_HAS_NOT_BEEN_TAGGED_YET", message: "tags validation failed" }]), {
    shouldRetry: true,
    reasonCode: "PRODUCT_PENDING_TAGS",
  });
});

test("pickWarehouse prefers created warehouses over disabled ones", () => {
  const warehouse = pickWarehouse([
    { warehouse_id: 1, status: "disabled", is_rfbs: true },
    { warehouse_id: 2, status: "created", is_rfbs: true },
  ]);

  assert.equal(warehouse.warehouse_id, 2);
});

test("rankWarehousesForStock recommends a created warehouse matching delivery mode", () => {
  const result = rankWarehousesForStock({
    warehouses: [
      { warehouse_id: 101, name: "Old failed FBS", status: "created", delivery_method_type: "FBS", is_rfbs: true },
      { warehouse_id: 102, name: "Fallback RFBS", status: "created", delivery_method_type: "RFBS", is_rfbs: true },
      { warehouse_id: 103, name: "Best FBS", status: "created", delivery_method_type: "FBS", is_rfbs: true },
      { warehouse_id: 104, name: "Archived FBS", status: "disabled", delivery_method_type: "FBS", is_rfbs: true },
      { warehouse_id: 105, name: "Wrong status", status: "WAREHOUSE_WRONG_STATUS", delivery_method_type: "FBS", is_rfbs: true },
    ],
    excludedIds: [102],
    product: { deliveryMode: "FBS" },
    store: { deliveryMode: "FBS" },
    previousFailures: [
      { warehouseId: 101, reasonCode: "STOCK_WAREHOUSE_INVALID", errorCode: "WAREHOUSE_WRONG_STATUS" },
    ],
  });

  assert.equal(result.recommended?.warehouse_id, 103);
  assert.equal(result.recommendedReason, "状态可用，匹配商品/店铺配送模式");
  assert.deepEqual(result.excluded.map((item) => item.warehouse_id), [101, 102, 104, 105]);
  assert.match(result.excluded.find((item) => item.warehouse_id === 101).reason, /WAREHOUSE_WRONG_STATUS/);
  assert.match(result.excluded.find((item) => item.warehouse_id === 102).reason, /本轮重试已排除/);
  assert.match(result.excluded.find((item) => item.warehouse_id === 104).reason, /仓库状态不可用/);
  assert.match(result.excluded.find((item) => item.warehouse_id === 105).reason, /WAREHOUSE_WRONG_STATUS/);
});

test("rankWarehousesForStock returns a manual recommendation when no usable warehouse remains", () => {
  const result = rankWarehousesForStock({
    warehouses: [
      { warehouse_id: 201, name: "Closed", status: "disabled", delivery_method_type: "FBS" },
      { warehouse_id: 202, name: "Previous failed", status: "created", delivery_method_type: "FBS" },
    ],
    previousFailures: [
      { warehouseId: 202, reasonCode: "STOCK_WAREHOUSE_INVALID", errorCode: "WAREHOUSE_WRONG_STATUS" },
    ],
  });

  assert.equal(result.recommended, null);
  assert.equal(result.action, "manual_required");
  assert.match(result.safeNextAction, /读取 Ozon 仓库/);
});

test("stockJobWarehouseRecommendation excludes the failed job warehouse before retry", () => {
  const job = {
    id: "sq1",
    storeId: "ozon-main",
    reasonCode: "STOCK_WAREHOUSE_INVALID",
    stocks: [{ offer_id: "SKU1", stock: 10, warehouse_id: 301 }],
  };
  const result = stockJobWarehouseRecommendation(job, [
    { warehouse_id: 301, name: "Failed", status: "created" },
    { warehouse_id: 302, name: "Retry target", status: "created" },
  ], [job]);

  assert.equal(result.recommended?.warehouse_id, 302);
  assert.match(result.excluded.find((item) => item.warehouse_id === 301).reason, /WAREHOUSE_WRONG_STATUS|本轮重试/);
  assert.match(result.safeNextAction, /库存队列重试/);
});

test("workflowStockNodeFromJob maps stock success to stock_sync node", () => {
  const node = workflowStockNodeFromJob({
    id: "sq1",
    status: "success",
    taskId: 123,
    stocks: [{ offer_id: "SKU1", stock: 100, warehouse_id: 99 }],
  });

  assert.equal(node.key, "stock_sync");
  assert.equal(node.status, "success");
  assert.equal(node.output.taskId, 123);
});

test("workflow stock node keeps an unconfirmed write in human review", () => {
  const node = workflowStockNodeFromJob({ id: "sq-review", status: "needs_review", lastError: "readback required" });
  assert.equal(node.status, "waiting_human");
  assert.equal(node.output.sellerStatus, "needs_review");
  assert.deepEqual(node.actions, ["view_output", "manual_review"]);
});
