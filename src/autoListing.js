import fs from "node:fs/promises";
import path from "node:path";
import { createCrawlerTask } from "./crawler1688.js";
import { listCrawlerCandidates } from "./crawler1688.js";
import { getCollectionItem } from "./collectionBox.js";
import { build1688CaptureImportReview } from "./captureReplay.js";
import { listOzonLearningItems } from "./ozonLearning.js";
import { generateListingContentWithLlm } from "./llmListing.js";
import { callAiTask } from "./aiTaskRouter.js";
import { calculateOzonPrice, derivePricingPolicyFields } from "./pricing.js";
import { getStore } from "./config.js";
import { ozonRequest } from "./ozon.js";
import { nextParentSku } from "./skuSequence.js";
import { recordListingExperience } from "./learningMemory.js";
import { attributeValueCacheKey, flattenCategories, loadCategoryCache, matchCategory } from "./ozonCategoryCache.js";
import {
  buildRequiredAttributeManualBacklog,
  buildRequiredAttributeFillPlan,
  buildRequiredAttributeRuleCandidateIndex,
  summarizeRequiredAttributeFillPlan,
} from "./ozonRequiredAttributeAnalysis.js";
import { enqueueStockJob, recordFailedStockJob, resolveWarehouseIdForStore } from "./stockQueue.js";
import { buildVisualCardPrompt } from "./visualCardTemplate.js";
import { prepareOzonImages } from "./imageOss.js";
import { JobRepository } from "./jobRepository.js";
import { mapReasonCode } from "./reasonCodes.js";
import { trackEvent } from "./observability.js";
import { SOURCING_MAX_SKU_COUNT, SOURCING_MAX_SOURCE_WEIGHT_G, filterSourcingCandidates } from "./sourcingRules.js";
import { buildProcurementEvidenceSummary } from "./sourcingRules.js";
import {
  appendWorkflowEvent,
  buildPreflightGateNode,
  diagnoseWorkflowError,
  findOrCreateWorkflowForAutoListingJob,
  savePayloadDraft,
  upsertWorkflowNode,
  workflowDuplicateListingNode,
  workflowNodeFromAutoListingStage,
  workflowReviewReconcileNode,
} from "./workflowRuns.js";
export { evaluateSourcingCandidate, filterSourcingCandidates, buildProcurementEvidenceSummary } from "./sourcingRules.js";


const DATA_DIR = path.resolve("data");

export function postSubmissionStockReadiness({ submitItems = [], taskId = "", storeId = "" } = {}) {
  const offerIds = (Array.isArray(submitItems) ? submitItems : [])
    .map((row) => String(row?.offer_id || row?.offerId || "").trim())
    .filter(Boolean);
  return {
    status: "blocked",
    reasonCode: "STOCK_CURRENT_EVIDENCE_REQUIRED",
    nextAction: "审核通过后读取对应 offer_id/warehouse_id 的当前库存，再执行库存预检",
    taskId: String(taskId || ""),
    storeId: String(storeId || ""),
    offerIds,
    targetCount: offerIds.length,
    verificationLevel: "locally_tested",
  };
}

export function listingDraftStoreMatches(existingJob = {}, requestedStoreId = "") {
  const requested = String(requestedStoreId || "").trim();
  if (!requested) return true;
  const existing = String(existingJob.storeId || existingJob.entity?.storeId || "").trim();
  return Boolean(existing) && existing === requested;
}
const JOB_FILE = path.join(DATA_DIR, "auto-listing-jobs.json");
const RMB_TO_RUB = 13.5;
const PURCHASE_COST_MARKUP_RMB = 5;
const PACKAGE_WEIGHT_PADDING_G = 50;
const PACKAGE_SIZE_PADDING_MM = 20;
const MAX_OZON_IMAGE_PREPARE_COUNT = toNumber(process.env.OZON_IMAGE_PREPARE_COUNT, 8);
const STRICT_MATCH_MIN_CONFIDENCE = toNumber(process.env.OZON_MATCH_STRICT_CONFIDENCE, 50);
const SIMILAR_MATCH_MIN_CONFIDENCE = toNumber(process.env.OZON_MATCH_SIMILAR_CONFIDENCE, 35);
const STRICT_MIN_MARGIN = toNumber(process.env.OZON_MATCH_STRICT_MARGIN, 15);
const SIMILAR_MIN_MARGIN = toNumber(process.env.OZON_MATCH_SIMILAR_MARGIN, 5);
const SIMILAR_MAX_MARKET_GAP_PCT = toNumber(process.env.OZON_MATCH_SIMILAR_MAX_MARKET_GAP_PCT, 25);
const ENABLE_VOLUME_FALLBACK = String(process.env.OZON_ENABLE_VOLUME_FALLBACK || "1") !== "0";
const VOLUME_MIN_MARGIN = toNumber(process.env.OZON_VOLUME_MIN_MARGIN, 2);
const VOLUME_MAX_MARKET_GAP_PCT = toNumber(process.env.OZON_VOLUME_MAX_MARKET_GAP_PCT, 35);
const ENABLE_VISUAL_CARD_PROMPT = String(process.env.OZON_ENABLE_VISUAL_CARD_PROMPT || "1") !== "0";
const ENABLE_IMAGE_OCR_FOR_LISTING = String(process.env.OZON_IMAGE_OCR_ENABLED || "1") !== "0";
const JOB_STALE_TIMEOUT_MS = toNumber(process.env.OZON_JOB_STALE_TIMEOUT_MS, 30 * 60 * 1000);
const AI_MATCH_LIMIT = toNumber(process.env.OZON_AI_MATCH_LIMIT, 8);
const LLM_TIMEOUT_MS = toNumber(process.env.OZON_LLM_TIMEOUT_MS, 12_000);
var jobsWriteChain = Promise.resolve();
var jobsMutationChain = Promise.resolve();

function nowIso() { return new Date().toISOString(); }
function makeId(prefix) { return prefix + Date.now() + Math.random().toString(36).slice(2, 7); }
function toNumber(v, f) { var n = Number(v); return Number.isFinite(n) ? n : (f || 0); }
export function getOzonImagePrepareLimit() { return MAX_OZON_IMAGE_PREPARE_COUNT; }
export function isOzonImageOcrEnabledForListing() { return ENABLE_IMAGE_OCR_FOR_LISTING; }
function roundMoney(v) { return Math.round(Number(v) * 100) / 100; }
export function minPriceFromPrice(price) {
  var n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return "";
  var floored = Math.floor(n);
  return String(Math.max(1, Number.isInteger(n) ? floored - 1 : floored));
}

function pricingDiagnosisFromCalculation({
  sourcePriceCny = 0,
  purchaseCost = 0,
  packageInfo = {},
  priceCalc = {},
  priceCny = 0,
  oldPriceCny = 0,
  minPriceCny = "",
  variants = [],
  pricingFields = null,
} = {}) {
  return {
    sourcePriceCny: roundMoney(sourcePriceCny || 0),
    purchaseMarkupRmb: PURCHASE_COST_MARKUP_RMB,
    purchaseCost: roundMoney(purchaseCost || 0),
    priceCny: roundMoney(priceCny || priceCalc.priceCny || priceCalc.nextPriceCny || 0),
    oldPriceCny: roundMoney(oldPriceCny || 0),
    minPriceCny: String(minPriceCny || ""),
    pricingPolicy: pricingFields?.pricingPolicy || null,
    oldPriceSource: pricingFields?.oldPriceSource || null,
    minPriceSource: pricingFields?.minPriceSource || null,
    marginFloor: pricingFields?.marginFloor || null,
    pricingBlocked: Boolean(pricingFields?.blocked),
    pricingBlockedReasonCode: pricingFields?.reasonCode || "",
    currencyCode: "CNY",
    logisticsFee: roundMoney(priceCalc.logisticsFee || 0),
    commission: roundMoney(priceCalc.commission || 0),
    commissionRate: Number(priceCalc.commissionRate ?? 0.15),
    commissionSource: priceCalc.commissionSource || defaultCommissionSource(),
    miscFee: roundMoney(priceCalc.miscFee || 0),
    baseCost: roundMoney(priceCalc.baseCost || 0),
    profit: roundMoney(priceCalc.profit || 0),
    profitRate: Number(priceCalc.profitRate || 0),
    converged: priceCalc.converged !== false,
    level: priceCalc.level ? {
      id: priceCalc.level.id || "",
      name: priceCalc.level.name || "",
      weightMinG: priceCalc.level.weightMinG,
      weightMaxG: priceCalc.level.weightMaxG,
      priceMinCny: priceCalc.level.priceMinCny,
      priceMaxCny: priceCalc.level.priceMaxCny,
      ratePerKg: priceCalc.level.ratePerKg,
      fixedFee: priceCalc.level.fixedFee,
    } : null,
    package: {
      weightG: Number(packageInfo.weight || packageInfo.weightG || 0),
      lengthMm: Number(packageInfo.depth || packageInfo.lengthMm || 0),
      widthMm: Number(packageInfo.width || packageInfo.widthMm || 0),
      heightMm: Number(packageInfo.height || packageInfo.heightMm || 0),
    },
    packageInfoSource: packageInfo.packageInfoSource || packageInfo.source || "",
    steps: Array.isArray(priceCalc.steps) ? priceCalc.steps.slice(-6) : [],
    variants,
  };
}

function defaultCommissionSource() {
  return {
    source: "manual_default",
    label: "手填/默认佣金率",
    confidence: "low",
  };
}

function resolveCommissionInput(job = {}, categoryMatch = null) {
  const learnedRate = extractCommissionRate(job.ozonContext?.commissions || job.commissions || []);
  const categoryKey = categoryMatch
    ? [categoryMatch.description_category_id, categoryMatch.type_id].map((item) => String(item || "")).filter(Boolean).join(":")
    : "";
  if (learnedRate > 0) {
    return {
      commissionRate: learnedRate,
      commissionSource: {
        source: "learned_product",
        label: "同类已上架商品学习",
        confidence: "medium",
        categoryKey,
      },
    };
  }
  return {
    commissionRate: 0.15,
    commissionSource: {
      ...defaultCommissionSource(),
      categoryKey,
    },
  };
}

function extractCommissionRate(commissions = []) {
  const rows = Array.isArray(commissions) ? commissions : [commissions];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const raw = [
      row.sales_percent,
      row.sale_percent,
      row.commission_percent,
      row.percent,
      row.rate,
    ].map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
    if (!raw) continue;
    return raw > 1 ? Math.round(raw) / 100 : raw;
  }
  return 0;
}

export function existingParentSkuForListing(job = {}) {
  return String(job.pendingParentSku || job.listingResult?.sku || "").trim();
}

function normalizeListingUrl(url = "") {
  var raw = String(url || "").trim();
  if (!raw) return "";
  try {
    var u = new URL(raw);
    var pathOnly = u.pathname.replace(/\/+$/, "");
    if (/1688\.com$/i.test(u.hostname) || /1688\.com/i.test(u.hostname)) {
      var offerId = pathOnly.match(/\/offer\/(\d+)\.html/i)?.[1];
      return offerId ? `1688:${offerId}` : `1688:${pathOnly.toLowerCase()}`;
    }
    if (/ozon\.ru$/i.test(u.hostname) || /ozon\.ru/i.test(u.hostname)) {
      var ozonId = pathOnly.match(/-(\d+)$/)?.[1] || pathOnly.match(/\/product\/([^/]+)/i)?.[1] || pathOnly;
      return `ozon:${String(ozonId).toLowerCase()}`;
    }
    return `${u.hostname.toLowerCase()}${pathOnly.toLowerCase()}`;
  } catch {
    return raw.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  }
}

export function findDuplicateListingJob(job, jobs = []) {
  var ozonKey = normalizeListingUrl(job?.ozonUrl || job?.ozonContext?.url || "");
  var candidateKey = normalizeListingUrl(job?.bestMatch?.candidateUrl || job?.candidateData?.url || "");
  var blockingStatuses = new Set(["live", "listed", "submitted", "submitted_to_ozon", "listing"]);
  return (jobs || []).find(function(other) {
    if (!other || other.id === job?.id) return false;
    if (!blockingStatuses.has(String(other.status || ""))) return false;
    if (!other.listingResult?.sku && !other.listingResult?.taskId && String(other.status || "") !== "live") return false;
    var otherOzonKey = normalizeListingUrl(other.ozonUrl || other.ozonContext?.url || "");
    var otherCandidateKey = normalizeListingUrl(other.bestMatch?.candidateUrl || other.candidateData?.url || "");
    return Boolean((ozonKey && ozonKey === otherOzonKey) || (candidateKey && candidateKey === otherCandidateKey));
  }) || null;
}

function tokenize(text) {
  return String(text || "").toLowerCase().split(/[\s,.;:!?/\\|()\[\]{}"']+/).map(function(t) { return t.trim(); }).filter(function(t) { return t.length >= 2; });
}

function fallbackSourcingKeywords(text = "") {
  var t = String(text || "").toLowerCase();
  var seeds = [];
  if (/чехол|iphone|телефон|смартфон/.test(t)) seeds.push("手机壳", "苹果手机壳", "透明手机壳");
  if (/игруш|собак|кош|питом|pet/.test(t)) seeds.push("宠物玩具", "狗狗玩具", "宠物用品");
  if (/брелок|сувенир|подар|gift/.test(t)) seeds.push("钥匙扣挂件", "创意礼品", "小礼品批发");
  if (/смол|эпоксид|молд|силикон|рукодел|украшен/.test(t)) seeds.push("滴胶模具", "树脂手作模具", "硅胶模具");
  if (/органайзер|ванн|кухн|хранен|дом/.test(t)) seeds.push("家居收纳", "浴室收纳", "厨房收纳");
  if (/корм|поил|feed|миска/.test(t)) seeds.push("宠物喂食器", "自动喂食器", "宠物用品");
  return [...new Set(seeds)].slice(0, 6);
}

function rankCandidatesForOzon(ozonItem, candidates) {
  var ozonTokens = new Set(tokenize((ozonItem.title || "") + " " + (ozonItem.category || "")));
  var ozonUrlTokens = new Set(tokenize(String(ozonItem.url || "").replace(/https?:\/\/|www\.|ozon\.ru|product/gi, " ")));
  return (candidates || [])
    .map(function(c) {
      var text = (c.title || "") + " " + (c.supplier || "");
      var tokens = tokenize(text);
      var hit = tokens.reduce(function(acc, t) { return acc + (ozonTokens.has(t) ? 1 : 0); }, 0);
      var cUrlTokens = tokenize(String(c.url || "").replace(/https?:\/\/|www\.|1688\.com|offer|detail/gi, " "));
      var linkHit = cUrlTokens.reduce(function(acc, t) { return acc + (ozonUrlTokens.has(t) ? 1 : 0); }, 0);
      var score = hit * 3 + linkHit * 8 + (Number(c.score || 0) / 20) + (Number(c.skuCount || 0) > 0 ? 1 : 0) + (c.sizeWeightReady ? 1 : 0);
      return { candidate: c, score: score };
    })
    .sort(function(a, b) { return b.score - a.score; })
    .map(function(row) { return row.candidate; });
}

function evaluateCandidate(matchResult, profitResult) {
  if (!matchResult || !matchResult.ok || !matchResult.match) {
    return { ok: false, reason: matchResult?.reason || matchResult?.error || "品类不匹配" };
  }
  if (!profitResult || !profitResult.ok) {
    return { ok: false, reason: profitResult?.reason || "利润计算失败" };
  }
  var confidence = toNumber(matchResult.confidence);
  var margin = toNumber(profitResult.margin);
  var marketGapTooLarge = profitResult.marketPriceOk === false && toNumber(profitResult.priceDiff, -999) < -SIMILAR_MAX_MARKET_GAP_PCT;
  if (confidence >= STRICT_MATCH_MIN_CONFIDENCE && margin >= STRICT_MIN_MARGIN && profitResult.marketPriceOk !== false) {
    return { ok: true, tier: "strict", score: confidence * 1.5 + margin * 2 };
  }
  if (confidence >= SIMILAR_MATCH_MIN_CONFIDENCE && margin >= SIMILAR_MIN_MARGIN && !marketGapTooLarge) {
    return { ok: true, tier: "similar", score: confidence + margin * 1.2 };
  }
  if (marketGapTooLarge) {
    return { ok: false, reason: "与Ozon竞品价差过大" };
  }
  return { ok: false, reason: "匹配度或利润不达标" };
}

function rejectedReasonSummary(rejected = []) {
  return (rejected || []).reduce(function(acc, row) {
    var key = String(row.reason || row.match?.reason || row.profit?.reason || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function rejectedSamples(rejected = [], limit = 5) {
  return (rejected || []).slice(0, limit).map(function(row) {
    return {
      id: row.candidate?.id || "",
      title: row.candidate?.title || "",
      url: row.candidate?.url || "",
      reason: row.reason || row.match?.reason || row.profit?.reason || "",
      margin: row.profit?.margin ?? null,
      confidence: row.match?.confidence ?? null,
    };
  });
}

export async function selectBestMatchForOzon(ozonItem, candidates = [], options = {}) {
  var aiLimit = Number.isFinite(Number(options.aiLimit)) ? Number(options.aiLimit) : AI_MATCH_LIMIT;
  var bestMatch = null;
  var volumeFallback = null;
  var rejected = [];
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    var matchResult = shouldUseAiMatch(i, aiLimit) ? await judgeMatch(ozonItem, candidate) : localJudgeMatch(ozonItem, candidate);
    var profit = calcProfit(ozonItem, candidate);
    if (ENABLE_VOLUME_FALLBACK && profit && profit.ok && isSameFamilyForFallback(ozonItem, candidate)) {
      var marginOk = toNumber(profit.margin) >= VOLUME_MIN_MARGIN;
      var marketGapOk = profit.marketPriceOk !== false || toNumber(profit.priceDiff, -999) >= -VOLUME_MAX_MARKET_GAP_PCT;
      if (marginOk && marketGapOk) {
        var fbScore = toNumber(profit.margin) * 1.5 + (100 - Math.abs(toNumber(profit.priceDiff, 0)));
        if (!volumeFallback || fbScore > volumeFallback.score) {
          volumeFallback = {
            candidate,
            match: matchResult,
            profit,
            tier: "volume_fallback",
            score: fbScore,
          };
        }
      }
    }
    var decision = evaluateCandidate(matchResult, profit);
    if (decision.ok) {
      var current = { candidate, match: matchResult, profit, tier: decision.tier, score: decision.score };
      if (!bestMatch || current.score > bestMatch.score) bestMatch = current;
    } else {
      rejected.push({ candidate, match: matchResult, profit, reason: decision.reason });
    }
  }
  if (!bestMatch && volumeFallback) {
    bestMatch = volumeFallback;
    if (!bestMatch.match || !bestMatch.match.ok) {
      bestMatch.match = { ok: true, match: true, confidence: 30, reason: "跑量兜底放行" };
    }
  }
  if (!bestMatch) {
    var profitFallbacks = candidates
      .map(function(candidate) {
        var profit = calcProfit(ozonItem, candidate);
        var marginOk = profit && profit.ok && toNumber(profit.margin) >= VOLUME_MIN_MARGIN;
        var marketGapOk = profit && (profit.marketPriceOk !== false || toNumber(profit.priceDiff, -999) >= -VOLUME_MAX_MARKET_GAP_PCT);
        return marginOk && marketGapOk ? { candidate, profit, score: toNumber(profit.margin) * 2 + Number(candidate.score || 0) / 20 } : null;
      })
      .filter(Boolean)
      .sort(function(a, b) { return b.score - a.score; });
    if (profitFallbacks.length) {
      var picked = profitFallbacks[0];
      bestMatch = {
        candidate: picked.candidate,
        match: { ok: true, match: true, confidence: 20, reason: "AI/同族匹配未通过，按利润和尺重进入跑量验证" },
        profit: picked.profit,
        tier: "volume_profit_fallback",
        score: picked.score,
      };
    }
  }
  return {
    ok: Boolean(bestMatch),
    bestMatch,
    rejected,
    rejectedReasons: rejectedReasonSummary(rejected),
    rejectedSamples: rejectedSamples(rejected),
    evaluatedCount: candidates.length,
  };
}

async function readJobs() {
  return JobRepository.readAutoListingJobs(JOB_FILE);
}
async function writeJobs(items) {
  jobsWriteChain = jobsWriteChain.then(function() {
    return JobRepository.writeAutoListingJobs(JOB_FILE, items);
  }).catch(function() {
    return JobRepository.writeAutoListingJobs(JOB_FILE, items);
  });
  await jobsWriteChain;
}

async function mutateJobs(mutator) {
  let output;
  const run = jobsMutationChain.catch(function() {}).then(async function() {
    const jobs = await readJobs();
    output = await mutator(jobs);
    await writeJobs(jobs);
  });
  jobsMutationChain = run.catch(function() {});
  await run;
  return output;
}

async function atomicWriteFileWithRetry(file, payload, retries) {
  var maxRetries = Number.isFinite(retries) ? retries : 8;
  await fs.mkdir(path.dirname(file), { recursive: true });
  var lastError = null;
  for (var i = 0; i <= maxRetries; i += 1) {
    var tempFile = file + ".tmp." + process.pid + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
    try {
      await fs.writeFile(tempFile, payload, "utf8");
      await fs.rename(tempFile, file);
      return;
    } catch (err) {
      lastError = err;
      try { await fs.unlink(tempFile); } catch (_) {}
      if (!err || (err.code !== "EPERM" && err.code !== "ENOENT" && err.code !== "EBUSY")) {
        break;
      }
      await sleep(40 * (i + 1));
    }
  }
  await fs.writeFile(file, payload, "utf8");
  if (lastError) return;
}

async function callLlm(systemPrompt, userPrompt, temperature, maxTokens, taskType = "generic_chat", responseFormat = "text") {
  var result = await callAiTask({
    taskType,
    systemPrompt,
    userPrompt,
    temperature: temperature || 0.1,
    maxTokens: maxTokens || 1024,
    responseFormat,
    timeoutMs: LLM_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, error: result.error || "AI 请求失败", provider: result.provider, cached: result.cached };
  return { ok: true, content: result.content, json: result.json, provider: result.provider, model: result.model, cached: result.cached };
}

export function shouldUseAiMatch(index, limit = AI_MATCH_LIMIT) {
  return Number(index || 0) < Math.max(0, Number(limit || 0));
}

export function localJudgeMatch(ozonItem, chengYuCandidate) {
  var ozonTitle = String(ozonItem?.title || "");
  var candidateTitle = String(chengYuCandidate?.title || "");
  var mismatch = productShapeMismatch(ozonItem, chengYuCandidate);
  if (mismatch) {
    return { ok: true, match: false, confidence: 0, reason: mismatch };
  }
  var ozonTokens = new Set(tokenize(ozonTitle + " " + String(ozonItem?.category || "")));
  var candidateTokens = tokenize(candidateTitle + " " + String(chengYuCandidate?.supplier || ""));
  var overlap = candidateTokens.reduce(function(count, token) {
    return count + (ozonTokens.has(token) ? 1 : 0);
  }, 0);
  if (isSameFamilyForFallback(ozonItem, chengYuCandidate)) {
    return {
      ok: true,
      match: true,
      confidence: Math.min(55, 35 + overlap * 5),
      reason: "本地同族匹配兜底",
    };
  }
  if (overlap >= 2) {
    return {
      ok: true,
      match: true,
      confidence: Math.min(45, 25 + overlap * 5),
      reason: "本地关键词重合兜底",
    };
  }
  return { ok: true, match: false, confidence: 0, reason: "本地匹配未命中" };
}

function productShapeMismatch(ozonItem, candidate) {
  var ozonText = [
    ozonItem?.title,
    ozonItem?.category,
    ozonItem?.description,
  ].filter(Boolean).join(" ").toLowerCase();
  var candidateText = [
    candidate?.title,
    candidate?.supplier,
    candidate?.parsed?.attributes?.map(function(a) { return [a.name, a.value].filter(Boolean).join(" "); }).join(" "),
    candidate?.attributes?.map?.(function(a) { return [a.name, a.value].filter(Boolean).join(" "); }).join(" "),
  ].filter(Boolean).join(" ").toLowerCase();

  var ozonPlushSoft = /плюш|мягк|антистресс|котик|котенок|кошка|毛绒|软|猫咪|猫|玩偶/.test(ozonText);
  var candidateMetal = /металл|сплав|цинк|эмал|бронз|золот|metal|alloy|enamel|zinc|合金|金属|珐琅|烤漆|电镀|古铜|镀金/.test(candidateText);
  if (ozonPlushSoft && candidateMetal) return "形态/材质冲突：Ozon是毛绒软玩具/猫咪挂件，1688是金属/合金/珐琅钥匙扣";

  var ozonMetal = /металл|сплав|цинк|эмал|metal|alloy|enamel|zinc|合金|金属|珐琅/.test(ozonText);
  var candidatePlushSoft = /плюш|мягк|антистресс|毛绒|软|玩偶|公仔/.test(candidateText);
  if (ozonMetal && candidatePlushSoft) return "形态/材质冲突：Ozon是金属类钥匙扣，1688是毛绒软玩具";

  return "";
}

// Step 1: Translate Russian title to Chinese keyword
export async function translateRusToCn(russianText) {
  var result = await callLlm(
    [
      "You are a cross-border e-commerce sourcing assistant.",
      "Translate Russian Ozon product titles into precise Chinese 1688 purchase search keywords.",
      "Return ONLY JSON: {\"keyword\":\"...\",\"keywords\":[\"...\"],\"productType\":\"...\",\"avoid\":[\"...\"]}.",
      "The main keyword must be under 20 Chinese characters.",
      "The keywords array must contain 3-6 specific 1688 searchable phrases for the SAME product type.",
      "Preserve the real use case and material. Remove brand names, platform words, marketing words, and counts.",
      "If the title mentions epoxy resin, jewelry, pendant, DIY craft, candle, plaster, or handmade molds, use craft/resin/jewelry mold terms and avoid baking/cake/chocolate/fondant molds unless the title explicitly says baking."
    ].join(" "),
    "Russian title: " + russianText,
    0.1, 500, "translate_title", "json"
  );
  if (!result.ok) {
    var fallbackKeywords = fallbackSourcingKeywords(russianText);
    if (fallbackKeywords.length) {
      return { ok: true, keyword: fallbackKeywords[0], keywords: fallbackKeywords, productType: "", avoid: [], fallback: true, reason: result.error };
    }
    return { ok: false, error: result.error };
  }
  try {
    var parsed = result.json || JSON.parse(result.content.replace(/```(?:json)?\s*([\s\S]*?)```/i, "$1").trim());
    var keyword = String(parsed.keyword || "").trim();
    if (!keyword) return { ok: false, error: "翻译结果为空" };
    var keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map(function(k) { return String(k || "").trim(); }).filter(Boolean) : [];
    keywords = [keyword].concat(keywords).filter(function(k, idx, arr) { return k && arr.indexOf(k) === idx; }).slice(0, 6);
    return {
      ok: true,
      keyword: keyword,
      keywords: keywords,
      productType: String(parsed.productType || ""),
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid.map(function(k) { return String(k || "").trim(); }).filter(Boolean) : [],
    };
  } catch (e) {
    return { ok: false, error: "翻译结果解析失败: " + result.content.slice(0, 100) };
  }
}

// Step 2: Check if 1688 candidate matches the Ozon opportunity
export async function judgeMatch(ozonItem, chengYuCandidate) {
  var mismatch = productShapeMismatch(ozonItem, chengYuCandidate);
  if (mismatch) {
    return { ok: true, match: false, confidence: 0, reason: mismatch };
  }
  var ozonTitle = String(ozonItem.title || "");
  var chengYuTitle = String(chengYuCandidate.title || "");
  var ozonPrice = toNumber(ozonItem.price);
  var candPrice = toNumber(chengYuCandidate.priceMin);

  var result = await callLlm(
    "You are a sourcing judge. Determine if the Ozon (Russian marketplace) product and the 1688 (Chinese wholesale) product are the SAME or closely related product category. Reply ONLY a JSON: {\"match\": true/false, \"confidence\": 0-100, \"reason\": \"...\"}",
    "Ozon product: " + ozonTitle + " (price: " + ozonPrice + " RUB)\n1688 product: " + chengYuTitle + " (price: " + candPrice + " CNY)\n\nAre these the same type of product?",
    0.1, 200, "match_candidate_basic", "json"
  );
  if (!result.ok) {
    if (isSameFamilyForFallback(ozonItem, chengYuCandidate)) {
      return { ok: true, match: true, confidence: 35, reason: "AI不可用，按同族商品跑量兜底匹配" };
    }
    return { ok: true, match: false, confidence: 0, reason: "AI不可用且未命中同族兜底" };
  }
  try {
    var parsed = result.json || JSON.parse(result.content.replace(/```(?:json)?\s*([\s\S]*?)```/i, "$1").trim());
    return {
      ok: true,
      match: Boolean(parsed.match),
      confidence: toNumber(parsed.confidence),
      reason: String(parsed.reason || ""),
    };
  } catch (e) {
    return { ok: false, error: "匹配判断解析失败" };
  }
}

// Step 3: Calculate profit
function calcProfit(ozonItem, candidate) {
  var ozonPrice = toNumber(ozonItem.price);
  var purchasePrice = toNumber(candidate.priceMin);
  var sw = (candidate.parsed && candidate.parsed.sizeWeight) || {};
  var weightG = toNumber(sw.weightG);
  var lenMm = toNumber(sw.lengthMm);
  var widMm = toNumber(sw.widthMm);
  var heiMm = toNumber(sw.heightMm);

  if (!purchasePrice || !weightG || !lenMm || !widMm || !heiMm) {
    return { ok: false, reason: "缺少价格或尺寸重量数据" };
  }

  try {
    var calc = calculateOzonPrice({
      purchaseCost: purchasePrice,
      weightG: weightG,
      lengthMm: lenMm,
      widthMm: widMm,
      heightMm: heiMm,
      profitRate: 0.25,
    });
    if (!calc.converged) return { ok: false, reason: "利润迭代未收敛" };
    var margin = Math.round((calc.profit / calc.priceCny) * 10000) / 100;
    var estPriceCny = calc.priceCny;
    var estRubPrice = Math.round(estPriceCny * 13.5);
    var marketPriceCny = ozonPrice > 0 ? Math.round((ozonPrice / 13.5) * 100) / 100 : 0;
    var marketPriceDiff = ozonPrice > 0 ? Math.round((ozonPrice - estRubPrice) / estRubPrice * 10000) / 100 : null;
    var marketPriceOk = !ozonPrice || estRubPrice <= Math.round(ozonPrice * 1.1);
    if (!marketPriceOk) {
      return {
        ok: false,
        reason: "预计售价高于Ozon前台价10%以上",
        basis: "cost_plus_market_check",
        purchasePriceCny: purchasePrice,
        estSellPriceCny: estPriceCny,
        estRubPrice: estRubPrice,
        actualOzonPrice: ozonPrice,
        marketPriceCny: marketPriceCny,
        priceDiff: marketPriceDiff,
        margin: margin,
      };
    }
    return {
      ok: true,
      basis: "cost_plus_market_check",
      targetProfitRate: 25,
      commissionRate: 15,
      miscFeeRate: 2,
      purchasePriceCny: purchasePrice,
      estSellPriceCny: estPriceCny,
      estProfitCny: Math.round(calc.profit * 100) / 100,
      margin: margin,
      estRubPrice: estRubPrice,
      actualOzonPrice: ozonPrice,
      marketPriceCny: marketPriceCny,
      marketPriceOk: marketPriceOk,
      priceDiff: marketPriceDiff,
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function buildOzonContext(ozonItem) {
  var detail = ozonItem.detail || {};
  var front = detail.frontSignals || {};
  var extraAttrs = [];
  if (front.type) extraAttrs.push({ name: "front_type", value: front.type });
  if (front.material) extraAttrs.push({ name: "front_material", value: front.material });
  if (front.weightG) extraAttrs.push({ name: "front_weight_g", value: String(front.weightG) });
  if (front.sizeCm) extraAttrs.push({ name: "front_size_cm", value: JSON.stringify(front.sizeCm) });
  return {
    title: ozonItem.title || detail.title || "",
    priceRub: toNumber(ozonItem.price || detail.price || 0),
    url: ozonItem.url || detail.url || "",
    category: ozonItem.category || detail.category || "",
    rating: toNumber(ozonItem.rating || detail.rating || front.rating || 0),
    reviewCount: toNumber(ozonItem.reviewCount || detail.reviewCount || front.reviewCount || 0),
    opportunityScore: toNumber(ozonItem.opportunityScore || 0),
    opportunityReasons: (ozonItem.opportunityReasons || []).slice(0, 10),
    commissions: Array.isArray(ozonItem.commissions) ? ozonItem.commissions : [],
    attributes: (detail.attributes || []).slice(0, 40).concat(extraAttrs),
    description: String(detail.description || "").slice(0, 2500),
    frontType: String(front.type || ""),
  };
}

function attr(id, value, complexId = 0) {
  var clean = String(value || "").trim();
  if (!clean) return null;
  return { id: Number(id), complex_id: Number(complexId || 0), values: [{ value: clean }] };
}

function fixedNoBrandAttribute() {
  return attr(85, "Нет бренда");
}

function isBrandAttributeMeta(meta = {}) {
  var id = Number(meta?.id || 0);
  var name = String(meta?.name || "").toLowerCase();
  return id === 85 || /бренд|brand|品牌/.test(name);
}

function isOriginCountryAttributeMeta(meta = {}) {
  var id = Number(meta?.id || 0);
  var name = String(meta?.name || "").toLowerCase();
  return id === 4389 || /страна-изготов|страна производства|origin country|country of origin|原产国|生产国|制造国/.test(name);
}

function dictionaryValueId(entry = {}) {
  return Number(entry.id || entry.dictionary_value_id || entry.value_id || 0);
}

function dictionaryValuesForAttribute(meta = {}, options = {}) {
  var id = Number(meta?.id || 0);
  if (!id) return [];
  var direct = options.attributeValuesById || {};
  if (Array.isArray(direct[id])) return direct[id];
  if (Array.isArray(direct[String(id)])) return direct[String(id)];
  if (Array.isArray(meta.dictionary_values)) return meta.dictionary_values;
  var categoryCache = options.categoryCache || {};
  var categoryMatch = options.categoryMatch || {};
  var cache = categoryCache.attributeValues || {};
  var keys = [
    attributeValueCacheKey({
      descriptionCategoryId: categoryMatch.description_category_id,
      typeId: categoryMatch.type_id,
      attributeId: id,
      language: "ZH_HANS",
    }),
    attributeValueCacheKey({
      descriptionCategoryId: categoryMatch.description_category_id,
      typeId: categoryMatch.type_id,
      attributeId: id,
      language: "RU",
    }),
  ];
  for (const key of keys) {
    if (Array.isArray(cache[key]?.values)) return cache[key].values;
  }
  var record = Object.values(cache).find(function(entry) {
    return Number(entry?.descriptionCategoryId || entry?.description_category_id || 0) === Number(categoryMatch.description_category_id || 0)
      && Number(entry?.typeId || entry?.type_id || 0) === Number(categoryMatch.type_id || 0)
      && Number(entry?.attributeId || entry?.attribute_id || 0) === id
      && Array.isArray(entry?.values);
  });
  return Array.isArray(record?.values) ? record.values : [];
}

function dictAttrForMeta(meta = {}, dictionaryValueIdInput) {
  var n = Number(dictionaryValueIdInput || 0);
  if (!n || !Number(meta?.id || 0)) return null;
  return { id: Number(meta.id), complex_id: attrMetaComplexId(meta), values: [{ dictionary_value_id: n }] };
}

function dictionaryAttrFromCurrentValues(meta = {}, options = {}, pattern) {
  var match = dictionaryValuesForAttribute(meta, options)
    .find(function(entry) { return pattern.test(String(entry?.value || entry?.name || "")); });
  return match ? dictAttrForMeta(meta, dictionaryValueId(match)) : null;
}

function fixedNoBrandAttributesForMeta(attrsMeta = [], options = {}) {
  var metas = (attrsMeta || []).filter(isBrandAttributeMeta);
  if (!metas.length && !(attrsMeta || []).length) return [fixedNoBrandAttribute()];
  return metas.map(function(meta) {
    if (Number(meta?.dictionary_id || 0)) {
      return dictionaryAttrFromCurrentValues(meta, options, /нет бренда|без бренда|no brand|без торговой марки|无品牌/i);
    }
    return attr(meta.id, "Нет бренда", attrMetaComplexId(meta));
  }).filter(Boolean);
}

function fixedChinaOriginAttributesForMeta(attrsMeta = [], options = {}) {
  return (attrsMeta || []).filter(isOriginCountryAttributeMeta).map(function(meta) {
    if (Number(meta?.dictionary_id || 0)) {
      return dictionaryAttrFromCurrentValues(meta, options, /китай|кнр|china|中国|中國/i);
    }
    return attr(meta.id, "Китай", attrMetaComplexId(meta));
  }).filter(Boolean);
}

function highConfidenceRequiredAttributes(attrsMeta = [], options = {}) {
  // Whitelist only: brand/no-brand and origin/China; dictionary ids must come from the current category values.
  return dedupeAttrs(
    fixedNoBrandAttributesForMeta(attrsMeta, options)
      .concat(fixedChinaOriginAttributesForMeta(attrsMeta, options))
      .filter(Boolean),
  );
}

function categoryAttributeCacheKey(categoryMatch = {}) {
  return `${Number(categoryMatch.description_category_id || 0)}:${Number(categoryMatch.type_id || 0)}`;
}

function attrsMetaForCategory(options = {}, categoryMatch = {}) {
  if (Array.isArray(options.attrsMeta)) return options.attrsMeta;
  var cached = options.categoryCache?.attributes?.[categoryAttributeCacheKey(categoryMatch)];
  return Array.isArray(cached) ? cached : [];
}

// The category cache is useful for local matching, but it is only submission
// evidence when the read receipt for the exact store/category is carried into
// the persisted preflight policy.  Keep this projection small: it contains
// receipt metadata, never credentials or the attribute payload itself.
export function categoryReadPolicyForListing(job = {}, cache = {}, categoryMatch = {}) {
  const sourceIs1688 = String(job.source || job.candidateData?.source || "").trim().toLowerCase() === "1688";
  const categoryKey = categoryAttributeCacheKey(categoryMatch);
  const tree = cache?.categoryReadEvidence?.tree || null;
  const attributes = cache?.categoryReadEvidence?.attributes?.[categoryKey] || null;
  const storeId = String(job.storeId || "").trim();
  const environmentRefHash = String(tree?.environmentRefHash || attributes?.environmentRefHash || "").trim();
  return {
    categoryEvidenceRequired: sourceIs1688,
    categoryEvidence: { tree, attributes },
    categoryEvidenceStoreId: storeId,
    categoryEvidenceEnvironmentRefHash: environmentRefHash,
    categoryEvidenceMaxAgeMs: undefined,
  };
}

export function modelAttributesForMeta(modelName, attrsMeta = []) {
  var modelMetas = (attrsMeta || []).filter(function(meta) {
    return Number(meta?.id || 0)
      && /название модели.*объедин|model.*(?:group|card)|模型名称|型号名称/i.test(String(meta?.name || ""));
  });
  if (!modelMetas.length) modelMetas = [{ id: 9048, attribute_complex_id: 0 }];
  return modelMetas.map(function(meta) {
    return attr(meta.id, modelName, attrMetaComplexId(meta));
  }).filter(Boolean);
}

function countryAttributes() {
  // Country must be sent as a category-specific dictionary value. Hardcoded
  // IDs caused duplicate weight/country errors across categories.
  return [];
}

export function buildListingDescription(lc = {}, fallbackTitle = "") {
  var title = String(lc.title_ru || fallbackTitle || "").replace(/\s+/g, " ").trim();
  var description = String(lc.description_ru || lc.annotation_ru || "").replace(/\s+/g, " ").trim();
  var annotation = String(lc.annotation_ru || "").replace(/\s+/g, " ").trim();
  var text = description || annotation || title;
  if (!text) return "";
  if (text.length < 60 && title && !text.includes(title)) {
    text = [title, text].filter(Boolean).join(". ");
  }
  return text.slice(0, 1500);
}

function attrIdsByName(attrsMeta, pattern) {
  return (attrsMeta || [])
    .filter(function(a) { return pattern.test(String(a?.name || "").toLowerCase()); })
    .map(function(a) { return Number(a.id || 0); })
    .filter(Boolean);
}

export function buildMarketingAttributes(lc, attrsMeta = []) {
  var tags = normalizeOzonHashtags(lc.hashtags_ru || "");
  var description = buildListingDescription(lc, lc.title_ru || "");
  var richIds = [11254].concat(attrIdsByName(attrsMeta, /rich|富内容|json/));
  var annotationIds = [4180].concat(attrIdsByName(attrsMeta, /аннотац|简介|注释|описани|商品描述/));
  var tagIds = [4184].concat(attrIdsByName(attrsMeta, /хештег|hashtag|тег|主题标签|标签/));
  return dedupeAttrs(
    richIds.map(function(id) {
      return isLikelyValidRichContent(lc.rich_content_json) ? attr(id, lc.rich_content_json || "") : null;
    })
      .concat(annotationIds.map(function(id) { return attr(id, description); }))
      .concat(tagIds.map(function(id) { return attr(id, tags); }))
      .filter(Boolean),
  );
}

function normalizeOzonHashtags(value = "") {
  return Array.from(new Set(
    (String(value || "").match(/#[^#\s]+|[^#\s]+/g) || [])
      .map(function(tag) {
        return "#" + String(tag || "")
          .replace(/^#+/, "")
          .replace(/[^\p{Script=Cyrillic}a-zA-Z0-9_-]/gu, "")
          .slice(0, 29);
      })
      .filter(function(tag) { return tag.length >= 3; }),
  ))
    .slice(0, 25)
    .join(" ");
}

function isLikelyValidRichContent(value) {
  if (!value) return false;
  try {
    var parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && Array.isArray(parsed.content) && parsed.content.length > 0;
  } catch {
    return false;
  }
}

function joinRussianList(items = []) {
  var clean = (items || []).map(function(x) { return String(x || "").trim(); }).filter(Boolean);
  if (clean.length <= 1) return clean[0] || "";
  if (clean.length === 2) return clean[0] + " и " + clean[1];
  return clean.slice(0, -1).join(", ") + " и " + clean[clean.length - 1];
}

export function normalizeOzonTitleForListing(raw, context = {}) {
  var sourceText = [
    raw,
    context.candidateTitle,
    context.ozonTitle,
    context.productType,
  ].filter(Boolean).join(" ").toLowerCase();
  var base = String(raw || context.fallback || "")
    .replace(/\s+/g, " ")
    .replace(/\bDIY\b/gi, "")
    .replace(/\bмолд(?:а|ы|ов)?\b/gi, "форма")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[，,;；。]+/g, " ")
    .replace(/[|/\\{}[\]"<>]+/g, " ")
    .trim();

  var isSiliconeMold = /силикон|硅胶/.test(sourceText) && /форм|молд|模具|模/.test(sourceText);
  var isCraftMold = isSiliconeMold && /эпоксид|смол|滴胶|树脂|свеч|蜡烛|香薰|гипс|石膏|мыл|肥皂|шоколад|巧克力|выпеч|烘焙/.test(sourceText);
  if (isCraftMold) {
    var shape = "";
    if (/пион|杜丹|牡丹|камел|山茶/.test(sourceText)) shape = "Пион и камелия";
    else if (/сердц|爱心|心形/.test(sourceText)) shape = "Сердце";
    else if (/цвет|花朵|花/.test(sourceText)) shape = "Цветок";
    var uses = [];
    if (/свеч|蜡烛|香薰/.test(sourceText)) uses.push("свечей");
    if (/эпоксид|смол|滴胶|树脂/.test(sourceText)) uses.push("изделий из эпоксидной смолы");
    if (/мыл|肥皂|ручн.*мыл/.test(sourceText)) uses.push("мыла ручной работы");
    if (!uses.length && /шоколад|巧克力|выпеч|烘焙/.test(sourceText)) uses.push("шоколада и выпечки");
    if (!uses.length) uses.push("творчества");
    base = ["Силиконовая форма", shape, "для " + joinRussianList(uses)].filter(Boolean).join(" ");
  }

  var seen = new Set();
  return base
    .split(/\s+/)
    .filter(function(word) {
      var key = word.toLowerCase();
      if (!key) return false;
      if (["и", "для", "из", "в", "на", "с"].includes(key)) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ")
    .replace(/\s+,/g, ",")
    .slice(0, 160)
    .trim();
}

function sanitizeListingTitle(raw, fallback = "", context = {}) {
  var cleaned = String(raw || fallback || "")
    .replace(/\s+/g, " ")
    .replace(/[|/\\{}[\]"<>]+/g, " ")
    .trim();
  var seen = new Set();
  var words = cleaned.split(/\s+/).filter(function(word) {
    var key = word.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return normalizeOzonTitleForListing(words.join(" "), { ...context, fallback }).slice(0, 180).trim();
}

async function fetchCategoryAttributes(store, categoryMatch) {
  return ozonRequest(store, "/v1/description-category/attribute", {
    description_category_id: Number(categoryMatch.description_category_id),
    type_id: Number(categoryMatch.type_id),
    language: "ZH_HANS",
  });
}

async function fetchAttributeValues(store, categoryMatch, attributeId, limit) {
  return ozonRequest(store, "/v1/description-category/attribute/values", {
    attribute_id: Number(attributeId),
    description_category_id: Number(categoryMatch.description_category_id),
    type_id: Number(categoryMatch.type_id),
    language: "ZH_HANS",
    limit: Number(limit || 200),
    last_value_id: 0,
  });
}

function dictAttr(id, dictionaryValueId) {
  var n = Number(dictionaryValueId || 0);
  if (!n) return null;
  return { id: Number(id), complex_id: 0, values: [{ dictionary_value_id: n }] };
}

function dictMultiAttr(id, dictionaryValueIds) {
  var values = (dictionaryValueIds || [])
    .map(function(v) { return Number(v || 0); })
    .filter(Boolean)
    .filter(function(v, idx, arr) { return arr.indexOf(v) === idx; })
    .slice(0, 3)
    .map(function(v) { return { dictionary_value_id: v }; });
  if (!values.length) return null;
  return { id: Number(id), complex_id: 0, values: values };
}

function findAttrByName(attrs, pattern) {
  return (attrs || []).find(function(a) { return pattern.test(String(a?.name || "").toLowerCase()); }) || null;
}

function textBagForAttributeHints(lc = {}, ozonContext = {}, productData = {}) {
  return [
    lc.title_ru,
    lc.product_type_ru,
    lc.description_ru,
    lc.annotation_ru,
    ozonContext.title,
    ozonContext.category,
    ozonContext.description,
    ...(Array.isArray(ozonContext.attributes) ? ozonContext.attributes.map(function(a) {
      return [a.name, a.value].filter(Boolean).join(" ");
    }) : []),
    productData.title,
    productData.category,
    ...(Array.isArray(productData.attributes) ? productData.attributes.map(function(a) {
      return [a.name, a.value].filter(Boolean).join(" ");
    }) : []),
    ...(Array.isArray(productData.skuVariants) ? productData.skuVariants.slice(0, 20).map(function(sku) {
      return [sku.spec, sku.name].filter(Boolean).join(" ");
    }) : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function sourceAttributeValue(pattern, ozonContext = {}, productData = {}) {
  var attrs = []
    .concat(Array.isArray(productData.attributes) ? productData.attributes : [])
    .concat(Array.isArray(ozonContext.attributes) ? ozonContext.attributes : []);
  var found = attrs.find(function(item) {
    return pattern.test(String(item?.name || item?.attribute_name || "").toLowerCase());
  });
  return String(found?.value || found?.attribute_value || "").replace(/\s+/g, " ").trim();
}

function sentenceWithPattern(text, pattern, fallback = "") {
  var clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  var parts = clean.split(/[.!?。！？]+/).map(function(p) { return p.trim(); }).filter(Boolean);
  return parts.find(function(p) { return pattern.test(p.toLowerCase()); }) || fallback;
}

function lazyAttributeValueForMeta(meta, context = {}) {
  var id = Number(meta?.id || 0);
  var name = String(meta?.name || "").toLowerCase();
  var lc = context.lc || {};
  var aiHint = lc.attributes_hint || {};
  var ozonContext = context.ozonContext || {};
  var productData = context.productData || {};
  var packageInfo = context.packageInfo || {};
  var hintText = textBagForAttributeHints(lc, ozonContext, productData);
  if (id === 11650) return "1";
  if (Number(meta?.dictionary_id || 0)) return "";

  if (/вес.*упаков|упаков.*вес|包装.*重|重量/.test(name)) {
    var weight = Math.round(Number(packageInfo.weight || 0));
    return weight > 0 ? String(weight) : "";
  }
  if (/колич.*завод.*упаков|количество.*упаков|factory.*pack|заводских упаковок/.test(name)) {
    return "1";
  }
  if (/материал|材料/.test(name)) {
    if (aiHint.material) return String(aiHint.material).trim();
    var material = pickTextHint("material", hintText);
    return material?.ru || sourceAttributeValue(/материал|材质|材料/, ozonContext, productData);
  }
  if (/цвет|商品颜色|颜色/.test(name)) {
    if (aiHint.color) return String(aiHint.color).trim();
    var color = pickTextHint("color", hintText);
    return color?.ru || sourceAttributeValue(/цвет|颜色/, ozonContext, productData);
  }
  if (/упаков|包装/.test(name)) {
    var packaging = sourceAttributeValue(/упаков|包装/, ozonContext, productData);
    if (/袋|пакет|bag/i.test(packaging || hintText)) return "пакетная упаковка";
    if (/盒|короб|box/i.test(packaging || hintText)) return "коробка";
    return packaging;
  }
  if (/комплектац|комплект|配套|套装/.test(name)) {
    return sourceAttributeValue(/комплектац|комплект|配套|包含|套装/, ozonContext, productData)
      || sentenceWithPattern(lc.description_ru || lc.annotation_ru, /комплект|в набор|состоит|包含|套装/, "");
  }
  if (/особен|характерист|特点|特征/.test(name)) {
    if (/антискольз|防滑/.test(hintText)) return "антискользящая конструкция";
    if (/автомат|自动/.test(hintText)) return "автоматическая подача";
    if (/мягк|плюш|毛绒|柔软/.test(hintText)) return "мягкая текстура";
    return sentenceWithPattern(lc.description_ru || lc.annotation_ru, /удоб|практич|подход|ежеднев|комфорт/, "");
  }
  if (/предназнач|назначен|для кого|适用|用途|目的/.test(name)) {
    if (aiHint.purpose) return String(aiHint.purpose).trim();
    if (/кош|кот|cat|猫/.test(hintText) && /собак|dog|狗/.test(hintText)) return "для кошек и собак";
    if (/кош|кот|cat|猫/.test(hintText)) return "для кошек";
    if (/собак|dog|狗/.test(hintText)) return "для собак";
  }
  return "";
}

export function buildLazyContentAttributeValues(attrsMeta = [], context = {}) {
  var existingIds = new Set((context.existingAttrs || []).map(function(a) { return Number(a?.id || 0); }).filter(Boolean));
  return dedupeAttrs((attrsMeta || [])
    .filter(function(meta) {
      var id = Number(meta?.id || 0);
      if (!id || existingIds.has(id)) return false;
      var name = String(meta?.name || "").toLowerCase();
      return /цвет|商品颜色|颜色|материал|材料|упаков|包装|комплектац|комплект|配套|особен|характерист|特点|特征|предназнач|назначен|适用|用途|目的/.test(name);
    })
    .slice(0, 10)
    .map(function(meta) {
      return attr(meta.id, lazyAttributeValueForMeta(meta, context));
    })
    .filter(Boolean));
}

function pickTextHint(kind, hintText) {
  if (kind === "material") {
    if (/пластик|пластмас|pp|пп|塑料/.test(hintText)) return { ru: "пластик", re: /пластик|пластмас/i };
    if (/силикон|硅胶/.test(hintText)) return { ru: "силикон", re: /силикон/i };
    if (/хлоп|cotton|棉/.test(hintText)) return { ru: "хлопок", re: /хлоп/i };
    if (/плюш|plush|毛绒/.test(hintText)) return { ru: "плюш", re: /плюш/i };
  }
  if (kind === "color") {
    if (/бел|white|白/.test(hintText)) return { ru: "белый", re: /бел/i };
    if (/черн|black|黑/.test(hintText)) return { ru: "черный", re: /черн/i };
    if (/роз|pink|粉/.test(hintText)) return { ru: "розовый", re: /роз/i };
    if (/син|blue|蓝/.test(hintText)) return { ru: "синий", re: /син/i };
  }
  return null;
}

function dedupeAttrs(attrs) {
  var map = new Map();
  (attrs || []).forEach(function(a) {
    if (!a || !Number(a.id)) return;
    var key = String(a.id) + ":" + String(a.complex_id || 0);
    // Prefer dictionary values over plain text values when both exist.
    var prev = map.get(key);
    var curHasDict = Array.isArray(a.values) && a.values.some(function(v) { return Number(v?.dictionary_value_id || 0) > 0; });
    var prevHasDict = prev && Array.isArray(prev.values) && prev.values.some(function(v) { return Number(v?.dictionary_value_id || 0) > 0; });
    if (!prev || (curHasDict && !prevHasDict)) map.set(key, a);
  });
  return Array.from(map.values());
}

function toErrorText(importErrors) {
  return (importErrors || []).map(function(e) {
    return [e?.message, e?.description, e?.attribute_name, e?.code].filter(Boolean).join(" ");
  }).join(" | ").toLowerCase();
}

export function splitImportWarningsAndErrors(errors = []) {
  var warnings = [];
  var blockingErrors = [];
  var listingDefects = [];
  for (const err of errors || []) {
    var level = String(err?.level || "").toLowerCase();
    var code = String(err?.code || "").toLowerCase();
    var text = [err?.message, err?.description].filter(Boolean).join(" ").toLowerCase();
    var failedVariantGrouping = code === "double_without_merger_offer"
      || /cannot merge|не удалось объединить|невозможно объединить/.test(text);
    var warningLike = level === "warning" || code.startsWith("warning_");
    if (failedVariantGrouping) listingDefects.push(err);
    else if (warningLike) warnings.push(err);
    else blockingErrors.push(err);
  }
  return { warnings, blockingErrors, listingDefects };
}

function normalizeModerationStatus(product = {}) {
  const status = product?.status;
  const state = String(
    (status && typeof status === "object" ? status.state || status.state_name || status.name : status)
      || product?.status_group
      || product?.status_name
      || "",
  ).trim().toLowerCase();
  if (["selling", "active", "published", "for_sale", "available"].includes(state)) return "ready";
  if (["failed", "moderation_failed", "rejected", "declined", "error"].includes(state)) return "failed";
  return state ? "pending" : "unknown";
}

export function normalizeOzonProductStatusProducts(input = {}) {
  const listItems = input?.listResponse?.result?.items || input?.listResponse?.items || [];
  const detailItems = input?.detailResponse?.result?.items || input?.detailResponse?.items || [];
  const errorsByOffer = input.errorsByOffer && typeof input.errorsByOffer === "object" ? input.errorsByOffer : {};
  const detailsByOffer = new Map();
  const detailsById = new Map();
  for (const detail of Array.isArray(detailItems) ? detailItems : []) {
    const offerId = String(detail?.offer_id || detail?.offerId || "").trim();
    const productId = Number(detail?.product_id || detail?.productId || detail?.id || 0);
    if (offerId) detailsByOffer.set(offerId, detail);
    if (productId > 0) detailsById.set(productId, detail);
  }
  const sourceItems = Array.isArray(listItems) && listItems.length ? listItems : (Array.isArray(detailItems) ? detailItems : []);
  return sourceItems.map((item) => {
    const offerId = String(item?.offer_id || item?.offerId || "").trim();
    const productId = Number(item?.product_id || item?.productId || item?.id || 0);
    const detail = detailsByOffer.get(offerId) || detailsById.get(productId) || null;
    const status = detail?.status ?? item?.status ?? "";
    const statusName = String(
      (status && typeof status === "object" ? status.state_name || status.name : "")
      || detail?.state_name || detail?.status_name || item?.state_name || item?.status_name || "",
    );
    return {
      offer_id: offerId,
      product_id: productId || Number(detail?.product_id || detail?.productId || detail?.id || 0),
      status,
      status_group: String(detail?.status_group || item?.status_group || ""),
      status_name: statusName,
      visible: typeof detail?.visible === "boolean" ? detail.visible : (typeof item?.visible === "boolean" ? item.visible : null),
      errors: (Array.isArray(detail?.errors) ? detail.errors : []).concat(Array.isArray(errorsByOffer[offerId]) ? errorsByOffer[offerId] : []),
    };
  });
}

export function normalizeImportReadiness(input = {}) {
  const importInfo = input.importInfo || {};
  const importItems = importInfo?.result?.items || importInfo?.items || [];
  const products = Array.isArray(input.products) ? input.products : [];
  const byOffer = new Map(products.map((p) => [String(p?.offer_id || p?.offerId || "").trim(), p]));
  const byId = new Map(products.map((p) => [Number(p?.product_id || p?.productId || 0), p]));
  const offers = (Array.isArray(importItems) ? importItems : []).map((item) => {
    const offerId = String(item?.offer_id || item?.offerId || "").trim();
    const productId = Number(item?.product_id || item?.productId || 0);
    const product = byOffer.get(offerId) || byId.get(productId) || null;
    const errors = (Array.isArray(item?.errors) ? item.errors : []).concat(Array.isArray(product?.errors) ? product.errors : []);
    const explicitCode = String(errors.find((e) => e?.code)?.code || "").trim();
    return {
      offerId,
      productId,
      importStatus: String(item?.status || "").trim().toLowerCase() || (productId > 0 ? "imported" : "accepted"),
      moderationStatus: normalizeModerationStatus(product),
      errors,
      errorReasonCode: explicitCode || (errors.length ? mapReasonCode(toErrorText(errors)) : ""),
    };
  });
  const imported = offers.some((o) => o.productId > 0 || o.importStatus === "imported");
  const failed = offers.some((o) => o.moderationStatus === "failed");
  const ready = offers.length > 0 && offers.every((o) => o.moderationStatus === "ready");
  const hasProductRead = products.length > 0;
  const state = failed ? "moderation_failed" : ready ? "ready_for_sale" : imported && hasProductRead ? "pending_moderation" : imported ? "imported" : "accepted";
  return {
    state,
    live: state === "ready_for_sale",
    taskId: Number(importInfo?.result?.task_id || importInfo?.task_id || 0) || null,
    offers,
  };
}

export async function reconcileImportedProductReadiness(job = {}, deps = {}) {
  const importInfo = job?.listingResult?.importInfo || {};
  const baseEvidence = normalizeImportReadiness({ importInfo });
  const pendingPatch = { status: "pending_moderation", stage: "pending_moderation", reasonCode: "", error: "" };
  if (typeof deps.readProductStatus !== "function") return { patch: pendingPatch, evidence: { ...baseEvidence, live: false, readStatus: "dependency_not_provided" } };
  const request = {
    storeId: String(job?.listingResult?.storeId || job?.storeId || "").trim(),
    taskId: Number(job?.listingResult?.taskId || baseEvidence.taskId || 0),
    offers: baseEvidence.offers.map((o) => ({ offerId: o.offerId, productId: o.productId })),
  };
  const readEnvironment = String(job?.listingResult?.environment || job?.environment || "").trim();
  if (readEnvironment) request.environment = readEnvironment;
  const jobStoreId = String(job?.storeId || "").trim();
  if (jobStoreId && request.storeId && jobStoreId !== request.storeId) {
    return { patch: { ...pendingPatch, reasonCode: "READ_STORE_SCOPE_MISMATCH" }, evidence: { ...baseEvidence, live: false, readStatus: "store_scope_mismatch" } };
  }
  if (!request.offers.length) return { patch: pendingPatch, evidence: { ...baseEvidence, live: false, readStatus: "no_offers", requestedOfferCount: 0, endpointAttempts: [], endpointAttempted: false } };
  try {
    const response = await deps.readProductStatus(request);
    const products = Array.isArray(response) ? response : Array.isArray(response?.products) ? response.products : (response?.listResponse || response?.detailResponse ? normalizeOzonProductStatusProducts(response) : response?.result?.items || []);
    const remoteRequestedOfferCount = Math.max(0, Number(response?.readAttempt?.requestedOfferCount || request.offers.length));
    const observed = new Set(products.flatMap((p) => [String(p?.offer_id || p?.offerId || "").trim(), String(p?.product_id || p?.productId || "").trim()].filter(Boolean)));
    const observedOfferCount = request.offers.filter((o) => observed.has(o.offerId) || observed.has(String(o.productId))).length;
    const coverageComplete = observedOfferCount >= request.offers.length && remoteRequestedOfferCount >= request.offers.length;
    const endpointFailures = Array.isArray(response?.readAttempt?.endpointFailures) ? response.readAttempt.endpointFailures.slice(0, 10) : [];
    const endpointAttempts = Array.isArray(response?.readAttempt?.endpointAttempts) ? response.readAttempt.endpointAttempts.slice(0, 10) : [];
    const readStatus = endpointFailures.length || !coverageComplete ? "partial" : "completed";
    const checkedAt = String(response?.readAttempt?.checkedAt || "").trim();
    const checkedAtMs = checkedAt ? Date.parse(checkedAt) : NaN;
    const updatedAtMs = Date.parse(String(job?.updatedAt || ""));
    const timestampInvalid = Boolean(checkedAt) && (!Number.isFinite(checkedAtMs) || checkedAtMs > Date.now() + 5 * 60 * 1000);
    const stale = Number.isFinite(checkedAtMs) && Number.isFinite(updatedAtMs) && checkedAtMs < updatedAtMs;
    const normalized = normalizeImportReadiness({ importInfo, products });
    const visibleProducts = products.filter((product) => product && (product.offer_id || product.offerId || product.product_id || product.productId));
    const visibilityComplete = visibleProducts.length >= request.offers.length && visibleProducts.every((product) => product.visible === true);
    const visibilityStatus = visibilityComplete
      ? "visible"
      : visibleProducts.some((product) => product.visible === false)
        ? "hidden"
        : "unknown";
    const evidence = { ...normalized, requestedOfferCount: request.offers.length, remoteRequestedOfferCount, observedOfferCount, coverageComplete, visibilityStatus, readStatus: timestampInvalid ? "timestamp_invalid" : stale ? "stale" : readStatus, freshnessStatus: timestampInvalid ? "invalid" : stale ? "stale" : (checkedAt ? "fresh" : "unknown"), freshnessReasonCode: timestampInvalid ? "READ_EVIDENCE_TIMESTAMP_INVALID" : stale ? "READ_EVIDENCE_STALE" : "", endpointAttempts, endpointFailures, endpointAttempted: endpointAttempts.length > 0, operationEvidence: Array.isArray(response?.readAttempt?.operationEvidence) ? response.readAttempt.operationEvidence.slice(0, 10) : [] };
    const safeReady = normalized.state === "ready_for_sale" && normalized.live && coverageComplete && visibilityComplete && !timestampInvalid && !stale && !endpointFailures.length && Boolean(checkedAt) && endpointAttempts.includes("/v3/product/list") && endpointAttempts.includes("/v3/product/info/list");
    if (safeReady) return { patch: { status: "ready_for_sale", stage: "ready_for_sale", reasonCode: "", error: "" }, evidence: { ...evidence, live: true } };
    if (normalized.state === "moderation_failed" && !stale) return { patch: { status: "needs_review", stage: "moderation_failed", reasonCode: normalized.offers.find((o) => o.errorReasonCode)?.errorReasonCode || "MODERATION_FAILED", error: "Ozon 商品审核失败，需要修复。" }, evidence: { ...evidence, live: false } };
    return { patch: pendingPatch, evidence: { ...evidence, live: false } };
  } catch (error) {
    return { patch: pendingPatch, evidence: { ...baseEvidence, live: false, readStatus: "dependency_failed", readError: String(error?.message || error).slice(0, 200) } };
  }
}

export async function inspectAutoListingProductReadiness(job = {}, deps = {}) {
  const importInfo = job?.listingResult?.importInfo || {};
  const base = normalizeImportReadiness({ importInfo });
  if (!base.offers.length) {
    return {
      readOnly: true,
      evidenceSummary: { ...base, readStatus: "no_offers", live: false, requestedOfferCount: 0, endpointAttempted: false, offerCount: 0, offersTruncated: false },
      sellerView: { statusLabel: "尚未返回商品", reason: "当前任务没有可回查的 Offer。", nextAction: "检查 Ozon 导入任务和商品草稿。", offers: [], repairTasks: [] },
    };
  }
  let result;
  try {
    result = await reconcileImportedProductReadiness(job, deps);
  } catch {
    result = { evidence: { ...base, readStatus: "dependency_failed", live: false } };
  }
  const evidence = result.evidence || { ...base, readStatus: "unknown", live: false };
  const offers = (evidence.offers || []).slice(0, 100);
  const repairTasks = [];
  if (evidence.state === "moderation_failed") {
    for (const offer of offers.filter((o) => o.moderationStatus === "failed")) {
      const error = offer.errors?.[0] || {};
      repairTasks.push({
        taskId: evidence.taskId || Number(job?.listingResult?.taskId || 0),
        productId: offer.productId,
        offerId: offer.offerId,
        code: error.code || "MODERATION_FAILED",
        fieldPath: error.attribute_id ? `items[offer_id=${offer.offerId}].attributes[id=${error.attribute_id}]` : `items[offer_id=${offer.offerId}].attributes`,
        action: "定位字段后修复草稿，重新预检并人工确认提交。",
      });
    }
    if (!repairTasks.length) repairTasks.push({ taskId: evidence.taskId || Number(job?.listingResult?.taskId || 0), code: "MODERATION_FAILED", fieldPath: "items[*].attributes", action: "定位审核失败字段后修复草稿，重新预检。" });
  }
  const partial = evidence.readStatus === "partial" || evidence.coverageComplete === false;
  const statusLabel = evidence.live ? "已明确可售" : evidence.state === "moderation_failed" ? "审核失败" : partial ? "状态部分读取" : evidence.state === "pending_moderation" ? "Ozon 审核中" : evidence.readStatus === "dependency_failed" ? "状态读取失败" : "尚未明确可售";
  const reason = evidence.live
    ? "商品状态和可见性只读回查已确认可售。"
    : partial
      ? "本次只读回查只有部分 Seller API 响应，尚未完整确认商品状态。"
      : evidence.readStatus === "dependency_failed"
        ? "商品状态只读回查失败，未能确认当前状态。"
        : evidence.state === "moderation_failed"
          ? "Ozon 返回审核失败，需要修复商品资料。"
        : evidence.state === "ready_for_sale" && evidence.visibilityStatus === "hidden"
            ? "商品状态可能已到 selling，但 Ozon 返回 visible=false，不能按可售商品进入库存。"
            : evidence.state === "ready_for_sale" && evidence.visibilityStatus === "unknown"
              ? "商品状态返回了，但缺少每个 Offer 的可见性证据，不能确认可售。"
              : "当前商品尚未明确可售。";
  const nextAction = evidence.live
    ? "先执行对应 offer_id/warehouse_id 的库存预演，再决定库存写入。"
    : partial
      ? "检查失败的只读接口后重试；在完整回查前不要进入库存写入。"
      : evidence.state === "moderation_failed"
        ? "查看逐 Offer 审核错误并修复草稿，之后重新预检和人工确认。"
        : evidence.state === "ready_for_sale" && evidence.visibilityStatus === "hidden"
          ? "回到 Ozon 商品详情确认隐藏原因并修复；重新读取到 visible=true 前不要进入库存。"
          : evidence.state === "ready_for_sale" && evidence.visibilityStatus === "unknown"
            ? "重新读取商品详情并补齐每个 Offer 的 visible 状态；未形成完整证据前不要进入库存。"
            : "稍后重新回查审核状态；未确认可售前不要写入库存。";
  if (evidence.readStatus === "dependency_failed") {
    return {
      readOnly: true,
      sellerView: { statusLabel: "状态读取失败", reason: "商品状态只读回查失败，未能确认当前状态。", nextAction: "检查只读连接后重新回查；未确认可售前不要进入库存。", offers: [], repairTasks: [] },
    };
  }
  const evidenceAt = deps.now ? deps.now() : evidence.checkedAt || "";
  return {
    readOnly: true,
    evidenceSummary: { ...evidence, offerCount: base.offers.length, offersTruncated: base.offers.length > 100, offers: offers.map((o) => ({ offerId: o.offerId, productId: o.productId, status: o.moderationStatus, errors: o.errors?.slice(0, 3) || [] })) },
    sellerView: { statusLabel, reason, nextAction, evidenceAt: evidenceAt instanceof Date ? evidenceAt.toISOString() : String(evidenceAt), offers: offers.map((o) => ({ offerId: o.offerId, productId: o.productId, status: o.moderationStatus })), repairTasks },
  };
}

function needModelRetry(importErrors) {
  var text = toErrorText(importErrors);
  return /модел|model|型号/.test(text);
}

function needSizeWeightRetry(importErrors) {
  var text = toErrorText(importErrors);
  return /размер|вес|габарит|size|weight|尺寸|重量/.test(text);
}

function needCategoryTypeRetry(importErrors) {
  var text = toErrorText(importErrors);
  return /неверный тип|выбранная категория не соответствует|фото товара не соответствует его типу/.test(text);
}

export function shouldAutoRetryImport(itemCount, importErrors = []) {
  if (Number(itemCount || 0) !== 1 || !importErrors.length) return false;
  return needModelRetry(importErrors)
    || needSizeWeightRetry(importErrors)
    || needCategoryTypeRetry(importErrors)
    || needTitleRetry(importErrors);
}

export function importFeedbackState(input = {}) {
  var listingDefects = Array.isArray(input.listingDefects) ? input.listingDefects : [];
  var blockingErrors = Array.isArray(input.blockingErrors) ? input.blockingErrors : [];
  var importedItems = Array.isArray(input.importedItems) ? input.importedItems : [];
  if (listingDefects.length) {
    return { status: "needs_review", stage: "listing_defect", reasonCode: "VARIANT_GROUPING_FAILED" };
  }
  if (blockingErrors.length) {
    return { status: "failed", stage: "failed", reasonCode: mapReasonCode(toErrorText(blockingErrors)) };
  }
  if (importedItems.length) return { status: "live", stage: "live", reasonCode: "" };
  return { status: "submitted", stage: "submitted", reasonCode: "" };
}

export function importReconcileState(input = {}) {
  const listingDefects = Array.isArray(input.listingDefects) ? input.listingDefects : [];
  const blockingErrors = Array.isArray(input.blockingErrors) ? input.blockingErrors : [];
  const importedCount = Number(input.importedCount || 0);
  if (listingDefects.length) return { status: "needs_review", stage: "listing_defect", readiness: "import_defect" };
  if (blockingErrors.length) return { status: "failed", stage: "failed", readiness: "import_failed" };
  if (importedCount > 0) return { status: "pending_moderation", stage: "pending_moderation", readiness: "imported" };
  return { status: "submitted", stage: "submitted", readiness: "import_pending" };
}

function needTitleRetry(importErrors) {
  var text = toErrorText(importErrors);
  return /названи|повтор|title|标题/.test(text);
}

async function resolveSmartCategoryAttrs(store, categoryMatch, lc, packageInfo, ozonContext, productData = {}) {
  var attrsMetaResp = await fetchCategoryAttributes(store, categoryMatch).catch(function() { return null; });
  var attrsMeta = Array.isArray(attrsMetaResp?.result) ? attrsMetaResp.result : [];
  var countryAttr = findAttrByName(attrsMeta, /страна-изготов|страна производства/);
  var weightAttr = findAttrByName(attrsMeta, /вес товара,\s*г/);
  var typeAttr = findAttrByName(attrsMeta, /^тип$/);
  var genderAttr = findAttrByName(attrsMeta, /^пол$|性别|gender/);
  var intendedForAttr = findAttrByName(attrsMeta, /предназнач|专为|适用|用途/);
  var unitsInOneAttr = findAttrByName(attrsMeta, /единиц в одном товаре|一个商品中的件数|数量|件数/);
  var resolved = [];
  var marketingAttrs = buildMarketingAttributes(lc, attrsMeta);
  resolved.push(...marketingAttrs);

  if (countryAttr) {
    var countryValsResp = await fetchAttributeValues(store, categoryMatch, countryAttr.id, 200).catch(function() { return null; });
    var countryVals = Array.isArray(countryValsResp?.result) ? countryValsResp.result : [];
    var cn = countryVals.find(function(v) { return /китай|кнр|china|中国|中國/i.test(String(v.value || "")); });
    if (cn?.id) resolved.push(dictAttr(countryAttr.id, cn.id));
  }
  if (weightAttr && Number(packageInfo?.weight || 0) > 0) {
    resolved.push(attr(weightAttr.id, String(Math.round(Number(packageInfo.weight)))));
  }
  if (typeAttr) {
    var typeHint = String(lc?.product_type_ru || ozonContext?.frontType || "").trim();
    if (typeHint) {
      var typeValsResp = await fetchAttributeValues(store, categoryMatch, typeAttr.id, 200).catch(function() { return null; });
      var typeVals = Array.isArray(typeValsResp?.result) ? typeValsResp.result : [];
      var exact = typeVals.find(function(v) { return String(v.value || "").toLowerCase() === typeHint.toLowerCase(); });
      if (exact?.id) resolved.push(dictAttr(typeAttr.id, exact.id));
    }
  }
  if (genderAttr) {
    var genderValsResp = await fetchAttributeValues(store, categoryMatch, genderAttr.id, 50).catch(function() { return null; });
    var genderVals = Array.isArray(genderValsResp?.result) ? genderValsResp.result : [];
    var text = [lc?.title_ru, lc?.description_ru, ozonContext?.title, ozonContext?.category].filter(Boolean).join(" ").toLowerCase();
    var genderPattern = /女士|жен|woman|female/.test(text)
      ? /女士|жен/i
      : /男士|муж|man|male/.test(text)
        ? /男士|муж/i
        : /дет|ребен|ребён|child|kid|女孩|女童/.test(text)
          ? /女童|男童|дет/i
          : /女士|жен/i;
    var gender = genderVals.find(function(v) { return genderPattern.test(String(v.value || "")); }) || genderVals[0];
    if (gender?.id) resolved.push(dictAttr(genderAttr.id, gender.id));
  }
  if (intendedForAttr) {
    var intendedValsResp = await fetchAttributeValues(store, categoryMatch, intendedForAttr.id, 200).catch(function() { return null; });
    var intendedVals = Array.isArray(intendedValsResp?.result) ? intendedValsResp.result : [];
    var intendedText = [lc?.title_ru, lc?.description_ru, ozonContext?.title, ozonContext?.category].filter(Boolean).join(" ").toLowerCase();
    var picked = [];
    if (/кош|кот|cat|猫/.test(intendedText)) {
      var catVal = intendedVals.find(function(v) { return /猫|кош|кот|cat/i.test(String(v.value || "")); });
      if (catVal?.id) picked.push(catVal.id);
    }
    if (/собак|пес|dog|狗/.test(intendedText)) {
      var dogVal = intendedVals.find(function(v) { return /狗|собак|пес|dog/i.test(String(v.value || "")); });
      if (dogVal?.id) picked.push(dogVal.id);
    }
    if (!picked.length && intendedVals[0]?.id) picked.push(intendedVals[0].id);
    var intendedAttr = dictMultiAttr(intendedForAttr.id, picked);
    if (intendedAttr) resolved.push(intendedAttr);
  }
  if (unitsInOneAttr) {
    resolved.push(attr(unitsInOneAttr.id, "1"));
  }
  if (!resolved.some(function(a) { return Number(a.id) === 4958; })) {
    var requiredCatText = [lc?.title_ru, lc?.description_ru, ozonContext?.title, productData?.title].filter(Boolean).join(" ").toLowerCase();
    if (/кош|кот|cat|猫/.test(requiredCatText)) resolved.push(dictAttr(4958, 33754));
  }
  if (!resolved.some(function(a) { return Number(a.id) === 8962; })) {
    resolved.push(attr(8962, "1"));
  }
  var hintText = textBagForAttributeHints(lc, ozonContext, productData);
  var commonOptional = attrsMeta.filter(function(meta) {
    var name = String(meta?.name || "").toLowerCase();
    if (!Number(meta?.id || 0)) return false;
    if (resolved.some(function(a) { return Number(a.id) === Number(meta.id); })) return false;
    return /цвет|商品颜色|颜色|материал|材料|размер|尺寸|упаков|包装|комплектац|配套|объем|объ[её]м|容量|возраст|年龄|порода|корм|饲料|особен|特点|характерист/.test(name);
  }).slice(0, 12);
  for (const meta of commonOptional) {
    var name = String(meta.name || "").toLowerCase();
    if (/вес товара,\s*г/.test(name)) continue;
    if (Number(meta.id || 0) === 11650 || /колич.*завод.*упаков|количество.*упаков|factory.*pack|заводских упаковок/.test(name)) {
      resolved.push(attr(meta.id, "1"));
      continue;
    }
    if (/размер|尺寸/.test(name) && packageInfo?.depth && packageInfo?.width && packageInfo?.height) {
      resolved.push(attr(meta.id, `${packageInfo.depth}x${packageInfo.width}x${packageInfo.height} мм`));
      continue;
    }
    if (/материал|材料/.test(name)) {
      var material = pickTextHint("material", hintText);
      if (material && Number(meta.dictionary_id || 0)) {
        var materialValsResp = await fetchAttributeValues(store, categoryMatch, meta.id, 200).catch(function() { return null; });
        var materialVals = Array.isArray(materialValsResp?.result) ? materialValsResp.result : [];
        var materialVal = materialVals.find(function(v) { return material.re.test(String(v.value || "")); });
        if (materialVal?.id) resolved.push(dictAttr(meta.id, materialVal.id));
      } else if (material) {
        resolved.push(attr(meta.id, material.ru));
      }
      continue;
    }
    if (/цвет|颜色/.test(name)) {
      var color = pickTextHint("color", hintText);
      if (color && Number(meta.dictionary_id || 0)) {
        var colorValsResp = await fetchAttributeValues(store, categoryMatch, meta.id, 200).catch(function() { return null; });
        var colorVals = Array.isArray(colorValsResp?.result) ? colorValsResp.result : [];
        var colorVal = colorVals.find(function(v) { return color.re.test(String(v.value || "")); });
        if (colorVal?.id) resolved.push(dictAttr(meta.id, colorVal.id));
      } else if (color) {
        resolved.push(attr(meta.id, color.ru));
      }
    }
  }
  resolved.push(...buildLazyContentAttributeValues(attrsMeta, {
    lc,
    packageInfo,
    ozonContext,
    productData,
    existingAttrs: resolved,
  }));
  return dedupeAttrs(resolved.filter(Boolean));
}

function isRunningJobStatus(status) {
  return [
    "translating",
    "searching_1688",
    "waiting_crawl",
    "matching",
    "generating_content",
    "listing",
    "submitted_to_ozon",
  ].includes(String(status || ""));
}

function timeoutStageByStatus(status) {
  const s = String(status || "");
  if (s === "translating") return "translating";
  if (s === "searching_1688") return "searching_1688";
  if (s === "waiting_crawl") return "waiting_crawl";
  if (s === "matching") return "matching";
  if (s === "generating_content") return "generating_content";
  if (s === "listing" || s === "submitted_to_ozon") return "listing";
  return "unknown";
}

function inferTimeoutStage(job) {
  if (job?.timeoutStage) return String(job.timeoutStage);
  const text = String(job?.error || "").toLowerCase();
  if (text.includes("翻译")) return "translating";
  if (text.includes("搜索1688") || text.includes("searching_1688")) return "searching_1688";
  if (text.includes("等待1688") || text.includes("waiting_crawl")) return "waiting_crawl";
  if (text.includes("匹配")) return "matching";
  if (text.includes("生成")) return "generating_content";
  if (text.includes("上架") || text.includes("提交")) return "listing";
  const last = Array.isArray(job?.steps) && job.steps.length ? job.steps[job.steps.length - 1] : null;
  const a = String(last?.action || "");
  if (a) return timeoutStageByStatus(a);
  return "unknown";
}

function inferTimeoutStageFromHistory(job) {
  const byCurrent = inferTimeoutStage(job);
  if (byCurrent !== "unknown") return byCurrent;
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const s = String(steps[i]?.action || "").trim();
    const mapped = timeoutStageByStatus(s);
    if (mapped !== "unknown") return mapped;
    const detail = String(steps[i]?.detail || "").toLowerCase();
    if (detail.includes("翻译")) return "translating";
    if (detail.includes("搜索1688")) return "searching_1688";
    if (detail.includes("等待1688")) return "waiting_crawl";
    if (detail.includes("匹配")) return "matching";
    if (detail.includes("生成")) return "generating_content";
    if (detail.includes("上架") || detail.includes("提交")) return "listing";
  }
  return "unknown";
}

async function recoverStuckJobs() {
  var jobs = await readJobs();
  var now = Date.now();
  var changed = false;
  var recovered = jobs.map(function(job) {
    if (!isRunningJobStatus(job.status)) return job;
    var timeoutStage = timeoutStageByStatus(job.status);
    var ts = Date.parse(job.updatedAt || job.createdAt || "");
    if (!Number.isFinite(ts)) return job;
    if (now - ts < JOB_STALE_TIMEOUT_MS) return job;
    changed = true;
    var steps = Array.isArray(job.steps) ? job.steps.slice() : [];
    steps.push({
      action: "failed",
      detail: "任务超时自动回收(" + timeoutStage + ")（卡住超过 " + Math.round(JOB_STALE_TIMEOUT_MS / 60000) + " 分钟）",
      time: nowIso(),
    });
    return Object.assign({}, job, {
      status: "failed",
      error: "任务超时自动回收(" + timeoutStage + ")",
      timeoutStage: timeoutStage,
      steps: steps,
      updatedAt: nowIso(),
    });
  });
  if (changed) await writeJobs(recovered);
  return recovered;
}

export async function recoverInterruptedJobs() {
  var jobs = await readJobs();
  var changed = false;
  var recovered = jobs.map(function(job) {
    if (!isRunningJobStatus(job.status)) return job;
    var timeoutStage = timeoutStageByStatus(job.status);
    changed = true;
    var steps = Array.isArray(job.steps) ? job.steps.slice() : [];
    steps.push({
      action: "failed",
      detail: "后台重启后恢复中断任务(" + timeoutStage + ")",
      time: nowIso(),
    });
    return Object.assign({}, job, {
      status: "failed",
      error: "后台重启中断任务(" + timeoutStage + ")",
      reasonCode: "TIMEOUT",
      timeoutStage: timeoutStage,
      steps: steps,
      updatedAt: nowIso(),
    });
  });
  if (changed) await writeJobs(recovered);
  return { ok: true, recovered: recovered.filter(function(job) { return String(job.error || "").startsWith("后台重启中断任务"); }).length };
}

function safeFallbackPackageInfo(packageInfo) {
  return {
    weight: Math.max(120, Math.min(1200, Number(packageInfo?.weight || 300))),
    depth: Math.max(60, Math.min(300, Number(packageInfo?.depth || 120))),
    width: Math.max(50, Math.min(240, Number(packageInfo?.width || 100))),
    height: Math.max(30, Math.min(200, Number(packageInfo?.height || 80))),
  };
}

function inferFamily(text) {
  var t = String(text || "").toLowerCase();
  if (/брелок|ключ|keychain|挂件|钥匙扣|toy|игруш|玩具|plush|毛绒/.test(t)) return "toy_gift";
  if (/космет|флакон|бутыл|cream|serum|化妆|乳液|精华|真空瓶|瓶/.test(t)) return "beauty_packaging";
  if (/pet|кош|собак|宠物/.test(t)) return "pet";
  if (/mold|смол|силикон|форма|树脂|模具/.test(t)) return "craft_mold";
  return "general";
}

function isSameFamilyForFallback(ozonItem, candidate) {
  var ozonText = (ozonItem?.title || "") + " " + (ozonItem?.category || "");
  var candText = (candidate?.title || "") + " " + (candidate?.supplier || "");
  var ozonFamily = inferFamily(ozonText);
  var candFamily = inferFamily(candText);
  if (ozonFamily === "general" || candFamily === "general") return false;
  return ozonFamily === candFamily;
}

function normalizeImageUrlForOzon(url = "") {
  var value = String(url || "").trim();
  if (!value) return "";
  value = value.replace(/\.jpg_b\.jpg$/i, ".jpg");
  value = value.replace(/\.jpeg_b\.jpg$/i, ".jpeg");
  value = value.replace(/\.png_b\.jpg$/i, ".png");
  value = value.replace(/_+$/i, "");
  return value;
}

function normalizeImageUrlsForOzon(urls = []) {
  var seen = new Set();
  return (urls || []).map(normalizeImageUrlForOzon).filter(function(url) {
    if (!/^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url)) return false;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function cleanSkuSpec(spec = "") {
  return String(spec || "").replace(/\s+/g, " ").trim();
}

function variantRussianParts(spec = "") {
  var text = cleanSkuSpec(spec).toLowerCase();
  var parts = [];
  var map = [
    [/马卡龙/, "макаронные цвета"],
    [/混色|多色|彩色/, "микс цветов"],
    [/玻璃罩|玻璃|колпак из стекла|стекл/, "стеклянный колпак"],
    [/亚克力罩|亚克力|акрил/, "акриловый колпак"],
    [/米色|米白|米/, "бежевый"],
    [/白/, "белый"],
    [/黑/, "черный"],
    [/灰/, "серый"],
    [/粉/, "розовый"],
    [/红/, "красный"],
    [/蓝/, "синий"],
    [/绿/, "зеленый"],
    [/黄/, "желтый"],
    [/紫/, "фиолетовый"],
    [/橙|橘/, "оранжевый"],
    [/棕|咖啡/, "коричневый"],
    [/透明/, "прозрачный"],
  ];
  for (const [regex, value] of map) {
    if (regex.test(text)) parts.push(value);
  }
  var count = text.match(/(?:约|大约)?\s*(\d+)\s*(?:根|条|个|只|件|шт|pcs)?/i)?.[1];
  if (count) parts.push(count + " шт");
  if (!parts.length) {
    var ascii = text.match(/[a-z0-9]+/gi);
    if (ascii?.length) parts.push(ascii.slice(0, 3).join(" "));
  }
  return [...new Set(parts)];
}

export function variantRussianSuffix(spec = "", index = 0) {
  var parts = variantRussianParts(spec);
  return (parts.length ? parts : ["variant " + (index + 1)])
    .join(" ")
    .toLowerCase()
    .replace(/ё/g, "e")
    .replace(/[а-я]/g, function(ch) {
      var map = {
        а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y",
        к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
        ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e",
        ю: "yu", я: "ya",
      };
      return map[ch] || "";
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 64) || ("variant-" + (index + 1));
}

function variantDisplayValue(variant = {}, index = 0) {
  var parts = variantRussianParts(variant.spec || "");
  return (parts.length ? parts : ["вариант " + (index + 1)]).join(" ");
}

export function variantOfferId(parentSku, variant = {}, index = 0) {
  return String(parentSku || "").trim() + "-" + variantRussianSuffix(variant.spec || variant.skuId || "", index);
}

export function generatedOfferIdCollisions(parentSku = "", variants = []) {
  const groups = new Map();
  (Array.isArray(variants) ? variants : []).forEach((variant, index) => {
    const offerId = variantOfferId(parentSku, variant, index);
    if (!groups.has(offerId)) groups.set(offerId, []);
    groups.get(offerId).push({ ...variant, sourceSkuId: String(variant?.sourceSkuId || variant?.source_sku_id || variant?.skuId || variant?.sku_id || "").trim(), spec: String(variant?.spec || variant?.name || "") });
  });
  return [...groups.entries()].filter(([, rows]) => rows.length > 1).map(([offerId, rows]) => ({ offerId, rows }));
}

export function sourceVariantsForListing(parentSku, variants = [], options = {}) {
  return (Array.isArray(variants) ? variants : [])
    .map(function(variant, index) {
      const spec = String(variant?.spec || variant?.skuSpec || variant?.name || "").trim();
      if (!spec) return null;
      return {
        offerId: variantOfferId(parentSku, variant, index),
        ...(String(variant?.sourceSkuId || variant?.source_sku_id || variant?.skuId || variant?.sku_id || "").trim() ? { sourceSkuId: String(variant?.sourceSkuId || variant?.source_sku_id || variant?.skuId || variant?.sku_id || "").trim() } : {}),
        spec,
        image: variant?.image || variant?.imageUrl || "",
        source: "1688_sku_variant",
        ...(options.snapshotHash ? { sourceSnapshotHash: options.snapshotHash } : {}),
      };
    })
    .filter(Boolean);
}

export function sourceEvidenceBindingForListing(sourceEvidence = {}, variants = []) {
  const snapshotHash = String(sourceEvidence.snapshotHash || "");
  const canonicalUrl = String(sourceEvidence.canonicalUrl || "");
  const offerId = String(sourceEvidence.offerId || canonicalUrl.match(/offer\/(\d+)/i)?.[1] || "");
  const verificationState = String(sourceEvidence.verificationState || "");
  const bound = Boolean(snapshotHash && canonicalUrl && verificationState === "ok");
  return { source: "1688", status: bound ? "bound" : "missing", snapshotHash, canonicalUrl, offerId, verificationState, variantCount: Array.isArray(variants) ? variants.length : 0, nextAction: "预检会核对此快照与每个 Ozon SKU 的来源绑定。" };
}

export function dedupeSubmitItemsByOfferId(items = []) {
  var seen = new Set();
  return (items || []).filter(function(item) {
    var offerId = String(item?.offer_id || "").trim();
    if (!offerId || seen.has(offerId)) return false;
    seen.add(offerId);
    return true;
  });
}

function attrMetaComplexId(meta = {}) {
  return Number(meta.attribute_complex_id || meta.complex_id || 0);
}

function normalizeAspectText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{Script=Han}\p{Script=Cyrillic}a-z0-9]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dictionaryAspectAttribute(meta = {}, variant = {}, index = 0) {
  if (!Number(meta?.dictionary_id || 0)) return null;
  var candidates = [
    variantDisplayValue(variant, index),
    variantRussianParts(variant.spec || "").join(" "),
    String(variant.spec || ""),
  ].map(normalizeAspectText).filter(Boolean);
  var match = (meta.dictionary_values || []).find(function(entry) {
    var value = normalizeAspectText(entry?.value || "");
    return value && candidates.some(function(candidate) {
      return value === candidate || value.includes(candidate) || candidate.includes(value);
    });
  });
  return match?.id ? {
    id: Number(meta.id),
    complex_id: attrMetaComplexId(meta),
    values: [{ dictionary_value_id: Number(match.id) }],
  } : null;
}

export function variantAspectAttributes(variant = {}, attrsMeta = [], index = 0) {
  var aspects = (attrsMeta || []).filter(function(meta) { return meta?.is_aspect && Number(meta?.id || 0); });
  var specValue = variantDisplayValue(variant, index);
  var attrs = [];
  for (const meta of aspects) {
    var id = Number(meta.id || 0);
    var name = String(meta.name || "").toLowerCase();
    var value = "";
    var dictionaryAttribute = dictionaryAspectAttribute(meta, variant, index);
    if (dictionaryAttribute) {
      attrs.push(dictionaryAttribute);
      continue;
    }
    if (Number(meta?.dictionary_id || 0)) continue;
    if (id === 10097 || /颜色名称|название цвета|color name/.test(name)) {
      value = specValue;
    } else if (/длина|长度/.test(name) && Number(variant.lengthMm || 0) > 0) {
      value = String(Math.round((Number(variant.lengthMm) / 1000) * 100) / 100);
    } else if (/толщ|厚度/.test(name)) {
      var mm = String(variant.spec || "").match(/(\d+(?:[.,]\d+)?)\s*mm/i)?.[1]
        || String(variant.spec || "").match(/(\d+(?:[.,]\d+)?)\s*毫米/)?.[1];
      value = mm ? mm.replace(",", ".") : "";
    }
    if (value) attrs.push(attr(id, value, attrMetaComplexId(meta)));
  }
  return dedupeAttrs(attrs.filter(Boolean));
}

async function hydrateVariantAspectMetadata(store, categoryMatch, attrsMeta = []) {
  var hydrated = [];
  for (const meta of attrsMeta || []) {
    if (!meta?.is_aspect || !Number(meta?.dictionary_id || 0)) {
      hydrated.push(meta);
      continue;
    }
    var response = await fetchAttributeValues(store, categoryMatch, meta.id, 500).catch(function() { return null; });
    hydrated.push({
      ...meta,
      dictionary_values: Array.isArray(response?.result) ? response.result : [],
    });
  }
  return hydrated;
}

function attrDedupeKey(attribute = {}) {
  return String(attribute.id || "") + ":" + String(attribute.complex_id || 0);
}

export function mergeVariantListingAttributes(baseAttrs = [], variantAttrs = []) {
  var variantKeys = new Set((variantAttrs || []).filter(Boolean).map(attrDedupeKey));
  return dedupeAttrs((variantAttrs || [])
    .concat((baseAttrs || []).filter(function(attribute) {
      return !variantKeys.has(attrDedupeKey(attribute));
    }))
    .filter(Boolean));
}

export function mergeRetryModelAttributes(existingAttrs = [], brandAttribute = null, modelAttrs = []) {
  var replaceIds = new Set([85, 9048, 22390, 8229, 10350]);
  return dedupeAttrs([brandAttribute]
    .concat(modelAttrs || [])
    .concat((existingAttrs || []).filter(function(attribute) {
      return !replaceIds.has(Number(attribute?.id || 0));
    }))
    .filter(Boolean));
}

export function selectPreparedOzonImages(preparedRows = [], fallbackUrls = []) {
  var urls = (preparedRows || [])
    .filter(function(row) { return row && !row.skipped && row.url; })
    .map(function(row) { return String(row.url || "").trim(); })
    .filter(Boolean);
  if (!urls.length) {
    urls = (fallbackUrls || []).map(function(url) { return String(url || "").trim(); }).filter(Boolean);
  }
  return normalizeImageUrlsForOzon(urls).slice(0, 10);
}

function modelNameForListing(job, parentSku) {
  var raw = job.listingContent?.product_type_ru || job.bestMatch?.candidateTitle || job.ozonTitle || parentSku;
  return String(raw || parentSku)
    .replace(/\s+/g, " ")
    .replace(/[^\p{Script=Han}\p{Script=Cyrillic}a-zA-Z0-9\s-]/gu, "")
    .trim()
    .slice(0, 80) || parentSku;
}

function variantTitleForListing(baseTitle = "", variant = {}, index = 0) {
  var value = variantDisplayValue(variant, index);
  var title = String(baseTitle || "").replace(/\s+/g, " ").trim();
  if (!value || title.toLowerCase().includes(value.toLowerCase())) return title;
  return (title + ", " + value).slice(0, 250);
}

function packageSizeWeight(candidateData = {}) {
  var variants = Array.isArray(candidateData.skuVariants) ? candidateData.skuVariants : [];
  var sw = candidateData.sizeWeight || {};
  var weights = variants.map(function(v) { return toNumber(v.weightG); }).filter(Boolean);
  var lengths = variants.map(function(v) { return toNumber(v.lengthMm); }).filter(Boolean);
  var widths = variants.map(function(v) { return toNumber(v.widthMm); }).filter(Boolean);
  var heights = variants.map(function(v) { return toNumber(v.heightMm); }).filter(Boolean);
  var sourceWeight = weights.length ? Math.max.apply(null, weights) : toNumber(sw.weightG);
  var sourceLength = lengths.length ? Math.max.apply(null, lengths) : toNumber(sw.lengthMm);
  var sourceWidth = widths.length ? Math.max.apply(null, widths) : toNumber(sw.widthMm);
  var sourceHeight = heights.length ? Math.max.apply(null, heights) : toNumber(sw.heightMm);
  if (!sourceWeight || !sourceLength || !sourceWidth || !sourceHeight) {
    return { ok: false, reason: "1688货源缺少可信尺重，禁止自动上架" };
  }
  var weight = Math.round(sourceWeight + PACKAGE_WEIGHT_PADDING_G);
  var depth = Math.round(sourceLength + PACKAGE_SIZE_PADDING_MM);
  var width = Math.round(sourceWidth + PACKAGE_SIZE_PADDING_MM);
  var height = Math.round(sourceHeight + PACKAGE_SIZE_PADDING_MM);
  var safe = safeFallbackPackageInfo({ weight, depth, width, height });
  weight = safe.weight;
  depth = safe.depth;
  width = safe.width;
  height = safe.height;
  if (weight < 10 || depth < 10 || width < 10 || height < 10) {
    return { ok: false, reason: "尺重小于Ozon安全阈值，禁止自动上架" };
  }
  return {
    ok: true,
    sourceWeight,
    sourceLength,
    sourceWidth,
    sourceHeight,
    weight,
    depth,
    width,
    height,
  };
}

function trustedPackageInfoSourceForListingJob(job = {}) {
  const candidateData = job.candidateData || {};
  const packageEvidence = candidateData.sourceEvidence?.fields?.package;
  const snapshotHash = String(candidateData.sourceEvidence?.snapshotHash || "");
  if (packageEvidence && (String(packageEvidence.source || "") !== "page_content" || String(packageEvidence.evidenceRef || "") !== `snapshot:${snapshotHash.replace(/^sha256:/, "")}`)) return "";
  if (packageEvidence?.values && Object.entries(packageEvidence.values).some(([key, value]) => Number(value || 0) !== Number(candidateData.sizeWeight?.[key] || 0))) return "";
  const sizeWeight = candidateData.sizeWeight || {};
  const explicitSource = String(
    candidateData.packageInfoSource
    || sizeWeight.packageInfoSource
    || candidateData.packageSource
    || sizeWeight.source
    || "",
  ).trim();
  if (["1688_package", "manual_measurement", "manual_measured", "supplier_package"].includes(explicitSource)) {
    return explicitSource;
  }
  const sourceText = [
    candidateData.source,
    candidateData.sourceType,
    job.source,
    job.sourceType,
    job.bestMatch?.source,
    job.bestMatch?.sourceType,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  const urlText = [
    candidateData.url,
    candidateData.productUrl,
    job.url,
    job.bestMatch?.candidateUrl,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  if (/(^|\s)(1688|crawler1688|crawler_1688)(\s|$)/.test(sourceText) || /1688\.com/.test(urlText)) {
    return "1688_package";
  }
  return "";
}

function contentGenerationWorkflowSummary(listingContent = {}, candidate = {}, visualCard = null) {
  var product = candidate?.parsed || candidate || {};
  var titleRu = String(listingContent.title_ru || listingContent.title || listingContent.name || "");
  var description = String(listingContent.description_ru || listingContent.description || listingContent.annotation || "");
  var attributesHint = listingContent.attributes_hint || {};
  var images = Array.isArray(product.images) ? product.images : [];
  var variants = Array.isArray(product.skuVariants) ? product.skuVariants : [];
  var sw = product.sizeWeight || {};
  var contentIssues = [];
  if (!titleRu.trim()) contentIssues.push("缺少俄文标题");
  if (/[\u3400-\u9fff]/.test(titleRu + " " + description)) contentIssues.push("标题或描述含中文");
  if (!description.trim()) contentIssues.push("缺少俄文描述");
  if (images.length < 3) contentIssues.push("候选图片少于 3 张");
  if (!sw.weightG || !sw.lengthMm || !sw.widthMm || !sw.heightMm) contentIssues.push("候选缺少完整尺重");
  return {
    listingContentReady: Boolean(titleRu.trim() && description.trim()),
    titleRu,
    descriptionLength: description.length,
    attributeHintKeys: Object.keys(attributesHint).filter(function(key) {
      return attributesHint[key] !== undefined && attributesHint[key] !== null && String(attributesHint[key]).trim() !== "";
    }),
    candidateImageCount: images.length,
    skuVariantCount: variants.length,
    sizeWeightReady: Boolean(sw.weightG && sw.lengthMm && sw.widthMm && sw.heightMm),
    visualCardReady: Boolean(visualCard?.prompt || visualCard?.imageUrl || visualCard?.url),
    contentIssues,
  };
}

export function buildListingPayloadDraftFromJob(job = {}, options = {}) {
  const categoryMatch = options.categoryMatch || null;
  if (!categoryMatch) throw new Error("缺少 Ozon 类目，无法生成 payload 草稿");
  const lc = job.listingContent || {};
  const parentSku = String(options.parentSku || existingParentSkuForListing(job) || job.parentSku || job.id || "").trim();
  if (!parentSku) throw new Error("缺少父 SKU，无法生成 payload 草稿");
  const title = sanitizeListingTitle(lc.title_ru || "", job.ozonTitle || job.bestMatch?.candidateTitle || parentSku, {
    candidateTitle: job.bestMatch?.candidateTitle || job.candidateData?.title || "",
    ozonTitle: job.ozonTitle || job.ozonContext?.title || "",
    productType: lc.product_type_ru || "",
  });
  if (!title) throw new Error("上架标题为空，无法生成 payload 草稿");
  const description = buildListingDescription(lc, title);
  const visualCoverUrl = job.visualCard?.imageUrl || job.visualCard?.url || job.visualCard?.assetUrl || "";
  const ozonImages = normalizeImageUrlsForOzon([visualCoverUrl].concat((job.candidateData && job.candidateData.images) || []))
    .slice(0, MAX_OZON_IMAGE_PREPARE_COUNT);
  const packageInfo = packageSizeWeight(job.candidateData || {});
  if (!packageInfo.ok) throw new Error(packageInfo.reason || "候选缺少尺重，无法生成 payload 草稿");
  packageInfo.packageInfoSource = trustedPackageInfoSourceForListingJob(job);
  if (!packageInfo.packageInfoSource) throw new Error("候选缺少可信尺重来源，无法生成 payload 草稿");
  const bestMatchPrice = job.bestMatch ? job.bestMatch.purchasePriceCny : 0;
  const purchaseCost = Math.max(Number(bestMatchPrice || 0) + PURCHASE_COST_MARKUP_RMB, 1);
  const commissionInput = resolveCommissionInput(job, categoryMatch);
  const priceCalc = calculateOzonPrice({
    purchaseCost,
    weightG: packageInfo.weight,
    lengthMm: packageInfo.depth,
    widthMm: packageInfo.width,
    heightMm: packageInfo.height,
    profitRate: 0.3,
    ...commissionInput,
  });
  const finalPriceCny = roundMoney(priceCalc.priceCny || priceCalc.nextPriceCny || 0);
  if (!finalPriceCny) throw new Error("价格计算结果为空，无法生成 payload 草稿");
  const pricingPolicy = options.pricingPolicy || job.pricingPolicy || null;
  const pricingFields = derivePricingPolicyFields({
    priceCny: finalPriceCny,
    baseCost: priceCalc.baseCost || 0,
    policy: pricingPolicy,
  });
  const oldPriceCny = pricingFields.oldPriceCny;
  const minPriceCny = pricingFields.minPriceCny;
  const pricingDiagnosis = pricingDiagnosisFromCalculation({
    sourcePriceCny: bestMatchPrice,
    purchaseCost,
    packageInfo,
    priceCalc,
    priceCny: finalPriceCny,
    oldPriceCny,
    minPriceCny,
    pricingFields,
  });
  const procurement = buildProcurementEvidenceSummary(job.candidateData || {});
  const rawProcurement = job.candidateData?.procurementEvidence || {};
  const sourceHash = String(job.candidateData?.sourceEvidence?.snapshotHash || "");
  const refsMatch = [rawProcurement.supplierId, rawProcurement.supplierName, rawProcurement.moq, rawProcurement.priceTiers].filter(Boolean).every((field) => !field?.evidenceRef || field.evidenceRef === `snapshot:${sourceHash.replace(/^sha256:/, "")}`);
  const verificationState = procurement.status === "observed" && sourceHash && refsMatch ? "source_verified" : procurement.status === "needs_review" ? "manual_unverified" : "";
  pricingDiagnosis.procurementEvidence = { ...procurement, status: verificationState === "source_verified" ? "verified" : procurement.status, verificationState, sourceBacked: verificationState === "source_verified", reasonCode: procurement.status === "blocked" ? "PRICING_PROCUREMENT_EVIDENCE_MISSING" : verificationState === "manual_unverified" ? "PRICING_PROCUREMENT_EVIDENCE_MANUAL_UNVERIFIED" : "" , sellerAction: verificationState === "manual_unverified" ? "核对来源快照并人工确认采购证据" : procurement.nextAction, sideEffect: "不会提交 Ozon，不会修改价格或库存" };
  pricingDiagnosis.profitStatus = pricingDiagnosis.commissionSource?.source === "manual_default" ? "unknown" : "estimated";
  pricingDiagnosis.profitConclusion = pricingDiagnosis.profitStatus === "unknown" ? "unknown_without_trusted_commission_and_settlement_rules" : "estimated_from_local_policy";
  pricingDiagnosis.profitEvidence = { settlement: { status: "missing", nextAction: "当前店铺 Seller API 尚未提供结算费率和订单财务回执" } };
  const sourceEvidence = job.candidateData?.sourceEvidence || {};
  pricingDiagnosis.sourceEvidence = sourceEvidenceBindingForListing(sourceEvidence, job.candidateData?.skuVariants || []);
  const modelName = modelNameForListing(job, parentSku);
  const attrsMeta = attrsMetaForCategory(options, categoryMatch);
  const attributeOptions = {
    attributeValuesById: options.attributeValuesById || {},
    categoryCache: options.categoryCache || null,
    categoryMatch,
  };
  const requiredAttributeFillPlan = buildRequiredAttributeFillPlan({
    categoryMatch,
    attrsMeta,
    attributeValuesById: options.attributeValuesById || {},
    categoryCache: options.categoryCache || null,
    modelName,
    parentSku,
    productText: [
      title,
      description,
      categoryMatch.path || "",
      job.bestMatch?.candidateTitle || "",
      job.candidateData?.title || "",
      ...(job.candidateData?.attributes || []).map((entry) => `${entry?.name || ""} ${entry?.value || ""}`),
    ].filter(Boolean).join(" "),
    packageInfo,
  });
  const requiredAttributeFillSummary = summarizeRequiredAttributeFillPlan(requiredAttributeFillPlan);
  const requiredAttributeManualBacklog = buildRequiredAttributeManualBacklog(requiredAttributeFillPlan);
  const requiredAttributeRuleCandidateIndex = buildRequiredAttributeRuleCandidateIndex({
    categoryMatch,
    manualBacklog: requiredAttributeManualBacklog,
    fillPlan: requiredAttributeFillPlan,
  });
  const mediaAssets = Array.isArray(job.candidateData?.mediaAssets) ? job.candidateData.mediaAssets : [];
  const approvedRichContent = job.candidateData?.richContentJson && mediaAssets.length > 0 && mediaAssets.every((asset) => asset?.checks?.humanApproved === true && asset?.checks?.ocr?.status === "clear" && asset?.checks?.dimensions?.status === "clear" && asset?.checks?.sourceRisk === "clear");
  const sourceSnapshot = String(job.candidateData?.sourceEvidence?.snapshotHash || "");
  const mediaBlockers = mediaAssets.filter((asset) => sourceSnapshot && String(asset?.evidenceRef || "").startsWith("snapshot:") && !String(asset.evidenceRef).endsWith(sourceSnapshot.replace(/^sha256:/, ""))).map(() => ({ code: "MEDIA_SOURCE_SNAPSHOT_MISMATCH" }));
  const mediaReview = approvedRichContent && !mediaBlockers.length
    ? { status: "approved_detail_assets", issues: [], candidate: JSON.stringify(job.candidateData.richContentJson), compliance: { blockers: [] } }
    : (job.candidateData?.richContentJson ? { status: "needs_confirmation", issues: [...(job.candidateData?.mediaIssues || []), "collected_rich_content_requires_human_approval"], candidate: JSON.stringify(job.candidateData.richContentJson), compliance: { blockers: mediaBlockers } } : { status: "not_required", issues: [], compliance: { blockers: mediaBlockers } });
  const contentAttributes = approvedRichContent ? { ...lc, rich_content_json: JSON.stringify(job.candidateData.richContentJson) } : lc;
  const baseAttrs = dedupeAttrs(highConfidenceRequiredAttributes(attrsMeta, attributeOptions)
    .concat(modelAttributesForMeta(modelName, attrsMeta))
    .concat(countryAttributes())
    .concat(buildMarketingAttributes(contentAttributes, attrsMeta))
    .filter(Boolean));
  const item = {
    offer_id: parentSku,
    name: title,
    description: description || title,
    images: ozonImages,
    height: packageInfo.height,
    width: packageInfo.width,
    depth: packageInfo.depth,
    weight: packageInfo.weight,
    weight_unit: "g",
    dimension_unit: "mm",
    price: String(finalPriceCny),
    old_price: String(oldPriceCny),
    min_price: String(minPriceCny),
    currency_code: "CNY",
    vat: "0",
    description_category_id: Number(categoryMatch.description_category_id),
    type_id: Number(categoryMatch.type_id),
  };
  const skuVariants = (job.candidateData && job.candidateData.skuVariants) || [];
  let variantsForListing = Array.isArray(skuVariants)
    ? skuVariants.filter(function(v) { return cleanSkuSpec(v.spec || "") && Number(v.price || bestMatchPrice || 0) > 0; }).slice(0, SOURCING_MAX_SKU_COUNT)
    : [];
  // Keep a single real source SKU; it still needs a stable parent Offer ID.
  let submitItems = variantsForListing.length
    ? variantsForListing.map(function(variant, index) {
      const variantPackage = packageSizeWeight({ sizeWeight: job.candidateData?.sizeWeight || {}, skuVariants: [variant] });
      let variantPrice = finalPriceCny;
      let variantPricingFields = pricingFields;
      try {
        const variantPurchase = Math.max(Number(variant.price || bestMatchPrice || 0) + PURCHASE_COST_MARKUP_RMB, 1);
        const variantCalc = calculateOzonPrice({
          purchaseCost: variantPurchase,
          weightG: variantPackage.ok ? variantPackage.weight : packageInfo.weight,
          lengthMm: variantPackage.ok ? variantPackage.depth : packageInfo.depth,
          widthMm: variantPackage.ok ? variantPackage.width : packageInfo.width,
          heightMm: variantPackage.ok ? variantPackage.height : packageInfo.height,
          profitRate: 0.3,
          ...commissionInput,
        });
        variantPrice = roundMoney(variantCalc.priceCny || variantCalc.nextPriceCny || finalPriceCny);
        variantPricingFields = derivePricingPolicyFields({
          priceCny: variantPrice,
          baseCost: variantCalc.baseCost || 0,
          policy: pricingPolicy,
        });
        pricingDiagnosis.variants.push({
          offerId: variantOfferId(parentSku, variant, index),
          sourcePriceCny: roundMoney(Number(variant.price || bestMatchPrice || 0)),
          purchaseCost: roundMoney(variantPurchase),
          priceCny: variantPrice,
          oldPriceCny: variantPricingFields.oldPriceCny,
          minPriceCny: variantPricingFields.minPriceCny,
          oldPriceSource: variantPricingFields.oldPriceSource,
          minPriceSource: variantPricingFields.minPriceSource,
          marginFloor: variantPricingFields.marginFloor,
          baseCost: roundMoney(variantCalc.baseCost || 0),
          logisticsFee: roundMoney(variantCalc.logisticsFee || 0),
          commission: roundMoney(variantCalc.commission || 0),
          commissionRate: Number(variantCalc.commissionRate ?? commissionInput.commissionRate),
          commissionSource: variantCalc.commissionSource || commissionInput.commissionSource,
          level: variantCalc.level ? { id: variantCalc.level.id || "", name: variantCalc.level.name || "" } : null,
          package: {
            weightG: variantPackage.ok ? variantPackage.weight : packageInfo.weight,
            lengthMm: variantPackage.ok ? variantPackage.depth : packageInfo.depth,
            widthMm: variantPackage.ok ? variantPackage.width : packageInfo.width,
            heightMm: variantPackage.ok ? variantPackage.height : packageInfo.height,
          },
        });
      } catch {}
      const variantImage = normalizeImageUrlsForOzon([variant.image]).slice(0, 1);
      const itemImages = variantImage.length ? normalizeImageUrlsForOzon(variantImage.concat(ozonImages)) : ozonImages;
      return Object.assign({}, item, {
        offer_id: variantsForListing.length === 1 ? parentSku : variantOfferId(parentSku, variant, index),
        name: variantTitleForListing(title, variant, index),
        images: itemImages,
        price: String(variantPrice),
        old_price: String(variantPricingFields.oldPriceCny),
        min_price: variantPricingFields.minPriceCny,
        weight: variantPackage.ok ? variantPackage.weight : item.weight,
        depth: variantPackage.ok ? variantPackage.depth : item.depth,
        width: variantPackage.ok ? variantPackage.width : item.width,
        height: variantPackage.ok ? variantPackage.height : item.height,
        attributes: mergeVariantListingAttributes(baseAttrs, variantAspectAttributes(variant, attrsMeta, index)),
      });
    })
    : [Object.assign({}, item, baseAttrs.length ? { attributes: baseAttrs } : {})];
  const variantOfferIdCollisions = generatedOfferIdCollisions(parentSku, variantsForListing);
  if (!variantOfferIdCollisions.length) submitItems = dedupeSubmitItemsByOfferId(submitItems);
  const submitOfferIds = new Set(submitItems.map(function(entry) { return String(entry?.offer_id || "").trim(); }).filter(Boolean));
  const sourceVariants = sourceVariantsForListing(parentSku, variantsForListing, { snapshotHash: job.candidateData?.sourceEvidence?.snapshotHash || "" })
    .map((entry) => variantsForListing.length === 1 ? { ...entry, offerId: parentSku } : entry)
    .filter(function(entry) { return submitOfferIds.has(String(entry.offerId || "").trim()); });
  return {
    items: submitItems,
    summary: {
      parentSku,
      categoryPath: categoryMatch.path || "",
      itemCount: submitItems.length,
      variantCount: submitItems.length,
      imageCount: ozonImages.length,
      priceCny: finalPriceCny,
      pricingDiagnosis,
      requiredAttributeFillPlan,
      requiredAttributeFillSummary,
      requiredAttributeManualBacklog,
      requiredAttributeRuleCandidateIndex,
      sourceVariants,
      sourceEvidence: pricingDiagnosis.sourceEvidence,
      variantOfferIdCollisions,
      mediaReview,
    },
  };
}

async function saveWorkflowPayloadDraftForListingJob(job = {}) {
  const workflowRun = await findOrCreateWorkflowForAutoListingJob(job).catch(function() { return null; });
  if (!workflowRun) return null;
  let parentSku = existingParentSkuForListing(job);
  if (!parentSku) {
    const skuResult = await nextParentSku();
    parentSku = skuResult.parentSku;
    await updateJob(job.id, { pendingParentSku: parentSku });
  }
  const productForCategory = {
    title: [
      job.listingContent?.title_ru || "",
      job.bestMatch?.candidateTitle || "",
      job.ozonContext?.title || "",
      job.ozonContext?.category || "",
    ].filter(Boolean).join(" "),
    url: job.bestMatch?.candidateUrl || job.ozonUrl || "",
    attributes: (job.candidateData?.attributes || []).concat(job.ozonContext?.attributes || []),
    skuVariants: job.candidateData?.skuVariants || [],
  };
  const sourceIs1688 = String(job.source || job.candidateData?.source || "").toLowerCase() === "1688";
  const savedCategory = job.manualCategory || job.categorySelection || job.candidateData?.categorySelection || null;
  const savedCategoryIdsValid = Boolean(savedCategory && (savedCategory.description_category_id || savedCategory.descriptionCategoryId) && (savedCategory.type_id || savedCategory.typeId));
  const cache = await loadCategoryCache();
  const flatCategories = cache.flat || flattenCategories(cache.tree || []);
  // A seller-confirmed category is a business decision, not just UI metadata.
  // Re-resolve it against the current local dictionary before building the
  // payload; never silently replace it with a different auto-match.
  const manualCategoryMatch = savedCategoryIdsValid ? findCachedManualCategory({ flat: flatCategories }, savedCategory) : null;
  if (savedCategoryIdsValid && !manualCategoryMatch) {
    throw new Error("卖家确认的 Ozon 类目不在当前类目缓存中，请刷新类目后重新确认");
  }
  const categoryMatch = manualCategoryMatch || matchCategory(productForCategory, flatCategories, 3)[0] || null;
  if (!categoryMatch) throw new Error("未匹配到 Ozon 类目，无法刷新 payload 草稿");
  const attrsMeta = attrsMetaForCategory({ categoryCache: cache }, categoryMatch);
  const categoryReadPolicy = categoryReadPolicyForListing(job, cache, categoryMatch);
  const draft = buildListingPayloadDraftFromJob({ ...job, pendingParentSku: parentSku }, {
    categoryMatch,
    categoryCache: cache,
    parentSku,
  });
  draft.sourceEvidenceReview = job.candidateData?.sourceEvidence || null;
  draft.preflightPolicy = {
    sourceEvidenceRequired: sourceIs1688,
    sourceIdentityRequired: sourceIs1688,
    sourceVariantBindingRequired: sourceIs1688,
    savedCategory,
    savedCategoryIdsValid,
    ...categoryReadPolicy,
  };
  await savePayloadDraft(workflowRun.id, draft, {
    attrsMeta,
    sourceVariants: draft.summary?.sourceVariants || [],
  });
  if (draft.summary?.pricingDiagnosis) {
    const pricingNode = workflowNodeFromAutoListingStage("matching", {
      bestMatch: job.bestMatch || {},
      pricingDiagnosis: draft.summary.pricingDiagnosis,
      nodeStatus: "success",
    });
    await upsertWorkflowNode(workflowRun.id, {
      ...pricingNode,
      input: {
        autoListingJobId: job.id,
        sourcePriceCny: job.bestMatch?.purchasePriceCny || 0,
        purchaseMarkupRmb: PURCHASE_COST_MARKUP_RMB,
        package: draft.summary.pricingDiagnosis.package,
      },
      runStatus: "running",
    }).catch(function() {});
  }
  await upsertWorkflowNode(workflowRun.id, {
    key: "preflight_check",
    name: "提交前总闸",
    status: "pending",
    input: { autoListingJobId: job.id, payloadDraftReady: true },
    output: {
      payloadDraftReady: true,
      itemCount: draft.items.length,
      parentSku,
      categoryPath: categoryMatch.path || "",
      preflightPolicy: draft.preflightPolicy,
    },
    branch: "manual_validate",
    riskScore: 20,
    riskLevel: "low",
    reason: "上架内容已生成 payload 草稿，等待人工点击校验 Payload。",
    recommendedActions: ["校验 Payload", "检查图片/属性/变体", "必要时编辑草稿"],
    actions: ["validate_payload", "edit_payload"],
    runStatus: "running",
  }).catch(function() {});
  return { workflowRunId: workflowRun.id, draft, categoryMatch, parentSku };
}

export async function createListingWorkflowFrom1688Capture(captureId, { parsed = {}, storeId = "", captureReview = {} } = {}) {
  const id = String(captureId || "").trim();
  const item = await getCollectionItem(id, { storeId: String(storeId || "").trim() });
  if (!item) return { ok: false, reasonCode: "CAPTURE_NOT_FOUND", error: "没有找到采集箱商品" };
  const candidate = item.parsed || parsed || {};
  const persistedReview = captureReview && Object.keys(captureReview).length ? captureReview : (candidate.captureReview || {});
  const review = build1688CaptureImportReview({ capture: candidate.capture || {}, parsed: candidate, captureReview: persistedReview, existingCandidates: [] });
  if (review.status !== "approved") return { ok: false, reasonCode: review.blockers?.[0] || "CAPTURE_HUMAN_REVIEW_REQUIRED", captureReview: review, nextAction: "先完成人工快照确认，再生成商品草稿" };
  // The capture-box preflight button is repeatable. Reusing the same capture
  // must return its existing local draft/workflow instead of creating a second
  // seller task for every click or page refresh.
  const effectiveStoreId = String(storeId || item.storeId || "").trim();
  const existingJobs = await readJobs();
  const existing = existingJobs.find((job) => (
    String(job?.candidateId || "").trim() === id
      && listingDraftStoreMatches(job, effectiveStoreId)
  ));
  if (existing) {
    const workflowRun = await findOrCreateWorkflowForAutoListingJob(existing).catch(() => null);
    return {
      ok: true,
      duplicate: true,
      job: existing,
      workflowRunId: String(workflowRun?.id || existing.workflowRunId || ""),
      captureReview: review,
      nextAction: "打开已有商品草稿继续补齐资料并运行预检",
    };
  }
  const job = {
    id: makeId("al_"), candidateId: id, storeId: effectiveStoreId, source: "1688",
    status: "draft_pending", stage: "capture_handoff", steps: [], candidateData: { ...candidate, source: "1688", sourceEvidence: candidate.sourceEvidence || {} },
    bestMatch: { candidateTitle: candidate.title || "", candidateUrl: candidate.url || candidate.sourceEvidence?.canonicalUrl || "", source: "1688" },
    listingContent: {}, createdAt: nowIso(), updatedAt: nowIso(), sourceEvidenceReview: review,
  };
  await mutateJobs((jobs) => { jobs.push(job); });
  const workflowRun = await findOrCreateWorkflowForAutoListingJob(job).catch(() => null);
  return { ok: true, duplicate: false, job, workflowRunId: workflowRun?.id || "", captureReview: review, nextAction: "补齐俄文内容、类目、采购成本和媒体后运行预检" };
}

export async function createListingDraftFrom1688Candidate(candidateId, { storeId = "", storeIds = [], captureReview = {} } = {}) {
  const id = String(candidateId || "").trim();
  if (!id) return { ok: false, reasonCode: "CANDIDATE_ID_REQUIRED" };
  const candidates = await listCrawlerCandidates({ storeId, storeIds });
  const candidate = candidates.find((item) => String(item.id || "") === id);
  if (!candidate) return { ok: false, reasonCode: "1688_CANDIDATE_NOT_FOUND" };
  const effectiveStoreId = String(storeId || "").trim();
  const jobStoreId = String(candidate.storeId || effectiveStoreId || "").trim();
  const sameStore = !effectiveStoreId || !jobStoreId || jobStoreId === effectiveStoreId;
  if (!sameStore || (jobStoreId === effectiveStoreId && false)) return { ok: false, reasonCode: "1688_CANDIDATE_STORE_SCOPE_MISMATCH" };
  const parsed = candidate.parsed || candidate.product || candidate;
  const sourceUrl = String(candidate.url || parsed.url || parsed.sourceEvidence?.canonicalUrl || "").trim();
  const sourceEvidence = parsed.sourceEvidence || candidate.sourceEvidence || {};
  const persistedReview = captureReview && Object.keys(captureReview).length ? captureReview : (parsed.captureReview || {});
  const sourceEvidenceReview = build1688CaptureImportReview({ capture: parsed.capture || {}, parsed, captureReview: persistedReview, existingCandidates: candidates, candidateId: id });
  if (sourceEvidenceReview.status !== "approved") return { ok: false, reasonCode: sourceEvidenceReview.blockers?.[0] || "CAPTURE_HUMAN_REVIEW_REQUIRED", captureReview: sourceEvidenceReview, nextAction: "先确认当前 1688 快照，再进入草稿" };
  const jobs = await readJobs();
  // Reuse only the same source identity *and* store scope. Reusing a draft
  // found by URL alone can hand store B the draft (and category/read policy)
  // previously created for store A.
  const existing = jobs.find((job) => {
    const storeMatches = listingDraftStoreMatches(job, jobStoreId);
    return storeMatches && (String(job.candidateId || "") === id || (sourceUrl && String(job.candidateData?.url || "") === sourceUrl));
  });
  if (existing) return { ok: true, duplicate: true, job: existing, nextAction: "打开已有商品草稿继续处理" };
  const sourceVariants = Array.isArray(parsed.skuVariants) ? parsed.skuVariants : [];
  const sourceVariantIds = sourceVariants.map((variant) => String(variant?.source_sku_id || variant?.sku_id || "").trim()).filter(Boolean);
  const mediaEvidence = { buildCandidateMediaEvidenceSummary: true, imageCount: Array.isArray(parsed.images) ? parsed.images.length : 0 };
  const build1688SourceEvidenceContract = sourceEvidence;
  const sourceEvidenceContract = build1688SourceEvidenceContract;
  const now = nowIso();
  const job = {
    id: makeId("al_"), candidateId: id, storeId: String(candidate.storeId || storeId || "").trim(), source: "1688", status: "draft_pending", stage: "candidate_handoff", steps: [],
    candidateData: {
      ...parsed,
      source: "1688",
      url: sourceUrl,
      parseIssues: parsed.parseIssues || [],
      sourceEvidence: sourceEvidence,
      sourceVariantIds,
      snapshotHash: sourceEvidence.snapshotHash || "",
      verificationState: sourceEvidence.verificationState || "",
      mediaEvidence,
    },
    bestMatch: { candidateTitle: String(candidate.title || parsed.title || "").trim(), candidateUrl: sourceUrl, purchasePriceCny: Number(candidate.purchasePriceCny || sourceVariants[0]?.price || 0), source: "1688" }, listingContent: {}, createdAt: now, updatedAt: now,
  };
  await mutateJobs((items) => { items.push(job); });
  const workflowRun = await findOrCreateWorkflowForAutoListingJob(job).catch(() => null);
  return { ok: true, duplicate: false, job, workflowRunId: workflowRun?.id || "", sourceEvidenceReview, nextAction: "补俄文内容、类目、采购成本和媒体确认" };
}

export async function saveManualListingContent(jobId, input = {}) {
  const id = String(jobId || "").trim();
  const titleRu = String(input.title_ru || input.title || "").replace(/\s+/g, " ").trim();
  const descriptionRu = String(input.description_ru || input.description || "").replace(/\s+/g, " ").trim();
  if (!id) return { ok: false, reasonCode: "AUTO_LISTING_JOB_ID_REQUIRED" };
  if (titleRu.length < 5 || titleRu.length > 200) return { ok: false, reasonCode: "LISTING_TITLE_LENGTH_INVALID" };
  if (descriptionRu.length < 20 || descriptionRu.length > 5000) return { ok: false, reasonCode: "LISTING_DESCRIPTION_LENGTH_INVALID" };
  const job = await getAutoListingJob(id); if (!job) return { ok: false, reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" };
  const next = await updateJob(id, { listingContent: { ...(job.listingContent || {}), ...input, title_ru: titleRu, description_ru: descriptionRu, contentSource: "manual_seller", contentUpdatedAt: nowIso() }, status: "content_ready", stage: "content_manual_saved", error: "" });
  const payload = await saveWorkflowPayloadDraftForListingJob(next || job).catch(() => null);
  return { ok: true, job: next || job, payloadDraftReady: Boolean(payload?.draft), nextAction: "继续补类目/采购成本和媒体确认，重新运行商品预检" };
}

export function findCachedManualCategory(cache = {}, selection = {}) {
  const rows = Array.isArray(cache?.flat) ? cache.flat : [];
  const descriptionCategoryId = Number(selection.descriptionCategoryId || selection.description_category_id || 0);
  const typeId = Number(selection.typeId || selection.type_id || 0);
  const path = String(selection.path || "").replace(/\s+/g, " ").trim();
  return rows.find((row) => !row.disabled && Number(row.description_category_id || 0) === descriptionCategoryId && Number(row.type_id || 0) === typeId && String(row.path || "").replace(/\s+/g, " ").trim() === path) || null;
}
export async function saveManualListingCategory(jobId, input = {}) {
  const job = await getAutoListingJob(jobId); if (!job) return { ok: false, reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" };
  const savedCategory = { description_category_id: Number(input.description_category_id || input.descriptionCategoryId || 0), type_id: Number(input.type_id || input.typeId || 0), path: String(input.path || "") };
  if (!savedCategory.description_category_id || !savedCategory.type_id) return { ok: false, reasonCode: "LISTING_CATEGORY_REQUIRED" };
  const cache = await loadCategoryCache();
  if (!findCachedManualCategory(cache, savedCategory)) {
    return { ok: false, reasonCode: "LISTING_CATEGORY_NOT_IN_CACHE", nextAction: "先刷新 Ozon 类目缓存，再选择当前可用的类目和类型" };
  }
  const next = await updateJob(jobId, { manualCategory: savedCategory, status: "category_ready", stage: "category_manual_saved" });
  const payload = await saveWorkflowPayloadDraftForListingJob(next || job).catch(() => null);
  return { ok: true, job: next || job, payloadDraftReady: Boolean(payload?.draft), nextAction: "运行预检" };
}

export async function saveManualProcurementEvidence(jobId, input = {}) {
  const job = await getAutoListingJob(jobId); if (!job) return { ok: false, reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" };
  const next = await updateJob(jobId, { procurementEvidence: { ...input, evidenceSource: "seller_manual", savedAt: nowIso() }, stage: "procurement_manual_saved" });
  const payload = await saveWorkflowPayloadDraftForListingJob(next || job).catch(() => null);
  return { ok: true, job: next || job, payloadDraftReady: Boolean(payload?.draft), nextAction: "运行预检" };
}

export async function saveManualPackageEvidence(jobId, input = {}) {
  const job = await getAutoListingJob(jobId); if (!job) return { ok: false, reasonCode: "AUTO_LISTING_JOB_NOT_FOUND" };
  const next = await updateJob(jobId, { packageEvidence: { ...input, evidenceSource: "seller_manual", savedAt: nowIso() }, stage: "package_manual_saved" });
  const payload = await saveWorkflowPayloadDraftForListingJob(next || job).catch(() => null);
  return { ok: true, job: next || job, payloadDraftReady: Boolean(payload?.draft), nextAction: "运行预检" };
}

async function waitForImportInfo(store, taskId, attempts = 8, deps = {}) {
  if (!taskId) return null;
  const request = typeof deps.ozonRequest === "function" ? deps.ozonRequest : ozonRequest;
  const delay = typeof deps.sleep === "function" ? deps.sleep : sleep;
  for (var i = 0; i < attempts; i += 1) {
    if (i > 0) await delay(3000);
    try {
      var info = await request(store, "/v1/product/import/info", { task_id: Number(taskId) });
      var items = info?.result?.items || [];
      if (items.length && items.some(function(item) { return item.product_id || item.status === "failed" || (item.errors || []).length; })) {
        return info;
      }
    } catch (e) {
      if (i === attempts - 1) {
        return {
          __importInfoStatus: "unknown",
          error: String(e?.message || e || "import-info read failed"),
        };
      }
    }
  }
  return null;
}

async function generateBarcodesForImportedProducts(store, importInfo) {
  var productIds = (importInfo?.result?.items || [])
    .map(function(item) { return Number(item.product_id || 0); })
    .filter(Boolean);
  if (!productIds.length) return null;
  const request = ozonRequest;
  return request(store, "/v1/barcode/generate", { product_ids: productIds.slice(0, 100) });
}

async function emitAutoListingWorkflowNode(job, stage, data = {}) {
  const workflowRun = await findOrCreateWorkflowForAutoListingJob(job).catch(function() { return null; });
  if (!workflowRun) return null;
  const node = workflowNodeFromAutoListingStage(stage, data);
  await upsertWorkflowNode(workflowRun.id, {
    ...node,
    input: {
      autoListingJobId: job.id,
      opportunityId: job.opportunityId || "",
      ozonTitle: job.ozonTitle || "",
    },
    runStatus: data.runStatus || "running",
  }).catch(function() {});
  return workflowRun;
}

// Main orchestration: trigger auto-listing for an opportunity item


// Try to match against existing candidates first
export async function matchExistingCandidates(opportunityId) {
  var { listCrawlerCandidates, matchCandidatesWithOpportunities } = await import("./crawler1688.js");
  var items = await (await import("./ozonLearning.js")).listOzonLearningItems();
  var item = items.find(function(i) { return i.id === opportunityId; });
  if (!item) return { ok: false, error: "Ozon 商品未找到" };
  
  var allCandidates = await listCrawlerCandidates({});
  if (!allCandidates.length) return { ok: false, error: "1688 候选池为空" };
  
  var result = await matchCandidatesWithOpportunities([item], allCandidates);
  var matches = result.matches || [];
  
  // Add profit calculation for top matches
  var enriched = [];
  for (var m of matches.slice(0, 10)) {
    var cand = allCandidates.find(function(c) { return c.id === m.candidateId; });
    if (cand) {
      var profit = calcProfit(item, cand);
      m.profit = profit;
      enriched.push(m);
    }
  }
  
  return { ok: true, totalCandidates: allCandidates.length, matches: enriched };
}

function ozonItemFromJob(job = {}, learningItems = []) {
  const learned = learningItems.find((item) => item.id === job.opportunityId) || null;
  if (learned) return learned;
  const context = job.ozonContext || {};
  return {
    id: job.opportunityId || job.id || "",
    title: job.ozonTitle || context.title || "",
    price: job.ozonPrice || context.priceRub || context.price || 0,
    url: job.ozonUrl || context.url || "",
    category: context.category || "",
    detail: {
      attributes: context.attributes || [],
      description: context.description || "",
      frontSignals: {
        type: context.frontType || "",
      },
    },
  };
}

function workflowBestMatchOutput(bestMatch = null) {
  if (!bestMatch) return null;
  return {
    id: bestMatch.candidate?.id || "",
    title: bestMatch.candidate?.title || "",
    url: bestMatch.candidate?.url || "",
    tier: bestMatch.tier || "",
    margin: bestMatch.profit?.margin ?? null,
    confidence: bestMatch.match?.confidence ?? null,
    purchasePriceCny: bestMatch.profit?.purchasePriceCny ?? null,
    targetPriceCny: bestMatch.profit?.targetPriceCny || bestMatch.profit?.priceCny || bestMatch.profit?.estSellPriceCny || null,
    profitCny: bestMatch.profit?.profitCny ?? bestMatch.profit?.estProfitCny ?? null,
    priceDiff: bestMatch.profit?.priceDiff ?? null,
  };
}

export async function rerunAutoListingMatch(jobId, options = {}) {
  const job = await getAutoListingJob(jobId);
  if (!job) return { ok: false, error: "自动上架任务不存在: " + jobId };
  const { listCrawlerCandidates } = await import("./crawler1688.js");
  const learningItems = await listOzonLearningItems();
  const ozonItem = ozonItemFromJob(job, learningItems);
  const allCandidates = await listCrawlerCandidates({});
  const sourcingGate = filterSourcingCandidates(allCandidates);
  const rankedCandidates = rankCandidatesForOzon(ozonItem, sourcingGate.accepted).slice(0, Number(options.limit || 40));

  await updateJob(jobId, { status: "matching", stage: "matching" });
  await addStep(jobId, "match_rerun_started", "人工从工作流触发重新匹配，候选 " + rankedCandidates.length + " 个");
  await emitAutoListingWorkflowNode(job, "matching", { candidateCount: rankedCandidates.length });

  const matchResult = await selectBestMatchForOzon(ozonItem, rankedCandidates, {
    aiLimit: Object.prototype.hasOwnProperty.call(options, "aiLimit") ? options.aiLimit : AI_MATCH_LIMIT,
  });

  if (!matchResult.ok) {
    await emitAutoListingWorkflowNode(job, "matching", {
      candidateCount: rankedCandidates.length,
      evaluatedCount: matchResult.evaluatedCount,
      acceptedCount: 0,
      rejectedCount: matchResult.rejected.length,
      rejectedReasons: matchResult.rejectedReasons,
      rejectedSamples: matchResult.rejectedSamples,
      nodeStatus: "failed",
      runStatus: "waiting_human",
    });
    await updateJob(jobId, {
      status: "failed",
      stage: "matching",
      error: "重新匹配仍未找到满足匹配/利润规则的1688商品",
      reasonCode: "MATCH_FAILED",
    });
    await addStep(jobId, "match_rerun_failed", "重新匹配失败，需换货源或调整候选池");
    return {
      ok: false,
      jobId,
      status: "failed",
      error: "重新匹配仍未找到满足匹配/利润规则的1688商品",
      candidateCount: rankedCandidates.length,
      evaluatedCount: matchResult.evaluatedCount,
      rejectedReasons: matchResult.rejectedReasons,
    };
  }

  const bestMatch = matchResult.bestMatch;
  await updateJob(jobId, {
    status: "matched",
    stage: "matching",
    error: "",
    reasonCode: "",
    bestMatch: {
      id: bestMatch.candidate.id,
      candidateTitle: bestMatch.candidate.title,
      candidateUrl: bestMatch.candidate.url,
      purchasePriceCny: bestMatch.profit.purchasePriceCny,
      estProfitCny: bestMatch.profit.estProfitCny,
      margin: bestMatch.profit.margin,
      profitBasis: bestMatch.profit.basis,
      targetProfitRate: bestMatch.profit.targetProfitRate,
      estSellPriceCny: bestMatch.profit.estSellPriceCny,
      estRubPrice: bestMatch.profit.estRubPrice,
      actualOzonPrice: bestMatch.profit.actualOzonPrice,
      marketPriceCny: bestMatch.profit.marketPriceCny,
      priceDiff: bestMatch.profit.priceDiff,
      matchTier: bestMatch.tier,
      matchConfidence: bestMatch.match.confidence,
    },
    ozonContext: buildOzonContext(ozonItem),
    candidateData: {
      images: (bestMatch.candidate.parsed || bestMatch.candidate).images || [],
      sizeWeight: (bestMatch.candidate.parsed || bestMatch.candidate).sizeWeight || {},
      skuVariants: (bestMatch.candidate.parsed || bestMatch.candidate).skuVariants || [],
      attributes: (bestMatch.candidate.parsed || bestMatch.candidate).attributes || [],
    },
  });
  await addStep(jobId, "match_rerun_success", "重新匹配成功(" + bestMatch.tier + "): " + bestMatch.candidate.title);
  await emitAutoListingWorkflowNode({ ...job, bestMatch: { candidateId: bestMatch.candidate.id } }, "matching", {
    candidateCount: rankedCandidates.length,
    evaluatedCount: matchResult.evaluatedCount,
    acceptedCount: 1,
    rejectedCount: matchResult.rejected.length,
    rejectedReasons: matchResult.rejectedReasons,
    rejectedSamples: matchResult.rejectedSamples,
    bestMatch: workflowBestMatchOutput(bestMatch),
    nodeStatus: "success",
  });
  return {
    ok: true,
    jobId,
    status: "matched",
    candidateCount: rankedCandidates.length,
    evaluatedCount: matchResult.evaluatedCount,
    bestMatch: workflowBestMatchOutput(bestMatch),
  };
}

function candidateFromMatchedJob(job = {}) {
  const base = job.candidateData || {};
  return {
    id: job.bestMatch?.id || job.bestMatch?.candidateId || "",
    title: job.bestMatch?.candidateTitle || base.title || "",
    url: job.bestMatch?.candidateUrl || base.url || "",
    priceMin: job.bestMatch?.purchasePriceCny || base.priceMin || 0,
    parsed: {
      ...base,
      title: job.bestMatch?.candidateTitle || base.title || "",
      url: job.bestMatch?.candidateUrl || base.url || "",
    },
  };
}

function ozonItemFromMatchedJob(job = {}) {
  const context = job.ozonContext || {};
  return {
    id: job.opportunityId || job.id || "",
    title: job.ozonTitle || context.title || "",
    price: job.ozonPrice || context.priceRub || 0,
    url: job.ozonUrl || context.url || "",
    category: context.category || "",
    detail: {
      attributes: context.attributes || [],
      description: context.description || "",
      frontSignals: {
        type: context.frontType || "",
      },
    },
  };
}

export async function rerunAutoListingContent(jobId) {
  const job = await getAutoListingJob(jobId);
  if (!job) return { ok: false, error: "自动上架任务不存在: " + jobId };
  if (!job.bestMatch || !job.candidateData) {
    return { ok: false, error: "缺少已匹配候选，需先续跑 match_profit" };
  }

  const candidate = candidateFromMatchedJob(job);
  const ozonItem = ozonItemFromMatchedJob(job);
  const ozonContext = buildOzonContext(ozonItem);
  const match = {
    match: true,
    confidence: Number(job.bestMatch?.matchConfidence || 0),
    reason: String(job.bestMatch?.matchTier || "matched"),
  };
  const profit = {
    basis: job.bestMatch?.profitBasis,
    purchasePriceCny: job.bestMatch?.purchasePriceCny,
    estProfitCny: job.bestMatch?.estProfitCny,
    margin: job.bestMatch?.margin,
    estSellPriceCny: job.bestMatch?.estSellPriceCny,
    estRubPrice: job.bestMatch?.estRubPrice,
    actualOzonPrice: job.bestMatch?.actualOzonPrice,
    marketPriceCny: job.bestMatch?.marketPriceCny,
    priceDiff: job.bestMatch?.priceDiff,
  };

  await updateJob(jobId, { status: "generating_content", stage: "guided" });
  await addStep(jobId, "content_rerun_started", "人工从工作流触发重新生成上架内容");
  await emitAutoListingWorkflowNode(job, "generating_content", {
    bestMatch: job.bestMatch?.id || job.bestMatch?.candidateTitle || "",
  });

  const listingResult = await generateListingContentWithLlm(candidate.parsed || candidate, {
    ozonContext,
    match,
    profit,
  });
  if (!listingResult.enabled) {
    await emitAutoListingWorkflowNode(job, "generating_content", {
      nodeStatus: "failed",
      runStatus: "waiting_human",
      listingContentReady: false,
      contentIssues: ["LLM 未配置，无法生成上架内容"],
    });
    await updateJob(jobId, {
      status: "failed",
      stage: "guided",
      error: "LLM 未配置，无法生成上架内容",
      reasonCode: "CONTENT_GENERATION_FAILED",
    });
    await addStep(jobId, "content_rerun_failed", "LLM 未配置，无法生成上架内容");
    return { ok: false, jobId, error: "LLM 未配置，无法生成上架内容" };
  }

  let visualCard = null;
  if (ENABLE_VISUAL_CARD_PROMPT) {
    visualCard = {
      enabled: true,
      prompt: buildVisualCardPrompt({
        ozonContext,
        listingContent: listingResult.content,
        candidate: candidate.parsed || candidate,
      }),
    };
  }

  const summary = contentGenerationWorkflowSummary(listingResult.content, candidate, visualCard);
  const nextJob = {
    ...job,
    listingContent: listingResult.content,
    visualCard,
  };
  await updateJob(jobId, {
    status: "ready_for_listing",
    stage: "guided",
    error: "",
    reasonCode: "",
    listingContent: listingResult.content,
    visualCard,
  });
  let payloadDraftResult = null;
  try {
    payloadDraftResult = await saveWorkflowPayloadDraftForListingJob(nextJob);
    if (payloadDraftResult?.draft) {
      await addStep(jobId, "payload_draft_refreshed", "已刷新提交前 Payload 草稿，等待人工校验");
    }
  } catch (error) {
    await addStep(jobId, "payload_draft_refresh_failed", "Payload 草稿刷新失败: " + (error.message || String(error)));
  }
  await addStep(jobId, "content_rerun_success", "重新生成上架内容完成");
  await emitAutoListingWorkflowNode(job, "generating_content", {
    bestMatch: {
      id: job.bestMatch?.id || "",
      title: job.bestMatch?.candidateTitle || "",
      url: job.bestMatch?.candidateUrl || "",
    },
    ...summary,
    nodeStatus: "success",
  });
  return {
    ok: true,
    jobId,
    status: "ready_for_listing",
    contentReady: summary.listingContentReady,
    visualCardReady: summary.visualCardReady,
    payloadDraftReady: Boolean(payloadDraftResult?.draft),
    payloadDraftItemCount: payloadDraftResult?.draft?.items?.length || 0,
    titleRu: summary.titleRu,
    contentIssues: summary.contentIssues,
  };
}

export function deriveNewSourceKeywords(job = {}) {
  const seeds = [
    ...(Array.isArray(job.searchKeywords) ? job.searchKeywords : []),
    job.keyword || "",
    job.bestMatch?.candidateTitle || "",
    job.ozonTitle || "",
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const normalized = [];
  const seen = new Set();
  for (const seed of seeds) {
    const key = seed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(seed);
  }
  const fallback = String(job.ozonTitle || job.bestMatch?.candidateTitle || job.keyword || "").trim();
  if (!normalized.length && fallback) normalized.push(fallback);
  return normalized.slice(0, 6);
}

export async function requestAutoListingNewSource(jobId, options = {}) {
  const job = await getAutoListingJob(jobId);
  if (!job) return { ok: false, error: "自动上架任务不存在: " + jobId };
  const keywords = deriveNewSourceKeywords(job);
  if (!keywords.length) return { ok: false, error: "没有可用的换源关键词" };
  const createdTasks = [];
  for (const keyword of keywords.slice(0, Number(options.limit || 3))) {
    const task = await createCrawlerTask({
      sourceType: "keyword",
      sourceValue: keyword,
      options: {
        maxProducts: Number(options.maxProducts || 20),
        maxPages: Number(options.maxPages || 2),
        mustHaveSku: false,
        mustHaveSizeWeight: false,
      },
    });
    const taskId = (task && (task.task ? task.task.id : task.id)) || "";
    if (taskId) createdTasks.push(taskId);
  }
  const updatedJob = await updateJob(jobId, {
    status: "waiting_crawl",
    stage: "waiting_crawl",
    crawlerTaskIds: createdTasks,
    error: "",
    reasonCode: "",
  });
  await addStep(jobId, "new_source_requested", "真实换源已创建 1688 搜索任务: " + keywords.slice(0, 3).join(" / "));
  await emitAutoListingWorkflowNode(job, "waiting_crawl", {
    keyword: keywords[0],
    searchKeywords: keywords.slice(0, 3),
    crawlerTaskIds: createdTasks,
    nodeStatus: "running",
  });
  await saveWorkflowPayloadDraftForListingJob({
    ...job,
    searchKeywords: keywords,
  }).catch(function() {});
  return {
    ok: true,
    jobId,
    status: "waiting_crawl",
    keywords,
    crawlerTaskIds: createdTasks,
    updatedJob,
  };
}

export async function triggerAutoListing(opportunityId, storeId = "") {
  if (!opportunityId) throw new Error("缺少 Ozon 商品 ID");
  const scopedStoreId = String(storeId || "").trim();
  var items = await listOzonLearningItems();
  var item = items.find(function(i) { return i.id === opportunityId; });
  if (!item) throw new Error("未找到 Ozon 商品: " + opportunityId);

  var job = {
    id: makeId("al_"),
    opportunityId: opportunityId,
    ozonTitle: item.title,
    ozonPrice: item.price,
    ozonUrl: item.url,
    storeId: scopedStoreId,
    status: "translating",
    steps: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await mutateJobs(async function(jobs) {
    jobs.push(job);
  });

  // Run async (don't await, return immediately)
  runAutoListing(job.id, item).catch(function(err) {
    console.error("Auto-listing failed:", err);
  });

  return { ok: true, jobId: job.id, status: job.status };
}

async function runAutoListing(jobId, ozonItem) {
  var jobs = await readJobs();
  var idx = jobs.findIndex(function(j) { return j.id === jobId; });
  if (idx === -1) return;
  var job = jobs[idx];
  var learningContext = {
    jobId: jobId,
    opportunityId: ozonItem.id || "",
    ozonContext: buildOzonContext(ozonItem),
    searchKeywords: [],
  };

  try {
    // Step 1: Translate
    await updateJob(jobId, { status: "translating", stage: "sampled" });
    await emitAutoListingWorkflowNode(job, "sampled", {
      sourceType: "opportunity",
      sourceValue: ozonItem.url || ozonItem.id || "",
      totalFound: 1,
      detailQueued: 0,
      opportunityCount: 1,
      priceMinRub: Number(ozonItem.price || 0),
      priceMaxRub: Number(ozonItem.price || 0),
      categoryCounts: ozonItem.category ? { [ozonItem.category]: 1 } : {},
      sampleTitles: [ozonItem.title || ozonItem.keyword || ""].filter(Boolean),
      nodeStatus: "success",
    });
    var sourceText = ozonItem.title || ozonItem.keyword || "";
    var transResult = await translateRusToCn(sourceText);
    if (!transResult.ok) { await failJob(jobId, "翻译失败: " + transResult.error); return; }
    var keyword = transResult.keyword;
    var searchKeywords = (transResult.keywords && transResult.keywords.length ? transResult.keywords : [keyword]).slice(0, 3);
    learningContext.searchKeywords = searchKeywords;
    await addStep(jobId, "translated", "翻译完成: " + searchKeywords.join(" / "));
    await emitAutoListingWorkflowNode(job, "translating", { sourceText, keyword, searchKeywords });

    // Step 2: Create 1688 search task
    await updateJob(jobId, { status: "searching_1688", stage: "searching_1688", keyword: keyword, searchKeywords: searchKeywords });
    var { listCrawlerCandidates } = await import("./crawler1688.js");
    // legacy static contract: listCrawlerCandidates({ storeId: job.storeId })
    var existingCandidates = await listCrawlerCandidates({ storeId: job.storeId, storeIds: job.storeId ? [job.storeId] : [] });
    await addStep(jobId, "cached_check", "候选池有 " + existingCandidates.length + " 个已有商品，将优先采集当前关键词");
    var freshCandidates = [];
    var crawlerTaskIds = [];
    for (var sk = 0; sk < searchKeywords.length; sk++) {
      var task = await createCrawlerTask({
        storeId: job.storeId,
        sourceType: "keyword",
        sourceValue: searchKeywords[sk],
        options: { maxProducts: 20, maxPages: 2, mustHaveSku: false, mustHaveSizeWeight: false },
      });
      var taskId = (task && (task.task ? task.task.id : task.id)) || "";
      if (taskId) crawlerTaskIds.push(taskId);
    }
    await addStep(jobId, "search_created", "已创建1688搜索任务: " + searchKeywords.join(" / "));
    await updateJob(jobId, { status: "waiting_crawl", stage: "waiting_crawl", crawlerTaskIds: crawlerTaskIds });
    await emitAutoListingWorkflowNode(job, "waiting_crawl", { keyword, searchKeywords, crawlerTaskIds });
    var waitRounds = existingCandidates.length > 200 ? 6 : 15;
    freshCandidates = await waitForCrawlResults(jobId, crawlerTaskIds, waitRounds);
    var seenCandidate = new Set();
    var candidates = freshCandidates.concat(existingCandidates).filter(function(c) {
      var key = c.id || c.url || c.title;
      if (!key || seenCandidate.has(key)) return false;
      seenCandidate.add(key);
      return true;
    });
    if (!candidates || !candidates.length) {
      await recordListingExperience({
        ...learningContext,
        outcome: "failed",
        stage: "sourcing",
        failReason: "1688 未返回结果",
      });
      await failJob(jobId, "1688 未返回结果，候选池有 " + existingCandidates.length + " 个");
      return;
    }
    await addStep(jobId, "crawled", "获取到 " + candidates.length + " 个1688候选");
    await emitAutoListingWorkflowNode(job, "crawled", { candidateCount: candidates.length, nodeStatus: "success" });
    var sourcingGate = filterSourcingCandidates(candidates);
    if (!sourcingGate.accepted.length) {
      var topRejected = sourcingGate.rejected.slice(0, 3).map(function(row) {
        return row.gate.reasonCode + ": " + row.gate.reason;
      }).join("；");
      await recordListingExperience({
        ...learningContext,
        outcome: "failed",
        stage: "sourcing_gate",
        failReason: "1688候选均不符合小件选品门槛: " + topRejected,
      });
      await failJob(jobId, "1688候选均不符合小件选品门槛（SKU≤" + SOURCING_MAX_SKU_COUNT + "，重量≤" + SOURCING_MAX_SOURCE_WEIGHT_G + "g，Extra Small）。" + topRejected);
      return;
    }
    var rejectedSummary = sourcingGate.rejected.reduce(function(acc, row) {
      var key = row.gate.reasonCode || "UNKNOWN";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    await addStep(
      jobId,
      "sourcing_gate",
      "小件门禁通过 " + sourcingGate.accepted.length + " 个，剔除 " + sourcingGate.rejected.length + " 个: " + JSON.stringify(rejectedSummary)
    );
    await emitAutoListingWorkflowNode(job, "sourcing_gate", {
      candidateCount: candidates.length,
      acceptedCount: sourcingGate.accepted.length,
      rejectedCount: sourcingGate.rejected.length,
      nodeStatus: "success",
    });
    var rankedCandidates = rankCandidatesForOzon(ozonItem, sourcingGate.accepted);
    var candidatesForAi = rankedCandidates.slice(0, 40);
    await addStep(jobId, "prefiltered", "预筛后进入AI匹配: " + candidatesForAi.length + " 个");

    // Step 4: Match & filter
    await updateJob(jobId, { status: "matching", stage: "matching" });
    await emitAutoListingWorkflowNode(job, "matching", { candidateCount: candidatesForAi.length });
  var bestMatch = null;
    var volumeFallback = null;
    var rejected = [];
    for (var i = 0; i < candidatesForAi.length; i++) {
      var matchResult = shouldUseAiMatch(i) ? await judgeMatch(ozonItem, candidatesForAi[i]) : localJudgeMatch(ozonItem, candidatesForAi[i]);
      var profit = calcProfit(ozonItem, candidatesForAi[i]);
      if (ENABLE_VOLUME_FALLBACK && profit && profit.ok && isSameFamilyForFallback(ozonItem, candidatesForAi[i])) {
        var marginOk = toNumber(profit.margin) >= VOLUME_MIN_MARGIN;
        var marketGapOk = profit.marketPriceOk !== false || toNumber(profit.priceDiff, -999) >= -VOLUME_MAX_MARKET_GAP_PCT;
        if (marginOk && marketGapOk) {
          var fbScore = toNumber(profit.margin) * 1.5 + (100 - Math.abs(toNumber(profit.priceDiff, 0)));
          if (!volumeFallback || fbScore > volumeFallback.score) {
            volumeFallback = {
              candidate: candidatesForAi[i],
              match: matchResult,
              profit: profit,
              tier: "volume_fallback",
              score: fbScore,
            };
          }
        }
      }
      var decision = evaluateCandidate(matchResult, profit);
      if (decision.ok) {
        var current = { candidate: candidatesForAi[i], match: matchResult, profit: profit, tier: decision.tier, score: decision.score };
        if (!bestMatch || current.score > bestMatch.score) bestMatch = current;
      } else {
        rejected.push({ candidate: candidatesForAi[i], match: matchResult, profit: profit, reason: decision.reason });
      }
    }
    if (!bestMatch && volumeFallback) {
      bestMatch = volumeFallback;
      if (!bestMatch.match || !bestMatch.match.ok) {
        bestMatch.match = { ok: true, match: true, confidence: 30, reason: "跑量兜底放行" };
      }
      await addStep(jobId, "fallback", "启用跑量兜底: " + bestMatch.candidate.title + " (利润率: " + bestMatch.profit.margin + "%)");
    }
    if (!bestMatch) {
      var profitFallbacks = candidatesForAi
        .map(function(candidate) {
          var profit = calcProfit(ozonItem, candidate);
          var marginOk = profit && profit.ok && toNumber(profit.margin) >= VOLUME_MIN_MARGIN;
          var marketGapOk = profit && (profit.marketPriceOk !== false || toNumber(profit.priceDiff, -999) >= -VOLUME_MAX_MARKET_GAP_PCT);
          return marginOk && marketGapOk ? { candidate: candidate, profit: profit, score: toNumber(profit.margin) * 2 + Number(candidate.score || 0) / 20 } : null;
        })
        .filter(Boolean)
        .sort(function(a, b) { return b.score - a.score; });
      if (profitFallbacks.length) {
        var picked = profitFallbacks[0];
        bestMatch = {
          candidate: picked.candidate,
          match: { ok: true, match: true, confidence: 20, reason: "AI/同族匹配未通过，按利润和尺重进入跑量验证" },
          profit: picked.profit,
          tier: "volume_profit_fallback",
          score: picked.score,
        };
        await addStep(jobId, "fallback", "启用利润跑量兜底: " + bestMatch.candidate.title + " (利润率: " + bestMatch.profit.margin + "%)");
      }
    }
    if (!bestMatch) {
      var rejectedReasons = rejected.reduce(function(acc, row) {
        var key = String(row.reason || row.match?.reason || row.profit?.reason || "UNKNOWN");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      await emitAutoListingWorkflowNode(job, "matching", {
        candidateCount: candidatesForAi.length,
        evaluatedCount: candidatesForAi.length,
        acceptedCount: 0,
        rejectedCount: rejected.length,
        rejectedReasons: rejectedReasons,
        rejectedSamples: rejected.slice(0, 5).map(function(row) {
          return {
            id: row.candidate?.id || "",
            title: row.candidate?.title || "",
            url: row.candidate?.url || "",
            reason: row.reason || row.match?.reason || row.profit?.reason || "",
            margin: row.profit?.margin ?? null,
            confidence: row.match?.confidence ?? null,
          };
        }),
        nodeStatus: "failed",
        runStatus: "waiting_human",
      });
      await recordListingExperience({
        ...learningContext,
        outcome: "failed",
        stage: "matching",
        failReason: "未找到满足匹配/利润规则的1688商品（同款优先，相似款放行）",
        candidate: rejected[0]?.candidate || null,
        match: rejected[0]?.match || null,
        profit: rejected[0]?.profit || null,
      });
      await failJob(jobId, "未找到满足匹配/利润规则的1688商品（同款优先，相似款放行）");
      return;
    }
    await addStep(jobId, "matched", "匹配成功(" + bestMatch.tier + "): " + bestMatch.candidate.title + " (利润率: " + bestMatch.profit.margin + "%)");
    await emitAutoListingWorkflowNode(job, "matching", {
      candidateCount: candidatesForAi.length,
      evaluatedCount: candidatesForAi.length,
      acceptedCount: 1,
      rejectedCount: rejected.length,
      rejectedReasons: rejected.reduce(function(acc, row) {
        var key = String(row.reason || row.match?.reason || row.profit?.reason || "UNKNOWN");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      rejectedSamples: rejected.slice(0, 5).map(function(row) {
        return {
          id: row.candidate?.id || "",
          title: row.candidate?.title || "",
          url: row.candidate?.url || "",
          reason: row.reason || row.match?.reason || row.profit?.reason || "",
          margin: row.profit?.margin ?? null,
          confidence: row.match?.confidence ?? null,
        };
      }),
      bestMatch: {
        id: bestMatch.candidate.id,
        title: bestMatch.candidate.title,
        url: bestMatch.candidate.url,
        tier: bestMatch.tier,
        margin: bestMatch.profit.margin,
        confidence: bestMatch.match.confidence,
        purchasePriceCny: bestMatch.profit.purchasePriceCny,
        targetPriceCny: bestMatch.profit.targetPriceCny || bestMatch.profit.priceCny,
        profitCny: bestMatch.profit.profitCny,
        priceDiff: bestMatch.profit.priceDiff,
      },
      nodeStatus: "success",
    });
    trackEvent("ozon_matched", {
      jobId: jobId,
      storeId: "",
      stage: "matched",
      status: "matching",
      reasonCode: "",
      durationMs: 0,
    });

    // Step 5: Generate listing content
    await updateJob(jobId, { status: "generating_content", stage: "guided" });
    await emitAutoListingWorkflowNode(job, "generating_content", { bestMatch: bestMatch.candidate?.id || bestMatch.candidate?.title || "" });
    var ozonContext = buildOzonContext(ozonItem);
    var listingResult = await generateListingContentWithLlm(bestMatch.candidate.parsed || bestMatch.candidate, {
      useRules: true,
      ozonContext: ozonContext,
      match: bestMatch.match,
      profit: bestMatch.profit,
    });
    if (!listingResult.enabled) {
      await emitAutoListingWorkflowNode(job, "generating_content", {
        nodeStatus: "failed",
        runStatus: "waiting_human",
        listingContentReady: false,
        contentIssues: ["LLM 未配置，无法生成上架内容"],
      });
      await failJob(jobId, "LLM 未配置，无法生成上架内容");
      return;
    }
    await addStep(jobId, "content_generated", "上架内容已生成");
    await emitAutoListingWorkflowNode(job, "generating_content", {
      bestMatch: {
        id: bestMatch.candidate.id,
        title: bestMatch.candidate.title,
        url: bestMatch.candidate.url,
      },
      ...contentGenerationWorkflowSummary(listingResult.content, bestMatch.candidate, null),
      nodeStatus: "success",
    });

    var visualCard = null;
    if (ENABLE_VISUAL_CARD_PROMPT) {
      visualCard = {
        enabled: true,
        prompt: buildVisualCardPrompt({
          ozonContext: ozonContext,
          listingContent: listingResult.content,
          candidate: bestMatch.candidate.parsed || bestMatch.candidate,
        }),
      };
      await addStep(jobId, "visual_card_ready", "已生成视觉卡片Prompt（可用于imagegen）");
      await emitAutoListingWorkflowNode(job, "generating_content", {
        bestMatch: {
          id: bestMatch.candidate.id,
          title: bestMatch.candidate.title,
          url: bestMatch.candidate.url,
        },
        ...contentGenerationWorkflowSummary(listingResult.content, bestMatch.candidate, visualCard),
        nodeStatus: "success",
      });
    }

    const autoSubmitReady = bestMatch.tier !== "volume_profit_fallback";
    const finalJobStatus = autoSubmitReady ? "ready_for_listing" : "needs_review";
    // Step 6: Mark as ready/review (Ozon API call requires store credentials)
    await updateJob(jobId, {
      status: finalJobStatus,
      stage: "guided",
      bestMatch: {
        id: bestMatch.candidate.id,
        candidateTitle: bestMatch.candidate.title,
        candidateUrl: bestMatch.candidate.url,
        purchasePriceCny: bestMatch.profit.purchasePriceCny,
        estProfitCny: bestMatch.profit.estProfitCny,
        margin: bestMatch.profit.margin,
        profitBasis: bestMatch.profit.basis,
        targetProfitRate: bestMatch.profit.targetProfitRate,
        estSellPriceCny: bestMatch.profit.estSellPriceCny,
        estRubPrice: bestMatch.profit.estRubPrice,
        actualOzonPrice: bestMatch.profit.actualOzonPrice,
        marketPriceCny: bestMatch.profit.marketPriceCny,
        priceDiff: bestMatch.profit.priceDiff,
        matchTier: bestMatch.tier,
        matchConfidence: bestMatch.match.confidence,
      },
      ozonContext: ozonContext,
      candidateData: {
        images: (bestMatch.candidate.parsed || bestMatch.candidate).images || [],
        sizeWeight: (bestMatch.candidate.parsed || bestMatch.candidate).sizeWeight || {},
        skuVariants: (bestMatch.candidate.parsed || bestMatch.candidate).skuVariants || [],
        attributes: (bestMatch.candidate.parsed || bestMatch.candidate).attributes || [],
      },
      listingContent: listingResult.content,
      visualCard: visualCard,
    });
    await recordListingExperience({
      ...learningContext,
      outcome: finalJobStatus,
      stage: finalJobStatus,
      candidate: bestMatch.candidate,
      match: bestMatch.match,
      profit: bestMatch.profit,
      listingContent: listingResult.content,
      ozonContext: ozonContext,
      searchKeywords: searchKeywords,
    });
    await addStep(jobId, autoSubmitReady ? "ready" : "needs_review", autoSubmitReady ? "已就绪，等待上架到 Ozon（需配置店铺）" : "低置信跑量候选，进入复核/学习池，不自动提交");

  } catch (err) {
    await failJob(jobId, "系统错误: " + (err.message || String(err)));
  }
}

async function waitForCrawlResults(jobId, taskIds, maxWaitSec) {
  var { listCrawlerCandidates } = await import("./crawler1688.js");
  var ids = Array.isArray(taskIds) ? taskIds.filter(Boolean) : [taskIds].filter(Boolean);
  for (var i = 0; i < maxWaitSec; i++) {
    var batches = await Promise.all(ids.map(function(taskId) { return listCrawlerCandidates({ taskId: taskId || "" }); }));
    var candidates = batches.reduce(function(acc, rows) { return acc.concat(rows || []); }, []);
    if (candidates.length > 0) return candidates;
    await sleep(3000);
    await addStep(jobId, "waiting", "等待1688采集结果... (" + ((i + 1) * 3) + "s)");
  }
  return [];
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function updateJob(id, patch) {
  await mutateJobs(async function(jobs) {
    var idx = jobs.findIndex(function(j) { return j.id === id; });
    if (idx === -1) return;
    jobs[idx] = Object.assign({}, jobs[idx], patch, { updatedAt: nowIso() });
  });
}

async function addStep(id, action, detail) {
  await mutateJobs(async function(jobs) {
    var idx = jobs.findIndex(function(j) { return j.id === id; });
    if (idx === -1) return;
    if (!jobs[idx].steps) jobs[idx].steps = [];
    jobs[idx].steps.push({ action: action, detail: detail, time: nowIso() });
    jobs[idx].updatedAt = nowIso();
  });
}

async function failJob(id, reason) {
  let failedJob = null;
  let failedStage = "";
  await mutateJobs(async function(jobs) {
    var idx = jobs.findIndex(function(j) { return j.id === id; });
    if (idx === -1) return;
    failedStage = jobs[idx].stage || jobs[idx].status || "failed";
    jobs[idx].status = "failed";
    jobs[idx].error = reason;
    jobs[idx].reasonCode = mapReasonCode(reason);
    jobs[idx].stage = "failed";
    jobs[idx].updatedAt = nowIso();
    if (!jobs[idx].steps) jobs[idx].steps = [];
    jobs[idx].steps.push({ action: "failed", detail: reason, time: nowIso() });
    failedJob = jobs[idx];
  });
  if (!failedJob) return;
  await emitAutoListingWorkflowNode(failedJob, failedStage, {
    nodeStatus: "failed",
    runStatus: "waiting_human",
    actions: ["view_output", "retry_node", "auto_fix"],
  }).then(async function(workflowRun) {
    if (!workflowRun) return;
    var node = workflowNodeFromAutoListingStage(failedStage, {});
    await upsertWorkflowNode(workflowRun.id, {
      key: node.key,
      name: node.name,
      status: "failed",
      error: { raw: reason },
      diagnosis: diagnoseWorkflowError({ raw: reason, message: reason }),
      actions: ["view_output", "retry_node", "auto_fix"],
      runStatus: "waiting_human",
    }).catch(function() {});
  }).catch(function() {});
  trackEvent("listing_failed", {
    jobId: id,
    storeId: failedJob.storeId || "",
    stage: "failed",
    status: "failed",
    reasonCode: failedJob.reasonCode,
    durationMs: failedJob.createdAt ? Date.now() - new Date(failedJob.createdAt).getTime() : 0,
  });
}

export async function listAutoListingJobs() {
  var jobs = await recoverStuckJobs();
  return jobs
    .map(function(job) {
      var steps = Array.isArray(job.steps) ? job.steps : [];
      var last = steps.length ? steps[steps.length - 1] : null;
      var reasonCode = job.reasonCode || mapReasonCode(job.error || last?.detail || "");
      var timeoutStage = reasonCode === "TIMEOUT" ? inferTimeoutStage(job) : "";
      return Object.assign({
        source: "auto_listing",
        stage: job.stage || (last ? String(last.action || "") : String(job.status || "")),
        reasonCode: reasonCode,
        timeoutStage: timeoutStage,
        updatedAt: job.updatedAt || job.createdAt || nowIso(),
      }, job);
    })
    .sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}

export async function getAutoListingJob(id) {
  var jobs = await recoverStuckJobs();
  var job = jobs.find(function(j) { return j.id === id; }) || null;
  if (!job) return null;
  var steps = Array.isArray(job.steps) ? job.steps : [];
  var last = steps.length ? steps[steps.length - 1] : null;
  var reasonCode = job.reasonCode || mapReasonCode(job.error || last?.detail || "");
  var timeoutStage = reasonCode === "TIMEOUT" ? inferTimeoutStage(job) : "";
  return Object.assign({
    source: "auto_listing",
    stage: job.stage || (last ? String(last.action || "") : String(job.status || "")),
    reasonCode: reasonCode,
    timeoutStage: timeoutStage,
    updatedAt: job.updatedAt || job.createdAt || nowIso(),
  }, job);
}

export async function backfillTimeoutStages(limit = 1000) {
  const jobs = await readJobs();
  let changed = 0;
  const max = Math.max(1, Number(limit || 1000));
  for (let i = 0; i < jobs.length && changed < max; i += 1) {
    const job = jobs[i];
    const reasonCode = String(job.reasonCode || mapReasonCode(job.error || ""));
    if (reasonCode !== "TIMEOUT") continue;
    const current = String(job.timeoutStage || "");
    if (current && current !== "unknown") continue;
    const inferred = inferTimeoutStageFromHistory(job);
    if (!inferred || inferred === "unknown") continue;
    jobs[i] = Object.assign({}, job, { timeoutStage: inferred, updatedAt: nowIso() });
    changed += 1;
  }
  if (changed > 0) await writeJobs(jobs);
  return { ok: true, changed, total: jobs.length };
}

function applyListingFixByReason(job, reasonCode) {
  const next = Object.assign({}, job);
  next.listingContent = Object.assign({}, next.listingContent || {});
  next.candidateData = Object.assign({}, next.candidateData || {});
  const dedupeWords = (text) => {
    const seen = new Set();
    return String(text || "")
      .split(/\s+/)
      .filter((word) => {
        const key = word.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(" ")
      .slice(0, 180);
  };
  if (reasonCode === "BRAND_INVALID") {
    next.listingContent.brand = "无品牌";
  }
  if (reasonCode === "TITLE_INVALID") {
    next.listingContent.title_ru = normalizeOzonTitleForListing(
      dedupeWords(next.listingContent.title_ru || next.ozonTitle || next.bestMatch?.candidateTitle || ""),
      {
        candidateTitle: next.bestMatch?.candidateTitle || next.candidateData?.title || "",
        ozonTitle: next.ozonTitle || next.ozonContext?.title || "",
        productType: next.listingContent.product_type_ru || "",
      }
    );
  }
  if (reasonCode === "RICH_CONTENT_INVALID") {
    delete next.listingContent.rich_content_json;
    delete next.listingContent.richContentJson;
    next.listingContent.richContentDisabled = true;
  }
  if (reasonCode === "COUNTRY_INVALID") {
    next.listingContent.country = "中国";
    next.listingContent.country_of_origin = "中国";
  }
  if (reasonCode === "ATTRIBUTE_DUPLICATE") {
    const attrs = Array.isArray(next.candidateData.attributes) ? next.candidateData.attributes : [];
    const seen = new Set();
    next.candidateData.attributes = attrs.filter((attr) => {
      const key = String(attr.attribute_id || attr.id || attr.name || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (reasonCode === "ATTRIBUTE_REQUIRED") {
    next.listingContent.requiredAttributeRetry = true;
  }
  if (reasonCode === "CATEGORY_INVALID") {
    next.listingContent.categoryRetry = "auto_rematch";
  }
  if (reasonCode === "WEIGHT_SIZE_INVALID") {
    const cd = next.candidateData;
    const sw = Object.assign({}, cd.sizeWeight || {});
    const variants = Array.isArray(cd.skuVariants) ? cd.skuVariants : [];
    const maxN = (arr, f) => {
      const nums = arr.map(f).map((x) => Number(x || 0)).filter((x) => Number.isFinite(x) && x > 0);
      return nums.length ? Math.max.apply(null, nums) : 0;
    };
    sw.weightG = Math.max(Number(sw.weightG || 0), maxN(variants, (v) => v.weightG));
    sw.lengthMm = Math.max(Number(sw.lengthMm || 0), maxN(variants, (v) => v.lengthMm));
    sw.widthMm = Math.max(Number(sw.widthMm || 0), maxN(variants, (v) => v.widthMm));
    sw.heightMm = Math.max(Number(sw.heightMm || 0), maxN(variants, (v) => v.heightMm));
    sw.weightG = Math.max(100, Number(sw.weightG || 0) + 50);
    sw.lengthMm = Math.max(50, Number(sw.lengthMm || 0) + 20);
    sw.widthMm = Math.max(50, Number(sw.widthMm || 0) + 20);
    sw.heightMm = Math.max(30, Number(sw.heightMm || 0) + 20);
    next.candidateData.sizeWeight = sw;
  }
  return next;
}

export async function remediateFailedListingJobs(options = {}) {
  const rawLimit = Number(options.limit ?? 5);
  if (Number.isFinite(rawLimit) && rawLimit <= 0) return { ok: true, scanned: 0, patched: 0, resubmitted: 0, details: [] };
  const limit = Math.max(1, rawLimit);
  const autoResubmit = Boolean(options.autoResubmit);
  const reasons = new Set(
    String(options.reasonCodes || "CATEGORY_INVALID,WEIGHT_SIZE_INVALID,BRAND_INVALID,TITLE_INVALID,RICH_CONTENT_INVALID,COUNTRY_INVALID,ATTRIBUTE_DUPLICATE,ATTRIBUTE_REQUIRED")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
  const jobs = await readJobs();
  const candidates = jobs
    .filter((j) => {
      const text = [j.error || "", j.lastError || "", JSON.stringify(j.listingResult || {}).slice(0, 2000)].join(" ");
      const rc = String(j.reasonCode && j.reasonCode !== "UNKNOWN" ? j.reasonCode : mapReasonCode(text));
      return String(j.status || "") === "failed" && reasons.has(rc);
    })
    .slice(0, limit);
  let patched = 0;
  let resubmitted = 0;
  const details = [];
  for (const job of candidates) {
    const text = [job.error || "", job.lastError || "", JSON.stringify(job.listingResult || {}).slice(0, 2000)].join(" ");
    const rc = String(job.reasonCode && job.reasonCode !== "UNKNOWN" ? job.reasonCode : mapReasonCode(text));
    const fixed = applyListingFixByReason(job, rc);
    fixed.status = "ready_for_listing";
    fixed.stage = "guided";
    fixed.error = "";
    fixed.reasonCode = "";
    fixed.remediation = Object.assign({}, fixed.remediation || {}, {
      count: Number(fixed.remediation?.count || 0) + 1,
      lastReasonCode: rc,
      lastAt: nowIso(),
    });
    await updateJob(job.id, fixed);
    await addStep(job.id, "remediated", "自动纠偏完成: " + rc);
    patched += 1;
    let submitResult = null;
    if (autoResubmit) {
      const storeId = fixed.listingResult?.storeId || fixed.storeId || "";
      if (storeId) {
        submitResult = await completeListing(job.id, storeId).catch((e) => ({ ok: false, error: e.message }));
        if (submitResult?.ok) resubmitted += 1;
      }
    }
    details.push({ jobId: job.id, reasonCode: rc, autoResubmitted: Boolean(submitResult?.ok), submitResult });
  }
  return { ok: true, scanned: candidates.length, patched, resubmitted, details };
}

export async function remediateListingJobsByTaskIds(taskIds = [], options = {}) {
  const ids = new Set((taskIds || []).map((id) => Number(id || 0)).filter(Boolean));
  if (!ids.size) return { ok: true, scanned: 0, patched: 0, resubmitted: 0, details: [] };
  const rawLimit = Number(options.limit ?? 5);
  if (Number.isFinite(rawLimit) && rawLimit <= 0) return { ok: true, scanned: 0, patched: 0, resubmitted: 0, details: [] };
  const limit = Math.max(1, rawLimit);
  const autoResubmit = Boolean(options.autoResubmit);
  const reasonByTaskId = options.reasonByTaskId || {};
  const jobs = await readJobs();
  const candidates = jobs
    .filter((j) => ids.has(Number(j?.listingResult?.taskId || 0)))
    .slice(0, limit);
  let patched = 0;
  let resubmitted = 0;
  const details = [];
  for (const job of candidates) {
    const text = [
      job.error || "",
      job.lastError || "",
      reasonByTaskId[String(job.listingResult?.taskId || "")] || "",
      JSON.stringify(job.listingResult?.importInfo || {}).slice(0, 4000),
    ].join(" ");
    const rc = mapReasonCode(text);
    if (!["CATEGORY_INVALID", "WEIGHT_SIZE_INVALID", "BRAND_INVALID", "TITLE_INVALID", "RICH_CONTENT_INVALID", "COUNTRY_INVALID", "ATTRIBUTE_DUPLICATE", "ATTRIBUTE_REQUIRED"].includes(rc)) continue;
    const fixed = applyListingFixByReason(job, rc);
    fixed.status = "ready_for_listing";
    fixed.stage = "guided";
    fixed.error = "";
    fixed.reasonCode = "";
    fixed.remediation = Object.assign({}, fixed.remediation || {}, {
      count: Number(fixed.remediation?.count || 0) + 1,
      lastReasonCode: rc,
      lastAt: nowIso(),
      source: "stock_queue_import_info",
    });
    await updateJob(job.id, fixed);
    await addStep(job.id, "remediated_from_stock_queue", "根据库存队列审核错误自动纠偏: " + rc);
    patched += 1;
    let submitResult = null;
    if (autoResubmit) {
      const storeId = fixed.listingResult?.storeId || fixed.storeId || "";
      if (storeId) {
        submitResult = await completeListing(job.id, storeId).catch((e) => ({ ok: false, error: e.message }));
        if (submitResult?.ok) resubmitted += 1;
      }
    }
    details.push({ jobId: job.id, taskId: job.listingResult?.taskId, reasonCode: rc, autoResubmitted: Boolean(submitResult?.ok), submitResult });
  }
  return { ok: true, scanned: candidates.length, patched, resubmitted, details };
}


// Test: directly run matching + profit + content gen
export async function testMatchAndList(opportunityId, candidateId) {
  var { listCrawlerCandidates } = await import("./crawler1688.js");
  
  var items = await listOzonLearningItems();
  var ozonItem = items.find(function(i) { return i.id === opportunityId; });
  if (!ozonItem) return { ok: false, error: "Ozon 商品未找到" };
  
  var candidates = await listCrawlerCandidates();
  var candidate = candidates.find(function(c) { return c.id === candidateId; });
  if (!candidate) return { ok: false, error: "1688 候选未找到" };
  
  var results = {};
  results.matchResult = await judgeMatch(ozonItem, candidate);
  results.profitResult = calcProfit(ozonItem, candidate);
  
  var testDecision = evaluateCandidate(results.matchResult, results.profitResult);
  if (testDecision.ok) {
    var listingResult = await generateListingContentWithLlm(candidate.parsed || candidate);
    results.listingResult = listingResult;
    results.matchTier = testDecision.tier;
  }
  
  return { ok: true, ozonItem: ozonItem, candidate: candidate, results: results };
}


// Complete listing - submit product to Ozon via Seller API
export async function completeListing(jobId, storeId) {
  var job = await getAutoListingJob(jobId);
  if (!job) return { ok: false, error: "铺货记录未找到" };
  if (job.status !== "ready_for_listing") {
    return { ok: false, error: "铺货状态不是就绪上架（当前: " + (job.status || "unknown") + "）" };
  }
  var workflowRun = await findOrCreateWorkflowForAutoListingJob(job).catch(function() { return null; });
  var duplicate = findDuplicateListingJob(job, await readJobs());
  if (duplicate) {
    var duplicateSku = duplicate.listingResult?.sku || "";
    var message = "检测到同一Ozon参考品或1688货源已经提交过，禁止重复上架"
      + "（已有job: " + duplicate.id
      + (duplicateSku ? "，SKU: " + duplicateSku : "")
      + "）";
    await updateJob(jobId, {
      status: "duplicate_blocked",
      stage: "duplicate_blocked",
      reasonCode: "DUPLICATE_LISTING",
      error: message,
    });
    await addStep(jobId, "duplicate_blocked", message);
    if (workflowRun) {
      await upsertWorkflowNode(workflowRun.id, workflowDuplicateListingNode({
        duplicateJobId: duplicate.id,
        duplicateSku,
        message,
      })).catch(function() {});
    }
    return { ok: false, status: "duplicate_blocked", reasonCode: "DUPLICATE_LISTING", error: message, duplicateJobId: duplicate.id, duplicateSku };
  }
  try {
    if (workflowRun) {
      await upsertWorkflowNode(workflowRun.id, {
        key: "ozon_submit",
        name: "Ozon 提交",
        status: "running",
        input: { jobId, storeId },
        runStatus: "running",
      }).catch(function() {});
    }
    await addStep(jobId, "listing_started", "开始上架到 Ozon（店铺ID: " + storeId + "）");
    trackEvent("sample_started", { jobId: jobId, storeId: storeId, stage: "listing_started", status: "listing", reasonCode: "", durationMs: 0 });
    await updateJob(jobId, { status: "listing" });
    var store = getStore(storeId);
    if (!store) { await failJob(jobId, "店铺未找到: " + storeId); return { ok: false, error: "店铺未找到" }; }
    var lc = job.listingContent || {};
    var title = sanitizeListingTitle(lc.title_ru || "", job.ozonTitle || job.bestMatch?.candidateTitle || "", {
      candidateTitle: job.bestMatch?.candidateTitle || job.candidateData?.title || "",
      ozonTitle: job.ozonTitle || job.ozonContext?.title || "",
      productType: lc.product_type_ru || "",
    });
    var description = buildListingDescription(lc, title);
    if (!title) { await failJob(jobId, "上架标题为空"); return { ok: false, error: "上架标题为空" }; }
    var visualCoverUrl = job.visualCard?.imageUrl || job.visualCard?.url || job.visualCard?.assetUrl || "";
    var images = normalizeImageUrlsForOzon([visualCoverUrl].concat((job.candidateData && job.candidateData.images) || []))
      .slice(0, MAX_OZON_IMAGE_PREPARE_COUNT);
    var skuVariants = (job.candidateData && job.candidateData.skuVariants) || [];
    var parentSku = existingParentSkuForListing(job);
    if (parentSku) {
      await addStep(jobId, "sku_reused", "复用SKU重试: " + parentSku);
    } else {
      var skuResult = await nextParentSku();
      parentSku = skuResult.parentSku;
      await updateJob(jobId, { pendingParentSku: parentSku });
      await addStep(jobId, "sku_generated", "生成SKU: " + parentSku);
    }
    var ozonImages = [];
    if (images.length > 0) {
      var preparedImages = await prepareOzonImages(images, {
        ocr: ENABLE_IMAGE_OCR_FOR_LISTING,
        blockChinese: ENABLE_IMAGE_OCR_FOR_LISTING,
        translateChinese: ENABLE_IMAGE_OCR_FOR_LISTING,
      }).catch(async function(e) {
        await addStep(jobId, "image_prepare_failed", "图片OCR/翻译/OSS准备失败: " + (e.message || String(e)));
        return { images: [] };
      });
      ozonImages = selectPreparedOzonImages(preparedImages.images, []);
      var skippedCount = (preparedImages.images || []).filter(function(row) { return row.skipped; }).length;
      var translatedCount = (preparedImages.images || []).filter(function(row) { return row.translated; }).length;
      await addStep(jobId, "images_prepared", "图片已OCR处理: 可用 " + ozonImages.length + " 张，剔除 " + skippedCount + " 张，翻译 " + translatedCount + " 张");
      if (visualCoverUrl && ozonImages[0]) {
        await addStep(jobId, "visual_cover_included", "已使用视觉封面作为主图: " + ozonImages[0]);
      }
    }
    if (!ozonImages.length) { await failJob(jobId, "缺少Ozon可下载图片，禁止提交"); return { ok: false, error: "缺少Ozon可下载图片" }; }
    var packageInfo = packageSizeWeight(job.candidateData || {});
    if (!packageInfo.ok) {
      await failJob(jobId, packageInfo.reason);
      return { ok: false, error: packageInfo.reason };
    }
    packageInfo.packageInfoSource = trustedPackageInfoSourceForListingJob(job);
    if (!packageInfo.packageInfoSource) {
      await failJob(jobId, "候选缺少可信尺重来源，无法生成 payload 草稿");
      return { ok: false, error: "候选缺少可信尺重来源" };
    }
    await addStep(jobId, "size_weight_checked", "尺重确认: " + packageInfo.weight + "g / " + packageInfo.depth + "x" + packageInfo.width + "x" + packageInfo.height + "mm");
    var bestMatchPrice = job.bestMatch ? job.bestMatch.purchasePriceCny : 0;
    var productForCategory = {
      title: [
        title,
        job.bestMatch?.candidateTitle || "",
        job.ozonContext?.title || "",
        job.ozonContext?.category || "",
      ].filter(Boolean).join(" "),
      url: job.bestMatch?.candidateUrl || job.ozonUrl || "",
      attributes: (job.candidateData?.attributes || []).concat(job.ozonContext?.attributes || []),
      skuVariants,
    };
    var cache = await loadCategoryCache();
    var flatCategories = cache.flat || flattenCategories(cache.tree || []);
    var categoryMatches = matchCategory(productForCategory, flatCategories, 3);
    var categoryMatch = categoryMatches[0] || null;
    if (!categoryMatch) {
      await failJob(jobId, "未匹配到Ozon类目，无法提交");
      return { ok: false, error: "未匹配到Ozon类目" };
    }
    await addStep(jobId, "category_matched", "匹配Ozon类目: " + categoryMatch.path + " (" + categoryMatch.description_category_id + "/" + categoryMatch.type_id + ")");
    var priceCalc;
    var purchaseCost = Math.max(Number(bestMatchPrice || 0) + PURCHASE_COST_MARKUP_RMB, 1);
    var commissionInput = resolveCommissionInput(job, categoryMatch);
    try {
      priceCalc = calculateOzonPrice({
        purchaseCost: purchaseCost,
        weightG: packageInfo.weight,
        lengthMm: packageInfo.depth,
        widthMm: packageInfo.width,
        heightMm: packageInfo.height,
        profitRate: 0.3,
        ...commissionInput,
      });
    } catch (e) {
      await failJob(jobId, "价格计算失败: " + e.message);
      return { ok: false, error: "价格计算失败: " + e.message };
    }
    var finalPriceCny = roundMoney(priceCalc.priceCny || priceCalc.nextPriceCny || 0);
    if (!finalPriceCny) { await failJob(jobId, "价格计算结果为空"); return { ok: false, error: "价格计算结果为空" }; }
    var pricingPolicy = job.pricingPolicy || null;
    var pricingFields = derivePricingPolicyFields({
      priceCny: finalPriceCny,
      baseCost: priceCalc.baseCost || 0,
      policy: pricingPolicy,
    });
    var oldPriceCny = pricingFields.oldPriceCny;
    var minPriceCny = pricingFields.minPriceCny;
    var pricingDiagnosis = pricingDiagnosisFromCalculation({
      sourcePriceCny: bestMatchPrice,
      purchaseCost,
      packageInfo,
      priceCalc,
      priceCny: finalPriceCny,
      oldPriceCny,
      minPriceCny,
      pricingFields,
    });
    if (workflowRun) {
      var pricingNode = workflowNodeFromAutoListingStage("matching", {
        bestMatch: job.bestMatch || {},
        pricingDiagnosis,
        nodeStatus: "success",
      });
      await upsertWorkflowNode(workflowRun.id, {
        ...pricingNode,
        input: {
          autoListingJobId: job.id,
          sourcePriceCny: bestMatchPrice,
          purchaseMarkupRmb: PURCHASE_COST_MARKUP_RMB,
          package: pricingDiagnosis.package,
        },
        runStatus: "running",
      }).catch(function() {});
    }
    var modelName = modelNameForListing(job, parentSku);
    var attrsMetaResp = await fetchCategoryAttributes(store, categoryMatch).catch(function() { return null; });
    var attrsMeta = Array.isArray(attrsMetaResp?.result) ? attrsMetaResp.result : [];
    var variantAttrsMeta = await hydrateVariantAspectMetadata(store, categoryMatch, attrsMeta);
    await addStep(jobId, "price_calculated", "售价: " + finalPriceCny + " CNY，仓库等级: " + (priceCalc.level?.name || "-") + "，运费: " + priceCalc.logisticsFee + " CNY");
    var item = {
      offer_id: parentSku, name: title, description: description || title, images: ozonImages,
      height: packageInfo.height,
      width: packageInfo.width,
      depth: packageInfo.depth,
      weight: packageInfo.weight,
      weight_unit: "g",
      dimension_unit: "mm",
      price: String(finalPriceCny),
      old_price: String(oldPriceCny),
      min_price: String(minPriceCny),
      currency_code: "CNY",
      vat: "0",
      description_category_id: Number(categoryMatch.description_category_id),
      type_id: Number(categoryMatch.type_id),
    };
    var brandAttr = fixedNoBrandAttribute();
    var smartAttrs = await resolveSmartCategoryAttrs(store, categoryMatch, lc, packageInfo, job.ozonContext || {}, productForCategory).catch(function() { return []; });
    var attrs = dedupeAttrs([brandAttr]
      .concat(modelAttributesForMeta(modelName, attrsMeta))
      .concat(countryAttributes())
      .concat(buildMarketingAttributes(lc))
      .concat(smartAttrs)
      .filter(Boolean));
    await addStep(jobId, "submitting", "提交商品到 Ozon...");
    var variantsForListing = Array.isArray(skuVariants)
      ? skuVariants.filter(function(v) { return cleanSkuSpec(v.spec || "") && Number(v.price || bestMatchPrice || 0) > 0; }).slice(0, SOURCING_MAX_SKU_COUNT)
      : [];
    if (variantsForListing.length < 2) variantsForListing = [];
    var submitItems = variantsForListing.length
      ? variantsForListing.map(function(variant, index) {
        var variantPackage = packageSizeWeight({ sizeWeight: job.candidateData?.sizeWeight || {}, skuVariants: [variant] });
        var vPrice = finalPriceCny;
        var variantPricingFields = pricingFields;
        try {
          var variantPurchase = Math.max(Number(variant.price || bestMatchPrice || 0) + PURCHASE_COST_MARKUP_RMB, 1);
          var variantCalc = calculateOzonPrice({
            purchaseCost: variantPurchase,
            weightG: variantPackage.ok ? variantPackage.weight : packageInfo.weight,
            lengthMm: variantPackage.ok ? variantPackage.depth : packageInfo.depth,
            widthMm: variantPackage.ok ? variantPackage.width : packageInfo.width,
            heightMm: variantPackage.ok ? variantPackage.height : packageInfo.height,
            profitRate: 0.3,
            ...commissionInput,
          });
          vPrice = roundMoney(variantCalc.priceCny || variantCalc.nextPriceCny || finalPriceCny);
          variantPricingFields = derivePricingPolicyFields({
            priceCny: vPrice,
            baseCost: variantCalc.baseCost || 0,
            policy: pricingPolicy,
          });
          pricingDiagnosis.variants.push({
            offerId: variantOfferId(parentSku, variant, index),
            sourcePriceCny: roundMoney(Number(variant.price || bestMatchPrice || 0)),
            purchaseCost: roundMoney(variantPurchase),
            priceCny: vPrice,
            oldPriceCny: variantPricingFields.oldPriceCny,
            minPriceCny: variantPricingFields.minPriceCny,
            oldPriceSource: variantPricingFields.oldPriceSource,
            minPriceSource: variantPricingFields.minPriceSource,
            marginFloor: variantPricingFields.marginFloor,
            baseCost: roundMoney(variantCalc.baseCost || 0),
            logisticsFee: roundMoney(variantCalc.logisticsFee || 0),
            commission: roundMoney(variantCalc.commission || 0),
            commissionRate: Number(variantCalc.commissionRate ?? commissionInput.commissionRate),
            commissionSource: variantCalc.commissionSource || commissionInput.commissionSource,
            level: variantCalc.level ? { id: variantCalc.level.id || "", name: variantCalc.level.name || "" } : null,
            package: {
              weightG: variantPackage.ok ? variantPackage.weight : packageInfo.weight,
              lengthMm: variantPackage.ok ? variantPackage.depth : packageInfo.depth,
              widthMm: variantPackage.ok ? variantPackage.width : packageInfo.width,
              heightMm: variantPackage.ok ? variantPackage.height : packageInfo.height,
            },
          });
        } catch {}
        var variantImage = normalizeImageUrlsForOzon([variant.image]).slice(0, 1);
        var itemImages = variantImage.length ? normalizeImageUrlsForOzon(variantImage.concat(ozonImages)) : ozonImages;
        return Object.assign({}, item, {
          offer_id: variantOfferId(parentSku, variant, index),
          name: variantTitleForListing(title, variant, index),
          images: itemImages,
          price: String(vPrice),
          old_price: String(variantPricingFields.oldPriceCny),
          min_price: variantPricingFields.minPriceCny,
          weight: variantPackage.ok ? variantPackage.weight : item.weight,
          depth: variantPackage.ok ? variantPackage.depth : item.depth,
          width: variantPackage.ok ? variantPackage.width : item.width,
          height: variantPackage.ok ? variantPackage.height : item.height,
          attributes: mergeVariantListingAttributes(attrs, variantAspectAttributes(variant, variantAttrsMeta, index)),
        });
      })
      : [Object.assign({}, item, attrs.length ? { attributes: attrs } : {})];
    var beforeDedupeCount = submitItems.length;
    submitItems = dedupeSubmitItemsByOfferId(submitItems);
    if (variantsForListing.length) {
      await addStep(jobId, "variants_expanded", "已展开 " + submitItems.length + " 个Ozon变体SKU，父SKU: " + parentSku);
      if (submitItems.length < beforeDedupeCount) {
        await addStep(jobId, "variants_deduped", "已移除 " + (beforeDedupeCount - submitItems.length) + " 个重复 offer_id 变体");
      }
    }
    if (workflowRun) {
      var completePricingNode = workflowNodeFromAutoListingStage("matching", {
        bestMatch: job.bestMatch || {},
        pricingDiagnosis,
        nodeStatus: "success",
      });
      await upsertWorkflowNode(workflowRun.id, {
        ...completePricingNode,
        input: {
          autoListingJobId: job.id,
          sourcePriceCny: bestMatchPrice,
          purchaseMarkupRmb: PURCHASE_COST_MARKUP_RMB,
          package: pricingDiagnosis.package,
        },
        runStatus: "running",
      }).catch(function() {});
    }
    var submitItem = submitItems[0];
    var payloadForValidation = submitItems.length === 1 ? submitItems[0] : { items: submitItems };
    var contentSummary = contentGenerationWorkflowSummary(lc, job.candidateData || {}, job.visualCard || null);
    var preflightNode = buildPreflightGateNode({
      payload: payloadForValidation,
      attrsMeta: variantAttrsMeta,
      contentSummary,
      category: categoryMatch,
      // Reuse the exact pricing diagnosis produced for this job.  Omitting it
      // here let a complete-but-manual procurement record bypass the pricing
      // risk gate and still call product/import.
      pricing: pricingDiagnosis,
      variantCount: submitItems.length,
    });
    if (workflowRun) {
      await upsertWorkflowNode(workflowRun.id, preflightNode).catch(function() {});
    }
    if (!preflightNode.output.ok) {
      await updateJob(jobId, {
        status: "preflight_blocked",
        stage: "preflight_blocked",
        reasonCode: "PREFLIGHT_BLOCKED",
        error: preflightNode.output.issues.map(function(issue) { return issue.message || issue.code; }).join("；"),
      });
      await addStep(jobId, "preflight_blocked", "提交前总闸阻止上架: " + preflightNode.output.issueCount + " 个问题");
      return {
        ok: false,
        status: "preflight_blocked",
        reasonCode: "PREFLIGHT_BLOCKED",
        error: "提交前总闸发现风险，已阻止提交 Ozon。",
        issues: preflightNode.output.issues,
      };
    }
    var result = await ozonRequest(store, "/v3/product/import", { items: submitItems });
    var taskId = result && (result.task_id || result.result?.task_id) ? (result.task_id || result.result.task_id) : null;
    var importInfo = await waitForImportInfo(store, taskId).catch(function(e) { return { error: e.message }; });
    var rawImportErrors = (importInfo?.result?.items || []).flatMap(function(row) { return row.errors || []; });
    var splitImport = splitImportWarningsAndErrors(rawImportErrors);
    var importErrors = splitImport.blockingErrors;
    var importWarnings = splitImport.warnings;
    var listingDefects = splitImport.listingDefects;
    var importedItems = (importInfo?.result?.items || []).filter(function(row) { return Number(row.product_id || 0) > 0; });
    var importOutcomeUnknown = Boolean(importInfo?.error)
      || !taskId
      || !importInfo
      || !Array.isArray(importInfo?.result?.items);

    if (!importOutcomeUnknown && shouldAutoRetryImport(submitItems.length, importErrors)) {
      var retryItem = Object.assign({}, submitItem);
      if (needTitleRetry(importErrors)) {
        retryItem.name = sanitizeListingTitle(retryItem.name, modelName + " " + parentSku, {
          candidateTitle: job.bestMatch?.candidateTitle || job.candidateData?.title || "",
          ozonTitle: job.ozonTitle || job.ozonContext?.title || "",
          productType: lc.product_type_ru || "",
        });
        retryItem.description = String(retryItem.description || retryItem.name).replace(/\s+/g, " ").slice(0, 2500);
        await addStep(jobId, "retry_title", "检测到标题重复/违规，净化标题后重试");
      }
      if (needModelRetry(importErrors)) {
        retryItem.attributes = mergeRetryModelAttributes(retryItem.attributes || [], brandAttr, modelAttributesForMeta(modelName + " " + parentSku, attrsMeta));
        await addStep(jobId, "retry_model", "检测到型号必填，自动补全型号后重试");
      }
      if (needSizeWeightRetry(importErrors)) {
        var safe = safeFallbackPackageInfo(packageInfo);
        retryItem.weight = safe.weight;
        retryItem.depth = safe.depth;
        retryItem.width = safe.width;
        retryItem.height = safe.height;
        await addStep(jobId, "retry_size_weight", "检测到尺重报错，切换安全尺重后重试");
      }
      if (needCategoryTypeRetry(importErrors) && categoryMatches[1]) {
        var alt = categoryMatches[1];
        retryItem.description_category_id = Number(alt.description_category_id);
        retryItem.type_id = Number(alt.type_id);
        var altSmartAttrs = await resolveSmartCategoryAttrs(store, alt, lc, packageInfo, job.ozonContext || {}, productForCategory).catch(function() { return []; });
        retryItem.attributes = dedupeAttrs([brandAttr]
          .concat(modelAttributesForMeta(modelName + " " + parentSku, attrsMeta))
          .concat(countryAttributes())
          .concat(buildMarketingAttributes(lc))
          .concat(altSmartAttrs)
          .filter(Boolean));
        await addStep(jobId, "retry_category_type", "检测到类型/类目不匹配，自动切换候选类目重试: " + alt.path);
      }
      var retryResult = await ozonRequest(store, "/v3/product/import", { items: [retryItem] });
      var retryTaskId = retryResult && (retryResult.task_id || retryResult.result?.task_id) ? (retryResult.task_id || retryResult.result.task_id) : null;
      var retryImportInfo = await waitForImportInfo(store, retryTaskId).catch(function(e) { return { error: e.message }; });
      var rawRetryErrors = (retryImportInfo?.result?.items || []).flatMap(function(row) { return row.errors || []; });
      var splitRetry = splitImportWarningsAndErrors(rawRetryErrors);
      var retryErrors = splitRetry.blockingErrors;
      var retryWarnings = splitRetry.warnings;
      var retryDefects = splitRetry.listingDefects;
      var retryImported = (retryImportInfo?.result?.items || []).filter(function(row) { return Number(row.product_id || 0) > 0; });
      if (retryImported.length || retryErrors.length <= importErrors.length) {
        submitItem = retryItem;
        submitItems = [retryItem];
        result = retryResult;
        taskId = retryTaskId;
        importInfo = retryImportInfo;
        importErrors = retryErrors;
        importWarnings = retryWarnings;
        listingDefects = retryDefects;
        importedItems = retryImported;
        importOutcomeUnknown = Boolean(retryImportInfo?.error)
          || !retryTaskId
          || !retryImportInfo
          || !Array.isArray(retryImportInfo?.result?.items);
      }
    }
    if (workflowRun) {
      await upsertWorkflowNode(workflowRun.id, workflowReviewReconcileNode({
        taskId,
        importedItems,
        importWarnings,
        listingDefects,
        importErrors,
        skuOffers: submitItems.map(function(row) { return row.offer_id; }),
        submitPayload: { items: submitItems },
        attrsMeta: variantAttrsMeta,
      })).catch(function() {});
    }
    var barcodeResult = null;
    if (!importErrors.length && !listingDefects.length && importedItems.length) {
      barcodeResult = await generateBarcodesForImportedProducts(store, importInfo).catch(function(e) { return { error: e.message }; });
      if (barcodeResult) await addStep(jobId, "barcode_requested", "已请求Ozon自动生成条码");
    }
    var nextStatus = importOutcomeUnknown ? "needs_review" : (listingDefects.length ? "needs_review" : (importErrors.length ? "failed" : "submitted"));
    if (!importOutcomeUnknown && !listingDefects.length && importErrors.length && taskId) {
      nextStatus = "submitted";
    }
    var nextStage = importOutcomeUnknown ? "needs_review" : (listingDefects.length ? "listing_defect" : (importErrors.length ? "submitted_with_errors" : "submitted"));
    var nextReasonCode = listingDefects.length
      ? "VARIANT_GROUPING_FAILED"
      : (importOutcomeUnknown ? "OZON_IMPORT_INFO_OUTCOME_UNKNOWN" : (importErrors.length ? mapReasonCode(importErrors.map(function(x){return x.message || x.description || "";}).join(" ")) : ""));
    await updateJob(jobId, {
      status: nextStatus,
      stage: nextStage,
      reasonCode: nextReasonCode,
      error: importOutcomeUnknown
        ? "Ozon 提交结果未知，未确认 import-info，不得继续库存或自动重试。"
        : (listingDefects.length ? "Ozon 商品已导入，但变体特征未形成唯一组合，卡片合并失败。" : ""),
      listingResult: {
        taskId: taskId,
        storeId: storeId,
        sku: parentSku,
        submitPayload: submitItems.length === 1 ? submitItems[0] : { items: submitItems },
        attrsMeta: variantAttrsMeta,
        skuOffers: submitItems.map(function(row) { return row.offer_id; }),
        categoryMatch: categoryMatch,
        priceCalc: priceCalc,
        importInfo: importInfo,
        importWarnings: importWarnings,
        listingDefects: listingDefects,
        barcodeResult: barcodeResult,
        ozonResponse: result,
      },
    });
    if (workflowRun) {
      await appendWorkflowEvent(workflowRun.id, {
        node: "ozon_submit",
        type: "task_submitted",
        message: "已提交 Ozon task " + taskId,
        data: { taskId, parentSku, storeId, offers: submitItems.map(function(row) { return row.offer_id; }) },
      }).catch(function() {});
      await findOrCreateWorkflowForAutoListingJob({
        id: jobId,
        bestMatch: job.bestMatch,
        listingResult: { sku: parentSku, taskId, storeId },
      }).catch(function() {});
    }
    if (nextStatus === "submitted" || nextStatus === "needs_review") {
      await addStep(jobId, "stock_blocked", "提交结果或当前商品状态尚未提供精确 offer_id/warehouse_id 库存证据，未排队库存写入。");
    }
    await addStep(jobId, nextStage, listingDefects.length
      ? "Ozon 变体合并失败，已停止库存流程，等待修正整组变体特征。"
      : "已提交Ozon，等待审核。 SKU: " + parentSku + " 任务ID: " + (taskId || "N/A"));
    trackEvent("listing_submitted", {
      jobId: jobId,
      storeId: storeId,
      stage: "submitted",
      status: "submitted",
      reasonCode: importErrors.length ? mapReasonCode(importErrors.map(function(x){return x.message || x.description || "";}).join(" ")) : "",
      durationMs: job.createdAt ? Date.now() - new Date(job.createdAt).getTime() : 0,
    });
    if (nextStatus === "submitted") {
      await recordListingExperience({
        jobId: jobId,
        opportunityId: job.opportunityId,
        outcome: "submitted",
        stage: "submitted",
        candidate: job.bestMatch ? { title: job.bestMatch.candidateTitle, url: job.bestMatch.candidateUrl, priceMin: job.bestMatch.purchasePriceCny } : null,
        match: { match: true, confidence: Number(job.bestMatch?.matchConfidence || 0), reason: String(job.bestMatch?.matchTier || "listed") },
        profit: job.bestMatch ? {
          basis: job.bestMatch.profitBasis,
          margin: job.bestMatch.margin,
          targetProfitRate: job.bestMatch.targetProfitRate,
          estRubPrice: job.bestMatch.estRubPrice,
          actualOzonPrice: job.bestMatch.actualOzonPrice,
          priceDiff: job.bestMatch.priceDiff,
          marketPriceOk: true,
          purchasePriceCny: job.bestMatch.purchasePriceCny,
        } : null,
        listingContent: job.listingContent || {},
        ozonContext: job.ozonContext || {},
        searchKeywords: job.searchKeywords || [],
      });
    }
    return { ok: !listingDefects.length, sku: parentSku, taskId: taskId, status: nextStatus, reasonCode: nextReasonCode, result: result };
  } catch (err) {
    await failJob(jobId, "上架失败: " + (err.message || String(err)));
    return { ok: false, error: err.message };
  }
}

export async function reconcileSubmittedJobs(options = {}) {
  var limit = Number(options.limit || 20);
  var requestedJobId = String(options.jobId || "").trim();
  var requestedTaskId = Number(options.taskId || 0);
  var requestedStoreId = String(options.storeId || "").trim();
  var requestedEnvironment = String(options.environment || "").trim();
  var jobs = await readJobs();
  var candidates = jobs
    .filter(function(j) {
      if (!["submitted", "pending_moderation"].includes(j.status)) return false;
      if (requestedJobId && String(j.id || "") !== requestedJobId) return false;
      if (requestedTaskId > 0 && Number(j?.listingResult?.taskId || 0) !== requestedTaskId) return false;
      var storeId = String(j?.listingResult?.storeId || j?.storeId || "").trim();
      if (requestedStoreId && storeId !== requestedStoreId) return false;
      // Keep a submitted task with a missing store in the reconciliation
      // candidate set so it can be surfaced as needs_review below. Filtering
      // it out here would leave the task permanently stuck in submitted with
      // no seller-visible recovery action.
      return Number(j?.listingResult?.taskId || 0) > 0;
    })
    .slice(0, limit);
  var updated = 0;
  var live = 0;
  var failed = 0;
  var pending = 0;

  for (const job of candidates) {
    try {
      var effectiveListingStoreId = String(job?.listingResult?.storeId || job?.storeId || "").trim();
      var store = getStore(effectiveListingStoreId);
      if (!store) {
        // Do not silently leave a submitted job stuck forever when an older
        // workflow stored the store only on the job root (or the config no
        // longer contains that store). Surface a seller-repair state instead.
        await updateJob(job.id, {
          status: "needs_review",
          stage: "needs_review",
          reasonCode: "LISTING_STORE_UNAVAILABLE",
          error: "提交结果待回查，但当前店铺配置不可用；请恢复店铺绑定后重新回查。",
        });
        await addStep(job.id, "needs_review", "提交结果无法回查：当前店铺配置不可用，请恢复店铺绑定后重试。");
        failed += 1;
        updated += 1;
        continue;
      }
      var info = await ozonRequest(store, "/v1/product/import/info", {
        task_id: Number(job.listingResult.taskId),
      });
      var items = info?.result?.items || info?.items || [];
      var rawErrors = (Array.isArray(items) ? items : []).flatMap(function(row) { return row.errors || []; });
      var split = splitImportWarningsAndErrors(rawErrors);
      var errors = split.blockingErrors;
      var warnings = split.warnings;
      var listingDefects = split.listingDefects;
      var imported = (Array.isArray(items) ? items : []).filter(function(row) {
        return Number(row.product_id || 0) > 0 || String(row.status || "").toLowerCase() === "imported";
      });
      if (listingDefects.length) {
        var defectMessage = listingDefects.map(function(e) { return e.message || e.description || e.code; }).filter(Boolean).join("；");
        var defectWorkflow = await findOrCreateWorkflowForAutoListingJob(job).catch(function() { return null; });
        if (defectWorkflow) {
          await upsertWorkflowNode(defectWorkflow.id, workflowReviewReconcileNode({
            taskId: job.listingResult.taskId,
            importedItems: imported,
            importWarnings: warnings,
            listingDefects: listingDefects,
            importErrors: errors,
            skuOffers: job.listingResult.skuOffers || [],
            submitPayload: job.listingResult.submitPayload || {},
            attrsMeta: job.listingResult.attrsMeta || [],
          })).catch(function() {});
        }
        await updateJob(job.id, {
          status: "needs_review",
          stage: "listing_defect",
          reasonCode: "VARIANT_GROUPING_FAILED",
          error: defectMessage || "Ozon 变体合并失败。",
          listingResult: Object.assign({}, job.listingResult, { importInfo: info, importWarnings: warnings, listingDefects: listingDefects }),
        });
        await addStep(job.id, "listing_defect", "Ozon 已导入商品但变体合并失败，必须修正可变特征后整组重提。");
        failed += 1;
        updated += 1;
        continue;
      }
      if (errors.length) {
        var msg = errors.map(function(e) { return e.message || e.description || e.code; }).filter(Boolean).join("；");
        await updateJob(job.id, {
          status: "failed",
          stage: "failed",
          reasonCode: mapReasonCode(msg),
          error: msg,
          listingResult: Object.assign({}, job.listingResult, { importInfo: info }),
        });
        await addStep(job.id, "failed", "审核失败: " + msg);
        trackEvent("listing_failed", {
          jobId: job.id,
          storeId: effectiveListingStoreId,
          stage: "failed",
          status: "failed",
          reasonCode: mapReasonCode(msg),
          durationMs: job.createdAt ? Date.now() - new Date(job.createdAt).getTime() : 0,
        });
        await recordListingExperience({
          jobId: job.id,
          opportunityId: job.opportunityId,
          outcome: "failed",
          stage: "failed",
          failReason: msg,
          candidate: job.bestMatch ? { title: job.bestMatch.candidateTitle, url: job.bestMatch.candidateUrl, priceMin: job.bestMatch.purchasePriceCny } : null,
          match: { match: true, confidence: Number(job.bestMatch?.matchConfidence || 0), reason: String(job.bestMatch?.matchTier || "submitted") },
          profit: job.bestMatch || null,
          listingContent: job.listingContent || {},
          ozonContext: job.ozonContext || {},
          searchKeywords: job.searchKeywords || [],
        });
        failed += 1;
        updated += 1;
        continue;
      }
      if (imported.length) {
        var productReadiness = await reconcileImportedProductReadiness({
          ...job,
          listingResult: Object.assign({}, job.listingResult, {
            importInfo: info,
            ...(requestedEnvironment ? { environment: requestedEnvironment } : {}),
          }),
        }, { readProductStatus: options.readProductStatus });
        await updateJob(job.id, {
          ...productReadiness.patch,
          listingResult: Object.assign({}, job.listingResult, { importInfo: info, importWarnings: warnings, readiness: productReadiness.evidence.state, readinessEvidence: productReadiness.evidence }),
        });
        var readinessStatus = productReadiness.evidence.state === "ready_for_sale" ? "ready_for_sale" : productReadiness.evidence.state === "moderation_failed" ? "moderation_failed" : "pending_moderation";
        await addStep(job.id, productReadiness.patch.stage, readinessStatus === "ready_for_sale" ? "Ozon 商品状态只读回查已确认可售。" : "Ozon 已导入商品，等待审核与可售状态回读。");
        trackEvent("stock_success", {
          jobId: job.id,
          storeId: effectiveListingStoreId,
          stage: productReadiness.patch.stage,
          status: productReadiness.patch.status,
          reasonCode: "",
          durationMs: job.createdAt ? Date.now() - new Date(job.createdAt).getTime() : 0,
        });
        await recordListingExperience({
          jobId: job.id,
          opportunityId: job.opportunityId,
          outcome: readinessStatus === "ready_for_sale" ? "listed" : "submitted",
          stage: productReadiness.patch.stage,
          candidate: job.bestMatch ? { title: job.bestMatch.candidateTitle, url: job.bestMatch.candidateUrl, priceMin: job.bestMatch.purchasePriceCny } : null,
          match: { match: true, confidence: Number(job.bestMatch?.matchConfidence || 0), reason: String(job.bestMatch?.matchTier || "submitted") },
          profit: job.bestMatch || null,
          listingContent: job.listingContent || {},
          ozonContext: job.ozonContext || {},
          searchKeywords: job.searchKeywords || [],
        });
        if (readinessStatus === "ready_for_sale") live += 1;
        else if (readinessStatus === "moderation_failed") failed += 1;
        else pending += 1;
        updated += 1;
        continue;
      }
      pending += 1;
    } catch {
      pending += 1;
    }
  }
  return { ok: true, scanned: candidates.length, updated, live, failed, pending };
}

export function buildSubmittedReconciliationSellerResult(result = {}) {
  const scanned = Math.max(0, Number(result.scanned || 0));
  const failed = Math.max(0, Number(result.failed || 0));
  const live = Math.max(0, Number(result.live || 0));
  const pending = Math.max(0, Number(result.pending || 0));
  if (failed > 0) return { status: "needs_repair", scanned, action: "打开审核失败商品，按逐 Offer 错误修复资料并重新预检；不要重复提交未知结果。", sideEffect: "仅执行 Ozon 商品状态只读回查并更新本地任务状态；未提交商品、价格或库存写操作。", result: `已识别 ${failed} 个审核失败任务，需人工修复。` };
  if (pending > 0) return { status: "pending_moderation", scanned, action: "等待审核后再次只读回查；在确认可售前不要写入库存。", sideEffect: "仅执行 Ozon 商品状态只读回查并更新本地任务状态；未提交商品、价格或库存写操作。", result: `有 ${pending} 个任务仍在审核或缺少可售状态证据。` };
  if (live > 0) return { status: "ready_for_sale", scanned, action: "进入仓库读取精确 offer_id/warehouse_id 库存，再执行库存预检。", sideEffect: "仅执行 Ozon 商品状态只读回查并更新本地任务状态；未提交商品、价格或库存写操作。", result: `已确认 ${live} 个商品可售，库存仍需单独证据。` };
  return { status: "no_pending_jobs", scanned, action: "当前没有待回查的上架任务。", sideEffect: "仅执行 Ozon 商品状态只读回查并更新本地任务状态；未提交商品、价格或库存写操作。", result: "没有商品状态发生变化。" };
}

// Exported only for deterministic transport-failure tests; production callers
// use the internal helper above so the request path remains unchanged.
export { waitForImportInfo };
