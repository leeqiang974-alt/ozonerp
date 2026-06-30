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
