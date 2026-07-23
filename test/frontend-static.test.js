import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const OPTIONAL_DYNAMIC_IDS = new Set([
  "apply1688ToListing",
  "crawlerCookie",
  "crawlerCookieClear",
  "crawlerCookieSave",
  "crawlerCookieStatus",
  "load1688Capture",
  "ozonManualHtml",
  "ozonManualKeyword",
  "ozonManualParse",
  "ozonManualResult",
  "rulePoolKeyword",
  "variantGroupSelect",
  "workflowPayloadEditor",
]);

test("frontend keeps required app selectors present in the HTML shell", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const selectors = new Set();
  const patterns = [
    /on\("#([^"\s]+)"/g,
    /\$\("#([^"\s]+)"\)/g,
    /querySelector\("#([^"\s]+)"\)/g,
    /getElementById\("([^"\s]+)"\)/g,
    /getElementById\('([^'\s]+)'\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of js.matchAll(pattern)) selectors.add(match[1]);
  }
  const missing = [...selectors]
    .filter((id) => !htmlIds.has(id))
    .filter((id) => !OPTIONAL_DYNAMIC_IDS.has(id))
    .sort();

  assert.deepEqual(missing, []);
  assert.ok(htmlIds.has("listingAttributesJson"));
});

test("frontend renders exactly one ERP session form and keeps section markup balanced", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/id="erpSessionForm"/g) || []).length, 1);
  assert.equal((html.match(/id="erpSessionSecret"/g) || []).length, 1);
  assert.equal((html.match(/id="erpSessionStatus"/g) || []).length, 1);
  assert.equal((html.match(/<section\b/g) || []).length, (html.match(/<\/section>/g) || []).length);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML id 属性必须唯一，避免事件绑定命中错误模块");
});

test("store hint never renders an API key into the browser UI", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function updateStoreHint");
  const end = js.indexOf("function directWriteRequest", start);
  const body = js.slice(start, end);
  assert.match(body, /Seller API 凭据已配置，尚未验证连通/);
  assert.doesNotMatch(body, /Seller API 已连接|Seller API 已同步/);
  assert.match(body, /密钥不会显示在浏览器/);
  assert.doesNotMatch(body, /store\.apiKey/);
});

test("frontend shell presents the product as seller ERP rather than FBS-only", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Ozon Seller ERP<\/title>/);
});

test("listing presents one responsive product form with automatic fields and inline seller inputs", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /点一次自动处理到预检/);
  assert.match(js, /listing-simple-sheet/);
  assert.match(js, /listing-product-form/);
  assert.match(js, /系统已填写的商品资料/);
  assert.match(js, /需要你补充/);
  assert.match(js, /自动匹配，不需要你操作/);
  assert.match(js, /保存并自动完成其余资料/);
  assert.match(js, /data-listing-auto-complete/);
  assert.match(js, /runListingAutoCompletion/);
  assert.match(js, /saveListingSellerInputsBeforeAutoCompletion/);
  assert.match(js, /SELLER_INPUT_REQUIRED/);
  assert.match(js, /preserveSellerInputs/);
  assert.match(js, /if \(preserveSellerInputs && button\) button\.textContent = originalButtonText/);
  assert.match(js, /manual-seller-inputs/);
  assert.match(js, /listingSellerInputSections\.join/);
  assert.doesNotMatch(js, /autoCompletionAttempted && repairSections\.length/);
  assert.doesNotMatch(js, /类目证据同步后自动检查/);
  assert.match(js, /listingAutoCompletionInFlight\.has\(jobId\)/);
  assert.match(js, /listingAutoCompletionInFlight\.add\(jobId\)/);
  assert.match(js, /listingAutoCompletionInFlight\.delete\(jobId\)/);
  assert.match(js, /if \(categorySyncRequired && !categorySynced\)/);
  assert.match(js, /已在调用 AI 前停止/);
  assert.match(js, /if \(!bindingMatches\(\)\)/);
  assert.match(js, /encodeURIComponent\(runId\)\}\/controlled-chain/);
  const sellerSaveStart = js.indexOf("async function saveListingSellerInputsBeforeAutoCompletion");
  const sellerSaveEnd = js.indexOf("async function runListingAutoCompletion", sellerSaveStart);
  const sellerSave = js.slice(sellerSaveStart, sellerSaveEnd);
  assert.ok(sellerSave.indexOf("payload.content =") < sellerSave.indexOf("/manual-seller-inputs"));
  assert.ok(sellerSave.indexOf("payload.procurement =") < sellerSave.indexOf("/manual-seller-inputs"));
  assert.ok(sellerSave.indexOf("payload.package =") < sellerSave.indexOf("/manual-seller-inputs"));
  assert.equal((sellerSave.match(/await api\(/g) || []).length, 1);
  const listingSummaryStart = js.indexOf("function renderListingSellerTaskSummary");
  const listingSummaryEnd = js.indexOf("async function autoSyncListingCategoryEvidence", listingSummaryStart);
  const listingSummary = js.slice(listingSummaryStart, listingSummaryEnd);
  assert.doesNotMatch(listingSummary, /data-manual-(?:content|procurement|package)-save/);
  assert.match(js, /if \(!result\.completed \|\| !resultBoundToOriginal\)/);
  assert.match(js, /refreshedDraftHash === refreshedValidatedHash/);
  assert.match(js, /startNode: "content_generate"/);
  assert.match(js, /\/controlled-chain/);
  assert.match(js, /下一步只需最终提交确认/);
  assert.doesNotMatch(js, /data-listing-ai-fill/);
  assert.match(js, /effectiveCategoryDecision\?\.status === "auto_matched_evidence_pending"/);
  assert.match(js, /renderListingSellerEvidenceActions\(run, autoListJob, listingProductSource\)/);
  assert.match(js, /listingSourceEvidence\?\.captureIdentity\?\.offerId/);
  assert.match(js, /displayedOfferLabel = offerId \? "Ozon Offer" : "1688 Offer"/);
  assert.doesNotMatch(js, /\$\{escapeHtml\(offerId \|\| parentSku\)\} 首个 Offer/);
  assert.match(js, /listing-technical-details/);
  assert.match(css, /\.listing-simple-sheet/);
  assert.match(css, /\.listing-product-form/);
  assert.match(css, /\.listing-form-row/);
  assert.match(css, /\.listing-current-product-gate:not\(\.is-blocked\)/);
});

test("frontend exposes workflow console shell", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /workflow-console/);
  assert.match(js, /loadWorkflowRuns/);
  assert.match(js, /renderWorkflowConsole/);
});

test("frontend exposes a concrete 1688 crawler live monitor", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /crawlerLivePanel/);
  assert.match(html, /采集现场/);
  assert.match(js, /renderCrawlerLivePanel/);
  assert.match(js, /classifyCrawlerIssue/);
  assert.match(js, /currentJobUrl/);
  assert.match(js, /urlsDiscovered/);
  assert.match(js, /waiting_human/);
  assert.match(css, /crawler-live-panel/);
  assert.match(css, /crawler-live-lane/);
});

test("frontend does not mislabel a captured candidate as an already-created draft", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /已入采集箱（未建草稿）/);
  assert.match(js, /不代表已创建上架草稿/);
});

test("capture review failure keeps the seller next action in the listing queue", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /error\.responseData = data/);
  assert.match(js, /responseData\.captureImportReview\?\.nextAction/);
  assert.match(js, /state\.listingHandoffNotice = nextAction/);
  assert.match(js, /当前不能建草稿/);
});

test("candidate handoff keeps a seller-visible local-draft to preflight next step", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function createListingDraftFromCandidate");
  const end = js.indexOf("async function moveCrawlerCandidateToCapture", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /state\.listingHandoffNotice = data\.duplicate/);
  assert.match(body, /1688 候选已交接为本地上架草稿/);
  assert.match(body, /下一步补齐资料并运行预检/);
  assert.match(body, /未提交 Ozon/);
  assert.match(body, /renderListingSellerTaskSummary\(\)/);
  assert.match(body, /candidateStoreId/);
  assert.match(body, /body: JSON\.stringify\(\{ storeId \}\)/);
  assert.match(js, /data-candidate-id="\$\{escapeHtml\(item\.id\)\}" data-store-id="\$\{escapeHtml\(item\.storeId/);
});

test("collection-box drafts bind to a local workflow before seller preflight", async () => {
  const [js, server] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
  ]);
  assert.match(js, /\/api\/1688\/captures\/\$\{encodeURIComponent\(state\.currentCaptureId\)\}\/workflow/);
  assert.match(js, /state\.selectedWorkflowRunId = workflow\.workflowRunId/);
  assert.match(server, /app\.post\("\/api\/1688\/captures\/:id\/workflow"/);
  assert.match(server, /createListingWorkflowFrom1688Capture/);
});

test("collection box exposes seller blocker, next action, and state-specific action", async () => {
  const [js, css, html] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(js, /function captureSellerTaskView\(item = \{\}/);
  assert.match(js, /卡点：/);
  assert.match(js, /下一步：/);
  assert.match(js, /data-capture-task-state/);
  assert.match(js, /"生成草稿"/);
  assert.match(js, /"打开草稿"/);
  assert.match(css, /\.capture-seller-task/);
  assert.match(html, /<th>当前任务<\/th>/);
});

test("collection box error state offers a local retry reset instead of a sticky repair dead end", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const viewStart = js.indexOf("function captureSellerTaskView");
  const viewEnd = js.indexOf("function renderCaptureBox", viewStart);
  const view = js.slice(viewStart, viewEnd);
  assert.match(view, /清理本地失败标记，再打开商品重试/);
  assert.match(view, /actionLabel: "清理错误并重试"/);
  const bindStart = js.indexOf("function bindCaptureBoxRows");
  const bindEnd = js.indexOf("// A waiting-human capture", bindStart);
  const bind = js.slice(bindStart, bindEnd);
  assert.match(bind, /清理错误/);
  assert.match(js, /async function retryCaptureAfterError\(id, storeId = "", button = null\)/);
  const retryStart = js.indexOf("async function retryCaptureAfterError");
  const retryEnd = js.indexOf("// A waiting-human capture", retryStart);
  const retry = js.slice(retryStart, retryEnd);
  assert.match(retry, /status: "captured", lastError: ""/);
  assert.match(retry, /不会.*Ozon/);
});

test("waiting-human capture exposes a task-level recovery entry", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderCaptureBox");
  const end = js.indexOf("function selectedCaptureSelections", start);
  assert.ok(start >= 0 && end > start);
  const view = js.slice(start, end);
  assert.match(view, /resume-capture-human/);
  assert.match(view, /data-task-id/);
  assert.match(js, /async function openCaptureHumanTask\(taskId = ""\)/);
  assert.match(js, /\.tab\[data-view="crawler1688"\]/);
  assert.match(js, /点击“继续”完成 1688 登录或人机验证/);
});

test("collection box recognizes a saved single-SKU draft without variant rows", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function captureSellerTaskView");
  const end = js.indexOf("function renderCaptureBox", start);
  const body = js.slice(start, end);
  assert.match(body, /draft\.parentSku \|\| draft\.payloadDraftHash \|\| draft\.categoryId \|\| draft\.typeId/);
  assert.match(body, /草稿已保存，待预检/);
  assert.doesNotMatch(body, /draft\.variants\.length\) \{/);
});

test("collection box exposes a one-click local preflight action", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /captureBoxTable/);
  assert.match(js, /preflight-capture/);
  assert.match(js, /function runCapturePreflight/);
  assert.match(js, /\/api\/1688\/captures\/\$\{encodeURIComponent\(id\)\}\/preflight/);
  assert.match(js, /提交前仍需人工确认/);
  assert.match(js, /本地预检已完成/);
});

test("collection box requires exact snapshot confirmation before draft handoff", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(js, /review-capture/);
  assert.match(js, /function reviewCaptureSnapshot/);
  assert.match(js, /\/api\/1688\/captures\/\$\{encodeURIComponent\(id\)\}\/review/);
  const start = js.indexOf("async function createDraftFromCapture");
  const end = js.indexOf("async function runCapturePreflight", start);
  const body = js.slice(start, end);
  assert.match(body, /确认同一份 1688 来源/);
  assert.match(source, /app\.post\("\/api\/1688\/captures\/:id\/review"/);
  assert.match(source, /reviewedSnapshotHash: snapshotHash/);
  assert.match(source, /未访问 1688、未调用 Ozon/);
});

test("snapshot confirmation immediately opens the unique local draft skeleton", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const reviewStart = js.indexOf("async function reviewCaptureSnapshot");
  const reviewEnd = js.indexOf("async function createDraftFromCapture", reviewStart);
  const reviewBody = js.slice(reviewStart, reviewEnd);
  assert.match(reviewBody, /openCaptureDraftSkeleton\(id, storeId\)/);
  assert.match(reviewBody, /确认当前快照并创建本地草稿骨架/);

  const openStart = js.indexOf("async function openCaptureDraftSkeleton");
  const openEnd = js.indexOf("async function createDraftFromCapture", openStart);
  const openBody = js.slice(openStart, openEnd);
  assert.match(openBody, /\/api\/1688\/captures\/\$\{encodeURIComponent\(id\)\}\/workflow/);
  assert.match(openBody, /data\.draftSkeleton/);
  assert.match(openBody, /state\.selectedWorkflowRunId = workflowRunId/);
  assert.match(openBody, /state\.selectedWorkflowNodeKey = "capture_handoff"/);
  assert.match(openBody, /activateErpView\("listing"\)/);
  assert.match(openBody, /loadAutoListJobs/);
  assert.doesNotMatch(openBody, /submitListing\s*\(/);
});

test("capture batch actions cannot bypass snapshot review", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const generateStart = js.indexOf("async function batchGenerateDrafts");
  const publishStart = js.indexOf("async function batchPublishCaptures");
  const helperStart = js.indexOf("function assertCaptureSnapshotReviewed");
  const helperEnd = js.indexOf("function ensureCaptureReadyForBatchPublish", helperStart);
  assert.ok(generateStart >= 0 && publishStart > generateStart && helperStart > publishStart && helperEnd > helperStart);
  assert.match(js.slice(generateStart, publishStart), /assertCaptureSnapshotReviewed/);
  assert.match(js.slice(publishStart, helperStart), /assertCaptureSnapshotReviewed/);
  assert.match(js.slice(helperStart, helperEnd), /review\.humanConfirmed === true/);
  assert.match(js.slice(helperStart, helperEnd), /reviewedSnapshotHash/);
});

test("sourcing view exposes redacted 1688 fixture import without raw-page persistence", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /1688FixtureManifest/);
  assert.match(html, /1688FixturePage/);
  assert.match(html, /导入到采集箱/);
  assert.match(js, /async function import1688Fixture/);
  assert.match(js, /manifest\?\.redacted !== true/);
  assert.match(js, /fixtureProvenance/);
  assert.match(js, /仅保存解析摘要与哈希/);
  assert.match(js, /\/api\/1688\/capture/);
});

test("capture-box generate-draft action persists a local draft before preflight", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function createDraftFromCapture");
  const end = js.indexOf("async function runCapturePreflight", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /async function createDraftFromCapture/);
  assert.match(body, /saveListingDraft\("draft"/);
  assert.match(body, /未提交 Ozon/);
  assert.doesNotMatch(body, /submitListing\s*\(/);
  assert.match(js, /生成草稿.*createDraftFromCapture/);
});

test("capture-box draft handoff explicitly lands on the listing workbench", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function createDraftFromCapture");
  const end = js.indexOf("async function runCapturePreflight", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /activateErpView\("listing"\)/);
  assert.match(body, /renderListingSellerTaskSummary\(\)/);
  assert.match(body, /state\.listingHandoffNotice = "已保存本地上架草稿/);
});

test("saved capture drafts refresh the linked job before seller repair forms render", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function saveListingDraft");
  const end = js.indexOf("async function saveAndSubmitListing", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /await loadAutoListJobs\(\)\.catch/);
  assert.match(body, /await loadCaptureBox\(\)/);
  assert.match(body, /草稿已保存/);
});

test("batch collection action only prepares local drafts and cannot fake an Ozon submission", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = js.indexOf("async function batchPublishCaptures()");
  const end = js.indexOf("function ensureCaptureReadyForBatchPublish", start);
  assert.ok(start >= 0 && end > start);
  const batchSource = js.slice(start, end);
  assert.doesNotMatch(batchSource, /submitListing\s*\(/, "batch preparation must not call the closed/direct submit path");
  assert.match(batchSource, /saveListingDraft\("draft"/);
  assert.match(batchSource, /status:\s*"draft_ready"/);
  assert.match(batchSource, /人工确认提交/);
  assert.match(html, /id="batchPublishCaptures"[^>]*>批量进入预检</);
});

test("blocked preflight exposes a safe return-to-draft action", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /回到草稿修复并重新预检/);
  assert.match(js, /data-seller-preflight-return/);
  assert.match(js, /setListingStage\("current-product"\)/);
  assert.match(js, /修复后点击重新校验 Payload/);
});

test("seller preflight repair actions preserve the exact field and SKU locator", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /data-issue-field-path=/);
  assert.match(js, /data-issue-offer-id=/);
  assert.match(js, /openSellerPayloadIssue\(button\.dataset\.runId, button\)/);
  assert.match(js, /state\.selectedWorkflowPayloadIssue/);
  assert.match(js, /data-payload-offer-id=/);
  assert.match(js, /focusWorkflowPayloadIssue\(locator\)/);
});

test("seller summary treats normalized waiting-human task states as a confirmation gate", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /\["waiting", "waiting_human", "needs_confirmation"\]\.includes\(String\(task\?\.status \|\| ""\)\)/);
  assert.match(js, /const waitingHuman = run\?\.status === "waiting_human"/);
});

test("unvalidated saved drafts warn that old confirmation cannot be reused", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /当前草稿没有有效预检版本/);
  assert.match(js, /旧确认不可复用/);
  assert.match(js, /listing-seller-preflight-stale-hint/);
});

test("payload submit stays disabled until preflight and draft hash both match", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /const preflightPassed = run\.payloadDraftValidation\?\.ok === true/);
  assert.match(js, /const validationHashMatches = Boolean\(currentDraftHash && validatedDraftHash && currentDraftHash === validatedDraftHash\)/);
  assert.match(js, /submissionLocked \|\| submissionGateBlocked \? "disabled"/);
  assert.match(js, /当前草稿 hash 与预检版本不一致/);
});

test("empty order rows do not claim the store has no orders when seller evidence is unknown", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /订单读取范围或解释状态未知，不能判断店铺没有订单/);
  assert.match(js, /订单读取不完整，不能据此判断店铺没有订单/);
  assert.match(js, /state\.orderBatch\?\.sellerStatus/);
});

test("dashboard order health does not claim no backlog before order sync", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /const orderEvidenceKnown = orderBatch\.loaded === true/);
  assert.match(js, /!orderBatch\.loaded \? "待同步"/);
  assert.match(js, /尚未读取订单，不能判断是否有履约积压/);
});

test("finance UI keeps stale order evidence out of current sales", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /financeReadModel/);
  assert.match(js, /订单范围或金额证据未完整，不显示合计/);
  assert.match(js, /重新读取当前店铺订单范围/);
  assert.match(js, /checkedAtMs > Date\.now\(\) \+ 5 \* 60 \* 1000/);
});

test("frontend exposes official 1688 Open API configuration status", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /open1688StatusPanel/);
  assert.match(html, /1688 官方接口/);
  assert.match(js, /loadOpen1688Status/);
  assert.match(js, /api\("\/api\/1688-open\/status"\)/);
  assert.match(css, /open1688-status-card/);
});

test("frontend exposes workflow payload editor hooks", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /saveWorkflowPayloadDraft/);
  assert.match(js, /validateWorkflowPayloadDraft/);
});

test("frontend exposes workflow payload draft summary", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /workflowPayloadDraftSummary/);
  assert.match(js, /父SKU/);
  assert.match(js, /类目/);
  assert.match(js, /变体数/);
  assert.match(css, /workflow-payload-summary/);
});

test("frontend exposes workflow decision hints", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /workflowRiskLabel/);
  assert.match(js, /recommendedActions/);
  assert.match(js, /workflow-decision/);
});

test("frontend reads workflow diagnosis and validation issue fields", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /messageZh/);
  assert.match(js, /fixHints/);
  assert.match(js, /result\.issues/);
});

test("frontend renders workflow pricing diagnosis panel", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderWorkflowPricingDiagnosis/);
  assert.match(js, /pricingDiagnosis/);
  assert.match(js, /采购成本/);
  assert.match(js, /运费等级/);
  assert.match(js, /最低价/);
  assert.match(js, /最低价来源/);
  assert.match(js, /原价策略/);
  assert.match(js, /利润底线/);
  assert.match(js, /PRICING_/);
  assert.match(js, /价格风险/);
  assert.match(js, /accept-pricing-risk/);
  assert.match(js, /recalculate-pricing/);
  assert.match(js, /pricing-risk\/accept/);
  assert.match(js, /pricing-risk\/recalculate/);
  assert.match(css, /workflow-pricing-diagnosis/);
  assert.match(css, /workflow-pricing-risk/);
});

test("pricing diagnosis does not present unverified formula output as realized profit", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /const profitStatus = String\(pricingDiagnosis\.profitStatus \|\| "unknown"\)/);
  assert.match(js, /未知（佣金\/结算证据不足）/);
  assert.match(js, /利润未知（佣金\/结算证据不足）/);
  assert.match(js, /默认比例仅供试算/);
  assert.match(js, /公式结果仅作价格试算，不是确定利润/);
  assert.match(js, /补齐当前店铺\/类目佣金、物流\/结算规则和汇率证据/);
  assert.match(js, /结算\/汇率：/);
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /workflow-pricing-evidence-warning/);
});

test("listing variant prices disclose local trial values instead of implying Ozon effect", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function renderListingVariantsFrom1688");
  const end = js.indexOf("async function renderVariantAspectColumns", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /data-price-source/);
  assert.match(body, /本地试算，未写入 Ozon/);
  assert.match(body, /提交前需确认/);
});

test("frontend renders read-only image quality recommendations", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /imageQualityRecommendations/);
  assert.match(js, /renderListingImageQualityRecommendations/);
  assert.match(js, /图片质量建议/);
  const imageRecommendationSource = js.match(/function renderListingImageQualityRecommendations[\s\S]+?\n}\n\nfunction renderListingQualityPanel/)?.[0] || "";
  assert.ok(imageRecommendationSource);
  assert.doesNotMatch(imageRecommendationSource, /<button/);
  assert.doesNotMatch(imageRecommendationSource, /fetch\(/);
  assert.doesNotMatch(imageRecommendationSource, /data-workflow-action/);
  assert.match(css, /workflow-listing-image-recommendations/);
});

test("frontend renders listing quality field repair panel", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderListingQualityPanel/);
  assert.match(js, /collectListingQualityDiagnosis/);
  assert.match(js, /payloadDraftValidation\?\.listingQuality/);
  assert.match(js, /preflight_check/);
  assert.match(js, /Listing 质量诊断/);
  assert.match(js, /attributeId/);
  assert.match(js, /offerId/);
  assert.match(js, /nextActions/);
  assert.match(js, /listingQualityWarnings/);
  assert.match(js, /只读诊断/);
  assert.match(js, /重新预检/);
  assert.match(js, /renderListingQualityDictionaryCandidates/);
  assert.match(js, /候选字典值/);
  assert.match(js, /dictionaryCandidates/);
  assert.match(js, /ozon_dictionary_cache/);
  assert.match(js, /LISTING_QUALITY_DICTIONARY_VALUE_INVALID/);
  assert.match(js, /LISTING_QUALITY_PRICING_BLOCKED/);
  assert.match(js, /scoreBreakdown/);
  assert.match(js, /listingQualityIsStale/);
  assert.match(js, /qualityStale/);
  assert.match(js, /评分分项/);
  assert.match(js, /分数不替代预检/);
  assert.match(js, /修改后需重新预检/);
  assert.match(js, /重新预检会生成新分数/);
  assert.match(js, /图片与媒体/);
  assert.match(js, /分类属性与变体/);
  assert.match(css, /workflow-listing-quality/);
  assert.match(css, /workflow-listing-quality-issue/);
  assert.match(css, /workflow-listing-quality-breakdown/);
  assert.match(css, /workflow-listing-quality-candidates/);
});

test("frontend renders a read-only listing attribute matrix", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderListingAttributeMatrix/);
  assert.match(js, /attributeMatrix/);
  assert.match(js, /属性矩阵/);
  assert.match(js, /只读矩阵/);
  assert.match(js, /duplicate_variant/);
  assert.match(css, /workflow-attribute-matrix/);
  assert.match(css, /attribute-matrix-cell/);
});

test("frontend renders required attribute fill plan groups", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderRequiredAttributeFillPlan/);
  assert.match(js, /requiredAttributeFillPlan/);
  assert.match(js, /已安全补齐/);
  assert.match(js, /建议确认/);
  assert.match(js, /必须人工处理/);
  assert.match(js, /合规敏感/);
  assert.match(js, /safetyTier/);
  assert.match(js, /安全分层/);
  assert.match(js, /renderRequiredAttributeFillSummary/);
  assert.match(js, /requiredAttributeFillSummary/);
  assert.match(js, /属性覆盖率/);
  assert.match(js, /renderRequiredAttributeManualBacklog/);
  assert.match(js, /requiredAttributeManualBacklog/);
  assert.match(js, /requiredAttributeManualWorkbenchGroups/);
  assert.match(js, /renderRequiredAttributeManualWorkbench/);
  assert.match(js, /人工属性工作台/);
  assert.match(js, /包装尺重证据/);
  assert.match(js, /合规敏感字段/);
  assert.match(js, /手动属性缺口/);
  assert.match(js, /本页只读/);
  assert.match(js, /高频人工属性/);
  assert.match(js, /renderRequiredAttributeRuleCandidateIndex/);
  assert.match(js, /requiredAttributeRuleCandidateIndex/);
  assert.match(js, /规则沉淀候选/);
  assert.match(js, /renderRequiredAttributeRuleCandidateHistory/);
  assert.match(js, /requiredAttributeRuleCandidateHistory/);
  assert.match(js, /summary\?\.requiredAttributeRuleCandidateHistory/);
  assert.match(js, /类目规则池草案/);
  assert.match(js, /renderRequiredAttributeRuleCandidateValues/);
  assert.match(js, /candidateValues/);
  assert.match(js, /候选值/);
  assert.match(js, /可规则化/);
  assert.match(js, /建议换货源/);
  assert.match(js, /禁止猜测/);
  assert.match(js, /candidate-needs-human-confirmation/);
  assert.match(js, /blocked-never-guess/);
  assert.match(js, /不会自动提交 Ozon/);
  assert.match(js, /dictionaryCandidates/);
  const fillSummaryRendererSource = js.match(/function renderRequiredAttributeFillSummary[\s\S]+?\n}\n\nfunction requiredAttributeManualBacklogBucketTitle/)?.[0] || "";
  assert.ok(fillSummaryRendererSource);
  assert.doesNotMatch(fillSummaryRendererSource, /fetch\(/);
  assert.doesNotMatch(fillSummaryRendererSource, /data-workflow-action/);
  const manualBacklogRendererSource = js.match(/function renderRequiredAttributeManualBacklog[\s\S]+?\n}\n\nfunction renderRequiredAttributeRuleCandidateIndex/)?.[0] || "";
  assert.ok(manualBacklogRendererSource);
  assert.doesNotMatch(manualBacklogRendererSource, /fetch\(/);
  assert.doesNotMatch(manualBacklogRendererSource, /data-workflow-action/);
  assert.doesNotMatch(manualBacklogRendererSource, /<button/i);
  assert.doesNotMatch(manualBacklogRendererSource, /<input/i);
  assert.doesNotMatch(manualBacklogRendererSource, /<select/i);
  const ruleCandidateRendererSource = js.match(/function renderRequiredAttributeRuleCandidateIndex[\s\S]+?\n}\n\nfunction renderRequiredAttributeRuleCandidateHistory/)?.[0] || "";
  assert.ok(ruleCandidateRendererSource);
  assert.doesNotMatch(ruleCandidateRendererSource, /fetch\(/);
  assert.doesNotMatch(ruleCandidateRendererSource, /data-workflow-action/);
  const ruleCandidateHistoryRendererSource = js.match(/function renderRequiredAttributeRuleCandidateHistory[\s\S]+?\n}\n\nfunction renderRequiredAttributeFillPlan/)?.[0] || "";
  assert.ok(ruleCandidateHistoryRendererSource);
  assert.doesNotMatch(ruleCandidateHistoryRendererSource, /fetch\(/);
  assert.doesNotMatch(ruleCandidateHistoryRendererSource, /data-workflow-action/);
  assert.doesNotMatch(ruleCandidateHistoryRendererSource, /<button/i);
  assert.doesNotMatch(ruleCandidateHistoryRendererSource, /onclick/i);
  const fillPlanRendererSource = js.match(/function renderRequiredAttributeFillPlan[\s\S]+?\n}\n\nfunction variantWorkbenchStatusText/)?.[0] || "";
  assert.ok(fillPlanRendererSource);
  assert.doesNotMatch(fillPlanRendererSource, /fetch\(/);
  assert.doesNotMatch(fillPlanRendererSource, /data-workflow-action/);
  assert.match(fillPlanRendererSource, /renderRequiredAttributeManualBacklog\(run, node, \{ showWorkbench: false \}\)/);
  assert.match(css, /workflow-required-fill-plan/);
  assert.match(css, /required-attribute-coverage-summary/);
  assert.match(css, /required-attribute-manual-backlog/);
  assert.match(css, /required-attribute-manual-workbench/);
  assert.match(css, /required-attribute-rule-candidate-index/);
  assert.match(css, /required-attribute-rule-candidate-history/);
  assert.match(css, /required-fill-plan-row/);
});

test("required attribute manual backlog groups seller-facing blockers", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const source = js.match(/function requiredAttributeManualWorkbenchGroups[\s\S]+?\n}\n\nfunction renderRequiredAttributeManualBacklog/)?.[0]
    .replace(/\nfunction renderRequiredAttributeManualBacklog$/, "");
  assert.ok(source);
  const requiredAttributeManualWorkbenchGroups = new Function(`${source}\nreturn requiredAttributeManualWorkbenchGroups;`)();
  const textRepairCandidates = [{
    runId: "wr_1",
    nodeKey: "preflight_check",
    offerId: "SKU-1",
    attributeId: 1003,
    attributeName: "Материал",
  }];
  const packageRepairCandidates = [{
    runId: "wr_1",
    nodeKey: "preflight_check",
    offerId: "SKU-PACKAGE",
    packageInfoSource: "1688_package",
    packageInfo: { weight: 650, depth: 220, width: 160, height: 80 },
    missingFields: ["weight", "depth", "width", "height"],
  }];
  const groups = requiredAttributeManualWorkbenchGroups({
    buckets: [
      {
        key: "replace_source",
        items: [
          {
            attributeId: 1001,
            attributeName: "Вес товара",
            strategy: "package_data",
            source: "1688_package_missing",
            reasonZh: "1688 货源缺少尺重。",
          },
          {
            attributeId: 1004,
            attributeName: "Опасный весовой товар",
            action: "blocked_sensitive",
            safetyTier: "blocked-never-guess",
            strategy: "package_data",
            reasonZh: "涉及合规和 вес 字段。",
          },
        ],
      },
      {
        key: "manual_required",
        items: [{
          attributeId: 1002,
          attributeName: "Срок годности",
          action: "blocked_sensitive",
          safetyTier: "blocked-never-guess",
          reasonZh: "涉及合规。",
        }],
      },
      {
        key: "rule_candidate",
        items: [{
          attributeId: 1003,
          attributeName: "Материал",
          action: "manual_required",
          safetyTier: "manual-required",
          reasonZh: "低置信文本。",
        }],
      },
    ],
  }, textRepairCandidates, packageRepairCandidates);

  assert.deepEqual(groups.map((group) => group.key), ["package_evidence", "compliance_sensitive", "manual_value"]);
  assert.equal(groups[0].items[0].mustSupplyText, "1688 或人工实测的包装重量、长宽高、规格证据");
  assert.match(groups[0].items[0].safeNextStep, /更换货源|尺重/);
  assert.equal(groups[0].items[0].repairStatusText, "可确认写入本地草稿");
  assert.deepEqual(groups[0].items[0].textRepairCandidates, []);
  assert.equal(groups[0].items[0].packageEvidence.canWriteDraft, true);
  assert.equal(groups[0].items[0].packageEvidence.statusText, "已有可信尺重证据");
  assert.match(groups[0].items[0].packageEvidence.missingText, /重量/);
  assert.match(groups[0].items[0].packageEvidence.safeSourceAction, /重新采集|人工实测/);
  assert.deepEqual(groups[0].items[0].packageEvidence.payloadTargets.map((target) => target.field), ["weight"]);
  assert.equal(groups[0].items[0].packageEvidence.payloadTargets[0].canWriteDraft, false);
  assert.equal(groups[0].items[0].packageEvidence.payloadTargets[0].path, "\"weight\"");
  assert.equal(groups[0].items[0].packageRepairCandidates[0].offerId, "SKU-PACKAGE");
  assert.equal(groups[0].items[0].packageRepairCandidates[0].packageInfo.weight, 650);
  assert.match(groups[1].items[0].blockReason, /涉及合规/);
  assert.ok(groups[1].items.some((item) => item.attributeId === 1004));
  assert.ok(groups[1].items.every((item) => item.repairStatusText === "暂不可直接填写"));
  assert.match(groups[1].safeNextStep, /不能猜测/);
  assert.match(groups[2].items[0].mustSupplyText, /真实属性值/);
  assert.equal(groups[2].items[0].repairStatusText, "可安全填写");
  assert.equal(groups[2].items[0].textRepairCandidates[0].offerId, "SKU-1");
});

test("listing fill task queue binds manual workbench text repairs only to safe text candidates", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const textRepairSource = js.match(/function listingFillTaskTextRepairCandidates[\s\S]+?\n}\n\nfunction listingFillTaskTextRepairCandidate/)?.[0]
    .replace(/\nfunction listingFillTaskTextRepairCandidate$/, "");
  const workbenchSource = js.match(/function requiredAttributeManualWorkbenchGroups[\s\S]+?\n}\n\nfunction renderRequiredAttributeManualBacklog/)?.[0]
    .replace(/\nfunction renderRequiredAttributeManualBacklog$/, "");
  assert.ok(textRepairSource);
  assert.ok(workbenchSource);
  const exported = new Function(`${textRepairSource}\n${workbenchSource}\nreturn { listingFillTaskTextRepairCandidates, requiredAttributeManualWorkbenchGroups };`)();

  const run = {
    id: "wr_1",
    status: "waiting_human",
    nodes: [{ key: "preflight_check" }],
    payloadDraftValidation: {
      attributeMatrix: {
        rows: [{
          attributeId: 1003,
          name: "Материал",
          cells: [{
            offerId: "SKU-1",
            repairGuidance: {
              canApplyTextDraftRepair: true,
              offerId: "SKU-1",
              attributeId: 1003,
              attributeName: "Материал",
            },
          }],
        }, {
          attributeId: 1002,
          name: "Срок годности",
          cells: [{
            offerId: "SKU-1",
            repairGuidance: {
              canApplyTextDraftRepair: true,
              offerId: "SKU-1",
              attributeId: 1002,
              attributeName: "Срок годности",
            },
          }],
        }],
      },
    },
  };
  const textCandidates = exported.listingFillTaskTextRepairCandidates(run);
  const groups = exported.requiredAttributeManualWorkbenchGroups({
    buckets: [{
      key: "manual_required",
      items: [{
        attributeId: 1002,
        attributeName: "Срок годности",
        action: "blocked_sensitive",
        safetyTier: "blocked-never-guess",
        reasonZh: "涉及合规。",
      }],
    }, {
      key: "rule_candidate",
      items: [{
        attributeId: 1003,
        attributeName: "Материал",
        action: "manual_required",
        safetyTier: "manual-required",
        reasonZh: "低置信文本。",
      }],
    }],
  }, textCandidates);

  assert.equal(textCandidates.length, 2);
  const complianceGroup = groups.find((group) => group.key === "compliance_sensitive");
  const manualGroup = groups.find((group) => group.key === "manual_value");
  assert.equal(complianceGroup.items[0].repairStatusText, "暂不可直接填写");
  assert.deepEqual(complianceGroup.items[0].textRepairCandidates, []);
  assert.equal(manualGroup.items[0].repairStatusText, "可安全填写");
  assert.equal(manualGroup.items[0].textRepairCandidates[0].attributeId, 1003);

  const runningCandidates = exported.listingFillTaskTextRepairCandidates({ ...run, status: "running" });
  assert.equal(runningCandidates.length, 0);
});

test("listing fill task queue extracts trusted package repair candidates only while waiting human", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const source = js.match(/function listingNormalizePackageRepairInfo[\s\S]+?\n}\n\nfunction listingFillTaskPackageRepairCandidate\(/)?.[0]
    .replace(/\nfunction listingFillTaskPackageRepairCandidate\($/, "");
  assert.ok(source);
  const listingFillTaskPackageRepairCandidates = new Function(`${source}\nreturn listingFillTaskPackageRepairCandidates;`)();

  const run = {
    id: "wr_pkg",
    source: "auto_listing",
    status: "waiting_human",
    locks: { waitingHuman: true },
    nodes: [{
      key: "match_profit",
      output: {
        pricingDiagnosis: {
          packageInfoSource: "1688_package",
          package: { weightG: 650, lengthMm: 220, widthMm: 160, heightMm: 80 },
        },
      },
    }, {
      key: "preflight_check",
    }],
    payloadDraft: {
      items: [{
        offer_id: "SKU-PACKAGE",
        weight: "",
        depth: "",
        width: "",
        height: "",
      }],
    },
  };
  const candidates = listingFillTaskPackageRepairCandidates(run);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].runId, "wr_pkg");
  assert.equal(candidates[0].nodeKey, "preflight_check");
  assert.equal(candidates[0].offerId, "SKU-PACKAGE");
  assert.equal(candidates[0].packageInfoSource, "1688_package");
  assert.deepEqual(candidates[0].packageInfo, { weight: 650, depth: 220, width: 160, height: 80 });
  assert.deepEqual(candidates[0].missingFields, ["weight", "depth", "width", "height"]);

  assert.equal(listingFillTaskPackageRepairCandidates({ ...run, status: "running", locks: { waitingHuman: false } }).length, 0);
  assert.equal(listingFillTaskPackageRepairCandidates({
    ...run,
    source: "pdd",
    nodes: [{ key: "match_profit", output: { pricingDiagnosis: { package: { weightG: 650, lengthMm: 220, widthMm: 160, heightMm: 80 } } } }],
  }).length, 0);
  assert.equal(listingFillTaskPackageRepairCandidates({
    ...run,
    nodes: [{ key: "match_profit", output: { pricingDiagnosis: { packageInfoSource: "1688_package", package: { weightG: 0, lengthMm: 220, widthMm: 160, heightMm: 80 } } } }],
  }).length, 0);
});

test("listing center exposes a read-only fill task queue from existing diagnostics", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderListingFillTaskQueue/);
  assert.match(js, /listingFillTaskQueueItems/);
  assert.match(js, /listingFillTaskRepairCandidate/);
  assert.match(js, /listingFillTaskDictionaryRepairCandidates/);
  assert.match(js, /listingFillTaskTextRepairCandidate/);
  assert.match(js, /listingFillTaskTextRepairCandidates/);
  assert.match(js, /listingFillTaskPackageRepairCandidates/);
  assert.match(js, /listingFillTaskPackageRepairCandidate/);
  assert.match(js, /listingFillTaskVariantTextRepairCandidate/);
  assert.match(js, /listingRequiredAttributeConfirmationItems/);
  assert.match(js, /requiredAttributeManualBacklog/);
  assert.match(js, /manualAttributeWorkbenchGroups/);
  assert.match(js, /renderRequiredAttributeManualWorkbench/);
  assert.match(js, /listingVariantCoverageTaskText/);
  assert.match(js, /listingFillTaskVariantAspectSuggestion/);
  assert.match(js, /listingVariantAspectContext/);
  assert.match(js, /waitingHuman/);
  assert.match(js, /requiredAttributeFillPlan/);
  assert.match(js, /variantConfiguration/);
  assert.match(js, /listingQuality/);
  assert.match(js, /data-listing-task-view/);
  assert.match(js, /data-listing-task-run-id/);
  assert.match(js, /data-listing-task-node-key/);
  assert.match(js, /data-workflow-action="apply-attribute-dictionary-repair"/);
  assert.match(js, /data-workflow-action="apply-attribute-text-repair"/);
  assert.match(js, /data-workflow-action="apply-variant-text-repair"/);
  assert.match(js, /确认写入草稿并预检/);
  assert.match(js, /填写该 SKU 文本并预检/);
  assert.doesNotMatch(js, />填写文本属性并预检<\/button>/);
  assert.match(js, /可安全填写/);
  assert.match(js, /需补证据，不可猜填/);
  assert.match(js, /证据状态/);
  assert.match(js, /证据来源/);
  assert.match(js, /packageEvidence/);
  assert.match(js, /payloadTargets/);
  assert.match(js, /定位包装字段/);
  assert.match(js, /data-payload-path="\$\{escapeHtml\(target\.path \|\| ""\)\}"/);
  assert.match(js, /#listingStagePanels \[data-payload-path\]/);
  assert.match(js, /focusWorkflowPayloadIssue\(listingPayloadLocatorTarget\)/);
  assert.match(js, /data-workflow-action="apply-package-info-repair"/);
  assert.match(js, /确认写入尺重并预检/);
  assert.match(js, /repairType: "package_info"/);
  assert.match(js, /data-repair-package-weight/);
  assert.match(js, /data-repair-package-source/);
  assert.match(js, /填写变体文本并预检/);
  assert.match(js, /待确认字典候选/);
  assert.match(js, /候选值/);
  assert.match(js, /来源/);
  assert.match(js, /置信度/);
  assert.match(js, /可安全写回/);
  assert.match(js, /暂不可直接写回/);
  assert.match(js, /属性覆盖/);
  assert.match(js, /SKU 图区分/);
  assert.match(js, /变体属性修复建议/);
  assert.match(js, /data-listing-variant-suggestion-copy/);
  assert.match(js, /查看变体工作簿/);
  assert.match(js, /受影响 SKU/);
  assert.match(js, /为什么卡住/);
  assert.match(js, /属性 ID/);
  assert.match(js, /listing-variant-context-list/);
  assert.match(css, /listing-fill-task-queue/);
  assert.match(css, /listing-fill-task-card/);
  assert.match(css, /listing-attribute-confirmation-list/);
  assert.match(css, /listing-variant-suggestion/);
  assert.match(css, /listing-variant-context-list/);
  assert.match(css, /required-attribute-package-evidence/);
  assert.match(css, /required-attribute-package-targets/);
});

test("listing fill task queue extracts required attribute confirmation items", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const source = js.match(/function listingRequiredAttributeConfirmationItems[\s\S]+?\n}\n\nfunction listingFillTaskQueueItems/)?.[0]
    .replace(/\nfunction listingFillTaskQueueItems$/, "");
  assert.ok(source);
  const listingRequiredAttributeConfirmationItems = new Function(`${source}\nreturn listingRequiredAttributeConfirmationItems;`)();

  const items = listingRequiredAttributeConfirmationItems([
    {
      attributeId: 777,
      attributeName: "Материал",
      action: "suggest_dictionary",
      safetyLabelZh: "候选需确认",
      safeNextStep: "人工确认后写回本地草稿并重新预检。",
      reasonZh: "根据材质同义词匹配。",
      dictionaryCandidates: [
        { dictionaryValueId: 11, value: "пластик", confidence: 0.72, source: "material_synonym" },
      ],
    },
    {
      attributeId: 85,
      attributeName: "Бренд",
      action: "auto_fill",
      dictionaryCandidates: [{ dictionaryValueId: 22, value: "Нет бренда" }],
    },
    {
      attributeId: 999,
      attributeName: "危险等级",
      action: "blocked_sensitive",
      dictionaryCandidates: [{ dictionaryValueId: 33, value: "A" }],
    },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].attributeId, 777);
  assert.equal(items[0].attributeName, "Материал");
  assert.equal(items[0].candidateText, "#11 пластик");
  assert.equal(items[0].sourceText, "material_synonym");
  assert.equal(items[0].confidenceText, "72%");
  assert.match(items[0].reason, /必须人工确认/);
  assert.equal(items[0].matchReason, "根据材质同义词匹配。");
  assert.equal(items[0].repairStatusText, "暂不可直接写回");
  assert.equal(items[0].repairCandidate, null);
  assert.match(items[0].safeNextStep, /重新预检/);
  assert.match(items[0].copyText, /Материал/);
  assert.match(items[0].copyText, /匹配线索：根据材质同义词匹配。/);
  assert.match(items[0].copyText, /不会自动写 Payload/);
});

test("listing fill task queue binds confirmation items to matching repair candidates only", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const repairSource = js.match(/function listingFillTaskDictionaryRepairCandidates[\s\S]+?\n}\n\nfunction listingFillTaskRepairCandidate/)?.[0]
    .replace(/\nfunction listingFillTaskRepairCandidate$/, "");
  const confirmationSource = js.match(/function listingRequiredAttributeConfirmationItems[\s\S]+?\n}\n\nfunction listingFillTaskQueueItems/)?.[0]
    .replace(/\nfunction listingFillTaskQueueItems$/, "");
  assert.ok(repairSource);
  assert.ok(confirmationSource);
  const exported = new Function(`${repairSource}\n${confirmationSource}\nreturn { listingFillTaskDictionaryRepairCandidates, listingRequiredAttributeConfirmationItems };`)();

  const run = {
    id: "wr_1",
    status: "waiting_human",
    nodes: [{ key: "preflight_check" }],
    payloadDraftValidation: {
      attributeMatrix: {
        rows: [{
          attributeId: 777,
          name: "Материал",
          cells: [{
            offerId: "SKU-1",
            repairGuidance: {
              canApplyLocalDraftRepair: true,
              offerId: "SKU-1",
              attributeId: 777,
              attributeName: "Материал",
              dictionaryCandidates: [
                { dictionary_value_id: 10, value: "металл" },
                { dictionary_value_id: 11, value: "пластик" },
              ],
            },
          }],
        }],
      },
    },
  };
  const repairCandidates = exported.listingFillTaskDictionaryRepairCandidates(run);
  const items = exported.listingRequiredAttributeConfirmationItems([
    {
      attributeId: 777,
      attributeName: "Материал",
      action: "suggest_dictionary",
      dictionaryCandidates: [
        { dictionaryValueId: 11, value: "пластик", confidence: 0.72, source: "material_synonym" },
      ],
    },
    {
      attributeId: 778,
      attributeName: "Тип",
      action: "suggest_dictionary",
      dictionaryCandidates: [
        { dictionaryValueId: 22, value: "органайзер", confidence: 0.7, source: "type_synonym" },
      ],
    },
    {
      attributeId: 779,
      attributeName: "Назначение",
      action: "suggest_dictionary",
      dictionaryCandidates: [
        { dictionaryValueId: 11, value: "пластик", confidence: 0.7, source: "purpose_synonym" },
      ],
    },
    {
      attributeId: 777,
      attributeName: "Материал",
      action: "suggest_dictionary",
      dictionaryCandidates: [
        { dictionaryValueId: 12, value: "силикон", confidence: 0.7, source: "material_synonym" },
      ],
    },
  ], repairCandidates);

  assert.equal(repairCandidates.length, 2);
  assert.equal(items[0].repairStatusText, "可安全写回");
  assert.equal(items[0].repairCandidate.offerId, "SKU-1");
  assert.equal(items[0].repairCandidate.attributeId, 777);
  assert.equal(items[0].repairCandidate.dictionaryValueId, 11);
  assert.match(items[0].safeNextStep, /SKU-1/);
  assert.equal(items[1].repairCandidate, null);
  assert.equal(items[1].repairStatusText, "暂不可直接写回");
  assert.match(items[1].safeNextStep, /属性矩阵/);
  assert.equal(items[2].repairCandidate, null);
  assert.equal(items[2].repairStatusText, "暂不可直接写回");
  assert.equal(items[3].repairCandidate, null);
  assert.equal(items[3].repairStatusText, "暂不可直接写回");

  const runningRepairCandidates = exported.listingFillTaskDictionaryRepairCandidates({ ...run, status: "running" });
  const runningItems = exported.listingRequiredAttributeConfirmationItems([
    {
      attributeId: 777,
      attributeName: "Материал",
      action: "suggest_dictionary",
      dictionaryCandidates: [
        { dictionaryValueId: 11, value: "пластик", confidence: 0.72, source: "material_synonym" },
      ],
    },
  ], runningRepairCandidates);
  assert.equal(runningRepairCandidates.length, 0);
  assert.equal(runningItems[0].repairCandidate, null);
  assert.equal(runningItems[0].repairStatusText, "暂不可直接写回");
});

test("listing fill dictionary repair candidates preserve source spec dictionary matches", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const repairSource = js.match(/function listingFillTaskDictionaryRepairCandidates[\s\S]+?\n}\n\nfunction listingFillTaskRepairCandidate/)?.[0]
    .replace(/\nfunction listingFillTaskRepairCandidate$/, "");
  assert.ok(repairSource);
  const listingFillTaskDictionaryRepairCandidates = new Function(`${repairSource}\nreturn listingFillTaskDictionaryRepairCandidates;`)();

  const candidates = listingFillTaskDictionaryRepairCandidates({
    id: "wr_dict_variant",
    status: "waiting_human",
    locks: { waitingHuman: true },
    nodes: [{ key: "preflight_check" }],
    payloadDraftValidation: {
      attributeMatrix: {
        rows: [{
          attributeId: 10097,
          name: "Название цвета",
          aspect: true,
          dictionary: true,
          cells: [{
            offerId: "SKU-WHITE-DICT",
            status: "missing",
            repairGuidance: {
              canApplyLocalDraftRepair: true,
              offerId: "SKU-WHITE-DICT",
              attributeId: 10097,
              attributeName: "Название цвета",
              dictionaryCandidates: [{
                dictionary_value_id: 111,
                value: "белый",
                source: "1688_sku_spec_dictionary_match",
                sourceValue: "белый",
                sourceVariantSpec: "白色",
              }],
            },
          }],
        }],
      },
    },
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceSuggestedAspect, true);
  assert.equal(candidates[0].sourceVariantSpec, "白色");
  assert.equal(candidates[0].sourceValue, "белый");
});

test("listing variant aspect suggestion carries SKU aspect repair context", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const contextSource = js.match(/function listingVariantAspectContext[\s\S]+?\n}\n\nfunction listingFillTaskVariantAspectSuggestion/)?.[0]
    .replace(/\nfunction listingFillTaskVariantAspectSuggestion$/, "");
  const suggestionSource = js.match(/function listingFillTaskVariantAspectSuggestion[\s\S]+?\n}\n\nfunction listingFillTaskQueueItems/)?.[0]
    .replace(/\nfunction listingFillTaskQueueItems$/, "");
  assert.ok(contextSource);
  assert.ok(suggestionSource);
  const listingFillTaskVariantAspectSuggestion = new Function(`${contextSource}\n${suggestionSource}\nreturn listingFillTaskVariantAspectSuggestion;`)();
  const suggestion = listingFillTaskVariantAspectSuggestion({
    rows: [{
      offerId: "SKU-RED",
      rowStatus: "duplicate_aspect",
      aspects: [{ id: 10097, name: "颜色名称", value: "red" }],
      reasons: [{ code: "DUPLICATE_ASPECT", message: "颜色与另一 SKU 重复" }],
      safeNextAction: "改成唯一颜色后重新预检",
    }],
  });

  assert.equal(suggestion.variantAspectContexts[0].offerId, "SKU-RED");
  assert.equal(suggestion.variantAspectContexts[0].aspectName, "颜色名称");
  assert.equal(suggestion.variantAspectContexts[0].aspectId, 10097);
  assert.match(suggestion.variantAspectContexts[0].reason, /重复/);
  assert.match(suggestion.copyText, /SKU-RED/);
  assert.match(suggestion.copyText, /属性 ID 10097/);
  assert.match(suggestion.copyText, /重新预检/);
});

test("listing fill task variant text repair can use source SKU spec suggestion", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const candidateSource = js.match(/function listingFillTaskVariantTextRepairCandidate[\s\S]+?\n}\n\nfunction listingNormalizePackageRepairInfo/)?.[0]
    .replace(/\nfunction listingNormalizePackageRepairInfo$/, "");
  assert.ok(candidateSource);
  const listingFillTaskVariantTextRepairCandidate = new Function(`${candidateSource}\nreturn listingFillTaskVariantTextRepairCandidate;`)();

  const candidate = listingFillTaskVariantTextRepairCandidate({
    id: "wr_variant_suggest",
    status: "waiting_human",
    locks: { waitingHuman: true },
    nodes: [{ key: "preflight_check" }],
    payloadDraftValidation: {
      attributeMatrix: {
        rows: [{
          attributeId: 11001,
          name: "Количество в комплекте",
          aspect: true,
          dictionary: false,
          cells: [{
            offerId: "SKU-WHITE-2",
            status: "missing",
            repairGuidance: {
              canApplyVariantTextDraftRepair: true,
              offerId: "SKU-WHITE-2",
              attributeId: 11001,
              attributeName: "Количество в комплекте",
            },
          }],
        }],
      },
      variantConfiguration: {
        rows: [{
          offerId: "SKU-WHITE-2",
          sourceVariant: { spec: "2 шт" },
          suggestedAspects: [{
            attributeId: 11001,
            attributeName: "Количество в комплекте",
            value: "2 шт",
            source: "1688_sku_spec",
            readOnly: true,
          }],
        }],
      },
    },
  });

  assert.equal(candidate.suggestedValue, "2 шт");
  assert.equal(candidate.sourceSuggestedAspect, true);
  assert.equal(candidate.sourceVariantSpec, "2 шт");
  assert.match(candidate.safeNextStep, /人工确认/);

  const dictionaryCandidate = listingFillTaskVariantTextRepairCandidate({
    id: "wr_variant_dict",
    status: "waiting_human",
    locks: { waitingHuman: true },
    nodes: [{ key: "preflight_check" }],
    payloadDraftValidation: {
      attributeMatrix: {
        rows: [{
          attributeId: 10097,
          name: "Название цвета",
          aspect: true,
          dictionary: true,
          cells: [{
            offerId: "SKU-WHITE",
            status: "missing",
            repairGuidance: {
              canApplyVariantTextDraftRepair: false,
              offerId: "SKU-WHITE",
              attributeId: 10097,
              attributeName: "Название цвета",
            },
          }],
        }],
      },
      variantConfiguration: {
        rows: [{
          offerId: "SKU-WHITE",
          suggestedAspects: [{
            attributeId: 10097,
            value: "белый",
            source: "1688_sku_spec",
            readOnly: true,
          }],
        }],
      },
    },
  });

  assert.equal(dictionaryCandidate, null);
});

test("frontend renders read-only variant configuration workbench", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderVariantConfigurationWorkbench/);
  assert.match(js, /variantConfiguration/);
  assert.match(js, /变体配置工作簿/);
  assert.match(js, /变体覆盖摘要/);
  assert.match(js, /repairSuggestions/);
  assert.match(js, /只读修复建议/);
  assert.match(js, /renderVariantRepairSuggestions/);
  assert.match(js, /renderVariantSuggestedAspects/);
  assert.match(js, /suggestedAspects/);
  assert.match(js, /1688 规格候选/);
  assert.match(js, /sourceVariant/);
  assert.match(js, /differenceSuggestions/);
  assert.match(js, /整组差异建议/);
  assert.match(js, /renderVariantGroupDifferenceSuggestions/);
  assert.match(js, /repairTargets/);
  assert.match(js, /data-variant-difference-copy/);
  assert.match(js, /整组修复说明/);
  assert.match(js, /定位该差异字段/);
  const repairRendererSource = js.match(/function renderVariantRepairSuggestions[\s\S]+?\n}\n\nfunction renderVariantGroupDifferenceSuggestions/)?.[0] || "";
  assert.ok(repairRendererSource);
  assert.doesNotMatch(repairRendererSource, /<button/);
  assert.doesNotMatch(repairRendererSource, /data-workflow-action/);
  assert.doesNotMatch(repairRendererSource, /fetch\(/);
  assert.match(repairRendererSource, /renderVariantSuggestedAspects/);
  const suggestedAspectsRendererSource = js.match(/function renderVariantSuggestedAspects[\s\S]+?\n}\n\nfunction renderVariantRepairSuggestions/)?.[0] || "";
  assert.ok(suggestedAspectsRendererSource);
  assert.doesNotMatch(suggestedAspectsRendererSource, /<button/);
  assert.doesNotMatch(suggestedAspectsRendererSource, /data-workflow-action/);
  assert.doesNotMatch(suggestedAspectsRendererSource, /fetch\(/);
  const differenceRendererSource = js.match(/function renderVariantGroupDifferenceSuggestions[\s\S]+?\n}\n\nfunction renderVariantConfigurationWorkbench/)?.[0] || "";
  assert.ok(differenceRendererSource);
  assert.doesNotMatch(differenceRendererSource, /<button/);
  assert.doesNotMatch(differenceRendererSource, /data-workflow-action/);
  assert.doesNotMatch(differenceRendererSource, /fetch\(/);
  assert.match(differenceRendererSource, /workflow-payload-locator/);
  assert.match(differenceRendererSource, /data-payload-path/);
  assert.match(differenceRendererSource, /data-payload-offer-id/);
  assert.match(differenceRendererSource, /data-payload-attribute-id/);
  assert.match(differenceRendererSource, /data-variant-difference-copy/);
  assert.match(js, /aspectCoveredRowCount/);
  assert.match(js, /duplicateAspectRowCount/);
  assert.match(js, /missingAspectRowCount/);
  assert.match(js, /uniqueSkuImageRowCount/);
  assert.match(js, /nonUniqueSkuImageRowCount/);
  assert.match(js, /missingSkuImageRowCount/);
  assert.match(js, /suggestedAspectRowCount/);
  assert.match(js, /suggestedAspectCount/);
  assert.match(js, /readinessStatus/);
  assert.match(js, /SKU 图/);
  assert.match(js, /可变特性/);
  assert.match(js, /重复组合/);
  assert.match(js, /只读工作簿/);
  assert.match(js, /重新预检/);
  assert.match(js, /定位该 SKU 属性/);
  assert.match(js, /variantWorkbenchPayloadPath/);
  assert.match(js, /variantWorkbenchPrimaryAspect/);
  assert.match(js, /workflowPayloadLocateIndex/);
  assert.match(js, /data-payload-path/);
  assert.match(js, /data-payload-offer-id/);
  assert.match(js, /data-payload-attribute-id/);
  assert.match(js, /仅定位，不修改数据/);
  assert.match(css, /workflow-variant-workbench/);
  assert.match(css, /variant-workbench-row/);
  assert.match(css, /variant-group-difference-suggestions/);
  assert.match(css, /variant-group-difference-targets/);
});

test("workflow payload locator targets aspect id inside the same SKU slice", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const locatorSource = js.match(/function workflowPayloadLocateIndex[\s\S]+?\n}\n\nfunction highlightWorkflowPayloadEditor/)?.[0]
    .replace(/\nfunction highlightWorkflowPayloadEditor$/, "");
  const escapeSource = js.match(/function escapeWorkflowPayloadRegex[\s\S]+?\n}\n\nfunction highlightWorkflowPayloadEditor/)?.[0]
    .replace(/\nfunction highlightWorkflowPayloadEditor$/, "");
  assert.ok(locatorSource);
  assert.ok(escapeSource);
  const workflowPayloadLocateIndex = new Function(`${escapeSource}\n${locatorSource}\nreturn workflowPayloadLocateIndex;`)();
  const payload = JSON.stringify({
    items: [
      { offer_id: "SKU-A", attributes: [{ id: 111, values: [{ value: "red" }] }] },
      { offer_id: "SKU-B", attributes: [{ id: 222, values: [{ value: "blue" }] }] },
    ],
  }, null, 2);

  assert.equal(payload.slice(workflowPayloadLocateIndex(payload, "SKU-B", "SKU-B", "222"), workflowPayloadLocateIndex(payload, "SKU-B", "SKU-B", "222") + 3), "222");
  assert.equal(payload.slice(workflowPayloadLocateIndex(payload, "SKU-B", "SKU-B", "111"), workflowPayloadLocateIndex(payload, "SKU-B", "SKU-B", "111") + 5), "SKU-B");
  const specialPayload = '{"items":[{"offer_id":"SKU-C","attributes":[{"id":"88.1"}]}]}';
  assert.equal(specialPayload.slice(workflowPayloadLocateIndex(specialPayload, "SKU-C", "SKU-C", "88.1"), workflowPayloadLocateIndex(specialPayload, "SKU-C", "SKU-C", "88.1") + 4), "88.1");
});

test("frontend exposes human repair entrypoints from listing attribute matrix cells", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderListingAttributeCellRepair/);
  assert.match(js, /repairGuidance/);
  assert.match(js, /人工修复入口/);
  assert.match(js, /data-payload-path/);
  assert.match(js, /copy-repair-template/);
  assert.match(js, /不会自动提交 Ozon/);
  assert.match(css, /attribute-matrix-repair/);
});

test("frontend can apply a confirmed attribute dictionary repair to local draft only", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /apply-attribute-dictionary-repair/);
  assert.match(js, /confirmLocalDraftRepair/);
  assert.match(js, /payload-draft\/attribute-repair/);
  assert.match(js, /应用到草稿并预检/);
  assert.match(js, /不会提交 Ozon/);
});

test("frontend can prompt for a confirmed missing text attribute repair", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /apply-attribute-text-repair/);
  assert.match(js, /canApplyTextDraftRepair/);
  assert.match(js, /repairType: "text_value"/);
  assert.match(js, /填写文本属性/);
  assert.match(js, /不会提交 Ozon/);
});

test("frontend can prompt for a confirmed missing variant text aspect repair", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /apply-variant-text-repair/);
  assert.match(js, /canApplyVariantTextDraftRepair/);
  assert.match(js, /repairType: "variant_text_value"/);
  assert.match(js, /listingFillTaskVariantTextRepairCandidate/);
  assert.match(js, /sourceSuggestedAspect/);
  assert.match(js, /data-repair-value/);
  assert.match(js, /填写变体文本/);
  assert.match(js, /不会提交 Ozon/);
});

test("frontend exposes payload issue field locator", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /workflowPayloadIssueLocator/);
  assert.match(js, /MISSING_MODEL_NAME/);
  assert.match(js, /data-payload-path/);
  assert.match(js, /定位字段/);
});

test("frontend exposes payload issue summary by code", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /workflowPayloadIssueSummary/);
  assert.match(js, /按错误码汇总/);
  assert.match(js, /规则\//);
});

test("frontend highlights payload issue target after locating", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /highlightWorkflowPayloadEditor/);
  assert.match(js, /scrollIntoView/);
  assert.match(js, /payload-located/);
  assert.match(css, /payload-located/);
});

test("frontend exposes controlled chain result panel", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /workflowControlledChainResultPanel/);
  assert.match(js, /链路结果/);
  assert.match(js, /查看步骤明细/);
  assert.match(js, /workflow-chain-result-summary/);
  assert.match(js, /真实执行/);
  assert.match(js, /仅记录/);
  assert.match(css, /workflow-chain-result/);
  assert.match(css, /workflow-chain-result-summary/);
});

test("frontend exposes workflow node IO summary cards", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /workflowNodeIoSummary/);
  assert.match(js, /输入摘要/);
  assert.match(js, /输出摘要/);
  assert.match(js, /问题数/);
  assert.match(css, /workflow-io-summary/);
});

test("frontend exposes payload issue repair templates", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /workflowPayloadRepairTemplate/);
  assert.match(js, /9048/);
  assert.match(js, /自动修复建议/);
  assert.match(js, /建议值/);
  assert.match(js, /复制建议/);
  assert.match(css, /workflow-payload-copy/);
});

test("frontend exposes workflow event timeline", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /workflow-event-log/);
  assert.match(js, /workflowEventLabel/);
  assert.match(js, /retry_requested/);
});

test("frontend displays workflow continue execution feedback", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /workflowEventExecutionBadge/);
  assert.match(js, /真实执行/);
  assert.match(js, /仅记录/);
  assert.match(js, /workflowEventActionText/);
  assert.match(css, /workflow-event-meta/);
  assert.match(css, /workflow-event-badge/);
});

test("frontend exposes workflow lock state", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /workflowLockBadges/);
  assert.match(js, /waitingHuman/);
  assert.match(js, /submitLocked/);
  assert.match(js, /lockedWaitingHuman/);
  assert.match(js, /lockedPaused/);
  assert.match(js, /workflow-locks/);
});

test("frontend exposes workflow manual intervention actions", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /request-new-source/);
  assert.match(js, /manual-fix-retry/);
  assert.match(js, /confirm-continue/);
  assert.match(js, /continue-node/);
  assert.match(js, /new_source_requested/);
  assert.match(js, /manual_continue_confirmed/);
  assert.match(js, /continue_requested/);
  assert.match(js, /workflowNewSourceToast/);
  assert.match(js, /replacementCrawlerTaskIds/);
  assert.match(css, /workflow-manual-panel/);
});

test("frontend exposes controlled workflow chain action", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /controlled-chain/);
  assert.match(js, /受控跑到总闸/);
  assert.match(js, /未触发 Ozon 提交/);
});

test("frontend exposes payload draft submit safety action", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /submit-payload-draft/);
  assert.match(js, /确认提交 Ozon/);
  assert.match(js, /payload-draft\/submit/);
  assert.match(js, /confirmSubmit/);
  assert.match(js, /submissionReservation\?\.state/);
  assert.match(js, /此前已提交 Ozon task/);
  assert.match(js, /结果未知，先人工回查/);
  assert.match(js, /workflow-submit-state-hint/);
});

test("frontend displays automation safety mode in flow status", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /automationSafetyText/);
  assert.match(js, /observe_only/);
});

test("frontend exposes workflow run summaries", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /workflowRunSummaryText/);
  assert.match(js, /workflowRunCopySummaryText/);
  assert.match(js, /复制工作流摘要/);
  assert.match(js, /工作流摘要已复制/);
  assert.match(js, /blockingNodeName/);
  assert.match(js, /workflow-run-summary/);
  assert.match(css, /workflow-detail-head-actions/);
});

test("frontend can expose match profit workflow diagnostics", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /节点输出/);
  assert.match(js, /JSON\.stringify\(node\.output/);
});

test("frontend can expose content generation workflow diagnostics", async () => {
  const [js, workflowRuns] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/workflowRuns.js", import.meta.url), "utf8"),
  ]);

  assert.match(js, /节点输出/);
  assert.match(workflowRuns, /titleRu/);
  assert.match(workflowRuns, /attributeHintKeys/);
  assert.match(workflowRuns, /contentIssues/);
});

test("auto listing blocks Ozon submission on preflight gate failure", async () => {
  const autoListing = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");

  assert.match(autoListing, /buildPreflightGateNode/);
  assert.match(autoListing, /preflight_blocked/);
  assert.match(autoListing, /if \(!preflightNode\.output\.ok\)/);
});

test("workflow exposes Ozon review reconcile diagnostics", async () => {
  const [autoListing, workflowRuns] = await Promise.all([
    readFile(new URL("../src/autoListing.js", import.meta.url), "utf8"),
    readFile(new URL("../src/workflowRuns.js", import.meta.url), "utf8"),
  ]);

  assert.match(autoListing, /workflowReviewReconcileNode/);
  assert.match(workflowRuns, /importedCount/);
  assert.match(workflowRuns, /warningCount/);
  assert.match(workflowRuns, /errorCount/);
  assert.match(workflowRuns, /reasonCode/);
});

test("workflow exposes Ozon learning and keyword expansion diagnostics", async () => {
  const [ozonLearning, workflowRuns] = await Promise.all([
    readFile(new URL("../src/ozonLearning.js", import.meta.url), "utf8"),
    readFile(new URL("../src/workflowRuns.js", import.meta.url), "utf8"),
  ]);

  assert.match(ozonLearning, /emitOzonLearningWorkflowNode/);
  assert.match(ozonLearning, /ozonLearningTaskId/);
  assert.match(workflowRuns, /sourceText/);
  assert.match(workflowRuns, /keywordCount/);
  assert.match(workflowRuns, /totalFound/);
  assert.match(workflowRuns, /categoryCounts/);
});

test("frontend exposes workflow health summary cards", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /workflowSummaryCards/);
  assert.match(js, /renderWorkflowSummaryCards/);
  assert.match(js, /workflowSummary/);
});

test("frontend exposes ERP module ownership and Ozon API coverage panels", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /moduleOwnershipGrid/);
  assert.match(html, /sellerApiCoverageGrid/);
  assert.match(html, /sellerApiGapGrid/);
  assert.match(js, /ERP_MODULE_OWNERSHIP/);
  assert.match(js, /OZON_SELLER_API_ALIGNMENT/);
  assert.match(js, /OZON_SELLER_API_GAP_BACKLOG/);
  assert.match(js, /renderErpModuleOwnership/);
  assert.match(js, /已对齐/);
  assert.match(js, /部分对齐/);
  assert.match(js, /本地逻辑/);
  assert.match(js, /payload-draft-submit/);
  assert.match(js, /P0/);
  assert.match(css, /module-ownership-grid/);
  assert.match(css, /api-coverage-card/);
  assert.match(css, /seller-api-gap-grid/);
  assert.match(css, /api-gap-card/);
});

test("FBS coverage panel names v4 as canonical and keeps incomplete coverage visible", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const mapStart = js.indexOf("const OZON_SELLER_API_ALIGNMENT");
  const start = js.indexOf('area: "订单履约"', mapStart);
  const end = js.indexOf('area: "营销活动"', start);
  assert.ok(start >= 0 && end > start, "FBS coverage entry exists");
  const entry = js.slice(start, end);
  assert.match(entry, /status: "迁移审计"/);
  assert.match(entry, /\/v4\/posting\/fbs\/list/);
  assert.match(entry, /cursor/);
  assert.match(entry, /v4 cursor/);
  assert.doesNotMatch(entry, /订单页仍使用旧 offset/);
  assert.match(entry, /完整覆盖和真实账号回放仍需确认/);
});

test("FBS order screen exposes the v4 cursor read contract before a seller reads orders", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  const start = html.indexOf('id="fbsApiMigrationNotice"');
  const end = html.indexOf('id="orderBatchStatus"', start);
  assert.ok(start >= 0 && end > start, "FBS migration notice is visible before batch status");
  const notice = html.slice(start, end);
  assert.match(notice, /v4 cursor/);
  assert.match(notice, /sort_dir/);
  assert.match(notice, /真实只读回查/);
  assert.match(notice, /真实只读回查/);
  assert.match(notice, /不会执行备货、发运或取消/);
  assert.match(js, /const responseScope = data\.requestScope \|\| \{\}/);
  assert.match(js, /String\(responseScope\.since \|\| ""\)/);
  assert.match(js, /String\(responseScope\.to \|\| ""\)/);
  assert.match(js, /String\(responseScope\.status \|\| ""\)/);
  assert.match(js, /responseWarehouseId === String\(scope\.warehouseId \|\| ""\)/);
  assert.match(js, /String\(responseScope\.sortDir \|\| ""\)/);
});

test("FBS order status counts disclose batch scope when cursor coverage is incomplete", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /orderCountScopeHint/);
  assert.match(js, /dataset\.scope/);
  assert.match(js, /上方状态数量仅代表当前已读取批次/);
  assert.match(js, /tab\.dataset\.countScope = incomplete \? "current_batch"/);
  assert.match(js, /本批 \$\{value\}/);
});

test("frontend exposes workflow filter chips", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /workflowFilterChips/);
  assert.match(js, /workflowRunMatchesFilter/);
  assert.match(js, /workflow-filter-chip/);
});

test("listing center exposes read-only required attribute rule pool workbench", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /listingRulePoolWorkbench/);
  assert.match(html, /规则审查池/);
  const listingSectionStart = html.indexOf("<section id=\"listing\"");
  const workflowSectionStart = html.indexOf("<section id=\"workflow-console\"");
  const listingRulePoolIndex = html.indexOf("id=\"listingRulePoolWorkbench\"");
  assert.ok(listingSectionStart >= 0);
  assert.ok(workflowSectionStart >= 0);
  assert.ok(listingRulePoolIndex > listingSectionStart);
  assert.doesNotMatch(html.slice(workflowSectionStart, listingSectionStart), /RulePoolWorkbench|规则审查池/);
  assert.match(js, /rulePoolFilter/);
  assert.match(js, /collectRequiredAttributeRulePool/);
  assert.match(js, /renderListingRequiredAttributeRulePoolWorkbench/);
  assert.match(js, /requiredAttributeRuleCandidateHistory/);
  assert.match(js, /approvalDraftQueue/);
  assert.match(js, /ruleApprovalAuditIntents/);
  assert.match(js, /loadRuleApprovalAuditIntents/);
  assert.match(js, /\/api\/listing-rule-approval-audit\/intents\?limit=200/);
  assert.match(js, /rulePublishReviewIntents/);
  assert.match(js, /loadRulePublishReviewIntents/);
  assert.match(js, /\/api\/listing-rule-publish-review\/intents\?limit=200/);
  assert.match(js, /collectRuleApprovalAuditIntentsByCandidate/);
  assert.match(js, /collectRulePublishReviewIntentsByCandidate/);
  assert.match(js, /strictRuleApprovalAuditCandidateKey/);
  assert.match(js, /evaluateRulePublishGate/);
  assert.match(js, /renderRulePublishGate/);
  assert.match(js, /renderRulePublishReviewLog/);
  assert.match(js, /ready_for_publish_review/);
  assert.match(js, /publish_blocked/);
  assert.match(js, /needs_evidence/);
  assert.match(js, /canEnableRule: false/);
  assert.match(js, /canWritePayload: false/);
  const strictAuditKeySource = js.match(/function strictRuleApprovalAuditCandidateKey[\s\S]+?\n}\n\nfunction collectRuleApprovalAuditIntentsByCandidate/)?.[0] || "";
  assert.ok(strictAuditKeySource);
  assert.match(strictAuditKeySource, /!categoryKey \|\| !attributeId/);
  const auditCollectorSource = js.match(/function collectRuleApprovalAuditIntentsByCandidate[\s\S]+?\n}\n\nfunction collectRequiredAttributeRulePool/)?.[0] || "";
  assert.ok(auditCollectorSource);
  assert.doesNotMatch(auditCollectorSource, /attributeName/);
  const publishReviewCollectorSource = js.match(/function collectRulePublishReviewIntentsByCandidate[\s\S]+?\n}\n\nfunction collectRequiredAttributeRulePool/)?.[0] || "";
  assert.ok(publishReviewCollectorSource);
  assert.match(publishReviewCollectorSource, /strictRuleApprovalAuditCandidateKey/);
  assert.doesNotMatch(publishReviewCollectorSource, /attributeName/);
  assert.match(js, /人工批准草案/);
  assert.match(js, /审计记录/);
  assert.match(js, /发布复核记录/);
  assert.match(js, /stored_for_review/);
  assert.match(js, /stored_for_publish_review/);
  assert.match(js, /review_only_not_enabled/);
  assert.match(js, /no_rule_or_payload_effect/);
  assert.match(js, /draftWrite/);
  assert.match(js, /ruleEnable/);
  assert.match(js, /回滚方案/);
  assert.match(js, /只读发布闸/);
  assert.match(js, /auditReadiness/);
  assert.match(js, /审计准备/);
  assert.match(js, /forbiddenEffects/);
  assert.match(js, /rule-pool-status-filter/);
  assert.match(js, /rule-pool-keyword/);
  assert.match(js, /setSelectionRange/);
  assert.match(js, /不会自动生成规则、写 Payload 或提交 Ozon/);
  const rulePoolRendererSource = js.match(/function renderListingRequiredAttributeRulePoolWorkbench[\s\S]+?\n}\n\nfunction renderRequiredAttributeFillPlan/)?.[0] || "";
  assert.ok(rulePoolRendererSource);
  assert.doesNotMatch(rulePoolRendererSource, /payloadDraftValidation/);
  assert.doesNotMatch(rulePoolRendererSource, /fetch\(/);
  assert.doesNotMatch(rulePoolRendererSource, /data-workflow-action/);
  assert.doesNotMatch(rulePoolRendererSource, /canStoreApproval\s*=\s*true/);
  assert.doesNotMatch(rulePoolRendererSource, /canEnableRule\s*=\s*true/);
  assert.match(rulePoolRendererSource, /auditReadiness\.status === "audit_ready"/);
  assert.match(rulePoolRendererSource, /renderRulePublishGate/);
  assert.doesNotMatch(rulePoolRendererSource, /<button/i);
  const publishGateRendererSource = js.match(/function renderRulePublishGate[\s\S]+?\n}\n\nfunction renderListingRequiredAttributeRulePoolWorkbench/)?.[0] || "";
  assert.ok(publishGateRendererSource);
  assert.doesNotMatch(publishGateRendererSource, /fetch\(/);
  assert.doesNotMatch(publishGateRendererSource, /api\(/);
  assert.doesNotMatch(publishGateRendererSource, /data-workflow-action/);
  assert.doesNotMatch(publishGateRendererSource, /<button/i);
  const publishReviewRendererSource = js.match(/function renderRulePublishReviewLog[\s\S]+?\n}\n\nfunction rulePublishSafetyLocksClosed/)?.[0] || "";
  assert.ok(publishReviewRendererSource);
  assert.doesNotMatch(publishReviewRendererSource, /fetch\(/);
  assert.doesNotMatch(publishReviewRendererSource, /api\(/);
  assert.doesNotMatch(publishReviewRendererSource, /data-workflow-action/);
  assert.doesNotMatch(publishReviewRendererSource, /<button/i);
  assert.match(css, /workflow-rule-pool-workbench/);
  assert.match(css, /rule-pool-approval-draft/);
  assert.match(css, /rule-pool-audit-readiness/);
  assert.match(css, /rule-pool-audit-log/);
  assert.match(css, /rule-pool-publish-review-log/);
  assert.match(css, /rule-pool-publish-gate/);
  assert.match(css, /rule-pool-controls/);
  assert.match(css, /rule-pool-row/);
});

test("required attribute rule pool keeps dictionary candidate occurrence counts deduplicated", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const keySource = js.match(/function requiredAttributeRuleCandidateKey[\s\S]+?\n}\n(?=\nfunction strictRuleApprovalAuditCandidateKey)/)?.[0] || "";
  const strictKeySource = js.match(/function strictRuleApprovalAuditCandidateKey[\s\S]+?\n}\n(?=\nfunction collectRuleApprovalAuditIntentsByCandidate)/)?.[0] || "";
  const auditCollectorSource = js.match(/function collectRuleApprovalAuditIntentsByCandidate[\s\S]+?\n}\n(?=\nfunction collectRulePublishReviewIntentsByCandidate)/)?.[0] || "";
  const publishReviewCollectorSource = js.match(/function collectRulePublishReviewIntentsByCandidate[\s\S]+?\n}\n(?=\nfunction collectRequiredAttributeRulePool)/)?.[0] || "";
  const poolCollectorSource = js.match(/function collectRequiredAttributeRulePool[\s\S]+?\n}\n(?=\nfunction rulePoolItemMatchesFilter)/)?.[0] || "";
  assert.ok(keySource);
  assert.ok(strictKeySource);
  assert.ok(auditCollectorSource);
  assert.ok(publishReviewCollectorSource);
  assert.ok(poolCollectorSource);
  const collectRequiredAttributeRulePool = new Function(`${keySource}\n${strictKeySource}\n${auditCollectorSource}\n${publishReviewCollectorSource}\n${poolCollectorSource}\nreturn collectRequiredAttributeRulePool;`)();
  const sharedHistory = {
    reviewQueue: [{
      categoryKey: "17028673:95183",
      attributeId: 777,
      attributeName: "Материал",
      ruleStatus: "ready_for_review",
      occurrenceCount: 2,
      sampleProductIds: ["SKU-1", "SKU-2"],
      sampleRunIds: ["run-1", "run-2"],
      candidateValues: [{
        dictionaryValueId: 7771,
        value: "Пластик",
        confidence: 0.72,
        source: "material_synonym",
        occurrenceCount: 2,
      }],
    }],
  };
  const pool = collectRequiredAttributeRulePool([
    { id: "run-1", summary: { requiredAttributeRuleCandidateHistory: sharedHistory } },
    { id: "run-2", summary: { requiredAttributeRuleCandidateHistory: sharedHistory } },
  ]);

  assert.equal(pool.length, 1);
  assert.equal(pool[0].occurrenceCount, 2);
  assert.deepEqual(pool[0].sampleProductIds, ["SKU-1", "SKU-2"]);
  assert.deepEqual(pool[0].candidateValues, [{
    dictionaryValueId: 7771,
    value: "Пластик",
    confidence: 0.72,
    source: "material_synonym",
    occurrenceCount: 2,
  }]);
});

test("frontend exposes stale workflow governance action", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /workflowReconcileStale/);
  assert.match(html, /清理陈旧状态/);
  assert.match(js, /reconcile-stale/);
  assert.match(js, /已治理/);
});

test("frontend exposes ERP workflow design navigation", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /erpWorkflowNavigator/);
  assert.match(html, /workflowFocusBar/);
  assert.match(js, /ERP_WORKFLOW_NAVIGATION/);
  assert.match(js, /renderErpWorkflowNavigator/);
  assert.match(js, /renderWorkflowFocusBar/);
  assert.match(js, /采集/);
  assert.match(js, /审核回馈/);
  assert.match(css, /erp-workflow-navigator/);
  assert.match(css, /workflow-focus-bar/);
  assert.match(css, /workflow-focus-step/);
});

test("frontend exposes the flow cockpit application shell", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /app-rail/);
  assert.match(html, /app-sidebar/);
  assert.match(html, /mobileNavToggle/);
  assert.match(js, /ERP_NAVIGATION_GROUPS/);
  assert.match(js, /activateErpView/);
  assert.match(css, /--erp-bg:/);
  assert.match(css, /\.app-shell/);
});

test("frontend exposes the seller-first ERP information architecture", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /工作台/);
  assert.match(html, /1688 采集/);
  assert.match(html, /商品草稿/);
  assert.match(html, /商品状态/);
  assert.match(html, /订单履约/);
  assert.match(html, /更多功能/);
  assert.match(html, /仓库与库存/);
  assert.match(html, /营销活动/);
  assert.match(html, /利润核算/);
  assert.match(html, /售后风险/);
  assert.match(html, /经营报表/);
  assert.match(html, /API 与系统/);
  assert.match(html, /erpArchitectureMap/);
  assert.match(html, /listingPrimaryFlow/);
  assert.match(html, /店铺经营总览/);
  assert.match(html, /高级说明与系统诊断/);
  assert.match(js, /ERP_INFORMATION_ARCHITECTURE/);
  assert.match(js, /renderErpArchitectureMap/);
  assert.match(js, /店铺总览/);
  assert.match(js, /财务利润/);
  assert.match(css, /listing-primary-flow/);
  assert.match(css, /erp-architecture-map/);
  assert.match(css, /architecture-card/);
});

test("frontend exposes complete ecommerce ERP business domains", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  for (const label of ["店铺总览", "商品管理", "选品采购", "上架中心", "订单履约", "库存仓库", "营销活动", "财务利润", "客户售后", "数据报表", "系统配置"]) {
    assert.match(html + js, new RegExp(label));
  }
  assert.doesNotMatch(html, /今日工作台[\s\S]{0,80}商品上架流水线/);
});

test("dashboard is store operating overview with reminders as side rail", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="workflow-console"'));

  assert.match(dashboard, /店铺经营总览/);
  assert.match(dashboard, /storeSalesOverview/);
  assert.match(dashboard, /storeProductHealth/);
  assert.match(dashboard, /storeOrderFulfillment/);
  assert.match(dashboard, /storeInventoryRisk/);
  assert.match(dashboard, /storeProfitSnapshot/);
  assert.match(dashboard, /todayReminderRail/);
  assert.match(css, /store-overview-layout/);
  assert.match(js, /renderStoreOperatingOverview/);
});

test("dashboard does not turn unknown inventory evidence into a zero-stock risk", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  const overview = js.slice(js.indexOf("function renderStoreOperatingOverview"), js.indexOf("function writeCommandStateLabel"));
  assert.match(overview, /productStockCounts\(products\)/);
  assert.match(overview, /unknownStockProducts/);
  assert.match(overview, /库存未知/);
  assert.match(overview, /缺库存/);
  assert.doesNotMatch(overview, /Number\(item\.stocks\?\.present \|\| item\.stock \|\| 0\)/);
});

test("stock read preserves missing Seller stock fields as unknown evidence", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function readStock");
  const end = js.indexOf("function renderStock", start);
  const body = js.slice(start, end > start ? end : start + 2600);
  assert.match(body, /const rawStock = stock\.present \?\? stock\.stock/);
  assert.match(body, /rawStock === null \|\| rawStock === undefined \|\| rawStock === ""/);
  assert.match(body, /Number\.isFinite\(numericStock\) \? numericStock : null/);
  assert.doesNotMatch(body, /Number\(stock\.present \?\? stock\.stock \?\? 0\)/);
});

test("stock read does not silently truncate the seller's Offer scope", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function readStock");
  const end = js.indexOf("function renderStock", start);
  const body = js.slice(start, end > start ? end : start + 7000);
  assert.match(body, /limit: 100/);
  assert.match(body, /missingOfferIds/);
  assert.match(body, /hasNextPage/);
  assert.match(body, /库存读取不完整/);
  assert.match(body, /当前结果不能代表全部输入商品/);
  assert.match(body, /data\?\.storeId/);
  assert.match(body, /库存读取回执不属于当前店铺/);
});

test("warehouse reads reject late or cross-store responses in inventory and listing contexts", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const inventoryStart = js.indexOf("async function loadWarehouses");
  const listingStart = js.indexOf("async function loadListingWarehouses");
  const ordersStart = js.indexOf("async function loadOrders");
  assert.ok(inventoryStart >= 0 && listingStart > inventoryStart && ordersStart > listingStart);
  const inventoryBody = js.slice(inventoryStart, listingStart);
  const listingBody = js.slice(listingStart, ordersStart);
  assert.match(inventoryBody, /warehouseRequestToken/);
  assert.match(inventoryBody, /requestStoreId !== String\(selectedStoreId\(\)/);
  assert.match(inventoryBody, /data\.storeId/);
  assert.match(inventoryBody, /paginationComplete === true/);
  assert.match(inventoryBody, /仓库列表未完整读取/);
  assert.match(inventoryBody, /仓库读取不完整，请重新读取/);
  assert.match(listingBody, /listingWarehouseRequestToken/);
  assert.match(listingBody, /requestStoreId !== String\(selectedStoreId\(\)/);
  assert.match(listingBody, /data\.storeId/);
});

test("inventory handoff preserves every ready Offer for the stock read", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const handoffStart = js.indexOf("function openStockReadinessTask");
  const handoffEnd = js.indexOf("function openSellerPayloadIssue", handoffStart);
  const readStart = js.indexOf("async function readStock");
  const readEnd = js.indexOf("function renderStock", readStart);
  assert.ok(handoffStart >= 0 && handoffEnd > handoffStart);
  assert.ok(readStart >= 0 && readEnd > readStart);
  const handoff = js.slice(handoffStart, handoffEnd);
  const read = js.slice(readStart, readEnd);
  assert.ok(handoff.includes('offerIds.join(", ")'));
  assert.ok(handoff.includes("stockJson.value = JSON.stringify"));
  assert.ok(read.includes(".split(/[\\s,;]+/)"));
  assert.ok(read.includes("offer_id: offerIds"));
  assert.ok(read.includes("请先填写至少一个 Offer ID"));
});

test("inventory handoff does not label missing stock evidence as complete", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function openStockReadinessTask");
  const end = js.indexOf("function openSellerPayloadIssue", start);
  const body = js.slice(start, end);
  assert.match(body, /stock-evidence-summary is-partial/);
  assert.match(body, /库存证据尚未读取|等待库存证据/);
  assert.match(body, /不会自动写入/);
  assert.doesNotMatch(body, /stock-evidence-summary is-complete/);
});

test("product overview offers a direct read-only inventory handoff", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const rowStart = js.indexOf("function productRowHtml");
  const rowEnd = js.indexOf("async function loadPromotions", rowStart);
  const handlerStart = js.indexOf('const productStockTarget = event.target.closest("[data-product-stock-offer]")');
  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  assert.ok(handlerStart >= 0);
  assert.match(js.slice(rowStart, rowEnd), /data-product-stock-offer/);
  assert.match(js.slice(rowStart, rowEnd), /库存核对/);
  assert.match(js.slice(handlerStart, handlerStart + 300), /openStockReadinessTask/);
});

test("product inventory handoff is gated by fresh server-observed sale readiness", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const claimStart = js.indexOf("function productStockReadinessClaim");
  const rowStart = js.indexOf("function productRowHtml");
  const rowEnd = js.indexOf("async function loadPromotions", rowStart);
  const openStart = js.indexOf("function openStockReadinessTask");
  const openEnd = js.indexOf("function openSellerPayloadIssue", openStart);
  assert.ok(claimStart >= 0 && rowStart > claimStart && rowEnd > rowStart && openStart >= 0 && openEnd > openStart);
  const claim = js.slice(claimStart, rowStart);
  const row = js.slice(rowStart, rowEnd);
  const open = js.slice(openStart, openEnd);
  assert.match(claim, /state\.productReadState/);
  assert.match(claim, /productReadCheckedAt/);
  assert.match(claim, /server_observed/);
  assert.match(claim, /30 \* 60 \* 1000/);
  assert.match(row, /productStockReadinessClaim\(item\)/);
  assert.match(row, /查看状态|修复商品/);
  assert.match(open, /stockReadinessClaimFromDataset/);
  assert.match(open, /商品状态尚未明确可售|先回查商品状态/);
  assert.doesNotMatch(open, /商品已明确可售[，,]等待库存证据/);
});

test("product overview never calls an unknown or non-selling product ready for inventory", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const rowStart = js.indexOf("function productStockReadinessClaim");
  const rowEnd = js.indexOf("function productRowHtml", rowStart);
  const openStart = js.indexOf("function openStockReadinessTask");
  const openEnd = js.indexOf("function openSellerPayloadIssue", openStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart && openStart >= 0 && openEnd > openStart);
  assert.match(js.slice(rowStart, rowEnd), /status === "selling"/);
  assert.match(js.slice(rowStart, rowEnd), /verification === "server_observed"/);
  assert.match(js.slice(openStart, openEnd), /当前商品尚未形成新鲜的服务端可售证据/);
  assert.match(js.slice(openStart, openEnd), /stockReadinessClaimFromDataset/);
});

test("promotion products can hand an Offer to inventory without a write", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  const start = js.indexOf("function renderPromotionProductRows");
  const end = js.indexOf("async function removePromotionProducts", start);
  assert.ok(start >= 0 && end > start);
  assert.match(js.slice(start, end), /data-promotion-stock-offer/);
  assert.match(js.slice(start, end), /库存核对/);
  assert.match(html.slice(html.indexOf("promotion-products-wrap"), html.indexOf('<section id="research"')), /<th>操作<\/th>/);
  assert.match(js, /promotionStockTarget/);
  assert.match(js, /data-promotion-stock-offer/);
});

test("1688 capture deep links focus the exact sourcing row", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function openCaptureFromDeepLink");
  const end = js.indexOf("function collectorParseIssueLabel", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /captureId/);
  assert.match(body, /state\.captureRows\.find/);
  assert.match(body, /captureBoxTable/);
  assert.match(body, /openCurrentCaptureTask/);
  assert.match(body, /检查商品/);
});

test("missing multi-SKU source binding offers a direct seller repair entry", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderVariantConfigurationWorkbench");
  const end = js.indexOf("function workflowPayloadIssueSummary", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /data-variant-source-task/);
  assert.match(body, /回到来源变体/);
  assert.match(js, /function openVariantSourceTask/);
  assert.match(js, /补齐来源变体后重新生成 Payload 并预检/);
});

test("stock read fails closed on an unrecognized Seller envelope", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function readStock");
  const end = js.indexOf("function renderStockDryRun", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /const rawItems = data\?\.items \?\? data\?\.result\?\.items/);
  assert.match(body, /if \(!Array\.isArray\(rawItems\)\)/);
  assert.match(body, /库存读取结果未知/);
  assert.match(body, /return false/);
  assert.doesNotMatch(body, /const items = data\.items \|\| data\.result\?\.items \|\| \[\]/);
});

test("stock reads cannot repaint another store and clear stale evidence on store switch", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const readStock = js.slice(js.indexOf("async function readStock"), js.indexOf("function renderStock", js.indexOf("async function readStock")));
  assert.match(readStock, /stockReadRequestToken/);
  assert.match(readStock, /requestStoreId !== selectedStoreId\(\)/);
  assert.match(readStock, /const requestEnvironment = String\(currentSellerReadEnvironment\(\) \|\| \"\"\)\.trim\(\)/);
  assert.match(readStock, /environment: requestEnvironment/);
  assert.match(readStock, /data\?\.environment/);
  assert.match(readStock, /currentSellerReadEnvironment\(\) \|\| \"\"\)\.trim\(\) !== requestEnvironment/);
  assert.match(readStock, /state\.stockSnapshotProducts = null/);
  assert.match(readStock, /if \(requestToken === state\.stockReadRequestToken\) setBusy/);
  const readEvidence = js.slice(js.indexOf("async function readStockReconciliationEvidence"), js.indexOf("async function runStockDryRun"));
  assert.match(readEvidence, /stockEvidenceRequestToken/);
  assert.match(readEvidence, /state\.stockDryRun = null/);
  assert.match(readEvidence, /if \(requestToken === state\.stockEvidenceRequestToken\) setBusy/);
  const storeChange = js.slice(js.indexOf('on("#storeSelect", "change"'), js.indexOf('on("#testButton"', js.indexOf('on("#storeSelect", "change"')));
  assert.match(storeChange, /state\.stockReadRequestToken/);
  assert.match(storeChange, /state\.stockEvidenceRequestToken/);
  assert.match(storeChange, /已切换店铺，请重新读取库存/);
});

test("stock evidence keeps malformed observed quantities unknown instead of rendering NaN", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function readStockReconciliationEvidence");
  const end = js.indexOf("async function runStockDryRun", start);
  const body = js.slice(start, end);
  assert.match(body, /function|const normalizeObservedStock/);
  assert.match(body, /return Number\.isFinite\(number\) \? number : null/);
  assert.match(body, /stock: normalizeObservedStock\(item\.present\)/);
  assert.match(body, /reserved: normalizeObservedStock\(item\.reserved\)/);
});

test("stock evidence is bound to the current read environment", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const evidence = js.slice(js.indexOf("async function readStockReconciliationEvidence"), js.indexOf("async function runStockDryRun"));
  assert.match(evidence, /const environmentCheck = validateReadOperatorEnvironment\(currentSellerReadEnvironment\(\)\)/);
  assert.match(evidence, /data\.environment/);
  assert.match(evidence, /environment: requestEnvironment/);
  const gate = js.slice(js.indexOf("function stockEvidenceUsableForCurrentTarget"), js.indexOf("function syncStockActionButtons"));
  assert.match(gate, /evidence\.environment/);
  assert.match(js, /function invalidateStockEvidenceForEnvironment/);
  assert.match(js, /on\("#listingReadEnvironment", "input", invalidateStockEvidenceForEnvironment\)/);
});

test("orders and finance evidence are invalidated when the read environment changes", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const load = js.slice(js.indexOf("async function loadOrders"), js.indexOf("function renderOrders", js.indexOf("async function loadOrders")));
  assert.match(load, /const environmentCheck = validateReadOperatorEnvironment\(currentSellerReadEnvironment\(\)\)/);
  assert.match(load, /environment: requestEnvironment/);
  assert.match(load, /data\.environment/);
  assert.match(js, /function invalidateOrderEvidenceForEnvironment/);
  assert.match(js, /state\.financeReadModel = null/);
  assert.match(js, /on\("#listingReadEnvironment", "input", invalidateOrderEvidenceForEnvironment\)/);
});

test("order read environment failure keeps its continuation branch executable", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const load = js.slice(js.indexOf("async function loadOrders"), js.indexOf("function renderOrders", js.indexOf("async function loadOrders")));
  assert.match(load, /const append = options\.append === true/);
  assert.match(load, /if \(!append\) state\.orderRows = \[\]/);
});

test("stock write UI does not claim completion when the post-write tuple reread fails", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function confirmStockWrite");
  const end = js.indexOf("async function loadStockQueue", start);
  const body = js.slice(start, end);
  assert.match(body, /const readbackOk = await readStockReconciliationEvidence\(\)/);
  assert.match(body, /readbackOk !== true/);
  assert.match(body, /summary\?\.status \|\| \"\"\) !== \"reconciled\"/);
  assert.match(body, /结果保持待复核/);
});

test("controlled read execution drops late responses after store or environment changes", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function executeCurrentStoreRead");
  const end = js.indexOf("function renderSecondaryDomainPanels", start);
  const body = js.slice(start, end);
  assert.match(body, /readOperatorExecutionRequestToken/);
  assert.match(body, /selectedStoreId\(\) \|\| \"\"\)\.trim\(\) !== String\(storeId/);
  assert.match(body, /currentSellerReadEnvironment\(\) \|\| \"\"\)\.trim\(\) !== environment/);
  assert.match(js, /state\.readOperatorExecutionRequestToken = Number/);
});

test("promotion evidence is bound to the current read environment", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const list = js.slice(js.indexOf("async function loadPromotions"), js.indexOf("function renderPromotions", js.indexOf("async function loadPromotions")));
  assert.match(list, /const environmentCheck = validateReadOperatorEnvironment\(currentSellerReadEnvironment\(\)\)/);
  assert.match(list, /data\.environment/);
  assert.match(list, /environment: requestEnvironment/);
  const detail = js.slice(js.indexOf("async function loadPromotionProducts"), js.indexOf("function renderPromotionDetail", js.indexOf("async function loadPromotionProducts")));
  assert.match(detail, /productsData\.environment/);
  assert.match(detail, /candidatesData\.environment/);
  assert.match(js, /function invalidatePromotionEvidenceForEnvironment/);
});

test("store switch clears order and finance evidence before reloading the active business view", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf('on("#storeSelect", "change"');
  const end = js.indexOf('on("#testButton"', start);
  assert.ok(start >= 0 && end > start);
  const handler = js.slice(start, end);
  assert.match(handler, /state\.orderRequestToken/);
  assert.match(handler, /state\.orderDetailRequestToken/);
  assert.match(handler, /state\.orderBatch = \{ loaded: false/);
  assert.match(handler, /state\.financeReadModel = null/);
  assert.match(js, /\["orders", "finance", "dashboard"\]\.includes\(active\)/);
});

test("listing workflow belongs under listing center, not dashboard", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="workflow-console"'));

  assert.doesNotMatch(dashboard, /listingPipelineWorkbench/);
  assert.doesNotMatch(dashboard, /当前商品流程/);
  assert.match(html, /上架中心/);
  assert.match(html, /上架草稿/);
  assert.match(html, /工作流诊断/);
});

test("listing center exposes automation guardrails for safe workflow routing", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  const listing = html.slice(html.indexOf('<section id="listing"'), html.indexOf('<section id="finance"'));

  assert.match(listing, /listingAutomationGuardrails/);
  assert.match(js, /ERP_AUTOMATION_GUARDRAILS/);
  assert.match(js, /renderListingAutomationGuardrails/);
  assert.match(js, /Ozon 提交必须人工确认/);
  assert.match(js, /定价风险不能静默跳过/);
  assert.match(js, /浏览器人机验证只允许暂停恢复/);
  assert.match(js, /preflight_check/);
  assert.match(js, /confirmSubmit/);
  assert.match(css, /listing-automation-guardrails/);
  assert.match(css, /automation-guardrail-card/);
});

test("secondary ERP domains render real operating panels instead of placeholders", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /placeholder-domain-panel/);
  assert.match(html, /financeProfitGrid/);
  assert.match(html, /financeRiskList/);
  assert.match(html, /serviceRiskGrid/);
  assert.match(html, /serviceQueueList/);
  assert.match(html, /reportsMetricGrid/);
  assert.match(html, /reportsTrendList/);
  assert.match(html, /systemStatusGrid/);
  assert.match(html, /systemAutomationList/);
  assert.match(js, /renderFinanceProfitPanel/);
  assert.match(js, /state\.financeReadModel = data\.financeReadModel/);
  assert.match(js, /renderServiceRiskPanel/);
  assert.match(js, /renderReportsPanel/);
  assert.match(js, /renderSystemConfigPanel/);
  assert.match(js, /domainPanelSnapshot/);
  assert.match(js, /financeSnapshotRevenue/);
  assert.match(js, /financeOrderLineAmount/);
  assert.match(js, /unknownLine \|\| excludedOrder \? null : total/);
  assert.match(js, /orderBatch\.hasNext !== true/);
  assert.match(js, /const revenueKnown = complete/);
  assert.match(js, /ORDER_REVENUE_FIELDS_UNKNOWN/);
  assert.match(js, /batch\.paginationComplete !== false/);
  assert.match(js, /responseStoreId !== requestStoreId/);
  assert.match(js, /data\.requestScope\?\.cursor/);
  assert.match(js, /orderCursorHistory/);
  assert.match(js, /订单读取范围已变化/);
  assert.match(js, /sellerInterpretationBlocked/);
  assert.match(js, /订单已读取，但卖家状态仍需人工复核/);
  assert.match(js, /currentOrderViewFilter/);
  assert.match(js, /当前视图筛选：/);
  assert.match(js, /当前筛选只影响已读取批次的展示/);
  assert.match(js, /当前筛选没有匹配订单，不代表店铺没有待处理订单/);
  assert.match(html, /经营证据看板/);
  assert.match(html, /成本、结算和利润缺证据时明确显示未知/);
  assert.match(css, /domain-operating-grid/);
  assert.match(css, /domain-risk-list/);
});

test("product center exposes an ERP product asset ledger", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  for (const id of [
    "productAssetSummary",
    "productAssetActionQueue",
    "productSellingLedger",
    "productReviewLedger",
    "productArchivedLedger",
  ]) {
    assert.match(html, new RegExp(id));
  }
  assert.match(html, /商品资产台账/);
  assert.match(js, /productAssetSnapshot/);
  assert.match(js, /productAssetLedgerState/);
  assert.match(js, /尚无可判定的商品风险/);
  assert.match(js, /商品总数\", ledgerState\.known \? snapshot\.products\.length : \"待确认\"/);
  assert.match(js, /renderProductAssetLedger/);
  assert.match(css, /product-asset-summary/);
  assert.match(css, /product-ledger-section/);
});

test("listing center exposes second-level workflow tabs", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /listingSecondaryTabs/);
  assert.match(html, /listingStagePanels/);
  for (const label of ["当前商品", "采集解析", "匹配选品", "定价利润", "内容图片", "预检提交", "审核回执", "失败修复"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(js, /LISTING_CENTER_STAGES/);
  assert.match(js, /renderListingStagePanels/);
  assert.match(js, /setListingStage/);
  assert.match(css, /listing-secondary-tabs/);
  assert.match(css, /listing-stage-panel/);
});

test("frontend exposes a seller operating model instead of hidden developer navigation", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /sellerOperatingModel/);
  assert.match(html, /ERP 运行逻辑/);
  assert.match(html, /今天先处理什么/);
  assert.match(html, /商品生命周期/);
  assert.match(html, /店铺日常运营/);
  assert.match(html, /异常与决策/);
  assert.match(js, /SELLER_OPERATING_MODEL/);
  assert.match(js, /renderSellerOperatingModel/);
  assert.match(js, /系统自动做/);
  assert.match(js, /你只需要决定/);
  assert.match(css, /seller-operating-model/);
  assert.match(css, /seller-operation-card/);
  assert.match(css, /nav-group-always-visible/);
});

test("frontend keeps the golden path primary and moves secondary modules behind more functions", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /seller-primary-nav/);
  assert.match(html, /1688 采集/);
  assert.match(html, /商品草稿/);
  assert.match(html, /id="secondaryNavToggle"/);
  assert.match(html, /aria-controls="sellerSecondaryNav"/);
  assert.match(html, /seller-secondary-nav/);
  assert.match(js, /function toggleSecondaryNavigation/);
  assert.match(html, /data-nav-group="sourcing-procurement" data-view="sourcing"/);
  assert.match(html, /data-nav-group="listing-center" data-view="listing"/);
  assert.match(js, /if \(button\.dataset\.view\)[\s\S]*activateErpView\(button\.dataset\.view\)/);
  assert.match(css, /business-erp-theme/);
  assert.match(css, /--business-bg:/);
  assert.match(css, /--business-panel:/);
  assert.match(css, /--business-text:/);
  assert.match(css, /\.seller-secondary-nav:not\(\.is-open\)/);
});

test("business ERP sidebar keeps text labels visible on desktop widths", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 1439px\)/);
  assert.match(css, /business-erp-theme \.tab > span:not\(\.tab-icon\)/);
  assert.match(css, /business-erp-theme \.app-sidebar\.sidebar[\s\S]*width: 292px/);
  assert.match(css, /business-erp-theme \.tab > span:not\(\.tab-icon\)[\s\S]*display: inline/);
  assert.match(css, /business-erp-theme \.sidebar-brand[\s\S]*display: flex/);
});

test("frontend defines explicit ownership contracts for every business tab", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  for (const view of ["dashboard", "sourcing", "listing", "workflow-console", "research", "products", "warehouse", "orders", "promotions"]) {
    assert.match(html, new RegExp(`id="${view}"`));
  }
  assert.match(js, /ERP_VIEW_OWNERSHIP_CONTRACTS/);
  assert.match(js, /renderViewOwnershipBars/);
  assert.match(js, /本页处理/);
  assert.match(js, /本页不处理/);
  assert.match(js, /错页提示/);
  assert.match(js, /营销活动/);
  assert.match(js, /只处理 Ozon 活动读取、活动商品、可加入商品和移出活动/);
  assert.match(css, /view-ownership-bar/);
  assert.match(css, /view-ownership-warning/);
});

test("promotions tab is contractually isolated from listing form fields", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf('<section id="promotions"');
  const end = html.indexOf('<section id="research"', start);
  assert.ok(start > 0, "promotions section exists");
  assert.ok(end > start, "research section follows promotions");
  const promotionsHtml = html.slice(start, end);

  assert.match(promotionsHtml, /来自 Ozon 的促销活动/);
  assert.match(promotionsHtml, /promotionList/);
  assert.match(promotionsHtml, /promotionProductRows/);
  assert.doesNotMatch(promotionsHtml, /listingCategoryPath/);
  assert.doesNotMatch(promotionsHtml, /listingName/);
  assert.doesNotMatch(promotionsHtml, /collectImageGrid/);
  assert.doesNotMatch(promotionsHtml, /无忧易售信息/);
});

test("reports panel does not turn partial activity rows into a store activity count", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderReportsPanel");
  const end = js.indexOf("function renderSystemConfigPanel", start);
  const body = js.slice(start, end);
  assert.match(body, /snapshot\.activePromotions === null \? "未知" : snapshot\.activePromotions\.length/);
  assert.match(body, /活动范围未完整读取，不能据此判断活动数量/);
  assert.doesNotMatch(body, /domainMetricCard\("营销活动", snapshot\.promotions\.length/);
});

test("each tab starts with a compact task entry and collapses long content", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /ERP_TAB_TASK_CARDS/);
  assert.match(js, /renderTabTaskCards/);
  assert.match(js, /applyProgressiveDisclosure/);
  assert.match(js, /data-task-card-view/);
  assert.match(js, /这个页面先做什么/);
  assert.match(js, /展开本页高级内容/);
  assert.match(js, /收起高级内容/);
  assert.match(js, /tab-secondary-collapsed/);
  assert.match(css, /tab-task-card/);
  assert.match(css, /tab-secondary-panel/);
  assert.match(css, /tab-secondary-collapsed/);
});

test("frontend exposes an actionable listing pipeline workbench", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /listingPipelineWorkbench/);
  assert.match(html, /当前商品流程/);
  assert.match(js, /ERP_LISTING_PIPELINE_STAGES/);
  assert.match(js, /pipelineStageStats/);
  assert.match(js, /renderListingPipelineWorkbench/);
  assert.match(js, /pipelineStageLatestIssue/);
  assert.match(js, /data-pipeline-run-id/);
  assert.match(js, /当前商品问题/);
  assert.match(js, /定位工作流/);
  assert.match(js, /data-pipeline-stage-view/);
  assert.match(js, /1688 采集/);
  assert.match(js, /商品解析/);
  assert.match(js, /Ozon 参照/);
  assert.match(js, /分类属性/);
  assert.match(js, /文案图片/);
  assert.match(js, /定价利润/);
  assert.match(js, /提交前校验/);
  assert.match(js, /提交 Ozon/);
  assert.match(js, /审核回馈/);
  assert.match(css, /listing-pipeline-workbench/);
  assert.match(css, /pipeline-stage-card/);
  assert.match(css, /pipeline-stage-issue/);
  assert.match(css, /pipeline-stage-actions/);
});

test("capture box can promote collected products to sourcing candidates", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /promote-capture-candidate/);
  assert.match(js, /promoteCaptureToCandidate/);
  assert.match(js, /\/api\/1688\/captures\/\$\{id\}\/to-candidate/);
});

test("listing pipeline workbench focuses on the current product, not history totals", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /当前商品流程/);
  assert.match(html, /历史问题已折叠/);
  assert.match(js, /currentListingWorkflowRun/);
  assert.match(js, /pipelineStageStats\(stage, currentRun\)/);
  assert.match(js, /只看当前商品/);
  assert.match(js, /历史统计/);
  assert.match(css, /pipeline-current-context/);
  assert.match(css, /pipeline-history-summary/);
});

test("dashboard exposes a single product listing outcome panel", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /singleListingOutcomePanel/);
  assert.match(html, /上架一个商品/);
  assert.match(html, /现在卡在哪/);
  assert.match(html, /为什么不能继续/);
  assert.match(js, /singleListingOutcomeState/);
  assert.match(js, /renderSingleListingOutcomePanel/);
  assert.match(js, /data-outcome-view/);
  assert.match(js, /下一步/);
  assert.match(css, /single-listing-outcome/);
  assert.match(css, /outcome-step-card/);
});

test("dashboard single product outcome consumes workflow current product task summary", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /summary\?\.currentProductTask/);
  assert.match(js, /currentProductTask\.nextAction/);
  assert.match(js, /currentProductTask\.view === "warehouse"/);
  assert.match(js, /currentProductTask\.view === "listing"/);
  assert.match(js, /sellerTaskStageTitle/);
  assert.match(js, /candidate_handoff: "1688 候选交接"/);
});

test("dashboard reminders and product center reuse current product task summary", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /latestCurrentProductTask/);
  assert.match(js, /renderCurrentProductTaskReminder/);
  assert.match(js, /today-reminder-current-task/);
  assert.match(js, /product-current-task-reminder/);
  assert.match(js, /summary\?\.currentProductTask/);
  assert.match(css, /today-reminder-current-task/);
  assert.match(css, /product-current-task-reminder/);
});

test("product current-task reminder exposes a scoped next-step button", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderCurrentProductTaskReminder");
  const end = js.indexOf("function renderSingleListingOutcomePanel", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /data-cockpit-view/);
  assert.match(body, /taskView === "warehouse"/);
  assert.match(body, /去库存核对/);
  assert.match(body, /taskView === "orders"/);
  assert.match(body, /去订单履约/);
  assert.match(body, /taskView === "products"/);
  assert.match(body, /查看商品运营/);
});

test("workflow console run cards expose current product task summary", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderWorkflowCurrentProductTask/);
  assert.match(js, /currentProductTask/);
  assert.match(js, /workflow-current-product-task/);
  assert.match(js, /当前商品任务/);
  assert.match(js, /task\.nextAction/);
  assert.match(css, /workflow-current-product-task/);
});

test("dashboard exposes seller ERP management scope", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /sellerManagementScope/);
  assert.match(html, /Seller 店铺管理/);
  assert.match(html, /ERP 能帮你管理什么/);
  assert.match(js, /SELLER_ERP_MANAGEMENT_SCOPES/);
  assert.match(js, /renderSellerManagementScope/);
  assert.match(js, /新品上架/);
  assert.match(js, /库存与仓库/);
  assert.match(js, /订单履约/);
  assert.match(js, /营销活动/);
  assert.match(js, /利润与价格/);
  assert.match(css, /seller-management-scope/);
  assert.match(css, /seller-scope-card/);
});

test("dashboard exposes the operational cockpit hierarchy", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /cockpitRiskBanner/);
  assert.match(html, /cockpitKpis/);
  assert.match(html, /cockpitWorkflowFocus/);
  assert.match(html, /systemPulseGrid/);
  assert.match(js, /renderCockpitDashboard/);
  assert.match(js, /cockpitWorkflowPhases/);
});

test("frontend uses the cockpit component system", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

  assert.match(css, /\.erp-panel/);
  assert.match(css, /\.erp-status-pill/);
  assert.match(css, /\.erp-empty-state/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.view\.active/);
});

test("frontend provides desktop compact and mobile navigation modes", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /sidebarBackdrop/);
  assert.match(js, /toggleMobileNavigation/);
  assert.match(css, /@media \(max-width: 1439px\)/);
  assert.match(css, /@media \(max-width: 1023px\)/);
  assert.match(css, /transform:\s*translateX\(-100%\)/);
});

test("frontend exposes a dedicated variant grouping defect repair card", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderVariantGroupingDefectCard/);
  assert.match(js, /variant-grouping-defect/);
  assert.match(js, /generate-variant-repair-draft/);
  assert.match(js, /生成整组修复草稿/);
  assert.match(js, /不会自动提交 Ozon/);
  assert.match(css, /variant-grouping-defect/);
  assert.match(css, /variant-grouping-table/);
});

test("frontend exposes GPT image style analysis controls", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /ozonImageStyleAnalyze/);
  assert.match(html, /ozonImageAnalysisTotal/);
  assert.match(html, /ozonImageAnalysisRows/);
  assert.match(js, /loadOzonImageStyleAnalysis/);
  assert.match(js, /runOzonImageStyleAnalysis/);
  assert.match(js, /\/api\/ozon-learning\/image-style-analysis\/run/);
});

test("frontend exposes on-demand Ozon reference guidance card", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /ozonReferenceGuidanceRun/);
  assert.match(html, /ozonReferenceGuidanceResult/);
  assert.match(html, /单品实时参照/);
  assert.match(js, /runOzonReferenceGuidance/);
  assert.match(js, /renderOzonReferenceGuidance/);
  assert.match(js, /\/api\/ozon-learning\/reference-guidance/);
  assert.match(js, /imageStyleProfile/);
  assert.match(js, /carouselPlan/);
  assert.match(js, /image2Prompts/);
  assert.match(js, /qualityChecklist/);
  assert.match(css, /ozon-reference-guidance/);
});

test("warehouse page exposes stock queue warehouse recommendation workbench", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /stockQueueList/);
  assert.match(html, /库存队列与仓库推荐/);
  assert.match(html, /库存写入仍走队列与商品就绪检查/);
  assert.match(js, /loadStockQueue/);
  assert.match(js, /warehouseRequestToken/);
  assert.match(js, /String\(data\.storeId \|\| ""\)\.trim\(\) !== requestStoreId/);
  assert.match(js, /不会看到旧仓库状态/);
  assert.match(js, /renderStockQueueWorkbench/);
  assert.match(js, /includeWarehouseRecommendation=1/);
  assert.match(js, /推荐仓库/);
  assert.match(js, /排除原因/);
  assert.match(css, /stock-queue-workbench/);
  assert.match(css, /stock-warehouse-recommendation/);
});

test("listing warehouse selectors reject late or mismatched store responses", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadListingWarehouses");
  const end = js.indexOf("function stockTargetsFromEditor", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /listingWarehouseRequestToken/);
  assert.match(body, /requestStoreId/);
  assert.match(body, /requestToken !== state\.listingWarehouseRequestToken/);
  assert.match(body, /String\(data\.storeId \|\| ""\)\.trim\(\) !== requestStoreId/);
  assert.match(body, /操作者不会看到旧仓库状态/);
  assert.match(body, /paginationComplete === true/);
  assert.match(body, /listingWarehouseReadIncomplete/);
  assert.match(body, /仓库列表未完整读取，请重新读取/);
  assert.match(body, /select\.disabled = !paginationComplete/);
  const storeChange = js.slice(js.indexOf('on("#storeSelect", "change"'), js.indexOf('on("#testButton"', js.indexOf('on("#storeSelect", "change"')));
  assert.match(storeChange, /state\.listingWarehouseRequestToken/);
});

test("stock evidence reads and preserves exact target warehouse tuples", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const warehouseIds = \[\.\.\.new Set\(rows/);
  assert.match(js, /offerIds, warehouseIds/);
  assert.match(js, /JSON\.stringify\(\{ storeId, offerIds, warehouseIds \}\)/);
  assert.match(js, /data\.warehouseIds/);
  assert.match(js, /evidence\.warehouseIds\.join\("\|"\) === warehouseIds\.join\("\|"\)/);
  assert.match(js, /data-warehouse-ids/);
});

test("stock UX keeps evidence, readiness, dry-run, and confirmation in one guarded chain", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const dryStart = js.indexOf("async function runStockDryRun");
  const confirmStart = js.indexOf("async function confirmStockWrite");
  const queueStart = js.indexOf("async function loadStockQueue");
  const dry = js.slice(dryStart, confirmStart);
  const confirm = js.slice(confirmStart, queueStart);
  assert.match(dry, /evidenceCurrent/);
  assert.match(dry, /!stockEvidenceUsableForCurrentTarget\(\)/);
  assert.match(dry, /库存预演证据不完整、已过期或商品尚未明确可售/);
  assert.match(dry, /evidence\.stale \|\| evidence\.partial \|\| evidence\.missingEvidence\.length/);
  assert.match(dry, /renderStockDryRun\(data\)/);
  const evidenceGateStart = js.indexOf("function stockEvidenceUsableForCurrentTarget");
  const evidenceGateEnd = js.indexOf("function syncStockActionButtons", evidenceGateStart);
  const evidenceGate = js.slice(evidenceGateStart, evidenceGateEnd);
  assert.match(evidenceGate, /evidence\.completeForRequestedIds !== true/);
  assert.match(evidenceGate, /evidence\.productStatusReadyForAll !== true/);
  assert.match(confirm, /stockEvidenceUsableForCurrentTarget\(\)/);
  assert.match(confirm, /stockDryRunMatchesCurrentTarget\(state\.stockDryRun\)/);
  assert.match(confirm, /重新读取证据并预演/);
});

test("stock evidence translates operation endpoints into seller actions", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function stockOperationSellerLabel");
  const end = js.indexOf("function renderStockEvidence", start);
  assert.ok(start >= 0 && end > start);
  const source = js.slice(start, end);
  assert.match(source, /商品状态/);
  assert.match(source, /商品详情/);
  assert.match(source, /当前库存/);
  assert.match(source, /仓库状态/);
  const render = js.slice(end, js.indexOf("function updateStockReceiptControl", end));
  assert.match(render, /stockOperationSellerLabel/);
});

test("stock seller view exposes exact Offer and warehouse tuples without raw payload editing", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const dryStart = js.indexOf("function renderStockDryRun");
  const evidenceStart = js.indexOf("function renderStockEvidence");
  const dry = js.slice(dryStart, evidenceStart);
  assert.match(dry, /view\.targetTuples/);
  assert.match(dry, /view\.unknownTuples/);
  assert.match(dry, /Offer \$\{escapeHtml\(String\(item\.offer_id/);
  assert.match(dry, /仓库 \$\{escapeHtml\(String\(item\.warehouse_id/);
  assert.match(dry, /当前数量未知时不能按 0 处理/);
  assert.match(dry, /必须重新读取到明确数量后/);
  const evidence = js.slice(evidenceStart, js.indexOf("function updateStockReceiptControl"));
  assert.match(evidence, /data\.targetTuples/);
  assert.match(evidence, /data\.unknownTuples/);
  assert.match(evidence, /current_stock:/);
  assert.match(evidence, /当前数量未知，不能按 0 判断/);
});

test("stock target editor blocks rows without an exact warehouse scope", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function stockTargetsFromEditor");
  const end = js.indexOf("function stockTargetSignature", start);
  assert.ok(start >= 0 && end > start);
  const source = js.slice(start, end);
  assert.match(source, /STOCK_EVIDENCE_WAREHOUSE_REQUIRED/);
  assert.match(source, /缺少仓库 ID/);
});

test("inventory handoff lets the seller apply an observed warehouse to the carried Offers", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="warehouseList"/);
  assert.match(js, /state\.stockFocusOfferIds\?\.length/);
  assert.match(js, /stock-warehouse-choose/);
  assert.match(js, /data-stock-warehouse-id/);
  const start = js.indexOf("function bindStockWarehouseChoices");
  const end = js.indexOf("async function loadListingWarehouses", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /state\.stockFocusOfferIds/);
  assert.match(body, /warehouse_id: Number\(warehouseId\)/);
  assert.match(body, /invalidateStockEvidenceOnTargetChange\(\)/);
  assert.match(body, /请继续填写目标库存/);
});

test("stock target editor never treats an empty target as zero stock", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function stockTargetsFromEditor");
  const end = js.indexOf("function stockTargetSignature", start);
  assert.ok(start >= 0 && end > start);
  const source = js.slice(start, end);
  assert.match(source, /rawStock === null \|\| rawStock === undefined \|\| String\(rawStock\)\.trim\(\) === ""/);
  assert.match(source, /STOCK_EVIDENCE_TARGET_STOCK_INVALID/);
  assert.match(source, /Number\.isSafeInteger\(stock\)/);
  assert.match(js, /空值不会按 0 处理/);
  assert.match(js, /toast\(error\.reasonCode \? stockEvidenceSellerError/);
});

test("FBS seller rows expose deadline urgency without adding fulfillment writes", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /deadlineStatus === "due_soon"/);
  assert.match(js, /12 小时内到期，优先处理/);
  assert.match(js, /当前不提供备货、发运或取消操作/);
});

test("FBS seller rows render dispute as a distinct operational status", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function orderStatusClass");
  const end = js.indexOf("function safeOrderImageUrl", start);
  assert.ok(start >= 0 && end > start);
  assert.match(js.slice(start, end), /"dispute"/);
});

test("FBS dispute filter includes top-level disputed status, not only substatus", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadOrders");
  const end = js.indexOf("function updateOrderCounts", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /state\.orderStatus === "dispute"/);
  assert.match(body, /order\.substatus/);
  assert.match(body, /order\.statusGroup \|\| order\.status/);
  assert.match(body, /\.includes\("disput"\)/);
});

test("FBS seller rows can reread selected posting detail with identity binding", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /data-fbs-order-detail/);
  assert.match(js, /order-dashboard\/detail/);
  assert.match(js, /expectedPostingIdentity !== postingNumber/);
  assert.match(js, /列表行不是详情证据/);
  assert.match(js, /不会执行履约动作/);
});

test("FBS detail readback exposes SKU and quantity evidence for the seller next step", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadFbsOrderDetail");
  const end = js.indexOf("function formatDateTime", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /detail\.products/);
  assert.match(body, /fbs-detail-product-list/);
  assert.match(body, /offer_id \|\| product\?\.offerId \|\| product\?\.sku/);
  assert.match(body, /数量未知，需重读/);
  assert.match(body, /当前仅只读观察/);
});

test("FBS selected detail drops late responses after store or batch changes", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /orderDetailRequestToken/);
  assert.match(js, /state\.orderDetailRequestToken = Number\(state\.orderDetailRequestToken \|\| 0\) \+ 1/);
  assert.match(js, /detailRequestToken !== state\.orderDetailRequestToken/);
  assert.match(js, /requestEnvironment/);
  assert.match(js, /data\?\.environment/);
  assert.match(js, /本次详情结果已丢弃；请重新读取当前货件详情/);
});

test("FBS order batch error remains an unknown seller state", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /sellerInterpretationBlocked = \["unknown", "manual_review", "error"\]/);
  assert.match(js, /target\.dataset\.state = \["unknown", "manual_review", "error"\]\.includes\(sellerStatus\)/);
  assert.match(js, /订单已读取，但卖家状态仍需人工复核；不能据此执行履约/);
});

test("FBS continuation failure preserves earlier page rows for a safe retry", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadOrders");
  const end = js.indexOf("function updateOrderCounts", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /if \(!append\) state\.orderRows = \[\]/);
  assert.match(body, /A failed continuation page must not erase orders/);
  assert.match(body, /if \(!append\) \{/);
  assert.match(body, /renderOrders\(\)/);
  assert.match(body, /renderOrderBatchStatus\(state\.orderRows\)/);
});

test("FBS receipt save stays disabled when seller interpretation is unknown", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const sellerInterpretationBlocked = \["unknown", "manual_review", "error"\]\.includes\(sellerStatus\)/);
  assert.match(js, /&& !sellerInterpretationBlocked/);
  assert.match(js, /未知或仍有下一批时保持禁用/);
});

test("FBS loading state gives one safe next step before any order action", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /正在读取当前批次/);
  assert.match(js, /下一步：<\/b>等待本批读取完成；如果失败，点击“读取订单”重试/);
  assert.match(js, /完成前不会执行任何订单动作/);
});

test("promotion seller result exposes activity coverage before price impact", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const coverage = results\.map\(\(result\) => result\.coverageText/);
  assert.match(js, /覆盖：\$\{coverage\}/);
  assert.match(js, /利润不可仅凭活动接口判断/);
});

test("promotion and finance views keep incomplete activity impact seller-facing and non-profit", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /活动商品读取失败：\$\{state\.promotionDetailError\} 利润和活动范围均未确认/);
  assert.match(js, /活动价格影响：尚未读取；利润仍需成本、物流、佣金证据/);
  assert.match(js, /利润不可仅凭活动接口判断/);
  assert.match(js, /FINANCE_SETTLEMENT_NOT_VERIFIED/);
  assert.match(js, /采购成本、物流费、佣金、杂费和结算规则尚未形成可追溯证据/);
});

test("promotion rows distinguish comparable discount impact from unknown prices", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /impactByProductId = new Map/);
  assert.match(js, /降幅 \$\{impact\.reductionPercent\}%/);
  assert.match(js, /未知（缺当前价或活动价）/);
  assert.match(js, /raw platform discount field as if it were a validated discount/);
});

test("promotion candidates expose a safe next step instead of implying add support", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderPromotionProductRows");
  const end = js.indexOf("async function removePromotionProducts", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /候选待人工确认/);
  assert.match(body, /加入活动需在 Ozon 活动页人工确认/);
  assert.match(body, /本页不执行加入/);
});

test("API health does not hide guarded runtime configuration", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /runtimeSafetySellerStatus/);
  assert.match(js, /API 正常，运行配置需处理/);
  assert.match(js, /运行配置未核验/);
  assert.match(js, /\/api\/system\/runtime-safety/);
  assert.match(js, /真实 Seller API 回执/);
});

test("API health label does not imply business readiness", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /API 与运行前置条件已满足（业务未验证）/);
  assert.match(js, /API 连通；运行前置条件满足，但业务 readiness 未验证/);
  assert.match(js, /snapshot\.businessReadiness === "not_verified"/);
});

test("API health surfaces high observability alerts without claiming readiness", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function testApi");
  const end = js.indexOf("function runtimeSafetySellerStatus", start);
  const body = js.slice(start, end);
  assert.match(body, /\/api\/system\/observability/);
  assert.match(body, /observability\.alerts/);
  assert.match(body, /API 正常，但服务有错误告警/);
  assert.match(body, /业务 readiness 未验证/);
});

test("system configuration visibly rechecks runtime safety and rejects incomplete summaries", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /runtimeSafetyStatus/);
  assert.match(js, /loadRuntimeSafetySummary/);
  assert.match(js, /运行安全摘要缺少认证或持久化字段/);
  assert.match(js, /typeof snapshot\.databaseConfigured === "boolean"/);
  assert.match(js, /if \(actualView === "system"\)/);
});

test("read-only receipt UX explains 403 store scope recovery without exposing raw errors", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /readOperatorReceiptStatus/);
  assert.match(js, /function readOperatorReceiptRecovery/);
  assert.match(js, /PRINCIPAL_STORE_SCOPE_REQUIRED/);
  assert.match(js, /READ_RECEIPT_STORE_SCOPE_REQUIRED/);
  assert.match(js, /当前会话不能访问所选店铺/);
  assert.match(js, /切换到当前会话已授权的店铺/);
  assert.match(js, /data.reasonCode/);
  assert.doesNotMatch(js, /responseData\.details/);
});

test("read-only receipt UX does not treat stale or incomplete coverage as current evidence", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /function readOperatorReceiptFreshnessRecovery/);
  assert.match(js, /READ_OPERATOR_RECEIPT_STALE/);
  assert.match(js, /旧回执不能用于上架、价格或库存判断/);
  assert.match(js, /READ_OPERATOR_RECEIPT_SCOPE_INCOMPLETE/);
  assert.match(js, /当前结果只能作部分证据/);
});

test("bootstrap failures give sellers actionable recovery without exposing raw API errors", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="appBootstrapRecovery"/);
  assert.match(js, /function renderAppBootstrapRecovery/);
  assert.match(js, /ERP 会话未授权/);
  assert.match(js, /当前会话没有店铺访问权限/);
  assert.match(js, /请重新登录 ERP 会话/);
  assert.match(js, /本次没有执行任何 Ozon 写入/);
  assert.match(js, /renderAppBootstrapRecovery\(error\)/);
  assert.doesNotMatch(js, /init\(\)\.catch\(\(error\) => toast\(error\.message/);
  assert.match(css, /\.app-bootstrap-recovery/);
});

test("product seller evidence shows accumulated status distribution after pagination", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const statusBreakdown/);
  assert.match(js, /已加载商品/);
  assert.match(js, /counts\.needFix/);
  assert.match(js, /loadedProductCount: state\.productRows\.length/);
});

test("product seller evidence renders concrete recovery tasks for partial detail reads", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /sellerTasks: Array\.isArray\(supplied\.sellerTasks\)/);
  assert.match(js, /product-seller-task-list/);
  assert.match(js, /请重新读取商品详情/);
});

test("product pagination always releases its busy state after success or failure", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadProducts");
  const end = js.indexOf("function productStockLabel", start);
  const body = js.slice(start, end);
  assert.match(body, /setBusy\(nextButton, true\)/);
  assert.match(body, /setBusy\(nextButton, false\)/);
  assert.match(body, /nextButton\.disabled = !state\.productHasNext/);
});

test("product pagination failure downgrades retained rows to partial evidence", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadProducts");
  const end = js.indexOf("function productStockLabel", start);
  const body = js.slice(start, end > start ? end : start + 2600);
  assert.match(body, /\} else \{\s*\/\/ Keep the already observed rows visible/);
  assert.match(body, /state\.productReadState = "partial"/);
  assert.match(body, /PRODUCT_PAGE_READ_FAILED/);
  assert.match(body, /当前已加载商品不能代表完整店铺范围/);
  assert.match(body, /state\.productReadCheckedAt = ""/);
});

test("product overview does not present stale stock as current or expose a misleading edit action", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function productRowHtml");
  const end = js.indexOf("async function loadPromotions", start);
  const body = js.slice(start, end);
  assert.match(body, /productStockEvidenceState\(item\)/);
  assert.match(body, /当前库存证据未知；去库存页重新读取/);
  assert.match(body, /商品总览只读；去上架中心编辑/);
  assert.match(body, /disabled>只读/);
});

test("product operations card labels stock separately from FBS order fulfillment", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function productLedgerItemHtml");
  const end = js.indexOf("function productLedgerEmpty", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /库存 \$\{escapeHtml/);
  assert.doesNotMatch(body, /FBS \$\{escapeHtml/);
  assert.match(body, /商品总览只读/);
});

test("store switch clears store-scoped product readiness readbacks", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf('on("#storeSelect", "change"');
  const end = js.indexOf('on("#testButton"', start);
  const body = js.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(body, /state\.productReadinessByJobId = \{\}/);
});

test("inventory preview button stays disabled until fresh matching evidence is present", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="stockDryRun"[^>]*disabled/);
  assert.match(js, /function stockEvidenceUsableForCurrentTarget/);
  assert.match(js, /Date\.now\(\) - checkedAt > 30 \* 60 \* 1000/);
  assert.match(js, /必须先读取当前商品、仓库和库存证据；证据过期或目标变更后需重新读取/);
  assert.match(js, /stockEvidenceUsableForCurrentTarget\(\)/);
});

test("inventory evidence UI exposes bounded pagination instead of hiding later pages", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderStockEvidence");
  const end = js.indexOf("function updateStockReceiptControl", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /paginationAttempts/);
  assert.match(body, /分页读取/);
  assert.match(body, /游标重复已停止/);
  assert.match(body, /仍需重读/);
});

test("inventory receipt save re-reads the exact store and tuple scope", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function saveStockEvidenceReceipt");
  const end = js.indexOf("function invalidateStockEvidenceOnTargetChange", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /stock-reconciliation\/evidence-receipts/);
  assert.match(body, /summaryQuery\.toString\(\)/);
  assert.match(body, /storeId: String\(button.dataset.storeId/);
  assert.match(body, /offerIds: offerIds.join/);
  assert.match(body, /warehouseIds: warehouseIds.join/);
});

test("inventory evidence read rejects a response with a different store or tuple scope", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function readStockReconciliationEvidence");
  const end = js.indexOf("async function runStockDryRun", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /responseOfferIds/);
  assert.match(body, /responseWarehouseIds/);
  assert.match(body, /data\.storeId/);
  assert.match(body, /库存证据回执范围已变化/);
});

test("inventory confirmation rechecks the exact target signature before reusing a dry-run", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function confirmStockWrite");
  const end = js.indexOf("async function loadStockQueue", start);
  const body = js.slice(start, end);
  assert.match(js, /function stockTargetSignature/);
  assert.match(js, /function stockDryRunMatchesCurrentTarget/);
  assert.match(body, /!stockEvidenceUsableForCurrentTarget\(\) \|\| !stockDryRunMatchesCurrentTarget\(state\.stockDryRun\)/);
  assert.match(body, /旧 dry-run 不能复用/);
});

test("stock evidence seller entry distinguishes product status blockers", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /function stockProductReadinessNextAction/);
  assert.match(js, /商品状态读取已陈旧/);
  assert.match(js, /商品仍在审核或导入中/);
  assert.match(js, /商品状态尚未确认/);
  assert.match(js, /隐藏商品已上架且对买家可见/);
  assert.match(js, /stockProductReadinessNextAction\(data\)/);
});

test("product price cells identify Seller source and avoid cost or profit conclusions", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function productRowHtml");
  const end = js.indexOf("function productStatusLabel", start);
  const body = js.slice(start, end);
  assert.match(body, /Seller API 当前读取价/);
  assert.match(body, /不含采购成本、佣金、物流或利润/);
  assert.match(body, /价格读取证据不完整/);
  assert.match(body, /price-source-note/);
});

test("product price cells hide retained numbers until the current product coverage is complete", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function productRowHtml");
  const end = js.indexOf("function productStatusLabel", start);
  const body = js.slice(start, end);
  assert.match(body, /priceEvidenceReady/);
  assert.match(body, /state\.productSellerResult\?\.coverageComplete === true/);
  assert.match(body, /: "未知"/);
  assert.match(body, /覆盖未完成/);
});

test("listing seller primary actions always land on the current-product workbench", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("const sellerPrimaryTarget = event.target.closest");
  const end = js.indexOf("const taskTarget = event.target.closest", start);
  assert.ok(start >= 0 && end > start);
  const handler = js.slice(start, end);
  assert.match(handler, /target === "listing"/);
  assert.match(handler, /setListingStage\("current-product"\)/);
  assert.match(handler, /renderListingSellerTaskSummary/);
  assert.match(handler, /renderListingStagePanels/);
});

test("stock evidence read surfaces target and warehouse blockers in the seller panel", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderStockEvidence");
  const end = js.indexOf("function updateStockReceiptControl", start);
  assert.ok(start >= 0 && end > start);
  const renderer = js.slice(start, end);
  assert.match(renderer, /data\.nextAction \|\|/);
  assert.match(renderer, /确认目标库存未变化后/);
  assert.match(js, /reasonCode: error\.reasonCode \|\| "STOCK_EVIDENCE_READ_FAILED"/);
  assert.match(js, /nextAction: stockEvidenceSellerError\(error\.reasonCode\)/);
});

test("FBS rows do not render a silent detail button when posting identity is missing", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function orderRowHtml");
  const end = js.indexOf("async function loadFbsOrderDetail", start);
  assert.ok(start >= 0 && end > start);
  const row = js.slice(start, end);
  assert.match(row, /order\.posting_number/);
  assert.match(row, /无法重读：缺少货件编号/);
  assert.match(row, /disabled title=\"缺少 posting number/);
});

test("after-sales risk card routes sellers to orders instead of a non-actionable service loop", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderServiceRiskPanel");
  const end = js.indexOf("function renderReportsPanel", start);
  assert.ok(start >= 0 && end > start);
  const panel = js.slice(start, end);
  assert.match(panel, /售后动作尚未接入/);
  assert.match(panel, /当前先从订单页查看争议和取消/);
  assert.match(panel, /退货或客服动作/);
  assert.match(panel, /\"orders\", \"info\"/);
  assert.doesNotMatch(panel, /售后数据接口/);
});

test("runtime safety maps missing auth or persistence to an explicit operator next step", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function runtimeSafetySellerStatus");
  const end = js.indexOf("async function loadWarehouses", start);
  assert.ok(start >= 0 && end > start);
  const status = js.slice(start, end);
  assert.match(status, /authConfigured === false/);
  assert.match(status, /配置服务端认证/);
  assert.match(status, /databaseConfigured === false/);
  assert.match(status, /配置持久化\/数据库连接/);
  assert.match(status, /memory_only/);
  assert.match(status, /切换到受支持的持久化环境/);
});

test("manual listing evidence save does not silently stop when workflow binding is missing", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function recheckListingAfterEvidenceSave");
  const end = js.indexOf("function summarizePipelineHistory", start);
  assert.ok(start >= 0 && end > start);
  const recheck = js.slice(start, end);
  assert.match(recheck, /if \(!runId\)/);
  assert.match(recheck, /工作流未绑定/);
  assert.match(recheck, /renderListingSellerTaskSummary\(\)/);
  assert.match(recheck, /toast\(state\.listingHandoffNotice, "warning"\)/);
});

test("inventory header read action is bound to the guarded tuple evidence flow", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /on\("#readStock", "click", readStockReconciliationEvidence\)/);
  assert.match(js, /stockTargetsFromEditor\(\)/);
  assert.match(js, /每个目标库存都必须绑定明确的 Ozon 仓库 ID/);
});

test("FBS permission and service failures expose an inline retry action", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderOrderBatchStatus");
  const end = js.indexOf("function renderOrderReceiptControls", start);
  assert.ok(start >= 0 && end > start);
  const status = js.slice(start, end);
  assert.match(status, /data-fbs-order-retry/);
  assert.match(status, /重新读取当前范围/);
  const handlerStart = js.indexOf("const fbsOrderRetryTarget");
  assert.ok(handlerStart >= 0);
  assert.match(js.slice(handlerStart, handlerStart + 260), /loadOrders\(\{ resetOffset: true \}\)/);
});

test("product dashboard turns price, image, and status anomalies into seller tasks", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /function productAssetNextAction/);
  assert.match(js, /进入上架中心核对售价、采购成本和费用证据/);
  assert.match(js, /进入上架中心补齐主图和媒体审核/);
  assert.match(js, /打开审核回执或商品状态详情/);
  assert.match(js, /商品总览只读，不会直接修改 Ozon/);
});

test("product overview distinguishes a filter-empty result from an unread or empty store", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderProducts");
  const end = js.indexOf("function productStockLabel", start);
  const body = js.slice(start, end);
  assert.match(body, /const filterEmpty = rows\.length === 0 && state\.productRows\.length > 0/);
  assert.match(body, /当前筛选没有匹配的商品/);
  assert.match(body, /清除关键词或切换状态筛选后再查看；不会修改商品/);
  assert.match(body, /商品状态尚未读取；先点击“刷新商品”获取当前店铺商品/);
  assert.match(body, /data-product-empty-state=/);
});

test("product pagination deduplicates repeated cursor boundary rows", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /function productRowKey/);
  assert.match(js, /function mergeProductRows/);
  assert.match(js, /mergeProductRows\(state\.productRows, data\.products \|\| \[\]\)/);
  assert.match(js, /productCountsFromRows\(state\.productRows, pageCounts\.all\)/);
});

test("FBS pagination keeps cumulative read coverage separate from current-page rows", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /orderCoverage/);
  assert.match(js, /observedCount/);
  assert.match(js, /当前页替换显示/);
  assert.match(js, /去重累计/);
  assert.match(js, /累计范围仅作只读覆盖提示/);
});

test("FBS receipt summary distinguishes complete dataset evidence from a completed page", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadFbsEvidenceSummary");
  const end = js.indexOf("function orderStatusClass", start);
  const body = js.slice(start, end);
  assert.match(body, /latest\.datasetComplete/);
  assert.match(body, /全范围完成/);
  assert.match(body, /当前范围完成/);
});

test("FBS receipt summary is bound to the current batch scope and drops late responses", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadFbsEvidenceSummary");
  const end = js.indexOf("function orderStatusClass", start);
  const body = js.slice(start, end);
  assert.match(body, /fbsReceiptRequestToken/);
  assert.match(body, /\["since", "to", "status", "warehouseId", "limit", "offset", "cursor", "sortDir"\]/);
  assert.match(body, /batchScope\.pagination === "cursor"/);
  assert.match(body, /requestToken !== state\.fbsReceiptRequestToken \|\| currentStoreId !== requestStoreId/);
  assert.match(body, /本次回执摘要已丢弃；请重新查看当前批次/);
});

test("FBS receipt summary requires an explicit environment before the UI can query it", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function updateFbsReceiptControl");
  const end = js.indexOf("async function saveFbsEvidenceReceipt", start);
  const body = js.slice(start, end);
  assert.match(body, /summaryButton\.disabled = environment\.length < 3 \|\| !batchStoreId/);
  assert.match(js, /data-load-fbs-evidence-summary disabled/);
});

test("FBS receipt summary shows a seller next action instead of claiming a completed range", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadFbsEvidenceSummary");
  const end = js.indexOf("function orderStatusClass", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /latest\.nextAction/);
  assert.match(body, /latest\.status/);
  assert.match(body, /latest\.verificationLevel/);
  assert.match(body, /不会备货|不会.*发运/);
});

test("listing seller summary initializes state actions after their declarations", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const functionStart = js.indexOf("function listingSellerTaskSummaryModel");
  const functionEnd = js.indexOf("function renderListingMediaReview", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const body = js.slice(functionStart, functionEnd);
  assert.ok(body.indexOf("const actions =") < body.indexOf("let action = actions[stateName]"));
});

test("listing media review translates OCR/source/compliance blockers into seller actions", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const helperStart = js.indexOf("function mediaSellerRiskItems");
  const helperEnd = js.indexOf("function mediaIssueSellerDetail", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = js.slice(helperStart, helperEnd);
  const mediaSellerRiskItems = new Function(`${helper}\nreturn mediaSellerRiskItems;`)();
  const risks = mediaSellerRiskItems({
    id: "media:risky",
    sourceUrl: "https://1688.example/image.jpg",
    sourceHash: "url-sha256:" + "a".repeat(64),
    evidenceRef: "snapshot:" + "b".repeat(64),
    checks: {
      ocr: { status: "blocked", hasChinese: true, isFactoryIntro: true },
      dimensions: { status: "clear", width: 800, height: 800 },
      sourceRisk: "blocked",
    },
  });
  assert.deepEqual(risks.map((risk) => risk.code), ["MEDIA_OCR_RISK", "MEDIA_SOURCE_RISK"]);
  assert.match(risks[0].reason, /中文|工厂/);
  assert.match(risks[0].next, /翻译|换图/);
  assert.match(risks[0].sideEffect, /不会上传|不会.*Ozon/);
  assert.match(risks[1].reason, /版权|来源/);
  assert.match(risks[1].next, /换用/);
  assert.match(js, /listing-media-risk-list/);
  assert.match(js, /不会发生：/);
  assert.match(js, /不会上传图片或写入 Ozon/);
});

test("saving a seller category immediately records a local preflight result", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function saveSelectedCategoryToListingDraft");
  const end = js.indexOf("function applySubmittedStatusToRows", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /manual-category/);
  assert.match(body, /expectedBinding: listingManualEvidenceBinding\(job\)/);
  assert.match(body, /payload-draft\/validate/);
  assert.match(body, /localPreflight/);
  assert.match(body, /不会调用 Seller API 写端点/);
  assert.match(body, /仍需媒体、价格和人工确认才能提交/);
  assert.doesNotMatch(body, /payload-draft\/submit/);
});

test("category save refuses a stale workflow or cross-store draft binding", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function saveSelectedCategoryToListingDraft");
  const end = js.indexOf("function applySubmittedStatusToRows", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /当前商品工作流已失效/);
  assert.match(body, /state\.selectedWorkflowRunId/);
  assert.match(body, /当前草稿不属于所选店铺/);
  assert.match(body, /String\(job\.storeId \|\| ""\)\.trim\(\) !== activeStoreId/);
});

test("review reconciliation exposes task/product/offer field locator without submission", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderReviewRepairDraft");
  const end = js.indexOf("function renderWorkflowDetail", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /任务 \$\{escapeHtml\(draft\.taskId/);
  assert.match(body, /商品 \$\{escapeHtml\(repair\.productId/);
  assert.match(body, /Offer \$\{escapeHtml\(repair\.offerId/);
  assert.match(body, /data-review-repair-locate/);
  assert.match(body, /查看并定位本地草稿字段/);
  assert.match(body, /不会写入 Ozon/);
  assert.match(js, /openSellerPayloadIssue\(reviewRepairLocateTarget\.dataset\.runId/);
});

test("upload queue mirrors seller blocker instead of always promising upload confirmation", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="listingUploadNextAction"/);
  assert.match(js, /function renderListingUploadQueueSummary/);
  assert.match(js, /renderListingUploadQueueSummary\(summary, run\)/);
  assert.match(js, /资料待补齐/);
  assert.match(js, /预检通过，待确认/);
  assert.doesNotMatch(html, /<strong>确认上传<\/strong>/);
});

test("passed listing preflight routes the seller to confirmation instead of generic draft work", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const functionStart = js.indexOf("function listingSellerTaskSummaryModel");
  const functionEnd = js.indexOf("function renderListingMediaReview", functionStart);
  const body = js.slice(functionStart, functionEnd);
  assert.match(body, /run\?\.payloadDraft && validation\?\.ok/);
  assert.match(body, /label: "进入人工确认提交"/);
  assert.match(body, /view: "workflow-console"/);
  assert.match(body, /nodeKey: "ozon_submit"/);
  assert.match(body, /再次确认前不会调用 Ozon/);
});

test("inventory-ready seller state does not route back to submission or FBS", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const functionStart = js.indexOf("function listingSellerTaskSummaryModel");
  const functionEnd = js.indexOf("function renderListingMediaReview", functionStart);
  const body = js.slice(functionStart, functionEnd);
  assert.match(js, /sale_ready: "商品已上架，库存已就绪"/);
  assert.match(body, /reviewSucceeded && stockSucceeded/);
  assert.match(body, /\["success", "completed"\]\.includes/);
  assert.match(body, /label: "查看商品运营"/);
  assert.match(body, /view: "products"/);
  assert.match(body, /不会进入订单履约或执行写入/);
  assert.equal(body.includes('sale_ready: { label: "查看订单"'), false);
});

test("frontend exposes GPT Image 2 generation controls for reference guidance", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /ozonImage2Size/);
  assert.match(html, /ozonImage2Resolution/);
  assert.match(html, /ozonImage2SubmitFirstPrompt/);
  assert.match(html, /ozonImage2TaskResult/);
  assert.match(js, /submitFirstImage2Prompt/);
  assert.match(js, /pollImage2Task/);
  assert.match(js, /\/api\/image-generation\/gpt-image-2/);
  assert.match(js, /\/api\/image-generation\/tasks\//);
  assert.match(css, /ozon-image2-controls/);
});

test("frontend promotes Ozon image style panel out of collapsed advanced tools", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /promoteOzonImageStyleSection/);
  assert.match(js, /ozonImageStyleAnalyze/);
  assert.match(js, /erp-advanced-toggle/);
});

test("docs include Ozon Seller API gap backlog", async () => {
  const doc = await readFile(new URL("../docs/ozon-seller-api-gap-backlog.zh-CN.md", import.meta.url), "utf8");

  assert.match(doc, /Ozon Seller API 缺口开发清单/);
  assert.match(doc, /payload-draft-submit/);
  assert.match(doc, /review_reconcile/);
  assert.match(doc, /stock_sync/);
  assert.match(doc, /P0/);
  assert.match(doc, /P1/);
  assert.match(doc, /P2/);
});

test("frontend bounds moderation repair task rendering for seller payload safety", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /allRepairTasks/);
  assert.match(js, /allRepairTasks\.slice\(0, 100\)/);
  assert.match(js, /repairTasksTruncated/);
  assert.match(js, /审核修复任务（\$\{repairTasks\.length\}\$\{repairTasksTruncated \? "\+" : ""\}）/);
});

test("product readiness UI binds the seller's environment to a guarded status read", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const renderStart = js.indexOf("function renderListingProductReadiness");
  const loadStart = js.indexOf("async function loadListingProductReadiness");
  const render = js.slice(renderStart, loadStart);
  const loadEnd = js.indexOf("\nconst LISTING_SELLER_SUMMARY_STATUS_LABELS", loadStart);
  const load = js.slice(loadStart, loadEnd);
  assert.match(render, /data-product-readiness-environment/);
  assert.match(load, /validateReadOperatorEnvironment/);
  assert.match(load, /environmentCheck\.reasonCode/);
  assert.match(load, /product-readiness\?environment=/);
  assert.match(load, /不会联网/);
});

test("product readiness drops a late or cross-store/environment response", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const loadStart = js.indexOf("async function loadListingProductReadiness");
  const loadEnd = js.indexOf("\nconst LISTING_SELLER_SUMMARY_STATUS_LABELS", loadStart);
  const load = js.slice(loadStart, loadEnd);
  assert.match(load, /productReadinessRequestToken/);
  assert.match(load, /selectedStoreId\(\)/);
  assert.match(load, /currentSellerReadEnvironment\(\)/);
  assert.match(load, /result\?\.storeId/);
  assert.match(load, /result\?\.environment/);
  assert.match(load, /不会使用跨店铺或跨环境的迟到回执/);
});

test("ready product readiness hands the seller to exact stock evidence without auto-writing", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const renderStart = js.indexOf("function renderListingProductReadiness");
  const openStart = js.indexOf("function openStockReadinessTask");
  const openEnd = js.indexOf("function openSellerPayloadIssue", openStart);
  const handlerStart = js.indexOf("const stockReadinessTarget");
  assert.ok(renderStart >= 0 && openStart > renderStart && openEnd > openStart && handlerStart > openStart);
  const render = js.slice(renderStart, openStart);
  const open = js.slice(openStart, openEnd);
  assert.match(render, /sellerView\?\.statusLabel === "已明确可售"/);
  assert.match(render, /data-stock-readiness-offers/);
  assert.match(render, /data-stock-readiness-store-id/);
  assert.match(render, /不会自动写入/);
  assert.match(open, /state.stockEvidence = null/);
  assert.match(open, /state.stockFocusOfferIds = offerIds/);
  assert.match(open, /activateErpView\("warehouse"\)/);
  assert.match(open, /先补齐目标仓库和数量，然后读取当前库存/);
  assert.doesNotMatch(open, /confirmStockWrite|api\(/);
});

test("local product readiness cannot claim sale-ready or route to inventory before server evidence", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const renderStart = js.indexOf("function renderListingProductReadiness");
  const openStart = js.indexOf("function openStockReadinessTask", renderStart);
  const render = js.slice(renderStart, openStart);
  assert.match(render, /本地就绪判断，待服务端回查/);
  assert.match(render, /verification\.level !== "server_observed"/);
  assert.match(render, /readinessClaim && verification\.level === "server_observed"/);
});

test("review feedback stays mapped to the affected offer field and rejects old confirmation", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /商品 \$\{escapeHtml\(task\.productId \|\| "-"\)\} · Offer \$\{escapeHtml\(task\.offerId \|\| "-"\)\}/);
  assert.match(js, /字段：\$\{escapeHtml\(task\.fieldPath \|\| "products\[\*\]"\)\}/);
  assert.match(js, /草稿已修改，先重新预检/);
  assert.match(js, /当前草稿 hash 与预检版本不一致；旧确认不可复用/);
});

test("promotions page does not turn unknown coverage into an empty-store claim", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /promotionSellerResult\?\.status/);
  assert.match(js, /活动读取结果缺少完整覆盖信息/);
  assert.match(js, /不能判断店铺是否没有活动/);
});

test("promotion rows do not display Ozon old_price as the current selling price", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderPromotionProductRows");
  const end = js.indexOf("async function removePromotionProducts", start);
  const body = js.slice(start, end);
  assert.match(body, /const price = item\.current_price \|\| item\.currentPrice \|\| item\.price \|\| ""/);
  assert.doesNotMatch(body, /const price =[^\n]*item\.old_price/);
  assert.match(body, /未知（缺当前价或活动价）/);
});

test("promotion rows do not display price bounds as an observed activity price", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderPromotionProductRows");
  const end = js.indexOf("async function removePromotionProducts", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /const actionPrice = item\.action_price \|\| item\.discount_price \|\| ""/);
  assert.doesNotMatch(body, /const actionPrice[^\n]*max_action_price/);
  assert.doesNotMatch(body, /const actionPrice[^\n]*min_price/);
  assert.match(body, /Range fields \(min_price\/max_action_price\) are constraints/);
});

test("promotions freshness uses seller coverage instead of non-empty row count", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const sellerStatus = String\(data\.sellerResult\?\.status/);
  assert.match(js, /coverageComplete: data\.sellerResult\?\.coverageComplete/);
  assert.match(js, /活动返回了记录，但服务端覆盖范围未知/);
  assert.match(js, /\["unknown", "empty"\]\.includes\(state\.promotionEvidence\.readStatus\)/);
});

test("promotion list drops late responses from another store", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /promotionRequestToken/);
  assert.match(js, /const requestStoreId = String\(selectedStoreId\(\) \|\| ""\)\.trim\(\)/);
  assert.match(js, /if \(requestToken !== state\.promotionRequestToken\) return/);
  assert.match(js, /responseStoreId !== requestStoreId/);
  assert.match(js, /不会看到旧活动数据/);
});

test("promotion detail reads bind both responses and late work to the current store", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadPromotionProducts");
  const end = js.indexOf("function renderPromotionDetail", start);
  const body = js.slice(start, end);
  assert.match(body, /const requestStoreId = String\(selectedStoreId\(\) \|\| \"\"\)\.trim\(\)/);
  assert.match(body, /productsData\.storeId/);
  assert.match(body, /candidatesData\.storeId/);
  assert.match(body, /selectedStoreId\(\) \|\| \"\"\)\.trim\(\) !== requestStoreId/);
  const storeChange = js.slice(js.indexOf('on("#storeSelect", "change"'), js.indexOf('on("#testButton"'));
  assert.match(storeChange, /state\.promotionDetailRequestToken/);
});

test("activity seller contract keeps coverage state separate from price impact", async () => {
  const [js, model] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/activityReadModel.js", import.meta.url), "utf8"),
  ]);
  assert.match(model, /status = paginationSignalInvalid/);
  assert.match(model, /complete \? \(rows\.length \? "complete" : "empty"\)/);
  assert.match(model, /profitConclusion: "unknown_without_cost_commission_and_settlement_rules"/);
  assert.match(js, /活动读取失败，未展示旧活动状态/);
  assert.match(js, /活动读取不完整，暂不展示活动范围/);
  assert.match(model, /活动影响仍需结合有效价格、成本、佣金和结算证据/);
});

test("dashboard activity count and price impact require complete activity coverage", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /function promotionCoverageComplete\(sellerResult = state\.promotionSellerResult/);
  assert.match(js, /return sellerResult\?\.coverageComplete === true \|\| evidence\?\.coverageComplete === true/);
  assert.match(js, /完整覆盖证据缺失；不能据此判断全店活动/);
  assert.match(js, /活动范围未完整读取，不显示数量/);
  assert.match(js, /productsData\.sellerResult\?\.coverageComplete === true/);
  assert.match(js, /Do not promote a partial\/unknown page's discount arithmetic into the/);
});

test("finance panel does not turn partial activity rows into an active promotion count", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const activePromotions = promotionCoverageComplete\(\)/);
  assert.match(js, /const activePromotions = promotionCoverageComplete\(\)\n    \? promotions\.filter/);
  assert.match(js, /snapshot\.activePromotions === null/);
  assert.match(js, /活动读取覆盖不完整，不能据此判断店铺活动数量或价格影响/);
});

test("finance panel treats remaining order pages as incomplete instead of an estimated total", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderFinanceProfitPanel");
  const end = js.indexOf("function renderServiceRiskPanel", start);
  assert.ok(start >= 0 && end > start);
  const panel = js.slice(start, end);
  assert.match(panel, /orderBatch\.hasNext === true/);
  assert.match(panel, /orderBatch\.paginationComplete === false/);
  assert.match(panel, /订单读取范围未完成；销售额未知，不能用当前批次代表全店/);
  assert.doesNotMatch(panel, /仅当前批次估算，不能代表全店/);
});

test("system config keeps observability alerts visible without conflating API liveness or business readiness", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderSystemConfigPanel");
  const end = js.indexOf("function renderRuntimeSafetyStatus", start);
  assert.ok(start >= 0 && end > start);
  const panel = js.slice(start, end);
  assert.match(panel, /服务观测/);
  assert.match(panel, /observabilitySellerStatus/);
  assert.match(panel, /API 连通当作生产或业务就绪/);
  assert.match(panel, /服务观测有告警/);
});

test("duplicate candidate handoff resolves only its exact existing workflow", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function createListingDraftFromCandidate");
  const end = js.indexOf("async function moveCrawlerCandidateToCapture", start);
  assert.ok(start >= 0 && end > start);
  const handoff = js.slice(start, end);
  assert.match(handoff, /data\.job\?\.workflowRunId/);
  assert.match(handoff, /entity\?\.autoListingJobId/);
  assert.match(handoff, /entity\?\.candidateId/);
  assert.match(handoff, /never fall back to the latest unrelated run/);
  assert.match(handoff, /草稿已保存，但工作流未绑定/);
});

test("product rows downgrade stale or partial status labels instead of showing old sellable state", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function productRowHtml");
  const end = js.indexOf("async function loadPromotions", start);
  assert.ok(start >= 0 && end > start);
  const row = js.slice(start, end);
  assert.match(row, /productStatusLabel/);
  assert.match(row, /state\.productReadState === "partial"/);
  assert.match(row, /状态未完整/);
  assert.match(row, /item\.visible === false/);
  assert.match(row, /旧状态不作可售结论/);
});

test("FBS seller actions keep awaiting statuses read-only and non-executable", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function orderSellerNextAction");
  const end = js.indexOf("async function loadFbsOrderDetail", start);
  assert.ok(start >= 0 && end > start);
  const orderUi = js.slice(start, end);
  assert.match(orderUi, /awaiting_packaging/);
  assert.match(orderUi, /awaiting_deliver/);
  assert.match(orderUi, /本页不执行备货或发运/);
  assert.match(orderUi, /本页不执行发运/);
  assert.match(js, /订单状态不会触发备货或发运/);
});

test("promotion cards do not display definite counts before complete activity coverage", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderPromotions");
  const end = js.indexOf("async function selectPromotion", start);
  assert.ok(start >= 0 && end > start);
  const renderer = js.slice(start, end);
  assert.match(renderer, /coverageComplete = state\.promotionSellerResult\?\.coverageComplete === true/);
  assert.match(renderer, /范围未完成/);
  assert.match(renderer, /productCount/);
  assert.match(renderer, /candidateCount/);
});

test("dashboard sales KPI refuses to sum partial or unknown order rows", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const financeOrder = state\.financeReadModel\?\.order \|\| null/);
  assert.match(js, /financeOrder\?\.state === "complete"/);
  assert.match(js, /financeOrder\?\.revenueCoverage\?\.complete === true/);
  assert.match(js, /订单范围或金额证据未完整，不显示合计/);
  assert.doesNotMatch(js, /const productsTotal = \(order\.products \|\| \[\]\)\.reduce\(\(sum, product\) => sum \+ Number\(product\.price/);
});

test("dashboard finance labels do not call an arbitrary order range today's sales", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderStoreOperatingOverview");
  const end = js.indexOf("function renderFinanceProfitPanel", start);
  assert.ok(start >= 0 && end > start);
  const dashboard = js.slice(start, end);
  assert.match(dashboard, /当前读取范围销售额/);
  assert.match(dashboard, /当前订单批次/);
  assert.doesNotMatch(dashboard, /今日销售额/);
  assert.doesNotMatch(dashboard, /今日订单/);
});

test("finance UI fallback does not assume quantity=1 for a unit-price-only line", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /function financeOrderLineAmount\(product = \{\}\)/);
  assert.match(js, /return quantity === null \? null : unitPrice \* quantity/);
  assert.match(js, /return unknownLine \|\| excludedOrder \? null : total/);
});

test("finance UI fallback excludes cancelled and disputed orders like the server model", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const amountSource = js.match(/function financeAmount\(value\)[\s\S]+?\n}\n\nfunction financeOrderLineAmount/)?.[0]
    ?.replace(/\n\nfunction financeOrderLineAmount$/, "");
  const lineSource = js.match(/function financeOrderLineAmount\(product = \{\}\)[\s\S]+?\n}\n\nfunction financeSnapshotRevenue/)?.[0]
    ?.replace(/\n\nfunction financeSnapshotRevenue$/, "");
  const revenueSource = js.match(/function financeSnapshotRevenue\(orders, orderBatch\)[\s\S]+?\n}\n\nfunction domainPanelSnapshot/)?.[0]
    ?.replace(/\n\nfunction domainPanelSnapshot$/, "");
  assert.ok(amountSource);
  assert.ok(lineSource);
  assert.ok(revenueSource);
  const financeSnapshotRevenue = new Function(`${amountSource}\n${lineSource}\n${revenueSource}\nreturn financeSnapshotRevenue;`)();
  const completeBatch = { loaded: true, failed: false, partial: false, hasNext: false };
  assert.equal(financeSnapshotRevenue([
    { status: "cancelled", products: [{ total_price: 100, quantity: 1 }] },
    { statusGroup: "dispute", products: [{ total_price: 50, quantity: 1 }] },
  ], completeBatch), null);
  assert.equal(financeSnapshotRevenue([
    { status: "delivered", products: [{ total_price: 100, quantity: 1 }] },
  ], completeBatch), 100);
});

test("product stock summary refuses unknown or expired product-read evidence", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /productReadCheckedAt/);
  assert.match(js, /state\.productReadState = "loading"/);
  assert.match(js, /readState !== "completed" \|\| !fresh/);
  assert.match(js, /return "unknown";/);
  assert.match(js, /maxAgeMs = 30 \* 60 \* 1000/);
});

test("promotion detail can continue bounded read-only pagination without replacing prior rows", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /promotionPaginationControls/);
  assert.match(js, /promotionDetailOffset/);
  assert.match(js, /继续读取下一页活动商品/);
  assert.match(js, /const mergeRows/);
  assert.match(js, /offset: state\.promotionDetailOffset \+ 1000/);
});

test("promotion detail empty rows explain unknown or partial seller coverage", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const sellerResult = state\.promotionDetailSellerResult\?\.\[state\.promotionProductKind\] \|\| \{\}/);
  assert.match(js, /活动商品读取不完整，不能判断当前活动没有商品/);
  assert.match(js, /活动商品读取范围未知，不能判断当前活动没有商品/);
  assert.match(js, /下一步：\$\{escapeHtml\(nextAction\)\}/);
  assert.doesNotMatch(js, /body\.innerHTML = `\<tr\>\<td colspan="8" class="empty"\>暂无数据\<\/td\>\<\/tr\>`/);
});

test("promotion refresh clears stale activity cards before the new read completes", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /state\.promotionEvidence = \{[\s\S]*?loading: true/);
  assert.match(js, /state\.promotionRows = \[\];[\s\S]*?state\.selectedPromotion = null/);
  assert.match(js, /state\.promotionEvidence\?\.loading[\s\S]*?正在读取当前店铺活动；旧活动已清除/);
});

test("capture box exposes source domain coverage for seller repair decisions", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /sourceEvidenceRecord\.domainCoverage/);
  assert.match(js, /sourceEvidenceRecord\.missingDomains/);
  assert.match(js, /capture-source-domain-coverage/);
  assert.match(js, /证据覆盖：/);
  assert.match(js, /供应商\/MOQ\/采购阶梯价待核/);
});

test("capture box exposes bounded task and snapshot identity for handoff", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /sourceEvidenceRecord\.captureIdentity/);
  assert.match(js, /capture-identity-summary/);
  assert.match(js, /任务未绑定/);
  assert.match(js, /Offer 未解析/);
  assert.match(js, /快照 \$\{captureHashShort\}/);
  assert.match(js, /data-capture-task-id/);
  assert.match(js, /data-capture-offer-id/);
});

test("capture box states evidence side effects in seller language", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /capture-evidence-side-effect/);
  assert.match(js, /证据未验证前不会创建或提交 Ozon/);
  assert.match(js, /补证动作只更新本地候选/);
});

test("unverified 1688 source snapshots cannot look ready for listing submission", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /sourceEvidence\?\.verificationState === "ok"/);
  assert.match(js, /1688 页面证据已记录，待人工验证/);
  assert.match(js, /来源证据待补齐/);
  assert.match(js, /打开来源采集与证据修复；不会提交 Ozon/);
});

test("1688 candidate handoff keeps source evidence state and human-verification blocker visible", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /sourceEvidenceSummary/);
  assert.match(js, /candidate-source-evidence/);
  assert.match(js, /等待人工验证/);
  assert.match(js, /先完成人工验证/);
  assert.match(js, /生成的只是本地草稿/);
});

test("listing seller summary keeps procurement and media evidence as blockers", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /采购 MOQ\/阶梯价证据待补齐/);
  assert.match(js, /媒体候选证据待补齐/);
  assert.match(js, /采购、运费和利润诊断；不会提交 Ozon/);
  assert.match(js, /未经人工批准不能作为可提交富内容/);
});

test("procurement evidence summary requires supplier, MOQ, tier binding, and snapshot proof", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /供应商\/MOQ\/采购阶梯价待核/);
  assert.match(js, /展示价不能替代真实采购阶梯价/);
  assert.match(js, /无法证明当前数量对应的真实采购成本/);
  assert.match(js, /补充来源快照后才可标记为来源已验证/);
  assert.match(js, /打开采购、运费和利润诊断；不会提交 Ozon/);
});

test("system configuration exposes a safe read-only receipt status entry", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /readOperatorReceiptStatus/);
  assert.match(html, /refreshReadOperatorReceipts/);
  assert.match(html, /readOperatorEnvironment/);
  assert.match(html, /listingReadEnvironment/);
  assert.match(html, /refreshReadOperatorMatrix/);
  assert.match(js, /loadReadOperatorReceipts/);
  assert.match(js, /loadReadOperatorMatrix/);
  assert.match(js, /\/api\/ozon\/read-operator\/matrix/);
  assert.match(html, /不会从浏览器直接执行 Ozon 请求/);
  assert.match(js, /不代表写入成功/);
  assert.match(html, /readOperatorReceiptBusinessStatus/);
  assert.match(html, /readOperatorReceiptDiagnostics/);
});

test("system configuration exposes a token-free session proof summary and binds it to the four-store matrix", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /refreshSessionProof/);
  assert.match(html, /sessionProofStatus/);
  assert.match(js, /\/api\/auth\/session-proof/);
  assert.match(js, /不展示 Token/);
  assert.match(js, /renderReadOperatorMatrix\(state\.readOperatorMatrix\)/);
  assert.match(js, /session proof 已获取/);
  assert.doesNotMatch(js, /sessionProofSummary\.token/);
});

test("system configuration uses the authenticated server read route for explicit single-store execution", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /executeReadOperatorCurrentStore/);
  assert.match(html, /readOperatorExecutionStatus/);
  assert.match(html, /readOperatorOfferIds/);
  assert.match(html, /readOperatorProductIds/);
  assert.match(html, /readOperatorLastId/);
  assert.match(js, /\/api\/ozon-learning\/readiness-evidence-receipts\/plan/);
  assert.match(js, /\/api\/ozon\/read-operator\/execute/);
  assert.match(js, /I_CONFIRM_READ_ONLY/);
  assert.match(js, /window\.confirm\("确认执行当前店铺/);
  assert.match(js, /planBinding/);
  assert.match(js, /至少填写一个 Offer ID 或 Product ID/);
  assert.match(js, /const offerIds = splitIds/);
  assert.match(js, /const productIds = splitIds/);
  assert.match(js, /const coverage = report\.endpointCoverage/);
  assert.match(js, /读取范围：\$\{scope\}/);
  assert.doesNotMatch(js, /executeCurrentStoreRead[\s\S]*?ozonRequest/);
});

test("successful controlled product reads refresh the seller product business view", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function executeCurrentStoreRead");
  const end = js.indexOf("function renderSecondaryDomainPanels", start);
  const body = js.slice(start, end);
  assert.match(body, /endpointCoverage/);
  assert.match(body, /\/v3\/product\/list/);
  assert.match(body, /\/v3\/product\/info\/list/);
  assert.match(body, /selectedStoreId\(\)/);
  assert.match(body, /currentSellerReadEnvironment\(\)/);
  assert.match(body, /await loadProducts/);
  assert.match(body, /server_observed/);
  assert.match(body, /endpointCoverage\?\.complete === true/);
});

test("changing the read environment invalidates prior proof, matrix, receipts, and execution state", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /function invalidateReadOperatorEnvironmentEvidence/);
  assert.match(js, /state\.readOperatorReceiptSummary = null/);
  assert.match(js, /state\.readOperatorMatrixEnvironment = ""/);
  assert.match(js, /proofEnvironment !== environment/);
  assert.match(js, /on\("#readOperatorEnvironment", "input", invalidateReadOperatorEnvironmentEvidence\)/);
  assert.match(js, /proofEnvironment !== environment \|\| !Array\.isArray\(state\.sessionProofSummary\.storeIds\)/);
});

test("system configuration exposes migration state with an operator next action", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /migrationStateStatus/);
  assert.match(js, /function renderMigrationStateStatus/);
  assert.match(js, /function loadMigrationStateAudit/);
  assert.match(html, /refreshDeploymentPreflight/);
  assert.match(js, /function loadDeploymentPreflight/);
  assert.match(js, /\/api\/system\/deployment-preflight/);
  assert.match(js, /\/api\/system\/migration-state/);
  assert.match(js, /audit.nextAction/);
  assert.match(js, /不连接数据库/);
  assert.match(js, /deploymentReady !== true/);
  assert.match(js, /本地门禁未发现阻断，但生产未就绪/);
  assert.match(js, /deploymentNotReady/);
  assert.match(js, /item\.check === "disk_space"/);
  assert.match(js, /data\.diskSpace/);
  assert.match(js, /最低要求/);
});

test("deployment preflight UI exposes multiple blocker details instead of hiding backup or migration gaps", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadDeploymentPreflight");
  const end = js.indexOf("// Keep permission/scope failures", start);
  const body = js.slice(start, end);
  assert.match(body, /const blockerList = blockers\.slice\(0, 5\)/);
  assert.match(body, /deployment-preflight-blockers/);
  assert.match(body, /item\?\.blocker\?\.code/);
});

test("read-only receipt status uses the selected environment and shows seller recovery", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /function validateReadOperatorEnvironment/);
  assert.match(js, /READ_OPERATOR_ENVIRONMENT_REQUIRED/);
  assert.match(js, /不能跨环境汇总只读回执/);
  assert.match(js, /const environmentCheck = validateReadOperatorEnvironment\(\$\("#readOperatorEnvironment"\)\?\.value\)/);
  assert.match(js, /const environment = environmentCheck\.environment/);
  assert.match(js, /const storeId = String\(selectedStoreId\(\) \|\| ""\)\.trim\(\)/);
  assert.match(js, /READ_OPERATOR_STORE_SCOPE_REQUIRED/);
  assert.match(js, /storeRefHash = await sha256Text\(storeId\)/);
  assert.match(js, /read-operator\/receipts\$\{query\}/);
  assert.match(js, /sellerTask\.nextAction/);
  assert.match(js, /端点覆盖完整/);
});

test("read-only receipt UI surfaces stale/partial recovery instead of treating it as current", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderReadOperatorReceiptStatus");
  const end = js.indexOf("async function loadReadOperatorReceipts", start);
  const view = js.slice(start, end);
  assert.match(view, /readOperatorReceiptFreshnessRecovery/);
  assert.match(view, /recovery.nextAction/);
  assert.match(js, /只读结果待核验/);
  assert.match(view, /真实读取不代表写入成功/);
  assert.match(view, /latest\?\.stale === true/);
  assert.match(view, /stale（已过期）/);
  assert.match(view, /target\.dataset\.state/);
  assert.match(js, /function renderReadOperatorReceiptBusinessCard/);
  assert.match(js, /只读取本地脱敏回执/);
  assert.match(js, /endpointCoverageComplete/);
  assert.match(js, /receiptId:/);
});

test("controlled-read UI labels only persisted server receipts and keeps refresh read-only", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderReadOperatorReceiptStatus");
  const end = js.indexOf("async function loadReadOperatorReceipts", start);
  const view = js.slice(start, end);
  assert.match(view, /服务端回执/);
  assert.match(view, /不会联网/);
  assert.match(view, /真实读取不代表写入成功/);
  assert.doesNotMatch(view, /verificationLevel\s*=\s*["']server_observed/);
});

test("listing seller task summary keeps category and required attributes in the same golden-path view", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const categoryText/);
  assert.match(js, /const attributeText/);
  assert.match(js, /Ozon 类目/);
  assert.match(js, /必填属性/);
  assert.match(js, /系统尚未找到可靠类目/);
  assert.match(js, /自动匹配，不需要你操作/);
});

test("category and required-attribute workbench surfaces stale cache recovery actions", async () => {
  const [js, source] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
  ]);
  assert.match(source, /CATEGORY_CACHE_STORE_MISMATCH/);
  assert.match(source, /不能把过期缓存当作当前类目证据/);
  assert.match(source, /valueFreshness\.usable/);
  assert.match(js, /category-cache\/refresh/);
  assert.match(js, /先刷新当前店铺的 Ozon 类目树/);
  assert.match(js, /字典值和敏感属性仍需按字段确认/);
  assert.match(js, /function currentSellerReadEnvironment/);
  assert.match(js, /environment: currentSellerReadEnvironment\(\)/);
  assert.match(js, /description-categories\?storeId=.*environment=/);
});

test("ordinary seller dashboard exposes the golden-path task summary", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /goldenPathSellerTaskPanel/);
  assert.match(html, /goldenPathSellerTaskStatus/);
  assert.match(js, /function latestGoldenPathSellerTask/);
  assert.match(js, /run\?\.goldenPathSellerTask \|\| run\?\.summary\?\.goldenPathSellerTask/);
  assert.match(js, /function renderGoldenPathSellerTask/);
  assert.match(js, /stageProgress/);
  assert.match(js, /链路进度/);
  assert.match(js, /renderGoldenPathSellerTask\(\)/);
  assert.match(js, /去采集 1688 商品/);
  assert.match(js, /data-cockpit-view="sourcing"/);
  assert.match(js, /blockedStageLabel/);
  assert.match(js, /1688 货源采集/);
  assert.match(js, /不会调用 Ozon 写接口/);
});

test("every view exposes one current product task with capture review taking priority", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="globalCurrentTaskBar"/);
  assert.match(html, /id="globalCurrentTaskBody"/);
  assert.match(js, /function currentCaptureSellerTask/);
  assert.match(js, /function renderGlobalCurrentTaskBar/);
  assert.match(js, /function openCurrentCaptureTask/);
  assert.match(js, /data-global-capture-id/);
  assert.match(js, /state\.currentCaptureId \|\| new URLSearchParams\(window\.location\.search\)\.get\("captureId"\)/);
  assert.match(js, /extension_browser\|browser_extension/);
  assert.doesNotMatch(js, /const rank = reviewNeeded \?/);
  assert.match(js, /await switchStoreContext\(storeId, \{ loadWarehouses: false \}\)/);
  assert.match(js, /async function switchStoreContext\(storeId, \{ loadWarehouses = true \} = \{\}\)/);
  assert.match(js, /if \(loadWarehouses\) await loadListingWarehouses\(\)/);
  assert.match(js, /dispatchEvent\(new Event\("change"\)\)/);
  assert.match(css, /\.global-current-task-bar/);
});

test("capture table keeps the source compact and the action column visible", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /capture-table-wrap/);
  assert.match(html, /capture-box-table/);
  assert.match(js, /capture-source-url/);
  assert.match(css, /\.capture-box-table[\s\S]*table-layout:\s*fixed/);
  assert.match(css, /\.capture-box-table \.row-actions[\s\S]*position:\s*sticky/);
  assert.match(css, /\.capture-source-url[\s\S]*text-overflow:\s*ellipsis/);
});

test("seller workflow console hides fixture runs unless advanced data is requested", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="toggleSyntheticWorkflows"/);
  assert.match(html, /id="syntheticWorkflowNotice"/);
  assert.match(js, /showSyntheticWorkflows:\s*false/);
  assert.match(js, /function isSyntheticWorkflowRun/);
  assert.match(js, /function sellerWorkflowRuns/);
  assert.match(js, /sourceMarkers\.some/);
  assert.match(js, /\^\(fixture product\|test product\|测试商品\|demo product\)/);
  assert.doesNotMatch(js, /fixture\\b\|test\[_ -\]workflow/);
  assert.match(js, /测试数据已隐藏/);
});

test("listing category workbench exposes current-store evidence status", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /categoryEvidenceStatus/);
  assert.match(js, /state\.categoryEvidence/);
  assert.match(js, /renderCategoryEvidenceStatus/);
  assert.match(js, /server_observed/);
  assert.match(html, /旧缓存不会自动当作当前证据/);
  assert.match(css, /category-evidence-status/);
});

test("listing attributes reject a late or cross-store category receipt before rebuilding the draft", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function loadListingAttributes");
  const end = js.indexOf("function renderCategoryEvidenceStatus", start);
  const body = js.slice(start, end);
  assert.match(body, /categoryAttributeRequestToken/);
  assert.match(body, /selectedStoreId\(\)/);
  assert.match(body, /currentSellerReadEnvironment\(\)/);
  assert.match(body, /operationEvidence/);
  assert.match(body, /environmentRefHash/);
  assert.match(body, /不会使用跨店铺或跨环境的类目属性回执/);
});

test("listing attribute inputs do not invent numeric product facts", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /const value = item\.value == null \? "" : String\(item\.value\)/);
  assert.match(js, /填写真实数值；不能使用示例值/);
  assert.doesNotMatch(js, /item\.type === "Integer" \|\| item\.type === "Decimal" \? "1"/);
});

test("store switching clears category evidence before the next read", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const storeChange = js.slice(js.indexOf('on("#storeSelect", "change"'));
  assert.match(storeChange, /state\.categoryEvidence = \{ tree: null, attributes: null \}/);
  assert.match(storeChange, /renderCategoryEvidenceStatus\(\)/);
});

test("after-sales metrics do not turn an incomplete order read into zero disputes", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /const orderCoverageKnown = orderBatch\?\.loaded === true/);
  assert.match(js, /const disputeOrders = orderCoverageKnown \?/);
  assert.match(js, /争议订单范围未知/);
  assert.match(js, /取消订单范围未知/);
});

test("candidate actions preserve the candidate store scope", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function bindCrawlerCandidateRows");
  const end = js.indexOf("async function createListingDraftFromCandidate", start);
  const body = js.slice(start, end);
  assert.match(body, /const candidateStoreId = String\(row\.dataset\.storeId \|\| \"\"\)\.trim\(\)/);
  assert.match(body, /status: "ignored", storeId: candidateStoreId/);
  assert.match(body, /moveCrawlerCandidateToCapture\(id, candidateStoreId\)/);
});

test("dictionary repair queue scopes a writeback candidate to the same SKU", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /const rowOfferId = String\(row\.offerId \|\| row\.offer_id \|\| \"\"\)\.trim\(\)/);
  assert.match(js, /scopedRepairCandidates\.find\(\(candidate\) => String\(candidate\.offerId \|\| \"\"\)\.trim\(\) === rowOfferId\)/);
  assert.match(js, /never fall back to another SKU's candidate/);
});

test("store switching clears controlled-read receipts and plans", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const storeChange = js.slice(js.indexOf('on("#storeSelect", "change"'));
  assert.match(storeChange, /state\.readOperatorReceiptSummary = null/);
  assert.match(storeChange, /state\.readOperatorMatrixEnvironment = ""/);
  assert.match(storeChange, /renderReadOperatorExecutionStatus\(\)/);
});

test("store switching clears activity rows before finance summaries render", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const storeChange = js.slice(js.indexOf('on("#storeSelect", "change"'));
  assert.match(storeChange, /state\.promotionRows = \[\]/);
  assert.match(storeChange, /state\.promotionEvidence = null/);
  assert.match(storeChange, /state\.promotionImpactPreview = null/);
  assert.match(storeChange, /renderSecondaryDomainPanels\(\)/);
});

test("store switching clears product rows before inventory handoff can reuse an old Offer", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf('on("#storeSelect", "change"');
  const end = js.indexOf('on("#readOperatorEnvironment"', start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /state\.productRequestToken = Number\(state\.productRequestToken \|\| 0\) \+ 1/);
  assert.match(body, /state\.productRows = \[\]/);
  assert.match(body, /state\.productReadState = "idle"/);
  assert.match(body, /已切换店铺，请重新读取当前店铺商品/);
  assert.match(body, /state\.productHasNext = false/);
});

test("candidate handoff without a workflow cannot fall back to another product", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /state\.selectedWorkflowRunId = "__no_workflow__"/);
  assert.match(js, /if \(!data\.workflowRunId\)/);
  assert.match(js, /不能进入预检/);
});

test("adding a blank listing variant does not invent 100 units of stock", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function clearListingSourceFields");
  const end = js.indexOf("function assertListingBoundToCapture", start);
  const body = js.slice(start, end);
  assert.match(body, /id="listingStock" value="" placeholder="读取真实库存后填写"/);
  assert.doesNotMatch(body, /id="listingStock" value="100"/);
});

test("listing seller task summary keeps Russian content evidence in the golden path", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /contentSellerResult/);
  assert.match(js, /const contentText/);
  assert.match(js, /俄文内容/);
  assert.match(js, /俄文内容被来源事实阻塞/);
});

test("listing seller task summary routes the primary action by golden-path blocker", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /补齐来源证据/);
  assert.match(js, /确认 Ozon 类目/);
  assert.match(js, /nodeKey: "category_match"/);
  assert.match(js, /核对俄文内容/);
  assert.match(js, /运行提交前预检/);
  assert.match(js, /action,\n    runId/);
});

test("listing seller summary routes a known media blocker before package or pricing work", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function listingSellerTaskSummaryModel");
  const end = js.indexOf("function mediaSellerRiskItems", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /const mediaIssues = Array\.isArray\(context\.mediaIssues\)/);
  assert.match(body, /const mediaBlocked = mediaIssues\.length > 0/);
  assert.match(body, /label: "处理媒体审查"/);
  assert.match(body, /不会上传媒体或提交 Ozon/);
  assert.ok(body.indexOf("mediaBlocked") < body.indexOf("!packageReady"));
  assert.ok(body.indexOf("mediaBlocked") < body.indexOf("pricingBlocked"));
  assert.match(js, /mediaIssues,\n    skuCount/);
});

test("listing seller summary exposes automatic category recommendation and syncs current-store evidence without a manual search", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const summaryStart = js.indexOf("function listingSellerTaskSummaryModel");
  const summaryEnd = js.indexOf("function mediaSellerRiskItems", summaryStart);
  const summary = js.slice(summaryStart, summaryEnd);
  const syncStart = js.indexOf("async function autoSyncListingCategoryEvidence");
  const syncEnd = js.indexOf("function renderListingSellerContentEvidence", syncStart);
  const sync = js.slice(syncStart, syncEnd);

  assert.match(summary, /categoryDecision\?\.selected/);
  assert.match(summary, /自动匹配，不需要你操作/);
  assert.match(summary, /系统正在后台载入店铺类目数据/);
  assert.match(summary, /系统找到多个接近类目/);
  assert.match(js, /summary\.categoryStatusText/);
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  assert.match(sync, /auto_matched_evidence_pending/);
  assert.match(sync, /\/api\/ozon\/category-cache\/refresh/);
  assert.match(sync, /\/api\/ozon\/description-attributes/);
  assert.match(sync, /description_category_id: decision\.selected\.description_category_id/);
  assert.match(sync, /\/api\/1688\/captures\/\$\{encodeURIComponent\(captureId\)\}\/workflow/);
  assert.match(sync, /categoryAutoSyncKeys/);
  assert.match(sync, /categoryAutoSyncRetryAt/);
  assert.match(sync, /5 \* 60 \* 1000/);
});

test("preflight success is labeled as not submitted until the submit reservation exists", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderWorkflowDetail");
  const end = js.indexOf("function renderWorkflowConsole", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /预检通过（尚未提交）/);
  assert.match(body, /已提交，等待审核回查/);
  assert.match(body, /submissionState === "completed"/);
  assert.match(body, /确认提交 Ozon/);
  assert.match(body, /预检通过并确认草稿哈希后才会调用 Ozon/);
});

test("task readback does not mislabel a pending import as published", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function checkListingTask");
  const end = js.indexOf("function applyImportInfoToVariantRows", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /saveListingDraft\("submitted"/);
  assert.match(body, /taskReadbackStatus/);
  assert.match(body, /taskReadbackEvidence/);
  assert.doesNotMatch(body, /saveListingDraft\("published"/);
});

test("unresolved submission result outranks stale sale-ready/review states", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function listingSellerTaskSummaryModel");
  const end = js.indexOf("function mediaSellerRiskItems", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(js, /submission_needs_review: "提交结果待复核"/);
  assert.match(body, /const submissionNeedsReview = String\(run\?\.submissionReservation\?\.state/);
  assert.match(body, /else if \(submissionNeedsReview\) stateName = "submission_needs_review"/);
  assert.match(body, /label: "回查提交结果"/);
  assert.match(body, /不会重复提交或自动重试/);
  assert.match(body, /submissionNeedsReview \? "提交结果待复核"/);
  assert.ok(body.indexOf("submissionNeedsReview") < body.indexOf("reviewSucceeded && !stockSucceeded"));
});

test("workflow refresh and selection keep the seller listing summary in sync", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const loadStart = js.indexOf("async function loadWorkflowRuns");
  const loadEnd = js.indexOf("async function loadRuleApprovalAuditIntents", loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.match(js.slice(loadStart, loadEnd), /renderListingSellerTaskSummary\(\)/);
  const listStart = js.indexOf('$("#workflowRunList")?.addEventListener("click"');
  const listEnd = js.indexOf('$("#workflowNodeTimeline")?.addEventListener', listStart);
  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.match(js.slice(listStart, listEnd), /state\.selectedWorkflowRunId/);
  assert.match(js.slice(listStart, listEnd), /renderListingSellerTaskSummary\(\)/);
});

test("listing seller task summary keeps package and pricing evidence in the golden path", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(js, /const packageInfo/);
  assert.match(js, /const packageText/);
  assert.match(js, /包装尺重/);
  assert.match(js, /const pricingText/);
  assert.match(js, /定价与利润/);
  assert.match(js, /修复定价风险/);
});

test("listing seller summary exposes payload source snapshot evidence without raw page data", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderListingSellerSourceBinding");
  const end = js.indexOf("function renderListingSellerEvidenceActions", start);
  assert.ok(start >= 0 && end > start);
  const renderer = js.slice(start, end);
  assert.match(renderer, /run\.payloadDraft\.summary/);
  assert.match(renderer, /sourceEvidence/);
  assert.match(renderer, /hashShort/);
  assert.match(renderer, /Offer/);
  assert.match(renderer, /来源 SKU/);
  assert.match(renderer, /下一步：/);
  assert.match(renderer, /verificationState === "waiting_human"/);
  assert.doesNotMatch(renderer, /canonicalUrl/);
  assert.doesNotMatch(renderer, /apiKey|cookie|password/i);
});

test("listing preflight renders seller evidence summary and next actions", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /const evidenceSummary = result\.evidenceSummary/);
  assert.match(js, /提交前证据/);
  assert.match(js, /evidenceStatusLabels/);
  assert.match(js, /evidence\.nextAction/);
});

test("listing preflight exposes media evidence and keeps the upload boundary explicit", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function listingPreflightMediaEvidence");
  const end = js.indexOf("function renderListingSellerPayloadIssues", start);
  assert.ok(start >= 0 && end > start);
  const renderer = js.slice(start, end);
  assert.match(renderer, /mediaAssets/);
  assert.match(renderer, /published_local/);
  assert.match(renderer, /媒体/);
  assert.match(renderer, /不会上传媒体或提交 Ozon/);
  assert.match(renderer, /evidenceLabels = .*media/);
  assert.match(renderer, /evidenceSummaryWithMedia/);
});

test("order rows expose status-aware safe next steps before any fulfillment action", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function orderSellerNextAction");
  const end = js.indexOf("async function loadFbsOrderDetail", start);
  assert.ok(start >= 0 && end > start);
  const renderer = js.slice(start, end);
  assert.match(renderer, /争议\/售后处理/);
  assert.match(renderer, /截止时间已过/);
  assert.match(renderer, /SKU 与数量/);
  assert.match(renderer, /不要备货或发运/);
  assert.match(renderer, /本页不执行发运/);
  assert.match(renderer, /卖家下一步：/);
});

test("completed listing submission exposes a one-click readback path with the returned task id", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderListingSellerPreflightResult");
  const end = js.indexOf("function renderListingSellerPayloadIssues", start);
  assert.ok(start >= 0 && end > start);
  const renderer = js.slice(start, end);
  assert.match(renderer, /submission\.state === "completed"/);
  assert.match(renderer, /data-seller-task-readback/);
  assert.match(renderer, /回查 Ozon 审核状态/);
  assert.match(js, /function openListingTaskReadback/);
  assert.match(js, /点击“读取任务结果”只回查 Ozon/);
  assert.doesNotMatch(js.slice(js.indexOf("function openListingTaskReadback"), js.indexOf("function renderListingSellerPayloadIssues")), /submitListing\s*\(/);
});

test("task readback feeds the scoped review reconciliation node", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function checkListingTask");
  const end = js.indexOf("function applyImportInfoToVariantRows", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /product-import-info/);
  assert.match(body, /workflowRunId: state\.selectedWorkflowRunId/);
  assert.match(body, /reconcile-submitted/);
  assert.match(body, /jobId: currentJob\.id/);
  assert.match(body, /taskId/);
  assert.match(body, /reviewReconciliation/);
  assert.doesNotMatch(body, /submit-payload-draft/);
});

test("review failures expose a seller-facing local draft repair entry", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderReviewRepairDraft");
  const end = js.indexOf("function renderWorkflowDetail", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /data-review-repair-return/);
  assert.match(body, /打开本地草稿修复台/);
  assert.match(body, /不会自动提交/);
  assert.match(js, /function openReviewRepairDraft/);
  assert.match(js, /保存后必须重新预检/);
});

test("manual evidence forms feed one bottom action and do not expose competing save buttons", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderListingSellerTaskSummary");
  const end = js.indexOf("async function autoSyncListingCategoryEvidence", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /data-listing-auto-complete/);
  assert.match(body, /保存并自动完成其余资料/);
  assert.doesNotMatch(body, /data-manual-(?:content|procurement|package)-save/);
  assert.doesNotMatch(body, /保存尺重证据并重新预检|保存并重新预检/);
});

test("four-store read matrix shows seller store names next to masked evidence", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function renderReadOperatorMatrix");
  const end = js.indexOf("function renderSessionProofStatus", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /storeLabel/);
  assert.match(body, /storeRefHash/);
  assert.match(body, /escapeHtml\(storeLabel\)/);
  assert.match(body, /escapeHtml\(shortHash\)/);
});

test("seller read failures explain session, environment, and scope recovery", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function sellerReadAccessRecovery");
  const end = js.indexOf("function selectedStoreId", start);
  assert.ok(start >= 0 && end > start);
  const helper = js.slice(start, end);
  assert.match(helper, /READ_OPERATOR_SIGNED_SESSION_REQUIRED/);
  assert.match(helper, /READ_OPERATOR_SESSION_ENVIRONMENT_MISMATCH/);
  assert.match(helper, /READ_OPERATOR_SESSION_SCOPE_REQUIRED/);
  assert.match(js.slice(js.indexOf("async function loadWarehouses"), js.indexOf("async function loadListingWarehouses")), /sellerReadAccessRecovery/);
  assert.match(js.slice(js.indexOf("async function loadOrders"), js.indexOf("function updateOrderCounts")), /sellerReadAccessRecovery/);
  assert.match(js.slice(js.indexOf("async function loadProducts"), js.indexOf("function productAssetSnapshot")), /sellerReadAccessRecovery/);
});

test("stock page does not ship a synthetic Offer ID as a seller target", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf('id="stockOfferId"');
  assert.ok(start >= 0);
  const input = html.slice(Math.max(0, start - 120), start + 260);
  assert.match(input, /value=""/);
  assert.match(input, /先从商品页带入，或填写真实 Offer ID/);
  assert.doesNotMatch(input, /SKU00259|оранжевый-hello/);
  const targetEditorStart = html.indexOf('id="stockJson"');
  assert.ok(targetEditorStart >= 0);
  const targetEditor = html.slice(targetEditorStart, targetEditorStart + 180);
  assert.match(targetEditor, />\[\]<\/textarea>/);
  assert.doesNotMatch(targetEditor, /warehouse_id|"stock"/);
});

test("listing workbench starts without fake product, price, stock, or package evidence", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(html, /中文测试商品名称|TEST-CN-OFFER-001/);
  assert.match(html, /id="listingName" value=""/);
  assert.match(html, /id="listingOfferId" value=""/);
  assert.match(js, /const DEFAULT_LISTING_STOCK = ""/);
  assert.match(js, /purchasePrice \|\| ""/);
});

test("test API action validates read environment and store before network", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function testApi");
  const end = js.indexOf("function runtimeSafetySellerStatus", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /validateReadOperatorEnvironment\(currentSellerReadEnvironment\(\)\)/);
  assert.match(body, /if \(!selectedStoreId\(\)\)/);
  assert.match(body, /本次未发起 API 请求/);
  assert.ok(body.indexOf("validateReadOperatorEnvironment") < body.indexOf("setBusy"));
});

test("price calculator rejects blank evidence before network", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("async function calculatePrice");
  const end = js.indexOf("function flattenCategories", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /const required = \[/);
  assert.match(body, /请先填写有效的\$\{label\}/);
  assert.match(body, /当前没有发起定价请求/);
  assert.ok(body.indexOf("const required") < body.indexOf("setBusy"));
});

test("general Seller reads prefer the system environment over a stale listing environment", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function currentSellerReadEnvironment");
  const end = js.indexOf("// Keep the ordinary operator view", start);
  assert.ok(start >= 0 && end > start);
  const body = js.slice(start, end);
  assert.match(body, /readOperatorEnvironment.*listingReadEnvironment/);
  assert.match(body, /stale listing value must not poison unrelated/);
});

test("current product workspace never falls back to an unrelated or synthetic workflow", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function canonicalCurrentCaptureWorkflowRun");
  const end = js.indexOf("function currentListingAutoListJob", start);
  assert.ok(start >= 0 && end > start);
  const helper = js.slice(start, end);
  assert.match(helper, /currentCaptureSellerTask\(\)/);
  assert.match(helper, /filter\(\(run\) => !isSyntheticWorkflowRun\(run\)\)/);
  assert.match(helper, /entity\?\.candidateId/);
  assert.match(helper, /entity\?\.storeId/);
  assert.doesNotMatch(helper, /sort\([\s\S]*\)\[0\]/);
});

test("canonical current product resolver fails closed for synthetic, stale, and unconfirmed workflows", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const syntheticStart = js.indexOf("function isSyntheticWorkflowRun");
  const syntheticEnd = js.indexOf("function sellerWorkflowRuns", syntheticStart);
  const resolverStart = js.indexOf("function canonicalCurrentCaptureWorkflowRun");
  const resolverEnd = js.indexOf("function currentListingAutoListJob", resolverStart);
  assert.ok(syntheticStart >= 0 && syntheticEnd > syntheticStart && resolverStart >= 0 && resolverEnd > resolverStart);
  const state = {
    selectedWorkflowRunId: "stale-real",
    workflowRuns: [
      { id: "stale-real", entity: { candidateId: "other", storeId: "store-1" } },
      { id: "synthetic-exact", synthetic: true, entity: { candidateId: "capture-1", storeId: "store-1" } },
      { id: "real-exact", entity: { candidateId: "capture-1", storeId: "store-1" } },
    ],
  };
  let captureTask = { item: { id: "capture-1", storeId: "store-1" }, reviewApproved: false };
  const build = new Function("state", "currentCaptureSellerTask", `${js.slice(syntheticStart, syntheticEnd)}\n${js.slice(resolverStart, resolverEnd)}\nreturn { canonicalCurrentCaptureWorkflowRun, currentListingWorkflowRun, workflowCanActForCurrentProduct };`);
  const resolver = build(state, () => captureTask);
  assert.equal(resolver.currentListingWorkflowRun()?.id, "real-exact");
  assert.equal(resolver.workflowCanActForCurrentProduct(state.workflowRuns[2]), false);
  captureTask = { ...captureTask, reviewApproved: true };
  assert.equal(resolver.workflowCanActForCurrentProduct(state.workflowRuns[2]), true);
  assert.equal(resolver.workflowCanActForCurrentProduct(state.workflowRuns[1]), false);
  captureTask = null;
  assert.equal(resolver.workflowCanActForCurrentProduct(state.workflowRuns[2]), false);
  assert.equal(resolver.currentListingWorkflowRun(), null);
  captureTask = { item: { id: "capture-1", storeId: "store-1" }, reviewApproved: true };
  state.workflowRuns = state.workflowRuns.filter((run) => run.id !== "real-exact");
  assert.equal(resolver.currentListingWorkflowRun(), null);
});

test("invalid source snapshot remains blocked behind seller language", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function currentProductWorkspaceModel");
  const end = js.indexOf("function renderCurrentProductWorkspace", start);
  assert.ok(start >= 0 && end > start);
  const state = { stores: [{ id: "store-1", name: "Store 1" }] };
  const captureTask = {
    item: { id: "capture-1", storeId: "store-1" },
    product: { title: "Real item", skuVariants: [] },
    reviewApproved: false,
    reviewPossible: false,
    reviewNeeded: true,
    hasDraft: true,
  };
  const build = new Function("state", "currentCaptureSellerTask", "currentListingWorkflowRun", `${js.slice(start, end)}\nreturn currentProductWorkspaceModel;`);
  const model = build(state, () => captureTask, () => ({ id: "old-run", payloadDraftValidation: { ok: true } }))();
  assert.equal(model.status, "商品资料不完整");
  assert.equal(model.actionLabel, "重新采集商品");
  assert.equal(model.actionKind, "capture");
  assert.equal(model.stages.length, 3);
  assert.equal(model.stages[0].status, "current");
  assert.equal(model.stages[1].status, "pending");
  assert.equal(model.completed.some((item) => item.includes("人工确认")), false);
});

test("three seller steps stay aligned across review, draft, and ready states", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function currentProductWorkspaceModel");
  const end = js.indexOf("function renderCurrentProductWorkspace", start);
  assert.ok(start >= 0 && end > start);
  const state = { stores: [{ id: "store-1", name: "Store 1" }] };
  let captureTask = {
    item: { id: "capture-1", storeId: "store-1" },
    product: { title: "Real item", skuVariants: [], images: ["javascript:alert(1)"] },
    reviewApproved: false,
    reviewPossible: true,
    reviewNeeded: true,
    hasDraft: false,
  };
  let run = null;
  const build = new Function("state", "currentCaptureSellerTask", "currentListingWorkflowRun", `${js.slice(start, end)}\nreturn currentProductWorkspaceModel;`);
  const model = build(state, () => captureTask, () => run);

  const review = model();
  assert.deepEqual(review.stages.map((stage) => stage.status), ["complete", "current", "pending"]);
  assert.equal(review.actionLabel, "确认这是我的商品");
  assert.equal(review.actionKind, "capture_review");
  assert.equal(review.imageUrl, "");

  captureTask = { ...captureTask, reviewApproved: true, reviewNeeded: false, hasDraft: false };
  const pendingDraft = model();
  assert.equal(pendingDraft.actionLabel, "建立商品草稿");
  assert.equal(pendingDraft.actionKind, "capture_workflow");

  captureTask = { ...captureTask, hasDraft: true };
  const detachedDraft = model();
  assert.equal(detachedDraft.actionLabel, "打开商品资料");
  assert.equal(detachedDraft.actionKind, "capture_workflow");

  captureTask = { ...captureTask, reviewApproved: true, reviewNeeded: false, hasDraft: true };
  run = {
    id: "run-1",
    payloadDraftHash: "sha256:draft-v1",
    payloadDraftValidation: { ok: false, issues: [{ code: "MISSING" }, { code: "MISSING_2" }] },
    summary: { currentProductTask: { reason: "Payload 提交前预检缺少证据" } },
  };
  const draft = model();
  assert.deepEqual(draft.stages.map((stage) => stage.status), ["complete", "current", "pending"]);
  assert.equal(draft.status, "需要补充 2 项资料");
  assert.equal(draft.actionKind, "workflow");
  assert.equal(draft.reason, "还有 2 项资料无法自动判断，需要你确认。");
  assert.equal(draft.userInstruction, "只补充系统无法确定的内容，不需要重做已经完成的资料。");
  assert.equal(draft.systemNext, "系统会重新检查商品；通过后再通知你确认是否上架。");
  assert.equal(draft.safetyBoundary, "现在不会提交到 Ozon，也不会调用任何付费 AI；两者都需你另行确认。");
  assert.doesNotMatch(draft.reason, /Payload|预检|证据|workflow|snapshot/i);

  run = {
    ...run,
    validatedDraftHash: "sha256:old-draft",
    payloadDraftValidation: { ok: true, draftHash: "sha256:old-draft", issues: [] },
  };
  const stale = model();
  assert.deepEqual(stale.stages.map((stage) => stage.status), ["complete", "current", "pending"]);
  assert.equal(stale.status, "商品有更新，需要重新检查");
  assert.equal(stale.actionLabel, "重新检查商品");

  run = {
    ...run,
    validatedDraftHash: "sha256:draft-v1",
    payloadDraftValidation: { ok: true, draftHash: "sha256:draft-v1", issues: [] },
  };
  const ready = model();
  assert.deepEqual(ready.stages.map((stage) => stage.status), ["complete", "complete", "current"]);
  assert.equal(ready.actionLabel, "确认上架");
  assert.equal(ready.actionKind, "workflow");
  assert.equal(ready.userInstruction, "核对商品摘要和价格，决定是否进入最后确认。");
  assert.equal(ready.systemNext, "系统会先展示本次提交内容；仍需你再次确认才会提交。");
});

test("capture confirmation accepts canonical and legacy snapshot evidence", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function captureSnapshotHash");
  const end = js.indexOf("function currentCaptureSellerTask", start);
  assert.ok(start >= 0 && end > start);
  const helper = new Function(`${js.slice(start, end)}\nreturn captureSnapshotHash;`)();
  const canonical = `sha256:${"a".repeat(64)}`;
  const legacy = `sha256:${"b".repeat(64)}`;
  assert.equal(helper({ parsed: { sourceEvidenceRecord: { snapshot: { hash: canonical } } } }), canonical);
  assert.equal(helper({ parsed: { sourceEvidence: { snapshotHash: legacy } } }), legacy);
});

test("current product action attributes match the business action promised by every state", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function currentProductActionAttributes");
  const end = js.indexOf("function renderCurrentProductWorkspace", start);
  assert.ok(start >= 0 && end > start);
  const build = new Function("escapeHtml", `${js.slice(start, end)}\nreturn currentProductActionAttributes;`);
  const attrs = build((value) => String(value));
  assert.match(attrs({ actionKind: "view", actionView: "sourcing" }), /data-cockpit-view="sourcing"/);
  assert.match(attrs({ actionKind: "capture", captureId: "c1", storeId: "s1" }), /data-current-capture-id="c1"/);
  assert.match(attrs({ actionKind: "capture_review", captureId: "c1", storeId: "s1" }), /data-current-capture-review="c1"/);
  assert.match(attrs({ actionKind: "capture_workflow", captureId: "c1", storeId: "s1" }), /data-current-capture-workflow="c1"/);
  const workflowAttrs = attrs({ actionKind: "workflow", runId: "r1", storeId: "s1" });
  assert.match(workflowAttrs, /data-current-workflow-id="r1"/);
  assert.match(workflowAttrs, /data-current-workflow-store-id="s1"/);
  assert.throws(() => attrs({ actionKind: "workflow", runId: "" }), /当前商品动作缺少工作流/);
});

test("seller workspace uses a product-grade visual shell without changing the three-step contract", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<svg viewBox="0 0 24 24"/);
  assert.match(html, /商品运营中心/);
  assert.match(html, />检查连接</);
  assert.match(js, /const imageUrl = \/\^https\?:\\\/\\\//);
  assert.match(js, /class="current-product-thumbnail"/);
  assert.match(js, /referrerpolicy="no-referrer"/);
  assert.match(css, /Premium seller shell/);
  assert.match(css, /body\[data-active-view="dashboard"\]\.auto-ozon-erp-shell \.main[\s\S]*padding-top: 0/);
  assert.match(css, /\.current-product-progress[\s\S]*grid-template-columns: repeat\(3, 1fr\)/);
  assert.match(css, /\.current-product-thumbnail img[\s\S]*object-fit: cover/);
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.auto-ozon-erp-shell \.main \{[\s\S]*margin-left: 0[\s\S]*padding-top: 0/);
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.auto-ozon-erp-shell \.global-current-task-bar \{[\s\S]*position: static[\s\S]*inset: auto/);
});

test("dashboard explains user responsibility, automation responsibility, and the next safe action", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /class="seller-responsibility-strip"/);
  assert.match(html, /你只负责/);
  assert.match(html, /系统和 AI 负责/);
  assert.match(html, /选商品、确认必要资料、最后决定是否上架/);
  assert.match(js, /现在只做这一步/);
  assert.match(js, /点完以后/);
  assert.match(js, /安全边界/);
  assert.match(js, /model\.userInstruction/);
  assert.match(js, /model\.systemNext/);
  assert.match(js, /model\.safetyBoundary/);
  assert.match(js, /aria-describedby="currentProductActionDescription currentProductActionSafety"/);
  assert.match(js, /reviewCurrentProductFromWorkspace/);
  assert.match(js, /openCurrentProductDraftFromWorkspace/);
  assert.match(js, /openCurrentProductWorkflowFromWorkspace/);
  assert.match(js, /switchStoreContext\(storeId, \{ loadWarehouses: false \}\)/);
  assert.doesNotMatch(js, /确认快照 \$\{shortHash\}/);
  assert.match(css, /\.seller-responsibility-strip/);
  assert.match(css, /\.current-product-action-explanation/);
});

test("dashboard and listing share one current product workspace", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="currentProductWorkspace"/);
  assert.match(html, /id="currentProductProgress"/);
  assert.match(html, /id="currentProductCompleted"/);
  assert.match(html, /id="currentProductRequired"/);
  assert.match(html, /id="listingCurrentProductGate"/);
  assert.match(html, /class="listing-advanced-workbench"/);
  assert.match(js, /function currentProductWorkspaceModel/);
  assert.match(js, /function renderCurrentProductWorkspace/);
  assert.match(js, /renderCurrentProductWorkspace\(\)/);
});

test("ordinary current product workspace exposes three seller steps and hides internal process language", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  const headerStart = html.indexOf('<section id="dashboard"');
  const headerEnd = html.indexOf('<details class="dashboard-advanced-workbench"', headerStart);
  const ordinaryDashboard = html.slice(headerStart, headerEnd);
  const modelStart = js.indexOf("function currentProductWorkspaceModel");
  const modelEnd = js.indexOf("function renderCurrentProductWorkspace", modelStart);
  const model = js.slice(modelStart, modelEnd);
  assert.match(ordinaryDashboard, /今天只处理一件商品/);
  assert.match(ordinaryDashboard, /系统和 AI 负责/);
  assert.match(ordinaryDashboard, /class="current-product-task-card required-card" hidden/);
  assert.match(html, /<body[^>]+data-active-view="dashboard"/);
  assert.match(css, /body\[data-active-view="dashboard"\] \.global-current-task-bar[\s\S]*display: none/);
  assert.match(model, /采集商品/);
  assert.match(model, /检查商品/);
  assert.match(model, /确认上架/);
  assert.doesNotMatch(model, /来源快照|snapshot hash|提交前预检|本地草稿骨架/);
});

test("unconfirmed real capture remains the only seller action before a workflow exists", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = js.indexOf("function currentProductWorkspaceModel");
  const end = js.indexOf("function renderCurrentProductWorkspace", start);
  assert.ok(start >= 0 && end > start);
  const model = js.slice(start, end);
  assert.match(model, /等待你确认商品/);
  assert.match(model, /确认这是我的商品/);
  assert.match(model, /系统会建立本地商品草稿并打开资料页/);
  assert.match(model, /actionKind = "capture_review"/);
  assert.match(model, /reviewNeeded/);
  assert.match(model, /currentListingWorkflowRun\(\)/);
});

test("current capture row stays highlighted and reports unique source SKUs", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  const start = js.indexOf("function renderCaptureBox");
  const end = js.indexOf("function selectedCaptureSelections", start);
  assert.ok(start >= 0 && end > start);
  const renderer = js.slice(start, end);
  assert.match(renderer, /capture-current-product/);
  assert.match(renderer, /当前要处理的商品/);
  assert.match(renderer, /uniqueSkuIds/);
  assert.match(renderer, /现在只做这一步/);
  assert.match(css, /\.capture-current-product \.review-capture/);
  assert.match(css, /\.capture-current-product \.preflight-capture[\s\S]*display: none/);
});

test("1688 sourcing is a plugin inbox instead of an expanded engineering console", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  const sourcingStart = html.indexOf('<section id="sourcing"');
  const advancedStart = html.indexOf('class="sourcing-advanced-disclosure"', sourcingStart);
  const ordinarySourcing = html.slice(sourcingStart, advancedStart);
  assert.ok(sourcingStart >= 0 && advancedStart > sourcingStart);
  assert.match(ordinarySourcing, /1688 商品采集/);
  assert.match(ordinarySourcing, /补齐后入箱/);
  assert.match(ordinarySourcing, /id="crawlerWorkerStatus"/);
  assert.match(ordinarySourcing, /id="sourcingCurrentProduct"/);
  assert.doesNotMatch(ordinarySourcing, /fixture|反向单入口|任务配置|自动铺货记录/);
  assert.match(html, /高级采集工具与历史记录（通常不用）/);
  assert.match(js, /function renderSourcingInbox/);
  assert.match(js, /renderSourcingInbox\(\)/);
  assert.match(js, /function initializeSourcingAdvancedDisclosure/);
  assert.match(js, /content\.append\(sibling\)/);
  assert.match(js, /on\("#refreshCaptureBox", "click", refreshCaptureBox\)/);
  assert.match(js, /on\("#refreshCaptureBoxTop", "click", refreshCaptureBox\)/);
  assert.match(js, /progressLabel = validationStale \? "需要重新检查" : "需要你补充"/);
  assert.match(js, /model\.progressLabel \|\| "系统处理结果"/);
  assert.match(js, /latest\?\.needsHuman \? "needs-human" : latest\?\.online \? "online"/);
  assert.match(css, /body\[data-active-view="sourcing"\] \.global-current-task-bar[\s\S]*display: none/);
  assert.match(css, /#sourcing > \.sourcing-advanced-disclosure ~ \*[\s\S]*display: none/);
  assert.doesNotMatch(css, /sourcing-advanced-disclosure\[open\]/);
});
