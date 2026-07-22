import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  attributeValueCacheKey,
  inspectCategoryCacheFreshness,
  loadCategoryCache,
  upsertAttributeValuesCache,
} from "../src/ozonCategoryCache.js";

test("category cache freshness is explicit and stale evidence is unusable", () => {
  const now = Date.parse("2026-07-17T00:00:00.000Z");
  const fresh = inspectCategoryCacheFreshness({ updatedAt: "2026-07-01T00:00:00.000Z" }, { now, maxAgeMs: 30 * 24 * 60 * 60 * 1000 });
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.usable, true);
  const stale = inspectCategoryCacheFreshness({ updatedAt: "2026-05-01T00:00:00.000Z" }, { now, maxAgeMs: 30 * 24 * 60 * 60 * 1000 });
  assert.equal(stale.status, "stale");
  assert.equal(stale.reasonCode, "CATEGORY_CACHE_STALE");
  assert.equal(stale.usable, false);
  const missing = inspectCategoryCacheFreshness({});
  assert.equal(missing.reasonCode, "CATEGORY_CACHE_TIMESTAMP_MISSING");
  assert.equal(missing.usable, false);
});

test("attribute value cache key includes category, type, attribute and language", () => {
  assert.equal(attributeValueCacheKey({
    descriptionCategoryId: 17028673,
    typeId: 95183,
    attributeId: 10097,
    language: "ZH_HANS",
  }), "17028673:95183:10097:ZH_HANS");
});

test("upsertAttributeValuesCache persists localized dictionary values", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ozon-category-cache-"));
  process.env.OZON_CATEGORY_CACHE_FILE = path.join(tmpDir, "cache.json");

  await upsertAttributeValuesCache({
    storeId: "3770019-3",
    descriptionCategoryId: 17028673,
    typeId: 95183,
    attributeId: 10097,
    language: "ZH_HANS",
    values: [{ id: 61574, value: "白色" }],
  });

  const cache = await loadCategoryCache();
  const key = "17028673:95183:10097:ZH_HANS";
  assert.equal(cache.attributeValues[key].language, "ZH_HANS");
  assert.equal(cache.attributeValues[key].storeId, "3770019-3");
  assert.deepEqual(cache.attributeValues[key].values, [{ id: 61574, value: "白色" }]);
});

test("category cache keeps only bounded operation evidence for dictionary reads", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ozon-category-cache-evidence-"));
  process.env.OZON_CATEGORY_CACHE_FILE = path.join(tmpDir, "cache.json");
  const operationEvidence = {
    operationPath: "/v1/description-category/attribute/values",
    checkedAt: "2026-07-17T00:00:00.000Z",
    statusCode: 200,
    responseHash: `sha256:${"a".repeat(64)}`,
    verificationLevel: "server_observed",
    responsePersisted: false,
    sideEffect: "仅保存脱敏元数据",
  };
  await upsertAttributeValuesCache({
    storeId: "3770019-3",
    descriptionCategoryId: 17028673,
    typeId: 95183,
    attributeId: 10097,
    language: "ZH_HANS",
    values: [{ id: 61574, value: "白色" }],
    operationEvidence,
  });
  const cache = await loadCategoryCache();
  const key = "17028673:95183:10097:ZH_HANS";
  assert.deepEqual(cache.categoryReadEvidence.attributeValues[key], operationEvidence);
  assert.equal(cache.categoryReadEvidence.attributeValues[key].responsePersisted, false);
});

test("normalized category cache keeps per-attribute store ownership metadata", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ozon-category-cache-owner-"));
  process.env.OZON_CATEGORY_CACHE_FILE = path.join(tmpDir, "cache.json");

  await upsertAttributeValuesCache({
    storeId: "store-b",
    descriptionCategoryId: 1,
    typeId: 2,
    attributeId: 3,
    language: "RU",
    values: [{ id: 9, value: "Белый" }],
  });

  const cache = await loadCategoryCache();
  const key = "1:2:3:RU";
  assert.equal(cache.attributeValues[key].storeId, "store-b");
  assert.equal(cache.storeId, "store-b");
});
