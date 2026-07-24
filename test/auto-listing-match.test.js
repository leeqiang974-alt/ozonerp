import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applyManualSellerInputsToJob, buildAutomaticPricingPreviewFromCapture, buildProcurementEvidenceSummary, evaluateSourcingCandidate, filterSourcingCandidates, listingDraftStoreMatches, localJudgeMatch, shouldUseAiMatch } from "../src/autoListing.js";

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

test("snapshot-bound 1688 SKU prices are sufficient procurement evidence without duplicate supplier entry", () => {
  const snapshotHash = `sha256:${"8".repeat(64)}`;
  const evidenceRef = `snapshot:${"8".repeat(64)}`;
  const candidate = {
    parsed: {
      source: "1688",
      sourceEvidence: {
        platform: "1688",
        verificationState: "ok",
        snapshotHash,
        fields: {
          variants: { source: "capture_hint", evidenceRef, count: 2, skuIds: ["sku-a", "sku-b"] },
        },
      },
      procurementEvidence: {
        supplierId: { value: "", source: "missing", evidenceRef: "" },
        supplierName: { value: "", source: "missing", evidenceRef: "" },
        moq: { value: null, source: "missing", evidenceRef: "" },
        priceTiers: { values: [], source: "missing", evidenceRef: "" },
      },
      skuVariants: [
        { skuId: "sku-a", price: 2.3 },
        { skuId: "sku-b", price: 2.6 },
      ],
    },
  };

  const summary = buildProcurementEvidenceSummary(candidate);
  assert.equal(summary.status, "observed");
  assert.equal(summary.code, "PROCUREMENT_SKU_PRICE_SNAPSHOT_OBSERVED");
  assert.equal(summary.sourceMode, "sku_price_snapshot");
  assert.equal(summary.evidenceRef, evidenceRef);
  assert.deepEqual(summary.missing, []);
  assert.equal(summary.skuPriceCount, 2);

  const preview = buildAutomaticPricingPreviewFromCapture({
    source: "1688",
    candidateData: {
      ...candidate.parsed,
      sizeWeight: { weightG: 1, lengthMm: 1, widthMm: 1, heightMm: 1 },
      sourceEvidence: {
        ...candidate.parsed.sourceEvidence,
        fields: {
          ...candidate.parsed.sourceEvidence.fields,
          package: {
            source: "capture_hint",
            evidenceRef,
            values: { weightG: 1, lengthMm: 1, widthMm: 1, heightMm: 1 },
          },
        },
      },
    },
    bestMatch: { purchasePriceCny: 2.6 },
  }, { description_category_id: 17027899, type_id: 87458886, path: "胸针" });
  assert.equal(preview.autoStarted, true);
  assert.equal(preview.sourcePriceCny, 2.6);
  assert.equal(preview.packageInfoSource, "1688_package");
  assert.deepEqual(preview.package, {
    weightG: 1,
    lengthMm: 1,
    widthMm: 1,
    heightMm: 1,
  });
  assert.equal(preview.procurementEvidence.verificationState, "source_verified");
  assert.ok(preview.priceCny > 0);
});

test("combined seller input validation is all-or-nothing and rejects stale product bindings", () => {
  const snapshotHash = `sha256:${"a".repeat(64)}`;
  const job = {
    id: "job-1",
    candidateId: "capture-1",
    storeId: "store-1",
    workflowRunId: "run-1",
    candidateData: {
      sourceEvidence: { snapshotHash },
      skuVariants: [{ skuId: "sku-1", weightG: 900 }],
    },
  };
  const procurement = {
    supplierName: "供应商",
    moq: 2,
    priceTiers: [{ minQuantity: 2, unitPriceCny: 3 }],
  };
  const missingBinding = applyManualSellerInputsToJob(job, { procurement });
  assert.equal(missingBinding.ok, false);
  assert.equal(missingBinding.reasonCode, "MANUAL_SELLER_INPUT_BINDING_REQUIRED");
  const partialBinding = applyManualSellerInputsToJob(job, {
    expectedBinding: { captureId: "capture-1", storeId: "store-1", sourceSnapshotHash: snapshotHash },
    procurement,
  });
  assert.equal(partialBinding.ok, false);
  assert.equal(partialBinding.reasonCode, "MANUAL_SELLER_INPUT_BINDING_REQUIRED");

  const invalid = applyManualSellerInputsToJob(job, {
    expectedBinding: {
      captureId: "capture-1",
      storeId: "store-1",
      sourceSnapshotHash: snapshotHash,
      workflowRunId: "run-1",
    },
    procurement,
    package: { source: "manual_measurement", weightG: 100, lengthMm: 0, widthMm: 80, heightMm: 20 },
  });
  assert.equal(invalid.ok, false);
  assert.equal(job.candidateData.procurementEvidence, undefined);
  assert.equal(job.candidateData.skuVariants[0].weightG, 900);
  assert.equal(job.listingContent, undefined);

  const stale = applyManualSellerInputsToJob(job, {
    expectedBinding: {
      captureId: "capture-1",
      storeId: "store-1",
      sourceSnapshotHash: `sha256:${"b".repeat(64)}`,
      workflowRunId: "run-1",
    },
    procurement,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reasonCode, "MANUAL_SELLER_INPUT_STALE");
  assert.equal(job.candidateData.procurementEvidence, undefined);
});

test("combined seller input applies manual content with procurement and package in one job mutation", () => {
  const snapshotHash = `sha256:${"d".repeat(64)}`;
  const applied = applyManualSellerInputsToJob({
    id: "job-content",
    candidateId: "capture-content",
    storeId: "store-content",
    workflowRunId: "run-content",
    listingContent: {},
    candidateData: {
      sourceEvidence: { snapshotHash },
      skuVariants: [{ skuId: "sku-content" }],
    },
  }, {
    expectedBinding: {
      captureId: "capture-content",
      storeId: "store-content",
      sourceSnapshotHash: snapshotHash,
      workflowRunId: "run-content",
    },
    content: {
      title_ru: "Брошь мультяшная",
      description_ru: "Декоративная брошь для одежды и рюкзака.",
    },
    procurement: {
      supplierName: "供应商",
      moq: 2,
      priceTiers: [{ minQuantity: 2, unitPriceCny: 3 }],
    },
    package: {
      source: "supplier_package",
      weightG: 100,
      lengthMm: 100,
      widthMm: 80,
      heightMm: 20,
    },
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.job.listingContent.title_ru, "Брошь мультяшная");
  assert.equal(applied.job.listingContent.contentSource, "manual_seller");
  assert.equal(applied.job.candidateData.procurementEvidence.moq.value, 2);
  assert.equal(applied.job.candidateData.sizeWeight.weightG, 100);
});

test("manual package evidence is bound to the current capture and replaces every SKU package value", () => {
  const snapshotHash = `sha256:${"c".repeat(64)}`;
  const applied = applyManualSellerInputsToJob({
    id: "job-2",
    candidateId: "capture-2",
    storeId: "store-2",
    workflowRunId: "run-2",
    candidateData: {
      sourceEvidence: { snapshotHash },
      sizeWeight: { weightG: 900, lengthMm: 900, widthMm: 700, heightMm: 300 },
      skuVariants: [
        { skuId: "sku-a", weightG: 900, lengthMm: 900, widthMm: 700, heightMm: 300 },
        { skuId: "sku-b", weightG: 800, lengthMm: 800, widthMm: 600, heightMm: 200 },
      ],
    },
  }, {
    expectedBinding: {
      captureId: "capture-2",
      storeId: "store-2",
      sourceSnapshotHash: snapshotHash,
      workflowRunId: "run-2",
    },
    package: {
      source: "manual_measurement",
      weightG: 100,
      lengthMm: 100,
      widthMm: 80,
      heightMm: 20,
    },
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.job.candidateData.sizeWeight.weightG, 100);
  assert.deepEqual(
    applied.job.candidateData.skuVariants.map((row) => [row.weightG, row.lengthMm, row.widthMm, row.heightMm]),
    [[100, 100, 80, 20], [100, 100, 80, 20]],
  );
  assert.deepEqual(applied.job.candidateData.sizeWeight.manualEvidenceBinding, {
    captureId: "capture-2",
    storeId: "store-2",
    sourceSnapshotHash: snapshotHash,
    workflowRunId: "run-2",
  });
});
