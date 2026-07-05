import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const REQUIRED_PROOFS = ["批准审计记录", "样本覆盖", "独立预检回归结果", "回滚方案", "审核人"];
let writeChain = Promise.resolve();

function reviewFile() {
  return process.env.RULE_PUBLISH_REVIEW_FILE || path.join(DATA_DIR, "rule-publish-review.json");
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `rpr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function text(value) {
  return String(value || "").trim();
}

async function readStore() {
  try {
    const raw = await fs.readFile(reviewFile(), "utf8");
    const parsed = JSON.parse(raw || "{}");
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { items: [] };
    throw error;
  }
}

async function writeStoreUnlocked(store) {
  await fs.mkdir(path.dirname(reviewFile()), { recursive: true });
  await fs.writeFile(reviewFile(), JSON.stringify({ items: store.items || [] }, null, 2), "utf8");
}

async function writeStore(store) {
  writeChain = writeChain.then(() => writeStoreUnlocked(store), () => writeStoreUnlocked(store));
  return writeChain;
}

function normalizeSampleCoverage(sampleCoverage = {}) {
  const sampleProductIds = Array.isArray(sampleCoverage.sampleProductIds)
    ? sampleCoverage.sampleProductIds.map(text).filter(Boolean)
    : [];
  const sampleRunIds = Array.isArray(sampleCoverage.sampleRunIds)
    ? sampleCoverage.sampleRunIds.map(text).filter(Boolean)
    : [];
  const distinctProductCount = new Set(sampleProductIds).size;
  return {
    distinctProductCount,
    sampleProductIds,
    sampleRunIds,
    coverageStatus: distinctProductCount >= 2 ? "sufficient" : "insufficient",
  };
}

function normalizeProof(proof = {}) {
  return {
    reviewedBy: text(proof.reviewedBy),
    independentPreflightRunId: text(proof.independentPreflightRunId),
    independentPreflightPassed: proof.independentPreflightPassed === true,
    rollbackPlan: text(proof.rollbackPlan),
  };
}

function assertPublishReviewInput(input = {}, sampleCoverage = {}, proof = {}) {
  if (input.confirmPublishReviewIntent !== true) {
    throw new Error("记录规则发布复核意图前必须人工确认。");
  }
  if (!text(input.approvalAuditIntentId)) {
    throw new Error("记录规则发布复核意图需要关联批准审计记录。");
  }
  if (!text(input.categoryKey) || !Number(input.attributeId || 0)) {
    throw new Error("记录规则发布复核意图需要类目和属性。");
  }
  if (sampleCoverage.distinctProductCount < 2) {
    throw new Error("记录规则发布复核意图需要至少两个不同商品样本。");
  }
  if (!proof.independentPreflightRunId || !proof.independentPreflightPassed) {
    throw new Error("记录规则发布复核意图需要通过独立预检回归。");
  }
  if (!proof.rollbackPlan) {
    throw new Error("记录规则发布复核意图需要回滚方案。");
  }
  if (!text(input.reviewer) || !proof.reviewedBy) {
    throw new Error("记录规则发布复核意图需要审核人。");
  }
  if (text(input.reviewer) !== proof.reviewedBy) {
    throw new Error("规则发布复核意图的审核人必须与证明审核人一致。");
  }
}

export async function appendRulePublishReviewIntent(input = {}) {
  const sampleCoverage = normalizeSampleCoverage(input.sampleCoverage || {});
  const proof = normalizeProof(input.proof || {});
  assertPublishReviewInput(input, sampleCoverage, proof);
  const record = {
    id: makeId(),
    createdAt: nowIso(),
    categoryKey: text(input.categoryKey),
    categoryPath: text(input.categoryPath),
    attributeId: Number(input.attributeId || 0),
    attributeName: text(input.attributeName) || `属性 ${Number(input.attributeId || 0)}`,
    approvalAuditIntentId: text(input.approvalAuditIntentId),
    reviewer: proof.reviewedBy,
    confirmPublishReviewIntent: true,
    intentStatus: "stored_for_publish_review",
    publishStatus: "review_only_not_enabled",
    effectStatus: "no_rule_or_payload_effect",
    requiredProofs: [...REQUIRED_PROOFS],
    sampleCoverage,
    proof,
    reviewReadiness: {
      readOnly: true,
      status: "review_ready",
      canEnableRule: false,
      canWritePayload: false,
      safeNextStep: "发布复核意图已记录；启用规则前仍需独立人工发布流程和最终预检。",
    },
    forbiddenEffects: ["rule_enable", "payload_write", "workflow_unlock", "ozon_submit"],
    safetyLocks: {
      ruleEnable: false,
      payloadWrite: false,
      workflowUnlock: false,
      ozonSubmit: false,
    },
    safeNextStep: "发布复核意图仅供审计追踪；下一步需要独立人工发布流程，不能自动启用规则、写草稿或提交 Ozon。",
  };
  const store = await readStore();
  store.items.unshift(record);
  await writeStore(store);
  return record;
}

export async function listRulePublishReviewIntents(filter = {}) {
  const store = await readStore();
  let items = store.items || [];
  for (const key of ["categoryKey", "attributeId", "approvalAuditIntentId", "intentStatus", "publishStatus", "reviewer"]) {
    const value = text(filter[key]);
    if (value) items = items.filter((item) => String(item[key] || "") === value);
  }
  const limit = Math.max(1, Math.min(500, Number(filter.limit || 100)));
  return {
    items: items.slice(0, limit),
    total: items.length,
    summary: summarizeItems(items),
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = String(item[key] || "unknown");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function summarizeItems(items = []) {
  return {
    total: items.length,
    byIntentStatus: countBy(items, "intentStatus"),
    byPublishStatus: countBy(items, "publishStatus"),
    safeNextStep: items.length
      ? "发布复核意图已记录，但仍不能自动启用规则、写草稿或提交 Ozon。"
      : "暂无规则发布复核意图；规则仍停留在只读审查池。",
  };
}

export async function summarizeRulePublishReviewIntents() {
  const store = await readStore();
  return summarizeItems(store.items || []);
}
