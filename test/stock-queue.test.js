import test from "node:test";
import assert from "node:assert/strict";
import { classifyStockErrors, pickWarehouse, workflowStockNodeFromJob } from "../src/stockQueue.js";

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
