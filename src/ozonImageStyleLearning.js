import fs from "node:fs/promises";
import path from "node:path";
import { listOzonLearningItems } from "./ozonLearning.js";

const DATA_DIR = path.resolve(process.env.OZON_LEARNING_DATA_DIR || "data");
const OBSERVATION_FILE = path.join(DATA_DIR, "ozon-image-style-observations.json");

function nowIso() {
  return new Date().toISOString();
}

async function readObservationFile() {
  try {
    const parsed = JSON.parse(await fs.readFile(OBSERVATION_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeObservationFile(data) {
  await fs.mkdir(path.dirname(OBSERVATION_FILE), { recursive: true });
  const tmp = `${OBSERVATION_FILE}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, OBSERVATION_FILE);
}

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeOzonProductImages(candidates = []) {
  return [...new Set(candidates
    .map((url) => String(url || "").trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url) => /ozonusercontent\.com/i.test(url))
    .filter((url) => !/\/marketing-api\//i.test(url))
    .filter((url) => !/\/fs-my-account-avatar\//i.test(url))
    .filter((url) => !/seller|avatar|logo|icon|badge|sprite|placeholder|my-account/i.test(url))
    .sort((a, b) => ozonProductImageScore(b) - ozonProductImageScore(a)))]
    .slice(0, 12);
}

function normalizeImages(item = {}) {
  const detailImages = Array.isArray(item.detail?.images) ? item.detail.images : [];
  return normalizeOzonProductImages([
    item.image,
    item.detail?.image,
    ...detailImages,
    ...(Array.isArray(item.images) ? item.images : []),
  ]);
}

function ozonProductImageScore(url = "") {
  const text = String(url || "").toLowerCase();
  let score = 0;
  if (/ozonusercontent\.com/.test(text)) score += 20;
  if (/product|product-service|multimedia|s3\//.test(text)) score += 18;
  if (/gallery|cover|photo|image/.test(text)) score += 10;
  if (/wc\d{2,4}|ws\d{2,4}|w\d{2,4}|h\d{2,4}/.test(text)) score += 4;
  if (/marketing-api|banner|avatar|seller|logo|icon|badge|sprite|placeholder|my-account/.test(text)) score -= 80;
  if (/\/category\/|\/highlight\//.test(text)) score -= 25;
  return score;
}

function categoryLevels(category = "") {
  const parts = compactText(category)
    .split(/\s*[>/›→|]\s*/u)
    .map((part) => compactText(part))
    .filter(Boolean);
  return {
    level1: parts[0] || "未分类",
    level2: parts.slice(0, 2).join(" / ") || parts[0] || "未分类",
    path: parts.join(" / ") || compactText(category) || "未分类",
  };
}

function sampleKey(item = {}) {
  return String(item.url || item.id || "").trim();
}

function buildProductObservation(item = {}) {
  const images = normalizeImages(item);
  const levels = categoryLevels(item.category || item.detail?.category || "");
  return {
    id: String(item.id || ""),
    url: String(item.url || item.detail?.url || ""),
    title: compactText(item.title || item.detail?.title || ""),
    category: levels.path,
    level1: levels.level1,
    level2: levels.level2,
    priceRub: Number(item.price || item.detail?.price || 0),
    rating: Number(item.rating || item.detail?.frontSignals?.rating || 0),
    reviewCount: Number(item.reviewCount || item.detail?.frontSignals?.reviewCount || 0),
    opportunityScore: Number(item.opportunityScore || 0),
    imageCount: images.length,
    images,
    firstImage: images[0] || "",
    hasDetail: Boolean(item.detail),
    sourceTaskId: String(item.taskId || ""),
    collectedAt: item.updatedAt || item.createdAt || "",
  };
}

function groupObservations(observations = []) {
  const groups = new Map();
  for (const obs of observations) {
    const key = obs.level2 || obs.level1 || "未分类";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        level1: obs.level1,
        level2: obs.level2,
        sampleCount: 0,
        detailCount: 0,
        imageCounts: [],
        avgImageCount: 0,
        priceMinRub: 0,
        priceMaxRub: 0,
        avgReviewCount: 0,
        topSamples: [],
        sequenceSamples: [],
      });
    }
    const group = groups.get(key);
    group.sampleCount += 1;
    if (obs.hasDetail) group.detailCount += 1;
    group.imageCounts.push(obs.imageCount);
    if (obs.priceRub > 0) {
      group.priceMinRub = group.priceMinRub ? Math.min(group.priceMinRub, obs.priceRub) : obs.priceRub;
      group.priceMaxRub = Math.max(group.priceMaxRub || 0, obs.priceRub);
    }
    group.avgReviewCount += obs.reviewCount || 0;
    group.topSamples.push(obs);
    if (obs.images.length) {
      group.sequenceSamples.push({
        title: obs.title,
        url: obs.url,
        imageCount: obs.imageCount,
        images: obs.images.slice(0, 8),
      });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      avgImageCount: group.imageCounts.length
        ? Number((group.imageCounts.reduce((sum, count) => sum + count, 0) / group.imageCounts.length).toFixed(2))
        : 0,
      avgReviewCount: group.sampleCount ? Math.round(group.avgReviewCount / group.sampleCount) : 0,
      topSamples: group.topSamples
        .sort((a, b) => (b.reviewCount - a.reviewCount) || (b.opportunityScore - a.opportunityScore))
        .slice(0, 8)
        .map((item) => ({
          title: item.title,
          url: item.url,
          priceRub: item.priceRub,
          rating: item.rating,
          reviewCount: item.reviewCount,
          imageCount: item.imageCount,
          firstImage: item.firstImage,
        })),
      sequenceSamples: group.sequenceSamples.slice(0, 6),
    }))
    .sort((a, b) => b.sampleCount - a.sampleCount || b.detailCount - a.detailCount);
}

function buildVisionQueue(observations = [], limit = 80) {
  return observations
    .filter((item) => item.images.length)
    .sort((a, b) => (b.reviewCount - a.reviewCount) || (b.imageCount - a.imageCount))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      url: item.url,
      images: item.images.slice(0, 8),
      instruction: "观察 Ozon 真实商品图片序列，不预设白底/场景/拼图等标签；只描述图片实际呈现、顺序、文字/参数/包装/使用场景/多SKU等可见事实。",
    }));
}

export async function buildOzonImageStyleObservations(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 500), 5000));
  const minImages = Math.max(0, Number(options.minImages || 1));
  const query = compactText(options.query || "").toLowerCase();
  const items = await listOzonLearningItems();
  const seen = new Set();
  const observations = [];
  for (const item of items) {
    const key = sampleKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const observation = buildProductObservation(item);
    if (observation.imageCount < minImages) continue;
    if (query && !`${observation.title} ${observation.category}`.toLowerCase().includes(query)) continue;
    observations.push(observation);
    if (observations.length >= limit) break;
  }
  const payload = {
    ok: true,
    builtAt: nowIso(),
    source: "ozon_learning_items",
    totalObserved: observations.length,
    totalImages: observations.reduce((sum, item) => sum + item.imageCount, 0),
    groups: groupObservations(observations),
    visionQueue: buildVisionQueue(observations, Number(options.visionLimit || 80)),
    notes: [
      "第一版只做真实样本聚合，不预设 Ozon 图片风格。",
      "visionQueue 可交给 GPT-5 nano/豆包视觉模型做逐商品图片序列观察。",
      "聚合结果用于后续生成 Product Intelligence Card 和图片生成提示词。",
    ],
  };
  await writeObservationFile(payload);
  return payload;
}

export async function getOzonImageStyleObservations() {
  const cached = await readObservationFile();
  if (cached?.builtAt) return { ok: true, ...cached };
  return buildOzonImageStyleObservations({ limit: 300, minImages: 1 });
}
