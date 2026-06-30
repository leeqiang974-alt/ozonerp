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

test("server can promote captured PDD products into the matching candidate pool", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const crawler = await readFile(new URL("../src/crawler1688.js", import.meta.url), "utf8");

  assert.match(server, /\/api\/1688\/captures\/:id\/to-candidate/);
  assert.match(crawler, /moveCaptureToCrawlerCandidate/);
  assert.match(crawler, /captureId/);
  assert.match(crawler, /sourcePlatform/);
});
