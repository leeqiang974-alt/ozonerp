import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildFbsOrderReadModel, filterFbsOrderReadModel, readFbsProductDetailsInBatches } from "../src/fbsOrderReadModel.js";

test("synthetic redacted FBS fixture replays through the read model without claiming live evidence", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/ozon/fbs-postings-basic.synthetic.json", import.meta.url), "utf8"));
  assert.equal(fixture.fixtureType, "synthetic_redacted");
  const result = buildFbsOrderReadModel({
    postingResponse: fixture,
    productDetailResponse: { items: [] },
    requestScope: { since: "2026-07-12T00:00:00Z", to: "2026-07-13T00:00:00Z", limit: 100, offset: 0 },
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].posting_number, "POSTING-REDACTED-001");
  assert.equal(result.partial, true);
  assert.equal(result.sellerView.status, "partial");
  assert.match(result.sellerView.nextAction, /重新读取/);
  assert.equal(result.requestScoped, true);
});

test("FBS read model does not claim request-scoped evidence when the query scope is absent", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: { result: { has_next: false, postings: [] } },
    productDetailResponse: { items: [] },
  });
  assert.equal(result.requestScoped, false);
});

test("FBS order read model preserves operational facts and drops financial/raw secrets", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        has_next: true,
        postings: [{
          posting_number: "POST-1",
          order_number: "ORDER-1",
          status: "awaiting_packaging",
          substatus: "posting_acceptance_in_progress",
          tracking_number: "TRACK-1",
          shipment_date: "2026-07-13T09:00:00Z",
          delivering_date: "2026-07-18T09:00:00Z",
          analytics_data: { warehouse_id: 501, warehouse_name: "Moscow FBS", financial_secret: "drop" },
          financial_data: { payout: 999, api_key: "drop" },
          products: [{ offer_id: "SKU-1", sku: 101, name: "Posting name", quantity: 2, price: "999" }],
        }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-1", id: 101, name: "Detail name", primary_image: "https://example.com/a.jpg", commissions: [{ secret: true }] }] },
    checkedAt: "2026-07-12T13:00:00.000Z",
    requestScope: { since: "2026-07-01", to: "2026-07-12", status: "awaiting_packaging", warehouseId: 501, limit: 50, offset: 0 },
  });

  assert.equal(result.readOnly, true);
  assert.equal(result.partial, false);
  assert.equal(result.hasNext, true);
  assert.equal(result.pageComplete, true);
  assert.equal(result.datasetComplete, false);
  assert.match(result.sellerView.nextAction, /待备货/);
  assert.equal(result.checkedAt, "2026-07-12T13:00:00.000Z");
  assert.deepEqual(result.orders[0], {
    posting_number: "POST-1", order_number: "ORDER-1", status: "awaiting_packaging",
    statusGroup: "awaiting_packaging",
    substatus: "posting_acceptance_in_progress", tracking_number: "TRACK-1",
    status_label: "待备货",
    warehouse_id: 501,
    warehouse: "Moscow FBS",
    accepted_at: "",
    shipment_date: "2026-07-13T09:00:00.000Z",
    delivery_service: "",
    delivery_type: "",
    delivery_method: "",
    financialStatus: "not_requested",
    warehouseEvidence: { id: 501, name: "Moscow FBS" },
    warehouseMapping: { status: "mapped", id: 501, name: "Moscow FBS" },
    deadlines: { shipmentAt: "2026-07-13T09:00:00.000Z", deliveringAt: "2026-07-18T09:00:00.000Z" },
    deadlineStatus: "upcoming",
    products: [{ offer_id: "SKU-1", sku: "101", name: "Detail name", quantity: 2, quantityStatus: "known", image: "https://example.com/a.jpg", detailStatus: "matched" }],
    task: {
      state: "ready_for_review",
      code: "AWAITING_PACKAGING",
      nextAction: "核对商品、数量和仓库；打包动作仍需受控接口与回读。",
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /999|api_key|financial_secret|commissions|price/);
});

test("FBS detail evidence is partial when the response identity differs from the selected posting", () => {
  const result = buildFbsOrderReadModel({
    expectedPostingIdentity: "POST-SELECTED",
    postingResponse: {
      result: {
        postings: [{
          posting_number: "POST-OTHER",
          status: "delivered",
          products: [{ offer_id: "SKU-OTHER", quantity: 1 }],
        }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-OTHER", name: "其他商品" }] },
  });
  assert.equal(result.expectedPostingIdentity, "POST-SELECTED");
  assert.equal(result.partial, true);
  assert.match(result.missingEvidence.join(" "), /posting_identity_mismatch/);
  assert.equal(result.sellerView.status, "partial");
});

test("FBS fulfillment rows never become inventory evidence or sale readiness", () => {
  const result = buildFbsOrderReadModel({
    storeId: "store-a",
    postingResponse: {
      result: {
        postings: [{
          posting_number: "POST-STOCK-BOUNDARY",
          status: "awaiting_packaging",
          products: [{ offer_id: "OFFER-1", quantity: 2, present: 99, stock: 99, sale_ready: true }],
        }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "OFFER-1", id: 11, name: "商品" }] },
  });

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /currentStocks|observedStocks|sale_ready|present|stock/);
  assert.equal(result.orders[0].products[0].quantity, 2);
  assert.equal(result.storeId, "store-a");
  assert.equal(result.inventoryEvidence, undefined);
  assert.equal(result.saleReady, undefined);
});

test("FBS seller view gives an actionable next step for awaiting delivery", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        postings: [{
          posting_number: "POST-NEXT",
          status: "awaiting_deliver",
          analytics_data: { warehouse_id: 501, warehouse_name: "已映射仓库" },
          shipment_date: "2099-01-02T00:00:00Z",
          products: [{ offer_id: "SKU-NEXT", quantity: 1 }],
        }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-NEXT", id: 1, name: "已匹配商品" }] },
  });
  assert.equal(result.sellerView.status, "evidence_ready");
  assert.match(result.sellerView.nextAction, /待发运/);
  assert.match(result.sellerView.sideEffect, /不发运/);
});

test("FBS awaiting order without warehouse mapping is blocked with a seller repair task", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: { postings: [{ posting_number: "POST-WAREHOUSE-MISSING", status: "awaiting_packaging", shipment_date: "2099-01-02T00:00:00Z", products: [{ offer_id: "SKU-W", quantity: 1 }] }] },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-W", name: "已匹配商品" }] },
    checkedAt: "2026-07-17T00:00:00Z",
  });
  assert.equal(result.orders[0].warehouseMapping.status, "unknown");
  assert.equal(result.orders[0].task.code, "ORDER_WAREHOUSE_MAPPING_UNKNOWN");
  assert.equal(result.orders[0].task.state, "blocked");
  assert.equal(result.sellerView.status, "manual_review");
  assert.match(result.sellerView.nextAction, /仓库/);
  assert.match(result.sellerView.sideEffect, /不发运/);
});

test("FBS awaiting order with an expired shipment deadline is manual review", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: { postings: [{ posting_number: "POST-DEADLINE", status: "awaiting_deliver", shipment_date: "2026-07-16T23:00:00Z", analytics_data: { warehouse_id: 501, warehouse_name: "已映射仓库" }, products: [{ offer_id: "SKU-D", quantity: 1 }] }] },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-D", name: "已匹配商品" }] },
    checkedAt: "2026-07-17T00:00:00Z",
  });
  assert.equal(result.orders[0].deadlineStatus, "overdue");
  assert.equal(result.orders[0].task.code, "ORDER_SHIPMENT_DEADLINE_PASSED");
  assert.equal(result.orders[0].task.state, "manual_review");
  assert.equal(result.sellerView.status, "manual_review");
  assert.match(result.sellerView.nextAction, /截止时间|人工/);
  assert.equal(result.sellerView.sellerTasks[0].code, "ORDER_SHIPMENT_DEADLINE_PASSED");
  assert.match(result.sellerView.sellerTasks[0].nextAction, /人工核对/);
  assert.equal(result.sellerView.sellerTasks[0].label, "人工核对已超时订单");
  assert.equal(result.sellerView.sellerTasks[0].priority, "urgent");
});

test("FBS dispute is explicit and outranks packaging or deadline actions", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: { postings: [{ posting_number: "POST-DISPUTE", status: "awaiting_packaging", substatus: "customer_dispute", shipment_date: "2026-07-16T23:00:00Z", analytics_data: { warehouse_id: 501, warehouse_name: "已映射仓库" }, products: [{ offer_id: "SKU-DISPUTE", quantity: 1 }] }] },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-DISPUTE", name: "争议商品" }] },
    checkedAt: "2026-07-17T00:00:00Z",
  });
  assert.equal(result.orders[0].statusGroup, "dispute");
  assert.equal(result.orders[0].status_label, "争议");
  assert.equal(result.orders[0].task.code, "ORDER_DISPUTE");
  assert.match(result.orders[0].task.nextAction, /人工处理争议/);
  assert.match(result.sellerView.nextAction, /争议/);
  assert.match(result.sellerView.sideEffect, /不发运/);
});

test("FBS raw disputed status enters after-sales recovery even without dispute substatus", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: { result: { postings: [{ posting_number: "POST-DISPUTED", status: "disputed", products: [{ offer_id: "SKU-D", quantity: 1 }] }] } },
    productDetailResponse: { items: [{ offer_id: "SKU-D", name: "争议商品" }] },
  });
  assert.equal(result.orders[0].statusGroup, "dispute");
  assert.equal(result.counts.dispute, 1);
  assert.equal(result.orders[0].task.code, "ORDER_DISPUTE");
});

test("FBS seller summary prioritizes dispute over a simultaneous shipment deadline", () => {
  const result = buildFbsOrderReadModel({
    checkedAt: "2026-07-16T12:00:00.000Z",
    postingResponse: {
      result: {
        postings: [{
          posting_number: "POST-DISPUTE-SOON",
          status: "awaiting_packaging",
          substatus: "customer_dispute",
          shipment_date: "2026-07-16T20:00:00.000Z",
          analytics_data: { warehouse_id: 501, warehouse_name: "已映射仓库" },
          products: [{ offer_id: "SKU-DISPUTE-SOON", quantity: 1 }],
        }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-DISPUTE-SOON", name: "争议商品" }] },
  });

  assert.equal(result.orders[0].deadlineStatus, "due_soon");
  assert.match(result.sellerView.nextAction, /争议订单/);
  assert.doesNotMatch(result.sellerView.nextAction, /12 小时/);
});

test("FBS seller task keeps technical code for audit but exposes an executable seller label", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: { postings: [{ posting_number: "POST-LABEL", status: "awaiting_packaging", products: [{ offer_id: "SKU-LABEL", quantity: 1 }] }] },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-LABEL", name: "待映射商品" }] },
  });
  const task = result.sellerView.sellerTasks.find((item) => item.code === "ORDER_WAREHOUSE_MAPPING_UNKNOWN");
  assert.equal(task.label, "补齐仓库映射");
  assert.equal(task.priority, "high");
  assert.match(task.nextAction, /仓库映射/);
});

test("FBS deadline within twelve hours is promoted to an urgent seller task", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: { postings: [{ posting_number: "POST-DEADLINE-SOON", status: "awaiting_packaging", shipment_date: "2026-07-17T08:00:00Z", analytics_data: { warehouse_id: 501, warehouse_name: "已映射仓库" }, products: [{ offer_id: "SKU-SOON", quantity: 1 }] }] },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-SOON", name: "待备货商品" }] },
    checkedAt: "2026-07-17T00:00:00Z",
  });

  assert.equal(result.orders[0].deadlineStatus, "due_soon");
  assert.equal(result.orders[0].task.code, "ORDER_SHIPMENT_DEADLINE_SOON");
  assert.equal(result.orders[0].task.state, "manual_review");
  assert.equal(result.sellerView.status, "manual_review");
  assert.match(result.sellerView.nextAction, /12 小时/);
});

test("FBS awaiting order without a shipment deadline never becomes ready", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: { postings: [{ posting_number: "POST-DEADLINE-UNKNOWN", status: "awaiting_packaging", analytics_data: { warehouse_id: 501, warehouse_name: "已映射仓库" }, products: [{ offer_id: "SKU-DU", quantity: 1 }] }] },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-DU", name: "已匹配商品" }] },
    checkedAt: "2026-07-17T00:00:00Z",
  });
  assert.equal(result.orders[0].deadlineStatus, "unknown");
  assert.equal(result.orders[0].task.code, "ORDER_SHIPMENT_DEADLINE_UNKNOWN");
  assert.equal(result.sellerView.status, "manual_review");
  assert.match(result.sellerView.nextAction, /截止时间/);
});

test("unknown FBS status is surfaced as manual review instead of no action", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        postings: [{
          posting_number: "POST-UNKNOWN",
          status: "new_vendor_state",
          products: [{ offer_id: "SKU-UNKNOWN", quantity: 1 }],
        }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-UNKNOWN", name: "已匹配商品" }] },
  });

  assert.equal(result.orders[0].statusGroup, "unknown");
  assert.equal(result.orders[0].task.state, "manual_review");
  assert.equal(result.orders[0].task.code, "ORDER_STATUS_UNKNOWN");
  assert.match(result.orders[0].task.nextAction, /人工核对|重新读取/);
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.sellerView.status, "unknown");
  assert.match(result.sellerView.reason, /未识别/);
  assert.match(result.sellerView.nextAction, /状态未知/);
});

test("FBS seller view marks an unconsumed next page as partial coverage", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        has_next: true,
        postings: [{
          posting_number: "POST-PAGE-1",
          status: "delivered",
          products: [{ offer_id: "SKU-PAGE-1", quantity: 1 }],
        }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-PAGE-1", name: "已匹配商品" }] },
    verificationLevel: "server_observed",
  });
  assert.equal(result.partial, false);
  assert.equal(result.datasetComplete, false);
  assert.equal(result.sellerView.status, "partial");
  assert.match(result.sellerView.reason, /后续分页/);
  assert.equal(result.sellerView.sellerTasks.some((task) => task.code === "FBS_READ_PAGINATION_INCOMPLETE"), true);
  assert.equal(result.verificationLevel, "server_observed");
});

test("FBS seller view does not call an empty first page a clean fulfillment queue when pagination remains", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: { result: { has_next: true, postings: [] } },
    productDetailResponse: { items: [] },
    verificationLevel: "server_observed",
  });
  assert.equal(result.sellerView.status, "partial");
  assert.match(result.sellerView.nextAction, /后续分页/);
  assert.doesNotMatch(result.sellerView.nextAction, /当前读取范围没有待处理履约订单/);
});

test("FBS v4 cursor response is retained as the next read boundary", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        cursor: "cursor-next-2",
        postings: [{ posting_number: "POST-CURSOR", status: "delivered", products: [{ offer_id: "SKU-CURSOR", quantity: 1 }] }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-CURSOR", name: "游标商品" }] },
    requestScope: { since: "2026-07-19T00:00:00Z", to: "2026-07-20T00:00:00Z", limit: 100, cursor: "cursor-next-1", sortDir: "DESC", pagination: "cursor" },
  });
  assert.equal(result.nextCursor, "cursor-next-2");
  assert.equal(result.hasNext, true);
  assert.equal(result.datasetComplete, false);
  assert.deepEqual(result.requestScope, {
    since: "2026-07-19T00:00:00.000Z",
    to: "2026-07-20T00:00:00.000Z",
    status: "",
    warehouseId: null,
    limit: 100,
    offset: 0,
    cursor: "cursor-next-1",
    sortDir: "DESC",
    pagination: "cursor",
  });
  assert.equal(result.readCoverage.nextCursor, "cursor-next-2");
});

test("FBS next page stays the seller next action even when the current page has no work", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        has_next: true,
        postings: [{ posting_number: "POST-PAGE-EMPTY-WORK", status: "delivered", products: [{ offer_id: "SKU-PAGE-EMPTY-WORK", quantity: 1 }] }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-PAGE-EMPTY-WORK", name: "已匹配商品" }] },
  });
  assert.equal(result.sellerView.status, "partial");
  assert.match(result.sellerView.nextAction, /下一批|后续分页|不能代表全部订单/);
  assert.doesNotMatch(result.sellerView.nextAction, /没有待处理履约订单/);
});

test("FBS pagination boundary duplicate postings are counted once", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        has_next: false,
        postings: [
          { posting_number: "POST-BOUNDARY", status: "delivered", products: [{ offer_id: "SKU-B", quantity: 1 }] },
          { posting_number: "POST-BOUNDARY", status: "delivered", products: [{ offer_id: "SKU-B", quantity: 1 }] },
        ],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-B", name: "边界重复商品" }] },
  });
  assert.equal(result.orders.length, 1);
  assert.equal(result.counts.all, 1);
  assert.equal(result.duplicatePostingCount, 1);
  assert.equal(result.readCoverage.duplicatePostingCount, 1);
  assert.equal(result.partial, false);
});

test("conflicting duplicate posting identities remain partial and require reread", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        postings: [
          { posting_number: "POST-CONFLICT", status: "delivered", products: [{ offer_id: "SKU-C", quantity: 1 }] },
          { posting_number: "POST-CONFLICT", status: "cancelled", products: [{ offer_id: "SKU-C", quantity: 1 }] },
        ],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-C", name: "冲突状态商品" }] },
  });
  assert.equal(result.orders.length, 1);
  assert.equal(result.duplicatePostingCount, 1);
  assert.match(result.missingEvidence.join(" "), /posting_ambiguous:POST-CONFLICT/);
  assert.equal(result.partial, true);
  assert.equal(result.sellerView.status, "partial");
  assert.equal(result.sellerView.sellerTasks.some((task) => task.code === "FBS_READ_EVIDENCE_PARTIAL"), true);
  assert.match(result.sellerView.nextAction, /重新读取/);
});

test("malformed has_next never promotes an FBS page to complete coverage", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        // A proxy/cache can stringify a boolean. Treat that as unknown
        // pagination evidence instead of silently converting it to false.
        has_next: "true",
        postings: [{ posting_number: "POST-PAGE-MALFORMED", status: "delivered", products: [{ offer_id: "SKU-PAGE-MALFORMED", quantity: 1 }] }],
      },
    },
    productDetailResponse: { items: [{ offer_id: "SKU-PAGE-MALFORMED", name: "已匹配商品" }] },
  });
  assert.equal(result.hasNext, false);
  assert.equal(result.partial, true);
  assert.equal(result.pageComplete, false);
  assert.equal(result.datasetComplete, false);
  assert.match(result.missingEvidence.join(" "), /pagination_signal_invalid/);
  assert.equal(result.sellerView.status, "partial");
});

test("missing or failed product detail keeps orders and marks products unknown", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: { result: { postings: [{ posting_number: "POST-2", status: "awaiting_deliver", products: [{ offer_id: "SKU-2", quantity: 1, name: "Order product" }] }] } },
    productDetailResponse: null,
    productDetailFailed: true,
    productDetailError: "API key=secret raw response",
    checkedAt: "2026-07-12T13:01:00Z",
    requestScope: { limit: 100, offset: 0 },
  });
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].products[0].name, "Order product");
  assert.equal(result.orders[0].products[0].detailStatus, "unknown");
  assert.equal(result.partial, true);
  assert.equal(result.pageComplete, false);
  assert.match(result.missingEvidence.join(" "), /product_details/);
  assert.equal(result.endpointAttempts.find((item) => item.source === "product_details").status, "failed");
  assert.doesNotMatch(JSON.stringify(result), /secret|raw response/);
});

test("posting and detail embedded errors retain safe rows but make evidence partial", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: { result: { postings: [{ posting_number: "POST-3", status: "delivering", error: "private", products: [{ offer_id: "SKU-3", quantity: 1 }] }], errors: [{ private: true }] } },
    productDetailResponse: { items: [{ offer_id: "SKU-3", id: 303, name: "Known", errors: [{ private: true }] }] },
    requestScope: { limit: 10, offset: 0 },
  });
  assert.equal(result.orders.length, 1);
  assert.equal(result.partial, true);
  assert.equal(result.hasNext, false);
  assert.deepEqual(result.endpointAttempts.map((item) => item.status), ["partial", "partial"]);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("missing or invalid FBS quantities remain unknown instead of becoming zero", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: { result: { postings: [{ posting_number: "POST-Q", products: [
      { offer_id: "SKU-Q", quantity: "not-a-number" },
      { offer_id: "SKU-ZERO", quantity: 0 },
    ] }] } },
    productDetailResponse: { items: [{ offer_id: "SKU-Q", name: "Known" }, { offer_id: "SKU-ZERO", name: "Zero" }] },
  });
  assert.equal(result.orders[0].products[0].quantity, null);
  assert.equal(result.orders[0].products[0].quantityStatus, "unknown");
  assert.equal(result.orders[0].products[1].quantity, 0);
  assert.equal(result.orders[0].products[1].quantityStatus, "known");
  assert.equal(result.partial, true);
  assert.match(result.missingEvidence.join(" "), /product_quantity:SKU-Q/);
});

test("FBS order without product rows stays blocked instead of becoming a ready fulfillment fact", () => {
  const result = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        postings: [{
          posting_number: "POST-NO-PRODUCTS",
          status: "awaiting_packaging",
          analytics_data: { warehouse_id: 501, warehouse_name: "已映射仓库" },
          shipment_date: "2099-01-02T00:00:00Z",
        }],
      },
    },
    productDetailResponse: { items: [] },
    checkedAt: "2026-07-17T00:00:00Z",
  });
  assert.equal(result.orders[0].products.length, 0);
  assert.equal(result.orders[0].task.state, "blocked");
  assert.equal(result.orders[0].task.code, "ORDER_PRODUCT_EVIDENCE_MISSING");
  assert.match(result.missingEvidence.join(" "), /product_details:POST-NO-PRODUCTS/);
  assert.equal(result.sellerView.status, "partial");
});

test("FBS product details read all unique offers in batches of 100 and preserves successful batches", async () => {
  const offerIds = Array.from({ length: 205 }, (_, index) => `SKU-${index}`);
  const calls = [];
  const result = await readFbsProductDetailsInBatches(offerIds, async (batch) => {
    calls.push(batch);
    if (calls.length === 2) throw new Error("API key=secret second batch failed");
    return { items: batch.map((offerId) => ({ offer_id: offerId, id: Number(offerId.slice(4)) + 1, name: `Detail ${offerId}` })) };
  });
  assert.deepEqual(calls.map((batch) => batch.length), [100, 100, 5]);
  assert.equal(result.items.length, 105);
  assert.deepEqual(result.batchAttempts.map((attempt) => attempt.status), ["completed", "failed", "completed"]);
  assert.equal(result.partial, true);
  assert.doesNotMatch(JSON.stringify(result), /secret|second batch failed|api key/i);

  const model = buildFbsOrderReadModel({
    postingResponse: { result: { postings: offerIds.map((offerId) => ({ posting_number: `POST-${offerId}`, products: [{ offer_id: offerId, quantity: 1 }] })) } },
    productDetailResponse: { items: result.items },
    productDetailBatchAttempts: result.batchAttempts,
  });
  assert.equal(model.orders.length, 205);
  assert.equal(model.orders.filter((order) => order.products[0].detailStatus === "matched").length, 105);
  assert.equal(model.partial, true);
  assert.match(model.missingEvidence.join(" "), /product_detail_batch:2/);
});

test("partial detail batches preserve the original scope and expose a reread task", async () => {
  const result = await readFbsProductDetailsInBatches(["SKU-REREAD-1", "SKU-REREAD-2"], async (batch) => {
    throw new Error(`synthetic detail failure for ${batch.join(",")}`);
  });
  const model = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        has_next: true,
        postings: [{ posting_number: "POST-REREAD", status: "awaiting_packaging", products: [{ offer_id: "SKU-REREAD-1", quantity: 1 }] }],
      },
    },
    productDetailResponse: { items: result.items },
    productDetailFailed: true,
    productDetailBatchAttempts: result.batchAttempts,
    requestScope: { storeId: "store-1", since: "2026-07-16T00:00:00Z", to: "2026-07-17T00:00:00Z", status: "awaiting_packaging", warehouseId: 501, limit: 100, offset: 100 },
  });
  assert.deepEqual(model.requestScope, {
    since: "2026-07-16T00:00:00.000Z",
    to: "2026-07-17T00:00:00.000Z",
    status: "awaiting_packaging",
    warehouseId: 501,
    limit: 100,
    offset: 100,
  });
  assert.equal(model.partial, true);
  assert.equal(model.hasNext, true);
  assert.equal(model.sellerView.sellerTasks.some((task) => task.code === "FBS_READ_EVIDENCE_PARTIAL"), true);
  assert.equal(model.sellerView.sellerTasks.some((task) => task.code === "FBS_READ_PAGINATION_INCOMPLETE"), true);
  assert.match(model.sellerView.nextAction, /重新读取/);
});

test("conflicting product detail identities are not silently attached to an order", () => {
  const model = buildFbsOrderReadModel({
    postingResponse: { result: { postings: [{ posting_number: "POST-C", products: [{ offer_id: "SKU-C", quantity: 1 }] }] } },
    productDetailResponse: { items: [
      { offer_id: "SKU-C", id: 1, name: "First" },
      { offer_id: "SKU-C", id: 2, name: "Conflicting" },
    ] },
  });
  assert.equal(model.orders[0].products[0].detailStatus, "unknown");
  assert.match(model.missingEvidence.join(" "), /product_detail_ambiguous:SKU-C/);
  assert.equal(model.partial, true);
});

test("FBS detail does not cross-bind posting sku to an unrelated product id", () => {
  const model = buildFbsOrderReadModel({
    postingResponse: {
      result: {
        postings: [{ posting_number: "POST-ID-COLLISION", products: [{ sku: "101", quantity: 1 }] }],
      },
    },
    productDetailResponse: { items: [{ product_id: 101, name: "不同商品" }] },
  });
  assert.equal(model.orders[0].products[0].detailStatus, "unknown");
  assert.equal(model.orders[0].products[0].name, "");
  assert.match(model.missingEvidence.join(" "), /product_detail:101/);
});

test("FBS search refreshes seller recovery task to the visible orders", () => {
  const model = buildFbsOrderReadModel({
    postingResponse: { result: { postings: [
      { posting_number: "POST-OK", status: "delivered", products: [{ offer_id: "SKU-OK", quantity: 1 }] },
      { posting_number: "POST-UNKNOWN", status: "vendor_new_state", products: [{ offer_id: "SKU-U", quantity: 1 }] },
    ] } },
    productDetailResponse: { items: [
      { offer_id: "SKU-OK", name: "已送达" },
      { offer_id: "SKU-U", name: "待核对" },
    ] },
  });
  const filtered = filterFbsOrderReadModel(model, "POST-OK");
  assert.equal(filtered.orders.length, 1);
  assert.equal(filtered.sellerView.filtered, true);
  assert.equal(filtered.sellerView.sellerTasks.length, 0);
  assert.match(filtered.sellerView.nextAction, /没有待处理/);
});

test("FBS search with no matches does not claim the store queue is empty", () => {
  const model = buildFbsOrderReadModel({
    postingResponse: { result: { postings: [
      { posting_number: "POST-REAL", status: "awaiting_packaging", products: [{ offer_id: "SKU-REAL", quantity: 1 }] },
    ] } },
    productDetailResponse: { items: [{ offer_id: "SKU-REAL", name: "待备货" }] },
  });
  const filtered = filterFbsOrderReadModel(model, "not-present");
  assert.equal(filtered.orders.length, 0);
  assert.equal(filtered.sellerView.filteredNoResults, true);
  assert.match(filtered.sellerView.reason, /没有匹配订单/);
  assert.match(filtered.sellerView.nextAction, /清除或调整搜索条件/);
  assert.doesNotMatch(filtered.sellerView.nextAction, /没有待处理履约订单/);
});
