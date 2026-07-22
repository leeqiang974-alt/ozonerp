import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CATEGORY_READ_ENDPOINTS,
  buildCategoryReadPlanBinding,
  buildCategoryReadPlanSummary,
  buildCategoryReadRequests,
  classifyCategoryValuesResponse,
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
