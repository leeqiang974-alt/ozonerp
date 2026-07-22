import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("project test command serializes files that share process environment stores", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.match(String(packageJson.scripts?.test || ""), /--test-concurrency=1/);
});

test("tests do not use tracked data files as mutable fixtures", async () => {
  const dataDir = path.join(root, "data");
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  const mutableTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.json"))
    .map((entry) => entry.name);

  assert.deepEqual(
    mutableTestFiles,
    [],
    "tests must use an OS temp directory; tracked data/*.test.json files can pollute developer and production state",
  );
});
