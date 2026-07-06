import fs from "node:fs/promises";
import path from "node:path";
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
    source: variant.source || "1688_sku_variant",
  };
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

function matrixDictionaryCandidates(values = []) {
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
    .slice(0, 5);
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
  const dictionaryCandidates = matrixDictionaryCandidates(input.legalValues || []);
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
  return {
    rows,
    differenceSuggestions,
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
  const issues = [...(payloadValidation.issues || []), ...qualityIssues, ...matrixIssues, ...variantIssues];
  const requiredAttributeFillPlan = buildRequiredAttributePlanForPayload(payload, options);
  const requiredAttributeFillSummary = summarizeRequiredAttributeFillPlan(requiredAttributeFillPlan);
  const requiredAttributeManualBacklog = buildRequiredAttributeManualBacklog(requiredAttributeFillPlan);
  const requiredAttributeRuleCandidateIndex = buildRequiredAttributeRuleCandidateIndex({
    categoryMatch: options.categoryMatch || categoryMatchFromPayload(payload),
    manualBacklog: requiredAttributeManualBacklog,
    fillPlan: requiredAttributeFillPlan,
  });
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
  for (const issue of contentSummary.contentIssues || []) {
    issues.push({ code: "CONTENT_ISSUE", message: String(issue || "") });
  }
  if (Number(contentSummary.candidateImageCount || 0) > 0 && Number(contentSummary.candidateImageCount || 0) < 3) {
    issues.push({ code: "SOURCE_IMAGES_TOO_FEW", message: "候选源图片少于 3 张。" });
  }
  if (contentSummary.sizeWeightReady === false) {
    issues.push({ code: "SOURCE_SIZE_WEIGHT_MISSING", message: "候选源缺少完整尺重。" });
  }
  if (input.category === null || input.category === false) {
    issues.push({ code: "CATEGORY_MATCH_MISSING", message: "提交前没有可信 Ozon 类目匹配。" });
  }
  if (Number(input.variantCount || 0) === 1 && Number(contentSummary.skuVariantCount || 0) > 1) {
    issues.push({ code: "VARIANT_COLLAPSED", message: "1688 有多个变体，但提交 payload 只保留 1 个 SKU。" });
  }
  const ok = issues.length === 0;
  return {
    key: "preflight_check",
    name: "提交前总闸",
    status: ok ? "success" : "failed",
    runStatus: ok ? "running" : "waiting_human",
    output: {
      ok,
      issueCount: issues.length,
      issues,
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
      summary: {
        itemCount: payloadItems(input.payload || {}).length,
        variantCount: Number(input.variantCount || 0),
        contentIssues: Array.isArray(contentSummary.contentIssues) ? contentSummary.contentIssues : [],
        candidateImageCount: Number(contentSummary.candidateImageCount || 0),
        skuVariantCount: Number(contentSummary.skuVariantCount || 0),
        sizeWeightReady: Boolean(contentSummary.sizeWeightReady),
        categoryPath: input.category?.path || "",
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
  const store = await readStore();
  const index = store.items.findIndex((item) => item.id === runId);
  if (index < 0) throw new Error("工作流不存在: " + runId);
  const next = updater({ ...store.items[index] });
  next.updatedAt = nowIso();
  store.items[index] = next;
  await writeStore(store);
  return next;
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
  return updateRun(runId, (run) => ({
    ...run,
    payloadDraft,
    payloadDraftAttrsMeta: Array.isArray(options.attrsMeta) ? options.attrsMeta : (run.payloadDraftAttrsMeta || []),
    payloadDraftSourceVariants: Array.isArray(options.sourceVariants) ? options.sourceVariants : (run.payloadDraftSourceVariants || []),
    payloadDraftValidation: null,
    locks: { ...(run.locks || {}), submitLocked: true },
  }));
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

export async function applyPayloadDraftAttributeRepair(runId, input = {}) {
  if (input.confirmLocalDraftRepair !== true) {
    throw new Error("需要人工确认后才能写回本地 Payload 草稿。");
  }
  const run = await getWorkflowRun(runId);
  if (!run) throw new Error("工作流不存在: " + runId);
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
    repairData = { dictionaryValueId };
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
    payloadDraft = applyAttributeTextValue(run.payloadDraft || {}, input);
    repairData = { value: String(input.value || "").trim() };
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
    run: updated,
    payloadDraft: updated.payloadDraft,
  };
}

export async function validatePayloadDraft(runId) {
  const categoryCache = await loadCategoryCache();
  const run = await updateRun(runId, (current) => {
    const validation = buildPayloadDraftValidation(current.payloadDraft || {}, {
      attrsMeta: current.payloadDraftAttrsMeta || [],
      sourceVariants: current.payloadDraftSourceVariants || [],
      workflowRun: current,
      dictionaryValueCache: categoryCache.attributeValues || {},
    });
    return {
      ...current,
      payloadDraftValidation: validation,
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

export async function submitPayloadDraftToOzon(runId, input = {}, deps = {}) {
  const run = await getWorkflowRun(runId);
  if (!run) throw new Error("工作流不存在: " + runId);
  if (run.locks?.paused || run.status === "paused") {
    return { ok: false, status: "paused", message: "工作流已暂停，不能提交 Ozon。" };
  }
  if (run.locks?.waitingHuman || run.status === "waiting_human") {
    return { ok: false, status: "waiting_human", message: "工作流正在等待人工处理，不能提交 Ozon。" };
  }
  const payloadDraft = run.payloadDraft || {};
  const items = payloadItems(payloadDraft);
  const categoryCache = await loadCategoryCache();
  const dictionaryValueCache = categoryCache.attributeValues || {};
  if (!items.length) {
    const validation = buildPayloadDraftValidation(payloadDraft, {
      attrsMeta: run.payloadDraftAttrsMeta || [],
      sourceVariants: run.payloadDraftSourceVariants || [],
      workflowRun: run,
      dictionaryValueCache,
    });
    await upsertWorkflowNode(runId, {
      key: "preflight_check",
      name: "提交前总闸",
      status: "failed",
      output: validation,
      runStatus: "waiting_human",
      reason: "没有可提交的 Payload 草稿。",
      recommendedActions: ["保存 Payload 草稿", "重新校验 Payload"],
      actions: ["edit_payload", "validate_payload"],
    });
    return { ok: false, status: "blocked", validation };
  }

  const validation = buildPayloadDraftValidation(payloadDraft, {
    attrsMeta: run.payloadDraftAttrsMeta || [],
    sourceVariants: run.payloadDraftSourceVariants || [],
    workflowRun: run,
    dictionaryValueCache,
  });
  if (!validation.ok) {
    await upsertWorkflowNode(runId, buildPreflightGateNode({
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

  await upsertWorkflowNode(runId, buildPreflightGateNode({
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
      message: "需要人工二次确认后才能提交 Ozon。",
    };
  }

  const storeId = String(input.storeId || run.entity?.storeId || "").trim();
  if (!storeId) throw new Error("缺少店铺 ID，不能提交 Ozon。");
  const getStore = requireSubmitDep(deps, "getStore");
  const ozonRequest = requireSubmitDep(deps, "ozonRequest");
  const store = getStore(storeId);
  const submitPayload = { items };
  const result = await ozonRequest(store, "/v3/product/import", submitPayload);
  const taskId = extractTaskId(result);

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
    candidateId: job.bestMatch?.candidateId || job.bestMatch?.id || job.candidateId || "",
    candidateUrl: job.bestMatch?.candidateUrl || job.candidateData?.url || job.url || "",
    parentSku: job.listingResult?.sku || job.pendingParentSku || job.parentSku || "",
    taskId: job.listingResult?.taskId || job.taskId || "",
    storeId: job.listingResult?.storeId || job.storeId || "",
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
    miscFee: Number(input.miscFee || 0),
    baseCost: Number(input.baseCost || 0),
    profit: Number(input.profit || 0),
    profitRate: Number(input.profitRate || 0),
    converged: input.converged !== false,
    level: input.level || null,
    package: input.package || {},
    packageInfoSource: String(input.packageInfoSource || input.package?.source || ""),
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
  return {
    key: "review_reconcile",
    name: "审核回执",
    status: failed ? "failed" : "success",
    runStatus: failed ? "waiting_human" : "running",
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
    },
    error: firstError || {},
    diagnosis,
    branch: groupingFailed ? "variant_grouping_fix" : (failed ? "ozon_feedback" : "continue"),
    riskScore: failed ? 90 : (importWarnings.length ? 25 : 10),
    riskLevel: failed ? "high" : (importWarnings.length ? "medium" : "low"),
    reason: groupingFailed ? "Ozon 商品已导入，但变体合并失败，不能视为上架成功。" : (failed ? "Ozon 审核回执存在阻塞错误，需要人工或规则修复。" : "Ozon 回执未发现阻塞错误。"),
    recommendedActions: groupingFailed ? ["修正变体特征后整组重提", "查看 Ozon 原文", "检查同型号 SKU 差异"] : (failed ? ["按诊断修复 Payload", "查看 Ozon 原文", "重试审核节点"] : ["查看节点输出", "继续库存写入"]),
    actions: failed ? ["edit_payload", "retry_node", "auto_fix"] : ["view_output"],
  };
}
