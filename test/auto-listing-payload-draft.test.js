import test from "node:test";
import assert from "node:assert/strict";
import { applyManualSellerInputsToJob, buildListingPayloadDraftFromJob, categoryReadPolicyForListing, sourceEvidenceBindingForListing, sourceVariantsForListing } from "../src/autoListing.js";
import {
  buildRequiredAttributeManualBacklog,
  buildRequiredAttributeApprovalDraftPreview,
  buildRequiredAttributeFillPlan,
  buildRequiredAttributeRuleCandidateHistory,
  buildRequiredAttributeRuleCandidateIndex,
  summarizeRequiredAttributeFillPlan,
} from "../src/ozonRequiredAttributeAnalysis.js";
import { validateSubmitPayload } from "../src/workflowRuns.js";

test("1688 listing policy carries exact-store category read receipts into re-preflight", () => {
  const evidence = {
    checkedAt: new Date().toISOString(),
    statusCode: 200,
    verificationLevel: "server_observed",
    responseHash: `sha256:${"a".repeat(64)}`,
    storeId: "store-1",
    environmentRefHash: `sha256:${"b".repeat(64)}`,
  };
  const policy = categoryReadPolicyForListing({ source: "1688", storeId: "store-1" }, {
    categoryReadEvidence: {
      tree: evidence,
      attributes: { "10:20": { ...evidence, cacheKey: "10:20" } },
    },
  }, { description_category_id: 10, type_id: 20 });
  assert.equal(policy.categoryEvidenceRequired, true);
  assert.equal(policy.categoryEvidenceStoreId, "store-1");
  assert.equal(policy.categoryEvidence.attributes.cacheKey, "10:20");
  assert.equal(policy.categoryEvidenceEnvironmentRefHash, evidence.environmentRefHash);

  const missing = categoryReadPolicyForListing({ source: "1688" }, {}, { description_category_id: 10, type_id: 20 });
  assert.equal(missing.categoryEvidenceRequired, true);
  assert.equal(missing.categoryEvidenceStoreId, "");
  assert.equal(missing.categoryEvidence.tree, null);
});

test("sourceVariantsForListing preserves stable 1688 SKU ids for downstream binding", () => {
  const variants = sourceVariantsForListing("PARENT-1", [
    { skuId: "sku-white", spec: "白色", image: "https://example.com/white.jpg" },
    { sourceSkuId: "sku-blue", spec: "蓝色", image: "https://example.com/blue.jpg" },
  ]);
  assert.equal(variants[0].sourceSkuId, "sku-white");
  assert.equal(variants[1].sourceSkuId, "sku-blue");
  assert.equal(variants[0].source, "1688_sku_variant");
});

test("sourceVariantsForListing binds every generated offer to the current source snapshot", () => {
  const snapshotHash = `sha256:${"c".repeat(64)}`;
  const variants = sourceVariantsForListing("PARENT-2", [
    { skuId: "sku-white", spec: "白色", image: "https://example.com/white.jpg" },
  ], { snapshotHash });
  assert.equal(variants[0].offerId, "PARENT-2-belyy");
  assert.equal(variants[0].sourceSkuId, "sku-white");
  assert.equal(variants[0].sourceSnapshotHash, snapshotHash);
});

test("single-SKU payload binds the parent offer to its only 1688 source SKU", () => {
  const snapshotHash = `sha256:${"e".repeat(64)}`;
  const draft = buildListingPayloadDraftFromJob({
    id: "single-source-binding",
    source: "1688",
    pendingParentSku: "PARENT-SINGLE",
    listingContent: { title_ru: "Одно SKU", description_ru: "Описание" },
    candidateData: {
      title: "单 SKU 商品",
      url: "https://detail.1688.com/offer/single.html",
      sourceEvidence: { snapshotHash, canonicalUrl: "https://detail.1688.com/offer/single.html", verificationState: "ok" },
      skuVariants: [{ skuId: "SOURCE-SINGLE", spec: "颜色: 白色", price: 12, image: "https://example.com/single.jpg" }],
      images: ["https://example.com/main.jpg", "https://example.com/second.jpg"],
      detailImages: ["https://example.com/detail.jpg"],
      sizeWeight: { weightG: 400, lengthMm: 300, widthMm: 200, heightMm: 100 },
      procurementEvidence: { priceTiers: { values: [{ minQuantity: 1, unitPriceCny: 12 }], source: "page_content", evidenceRef: `snapshot:${snapshotHash.slice(7)}` } },
    },
    bestMatch: { candidateTitle: "单 SKU 商品", candidateUrl: "https://detail.1688.com/offer/single.html", purchasePriceCny: 12 },
  }, { categoryMatch: { description_category_id: 17028673, type_id: 95183, path: "fixture" }, parentSku: "PARENT-SINGLE", pricingPolicy: { commissionRate: 0.15, commissionSource: "controlled_fixture" } });
  assert.equal(draft.items.length, 1);
  assert.deepEqual(draft.summary.sourceVariants.map((row) => ({ offerId: row.offerId, sourceSkuId: row.sourceSkuId, spec: row.spec })), [{ offerId: "PARENT-SINGLE", sourceSkuId: "SOURCE-SINGLE", spec: "颜色: 白色" }]);
  assert.equal(draft.summary.sourceVariants[0].sourceSnapshotHash, snapshotHash);
});

test("payload draft carries a compact source snapshot binding beside Ozon items", () => {
  const snapshotHash = `sha256:${"d".repeat(64)}`;
  const binding = sourceEvidenceBindingForListing({
    snapshotHash,
    canonicalUrl: "https://detail.1688.com/offer/fixture.html",
    offerId: "fixture-offer",
    verificationState: "ok",
  }, [{ spec: "白色" }]);
  assert.deepEqual(binding, {
    source: "1688",
    status: "bound",
    snapshotHash,
    canonicalUrl: "https://detail.1688.com/offer/fixture.html",
    offerId: "fixture-offer",
    verificationState: "ok",
    variantCount: 1,
    nextAction: "预检会核对此快照与每个 Ozon SKU 的来源绑定。",
  });
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SOURCE-BOUND-1",
    listingContent: { title_ru: "Органайзер", description_ru: "Органайзер для дома и кухни." },
    bestMatch: { candidateTitle: "收纳盒", purchasePriceCny: 12 },
    candidateData: {
      source: "1688",
      sourceEvidence: { snapshotHash, canonicalUrl: "https://detail.1688.com/offer/fixture.html", verificationState: "ok" },
      images: ["https://example.com/main.jpg"],
      sizeWeight: { weightG: 200, lengthMm: 100, widthMm: 100, heightMm: 100 },
      skuVariants: [{ skuId: "fixture-white", spec: "白色", price: 12 }],
    },
  }, { categoryMatch: { description_category_id: 1, type_id: 2, path: "Хранение" } });
  assert.equal(draft.summary.sourceEvidence.status, "bound");
  assert.equal(draft.summary.sourceEvidence.snapshotHash, snapshotHash);
});

test("payload draft does not silently drop source SKUs when generated Offer IDs collide", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "COLLISION-1",
    listingContent: { title_ru: "Органайзер", description_ru: "Органайзер для дома." },
    bestMatch: { candidateTitle: "收纳盒", purchasePriceCny: 12 },
    candidateData: {
      source: "1688",
      images: ["https://example.com/main.jpg"],
      sizeWeight: { weightG: 200, lengthMm: 100, widthMm: 100, heightMm: 100 },
      skuVariants: [
        { skuId: "sku-white-long", spec: "白色", price: 12 },
        { skuId: "sku-white-short", spec: "白", price: 12 },
      ],
    },
  }, { categoryMatch: { description_category_id: 1, type_id: 2, path: "Хранение" } });

  assert.equal(draft.items.length, 2);
  assert.equal(draft.items[0].offer_id, draft.items[1].offer_id);
  assert.equal(draft.summary.variantOfferIdCollisions.length, 1);
  assert.equal(draft.summary.variantOfferIdCollisions[0].rows.length, 2);
});

test("buildListingPayloadDraftFromJob creates workflow payload draft without Ozon submit", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq00999",
    ozonTitle: "Автокормушка для кошек",
    listingContent: {
      title_ru: "Автоматическая кормушка для кошек",
      description_ru: "Удобная кормушка для домашних животных.",
      annotation: "Кормушка для ежедневного использования.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "宠物自动喂食器",
      candidateUrl: "https://detail.1688.com/offer/1.html",
      purchasePriceCny: 18,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 220, lengthMm: 160, widthMm: 120, heightMm: 90 },
      skuVariants: [],
      attributes: [{ name: "材质", value: "塑料" }],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Товары для животных",
    },
  });

  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].offer_id, "SKUlq00999");
  assert.equal(draft.items[0].description_category_id, 17028673);
  assert.equal(draft.items[0].type_id, 95183);
  assert.ok(draft.items[0].attributes.some((attribute) => Number(attribute.id) === 9048));
  assert.equal(draft.summary.pricingDiagnosis.packageInfoSource, "1688_package");
  assert.equal(draft.summary.pricingDiagnosis.profitStatus, "unknown");
  assert.equal(draft.summary.pricingDiagnosis.profitConclusion, "unknown_without_trusted_commission_and_settlement_rules");
  assert.equal(draft.summary.pricingDiagnosis.profitEvidence.settlement.status, "missing");
  assert.equal(validateSubmitPayload(draft).ok, true);
});

test("manual package measurement cannot inherit stale SKU dimensions in the payload", () => {
  const snapshotHash = `sha256:${"f".repeat(64)}`;
  const applied = applyManualSellerInputsToJob({
    id: "manual-package-payload",
    candidateId: "capture-package",
    storeId: "store-package",
    workflowRunId: "run-package",
    source: "1688",
    pendingParentSku: "MANUAL-PACKAGE-1",
    listingContent: {
      title_ru: "Значок для одежды",
      description_ru: "Металлический значок для одежды и рюкзака.",
    },
    bestMatch: { candidateTitle: "胸针", purchasePriceCny: 3 },
    candidateData: {
      source: "1688",
      url: "https://detail.1688.com/offer/manual-package.html",
      images: ["https://example.com/main.jpg"],
      sourceEvidence: { snapshotHash, verificationState: "ok" },
      sizeWeight: { weightG: 900, lengthMm: 900, widthMm: 700, heightMm: 300 },
      skuVariants: [
        { skuId: "sku-a", spec: "A", weightG: 900, lengthMm: 900, widthMm: 700, heightMm: 300 },
        { skuId: "sku-b", spec: "B", weightG: 800, lengthMm: 800, widthMm: 600, heightMm: 200 },
      ],
    },
  }, {
    expectedBinding: {
      captureId: "capture-package",
      storeId: "store-package",
      sourceSnapshotHash: snapshotHash,
      workflowRunId: "run-package",
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
  const draft = buildListingPayloadDraftFromJob(applied.job, {
    categoryMatch: { description_category_id: 17027899, type_id: 87458886, path: "胸针" },
    pricingPolicy: { commissionRate: 0.15, commissionSource: "controlled_fixture" },
  });
  assert.equal(draft.summary.pricingDiagnosis.packageInfoSource, "manual_measurement");
  assert.deepEqual(
    draft.items.map((item) => [item.weight, item.depth, item.width, item.height]),
    [[150, 120, 100, 40], [150, 120, 100, 40]],
  );

  const legacyMissingWorkflowBinding = structuredClone(applied.job);
  delete legacyMissingWorkflowBinding.candidateData.sizeWeight.manualEvidenceBinding.workflowRunId;
  assert.throws(() => buildListingPayloadDraftFromJob(legacyMissingWorkflowBinding, {
      categoryMatch: { description_category_id: 17027899, type_id: 87458886, path: "胸针" },
      pricingPolicy: { commissionRate: 0.15, commissionSource: "controlled_fixture" },
    }),
    /缺少可信尺重来源/,
  );
});

test("collected procurement evidence blocks trusted pricing when MOQ or tiers are missing", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKU-PROCUREMENT-RISK",
    ozonTitle: "Органайзер",
    listingContent: { title_ru: "Органайзер", description_ru: "Органайзер для дома." },
    bestMatch: { candidateTitle: "收纳盒", purchasePriceCny: 12 },
    candidateData: {
      source: "1688",
      url: "https://detail.1688.com/offer/123.html",
      images: ["https://example.com/a.jpg"],
      sizeWeight: { weightG: 200, lengthMm: 100, widthMm: 100, heightMm: 100 },
      skuVariants: [],
      procurementEvidence: {
        supplierId: { value: "supplier-1", source: "page_content" },
        supplierName: { value: "示例供应商", source: "page_content" },
        moq: { value: null, source: "missing" },
        priceTiers: { values: [], source: "missing" },
      },
    },
  }, {
    categoryMatch: { description_category_id: 1, type_id: 2, path: "Хранение" },
  });

  assert.equal(draft.summary.pricingDiagnosis.procurementEvidence.status, "blocked");
  assert.equal(draft.summary.pricingDiagnosis.procurementEvidence.reasonCode, "PRICING_PROCUREMENT_EVIDENCE_MISSING");
});

test("manual procurement values remain needs_review instead of masquerading as source facts", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKU-PROCUREMENT-MANUAL",
    ozonTitle: "Органайзер",
    listingContent: { title_ru: "Органайзер", description_ru: "Органайзер для дома." },
    bestMatch: { candidateTitle: "收纳盒", purchasePriceCny: 12 },
    candidateData: {
      source: "1688",
      sourceEvidence: { snapshotHash: `sha256:${"a".repeat(64)}` },
      sizeWeight: { weightG: 200, lengthMm: 100, widthMm: 100, heightMm: 100 },
      procurementEvidence: {
        verificationState: "manual_unverified",
        supplierName: { value: "手填供应商", source: "manual_seller", evidenceRef: "" },
        moq: { value: 5, source: "manual_seller", evidenceRef: "" },
        priceTiers: { values: [{ minQuantity: 5, unitPriceCny: 12 }], source: "manual_seller", evidenceRef: "" },
      },
    },
  }, { categoryMatch: { description_category_id: 1, type_id: 2, path: "Хранение" } });

  const evidence = draft.summary.pricingDiagnosis.procurementEvidence;
  assert.equal(evidence.status, "needs_review");
  assert.equal(evidence.verificationState, "manual_unverified");
  assert.equal(evidence.sourceBacked, false);
  assert.equal(evidence.reasonCode, "PRICING_PROCUREMENT_EVIDENCE_MANUAL_UNVERIFIED");
  assert.match(evidence.sellerAction, /来源快照|人工确认/);
  assert.equal(evidence.sideEffect, "不会提交 Ozon，不会修改价格或库存");
});

test("procurement values are verified only when refs bind to the candidate snapshot", () => {
  const hash = "b".repeat(64);
  const evidenceRef = `snapshot:${hash}`;
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKU-PROCUREMENT-SOURCE",
    ozonTitle: "Органайзер",
    listingContent: { title_ru: "Органайзер", description_ru: "Органайзер для дома." },
    bestMatch: { candidateTitle: "收纳盒", purchasePriceCny: 12 },
    candidateData: {
      source: "1688",
      sourceEvidence: { snapshotHash: `sha256:${hash}` },
      sizeWeight: { weightG: 200, lengthMm: 100, widthMm: 100, heightMm: 100 },
      procurementEvidence: {
        supplierName: { value: "页面供应商", source: "page_content", evidenceRef },
        moq: { value: 5, source: "page_content", evidenceRef },
        priceTiers: { values: [{ minQuantity: 5, unitPriceCny: 12 }], source: "page_content", evidenceRef },
      },
    },
  }, { categoryMatch: { description_category_id: 1, type_id: 2, path: "Хранение" } });

  const evidence = draft.summary.pricingDiagnosis.procurementEvidence;
  assert.equal(evidence.status, "verified");
  assert.equal(evidence.verificationState, "source_verified");
  assert.equal(evidence.sourceBacked, true);
  assert.equal(evidence.reasonCode, "");
});

test("capture hints remain unverified even when stored beside a snapshot", () => {
  const hash = "c".repeat(64);
  const evidenceRef = `snapshot:${hash}`;
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKU-PROCUREMENT-HINT",
    ozonTitle: "Органайзер",
    listingContent: { title_ru: "Органайзер", description_ru: "Органайзер для дома." },
    bestMatch: { candidateTitle: "收纳盒", purchasePriceCny: 12 },
    candidateData: {
      source: "1688",
      sourceEvidence: { snapshotHash: `sha256:${hash}` },
      sizeWeight: { weightG: 200, lengthMm: 100, widthMm: 100, heightMm: 100 },
      procurementEvidence: {
        supplierName: { value: "提示供应商", source: "capture_hint", evidenceRef },
        moq: { value: 5, source: "capture_hint", evidenceRef },
        priceTiers: { values: [{ minQuantity: 5, unitPriceCny: 12 }], source: "capture_hint", evidenceRef },
      },
    },
  }, { categoryMatch: { description_category_id: 1, type_id: 2, path: "Хранение" } });

  const evidence = draft.summary.pricingDiagnosis.procurementEvidence;
  assert.equal(evidence.status, "needs_review");
  assert.equal(evidence.verificationState, "manual_unverified");
});

test("buildListingPayloadDraftFromJob submits collected rich content only after detail asset approval", () => {
  const richContentJson = {
    content: [
      {
        widgetName: "raShowcase",
        type: "billboard",
        blocks: [{ img: { src: "https://example.com/detail-a.jpg", srcMobile: "https://example.com/detail-a.jpg", alt: "" } }],
      },
    ],
    version: 0.3,
  };
  const job = {
    pendingParentSku: "SKUlq00997",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/9.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
      richContentJson,
      mediaAssets: [{
        id: "media:detail-a",
        role: "detail",
        sourceUrl: "https://example.com/detail-a.jpg",
        sourceHash: `url-sha256:${"c".repeat(64)}`,
        evidenceRef: `snapshot:${"d".repeat(64)}`,
        checks: {
          humanApproved: true,
          ocr: { status: "clear" },
          dimensions: { status: "clear", width: 800, height: 800 },
          sourceRisk: "clear",
        },
      }],
      mediaIssues: [],
    },
  };
  const options = {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
  };
  const draft = buildListingPayloadDraftFromJob(job, options);

  const richContentAttribute = draft.items[0].attributes.find((attribute) => Number(attribute.id) === 11254);
  assert.ok(richContentAttribute);
  assert.equal(richContentAttribute.values[0].value, JSON.stringify(richContentJson));
  assert.equal(draft.summary.mediaReview.status, "approved_detail_assets");
  assert.equal(validateSubmitPayload(draft).ok, true);

  const unapproved = buildListingPayloadDraftFromJob({
    ...job,
    candidateData: {
      ...job.candidateData,
      mediaAssets: job.candidateData.mediaAssets.map((asset) => ({ ...asset, checks: { humanApproved: false } })),
      mediaIssues: ["detail_images_require_human_review_before_rich_content"],
    },
  }, options);
  assert.equal(unapproved.items[0].attributes.some((attribute) => Number(attribute.id) === 11254), false);
  assert.equal(unapproved.summary.mediaReview.status, "needs_confirmation");
  assert.deepEqual(unapproved.summary.mediaReview.issues, [
    "detail_images_require_human_review_before_rich_content",
    "collected_rich_content_requires_human_approval",
  ]);

  const stalePublished = buildListingPayloadDraftFromJob({
    ...job,
    candidateData: {
      ...job.candidateData,
      sourceEvidence: { snapshotHash: `sha256:${"a".repeat(64)}` },
      mediaApprovalPublished: {
        status: "stale",
        expectedDraftHash: `sha256:${"b".repeat(64)}`,
        expectedSourceHash: `sha256:${"a".repeat(64)}`,
      },
      mediaAssets: job.candidateData.mediaAssets.map((asset) => ({
        ...asset,
        evidenceRef: `snapshot:${"a".repeat(64)}`,
        checks: {
          humanApproved: true,
          approvalBinding: {
            status: "published_local",
            expectedDraftHash: `sha256:${"b".repeat(64)}`,
            expectedSourceHash: `sha256:${"a".repeat(64)}`,
          },
        },
      })),
    },
  }, options);
  assert.equal(stalePublished.items[0].attributes.some((attribute) => Number(attribute.id) === 11254), false);
  assert.equal(stalePublished.summary.mediaReview.status, "needs_confirmation");
  assert.equal(unapproved.summary.mediaReview.candidate, JSON.stringify(richContentJson));

  const explicitlyApproved = buildListingPayloadDraftFromJob({
    ...job,
    candidateData: {
      ...job.candidateData,
      mediaAssets: [],
      mediaIssues: ["detail_images_require_human_review_before_rich_content"],
      mediaApproval: {
        confirmed: true,
        confirmedAt: "2026-07-12T09:00:00.000Z",
        actorId: "operator-fixture",
      },
    },
  }, options);
  assert.equal(explicitlyApproved.items[0].attributes.some((attribute) => Number(attribute.id) === 11254), false);
  assert.equal(explicitlyApproved.summary.mediaReview.status, "needs_confirmation");

  const staleExplicitApproval = buildListingPayloadDraftFromJob({
    ...job,
    candidateData: {
      ...job.candidateData,
      sourceEvidence: { snapshotHash: `sha256:${"a".repeat(64)}`, verificationState: "ok" },
      mediaApproval: {
        confirmed: true,
        confirmedAt: "2026-07-12T09:00:00.000Z",
        actorId: "operator-fixture",
      },
      mediaAssets: job.candidateData.mediaAssets.map((asset) => ({
        ...asset,
        evidenceRef: `snapshot:${"b".repeat(64)}`,
        checks: {
          ...asset.checks,
          humanApproved: false,
        },
      })),
      mediaIssues: [],
    },
  }, options);
  assert.equal(staleExplicitApproval.items[0].attributes.some((attribute) => Number(attribute.id) === 11254), false);
  assert.equal(staleExplicitApproval.summary.mediaReview.status, "needs_confirmation");
  assert.ok(staleExplicitApproval.summary.mediaReview.compliance.blockers.some((blocker) => blocker.code === "MEDIA_SOURCE_SNAPSHOT_MISMATCH"));
});

test("buildListingPayloadDraftFromJob rejects PDD package evidence without trusted source", () => {
  assert.throws(() => buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq00998",
    ozonTitle: "Автокормушка для кошек",
    listingContent: {
      title_ru: "Автоматическая кормушка для кошек",
      description_ru: "Удобная кормушка для домашних животных.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "宠物自动喂食器",
      candidateUrl: "https://mobile.yangkeduo.com/goods.html?goods_id=1",
      purchasePriceCny: 18,
    },
    candidateData: {
      source: "pdd",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 220, lengthMm: 160, widthMm: 120, heightMm: 90 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Товары для животных",
    },
  }), /可信尺重来源/);
});

test("buildListingPayloadDraftFromJob marks learned Ozon commission source", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01000",
    ozonTitle: "Органайзер для кухни",
    ozonContext: {
      commissions: [{ sales_percent: 18 }],
    },
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/2.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
  });

  assert.equal(draft.summary.pricingDiagnosis.commissionRate, 0.18);
  assert.equal(draft.summary.pricingDiagnosis.commissionSource.source, "learned_product");
});

test("buildListingPayloadDraftFromJob autofills no-brand and China from current category dictionaries", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01001",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/3.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 4389, name: "Страна-изготовитель", is_required: true, dictionary_id: 970000 },
    ],
    attributeValuesById: {
      85: [{ id: 971082, value: "Нет бренда" }],
      4389: [{ id: 356971, value: "Китай" }],
    },
  });

  const attrs = draft.items[0].attributes;
  assert.equal(attrs.find((attribute) => Number(attribute.id) === 85)?.values[0].dictionary_value_id, 971082);
  assert.equal(attrs.find((attribute) => Number(attribute.id) === 4389)?.values[0].dictionary_value_id, 356971);
  assert.equal(draft.summary.requiredAttributeFillSummary.totalCount, 2);
  assert.equal(draft.summary.requiredAttributeFillSummary.autofillSafeCount, 2);
  assert.equal(draft.summary.requiredAttributeFillSummary.readinessStatus, "ready");
  assert.equal(draft.summary.requiredAttributeRuleCandidateHistory, undefined);
});

test("buildListingPayloadDraftFromJob does not guess dictionary ids for no-brand and China", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01002",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/4.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 4389, name: "Страна-изготовитель", is_required: true, dictionary_id: 970000 },
    ],
    attributeValuesById: {
      85: [{ id: 123, value: "Some brand" }],
      4389: [{ id: 456, value: "Россия" }],
    },
  });

  const attrs = draft.items[0].attributes;
  assert.equal(attrs.some((attribute) => Number(attribute.id) === 85), false);
  assert.equal(attrs.some((attribute) => Number(attribute.id) === 4389), false);
});

test("buildListingPayloadDraftFromJob reads high-confidence attributes from category cache", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01003",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/5.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    categoryCache: {
      attributes: {
        "17028673:95183": [
          { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
          { id: 4389, name: "Страна-изготовитель", is_required: true, dictionary_id: 970000 },
        ],
      },
      attributeValues: {
        "17028673:95183:85:ZH_HANS": { values: [{ id: 971082, value: "Нет бренда" }] },
        "17028673:95183:4389:ZH_HANS": { values: [{ id: 356971, value: "Китай" }] },
      },
    },
  });

  const attrs = draft.items[0].attributes;
  assert.equal(attrs.find((attribute) => Number(attribute.id) === 85)?.values[0].dictionary_value_id, 971082);
  assert.equal(attrs.find((attribute) => Number(attribute.id) === 4389)?.values[0].dictionary_value_id, 356971);
});

test("buildListingPayloadDraftFromJob records source-explained model autofill across variants", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01004",
    ozonTitle: "Набор органайзеров для кухни",
    listingContent: {
      title_ru: "Набор органайзеров для кухни",
      description_ru: "Практичный набор органайзеров для аккуратного хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/6.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [
        { spec: "白色", price: 20, image: "https://example.com/white.jpg" },
        { spec: "黑色", price: 21, image: "https://example.com/black.jpg" },
      ],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    attrsMeta: [
      { id: 85, name: "Бренд", is_required: true, dictionary_id: 971082 },
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 10097, name: "Название цвета", is_aspect: true },
    ],
    attributeValuesById: {
      85: [{ id: 971082, value: "Нет бренда" }],
    },
  });

  const modelValues = draft.items.map((item) => item.attributes
    .find((attribute) => Number(attribute.id) === 9048)?.values[0]?.value);
  assert.equal(draft.items.length, 2);
  assert.deepEqual(new Set(modelValues).size, 1);
  assert.ok(modelValues[0].length > 0);
  const modelPlan = draft.summary.requiredAttributeFillPlan.find((row) => row.attributeId === 9048);
  assert.equal(modelPlan.strategy, "model_name_from_parent_sku");
  assert.equal(modelPlan.action, "auto_fill");
  assert.equal(modelPlan.source, "parent_sku");
  assert.equal(modelPlan.value, modelValues[0]);
  assert.deepEqual(draft.summary.sourceVariants, [
    {
      offerId: "SKUlq01004-belyy",
      spec: "白色",
      image: "https://example.com/white.jpg",
      source: "1688_sku_variant",
    },
    {
      offerId: "SKUlq01004-chernyy",
      spec: "黑色",
      image: "https://example.com/black.jpg",
      source: "1688_sku_variant",
    },
  ]);
});

test("buildRequiredAttributeFillPlan keeps dictionary candidates in current category and marks package/sensitive fields", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 4389, name: "Страна-изготовитель", is_required: true, dictionary_id: 200 },
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
      { id: 888, name: "Вес товара, г", is_required: true },
      { id: 999, name: "Срок годности", is_required: true },
      { id: 23487, name: "Производитель", is_required: true, dictionary_id: 300 },
    ],
    attributeValuesById: {
      4389: [{ id: 22, value: "Китай" }],
      777: [
        { id: 11, value: "пластик" },
        { id: 12, value: "металл" },
      ],
    },
    modelName: "Органайзер SKUlq01005",
    productText: "Кухонный органайзер из пластика",
    packageInfo: { weight: 700, depth: 220, width: 160, height: 80 },
  });

  const originPlan = plan.find((row) => row.attributeId === 4389);
  assert.equal(originPlan.action, "auto_fill");
  assert.equal(originPlan.safetyTier, "autofill-safe");
  assert.equal(originPlan.requiresHumanConfirmation, false);
  assert.equal(originPlan.blocksAutomation, false);
  assert.equal(originPlan.strategy, "fixed_country_china");
  assert.equal(originPlan.dictionaryValueId, 22);
  assert.equal(originPlan.source, "fixed_country_china");

  const dictionaryPlan = plan.find((row) => row.attributeId === 777);
  assert.equal(dictionaryPlan.action, "suggest_dictionary");
  assert.equal(dictionaryPlan.safetyTier, "candidate-needs-human-confirmation");
  assert.equal(dictionaryPlan.requiresHumanConfirmation, true);
  assert.equal(dictionaryPlan.blocksAutomation, false);
  assert.equal(dictionaryPlan.blocksSubmission, true);
  assert.equal(dictionaryPlan.fieldPath, "items[*].attributes[id=777]");
  assert.match(dictionaryPlan.sideEffect, /不会写入 Ozon/);
  assert.equal(dictionaryPlan.dictionaryValueId, undefined);
  assert.deepEqual(dictionaryPlan.dictionaryCandidates.map((item) => item.dictionaryValueId), [11]);

  const packagePlan = plan.find((row) => row.attributeId === 888);
  assert.equal(packagePlan.action, "auto_fill");
  assert.equal(packagePlan.safetyTier, "autofill-safe");
  assert.equal(packagePlan.source, "1688_package");
  assert.equal(packagePlan.value, "700");

  const sensitivePlan = plan.find((row) => row.attributeId === 999);
  assert.equal(sensitivePlan.action, "blocked_sensitive");
  assert.equal(sensitivePlan.safetyTier, "blocked-never-guess");
  assert.equal(sensitivePlan.requiresHumanConfirmation, true);
  assert.equal(sensitivePlan.blocksAutomation, true);
  assert.equal(sensitivePlan.confidence, "low");
  assert.equal(sensitivePlan.blockingReason, "SENSITIVE_COMPLIANCE_ATTRIBUTE");
  assert.equal(sensitivePlan.fieldPath, "items[*].attributes[id=999]");
  assert.match(sensitivePlan.sellerAction, /人工核实/);

  const manufacturerPlan = plan.find((row) => row.attributeId === 23487);
  assert.equal(manufacturerPlan.action, "blocked_sensitive");
  assert.equal(manufacturerPlan.strategy, "compliance_sensitive");
});

test("buildRequiredAttributeFillPlan exposes a blocking seller contract for low-confidence attributes", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [{ id: 7001, name: "未归纳的监管属性", is_required: true }],
    productText: "普通收纳用品",
  });
  assert.equal(plan.length, 1);
  const row = plan[0];
  assert.equal(row.action, "manual_required");
  assert.equal(row.confidence, "low");
  assert.equal(row.blockingReason, "LOW_CONFIDENCE_ATTRIBUTE");
  assert.equal(row.blocksAutomation, true);
  assert.equal(row.blocksSubmission, true);
  assert.equal(row.fieldPath, "items[*].attributes[id=7001]");
  assert.match(row.sellerAction, /人工填写/);
  assert.match(row.sideEffect, /不会写入 Ozon/);
});

test("buildRequiredAttributeFillPlan classifies every required row into one safety tier", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
      { id: 1234, name: "Комментарий к комплектации", is_required: true },
      { id: 23487, name: "Производитель", is_required: true, dictionary_id: 300 },
    ],
    attributeValuesById: {
      777: [{ id: 11, value: "пластик" }],
    },
    modelName: "Органайзер SKUlq01005",
    productText: "1688 参数：PP 塑料收纳盒",
  });

  assert.deepEqual(plan.map((row) => row.safetyTier), [
    "autofill-safe",
    "candidate-needs-human-confirmation",
    "manual-required",
    "blocked-never-guess",
  ]);
  assert.ok(plan.every((row) => row.safetyLabelZh));
  assert.ok(plan.every((row) => /预检/.test(row.safeNextStep)));
  assert.ok(plan.filter((row) => row.requiresHumanConfirmation).every((row) => row.safetyTier !== "autofill-safe"));
  assert.ok(plan.find((row) => row.safetyTier === "blocked-never-guess").blocksAutomation);
});

test("summarizeRequiredAttributeFillPlan reports current product coverage by safety tier", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
      { id: 1234, name: "Комментарий к комплектации", is_required: true },
      { id: 23487, name: "Производитель", is_required: true, dictionary_id: 300 },
    ],
    attributeValuesById: {
      777: [{ id: 11, value: "пластик" }],
    },
    modelName: "Органайзер SKUlq01005",
    productText: "1688 参数：PP 塑料收纳盒",
  });

  const summary = summarizeRequiredAttributeFillPlan(plan);
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.autofillSafeCount, 1);
  assert.equal(summary.candidateNeedsHumanConfirmationCount, 1);
  assert.equal(summary.manualRequiredCount, 1);
  assert.equal(summary.blockedNeverGuessCount, 1);
  assert.equal(summary.humanRequiredCount, 3);
  assert.equal(summary.blockingCount, 2);
  assert.equal(summary.readinessStatus, "blocked");
  assert.match(summary.safeNextAction, /禁止猜测/);
  assert.equal(summary.safetyTierCounts["blocked-never-guess"], 1);
  assert.equal(summary.actionCounts.blocked_sensitive, 1);
});

test("buildRequiredAttributeManualBacklog groups manual rows by safe next decision", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9048, name: "Название модели (для объединения в одну карточку)", is_required: true },
      { id: 888, name: "Вес товара, г", is_required: true },
      { id: 1234, name: "Комментарий к комплектации", is_required: true },
      { id: 23487, name: "Производитель", is_required: true, dictionary_id: 300 },
    ],
    modelName: "Органайзер SKUlq01005",
  });

  const backlog = buildRequiredAttributeManualBacklog(plan);
  assert.equal(backlog.totalCount, 3);
  assert.equal(backlog.ruleCandidateCount, 1);
  assert.equal(backlog.manualRequiredCount, 1);
  assert.equal(backlog.replaceSourceCount, 1);
  assert.equal(backlog.readinessStatus, "replace_source");
  assert.match(backlog.safeNextAction, /换货源/);
  assert.deepEqual(backlog.buckets.map((bucket) => bucket.key), ["rule_candidate", "manual_required", "replace_source"]);
  assert.deepEqual(backlog.buckets.map((bucket) => bucket.items.length), [1, 1, 1]);
  assert.ok(backlog.buckets.flatMap((bucket) => bucket.items).every((item) => item.readOnly === true));
  assert.ok(backlog.buckets.find((bucket) => bucket.key === "rule_candidate").items[0].attributeName.includes("Комментарий"));
  assert.ok(backlog.buckets.find((bucket) => bucket.key === "manual_required").items[0].attributeName.includes("Производитель"));
  assert.ok(backlog.buckets.find((bucket) => bucket.key === "replace_source").items[0].attributeName.includes("Вес"));
});

test("buildRequiredAttributeRuleCandidateIndex creates read-only category rule candidates", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183, path: "Дом / Кухня" },
    attrsMeta: [
      { id: 1234, name: "Комментарий к комплектации", is_required: true },
      { id: 23487, name: "Производитель", is_required: true, dictionary_id: 300 },
    ],
  });
  const manualBacklog = buildRequiredAttributeManualBacklog(plan);
  const index = buildRequiredAttributeRuleCandidateIndex({
    categoryMatch: { description_category_id: 17028673, type_id: 95183, path: "Дом / Кухня" },
    manualBacklog,
  });

  assert.equal(index.categoryKey, "17028673:95183");
  assert.equal(index.totalCount, 1);
  assert.equal(index.readOnly, true);
  assert.match(index.safeNextAction, /候选/);
  assert.equal(index.candidates[0].attributeId, 1234);
  assert.equal(index.candidates[0].attributeName, "Комментарий к комплектации");
  assert.equal(index.candidates[0].ruleStatus, "candidate");
  assert.equal(index.candidates[0].occurrenceCount, 1);
  assert.equal(index.candidates[0].readOnly, true);
  assert.equal(index.candidates.some((candidate) => candidate.attributeId === 23487), false);
  assert.deepEqual(Object.keys(index.candidates[0]).filter((key) => /payload|submit|action/i.test(key)), []);
});

test("buildRequiredAttributeRuleCandidateHistory aggregates category samples without write controls", () => {
  const currentIndex = {
    categoryKey: "17028673:95183",
    categoryPath: "Дом / Кухня",
    candidates: [
      {
        attributeId: 1234,
        attributeName: "Комментарий к комплектации",
        categoryKey: "17028673:95183",
        occurrenceCount: 1,
        readOnly: true,
      },
    ],
  };
  const previousIndex = {
    sourceProductId: "SKU-OLD-1",
    sourceRunId: "run-old-1",
    categoryKey: "17028673:95183",
    categoryPath: "Дом / Кухня",
    candidates: [
      {
        attributeId: 1234,
        attributeName: "Комментарий к комплектации",
        categoryKey: "17028673:95183",
        occurrenceCount: 1,
        readOnly: true,
      },
    ],
  };
  const otherCategoryIndex = {
    sourceProductId: "SKU-OTHER-1",
    sourceRunId: "run-other-1",
    categoryKey: "17028674:95184",
    categoryPath: "Дом / Ванная",
    candidates: [
      {
        attributeId: 1234,
        attributeName: "Комментарий к комплектации",
        categoryKey: "17028674:95184",
        occurrenceCount: 1,
        readOnly: true,
      },
    ],
  };

  const history = buildRequiredAttributeRuleCandidateHistory([
    { sourceProductId: "SKU-CURRENT", sourceRunId: "run-current", index: currentIndex },
    previousIndex,
    otherCategoryIndex,
  ]);

  assert.equal(history.readOnly, true);
  assert.equal(history.totalCount, 3);
  assert.equal(history.categoryCount, 2);
  assert.equal(history.reviewQueue.length, 2);
  const kitchenRule = history.reviewQueue.find((item) => item.categoryKey === "17028673:95183");
  const bathRule = history.reviewQueue.find((item) => item.categoryKey === "17028674:95184");
  assert.equal(kitchenRule.attributeId, 1234);
  assert.equal(kitchenRule.occurrenceCount, 2);
  assert.equal(kitchenRule.ruleStatus, "ready_for_review");
  assert.deepEqual(kitchenRule.sampleProductIds, ["SKU-CURRENT", "SKU-OLD-1"]);
  assert.deepEqual(kitchenRule.sampleRunIds, ["run-current", "run-old-1"]);
  assert.equal(kitchenRule.readOnly, true);
  assert.match(kitchenRule.safeNextStep, /人工审核/);
  assert.equal(history.approvalDraftQueue, undefined);
  assert.equal(history.approvalDraftCount, undefined);
  assert.equal(bathRule.occurrenceCount, 1);
  assert.equal(bathRule.ruleStatus, "collect_more_samples");
  assert.deepEqual(Object.keys(kitchenRule).filter((key) => /payload|submit|action/i.test(key)), []);
});

test("buildRequiredAttributeApprovalDraftPreview derives read-only approval drafts without mutating history", () => {
  const history = buildRequiredAttributeRuleCandidateHistory([
    {
      sourceProductId: "SKU-CURRENT",
      sourceRunId: "run-current",
      categoryKey: "17028673:95183",
      categoryPath: "Дом / Кухня",
      candidates: [{
        attributeId: 1234,
        attributeName: "Комментарий к комплектации",
        categoryKey: "17028673:95183",
        occurrenceCount: 1,
        readOnly: true,
      }],
    },
    {
      sourceProductId: "SKU-OLD-1",
      sourceRunId: "run-old-1",
      categoryKey: "17028673:95183",
      categoryPath: "Дом / Кухня",
      candidates: [{
        attributeId: 1234,
        attributeName: "Комментарий к комплектации",
        categoryKey: "17028673:95183",
        occurrenceCount: 1,
        readOnly: true,
      }],
    },
  ]);
  const preview = buildRequiredAttributeApprovalDraftPreview(history);

  assert.equal(preview.readOnly, true);
  assert.equal(preview.approvalDraftCount, 1);
  assert.equal(preview.approvalDraftQueue[0].attributeId, 1234);
  assert.equal(preview.approvalDraftQueue[0].draftStatus, "pending_human_approval");
  assert.equal(preview.approvalDraftQueue[0].readOnly, true);
  assert.deepEqual(preview.approvalDraftQueue[0].requiredChecks, ["同类目样本复核", "人工批准", "独立预检回归"]);
  assert.deepEqual(preview.approvalDraftQueue[0].forbiddenEffects, ["payload_write", "ozon_submit", "rule_auto_enable"]);
  assert.equal(preview.approvalDraftQueue[0].auditReadiness.status, "blocked_until_audit_ready");
  assert.equal(preview.approvalDraftQueue[0].auditReadiness.canStoreApproval, false);
  assert.equal(preview.approvalDraftQueue[0].auditReadiness.canEnableRule, false);
  assert.deepEqual(preview.approvalDraftQueue[0].auditReadiness.missingProofs, ["样本复核记录", "人工批准人和时间", "独立预检回归结果"]);
  assert.match(preview.approvalDraftQueue[0].auditReadiness.safeNextStep, /审计记录/);
  assert.match(preview.approvalDraftQueue[0].safeNextStep, /批准前/);
  assert.deepEqual(Object.keys(preview.approvalDraftQueue[0]).filter((key) => /payload|submit|action/i.test(key)), []);
  assert.deepEqual(Object.keys(preview.approvalDraftQueue[0].auditReadiness).filter((key) => /payload|submit|action/i.test(key)), []);
  assert.deepEqual(preview.approvalDraftQueue[0].sampleProductIds, ["SKU-CURRENT", "SKU-OLD-1"]);
  assert.notEqual(preview.approvalDraftQueue[0].sampleProductIds, history.reviewQueue[0].sampleProductIds);
  assert.notEqual(preview.approvalDraftQueue[0].sampleRunIds, history.reviewQueue[0].sampleRunIds);
  assert.equal(history.approvalDraftQueue, undefined);
});

test("buildRequiredAttributeRuleCandidateHistory requires distinct samples before review", () => {
  const history = buildRequiredAttributeRuleCandidateHistory([
    {
      sourceProductId: "SKU-DUP",
      sourceRunId: "run-dup",
      categoryKey: "17028673:95183",
      categoryPath: "Дом / Кухня",
      candidates: [
        {
          attributeId: 1234,
          attributeName: "Комментарий к комплектации",
          categoryKey: "17028673:95183",
          occurrenceCount: 1,
          readOnly: true,
        },
        {
          attributeId: 1234,
          attributeName: "Комментарий к комплектации",
          categoryKey: "17028673:95183",
          occurrenceCount: 1,
          readOnly: true,
        },
      ],
    },
  ]);

  assert.equal(history.totalCount, 1);
  assert.equal(history.reviewQueue[0].occurrenceCount, 1);
  assert.equal(history.reviewQueue[0].ruleStatus, "collect_more_samples");
  assert.deepEqual(history.reviewQueue[0].sampleProductIds, ["SKU-DUP"]);
});

test("buildRequiredAttributeFillPlan suggests color dictionary candidates from color synonyms only", () => {
  const colorPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 10097, name: "Цвет", is_required: true, dictionary_id: 120 },
    ],
    attributeValuesById: {
      10097: [
        { id: 201, value: "красный" },
        { id: 202, value: "синий" },
        { id: 203, value: "белый" },
      ],
    },
    productText: "1688 SKU：红色 red органайзер",
  })[0];

  assert.equal(colorPlan.action, "suggest_dictionary");
  assert.equal(colorPlan.dictionaryValueId, undefined);
  assert.deepEqual(colorPlan.dictionaryCandidates, [{
    dictionaryValueId: 201,
    value: "красный",
    confidence: 0.7,
    source: "color_synonym",
  }]);

  const typePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8229, name: "Тип", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      8229: [{ id: 204, value: "красный" }],
    },
    productText: "1688 标题：红色 red",
  })[0];
  assert.deepEqual(typePlan.dictionaryCandidates, []);

  const featurePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8230, name: "特色", is_required: true, dictionary_id: 102 },
    ],
    attributeValuesById: {
      8230: [{ id: 205, value: "красный" }],
    },
    productText: "1688 标题：红色 red",
  })[0];
  assert.deepEqual(featurePlan.dictionaryCandidates, []);

  const greySeriesPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 10097, name: "Цвет", is_required: true, dictionary_id: 120 },
    ],
    attributeValuesById: {
      10097: [{ id: 206, value: "серый" }],
    },
    productText: "серия 2 органайзер",
  })[0];
  assert.deepEqual(greySeriesPlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests dictionary candidates from material synonyms only", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
    ],
    attributeValuesById: {
      777: [
        { id: 11, value: "пластик" },
        { id: 12, value: "металл" },
      ],
    },
    productText: "1688 参数：材质 PP 塑料，适合厨房收纳",
  });

  const materialPlan = plan.find((row) => row.attributeId === 777);
  assert.equal(materialPlan.action, "suggest_dictionary");
  assert.equal(materialPlan.dictionaryValueId, undefined);
  assert.deepEqual(materialPlan.dictionaryCandidates, [{
    dictionaryValueId: 11,
    value: "пластик",
    confidence: 0.72,
    source: "material_synonym",
  }]);

  const colorPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 10097, name: "Цвет", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      10097: [{ id: 91, value: "пластик" }],
    },
    productText: "1688 参数：材质 PP 塑料",
  })[0];
  assert.equal(colorPlan.action, "suggest_dictionary");
  assert.deepEqual(colorPlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests type dictionary candidates from product synonyms only", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8229, name: "Тип", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      8229: [
        { id: 31, value: "органайзер" },
        { id: 32, value: "корзина" },
      ],
    },
    productText: "1688 标题：厨房收纳盒 organizer для кухни",
  });

  const typePlan = plan.find((row) => row.attributeId === 8229);
  assert.equal(typePlan.action, "suggest_dictionary");
  assert.equal(typePlan.dictionaryValueId, undefined);
  assert.deepEqual(typePlan.dictionaryCandidates, [{
    dictionaryValueId: 31,
    value: "органайзер",
    confidence: 0.7,
    source: "type_synonym",
  }]);

  const materialPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
    ],
    attributeValuesById: {
      777: [{ id: 11, value: "органайзер" }],
    },
    productText: "1688 标题：厨房收纳盒 organizer",
  })[0];
  assert.deepEqual(materialPlan.dictionaryCandidates, []);

  const sceneImagePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9016, name: "场景图", is_required: true, dictionary_id: 111 },
    ],
    attributeValuesById: {
      9016: [{ id: 153, value: "для путешествий" }],
    },
    productText: "1688 标题：旅行收纳包 travel organizer",
  })[0];
  assert.deepEqual(sceneImagePlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests purpose dictionary candidates from product synonyms only", () => {
  const kitchenPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 4958, name: "Назначение", is_required: true, dictionary_id: 102 },
    ],
    attributeValuesById: {
      4958: [
        { id: 41, value: "для кухни" },
        { id: 42, value: "для ванной" },
      ],
    },
    productText: "1688 标题：厨房收纳用品 kitchen storage",
  })[0];

  assert.equal(kitchenPlan.action, "suggest_dictionary");
  assert.equal(kitchenPlan.dictionaryValueId, undefined);
  assert.deepEqual(kitchenPlan.dictionaryCandidates, [{
    dictionaryValueId: 41,
    value: "для кухни",
    confidence: 0.7,
    source: "purpose_synonym",
  }]);

  const petPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 4959, name: "适用对象", is_required: true, dictionary_id: 103 },
    ],
    attributeValuesById: {
      4959: [
        { id: 51, value: "для животных" },
        { id: 52, value: "для взрослых" },
      ],
    },
    productText: "1688 标题：宠物猫狗用品 pet supplies",
  })[0];

  assert.equal(petPlan.action, "suggest_dictionary");
  assert.deepEqual(petPlan.dictionaryCandidates, [{
    dictionaryValueId: 51,
    value: "для животных",
    confidence: 0.7,
    source: "purpose_synonym",
  }]);

  const catalogPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 4960, name: "适用对象", is_required: true, dictionary_id: 103 },
    ],
    attributeValuesById: {
      4960: [{ id: 53, value: "для животных" }],
    },
    productText: "1688 标题：catalog organizer storage box",
  })[0];
  assert.deepEqual(catalogPlan.dictionaryCandidates, []);

  const typePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8229, name: "Тип", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      8229: [{ id: 61, value: "для кухни" }],
    },
    productText: "1688 标题：厨房用品",
  })[0];
  assert.deepEqual(typePlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests gender dictionary candidates from product synonyms only", () => {
  const womenPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8292, name: "Пол", is_required: true, dictionary_id: 104 },
    ],
    attributeValuesById: {
      8292: [
        { id: 71, value: "женский" },
        { id: 72, value: "мужской" },
      ],
    },
    productText: "1688 标题：女士收纳包 women travel organizer",
  })[0];

  assert.equal(womenPlan.action, "suggest_dictionary");
  assert.equal(womenPlan.dictionaryValueId, undefined);
  assert.deepEqual(womenPlan.dictionaryCandidates, [{
    dictionaryValueId: 71,
    value: "женский",
    confidence: 0.7,
    source: "gender_synonym",
  }]);

  const russianWomenPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8296, name: "Пол", is_required: true, dictionary_id: 104 },
    ],
    attributeValuesById: {
      8296: [{ id: 73, value: "женский" }],
    },
    productText: "1688 标题：женщина travel organizer",
  })[0];
  assert.deepEqual(russianWomenPlan.dictionaryCandidates, [{
    dictionaryValueId: 73,
    value: "женский",
    confidence: 0.7,
    source: "gender_synonym",
  }]);

  const childrenPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8293, name: "适用性别", is_required: true, dictionary_id: 105 },
    ],
    attributeValuesById: {
      8293: [
        { id: 81, value: "для взрослых" },
        { id: 82, value: "детский" },
      ],
    },
    productText: "1688 标题：儿童洗漱杯 kids bathroom cup",
  })[0];

  assert.equal(childrenPlan.action, "suggest_dictionary");
  assert.deepEqual(childrenPlan.dictionaryCandidates, [{
    dictionaryValueId: 82,
    value: "детский",
    confidence: 0.7,
    source: "gender_synonym",
  }]);

  const russianChildrenPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8297, name: "Пол", is_required: true, dictionary_id: 105 },
    ],
    attributeValuesById: {
      8297: [{ id: 85, value: "детский" }],
    },
    productText: "1688 标题：детская bathroom cup",
  })[0];
  assert.deepEqual(russianChildrenPlan.dictionaryCandidates, [{
    dictionaryValueId: 85,
    value: "детский",
    confidence: 0.7,
    source: "gender_synonym",
  }]);

  const weeklyPlannerPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8294, name: "Пол", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      8294: [{ id: 83, value: "женский" }],
    },
    productText: "1688 标题：еженедельник travel organizer",
  })[0];
  assert.deepEqual(weeklyPlannerPlan.dictionaryCandidates, []);

  const detailPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8295, name: "Пол", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      8295: [{ id: 84, value: "детский" }],
    },
    productText: "1688 标题：деталь органайзер",
  })[0];
  assert.deepEqual(detailPlan.dictionaryCandidates, []);

  const purposePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 4958, name: "Назначение", is_required: true, dictionary_id: 102 },
    ],
    attributeValuesById: {
      4958: [{ id: 91, value: "женский" }],
    },
    productText: "1688 标题：女士用品 women",
  })[0];
  assert.deepEqual(purposePlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests capacity and count dictionary candidates only", () => {
  const capacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9011, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9011: [
        { id: 101, value: "500 мл" },
        { id: 102, value: "1 л" },
      ],
    },
    productText: "1688 参数：容量 500ml，透明水杯",
  })[0];

  assert.equal(capacityPlan.action, "suggest_dictionary");
  assert.equal(capacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(capacityPlan.dictionaryCandidates, [{
    dictionaryValueId: 101,
    value: "500 мл",
    confidence: 0.68,
    source: "capacity_synonym",
  }]);

  const exactCapacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9030, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9030: [{ id: 134, value: "500ml" }],
    },
    productText: "1688 参数：容量 500ml，透明水杯",
  })[0];

  assert.equal(exactCapacityPlan.action, "suggest_dictionary");
  assert.equal(exactCapacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(exactCapacityPlan.dictionaryCandidates, [{
    dictionaryValueId: 134,
    value: "500ml",
    confidence: 0.68,
    source: "capacity_synonym",
  }]);

  const cyrillicCapacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9020, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9020: [{ id: 124, value: "500 ml" }],
    },
    productText: "1688 参数：容量 500 мл，透明水杯",
  })[0];

  assert.equal(cyrillicCapacityPlan.action, "suggest_dictionary");
  assert.equal(cyrillicCapacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(cyrillicCapacityPlan.dictionaryCandidates, [{
    dictionaryValueId: 124,
    value: "500 ml",
    confidence: 0.68,
    source: "capacity_synonym",
  }]);

  const countPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9012, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9012: [
        { id: 111, value: "5 шт" },
        { id: 112, value: "10 шт" },
      ],
    },
    productText: "1688 标题：10件套厨房收纳夹 10pcs",
  })[0];

  assert.equal(countPlan.action, "suggest_dictionary");
  assert.equal(countPlan.dictionaryValueId, undefined);
  assert.deepEqual(countPlan.dictionaryCandidates, [{
    dictionaryValueId: 112,
    value: "10 шт",
    confidence: 0.68,
    source: "count_synonym",
  }]);

  const exactCountPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9031, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9031: [{ id: 135, value: "10pcs" }],
    },
    productText: "1688 标题：10pcs 收纳夹",
  })[0];

  assert.equal(exactCountPlan.action, "suggest_dictionary");
  assert.equal(exactCountPlan.dictionaryValueId, undefined);
  assert.deepEqual(exactCountPlan.dictionaryCandidates, [{
    dictionaryValueId: 135,
    value: "10pcs",
    confidence: 0.68,
    source: "count_synonym",
  }]);

  const modelCapacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9018, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9018: [{ id: 122, value: "500 мл" }],
    },
    productText: "1688 标题：型号 X500ml 旅行收纳瓶",
  })[0];
  assert.equal(modelCapacityPlan.action, "suggest_dictionary");
  assert.equal(modelCapacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(modelCapacityPlan.dictionaryCandidates, []);

  const skuCountPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9019, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9019: [{ id: 123, value: "10 шт" }],
    },
    productText: "1688 标题：SKU A10pcs 收纳盒",
  })[0];
  assert.equal(skuCountPlan.action, "suggest_dictionary");
  assert.equal(skuCountPlan.dictionaryValueId, undefined);
  assert.deepEqual(skuCountPlan.dictionaryCandidates, []);

  const leftJoinedExactCountPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9028, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9028: [{ id: 132, value: "10pcs" }],
    },
    productText: "1688 标题：SKU A10pcs 收纳盒",
  })[0];
  assert.equal(leftJoinedExactCountPlan.action, "suggest_dictionary");
  assert.equal(leftJoinedExactCountPlan.dictionaryValueId, undefined);
  assert.deepEqual(leftJoinedExactCountPlan.dictionaryCandidates, []);

  const rightJoinedCountPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9021, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9021: [{ id: 125, value: "10 шт" }],
    },
    productText: "1688 标题：SKU 10pcsX 收纳盒",
  })[0];
  assert.equal(rightJoinedCountPlan.action, "suggest_dictionary");
  assert.equal(rightJoinedCountPlan.dictionaryValueId, undefined);
  assert.deepEqual(rightJoinedCountPlan.dictionaryCandidates, []);

  const rightJoinedExactCountPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9026, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9026: [{ id: 130, value: "10pcs" }],
    },
    productText: "1688 标题：SKU 10pcsX 收纳盒",
  })[0];
  assert.equal(rightJoinedExactCountPlan.action, "suggest_dictionary");
  assert.equal(rightJoinedExactCountPlan.dictionaryValueId, undefined);
  assert.deepEqual(rightJoinedExactCountPlan.dictionaryCandidates, []);

  const rightJoinedCapacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9022, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9022: [{ id: 126, value: "500 мл" }],
    },
    productText: "1688 标题：SKU 500mlX 收纳瓶",
  })[0];
  assert.equal(rightJoinedCapacityPlan.action, "suggest_dictionary");
  assert.equal(rightJoinedCapacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(rightJoinedCapacityPlan.dictionaryCandidates, []);

  const leftJoinedExactCapacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9029, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9029: [{ id: 133, value: "500ml" }],
    },
    productText: "1688 标题：型号 X500ml 旅行收纳瓶",
  })[0];
  assert.equal(leftJoinedExactCapacityPlan.action, "suggest_dictionary");
  assert.equal(leftJoinedExactCapacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(leftJoinedExactCapacityPlan.dictionaryCandidates, []);

  const rightJoinedExactCapacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9027, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9027: [{ id: 131, value: "500ml" }],
    },
    productText: "1688 标题：SKU 500mlX 收纳瓶",
  })[0];
  assert.equal(rightJoinedExactCapacityPlan.action, "suggest_dictionary");
  assert.equal(rightJoinedExactCapacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(rightJoinedExactCapacityPlan.dictionaryCandidates, []);

  const chineseCapacityPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9023, name: "Объем", is_required: true, dictionary_id: 106 },
    ],
    attributeValuesById: {
      9023: [{ id: 127, value: "500 мл" }],
    },
    productText: "1688 参数：容量 500毫升，便携瓶",
  })[0];
  assert.equal(chineseCapacityPlan.action, "suggest_dictionary");
  assert.equal(chineseCapacityPlan.dictionaryValueId, undefined);
  assert.deepEqual(chineseCapacityPlan.dictionaryCandidates, [{
    dictionaryValueId: 127,
    value: "500 мл",
    confidence: 0.68,
    source: "capacity_synonym",
  }]);

  const rightJoinedCyrillicCountPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9024, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9024: [{ id: 128, value: "10 шт" }],
    },
    productText: "1688 标题：SKU 10штABC 收纳盒",
  })[0];
  assert.equal(rightJoinedCyrillicCountPlan.action, "suggest_dictionary");
  assert.equal(rightJoinedCyrillicCountPlan.dictionaryValueId, undefined);
  assert.deepEqual(rightJoinedCyrillicCountPlan.dictionaryCandidates, []);

  const standaloneCyrillicCountPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9025, name: "Количество предметов", is_required: true, dictionary_id: 107 },
    ],
    attributeValuesById: {
      9025: [{ id: 129, value: "10 pcs" }],
    },
    productText: "1688 参数：数量 10 шт，套装",
  })[0];
  assert.equal(standaloneCyrillicCountPlan.action, "suggest_dictionary");
  assert.equal(standaloneCyrillicCountPlan.dictionaryValueId, undefined);
  assert.deepEqual(standaloneCyrillicCountPlan.dictionaryCandidates, [{
    dictionaryValueId: 129,
    value: "10 pcs",
    confidence: 0.68,
    source: "count_synonym",
  }]);

  const materialPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
    ],
    attributeValuesById: {
      777: [{ id: 121, value: "500 мл" }],
    },
    productText: "1688 参数：容量 500ml",
  })[0];
  assert.deepEqual(materialPlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests size package and scenario dictionary candidates only", () => {
  const sizePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9013, name: "Размер", is_required: true, dictionary_id: 108 },
    ],
    attributeValuesById: {
      9013: [
        { id: 131, value: "10 см" },
        { id: 132, value: "20 см" },
      ],
    },
    productText: "1688 参数：尺寸 10cm，小号收纳盒",
  })[0];

  assert.equal(sizePlan.action, "suggest_dictionary");
  assert.equal(sizePlan.dictionaryValueId, undefined);
  assert.deepEqual(sizePlan.dictionaryCandidates, [{
    dictionaryValueId: 131,
    value: "10 см",
    confidence: 0.68,
    source: "size_synonym",
  }]);

  const packagePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9014, name: "Количество в упаковке", is_required: true, dictionary_id: 109 },
    ],
    attributeValuesById: {
      9014: [
        { id: 141, value: "3 шт" },
        { id: 142, value: "5 шт" },
      ],
    },
    productText: "1688 标题：3-pack 一包3个旅行收纳瓶",
  })[0];

  assert.equal(packagePlan.action, "suggest_dictionary");
  assert.equal(packagePlan.dictionaryValueId, undefined);
  assert.deepEqual(packagePlan.dictionaryCandidates, [{
    dictionaryValueId: 141,
    value: "3 шт",
    confidence: 0.68,
    source: "package_count_synonym",
  }]);

  const scenarioPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9015, name: "Сценарий использования", is_required: true, dictionary_id: 110 },
    ],
    attributeValuesById: {
      9015: [
        { id: 151, value: "для путешествий" },
        { id: 152, value: "для офиса" },
      ],
    },
    productText: "1688 标题：旅行收纳包 travel organizer",
  })[0];

  assert.equal(scenarioPlan.action, "suggest_dictionary");
  assert.equal(scenarioPlan.dictionaryValueId, undefined);
  assert.deepEqual(scenarioPlan.dictionaryCandidates, [{
    dictionaryValueId: 151,
    value: "для путешествий",
    confidence: 0.7,
    source: "scenario_synonym",
  }]);

  const materialPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 777, name: "Материал", is_required: true, dictionary_id: 100 },
    ],
    attributeValuesById: {
      777: [{ id: 161, value: "для путешествий" }],
    },
    productText: "1688 标题：旅行 travel",
  })[0];
  assert.deepEqual(materialPlan.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests size dimension combinations only from current dictionary", () => {
  const plan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9016, name: "Размер", is_required: true, dictionary_id: 111 },
    ],
    attributeValuesById: {
      9016: [
        { id: 171, value: "10 x 20 см" },
        { id: 172, value: "20 x 30 см" },
      ],
    },
    productText: "1688 参数：尺寸 10x20cm，适合桌面收纳",
  })[0];

  assert.equal(plan.action, "suggest_dictionary");
  assert.equal(plan.dictionaryValueId, undefined);
  assert.deepEqual(plan.dictionaryCandidates, [{
    dictionaryValueId: 171,
    value: "10 x 20 см",
    confidence: 0.68,
    source: "size_synonym",
  }]);

  const noMatch = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9016, name: "Размер", is_required: true, dictionary_id: 111 },
    ],
    attributeValuesById: {
      9016: [{ id: 173, value: "30 x 40 см" }],
    },
    productText: "1688 参数：尺寸 10*20 см",
  })[0];
  assert.deepEqual(noMatch.dictionaryCandidates, []);
});

test("buildRequiredAttributeFillPlan suggests home car and school scenario candidates only", () => {
  const scenarioPlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 9017, name: "Сценарий использования", is_required: true, dictionary_id: 112 },
    ],
    attributeValuesById: {
      9017: [
        { id: 181, value: "для дома" },
        { id: 182, value: "для автомобиля" },
        { id: 183, value: "для школы" },
        { id: 184, value: "для путешествий" },
      ],
    },
    productText: "1688 标题：家用车载学生收纳盒 home car school organizer",
  })[0];

  assert.equal(scenarioPlan.action, "suggest_dictionary");
  assert.equal(scenarioPlan.dictionaryValueId, undefined);
  assert.deepEqual(scenarioPlan.dictionaryCandidates, [
    {
      dictionaryValueId: 181,
      value: "для дома",
      confidence: 0.7,
      source: "scenario_synonym",
    },
    {
      dictionaryValueId: 182,
      value: "для автомобиля",
      confidence: 0.7,
      source: "scenario_synonym",
    },
    {
      dictionaryValueId: 183,
      value: "для школы",
      confidence: 0.7,
      source: "scenario_synonym",
    },
  ]);

  const typePlan = buildRequiredAttributeFillPlan({
    categoryMatch: { description_category_id: 17028673, type_id: 95183 },
    attrsMeta: [
      { id: 8229, name: "Тип", is_required: true, dictionary_id: 101 },
    ],
    attributeValuesById: {
      8229: [{ id: 185, value: "для дома" }],
    },
    productText: "1688 标题：home 家用",
  })[0];
  assert.deepEqual(typePlan.dictionaryCandidates, []);
});

test("buildListingPayloadDraftFromJob applies explainable pricing policy fields", () => {
  const draft = buildListingPayloadDraftFromJob({
    pendingParentSku: "SKUlq01007",
    ozonTitle: "Органайзер для кухни",
    listingContent: {
      title_ru: "Органайзер для кухни",
      description_ru: "Практичный органайзер для хранения.",
    },
    visualCard: { url: "https://example.com/cover.jpg" },
    bestMatch: {
      candidateTitle: "厨房收纳盒",
      candidateUrl: "https://detail.1688.com/offer/7.html",
      purchasePriceCny: 20,
    },
    candidateData: {
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      sizeWeight: { weightG: 700, lengthMm: 220, widthMm: 160, heightMm: 80 },
      skuVariants: [],
    },
  }, {
    categoryMatch: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "Дом / Кухня",
    },
    pricingPolicy: {
      targetProfitRate: 0.3,
      minimumProfitRate: 0.08,
      minimumProfitCny: 3,
      oldPriceMode: "promo_multiplier",
      oldPriceMultiplier: 1.6,
    },
  });

  const item = draft.items[0];
  assert.equal(item.old_price, String(draft.summary.pricingDiagnosis.oldPriceCny));
  assert.equal(item.min_price, String(draft.summary.pricingDiagnosis.minPriceCny));
  assert.equal(draft.summary.pricingDiagnosis.oldPriceSource.mode, "promo_multiplier");
  assert.equal(draft.summary.pricingDiagnosis.minPriceSource.mode, "minimum_profit_floor");
  assert.equal(draft.summary.pricingDiagnosis.pricingPolicy.oldPriceMultiplier, 1.6);
});
