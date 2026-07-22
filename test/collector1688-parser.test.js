import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build1688SourceEvidenceContract, normalize1688CaptureEnvelope, normalizeManualCapturePayload, parse1688Product } from "../src/collector1688.js";

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "1688");

function fixture(name) {
  const root = path.join(FIXTURE_ROOT, name);
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")),
    html: fs.readFileSync(path.join(root, "page.html"), "utf8"),
  };
}

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

test("1688 capture envelope preserves task identity and normalizes extension sentAt", () => {
  const capture = normalize1688CaptureEnvelope({
    url: "https://detail.1688.com/offer/900000000099.html?spm=foo",
    taskId: "task-from-extension",
    sentAt: "2026-07-17T00:00:00+08:00",
    captureMode: "extension_browser",
  });
  assert.deepEqual(capture, {
    contractVersion: "manual_capture_v1",
    taskId: "task-from-extension",
    url: "https://detail.1688.com/offer/900000000099.html?spm=foo",
    offerId: "900000000099",
    collectedAt: "2026-07-16T16:00:00.000Z",
    captureMode: "extension_browser",
  });
  const parsed = parse1688Product({
    url: capture.url,
    html: pageWithJson({ productTitle: "带任务身份的测试商品标题" }),
    hints: capture,
  });
  assert.deepEqual(parsed.capture, capture);
});

test("manual_capture_v1 normalizes old extension input and rejects unknown versions", () => {
  const normalized = normalizeManualCapturePayload({
    url: "https://detail.1688.com/offer/900000000099.html",
    html: "<html><title>测试商品</title></html>",
    taskId: "task-v1",
    sentAt: "2026-07-17T00:00:00+08:00",
    storeId: "store-a",
  });
  assert.equal(normalized.contractVersion, "manual_capture_v1");
  assert.equal(normalized.capture.contractVersion, "manual_capture_v1");
  assert.equal(normalized.offerId, "900000000099");
  assert.equal(normalized.storeId, "store-a");
  assert.equal(normalized.hints.contractVersion, "manual_capture_v1");
  assert.throws(
    () => normalizeManualCapturePayload({ contractVersion: "manual_capture_v2", url: normalized.url, html: normalized.html }),
    (error) => error.reasonCode === "MANUAL_CAPTURE_CONTRACT_UNSUPPORTED" && error.status === 400,
  );
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

test("1688 parser extracts detail images into Ozon rich content", () => {
  const parsed = parse1688Product({
    url: "https://detail.1688.com/offer/10004.html",
    html: pageWithJson({
      productTitle: "加厚铁油桶汽油桶测试商品",
      offer_details: {
        content: [
          "<div class='desc'>",
          "<img src='https://cbu01.alicdn.com/img/ibank/detail-a.jpg?x=1'>",
          "<img src='https://cbu01.alicdn.com/img/ibank/detail-b.png'>",
          "<img src='https://cbu01.alicdn.com/img/ibank/detail-a.jpg?y=2'>",
          "<img src='data:image/gif;base64,R0lGOD'>",
          "</div>",
        ].join(""),
      },
    }),
  });

  assert.deepEqual(parsed.detailImages, [
    "https://cbu01.alicdn.com/img/ibank/detail-a.jpg",
    "https://cbu01.alicdn.com/img/ibank/detail-b.png",
  ]);
  assert.equal(parsed.richContentJson.version, 0.3);
  assert.equal(parsed.richContentJson.content.length, 2);
  assert.equal(parsed.richContentJson.content[0].widgetName, "raShowcase");
  assert.equal(parsed.richContentJson.content[0].blocks[0].img.src, "https://cbu01.alicdn.com/img/ibank/detail-a.jpg");
});

test("1688 parser reports machine-readable parse issues", () => {
  const parsed = parse1688Product({
    url: "https://detail.1688.com/offer/10005.html",
    html: pageWithJson({
      productTitle: "测试商品标题足够长",
      image: "https://cbu01.alicdn.com/img/ibank/O1CN-main.jpg",
    }),
  });

  assert.deepEqual(parsed.parseIssues, [
    "missing_sku_variants",
    "missing_attributes",
    "missing_package_weight",
    "missing_package_dimensions",
    "missing_supplier_id",
    "missing_supplier_name",
    "missing_procurement_moq",
    "missing_procurement_price_tiers",
  ]);
});

test("1688 parser emits a traceable source evidence envelope from a replay fixture", () => {
  const sample = fixture("complete-single");
  const parsed = parse1688Product({
    url: sample.manifest.url,
    html: sample.html,
    hints: sample.manifest.hints,
  });

  assert.equal(parsed.sourceEvidence.platform, "1688");
  assert.equal(parsed.sourceEvidence.offerId, "900000000001");
  assert.equal(parsed.sourceEvidence.canonicalUrl, "https://detail.1688.com/offer/900000000001.html");
  assert.equal(parsed.sourceEvidence.capturedAt, "2026-07-12T08:00:00.000Z");
  assert.equal(parsed.sourceEvidence.captureMode, "fixture_replay");
  assert.match(parsed.sourceEvidence.snapshotHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(parsed.sourceEvidence.verificationState, "ok");
  assert.equal(parsed.sourceEvidence.verificationReason, "");
  assert.equal(parsed.sourceEvidence.sellerFacing.status, "needs_review");
  assert.equal(parsed.sourceEvidence.sellerFacing.snapshotHash, parsed.sourceEvidence.snapshotHash);
  assert.equal(parsed.sourceEvidence.sellerFacing.nextAction, "补齐来源字段：supplier、procurement，然后重新采集并预检");
  assert.deepEqual(parsed.sourceEvidence.sellerFacing.sideEffects, ["不会提交 Ozon", "不会修改价格", "不会写入库存"]);
  assert.equal(parsed.sourceEvidence.fields.title.source, "page_content");
  assert.equal(parsed.sourceEvidence.fields.images.source, "page_content");
  assert.equal(parsed.sourceEvidence.fields.variants.source, "page_content");
  assert.equal(parsed.sourceEvidence.fields.package.source, "page_content");
  assert.equal(parsed.sourceEvidence.fields.attributes.source, "page_content");
  assert.equal(parsed.sourceEvidence.fields.supplier.source, "missing");
  assert.equal(parsed.sourceEvidence.fields.procurement.source, "missing");
  assert.equal(parsed.sourceEvidence.fields.variants.count, 1);
  assert.deepEqual(parsed.sourceEvidence.fields.package.values, parsed.sizeWeight);
});

test("1688 parser keeps only redacted fixture provenance beside the snapshot hash", () => {
  const parsed = parse1688Product({
    url: "https://detail.1688.com/offer/10002.html",
    html: pageWithJson({ title: "脱敏快照商品", skuMap: { "颜色:红": { specId: "r", discountPrice: 3, canBookCount: 2 } } }),
    hints: {
      captureMode: "fixture_replay",
      fixtureProvenance: {
        fixtureKind: "real_redacted_capture",
        synthetic: false,
        redacted: true,
        verificationLevel: "locally_tested_fixture",
        manifestHash: `sha256:${"a".repeat(64)}`,
        validationTargets: ["sku_matrix"],
      },
    },
  });
  assert.equal(parsed.sourceEvidence.fixtureProvenance.redacted, true);
  assert.equal(parsed.sourceEvidence.fixtureProvenance.synthetic, false);
  assert.match(parsed.sourceEvidence.fixtureProvenance.manifestHash, /^sha256:/);
  assert.deepEqual(parsed.sourceEvidence.fixtureProvenance.validationTargets, ["sku_matrix"]);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.sourceEvidence.fixtureProvenance, "html"), false);
});

test("1688 source contract does not call partial package evidence ready", () => {
  const contract = build1688SourceEvidenceContract({
    verificationState: "ok",
    snapshotHash: `sha256:${"a".repeat(64)}`,
    fields: {
      title: { source: "page_content" },
      variants: { source: "page_content", count: 1 },
      package: { source: "page_content", values: { weightG: 250, lengthMm: 0, widthMm: 0, heightMm: 0 } },
      supplier: { source: "page_content" },
      procurement: { source: "page_content" },
    },
  });
  assert.equal(contract.status, "needs_review");
  assert.deepEqual(contract.completenessGaps, ["package"]);
  assert.match(contract.nextAction, /package/);
});

test("1688 evidence hash is deterministic and query parameters do not alter canonical offer URL", () => {
  const sample = fixture("color-size-matrix");
  const input = { url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints };
  const first = parse1688Product(input);
  const second = parse1688Product(input);

  assert.equal(first.sourceEvidence.snapshotHash, second.sourceEvidence.snapshotHash);
  assert.equal(first.sourceEvidence.canonicalUrl, "https://detail.1688.com/offer/900000000002.html");
  assert.equal(first.sourceEvidence.fields.variants.count, 2);
  assert.equal(first.skuVariants.length, 2);
});

test("1688 structured SKU model preserves real matrix rows without inventing a cartesian product", () => {
  const sample = fixture("color-size-matrix");
  const parsed = parse1688Product({ url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints });

  assert.deepEqual(parsed.skuAxes.map((axis) => ({ name: axis.name, sourcePropId: axis.sourcePropId, sourceIdKind: axis.sourceIdKind })), [
    { name: "颜色", sourcePropId: "prop-color", sourceIdKind: "platform" },
    { name: "尺寸", sourcePropId: "prop-size", sourceIdKind: "platform" },
  ]);
  assert.equal(parsed.skuVariants.length, 2);
  assert.deepEqual(parsed.skuVariants.map((variant) => variant.spec), ["颜色: 白色; 尺寸: S", "颜色: 蓝色; 尺寸: M"]);
  assert.deepEqual(parsed.skuVariants[0].specPairs, [
    { name: "颜色", value: "白色", sourcePropId: "prop-color", sourceValueId: "value-white", sourceIdKind: "platform" },
    { name: "尺寸", value: "S", sourcePropId: "prop-size", sourceValueId: "value-s", sourceIdKind: "platform" },
  ]);
  assert.deepEqual(parsed.skuVariants[1].specPairs, [
    { name: "颜色", value: "蓝色", sourcePropId: "prop-color", sourceValueId: "value-blue", sourceIdKind: "platform" },
    { name: "尺寸", value: "M", sourcePropId: "prop-size", sourceValueId: "value-m", sourceIdKind: "platform" },
  ]);
});

test("1688 bundle fixture preserves only real count-color combinations and reports missing business evidence", () => {
  const sample = fixture("bundle-partial-combinations");
  const parsed = parse1688Product({ url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints });

  assert.equal(sample.manifest.fixtureKind, "synthetic_redacted_replay");
  assert.equal(sample.manifest.synthetic, true);
  assert.equal(sample.manifest.redacted, true);
  assert.deepEqual(parsed.skuAxes.map((axis) => axis.name), ["件数", "颜色"]);
  assert.equal(parsed.skuVariants.length, 3);
  assert.deepEqual(parsed.skuVariants.map((variant) => variant.spec), [
    "件数: 2件套; 颜色: 白色",
    "件数: 2件套; 颜色: 蓝色",
    "件数: 4件套; 颜色: 粉色",
  ]);
  assert.equal(parsed.skuVariants.some((variant) => variant.spec === "件数: 4件套; 颜色: 白色"), false);
  assert.equal(parsed.skuVariants.some((variant) => variant.spec === "件数: 4件套; 颜色: 蓝色"), false);
  assert.equal(parsed.skuVariants.some((variant) => variant.spec === "件数: 2件套; 颜色: 粉色"), false);
  assert.deepEqual(parsed.skuVariants.map((variant) => variant.specPairs.map((pair) => [pair.name, pair.value])), [
    [["件数", "2件套"], ["颜色", "白色"]],
    [["件数", "2件套"], ["颜色", "蓝色"]],
    [["件数", "4件套"], ["颜色", "粉色"]],
  ]);
  assert.equal(parsed.procurementEvidence.moq.source, "missing");
  assert.equal(parsed.procurementEvidence.priceTiers.source, "missing");
  assert.deepEqual(parsed.mediaAssets, []);
  assert.ok(parsed.parseIssues.includes("missing_supplier_id"));
  assert.ok(parsed.parseIssues.includes("missing_supplier_name"));
  assert.ok(parsed.parseIssues.includes("missing_procurement_moq"));
  assert.ok(parsed.parseIssues.includes("missing_procurement_price_tiers"));
  assert.ok(parsed.parseIssues.includes("missing_images"));
});

test("1688 structured SKU model derives stable local IDs when the page has no source IDs", () => {
  const sample = fixture("complete-single");
  const input = { url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints };
  const first = parse1688Product(input);
  const second = parse1688Product(input);
  const pair = first.skuVariants[0].specPairs[0];

  assert.equal(pair.name, "颜色");
  assert.equal(pair.value, "白色");
  assert.equal(pair.sourceIdKind, "derived");
  assert.match(pair.sourcePropId, /^derived:prop:[a-f0-9]{12}$/);
  assert.match(pair.sourceValueId, /^derived:value:[a-f0-9]{12}$/);
  assert.deepEqual(first.skuAxes, second.skuAxes);
  assert.deepEqual(first.skuVariants[0].specPairs, second.skuVariants[0].specPairs);
});

test("1688 evidence marks verification pages without claiming parsed business evidence", () => {
  const sample = fixture("human-verification");
  const parsed = parse1688Product({ url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints });

  assert.equal(parsed.sourceEvidence.verificationState, "waiting_human");
  assert.equal(parsed.sourceEvidence.verificationReason, "captcha");
  assert.equal(parsed.sourceEvidence.sellerFacing.status, "waiting_human");
  assert.match(parsed.sourceEvidence.sellerFacing.nextAction, /完成检测到验证码或滑块/);
  assert.deepEqual(parsed.sourceEvidence.sellerFacing.sideEffects, ["不会提交 Ozon", "不会修改价格", "不会写入库存"]);
  assert.equal(parsed.sourceEvidence.fields.title.source, "missing");
  assert.equal(parsed.sourceEvidence.fields.images.source, "missing");
  assert.equal(parsed.sourceEvidence.fields.variants.source, "missing");
  assert.equal(parsed.sourceEvidence.fields.package.source, "missing");
});

test("1688 source evidence classifies login and access-frequency blockers without exposing page content", async () => {
  const { parse1688Product } = await import("../src/collector1688.js");
  const login = parse1688Product({
    url: "https://detail.1688.com/offer/900000000004.html",
    html: "<html><title>请先登录</title><body>登录后查看商品</body></html>",
  }).sourceEvidence;
  assert.equal(login.verificationReason, "login_required");
  assert.match(login.sellerFacing.blocker, /登录状态失效/);
  assert.equal(login.sellerFacing.snapshotHash.startsWith("sha256:"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(login.sellerFacing, "html"), false);

  const throttled = parse1688Product({
    url: "https://detail.1688.com/offer/900000000005.html",
    html: "<html><title>访问频繁</title><body>请稍后再试</body></html>",
  }).sourceEvidence;
  assert.equal(throttled.verificationReason, "access_rate_limited");
  assert.match(throttled.sellerFacing.nextAction, /访问 频繁|访问频繁/);
});

test("1688 parser preserves supplier and quantity-bound procurement tiers as snapshot evidence", () => {
  const sample = fixture("tier-price-moq");
  const parsed = parse1688Product({ url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints });

  assert.deepEqual(parsed.supplier, {
    id: "supplier-fixture-001",
    name: "脱敏家居用品供应商",
  });
  assert.equal(parsed.procurementEvidence.supplierId.source, "page_content");
  assert.equal(parsed.procurementEvidence.supplierName.source, "page_content");
  assert.equal(parsed.procurementEvidence.moq.value, 5);
  assert.equal(parsed.procurementEvidence.moq.source, "page_content");
  assert.deepEqual(parsed.procurementEvidence.priceTiers.values, [
    { minQuantity: 5, maxQuantity: 49, unitPriceCny: 12.8 },
    { minQuantity: 50, maxQuantity: 199, unitPriceCny: 11.6 },
    { minQuantity: 200, maxQuantity: null, unitPriceCny: 10.2 },
  ]);
  assert.equal(parsed.procurementEvidence.priceTiers.source, "page_content");
  assert.match(parsed.procurementEvidence.priceTiers.evidenceRef, /^snapshot:[a-f0-9]{64}$/);
  assert.equal(parsed.procurementEvidence.unitPurchasePriceCny, undefined);
  assert.equal(parsed.parseIssues.includes("missing_procurement_moq"), false);
  assert.equal(parsed.parseIssues.includes("missing_procurement_price_tiers"), false);
});

test("1688 parser reports missing procurement evidence instead of treating a displayed SKU price as single-unit cost", () => {
  const sample = fixture("complete-single");
  const parsed = parse1688Product({ url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints });

  assert.equal(parsed.skuVariants[0].price, 12.5);
  assert.equal(parsed.procurementEvidence.moq.source, "missing");
  assert.equal(parsed.procurementEvidence.priceTiers.source, "missing");
  assert.equal(parsed.procurementEvidence.unitPurchasePriceCny, undefined);
  assert.ok(parsed.parseIssues.includes("missing_procurement_moq"));
  assert.ok(parsed.parseIssues.includes("missing_procurement_price_tiers"));
});

test("1688 parser exposes media as unapproved candidates without changing legacy image outputs", () => {
  const sample = fixture("media-candidates");
  const parsed = parse1688Product({ url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints });

  assert.deepEqual(parsed.images, [
    "https://cbu01.alicdn.com/img/ibank/O1CN-media-main.jpg",
    "https://cbu01.alicdn.com/img/ibank/O1CN-media-blue.jpg",
    "https://cbu01.alicdn.com/img/ibank/O1CN-media-detail.jpg",
  ]);
  assert.deepEqual(parsed.detailImages, ["https://cbu01.alicdn.com/img/ibank/O1CN-media-detail.jpg"]);
  assert.equal(parsed.richContentJson.content.length, 1);
  assert.deepEqual(parsed.mediaAssets.map((asset) => ({
    role: asset.role,
    sourceUrl: asset.sourceUrl,
    sourceSkuId: asset.sourceSkuId,
    humanApproved: asset.checks.humanApproved,
  })), [
    { role: "main", sourceUrl: "https://cbu01.alicdn.com/img/ibank/O1CN-media-main.jpg", sourceSkuId: "", humanApproved: false },
    { role: "main", sourceUrl: "https://cbu01.alicdn.com/img/ibank/O1CN-media-blue.jpg", sourceSkuId: "", humanApproved: false },
    { role: "variant", sourceUrl: "https://cbu01.alicdn.com/img/ibank/O1CN-media-blue.jpg", sourceSkuId: "media-blue", humanApproved: false },
    { role: "detail", sourceUrl: "https://cbu01.alicdn.com/img/ibank/O1CN-media-detail.jpg", sourceSkuId: "", humanApproved: false },
  ]);
  for (const asset of parsed.mediaAssets) {
    assert.match(asset.id, /^media:[a-f0-9]{16}$/);
    assert.match(asset.sourceHash, /^url-sha256:[a-f0-9]{64}$/);
    assert.match(asset.evidenceRef, /^snapshot:[a-f0-9]{64}$/);
  }
  assert.deepEqual(parsed.mediaIssues, ["detail_images_require_human_review_before_rich_content"]);
});

test("1688 verification pages never claim product media evidence", () => {
  const sample = fixture("human-verification");
  const parsed = parse1688Product({ url: sample.manifest.url, html: sample.html, hints: sample.manifest.hints });

  assert.deepEqual(parsed.mediaAssets, []);
  assert.deepEqual(parsed.mediaIssues, []);
});
