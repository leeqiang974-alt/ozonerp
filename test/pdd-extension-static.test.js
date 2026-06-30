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
