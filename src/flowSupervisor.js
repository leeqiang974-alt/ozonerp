import { listAutoListingJobs, reconcileSubmittedJobs, triggerAutoListing, remediateFailedListingJobs, remediateListingJobsByTaskIds } from "./autoListing.js";
import { listStockJobs, replayFailedStockJobs, recordStockQueueFailuresToLearning } from "./stockQueue.js";
import { listOzonOpportunities, createOzonBlindSearchRun, createOzonLearningTask } from "./ozonLearning.js";
import { checkAndTriggerPipeline } from "./pipeline.js";
import { mapReasonCode } from "./reasonCodes.js";
import { listWorkflowRuns } from "./workflowRuns.js";

function takeTopReasons(jobs, limit = 3) {
  const counter = new Map();
  for (const job of jobs) {
    const directMapped = mapReasonCode([job.error || "", job.lastError || ""].filter(Boolean).join(" "));
    const text = [
      job.reasonCode && job.reasonCode !== "UNKNOWN" ? job.reasonCode : "",
      job.error || "",
      job.lastError || "",
      JSON.stringify(job.result || {}).slice(0, 2000),
    ].filter(Boolean).join(" ");
    const mapped = directMapped !== "UNKNOWN" ? directMapped : mapReasonCode(text);
    const stored = String(job.reasonCode || "").trim();
    const key = String((!stored || ["UNKNOWN", "EXTERNAL_API_ERROR", "STOCK_WRITE_FAILED"].includes(stored)) && mapped !== "UNKNOWN" ? mapped : stored || mapped).trim() || "UNKNOWN";
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reasonCode, count]) => ({ reasonCode, count }));
}

function takeTimeoutStages(jobs, limit = 5) {
  const counter = new Map();
  for (const job of jobs) {
    if (String(job.reasonCode || "") !== "TIMEOUT") continue;
    const stage = String(job.timeoutStage || "unknown").trim() || "unknown";
    counter.set(stage, (counter.get(stage) || 0) + 1);
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([stage, count]) => ({ stage, count }));
}

function normalizeSeed(seed) {
  const raw = String(seed || "").trim();
  if (!raw) return "";
  const parts = raw.split(">").map((x) => x.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : raw;
  return last.replace(/\s+/g, " ").slice(0, 40);
}

function optionNumber(options, key, fallback) {
  const value = Number(options?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function statusDelta(before, after) {
  return {
    runningJobCount: Number(after.runningJobCount || 0) - Number(before.runningJobCount || 0),
    readyForListingCount: Number(after.readyForListingCount || 0) - Number(before.readyForListingCount || 0),
    needsReviewCount: Number(after.needsReviewCount || 0) - Number(before.needsReviewCount || 0),
    opportunityCount: Number(after.opportunityCount || 0) - Number(before.opportunityCount || 0),
    stockPending: Number(after?.stockQueue?.pending || 0) - Number(before?.stockQueue?.pending || 0),
    stockSuccess: Number(after?.stockQueue?.success || 0) - Number(before?.stockQueue?.success || 0),
    stockFailed: Number(after?.stockQueue?.failed || 0) - Number(before?.stockQueue?.failed || 0),
  };
}

function parseStagePolicy(options = {}) {
  const defaults = {
    translating: { limit: 3, cooldownMs: 3 * 60 * 1000 },
    searching_1688: { limit: 3, cooldownMs: 5 * 60 * 1000 },
    waiting_crawl: { limit: 4, cooldownMs: 8 * 60 * 1000 },
    matching: { limit: 3, cooldownMs: 8 * 60 * 1000 },
    generating_content: { limit: 2, cooldownMs: 10 * 60 * 1000 },
    listing: { limit: 1, cooldownMs: 20 * 60 * 1000 },
    unknown: { limit: 2, cooldownMs: 10 * 60 * 1000 },
  };
  const raw = String(options.stageRetryPolicy || "").trim();
  if (!raw) return defaults;
  // format: stage:limit:cooldownSec,stage:limit:cooldownSec
  const merged = { ...defaults };
  for (const entry of raw.split(",")) {
    const [stage, limitStr, cdStr] = entry.split(":").map((x) => x.trim());
    if (!stage) continue;
    const limit = Number(limitStr);
    const cooldownSec = Number(cdStr);
    merged[stage] = {
      limit: Number.isFinite(limit) && limit > 0 ? limit : (merged[stage]?.limit || 2),
      cooldownMs: Number.isFinite(cooldownSec) && cooldownSec > 0 ? cooldownSec * 1000 : (merged[stage]?.cooldownMs || 600000),
    };
  }
  return merged;
}

export function summarizeWorkflowRuns(runs = []) {
  return {
    total: runs.length,
    running: runs.filter((run) => run.status === "running").length,
    waitingHuman: runs.filter((run) => run.status === "waiting_human").length,
    failed: runs.filter((run) => run.status === "failed").length,
    live: runs.filter((run) => run.status === "live").length,
    paused: runs.filter((run) => run.status === "paused").length,
  };
}

export function automationSafetyStatus(env = process.env) {
  const distributorAutorun = String(env.OZON_DISTRIBUTOR_AUTORUN || "0") === "1";
  const serverAutoHeal = String(env.OZON_SERVER_AUTO_HEAL || "0") === "1";
  return {
    distributorAutorun,
    serverAutoHeal,
    mode: distributorAutorun || serverAutoHeal ? "automation_enabled" : "observe_only",
  };
}

export function automationActionsAllowed(options = {}, env = process.env) {
  if (Object.prototype.hasOwnProperty.call(options, "allowAutomation")) {
    return Boolean(options.allowAutomation);
  }
  return String(env.OZON_SERVER_AUTO_HEAL || "0") === "1"
    || String(env.OZON_DISTRIBUTOR_AUTORUN || "0") === "1";
}

export async function getFlowStatusSnapshot() {
  const [jobs, stockJobs, opportunities, workflowRuns] = await Promise.all([
    listAutoListingJobs(),
    listStockJobs(),
    listOzonOpportunities({ minScore: 60 }),
    listWorkflowRuns().catch(() => ({ items: [] })),
  ]);
  const running = jobs.filter((j) => [
    "processing",
    "translating",
    "searching_1688",
    "waiting_crawl",
    "matching",
    "generating_content",
    "listing",
    "waiting",
    "submitted_to_ozon",
    "submitted",
  ].includes(String(j.status || "")));
  const ready = jobs.filter((j) => String(j.status || "") === "ready_for_listing");
  const needsReview = jobs.filter((j) => String(j.status || "") === "needs_review");
  const listed = jobs
    .filter((j) => String(j.status || "") === "live")
    .slice(0, 10)
    .map((j) => ({
      sku: j?.listingResult?.sku || j?.listingContent?.parentSku || "",
      ozonLink: j?.ozonItem?.url || j?.ozonContext?.url || "",
      updatedAt: j.updatedAt || j.createdAt || "",
    }));
  const failed = jobs.filter((j) => String(j.status || "") === "failed");
  const timeoutStages = takeTimeoutStages(failed, 5);
  const stockPending = stockJobs.filter((j) => ["pending", "waiting_product", "retry_stock", "checking_task"].includes(String(j.status || ""))).length;
  const stockSuccess = stockJobs.filter((j) => String(j.status || "") === "success").length;
  const stockFailedJobs = stockJobs.filter((j) => String(j.status || "") === "failed");
  const stockFailed = stockFailedJobs.length;

  return {
    ok: true,
    runningJobCount: running.length,
    readyForListingCount: ready.length,
    needsReviewCount: needsReview.length,
    opportunityCount: opportunities.length,
    newlyListedItems: listed,
    topFailureReasons: takeTopReasons(failed, 3),
    timeoutStageTop: timeoutStages,
    stalled: running.length === 0 && ready.length === 0 && stockPending === 0,
    automation: automationSafetyStatus(),
    stockQueue: {
      pending: stockPending,
      success: stockSuccess,
      failed: stockFailed,
      topFailureReasons: takeTopReasons(stockFailedJobs, 3),
    },
    workflowRuns: summarizeWorkflowRuns(workflowRuns.items || []),
  };
}

export async function autoHealFlow(options = {}) {
  // A background supervisor has no signed seller session or single-store
  // scope; live submission readback belongs to the request-scoped route.
  const reconcile = {
    ok: false,
    scanned: 0,
    updated: 0,
    live: 0,
    failed: 0,
    pending: 0,
    reasonCode: "CONTROLLED_RECONCILIATION_REQUIRED",
    sellerResult: {
      status: "needs_review",
      action: "请在单个店铺和受控读取环境下打开任务，执行审核结果回读。",
      sideEffect: "后台自愈未读取 Ozon 商品状态，也未修改任务。",
      result: "后台自愈没有执行未绑定店铺范围的审核回读。",
    },
  };
  const before = await getFlowStatusSnapshot();
  const actions = [];
  const opportunities = await listOzonOpportunities({ minScore: optionNumber(options, "minScore", 55) });
  const automationAllowed = automationActionsAllowed(options);

  if (!automationAllowed) {
    actions.push({
      action: "automation_blocked_observe_only",
      mode: "observe_only",
      message: "观察模式下不会创建、重试或重提交自动任务。",
    });
    const after = await getFlowStatusSnapshot();
    return {
      ok: true,
      reconcile,
      actions,
      before,
      after,
      delta: statusDelta(before, after),
    };
  }

  if (before.runningJobCount === 0 && before.readyForListingCount === 0) {
    const currentJobs = await listAutoListingJobs();
    const usedOpportunityIds = new Set(currentJobs.map((j) => String(j.opportunityId || "")).filter(Boolean));
    const startableOpportunities = opportunities
      .filter((item) => item.id && !usedOpportunityIds.has(String(item.id)))
      .sort((a, b) => Number(b.opportunityScore || b.score || 0) - Number(a.opportunityScore || a.score || 0))
      .slice(0, optionNumber(options, "autoListOpportunityBatch", 2));
    const started = [];
    for (const item of startableOpportunities) {
      try {
        const startedJob = await triggerAutoListing(item.id);
        started.push({ opportunityId: item.id, jobId: startedJob.jobId, title: item.title || "" });
      } catch (e) {
        started.push({ opportunityId: item.id, error: e.message });
      }
    }
    if (started.length) {
      actions.push({
        action: "start_auto_listing_from_stalled_opportunities",
        started,
      });
    }
    const diversified = [];
    const used = new Set();
    for (const item of opportunities) {
      if (diversified.length >= optionNumber(options, "diversifiedSeedCount", 3)) break;
      const seed = normalizeSeed(item.category || item.title || "");
      if (!seed || used.has(seed)) continue;
      used.add(seed);
      diversified.push(seed);
    }
    for (const seed of diversified) {
      await createOzonLearningTask({
        sourceType: "keyword",
        sourceValue: seed,
        maxProducts: optionNumber(options, "maxProducts", 20),
        detailSampleSize: optionNumber(options, "detailSampleSize", 5),
        mode: "blind_diversified",
      });
    }
    if (diversified.length) {
      actions.push({
        action: "create_diversified_learning_tasks",
        tasks: diversified.length,
        seeds: diversified,
      });
    }
    const blindBatchSize = optionNumber(options, "blindBatchSize", 3);
    if (blindBatchSize > 0) {
      const blind = await createOzonBlindSearchRun({
        batchSize: blindBatchSize,
        maxProducts: optionNumber(options, "maxProducts", 20),
        detailSampleSize: optionNumber(options, "detailSampleSize", 5),
      });
      actions.push({
        action: "create_blind_tasks",
        tasks: (blind.tasks || []).length,
        seeds: blind.seeds || [],
      });
    }
  }

  const jobsBeforeMatchRetry = await listAutoListingJobs();
  const activeOppBeforeMatchRetry = new Set(
    jobsBeforeMatchRetry
      .filter((j) => ["translating", "searching_1688", "waiting_crawl", "matching", "generating_content", "ready_for_listing", "needs_review", "listing", "submitted_to_ozon", "submitted", "live"].includes(String(j.status || "")))
      .map((j) => String(j.opportunityId || ""))
      .filter(Boolean),
  );
  const failedMatchJobs = jobsBeforeMatchRetry
    .filter((j) => String(j.status || "") === "failed" && String(j.reasonCode || "") === "MATCH_FAILED" && j.opportunityId)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const pickedMatchOpp = new Set();
  for (const job of failedMatchJobs) {
    const oppId = String(job.opportunityId || "");
    if (!oppId || pickedMatchOpp.has(oppId)) continue;
    if (activeOppBeforeMatchRetry.has(oppId)) continue;
    pickedMatchOpp.add(oppId);
    if (pickedMatchOpp.size > optionNumber(options, "retryMatchLimit", 2)) break;
    try {
      await triggerAutoListing(oppId);
      actions.push({ action: "retry_match_failed_job", opportunityId: oppId, fromJobId: job.id });
    } catch {}
  }

  const allJobs = await listAutoListingJobs();
  const failedJobs = allJobs.filter((j) => String(j.status || "") === "failed");
  const timeoutRetryLimit = optionNumber(options, "retryTimeoutLimit", 2);
  const timeoutCooldownMs = optionNumber(options, "retryTimeoutCooldownMs", 8 * 60 * 1000);
  const stagePolicy = parseStagePolicy(options);
  const runningOppSet = new Set(
    allJobs
      .filter((j) => ["translating", "searching_1688", "waiting_crawl", "matching", "generating_content", "ready_for_listing", "needs_review", "listing", "submitted_to_ozon", "submitted", "live"].includes(String(j.status || "")))
      .map((j) => String(j.opportunityId || ""))
      .filter(Boolean),
  );
  const timeoutFailed = allJobs
    .filter((j) => String(j.status || "") === "failed" && String(j.reasonCode || "") === "TIMEOUT" && j.opportunityId)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const timeoutRetryStages = new Set(
    String(options.timeoutRetryStages || "translating,searching_1688,waiting_crawl,matching,generating_content")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
  const timeoutRetriesByOpp = new Map();
  for (const j of timeoutFailed) {
    const key = String(j.opportunityId || "");
    timeoutRetriesByOpp.set(key, (timeoutRetriesByOpp.get(key) || 0) + 1);
  }
  const pickedTimeoutOpp = new Set();
  for (const j of timeoutFailed) {
    const oppId = String(j.opportunityId || "");
    if (!oppId || pickedTimeoutOpp.has(oppId)) continue;
    if (runningOppSet.has(oppId)) continue;
    const tStage = String(j.timeoutStage || "");
    if (tStage && !timeoutRetryStages.has(tStage)) continue;
    const policy = stagePolicy[tStage || "unknown"] || stagePolicy.unknown;
    const retries = timeoutRetriesByOpp.get(oppId) || 0;
    const stageLimit = Number(policy?.limit || timeoutRetryLimit);
    if (retries > stageLimit) continue;
    const updatedTs = Date.parse(String(j.updatedAt || j.createdAt || ""));
    const stageCooldownMs = Number(policy?.cooldownMs || timeoutCooldownMs);
    if (Number.isFinite(updatedTs) && Date.now() - updatedTs < stageCooldownMs) continue;
    try {
      await triggerAutoListing(oppId);
      pickedTimeoutOpp.add(oppId);
      actions.push({
        action: "retry_timeout_job",
        opportunityId: oppId,
        fromJobId: j.id,
        retries,
        timeoutStage: tStage || "unknown",
        retryPolicy: { limit: stageLimit, cooldownMs: stageCooldownMs },
      });
    } catch {}
    if (pickedTimeoutOpp.size >= optionNumber(options, "retryTimeoutBatch", 2)) break;
  }

  // Route failures by reasonCode for targeted healing
  const topReason = (failedJobs
    .map((j) => String(j.reasonCode || "UNKNOWN"))
    .reduce((acc, k) => (acc[k] = (acc[k] || 0) + 1, acc), {}));
  const reasonEntries = Object.entries(topReason).sort((a, b) => b[1] - a[1]);
  const dominantReason = reasonEntries[0]?.[0] || "";
  if (dominantReason === "STORAGE_WRITE_ERROR") {
    // Create fresh tasks to bypass stale corrupted paths
    const storageBatchSize = optionNumber(options, "storageFallbackBlindBatchSize", 1);
    if (storageBatchSize > 0) {
      const blind = await createOzonBlindSearchRun({
        batchSize: storageBatchSize,
        maxProducts: optionNumber(options, "maxProducts", 20),
        detailSampleSize: optionNumber(options, "detailSampleSize", 5),
      });
      actions.push({
        action: "route_storage_write_error_create_fresh_tasks",
        tasks: (blind.tasks || []).length,
        seeds: blind.seeds || [],
      });
    }
  }
  if (dominantReason === "MATCH_FAILED") {
    // Broaden opportunity pool for matching
    const broadOpp = await listOzonOpportunities({ minScore: optionNumber(options, "matchFallbackMinScore", 45) });
    actions.push({
      action: "route_match_failed_broaden_pool",
      opportunityPool: broadOpp.length,
      minScore: optionNumber(options, "matchFallbackMinScore", 45),
    });
  }
  if (dominantReason === "CATEGORY_INVALID") {
    actions.push({
      action: "route_category_invalid_recommend_reclassify",
      fixTemplate: {
        category: "重新自动匹配类目并二次确认 type_id",
        listing: "保持标题核心词不变，仅修正平台分类与属性集",
      },
    });
  }
  if (dominantReason === "WEIGHT_SIZE_INVALID") {
    actions.push({
      action: "route_weight_size_invalid_apply_size_weight_template",
      fixTemplate: {
        weightG: "取1688 SKU最大重量 + 包装冗余",
        sizeMm: "取1688 SKU最大长宽高 + 包装冗余",
        validation: "提交前强制数值化并检查 > 0",
      },
    });
  }
  if (dominantReason === "BRAND_INVALID") {
    actions.push({
      action: "route_brand_invalid_apply_brand_fallback",
      fixTemplate: {
        brand: "无品牌",
        source: "从平台枚举值中选择，不手填自由文本",
      },
    });
  }
  if (dominantReason === "TITLE_INVALID") {
    actions.push({
      action: "route_title_invalid_dedupe_title",
      fixTemplate: {
        title: "删除重复词和堆叠规格，保留商品类型 + 关键用途 + 1个核心规格",
      },
    });
  }
  if (dominantReason === "RICH_CONTENT_INVALID") {
    actions.push({
      action: "route_rich_content_invalid_disable_or_rebuild",
      fixTemplate: {
        richContent: "禁用无效JSON或按Ozon模板重建富内容",
      },
    });
  }
  if (dominantReason === "COUNTRY_INVALID") {
    actions.push({
      action: "route_country_invalid_apply_china_enum",
      fixTemplate: {
        country: "中国",
        source: "使用Ozon枚举值，不手写自由文本",
      },
    });
  }
  if (dominantReason === "ATTRIBUTE_DUPLICATE") {
    actions.push({
      action: "route_attribute_duplicate_dedupe_attributes",
      fixTemplate: {
        attributes: "按attribute_id去重，同一字段仅保留一个最可信值",
      },
    });
  }
  if (dominantReason === "ATTRIBUTE_REQUIRED") {
    actions.push({
      action: "route_attribute_required_fill_required_dictionary_values",
      fixTemplate: {
        attributes: "按类目属性元数据补齐必填枚举值，例如 Пол=女士/男士等",
      },
    });
  }

  const remediation = await remediateFailedListingJobs({
    limit: optionNumber(options, "remediateLimit", 3),
    autoResubmit: Boolean(options.autoResubmit),
    reasonCodes: "CATEGORY_INVALID,WEIGHT_SIZE_INVALID,BRAND_INVALID,TITLE_INVALID,RICH_CONTENT_INVALID,COUNTRY_INVALID,ATTRIBUTE_DUPLICATE,ATTRIBUTE_REQUIRED",
  });
  if (remediation.patched > 0) {
    actions.push({
      action: "remediate_failed_listing_jobs",
      patched: remediation.patched,
      resubmitted: remediation.resubmitted,
    });
  }
  const replay = await replayFailedStockJobs({
    limit: optionNumber(options, "stockReplayLimit", 5),
    cooldownMs: optionNumber(options, "stockReplayCooldownMs", 3 * 60 * 1000),
  });
  if (replay.replayed > 0) {
    actions.push({
      action: "replay_failed_stock_jobs",
      replayed: replay.replayed,
    });
  }
  const stockLearning = await recordStockQueueFailuresToLearning({
    limit: optionNumber(options, "stockLearningLimit", 20),
  });
  if (stockLearning.recorded > 0) {
    actions.push({
      action: "record_stock_queue_failures_to_learning_memory",
      recorded: stockLearning.recorded,
      details: stockLearning.details,
    });
  }
  const stockJobsForReview = await listStockJobs();
  const stockReasonByTaskId = {};
  for (const j of stockJobsForReview) {
    if (!j.taskId) continue;
    stockReasonByTaskId[String(j.taskId)] = [
      j.lastError || "",
      JSON.stringify(j.result || {}).slice(0, 4000),
    ].filter(Boolean).join(" ");
  }
  const stockReviewFailedTaskIds = stockJobsForReview
    .filter((j) => String(j.status || "") === "failed")
    .filter((j) => {
      const direct = mapReasonCode(j.lastError || "");
      const rc = direct !== "UNKNOWN" ? direct : mapReasonCode(JSON.stringify(j.result || {}).slice(0, 4000));
      return ["CATEGORY_INVALID", "WEIGHT_SIZE_INVALID", "BRAND_INVALID", "TITLE_INVALID", "RICH_CONTENT_INVALID", "COUNTRY_INVALID", "ATTRIBUTE_DUPLICATE", "ATTRIBUTE_REQUIRED"].includes(rc);
    })
    .map((j) => j.taskId)
    .filter(Boolean);
  const stockDrivenRemediation = await remediateListingJobsByTaskIds(stockReviewFailedTaskIds, {
    limit: optionNumber(options, "stockDrivenRemediateLimit", 3),
    autoResubmit: Boolean(options.autoResubmit),
    reasonByTaskId: stockReasonByTaskId,
  });
  if (stockDrivenRemediation.patched > 0) {
    actions.push({
      action: "remediate_listing_jobs_from_stock_queue_errors",
      patched: stockDrivenRemediation.patched,
      resubmitted: stockDrivenRemediation.resubmitted,
    });
  }

  const trigger = await checkAndTriggerPipeline();
  actions.push({ action: "check_pipeline_trigger", result: trigger });

  const after = await getFlowStatusSnapshot();
  return {
    ok: true,
    reconcile,
    actions,
    before,
    after,
    delta: statusDelta(before, after),
  };
}
