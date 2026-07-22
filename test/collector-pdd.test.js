import test from "node:test";
import assert from "node:assert/strict";

import { parsePddProduct } from "../src/collectorPdd.js";

test("PDD parser normalizes extension payload into ERP capture product", () => {
  const parsed = parsePddProduct({
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=123456789",
    hints: {
      taskId: "pdd-task-123",
      collectedAt: "2026-07-16T10:20:30+08:00",
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
  assert.deepEqual(parsed.capture, {
    taskId: "pdd-task-123",
    offerId: "123456789",
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=123456789",
    collectedAt: "2026-07-16T02:20:30.000Z",
    captureMode: "pdd_parser",
  });
  assert.equal(parsed.sourceEvidence.verificationState, "unknown");
  assert.equal(parsed.sourceEvidence.sellerFacing.status, "unknown");
  assert.deepEqual(parsed.sourceEvidence.sellerFacing.sideEffects, ["不会提交 Ozon", "不会修改价格", "不会写入库存"]);
  assert.ok(Array.isArray(parsed.parseIssues));
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
        { spec: "¥ 5.98", price: "" },
        { spec: "3225人已拼， 参与可立即拼成", price: "" },
        { spec: "金色家居钟饰/闹钟畅销榜第9名", price: "" },
        { spec: "小黄 买了又买 拼单即将结束 23:23:59.7 立刻拼", price: "6.81" },
        { spec: "质量很好(257)", price: "6.81" },
        { spec: "尺码合适(748)", price: "" },
        { spec: "美观(548)", price: "" },
        { spec: "走的挺准(362)", price: "" },
        { spec: "使用方便(341)", price: "" },
        { spec: "模具很好(218)", price: "10.8" },
        { spec: "大小合适(196)", price: "10.8" },
        { spec: "退货包运费 | 不满意包退货运费，退换货运费无忧", price: "6.81" },
        { spec: "这些人已拼，参与可立即拼成", price: "6.81" },
        { spec: "物美价廉(378)", price: "6.81" },
        { spec: "尺寸", price: "10.8" },
        { spec: "容量", price: "" },
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
  assert.equal(parsed.skuVariants[0].price, 6.81);
});

test("PDD parser reads title and gallery from embedded page data", () => {
  const parsed = parsePddProduct({
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=525147304298",
    html: `<html><head><script>
      window.__INITIAL_STATE__ = {
        goods: {
          goodsName: "圆形摆台硅胶模具 环氧树脂水晶滴胶手工材料",
          goodsGallery: [
            "https:\\/\\/img.pddpic.com\\/mms-material-img\\/2023-09-13\\/main-a.jpeg",
            "https:\\/\\/img-1.pddpic.com\\/garner-api-new\\/review-noise.jpeg"
          ],
          price: "10.8"
        }
      };
    </script></head><body></body></html>`,
  });

  assert.equal(parsed.title, "圆形摆台硅胶模具 环氧树脂水晶滴胶手工材料");
  assert.deepEqual(parsed.images, ["https://img.pddpic.com/mms-material-img/2023-09-13/main-a.jpeg"]);
  assert.equal(parsed.skuVariants[0].price, 10.8);
});

test("PDD parser separates main, SKU, and detail images from embedded data", () => {
  const parsed = parsePddProduct({
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=455510888249",
    html: `<script>
      window.rawData = {
        goodsName: "静音挂钟机芯 DIY 配件",
        goodsGallery: [
          "https:\\/\\/img.pddpic.com\\/mms-material-img\\/2023-03-13\\/main-1.jpeg",
          "https:\\/\\/img.pddpic.com\\/mms-material-img\\/2023-03-13\\/main-2.jpeg"
        ],
        sku: [
          { skuId: "gold", spec: "6168S机芯-金色-普通款", price: "5.98", thumbUrl: "https:\\/\\/img.pddpic.com\\/mms-material-img\\/2023-03-13\\/sku-gold.jpeg" },
          { skuId: "white", spec: "6168S机芯-白色-普通款", price: "6.98", thumbUrl: "https:\\/\\/img.pddpic.com\\/mms-material-img\\/2023-03-13\\/sku-white.jpeg" }
        ],
        detailGallery: [
          "https:\\/\\/img.pddpic.com\\/mms-material-img\\/2023-03-13\\/detail-size.jpeg",
          "https:\\/\\/promotion.pddpic.com\\/activity-noise.png"
        ]
      };
    </script>`,
  });

  assert.deepEqual(parsed.images, [
    "https://img.pddpic.com/mms-material-img/2023-03-13/main-1.jpeg",
    "https://img.pddpic.com/mms-material-img/2023-03-13/main-2.jpeg",
  ]);
  assert.deepEqual(parsed.skuVariants.map((item) => [item.skuId, item.spec, item.image]), [
    ["gold", "6168S机芯-金色-普通款", "https://img.pddpic.com/mms-material-img/2023-03-13/sku-gold.jpeg"],
    ["white", "6168S机芯-白色-普通款", "https://img.pddpic.com/mms-material-img/2023-03-13/sku-white.jpeg"],
  ]);
  assert.deepEqual(parsed.detailImages, ["https://img.pddpic.com/mms-material-img/2023-03-13/detail-size.jpeg"]);
});

test("PDD parser rejects internal numeric SKU ids as variant specs and prices", () => {
  const parsed = parsePddProduct({
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=716982623030",
    hints: {
      price: 12.8,
      images: ["https://img.pddpic.com/mms-material-img/2025-03-14/main.jpeg"],
      skuVariants: [
        {
          skuId: "1707622811696",
          spec: "3502499735,500326",
          price: 3502499735,
          image: "https://img.pddpic.com/mms-material-img/2025-03-14/sku.jpeg",
        },
      ],
    },
  });

  assert.deepEqual(parsed.skuVariants, [{
    skuId: "",
    spec: "默认规格",
    price: 12.8,
    stock: "",
    image: "https://img.pddpic.com/mms-material-img/2025-03-14/main.jpeg",
    weightG: "",
    lengthMm: "",
    widthMm: "",
    heightMm: "",
  }]);
});

test("PDD parser keeps real specs and rejects review or promo chips", () => {
  const parsed = parsePddProduct({
    url: "https://mobile.yangkeduo.com/goods.html?goods_id=732672546761",
    hints: {
      price: 20,
      images: [
        "https://img.pddpic.com/mms-material-img/2025-04-14/main.jpeg",
        "https://img.pddpic.com/mms-material-img/2025-04-14/silver.jpeg",
      ],
      skuVariants: [
        { spec: "满20返2", price: 20 },
        { spec: "物流很快(94)", price: 20 },
        { spec: "材质耐用(86)", price: 20 },
        { spec: "属性", price: 20 },
        { spec: "默认配22毫米螺丝", price: 20 },
        { spec: "即将恢复14元", price: "" },
        { spec: "8620-6.4厘米孔距（古银）", price: 20 },
        { spec: "8620-6.4厘米孔距（仿金）即将售罄", price: 20 },
      ],
    },
  });

  assert.deepEqual(parsed.skuVariants.map((item) => item.spec), [
    "8620-6.4厘米孔距（古银）",
    "8620-6.4厘米孔距（仿金）",
  ]);
});
