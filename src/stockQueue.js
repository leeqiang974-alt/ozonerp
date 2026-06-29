import path from "node:path";
import { getStore } from "./config.js";
import { ozonRequest } from "./ozon.js";
import { JobRepository } from "./jobRepository.js";
import { trackEvent } from "./observability.js";
import { mapReasonCode } from "./reasonCodes.js";
import { recordListingExperience } from "./learningMemory.js";
import { listWorkflowRuns, upsertWorkflowNode } from "./workflowRuns.js";

const DATA_DIR = path.resolve("data");
const QUEUE_FILE = path.join(DATA_DIR, "stock-queue.json");
const timers = new Map();

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

export function pickWarehouse(list, excluded = new Set()) {
  return (list || []).find((w) => isUsableWarehouse(w, excluded))
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
  return {
    key: "stock_sync",
    name: "库存写入",
    status: status === "success" ? "success" : status === "failed" ? "failed" : "running",
    output: {
      stockQueueId: job.id,
      taskId: job.taskId,
      stocks: job.stocks || [],
      result: job.result || {},
    },
    error: status === "failed" ? { raw: job.lastError || job.error || "" } : {},
    actions: status === "failed" ? ["retry_node"] : ["view_output"],
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
  const primary = pickWarehouse(list, blockedIds);
  if (!primary) throw new Error("未找到可写库存仓库ID：已有仓库被 Ozon 返回 WAREHOUSE_WRONG_STATUS");
  return Number(primary.warehouse_id);
}

async function fetchPrimaryWarehouseId(storeId, excluded = new Set()) {
  const jobs = await readQueue();
  const blockedIds = collectBlockedWarehouseIds(jobs, storeId);
  const excludedIds = new Set([...excluded, ...blockedIds]);
  const store = getStore(storeId);
  const data = await ozonRequest(store, "/v2/warehouse/list", {});
  const list = warehouseListFromResponse(data);
  const primary = pickWarehouse(list, excludedIds);
  if (!primary) throw new Error("未找到可替换的可用仓库ID");
  return Number(primary.warehouse_id);
}

function stockResultErrors(stockResult) {
  const rows = Array.isArray(stockResult?.result) ? stockResult.result : [];
  return rows.flatMap((row) => (row.errors || []).map((error) => ({
    offerId: row.offer_id,
    warehouseId: row.warehouse_id,
    code: error.code || "",
    message: error.message || error.description || "",
  })));
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
  const jobs = await readQueue();
  const failed = jobs
    .filter((j) => String(j.status || "") === "failed")
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

    const importedOffers = new Set((Array.isArray(items) ? items : [])
      .filter((item) => String(item.status || "").toLowerCase() === "imported" || item.product_id)
      .map((item) => item.offer_id));
    const missing = job.stocks.filter((stock) => !importedOffers.has(stock.offer_id));
    if (missing.length && attempts < job.maxAttempts) {
      await retryLater(id, "waiting_product", `等待 Ozon 创建商品：${missing.map((item) => item.offer_id).join(", ")}`);
      return;
    }

    const stockResult = await ozonRequest(store, "/v2/products/stocks", { stocks: job.stocks });
    const stockErrors = stockResultErrors(stockResult);
    if (stockErrors.length) {
      const message = stockErrors.map((error) => [error.code, error.message].filter(Boolean).join(": ")).join("；");
      const oldIds = new Set(job.stocks.map((stock) => Number(stock.warehouse_id || 0)).filter(Boolean));
      const replacementWarehouseId = stockErrors.some((error) => String(error.code || "").toUpperCase() === "WAREHOUSE_WRONG_STATUS")
        ? await fetchPrimaryWarehouseId(job.storeId, oldIds).catch(() => 0)
        : 0;
      const classification = classifyStockErrors(stockErrors, { replacementWarehouseId });
      if (attempts < job.maxAttempts && classification.shouldRetry) {
        if (classification.reasonCode === "PRODUCT_PENDING_TAGS") {
          await retryLater(id, "waiting_product", "等待 Ozon 商品标签/图片校验完成后重试库存", {
            reasonCode: classification.reasonCode,
            result: { importInfo: info, stockResult },
          });
          return;
        }
          await retryLater(id, "retry_stock", "仓库状态不可用，已切换仓库后重试: " + replacementWarehouseId, {
            stocks: job.stocks.map((stock) => ({ ...stock, warehouse_id: replacementWarehouseId })),
            reasonCode: classification.reasonCode,
            result: { importInfo: info, stockResult },
          });
          return;
      }
      const failedJob = await updateJob(id, {
        status: "failed",
        lastError: message,
        reasonCode: classification.reasonCode,
        result: { importInfo: info, stockResult },
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
    const successJob = await updateJob(id, {
      status: "success",
      lastError: "",
      reasonCode: "",
      result: { importInfo: info, stockResult },
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
