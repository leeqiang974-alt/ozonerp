import test from "node:test";
import assert from "node:assert/strict";
import { buildActivityReadSellerResult, buildPromotionImpactPreview } from "../src/activityReadModel.js";

test("promotion impact preview is conservative when activity prices are missing", () => {
  const result = buildPromotionImpactPreview([
    { product_id: 1, price: "100", action_price: "80" },
    { product_id: 2, price: "100" },
  ]);
  assert.equal(result.productCount, 2);
  assert.equal(result.knownPriceCount, 1);
  assert.equal(result.unknownPriceCount, 1);
  assert.equal(result.averageReductionPercent, 20);
  assert.match(result.profitConclusion, /unknown/);
  assert.equal(result.products[1].impact, "unknown");
});

test("promotion impact preview never treats missing rows as profit evidence", () => {
  const result = buildPromotionImpactPreview([]);
  assert.equal(result.productCount, 0);
  assert.equal(result.averageReductionPercent, null);
  assert.equal(result.profitConclusion, "unknown_without_cost_commission_and_settlement_rules");
  assert.equal(result.readOnly, true);
});

test("promotion impact preview keeps a zero action price unknown", () => {
  const result = buildPromotionImpactPreview([{ product_id: 1, current_price: 100, action_price: 0 }]);
  assert.equal(result.knownPriceCount, 0);
  assert.equal(result.products[0].impact, "unknown");
  assert.equal(result.averageReductionPercent, null);
});

test("promotion impact preview does not treat Ozon old_price as the current price", () => {
  const result = buildPromotionImpactPreview([{ product_id: 1, old_price: "120", action_price: "80" }]);
  assert.equal(result.knownPriceCount, 0);
  assert.equal(result.unknownPriceCount, 1);
  assert.equal(result.averageReductionPercent, null);
  assert.equal(result.products[0].impact, "unknown");
});

test("promotion impact preview does not treat action price bounds as an observed price", () => {
  const result = buildPromotionImpactPreview([{
    product_id: 1,
    current_price: "100",
    min_action_price: "70",
    max_action_price: "80",
  }]);
  assert.equal(result.knownPriceCount, 0);
  assert.equal(result.unknownPriceCount, 1);
  assert.equal(result.products[0].impact, "unknown");
});

test("activity seller result keeps an incomplete page partial", () => {
  const result = buildActivityReadSellerResult({ products: [{ product_id: 1 }], total: 3 }, { kind: "activity_products", offset: 0, limit: 1 });
  assert.equal(result.status, "partial");
  assert.equal(result.coverageComplete, false);
  assert.equal(result.nextOffset, 1);
  assert.equal(result.limit, 1);
  assert.equal(result.coverageText, "已读取 1 / 3 条");
  assert.match(result.nextAction, /下一页/);
  assert.match(result.sideEffect, /不加入/);
});

test("activity seller result exposes a bounded coverage summary when total is unknown", () => {
  const result = buildActivityReadSellerResult({ items: [{ id: 1 }, { id: 2 }] }, { offset: 4, limit: 2 });
  assert.equal(result.status, "unknown");
  assert.equal(result.nextOffset, null);
  assert.equal(result.coverageText, "已读取 6 条，服务端总量未知");
  assert.match(result.nextAction, /分页|总数/);
});

test("activity seller result does not call an empty response full-store evidence without coverage metadata", () => {
  const result = buildActivityReadSellerResult({ products: [] }, { kind: "activity_products" });
  assert.equal(result.status, "unknown");
  assert.equal(result.coverageComplete, false);
  assert.match(result.nextAction, /分页|总数/);
});

test("activity seller result rejects contradictory end marker when total still has rows", () => {
  const result = buildActivityReadSellerResult(
    { products: [{ product_id: 1 }], total: 3, has_next: false },
    { kind: "activity_products", offset: 0, limit: 1 },
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.coverageComplete, false);
  assert.equal(result.paginationSignalInvalid, true);
  assert.equal(result.nextOffset, null);
  assert.match(result.nextAction, /矛盾|重新读取/);
});

test("activity seller result rejects next-page marker after total is already covered", () => {
  const result = buildActivityReadSellerResult(
    { products: [{ product_id: 1 }, { product_id: 2 }], total: 2, has_next: true },
    { kind: "activity_products", offset: 0, limit: 2 },
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.coverageComplete, false);
  assert.equal(result.paginationSignalInvalid, true);
  assert.match(result.nextAction, /矛盾/);
});

test("activity seller result rejects an offset beyond the reported total", () => {
  const result = buildActivityReadSellerResult(
    { products: [], total: 3, has_next: false },
    { kind: "activity_products", offset: 10, limit: 2 },
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.coverageComplete, false);
  assert.equal(result.paginationSignalInvalid, true);
  assert.equal(result.nextOffset, null);
  assert.match(result.nextAction, /范围|总数/);
});

test("activity seller result rejects rows that overrun the reported total", () => {
  const result = buildActivityReadSellerResult(
    { products: [{ product_id: 1 }, { product_id: 2 }], total: 1, has_next: false },
    { kind: "activity_products", offset: 0, limit: 2 },
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.coverageComplete, false);
  assert.equal(result.paginationSignalInvalid, true);
  assert.match(result.nextAction, /范围|总数/);
});
