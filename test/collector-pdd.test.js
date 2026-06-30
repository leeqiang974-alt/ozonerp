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

test("PDD parser filters page chrome from variants and product images", () => {
  const parsed = parsePddProduct({
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=546151830201",
    hints: {
      title: "防黄大仙超强烟灰缸",
      price: "6.81",
      images: [
        "https://img.pddpic.com/mms-material-img/2023-10-31/product-a.jpeg",
        "https://img.pddpic.com/a/coupon/d8c60a2e-d3dd-48e8-9fe5-1125742075b1.png.slim.png",
        "https://promotion.pddpic.com/oms-img-promotion/2026-05-19/activity.png",
        "https://funimg.pddpic.com/brand/logo.png.slim.png",
      ],
      skuVariants: [
        { spec: "大促价¥ 6.81", price: "6.81" },
        { spec: "7.8折¥ 10.8", price: "10.8" },
        { spec: "小黄 买了又买 拼单即将结束 23:23:59.7 立刻拼", price: "6.81" },
        { spec: "质量很好(257)", price: "6.81" },
        { spec: "模具很好(218)", price: "10.8" },
        { spec: "大小合适(196)", price: "10.8" },
        { spec: "退货包运费 | 不满意包退货运费，退换货运费无忧", price: "6.81" },
        { spec: "这些人已拼，参与可立即拼成", price: "6.81" },
        { spec: "物美价廉(378)", price: "6.81" },
        { spec: "尺寸", price: "10.8" },
        { spec: "圆形烟灰缸", price: "6.81" },
        { spec: "正方形烟灰缸", price: "6.81" },
        { spec: "开始采集", price: "6.81" },
        { spec: "找货源", price: "6.81" },
        { spec: "采集到 ERP", price: "6.81" },
        { spec: "跳过", price: "6.81" },
        { spec: "确定", price: "6.81" },
      ],
    },
  });

  assert.deepEqual(parsed.images, ["https://img.pddpic.com/mms-material-img/2023-10-31/product-a.jpeg"]);
  assert.deepEqual(parsed.skuVariants.map((item) => item.spec), ["圆形烟灰缸", "正方形烟灰缸"]);
});
