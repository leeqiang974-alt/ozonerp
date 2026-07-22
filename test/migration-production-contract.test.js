import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionMigrationContract } from "../src/migrationProductionContract.js";

const configured = {
  DATABASE_URL: "postgresql://db.example.test/ozon",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  OZON_ERP_MIGRATION_ID: "20260715_001_core_job_storage",
  OZON_ERP_MIGRATION_SCHEMA: "1",
  OZON_ERP_MIGRATION_TRANSACTION: "single-transaction",
  OZON_ERP_MIGRATION_BACKUP_EVIDENCE: "isolated-verified",
  OZON_ERP_MIGRATION_BACKUP_RECEIPT: "20260715_001_core_job_storage@schema=1@backup-receipt-20260717-001",
};

test("production migration contract fails closed when transaction and backup declarations are absent", () => {
  const result = buildProductionMigrationContract({ env: { DATABASE_URL: configured.DATABASE_URL } });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("MIGRATION_TRANSACTION_REQUIRED"));
  assert.ok(result.blockers.includes("MIGRATION_BACKUP_EVIDENCE_REQUIRED"));
  assert.ok(result.blockers.includes("MIGRATION_BACKUP_RECEIPT_REQUIRED"));
  assert.ok(result.blockers.includes("MIGRATION_ID_REQUIRED"));
  assert.ok(result.blockers.includes("MIGRATION_SCHEMA_REQUIRED"));
  assert.equal(result.databaseConfigured, true);
});

test("production migration contract accepts declarations but remains non-production evidence", () => {
  const result = buildProductionMigrationContract({ env: configured });
  assert.equal(result.ok, true);
  assert.equal(result.allowed, true);
  assert.equal(result.verificationLevel, "configuration_declared");
  assert.equal(result.backupReceiptBinding, "matched");
  assert.match(result.note, /不连接数据库/);
});

test("production migration contract rejects database-shaped placeholders", () => {
  const result = buildProductionMigrationContract({ env: {
    ...configured,
    DATABASE_URL: "postgres-url",
  } });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("MIGRATION_DATABASE_REQUIRED"));
});

test("production migration contract binds backup receipt to the audited migration version", () => {
  const result = buildProductionMigrationContract({ env: {
    ...configured,
    OZON_ERP_MIGRATION_BACKUP_RECEIPT: "other-migration@schema=99@backup-receipt",
  } });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("MIGRATION_BACKUP_RECEIPT_MISMATCH"));
  assert.equal(result.backupReceiptBinding, "mismatch");
});

test("production migration contract rejects an unreviewed migration id or schema", () => {
  const result = buildProductionMigrationContract({ env: {
    ...configured,
    OZON_ERP_MIGRATION_ID: "20260716_unreviewed",
    OZON_ERP_MIGRATION_SCHEMA: "2",
  } });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("MIGRATION_ID_MISMATCH"));
  assert.ok(result.blockers.includes("MIGRATION_SCHEMA_MISMATCH"));
});
