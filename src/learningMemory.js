import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const MEMORY_FILE = path.join(DATA_DIR, "listing-learning-memory.json");
const MAX_RECORDS = 500;

function nowIso() { return new Date().toISOString(); }

async function readMemory() {
  try {
    const raw = JSON.parse(await fs.readFile(MEMORY_FILE, "utf8"));
    return Array.isArray(raw.items) ? raw.items : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeMemory(items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MEMORY_FILE, JSON.stringify({ items: items.slice(-MAX_RECORDS) }, null, 2), "utf8");
}

function compactText(text = "", max = 220) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function categoryKey(input = {}) {
  const text = [
    input.ozonContext?.category,
    input.ozonContext?.title,
    input.candidate?.title,
    input.listingContent?.product_type_ru,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/эпоксид|смол|молд|силикон|форма|рукодел|украшен|подвес|树脂|滴胶|模具|首饰|饰品/.test(text)) return "resin_craft_molds";
  if (/животн|собак|кош|pet|宠物/.test(text)) return "pet_supplies";
  if (/сувенир|подар|gift|礼品|礼物/.test(text)) return "gifts";
  return "general";
}

export async function recordListingExperience(input = {}) {
  const item = {
    id: "lm_" + Date.now() + Math.random().toString(36).slice(2, 7),
    createdAt: nowIso(),
    outcome: String(input.outcome || "unknown"),
    stage: String(input.stage || ""),
    categoryKey: categoryKey(input),
    jobId: String(input.jobId || ""),
    opportunityId: String(input.opportunityId || ""),
    ozon: {
      title: compactText(input.ozonContext?.title),
      priceRub: Number(input.ozonContext?.priceRub || 0),
      category: compactText(input.ozonContext?.category, 260),
      reasons: Array.isArray(input.ozonContext?.opportunityReasons) ? input.ozonContext.opportunityReasons.slice(0, 8) : [],
    },
    sourcing: {
      keywords: Array.isArray(input.searchKeywords) ? input.searchKeywords.slice(0, 8) : [],
      candidateTitle: compactText(input.candidate?.title),
      candidateUrl: String(input.candidate?.url || ""),
      purchasePriceCny: Number(input.profit?.purchasePriceCny || input.candidate?.priceMin || 0),
    },
    decision: {
      match: input.match ? {
        ok: Boolean(input.match.match),
        confidence: Number(input.match.confidence || 0),
        reason: compactText(input.match.reason),
      } : null,
      profit: input.profit ? {
        basis: String(input.profit.basis || ""),
        margin: Number(input.profit.margin || 0),
        targetProfitRate: Number(input.profit.targetProfitRate || 0),
        estRubPrice: Number(input.profit.estRubPrice || 0),
        actualOzonPrice: Number(input.profit.actualOzonPrice || 0),
        priceDiff: input.profit.priceDiff === null || input.profit.priceDiff === undefined ? null : Number(input.profit.priceDiff),
        marketPriceOk: input.profit.marketPriceOk !== false,
      } : null,
      failReason: compactText(input.failReason),
    },
    listing: input.listingContent ? {
      titleRu: compactText(input.listingContent.title_ru),
      productTypeRu: compactText(input.listingContent.product_type_ru),
    } : null,
  };
  const items = await readMemory();
  items.push(item);
  await writeMemory(items);
  return item;
}

export async function listLearningMemory(filter = {}) {
  const category = String(filter.categoryKey || "").trim();
  const outcome = String(filter.outcome || "").trim();
  let items = await readMemory();
  if (category) items = items.filter((item) => item.categoryKey === category);
  if (outcome) items = items.filter((item) => item.outcome === outcome);
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getLearningSummary(filter = {}) {
  const items = await listLearningMemory(filter);
  const total = items.length;
  const successful = items.filter((item) => item.outcome === "ready_for_listing" || item.outcome === "listed").length;
  const failed = items.filter((item) => item.outcome === "failed").length;
  const keywordWins = {};
  const failReasons = {};
  for (const item of items) {
    if (item.outcome === "ready_for_listing" || item.outcome === "listed") {
      for (const keyword of item.sourcing.keywords || []) keywordWins[keyword] = (keywordWins[keyword] || 0) + 1;
    }
    if (item.decision?.failReason) failReasons[item.decision.failReason] = (failReasons[item.decision.failReason] || 0) + 1;
  }
  return {
    ok: true,
    total,
    successful,
    failed,
    recent: items.slice(0, 20),
    topKeywords: Object.keys(keywordWins).sort((a, b) => keywordWins[b] - keywordWins[a]).slice(0, 12),
    commonFailures: Object.keys(failReasons).sort((a, b) => failReasons[b] - failReasons[a]).slice(0, 8),
  };
}

export async function getLearningPrompt(context = {}) {
  const key = categoryKey(context);
  const summary = await getLearningSummary({ categoryKey: key });
  if (!summary.total) return "";
  const wins = summary.recent
    .filter((item) => item.outcome === "ready_for_listing" || item.outcome === "listed")
    .slice(0, 5)
    .map((item) => ({
      ozon: item.ozon.title,
      candidate: item.sourcing.candidateTitle,
      keywords: item.sourcing.keywords,
      margin: item.decision?.profit?.margin,
      titleRu: item.listing?.titleRu,
    }));
  const failures = summary.recent
    .filter((item) => item.outcome === "failed")
    .slice(0, 5)
    .map((item) => ({
      ozon: item.ozon.title,
      keywords: item.sourcing.keywords,
      reason: item.decision?.failReason,
    }));
  return [
    "<self_learning_memory>",
    "category_key:" + key,
    "successful_patterns:" + JSON.stringify(wins),
    "failed_patterns:" + JSON.stringify(failures),
    "top_successful_keywords:" + JSON.stringify(summary.topKeywords),
    "common_failures:" + JSON.stringify(summary.commonFailures),
    "</self_learning_memory>",
  ].join("\n");
}
