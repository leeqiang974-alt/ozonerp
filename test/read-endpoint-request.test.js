import test from "node:test";
import assert from "node:assert/strict";
import { buildReadEndpointRequest, extractBoundedProductIdentifiers, orderReadEndpoints } from "../src/readEndpointRequest.js";

const endpoints = [
  "/v3/product/list",
  "/v3/product/info/list",
  "/v1/product/import/info",
  "/v4/product/info/stocks",
  "/v2/warehouse/list",
  "/v3/posting/fbs/list",
  "/v3/posting/fbs/unfulfilled/list",
  "/v4/posting/fbs/list",
  "/v4/posting/fbs/unfulfilled/list",
  "/v1/description-category/tree",
  "/v1/description-category/attribute",
  "/v1/description-category/attribute/values",
];

test("endpoint request contracts never copy credentials and fail closed when dependencies are missing", () => {
  for (const endpoint of endpoints) {
    const result = buildReadEndpointRequest(endpoint, { apiKey: "secret", clientId: "client-secret" });
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.ok(result.ok === true || result.reasonCode, endpoint);
  }
  assert.equal(buildReadEndpointRequest("/v3/product/info/list").reasonCode, "READ_ENDPOINT_SCOPE_REQUIRES_IDENTIFIERS");
  assert.equal(buildReadEndpointRequest("/v4/product/info/stocks").reasonCode, "READ_ENDPOINT_SCOPE_REQUIRES_IDENTIFIERS");
  assert.equal(buildReadEndpointRequest("/v3/posting/fbs/list").reasonCode, "READ_ENDPOINT_SCOPE_REQUIRES_DATE_RANGE");
  assert.equal(buildReadEndpointRequest("/v1/description-category/attribute").reasonCode, "READ_ENDPOINT_SCOPE_REQUIRES_CATEGORY");
  assert.equal(buildReadEndpointRequest("/v1/product/import/info").reasonCode, "READ_ENDPOINT_SCOPE_REQUIRES_TASK_ID");
});

test("endpoint request contracts match existing read model payload shapes", () => {
  assert.deepEqual(buildReadEndpointRequest("/v3/product/list", { offerCount: 7 }).body, { filter: { visibility: "ALL" }, limit: 7, last_id: "" });
  assert.deepEqual(buildReadEndpointRequest("/v3/product/list", { offerIds: ["SKU-1"] }).body, { filter: { offer_id: ["SKU-1"] } });
  assert.deepEqual(buildReadEndpointRequest("/v3/product/list", { productIds: ["11"] }).body, { filter: { product_id: ["11"] } });
  assert.equal(buildReadEndpointRequest("/v3/product/list", { offerIds: ["SKU-1"], productIds: ["11"] }).reasonCode, "READ_ENDPOINT_SCOPE_REQUIRES_SINGLE_IDENTIFIER_SET");
  assert.equal(buildReadEndpointRequest("/v3/product/list", { limit: 5000 }).body.limit, 1000);
  assert.deepEqual(buildReadEndpointRequest("/v3/product/info/list", { offerIds: ["SKU-1"] }).body, { offer_id: ["SKU-1"] });
  assert.deepEqual(buildReadEndpointRequest("/v1/product/import/info", { taskId: 172549793 }).body, { task_id: 172549793 });
  assert.deepEqual(buildReadEndpointRequest("/v4/product/info/stocks", { offerIds: ["SKU-1"] }).body, { filter: { offer_id: ["SKU-1"], visibility: "ALL" }, limit: 100, cursor: "" });
  assert.deepEqual(buildReadEndpointRequest("/v4/product/info/stocks", { productIds: ["11"], limit: 5000, cursor: "next" }).body, { filter: { product_id: ["11"], visibility: "ALL" }, limit: 1000, cursor: "next" });
  assert.deepEqual(buildReadEndpointRequest("/v2/warehouse/list").body, { cursor: "", limit: 200 });
  assert.deepEqual(buildReadEndpointRequest("/v2/warehouse/list", { cursor: "next", warehouseIds: [502] }).body, { cursor: "next", limit: 200, warehouse_ids: [502] });
  assert.deepEqual(buildReadEndpointRequest("/v3/posting/fbs/list", { since: "2026-07-19T00:00:00Z", to: "2026-07-20T00:00:00Z" }).body, { dir: "ASC", filter: { since: "2026-07-19T00:00:00Z", to: "2026-07-20T00:00:00Z" }, limit: 100, offset: 0 });
  assert.equal(buildReadEndpointRequest("/v3/posting/fbs/list", { since: "2026-07-19T00:00:00Z", to: "2026-07-20T00:00:00Z" }).deprecated, true);
  assert.deepEqual(buildReadEndpointRequest("/v4/posting/fbs/list", { since: "2026-07-19T00:00:00Z", to: "2026-07-20T00:00:00Z", cursor: "next", sortDir: "DESC" }).body, { cursor: "next", sort_dir: "DESC", filter: { since: "2026-07-19T00:00:00Z", to: "2026-07-20T00:00:00Z" }, limit: 100 });
  assert.equal(buildReadEndpointRequest("/v4/posting/fbs/list", { since: "2026-07-19T00:00:00Z", to: "2026-07-20T00:00:00Z" }).deprecated, undefined);
  assert.equal(buildReadEndpointRequest("/v4/posting/fbs/unfulfilled/list").reasonCode, "READ_ENDPOINT_SCOPE_REQUIRES_CUTOFF_OR_DELIVERING_DATE");
  assert.deepEqual(buildReadEndpointRequest("/v4/posting/fbs/unfulfilled/list", { deliveringDateFrom: "2026-07-19", deliveringDateTo: "2026-07-20" }).body, { cursor: "", sort_dir: "ASC", filter: { delivering_date_from: "2026-07-19", delivering_date_to: "2026-07-20" }, limit: 100 });
});

test("product list identifiers are bounded before fan-out to detail or stock reads", () => {
  const response = { result: { items: [{ offer_id: "SKU-1", product_id: 11 }, { offerId: "SKU-2", productId: 12 }] } };
  const identifiers = extractBoundedProductIdentifiers(response);
  assert.deepEqual(identifiers, { offerIds: ["SKU-1", "SKU-2"], productIds: ["11", "12"] });
  assert.equal(extractBoundedProductIdentifiers({ items: [] }).offerIds.length, 0);
});

test("execution order restores prerequisite-first reads after plan hash sorting", () => {
  assert.deepEqual(orderReadEndpoints([
    "/v4/product/info/stocks",
    "/v3/product/info/list",
    "/v3/product/list",
  ]), ["/v3/product/list", "/v3/product/info/list", "/v4/product/info/stocks"]);
});
