import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CATEGORY_READ_ENDPOINTS,
  buildCategoryReadContinuationPlan,
  buildCategoryReadPlanBinding,
  buildCategoryReadPlanSummary,
  buildCategoryReadRequests,
  classifyCategoryMetadataResponse,
  classifyCategoryValuesResponse,
  requiredDictionaryAttributeIds,
  summarizeCategoryReadObservations,
  validateCategoryReadAttributeScope,
  validateCategoryReadPlan,
  validateCategoryReadPlanBinding,
} from "../src/categoryReadPlan.js";

const plan = {
  store: { id: "2367028-1" },
  environment: "seller-production-cn-1-2026-07-17",
  descriptionCategoryId: 17028673,
  typeId: 95183,
  attributeIds: [85, 9048, 10097],
  language: "ZH_HANS",
};

const categoryFixtureRoot = path.join(process.cwd(), "test", "fixtures", "ozon", "category-read");

test("category read contract fixtures are explicitly mocked and cover success plus empty values", async () => {
  const files = [
    "tree.success.mocked.json",
    "attributes.success.mocked.json",
    "values.empty.mocked.json",
  ];
  for (const file of files) {
    const fixture = JSON.parse(await fs.readFile(path.join(categoryFixtureRoot, file), "utf8"));
    assert.equal(fixture.fixtureKind, "mocked_redacted_category_read", file);
    assert.equal(fixture.synthetic, true, file);
    assert.equal(fixture.redacted, true, file);
    assert.equal(fixture.verificationLevel, "mocked", file);
    assert.doesNotMatch(JSON.stringify(fixture), /api[_-]?key|client[_-]?secret|authorization|token/i, file);
    assert.ok(Array.isArray(fixture.result), file);
  }
  const emptyValues = JSON.parse(await fs.readFile(path.join(categoryFixtureRoot, "values.empty.mocked.json"), "utf8"));
  assert.deepEqual(emptyValues.result, []);
  assert.equal(emptyValues.has_next, false);
});

test("category read plan requires real category/type/attribute parameters", () => {
  const result = validateCategoryReadPlan({ store: plan.store, environment: plan.environment });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "CATEGORY_READ_CATEGORY_REQUIRED"));
  assert.ok(result.errors.some((item) => item.code === "CATEGORY_READ_ATTRIBUTE_REQUIRED"));
});

test("metadata phase can read current-store tree and attributes before dictionary ids are known", () => {
  const metadataPlan = { ...plan, phase: "metadata", attributeIds: [] };
  const validation = validateCategoryReadPlan(metadataPlan);
  const result = buildCategoryReadRequests(metadataPlan);

  assert.equal(validation.ok, true);
  assert.equal(validation.phase, "metadata");
  assert.deepEqual(result.requests.map((item) => item.key), ["tree", "attributes"]);
  assert.notEqual(buildCategoryReadPlanBinding(metadataPlan), buildCategoryReadPlanBinding(plan));
});

test("required dictionary ids are derived from current attribute evidence only", () => {
  const attributes = [
    { id: 85, is_required: true, dictionary_id: 28732849 },
    { id: 9163, is_required: true, dictionary_id: 320 },
    { id: 9048, is_required: true, dictionary_id: 0 },
    { id: 8229, is_required: true, dictionary_id: 1960 },
    { id: 9048, is_required: false, dictionary_id: 99 },
    { id: 85, is_required: true, dictionary_id: 28732849 },
  ];
  assert.deepEqual(requiredDictionaryAttributeIds(attributes), [85, 9163, 8229]);
  assert.deepEqual(buildCategoryReadContinuationPlan(
    { ...plan, phase: "metadata", attributeIds: [], untrusted: "drop-me", store: { id: plan.store.id, apiKey: "drop-me" } },
    attributes,
  )?.attributeIds, [85, 9163, 8229]);
  assert.deepEqual(Object.keys(buildCategoryReadContinuationPlan(
    { ...plan, phase: "metadata", attributeIds: [], untrusted: "drop-me" },
    attributes,
  )).sort(), ["attributeIds", "descriptionCategoryId", "environment", "language", "phase", "store", "typeId"]);
  assert.equal(buildCategoryReadContinuationPlan(
    { ...plan, phase: "metadata", attributeIds: [] },
    [{ id: 9048, is_required: true, dictionary_id: 0 }],
  ), null);
  assert.equal(validateCategoryReadAttributeScope(
    { ...plan, phase: "complete", attributeIds: [85, 9163, 8229] },
    attributes,
  ).ok, true);
  assert.equal(validateCategoryReadAttributeScope(
    { ...plan, phase: "complete", attributeIds: [85, 8229] },
    attributes,
  ).ok, false);
});

test("category read plan binding is stable and excludes credentials", () => {
  const binding = buildCategoryReadPlanBinding(plan);
  assert.match(binding, /^sha256:[a-f0-9]{64}$/);
  assert.equal(validateCategoryReadPlanBinding(plan, binding).ok, true);
  assert.equal(validateCategoryReadPlanBinding({ ...plan, typeId: 95184 }, binding).ok, false);
  assert.doesNotMatch(JSON.stringify(buildCategoryReadPlanSummary(plan)), /apiKey|seller-production-cn/);
});

test("category read requests use endpoint-specific bodies", () => {
  const result = buildCategoryReadRequests(plan);
  assert.equal(result.ok, true);
  assert.equal(result.requests[0].endpoint, CATEGORY_READ_ENDPOINTS.tree);
  assert.deepEqual(result.requests[0].body, { language: "ZH_HANS" });
  const attributes = result.requests.find((item) => item.key === "attributes");
  assert.deepEqual(attributes.body, { description_category_id: 17028673, type_id: 95183, language: "ZH_HANS" });
  const values = result.requests.filter((item) => item.key === "values");
  assert.equal(values.length, 3);
  assert.equal(values[0].body.attribute_id, 85);
});

test("dictionary value pages with has_next remain partial evidence", () => {
  assert.deepEqual(classifyCategoryValuesResponse({ result: [{ id: 1, value: "A" }], has_next: true }), {
    recognized: true,
    hasNext: true,
    paginationComplete: false,
    status: "partial",
  });
  assert.equal(classifyCategoryValuesResponse({ result: [], has_next: false }).status, "completed");
  assert.equal(classifyCategoryValuesResponse({ result: { items: [] } }).status, "unknown");
});

test("tree and attributes require a recognized array envelope", () => {
  assert.deepEqual(classifyCategoryMetadataResponse({ result: [] }), {
    recognized: true,
    status: "success",
  });
  assert.deepEqual(classifyCategoryMetadataResponse({ result: { items: [] } }), {
    recognized: false,
    status: "unknown",
  });
  assert.equal(classifyCategoryMetadataResponse({}).status, "unknown");
});

test("completed dictionary observations count as successful category evidence", () => {
  assert.deepEqual(summarizeCategoryReadObservations([
    { key: "tree", status: "success" },
    { key: "attributes", status: "success" },
    { key: "values", status: "completed" },
  ]), {
    complete: true,
    status: "completed",
    failures: [],
  });

  const partial = summarizeCategoryReadObservations([
    { key: "tree", status: "success" },
    { key: "values", status: "partial" },
  ]);
  assert.equal(partial.complete, false);
  assert.equal(partial.status, "partial");
  assert.equal(partial.failures.length, 1);
});
