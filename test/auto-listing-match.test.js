import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSourcingCandidate, filterSourcingCandidates, localJudgeMatch, shouldUseAiMatch } from "../src/autoListing.js";

test("shouldUseAiMatch limits expensive per-candidate AI matching", () => {
  assert.equal(shouldUseAiMatch(0, 3), true);
  assert.equal(shouldUseAiMatch(2, 3), true);
  assert.equal(shouldUseAiMatch(3, 3), false);
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
