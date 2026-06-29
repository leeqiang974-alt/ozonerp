import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAttributeEntries } from "../src/listingRules.js";

test("normalizes both legacy array attributes and external object attributes", () => {
  assert.deepEqual(normalizeAttributeEntries([
    { name: "Материал", value: "Металл" },
    { attribute_name: "Цвет", attribute_value: "Белый" },
  ]), [
    { name: "Материал", value: "Металл" },
    { name: "Цвет", value: "Белый" },
  ]);
  assert.deepEqual(normalizeAttributeEntries({ Материал: "Металл", Цвет: "Белый" }), [
    { name: "Материал", value: "Металл" },
    { name: "Цвет", value: "Белый" },
  ]);
  assert.deepEqual(normalizeAttributeEntries(null), []);
});
