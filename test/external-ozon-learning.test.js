import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

import {
  normalizeExternalOzonProduct,
  syncExternalOzonLearning,
} from "../src/externalOzonLearning.js";

test("normalizes a detailed external product and removes collector noise", () => {
  const product = normalizeExternalOzonProduct({
    url: "https://www.ozon.ru/product/organayzer-dlya-kuhni-2803160067/?from=share",
    sku: "24",
    title: "Цена что надо",
    image: "https://www.ozon.ru/",
    detail: {
      productId: "24",
      title: "Органайзер для кухни настольный многофункциональный",
      price: "1 299 ₽",
      image: "https://cdn1.ozone.ru/s3/multimedia-a/wc1200/123.jpg",
      images: ["https://www.ozon.ru/", "https://cdn1.ozone.ru/s3/multimedia-a/wc1200/123.jpg"],
      category: "Хранение на кухне",
      attributes: {
        Материал: "Металл",
        "Политика обработки данных": "Оплата",
      },
      description: "Практичный органайзер. Ozon Product Collector 插件采集完成。",
    },
  });

  assert.equal(product.productId, "2803160067");
  assert.equal(product.url, "https://www.ozon.ru/product/organayzer-dlya-kuhni-2803160067/");
  assert.equal(product.title, "Органайзер для кухни настольный многофункциональный");
  assert.equal(product.price, 1299);
  assert.deepEqual(product.images, ["https://cdn1.ozone.ru/s3/multimedia-a/wc1200/123.jpg"]);
  assert.deepEqual(product.attributes, { Материал: "Металл" });
  assert.equal(product.description, "Практичный органайзер.");
});

test("rejects promotional cards and rows without product detail", () => {
  assert.equal(normalizeExternalOzonProduct({ title: "Распродажа", url: "https://www.ozon.ru/" }), null);
  assert.equal(normalizeExternalOzonProduct({
    title: "250 баллов за отзыв Вау-цены",
    url: "https://www.ozon.ru/product/promo-123/",
    detail: { title: "250 баллов за отзыв Вау-цены" },
  }), null);
});

test("sync imports only accepted rows and skips an unchanged source file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "external-ozon-learning-"));
  const sourceFile = path.join(tempDir, "ozon_competitors.json");
  const stateFile = path.join(tempDir, "state.json");
  await writeFile(sourceFile, JSON.stringify([
    {
      url: "https://www.ozon.ru/product/polka-987654321/",
      detail: {
        title: "Полка настенная металлическая для ванной комнаты",
        price: 899,
        category: "Полки для ванной",
        attributes: { Материал: "Металл" },
      },
    },
    { url: "https://www.ozon.ru/", title: "Цена что надо" },
  ]), "utf8");

  const importedBatches = [];
  let analyzed = 0;
  const dependencies = {
    importItems: async (items) => {
      importedBatches.push(items);
      return { ok: true, inserted: items.length, updated: 0, total: items.length };
    },
    analyzeRules: async () => { analyzed += 1; },
  };

  const first = await syncExternalOzonLearning({ sourceFile, stateFile, force: true, ...dependencies });
  const second = await syncExternalOzonLearning({ sourceFile, stateFile, ...dependencies });
  const state = JSON.parse(await readFile(stateFile, "utf8"));

  assert.equal(first.accepted, 1);
  assert.equal(first.rejected, 1);
  assert.equal(importedBatches.length, 1);
  assert.equal(importedBatches[0][0].productId, "987654321");
  assert.equal(analyzed, 1);
  assert.equal(second.unchanged, true);
  assert.equal(state.lastResult.accepted, 1);
});
