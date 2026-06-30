import test from "node:test";
import assert from "node:assert/strict";

import { parsePddProduct } from "../src/collectorPdd.js";

test("PDD parser normalizes extension payload into ERP capture product", () => {
  const parsed = parsePddProduct({
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=123456789",
    hints: {
      title: "猫咪自动饮水机 静音循环过滤",
      price: "19.80",
      images: [
        "https://img.pddpic.com/mms-material-img/2026-01-01/cat-water.jpg",
        "https://img.pddpic.com/mms-material-img/2026-01-01/cat-water.jpg?imageView2/2/w/300",
      ],
      attributes: [
        { name: "材质", value: "ABS" },
        { name: "容量", value: "2L" },
      ],
      skuVariants: [
        { skuId: "sku-red", spec: "颜色: 白色", price: "19.80", stock: "88" },
      ],
      packageInfo: {
        weightG: 320,
        lengthMm: 180,
        widthMm: 160,
        heightMm: 120,
      },
    },
  });

  assert.equal(parsed.source, "pdd");
  assert.equal(parsed.sourcePlatform, "拼多多");
  assert.equal(parsed.goodsId, "123456789");
  assert.equal(parsed.title, "猫咪自动饮水机 静音循环过滤");
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.skuVariants[0].price, 19.8);
  assert.equal(parsed.sizeWeight.weightG, 320);
  assert.equal(parsed.ozonDraft.offer_id, "pdd-sku-red");
});

test("PDD parser warns when page data needs manual completion", () => {
  const parsed = parsePddProduct({
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=987",
    html: "<html><title>拼多多</title></html>",
  });

  assert.equal(parsed.source, "pdd");
  assert.equal(parsed.goodsId, "987");
  assert.ok(parsed.warnings.includes("未解析到标题，请在已登录拼多多商品页用插件读取页面。"));
  assert.ok(parsed.warnings.includes("未解析到完整包装尺寸，上架前必须补齐尺重。"));
});
