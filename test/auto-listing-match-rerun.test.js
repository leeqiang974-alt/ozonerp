import test from "node:test";
import assert from "node:assert/strict";
import { selectBestMatchForOzon } from "../src/autoListing.js";

test("selectBestMatchForOzon picks profitable same-family candidate without submitting", async () => {
  const ozonItem = {
    id: "oz_1",
    title: "Автокормушка для кошек и собак",
    category: "товары для животных",
    price: 2500,
  };
  const candidates = [
    {
      id: "bad_1",
      title: "金属钥匙扣 礼品",
      priceMin: 8,
      parsed: { sizeWeight: { weightG: 50, lengthMm: 80, widthMm: 40, heightMm: 20 } },
    },
    {
      id: "good_1",
      title: "宠物 自动喂食器 猫 狗 饮水碗",
      priceMin: 18,
      score: 90,
      parsed: {
        sizeWeight: { weightG: 220, lengthMm: 160, widthMm: 120, heightMm: 90 },
        images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
        skuVariants: [{ spec: "白色", price: 18 }],
      },
    },
  ];

  const result = await selectBestMatchForOzon(ozonItem, candidates, { aiLimit: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.bestMatch.candidate.id, "good_1");
  assert.equal(result.evaluatedCount, 2);
  assert.equal(result.rejected.length, 1);
  assert.ok(result.bestMatch.profit.margin >= 0);
});
