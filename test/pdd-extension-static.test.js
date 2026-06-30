import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ERP collector extension declares PDD page access", async () => {
  const manifest = await readFile(new URL("../browser-extension/erp-collector-extension/manifest.json", import.meta.url), "utf8");

  assert.match(manifest, /pinduoduo\.com/);
  assert.match(manifest, /yangkeduo\.com/);
});

test("ERP collector extension can collect PDD product pages into ERP", async () => {
  const content = await readFile(new URL("../browser-extension/erp-collector-extension/content.js", import.meta.url), "utf8");

  assert.match(content, /isPddPage/);
  assert.match(content, /COLLECT_PDD_PRODUCT/);
  assert.match(content, /collectPddPage/);
  assert.match(content, /\/api\/pdd\/capture/);
  assert.match(content, /pageNeedsPddHumanCheck/);
});

test("ERP collector popup can actively collect current PDD tab", async () => {
  const popup = await readFile(new URL("../browser-extension/erp-collector-extension/popup.js", import.meta.url), "utf8");

  assert.match(popup, /isPddTab/);
  assert.match(popup, /COLLECT_PDD_PRODUCT/);
  assert.match(popup, /\/api\/pdd\/capture/);
  assert.match(popup, /拼多多商品详情页/);
});

test("ERP collector extension filters PDD page chrome before capture", async () => {
  const content = await readFile(new URL("../browser-extension/erp-collector-extension/content.js", import.meta.url), "utf8");

  assert.match(content, /isLikelyPddVariantSpec/);
  assert.match(content, /拼单\|即将结束/);
  assert.match(content, /coupon\|promotion\|brand/);
});

test("ERP collector extension reads PDD embedded title fields", async () => {
  const content = await readFile(new URL("../browser-extension/erp-collector-extension/content.js", import.meta.url), "utf8");

  assert.match(content, /pddEmbeddedValue/);
  assert.match(content, /goodsName/);
  assert.match(content, /shareTitle/);
  assert.match(content, /decodeJsonishString/);
});

test("ERP collector extension separates PDD main, SKU, and detail images", async () => {
  const content = await readFile(new URL("../browser-extension/erp-collector-extension/content.js", import.meta.url), "utf8");

  assert.match(content, /detailImages: pickPddDetailImages\(\)/);
  assert.match(content, /function pickPddDetailImages/);
  assert.match(content, /function pddEmbeddedImagesByKeys/);
  assert.match(content, /detailGallery/);
  assert.match(content, /thumbUrl/);
  assert.match(content, /skuImageUrl/);
});
