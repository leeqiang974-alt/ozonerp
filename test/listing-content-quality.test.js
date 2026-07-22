import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildLazyContentAttributeValues,
  buildListingDescription,
  buildMarketingAttributes,
  normalizeOzonTitleForListing,
  getOzonImagePrepareLimit,
  isOzonImageOcrEnabledForListing,
  existingParentSkuForListing,
  minPriceFromPrice,
  variantAspectAttributes,
  modelAttributesForMeta,
  variantOfferId,
  dedupeSubmitItemsByOfferId,
  generatedOfferIdCollisions,
  mergeVariantListingAttributes,
  mergeRetryModelAttributes,
  findDuplicateListingJob,
  importFeedbackState,
  importReconcileState,
  inspectAutoListingProductReadiness,
  normalizeImportReadiness,
  reconcileImportedProductReadiness,
  normalizeOzonProductStatusProducts,
  shouldAutoRetryImport,
  splitImportWarningsAndErrors,
  selectPreparedOzonImages,
  postSubmissionStockReadiness,
  buildSubmittedReconciliationSellerResult,
  waitForImportInfo,
} from "../src/autoListing.js";
import { buildListingContentEvidence } from "../src/llmListing.js";

test("AI Russian content remains seller-reviewed when facts are not traceable to 1688 evidence", () => {
  const result = buildListingContentEvidence({
    title_ru: "Органайзер для кухни",
    product_type_ru: "Органайзер",
    description_ru: "Органайзер из нержавеющей стали для кухни.",
    annotation_ru: "Удобный органайзер.",
    attributes_hint: { brand: "Нет бренда", origin_country: "Китай", material: "нержавеющая сталь" },
  }, {
    title: "厨房收纳盒",
    detailText: "塑料收纳盒，白色",
    sourceEvidence: { snapshotHash: "sha256:fixture", verificationState: "ok" },
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockerCodes.includes("CONTENT_FACT_REVIEW_REQUIRED"));
  assert.ok(result.unsupportedClaims.some((item) => item.field === "attributes_hint.material"));
  assert.match(result.action, /逐字段核对/);
  assert.match(result.sideEffect, /不会提交 Ozon、改价、写库存/);
  assert.equal(result.verificationLevel, "locally_tested");
});

test("Russian content evidence can be reviewed but never upgrades to Ozon fact verification", () => {
  const result = buildListingContentEvidence({
    title_ru: "Органайзер",
    product_type_ru: "Органайзер",
    description_ru: "Органайзер для дома",
    annotation_ru: "Органайзер",
    attributes_hint: {},
    humanConfirmed: true,
  }, {
    title: "Органайзер для дома",
    detailText: "Органайзер для дома",
    sourceEvidence: { snapshotHash: "sha256:fixture", verificationState: "ok" },
  });
  assert.equal(result.status, "reviewed");
  assert.equal(result.verificationLevel, "locally_tested");
  assert.match(result.result, /仍需通过预检/);
});

test("1688 content cannot use an unverified snapshot as a fact source", () => {
  const result = buildListingContentEvidence({ title_ru: "Органайзер", description_ru: "Органайзер" }, {
    source: "1688",
    url: "https://detail.1688.com/offer/1.html",
    title: "Органайзер",
    sourceEvidence: { snapshotHash: "sha256:old", verificationState: "stale" },
  });
  assert.ok(result.blockerCodes.includes("CONTENT_SOURCE_EVIDENCE_UNVERIFIED"));
  assert.equal(result.source.type, "provided_product_text");
});

test("submitted reconciliation exposes seller action, side effect, and result", () => {
  const pending = buildSubmittedReconciliationSellerResult({ scanned: 2, updated: 1, pending: 1 });
  assert.equal(pending.status, "pending_moderation");
  assert.match(pending.action, /只读回查/);
  assert.match(pending.sideEffect, /未提交商品/);
  assert.match(pending.result, /1 个任务/);

  const failed = buildSubmittedReconciliationSellerResult({ scanned: 1, failed: 1 });
  assert.equal(failed.status, "needs_repair");
  assert.match(failed.action, /重新预检/);
});

test("post-submit stock readiness blocks invented quantities until exact current evidence exists", () => {
  const result = postSubmissionStockReadiness({
    submitItems: [{ offer_id: "OFFER-1" }, { offer_id: "OFFER-2" }],
    taskId: "task-1",
    storeId: "store-1",
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "STOCK_CURRENT_EVIDENCE_REQUIRED");
  assert.deepEqual(result.offerIds, ["OFFER-1", "OFFER-2"]);
  assert.equal(result.verificationLevel, "locally_tested");
  assert.equal(Object.hasOwn(result, "stock"), false);
});

function pendingModerationJob() {
  return {
    id: "job-fixture-1",
    status: "pending_moderation",
    listingResult: {
      storeId: "store-fixture",
      taskId: 70010,
      importInfo: {
        result: {
          task_id: 70010,
          items: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: "imported", errors: [] }],
        },
      },
    },
  };
}

test("reconcileImportedProductReadiness blocks a listing/result store mismatch before any read", async () => {
  let reads = 0;
  const result = await reconcileImportedProductReadiness({
    ...pendingModerationJob(),
    storeId: "store-other",
  }, {
    readProductStatus: async () => { reads += 1; return { products: [] }; },
  });
  assert.equal(result.patch.reasonCode, "READ_STORE_SCOPE_MISMATCH");
  assert.equal(result.evidence.readStatus, "store_scope_mismatch");
  assert.equal(result.evidence.live, false);
  assert.equal(reads, 0);
});

test("reconcileImportedProductReadiness returns a ready patch only from explicit read evidence", async () => {
  const result = await reconcileImportedProductReadiness(pendingModerationJob(), {
    readProductStatus: async (request) => {
      assert.deepEqual(request, {
        storeId: "store-fixture",
        taskId: 70010,
        offers: [{ offerId: "FIXTURE-READY", productId: 83001 }],
      });
      return {
        listResponse: { result: { items: [{ offer_id: "FIXTURE-READY", product_id: 83001 }] } },
        detailResponse: { items: [{ offer_id: "FIXTURE-READY", id: 83001, status: { state: "selling" }, visible: true }] },
        readAttempt: { checkedAt: new Date().toISOString(), endpointAttempts: ["/v3/product/list", "/v3/product/info/list"] },
      };
    },
  });

  assert.equal(result.patch.status, "ready_for_sale");
  assert.equal(result.patch.stage, "ready_for_sale");
  assert.equal(result.evidence.state, "ready_for_sale");
  assert.equal(result.evidence.live, true);
});

test("reconcileImportedProductReadiness carries the controlled environment into the read adapter", async () => {
  let captured;
  const job = {
    ...pendingModerationJob(),
    listingResult: { ...pendingModerationJob().listingResult, environment: "staging" },
  };
  const result = await reconcileImportedProductReadiness(job, {
    readProductStatus: async (request) => {
      captured = request;
      return {
        listResponse: { result: { items: [{ offer_id: "FIXTURE-READY", product_id: 83001 }] } },
        detailResponse: { items: [{ offer_id: "FIXTURE-READY", id: 83001, status: { state: "selling" }, visible: true }] },
        readAttempt: { checkedAt: new Date().toISOString(), endpointAttempts: ["/v3/product/list", "/v3/product/info/list"] },
      };
    },
  });
  assert.equal(captured.environment, "staging");
  assert.equal(result.patch.status, "ready_for_sale");
  assert.equal(result.evidence.live, true);
});

test("reconcileImportedProductReadiness does not route hidden selling products into stock", async () => {
  const result = await reconcileImportedProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "selling" }, visible: false }],
      readAttempt: {
        checkedAt: new Date().toISOString(),
        requestedOfferCount: 1,
        endpointAttempts: ["/v3/product/list", "/v3/product/info/list"],
      },
    }),
  });

  assert.equal(result.evidence.state, "ready_for_sale");
  assert.equal(result.evidence.visibilityStatus, "hidden");
  assert.equal(result.evidence.live, false);
  assert.equal(result.patch.status, "pending_moderation");

  const inspection = await inspectAutoListingProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "selling" }, visible: false }],
      readAttempt: {
        checkedAt: new Date().toISOString(),
        requestedOfferCount: 1,
        endpointAttempts: ["/v3/product/list", "/v3/product/info/list"],
      },
    }),
  });
  assert.match(inspection.sellerView.reason, /visible=false/);
  assert.match(inspection.sellerView.nextAction, /visible=true/);
});

test("reconcileImportedProductReadiness keeps fixture status pending when Seller read metadata is omitted", async () => {
  const result = await reconcileImportedProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "selling" }, visible: true }],
    }),
  });

  assert.equal(result.evidence.state, "ready_for_sale");
  assert.equal(result.evidence.live, false);
  assert.equal(result.evidence.readStatus, "completed");
  assert.equal(result.evidence.freshnessStatus, "unknown");
  assert.equal(result.patch.status, "pending_moderation");
});

test("reconcileImportedProductReadiness blocks invalid or future read timestamps", async () => {
  for (const checkedAt of ["not-a-date", new Date(Date.now() + 10 * 60 * 1000).toISOString()]) {
    const result = await reconcileImportedProductReadiness(pendingModerationJob(), {
      readProductStatus: async () => ({
        products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "selling" }, visible: true }],
        readAttempt: { checkedAt, requestedOfferCount: 1, endpointAttempts: ["/v3/product/list", "/v3/product/info/list"] },
      }),
    });
    assert.equal(result.patch.status, "pending_moderation");
    assert.equal(result.evidence.readStatus, "timestamp_invalid");
    assert.equal(result.evidence.freshnessStatus, "invalid");
    assert.equal(result.evidence.freshnessReasonCode, "READ_EVIDENCE_TIMESTAMP_INVALID");
    assert.equal(result.evidence.live, false);
  }
});

test("reconcileImportedProductReadiness preserves partial Seller API evidence without claiming ready", async () => {
  const result = await reconcileImportedProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => ({
      listResponse: { result: { items: [{ offer_id: "FIXTURE-READY", product_id: 83001 }] } },
      detailResponse: null,
      readAttempt: {
        requestedOfferCount: 1,
        endpointAttempts: ["/v3/product/list", "/v3/product/info/list"],
        endpointFailures: [{ endpoint: "/v3/product/info/list", reasonCode: "READ_FAILED" }],
      },
    }),
  });

  assert.equal(result.patch.status, "pending_moderation");
  assert.equal(result.evidence.readStatus, "partial");
  assert.equal(result.evidence.live, false);
  assert.equal(result.evidence.coverageComplete, true);
  assert.deepEqual(result.evidence.endpointFailures, [{ endpoint: "/v3/product/info/list", reasonCode: "READ_FAILED" }]);

  const inspection = await inspectAutoListingProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "pending" } }],
      readAttempt: { endpointFailures: [{ endpoint: "/v3/product/info/list", reasonCode: "READ_FAILED" }] },
    }),
  });
  assert.equal(inspection.sellerView.statusLabel, "状态部分读取");
  assert.match(inspection.sellerView.nextAction, /完整回查/);
});

test("reconcileImportedProductReadiness blocks a successful response with missing Offer coverage", async () => {
  const result = await reconcileImportedProductReadiness({
    ...pendingModerationJob(),
    listingResult: {
      ...pendingModerationJob().listingResult,
      importInfo: {
        result: {
          task_id: 70010,
          items: [
            { offer_id: "FIXTURE-READY", product_id: 83001, status: "imported", errors: [] },
            { offer_id: "FIXTURE-MISSING", product_id: 83002, status: "imported", errors: [] },
          ],
        },
      },
    },
  }, {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "selling" }, visible: true }],
      readAttempt: { checkedAt: new Date().toISOString(), endpointAttempts: ["/v3/product/list", "/v3/product/info/list"] },
      readAttempt: {
        requestedOfferCount: 2,
        endpointAttempts: ["/v3/product/list", "/v3/product/info/list"],
      },
    }),
  });

  assert.equal(result.patch.status, "pending_moderation");
  assert.equal(result.evidence.readStatus, "partial");
  assert.equal(result.evidence.observedOfferCount, 1);
  assert.equal(result.evidence.coverageComplete, false);
  assert.equal(result.evidence.live, false);
});

test("reconcileImportedProductReadiness does not treat a bounded remote page as full multi-SKU coverage", async () => {
  const job = {
    ...pendingModerationJob(),
    listingResult: {
      ...pendingModerationJob().listingResult,
      importInfo: {
        result: {
          task_id: 70010,
          items: Array.from({ length: 101 }, (_, index) => ({
            offer_id: `FIXTURE-${index}`,
            product_id: 83001 + index,
            status: "imported",
            errors: [],
          })),
        },
      },
    },
  };
  const result = await reconcileImportedProductReadiness(job, {
    readProductStatus: async () => ({
      // The server adapter can only request one bounded page.
      products: [{ offer_id: "FIXTURE-0", product_id: 83001, status: { state: "selling" }, visible: true }],
      readAttempt: {
        requestedOfferCount: 100,
        endpointAttempts: ["/v3/product/list", "/v3/product/info/list"],
      },
    }),
  });

  assert.equal(result.patch.status, "pending_moderation");
  assert.equal(result.evidence.requestedOfferCount, 101);
  assert.equal(result.evidence.remoteRequestedOfferCount, 100);
  assert.equal(result.evidence.coverageComplete, false);
  assert.equal(result.evidence.live, false);
});

test("reconcileImportedProductReadiness rejects stale moderation evidence", async () => {
  const result = await reconcileImportedProductReadiness({
    ...pendingModerationJob(),
    updatedAt: "2026-07-12T09:00:00.000Z",
  }, {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "selling" }, visible: true }],
      readAttempt: {
        checkedAt: "2026-07-12T08:59:00.000Z",
        requestedOfferCount: 1,
        endpointAttempts: ["/v3/product/list"],
      },
    }),
  });

  assert.equal(result.patch.status, "pending_moderation");
  assert.equal(result.evidence.state, "ready_for_sale");
  assert.equal(result.evidence.readStatus, "stale");
  assert.equal(result.evidence.freshnessStatus, "stale");
  assert.equal(result.evidence.freshnessReasonCode, "READ_EVIDENCE_STALE");
  assert.equal(result.evidence.live, false);
});

test("stale moderation failure does not become a current repair task", async () => {
  const result = await reconcileImportedProductReadiness({
    ...pendingModerationJob(),
    updatedAt: "2026-07-12T09:00:00.000Z",
  }, {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "failed" }, errors: [{ code: "OLD_FAILURE" }] }],
      readAttempt: { checkedAt: "2026-07-12T08:59:00.000Z", requestedOfferCount: 1 },
    }),
  });
  assert.equal(result.patch.status, "pending_moderation");
  assert.equal(result.evidence.readStatus, "stale");
  assert.equal(result.evidence.state, "moderation_failed");
});

test("reconcileImportedProductReadiness maps moderation failure to a review patch", async () => {
  const result = await reconcileImportedProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "failed" }, errors: [{ code: "MODERATION_FAILED" }] }],
    }),
  });

  assert.equal(result.patch.status, "needs_review");
  assert.equal(result.patch.stage, "moderation_failed");
  assert.equal(result.evidence.state, "moderation_failed");
  assert.equal(result.evidence.live, false);
});

test("readiness inspection exposes bounded task/product/offer field repair tasks", async () => {
  const job = pendingModerationJob();
  job.listingResult.importInfo.result.items[0].product_id = 83001;
  const result = await inspectAutoListingProductReadiness(job, {
    readProductStatus: async () => ({
      products: [{
        offer_id: "FIXTURE-READY",
        product_id: 83001,
        status: { state: "failed" },
        errors: [{ code: "MISSING_MODEL", attribute_id: 9048, message: "Укажите модель товара" }],
      }],
    }),
  });
  assert.equal(result.sellerView.repairTasks.length, 1);
  assert.equal(result.sellerView.repairTasks[0].taskId, 70010);
  assert.equal(result.sellerView.repairTasks[0].productId, 83001);
  assert.equal(result.sellerView.repairTasks[0].offerId, "FIXTURE-READY");
  assert.equal(result.sellerView.repairTasks[0].fieldPath, "items[offer_id=FIXTURE-READY].attributes[id=9048]");
  assert.match(result.sellerView.repairTasks[0].action, /重新预检/);
});

test("readiness inspection keeps a generic repair task when moderation omits field errors", async () => {
  const result = await inspectAutoListingProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "failed" } }],
    }),
  });
  assert.equal(result.sellerView.repairTasks.length, 1);
  assert.equal(result.sellerView.repairTasks[0].code, "MODERATION_FAILED");
  assert.equal(result.sellerView.repairTasks[0].fieldPath, "items[offer_id=FIXTURE-READY].attributes");
});

test("reconcileImportedProductReadiness keeps unknown status and dependency failures pending", async () => {
  const unknown = await reconcileImportedProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => ({ products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "unknown_new_state" } }] }),
  });
  assert.equal(unknown.patch.status, "pending_moderation");
  assert.equal(unknown.evidence.live, false);

  const failedDependency = await reconcileImportedProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => { throw new Error("fixture adapter unavailable"); },
  });
  assert.equal(failedDependency.patch.status, "pending_moderation");
  assert.equal(failedDependency.evidence.live, false);
  assert.equal(failedDependency.evidence.readError, "fixture adapter unavailable");

  const missingDependency = await reconcileImportedProductReadiness(pendingModerationJob());
  assert.equal(missingDependency.patch.status, "pending_moderation");
  assert.equal(missingDependency.evidence.readStatus, "dependency_not_provided");
  assert.equal(missingDependency.evidence.live, false);
});

test("readiness inspection with no offers makes no Ozon call and cannot report a completed read", async () => {
  let calls = 0;
  const job = pendingModerationJob();
  job.listingResult.importInfo = { result: { task_id: 70010, items: [] } };
  const result = await inspectAutoListingProductReadiness(job, {
    readProductStatus: async () => {
      calls += 1;
      return { products: [] };
    },
  });

  assert.equal(calls, 0);
  assert.notEqual(result.evidenceSummary.readStatus, "completed");
  assert.equal(result.evidenceSummary.endpointAttempted, false);
  assert.equal(result.evidenceSummary.requestedOfferCount, 0);
});

test("single job readiness inspection is read-only and returns a seller-facing evidence view", async () => {
  const job = pendingModerationJob();
  const before = structuredClone(job);
  const result = await inspectAutoListingProductReadiness(job, {
    now: () => new Date("2026-07-12T08:30:00.000Z"),
    readProductStatus: async () => ({
      listResponse: { result: { items: [{ offer_id: "FIXTURE-READY", product_id: 83001 }] } },
      detailResponse: { items: [{ offer_id: "FIXTURE-READY", id: 83001, status: { state: "moderating" }, visible: false }] },
      readAttempt: { endpointAttempts: ["/v3/product/list", "/v3/product/info/list"], operationEvidence: [{ operationPath: "/v3/product/list", responseHash: `sha256:${"a".repeat(64)}`, verificationLevel: "server_observed" }] },
    }),
  });

  assert.deepEqual(job, before);
  assert.equal(result.readOnly, true);
  assert.equal(result.sellerView.statusLabel, "Ozon 审核中");
  assert.equal(result.sellerView.evidenceAt, "2026-07-12T08:30:00.000Z");
  assert.match(result.sellerView.reason, /尚未明确可售/);
  assert.match(result.sellerView.nextAction, /稍后重新回查/);
  assert.equal(result.evidenceSummary.state, "pending_moderation");
  assert.equal(result.evidenceSummary.operationEvidence.length, 1);
  assert.equal(Object.hasOwn(result, "patch"), false);
  assert.equal(Object.hasOwn(result, "evidence"), false);
});

test("single job readiness inspection only reports sale ready from explicit read evidence", async () => {
  const result = await inspectAutoListingProductReadiness(pendingModerationJob(), {
    now: () => new Date("2026-07-12T08:31:00.000Z"),
    readProductStatus: async () => ({
      products: [{ offer_id: "FIXTURE-READY", product_id: 83001, status: { state: "selling" }, visible: true }],
      readAttempt: { checkedAt: "2026-07-12T08:31:00.000Z", endpointAttempts: ["/v3/product/list", "/v3/product/info/list"] },
    }),
  });

  assert.equal(result.sellerView.statusLabel, "已明确可售");
  assert.equal(result.evidenceSummary.live, true);
  assert.equal(result.evidenceSummary.state, "ready_for_sale");
  assert.match(result.sellerView.nextAction, /库存预演/);
});

test("single job readiness inspection hides adapter errors and limits seller offer evidence", async () => {
  const failed = await inspectAutoListingProductReadiness(pendingModerationJob(), {
    readProductStatus: async () => { throw new Error("API key=secret-value upstream body={private:true}"); },
  });
  const failedJson = JSON.stringify(failed);
  assert.equal(failed.sellerView.statusLabel, "状态读取失败");
  assert.match(failed.sellerView.reason, /只读回查失败/);
  assert.doesNotMatch(failedJson, /secret-value|private:true|readError|"patch"|"evidence"/);

  const manyOffers = Array.from({ length: 150 }, (_, index) => ({
    offer_id: `SAFE-${index}`,
    product_id: index + 1,
    status: { state: "moderating" },
  }));
  const manyOfferJob = pendingModerationJob();
  manyOfferJob.listingResult.importInfo.result.items = manyOffers.map((item) => ({
    offer_id: item.offer_id,
    product_id: item.product_id,
    status: "imported",
    errors: [],
  }));
  const limited = await inspectAutoListingProductReadiness(manyOfferJob, {
    readProductStatus: async () => ({ products: manyOffers }),
  });
  assert.equal(limited.sellerView.offers.length, 100);
  assert.equal(limited.evidenceSummary.offerCount, 150);
  assert.equal(limited.evidenceSummary.offersTruncated, true);
});

test("product status adapter joins list and detail evidence without inventing sale readiness", () => {
  const products = normalizeOzonProductStatusProducts({
    listResponse: {
      result: {
        items: [
          { offer_id: "SKU-PENDING", product_id: 9001 },
          { offer_id: "SKU-READY", product_id: 9002 },
        ],
      },
    },
    detailResponse: {
      items: [
        { offer_id: "SKU-PENDING", id: 9001, status: { state: "moderating", state_name: "Moderating" }, visible: false },
        { offer_id: "SKU-READY", id: 9002, status: { state: "selling", state_name: "For sale" }, visible: true },
      ],
    },
  });

  assert.deepEqual(products, [
    { offer_id: "SKU-PENDING", product_id: 9001, status: { state: "moderating", state_name: "Moderating" }, status_group: "", status_name: "Moderating", visible: false, errors: [] },
    { offer_id: "SKU-READY", product_id: 9002, status: { state: "selling", state_name: "For sale" }, status_group: "", status_name: "For sale", visible: true, errors: [] },
  ]);
});

test("product status adapter keeps missing detail unknown and preserves errors", () => {
  const products = normalizeOzonProductStatusProducts({
    listResponse: { result: { items: [{ offer_id: "SKU-UNKNOWN", product_id: 9010 }] } },
    detailResponse: { items: [] },
    errorsByOffer: { "SKU-UNKNOWN": [{ code: "DETAIL_NOT_RETURNED" }] },
  });

  assert.deepEqual(products, [{
    offer_id: "SKU-UNKNOWN",
    product_id: 9010,
    status: "",
    status_group: "",
    status_name: "",
    visible: null,
    errors: [{ code: "DETAIL_NOT_RETURNED" }],
  }]);
});

test("normalizeImportReadiness preserves per-offer import evidence without promoting imported to live", () => {
  const importInfo = {
    result: {
      task_id: 70001,
      items: [
        { offer_id: "FIXTURE-WHITE", product_id: 81001, status: "imported", errors: [] },
        { offer_id: "FIXTURE-BLUE", product_id: 81002, status: "imported", errors: [{ code: "WARNING_IMAGE", level: "warning", message: "image queued" }] },
      ],
    },
  };

  const readiness = normalizeImportReadiness({ importInfo });
  assert.equal(readiness.state, "imported");
  assert.equal(readiness.live, false);
  assert.equal(readiness.taskId, 70001);
  assert.deepEqual(readiness.offers, [
    { offerId: "FIXTURE-WHITE", productId: 81001, importStatus: "imported", moderationStatus: "unknown", errors: [], errorReasonCode: "" },
    { offerId: "FIXTURE-BLUE", productId: 81002, importStatus: "imported", moderationStatus: "unknown", errors: [{ code: "WARNING_IMAGE", level: "warning", message: "image queued" }], errorReasonCode: "WARNING_IMAGE" },
  ]);
});

test("product import info mocked fixtures cover pending/imported/error/partial/timeout without live claims", async () => {
  const root = path.join(process.cwd(), "test", "fixtures", "ozon", "product-import-info");
  const scenarios = ["pending", "imported", "error", "partial", "timeout"];
  for (const scenario of scenarios) {
    const fixture = JSON.parse(await fs.readFile(path.join(root, `${scenario}.mocked.json`), "utf8"));
    assert.equal(fixture.fixtureKind, "mocked_redacted_product_import_info", scenario);
    assert.equal(fixture.synthetic, true, scenario);
    assert.equal(fixture.redacted, true, scenario);
    assert.equal(fixture.verificationLevel, "mocked", scenario);
    assert.equal(fixture.scenario, scenario);
    assert.doesNotMatch(JSON.stringify(fixture), /api[_-]?key|client[_-]?secret|authorization|token/i, scenario);
  }
  const pending = JSON.parse(await fs.readFile(path.join(root, "pending.mocked.json"), "utf8"));
  assert.equal(normalizeImportReadiness({ importInfo: pending }).state, "accepted");
  const imported = JSON.parse(await fs.readFile(path.join(root, "imported.mocked.json"), "utf8"));
  assert.equal(normalizeImportReadiness({ importInfo: imported }).state, "imported");
  const partial = JSON.parse(await fs.readFile(path.join(root, "partial.mocked.json"), "utf8"));
  assert.equal(partial.coverage.coverageComplete, false);
  const timeout = JSON.parse(await fs.readFile(path.join(root, "timeout.mocked.json"), "utf8"));
  assert.equal(timeout.transport.responseObserved, false);
});

test("import-info timeout is an unknown outcome and cannot be treated as a successful read", async () => {
  const calls = [];
  const timeout = JSON.parse(await fs.readFile(path.join(process.cwd(), "test", "fixtures", "ozon", "product-import-info", "timeout.mocked.json"), "utf8"));
  const result = await waitForImportInfo({ id: "fixture-store" }, timeout.requestScope.task_id, 2, {
    sleep: async () => {},
    ozonRequest: async (_store, endpoint, body) => {
      calls.push({ endpoint, body });
      const error = new Error(timeout.transport.errorCode);
      error.code = timeout.transport.errorCode;
      throw error;
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.__importInfoStatus, "unknown");
  assert.match(result.error, /OZON_READ_TIMEOUT/);
  assert.equal(Array.isArray(result?.result?.items), false);
});

test("normalizeImportReadiness distinguishes accepted, moderation pending, failed, and ready for sale", () => {
  const accepted = normalizeImportReadiness({
    importInfo: { result: { task_id: 70002, items: [{ offer_id: "FIXTURE-A", status: "accepted", errors: [] }] } },
  });
  assert.equal(accepted.state, "accepted");

  const importedInfo = { result: { task_id: 70003, items: [{ offer_id: "FIXTURE-B", product_id: 82001, status: "imported", errors: [] }] } };
  const pending = normalizeImportReadiness({
    importInfo: importedInfo,
    products: [{ offer_id: "FIXTURE-B", product_id: 82001, status: { state: "moderating" }, visible: false }],
  });
  assert.equal(pending.state, "pending_moderation");
  assert.equal(pending.live, false);

  const failed = normalizeImportReadiness({
    importInfo: importedInfo,
    products: [{ offer_id: "FIXTURE-B", product_id: 82001, status: { state: "failed", state_name: "Requires revision" }, errors: [{ code: "MODERATION_FAILED" }] }],
  });
  assert.equal(failed.state, "moderation_failed");
  assert.deepEqual(failed.offers[0].errors, [{ code: "MODERATION_FAILED" }]);
  assert.equal(failed.offers[0].errorReasonCode, "MODERATION_FAILED");

  const ready = normalizeImportReadiness({
    importInfo: importedInfo,
    products: [{ offer_id: "FIXTURE-B", product_id: 82001, status: { state: "selling" }, visible: true }],
  });
  assert.equal(ready.state, "ready_for_sale");
  assert.equal(ready.live, true);
});

test("import reconciliation never treats imported items as live or moderation-approved", () => {
  assert.deepEqual(importReconcileState({ importedCount: 2, blockingErrors: [], listingDefects: [] }), {
    status: "pending_moderation",
    stage: "pending_moderation",
    readiness: "imported",
  });
});

test("import reconciliation keeps blocking errors failed", () => {
  assert.deepEqual(importReconcileState({ importedCount: 1, blockingErrors: [{ code: "INVALID_ATTRIBUTE" }], listingDefects: [] }), {
    status: "failed",
    stage: "failed",
    readiness: "import_failed",
  });
});

test("modelAttributesForMeta uses only the category model attribute", () => {
  const attrs = modelAttributesForMeta("Брелок Котик", [
    { id: 9048, name: "Другое поле" },
    { id: 22390, name: "Название модели (для объединения в одну карточку)", is_required: true },
  ]);

  assert.deepEqual(attrs, [{
    id: 22390,
    complex_id: 0,
    values: [{ value: "Брелок Котик" }],
  }]);
});
import { classifyOzonImageText } from "../src/imageOss.js";

test("buildListingDescription wires product description into Ozon annotation text", () => {
  const result = buildListingDescription({
    title_ru: "Автокормушка для кошек и собак",
    description_ru: "Автоматическая подача корма и воды для ежедневного ухода за питомцем.",
    annotation_ru: "",
  }, "fallback");

  assert.match(result, /Автоматическая подача корма/);
  assert.ok(result.length > 40);
});

test("buildMarketingAttributes fills dynamic annotation and tags attributes from category metadata", () => {
  const attrs = buildMarketingAttributes({
    description_ru: "Практичная миска на подставке для корма и воды.",
    hashtags_ru: "#миска #кормушка #питомцы",
    rich_content_json: JSON.stringify({ content: [{ widgetName: "raTextBlock", text: { content: ["x"] } }], version: 0.3 }),
  }, [
    { id: 9001, name: "简介" },
    { id: 9002, name: "#主题标签" },
    { id: 9003, name: "JSON 富内容" },
  ]);

  assert.equal(attrs.find((a) => a.id === 9001)?.values[0].value, "Практичная миска на подставке для корма и воды.");
  assert.equal(attrs.find((a) => a.id === 9002)?.values[0].value, "#миска #кормушка #питомцы");
  assert.ok(attrs.find((a) => a.id === 9003)?.values[0].value.includes("raTextBlock"));
});

test("buildMarketingAttributes normalizes concatenated hashtags for Ozon validation", () => {
  const attrs = buildMarketingAttributes({
    description_ru: "Мягкий брелок в виде котенка.",
    hashtags_ru: "#брелок#плюшевый#подарокдевушке#оченьдлинныйхештегкоторыйнадообрезать",
  }, [
    { id: 9002, name: "#Хештеги" },
  ]);
  const tags = attrs.find((a) => a.id === 9002)?.values[0].value || "";
  const parts = tags.split(/\s+/).filter(Boolean);

  assert.deepEqual(parts.slice(0, 3), ["#брелок", "#плюшевый", "#подарокдевушке"]);
  assert.ok(parts.every((tag) => tag.startsWith("#") && tag.length <= 30));
});

test("selectPreparedOzonImages uses translated/clean images and drops skipped OCR results", () => {
  const selected = selectPreparedOzonImages([
    { sourceUrl: "https://example.com/factory.jpg", skipped: true, reason: "factory_intro" },
    { sourceUrl: "https://example.com/chinese.jpg", url: "https://oss.example.com/chinese-ru.jpg", translated: true },
    { sourceUrl: "https://example.com/plain.jpg", url: "https://oss.example.com/plain.jpg" },
  ], ["https://example.com/fallback.jpg"]);

  assert.deepEqual(selected, [
    "https://oss.example.com/chinese-ru.jpg",
    "https://oss.example.com/plain.jpg",
  ]);
});

test("default Ozon image preparation keeps enough photos for content rating", () => {
  assert.equal(getOzonImagePrepareLimit(), 8);
});

test("Ozon listing image OCR stays enabled by default", () => {
  assert.equal(isOzonImageOcrEnabledForListing(), true);
});

test("existingParentSkuForListing reuses the same SKU across retries", () => {
  assert.equal(existingParentSkuForListing({ pendingParentSku: "SKUlq00999" }), "SKUlq00999");
  assert.equal(existingParentSkuForListing({ listingResult: { sku: "SKUlq00888" } }), "SKUlq00888");
  assert.equal(existingParentSkuForListing({}), "");
});

test("minPriceFromPrice floors decimal prices and subtracts one from integer prices", () => {
  assert.equal(minPriceFromPrice(25.2), "25");
  assert.equal(minPriceFromPrice(25), "24");
});

test("variantOfferId uses parent SKU plus Russian variant suffix", () => {
  assert.equal(
    variantOfferId("SKUlq00127", { spec: "马卡龙混色（约100根）" }, 0),
    "SKUlq00127-makaronnye-tsveta-miks-tsvetov-100-sht"
  );
});

test("variantOfferId keeps rose dome cover materials unique for same color", () => {
  assert.notEqual(
    variantOfferId("SKUlq00128", { spec: "原木单支绒布玫瑰+花瓣红色>玻璃罩" }, 0),
    variantOfferId("SKUlq00128", { spec: "原木单支绒布玫瑰+花瓣红色>亚克力罩" }, 1)
  );
});

test("dedupeSubmitItemsByOfferId removes duplicate Ozon offer ids before stock queue", () => {
  const items = [
    { offer_id: "SKUlq00128-krasnyy", name: "glass red" },
    { offer_id: "SKUlq00128-krasnyy", name: "acrylic red" },
    { offer_id: "SKUlq00128-zheltyy", name: "yellow" },
  ];

  assert.deepEqual(dedupeSubmitItemsByOfferId(items).map((item) => item.name), ["glass red", "yellow"]);
});

test("generated Offer ID collisions retain every source SKU for a repair decision", () => {
  const collisions = generatedOfferIdCollisions("PARENT-1", [
    { skuId: "sku-white-long", spec: "白色" },
    { skuId: "sku-white-short", spec: "白" },
    { skuId: "sku-blue", spec: "蓝色" },
  ]);

  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].offerId, "PARENT-1-belyy");
  assert.deepEqual(collisions[0].rows.map((row) => row.sourceSkuId), ["sku-white-long", "sku-white-short"]);
  assert.deepEqual(collisions[0].rows.map((row) => row.spec), ["白色", "白"]);
});

test("variantAspectAttributes fills Ozon aspect attributes from 1688 SKU spec", () => {
  const attrs = variantAspectAttributes({
    spec: "马卡龙混色（约100根）",
    lengthMm: 300,
  }, [
    { id: 10097, name: "颜色名称", is_aspect: true },
    { id: 4678, name: "长度，m", is_aspect: true, type: "Decimal" },
  ], 0);

  assert.equal(attrs.find((a) => a.id === 10097)?.values[0].value, "макаронные цвета микс цветов 100 шт");
  assert.equal(attrs.find((a) => a.id === 4678)?.values[0].value, "0.3");
});

test("variantAspectAttributes keeps cat keychain color variants distinct", () => {
  const attrsMeta = [{ id: 10097, name: "颜色名称", is_aspect: true }];
  const values = ["米色", "黑色", "白色", "黄色", "蓝色"].map((spec, index) =>
    variantAspectAttributes({ spec }, attrsMeta, index).find((a) => a.id === 10097)?.values[0].value
  );

  assert.deepEqual(values, ["бежевый", "черный", "белый", "желтый", "синий"]);
  assert.equal(new Set(values).size, values.length);
});

test("variantAspectAttributes maps dictionary aspect values from translated 1688 specs", () => {
  const attrsMeta = [{
    id: 10096,
    name: "Цвет товара",
    is_aspect: true,
    dictionary_id: 1494,
    dictionary_values: [
      { id: 1, value: "Белый" },
      { id: 2, value: "Синий" },
    ],
  }];

  const white = variantAspectAttributes({ spec: "白色" }, attrsMeta, 0);
  const blue = variantAspectAttributes({ spec: "蓝色" }, attrsMeta, 1);

  assert.deepEqual(white, [{ id: 10096, complex_id: 0, values: [{ dictionary_value_id: 1 }] }]);
  assert.deepEqual(blue, [{ id: 10096, complex_id: 0, values: [{ dictionary_value_id: 2 }] }]);
});

test("mergeVariantListingAttributes lets variant aspects override base attributes", () => {
  const merged = mergeVariantListingAttributes([
    { id: 10097, complex_id: 0, values: [{ value: "белый" }] },
    { id: 85, complex_id: 0, values: [{ value: "Нет бренда" }] },
  ], [
    { id: 10097, complex_id: 0, values: [{ value: "черный" }] },
  ]);

  assert.equal(merged.find((a) => a.id === 10097)?.values[0].value, "черный");
  assert.equal(merged.find((a) => a.id === 85)?.values[0].value, "Нет бренда");
});

test("mergeRetryModelAttributes preserves required non-model attributes", () => {
  const merged = mergeRetryModelAttributes([
    { id: 4958, complex_id: 0, values: [{ dictionary_value_id: 33754 }] },
    { id: 9048, complex_id: 0, values: [{ value: "old model" }] },
  ], { id: 85, complex_id: 0, values: [{ value: "Нет бренда" }] }, [
    { id: 9048, complex_id: 0, values: [{ value: "new model" }] },
    { id: 8229, complex_id: 0, values: [{ value: "new model" }] },
  ]);

  assert.equal(merged.find((a) => a.id === 4958)?.values[0].dictionary_value_id, 33754);
  assert.equal(merged.find((a) => a.id === 9048)?.values[0].value, "new model");
  assert.equal(merged.find((a) => a.id === 85)?.values[0].value, "Нет бренда");
});

test("buildLazyContentAttributeValues fills common optional attributes from 1688 and Ozon hints", () => {
  const attrs = buildLazyContentAttributeValues([
    { id: 9101, name: "Материал" },
    { id: 9102, name: "Упаковка" },
    { id: 9103, name: "Комплектация" },
    { id: 9104, name: "Особенности товара" },
  ], {
    lc: {
      title_ru: "Автоматическая кормушка для кошек",
      description_ru: "Практичная кормушка с антискользящей подставкой.",
    },
    productData: {
      attributes: [
        { name: "材质", value: "PP пластик" },
        { name: "包装", value: "袋装" },
      ],
    },
    ozonContext: {
      attributes: [
        { name: "Комплектация", value: "миска, подставка" },
      ],
    },
  });

  assert.equal(attrs.find((a) => a.id === 9101)?.values[0].value, "пластик");
  assert.match(attrs.find((a) => a.id === 9102)?.values[0].value || "", /пакет|袋/i);
  assert.equal(attrs.find((a) => a.id === 9103)?.values[0].value, "миска, подставка");
  assert.match(attrs.find((a) => a.id === 9104)?.values[0].value || "", /антискольз/i);
});

test("buildLazyContentAttributeValues reuses DeepSeek attributes_hint without extra AI calls", () => {
  const attrs = buildLazyContentAttributeValues([
    { id: 9201, name: "Материал" },
    { id: 9202, name: "Цвет" },
    { id: 9203, name: "Назначение" },
  ], {
    lc: {
      title_ru: "Мягкая игрушка-брелок",
      attributes_hint: {
        material: "плюш",
        color: "розовый",
        purpose: "для ключей и сумки",
      },
    },
  });

  assert.equal(attrs.find((a) => a.id === 9201)?.values[0].value, "плюш");
  assert.equal(attrs.find((a) => a.id === 9202)?.values[0].value, "розовый");
  assert.equal(attrs.find((a) => a.id === 9203)?.values[0].value, "для ключей и сумки");
});

test("buildLazyContentAttributeValues keeps numeric package fields numeric", () => {
  const attrs = buildLazyContentAttributeValues([
    { id: 9301, name: "Вес с упаковкой, г" },
    { id: 11650, name: "包装" },
    { id: 9303, name: "Упаковка" },
  ], {
    packageInfo: { weight: 120 },
    productData: {
      attributes: [{ name: "包装", value: "OPP袋" }],
    },
  });

  assert.equal(attrs.find((a) => a.id === 9301)?.values[0].value, "120");
  assert.equal(attrs.find((a) => a.id === 11650)?.values[0].value, "1");
  assert.equal(attrs.find((a) => a.id === 9303)?.values[0].value, "пакетная упаковка");
});

test("normalizeOzonTitleForListing rewrites silicone craft mold titles into natural Russian", () => {
  const title = normalizeOzonTitleForListing(
    "Силиконовая форма для цветов пион и камелия, DIY молд шоколада, выпечки, свечей, эпоксидной смолы гипса",
    {
      candidateTitle: "杜丹花diy山茶花花朵手工硅胶模具巧克力烘焙香薰蜡烛滴胶石膏模",
      ozonTitle: "Набор для творчества с эпоксидной смолой, Силиконовый молд",
    }
  );

  assert.equal(title, "Силиконовая форма Пион и камелия для свечей и изделий из эпоксидной смолы");
  assert.doesNotMatch(title, /\bDIY\b|молд/i);
});

test("normalizeOzonTitleForListing removes Chinese fragments from cat keychain titles", () => {
  const title = normalizeOzonTitleForListing(
    "Брелок котёнок 3D, подвеска на сумку и ключи, милый卡通立体 из смолы",
    {
      candidateTitle: "软萌小猫咪钥匙扣卡通立体公仔挂件可爱背包包挂饰学生党摆件饰品",
      productType: "Брелок",
    }
  );

  assert.equal(title, "Брелок котёнок 3D подвеска на сумку и ключи милый из смолы");
  assert.doesNotMatch(title, /[\u3400-\u9fff]/);
});

test("splitImportWarningsAndErrors does not block imported products with warnings only", () => {
  const result = splitImportWarningsAndErrors([
    { level: "warning", code: "BR_hashtag_validation", message: "warning" },
    { level: "WARNING", code: "VALUE_MUST_BE_INTEGER", message: "warning" },
  ]);

  assert.equal(result.blockingErrors.length, 0);
  assert.equal(result.warnings.length, 2);
});

test("splitImportWarningsAndErrors treats failed variant grouping as a listing defect", () => {
  const defect = {
    level: "warning",
    code: "double_without_merger_offer",
    message: "Cannot merge products because variable characteristics are identical",
  };
  const result = splitImportWarningsAndErrors([defect]);

  assert.equal(result.blockingErrors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.listingDefects, [defect]);
});

test("importFeedbackState keeps imported variant grouping defects out of live state", () => {
  const state = importFeedbackState({
    importedItems: [{ product_id: 88 }],
    listingDefects: [{ code: "double_without_merger_offer" }],
  });

  assert.deepEqual(state, {
    status: "needs_review",
    stage: "listing_defect",
    reasonCode: "VARIANT_GROUPING_FAILED",
  });
});

test("shouldAutoRetryImport never collapses a multi-variant batch into one item", () => {
  const modelError = [{ code: "ATTRIBUTE_REQUIRED", message: "Название модели обязательное поле" }];

  assert.equal(shouldAutoRetryImport(5, modelError), false);
  assert.equal(shouldAutoRetryImport(1, modelError), true);
});

test("findDuplicateListingJob blocks repeated Ozon or 1688 product submissions", () => {
  const jobs = [
    {
      id: "old_live",
      status: "live",
      ozonUrl: "https://www.ozon.ru/product/foo-123/?utm=1",
      bestMatch: { candidateUrl: "https://detail.1688.com/offer/100.html?spm=a" },
      listingResult: { sku: "SKU001" },
    },
    {
      id: "failed_old",
      status: "failed",
      ozonUrl: "https://www.ozon.ru/product/bar-456/",
      bestMatch: { candidateUrl: "https://detail.1688.com/offer/200.html" },
    },
  ];

  assert.equal(findDuplicateListingJob({
    id: "new",
    ozonUrl: "https://www.ozon.ru/product/foo-123/",
    bestMatch: { candidateUrl: "https://detail.1688.com/offer/999.html" },
  }, jobs)?.id, "old_live");

  assert.equal(findDuplicateListingJob({
    id: "new",
    ozonUrl: "https://www.ozon.ru/product/other-999/",
    bestMatch: { candidateUrl: "https://detail.1688.com/offer/100.html" },
  }, jobs)?.id, "old_live");

  assert.equal(findDuplicateListingJob({
    id: "new",
    ozonUrl: "https://www.ozon.ru/product/bar-456/",
    bestMatch: { candidateUrl: "https://detail.1688.com/offer/200.html" },
  }, jobs), null);
});

test("classifyOzonImageText blocks delivery, return, and factory text in Chinese or Russian", () => {
  assert.deepEqual(classifyOzonImageText("Бесплатная доставка Производство, завод"), {
    hasChinese: false,
    isFactoryIntro: true,
    hasOzonPolicyText: true,
  });
  assert.deepEqual(classifyOzonImageText("厂家直销 包邮 支持退货"), {
    hasChinese: true,
    isFactoryIntro: true,
    hasOzonPolicyText: true,
  });
});
