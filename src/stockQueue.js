import path from "node:path";
import { createHash } from "node:crypto";
import { getStore } from "./config.js";
import { ozonRequest } from "./ozon.js";
import { JobRepository } from "./jobRepository.js";
import { trackEvent } from "./observability.js";
import { mapReasonCode } from "./reasonCodes.js";
import { recordListingExperience } from "./learningMemory.js";
import { listWorkflowRuns, upsertWorkflowNode } from "./workflowRuns.js";
import { gatherStockReconciliationEvidence } from "./stockReconciliationEvidence.js";

const DATA_DIR = path.resolve("data");
const QUEUE_FILE = path.join(DATA_DIR, "stock-queue.json");
const timers = new Map();

const BLOCKED_IMPORT_STATUSES = new Set(["failed", "error", "rejected", "declined", "moderation_failed"]);

export function productImportReadiness(item = {}) {
  const status = String(item?.status || item?.status_name || item?.statusName || "").trim().toLowerCase();
  const errors = Array.isArray(item?.errors) ? item.errors : [];
  if (BLOCKED_IMPORT_STATUSES.has(status)) return { ready: false, reasonCode: "PRODUCT_IMPORT_NOT_READY", status };
  if (errors.some((error) => String(error?.level || "").toLowerCase() === "error")) return { ready: false, reasonCode: "PRODUCT_IMPORT_NOT_READY", status };
  return { ready: status === "imported", reasonCode: status ? "PRODUCT_IMPORT_NOT_READY" : "PRODUCT_IMPORT_STATUS_UNKNOWN", status };
}

function stockKey(row = {}) {
  return `${String(row.offer_id || row.offerId || "").trim()}::${Number(row.warehouse_id || row.warehouseId || 0)}`;
}

const STOCK_DRY_RUN_MAX_ITEMS = 100;

function stockDryRunValidationError(reasonCode, error, field = "", index = null) {
  return { ok: false, status: 400, reasonCode, error, field, index };
}

function validOfferId(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200;
}

function validPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validStock(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateStockDryRunInput(input = {}, { maxItems = STOCK_DRY_RUN_MAX_ITEMS } = {}) {
  const groupNames = ["targetStocks", "products", "warehouses", "currentStocks"];
  for (const field of groupNames) {
    if (!Array.isArray(input?.[field])) {
      return stockDryRunValidationError(
        "STOCK_DRY_RUN_ARRAY_REQUIRED",
        `${field} 必须是数组。`,
        field,
      );
    }
    if (input[field].length > maxItems) {
      return stockDryRunValidationError(
        "STOCK_DRY_RUN_LIMIT_EXCEEDED",
        `${field} 最多允许 ${maxItems} 项。`,
        field,
      );
    }
  }
  if (input.targetStocks.length === 0) {
    return stockDryRunValidationError(
      "STOCK_DRY_RUN_TARGET_INVALID",
      "targetStocks 至少需要一项目标库存。",
      "targetStocks",
    );
  }
  for (const [index, row] of input.targetStocks.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || !validOfferId(row.offer_id)
      || !validPositiveId(row.warehouse_id)
      || !validStock(row.stock)) {
      return stockDryRunValidationError(
        "STOCK_DRY_RUN_TARGET_INVALID",
        "目标库存必须包含非空 offer_id、正整数 warehouse_id 和大于等于 0 的整数 stock。",
        "targetStocks",
        index,
      );
    }
  }
  // A stock write addresses one exact (offer_id, warehouse_id) tuple.  Two
  // target rows for the same tuple are ambiguous (and can make Ozon apply the
  // last row only), so reject them before a dry-run or idempotency key is
  // created instead of silently collapsing the seller's intent.
  const targetTupleCounts = new Map();
  input.targetStocks.forEach((row) => {
    const key = stockKey(row);
    targetTupleCounts.set(key, (targetTupleCounts.get(key) || 0) + 1);
  });
  const duplicateTarget = [...targetTupleCounts.entries()].find(([, count]) => count > 1);
  if (duplicateTarget) {
    return stockDryRunValidationError(
      "STOCK_DRY_RUN_DUPLICATE_TARGET",
      `目标库存包含重复的 Offer/仓库 tuple（${duplicateTarget[0]}），请合并后重试。`,
      "targetStocks",
    );
  }
  for (const [index, row] of input.products.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || !validOfferId(row.offer_id)
      || !validPositiveId(row.product_id)) {
      return stockDryRunValidationError(
        "STOCK_DRY_RUN_EVIDENCE_INVALID",
        "商品证据必须包含非空 offer_id 和正整数 product_id。",
        "products",
        index,
      );
    }
  }
  for (const [index, row] of input.warehouses.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row) || !validPositiveId(row.warehouse_id)) {
      return stockDryRunValidationError(
        "STOCK_DRY_RUN_EVIDENCE_INVALID",
        "仓库证据必须包含正整数 warehouse_id。",
        "warehouses",
        index,
      );
    }
  }
  for (const [index, row] of input.currentStocks.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || !validOfferId(row.offer_id)
      || !validPositiveId(row.warehouse_id)
      || !validStock(row.stock)) {
      return stockDryRunValidationError(
        "STOCK_DRY_RUN_EVIDENCE_INVALID",
        "当前库存证据必须包含非空 offer_id、正整数 warehouse_id 和非负整数 stock。",
        "currentStocks",
        index,
      );
    }
  }
  return {
    ok: true,
    value: Object.fromEntries(groupNames.map((field) => [field, input[field].map((row) => ({ ...row }))])),
  };
}

function normalizeStockRow(row = {}) {
  return {
    offer_id: String(row.offer_id || row.offerId || "").trim(),
    warehouse_id: Number(row.warehouse_id || row.warehouseId || 0),
    stock: Number(row.stock ?? row.quantity ?? row.present ?? 0),
  };
}

function hasKnownStock(row = {}) {
  const raw = row.stock ?? row.quantity ?? row.present;
  if (raw === undefined || raw === null || raw === "") return false;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0;
}

function productReady(product = {}) {
  const status = productStatus(product);
  const acceptedStatuses = new Set(["selling", "ready", "approved", "ready_for_sale"]);
  return Number(product.product_id || product.productId || 0) > 0
    && product.status_failed !== true
    && !productStatusEvidenceStale(product)
    && product.visible !== false
    && acceptedStatuses.has(status);
}

function productStatusEvidenceStale(product = {}) {
  const freshness = String(product.statusFreshness || product.freshnessStatus || product.status_freshness || "").trim().toLowerCase();
  if (product.status_stale === true || ["stale", "expired", "outdated"].includes(freshness)) return true;
  const checkedAt = product.checkedAt || product.statusCheckedAt || product.status_checked_at;
  if (checkedAt === undefined || checkedAt === null || String(checkedAt).trim() === "") return false;
  const checkedAtMs = Date.parse(String(checkedAt));
  if (!Number.isFinite(checkedAtMs)) return true;
  return checkedAtMs > Date.now() + 5 * 60 * 1000 || Date.now() - checkedAtMs > 60 * 60 * 1000;
}

function productStatus(product = {}) {
  return String(product.status || product.status_name || product.moderate_status || "").trim().toLowerCase();
}

function productTransitionAction(product = {}) {
  const status = productStatus(product);
  if (productStatusEvidenceStale(product)) {
    return "商品状态读取已过期；先重新读取并确认审核/在售状态，再进入库存写入。";
  }
  if (product.visible === false) {
    return "先确认商品已上架且对买家可见，再重新读取商品状态。";
  }
  if (!status) {
    return "重新读取商品详情和审核状态；状态未确认前不能进入库存写入。";
  }
  if (["moderating", "moderation", "processing", "imported", "under_review", "pending"].includes(status)) {
    return "等待 Ozon 商品导入/审核完成，再重新读取商品状态；不要先写库存。";
  }
  if (product.status_failed === true || ["failed", "error", "rejected", "declined"].includes(status)) {
    return "先处理商品审核错误并重新预检，商品明确可售后再进入库存。";
  }
  return "先确认商品状态为可售且可见，再重新预演库存差异。";
}

function warehouseReady(warehouse = {}, { requireModeEvidence = false } = {}) {
  const status = String(warehouse.status || "").trim().toLowerCase();
  const baseReady = Number(warehouse.warehouse_id || warehouse.id || 0) > 0 && status === "created";
  if (!baseReady || !requireModeEvidence) return baseReady && warehouse.is_rf !== false;
  // A created warehouse without an observed fulfillment mode is not enough
  // to authorize a stock write. The evidence aggregator uses the same
  // conservative rule: require an explicit RF/RFBS flag or a documented
  // delivery method. Treating `undefined` as ready lets a hand-crafted
  // client dry-run bypass the warehouse-mode evidence gate.
  return warehouse.is_rf === true
    || warehouse.is_rfbs === true
    || String(warehouse.delivery_method_type || "").trim().length > 0;
}

function stockIdempotencyKey(storeId, targetStocks) {
  const summary = targetStocks
    .map(normalizeStockRow)
    .sort((a, b) => a.offer_id.localeCompare(b.offer_id) || a.warehouse_id - b.warehouse_id);
  const digest = createHash("sha256")
    .update(JSON.stringify({ storeId: String(storeId || ""), targetStocks: summary }), "utf8")
    .digest("hex");
  return `stock:sha256:${digest}`;
}

export function buildStockReconciliationPlan({
  storeId = "",
  products = [],
  warehouses = [],
  currentStocks = [],
  targetStocks = [],
  requireWarehouseModeEvidence = false,
} = {}) {
  const productMap = new Map(products.map((product) => [String(product.offer_id || product.offerId || "").trim(), product]));
  const warehouseMap = new Map(warehouses.map((warehouse) => [Number(warehouse.warehouse_id || warehouse.id || 0), warehouse]));
  // A response row without an explicit quantity is unknown evidence.  Do not
  // let normalizeStockRow's compatibility default (0) turn it into a
  // write-safe zero-stock observation.
  const currentMap = new Map(currentStocks
    .filter((stock) => hasKnownStock(stock))
    .map((stock) => [stockKey(stock), normalizeStockRow(stock)]));
  const currentTupleCounts = new Map();
  currentStocks.filter((stock) => hasKnownStock(stock)).forEach((stock) => {
    const key = stockKey(stock);
    currentTupleCounts.set(key, (currentTupleCounts.get(key) || 0) + 1);
  });
  const ambiguousCurrentTuples = new Set([...currentTupleCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key));
  const blockers = [];
  const changes = [];
  const normalizedTargets = targetStocks.map(normalizeStockRow);
  const targetTupleCounts = new Map();
  normalizedTargets.forEach((target) => {
    const key = stockKey(target);
    targetTupleCounts.set(key, (targetTupleCounts.get(key) || 0) + 1);
  });

  for (const target of normalizedTargets) {
    const product = productMap.get(target.offer_id);
    const warehouse = warehouseMap.get(target.warehouse_id);
    let blocked = false;
    if ((targetTupleCounts.get(stockKey(target)) || 0) > 1) {
      blockers.push({
        code: "DUPLICATE_TARGET_STOCK_TUPLE",
        offer_id: target.offer_id,
        warehouse_id: target.warehouse_id,
      });
      blocked = true;
    }
    if (ambiguousCurrentTuples.has(stockKey(target))) {
      blockers.push({
        code: "CURRENT_STOCK_AMBIGUOUS",
        offer_id: target.offer_id,
        warehouse_id: target.warehouse_id,
      });
      blocked = true;
    }
    if (!target.offer_id || !product) {
      blockers.push({ code: "OFFER_NOT_FOUND", offer_id: target.offer_id, warehouse_id: target.warehouse_id });
      blocked = true;
    } else if (!productReady(product)) {
      blockers.push({
        code: "PRODUCT_NOT_READY",
        offer_id: target.offer_id,
        warehouse_id: target.warehouse_id,
        observed_status: productStatus(product) || "unknown",
        visible: product.visible !== false,
        nextAction: productTransitionAction(product),
      });
      blocked = true;
    }
    if (!warehouse || !warehouseReady(warehouse, { requireModeEvidence: requireWarehouseModeEvidence })) {
      blockers.push({ code: "WAREHOUSE_NOT_READY", offer_id: target.offer_id, warehouse_id: target.warehouse_id });
      blocked = true;
    }
    if (!Number.isInteger(target.stock) || target.stock < 0) {
      blockers.push({ code: "TARGET_STOCK_INVALID", offer_id: target.offer_id, warehouse_id: target.warehouse_id });
      blocked = true;
    }
    if (!blocked && !currentMap.has(stockKey(target))) {
      blockers.push({ code: "CURRENT_STOCK_NOT_OBSERVED", offer_id: target.offer_id, warehouse_id: target.warehouse_id });
      blocked = true;
    }
    if (blocked) continue;
    const current = Number(currentMap.get(stockKey(target)).stock);
    if (current !== target.stock) {
      changes.push({
        offer_id: target.offer_id,
        warehouse_id: target.warehouse_id,
        current,
        target: target.stock,
        delta: target.stock - current,
      });
    }
  }

  return {
    storeId: String(storeId || ""),
    ready: blockers.length === 0,
    blockers,
    changes,
    unchangedCount: normalizedTargets.length - blockers.length - changes.length,
    targetStocks: normalizedTargets,
    idempotencyKey: stockIdempotencyKey(storeId, normalizedTargets),
  };
}

function writeResultFailures(writeResult = {}) {
  if (Array.isArray(writeResult?.errors) && writeResult.errors.length) return writeResult.errors;
  const rows = Array.isArray(writeResult?.result) ? writeResult.result : [];
  return rows.filter((row) => row?.error || row?.errors?.length);
}

export function evaluateStockReconciliation({ plan = {}, writeResult = {}, observedStocks, readError = null } = {}) {
  const failures = writeResultFailures(writeResult);
  if (!plan.ready
    || (failures.length && (failures.length >= (plan.changes || []).length || !Array.isArray(observedStocks)))
    || writeResult?.error) {
    return {
      status: "failed",
      accepted: false,
      reconciled: false,
      idempotencyKey: plan.idempotencyKey || "",
      failures: failures.length ? failures : (writeResult?.error ? [writeResult.error] : (plan.blockers || [])),
      items: [],
    };
  }
  if (!Array.isArray(observedStocks) || readError) {
    return {
      // An accepted write response is not a confirmed business outcome. Keep
      // the command in needs_review until every requested tuple is observed;
      // this mirrors the hard boundary for unknown Ozon write outcomes.
      status: "needs_review",
      accepted: true,
      reconciled: false,
      idempotencyKey: plan.idempotencyKey || "",
      readError: readError ? String(readError.message || readError) : "",
      items: [],
    };
  }

  // Post-write readback must also carry an explicit quantity.  A tuple with
  // only offer/warehouse identity is unknown and cannot match a target of 0.
  const observedRows = observedStocks.filter((stock) => hasKnownStock(stock)).map(normalizeStockRow);
  const observedByTuple = new Map();
  observedRows.forEach((stock) => {
    const key = stockKey(stock);
    const values = observedByTuple.get(key) || new Set();
    values.add(stock.stock);
    observedByTuple.set(key, values);
  });
  const ambiguousTuples = [...observedByTuple.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key);
  if (ambiguousTuples.length) {
    const ambiguousSet = new Set(ambiguousTuples);
    const items = (plan.changes || []).map((change) => ({
      offer_id: change.offer_id,
      warehouse_id: change.warehouse_id,
      expected: change.target,
      actual: null,
      status: ambiguousSet.has(stockKey(change)) ? "ambiguous" : "unresolved",
    }));
    return {
      status: "needs_review",
      accepted: true,
      reconciled: false,
      idempotencyKey: plan.idempotencyKey || "",
      matched: 0,
      total: items.length,
      ambiguousTuples,
      items,
    };
  }
  const observedMap = new Map(observedRows.map((stock) => [stockKey(stock), stock]));
  const writeFailureMap = new Map(failures.map((row) => [stockKey(row), row]));
  const items = (plan.changes || []).map((change) => {
    const writeFailure = writeFailureMap.get(stockKey(change));
    if (writeFailure) {
      return {
        offer_id: change.offer_id,
        warehouse_id: change.warehouse_id,
        expected: change.target,
        actual: null,
        status: "write_failed",
        errors: rowErrors(writeFailure),
      };
    }
    const observed = observedMap.get(stockKey(change));
    const actual = observed ? observed.stock : null;
    return {
      offer_id: change.offer_id,
      warehouse_id: change.warehouse_id,
      expected: change.target,
      actual,
      status: actual === change.target ? "matched" : (actual === null ? "missing" : "mismatch"),
    };
  });
  const matched = items.filter((item) => item.status === "matched").length;
  const status = matched === items.length ? "reconciled" : (matched > 0 ? "partial" : "mismatch");
  return {
    status,
    accepted: true,
    reconciled: status === "reconciled",
    idempotencyKey: plan.idempotencyKey || "",
    matched,
    total: items.length,
    failed: items.filter((item) => item.status === "write_failed").length,
    items,
  };
}

// Build a post-write expectation from the requested target itself. Do not
// reuse a dry-run plan built from post-write evidence: doing so would produce
// zero changes and could falsely report reconciliation without checking the
// exact returned tuple.
export function reconcileStockTargetsReadback({
  storeId = "",
  targetStocks = [],
  writeResponse = {},
  observedStocks,
  readError = null,
} = {}) {
  const writeSummary = summarizeStockWriteResult(writeResponse);
  if (writeSummary.status === "unknown") {
    return {
      status: "unknown",
      accepted: false,
      reconciled: false,
      idempotencyKey: stockIdempotencyKey(storeId, targetStocks.map(normalizeStockRow)),
      failures: [{ code: "STOCK_WRITE_ACK_UNKNOWN", message: "库存写入响应没有可核对的逐项回执。" }],
      items: [],
    };
  }
  const normalizedTargets = targetStocks.map(normalizeStockRow);
  const plan = {
    ready: true,
    blockers: [],
    changes: normalizedTargets.map((target) => ({
      offer_id: target.offer_id,
      warehouse_id: target.warehouse_id,
      current: null,
      target: target.stock,
      delta: null,
    })),
    idempotencyKey: stockIdempotencyKey(storeId, normalizedTargets),
  };
  return evaluateStockReconciliation({ plan, writeResult: writeResponse, observedStocks, readError });
}

export function dryRunStockJobReconciliation({
  job = {},
  products,
  warehouses,
  currentStocks,
  requireWarehouseModeEvidence = false,
} = {}) {
  const missingEvidence = [];
  if (!String(job?.storeId || "").trim()) missingEvidence.push("storeId");
  if (!Array.isArray(products)) missingEvidence.push("products");
  if (!Array.isArray(warehouses)) missingEvidence.push("warehouses");
  if (!Array.isArray(currentStocks)) missingEvidence.push("currentStocks");
  const targetStocks = Array.isArray(job.stocks) ? job.stocks : [];
  if (!targetStocks.length) missingEvidence.push("job.stocks");

  const plan = buildStockReconciliationPlan({
    storeId: job.storeId || "",
    products: Array.isArray(products) ? products : [],
    warehouses: Array.isArray(warehouses) ? warehouses : [],
    currentStocks: Array.isArray(currentStocks) ? currentStocks : [],
    targetStocks,
    requireWarehouseModeEvidence,
  });
  const executable = missingEvidence.length === 0 && plan.ready;
  return {
    status: executable ? "ready" : "blocked",
    executable,
    dryRun: true,
    jobId: String(job.id || ""),
    storeId: String(job.storeId || ""),
    missingEvidence,
    blockers: plan.blockers,
    diff: plan.changes,
    idempotencyKey: plan.idempotencyKey,
    plan,
  };
}

const STOCK_DRY_RUN_BLOCKER_LABELS = {
  storeId: "缺少库存写入店铺范围",
  products: "缺少商品状态证据",
  warehouses: "缺少仓库状态证据",
  currentStocks: "缺少当前库存快照",
  "job.stocks": "缺少目标库存",
  OFFER_NOT_FOUND: "目标 Offer 未出现在商品状态证据中",
  PRODUCT_NOT_READY: "商品尚未明确可写库存",
  WAREHOUSE_NOT_READY: "仓库尚未明确可用",
  TARGET_STOCK_INVALID: "目标库存必须是大于等于 0 的整数",
  CURRENT_STOCK_NOT_OBSERVED: "该 Offer 在目标仓库的当前库存未知",
  DUPLICATE_TARGET_STOCK_TUPLE: "目标库存重复指定同一 Offer/仓库 tuple",
  CURRENT_STOCK_AMBIGUOUS: "当前库存证据包含重复的 Offer/仓库 tuple",
};

function productBlockerLabel(item = {}) {
  if (item.visible === false) return "商品当前不可见或未上架";
  if (item.observed_status === "unknown") return "商品状态尚未确认";
  return `商品状态为 ${item.observed_status}，尚未明确可售`;
}

export function stockDryRunSellerView(dryRun = {}) {
  const blockerDetails = (dryRun.blockers || []).map((item) => ({
    code: String(item?.code || "STOCK_DRY_RUN_BLOCKED"),
    offer_id: String(item?.offer_id || ""),
    warehouse_id: Number(item?.warehouse_id || 0),
    label: item?.code === "PRODUCT_NOT_READY"
      ? productBlockerLabel(item)
      : STOCK_DRY_RUN_BLOCKER_LABELS[item?.code] || item?.code || "库存预演被阻断",
    observed_status: item?.observed_status || "",
    nextAction: item?.nextAction || "",
  }));
  const blockers = [
    ...(dryRun.missingEvidence || []).map((item) => STOCK_DRY_RUN_BLOCKER_LABELS[item] || String(item)),
    ...(dryRun.blockers || []).map((item) => {
      const label = item?.code === "PRODUCT_NOT_READY"
        ? productBlockerLabel(item)
        : STOCK_DRY_RUN_BLOCKER_LABELS[item?.code] || item?.code || "库存预演被阻断";
      const tuple = item?.offer_id && item?.warehouse_id
        ? `（Offer ${item.offer_id} / 仓库 ${item.warehouse_id}）`
        : item?.offer_id ? `（Offer ${item.offer_id}）` : "";
      return `${label}${tuple}`;
    }),
  ];
  const changes = (dryRun.diff || []).map((item) => ({
    ...item,
    direction: item.delta > 0 ? "增加" : "减少",
  }));
  const executable = dryRun.executable === true;
  const unchanged = executable && changes.length === 0;
  const targetTuples = (dryRun.targetStocks || dryRun.plan?.targetStocks || []).map((item) => ({
    offer_id: String(item?.offer_id || item?.offerId || "").trim(),
    warehouse_id: Number(item?.warehouse_id || item?.warehouseId || 0),
    target: Number(item?.stock ?? item?.quantity ?? 0),
  })).filter((item) => item.offer_id && item.warehouse_id > 0);
  const unknownTuples = blockerDetails
    .filter((item) => item.code === "CURRENT_STOCK_NOT_OBSERVED")
    .map((item) => ({ offer_id: item.offer_id, warehouse_id: item.warehouse_id, current: null }));
  const tupleNextAction = unknownTuples.length
    ? `先重新读取 ${unknownTuples.map((item) => `Offer ${item.offer_id} / 仓库 ${item.warehouse_id}`).join("、")} 的当前库存；返回明确数量后再重新预演。`
    : "";
  return {
    statusLabel: unchanged ? "无需变更" : (executable ? "可以进入人工确认" : "暂不能继续"),
    summary: unchanged
      ? `目标库存与当前快照一致；本次无需写入 Ozon。`
      : executable
        ? `发现 ${changes.length} 项库存差异；本次仅预演，尚未写入 Ozon。`
      : `发现 ${blockers.length} 项阻断；本次未写入 Ozon。`,
    changeCount: changes.length,
    unchangedCount: Number(dryRun.plan?.unchangedCount || 0),
    blockers,
    blockerDetails,
    targetTuples,
    unknownTuples,
    changes,
    nextAction: unchanged
      ? "保持当前库存，不要创建写入任务；后续只需按同步策略重新读取。"
      : executable
        ? "确认差异、目标库存和仓库无误后，再进入受控库存确认流程。"
      : (tupleNextAction
        || blockerDetails.find((item) => item.nextAction)?.nextAction
        || "先补齐上方阻断所需的商品、仓库或当前库存证据，然后重新预演。"),
    sideEffect: "只做本地计算，不创建库存任务，不调用 Ozon 写接口；结果不明确时禁止换幂等键重复写入。",
  };
}

export function reconcileDryRunStockJob({ dryRun = {}, writeResponse = {}, readback, readError = null } = {}) {
  if (dryRun.executable !== true || !dryRun.plan) {
    return {
      status: "failed",
      accepted: false,
      reconciled: false,
      idempotencyKey: dryRun.idempotencyKey || "",
      failures: [...(dryRun.missingEvidence || []), ...(dryRun.blockers || [])],
      items: [],
    };
  }
  return evaluateStockReconciliation({
    plan: dryRun.plan,
    writeResult: writeResponse,
    observedStocks: readback,
    readError,
  });
}

// Queue writes use the same exact-tuple readback contract as the confirmed
// route. An accepted `/v2/products/stocks` response is never promoted to
// success until the requested (offer_id, warehouse_id) rows are observed.
export async function reconcileStockWriteWithReadback({
  storeId = "",
  stocks = [],
  writeResponse = {},
  readEndpoint,
  now,
} = {}) {
  const offerIds = stocks.map((item) => item?.offer_id).filter(Boolean);
  const warehouseIds = stocks.map((item) => item?.warehouse_id).filter(Boolean);
  const evidence = await gatherStockReconciliationEvidence({ storeId, offerIds, warehouseIds }, {
    readEndpoint,
    now: () => now || new Date(),
  });
  const dryRun = dryRunStockJobReconciliation({
    job: { id: "stock-queue-readback", storeId, stocks },
    products: evidence.products,
    warehouses: evidence.warehouses,
    currentStocks: evidence.currentStocks,
  });
  const reconciliation = reconcileStockTargetsReadback({
    storeId,
    targetStocks: stocks,
    writeResponse,
    observedStocks: evidence.currentStocks,
  });
  return { evidence, dryRun, reconciliation };
}

async function readQueue() {
  return JobRepository.readStockQueueJobs(QUEUE_FILE);
}

async function writeQueue(jobs) {
  await JobRepository.writeStockQueueJobs(QUEUE_FILE, jobs);
}

async function updateJob(id, patch) {
  const jobs = await readQueue();
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) return null;
  jobs[index] = {
    ...jobs[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeQueue(jobs);
  return jobs[index];
}

function pendingStatus(status) {
  return ["pending", "waiting_product", "retry_stock", "checking_task"].includes(status);
}

function collectBlockedWarehouseIds(jobs, storeId) {
  return new Set(
    jobs
      .filter((job) => job.storeId === storeId && String(job.reasonCode || "") === "STOCK_WAREHOUSE_INVALID")
      .flatMap((job) => job.stocks || [])
      .map((stock) => Number(stock.warehouse_id || 0))
      .filter(Boolean),
  );
}

function isUsableWarehouse(w, excluded = new Set()) {
  const warehouseId = Number(w?.warehouse_id || 0);
  if (!warehouseId || excluded.has(warehouseId)) return false;
  const status = String(w?.status || "").toLowerCase();
  if (status && status !== "created") return false;
  return w?.is_rf !== false;
}

function normalizeDeliveryMode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function warehouseDeliveryMode(warehouse = {}) {
  return normalizeDeliveryMode(
    warehouse.delivery_method_type
      || warehouse.deliveryMode
      || warehouse.fulfillment_type
      || warehouse.type
      || (warehouse.is_rfbs ? "rfbs" : ""),
  );
}

function requestedDeliveryModes(product = {}, store = {}) {
  return [
    product.deliveryMode,
    product.delivery_method_type,
    product.fulfillmentType,
    product.shippingType,
    store.deliveryMode,
    store.delivery_method_type,
    store.fulfillmentType,
    store.shippingType,
  ].map(normalizeDeliveryMode).filter(Boolean);
}

function failedWarehouseIds(previousFailures = []) {
  return new Set((previousFailures || []).flatMap((failure) => {
    const code = String(failure?.errorCode || failure?.code || "").toUpperCase();
    const reasonCode = String(failure?.reasonCode || "").toUpperCase();
    const message = `${failure?.message || ""} ${failure?.lastError || ""}`.toUpperCase();
    const isWarehouseStatusFailure = code === "WAREHOUSE_WRONG_STATUS"
      || reasonCode === "STOCK_WAREHOUSE_INVALID"
      || message.includes("WAREHOUSE_WRONG_STATUS");
    if (!isWarehouseStatusFailure) return [];
    const directId = Number(failure?.warehouseId || failure?.warehouse_id || 0);
    const stockIds = (failure?.stocks || []).map((stock) => Number(stock?.warehouse_id || 0));
    return [directId, ...stockIds].filter(Boolean);
  }));
}

function warehouseLabel(warehouse = {}) {
  return warehouse.name || warehouse.warehouse_name || warehouse.warehouse_id || warehouse.id || "未命名仓库";
}

export function rankWarehousesForStock({
  warehouses = [],
  excludedIds = [],
  product = {},
  store = {},
  previousFailures = [],
} = {}) {
  const explicitExcluded = new Set([...excludedIds].map(Number).filter(Boolean));
  const failedIds = failedWarehouseIds(previousFailures);
  const requestedModes = requestedDeliveryModes(product, store);
  const candidates = [];
  const excluded = [];

  for (const warehouse of warehouses || []) {
    const warehouseId = Number(warehouse?.warehouse_id || warehouse?.id || 0);
    const status = String(warehouse?.status || "").toLowerCase();
    const mode = warehouseDeliveryMode(warehouse);
    if (!warehouseId) {
      excluded.push({ warehouse_id: 0, name: warehouseLabel(warehouse), reason: "缺少仓库 ID" });
      continue;
    }
    if (failedIds.has(warehouseId)) {
      excluded.push({ warehouse_id: warehouseId, name: warehouseLabel(warehouse), reason: "历史库存写入返回 WAREHOUSE_WRONG_STATUS，本轮不复用" });
      continue;
    }
    if (explicitExcluded.has(warehouseId)) {
      excluded.push({ warehouse_id: warehouseId, name: warehouseLabel(warehouse), reason: "本轮重试已排除这个仓库" });
      continue;
    }
    if (status && status !== "created") {
      excluded.push({ warehouse_id: warehouseId, name: warehouseLabel(warehouse), reason: `仓库状态不可用：${warehouse.status}` });
      continue;
    }
    if (warehouse?.is_rf === false) {
      excluded.push({ warehouse_id: warehouseId, name: warehouseLabel(warehouse), reason: "仓库不可用于当前 Ozon 库存写入" });
      continue;
    }

    const modeMatched = Boolean(mode && requestedModes.includes(mode));
    const reasons = ["状态可用"];
    let score = 100;
    if (modeMatched) {
      score += 30;
      reasons.push("匹配商品/店铺配送模式");
    } else if (requestedModes.length) {
      reasons.push("配送模式未完全匹配，作为备用仓库");
    } else {
      reasons.push("未提供商品/店铺配送模式，作为可用仓库");
    }
    if (warehouse.is_rfbs) score += 5;
    candidates.push({
      warehouse,
      warehouse_id: warehouseId,
      name: warehouseLabel(warehouse),
      status: warehouse.status || "",
      deliveryMode: mode || "",
      score,
      reasons,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.warehouse_id - b.warehouse_id);
  const winner = candidates[0] || null;
  return {
    recommended: winner?.warehouse || null,
    recommendedReason: winner ? winner.reasons.join("，") : "",
    action: winner ? "use_recommended" : "manual_required",
    safeNextAction: winner
      ? `使用仓库 ${winner.name}(${winner.warehouse_id}) 进入库存队列重试；不会绕过商品就绪检查。`
      : "读取 Ozon 仓库或人工确认可写仓库后，再从库存队列重试。",
    candidates,
    excluded,
  };
}

export function pickWarehouse(list, excluded = new Set()) {
  const ranked = rankWarehousesForStock({ warehouses: list, excludedIds: [...excluded] });
  return ranked.recommended
    || (list || []).find((w) => isUsableWarehouse(w, excluded))
    || (list || []).find((w) => Number(w?.warehouse_id || 0) && !excluded.has(Number(w.warehouse_id || 0)) && String(w?.status || "").toLowerCase() !== "disabled");
}

function warehouseListFromResponse(data) {
  return Array.isArray(data?.warehouses) ? data.warehouses : (Array.isArray(data?.result) ? data.result : []);
}

export function classifyStockErrors(stockErrors = [], options = {}) {
  const message = (stockErrors || [])
    .map((error) => [error.code, error.message].filter(Boolean).join(": "))
    .join("；");
  const hasWarehouseWrongStatus = stockErrors.some((error) => String(error.code || "").toUpperCase() === "WAREHOUSE_WRONG_STATUS");
  const hasPendingTagValidation = stockErrors.some((error) => {
    const code = String(error.code || "").toUpperCase();
    const text = `${error.message || ""} ${error.description || ""}`.toLowerCase();
    return code === "PRODUCT_HAS_NOT_BEEN_TAGGED_YET" || text.includes("tags validation failed");
  });
  if (hasPendingTagValidation) {
    return {
      shouldRetry: true,
      reasonCode: "PRODUCT_PENDING_TAGS",
    };
  }
  const reasonCode = hasWarehouseWrongStatus ? "STOCK_WAREHOUSE_INVALID" : mapReasonCode(message);
  return {
    shouldRetry: Boolean(hasWarehouseWrongStatus && Number(options.replacementWarehouseId || 0)),
    reasonCode,
  };
}

export function workflowStockNodeFromJob(job = {}) {
  const status = String(job.status || "");
  const needsReview = status === "needs_review";
  return {
    key: "stock_sync",
    name: "库存写入",
    status: status === "success" ? "success" : status === "failed" ? "failed" : needsReview ? "waiting_human" : "running",
    output: {
      stockQueueId: job.id,
      taskId: job.taskId,
      stocks: job.stocks || [],
      result: job.result || {},
      sellerStatus: needsReview ? "needs_review" : status,
    },
    error: status === "failed" ? { raw: job.lastError || job.error || "" } : {},
    actions: status === "failed" ? ["retry_node"] : needsReview ? ["view_output", "manual_review"] : ["view_output"],
  };
}

async function updateWorkflowStockNode(job) {
  const runs = await listWorkflowRuns().catch(() => ({ items: [] }));
  const run = (runs.items || []).find((item) => String(item.entity?.taskId || "") === String(job.taskId || ""));
  if (!run) return;
  await upsertWorkflowNode(run.id, {
    ...workflowStockNodeFromJob(job),
    runStatus: job.status === "success" ? "live" : job.status === "failed" ? "waiting_human" : "running",
  }).catch(() => {});
}

export async function listStockJobs() {
  const jobs = await readQueue();
  return jobs.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export function summarizeStockQueueOperations(jobs = [], { now = Date.now(), staleAfterMs = 30 * 60 * 1000 } = {}) {
  const items = Array.isArray(jobs) ? jobs : [];
  const byStatus = {};
  const byReason = {};
  const byStore = {};
  let oldestPendingAt = null;
  let staleRunning = 0;
  let needsReview = 0;
  let unresolvedReadback = 0;
  for (const job of items) {
    const status = String(job?.status || "unknown");
    byStatus[status] = (byStatus[status] || 0) + 1;
    const reason = String(job?.reasonCode || "").trim();
    if (reason) byReason[reason] = (byReason[reason] || 0) + 1;
    const storeId = String(job?.storeId || "unknown");
    byStore[storeId] = (byStore[storeId] || 0) + 1;
    const updatedAt = Date.parse(job?.updatedAt || job?.createdAt || "");
    if (pendingStatus(status) && Number.isFinite(updatedAt) && (!oldestPendingAt || updatedAt < oldestPendingAt)) {
      oldestPendingAt = updatedAt;
    }
    if (["running", "checking_task"].includes(status)
      && Number.isFinite(updatedAt) && Number(now) - updatedAt >= staleAfterMs) staleRunning += 1;
    if (status === "needs_review") needsReview += 1;
    const readbackStatus = String(job?.result?.readback?.status || "").trim().toLowerCase();
    if (status === "needs_review" || ["unknown", "mismatch", "partial"].includes(readbackStatus)) {
      unresolvedReadback += 1;
    }
  }
  const nextActions = [];
  if (staleRunning) nextActions.push("检查 worker 进程和最近错误，再人工决定是否重试");
  if (unresolvedReadback) nextActions.push("逐项回查相同 Offer/仓库 tuple；回查完成前禁止换幂等键重复写入");
  return {
    ok: true,
    readOnly: true,
    total: items.length,
    byStatus,
    byReason,
    byStore,
    oldestPendingAt: oldestPendingAt ? new Date(oldestPendingAt).toISOString() : null,
    staleRunning,
    needsReview,
    unresolvedReadback,
    nextActions,
    sideEffect: "仅汇总本地队列状态；未读取 Ozon、未排队、未重放、未写入库存。",
  };
}

function previousWarehouseFailures(jobs = [], storeId = "") {
  return (jobs || []).filter((job) => job.storeId === storeId && String(job.reasonCode || "") === "STOCK_WAREHOUSE_INVALID");
}

export function stockJobWarehouseRecommendation(job = {}, warehouses = [], allJobs = []) {
  const previousFailures = previousWarehouseFailures(allJobs, job.storeId);
  const excludedIds = String(job.reasonCode || "") === "STOCK_WAREHOUSE_INVALID"
    ? (job.stocks || []).map((stock) => Number(stock.warehouse_id || 0)).filter(Boolean)
    : [];
  return rankWarehousesForStock({
    warehouses,
    excludedIds,
    product: {
      deliveryMode: job.deliveryMode || job.delivery_method_type || job.fulfillmentType || job.shippingType,
    },
    store: {
      deliveryMode: job.storeDeliveryMode || job.store_delivery_method_type || job.storeFulfillmentType,
    },
    previousFailures,
  });
}

export async function resolveWarehouseIdForStore(storeId) {
  const jobs = await readQueue();
  const blockedIds = collectBlockedWarehouseIds(jobs, storeId);
  const recent = jobs
    .filter((job) => job.storeId === storeId && Array.isArray(job.stocks) && job.stocks.length)
    .filter((job) => String(job.reasonCode || "") !== "STOCK_WAREHOUSE_INVALID")
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  for (const job of recent) {
    const wid = Number(job.stocks?.[0]?.warehouse_id || 0);
    if (wid && !blockedIds.has(wid)) return wid;
  }
  const store = getStore(storeId);
  const data = await ozonRequest(store, "/v2/warehouse/list", {});
  const list = warehouseListFromResponse(data);
  const recommendation = rankWarehousesForStock({
    warehouses: list,
    excludedIds: [...blockedIds],
    previousFailures: previousWarehouseFailures(jobs, storeId),
  });
  const primary = recommendation.recommended;
  if (!primary) throw new Error("未找到可写库存仓库ID：已有仓库被 Ozon 返回 WAREHOUSE_WRONG_STATUS");
  return Number(primary.warehouse_id);
}

async function fetchPrimaryWarehouseRecommendation(storeId, excluded = new Set()) {
  const jobs = await readQueue();
  const blockedIds = collectBlockedWarehouseIds(jobs, storeId);
  const excludedIds = new Set([...excluded, ...blockedIds]);
  const store = getStore(storeId);
  const data = await ozonRequest(store, "/v2/warehouse/list", {});
  const list = warehouseListFromResponse(data);
  const recommendation = rankWarehousesForStock({
    warehouses: list,
    excludedIds: [...excludedIds],
    previousFailures: previousWarehouseFailures(jobs, storeId),
  });
  if (!recommendation.recommended) throw new Error("未找到可替换的可用仓库ID");
  return recommendation;
}

function stockResultRows(stockResult) {
  return Array.isArray(stockResult?.result)
    ? stockResult.result
    : (Array.isArray(stockResult?.items) ? stockResult.items : []);
}

function rowErrors(row = {}) {
  const values = [
    ...(Array.isArray(row.errors) ? row.errors : (row.errors ? [row.errors] : [])),
    ...(row.error ? [row.error] : []),
  ];
  return values.map((error) => (typeof error === "object" ? error : { message: error }));
}

function stockResultErrors(stockResult) {
  return stockResultRows(stockResult).flatMap((row) => rowErrors(row).map((error) => ({
    offerId: row.offer_id || row.offerId || "",
    warehouseId: row.warehouse_id || row.warehouseId || 0,
    code: error.code || error.reason || "",
    message: error.message || error.description || String(error || ""),
  })));
}

// Seller-facing, bounded result summary. A row without an explicit error is
// only an accepted acknowledgement; it is not a readback and never upgrades
// the job to real-write-verified. Unknown/empty response remains unknown.
export function summarizeStockWriteResult(stockResult = {}) {
  const rows = stockResultRows(stockResult);
  const items = rows.slice(0, 100).map((row) => {
    const errors = rowErrors(row);
    return {
      offer_id: String(row.offer_id || row.offerId || ""),
      warehouse_id: Number(row.warehouse_id || row.warehouseId || 0),
      status: errors.length ? "failed" : "accepted_acknowledgement",
      errors: errors.slice(0, 5).map((error) => ({
        code: String(error.code || error.reason || ""),
        message: String(error.message || error.description || error || ""),
      })),
    };
  });
  const failedCount = items.filter((item) => item.status === "failed").length;
  const acceptedCount = items.filter((item) => item.status === "accepted_acknowledgement").length;
  return {
    status: !rows.length ? "unknown" : (failedCount && acceptedCount ? "partial" : failedCount ? "failed" : "accepted"),
    failedCount,
    acceptedCount,
    truncated: rows.length > items.length,
    items,
    readbackRequired: true,
  };
}

function hasImportSeriousErrors(job) {
  const rows = job?.result?.importInfo?.result?.items || job?.result?.result?.items || job?.result?.items || [];
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => (row.errors || []).some((error) => error.level === "error"));
}

function canReplayStockFailure(job) {
  if (hasImportSeriousErrors(job)) return false;
  const reasonCode = primaryStockFailureReason(job);
  return ["STOCK_WRITE_FAILED", "EXTERNAL_API_ERROR", "UNKNOWN"].includes(reasonCode);
}

// Once /v2/products/stocks has been sent, a transport timeout or upstream 5xx
// does not prove that Ozon rejected the write. Keep the queue in human review
// until an exact tuple readback resolves the outcome; never classify this as a
// retryable ordinary failure.
export function stockWriteOutcomeRequiresReview(error = {}) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status >= 500) return true;
  if (error?.unknownOutcome === true) return true;
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "FETCH_FAILED", "ABORT_ERR"].includes(code)) return true;
  const message = String(error?.message || "");
  return /Ozon request timeout|network|fetch failed|socket|连接|超时/i.test(message);
}

function primaryStockFailureReason(job) {
  const direct = mapReasonCode(job.lastError || "");
  if (direct !== "UNKNOWN") return direct;
  return mapReasonCode(JSON.stringify(job.result || {}).slice(0, 4000));
}

export async function enqueueStockJob({ storeId, taskId, stocks, delayMs = 5 * 60 * 1000 }) {
  const cleanStocks = (stocks || [])
    .map((item) => ({
      offer_id: String(item.offer_id || "").trim(),
      stock: Number(item.stock || 0),
      warehouse_id: Number(item.warehouse_id || 0),
    }))
    .filter((item) => item.offer_id && item.warehouse_id && Number.isFinite(item.stock));
  if (!storeId) throw new Error("库存队列缺少店铺");
  if (!taskId) throw new Error("库存队列缺少 task_id");
  if (!cleanStocks.length) throw new Error("没有可写入库存的 SKU");

  const now = new Date();
  const job = {
    id: `sq${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    storeId,
    taskId: Number(taskId),
    stocks: cleanStocks,
    status: "pending",
    attempts: 0,
    maxAttempts: 10,
    runAt: new Date(now.getTime() + Number(delayMs || 0)).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastError: "",
    result: null,
  };
  const jobs = await readQueue();
  jobs.push(job);
  await writeQueue(jobs);
  scheduleStockJob(job);
  return job;
}

export async function recordFailedStockJob({ storeId, taskId, stocks = [], error = "库存排队失败" }) {
  const now = new Date();
  const message = String(error || "库存排队失败");
  const job = {
    id: `sq${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    storeId: String(storeId || ""),
    taskId: Number(taskId || 0),
    stocks: (stocks || []).map((item) => ({
      offer_id: String(item.offer_id || "").trim(),
      stock: Number(item.stock || 0),
      warehouse_id: Number(item.warehouse_id || 0),
    })).filter((item) => item.offer_id),
    status: "failed",
    attempts: 0,
    maxAttempts: 10,
    runAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastError: message,
    reasonCode: mapReasonCode(message),
    result: null,
  };
  const jobs = await readQueue();
  jobs.push(job);
  await writeQueue(jobs);
  await updateWorkflowStockNode(job);
  return job;
}

export async function restoreStockQueue() {
  const jobs = await readQueue();
  for (const job of jobs.filter((item) => pendingStatus(item.status))) {
    scheduleStockJob(job);
  }
}

export async function replayFailedStockJobs(options = {}) {
  const rawLimit = Number(options.limit ?? 10);
  if (Number.isFinite(rawLimit) && rawLimit <= 0) return { ok: true, scanned: 0, replayed: 0 };
  const limit = Math.max(1, rawLimit);
  const cooldownMs = Math.max(60_000, Number(options.cooldownMs || 5 * 60 * 1000));
  const requestedStoreId = String(options.storeId || "").trim();
  const allowedStoreIds = new Set((Array.isArray(options.storeIds) ? options.storeIds : [])
    .map((value) => String(value || "").trim()).filter(Boolean));
  const jobs = await readQueue();
  const failed = jobs
    .filter((j) => String(j.status || "") === "failed")
    .filter((j) => !requestedStoreId || String(j.storeId || "").trim() === requestedStoreId)
    .filter((j) => !allowedStoreIds.size || allowedStoreIds.has(String(j.storeId || "").trim()))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, limit);
  let replayed = 0;
  for (const job of failed) {
    const attempts = Number(job.attempts || 0);
    if (attempts >= Number(job.maxAttempts || 10)) continue;
    if (!canReplayStockFailure(job)) continue;
    if (String(job.reasonCode || "") === "STOCK_WAREHOUSE_INVALID") continue;
    const missingWarehouse = (job.stocks || []).some((stock) => !Number(stock.warehouse_id || 0));
    let stocks = job.stocks || [];
    if (missingWarehouse) {
      const replacementWarehouseId = await resolveWarehouseIdForStore(job.storeId).catch(() => 0);
      if (!replacementWarehouseId) continue;
      stocks = stocks.map((stock) => ({ ...stock, warehouse_id: replacementWarehouseId }));
    }
    const next = await updateJob(job.id, {
      status: "retry_stock",
      runAt: new Date(Date.now() + cooldownMs).toISOString(),
      lastError: "自动重放失败库存任务",
      stocks,
    });
    if (next) {
      scheduleStockJob(next);
      replayed += 1;
    }
  }
  return { ok: true, scanned: failed.length, replayed };
}

export async function recordStockQueueFailuresToLearning(options = {}) {
  const rawLimit = Number(options.limit ?? 20);
  if (Number.isFinite(rawLimit) && rawLimit <= 0) return { ok: true, scanned: 0, recorded: 0, details: [] };
  const limit = Math.max(1, rawLimit);
  const jobs = await readQueue();
  const allFailed = jobs.filter((j) => String(j.status || "") === "failed");
  for (const job of allFailed) {
    const reasonCode = primaryStockFailureReason(job);
    if (reasonCode !== String(job.reasonCode || "")) {
      await updateJob(job.id, { reasonCode });
    }
  }
  const failed = jobs
    .filter((j) => String(j.status || "") === "failed")
    .filter((j) => !j.auditLearningAt)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, limit);
  let recorded = 0;
  const details = [];
  for (const job of failed) {
    const reasonCode = primaryStockFailureReason(job);
    await recordListingExperience({
      outcome: "failed",
      stage: "ozon_audit_stock_queue",
      jobId: job.id,
      ozonContext: {
        title: String(job.stocks?.[0]?.offer_id || job.taskId || ""),
        category: "",
      },
      candidate: {
        title: String(job.stocks?.map((item) => item.offer_id).filter(Boolean).join(", ") || ""),
      },
      failReason: [reasonCode, job.lastError || "stock queue failed"].filter(Boolean).join(": "),
    });
    await updateJob(job.id, {
      reasonCode,
      auditLearningAt: new Date().toISOString(),
    });
    recorded += 1;
    details.push({ id: job.id, taskId: job.taskId, reasonCode });
  }
  return { ok: true, scanned: failed.length, recorded, details };
}

function scheduleStockJob(job) {
  if (!job?.id || timers.has(job.id)) return;
  const delay = Math.max(0, new Date(job.runAt || Date.now()).getTime() - Date.now());
  const timer = setTimeout(async () => {
    timers.delete(job.id);
    try {
      await processStockJob(job.id);
    } catch {
      // Job state is persisted by processStockJob; keep the queue worker quiet.
    }
  }, delay);
  timers.set(job.id, timer);
}

async function processStockJob(id) {
  const jobs = await readQueue();
  const job = jobs.find((item) => item.id === id);
  if (!job || !pendingStatus(job.status)) return;

  const attempts = Number(job.attempts || 0) + 1;
  await updateJob(id, { status: "checking_task", attempts });

  let stockWriteAttempted = false;
  try {
    const store = getStore(job.storeId);
    const info = await ozonRequest(store, "/v1/product/import/info", { task_id: Number(job.taskId) });
    const items = info.result?.items || info.items || info.result || [];
    const seriousErrors = Array.isArray(items)
      ? items.flatMap((item) => (item.errors || []).filter((error) => error.level === "error"))
      : [];
    if (seriousErrors.length) {
      const reason = seriousErrors.map((error) => error.message || error.description || error.code).filter(Boolean).join("；");
      const failedJob = await updateJob(id, {
        status: "failed",
        lastError: reason,
        reasonCode: mapReasonCode(reason),
        result: info,
      });
      if (failedJob) await updateWorkflowStockNode(failedJob);
      trackEvent("listing_failed", {
        jobId: id,
        storeId: job.storeId,
        stage: "stock_queue",
        status: "failed",
        reasonCode: mapReasonCode(reason),
        durationMs: 0,
      });
      return;
    }

    const blockedImport = (Array.isArray(items) ? items : []).find((item) => !productImportReadiness(item).ready && (item.product_id || item.offer_id));
    if (blockedImport) {
      const failedJob = await updateJob(id, {
        status: "failed",
        lastError: "Ozon 商品导入/审核状态未就绪，禁止写入库存。",
        reasonCode: "PRODUCT_IMPORT_NOT_READY",
        result: info,
      });
      if (failedJob) await updateWorkflowStockNode(failedJob);
      return;
    }

    const importedOffers = new Set((Array.isArray(items) ? items : [])
      .filter((item) => productImportReadiness(item).ready)
      .map((item) => item.offer_id));
    const missing = job.stocks.filter((stock) => !importedOffers.has(stock.offer_id));
    if (missing.length && attempts < job.maxAttempts) {
      await retryLater(id, "waiting_product", `等待 Ozon 创建商品：${missing.map((item) => item.offer_id).join(", ")}`);
      return;
    }

    stockWriteAttempted = true;
    const stockResult = await ozonRequest(store, "/v2/products/stocks", { stocks: job.stocks });
    const stockResultSummary = summarizeStockWriteResult(stockResult);
    const stockErrors = stockResultErrors(stockResult);
    // A mixed acknowledgement is not a complete queue failure: some tuples
    // may have been accepted while others were rejected. Preserve the
    // per-tuple result and perform the same exact readback; only an all-failed
    // response may enter the retry/failure classification directly.
    if (stockErrors.length && stockResultSummary.status !== "partial") {
      const message = stockErrors.map((error) => [error.code, error.message].filter(Boolean).join(": ")).join("；");
      const oldIds = new Set(job.stocks.map((stock) => Number(stock.warehouse_id || 0)).filter(Boolean));
      const warehouseRecommendation = stockErrors.some((error) => String(error.code || "").toUpperCase() === "WAREHOUSE_WRONG_STATUS")
        ? await fetchPrimaryWarehouseRecommendation(job.storeId, oldIds).catch(() => null)
        : null;
      const replacementWarehouseId = Number(warehouseRecommendation?.recommended?.warehouse_id || 0);
      const classification = classifyStockErrors(stockErrors, { replacementWarehouseId });
      if (attempts < job.maxAttempts && classification.shouldRetry) {
        if (classification.reasonCode === "PRODUCT_PENDING_TAGS") {
          await retryLater(id, "waiting_product", "等待 Ozon 商品标签/图片校验完成后重试库存", {
            reasonCode: classification.reasonCode,
            result: { importInfo: info, stockResult, stockResultSummary },
          });
          return;
        }
          await retryLater(id, "retry_stock", "仓库状态不可用，已切换仓库后重试: " + replacementWarehouseId, {
            stocks: job.stocks.map((stock) => ({ ...stock, warehouse_id: replacementWarehouseId })),
            reasonCode: classification.reasonCode,
            warehouseRecommendation,
            result: { importInfo: info, stockResult, stockResultSummary },
          });
          return;
      }
      const failedJob = await updateJob(id, {
        status: "failed",
        lastError: message,
        reasonCode: classification.reasonCode,
        warehouseRecommendation,
        result: { importInfo: info, stockResult, stockResultSummary },
      });
      if (failedJob) await updateWorkflowStockNode(failedJob);
      trackEvent("listing_failed", {
        jobId: id,
        storeId: job.storeId,
        stage: "stock_queue",
        status: "failed",
        reasonCode: classification.reasonCode,
        durationMs: 0,
      });
      return;
    }
    let readback;
    try {
      readback = await reconcileStockWriteWithReadback({
        storeId: job.storeId,
        stocks: job.stocks,
        writeResponse: stockResult,
        readEndpoint: async (endpoint, payload) => ozonRequest(store, endpoint, payload),
      });
    } catch (readbackError) {
      readback = {
        evidence: { ok: false, partial: true, missingEvidence: ["readback_dependency"], sellerView: { status: "partial" } },
        dryRun: { executable: false, blockers: [{ code: "STOCK_WRITE_READBACK_REQUIRED" }], idempotencyKey: "" },
        reconciliation: { status: "unknown", accepted: true, reconciled: false, readError: String(readbackError?.message || readbackError) },
      };
    }
    const readbackStatus = readback.reconciliation?.status || "unknown";
    if (readbackStatus !== "reconciled") {
      const reviewJob = await updateJob(id, {
        status: "needs_review",
        lastError: "库存写入已返回，但写后精确库存回查未确认。",
        reasonCode: "STOCK_WRITE_READBACK_REQUIRED",
        result: {
          importInfo: info,
          stockResult,
          stockResultSummary,
          readback: {
            status: readbackStatus,
            missingEvidence: readback.evidence?.missingEvidence || [],
            reconciliation: readback.reconciliation || {},
          },
        },
      });
      if (reviewJob) await updateWorkflowStockNode(reviewJob);
      trackEvent("stock_needs_review", {
        jobId: id,
        storeId: job.storeId,
        stage: "stock_queue",
        status: "needs_review",
        reasonCode: "STOCK_WRITE_READBACK_REQUIRED",
        durationMs: 0,
      });
      return;
    }
    const successJob = await updateJob(id, {
      status: "success",
      lastError: "",
      reasonCode: "",
      result: {
        importInfo: info,
        stockResult,
        stockResultSummary,
        readback: {
          status: readbackStatus,
          checkedAt: readback.evidence?.checkedAt || "",
          matched: readback.reconciliation?.matched || 0,
          total: readback.reconciliation?.total || 0,
        },
      },
    });
    if (successJob) await updateWorkflowStockNode(successJob);
    trackEvent("stock_success", {
      jobId: id,
      storeId: job.storeId,
      stage: "stock_queue",
      status: "success",
      reasonCode: "",
      durationMs: 0,
    });
  } catch (error) {
    const message = error.details?.message || error.message || "库存写入失败";
    if (stockWriteAttempted && stockWriteOutcomeRequiresReview(error)) {
      const reviewJob = await updateJob(id, {
        status: "needs_review",
        lastError: "库存写入结果未知，必须先精确回查后才能决定下一步。",
        reasonCode: "STOCK_WRITE_OUTCOME_UNKNOWN",
        result: {
          unknownOutcome: true,
          stockWriteAttempted: true,
          errorStatus: Number(error?.status || error?.statusCode || 0) || null,
        },
      });
      if (reviewJob) await updateWorkflowStockNode(reviewJob);
      trackEvent("stock_needs_review", {
        jobId: id,
        storeId: job.storeId,
        stage: "stock_queue",
        status: "needs_review",
        reasonCode: "STOCK_WRITE_OUTCOME_UNKNOWN",
        durationMs: 0,
      });
      return;
    }
    if (attempts < job.maxAttempts && /PRODUCT_IS_NOT_CREATED|not created|not found|创建|不存在/i.test(message)) {
      await retryLater(id, "retry_stock", message);
      return;
    }
    const failedJob = await updateJob(id, {
      status: "failed",
      lastError: message,
      reasonCode: mapReasonCode(message),
      result: error.details || null,
    });
    if (failedJob) await updateWorkflowStockNode(failedJob);
    trackEvent("listing_failed", {
      jobId: id,
      storeId: job.storeId,
      stage: "stock_queue",
      status: "failed",
      reasonCode: mapReasonCode(message),
      durationMs: 0,
    });
  }
}

async function retryLater(id, status, message, extra = {}) {
  const next = await updateJob(id, {
    status,
    lastError: message,
    runAt: new Date(Date.now() + 60 * 1000).toISOString(),
    ...extra,
  });
  scheduleStockJob(next);
}
