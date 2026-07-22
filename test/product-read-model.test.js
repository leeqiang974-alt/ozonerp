import test from "node:test";
import assert from "node:assert/strict";
import { buildProductReadEvidence } from "../src/productReadModel.js";

test("price read contract keeps pagination partial and never claims safe conclusion", () => {
  const evidence = buildProductReadEvidence({ result: { items: [{ product_id: 11, price: "100" }], last_id: "next" } }, { kind: "prices" });
  assert.equal(evidence.readStatus, "partial");
  assert.equal(evidence.hasNext, true);
  assert.equal(evidence.safeToConclude, false);
  assert.ok(evidence.missingEvidence.includes("pagination"));
});

test("empty recognized price page is empty, not a failed or zero-priced page", () => {
  const evidence = buildProductReadEvidence({ result: { items: [], has_next: false } }, { kind: "prices" });
  assert.equal(evidence.readStatus, "empty");
  assert.equal(evidence.rowCount, 0);
  assert.equal(evidence.safeToConclude, false);
});

test("price evidence does not treat reference-only fields as current price", () => {
  const evidence = buildProductReadEvidence({ items: [{ product_id: 12, old_price: "120", min_price: "80" }] }, { kind: "prices" });
  assert.equal(evidence.readStatus, "partial");
  assert.ok(evidence.missingEvidence.includes("prices_value:0"));
  assert.equal(evidence.safeToConclude, false);
});

test("unrecognized or field-missing stock fixtures stay unknown/partial", () => {
  const unknown = buildProductReadEvidence({ result: { items: null } }, { kind: "stocks" });
  assert.equal(unknown.readStatus, "unknown");
  assert.equal(unknown.safeToConclude, false);
  const partial = buildProductReadEvidence({ items: [{ product_id: 22 }] }, { kind: "stocks" });
  assert.equal(partial.readStatus, "partial");
  assert.ok(partial.missingEvidence.includes("stocks_value:0"));
  assert.equal(partial.safeToConclude, false);
});
