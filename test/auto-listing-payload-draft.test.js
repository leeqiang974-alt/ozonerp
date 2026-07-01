import test from "node:test";
import assert from "node:assert/strict";
import { buildListingPayloadDraftFromJob } from "../src/autoListing.js";
import { buildRequiredAttributeFillPlan } from "../src/ozonRequiredAttributeAnalysis.js";
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

test("buildListingPayloadDraftFromJob records source-explained model autofill across variants", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01004",
    ozonTitle: "Набор органайзеров для кухни",
    listingContent: {
      title_ru: "Набор органайзеров для кухни",
      description_ru: "Практичный набор органайзеров для аккуратного хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/6.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [
        { spec: "白色", price: 20, image: "https://example.com/white.jpg" },
        { spec: "黑色", price: 21, image: "https://example.com/black.jpg" },
      ],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    attributeValuesById: {
      85: [{ id: 971082, value: "Нет бренда" }],
    },
  });

  const modelValues = draft.items.map((item) => item.attributes
    .find((attribute) => Number(attribute.id) === 9048)?.values[0]?.value);
  assert.equal(draft.items.length, 2);
  assert.deepEqual(new Set(modelValues).size, 1);
  assert.ok(modelValues[0].length > 0);
  const modelPlan = draft.summary.requiredAttributeFillPlan.find((row) => row.attributeId === 9048);
  assert.equal(modelPlan.strategy, "model_name_from_parent_sku");
  assert.equal(modelPlan.action, "auto_fill");
  assert.equal(modelPlan.source, "parent_sku");
  assert.equal(modelPlan.value, modelValues[0]);
});

test("buildRequiredAttributeFillPlan keeps dictionary candidates in current category and marks package/sensitive fields", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 4389, name: "Страна-изготовитель", is_required: true, dictionary_id: 200 },
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
      { id: 888, name: "Вес товара, г", is_required: true },
      { id: 999, name: "Срок годности", is_required: true },
      { id: 23487, name: "Производитель", is_required: true, dictionary_id: 300 },
    ],
    attributeValuesById: {
      4389: [{ id: 22, value: "Китай" }],
      777: [
        { id: 11, value: "пластик" },
        { id: 12, value: "металл" },
      ],
    },
    modelName: "Органайзер SKUlq01005",
    productText: "Кухонный органайзер из пластика",
    packageInfo: { weight: 700, depth: 220, width: 160, height: 80 },
  });

  const originPlan = plan.find((row) => row.attributeId === 4389);
  assert.equal(originPlan.action, "auto_fill");
  assert.equal(originPlan.strategy, "fixed_country_china");
  assert.equal(originPlan.dictionaryValueId, 22);
  assert.equal(originPlan.source, "fixed_country_china");

  const dictionaryPlan = plan.find((row) => row.attributeId === 777);
  assert.equal(dictionaryPlan.action, "suggest_dictionary");
  assert.equal(dictionaryPlan.dictionaryValueId, undefined);
  assert.deepEqual(dictionaryPlan.dictionaryCandidates.map((item) => item.dictionaryValueId), [11]);

  const packagePlan = plan.find((row) => row.attributeId === 888);
  assert.equal(packagePlan.action, "auto_fill");
  assert.equal(packagePlan.source, "1688_package");
  assert.equal(packagePlan.value, "700");

  const sensitivePlan = plan.find((row) => row.attributeId === 999);
  assert.equal(sensitivePlan.action, "blocked_sensitive");
  assert.equal(sensitivePlan.confidence, "low");

  const manufacturerPlan = plan.find((row) => row.attributeId === 23487);
  assert.equal(manufacturerPlan.action, "blocked_sensitive");
  assert.equal(manufacturerPlan.strategy, "compliance_sensitive");
});

test("buildRequiredAttributeFillPlan suggests dictionary candidates from material synonyms only", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
    ],
    attributeValuesById: {
      777: [
        { id: 11, value: "пластик" },
        { id: 12, value: "металл" },
      ],
    },
    productText: "1688 参数：材质 PP 塑料，适合厨房收纳",
  });

  const materialPlan = plan.find((row) => row.attributeId === 777);
  assert.equal(materialPlan.action, "suggest_dictionary");
  assert.equal(materialPlan.dictionaryValueId, undefined);
  assert.deepEqual(materialPlan.dictionaryCandidates, [{
    dictionaryValueId: 11,
    value: "пластик",
    confidence: 0.72,
    source: "material_synonym",
  }]);

  const colorPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 10097, name: "Цвет", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      10097: [{ id: 91, value: "пластик" }],
    },
    productText: "1688 参数：材质 PP 塑料",
  })[0];
  assert.equal(colorPlan.action, "suggest_dictionary");
  assert.deepEqual(colorPlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests type dictionary candidates from product synonyms only", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8229, name: "Тип", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      8229: [
        { id: 31, value: "органайзер" },
        { id: 32, value: "корзина" },
      ],
    },
    productText: "1688 标题：厨房收纳盒 organizer для кухни",
  });

  const typePlan = plan.find((row) => row.attributeId === 8229);
  assert.equal(typePlan.action, "suggest_dictionary");
  assert.equal(typePlan.dictionaryValueId, undefined);
  assert.deepEqual(typePlan.dictionaryCandidates, [{
    dictionaryValueId: 31,
    value: "органайзер",
    confidence: 0.7,
    source: "type_synonym",
  }]);

  const materialPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
    ],
    attributeValuesById: {
      777: [{ id: 11, value: "органайзер" }],
    },
    productText: "1688 标题：厨房收纳盒 organizer",
  })[0];
  assert.deepEqual(materialPlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests purpose dictionary candidates from product synonyms only", () => {
  const kitchenPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 4958, name: "Назначение", is_required: true, dictionary_id: 102 },
    ],
    attributeValuesById: {
      4958: [
        { id: 41, value: "для кухни" },
        { id: 42, value: "для ванной" },
      ],
    },
    productText: "1688 标题：厨房收纳用品 kitchen storage",
  })[0];

  assert.equal(kitchenPlan.action, "suggest_dictionary");
  assert.equal(kitchenPlan.dictionaryValueId, undefined);
  assert.deepEqual(kitchenPlan.dictionaryCandidates, [{
    dictionaryValueId: 41,
    value: "для кухни",
    confidence: 0.7,
    source: "purpose_synonym",
  }]);

  const petPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 4959, name: "适用对象", is_required: true, dictionary_id: 103 },
    ],
    attributeValuesById: {
      4959: [
        { id: 51, value: "для животных" },
        { id: 52, value: "для взрослых" },
      ],
    },
    productText: "1688 标题：宠物猫狗用品 pet supplies",
  })[0];

  assert.equal(petPlan.action, "suggest_dictionary");
  assert.deepEqual(petPlan.dictionaryCandidates, [{
    dictionaryValueId: 51,
    value: "для животных",
    confidence: 0.7,
    source: "purpose_synonym",
  }]);

  const typePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8229, name: "Тип", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      8229: [{ id: 61, value: "для кухни" }],
    },
    productText: "1688 标题：厨房用品",
  })[0];
  assert.deepEqual(typePlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests gender dictionary candidates from product synonyms only", () => {
  const womenPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8292, name: "Пол", is_required: true, dictionary_id: 104 },
    ],
    attributeValuesById: {
      8292: [
        { id: 71, value: "женский" },
        { id: 72, value: "мужской" },
      ],
    },
    productText: "1688 标题：女士收纳包 women travel organizer",
  })[0];

  assert.equal(womenPlan.action, "suggest_dictionary");
  assert.equal(womenPlan.dictionaryValueId, undefined);
  assert.deepEqual(womenPlan.dictionaryCandidates, [{
    dictionaryValueId: 71,
    value: "женский",
    confidence: 0.7,
    source: "gender_synonym",
  }]);

  const childrenPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8293, name: "适用性别", is_required: true, dictionary_id: 105 },
    ],
    attributeValuesById: {
      8293: [
        { id: 81, value: "для взрослых" },
        { id: 82, value: "детский" },
      ],
    },
    productText: "1688 标题：儿童洗漱杯 kids bathroom cup",
  })[0];

  assert.equal(childrenPlan.action, "suggest_dictionary");
  assert.deepEqual(childrenPlan.dictionaryCandidates, [{
    dictionaryValueId: 82,
    value: "детский",
    confidence: 0.7,
    source: "gender_synonym",
  }]);

  const purposePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 4958, name: "Назначение", is_required: true, dictionary_id: 102 },
    ],
    attributeValuesById: {
      4958: [{ id: 91, value: "женский" }],
    },
    productText: "1688 标题：女士用品 women",
  })[0];
  assert.deepEqual(purposePlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests capacity and count dictionary candidates only", () => {
  const capacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9011, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9011: [
        { id: 101, value: "500 мл" },
        { id: 102, value: "1 л" },
      ],
    },
    productText: "1688 参数：容量 500ml，透明水杯",
  })[0];

  assert.equal(capacityPlan.action, "suggest_dictionary");
  assert.equal(capacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(capacityPlan.dictionaryCandidates, [{
    dictionaryValueId: 101,
    value: "500 мл",
    confidence: 0.68,
    source: "capacity_synonym",
  }]);

  const countPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9012, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9012: [
        { id: 111, value: "5 шт" },
        { id: 112, value: "10 шт" },
      ],
    },
    productText: "1688 标题：10件套厨房收纳夹 10pcs",
  })[0];

  assert.equal(countPlan.action, "suggest_dictionary");
  assert.equal(countPlan.dictionaryValueId, undefined);
  assert.deepEqual(countPlan.dictionaryCandidates, [{
    dictionaryValueId: 112,
    value: "10 шт",
    confidence: 0.68,
    source: "count_synonym",
  }]);

  const materialPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
    ],
    attributeValuesById: {
      777: [{ id: 121, value: "500 мл" }],
    },
    productText: "1688 参数：容量 500ml",
  })[0];
  assert.deepEqual(materialPlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests size package and scenario dictionary candidates only", () => {
  const sizePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9013, name: "Размер", is_required: true, dictionary_id: 108 },
    ],
    attributeValuesById: {
      9013: [
        { id: 131, value: "10 см" },
        { id: 132, value: "20 см" },
      ],
    },
    productText: "1688 参数：尺寸 10cm，小号收纳盒",
  })[0];

  assert.equal(sizePlan.action, "suggest_dictionary");
  assert.equal(sizePlan.dictionaryValueId, undefined);
  assert.deepEqual(sizePlan.dictionaryCandidates, [{
    dictionaryValueId: 131,
    value: "10 см",
    confidence: 0.68,
    source: "size_synonym",
  }]);

  const packagePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9014, name: "Количество в упаковке", is_required: true, dictionary_id: 109 },
    ],
    attributeValuesById: {
      9014: [
        { id: 141, value: "3 шт" },
        { id: 142, value: "5 шт" },
      ],
    },
    productText: "1688 标题：3-pack 一包3个旅行收纳瓶",
  })[0];

  assert.equal(packagePlan.action, "suggest_dictionary");
  assert.equal(packagePlan.dictionaryValueId, undefined);
  assert.deepEqual(packagePlan.dictionaryCandidates, [{
    dictionaryValueId: 141,
    value: "3 шт",
    confidence: 0.68,
    source: "package_count_synonym",
  }]);

  const scenarioPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9015, name: "Сценарий использования", is_required: true, dictionary_id: 110 },
    ],
    attributeValuesById: {
      9015: [
        { id: 151, value: "для путешествий" },
        { id: 152, value: "для офиса" },
      ],
    },
    productText: "1688 标题：旅行收纳包 travel organizer",
  })[0];

  assert.equal(scenarioPlan.action, "suggest_dictionary");
  assert.equal(scenarioPlan.dictionaryValueId, undefined);
  assert.deepEqual(scenarioPlan.dictionaryCandidates, [{
    dictionaryValueId: 151,
    value: "для путешествий",
    confidence: 0.7,
    source: "scenario_synonym",
  }]);

  const materialPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
    ],
    attributeValuesById: {
      777: [{ id: 161, value: "для путешествий" }],
    },
    productText: "1688 标题：旅行 travel",
  })[0];
  assert.deepEqual(materialPlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests size dimension combinations only from current dictionary", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9016, name: "Размер", is_required: true, dictionary_id: 111 },
    ],
    attributeValuesById: {
      9016: [
        { id: 171, value: "10 x 20 см" },
        { id: 172, value: "20 x 30 см" },
      ],
    },
    productText: "1688 参数：尺寸 10x20cm，适合桌面收纳",
  })[0];

  assert.equal(plan.action, "suggest_dictionary");
  assert.equal(plan.dictionaryValueId, undefined);
  assert.deepEqual(plan.dictionaryCandidates, [{
    dictionaryValueId: 171,
    value: "10 x 20 см",
    confidence: 0.68,
    source: "size_synonym",
  }]);

  const noMatch = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9016, name: "Размер", is_required: true, dictionary_id: 111 },
    ],
    attributeValuesById: {
      9016: [{ id: 173, value: "30 x 40 см" }],
    },
    productText: "1688 参数：尺寸 10*20 см",
  })[0];
  assert.deepEqual(noMatch.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests home car and school scenario candidates only", () => {
  const scenarioPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9017, name: "Сценарий использования", is_required: true, dictionary_id: 112 },
    ],
    attributeValuesById: {
      9017: [
        { id: 181, value: "для дома" },
        { id: 182, value: "для автомобиля" },
        { id: 183, value: "для школы" },
        { id: 184, value: "для путешествий" },
      ],
    },
    productText: "1688 标题：家用车载学生收纳盒 home car school organizer",
  })[0];

  assert.equal(scenarioPlan.action, "suggest_dictionary");
  assert.equal(scenarioPlan.dictionaryValueId, undefined);
  assert.deepEqual(scenarioPlan.dictionaryCandidates, [
    {
      dictionaryValueId: 181,
      value: "для дома",
      confidence: 0.7,
      source: "scenario_synonym",
    },
    {
      dictionaryValueId: 182,
      value: "для автомобиля",
      confidence: 0.7,
      source: "scenario_synonym",
    },
    {
      dictionaryValueId: 183,
      value: "для школы",
      confidence: 0.7,
      source: "scenario_synonym",
    },
  ]);

  const typePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8229, name: "Тип", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      8229: [{ id: 185, value: "для дома" }],
    },
    productText: "1688 标题：home 家用",
  })[0];
  assert.deepEqual(typePlan.dictionaryCandidates, []);
});

test("buildListingPayloadDraftFromJob applies explainable pricing policy fields", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01007",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/7.html",
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
    pricingPolicy: {
      targetProfitRate: 0.3,
      minimumProfitRate: 0.08,
      minimumProfitCny: 3,
      oldPriceMode: "promo_multiplier",
      oldPriceMultiplier: 1.6,
    },
  });

  const item = draft.items[0];
  assert.equal(item.old_price, String(draft.summary.pricingDiagnosis.oldPriceCny));
  assert.equal(item.min_price, String(draft.summary.pricingDiagnosis.minPriceCny));
  assert.equal(draft.summary.pricingDiagnosis.oldPriceSource.mode, "promo_multiplier");
  assert.equal(draft.summary.pricingDiagnosis.minPriceSource.mode, "minimum_profit_floor");
  assert.equal(draft.summary.pricingDiagnosis.pricingPolicy.oldPriceMultiplier, 1.6);
});
