import test from "node:test";
import assert from "node:assert/strict";
import { buildListingPayloadDraftFromJob } from "../src/autoListing.js";
import { validateSubmitPayload } from "../src/workflowRuns.js";

test("buildListingPayloadDraftFromJob creates workflow payload draft without Ozon submit", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq00999",
    ozonTitle: "Автокормушка для кошек",
    listingContent: {
      title_ru: "Автоматическая кормушка для кошек",
      description_ru: "Удобная кормушка для домашних животных.",
      annotation: "Кормушка для ежедневного использования.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "宠物自动喂食器",
      candidateUrl: "https://detail.1688.com/offer/1.html",
      purchasePriceCny: 18,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 220, lengthMm: 160, widthMm: 120, heightMm: 90 },
      skuVariants: [],
      attributes: [{ name: "材质", value: "塑料" }],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Товары для животных",
    },
  });

  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].offer_id, "SKUlq00999");
  assert.equal(draft.items[0].description_category_id, 17028673);
  assert.equal(draft.items[0].type_id, 95183);
  assert.ok(draft.items[0].attributes.some((attribute) => Number(attribute.id) === 9048));
  assert.equal(validateSubmitPayload(draft).ok, true);
});

test("buildListingPayloadDraftFromJob marks learned Ozon commission source", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01000",
    ozonTitle: "Органайзер для кухни",
    ozonContext: {
      commissions: [{ sales_percent: 18 }],
    },
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/2.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
  });

  assert.equal(draft.summary.pricingDiagnosis.commissionRate, 0.18);
  assert.equal(draft.summary.pricingDiagnosis.commissionSource.source, "learned_product");
});

test("buildListingPayloadDraftFromJob autofills no-brand and China from current category dictionaries", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01001",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/3.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 4389, name: "Страна-изготовитель", is_required: true, dictionary_id: 970000 },
    ],
    attributeValuesById: {
      85: [{ id: 971082, value: "Нет бренда" }],
      4389: [{ id: 356971, value: "Китай" }],
    },
  });

  const attrs = draft.items[0].attributes;
  assert.equal(attrs.find((attribute) => Number(attribute.id) === 85)?.values[0].dictionary_value_id, 971082);
  assert.equal(attrs.find((attribute) => Number(attribute.id) === 4389)?.values[0].dictionary_value_id, 356971);
});

test("buildListingPayloadDraftFromJob does not guess dictionary ids for no-brand and China", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01002",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/4.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 4389, name: "Страна-изготовитель", is_required: true, dictionary_id: 970000 },
    ],
    attributeValuesById: {
      85: [{ id: 123, value: "Some brand" }],
      4389: [{ id: 456, value: "Россия" }],
    },
  });

  const attrs = draft.items[0].attributes;
  assert.equal(attrs.some((attribute) => Number(attribute.id) === 85), false);
  assert.equal(attrs.some((attribute) => Number(attribute.id) === 4389), false);
});

test("buildListingPayloadDraftFromJob reads high-confidence attributes from category cache", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01003",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/5.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    categoryCache: {
      attributes: {
        "17028673:95183": [
          { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
          { id: 4389, name: "Страна-изготовитель", is_required: true, dictionary_id: 970000 },
        ],
      },
      attributeValues: {
        "17028673:95183:85:ZH_HANS": { values: [{ id: 971082, value: "Нет бренда" }] },
        "17028673:95183:4389:ZH_HANS": { values: [{ id: 356971, value: "Китай" }] },
      },
    },
  });

  const attrs = draft.items[0].attributes;
  assert.equal(attrs.find((attribute) => Number(attribute.id) === 85)?.values[0].dictionary_value_id, 971082);
  assert.equal(attrs.find((attribute) => Number(attribute.id) === 4389)?.values[0].dictionary_value_id, 356971);
});
