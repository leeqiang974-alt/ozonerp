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
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
    ],
  });

  assert.equal(diagnosis.status, "blocked");
  assert.equal(diagnosis.blockedReasons.some((reason) => reason.code === "DICTIONARY_VALUE_INVALID"), true);
  assert.equal(diagnosis.nextActions.includes("为字典属性选择当前类目合法的 dictionary_value_id"), true);
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
