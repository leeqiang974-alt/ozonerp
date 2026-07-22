import test from "node:test";
import assert from "node:assert/strict";
import { gatherStockReconciliationEvidence } from "../src/stockReconciliationEvidence.js";

test("stock evidence aggregates four read-only endpoints into a safe canonical snapshot", async () => {
  const calls = [];
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: [" SKU-1 ", "SKU-1", "SKU-2"], warehouseIds: [501] }, {
    now: () => new Date("2026-07-12T12:00:00.000Z"),
    readEndpoint: async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }, { offer_id: "SKU-2", product_id: 102 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [
        { offer_id: "SKU-1", id: 101, status: { state: "selling", internal: "drop" }, visible: true },
        { offer_id: "SKU-2", id: 102, status: { state: "moderating" }, visible: false },
      ] };
      if (endpoint === "/v4/product/info/stocks") return { items: [
        { offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 8, reserved: 2 }, { present: 99 }] },
      ] };
      if (endpoint === "/v2/warehouse/list") return { result: [
        { warehouse_id: 501, name: "Secret warehouse", status: "created", is_rf: true, api_key: "drop" },
      ] };
      throw new Error("unexpected endpoint");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.requestScoped, true);
  assert.equal(result.completeForRequestedIds, false);
  assert.equal(result.liveReadObserved, false);
  assert.equal(result.verificationLevel, "partial");
  assert.equal(result.checkedAt, "2026-07-12T12:00:00.000Z");
  assert.deepEqual(calls.map((call) => call.endpoint), [
    "/v3/product/list", "/v3/product/info/list", "/v4/product/info/stocks", "/v2/warehouse/list",
  ]);
  assert.deepEqual(calls.map((call) => call.payload), [
    { filter: { offer_id: ["SKU-1", "SKU-2"] } },
    { offer_id: ["SKU-1", "SKU-2"] },
    { filter: { offer_id: ["SKU-1", "SKU-2"], visibility: "ALL" }, limit: 2, cursor: "" },
    { cursor: "", limit: 200, warehouse_ids: [501] },
  ]);
  assert.deepEqual(result.products, [
    { offer_id: "SKU-1", product_id: 101, status: "ready", visible: true },
    { offer_id: "SKU-2", product_id: 102, status: "pending", visible: false },
  ]);
  assert.deepEqual(result.warehouses, [{ warehouse_id: 501, status: "created", is_rf: true }]);
  assert.deepEqual(result.currentStocks, [{ offer_id: "SKU-1", product_id: 101, warehouse_id: 501, present: 8, reserved: 2 }]);
  assert.deepEqual(result.missingEvidence, ["current_stock:SKU-2", "current_stock:SKU-2:501"]);
  assert.equal(result.operationEvidence.length, 4);
  assert.ok(result.operationEvidence.every((entry) => /^sha256:[a-f0-9]{64}$/.test(entry.responseHash)));
  assert.doesNotMatch(JSON.stringify(result), /Secret warehouse|api_key|internal|present":99/);
});

test("stock evidence treats unknown envelopes and stock rows without warehouse/current dimensions as missing", async () => {
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1"], warehouseIds: [501] }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { unexpected: true };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [
        { present: 9, reserved: 0 },
        { warehouse_id: 501 },
      ] }] };
      if (endpoint === "/v2/warehouse/list") return { unexpected: true };
      return {};
    },
  });
  assert.equal(result.partial, true);
  assert.equal(result.completeForRequestedIds, false);
  assert.equal(result.products[0].status, "unknown");
  assert.deepEqual(result.currentStocks, []);
  assert.deepEqual(result.warehouses, []);
  assert.match(result.missingEvidence.join(" "), /product_details_response_unrecognized/);
  assert.match(result.missingEvidence.join(" "), /warehouses_response_unrecognized/);
  assert.match(result.missingEvidence.join(" "), /current_stock:SKU-1/);
});

test("stock evidence without a target warehouse stays incomplete instead of treating any warehouse as the target", async () => {
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1"] }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 4, reserved: 0 }] }] };
      return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }] };
    },
  });
  assert.equal(result.partial, true);
  assert.equal(result.completeForRequestedIds, false);
  assert.ok(result.missingEvidence.includes("warehouse_scope_required"));
});

test("stock evidence requires the exact requested offer and warehouse tuple", async () => {
  const result = await gatherStockReconciliationEvidence({
    storeId: "store-1",
    offerIds: ["SKU-1"],
    warehouseIds: [502],
  }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 4, reserved: 0 }] }] };
      return { warehouses: [
        { warehouse_id: 501, status: "created", is_rf: true },
        { warehouse_id: 502, status: "created", is_rf: true },
      ] };
    },
  });

  assert.equal(result.partial, true);
  assert.equal(result.completeForRequestedIds, false);
  assert.deepEqual(result.warehouseIds, [502]);
  assert.ok(result.missingEvidence.includes("current_stock:SKU-1:502"));
  assert.equal(result.currentStocks[0].warehouse_id, 501);
});

test("stock evidence does not accept a current row for an unobserved requested warehouse", async () => {
  const result = await gatherStockReconciliationEvidence({
    storeId: "store-1",
    offerIds: ["SKU-1"],
    warehouseIds: [502],
  }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 502, present: 4, reserved: 0 }] }] };
      return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }] };
    },
  });

  assert.equal(result.partial, true);
  assert.equal(result.completeForRequestedIds, false);
  assert.ok(result.missingEvidence.includes("warehouse:502"));
  assert.equal(result.sellerView.status, "partial");
  assert.match(result.sellerView.nextAction, /补齐缺失证据/);
});

test("stock evidence blocks an exact tuple whose product identity disagrees with the product read", async () => {
  const result = await gatherStockReconciliationEvidence({
    storeId: "store-1",
    offerIds: ["SKU-1"],
    warehouseIds: [501],
  }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 999, stocks: [{ warehouse_id: 501, present: 4, reserved: 0 }] }] };
      return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }] };
    },
  });
  assert.equal(result.partial, true);
  assert.equal(result.completeForRequestedIds, false);
  assert.ok(result.missingEvidence.includes("current_stock_product_mismatch:SKU-1:501"));
  assert.equal(result.currentStocks[0].product_id, 999);
});

test("created warehouses with is_rf false remain observed but mode eligibility stays unknown", async () => {
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1"], warehouseIds: [501] }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 4, reserved: 0 }] }] };
      return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: false }] };
    },
  });
  assert.equal(result.partial, true);
  assert.deepEqual(result.warehouses, [{ warehouse_id: 501, status: "created", is_rf: false }]);
  assert.equal(result.warehouseEligibility, "mode_unknown");
  assert.match(result.missingEvidence.join(" "), /warehouse_mode_unverified/);
  assert.doesNotMatch(result.missingEvidence.join(" "), /eligible_warehouse/);
});

test("stock evidence preserves observed RFBS mode for the seller dry-run", async () => {
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1"], warehouseIds: [501] }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 4, reserved: 0 }] }] };
      return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: false, is_rfbs: true, delivery_method_type: "RFBS" }] };
    },
  });
  assert.equal(result.partial, false);
  assert.deepEqual(result.warehouses, [{ warehouse_id: 501, status: "created", is_rf: false, is_rfbs: true, delivery_method_type: "RFBS" }]);
  assert.equal(result.warehouseEligibility, "mode_observed");
  assert.equal(result.liveReadObserved, false);
  assert.equal(result.verificationLevel, "locally_tested");
});

test("stock evidence only promotes a complete aggregate when the server route declares its observation mode", async () => {
  const readEndpoint = async (endpoint) => {
    if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
    if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
    if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 4, reserved: 0 }] }] };
    return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }] };
  };
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1"], warehouseIds: [501] }, { readEndpoint, observationMode: "server_read" });
  assert.equal(result.completeForRequestedIds, true);
  assert.equal(result.liveReadObserved, true);
  assert.equal(result.verificationLevel, "server_observed");
});

test("stock evidence separates complete reads from sale-ready product status", async () => {
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1"], warehouseIds: [501] }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "moderating" }, visible: false }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 2, reserved: 0 }] }] };
      return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }] };
    },
  });

  assert.equal(result.partial, false);
  assert.equal(result.productStatusReadyForAll, false);
  assert.equal(result.completeForRequestedIds, false);
  assert.equal(result.sellerView.status, "product_not_ready");
  assert.match(result.sellerView.nextAction, /审核通过/);
});

test("stock evidence remains partial and safe when read dependencies fail", async () => {
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1"] }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      throw new Error("API key=secret raw upstream response");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.equal(result.products[0].status, "unknown");
  assert.deepEqual(result.currentStocks, []);
  assert.equal(result.endpointAttempts.filter((item) => item.status === "failed").length, 3);
  assert.match(result.missingEvidence.join(" "), /product_details|current_stocks|warehouses/);
  assert.doesNotMatch(JSON.stringify(result), /secret|raw upstream/);
});

test("stock evidence keeps valid rows but marks embedded endpoint and item errors partial", async () => {
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1", "SKU-2"] }, {
    readEndpoint: async (endpoint) => {
      if (endpoint === "/v3/product/list") return {
        result: { items: [{ offer_id: "SKU-1", product_id: 101 }, { offer_id: "SKU-2", product_id: 102, errors: [{ message: "private item failure" }] }] },
        warnings: [{ message: "non blocking warning" }],
      };
      if (endpoint === "/v3/product/info/list") return {
        items: [
          { offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true },
          { offer_id: "SKU-2", id: 102, status: { state: "moderating" }, visible: false },
        ],
        error: { message: "private top-level error" },
      };
      if (endpoint === "/v4/product/info/stocks") return {
        result: {
          items: [
            { offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 3, reserved: 0 }] },
            { offer_id: "SKU-2", product_id: 102, stocks: [{ warehouse_id: 501, present: 4, reserved: 1 }], error: "private stock row error" },
          ],
          errors: [{ code: "PARTIAL" }],
        },
      };
      return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }] };
    },
  });

  assert.equal(result.partial, true);
  assert.equal(result.completeForRequestedIds, false);
  assert.equal(result.products.length, 2);
  assert.equal(result.currentStocks.length, 2);
  assert.deepEqual(result.endpointAttempts.map((attempt) => attempt.status), ["partial", "partial", "partial", "completed"]);
  assert.deepEqual(result.endpointAttempts.map((attempt) => attempt.errorCount), [1, 1, 2, 0]);
  assert.match(result.missingEvidence.join(" "), /embedded_errors:product_list/);
  assert.match(result.missingEvidence.join(" "), /embedded_error:product_list:SKU-2/);
  assert.match(result.missingEvidence.join(" "), /embedded_error:current_stocks:SKU-2/);
  assert.doesNotMatch(JSON.stringify(result), /private|non blocking warning|PARTIAL/);
});

test("stock and warehouse reads consume bounded cursors before declaring requested evidence missing", async () => {
  const calls = [];
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1", "SKU-2"], warehouseIds: [502] }, {
    readEndpoint: async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }, { offer_id: "SKU-2", product_id: 102 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [
        { offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true },
        { offer_id: "SKU-2", id: 102, status: { state: "selling" }, visible: true },
      ] };
      if (endpoint === "/v4/product/info/stocks") return payload.cursor
        ? { items: [{ offer_id: "SKU-2", product_id: 102, stocks: [{ warehouse_id: 502, present: 3, reserved: 0 }] }] }
        : { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 502, present: 4, reserved: 0 }] }], cursor: "stocks-next" };
      if (endpoint === "/v2/warehouse/list") return payload.cursor
        ? { result: [{ warehouse_id: 502, status: "created", is_rf: true }] }
        : { result: [{ warehouse_id: 501, status: "created", is_rf: true }], last_id: "warehouses-next" };
      throw new Error("unexpected endpoint");
    },
  });
  assert.equal(result.completeForRequestedIds, true);
  assert.equal(result.endpointAttempts.find((row) => row.endpoint === "/v4/product/info/stocks").pageCount, 2);
  assert.equal(result.endpointAttempts.find((row) => row.endpoint === "/v2/warehouse/list").pageCount, 2);
  assert.deepEqual(calls.filter((row) => row.endpoint === "/v4/product/info/stocks").map((row) => row.payload.cursor), ["", "stocks-next"]);
  assert.deepEqual(calls.filter((row) => row.endpoint === "/v2/warehouse/list").map((row) => row.payload.cursor), ["", "warehouses-next"]);
});

test("repeated stock cursor stays partial and exposes a seller recovery signal", async () => {
  const result = await gatherStockReconciliationEvidence({ storeId: "store-1", offerIds: ["SKU-1"], warehouseIds: [501] }, {
    readEndpoint: async (endpoint, payload) => {
      if (endpoint === "/v3/product/list") return { result: { items: [{ offer_id: "SKU-1", product_id: 101 }] } };
      if (endpoint === "/v3/product/info/list") return { items: [{ offer_id: "SKU-1", id: 101, status: { state: "selling" }, visible: true }] };
      if (endpoint === "/v4/product/info/stocks") return { items: [{ offer_id: "SKU-1", product_id: 101, stocks: [{ warehouse_id: 501, present: 4, reserved: 0 }] }], cursor: "same" };
      return { warehouses: [{ warehouse_id: 501, status: "created", is_rf: true }] };
    },
  });
  assert.equal(result.partial, true);
  assert.ok(result.missingEvidence.includes("pagination_cursor_repeated:/v4/product/info/stocks"));
  assert.equal(result.endpointAttempts.find((row) => row.endpoint === "/v4/product/info/stocks").paginationCursorRepeated, true);
});

test("stock evidence rejects non-canonical or oversized input without reading endpoints", async () => {
  let calls = 0;
  const deps = { readEndpoint: async () => { calls += 1; } };
  assert.equal((await gatherStockReconciliationEvidence({ storeId: "", offerIds: ["SKU"] }, deps)).reasonCode, "STOCK_EVIDENCE_STORE_REQUIRED");
  assert.equal((await gatherStockReconciliationEvidence({ storeId: "store", offerIds: [] }, deps)).reasonCode, "STOCK_EVIDENCE_OFFERS_REQUIRED");
  assert.equal((await gatherStockReconciliationEvidence({ storeId: "store", offerIds: Array.from({ length: 101 }, (_, i) => `SKU-${i}`) }, deps)).reasonCode, "STOCK_EVIDENCE_OFFERS_LIMIT_EXCEEDED");
  assert.equal((await gatherStockReconciliationEvidence({ storeId: "store", offerIds: ["x".repeat(129)] }, deps)).reasonCode, "STOCK_EVIDENCE_OFFER_INVALID");
  assert.equal(calls, 0);
});
