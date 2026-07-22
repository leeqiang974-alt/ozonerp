import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCoreMigrationRecoveryDrill } from "../src/migrationRecoveryRunner.js";

// Repeatable local-only evidence. The fixture is intentionally created under
// the OS temp directory and removed in finally; no project data, database,
// network transport, or Ozon endpoint is touched.
const migrationFile = path.resolve("supabase/migrations/20260715_001_core_job_storage.sql");
const fixture = {
  auto_listing_jobs: { items: [{ id: "rehearsal-job-1", listingResult: { taskId: "rehearsal-task-1" } }] },
  stock_queue_jobs: { jobs: [{ id: "rehearsal-stock-1", taskId: "rehearsal-task-1" }] },
  pipeline_runs: { id: "rehearsal-pipeline-1", entity: { autoListingJobId: "rehearsal-job-1" } },
};

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-erp-recovery-rehearsal-"));
try {
  const sources = {};
  for (const [table, value] of Object.entries(fixture)) {
    const file = path.join(tempDir, `${table}.json`);
    const raw = JSON.stringify(value);
    await fs.writeFile(file, raw, "utf8");
    await fs.writeFile(`${file}.bak`, raw, "utf8");
    sources[table] = file;
  }

  const success = await runCoreMigrationRecoveryDrill({ migrationFile, sources });
  const failure = await runCoreMigrationRecoveryDrill({ migrationFile, sources, failAt: "stock_queue_jobs" });
  const successEvidence = success.ok === true
    && success.deploymentReady === false
    && success.databaseObserved === false
    && success.networkAccessed === false
    && success.writesExecuted === false
    && success.backupEvidence.every((item) => item.ok === true);
  const failureEvidence = failure.ok === false
    && failure.failure?.table === "stock_queue_jobs"
    && failure.recoveryActions.some((item) => item.action === "restore_table_backup" && item.table === "auto_listing_jobs");
  const output = {
    ok: successEvidence && failureEvidence,
    execution: "local_recovery_rehearsal",
    verificationLevel: "locally_tested",
    temporaryFixture: true,
    success: {
      ok: success.ok,
      appliedTables: success.appliedTables.map((item) => item.table),
      backupEvidence: success.backupEvidence.map((item) => ({ table: item.table, ok: item.ok, sameContent: item.sameContent })),
    },
    injectedFailure: {
      ok: failure.ok,
      failure: failure.failure,
      recoveryActions: failure.recoveryActions.map((item) => ({ action: item.action, table: item.table, status: item.status })),
    },
    databaseObserved: false,
    networkAccessed: false,
    writesExecuted: false,
    deploymentReady: false,
    nextAction: "由部署方在隔离数据库/备份分支执行真实迁移与恢复回放；本地演练不能升级生产证据。",
  };
  console.log(JSON.stringify(output));
  if (!output.ok) process.exitCode = 1;
} finally {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
