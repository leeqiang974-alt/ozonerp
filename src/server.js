import cors from "cors";
import express from "express";
import { defaultFbsDateRange, ozonGetRequest, ozonRequest } from "./ozon.js";
import { getStore, loadStores, publicStore } from "./config.js";
import { calculateOzonPrice, RMB_SHIPPING_LEVELS } from "./pricing.js";
import { fetch1688Html, parse1688Product } from "./collector1688.js";
import { parsePddProduct } from "./collectorPdd.js";
import {
  addCollectionItem,
  deleteCollectionItem,
  getCollectionItem,
  listCollectionItems,
  updateCollectionItem,
} from "./collectionBox.js";
import {
  attributeValueCacheKey,
  flattenCategories,
  loadCategoryCache,
  matchCategory,
  saveCategoryCache,
  upsertAttributeValuesCache,
} from "./ozonCategoryCache.js";
import { prepareOzonImages } from "./imageOss.js";
import { nextParentSku, reserveParentSkus } from "./skuSequence.js";
import { generateListingContentWithLlm, llmConfig } from "./llmListing.js";
import { triggerRuleAnalysis, getRuleSummary, getEnhancedRuleSummary } from "./listingRules.js";
import {
  getExternalOzonLearningStatus,
  startExternalOzonLearningMonitor,
  syncExternalOzonLearning,
} from "./externalOzonLearning.js";
import { enqueueStockJob, listStockJobs, restoreStockQueue, replayFailedStockJobs } from "./stockQueue.js";
import {
  claimCrawlerExtensionJob,
  clearCrawlerSessionCookie,
  completeCrawlerExtensionDetail,
  completeCrawlerExtensionDiscover,
  createCrawlerTask,
  createExpandedTasks,
  deleteCrawlerTask,
  expandKeywords,
  getCrawlerWorkerStatus,
  getCrawlerSessionStatus,
  getCrawlerTask,
  listCrawlerCandidates,
  listCrawlerTasks,
  matchCandidatesWithOpportunities,
  moveCaptureToCrawlerCandidate,
  moveCrawlerCandidateToCapture,
  recordCrawlerWorkerHeartbeat,
  setCrawlerSessionCookie,
  updateCrawlerCandidate,
  updateCrawlerTaskStatus,
} from "./crawler1688.js";
import {
  claimOzonLearningJob,
  completeOzonDetailJob,
  completeOzonSearchJob,
  createOzonBlindSearchRun,
  createOzonLearningTask,
  deleteOzonLearningTask,
  listOzonLearningItems,
  listOzonLearningTasks,
  listOzonOpportunities,
  reverseSearch1688,
  analyzeOzonOpportunities,
} from "./ozonLearning.js";
import {
  runFullPipeline,
  getPipelineStatus,
  checkAndTriggerPipeline,
} from "./pipeline.js";
import {
  errorHandler,
  finalizeRequest,
  initServerObservability,
  requestContextMiddleware,
} from "./observability.js";

import {
  triggerAutoListing,
  listAutoListingJobs,
  getAutoListingJob,
  testMatchAndList,
  completeListing,
  rerunAutoListingMatch,
  rerunAutoListingContent,
  requestAutoListingNewSource,
  reconcileSubmittedJobs,
  recoverInterruptedJobs,
  backfillTimeoutStages,
  remediateFailedListingJobs,
} from "./autoListing.js";
import { runReverseWorkflow } from "./reverseWorkflow.js";
import { getFlowStatusSnapshot, autoHealFlow } from "./flowSupervisor.js";
import { serverAutoHealEnabled } from "./dailyDistributor.js";
import { getAiTaskCacheStats } from "./aiTaskRouter.js";
import { get1688OpenApiStatus } from "./open1688Config.js";
import { continueWorkflowNode, runControlledWorkflowChain } from "./workflowNodeExecutor.js";
import {
  acceptWorkflowPricingRisk,
  appendWorkflowEvent,
  applyPayloadDraftAttributeRepair,
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  pauseWorkflowRun,
  reconcileStaleWorkflowRuns,
  requestWorkflowPricingRecalculation,
  requestWorkflowNewSource,
  resumeWorkflowRun,
  confirmWorkflowContinue,
  retryWorkflowAfterManualFix,
  retryWorkflowNode,
  savePayloadDraft,
  submitPayloadDraftToOzon,
  upsertWorkflowNode,
  validatePayloadDraft,
} from "./workflowRuns.js";
import {
  appendListingEditEvent,
  listListingEditEvents,
  summarizeListingEditJournal,
} from "./listingEditJournal.js";
import {
  buildOzonImageStyleObservations,
  getOzonImageStyleObservations,
} from "./ozonImageStyleLearning.js";
import {
  analyzeOzonImageStyleQueue,
  getOzonImageStyleAnalysis,
} from "./ozonImageStyleAnalyzer.js";
import { generateOzonReferenceGuidance } from "./ozonReferenceGuidance.js";
import {
  getImageGenerationTask,
  imageGenerationConfig,
  submitGptImage2Generation,
} from "./ozonImageGeneration.js";




const app = express();
const port = Number(process.env.PORT || 5178);

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  next();
});
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(requestContextMiddleware);
app.use(express.static("public"));

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const parseBody = (body) => {
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body || {};
};

let latest1688Capture = null;

function summarizeProduct(item) {
  return {
    id: item.id,
    product_id: item.product_id,
    offer_id: item.offer_id,
    name: item.name,
    images: (item.images || []).map((i) => i.file_name || i),
    primary_image: item.primary_image || (item.images || [])[0]?.file_name || "",
    price: item.price,
    old_price: item.old_price || item.price,
    min_price: item.min_price || item.price,
    currency_code: item.currency_code || "RUB",
    status: item.status?.name || item.state_name || "",
    status_group: item.status_group || "",
    stocks: {
      fbs: (item.stocks?.fbs || {}).present || 0,
      fbo: (item.stocks?.fbo || {}).present || 0,
    },
    has_discount: (item.price && item.old_price && item.old_price > item.price) || false,
    commissions: item.commissions,
    category: item.category,
    created_at: item.created_at,
  };
}

function summarizeWarehouses(data) {
  const warehouses = Array.isArray(data?.warehouses) ? data.warehouses : (Array.isArray(data?.result) ? data.result : []);
  return warehouses.map((w) => ({
    warehouse_id: w.warehouse_id,
    name: w.name,
    is_rf: w.is_rf,
    is_rfbs: w.is_rfbs,
    status: w.status,
    warehouse_type: w.warehouse_type,
  }));
}

function hasLikelyEncodingCorruption(str) {
  if (!str) return false;
  return /[\uFFFD\uFFFE\uFFFF]/.test(str) || (str.includes("?") && str.split("?").length - 1 > str.length * 0.1);
}


app.get("/api/stores", asyncRoute(async (_req, res) => {
  const stores = loadStores().map(publicStore);
  res.json({ stores });
}));

app.get("/api/ai/status", (_req, res) => {
  res.json(llmConfig());
});

app.get("/api/ai/task-cache-stats", asyncRoute(async (_req, res) => {
  res.json(await getAiTaskCacheStats());
}));

app.post("/api/ai/listing-content", asyncRoute(async (req, res) => {
  res.json(await generateListingContentWithLlm(req.body.product || req.body));
}));

app.get("/api/pricing/shipping-levels", (_req, res) => {
  res.json({ levels: RMB_SHIPPING_LEVELS });
});

app.post("/api/pricing/calculate", asyncRoute(async (req, res) => {
  res.json(calculateOzonPrice(req.body));
}));

app.post("/api/1688/collect", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const url = String(body.url || "").trim();
  const html = String(body.html || "").trim() || (url ? await fetch1688Html(url) : "");
  const parsed = parse1688Product({ url, html, hints: body });
  if (body.includeVideo === false) parsed.video = null;
  const item = await addCollectionItem({ parsed, storeId: String(body.storeId || ""), includeVideo: body.includeVideo !== false });
  latest1688Capture = {
    id: item.id,
    receivedAt: item.receivedAt,
    parsed,
  };
  res.json({
    ...parsed,
    collectionId: item.id,
    duplicate: Boolean(item.duplicate),
    duplicateMessage: item.duplicateMessage || "",
  });
}));

app.post("/api/erp/next-parent-sku", asyncRoute(async (_req, res) => {
  res.json(await nextParentSku());
}));

app.post("/api/erp/reserve-parent-skus", asyncRoute(async (req, res) => {
  res.json(await reserveParentSkus(req.body?.count || 1));
}));

app.post("/api/1688/capture", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const url = String(body.url || "").trim();
  const html = String(body.html || "").trim();
  const parsed = parse1688Product({ url, html, hints: body });
  if (body.includeVideo === false) parsed.video = null;
  const item = await addCollectionItem({
    parsed,
    storeId: String(body.storeId || ""),
    includeVideo: body.includeVideo !== false,
  });
  latest1688Capture = {
    id: item.id,
    receivedAt: item.receivedAt,
    parsed,
  };
  res.json({
    ok: true,
    id: item.id,
    receivedAt: latest1688Capture.receivedAt,
    title: parsed.title,
    duplicate: Boolean(item.duplicate),
    duplicateMessage: item.duplicateMessage || "",
  });
}));

app.post("/api/pdd/capture", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const url = String(body.url || "").trim();
  const html = String(body.html || "").trim();
  const parsed = parsePddProduct({ url, html, hints: body });
  if (body.includeVideo === false) parsed.video = null;
  const item = await addCollectionItem({
    parsed,
    storeId: String(body.storeId || ""),
    includeVideo: body.includeVideo !== false,
  });
  latest1688Capture = {
    id: item.id,
    receivedAt: item.receivedAt,
    parsed,
  };
  res.json({
    ok: true,
    source: "pdd",
    id: item.id,
    receivedAt: latest1688Capture.receivedAt,
    title: parsed.title,
    goodsId: parsed.goodsId,
    duplicate: Boolean(item.duplicate),
    duplicateMessage: item.duplicateMessage || "",
  });
}));

app.get("/api/1688/capture/latest", (_req, res) => {
  if (!latest1688Capture) {
    res.status(404).json({ error: "还没有收到 1688 采集助手发送的页面。" });
    return;
  }
  res.json(latest1688Capture);
});

app.get("/api/1688/captures", asyncRoute(async (_req, res) => {
  res.json({ items: await listCollectionItems() });
}));

app.get("/api/1688/captures/:id", asyncRoute(async (req, res) => {
  const item = await getCollectionItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "没有找到采集箱商品。" });
    return;
  }
  res.json(item);
}));

app.get("/api/1688-open/status", asyncRoute(async (_req, res) => {
  res.json(get1688OpenApiStatus());
}));

app.patch("/api/1688/captures/:id", asyncRoute(async (req, res) => {
  const item = await updateCollectionItem(req.params.id, req.body || {});
  if (!item) {
    res.status(404).json({ error: "没有找到采集箱商品。" });
    return;
  }
  res.json(item);
}));

app.delete("/api/1688/captures/:id", asyncRoute(async (req, res) => {
  res.json({ ok: await deleteCollectionItem(req.params.id) });
}));

app.post("/api/1688/captures/:id/to-candidate", asyncRoute(async (req, res) => {
  const data = await moveCaptureToCrawlerCandidate(req.params.id);
  if (!data) {
    res.status(404).json({ error: "没有找到采集箱商品。" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.post("/api/1688-crawler/tasks", asyncRoute(async (req, res) => {
  const payload = parseBody(req.body);
  const data = await createCrawlerTask(payload);
  res.json({ ok: true, ...data });
}));

app.get("/api/1688-crawler/tasks", asyncRoute(async (_req, res) => {
  res.json({ items: await listCrawlerTasks() });
}));

app.get("/api/1688-crawler/tasks/:id", asyncRoute(async (req, res) => {
  const item = await getCrawlerTask(req.params.id);
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json(item);
}));

app.post("/api/1688-crawler/tasks/:id/pause", asyncRoute(async (req, res) => {
  const item = await updateCrawlerTaskStatus(req.params.id, "paused");
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json({ ok: true, item });
}));

app.post("/api/1688-crawler/tasks/:id/resume", asyncRoute(async (req, res) => {
  const item = await updateCrawlerTaskStatus(req.params.id, "running");
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json({ ok: true, item, requeuedJobs: item.requeuedJobs || 0 });
}));

app.post("/api/1688-crawler/tasks/:id/stop", asyncRoute(async (req, res) => {
  const item = await updateCrawlerTaskStatus(req.params.id, "stopped");
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json({ ok: true, item });
}));

app.delete("/api/1688-crawler/tasks/:id", asyncRoute(async (req, res) => {
  const item = await deleteCrawlerTask(req.params.id);
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json({ ok: true, item });
}));

app.get("/api/1688-crawler/candidates", asyncRoute(async (req, res) => {
  const items = await listCrawlerCandidates({
    taskId: req.query.taskId,
    status: req.query.status,
    query: req.query.query,
  });
  res.json({ items });
}));

app.patch("/api/1688-crawler/candidates/:id", asyncRoute(async (req, res) => {
  const item = await updateCrawlerCandidate(req.params.id, req.body || {});
  if (!item) {
    res.status(404).json({ error: "没有找到候选商品。" });
    return;
  }
  res.json({ ok: true, item });
}));

app.post("/api/1688-crawler/candidates/:id/to-capture", asyncRoute(async (req, res) => {
  const data = await moveCrawlerCandidateToCapture(req.params.id, req.body?.storeId || req.query.storeId || "");
  if (!data) {
    res.status(404).json({ error: "没有找到候选商品。" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.get("/api/1688-crawler/session/status", asyncRoute(async (_req, res) => {
  res.json(await getCrawlerSessionStatus());
}));

app.get("/api/1688-crawler/extension/status", asyncRoute(async (_req, res) => {
  res.json(await getCrawlerWorkerStatus());
}));

app.post("/api/1688-crawler/extension/heartbeat", asyncRoute(async (req, res) => {
  const worker = await recordCrawlerWorkerHeartbeat(req.body || {});
  res.json({ ok: true, worker });
}));

app.post("/api/1688-crawler/session/cookie", asyncRoute(async (req, res) => {
  const cookie = String(req.body?.cookie || req.body?.cookieString || "").trim();
  if (!cookie) {
    throw new Error("请提供 cookie 字符串。");
  }
  const data = await setCrawlerSessionCookie(cookie);
  res.json({ ok: true, updatedAt: data.updatedAt });
}));

app.delete("/api/1688-crawler/session/cookie", asyncRoute(async (_req, res) => {
  await clearCrawlerSessionCookie();
  res.json({ ok: true });
}));

app.get("/api/1688-crawler/extension/next", asyncRoute(async (req, res) => {
  const job = await claimCrawlerExtensionJob(String(req.query.workerId || ""));
  res.json({ job: job ? { ...job, kind: job.kind || job.type } : null });
}));

app.post("/api/1688-crawler/extension/discover-result", asyncRoute(async (req, res) => {
  const data = await completeCrawlerExtensionDiscover(req.body.jobId, req.body || {});
  if (!data) {
    res.status(404).json({ error: "没有找到采集作业。" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.post("/api/1688-crawler/extension/detail-result", asyncRoute(async (req, res) => {
  const data = await completeCrawlerExtensionDetail(req.body.jobId, { ...(req.body.payload || {}), ...req.body });
  if (!data) {
    res.status(404).json({ error: "没有找到采集作业。" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.post("/api/1688-crawler/expand-keywords", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const data = await expandKeywords(String(body.seeds || body.seed || "").split(",").map(s => s.trim()).filter(Boolean));
  res.json({ ok: true, ...data });
}));

app.post("/api/1688-crawler/create-expanded-tasks", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const data = await createExpandedTasks(String(body.seeds || body.seed || "").split(",").map(s => s.trim()).filter(Boolean), body.options || {});
  res.json({ ok: true, ...data });
}));

app.post("/api/1688-crawler/match-opportunities", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const candidates = await listCrawlerCandidates({ status: body.status || "" });
  const data = await matchCandidatesWithOpportunities(body.opportunities || [], candidates);
  res.json({ ok: true, ...data });
}));

app.post("/api/workflow/reverse-run", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const seeds = String(body.seeds || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!seeds.length) {
    res.status(400).json({ ok: false, error: "请先输入1688盲采种子词" });
    return;
  }
  const data = await runReverseWorkflow({
    seeds,
    minScore: Number(body.minScore || 60),
    maxCards: Number(body.maxCards || 20),
    taskOptions: {
      maxProducts: Number(body.maxProducts || 20),
      maxPages: Number(body.maxPages || 2),
      mustHaveSku: true,
      mustHaveSizeWeight: true,
    },
  });
  res.json(data);
}));

app.get("/api/workflows", asyncRoute(async (_req, res) => {
  res.json(await listWorkflowRuns());
}));

app.post("/api/workflows", asyncRoute(async (req, res) => {
  res.json(await createWorkflowRun(parseBody(req.body)));
}));

app.post("/api/workflows/reconcile-stale", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const thresholdHours = Math.min(720, Math.max(1, Number(body.thresholdHours || 2)));
  res.json(await reconcileStaleWorkflowRuns({ staleAfterMs: thresholdHours * 60 * 60 * 1000 }));
}));

app.get("/api/workflows/:id", asyncRoute(async (req, res) => {
  const run = await getWorkflowRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "工作流不存在" });
    return;
  }
  res.json(run);
}));

app.post("/api/workflows/:id/pause", asyncRoute(async (req, res) => {
  res.json(await pauseWorkflowRun(req.params.id));
}));

app.post("/api/workflows/:id/resume", asyncRoute(async (req, res) => {
  res.json(await resumeWorkflowRun(req.params.id));
}));

app.post("/api/workflows/:id/nodes/:key/retry", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  res.json(await retryWorkflowNode(req.params.id, req.params.key, body.input || body));
}));

app.post("/api/workflows/:id/nodes/:key/manual-fix-retry", asyncRoute(async (req, res) => {
  res.json(await retryWorkflowAfterManualFix(req.params.id, req.params.key, parseBody(req.body)));
}));

app.post("/api/workflows/:id/nodes/:key/continue", asyncRoute(async (req, res) => {
  res.json(await continueWorkflowNode(req.params.id, req.params.key, parseBody(req.body), {
    getWorkflowRun,
    updateCrawlerTaskStatus,
    validatePayloadDraft,
    rerunAutoListingMatch,
    rerunAutoListingContent,
    retryWorkflowAfterManualFix,
    appendWorkflowEvent,
  }));
}));

app.post("/api/workflows/:id/controlled-chain", asyncRoute(async (req, res) => {
  res.json(await runControlledWorkflowChain(req.params.id, parseBody(req.body), {
    getWorkflowRun,
    updateCrawlerTaskStatus,
    validatePayloadDraft,
    rerunAutoListingMatch,
    rerunAutoListingContent,
    retryWorkflowAfterManualFix,
    appendWorkflowEvent,
  }));
}));

app.post("/api/workflows/:id/nodes/:key/confirm-continue", asyncRoute(async (req, res) => {
  res.json(await confirmWorkflowContinue(req.params.id, req.params.key, parseBody(req.body)));
}));

app.post("/api/workflows/:id/nodes/:key/pricing-risk/accept", asyncRoute(async (req, res) => {
  res.json(await acceptWorkflowPricingRisk(req.params.id, req.params.key, parseBody(req.body)));
}));

app.post("/api/workflows/:id/nodes/:key/pricing-risk/recalculate", asyncRoute(async (req, res) => {
  res.json(await requestWorkflowPricingRecalculation(req.params.id, req.params.key, parseBody(req.body)));
}));

app.post("/api/workflows/:id/request-new-source", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const run = await getWorkflowRun(req.params.id);
  let result = null;
  if (run?.entity?.autoListingJobId) {
    result = await requestAutoListingNewSource(run.entity.autoListingJobId, body);
  }
  res.json(await requestWorkflowNewSource(req.params.id, {
    ...body,
    replacementCrawlerTaskIds: result?.crawlerTaskIds || body.replacementCrawlerTaskIds || [],
    replacement: result,
  }));
}));

app.put("/api/workflows/:id/payload-draft", asyncRoute(async (req, res) => {
  res.json(await savePayloadDraft(req.params.id, parseBody(req.body)));
}));

app.post("/api/workflows/:id/payload-draft/validate", asyncRoute(async (req, res) => {
  res.json(await validatePayloadDraft(req.params.id));
}));

app.post("/api/workflows/:id/payload-draft/attribute-repair", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  res.json(await applyPayloadDraftAttributeRepair(req.params.id, {
    ...body,
    confirmLocalDraftRepair: body.confirmLocalDraftRepair === true,
  }));
}));

app.post("/api/workflows/:id/payload-draft/submit", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const confirmSubmit = body.confirmSubmit === true;
  res.json(await submitPayloadDraftToOzon(req.params.id, { ...body, confirmSubmit }, {
    getStore,
    ozonRequest,
  }));
}));

// listingEditJournal records ERP/manual/Ozon Seller field changes for rule learning.
app.get("/api/listing-edit-journal/events", asyncRoute(async (req, res) => {
  res.json(await listListingEditEvents(req.query || {}));
}));

app.post("/api/listing-edit-journal/events", asyncRoute(async (req, res) => {
  res.json({ ok: true, event: await appendListingEditEvent(parseBody(req.body)) });
}));

app.get("/api/listing-edit-journal/summary", asyncRoute(async (_req, res) => {
  res.json(await summarizeListingEditJournal());
}));

app.post("/api/ozon-learning/tasks", asyncRoute(async (req, res) => {
  const data = await createOzonLearningTask(parseBody(req.body));
  res.json({ ok: true, ...data });
}));

app.post("/api/ozon-learning/blind-run", asyncRoute(async (req, res) => {
  const data = await createOzonBlindSearchRun(parseBody(req.body));
  res.json({ ok: true, ...data });
}));

app.get("/api/ozon-learning/tasks", asyncRoute(async (_req, res) => {
  res.json({ items: await listOzonLearningTasks() });
}));

app.delete("/api/ozon-learning/tasks/:id", asyncRoute(async (req, res) => {
  const task = await deleteOzonLearningTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: "没有找到 Ozon 学习任务。" });
    return;
  }
  res.json({ ok: true, task });
}));

app.get("/api/ozon-learning/items", asyncRoute(async (req, res) => {
  res.json({ items: await listOzonLearningItems({ taskId: req.query.taskId, query: req.query.query }) });
}));

app.get("/api/ozon-learning/opportunities", asyncRoute(async (req, res) => {
  res.json({ items: await listOzonOpportunities({ query: req.query.query, minScore: req.query.minScore }) });
}));

app.get("/api/ozon-learning/external-source/status", asyncRoute(async (_req, res) => {
  res.json(await getExternalOzonLearningStatus());
}));

app.post("/api/ozon-learning/external-source/sync", asyncRoute(async (req, res) => {
  res.json(await syncExternalOzonLearning({ force: req.body?.force === true }));
}));


app.post("/api/ozon-learning/analyze-rules", asyncRoute(async (_req, res) => {
  const data = await triggerRuleAnalysis();
  res.json(data);
}));

app.get("/api/ozon-learning/image-style-observations", asyncRoute(async (_req, res) => {
  res.json(await getOzonImageStyleObservations());
}));

app.post("/api/ozon-learning/image-style-observations/rebuild", asyncRoute(async (req, res) => {
  res.json(await buildOzonImageStyleObservations(req.body || {}));
}));

app.get("/api/ozon-learning/image-style-analysis", asyncRoute(async (_req, res) => {
  res.json(await getOzonImageStyleAnalysis());
}));

app.post("/api/ozon-learning/image-style-analysis/run", asyncRoute(async (req, res) => {
  res.json(await analyzeOzonImageStyleQueue(req.body || {}));
}));

app.post("/api/ozon-learning/reference-guidance", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  res.json(await generateOzonReferenceGuidance({
    product: body.product || body.candidate || {},
    references: body.references || body.ozonReferences || [],
  }));
}));

app.get("/api/image-generation/status", (_req, res) => {
  res.json(imageGenerationConfig());
});

app.post("/api/image-generation/gpt-image-2", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  res.json(await submitGptImage2Generation({
    prompt: body.prompt,
    imageUrls: body.imageUrls || body.image_urls || [],
    size: body.size,
    resolution: body.resolution,
    n: body.n,
    model: body.model,
  }));
}));

app.get("/api/image-generation/tasks/:taskId", asyncRoute(async (req, res) => {
  res.json(await getImageGenerationTask(req.params.taskId));
}));

app.get("/api/ozon-learning/rules-summary", asyncRoute(async (_req, res) => {
  const data = await getRuleSummary();
  res.json(data);
}));


app.get("/api/ozon-learning/rules-enhanced", asyncRoute(async (_req, res) => {
  const data = await getEnhancedRuleSummary();
  res.json(data);
}));
app.post("/api/ozon-learning/auto-list", asyncRoute(async (req, res) => {
  try {
    var data = await triggerAutoListing(req.body.itemId);
    res.json(Object.assign({ ok: true }, data));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

app.get("/api/ozon-learning/auto-list-jobs", asyncRoute(async (_req, res) => {
  res.json({ items: await listAutoListingJobs() });
}));

app.get("/api/ozon-learning/flow-status", asyncRoute(async (_req, res) => {
  res.json(await getFlowStatusSnapshot());
}));

app.get("/api/flow/status", asyncRoute(async (_req, res) => {
  res.json(await getFlowStatusSnapshot());
}));

app.post("/api/ozon-learning/flow-autofix", asyncRoute(async (req, res) => {
  res.json(await autoHealFlow(req.body || {}));
}));

app.get("/api/ozon-learning/auto-list-jobs/:id", asyncRoute(async (req, res) => {
  var job = await getAutoListingJob(req.params.id);
  if (!job) { res.status(404).json({ error: "未找到铺货记录" }); return; }
  res.json(job);
}));

app.post("/api/ozon-learning/reconcile-submitted", asyncRoute(async (req, res) => {
  const data = await reconcileSubmittedJobs({ limit: Number(req.body?.limit || 20) });
  res.json(data);
}));

app.post("/api/ozon-learning/backfill-timeout-stages", asyncRoute(async (req, res) => {
  const data = await backfillTimeoutStages(Number(req.body?.limit || 1000));
  res.json(data);
}));

app.post("/api/ozon-learning/remediate-failed-listings", asyncRoute(async (req, res) => {
  const data = await remediateFailedListingJobs({
    limit: Number(req.body?.limit || 5),
    autoResubmit: Boolean(req.body?.autoResubmit),
    reasonCodes: String(req.body?.reasonCodes || "CATEGORY_INVALID,WEIGHT_SIZE_INVALID,BRAND_INVALID,TITLE_INVALID,RICH_CONTENT_INVALID,COUNTRY_INVALID,ATTRIBUTE_DUPLICATE"),
  });
  res.json(data);
}));

app.post("/api/ozon-learning/test-match-and-list", asyncRoute(async (req, res) => {
  try {
    var data = await testMatchAndList(req.body.opportunityId, req.body.candidateId);
    res.json(Object.assign({ ok: true }, data));
  } catch (e) {
    res.status(400).json({ error: e.message, stack: e.stack?.split("\n").slice(0,5).join("\n") });
  }
}));

app.post("/api/ozon-learning/complete-listing", asyncRoute(async (req, res) => {
  try {
    if (!req.body.jobId) { res.status(400).json({ error: "缺少 jobId" }); return; }
    if (!req.body.storeId) { res.status(400).json({ error: "缺少 storeId" }); return; }
    var data = await completeListing(req.body.jobId, req.body.storeId);
    const status = data?.taskId ? "submitted" : (data?.status || "processing");
    res.json(Object.assign({ ok: true, status }, data));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

app.post("/api/ozon-learning/analyze-opportunities", asyncRoute(async (req, res) => {
  const data = await analyzeOzonOpportunities(req.body || {});
  res.json(data);
}));

app.post("/api/ozon-learning/reverse-1688", asyncRoute(async (req, res) => {
  const data = await reverseSearch1688(req.body.itemId);
  res.json({ ok: true, ...data });
}));


app.get("/1688-collector-extension.zip", asyncRoute(async (_req, res) => {
  const zipFile = path.join(process.cwd(), "browser-extension", "erp-collector-extension.zip");
  res.download(zipFile, "ozon-erp-collector-extension.zip");
}));

app.get("/ozon-collector-extension.zip", asyncRoute(async (_req, res) => {
  const zipFile = path.join(process.cwd(), "browser-extension", "erp-collector-extension.zip");
  res.download(zipFile, "ozon-erp-collector-extension.zip");
}));


// Ozon 学习扩展心跳
const ozonWorkers = new Map();

app.post("/api/ozon-learning/extension/heartbeat", asyncRoute(async (req, res) => {
  const wid = String(req.body.workerId || "");
  if (wid) {
    ozonWorkers.set(wid, {
      workerId: wid,
      status: String(req.body.status || "unknown"),
      message: String(req.body.message || ""),
      currentJobId: String(req.body.currentJobId || ""),
      lastCheckAt: new Date().toISOString(),
      online: true,
    });
  }
  res.json({ ok: true });
}));

app.get("/api/ozon-learning/extension/status", asyncRoute(async (_req, res) => {
  const now = Date.now();
  const online = Array.from(ozonWorkers.values()).filter(function(w) { return now - new Date(w.lastCheckAt).getTime() < 120000; });
  res.json({ online: online.length > 0, workers: online, total: ozonWorkers.size });
}));

app.get("/api/ozon-learning/extension/next", asyncRoute(async (req, res) => {
  const job = await claimOzonLearningJob(String(req.query.workerId || ""));
    res.json({ job: job ? { ...job, kind: job.kind || job.type } : null });
}));

app.post("/api/ozon-learning/extension/search-result", asyncRoute(async (req, res) => {
  const data = await completeOzonSearchJob(req.body.jobId, req.body || {});
  if (!data) {
    res.status(404).json({ error: "没有找到 Ozon 学习作业。" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.post("/api/ozon-learning/extension/detail-result", asyncRoute(async (req, res) => {
  const data = await completeOzonDetailJob(req.body.jobId, req.body || {});
  if (!data) {
    res.status(404).json({ error: "没有找到 Ozon 学习作业。" });
    return;
  }
  res.json({ ok: true, ...data });
}));


app.post("/api/pipeline/run", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const result = await runFullPipeline({
    minScore: Number(body.minScore) || 30,
    maxTasks: Number(body.maxTasks) || 5,
    autoList: Boolean(body.autoList),
  });
  res.json(result);
}));


app.post("/api/pipeline/status", asyncRoute(async (_req, res) => {
  const fs2 = await import("node:fs/promises");
  const path2 = await import("node:path");
  const file = path2.resolve("data", "pipeline-status.json");
  try { await fs2.writeFile(file, JSON.stringify({ status: "idle", steps: [], startedAt: null, completedAt: null, error: null })); } catch(e) {}
  res.json({ ok: true, status: "idle" });
}));

app.get("/api/pipeline/status", asyncRoute(async (_req, res) => {
  res.json(await getPipelineStatus());
}));

app.post("/api/pipeline/check-trigger", asyncRoute(async (_req, res) => {
  res.json(await checkAndTriggerPipeline());
}));

app.post("/api/ozon/test", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v2/warehouse/list", {});
  res.json({
    ok: true,
    store: publicStore(store),
    warehouses: summarizeWarehouses(data),
  });
}));

app.get("/api/ozon/warehouses", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const data = await ozonRequest(store, "/v2/warehouse/list", {});
  res.json({ warehouses: summarizeWarehouses(data) });
}));

app.get("/api/ozon/description-categories", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const refresh = String(req.query.refresh || "") === "1";
  const cache = await loadCategoryCache();
  if (!refresh && cache.tree?.length) {
    res.json({ result: cache.tree, cached: true, updatedAt: cache.updatedAt, total: cache.flat?.length || 0 });
    return;
  }
  const data = await ozonRequest(store, "/v1/description-category/tree", { language: "ZH_HANS" });
  const tree = data.result || [];
  await saveCategoryCache({
    ...cache,
    updatedAt: new Date().toISOString(),
    storeId: store.id,
    tree,
    flat: flattenCategories(tree),
  });
  res.json(data);
}));

app.post("/api/ozon/description-attributes", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const descriptionCategoryId = Number(req.body.description_category_id);
  const typeId = Number(req.body.type_id);
  const cacheKey = `${descriptionCategoryId}:${typeId}`;
  const refresh = Boolean(req.body.refresh);
  const cache = await loadCategoryCache();
  if (!refresh && cache.attributes?.[cacheKey]) {
    res.json({ result: cache.attributes[cacheKey], cached: true, updatedAt: cache.updatedAt });
    return;
  }
  const data = await ozonRequest(store, "/v1/description-category/attribute", {
    description_category_id: descriptionCategoryId,
    type_id: typeId,
    language: "ZH_HANS",
  });
  await saveCategoryCache({
    ...cache,
    attributes: {
      ...(cache.attributes || {}),
      [cacheKey]: data.result || [],
    },
  });
  res.json(data);
}));

app.post("/api/ozon/category-cache/refresh", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v1/description-category/tree", { language: "ZH_HANS" });
  const tree = data.result || [];
  const flat = flattenCategories(tree);
  const cache = await loadCategoryCache();
  await saveCategoryCache({
    ...cache,
    updatedAt: new Date().toISOString(),
    storeId: store.id,
    tree,
    flat,
  });
  res.json({ ok: true, total: flat.length, updatedAt: new Date().toISOString() });
}));

app.post("/api/ozon/category-match", asyncRoute(async (req, res) => {
  const cache = await loadCategoryCache();
  const flat = cache.flat || flattenCategories(cache.tree || []);
  const matches = matchCategory(req.body.product || req.body, flat, Number(req.body.limit || 8));
  res.json({ matches, cached: Boolean(cache.tree?.length), total: flat.length, updatedAt: cache.updatedAt });
}));

app.post("/api/images/prepare-ozon", asyncRoute(async (req, res) => {
  const urls = Array.isArray(req.body.urls) ? req.body.urls : [];
  res.json(await prepareOzonImages(urls, {
    ocr: Boolean(req.body.ocr),
    blockChinese: req.body.blockChinese !== false,
    translateChinese: Boolean(req.body.translateChinese),
  }));
}));

app.post("/api/ozon/description-attribute-values", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const descriptionCategoryId = Number(req.body.description_category_id);
  const typeId = Number(req.body.type_id);
  const attributeId = Number(req.body.attribute_id);
  const language = String(req.body.language || "ZH_HANS");
  const refresh = Boolean(req.body.refresh);
  const cacheKey = attributeValueCacheKey({
    descriptionCategoryId,
    typeId,
    attributeId,
    language,
  });
  const cache = await loadCategoryCache();
  if (!refresh && cache.attributeValues?.[cacheKey]?.values) {
    res.json({
      result: cache.attributeValues[cacheKey].values,
      cached: true,
      updatedAt: cache.attributeValues[cacheKey].updatedAt,
      cacheKey,
    });
    return;
  }
  const data = await ozonRequest(store, "/v1/description-category/attribute/values", {
    attribute_id: attributeId,
    description_category_id: descriptionCategoryId,
    type_id: typeId,
    language,
    limit: Number(req.body.limit || 100),
    last_value_id: Number(req.body.last_value_id || 0),
  });
  await upsertAttributeValuesCache({
    storeId: store.id,
    descriptionCategoryId,
    typeId,
    attributeId,
    language,
    values: data.result || [],
  });
  res.json(data);
}));

app.get("/api/ozon/orders", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const dates = defaultFbsDateRange();
  const filter = {
    since: String(req.query.since || dates.since),
    to: String(req.query.to || dates.to),
  };

  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.warehouseId) filter.warehouse_id = Number(req.query.warehouseId);

  const data = await ozonRequest(store, "/v3/posting/fbs/list", {
    dir: "DESC",
    filter,
    limit: Number(req.query.limit || 50),
    offset: Number(req.query.offset || 0),
    with: {
      analytics_data: true,
      barcodes: true,
      financial_data: true,
      translit: true,
    },
  });

  res.json(data);
}));

app.get("/api/ozon/order-dashboard", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const dates = defaultFbsDateRange();
  const filter = {
    since: String(req.query.since || dates.since),
    to: String(req.query.to || dates.to),
  };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.warehouseId) filter.warehouse_id = Number(req.query.warehouseId);

  const data = await ozonRequest(store, "/v3/posting/fbs/list", {
    dir: "DESC",
    filter,
    limit: Number(req.query.limit || 100),
    offset: Number(req.query.offset || 0),
    with: {
      analytics_data: true,
      barcodes: true,
      financial_data: true,
      translit: true,
    },
  });
  const postings = data.result?.postings || [];
  const offerIds = [...new Set(postings.flatMap((posting) => (posting.products || []).map((product) => product.offer_id)).filter(Boolean))];
  let productMap = new Map();
  if (offerIds.length) {
    const detail = await ozonRequest(store, "/v3/product/info/list", { offer_id: offerIds.slice(0, 100) });
    productMap = new Map((detail.items || []).flatMap((item) => [
      [String(item.offer_id), summarizeProduct(item)],
      [String(item.sku), summarizeProduct(item)],
    ]));
  }
  let orders = postings.map((posting) => summarizeOrder(posting, productMap));
  const query = String(req.query.query || "").trim().toLowerCase();
  if (query) {
    orders = orders.filter((order) =>
      [
        order.posting_number,
        order.order_number,
        order.tracking_number,
        order.warehouse,
        ...order.products.flatMap((product) => [product.name, product.offer_id, product.sku]),
      ].join(" ").toLowerCase().includes(query)
    );
  }
  const counts = {
    awaiting_packaging: orders.filter((order) => order.status === "awaiting_packaging").length,
    awaiting_deliver: orders.filter((order) => order.status === "awaiting_deliver").length,
    delivering: orders.filter((order) => order.status === "delivering").length,
    dispute: orders.filter((order) => order.substatus?.includes("dispute")).length,
    delivered: orders.filter((order) => order.status === "delivered").length,
    cancelled: orders.filter((order) => order.status === "cancelled").length,
    all: orders.length,
  };
  res.json({
    orders,
    counts,
    has_next: Boolean(data.result?.has_next),
  });
}));

app.get("/api/ozon/products", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const data = await ozonRequest(store, "/v3/product/list", {
    filter: {
      visibility: String(req.query.visibility || "ALL"),
    },
    limit: Number(req.query.limit || 100),
    last_id: String(req.query.lastId || ""),
  });
  res.json(data);
}));

app.get("/api/ozon/product-dashboard", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const limit = Math.min(Number(req.query.limit || 100), 100);
  const listData = await ozonRequest(store, "/v3/product/list", {
    filter: {
      visibility: String(req.query.visibility || "ALL"),
    },
    limit,
    last_id: String(req.query.lastId || ""),
  });
  const listItems = listData.result?.items || [];
  const productIds = listItems.map((item) => item.product_id).filter(Boolean);
  const detailData = productIds.length
    ? await ozonRequest(store, "/v3/product/info/list", { product_id: productIds })
    : { items: [] };
  let products = (detailData.items || []).map(summarizeProduct);
  const query = String(req.query.query || "").trim().toLowerCase();
  if (query) {
    products = products.filter((item) =>
      [item.name, item.offer_id, item.sku, item.product_id]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }
  const counts = {
    all: listData.result?.total || products.length,
    selling: products.filter((item) => item.status_group === "selling").length,
    ready: products.filter((item) => item.status_group === "ready").length,
    error: products.filter((item) => item.status_group === "error").length,
    needFix: products.filter((item) => item.status_group === "needFix").length,
    delisted: products.filter((item) => item.status_group === "delisted").length,
    archived: products.filter((item) => item.status_group === "archived").length,
  };
  res.json({
    products,
    counts,
    total: listData.result?.total || products.length,
    last_id: listData.result?.last_id || "",
  });
}));

app.get("/api/ozon/product-prices", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const filter = {
    visibility: String(req.query.visibility || "ALL"),
  };
  const data = await ozonRequest(store, "/v4/product/info/prices", {
    filter,
    limit: Number(req.query.limit || 100),
    last_id: req.query.last_id || "",
  });
  res.json(data);
}));

app.get("/api/ozon/unfulfilled", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const data = await ozonRequest(store, "/v3/posting/fbs/unfulfilled/list", {
    dir: "ASC",
    filter: {},
    limit: Number(req.query.limit || 50),
    offset: Number(req.query.offset || 0),
    with: {
      analytics_data: true,
      barcodes: true,
      financial_data: true,
      translit: true,
    },
  });

  res.json(data);
}));

app.post("/api/ozon/warehouse-stocks", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const stocks = Array.isArray(req.body.stocks) ? req.body.stocks : [];
  const data = await ozonRequest(store, "/v2/products/stocks", { stocks });
  res.json(data);
}));

app.post("/api/ozon/prices", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const prices = Array.isArray(req.body.prices) ? req.body.prices : [];
  const data = await ozonRequest(store, "/v1/product/import/prices", { prices });
  res.json(data);
}));

app.get("/api/ozon/actions", asyncRoute(async (req, res) => {
  const store = getStore(String(req.query.storeId || ""));
  const data = await ozonGetRequest(store, "/v1/actions");
  res.json(data);
}));

app.post("/api/ozon/actions/products", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const actionId = Number(req.body.action_id || req.body.actionId);
  if (!actionId) throw new Error("请提供 action_id");
  const data = await ozonRequest(store, "/v1/actions/products", {
    action_id: actionId,
    limit: Number(req.body.limit || 1000),
    offset: Number(req.body.offset || 0),
  });
  res.json(data);
}));

app.post("/api/ozon/actions/candidates", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const actionId = Number(req.body.action_id || req.body.actionId);
  if (!actionId) throw new Error("请提供 action_id");
  const data = await ozonRequest(store, "/v1/actions/candidates", {
    action_id: actionId,
    limit: Number(req.body.limit || 1000),
    offset: Number(req.body.offset || 0),
  });
  res.json(data);
}));

app.post("/api/ozon/actions/products/deactivate", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const actionId = Number(req.body.action_id || req.body.actionId);
  const productIds = (req.body.product_ids || req.body.productIds || [])
    .flat()
    .map((id) => Number(id))
    .filter(Boolean);
  if (!actionId) throw new Error("请提供 action_id");
  if (!productIds.length) throw new Error("这个活动当前没有可删除的活动商品");
  const data = await ozonRequest(store, "/v1/actions/products/deactivate", {
    action_id: actionId,
    product_ids: productIds,
  });
  res.json(data);
}));

app.post("/api/ozon/product-import", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const badItem = items.find((item) => hasLikelyEncodingCorruption(item?.name || ""));
  if (badItem) {
    throw new Error(`检测到商品标题疑似乱码（offer_id: ${badItem.offer_id || "-"}）。请仅通过 ERP 页面提交，避免 PowerShell/脚本编码导致的 ????。`);
  }
  const data = await ozonRequest(store, "/v3/product/import", { items });
  res.json(data);
}));

app.post("/api/ozon/product-import-info", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v1/product/import/info", {
    task_id: Number(req.body.task_id),
  });
  res.json(data);
}));

app.get("/api/ozon/stock-queue", asyncRoute(async (_req, res) => {
  res.json({ jobs: await listStockJobs() });
}));

app.post("/api/ozon/stock-queue", asyncRoute(async (req, res) => {
  const job = await enqueueStockJob({
    storeId: req.body.storeId,
    taskId: req.body.taskId || req.body.task_id,
    stocks: req.body.stocks || [],
    delayMs: req.body.delayMs,
  });
  res.json({ ok: true, job });
}));

app.post("/api/ozon/stock-queue/replay-failed", asyncRoute(async (req, res) => {
  const data = await replayFailedStockJobs({
    limit: Number(req.body?.limit || 10),
    cooldownMs: Number(req.body?.cooldownMs || 3 * 60 * 1000),
  });
  res.json(data);
}));

app.post("/api/ozon/barcodes/generate", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const productIds = (req.body.product_ids || req.body.product_id || [])
    .flat()
    .map((id) => Number(id))
    .filter(Boolean)
    .slice(0, 100);
  if (!productIds.length) {
    throw new Error("请提供 product_ids");
  }
  const data = await ozonRequest(store, "/v1/barcode/generate", {
    product_ids: productIds,
  });
  res.json(data);
}));

app.post("/api/ozon/product-pictures-import", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v1/product/pictures/import", req.body.payload || {});
  res.json(data);
}));

app.post("/api/ozon/product-stocks", asyncRoute(async (req, res) => {
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v4/product/info/stocks", {
    filter: req.body.filter || {},
    limit: Number(req.body.limit || 100),
    last_id: req.body.last_id || "",
  });
  res.json(data);
}));




// ====== 1688 Batch Selection Routes ======
app.post("/api/1688-crawler/expand-keywords", asyncRoute(async (req, res) => {
  try {
    var result = await expandKeywords(req.body.seeds || [], req.body.options || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}));

app.post("/api/1688-crawler/create-expanded-tasks", asyncRoute(async (req, res) => {
  try {
    var result = await createExpandedTasks(req.body.seeds || [], req.body.options || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}));

app.post("/api/1688-crawler/match-candidates", asyncRoute(async (req, res) => {
  try {
    var { listOzonLearningItems } = await import("./ozonLearning.js");
    var opps = await listOzonLearningItems(req.body.filter || {});
    var cands = req.body.candidates || [];
    var result = await matchCandidatesWithOpportunities(opps, cands, req.body.options || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}));

app.use(finalizeRequest);
app.use(errorHandler);

app.listen(port, async () => {
  await initServerObservability();
  await restoreStockQueue();
  await recoverInterruptedJobs();
  startExternalOzonLearningMonitor();
  setInterval(() => {
    reconcileSubmittedJobs({ limit: 20 }).catch(() => {});
  }, 2 * 60 * 1000);
  if (serverAutoHealEnabled()) {
    autoHealFlow({
      reconcileLimit: 20,
      blindBatchSize: 1,
      autoResubmit: true,
      remediateLimit: 2,
      stockReplayLimit: 0,
      retryMatchLimit: 2,
      retryTimeoutLimit: 2,
      retryTimeoutBatch: 2,
      retryTimeoutCooldownMs: 0,
      diversifiedSeedCount: 1,
    }).catch(() => {});
    setInterval(() => {
      autoHealFlow({
        reconcileLimit: 20,
        blindBatchSize: 2,
        maxProducts: 12,
        detailSampleSize: 3,
        autoResubmit: true,
        remediateLimit: 3,
        stockReplayLimit: 5,
        retryMatchLimit: 2,
        retryTimeoutLimit: 2,
        retryTimeoutBatch: 2,
        retryTimeoutCooldownMs: 8 * 60 * 1000,
        diversifiedSeedCount: 3,
      }).catch(() => {});
    }, 5 * 60 * 1000);
  }
  console.log(`Ozon FBS ERP running at http://localhost:${port}`);
});
