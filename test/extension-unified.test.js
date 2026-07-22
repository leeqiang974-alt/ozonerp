import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const EXT_DIR = new URL("../browser-extension/1688-collector/", import.meta.url);
const UNIFIED_DIR = new URL("../browser-extension/erp-collector-extension/", import.meta.url);
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

test("unified extension supports external HTTPS ERP without persisting the session token", async () => {
  const background = await readFile(new URL("background.js", UNIFIED_DIR), "utf8");
  const popup = await readFile(new URL("popup.js", UNIFIED_DIR), "utf8");
  const html = await readFile(new URL("popup.html", UNIFIED_DIR), "utf8");
  const manifest = JSON.parse(await readFile(new URL("manifest.json", UNIFIED_DIR), "utf8"));

  assert.match(background, /ERP_BASE_URL_KEY/);
  assert.match(background, /ERP_SESSION_TOKEN_KEY/);
  assert.match(background, /外部 ERP 必须使用 HTTPS/);
  assert.match(background, /Authorization = `Bearer \$\{config\.token\}`/);
  assert.match(background, /delete headers\.Authorization/);
  assert.match(background, /api\/1688-crawler\/extension\/next/);
  assert.match(background, /api\/ozon-learning\/extension\/next/);
  assert.match(background, /api\/1688-crawler\/extension\/heartbeat/);
  assert.match(background, /api\/ozon-learning\/extension\/heartbeat/);
  assert.doesNotMatch(background, /storage\.local\.set\(\{\s*\[ERP_SESSION_TOKEN_KEY\]/);
  assert.match(popup, /OZON_ERP_CONFIG_SAVE/);
  assert.match(popup, /permissions\.request/);
  assert.match(popup, /OZON_ERP_API_REQUEST/);
  assert.match(html, /erpBaseUrl/);
  assert.match(html, /erpSessionToken/);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
});

test("collector popup blocks collection until a store is connected", async () => {
  const popup = await readFile(new URL("popup.js", UNIFIED_DIR), "utf8");
  const html = await readFile(new URL("popup.html", UNIFIED_DIR), "utf8");
  assert.match(html, /id="collectButton"[^>]*disabled/);
  assert.match(html, /请先连接 ERP 并选择归属店铺/);
  assert.match(popup, /function updateCollectAvailability/);
  assert.match(popup, /请先连接 ERP 并选择归属店铺，再采集商品/);
  assert.match(popup, /button\.dataset\.collecting/);
  assert.match(popup, /updateCollectAvailability\(\);/);
});

test("1688 extensions surface the redacted capture receipt identity", async () => {
  const files = [
    "../browser-extension/1688-collector/content.js",
    "../browser-extension/erp-collector-extension/content.js",
  ];
  for (const file of files) {
    const content = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(content, /result\.captureReceipt/);
    assert.match(content, /captureIdentity/);
    assert.match(content, /快照 \$\{hashShort\}/);
    assert.match(content, /任务未绑定/);
  }
});

test("1688 detail extensions send the versioned manual capture contract", async () => {
  const [collector, unified] = await Promise.all([
    readFile(new URL("../browser-extension/1688-collector/content.js", import.meta.url), "utf8"),
    readFile(new URL("../browser-extension/erp-collector-extension/content.js", import.meta.url), "utf8"),
  ]);
  assert.match(collector, /contractVersion:\s*["']manual_capture_v1["']/);
  assert.match(unified, /contractVersion:\s*["']manual_capture_v1["']/);
});

test("1688 collector opens the exact captured item in the ERP sourcing box", async () => {
  for (const directory of ["../browser-extension/1688-collector/", "../browser-extension/erp-collector-extension/"]) {
    const popup = await readFile(new URL(`${directory}popup.js`, import.meta.url), "utf8");
    const html = await readFile(new URL(`${directory}popup.html`, import.meta.url), "utf8");
    assert.match(html, /id="openCaptureLink"/);
    assert.match(popup, /showCaptureLink/);
    assert.match(popup, /openCurrentCapture/);
    assert.match(popup, /chrome\.tabs\.create/);
    assert.match(popup, /captureId=/);
    assert.match(popup, /ERP 已自动打开当前商品/);
  }
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

test("ERP collector keeps human pause when resume or ERP requeue fails", async () => {
  const background = await readFile(new URL("background.js", EXT_DIR), "utf8");

  assert.match(background, /Keep the persisted pause until ERP accepts the resume request/);
  assert.match(background, /if \(lastWorkerState\.status === "error"\) \{[\s\S]*setHumanCheckPause\(humanPause\.job/);
  assert.match(background, /status: "waiting_human"[\s\S]*恢复采集未完成/);
  assert.match(background, /await clearHumanCheckPause\(\);[\s\S]*ensureCrawlerAlarm\(\);[\s\S]*await pollCrawlerJob\(\{ resume: true \}\)/);
});

test("ERP collector serializes human resume clicks to avoid duplicate task submission", async () => {
  const background = await readFile(new URL("background.js", EXT_DIR), "utf8");

  assert.match(background, /let humanResumeBusy = false/);
  assert.match(background, /async function resumeAfterHumanCheck\(\) \{[\s\S]*if \(humanResumeBusy\) return;[\s\S]*humanResumeBusy = true/);
  assert.match(background, /finally \{[\s\S]*humanResumeBusy = false/);
  assert.match(background, /resumeAfterHumanCheckOnce/);
});

test("ERP detail capture carries resumable task and collection identity", async () => {
  const background = await readFile(new URL("background.js", EXT_DIR), "utf8");
  const content = await readFile(new URL("content.js", EXT_DIR), "utf8");

  assert.match(background, /type: "COLLECT_1688_PRODUCT_RAW"[\s\S]*taskId: job\.taskId/);
  assert.match(content, /taskId: String\(options\.taskId \|\| ""\)\.trim\(\)/);
  assert.match(content, /collectedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(content, /captureMode: options\.captureMode \|\| "extension_browser"/);
});

test("ERP 1688 collector keeps SKU variants, normalized media, and millimeter package fields", async () => {
  const content = await readFile(new URL("content.js", EXT_DIR), "utf8");

  assert.match(content, /const skuVariants = pickSkuVariants\(contextData, packageInfo\.skuPackageMap \|\| \{\}\)/);
  assert.match(content, /skuVariants,/);
  assert.match(content, /const images = pickImages\(contextData\)/);
  assert.match(content, /dedupe\(images\.map\(normalizeImage\)/);
  assert.match(content, /lengthMm: toNumber\(item\.length\) \* 10/);
  assert.match(content, /widthMm: toNumber\(item\.width\) \* 10/);
  assert.match(content, /heightMm: toNumber\(item\.height\) \* 10/);
  assert.match(content, /return variants\.filter\(\(sku, index\) => selectedKeys\.has/);
});

test("ERP collector restores paused human-check job details after worker restart", async () => {
  const background = await readFile(new URL("background.js", EXT_DIR), "utf8");

  assert.match(background, /getHumanCheckPause/);
  assert.match(background, /const humanPause = await getHumanCheckPause\(\)/);
  assert.match(background, /job: humanPause\.job \|\| lastWorkerState\.job/);
  assert.match(background, /lastError: humanPause\.message \|\| lastWorkerState\.lastError/);
});

test("ERP collector exposes the persisted human-check pause immediately on startup", async () => {
  const background = await readFile(new URL("background.js", EXT_DIR), "utf8");

  assert.match(background, /async function initializeCrawlerWorker\(\) \{[\s\S]*const humanPause = await getHumanCheckPause\(\);[\s\S]*if \(humanPause\?\.paused\) \{[\s\S]*status: "waiting_human"[\s\S]*needsHuman: true/);
  assert.match(background, /if \(humanPause\?\.paused\) \{[\s\S]*return;[\s\S]*await setWorkerState\(\{ status: "idle"/);
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
