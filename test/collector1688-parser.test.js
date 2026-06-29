import test from "node:test";
import assert from "node:assert/strict";
import { parse1688Product } from "../src/collector1688.js";

function pageWithJson(data) {
  return `<!doctype html><html><head><title>测试商品标题足够长</title></head><body><script>window.__DATA__ = ${JSON.stringify(data)};</script></body></html>`;
}

test("1688 parser preserves object skuMap keys as variant specs", () => {
  const parsed = parse1688Product({
    url: "https://detail.1688.com/offer/10001.html",
    html: pageWithJson({
      skuMap: {
        "颜色:白色;尺寸:S": {
          specId: "sku-white-s",
          discountPrice: "12.50",
          canBookCount: 7,
          imageUrl: "https://cbu01.alicdn.com/img/ibank/O1CN-white.jpg",
        },
      },
    }),
  });

  assert.equal(parsed.skuVariants.length, 1);
  assert.equal(parsed.skuVariants[0].skuId, "sku-white-s");
  assert.equal(parsed.skuVariants[0].spec, "颜色: 白色; 尺寸: S");
  assert.equal(parsed.skuVariants[0].price, 12.5);
  assert.equal(parsed.skuVariants[0].stock, 7);
});

test("1688 parser reads specList specItems as sku properties", () => {
  const parsed = parse1688Product({
    url: "https://detail.1688.com/offer/10002.html",
    html: pageWithJson({
      specList: [
        {
          specName: "颜色",
          specItems: [
            { specId: "white", specValue: "白色", imageUrl: "https://cbu01.alicdn.com/img/ibank/O1CN-white.jpg" },
            { specId: "blue", specValue: "蓝色", imageUrl: "https://cbu01.alicdn.com/img/ibank/O1CN-blue.jpg" },
          ],
        },
      ],
    }),
  });

  assert.deepEqual(parsed.skuProps[0], {
    name: "颜色",
    values: [
      { name: "白色", image: "https://cbu01.alicdn.com/img/ibank/O1CN-white.jpg" },
      { name: "蓝色", image: "https://cbu01.alicdn.com/img/ibank/O1CN-blue.jpg" },
    ],
  });
  assert.deepEqual(parsed.skuVariants.map((item) => item.spec), ["颜色: 白色", "颜色: 蓝色"]);
});

test("1688 parser creates color variants from Chinese separated attribute values", () => {
  const parsed = parse1688Product({
    url: "https://detail.1688.com/offer/10003.html",
    html: pageWithJson({ productTitle: "测试商品标题足够长" }),
    hints: {
      attributes: [{ name: "颜色", value: "白色；黄色/蓝色" }],
      images: [
        "https://cbu01.alicdn.com/img/ibank/O1CN-white.jpg",
        "https://cbu01.alicdn.com/img/ibank/O1CN-yellow.jpg",
        "https://cbu01.alicdn.com/img/ibank/O1CN-blue.jpg",
      ],
    },
  });

  assert.deepEqual(parsed.skuVariants.map((item) => item.spec), ["颜色: 白色", "颜色: 黄色", "颜色: 蓝色"]);
});
