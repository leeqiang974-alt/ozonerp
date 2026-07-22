import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildProcurementEvidenceSummary, evaluateSourcingCandidate, filterSourcingCandidates, listingDraftStoreMatches, localJudgeMatch, shouldUseAiMatch } from "../src/autoListing.js";

test("shouldUseAiMatch limits expensive per-candidate AI matching", () => {
  assert.equal(shouldUseAiMatch(0, 3), true);
  assert.equal(shouldUseAiMatch(2, 3), true);
  assert.equal(shouldUseAiMatch(3, 3), false);
});

test("listing draft reuse requires the requested store binding", () => {
  assert.equal(listingDraftStoreMatches({ storeId: "store-a" }, "store-a"), true);
  assert.equal(listingDraftStoreMatches({ storeId: "store-a" }, "store-b"), false);
  assert.equal(listingDraftStoreMatches({}, "store-b"), false);
  assert.equal(listingDraftStoreMatches({ storeId: "store-a" }, ""), true);
});

test("submitted reconciliation surfaces an unavailable store instead of leaving the job stuck", async () => {
  const source = await readFile(fileURLToPath(new URL("../src/autoListing.js", import.meta.url)), "utf8");
  const start = source.indexOf("export async function reconcileSubmittedJobs");
  const end = source.indexOf("export async function", start + 30);
  const body = source.slice(start, end > start ? end : start + 5000);
  assert.match(body, /listingResult\?\.storeId \|\| job\?\.storeId/);
  assert.match(body, /LISTING_STORE_UNAVAILABLE/);
  assert.match(body, /提交结果无法回查/);
  assert.match(body, /submitted task with a missing store/);
  assert.doesNotMatch(body, /return Number\(j\?\.listingResult\?\.taskId \|\| 0\) > 0 && storeId;/);
});

test("localJudgeMatch identifies same-family pet products without LLM", () => {
  const result = localJudgeMatch(
    { title: "Игрушка для собак мелких пород" },
    { title: "狗狗咬咬乐宠物玩具批发" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.match, true);
  assert.ok(result.confidence >= 35);
});

test("localJudgeMatch rejects plush cat keychain versus metal enamel keychain", () => {
  const result = localJudgeMatch(
    { title: "Брелок сувенирный котик мягкая игрушка антистресс плюшевый мягкий котенок" },
    { title: "烤漆锌合金钥匙扣定制卡通珐琅金属钥匙扣明星应援礼品钥匙链挂件" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.match, false);
  assert.match(result.reason, /材质冲突/);
});

test("evaluateSourcingCandidate keeps only extra small low-SKU products", () => {
  assert.equal(evaluateSourcingCandidate({
    skuCount: 5,
    parsed: {
      sizeWeight: { weightG: 380, lengthMm: 180, widthMm: 120, heightMm: 60 },
      skuVariants: Array.from({ length: 5 }, (_, i) => ({ skuId: String(i + 1) })),
    },
  }).ok, true);

  assert.equal(evaluateSourcingCandidate({
    parsed: {
      sizeWeight: { weightG: 380, lengthMm: 180, widthMm: 120, heightMm: 60 },
      skuVariants: Array.from({ length: 6 }, (_, i) => ({ skuId: String(i + 1) })),
    },
  }).reasonCode, "SKU_TOO_MANY");

  assert.equal(evaluateSourcingCandidate({
    parsed: {
      sizeWeight: { weightG: 401, lengthMm: 180, widthMm: 120, heightMm: 60 },
      skuVariants: [{ skuId: "1" }],
    },
  }).reasonCode, "WEIGHT_TOO_HEAVY");

  assert.equal(evaluateSourcingCandidate({
    parsed: {
      sizeWeight: { weightG: 300, lengthMm: 400, widthMm: 320, heightMm: 160 },
      skuVariants: [{ skuId: "1" }],
    },
  }).reasonCode, "NOT_EXTRA_SMALL");
});

test("filterSourcingCandidates returns accepted candidates and rejection reasons", () => {
  const result = filterSourcingCandidates([
    { id: "ok", parsed: { sizeWeight: { weightG: 120, lengthMm: 100, widthMm: 80, heightMm: 40 }, skuVariants: [{ skuId: "1" }] } },
    { id: "bad", parsed: { sizeWeight: { weightG: 800, lengthMm: 100, widthMm: 80, heightMm: 40 }, skuVariants: [{ skuId: "1" }] } },
  ]);

  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].id, "ok");
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].gate.reasonCode, "WEIGHT_TOO_HEAVY");
});

test("sourcing gate keeps procurement evidence visible without rejecting the candidate", () => {
  const result = evaluateSourcingCandidate({
    parsed: {
      sizeWeight: { weightG: 120, lengthMm: 100, widthMm: 80, heightMm: 40 },
      skuVariants: [{ skuId: "1" }],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.procurement.status, "unknown");
  assert.equal(result.procurement.code, "PROCUREMENT_EVIDENCE_NOT_CAPTURED");
  assert.match(result.procurement.nextAction, /MOQ/);
});

test("procurement summary distinguishes observed, manual review and missing evidence", () => {
  const base = {
    parsed: {
      procurementEvidence: {
        supplierName: { value: "供应商", source: "page_content" },
        moq: { value: 2, source: "page_content" },
        priceTiers: { values: [{ minQuantity: 2, unitPriceCny: 3 }], source: "page_content" },
      },
    },
  };
  assert.equal(buildProcurementEvidenceSummary(base).status, "observed");
  assert.equal(buildProcurementEvidenceSummary({ parsed: { procurementEvidence: {
    supplierName: { value: "手填", source: "manual_seller" },
    moq: { value: 2, source: "manual_seller" },
    priceTiers: { values: [{ minQuantity: 2, unitPriceCny: 3 }], source: "manual_seller" },
  } } }).status, "needs_review");
  assert.deepEqual(buildProcurementEvidenceSummary({ parsed: { procurementEvidence: {} } }).missing, ["supplier", "moq", "price_tiers"]);
});
