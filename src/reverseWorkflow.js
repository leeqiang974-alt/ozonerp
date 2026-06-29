import { createExpandedTasks, listCrawlerCandidates, matchCandidatesWithOpportunities } from "./crawler1688.js";
import { listOzonOpportunities } from "./ozonLearning.js";

function pickKeywords(title = "", max = 6) {
  return String(title)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, max);
}

function makeGuidance(match, index) {
  const ozon = match.opportunity || {};
  const c = match.candidate || {};
  const titleKw = pickKeywords(ozon.title || "", 5);
  return {
    rank: index + 1,
    opportunityId: ozon.id || "",
    candidateId: c.id || "",
    ozon: {
      title: ozon.title || "",
      category: ozon.category || "",
      price: ozon.price || "",
      rating: ozon.rating || "",
      reviewCount: ozon.reviewCount || "",
      url: ozon.url || "",
    },
    candidate1688: {
      title: c.title || "",
      supplier: c.supplier || "",
      priceMin: c.priceMin || "",
      priceMax: c.priceMax || "",
      skuCount: c.skuCount || 0,
      url: c.url || "",
    },
    guidance: {
      brand: "无品牌",
      country: "中国",
      modelName: (c.title || "SKU").slice(0, 40) || "SKU",
      titleKeywords: titleKw,
      listingHint: `参考Ozon同类标题结构与属性，先确保型号、尺重、类目一致，再生成富内容。`,
      reason: (match.reason || match.matchReason || "").slice(0, 180),
      score: Number(match.score || 0),
    },
  };
}

export async function runReverseWorkflow(options = {}) {
  const seeds = Array.isArray(options.seeds) ? options.seeds : [];
  const taskOptions = Object.assign(
    { maxProducts: 20, maxPages: 2, mustHaveSku: true, mustHaveSizeWeight: true },
    options.taskOptions || {}
  );
  const minScore = Number(options.minScore || 60);
  const maxCards = Math.max(1, Math.min(Number(options.maxCards || 20), 100));

  const created = await createExpandedTasks(seeds, taskOptions);
  const opportunities = await listOzonOpportunities({ minScore });
  const candidates = await listCrawlerCandidates({ status: "" });

  if (!candidates.length || !opportunities.length) {
    return {
      ok: true,
      status: "pending_candidates",
      createdTasks: created.tasks || [],
      opportunities: opportunities.length,
      candidates: candidates.length,
      cards: [],
      message: "已创建1688任务，等待候选回流后再生成Ozon指导卡。",
    };
  }

  const match = await matchCandidatesWithOpportunities(opportunities, candidates);
  const matches = (match.matches || match.results || []).slice(0, maxCards);
  const cards = matches.map((m, i) => makeGuidance(m, i));

  return {
    ok: true,
    status: "guided",
    createdTasks: created.tasks || [],
    opportunities: opportunities.length,
    candidates: candidates.length,
    matched: matches.length,
    cards,
  };
}

