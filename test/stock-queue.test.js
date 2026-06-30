import test from "node:test";
import assert from "node:assert/strict";
import { classifyStockErrors, pickWarehouse, rankWarehousesForStock, stockJobWarehouseRecommendation, workflowStockNodeFromJob } from "../src/stockQueue.js";

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
