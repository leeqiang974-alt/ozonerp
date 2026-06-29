import test from "node:test";
import assert from "node:assert/strict";
import { matchCandidatesWithOpportunities } from "../src/crawler1688.js";

test("matchCandidatesWithOpportunities runs without missing llmConfig dependency", async () => {
  const result = await matchCandidatesWithOpportunities([
    { id: "opp1", title: "Игрушка для собак", category: "宠物用品", price: 1200 },
  ], [
    { id: "cand1", title: "狗狗玩具批发", priceMin: 10, priceMax: 12, riskLevel: "low" },
  ], { useLlm: false });

  assert.ok(result);
  assert.ok(Array.isArray(result.matches));
});
