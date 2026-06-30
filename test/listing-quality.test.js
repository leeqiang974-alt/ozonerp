import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseListingQuality } from "../src/listingQuality.js";

test("diagnoseListingQuality blocks required dictionary attributes without dictionary value ids", () => {
  const diagnosis = diagnoseListingQuality({
    payload: {
      items: [{
        offer_id: "SKU-dict",
        name: "Кормушка для кошек",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
        attributes: [
          { id: 85, values: [{ value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "SKU-dict" }] },
        ],
      }],
    },
    attrsMeta: [
      {
        id: 85,
        name: "Бренд",
        is_required: true,
        dictionary_id: 971082,
        dictionary_values: [
          { id: 971082, value: "Нет бренда" },
          { id: 123456, value: "Acme" },
        ],
      },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });

  assert.equal(diagnosis.status, "blocked");
  const reason = diagnosis.blockedReasons.find((item) => item.code === "DICTIONARY_VALUE_INVALID");
  assert.ok(reason);
  assert.deepEqual(reason.enteredValues, ["Нет бренда"]);
  assert.equal(reason.dictionaryCandidates[0].dictionary_value_id, 971082);
  assert.equal(reason.dictionaryCandidates[0].value, "Нет бренда");
  assert.equal(reason.dictionaryCandidates[0].source, "attrs_meta_dictionary");
  assert.ok(reason.dictionaryCandidates[0].confidence >= 0.9);
  assert.equal(diagnosis.nextActions.includes("为字典属性选择当前类目合法的 dictionary_value_id"), true);
});

test("diagnoseListingQuality blocks dictionary value ids outside the current category cache", () => {
  const diagnosis = diagnoseListingQuality({
    payload: {
      items: [{
        offer_id: "SKU-dict-invalid-id",
        name: "Кормушка для кошек",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 999999, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "SKU-dict-invalid-id" }] },
        ],
      }],
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
    dictionaryValueCache: {
      "17028673:95183:85:ZH_HANS": {
        values: [
          { id: 971082, value: "Нет бренда" },
          { id: 123456, value: "Acme" },
        ],
      },
      "999:888:85:ZH_HANS": {
        values: [{ id: 999999, value: "Wrong category brand" }],
      },
    },
  });

  const reason = diagnosis.blockedReasons.find((item) => item.code === "DICTIONARY_VALUE_INVALID");
  assert.equal(diagnosis.status, "blocked");
  assert.ok(reason);
  assert.deepEqual(reason.enteredValues, ["#999999 Нет бренда"]);
  assert.equal(reason.dictionaryCandidates[0].dictionary_value_id, 971082);
  assert.equal(reason.dictionaryCandidates.some((item) => item.dictionary_value_id === 999999), false);
});

test("diagnoseListingQuality keeps warning-only detail image advice non-blocking", () => {
  const diagnosis = diagnoseListingQuality({
    payload: {
      items: [{
        offer_id: "SKU-images",
        name: "Кормушка для кошек",
        description_category_id: 17028673,
        type_id: 95183,
        price: "1200",
        images: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
        attributes: [
          { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
          { id: 9048, values: [{ value: "SKU-images" }] },
        ],
      }],
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });

  assert.equal(diagnosis.status, "warning");
  assert.equal(diagnosis.blockedReasons.length, 0);
  assert.equal(diagnosis.warnings.some((warning) => warning.code === "DETAIL_IMAGES_TOO_FEW"), true);
});

test("diagnoseListingQuality explains Ozon content score by media, attributes, description, and package", () => {
  const diagnosis = diagnoseListingQuality({
    payload: {
      items: [
        {
          offer_id: "SKU-red",
          name: "Игрушка для кошек красная",
          description_category_id: 17028673,
          type_id: 95183,
          price: "1200",
          images: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
          attributes: [
            { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
            { id: 9048, values: [{ value: "Cat toy" }] },
            { id: 10097, values: [{ value: "красный" }] },
          ],
        },
        {
          offer_id: "SKU-blue",
          name: "Игрушка для кошек синяя",
          description_category_id: 17028673,
          type_id: 95183,
          price: "1200",
          images: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
          attributes: [
            { id: 85, values: [{ dictionary_value_id: 971082, value: "Нет бренда" }] },
            { id: 9048, values: [{ value: "Cat toy" }] },
            { id: 10097, values: [{ value: "синий" }] },
          ],
        },
      ],
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    contentSummary: {
      descriptionLength: 42,
      richContentReady: false,
      skuVariantCount: 2,
      sizeWeightReady: false,
    },
  });

  assert.equal(diagnosis.status, "warning");
  assert.ok(diagnosis.score < 100);
  assert.equal(diagnosis.scoreBreakdown.media.status, "warning");
  assert.equal(diagnosis.scoreBreakdown.media.score, 70);
  assert.equal(diagnosis.scoreBreakdown.attributes.status, "ready");
  assert.equal(diagnosis.scoreBreakdown.description.status, "warning");
  assert.equal(diagnosis.scoreBreakdown.package.status, "warning");
  assert.ok(diagnosis.warnings.some((warning) => warning.code === "SKU_IMAGES_NOT_UNIQUE"));
  assert.ok(diagnosis.warnings.some((warning) => warning.code === "DESCRIPTION_TOO_SHORT"));
  assert.ok(diagnosis.warnings.some((warning) => warning.code === "RICH_CONTENT_MISSING"));
  assert.ok(diagnosis.warnings.some((warning) => warning.code === "PACKAGE_SIZE_WEIGHT_MISSING"));
  assert.ok(diagnosis.nextActions.some((action) => /SKU 图/.test(action)));
  assert.ok(diagnosis.nextActions.some((action) => /尺重/.test(action)));
});
