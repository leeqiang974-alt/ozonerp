import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  acceptWorkflowPricingRisk,
  appendWorkflowEvent,
  applyPayloadDraftAttributeRepair,
  approveWorkflowMediaCandidates,
  publishWorkflowMediaApproval,
  buildListingAttributeMatrix,
  buildVariantConfigurationSummary,
  buildSourceVariantBindingSummary,
  buildSourceVariantBindingReceipt,
  buildVariantGroupingDiagnosis,
  buildVariantGroupingRepairDraft,
  buildReviewRepairDraft,
  buildPreflightGateNode,
  buildPreflightSellerResult,
  createWorkflowRun,
  diagnoseWorkflowError,
  findOrCreateWorkflowForAutoListingJob,
  getWorkflowRun,
  invalidatePayloadDraftValidation,
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
  reconcileWorkflowTaskReadback,
  summarizeWorkflowRunList,
  summarizeWorkflowRun,
  upsertWorkflowNode,
  validatePayloadDraft,
  validateSubmitPayload,
  workflowCurrentProductTask,
} from "../src/workflowRuns.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ozon-workflow-runs-test-"));
const tmpFile = path.join(tmpDir, "workflow-runs.json");
const tmpCategoryCacheFile = path.join(tmpDir, "ozon-category-cache.json");
const multiSkuRepairFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/1688/color-size-matrix/listing-repair.mocked.json", import.meta.url), "utf8"));
const execFileAsync = promisify(execFile);

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  try { fs.unlinkSync(tmpFile); } catch {}
  try { fs.unlinkSync(tmpCategoryCacheFile); } catch {}
  process.env.WORKFLOW_RUNS_FILE = tmpFile;
  process.env.OZON_CATEGORY_CACHE_FILE = tmpCategoryCacheFile;
}

test("workflow store serializes concurrent writers across local processes", async () => {
  reset();
  const moduleUrl = new URL("../src/workflowRuns.js", import.meta.url).href;
  await Promise.all(Array.from({ length: 8 }, (_, index) => execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", `
      process.env.WORKFLOW_RUNS_FILE = ${JSON.stringify(tmpFile)};
      const { createWorkflowRun } = await import(${JSON.stringify(moduleUrl)});
      await createWorkflowRun({ id: "wr_process_${index}", title: "process ${index}" });
    `],
    { cwd: path.resolve("."), windowsHide: true },
  )));
  const stored = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
  assert.deepEqual(
    stored.items.map((run) => run.id).sort(),
    Array.from({ length: 8 }, (_, index) => `wr_process_${index}`),
  );
});

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

test("seller input changes invalidate old preflight and lock submission before payload rebuild", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "商品资料变更",
    status: "waiting_human",
    locks: { waitingHuman: true, submitLocked: false },
  });
  await savePayloadDraft(run.id, { items: [{ offer_id: "SKU-OLD" }] });
  const file = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
  const persisted = file.items.find((item) => item.id === run.id);
  persisted.payloadDraftValidation = { ok: true, draftHash: persisted.payloadDraftHash };
  persisted.validatedDraftHash = persisted.payloadDraftHash;
  persisted.locks.submitLocked = false;
  fs.writeFileSync(tmpFile, JSON.stringify(file, null, 2));

  await invalidatePayloadDraftValidation(run.id, "seller_input_changed");
  const invalidated = await getWorkflowRun(run.id);
  assert.equal(invalidated.payloadDraftValidation, null);
  assert.equal(invalidated.validatedDraftHash, "");
  assert.equal(invalidated.payloadDraftStale, true);
  assert.equal(invalidated.payloadDraftStaleReason, "seller_input_changed");
  assert.equal(invalidated.locks.submitLocked, true);
  assert.equal(invalidated.payloadDraft.items[0].offer_id, "SKU-OLD");

  const staleValidation = await validatePayloadDraft(run.id);
  assert.equal(staleValidation.ok, false);
  assert.equal(staleValidation.reasonCode, "PAYLOAD_DRAFT_STALE");
  assert.equal((await getWorkflowRun(run.id)).locks.submitLocked, true);

  let ozonCalled = false;
  const staleSubmission = await submitPayloadDraftToOzon(run.id, {
    confirmSubmit: true,
    expectedDraftHash: invalidated.payloadDraftHash,
  }, {
    getStore: () => ({ id: "store-stale" }),
    ozonRequest: async () => {
      ozonCalled = true;
      return {};
    },
  });
  assert.equal(staleSubmission.ok, false);
  assert.equal(staleSubmission.reasonCode, "PAYLOAD_DRAFT_STALE");
  assert.equal(ozonCalled, false);

  await savePayloadDraft(run.id, { items: [{ offer_id: "SKU-NEW" }] });
  const rebuilt = await getWorkflowRun(run.id);
  assert.equal(rebuilt.payloadDraftStale, false);
  assert.equal(rebuilt.payloadDraftStaleReason, "");
  assert.equal(rebuilt.validatedDraftHash, "");
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

test("preflight exposes seller result with repair field, action, side effect and outcome", () => {
  const node = buildPreflightGateNode({
    payload: { items: [{ offer_id: "OFFER-SELLER", price: 0, images: [] }] },
    category: null,
    contentSummary: { candidateImageCount: 0, skuVariantCount: 1, sizeWeightReady: false },
    variantCount: 1,
  });
  const sellerResult = node.output.sellerResult;
  assert.equal(sellerResult.status, "blocked");
  assert.equal(sellerResult.outcome, "submission_not_started");
  assert.match(sellerResult.nextAction, /修复/);
  assert.equal(sellerResult.sideEffect, "仅本地预检，不会写入 Ozon 或扣费。按建议修复草稿后必须重新预检。");
  assert.ok(sellerResult.repairs.some((repair) => repair.fieldPath === "items[0].price"));
  assert.ok(sellerResult.repairs.every((repair) => repair.action && repair.sideEffect && repair.result));
});

test("preflight blocks an omitted category instead of treating undefined as selected", () => {
  const node = buildPreflightGateNode({
    payload: { items: [{ offer_id: "OFFER-NO-CATEGORY", price: 100, images: ["1", "2", "3"] }] },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    variantCount: 1,
  });
  assert.equal(node.output.ok, false);
  assert.ok(node.output.issues.some((issue) => issue.code === "CATEGORY_MATCH_MISSING"));
});

test("preflight blocks Russian content evidence until human fact review", () => {
  const node = buildPreflightGateNode({
    payload: {
      items: [{
        offer_id: "OFFER-CONTENT-REVIEW",
        name: "Товар",
        description_category_id: 17028673,
        type_id: 95183,
        price: "100",
        old_price: "120",
        min_price: "90",
        marketing_price: "100",
        currency_code: "RUB",
        model_info: { model_id: 1 },
        images: ["1", "2", "3"],
        attributes: [
          { complex_id: 0, id: 8229, values: [{ dictionary_value_id: 0, value: "Model" }] },
        ],
      }],
    },
    category: { description_category_id: 17028673, type_id: 95183, path: "家居 / 收纳" },
    contentSummary: {
      candidateImageCount: 3,
      skuVariantCount: 1,
      sizeWeightReady: true,
      contentEvidence: { status: "needs_review", blockerCodes: ["CONTENT_FACT_REVIEW_REQUIRED"] },
    },
    variantCount: 1,
  });
  assert.equal(node.output.ok, false);
  const issue = node.output.issues.find((entry) => entry.code === "CONTENT_EVIDENCE_REVIEW_REQUIRED");
  assert.ok(issue);
  assert.equal(issue.status, "needs_review");
  assert.deepEqual(issue.blockerCodes, ["CONTENT_FACT_REVIEW_REQUIRED"]);
});

test("preflight blocks 1688 listing when current Ozon category evidence is missing", () => {
  const node = buildPreflightGateNode({
    payload: {
      items: [{
        offer_id: "OFFER-CATEGORY-EVIDENCE",
        name: "Товар",
        description_category_id: 17028673,
        type_id: 95183,
        price: "100",
        old_price: "120",
        min_price: "90",
        marketing_price: "100",
        currency_code: "RUB",
        model_info: { model_id: 1 },
        images: ["1", "2", "3"],
        attributes: [{ complex_id: 0, id: 8229, values: [{ dictionary_value_id: 0, value: "Model" }] }],
      }],
    },
    category: { description_category_id: 17028673, type_id: 95183, path: "家居 / 收纳" },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    categoryEvidenceRequired: true,
    categoryEvidence: { tree: null, attributes: null },
    variantCount: 1,
  });
  assert.equal(node.output.ok, false);
  const issue = node.output.issues.find((entry) => entry.code === "CATEGORY_EVIDENCE_MISSING");
  assert.ok(issue);
  assert.deepEqual(issue.missing, ["tree", "attributes"]);
  assert.match(node.output.sellerResult.repairs.find((repair) => repair.code === "CATEGORY_EVIDENCE_MISSING").action, /重新读取/);
});

test("preflight accepts current same-store category evidence without affecting old draft compatibility", () => {
  const evidence = (extra = {}) => ({
    checkedAt: new Date().toISOString(),
    statusCode: 200,
    verificationLevel: "server_observed",
    responseHash: `sha256:${"c".repeat(64)}`,
    storeId: "2367028-1",
    environmentRefHash: `sha256:${"e".repeat(64)}`,
    ...extra,
  });
  const node = buildPreflightGateNode({
    payload: {
      items: [{
        offer_id: "OFFER-CATEGORY-EVIDENCE-OK",
        name: "Товар",
        description_category_id: 17028673,
        type_id: 95183,
        price: "100",
        old_price: "120",
        min_price: "90",
        marketing_price: "100",
        currency_code: "RUB",
        model_info: { model_id: 1 },
        images: ["1", "2", "3"],
        attributes: [{ complex_id: 0, id: 8229, values: [{ dictionary_value_id: 0, value: "Model" }] }],
      }],
    },
    category: { description_category_id: 17028673, type_id: 95183, path: "家居 / 收纳" },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    categoryEvidenceRequired: true,
    categoryEvidenceStoreId: "2367028-1",
    categoryEvidenceEnvironmentRefHash: `sha256:${"e".repeat(64)}`,
    categoryEvidence: {
      tree: evidence(),
      attributes: evidence({ cacheKey: "17028673:95183" }),
    },
    variantCount: 1,
  });
  assert.equal(node.output.issues.some((entry) => entry.code === "CATEGORY_EVIDENCE_MISSING"), false);
  const oldDraft = buildPreflightGateNode({
    payload: { items: [{ offer_id: "OLD-DRAFT", description_category_id: 17028673, type_id: 95183, price: 100, images: ["1", "2", "3"] }] },
    category: { description_category_id: 17028673, type_id: 95183 },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    variantCount: 1,
  });
  assert.equal(oldDraft.output.issues.some((entry) => entry.code === "CATEGORY_EVIDENCE_MISSING"), false);
});

test("preflight rejects category evidence without strict store, environment, or attribute cache binding", () => {
  const payload = {
    items: [{
      offer_id: "OFFER-CATEGORY-EVIDENCE-SCOPE",
      name: "Товар",
      description_category_id: 17028673,
      type_id: 95183,
      price: "100",
      old_price: "120",
      min_price: "90",
      marketing_price: "100",
      currency_code: "RUB",
      model_info: { model_id: 1 },
      images: ["1", "2", "3"],
      attributes: [{ complex_id: 0, id: 8229, values: [{ dictionary_value_id: 0, value: "Model" }] }],
    }],
  };
  const expectedEnvironment = `sha256:${"e".repeat(64)}`;
  const baseEvidence = {
    checkedAt: new Date().toISOString(),
    statusCode: 200,
    verificationLevel: "server_observed",
    responseHash: `sha256:${"c".repeat(64)}`,
    storeId: "2367028-1",
    environmentRefHash: expectedEnvironment,
  };
  const run = (tree, attributes) => buildPreflightGateNode({
    payload,
    category: { description_category_id: 17028673, type_id: 95183, path: "家居 / 收纳" },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    categoryEvidenceRequired: true,
    categoryEvidenceStoreId: "2367028-1",
    categoryEvidenceEnvironmentRefHash: expectedEnvironment,
    categoryEvidence: { tree, attributes },
    variantCount: 1,
  });

  const missingStore = run(
    { ...baseEvidence, storeId: "" },
    { ...baseEvidence, cacheKey: "17028673:95183", storeId: "" },
  );
  assert.ok(missingStore.output.issues.some((entry) => entry.code === "CATEGORY_EVIDENCE_MISSING"));

  const wrongEnvironment = run(
    { ...baseEvidence, environmentRefHash: `sha256:${"f".repeat(64)}` },
    { ...baseEvidence, cacheKey: "17028673:95183", environmentRefHash: `sha256:${"f".repeat(64)}` },
  );
  assert.ok(wrongEnvironment.output.issues.some((entry) => entry.code === "CATEGORY_EVIDENCE_MISSING"));

  const missingCacheKey = run(baseEvidence, { ...baseEvidence });
  assert.ok(missingCacheKey.output.issues.some((entry) => entry.code === "CATEGORY_EVIDENCE_MISSING"));
});

test("preflight seller result exposes multi-SKU source binding coverage", () => {
  const payload = {
    items: [
      { offer_id: "OFFER-WHITE", attributes: [], images: [] },
      { offer_id: "OFFER-BLUE", attributes: [], images: [] },
    ],
  };
  const sourceVariantBinding = buildSourceVariantBindingSummary({
    payload,
    sourceVariants: [{ offerId: "OFFER-WHITE", sourceSkuId: "1688-WHITE", spec: "白色" }],
  });
  const sellerResult = buildPreflightSellerResult({
    payload,
    issues: [{ code: "SOURCE_SKU_BINDING_MISSING", offerId: "OFFER-BLUE", message: "缺少来源绑定" }],
    sourceVariantBinding,
    variantConfiguration: {
      rows: [
        { offerId: "OFFER-WHITE", rowStatus: "valid", sourceVariant: { sourceSkuId: "1688-WHITE", spec: "白色" } },
        { offerId: "OFFER-BLUE", rowStatus: "missing_aspect", sourceVariant: null },
      ],
      summary: { itemCount: 2 },
    },
  });
  assert.equal(sellerResult.variantCoverage.status, "blocked");
  assert.equal(sellerResult.variantCoverage.sourceBinding.missingOfferIds[0], "OFFER-BLUE");
  assert.equal(sellerResult.variantCoverage.rows.length, 2);
  assert.match(sellerResult.variantCoverage.nextAction, /逐条来源绑定/);
});

test("multi-SKU source binding fails closed when Offer order changes", () => {
  const summary = buildSourceVariantBindingSummary({
    payload: { items: [{ offer_id: "OFFER-BLUE" }, { offer_id: "OFFER-WHITE" }] },
    sourceVariants: [
      { offerId: "OFFER-WHITE", sourceSkuId: "1688-WHITE", spec: "白色" },
      { offerId: "OFFER-GREEN", sourceSkuId: "1688-GREEN", spec: "绿色" },
    ],
  });
  assert.equal(summary.summary.ready, false);
  assert.deepEqual(summary.summary.missingOfferIds, ["OFFER-BLUE"]);
  assert.equal(summary.rows[0].sourceSkuId, "");
  assert.equal(summary.rows[1].sourceSkuId, "1688-WHITE");
});

test("preflight seller repair summary points listing-quality issues to the concrete SKU field", () => {
  const sellerResult = buildPreflightSellerResult({
    payload: { items: [{ offer_id: "OFFER-QUALITY", images: ["1", "2", "3"] }] },
    issues: [{
      code: "LISTING_QUALITY_DICTIONARY_VALUE_INVALID",
      qualityCode: "DICTIONARY_VALUE_INVALID",
      source: "listing_quality",
      offerId: "OFFER-QUALITY",
      attributeId: 85,
      enteredValues: ["旧值"],
      dictionaryCandidates: [{ dictionary_value_id: 123, value: "合法值" }],
      message: "字典值不合法",
    }],
  });
  assert.equal(sellerResult.repairs[0].fieldPath, "items[0].attributes[id=85]");
  assert.equal(sellerResult.repairs[0].repairTarget.attributeId, 85);
  assert.equal(sellerResult.repairs[0].repairTarget.candidateCount, 1);
  assert.match(sellerResult.repairs[0].action, /合法字典值/);
  assert.deepEqual(sellerResult.repairSummary.fieldTargets, ["items[0].attributes[id=85]"]);
});

test("buildPreflightGateNode blocks a 1688 submission without a valid source snapshot", () => {
  const node = buildPreflightGateNode({
    payload: { items: [{ offer_id: "OFFER-SOURCE", price: 100, old_price: 120, min_price: 90, marketing_price: 100, currency_code: "RUB", model_info: { model_id: 1 }, attributes: [{ complex_id: 0, id: 8229, values: [{ dictionary_value_id: 0, value: "Модель" }] }] }] },
    category: { path: "家居 / 收纳" },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    variantCount: 1,
    sourceEvidenceRequired: true,
    sourceEvidence: {},
  });
  assert.equal(node.output.ok, false);
  assert.ok(node.output.issues.some((issue) => issue.code === "SOURCE_EVIDENCE_MISSING"));
});

test("buildPreflightGateNode blocks an unverified default commission before confirmation", () => {
  const result = buildPreflightGateNode({
    payload: { items: [{ offer_id: "PRICE-GATE-1", name: "商品", price: "100", images: ["https://img/1", "https://img/2", "https://img/3"], attributes: [] }] },
    category: { description_category_id: 1, type_id: 2, path: "fixture/category" },
    pricing: {
      priceCny: 100,
      minPriceCny: 80,
      profit: 30,
      package: { weightG: 100, lengthMm: 100, widthMm: 100, heightMm: 100 },
      level: { id: "budget" },
      commissionRate: 0.15,
      commissionSource: { source: "manual_default", confidence: "low" },
      procurementEvidence: { status: "verified" },
      converged: true,
    },
  });
  assert.equal(result.output.ok, false);
  assert.ok(result.output.issues.some((issue) => issue.code === "PRICING_COMMISSION_SOURCE_MISSING"));
});

test("buildPreflightGateNode blocks a captured 1688 challenge page despite its HTML hash", () => {
  const node = buildPreflightGateNode({
    payload: { items: [{ offer_id: "OFFER-CHALLENGE", price: 100, old_price: 120, min_price: 90, marketing_price: 100, currency_code: "RUB", model_info: { model_id: 1 }, attributes: [{ complex_id: 0, id: 8229, values: [{ dictionary_value_id: 0, value: "Модель" }] }] }] },
    category: { path: "家居 / 收纳" },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    variantCount: 1,
    sourceEvidenceRequired: true,
    sourceEvidence: { snapshotHash: `sha256:${"b".repeat(64)}`, verificationState: "waiting_human" },
  });
  assert.equal(node.output.ok, false);
  const issue = node.output.issues.find((entry) => entry.code === "SOURCE_EVIDENCE_NOT_VERIFIED");
  assert.ok(issue);
  assert.equal(issue.verificationState, "waiting_human");
});

test("buildPreflightGateNode blocks an 1688 snapshot without product identity", () => {
  const node = buildPreflightGateNode({
    payload: { items: [{ offer_id: "OFFER-IDENTITY", price: 100, images: ["https://img/1", "https://img/2", "https://img/3"] }] },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    variantCount: 1,
    sourceEvidenceRequired: true,
    sourceIdentityRequired: true,
    sourceEvidence: { snapshotHash: `sha256:${"f".repeat(64)}`, verificationState: "ok", canonicalUrl: "https://detail.1688.com/offer/identity.html" },
  });
  assert.equal(node.output.ok, false);
  assert.ok(node.output.issues.some((issue) => issue.code === "SOURCE_IDENTITY_MISSING"));
});

test("buildPreflightGateNode exposes seller evidence gaps and the safe next action", () => {
  const node = buildPreflightGateNode({
    payload: { items: [{ offer_id: "OFFER-EVIDENCE" }] },
    category: { path: "家居 / 收纳", description_category_id: 1, type_id: 2 },
    sourceEvidenceRequired: true,
    sourceEvidence: { snapshotHash: `sha256:${"c".repeat(64)}`, verificationState: "waiting_human" },
    categoryEvidenceRequired: true,
    categoryEvidence: {},
    contentSummary: {
      candidateImageCount: 3,
      skuVariantCount: 1,
      sizeWeightReady: true,
      contentEvidence: { status: "needs_review", blockerCodes: ["CONTENT_FACT_UNSUPPORTED"] },
    },
    variantCount: 1,
  });
  const summary = node.output.sellerResult.evidenceSummary;
  assert.equal(summary.source.status, "needs_review");
  assert.match(summary.source.nextAction, /人工.*1688/);
  assert.equal(summary.content.status, "needs_review");
  assert.equal(summary.category.status, "missing");
  assert.match(node.output.sellerResult.nextAction, /人工.*1688/);
});

test("buildSourceVariantBindingSummary exposes missing and duplicate 1688 SKU bindings", () => {
  const summary = buildSourceVariantBindingSummary({
    payload: { items: [{ offer_id: "SKU-WHITE" }, { offer_id: "SKU-BLUE" }, { offer_id: "SKU-RED" }] },
    sourceVariants: [
      { offerId: "SKU-WHITE", skuId: "source-1", spec: "白色" },
      { offerId: "SKU-BLUE", skuId: "source-1", spec: "蓝色" },
      { offerId: "SKU-RED", spec: "红色" },
    ],
  });
  assert.equal(summary.summary.ready, false);
  assert.deepEqual(summary.summary.missingOfferIds, ["SKU-RED"]);
  assert.deepEqual(summary.summary.duplicateSourceSkuIds, ["source-1"]);
});

test("buildSourceVariantBindingReceipt hashes offer and source SKU bindings without raw ids", () => {
  const receipt = buildSourceVariantBindingReceipt({
    payload: { items: [{ offer_id: "OFFER-1" }] },
    sourceVariants: [{ offerId: "OFFER-1", skuId: "SOURCE-1", spec: "白色" }],
    sourceEvidence: { snapshotHash: `sha256:${"a".repeat(64)}` },
  });
  assert.equal(receipt.ready, true);
  assert.equal(receipt.verificationLevel, "locally_tested");
  assert.match(receipt.sourceSnapshotHash, /^sha256:/);
  assert.match(receipt.rows[0].offerRef, /^sha256:/);
  assert.doesNotMatch(JSON.stringify(receipt), /OFFER-1|SOURCE-1/);
});

test("buildPreflightGateNode blocks a source SKU bound to a different 1688 snapshot", () => {
  const current = `sha256:${"a".repeat(64)}`;
  const node = buildPreflightGateNode({
    payload: { items: [{ offer_id: "OFFER-CURRENT", price: 100, old_price: 120, min_price: 90, marketing_price: 100, currency_code: "RUB", model_info: { model_id: 1 }, attributes: [{ complex_id: 0, id: 8229, values: [{ dictionary_value_id: 0, value: "Модель" }] }] }] },
    category: { path: "家居 / 收纳" },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    variantCount: 1,
    sourceEvidence: { snapshotHash: current, verificationState: "ok" },
    sourceEvidenceRequired: true,
    sourceVariantBindingRequired: true,
    sourceVariantEvidenceRequired: true,
    sourceVariants: [{ offerId: "OFFER-CURRENT", sourceSkuId: "SOURCE-OLD", sourceSnapshotHash: `sha256:${"b".repeat(64)}`, spec: "白色" }],
  });
  assert.equal(node.output.ok, false);
  assert.ok(node.output.issues.some((issue) => issue.code === "SOURCE_SKU_BINDING_MISSING"));
  assert.equal(node.output.sourceVariantBindingReceipt.ready, false);
});

test("buildPreflightGateNode blocks 1688 payload without complete source SKU binding", () => {
  const node = buildPreflightGateNode({
    payload: { items: [{ offer_id: "SKU-WHITE", price: 100, old_price: 120, min_price: 90, marketing_price: 100, currency_code: "RUB", model_info: { model_id: 1 }, attributes: [{ complex_id: 0, id: 8229, values: [{ dictionary_value_id: 0, value: "Модель" }] }] }] },
    category: { path: "家居 / 收纳" },
    contentSummary: { candidateImageCount: 3, skuVariantCount: 1, sizeWeightReady: true },
    variantCount: 1,
    sourceVariantBindingRequired: true,
    sourceVariants: [{ offerId: "SKU-WHITE", spec: "白色" }],
  });
  assert.equal(node.output.ok, false);
  assert.ok(node.output.issues.some((issue) => issue.code === "SOURCE_SKU_BINDING_MISSING"));
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
  assert.equal(node.output.requiredAttributeRuleCandidateIndex.totalCount, 2);
  assert.equal(node.output.requiredAttributeRuleCandidateIndex.readOnly, true);
  const manualRuleCandidate = node.output.requiredAttributeRuleCandidateIndex.candidates.find((candidate) => candidate.attributeId === 1234);
  const dictionaryRuleCandidate = node.output.requiredAttributeRuleCandidateIndex.candidates.find((candidate) => candidate.attributeId === 777);
  assert.equal(manualRuleCandidate.ruleStatus, "candidate");
  assert.equal(dictionaryRuleCandidate.source, "required_attribute_dictionary_candidate");
  assert.deepEqual(dictionaryRuleCandidate.candidateValues, [{
    dictionaryValueId: 11,
    value: "пластик",
    confidence: 0.78,
    source: "product_text",
  }]);
  assert.equal(node.output.requiredAttributeRuleCandidateIndex.candidates.some((candidate) => candidate.attributeId === 999), false);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.readOnly, true);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.totalCount, 3);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.readyForReviewCount, 1);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.reviewQueue[0].attributeId, 1234);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.reviewQueue[0].occurrenceCount, 2);
  assert.equal(node.output.requiredAttributeRuleCandidateHistory.reviewQueue[0].ruleStatus, "ready_for_review");
  const materialHistoryCandidate = node.output.requiredAttributeRuleCandidateHistory.reviewQueue.find((candidate) => candidate.attributeId === 777);
  assert.equal(materialHistoryCandidate.ruleStatus, "collect_more_samples");
  assert.deepEqual(materialHistoryCandidate.candidateValues, [{
    dictionaryValueId: 11,
    value: "пластик",
    confidence: 0.78,
    source: "product_text",
    occurrenceCount: 1,
  }]);
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

test("buildVariantConfigurationSummary suggests read-only aspect values from source SKU specs", () => {
  const summary = buildVariantConfigurationSummary({
    payload: { items: [
      {
        offer_id: "SKU-WHITE",
        images: ["https://example.com/white.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
        ],
      },
      {
        offer_id: "SKU-BLUE",
        images: ["https://example.com/blue.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
        ],
      },
    ] },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    sourceVariants: [
      { offerId: "SKU-WHITE", spec: "白色" },
      { offerId: "SKU-BLUE", spec: "蓝色" },
    ],
  });

  const white = summary.rows.find((row) => row.offerId === "SKU-WHITE");
  const blue = summary.rows.find((row) => row.offerId === "SKU-BLUE");
  assert.equal(summary.summary.suggestedAspectRowCount, 2);
  assert.equal(white.sourceVariant.spec, "白色");
  assert.deepEqual(white.suggestedAspects, [{
    attributeId: 10097,
    attributeName: "Название цвета",
    value: "белый",
    source: "1688_sku_spec",
    confidence: 0.72,
    readOnly: true,
    forbiddenEffects: ["payload_write", "ozon_submit", "rule_auto_enable"],
  }]);
  assert.equal(blue.suggestedAspects[0].value, "синий");
  assert.ok(white.repairSuggestions.some((suggestion) => (
    suggestion.code === "MISSING_ASPECT"
    && suggestion.suggestedAspects?.[0]?.value === "белый"
    && /不会自动写 Payload/.test(suggestion.nextStep)
  )));
});

test("buildVariantConfigurationSummary blocks partially missing variant aspects", () => {
  const summary = buildVariantConfigurationSummary({
    payload: { items: [
      {
        offer_id: "SKU-WHITE-S",
        images: ["https://example.com/white-s.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "белый" }] },
        ],
      },
      {
        offer_id: "SKU-BLUE-M",
        images: ["https://example.com/blue-m.jpg"],
        attributes: [
          { id: 9048, values: [{ value: "Органайзер" }] },
          { id: 10097, values: [{ value: "синий" }] },
        ],
      },
    ] },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
      { id: 10098, name: "Размер", is_aspect: true },
    ],
    sourceVariants: [
      { offerId: "SKU-WHITE-S", spec: "白色 S" },
      { offerId: "SKU-BLUE-M", spec: "蓝色 M" },
    ],
  });

  const white = summary.rows.find((row) => row.offerId === "SKU-WHITE-S");
  assert.equal(white.aspects.length, 1);
  assert.equal(white.rowStatus, "missing_aspect");
  assert.deepEqual(white.missingAspects, [{ id: 10098, name: "Размер" }]);
  assert.equal(white.suggestedAspects[0].attributeId, 10098);
  assert.equal(white.suggestedAspects[0].readOnly, true);
  assert.equal(summary.summary.missingAspectRowCount, 2);
  assert.equal(summary.summary.readinessStatus, "blocked");
});

test("buildVariantConfigurationSummary does not attach source SKU specs to mismatched offer ids", () => {
  const summary = buildVariantConfigurationSummary({
    payload: { items: [{
      offer_id: "SKU-WHITE",
      images: ["https://example.com/white.jpg"],
      attributes: [
        { id: 9048, values: [{ value: "Органайзер" }] },
      ],
    }] },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    sourceVariants: [
      { offerId: "SKU-OTHER", spec: "白色" },
    ],
  });

  assert.equal(summary.rows[0].sourceVariant, undefined);
  assert.deepEqual(summary.rows[0].suggestedAspects, []);
  assert.equal(summary.summary.suggestedAspectRowCount, 0);
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

test("multi-SKU 1688 repair invalidates the old draft hash and returns a revalidated preflight contract", async () => {
  reset();
  fs.writeFileSync(tmpCategoryCacheFile, JSON.stringify({
    attributeValues: {
      "17028673:95183:85:ZH_HANS": {
        values: [{ id: 971082, value: "Нет бренда" }],
      },
    },
  }, null, 2));
  assert.equal(multiSkuRepairFixture.synthetic, true);
  assert.equal(multiSkuRepairFixture.redacted, true);
  assert.equal(multiSkuRepairFixture.payload.items.length, 2);

  const run = await createWorkflowRun({
    title: "1688 多 SKU 属性修复 fixture",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(run.id, multiSkuRepairFixture.payload, {
    attrsMeta: multiSkuRepairFixture.attrsMeta,
    sourceVariants: multiSkuRepairFixture.sourceVariants,
  });
  const before = await validatePayloadDraft(run.id);
  assert.equal(before.ok, false);

  const result = await applyPayloadDraftAttributeRepair(run.id, {
    confirmLocalDraftRepair: true,
    repairType: "dictionary_value",
    offerId: "FIXTURE-PARENT-white-s",
    attributeId: 85,
    dictionaryValueId: 971082,
    value: "Нет бренда",
    note: "fixture: 1688 SKU 颜色/尺寸变体逐项修复",
  });
  const updated = await getWorkflowRun(run.id);
  const white = updated.payloadDraft.items.find((item) => item.offer_id === "FIXTURE-PARENT-white-s");
  const blue = updated.payloadDraft.items.find((item) => item.offer_id === "FIXTURE-PARENT-blue-m");
  assert.equal(result.previousDraftHash, before.draftHash);
  assert.match(result.draftHash, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(result.draftHash, before.draftHash);
  assert.equal(result.draftHashInvalidated, true);
  assert.equal(result.preflight.status, "revalidated");
  assert.equal(result.preflight.confirmationInvalidated, true);
  assert.equal(result.preflight.draftHash, result.draftHash);
  assert.equal(result.preflight.previousDraftHash, before.draftHash);
  assert.equal(result.validation.ok, true);
  assert.equal(updated.payloadDraft.items.length, 2);
  assert.equal(white.attributes.find((attribute) => attribute.id === 85).values[0].dictionary_value_id, 971082);
  assert.equal(blue.attributes.find((attribute) => attribute.id === 85).values[0].dictionary_value_id, 971082);
  assert.equal(updated.payloadDraftSourceVariants.length, 2);
  assert.equal(updated.locks.submitLocked, true);
  assert.match(result.preflight.nextAction, /重新人工确认/);
});

test("media candidate approval draft requires waiting human and current draft/source hashes", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "媒体审查",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  const saved = await savePayloadDraft(run.id, { items: [{ offer_id: "SKU-MEDIA", attributes: [] }] });
  const sourceHash = `sha256:${"a".repeat(64)}`;
  const candidateData = {
    sourceEvidence: { snapshotHash: sourceHash },
    mediaAssets: [{
      id: "media:detail-1",
      role: "detail",
      sourceUrl: "https://example.com/detail.jpg",
      evidenceRef: `snapshot:${"a".repeat(64)}`,
      checks: { humanApproved: false },
    }],
  };
  let persistedCandidate = null;
  const result = await approveWorkflowMediaCandidates(run.id, {
    confirmed: true,
    actorId: "seller-7",
    assetIds: ["media:detail-1"],
    expectedDraftHash: saved.payloadDraftHash,
    expectedSourceHash: sourceHash,
  }, {
    candidateData,
    now: () => new Date("2026-07-12T10:00:00.000Z"),
    persistCandidateData: async (value) => { persistedCandidate = value; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.submittedToOzon, false);
  assert.equal(result.generatedMedia, false);
  assert.equal(Object.hasOwn(result, "run"), false);
  assert.deepEqual(result.workflowSummary, {
    runId: run.id,
    status: "waiting_human",
    currentNode: "preflight_check",
    submitLocked: true,
    waitingHuman: true,
  });
  assert.equal(JSON.stringify(result).includes("payloadDraft"), false);
  assert.equal(JSON.stringify(result).includes("sourceUrl"), false);
  assert.equal(persistedCandidate.mediaAssets[0].checks.humanApproved, false);
  assert.equal(persistedCandidate.mediaAssets[0].checks.approvalDraft.confirmed, true);
  const updated = await getWorkflowRun(run.id);
  assert.equal(updated.mediaApprovalDraft.status, "approved_draft");
  assert.equal(updated.mediaApprovalDraft.expectedDraftHash, saved.payloadDraftHash);
  assert.equal(updated.events.at(-1).type, "media_approval_draft_recorded");
  assert.deepEqual(Object.keys(updated.events.at(-1).data).sort(), ["actorId", "assetCount", "draftHash", "sourceHash", "submittedToOzon"]);

  await savePayloadDraft(run.id, { items: [{ offer_id: "SKU-MEDIA-CHANGED", attributes: [] }] });
  const stale = await getWorkflowRun(run.id);
  assert.equal(stale.mediaApprovalDraft.status, "stale");
});

test("media candidate approval draft rejects unsafe state, actor, foreign assets, and stale hashes", async () => {
  reset();
  const run = await createWorkflowRun({ status: "running", locks: { waitingHuman: false } });
  const saved = await savePayloadDraft(run.id, { items: [{ offer_id: "SKU" }] });
  const sourceHash = `sha256:${"b".repeat(64)}`;
  const candidateData = {
    sourceEvidence: { snapshotHash: sourceHash },
    mediaAssets: [{ id: "media:owned", evidenceRef: `snapshot:${"b".repeat(64)}`, checks: {} }],
  };
  const base = {
    confirmed: true,
    actorId: "seller-1",
    assetIds: ["media:owned"],
    expectedDraftHash: saved.payloadDraftHash,
    expectedSourceHash: sourceHash,
  };
  assert.equal((await approveWorkflowMediaCandidates(run.id, base, { candidateData })).reasonCode, "MEDIA_APPROVAL_WAITING_HUMAN_REQUIRED");
  await upsertWorkflowNode(run.id, { key: "preflight_check", status: "waiting_human", runStatus: "waiting_human" });
  assert.equal((await approveWorkflowMediaCandidates(run.id, { ...base, actorId: "" }, { candidateData })).reasonCode, "MEDIA_APPROVAL_CONFIRMATION_REQUIRED");
  assert.equal((await approveWorkflowMediaCandidates(run.id, { ...base, assetIds: ["media:foreign"] }, { candidateData })).reasonCode, "MEDIA_APPROVAL_ASSET_NOT_FOUND");
  assert.equal((await approveWorkflowMediaCandidates(run.id, { ...base, expectedSourceHash: `sha256:${"c".repeat(64)}` }, { candidateData })).reasonCode, "MEDIA_APPROVAL_SOURCE_HASH_MISMATCH");
});

test("publishing a current media approval marks only bound assets approved and keeps submit locked", async () => {
  reset();
  const run = await createWorkflowRun({
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  const saved = await savePayloadDraft(run.id, { items: [{ offer_id: "SKU-MEDIA" }] });
  const sourceHash = `sha256:${"d".repeat(64)}`;
  const candidateData = {
    sourceEvidence: { snapshotHash: sourceHash },
    richContentJson: { content: [{ img: { src: "https://example.com/a.jpg" } }, { img: { src: "https://example.com/b.jpg" } }] },
    mediaIssues: ["detail_images_require_human_review_before_rich_content", "another_media_issue"],
    mediaAssets: [
      { id: "media:a", role: "detail", sourceUrl: "https://example.com/a.jpg", evidenceRef: `snapshot:${"d".repeat(64)}`, checks: { humanApproved: false } },
      { id: "media:b", role: "detail", sourceUrl: "https://example.com/b.jpg", evidenceRef: `snapshot:${"d".repeat(64)}`, checks: { humanApproved: false } },
      { id: "media:main", role: "main", sourceUrl: "https://example.com/main.jpg", evidenceRef: `snapshot:${"d".repeat(64)}`, checks: { humanApproved: false } },
    ],
  };
  let approvedCandidate = null;
  await approveWorkflowMediaCandidates(run.id, {
    confirmed: true,
    actorId: "seller-8",
    assetIds: ["media:a", "media:b"],
    expectedDraftHash: saved.payloadDraftHash,
    expectedSourceHash: sourceHash,
  }, {
    candidateData,
    now: () => new Date("2026-07-12T10:10:00.000Z"),
    persistCandidateData: async (value) => { approvedCandidate = value; },
  });
  let publishedCandidate = null;
  const result = await publishWorkflowMediaApproval(run.id, {
    publishConfirmed: true,
    actorId: "seller-8",
    assetIds: ["media:a", "media:b"],
    expectedDraftHash: saved.payloadDraftHash,
    expectedSourceHash: sourceHash,
  }, {
    candidateData: approvedCandidate,
    now: () => new Date("2026-07-12T10:11:00.000Z"),
    persistCandidateData: async (value) => { publishedCandidate = value; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.submittedToOzon, false);
  assert.equal(Object.hasOwn(result, "run"), false);
  assert.deepEqual(result.workflowSummary, {
    runId: run.id,
    status: "waiting_human",
    currentNode: "preflight_check",
    submitLocked: true,
    waitingHuman: true,
  });
  assert.equal(JSON.stringify(result).includes("payloadDraft"), false);
  assert.equal(publishedCandidate.mediaAssets[0].checks.humanApproved, true);
  assert.equal(publishedCandidate.mediaAssets[1].checks.humanApproved, true);
  assert.equal(publishedCandidate.mediaAssets[2].checks.humanApproved, false);
  assert.equal(publishedCandidate.mediaAssets[0].checks.approvalBinding.expectedDraftHash, saved.payloadDraftHash);
  assert.deepEqual(publishedCandidate.mediaIssues, ["another_media_issue"]);
  const updated = await getWorkflowRun(run.id);
  assert.equal(updated.status, "waiting_human");
  assert.equal(updated.locks.waitingHuman, true);
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.mediaApprovalDraft.status, "published_local");
  assert.equal(updated.events.at(-1).type, "media_approval_published_local");
  assert.deepEqual(Object.keys(updated.events.at(-1).data).sort(), ["actorChanged", "actorId", "assetCount", "draftHash", "richContentDetailAssetsApproved", "sourceHash", "submittedToOzon"]);
});

test("rich content preflight blocks stale workflow media approval even if candidate approval may remain", async () => {
  reset();
  const run = await createWorkflowRun({
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  const payload = {
    items: [{
      offer_id: "SKU-RICH-STALE",
      name: "Товар с rich content",
      description_category_id: 17028673,
      type_id: 95183,
      price: "100",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      rich_content_json: JSON.stringify([{ widgetName: "raTextBlock", text: "Описание товара" }]),
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKU-RICH-STALE" }] },
      ],
    }],
  };
  const saved = await savePayloadDraft(run.id, payload);
  const sourceHash = `sha256:${"f".repeat(64)}`;
  const candidateData = {
    sourceEvidence: { snapshotHash: sourceHash },
    mediaAssets: [{
      id: "media:detail",
      role: "detail",
      sourceUrl: "https://example.com/detail.jpg",
      evidenceRef: `snapshot:${"f".repeat(64)}`,
      checks: { humanApproved: false },
    }],
  };
  await approveWorkflowMediaCandidates(run.id, {
    confirmed: true,
    actorId: "seller-safe",
    assetIds: ["media:detail"],
    expectedDraftHash: saved.payloadDraftHash,
    expectedSourceHash: sourceHash,
  }, { candidateData, persistCandidateData: async () => true });

  await savePayloadDraft(run.id, { items: [{ ...payload.items[0], price: "101" }] });
  const staleRun = await getWorkflowRun(run.id);
  assert.equal(staleRun.mediaApprovalDraft.status, "stale");
  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.ok, false);
  assert.equal(validation.issues.some((issue) => issue.code === "RICH_CONTENT_MEDIA_APPROVAL_STALE"), true);
  await resumeWorkflowRun(run.id);
  const submitResult = await submitPayloadDraftToOzon(run.id, {
    confirmSubmit: true,
    storeId: "store-media-stale",
    expectedDraftHash: validation.draftHash,
  }, {
    getStore: () => ({ id: "store-media-stale" }),
    ozonRequest: async () => assert.fail("stale rich content approval must not call Ozon"),
  });
  assert.equal(submitResult.ok, false);
  assert.equal(submitResult.status, "blocked");
  assert.equal(submitResult.validation.issues.some((issue) => issue.code === "RICH_CONTENT_MEDIA_APPROVAL_STALE"), true);
});

test("publishing media approval rejects stale bindings and actor changes without reconfirmation", async () => {
  reset();
  const run = await createWorkflowRun({ status: "waiting_human", locks: { waitingHuman: true, submitLocked: true } });
  const saved = await savePayloadDraft(run.id, { items: [{ offer_id: "SKU" }] });
  const sourceHash = `sha256:${"e".repeat(64)}`;
  let candidateData = {
    sourceEvidence: { snapshotHash: sourceHash },
    mediaAssets: [{ id: "media:one", role: "detail", sourceUrl: "https://example.com/one.jpg", evidenceRef: `snapshot:${"e".repeat(64)}`, checks: {} }],
    mediaIssues: ["detail_images_require_human_review_before_rich_content"],
  };
  await approveWorkflowMediaCandidates(run.id, {
    confirmed: true, actorId: "seller-original", assetIds: ["media:one"],
    expectedDraftHash: saved.payloadDraftHash, expectedSourceHash: sourceHash,
  }, { candidateData, persistCandidateData: async (value) => { candidateData = value; } });
  const base = {
    publishConfirmed: true, actorId: "seller-new", assetIds: ["media:one"],
    expectedDraftHash: saved.payloadDraftHash, expectedSourceHash: sourceHash,
  };
  assert.equal((await publishWorkflowMediaApproval(run.id, base, { candidateData })).reasonCode, "MEDIA_APPROVAL_ACTOR_MISMATCH");
  assert.equal((await publishWorkflowMediaApproval(run.id, { ...base, assetIds: ["media:foreign"], reconfirmActorChange: true }, { candidateData })).reasonCode, "MEDIA_APPROVAL_ASSET_SET_MISMATCH");
  await savePayloadDraft(run.id, { items: [{ offer_id: "SKU-CHANGED" }] });
  assert.equal((await publishWorkflowMediaApproval(run.id, { ...base, reconfirmActorChange: true }, { candidateData })).reasonCode, "MEDIA_APPROVAL_DRAFT_STALE");
});

test("publishing media approval rolls candidate approval back when workflow changes concurrently", async () => {
  reset();
  const run = await createWorkflowRun({ status: "waiting_human", locks: { waitingHuman: true, submitLocked: true } });
  const saved = await savePayloadDraft(run.id, { items: [{ offer_id: "SKU-RACE" }] });
  const sourceHash = `sha256:${"f".repeat(64)}`;
  let candidateData = {
    sourceEvidence: { snapshotHash: sourceHash },
    richContentJson: { content: [{ img: { src: "https://example.com/race.jpg" } }] },
    mediaIssues: ["detail_images_require_human_review_before_rich_content"],
    mediaAssets: [{ id: "media:race", role: "detail", sourceUrl: "https://example.com/race.jpg", evidenceRef: `snapshot:${"f".repeat(64)}`, checks: {} }],
  };
  await approveWorkflowMediaCandidates(run.id, {
    confirmed: true, actorId: "seller-race", assetIds: ["media:race"],
    expectedDraftHash: saved.payloadDraftHash, expectedSourceHash: sourceHash,
  }, { candidateData, persistCandidateData: async (value) => { candidateData = value; } });
  let rolledBack = null;
  const result = await publishWorkflowMediaApproval(run.id, {
    publishConfirmed: true, actorId: "seller-race", assetIds: ["media:race"],
    expectedDraftHash: saved.payloadDraftHash, expectedSourceHash: sourceHash,
  }, {
    candidateData,
    persistCandidateData: async (value) => {
      candidateData = value;
      await savePayloadDraft(run.id, { items: [{ offer_id: "SKU-RACE-CHANGED" }] });
      return true;
    },
    rollbackCandidateData: async (binding) => {
      candidateData = {
        ...candidateData,
        mediaApprovalPublished: { ...candidateData.mediaApprovalPublished, status: "stale", staleReason: binding.reason },
        mediaAssets: candidateData.mediaAssets.map((asset) => ({
          ...asset,
          checks: asset.id === "media:race"
            ? { ...asset.checks, humanApproved: false, approvalBinding: { ...asset.checks.approvalBinding, status: "stale" } }
            : asset.checks,
        })),
      };
      rolledBack = candidateData;
      return true;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "MEDIA_APPROVAL_DRAFT_STALE");
  assert.equal(rolledBack.mediaApprovalPublished.status, "stale");
  assert.equal(rolledBack.mediaAssets[0].checks.humanApproved, false);
  assert.equal(rolledBack.mediaAssets[0].checks.approvalBinding.status, "stale");
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

test("applyPayloadDraftAttributeRepair writes source-suggested variant text only when it matches current preflight", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "来源规格变体修复",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(run.id, {
    items: [
      {
        offer_id: "SKU-WHITE-2",
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
        offer_id: "SKU-BLUE-3",
        name: "Cat feeder",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["4", "5", "6"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Cat feeder" }] },
        ],
      },
    ],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 11001, name: "Количество в комплекте", is_aspect: true },
    ],
    sourceVariants: [
      { offerId: "SKU-WHITE-2", spec: "2 шт" },
      { offerId: "SKU-BLUE-3", spec: "3 шт" },
    ],
  });
  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.variantConfiguration.rows[0].suggestedAspects[0].value, "2 шт");

  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(run.id, {
      confirmLocalDraftRepair: true,
      repairType: "variant_text_value",
      offerId: "SKU-WHITE-2",
      attributeId: 11001,
      value: "999 шт",
      sourceSuggestedAspect: true,
    }),
    /不匹配当前预检候选/,
  );

  const result = await applyPayloadDraftAttributeRepair(run.id, {
    confirmLocalDraftRepair: true,
    repairType: "variant_text_value",
    offerId: "SKU-WHITE-2",
    attributeId: 11001,
    value: "2 шт",
    sourceSuggestedAspect: true,
    note: "人工确认 1688 SKU 规格候选",
  });
  const updated = await getWorkflowRun(run.id);
  const repaired = updated.payloadDraft.items[0].attributes.find((attribute) => Number(attribute.id) === 11001);

  assert.equal(result.submittedToOzon, false);
  assert.equal(repaired.values[0].value, "2 шт");
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.payloadDraftValidation.ok, false);
  assert.equal(updated.events.at(-1).data.sourceSuggestedAspect, true);
  assert.equal(updated.events.at(-1).data.value, "2 шт");
});

test("applyPayloadDraftAttributeRepair writes source-matched dictionary variant candidates only", async () => {
  reset();
  fs.writeFileSync(tmpCategoryCacheFile, JSON.stringify({
    attributeValues: {
      "17028673:95183:10097:ZH_HANS": {
        values: [
          { id: 901, value: "красный" },
          { id: 902, value: "желтый" },
          { id: 903, value: "зеленый" },
          { id: 904, value: "розовый" },
          { id: 905, value: "фиолетовый" },
          { id: 111, value: "белый" },
          { id: 222, value: "синий" },
          { id: 333, value: "черный" },
        ],
      },
    },
  }, null, 2));
  const run = await createWorkflowRun({
    title: "来源规格字典变体修复",
    status: "waiting_human",
    currentNode: "preflight_check",
    locks: { waitingHuman: true, submitLocked: true },
  });
  await savePayloadDraft(run.id, {
    items: [
      {
        offer_id: "SKU-WHITE-DICT",
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
        offer_id: "SKU-BLUE-DICT",
        name: "Cat feeder",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["4", "5", "6"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Cat feeder" }] },
        ],
      },
    ],
  }, {
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true, dictionary_id: 10097 },
    ],
    sourceVariants: [
      { offerId: "SKU-WHITE-DICT", spec: "白色" },
      { offerId: "SKU-BLUE-DICT", spec: "蓝色" },
    ],
  });
  const validation = await validatePayloadDraft(run.id);
  const colorRow = validation.attributeMatrix.rows.find((row) => row.attributeId === 10097);
  const whiteCell = colorRow.cells.find((cell) => cell.offerId === "SKU-WHITE-DICT");
  const blueCell = colorRow.cells.find((cell) => cell.offerId === "SKU-BLUE-DICT");

  assert.deepEqual(
    whiteCell.repairGuidance.dictionaryCandidates.map((candidate) => candidate.dictionary_value_id),
    [111],
  );
  assert.deepEqual(
    blueCell.repairGuidance.dictionaryCandidates.map((candidate) => candidate.dictionary_value_id),
    [222],
  );
  assert.equal(whiteCell.repairGuidance.dictionaryCandidates[0].source, "1688_sku_spec_dictionary_match");
  assert.equal(whiteCell.repairGuidance.dictionaryCandidates[0].sourceVariantSpec, "白色");

  await assert.rejects(
    () => applyPayloadDraftAttributeRepair(run.id, {
      confirmLocalDraftRepair: true,
      repairType: "dictionary_value",
      offerId: "SKU-WHITE-DICT",
      attributeId: 10097,
      dictionaryValueId: 222,
      sourceSuggestedAspect: true,
    }),
    /字典值不在当前属性矩阵候选值内/,
  );

  const result = await applyPayloadDraftAttributeRepair(run.id, {
    confirmLocalDraftRepair: true,
    repairType: "dictionary_value",
    offerId: "SKU-WHITE-DICT",
    attributeId: 10097,
    dictionaryValueId: 111,
    sourceSuggestedAspect: true,
    note: "人工确认 1688 SKU 规格匹配 Ozon 字典值",
  });
  const updated = await getWorkflowRun(run.id);
  const repaired = updated.payloadDraft.items[0].attributes.find((attribute) => Number(attribute.id) === 10097);

  assert.equal(result.submittedToOzon, false);
  assert.equal(repaired.values[0].dictionary_value_id, 111);
  assert.equal(repaired.values[0].value, "белый");
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(updated.events.at(-1).data.sourceSuggestedAspect, true);
  assert.equal(updated.events.at(-1).data.sourceVariantSpec, "白色");
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

test("buildPreflightGateNode blocks partially missing variant aspect attributes", () => {
  const node = buildPreflightGateNode({
    payload: { items: [
      {
        offer_id: "SKU-WHITE-S",
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
        offer_id: "SKU-BLUE-M",
        name: "Cat feeder",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["4", "5", "6"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "Cat feeder" }] },
          { id: 10097, values: [{ value: "синий" }] },
        ],
      },
    ] },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
      { id: 10098, name: "Размер", is_aspect: true },
    ],
    sourceVariants: [
      { offerId: "SKU-WHITE-S", spec: "白色 S" },
      { offerId: "SKU-BLUE-M", spec: "蓝色 M" },
    ],
    variantCount: 2,
    contentSummary: { candidateImageCount: 3, sizeWeightReady: true, skuVariantCount: 2, contentIssues: [] },
    category: { path: "宠物用品", description_category_id: 17028673, type_id: 95183 },
  });

  assert.equal(node.output.ok, false);
  assert.equal(node.status, "failed");
  assert.equal(node.runStatus, "waiting_human");
  assert.equal(node.output.variantConfiguration.summary.missingAspectRowCount, 2);
  assert.equal(node.output.issues.some((issue) => issue.code === "MISSING_VARIANT_ASPECT"), true);
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
  assert.equal(validation.sellerResult.status, "blocked");
  assert.ok(validation.sellerResult.repairs.some((repair) => repair.code === "DUPLICATE_VARIANT_ASPECTS"));
  assert.match(validation.sellerResult.repairs[0].fieldPath, /items\[/);
  assert.match(validation.sellerResult.repairs[0].action, /重新预检/);
  assert.match(validation.sellerResult.repairs[0].sideEffect, /不会写入 Ozon/);
  assert.match(validation.sellerResult.repairs[0].result, /未提交 Ozon/);

  await savePayloadDraft(run.id, duplicatePayload);
  const validationAfterPlainSave = await validatePayloadDraft(run.id);
  assert.ok(validationAfterPlainSave.issues.some((issue) => issue.code === "DUPLICATE_VARIANT_ASPECTS"));
});

test("payload draft validation preserves source SKU specs as read-only aspect suggestions", async () => {
  reset();
  const run = await createWorkflowRun({ title: "来源 SKU 规格候选" });
  const base = {
    name: "Органайзер",
    description_category_id: 17028743,
    type_id: 93735,
    price: "10",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
  };
  const payload = { items: [
    { ...base, offer_id: "SKU-WHITE", attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }, { id: 9048, values: [{ value: "Органайзер" }] }] },
    { ...base, offer_id: "SKU-BLUE", attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }, { id: 9048, values: [{ value: "Органайзер" }] }] },
  ] };
  const attrsMeta = [
    { id: 85, name: "Бренд", is_required: true },
    { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    { id: 10097, name: "Название цвета", is_aspect: true },
  ];

  await savePayloadDraft(run.id, payload, {
    attrsMeta,
    sourceVariants: [
      { offerId: "SKU-WHITE", spec: "白色", source: "1688_sku_variant" },
      { offerId: "SKU-BLUE", spec: "蓝色", source: "1688_sku_variant" },
    ],
  });
  const validation = await validatePayloadDraft(run.id);
  const updated = await getWorkflowRun(run.id);

  assert.equal(updated.payloadDraftSourceVariants.length, 2);
  assert.equal(updated.payloadDraft.items[0].attributes.some((attribute) => Number(attribute.id || 0) === 10097), false);
  assert.equal(updated.locks.submitLocked, true);
  assert.equal(validation.variantConfiguration.summary.suggestedAspectRowCount, 2);
  assert.equal(validation.variantConfiguration.rows[0].suggestedAspects[0].value, "белый");
  assert.equal(validation.variantConfiguration.rows[0].suggestedAspects[0].readOnly, true);
  assert.deepEqual(validation.variantConfiguration.rows[0].suggestedAspects[0].forbiddenEffects, [
    "payload_write",
    "ozon_submit",
    "rule_auto_enable",
  ]);
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

test("1688 workflow draft validation and submit reuse the persisted strong preflight policy", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "1688 强预检不能降级",
    entity: { storeId: "store-1688", source: "1688" },
  });
  const payload = {
    items: [{
      offer_id: "SKU-1688-policy",
      name: "Товар для дома",
      description_category_id: 17028673,
      type_id: 95183,
      price: "100",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKU-1688-policy" }] },
      ],
    }],
  };
  await savePayloadDraft(run.id, payload);
  const sourceEvidence = { snapshotHash: "sha256:" + "a".repeat(64), verificationState: "unknown" };
  const gate = buildPreflightGateNode({
    payload,
    sourceEvidence,
    sourceEvidenceRequired: true,
    sourceIdentityRequired: true,
    sourceVariantBindingRequired: true,
    categoryEvidenceRequired: false,
    contentSummary: { contentEvidence: { status: "reviewed", blockerCodes: [] }, sizeWeightReady: true },
    variantCount: 1,
  });
  await upsertWorkflowNode(run.id, gate);

  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.ok, false);
  assert.equal(validation.issues.some((issue) => issue.code === "SOURCE_EVIDENCE_NOT_VERIFIED"), true);
  assert.equal(validation.issues.some((issue) => issue.code === "SOURCE_IDENTITY_MISSING"), true);

  const calls = [];
  const result = await submitPayloadDraftToOzon(run.id, {
    confirmSubmit: true,
    storeId: "store-1688",
    expectedDraftHash: (await getWorkflowRun(run.id)).payloadDraftHash,
  }, {
    getStore: () => ({ id: "store-1688" }),
    ozonRequest: async (...args) => { calls.push(args); return { result: { task_id: 1 } }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "waiting_human");
  assert.equal(calls.length, 0);
});

test("1688 preflight rechecks canonical URL Offer identity after draft edits", () => {
  const hash = `sha256:${"b".repeat(64)}`;
  const gate = buildPreflightGateNode({
    payload: { items: [{ offer_id: "SKU-identity", name: "Товар", description_category_id: 1, type_id: 2, price: "100", images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"], attributes: [] }] },
    sourceEvidence: {
      snapshotHash: hash,
      verificationState: "ok",
      canonicalUrl: "https://detail.1688.com/offer/123456.html",
      offerId: "654321",
    },
    sourceEvidenceRequired: true,
    sourceIdentityRequired: true,
    contentSummary: { contentEvidence: { status: "reviewed", blockerCodes: [] }, sizeWeightReady: true },
    variantCount: 1,
  });
  assert.equal(gate.output.ok, false);
  assert.ok(gate.output.issues.some((issue) => issue.code === "SOURCE_OFFER_URL_MISMATCH"));
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
  const saved = await savePayloadDraft(run.id, {
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

  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.draftHash, saved.payloadDraftHash);

  const result = await submitPayloadDraftToOzon(run.id, {
    confirmSubmit: true,
    storeId: "3815760-4",
    expectedDraftHash: validation.draftHash,
  }, {
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
  assert.equal(updated.events.at(-1).data.draftHash, validation.draftHash);
  assert.equal(updated.events.at(-1).data.storeId, "3815760-4");
  assert.deepEqual(updated.events.at(-1).data.skuSummary, {
    count: 1,
    offers: ["SKUlq00999-red"],
  });
  assert.deepEqual(updated.events.at(-1).data.priceSummary, {
    currencyCodes: [],
    min: 100,
    max: 100,
    prices: [{ offerId: "SKUlq00999-red", price: 100, oldPrice: null, minPrice: null, currencyCode: "" }],
  });
});

test("concurrent confirmed submissions reserve one payload hash and call Ozon only once", async () => {
  reset();
  const run = await createWorkflowRun({ title: "并发提交保护", entity: { storeId: "store-concurrent" } });
  const saved = await savePayloadDraft(run.id, {
    items: [{
      offer_id: "SKU-CONCURRENT",
      name: "Товар concurrent",
      description_category_id: 17028673,
      type_id: 95183,
      price: "100",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      attributes: [
        { id: 85, values: [{ value: "Нет бренда" }] },
        { id: 9048, values: [{ value: "SKU-CONCURRENT" }] },
      ],
    }],
  });
  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.ok, true);
  let ozonCalls = 0;
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const deps = {
    getStore: () => ({ id: "store-concurrent" }),
    ozonRequest: async () => {
      ozonCalls += 1;
      await firstPending;
      return { result: { task_id: 880001 } };
    },
  };
  const input = {
    confirmSubmit: true,
    storeId: "store-concurrent",
    expectedDraftHash: saved.payloadDraftHash,
  };
  const first = submitPayloadDraftToOzon(run.id, input, deps);
  const second = submitPayloadDraftToOzon(run.id, input, deps);
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseFirst();
  const results = await Promise.all([first, second]);

  assert.equal(ozonCalls, 1);
  assert.equal(results.filter((result) => result.status === "submitted").length, 1);
  assert.equal(results.filter((result) => result.status === "in_progress" || result.status === "replay").length, 1);
  const persisted = await getWorkflowRun(run.id);
  assert.equal(persisted.submissionReservation.state, "completed");
  assert.equal(persisted.submissionReservation.draftHash, validation.draftHash);
  assert.equal(persisted.submissionReservation.taskId, "880001");
});

test("unknown Ozon submission outcome is reserved for manual review and never auto-retried", async () => {
  reset();
  const run = await createWorkflowRun({ title: "未知提交结果", entity: { storeId: "store-unknown" } });
  const saved = await savePayloadDraft(run.id, { items: [{
    offer_id: "SKU-UNKNOWN",
    name: "Товар unknown",
    description_category_id: 17028673,
    type_id: 95183,
    price: "100",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU-UNKNOWN" }] },
    ],
  }] });
  await validatePayloadDraft(run.id);
  let calls = 0;
  const deps = {
    getStore: () => ({ id: "store-unknown" }),
    ozonRequest: async () => { calls += 1; throw new Error("socket closed after send"); },
  };
  const input = { confirmSubmit: true, storeId: "store-unknown", expectedDraftHash: saved.payloadDraftHash };
  const first = await submitPayloadDraftToOzon(run.id, input, deps);
  const second = await submitPayloadDraftToOzon(run.id, input, deps);

  assert.equal(calls, 1);
  assert.equal(first.status, "needs_review");
  assert.equal(second.status, "needs_review");
  assert.equal(second.reasonCode, "OZON_SUBMISSION_OUTCOME_UNKNOWN");
  assert.doesNotMatch(JSON.stringify(second), /socket closed/);
  const persisted = await getWorkflowRun(run.id);
  assert.equal(persisted.submissionReservation.state, "needs_review");
  assert.equal(persisted.status, "waiting_human");
  assert.equal(persisted.locks.submitLocked, true);
});

test("successful Ozon response without task id stays needs_review and cannot retry", async () => {
  reset();
  const run = await createWorkflowRun({ title: "缺少任务号", entity: { storeId: "store-no-task" } });
  const saved = await savePayloadDraft(run.id, { items: [{
    offer_id: "SKU-NO-TASK",
    name: "Товар без task",
    description_category_id: 17028673,
    type_id: 95183,
    price: "100",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU-NO-TASK" }] },
    ],
  }] });
  await validatePayloadDraft(run.id);
  let calls = 0;
  const deps = {
    getStore: () => ({ id: "store-no-task" }),
    ozonRequest: async () => { calls += 1; return { result: { status: "accepted" } }; },
  };
  const input = { confirmSubmit: true, storeId: "store-no-task", expectedDraftHash: saved.payloadDraftHash };
  const first = await submitPayloadDraftToOzon(run.id, input, deps);
  const second = await submitPayloadDraftToOzon(run.id, input, deps);

  assert.equal(calls, 1);
  assert.equal(first.status, "needs_review");
  assert.equal(first.reasonCode, "OZON_SUBMISSION_TASK_ID_MISSING");
  assert.equal(second.status, "needs_review");
  assert.equal(second.reasonCode, "OZON_SUBMISSION_OUTCOME_UNKNOWN");
  const persisted = await getWorkflowRun(run.id);
  assert.equal(persisted.submissionReservation.state, "needs_review");
  assert.equal(persisted.submissionReservation.taskId, "");
  assert.equal(persisted.nodes.find((node) => node.key === "ozon_submit")?.status, "failed");
});

test("payload draft confirmation hash is stable and stale confirmation cannot submit", async () => {
  reset();
  const run = await createWorkflowRun({ title: "草稿确认绑定", entity: { storeId: "store-1" } });
  const payload = {
    offer_id: "SKU-hash",
    name: "Товар для дома",
    description_category_id: 17028673,
    type_id: 95183,
    price: "100",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU-hash" }] },
    ],
  };
  const firstSave = await savePayloadDraft(run.id, payload);
  const secondSave = await savePayloadDraft(run.id, JSON.parse(JSON.stringify(payload)));
  assert.match(firstSave.payloadDraftHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(secondSave.payloadDraftHash, firstSave.payloadDraftHash);
  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.draftHash, firstSave.payloadDraftHash);

  const missingHash = await submitPayloadDraftToOzon(run.id, { confirmSubmit: true, storeId: "store-1" }, {
    getStore: () => ({ id: "store-1" }),
    ozonRequest: async () => assert.fail("missing hash must not call Ozon"),
  });
  assert.equal(missingHash.status, "confirmation_required");
  assert.equal(missingHash.reasonCode, "EXPECTED_DRAFT_HASH_REQUIRED");

  await savePayloadDraft(run.id, { ...payload, price: "120" });
  const stale = await submitPayloadDraftToOzon(run.id, {
    confirmSubmit: true,
    storeId: "store-1",
    expectedDraftHash: validation.draftHash,
  }, {
    getStore: () => ({ id: "store-1" }),
    ozonRequest: async () => assert.fail("stale hash must not call Ozon"),
  });
  assert.equal(stale.status, "confirmation_required");
  assert.equal(stale.reasonCode, "DRAFT_HASH_MISMATCH");
  assert.notEqual(stale.currentDraftHash, validation.draftHash);
});

test("payload submit rejects store mismatch before Ozon and binds an unbound workflow store", async () => {
  reset();
  const payload = {
    offer_id: "SKU-store-binding",
    name: "Товар для проверки магазина",
    description_category_id: 17028673,
    type_id: 95183,
    price: "100",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU-store-binding" }] },
    ],
  };
  const bound = await createWorkflowRun({ title: "店铺绑定", entity: { storeId: "store-bound" } });
  const boundSave = await savePayloadDraft(bound.id, payload);
  const mismatch = await submitPayloadDraftToOzon(bound.id, {
    confirmSubmit: true,
    storeId: "store-other",
    expectedDraftHash: boundSave.payloadDraftHash,
  }, {
    getStore: () => assert.fail("store mismatch must fail before store lookup"),
    ozonRequest: async () => assert.fail("store mismatch must not call Ozon"),
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reasonCode, "WORKFLOW_STORE_MISMATCH");

  const missingStore = await createWorkflowRun({ title: "缺少店铺绑定" });
  await savePayloadDraft(missingStore.id, payload);
  const required = await submitPayloadDraftToOzon(missingStore.id, { confirmSubmit: true }, {});
  assert.equal(required.ok, false);
  assert.equal(required.reasonCode, "WORKFLOW_STORE_REQUIRED");

  const unbound = await createWorkflowRun({ title: "待绑定店铺" });
  const unboundSave = await savePayloadDraft(unbound.id, payload);
  const calls = [];
  const submitted = await submitPayloadDraftToOzon(unbound.id, {
    confirmSubmit: true,
    storeId: "store-input",
    expectedDraftHash: unboundSave.payloadDraftHash,
  }, {
    getStore: (storeId) => ({ id: storeId }),
    ozonRequest: async (store) => {
      calls.push(store.id);
      return { result: { task_id: 981 } };
    },
  });
  assert.equal(submitted.ok, true);
  assert.deepEqual(calls, ["store-input"]);
  assert.equal((await getWorkflowRun(unbound.id)).entity.storeId, "store-input");
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
    listingResult: {
      sku: "SKUlq00998",
      taskId: 123,
      stockReadiness: {
        status: "blocked",
        reasonCode: "STOCK_CURRENT_EVIDENCE_REQUIRED",
        offerIds: ["SKU-EVIDENCE"],
      },
    },
  });
  const second = await findOrCreateWorkflowForAutoListingJob({ id: "al_bind" });

  assert.equal(first.id, second.id);
  assert.equal(second.entity.autoListingJobId, "al_bind");
  assert.equal(second.entity.parentSku, "SKUlq00998");
  assert.equal(second.entity.stockReadiness.status, "blocked");
  assert.deepEqual(second.entity.stockReadiness.offerIds, ["SKU-EVIDENCE"]);
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
      commissionRate: 0.18,
      commissionSource: { source: "learned_product", confidence: "medium" },
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

test("workflow pricing blocks collected costs without MOQ and tier evidence", () => {
  const node = workflowNodeFromAutoListingStage("matching", {
    bestMatch: { margin: 20, confidence: 80, purchasePriceCny: 12 },
    pricingDiagnosis: {
      priceCny: 100,
      minPriceCny: 80,
      logisticsFee: 10,
      profit: 20,
      level: { id: "small" },
      package: { weightG: 100, lengthMm: 100, widthMm: 100, heightMm: 100 },
      procurementEvidence: { status: "blocked", reasonCode: "PRICING_PROCUREMENT_EVIDENCE_MISSING" },
    },
    nodeStatus: "success",
  });

  assert.equal(node.branch, "blocked");
  assert.equal(node.diagnosis.reasonCode, "PRICING_PROCUREMENT_EVIDENCE_MISSING");
});

test("submit preflight blocks complete procurement fields that are still manual", () => {
  const node = buildPreflightGateNode({
    payload: {
      offer_id: "SKU-MANUAL-COST",
      name: "Органайзер",
      description: "Практичный органайзер для дома.",
      price: "100",
      old_price: "200",
      min_price: "90",
      currency_code: "CNY",
      weight: 200,
      depth: 120,
      width: 100,
      height: 80,
      description_category_id: 1,
      type_id: 2,
      images: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
    },
    category: { description_category_id: 1, type_id: 2, path: "Хранение" },
    contentSummary: { listingContentReady: true, titleRu: "Органайзер", descriptionLength: 30, candidateImageCount: 3, sizeWeightReady: true },
    pricing: {
      priceCny: 100,
      minPriceCny: 90,
      logisticsFee: 10,
      commissionRate: 0.15,
      commissionSource: { source: "manual_default" },
      profit: 20,
      level: { id: "small" },
      package: { weightG: 200, lengthMm: 120, widthMm: 100, heightMm: 80 },
      procurementEvidence: { status: "needs_review" },
    },
  });
  assert.equal(node.output.ok, false);
  assert.ok(node.output.issues.some((issue) => issue.code === "PRICING_PROCUREMENT_EVIDENCE_REVIEW_REQUIRED"));
});

test("workflow pricing blocks a default commission rate without current evidence", () => {
  const node = workflowNodeFromAutoListingStage("matching", {
    bestMatch: { margin: 20, confidence: 80, purchasePriceCny: 12 },
    pricingDiagnosis: {
      priceCny: 100,
      minPriceCny: 80,
      logisticsFee: 10,
      commissionRate: 0.15,
      commissionSource: { source: "manual_default", confidence: "low" },
      profit: 20,
      level: { id: "small" },
      package: { weightG: 100, lengthMm: 100, widthMm: 100, heightMm: 100 },
    },
    nodeStatus: "success",
  });

  assert.equal(node.branch, "blocked");
  assert.equal(node.diagnosis.reasonCode, "PRICING_COMMISSION_SOURCE_MISSING");
  assert.ok(node.recommendedActions.some((action) => /佣金/.test(action)));
});

test("workflow pricing blocks an untraceable category commission", () => {
  const node = workflowNodeFromAutoListingStage("matching", {
    bestMatch: { margin: 20, confidence: 80, purchasePriceCny: 12 },
    pricingDiagnosis: {
      priceCny: 100,
      minPriceCny: 80,
      logisticsFee: 10,
      commissionRate: 0.18,
      commissionSource: { source: "ozon_category", confidence: "high", categoryKey: "17028673:95183" },
      profit: 20,
      level: { id: "small" },
      package: { weightG: 100, lengthMm: 100, widthMm: 100, heightMm: 100 },
    },
    nodeStatus: "success",
  });

  assert.equal(node.branch, "blocked");
  assert.equal(node.diagnosis.reasonCode, "PRICING_COMMISSION_EVIDENCE_UNTRACEABLE");
  assert.ok(node.recommendedActions.some((action) => /证据|更新时间/.test(action)));
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
      commissionRate: 0.18,
      commissionSource: { source: "learned_product", confidence: "medium" },
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

test("review failure exposes per-offer repair draft and explicit re-preflight/readback chain", () => {
  const draft = buildReviewRepairDraft({
    taskId: 701,
    skuOffers: ["SKU-RED", "SKU-BLUE"],
    importedItems: [{ offer_id: "SKU-RED", product_id: 901 }],
    importErrors: [{
      offer_id: "SKU-RED",
      attribute_id: 9048,
      code: "ATTRIBUTE_REQUIRED",
      message: "Название модели обязательное поле",
    }],
    submitPayload: { items: [{ offer_id: "SKU-RED", attributes: [] }] },
  });

  assert.equal(draft.ok, true);
  assert.equal(draft.status, "pending_manual_repair");
  assert.equal(draft.taskId, 701);
  assert.deepEqual(draft.offerIds, ["SKU-RED", "SKU-BLUE"]);
  assert.equal(draft.repairs[0].offerId, "SKU-RED");
  assert.equal(draft.repairs[0].productId, 901);
  assert.equal(draft.repairs[0].fieldPath, "items[offer_id=SKU-RED].attributes[id=9048]");
  assert.equal(draft.repairs[0].valueProvided, false);
  assert.match(draft.workflow.preflight, /重新预检/);
  assert.match(draft.workflow.readback, /task_id/);
  assert.match(draft.sideEffect, /不会修改 Ozon/);
  assert.match(draft.result, /尚未重新预检/);
});

test("workflow review node carries repair contract for moderation failure without import error", () => {
  const node = workflowReviewReconcileNode({
    taskId: 702,
    importedItems: [{ offer_id: "SKU-FAILED", product_id: 902 }],
    readinessState: "moderation_failed",
  });
  assert.equal(node.output.reviewRepairDraft.status, "pending_manual_repair");
  assert.equal(node.output.reviewRepairDraft.repairs[0].offerId, "");
  assert.equal(node.output.reviewRepairDraft.repairs[0].productId, null);
  assert.equal(node.output.reviewRepairDraft.repairs[0].code, "MODERATION_FAILED");
  assert.ok(node.recommendedActions.some((action) => /逐 Offer/.test(action)));
  assert.match(node.recommendedActions[2], /回查/);
});

test("workflowReviewReconcileNode reflects server-observed moderation state", () => {
  const pending = workflowReviewReconcileNode({
    taskId: 12347,
    importedItems: [{ offer_id: "SKU-PENDING", product_id: 901 }],
    readinessState: "pending_moderation",
    readinessEvidence: { readStatus: "completed", observedOfferCount: 1 },
  });
  assert.equal(pending.status, "running");
  assert.equal(pending.branch, "waiting_review");
  assert.equal(pending.output.readinessState, "pending_moderation");
  assert.match(pending.reason, /尚未证明可售/);
  assert.ok(pending.recommendedActions.some((action) => /回查/.test(action)));
  const pendingTask = workflowCurrentProductTask({ title: "Pending item", nodes: [pending] });
  assert.equal(pendingTask.stage, "review_waiting");
  assert.equal(pendingTask.status, "waiting");
  assert.match(pendingTask.nextAction, /回查/);

  const failed = workflowReviewReconcileNode({
    taskId: 12347,
    importedItems: [{ offer_id: "SKU-FAILED", product_id: 902 }],
    readinessState: "moderation_failed",
    readinessEvidence: { readStatus: "completed", observedOfferCount: 1 },
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.runStatus, "waiting_human");
  assert.equal(failed.diagnosis.reasonCode, "MODERATION_FAILED");
  assert.equal(failed.output.readinessState, "moderation_failed");
});

test("workflowReviewReconcileNode does not advance an unverified ready state to inventory", () => {
  const node = workflowReviewReconcileNode({
    taskId: 12348,
    importedItems: [{ offer_id: "SKU-READY", product_id: 903 }],
    readinessState: "ready_for_sale",
    readinessEvidence: { readStatus: "completed", coverageComplete: false, observedOfferCount: 1 },
  });
  assert.equal(node.status, "running");
  assert.equal(node.branch, "waiting_review");
  assert.equal(node.output.readinessClaimVerified, false);
  assert.match(node.reason, /完整、新鲜.*回查证据/);
  assert.ok(node.recommendedActions.some((action) => /不要写库存|完整商品状态回查/.test(action)));
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

test("workflowCurrentProductTask exposes the capture draft skeleton blocker", () => {
  const task = workflowCurrentProductTask({
    title: "1688 captured product",
    nodes: [{
      key: "capture_handoff",
      name: "真实货源进入草稿",
      status: "success",
      output: {
        draftSkeleton: {
          status: "needs_review",
          offerId: "992997159052",
          variantCount: 9,
          blockers: [{
            reasonCode: "DRAFT_SUPPLIER_EVIDENCE_REQUIRED",
            title: "供应商身份待补齐",
            nextAction: "补齐当前 1688 供应商名称或身份凭据",
          }],
          nextAction: "补齐当前 1688 供应商名称或身份凭据",
        },
      },
    }],
  });

  assert.equal(task.stage, "draft_evidence_repair");
  assert.equal(task.status, "blocked");
  assert.equal(task.offerId, "992997159052");
  assert.equal(task.blockedAt, "真实货源进入草稿");
  assert.equal(task.reason, "供应商身份待补齐（另有 0 项）");
  assert.equal(task.nextAction, "补齐当前 1688 供应商名称或身份凭据");
  assert.equal(task.view, "listing");
  assert.equal(task.nodeKey, "capture_handoff");
});

test("workflowCurrentProductTask exposes a waiting preflight repair gate", () => {
  const task = workflowCurrentProductTask({
    title: "Preflight seller gate",
    status: "waiting_human",
    locks: { waitingHuman: true, submitLocked: true },
    nodes: [{
      key: "preflight_check",
      name: "提交前总闸",
      status: "failed",
      runStatus: "waiting_human",
      reason: "提交前校验发现 payload 问题，需修复后再提交。",
      recommendedActions: ["查看 Payload 问题"],
      output: {
        issues: [{ code: "MISSING_PRICE", message: "缺少售价" }],
        sellerResult: {
          reason: "缺少售价，不能提交。",
          action: "补齐售价后重新预检",
        },
      },
    }],
  });

  assert.equal(task.stage, "preflight_review");
  assert.equal(task.status, "waiting_human");
  assert.equal(task.blockedAt, "提交前总闸");
  assert.equal(task.view, "listing");
  assert.equal(task.nodeKey, "preflight_check");
  assert.equal(task.reason, "缺少售价，不能提交。");
  assert.equal(task.nextAction, "补齐售价后重新预检");
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

test("workflowCurrentProductTask keeps post-submit stock evidence blocked", () => {
  const summary = summarizeWorkflowRun({
    title: "Imported without stock evidence",
    entity: {
      stockReadiness: {
        status: "blocked",
        reasonCode: "STOCK_CURRENT_EVIDENCE_REQUIRED",
        offerIds: ["SKU-EVIDENCE"],
        nextAction: "先读取对应 offer_id/warehouse_id 的当前库存，再执行库存预检",
      },
    },
    nodes: [{
      key: "review_reconcile",
      name: "审核回执",
      status: "success",
      output: { importedItems: [{ offer_id: "SKU-EVIDENCE", product_id: 91 }] },
    }],
  });

  assert.equal(summary.currentProductTask.stage, "warehouse_queue");
  assert.equal(summary.currentProductTask.status, "blocked");
  assert.equal(summary.currentProductTask.nodeKey, "stock_readiness");
  assert.equal(summary.currentProductTask.offerId, "SKU-EVIDENCE");
  assert.match(summary.currentProductTask.reason, /当前库存证据/);
  assert.match(summary.currentProductTask.nextAction, /读取对应/);
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

test("reconcileWorkflowTaskReadback binds import-info evidence to the submitting workflow", async () => {
  reset();
  const run = await createWorkflowRun({
    id: "wr-readback",
    status: "running",
    entity: { storeId: "store-1", taskId: 12345 },
    payloadDraft: { items: [{ offer_id: "offer-1" }] },
  });
  const result = await reconcileWorkflowTaskReadback(run.id, {
    taskId: 12345,
    storeId: "store-1",
    importInfo: { result: { items: [{ offer_id: "offer-1", product_id: 987, status: "imported" }] } },
    responseHash: "sha256:test",
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "pending_moderation");
  const saved = await getWorkflowRun(run.id);
  const node = saved.nodes.find((item) => item.key === "review_reconcile");
  assert.equal(node.status, "running");
  assert.equal(node.output.readinessState, "pending_moderation");
  assert.equal(node.output.importedItems[0].product_id, 987);
  assert.equal(saved.events.at(-1).type, "task_readback_observed");
});

test("reconcileWorkflowTaskReadback rejects a task from another workflow", async () => {
  reset();
  const run = await createWorkflowRun({ id: "wr-readback-mismatch", entity: { storeId: "store-1", taskId: 12345 } });
  const result = await reconcileWorkflowTaskReadback(run.id, {
    taskId: 54321,
    storeId: "store-1",
    importInfo: { result: { items: [] } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "WORKFLOW_TASK_MISMATCH");
  const saved = await getWorkflowRun(run.id);
  assert.equal(saved.nodes.some((item) => item.key === "review_reconcile"), false);
});

test("reconcileWorkflowTaskReadback requires the submitting workflow store scope", async () => {
  reset();
  const run = await createWorkflowRun({ id: "wr-readback-store-required", entity: { storeId: "store-1", taskId: 12345 } });
  const result = await reconcileWorkflowTaskReadback(run.id, {
    taskId: 12345,
    importInfo: { result: { items: [] } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "WORKFLOW_STORE_REQUIRED");
  const saved = await getWorkflowRun(run.id);
  assert.equal(saved.nodes.some((item) => item.key === "review_reconcile"), false);
});
