import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  selectBestMatchForOzon,
  validatePaidAiCandidateSourceBinding,
} from "../src/autoListing.js";

test("paid AI reruns recheck actual job after model return and preserve source binding", async () => {
  const source = await readFile(new URL("../src/autoListing.js", import.meta.url), "utf8");
  const listingLlmSource = await readFile(new URL("../src/llmListing.js", import.meta.url), "utf8");
  const matchStart = source.indexOf("export async function rerunAutoListingMatch");
  const contentStart = source.indexOf("export async function rerunAutoListingContent");
  const match = source.slice(matchStart, contentStart);
  const content = source.slice(contentStart, source.indexOf("export function deriveNewSourceKeywords", contentStart));

  assert.match(match, /postMatchJob = await getAutoListingJob/);
  assert.match(match, /validatePaidAiJobBinding\(postMatchJob/);
  assert.match(match, /validatePaidAiCandidateSourceBinding/);
  assert.match(match, /updateJobIfPaidAiBindingMatches/);
  assert.match(match, /sourceEvidence: postMatchJob\.candidateData\?\.sourceEvidence/);
  assert.match(content, /claimPaidAiContentWork\(jobId, options\.expectedBinding/);
  assert.match(content, /contentGenerationContextForJob/);
  assert.doesNotMatch(content, /缺少已匹配候选/);
  assert.match(content, /paidAiContentLease\?\.token/);
  assert.match(content, /paidAiContentInputHash\(currentJob \|\| \{\}\) === claim\.inputHash/);
  assert.match(content, /commitPaidAiGeneratedContent/);
  assert.match(content, /finalizePaidAiContentWork/);
  assert.match(content, /invalidatePayloadDraftValidation\(job\.workflowRunId, "paid_ai_content_context_changed"\)/);
  assert.match(content, /paidAiCalled: true/);
  assert.match(content, /claim\.mode === "reuse"/);
  assert.match(content, /reusedPaidAiContent: true/);
  assert.match(content, /paidAiCalled: false/);
  assert.ok(
    content.indexOf("claimPaidAiContentWork(jobId, options.expectedBinding")
      < content.indexOf("generateListingContentWithLlm"),
  );
  assert.match(content, /CONTENT_GENERATION_OUTCOME_UNCERTAIN/);
  const uncertainStart = content.indexOf('reasonCode: "CONTENT_GENERATION_OUTCOME_UNCERTAIN"');
  const uncertainEnd = content.indexOf("if (!listingResult.enabled)", uncertainStart);
  assert.doesNotMatch(content.slice(uncertainStart, uncertainEnd), /releasePaidAiContentWork/);
  assert.match(listingLlmSource, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(listingLlmSource, /MAX_LISTING_LLM_TIMEOUT_MS = 5 \* 60 \* 1000/);
});

test("paid AI candidate binding rejects the same candidate id when its snapshot changed", () => {
  const expected = {
    captureId: "capture_1",
    storeId: "store_1",
    sourceSnapshotHash: "sha256:old",
  };
  const candidate = {
    id: "cc_1",
    captureId: "capture_1",
    storeId: "store_1",
    parsed: {
      sourceEvidence: {
        snapshotHash: "sha256:new",
      },
    },
  };

  const result = validatePaidAiCandidateSourceBinding(candidate, expected);

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "PAID_AI_MATCH_CHANGED_SOURCE");
  assert.equal(result.actualBinding.captureId, "capture_1");
  assert.equal(result.actualBinding.storeId, "store_1");
  assert.equal(result.actualBinding.sourceSnapshotHash, "sha256:new");
});

test("paid AI candidate binding requires capture, store, and snapshot to match", () => {
  const expected = {
    captureId: "capture_1",
    storeId: "store_1",
    sourceSnapshotHash: "sha256:bound",
  };
  const candidate = {
    id: "cc_1",
    captureId: "capture_1",
    storeId: "store_1",
    parsed: {
      sourceEvidence: {
        snapshotHash: "sha256:bound",
      },
    },
  };

  assert.deepEqual(
    validatePaidAiCandidateSourceBinding(candidate, expected),
    {
      ok: true,
      binding: expected,
    },
  );
  assert.equal(
    validatePaidAiCandidateSourceBinding({
      id: "cc_1",
      captureId: "capture_1",
      storeId: "store_1",
    }, expected).ok,
    false,
  );
});

test("paid AI candidate binding ignores crawler record id and rejects missing or conflicting captureId", () => {
  const expected = {
    captureId: "capture_1",
    storeId: "store_1",
    sourceSnapshotHash: "sha256:bound",
  };
  const base = {
    id: "cc_internal",
    storeId: "store_1",
    parsed: {
      sourceEvidence: {
        snapshotHash: "sha256:bound",
      },
    },
  };

  assert.equal(validatePaidAiCandidateSourceBinding(base, expected).ok, false);
  assert.equal(validatePaidAiCandidateSourceBinding({
    ...base,
    captureId: "capture_2",
  }, expected).ok, false);
  assert.equal(validatePaidAiCandidateSourceBinding({
    ...base,
    captureId: "capture_1",
  }, expected).ok, true);
});

test("paid AI candidate binding requires the persisted outer store scope", () => {
  const expected = {
    captureId: "capture_1",
    storeId: "store_1",
    sourceSnapshotHash: "sha256:bound",
  };
  const base = {
    id: "cc_internal",
    captureId: "capture_1",
    parsed: {
      storeId: "store_1",
      sourceEvidence: {
        snapshotHash: "sha256:bound",
      },
    },
  };

  assert.equal(validatePaidAiCandidateSourceBinding(base, expected).ok, false);
  assert.equal(validatePaidAiCandidateSourceBinding({
    ...base,
    storeId: "store_1",
  }, expected).ok, true);
  assert.equal(validatePaidAiCandidateSourceBinding({
    ...base,
    storeId: "store_1",
    parsed: {
      ...base.parsed,
      storeId: "store_2",
    },
  }, expected).ok, false);
});

test("selectBestMatchForOzon picks profitable same-family candidate without submitting", async () => {
  const ozonItem = {
    id: "oz_1",
    title: "Автокормушка для кошек и собак",
    category: "товары для животных",
    price: 2500,
  };
  const candidates = [
    {
      id: "bad_1",
      title: "金属钥匙扣 礼品",
      priceMin: 8,
      parsed: { sizeWeight: { weightG: 50, lengthMm: 80, widthMm: 40, heightMm: 20 } },
    },
    {
      id: "good_1",
      title: "宠物 自动喂食器 猫 狗 饮水碗",
      priceMin: 18,
      score: 90,
      parsed: {
        sizeWeight: { weightG: 220, lengthMm: 160, widthMm: 120, heightMm: 90 },
        images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
        skuVariants: [{ spec: "白色", price: 18 }],
      },
    },
  ];

  const result = await selectBestMatchForOzon(ozonItem, candidates, { aiLimit: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.bestMatch.candidate.id, "good_1");
  assert.equal(result.evaluatedCount, 2);
  assert.equal(result.rejected.length, 1);
  assert.ok(result.bestMatch.profit.margin >= 0);
});
