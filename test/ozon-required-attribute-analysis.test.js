import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeRequiredAttributes,
  buildRequiredAttributeFillPlan,
  buildRequiredAttributeManualBacklog,
  buildRequiredAttributeRuleCandidateHistory,
  buildRequiredAttributeRuleCandidateIndex,
  classifyAttributeFillStrategy,
} from "../src/ozonRequiredAttributeAnalysis.js";

test("classifyAttributeFillStrategy maps common required Ozon fields", () => {
  assert.equal(classifyAttributeFillStrategy({ id: 85, name: "品牌", is_required: true }).strategy, "fixed_no_brand");
  assert.equal(classifyAttributeFillStrategy({ id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true }).strategy, "model_name_from_parent_sku");
  assert.equal(classifyAttributeFillStrategy({
    id: 9048,
    name: "型号名称（针对合并为一张商品卡片）",
    description: "填写品牌内部的模型名称。",
    is_required: true,
  }).strategy, "model_name_from_parent_sku");
  assert.equal(classifyAttributeFillStrategy({ id: 10097, name: "颜色", is_required: true, is_aspect: true, dictionary_id: 123 }).strategy, "variant_aspect_from_sku");
  assert.equal(classifyAttributeFillStrategy({ id: 999, name: "Страна-изготовитель", is_required: true, dictionary_id: 321 }).strategy, "fixed_country_china");
  assert.equal(classifyAttributeFillStrategy({
    id: 4389,
    name: "原产国",
    description: "品牌商品的生产国家。",
    is_required: true,
    dictionary_id: 1935,
  }).strategy, "fixed_country_china");
  assert.notEqual(classifyAttributeFillStrategy({
    id: 23487,
    name: "Производитель",
    description: "Название производителя товара.",
    is_required: true,
    dictionary_id: 1935,
  }).strategy, "fixed_country_china");
  assert.equal(classifyAttributeFillStrategy({ id: 777, name: "Материал", is_required: true, dictionary_id: 456 }).strategy, "dictionary_lookup_from_product_text");
  assert.equal(classifyAttributeFillStrategy({ id: 9011, name: "Объем", is_required: true, dictionary_id: 106 }).strategy, "dictionary_lookup_from_product_text");
  assert.equal(classifyAttributeFillStrategy({ id: 9012, name: "Количество предметов", is_required: true, dictionary_id: 107 }).strategy, "dictionary_lookup_from_product_text");
});

test("analyzeRequiredAttributes summarizes required fields from cached category attributes", () => {
  const result = analyzeRequiredAttributes({
    updatedAt: "2026-06-27T00:00:00.000Z",
    flat: [
      { description_category_id: 10, type_id: 20, path: "宠物用品 / 宠物餐具", name: "宠物饮水器" },
      { description_category_id: 11, type_id: 21, path: "家居 / 收纳", name: "收纳盒" },
    ],
    attributes: {
      "10:20": [
        { id: 85, name: "品牌", is_required: true, dictionary_id: 0 },
        { id: 10097, name: "颜色", is_required: true, is_aspect: true, dictionary_id: 999 },
        { id: 200, name: "可选说明", is_required: false },
      ],
      "11:21": [
        { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      ],
    },
    attributeValues: {
      "10:20:10097:ZH_HANS": { values: [{ id: 1, value: "白色" }] },
    },
  });

  assert.equal(result.summary.categoryTypeCount, 2);
  assert.equal(result.summary.categoriesWithCachedAttributes, 2);
  assert.equal(result.summary.requiredAttributeRows, 3);
  assert.equal(result.summary.dictionaryRequiredRows, 1);
  assert.equal(result.summary.dictionaryValuesCachedRows, 1);
  assert.equal(result.rows.find((row) => row.attributeId === 85).strategy, "fixed_no_brand");
  assert.equal(result.strategySummary.variant_aspect_from_sku, 1);
});

test("buildRequiredAttributeRuleCandidateIndex surfaces dictionary suggestions as read-only rule candidates", () => {
  const categoryMatch = { description_category_id: 17028673, type_id: 95183, path: "Дом / Кухня" };
  const fillPlan = buildRequiredAttributeFillPlan({
    categoryMatch,
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 100 },
      { id: 777, name: "Материал", is_required: true, dictionary_id: 200 },
      { id: 23487, name: "Производитель", is_required: true, dictionary_id: 300 },
    ],
    attributeValuesById: {
      85: [{ id: 1001, value: "Нет бренда" }],
      777: [{ id: 7771, value: "Пластик" }],
    },
    productText: "1688 ABS plastic kitchen organizer, no licensed brand.",
  });
  const manualBacklog = buildRequiredAttributeManualBacklog(fillPlan);
  const index = buildRequiredAttributeRuleCandidateIndex({
    categoryMatch,
    manualBacklog,
    fillPlan,
  });

  const materialCandidate = index.candidates.find((candidate) => candidate.attributeId === 777);
  assert.equal(index.readOnly, true);
  assert.equal(materialCandidate.source, "required_attribute_dictionary_candidate");
  assert.equal(materialCandidate.action, "suggest_dictionary");
  assert.equal(materialCandidate.ruleStatus, "candidate");
  assert.equal(materialCandidate.requiresHumanApproval, true);
  assert.equal(materialCandidate.readOnly, true);
  assert.deepEqual(materialCandidate.forbiddenEffects, ["payload_write", "ozon_submit", "rule_auto_enable"]);
  assert.match(materialCandidate.safeNextStep, /不会自动写 Payload/);
  assert.deepEqual(materialCandidate.candidateValues, [{
    dictionaryValueId: 7771,
    value: "Пластик",
    confidence: 0.72,
    source: "material_synonym",
  }]);
  assert.equal(index.candidates.some((candidate) => candidate.attributeId === 85), false);
  assert.equal(index.candidates.some((candidate) => candidate.attributeId === 23487 && candidate.action === "suggest_dictionary"), false);
});

test("buildRequiredAttributeRuleCandidateHistory preserves dictionary candidate values for review", () => {
  const sampleIndex = {
    categoryKey: "17028673:95183",
    categoryPath: "Дом / Кухня",
    candidates: [{
      attributeId: 777,
      attributeName: "Материал",
      categoryKey: "17028673:95183",
      source: "required_attribute_dictionary_candidate",
      candidateValues: [{
        dictionaryValueId: 7771,
        value: "Пластик",
        confidence: 0.72,
        source: "material_synonym",
      }],
      readOnly: true,
    }],
  };

  const history = buildRequiredAttributeRuleCandidateHistory([
    { sourceProductId: "SKU-1", sourceRunId: "run-1", index: sampleIndex },
    { sourceProductId: "SKU-2", sourceRunId: "run-2", index: sampleIndex },
  ]);

  const item = history.reviewQueue[0];
  assert.equal(item.ruleStatus, "ready_for_review");
  assert.deepEqual(item.candidateValues, [{
    dictionaryValueId: 7771,
    value: "Пластик",
    confidence: 0.72,
    source: "material_synonym",
    occurrenceCount: 2,
  }]);
  assert.deepEqual(Object.keys(item).filter((key) => /payload|submit|action/i.test(key)), []);
});
