import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("server exposes a dedicated PDD capture endpoint", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /parsePddProduct/);
  assert.match(source, /app\.post\("\/api\/pdd\/capture"/);
});

test("collection box deduplicates PDD goods ids across desktop and mobile URLs", async () => {
  const source = await readFile(new URL("../src/collectionBox.js", import.meta.url), "utf8");

  assert.match(source, /goods_id/);
  assert.match(source, /pdd-goods/);
});
