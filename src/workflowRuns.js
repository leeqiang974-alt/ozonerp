import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { diagnoseListingQuality } from "./listingQuality.js";
import { loadCategoryCache } from "./ozonCategoryCache.js";
import {
  buildRequiredAttributeManualBacklog,
  buildRequiredAttributeApprovalDraftPreview,
  buildRequiredAttributeFillPlan,
  buildRequiredAttributeRuleCandidateHistory,
  buildRequiredAttributeRuleCandidateIndex,
  summarizeRequiredAttributeFillPlan,
} from "./ozonRequiredAttributeAnalysis.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const writeChains = new Map();

function workflowFile() {
  return process.env.WORKFLOW_RUNS_FILE || path.join(DATA_DIR, "workflow-runs.json");
}

function nowIso() {
  return new Date().toISOString();
}

function canonical1688OfferId(url = "") {
  const canonical = String(url || "").trim().split(/[?#]/)[0];
  return canonical.match(/^https?:\/\/detail\.1688\.com\/offer\/(\d+)(?:\.html)?$/i)?.[1] || "";
}

function makeId() {
  return "wr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function readStore() {
  try {
    const raw = await fs.readFile(workflowFile(), "utf8");
    const parsed = JSON.parse(raw || "{}");
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { items: [] };
    throw error;
  }
}

async function writeStoreUnlocked(store) {
  await fs.mkdir(path.dirname(workflowFile()), { recursive: true });
  const payload = JSON.stringify({ items: store.items || [] }, null, 2);
  let lastError = null;
  for (let i = 0; i < 8; i += 1) {
    const tmp = `${workflowFile()}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    try {
      await fs.writeFile(tmp, payload, "utf8");
      await fs.rename(tmp, workflowFile());
      return;
    } catch (error) {
      lastError = error;
      try { await fs.unlink(tmp); } catch {}
      if (!error || !["EPERM", "ENOENT", "EBUSY"].includes(error.code)) break;
      await new Promise((resolve) => setTimeout(resolve, 40 * (i + 1)));
    }
  }
  await fs.writeFile(workflowFile(), payload, "utf8");
  if (lastError) return;
}

async function writeStore(store) {
  const file = workflowFile();
  const previous = writeChains.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeStoreUnlocked(store));
  writeChains.set(file, next.catch(() => {}));
  return next;
}

function mutateStore(operation) {
  const file = workflowFile();
  const previous = writeChains.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const store = await readStore();
    const result = await operation(store);
    if (result?.write !== false) await writeStoreUnlocked(store);
    return result?.value;
  });
  writeChains.set(file, next.catch(() => {}));
  return next;
}

export async function listWorkflowRuns() {
  const store = await readStore();
  const items = withRequiredAttributeRuleHistorySummaries(store.items)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return {
    items,
    summary: summarizeWorkflowRunList(items),
  };
}

function requiredAttributeRuleCandidateIndexFromRun(run = {}) {
  return run.payloadDraftValidation?.requiredAttributeRuleCandidateIndex
    || (Array.isArray(run.nodes) ? run.nodes.find((node) => node.key === "preflight_check")?.output?.requiredAttributeRuleCandidateIndex : null)
    || null;
}

function requiredAttributeRuleCandidateHistorySample(run = {}) {
  const index = requiredAttributeRuleCandidateIndexFromRun(run);
  const candidates = Array.isArray(index?.candidates) ? index.candidates : [];
  if (!index?.categoryKey || !candidates.length) return null;
  return {
    sourceProductId: run.entity?.parentSku || firstPayloadOfferId(run.payloadDraft || {}) || run.id || "",
    sourceRunId: run.id || "",
    index,
  };
}

function withRequiredAttributeRuleHistorySummaries(runs = []) {
  const sourceRuns = Array.isArray(runs) ? runs : [];
  const samples = sourceRuns.map(requiredAttributeRuleCandidateHistorySample).filter(Boolean);
  return sourceRuns.map((run) => {
    const summary = summarizeWorkflowRun(run);
    const currentIndex = requiredAttributeRuleCandidateIndexFromRun(run);
    const currentCategoryKey = currentIndex?.categoryKey || "";
    if (!currentCategoryKey) return { ...run, summary };
    const categorySamples = samples.filter((sample) => sample.index?.categoryKey === currentCategoryKey);
    if (!categorySamples.length) return { ...run, summary };
    const history = buildRequiredAttributeRuleCandidateHistory(categorySamples);
    const approvalDraftPreview = buildRequiredAttributeApprovalDraftPreview(history);
    return {
      ...run,
      summary: {
        ...summary,
        requiredAttributeRuleCandidateHistory: {
          ...history,
          ...approvalDraftPreview,
        },
      },
    };
  });
}

export async function getWorkflowRun(id) {
  const store = await readStore();
  return store.items.find((item) => item.id === id) || null;
}

export async function reconcileStaleWorkflowRuns(options = {}) {
  const store = await readStore();
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const staleAfterMs = Math.max(60 * 60 * 1000, Number(options.staleAfterMs || 2 * 60 * 60 * 1000));
  const runIds = [];
  for (const run of store.items) {
    if (run.status !== "running") continue;
    const updatedAt = Date.parse(run.updatedAt || run.createdAt || "");
    if (!Number.isFinite(updatedAt) || now.getTime() - updatedAt < staleAfterMs) continue;
    const nodeKey = run.currentNode || (run.nodes || []).find((node) => ["running", "retrying"].includes(node.status))?.key || "";
    run.nodes = (run.nodes || []).map((node) => {
      if (node.key !== nodeKey || !["running", "retrying", "pending"].includes(node.status)) return node;
      return {
        ...node,
        status: "waiting_human",
        finishedAt: now.toISOString(),
        branch: "stale_manual_review",
        riskScore: Math.max(Number(node.riskScore || 0), 60),
        riskLevel: node.riskLevel === "high" ? "high" : "medium",
        reason: "工作流长时间没有更新，已从运行中转为等待人工确认。",
        recommendedActions: ["检查绑定任务是否仍存在", "人工选择重试、换货源或暂停"],
        actions: ["retry_node", "request_new_source", "pause_workflow"],
      };
    });
    run.status = "waiting_human";
    run.currentNode = nodeKey;
    run.locks = { ...(run.locks || {}), paused: false, waitingHuman: true };
    run.events = [...(run.events || []), {
      time: now.toISOString(),
      node: nodeKey,
      type: "workflow_stale_reconciled",
      message: "陈旧运行状态已治理，等待人工确认下一步",
      data: {
        previousStatus: "running",
        staleAfterMs,
        staleAgeMs: now.getTime() - updatedAt,
      },
    }];
    run.updatedAt = now.toISOString();
    runIds.push(run.id);
  }
  if (runIds.length) await writeStore(store);
  return {
    ok: true,
    scanned: store.items.length,
    reconciled: runIds.length,
    runIds,
    staleAfterMs,
  };
}

export async function createWorkflowRun(input = {}) {
  const store = await readStore();
  const now = nowIso();
  const run = {
    id: input.id || makeId(),
    source: String(input.source || "manual"),
    status: String(input.status || "draft"),
    currentNode: String(input.currentNode || ""),
    title: String(input.title || ""),
    createdAt: now,
    updatedAt: now,
    entity: input.entity || {},
    nodes: Array.isArray(input.nodes) ? input.nodes : [],
    events: Array.isArray(input.events) ? input.events : [],
    locks: {
      paused: false,
      waitingHuman: false,
      submitLocked: false,
      ...(input.locks || {}),
    },
  };
  store.items.unshift(run);
  await writeStore(store);
  return run;
}

export async function upsertWorkflowNode(runId, nodeInput = {}) {
  const store = await readStore();
  const index = store.items.findIndex((item) => item.id === runId);
  if (index < 0) throw new Error("工作流不存在: " + runId);
  const run = store.items[index];
  const key = String(nodeInput.key || "").trim();
  if (!key) throw new Error("节点 key 不能为空");
  const nodeIndex = (run.nodes || []).findIndex((node) => node.key === key);
  const existingNode = nodeIndex >= 0 ? run.nodes[nodeIndex] : {};
  const keep = (field, fallback) => Object.prototype.hasOwnProperty.call(nodeInput, field)
    ? nodeInput[field]
    : (existingNode[field] ?? fallback);
  const now = nowIso();
  const diagnosis = keep("diagnosis", {});
  const nextNode = {
    key,
    name: String(keep("name", key) || key),
    status: String(keep("status", "pending") || "pending"),
    startedAt: nodeInput.startedAt || existingNode.startedAt || (nodeInput.status === "running" ? now : ""),
    finishedAt: nodeInput.finishedAt || existingNode.finishedAt || (["success", "failed", "waiting_human", "skipped"].includes(String(nodeInput.status)) ? now : ""),
    input: keep("input", {}),
    output: keep("output", {}),
    error: keep("error", {}),
    diagnosis,
    diagnostic: Object.prototype.hasOwnProperty.call(nodeInput, "diagnostic")
      ? nodeInput.diagnostic
      : (Object.prototype.hasOwnProperty.call(nodeInput, "diagnosis") ? diagnosis : (existingNode.diagnostic || diagnosis || {})),
    branch: keep("branch", ""),
    riskScore: Number(keep("riskScore", 0) || 0),
    riskLevel: keep("riskLevel", ""),
    reason: keep("reason", ""),
    recommendedActions: Array.isArray(keep("recommendedActions", [])) ? keep("recommendedActions", []) : [],
    actions: Array.isArray(keep("actions", [])) ? keep("actions", []) : [],
  };
  if (nodeIndex >= 0) {
    run.nodes[nodeIndex] = { ...run.nodes[nodeIndex], ...nextNode };
  } else {
    run.nodes = [...(run.nodes || []), nextNode];
  }
  run.currentNode = key;
  run.status = nodeInput.runStatus || run.status;
  if (nodeInput.runStatus === "waiting_human") {
    run.locks = { ...(run.locks || {}), waitingHuman: true };
  }
  if (nodeInput.runStatus === "running") {
    run.locks = { ...(run.locks || {}), waitingHuman: false };
  }
  run.updatedAt = now;
  store.items[index] = run;
  await writeStore(store);
  return run;
}

export async function appendWorkflowEvent(runId, event = {}) {
  const store = await readStore();
  const index = store.items.findIndex((item) => item.id === runId);
  if (index < 0) throw new Error("工作流不存在: " + runId);
  const run = store.items[index];
  run.events = [...(run.events || []), {
    time: event.time || nowIso(),
    node: String(event.node || ""),
    type: String(event.type || "event"),
    message: String(event.message || ""),
    data: event.data || {},
  }];
  run.updatedAt = nowIso();
  store.items[index] = run;
  await writeStore(store);
  return run;
}

function errorText(error = {}) {
  return [
    error.message,
    error.description,
    error.attribute_name,
    error.raw,
    JSON.stringify(error || {}),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function diagnoseWorkflowError(error = {}) {
  const text = errorText(error);
  const attributeId = Number(error.attribute_id || error.attributeId || 0);
  if (attributeId === 9048 || /название модели|model name|型号|模型/.test(text)) {
    return {
      reasonCode: "ATTRIBUTE_REQUIRED",
      severity: "blocking",
      messageZh: "缺少 Ozon 必填属性：9048 Название модели（用于合并到同一张卡片的模型名称）。",
      fixHints: ["补充属性 9048：模型名称", "确认 retry_model 不会删除其它必填属性", "重新校验 payload 后提交"],
    };
  }
  if (attributeId === 4958 || /предназначено для|适用/.test(text)) {
    return {
      reasonCode: "ATTRIBUTE_REQUIRED",
      severity: "blocking",
      messageZh: "缺少 Ozon 必填属性：4958 Предназначено для（适用对象）。",
      fixHints: ["按商品文本补充适用对象", "宠物猫商品优先使用 Для кошек", "重新校验 payload 后提交"],
    };
  }
  if (/категория|тип|category|type/.test(text)) {
    return {
      reasonCode: "CATEGORY_INVALID",
      severity: "blocking",
      messageZh: "Ozon 判断类目或类型与商品不匹配。",
      fixHints: ["重新执行类目匹配", "检查标题和图片是否与 type_id 一致", "必要时人工切换候选类目"],
    };
  }
  return {
    reasonCode: "UNKNOWN",
    severity: "warning",
    messageZh: "未识别的错误，需要查看 Ozon 原文。",
    fixHints: ["查看错误原文", "检查 offer_id、类目、必填属性和图片"],
  };
}

function payloadItems(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : (payload.offer_id ? [payload] : []);
}

function firstPayloadOfferId(payload = {}) {
  return String(payloadItems(payload)[0]?.offer_id || "");
}

function hasAttr(item, id) {
  return (item.attributes || []).some((attribute) => (
    Number(attribute.id) === Number(id)
    && Array.isArray(attribute.values)
    && attribute.values.length > 0
  ));
}

function attributeValueSignature(attribute = {}) {
  return (attribute.values || []).map((value) => (
    Number(value?.dictionary_value_id || 0)
      ? `d:${Number(value.dictionary_value_id)}`
      : `v:${String(value?.value || "").trim().toLowerCase()}`
  )).filter((value) => !value.endsWith(":")).sort().join(",");
}

function attributeDisplayValue(attribute = {}) {
  return (attribute.values || []).map((value) => (
    String(value?.value || "").trim() || (Number(value?.dictionary_value_id || 0) ? `#${Number(value.dictionary_value_id)}` : "")
  )).filter(Boolean).join(", ");
}

function imageSignature(value = "") {
  return String(value || "").trim().replace(/\?.*$/, "").toLowerCase();
}

function pricingRiskByOffer(pricing = {}) {
  const risks = Array.isArray(pricing.risks) ? pricing.risks : [];
  const map = new Map();
  for (const risk of risks) {
    const code = String(risk?.code || risk?.reasonCode || "");
    if (!/^PRICING_/.test(code)) continue;
    const offerId = String(risk.offerId || risk.offer_id || "*");
    map.set(offerId, {
      code,
      message: risk.message || risk.messageZh || "该 SKU 存在定价风险。",
    });
  }
  if (!map.size && /^PRICING_/.test(String(pricing.reasonCode || pricing.code || ""))) {
    map.set("*", {
      code: String(pricing.reasonCode || pricing.code),
      message: pricing.message || pricing.messageZh || "当前商品存在定价阻塞。",
    });
  }
  return map;
}

function safeVariantNextAction(status = "", reasons = []) {
  if (status === "pricing_blocked") return "先修正该 SKU 定价风险，再重新预检；不会自动提交 Ozon。";
  if (status === "duplicate_aspect") return "修正重复的可变特性组合后重新预检；不会自动提交 Ozon。";
  if (status === "missing_aspect") return "补齐 Ozon 可变特性后重新预检；不会自动提交 Ozon。";
  if (status === "missing_image") return "补齐 SKU 图后重新预检；不会自动提交 Ozon。";
  if ((reasons || []).some((reason) => reason.code === "SKU_IMAGE_NOT_UNIQUE")) {
    return "建议补区分 SKU 图以提高商品卡质量，提交前仍需重新预检。";
  }
  return "变体配置暂未发现阻塞，继续查看预检总闸和人工确认。";
}

function normalizeVariantSpecText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{Script=Han}\p{Script=Cyrillic}a-z0-9]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceVariantForRow(sourceVariants = [], row = {}, index = 0, offerId = "") {
  const variants = Array.isArray(sourceVariants) ? sourceVariants : [];
  const normalizedOffer = String(offerId || row.offerId || "").trim();
  const matched = normalizedOffer
    ? variants.find((variant) => [
      variant?.offerId,
      variant?.offer_id,
      variant?.skuOfferId,
      variant?.sku_offer_id,
    ].some((value) => String(value || "").trim() === normalizedOffer))
    : null;
  if (normalizedOffer && !matched) return null;
  const variant = matched || variants[index] || null;
  if (!variant) return null;
  const spec = String(variant.spec || variant.skuSpec || variant.name || variant.label || "").trim();
  if (!spec) return null;
  return {
    spec,
    image: variant.image || variant.imageUrl || variant.skuImageUrl || "",
    sourceSkuId: String(variant.sourceSkuId || variant.source_sku_id || variant.skuId || variant.sku_id || "").trim(),
    sourceSnapshotHash: String(variant.sourceSnapshotHash || variant.source_snapshot_hash || "").trim(),
    source: variant.source || "1688_sku_variant",
  };
}

export function buildSourceVariantBindingSummary(input = {}) {
  const items = payloadItems(input.payload || input.submitPayload || {});
  const sourceVariants = Array.isArray(input.sourceVariants) ? input.sourceVariants : [];
  const expectedSnapshotHash = String(input.sourceEvidence?.snapshotHash || "").trim();
  const requireSnapshotBinding = input.sourceVariantEvidenceRequired === true;
  const rows = items.map((item, index) => {
    const offerId = String(item?.offer_id || "").trim();
    const sourceVariant = sourceVariantForRow(sourceVariants, { offerId }, index, offerId);
    const sourceSkuId = String(sourceVariant?.sourceSkuId || "").trim();
    const snapshotMatches = !requireSnapshotBinding
      || (/^sha256:[a-f0-9]{64}$/i.test(expectedSnapshotHash)
        && sourceVariant?.sourceSnapshotHash === expectedSnapshotHash);
    return {
      offerId,
      sourceSkuId,
      status: sourceSkuId && snapshotMatches ? "bound" : "missing",
      sourceSpec: sourceVariant?.spec || "",
      sourceSnapshotHash: sourceVariant?.sourceSnapshotHash || "",
    };
  });
  const ids = rows.map((row) => row.sourceSkuId).filter(Boolean);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const missingOfferIds = rows.filter((row) => row.status !== "bound").map((row) => row.offerId);
  return {
    rows,
    summary: {
      itemCount: rows.length,
      boundCount: rows.filter((row) => row.status === "bound").length,
      missingCount: missingOfferIds.length,
      duplicateCount: duplicateIds.length,
      missingOfferIds,
      duplicateSourceSkuIds: duplicateIds,
      ready: rows.length > 0 && missingOfferIds.length === 0 && duplicateIds.length === 0,
    },
  };
}

export function buildSourceVariantBindingReceipt(input = {}) {
  const summary = buildSourceVariantBindingSummary(input);
  const snapshotHash = String(input.sourceEvidence?.snapshotHash || "").trim();
  const validSnapshot = /^sha256:[a-f0-9]{64}$/i.test(snapshotHash);
  const rows = summary.rows.map((row) => ({
    offerRef: `sha256:${createHash("sha256").update(String(row.offerId || ""), "utf8").digest("hex")}`,
    sourceSkuRef: row.sourceSkuId
      ? `sha256:${createHash("sha256").update(String(row.sourceSkuId), "utf8").digest("hex")}`
      : "",
    status: row.status,
  }));
  const receipt = {
    schemaVersion: 1,
    sourceSnapshotHash: validSnapshot ? snapshotHash : "",
    itemCount: summary.summary.itemCount,
    boundCount: summary.summary.boundCount,
    missingCount: summary.summary.missingCount,
    duplicateCount: summary.summary.duplicateCount,
    rows,
    ready: validSnapshot && summary.summary.ready,
    verificationLevel: validSnapshot && summary.summary.ready ? "locally_tested" : "needs_evidence",
  };
  receipt.receiptHash = `sha256:${createHash("sha256").update(JSON.stringify(receipt), "utf8").digest("hex")}`;
  return receipt;
}

function sourceVariantTextAspectValue(meta = {}, sourceVariant = null) {
  if (!sourceVariant) return "";
  const text = normalizeVariantSpecText(sourceVariant.spec);
  const metaText = normalizeVariantSpecText(`${meta.name || ""} ${meta.description || ""}`);
  const colorRules = [
    { pattern: /бел|\bwhite\b|白/, value: "белый" },
    { pattern: /син|голуб|\bblue\b|蓝|藍/, value: "синий" },
    { pattern: /черн|чёрн|\bblack\b|黑/, value: "черный" },
    { pattern: /красн|\bred\b|红|紅/, value: "красный" },
    { pattern: /желт|жёлт|\byellow\b|黄|黃/, value: "желтый" },
    { pattern: /зелен|зелён|\bgreen\b|绿|綠/, value: "зеленый" },
    { pattern: /розов|\bpink\b|粉/, value: "розовый" },
    { pattern: /фиолет|\bpurple\b|紫/, value: "фиолетовый" },
    { pattern: /оранж|\borange\b|橙/, value: "оранжевый" },
    { pattern: /коричнев|\bbrown\b|棕|咖啡/, value: "коричневый" },
    { pattern: /сер(ый|ая|ое|ые)|\bgray\b|\bgrey\b|灰/, value: "серый" },
    { pattern: /беж|\bbeige\b|米色/, value: "бежевый" },
  ];
  if (/цвет|color|颜色|顏色|色彩|色号|色號/.test(metaText)) {
    const match = colorRules.find((rule) => rule.pattern.test(text));
    if (match) return match.value;
  }
  return sourceVariant.spec;
}

function sourceVariantAspectSuggestions({
  row = {},
  sourceVariant = null,
  attrsMeta = [],
} = {}) {
  if (!sourceVariant) return [];
  const existingAspectIds = new Set((row.aspects || []).map((aspect) => Number(aspect.id || 0)).filter(Boolean));
  return (attrsMeta || [])
    .filter((meta) => meta?.is_aspect && Number(meta?.id || 0) && !existingAspectIds.has(Number(meta.id || 0)))
    .map((meta) => {
      const value = sourceVariantTextAspectValue(meta, sourceVariant);
      if (!value) return null;
      return {
        attributeId: Number(meta.id || 0),
        attributeName: metaName(meta),
        value,
        source: "1688_sku_spec",
        confidence: 0.72,
        readOnly: true,
        forbiddenEffects: ["payload_write", "ozon_submit", "rule_auto_enable"],
      };
    })
    .filter(Boolean);
}

function variantRepairSuggestions(row = {}, reasons = [], skuImage = {}) {
  const suggestions = [];
  const primaryMissingAspect = (Array.isArray(row.missingAspects) ? row.missingAspects : []).find((aspect) => aspect?.id || aspect?.name) || null;
  const primaryAspect = primaryMissingAspect
    || (Array.isArray(row.aspects) ? row.aspects : []).find((aspect) => aspect?.id || aspect?.name)
    || null;
  const suggestedAspects = Array.isArray(row.suggestedAspects) ? row.suggestedAspects : [];
  const aspectLabel = String(primaryAspect?.name || (primaryAspect?.id ? `属性 ${primaryAspect.id}` : "Ozon 可变特性"));
  const reasonCodes = new Set((reasons || []).map((reason) => String(reason?.code || "")));
  if (reasonCodes.has("MISSING_ASPECT")) {
    suggestions.push({
      code: "MISSING_ASPECT",
      title: "补齐可变特性",
      action: `为该 SKU 补齐 ${aspectLabel}，确保同父 SKU 的颜色、尺码或容量可区分。`,
      suggestedAspects,
      nextStep: suggestedAspects.length
        ? "可参考 1688 SKU 规格人工写入本地草稿并重新预检；本建议不会自动写 Payload 或提交 Ozon。"
        : "修改本地 Payload 草稿后重新预检；不会自动提交 Ozon。",
    });
  }
  if (reasonCodes.has("DUPLICATE_ASPECT")) {
    suggestions.push({
      code: "DUPLICATE_ASPECT",
      title: "区分变体组合",
      action: `把该 SKU 的 ${aspectLabel} 改成唯一组合，不能与同父 SKU 完全相同。`,
      nextStep: "整组 SKU 都唯一后重新预检；不会自动提交 Ozon。",
    });
  }
  if (skuImage?.status === "missing" || reasonCodes.has("SKU_IMAGE_MISSING")) {
    suggestions.push({
      code: "SKU_IMAGE_MISSING",
      title: "补齐 SKU 图",
      action: "为该 SKU 补齐可区分的 SKU 图，第一张图会用于变体识别和商品分值判断。",
      nextStep: "补图后重新预检；不会触发 GPT/Image 成本。",
    });
  }
  if (skuImage?.status === "not_unique" || reasonCodes.has("SKU_IMAGE_NOT_UNIQUE")) {
    suggestions.push({
      code: "SKU_IMAGE_NOT_UNIQUE",
      title: "区分 SKU 图",
      action: "为该 SKU 准备与其他变体可区分的首图，避免多 SKU 使用相同图片组合。",
      nextStep: "换图后重新预检；不会触发 GPT/Image 成本。",
    });
  }
  return suggestions;
}

function variantGroupDifferenceSuggestions(grouping = {}) {
  const rowsByOffer = new Map((grouping.rows || []).map((row) => [String(row.offerId || ""), row]));
  return (grouping.duplicateGroups || []).map((group) => {
    const affectedRows = (group.offerIds || []).map((offerId) => rowsByOffer.get(String(offerId))).filter(Boolean);
    const aspectNames = [...new Set(affectedRows.flatMap((row) => (row.aspects || []).map((aspect) => aspect.name || `属性 ${aspect.id || ""}`)).filter(Boolean))];
    const aspectLabel = aspectNames.join(" / ") || "Ozon 可变特性";
    const repairTargets = affectedRows.flatMap((row) => (row.aspects || []).map((aspect) => {
      const attributeId = Number(aspect.id || 0);
      const payloadPath = `items[${Number(row.itemIndex || 0)}].attributes[id=${attributeId || ""}]`;
      const payloadLabel = `${row.offerId || "SKU"} / ${aspect.name || `属性 ${attributeId || ""}`}`;
      return {
        offerId: row.offerId || "",
        attributeId,
        attributeName: aspect.name || `属性 ${attributeId || ""}`,
        currentValue: aspect.value || "",
        payloadPath,
        payloadLabel,
        copyText: `SKU ${row.offerId || "未记录"} 的 ${aspect.name || `属性 ${attributeId || ""}`} 当前值为「${aspect.value || "空"}」，请在 ${payloadPath} 改成与同父 SKU 不重复的值；整组修复后重新预检，不会自动写 Payload 或提交 Ozon。`,
      };
    }));
    return {
      code: "VARIANT_GROUP_DIFFERENCE",
      duplicateGroupId: group.id || "",
      affectedOfferIds: group.offerIds || [],
      aspectNames,
      repairTargets,
      copyText: [
        `整组修复说明：重复组 ${group.id || ""} 涉及 SKU ${(group.offerIds || []).join("、") || "未记录"}。`,
        ...repairTargets.map((target) => target.copyText),
        "修完后必须重新预检；本建议不会自动写 Payload 或提交 Ozon。",
      ].join("\n"),
      action: `整组检查 ${aspectLabel}，为重复 SKU 改成唯一颜色、尺码、容量或套装组合。`,
      nextStep: "整组 SKU 差异确认后重新预检；不会自动写 Payload 或提交 Ozon。",
    };
  });
}

function variantCoverageSummary(rows = [], grouping = {}, differenceSuggestions = []) {
  const rowCount = rows.length;
  const blockedRowCount = rows.filter((row) => ["duplicate_aspect", "missing_aspect", "pricing_blocked"].includes(row.rowStatus)).length;
  const imageWarningRowCount = rows.filter((row) => ["missing", "not_unique"].includes(row.skuImage?.status)).length;
  const duplicateAspectRowCount = rows.filter((row) => row.rowStatus === "duplicate_aspect").length;
  const missingAspectRowCount = rows.filter((row) => row.rowStatus === "missing_aspect").length;
  const pricingBlockedRowCount = rows.filter((row) => row.rowStatus === "pricing_blocked").length;
  const aspectCoveredRowCount = rows.filter((row) => (
    Array.isArray(row.aspects)
    && row.aspects.length > 0
    && (!Array.isArray(row.missingAspects) || row.missingAspects.length === 0)
  )).length;
  const uniqueSkuImageRowCount = rows.filter((row) => row.skuImage?.status === "unique").length;
  const missingSkuImageRowCount = rows.filter((row) => row.skuImage?.status === "missing").length;
  const nonUniqueSkuImageRowCount = rows.filter((row) => row.skuImage?.status === "not_unique").length;
  const suggestedAspectRowCount = rows.filter((row) => Array.isArray(row.suggestedAspects) && row.suggestedAspects.length).length;
  const suggestedAspectCount = rows.reduce((count, row) => count + Number((row.suggestedAspects || []).length || 0), 0);
  const repairSuggestionCount = rows.reduce((sum, row) => sum + (Array.isArray(row.repairSuggestions) ? row.repairSuggestions.length : 0), 0);
  const differenceSuggestionCount = Array.isArray(differenceSuggestions) ? differenceSuggestions.length : 0;
  const readinessStatus = blockedRowCount ? "blocked" : imageWarningRowCount ? "warning" : "ready";
  let safeNextAction = "变体属性和 SKU 图覆盖已达标，可以继续预检总闸和人工确认。";
  if (pricingBlockedRowCount) {
    safeNextAction = "先修正定价阻塞 SKU，再重新预检；不会自动提交 Ozon。";
  } else if (missingAspectRowCount || duplicateAspectRowCount) {
    safeNextAction = "先补齐或区分变体属性组合，再重新预检；不会自动提交 Ozon。";
  } else if (imageWarningRowCount) {
    safeNextAction = "建议补齐或区分 SKU 图以提升商品卡质量，提交前仍需重新预检。";
  }
  return {
    rowCount,
    blockedRowCount,
    imageWarningRowCount,
    duplicateGroupCount: (grouping.duplicateGroups || []).length,
    aspectCoveredRowCount,
    missingAspectRowCount,
    duplicateAspectRowCount,
    pricingBlockedRowCount,
    uniqueSkuImageRowCount,
    missingSkuImageRowCount,
    nonUniqueSkuImageRowCount,
    suggestedAspectRowCount,
    suggestedAspectCount,
    repairSuggestionCount,
    differenceSuggestionCount,
    readinessStatus,
    safeNextAction,
  };
}

function metaName(meta = {}) {
  return String(meta.name || meta.attribute_name || `属性 ${Number(meta.id || 0)}`);
}

function attributeValueIds(attribute = {}) {
  return (attribute.values || [])
    .map((value) => Number(value?.dictionary_value_id || 0))
    .filter(Boolean);
}

function dictionaryValueId(value = {}) {
  return Number(value?.dictionary_value_id || value?.value_id || value?.id || 0);
}

function dictionaryCacheValuesForAttribute(item = {}, meta = {}, dictionaryValueCache = {}, language = "ZH_HANS") {
  const descriptionCategoryId = Number(item?.description_category_id || item?.descriptionCategoryId || 0);
  const typeId = Number(item?.type_id || item?.typeId || 0);
  const attributeId = Number(meta?.id || 0);
  if (!descriptionCategoryId || !typeId || !attributeId) return [];
  const languages = [language, "ZH_HANS", "RU", "EN", "DEFAULT"].filter(Boolean);
  const values = [];
  const seenKeys = new Set();
  for (const lang of [...new Set(languages)]) {
    const key = [descriptionCategoryId, typeId, attributeId, lang].join(":");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    values.push(...(dictionaryValueCache?.[key]?.values || []));
  }
  return values;
}

function dictionaryValuesForMatrix(input = {}, item = {}, meta = {}) {
  const values = [
    ...dictionaryCacheValuesForAttribute(item, meta, input.dictionaryValueCache || {}, input.dictionaryLanguage || "ZH_HANS"),
  ];
  const attributeId = Number(meta?.id || 0);
  const byAttribute = input.dictionaryValuesByAttributeId || input.dictionaryValues || {};
  const directValues = byAttribute[String(attributeId)] || byAttribute[attributeId];
  if (Array.isArray(directValues)) values.push(...directValues);
  for (const metaValues of [meta.dictionary_values, meta.dictionaryValues, meta.values]) {
    if (Array.isArray(metaValues) && metaValues.some((value) => dictionaryValueId(value))) {
      values.push(...metaValues);
    }
  }
  return values;
}

function dictionaryValueIdSet(values = []) {
  return new Set((values || []).map(dictionaryValueId).filter(Boolean));
}

function matrixDictionaryCandidates(values = [], limit = 5) {
  return (values || [])
    .map((value) => ({
      dictionary_value_id: dictionaryValueId(value),
      value: String(value?.value || value?.name || value?.label || "").trim(),
      source: value?.source || "ozon_dictionary_values",
    }))
    .filter((value) => value.dictionary_value_id)
    .filter((value, index, valuesList) => (
      valuesList.findIndex((item) => item.dictionary_value_id === value.dictionary_value_id) === index
    ))
    .slice(0, limit);
}

function matrixSourceSuggestedDictionaryCandidates(values = [], sourceSuggestedAspect = null) {
  if (!sourceSuggestedAspect) return [];
  const sourceValue = String(sourceSuggestedAspect.value || "").trim();
  const normalizedSourceValue = normalizeVariantSpecText(sourceValue);
  if (!normalizedSourceValue) return [];
  return matrixDictionaryCandidates(values, Number.POSITIVE_INFINITY)
    .filter((candidate) => normalizeVariantSpecText(candidate.value || "") === normalizedSourceValue)
    .map((candidate) => ({
      ...candidate,
      source: "1688_sku_spec_dictionary_match",
      sourceValue,
      sourceVariantSpec: sourceSuggestedAspect.sourceVariantSpec || "",
      confidence: Math.max(Number(sourceSuggestedAspect.confidence || 0), 0.86),
    }))
    .slice(0, 1);
}

function matrixOfferPayloadPath(offerId = "") {
  const normalized = String(offerId || "").trim();
  return normalized ? `"offer_id": "${normalized}"` : "\"items\"";
}

function matrixCellRepairGuidance(input = {}) {
  const status = String(input.status || "");
  if (!["missing", "invalid_dictionary", "duplicate_variant", "missing_variant_aspect_metadata"].includes(status)) return null;
  const row = input.row || {};
  const offerId = String(input.offerId || "").trim();
  const attributeLabel = `${row.name || `属性 ${row.attributeId || ""}`} #${row.attributeId || ""}`.trim();
  const payloadPath = matrixOfferPayloadPath(offerId);
  const dictionaryCandidates = row.dictionary && row.aspect && input.sourceSuggestedAspect
    ? matrixSourceSuggestedDictionaryCandidates(input.legalValues || [], input.sourceSuggestedAspect)
    : matrixDictionaryCandidates(input.legalValues || []);
  const base = {
    humanRequired: true,
    offerId,
    attributeId: Number(row.attributeId || 0),
    attributeName: row.name || "",
    payloadPath,
    payloadLabel: `${offerId || "当前 SKU"} / ${attributeLabel}`,
    nextStep: "人工修复 Payload 草稿后，必须重新预检；不会自动提交 Ozon。",
    dictionaryCandidates: [],
  };
  if (status === "invalid_dictionary") {
    const candidateText = dictionaryCandidates.length
      ? dictionaryCandidates.map((candidate) => `#${candidate.dictionary_value_id} ${candidate.value || ""}`.trim()).join(" / ")
      : "需要重新拉取或人工选择 Ozon 合法字典值";
    const message = `当前 ${attributeLabel} 字典值不在当前 Ozon 类目合法值内，请人工选择合法字典值。`;
    return {
      ...base,
      message,
      canApplyLocalDraftRepair: dictionaryCandidates.length > 0,
      dictionaryCandidates,
      copyText: `问题：${message}\nSKU：${offerId || "-"}\n候选：${candidateText}\n下一步：${base.nextStep}`,
    };
  }
  if (status === "missing") {
    const message = `当前 ${attributeLabel} 缺失，请人工补充后重新校验。`;
    if (row.dictionary) {
      const candidateText = dictionaryCandidates.length
        ? dictionaryCandidates.map((candidate) => `#${candidate.dictionary_value_id} ${candidate.value || ""}`.trim()).join(" / ")
        : "当前类目没有可直接确认的合法字典候选";
      return {
        ...base,
        message,
        canApplyLocalDraftRepair: dictionaryCandidates.length > 0,
        dictionaryCandidates,
        copyText: `问题：${message}\nSKU：${offerId || "-"}\n候选：${candidateText}\n下一步：${base.nextStep}`,
      };
    }
    return {
      ...base,
      message,
      canApplyTextDraftRepair: Boolean(row.attributeId && !row.dictionary && !row.aspect),
      canApplyVariantTextDraftRepair: Boolean(row.attributeId && !row.dictionary && row.aspect),
      copyText: `问题：${message}\nSKU：${offerId || "-"}\n建议：在 attributes 中补充 id ${row.attributeId || "-"} 的值。\n下一步：${base.nextStep}`,
    };
  }
  if (status === "duplicate_variant") {
    const message = `当前 ${attributeLabel} 与其他 SKU 的变体特征重复，请人工调整颜色/规格等可变特性。`;
    return {
      ...base,
      message,
      copyText: `问题：${message}\nSKU：${offerId || "-"}\n下一步：${base.nextStep}`,
    };
  }
  const message = "当前类目没有可用于区分多 SKU 的 Ozon aspect 元数据，请重新获取类目属性或人工确认类目。";
  return {
    ...base,
    message,
    payloadPath: "\"description_category_id\"",
    payloadLabel: "Ozon 类目属性元数据",
    copyText: `问题：${message}\nSKU：${offerId || "-"}\n下一步：${base.nextStep}`,
  };
}

function matrixAttributeKind(meta = {}) {
  const required = meta?.is_required === true;
  const aspect = meta?.is_aspect === true;
  const dictionary = Number(meta?.dictionary_id || meta?.dictionaryId || 0) > 0;
  if (required && dictionary) return "required_dictionary";
  if (required) return "required";
  if (aspect) return "variant_aspect";
  if (dictionary) return "dictionary";
  return "attribute";
}

function matrixAttributeRows(attrsMeta = []) {
  return (attrsMeta || [])
    .filter((meta) => Number(meta?.id || 0))
    .filter((meta) => meta?.is_required === true || meta?.is_aspect === true || Number(meta?.dictionary_id || meta?.dictionaryId || 0) > 0)
    .map((meta) => ({
      attributeId: Number(meta.id),
      name: metaName(meta),
      kind: matrixAttributeKind(meta),
      required: meta?.is_required === true,
      aspect: meta?.is_aspect === true,
      dictionary: Number(meta?.dictionary_id || meta?.dictionaryId || 0) > 0,
      meta,
    }));
}

export function buildListingAttributeMatrix(input = {}) {
  const payload = input.payload || {};
  const attrsMeta = Array.isArray(input.attrsMeta) ? input.attrsMeta : [];
  const dictionaryValueCache = input.dictionaryValueCache || {};
  const dictionaryLanguage = input.dictionaryLanguage || "ZH_HANS";
  const items = payloadItems(payload);
  const offers = items.map((item, index) => String(item?.offer_id || `item-${index + 1}`));
  const variantDiagnosis = buildVariantGroupingDiagnosis({ items, attrsMeta });
  const duplicateAspectOffers = new Set((variantDiagnosis.duplicateGroups || []).flatMap((group) => group.offerIds || []));
  const sourceVariants = Array.isArray(input.sourceVariants) ? input.sourceVariants : (input.skuVariants || []);
  const sourceSuggestedAspectByCell = new Map();
  if (Array.isArray(sourceVariants) && sourceVariants.length) {
    (variantDiagnosis.rows || []).forEach((variantRow, index) => {
      const offerId = offers[index] || String(variantRow?.offerId || "");
      const sourceVariant = sourceVariantForRow(sourceVariants, variantRow, index, offerId);
      const suggestedAspects = sourceVariantAspectSuggestions({ row: variantRow, sourceVariant, attrsMeta });
      for (const aspect of suggestedAspects) {
        sourceSuggestedAspectByCell.set(`${offerId}:${Number(aspect.attributeId || 0)}`, {
          ...aspect,
          sourceVariantSpec: sourceVariant?.spec || "",
        });
      }
    });
  }
  const rows = matrixAttributeRows(attrsMeta).map((row) => {
    const cells = items.map((item, index) => {
      const offerId = offers[index];
      const attribute = (item.attributes || []).find((entry) => Number(entry?.id || 0) === row.attributeId) || null;
      const hasValue = attribute && attributeDisplayValue(attribute);
      let status = hasValue ? "ok" : (row.required || row.aspect ? "missing" : "empty");
      const valueIds = attributeValueIds(attribute || {});
      const legalValues = row.dictionary ? dictionaryValuesForMatrix({
        dictionaryValueCache,
        dictionaryLanguage,
        dictionaryValuesByAttributeId: input.dictionaryValuesByAttributeId || input.dictionaryValues || {},
      }, item, row.meta) : [];
      const legalIds = dictionaryValueIdSet(legalValues);
      if (hasValue && row.dictionary) {
        const invalid = !valueIds.length || (legalIds.size > 0 && valueIds.some((id) => !legalIds.has(id)));
        if (invalid) status = "invalid_dictionary";
      }
      if (status === "ok" && row.aspect && duplicateAspectOffers.has(offerId)) {
        status = "duplicate_variant";
      }
      const repairGuidance = matrixCellRepairGuidance({
        status,
        row,
        offerId,
        attribute,
        legalValues,
        sourceSuggestedAspect: sourceSuggestedAspectByCell.get(`${offerId}:${row.attributeId}`),
      });
      return {
        offerId,
        status,
        value: hasValue || "",
        dictionaryValueIds: valueIds,
        repairGuidance: repairGuidance || undefined,
      };
    });
    return { ...row, cells, meta: undefined };
  });
  const hasMultipleItems = items.length > 1;
  const hasAspectMeta = attrsMeta.some((meta) => meta?.is_aspect && Number(meta?.id || 0));
  if (hasMultipleItems && !hasAspectMeta) {
    rows.push({
      attributeId: 0,
      name: "Ozon 可变特性元数据",
      kind: "variant_aspect_missing_metadata",
      required: true,
      aspect: true,
      dictionary: false,
      cells: offers.map((offerId) => ({
        offerId,
        status: "missing_variant_aspect_metadata",
        value: "当前类目没有可用于区分变体的 aspect 属性元数据",
        dictionaryValueIds: [],
        repairGuidance: matrixCellRepairGuidance({
          status: "missing_variant_aspect_metadata",
          row: { attributeId: 0, name: "Ozon 可变特性元数据" },
          offerId,
        }),
      })),
    });
  }
  const blockedStatuses = new Set(["missing", "invalid_dictionary", "duplicate_variant"]);
  blockedStatuses.add("missing_variant_aspect_metadata");
  const blockedCellCount = rows.reduce((count, row) => count + row.cells.filter((cell) => blockedStatuses.has(cell.status)).length, 0);
  return {
    offers,
    rows,
    summary: {
      offerCount: offers.length,
      attributeCount: rows.length,
      blockedCellCount,
      missingCellCount: rows.reduce((count, row) => count + row.cells.filter((cell) => cell.status === "missing").length, 0),
      invalidDictionaryCellCount: rows.reduce((count, row) => count + row.cells.filter((cell) => cell.status === "invalid_dictionary").length, 0),
      duplicateVariantCellCount: rows.reduce((count, row) => count + row.cells.filter((cell) => cell.status === "duplicate_variant").length, 0),
      missingVariantAspectMetadata: rows.some((row) => row.kind === "variant_aspect_missing_metadata"),
    },
  };
}

export function buildVariantGroupingDiagnosis(input = {}) {
  const items = Array.isArray(input.items) ? input.items : payloadItems(input.submitPayload || {});
  const attrsMeta = Array.isArray(input.attrsMeta) ? input.attrsMeta : [];
  const modelAttributeIds = attrsMeta
    .filter((meta) => /название модели.*объедин|model.*(?:group|card)|模型名称|型号名称/i.test(String(meta?.name || "")))
    .map((meta) => Number(meta.id || 0))
    .filter(Boolean);
  const aspectMeta = attrsMeta.filter((meta) => meta?.is_aspect && Number(meta?.id || 0));
  const aspectAttributeIds = aspectMeta.map((meta) => Number(meta.id));
  const metaById = new Map(attrsMeta.map((meta) => [Number(meta?.id || 0), meta]));
  const rows = items.map((item, index) => {
    const attributes = Array.isArray(item?.attributes) ? item.attributes : [];
    const modelValues = attributes
      .filter((attribute) => modelAttributeIds.includes(Number(attribute?.id || 0)))
      .map(attributeDisplayValue)
      .filter(Boolean);
    const aspects = attributes
      .filter((attribute) => aspectAttributeIds.includes(Number(attribute?.id || 0)))
      .map((attribute) => ({
        id: Number(attribute.id),
        name: String(metaById.get(Number(attribute.id))?.name || `属性 ${Number(attribute.id)}`),
        value: attributeDisplayValue(attribute),
        signature: attributeValueSignature(attribute),
      }))
      .sort((left, right) => left.id - right.id);
    const presentAspectIds = new Set(aspects.map((aspect) => Number(aspect.id || 0)).filter(Boolean));
    const missingAspects = items.length > 1
      ? aspectMeta
        .filter((meta) => Number(meta?.id || 0) && !presentAspectIds.has(Number(meta.id || 0)))
        .map((meta) => ({
          id: Number(meta.id || 0),
          name: String(meta.name || `属性 ${Number(meta.id || 0)}`),
        }))
      : [];
    return {
      itemIndex: index,
      offerId: String(item?.offer_id || ""),
      modelValue: modelValues.join(" / "),
      aspects,
      missingAspects,
      aspectSignature: aspects.map((aspect) => `${aspect.id}:${aspect.signature}`).join("|"),
      duplicateGroup: "",
    };
  });
  const grouped = new Map();
  for (const row of rows) {
    if (!row.aspectSignature) continue;
    if (!grouped.has(row.aspectSignature)) grouped.set(row.aspectSignature, []);
    grouped.get(row.aspectSignature).push(row);
  }
  const duplicateGroups = [];
  for (const [signature, groupRows] of grouped.entries()) {
    if (groupRows.length < 2) continue;
    const groupId = `duplicate-${duplicateGroups.length + 1}`;
    groupRows.forEach((row) => { row.duplicateGroup = groupId; });
    duplicateGroups.push({ id: groupId, signature, offerIds: groupRows.map((row) => row.offerId) });
  }
  return {
    modelAttributeIds,
    aspectAttributeIds,
    rows,
    duplicateGroups,
    repairable: rows.length > 1 && items.length === rows.length,
  };
}

export function buildVariantConfigurationSummary(input = {}) {
  const payload = input.payload || input.submitPayload || {};
  const items = payloadItems(payload);
  const attrsMeta = Array.isArray(input.attrsMeta) ? input.attrsMeta : [];
  const sourceVariants = Array.isArray(input.sourceVariants) ? input.sourceVariants : [];
  const grouping = buildVariantGroupingDiagnosis({ items, attrsMeta });
  const duplicateOffers = new Set((grouping.duplicateGroups || []).flatMap((group) => group.offerIds || []));
  const firstImageCounts = new Map();
  for (const item of items) {
    const first = imageSignature((item.images || [])[0] || "");
    if (!first) continue;
    firstImageCounts.set(first, (firstImageCounts.get(first) || 0) + 1);
  }
  const pricingByOffer = pricingRiskByOffer(input.pricing || input.pricingDiagnosis || {});
  const rows = (grouping.rows || []).map((row, index) => {
    const item = items[index] || {};
    const offerId = String(item.offer_id || row.offerId || "");
    const sourceVariant = sourceVariantForRow(sourceVariants, row, index, offerId);
    const suggestedAspects = sourceVariantAspectSuggestions({
      row,
      sourceVariant,
      attrsMeta,
    });
    const firstImage = imageSignature((item.images || [])[0] || "");
    const reasons = [];
    let rowStatus = "valid";
    const missingAspects = Array.isArray(row.missingAspects) ? row.missingAspects : [];
    const pricingRisk = pricingByOffer.get(offerId) || pricingByOffer.get("*") || null;
    if (pricingRisk) {
      rowStatus = "pricing_blocked";
      reasons.push({
        code: "PRICING_BLOCKED",
        message: pricingRisk.message || "该 SKU 存在定价阻塞，不能继续提交。",
      });
    }
    if (missingAspects.length) {
      rowStatus = rowStatus === "valid" ? "missing_aspect" : rowStatus;
      const missingLabel = missingAspects.map((aspect) => aspect.name || `属性 ${aspect.id || ""}`).filter(Boolean).join("、");
      reasons.push({ code: "MISSING_ASPECT", message: `缺少 Ozon 可变特性${missingLabel ? `：${missingLabel}` : ""}，无法确认变体合并。` });
    }
    if (duplicateOffers.has(offerId)) {
      rowStatus = rowStatus === "pricing_blocked" ? rowStatus : "duplicate_aspect";
      reasons.push({ code: "DUPLICATE_ASPECT", message: "可变特性组合重复，Ozon 可能无法合并为正确商品卡。" });
    }
    const skuImage = {
      status: "unique",
      url: (item.images || [])[0] || "",
      message: "SKU 图已区分。",
    };
    if (!skuImage.url) {
      skuImage.status = "missing";
      skuImage.message = "缺少 SKU 图。";
      if (rowStatus === "valid") rowStatus = "missing_image";
      reasons.push({ code: "SKU_IMAGE_MISSING", message: "缺少 SKU 图，建议补齐后重新预检。" });
    } else if (items.length > 1 && firstImageCounts.get(firstImage) > 1) {
      skuImage.status = "not_unique";
      skuImage.message = "SKU 图未区分。";
      reasons.push({ code: "SKU_IMAGE_NOT_UNIQUE", message: "多个 SKU 使用相同首图，建议补区分图。" });
    }
    const repairSuggestions = variantRepairSuggestions({ ...row, missingAspects, suggestedAspects }, reasons, skuImage);
    return {
      offerId,
      modelName: row.modelValue || "",
      aspects: row.aspects || [],
      missingAspects,
      sourceVariant: sourceVariant || undefined,
      suggestedAspects,
      aspectSignature: row.aspectSignature || "",
      duplicateGroup: row.duplicateGroup || "",
      skuImage,
      rowStatus,
      reasons,
      repairSuggestions,
      safeNextAction: safeVariantNextAction(rowStatus, reasons),
    };
  });
  const differenceSuggestions = variantGroupDifferenceSuggestions(grouping);
  const sourceVariantBinding = buildSourceVariantBindingSummary({ payload, sourceVariants });
  return {
    rows,
    differenceSuggestions,
    sourceVariantBinding,
    summary: variantCoverageSummary(rows, grouping, differenceSuggestions),
  };
}

export function buildVariantGroupingRepairDraft(input = {}) {
  const originalItems = payloadItems(input.originalPayload || {});
  const expectedOffers = [...new Set((input.skuOffers || []).map((offer) => String(offer || "").trim()).filter(Boolean))];
  const actualOffers = new Set(originalItems.map((item) => String(item?.offer_id || "").trim()).filter(Boolean));
  const missingOfferIds = expectedOffers.filter((offer) => !actualOffers.has(offer));
  if (missingOfferIds.length || originalItems.length < 2) {
    return {
      ok: false,
      code: "INCOMPLETE_VARIANT_GROUP",
      message: `修复草稿缺少整组 SKU：${missingOfferIds.join("、") || "至少需要两个 SKU"}`,
      missingOfferIds,
    };
  }
  return {
    ok: true,
    payload: { items: JSON.parse(JSON.stringify(originalItems)) },
    offerIds: originalItems.map((item) => String(item?.offer_id || "")),
  };
}

export function validateVariantAspectUniqueness(items = [], attrsMeta = []) {
  if ((items || []).length < 2 || !(attrsMeta || []).length) return [];
  const aspectIds = new Set((attrsMeta || [])
    .filter((meta) => meta?.is_aspect && Number(meta?.id || 0))
    .map((meta) => Number(meta.id)));
  if (!aspectIds.size) {
    return [{ code: "NO_VARIANT_ASPECT_METADATA", message: "当前 Ozon 类目没有可用于区分变体的 aspect 属性。" }];
  }
  const issues = [];
  const offersBySignature = new Map();
  for (const item of items || []) {
    const offerId = String(item?.offer_id || "").trim();
    const signature = (item.attributes || [])
      .filter((attribute) => aspectIds.has(Number(attribute?.id || 0)))
      .map((attribute) => `${Number(attribute.id)}:${attributeValueSignature(attribute)}`)
      .filter((value) => !value.endsWith(":"))
      .sort()
      .join("|");
    if (!signature) {
      issues.push({ code: "MISSING_VARIANT_ASPECT", offerId, message: `${offerId || "变体"} 缺少 Ozon 可变特性。` });
      continue;
    }
    if (!offersBySignature.has(signature)) offersBySignature.set(signature, []);
    offersBySignature.get(signature).push(offerId);
  }
  for (const offers of offersBySignature.values()) {
    if (offers.length < 2) continue;
    issues.push({
      code: "DUPLICATE_VARIANT_ASPECTS",
      offerIds: offers,
      message: `变体的 Ozon 可变特性重复：${offers.join("、")}`,
    });
  }
  return issues;
}

export function validateSubmitPayload(payload = {}, { attrsMeta = [] } = {}) {
  const items = payloadItems(payload);
  const issues = [];
  if (!items.length) issues.push({ code: "EMPTY_PAYLOAD", message: "payload 没有可提交 item" });
  const seen = new Set();
  for (const item of items) {
    const offerId = String(item.offer_id || "").trim();
    if (!offerId) issues.push({ code: "MISSING_OFFER_ID", message: "缺少 offer_id" });
    if (offerId && seen.has(offerId)) issues.push({ code: "DUPLICATE_OFFER_ID", offerId, message: "offer_id 重复" });
    seen.add(offerId);
    if (!String(item.name || "").trim()) issues.push({ code: "MISSING_NAME", offerId, message: "缺少标题" });
    if (/[\u3400-\u9fff]/.test(String(item.name || ""))) issues.push({ code: "CHINESE_IN_TITLE", offerId, message: "标题含中文" });
    if (!Number(item.description_category_id || 0) || !Number(item.type_id || 0)) issues.push({ code: "MISSING_CATEGORY", offerId, message: "缺少 Ozon 类目或类型" });
    if (!Number(item.price || 0)) issues.push({ code: "MISSING_PRICE", offerId, message: "缺少价格" });
    if (!Array.isArray(item.images) || item.images.length < 3) issues.push({ code: "IMAGES_TOO_FEW", offerId, message: "图片少于 3 张" });
    if (!hasAttr(item, 85)) issues.push({ code: "MISSING_BRAND", offerId, message: "缺少品牌属性 85" });
    const modelIds = (attrsMeta || [])
      .filter((meta) => /название модели.*объедин|model.*(?:group|card)|模型名称|型号名称/i.test(String(meta?.name || "")))
      .map((meta) => Number(meta.id || 0))
      .filter(Boolean);
    const requiredModelIds = modelIds.length ? modelIds : [9048];
    if (!requiredModelIds.some((id) => hasAttr(item, id))) {
      issues.push({ code: "MISSING_MODEL_NAME", offerId, attributeIds: requiredModelIds, message: `缺少模型名称属性 ${requiredModelIds.join("/")}` });
    }
  }
  issues.push(...validateVariantAspectUniqueness(items, attrsMeta));
  return { ok: issues.length === 0, issues };
}

function listingQualityIssues(listingQuality = null) {
  if (!listingQuality || typeof listingQuality !== "object") return [];
  return (listingQuality.blockedReasons || []).map((reason) => ({
    code: `LISTING_QUALITY_${String(reason.code || "BLOCKED").toUpperCase()}`,
    message: reason.message || "上架质量诊断存在阻塞项。",
    source: "listing_quality",
    offerId: reason.offerId || "",
    attributeId: reason.attributeId || 0,
    qualityCode: reason.code || "",
    enteredValues: Array.isArray(reason.enteredValues) ? reason.enteredValues : [],
    dictionaryCandidates: Array.isArray(reason.dictionaryCandidates) ? reason.dictionaryCandidates : [],
  }));
}

function listingAttributeMatrixIssues(attributeMatrix = null) {
  const issues = [];
  if (attributeMatrix?.summary?.missingVariantAspectMetadata) {
    issues.push({
      code: "NO_VARIANT_ASPECT_METADATA",
      message: "当前多 SKU payload 缺少 Ozon 可变特性元数据，不能确认变体合并。",
      source: "attribute_matrix",
    });
  }
  return issues;
}

function variantConfigurationIssues(variantConfiguration = null) {
  if (!variantConfiguration || typeof variantConfiguration !== "object") return [];
  const rows = Array.isArray(variantConfiguration.rows) ? variantConfiguration.rows : [];
  return rows
    .filter((row) => row?.rowStatus === "missing_aspect")
    .map((row) => ({
      code: "MISSING_VARIANT_ASPECT",
      message: "SKU 缺少 Ozon 可变特性，不能提交 Ozon。",
      source: "variant_configuration",
      offerId: row.offerId || "",
      missingAspectIds: (row.missingAspects || []).map((aspect) => Number(aspect.id || 0)).filter(Boolean),
      suggestedAspects: Array.isArray(row.suggestedAspects) ? row.suggestedAspects : [],
    }));
}

function staleRichContentMediaApprovalIssues(payload = {}, workflowRun = null) {
  const hasRichContent = payloadItems(payload).some((item) => (
    item?.rich_content_json || item?.richContentJson || item?.rich_content || item?.richContent
  ));
  const approval = workflowRun?.mediaApprovalDraft;
  if (!hasRichContent || !approval) return [];
  const currentDraftHash = hashPayloadDraft(payload);
  const sourceHash = String(approval.expectedSourceHash || "");
  const bindingCurrent = approval.status === "published_local"
    && approval.expectedDraftHash === currentDraftHash
    && /^sha256:[a-f0-9]{64}$/i.test(sourceHash)
    && approval.richContentDetailAssetsApproved === true;
  if (bindingCurrent) return [];
  return [{
    code: "RICH_CONTENT_MEDIA_APPROVAL_STALE",
    message: "富内容媒体批准已陈旧或未绑定当前草稿，必须重新审查后才能提交 Ozon。",
    source: "media_approval",
  }];
}

function categoryMatchFromPayload(payload = {}) {
  const item = payloadItems(payload)[0] || {};
  return {
    description_category_id: Number(item.description_category_id || 0),
    type_id: Number(item.type_id || 0),
    path: "",
  };
}

function packageInfoFromPayload(payload = {}) {
  const item = payloadItems(payload)[0] || {};
  return {
    weight: Number(item.weight || item.weightG || item.weight_g || 0),
    depth: Number(item.depth || item.length || item.lengthMm || item.length_mm || 0),
    width: Number(item.width || item.widthMm || item.width_mm || 0),
    height: Number(item.height || item.heightMm || item.height_mm || 0),
  };
}

function modelNameFromPayload(payload = {}, attrsMeta = []) {
  const item = payloadItems(payload)[0] || {};
  const modelIds = (attrsMeta || [])
    .filter((meta) => /название модели.*объедин|model.*(?:group|card)|模型名称|型号名称/i.test(String(meta?.name || "")))
    .map((meta) => Number(meta.id || 0))
    .filter(Boolean);
  const ids = modelIds.length ? modelIds : [9048];
  const attribute = (item.attributes || []).find((entry) => ids.includes(Number(entry?.id || 0)));
  return attributeDisplayValue(attribute || {});
}

function productTextFromPayload(payload = {}, contentSummary = {}) {
  const items = payloadItems(payload);
  return [
    contentSummary.productText || "",
    contentSummary.title || "",
    contentSummary.description || "",
    ...items.map((item) => `${item.name || ""} ${item.description || ""}`),
  ].filter(Boolean).join(" ");
}

function buildRequiredAttributePlanForPayload(payload = {}, options = {}) {
  const attrsMeta = Array.isArray(options.attrsMeta) ? options.attrsMeta : [];
  if (!attrsMeta.length) return [];
  return buildRequiredAttributeFillPlan({
    categoryMatch: options.categoryMatch || categoryMatchFromPayload(payload),
    attrsMeta,
    attributeValuesById: options.dictionaryValuesByAttributeId || {},
    categoryCache: { attributeValues: options.dictionaryValueCache || {} },
    modelName: options.modelName || modelNameFromPayload(payload, attrsMeta),
    productText: productTextFromPayload(payload, options.contentSummary || {}),
    packageInfo: options.packageInfo || packageInfoFromPayload(payload),
  });
}

function buildPayloadDraftValidation(payload = {}, options = {}) {
  const payloadValidation = validateSubmitPayload(payload, { attrsMeta: options.attrsMeta || [] });
  const attributeMatrix = buildListingAttributeMatrix({
    payload,
    attrsMeta: options.attrsMeta || [],
    dictionaryValueCache: options.dictionaryValueCache || {},
    dictionaryLanguage: options.dictionaryLanguage || "ZH_HANS",
    dictionaryValuesByAttributeId: options.dictionaryValuesByAttributeId || {},
    sourceVariants: options.sourceVariants || options.skuVariants || [],
  });
  const listingQuality = diagnoseListingQuality({
    payload,
    attrsMeta: options.attrsMeta || [],
    pricing: options.pricing || null,
    workflowRun: options.workflowRun || null,
    dictionaryValueCache: options.dictionaryValueCache || {},
    dictionaryLanguage: options.dictionaryLanguage || "ZH_HANS",
    dictionaryValuesByAttributeId: options.dictionaryValuesByAttributeId || {},
  });
  const variantConfiguration = buildVariantConfigurationSummary({
    payload,
    attrsMeta: options.attrsMeta || [],
    pricing: options.pricing || null,
    sourceVariants: options.sourceVariants || options.skuVariants || [],
  });
  const qualityIssues = listingQualityIssues(listingQuality);
  const matrixIssues = listingAttributeMatrixIssues(attributeMatrix);
  const variantIssues = variantConfigurationIssues(variantConfiguration);
  const mediaApprovalIssues = staleRichContentMediaApprovalIssues(payload, options.workflowRun || null);
  const issues = [...(payloadValidation.issues || []), ...qualityIssues, ...matrixIssues, ...variantIssues, ...mediaApprovalIssues];
  const requiredAttributeFillPlan = buildRequiredAttributePlanForPayload(payload, options);
  const requiredAttributeFillSummary = summarizeRequiredAttributeFillPlan(requiredAttributeFillPlan);
  const requiredAttributeManualBacklog = buildRequiredAttributeManualBacklog(requiredAttributeFillPlan);
  const requiredAttributeRuleCandidateIndex = buildRequiredAttributeRuleCandidateIndex({
    categoryMatch: options.categoryMatch || categoryMatchFromPayload(payload),
    manualBacklog: requiredAttributeManualBacklog,
    fillPlan: requiredAttributeFillPlan,
  });
  // Keep the same seller-facing contract on the persisted validation response
  // as on the preflight workflow node.  The listing page normally reads this
  // response after an explicit recheck, so omitting it here forced the UI to
  // fall back to raw issue codes and lost the action/side-effect/result text.
  const sellerResult = buildPreflightSellerResult({ issues, payload });
  return {
    ...payloadValidation,
    ok: issues.length === 0,
    issues,
    listingQuality,
    listingQualityWarnings: Array.isArray(listingQuality.warnings) ? listingQuality.warnings : [],
    attributeMatrix,
    requiredAttributeFillPlan,
    requiredAttributeFillSummary,
    requiredAttributeManualBacklog,
    requiredAttributeRuleCandidateIndex,
    variantConfiguration,
    sellerResult,
  };
}

// A workflow created by the 1688 auto-listing path has a stronger preflight
// policy than the generic Payload shape checks.  Keep that policy attached to
// the preflight node so a later "校验 Payload" or submit request cannot fall
// back to the weaker validator after a seller edits the draft.  Older/manual
// local runs have no policy and intentionally retain the compatibility path.
function buildPayloadDraftValidationForRun(run = {}, payload = {}, dictionaryValueCache = {}) {
  const preflightNode = workflowNodeByKey(run, "preflight_check");
  const policy = preflightNode?.output?.preflightPolicy;
  const legacy1688 = String(run.entity?.source || "").trim().toLowerCase() === "1688";
  if (!policy?.enforced && !legacy1688) {
    return { validation: buildPayloadDraftValidation(payload, {
      attrsMeta: run.payloadDraftAttrsMeta || [],
      sourceVariants: run.payloadDraftSourceVariants || [],
      workflowRun: run,
      dictionaryValueCache,
    }), gateNode: null };
  }
  // Older 1688 runs may predate the persisted policy.  They must fail closed
  // instead of silently using the generic validator; the missing evidence is
  // intentionally surfaced as a seller repair task.
  const effectivePolicy = policy?.enforced ? policy : {
    enforced: true,
    sourceEvidence: run.entity?.sourceEvidence || null,
    sourceEvidenceRequired: true,
    sourceIdentityRequired: true,
    sourceVariantBindingRequired: true,
    categoryEvidenceRequired: true,
    contentSummary: {},
    variantCount: payloadItems(payload).length,
  };
  const gateNode = buildPreflightGateNode({
    payload,
    attrsMeta: run.payloadDraftAttrsMeta || [],
    sourceVariants: run.payloadDraftSourceVariants || [],
    dictionaryValueCache,
    contentSummary: effectivePolicy.contentSummary || {},
    category: effectivePolicy.category || null,
    variantCount: Number(effectivePolicy.variantCount || payloadItems(payload).length || 0),
    sourceEvidence: effectivePolicy.sourceEvidence || null,
    sourceEvidenceRequired: effectivePolicy.sourceEvidenceRequired === true,
    sourceIdentityRequired: effectivePolicy.sourceIdentityRequired === true,
    sourceVariantBindingRequired: effectivePolicy.sourceVariantBindingRequired === true,
    sourceVariantEvidenceRequired: effectivePolicy.sourceVariantEvidenceRequired === true,
    categoryEvidence: effectivePolicy.categoryEvidence || null,
    categoryEvidenceRequired: effectivePolicy.categoryEvidenceRequired === true,
    categoryEvidenceStoreId: effectivePolicy.categoryEvidenceStoreId || "",
    categoryEvidenceEnvironmentRefHash: effectivePolicy.categoryEvidenceEnvironmentRefHash || "",
    categoryEvidenceMaxAgeMs: effectivePolicy.categoryEvidenceMaxAgeMs,
    pricing: effectivePolicy.pricingDiagnosis || null,
  });
  return { validation: gateNode.output, gateNode };
}

// Convert technical preflight issues into an actionable seller contract.
// This is intentionally read-only: repairs never mutate a draft or call Ozon.
export function buildReviewRepairDraft({ taskId = "", skuOffers = [], importedItems = [], importErrors = [], submitPayload = {} } = {}) {
  const offerIds = [...new Set((Array.isArray(skuOffers) ? skuOffers : []).map((id) => String(id || "").trim()).filter(Boolean))];
  const errors = Array.isArray(importErrors) ? importErrors : [];
  const importedByOffer = new Map((Array.isArray(importedItems) ? importedItems : [])
    .map((item) => [String(item?.offer_id || item?.offerId || "").trim(), item])
    .filter(([offerId]) => offerId));
  const repairs = errors.map((error) => {
    const offerId = String(error?.offer_id || error?.offerId || "").trim();
    const imported = importedByOffer.get(offerId) || null;
    const productId = Number(error?.product_id || error?.productId || imported?.product_id || imported?.productId || 0) || null;
    const attributeId = String(error?.attribute_id || error?.attributeId || "").trim();
    return { offerId, productId, code: String(error?.code || "REVIEW_ERROR"), message: String(error?.message || "审核问题需要人工确认"), fieldPath: offerId ? `items[offer_id=${offerId}].attributes${attributeId ? `[id=${attributeId}]` : ""}` : "items[*]", valueProvided: false, action: "按字段修复本地草稿后重新预检" };
  });
  if (!repairs.length && importedItems.some((item) => item?.offer_id)) repairs.push(...importedItems.map((item) => ({ offerId: String(item.offer_id), productId: Number(item?.product_id || item?.productId || 0) || null, code: "MODERATION_FAILED", message: "审核失败，需要人工确认具体字段", fieldPath: `items[offer_id=${String(item.offer_id)}]`, valueProvided: false, action: "定位 Offer 字段后修复并重新预检" })));
  return { ok: true, status: "pending_manual_repair", taskId, offerIds, repairs, workflow: { draft: "保存本地修复草稿并生成新 hash", preflight: "修复后重新预检", confirmation: "通过预检后人工确认提交", readback: "按 task_id/product_id/Offer 再次只读回查" }, sideEffect: "仅生成本地修复草稿，不会修改 Ozon、价格或库存。", result: "尚未重新预检，等待人工修复。", submitPayload };
}

export function buildPreflightSellerResult({
  issues = [],
  payload = {},
  sourceVariantBinding = null,
  variantConfiguration = null,
  sourceEvidence = null,
  sourceEvidenceRequired = false,
  categoryEvidence = null,
  categoryEvidenceRequired = false,
  contentEvidence = null,
} = {}) {
  const items = payloadItems(payload);
  const itemIndexForIssue = (issue = {}) => {
    const offerId = String(issue.offerId || issue.offer_id || "").trim();
    if (!offerId) return -1;
    return items.findIndex((item) => String(item?.offer_id || item?.offerId || "").trim() === offerId);
  };
  const fieldPathForIssue = (issue = {}) => {
    const index = itemIndexForIssue(issue);
    const itemPath = index >= 0 ? `items[${index}]` : "items[*]";
    const code = String(issue.code || "");
    // listing quality diagnostics are wrapped as LISTING_QUALITY_* issues.
    // Keep the original quality code when choosing a field; otherwise a
    // seller only sees the generic `listingQuality` bucket and cannot tell
    // which SKU/image/attribute needs repair.
    const qualityCode = String(issue.qualityCode || "").trim();
    if (code === "EMPTY_PAYLOAD") return "items";
    if (["MISSING_OFFER_ID", "DUPLICATE_OFFER_ID"].includes(code)) return `${itemPath}.offer_id`;
    if (["MISSING_NAME", "CHINESE_IN_TITLE"].includes(code)) return `${itemPath}.name`;
    if (code === "MISSING_CATEGORY") return `${itemPath}.description_category_id / ${itemPath}.type_id`;
    if (code === "MISSING_PRICE") return `${itemPath}.price`;
    if (["IMAGES_TOO_FEW", "SOURCE_IMAGES_TOO_FEW"].includes(code)) return `${itemPath}.images`;
    if (["MISSING_BRAND", "MISSING_MODEL_NAME", "MISSING_VARIANT_ASPECT", "DUPLICATE_VARIANT_ASPECTS"].includes(code)) return `${itemPath}.attributes`;
    if (["SOURCE_EVIDENCE_MISSING", "SOURCE_EVIDENCE_NOT_VERIFIED", "SOURCE_IDENTITY_MISSING"].includes(code)) return "sourceEvidence.snapshotHash / sourceEvidence.verificationState / sourceEvidence.canonicalUrl / sourceEvidence.offerId";
    if (code === "SOURCE_SKU_BINDING_MISSING") return "sourceVariants[].offerId / sourceVariants[].skuId";
    if (code === "CATEGORY_MATCH_MISSING") return "category.description_category_id / category.type_id";
    if (code === "CATEGORY_EVIDENCE_MISSING") return "categoryEvidence.tree / categoryEvidence.attributes";
    if (code === "SOURCE_SIZE_WEIGHT_MISSING") return "contentSummary.sizeWeightReady";
    if (code === "CONTENT_ISSUE") return "contentSummary.contentIssues";
    if (code === "DUPLICATE_LISTING") return "duplicate.duplicateJobId / duplicate.duplicateSku";
    if (code === "RICH_CONTENT_MEDIA_APPROVAL_STALE") return "workflowRun.mediaApprovalDraft";
    if (qualityCode === "PRODUCT_IMAGES_TOO_FEW") return `${itemPath}.images`;
    if (["REQUIRED_ATTRIBUTE_MISSING", "DICTIONARY_VALUE_INVALID"].includes(qualityCode)) {
      const attributeId = Number(issue.attributeId || 0);
      return `${itemPath}.attributes${attributeId ? `[id=${attributeId}]` : ""}`;
    }
    return issue.source === "listing_quality" ? "listingQuality" : "payload";
  };
  const actionForIssue = (issue = {}) => {
    const code = String(issue.code || "");
    const qualityCode = String(issue.qualityCode || "").trim();
    if (["SOURCE_EVIDENCE_MISSING", "SOURCE_EVIDENCE_NOT_VERIFIED", "SOURCE_IDENTITY_MISSING"].includes(code)) return "重新采集并人工确认 1688 来源商品身份、快照 URL 和 Offer，再回到草稿预检。";
    if (code === "SOURCE_SKU_BINDING_MISSING") return "逐个绑定 1688 SKU 与 Ozon offer，再重新预检。";
    if (["CATEGORY_MATCH_MISSING", "MISSING_CATEGORY"].includes(code)) return "选择并保存可信的 Ozon 类目和类型，再重新预检。";
    if (code === "CATEGORY_EVIDENCE_MISSING") return "重新读取当前店铺的 Ozon 类目和属性证据，再重新预检；不会使用旧缓存冒充当前证据。";
    if (code === "MISSING_PRICE") return "补齐当前 SKU 的售价和定价证据，再重新预检。";
    if (["IMAGES_TOO_FEW", "SOURCE_IMAGES_TOO_FEW"].includes(code)) return "补齐至少 3 张合规商品图，再重新预检。";
    if (["MISSING_BRAND", "MISSING_MODEL_NAME", "MISSING_VARIANT_ASPECT"].includes(code)) return "补齐对应属性或变体值，再重新预检。";
    if (code === "DUPLICATE_VARIANT_ASPECTS") return "调整重复 SKU 的变体组合，确保每组属性唯一后重新预检。";
    if (code === "DUPLICATE_LISTING") return "人工确认是否已有重复上架任务，取消或改用新的来源后再预检。";
    if (code === "CONTENT_ISSUE") return "按内容问题修正俄文标题、描述或属性，再重新预检。";
    if (code === "SOURCE_SIZE_WEIGHT_MISSING") return "补充有来源证据的包装尺重，再重新预检。";
    if (qualityCode === "PRODUCT_IMAGES_TOO_FEW") return "为该 SKU 补齐至少 3 张产品图，再重新预检。";
    if (qualityCode === "REQUIRED_ATTRIBUTE_MISSING") return "补齐该 SKU 标出的 Ozon 必填属性，再重新预检。";
    if (qualityCode === "DICTIONARY_VALUE_INVALID") return "为该 SKU 的属性选择当前类目合法字典值，再重新预检。";
    return "按字段提示修复本地草稿，再重新预检。";
  };
  const sideEffect = "仅本地预检，不会写入 Ozon 或扣费。按建议修复草稿后必须重新预检。";
  const repairs = (Array.isArray(issues) ? issues : []).map((issue) => {
    const fieldPath = fieldPathForIssue(issue);
    const attributeId = Number(issue.attributeId || issue.attribute_id || 0) || null;
    return {
      code: String(issue.code || "PREFLIGHT_BLOCKED"),
      offerId: String(issue.offerId || issue.offer_id || ""),
      fieldPath,
      // A compact, seller-facing target summary. It is deliberately a
      // locator only: no value is inferred and no local/Ozon write occurs.
      repairTarget: {
        fieldPath,
        attributeId,
        enteredValues: Array.isArray(issue.enteredValues) ? issue.enteredValues.slice(0, 10) : [],
        candidateCount: Array.isArray(issue.dictionaryCandidates) ? issue.dictionaryCandidates.length : 0,
      },
      message: String(issue.message || "预检发现需要人工处理的字段。"),
      action: actionForIssue(issue),
      sideEffect,
      result: "本次未提交 Ozon；修复后需生成新的预检结果。",
    };
  });
  const binding = sourceVariantBinding || buildSourceVariantBindingSummary({ payload, sourceVariants: [] });
  const rows = Array.isArray(variantConfiguration?.rows) ? variantConfiguration.rows : items.map((item) => ({ offerId: String(item?.offer_id || ""), rowStatus: "unknown", sourceVariant: null }));
  const variantCoverage = items.length <= 1
    ? { status: "single_sku", sourceBinding: binding.summary, rows, nextAction: "单 SKU 通过字段预检后进入人工确认。" }
    : { status: binding.summary.ready && rows.every((row) => row.rowStatus === "valid") ? "ready" : "blocked", sourceBinding: binding.summary, rows: rows.map((row) => ({ offerId: row.offerId, sourceSkuId: row.sourceVariant?.sourceSkuId || "", sourceSpec: row.sourceVariant?.spec || "", status: row.rowStatus || "unknown", blockers: row.rowStatus === "valid" ? [] : ["VARIANT_COVERAGE_INCOMPLETE"] })), nextAction: binding.summary.ready ? "补齐变体字段后重新预检，再进入人工确认。" : "逐条来源绑定 1688 SKU 并修复变体后重新预检。", sideEffect: "不会提交 Ozon 或写入库存。" };
  if (!repairs.length && variantCoverage.status === "blocked") repairs.push({ code: "VARIANT_COVERAGE_INCOMPLETE", offerId: "", fieldPath: "items[*].attributes", message: "多 SKU 来源绑定或变体覆盖不完整。", action: variantCoverage.nextAction, sideEffect, result: "本次未提交 Ozon；修复后需重新预检。" });
  const blocked = repairs.length > 0 || variantCoverage.status === "blocked";
  const sourceHash = String(sourceEvidence?.snapshotHash || "").trim();
  const sourceVerified = /^sha256:[a-f0-9]{64}$/i.test(sourceHash)
    && String(sourceEvidence?.verificationState || "").trim() === "ok";
  const sourceStatus = sourceVerified
    ? "verified"
    : sourceEvidenceRequired
      ? (sourceHash ? "needs_review" : "missing")
      : "not_required";
  const sourceNextAction = sourceStatus === "verified"
    ? "1688 来源快照已验证，可继续核对 SKU 与内容。"
    : sourceStatus === "needs_review"
      ? "人工打开 1688 页面并确认快照不是登录/验证码页，再重新预检。"
      : sourceStatus === "missing"
        ? "重新采集并人工验证 1688 来源快照，再回到草稿预检。"
        : "当前预检未要求 1688 来源快照。";
  const contentStatus = contentEvidence && typeof contentEvidence === "object"
    ? (String(contentEvidence.status || "") === "reviewed" && !(contentEvidence.blockerCodes || []).length ? "verified" : "needs_review")
    : "not_required";
  const contentNextAction = contentStatus === "verified"
    ? "俄文内容已完成逐字段事实复核。"
    : contentStatus === "needs_review"
      ? "逐字段核对俄文标题、描述和属性与 1688 来源事实，再重新预检。"
      : "当前预检未返回俄文内容证据。";
  const categoryEntries = [categoryEvidence?.tree, categoryEvidence?.attributes].filter(Boolean);
  const categoryStatus = !categoryEvidenceRequired
    ? "not_required"
    : categoryEntries.length === 2 && categoryEntries.every((entry) => String(entry?.verificationLevel || "") === "server_observed")
      ? "verified"
      : "missing";
  const categoryNextAction = categoryStatus === "verified"
    ? "当前店铺类目与属性读取证据已记录。"
    : categoryStatus === "missing"
      ? "重新读取当前店铺的类目和属性证据，不能用旧缓存代替。"
      : "当前预检未要求店铺类目读取证据。";
  const evidenceSummary = {
    source: { status: sourceStatus, snapshotHash: sourceHash, nextAction: sourceNextAction },
    content: { status: contentStatus, blockerCodes: Array.isArray(contentEvidence?.blockerCodes) ? contentEvidence.blockerCodes.slice(0, 12) : [], nextAction: contentNextAction },
    category: { status: categoryStatus, nextAction: categoryNextAction },
    sku: { status: variantCoverage.status, nextAction: variantCoverage.nextAction },
  };
  const firstEvidenceBlocker = [evidenceSummary.source, evidenceSummary.content, evidenceSummary.category, evidenceSummary.sku]
    .find((entry) => ["missing", "needs_review", "blocked"].includes(entry.status));
  return {
    status: blocked ? "blocked" : "ready_for_confirmation",
    outcome: blocked ? "submission_not_started" : "preflight_passed",
    blockerCount: repairs.length,
    repairs,
    repairSummary: {
      total: repairs.length,
      fieldTargets: [...new Set(repairs.map((repair) => repair.fieldPath).filter(Boolean))].slice(0, 20),
      firstAction: blocked ? repairs[0]?.action || "按字段提示修复本地草稿，再重新预检。" : "检查草稿摘要并进入人工确认。",
    },
    nextAction: blocked
      ? firstEvidenceBlocker?.nextAction || repairs[0].action
      : firstEvidenceBlocker?.nextAction || "检查草稿摘要并进入人工确认；确认前不会写入 Ozon。",
    sideEffect,
    result: blocked ? "提交未执行，等待人工修复。" : "本地预检通过，可进入人工确认。",
    verificationLevel: "locally_tested",
    evidenceSummary,
    variantCoverage,
  };
}

export function buildPreflightGateNode(input = {}) {
  const payloadValidation = validateSubmitPayload(input.payload || {}, { attrsMeta: input.attrsMeta || [] });
  const issues = [...(payloadValidation.issues || [])];
  const listingQuality = input.listingQuality || diagnoseListingQuality({
    payload: input.payload || {},
    attrsMeta: input.attrsMeta || [],
    contentSummary: input.contentSummary || {},
    pricing: input.pricing || null,
    workflowRun: input.workflowRun || null,
    dictionaryValueCache: input.dictionaryValueCache || {},
    dictionaryLanguage: input.dictionaryLanguage || "ZH_HANS",
    dictionaryValuesByAttributeId: input.dictionaryValuesByAttributeId || {},
  });
  const attributeMatrix = input.attributeMatrix || buildListingAttributeMatrix({
    payload: input.payload || {},
    attrsMeta: input.attrsMeta || [],
    dictionaryValueCache: input.dictionaryValueCache || {},
    dictionaryLanguage: input.dictionaryLanguage || "ZH_HANS",
    dictionaryValuesByAttributeId: input.dictionaryValuesByAttributeId || {},
    sourceVariants: input.sourceVariants || input.skuVariants || [],
  });
  const requiredAttributeFillPlan = input.requiredAttributeFillPlan || buildRequiredAttributePlanForPayload(input.payload || {}, {
    attrsMeta: input.attrsMeta || [],
    categoryMatch: input.category || categoryMatchFromPayload(input.payload || {}),
    dictionaryValueCache: input.dictionaryValueCache || {},
    dictionaryValuesByAttributeId: input.dictionaryValuesByAttributeId || {},
    contentSummary: input.contentSummary || {},
  });
  const requiredAttributeFillSummary = input.requiredAttributeFillSummary || summarizeRequiredAttributeFillPlan(requiredAttributeFillPlan);
  const requiredAttributeManualBacklog = input.requiredAttributeManualBacklog || buildRequiredAttributeManualBacklog(requiredAttributeFillPlan);
  const requiredAttributeRuleCandidateIndex = input.requiredAttributeRuleCandidateIndex || buildRequiredAttributeRuleCandidateIndex({
    categoryMatch: input.category || categoryMatchFromPayload(input.payload || {}),
    manualBacklog: requiredAttributeManualBacklog,
    fillPlan: requiredAttributeFillPlan,
  });
  const requiredAttributeRuleCandidateHistorySamples = Array.isArray(input.requiredAttributeRuleCandidateHistorySamples)
    ? input.requiredAttributeRuleCandidateHistorySamples
    : [];
  const requiredAttributeRuleCandidateHistory = input.requiredAttributeRuleCandidateHistory || (
    requiredAttributeRuleCandidateHistorySamples.length
      ? buildRequiredAttributeRuleCandidateHistory([
        ...requiredAttributeRuleCandidateHistorySamples,
        {
          sourceProductId: firstPayloadOfferId(input.payload || {}),
          sourceRunId: input.workflowRun?.id || "",
          index: requiredAttributeRuleCandidateIndex,
        },
      ])
      : null
  );
  const variantConfiguration = input.variantConfiguration || buildVariantConfigurationSummary({
    payload: input.payload || {},
    attrsMeta: input.attrsMeta || [],
    pricing: input.pricing || null,
    sourceVariants: input.sourceVariants || input.skuVariants || [],
  });
  issues.push(...listingQualityIssues(listingQuality));
  issues.push(...listingAttributeMatrixIssues(attributeMatrix));
  issues.push(...variantConfigurationIssues(variantConfiguration));
  const sourceVariantBinding = input.sourceVariantEvidenceRequired === true
    ? buildSourceVariantBindingSummary({
      payload: input.payload || {},
      sourceVariants: input.sourceVariants || input.skuVariants || [],
      sourceEvidence: input.sourceEvidence || null,
      sourceVariantEvidenceRequired: true,
    })
    : (variantConfiguration.sourceVariantBinding || buildSourceVariantBindingSummary({
    payload: input.payload || {},
    sourceVariants: input.sourceVariants || input.skuVariants || [],
    sourceEvidence: input.sourceEvidence || null,
    sourceVariantEvidenceRequired: input.sourceVariantEvidenceRequired === true,
  }));
  const sourceVariantBindingReceipt = buildSourceVariantBindingReceipt({
    payload: input.payload || {},
    sourceVariants: input.sourceVariants || input.skuVariants || [],
    sourceEvidence: input.sourceEvidence || null,
    sourceVariantEvidenceRequired: input.sourceVariantEvidenceRequired === true,
  });
  const duplicate = input.duplicate || null;
  if (duplicate?.duplicateJobId || duplicate?.duplicateSku) {
    issues.push({
      code: "DUPLICATE_LISTING",
      message: "检测到重复货源或重复 Ozon 参考品，禁止自动提交。",
      duplicateJobId: duplicate.duplicateJobId || "",
      duplicateSku: duplicate.duplicateSku || "",
    });
  }
  const contentSummary = input.contentSummary || {};
  const pricingDiagnosis = input.pricing || input.pricingDiagnosis || null;
  const pricingRisk = pricingDiagnosis ? evaluatePricingRisk(pricingDiagnosis) : null;
  if (pricingRisk?.branch === "blocked") {
    issues.push({
      code: String(pricingRisk.diagnosis?.reasonCode || "PRICING_BLOCKED"),
      message: String(pricingRisk.diagnosis?.messageZh || "当前定价证据不足，禁止进入 Ozon 提交。"),
      pricingRisk: {
        riskLevel: pricingRisk.riskLevel || "high",
        reason: pricingRisk.reason || "定价风险需要人工处理。",
        recommendedActions: Array.isArray(pricingRisk.recommendedActions) ? pricingRisk.recommendedActions.slice(0, 6) : [],
      },
    });
  }
  for (const issue of contentSummary.contentIssues || []) {
    issues.push({ code: "CONTENT_ISSUE", message: String(issue || "") });
  }
  // Generated Russian text is not submission-ready merely because it has a
  // title, description, or enough images.  The content evidence contract
  // records whether every claim can be traced to the 1688 snapshot and whether
  // a human has reviewed the result.  If the contract is present, keep the
  // preflight gate fail-closed until it is explicitly reviewed.
  const contentEvidence = contentSummary.contentEvidence || null;
  if (contentEvidence && typeof contentEvidence === "object") {
    const contentEvidenceStatus = String(contentEvidence.status || "").trim();
    const contentEvidenceBlockers = Array.isArray(contentEvidence.blockerCodes)
      ? contentEvidence.blockerCodes.map((code) => String(code || "").trim()).filter(Boolean)
      : [];
    if (contentEvidenceStatus !== "reviewed" || contentEvidenceBlockers.length > 0) {
      issues.push({
        code: "CONTENT_EVIDENCE_REVIEW_REQUIRED",
        message: "俄文内容尚未完成逐字段事实复核，禁止进入 Ozon 提交。",
        status: contentEvidenceStatus || "unknown",
        blockerCodes: contentEvidenceBlockers.slice(0, 20),
      });
    }
  }
  if (Number(contentSummary.candidateImageCount || 0) > 0 && Number(contentSummary.candidateImageCount || 0) < 3) {
    issues.push({ code: "SOURCE_IMAGES_TOO_FEW", message: "候选源图片少于 3 张。" });
  }
  if (contentSummary.sizeWeightReady === false) {
    issues.push({ code: "SOURCE_SIZE_WEIGHT_MISSING", message: "候选源缺少完整尺重。" });
  }
  // `undefined` is also a missing category, unless the payload itself carries
  // valid category/type ids. This keeps the gate compatible with confirmed
  // drafts while still blocking a caller that omitted both sources.
  const payloadCategory = categoryMatchFromPayload(input.payload || {});
  const hasPayloadCategory = payloadCategory.description_category_id > 0 && payloadCategory.type_id > 0;
  if (!input.category && !hasPayloadCategory) {
    issues.push({ code: "CATEGORY_MATCH_MISSING", message: "提交前没有可信 Ozon 类目匹配。" });
  }
  if (input.categoryEvidenceRequired === true) {
    const evidence = input.categoryEvidence && typeof input.categoryEvidence === "object" ? input.categoryEvidence : {};
    const expectedCategory = input.category || categoryMatchFromPayload(input.payload || {});
    const expectedCategoryKey = `${Number(expectedCategory?.description_category_id || 0)}:${Number(expectedCategory?.type_id || 0)}`;
    const expectedStoreId = String(input.categoryEvidenceStoreId || "").trim();
    const expectedEnvironmentRefHash = String(input.categoryEvidenceEnvironmentRefHash || "").trim();
    const maxAgeMs = Number.isFinite(Number(input.categoryEvidenceMaxAgeMs)) && Number(input.categoryEvidenceMaxAgeMs) > 0
      ? Number(input.categoryEvidenceMaxAgeMs) : 30 * 24 * 60 * 60 * 1000;
    const validEvidence = (entry, kind) => {
      const checkedAtMs = Date.parse(String(entry?.checkedAt || ""));
      const ageMs = Number.isFinite(checkedAtMs) ? Date.now() - checkedAtMs : Number.POSITIVE_INFINITY;
      // A category read is only usable when its persisted receipt is bound to
      // the exact store and environment requested by this preflight. Missing
      // scope fields are not compatible fallbacks: accepting them would let
      // an old or forged server_observed response cross store boundaries.
      const storeMatches = Boolean(expectedStoreId && String(entry?.storeId || "") === expectedStoreId);
      const environmentMatches = Boolean(expectedEnvironmentRefHash && String(entry?.environmentRefHash || "") === expectedEnvironmentRefHash);
      const categoryMatches = kind !== "attributes"
        ? true
        : Boolean(expectedCategoryKey && String(entry?.cacheKey || "") === expectedCategoryKey);
      return entry
      && String(entry.verificationLevel || "") === "server_observed"
      && /^sha256:[a-f0-9]{64}$/i.test(String(entry.responseHash || ""))
      && Number(entry.statusCode || 0) >= 200
      && Number(entry.statusCode || 0) < 300
      && Number.isFinite(checkedAtMs)
      && ageMs >= 0
      && ageMs <= maxAgeMs
      && storeMatches
      && environmentMatches
      && categoryMatches;
    };
    if (!validEvidence(evidence.tree, "tree") || !validEvidence(evidence.attributes, "attributes")) {
      issues.push({
        code: "CATEGORY_EVIDENCE_MISSING",
        message: "当前店铺缺少可追溯的 Ozon 类目/属性读取回执，禁止使用旧缓存提交。",
        missing: [
          ...(validEvidence(evidence.tree, "tree") ? [] : ["tree"]),
          ...(validEvidence(evidence.attributes, "attributes") ? [] : ["attributes"]),
        ],
      });
    }
  }
  if (input.sourceEvidenceRequired === true) {
    const sourceSnapshotHash = String(input.sourceEvidence?.snapshotHash || "").trim();
    if (!/^sha256:[a-f0-9]{64}$/i.test(sourceSnapshotHash)) {
      issues.push({ code: "SOURCE_EVIDENCE_MISSING", message: "1688 来源缺少有效快照证据，禁止进入 Ozon 提交。" });
    } else if (String(input.sourceEvidence?.verificationState || "").trim() !== "ok") {
      // A captured HTML hash is not proof that the seller page was actually
      // accessible.  Captcha/login/rate-limit pages must stay waiting_human;
      // otherwise a replay could appear to have source evidence and reach the
      // confirmation step with no real product facts behind it.
      issues.push({
        code: "SOURCE_EVIDENCE_NOT_VERIFIED",
        message: "1688 来源页面尚未通过人工验证，无法证明商品字段，禁止进入 Ozon 提交。",
        verificationState: String(input.sourceEvidence?.verificationState || "unknown").trim() || "unknown",
      });
    }
    if (input.sourceIdentityRequired === true) {
      const canonicalUrl = String(input.sourceEvidence?.canonicalUrl || input.sourceEvidence?.url || "").trim();
      const sourceOfferId = String(input.sourceEvidence?.offerId || "").trim();
      const canonicalOfferId = canonical1688OfferId(canonicalUrl);
      if (!canonicalUrl || !sourceOfferId || !canonicalOfferId) {
        issues.push({
          code: "SOURCE_IDENTITY_MISSING",
          message: "1688 来源缺少严格可核对的商品 URL 或 Offer ID，禁止把快照当作当前商品证据。",
          missing: [
            ...(!canonicalOfferId ? ["canonicalUrl"] : []),
            ...(!sourceOfferId ? ["offerId"] : []),
          ],
        });
      } else if (canonicalOfferId !== sourceOfferId) {
        issues.push({
          code: "SOURCE_OFFER_URL_MISMATCH",
          message: "1688 canonical URL 中的 Offer ID 与来源证据不一致，禁止继续预检或提交。",
          canonicalOfferId,
          sourceOfferId,
        });
      }
    }
  }
  if (input.sourceVariantBindingRequired === true && !sourceVariantBinding.summary.ready) {
    issues.push({
      code: "SOURCE_SKU_BINDING_MISSING",
      message: "1688 SKU 未完成逐条来源绑定或存在重复来源 SKU，禁止进入 Ozon 提交。",
      missingOfferIds: sourceVariantBinding.summary.missingOfferIds,
      duplicateSourceSkuIds: sourceVariantBinding.summary.duplicateSourceSkuIds,
    });
  }
  if (Number(input.variantCount || 0) === 1 && Number(contentSummary.skuVariantCount || 0) > 1) {
    issues.push({ code: "VARIANT_COLLAPSED", message: "1688 有多个变体，但提交 payload 只保留 1 个 SKU。" });
  }
  const ok = issues.length === 0;
  const sellerResult = buildPreflightSellerResult({
    issues,
    payload: input.payload || {},
    sourceVariantBinding,
    variantConfiguration,
    sourceEvidence: input.sourceEvidence || null,
    sourceEvidenceRequired: input.sourceEvidenceRequired === true,
    categoryEvidence: input.categoryEvidence || null,
    categoryEvidenceRequired: input.categoryEvidenceRequired === true,
    contentEvidence: input.contentSummary?.contentEvidence || null,
  });
  return {
    key: "preflight_check",
    name: "提交前总闸",
    status: ok ? "success" : "failed",
    runStatus: ok ? "running" : "waiting_human",
    output: {
      ok,
      issueCount: issues.length,
      issues,
      // Persist only the bounded policy inputs needed to re-run this same
      // gate after a local draft edit.  This is evidence metadata/hashes, not
      // an Ozon payload or credential, and prevents the generic validator
      // from silently weakening the 1688 chain on the next request.
      preflightPolicy: {
        enforced: true,
        sourceEvidence: input.sourceEvidence || null,
        sourceEvidenceRequired: input.sourceEvidenceRequired === true,
        sourceIdentityRequired: input.sourceIdentityRequired === true,
        sourceVariantBindingRequired: input.sourceVariantBindingRequired === true,
        sourceVariantEvidenceRequired: input.sourceVariantEvidenceRequired === true,
        category: input.category || null,
        categoryEvidence: input.categoryEvidence || null,
        categoryEvidenceRequired: input.categoryEvidenceRequired === true,
        categoryEvidenceStoreId: String(input.categoryEvidenceStoreId || ""),
        categoryEvidenceEnvironmentRefHash: String(input.categoryEvidenceEnvironmentRefHash || ""),
        categoryEvidenceMaxAgeMs: Number(input.categoryEvidenceMaxAgeMs || 0) || undefined,
        contentSummary: input.contentSummary || {},
        pricingDiagnosis,
        variantCount: Number(input.variantCount || payloadItems(input.payload || {}).length || 0),
      },
      payload: payloadValidation,
      listingQuality,
      listingQualityWarnings: Array.isArray(listingQuality.warnings) ? listingQuality.warnings : [],
      attributeMatrix,
      requiredAttributeFillPlan,
      requiredAttributeFillSummary,
      requiredAttributeManualBacklog,
      requiredAttributeRuleCandidateIndex,
      ...(requiredAttributeRuleCandidateHistory ? { requiredAttributeRuleCandidateHistory } : {}),
      variantConfiguration,
      sourceVariantBinding,
      sourceVariantBindingReceipt,
      sellerResult,
      summary: {
        itemCount: payloadItems(input.payload || {}).length,
        variantCount: Number(input.variantCount || 0),
        contentIssues: Array.isArray(contentSummary.contentIssues) ? contentSummary.contentIssues : [],
        candidateImageCount: Number(contentSummary.candidateImageCount || 0),
        skuVariantCount: Number(contentSummary.skuVariantCount || 0),
        sizeWeightReady: Boolean(contentSummary.sizeWeightReady),
        categoryPath: input.category?.path || "",
        categoryEvidenceRequired: input.categoryEvidenceRequired === true,
        categoryEvidence: input.categoryEvidence && typeof input.categoryEvidence === "object"
          ? {
            tree: input.categoryEvidence.tree?.verificationLevel || "missing",
            attributes: input.categoryEvidence.attributes?.verificationLevel || "missing",
          }
          : { tree: "missing", attributes: "missing" },
      },
    },
    diagnosis: ok ? {} : {
      reasonCode: "PREFLIGHT_BLOCKED",
      severity: "blocking",
      messageZh: "提交前总闸发现风险，已阻止继续提交 Ozon。",
      fixHints: ["查看 issues 列表", "修复 payload/内容/图片/类目风险", "人工确认后重试"],
    },
    branch: ok ? "continue" : "manual_review",
    riskScore: ok ? 10 : Math.min(95, 60 + issues.length * 6),
    riskLevel: ok ? "low" : (issues.length >= 3 ? "high" : "medium"),
    reason: ok ? "提交前总闸通过，可继续提交 Ozon。" : "提交前总闸发现阻塞风险，禁止自动提交。",
    recommendedActions: ok ? ["继续提交 Ozon", "查看节点输出"] : ["人工处理阻塞风险", "保存修正草稿", "重新校验 Payload"],
    actions: ok ? ["view_output"] : ["edit_payload", "validate_payload", "retry_node", "request_new_source"],
  };
}

async function updateRun(runId, updater) {
  return mutateStore((store) => {
    const index = store.items.findIndex((item) => item.id === runId);
    if (index < 0) throw new Error("工作流不存在: " + runId);
    const next = updater({ ...store.items[index] });
    next.updatedAt = nowIso();
    store.items[index] = next;
    return { value: next };
  });
}

export async function pauseWorkflowRun(runId) {
  return updateRun(runId, (run) => ({
    ...run,
    status: "paused",
    locks: { ...(run.locks || {}), paused: true },
    events: [
      ...(run.events || []),
      {
        time: nowIso(),
        node: run.currentNode || "",
        type: "workflow_paused",
        message: "人工暂停工作流",
        data: {},
      },
    ],
  }));
}

export async function requestWorkflowMediaReview(runId) {
  const run = await getWorkflowRun(runId);
  if (!run) return { ok: false, status: 404, reasonCode: "MEDIA_REVIEW_WORKFLOW_NOT_FOUND" };
  const updated = await updateRun(runId, (current) => ({
    ...current,
    status: "waiting_human",
    currentNode: "media_review",
    locks: { ...(current.locks || {}), waitingHuman: true, paused: false },
    events: [
      ...(current.events || []),
      { time: nowIso(), node: "media_review", type: "media_review_requested", message: "请求人工逐项审查媒体候选", data: {} },
    ],
  }));
  await upsertWorkflowNode(runId, {
    key: "media_review",
    name: "媒体人工审查",
    status: "waiting_human",
    runStatus: "waiting_human",
    branch: "manual_review",
    reason: "媒体候选需要人工逐项确认；批准前不会进入富内容或提交。",
    recommendedActions: ["查看媒体证据", "保存本地批准草稿", "发布本地批准后重新预检"],
    actions: ["approve_media_draft", "validate_payload"],
  });
  return { ok: true, run: updated, nextAction: "逐项查看媒体候选并保存本地批准草稿；批准前不会提交 Ozon" };
}

export async function resumeWorkflowRun(runId) {
  return updateRun(runId, (run) => ({
    ...run,
    status: "running",
    locks: { ...(run.locks || {}), paused: false, waitingHuman: false },
    events: [
      ...(run.events || []),
      {
        time: nowIso(),
        node: run.currentNode || "",
        type: "workflow_resumed",
        message: "人工恢复工作流",
        data: {},
      },
    ],
  }));
}

export async function retryWorkflowNode(runId, nodeKey, input = {}) {
  const run = await upsertWorkflowNode(runId, {
    key: nodeKey,
    status: "retrying",
    input,
    runStatus: "running",
  });
  return updateRun(runId, (current) => ({
    ...current,
    status: "running",
    locks: {
      ...(current.locks || {}),
      paused: false,
      waitingHuman: false,
    },
    events: [
      ...(current.events || []),
      {
        time: nowIso(),
        node: String(nodeKey || ""),
        type: "retry_requested",
        message: "人工请求重试节点",
        data: { input },
      },
    ],
    currentNode: run.currentNode || String(nodeKey || ""),
  }));
}

export async function requestWorkflowNewSource(runId, data = {}) {
  const hasReplacement = Array.isArray(data.replacementCrawlerTaskIds) && data.replacementCrawlerTaskIds.length > 0;
  return updateRun(runId, (run) => ({
    ...run,
    status: hasReplacement ? "running" : "cancelled",
    locks: {
      ...(run.locks || {}),
      paused: false,
      waitingHuman: false,
      submitLocked: false,
    },
    events: [
      ...(run.events || []),
      {
        time: nowIso(),
        node: run.currentNode || "",
        type: "new_source_requested",
        message: hasReplacement ? "已创建新货源任务，流程继续运行" : "人工决定放弃当前候选，改用新货源",
        data,
      },
    ],
  }));
}

export async function retryWorkflowAfterManualFix(runId, nodeKey, data = {}) {
  const run = await retryWorkflowNode(runId, nodeKey, data.input || {});
  return updateRun(runId, (current) => ({
    ...current,
    events: [
      ...(current.events || []),
      {
        time: nowIso(),
        node: String(nodeKey || current.currentNode || ""),
        type: "manual_fix_retry_requested",
        message: "人工确认已处理外部残留，重试当前节点",
        data,
      },
    ],
  }));
}

export async function confirmWorkflowContinue(runId, nodeKey, data = {}) {
  const key = String(nodeKey || "").trim();
  if (!key) throw new Error("节点 key 不能为空");
  const run = await upsertWorkflowNode(runId, {
    key,
    status: "success",
    runStatus: "running",
    branch: "manual_continue",
    riskScore: 0,
    riskLevel: "low",
    reason: "人工确认可继续流程。",
    recommendedActions: ["继续到下一节点"],
  });
  return updateRun(runId, (current) => ({
    ...current,
    status: "running",
    locks: {
      ...(current.locks || {}),
      paused: false,
      waitingHuman: false,
      submitLocked: false,
    },
    events: [
      ...(current.events || []),
      {
        time: nowIso(),
        node: key,
        type: "manual_continue_confirmed",
        message: "人工确认风险可接受，允许继续流程",
        data,
      },
    ],
    currentNode: run.currentNode || key,
  }));
}

const ACCEPTABLE_PRICING_RISK_CODES = new Set([
  "PRICING_PROFIT_LOW",
  "PRICING_LOGISTICS_RATIO_HIGH",
]);

function workflowNodeByKey(run = {}, nodeKey = "") {
  const key = String(nodeKey || "").trim();
  return (run.nodes || []).find((node) => node.key === key) || null;
}

export async function acceptWorkflowPricingRisk(runId, nodeKey, data = {}) {
  const key = String(nodeKey || "").trim();
  if (!key) throw new Error("节点 key 不能为空");
  const current = await getWorkflowRun(runId);
  if (!current) throw new Error("工作流不存在: " + runId);
  const node = workflowNodeByKey(current, key);
  const reasonCode = String(node?.diagnosis?.reasonCode || node?.diagnostic?.reasonCode || "").trim();
  if (!reasonCode.startsWith("PRICING_")) throw new Error("当前节点不是价格风险节点");
  if (!ACCEPTABLE_PRICING_RISK_CODES.has(reasonCode) || node?.branch === "blocked") {
    throw new Error("阻塞型价格风险不能直接接受，请修正尺重/运费/最低价后重试。");
  }
  await upsertWorkflowNode(runId, {
    key,
    status: "success",
    branch: "manual_pricing_risk_accepted",
    riskScore: Math.min(45, Number(node?.riskScore || 35)),
    riskLevel: "medium",
    reason: "人工接受价格风险，允许继续进入后续预检。",
    recommendedActions: ["继续 Payload 预检", "保留价格诊断记录"],
  });
  return updateRun(runId, (run) => ({
    ...run,
    status: "running",
    locks: {
      ...(run.locks || {}),
      paused: false,
      waitingHuman: false,
      submitLocked: run.locks?.submitLocked !== false,
    },
    events: [
      ...(run.events || []),
      {
        time: nowIso(),
        node: key,
        type: "pricing_risk_accepted",
        message: "人工接受价格风险，流程继续但保留提交锁。",
        data: { ...data, reasonCode },
      },
    ],
    currentNode: key,
  }));
}

export async function requestWorkflowPricingRecalculation(runId, nodeKey, data = {}) {
  const key = String(nodeKey || "").trim();
  if (!key) throw new Error("节点 key 不能为空");
  await upsertWorkflowNode(runId, {
    key,
    status: "retrying",
    branch: "recalculate_pricing",
    riskScore: 25,
    riskLevel: "low",
    reason: "已请求重新生成价格，等待定价节点重跑。",
    recommendedActions: ["重新生成价格", "检查尺重和货源价"],
  });
  return updateRun(runId, (run) => ({
    ...run,
    status: "running",
    locks: {
      ...(run.locks || {}),
      paused: false,
      waitingHuman: false,
    },
    events: [
      ...(run.events || []),
      {
        time: nowIso(),
        node: key,
        type: "pricing_recalculation_requested",
        message: "人工请求重新生成价格。",
        data,
      },
    ],
    currentNode: key,
  }));
}

export async function savePayloadDraft(runId, payloadDraft, options = {}) {
  const payloadDraftHash = hashPayloadDraft(payloadDraft);
  return updateRun(runId, (run) => ({
    ...run,
    payloadDraft,
    payloadDraftHash,
    payloadDraftAttrsMeta: Array.isArray(options.attrsMeta) ? options.attrsMeta : (run.payloadDraftAttrsMeta || []),
    payloadDraftSourceVariants: Array.isArray(options.sourceVariants) ? options.sourceVariants : (run.payloadDraftSourceVariants || []),
    payloadDraftValidation: null,
    mediaApprovalDraft: run.mediaApprovalDraft?.expectedDraftHash
      && run.mediaApprovalDraft.expectedDraftHash !== payloadDraftHash
      ? {
          ...run.mediaApprovalDraft,
          status: "stale",
          staleReason: "payload_draft_changed",
          staleAt: nowIso(),
        }
      : run.mediaApprovalDraft,
    locks: { ...(run.locks || {}), submitLocked: true },
  }));
}

function mediaApprovalFailure(reasonCode, message) {
  return { ok: false, status: 400, reasonCode, message, submittedToOzon: false, generatedMedia: false };
}

function sourceHashFromCandidateData(candidateData = {}) {
  return String(candidateData?.sourceEvidence?.snapshotHash || "").trim();
}

function assetEvidenceSourceHash(asset = {}) {
  const reference = String(asset?.evidenceRef || "").trim();
  return reference.startsWith("snapshot:") ? `sha256:${reference.slice("snapshot:".length)}` : reference;
}

export async function approveWorkflowMediaCandidates(runId, input = {}, deps = {}) {
  const run = await getWorkflowRun(runId);
  if (!run) return mediaApprovalFailure("MEDIA_APPROVAL_WORKFLOW_NOT_FOUND", "工作流不存在。");
  if (run.status !== "waiting_human" && run.locks?.waitingHuman !== true) {
    return mediaApprovalFailure("MEDIA_APPROVAL_WAITING_HUMAN_REQUIRED", "只有等待人工处理的工作流才能记录媒体批准草稿。");
  }
  const actorId = String(input.actorId || "").trim();
  if (input.confirmed !== true || !actorId || actorId.length > 128) {
    return mediaApprovalFailure("MEDIA_APPROVAL_CONFIRMATION_REQUIRED", "需要明确 confirmed=true 和有效 actorId。");
  }
  const assetIds = [...new Set((Array.isArray(input.assetIds) ? input.assetIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!assetIds.length || assetIds.length > 100) {
    return mediaApprovalFailure("MEDIA_APPROVAL_ASSET_IDS_INVALID", "需要选择 1 到 100 个媒体候选。");
  }
  const currentDraftHash = String(run.payloadDraftHash || hashPayloadDraft(run.payloadDraft || {}));
  const expectedDraftHash = String(input.expectedDraftHash || "").trim();
  if (!expectedDraftHash || expectedDraftHash !== currentDraftHash) {
    return mediaApprovalFailure("MEDIA_APPROVAL_DRAFT_HASH_MISMATCH", "Payload 草稿已变化，请重新审查媒体候选。");
  }
  const candidateData = deps.candidateData && typeof deps.candidateData === "object" ? deps.candidateData : {};
  const currentSourceHash = sourceHashFromCandidateData(candidateData);
  const expectedSourceHash = String(input.expectedSourceHash || "").trim();
  if (!currentSourceHash || !expectedSourceHash || expectedSourceHash !== currentSourceHash) {
    return mediaApprovalFailure("MEDIA_APPROVAL_SOURCE_HASH_MISMATCH", "1688 来源证据已变化，请重新审查媒体候选。");
  }
  const mediaAssets = Array.isArray(candidateData.mediaAssets) ? candidateData.mediaAssets : [];
  const assetById = new Map(mediaAssets.map((asset) => [String(asset?.id || ""), asset]));
  const selectedAssets = assetIds.map((id) => assetById.get(id));
  if (selectedAssets.some((asset) => !asset)) {
    return mediaApprovalFailure("MEDIA_APPROVAL_ASSET_NOT_FOUND", "选择的媒体候选不属于当前商品来源。");
  }
  if (selectedAssets.some((asset) => assetEvidenceSourceHash(asset) !== currentSourceHash)) {
    return mediaApprovalFailure("MEDIA_APPROVAL_ASSET_SOURCE_MISMATCH", "媒体候选不属于当前来源快照。");
  }
  if (typeof deps.persistCandidateData !== "function") {
    return mediaApprovalFailure("MEDIA_APPROVAL_PERSISTENCE_REQUIRED", "缺少本地候选批准草稿保存依赖。");
  }
  const nowValue = typeof deps.now === "function" ? deps.now() : new Date();
  const confirmedAt = (nowValue instanceof Date ? nowValue : new Date(nowValue)).toISOString();
  const approvalDraft = {
    status: "approved_draft",
    confirmed: true,
    confirmedAt,
    actorId,
    assetIds,
    expectedDraftHash,
    expectedSourceHash,
  };
  const nextCandidateData = {
    ...candidateData,
    mediaAssets: mediaAssets.map((asset) => assetIds.includes(String(asset?.id || ""))
      ? {
          ...asset,
          checks: {
            ...(asset.checks || {}),
            approvalDraft: {
              confirmed: true,
              confirmedAt,
              actorId,
              expectedDraftHash,
              expectedSourceHash,
            },
          },
        }
      : asset),
    mediaApprovalDraft: approvalDraft,
  };
  const persisted = await deps.persistCandidateData(nextCandidateData, { expectedSourceHash });
  if (persisted === false) {
    return mediaApprovalFailure("MEDIA_APPROVAL_SOURCE_HASH_MISMATCH", "1688 来源证据在保存前发生变化，请重新审查媒体候选。");
  }
  const updated = await updateRun(runId, (current) => ({
    ...current,
    mediaApprovalDraft: String(current.payloadDraftHash || hashPayloadDraft(current.payloadDraft || {})) === expectedDraftHash
      ? approvalDraft
      : {
          ...approvalDraft,
          status: "stale",
          staleReason: "payload_draft_changed_during_approval",
          staleAt: confirmedAt,
        },
    locks: { ...(current.locks || {}), submitLocked: true, waitingHuman: true },
    events: [
      ...(current.events || []),
      {
        time: confirmedAt,
        node: current.currentNode || "preflight_check",
        type: "media_approval_draft_recorded",
        message: "已记录本地媒体审查批准草稿；未生成图片、未上传、未提交 Ozon。",
        data: {
          actorId,
          assetCount: assetIds.length,
          draftHash: expectedDraftHash,
          sourceHash: expectedSourceHash,
          submittedToOzon: false,
        },
      },
    ],
  }));
  if (updated.mediaApprovalDraft?.status === "stale") {
    return mediaApprovalFailure("MEDIA_APPROVAL_DRAFT_HASH_MISMATCH", "Payload 草稿在保存批准时发生变化，请重新审查媒体候选。");
  }
  return {
    ok: true,
    status: "approved_draft",
    submittedToOzon: false,
    generatedMedia: false,
    uploadedMedia: false,
    approvalDraft,
    workflowSummary: {
      runId: String(updated.id || runId),
      status: String(updated.status || "waiting_human"),
      currentNode: String(updated.currentNode || ""),
      submitLocked: updated.locks?.submitLocked === true,
      waitingHuman: updated.locks?.waitingHuman === true,
    },
  };
}

function sortedMediaAssetIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((id) => String(id || "").trim()).filter(Boolean))].sort();
}

function sameMediaAssetIds(left, right) {
  const a = sortedMediaAssetIds(left);
  const b = sortedMediaAssetIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function richContentReferencedUrls(value) {
  const urls = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if ((key === "src" || key === "srcMobile") && typeof child === "string" && /^https?:\/\//i.test(child)) urls.push(child);
      else visit(child);
    }
  };
  try {
    visit(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return [];
  }
  return [...new Set(urls)];
}

export async function publishWorkflowMediaApproval(runId, input = {}, deps = {}) {
  const run = await getWorkflowRun(runId);
  if (!run) return mediaApprovalFailure("MEDIA_APPROVAL_WORKFLOW_NOT_FOUND", "工作流不存在。");
  if (run.status !== "waiting_human" && run.locks?.waitingHuman !== true) {
    return mediaApprovalFailure("MEDIA_APPROVAL_WAITING_HUMAN_REQUIRED", "只有等待人工处理的工作流才能发布本地媒体批准。");
  }
  if (input.publishConfirmed !== true) {
    return mediaApprovalFailure("MEDIA_APPROVAL_PUBLISH_CONFIRMATION_REQUIRED", "需要明确 publishConfirmed=true。");
  }
  const approvalDraft = run.mediaApprovalDraft || {};
  if (approvalDraft.status !== "approved_draft") {
    return mediaApprovalFailure("MEDIA_APPROVAL_DRAFT_STALE", "媒体批准草稿不存在、已陈旧或已经发布。");
  }
  const actorId = String(input.actorId || "").trim();
  const actorChanged = actorId !== String(approvalDraft.actorId || "");
  if (!actorId || actorId.length > 128 || (actorChanged && input.reconfirmActorChange !== true)) {
    return mediaApprovalFailure("MEDIA_APPROVAL_ACTOR_MISMATCH", "发布人必须与批准草稿一致；变更发布人需要明确重新确认。");
  }
  const currentDraftHash = String(run.payloadDraftHash || hashPayloadDraft(run.payloadDraft || {}));
  const expectedDraftHash = String(input.expectedDraftHash || "").trim();
  if (!expectedDraftHash
    || expectedDraftHash !== currentDraftHash
    || expectedDraftHash !== String(approvalDraft.expectedDraftHash || "")) {
    return mediaApprovalFailure("MEDIA_APPROVAL_DRAFT_STALE", "Payload 草稿已变化，请重新创建媒体批准草稿。");
  }
  const candidateData = deps.candidateData && typeof deps.candidateData === "object" ? deps.candidateData : {};
  const currentSourceHash = sourceHashFromCandidateData(candidateData);
  const expectedSourceHash = String(input.expectedSourceHash || "").trim();
  if (!currentSourceHash
    || expectedSourceHash !== currentSourceHash
    || expectedSourceHash !== String(approvalDraft.expectedSourceHash || "")) {
    return mediaApprovalFailure("MEDIA_APPROVAL_SOURCE_HASH_MISMATCH", "1688 来源证据已变化，请重新创建媒体批准草稿。");
  }
  const assetIds = sortedMediaAssetIds(input.assetIds);
  if (!sameMediaAssetIds(assetIds, approvalDraft.assetIds)) {
    return mediaApprovalFailure("MEDIA_APPROVAL_ASSET_SET_MISMATCH", "发布的媒体候选集合必须与批准草稿完全一致。");
  }
  const candidateApprovalDraft = candidateData.mediaApprovalDraft || {};
  if (candidateApprovalDraft.status !== "approved_draft"
    || candidateApprovalDraft.expectedDraftHash !== expectedDraftHash
    || candidateApprovalDraft.expectedSourceHash !== expectedSourceHash
    || !sameMediaAssetIds(candidateApprovalDraft.assetIds, assetIds)) {
    return mediaApprovalFailure("MEDIA_APPROVAL_DRAFT_STALE", "候选商品中的批准草稿已变化，请重新审查。");
  }
  const mediaAssets = Array.isArray(candidateData.mediaAssets) ? candidateData.mediaAssets : [];
  const assetById = new Map(mediaAssets.map((asset) => [String(asset?.id || ""), asset]));
  const selectedAssets = assetIds.map((id) => assetById.get(id));
  if (selectedAssets.some((asset) => !asset)) {
    return mediaApprovalFailure("MEDIA_APPROVAL_ASSET_NOT_FOUND", "批准草稿中的媒体候选已不存在。");
  }
  if (selectedAssets.some((asset) => assetEvidenceSourceHash(asset) !== currentSourceHash)) {
    return mediaApprovalFailure("MEDIA_APPROVAL_ASSET_SOURCE_MISMATCH", "媒体候选不属于当前来源快照。");
  }
  if (typeof deps.persistCandidateData !== "function") {
    return mediaApprovalFailure("MEDIA_APPROVAL_PERSISTENCE_REQUIRED", "缺少本地媒体批准保存依赖。");
  }
  const nowValue = typeof deps.now === "function" ? deps.now() : new Date();
  const publishedAt = (nowValue instanceof Date ? nowValue : new Date(nowValue)).toISOString();
  const publishedAssets = mediaAssets.map((asset) => assetIds.includes(String(asset?.id || ""))
    ? {
        ...asset,
        checks: {
          ...(asset.checks || {}),
          humanApproved: true,
          approvalBinding: { actorId, publishedAt, expectedDraftHash, expectedSourceHash },
        },
      }
    : asset);
  const richContentUrls = richContentReferencedUrls(candidateData.richContentJson || candidateData.rich_content_json);
  const approvedDetailUrls = new Set(publishedAssets
    .filter((asset) => asset?.role === "detail"
      && assetEvidenceSourceHash(asset) === currentSourceHash
      && asset?.checks?.humanApproved === true)
    .map((asset) => String(asset.sourceUrl || ""))
    .filter(Boolean));
  const richContentDetailAssetsApproved = richContentUrls.length > 0
    && richContentUrls.every((url) => approvedDetailUrls.has(url));
  const publishedBinding = {
    status: "published_local",
    actorId,
    actorChanged,
    publishedAt,
    assetIds,
    expectedDraftHash,
    expectedSourceHash,
    richContentDetailAssetsApproved,
  };
  const nextCandidateData = {
    ...candidateData,
    mediaAssets: publishedAssets,
    mediaIssues: (Array.isArray(candidateData.mediaIssues) ? candidateData.mediaIssues : [])
      .filter((issue) => !(richContentDetailAssetsApproved && issue === "detail_images_require_human_review_before_rich_content")),
    mediaApprovalDraft: publishedBinding,
    mediaApprovalPublished: publishedBinding,
  };
  const persisted = await deps.persistCandidateData(nextCandidateData, {
    expectedDraftHash,
    expectedSourceHash,
    assetIds,
  });
  if (persisted === false) {
    return mediaApprovalFailure("MEDIA_APPROVAL_SOURCE_HASH_MISMATCH", "候选来源或批准草稿在发布前发生变化，请重新审查。");
  }
  const updated = await updateRun(runId, (current) => {
    const stillCurrent = String(current.payloadDraftHash || hashPayloadDraft(current.payloadDraft || {})) === expectedDraftHash
      && current.mediaApprovalDraft?.status === "approved_draft"
      && sameMediaAssetIds(current.mediaApprovalDraft?.assetIds, assetIds);
    return {
      ...current,
      mediaApprovalDraft: stillCurrent ? publishedBinding : {
        ...publishedBinding,
        status: "stale",
        staleReason: "workflow_changed_during_publish",
        staleAt: publishedAt,
      },
      locks: { ...(current.locks || {}), waitingHuman: true, submitLocked: true },
      status: "waiting_human",
      events: [
        ...(current.events || []),
        {
          time: publishedAt,
          node: current.currentNode || "preflight_check",
          type: "media_approval_published_local",
          message: "已发布本地媒体批准；未生成、上传或提交 Ozon，提交仍保持锁定。",
          data: {
            actorId,
            actorChanged,
            assetCount: assetIds.length,
            draftHash: expectedDraftHash,
            sourceHash: expectedSourceHash,
            richContentDetailAssetsApproved,
            submittedToOzon: false,
          },
        },
      ],
    };
  });
  if (updated.mediaApprovalDraft?.status === "stale") {
    if (typeof deps.rollbackCandidateData !== "function") {
      return mediaApprovalFailure("MEDIA_APPROVAL_ROLLBACK_REQUIRED", "工作流在发布期间发生变化，且缺少候选批准补偿依赖。");
    }
    const rolledBack = await deps.rollbackCandidateData({
      expectedDraftHash,
      expectedSourceHash,
      assetIds,
      reason: "workflow_changed_during_publish",
      richContentDetailAssetsApproved,
    });
    if (rolledBack === false) {
      return mediaApprovalFailure("MEDIA_APPROVAL_ROLLBACK_FAILED", "候选媒体批准补偿失败，发布绑定必须人工复核。");
    }
    return mediaApprovalFailure("MEDIA_APPROVAL_DRAFT_STALE", "工作流在发布期间发生变化，请重新审查。");
  }
  return {
    ok: true,
    status: "published_local",
    submittedToOzon: false,
    generatedMedia: false,
    uploadedMedia: false,
    richContentDetailAssetsApproved,
    workflowSummary: {
      runId: String(updated.id || runId),
      status: String(updated.status || "waiting_human"),
      currentNode: String(updated.currentNode || ""),
      submitLocked: updated.locks?.submitLocked === true,
      waitingHuman: updated.locks?.waitingHuman === true,
    },
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayloadDraft(payloadDraft = {}) {
  return `sha256:${createHash("sha256").update(canonicalJson(payloadDraft || {}), "utf8").digest("hex")}`;
}

function buildPayloadSubmissionSummary(items = []) {
  const offers = items.map((item) => String(item?.offer_id || ""));
  const prices = items.map((item) => {
    const numberOrNull = (value) => {
      const parsed = Number(value);
      return value === undefined || value === null || value === "" || !Number.isFinite(parsed) ? null : parsed;
    };
    return {
      offerId: String(item?.offer_id || ""),
      price: numberOrNull(item?.price),
      oldPrice: numberOrNull(item?.old_price),
      minPrice: numberOrNull(item?.min_price),
      currencyCode: String(item?.currency_code || ""),
    };
  });
  const numericPrices = prices.map((item) => item.price).filter(Number.isFinite);
  return {
    skuSummary: { count: items.length, offers },
    priceSummary: {
      currencyCodes: [...new Set(prices.map((item) => item.currencyCode).filter(Boolean))].sort(),
      min: numericPrices.length ? Math.min(...numericPrices) : null,
      max: numericPrices.length ? Math.max(...numericPrices) : null,
      prices,
    },
  };
}

function clonePayload(payload = {}) {
  return JSON.parse(JSON.stringify(payload || {}));
}

function applyAttributeDictionaryValue(payload = {}, input = {}) {
  const offerId = String(input.offerId || "").trim();
  const attributeId = Number(input.attributeId || 0);
  const dictionaryValueId = Number(input.dictionaryValueId || input.dictionary_value_id || 0);
  if (!attributeId) throw new Error("属性 ID 不能为空");
  if (!dictionaryValueId) throw new Error("字典值 ID 不能为空");
  const draft = clonePayload(payload);
  const items = payloadItems(draft);
  if (!items.length) throw new Error("Payload 草稿没有 items");
  const item = offerId
    ? items.find((entry) => String(entry?.offer_id || "") === offerId)
    : (items.length === 1 ? items[0] : null);
  if (!item) throw new Error("找不到要修复的 SKU: " + (offerId || "未指定"));
  if (!Array.isArray(item.attributes)) item.attributes = [];
  let attribute = item.attributes.find((entry) => Number(entry?.id || 0) === attributeId);
  if (!attribute) {
    attribute = { id: attributeId, values: [] };
    item.attributes.push(attribute);
  }
  attribute.id = attributeId;
  attribute.values = [{
    dictionary_value_id: dictionaryValueId,
    value: String(input.value || "").trim(),
  }];
  return draft;
}

function applyAttributeTextValue(payload = {}, input = {}) {
  const offerId = String(input.offerId || "").trim();
  const attributeId = Number(input.attributeId || 0);
  const value = String(input.value || "").trim();
  if (!attributeId) throw new Error("属性 ID 不能为空");
  if (!value) throw new Error("文本属性值不能为空");
  const draft = clonePayload(payload);
  const items = payloadItems(draft);
  if (!items.length) throw new Error("Payload 草稿没有 items");
  const item = offerId
    ? items.find((entry) => String(entry?.offer_id || "") === offerId)
    : (items.length === 1 ? items[0] : null);
  if (!item) throw new Error("找不到要修复的 SKU: " + (offerId || "未指定"));
  if (!Array.isArray(item.attributes)) item.attributes = [];
  let attribute = item.attributes.find((entry) => Number(entry?.id || 0) === attributeId);
  if (!attribute) {
    attribute = { id: attributeId, values: [] };
    item.attributes.push(attribute);
  }
  attribute.id = attributeId;
  attribute.values = [{ value }];
  return draft;
}

function normalizePackageRepairInfo(input = {}) {
  const packageInfo = input.packageInfo || input.package || {};
  const normalized = {
    weight: Number(packageInfo.weight || packageInfo.weightG || packageInfo.weight_g || 0),
    depth: Number(packageInfo.depth || packageInfo.lengthMm || packageInfo.length_mm || packageInfo.length || 0),
    width: Number(packageInfo.width || packageInfo.widthMm || packageInfo.width_mm || 0),
    height: Number(packageInfo.height || packageInfo.heightMm || packageInfo.height_mm || 0),
  };
  const rounded = {
    weight: Math.round(normalized.weight),
    depth: Math.round(normalized.depth),
    width: Math.round(normalized.width),
    height: Math.round(normalized.height),
  };
  if (!Number.isFinite(normalized.weight) || rounded.weight < 1
    || !Number.isFinite(normalized.depth) || rounded.depth < 1
    || !Number.isFinite(normalized.width) || rounded.width < 1
    || !Number.isFinite(normalized.height) || rounded.height < 1) {
    throw new Error("包装尺重修复必须提供重量和长宽高。");
  }
  return rounded;
}

function trustedPackageRepairSource(input = {}) {
  const source = String(input.packageInfoSource || input.source || "").trim();
  const allowed = new Set(["1688_package", "manual_measurement", "manual_measured", "supplier_package"]);
  if (!allowed.has(source)) {
    throw new Error("包装尺重修复必须来自可信尺重来源。");
  }
  return source;
}

function applyPackageInfoValue(payload = {}, input = {}) {
  const offerId = String(input.offerId || "").trim();
  const packageInfo = normalizePackageRepairInfo(input);
  const draft = clonePayload(payload);
  const items = payloadItems(draft);
  if (!items.length) throw new Error("Payload 草稿没有 items");
  const item = offerId
    ? items.find((entry) => String(entry?.offer_id || "") === offerId)
    : (items.length === 1 ? items[0] : null);
  if (!item) throw new Error("找不到要修复尺重的 SKU: " + (offerId || "未指定"));
  item.weight = packageInfo.weight;
  item.depth = packageInfo.depth;
  item.width = packageInfo.width;
  item.height = packageInfo.height;
  return { draft, packageInfo };
}

function assertSourceSuggestedVariantTextRepair(run = {}, input = {}) {
  if (input.sourceSuggestedAspect !== true) return false;
  const offerId = String(input.offerId || "").trim();
  const attributeId = Number(input.attributeId || 0);
  const value = String(input.value || "").trim();
  const variantConfiguration = buildVariantConfigurationSummary({
    payload: run.payloadDraft || {},
    attrsMeta: run.payloadDraftAttrsMeta || [],
    sourceVariants: run.payloadDraftSourceVariants || [],
  });
  const row = (variantConfiguration.rows || []).find((entry) => String(entry.offerId || "") === offerId);
  const matched = (row?.suggestedAspects || []).find((aspect) => (
    Number(aspect.attributeId || 0) === attributeId
    && String(aspect.value || "").trim() === value
    && aspect.readOnly === true
    && aspect.source === "1688_sku_spec"
  ));
  if (!matched) {
    throw new Error("变体文本值不匹配当前预检候选，请重新预检后再确认写回。");
  }
  return true;
}

export async function applyPayloadDraftAttributeRepair(runId, input = {}) {
  if (input.confirmLocalDraftRepair !== true) {
    throw new Error("需要人工确认后才能写回本地 Payload 草稿。");
  }
  const run = await getWorkflowRun(runId);
  if (!run) throw new Error("工作流不存在: " + runId);
  const previousDraftHash = String(run.payloadDraftHash || hashPayloadDraft(run.payloadDraft || {})).trim();
  if (run.status !== "waiting_human" && run.locks?.waitingHuman !== true) {
    throw new Error("需要工作流处于等待人工状态，才能写回本地 Payload 草稿。");
  }
  const repairType = String(input.repairType || "dictionary_value").trim();
  if (!["dictionary_value", "text_value", "variant_text_value", "package_info"].includes(repairType)) throw new Error("不支持的属性修复类型。");
  const categoryCache = await loadCategoryCache();
  const attributeMatrix = buildListingAttributeMatrix({
    payload: run.payloadDraft || {},
    attrsMeta: run.payloadDraftAttrsMeta || [],
    dictionaryValueCache: categoryCache.attributeValues || {},
    sourceVariants: run.payloadDraftSourceVariants || [],
  });
  const offerId = String(input.offerId || "").trim();
  const attributeId = Number(input.attributeId || 0);
  const dictionaryValueId = Number(input.dictionaryValueId || input.dictionary_value_id || 0);
  const row = (attributeMatrix.rows || []).find((entry) => Number(entry.attributeId || 0) === attributeId);
  const cell = (row?.cells || []).find((entry) => String(entry.offerId || "") === offerId);
  let payloadDraft = null;
  let repairData = {};
  if (repairType === "dictionary_value") {
    const canRepairDictionaryCell = cell?.status === "invalid_dictionary" || (cell?.status === "missing" && row?.dictionary);
    if (!row || !cell || !canRepairDictionaryCell) {
      throw new Error("只能修复当前矩阵中非法或缺失的字典值。");
    }
    const candidate = (cell.repairGuidance?.dictionaryCandidates || [])
      .find((entry) => Number(entry.dictionary_value_id || 0) === dictionaryValueId);
    if (!candidate) {
      throw new Error("字典值不在当前属性矩阵候选值内，请重新预检后再选择。");
    }
    payloadDraft = applyAttributeDictionaryValue(run.payloadDraft || {}, {
      ...input,
      value: candidate.value || input.value || "",
    });
    const sourceSuggestedAspect = candidate.source === "1688_sku_spec_dictionary_match";
    repairData = {
      dictionaryValueId,
      sourceSuggestedAspect,
      sourceValue: sourceSuggestedAspect ? (candidate.sourceValue || "") : "",
      sourceVariantSpec: sourceSuggestedAspect ? (candidate.sourceVariantSpec || "") : "",
    };
  } else if (repairType === "text_value") {
    if (!row || !cell || cell.status !== "missing" || row.dictionary || row.aspect) {
      throw new Error("只能修复缺失的普通文本属性，字典和变体属性请人工处理。");
    }
    payloadDraft = applyAttributeTextValue(run.payloadDraft || {}, input);
    repairData = { value: String(input.value || "").trim() };
  } else if (repairType === "variant_text_value") {
    if (!row || !cell || cell.status !== "missing" || !row.aspect || row.dictionary) {
      throw new Error("只能修复缺失的非字典变体文本属性。");
    }
    const sourceSuggestedAspect = assertSourceSuggestedVariantTextRepair(run, input);
    payloadDraft = applyAttributeTextValue(run.payloadDraft || {}, input);
    repairData = { value: String(input.value || "").trim(), sourceSuggestedAspect };
  } else {
    const packageInfoSource = trustedPackageRepairSource(input);
    const packageResult = applyPackageInfoValue(run.payloadDraft || {}, input);
    payloadDraft = packageResult.draft;
    repairData = {
      packageInfoSource,
      packageInfo: packageResult.packageInfo,
    };
  }
  await savePayloadDraft(runId, payloadDraft, {
    attrsMeta: run.payloadDraftAttrsMeta || [],
    sourceVariants: run.payloadDraftSourceVariants || [],
  });
  const validation = await validatePayloadDraft(runId);
  const draftHash = String(validation?.draftHash || "").trim();
  const updated = await updateRun(runId, (current) => ({
    ...current,
    locks: {
      ...(current.locks || {}),
      submitLocked: true,
    },
    events: [
      ...(current.events || []),
      {
        time: nowIso(),
        node: current.currentNode || "preflight_check",
        type: "payload_attribute_repair_applied",
        message: "人工确认后写回本地 Payload 草稿，并已重新预检；未提交 Ozon。",
        data: {
          repairType,
          offerId: String(input.offerId || ""),
          attributeId: Number(input.attributeId || 0),
          ...repairData,
          note: String(input.note || ""),
          submittedToOzon: false,
        },
      },
    ],
  }));
  return {
    ok: Boolean(validation?.ok),
    submittedToOzon: false,
    validation,
    draftHash,
    previousDraftHash,
    draftHashInvalidated: Boolean(previousDraftHash && draftHash && previousDraftHash !== draftHash),
    preflight: {
      status: validation?.ok ? "revalidated" : "blocked",
      draftHash,
      previousDraftHash,
      confirmationInvalidated: Boolean(previousDraftHash && draftHash && previousDraftHash !== draftHash),
      nextAction: validation?.ok ? "预检已针对新草稿通过；重新人工确认后才能提交。" : "修复剩余问题后再次运行预检。",
    },
    run: updated,
    payloadDraft: updated.payloadDraft,
  };
}

export async function validatePayloadDraft(runId) {
  const categoryCache = await loadCategoryCache();
  const run = await updateRun(runId, (current) => {
    const { validation } = buildPayloadDraftValidationForRun(
      current,
      current.payloadDraft || {},
      categoryCache.attributeValues || {},
    );
    const draftHash = hashPayloadDraft(current.payloadDraft || {});
    return {
      ...current,
      payloadDraftHash: draftHash,
      payloadDraftValidation: { ...validation, draftHash },
      locks: { ...(current.locks || {}), submitLocked: !validation.ok },
    };
  });
  return run.payloadDraftValidation;
}

function requireSubmitDep(deps = {}, key) {
  if (typeof deps[key] !== "function") throw new Error(`缺少 payload 提交依赖: ${key}`);
  return deps[key];
}

function extractTaskId(result = {}) {
  return result?.result?.task_id || result?.result?.taskId || result?.task_id || result?.taskId || "";
}

function reservePayloadSubmission(runId, draftHash, storeId) {
  return mutateStore((store) => {
    const index = store.items.findIndex((item) => item.id === runId);
    if (index < 0) throw new Error("工作流不存在: " + runId);
    const run = store.items[index];
    const currentHash = hashPayloadDraft(run.payloadDraft || {});
    if (currentHash !== draftHash) {
      return { write: false, value: { acquired: false, status: "draft_changed", currentDraftHash: currentHash } };
    }
    const existing = run.submissionReservation;
    if (existing) {
      if (existing.draftHash !== draftHash) {
        if (existing.state !== "completed") {
          return { write: false, value: { acquired: false, status: "conflict" } };
        }
      } else {
        return { write: false, value: { acquired: false, status: existing.state, reservation: existing } };
      }
    }
    const reservation = {
      state: "in_progress",
      draftHash,
      storeId,
      reservedAt: nowIso(),
    };
    store.items[index] = {
      ...run,
      submissionReservation: reservation,
      locks: { ...(run.locks || {}), submitLocked: true },
      updatedAt: nowIso(),
    };
    return { value: { acquired: true, status: "in_progress", reservation } };
  });
}

function finishPayloadSubmissionReservation(runId, draftHash, state, summary = {}) {
  return mutateStore((store) => {
    const index = store.items.findIndex((item) => item.id === runId);
    if (index < 0) throw new Error("工作流不存在: " + runId);
    const run = store.items[index];
    const reservation = run.submissionReservation;
    if (!reservation || reservation.draftHash !== draftHash || reservation.state !== "in_progress") {
      return { write: false, value: null };
    }
    const nextReservation = {
      ...reservation,
      state,
      finishedAt: nowIso(),
      taskId: String(summary.taskId || ""),
      reasonCode: String(summary.reasonCode || ""),
    };
    store.items[index] = {
      ...run,
      submissionReservation: nextReservation,
      locks: {
        ...(run.locks || {}),
        submitLocked: true,
        ...(state === "needs_review" ? { waitingHuman: true } : {}),
      },
      ...(state === "needs_review" ? { status: "waiting_human" } : {}),
      updatedAt: nowIso(),
    };
    return { value: nextReservation };
  });
}

export async function submitPayloadDraftToOzon(runId, input = {}, deps = {}) {
  let run = await getWorkflowRun(runId);
  if (!run) throw new Error("工作流不存在: " + runId);
  if (run.locks?.paused || run.status === "paused") {
    return { ok: false, status: "paused", message: "工作流已暂停，不能提交 Ozon。" };
  }
  const existingReservation = run.submissionReservation;
  const existingDraftHash = hashPayloadDraft(run.payloadDraft || {});
  if (existingReservation?.draftHash === existingDraftHash) {
    if (existingReservation.state === "needs_review") {
      return {
        ok: false,
        status: "needs_review",
        reasonCode: "OZON_SUBMISSION_OUTCOME_UNKNOWN",
        message: "此前提交结果未知，必须人工回查 Ozon；不能自动重试。",
      };
    }
    if (existingReservation.state === "completed") {
      return {
        ok: true,
        status: "replay",
        taskId: existingReservation.taskId || "",
        storeId: existingReservation.storeId || "",
        draftHash: existingDraftHash,
      };
    }
  }
  if (run.locks?.waitingHuman || run.status === "waiting_human") {
    return { ok: false, status: "waiting_human", message: "工作流正在等待人工处理，不能提交 Ozon。" };
  }
  const requestedStoreId = String(input.storeId || "").trim();
  const boundStoreId = String(run.entity?.storeId || "").trim();
  if (boundStoreId && requestedStoreId && requestedStoreId !== boundStoreId) {
    return {
      ok: false,
      status: "blocked",
      reasonCode: "WORKFLOW_STORE_MISMATCH",
      message: "提交店铺与当前工作流绑定店铺不一致，已拒绝提交。",
    };
  }
  if (!boundStoreId && !requestedStoreId) {
    return {
      ok: false,
      status: "confirmation_required",
      reasonCode: "WORKFLOW_STORE_REQUIRED",
      message: "当前工作流尚未绑定店铺，请明确选择店铺后再提交。",
    };
  }
  let storeId = boundStoreId || requestedStoreId;
  if (!boundStoreId) {
    let concurrentStoreId = "";
    run = await updateRun(runId, (current) => {
      const currentStoreId = String(current.entity?.storeId || "").trim();
      if (currentStoreId && currentStoreId !== requestedStoreId) {
        concurrentStoreId = currentStoreId;
        return current;
      }
      return {
        ...current,
        entity: { ...(current.entity || {}), storeId: requestedStoreId },
      };
    });
    if (concurrentStoreId) {
      return {
        ok: false,
        status: "blocked",
        reasonCode: "WORKFLOW_STORE_MISMATCH",
        message: "工作流已被绑定到其他店铺，已拒绝提交。",
      };
    }
    storeId = String(run.entity?.storeId || "").trim();
  }
  const payloadDraft = run.payloadDraft || {};
  const currentDraftHash = hashPayloadDraft(payloadDraft);
  const items = payloadItems(payloadDraft);
  const categoryCache = await loadCategoryCache();
  const dictionaryValueCache = categoryCache.attributeValues || {};
  if (!items.length) {
    const { validation, gateNode } = buildPayloadDraftValidationForRun(run, payloadDraft, dictionaryValueCache);
    await upsertWorkflowNode(runId, {
      ...(gateNode || {
        key: "preflight_check",
        name: "提交前总闸",
        status: "failed",
        output: validation,
        runStatus: "waiting_human",
        reason: "没有可提交的 Payload 草稿。",
        recommendedActions: ["保存 Payload 草稿", "重新校验 Payload"],
        actions: ["edit_payload", "validate_payload"],
      }),
    });
    return { ok: false, status: "blocked", validation };
  }

  const { validation, gateNode } = buildPayloadDraftValidationForRun(run, payloadDraft, dictionaryValueCache);
  if (!validation.ok) {
    await upsertWorkflowNode(runId, gateNode || buildPreflightGateNode({
      payload: payloadDraft,
      attrsMeta: run.payloadDraftAttrsMeta || [],
      sourceVariants: run.payloadDraftSourceVariants || [],
      listingQuality: validation.listingQuality,
      attributeMatrix: validation.attributeMatrix,
      requiredAttributeFillPlan: validation.requiredAttributeFillPlan,
    }));
    await updateRun(runId, (current) => ({
      ...current,
      payloadDraftValidation: validation,
      locks: { ...(current.locks || {}), submitLocked: true, waitingHuman: true },
    }));
    return { ok: false, status: "blocked", validation };
  }

  await upsertWorkflowNode(runId, gateNode || buildPreflightGateNode({
    payload: payloadDraft,
    attrsMeta: run.payloadDraftAttrsMeta || [],
    sourceVariants: run.payloadDraftSourceVariants || [],
    listingQuality: validation.listingQuality,
    attributeMatrix: validation.attributeMatrix,
    requiredAttributeFillPlan: validation.requiredAttributeFillPlan,
  }));
  await updateRun(runId, (current) => ({
    ...current,
    payloadDraftValidation: validation,
    locks: { ...(current.locks || {}), submitLocked: false },
  }));

  if (input.confirmSubmit !== true) {
    return {
      ok: false,
      status: "confirmation_required",
      validation,
      currentDraftHash,
      message: "需要人工二次确认后才能提交 Ozon。",
    };
  }

  const expectedDraftHash = String(input.expectedDraftHash || "").trim();
  if (!expectedDraftHash) {
    return {
      ok: false,
      status: "confirmation_required",
      reasonCode: "EXPECTED_DRAFT_HASH_REQUIRED",
      validation: { ...validation, draftHash: currentDraftHash },
      currentDraftHash,
      message: "确认提交必须绑定当前 Payload 草稿版本。请重新检查并确认草稿。",
    };
  }
  if (expectedDraftHash !== currentDraftHash) {
    return {
      ok: false,
      status: "confirmation_required",
      reasonCode: "DRAFT_HASH_MISMATCH",
      validation: { ...validation, draftHash: currentDraftHash },
      expectedDraftHash,
      currentDraftHash,
      message: "Payload 草稿已在确认后发生变化，请重新检查并确认。",
    };
  }

  const getStore = requireSubmitDep(deps, "getStore");
  const ozonRequest = requireSubmitDep(deps, "ozonRequest");
  const store = getStore(storeId);
  const reservation = await reservePayloadSubmission(runId, currentDraftHash, storeId);
  if (!reservation.acquired) {
    if (reservation.status === "completed") {
      return {
        ok: true,
        status: "replay",
        taskId: reservation.reservation?.taskId || "",
        storeId,
        draftHash: currentDraftHash,
      };
    }
    if (reservation.status === "needs_review") {
      return {
        ok: false,
        status: "needs_review",
        reasonCode: "OZON_SUBMISSION_OUTCOME_UNKNOWN",
        message: "此前提交结果未知，必须人工回查 Ozon；不能自动重试。",
      };
    }
    return {
      ok: false,
      status: reservation.status === "in_progress" ? "in_progress" : "conflict",
      statusCode: 409,
      reasonCode: reservation.status === "in_progress" ? "OZON_SUBMISSION_IN_PROGRESS" : "OZON_SUBMISSION_RESERVATION_CONFLICT",
      message: "同一 Payload 草稿已有提交占位，不能重复提交。",
    };
  }
  const submitPayload = { items };
  const submissionSummary = buildPayloadSubmissionSummary(items);
  let result;
  try {
    result = await ozonRequest(store, "/v3/product/import", submitPayload);
  } catch {
    await finishPayloadSubmissionReservation(runId, currentDraftHash, "needs_review", {
      reasonCode: "OZON_SUBMISSION_OUTCOME_UNKNOWN",
    });
    return {
      ok: false,
      status: "needs_review",
      reasonCode: "OZON_SUBMISSION_OUTCOME_UNKNOWN",
      message: "Ozon 提交结果未知，必须人工回查；系统不会自动重试。",
    };
  }
  const taskId = extractTaskId(result);
  // A 2xx response without a task id cannot be reconciled to an Ozon import
  // job. Treat it as an unknown outcome and keep the reservation occupied;
  // otherwise the UI would claim "submitted" while a retry could create a
  // duplicate product.
  if (!String(taskId || "").trim()) {
    await finishPayloadSubmissionReservation(runId, currentDraftHash, "needs_review", {
      reasonCode: "OZON_SUBMISSION_TASK_ID_MISSING",
    });
    await upsertWorkflowNode(runId, {
      key: "ozon_submit",
      name: "Ozon 提交",
      status: "failed",
      output: {
        ok: false,
        taskId: "",
        storeId,
        offerCount: items.length,
        offers: items.map((item) => String(item.offer_id || "")),
        draftHash: currentDraftHash,
        ...submissionSummary,
        responseReceived: true,
        outcome: "unknown",
        reasonCode: "OZON_SUBMISSION_TASK_ID_MISSING",
      },
      runStatus: "waiting_human",
      branch: "needs_review",
      riskScore: 95,
      riskLevel: "high",
      reason: "Ozon 返回成功响应但没有 task_id，无法确认本次提交结果。",
      recommendedActions: ["使用当前店铺和草稿范围回查提交结果", "确认没有已创建商品前不要重试", "结果明确后再处理审核回执"],
      actions: ["reconcile_submission", "manual_review"],
    });
    await appendWorkflowEvent(runId, {
      node: "ozon_submit",
      type: "payload_draft_submission_needs_review",
      message: "Ozon 响应缺少 task_id，提交结果转人工复核；系统不会自动重试。",
      data: {
        reasonCode: "OZON_SUBMISSION_TASK_ID_MISSING",
        storeId,
        offerCount: items.length,
        offers: items.map((item) => String(item.offer_id || "")),
        draftHash: currentDraftHash,
      },
    });
    const reviewRun = await getWorkflowRun(runId);
    return {
      ok: false,
      status: "needs_review",
      reasonCode: "OZON_SUBMISSION_TASK_ID_MISSING",
      storeId,
      draftHash: currentDraftHash,
      message: "Ozon 返回了响应但没有 task_id，无法确认提交结果；系统不会自动重试。",
      run: reviewRun,
    };
  }
  await finishPayloadSubmissionReservation(runId, currentDraftHash, "completed", { taskId });

  await upsertWorkflowNode(runId, {
    key: "ozon_submit",
    name: "Ozon 提交",
    status: "success",
    output: {
      ok: true,
      taskId,
      storeId,
      offerCount: items.length,
      offers: items.map((item) => String(item.offer_id || "")),
      draftHash: currentDraftHash,
      ...submissionSummary,
      result,
    },
    runStatus: "running",
    branch: "submitted",
    riskScore: 20,
    riskLevel: "low",
    reason: "Payload 草稿已由人工确认并提交到 Ozon。",
    recommendedActions: ["等待审核回执", "查看 review_reconcile"],
    actions: ["view_output"],
  });
  await appendWorkflowEvent(runId, {
    node: "ozon_submit",
    type: "payload_draft_submitted",
    message: "人工确认后提交 Payload 草稿到 Ozon",
    data: {
      taskId,
      storeId,
      offerCount: items.length,
      offers: items.map((item) => String(item.offer_id || "")),
      draftHash: currentDraftHash,
      ...submissionSummary,
    },
  });
  const updated = await updateRun(runId, (current) => ({
    ...current,
    status: "running",
    entity: {
      ...(current.entity || {}),
      storeId,
      taskId,
    },
    locks: {
      ...(current.locks || {}),
      waitingHuman: false,
      submitLocked: true,
    },
  }));

  return {
    ok: true,
    status: "submitted",
    taskId,
    storeId,
    offerCount: items.length,
    result,
    run: updated,
  };
}

export async function findOrCreateWorkflowForAutoListingJob(job = {}) {
  const autoListingJobId = String(job.id || "").trim();
  if (!autoListingJobId) throw new Error("自动上架任务 ID 不能为空");
  const store = await readStore();
  const existing = store.items.find((run) => run.entity?.autoListingJobId === autoListingJobId);
  const entityPatch = {
    autoListingJobId,
    source: String(job.source || job.candidateData?.source || "").trim(),
    ...(job.candidateData?.sourceEvidence ? { sourceEvidence: job.candidateData.sourceEvidence } : {}),
    candidateId: job.bestMatch?.candidateId || job.bestMatch?.id || job.candidateId || "",
    candidateUrl: job.bestMatch?.candidateUrl || job.candidateData?.url || job.url || "",
    parentSku: job.listingResult?.sku || job.pendingParentSku || job.parentSku || "",
    taskId: job.listingResult?.taskId || job.taskId || "",
    storeId: job.listingResult?.storeId || job.storeId || "",
    ...(job.listingResult?.stockReadiness ? { stockReadiness: job.listingResult.stockReadiness } : {}),
  };
  if (existing) {
    return updateRun(existing.id, (run) => ({
      ...run,
      entity: {
        ...(run.entity || {}),
        ...Object.fromEntries(Object.entries(entityPatch).filter(([, value]) => value !== "")),
      },
    }));
  }
  return createWorkflowRun({
    source: "auto_listing",
    title: job.bestMatch?.candidateTitle || job.ozonTitle || job.title || autoListingJobId,
    entity: entityPatch,
  });
}

export function workflowNodeFromAutoListingStage(stage = "", data = {}) {
  const normalized = String(stage || "").trim();
  const map = {
    sampled: { key: "ozon_learning", name: "Ozon 学习样本" },
    translating: { key: "keyword_expand", name: "关键词翻译与扩展" },
    searching_1688: { key: "crawler_1688", name: "1688 采集任务" },
    waiting_crawl: { key: "crawler_1688", name: "1688 采集任务" },
    crawled: { key: "candidate_parse", name: "候选解析" },
    sourcing_gate: { key: "candidate_parse", name: "候选解析" },
    matching: { key: "match_profit", name: "匹配与利润分析" },
    generating_content: { key: "content_generate", name: "内容生成" },
    guided: { key: "content_generate", name: "内容生成" },
    ready_for_listing: { key: "content_generate", name: "内容生成" },
    needs_review: { key: "content_generate", name: "内容生成" },
  };
  const mapped = map[normalized] || map[String(data.status || "").trim()] || { key: normalized || "auto_listing", name: normalized || "自动上架" };
  const decision = recommendWorkflowDecision(mapped.key, data);
  const pricingDiagnosis = normalizeWorkflowPricingDiagnosis(data.pricingDiagnosis || null);
  const pricingRisk = mapped.key === "match_profit" ? evaluatePricingRisk(pricingDiagnosis) : null;
  const pricingDecision = pricingRisk ? {
    branch: pricingRisk.branch,
    riskScore: pricingRisk.riskScore,
    riskLevel: pricingRisk.riskLevel,
    reason: pricingRisk.reason,
    recommendedActions: pricingRisk.recommendedActions,
  } : null;
  const diagnosis = pricingRisk?.diagnosis || (pricingDiagnosis && mapped.key === "match_profit"
    ? {
      reasonCode: "PRICING_DIAGNOSIS_READY",
      messageZh: "定价诊断已生成：售价 " + pricingDiagnosis.priceCny + " CNY，运费等级 " + (pricingDiagnosis.level?.name || "-") + "，运费 " + pricingDiagnosis.logisticsFee + " CNY。",
      fixHints: [
        "检查采购成本、5 RMB 缓冲、运费等级、佣金、杂费和利润是否符合预期。",
        "若运费等级、尺重或最低价异常，先修正候选尺重/价格，再重新生成 Payload 草稿。",
      ],
      guidance: "此诊断只解释价格来源，不绕过 Payload 预检和人工提交确认。",
    }
    : (data.diagnosis || data.diagnostic || {}));
  const status = pricingRisk
    ? "waiting_human"
    : data.nodeStatus || (["ready_for_listing", "needs_review", "crawled", "sourcing_gate"].includes(normalized) ? "success" : "running");
  return {
    key: mapped.key,
    name: mapped.name,
    status,
    branch: pricingDecision?.branch || decision.branch,
    riskScore: pricingDecision?.riskScore ?? decision.riskScore,
    riskLevel: pricingDecision?.riskLevel || decision.riskLevel,
    reason: pricingDecision?.reason || decision.reason,
    recommendedActions: pricingDecision?.recommendedActions || decision.recommendedActions,
    output: {
      sourceType: data.sourceType || "",
      sourceValue: data.sourceValue || "",
      sourceText: data.sourceText || "",
      keyword: data.keyword || "",
      searchKeywords: Array.isArray(data.searchKeywords) ? data.searchKeywords : [],
      keywordCount: Array.isArray(data.searchKeywords) ? data.searchKeywords.length : 0,
      totalFound: Number(data.totalFound || 0),
      detailQueued: Number(data.detailQueued || 0),
      detailedCount: Number(data.detailedCount || 0),
      opportunityCount: Number(data.opportunityCount || 0),
      priceMinRub: Number(data.priceMinRub || 0),
      priceMaxRub: Number(data.priceMaxRub || 0),
      categoryCounts: data.categoryCounts || {},
      sampleTitles: Array.isArray(data.sampleTitles) ? data.sampleTitles : [],
      crawlerTaskIds: Array.isArray(data.crawlerTaskIds) ? data.crawlerTaskIds : [],
      candidateCount: Number(data.candidateCount || 0),
      evaluatedCount: Number(data.evaluatedCount || 0),
      acceptedCount: Number(data.acceptedCount || 0),
      rejectedCount: Number(data.rejectedCount || 0),
      rejectedReasons: data.rejectedReasons || {},
      rejectedSamples: Array.isArray(data.rejectedSamples) ? data.rejectedSamples : [],
      bestMatch: data.bestMatch || null,
      listingContentReady: Boolean(data.listingContentReady),
      titleRu: String(data.titleRu || ""),
      descriptionLength: Number(data.descriptionLength || 0),
      attributeHintKeys: Array.isArray(data.attributeHintKeys) ? data.attributeHintKeys : [],
      candidateImageCount: Number(data.candidateImageCount || 0),
      skuVariantCount: Number(data.skuVariantCount || 0),
      sizeWeightReady: Boolean(data.sizeWeightReady),
      visualCardReady: Boolean(data.visualCardReady),
      contentIssues: Array.isArray(data.contentIssues) ? data.contentIssues : [],
      pricingDiagnosis,
    },
    diagnosis,
    actions: data.actions || ["view_output"],
  };
}

function evaluatePricingRisk(pricingDiagnosis) {
  if (!pricingDiagnosis) return null;
  if (pricingDiagnosis.procurementEvidence?.status === "blocked") {
    return pricingRiskPayload({
      branch: "blocked",
      riskScore: 94,
      riskLevel: "high",
      reasonCode: "PRICING_PROCUREMENT_EVIDENCE_MISSING",
      messageZh: "定价阻塞：缺少可信供应商、MOQ 或阶梯价证据。",
      reason: "1688 展示价不能替代真实采购数量和阶梯成本，继续计算会伪造利润结论。",
      recommendedActions: ["补充供应商与 MOQ", "读取数量绑定阶梯价", "人工确认采购成本证据"],
    });
  }
  // Complete-but-manual procurement fields are still unverified.  Do not let
  // a seller-entered MOQ/tier price reach the submit gate merely because the
  // shape is complete; it would turn an assumed cost into a false margin.
  if (pricingDiagnosis.procurementEvidence?.status === "needs_review") {
    return pricingRiskPayload({
      branch: "blocked",
      riskScore: 93,
      riskLevel: "high",
      reasonCode: "PRICING_PROCUREMENT_EVIDENCE_REVIEW_REQUIRED",
      messageZh: "定价阻塞：采购 MOQ 和阶梯价来自手工字段，尚未完成来源复核。",
      reason: "手工采购字段不能证明当前供应商数量绑定成本，禁止进入 Ozon 提交。",
      recommendedActions: ["回放当前 1688 快照", "核对 MOQ 与数量绑定阶梯价", "完成采购证据人工确认后重新预检"],
    });
  }
  const pkg = pricingDiagnosis.package || {};
  const price = Number(pricingDiagnosis.priceCny || 0);
  const minPrice = Number(pricingDiagnosis.minPriceCny || 0);
  const logisticsFee = Number(pricingDiagnosis.logisticsFee || 0);
  const profit = Number(pricingDiagnosis.profit || 0);
  const profitRate = price > 0 ? profit / price : 0;
  const logisticsRatio = price > 0 ? logisticsFee / price : 0;
  const hasPackage = Number(pkg.weightG || 0) > 0
    && Number(pkg.lengthMm || 0) > 0
    && Number(pkg.widthMm || 0) > 0
    && Number(pkg.heightMm || 0) > 0;

  if (!hasPackage) {
    return pricingRiskPayload({
      branch: "blocked",
      riskScore: 92,
      riskLevel: "high",
      reasonCode: "PRICING_PACKAGE_MISSING",
      messageZh: "定价阻塞：缺少完整尺重，无法确认运费和售价安全性。",
      reason: "价格计算缺少完整尺重，继续上架会导致运费和利润判断失真。",
      recommendedActions: ["补齐商品尺重", "重新解析 1688 详情", "重新生成 Payload 草稿"],
    });
  }
  if (!pricingDiagnosis.level?.id) {
    return pricingRiskPayload({
      branch: "blocked",
      riskScore: 90,
      riskLevel: "high",
      reasonCode: "PRICING_SHIPPING_LEVEL_MISSING",
      messageZh: "定价阻塞：无法匹配运费等级。",
      reason: "售价、重量或尺寸不在现有运费等级范围内。",
      recommendedActions: ["检查尺重单位", "调整售价或换货源", "维护运费等级配置"],
    });
  }
  if (pricingDiagnosis.converged === false) {
    return pricingRiskPayload({
      branch: "blocked",
      riskScore: 88,
      riskLevel: "high",
      reasonCode: "PRICING_NOT_CONVERGED",
      messageZh: "定价阻塞：价格迭代未收敛。",
      reason: "价格在不同运费等级间跳变，不能安全生成最终售价。",
      recommendedActions: ["检查运费等级边界", "人工指定售价", "重新计算价格"],
    });
  }
  const commissionSource = pricingDiagnosis.commissionSource || {};
  const commissionRate = Number(pricingDiagnosis.commissionRate || 0);
  // A category commission is only safe to use when the diagnosis can point
  // back to the exact read/evidence snapshot and its effective date.  A
  // caller-provided percentage without those fields is still an assumption;
  // do not let it silently pass the pricing gate as current Ozon truth.
  if (commissionSource.source === "ozon_category"
    && (!String(commissionSource.evidenceRef || "").trim()
      || !String(commissionSource.updatedAt || "").trim())) {
    return pricingRiskPayload({
      branch: "blocked",
      riskScore: 94,
      riskLevel: "high",
      reasonCode: "PRICING_COMMISSION_EVIDENCE_UNTRACEABLE",
      messageZh: "定价阻塞：类目佣金缺少可追溯证据或读取时间。",
      reason: "类目佣金比例必须绑定当前读取回执和更新时间，不能只凭手填比例计算利润。",
      recommendedActions: ["读取当前店铺/类目佣金", "补充佣金证据引用和更新时间", "确认后重新计算价格"],
    });
  }
  if (!commissionRate || commissionSource.source === "manual_default" || commissionSource.confidence === "low") {
    return pricingRiskPayload({
      branch: "blocked",
      riskScore: 93,
      riskLevel: "high",
      reasonCode: "PRICING_COMMISSION_SOURCE_MISSING",
      messageZh: "定价阻塞：缺少当前类目的可信佣金证据。",
      reason: "默认佣金率不能替代当前 Ozon 类目或商品的佣金读取，继续提交会伪造利润结论。",
      recommendedActions: ["读取当前店铺商品佣金", "补充同类商品佣金证据", "确认后重新计算价格"],
    });
  }
  if (!price || minPrice <= 0 || minPrice >= price) {
    return pricingRiskPayload({
      branch: "blocked",
      riskScore: 84,
      riskLevel: "high",
      reasonCode: "PRICING_MIN_PRICE_INVALID",
      messageZh: "定价阻塞：最低价为空或不低于售价。",
      reason: "Ozon 最低价需要低于售价，否则促销和提交存在风险。",
      recommendedActions: ["重新生成最低价", "人工检查售价", "重新校验 Payload"],
    });
  }
  if (profit <= 0 || profitRate < 0.08) {
    return pricingRiskPayload({
      branch: "manual_review",
      riskScore: 68,
      riskLevel: "medium",
      reasonCode: "PRICING_PROFIT_LOW",
      messageZh: "定价需人工复核：预计利润偏低。",
      reason: "预计利润偏低，自动继续可能导致亏损或安全边际不足。",
      recommendedActions: ["复核采购价和运费", "提高售价", "换一个利润更高的货源"],
    });
  }
  if (logisticsRatio > 0.35) {
    return pricingRiskPayload({
      branch: "manual_review",
      riskScore: 62,
      riskLevel: "medium",
      reasonCode: "PRICING_LOGISTICS_RATIO_HIGH",
      messageZh: "定价需人工复核：运费占售价比例过高。",
      reason: "运费占售价超过 35%，商品利润对尺重误差敏感。",
      recommendedActions: ["复核尺重", "检查是否可换轻小货源", "人工确认售价"],
    });
  }
  return null;
}

function pricingRiskPayload({ branch, riskScore, riskLevel, reasonCode, messageZh, reason, recommendedActions }) {
  return {
    branch,
    riskScore,
    riskLevel,
    reason,
    recommendedActions,
    diagnosis: {
      reasonCode,
      messageZh,
      fixHints: recommendedActions,
      guidance: "价格风险会暂停流程，必须人工确认或修正后再继续。",
    },
  };
}

function normalizeWorkflowPricingDiagnosis(input) {
  if (!input || typeof input !== "object") return null;
  const priceCny = Number(input.priceCny ?? input.price ?? 0);
  if (!Number.isFinite(priceCny) || priceCny <= 0) return null;
  const normalized = {
    purchaseCost: Number(input.purchaseCost || 0),
    purchaseMarkupRmb: Number(input.purchaseMarkupRmb || 0),
    sourcePriceCny: Number(input.sourcePriceCny || 0),
    priceCny,
    oldPriceCny: Number(input.oldPriceCny || 0),
    minPriceCny: String(input.minPriceCny || ""),
    currencyCode: String(input.currencyCode || "CNY"),
    logisticsFee: Number(input.logisticsFee || 0),
    commission: Number(input.commission || 0),
    commissionRate: Number(input.commissionRate || 0),
    commissionSource: input.commissionSource && typeof input.commissionSource === "object"
      ? { ...input.commissionSource }
      : null,
    miscFee: Number(input.miscFee || 0),
    baseCost: Number(input.baseCost || 0),
    profit: Number(input.profit || 0),
    profitRate: Number(input.profitRate || 0),
    profitStatus: String(input.profitStatus || "unknown"),
    profitConclusion: String(input.profitConclusion || "unknown_without_cost_commission_and_settlement_rules"),
    profitEvidence: input.profitEvidence && typeof input.profitEvidence === "object"
      ? { ...input.profitEvidence }
      : null,
    converged: input.converged !== false,
    level: input.level || null,
    package: input.package || {},
    packageInfoSource: String(input.packageInfoSource || input.package?.source || ""),
    procurementEvidence:
      input.procurementEvidence && typeof input.procurementEvidence === "object"
        ? { ...input.procurementEvidence }
        : null,
    steps: Array.isArray(input.steps) ? input.steps : [],
    variants: Array.isArray(input.variants) ? input.variants : [],
  };
  return normalized;
}

export function recommendWorkflowDecision(nodeKey = "", data = {}) {
  const key = String(nodeKey || "");
  const nodeStatus = String(data.nodeStatus || data.status || "");
  const bestMatch = data.bestMatch || {};
  const tier = String(bestMatch.tier || "");
  const margin = Number(bestMatch.margin ?? data.margin ?? 0);
  const confidence = Number(bestMatch.confidence ?? data.confidence ?? 0);
  const rejectedCount = Number(data.rejectedCount || 0);
  const acceptedCount = Number(data.acceptedCount || 0);
  const issueCount = Number(data.issueCount || data.issues?.length || 0);

  if (nodeStatus === "failed" && key === "crawler_1688") {
    return {
      branch: "blocked",
      riskScore: 88,
      riskLevel: "high",
      reason: "1688 采集没有返回可用候选，后续匹配和上架不能继续。",
      recommendedActions: ["重新采集关键词", "人工检查 1688 页面", "换一个 Ozon 学习样本"],
    };
  }
  if (nodeStatus === "failed" && key === "content_generate") {
    return {
      branch: "blocked",
      riskScore: 82,
      riskLevel: "high",
      reason: "内容生成失败，缺少可提交 Ozon 的标题、描述或属性。",
      recommendedActions: ["检查 AI 配置", "人工编辑上架内容", "重试内容生成节点"],
    };
  }
  if (nodeStatus === "failed" && key === "match_profit") {
    return {
      branch: "manual_review",
      riskScore: 85,
      riskLevel: "high",
      reason: "没有找到同时满足匹配和利润规则的 1688 候选。",
      recommendedActions: ["人工复核候选", "换一个 1688 货源", "重新扩展关键词"],
    };
  }
  if (key === "match_profit" && (tier.includes("fallback") || confidence < 35 || margin < 5)) {
    return {
      branch: "manual_review",
      riskScore: 85,
      riskLevel: "high",
      reason: "低置信或利润偏低，自动上架风险较高。",
      recommendedActions: ["人工复核候选", "换一个 1688 货源", "降低自动提交权限"],
    };
  }
  if (key === "candidate_parse" && acceptedCount === 0 && rejectedCount > 0) {
    return {
      branch: "blocked",
      riskScore: 90,
      riskLevel: "high",
      reason: "候选全部被小件门禁剔除，继续上架会偏离选品规则。",
      recommendedActions: ["重新采集关键词", "放宽采集条件", "人工选择候选"],
    };
  }
  if (key === "preflight_check" && issueCount > 0) {
    return {
      branch: "fix_payload",
      riskScore: Math.min(95, 60 + issueCount * 8),
      riskLevel: issueCount >= 3 ? "high" : "medium",
      reason: "提交前校验发现 payload 问题，需修复后再提交。",
      recommendedActions: ["查看 Payload 问题", "保存修正草稿", "重新校验 Payload"],
    };
  }
  if (key === "review_reconcile" && data.error) {
    return {
      branch: "ozon_feedback",
      riskScore: 80,
      riskLevel: "high",
      reason: "Ozon 审核回执存在阻塞错误，需要按诊断修复。",
      recommendedActions: ["查看 Ozon 原文", "按诊断修复属性", "重试审核节点"],
    };
  }
  return {
    branch: "continue",
    riskScore: 15,
    riskLevel: "low",
    reason: "当前节点未发现明显阻塞风险，可继续流程。",
    recommendedActions: ["继续流程", "查看节点输出"],
  };
}

function firstImportedOffer(output = {}) {
  const imported = Array.isArray(output.importedItems) ? output.importedItems : [];
  const first = imported[0] || {};
  return String(first.offer_id || first.offerId || output.skuOffers?.[0] || "").trim();
}

function listingQualityFromNodes(nodes = []) {
  for (const node of nodes || []) {
    const quality = node?.output?.listingQuality || node?.listingQuality || null;
    if (quality) return quality;
  }
  return null;
}

function lowScoreReason(quality = {}) {
  const breakdown = Array.isArray(quality.scoreBreakdown) ? quality.scoreBreakdown : [];
  const weak = breakdown.find((item) => String(item.status || "") !== "ok" && Number(item.score || 0) < 70)
    || breakdown.find((item) => String(item.status || "") !== "ok")
    || breakdown.find((item) => Number(item.score || 0) < 70)
    || null;
  if (!weak) return quality.reason || "商品已通过审核，但内容分值偏低，建议继续优化图片、描述或属性。";
  return [weak.name || weak.key || "商品分值", weak.reason || weak.message || ""].filter(Boolean).join("：");
}

export function workflowCurrentProductTask(run = {}) {
  const nodes = Array.isArray(run.nodes) ? run.nodes : [];
  const title = run.title || run.name || run.source?.title || run.entity?.candidateTitle || "当前商品";
  const reviewNode = nodes.find((node) => node.key === "review_reconcile");
  const stockNode = nodes.find((node) => node.key === "stock_sync");
  const stockReadiness = run.entity?.stockReadiness || reviewNode?.output?.stockReadiness || null;
  const failedReview = reviewNode && (
    ["failed", "waiting_human"].includes(String(reviewNode.status || ""))
    || Number(reviewNode.output?.errorCount || 0) > 0
    || Number(reviewNode.output?.listingDefectCount || 0) > 0
  );
  if (failedReview) {
    const diagnosis = reviewNode.diagnosis || reviewNode.diagnostic || {};
    const firstError = reviewNode.output?.firstError || reviewNode.error || {};
    return {
      stage: "listing_repair",
      status: "blocked",
      productTitle: title,
      offerId: String(firstError.offer_id || firstError.offerId || reviewNode.output?.skuOffers?.[0] || ""),
      blockedAt: reviewNode.name || "审核回执",
      reason: diagnosis.messageZh || firstError.message || firstError.description || reviewNode.reason || "Ozon 审核回执存在阻塞错误，需要修复后再继续。",
      nextAction: reviewNode.recommendedActions?.[0] || "按诊断修复 Payload 后重新预检",
      view: "workflow-console",
      nodeKey: "review_reconcile",
    };
  }

  // A preflight failure is a seller gate even when there is no review node
  // yet.  Previously a run persisted as waiting_human (with a failed or
  // waiting_human preflight node) fell through to the generic
  // `listing_progress/running` task.  That made the workflow list tell the
  // seller to "continue" instead of showing the actual repair and its safe
  // next step.  Keep this mapping before moderation/stock branches so the
  // server summary and the listing page agree on the same gate.
  const waitingHuman = run.status === "waiting_human" || run.locks?.waitingHuman === true;
  const preflightNode = nodes.find((node) => node.key === "preflight_check") || null;
  const preflightWaiting = preflightNode && (
    ["failed", "waiting_human"].includes(String(preflightNode.status || ""))
    || String(preflightNode.runStatus || "") === "waiting_human"
  );
  if (waitingHuman && preflightWaiting) {
    const sellerResult = preflightNode.output?.sellerResult || {};
    const issueCount = Array.isArray(preflightNode.output?.issues)
      ? preflightNode.output.issues.length
      : Number(preflightNode.output?.issueCount || 0);
    return {
      stage: "preflight_review",
      status: "waiting_human",
      productTitle: title,
      offerId: firstImportedOffer(preflightNode.output || {}),
      blockedAt: preflightNode.name || "提交前预检",
      reason: sellerResult.reason || preflightNode.reason || (issueCount
        ? `提交前预检发现 ${issueCount} 个问题，需要人工修复。`
        : "提交前预检需要人工确认后才能继续。"),
      nextAction: sellerResult.action || preflightNode.recommendedActions?.[0] || "修复本地草稿后重新预检",
      view: "listing",
      nodeKey: "preflight_check",
    };
  }

  const reviewReadinessState = String(reviewNode?.output?.readinessState || "");
  if (reviewNode && String(reviewNode.status || "") === "running" && reviewReadinessState === "pending_moderation") {
    return {
      stage: "review_waiting",
      status: "waiting",
      productTitle: title,
      offerId: firstImportedOffer(reviewNode.output || {}),
      blockedAt: reviewNode.name || "审核回执",
      reason: reviewNode.reason || "Ozon 商品已导入，状态回读尚未证明可售。",
      nextAction: reviewNode.recommendedActions?.[0] || "稍后重新回查商品状态；在明确可售前不要写库存",
      view: "workflow-console",
      nodeKey: "review_reconcile",
    };
  }

  if (stockReadiness && String(stockReadiness.status || "") === "blocked") {
    return {
      stage: "warehouse_queue",
      status: "blocked",
      productTitle: title,
      offerId: String(stockReadiness.offerIds?.[0] || firstImportedOffer(reviewNode?.output || {})),
      blockedAt: "库存就绪证据",
      reason: String(stockReadiness.reasonCode || "STOCK_CURRENT_EVIDENCE_REQUIRED") === "STOCK_CURRENT_EVIDENCE_REQUIRED"
        ? "提交结果不等于当前库存证据，必须先读取对应 Offer 与仓库的库存。"
        : String(stockReadiness.reason || stockReadiness.reasonCode || "库存就绪证据不足。"),
      nextAction: stockReadiness.nextAction || "先读取对应 offer_id/warehouse_id 的当前库存，再执行库存预检",
      view: "warehouse",
      nodeKey: "stock_readiness",
    };
  }

  if (stockNode && ["failed", "waiting_human", "running", "retry_stock", "waiting_product"].includes(String(stockNode.status || ""))) {
    return {
      stage: "warehouse_queue",
      status: String(stockNode.status || "") === "failed" ? "blocked" : "waiting",
      productTitle: title,
      offerId: String(stockNode.output?.stocks?.[0]?.offer_id || firstImportedOffer(reviewNode?.output || {})),
      blockedAt: stockNode.name || "库存写入",
      reason: stockNode.reason || stockNode.error?.raw || "库存写入仍在等待商品就绪或队列重试。",
      nextAction: stockNode.recommendedActions?.[0] || "进入库存队列查看推荐仓库和重试状态",
      view: "warehouse",
      nodeKey: "stock_sync",
    };
  }

  const reviewSucceeded = reviewNode && String(reviewNode.status || "") === "success";
  const quality = listingQualityFromNodes(nodes);
  const contentScore = Number(quality?.contentScore ?? quality?.score ?? quality?.totalScore ?? 100);
  const hasScoreWarnings = Array.isArray(quality?.scoreBreakdown)
    && quality.scoreBreakdown.some((item) => String(item.status || "") !== "ok" || Number(item.score || 100) < 70);
  if (reviewSucceeded && (contentScore < 70 || hasScoreWarnings)) {
    return {
      stage: "content_improvement",
      status: "needs_improvement",
      productTitle: title,
      offerId: firstImportedOffer(reviewNode.output || {}),
      blockedAt: "商品分值",
      reason: lowScoreReason(quality),
      nextAction: "进入上架内容和图片区补强商品分值，修改后重新预检",
      view: "listing",
      nodeKey: "preflight_check",
    };
  }

  if (reviewSucceeded) {
    return {
      stage: "live_monitoring",
      status: "ready",
      productTitle: title,
      offerId: firstImportedOffer(reviewNode.output || {}),
      blockedAt: "审核通过",
      reason: "Ozon 审核回执未发现阻塞错误，可以继续库存或运营检查。",
      nextAction: "进入库存仓库确认库存队列或补库存",
      view: "warehouse",
      nodeKey: "review_reconcile",
    };
  }

  return {
    stage: "listing_progress",
    status: "running",
    productTitle: title,
    offerId: "",
    blockedAt: "",
    reason: "当前商品仍在上架主流程中，等待下一个节点输出。",
    nextAction: "进入上架中心继续推进当前草稿",
    view: "listing",
    nodeKey: "",
  };
}

export function summarizeWorkflowRun(run = {}) {
  const nodes = Array.isArray(run.nodes) ? run.nodes : [];
  const blockingNode = nodes.find((node) => ["failed", "waiting_human", "retrying"].includes(String(node.status || "")))
    || nodes.find((node) => String(node.riskLevel || "") === "high")
    || null;
  const currentNode = blockingNode
    || nodes.find((node) => node.key === run.currentNode)
    || nodes[nodes.length - 1]
    || null;
  const highestRisk = nodes.reduce((best, node) => (
    Number(node.riskScore || 0) > Number(best?.riskScore || 0) ? node : best
  ), null);
  const maxRiskScore = Number(highestRisk?.riskScore || 0);
  const riskLevel = maxRiskScore >= 70 ? "high" : maxRiskScore >= 40 ? "medium" : "low";
  const recommendedActions = blockingNode?.recommendedActions
    || highestRisk?.recommendedActions
    || currentNode?.recommendedActions
    || [];
  return {
    status: run.status || "draft",
    currentNodeKey: currentNode?.key || "",
    currentNodeName: currentNode?.name || currentNode?.title || currentNode?.key || "",
    blockingNodeKey: blockingNode?.key || "",
    blockingNodeName: blockingNode?.name || blockingNode?.title || blockingNode?.key || "",
    maxRiskScore,
    riskLevel,
    reason: blockingNode?.reason || highestRisk?.reason || currentNode?.reason || "",
    nextAction: recommendedActions[0] || "查看节点输出",
    currentProductTask: workflowCurrentProductTask({ ...run, nodes }),
    nodeCount: nodes.length,
    completedCount: nodes.filter((node) => ["success", "completed"].includes(String(node.status || ""))).length,
  };
}

export function summarizeWorkflowRunList(runs = []) {
  const workflowRuns = runs || [];
  const summaries = (runs || []).map((run) => run.summary || summarizeWorkflowRun(run));
  const actionCounts = new Map();
  for (const summary of summaries) {
    const action = String(summary.nextAction || "").trim();
    if (!action) continue;
    actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
  }
  return {
    total: summaries.length,
    running: summaries.filter((summary) => summary.status === "running").length,
    waitingHuman: summaries.filter((summary) => summary.status === "waiting_human").length,
    failed: summaries.filter((summary) => summary.status === "failed").length,
    live: summaries.filter((summary) => summary.status === "live").length,
    paused: summaries.filter((summary) => summary.status === "paused").length,
    lockedWaitingHuman: workflowRuns.filter((run) => run?.locks?.waitingHuman).length,
    submitLocked: workflowRuns.filter((run) => run?.locks?.submitLocked).length,
    lockedPaused: workflowRuns.filter((run) => run?.locks?.paused).length,
    highRisk: summaries.filter((summary) => summary.riskLevel === "high").length,
    blocking: summaries.filter((summary) => summary.blockingNodeKey).length,
    topNextActions: [...actionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([action, count]) => ({ action, count })),
  };
}

export function workflowDuplicateListingNode(input = {}) {
  const message = String(input.message || "检测到重复上架，已阻止继续提交 Ozon。");
  return {
    key: "preflight_check",
    name: "提交前预检",
    status: "failed",
    runStatus: "waiting_human",
    output: {
      ok: false,
      issues: [{
        code: "DUPLICATE_LISTING",
        message,
        duplicateJobId: input.duplicateJobId || "",
        duplicateSku: input.duplicateSku || "",
      }],
    },
    error: { raw: message },
    diagnosis: {
      reasonCode: "DUPLICATE_LISTING",
      severity: "blocking",
      messageZh: "检测到同一 Ozon 参考品或 1688 货源已经提交过，系统已阻止重复上架。",
      fixHints: ["人工确认是否换货源", "清理 Ozon 残留卡片后再重试", "避免继续生成新 SKU"],
    },
    branch: "manual_review",
    riskScore: 95,
    riskLevel: "high",
    reason: "重复货源/重复参考品会导致 Ozon 重复卡或合并失败。",
    recommendedActions: ["人工确认是否换货源", "检查重复 SKU", "不要重复点击全自动上架"],
    actions: ["view_output", "choose_new_candidate"],
  };
}

export function workflowReviewReconcileNode(input = {}) {
  const importErrors = Array.isArray(input.importErrors) ? input.importErrors : [];
  const importWarnings = Array.isArray(input.importWarnings) ? input.importWarnings : [];
  const listingDefects = Array.isArray(input.listingDefects) ? input.listingDefects : [];
  const importedItems = Array.isArray(input.importedItems) ? input.importedItems : [];
  const firstError = importErrors[0] || listingDefects[0] || null;
  const groupingFailed = listingDefects.length > 0;
  const diagnosis = groupingFailed ? {
    reasonCode: "VARIANT_GROUPING_FAILED",
    severity: "blocking",
    messageZh: "Ozon 已创建商品，但同一型号下的变体特征没有形成唯一组合，卡片未成功合并。",
    fixHints: ["检查每个 SKU 的 Ozon 可变特征", "修正颜色/尺寸字典值", "整组重新提交全部变体"],
  } : (firstError ? diagnoseWorkflowError(firstError) : {});
  const reasonCode = diagnosis.reasonCode || "";
  const failed = importErrors.length > 0 || groupingFailed;
  const variantGroupingDiagnosis = groupingFailed ? buildVariantGroupingDiagnosis({
    submitPayload: input.submitPayload || {},
    attrsMeta: input.attrsMeta || [],
  }) : null;
  const variantGroupingRepairDraft = groupingFailed ? buildVariantGroupingRepairDraft({
    originalPayload: input.repairPayload || input.submitPayload || {},
    skuOffers: input.skuOffers || [],
  }) : null;
  // The import task response is not the final seller outcome.  When a later
  // product-status read is available, keep that server-observed state on the
  // same review node so the workflow cannot say “审核通过” while moderation
  // is still pending (or has failed).
  const readinessState = String(input.readinessState || "").trim();
  const readinessEvidence = input.readinessEvidence && typeof input.readinessEvidence === "object"
    ? input.readinessEvidence
    : {};
  const readinessFailed = readinessState === "moderation_failed";
  // A claimed ready_for_sale state is not sufficient on its own. It must be
  // backed by a complete, fresh, server-observed product read; otherwise an
  // import response or hand-built node could advance directly to inventory.
  const readinessClaimVerified = readinessState !== "ready_for_sale"
    || (readinessEvidence.readStatus === "completed"
      && readinessEvidence.coverageComplete === true
      && readinessEvidence.freshnessStatus === "fresh"
      && readinessEvidence.endpointAttempted === true
      && Number(readinessEvidence.observedOfferCount || 0) > 0);
  const readinessUnverified = readinessState === "ready_for_sale" && !readinessClaimVerified;
  const readinessPending = Boolean(readinessState)
    && (!['ready_for_sale', 'moderation_failed'].includes(readinessState) || readinessUnverified);
  const effectiveFailed = failed || readinessFailed;
  const reviewRepairDraft = effectiveFailed ? buildReviewRepairDraft({
    taskId: input.taskId,
    skuOffers: input.skuOffers,
    importedItems,
    importErrors: importErrors.length ? importErrors : (readinessFailed ? [{ code: "MODERATION_FAILED", message: "审核失败" }] : []),
    submitPayload: input.submitPayload || {},
  }) : null;
  return {
    key: "review_reconcile",
    name: "审核回执",
    output: {
      taskId: input.taskId || null,
      skuOffers: Array.isArray(input.skuOffers) ? input.skuOffers : [],
      importedItems,
      importedCount: importedItems.length,
      importWarnings,
      warningCount: importWarnings.length,
      listingDefects,
      listingDefectCount: listingDefects.length,
      importErrors,
      errorCount: importErrors.length,
      reasonCode,
      firstError,
      variantGroupingDiagnosis,
      variantGroupingRepairDraft,
      readinessState,
      readinessEvidence: input.readinessEvidence || null,
      readinessClaimVerified,
      reviewRepairDraft,
    },
    status: effectiveFailed ? "failed" : (readinessPending ? "running" : "success"),
    runStatus: effectiveFailed ? "waiting_human" : "running",
    error: firstError || (readinessFailed ? { code: "MODERATION_FAILED", message: "Ozon 商品审核未通过" } : {}),
    diagnosis: readinessFailed && !diagnosis.reasonCode ? {
      reasonCode: "MODERATION_FAILED",
      severity: "blocking",
      messageZh: "Ozon 商品状态回读显示审核未通过，需要修复商品资料。",
      fixHints: ["查看逐 Offer 审核错误", "修复商品草稿", "重新预检后人工确认提交"],
    } : diagnosis,
    branch: groupingFailed ? "variant_grouping_fix" : (effectiveFailed ? "ozon_feedback" : (readinessPending ? "waiting_review" : "continue")),
    riskScore: effectiveFailed ? 90 : (readinessPending ? 45 : (importWarnings.length ? 25 : 10)),
    riskLevel: effectiveFailed ? "high" : (readinessPending ? "medium" : (importWarnings.length ? "medium" : "low")),
    reason: groupingFailed ? "Ozon 商品已导入，但变体合并失败，不能视为上架成功。" : (readinessFailed ? "商品状态回读显示审核未通过，需要修复后重新预检。" : (readinessUnverified ? "商品状态被标为可售，但缺少完整、新鲜的服务端回查证据，不能进入库存。" : (readinessPending ? "Ozon 商品已导入，但状态回读尚未证明可售，仍在审核中。" : (failed ? "Ozon 审核回执存在阻塞错误，需要人工或规则修复。" : "Ozon 回执未发现阻塞错误。")))),
    recommendedActions: groupingFailed ? ["修正变体特征后整组重提", "查看 Ozon 原文", "检查同型号 SKU 差异"] : (effectiveFailed ? (readinessFailed ? ["按诊断逐 Offer 修复 Payload", "保存新草稿并重新预检", "按 task_id/product_id/Offer 再次只读回查"] : ["按诊断修复 Payload", "按 Offer 逐项定位并修复", "保存新草稿并重新预检", "按 task_id/product_id/Offer 再次只读回查"]) : (readinessPending ? ["重新执行完整商品状态回查", "核对新鲜度和 Offer 覆盖范围", "在明确可售前不要写库存"] : ["查看节点输出", "继续库存写入"])),
    actions: effectiveFailed ? ["edit_payload", "retry_node", "auto_fix"] : ["view_output"],
  };
}

/**
 * Apply a server-observed /v1/product/import/info response to the workflow
 * that submitted the task.  The legacy auto-listing reconciler updates only
 * its job record; a payload-draft submission otherwise leaves the workflow's
 * review_reconcile node stale forever.  This helper is deliberately
 * readback-only: it never calls an Ozon write endpoint and always treats an
 * import without product-status evidence as pending moderation.
 */
export async function reconcileWorkflowTaskReadback(runId, input = {}, deps = {}) {
  const run = await getWorkflowRun(runId);
  if (!run) return { ok: false, status: 404, reasonCode: "WORKFLOW_NOT_FOUND" };
  const taskId = Number(input.taskId || input.task_id || 0);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    return { ok: false, status: 400, reasonCode: "PRODUCT_IMPORT_TASK_ID_INVALID" };
  }
  const expectedTaskId = Number(run.entity?.taskId
    || run.submissionReservation?.taskId
    || (run.nodes || []).find((node) => node.key === "ozon_submit")?.output?.taskId
    || 0);
  if (expectedTaskId > 0 && expectedTaskId !== taskId) {
    return { ok: false, status: 409, reasonCode: "WORKFLOW_TASK_MISMATCH", expectedTaskId, taskId };
  }
  const requestedStoreId = String(input.storeId || "").trim();
  const expectedStoreId = String(run.entity?.storeId || run.submissionReservation?.storeId || "").trim();
  // The HTTP route already requires a store scope, but this helper is also
  // callable by background/local operators. Do not let a direct caller attach
  // import-info evidence while omitting the store binding.
  if (expectedStoreId && !requestedStoreId) {
    return { ok: false, status: 400, reasonCode: "WORKFLOW_STORE_REQUIRED" };
  }
  if (expectedStoreId && requestedStoreId && expectedStoreId !== requestedStoreId) {
    return { ok: false, status: 409, reasonCode: "WORKFLOW_STORE_MISMATCH" };
  }
  const info = input.importInfo && typeof input.importInfo === "object" ? input.importInfo : {};
  const items = Array.isArray(info?.result?.items) ? info.result.items : (Array.isArray(info.items) ? info.items : []);
  const importedItems = items.filter((item) => Number(item?.product_id || item?.productId || 0) > 0
    || String(item?.status || "").toLowerCase() === "imported");
  const importErrors = items.flatMap((item) => Array.isArray(item?.errors) ? item.errors : []);
  const importWarnings = items.flatMap((item) => Array.isArray(item?.warnings) ? item.warnings : []);
  const skuOffers = (run.nodes || []).find((node) => node.key === "ozon_submit")?.output?.offers
    || (run.payloadDraft?.items || []).map((item) => item.offer_id).filter(Boolean);
  const submitPayload = run.payloadDraft || (run.nodes || []).find((node) => node.key === "ozon_submit")?.input || {};
  const node = workflowReviewReconcileNode({
    taskId,
    importedItems,
    importWarnings,
    importErrors,
    listingDefects: [],
    skuOffers,
    submitPayload,
    // Import-info alone cannot prove moderation or sale readiness.
    readinessState: importErrors.length ? "" : "pending_moderation",
    readinessEvidence: {
      source: "server_observed",
      checkedAt: String(input.checkedAt || nowIso()),
      responseHash: String(input.responseHash || ""),
      taskId,
    },
  });
  const updated = await upsertWorkflowNode(runId, node);
  await appendWorkflowEvent(runId, {
    node: "review_reconcile",
    type: "task_readback_observed",
    message: "已将 Ozon 商品导入任务回查结果写入审核回执节点；未执行写操作。",
    data: {
      taskId,
      importedCount: importedItems.length,
      errorCount: importErrors.length,
      warningCount: importWarnings.length,
      source: "server_observed",
    },
  });
  return {
    ok: true,
    status: importErrors.length ? "failed" : "pending_moderation",
    taskId,
    importedCount: importedItems.length,
    errorCount: importErrors.length,
    warningCount: importWarnings.length,
    reviewNode: node,
    run: await getWorkflowRun(runId),
    previousRun: updated,
  };
}
