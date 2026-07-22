import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("recovery rehearsal emits bounded local evidence and no external side effects", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/recovery-rehearsal.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.verificationLevel, "locally_tested");
  assert.equal(report.temporaryFixture, true);
  assert.deepEqual(report.success.appliedTables, ["auto_listing_jobs", "stock_queue_jobs", "pipeline_runs"]);
  assert.equal(report.injectedFailure.failure.table, "stock_queue_jobs");
  assert.equal(report.databaseObserved, false);
  assert.equal(report.networkAccessed, false);
  assert.equal(report.writesExecuted, false);
  assert.equal(report.deploymentReady, false);
});
