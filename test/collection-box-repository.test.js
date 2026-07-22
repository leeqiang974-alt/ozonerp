import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(path.resolve("src/collectionBox.js")).href;
const execFileAsync = promisify(execFile);

function runChild(dataDir, code, extraEnv = {}) {
  return execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: process.cwd(),
    env: { ...process.env, OZON_ERP_DATA_DIR: dataDir, ...extraEnv },
    encoding: "utf8",
    timeout: 30000,
  });
}

function runChildAsync(dataDir, code, extraEnv = {}) {
  return execFileAsync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: process.cwd(),
    env: { ...process.env, OZON_ERP_DATA_DIR: dataDir, ...extraEnv },
    encoding: "utf8",
    timeout: 30000,
  });
}

test("collection box serializes concurrent writers across processes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-collection-box-"));
  const code = `
    const { addCollectionItem } = await import(${JSON.stringify(moduleUrl)});
    for (let i = 0; i < 8; i += 1) {
      await addCollectionItem({ parsed: { url: 'https://detail.1688.com/offer/' + process.env.WORKER + '-' + i + '.html', title: 'item' + i }, storeId: process.env.WORKER });
    }
  `;
  const workers = Array.from({ length: 8 }, (_, index) => runChildAsync(root, code, { WORKER: String(index) }));
  await Promise.all(workers);
  const text = await fs.readFile(path.join(root, "1688-collection-box.json"), "utf8");
  const data = JSON.parse(text);
  assert.equal(data.items.length, 64);
  assert.equal(new Set(data.items.map((item) => item.id)).size, 64);
});

test("collection box restores a corrupt primary from the previous atomic backup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-collection-box-recovery-"));
  const add = `const { addCollectionItem } = await import(${JSON.stringify(moduleUrl)}); await addCollectionItem({ parsed: { url: 'https://detail.1688.com/offer/100001.html', title: 'one' } }); await addCollectionItem({ parsed: { url: 'https://detail.1688.com/offer/100002.html', title: 'two' } });`;
  runChild(root, add);
  const file = path.join(root, "1688-collection-box.json");
  await fs.writeFile(file, "{broken", "utf8");
  const listed = runChild(root, `const { listCollectionItems } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(await listCollectionItems()));`);
  const items = JSON.parse(listed.trim());
  assert.equal(items.length, 1);
  assert.equal(items[0].parsed.title, "one");
  const repaired = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(repaired.items.length, 1);
  const backup = JSON.parse(await fs.readFile(`${file}.bak`, "utf8"));
  assert.equal(backup.items.length, 1);
  await fs.writeFile(file, "{broken-again", "utf8");
  const recoveredAgain = runChild(root, `const { listCollectionItems } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(await listCollectionItems()));`);
  assert.equal(JSON.parse(recoveredAgain.trim()).length, 1);
});

test("collection box recovers a stale lock before the bounded timeout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-collection-box-lock-"));
  const dataDir = root;
  const lock = path.join(dataDir, "1688-collection-box.json.lock");
  await fs.writeFile(lock, JSON.stringify({ pid: 1, token: "stale" }), "utf8");
  const old = new Date(Date.now() - 60000);
  await fs.utimes(lock, old, old);
  runChild(dataDir, `const { addCollectionItem } = await import(${JSON.stringify(moduleUrl)}); await addCollectionItem({ parsed: { url: 'https://detail.1688.com/offer/100003.html', title: 'stale lock recovered' } });`);
  assert.equal(await fs.stat(path.join(dataDir, "1688-collection-box.json")).then(() => true), true);
});
