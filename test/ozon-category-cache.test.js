import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  attributeValueCacheKey,
  loadCategoryCache,
  upsertAttributeValuesCache,
} from "../src/ozonCategoryCache.js";

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
