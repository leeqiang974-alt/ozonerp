import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const items = store.items
    .map((item) => ({ ...item, summary: summarizeWorkflowRun(item) }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return {
    items,
    summary: summarizeWorkflowRunList(items),
  };
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
  const rows = items.map((item) => {
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
    return {
      offerId: String(item?.offer_id || ""),
      modelValue: modelValues.join(" / "),
      aspects,
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

export function buildPreflightGateNode(input = {}) {
  const payloadValidation = validateSubmitPayload(input.payload || {}, { attrsMeta: input.attrsMeta || [] });
  const issues = [...(payloadValidation.issues || [])];
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
    payloadDraftValidation: null,
    locks: { ...(run.locks || {}), submitLocked: true },
  }));
}

export async function validatePayloadDraft(runId) {
  const run = await updateRun(runId, (current) => {
    const validation = validateSubmitPayload(current.payloadDraft || {}, { attrsMeta: current.payloadDraftAttrsMeta || [] });
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
  const payloadDraft = run.payloadDraft || {};
  const items = payloadItems(payloadDraft);
  if (!items.length) {
    const validation = validateSubmitPayload(payloadDraft);
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

  const validation = validateSubmitPayload(payloadDraft, { attrsMeta: run.payloadDraftAttrsMeta || [] });
  if (!validation.ok) {
    await upsertWorkflowNode(runId, buildPreflightGateNode({ payload: payloadDraft, attrsMeta: run.payloadDraftAttrsMeta || [] }));
    await updateRun(runId, (current) => ({
      ...current,
      payloadDraftValidation: validation,
      locks: { ...(current.locks || {}), submitLocked: true, waitingHuman: true },
    }));
    return { ok: false, status: "blocked", validation };
  }

  await upsertWorkflowNode(runId, buildPreflightGateNode({ payload: payloadDraft, attrsMeta: run.payloadDraftAttrsMeta || [] }));
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
