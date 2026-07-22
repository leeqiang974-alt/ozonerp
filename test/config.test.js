import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadStores, publicStore } from "../src/config.js";

test("store loader keeps four primary APIs and ignores external/personal duplicate profiles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-store-config-"));
  const file = path.join(dir, "ozonapi.txt");
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await fs.writeFile(file, [
    "店铺名称：one", "id：100", `key：${uuid(1)}`,
    "two", "200", uuid(2),
    "店铺名称：three", "id：300", `key：${uuid(3)}`,
    "four", "400", uuid(4),
    "外部使用", "店铺名称：duplicate", "id：400", `key：${uuid(5)}`,
    "个人使用", "duplicate", "400", uuid(6),
  ].join("\n"), "utf8");
  try {
    const stores = loadStores(file);
    assert.equal(stores.length, 4);
    const publicStores = stores.map(publicStore);
    assert.equal(Object.prototype.hasOwnProperty.call(publicStores[0], "apiKey"), false);
    assert.deepEqual(publicStores.map(({ id, name, clientId }) => ({ id, name, clientId })), [
      { id: "100-1", name: "one", clientId: "100" },
      { id: "200-2", name: "two", clientId: "200" },
      { id: "300-3", name: "three", clientId: "300" },
      { id: "400-4", name: "four", clientId: "400" },
    ]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
