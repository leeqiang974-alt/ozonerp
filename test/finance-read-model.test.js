import test from "node:test";
import assert from "node:assert/strict";
import { buildFinanceDomainReadModel } from "../src/financeReadModel.js";

test("finance model keeps incomplete order cache unknown and separates activity impact", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: true, hasNext: true },
    orders: [{ products: [{ price: 100 }] }],
    activityImpact: { knownPriceCount: 1, unknownPriceCount: 1 },
  });
  assert.equal(result.order.state, "partial");
  assert.equal(result.order.revenue, null);
  assert.equal(result.profit.value, null);
  assert.equal(result.activity.state, "impact_only");
  assert.ok(result.sellerResult.blockerCodes.includes("ORDER_READ_INCOMPLETE"));
  assert.ok(result.sellerResult.blockerCodes.includes("ACTIVITY_PRICE_IMPACT_NOT_PROFIT"));
  assert.match(result.sellerResult.nextAction, /全部分页/);
});

test("finance model keeps local fixture evidence separate from a complete server order read", () => {
  const local = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [{ price: 10, quantity: 1 }] }],
  });
  assert.equal(local.verificationLevel, "locally_tested");
  assert.equal(local.liveReadObserved, false);

  const server = buildFinanceDomainReadModel({
    observationMode: "server_read",
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [{ price: 10, quantity: 1 }] }],
  });
  assert.equal(server.verificationLevel, "server_observed");
  assert.equal(server.liveReadObserved, true);
});

test("finance model marks a server-observed partial order range as partial, not complete", () => {
  const result = buildFinanceDomainReadModel({
    observationMode: "server_read",
    orderBatch: { loaded: true, partial: true, hasNext: true },
    orders: [{ products: [{ price: 10, quantity: 1 }] }],
  });
  assert.equal(result.verificationLevel, "partial");
  assert.equal(result.liveReadObserved, false);
  assert.equal(result.order.revenue, null);
});

test("finance model keeps revenue unknown when the order read lacks pagination-end evidence", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false, paginationComplete: false },
    orders: [{ products: [{ price: 100, quantity: 1 }] }],
  });
  assert.equal(result.order.state, "unknown");
  assert.equal(result.order.revenue, null);
  assert.ok(result.sellerResult.blockerCodes.includes("ORDER_PAGINATION_EVIDENCE_MISSING"));
  assert.match(result.sellerResult.nextAction, /分页/);
});

test("finance model keeps stale or invalid order evidence out of current sales", () => {
  const stale = buildFinanceDomainReadModel({
    now: Date.parse("2026-07-14T10:00:00.000Z"),
    orderBatch: { loaded: true, partial: false, hasNext: false, checkedAt: "2026-07-14T08:00:00.000Z" },
    orders: [{ products: [{ price: 100, quantity: 1 }] }],
  });
  assert.equal(stale.order.state, "unknown");
  assert.equal(stale.order.freshness, "stale");
  assert.equal(stale.order.revenue, null);
  assert.ok(stale.sellerResult.blockerCodes.includes("ORDER_READ_STALE"));
  assert.match(stale.sellerResult.nextAction, /新鲜|重新读取/);

  const invalid = buildFinanceDomainReadModel({
    now: Date.parse("2026-07-14T10:00:00.000Z"),
    orderBatch: { loaded: true, partial: false, hasNext: false, checkedAt: "not-a-date" },
    orders: [{ products: [{ price: 100, quantity: 1 }] }],
  });
  assert.equal(invalid.order.state, "unknown");
  assert.equal(invalid.order.freshness, "invalid");
  assert.ok(invalid.sellerResult.blockerCodes.includes("ORDER_READ_TIMESTAMP_INVALID"));
});

test("finance model only exposes revenue after a complete order batch", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [{ price: "100", quantity: 1 }, { offer_price: "20", quantity: 1 }] }],
  });
  assert.equal(result.order.state, "complete");
  assert.equal(result.order.revenue, 120);
  assert.equal(result.costs.state, "unknown");
  assert.equal(result.profit.state, "unknown");
  assert.equal(result.profit.value, null);
  assert.equal(result.evidenceSummary.find((entry) => entry.key === "revenue").value, 120);
  assert.match(result.sellerResult.nextAction, /采购成本/);
});

test("finance model excludes cancelled and disputed postings from unverified revenue", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [
      { statusGroup: "delivered", products: [{ price: 100, quantity: 1 }] },
      { statusGroup: "cancelled", products: [{ price: 50, quantity: 1 }] },
      { statusGroup: "dispute", products: [{ price: 30, quantity: 1 }] },
    ],
  });
  assert.equal(result.order.revenue, null);
  assert.equal(result.order.knownRevenueLines, 1);
  assert.equal(result.order.excludedRevenueOrders, 2);
  assert.equal(result.order.revenueCoverage.complete, false);
  assert.ok(result.sellerResult.blockerCodes.includes("ORDER_REVENUE_STATUS_UNRESOLVED"));
  const revenue = result.evidenceSummary.find((entry) => entry.key === "revenue");
  assert.equal(revenue.status, "unknown");
  assert.match(revenue.reason, /取消或争议/);
  assert.match(revenue.nextAction, /结算|退款/);
});

test("finance model excludes US-spelled cancellation and disputed statuses", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, failed: false, partial: false, hasNext: false, paginationComplete: true, checkedAt: "2026-07-20T01:00:00Z" },
    now: Date.parse("2026-07-20T01:30:00Z"),
    orders: [
      { status: "canceled", products: [{ price: 50, quantity: 1 }] },
      { status: "disputed", products: [{ price: 30, quantity: 1 }] },
      { status: "delivered", products: [{ price: 20, quantity: 1 }] },
    ],
  });
  assert.equal(result.order.revenue, null);
  assert.equal(result.order.revenueCoverage.excludedOrderCount, 2);
  assert.ok(result.sellerResult.blockerCodes.includes("ORDER_REVENUE_STATUS_UNRESOLVED"));
});

test("finance model does not let an unknown statusGroup mask a raw cancellation", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, failed: false, partial: false, hasNext: false, paginationComplete: true, checkedAt: "2026-07-20T01:00:00Z" },
    now: Date.parse("2026-07-20T01:30:00Z"),
    orders: [{ statusGroup: "unknown", status: "canceled", products: [{ price: 99, quantity: 1 }] }],
  });
  assert.equal(result.order.revenue, null);
  assert.equal(result.order.revenueCoverage.excludedOrderCount, 1);
});

test("finance model excludes qualified cancellation and dispute statuses", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, failed: false, partial: false, hasNext: false, paginationComplete: true, checkedAt: "2026-07-20T01:00:00Z" },
    now: Date.parse("2026-07-20T01:30:00Z"),
    orders: [
      { status: "cancelled_by_customer", products: [{ price: 50, quantity: 1 }] },
      { status: "dispute_pending", products: [{ price: 30, quantity: 1 }] },
      { status: "delivered", products: [{ price: 20, quantity: 1 }] },
    ],
  });
  assert.equal(result.order.revenue, null);
  assert.equal(result.order.revenueCoverage.excludedOrderCount, 2);
  assert.ok(result.sellerResult.blockerCodes.includes("ORDER_REVENUE_STATUS_UNRESOLVED"));
});

test("finance revenue evidence never exposes a value when a line quantity is missing", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [{ price: 100 }] }],
  });
  const revenue = result.evidenceSummary.find((entry) => entry.key === "revenue");
  assert.equal(result.order.revenue, null);
  assert.equal(revenue.status, "unknown");
  assert.equal(revenue.value, null);
  assert.match(revenue.nextAction, /订单行金额|财务明细/);
});

test("finance revenue prefers an explicit line total and otherwise respects quantity", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [
      { price: 10, quantity: 3 },
      { price: 100, quantity: 9, total_price: 25 },
    ] }],
  });
  assert.equal(result.order.revenue, 55);
  assert.equal(result.order.knownRevenueLines, 2);
});

test("finance model does not treat a complete order page with unknown line amounts as full-store revenue", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [{ total_price: 100 }, { offer_id: "SKU-UNKNOWN" }] }],
  });
  assert.equal(result.order.state, "complete");
  assert.equal(result.order.revenue, null);
  assert.equal(result.order.knownRevenueLines, 1);
  assert.equal(result.order.unknownRevenueLines, 1);
  assert.ok(result.sellerResult.blockerCodes.includes("ORDER_REVENUE_FIELDS_UNKNOWN"));
  const revenue = result.evidenceSummary.find((entry) => entry.key === "revenue");
  assert.equal(revenue.status, "unknown");
  assert.match(revenue.nextAction, /订单行金额|财务明细/);
});

test("finance model does not treat a unit price without quantity as a one-item line", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [{ price: 100 }, { offer_price: 20, quantity: 2 }] }],
  });
  assert.equal(result.order.revenue, null);
  assert.equal(result.order.knownRevenueLines, 1);
  assert.equal(result.order.unknownRevenueLines, 1);
  assert.ok(result.sellerResult.blockerCodes.includes("ORDER_REVENUE_FIELDS_UNKNOWN"));
});

test("finance model never infers settlement evidence from pricing rows", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [{ price: 99, quantity: 1 }] }],
    costEvidence: { source: "pricing_snapshot", procurementCost: 1 },
  });
  assert.equal(result.costs.state, "unknown");
  assert.ok(result.costs.missing.includes("佣金"));
  assert.equal(result.profit.reasonCode, "FINANCE_SETTLEMENT_NOT_VERIFIED");
});

test("finance seller evidence summary distinguishes estimate, unknown and blocked pricing", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    orders: [{ products: [{ price: 99, quantity: 1 }] }],
    activityImpact: { knownPriceCount: 1 },
    pricingDiagnosis: { profitStatus: "estimate", pricingBlocked: false },
  });
  const byKey = Object.fromEntries(result.evidenceSummary.map((entry) => [entry.key, entry]));
  assert.equal(byKey.revenue.status, "observed");
  assert.equal(byKey.activityImpact.status, "estimate");
  assert.equal(byKey.costSettlement.status, "unknown");
  assert.equal(byKey.profit.status, "unknown");
  assert.equal(byKey.listingPricing.status, "estimate");
  assert.match(byKey.activityImpact.reason, /不代表利润/);

  const blocked = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    pricingDiagnosis: {
      profitStatus: "estimate",
      pricingBlocked: true,
      pricingBlockedReasonCode: "PRICING_MIN_PRICE_INVALID",
    },
  });
  const blockedPricing = blocked.evidenceSummary.find((entry) => entry.key === "listingPricing");
  assert.equal(blockedPricing.status, "blocked");
  assert.equal(blockedPricing.code, "PRICING_MIN_PRICE_INVALID");
  assert.equal(blocked.sellerResult.state, "blocked");
  assert.ok(blocked.sellerResult.blockerCodes.includes("PRICING_MIN_PRICE_INVALID"));
  assert.match(blockedPricing.nextAction, /重新预检/);
});

test("finance model does not call an all-unknown activity read an impact estimate", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    activityImpact: { knownPriceCount: 0, unknownPriceCount: 3 },
  });
  const activity = result.evidenceSummary.find((entry) => entry.key === "activityImpact");
  assert.equal(result.activity.state, "not_available");
  assert.equal(activity.status, "unknown");
  assert.equal(activity.code, "ACTIVITY_IMPACT_NOT_AVAILABLE");
  assert.equal(result.sellerResult.blockerCodes.includes("ACTIVITY_PRICE_IMPACT_NOT_PROFIT"), false);
  assert.match(activity.reason, /没有活动价格影响证据/);
});

test("finance model does not turn known prices from a partial activity page into an estimate", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    activityImpact: { knownPriceCount: 2, unknownPriceCount: 1, coverageComplete: false, status: "partial" },
  });
  const activity = result.evidenceSummary.find((entry) => entry.key === "activityImpact");
  assert.equal(result.activity.state, "not_available");
  assert.equal(result.activity.knownPriceCount, 0);
  assert.equal(activity.status, "unknown");
  assert.equal(activity.code, "ACTIVITY_IMPACT_NOT_AVAILABLE");
  assert.ok(result.sellerResult.blockerCodes.includes("ACTIVITY_SCOPE_INCOMPLETE"));
  assert.match(activity.reason, /没有活动价格影响证据/);
});

test("finance seller result surfaces a blocked pricing repair before generic cost advice", () => {
  const result = buildFinanceDomainReadModel({
    orderBatch: { loaded: true, partial: false, hasNext: false },
    pricingDiagnosis: {
      profitStatus: "estimate",
      pricingBlocked: true,
      pricingBlockedReasonCode: "PRICING_MIN_PRICE_INVALID",
    },
  });
  assert.equal(result.sellerResult.state, "blocked");
  assert.ok(result.sellerResult.blockerCodes.includes("PRICING_MIN_PRICE_INVALID"));
  assert.match(result.sellerResult.nextAction, /重新预检/);
  assert.doesNotMatch(result.sellerResult.nextAction, /补齐采购成本/);
});
