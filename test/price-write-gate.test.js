import test from "node:test";
import assert from "node:assert/strict";
import { buildPriceDiff, reconcilePriceWriteReadback, validatePriceWritePreflight } from "../src/priceWriteGate.js";

const evidence = (items = [{ offer_id: "SKU-1", price: "100", old_price: "120", min_price: "80", currency_code: "RUB" }]) => ({
  verificationLevel: "server_observed",
  checkedAt: new Date().toISOString(),
  readEvidence: { readStatus: "completed", hasNext: false, safeToConclude: true },
  items,
  priceSource: { mode: "seller_api_current", verificationLevel: "server_observed" },
});

test("price preflight blocks without server-observed current evidence or confirmation", () => {
  const result = validatePriceWritePreflight({ prices: [{ offer_id: "SKU-1", price: "110" }] });
  assert.equal(result.executable, false);
  assert.ok(result.blockers.includes("DIRECT_WRITE_PRICE_EVIDENCE_SERVER_REQUIRED"));
  assert.ok(result.blockers.includes("DIRECT_WRITE_PRICE_CONFIRMATION_REQUIRED"));
});

test("price preflight returns a structured diff and blocks unknown source/risk", () => {
  const result = validatePriceWritePreflight({
    prices: [{ offer_id: "SKU-1", price: "110", old_price: "130", min_price: "90" }],
    evidence: { ...evidence(), priceSource: undefined },
    confirm: true,
  });
  assert.equal(result.executable, false);
  assert.deepEqual(result.diff[0].changes.price, { before: 100, after: 110 });
  assert.ok(result.risks.some((risk) => risk.code === "PRICE_SOURCE_UNKNOWN"));
  assert.ok(result.blockers.includes("DIRECT_WRITE_PRICE_RISK_BLOCKED"));
});

test("price preflight permits confirmed safe diff and readback only matches target", () => {
  const target = [{ offer_id: "SKU-1", price: "110", old_price: "130", min_price: "90", priceSource: { mode: "seller_api_current", verificationLevel: "server_observed" } }];
  const result = validatePriceWritePreflight({ prices: target, evidence: evidence(), confirm: true });
  assert.equal(result.executable, true);
  assert.equal(reconcilePriceWriteReadback({ prices: target, evidence: evidence([{ offer_id: "SKU-1", price: "110", old_price: "130", min_price: "90", currency_code: "RUB" }]) }).status, "reconciled");
  assert.equal(reconcilePriceWriteReadback({ prices: target, evidence: evidence() }).status, "needs_review");
});

test("price diff records missing exact offer instead of assuming zero/current", () => {
  const result = buildPriceDiff([{ offer_id: "SKU-1", price: "100" }], [{ offer_id: "SKU-2", price: "110" }]);
  assert.deepEqual(result.missing, ["offer:SKU-2"]);
  assert.equal(result.diff.length, 0);
});
