import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const MIGRATION_FILE = path.join(DATA_DIR, "migration-state.json");

const TABLES = {
  auto_listing_jobs: "auto_listing_jobs",
  pipeline_runs: "pipeline_runs",
  stock_queue_jobs: "stock_queue_jobs",
};

let supabaseClient = null;
let supabaseEnabled = false;

async function getSupabase() {
  if (supabaseClient || supabaseEnabled) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    supabaseClient = createClient(url, key, { auth: { persistSession: false } });
    supabaseEnabled = true;
    return supabaseClient;
  } catch {
    supabaseEnabled = false;
    return null;
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    try {
      return JSON.parse(raw);
    } catch {
      const text = String(raw || "").trim();
      const cutObj = text.lastIndexOf("}");
      const cutArr = text.lastIndexOf("]");
      const cut = Math.max(cutObj, cutArr);
      if (cut > 0) {
        return JSON.parse(text.slice(0, cut + 1));
      }
      throw new Error("Invalid JSON");
    }
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    return fallback;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function readMigrationState() {
  return readJsonFile(MIGRATION_FILE, { done: {} });
}

async function markMigrated(key) {
  const state = await readMigrationState();
  state.done[key] = new Date().toISOString();
  await writeJsonFile(MIGRATION_FILE, state);
}

async function isMigrated(key) {
  const state = await readMigrationState();
  return Boolean(state.done[key]);
}

async function migrateOnce({ collectionKey, table, filePath, parseFile }) {
  const already = await isMigrated(collectionKey);
  if (already) return;
  const sb = await getSupabase();
  if (!sb) return;
  const items = await parseFile(filePath);
  if (!items.length) {
    await markMigrated(collectionKey);
    return;
  }
  const now = new Date().toISOString();
  const rows = items.map((item) => ({
    id: String(item.id),
    payload: item,
    created_at: item.createdAt || now,
    updated_at: item.updatedAt || now,
    migrated_at: now,
  }));
  await sb.from(table).upsert(rows, { onConflict: "id" });
  await markMigrated(collectionKey);
}

async function listRows(table) {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from(table).select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function replaceRows(table, items) {
  const sb = await getSupabase();
  if (!sb) return false;
  const now = new Date().toISOString();
  const clean = (items || []).map((item) => ({
    id: String(item.id),
    payload: item,
    created_at: item.createdAt || now,
    updated_at: item.updatedAt || now,
    migrated_at: item.migrated_at || null,
  }));
  const ids = clean.map((x) => x.id);
  const { error: upsertError } = await sb.from(table).upsert(clean, { onConflict: "id" });
  if (upsertError) throw upsertError;
  if (ids.length) {
    const { error: delError } = await sb.from(table).delete().not("id", "in", `(${ids.map((id) => `"${id}"`).join(",")})`);
    if (delError) throw delError;
  }
  return true;
}

async function parseAutoListingFile(filePath) {
  const data = await readJsonFile(filePath, { items: [] });
  return Array.isArray(data.items) ? data.items : [];
}
async function parseStockQueueFile(filePath) {
  const data = await readJsonFile(filePath, { jobs: [] });
  return Array.isArray(data.jobs) ? data.jobs : [];
}
async function parsePipelineFile(filePath) {
  const data = await readJsonFile(filePath, null);
  return data ? [data] : [];
}

export const JobRepository = {
  async readAutoListingJobs(filePath) {
    await migrateOnce({
      collectionKey: "auto_listing_jobs",
      table: TABLES.auto_listing_jobs,
      filePath,
      parseFile: parseAutoListingFile,
    });
    const rows = await listRows(TABLES.auto_listing_jobs);
    if (rows) return rows.map((r) => r.payload);
    return parseAutoListingFile(filePath);
  },
  async writeAutoListingJobs(filePath, items) {
    const ok = await replaceRows(TABLES.auto_listing_jobs, items);
    if (!ok) await writeJsonFile(filePath, { items });
  },
  async readStockQueueJobs(filePath) {
    await migrateOnce({
      collectionKey: "stock_queue_jobs",
      table: TABLES.stock_queue_jobs,
      filePath,
      parseFile: parseStockQueueFile,
    });
    const rows = await listRows(TABLES.stock_queue_jobs);
    if (rows) return rows.map((r) => r.payload);
    return parseStockQueueFile(filePath);
  },
  async writeStockQueueJobs(filePath, jobs) {
    const ok = await replaceRows(TABLES.stock_queue_jobs, jobs);
    if (!ok) await writeJsonFile(filePath, { jobs });
  },
  async readPipelineState(filePath) {
    await migrateOnce({
      collectionKey: "pipeline_runs",
      table: TABLES.pipeline_runs,
      filePath,
      parseFile: parsePipelineFile,
    });
    const rows = await listRows(TABLES.pipeline_runs);
    if (rows && rows.length) return rows[0].payload;
    const list = await parsePipelineFile(filePath);
    return list[0] || null;
  },
  async writePipelineState(filePath, state) {
    const ok = await replaceRows(TABLES.pipeline_runs, [Object.assign({ id: state.id || "latest" }, state)]);
    if (!ok) await writeJsonFile(filePath, state);
  },
};
