import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLazyContentAttributeValues,
  buildListingDescription,
  buildMarketingAttributes,
  normalizeOzonTitleForListing,
  getOzonImagePrepareLimit,
  isOzonImageOcrEnabledForListing,
  existingParentSkuForListing,
  minPriceFromPrice,
  variantAspectAttributes,
  modelAttributesForMeta,
  variantOfferId,
  dedupeSubmitItemsByOfferId,
  mergeVariantListingAttributes,
  mergeRetryModelAttributes,
  findDuplicateListingJob,
  importFeedbackState,
  shouldAutoRetryImport,
  splitImportWarningsAndErrors,
  selectPreparedOzonImages,
} from "../src/autoListing.js";

test("modelAttributesForMeta uses only the category model attribute", () => {
  const attrs = modelAttributesForMeta("Брелок Котик", [
    { id: 9048, name: "Другое поле" },
    { id: 22390, name: "Название модели (для объединения в одну карточку)", is_required: true },
  ]);

  assert.deepEqual(attrs, [{
    id: 22390,
    complex_id: 0,
    values: [{ value: "Брелок Котик" }],
  }]);
});
import { classifyOzonImageText } from "../src/imageOss.js";

test("buildListingDescription wires product description into Ozon annotation text", () => {
  const result = buildListingDescription({
    title_ru: "Автокормушка для кошек и собак",
    description_ru: "Автоматическая подача корма и воды для ежедневного ухода за питомцем.",
    annotation_ru: "",
  }, "fallback");

  assert.match(result, /Автоматическая подача корма/);
  assert.ok(result.length > 40);
});

test("buildMarketingAttributes fills dynamic annotation and tags attributes from category metadata", () => {
  const attrs = buildMarketingAttributes({
    description_ru: "Практичная миска на подставке для корма и воды.",
    hashtags_ru: "#миска #кормушка #питомцы",
    rich_content_json: JSON.stringify({ content: [{ widgetName: "raTextBlock", text: { content: ["x"] } }], version: 0.3 }),
  }, [
    { id: 9001, name: "简介" },
    { id: 9002, name: "#主题标签" },
    { id: 9003, name: "JSON 富内容" },
  ]);

  assert.equal(attrs.find((a) => a.id === 9001)?.values[0].value, "Практичная миска на подставке для корма и воды.");
  assert.equal(attrs.find((a) => a.id === 9002)?.values[0].value, "#миска #кормушка #питомцы");
  assert.ok(attrs.find((a) => a.id === 9003)?.values[0].value.includes("raTextBlock"));
});

test("buildMarketingAttributes normalizes concatenated hashtags for Ozon validation", () => {
  const attrs = buildMarketingAttributes({
    description_ru: "Мягкий брелок в виде котенка.",
    hashtags_ru: "#брелок#плюшевый#подарокдевушке#оченьдлинныйхештегкоторыйнадообрезать",
  }, [
    { id: 9002, name: "#Хештеги" },
  ]);
  const tags = attrs.find((a) => a.id === 9002)?.values[0].value || "";
  const parts = tags.split(/\s+/).filter(Boolean);

  assert.deepEqual(parts.slice(0, 3), ["#брелок", "#плюшевый", "#подарокдевушке"]);
  assert.ok(parts.every((tag) => tag.startsWith("#") && tag.length <= 30));
});

test("selectPreparedOzonImages uses translated/clean images and drops skipped OCR results", () => {
  const selected = selectPreparedOzonImages([
    { sourceUrl: "https://example.com/factory.jpg", skipped: true, reason: "factory_intro" },
    { sourceUrl: "https://example.com/chinese.jpg", url: "https://oss.example.com/chinese-ru.jpg", translated: true },
    { sourceUrl: "https://example.com/plain.jpg", url: "https://oss.example.com/plain.jpg" },
  ], ["https://example.com/fallback.jpg"]);

  assert.deepEqual(selected, [
    "https://oss.example.com/chinese-ru.jpg",
    "https://oss.example.com/plain.jpg",
  ]);
});

test("default Ozon image preparation keeps enough photos for content rating", () => {
  assert.equal(getOzonImagePrepareLimit(), 8);
});

test("Ozon listing image OCR stays enabled by default", () => {
  assert.equal(isOzonImageOcrEnabledForListing(), true);
});

test("existingParentSkuForListing reuses the same SKU across retries", () => {
  assert.equal(existingParentSkuForListing({ pendingParentSku: "SKUlq00999" }), "SKUlq00999");
  assert.equal(existingParentSkuForListing({ listingResult: { sku: "SKUlq00888" } }), "SKUlq00888");
  assert.equal(existingParentSkuForListing({}), "");
});

test("minPriceFromPrice floors decimal prices and subtracts one from integer prices", () => {
  assert.equal(minPriceFromPrice(25.2), "25");
  assert.equal(minPriceFromPrice(25), "24");
});

test("variantOfferId uses parent SKU plus Russian variant suffix", () => {
  assert.equal(
    variantOfferId("SKUlq00127", { spec: "马卡龙混色（约100根）" }, 0),
    "SKUlq00127-makaronnye-tsveta-miks-tsvetov-100-sht"
  );
});

test("variantOfferId keeps rose dome cover materials unique for same color", () => {
  assert.notEqual(
    variantOfferId("SKUlq00128", { spec: "原木单支绒布玫瑰+花瓣红色>玻璃罩" }, 0),
    variantOfferId("SKUlq00128", { spec: "原木单支绒布玫瑰+花瓣红色>亚克力罩" }, 1)
  );
});

test("dedupeSubmitItemsByOfferId removes duplicate Ozon offer ids before stock queue", () => {
  const items = [
    { offer_id: "SKUlq00128-krasnyy", name: "glass red" },
    { offer_id: "SKUlq00128-krasnyy", name: "acrylic red" },
    { offer_id: "SKUlq00128-zheltyy", name: "yellow" },
  ];

  assert.deepEqual(dedupeSubmitItemsByOfferId(items).map((item) => item.name), ["glass red", "yellow"]);
});

test("variantAspectAttributes fills Ozon aspect attributes from 1688 SKU spec", () => {
  const attrs = variantAspectAttributes({
    spec: "马卡龙混色（约100根）",
    lengthMm: 300,
  }, [
    { id: 10097, name: "颜色名称", is_aspect: true },
    { id: 4678, name: "长度，m", is_aspect: true, type: "Decimal" },
  ], 0);

  assert.equal(attrs.find((a) => a.id === 10097)?.values[0].value, "макаронные цвета микс цветов 100 шт");
  assert.equal(attrs.find((a) => a.id === 4678)?.values[0].value, "0.3");
});

test("variantAspectAttributes keeps cat keychain color variants distinct", () => {
  const attrsMeta = [{ id: 10097, name: "颜色名称", is_aspect: true }];
  const values = ["米色", "黑色", "白色", "黄色", "蓝色"].map((spec, index) =>
    variantAspectAttributes({ spec }, attrsMeta, index).find((a) => a.id === 10097)?.values[0].value
  );

  assert.deepEqual(values, ["бежевый", "черный", "белый", "желтый", "синий"]);
  assert.equal(new Set(values).size, values.length);
});

test("variantAspectAttributes maps dictionary aspect values from translated 1688 specs", () => {
  const attrsMeta = [{
    id: 10096,
    name: "Цвет товара",
    is_aspect: true,
    dictionary_id: 1494,
    dictionary_values: [
      { id: 1, value: "Белый" },
      { id: 2, value: "Синий" },
    ],
  }];

  const white = variantAspectAttributes({ spec: "白色" }, attrsMeta, 0);
  const blue = variantAspectAttributes({ spec: "蓝色" }, attrsMeta, 1);

  assert.deepEqual(white, [{ id: 10096, complex_id: 0, values: [{ dictionary_value_id: 1 }] }]);
  assert.deepEqual(blue, [{ id: 10096, complex_id: 0, values: [{ dictionary_value_id: 2 }] }]);
});

test("mergeVariantListingAttributes lets variant aspects override base attributes", () => {
  const merged = mergeVariantListingAttributes([
    { id: 10097, complex_id: 0, values: [{ value: "белый" }] },
    { id: 85, complex_id: 0, values: [{ value: "Нет бренда" }] },
  ], [
    { id: 10097, complex_id: 0, values: [{ value: "черный" }] },
  ]);

  assert.equal(merged.find((a) => a.id === 10097)?.values[0].value, "черный");
  assert.equal(merged.find((a) => a.id === 85)?.values[0].value, "Нет бренда");
});

test("mergeRetryModelAttributes preserves required non-model attributes", () => {
  const merged = mergeRetryModelAttributes([
    { id: 4958, complex_id: 0, values: [{ dictionary_value_id: 33754 }] },
    { id: 9048, complex_id: 0, values: [{ value: "old model" }] },
  ], { id: 85, complex_id: 0, values: [{ value: "Нет бренда" }] }, [
    { id: 9048, complex_id: 0, values: [{ value: "new model" }] },
    { id: 8229, complex_id: 0, values: [{ value: "new model" }] },
  ]);

  assert.equal(merged.find((a) => a.id === 4958)?.values[0].dictionary_value_id, 33754);
  assert.equal(merged.find((a) => a.id === 9048)?.values[0].value, "new model");
  assert.equal(merged.find((a) => a.id === 85)?.values[0].value, "Нет бренда");
});

test("buildLazyContentAttributeValues fills common optional attributes from 1688 and Ozon hints", () => {
  const attrs = buildLazyContentAttributeValues([
    { id: 9101, name: "Материал" },
    { id: 9102, name: "Упаковка" },
    { id: 9103, name: "Комплектация" },
    { id: 9104, name: "Особенности товара" },
  ], {
    lc: {
      title_ru: "Автоматическая кормушка для кошек",
      description_ru: "Практичная кормушка с антискользящей подставкой.",
    },
    productData: {
      attributes: [
        { name: "材质", value: "PP пластик" },
        { name: "包装", value: "袋装" },
      ],
    },
    ozonContext: {
      attributes: [
        { name: "Комплектация", value: "миска, подставка" },
      ],
    },
  });

  assert.equal(attrs.find((a) => a.id === 9101)?.values[0].value, "пластик");
  assert.match(attrs.find((a) => a.id === 9102)?.values[0].value || "", /пакет|袋/i);
  assert.equal(attrs.find((a) => a.id === 9103)?.values[0].value, "миска, подставка");
  assert.match(attrs.find((a) => a.id === 9104)?.values[0].value || "", /антискольз/i);
});

test("buildLazyContentAttributeValues reuses DeepSeek attributes_hint without extra AI calls", () => {
  const attrs = buildLazyContentAttributeValues([
    { id: 9201, name: "Материал" },
    { id: 9202, name: "Цвет" },
    { id: 9203, name: "Назначение" },
  ], {
    lc: {
      title_ru: "Мягкая игрушка-брелок",
      attributes_hint: {
        material: "плюш",
        color: "розовый",
        purpose: "для ключей и сумки",
      },
    },
  });

  assert.equal(attrs.find((a) => a.id === 9201)?.values[0].value, "плюш");
  assert.equal(attrs.find((a) => a.id === 9202)?.values[0].value, "розовый");
  assert.equal(attrs.find((a) => a.id === 9203)?.values[0].value, "для ключей и сумки");
});

test("buildLazyContentAttributeValues keeps numeric package fields numeric", () => {
  const attrs = buildLazyContentAttributeValues([
    { id: 9301, name: "Вес с упаковкой, г" },
    { id: 11650, name: "包装" },
    { id: 9303, name: "Упаковка" },
  ], {
    packageInfo: { weight: 120 },
    productData: {
      attributes: [{ name: "包装", value: "OPP袋" }],
    },
  });

  assert.equal(attrs.find((a) => a.id === 9301)?.values[0].value, "120");
  assert.equal(attrs.find((a) => a.id === 11650)?.values[0].value, "1");
  assert.equal(attrs.find((a) => a.id === 9303)?.values[0].value, "пакетная упаковка");
});

test("normalizeOzonTitleForListing rewrites silicone craft mold titles into natural Russian", () => {
  const title = normalizeOzonTitleForListing(
    "Силиконовая форма для цветов пион и камелия, DIY молд шоколада, выпечки, свечей, эпоксидной смолы гипса",
    {
      candidateTitle: "杜丹花diy山茶花花朵手工硅胶模具巧克力烘焙香薰蜡烛滴胶石膏模",
      ozonTitle: "Набор для творчества с эпоксидной смолой, Силиконовый молд",
    }
  );

  assert.equal(title, "Силиконовая форма Пион и камелия для свечей и изделий из эпоксидной смолы");
  assert.doesNotMatch(title, /\bDIY\b|молд/i);
});

test("normalizeOzonTitleForListing removes Chinese fragments from cat keychain titles", () => {
  const title = normalizeOzonTitleForListing(
    "Брелок котёнок 3D, подвеска на сумку и ключи, милый卡通立体 из смолы",
    {
      candidateTitle: "软萌小猫咪钥匙扣卡通立体公仔挂件可爱背包包挂饰学生党摆件饰品",
      productType: "Брелок",
    }
  );

  assert.equal(title, "Брелок котёнок 3D подвеска на сумку и ключи милый из смолы");
  assert.doesNotMatch(title, /[\u3400-\u9fff]/);
});

test("splitImportWarningsAndErrors does not block imported products with warnings only", () => {
  const result = splitImportWarningsAndErrors([
    { level: "warning", code: "BR_hashtag_validation", message: "warning" },
    { level: "WARNING", code: "VALUE_MUST_BE_INTEGER", message: "warning" },
  ]);

  assert.equal(result.blockingErrors.length, 0);
  assert.equal(result.warnings.length, 2);
});

test("splitImportWarningsAndErrors treats failed variant grouping as a listing defect", () => {
  const defect = {
    level: "warning",
    code: "double_without_merger_offer",
    message: "Cannot merge products because variable characteristics are identical",
  };
  const result = splitImportWarningsAndErrors([defect]);

  assert.equal(result.blockingErrors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.listingDefects, [defect]);
});

test("importFeedbackState keeps imported variant grouping defects out of live state", () => {
  const state = importFeedbackState({
    importedItems: [{ product_id: 88 }],
    listingDefects: [{ code: "double_without_merger_offer" }],
  });

  assert.deepEqual(state, {
    status: "needs_review",
    stage: "listing_defect",
    reasonCode: "VARIANT_GROUPING_FAILED",
  });
});

test("shouldAutoRetryImport never collapses a multi-variant batch into one item", () => {
  const modelError = [{ code: "ATTRIBUTE_REQUIRED", message: "Название модели обязательное поле" }];

  assert.equal(shouldAutoRetryImport(5, modelError), false);
  assert.equal(shouldAutoRetryImport(1, modelError), true);
});

test("findDuplicateListingJob blocks repeated Ozon or 1688 product submissions", () => {
  const jobs = [
    {
      id: "old_live",
      status: "live",
      ozonUrl: "https://www.ozon.ru/product/foo-123/?utm=1",
      bestMatch: { candidateUrl: "https://detail.1688.com/offer/100.html?spm=a" },
      listingResult: { sku: "SKU001" },
    },
    {
      id: "failed_old",
      status: "failed",
      ozonUrl: "https://www.ozon.ru/product/bar-456/",
      bestMatch: { candidateUrl: "https://detail.1688.com/offer/200.html" },
    },
  ];

  assert.equal(findDuplicateListingJob({
    id: "new",
    ozonUrl: "https://www.ozon.ru/product/foo-123/",
    bestMatch: { candidateUrl: "https://detail.1688.com/offer/999.html" },
  }, jobs)?.id, "old_live");

  assert.equal(findDuplicateListingJob({
    id: "new",
    ozonUrl: "https://www.ozon.ru/product/other-999/",
    bestMatch: { candidateUrl: "https://detail.1688.com/offer/100.html" },
  }, jobs)?.id, "old_live");

  assert.equal(findDuplicateListingJob({
    id: "new",
    ozonUrl: "https://www.ozon.ru/product/bar-456/",
    bestMatch: { candidateUrl: "https://detail.1688.com/offer/200.html" },
  }, jobs), null);
});

test("classifyOzonImageText blocks delivery, return, and factory text in Chinese or Russian", () => {
  assert.deepEqual(classifyOzonImageText("Бесплатная доставка Производство, завод"), {
    hasChinese: false,
    isFactoryIntro: true,
    hasOzonPolicyText: true,
  });
  assert.deepEqual(classifyOzonImageText("厂家直销 包邮 支持退货"), {
    hasChinese: true,
    isFactoryIntro: true,
    hasOzonPolicyText: true,
  });
});
