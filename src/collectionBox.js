import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const BOX_FILE = path.join(DATA_DIR, "1688-collection-box.json");

async function readBox() {
  try {
    const text = await fs.readFile(BOX_FILE, "utf8");
    const data = JSON.parse(text);
    return Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeBox(items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(BOX_FILE, JSON.stringify({ items }, null, 2), "utf8");
}

function offerKeyFromUrl(url = "") {
  const value = String(url || "");
  const patterns = [
    { prefix: "pdd-goods", pattern: /[?&]goods_id=(\d+)/i },
    { prefix: "pdd-goods", pattern: /[?&]goodsId=(\d+)/i },
    { prefix: "pdd-goods", pattern: /\/goods(?:\.html)?\/?(\d{5,})/i },
    { prefix: "pdd-goods", pattern: /\/goods_detail\/(\d{5,})/i },
    /\/offer\/(\d+)\.html/i,
    /[?&]offerId=(\d+)/i,
    /[?&]offer_id=(\d+)/i,
  ];
  for (const pattern of patterns) {
    if (pattern instanceof RegExp) {
      const match = value.match(pattern);
      if (match) return match[1];
      continue;
    }
    const match = value.match(pattern.pattern);
    if (match) return `${pattern.prefix}:${match[1]}`;
  }
  return value.trim().toLowerCase().replace(/[?#].*$/, "");
}

function collectionKey(item = {}) {
  return offerKeyFromUrl(item.parsed?.url || item.url || "");
}

export async function listCollectionItems() {
  const items = await readBox();
  return items.sort((a, b) => String(b.updatedAt || b.receivedAt).localeCompare(String(a.updatedAt || a.receivedAt)));
}

export async function addCollectionItem({ parsed, storeId = "", includeVideo = true }) {
  const now = new Date().toISOString();
  const items = await readBox();
  const key = offerKeyFromUrl(parsed?.url || "");
  const duplicate = key ? items.find((item) => collectionKey(item) === key) : null;
  if (duplicate) {
    const sourceLabel = parsed?.source === "pdd" ? "拼多多" : "1688";
    return {
      ...duplicate,
      duplicate: true,
      duplicateMessage: `这个 ${sourceLabel} 商品已经采集过，已返回原记录。`,
    };
  }
  const item = {
    id: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    storeId,
    includeVideo: Boolean(includeVideo),
    status: "collected",
    receivedAt: now,
    updatedAt: now,
    parsed,
  };
  items.push(item);
  await writeBox(items);
  return item;
}

export async function getCollectionItem(id) {
  const items = await readBox();
  return items.find((item) => item.id === id) || null;
}

export async function updateCollectionItem(id, patch) {
  const items = await readBox();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  items[index] = {
    ...items[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeBox(items);
  return items[index];
}

export async function deleteCollectionItem(id) {
  const items = await readBox();
  const next = items.filter((item) => item.id !== id);
  await writeBox(next);
  return next.length !== items.length;
}
