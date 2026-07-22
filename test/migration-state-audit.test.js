import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildMigrationStateAudit } from "../src/migrationStateAudit.js";

async function tempState(value) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-migration-state-"));
  const file = path.join(dir, "migration-state.json");
  if (value !== undefined) await fs.writeFile(file, JSON.stringify(value), "utf8");
  return { dir, file };
}

test("migration state audit accepts a complete local marker without database claims", async (t) => {
  const { dir, file } = await tempState({ schemaVersion: 1, done: {
    auto_listing_jobs: "2026-07-17T00:00:00.000Z",
    stock_queue_jobs: "2026-07-17T00:01:00.000Z",
    pipeline_runs: "2026-07-17T00:02:00.000Z",
  } });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const result = await buildMigrationStateAudit({ stateFile: file });
  assert.equal(result.ok, true);
  assert.equal(result.state, "complete");
  assert.deepEqual(result.missingTables, []);
  assert.equal(result.databaseObserved, false);
  assert.equal(result.writeStarted, false);
  assert.equal(result.readOnly, true);
});

test("migration state audit fails closed for missing, partial, and malformed state", async (t) => {
  const missing = await tempState();
  const partial = await tempState({ schemaVersion: 1, done: { auto_listing_jobs: "2026-07-17T00:00:00.000Z" } });
  const invalid = await tempState({ schemaVersion: 99, done: { auto_listing_jobs: "not-a-date" } });
  t.after(() => Promise.all([missing, partial, invalid].map(({ dir }) => fs.rm(dir, { recursive: true, force: true }))));
  const missingResult = await buildMigrationStateAudit({ stateFile: missing.file });
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.blockers[0].code, "MIGRATION_STATE_MISSING");
  assert.match(missingResult.nextAction, /恢复迁移状态/);
  const partialResult = await buildMigrationStateAudit({ stateFile: partial.file });
  assert.equal(partialResult.ok, false);
  assert.equal(partialResult.blockers.some((item) => item.code === "MIGRATION_STATE_INCOMPLETE"), true);
  const invalidResult = await buildMigrationStateAudit({ stateFile: invalid.file });
  assert.equal(invalidResult.ok, false);
  assert.equal(invalidResult.blockers.some((item) => item.code === "MIGRATION_STATE_SCHEMA_UNKNOWN"), true);
  assert.equal(invalidResult.blockers.some((item) => item.code === "MIGRATION_STATE_TIMESTAMP_INVALID"), true);
  assert.ok(invalidResult.nextAction);
});
