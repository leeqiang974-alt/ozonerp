import path from "node:path";
import { buildCoreMigrationDryRun } from "../src/migrationCheck.js";
import { buildMigrationStateAudit } from "../src/migrationStateAudit.js";
import { runCoreMigrationRecoveryDrill } from "../src/migrationRecoveryRunner.js";
import { productionDeploymentDecision } from "../src/runtimeSafety.js";
import { buildProductionMigrationContract } from "../src/migrationProductionContract.js";
import { buildDiskSpaceCheck } from "../src/diskSpaceCheck.js";
import { buildApiEvidenceSummary } from "../src/apiEvidence.js";
import { DEFAULT_API_FILE } from "../src/config.js";

// Unified local deployment gate. This command deliberately never creates a
// database client, starts the server, or mutates migration/source files.
const migrationFile = process.argv[2] || path.resolve("supabase/migrations/20260715_001_core_job_storage.sql");
const checks = [];
const add = (name, result, blockers = []) => checks.push({
  name,
  // Migration checks expose `ok`, while runtime safety decisions expose
  // `allowed`.  Normalize both contracts here; otherwise a completely
  // configured production runtime is reported as a failed preflight solely
  // because its decision object uses the more explicit `allowed` field.
  ok: (result.ok === true || result.allowed === true) && result.deploymentReady !== false,
  blockers: [
    ...(blockers.length ? blockers : (result.blockers || [])),
    ...(result.deploymentReady === false ? [{ code: "LOCAL_SIMULATION_NOT_DEPLOYMENT_EVIDENCE" }] : []),
  ],
  nextAction: String(result.nextAction || result.note || "").slice(0, 500),
});

const dryRun = await buildCoreMigrationDryRun({ migrationFile });
add("migration_dry_run", dryRun);
const state = await buildMigrationStateAudit({});
add("migration_state", state);
const recovery = await runCoreMigrationRecoveryDrill({ migrationFile });
add("migration_recovery_drill", recovery, recovery.failure ? [recovery.failure] : []);
const migrationContract = buildProductionMigrationContract({ env: process.env });
add("production_migration_contract", migrationContract);
// A deployment declaration is not allowed to silently point at an arbitrary
// credential/doc pair.  Keep the seller-owned four-store source and the local
// Seller API HTML fingerprint as an explicit preflight check; this only reads
// hashes and counts and never exposes credentials or calls Ozon.
const apiEvidence = buildApiEvidenceSummary({
  apiSourcePath: process.env.OZON_API_FILE || DEFAULT_API_FILE,
  sellerApiDocPath: process.env.OZON_SELLER_API_DOC_FILE || "D:\\Desktop\\ozonseller api\\Ozon Seller API 文件.html",
  canonicalStoreCount: 4,
});
add("api_evidence", {
  ok: apiEvidence.storeScope.canonicalStoreCountVerified === true
    && apiEvidence.matrixConsistency.ok === true,
  blockers: [
    ...(apiEvidence.storeScope.canonicalStoreCountVerified ? [] : [{ code: "CANONICAL_STORE_EVIDENCE_INVALID" }]),
    ...(apiEvidence.matrixConsistency.ok ? [] : apiEvidence.matrixConsistency.reasons.map((code) => ({ code }))),
  ],
  nextAction: apiEvidence.storeScope.canonicalStoreCountVerified && apiEvidence.matrixConsistency.ok
    ? "canonical 四店铺配置和 Seller API HTML 指纹匹配。"
    : "修复 canonical 四店铺来源或 Seller API HTML 指纹后再进行部署预检。",
});
// Atomic JSON/database migration steps need temporary files and backup
// headroom.  This is a read-only local check: it never removes caches or
// changes the source tree, and low space must be fixed before recovery.
const disk = buildDiskSpaceCheck({
  path: process.cwd(),
  minimumFreeBytes: process.env.OZON_ERP_MIN_FREE_BYTES,
});
add("disk_space", disk, disk.ok ? [] : [{ code: disk.code }]);
// This command is a deployment gate, not the local server startup path.  Use
// the strict production profile even when it is run from a developer machine;
// otherwise loopback/JSON compatibility could be mistaken for production
// readiness.
const startup = productionDeploymentDecision({ host: process.env.HOST || "0.0.0.0", env: process.env });
add("runtime_startup", startup);

const blockers = checks.filter((check) => !check.ok);
const output = {
  ok: blockers.length === 0,
  execution: "local_preflight_only",
  checks,
  blockers: blockers.flatMap((check) => check.blockers.map((blocker) => ({ check: check.name, blocker }))),
  nextAction: blockers[0]?.nextAction || "本地部署前检查通过；仍需按部署环境人工确认并执行真实迁移/恢复。",
  databaseObserved: false,
  networkAccessed: false,
  writesExecuted: false,
  sideEffect: "仅读取本地迁移、状态、备份和运行环境配置；未连接数据库、未启动服务、未写入文件。",
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
