import path from "node:path";
import { buildCoreMigrationDryRun, CORE_MIGRATION_TABLES } from "./migrationCheck.js";
import { runJsonRecoveryDrill } from "./recoveryDrill.js";

/**
 * Local-only rehearsal for the staged core-storage migration.
 *
 * This runner deliberately does not open a database connection and never
 * mutates a source snapshot. It models the order in which a deployment
 * runner would apply the three tables and the compensating actions required
 * when a later table fails. The result must not be treated as proof of a
 * cross-table transaction or a recoverable production backup.
 */
export async function runCoreMigrationRecoveryDrill({
  migrationFile = path.resolve("supabase/migrations/20260715_001_core_job_storage.sql"),
  sources,
  failAt = null,
  applyTable,
  restoreTable,
} = {}) {
  const preflight = await buildCoreMigrationDryRun({ migrationFile, sources });
  const base = {
    execution: "recovery_drill",
    // This command is deliberately a local rehearsal.  Keep the machine
    // readable status separate from `ok`: a rehearsal can be internally
    // consistent while still being insufficient evidence for production.
    verificationLevel: "locally_tested",
    deploymentReady: false,
    databaseObserved: false,
    networkAccessed: false,
    writesExecuted: false,
    crossTableAtomicity: "not_guaranteed_by_supabase_client",
    rollbackRequired: true,
    appliedTables: [],
    recoveryActions: [],
    failure: null,
    preflight: {
      ok: preflight.ok,
      blockers: preflight.blockers,
      migration: {
        id: preflight.migration?.migrationId || null,
        schemaVersion: preflight.migration?.schemaVersion ?? null,
        versionKnown: preflight.migration?.versionKnown === true,
      },
      tables: preflight.tables.map(({ table, file, sourceState, rowCount, digest }) => ({ table, file, sourceState, rowCount, digest })),
    },
  };
  base.backupEvidence = await Promise.all(base.preflight.tables.map(async ({ table, file }) => ({
    table,
    ...(await runJsonRecoveryDrill(file)),
  })));
  if (!preflight.ok) {
    return {
      ...base,
      ok: false,
      failure: { stage: "preflight", code: "MIGRATION_PREFLIGHT_BLOCKED" },
      recoveryActions: [{ action: "fix_preflight_blockers", status: "required", sideEffect: "none" }],
      note: "本地预检未通过，未模拟任何表应用；不连接数据库、不写入、不证明生产可恢复。",
    };
  }

  // A successful dry-run only proves that the local snapshots and SQL are
  // structurally safe.  It does not provide the rollback evidence required by
  // this rehearsal.  Previously the runner continued to simulate table
  // application and returned `ok: true` even when every `.bak` file was
  // missing, which made an operator-facing drill look recoverable without a
  // usable backup.  Fail closed before simulating any table until each source
  // has a parseable isolated backup.
  const missingBackupTables = base.backupEvidence
    .filter((item) => item.ok !== true)
    .map((item) => item.table);
  if (missingBackupTables.length) {
    return {
      ...base,
      ok: false,
      failure: {
        stage: "backup_evidence",
        code: "RECOVERY_BACKUP_REQUIRED",
        tables: missingBackupTables,
      },
      recoveryActions: [{
        action: "prepare_isolated_backup",
        status: "required",
        tables: missingBackupTables,
        sideEffect: "none",
      }],
      note: "本地预检通过但缺少可解析备份；未模拟表应用，不能把迁移演练报告为可恢复。",
    };
  }

  // A parseable `.bak` is not enough recovery evidence.  Validate the backup
  // snapshots with the same table shape/id/credential checks as the live
  // source preflight; otherwise a JSON object with the wrong schema could
  // still let this drill report a successful simulation.
  const backupSources = Object.fromEntries(base.preflight.tables.map(({ table, file }) => [table, `${file}.bak`]));
  const backupPreflight = await buildCoreMigrationDryRun({ migrationFile, sources: backupSources });
  const backupBlockers = backupPreflight.blockers.map((item) => ({
    table: item.table || "migration",
    code: item.code || "BACKUP_PREFLIGHT_BLOCKED",
  }));
  base.backupValidation = {
    ok: backupPreflight.ok,
    blockers: backupBlockers,
    migration: {
      id: backupPreflight.migration?.migrationId || null,
      schemaVersion: backupPreflight.migration?.schemaVersion ?? null,
      versionKnown: backupPreflight.migration?.versionKnown === true,
    },
  };
  if (!backupPreflight.ok) {
    return {
      ...base,
      ok: false,
      failure: { stage: "backup_evidence", code: "RECOVERY_BACKUP_INVALID", blockers: backupBlockers },
      recoveryActions: [{ action: "repair_isolated_backup", status: "required", sideEffect: "none" }],
      note: "备份文件可解析但未通过同等结构校验；未模拟表应用，不能把迁移演练报告为可恢复。",
    };
  }

  const failTable = resolveFailureTable(failAt);
  const apply = typeof applyTable === "function" ? applyTable : async () => ({ ok: true, mode: "simulated" });
  const restore = typeof restoreTable === "function" ? restoreTable : async () => ({ ok: true, mode: "simulated" });
  for (const [index, table] of CORE_MIGRATION_TABLES.entries()) {
    if (failTable === table || failTable === index + 1) {
      base.failure = { stage: "apply", table, index: index + 1, code: "SIMULATED_TABLE_APPLY_FAILURE" };
      break;
    }
    let outcome;
    try {
      outcome = await apply(table, { index: index + 1, dryRun: true });
    } catch (error) {
      outcome = { ok: false, code: error?.code || "SIMULATED_TABLE_APPLY_FAILURE" };
    }
    if (!outcome || outcome.ok === false) {
      base.failure = { stage: "apply", table, index: index + 1, code: outcome?.code || "SIMULATED_TABLE_APPLY_FAILURE" };
      break;
    }
    base.appliedTables.push({ table, index: index + 1, mode: outcome.mode || "simulated" });
  }

  if (base.failure) {
    for (const applied of [...base.appliedTables].reverse()) {
      let outcome;
      try {
        outcome = await restore(applied.table, { index: applied.index, dryRun: true });
      } catch (error) {
        outcome = { ok: false, code: error?.code || "SIMULATED_RESTORE_FAILURE" };
      }
      base.recoveryActions.push({
        action: "restore_table_backup",
        table: applied.table,
        status: outcome?.ok === false ? "blocked" : "simulated",
        code: outcome?.ok === false ? (outcome.code || "SIMULATED_RESTORE_FAILURE") : undefined,
        sideEffect: "none",
      });
    }
    base.recoveryActions.push({ action: "verify_target_tables_and_replay_from_backup", status: "required", sideEffect: "none" });
    return { ...base, ok: false, note: "演练模拟逐表失败并生成逆序恢复动作；没有真实表应用或跨表回滚。" };
  }

  base.rollbackRequired = false;
  base.recoveryActions = [
    { action: "verify_each_target_table", status: "required", sideEffect: "none" },
    { action: "record_deployment_receipt", status: "required", sideEffect: "none" },
  ];
  return { ...base, ok: true, note: "所有三表仅完成本地模拟；必须经过真实部署 runner 和备份回放后才能宣称迁移完成。" };
}

function resolveFailureTable(failAt) {
  if (failAt == null || failAt === "") return null;
  if (typeof failAt === "number" && Number.isInteger(failAt)) return failAt;
  const text = String(failAt).trim();
  if (/^[1-3]$/.test(text)) return Number(text);
  return CORE_MIGRATION_TABLES.includes(text) ? text : "__unknown_failure_target__";
}
