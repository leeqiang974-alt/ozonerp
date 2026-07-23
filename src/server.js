import cors from "cors";
import express from "express";
import path from "node:path";
import { createHash } from "node:crypto";
import { WriteCommandRepository } from "./writeCommandRepository.js";
import { gatherStockReconciliationEvidence, readBoundedPages } from "./stockReconciliationEvidence.js";
import { StockEvidenceReceiptRepository, evaluateStockRealReadVerification } from "./stockEvidenceReceipt.js";
import { buildFbsOrderReadModel, filterFbsOrderReadModel, readFbsProductDetailsInBatches } from "./fbsOrderReadModel.js";
import { FbsEvidenceReceiptRepository, buildFbsReceiptSellerView } from "./fbsEvidenceReceipt.js";
import { defaultFbsDateRange, ozonGetRequest, ozonRequest } from "./ozon.js";
import { DEFAULT_API_FILE, getStore, loadStores, publicStore } from "./config.js";
import { calculateOzonPrice, RMB_SHIPPING_LEVELS } from "./pricing.js";
import { buildActivityReadSellerResult, buildPromotionImpactPreview } from "./activityReadModel.js";
import { buildFinanceDomainReadModel } from "./financeReadModel.js";
import { fetch1688Html, normalizeManualCapturePayload, parse1688Product } from "./collector1688.js";
import { isAllowedCorsOrigin } from "./corsPolicy.js";
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
  inspectCategoryCacheFreshness,
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
import {
  dryRunStockJobReconciliation,
  reconcileDryRunStockJob,
  reconcileStockTargetsReadback,
  enqueueStockJob,
  listStockJobs,
  restoreStockQueue,
  replayFailedStockJobs,
  summarizeStockQueueOperations,
  stockDryRunSellerView,
  stockJobWarehouseRecommendation,
  validateStockDryRunInput,
} from "./stockQueue.js";
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
  buildObservabilitySummary,
  requestContextMiddleware,
} from "./observability.js";

import {
  triggerAutoListing,
  createListingDraftFrom1688Candidate,
  createListingWorkflowFrom1688Capture,
  saveManualListingContent,
  saveManualListingCategory,
  saveManualProcurementEvidence,
  saveManualPackageEvidence,
  listAutoListingJobs,
  getAutoListingJob,
  getAutoListingJobSnapshot,
  inspectAutoListingProductReadiness,
  saveAutoListingMediaApprovalDraft,
  publishAutoListingMediaApproval,
  rollbackAutoListingMediaApproval,
  testMatchAndList,
  completeListing,
  rerunAutoListingMatch,
  rerunAutoListingContent,
  requestAutoListingNewSource,
  reconcileSubmittedJobs,
  buildSubmittedReconciliationSellerResult,
  recoverInterruptedJobs,
  backfillTimeoutStages,
  remediateFailedListingJobs,
} from "./autoListing.js";
import { runReverseWorkflow } from "./reverseWorkflow.js";
import { getFlowStatusSnapshot, autoHealFlow } from "./flowSupervisor.js";
import { serverAutoHealEnabled } from "./dailyDistributor.js";
import { getAiTaskCacheStats } from "./aiTaskRouter.js";
import { authTransportDecision, buildAuthSessionToken, buildRuntimeSafetySnapshot, listingSubmitRoleDecision, parseStoreScope, privilegedWriteDecision, productionDeploymentDecision, requestAuthDecision, runtimeStartupDecision, storeAccessDecision } from "./runtimeSafety.js";
import { buildMigrationStateAudit } from "./migrationStateAudit.js";
import { buildProductionMigrationContract } from "./migrationProductionContract.js";
import { buildCoreMigrationDryRun } from "./migrationCheck.js";
import { runCoreMigrationRecoveryDrill } from "./migrationRecoveryRunner.js";
import { buildDiskSpaceCheck } from "./diskSpaceCheck.js";
import { buildApiEvidenceSummary } from "./apiEvidence.js";
import { buildOperationEvidenceRecord } from "./apiEvidence.js";
import { buildProductReadEvidence } from "./productReadModel.js";
import { buildReadEndpointRequest, extractBoundedProductIdentifiers, orderReadEndpoints } from "./readEndpointRequest.js";
import { reconcilePriceWriteReadback, validatePriceWritePreflight } from "./priceWriteGate.js";
import {
  buildCategoryReadPlanBinding,
  buildCategoryReadPlanSummary,
  buildCategoryReadRequests,
  classifyCategoryValuesResponse,
  validateCategoryReadPlan,
  validateCategoryReadPlanBinding,
} from "./categoryReadPlan.js";
import { get1688OpenApiStatus } from "./open1688Config.js";
import { continueWorkflowNode, runControlledWorkflowChain } from "./workflowNodeExecutor.js";
import {
  acceptWorkflowPricingRisk,
  appendWorkflowEvent,
  applyPayloadDraftAttributeRepair,
  approveWorkflowMediaCandidates,
  publishWorkflowMediaApproval,
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  pauseWorkflowRun,
  requestWorkflowMediaReview,
  reconcileStaleWorkflowRuns,
  requestWorkflowPricingRecalculation,
  requestWorkflowNewSource,
  resumeWorkflowRun,
  confirmWorkflowContinue,
  retryWorkflowAfterManualFix,
  retryWorkflowNode,
  savePayloadDraft,
  submitPayloadDraftToOzon,
  reconcileWorkflowTaskReadback,
  upsertWorkflowNode,
  validatePayloadDraft,
} from "./workflowRuns.js";
import {
  appendListingEditEvent,
  listListingEditEvents,
  summarizeListingEditJournal,
} from "./listingEditJournal.js";
import {
  appendRuleApprovalAuditIntent,
  listRuleApprovalAuditIntents,
  summarizeRuleApprovalAuditIntents,
} from "./ruleApprovalAudit.js";
import {
  appendRulePublishReviewIntent,
  listRulePublishReviewIntents,
  summarizeRulePublishReviewIntents,
} from "./rulePublishReview.js";
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
import {
  ReadinessEvidenceReceiptRepository,
  evaluateRealReadVerification,
} from "./readinessEvidenceReceipt.js";
import { buildReadOperatorPlanSummary } from "./readVerificationOperator.js";
import { buildReadOperatorPlanMatrixSummary } from "./readVerificationOperator.js";
import {
  buildReadFailureSellerTask,
  buildReadOperatorReport,
  buildReadOperatorPlanBinding,
  validateReadOperatorPlan,
  validateReadOperatorPlanBinding,
} from "./readVerificationOperator.js";
import { LIVE_CONFIRMATION, runReadVerification, scopeHash } from "./readVerificationHarness.js";
import { ReadOperatorReceiptRepository } from "./readOperatorReceipt.js";




const app = express();
const port = Number(process.env.PORT || 5178);
const host = String(process.env.HOST || "127.0.0.1").trim();
const trustProxy = String(process.env.OZON_ERP_TRUST_PROXY || process.env.TRUST_PROXY || "") === "1";
if (trustProxy) app.set("trust proxy", 1);
const directWriteCommands = new WriteCommandRepository({
  file: process.env.WRITE_COMMANDS_FILE || path.resolve("data", "write-commands.json"),
});
const readinessEvidenceReceipts = new ReadinessEvidenceReceiptRepository({
  file: process.env.READINESS_EVIDENCE_RECEIPTS_FILE || path.resolve("data", "readiness-evidence-receipts.json"),
});
const readOperatorReceipts = new ReadOperatorReceiptRepository({
  file: process.env.READ_OPERATOR_RECEIPTS_FILE || path.resolve("data/read-operator-receipts.json"),
});
const READINESS_RECEIPT_MAX_AGE_MS = Math.max(60 * 1000, Number(process.env.OZON_READINESS_RECEIPT_MAX_AGE_MS || 24 * 60 * 60 * 1000));
const STOCK_RECEIPT_MAX_AGE_MS = Math.max(60 * 1000, Number(process.env.OZON_STOCK_RECEIPT_MAX_AGE_MS || 24 * 60 * 60 * 1000));

function readinessReceiptMaxAgeMs(value = "") {
  const requested = Number(value || READINESS_RECEIPT_MAX_AGE_MS);
  return Math.min(7 * 24 * 60 * 60 * 1000, Math.max(60 * 1000, Number.isFinite(requested) ? requested : READINESS_RECEIPT_MAX_AGE_MS));
}

function stockReceiptMaxAgeMs(value = "") {
  const requested = Number(value || STOCK_RECEIPT_MAX_AGE_MS);
  return Math.min(7 * 24 * 60 * 60 * 1000, Math.max(60 * 1000, Number.isFinite(requested) ? requested : STOCK_RECEIPT_MAX_AGE_MS));
}
const stockEvidenceReceipts = new StockEvidenceReceiptRepository({
  file: process.env.STOCK_EVIDENCE_RECEIPTS_FILE || path.resolve("data", "stock-evidence-receipts.json"),
});
const fbsEvidenceReceipts = new FbsEvidenceReceiptRepository({
  file: process.env.FBS_EVIDENCE_RECEIPTS_FILE || path.resolve("data", "fbs-evidence-receipts.json"),
});

function buildCorsOptions({ portNumber = port, hostName = host, configuredOrigins = process.env.CORS_ALLOWED_ORIGINS || "" } = {}) {
  const allowedOrigins = new Set([
    `http://localhost:${portNumber}`,
    `http://127.0.0.1:${portNumber}`,
    ...String(configuredOrigins).split(",").map((value) => value.trim()).filter(Boolean),
  ]);
  return {
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // The listing/operations UI sends the signed-read environment claim in a
    // dedicated header.  Keep it explicit so a separately hosted frontend can
    // pass the browser preflight before the server validates the session.
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Ozon-ERP-Admin", "X-Ozon-ERP-Read-Environment"],
    origin(origin, callback) {
      if (isAllowedCorsOrigin({ origin, host: hostName, allowedOrigins })) return callback(null, true);
      const error = new Error(`CORS origin denied: ${origin}`);
      error.status = 403;
      error.code = "CORS_ORIGIN_DENIED";
      return callback(error);
    },
  };
}

const corsOptions = buildCorsOptions();
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(requestContextMiddleware);
app.use(express.static("public"));
app.use((req, res, next) => {
  if (!String(req.path || "").startsWith("/api/")) return next();
  // Health probes must be able to reach the process before an ERP session
  // exists.  This endpoint is deliberately liveness-only and contains no
  // store, credential, or business readiness information.
  if (req.path === "/api/auth/session" || req.path === "/api/healthz") return next();
  const transport = authTransportDecision({
    host,
    secure: req.secure,
    forwardedProto: req.get("x-forwarded-proto"),
    trustProxy,
  });
  if (!transport.allowed) {
    res.status(426).json({
      ok: false,
      reasonCode: "AUTH_HTTPS_REQUIRED",
      message: "外部 ERP API 必须通过 HTTPS 访问。",
    });
    return;
  }
  const cookies = Object.fromEntries(String(req.get("cookie") || "").split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2));
  const decision = requestAuthDecision({
    env: process.env,
    host,
    authorization: req.get("authorization"),
    providedSecret: req.get("x-ozon-erp-auth"),
    sessionToken: cookies.ozon_erp_session,
  });
  if (decision.allowed) {
    req.authPrincipal = decision.principal || null;
    req.authSource = decision.authSource || "";
    return next();
  }
  res.status(decision.reasonCode === "AUTH_NOT_CONFIGURED" ? 503 : 401).json({
    ok: false,
    reasonCode: decision.reasonCode || "LISTING_SUBMIT_ROLE_REQUIRED",
    message: decision.reasonCode === "AUTH_NOT_CONFIGURED" ? "服务端认证未配置。" : "需要有效的 ERP 认证。",
  });
});

// Seller API reads require a server-verified signed ERP session.  Loopback and
// static bootstrap secrets may establish that session, but cannot themselves
// authorize a Seller API read.  Keep the environment claim bound to the same
// request so a receipt from one environment cannot be replayed in another.
function controlledReadSessionBlock(req, environment = "") {
  const authSource = String(req.authSource || "");
  if (!["session_cookie", "session_bearer"].includes(authSource)) {
    return { allowed: false, reasonCode: "READ_OPERATOR_SESSION_REQUIRED", message: "本地回环或静态认证密钥只能用于建立会话，不能直接执行 Seller API 读取。" };
  }
  const requestedEnvironment = String(environment || "").trim();
  if (requestedEnvironment.length < 3) {
    return { allowed: false, reasonCode: "READ_OPERATOR_ENVIRONMENT_REQUIRED", message: "必须提供有效的读取环境标识。" };
  }
  const sessionEnvironment = String(req.authPrincipal?.environment || req.authPrincipal?.sessionEnvironment || "").trim();
  if (!sessionEnvironment) {
    return { allowed: false, reasonCode: "READ_OPERATOR_SESSION_ENVIRONMENT_REQUIRED", message: "signed ERP session 未绑定读取环境，不能执行 Seller API 读取；请用明确环境重新建立会话。" };
  }
  if (sessionEnvironment !== requestedEnvironment) {
    return { allowed: false, reasonCode: "READ_OPERATOR_ENVIRONMENT_SCOPE_DENIED", message: "当前会话环境与读取计划不一致，请重新建立同一环境的 ERP 会话。" };
  }
  return { allowed: true, sessionEnvironment: sessionEnvironment || requestedEnvironment };
}

function requestReadEnvironment(req, body = {}) {
  return String(body?.environment || req.query?.environment || req.get("x-ozon-erp-read-environment") || "").trim();
}

function requireControlledSellerRead(req, res, body = {}) {
  const environment = requestReadEnvironment(req, body);
  const sessionGate = controlledReadSessionBlock(req, environment);
  if (!sessionGate.allowed) {
    res.status(403).json({
      ok: false,
      reasonCode: sessionGate.reasonCode,
      message: sessionGate.message,
      sideEffect: "仅校验受控 Seller API 只读会话；未解析店铺凭据、未调用 Ozon。",
    });
    return false;
  }
  return true;
}

function requireCrawlerSessionAdmin(req, res) {
  const role = String(req.authPrincipal?.role || req.authPrincipal?.roles || "").toLowerCase();
  if (role === "admin" || role.includes("operator") || req.authPrincipal?.isAdmin === true) return true;
  res.status(403).json({ ok: false, reasonCode: "CRAWLER_SESSION_ADMIN_REQUIRED", error: "当前会话没有采集会话管理员权限。" });
  return false;
}

// Enforce the deployment's store scope after authentication and before any
// business route. This closes body/query storeId substitution; it is an
// explicit allowlist guard, not a claim that user/role-backed RBAC is complete.
app.use((req, res, next) => {
  if (!String(req.path || "").startsWith("/api/") || req.path === "/api/auth/session" || req.path === "/api/healthz") return next();
  const body = parseBody(req.body);
  const bodyStoreId = String(body.storeId || "").trim();
  const queryStoreId = String(req.query?.storeId || "").trim();
  if (bodyStoreId && queryStoreId && bodyStoreId !== queryStoreId) {
    res.status(400).json({ ok: false, reasonCode: "STORE_SCOPE_MISMATCH", error: "body 与 query 的 storeId 不一致。" });
    return;
  }
  const storeId = bodyStoreId || queryStoreId;
  const decision = storeAccessDecision({ storeId, env: process.env, principal: req.authPrincipal });
  if (!decision.allowed) {
    res.status(403).json({ ok: false, reasonCode: decision.reasonCode, error: "当前 ERP 会话未获准访问该店铺。" });
    return;
  }
  req.storeScope = { storeId, reasonCode: decision.reasonCode };
  next();
});

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function workflowRunStoreId(run = {}) {
  return String(
    run.storeId
      || run.store?.id
      || run.store?.clientId
      || run.entity?.storeId
      || run.entity?.store?.id
      || run.payloadDraft?.storeId
      || "",
  ).trim();
}

function workflowRunVisibleToRequest(run, req) {
  const runStoreId = workflowRunStoreId(run);
  const body = parseBody(req.body);
  const requestedStoreId = String(req.storeScope?.storeId || req.query?.storeId || body.storeId || "").trim();
  const principalStoreIds = parseStoreScope(req.authPrincipal?.storeIds || "");
  const scopeRequired = String(process.env.OZON_ERP_REQUIRE_STORE_SCOPE || process.env.REQUIRE_STORE_SCOPE || "") === "1";
  const principalScopeRequired = String(process.env.OZON_ERP_REQUIRE_PRINCIPAL_SCOPE || "") === "1";
  if (requestedStoreId && runStoreId && !storeRefHashesForIds([requestedStoreId]).has(scopeHash(runStoreId))) return false;
  if (scopeRequired && !runStoreId && !requestedStoreId) return false;
  if (principalScopeRequired && !principalStoreIds.length) return false;
  if (principalStoreIds.length && (!runStoreId || !storeRefHashesForIds(principalStoreIds).has(scopeHash(runStoreId)))) return false;
  return true;
}

function storeRefHashesForIds(storeIds = []) {
  const ids = parseStoreScope(storeIds);
  if (!ids.length) return new Set();
  const hashes = new Set(ids.map((storeId) => scopeHash(storeId)));
  let stores = [];
  try { stores = loadStores(); } catch { stores = []; }
  for (const store of stores) {
    const id = String(store?.id || "").trim();
    const clientId = String(store?.clientId || "").trim();
    if (ids.includes(id) || ids.includes(clientId)) {
      if (id) hashes.add(scopeHash(id));
      if (clientId) hashes.add(scopeHash(clientId));
    }
  }
  return hashes;
}

function principalReceiptStoreRefHashes(req) {
  return storeRefHashesForIds(req.authPrincipal?.storeIds || "");
}

function receiptStoreScopeDecision(req, requestedStoreRefHash = "") {
  const principalStoreIds = parseStoreScope(req.authPrincipal?.storeIds || "");
  const principalHashes = principalReceiptStoreRefHashes(req);
  const deploymentStoreIds = parseStoreScope(process.env.OZON_ERP_ALLOWED_STORE_IDS || process.env.OZON_ERP_STORE_IDS || "");
  const deploymentHashes = storeRefHashesForIds(deploymentStoreIds);
  const scopeRequired = String(process.env.OZON_ERP_REQUIRE_STORE_SCOPE || process.env.REQUIRE_STORE_SCOPE || "") === "1";
  const principalScopeRequired = String(process.env.OZON_ERP_REQUIRE_PRINCIPAL_SCOPE || "") === "1";
  if (principalScopeRequired && !principalStoreIds.length) return { allowed: false, reasonCode: "PRINCIPAL_STORE_SCOPE_REQUIRED", hashes: principalHashes };
  const allowedHashes = principalHashes.size && deploymentHashes.size
    ? new Set([...principalHashes].filter((hash) => deploymentHashes.has(hash)))
    : principalHashes.size ? principalHashes : deploymentHashes;
  if (scopeRequired && !requestedStoreRefHash && !allowedHashes.size) return { allowed: false, reasonCode: "READ_RECEIPT_STORE_SCOPE_REQUIRED", hashes: allowedHashes };
  if (requestedStoreRefHash && allowedHashes.size && !allowedHashes.has(requestedStoreRefHash)) {
    return { allowed: false, reasonCode: principalHashes.size ? "PRINCIPAL_STORE_ACCESS_DENIED" : "STORE_ACCESS_DENIED", hashes: allowedHashes };
  }
  return { allowed: true, reasonCode: allowedHashes.size ? "STORE_SCOPE_OK" : "STORE_SCOPE_NOT_REQUESTED", hashes: allowedHashes };
}

async function requireWorkflowRunScope(req, res, next) {
  const runId = String(req.params.id || "").trim();
  if (!runId || runId === "reconcile-stale") return next();
  const run = await getWorkflowRun(runId);
  if (!run) return next();
  if (!workflowRunVisibleToRequest(run, req)) {
    res.status(403).json({
      ok: false,
      reasonCode: "WORKFLOW_STORE_ACCESS_DENIED",
      error: "当前 ERP 会话未获准访问该工作流所属店铺。",
      sideEffect: "仅校验工作流店铺范围；未读取 Ozon、未修改草稿或提交商品。",
    });
    return;
  }
  req.workflowRun = run;
  next();
}

// Every workflow detail/mutation route must bind the durable run to the
// authenticated principal's store scope.  The generic body/query guard cannot
// protect a route whose storeId is only inside the persisted workflow object.
app.use("/api/workflows/:id", asyncRoute(requireWorkflowRunScope));

// Unauthenticated liveness probe for a reverse proxy/orchestrator.  A 200
// here means only that this Node process accepted the request; it does not
// imply authentication, durable persistence, Seller API connectivity, or
// business workflow readiness.  Keep this route before all protected routes
// and never include store/configuration details in its payload.
app.get("/api/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "ozon-erp",
    readiness: "liveness_only",
    authBoundary: "api_routes_require_authentication",
    sideEffect: "仅检查 ERP 进程是否能响应；不读取店铺、不联网、不写入业务数据。",
  });
});

const parseBody = (body) => {
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body || {};
};

// Listing jobs are durable business objects, so the generic body/query
// store guard is not enough: a caller can otherwise address a job by id
// without sending a storeId at all.  Treat an unowned legacy job as invisible
// to a principal that has an explicit store scope; loopback/unscoped local
// development remains backward compatible.
function autoListingJobVisibleToRequest(job, req) {
  if (!job) return false;
  const jobStoreId = String(job.storeId || job.store?.id || job.store?.clientId || "").trim();
  const requestedStoreId = String(req.storeScope?.storeId || req.query?.storeId || parseBody(req.body).storeId || "").trim();
  const principalStoreIds = Array.isArray(req.authPrincipal?.storeIds)
    ? req.authPrincipal.storeIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (requestedStoreId && jobStoreId && !storeRefHashesForIds([requestedStoreId]).has(scopeHash(jobStoreId))) return false;
  if (principalStoreIds.length && (!jobStoreId || !storeRefHashesForIds(principalStoreIds).has(scopeHash(jobStoreId)))) return false;
  return true;
}

async function getScopedAutoListingJob(jobId, req) {
  const job = await getAutoListingJobSnapshot(jobId);
  return autoListingJobVisibleToRequest(job, req) ? job : null;
}

function stockJobVisibleToRequest(job, req) {
  if (!job) return false;
  const jobStoreId = String(job.storeId || job.store?.id || job.store?.clientId || "").trim();
  const requestedStoreId = String(req.storeScope?.storeId || req.query?.storeId || parseBody(req.body).storeId || "").trim();
  const principalStoreIds = parseStoreScope(req.authPrincipal?.storeIds || "");
  if (requestedStoreId && jobStoreId && !storeRefHashesForIds([requestedStoreId]).has(scopeHash(jobStoreId))) return false;
  if (principalStoreIds.length && (!jobStoreId || !storeRefHashesForIds(principalStoreIds).has(scopeHash(jobStoreId)))) return false;
  return true;
}

// This is a precondition gate, not authentication and not an idempotency store.
// Production exposure still requires RBAC plus durable key/result persistence.
function directOzonWritesEnabled(env = process.env) {
  return env.ENABLE_DIRECT_OZON_WRITES === "1";
}

function requireDirectOzonWriteSafety(req, res, next) {
  if (!directOzonWritesEnabled()) {
    res.status(503).json({
      error: "Ozon 直通写入默认关闭；请使用受控 workflow，或由运维显式启用直通写入。",
      reasonCode: "DIRECT_WRITES_DISABLED",
    });
    return;
  }
  const body = parseBody(req.body);
  if (body.confirmDirectWrite !== true) {
    res.status(400).json({
      error: "高风险 Ozon 直通写入需要显式 confirmDirectWrite=true。",
      reasonCode: "DIRECT_WRITE_CONFIRMATION_REQUIRED",
    });
    return;
  }
  const adminDecision = privilegedWriteDecision({
    env: process.env,
    authorization: req.get("Authorization"),
    providedSecret: req.get("X-Ozon-ERP-Admin"),
  });
  if (!adminDecision.allowed) {
    res.status(adminDecision.reasonCode === "ADMIN_AUTH_NOT_CONFIGURED" ? 503 : 403).json({
      error: adminDecision.reasonCode === "ADMIN_AUTH_NOT_CONFIGURED"
        ? "直通写入未配置独立的管理员写入密钥。"
        : "需要独立的管理员写入密钥才能执行 Ozon 直通写入。",
      reasonCode: adminDecision.reasonCode,
    });
    return;
  }
  // The separate admin secret proves possession of the deployment credential;
  // the authenticated session still needs an admin role outside loopback.
  // This is intentionally a small claim boundary, not a full user directory.
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && req.authPrincipal?.role !== "admin") {
    res.status(403).json({
      error: "当前 ERP 会话没有管理员写入角色。",
      reasonCode: "ADMIN_ROLE_REQUIRED",
    });
    return;
  }
  const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();
  if (!idempotencyKey) {
    res.status(400).json({
      error: "高风险 Ozon 直通写入需要 Idempotency-Key 请求头。",
      reasonCode: "DIRECT_WRITE_IDEMPOTENCY_KEY_REQUIRED",
    });
    return;
  }
  req.directOzonWrite = { idempotencyKey };
  next();
}

// Listing submission is an Ozon write even when it goes through the safer
// payload-draft workflow.  A viewer may inspect and repair a draft, but must
// not be able to turn a stolen/replayed confirmSubmit request into a write.
// Loopback keeps the local development path usable because its auth principal
// is deliberately elevated to admin by requestAuthDecision.
function requireListingSubmitRole(req, res, next) {
  const decision = listingSubmitRoleDecision({ host, principal: req.authPrincipal });
  if (decision.allowed) {
    next();
    return;
  }
  res.status(403).json({
    ok: false,
    reasonCode: decision.reasonCode,
    error: "当前 ERP 会话只有查看权限，不能提交商品。",
  });
}

function stableCommandJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableCommandJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCommandJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function directWritePayloadHash(body = {}) {
  const businessBody = Object.fromEntries(Object.entries(parseBody(body)).filter(([key]) => key !== "confirmDirectWrite" && key !== "confirmPromotionWrite"));
  return `sha256:${createHash("sha256").update(stableCommandJson(businessBody), "utf8").digest("hex")}`;
}

function directWriteResultSummary(data = {}, fallback = {}) {
  return {
    status: String(data?.status || fallback.status || "accepted"),
    taskId: String(data?.result?.task_id || data?.task_id || fallback.taskId || ""),
    requestId: String(data?.request_id || fallback.requestId || ""),
    offerCount: Number(fallback.offerCount || 0),
    acceptedCount: Number(fallback.acceptedCount || fallback.offerCount || 0),
    failedCount: Number(fallback.failedCount || 0),
  };
}

// Local fail-closed protection; this is not a claim about every Ozon endpoint's official maximum.
const DIRECT_WRITE_BATCH_LIMIT = 100;

const DIRECT_WRITE_INPUT_MESSAGES = Object.freeze({
  DIRECT_WRITE_STOCKS_REQUIRED: "请至少提供一条库存更新记录。",
  DIRECT_WRITE_STOCK_PREFLIGHT_REQUIRED: "库存写入前必须完成当前商品、仓库和库存证据 dry-run。",
  DIRECT_WRITE_STOCK_CONFIRMATION_REQUIRED: "库存写入前需要明确确认当前 dry-run 结果。",
  DIRECT_WRITE_STOCK_READBACK_REQUIRED: "库存写入已发出，但写后精确库存回查未确认；请先回查，不要重复提交。",
  DIRECT_WRITE_PRICES_REQUIRED: "请至少提供一条价格更新记录。",
  DIRECT_WRITE_PRICE_CONFIRMATION_REQUIRED: "价格写入前需要明确确认当前价证据和结构化差异。",
  DIRECT_WRITE_PRICE_EVIDENCE_SERVER_REQUIRED: "价格写入前必须使用服务端观察到的当前价格证据。",
  DIRECT_WRITE_PRICE_EVIDENCE_STALE: "当前价格证据已陈旧或时间无效，请重新读取。",
  DIRECT_WRITE_PRICE_EVIDENCE_INCOMPLETE: "当前价格证据不完整，仍有分页或缺失字段。",
  DIRECT_WRITE_PRICE_CURRENT_MISSING: "价格写入目标缺少精确 Offer 的当前价，不能按未知值写入。",
  DIRECT_WRITE_PRICE_NO_CHANGE: "没有可确认的价格差异，未调用 Ozon 写接口。",
  DIRECT_WRITE_PRICE_RISK_BLOCKED: "价格来源或最低价存在高风险，修复并人工确认后再写入。",
  DIRECT_WRITE_PRICE_READBACK_REQUIRED: "价格写入已发出，但写后当前价回查未对账；请先复核，不要重复提交。",
  DIRECT_WRITE_ACTION_ID_REQUIRED: "请提供有效的活动 ID。",
  DIRECT_WRITE_PRODUCT_IDS_REQUIRED: "请至少选择一个要移出活动的商品。",
  DIRECT_WRITE_ACTIVITY_CONFIRMATION_REQUIRED: "移出活动前需要确认当前活动范围、价格影响和商品选择。",
  DIRECT_WRITE_ACTIVITY_PREFLIGHT_REQUIRED: "活动写入前必须完成完整活动商品读取和价格影响预览；请修复阻塞后重试。",
  DIRECT_WRITE_BARCODE_PRODUCT_IDS_REQUIRED: "请至少选择一个需要生成条码的商品。",
  DIRECT_WRITE_STOCKS_LIMIT_EXCEEDED: "单次最多更新 100 条库存，请拆分后重试。",
  DIRECT_WRITE_PRICES_LIMIT_EXCEEDED: "单次最多更新 100 条价格，请拆分后重试。",
  DIRECT_WRITE_PRODUCT_IDS_LIMIT_EXCEEDED: "单次最多处理 100 个活动商品，请拆分后重试。",
  DIRECT_WRITE_BARCODE_PRODUCT_IDS_LIMIT_EXCEEDED: "单次最多为 100 个商品生成条码，请拆分后重试。",
  DIRECT_WRITE_PICTURE_PAYLOAD_REQUIRED: "请提供商品图片更新内容。",
  DIRECT_WRITE_PICTURE_PRODUCT_ID_REQUIRED: "请提供有效的图片目标商品 ID。",
  DIRECT_WRITE_PICTURE_IMAGES_REQUIRED: "请至少提供一张有效的商品图片 URL。",
  DIRECT_WRITE_PICTURE_IMAGES_LIMIT_EXCEEDED: "单次最多更新 100 张商品图片，请拆分后重试。",
  DIRECT_WRITE_STORE_REQUIRED: "高风险 Ozon 写入必须明确绑定店铺。",
  DIRECT_WRITE_STORE_NOT_FOUND: "指定店铺不存在或当前配置不可用。",
});

function directWriteInputError(code) {
  const safeCode = Object.hasOwn(DIRECT_WRITE_INPUT_MESSAGES, code) ? code : "DIRECT_WRITE_INPUT_INVALID";
  const error = new Error(DIRECT_WRITE_INPUT_MESSAGES[safeCode] || "直通写入参数不完整。");
  error.status = 400;
  error.code = safeCode;
  error.isDirectWriteInputError = true;
  return error;
}

function requireDirectWriteBatchLimit(items, code) {
  if (items.length > DIRECT_WRITE_BATCH_LIMIT) throw directWriteInputError(code);
}

async function requireStockWritePreflight(req, res, next) {
  const body = parseBody(req.body);
  if (body.confirmStockDryRun !== true) {
    res.status(400).json({
      ok: false,
      reasonCode: "DIRECT_WRITE_STOCK_CONFIRMATION_REQUIRED",
      error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_STOCK_CONFIRMATION_REQUIRED,
    });
    return;
  }
  const storeId = String(body.storeId || "").trim();
  const stocks = Array.isArray(body.stocks) ? body.stocks : [];
  const targetValidation = validateStockDryRunInput({
    targetStocks: stocks,
    products: [],
    warehouses: [],
    currentStocks: [],
  });
  if (!targetValidation.ok) {
    res.status(targetValidation.status || 400).json(targetValidation);
    return;
  }
  try {
    const evidence = await gatherStockReconciliationEvidence({
      storeId,
      offerIds: targetValidation.value.targetStocks.map((item) => item.offer_id),
      warehouseIds: targetValidation.value.targetStocks.map((item) => item.warehouse_id),
    }, {
      readEndpoint: async (endpoint, payload) => ozonRequest(getStore(storeId), endpoint, payload),
    });
    if (!evidence.ok) {
      res.status(evidence.status || 400).json({
        ...evidence,
        reasonCode: "DIRECT_WRITE_STOCK_PREFLIGHT_REQUIRED",
        error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_STOCK_PREFLIGHT_REQUIRED,
      });
      return;
    }
    const dryRun = dryRunStockJobReconciliation({
      job: { id: "confirmed-stock-write", storeId, stocks: targetValidation.value.targetStocks },
      products: evidence.products,
      warehouses: evidence.warehouses,
      currentStocks: evidence.currentStocks,
      requireWarehouseModeEvidence: true,
    });
    if (dryRun.executable !== true) {
      res.status(409).json({
        ok: false,
        reasonCode: "DIRECT_WRITE_STOCK_PREFLIGHT_REQUIRED",
        error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_STOCK_PREFLIGHT_REQUIRED,
        verificationLevel: "server_observed",
        dryRun: {
          executable: false,
          idempotencyKey: dryRun.idempotencyKey,
          blockers: dryRun.blockers,
          missingEvidence: dryRun.missingEvidence,
        },
        sellerView: stockDryRunSellerView(dryRun),
        sideEffect: "已执行库存只读证据读取和本地 dry-run；未调用 Ozon 写接口。",
      });
      return;
    }
    // A confirmed stock request with no observed delta is a duplicate/no-op,
    // not a write opportunity. Block before the direct-write wrapper so a
    // seller clicking confirmation again cannot emit an unnecessary Ozon
    // stocks command.
    if (!Array.isArray(dryRun.plan?.changes) || dryRun.plan.changes.length === 0) {
      res.status(409).json({
        ok: false,
        reasonCode: "DIRECT_WRITE_STOCK_NO_CHANGES",
        error: "当前库存已与目标一致，无需重复写入。",
        verificationLevel: "server_observed",
        dryRun: {
          executable: false,
          idempotencyKey: dryRun.idempotencyKey,
          blockers: [],
          missingEvidence: [],
          unchanged: true,
        },
        sellerView: stockDryRunSellerView(dryRun),
        sideEffect: "已完成当前库存 tuple 只读核对；未调用 Ozon 写接口。",
      });
      return;
    }
    req.stockPreflight = { evidence, dryRun };
    next();
  } catch (error) {
    res.status(502).json({
      ok: false,
      reasonCode: "DIRECT_WRITE_STOCK_PREFLIGHT_REQUIRED",
      error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_STOCK_PREFLIGHT_REQUIRED,
      sideEffect: "库存写入前只读证据读取失败；未调用 Ozon 写接口。",
    });
  }
}

async function requirePriceWritePreflight(req, res, next) {
  const body = parseBody(req.body);
  const prices = Array.isArray(body.prices) ? body.prices : [];
  if (!prices.length) {
    res.status(400).json({ ok: false, reasonCode: "DIRECT_WRITE_PRICES_REQUIRED", error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_PRICES_REQUIRED });
    return;
  }
  if (body.confirmPriceWrite !== true) {
    res.status(400).json({ ok: false, reasonCode: "DIRECT_WRITE_PRICE_CONFIRMATION_REQUIRED", error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_PRICE_CONFIRMATION_REQUIRED, sideEffect: "未读取或写入 Ozon。" });
    return;
  }
  try {
    const storeId = String(body.storeId || "").trim();
    const store = getStore(storeId);
    const offerIds = prices.map((item) => String(item?.offer_id || item?.offerId || "").trim()).filter(Boolean);
    if (offerIds.length !== prices.length) {
      res.status(400).json({ ok: false, reasonCode: "DIRECT_WRITE_PRICE_CURRENT_MISSING", error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_PRICE_CURRENT_MISSING });
      return;
    }
    // Always obtain the current price on the server immediately before the
    // write; client-provided snapshots are never accepted as evidence.
    const current = await ozonRequest(store, "/v4/product/info/prices", {
      filter: { offer_id: offerIds },
      limit: Math.min(DIRECT_WRITE_BATCH_LIMIT, Math.max(1, prices.length)),
      last_id: "",
    });
    const readEvidence = buildProductReadEvidence(current, { kind: "prices" });
    const decision = validatePriceWritePreflight({
      prices,
      evidence: { ...current, verificationLevel: "server_observed", checkedAt: new Date().toISOString(), readEvidence },
      confirm: true,
    });
    if (!decision.executable) {
      res.status(409).json({ ok: false, reasonCode: "DIRECT_WRITE_PRICE_PREFLIGHT_REQUIRED", error: "价格写入前证据或风险校验未通过。", verificationLevel: "server_observed", pricePreflight: decision, sideEffect: decision.sideEffect });
      return;
    }
    req.pricePreflight = { current, readEvidence, decision };
    next();
  } catch (error) {
    res.status(502).json({ ok: false, reasonCode: "DIRECT_WRITE_PRICE_PREFLIGHT_REQUIRED", error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_PRICE_EVIDENCE_SERVER_REQUIRED, sideEffect: "当前价只读证据读取失败；未调用 Ozon 写接口。" });
  }
}

function promotionProductRows(data = {}) {
  const result = data?.result && typeof data.result === "object" ? data.result : {};
  const candidates = [data?.products, data?.items, result?.products, result?.items];
  return candidates.find(Array.isArray) || [];
}

/**
 * Read the complete activity scope before allowing an activity mutation.
 * A single page, an unknown page boundary, or a row without both prices is
 * insufficient evidence for a seller-facing write. This helper is read-only.
 */
async function readPromotionProductsForWrite({ storeId, actionId, requirePrices = true }) {
  const store = getStore(storeId);
  const rows = [];
  let offset = 0;
  let page = 0;
  let response = null;
  let sellerResult = null;
  while (page < 100) {
    response = await ozonRequest(store, "/v1/actions/products", {
      action_id: actionId,
      limit: 1000,
      offset,
    });
    const pageRows = promotionProductRows(response);
    rows.push(...pageRows);
    sellerResult = buildActivityReadSellerResult({
      ...response,
      products: rows,
    }, { kind: "activity_products_write_preflight", offset: 0, limit: 1000 });
    if (sellerResult.status === "complete" || sellerResult.status === "empty") break;
    if (sellerResult.status !== "partial" || sellerResult.nextOffset === null) break;
    const nextOffset = Number(sellerResult.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) break;
    offset = nextOffset;
    page += 1;
  }
  if (!sellerResult || page >= 100) {
    sellerResult = {
      ...(sellerResult || {}),
      status: "unknown",
      coverageComplete: false,
      nextAction: "活动分页读取未能收敛；重新读取活动范围后再操作。",
    };
  }
  const impactPreview = buildPromotionImpactPreview(rows);
  const blockers = [];
  if (sellerResult.coverageComplete !== true) blockers.push("activity_coverage_incomplete");
  if (sellerResult.status === "empty") blockers.push("activity_scope_empty");
  if (requirePrices && impactPreview.unknownPriceCount > 0) blockers.push("activity_price_evidence_missing");
  return { rows, sellerResult, impactPreview, blockers };
}

async function requirePromotionWritePreflight(req, res, next) {
  const body = parseBody(req.body);
  if (body.confirmPromotionWrite !== true) {
    res.status(400).json({
      ok: false,
      reasonCode: "DIRECT_WRITE_ACTIVITY_CONFIRMATION_REQUIRED",
      error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_ACTIVITY_CONFIRMATION_REQUIRED,
    });
    return;
  }
  const storeId = String(body.storeId || "").trim();
  const actionId = Number(body.action_id || body.actionId);
  const productIds = (body.product_ids || body.productIds || [])
    .flat()
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!storeId || !Number.isSafeInteger(actionId) || actionId <= 0 || !productIds.length) {
    res.status(400).json({
      ok: false,
      reasonCode: "DIRECT_WRITE_ACTIVITY_PREFLIGHT_REQUIRED",
      error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_ACTIVITY_PREFLIGHT_REQUIRED,
    });
    return;
  }
  try {
    const preflight = await readPromotionProductsForWrite({ storeId, actionId });
    const selected = new Set(productIds);
    const observed = new Set(preflight.rows.map((row) => Number(row?.product_id || row?.productId || row?.id)).filter(Boolean));
    const missingIds = productIds.filter((id) => !observed.has(id));
    if (preflight.blockers.length || missingIds.length) {
      res.status(409).json({
        ok: false,
        reasonCode: "DIRECT_WRITE_ACTIVITY_PREFLIGHT_REQUIRED",
        error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_ACTIVITY_PREFLIGHT_REQUIRED,
        sellerResult: preflight.sellerResult,
        impactPreview: preflight.impactPreview,
        blockers: [...preflight.blockers, ...(missingIds.length ? ["selected_product_not_in_observed_scope"] : [])],
        missingProductIds: missingIds,
        sideEffect: "已读取活动商品并生成价格影响预览；未调用活动写接口。",
      });
      return;
    }
    req.promotionPreflight = { ...preflight, actionId, productIds: [...selected] };
    next();
  } catch {
    res.status(502).json({
      ok: false,
      reasonCode: "DIRECT_WRITE_ACTIVITY_PREFLIGHT_REQUIRED",
      error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_ACTIVITY_PREFLIGHT_REQUIRED,
      sideEffect: "活动只读证据读取失败；未调用活动写接口。",
    });
  }
}

async function promotionWriteReadback({ storeId, actionId, productIds }) {
  const observed = await readPromotionProductsForWrite({ storeId, actionId, requirePrices: false });
  if (observed.sellerResult.coverageComplete !== true) {
    const error = new Error("promotion write readback evidence unavailable");
    error.status = 502;
    error.code = "DIRECT_WRITE_ACTIVITY_READBACK_REQUIRED";
    error.promotionWriteReadback = observed;
    throw error;
  }
  const remaining = new Set(observed.rows.map((row) => Number(row?.product_id || row?.productId || row?.id)).filter(Boolean));
  const itemResults = productIds.map((productId) => ({
    productId,
    status: remaining.has(productId) ? "needs_review" : "removed",
    nextAction: remaining.has(productId) ? "只读回查仍显示该商品参加活动，请人工复核后不要重复提交。" : "已从当前活动范围回读确认移除。",
  }));
  if (itemResults.some((item) => item.status !== "removed")) {
    const error = new Error("promotion write readback did not reconcile");
    error.status = 502;
    error.code = "DIRECT_WRITE_ACTIVITY_READBACK_REQUIRED";
    error.promotionWriteReadback = { ...observed, itemResults, remainingProductIds: productIds.filter((id) => remaining.has(id)) };
    throw error;
  }
  return { ...observed, itemResults, status: "reconciled" };
}

function validateDirectWritePicturePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw directWriteInputError("DIRECT_WRITE_PICTURE_PAYLOAD_REQUIRED");
  }
  const productId = Number(value.product_id || value.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    throw directWriteInputError("DIRECT_WRITE_PICTURE_PRODUCT_ID_REQUIRED");
  }
  const rawImages = Array.isArray(value.images) ? value.images : [];
  requireDirectWriteBatchLimit(rawImages, "DIRECT_WRITE_PICTURE_IMAGES_LIMIT_EXCEEDED");
  const images = rawImages
    .filter((item) => typeof item === "string" && /^https?:\/\//i.test(item.trim()))
    .map((item) => item.trim());
  if (!images.length || images.length !== value.images.length) {
    throw directWriteInputError("DIRECT_WRITE_PICTURE_IMAGES_REQUIRED");
  }
  return { ...value, product_id: productId, images };
}

function directWriteSafeFailure(error = {}) {
  const rawStatus = Number(error.status || error.statusCode || 502);
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 502;
  const rawCode = String(error.code || "");
  const code = /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : "DIRECT_WRITE_UPSTREAM_FAILED";
  const rawRequestId = String(error.requestId || "");
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(rawRequestId) ? rawRequestId : "";
  const safeInputMessage = DIRECT_WRITE_INPUT_MESSAGES[code]
    || (error.isDirectWriteInputError === true ? "直通写入参数不完整。" : "");
  return {
    status,
    code,
    message: safeInputMessage || "Ozon 写入结果未确认；请使用请求 ID 排查，核实前不要重复提交。",
    requestId,
  };
}

function directWriteOutcomeIsUncertain(error = {}, failure = directWriteSafeFailure(error)) {
  if (error.isDirectWriteInputError === true) return false;
  return failure.status >= 500
    || failure.status === 408
    || failure.status === 429
    || error.name === "AbortError"
    || !Number(error.status || error.statusCode || 0);
}

function directStockReadbackView(error = {}) {
  const reconciliation = error?.stockWriteReadback?.reconciliation;
  if (!reconciliation || typeof reconciliation !== "object") return null;
  const items = Array.isArray(reconciliation.items) ? reconciliation.items.slice(0, DIRECT_WRITE_BATCH_LIMIT).map((item) => ({
    offer_id: String(item.offer_id || ""),
    warehouse_id: Number(item.warehouse_id || 0),
    expected: Number.isFinite(Number(item.expected)) ? Number(item.expected) : null,
    actual: item.actual === null || item.actual === undefined ? null : (Number.isFinite(Number(item.actual)) ? Number(item.actual) : null),
    status: String(item.status || "unknown"),
  })) : [];
  return {
    status: String(reconciliation.status || "unknown"),
    matched: Number(reconciliation.matched || 0),
    failed: Number(reconciliation.failed || 0),
    total: Number(reconciliation.total || items.length),
    items,
    readbackStatus: String(error?.stockWriteReadback?.status || reconciliation.status || "unknown"),
  };
}

function directWriteReplayView(command = {}) {
  if (command.state === "completed") {
    return { status: "replay", commandState: "completed", result: command.resultSummary || {} };
  }
  if (command.state === "needs_review") {
    return {
      status: "unknown_outcome",
      commandState: "needs_review",
      reasonCode: "DIRECT_WRITE_UNKNOWN_OUTCOME",
      error: "Ozon 写入结果未知，需要只读回查或人工复核。",
      safeNextStep: "先到对应业务页面只读回查 Ozon 当前状态；核实前不要换新请求或重复写入。",
    };
  }
  return {
    status: "replay",
    commandState: String(command.state || "unknown"),
    result: directWriteSafeFailure(command.errorSummary || {}),
  };
}

const DIRECT_WRITE_ACTION_LABELS = Object.freeze({
  "ozon.warehouse-stocks": "库存更新",
  "ozon.prices": "价格更新",
  "ozon.actions.products.deactivate": "移出活动",
  "ozon.product-pictures-import": "商品图片更新",
  "ozon.barcode.generate": "条码生成",
});

const DIRECT_WRITE_REVIEW_LABELS = Object.freeze({
  timeout: "执行超时，无法确认 Ozon 是否已接收",
  worker_interrupted: "执行进程中断，结果尚未核实",
  process_restarted: "服务重启后，原写入结果未知",
  unknown_outcome: "Ozon 写入结果未知，需要回查平台状态",
  manual_review_required: "系统无法安全判断写入结果",
});

// A successful HTTP response from the stock write endpoint is only an
// acknowledgement.  Keep the command unresolved until the exact
// (offer_id, warehouse_id) tuples are read back and match the requested
// target.  This helper deliberately performs read-only evidence collection;
// it never retries or submits the write.
async function stockWriteReadback({ storeId, stocks, writeResponse }) {
  const offerIds = stocks.map((item) => item.offer_id);
  const warehouseIds = stocks.map((item) => item.warehouse_id);
  const evidence = await gatherStockReconciliationEvidence({ storeId, offerIds, warehouseIds }, {
    readEndpoint: async (endpoint, payload) => ozonRequest(getStore(storeId), endpoint, payload),
  });
  if (!evidence.ok) {
    const error = new Error("stock write readback evidence unavailable");
    error.status = 502;
    error.code = "DIRECT_WRITE_STOCK_READBACK_REQUIRED";
    error.stockWriteReadback = { evidence, status: "unavailable" };
    throw error;
  }
  const dryRun = dryRunStockJobReconciliation({
    job: { id: "stock-write-readback", storeId, stocks },
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
  if (reconciliation.status !== "reconciled") {
    const error = new Error("stock write readback did not reconcile");
    error.status = 502;
    error.code = "DIRECT_WRITE_STOCK_READBACK_REQUIRED";
    error.stockWriteReadback = { evidence, dryRun, reconciliation, status: reconciliation.status };
    throw error;
  }
  return { evidence, dryRun, reconciliation };
}

function stockWriteReadbackSummary(readback = {}, stocks = [], storeId = "") {
  const evidence = readback.evidence || {};
  const reconciliation = readback.reconciliation || {};
  return {
    status: reconciliation.status || "unknown",
    reconciledCount: Number(reconciliation.matched || 0),
    readbackCheckedAt: String(evidence.checkedAt || ""),
    readbackVerificationLevel: "server_observed",
    readbackScope: {
      storeId: String(storeId || ""),
      offerIds: [...new Set((Array.isArray(stocks) ? stocks : []).map((item) => String(item?.offer_id || "").trim()).filter(Boolean))],
      warehouseIds: [...new Set((Array.isArray(stocks) ? stocks : []).map((item) => Number(item?.warehouse_id || 0)).filter((item) => Number.isSafeInteger(item) && item > 0))],
    },
  };
}

function directWriteAttentionView(command = {}) {
  const reasonCode = command.review?.reason || (command.stale ? "unknown_outcome" : "manual_review_required");
  return {
    action: DIRECT_WRITE_ACTION_LABELS[command.scope] || "Ozon 写操作",
    state: command.state === "needs_review" ? "needs_review" : "stale_in_progress",
    storeId: String(command.storeId || ""),
    createdAt: String(command.createdAt || ""),
    updatedAt: String(command.updatedAt || ""),
    reason: DIRECT_WRITE_REVIEW_LABELS[reasonCode] || DIRECT_WRITE_REVIEW_LABELS.manual_review_required,
    reasonCode,
    safeNextStep: "先到对应业务页面只读回查 Ozon 当前状态；核实前不要换新请求或重复写入。",
  };
}

const directOzonWriteRoute = (scope, handler) => asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const storeId = String(body.storeId || "").trim();
  if (!storeId) {
    res.status(400).json({ ok: false, error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_STORE_REQUIRED, reasonCode: "DIRECT_WRITE_STORE_REQUIRED" });
    return;
  }
  try {
    getStore(storeId);
  } catch {
    res.status(400).json({ ok: false, error: DIRECT_WRITE_INPUT_MESSAGES.DIRECT_WRITE_STORE_NOT_FOUND, reasonCode: "DIRECT_WRITE_STORE_NOT_FOUND" });
    return;
  }
  const idempotencyKey = req.directOzonWrite?.idempotencyKey || "";
  const payloadHash = directWritePayloadHash(body);
  const begun = await directWriteCommands.beginCommand(scope, idempotencyKey, payloadHash, {
    actorId: req.user?.id || req.get("X-Actor-Id") || "",
    storeId,
    summary: {
      action: scope,
      offerCount: Array.isArray(body.items) ? body.items.length : (Array.isArray(body.stocks) ? body.stocks.length : 0),
    },
  });
  if (begun.status === "conflict" || begun.status === "in_progress" || begun.status === "unresolved_payload") {
    res.status(409).json({
      ok: false,
      status: begun.status,
      reasonCode: begun.status === "conflict"
        ? "DIRECT_WRITE_IDEMPOTENCY_CONFLICT"
        : (begun.status === "unresolved_payload" ? "DIRECT_WRITE_UNRESOLVED_PAYLOAD" : "DIRECT_WRITE_IN_PROGRESS"),
    });
    return;
  }
  if (begun.status === "replay") {
    const replay = directWriteReplayView(begun.command);
    res.status(replay.commandState === "needs_review" ? 409 : 200).json({
      ok: begun.command.state === "completed",
      ...replay,
      ...(replay.commandState === "needs_review" ? { idempotencyKey } : {}),
    });
    return;
  }
  try {
    const outcome = await handler(req);
    const data = outcome?.data ?? outcome ?? {};
    await directWriteCommands.completeCommand(scope, idempotencyKey, directWriteResultSummary(data, outcome?.summary || {}));
    res.json(data);
  } catch (error) {
    const failure = directWriteSafeFailure(error);
    if (directWriteOutcomeIsUncertain(error, failure)) {
      const uncertainFailure = { ...failure, code: "DIRECT_WRITE_UNKNOWN_OUTCOME" };
      await directWriteCommands.reviewCommand(scope, idempotencyKey, "unknown_outcome", uncertainFailure);
      res.status(failure.status).json({
        ok: false,
        status: "unknown_outcome",
        commandState: "needs_review",
        reasonCode: "DIRECT_WRITE_UNKNOWN_OUTCOME",
        error: "Ozon 写入结果未知，需要只读回查或人工复核。",
        requestId: failure.requestId,
        idempotencyKey,
        ...(directStockReadbackView(error) ? { readback: directStockReadbackView(error) } : {}),
        safeNextStep: "先到对应业务页面只读回查 Ozon 当前状态；核实前不要换新请求或重复写入。",
      });
      return;
    }
    await directWriteCommands.failCommand(scope, idempotencyKey, failure);
    res.status(failure.status).json({
      ok: false,
      reasonCode: failure.code,
      error: failure.message,
      requestId: failure.requestId,
    });
  }
});

// Legacy duplicate wrapper retained only as a compatibility reference; active
// routes use the guarded wrapper above.
const legacyDirectOzonWriteRoute = (scope, handler) => asyncRoute(async (req, res) => {
  const idempotencyKey = req.directOzonWrite?.idempotencyKey || "";
  const payloadHash = directWritePayloadHash(req.body);
  const body = parseBody(req.body);
  const begun = await directWriteCommands.beginCommand(scope, idempotencyKey, payloadHash, {
    actorId: req.user?.id || req.get("X-Actor-Id") || "",
    storeId: body.storeId || "",
    summary: {
      action: scope,
      offerCount: Array.isArray(body.items) ? body.items.length : (Array.isArray(body.stocks) ? body.stocks.length : 0),
    },
  });
  if (begun.status === "conflict" || begun.status === "in_progress") {
    res.status(409).json({
      ok: false,
      status: begun.status,
      reasonCode: begun.status === "conflict" ? "DIRECT_WRITE_IDEMPOTENCY_CONFLICT" : "DIRECT_WRITE_IN_PROGRESS",
    });
    return;
  }
  if (begun.status === "replay") {
    res.json({
      ok: begun.command.state === "completed",
      status: "replay",
      commandState: begun.command.state,
      result: begun.command.resultSummary || begun.command.errorSummary || {},
    });
    return;
  }
  try {
    const outcome = await handler(req);
    const data = outcome?.data ?? outcome ?? {};
    await directWriteCommands.completeCommand(scope, idempotencyKey, directWriteResultSummary(data, outcome?.summary || {}));
    res.json(data);
  } catch (error) {
    const failure = directWriteSafeFailure(error);
    await directWriteCommands.failCommand(scope, idempotencyKey, {
      status: failure.status,
      code: failure.code,
      message: failure.message,
      requestId: failure.requestId,
    });
    res.status(failure.status).json({ ok: false, reasonCode: failure.code, error: failure.message, requestId: failure.requestId });
  }
});

let latest1688Capture = null;

function buildCaptureResponseReceipt(item = {}, parsed = {}) {
  const captureIdentity = parsed?.captureIdentity || parsed?.sourceEvidence?.captureIdentity || {};
  const contractVersion = String(parsed?.capture?.contractVersion || "manual_capture_v1");
  const snapshotHash = String(parsed?.sourceEvidence?.snapshotHash || parsed?.snapshotHash || "");
  return {
    contractVersion,
    storeId: String(item.storeId || ""),
    captureIdentity: {
      contractVersion,
      taskId: String(captureIdentity.taskId || parsed?.taskId || ""),
      offerId: String(captureIdentity.offerId || parsed?.offerId || ""),
      canonicalUrl: String(captureIdentity.canonicalUrl || parsed?.url || ""),
    },
    identity: {
      taskId: String(captureIdentity.taskId || parsed?.taskId || ""),
      offerId: String(captureIdentity.offerId || parsed?.offerId || ""),
      canonicalUrl: String(captureIdentity.canonicalUrl || parsed?.url || ""),
      captureMode: String(captureIdentity.captureMode || parsed?.captureMode || ""),
      collectedAt: String(captureIdentity.collectedAt || parsed?.collectedAt || item.receivedAt || ""),
      contractVersion,
    },
    snapshotHash,
    sourceEvidence: { snapshotHash },
    rawContentStored: false,
  };
}

function summarizeProduct(item) {
  const fbsPresent = item?.stocks?.fbs?.present;
  const fboPresent = item?.stocks?.fbo?.present;
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
      // Missing stock is unknown evidence, not zero.  A zero is only valid
      // when Seller API explicitly returned a numeric present value.
      fbs: fbsPresent === null || fbsPresent === undefined || fbsPresent === "" ? null : fbsPresent,
      fbo: fboPresent === null || fboPresent === undefined || fboPresent === "" ? null : fboPresent,
    },
    // Keep the flat fields consumed by the seller-facing product ledger in
    // sync with the nested evidence above.  Do not coerce absent values to 0:
    // the UI uses null to distinguish unknown evidence from an observed zero.
    fbs_stock: fbsPresent === null || fbsPresent === undefined || fbsPresent === "" ? null : fbsPresent,
    fbo_stock: fboPresent === null || fboPresent === undefined || fboPresent === "" ? null : fboPresent,
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

function productEvidenceKey(item = {}) {
  const productId = Number(item.product_id || item.productId || item.id || 0);
  if (Number.isSafeInteger(productId) && productId > 0) return `product:${productId}`;
  const offerId = String(item.offer_id || item.offerId || "").trim();
  return offerId ? `offer:${offerId}` : "";
}

function summarizeMissingProductDetail(item = {}) {
  return {
    ...summarizeProduct(item),
    // List rows are only an index when detail is absent. Never carry a list
    // status into the seller's sale/readiness conclusion.
    status: "",
    status_group: "",
    detailStatus: "unknown",
    detailStatusLabel: "商品详情未知",
  };
}

function scopedStoreList(stores, principal, env = process.env) {
  const configuredStoreIds = new Set(parseStoreScope(env.OZON_ERP_ALLOWED_STORE_IDS || env.OZON_ERP_STORE_IDS));
  const storeScopeRequired = String(env.OZON_ERP_REQUIRE_STORE_SCOPE || env.REQUIRE_STORE_SCOPE || "") === "1";
  if (storeScopeRequired && !configuredStoreIds.size) {
    return { allowed: false, reasonCode: "STORE_SCOPE_NOT_CONFIGURED", stores: [] };
  }
  const deploymentStores = configuredStoreIds.size
    ? stores.filter((store) => configuredStoreIds.has(String(store.id)) || configuredStoreIds.has(String(store.clientId)))
    : stores;
  const principalStoreIds = new Set(
    String(principal?.storeIds || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const principalScopeRequired = String(env.OZON_ERP_REQUIRE_PRINCIPAL_SCOPE || "") === "1";
  if (principalScopeRequired && !principalStoreIds.size) {
    return { allowed: false, reasonCode: "PRINCIPAL_STORE_SCOPE_REQUIRED", stores: [] };
  }
  if (!principalStoreIds.size) return { allowed: true, reasonCode: configuredStoreIds.size ? "DEPLOYMENT_STORE_SCOPE_OK" : "PRINCIPAL_STORE_SCOPE_UNCONFIGURED", stores: deploymentStores };
  return {
    allowed: true,
    reasonCode: "PRINCIPAL_STORE_SCOPE_OK",
    stores: deploymentStores.filter((store) => principalStoreIds.has(String(store.id)) || principalStoreIds.has(String(store.clientId))),
  };
}

app.get("/api/stores", asyncRoute(async (req, res) => {
  const scoped = scopedStoreList(loadStores(), req.authPrincipal);
  if (!scoped.allowed) {
    res.status(403).json({ ok: false, reasonCode: scoped.reasonCode, error: "当前 ERP 会话未绑定可访问店铺。" });
    return;
  }
  res.json({ stores: scoped.stores.map(publicStore), scope: scoped.reasonCode });
}));

// Local-only four-store plan matrix.  It never resolves credentials or calls
// Seller API; the response contains store hashes plus the latest persisted
// receipt state so an operator can see what is ready before any live read.
app.get("/api/ozon/read-operator/matrix", asyncRoute(async (req, res) => {
  const environment = String(req.query.environment || "").trim();
  if (!environment) {
    res.status(400).json({ ok: false, reasonCode: "READ_OPERATOR_ENVIRONMENT_REQUIRED", sideEffect: "仅校验计划，不联网。" });
    return;
  }
  // The controlled-read matrix is evidence for the seller-owned canonical
  // source, not whichever local fallback happens to be available to the
  // running process.  Keep the four-store and Seller HTML gates identical to
  // scripts/read-operator-matrix.mjs before presenting a plan to an operator.
  const canonicalApiPath = DEFAULT_API_FILE;
  const scoped = scopedStoreList(loadStores(canonicalApiPath), req.authPrincipal);
  if (!scoped.allowed) {
    res.status(403).json({ ok: false, reasonCode: scoped.reasonCode, sideEffect: "仅校验计划，不联网。" });
    return;
  }
  // Keep the default single-offer matrix executable. Category dictionaries
  // and FBS endpoints require extra scope fields and are selected explicitly
  // by the operator; advertising them here made the matrix look ready while
  // execution later failed with scope errors.
  const defaultOperatorEndpoints = ["/v3/product/list", "/v2/warehouse/list"];
  const plans = scoped.stores.map((store) => ({
    store: { id: store.id, clientId: store.clientId, name: store.name },
    environment,
    scope: { name: "single_offer", offerCount: 1 },
    // A newly generated plan must not advertise deprecated FBS v3 reads.
    // READ_ENDPOINTS remains broad only so historical receipts can still be
    // validated; fresh operator plans use the current Seller API surface.
    endpoints: defaultOperatorEndpoints,
    readOnly: true,
    writeAttempted: false,
    confirm: LIVE_CONFIRMATION,
    maxAgeMs: 60 * 60 * 1000,
  }));
  // A principal-scoped subset is useful for ordinary store listing, but it
  // is not evidence of the canonical four-store matrix.  Keep this endpoint
  // fail-closed instead of returning `ok=true` for 1–3 authorized stores.
  const matrix = buildReadOperatorPlanMatrixSummary(plans, { expectedPrimaryStoreCount: 4 });
  const endpointScopeErrors = [...new Map(plans.flatMap((plan) => plan.endpoints.flatMap((endpoint) => {
    const request = buildReadEndpointRequest(endpoint, plan.scope);
    return request.ok ? [] : [{ endpoint, code: request.reasonCode, message: request.message }];
  })).map((error) => [`${error.endpoint}:${error.code}`, error])).values()];
  const apiEvidence = buildApiEvidenceSummary({
    apiSourcePath: canonicalApiPath,
    sellerApiDocPath: "D:\\Desktop\\ozonseller api\\Ozon Seller API 文件.html",
  });
  const evidenceErrors = [];
  if (apiEvidence.canonicalStoreAudit.status !== "matched") {
    evidenceErrors.push("READ_OPERATOR_CANONICAL_STORE_EVIDENCE_INVALID");
  }
  if (apiEvidence.matrixConsistency.ok !== true) {
    evidenceErrors.push("READ_OPERATOR_SELLER_API_DOCUMENT_STALE");
  }
  const scopedReceiptHashes = new Set(scoped.stores.map((store) => scopeHash(String(store.id || store.clientId))));
  const environmentRefHash = scopeHash(environment);
  const receipts = await readOperatorReceipts.list();
  const latestByStore = new Map();
  receipts
    .filter((receipt) => receipt.environmentRefHash === environmentRefHash
      && scopedReceiptHashes.has(String(receipt.storeRefHash || "")))
    .sort((left, right) => String(right.checkedAt || "").localeCompare(String(left.checkedAt || "")))
    .forEach((receipt) => {
      if (!latestByStore.has(receipt.storeRefHash)) latestByStore.set(receipt.storeRefHash, {
        checkedAt: String(receipt.checkedAt || ""),
        status: String(receipt.status || "unknown"),
        endpointCoverageComplete: receipt.endpointCoverageComplete === true,
        verificationLevel: String(receipt.verificationLevel || ""),
      });
    });
  res.json({
    ok: matrix.ok && endpointScopeErrors.length === 0 && evidenceErrors.length === 0,
    summaryType: "canonical_store_controlled_read_matrix",
    expectedPrimaryStoreCount: 4,
    canonicalStoreCount: scoped.stores.length,
    environmentRefHash,
    evidenceGate: {
      canonicalStoreStatus: apiEvidence.canonicalStoreAudit.status,
      canonicalStoreCount: apiEvidence.canonicalStoreAudit.primaryStoreCount,
      sellerApiDocumentStatus: apiEvidence.matrixConsistency.status,
      sellerApiDocumentReasons: apiEvidence.matrixConsistency.reasons,
      errors: evidenceErrors,
      endpointScopeErrors,
    },
    matrix: {
      ...matrix,
      stores: matrix.stores.map((entry) => ({
        ...entry,
        latestReceipt: latestByStore.get(entry.storeRefHash) || null,
      })),
    },
    execution: "not_started",
    sideEffect: "仅生成并校验四店铺只读计划，读取已保存的脱敏回执；不会联网或写入 Ozon。",
    nextAction: matrix.ok && endpointScopeErrors.length === 0 && evidenceErrors.length === 0
      ? "确认店铺、环境和读取范围后，按同一计划逐店执行受控只读。"
      : endpointScopeErrors.length
        ? "当前默认商品/仓库读取范围可执行；如需类目、字典或 FBS，请在受控计划中补齐对应范围后再执行。"
      : evidenceErrors.length
        ? "先核对 canonical 四店铺来源与 Seller API 文档指纹，不要执行真实读取。"
        : "先修复矩阵中的计划错误，不要执行真实读取。",
  });
}));

app.post("/api/auth/session", asyncRoute(async (req, res) => {
  // Session exchange is a bootstrap operation; it never calls Seller API.
  const transport = authTransportDecision({
    host,
    secure: req.secure,
    forwardedProto: req.get("x-forwarded-proto"),
    trustProxy,
  });
  if (!transport.allowed) {
    res.status(426).json({ ok: false, reasonCode: "AUTH_HTTPS_REQUIRED" });
    return;
  }
  const decision = requestAuthDecision({
    env: process.env,
    host,
    authorization: req.get("authorization"),
    providedSecret: req.get("x-ozon-erp-auth") || req.body?.secret,
  });
  if (!decision.allowed && decision.reasonCode !== "LOOPBACK_ALLOWED") {
    res.status(decision.reasonCode === "AUTH_NOT_CONFIGURED" ? 503 : 401).json({ ok: false, reasonCode: decision.reasonCode });
    return;
  }
  const token = buildAuthSessionToken({ env: process.env });
  const secureCookie = req.secure || String(req.get("x-forwarded-proto") || "").toLowerCase() === "https" ? "; Secure" : "";
  if (token) res.setHeader("Set-Cookie", `ozon_erp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.min(86400, Math.max(300, Number(process.env.OZON_ERP_AUTH_SESSION_TTL_SECONDS || 28800)))}${secureCookie}`);
  res.json({ ok: true, authenticated: true, session: Boolean(token), authorization: "", sideEffect: "仅建立 ERP 会话，不调用 Ozon API。" });
}));

app.get("/api/auth/session-proof", (req, res) => {
  const authSource = String(req.authSource || "");
  if (!["session_cookie", "session_bearer"].includes(authSource)) {
    res.status(403).json({ ok: false, reasonCode: "SESSION_PROOF_SIGNED_SESSION_REQUIRED", message: "请先建立签名 ERP 会话。", sideEffect: "只读认证状态检查，不调用 Ozon API。" });
    return;
  }
  const storeIds = parseStoreScope(req.authPrincipal?.storeIds || "");
  // Never fall back to the deployment environment here.  A signed session
  // without an explicit environment is not bound to the read scope and must
  // not receive a server-verified proof that could be consumed by the
  // four-store plan gate.
  const environment = String(req.authPrincipal?.environment || req.authPrincipal?.sessionEnvironment || "").trim();
  if (environment.length < 3) {
    res.status(403).json({ ok: false, reasonCode: "SESSION_PROOF_ENVIRONMENT_REQUIRED", message: "当前签名会话未绑定读取环境，请重新建立明确环境的 ERP 会话。", sideEffect: "仅校验会话环境；不会调用 Ozon API。" });
    return;
  }
  // Keep the proof fingerprint on the same canonical JSON projection used by
  // server-observed read receipts, so an operator can correlate a receipt to
  // the session scope without ever seeing a token or cookie.
  const proofRefHash = scopeHash({ storeIds: [...storeIds].sort(), environment });
  // The explicit boolean is part of the proof contract consumed by the
  // four-store read-plan gate.  It is safe to expose because this route has
  // already accepted a signed session source; it carries no credential.
  res.json({ ok: true, verified: true, verificationLevel: "server_verified", proofRefHash, storeIds, environment, authSource, sideEffect: "仅返回哈希绑定的会话范围，不返回 Token/API key。" });
});

app.delete("/api/auth/session", (req, res) => {
  const secureCookie = req.secure || String(req.get("x-forwarded-proto") || "").toLowerCase() === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `ozon_erp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);
  res.json({ ok: true, authenticated: false, sideEffect: "仅清理 ERP 会话，不调用 Ozon API。" });
});

app.get("/api/system/runtime-safety", asyncRoute(async (_req, res) => {
  const stores = loadStores();
  res.json(buildRuntimeSafetySnapshot({ host, storeCount: stores.length }));
}));

// Read-only capability audit for operator-facing configuration/gap panels.
// API coverage or local route tests never prove seller permission or a real
// write. Keep product/activity writes explicitly blocked until a controlled
// account, confirmation, async readback, and audit receipt exist.
app.get("/api/system/write-capability", (_req, res) => {
  const enabled = directOzonWritesEnabled();
  res.json({
    readOnly: true,
    directWritesEnabled: enabled,
    capabilities: [
      {
        scope: "product",
        label: "商品资料/上架写入",
        verificationLevel: "locally_tested",
        realWriteVerified: false,
        authorized: false,
        blocked: true,
        nextAction: "仍需受控店铺授权、预检、人工确认、异步回读和审计回执；当前只可查看缺口。",
      },
      {
        scope: "activity",
        label: "活动加入/活动价写入",
        verificationLevel: "locally_tested",
        realWriteVerified: false,
        authorized: false,
        blocked: true,
        nextAction: "当前仅验证活动读取与移除入口；加入活动和活动价必须先补真实证据与逐项回查。",
      },
    ],
    evidenceBoundary: "Seller API 文档、代码和本地测试不能升级真实写入证据；未有真实写回执时不得宣称可用。",
    nextAction: enabled ? "外部写入开关已配置，但商品/活动仍需逐项授权和真实回执，不得直接放量。" : "保持默认禁写；先完成真实只读和受控写入验收。",
  });
});

// Read-only recovery/status entry.  Startup liveness does not prove that the
// local migration marker is complete; expose the audit explicitly so an
// operator can see a corrupt or partial state instead of inferring success
// from a healthy HTTP process.
app.get("/api/system/migration-state", asyncRoute(async (_req, res) => {
  res.json(await buildMigrationStateAudit());
}));

app.get("/api/system/deployment-preflight", asyncRoute(async (_req, res) => {
  const migration = await buildMigrationStateAudit();
  // The HTTP operator surface must run the same local migration dry-run and
  // recovery rehearsal as the CLI. A marker/contract alone can be green while
  // a source snapshot is malformed or the recovery path is not rehearsable.
  // Both helpers are local-only and do not connect to a database or mutate
  // migration/source files.
  const migrationDryRun = await buildCoreMigrationDryRun({});
  const migrationRecoveryDrill = await runCoreMigrationRecoveryDrill({});
  const contract = buildProductionMigrationContract({ env: process.env });
  const diskSpace = buildDiskSpaceCheck({ path: process.cwd(), minimumFreeBytes: process.env.OZON_ERP_MIN_FREE_BYTES });
  // Keep the HTTP operator gate aligned with the local CLI: a production
  // deployment must point at the seller-owned four-store source and the
  // pinned Seller API document before it can be described as ready. This is
  // metadata/fingerprint inspection only; it never loads credentials for a
  // request and never calls Seller API.
  let apiEvidence;
  try {
    apiEvidence = buildApiEvidenceSummary({
      apiSourcePath: DEFAULT_API_FILE,
      sellerApiDocPath: "D:\\Desktop\\ozonseller api\\Ozon Seller API 文件.html",
      canonicalStoreCount: 4,
    });
  } catch (error) {
    apiEvidence = { storeScope: { canonicalStoreCountVerified: false }, matrixConsistency: { ok: false, reasons: ["API_EVIDENCE_READ_FAILED"] }, error: String(error?.message || error).slice(0, 200) };
  }
  const apiEvidenceCheck = {
    check: "api_evidence",
    ok: apiEvidence.storeScope?.canonicalStoreCountVerified === true && apiEvidence.matrixConsistency?.ok === true,
    blockers: [
      ...(apiEvidence.storeScope?.canonicalStoreCountVerified ? [] : [{ code: "CANONICAL_STORE_EVIDENCE_INVALID" }]),
      ...(apiEvidence.matrixConsistency?.ok ? [] : (apiEvidence.matrixConsistency?.reasons || ["SELLER_API_DOCUMENT_INVALID"]).map((code) => ({ code }))),
    ],
    nextAction: apiEvidence.storeScope?.canonicalStoreCountVerified === true && apiEvidence.matrixConsistency?.ok === true
      ? "canonical 四店铺配置和 Seller API HTML 指纹匹配。"
      : "修复 canonical 四店铺来源或 Seller API HTML 指纹后再进行部署预检。",
  };
  // Keep the HTTP preflight on the same strict production profile as the CLI.
  // A plain runtime snapshot intentionally permits loopback development and
  // omits production-only gates (session epoch, principal scope, HTTPS
  // declaration), which previously made the two operator entrypoints disagree.
  const runtimeDecision = productionDeploymentDecision({ host, env: process.env });
  const runtime = { ...runtimeDecision.snapshot, productionAllowed: runtimeDecision.allowed, productionBlockers: runtimeDecision.blockers };
  const checks = [
    {
      check: "runtime_startup",
      ok: runtimeDecision.allowed === true,
      blockers: runtimeDecision.blockerDetails || (runtimeDecision.blockers || []).map((code) => ({ code })),
      nextAction: runtimeDecision.nextAction,
    },
    {
      check: "migration_state",
      ok: migration.ok === true,
      blockers: migration.blockers || [],
      nextAction: migration.nextAction,
    },
    {
      check: "migration_dry_run",
      ok: migrationDryRun.ok === true,
      blockers: migrationDryRun.ok === true ? [] : [{ code: "MIGRATION_DRY_RUN_BLOCKED", details: migrationDryRun.blockers || migrationDryRun.errors || [] }],
      nextAction: migrationDryRun.ok === true ? "本地迁移源快照检查通过。" : "修复迁移源快照后重新执行部署预检。",
    },
    {
      check: "migration_recovery_drill",
      ok: migrationRecoveryDrill.ok === true && migrationRecoveryDrill.deploymentReady !== false,
      blockers: migrationRecoveryDrill.ok === true && migrationRecoveryDrill.deploymentReady !== false ? [] : [{ code: "MIGRATION_RECOVERY_DRILL_NOT_PRODUCTION_EVIDENCE" }],
      nextAction: "在受控终端完成真实迁移备份与恢复演练；本地模拟不能宣称生产可部署。",
    },
    {
      check: "production_migration_contract",
      ok: contract.ok === true,
      blockers: contract.blockerDetails || (contract.blockers || []).map((code) => ({ code })),
      nextAction: contract.nextAction,
    },
    apiEvidenceCheck,
    { check: "disk_space", ok: diskSpace.ok === true, blockers: diskSpace.ok ? [] : [{ code: diskSpace.code }], nextAction: diskSpace.nextAction, ...diskSpace },
  ];
  const blockers = checks
    .filter((check) => !check.ok)
    .flatMap((check) => (check.blockers || []).map((blocker) => ({ check: check.check, blocker })));
  res.json({ ok: blockers.length === 0, deploymentReady: blockers.length === 0, verificationLevel: "configuration_declared", runtime, migration, contract, apiEvidence, diskSpace, blockers, checks, nextAction: blockers[0]?.blocker?.nextAction || "本地部署前置检查通过；仍需按部署环境人工确认并执行真实迁移/恢复。", sideEffect: "只读本地部署预检。" });
}));

app.get("/api/system/observability", asyncRoute(async (_req, res) => {
  res.json(buildObservabilitySummary({ env: process.env }));
}));

app.get("/api/system/api-evidence", asyncRoute(async (_req, res) => {
  let canonicalStoreCount = null;
  // Keep this diagnostic aligned with the same seller-owned canonical source
  // used by the controlled-read matrix; deployment overrides must not silently
  // turn a different credential file into four-store evidence.
  try { canonicalStoreCount = loadStores(DEFAULT_API_FILE).length; } catch { /* evidence endpoint remains useful when the file is absent */ }
  res.json(buildApiEvidenceSummary({
    apiSourcePath: DEFAULT_API_FILE,
    sellerApiDocPath: "D:\\Desktop\\ozonseller api\\Ozon Seller API 文件.html",
    canonicalStoreCount,
  }));
}));

app.get("/api/ozon/direct-write-status", (_req, res) => {
  const directWritesEnabled = directOzonWritesEnabled();
  res.json({
    directWritesEnabled,
    mode: directWritesEnabled ? "explicitly_enabled" : "disabled_by_default",
  });
});

app.get("/api/ozon/write-command-attention", asyncRoute(async (_req, res) => {
  const [summary, page] = await Promise.all([
    directWriteCommands.summarizeNeedsReview(),
    directWriteCommands.listCommands({ state: ["needs_review", "in_progress"], limit: 100 }),
  ]);
  const items = page.items
    .filter((command) => command.state === "needs_review" || command.stale)
    .map(directWriteAttentionView);
  res.json({
    summary: {
      needsReview: summary.needsReview,
      staleInProgress: summary.staleInProgress,
      totalAttention: summary.totalAttention,
    },
    items,
    readOnly: true,
    safeNextStep: "逐条到对应业务页回查平台状态；本入口不会重试或再次提交。",
  });
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
  const captureStoreId = String(body.storeId || "").trim();
  if (req.authPrincipal?.storeIds?.length && !captureStoreId) {
    res.status(400).json({ ok: false, reasonCode: "CAPTURE_STORE_REQUIRED", error: "当前多店铺会话必须明确选择采集归属店铺。" });
    return;
  }
  const url = String(body.url || "").trim();
  const html = String(body.html || "").trim() || (url ? await fetch1688Html(url) : "");
  const parsed = parse1688Product({ url, html, hints: body });
  if (body.includeVideo === false) parsed.video = null;
  const item = await addCollectionItem({ parsed, storeId: captureStoreId, includeVideo: body.includeVideo !== false });
  latest1688Capture = {
    id: item.id,
    storeId: item.storeId || "",
    receivedAt: item.receivedAt,
    parsed,
  };
  res.json({
    ...parsed,
    collectionId: item.id,
    captureReceipt: buildCaptureResponseReceipt(item, parsed),
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
  const captureInput = normalizeManualCapturePayload(body);
  const captureStoreId = captureInput.storeId;
  if (req.authPrincipal?.storeIds?.length && !captureStoreId) {
    res.status(400).json({ ok: false, reasonCode: "CAPTURE_STORE_REQUIRED", error: "当前多店铺会话必须明确选择采集归属店铺。" });
    return;
  }
  const parsed = parse1688Product({ url: captureInput.url, html: captureInput.html, hints: captureInput.hints });
  if (!captureInput.includeVideo) parsed.video = null;
  const item = await addCollectionItem({
    parsed,
    storeId: captureStoreId,
    includeVideo: captureInput.includeVideo,
  });
  latest1688Capture = {
    id: item.id,
    storeId: item.storeId || "",
    receivedAt: item.receivedAt,
    parsed,
  };
  res.json({
    ok: true,
    id: item.id,
    receivedAt: latest1688Capture.receivedAt,
    title: parsed.title,
    captureReceipt: buildCaptureResponseReceipt(item, parsed),
    duplicate: Boolean(item.duplicate),
    duplicateMessage: item.duplicateMessage || "",
  });
}));

app.post("/api/pdd/capture", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const captureStoreId = String(body.storeId || "").trim();
  if (req.authPrincipal?.storeIds?.length && !captureStoreId) {
    res.status(400).json({ ok: false, reasonCode: "CAPTURE_STORE_REQUIRED", error: "当前多店铺会话必须明确选择采集归属店铺。" });
    return;
  }
  const url = String(body.url || "").trim();
  const html = String(body.html || "").trim();
  const parsed = parsePddProduct({ url, html, hints: body });
  if (body.includeVideo === false) parsed.video = null;
  const item = await addCollectionItem({
    parsed,
    storeId: captureStoreId,
    includeVideo: body.includeVideo !== false,
  });
  latest1688Capture = {
    id: item.id,
    storeId: item.storeId || "",
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
  const requestedStoreId = String(_req.query.storeId || "").trim();
  const principalStoreIds = Array.isArray(_req.authPrincipal?.storeIds)
    ? _req.authPrincipal.storeIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const latestStoreId = String(latest1688Capture.storeId || "");
  if ((requestedStoreId && latestStoreId !== requestedStoreId)
    || (!requestedStoreId && principalStoreIds.length && !principalStoreIds.includes(latestStoreId))) {
    res.status(404).json({ error: "当前店铺没有可见的最近采集记录。", reasonCode: "CAPTURE_STORE_SCOPE_NOT_FOUND" });
    return;
  }
  res.json(latest1688Capture);
});
app.get("/api/1688/captures", asyncRoute(async (_req, res) => {
  res.json({ items: await listCollectionItems({ storeId: String(_req.query.storeId || ""), storeIds: _req.authPrincipal?.storeIds || [] }) });
}));

app.get("/api/1688/captures/:id", asyncRoute(async (req, res) => {
  const item = await getCollectionItem(req.params.id, { storeId: String(req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
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
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const patch = {};
  for (const key of ["storeId", "status", "draft", "lastError", "candidateId", "includeVideo"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
  }
  // captureReview and parsed/source evidence are intentionally not patchable;
  // /review is the only endpoint that can create the hash-bound approval.
  const item = await updateCollectionItem(req.params.id, patch, { storeId: String(body.storeId || req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
  if (!item) {
    res.status(404).json({ error: "没有找到采集箱商品。" });
    return;
  }
  res.json(item);
}));

// Confirm the exact persisted source snapshot before the capture can enter a
// listing workflow. This stores only a hash-bound review receipt; it never
// treats the parser's verificationState as seller approval and never calls
// 1688 or Ozon.
app.post("/api/1688/captures/:id/review", asyncRoute(async (req, res) => {
  const item = await getCollectionItem(req.params.id, {
    storeId: String(req.body?.storeId || req.query.storeId || ""),
    storeIds: req.authPrincipal?.storeIds || [],
  });
  if (!item) {
    res.status(404).json({ ok: false, reasonCode: "CAPTURE_NOT_FOUND", error: "没有找到采集箱商品。" });
    return;
  }
  const parsed = item.parsed || {};
  const snapshotHash = String(parsed.sourceEvidence?.snapshotHash || "").trim();
  if (!/^sha256:[a-f0-9]{64}$/i.test(snapshotHash)) {
    res.status(400).json({ ok: false, reasonCode: "CAPTURE_SNAPSHOT_HASH_MISSING", nextAction: "重新采集并形成有效 1688 快照后再确认。" });
    return;
  }
  const review = {
    status: "approved",
    humanConfirmed: true,
    reviewedSnapshotHash: snapshotHash,
    reviewedAt: new Date().toISOString(),
  };
  const updated = await updateCollectionItem(req.params.id, {
    captureReview: review,
    parsed: { ...parsed, captureReview: review },
  }, {
    storeId: String(req.body?.storeId || req.query.storeId || ""),
    storeIds: req.authPrincipal?.storeIds || [],
  });
  res.json({
    ok: true,
    captureId: req.params.id,
    captureReview: review,
    item: updated,
    nextAction: "当前来源快照已确认；现在可以生成本地草稿并运行预检。",
    sideEffect: "仅保存 hash 绑定的本地人工确认；未访问 1688、未调用 Ozon、未提交商品。",
  });
}));

app.post("/api/1688/captures/:id/workflow", asyncRoute(async (req, res) => {
  const item = await getCollectionItem(req.params.id, {
    storeId: String(req.body?.storeId || req.query.storeId || ""),
    storeIds: req.authPrincipal?.storeIds || [],
  });
  if (!item) {
    res.status(404).json({ ok: false, reasonCode: "CAPTURE_NOT_FOUND", error: "没有找到采集箱商品。" });
    return;
  }
  const result = await createListingWorkflowFrom1688Capture(item.id, {
    parsed: item.parsed || {},
    storeId: String(item.storeId || req.body?.storeId || req.query.storeId || ""),
    // The browser cannot assert approval in the request body. The only
    // accepted review is the hash-bound receipt persisted by /review.
    captureReview: item.captureReview || {},
    categoryEvidenceEnvironmentRefHash: req.body?.environment ? scopeHash(String(req.body.environment).trim()) : "",
  });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json({ ...result, sideEffect: "仅绑定本地商品工作流；未调用 Ozon、未提交写入。" });
}));

// Seller-facing local preflight entry for one capture.  It binds the capture
// to the same durable workflow as the editor, then validates the current
// payload draft.  A blocked result is still a successful read of local state:
// it returns the exact next action instead of forcing the seller to inspect
// workflow internals.  No Seller API request or Ozon write is made here.
app.post("/api/1688/captures/:id/preflight", asyncRoute(async (req, res) => {
  const storeId = String(req.body?.storeId || req.query.storeId || "").trim();
  const item = await getCollectionItem(req.params.id, {
    storeId,
    storeIds: req.authPrincipal?.storeIds || [],
  });
  if (!item) {
    res.status(404).json({ ok: false, reasonCode: "CAPTURE_NOT_FOUND", error: "没有找到采集箱商品。" });
    return;
  }
  const binding = await createListingWorkflowFrom1688Capture(item.id, {
    parsed: item.parsed || {},
    storeId: String(item.storeId || storeId || ""),
    captureReview: item.captureReview || {},
    categoryEvidenceEnvironmentRefHash: req.body?.environment ? scopeHash(String(req.body.environment).trim()) : "",
  });
  if (!binding.ok || !binding.workflowRunId) {
    res.status(400).json({ ...binding, sideEffect: "仅尝试绑定本地商品工作流；未调用 Ozon、未提交写入。" });
    return;
  }
  const validation = await validatePayloadDraft(binding.workflowRunId);
  const run = await getWorkflowRun(binding.workflowRunId);
  const passed = validation?.ok === true;
  res.json({
    ok: passed,
    status: passed ? "preflight_passed" : "preflight_blocked",
    captureId: item.id,
    workflowRunId: binding.workflowRunId,
    draftHash: String(validation?.draftHash || run?.payloadDraftHash || ""),
    validation: validation || null,
    sellerTask: validation?.sellerResult || {
      status: "blocked",
      reasonCode: "PREFLIGHT_PAYLOAD_DRAFT_REQUIRED",
      title: "先补齐商品草稿",
      nextAction: "打开商品草稿，补齐来源、类目、俄文内容、媒体、尺重和采购成本后重新预检。",
      sideEffect: "仅保存本地预检结果；不会调用 Ozon。",
    },
    nextAction: passed
      ? "查看预检通过项并重新人工确认后，才能进入受控提交。"
      : String(validation?.sellerResult?.nextAction || "按预检阻塞项补齐商品资料后重新运行预检。"),
    sideEffect: "仅绑定本地工作流并运行本地 Payload 预检；未联网、未读取 Seller API、未调用 Ozon 写接口。",
  });
}));

app.delete("/api/1688/captures/:id", asyncRoute(async (req, res) => {
  res.json({ ok: await deleteCollectionItem(req.params.id, { storeId: String(req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] }) });
}));

app.post("/api/1688/captures/:id/to-candidate", asyncRoute(async (req, res) => {
  const data = await moveCaptureToCrawlerCandidate(req.params.id, { storeId: String(req.body?.storeId || req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
  if (!data) {
    res.status(404).json({ error: "没有找到采集箱商品。" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.post("/api/1688-crawler/tasks", asyncRoute(async (req, res) => {
  const payload = parseBody(req.body);
  if (req.authPrincipal?.storeIds?.length && !String(payload.storeId || "").trim()) {
    res.status(400).json({ ok: false, reasonCode: "CRAWLER_TASK_STORE_REQUIRED", error: "当前多店铺会话必须明确选择采集任务归属店铺。" });
    return;
  }
  const data = await createCrawlerTask(payload);
  res.json({ ok: true, ...data });
}));

app.get("/api/1688-crawler/tasks", asyncRoute(async (_req, res) => {
  res.json({ items: await listCrawlerTasks({ storeId: String(_req.query.storeId || ""), storeIds: _req.authPrincipal?.storeIds || [] }) });
}));

app.get("/api/1688-crawler/tasks/:id", asyncRoute(async (req, res) => {
  const item = await getCrawlerTask(req.params.id, { storeId: String(req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json(item);
}));

app.post("/api/1688-crawler/tasks/:id/pause", asyncRoute(async (req, res) => {
  const item = await updateCrawlerTaskStatus(req.params.id, "paused", { storeId: String(req.body?.storeId || req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json({ ok: true, item });
}));

app.post("/api/1688-crawler/tasks/:id/resume", asyncRoute(async (req, res) => {
  const item = await updateCrawlerTaskStatus(req.params.id, "running", { storeId: String(req.body?.storeId || req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json({ ok: true, item, requeuedJobs: item.requeuedJobs || 0 });
}));

app.post("/api/1688-crawler/tasks/:id/stop", asyncRoute(async (req, res) => {
  const item = await updateCrawlerTaskStatus(req.params.id, "stopped", { storeId: String(req.body?.storeId || req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
  if (!item) {
    res.status(404).json({ error: "没有找到任务。" });
    return;
  }
  res.json({ ok: true, item });
}));

app.delete("/api/1688-crawler/tasks/:id", asyncRoute(async (req, res) => {
  const item = await deleteCrawlerTask(req.params.id, { storeId: String(req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
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
    storeId: String(req.query.storeId || ""),
    storeIds: req.authPrincipal?.storeIds || [],
  });
  res.json({ items });
}));

app.post("/api/1688-crawler/candidates/:id/create-listing-draft", asyncRoute(async (req, res) => {
  const result = await createListingDraftFrom1688Candidate(req.params.id, {
    storeId: req.body?.storeId || req.query.storeId || "",
    storeIds: req.authPrincipal?.storeIds || [],
    // Candidate capture approval is server-persisted; do not accept a
    // caller-supplied approval/hash as evidence.
    captureReview: undefined,
  });
  if (!result.ok) {
    res.status(result.reasonCode === "1688_CANDIDATE_NOT_FOUND" ? 404 : 400).json(result);
    return;
  }
  res.json({
    ...result,
    sideEffect: result.duplicate
      ? "仅打开已有本地草稿；未创建重复任务、未调用 Ozon。"
      : "已创建本地商品草稿和工作流；未调用 Ozon、未生成付费内容、未提交写入。",
  });
}));

app.patch("/api/1688-crawler/candidates/:id", asyncRoute(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const patch = {};
  for (const key of ["storeId", "status", "title", "url", "supplier", "purchasePriceCny", "reviewIssues", "parsed", "product", "sourceEvidence", "sourceEvidenceSummary"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
  }
  delete patch.captureReview;
  const item = await updateCrawlerCandidate(req.params.id, patch, { storeId: String(body.storeId || req.query.storeId || ""), storeIds: req.authPrincipal?.storeIds || [] });
  if (!item) {
    res.status(404).json({ error: "没有找到候选商品。" });
    return;
  }
  res.json({ ok: true, item });
}));
app.post("/api/1688-crawler/candidates/:id/to-capture", asyncRoute(async (req, res) => {
  const data = await moveCrawlerCandidateToCapture(req.params.id, req.body?.storeId || req.query.storeId || "", { storeIds: req.authPrincipal?.storeIds || [] });
  if (!data) {
    res.status(404).json({ error: "没有找到候选商品。" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.get("/api/1688-crawler/session/status", asyncRoute(async (_req, res) => {
  res.json(await getCrawlerSessionStatus());
}));

app.get("/api/1688-crawler/extension/status", asyncRoute(async (req, res) => {
  res.json(await getCrawlerWorkerStatus({
    principalId: String(req.authPrincipal?.principalId || ""),
    principalStoreIds: req.authPrincipal?.storeIds,
    principalRole: String(req.authPrincipal?.role || ""),
  }));
}));

app.post("/api/1688-crawler/extension/heartbeat", asyncRoute(async (req, res) => {
  const worker = await recordCrawlerWorkerHeartbeat({
    ...(req.body || {}),
    principalId: String(req.authPrincipal?.principalId || ""),
    principalStoreIds: req.authPrincipal?.storeIds,
    principalRole: String(req.authPrincipal?.role || ""),
  });
  res.json({ ok: true, worker });
}));

app.post("/api/1688-crawler/session/cookie", asyncRoute(async (req, res) => {
  if (!requireCrawlerSessionAdmin(req, res)) return;
  const cookie = String(req.body?.cookie || req.body?.cookieString || "").trim();
  if (!cookie) {
    throw new Error("请提供 cookie 字符串。");
  }
  const data = await setCrawlerSessionCookie(cookie);
  res.json({ ok: true, updatedAt: data.updatedAt });
}));

app.delete("/api/1688-crawler/session/cookie", asyncRoute(async (req, res) => {
  if (!requireCrawlerSessionAdmin(req, res)) return;
  await clearCrawlerSessionCookie();
  res.json({ ok: true });
}));

app.get("/api/1688-crawler/extension/next", asyncRoute(async (req, res) => {
  const job = await claimCrawlerExtensionJob(String(req.query.workerId || ""), {
    storeId: String(req.query.storeId || ""),
    storeIds: req.authPrincipal?.storeIds,
    principalId: String(req.authPrincipal?.principalId || ""),
  });
  if (job?.scopeDenied) {
    res.status(403).json({ ok: false, scopeDenied: true, reasonCode: "CRAWLER_EXTENSION_STORE_SCOPE_DENIED" });
    return;
  }
  res.json({ job: job ? { ...job, kind: job.kind || job.type } : null });
}));

app.post("/api/1688-crawler/extension/discover-result", asyncRoute(async (req, res) => {
  const data = await completeCrawlerExtensionDiscover(req.body.jobId, req.body || {}, {
    storeId: String(req.body?.storeId || ""),
    storeIds: req.authPrincipal?.storeIds,
    principalId: String(req.authPrincipal?.principalId || ""),
  });
  if (!data) {
    res.status(404).json({ error: "没有找到采集作业。" });
    return;
  }
  if (data.scopeDenied) {
    res.status(403).json({ ok: false, scopeDenied: true, reasonCode: "CRAWLER_EXTENSION_STORE_SCOPE_DENIED" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.post("/api/1688-crawler/extension/detail-result", asyncRoute(async (req, res) => {
  const data = await completeCrawlerExtensionDetail(req.body.jobId, { ...(req.body.payload || {}), ...req.body }, {
    storeId: String(req.body?.storeId || ""),
    storeIds: req.authPrincipal?.storeIds,
    principalId: String(req.authPrincipal?.principalId || ""),
  });
  if (!data) {
    res.status(404).json({ error: "没有找到采集作业。" });
    return;
  }
  if (data.scopeDenied) {
    res.status(403).json({ ok: false, scopeDenied: true, reasonCode: "CRAWLER_EXTENSION_STORE_SCOPE_DENIED" });
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

app.post("/api/workflows/:id/request-media-review", asyncRoute(async (req, res) => {
  const result = await requestWorkflowMediaReview(req.params.id);
  if (!result.ok) {
    res.status(result.status || 400).json(result);
    return;
  }
  res.json({ ...result, sideEffect: "仅把当前工作流置为等待人工媒体审查；未批准媒体、未调用 Ozon、未提交商品。" });
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

app.post("/api/workflows/:id/media-approval-draft", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const run = await getWorkflowRun(req.params.id);
  const jobId = String(run?.entity?.autoListingJobId || "").trim();
  const job = jobId ? await getAutoListingJobSnapshot(jobId) : null;
  const result = await approveWorkflowMediaCandidates(req.params.id, body, {
    candidateData: job?.candidateData || {},
    persistCandidateData: async (candidateData, binding) => {
      const saved = await saveAutoListingMediaApprovalDraft(jobId, candidateData, binding?.expectedSourceHash || "");
      if (saved === null) throw new Error("自动上架候选不存在，无法保存媒体批准草稿。");
      return saved !== false;
    },
  });
  if (!result.ok) {
    res.status(result.status || 400).json(result);
    return;
  }
  res.json(result);
}));

app.post("/api/workflows/:id/media-approval-draft/publish", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const run = await getWorkflowRun(req.params.id);
  const jobId = String(run?.entity?.autoListingJobId || "").trim();
  const job = jobId ? await getAutoListingJobSnapshot(jobId) : null;
  const result = await publishWorkflowMediaApproval(req.params.id, body, {
    candidateData: job?.candidateData || {},
    persistCandidateData: async (candidateData, binding) => {
      const saved = await publishAutoListingMediaApproval(jobId, candidateData, binding || {});
      if (saved === null) throw new Error("自动上架候选不存在，无法发布媒体批准。");
      return saved !== false;
    },
    rollbackCandidateData: async (binding) => {
      const rolledBack = await rollbackAutoListingMediaApproval(jobId, binding || {});
      if (rolledBack === null) throw new Error("自动上架候选不存在，无法回滚媒体批准。");
      return rolledBack !== false;
    },
  });
  if (!result.ok) {
    res.status(result.status || 400).json(result);
    return;
  }
  res.json(result);
}));

app.post("/api/workflows/:id/request-preflight-recheck", asyncRoute(async (req, res) => {
  const run = await getWorkflowRun(req.params.id);
  if (!run) {
    res.status(404).json({ ok: false, reasonCode: "PREFLIGHT_RECHECK_WORKFLOW_NOT_FOUND" });
    return;
  }
  if (run.mediaApprovalDraft?.status !== "published_local") {
    res.status(400).json({
      ok: false,
      reasonCode: "PREFLIGHT_RECHECK_MEDIA_APPROVAL_REQUIRED",
      message: "必须先发布本地媒体批准，才能重新运行商品预检。",
    });
    return;
  }
  const result = await continueWorkflowNode(req.params.id, "preflight_check", parseBody(req.body), {
    getWorkflowRun,
    updateCrawlerTaskStatus,
    validatePayloadDraft,
    rerunAutoListingMatch,
    rerunAutoListingContent,
    retryWorkflowAfterManualFix,
    appendWorkflowEvent,
  });
  res.json({
    ...result,
    sideEffect: "仅重新计算本地商品预检；未上传媒体、未调用 Ozon、未提交商品。",
  });
}));

app.post("/api/workflows/:id/payload-draft/submit", requireListingSubmitRole, asyncRoute(async (req, res) => {
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

// ruleApprovalAudit writes only audit records; it never enables rules or writes listing drafts.
app.get("/api/listing-rule-approval-audit/intents", asyncRoute(async (req, res) => {
  res.json(await listRuleApprovalAuditIntents(req.query || {}));
}));

app.post("/api/listing-rule-approval-audit/intents", asyncRoute(async (req, res) => {
  res.json({ ok: true, intent: await appendRuleApprovalAuditIntent(parseBody(req.body)) });
}));

app.get("/api/listing-rule-approval-audit/summary", asyncRoute(async (_req, res) => {
  res.json(await summarizeRuleApprovalAuditIntents());
}));

// rulePublishReview stores review intent only; it never enables rules or writes listing drafts.
app.get("/api/listing-rule-publish-review/intents", asyncRoute(async (req, res) => {
  res.json(await listRulePublishReviewIntents(req.query || {}));
}));

app.post("/api/listing-rule-publish-review/intents", asyncRoute(async (req, res) => {
  res.json({ ok: true, intent: await appendRulePublishReviewIntent(parseBody(req.body)) });
}));

app.get("/api/listing-rule-publish-review/summary", asyncRoute(async (_req, res) => {
  res.json(await summarizeRulePublishReviewIntents());
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
  const body = parseBody(req.body);
  if (body.confirmAutoList !== true) {
    res.status(400).json({
      ok: false,
      reasonCode: "AUTO_LIST_CONFIRMATION_REQUIRED",
      message: "自动铺货会调用 AI 并创建 1688 采集任务，必须由操作者明确确认。",
    });
    return;
  }
  const storeId = String(body.storeId || "").trim();
  if (!storeId) {
    res.status(400).json({ ok: false, reasonCode: "AUTO_LIST_STORE_REQUIRED", message: "自动铺货任务必须绑定当前店铺。" });
    return;
  }
  try {
    var data = await triggerAutoListing(body.itemId, storeId);
    res.json(Object.assign({ ok: true }, data));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

app.get("/api/ozon-learning/auto-list-jobs", asyncRoute(async (req, res) => {
  const items = (await listAutoListingJobs()).filter((job) => autoListingJobVisibleToRequest(job, req));
  res.json({ items, scope: req.storeScope?.storeId || "principal" });
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
  var job = await getScopedAutoListingJob(req.params.id, req);
  if (!job) { res.status(404).json({ error: "未找到铺货记录" }); return; }
  res.json(job);
}));

app.post("/api/ozon-learning/auto-list-jobs/:id/manual-content", asyncRoute(async (req, res) => {
  if (!await getScopedAutoListingJob(req.params.id, req)) { res.status(404).json({ error: "未找到铺货记录", reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" }); return; }
  const result = await saveManualListingContent(req.params.id, req.body || {});
  if (!result.ok) {
    const status = result.reasonCode === "AUTO_LISTING_JOB_NOT_FOUND" ? 404 : 400;
    res.status(status).json(result);
    return;
  }
  res.json({
    ...result,
    sideEffect: "仅保存卖家填写的本地俄文草稿并更新工作流；未调用 AI、未调用 Ozon、未提交商品。",
  });
}));

app.post("/api/ozon-learning/auto-list-jobs/:id/manual-category", asyncRoute(async (req, res) => {
  if (!await getScopedAutoListingJob(req.params.id, req)) { res.status(404).json({ error: "未找到铺货记录", reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" }); return; }
  const result = await saveManualListingCategory(req.params.id, req.body || {});
  if (!result.ok) {
    res.status(result.reasonCode === "AUTO_LISTING_JOB_NOT_FOUND" ? 404 : 400).json(result);
    return;
  }
  res.json({
    ...result,
    sideEffect: "仅保存卖家确认的本地类目并更新工作流；未调用 Ozon 写接口、未提交商品。",
  });
}));

app.post("/api/ozon-learning/auto-list-jobs/:id/manual-procurement", asyncRoute(async (req, res) => {
  if (!await getScopedAutoListingJob(req.params.id, req)) { res.status(404).json({ error: "未找到铺货记录", reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" }); return; }
  const result = await saveManualProcurementEvidence(req.params.id, req.body || {});
  if (!result.ok) {
    res.status(result.reasonCode === "AUTO_LISTING_JOB_NOT_FOUND" ? 404 : 400).json(result);
    return;
  }
  res.json({
    ...result,
    sideEffect: "仅保存卖家填写的本地采购证据；未调用 Ozon、未把手填数据标成官方实时费率、未提交商品。",
  });
}));

app.post("/api/ozon-learning/auto-list-jobs/:id/manual-package", asyncRoute(async (req, res) => {
  if (!await getScopedAutoListingJob(req.params.id, req)) { res.status(404).json({ error: "未找到铺货记录", reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" }); return; }
  const result = await saveManualPackageEvidence(req.params.id, req.body || {});
  if (!result.ok) {
    res.status(result.reasonCode === "AUTO_LISTING_JOB_NOT_FOUND" ? 404 : 400).json(result);
    return;
  }
  res.json({
    ...result,
    sideEffect: "仅保存人工实测或供应商包装资料到本地草稿并更新工作流；未调用 Ozon、未提交商品。",
  });
}));

async function readAutoListingProductStatus({ storeId = "", environment = "", offers = [] } = {}) {
  const requestedEnvironment = String(environment || "").trim();
  if (requestedEnvironment.length < 3) throw new Error("READ_OPERATOR_ENVIRONMENT_REQUIRED");
  const store = getStore(storeId);
  const offerIds = (offers || []).map((offer) => String(offer.offerId || offer.offer_id || "").trim()).filter(Boolean);
  if (!store) throw new Error("READ_OPERATOR_STORE_REQUIRED");
  if (!offerIds.length) return { products: [], readAttempt: { requestedOfferCount: 0, endpointAttempts: [], endpointFailures: [], checkedAt: new Date().toISOString() } };
  const boundedOfferIds = offerIds.slice(0, 100);
  const endpointAttempts = [];
  const checkedAt = new Date().toISOString();
  let listResponse;
  let detailResponse;
  const endpointFailures = [];
  endpointAttempts.push("/v3/product/list");
  try {
    listResponse = await ozonRequest(store, "/v3/product/list", { filter: { offer_id: boundedOfferIds, visibility: "ALL" }, limit: boundedOfferIds.length, last_id: "" });
  } catch (_error) {
    endpointFailures.push({ endpoint: "/v3/product/list", reasonCode: "READ_FAILED" });
  }
  endpointAttempts.push("/v3/product/info/list");
  try {
    detailResponse = await ozonRequest(store, "/v3/product/info/list", { offer_id: boundedOfferIds });
  } catch (_error) {
    endpointFailures.push({ endpoint: "/v3/product/info/list", reasonCode: "READ_FAILED" });
  }
  if (!listResponse && !detailResponse) {
    const error = new Error("商品只读回查失败");
    error.readAttempt = { requestedOfferCount: boundedOfferIds.length, endpointAttempts, endpointFailures, checkedAt };
    throw error;
  }
  return {
    listResponse,
    detailResponse,
    readAttempt: {
      checkedAt,
      environment: requestedEnvironment,
      requestedOfferCount: boundedOfferIds.length,
      endpointAttempts,
      endpointFailures,
      operationEvidence: [
        ...(listResponse ? [buildOperationEvidenceRecord({ operationPath: "/v3/product/list", checkedAt, statusCode: 200, response: listResponse, verificationLevel: "server_observed", source: "product-readiness" })] : []),
        ...(detailResponse ? [buildOperationEvidenceRecord({ operationPath: "/v3/product/info/list", checkedAt, statusCode: 200, response: detailResponse, verificationLevel: "server_observed", source: "product-readiness" })] : []),
      ],
    },
  };
}

app.get("/api/ozon-learning/auto-list-jobs/:id/product-readiness", asyncRoute(async (req, res) => {
  // Product readiness is a server-observed Seller read.  Do not infer its
  // environment from deployment defaults: an omitted environment could
  // otherwise bind an old task response to the wrong local/staging scope.
  const environment = String(req.query.environment || "").trim();
  if (environment.length < 3) {
    res.status(400).json({ ok: false, reasonCode: "READ_OPERATOR_ENVIRONMENT_REQUIRED", diagnosticCode: "READ_OPERATOR_ENVIRONMENT_INVALID", message: "必须提供有效的读取环境标识。" });
    return;
  }
  const sessionGate = controlledReadSessionBlock(req, environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控只读会话；未解析店铺凭据、未联网、未读取 Ozon。" });
    return;
  }
  const job = await getScopedAutoListingJob(req.params.id, req);
  if (!job) {
    res.status(404).json({ error: "未找到铺货记录", reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" });
    return;
  }
  const result = await inspectAutoListingProductReadiness(job, {
    readProductStatus: (input) => readAutoListingProductStatus({
      ...input,
      environment,
      storeId: String(job.listingResult?.storeId || job.storeId || "").trim(),
    }),
  });
  res.json({
    ok: true,
    storeId: String(job.listingResult?.storeId || job.storeId || "").trim(),
    environment,
    verificationLevel: "locally_tested",
    liveReadObserved: result.evidenceSummary?.readStatus === "completed"
      && result.evidenceSummary?.requestedOfferCount > 0
      && result.evidenceSummary?.coverageComplete === true
      && result.evidenceSummary?.endpointAttempted === true,
    environmentRefHash: scopeHash(environment),
    ...result,
  });
}));

// Local-only operator gate: validate the intended store/environment/scope and
// allowlisted endpoints before the separate receipt action can perform a
// server-side read.  This route never loads credentials, calls Ozon, or writes
// a receipt; the summary deliberately omits confirmation tokens and raw IDs.
app.post("/api/ozon-learning/readiness-evidence-receipts/plan", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const plan = body.plan && typeof body.plan === "object" && !Array.isArray(body.plan)
    ? body.plan
    : body;
  const summary = buildReadOperatorPlanSummary(plan);
  res.status(summary.ok ? 200 : 400).json({
    ok: summary.ok,
    plan: summary,
    planBinding: summary.ok ? buildReadOperatorPlanBinding(plan) : "",
    verificationLevel: "locally_tested",
    sideEffect: summary.sideEffect,
  });
}));

app.post("/api/ozon/read-operator/category-plan", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const plan = body.categoryPlan && typeof body.categoryPlan === "object" && !Array.isArray(body.categoryPlan)
    ? body.categoryPlan : body;
  const summary = buildCategoryReadPlanSummary(plan);
  res.status(summary.ok ? 200 : 400).json({
    ok: summary.ok,
    plan: summary,
    planBinding: summary.ok ? buildCategoryReadPlanBinding(plan) : "",
    requests: summary.ok ? buildCategoryReadRequests(plan).requests : [],
    verificationLevel: "locally_tested",
    sideEffect: summary.sideEffect,
  });
}));

app.post("/api/ozon/read-operator/category-execute", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const plan = body.categoryPlan && typeof body.categoryPlan === "object" && !Array.isArray(body.categoryPlan)
    ? body.categoryPlan : null;
  if (body.recordEvidence !== true || String(body.confirm || "") !== LIVE_CONFIRMATION) {
    res.status(400).json({ ok: false, reasonCode: "CATEGORY_READ_CONFIRMATION_REQUIRED" });
    return;
  }
  const validation = validateCategoryReadPlan(plan || {});
  const binding = validateCategoryReadPlanBinding(plan || {}, body.planBinding);
  const bodyStoreId = String(body.storeId || "").trim();
  if (!plan || !validation.ok || !binding.ok || !bodyStoreId || bodyStoreId !== validation.storeId) {
    res.status(400).json({ ok: false, reasonCode: !plan || !body.planBinding ? "CATEGORY_READ_PLAN_BINDING_REQUIRED" : "CATEGORY_READ_PLAN_BINDING_MISMATCH", errors: validation.errors });
    return;
  }
  const sessionGate = controlledReadSessionBlock(req, validation.environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控类目只读会话；未调用 Seller API。" });
    return;
  }
  const store = getStore(validation.storeId);
  const requests = buildCategoryReadRequests(plan).requests;
  const cache = await loadCategoryCache();
  const environmentRefHash = scopeHash(validation.environment);
  const observations = [];
  let nextCache = { ...cache, storeId: store.id, categoryReadEvidence: { ...(cache.categoryReadEvidence || {}) } };
  for (const request of requests) {
    try {
      const data = await ozonRequest(store, request.endpoint, request.body, { maxRetries: 0, retrySafe: true });
      const operationEvidence = {
        ...buildOperationEvidenceRecord({
          operationPath: request.endpoint,
          checkedAt: new Date().toISOString(),
          statusCode: 200,
          response: data,
          verificationLevel: "server_observed",
          source: "controlled-category-read",
        }),
        storeId: store.id,
        environmentRefHash,
        ...(request.key === "attributes" || request.key === "values" ? { cacheKey: `${validation.descriptionCategoryId}:${validation.typeId}${request.key === "values" ? `:${request.attributeId}:${validation.language}` : ""}` } : {}),
      };
      const valuesRead = request.key === "values" ? classifyCategoryValuesResponse(data) : null;
      observations.push({
        key: request.key,
        attributeId: request.attributeId || 0,
        endpoint: request.endpoint,
        status: valuesRead ? valuesRead.status : "success",
        ...(valuesRead ? { paginationComplete: valuesRead.paginationComplete, hasNext: valuesRead.hasNext } : {}),
        operationEvidence: {
          ...operationEvidence,
          ...(valuesRead ? { paginationComplete: valuesRead.paginationComplete, hasNext: valuesRead.hasNext } : {}),
        },
      });
      if (request.key === "tree") {
        const tree = data.result || [];
        nextCache = { ...nextCache, updatedAt: new Date().toISOString(), tree, flat: flattenCategories(tree), categoryReadEvidence: { ...nextCache.categoryReadEvidence, tree: operationEvidence } };
      } else if (request.key === "attributes") {
        const cacheKey = `${validation.descriptionCategoryId}:${validation.typeId}`;
        nextCache = {
          ...nextCache,
          attributeStores: { ...(nextCache.attributeStores || {}), [cacheKey]: store.id },
          attributeUpdatedAt: { ...(nextCache.attributeUpdatedAt || {}), [cacheKey]: new Date().toISOString() },
          attributes: { ...(nextCache.attributes || {}), [cacheKey]: data.result || [] },
          categoryReadEvidence: { ...nextCache.categoryReadEvidence, attributes: { ...(nextCache.categoryReadEvidence?.attributes || {}), [cacheKey]: operationEvidence } },
        };
      } else if (request.key === "values" && valuesRead?.paginationComplete) {
        const cacheKey = `${validation.descriptionCategoryId}:${validation.typeId}:${request.attributeId}:${validation.language}`;
        nextCache = {
          ...nextCache,
          attributeValues: {
            ...(nextCache.attributeValues || {}),
            [cacheKey]: {
              storeId: store.id,
              descriptionCategoryId: validation.descriptionCategoryId,
              typeId: validation.typeId,
              attributeId: request.attributeId,
              language: validation.language,
              updatedAt: new Date().toISOString(),
              values: Array.isArray(data.result) ? data.result : [],
            },
          },
          categoryReadEvidence: {
            ...nextCache.categoryReadEvidence,
            attributeValues: { ...(nextCache.categoryReadEvidence?.attributeValues || {}), [cacheKey]: operationEvidence },
          },
        };
      } else if (request.key === "values") {
        // A partial/malformed page must not leave an older complete-looking
        // dictionary in the cache for the same scope.
        const cacheKey = `${validation.descriptionCategoryId}:${validation.typeId}:${request.attributeId}:${validation.language}`;
        const attributeValues = { ...(nextCache.attributeValues || {}) };
        const attributeEvidence = { ...(nextCache.categoryReadEvidence?.attributeValues || {}) };
        delete attributeValues[cacheKey];
        delete attributeEvidence[cacheKey];
        nextCache = {
          ...nextCache,
          attributeValues,
          categoryReadEvidence: { ...nextCache.categoryReadEvidence, attributeValues: attributeEvidence },
        };
      }
    } catch (error) {
      observations.push({ key: request.key, attributeId: request.attributeId || 0, endpoint: request.endpoint, status: "failed", reasonCode: String(error?.code || "CATEGORY_READ_FAILED").slice(0, 80) });
    }
  }
  await saveCategoryCache(nextCache);
  const failures = observations.filter((item) => item.status !== "success");
  // The category plan has its own validation/binding shape and does not carry
  // the generic read-operator `endpoints`/scope fields. Project it into the
  // durable receipt contract explicitly; otherwise a successful category
  // read would be unable to persist a server-observed receipt.
  const categoryReceiptPlan = {
    ...plan,
    endpoints: requests.map((request) => request.endpoint),
    scope: {
      name: "category_read",
      offerCount: requests.length,
      descriptionCategoryId: validation.descriptionCategoryId,
      typeId: validation.typeId,
      attributeIds: validation.attributeIds,
    },
  };
  const categorySessionReceiptBinding = {
    signedSessionBound: true,
    authSource: String(req.authSource || "").trim(),
    sessionRefHash: scopeHash({
      storeIds: parseStoreScope(req.authPrincipal?.storeIds || "").sort(),
      environment: String(req.authPrincipal?.environment || req.authPrincipal?.sessionEnvironment || validation.environment || "").trim(),
    }),
  };
  const categoryReceipt = await readOperatorReceipts.record(categoryReceiptPlan, {
    storeRef: scopeHash(validation.storeId),
    environmentRef: environmentRefHash,
    scopeRef: scopeHash(categoryReceiptPlan.scope),
    ...categorySessionReceiptBinding,
    ok: failures.length === 0,
    status: failures.length ? "partial" : "completed",
    readSucceeded: failures.length === 0,
    observedFailure: failures.length > 0,
    failureScenario: failures.length ? "category_read_partial" : "",
    endpointCoverageComplete: failures.length === 0,
    endpoints: observations.map((item) => item.endpoint),
    operationEvidence: observations.flatMap((item) => item.operationEvidence ? [item.operationEvidence] : []),
    observedAt: new Date().toISOString(),
    readOnly: true,
    writeAttempted: false,
  });
  res.json({
    ok: failures.length === 0,
    status: failures.length ? "partial" : "success",
    observations: observations.map((item) => ({ key: item.key, attributeId: item.attributeId, endpoint: item.endpoint, status: item.status, reasonCode: item.reasonCode || "", operationEvidence: item.operationEvidence || null })),
    ...(categoryReceipt.ok ? { receipt: categoryReceipt.receipt, sellerTask: buildReadFailureSellerTask(categoryReceipt.receipt) } : {}),
    reasonCode: failures.length ? "CATEGORY_READ_EVIDENCE_PARTIAL" : "",
    verificationLevel: "server_observed",
    sideEffect: "仅执行类目/属性白名单只读请求并保存脱敏 operation evidence；未调用写接口。",
    nextAction: failures.length ? "按失败端点重新执行同一计划，不要把部分回执当作完整类目证据。" : "回到黄金商品预检，确认类目/type 与属性覆盖后再人工确认。",
  });
}));

// General controlled Seller API read.  The caller submits only an explicitly
// bound plan; the server resolves credentials, invokes the allowlisted reader,
// hashes bounded observations, and persists the resulting server-observed
// receipt.  A client cannot turn a local JSON artifact into this evidence.
app.post("/api/ozon/read-operator/execute", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const plan = body.operatorPlan && typeof body.operatorPlan === "object" && !Array.isArray(body.operatorPlan)
    ? body.operatorPlan : null;
  if (body.recordEvidence !== true) {
    res.status(400).json({ ok: false, reasonCode: "READ_OPERATOR_CONFIRMATION_REQUIRED" });
    return;
  }
  const planValidation = validateReadOperatorPlan(plan || {});
  const planBinding = validateReadOperatorPlanBinding(plan || {}, body.planBinding);
  const bodyStoreId = String(body.storeId || "").trim();
  const plannedStoreId = String(plan?.store?.id || plan?.store?.clientId || "").trim();
  if (!plan || !planValidation.ok || !planBinding.ok || !bodyStoreId || bodyStoreId !== plannedStoreId) {
    res.status(400).json({ ok: false, reasonCode: !plan || !body.planBinding ? "READ_OPERATOR_PLAN_BINDING_REQUIRED" : "READ_OPERATOR_PLAN_BINDING_MISMATCH" });
    return;
  }
  if (String(body.confirm || "") !== LIVE_CONFIRMATION || String(plan.confirm || "") !== LIVE_CONFIRMATION) {
    res.status(400).json({ ok: false, reasonCode: "READ_OPERATOR_CONFIRMATION_REQUIRED" });
    return;
  }
  const sessionGate = controlledReadSessionBlock(req, plan.environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控 Seller API 会话；未解析店铺凭据、未调用 Ozon。" });
    return;
  }
  // Bind the durable receipt to the signed session class and its bounded
  // principal scope without persisting a cookie, bearer token, or secret.
  // The session proof endpoint uses the same scope/environment projection;
  // this keeps a successful server-observed receipt auditable after the
  // request itself has completed.
  const signedSessionReceiptBinding = {
    signedSessionBound: true,
    authSource: String(req.authSource || "").trim(),
    sessionRefHash: scopeHash({
      storeIds: parseStoreScope(req.authPrincipal?.storeIds || "").sort(),
      environment: String(req.authPrincipal?.environment || req.authPrincipal?.sessionEnvironment || plan.environment || "").trim(),
    }),
  };
  // Persist failed executions too.  A credential/store resolution failure or
  // reader exception is still server-observed evidence of this exact bound
  // plan; dropping it would leave the operator unable to distinguish "never
  // attempted" from "attempted and failed".  The repository only stores
  // hashes and bounded failure metadata, never credentials or raw responses.
  const persistFailure = async (failureResult, reasonCode, message, statusCode = 502) => {
    const recorded = await readOperatorReceipts.record(plan, {
      ...failureResult,
      ...signedSessionReceiptBinding,
      readSucceeded: false,
      observedFailure: true,
      failureScenario: failureResult.failureScenario || "observed_read_failure",
      readOnly: true,
      writeAttempted: false,
      observedAt: failureResult.observedAt || new Date().toISOString(),
    });
    if (!recorded.ok) {
      res.status(recorded.status || 400).json(recorded);
      return;
    }
    res.status(statusCode).json({
      ok: false,
      reasonCode,
      message,
      receipt: recorded.receipt,
      report: buildReadOperatorReport(plan, recorded.receipt),
      verificationLevel: "server_observed",
      sideEffect: "仅保存本次受控只读失败的脱敏回执；未调用写接口、未修改商品或店铺数据。",
      sellerTask: buildReadFailureSellerTask(recorded.receipt),
    });
  };
  let store;
  try {
    store = getStore(plannedStoreId);
  } catch (error) {
    await persistFailure({
      storeRef: scopeHash(plannedStoreId),
      environmentRef: scopeHash(plan.environment),
      scopeRef: scopeHash(plan.scope),
      errorType: String(error?.code || "STORE_RESOLUTION_FAILED").slice(0, 80),
      failureScenario: "store_resolution_failed",
      observations: [],
    }, "READ_OPERATOR_STORE_RESOLUTION_FAILED", "店铺凭据未能由服务端解析，本次读取未执行；请修复店铺配置后按原计划重试。");
    return;
  }
  const result = await runReadVerification({
    store,
    environment: plan.environment,
    scope: plan.scope,
    mode: "live_read",
    confirm: LIVE_CONFIRMATION,
    request: (endpoint, options = {}) => ozonRequest(store, endpoint, options.body || {}, { maxRetries: 0, retrySafe: true }),
    reader: async ({ readRequest, scope }) => {
      const observations = [];
      let discoveredOfferIds = Array.isArray(scope.offerIds) ? scope.offerIds : [];
      let discoveredProductIds = Array.isArray(scope.productIds) ? scope.productIds : [];
      // Plan validation sorts endpoint names for a stable binding. Restore
      // prerequisite order at execution time so product list discovery runs
      // before detail/stock fan-out. Otherwise the lexicographically sorted
      // detail endpoint is blocked for missing identifiers and a first live
      // replay is reported as partial even when the seller supplied a valid
      // offer scope.
      for (const endpoint of orderReadEndpoints(planValidation.endpoints)) {
        const requestContract = buildReadEndpointRequest(endpoint, {
          ...scope,
          offerIds: discoveredOfferIds,
          productIds: discoveredProductIds,
          limit: scope.offerCount || 100,
        });
        if (!requestContract.ok) {
          observations.push({
            endpoint,
            status: "blocked",
            statusCode: 422,
            responseSummary: { code: requestContract.reasonCode },
          });
          continue;
        }
        try {
          const response = await readRequest(endpoint, {
            method: "POST",
            body: requestContract.body,
          });
          const identifiers = extractBoundedProductIdentifiers(response);
          if (identifiers.offerIds.length) discoveredOfferIds = identifiers.offerIds;
          if (identifiers.productIds.length) discoveredProductIds = identifiers.productIds;
          observations.push({ endpoint, status: "success", responseSummary: { keyCount: Object.keys(response || {}).length, pagination: requestContract.pagination || "" } });
        } catch (error) {
          observations.push({ endpoint, status: Number(error?.status) || "failed", responseSummary: { code: String(error?.code || "READ_FAILED") } });
        }
      }
      return { observations };
    },
  });
  if (!result.ok) {
    await persistFailure(result, result.reasonCode || "READ_OPERATOR_EXECUTION_FAILED", result.message || "受控只读读取失败，已保存服务端失败回执。", 502);
    return;
  }
  const recorded = await readOperatorReceipts.record(plan, { ...result, ...signedSessionReceiptBinding });
  if (!recorded.ok) {
    res.status(recorded.status || 400).json(recorded);
    return;
  }
  res.json({
    ok: true,
    receipt: recorded.receipt,
    report: buildReadOperatorReport(plan, recorded.receipt),
    sellerTask: buildReadFailureSellerTask(recorded.receipt),
    verificationLevel: "server_observed",
    sideEffect: "仅执行白名单 Seller API 只读请求并保存脱敏哈希回执；未调用写接口、未修改商品或店铺数据。",
  });
}));

app.get("/api/ozon/read-operator/receipts", asyncRoute(async (req, res) => {
  const environment = String(req.query.environment || "").trim();
  const storeRefHash = String(req.query.storeRefHash || "").trim();
  if (environment.length < 3) {
    res.status(400).json({ ok: false, reasonCode: "READ_OPERATOR_ENVIRONMENT_REQUIRED", sellerTask: { status: "needs_review", code: "READ_OPERATOR_ENVIRONMENT_REQUIRED", nextAction: "指定当前读取环境后再查看回执。" } });
    return;
  }
  if (!storeRefHash) {
    res.status(400).json({ ok: false, reasonCode: "READ_OPERATOR_STORE_SCOPE_REQUIRED", sellerTask: { status: "needs_review", code: "READ_OPERATOR_STORE_SCOPE_REQUIRED", nextAction: "选择当前店铺后再查看只读回执；不能汇总多个店铺的证据。" }, sideEffect: "仅校验回执查询范围；不会联网或写入 Ozon。" });
    return;
  }
  const requestedMaxAgeMs = Number(req.query.maxAgeMs || 60 * 60 * 1000);
  const maxAgeMs = Math.min(7 * 24 * 60 * 60 * 1000, Math.max(60 * 1000, Number.isFinite(requestedMaxAgeMs) ? requestedMaxAgeMs : 60 * 60 * 1000));
  if (storeRefHash && !/^sha256:[a-f0-9]{64}$/i.test(storeRefHash)) {
    res.status(400).json({ ok: false, reasonCode: "READ_OPERATOR_STORE_SCOPE_INVALID", sideEffect: "仅校验回执查询范围；不会联网或写入 Ozon。" });
    return;
  }
  const storeScope = receiptStoreScopeDecision(req, storeRefHash);
  if (!storeScope.allowed) {
    res.status(403).json({ ok: false, reasonCode: storeScope.reasonCode, error: "当前 ERP 会话未获准查看这些店铺的只读回执。", sideEffect: "仅校验回执店铺范围；不会联网或写入 Ozon。" });
    return;
  }
  const receipts = await readOperatorReceipts.list();
  const environmentRefHash = environment ? scopeHash(environment) : "";
  const scoped = receipts.filter((receipt) => (
    (!environmentRefHash || receipt.environmentRefHash === environmentRefHash)
    && (!storeRefHash || receipt.storeRefHash === storeRefHash)
    && (!storeScope.hashes.size || storeScope.hashes.has(receipt.storeRefHash))
  ));
  const countScope = "current_environment_and_store";
  res.json({
    ok: true,
    receiptCount: scoped.length,
    countScope,
    latest: scoped.slice().sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt))).slice(0, 1).map((receipt) => ({
      ...(() => {
        const checkedAtMs = Date.parse(String(receipt.checkedAt || ""));
        const ageMs = Number.isFinite(checkedAtMs) ? Math.max(0, Date.now() - checkedAtMs) : null;
        const stale = ageMs === null || ageMs > maxAgeMs;
        return { ageMs, stale, maxAgeMs };
      })(),
      id: String(receipt.id || ""),
      storeRefHash: String(receipt.storeRefHash || ""),
      environmentRefHash: String(receipt.environmentRefHash || ""),
      checkedAt: String(receipt.checkedAt || ""),
      status: String(receipt.status || "unknown"),
      endpoints: Array.isArray(receipt.endpoints) ? receipt.endpoints.slice(0, 10) : [],
      endpointCoverageComplete: receipt.endpointCoverageComplete === true,
      responseHash: String(receipt.responseHash || ""),
      sellerTask: (() => {
        const checkedAtMs = Date.parse(String(receipt.checkedAt || ""));
        const stale = !Number.isFinite(checkedAtMs) || Date.now() - checkedAtMs > maxAgeMs;
        return stale
          ? { status: "needs_review", code: "READ_EVIDENCE_STALE", title: "只读回执已过期", nextAction: "按同一店铺、环境和读取范围重新执行受控只读读取；不要把过期回执当作当前状态。", sideEffect: "仅重新读取和保存脱敏证据，不会写入 Ozon。" }
          : buildReadFailureSellerTask(receipt);
      })(),
    }))[0] || null,
    verificationLevel: "server_observed",
    sideEffect: "仅读取本地脱敏回执；不会联网或写入 Ozon。",
  });
}));

app.post("/api/ozon-learning/readiness-evidence-receipts", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  if (body.recordEvidence !== true) {
    res.status(400).json({ ok: false, reasonCode: "READINESS_EVIDENCE_CONFIRMATION_REQUIRED" });
    return;
  }
  const environment = String(body.environment || "").trim();
  if (!environment) {
    res.status(400).json({ ok: false, reasonCode: "READINESS_EVIDENCE_ENVIRONMENT_REQUIRED" });
    return;
  }
  const sessionGate = controlledReadSessionBlock(req, environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控就绪只读会话；未读取 Ozon、未保存商品写入。" });
    return;
  }
  const jobId = String(body.jobId || "").trim();
  const job = jobId ? await getScopedAutoListingJob(jobId, req) : null;
  if (!job) {
    res.status(404).json({ ok: false, reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" });
    return;
  }
  // The local plan gate and persistence action are one binding chain.  A
  // caller must submit the exact approved plan and its hash; otherwise a plan
  // validated for one store/scope cannot be reused to save another receipt.
  const operatorPlan = body.operatorPlan && typeof body.operatorPlan === "object" && !Array.isArray(body.operatorPlan)
    ? body.operatorPlan
    : null;
  const planValidation = validateReadOperatorPlan(operatorPlan || {});
  const planBinding = validateReadOperatorPlanBinding(operatorPlan || {}, body.planBinding);
  const jobStoreId = String(job.storeId || job.store?.id || "").trim();
  const plannedStoreId = String(operatorPlan?.store?.id || operatorPlan?.store?.clientId || "").trim();
  if (String(operatorPlan?.environment || "").trim() !== environment) {
    res.status(400).json({ ok: false, reasonCode: "READINESS_EVIDENCE_ENVIRONMENT_MISMATCH", nextAction: "使用与已批准只读计划完全一致的环境标识。" });
    return;
  }
  if (!operatorPlan || !planValidation.ok || !planBinding.ok || !jobStoreId || plannedStoreId !== jobStoreId) {
    res.status(400).json({ ok: false, reasonCode: !operatorPlan || !body.planBinding ? "READ_OPERATOR_PLAN_BINDING_REQUIRED" : "READ_OPERATOR_PLAN_BINDING_MISMATCH" });
    return;
  }
  const inspection = await inspectAutoListingProductReadiness(job, {
    readProductStatus: readAutoListingProductStatus,
  });
  const recorded = await readinessEvidenceReceipts.recordServerObservation({
    recordEvidence: true,
    inspection,
    environment,
    endpointVersions: ["/v3/product/list", "/v3/product/info/list"],
    requestScope: "single_auto_listing_job",
  });
  if (!recorded.ok) {
    res.status(recorded.status || 400).json(recorded);
    return;
  }
  const receipts = await readinessEvidenceReceipts.list();
  const storeId = jobStoreId;
  res.json({
    ok: true,
    receipt: recorded.receipt,
    sellerTask: buildReadFailureSellerTask(recorded.receipt),
    verification: evaluateRealReadVerification(receipts, { environment, storeId, maxAgeMs: READINESS_RECEIPT_MAX_AGE_MS }),
    freshness: { maxAgeMs: READINESS_RECEIPT_MAX_AGE_MS, stale: false },
    sideEffect: "执行一次受限 Ozon 只读回查并保存脱敏本地回执；未调用 Ozon 写接口、未修改商品状态。",
  });
}));

app.get("/api/ozon-learning/readiness-evidence-receipts", asyncRoute(async (req, res) => {
  const environment = String(req.query.environment || "").trim();
  const storeId = String(req.query.storeId || "").trim();
  if (environment.length < 3) {
    res.status(400).json({ ok: false, reasonCode: "READINESS_EVIDENCE_ENVIRONMENT_REQUIRED", error: "读取就绪回执必须绑定明确环境。", sideEffect: "仅校验请求范围；不会联网或写入 Ozon。" });
    return;
  }
  if (!storeId) {
    res.status(400).json({ ok: false, reasonCode: "READINESS_EVIDENCE_STORE_REQUIRED", error: "读取就绪回执必须绑定明确店铺。", sideEffect: "仅校验请求范围；不会联网或写入 Ozon。" });
    return;
  }
  const requestedStoreRefHash = storeId ? scopeHash(storeId) : "";
  const storeScope = receiptStoreScopeDecision(req, requestedStoreRefHash);
  if (!storeScope.allowed) {
    res.status(403).json({ ok: false, reasonCode: storeScope.reasonCode, error: "当前 ERP 会话未获准查看这些店铺的就绪回执。", sideEffect: "仅校验就绪回执店铺范围；不会联网或写入 Ozon。" });
    return;
  }
  const receipts = await readinessEvidenceReceipts.list();
  const maxAgeMs = readinessReceiptMaxAgeMs(req.query.maxAgeMs);
  const verification = evaluateRealReadVerification(receipts, { environment, storeId, maxAgeMs });
  const environmentRef = verification.environmentRef;
  const latest = receipts
    .filter((receipt) => receipt?.persisted === true
      && receipt?.origin === "server_observed"
      && receipt?.environmentDeclared === true
      && receipt?.environmentRef === environmentRef
      && (!storeId || receipt?.storeRef === verification.storeRef)
      && (!storeScope.hashes.size || storeScope.hashes.has(String(receipt?.storeRef || "")))
      && typeof receipt?.checkedAt === "string"
      && receipt.checkedAt)
    .sort((left, right) => String(right.checkedAt).localeCompare(String(left.checkedAt)))[0];
  res.json({
    verification,
    receiptCount: verification.persistedCount,
    countScope: "eligible_server_observed_current_environment",
    environmentRefSemantics: "去标识环境分区键；普通 SHA-256 不提供秘密保护。",
    latestReceipt: latest ? {
      // Only bounded, already-sanitized receipt fields are exposed.  Store/job
      // identifiers and response bodies never leave the hash-only receipt.
      storeRef: String(latest.storeRef || ""),
      jobRef: String(latest.jobRef || ""),
      environmentRef: String(latest.environmentRef || environmentRef),
      checkedAt: latest.checkedAt,
      success: latest.success === true,
      readStatus: ["completed", "partial", "dependency_failed", "dependency_not_provided", "no_offers", "unknown"].includes(latest.readStatus)
        ? latest.readStatus : "unknown",
      state: ["accepted", "imported", "pending_moderation", "moderation_failed", "ready_for_sale", "unknown"].includes(latest.state)
        ? latest.state : "unknown",
      live: latest.live === true,
      requestedOfferCount: Number.isFinite(Number(latest.requestedOfferCount))
        ? Math.max(0, Math.min(100, Number(latest.requestedOfferCount))) : 0,
      coverageComplete: latest.coverageComplete === true,
      endpointVersions: Array.isArray(latest.endpointVersions)
        ? latest.endpointVersions.map(String).slice(0, 10) : [],
      endpointAttempts: Array.isArray(latest.endpointAttempts)
        ? latest.endpointAttempts.map(String).slice(0, 10) : [],
      failureScenario: String(latest.failureScenario || "").slice(0, 80),
      failureEvidence: Array.isArray(latest.failureEvidence)
        ? latest.failureEvidence.slice(0, 10).map((entry) => ({
          endpoint: String(entry?.endpoint || "").slice(0, 160),
          reasonCode: String(entry?.reasonCode || "").slice(0, 80),
          ...(Number.isInteger(Number(entry?.statusCode)) ? { statusCode: Number(entry.statusCode) } : {}),
        })) : [],
      operationEvidence: Array.isArray(latest.operationEvidence)
        ? latest.operationEvidence.slice(0, 10).map((entry) => ({
          operationPath: String(entry?.operationPath || "").slice(0, 160),
          responseHash: String(entry?.responseHash || "").slice(0, 80),
          verificationLevel: String(entry?.verificationLevel || "").slice(0, 40),
        })) : [],
      responseHash: String(latest.responseHash || "").slice(0, 80),
      sellerTask: buildReadFailureSellerTask(latest),
      stale: (() => {
        const checkedAtMs = new Date(latest.checkedAt).getTime();
        return !Number.isFinite(checkedAtMs) || checkedAtMs > Date.now() || Date.now() - checkedAtMs > maxAgeMs;
      })(),
    } : null,
    freshness: {
      maxAgeMs,
      staleCount: verification.staleCount,
      note: "过期回执保留用于审计，但不能升级真实回查验证或库存就绪。",
    },
  });
}));

app.post("/api/ozon-learning/reconcile-submitted", asyncRoute(async (req, res) => {
  // Compatibility audit expressions remain explicit: jobId: String(req.body?.jobId || ""), taskId: Number(req.body?.taskId || 0)
  const body = parseBody(req.body);
  const environment = requestReadEnvironment(req, body);
  if (environment.length < 3) {
    res.status(400).json({ ok: false, reasonCode: "READ_OPERATOR_ENVIRONMENT_REQUIRED", message: "审核回读必须绑定明确的读取环境。", sideEffect: "未解析店铺凭据、未调用 Ozon、未更新任务。" });
    return;
  }
  const sessionGate = controlledReadSessionBlock(req, environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控审核回读会话；未解析店铺凭据、未调用 Ozon。" });
    return;
  }
  const jobId = String(body.jobId || "").trim();
  if (!jobId) {
    res.status(400).json({ ok: false, reasonCode: "RECONCILE_JOB_SCOPE_REQUIRED", message: "审核回读必须指定单个铺货任务，不能扫描多个店铺。", sideEffect: "未调用 Ozon、未更新任务。" });
    return;
  }
  const requestedStoreId = String(body.storeId || req.storeScope?.storeId || "").trim();
  if (!requestedStoreId) {
    res.status(400).json({ ok: false, reasonCode: "RECONCILE_STORE_SCOPE_REQUIRED", message: "审核回读必须绑定单个店铺。", sideEffect: "未调用 Ozon、未更新任务。" });
    return;
  }
  const scopedJob = await getScopedAutoListingJob(jobId, req);
  if (!scopedJob) {
    res.status(404).json({ ok: false, reasonCode: "AUTO_LISTING_JOB_NOT_FOUND", message: "未找到当前会话可访问的铺货任务。", sideEffect: "未调用 Ozon、未更新任务。" });
    return;
  }
  const persistedStoreId = String(scopedJob.listingResult?.storeId || scopedJob.storeId || "").trim();
  if (!persistedStoreId || persistedStoreId !== requestedStoreId) {
    res.status(403).json({ ok: false, reasonCode: "RECONCILE_STORE_SCOPE_MISMATCH", message: "请求店铺与铺货任务所属店铺不一致。", sideEffect: "未调用 Ozon、未更新任务。" });
    return;
  }
  const data = await reconcileSubmittedJobs({
    limit: 1,
    jobId,
    taskId: Number(body.taskId || 0),
    storeId: persistedStoreId,
    environment,
    readProductStatus: readAutoListingProductStatus,
  });
  res.json({ ...data, sellerResult: data.sellerResult || buildSubmittedReconciliationSellerResult(data) });
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
  // This was the legacy learning/distributor write path.  It does not carry
  // the workflow draft hash, reservation/idempotency key, or the current
  // human-confirmation contract, so keeping it callable would allow a
  // second Ozon write path to bypass the seller-facing gate.  Leave the route
  // discoverable for old clients, but fail closed before any Ozon call.
  res.status(410).json({
    ok: false,
    reasonCode: "LEGACY_SUBMIT_PATH_DISABLED",
    error: "旧自动上架入口已停用；请从当前商品工作流完成预检、草稿 hash 确认后再提交。",
    nextAction: "打开上架草稿 → 运行预检 → 确认当前草稿 hash → 使用统一提交入口。",
    sideEffect: "本次请求未调用 Ozon、未修改商品、未创建提交任务。",
  });
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
  const job = await claimOzonLearningJob(String(req.query.workerId || ""), {
    storeId: String(req.query.storeId || ""),
    storeIds: req.authPrincipal?.storeIds,
    principalId: String(req.authPrincipal?.principalId || ""),
  });
  if (job?.scopeDenied) {
    res.status(403).json({ ok: false, scopeDenied: true, reasonCode: "OZON_LEARNING_STORE_SCOPE_DENIED" });
    return;
  }
  res.json({ job: job ? { ...job, kind: job.kind || job.type } : null });
}));

app.post("/api/ozon-learning/extension/search-result", asyncRoute(async (req, res) => {
  const data = await completeOzonSearchJob(req.body.jobId, req.body || {}, { storeIds: req.authPrincipal?.storeIds, principalId: String(req.authPrincipal?.principalId || "") });
  if (!data) {
    res.status(404).json({ error: "没有找到 Ozon 学习作业。" });
    return;
  }
  if (data.scopeDenied) {
    res.status(403).json({ ok: false, scopeDenied: true, reasonCode: "OZON_LEARNING_STORE_SCOPE_DENIED" });
    return;
  }
  res.json({ ok: true, ...data });
}));

app.post("/api/ozon-learning/extension/detail-result", asyncRoute(async (req, res) => {
  const data = await completeOzonDetailJob(req.body.jobId, req.body || {}, { storeIds: req.authPrincipal?.storeIds, principalId: String(req.authPrincipal?.principalId || "") });
  if (!data) {
    res.status(404).json({ error: "没有找到 Ozon 学习作业。" });
    return;
  }
  if (data.scopeDenied) {
    res.status(403).json({ ok: false, scopeDenied: true, reasonCode: "OZON_LEARNING_STORE_SCOPE_DENIED" });
    return;
  }
  res.json({ ok: true, ...data });
}));


app.post("/api/pipeline/run", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  const current = await getPipelineStatus();
  if (current.status === "running") {
    res.status(409).json({ ok: false, reasonCode: "PIPELINE_ALREADY_RUNNING", runId: current.runId || null });
    return;
  }
  const autoList = Boolean(body.autoList);
  if (autoList && body.confirmAutoList !== true) {
    res.status(400).json({
      ok: false,
      reasonCode: "PIPELINE_AUTOLIST_CONFIRMATION_REQUIRED",
      message: "自动匹配验证会调用 AI 并创建本地铺货结果，必须由操作者明确确认。",
    });
    return;
  }
  const result = await runFullPipeline({
    minScore: Number(body.minScore) || 30,
    maxTasks: Number(body.maxTasks) || 5,
    autoList,
  });
  res.json(result);
}));


app.post("/api/pipeline/status", asyncRoute(async (_req, res) => {
  // Keep the legacy POST alias read-only.  It used to overwrite the durable
  // status snapshot with `idle`, which could erase a running pipeline merely
  // because a dashboard refreshed its status.
  res.json(await getPipelineStatus());
}));

app.get("/api/pipeline/status", asyncRoute(async (_req, res) => {
  res.json(await getPipelineStatus());
}));

app.post("/api/pipeline/check-trigger", asyncRoute(async (_req, res) => {
  res.json(await checkAndTriggerPipeline());
}));

app.post("/api/ozon/test", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res, req.body)) return;
  const store = getStore(req.body.storeId);
  // Connectivity checks must use the same bounded Seller API warehouse
  // contract as the inventory/listing reads.  The old empty-body request
  // could return a misleading `ok` even when the current warehouse endpoint
  // required cursor/limit and the result was only a partial page.
  const paged = await readBoundedPages("/v2/warehouse/list", { cursor: "", limit: 200 }, {
    readEndpoint: (endpoint, payload) => ozonRequest(store, endpoint, payload),
  });
  const data = paged.data;
  const warehouseHasNext = paged.paginationComplete !== true;
  res.json({
    ok: true,
    store: publicStore(store),
    warehouses: summarizeWarehouses(data),
    operationEvidence: buildOperationEvidenceRecord({ operationPath: "/v2/warehouse/list", checkedAt: new Date().toISOString(), statusCode: 200, response: data, verificationLevel: "server_observed", source: "connectivity-read" }),
    readStatus: warehouseHasNext ? "partial" : "completed",
    hasNext: warehouseHasNext,
    pageCount: paged.pageCount,
    paginationComplete: paged.paginationComplete,
    paginationCursorRepeated: paged.paginationCursorRepeated,
    readOnly: true,
    sideEffect: "仅验证店铺并读取仓库列表；不会修改商品、价格、库存或订单。",
  });
}));

app.get("/api/ozon/warehouses", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res)) return;
  const store = getStore(String(req.query.storeId || ""));
  const initialPayload = {
    cursor: String(req.query.cursor || "").trim(),
    limit: Math.min(Math.max(Number(req.query.limit || 200), 1), 200),
  };
  const paged = await readBoundedPages("/v2/warehouse/list", initialPayload, {
    readEndpoint: (endpoint, payload) => ozonRequest(store, endpoint, payload),
  });
  const data = paged.data;
  const warehouses = summarizeWarehouses(data);
  const warehouseEnvelopeRecognized = Array.isArray(data?.warehouses) || Array.isArray(data?.result);
  const warehouseCursor = String(paged.nextCursor || "").trim();
  const warehouseHasNext = paged.paginationComplete !== true;
  const warehouseReadStatus = !warehouseEnvelopeRecognized ? "unknown" : warehouseHasNext ? "partial" : warehouses.length ? "completed" : "empty";
  res.json({
    storeId: store.id,
    warehouses,
    pageCount: paged.pageCount,
    paginationComplete: paged.paginationComplete,
    paginationCursorRepeated: paged.paginationCursorRepeated,
    nextCursor: warehouseCursor,
    operationEvidence: buildOperationEvidenceRecord({
      operationPath: "/v2/warehouse/list",
      checkedAt: new Date().toISOString(),
      statusCode: 200,
      response: data,
      verificationLevel: "server_observed",
      source: "warehouse-read",
    }),
    readStatus: warehouseReadStatus,
    hasNext: warehouseHasNext,
    missingEvidence: [
      ...(!warehouseEnvelopeRecognized ? ["warehouses_response"] : []),
      ...(warehouseHasNext ? ["pagination"] : []),
    ],
    readOnly: true,
    warehouseConclusion: warehouseReadStatus === "completed"
      ? "仅证明当前读取到仓库列表；仓库可用性和库存写入仍需逐项就绪检查。"
      : "本次仓库证据为空、不完整或格式未知，不能把它解释为没有可用仓库；请重新读取并检查分页。",
  });
}));

app.get("/api/ozon/description-categories", asyncRoute(async (req, res) => {
  const environment = String(req.query.environment || "").trim();
  const sessionGate = controlledReadSessionBlock(req, environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控类目只读会话；未解析店铺凭据、未调用 Seller API。" });
    return;
  }
  const store = getStore(String(req.query.storeId || ""));
  const environmentRefHash = scopeHash(environment);
  const refresh = String(req.query.refresh || "") === "1";
  const cache = await loadCategoryCache();
  const cacheFreshness = inspectCategoryCacheFreshness(cache);
  const cachedTreeEvidence = cache.categoryReadEvidence?.tree || null;
  if (!refresh && cache.storeId === store.id && cachedTreeEvidence?.storeId === store.id && cachedTreeEvidence?.environmentRefHash === environmentRefHash && cache.tree?.length && cacheFreshness.usable) {
    res.json({ result: cache.tree, cached: true, updatedAt: cache.updatedAt, cacheFreshness, operationEvidence: cache.categoryReadEvidence?.tree || null, total: cache.flat?.length || 0 });
    return;
  }
  const data = await ozonRequest(store, "/v1/description-category/tree", { language: "ZH_HANS" });
  const tree = data.result || [];
  const operationEvidence = buildOperationEvidenceRecord({
    operationPath: "/v1/description-category/tree",
    checkedAt: new Date().toISOString(),
    statusCode: 200,
    response: data,
    verificationLevel: "server_observed",
    source: "ozon-category-tree-read",
  });
  await saveCategoryCache({
    ...cache,
    updatedAt: new Date().toISOString(),
    storeId: store.id,
    tree,
    flat: flattenCategories(tree),
    categoryReadEvidence: {
      ...(cache.categoryReadEvidence || {}),
      tree: { ...operationEvidence, storeId: store.id, environmentRefHash },
    },
  });
  res.json({ ...data, operationEvidence: { ...operationEvidence, storeId: store.id, environmentRefHash } });
}));

app.post("/api/ozon/description-attributes", asyncRoute(async (req, res) => {
  const environment = String(req.body?.environment || "").trim();
  const sessionGate = controlledReadSessionBlock(req, environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控属性只读会话；未解析店铺凭据、未调用 Seller API。" });
    return;
  }
  const store = getStore(req.body.storeId);
  const environmentRefHash = scopeHash(environment);
  const descriptionCategoryId = Number(req.body.description_category_id);
  const typeId = Number(req.body.type_id);
  const cacheKey = `${descriptionCategoryId}:${typeId}`;
  const refresh = Boolean(req.body.refresh);
  const cache = await loadCategoryCache();
  const attributeFreshness = inspectCategoryCacheFreshness({ updatedAt: cache.attributeUpdatedAt?.[cacheKey] || "" });
  const cachedAttributeEvidence = cache.categoryReadEvidence?.attributes?.[cacheKey] || null;
  if (!refresh && cache.attributeStores?.[cacheKey] === store.id && cachedAttributeEvidence?.storeId === store.id && cachedAttributeEvidence?.environmentRefHash === environmentRefHash && cache.attributes?.[cacheKey] && attributeFreshness.usable) {
    res.json({ result: cache.attributes[cacheKey], cached: true, updatedAt: cache.attributeUpdatedAt[cacheKey], operationEvidence: cache.categoryReadEvidence?.attributes?.[cacheKey] || null, cacheFreshness: attributeFreshness });
    return;
  }
  const data = await ozonRequest(store, "/v1/description-category/attribute", {
    description_category_id: descriptionCategoryId,
    type_id: typeId,
    language: "ZH_HANS",
  });
  const operationEvidence = buildOperationEvidenceRecord({
    operationPath: "/v1/description-category/attribute",
    checkedAt: new Date().toISOString(),
    statusCode: 200,
    response: data,
    verificationLevel: "server_observed",
    source: "ozon-category-attribute-read",
  });
  await saveCategoryCache({
    ...cache,
    storeId: store.id,
    attributeStores: { ...(cache.attributeStores || {}), [cacheKey]: store.id },
    attributeUpdatedAt: { ...(cache.attributeUpdatedAt || {}), [cacheKey]: new Date().toISOString() },
    attributes: {
      ...(cache.attributes || {}),
      [cacheKey]: data.result || [],
    },
    categoryReadEvidence: {
      ...(cache.categoryReadEvidence || {}),
      attributes: {
        ...(cache.categoryReadEvidence?.attributes || {}),
        [cacheKey]: { ...operationEvidence, storeId: store.id, cacheKey, environmentRefHash },
      },
    },
  });
  res.json({ ...data, operationEvidence: { ...operationEvidence, storeId: store.id, cacheKey, environmentRefHash }, cacheFreshness: inspectCategoryCacheFreshness({ updatedAt: cache.attributeUpdatedAt?.[cacheKey] || new Date().toISOString() }) });
}));

app.post("/api/ozon/category-cache/refresh", asyncRoute(async (req, res) => {
  const environment = String(req.body?.environment || "").trim();
  const sessionGate = controlledReadSessionBlock(req, environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控类目刷新会话；未解析店铺凭据、未调用 Seller API。" });
    return;
  }
  const store = getStore(req.body.storeId);
  const environmentRefHash = scopeHash(environment);
  const data = await ozonRequest(store, "/v1/description-category/tree", { language: "ZH_HANS" });
  const tree = data.result || [];
  const flat = flattenCategories(tree);
  const operationEvidence = buildOperationEvidenceRecord({
    operationPath: "/v1/description-category/tree",
    checkedAt: new Date().toISOString(),
    statusCode: 200,
    response: data,
    verificationLevel: "server_observed",
    source: "ozon-category-tree-refresh",
  });
  const cache = await loadCategoryCache();
  await saveCategoryCache({
    ...cache,
    updatedAt: new Date().toISOString(),
    storeId: store.id,
    tree,
    flat,
    categoryReadEvidence: {
      ...(cache.categoryReadEvidence || {}),
      tree: { ...operationEvidence, storeId: store.id, environmentRefHash },
    },
  });
  res.json({ ok: true, total: flat.length, updatedAt: new Date().toISOString(), operationEvidence: { ...operationEvidence, storeId: store.id, environmentRefHash } });
}));

app.post("/api/ozon/category-match", asyncRoute(async (req, res) => {
  const store = getStore(String(req.body.storeId || ""));
  const cache = await loadCategoryCache();
  const cacheFreshness = inspectCategoryCacheFreshness(cache);
  if (cache.storeId !== store.id || !cache.flat?.length || !cacheFreshness.usable) {
    res.json({
      matches: [],
      cached: Boolean(cache.flat?.length),
      total: 0,
      updatedAt: cache.updatedAt,
      cacheFreshness,
      reasonCode: cache.storeId !== store.id ? "CATEGORY_CACHE_STORE_MISMATCH" : (cacheFreshness.reasonCode || "CATEGORY_CACHE_UNAVAILABLE"),
      nextAction: cacheFreshness.usable ? "先读取当前店铺的 Ozon 类目树，再执行类目匹配。" : "先刷新当前店铺的 Ozon 类目树，再执行类目匹配；不能把过期缓存当作当前类目证据。",
    });
    return;
  }
  const flat = cache.flat || flattenCategories(cache.tree || []);
  const matches = matchCategory(req.body.product || req.body, flat, Number(req.body.limit || 8));
  res.json({ matches, cached: Boolean(cache.tree?.length), total: flat.length, updatedAt: cache.updatedAt, cacheFreshness });
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
  const environment = String(req.body?.environment || "").trim();
  const sessionGate = controlledReadSessionBlock(req, environment);
  if (!sessionGate.allowed) {
    res.status(403).json({ ok: false, reasonCode: sessionGate.reasonCode, message: sessionGate.message, sideEffect: "仅校验受控字典只读会话；未解析店铺凭据、未调用 Seller API。" });
    return;
  }
  const store = getStore(req.body.storeId);
  const environmentRefHash = scopeHash(environment);
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
  const cachedValues = cache.attributeValues?.[cacheKey];
  const valueFreshness = inspectCategoryCacheFreshness({ updatedAt: cachedValues?.updatedAt || "" });
  const cachedValueEvidence = cache.categoryReadEvidence?.attributeValues?.[cacheKey] || null;
  if (!refresh && cachedValues?.storeId === store.id && cachedValueEvidence?.storeId === store.id && cachedValueEvidence?.environmentRefHash === environmentRefHash && Array.isArray(cachedValues?.values) && valueFreshness.usable) {
    res.json({
      result: cachedValues.values,
      cached: true,
      updatedAt: cachedValues.updatedAt,
      operationEvidence: cache.categoryReadEvidence?.attributeValues?.[cacheKey] || null,
      cacheKey,
      cacheFreshness: valueFreshness,
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
  const operationEvidence = buildOperationEvidenceRecord({
    operationPath: "/v1/description-category/attribute/values",
    checkedAt: new Date().toISOString(),
    statusCode: 200,
    response: data,
    verificationLevel: "server_observed",
    source: "ozon-category-attribute-values-read",
  });
  await upsertAttributeValuesCache({
    storeId: store.id,
    descriptionCategoryId,
    typeId,
    attributeId,
    language,
    values: data.result || [],
    operationEvidence: { ...operationEvidence, storeId: store.id, cacheKey, environmentRefHash },
  });
  res.json({ ...data, operationEvidence: { ...operationEvidence, storeId: store.id, cacheKey, environmentRefHash }, cached: false, cacheFreshness: inspectCategoryCacheFreshness({ updatedAt: new Date().toISOString() }) });
}));

app.get("/api/ozon/orders", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res)) return;
  const store = getStore(String(req.query.storeId || ""));
  const dates = defaultFbsDateRange();
  const filter = {
    since: String(req.query.since || dates.since),
    to: String(req.query.to || dates.to),
  };

  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.warehouseId) filter.warehouse_id = Number(req.query.warehouseId);

  const data = await ozonRequest(store, "/v4/posting/fbs/list", {
    cursor: String(req.query.cursor || ""),
    sort_dir: String(req.query.sortDir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC",
    filter,
    limit: Number(req.query.limit || 50),
  });

  res.json(data);
}));

async function readFbsOrderDashboardSnapshot(query = {}) {
  const store = getStore(String(query.storeId || ""));
  const dates = defaultFbsDateRange();
  const sinceDate = new Date(String(query.since || dates.since));
  const toDate = new Date(String(query.to || dates.to));
  if (!Number.isFinite(sinceDate.getTime()) || !Number.isFinite(toDate.getTime()) || sinceDate > toDate) {
    const error = new Error("订单读取日期范围无效。");
    error.status = 400;
    error.reasonCode = "FBS_ORDER_DATE_RANGE_INVALID";
    throw error;
  }
  const filter = {
    since: sinceDate.toISOString(),
    to: toDate.toISOString(),
  };
  if (query.status) filter.status = String(query.status);
  if (query.warehouseId) filter.warehouse_id = Number(query.warehouseId);

  const rawLimit = Number(query.limit || 100);
  const cursor = String(query.cursor || "").trim();
  const sortDir = String(query.sortDir || query.sort_dir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 100;
  const postingResponse = await ozonRequest(store, "/v4/posting/fbs/list", {
    cursor,
    sort_dir: sortDir,
    filter,
    limit,
  });
  const postings = postingResponse.result?.postings || postingResponse.postings || [];
  const offerIds = [...new Set(postings.flatMap((posting) => (posting.products || []).map((product) => product.offer_id)).filter(Boolean))];
  let productDetailResponse = { items: [] };
  let productDetailFailed = false;
  let productDetailBatchAttempts = [];
  if (offerIds.length) {
    const detailRead = await readFbsProductDetailsInBatches(offerIds, (batch) => (
      ozonRequest(store, "/v3/product/info/list", { offer_id: batch })
    ));
    productDetailResponse = { items: detailRead.items };
    productDetailBatchAttempts = detailRead.batchAttempts;
    productDetailFailed = detailRead.batchAttempts.length > 0
      && detailRead.batchAttempts.every((attempt) => attempt.status === "failed");
  }
  const model = buildFbsOrderReadModel({
    storeId: store.id,
    verificationLevel: "server_observed",
    postingResponse,
    productDetailResponse,
    productDetailFailed,
    productDetailBatchAttempts,
    checkedAt: new Date(),
    requestScope: {
      since: filter.since,
      to: filter.to,
      status: filter.status || "",
      warehouseId: filter.warehouse_id || null,
      limit,
      cursor,
      sortDir,
      pagination: "cursor",
    },
  });
  const filtered = filterFbsOrderReadModel(model, query.query);
  const financeReadModel = buildFinanceDomainReadModel({
    observationMode: "server_read",
    orders: filtered.orders,
    orderBatch: {
      loaded: true,
      failed: false,
      partial: filtered.partial === true,
      hasNext: filtered.hasNext === true,
      checkedAt: filtered.checkedAt,
      // Do not let a successful first page look like a complete finance
      // range when Seller API omitted the pagination end marker.  FBS keeps
      // the raw response here so finance can remain conservative.
      paginationComplete: (
        typeof postingResponse?.result?.has_next === "boolean"
        || typeof postingResponse?.has_next === "boolean"
        || typeof postingResponse?.result?.cursor === "string"
        || typeof postingResponse?.cursor === "string"
      ) && filtered.datasetComplete === true,
    },
    // FBS postings intentionally omit financial_data in this read path. The
    // finance projection therefore carries order coverage only; it must not
    // infer revenue or settlement profit from fulfillment rows.
  });
  return { ...filtered, has_next: filtered.hasNext, financeReadModel };
}

app.get("/api/ozon/order-dashboard", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res)) return;
  const environment = requestReadEnvironment(req);
  res.json({ ...(await readFbsOrderDashboardSnapshot(req.query)), environment });
}));

// Read-only detail lookup for a seller-selected posting.  Keep this separate
// from履约 actions: the route only calls the documented FBS detail and product
// info reads, then returns the same bounded model as the list view.  The
// expected identity is carried into the model so a mismatched/cache response
// cannot be presented as the selected order.
app.get("/api/ozon/order-dashboard/detail", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res)) return;
  const environment = requestReadEnvironment(req);
  const postingNumber = String(req.query.postingNumber || req.query.posting_number || "").trim();
  if (!postingNumber) {
    const error = new Error("缺少 postingNumber。");
    error.status = 400;
    error.reasonCode = "FBS_ORDER_POSTING_REQUIRED";
    throw error;
  }
  const store = getStore(String(req.query.storeId || ""));
  const response = await ozonRequest(store, "/v3/posting/fbs/get", { posting_number: postingNumber });
  const candidate = response?.result?.posting
    || (response?.result?.posting_number ? response.result : null)
    || response?.posting
    || (response?.posting_number ? response : null);
  const posting = candidate && typeof candidate === "object" ? candidate : null;
  const offerIds = [...new Set((Array.isArray(posting?.products) ? posting.products : [])
    .map((product) => product?.offer_id || product?.offerId)
    .map((value) => String(value || "").trim()).filter(Boolean))];
  let productDetailResponse = { items: [] };
  let productDetailFailed = false;
  let productDetailBatchAttempts = [];
  if (offerIds.length) {
    const detailRead = await readFbsProductDetailsInBatches(offerIds, (batch) => (
      ozonRequest(store, "/v3/product/info/list", { offer_id: batch })
    ));
    productDetailResponse = { items: detailRead.items };
    productDetailBatchAttempts = detailRead.batchAttempts;
    productDetailFailed = detailRead.batchAttempts.length > 0
      && detailRead.batchAttempts.every((attempt) => attempt.status === "failed");
  }
  const model = buildFbsOrderReadModel({
    storeId: store.id,
    verificationLevel: "server_observed",
    expectedPostingIdentity: postingNumber,
    postingResponse: { result: { postings: posting ? [posting] : [] } },
    productDetailResponse,
    productDetailFailed,
    productDetailBatchAttempts,
    checkedAt: new Date(),
    requestScope: { limit: 1, cursor: "", sortDir: "DESC", pagination: "cursor" },
  });
  res.json({
    ...model,
    environment,
    detailRead: {
      requestedPostingIdentity: postingNumber,
      returnedPostingIdentity: posting?.posting_number || posting?.order_number || "",
      endpoint: "/v3/posting/fbs/get",
      readOnly: true,
      sideEffect: "仅读取选中 FBS 货件和商品详情；未备货、未发运、未取消、未打印标签。",
    },
  });
}));

app.post("/api/ozon/order-dashboard/evidence-receipts", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  // Receipt persistence performs a fresh Seller read. It therefore needs the
  // same signed session, explicit environment, and principal store scope as
  // the dashboard read; recordEvidence alone must not authorize a read.
  if (!requireControlledSellerRead(req, res, body)) return;
  if (body.recordEvidence !== true) {
    res.status(400).json({ ok: false, reasonCode: "FBS_RECEIPT_CONFIRMATION_REQUIRED" });
    return;
  }
  const environment = requestReadEnvironment(req, body);
  if (!environment) {
    res.status(400).json({ ok: false, reasonCode: "FBS_RECEIPT_ENVIRONMENT_REQUIRED" });
    return;
  }
  const storeId = String(body.storeId || "").trim();
  if (!storeId) {
    res.status(400).json({ ok: false, reasonCode: "FBS_RECEIPT_STORE_REQUIRED" });
    return;
  }
  const query = { ...(body.scope || {}), storeId };
  const model = await readFbsOrderDashboardSnapshot(query);
  const recorded = await fbsEvidenceReceipts.recordServerObservation({ recordEvidence: true, model, environment });
  if (!recorded.ok) {
    res.status(recorded.status || 400).json(recorded);
    return;
  }
  res.json({
    ok: true,
    receipt: recorded.receipt,
    sideEffect: "服务端重新读取当前 FBS 批次并保存脱敏只读回执；未备货、未发运、未取消订单。",
  });
}));

app.get("/api/ozon/order-dashboard/evidence-receipts", asyncRoute(async (req, res) => {
  const environment = String(req.query.environment || "").trim();
  const storeId = String(req.query.storeId || "").trim();
  if (environment.length < 3) {
    res.status(400).json({
      ok: false,
      reasonCode: "FBS_RECEIPT_ENVIRONMENT_REQUIRED",
      sellerTask: { status: "needs_review", code: "FBS_RECEIPT_ENVIRONMENT_REQUIRED", nextAction: "指定当前 FBS 读取环境后再查看回执摘要。" },
      sideEffect: "仅校验回执查询范围；未读取 Ozon、未执行履约动作。",
    });
    return;
  }
  if (!storeId) {
    res.status(400).json({
      ok: false,
      reasonCode: "FBS_RECEIPT_STORE_REQUIRED",
      sellerTask: { status: "needs_review", code: "FBS_RECEIPT_STORE_REQUIRED", nextAction: "指定当前店铺后再查看 FBS 回执摘要。" },
      sideEffect: "仅校验回执查询范围；未读取 Ozon、未执行履约动作。",
    });
    return;
  }
  const environmentRef = environment ? `sha256:${createHash("sha256").update(environment, "utf8").digest("hex")}` : "";
  const storeRef = storeId ? `sha256:${createHash("sha256").update(storeId, "utf8").digest("hex")}` : "";
  // A missing storeId is an aggregate request, not permission to enumerate
  // every persisted store receipt. Keep this route aligned with the other
  // server-observed receipt readers and fail closed when the deployment or
  // principal requires an explicit store scope.
  const scopeDecision = receiptStoreScopeDecision(req, storeRef);
  if (!scopeDecision.allowed) {
    res.status(403).json({
      ok: false,
      reasonCode: scopeDecision.reasonCode,
      error: "当前 ERP 会话未获准读取该 FBS 只读回执范围。",
      sideEffect: "仅检查已持久化的服务端只读回执；未读取 Ozon、未执行履约动作。",
    });
    return;
  }
  const receipts = (await fbsEvidenceReceipts.list()).filter((receipt) => (
    receipt?.persisted === true
    && receipt?.origin === "server_observed"
    && (!environmentRef || receipt.environmentRef === environmentRef)
    && (!storeRef || receipt.storeRef === storeRef)
    && (!scopeDecision.hashes.size || scopeDecision.hashes.has(receipt.storeRef))
  ));
  const scopeKeys = ["since", "to", "status", "warehouseId", "limit", "cursor", "sortDir"];
  const scopeRequested = scopeKeys.some((key) => Object.prototype.hasOwnProperty.call(req.query, key));
  const candidateLatest = scopeRequested
    ? await fbsEvidenceReceipts.findLatest({
      environment,
      storeId,
      requestScope: {
        since: req.query.since,
        to: req.query.to,
        status: req.query.status,
        warehouseId: req.query.warehouseId,
        limit: req.query.limit,
        cursor: req.query.cursor,
        sortDir: req.query.sortDir,
        pagination: "cursor",
      },
    })
    : [...receipts].sort((left, right) => String(right.checkedAt || "").localeCompare(String(left.checkedAt || "")))[0] || null;
  // `findLatest` reads the repository independently of the filtered list;
  // never return a disallowed latest receipt just because its page scope
  // matched. A conservative null is safer than cross-store evidence.
  const latest = candidateLatest && (!scopeDecision.hashes.size || scopeDecision.hashes.has(candidateLatest.storeRef))
    ? candidateLatest
    : null;
  res.json({
    receiptCount: receipts.length,
    countScope: storeId ? "server_observed_current_store_and_environment" : environment ? "server_observed_current_environment" : "server_observed_all_environments",
    latestReceipt: latest ? {
      checkedAt: latest.checkedAt,
      partial: latest.partial === true,
      hasNext: latest.hasNext === true,
      sourceCount: Number(latest.sourceCount || 0),
      missingEvidenceCount: Array.isArray(latest.missingEvidenceRefs) ? latest.missingEvidenceRefs.length : 0,
      pageComplete: latest.pageComplete === true,
      datasetComplete: latest.datasetComplete === true,
      readCoverage: latest.readCoverage || "unknown",
      scopeHash: latest.scopeHash || "",
      requestScope: latest.requestScope || null,
      verificationLevel: latest.verificationLevel || (latest.origin === "server_observed" ? "server_observed" : "locally_tested"),
      ...buildFbsReceiptSellerView(latest),
    } : null,
  });
}));

app.get("/api/ozon/products", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res)) return;
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
  if (!requireControlledSellerRead(req, res)) return;
  const store = getStore(String(req.query.storeId || ""));
  const limit = Math.min(Number(req.query.limit || 100), 100);
  const listData = await ozonRequest(store, "/v3/product/list", {
    filter: {
      visibility: String(req.query.visibility || "ALL"),
    },
    limit,
    last_id: String(req.query.lastId || ""),
  });
  // Seller responses can be wrapped in `result` or expose a direct `items`
  // envelope.  An unrecognised envelope is unknown evidence, not an empty
  // shop.
  const listContainer = listData?.result && typeof listData.result === "object"
    ? listData.result
    : listData;
  const listItems = Array.isArray(listContainer?.items) ? listContainer.items : [];
  const listResponseRecognized = Boolean(listContainer && Array.isArray(listContainer.items));
  const productIds = listItems.map((item) => item.product_id).filter(Boolean);
  const checkedAt = new Date().toISOString();
  // Keep a successful list read visible when the detail read fails. A route
  // level 500 would erase useful bounded evidence and look like the store had
  // no products; the seller view must instead stay explicitly partial.
  let detailData = { items: [] };
  let detailReadFailed = false;
  if (productIds.length) {
    try {
      detailData = await ozonRequest(store, "/v3/product/info/list", { product_id: productIds });
    } catch {
      detailReadFailed = true;
    }
  }
  const detailContainer = detailData?.result && typeof detailData.result === "object"
    ? detailData.result
    : detailData;
  const operationEvidence = [
    buildOperationEvidenceRecord({ operationPath: "/v3/product/list", checkedAt: checkedAt || new Date().toISOString(), statusCode: 200, response: listData, verificationLevel: "server_observed", source: "product-dashboard" }),
    ...(productIds.length ? [buildOperationEvidenceRecord({ operationPath: "/v3/product/info/list", checkedAt: checkedAt || new Date().toISOString(), statusCode: detailReadFailed ? 502 : 200, response: detailReadFailed ? { error: "product_details_read_failed" } : detailData, verificationLevel: detailReadFailed ? "failed" : "server_observed", source: "product-dashboard" })] : []),
  ];
  const detailItems = Array.isArray(detailContainer?.items) ? detailContainer.items : [];
  // Keep the original list/detail fallback contract explicit for route-level
  // evidence checks; missing detail rows are still rendered as unknown below.
  const fallbackItems = detailReadFailed ? listItems : detailItems;
  // List rows are safe to display as a bounded index, not as a substitute for
  // the missing detail response.
  let products;
  if (detailReadFailed) {
    products = fallbackItems.map(summarizeMissingProductDetail);
  } else if (productIds.length && detailItems.length < productIds.length) {
    const detailByKey = new Map(detailItems.map((item) => [productEvidenceKey(item), item]).filter(([key]) => key));
    // Preserve every list row as a bounded index while replacing only the
    // rows for which detail evidence was actually observed.
    products = listItems.map((item) => {
      const detail = detailByKey.get(productEvidenceKey(item));
      return detail ? summarizeProduct(detail) : summarizeMissingProductDetail(item);
    });
  } else {
    products = detailItems.map(summarizeProduct);
  }
  // Keep seller-facing recovery tasks next to the bounded read evidence. A
  // partial detail response must not leave the operator guessing whether an
  // empty status means "not for sale" or simply "not read".
  const sellerTasks = [];
  // Some Seller responses expose only a non-empty last_id cursor instead of
  // has_next.  A cursor that the caller has not consumed is still incomplete
  // evidence and must not be presented as the full shop.
  const nextCursor = String(listContainer?.last_id || listData?.last_id || "").trim();
  const listHasNext = Boolean(listContainer?.has_next || listData?.has_next || nextCursor);
  const detailResponseRecognized = Boolean(detailContainer && Array.isArray(detailContainer.items));
  const detailCount = Array.isArray(detailContainer?.items) ? detailContainer.items.length : 0;
  const missingEvidence = [];
  if (!listResponseRecognized) missingEvidence.push("product_list_response");
  if (listHasNext) missingEvidence.push("pagination");
  if (productIds.length && (!detailResponseRecognized || detailCount < productIds.length)) missingEvidence.push("product_details");
  if (detailReadFailed) missingEvidence.push("product_details_read_failed");
  if (detailReadFailed) {
    sellerTasks.push({
      code: "PRODUCT_DETAILS_READ_FAILED",
      count: productIds.length,
      nextAction: "重新读取商品详情；详情返回前不要判断审核、在售状态、价格或库存。",
    });
  } else if (missingEvidence.includes("product_details")) {
    sellerTasks.push({
      code: "PRODUCT_DETAILS_INCOMPLETE",
      count: Math.max(0, productIds.length - detailCount),
      nextAction: "补齐缺失商品详情后再判断审核/在售状态；当前不能据此备货或上架。",
    });
  }
  const unknownStatusCount = products.filter((item) => !String(item.status_group || "").trim() && !String(item.status || "").trim()).length;
  if (unknownStatusCount > 0) {
    sellerTasks.push({
      code: "PRODUCT_STATUS_UNKNOWN",
      count: unknownStatusCount,
      nextAction: "重新回查对应商品详情，确认审核或在售状态后再处理价格、库存或上架。",
    });
  }
  // An empty page with a next cursor is only an observed page, not an empty
  // shop. Keep malformed envelopes unknown so the UI cannot overclaim.
  const readStatus = !listResponseRecognized
    ? "unknown"
    : (missingEvidence.length ? "partial" : (!productIds.length ? "empty" : "completed"));
  const nextAction = listHasNext
    ? "继续读取下一页商品，当前列表不能代表全店范围。"
    : (!listResponseRecognized
      ? "商品列表响应格式无法确认，请重试或检查 Seller API 版本后再判断商品数量。"
      : (missingEvidence.includes("product_details")
      ? "重新读取缺失商品详情，修复后再判断商品状态。"
      : (!productIds.length ? "当前读取页没有商品；请结合筛选条件和分页结果判断，不代表全店没有商品。" : "可查看本批商品状态；写入仍需单独预检和人工确认。")));
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
    all: listContainer?.total || products.length,
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
    total: listContainer?.total || products.length,
    last_id: nextCursor,
    readEvidence: {
      readOnly: true,
      checkedAt,
      partial: missingEvidence.length > 0,
      hasNext: listHasNext,
      responseRecognized: listResponseRecognized && (!productIds.length || detailResponseRecognized),
      requestedProductCount: productIds.length,
      detailProductCount: detailCount,
      missingEvidence,
      sellerTasks,
      readStatus,
      nextAction,
      safeToWrite: false,
      operationEvidence,
      sideEffect: "仅读取商品列表和详情；未修改商品、价格或库存。",
    },
  });
}));

app.get("/api/ozon/product-prices", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res)) return;
  const store = getStore(String(req.query.storeId || ""));
  const filter = {
    visibility: String(req.query.visibility || "ALL"),
  };
  const data = await ozonRequest(store, "/v4/product/info/prices", {
    filter,
    limit: Number(req.query.limit || 100),
    last_id: req.query.last_id || "",
  });
  res.json({
    ...data,
    readEvidence: buildProductReadEvidence(data, { kind: "prices" }),
    operationEvidence: buildOperationEvidenceRecord({
      operationPath: "/v4/product/info/prices",
      checkedAt: new Date().toISOString(),
      statusCode: 200,
      response: data,
      verificationLevel: "server_observed",
      source: "product-prices-read",
    }),
    readOnly: true,
    priceConclusion: "仅表示 Seller API 返回的当前价格读取结果；不替代成本、佣金、物流和利润复算。",
  });
}));

app.get("/api/ozon/unfulfilled", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res)) return;
  const store = getStore(String(req.query.storeId || ""));
  const plan = buildReadEndpointRequest("/v4/posting/fbs/unfulfilled/list", {
    cutoffFrom: req.query.cutoffFrom || req.query.cutoff_from,
    cutoffTo: req.query.cutoffTo || req.query.cutoff_to,
    deliveringDateFrom: req.query.deliveringDateFrom || req.query.delivering_date_from,
    deliveringDateTo: req.query.deliveringDateTo || req.query.delivering_date_to,
    cursor: req.query.cursor,
    sortDir: req.query.sortDir || req.query.sort_dir,
    limit: req.query.limit || 50,
  });
  if (!plan.ok) {
    const error = new Error(plan.message || "未履约订单读取范围不完整。");
    error.status = 400;
    error.reasonCode = plan.reasonCode;
    throw error;
  }
  const data = await ozonRequest(store, plan.endpoint, plan.body);
  res.json({
    ...data,
    storeId: store.id,
    operationEvidence: buildOperationEvidenceRecord({
      operationPath: plan.endpoint,
      checkedAt: new Date().toISOString(),
      statusCode: 200,
      response: data,
      verificationLevel: "server_observed",
      source: "fbs-unfulfilled-read",
    }),
    readOnly: true,
    sideEffect: "仅读取当前范围未履约 FBS 订单；不备货、不发运、不取消、不打印标签。",
  });
}));

// All direct stock writes use the same server-observed tuple preflight.  The
// legacy endpoint stays available for compatibility, but it must not bypass
// the exact (offer_id, warehouse_id) evidence and dry-run gate used by the
// confirmed path.
app.post("/api/ozon/warehouse-stocks", requireDirectOzonWriteSafety, requireStockWritePreflight, directOzonWriteRoute("ozon.warehouse-stocks", async (req) => {
  const stocks = Array.isArray(req.body.stocks) ? req.body.stocks : [];
  if (!stocks.length) {
    throw directWriteInputError("DIRECT_WRITE_STOCKS_REQUIRED");
  }
  requireDirectWriteBatchLimit(stocks, "DIRECT_WRITE_STOCKS_LIMIT_EXCEEDED");
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v2/products/stocks", { stocks });
  // Compatibility route still uses the same post-write exact-tuple readback
  // as the confirmed route; an acknowledgement alone must never complete a
  // durable write command.
  const readback = await stockWriteReadback({ storeId: req.body.storeId, stocks, writeResponse: data });
  return { data, summary: { offerCount: stocks.length, ...stockWriteReadbackSummary(readback, stocks, req.body.storeId) } };
}));

app.post("/api/ozon/warehouse-stocks/confirmed", requireDirectOzonWriteSafety, requireStockWritePreflight, directOzonWriteRoute("ozon.warehouse-stocks.confirmed", async (req) => {
  const stocks = Array.isArray(req.body.stocks) ? req.body.stocks : [];
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v2/products/stocks", { stocks });
  const readback = await stockWriteReadback({ storeId: req.body.storeId, stocks, writeResponse: data });
  return {
    data,
    summary: {
      offerCount: stocks.length,
      dryRunIdempotencyKey: req.stockPreflight?.dryRun?.idempotencyKey || "",
      ...stockWriteReadbackSummary(readback, stocks, req.body.storeId),
    },
  };
}));

app.post("/api/ozon/prices", requireDirectOzonWriteSafety, requirePriceWritePreflight, directOzonWriteRoute("ozon.prices", async (req) => {
  const prices = Array.isArray(req.body.prices) ? req.body.prices : [];
  if (!prices.length) {
    throw directWriteInputError("DIRECT_WRITE_PRICES_REQUIRED");
  }
  requireDirectWriteBatchLimit(prices, "DIRECT_WRITE_PRICES_LIMIT_EXCEEDED");
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v1/product/import/prices", { prices });
  const readbackData = await ozonRequest(store, "/v4/product/info/prices", {
    filter: { offer_id: prices.map((item) => String(item.offer_id || item.offerId || "").trim()).filter(Boolean) },
    limit: Math.min(DIRECT_WRITE_BATCH_LIMIT, prices.length),
    last_id: "",
  });
  const readback = reconcilePriceWriteReadback({ prices, evidence: readbackData });
  if (!readback.reconciled) {
    const error = new Error("price write readback did not reconcile");
    error.status = 502;
    error.code = "DIRECT_WRITE_PRICE_READBACK_REQUIRED";
    error.priceWriteReadback = { readback, operationEvidence: buildProductReadEvidence(readbackData, { kind: "prices" }) };
    throw error;
  }
  return { data, summary: { offerCount: prices.length, changedFieldCount: req.pricePreflight?.decision?.diff?.reduce((count, item) => count + Object.keys(item.changes || {}).length, 0) || 0, status: "reconciled", readback: "server_observed" } };
}));

app.get("/api/ozon/actions", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res)) return;
  const store = getStore(String(req.query.storeId || ""));
  const environment = requestReadEnvironment(req);
  const data = await ozonGetRequest(store, "/v1/actions");
  res.json({
    ...data,
    storeId: store.id,
    environment,
    operationEvidence: buildOperationEvidenceRecord({
      operationPath: "/v1/actions",
      checkedAt: new Date().toISOString(),
      statusCode: 200,
      response: data,
      verificationLevel: "server_observed",
      source: "promotions-read",
    }),
    readOnly: true,
    activityConclusion: "仅读取活动列表；不代表商品已加入活动，也不改变活动价格。",
    sellerResult: buildActivityReadSellerResult(data, { kind: "activity" }),
  });
}));

app.post("/api/ozon/actions/products", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res, req.body)) return;
  const store = getStore(req.body.storeId);
  const environment = requestReadEnvironment(req, req.body);
  const actionId = Number(req.body.action_id || req.body.actionId);
  if (!actionId) throw new Error("请提供 action_id");
  const data = await ozonRequest(store, "/v1/actions/products", {
    action_id: actionId,
    limit: Number(req.body.limit || 1000),
    offset: Number(req.body.offset || 0),
  });
  const products = Array.isArray(data?.products)
    ? data.products
    : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.result?.products)
        ? data.result.products
        : Array.isArray(data?.result?.items)
          ? data.result.items
          : [];
  const sellerResult = buildActivityReadSellerResult(data, { kind: "activity_products", offset: Number(req.body.offset || 0), limit: Number(req.body.limit || 1000) });
  res.json({ ...data, storeId: store.id, environment, operationEvidence: buildOperationEvidenceRecord({ operationPath: "/v1/actions/products", checkedAt: new Date().toISOString(), statusCode: 200, response: data, verificationLevel: "server_observed", source: "promotions-products-read" }), readOnly: true, impactPreview: sellerResult.coverageComplete === true ? buildPromotionImpactPreview(products) : null, sellerResult });
}));
app.post("/api/ozon/actions/candidates", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res, req.body)) return;
  const store = getStore(req.body.storeId);
  const environment = requestReadEnvironment(req, req.body);
  const actionId = Number(req.body.action_id || req.body.actionId);
  if (!actionId) throw new Error("请提供 action_id");
  const data = await ozonRequest(store, "/v1/actions/candidates", {
    action_id: actionId,
    limit: Number(req.body.limit || 1000),
    offset: Number(req.body.offset || 0),
  });
  res.json({ ...data, storeId: store.id, environment, operationEvidence: buildOperationEvidenceRecord({ operationPath: "/v1/actions/candidates", checkedAt: new Date().toISOString(), statusCode: 200, response: data, verificationLevel: "server_observed", source: "promotions-candidates-read" }), readOnly: true, sellerResult: buildActivityReadSellerResult(data, { kind: "activity_candidates", offset: Number(req.body.offset || 0), limit: Number(req.body.limit || 1000) }) });
}));

app.post("/api/ozon/actions/products/deactivate", requireDirectOzonWriteSafety, requirePromotionWritePreflight, directOzonWriteRoute("ozon.actions.products.deactivate", async (req) => {
  const actionId = Number(req.body.action_id || req.body.actionId);
  const productIds = (req.body.product_ids || req.body.productIds || [])
    .flat()
    .map((id) => Number(id))
    .filter(Boolean);
  if (!actionId) {
    throw directWriteInputError("DIRECT_WRITE_ACTION_ID_REQUIRED");
  }
  if (!productIds.length) {
    throw directWriteInputError("DIRECT_WRITE_PRODUCT_IDS_REQUIRED");
  }
  requireDirectWriteBatchLimit(productIds, "DIRECT_WRITE_PRODUCT_IDS_LIMIT_EXCEEDED");
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v1/actions/products/deactivate", {
    action_id: actionId,
    product_ids: productIds,
  });
  const readback = await promotionWriteReadback({
    storeId: req.body.storeId,
    actionId,
    productIds,
  });
  return {
    data: {
      ...data,
      readOnly: false,
      writeResult: "reconciled",
      itemResults: readback.itemResults,
      readback: {
        status: readback.status,
        coverage: readback.sellerResult,
      },
      sideEffect: "已提交移出活动并完成当前活动范围逐项回读；未修改价格、库存或订单。",
    },
    summary: {
      offerCount: productIds.length,
      acceptedCount: readback.itemResults.filter((item) => item.status === "removed").length,
      failedCount: 0,
      status: "reconciled",
    },
  };
}));

app.post("/api/ozon/product-import-info", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res, req.body)) return;
  const store = getStore(req.body.storeId);
  // A malformed task id must not reach Seller API.  `Number("abc")` becomes
  // NaN and previously produced an ambiguous upstream failure, leaving the
  // seller unable to tell whether the task was missing or merely unreadable.
  // Keep import readback fail-closed and side-effect free at the route edge.
  const taskId = Number(req.body.task_id);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    res.status(400).json({
      ok: false,
      reasonCode: "PRODUCT_IMPORT_TASK_ID_INVALID",
      error: "Task ID 必须是正整数；未执行商品导入状态回查。",
      readOnly: true,
      sideEffect: "未读取 Ozon、未提交新商品、未重试写入。",
    });
    return;
  }
  const workflowRunId = String(req.body.workflowRunId || "").trim();
  // Validate the local workflow binding before touching Seller API.  A stale
  // or cross-workflow task must not even perform a read against the selected
  // store, otherwise the returned evidence could be attached to the wrong
  // seller object.
  if (workflowRunId) {
    const workflow = await getWorkflowRun(workflowRunId);
    const expectedTaskId = Number(workflow?.entity?.taskId
      || workflow?.submissionReservation?.taskId
      || (workflow?.nodes || []).find((node) => node.key === "ozon_submit")?.output?.taskId
      || 0);
    const expectedStoreId = String(workflow?.entity?.storeId || workflow?.submissionReservation?.storeId || "").trim();
    if (!workflow) {
      res.status(404).json({ ok: false, reasonCode: "WORKFLOW_NOT_FOUND", readOnly: true, sideEffect: "未读取 Ozon、未写入工作流。" });
      return;
    }
    if (expectedTaskId > 0 && expectedTaskId !== taskId) {
      res.status(409).json({ ok: false, reasonCode: "WORKFLOW_TASK_MISMATCH", readOnly: true, sideEffect: "未读取 Ozon、未写入工作流。" });
      return;
    }
    if (expectedStoreId && String(req.body.storeId || "").trim() && expectedStoreId !== String(req.body.storeId).trim()) {
      res.status(409).json({ ok: false, reasonCode: "WORKFLOW_STORE_MISMATCH", readOnly: true, sideEffect: "未读取 Ozon、未写入工作流。" });
      return;
    }
  }
  const data = await ozonRequest(store, "/v1/product/import/info", {
    task_id: taskId,
  });
  const operationEvidence = buildOperationEvidenceRecord({
    operationPath: "/v1/product/import/info",
    checkedAt: new Date().toISOString(),
    statusCode: 200,
    response: data,
    verificationLevel: "server_observed",
    source: "product-import-info",
  });
  let workflowReadback = null;
  if (workflowRunId) {
    workflowReadback = await reconcileWorkflowTaskReadback(workflowRunId, {
      taskId,
      storeId: req.body.storeId,
      importInfo: data,
      checkedAt: operationEvidence.checkedAt,
      responseHash: operationEvidence.responseHash,
    });
    if (!workflowReadback.ok && workflowReadback.status >= 400) {
      res.status(workflowReadback.status).json({
        ok: false,
        ...workflowReadback,
        readOnly: true,
        sideEffect: "未写入 Ozon；工作流审核节点未更新。",
      });
      return;
    }
  }
  res.json({
    ...data,
    operationEvidence,
    ...(workflowReadback ? { workflowReadback } : {}),
    readOnly: true,
    sideEffect: "仅回查商品导入任务状态；未提交新商品、未重试写入。",
  });
}));

app.get("/api/ozon/stock-queue", asyncRoute(async (req, res) => {
  const jobs = (await listStockJobs()).filter((job) => stockJobVisibleToRequest(job, req));
  if (String(req.query.includeWarehouseRecommendation || "") !== "1") {
    res.json({ jobs });
    return;
  }
  if (!requireControlledSellerRead(req, res)) return;
  let warehouses = [];
  let warehouseRecommendationError = "";
  try {
    const store = getStore(req.query.storeId);
    const data = await ozonRequest(store, "/v2/warehouse/list", {});
    warehouses = Array.isArray(data?.warehouses) ? data.warehouses : (Array.isArray(data?.result) ? data.result : []);
  } catch (error) {
    warehouseRecommendationError = error.message || "读取 Ozon 仓库失败";
  }
  res.json({
    jobs: jobs.map((job) => ({
      ...job,
      warehouseRecommendation: warehouses.length
        ? stockJobWarehouseRecommendation(job, warehouses, jobs)
        : job.warehouseRecommendation || null,
    })),
    warehouseRecommendationError,
  });
}));

app.get("/api/ozon/stock-queue/ops-summary", asyncRoute(async (req, res) => {
  const jobs = (await listStockJobs()).filter((job) => stockJobVisibleToRequest(job, req));
  const staleAfterMs = Math.min(24 * 60 * 60 * 1000, Math.max(60 * 1000, Number(req.query.staleAfterMs || 30 * 60 * 1000)));
  res.json(summarizeStockQueueOperations(jobs, { staleAfterMs }));
}));

app.post("/api/ozon/stock-reconciliation/dry-run", asyncRoute(async (req, res) => {
  const environment = requestReadEnvironment(req, req.body || {});
  if (environment.length < 3) {
    res.status(400).json({ ok: false, reasonCode: "STOCK_DRY_RUN_ENVIRONMENT_REQUIRED", error: "库存预演必须绑定当前 Seller API 读取环境。" });
    return;
  }
  // A local calculation still produces a store-scoped idempotency plan and
  // is later consumed by the confirmed write route.  Do not return a
  // successful HTTP envelope for an unbound plan; callers could mistake the
  // blocked dry-run for a valid preview and lose the store boundary.
  const storeId = String(req.body?.storeId || "").trim();
  if (!storeId) {
    res.status(400).json({ ok: false, reasonCode: "STOCK_DRY_RUN_STORE_REQUIRED", error: "库存预演必须绑定当前店铺。" });
    return;
  }
  const validation = validateStockDryRunInput({
    targetStocks: req.body?.targetStocks,
    products: req.body?.products,
    warehouses: req.body?.warehouses,
    currentStocks: req.body?.currentStocks,
  });
  if (!validation.ok) {
    res.status(validation.status).json(validation);
    return;
  }
  const dryRun = dryRunStockJobReconciliation({
    job: {
      id: req.body?.jobId || "local-stock-preview",
      storeId,
      stocks: validation.value.targetStocks,
    },
    products: validation.value.products,
    warehouses: validation.value.warehouses,
    currentStocks: validation.value.currentStocks,
    // A created warehouse is not sufficient evidence for a seller-facing
    // preview.  The preview must use the same fulfillment-mode gate as the
    // confirmed route, otherwise a hand-crafted/partial warehouse snapshot
    // can say "可以进入人工确认" and only fail later at write preflight.
    requireWarehouseModeEvidence: true,
  });
  res.json({
    ok: true,
    environment,
    verificationLevel: "locally_tested",
    dryRun,
    sellerView: stockDryRunSellerView(dryRun),
  });
}));

app.post("/api/ozon/stock-reconciliation/evidence", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  if (!requireControlledSellerRead(req, res, body)) return;
  const storeId = String(body.storeId || "").trim();
  const environment = requestReadEnvironment(req, body);
  const result = await gatherStockReconciliationEvidence({ storeId, offerIds: body.offerIds, warehouseIds: body.warehouseIds }, {
    observationMode: "server_read",
    readEndpoint: async (endpoint, payload) => {
      const store = getStore(storeId);
      return ozonRequest(store, endpoint, payload);
    },
  });
  if (!result.ok) {
    res.status(result.status || 400).json(result);
    return;
  }
  res.json({ ...result, environment });
}));

app.post("/api/ozon/stock-reconciliation/evidence-receipts", asyncRoute(async (req, res) => {
  const body = parseBody(req.body);
  if (!requireControlledSellerRead(req, res, body)) return;
  const environment = String(body.environment || "").trim();
  if (body.recordEvidence !== true || !environment) {
    res.status(400).json({
      ok: false,
      reasonCode: body.recordEvidence !== true ? "STOCK_RECEIPT_CONFIRMATION_REQUIRED" : "STOCK_RECEIPT_ENVIRONMENT_REQUIRED",
    });
    return;
  }
  const storeId = String(body.storeId || "").trim();
  const evidence = await gatherStockReconciliationEvidence({ storeId, offerIds: body.offerIds, warehouseIds: body.warehouseIds }, {
    observationMode: "server_read",
    readEndpoint: async (endpoint, payload) => ozonRequest(getStore(storeId), endpoint, payload),
  });
  if (!evidence.ok) {
    res.status(evidence.status || 400).json(evidence);
    return;
  }
  const recorded = await stockEvidenceReceipts.recordServerObservation({
    recordEvidence: true,
    environment,
    evidence,
  });
  if (!recorded.ok) {
    res.status(recorded.status || 400).json(recorded);
    return;
  }
  const receipts = await stockEvidenceReceipts.list();
  res.json({
    ok: true,
    receipt: recorded.receipt,
    verification: evaluateStockRealReadVerification(receipts, { environment, storeId, offerIds: body.offerIds, warehouseIds: body.warehouseIds, maxAgeMs: STOCK_RECEIPT_MAX_AGE_MS }),
    sideEffect: "执行一次受限 Ozon 库存只读证据聚合并保存脱敏本地回执；未调用 Ozon 写接口、未排队。",
  });
}));

app.get("/api/ozon/stock-reconciliation/evidence-receipts", asyncRoute(async (req, res) => {
  const environment = String(req.query.environment || "").trim();
  const storeId = String(req.query.storeId || "").trim();
  if (!environment) {
    res.status(400).json({ ok: false, reasonCode: "STOCK_RECEIPT_ENVIRONMENT_REQUIRED", message: "查询库存回执必须绑定环境。" });
    return;
  }
  if (!storeId) {
    res.status(400).json({ ok: false, reasonCode: "STOCK_RECEIPT_STORE_REQUIRED", message: "查询库存回执必须绑定当前店铺。" });
    return;
  }
  const offerIds = String(req.query.offerIds || "").split(",").map((value) => value.trim()).filter(Boolean);
  const warehouseIds = String(req.query.warehouseIds || "").split(",").map(Number).filter((value) => Number.isSafeInteger(value) && value > 0);
  const receipts = await stockEvidenceReceipts.list();
  const maxAgeMs = stockReceiptMaxAgeMs(req.query.maxAgeMs);
  const verification = evaluateStockRealReadVerification(receipts, { environment, storeId, offerIds, warehouseIds, maxAgeMs });
  res.json({
    verification,
    receiptCount: verification.persistedCount,
    countScope: "eligible_server_observed_current_store_and_environment",
    freshness: { maxAgeMs, staleCount: verification.staleCount, note: "过期库存回执保留审计，但不能支持当前库存写前判断。" },
  });
}));

app.post("/api/ozon/stock-queue", asyncRoute(async (req, res) => {
  const storeId = String(req.body?.storeId || req.storeScope?.storeId || "").trim();
  if (!storeId) {
    res.status(400).json({ ok: false, reasonCode: "STOCK_QUEUE_STORE_REQUIRED", error: "库存入队必须绑定当前店铺。" });
    return;
  }
  const job = await enqueueStockJob({
    storeId,
    taskId: req.body.taskId || req.body.task_id,
    stocks: req.body.stocks || [],
    delayMs: req.body.delayMs,
  });
  res.json({ ok: true, job });
}));

app.post("/api/ozon/stock-queue/replay-failed", asyncRoute(async (req, res) => {
  const storeId = String(req.body?.storeId || req.storeScope?.storeId || "").trim();
  if (!storeId) {
    res.status(400).json({ ok: false, reasonCode: "STOCK_QUEUE_STORE_REQUIRED", error: "库存失败回放必须绑定当前店铺。" });
    return;
  }
  const data = await replayFailedStockJobs({
    limit: Number(req.body?.limit || 10),
    cooldownMs: Number(req.body?.cooldownMs || 3 * 60 * 1000),
    storeId,
    storeIds: req.authPrincipal?.storeIds || [],
  });
  res.json({ ...data, data, summary: { scanned: data.scanned || 0, replayed: data.replayed || 0, storeId } });
}));

app.post("/api/ozon/barcodes/generate", requireDirectOzonWriteSafety, directOzonWriteRoute("ozon.barcodes.generate", async (req) => {
  const productIds = (req.body.product_ids || req.body.product_id || [])
    .flat()
    .map((id) => Number(id))
    .filter(Boolean);
  if (!productIds.length) {
    throw directWriteInputError("DIRECT_WRITE_BARCODE_PRODUCT_IDS_REQUIRED");
  }
  requireDirectWriteBatchLimit(productIds, "DIRECT_WRITE_BARCODE_PRODUCT_IDS_LIMIT_EXCEEDED");
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v1/barcode/generate", {
    product_ids: productIds,
  });
  return { data, summary: { offerCount: productIds.length } };
}));

app.post("/api/ozon/product-pictures-import", requireDirectOzonWriteSafety, directOzonWriteRoute("ozon.product-pictures-import", async (req) => {
  const payload = validateDirectWritePicturePayload(req.body.payload);
  const store = getStore(req.body.storeId);
  const data = await ozonRequest(store, "/v1/product/pictures/import", payload);
  return { data, summary: { offerCount: 1 } };
}));

app.post("/api/ozon/product-stocks", asyncRoute(async (req, res) => {
  if (!requireControlledSellerRead(req, res, req.body)) return;
  const environment = requestReadEnvironment(req, req.body);
  const store = getStore(req.body.storeId);
  const readRequest = buildReadEndpointRequest("/v4/product/info/stocks", {
    offerIds: req.body.offerIds || req.body.filter?.offer_id || [],
    productIds: req.body.productIds || req.body.filter?.product_id || [],
    limit: Number(req.body.limit || 100),
    cursor: req.body.cursor || "",
  });
  // 明确 Offer/Product ID；v4 stock reads use cursor: req.body.cursor as the only pagination continuation.
  if (!readRequest.ok) {
    res.status(400).json({ ok: false, reasonCode: readRequest.reasonCode, readOnly: true });
    return;
  }
  const data = await ozonRequest(store, "/v4/product/info/stocks", readRequest.body);
  res.json({
    ...data,
    // Bind the read response to the requested store so the frontend can
    // reject a late or mis-scoped response before painting stock state.  The
    // environment binding is equally required: this display-only route is
    // often called while an operator switches between local/staging reads.
    storeId: store.id,
    environment,
    readEvidence: buildProductReadEvidence(data, { kind: "stocks" }),
  });
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

const runtimeStartup = runtimeStartupDecision({ host });
if (!runtimeStartup.allowed) {
  const hints = [];
  if (runtimeStartup.blockers.includes("external_host_requires_authentication")) {
    hints.push("配置 OZON_ERP_AUTH_SECRET 或保持 HOST=127.0.0.1");
  }
  if (runtimeStartup.blockers.includes("durable_storage_required_but_missing")) {
    hints.push("当前 JobRepository 只支持 Supabase；配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY。DATABASE_URL 单独声明不会提供运行时后端");
  }
  if (runtimeStartup.blockers.includes("direct_writes_require_admin_authentication")) {
    hints.push("external direct writes require OZON_ERP_ADMIN_SECRET（配置独立管理员密钥）");
  }
  if (runtimeStartup.blockers.includes("store_scope_required_but_missing")) {
    hints.push("allowed store scope：配置 OZON_ERP_ALLOWED_STORE_IDS 或 OZON_ERP_STORE_IDS");
  }
  if (runtimeStartup.blockers.includes("principal_store_scope_required_but_missing")) {
    hints.push("principal store scope：配置 OZON_ERP_AUTH_STORE_IDS，绑定认证会话可访问店铺");
  }
  throw new Error(`拒绝启动：${runtimeStartup.blockers.join(", ")}。${hints.join("；")}。`);
}

app.listen(port, host, async () => {
  await initServerObservability();
  await restoreStockQueue();
  await recoverInterruptedJobs();
  startExternalOzonLearningMonitor();
  console.log(`Direct Ozon writes: ${directOzonWritesEnabled() ? "explicitly enabled" : "disabled by default"}`);
  // Seller API reconciliation is request-scoped: it requires a signed read
  // session, environment and one store/job. Do not run a broad timer.
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
  console.log(`Ozon FBS ERP running at http://${host}:${port}`);
});
