import fs from "node:fs/promises";
import path from "node:path";
import { importExternalOzonLearningItems } from "./ozonLearning.js";
import { triggerRuleAnalysis } from "./listingRules.js";

const DEFAULT_SOURCE_FILE = process.env.EXTERNAL_OZON_COMPETITOR_FILE || "E:\\ozonerp\\ozon_competitors.json";
const DEFAULT_STATE_FILE = path.resolve(process.env.OZON_LEARNING_DATA_DIR || "data", "external-ozon-learning-state.json");
const DEFAULT_INTERVAL_MS = Math.max(15_000, Number(process.env.EXTERNAL_OZON_SYNC_INTERVAL_MS || 60_000));
const PROMO_TITLE_PATTERNS = [
  /^цена что надо$/i,
  /^распродажа$/i,
  /балл(?:ов|а)? за отзыв/i,
  /вау[-\s]?цен/i,
];
const ATTRIBUTE_NOISE_PATTERNS = [
  /политик[аи] обработки данных/i,
  /оплата/i,
  /доставка/i,
  /служба поддержки/i,
];

let monitorTimer = null;
let lastRuntimeStatus = null;

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value || "").replace(/[^0-9.,]/g, "").replace(/\s+/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUrl(value = "") {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (!/(^|\.)ozon\.ru$/i.test(url.hostname)) return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function productIdFromUrl(url = "") {
  const match = String(url).match(/-(\d{6,})(?:\/|$)/);
  return match?.[1] || "";
}

function isUsefulTitle(value = "") {
  const title = compactText(value);
  if (title.length < 12) return false;
  if (PROMO_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return false;
  return /[а-яёa-z0-9]/i.test(title);
}

function normalizeImage(value = "") {
  const image = String(value || "").trim();
  if (!/^https?:\/\//i.test(image)) return "";
  try {
    const url = new URL(image);
    if (!/(^|\.)ozone\.ru$/i.test(url.hostname)) return "";
    return image;
  } catch {
    return "";
  }
}

function cleanAttributes(attributes) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return {};
  const cleaned = {};
  for (const [rawKey, rawValue] of Object.entries(attributes)) {
    const key = compactText(rawKey);
    const value = compactText(rawValue);
    if (!key || !value || key.length > 100 || value.length > 500) continue;
    if (ATTRIBUTE_NOISE_PATTERNS.some((pattern) => pattern.test(key))) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function cleanDescription(value = "") {
  return compactText(value)
    .replace(/Ozon Product Collector[^。.!?]*[。.!?]?/gi, "")
    .replace(/(?:插件)?采集完成[。.!?]?/gi, "")
    .trim()
    .slice(0, 12_000);
}

export function normalizeExternalOzonProduct(raw = {}) {
  const detail = raw.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const url = normalizeUrl(detail.url || raw.url || raw.link || "");
  const title = compactText(detail.title || raw.title || "");
  if (!url || !productIdFromUrl(url) || !isUsefulTitle(title)) return null;
  const images = [...new Set([...(Array.isArray(detail.images) ? detail.images : []), detail.image, raw.image]
    .map(normalizeImage)
    .filter(Boolean))];
  const attributes = cleanAttributes(detail.attributes);
  const price = parsePrice(detail.price || raw.price || raw.current_price || 0);
  const category = compactText(detail.category || raw.category_detail || raw.category || "");
  if (!price && !images.length && !category && !Object.keys(attributes).length) return null;
  return {
    url,
    productId: productIdFromUrl(url),
    title,
    price,
    image: images[0] || "",
    images,
    category,
    attributes,
    description: cleanDescription(detail.description || ""),
    rating: Number(detail.frontSignals?.rating || raw.rating || 0) || 0,
    reviewCount: Number(detail.frontSignals?.reviewCount || raw.reviewCount || raw.reviews || 0) || 0,
    seller: compactText(detail.seller || raw.seller || ""),
    collectedAt: detail.collectedAt || raw.collectedAt || raw.updatedAt || "",
  };
}

async function readState(stateFile) {
  try { return JSON.parse(await fs.readFile(stateFile, "utf8")); } catch { return {}; }
}

async function writeState(stateFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}

export async function syncExternalOzonLearning({
  sourceFile = DEFAULT_SOURCE_FILE,
  stateFile = DEFAULT_STATE_FILE,
  force = false,
  importItems = importExternalOzonLearningItems,
  analyzeRules = triggerRuleAnalysis,
} = {}) {
  const stat = await fs.stat(sourceFile);
  const signature = `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
  const previous = await readState(stateFile);
  if (!force && previous.signature === signature) {
    const unchanged = { ok: true, unchanged: true, sourceFile, signature, lastResult: previous.lastResult || null };
    lastRuntimeStatus = unchanged;
    return unchanged;
  }
  const parsed = JSON.parse(await fs.readFile(sourceFile, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
  const accepted = rows.map(normalizeExternalOzonProduct).filter(Boolean);
  const importResult = await importItems(accepted, { sourceFile, signature });
  if (Number(importResult.inserted || 0) + Number(importResult.updated || 0) > 0) await analyzeRules();
  const result = {
    ok: true,
    unchanged: false,
    sourceFile,
    signature,
    scanned: rows.length,
    accepted: accepted.length,
    rejected: rows.length - accepted.length,
    ...importResult,
    syncedAt: new Date().toISOString(),
  };
  await writeState(stateFile, { sourceFile, signature, lastSyncAt: result.syncedAt, lastResult: result });
  lastRuntimeStatus = result;
  return result;
}

export async function getExternalOzonLearningStatus({ sourceFile = DEFAULT_SOURCE_FILE, stateFile = DEFAULT_STATE_FILE } = {}) {
  const state = await readState(stateFile);
  try {
    const stat = await fs.stat(sourceFile);
    return { ok: true, enabled: true, sourceFile, exists: true, size: stat.size, modifiedAt: stat.mtime.toISOString(), runtime: lastRuntimeStatus, ...state };
  } catch (error) {
    return { ok: false, enabled: true, sourceFile, exists: false, error: error.message, runtime: lastRuntimeStatus, ...state };
  }
}

export function startExternalOzonLearningMonitor({ intervalMs = DEFAULT_INTERVAL_MS, ...options } = {}) {
  if (monitorTimer) return monitorTimer;
  const run = () => syncExternalOzonLearning(options).catch((error) => {
    lastRuntimeStatus = { ok: false, sourceFile: options.sourceFile || DEFAULT_SOURCE_FILE, error: error.message, failedAt: new Date().toISOString() };
  });
  run();
  monitorTimer = setInterval(run, intervalMs);
  monitorTimer.unref?.();
  return monitorTimer;
}
