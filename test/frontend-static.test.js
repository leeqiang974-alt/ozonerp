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
  assert.match(js, /不会自动提交 Ozon/);
  assert.match(js, /dictionaryCandidates/);
  assert.match(css, /workflow-required-fill-plan/);
  assert.match(css, /required-fill-plan-row/);
});

test("listing center exposes a read-only fill task queue from existing diagnostics", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderListingFillTaskQueue/);
  assert.match(js, /listingFillTaskQueueItems/);
  assert.match(js, /listingFillTaskRepairCandidate/);
  assert.match(js, /listingFillTaskTextRepairCandidate/);
  assert.match(js, /listingFillTaskVariantTextRepairCandidate/);
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
  assert.match(js, /填写文本属性并预检/);
  assert.match(js, /填写变体文本并预检/);
  assert.match(js, /变体属性修复建议/);
  assert.match(js, /data-listing-variant-suggestion-copy/);
  assert.match(js, /查看变体工作簿/);
  assert.match(js, /受影响 SKU/);
  assert.match(js, /为什么卡住/);
  assert.match(js, /属性 ID/);
  assert.match(js, /listing-variant-context-list/);
  assert.match(css, /listing-fill-task-queue/);
  assert.match(css, /listing-fill-task-card/);
  assert.match(css, /listing-variant-suggestion/);
  assert.match(css, /listing-variant-context-list/);
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

test("frontend renders read-only variant configuration workbench", async () => {
  const [js, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(js, /renderVariantConfigurationWorkbench/);
  assert.match(js, /variantConfiguration/);
  assert.match(js, /变体配置工作簿/);
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

test("frontend exposes workflow filter chips", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /workflowFilterChips/);
  assert.match(js, /workflowRunMatchesFilter/);
  assert.match(js, /workflow-filter-chip/);
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

test("frontend exposes the redesigned ERP information architecture", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /店铺总览/);
  assert.match(html, /商品管理/);
  assert.match(html, /选品采购/);
  assert.match(html, /上架中心/);
  assert.match(html, /订单履约/);
  assert.match(html, /库存仓库/);
  assert.match(html, /营销活动/);
  assert.match(html, /财务利润/);
  assert.match(html, /客户售后/);
  assert.match(html, /数据报表/);
  assert.match(html, /系统配置/);
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
  assert.match(js, /renderServiceRiskPanel/);
  assert.match(js, /renderReportsPanel/);
  assert.match(js, /renderSystemConfigPanel/);
  assert.match(js, /domainPanelSnapshot/);
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

test("frontend uses a readable business theme and keeps all module labels visible", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /app-rail-wide/);
  assert.match(css, /business-erp-theme/);
  assert.match(css, /--business-bg:/);
  assert.match(css, /--business-panel:/);
  assert.match(css, /--business-text:/);
  assert.match(css, /\.nav-group \{ display: block; \}/);
  assert.doesNotMatch(css, /\.nav-group \{ display: none; \}/);
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
  assert.match(js, /renderStockQueueWorkbench/);
  assert.match(js, /includeWarehouseRecommendation=1/);
  assert.match(js, /推荐仓库/);
  assert.match(js, /排除原因/);
  assert.match(css, /stock-queue-workbench/);
  assert.match(css, /stock-warehouse-recommendation/);
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
