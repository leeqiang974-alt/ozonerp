import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("recovery CI gate is repeatable and remains local-only even with external env names", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/recovery-ci-gate.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, OZON_API_KEY: "must-not-be-used", SUPABASE_URL: "https://example.invalid" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, {
    ok: true,
    gate: "recovery_rehearsal",
    verificationLevel: "locally_tested",
    temporaryFixture: true,
    databaseObserved: false,
    networkAccessed: false,
    writesExecuted: false,
    deploymentReady: false,
  });
});
