import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
let writeChain = Promise.resolve();

function journalFile() {
  return process.env.LISTING_EDIT_JOURNAL_FILE || path.join(DATA_DIR, "listing-edit-journal.json");
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `lej_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function readStore() {
  try {
    const raw = await fs.readFile(journalFile(), "utf8");
    const parsed = JSON.parse(raw || "{}");
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { items: [] };
    throw error;
  }
}

async function writeStoreUnlocked(store) {
  await fs.mkdir(path.dirname(journalFile()), { recursive: true });
  await fs.writeFile(journalFile(), JSON.stringify({ items: store.items || [] }, null, 2), "utf8");
}

async function writeStore(store) {
  writeChain = writeChain.then(() => writeStoreUnlocked(store), () => writeStoreUnlocked(store));
  return writeChain;
}

function stableValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function diffListingFields(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  return keys
    .filter((key) => stableValue(before?.[key]) !== stableValue(after?.[key]))
    .map((key) => ({
      field: key,
      before: before?.[key] ?? "",
      after: after?.[key] ?? "",
    }));
}

function normalizeChange(change = {}) {
  return {
    field: String(change.field || "").trim(),
    before: change.before ?? "",
    after: change.after ?? "",
    label: String(change.label || "").trim(),
  };
}

export async function appendListingEditEvent(input = {}) {
  const changes = Array.isArray(input.changes) ? input.changes.map(normalizeChange).filter((item) => item.field) : [];
  const event = {
    id: input.id || makeId(),
    createdAt: input.createdAt || nowIso(),
    candidateId: String(input.candidateId || "").trim(),
    offerId: String(input.offerId || "").trim(),
    productId: String(input.productId || "").trim(),
    workflowRunId: String(input.workflowRunId || "").trim(),
    stage: String(input.stage || "manual_edit").trim(),
    source: String(input.source || "manual").trim(),
    changes,
    note: String(input.note || "").trim(),
    context: input.context || {},
  };
  const store = await readStore();
  store.items.unshift(event);
  await writeStore(store);
  return event;
}

export async function listListingEditEvents(filter = {}) {
  const store = await readStore();
  let items = store.items || [];
  for (const key of ["candidateId", "offerId", "productId", "workflowRunId", "stage", "source"]) {
    const value = String(filter[key] || "").trim();
    if (value) items = items.filter((item) => String(item[key] || "") === value);
  }
  const limit = Math.max(1, Math.min(500, Number(filter.limit || 100)));
  return {
    items: items.slice(0, limit),
    total: items.length,
    summary: summarizeItems(items),
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = String(item[key] || "unknown");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function topChangedFields(items) {
  const counts = {};
  const firstSeen = {};
  let order = 0;
  for (const item of [...items].reverse()) {
    for (const change of item.changes || []) {
      const field = String(change.field || "");
      if (!field) continue;
      if (!Object.prototype.hasOwnProperty.call(firstSeen, field)) firstSeen[field] = order++;
      counts[field] = (counts[field] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count || firstSeen[a.field] - firstSeen[b.field])
    .slice(0, 12);
}

function summarizeItems(items = []) {
  return {
    total: items.length,
    bySource: countBy(items, "source"),
    byStage: countBy(items, "stage"),
    topFields: topChangedFields(items),
  };
}

export async function summarizeListingEditJournal() {
  const store = await readStore();
  return summarizeItems(store.items || []);
}
