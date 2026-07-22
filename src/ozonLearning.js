import fs from "node:fs/promises";
import path from "node:path";
import { createCrawlerTask } from "./crawler1688.js";
import { llmConfig } from "./llmListing.js";
import {
  createWorkflowRun,
  listWorkflowRuns,
  upsertWorkflowNode,
  workflowNodeFromAutoListingStage,
} from "./workflowRuns.js";

const DATA_DIR = path.resolve(process.env.OZON_LEARNING_DATA_DIR || "data");
const TASK_FILE = path.join(DATA_DIR, "ozon-learning-tasks.json");
const ITEM_FILE = path.join(DATA_DIR, "ozon-learning-items.json");
const JOB_FILE = path.join(DATA_DIR, "ozon-learning-jobs.json");
const RUNNING_JOB_TIMEOUT_MS = 5 * 60 * 1000;

// ====== BLIND SEEDS ======
const BLIND_SEEDS = [
  "домашний декор",
  "кухонные аксессуары",
  "органайзер для дома",
  "чехол для телефона",
  "косметичка",
  "аксессуары для ванной",
  "детские игрушки",
  "товары для домашних животных",
  "канцелярия",
  "подарки и сувениры",
  "настольные игры",
  "зоотовары",
  "садовый декор",
  "автоаксессуары",
  "рукоделие",
  "набор для творчества",
  "спортивные товары",
  "похудение",
  "книжная полка",
  "коврик для йоги",
];

// ====== EXCLUSION RULES ======
const BRAND_PATTERNS = [
  /apple/i,
  /samsung/i,
  /xiaomi/i,
  /nike/i,
  /adidas/i,
  /lego/i,
  /bosch/i,
  /philips/i,
  /dyson/i,
  /sony/i,
  /lg/i,
  /canon/i,
  /nintendo/i,
  /pampers/i,
  /huggies/i,
];

const RUSSIAN_BULKY_WORDS = [
  "стеллаж",
  "шкаф",
  "комод",
  "кровать",
  "стол",
  "стул",
  "кресло",
  "диван",
  "полка",
  "вешалка",
  "ящик",
  "коврик",
  "тренажер",
  "велосипед",
  "санки",
  "коляск",
  "кроватк",
  "манеж",
  "парт",
  "этажерк",
  "тумб",
];

const RUSSIAN_CRUSHABLE_WORDS = [
  "надувн",
  "песочн",
  "лопатк",
  "ведр",
  "формочк",
  "пазл",
  "конструктор",
  "кубик",
  "раскраск",
  "наклейк",
  "альбом",
  "блокнот",
  "воздушн",
  "шарик",
  "хлопушк",
  "пластилин",
  "лепк",
  "песок",
  "машинк",
  "кукл",
  "радиоуправляем",
];

const RUSSIAN_HEAVY_HIGHVALUE_WORDS = [
  "холодильник",
  "стиральн",
  "микроволнов",
  "посудомоечн",
  "электрочайник",
  "кофеварк",
  "кофемашин",
  "мультиварк",
  "пылесос",
  "утюг",
  "парогенератор",
  "телевизор",
  "монитор",
  "ноутбук",
  "компьютер",
  "кондиционер",
  "обогреватель",
  "вентилятор",
  "электроинструмент",
  "дрель",
  "шуруповерт",
  "болгарк",
  "бензо",
  "генератор",
  "насос",
  "компрессор",
  "металлоискатель",
  "аккумулятор",
];

const MIN_PRICE_RUB = 80;
const MAX_PRICE_RUB = 8000;
const INVALID_TITLE_PATTERNS = [
  /^скидки недели$/i,
  /^похожие$/i,
  /^каталог$/i,
  /^в корзину$/i,
  /^товары за 1/i,
  /^ozon fresh$/i,
  /баллов за отзыв/i,
];

/**
 * Check if a product should be excluded based on title and price.
 */
export function checkProductExcluded(title, price) {
  const t = (title || "").toLowerCase().trim();
  const p = Number(price) || 0;
  if (!hasValidOzonTitle(t)) return { excluded: true, reason: "Некорректное название карточки" };
  if (p > 0 && p < MIN_PRICE_RUB) return { excluded: true, reason: "Цена ниже " + MIN_PRICE_RUB + " RUB" };
  if (p > 0 && p > MAX_PRICE_RUB) return { excluded: true, reason: "Цена выше " + MAX_PRICE_RUB + " RUB" };
  for (const pattern of BRAND_PATTERNS) { if (pattern.test(t)) return { excluded: true, reason: "Известный бренд: " + pattern.source }; }
  for (const w of RUSSIAN_BULKY_WORDS) { if (t.includes(w)) return { excluded: true, reason: "Громоздкий товар: " + w }; }
  for (const w of RUSSIAN_CRUSHABLE_WORDS) { if (t.includes(w)) return { excluded: true, reason: "Объёмный/хрупкий товар: " + w }; }
  for (const w of RUSSIAN_HEAVY_HIGHVALUE_WORDS) { if (t.includes(w)) return { excluded: true, reason: "Тяжёлый/дорогой товар: " + w }; }
  return { excluded: false };
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function nowIso() {
  return new Date().toISOString();
}

function toNumber(val, fallback) {
  const n = Number(val);
  if (!isNaN(n) && n !== Infinity && n !== -Infinity) return n;
  return fallback !== undefined ? fallback : 0;
}

function parsePriceText(text = "") {
  const matches = [...String(text || "").matchAll(/(\d[\d\s]{1,8})\s*₽/g)]
    .map((match) => Number(String(match[1] || "").replace(/\s+/g, "")))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!matches.length) return 0;
  return matches.find((price) => price >= MIN_PRICE_RUB && price <= MAX_PRICE_RUB) || matches[0];
}

function extractFrontSignals(detail = {}) {
  const text = String(detail.description || "").replace(/\s+/g, " ").trim();
  const ratingMatch = text.match(/(\d(?:[.,]\d)?)\s*•\s*([\d\s]+)\s*отзыв/i);
  const sizeMatch = text.match(/Ширина,\s*см\s*(\d+).*?Длина,\s*см\s*(\d+).*?Высота,\s*см\s*(\d+)/i);
  const weightMatch = text.match(/Вес товара,\s*г\s*(\d+)/i);
  const typeMatch = text.match(/Тип\s+([^\n\r]{2,80})/i);
  const materialMatch = text.match(/Материал\s+([^\n\r]{2,120})/i);
  const title = String(detail.title || "");
  const category = String(detail.category || "");
  return {
    rating: ratingMatch ? toNumber(String(ratingMatch[1]).replace(",", "."), 0) : 0,
    reviewCount: ratingMatch ? toNumber(String(ratingMatch[2]).replace(/\s+/g, ""), 0) : 0,
    sizeCm: sizeMatch ? {
      width: toNumber(sizeMatch[1], 0),
      length: toNumber(sizeMatch[2], 0),
      height: toNumber(sizeMatch[3], 0),
    } : null,
    weightG: weightMatch ? toNumber(weightMatch[1], 0) : 0,
    type: typeMatch ? String(typeMatch[1]).trim() : "",
    material: materialMatch ? String(materialMatch[1]).trim() : "",
    tokens: [title, category, typeMatch?.[1] || "", materialMatch?.[1] || ""]
      .join(" ")
      .toLowerCase()
      .split(/[\s,.;:!?/\\|()\[\]{}"']+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3)
      .slice(0, 80),
  };
}

function hasValidOzonTitle(title = "") {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  if (value.length < 8) return false;
  if (INVALID_TITLE_PATTERNS.some((pattern) => pattern.test(value))) return false;
  return /[а-яёa-z0-9]/i.test(value);
}

function normalizeSearchTitle(raw = {}) {
  const candidates = [raw.title, raw.name, raw.productName]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return candidates.find(hasValidOzonTitle) || candidates[0] || "";
}

function normalizeSearchPrice(raw = {}) {
  const direct = toNumber(raw.price || raw.min_price || raw.current_price || raw.oldPrice || raw.old_price || 0);
  if (direct > 0) return direct;
  return parsePriceText([raw.priceText, raw.price_text, raw.text].filter(Boolean).join(" "));
}

function normalizeOzonUrl(url) {
  if (!url) return "";
  const u = String(url).trim();
  if (u.startsWith("http")) return u.split("?")[0].split("#")[0];
  if (u.startsWith("/")) return "https://www.ozon.ru" + u.split("?")[0];
  return u;
}

function normalizeOzonImageUrl(url) {
  if (!url) return "";
  const u = String(url).trim();
  if (u.startsWith("http")) return u.replace(/\/w\d+_/g, "/w1200_").replace(/\/h\d+/g, "/h1200");
  return u;
}

function productKey(item) { return item.url || item.id || ""; }

function sourceUrlForTask(task) {
  if (task.sourceType === "category")
    return "https://www.ozon.ru/category/" + encodeURIComponent(task.sourceValue) + "/";
  return "https://www.ozon.ru/search/?text=" + encodeURIComponent(task.sourceValue);
}

function jobForTask(task, type, url) {
  return {
    id: makeId(),
    taskId: task.id,
    type: type || "ozon_search",
    url: url || sourceUrlForTask(task),
    storeId: String(task.storeId || "").trim(),
    status: "queued",
    workerId: "",
    attempts: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

async function readJsonList(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.items || []);
  } catch { return []; }
}

async function writeJsonList(filePath, list) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify({ items: list }, null, 2);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, payload, "utf8");
  let lastError = null;
  for (let i = 0; i < 4; i += 1) {
    try {
      await fs.rename(tmp, filePath);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
  if (lastError) {
    try { await fs.unlink(tmp); } catch {}
    throw lastError;
  }
}

async function readJobs() { return readJsonList(JOB_FILE); }
async function writeJobs(list) { return writeJsonList(JOB_FILE, list); }

async function updateTask(taskId, updates) {
  const tasks = await readJsonList(TASK_FILE);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: nowIso() };
  await writeJsonList(TASK_FILE, tasks);
}

function summarizeLearningRows(rows = []) {
  const prices = (rows || []).map((item) => Number(item.price || 0)).filter((price) => price > 0);
  const categoryCounts = {};
  for (const item of rows || []) {
    const category = String(item.category || "未分类");
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }
  return {
    totalFound: rows.length,
    opportunityCount: rows.filter((item) => Number(item.opportunityScore || 0) >= 60).length,
    priceMinRub: prices.length ? Math.min(...prices) : 0,
    priceMaxRub: prices.length ? Math.max(...prices) : 0,
    categoryCounts,
    sampleTitles: rows.slice(0, 5).map((item) => item.title || "").filter(Boolean),
  };
}

async function findOrCreateOzonLearningWorkflow(task = {}) {
  const ozonLearningTaskId = String(task.id || "").trim();
  if (!ozonLearningTaskId) return null;
  const runs = await listWorkflowRuns();
  const existing = (runs.items || []).find((run) => run.entity?.ozonLearningTaskId === ozonLearningTaskId);
  if (existing) return existing;
  return createWorkflowRun({
    source: "ozon_learning",
    title: String(task.sourceValue || task.sourceType || task.id || "Ozon 学习任务"),
    status: "running",
    currentNode: "ozon_learning",
    entity: {
      ozonLearningTaskId,
      sourceType: task.sourceType || "",
      sourceValue: task.sourceValue || "",
      mode: task.mode || "",
    },
  });
}

async function emitOzonLearningWorkflowNode(taskOrId, data = {}) {
  try {
    const task = typeof taskOrId === "string"
      ? (await readJsonList(TASK_FILE)).find((item) => item.id === taskOrId)
      : taskOrId;
    if (!task) return null;
    const workflow = await findOrCreateOzonLearningWorkflow(task);
    if (!workflow) return null;
    const node = workflowNodeFromAutoListingStage("sampled", {
      sourceType: task.sourceType || "",
      sourceValue: task.sourceValue || "",
      totalFound: Number(data.totalFound ?? task.totalFound ?? 0),
      detailQueued: Number(data.detailQueued ?? task.detailQueued ?? 0),
      detailedCount: Number(data.detailedCount || 0),
      opportunityCount: Number(data.opportunityCount || 0),
      priceMinRub: Number(data.priceMinRub || 0),
      priceMaxRub: Number(data.priceMaxRub || 0),
      categoryCounts: data.categoryCounts || {},
      sampleTitles: Array.isArray(data.sampleTitles) ? data.sampleTitles : [],
      nodeStatus: data.nodeStatus || "running",
    });
    return upsertWorkflowNode(workflow.id, {
      ...node,
      input: {
        ozonLearningTaskId: task.id,
        sourceType: task.sourceType || "",
        sourceValue: task.sourceValue || "",
        maxProducts: task.maxProducts || 0,
        detailSampleSize: task.detailSampleSize || 0,
      },
      output: {
        ...(node.output || {}),
        taskStatus: task.status || "",
        needsHuman: Boolean(data.needsHuman),
        error: data.error || "",
      },
      runStatus: data.runStatus,
    });
  } catch {
    return null;
  }
}

async function maybeFinishTask(taskId) {
  const tasks = await readJsonList(TASK_FILE);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const jobs = await readJobs();
  const pending = jobs.filter((j) => j.taskId === taskId && j.status !== "done" && j.status !== "failed");
  if (pending.length === 0) {
    await updateTask(taskId, { status: "done" });
    // Auto-trigger pipeline when task completes
    try {
      const { checkAndTriggerPipeline } = await import("./pipeline.js");
      checkAndTriggerPipeline().catch(() => {});
    } catch(e) { /* pipeline not available */ }
  }
}

function normalizeSearchItem(task, raw, index) {
  const title = normalizeSearchTitle(raw);
  const price = normalizeSearchPrice(raw);
  const check = checkProductExcluded(title, price);
  return {
    id: makeId(),
    taskId: task.id,
    url: normalizeOzonUrl(raw.url || raw.link || raw.href || ""),
    title,
    price,
    image: normalizeOzonImageUrl(raw.image || raw.img || raw.picture || ""),
    category: String(raw.category || raw.section || ""),
    sales: toNumber(raw.sales || raw.orders || raw.rating_count || 0),
    rating: toNumber(raw.rating || raw.reviewRate || 0),
    seller: String(raw.seller || raw.shop || ""),
    status: "sampled",
    excluded: check.excluded,
    excludeReason: check.reason || "",
    opportunityScore: check.excluded ? 0 : null,
    opportunityReasons: check.excluded ? ["Исключён: " + check.reason] : [],
    index,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function opportunityReasons(item) {
  if (!item) return [];
  const reasons = [];
  const check = checkProductExcluded(item.title, item.price);
  if (check.excluded) { reasons.push("Исключён: " + check.reason); return reasons; }
  const price = Number(item.price || 0);
  if (price > 0 && price < 200) reasons.push("Низкая цена (<200 RUB)");
  if (price >= 200 && price <= 1500) reasons.push("Оптимальная цена (200-1500 RUB)");
  if (price > 1500 && price <= 5000) reasons.push("Средняя цена (1500-5000 RUB)");
  if (price > 5000) reasons.push("Высокая цена (>5000 RUB)");
  const t = (item.title || "").length;
  if (t > 50) reasons.push("Подробное название (>50 символов)");
  if (t > 100) reasons.push("Очень подробное название (>100 символов)");
  const sales = Number(item.sales || 0);
  if (sales > 100) reasons.push("Высокие продажи (>100)");
  if (sales > 500) reasons.push("Очень высокие продажи (>500)");
  if (!reasons.length) reasons.push("Базовая оценка");
  return reasons;
}

function scoreOpportunity(item) {
  if (!item) return 0;
  const check = checkProductExcluded(item.title, item.price);
  if (check.excluded) return 0;
  let score = 30;
  const price = Number(item.price || 0);
  if (price > 0 && price < 200) score += 10;
  if (price >= 200 && price <= 1500) score += 30;
  if (price > 1500 && price <= 5000) score += 20;
  if (price > 5000) score += 10;
  const t = (item.title || "").length;
  if (t > 30) score += 5;
  if (t > 50) score += 5;
  if (t > 100) score += 5;
  const sales = Number(item.sales || 0);
  if (sales > 50) score += 10;
  if (sales > 200) score += 10;
  if (sales > 500) score += 10;
  const cat = (item.category || "").toLowerCase();
  if (cat.includes("аксессуар") || cat.includes("чехол") || cat.includes("космети") || cat.includes("игрушк")) score += 10;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function refreshDerivedFields(item) {
  const detail = item.detail || {};
  const detailTitle = String(detail.title || "").trim();
  const title = hasValidOzonTitle(detailTitle) ? detailTitle : item.title;
  const price = toNumber(item.price || 0) || toNumber(detail.price || 0) || parsePriceText(detail.description || detail.priceText || "");
  const category = detail.category || item.category || "";
  const check = checkProductExcluded(title, price);
  return {
    ...item,
    title,
    price,
    category,
    excluded: check.excluded,
    excludeReason: check.reason || "",
    opportunityScore: check.excluded ? 0 : scoreOpportunity({ ...item, title, price, category }),
    opportunityReasons: check.excluded ? ["Исключён: " + check.reason] : opportunityReasons({ ...item, title, price, category }),
  };
}

export async function createOzonLearningTask({ sourceType, sourceValue, maxProducts = 20, detailSampleSize = 5, mode = "manual", storeId = "" } = {}) {
  const id = makeId();
  const task = { id, sourceType, sourceValue, storeId: String(storeId || "").trim(),
    maxProducts: Math.min(Number(maxProducts) || 20, 100),
    detailSampleSize: Math.min(Number(detailSampleSize) || 5, 20),
    mode, status: "created", totalFound: 0, detailQueued: 0,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  const tasks = await readJsonList(TASK_FILE);
  tasks.push(task);
  await writeJsonList(TASK_FILE, tasks);
  const jobs = await readJobs();
  jobs.push(jobForTask(task, "ozon_search"));
  await writeJobs(jobs);
  await emitOzonLearningWorkflowNode(task, { nodeStatus: "running" });
  return { ok: true, task, id };
}

export async function createOzonBlindSearchRun({ maxProducts = 20, detailSampleSize = 5, batchSize = 3, storeId = "" } = {}) {
  const pool = [...BLIND_SEEDS];
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, batchSize);
  const tasks = [];
  for (const seed of shuffled) {
    const data = await createOzonLearningTask({
      sourceType: "keyword", sourceValue: seed,
      maxProducts, detailSampleSize, mode: "blind", storeId,
    });
    tasks.push(data.task);
  }
  return { tasks, seeds: shuffled };
}

export async function listOzonLearningTasks() {
  return (await readJsonList(TASK_FILE)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function listOzonLearningItems({ taskId = "", query = "" } = {}) {
  const q = String(query || "").toLowerCase().trim();
  return (await readJsonList(ITEM_FILE))
    .filter((item) => !taskId || item.taskId === taskId)
    .filter((item) => !q || `${item.title} ${item.url} ${item.category}`.toLowerCase().includes(q))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function importExternalOzonLearningItems(rows = [], { sourceFile = "", signature = "" } = {}) {
  const existing = await readJsonList(ITEM_FILE);
  const indexByKey = new Map(existing.map((item, index) => [productKey(item), index]));
  let inserted = 0;
  let updated = 0;
  const timestamp = nowIso();
  for (const raw of rows) {
    const url = normalizeOzonUrl(raw.url || "");
    if (!url || !hasValidOzonTitle(raw.title || "")) continue;
    const detail = {
      url,
      productId: String(raw.productId || ""),
      title: String(raw.title || "").trim(),
      price: toNumber(raw.price || 0),
      image: normalizeOzonImageUrl(raw.image || ""),
      images: (raw.images || []).map(normalizeOzonImageUrl).filter(Boolean),
      category: String(raw.category || ""),
      attributes: raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {},
      description: String(raw.description || ""),
      collectedAt: raw.collectedAt || timestamp,
      frontSignals: { rating: toNumber(raw.rating || 0), reviewCount: toNumber(raw.reviewCount || 0) },
    };
    const base = refreshDerivedFields({
      id: `external-${detail.productId || Buffer.from(url).toString("base64url").slice(0, 16)}`,
      taskId: "external_ozonerp",
      source: "external_ozonerp",
      sourceFile,
      sourceSignature: signature,
      url,
      title: detail.title,
      price: detail.price,
      image: detail.image,
      category: detail.category,
      sales: 0,
      rating: toNumber(raw.rating || 0),
      reviewCount: toNumber(raw.reviewCount || 0),
      seller: String(raw.seller || ""),
      status: "detailed",
      detail,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const existingIndex = indexByKey.get(url);
    if (existingIndex === undefined) {
      indexByKey.set(url, existing.length);
      existing.push(base);
      inserted += 1;
      continue;
    }
    const current = existing[existingIndex];
    if (current.source !== "external_ozonerp" && current.status === "detailed") continue;
    existing[existingIndex] = refreshDerivedFields({ ...current, ...base, id: current.id, createdAt: current.createdAt || timestamp });
    updated += 1;
  }
  if (inserted || updated) await writeJsonList(ITEM_FILE, existing);
  return { ok: true, inserted, updated, skipped: rows.length - inserted - updated, total: existing.length };
}

export async function listOzonOpportunities({ query = "", minScore = 60 } = {}) {
  const q = String(query || "").toLowerCase().trim();
  const min = Math.max(0, Math.min(100, toNumber(minScore, 60)));
  const items = await readJsonList(ITEM_FILE);
  let changed = false;
  for (let i = 0; i < items.length; i += 1) {
    const refreshed = refreshDerivedFields(items[i]);
    if (
      refreshed.title !== items[i].title ||
      refreshed.price !== items[i].price ||
      refreshed.category !== items[i].category ||
      refreshed.excluded !== items[i].excluded ||
      refreshed.excludeReason !== items[i].excludeReason ||
      refreshed.opportunityScore !== items[i].opportunityScore ||
      JSON.stringify(refreshed.opportunityReasons || []) !== JSON.stringify(items[i].opportunityReasons || [])
    ) {
      items[i] = { ...refreshed, updatedAt: nowIso() };
      changed = true;
    }
  }
  if (changed) await writeJsonList(ITEM_FILE, items);
  return items
    .filter((item) => toNumber(item.opportunityScore) >= min)
    .filter((item) => {
      if (!q) return true;
      const st = `${item.title} ${item.url} ${item.category} ${(item.opportunityReasons || []).join(" ")}`.toLowerCase();
      return st.includes(q);
    })
    .sort((a, b) => toNumber(b.opportunityScore) - toNumber(a.opportunityScore) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function deleteOzonLearningTask(id) {
  const tasks = await readJsonList(TASK_FILE);
  const task = tasks.find((item) => item.id === id);
  if (!task) return null;
  await writeJsonList(TASK_FILE, tasks.filter((item) => item.id !== id));
  await writeJsonList(ITEM_FILE, (await readJsonList(ITEM_FILE)).filter((item) => item.taskId !== id));
  await writeJobs((await readJobs()).filter((job) => job.taskId !== id));
  return task;
}

function learningJobScopeDecision(job = {}, scope = {}) {
  const requested = String(scope.storeId || "").trim();
  const principalStores = Array.isArray(scope.storeIds)
    ? scope.storeIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const jobStore = String(job.storeId || "").trim();
  if (!requested && !principalStores.length) return { allowed: true, reasonCode: "WORKER_SCOPE_UNSCOPED" };
  if (!jobStore) return { allowed: false, reasonCode: "WORKER_JOB_STORE_SCOPE_MISSING" };
  if (requested && requested !== jobStore) return { allowed: false, reasonCode: "WORKER_JOB_STORE_ACCESS_DENIED" };
  if (principalStores.length && !principalStores.includes(jobStore)) return { allowed: false, reasonCode: "WORKER_PRINCIPAL_STORE_ACCESS_DENIED" };
  return { allowed: true, reasonCode: "WORKER_STORE_SCOPE_OK" };
}

async function learningJobScope(jobId, scope = {}) {
  const jobs = await readJobs();
  const job = jobs.find((item) => item.id === jobId);
  if (!job) return { job: null };
  const decision = learningJobScopeDecision(job, scope);
  return decision.allowed ? { job } : { job, scopeDenied: true, reasonCode: decision.reasonCode };
}

export async function claimOzonLearningJob(workerId = "", scope = {}) {
  const jobs = await readJobs();
  const tasks = await readJsonList(TASK_FILE);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const now = Date.now();
  let picked = null;
  for (const job of jobs) {
    if (job.status === "running" && learningJobScopeDecision(job, scope).allowed
      && now - Date.parse(job.updatedAt || job.createdAt || 0) > RUNNING_JOB_TIMEOUT_MS) {
      job.status = "queued"; job.workerId = "";
    }
    if (!picked && job.status === "queued") {
      if (!learningJobScopeDecision(job, scope).allowed) continue;
      const task = taskById.get(job.taskId);
      if (!task || ["stopped", "paused", "waiting_human", "failed", "finished"].includes(task.status)) continue;
      job.status = "running"; job.workerId = workerId;
      job.attempts = toNumber(job.attempts) + 1;
      job.updatedAt = nowIso(); picked = job;
    }
  }
  await writeJobs(jobs);
  if (picked) await updateTask(picked.taskId, { status: "running" });
  return picked;
}

export async function completeOzonSearchJob(jobId, result = {}, scope = {}) {
  const scoped = await learningJobScope(jobId, scope);
  if (!scoped.job) return null;
  if (scoped.scopeDenied) return { job: scoped.job, scopeDenied: true, reasonCode: scoped.reasonCode };
  const jobs = await readJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return null;
  const job = jobs[index];
  if (result.needsHuman) {
    const message = result.error || "Ozon 页面需要人工验证或登录";
    jobs[index] = { ...job, status: "failed", lastError: message, updatedAt: nowIso() };
    await writeJobs(jobs);
    await updateTask(job.taskId, { status: "waiting_human", lastError: message });
    await emitOzonLearningWorkflowNode(job.taskId, {
      nodeStatus: "failed",
      runStatus: "waiting_human",
      needsHuman: true,
      error: message,
    });
    return { job: jobs[index] };
  }
  if (result.error) {
    jobs[index] = { ...job, status: "failed", lastError: result.error, updatedAt: nowIso() };
    await writeJobs(jobs);
    await updateTask(job.taskId, { lastError: result.error });
    await emitOzonLearningWorkflowNode(job.taskId, {
      nodeStatus: "failed",
      error: result.error,
    });
    await maybeFinishTask(job.taskId);
    return { job: jobs[index] };
  }
  const tasks = await readJsonList(TASK_FILE);
  const task = tasks.find((item) => item.id === job.taskId);
  if (!task) return null;
  const rows = (result.items || []).slice(0, task.maxProducts).map((item, i) => normalizeSearchItem(task, item, i));
  const existing = await readJsonList(ITEM_FILE);
  const keys = new Set(existing.map(productKey));
  const nextItems = [...existing];
  for (const row of rows) {
    const key = productKey(row);
    if (!key || keys.has(key)) continue;
    keys.add(key);
    nextItems.push(row);
  }
  const detailUrls = rows.filter((row) => !row.excluded).map((row) => row.url).filter(Boolean).slice(0, task.detailSampleSize);
  for (const url of detailUrls) jobs.push(jobForTask(task, "ozon_detail", url));
  jobs[index] = { ...job, status: "done", itemCount: rows.length, updatedAt: nowIso() };
  await writeJsonList(ITEM_FILE, nextItems);
  await writeJobs(jobs);
  await updateTask(job.taskId, { totalFound: rows.length, detailQueued: detailUrls.length });
  await emitOzonLearningWorkflowNode(task, {
    ...summarizeLearningRows(rows),
    detailQueued: detailUrls.length,
    nodeStatus: "success",
  });
  await maybeFinishTask(job.taskId);
  return { job: jobs[index], items: rows };
}

export async function completeOzonDetailJob(jobId, result = {}, scope = {}) {
  const scoped = await learningJobScope(jobId, scope);
  if (!scoped.job) return null;
  if (scoped.scopeDenied) return { job: scoped.job, scopeDenied: true, reasonCode: scoped.reasonCode };
  const jobs = await readJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return null;
  const job = jobs[index];
  if (result.needsHuman) {
    const message = result.error || "Ozon 页面需要人工验证或登录";
    jobs[index] = { ...job, status: "failed", lastError: message, updatedAt: nowIso() };
    await writeJobs(jobs);
    await updateTask(job.taskId, { status: "waiting_human", lastError: message });
    await emitOzonLearningWorkflowNode(job.taskId, {
      nodeStatus: "failed",
      runStatus: "waiting_human",
      needsHuman: true,
      error: message,
    });
    return { job: jobs[index] };
  }
  if (result.error) {
    jobs[index] = { ...job, status: "failed", lastError: result.error, updatedAt: nowIso() };
    await writeJobs(jobs);
    await maybeFinishTask(job.taskId);
    return { job: jobs[index] };
  }
  const detail = result.payload || result.detail || {};
  detail.frontSignals = extractFrontSignals(detail);
  const url = normalizeOzonUrl(detail.url || job.url);
  const detailTitle = String(detail.title || "").trim();
  const detailPrice = toNumber(detail.price || 0) || parsePriceText(detail.description || detail.priceText || "");
  const items = await readJsonList(ITEM_FILE);
  const itemIndex = items.findIndex((item) => item.url === url || item.url === job.url);
  if (itemIndex !== -1) {
    const title = hasValidOzonTitle(detailTitle) ? detailTitle : items[itemIndex].title;
    const price = detailPrice || items[itemIndex].price || 0;
    const category = detail.category || items[itemIndex].category;
    const check = checkProductExcluded(title, price);
    items[itemIndex] = { ...items[itemIndex],
      title,
      price,
      image: detail.image || items[itemIndex].image,
      category,
      rating: toNumber(detail.frontSignals?.rating || items[itemIndex].rating || 0),
      reviewCount: toNumber(detail.frontSignals?.reviewCount || items[itemIndex].reviewCount || 0),
      detail, status: "detailed",
      excluded: check.excluded,
      excludeReason: check.reason || "",
      opportunityScore: check.excluded ? 0 : scoreOpportunity({ ...items[itemIndex], title, price, category }),
      opportunityReasons: check.excluded ? ["Исключён: " + check.reason] : opportunityReasons({ ...items[itemIndex], title, price, category }),
      updatedAt: nowIso(),
    };
    await writeJsonList(ITEM_FILE, items);
    const sameTaskItems = items.filter((item) => item.taskId === job.taskId);
    await emitOzonLearningWorkflowNode(job.taskId, {
      ...summarizeLearningRows(sameTaskItems),
      detailedCount: sameTaskItems.filter((item) => item.status === "detailed").length,
      nodeStatus: "success",
    });
  }
  jobs[index] = { ...job, status: "done", updatedAt: nowIso() };
  await writeJobs(jobs);
  await maybeFinishTask(job.taskId);
  return { job: jobs[index] };
}

async function translateRussianToChinese(text) {
  const config = llmConfig();
  if (!config.enabled) {
    return { ok: false, reason: "未配置 AI 翻译（需设置 MODELSCOPE_API_KEY / BIGMODEL_API_KEY / DEEPSEEK_API_KEY）", keyword: "" };
  }
  const response = await fetch(config.baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKeyForProvider(config.provider), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model || "deepseek-chat",
      messages: [
        { role: "system", content: "You are a Russian-to-Chinese translator. Return ONLY a JSON object with \"keyword\" field containing the Chinese translation. No other text." },
        { role: "user", content: "Translate this Russian product keyword to Chinese (one short phrase, 2-8 Chinese characters): " + text },
      ],
      temperature: 0.1,
    }),
  });
  if (!response.ok) return { ok: false, reason: "AI 翻译请求失败: HTTP " + response.status, keyword: "" };
  const json = await response.json();
  const raw = json?.choices?.[0]?.message?.content || "";
  const extracted = extractJsonObject(raw);
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted);
      if (parsed.keyword) return { ok: true, keyword: String(parsed.keyword).trim() };
    } catch {}
  }
  return { ok: false, reason: "AI 返回格式异常", keyword: "" };
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) return value.slice(start, end + 1);
  return value;
}

function apiKeyForProvider(provider) {
  if (provider === "bigmodel") return process.env.BIGMODEL_API_KEY;
  if (provider === "deepseek") return process.env.DEEPSEEK_API_KEY;
  return process.env.MODELSCOPE_API_KEY;
}

export async function reverseSearch1688(itemId) {
  if (!itemId) throw new Error("缺少 Ozon 商品 ID。");
  const items = await readJsonList(ITEM_FILE);
  const item = items.find((i) => i.id === itemId);
  if (!item) throw new Error("没有找到 Ozon 商品 " + itemId + "。");
  const sourceText = item.title || item.keyword || item.category || "";
  if (!sourceText) throw new Error("商品 " + itemId + " 缺少标题或关键词。");
  const result = await translateRussianToChinese(sourceText);
  if (!result.ok) return { ok: false, reason: result.reason, item, keyword: "" };
  const task = await createCrawlerTask({
    sourceType: "keyword",
    sourceValue: result.keyword,
    options: { maxProducts: 20, maxPages: 2 },
  });
  return { ok: true, keyword: result.keyword, task: task?.task || task, item };
}

// ====== Ozon 数据分析 -> 1688 选品规则 ======
const RMB_TO_RUB_ANALYSIS = 12;

export async function analyzeOzonOpportunities(options = {}) {
  const items = await listOzonLearningItems();
  const opportunities = items.filter(function(i) { return Number(i.opportunityScore || 0) >= (options.minScore || 30); });
  if (!opportunities.length) {
    return { ok: true, hasData: false, reason: "没有足够的Ozon学习数据来分析" };
  }
  const byCategory = {};
  for (const item of opportunities) {
    const cat = item.category || "其他";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }
  const rules = [];
  for (const cat of Object.keys(byCategory)) {
    const items = byCategory[cat];
    const prices = items.map(function(i) { return Number(i.price || 0); }).filter(function(p) { return p > 0; });
    const avgPrice = prices.length ? Math.round(prices.reduce(function(a,b) { return a+b; }, 0) / prices.length) : 0;
    const avgPriceCny = Math.round(avgPrice / RMB_TO_RUB_ANALYSIS);
    const titleWords = {};
    for (const item of items) {
      const words = String(item.title || "").toLowerCase().split(/\s+/).filter(function(w) { return w.length > 3; });
      for (const w of words) titleWords[w] = (titleWords[w] || 0) + 1;
    }
    const topKeywords = Object.keys(titleWords).sort(function(a,b) { return titleWords[b] - titleWords[a]; }).slice(0, 10);
    rules.push({ category: cat, itemCount: items.length, avgPriceRub: avgPrice, avgPriceCny,
      suggestedPriceMaxCny: Math.max(Math.round(avgPriceCny * 0.15), 5),
      suggestedPriceMinCny: Math.max(Math.round(avgPriceCny * 0.03), 1),
      topKeywords, sampleTitles: items.slice(0, 3).map(function(i) { return i.title; }),
    });
  }
  const searchSeeds = rules.slice(0, 5).reduce(function(acc, r) {
    return acc.concat(r.topKeywords.slice(0, 3));
  }, []).filter(Boolean);
  return {
    ok: true, hasData: true,
    totalOpportunities: opportunities.length,
    totalCategories: rules.length, rules,
    strategy: { searchSeeds: searchSeeds.slice(0, 20),
      priceRanges: rules.map(function(r) { return { category: r.category, min: r.suggestedPriceMinCny, max: r.suggestedPriceMaxCny }; }),
    },
  };
}
