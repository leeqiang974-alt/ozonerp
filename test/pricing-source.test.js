import test from "node:test";
import assert from "node:assert/strict";

import { calculateOzonPrice, derivePricingPolicyFields } from "../src/pricing.js";

test("calculateOzonPrice carries commission source metadata", () => {
  const result = calculateOzonPrice({
    purchaseCost: 25,
    weightG: 650,
    lengthMm: 220,
    widthMm: 160,
    heightMm: 80,
    commissionRate: 0.18,
    commissionSource: {
      source: "learned_product",
      label: "同类已上架商品学习",
      confidence: "medium",
      categoryKey: "17028673:95183",
    },
  });

  assert.equal(result.commissionRate, 0.18);
  assert.deepEqual(result.commissionSource, {
    source: "learned_product",
    label: "同类已上架商品学习",
    confidence: "medium",
    categoryKey: "17028673:95183",
  });
});

test("derivePricingPolicyFields explains min price floor and old price strategy", () => {
  const fields = derivePricingPolicyFields({
    priceCny: 120,
    baseCost: 80,
    policy: {
      minimumProfitRate: 0.12,
      minimumProfitCny: 8,
      oldPriceMode: "promo_multiplier",
      oldPriceMultiplier: 1.6,
    },
  });

  assert.equal(fields.minPriceCny, "91");
  assert.equal(fields.minPriceSource.mode, "minimum_profit_floor");
  assert.equal(fields.minPriceSource.minimumProfitRate, 0.12);
  assert.equal(fields.oldPriceCny, 192);
  assert.equal(fields.oldPriceSource.mode, "promo_multiplier");
  assert.equal(fields.blocked, false);
});

test("derivePricingPolicyFields blocks when minimum price is not below sale price", () => {
  const fields = derivePricingPolicyFields({
    priceCny: 90,
    baseCost: 88,
    policy: {
      minimumProfitRate: 0.08,
      minimumProfitCny: 3,
      oldPriceMode: "promo_multiplier",
      oldPriceMultiplier: 1.6,
    },
  });

  assert.equal(fields.blocked, true);
  assert.equal(fields.reasonCode, "PRICING_MIN_PRICE_INVALID");
  assert.ok(Number(fields.minPriceCny) >= 90);
});
