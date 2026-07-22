import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCoreMigrationRecoveryDrill } from "../src/migrationRecoveryRunner.js";

const migrationFile = fileURLToPath(new URL("../supabase/migrations/20260715_001_core_job_storage.sql", import.meta.url));

async function makeMigrationSources() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-migration-recovery-runner-"));
  const values = {
    auto_listing_jobs: { items: [] },
    stock_queue_jobs: { jobs: [] },
    pipeline_runs: null,
  };
  const sources = {};
  for (const [table, value] of Object.entries(values)) {
    const file = path.join(dir, `${table}.json`);
    const raw = JSON.stringify(value);
    await fs.writeFile(file, raw, "utf8");
    await fs.writeFile(`${file}.bak`, raw, "utf8");
    sources[table] = file;
  }
  return { dir, sources };
}

for (const [failAt, expectedApplied] of [["auto_listing_jobs", []], ["stock_queue_jobs", ["auto_listing_jobs"]], ["pipeline_runs", ["auto_listing_jobs", "stock_queue_jobs"]]]) {
  test(`recovery drill fails closed and plans reverse recovery at ${failAt}`, async (t) => {
    const { dir, sources } = await makeMigrationSources();
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const result = await runCoreMigrationRecoveryDrill({ migrationFile, sources, failAt });
    assert.equal(result.ok, false);
    assert.equal(result.databaseObserved, false);
    assert.equal(result.networkAccessed, false);
    assert.equal(result.writesExecuted, false);
    assert.equal(result.rollbackRequired, true);
    assert.equal(result.backupEvidence.find((item) => item.table === failAt).ok, true);
    assert.deepEqual(result.appliedTables.map((item) => item.table), expectedApplied);
    assert.deepEqual(result.recoveryActions.filter((item) => item.action === "restore_table_backup").map((item) => item.table), [...expectedApplied].reverse());
    assert.equal(result.failure.table, failAt);
  });
}

test("successful recovery rehearsal remains a local simulation", async () => {
  const { dir, sources } = await makeMigrationSources();
  const result = await runCoreMigrationRecoveryDrill({ migrationFile, sources });
  await fs.rm(dir, { recursive: true, force: true });
  assert.equal(result.ok, true);
  assert.equal(result.verificationLevel, "locally_tested");
  assert.equal(result.deploymentReady, false);
  assert.deepEqual(result.preflight.migration, { id: "20260715_001_core_job_storage", schemaVersion: 1, versionKnown: true });
  assert.deepEqual(result.backupValidation.migration, { id: "20260715_001_core_job_storage", schemaVersion: 1, versionKnown: true });
  assert.equal(result.rollbackRequired, false);
  assert.equal(result.backupEvidence.length, 3);
  assert.deepEqual(result.appliedTables.map((item) => item.table), ["auto_listing_jobs", "stock_queue_jobs", "pipeline_runs"]);
  assert.equal(result.recoveryActions.some((item) => item.action === "record_deployment_receipt"), true);
  // A green rehearsal is still local evidence only; it must not be surfaced as
  // database observation or cross-table atomicity in deployment status.
  assert.equal(result.databaseObserved, false);
  assert.equal(result.networkAccessed, false);
  assert.equal(result.writesExecuted, false);
  assert.equal(result.crossTableAtomicity, "not_guaranteed_by_supabase_client");
  assert.match(result.note, /本地模拟/);
});

test("injected apply and restore failures are exposed as recovery blockers", async (t) => {
  const { dir, sources } = await makeMigrationSources();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const result = await runCoreMigrationRecoveryDrill({
    migrationFile,
    sources,
    applyTable: async (table) => table === "pipeline_runs" ? { ok: false, code: "SIMULATED_APPLY_TIMEOUT" } : { ok: true },
    restoreTable: async (table) => table === "stock_queue_jobs" ? { ok: false, code: "BACKUP_RESTORE_UNAVAILABLE" } : { ok: true },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "SIMULATED_APPLY_TIMEOUT");
  const blocked = result.recoveryActions.find((item) => item.table === "stock_queue_jobs");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.code, "BACKUP_RESTORE_UNAVAILABLE");
});

test("recovery drill blocks before simulated apply when backups are missing", async () => {
  const result = await runCoreMigrationRecoveryDrill({ migrationFile });
  assert.equal(result.ok, false);
  assert.equal(result.failure.stage, "backup_evidence");
  assert.equal(result.failure.code, "RECOVERY_BACKUP_REQUIRED");
  assert.deepEqual(result.appliedTables, []);
  assert.equal(result.recoveryActions[0].action, "prepare_isolated_backup");
  assert.equal(result.databaseObserved, false);
  assert.equal(result.writesExecuted, false);
});

test("recovery drill blocks parseable backups that fail the source schema contract", async (t) => {
  const { dir, sources } = await makeMigrationSources();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(`${sources.stock_queue_jobs}.bak`, JSON.stringify({ jobs: [{}] }), "utf8");
  const result = await runCoreMigrationRecoveryDrill({ migrationFile, sources });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "RECOVERY_BACKUP_INVALID");
  assert.equal(result.failure.stage, "backup_evidence");
  assert.equal(result.appliedTables.length, 0);
  assert.equal(result.backupValidation.ok, false);
  assert.match(JSON.stringify(result.backupValidation.blockers), /SOURCE_ID_REQUIRED/);
});
