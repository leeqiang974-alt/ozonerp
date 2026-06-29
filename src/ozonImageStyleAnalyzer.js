import fs from "node:fs/promises";
import path from "node:path";
import { callAiTask } from "./aiTaskRouter.js";
import { getOzonImageStyleObservations, normalizeOzonProductImages } from "./ozonImageStyleLearning.js";

const DATA_DIR = path.resolve(process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR || process.env.OZON_LEARNING_DATA_DIR || "data");
const ANALYSIS_FILE = path.join(DATA_DIR, "ozon-image-style-analysis.json");

function nowIso() {
  return new Date().toISOString();
}

async function readAnalysisFile() {
  try {
    const parsed = JSON.parse(await fs.readFile(ANALYSIS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAnalysisFile(data) {
  await fs.mkdir(path.dirname(ANALYSIS_FILE), { recursive: true });
  const tmp = `${ANALYSIS_FILE}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, ANALYSIS_FILE);
}

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function arrayOfText(value) {
  if (Array.isArray(value)) return value.map(compactText).filter(Boolean).slice(0, 20);
  const text = compactText(value);
  return text ? [text] : [];
}

function buildImageAnalysisPrompt(item = {}) {
  const images = normalizeOzonProductImages(item.images || []);
  return [
    "任务：观察 Ozon 真实商品图片序列，输出结构化 JSON。",
    "重要边界：不要预设白底、场景图、拼图等风格标签；只能描述图片实际可见事实。",
    "用途：这些结论只用于学习和指导后续 Ozon 上架，不直接复制竞品，不直接拿来上架。",
    "",
    `商品标题：${item.title || ""}`,
    `商品类目：${item.category || ""}`,
    `商品链接：${item.url || ""}`,
    "图片序列：",
    ...images.slice(0, 8).map((url, index) => `${index + 1}. ${url}`),
    "",
    "只输出 JSON 对象，字段如下：",
    "{",
    '  "product_type": "根据标题和图片判断的真实商品类型，英文或中文均可",',
    '  "image_sequence": ["按图片顺序描述每张图实际内容"],',
    '  "observed_facts": ["只写可见事实，不写想当然的风格规则"],',
    '  "listing_guidance": ["对后续 Ozon 上架图/标题/描述/属性填写有帮助的建议"],',
    '  "risk_flags": ["广告图、侵权、文字过多、信息不清、类目疑似不匹配等风险；无风险写 none"]',
    "}",
  ].join("\n");
}

function normalizeAnalysisRow(item = {}, aiResult = {}) {
  const json = aiResult.json || {};
  const images = normalizeOzonProductImages(item.images || []);
  return {
    id: String(item.id || item.url || ""),
    title: compactText(item.title || ""),
    category: compactText(item.category || ""),
    url: String(item.url || ""),
    images: images.slice(0, 8),
    productType: compactText(json.product_type || json.productType || ""),
    imageSequence: arrayOfText(json.image_sequence || json.imageSequence),
    observedFacts: arrayOfText(json.observed_facts || json.observedFacts),
    listingGuidance: arrayOfText(json.listing_guidance || json.listingGuidance),
    riskFlags: arrayOfText(json.risk_flags || json.riskFlags),
    provider: aiResult.provider || "",
    model: aiResult.model || "",
    analyzedAt: nowIso(),
  };
}

function sanitizeAnalysisRow(row = {}) {
  const images = normalizeOzonProductImages(row.images || []);
  if (!images.length) return null;
  return {
    ...row,
    images: images.slice(0, 8),
  };
}

export async function getOzonImageStyleAnalysis() {
  const cached = await readAnalysisFile();
  if (cached?.builtAt) return { ok: true, ...cached };
  return {
    ok: true,
    builtAt: "",
    totalAnalyzed: 0,
    rows: [],
    summary: { riskCount: 0, productTypes: [] },
  };
}

export async function analyzeOzonImageStyleQueue(options = {}) {
  const observations = options.observations || await getOzonImageStyleObservations();
  const limit = Math.max(1, Math.min(Number(options.limit || 5), 50));
  const aiTask = options.aiTask || callAiTask;
  const existing = await getOzonImageStyleAnalysis();
  const existingById = new Map((existing.rows || [])
    .map(sanitizeAnalysisRow)
    .filter(Boolean)
    .map((row) => [row.id, row]));
  const queue = (observations.visionQueue || [])
    .map((item) => ({ ...item, images: normalizeOzonProductImages(item?.images || []).slice(0, 8) }))
    .filter((item) => item.images.length)
    .slice(0, limit);
  const rows = [];
  for (const item of queue) {
    const result = await aiTask({
      taskType: "ozon_image_style_observation",
      systemPrompt: "You are an ecommerce image observation assistant. Output JSON only.",
      userPrompt: buildImageAnalysisPrompt(item),
      responseFormat: "json",
      maxTokens: 1200,
      temperature: 0,
    });
    if (!result.ok) {
      rows.push({
        id: String(item.id || item.url || ""),
        title: compactText(item.title || ""),
        category: compactText(item.category || ""),
        url: String(item.url || ""),
        images: normalizeOzonProductImages(item.images || []).slice(0, 8),
        productType: "",
        imageSequence: [],
        observedFacts: [],
        listingGuidance: [],
        riskFlags: [result.error || "AI analysis failed"],
        provider: result.provider || "",
        model: result.model || "",
        analyzedAt: nowIso(),
      });
      continue;
    }
    rows.push(normalizeAnalysisRow(item, result));
  }
  for (const row of rows) existingById.set(row.id, row);
  const allRows = [...existingById.values()].sort((a, b) => String(b.analyzedAt || "").localeCompare(String(a.analyzedAt || "")));
  const payload = {
    ok: true,
    builtAt: nowIso(),
    totalAnalyzed: allRows.length,
    rows: allRows,
    latestRows: rows,
    summary: {
      riskCount: allRows.filter((row) => (row.riskFlags || []).some((risk) => !/^none$/i.test(risk))).length,
      productTypes: [...new Set(allRows.map((row) => row.productType).filter(Boolean))].slice(0, 50),
    },
  };
  await writeAnalysisFile(payload);
  return payload;
}
