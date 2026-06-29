import fs from "node:fs/promises";
import path from "node:path";

import { getStore, loadStores } from "../src/config.js";
import { ozonRequest } from "../src/ozon.js";
import {
  attributeValueCacheKey,
  categoryAttributeCacheKey,
  analyzeRequiredAttributes,
} from "../src/ozonRequiredAttributeAnalysis.js";
import {
  loadCategoryCache,
  saveCategoryCache,
} from "../src/ozonCategoryCache.js";

const OUTPUT_FILE = path.join(process.cwd(), "data", "ozon-required-attribute-analysis.json");

const args = parseArgs(process.argv.slice(2));
const limit = Number(args.limit || 0);
const throttleMs = Number(args.throttleMs ?? args.throttle ?? 350);
const language = String(args.language || "ZH_HANS");
const refreshAttributes = Boolean(args.refreshAttributes || args.refresh || false);
const refreshValues = Boolean(args.refreshValues || false);

let cache = await loadCategoryCache();
let store = null;
if (refreshAttributes || refreshValues) {
  store = resolveStore(args.storeId || cache.storeId || "");
}

if (refreshAttributes) {
  cache = await refreshMissingAttributes(cache, store, { limit, throttleMs, language });
}

if (refreshValues) {
  cache = await refreshMissingRequiredDictionaryValues(cache, store, { limit, throttleMs, language });
}

const analysis = analyzeRequiredAttributes(cache);
await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
await fs.writeFile(OUTPUT_FILE, JSON.stringify(analysis, null, 2), "utf8");

console.log(JSON.stringify({
  ok: true,
  output: OUTPUT_FILE,
  categoryTypeCount: analysis.summary.categoryTypeCount,
  categoriesWithCachedAttributes: analysis.summary.categoriesWithCachedAttributes,
  categoriesMissingAttributes: analysis.summary.categoriesMissingAttributes,
  requiredAttributeRows: analysis.summary.requiredAttributeRows,
  dictionaryRequiredRows: analysis.summary.dictionaryRequiredRows,
  dictionaryValuesCachedRows: analysis.summary.dictionaryValuesCachedRows,
  strategySummary: analysis.strategySummary,
}, null, 2));

async function refreshMissingAttributes(cacheData, storeData, options) {
  const flat = Array.isArray(cacheData.flat) ? cacheData.flat : [];
  const attributes = cacheData.attributes || {};
  const targets = flat.filter((category) => !Array.isArray(attributes[categoryAttributeCacheKey(category)]));
  const selected = options.limit > 0 ? targets.slice(0, options.limit) : targets;
  let next = { ...cacheData, attributes: { ...attributes } };
  let done = 0;
  for (const category of selected) {
    const key = categoryAttributeCacheKey(category);
    try {
      const data = await ozonRequest(storeData, "/v1/description-category/attribute", {
        description_category_id: Number(category.description_category_id),
        type_id: Number(category.type_id),
        language: options.language,
      });
      next.attributes[key] = data.result || [];
    } catch (error) {
      next.attributes[key] = [];
      console.error(JSON.stringify({
        level: "warn",
        stage: "refresh_attributes",
        categoryKey: key,
        message: error.message,
      }));
    }
    next.updatedAt = new Date().toISOString();
    next.storeId = storeData.id;
    done += 1;
    if (done % 25 === 0) await saveCategoryCache(next);
    await sleep(options.throttleMs);
  }
  await saveCategoryCache(next);
  return next;
}

async function refreshMissingRequiredDictionaryValues(cacheData, storeData, options) {
  const flat = Array.isArray(cacheData.flat) ? cacheData.flat : [];
  const attributes = cacheData.attributes || {};
  const attributeValues = cacheData.attributeValues || {};
  const targets = [];
  for (const category of flat) {
    const attrs = attributes[categoryAttributeCacheKey(category)] || [];
    for (const attribute of attrs) {
      if (!attribute.is_required || !Number(attribute.dictionary_id || 0)) continue;
      const key = attributeValueCacheKey(category, attribute, options.language);
      if (Object.prototype.hasOwnProperty.call(attributeValues, key)) continue;
      targets.push({ category, attribute });
    }
  }
  const selected = options.limit > 0 ? targets.slice(0, options.limit) : targets;
  const next = {
    ...cacheData,
    attributeValues: { ...attributeValues },
  };
  let done = 0;
  for (const target of selected) {
    const key = attributeValueCacheKey(target.category, target.attribute, options.language);
    try {
      const data = await ozonRequest(storeData, "/v1/description-category/attribute/values", {
        attribute_id: Number(target.attribute.id),
        description_category_id: Number(target.category.description_category_id),
        type_id: Number(target.category.type_id),
        language: options.language,
        limit: 100,
        last_value_id: 0,
      });
      next.attributeValues[key] = {
        storeId: storeData.id,
        descriptionCategoryId: target.category.description_category_id,
        typeId: target.category.type_id,
        attributeId: target.attribute.id,
        language: options.language,
        updatedAt: new Date().toISOString(),
        values: data.result || [],
      };
    } catch (error) {
      next.attributeValues[key] = {
        storeId: storeData.id,
        descriptionCategoryId: target.category.description_category_id,
        typeId: target.category.type_id,
        attributeId: target.attribute.id,
        language: options.language,
        updatedAt: new Date().toISOString(),
        values: [],
        error: error.message,
      };
      console.error(JSON.stringify({
        level: "warn",
        stage: "refresh_values",
        categoryKey: categoryAttributeCacheKey(target.category),
        attributeId: Number(target.attribute.id || 0),
        message: error.message,
      }));
    }
    done += 1;
    next.updatedAt = new Date().toISOString();
    next.storeId = storeData.id;
    if (done % 25 === 0) await saveCategoryCache(next);
    await sleep(options.throttleMs);
  }
  await saveCategoryCache(next);
  return loadCategoryCache();
}

function resolveStore(storeId) {
  if (storeId) return getStore(storeId);
  const stores = loadStores();
  if (!stores.length) throw new Error("未配置 Ozon 店铺，无法刷新类目属性。");
  return stores[0];
}

function parseArgs(argv) {
  const result = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, rawValue] = item.slice(2).split("=");
    result[toCamel(key)] = rawValue === undefined ? true : rawValue;
  }
  return result;
}

function toCamel(value) {
  return String(value || "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}
