import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

test("deployment preflight is a unified local-only gate with readable check summaries", async () => {
  const script = await readFile(new URL("../scripts/deployment-preflight.mjs", import.meta.url), "utf8");
  assert.match(script, /buildCoreMigrationDryRun/);
  assert.match(script, /buildMigrationStateAudit/);
  assert.match(script, /runCoreMigrationRecoveryDrill/);
  assert.match(script, /productionDeploymentDecision/);
  assert.match(script, /buildProductionMigrationContract/);
  assert.match(script, /buildDiskSpaceCheck/);
  assert.match(script, /disk_space/);
  assert.match(script, /production_migration_contract/);
  assert.match(script, /buildApiEvidenceSummary/);
  assert.match(script, /canonicalStoreCountVerified/);
  assert.match(script, /SELLER_API_DOC_FILE/);
  assert.match(script, /execution: "local_preflight_only"/);
  assert.match(script, /databaseObserved: false/);
  assert.match(script, /networkAccessed: false/);
  assert.match(script, /writesExecuted: false/);
  assert.match(script, /nextAction/);
  assert.match(script, /result\.ok === true \|\| result\.allowed === true/);
  assert.match(script, /LOCAL_SIMULATION_NOT_DEPLOYMENT_EVIDENCE/);
  assert.match(script, /result\.deploymentReady !== false/);
  assert.match(script, /未连接数据库、未启动服务、未写入文件/);
  assert.doesNotMatch(script, /supabase-js|createClient|fetch\(/);
});

test("disk space gate fails closed without deleting or mutating files", async () => {
  const { buildDiskSpaceCheck } = await import("../src/diskSpaceCheck.js");
  const low = buildDiskSpaceCheck({
    path: "fixture",
    minimumFreeBytes: 100,
    statfs: () => ({ bsize: 4, bavail: 10 }),
  });
  assert.equal(low.ok, false);
  assert.equal(low.code, "LOW_DISK_SPACE");
  assert.match(low.nextAction, /不会自动删除文件/);
  const readable = buildDiskSpaceCheck({
    path: "fixture",
    minimumFreeBytes: 40,
    statfs: () => ({ bsize: 4, bavail: 10 }),
  });
  assert.equal(readable.ok, true);
  assert.equal(readable.availableBytes, 40);
});

test("package exposes deployment preflight alongside individual migration checks", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["deployment-preflight"], "node scripts/deployment-preflight.mjs");
  assert.equal(packageJson.scripts["migration-check"], "node scripts/migration-check.mjs");
  assert.equal(packageJson.scripts["migration-recovery-drill"], "node scripts/migration-recovery-drill.mjs");
});

test("deployment preflight CLI emits a fail-closed machine result without external side effects", () => {
  const temp = "D:\\ozonerp-test-temp";
  const result = spawnSync(process.execPath, ["scripts/deployment-preflight.mjs"], {
    cwd: path.resolve("."),
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 1);
  const output = JSON.parse(String(result.stdout || ""));
  assert.equal(output.execution, "local_preflight_only");
  assert.equal(output.ok, false);
  assert.equal(output.databaseObserved, false);
  assert.equal(output.networkAccessed, false);
  assert.equal(output.writesExecuted, false);
  assert.ok(Array.isArray(output.blockers));
  assert.ok(output.blockers.some((entry) => entry.blocker?.code === "MIGRATION_STATE_MISSING"));
});
