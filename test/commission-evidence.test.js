import test from "node:test";
import assert from "node:assert/strict";

import {
  categoryScopeForCommission,
  evaluateProductListPageCoverage,
  validateExactProductRows,
  summarizeLearnedCommissionEvidence,
} from "../src/commissionEvidence.js";

const job = {
  id: "al_current",
  storeId: "store-1",
  workflowRunId: "wr_current",
  candidateId: "capture-current",
  candidateData: {
    sourceEvidence: {
      snapshotHash: `sha256:${"a".repeat(64)}`,
    },
  },
  autoCategory: {
    description_category_id: 170386,
    type_id: 91443,
    path: "Home > Fans",
  },
};

test("commission category scope is bound to the exact current listing category", () => {
  assert.deepEqual(categoryScopeForCommission(job), {
    descriptionCategoryId: 170386,
    typeId: 91443,
    categoryKey: "170386:91443",
    path: "Home > Fans",
  });
});

test("learns one FBS commission only from exact-category same-store details", () => {
  const result = summarizeLearnedCommissionEvidence({
    job,
    environment: "local",
    checkedAt: "2026-07-24T08:00:00.000Z",
    coverage: {
      complete: true,
      pageCount: 2,
      productCount: 3,
      detailCount: 3,
      priceCount: 3,
    },
    operationEvidence: [
      { operationPath: "/v3/product/list", responseHash: `sha256:${"b".repeat(64)}` },
      { operationPath: "/v3/product/info/list", responseHash: `sha256:${"c".repeat(64)}` },
      { operationPath: "/v5/product/info/prices", responseHash: `sha256:${"d".repeat(64)}` },
    ],
    productDetails: [
      {
        id: 101,
        description_category_id: 170386,
        type_id: 91443,
      },
      {
        id: 102,
        description_category_id: 170386,
        type_id: 91443,
      },
      {
        id: 103,
        description_category_id: 999,
        type_id: 91443,
      },
    ],
    priceDetails: [
      { product_id: 101, commissions: { sales_percent_fbs: 18, sales_percent_fbo: 12 } },
      { product_id: 102, commissions: { sales_percent_fbs: 18 } },
      { product_id: 103, commissions: { sales_percent_fbs: 9 } },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.commissionRate, 0.18);
  assert.equal(result.commissionSource.source, "learned_product");
  assert.equal(result.commissionSource.confidence, "medium");
  assert.equal(result.commissionSource.categoryKey, "170386:91443");
  assert.equal(result.commissionSource.sampleCount, 2);
  assert.equal(result.commissionSource.coverageComplete, true);
  assert.match(result.commissionSource.evidenceRef, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.commissions, [{ sale_schema: "FBS", percent: 18 }]);
});

test("fails closed when exact-category FBS samples disagree", () => {
  const result = summarizeLearnedCommissionEvidence({
    job,
    environment: "local",
    checkedAt: "2026-07-24T08:00:00.000Z",
    coverage: { complete: true, pageCount: 1, productCount: 2, detailCount: 2, priceCount: 2 },
    operationEvidence: [
      { operationPath: "/v3/product/list", responseHash: `sha256:${"b".repeat(64)}` },
      { operationPath: "/v3/product/info/list", responseHash: `sha256:${"c".repeat(64)}` },
      { operationPath: "/v5/product/info/prices", responseHash: `sha256:${"d".repeat(64)}` },
    ],
    productDetails: [
      { id: 101, description_category_id: 170386, type_id: 91443 },
      { id: 102, description_category_id: 170386, type_id: 91443 },
    ],
    priceDetails: [
      { product_id: 101, commissions: { sales_percent_fbs: 18 } },
      { product_id: 102, commissions: { sales_percent_fbs: 20 } },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "COMMISSION_EVIDENCE_CONFLICT");
});

test("fails closed for partial pagination or missing exact-category samples", () => {
  const partial = summarizeLearnedCommissionEvidence({
    job,
    environment: "local",
    checkedAt: "2026-07-24T08:00:00.000Z",
    coverage: { complete: false, pageCount: 20, productCount: 20000, detailCount: 20000 },
    productDetails: [],
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.reasonCode, "COMMISSION_READ_COVERAGE_INCOMPLETE");

  const partialDetails = summarizeLearnedCommissionEvidence({
    job,
    environment: "local",
    checkedAt: "2026-07-24T08:00:00.000Z",
    coverage: { complete: true, pageCount: 1, productCount: 2, detailCount: 1, priceCount: 1 },
    operationEvidence: [
      { operationPath: "/v3/product/list", responseHash: `sha256:${"b".repeat(64)}` },
      { operationPath: "/v3/product/info/list", responseHash: `sha256:${"c".repeat(64)}` },
      { operationPath: "/v5/product/info/prices", responseHash: `sha256:${"d".repeat(64)}` },
    ],
    productDetails: [
      { id: 101, description_category_id: 170386, type_id: 91443 },
    ],
    priceDetails: [{ product_id: 101, commissions: { sales_percent_fbs: 18 } }],
  });
  assert.equal(partialDetails.ok, false);
  assert.equal(partialDetails.reasonCode, "COMMISSION_READ_COVERAGE_INCOMPLETE");

  const missing = summarizeLearnedCommissionEvidence({
    job,
    environment: "local",
    checkedAt: "2026-07-24T08:00:00.000Z",
    coverage: { complete: true, pageCount: 1, productCount: 1, detailCount: 1, priceCount: 1 },
    operationEvidence: [
      { operationPath: "/v3/product/list", responseHash: `sha256:${"b".repeat(64)}` },
      { operationPath: "/v3/product/info/list", responseHash: `sha256:${"c".repeat(64)}` },
      { operationPath: "/v5/product/info/prices", responseHash: `sha256:${"d".repeat(64)}` },
    ],
    productDetails: [
      { id: 101, description_category_id: 999, type_id: 91443 },
    ],
    priceDetails: [{ product_id: 101, commissions: { sales_percent_fbs: 18 } }],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reasonCode, "COMMISSION_EXACT_CATEGORY_SAMPLE_MISSING");
});

test("fails closed without exact server-observed endpoint evidence", () => {
  const result = summarizeLearnedCommissionEvidence({
    job,
    environment: "local",
    checkedAt: "2026-07-24T08:00:00.000Z",
    coverage: { complete: true, pageCount: 1, productCount: 1, detailCount: 1, priceCount: 1 },
    operationEvidence: [
      { operationPath: "/v3/product/list", responseHash: `sha256:${"b".repeat(64)}` },
    ],
    productDetails: [
      { id: 101, description_category_id: 170386, type_id: 91443 },
    ],
    priceDetails: [{ product_id: 101, commissions: { sales_percent_fbs: 18 } }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "COMMISSION_OPERATION_EVIDENCE_INCOMPLETE");
});

test("does not reinterpret standard product-info commission rows as FBS", () => {
  const result = summarizeLearnedCommissionEvidence({
    job,
    environment: "local",
    checkedAt: "2026-07-24T08:00:00.000Z",
    coverage: { complete: true, pageCount: 1, productCount: 1, detailCount: 1, priceCount: 1 },
    operationEvidence: [
      { operationPath: "/v3/product/list", responseHash: `sha256:${"b".repeat(64)}` },
      { operationPath: "/v3/product/info/list", responseHash: `sha256:${"c".repeat(64)}` },
      { operationPath: "/v5/product/info/prices", responseHash: `sha256:${"d".repeat(64)}` },
    ],
    productDetails: [
      {
        id: 101,
        description_category_id: 170386,
        type_id: 91443,
        commissions: [{ sale_schema: "standard", percent: 18 }],
      },
    ],
    priceDetails: [{ product_id: 101, commissions: {} }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "COMMISSION_FBS_SAMPLE_INCOMPLETE");
});

test("fails closed when any exact-category product lacks explicit FBS commission", () => {
  const result = summarizeLearnedCommissionEvidence({
    job,
    environment: "local",
    checkedAt: "2026-07-24T08:00:00.000Z",
    coverage: { complete: true, pageCount: 1, productCount: 2, detailCount: 2, priceCount: 2 },
    operationEvidence: [
      { operationPath: "/v3/product/list", responseHash: `sha256:${"b".repeat(64)}` },
      { operationPath: "/v3/product/info/list", responseHash: `sha256:${"c".repeat(64)}` },
      { operationPath: "/v5/product/info/prices", responseHash: `sha256:${"d".repeat(64)}` },
    ],
    productDetails: [
      { id: 101, description_category_id: 170386, type_id: 91443 },
      { id: 102, description_category_id: 170386, type_id: 91443 },
    ],
    priceDetails: [
      { product_id: 101, commissions: { sales_percent_fbs: 18 } },
      { product_id: 102, commissions: {} },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "COMMISSION_FBS_SAMPLE_INCOMPLETE");
});

test("exact product response coverage rejects duplicate missing extra and continued rows", () => {
  assert.equal(validateExactProductRows({
    requestedIds: ["101", "102"],
    rows: [{ product_id: 101 }, { product_id: 102 }],
    cursor: "",
    total: 2,
  }).ok, true);
  assert.equal(validateExactProductRows({
    requestedIds: ["101", "102"],
    rows: [{ product_id: 101 }, { product_id: 101 }],
  }).reasonCode, "COMMISSION_PRODUCT_RESPONSE_DUPLICATE");
  assert.equal(validateExactProductRows({
    requestedIds: ["101", "102"],
    rows: [{ product_id: 101 }],
  }).reasonCode, "COMMISSION_PRODUCT_RESPONSE_SCOPE_MISMATCH");
  assert.equal(validateExactProductRows({
    requestedIds: ["101"],
    rows: [{ product_id: 101 }, { product_id: 999 }],
  }).reasonCode, "COMMISSION_PRODUCT_RESPONSE_SCOPE_MISMATCH");
  assert.equal(validateExactProductRows({
    requestedIds: ["101"],
    rows: [{ product_id: 101 }],
    cursor: "next",
    total: 1,
  }).reasonCode, "COMMISSION_PRODUCT_RESPONSE_PAGINATION_INCOMPLETE");
});

test("product-list page coverage rejects contradictory totals and duplicate continuation rows", () => {
  assert.deepEqual(evaluateProductListPageCoverage({
    seenIds: [],
    rows: [{ product_id: 101 }],
    nextCursor: "next",
    total: 2,
  }), {
    ok: true,
    complete: false,
    combinedIds: ["101"],
    nextCursor: "next",
  });
  assert.equal(evaluateProductListPageCoverage({
    seenIds: ["101"],
    rows: [{ product_id: 102 }],
    nextCursor: "",
    total: 3,
  }).reasonCode, "COMMISSION_PRODUCT_LIST_TOTAL_MISMATCH");
  assert.equal(evaluateProductListPageCoverage({
    seenIds: ["101"],
    rows: [{ product_id: 102 }],
    nextCursor: "next",
    total: 2,
  }).reasonCode, "COMMISSION_PRODUCT_LIST_PAGINATION_CONFLICT");
  assert.equal(evaluateProductListPageCoverage({
    seenIds: ["101"],
    rows: [{ product_id: 101 }],
    nextCursor: "",
  }).reasonCode, "COMMISSION_PRODUCT_LIST_DUPLICATE");
  assert.equal(evaluateProductListPageCoverage({
    rows: [{ offer_id: "missing-product-id" }],
    nextCursor: "",
  }).reasonCode, "COMMISSION_PRODUCT_LIST_ID_MISSING");
});
