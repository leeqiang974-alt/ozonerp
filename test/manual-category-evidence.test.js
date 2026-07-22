import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findCachedManualCategory } from "../src/autoListing.js";

test("manual category selection requires a current cached category/type/path", () => {
  const cache = {
    flat: [
      { description_category_id: 10, type_id: 20, path: "Дом / Кухня / Органайзеры", disabled: false },
      { description_category_id: 10, type_id: 21, path: "Дом / Кухня / Архив", disabled: true },
    ],
  };
  assert.equal(findCachedManualCategory(cache, {
    descriptionCategoryId: 10,
    typeId: 20,
    path: "Дом /  Кухня / Органайзеры",
  })?.type_id, 20);
  assert.equal(findCachedManualCategory(cache, {
    descriptionCategoryId: 10,
    typeId: 99,
    path: "Дом / Кухня / Органайзеры",
  }), null);
  assert.equal(findCachedManualCategory(cache, {
    descriptionCategoryId: 10,
    typeId: 21,
    path: "Дом / Кухня / Архив",
  }), null);
});

test("seller-confirmed category is the payload source and stale selection cannot be replaced silently", async () => {
  const autoListing = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  const draftStart = autoListing.indexOf("async function saveWorkflowPayloadDraftForListingJob");
  const draftEnd = autoListing.indexOf("async function waitForImportInfo", draftStart);
  const helper = autoListing.slice(draftStart, draftEnd);
  assert.match(helper, /manualCategoryMatch = savedCategoryIdsValid \? findCachedManualCategory/);
  assert.match(helper, /卖家确认的 Ozon 类目不在当前类目缓存中/);
  assert.match(helper, /const categoryMatch = manualCategoryMatch \|\| matchCategory/);
  const saveStart = autoListing.indexOf("export async function saveManualListingCategory");
  const saveEnd = autoListing.indexOf("export async function saveManualProcurementEvidence", saveStart);
  const saveHandler = autoListing.slice(saveStart, saveEnd);
  assert.match(saveHandler, /LISTING_CATEGORY_NOT_IN_CACHE/);
  assert.match(saveHandler, /刷新 Ozon 类目缓存/);
});
