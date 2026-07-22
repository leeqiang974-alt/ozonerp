import { buildRuntimeSafetySnapshot } from "./runtimeSafety.js";

// These values are deployment declarations, not database observations.  The
// preflight remains local-only; a real runner must supply the declarations
// after it has independently verified the target project and backup receipt.
const REQUIRED_TRANSACTION_MODE = "single-transaction";
const REQUIRED_BACKUP_EVIDENCE = "isolated-verified";
const REQUIRED_MIGRATION_ID = "20260715_001_core_job_storage";
const REQUIRED_SCHEMA_VERSION = 1;
const REQUIRED_BACKUP_RECEIPT_PREFIX = `${REQUIRED_MIGRATION_ID}@schema=${REQUIRED_SCHEMA_VERSION}@`;

/**
 * Check the production migration contract without opening a database.
 *
 * A syntactically valid DATABASE_URL alone is not enough: the application
 * fallback migrator upserts tables one by one and cannot claim cross-table
 * atomicity.  Production must explicitly name a transaction-capable runner
 * and provide an external, isolated-backup receipt reference.  These are
 * declarations only and never upgrade local evidence to deployment-ready.
 */
export function buildProductionMigrationContract({ env = process.env } = {}) {
  const runtime = buildRuntimeSafetySnapshot({ env, host: "0.0.0.0" });
  const blockers = [];
  if (!runtime.databaseConfigured) blockers.push("MIGRATION_DATABASE_REQUIRED");
  if (!runtime.repositoryBackendConfigured) blockers.push("MIGRATION_RUNTIME_BACKEND_REQUIRED");
  const migrationId = String(env.OZON_ERP_MIGRATION_ID || "").trim();
  if (!migrationId) blockers.push("MIGRATION_ID_REQUIRED");
  else if (migrationId !== REQUIRED_MIGRATION_ID) blockers.push("MIGRATION_ID_MISMATCH");
  const schemaVersionRaw = String(env.OZON_ERP_MIGRATION_SCHEMA || "").trim();
  const schemaVersion = schemaVersionRaw ? Number(schemaVersionRaw) : null;
  if (!schemaVersionRaw || !Number.isInteger(schemaVersion)) blockers.push("MIGRATION_SCHEMA_REQUIRED");
  else if (schemaVersion !== REQUIRED_SCHEMA_VERSION) blockers.push("MIGRATION_SCHEMA_MISMATCH");
  const transactionMode = String(env.OZON_ERP_MIGRATION_TRANSACTION || "").trim().toLowerCase();
  if (transactionMode !== REQUIRED_TRANSACTION_MODE) blockers.push("MIGRATION_TRANSACTION_REQUIRED");
  const backupEvidence = String(env.OZON_ERP_MIGRATION_BACKUP_EVIDENCE || "").trim().toLowerCase();
  if (backupEvidence !== REQUIRED_BACKUP_EVIDENCE) blockers.push("MIGRATION_BACKUP_EVIDENCE_REQUIRED");
  const backupReceipt = String(env.OZON_ERP_MIGRATION_BACKUP_RECEIPT || "").trim();
  if (!backupReceipt) blockers.push("MIGRATION_BACKUP_RECEIPT_REQUIRED");
  else if (!backupReceipt.startsWith(REQUIRED_BACKUP_RECEIPT_PREFIX)) blockers.push("MIGRATION_BACKUP_RECEIPT_MISMATCH");
  return {
    ok: blockers.length === 0,
    allowed: blockers.length === 0,
    verificationLevel: "configuration_declared",
    databaseConfigured: runtime.databaseConfigured,
    repositoryBackend: runtime.repositoryBackend,
    repositoryBackendConfigured: runtime.repositoryBackendConfigured,
    migrationId: migrationId || null,
    schemaVersion: schemaVersion ?? null,
    backupReceiptBinding: backupReceipt ? (backupReceipt.startsWith(REQUIRED_BACKUP_RECEIPT_PREFIX) ? "matched" : "mismatch") : null,
    transactionMode: transactionMode || null,
    backupEvidence: backupEvidence || null,
    backupReceiptPresent: Boolean(backupReceipt),
    blockers,
    blockerDetails: blockers.map((code) => ({ code, severity: "high", nextAction: migrationContractActionFor(code) })),
    nextAction: migrationContractActionFor(blockers[0]) || "已声明事务迁移 runner 和隔离备份回执；仍需真实部署 runner 复核。",
    note: "仅检查部署声明，不连接数据库、不验证备份、不证明跨表事务或生产恢复已完成。",
  };
}

function migrationContractActionFor(code = "") {
  return {
    MIGRATION_DATABASE_REQUIRED: "配置可连接目标 Supabase/Postgres 的 DATABASE_URL，或完整 Supabase URL 与 service-role key。",
    MIGRATION_RUNTIME_BACKEND_REQUIRED: "当前 JobRepository 只支持 Supabase；配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY，或先实现并验证 Postgres adapter。",
    MIGRATION_ID_REQUIRED: `配置 OZON_ERP_MIGRATION_ID=${REQUIRED_MIGRATION_ID}，必须与目标 SQL 版本标记一致。`,
    MIGRATION_ID_MISMATCH: `将 OZON_ERP_MIGRATION_ID 改为 ${REQUIRED_MIGRATION_ID}，不要用未审计的迁移版本。`,
    MIGRATION_SCHEMA_REQUIRED: `配置 OZON_ERP_MIGRATION_SCHEMA=${REQUIRED_SCHEMA_VERSION}，必须与目标 SQL schema 标记一致。`,
    MIGRATION_SCHEMA_MISMATCH: `将 OZON_ERP_MIGRATION_SCHEMA 改为 ${REQUIRED_SCHEMA_VERSION}，不要用未审计的 schema。`,
    MIGRATION_TRANSACTION_REQUIRED: "配置 OZON_ERP_MIGRATION_TRANSACTION=single-transaction，并由事务型 migration runner 执行。",
    MIGRATION_BACKUP_EVIDENCE_REQUIRED: "先在隔离环境验证三张核心表备份，再配置 OZON_ERP_MIGRATION_BACKUP_EVIDENCE=isolated-verified。",
    MIGRATION_BACKUP_RECEIPT_REQUIRED: "配置 OZON_ERP_MIGRATION_BACKUP_RECEIPT 作为外部备份验证记录引用。",
    MIGRATION_BACKUP_RECEIPT_MISMATCH: `备份回执必须以 ${REQUIRED_BACKUP_RECEIPT_PREFIX}<external-receipt> 开头，以绑定迁移版本和 schema。`,
  }[code] || "完成生产迁移契约声明后重新运行部署预检。";
}
