import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const REQUIRED_PROOFS = ["样本复核记录", "人工批准人和时间", "独立预检回归结果"];
let writeChain = Promise.resolve();

function auditFile() {
  return process.env.RULE_APPROVAL_AUDIT_FILE || path.join(DATA_DIR, "rule-approval-audit.json");
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `raa_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function readStore() {
  try {
    const raw = await fs.readFile(auditFile(), "utf8");
    const parsed = JSON.parse(raw || "{}");
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { items: [] };
    throw error;
  }
}

async function writeStoreUnlocked(store) {
  await fs.mkdir(path.dirname(auditFile()), { recursive: true });
  await fs.writeFile(auditFile(), JSON.stringify({ items: store.items || [] }, null, 2), "utf8");
}

async function writeStore(store) {
  writeChain = writeChain.then(() => writeStoreUnlocked(store), () => writeStoreUnlocked(store));
  return writeChain;
}

function text(value) {
  return String(value || "").trim();
}

function normalizeProof(proof = {}) {
  return {
    sampleReviewRecord: text(proof.sampleReviewRecord),
    approvedBy: text(proof.approvedBy),
    independentPreflightRunId: text(proof.independentPreflightRunId),
    independentPreflightPassed: proof.independentPreflightPassed === true,
  };
}

function assertAuditIntentInput(input = {}, proof = {}) {
  if (input.confirmAuditIntent !== true) {
    throw new Error("记录规则批准审计意图前必须人工确认。");
  }
  if (!text(input.categoryKey) || !Number(input.attributeId || 0)) {
    throw new Error("记录规则批准审计意图需要类目和属性。");
  }
  if (!proof.sampleReviewRecord || !proof.approvedBy) {
    throw new Error("记录规则批准审计意图需要样本复核记录和人工批准人。");
  }
  if (text(input.approver) && text(input.approver) !== proof.approvedBy) {
    throw new Error("记录规则批准审计意图的批准人必须与证明批准人一致。");
  }
  if (!proof.independentPreflightRunId || !proof.independentPreflightPassed) {
    throw new Error("记录规则批准审计意图需要通过独立预检回归。");
  }
}

export async function appendRuleApprovalAuditIntent(input = {}) {
  const proof = normalizeProof(input.proof || {});
  assertAuditIntentInput(input, proof);
  const record = {
    id: makeId(),
    createdAt: nowIso(),
    workflowRunId: text(input.workflowRunId),
    categoryKey: text(input.categoryKey),
    categoryPath: text(input.categoryPath),
    attributeId: Number(input.attributeId || 0),
    attributeName: text(input.attributeName) || `属性 ${Number(input.attributeId || 0)}`,
    sampleProductIds: Array.isArray(input.sampleProductIds) ? input.sampleProductIds.map(text).filter(Boolean) : [],
    sampleRunIds: Array.isArray(input.sampleRunIds) ? input.sampleRunIds.map(text).filter(Boolean) : [],
    approver: proof.approvedBy,
    note: text(input.note),
    confirmAuditIntent: true,
    intentStatus: "stored_for_review",
    effectStatus: "no_rule_or_payload_effect",
    requiredProofs: [...REQUIRED_PROOFS],
    proof,
    auditReadiness: {
      readOnly: true,
      status: "audit_ready",
      canStoreApproval: true,
      canEnableRule: false,
      safeNextStep: "审计意图已记录；启用规则前仍需独立规则发布闸和预检回归。",
    },
    safetyLocks: {
      draftWrite: false,
      ozonSubmit: false,
      ruleEnable: false,
      workflowUnlock: false,
    },
  };
  const store = await readStore();
  store.items.unshift(record);
  await writeStore(store);
  return record;
}

export async function listRuleApprovalAuditIntents(filter = {}) {
  const store = await readStore();
  let items = store.items || [];
  for (const key of ["workflowRunId", "categoryKey", "attributeId", "intentStatus", "approver"]) {
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
    byApprover: countBy(items, "approver"),
    safeNextStep: items.length
      ? "审计意图已记录，但仍不能自动启用规则、写草稿或提交 Ozon。"
      : "暂无规则批准审计意图；规则候选仍停留在只读审查池。",
  };
}

export async function summarizeRuleApprovalAuditIntents() {
  const store = await readStore();
  return summarizeItems(store.items || []);
}
