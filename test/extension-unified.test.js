import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const EXT_DIR = new URL("../browser-extension/1688-collector/", import.meta.url);
const SRC_DIR = new URL("../src/", import.meta.url);

test("ERP collector extension is a unified 1688 and Ozon worker", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", EXT_DIR), "utf8"));
  const background = await readFile(new URL("background.js", EXT_DIR), "utf8");
  const popup = await readFile(new URL("popup.html", EXT_DIR), "utf8");

  assert.match(manifest.name, /ERP.*采集助手/);
  assert.ok(manifest.host_permissions.includes("https://*.1688.com/*"));
  assert.ok(manifest.host_permissions.includes("https://login.taobao.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.ozon.ru/*"));
  assert.match(background, /api\/1688-crawler\/extension\/heartbeat/);
  assert.match(background, /api\/ozon-learning\/extension\/heartbeat/);
  assert.match(popup, /统一采集助手/);
});

test("ERP collector pauses polling after human verification is detected", async () => {
  const background = await readFile(new URL("background.js", EXT_DIR), "utf8");

  assert.match(background, /HUMAN_CHECK_PAUSED_KEY/);
  assert.match(background, /isHumanCheckPaused/);
  assert.match(background, /setHumanCheckPause/);
  assert.match(background, /clearHumanCheckPause/);
  assert.match(background, /OZON_ERP_CRAWLER_RESUME_AFTER_HUMAN/);
  assert.doesNotMatch(background, /if \(options\.manual\) await clearHumanCheckPause/);
  assert.match(background, /chrome\.alarms\.clear\("ozon-erp-crawler-poll"\)/);
  assert.match(background, /if \(!humanCheckDetected && tab\?\.id\)/);
  assert.match(background, /自动采集已暂停/);
  assert.match(background, /api\/1688-crawler\/tasks\/\$\{encodeURIComponent\(humanPause\.job\.taskId\)\}\/resume/);
});

test("ERP collector restores paused human-check job details after worker restart", async () => {
  const background = await readFile(new URL("background.js", EXT_DIR), "utf8");

  assert.match(background, /getHumanCheckPause/);
  assert.match(background, /const humanPause = await getHumanCheckPause\(\)/);
  assert.match(background, /job: humanPause\.job \|\| lastWorkerState\.job/);
  assert.match(background, /lastError: humanPause\.message \|\| lastWorkerState\.lastError/);
});

test("ERP collector guards chrome.runtime.getURL before injecting page reader", async () => {
  const content = await readFile(new URL("content.js", EXT_DIR), "utf8");

  assert.match(content, /globalThis\.chrome\?\.runtime\?\.getURL/);
  assert.match(content, /if \(!getUrl\) return false/);
  assert.match(content, /if \(is1688Page\(\)\) \{[\s\S]*injectPageReader\(\);/);
});

test("ERP crawler and Ozon learning do not dispatch waiting-human jobs", async () => {
  const crawler = await readFile(new URL("crawler1688.js", SRC_DIR), "utf8");
  const ozonLearning = await readFile(new URL("ozonLearning.js", SRC_DIR), "utf8");

  assert.match(crawler, /\["stopped", "paused", "waiting_human", "failed", "finished"\]/);
  assert.match(ozonLearning, /\["stopped", "paused", "waiting_human", "failed", "finished"\]/);
  assert.match(ozonLearning, /result\.needsHuman/);
  assert.match(ozonLearning, /status: "waiting_human"/);
});

test("ERP collector monitors Ozon Seller listing edits for journal learning", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", EXT_DIR), "utf8"));
  const content = await readFile(new URL("content.js", EXT_DIR), "utf8");

  assert.ok(manifest.host_permissions.includes("https://seller.ozon.ru/*"));
  assert.match(content, /isOzonSellerPage/);
  assert.match(content, /mountOzonSellerEditMonitor/);
  assert.match(content, /snapshotOzonSellerForm/);
  assert.match(content, /api\/listing-edit-journal\/events/);
  assert.match(content, /ozon_seller_plugin/);
  assert.match(content, /ozon_backend_edit/);
});

test("ERP collector prioritizes real Ozon product gallery images", async () => {
  const content = await readFile(new URL("content.js", EXT_DIR), "utf8");

  assert.match(content, /function collectOzonGalleryImages/);
  assert.match(content, /\[data-widget\*="webGallery"\] img/);
  assert.match(content, /ozonImageScore/);
  assert.match(content, /marketing-api\|banner\|avatar\|seller\|logo\|icon/);
  assert.match(content, /const images = collectOzonGalleryImages\(\)/);
  assert.doesNotMatch(content, /const images = dedupe\(\[\.\.\.document\.images\]/);
});
