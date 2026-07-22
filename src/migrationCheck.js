import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const CORE_MIGRATION_TABLES = ["auto_listing_jobs", "stock_queue_jobs", "pipeline_runs"];
export const CORE_MIGRATION_ID = "20260715_001_core_job_storage";
export const CORE_SCHEMA_VERSION = 1;

const SENSITIVE_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)/i;
const DEFAULT_CORE_SOURCES = {
  auto_listing_jobs: path.resolve("data/auto-listing-jobs.json"),
  stock_queue_jobs: path.resolve("data/stock-queue.json"),
  pipeline_runs: path.resolve("data/pipeline-status.json"),
};

function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function findSensitiveKeys(value, prefix = "") {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSensitiveKeys(item, `${prefix}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const field = prefix ? `${prefix}.${key}` : key;
    return SENSITIVE_KEY.test(key) ? [field] : findSensitiveKeys(item, field);
  });
}

function sourceRows(value, kind) {
  if (kind === "pipeline_runs") return value == null ? [] : [value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = kind === "auto_listing_jobs" ? "items" : "jobs";
  return Array.isArray(value[key]) ? value[key] : null;
}

function referenceHash(value) {
  return `sha256:${digest(String(value || "").trim())}`;
}

function extractListingTaskIds(rows = []) {
  return new Set((Array.isArray(rows) ? rows : [])
    .flatMap((row) => [
      row?.listingResult?.taskId,
      row?.listingResult?.task_id,
      row?.listingResult?.importInfo?.task_id,
      row?.listingResult?.importInfo?.result?.task_id,
    ])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean));
}

function extractCrossTableBlockers(rowSets = new Map()) {
  const blockers = [];
  const listingRows = rowSets.get("auto_listing_jobs") || [];
  const stockRows = rowSets.get("stock_queue_jobs") || [];
  const pipelineRows = rowSets.get("pipeline_runs") || [];
  const listingIds = new Set(listingRows.map((row) => String(row?.id ?? "").trim()).filter(Boolean));
  const listingTaskIds = extractListingTaskIds(listingRows);
  stockRows.forEach((row, index) => {
    const taskId = String(row?.taskId ?? row?.task_id ?? "").trim();
    if (taskId && !listingTaskIds.has(taskId)) {
      blockers.push({
        code: "CROSS_TABLE_REFERENCE_MISSING",
        sourceTable: "stock_queue_jobs",
        targetTable: "auto_listing_jobs",
        field: "taskId",
        index,
        referenceHash: referenceHash(taskId),
      });
    }
  });
  pipelineRows.forEach((row, index) => {
    const jobId = String(row?.entity?.autoListingJobId ?? row?.autoListingJobId ?? "").trim();
    if (jobId && !listingIds.has(jobId)) {
      blockers.push({
        code: "CROSS_TABLE_REFERENCE_MISSING",
        sourceTable: "pipeline_runs",
        targetTable: "auto_listing_jobs",
        field: "entity.autoListingJobId",
        index,
        referenceHash: referenceHash(jobId),
      });
    }
  });
  return blockers;
}

/**
 * Validate all local JSON sources before any Supabase write is attempted.
 * This is deliberately a no-network dry-run: databaseObserved is always false.
 * Missing files are an empty source (normal for a fresh deployment); malformed
 * files, duplicate ids and credential-shaped fields are surfaced explicitly.
 */
export async function buildCoreMigrationDryRun({
  migrationFile = path.resolve("supabase/migrations/20260715_001_core_job_storage.sql"),
  sources = DEFAULT_CORE_SOURCES,
} = {}) {
  const migration = await inspectCoreMigration(migrationFile);
  const tables = [];
  const blockers = [];
  const rowSets = new Map();
  for (const table of CORE_MIGRATION_TABLES) {
    const file = path.resolve(sources?.[table] ?? DEFAULT_CORE_SOURCES[table]);
    let raw;
    let value;
    let sourceState = "present";
    try {
      raw = await fs.readFile(file, "utf8");
      try {
        value = JSON.parse(raw);
      } catch {
        blockers.push({ table, code: "SOURCE_INVALID_JSON" });
        sourceState = "invalid";
      }
    } catch (error) {
      if (error?.code === "ENOENT") sourceState = "missing";
      else {
        sourceState = "unreadable";
        blockers.push({ table, code: "SOURCE_UNREADABLE" });
      }
    }
    if (sourceState === "missing") {
      rowSets.set(table, []);
      tables.push({ table, file, sourceState, rowCount: 0, digest: null, ids: [], sensitiveFields: [] });
      continue;
    }
    if (sourceState !== "present") {
      rowSets.set(table, []);
      tables.push({ table, file, sourceState, rowCount: 0, digest: raw ? digest(raw) : null, ids: [], sensitiveFields: [] });
      continue;
    }
    const rows = sourceRows(value, table);
    if (!rows) {
      rowSets.set(table, []);
      blockers.push({ table, code: "SOURCE_SCHEMA_INVALID" });
      tables.push({ table, file, sourceState: "invalid", rowCount: 0, digest: digest(raw), ids: [], sensitiveFields: findSensitiveKeys(value) });
      continue;
    }
    rowSets.set(table, rows);
    const ids = [];
    const duplicateIds = [];
    const missingIdIndexes = [];
    const seen = new Set();
    rows.forEach((row, index) => {
      const id = String(row?.id ?? "").trim();
      if (!id) missingIdIndexes.push(index);
      else if (seen.has(id)) duplicateIds.push(id);
      else { seen.add(id); ids.push(id); }
    });
    if (missingIdIndexes.length) blockers.push({ table, code: "SOURCE_ID_REQUIRED", indexes: missingIdIndexes });
    if (duplicateIds.length) blockers.push({ table, code: "SOURCE_ID_DUPLICATE", ids: [...new Set(duplicateIds)] });
    const sensitiveFields = findSensitiveKeys(value);
    if (sensitiveFields.length) blockers.push({ table, code: "SOURCE_SENSITIVE_FIELDS", fields: sensitiveFields.slice(0, 20) });
    tables.push({
      table, file, sourceState, rowCount: rows.length, uniqueIdCount: ids.length,
      digest: digest(raw), ids: ids.slice(0, 100), sensitiveFields,
      duplicateIds: [...new Set(duplicateIds)], missingIdIndexes,
    });
  }
  blockers.push(...extractCrossTableBlockers(rowSets));
  const allBlockers = [
    ...(!migration.ok ? [{ code: migration.reasonCode || "MIGRATION_SQL_INVALID" }] : []),
    ...blockers,
  ];
  return {
    ok: allBlockers.length === 0,
    execution: "dry_run",
    databaseObserved: false,
    writeStarted: false,
    rollbackRequiredBeforeApply: true,
    crossTableAtomicity: "not_guaranteed_by_supabase_client",
    migration,
    tables,
    blockers: allBlockers,
    plan: {
      operation: "upsert",
      deletePolicy: "none",
      validationBeforeFirstWrite: true,
      applyRequiresBackup: true,
      applyRequiresMigrationRunner: true,
    },
    note: "Dry-run 只检查本地快照和 SQL，不连接数据库、不执行写入，也不证明迁移可恢复。",
  };
}

export async function inspectCoreMigration(filePath) {
  const file = path.resolve(filePath);
  let sql;
  try {
    sql = await fs.readFile(file, "utf8");
  } catch (error) {
    return { ok: false, file, reasonCode: error?.code === "ENOENT" ? "MIGRATION_MISSING" : "MIGRATION_UNREADABLE" };
  }
  const normalized = sql.toLowerCase();
  const marker = sql.match(/ozon-erp-migration:\s*([\w-]+)\s+schema=(\d+)/i);
  const migrationId = marker?.[1] || "";
  const schemaVersion = marker ? Number(marker[2]) : null;
  const versionKnown = migrationId === CORE_MIGRATION_ID && schemaVersion === CORE_SCHEMA_VERSION;
  const missingTables = CORE_MIGRATION_TABLES.filter((table) => !normalized.includes(`create table if not exists public.${table}`));
  const unsafePatterns = [
    /\bdrop\s+table\b/i,
    /\btruncate\b/i,
    /\bdelete\s+from\b/i,
    /supabase_service_role_key/i,
    /postgres:\/\//i,
  ];
  const unsafe = unsafePatterns.filter((pattern) => pattern.test(sql)).map((pattern) => pattern.source);
  const rlsMissing = CORE_MIGRATION_TABLES.filter((table) => !new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql));
  return {
    ok: versionKnown && missingTables.length === 0 && unsafe.length === 0 && rlsMissing.length === 0,
    file,
    migrationId,
    schemaVersion,
    versionKnown,
    ...(versionKnown ? {} : { reasonCode: "MIGRATION_VERSION_UNKNOWN" }),
    missingTables,
    rlsMissing,
    unsafePatterns: unsafe,
    rollbackRequiredBeforeApply: true,
    note: "静态迁移检查不证明目标数据库已执行、连接健康或备份可恢复。",
  };
}
