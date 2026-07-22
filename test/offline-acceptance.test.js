import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("offline acceptance aggregates local checks and declares no external side effects", async () => {
  const script = await readFile(new URL("../scripts/offline-acceptance.mjs", import.meta.url), "utf8");
  assert.match(script, /npmCommand/);
  assert.match(script, /npmCommand, \["test"\]/);
  assert.match(script, /npmCommand, \["run", "lint"\]/);
  assert.match(script, /golden-path-replay\.mjs/);
  assert.match(script, /buildApiEvidenceSummary/);
  assert.match(script, /blockers/);
  assert.match(script, /nextAction/);
  assert.match(script, /networkAccessed: false/);
  assert.match(script, /databaseObserved: false/);
  assert.match(script, /writesExecuted: false/);
  assert.match(script, /outputPersisted: false/);
  assert.doesNotMatch(script, /fetch\(|createClient|app\.listen/);
});

test("package exposes the offline acceptance command", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["offline-acceptance"], "node scripts/offline-acceptance.mjs");
});
