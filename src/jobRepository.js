import fs from "node:fs/promises";
import path from "node:path";
import { isValidSupabaseConfiguration } from "./durableStorageCapability.js";

const DATA_DIR = path.resolve("data");
const MIGRATION_FILE = path.join(DATA_DIR, "migration-state.json");
const MIGRATION_LOCK_FILE = `${MIGRATION_FILE}.lock`;
const MIGRATION_SCHEMA_VERSION = 1;

const TABLES = {
  auto_listing_jobs: "auto_listing_jobs",
  pipeline_runs: "pipeline_runs",
  stock_queue_jobs: "stock_queue_jobs",
};

const SENSITIVE_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)/i;

function sanitizePersistedValue(value) {
  if (Array.isArray(value)) return value.map(sanitizePersistedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, sanitizePersistedValue(item)]));
}

function durableTimestamp(value, { field, collection, index }) {
  const raw = String(value ?? "").trim();
  const parsed = Date.parse(raw);
  if (!raw || !Number.isFinite(parsed)) {
    const error = new Error(`${collection} item ${index} has an invalid ${field} timestamp`);
    error.code = "JOB_TIMESTAMP_INVALID";
    throw error;
  }
  return new Date(parsed).toISOString();
}

function normalizeDurableItems(items, { now = new Date().toISOString(), collection = "jobs" } = {}) {
  const seen = new Set();
  return (items || []).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const error = new Error(`${collection} item ${index} must be an object with a stable id`);
      error.code = "JOB_ID_REQUIRED";
      throw error;
    }
    const id = String(item.id ?? "").trim();
    if (!id) {
      const error = new Error(`${collection} item ${index} is missing a stable id`);
      error.code = "JOB_ID_REQUIRED";
      throw error;
    }
    if (seen.has(id)) {
      const error = new Error(`${collection} contains duplicate id: ${id}`);
      error.code = "JOB_ID_DUPLICATE";
      throw error;
    }
    seen.add(id);
    const createdAt = durableTimestamp(item.createdAt ?? item.created_at ?? now, { field: "created_at", collection, index });
    const updatedAt = durableTimestamp(item.updatedAt ?? item.updated_at ?? now, { field: "updated_at", collection, index });
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      const error = new Error(`${collection} item ${index} updated_at precedes created_at`);
      error.code = "JOB_TIMESTAMP_ORDER_INVALID";
      throw error;
    }
    return {
      id,
      payload: sanitizePersistedValue(item),
      created_at: createdAt,
      updated_at: updatedAt,
      migrated_at: item.migrated_at || null,
    };
  });
}

// Exported for an offline contract test; production callers use it through
// migrateOnce/replaceRows before the first durable upsert.
export { normalizeDurableItems };

let supabaseClient = null;
let supabaseEnabled = false;

async function getSupabase() {
  if (supabaseClient || supabaseEnabled) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isValidSupabaseConfiguration(process.env)) return null;
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

async function readJsonFile(filePath, fallback, { strict = false } = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    try {
      return JSON.parse(raw);
    } catch (parseError) {
      if (strict) {
        const invalid = new Error("durable JSON snapshot is invalid");
        invalid.code = "PERSISTED_JSON_INVALID";
        invalid.cause = parseError;
        throw invalid;
      }
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
    // Strict migration/recovery reads must distinguish an absent snapshot from
    // an intentionally empty collection. Treating ENOENT as `fallback` would
    // let migration mark a missing source as complete and permanently skip
    // data that appears after a transient mount/deploy failure.
    if (error.code === "ENOENT" && !strict) return fallback;
    if (strict) throw error;
    return fallback;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const backup = `${filePath}.bak`;
  try {
    await fs.writeFile(temporary, JSON.stringify(data, null, 2), { encoding: "utf8", flag: "wx" });
    try {
      await fs.copyFile(filePath, backup);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function withFileLock(lockPath, work, { timeoutMs = 30000, staleMs = 120000 } = {}) {
  const started = Date.now();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    } catch (error) {
      if (error?.code !== "EEXIST" || Date.now() - started >= timeoutMs) {
        const lockError = new Error("durable storage lock unavailable");
        lockError.code = error?.code === "EEXIST" ? "DURABLE_STORAGE_LOCK_TIMEOUT" : error?.code;
        throw lockError;
      }
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) await fs.rm(lockPath, { force: true });
      } catch { /* another process may release it between stat and remove */ }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await work();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

export async function restoreJsonFile(filePath) {
  const target = path.resolve(filePath);
  const backup = `${target}.bak`;
  // Recovery must join the same lock used by writers. Without this boundary,
  // a writer can replace `.bak` between the validation read and the copy,
  // making a restart restore an unverified snapshot.
  return withFileLock(`${target}.lock`, async () => {
    const raw = await fs.readFile(backup, "utf8");
    JSON.parse(raw);
    const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.restore.tmp`;
    try {
      await fs.copyFile(backup, temporary);
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return { restored: true, file: target, backup };
  });
}

async function readMigrationState() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(MIGRATION_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: MIGRATION_SCHEMA_VERSION, done: {} };
    const invalid = new Error("migration state is unreadable");
    invalid.code = "MIGRATION_STATE_INVALID";
    throw invalid;
  }
  if (!raw || raw.schemaVersion !== MIGRATION_SCHEMA_VERSION || !raw.done || typeof raw.done !== "object" || Array.isArray(raw.done)) {
    const invalid = new Error("migration state schema is unknown");
    invalid.code = "MIGRATION_STATE_SCHEMA_UNKNOWN";
    throw invalid;
  }
  return raw;
}

async function markMigratedUnlocked(key) {
  const state = await readMigrationState();
  state.schemaVersion = MIGRATION_SCHEMA_VERSION;
  state.done[key] = new Date().toISOString();
  await writeJsonFile(MIGRATION_FILE, state);
}

async function isMigrated(key) {
  const state = await readMigrationState();
  return Boolean(state.done[key]);
}

async function migrateOnce({ collectionKey, table, filePath, parseFile }) {
  const sb = await getSupabase();
  if (!sb) return;
  await withFileLock(MIGRATION_LOCK_FILE, async () => {
    const already = await isMigrated(collectionKey);
    if (already) return;
    // Migration is a durable boundary: never use the compatibility parser that
    // can recover a truncated JSON prefix or substitute an empty fallback.
    // A malformed snapshot must stop before the first upsert and before the
    // migration marker is written, otherwise a production instance can mark a
    // partially/incorrectly read source as migrated.
    const items = await parseFile(filePath, { strict: true });
    if (!items.length) {
      await markMigratedUnlocked(collectionKey);
      return;
    }
    const now = new Date().toISOString();
    // Validate before the first upsert. Without this gate malformed or duplicate
    // ids collapse into one Supabase row and silently lose durable job evidence.
    const rows = normalizeDurableItems(items, { now, collection: table }).map((row) => ({
      ...row,
      migrated_at: now,
    }));
    const { error } = await sb.from(table).upsert(rows, { onConflict: "id" });
    if (error) throw error;
    await markMigratedUnlocked(collectionKey);
  });
}

async function listRows(table) {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from(table).select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function replaceRows(table, items) {
  const now = new Date().toISOString();
  const clean = normalizeDurableItems(items, { now, collection: table });
  const sb = await getSupabase();
  if (!sb) return false;
  const ids = clean.map((x) => x.id);
  const { error: upsertError } = await sb.from(table).upsert(clean, { onConflict: "id" });
  if (upsertError) throw upsertError;
  if (ids.length) {
    const escapedIds = ids.map((id) => `"${String(id).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
    const { error: delError } = await sb.from(table).delete().not("id", "in", `(${escapedIds.join(",")})`);
    if (delError) throw delError;
  }
  return true;
}

export async function parseAutoListingFile(filePath, options = {}) {
  const data = await readJsonFile(filePath, { items: [] }, options);
  if (options.strict === true && (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.items))) {
    const invalid = new Error("auto-listing durable snapshot schema is invalid");
    invalid.code = "PERSISTED_JSON_SCHEMA_INVALID";
    throw invalid;
  }
  return Array.isArray(data.items) ? data.items : [];
}
export async function parseStockQueueFile(filePath, options = {}) {
  const data = await readJsonFile(filePath, { jobs: [] }, options);
  if (options.strict === true && (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.jobs))) {
    const invalid = new Error("stock-queue durable snapshot schema is invalid");
    invalid.code = "PERSISTED_JSON_SCHEMA_INVALID";
    throw invalid;
  }
  return Array.isArray(data.jobs) ? data.jobs : [];
}
export async function parsePipelineFile(filePath, options = {}) {
  const data = await readJsonFile(filePath, null, options);
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
    const safeItems = sanitizePersistedValue(items || []);
    const ok = await replaceRows(TABLES.auto_listing_jobs, safeItems);
    if (!ok) await writeJsonFile(filePath, { items: safeItems });
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
    const safeJobs = sanitizePersistedValue(jobs || []);
    const ok = await replaceRows(TABLES.stock_queue_jobs, safeJobs);
    if (!ok) await writeJsonFile(filePath, { jobs: safeJobs });
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
    const safeState = sanitizePersistedValue(state || {});
    const ok = await replaceRows(TABLES.pipeline_runs, [Object.assign({ id: safeState.id || "latest" }, safeState)]);
    if (!ok) await writeJsonFile(filePath, safeState);
  },
};
