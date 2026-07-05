import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  acceptWorkflowPricingRisk,
  appendWorkflowEvent,
  applyPayloadDraftAttributeRepair,
  buildListingAttributeMatrix,
  buildVariantConfigurationSummary,
  buildVariantGroupingDiagnosis,
  buildVariantGroupingRepairDraft,
  buildPreflightGateNode,
  createWorkflowRun,
  diagnoseWorkflowError,
  findOrCreateWorkflowForAutoListingJob,
  getWorkflowRun,
  listWorkflowRuns,
  recommendWorkflowDecision,
  reconcileStaleWorkflowRuns,
  requestWorkflowPricingRecalculation,
  requestWorkflowNewSource,
  workflowDuplicateListingNode,
  workflowNodeFromAutoListingStage,
  workflowReviewReconcileNode,
  confirmWorkflowContinue,
  pauseWorkflowRun,
  resumeWorkflowRun,
  retryWorkflowAfterManualFix,
  retryWorkflowNode,
  savePayloadDraft,
  submitPayloadDraftToOzon,
  summarizeWorkflowRunList,
  summarizeWorkflowRun,
  upsertWorkflowNode,
  validatePayloadDraft,
  validateSubmitPayload,
  workflowCurrentProductTask,
} from "../src/workflowRuns.js";

const tmpFile = path.join(process.cwd(), "data", "workflow-runs.test.json");
const tmpCategoryCacheFile = path.join(process.cwd(), "data", "ozon-category-cache.test.json");

function reset() {
  try { fs.unlinkSync(tmpFile); } catch {}
  try { fs.unlinkSync(tmpCategoryCacheFile); } catch {}
  process.env.WORKFLOW_RUNS_FILE = tmpFile;
  process.env.OZON_CATEGORY_CACHE_FILE = tmpCategoryCacheFile;
}

test("stale workflow reconciliation moves old running runs to human review", async () => {
  reset();
  const now = new Date("2026-06-18T12:00:00.000Z");
  fs.writeFileSync(tmpFile, JSON.stringify({
    items: [
      {
        id: "wr_stale",
        status: "running",
        currentNode: "candidate_parse",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z",
        locks: { paused: false, waitingHuman: false, submitLocked: false },
        nodes: [{ key: "candidate_parse", status: "running", input: { candidateId: "cc_1" } }],
        events: [],
      },
      {
        id: "wr_recent",
        status: "running",
        currentNode: "crawler_1688",
        createdAt: "2026-06-18T11:30:00.000Z",
        updatedAt: "2026-06-18T11:30:00.000Z",
        locks: { paused: false, waitingHuman: false, submitLocked: false },
        nodes: [{ key: "crawler_1688", status: "running" }],
        events: [],
      },
      {
        id: "wr_paused",
        status: "paused",
        currentNode: "match_profit",
        createdAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-01T10:00:00.000Z",
        locks: { paused: true, waitingHuman: false, submitLocked: false },
        nodes: [{ key: "match_profit", status: "running" }],
        events: [],
      },
    ],
  }, null, 2));

  const result = await reconcileStaleWorkflowRuns({ now, staleAfterMs: 2 * 60 * 60 * 1000 });

  assert.equal(result.scanned, 3);
  assert.equal(result.reconciled, 1);
  assert.deepEqual(result.runIds, ["wr_stale"]);
  const stale = await getWorkflowRun("wr_stale");
  assert.equal(stale.status, "waiting_human");
  assert.equal(stale.currentNode, "candidate_parse");
  assert.equal(stale.locks.waitingHuman, true);
  assert.equal(stale.nodes[0].status, "waiting_human");
  assert.deepEqual(stale.nodes[0].input, { candidateId: "cc_1" });
  assert.equal(stale.events.at(-1).type, "workflow_stale_reconciled");
  assert.equal((await getWorkflowRun("wr_recent")).status, "running");
  assert.equal((await getWorkflowRun("wr_paused")).status, "paused");
});

test("workflow runs can be created and node status can be updated", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "宠物喂食器",
    source: "auto_listing",
    entity: { autoListingJobId: "al_test", parentSku: "SKUlq00999" },
  });

  assert.match(run.id, /^wr_/);
  assert.equal(run.status, "draft");
  assert.equal(run.currentNode, "");

  const updated = await upsertWorkflowNode(run.id, {
    key: "preflight_check",
    status: "success",
    output: { ok: true },
  });

  assert.equal(updated.currentNode, "preflight_check");
  assert.equal(updated.nodes.find((node) => node.key === "preflight_check")?.status, "success");
  assert.equal((await listWorkflowRuns()).items.length, 1);
  assert.equal((await getWorkflowRun(run.id)).entity.parentSku, "SKUlq00999");
});

test("listWorkflowRuns derives required attribute rule history from existing runs without persistence", async () => {
  reset();
  const first = await createWorkflowRun({
    title: "当前规则候选",
    nodes: [{
      key: "preflight_check",
      output: { requiredAttributeRuleCandidateIndex: {
        categoryKey: "17028673:95183",
        categoryPath: "Дом / Кухня",
        candidates: [{
          attributeId: 1234,
          attributeName: "Комментарий к комплектации",
          categoryKey: "17028673:95183",
          occurrenceCount: 1,
          readOnly: true,
        }],
      } },
    }],
  });
  const second = await createWorkflowRun({
    title: "历史规则候选",
    nodes: [{
      key: "preflight_check",
      output: { requiredAttributeRuleCandidateIndex: {
        categoryKey: "17028673:95183",
        categoryPath: "Дом / Кухня",
        candidates: [{
          attributeId: 1234,
          attributeName: "Комментарий к комплектации",
          categoryKey: "17028673:95183",
          occurrenceCount: 1,
          readOnly: true,
        }],
      } },
    }],
  });
  await createWorkflowRun({
    title: "其他类目候选",
    nodes: [{
      key: "preflight_check",
      output: { requiredAttributeRuleCandidateIndex: {
        categoryKey: "17028674:95184",
        categoryPath: "Дом / Ванная",
        candidates: [{
          attributeId: 1234,
          attributeName: "Комментарий к комплектации",
          categoryKey: "17028674:95184",
          occurrenceCount: 1,
          readOnly: true,
        }],
      } },
    }],
  });

  const listed = await listWorkflowRuns();
  const firstListed = listed.items.find((item) => item.id === first.id);
  const secondListed = listed.items.find((item) => item.id === second.id);
  const persistedFirst = await getWorkflowRun(first.id);

  assert.equal(firstListed.summary.requiredAttributeRuleCandidateHistory.readOnly, true);
  assert.equal(firstListed.summary.requiredAttributeRuleCandidateHistory.readyForReviewCount, 1);
  assert.equal(firstListed.summary.requiredAttributeRuleCandidateHistory.reviewQueue[0].occurrenceCount, 2);
  assert.equal(firstListed.summary.requiredAttributeRuleCandidateHistory.reviewQueue[0].ruleStatus, "ready_for_review");
  assert.deepEqual(firstListed.summary.requiredAttributeRuleCandidateHistory.reviewQueue[0].sampleRunIds.sort(), [first.id, second.id].sort());
  assert.equal(firstListed.summary.requiredAttributeRuleCandidateHistory.approvalDraftCount, 1);
  assert.equal(firstListed.summary.requiredAttributeRuleCandidateHistory.approvalDraftQueue[0].draftStatus, "pending_human_approval");
  assert.equal(secondListed.summary.requiredAttributeRuleCandidateHistory.readyForReviewCount, 1);
  assert.equal(persistedFirst.summary?.requiredAttributeRuleCandidateHistory, undefined);
  assert.equal(persistedFirst.payloadDraftValidation?.requiredAttributeRuleCandidateHistory, undefined);
});

test("workflow node upsert preserves decision metadata", async () => {
  reset();
  const run = await createWorkflowRun({ title: "风险元数据" });
  const updated = await upsertWorkflowNode(run.id, {
    key: "preflight_check",
    status: "failed",
    branch: "manual_review",
    riskScore: 95,
    riskLevel: "high",
    reason: "重复货源风险",
    recommendedActions: ["人工确认是否换货源"],
    runStatus: "waiting_human",
  });
  const node = updated.nodes.find((item) => item.key === "preflight_check");

  assert.equal(node.branch, "manual_review");
  assert.equal(node.riskScore, 95);
  assert.equal(node.riskLevel, "high");
  assert.equal(node.reason, "重复货源风险");
  assert.deepEqual(node.recommendedActions, ["人工确认是否换货源"]);
});

test("workflow node upsert keeps existing decision metadata when omitted", async () => {
  reset();
  const run = await createWorkflowRun({ title: "风险元数据二次写入" });
  await upsertWorkflowNode(run.id, {
    key: "match_profit",
    name: "匹配与利润分析",
    status: "running",
    branch: "manual_review",
    riskScore: 85,
    riskLevel: "high",
    reason: "低置信或利润偏低",
    recommendedActions: ["人工复核候选"],
  });

  const updated = await upsertWorkflowNode(run.id, {
    key: "match_profit",
    name: "匹配与利润分析",
    status: "failed",
    error: { raw: "未找到满足匹配/利润规则的1688商品" },
  });

  const node = updated.nodes.find((item) => item.key === "match_profit");
  assert.equal(node.status, "failed");
  assert.equal(node.riskScore, 85);
  assert.equal(node.riskLevel, "high");
  assert.equal(node.reason, "低置信或利润偏低");
  assert.deepEqual(node.recommendedActions, ["人工复核候选"]);
});

test("workflow node upsert turns on human wait lock for waiting_human runs", async () => {
  reset();
  const run = await createWorkflowRun({ title: "等待人工锁" });

  const updated = await upsertWorkflowNode(run.id, {
    key: "preflight_check",
    status: "failed",
    runStatus: "waiting_human",
  });

  assert.equal(updated.status, "waiting_human");
  assert.equal(updated.locks.waitingHuman, true);
});


test("workflow events append without overwriting nodes", async () => {
  reset();
  const run = await createWorkflowRun({ title: "事件测试" });
  await upsertWorkflowNode(run.id, { key: "ozon_submit", status: "running" });
  const updated = await appendWorkflowEvent(run.id, {
    node: "ozon_submit",
    type: "task_submitted",
    message: "已提交 task",
    data: { taskId: 123 },
  });

  assert.equal(updated.events.length, 1);
  assert.equal(updated.events[0].data.taskId, 123);
  assert.equal(updated.nodes.find((node) => node.key === "ozon_submit")?.status, "running");
});

test("diagnoseWorkflowError maps Ozon required model attribute to Chinese guidance", () => {
  const diagnosis = diagnoseWorkflowError({
    message: "Название модели (для объединения в одну карточку) - Это обязательное поле",
    attribute_id: 9048,
    attribute_name: "Название модели (для объединения в одну карточку)",
  });

  assert.equal(diagnosis.reasonCode, "ATTRIBUTE_REQUIRED");
  assert.match(diagnosis.messageZh, /模型名称|9048/);
  assert.ok(diagnosis.fixHints.some((hint) => /9048/.test(hint)));
});

test("validateSubmitPayload blocks duplicate offer ids and missing model attribute", () => {
  const result = validateSubmitPayload({
    items: [
      {
        offer_id: "SKU1-red",
        name: "Товар красный",
        description_category_id: 17028673,
        type_id: 95183,
        price: "100",
        images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
        attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }],
      },
      {
        offer_id: "SKU1-red",
        name: "Товар синий",
        description_category_id: 17028673,
        type_id: 95183,
        price: "100",
        images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
        attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_OFFER_ID"));
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_MODEL_NAME"));
});

test("buildPreflightGateNode summarizes submit gate risks", () => {
  const node = buildPreflightGateNode({
    payload: {
      items: [{
        offer_id: "SKU1",
        name: "中文标题",
        description_category_id: 0,
        type_id: 0,
        price: "0",
        images: ["https://example.com/a.jpg"],
        attributes: [],
      }],
    },
    duplicate: { duplicateJobId: "al_old", duplicateSku: "SKUlq00136" },
    contentSummary: {
      contentIssues: ["标题或描述含中文"],
      titleRu: "中文标题",
      candidateImageCount: 1,
      skuVariantCount: 1,
      sizeWeightReady: false,
    },
    category: null,
    variantCount: 1,
  });

  assert.equal(node.key, "preflight_check");
  assert.equal(node.status, "failed");
  assert.equal(node.runStatus, "waiting_human");
  assert.equal(node.output.ok, false);
  assert.ok(node.output.issueCount >= 6);
  assert.ok(node.output.issues.some((issue) => issue.code === "DUPLICATE_LISTING"));
  assert.ok(node.output.issues.some((issue) => issue.code === "CONTENT_ISSUE"));
  assert.equal(node.riskLevel, "high");
  assert.equal(node.branch, "manual_review");
  assert.ok(node.recommendedActions.includes("人工处理阻塞风险"));
});

test("buildPreflightGateNode blocks duplicate Ozon aspect combinations", () => {
  const common = {
    name: "Брелок котик",
    description_category_id: 17028743,
    type_id: 93735,
    price: "30",
    images: ["1", "2", "3"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "Брелок Котик" }] },
      { id: 10097, values: [{ value: "белый" }] },
    ],
  };
  const node = buildPreflightGateNode({
    payload: { items: [
      { ...common, offer_id: "SKU-white" },
      { ...common, offer_id: "SKU-blue" },
    ] },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    variantCount: 2,
    category: { description_category_id: 17028743, type_id: 93735 },
    contentSummary: { candidateImageCount: 3, sizeWeightReady: true, skuVariantCount: 2, contentIssues: [] },
  });

  assert.equal(node.output.ok, false);
  assert.ok(node.output.issues.some((issue) => issue.code === "DUPLICATE_VARIANT_ASPECTS"));
});

test("buildPreflightGateNode carries listing content score breakdown from content summary", () => {
  const node = buildPreflightGateNode({
    payload: {
      items: [{
        offer_id: "SKU-score",
        name: "Игрушка для кошек",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Cat toy" }] },
        ],
      }],
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
    dictionaryValuesByAttributeId: {
      85: [{ id: 971082, value: "Нет бренда" }],
    },
    category: { description_category_id: 17028673, type_id: 95183, path: "Игрушки" },
    variantCount: 1,
    contentSummary: {
      candidateImageCount: 3,
      skuVariantCount: 1,
      descriptionLength: 36,
      richContentReady: false,
      sizeWeightReady: false,
      contentIssues: [],
    },
  });

  assert.equal(node.output.listingQuality.scoreBreakdown.media.status, "warning");
  assert.equal(node.output.listingQuality.scoreBreakdown.description.status, "warning");
  assert.equal(node.output.listingQuality.scoreBreakdown.package.status, "warning");
  assert.ok(node.output.listingQualityWarnings.some((warning) => warning.code === "DESCRIPTION_TOO_SHORT"));
  assert.ok(node.output.listingQualityWarnings.some((warning) => warning.code === "PACKAGE_SIZE_WEIGHT_MISSING"));
});

test("buildPreflightGateNode carries required attribute fill plan without unlocking submit", () => {
  const node = buildPreflightGateNode({
    payload: {
      items: [{
        offer_id: "SKU-plan",
        name: "Органайзер для кухни",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
        weight: 700,
        depth: 220,
        width: 160,
        height: 80,
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Органайзер SKUlq01006" }] },
        ],
      }],
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
      { id: 1234, name: "Комментарий к комплектации", is_required: true },
      { id: 999, name: "Срок годности", is_required: true },
    ],
    dictionaryValuesByAttributeId: {
      85: [{ id: 971082, value: "Нет бренда" }],
      777: [{ id: 11, value: "пластик" }],
    },
    category: { description_category_id: 17028673, type_id: 95183, path: "Дом / Кухня" },
    requiredAttributeRuleCandidateHistorySamples: [
      {
        sourceProductId: "SKU-plan-old",
        sourceRunId: "run-plan-old",
        categoryKey: "17028673:95183",
        categoryPath: "Дом / Кухня",
        candidates: [
          {
            attributeId: 1234,
            attributeName: "Комментарий к комплектации",
            categoryKey: "17028673:95183",
            occurrenceCount: 1,
            readOnly: true,
          },
        ],
      },
    ],
    variantCount: 1,
    contentSummary: {
      candidateImageCount: 3,
      skuVariantCount: 1,
      descriptionLength: 120,
      richContentReady: true,
      sizeWeightReady: true,
      productText: "Органайзер из пластика",
      contentIssues: [],
    },
  });

  const plan = node.output.requiredAttributeFillPlan;
  assert.ok(Array.isArray(plan));
  assert.equal(plan.find((row) => row.attributeId === 9048)?.action, "auto_fill");
  assert.equal(plan.find((row) => row.attributeId === 777)?.action, "suggest_dictionary");
  assert.equal(plan.find((row) => row.attributeId === 999)?.action, "blocked_sensitive");
  assert.deepEqual(node.output.requiredAttributeFillSummary.safetyTierCounts, {
    "autofill-safe": 2,
    "candidate-needs-human-confirmation": 1,
    "manual-required": 1,
    "blocked-never-guess": 1,
  });
  assert.equal(node.output.requiredAttributeFillSummary.humanRequiredCount, 3);
  assert.equal(node.output.requiredAttributeFillSummary.blockingCount, 2);
  assert.equal(node.output.requiredAttributeFillSummary.readinessStatus, "blocked");
  assert.match(node.output.requiredAttributeFillSummary.safeNextAction, /禁止猜测/);
  assert.equal(node.output.requiredAttributeManualBacklog.totalCount, 2);
  assert.equal(node.output.requiredAttributeManualBacklog.ruleCandidateCount, 1);
  assert.equal(node.output.requiredAttributeManualBacklog.manualRequiredCount, 1);
  assert.equal(node.output.requiredAttributeManualBacklog.replaceSourceCount, 0);
  assert.match(node.output.requiredAttributeManualBacklog.safeNextAction, /人工/);
  assert.equal(node.output.requiredAttributeRuleCandidateIndex.categoryKey, "17028673:95183");
  assert.equal(node.output.requiredAttributeRuleCandidateIndex.totalCount, 1);
  assert.equal(node.output.requiredAttributeRuleCandidateIndex.readOnly, true);
  assert.equal(node.output.requiredAttributeRuleCandidateIndex.candidates[0].attributeId, 1234);
  assert.equal(node.output.requiredAttributeRuleCandidateIndex.candidates[0].ruleStatus, "candidate");
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.readOnly, true);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.totalCount, 2);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.readyForReviewCount, 1);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.reviewQueue[0].attributeId, 1234);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.reviewQueue[0].occurrenceCount, 2);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.reviewQueue[0].ruleStatus, "ready_for_review");
  assert.deepEqual(Object.keys(node.output.requiredAttributeRuleCandidateHistory.reviewQueue[0]).filter((key) => /payload|submit|action/i.test(key)), []);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.approvalDraftQueue, undefined);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.approvalDraftCount, undefined);
  assert.equal(node.status, "failed");
  assert.equal(node.runStatus, "waiting_human");
});

test("buildVariantConfigurationSummary explains duplicate aspects and SKU image status by row", () => {
  const attrsMeta = [
    { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    { id: 10097, name: "Название цвета", is_aspect: true },
  ];
  const summary = buildVariantConfigurationSummary({
    payload: { items: [
      {
        offer_id: "SKU-WHITE",
        images: ["https://example.com/common.jpg", "https://example.com/1.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "белый" }] },
        ],
      },
      {
        offer_id: "SKU-BLUE",
        images: ["https://example.com/common.jpg", "https://example.com/2.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "белый" }] },
        ],
      },
    ] },
    attrsMeta,
  });

  assert.equal(summary.summary.rowCount, 2);
  assert.equal(summary.summary.blockedRowCount, 2);
  assert.equal(summary.summary.imageWarningRowCount, 2);
  assert.equal(summary.summary.aspectCoveredRowCount, 2);
  assert.equal(summary.summary.duplicateAspectRowCount, 2);
  assert.equal(summary.summary.missingAspectRowCount, 0);
  assert.equal(summary.summary.uniqueSkuImageRowCount, 0);
  assert.equal(summary.summary.nonUniqueSkuImageRowCount, 2);
  assert.equal(summary.summary.missingSkuImageRowCount, 0);
  assert.equal(summary.summary.readinessStatus, "blocked");
  assert.match(summary.summary.safeNextAction, /变体属性/);
  assert.equal(summary.rows[0].rowStatus, "duplicate_aspect");
  assert.equal(summary.rows[0].skuImage.status, "not_unique");
  assert.ok(summary.rows[0].reasons.some((reason) => reason.code === "DUPLICATE_ASPECT"));
  assert.ok(summary.rows[0].repairSuggestions.some((suggestion) => suggestion.code === "DUPLICATE_ASPECT" && /唯一/.test(suggestion.action)));
  assert.ok(summary.rows[0].repairSuggestions.some((suggestion) => suggestion.code === "SKU_IMAGE_NOT_UNIQUE" && /区分/.test(suggestion.action)));
  assert.equal(summary.differenceSuggestions.length, 1);
  assert.equal(summary.differenceSuggestions[0].code, "VARIANT_GROUP_DIFFERENCE");
  assert.deepEqual(summary.differenceSuggestions[0].affectedOfferIds, ["SKU-WHITE", "SKU-BLUE"]);
  assert.match(summary.differenceSuggestions[0].action, /整组/);
  assert.match(summary.differenceSuggestions[0].action, /Название цвета/);
  assert.equal(summary.differenceSuggestions[0].repairTargets.length, 2);
  assert.deepEqual(
    summary.differenceSuggestions[0].repairTargets.map((target) => target.offerId),
    ["SKU-WHITE", "SKU-BLUE"],
  );
  assert.equal(summary.differenceSuggestions[0].repairTargets[0].attributeId, 10097);
  assert.match(summary.differenceSuggestions[0].repairTargets[0].payloadPath, /items\[0\]\.attributes/);
  assert.match(summary.differenceSuggestions[0].repairTargets[0].payloadPath, /10097/);
  assert.match(summary.differenceSuggestions[0].repairTargets[0].payloadLabel, /SKU-WHITE/);
  assert.match(summary.differenceSuggestions[0].repairTargets[0].copyText, /SKU-WHITE/);
  assert.match(summary.differenceSuggestions[0].repairTargets[0].copyText, /Название цвета/);
  assert.match(summary.differenceSuggestions[0].repairTargets[0].copyText, /重新预检/);
  assert.match(summary.differenceSuggestions[0].copyText, /SKU-WHITE/);
  assert.match(summary.differenceSuggestions[0].copyText, /SKU-BLUE/);
  assert.match(summary.differenceSuggestions[0].copyText, /不会自动写 Payload 或提交 Ozon/);
  assert.equal(summary.summary.differenceSuggestionCount, 1);
  assert.equal(summary.summary.repairSuggestionCount, 4);
  assert.ok(summary.rows[0].safeNextAction.includes("修正"));
});

test("buildVariantConfigurationSummary suggests missing aspect and sku image repairs", () => {
  const summary = buildVariantConfigurationSummary({
    payload: { items: [
      {
        offer_id: "SKU-MISSING",
        images: [],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
        ],
      },
      {
        offer_id: "SKU-VALID",
        images: ["https://example.com/blue.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "синий" }] },
        ],
      },
    ] },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
  });

  const missing = summary.rows.find((row) => row.offerId === "SKU-MISSING");
  assert.equal(missing.rowStatus, "missing_aspect");
  assert.equal(missing.skuImage.status, "missing");
  assert.ok(missing.repairSuggestions.some((suggestion) => suggestion.code === "MISSING_ASPECT" && /补齐/.test(suggestion.action)));
  assert.ok(missing.repairSuggestions.some((suggestion) => suggestion.code === "SKU_IMAGE_MISSING" && /SKU 图/.test(suggestion.action)));
  assert.equal(summary.summary.repairSuggestionCount, 2);
});

test("buildVariantConfigurationSummary accepts same model name when aspects differ", () => {
  const attrsMeta = [
    { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    { id: 10097, name: "Название цвета", is_aspect: true },
  ];
  const summary = buildVariantConfigurationSummary({
    payload: { items: [
      {
        offer_id: "SKU-WHITE",
        images: ["https://example.com/white.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "белый" }] },
        ],
      },
      {
        offer_id: "SKU-BLUE",
        images: ["https://example.com/blue.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "синий" }] },
        ],
      },
    ] },
    attrsMeta,
  });

  assert.equal(summary.summary.blockedRowCount, 0);
  assert.equal(summary.summary.imageWarningRowCount, 0);
  assert.equal(summary.summary.aspectCoveredRowCount, 2);
  assert.equal(summary.summary.uniqueSkuImageRowCount, 2);
  assert.equal(summary.summary.readinessStatus, "ready");
  assert.match(summary.summary.safeNextAction, /可以继续预检/);
  assert.equal(summary.summary.repairSuggestionCount, 0);
  assert.deepEqual(summary.rows.map((row) => row.rowStatus), ["valid", "valid"]);
  assert.deepEqual(summary.rows.map((row) => row.modelName), ["Органайзер", "Органайзер"]);
});

test("buildPreflightGateNode carries variant configuration workbench data", () => {
  const node = buildPreflightGateNode({
    payload: { items: [
      {
        offer_id: "SKU-ONE",
        name: "Органайзер",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["https://example.com/white.jpg", "https://example.com/1.jpg", "https://example.com/2.jpg"],
        attributes: [
          { id: 85, values: [{ value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "белый" }] },
        ],
      },
      {
        offer_id: "SKU-TWO",
        name: "Органайзер",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["https://example.com/blue.jpg", "https://example.com/1.jpg", "https://example.com/2.jpg"],
        attributes: [
          { id: 85, values: [{ value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "синий" }] },
        ],
      },
    ] },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    variantCount: 2,
    contentSummary: { candidateImageCount: 3, skuVariantCount: 2, sizeWeightReady: true, contentIssues: [] },
  });

  assert.equal(node.output.variantConfiguration.summary.rowCount, 2);
  assert.equal(node.output.variantConfiguration.rows[0].rowStatus, "valid");
});

test("buildListingAttributeMatrix summarizes required dictionary and variant attributes by SKU", () => {
  const payload = { items: [
    {
      offer_id: "SKU-WHITE",
      description_category_id: 17028673,
      type_id: 95183,
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "Cat feeder" }] },
        { id: 10097, values: [{ value: "белый" }] },
      ],
    },
    {
      offer_id: "SKU-BLUE",
      description_category_id: 17028673,
      type_id: 95183,
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 10097, values: [{ value: "белый" }] },
      ],
    },
  ] };
  const attrsMeta = [
    { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
    { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    { id: 10097, name: "Название цвета", is_aspect: true },
  ];

  const matrix = buildListingAttributeMatrix({
    payload,
    attrsMeta,
    dictionaryValueCache: {
      "17028673:95183:85:ZH_HANS": { values: [{ id: 971082, value: "Нет бренда" }] },
    },
  });

  assert.equal(matrix.summary.offerCount, 2);
  assert.equal(matrix.summary.attributeCount, 3);
  assert.equal(matrix.summary.blockedCellCount, 4);
  assert.deepEqual(matrix.offers, ["SKU-WHITE", "SKU-BLUE"]);
  const brand = matrix.rows.find((row) => row.attributeId === 85);
  const model = matrix.rows.find((row) => row.attributeId === 9048);
  const color = matrix.rows.find((row) => row.attributeId === 10097);
  assert.equal(brand.kind, "required_dictionary");
  assert.equal(brand.cells[0].status, "ok");
  assert.equal(brand.cells[1].status, "invalid_dictionary");
  assert.equal(model.cells[1].status, "missing");
  assert.equal(color.kind, "variant_aspect");
  assert.equal(color.cells[0].status, "duplicate_variant");
  assert.equal(color.cells[1].status, "duplicate_variant");
});

test("buildListingAttributeMatrix uses metadata dictionary values and flags missing aspect metadata", () => {
  const payload = { items: [
    {
      offer_id: "SKU-ONE",
      description_category_id: 17028673,
      type_id: 95183,
      attributes: [{ id: 85, values: [{ dictionary_value_id: 999999, value: "Wrong brand" }] }],
    },
    {
      offer_id: "SKU-TWO",
      description_category_id: 17028673,
      type_id: 95183,
      attributes: [{ id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] }],
    },
  ] };
  const attrsMeta = [
    {
      id: 85,
      name: "Бренд",
      is_required: true,
      dictionary_id: 971082,
      dictionary_values: [{ id: 971082, value: "Нет бренда" }],
    },
  ];

  const matrix = buildListingAttributeMatrix({ payload, attrsMeta });
  const brand = matrix.rows.find((row) => row.attributeId === 85);
  const aspectMeta = matrix.rows.find((row) => row.kind === "variant_aspect_missing_metadata");

  assert.equal(brand.cells[0].status, "invalid_dictionary");
  assert.equal(brand.cells[1].status, "ok");
  assert.equal(aspectMeta.attributeId, 0);
  assert.equal(aspectMeta.cells[0].status, "missing_variant_aspect_metadata");
  assert.equal(aspectMeta.cells[1].status, "missing_variant_aspect_metadata");
  assert.equal(matrix.summary.missingVariantAspectMetadata, true);
});

test("buildListingAttributeMatrix exposes safe human repair guidance for blocked cells", () => {
  const payload = { items: [
    {
      offer_id: "SKU-NEEDS-FIX",
      description_category_id: 17028673,
      type_id: 95183,
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 999999, value: "Wrong brand" }] },
      ],
    },
  ] };
  const matrix = buildListingAttributeMatrix({
    payload,
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    dictionaryValuesByAttributeId: {
      85: [{ id: 971082, value: "Нет бренда" }],
    },
  });

  const brandCell = matrix.rows.find((row) => row.attributeId === 85).cells[0];
  const modelCell = matrix.rows.find((row) => row.attributeId === 9048).cells[0];
  const colorCell = matrix.rows.find((row) => row.attributeId === 10097).cells[0];

  assert.equal(brandCell.status, "invalid_dictionary");
  assert.equal(brandCell.repairGuidance.humanRequired, true);
  assert.match(brandCell.repairGuidance.payloadPath, /SKU-NEEDS-FIX/);
  assert.match(brandCell.repairGuidance.message, /字典值/);
  assert.equal(brandCell.repairGuidance.dictionaryCandidates[0].dictionary_value_id, 971082);
  assert.match(brandCell.repairGuidance.nextStep, /重新预检/);
  assert.equal(modelCell.status, "missing");
  assert.match(modelCell.repairGuidance.message, /补充/);
  assert.match(modelCell.repairGuidance.copyText, /9048/);
  assert.equal(modelCell.repairGuidance.canApplyTextDraftRepair, true);
  assert.equal(modelCell.repairGuidance.canApplyVariantTextDraftRepair, false);
  assert.equal(colorCell.status, "missing");
  assert.equal(colorCell.repairGuidance.canApplyTextDraftRepair, false);
  assert.equal(colorCell.repairGuidance.canApplyVariantTextDraftRepair, true);
});

test("applyPayloadDraftAttributeRepair writes a confirmed dictionary repair and forces revalidation", async () => {
  reset();
  fs.writeFileSync(tmpCategoryCacheFile, JSON.stringify({
    attributeValues: {
      "17028673:95183:85:ZH_HANS": {
        values: [{ id: 971082, value: "Нет бренда" }],
      },
    },
  }, null, 2));
  const run = await createWorkflowRun({
    title: "字典修复",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-DICT-REPAIR",
      name: "Cat feeder",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["1", "2", "3"],
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 999999, value: "Wrong brand" }] },
        { id: 9048, values: [{ value: "Cat feeder" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });

  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(run.id, {
      offerId: "SKU-DICT-REPAIR",
      attributeId: 85,
      dictionaryValueId: 971082,
      value: "Нет бренда",
    }),
    /需要人工确认/,
  );

  const result = await applyPayloadDraftAttributeRepair(run.id, {
    confirmLocalDraftRepair: true,
    offerId: "SKU-DICT-REPAIR",
    attributeId: 85,
    dictionaryValueId: 971082,
    value: "Нет бренда",
    note: "人工选择无品牌字典值",
  });

  const updated = await getWorkflowRun(run.id);
  const brand = updated.payloadDraft.items[0].attributes.find((attribute) => attribute.id === 85);
  assert.equal(result.submittedToOzon, false);
  assert.equal(brand.values[0].dictionary_value_id, 971082);
  assert.equal(brand.values[0].value, "Нет бренда");
  assert.equal(updated.locks.waitingHuman, true);
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.payloadDraftValidation.ok, true);
  assert.equal(updated.events.at(-1).type, "payload_attribute_repair_applied");
});

test("applyPayloadDraftAttributeRepair requires waiting human before local repair", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "未等待人工不能修复",
    status: "running",
    currentNode: "preflight_check",
    locks: { submitLocked: true },
  });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-RUNNING-REPAIR",
      name: "Cat feeder",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["1", "2", "3"],
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 999999, value: "Wrong brand" }] },
        { id: 9048, values: [{ value: "Cat feeder" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });

  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(run.id, {
      confirmLocalDraftRepair: true,
      offerId: "SKU-RUNNING-REPAIR",
      attributeId: 85,
      dictionaryValueId: 971082,
      value: "Нет бренда",
    }),
    /等待人工/,
  );
});

test("applyPayloadDraftAttributeRepair writes missing dictionary candidates and rejects non-candidate ids", async () => {
  reset();
  fs.writeFileSync(tmpCategoryCacheFile, JSON.stringify({
    attributeValues: {
      "17028673:95183:85:ZH_HANS": {
        values: [{ id: 971082, value: "Нет бренда" }],
      },
    },
  }, null, 2));
  const missingRun = await createWorkflowRun({
    title: "人工确认缺失字典属性",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(missingRun.id, {
    items: [{
      offer_id: "SKU-MISSING-BRAND",
      name: "Cat feeder",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["1", "2", "3"],
      attributes: [{ id: 9048, values: [{ value: "Cat feeder" }] }],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });
  const missingResult = await applyPayloadDraftAttributeRepair(missingRun.id, {
    confirmLocalDraftRepair: true,
    offerId: "SKU-MISSING-BRAND",
    attributeId: 85,
    dictionaryValueId: 971082,
    value: "Нет бренда",
    note: "人工确认缺失品牌字典值",
  });
  const missingUpdated = await getWorkflowRun(missingRun.id);
  const repairedBrand = missingUpdated.payloadDraft.items[0].attributes.find((attribute) => attribute.id === 85);
  assert.equal(missingResult.submittedToOzon, false);
  assert.equal(repairedBrand.values[0].dictionary_value_id, 971082);
  assert.equal(repairedBrand.values[0].value, "Нет бренда");
  assert.equal(missingUpdated.locks.submitLocked, true);

  const invalidRun = await createWorkflowRun({
    title: "不能信任前端候选",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(invalidRun.id, {
    items: [{
      offer_id: "SKU-BAD-CANDIDATE",
      name: "Cat feeder",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["1", "2", "3"],
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 999999, value: "Wrong brand" }] },
        { id: 9048, values: [{ value: "Cat feeder" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });
  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(invalidRun.id, {
      confirmLocalDraftRepair: true,
      offerId: "SKU-BAD-CANDIDATE",
      attributeId: 85,
      dictionaryValueId: 123456,
      value: "Injected",
    }),
    /不在当前属性矩阵候选值/,
  );
});

test("applyPayloadDraftAttributeRepair writes confirmed missing text attributes without unlocking submit", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "文本属性修复",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-TEXT-REPAIR",
      name: "Cat feeder",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["1", "2", "3"],
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
  });

  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(run.id, {
      confirmLocalDraftRepair: true,
      repairType: "text_value",
      offerId: "SKU-TEXT-REPAIR",
      attributeId: 10097,
      value: "белый",
    }),
    /只能修复缺失的普通文本属性/,
  );

  const result = await applyPayloadDraftAttributeRepair(run.id, {
    confirmLocalDraftRepair: true,
    repairType: "text_value",
    offerId: "SKU-TEXT-REPAIR",
    attributeId: 9048,
    value: "Cat feeder model",
    note: "人工补齐模型名",
  });

  const updated = await getWorkflowRun(run.id);
  const model = updated.payloadDraft.items[0].attributes.find((attribute) => attribute.id === 9048);
  assert.equal(result.submittedToOzon, false);
  assert.equal(model.values[0].value, "Cat feeder model");
  assert.equal(updated.locks.waitingHuman, true);
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.payloadDraftValidation.ok, true);
  assert.equal(updated.events.at(-1).type, "payload_attribute_repair_applied");
});

test("applyPayloadDraftAttributeRepair writes confirmed package info without Ozon submit", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "包装尺重修复",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-PACKAGE-REPAIR",
      name: "Cat feeder",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["1", "2", "3"],
      weight: "",
      depth: "",
      width: "",
      height: "",
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "Cat feeder" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });

  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(run.id, {
      confirmLocalDraftRepair: true,
      repairType: "package_info",
      offerId: "SKU-PACKAGE-REPAIR",
      packageInfoSource: "guessed",
      packageInfo: { weightG: 650, lengthMm: 220, widthMm: 160, heightMm: 80 },
    }),
    /可信尺重来源/,
  );
  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(run.id, {
      confirmLocalDraftRepair: true,
      repairType: "package_info",
      offerId: "SKU-PACKAGE-REPAIR",
      packageInfoSource: "1688_package",
      packageInfo: { weightG: 650, lengthMm: 220, widthMm: 160 },
    }),
    /重量和长宽高/,
  );
  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(run.id, {
      confirmLocalDraftRepair: true,
      repairType: "package_info",
      offerId: "SKU-PACKAGE-REPAIR",
      packageInfoSource: "1688_package",
      packageInfo: { weightG: 0.4, lengthMm: 220, widthMm: 160, heightMm: 80 },
    }),
    /重量和长宽高/,
  );

  const result = await applyPayloadDraftAttributeRepair(run.id, {
    confirmLocalDraftRepair: true,
    repairType: "package_info",
    offerId: "SKU-PACKAGE-REPAIR",
    packageInfoSource: "1688_package",
    packageInfo: { weightG: 650, lengthMm: 220, widthMm: 160, heightMm: 80 },
    note: "人工确认 1688 详情尺重",
  });

  const updated = await getWorkflowRun(run.id);
  const item = updated.payloadDraft.items[0];
  assert.equal(result.submittedToOzon, false);
  assert.equal(item.weight, 650);
  assert.equal(item.depth, 220);
  assert.equal(item.width, 160);
  assert.equal(item.height, 80);
  assert.equal(updated.locks.waitingHuman, true);
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.events.at(-1).data.repairType, "package_info");
  assert.equal(updated.events.at(-1).data.packageInfoSource, "1688_package");
  assert.equal(updated.events.at(-1).data.submittedToOzon, false);
});

test("applyPayloadDraftAttributeRepair writes confirmed missing non-dictionary variant text only", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "变体文本属性修复",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-VARIANT-TEXT-REPAIR",
      name: "Cat feeder",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["1", "2", "3"],
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "Cat feeder" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
  });

  const result = await applyPayloadDraftAttributeRepair(run.id, {
    confirmLocalDraftRepair: true,
    repairType: "variant_text_value",
    offerId: "SKU-VARIANT-TEXT-REPAIR",
    attributeId: 10097,
    value: "белый",
    note: "人工补齐变体颜色文本",
  });

  const updated = await getWorkflowRun(run.id);
  const color = updated.payloadDraft.items[0].attributes.find((attribute) => attribute.id === 10097);
  assert.equal(result.submittedToOzon, false);
  assert.equal(color.values[0].value, "белый");
  assert.equal(updated.locks.waitingHuman, true);
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.events.at(-1).data.repairType, "variant_text_value");
  assert.equal(updated.events.at(-1).data.submittedToOzon, false);
});

test("applyPayloadDraftAttributeRepair rejects dictionary and duplicate variant aspect repairs", async () => {
  reset();
  const dictionaryRun = await createWorkflowRun({
    title: "字典变体不能文本修复",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(dictionaryRun.id, {
    items: [{
      offer_id: "SKU-DICT-ASPECT",
      name: "Cat feeder",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["1", "2", "3"],
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "Cat feeder" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10096, name: "Цвет товара", is_aspect: true, dictionary_id: 10096 },
    ],
  });
  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(dictionaryRun.id, {
      confirmLocalDraftRepair: true,
      repairType: "variant_text_value",
      offerId: "SKU-DICT-ASPECT",
      attributeId: 10096,
      value: "белый",
    }),
    /非字典变体文本属性/,
  );

  const duplicateRun = await createWorkflowRun({
    title: "重复变体不能自动修复",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(duplicateRun.id, {
    items: [
      {
        offer_id: "SKU-DUP-1",
        name: "Cat feeder",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["1", "2", "3"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Cat feeder" }] },
          { id: 10097, values: [{ value: "белый" }] },
        ],
      },
      {
        offer_id: "SKU-DUP-2",
        name: "Cat feeder",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["1", "2", "3"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Cat feeder" }] },
          { id: 10097, values: [{ value: "белый" }] },
        ],
      },
    ],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
  });
  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(duplicateRun.id, {
      confirmLocalDraftRepair: true,
      repairType: "variant_text_value",
      offerId: "SKU-DUP-2",
      attributeId: 10097,
      value: "синий",
    }),
    /缺失的非字典变体文本属性/,
  );
});

test("buildPreflightGateNode blocks multi variant payloads without aspect metadata", () => {
  const node = buildPreflightGateNode({
    payload: { items: [
      {
        offer_id: "SKU-ONE",
        name: "Cat feeder",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["1", "2", "3"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Cat feeder" }] },
        ],
      },
      {
        offer_id: "SKU-TWO",
        name: "Cat feeder",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["1", "2", "3"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Cat feeder" }] },
        ],
      },
    ] },
    attrsMeta: [],
    variantCount: 2,
    contentSummary: { candidateImageCount: 3, sizeWeightReady: true, skuVariantCount: 2, contentIssues: [] },
    category: { path: "宠物用品", description_category_id: 17028673, type_id: 95183 },
  });

  assert.equal(node.output.ok, false);
  assert.equal(node.status, "failed");
  assert.equal(node.output.issues.some((issue) => issue.code === "NO_VARIANT_ASPECT_METADATA"), true);
  assert.equal(node.output.attributeMatrix.summary.missingVariantAspectMetadata, true);
});

test("buildPreflightGateNode blocks dictionary ids from direct dictionary sources", () => {
  const node = buildPreflightGateNode({
    payload: {
      items: [{
        offer_id: "SKU-DIRECT-DICT",
        name: "Cat feeder",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["1", "2", "3"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 999999, value: "Wrong brand" }] },
          { id: 9048, values: [{ value: "Cat feeder" }] },
        ],
      }],
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
    dictionaryValuesByAttributeId: {
      85: [{ id: 971082, value: "Нет бренда" }],
    },
    variantCount: 1,
    contentSummary: { candidateImageCount: 3, sizeWeightReady: true, skuVariantCount: 1, contentIssues: [] },
    category: { path: "宠物用品", description_category_id: 17028673, type_id: 95183 },
  });

  assert.equal(node.output.ok, false);
  assert.equal(node.status, "failed");
  assert.equal(node.output.issues.some((issue) => issue.code === "LISTING_QUALITY_DICTIONARY_VALUE_INVALID"), true);
  assert.equal(node.output.attributeMatrix.summary.invalidDictionaryCellCount, 1);
});

test("workflow run can be paused, resumed, and payload draft validated", async () => {
  reset();
  const run = await createWorkflowRun({ title: "草稿校验" });
  const paused = await pauseWorkflowRun(run.id);
  assert.equal(paused.status, "paused");
  assert.equal(paused.locks.paused, true);
  assert.equal(paused.events.at(-1).type, "workflow_paused");

  const resumed = await resumeWorkflowRun(run.id);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.locks.paused, false);
  assert.equal(resumed.events.at(-1).type, "workflow_resumed");

  await savePayloadDraft(run.id, {
    offer_id: "SKU1",
    name: "Товар",
    description_category_id: 1,
    type_id: 2,
    price: "10",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU1" }] },
    ],
  });
  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.ok, true);
});

test("payload draft validation preserves Ozon aspect metadata across saves", async () => {
  reset();
  const run = await createWorkflowRun({ title: "变体草稿校验" });
  const base = {
    name: "Брелок",
    description_category_id: 17028743,
    type_id: 93735,
    price: "10",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
  };
  const duplicatePayload = { items: [
    { ...base, offer_id: "SKU-WHITE", attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }, { id: 9048, values: [{ value: "Брелок" }] }, { id: 10097, values: [{ value: "белый" }] }] },
    { ...base, offer_id: "SKU-BLUE", attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }, { id: 9048, values: [{ value: "Брелок" }] }, { id: 10097, values: [{ value: "белый" }] }] },
  ] };
  const attrsMeta = [
    { id: 9048, name: "Название модели (для объединения в одну карточку)" },
    { id: 10097, name: "Название цвета", is_aspect: true },
  ];

  await savePayloadDraft(run.id, duplicatePayload, { attrsMeta });
  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "DUPLICATE_VARIANT_ASPECTS"));

  await savePayloadDraft(run.id, duplicatePayload);
  const validationAfterPlainSave = await validatePayloadDraft(run.id);
  assert.ok(validationAfterPlainSave.issues.some((issue) => issue.code === "DUPLICATE_VARIANT_ASPECTS"));
});

test("payload draft validation blocks listing quality dictionary issues", async () => {
  reset();
  const run = await createWorkflowRun({ title: "字典属性质量预检" });
  const payload = {
    items: [{
      offer_id: "SKU-quality-dict",
      name: "Кормушка для кошек",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKU-quality-dict" }] },
      ],
    }],
  };
  const attrsMeta = [
    { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
    { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
  ];

  await savePayloadDraft(run.id, payload, { attrsMeta });
  const validation = await validatePayloadDraft(run.id);

  assert.equal(validation.ok, false);
  assert.equal(validation.listingQuality.status, "blocked");
  assert.equal(validation.issues.some((issue) => issue.code === "LISTING_QUALITY_DICTIONARY_VALUE_INVALID"), true);
  const updated = await getWorkflowRun(run.id);
  assert.equal(updated.locks.submitLocked, true);
});

test("payload draft validation suggests cached legal dictionary candidates", async () => {
  reset();
  fs.writeFileSync(tmpCategoryCacheFile, JSON.stringify({
    attributeValues: {
      "17028673:95183:85:ZH_HANS": {
        values: [
          { id: 971082, value: "Нет бренда" },
          { value_id: 112233, value: "Acme" },
          { dictionary_value_id: 445566, value: "Petkit" },
        ],
      },
    },
  }, null, 2));
  const run = await createWorkflowRun({ title: "字典候选推荐" });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-quality-dict-cache",
      name: "Кормушка для кошек",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKU-quality-dict-cache" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });

  const validation = await validatePayloadDraft(run.id);
  const reason = validation.listingQuality.blockedReasons.find((item) => item.code === "DICTIONARY_VALUE_INVALID");
  const issue = validation.issues.find((item) => item.code === "LISTING_QUALITY_DICTIONARY_VALUE_INVALID");

  assert.ok(reason);
  assert.equal(reason.dictionaryCandidates[0].dictionary_value_id, 971082);
  assert.equal(reason.dictionaryCandidates[0].source, "ozon_dictionary_cache");
  assert.ok(reason.dictionaryCandidates[0].confidence >= 0.9);
  assert.ok(issue);
  assert.deepEqual(issue.dictionaryCandidates, reason.dictionaryCandidates);
  assert.deepEqual(issue.enteredValues, ["Нет бренда"]);
});

test("payload draft validation does not persist transient rule candidate history", async () => {
  reset();
  const run = await createWorkflowRun({ title: "规则候选校验不持久化历史" });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-rule-history",
      name: "Органайзер для кухни",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKU-rule-history" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 1234, name: "Комментарий к комплектации", is_required: true },
    ],
  });

  const validation = await validatePayloadDraft(run.id);
  const updated = await getWorkflowRun(run.id);

  assert.ok(validation.requiredAttributeRuleCandidateIndex.candidates.some((candidate) => candidate.attributeId === 1234));
  assert.equal(validation.requiredAttributeRuleCandidateHistory, undefined);
  assert.equal(updated.payloadDraftValidation.requiredAttributeRuleCandidateHistory, undefined);
});

test("payload draft submit blocks non-current dictionary value ids before Ozon import", async () => {
  reset();
  fs.writeFileSync(tmpCategoryCacheFile, JSON.stringify({
    attributeValues: {
      "17028673:95183:85:ZH_HANS": {
        values: [{ id: 971082, value: "Нет бренда" }],
      },
      "999:888:85:ZH_HANS": {
        values: [{ id: 999999, value: "Wrong category brand" }],
      },
    },
  }, null, 2));
  const run = await createWorkflowRun({ title: "非法字典值阻断提交", entity: { storeId: "3815760-4" } });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-invalid-dict-id",
      name: "Кормушка для кошек",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      attributes: [
        { id: 85, values: [{ dictionary_value_id: 999999, value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKU-invalid-dict-id" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });
  const calls = [];

  const result = await submitPayloadDraftToOzon(run.id, { confirmSubmit: true }, {
    getStore: (storeId) => ({ id: storeId }),
    ozonRequest: async (...args) => {
      calls.push(args);
      return { result: { task_id: 1 } };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(calls.length, 0);
  assert.equal(result.validation.issues.some((issue) => issue.code === "LISTING_QUALITY_DICTIONARY_VALUE_INVALID"), true);
  assert.equal(
    result.validation.listingQuality.blockedReasons[0].dictionaryCandidates.some((item) => item.dictionary_value_id === 999999),
    false,
  );
});

test("payload draft submit blocks invalid drafts before Ozon import", async () => {
  reset();
  const run = await createWorkflowRun({ title: "无效草稿提交", entity: { storeId: "3815760-4" } });
  await savePayloadDraft(run.id, {
    offer_id: "SKU-invalid",
    name: "中文标题",
    price: "0",
    images: [],
    attributes: [],
  });
  const calls = [];

  const result = await submitPayloadDraftToOzon(run.id, { confirmSubmit: true }, {
    getStore: (storeId) => ({ id: storeId }),
    ozonRequest: async (...args) => {
      calls.push(args);
      return { result: { task_id: 1 } };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(calls.length, 0);
  const updated = await getWorkflowRun(run.id);
  assert.equal(updated.status, "waiting_human");
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.nodes.find((node) => node.key === "preflight_check")?.status, "failed");
});

test("payload draft submit blocks listing quality diagnosis before Ozon import", async () => {
  reset();
  const run = await createWorkflowRun({ title: "质量阻塞提交", entity: { storeId: "3815760-4" } });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-quality-submit",
      name: "Кормушка для кошек",
      description_category_id: 17028673,
      type_id: 95183,
      price: "1200",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKU-quality-submit" }] },
      ],
    }],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });
  const calls = [];

  const result = await submitPayloadDraftToOzon(run.id, { confirmSubmit: true }, {
    getStore: (storeId) => ({ id: storeId }),
    ozonRequest: async (...args) => {
      calls.push(args);
      return { result: { task_id: 1 } };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(calls.length, 0);
  assert.equal(result.validation.listingQuality.status, "blocked");
  const updated = await getWorkflowRun(run.id);
  const node = updated.nodes.find((item) => item.key === "preflight_check");
  assert.equal(node?.status, "failed");
  assert.equal(node?.output.listingQuality.status, "blocked");
  assert.equal(node?.output.issues.some((issue) => issue.code === "LISTING_QUALITY_DICTIONARY_VALUE_INVALID"), true);
});

test("payload draft submit respects waiting human workflow lock before Ozon import", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "等待人工锁提交",
    status: "waiting_human",
    entity: { storeId: "3815760-4" },
    locks: { waitingHuman: true },
  });
  await savePayloadDraft(run.id, {
    offer_id: "SKU-waiting-human",
    name: "Товар для дома",
    description_category_id: 17028673,
    type_id: 95183,
    price: "100",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU-waiting-human" }] },
    ],
  });
  const calls = [];

  const result = await submitPayloadDraftToOzon(run.id, { confirmSubmit: true }, {
    getStore: (storeId) => ({ id: storeId }),
    ozonRequest: async (...args) => {
      calls.push(args);
      return { result: { task_id: 1 } };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "waiting_human");
  assert.equal(calls.length, 0);
});

test("payload draft submit blocks pricing risk diagnosis before Ozon import", async () => {
  reset();
  const run = await createWorkflowRun({ title: "价格风险提交", entity: { storeId: "3815760-4" } });
  await upsertWorkflowNode(run.id, {
    key: "match_profit",
    status: "failed",
    branch: "blocked",
    diagnosis: { reasonCode: "PRICING_PACKAGE_MISSING", messageZh: "缺少完整尺重。" },
    reason: "定价阻塞：缺少完整尺重。",
  });
  await savePayloadDraft(run.id, {
    offer_id: "SKU-pricing-blocked",
    name: "Товар для дома",
    description_category_id: 17028673,
    type_id: 95183,
    price: "100",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU-pricing-blocked" }] },
    ],
  });
  const calls = [];

  const result = await submitPayloadDraftToOzon(run.id, { confirmSubmit: true }, {
    getStore: (storeId) => ({ id: storeId }),
    ozonRequest: async (...args) => {
      calls.push(args);
      return { result: { task_id: 1 } };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(calls.length, 0);
  assert.equal(result.validation.issues.some((issue) => issue.code === "LISTING_QUALITY_PRICING_BLOCKED"), true);
});

test("payload draft submit requires explicit human confirmation", async () => {
  reset();
  const run = await createWorkflowRun({ title: "缺确认提交", entity: { storeId: "3815760-4" } });
  await savePayloadDraft(run.id, {
    offer_id: "SKU-confirm",
    name: "Товар для дома",
    description_category_id: 17028673,
    type_id: 95183,
    price: "100",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU-confirm" }] },
    ],
  });
  const calls = [];

  const result = await submitPayloadDraftToOzon(run.id, {}, {
    getStore: (storeId) => ({ id: storeId }),
    ozonRequest: async (...args) => {
      calls.push(args);
      return { result: { task_id: 1 } };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "confirmation_required");
  assert.equal(calls.length, 0);
});

test("payload draft submit imports confirmed valid draft and records workflow event", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "确认提交",
    entity: { storeId: "3815760-4", parentSku: "SKUlq00999" },
  });
  await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKUlq00999-red",
      name: "Товар красный",
      description_category_id: 17028673,
      type_id: 95183,
      price: "100",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKUlq00999" }] },
      ],
    }],
  });
  const calls = [];

  const result = await submitPayloadDraftToOzon(run.id, { confirmSubmit: true, storeId: "3815760-4" }, {
    getStore: (storeId) => ({ id: storeId, name: "xymallc" }),
    ozonRequest: async (...args) => {
      calls.push(args);
      return { result: { task_id: 472200001 } };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.taskId, 472200001);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "/v3/product/import");
  assert.deepEqual(calls[0][2].items.map((item) => item.offer_id), ["SKUlq00999-red"]);
  const updated = await getWorkflowRun(run.id);
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.nodes.find((node) => node.key === "preflight_check")?.status, "success");
  assert.equal(updated.nodes.find((node) => node.key === "ozon_submit")?.status, "success");
  assert.equal(updated.events.at(-1).type, "payload_draft_submitted");
  assert.equal(updated.events.at(-1).data.taskId, 472200001);
});

test("workflow node retry clears human wait lock and appends retry event", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "节点重试",
    status: "waiting_human",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await upsertWorkflowNode(run.id, {
    key: "crawler_1688",
    name: "1688 采集任务",
    status: "failed",
    runStatus: "waiting_human",
    riskScore: 88,
    riskLevel: "high",
    recommendedActions: ["重新采集关键词"],
  });

  const updated = await retryWorkflowNode(run.id, "crawler_1688", { keyword: "宠物饮水机" });

  const node = updated.nodes.find((item) => item.key === "crawler_1688");
  assert.equal(updated.status, "running");
  assert.equal(updated.locks.waitingHuman, false);
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(node.status, "retrying");
  assert.equal(node.input.keyword, "宠物饮水机");
  assert.equal(node.riskScore, 88);
  assert.equal(updated.events.at(-1).type, "retry_requested");
  assert.equal(updated.events.at(-1).node, "crawler_1688");
});

test("workflow manual intervention actions update locks and audit trail", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "人工介入",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true },
  });
  await upsertWorkflowNode(run.id, {
    key: "preflight_check",
    status: "failed",
    runStatus: "waiting_human",
    reason: "重复货源/重复参考品会导致 Ozon 重复卡或合并失败。",
    input: { sourceUrl: "https://detail.1688.com/offer/1.html" },
  });

  const abandoned = await requestWorkflowNewSource(run.id, { note: "换一个新 1688" });
  assert.equal(abandoned.status, "cancelled");
  assert.equal(abandoned.locks.waitingHuman, false);
  assert.equal(abandoned.events.at(-1).type, "new_source_requested");

  const retryRun = await createWorkflowRun({
    title: "清理后重试",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true },
  });
  await upsertWorkflowNode(retryRun.id, {
    key: "preflight_check",
    status: "failed",
    runStatus: "waiting_human",
    input: { sourceUrl: "https://detail.1688.com/offer/2.html" },
  });
  const retried = await retryWorkflowAfterManualFix(retryRun.id, "preflight_check", { note: "Ozon 残留已清理" });
  assert.equal(retried.status, "running");
  assert.equal(retried.locks.waitingHuman, false);
  assert.equal(retried.nodes.find((node) => node.key === "preflight_check")?.status, "retrying");
  assert.equal(retried.events.at(-1).type, "manual_fix_retry_requested");

  const continueRun = await createWorkflowRun({
    title: "确认继续",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await upsertWorkflowNode(continueRun.id, {
    key: "preflight_check",
    status: "failed",
    runStatus: "waiting_human",
  });
  const continued = await confirmWorkflowContinue(continueRun.id, "preflight_check", { note: "人工确认不是重复货源" });
  assert.equal(continued.status, "running");
  assert.equal(continued.locks.waitingHuman, false);
  assert.equal(continued.locks.submitLocked, false);
  assert.equal(continued.nodes.find((node) => node.key === "preflight_check")?.status, "success");
  assert.equal(continued.events.at(-1).type, "manual_continue_confirmed");
});

test("workflow request new source keeps run active when replacement tasks exist", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "换新货源",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true },
  });
  await upsertWorkflowNode(run.id, {
    key: "preflight_check",
    status: "failed",
    runStatus: "waiting_human",
  });

  const updated = await requestWorkflowNewSource(run.id, {
    note: "重新找一个新 1688",
    replacementCrawlerTaskIds: ["ct_new_1"],
  });

  assert.equal(updated.status, "running");
  assert.equal(updated.locks.waitingHuman, false);
  assert.equal(updated.locks.paused, false);
  assert.equal(updated.events.at(-1).type, "new_source_requested");
  assert.deepEqual(updated.events.at(-1).data.replacementCrawlerTaskIds, ["ct_new_1"]);
});

test("workflow pricing risk actions accept only manual review risks", async () => {
  reset();
  const manualRun = await createWorkflowRun({
    source: "auto_listing",
    title: "低利润",
    status: "waiting_human",
    currentNode: "match_profit",
    locks: { waitingHuman: true, submitLocked: true },
    nodes: [{
      key: "match_profit",
      status: "waiting_human",
      branch: "manual_review",
      riskLevel: "medium",
      diagnosis: { reasonCode: "PRICING_PROFIT_LOW" },
    }],
  });

  const accepted = await acceptWorkflowPricingRisk(manualRun.id, "match_profit", { note: "人工接受低利润" });
  const acceptedNode = accepted.nodes.find((node) => node.key === "match_profit");
  assert.equal(accepted.status, "running");
  assert.equal(accepted.locks.waitingHuman, false);
  assert.equal(accepted.locks.submitLocked, true);
  assert.equal(acceptedNode.status, "success");
  assert.equal(acceptedNode.branch, "manual_pricing_risk_accepted");
  assert.equal(accepted.events.at(-1).type, "pricing_risk_accepted");

  const blockedRun = await createWorkflowRun({
    source: "auto_listing",
    title: "缺尺重",
    status: "waiting_human",
    currentNode: "match_profit",
    locks: { waitingHuman: true },
    nodes: [{
      key: "match_profit",
      status: "waiting_human",
      branch: "blocked",
      riskLevel: "high",
      diagnosis: { reasonCode: "PRICING_PACKAGE_MISSING" },
    }],
  });

  await assert.rejects(
    () => acceptWorkflowPricingRisk(blockedRun.id, "match_profit", { note: "不能跳过" }),
    /阻塞型价格风险不能直接接受/,
  );
});

test("workflow pricing recalculation action records safe retry event", async () => {
  reset();
  const run = await createWorkflowRun({
    source: "auto_listing",
    title: "重新定价",
    status: "waiting_human",
    currentNode: "match_profit",
    locks: { waitingHuman: true },
    nodes: [{
      key: "match_profit",
      status: "waiting_human",
      diagnosis: { reasonCode: "PRICING_LOGISTICS_RATIO_HIGH" },
    }],
  });

  const updated = await requestWorkflowPricingRecalculation(run.id, "match_profit", { note: "尺重已改" });
  const node = updated.nodes.find((item) => item.key === "match_profit");
  assert.equal(updated.status, "running");
  assert.equal(updated.locks.waitingHuman, false);
  assert.equal(node.status, "retrying");
  assert.equal(updated.events.at(-1).type, "pricing_recalculation_requested");
});

test("findOrCreateWorkflowForAutoListingJob reuses workflow by autoListingJobId", async () => {
  reset();
  const first = await findOrCreateWorkflowForAutoListingJob({
    id: "al_bind",
    bestMatch: { candidateTitle: "宠物喂食器", candidateUrl: "https://detail.1688.com/offer/1.html" },
    listingResult: { sku: "SKUlq00998", taskId: 123 },
  });
  const second = await findOrCreateWorkflowForAutoListingJob({ id: "al_bind" });

  assert.equal(first.id, second.id);
  assert.equal(second.entity.autoListingJobId, "al_bind");
  assert.equal(second.entity.parentSku, "SKUlq00998");
});

test("workflowNodeFromAutoListingStage maps early auto-listing stages", () => {
  const keywordNode = workflowNodeFromAutoListingStage("translating", {
    sourceText: "поилка для кошек",
    keyword: "кошачий фонтан",
    searchKeywords: ["кошачий фонтан", "фонтан для кошек"],
  });

  assert.equal(keywordNode.key, "keyword_expand");
  assert.equal(keywordNode.name, "关键词翻译与扩展");
  assert.equal(keywordNode.status, "running");
  assert.equal(keywordNode.output.sourceText, "поилка для кошек");
  assert.equal(keywordNode.output.keyword, "кошачий фонтан");
  assert.equal(keywordNode.output.keywordCount, 2);
  assert.deepEqual(keywordNode.output.searchKeywords, ["кошачий фонтан", "фонтан для кошек"]);
  assert.deepEqual(keywordNode.actions, ["view_output"]);

  assert.equal(workflowNodeFromAutoListingStage("waiting_crawl", { crawlerTaskIds: ["ct1"] }).key, "crawler_1688");
  assert.equal(workflowNodeFromAutoListingStage("matching", {}).key, "match_profit");
  assert.equal(workflowNodeFromAutoListingStage("generating_content", {}).key, "content_generate");
});

test("workflowNodeFromAutoListingStage summarizes Ozon learning samples", () => {
  const node = workflowNodeFromAutoListingStage("sampled", {
    sourceType: "keyword",
    sourceValue: "поилка для кошек",
    totalFound: 12,
    detailQueued: 4,
    detailedCount: 2,
    opportunityCount: 3,
    priceMinRub: 450,
    priceMaxRub: 1290,
    categoryCounts: { "Зоотовары": 8 },
    sampleTitles: ["Автоматическая поилка", "Фонтан для кошек"],
    nodeStatus: "success",
  });

  assert.equal(node.key, "ozon_learning");
  assert.equal(node.output.sourceType, "keyword");
  assert.equal(node.output.totalFound, 12);
  assert.equal(node.output.detailQueued, 4);
  assert.equal(node.output.opportunityCount, 3);
  assert.equal(node.output.priceMinRub, 450);
  assert.equal(node.output.categoryCounts["Зоотовары"], 8);
  assert.equal(node.output.sampleTitles.length, 2);
});

test("workflowNodeFromAutoListingStage summarizes match profit diagnostics", () => {
  const node = workflowNodeFromAutoListingStage("matching", {
    candidateCount: 12,
    evaluatedCount: 8,
    acceptedCount: 1,
    rejectedCount: 7,
    rejectedReasons: { shape_mismatch: 4, margin_low: 3 },
    rejectedSamples: [
      { title: "金属钥匙扣", reason: "形态不符", margin: 2 },
    ],
    bestMatch: {
      id: "cc_best",
      title: "猫咪饮水机",
      url: "https://detail.1688.com/offer/1.html",
      tier: "strict",
      margin: 28,
      confidence: 72,
      purchasePriceCny: 18,
      targetPriceCny: 59,
    },
    nodeStatus: "success",
  });

  assert.equal(node.key, "match_profit");
  assert.equal(node.output.evaluatedCount, 8);
  assert.equal(node.output.bestMatch.margin, 28);
  assert.equal(node.output.rejectedReasons.shape_mismatch, 4);
  assert.equal(node.output.rejectedSamples[0].reason, "形态不符");
  assert.equal(node.riskLevel, "low");
});

test("workflowNodeFromAutoListingStage carries pricing diagnosis for match profit", () => {
  const node = workflowNodeFromAutoListingStage("matching", {
    bestMatch: {
      title: "厨房收纳架",
      margin: 31,
      confidence: 80,
      purchasePriceCny: 20,
    },
    pricingDiagnosis: {
      purchaseCost: 25,
      purchaseMarkupRmb: 5,
      priceCny: 86.6,
      oldPriceCny: 173.2,
      minPriceCny: "86",
      currencyCode: "CNY",
      logisticsFee: 20.25,
      commission: 13,
      miscFee: 3.73,
      baseCost: 61.98,
      profit: 24.62,
      profitRate: 0.3,
      packageInfoSource: "1688_package",
      package: { weightG: 650, lengthMm: 220, widthMm: 160, heightMm: 80 },
      level: { id: "budget", name: "Budget" },
      steps: [{ iteration: 1, levelName: "Budget", nextPriceCny: 86.6 }],
    },
    nodeStatus: "success",
  });

  assert.equal(node.output.pricingDiagnosis.priceCny, 86.6);
  assert.equal(node.output.pricingDiagnosis.oldPriceCny, 173.2);
  assert.equal(node.output.pricingDiagnosis.minPriceCny, "86");
  assert.equal(node.output.pricingDiagnosis.packageInfoSource, "1688_package");
  assert.equal(node.output.pricingDiagnosis.level.name, "Budget");
  assert.equal(node.diagnosis.reasonCode, "PRICING_DIAGNOSIS_READY");
  assert.match(node.diagnosis.messageZh, /售价 86.6 CNY/);
  assert.ok(node.diagnosis.fixHints.some((hint) => /运费等级/.test(hint)));
});

test("workflowNodeFromAutoListingStage blocks unsafe pricing diagnosis", () => {
  const node = workflowNodeFromAutoListingStage("matching", {
    bestMatch: { margin: 20, confidence: 80, purchasePriceCny: 20 },
    pricingDiagnosis: {
      purchaseCost: 25,
      priceCny: 88,
      oldPriceCny: 176,
      minPriceCny: "88",
      logisticsFee: 18,
      commission: 13.2,
      miscFee: 3.76,
      baseCost: 59.96,
      profit: 28.04,
      profitRate: 0.3,
      converged: true,
      level: { id: "budget", name: "Budget" },
      package: { weightG: 0, lengthMm: 220, widthMm: 160, heightMm: 80 },
    },
    nodeStatus: "success",
  });

  assert.equal(node.status, "waiting_human");
  assert.equal(node.branch, "blocked");
  assert.equal(node.riskLevel, "high");
  assert.equal(node.diagnosis.reasonCode, "PRICING_PACKAGE_MISSING");
  assert.ok(node.recommendedActions.some((action) => /尺重/.test(action)));
});

test("workflowNodeFromAutoListingStage routes low-profit pricing to manual review", () => {
  const node = workflowNodeFromAutoListingStage("matching", {
    bestMatch: { margin: 8, confidence: 80, purchasePriceCny: 20 },
    pricingDiagnosis: {
      purchaseCost: 25,
      priceCny: 60,
      oldPriceCny: 120,
      minPriceCny: "59",
      logisticsFee: 20,
      commission: 9,
      miscFee: 3.2,
      baseCost: 57.2,
      profit: 2.8,
      profitRate: 0.3,
      converged: true,
      level: { id: "budget", name: "Budget" },
      package: { weightG: 650, lengthMm: 220, widthMm: 160, heightMm: 80 },
    },
    nodeStatus: "success",
  });

  assert.equal(node.status, "waiting_human");
  assert.equal(node.branch, "manual_review");
  assert.equal(node.riskLevel, "medium");
  assert.equal(node.diagnosis.reasonCode, "PRICING_PROFIT_LOW");
  assert.match(node.reason, /利润/);
});

test("workflowNodeFromAutoListingStage summarizes content generation diagnostics", () => {
  const node = workflowNodeFromAutoListingStage("generating_content", {
    listingContentReady: true,
    titleRu: "Автоматическая поилка для кошек",
    descriptionLength: 240,
    attributeHintKeys: ["brand", "material", "purpose"],
    candidateImageCount: 6,
    skuVariantCount: 3,
    sizeWeightReady: true,
    visualCardReady: true,
    contentIssues: [],
    nodeStatus: "success",
  });

  assert.equal(node.key, "content_generate");
  assert.equal(node.output.titleRu, "Автоматическая поилка для кошек");
  assert.equal(node.output.descriptionLength, 240);
  assert.deepEqual(node.output.attributeHintKeys, ["brand", "material", "purpose"]);
  assert.equal(node.output.candidateImageCount, 6);
  assert.equal(node.output.skuVariantCount, 3);
  assert.equal(node.output.sizeWeightReady, true);
  assert.equal(node.output.visualCardReady, true);
  assert.deepEqual(node.output.contentIssues, []);
  assert.equal(node.riskLevel, "low");
});

test("workflowNodeFromAutoListingStage marks failed early stages as blocking", () => {
  const crawlerNode = workflowNodeFromAutoListingStage("waiting_crawl", {
    nodeStatus: "failed",
  });

  assert.equal(crawlerNode.key, "crawler_1688");
  assert.equal(crawlerNode.status, "failed");
  assert.equal(crawlerNode.riskLevel, "high");
  assert.ok(crawlerNode.riskScore >= 70);
  assert.ok(crawlerNode.recommendedActions.includes("重新采集关键词"));
});

test("recommendWorkflowDecision explains risk and next action", () => {
  const decision = recommendWorkflowDecision("match_profit", {
    bestMatch: {
      tier: "volume_profit_fallback",
      margin: 3,
      confidence: 20,
    },
  });

  assert.equal(decision.branch, "manual_review");
  assert.equal(decision.riskLevel, "high");
  assert.ok(decision.riskScore >= 70);
  assert.match(decision.reason, /低置信|利润/);
  assert.ok(decision.recommendedActions.includes("人工复核候选"));
});

test("summarizeWorkflowRun highlights blocking and high-risk nodes", () => {
  const summary = summarizeWorkflowRun({
    status: "waiting_human",
    nodes: [
      { key: "keyword_expand", name: "关键词扩展", status: "success", riskScore: 15, riskLevel: "low" },
      {
        key: "match_profit",
        name: "匹配与利润分析",
        status: "failed",
        riskScore: 85,
        riskLevel: "high",
        reason: "低置信或利润偏低",
        recommendedActions: ["人工复核候选"],
      },
    ],
  });

  assert.equal(summary.currentNodeKey, "match_profit");
  assert.equal(summary.blockingNodeKey, "match_profit");
  assert.equal(summary.maxRiskScore, 85);
  assert.equal(summary.riskLevel, "high");
  assert.equal(summary.nextAction, "人工复核候选");
});

test("summarizeWorkflowRunList counts health buckets and common actions", () => {
  const summary = summarizeWorkflowRunList([
    {
      status: "waiting_human",
      locks: { waitingHuman: true },
      nodes: [{
        key: "match_profit",
        status: "failed",
        riskScore: 85,
        riskLevel: "high",
        recommendedActions: ["人工复核候选"],
      }],
    },
    {
      status: "live",
      locks: { submitLocked: true },
      nodes: [{ key: "stock_sync", status: "success", riskScore: 10, riskLevel: "low" }],
    },
    {
      status: "failed",
      locks: { paused: true },
      nodes: [{
        key: "preflight_check",
        status: "failed",
        riskScore: 76,
        riskLevel: "high",
        recommendedActions: ["重新校验 Payload"],
      }],
    },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.waitingHuman, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.live, 1);
  assert.equal(summary.lockedWaitingHuman, 1);
  assert.equal(summary.submitLocked, 1);
  assert.equal(summary.lockedPaused, 1);
  assert.equal(summary.highRisk, 2);
  assert.equal(summary.blocking, 2);
  assert.equal(summary.topNextActions[0].action, "人工复核候选");
});

test("workflowDuplicateListingNode marks duplicate listing as blocking preflight", () => {
  const node = workflowDuplicateListingNode({
    duplicateJobId: "al_old",
    duplicateSku: "SKUlq00136",
    message: "检测到同一Ozon参考品或1688货源已经提交过",
  });

  assert.equal(node.key, "preflight_check");
  assert.equal(node.status, "failed");
  assert.equal(node.runStatus, "waiting_human");
  assert.equal(node.diagnosis.reasonCode, "DUPLICATE_LISTING");
  assert.ok(node.recommendedActions.includes("人工确认是否换货源"));
});

test("workflowReviewReconcileNode summarizes Ozon import feedback", () => {
  const node = workflowReviewReconcileNode({
    taskId: 12345,
    importedItems: [],
    importWarnings: [{ code: "WARN", message: "warning only" }],
    importErrors: [{
      attribute_id: 9048,
      attribute_name: "Название модели",
      message: "Название модели обязательное поле",
    }],
    skuOffers: ["SKUlq001-variant-1"],
  });

  assert.equal(node.key, "review_reconcile");
  assert.equal(node.status, "failed");
  assert.equal(node.runStatus, "waiting_human");
  assert.equal(node.output.taskId, 12345);
  assert.equal(node.output.importedCount, 0);
  assert.equal(node.output.errorCount, 1);
  assert.equal(node.output.warningCount, 1);
  assert.equal(node.output.reasonCode, "ATTRIBUTE_REQUIRED");
  assert.equal(node.diagnosis.reasonCode, "ATTRIBUTE_REQUIRED");
  assert.ok(node.recommendedActions.includes("按诊断修复 Payload"));
});

test("workflowCurrentProductTask maps review failure to listing repair", () => {
  const reviewNode = workflowReviewReconcileNode({
    taskId: 12345,
    importErrors: [{
      attribute_id: 9048,
      attribute_name: "Название модели",
      message: "Название модели обязательное поле",
    }],
    skuOffers: ["SKU-REPAIR"],
  });
  const task = workflowCurrentProductTask({
    title: "Cat feeder",
    nodes: [reviewNode],
  });

  assert.equal(task.stage, "listing_repair");
  assert.equal(task.status, "blocked");
  assert.equal(task.productTitle, "Cat feeder");
  assert.equal(task.blockedAt, "审核回执");
  assert.match(task.reason, /Название модели|属性/);
  assert.equal(task.view, "workflow-console");
  assert.equal(task.nodeKey, "review_reconcile");
  assert.match(task.nextAction, /修复/);
});

test("summarizeWorkflowRun maps accepted low score products to content improvement", () => {
  const summary = summarizeWorkflowRun({
    title: "Low score keychain",
    nodes: [
      {
        key: "review_reconcile",
        name: "审核回执",
        status: "success",
        output: { importedItems: [{ offer_id: "SKU-LIVE", product_id: 88 }] },
        recommendedActions: ["继续库存写入"],
      },
      {
        key: "preflight_check",
        name: "提交前校验",
        status: "success",
        output: {
          listingQuality: {
            contentScore: 58,
            scoreBreakdown: [
              { key: "media", name: "图片与媒体", score: 45, status: "warning", reason: "产品图不足，缺少 SKU 区分图。" },
            ],
          },
        },
      },
    ],
  });

  assert.equal(summary.currentProductTask.stage, "content_improvement");
  assert.equal(summary.currentProductTask.status, "needs_improvement");
  assert.equal(summary.currentProductTask.blockedAt, "商品分值");
  assert.match(summary.currentProductTask.reason, /图片与媒体|产品图/);
  assert.equal(summary.currentProductTask.view, "listing");
});

test("summarizeWorkflowRun maps stock waiting to warehouse queue task", () => {
  const summary = summarizeWorkflowRun({
    title: "Imported item",
    nodes: [
      {
        key: "review_reconcile",
        name: "审核回执",
        status: "success",
        output: { importedItems: [{ offer_id: "SKU-STOCK", product_id: 89 }] },
      },
      {
        key: "stock_sync",
        name: "库存写入",
        status: "running",
        reason: "等待 Ozon 创建商品：SKU-STOCK",
        output: { stocks: [{ offer_id: "SKU-STOCK", warehouse_id: 302, stock: 10 }] },
      },
    ],
  });

  assert.equal(summary.currentProductTask.stage, "warehouse_queue");
  assert.equal(summary.currentProductTask.status, "waiting");
  assert.equal(summary.currentProductTask.blockedAt, "库存写入");
  assert.match(summary.currentProductTask.nextAction, /库存队列/);
  assert.equal(summary.currentProductTask.view, "warehouse");
});

test("workflowReviewReconcileNode blocks stock flow when variant grouping failed", () => {
  const node = workflowReviewReconcileNode({
    taskId: 12346,
    importedItems: [{ product_id: 88, offer_id: "SKU-RED" }],
    listingDefects: [{
      level: "warning",
      code: "double_without_merger_offer",
      message: "Cannot merge products because variable characteristics are identical",
    }],
    skuOffers: ["SKU-RED", "SKU-BLUE"],
  });

  assert.equal(node.status, "failed");
  assert.equal(node.runStatus, "waiting_human");
  assert.equal(node.output.listingDefectCount, 1);
  assert.equal(node.output.reasonCode, "VARIANT_GROUPING_FAILED");
  assert.equal(node.branch, "variant_grouping_fix");
  assert.ok(node.recommendedActions.includes("修正变体特征后整组重提"));
});

test("buildVariantGroupingDiagnosis groups duplicate Ozon aspect combinations", () => {
  const diagnosis = buildVariantGroupingDiagnosis({
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)" },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    items: [
      { offer_id: "SKU-WHITE-1", attributes: [{ id: 9048, values: [{ value: "Cat keychain" }] }, { id: 10097, values: [{ value: "белый" }] }] },
      { offer_id: "SKU-WHITE-2", attributes: [{ id: 9048, values: [{ value: "Cat keychain" }] }, { id: 10097, values: [{ value: "белый" }] }] },
      { offer_id: "SKU-BLUE", attributes: [{ id: 9048, values: [{ value: "Cat keychain" }] }, { id: 10097, values: [{ value: "синий" }] }] },
    ],
  });

  assert.equal(diagnosis.rows.length, 3);
  assert.equal(diagnosis.duplicateGroups.length, 1);
  assert.deepEqual(diagnosis.duplicateGroups[0].offerIds, ["SKU-WHITE-1", "SKU-WHITE-2"]);
  assert.equal(diagnosis.rows.find((row) => row.offerId === "SKU-BLUE").duplicateGroup, "");
});

test("buildVariantGroupingRepairDraft rejects an incomplete variant group", () => {
  const originalPayload = {
    items: [{ offer_id: "SKU-WHITE" }, { offer_id: "SKU-BLUE" }],
  };

  assert.equal(buildVariantGroupingRepairDraft({ originalPayload, skuOffers: ["SKU-WHITE", "SKU-BLUE"] }).ok, true);
  assert.deepEqual(buildVariantGroupingRepairDraft({
    originalPayload: { items: [{ offer_id: "SKU-WHITE" }] },
    skuOffers: ["SKU-WHITE", "SKU-BLUE"],
  }), {
    ok: false,
    code: "INCOMPLETE_VARIANT_GROUP",
    message: "修复草稿缺少整组 SKU：SKU-BLUE",
    missingOfferIds: ["SKU-BLUE"],
  });
});

test("workflowReviewReconcileNode exposes a complete variant grouping repair draft", () => {
  const submitPayload = {
    items: [
      { offer_id: "SKU-WHITE", attributes: [{ id: 10097, values: [{ value: "белый" }] }] },
      { offer_id: "SKU-BLUE", attributes: [{ id: 10097, values: [{ value: "белый" }] }] },
    ],
  };
  const node = workflowReviewReconcileNode({
    listingDefects: [{ code: "double_without_merger_offer", level: "warning" }],
    skuOffers: ["SKU-WHITE", "SKU-BLUE"],
    submitPayload,
    attrsMeta: [{ id: 10097, name: "Название цвета", is_aspect: true }],
  });

  assert.equal(node.output.variantGroupingDiagnosis.duplicateGroups.length, 1);
  assert.equal(node.output.variantGroupingRepairDraft.ok, true);
  assert.equal(node.output.variantGroupingRepairDraft.payload.items.length, 2);
});

test("workflowReviewReconcileNode diagnoses the failed payload but saves a corrected repair payload", () => {
  const attrsMeta = [{ id: 10097, name: "Название цвета", is_aspect: true }];
  const failedPayload = { items: [
    { offer_id: "SKU-WHITE", attributes: [{ id: 10097, values: [{ value: "белый" }] }] },
    { offer_id: "SKU-BLUE", attributes: [{ id: 10097, values: [{ value: "белый" }] }] },
  ] };
  const repairPayload = { items: [
    { offer_id: "SKU-WHITE", attributes: [{ id: 10097, values: [{ value: "белый" }] }] },
    { offer_id: "SKU-BLUE", attributes: [{ id: 10097, values: [{ value: "синий" }] }] },
  ] };
  const node = workflowReviewReconcileNode({
    listingDefects: [{ code: "double_without_merger_offer", level: "warning" }],
    skuOffers: ["SKU-WHITE", "SKU-BLUE"],
    submitPayload: failedPayload,
    repairPayload,
    attrsMeta,
  });

  assert.equal(node.output.variantGroupingDiagnosis.duplicateGroups.length, 1);
  assert.equal(node.output.variantGroupingRepairDraft.payload.items[1].attributes[0].values[0].value, "синий");
});
