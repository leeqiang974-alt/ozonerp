import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runJsonRecoveryDrill } from "../src/recoveryDrill.js";

const cli = fileURLToPath(new URL("../scripts/recovery-drill.mjs", import.meta.url));

test("JSON recovery drill validates a backup without changing the live file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-recovery-test-"));
  const file = path.join(dir, "jobs.json");
  await fs.writeFile(file, JSON.stringify({ items: [{ id: "current" }] }));
  await fs.writeFile(`${file}.bak`, JSON.stringify({ items: [{ id: "backup" }] }));
  const result = await runJsonRecoveryDrill(file);
  assert.equal(result.ok, true);
  assert.equal(result.sameContent, true);
  assert.notEqual(result.restoredDigest, "");
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { items: [{ id: "current" }] });
  await fs.rm(dir, { recursive: true, force: true });
});

test("recovery drill CLI returns a failing exit code when backup evidence is not recoverable", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-recovery-cli-"));
  const missing = path.join(dir, "missing.json");
  const failed = spawnSync(process.execPath, [cli, missing], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).reasonCode, "BACKUP_MISSING");

  const valid = path.join(dir, "valid.json");
  await fs.writeFile(`${valid}.bak`, JSON.stringify({ items: [] }));
  const passed = spawnSync(process.execPath, [cli, valid], { encoding: "utf8" });
  assert.equal(passed.status, 0);
  assert.equal(JSON.parse(passed.stdout).ok, true);
  await fs.rm(dir, { recursive: true, force: true });
});

test("JSON recovery drill fails closed when the backup is missing or invalid", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-recovery-test-"));
  const missing = await runJsonRecoveryDrill(path.join(dir, "missing.json"));
  assert.deepEqual(missing, {
    ok: false,
    source: path.join(dir, "missing.json.bak"),
    target: path.join(dir, "missing.json"),
    reasonCode: "BACKUP_MISSING",
  });
  const invalidFile = path.join(dir, "invalid.json");
  await fs.writeFile(`${invalidFile}.bak`, "not-json");
  const invalid = await runJsonRecoveryDrill(invalidFile);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reasonCode, "BACKUP_INVALID");
  await fs.rm(dir, { recursive: true, force: true });
});
