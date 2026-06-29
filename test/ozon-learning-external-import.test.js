import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

test("imports external detail rows into the canonical learning store without duplicates", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ozon-learning-import-"));
  process.env.OZON_LEARNING_DATA_DIR = dataDir;
  const learning = await import(`../src/ozonLearning.js?external-import=${Date.now()}`);
  const row = {
    url: "https://www.ozon.ru/product/polka-987654321/",
    productId: "987654321",
    title: "Полка настенная металлическая для ванной комнаты",
    price: 899,
    category: "Полки для ванной",
    attributes: { Материал: "Металл" },
    images: ["https://cdn1.ozone.ru/s3/multimedia-a/123.jpg"],
  };

  const first = await learning.importExternalOzonLearningItems([row], { sourceFile: "external.json", signature: "one" });
  const second = await learning.importExternalOzonLearningItems([row], { sourceFile: "external.json", signature: "two" });
  const items = await learning.listOzonLearningItems();

  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "detailed");
  assert.equal(items[0].source, "external_ozonerp");
  assert.equal(items[0].detail.attributes.Материал, "Металл");
});
