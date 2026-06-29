import fs from "node:fs/promises";
import path from "node:path";
import { analyzeOzonOpportunities, listOzonLearningItems, listOzonOpportunities } from "./ozonLearning.js";
import { triggerRuleAnalysis, getRuleSummary } from "./listingRules.js";
import { expandKeywords, createExpandedTasks, matchCandidatesWithOpportunities, listCrawlerCandidates, listCrawlerTasks } from "./crawler1688.js";
import { translateRusToCn } from "./autoListing.js";
import { llmConfig } from "./llmListing.js";
import { JobRepository } from "./jobRepository.js";
import { mapReasonCode } from "./reasonCodes.js";

const DATA_DIR = path.resolve("data");
const PIPELINE_FILE = path.join(DATA_DIR, "pipeline-status.json");
const STALE_PIPELINE_MS = 30 * 60 * 1000;

function nowIso() { return new Date().toISOString(); }
function makeId() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 8); }

let pipelineState = null;

function fallbackChineseSeeds(items = []) {
  const text = items.map((item) => `${item.title || ""} ${item.category || ""}`).join(" ").toLowerCase();
  const seeds = [];
  if (/чехол|iphone|телефон|смартфон|case/.test(text)) seeds.push("手机壳", "苹果手机壳", "透明手机壳");
  if (/игруш|собак|кош|питом|pet/.test(text)) seeds.push("宠物玩具", "狗狗玩具", "宠物用品批发");
  if (/сувенир|подар|брелок|gift/.test(text)) seeds.push("创意礼品", "钥匙扣挂件", "小礼品批发");
  if (/ванн|органайзер|дом|кухн|хранен/.test(text)) seeds.push("家居收纳", "浴室收纳", "厨房收纳用品");
  if (/смол|эпоксид|молд|силикон|рукодел|украшен/.test(text)) seeds.push("滴胶模具", "树脂手作模具", "硅胶首饰模具");
  if (/творчеств|канцел|настольн|игр/.test(text)) seeds.push("儿童益智玩具", "桌游玩具", "手工材料包");
  const categorySeeds = items
    .map((item) => String(item.category || item.title || "").split(/[>/,，;；|]/).pop())
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 24)
    .slice(0, 5);
  return [...new Set(seeds.concat(categorySeeds))].slice(0, 10);
}

export async function getPipelineStatus() {
  try {
    pipelineState = await JobRepository.readPipelineState(PIPELINE_FILE);
  } catch {
    pipelineState = null;
  }
  const state = pipelineState || { status: "idle", steps: [], startedAt: null, completedAt: null, error: null };
  const failedStep = (state.steps || []).find((s) => s.status === "failed");
  state.runId = state.id || null;
  state.failedStepReasonCode = failedStep ? mapReasonCode(failedStep.detail || "") : null;
  state.summary = {
    totalSteps: (state.steps || []).length,
    completedSteps: (state.steps || []).filter((s) => s.status === "completed" || s.status === "skipped").length,
    failedSteps: (state.steps || []).filter((s) => s.status === "failed").length,
  };
  return state;
}

async function savePipelineStatus(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  pipelineState = state;
  await JobRepository.writePipelineState(PIPELINE_FILE, state);
}

function isStaleRunningState(state, ttlMs = STALE_PIPELINE_MS) {
  if (String(state?.status || "") !== "running") return false;
  const ts = Date.parse(String(state.updatedAt || state.startedAt || ""));
  return Number.isFinite(ts) && Date.now() - ts > ttlMs;
}

async function releaseStalePipeline(state, reason = "pipeline running state stale") {
  const next = {
    ...state,
    status: "failed",
    error: reason,
    completedAt: nowIso(),
    updatedAt: nowIso(),
    staleReleasedAt: nowIso(),
  };
  next.steps = (next.steps || []).map((step) => step.status === "running"
    ? { ...step, status: "failed", detail: `${step.detail || ""}；${reason}`.trim(), updatedAt: nowIso() }
    : step);
  await savePipelineStatus(next);
  return next;
}

async function updateStep(name, status, detail) {
  const state = await getPipelineStatus();
  const existing = state.steps.find(s => s.name === name);
  if (existing) {
    existing.status = status;
    existing.detail = detail || existing.detail;
    existing.updatedAt = nowIso();
  } else {
    state.steps.push({ name, status, detail: detail || "", startedAt: nowIso(), updatedAt: nowIso() });
  }
  state.updatedAt = nowIso();
  const running = state.steps.some(s => s.status === "running");
  const failed = state.steps.some(s => s.status === "failed");
  state.status = running ? "running" : failed ? "partial" : "completed";
  await savePipelineStatus(state);
  return state;
}

// ====== Step 1: Score collected items ======
async function stepAnalyze(minScore) {
  await updateStep("分析机会品", "running", "正在评分...");
  const result = await analyzeOzonOpportunities({ minScore: minScore || 30 });
  if (!result.ok) {
    await updateStep("分析机会品", "failed", result.reason || "分析失败");
    return { ok: false, reason: result.reason };
  }
  const summary = `${result.totalOpportunities || 0}个机会品, ${result.totalCategories || 0}个品类`;
  await updateStep("分析机会品", "completed", summary);
  return { ok: true, summary, count: result.totalOpportunities || 0 };
}

// ====== Step 2: Build listing rules ======
async function stepBuildRules() {
  await updateStep("提取上架规则", "running", "正在分析标题和属性模式...");
  const result = await triggerRuleAnalysis();
  if (!result.ok) {
    await updateStep("提取上架规则", "skipped", result.reason || "无数据");
    return { ok: false, reason: result.reason };
  }
  await updateStep("提取上架规则", "completed", `${result.categoriesBuilt}个品类, ${result.itemsAnalyzed}个商品`);
  return { ok: true, categoriesBuilt: result.categoriesBuilt, itemsAnalyzed: result.itemsAnalyzed };
}

// ====== Step 3: Translate seeds → Expand → Create 1688 tasks ======
async function stepExpandAndCrawl() {
  await updateStep("1688扩词采集", "running", "正在翻译俄语标题并生成中文搜索词...");

  // Get top scored items as translation source
  const opps = await listOzonOpportunities({ minScore: 30 });
  if (!opps.length) {
    await updateStep("1688扩词采集", "skipped", "无机会品可翻译");
    return { ok: false };
  }

  // Take top 5 titles and translate to Chinese
  const sampleOpps = opps.slice(0, 5);
  const titles = sampleOpps.map(i => (i.title || "").trim()).filter(Boolean);
  
  // Translate via AI
  let chineseSeeds = [];
  for (const title of titles) {
    try {
      const result = await translateRusToCn(title);
      if (result.ok && result.keyword) {
        chineseSeeds.push(result.keyword);
      }
    } catch(e) {}
  }

  if (!chineseSeeds.length) {
    chineseSeeds = fallbackChineseSeeds(sampleOpps);
    if (!chineseSeeds.length) {
      await updateStep("1688扩词采集", "skipped", "AI翻译未返回有效中文关键词，规则兜底也未命中");
      return { ok: false };
    }
  }

  // Deduplicate
  chineseSeeds = [...new Set(chineseSeeds)];
  await updateStep("1688扩词采集", "running", `中文种子: ${chineseSeeds.join(", ")}`);

  // Expand keywords via AI
  try {
    const expanded = await expandKeywords(chineseSeeds, { maxKeywords: 10, multiDim: true }).catch((e) => ({
      ok: false,
      reason: e.message,
      expanded: [],
    }));
    if (!expanded.ok || !expanded.expanded?.length) {
      await updateStep("1688扩词采集", "running", "扩词完成，直接用原始种子");
      // Fall through to use original seeds
    }
    
    const allKeywords = expanded.ok && expanded.expanded?.length 
      ? expanded.expanded.slice(0, 10) 
      : chineseSeeds.slice(0, 5);
    
    // Create 1688 crawler tasks
    const tasks = await createExpandedTasks(chineseSeeds, { maxProducts: 20, maxPages: 2, expandedKeywords: allKeywords });
    const taskCount = tasks.tasks?.length || 0;

    await updateStep("1688扩词采集", "completed", `${taskCount}个任务, 关键词: ${allKeywords.join(", ")}`);
    return { ok: true, taskCount, keywords: allKeywords };
  } catch (e) {
    await updateStep("1688扩词采集", "failed", e.message);
    return { ok: false, reason: e.message };
  }
}

// ====== Step 4: Match 1688 candidates with Ozon opportunities ======
async function stepMatchAndList(autoList) {
  await updateStep("匹配货源并上架", "running", "正在获取1688候选商品...");

  const candidates = await listCrawlerCandidates({ status: "" });
  if (!candidates?.length) {
    // Check if 1688 tasks are still running
    const tasks = await listCrawlerTasks({ status: "running,created,queued" });
    if (tasks?.length) {
      await updateStep("匹配货源并上架", "waiting", `1688采集进行中，剩余${tasks.length}个任务...`);
    } else {
      await updateStep("匹配货源并上架", "skipped", "1688无候选商品，请检查1688采集是否已完成");
    }
    return { ok: false };
  }
  
  const opportunities = await listOzonOpportunities({ minScore: 30 });
  if (!opportunities.length) {
    await updateStep("匹配货源并上架", "skipped", "无机会品可匹配");
    return { ok: false };
  }

  await updateStep("匹配货源并上架", "running", `${opportunities.length}个机会品 × ${candidates.length}个候选商品`);

  const matchResult = await matchCandidatesWithOpportunities(opportunities, candidates);
  const matches = matchResult.matches || matchResult.results || [];

  if (!matches.length) {
    await updateStep("匹配货源并上架", "skipped", "未找到匹配项");
    return { ok: false };
  }

  // Auto-list if requested
  if (autoList && matches.length) {
    let verified = 0, errors = 0;
    for (const match of matches.slice(0, 3)) {
      try {
        const { testMatchAndList } = await import("./autoListing.js");
        const result = await testMatchAndList(match.opportunityId || match.itemId, match.candidateId);
        if (result?.ok) verified++; else errors++;
      } catch(e) { errors++; }
    }
    await updateStep("匹配货源并上架", "completed", `匹配${matches.length}个, 验证${verified}个候选（未提交Ozon）`);
    return { ok: true, matches: matches.length, verified, errors };
  }

  await updateStep("匹配货源并上架", "completed", `匹配到 ${matches.length} 个货源`);
  return { ok: true, matches: matches.length };
}

// ====== Full Pipeline ======
export async function runFullPipeline(options = {}) {
  const { minScore, autoList } = options;

  const initialState = {
    id: makeId(),
    status: "running",
    steps: [],
    startedAt: nowIso(),
    completedAt: null,
    error: null,
    options: { minScore, autoList },
    updatedAt: nowIso(),
  };
  await savePipelineStatus(initialState);

  // Step 1
  const s1 = await stepAnalyze(minScore || 30);
  if (!s1.ok) return await getPipelineStatus();

  // Step 2
  await stepBuildRules();

  // Step 3 - 1688 expand and crawl
  const s3 = await stepExpandAndCrawl();
  if (!s3.ok) {
    // Non-fatal - 1688 may not be ready
    const state = await getPipelineStatus();
    state.status = "partial";
    await savePipelineStatus(state);
  }

  // Step 4 - match and list
  await stepMatchAndList(autoList);

  // Finalize
  const final = await getPipelineStatus();
  final.completedAt = nowIso();
  if (final.status === "running") final.status = "completed";
  await savePipelineStatus(final);
  return final;
}

// ====== Auto-trigger ======
export async function checkAndTriggerPipeline() {
  const items = await listOzonLearningItems();
  const detailed = items.filter(i => i.status === "detailed" || i.detail);
  if (detailed.length >= 3) {
    const state = await getPipelineStatus();
    if (state.status === "running") {
      if (!isStaleRunningState(state)) return { triggered: false, reason: "already running" };
      await releaseStalePipeline(state, "stale running pipeline auto released");
    }
    if (state.status === "completed" && state.completedAt && Date.now() - new Date(state.completedAt).getTime() < 600000) {
      return { triggered: false, reason: "recently completed" };
    }
    runFullPipeline({ minScore: 30, autoList: false }).catch(() => {});
    return { triggered: true, items: detailed.length };
  }
  return { triggered: false, reason: `only ${detailed.length} detailed items, need 3+` };
}
