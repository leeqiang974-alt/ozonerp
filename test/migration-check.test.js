import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCoreMigrationDryRun, inspectCoreMigration } from "../src/migrationCheck.js";

const migration = new URL("../supabase/migrations/20260715_001_core_job_storage.sql", import.meta.url);

test("core migration passes static safety checks", async () => {
  const result = await inspectCoreMigration(fileURLToPath(migration));
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingTables, []);
  assert.deepEqual(result.rlsMissing, []);
  assert.deepEqual(result.unsafePatterns, []);
  assert.equal(result.rollbackRequiredBeforeApply, true);
});

test("migration check rejects destructive or credential-bearing SQL", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-migration-check-"));
  const file = path.join(dir, "unsafe.sql");
  await fs.writeFile(file, "create table if not exists public.auto_listing_jobs (id text); drop table x; postgres://bad");
  const result = await inspectCoreMigration(file);
  assert.equal(result.ok, false);
  assert.equal(result.missingTables.includes("stock_queue_jobs"), true);
  assert.equal(result.unsafePatterns.some((pattern) => pattern.includes("drop")), true);
  await fs.rm(dir, { recursive: true, force: true });
});

test("migration check fails closed when the migration marker or schema version is unknown", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-migration-version-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "unknown.sql");
  const source = await fs.readFile(fileURLToPath(migration), "utf8");
  await fs.writeFile(file, source.replace("schema=1", "schema=99"), "utf8");
  const result = await inspectCoreMigration(file);
  assert.equal(result.ok, false);
  assert.equal(result.versionKnown, false);
  assert.equal(result.reasonCode, "MIGRATION_VERSION_UNKNOWN");
});

test("core migration dry-run validates every local source before any database write", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-migration-dry-run-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sources = {
    auto_listing_jobs: path.join(dir, "auto.json"),
    stock_queue_jobs: path.join(dir, "stock.json"),
    pipeline_runs: path.join(dir, "pipeline.json"),
  };
  await fs.writeFile(sources.auto_listing_jobs, JSON.stringify({ items: [{ id: "a-1", status: "queued" }] }));
  await fs.writeFile(sources.stock_queue_jobs, JSON.stringify({ jobs: [{ id: "s-1", status: "queued" }] }));
  await fs.writeFile(sources.pipeline_runs, JSON.stringify({ id: "p-1", status: "idle" }));
  const result = await buildCoreMigrationDryRun({ migrationFile: fileURLToPath(migration), sources });
  assert.equal(result.ok, true);
  assert.equal(result.execution, "dry_run");
  assert.equal(result.databaseObserved, false);
  assert.equal(result.writeStarted, false);
  assert.equal(result.tables.reduce((sum, table) => sum + table.rowCount, 0), 3);
  assert.equal(result.plan.deletePolicy, "none");
  assert.equal(result.crossTableAtomicity, "not_guaranteed_by_supabase_client");
});

test("core migration dry-run blocks malformed, duplicate, and credential-shaped snapshots", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-migration-dry-run-invalid-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sources = {
    auto_listing_jobs: path.join(dir, "auto.json"),
    stock_queue_jobs: path.join(dir, "stock.json"),
    pipeline_runs: path.join(dir, "pipeline.json"),
  };
  await fs.writeFile(sources.auto_listing_jobs, JSON.stringify({ items: [
    { id: "duplicate", apiKey: "do-not-persist" }, { id: "duplicate" },
  ] }));
  await fs.writeFile(sources.stock_queue_jobs, "{broken");
  await fs.writeFile(sources.pipeline_runs, JSON.stringify({ status: "no stable id" }));
  const result = await buildCoreMigrationDryRun({ migrationFile: fileURLToPath(migration), sources });
  assert.equal(result.ok, false);
  assert.equal(result.databaseObserved, false);
  assert.equal(result.writeStarted, false);
  assert.equal(result.blockers.some((item) => item.code === "SOURCE_ID_DUPLICATE"), true);
  assert.equal(result.blockers.some((item) => item.code === "SOURCE_SENSITIVE_FIELDS"), true);
  assert.equal(result.blockers.some((item) => item.code === "SOURCE_INVALID_JSON"), true);
  assert.equal(result.blockers.some((item) => item.code === "SOURCE_ID_REQUIRED"), true);
});

test("core migration dry-run fails closed on orphaned cross-table references", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-migration-cross-table-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sources = {
    auto_listing_jobs: path.join(dir, "auto.json"),
    stock_queue_jobs: path.join(dir, "stock.json"),
    pipeline_runs: path.join(dir, "pipeline.json"),
  };
  await fs.writeFile(sources.auto_listing_jobs, JSON.stringify({ items: [{ id: "a-1", listingResult: { taskId: 700 } }] }));
  await fs.writeFile(sources.stock_queue_jobs, JSON.stringify({ jobs: [{ id: "s-1", taskId: 701 }] }));
  await fs.writeFile(sources.pipeline_runs, JSON.stringify({ id: "p-1", entity: { autoListingJobId: "missing-job" } }));
  const result = await buildCoreMigrationDryRun({ migrationFile: fileURLToPath(migration), sources });
  assert.equal(result.ok, false);
  const blockers = result.blockers.filter((item) => item.code === "CROSS_TABLE_REFERENCE_MISSING");
  assert.equal(blockers.length, 2);
  assert.deepEqual(blockers.map((item) => item.sourceTable).sort(), ["pipeline_runs", "stock_queue_jobs"]);
  assert.match(JSON.stringify(blockers), /referenceHash/);
  assert.doesNotMatch(JSON.stringify(blockers), /701|missing-job/);
});
