import test from "node:test";
import assert from "node:assert/strict";

import { calculateOzonPrice } from "../src/pricing.js";

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
