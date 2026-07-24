import { createHash } from "node:crypto";

function text(value = "") {
  return String(value ?? "").trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function evidenceHash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value)), "utf8").digest("hex")}`;
}

export function categoryScopeForCommission(job = {}) {
  const selected = job.manualCategory
    || job.autoCategory
    || job.categoryDecision?.selected
    || job.categorySelection
    || job.candidateData?.categorySelection
    || null;
  const descriptionCategoryId = positiveInteger(
    selected?.description_category_id || selected?.descriptionCategoryId,
  );
  const typeId = positiveInteger(selected?.type_id || selected?.typeId);
  if (!descriptionCategoryId || !typeId) return null;
  return {
    descriptionCategoryId,
    typeId,
    categoryKey: `${descriptionCategoryId}:${typeId}`,
    path: text(selected?.path || selected?.name),
  };
}

function detailCategoryScope(detail = {}) {
  return {
    descriptionCategoryId: positiveInteger(
      detail.description_category_id
      || detail.descriptionCategoryId
      || detail.description_category?.id,
    ),
    typeId: positiveInteger(detail.type_id || detail.typeId || detail.type?.id),
  };
}

function productId(row = {}) {
  return text(row.product_id || row.productId || row.id);
}

function explicitFbsCommissionPercent(priceDetail = {}) {
  const percent = Number(
    priceDetail?.commissions?.sales_percent_fbs
    ?? priceDetail?.commissions?.salesPercentFbs,
  );
  return Number.isFinite(percent) && percent > 0 && percent < 100 ? percent : 0;
}

function operationEvidenceComplete(operationEvidence = []) {
  const validPaths = new Set(
    (Array.isArray(operationEvidence) ? operationEvidence : [])
      .filter((row) => /^sha256:[a-f0-9]{64}$/i.test(text(row?.responseHash)))
      .map((row) => text(row?.operationPath)),
  );
  return validPaths.has("/v3/product/list")
    && validPaths.has("/v3/product/info/list")
    && validPaths.has("/v5/product/info/prices");
}

export function validateExactProductRows({
  requestedIds = [],
  rows = [],
  cursor,
  total,
} = {}) {
  const expected = [...new Set((Array.isArray(requestedIds) ? requestedIds : []).map(text).filter(Boolean))];
  const actual = (Array.isArray(rows) ? rows : []).map(productId).filter(Boolean);
  if (actual.length !== new Set(actual).size) {
    return { ok: false, reasonCode: "COMMISSION_PRODUCT_RESPONSE_DUPLICATE" };
  }
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (actual.length !== expected.length
    || actual.some((id) => !expectedSet.has(id))
    || expected.some((id) => !actualSet.has(id))) {
    return { ok: false, reasonCode: "COMMISSION_PRODUCT_RESPONSE_SCOPE_MISMATCH" };
  }
  const cursorPresent = cursor !== undefined && cursor !== null;
  if (cursorPresent && text(cursor)) {
    return { ok: false, reasonCode: "COMMISSION_PRODUCT_RESPONSE_PAGINATION_INCOMPLETE" };
  }
  const totalPresent = total !== undefined && total !== null && total !== "";
  if (totalPresent && (!Number.isSafeInteger(Number(total)) || Number(total) !== expected.length)) {
    return { ok: false, reasonCode: "COMMISSION_PRODUCT_RESPONSE_TOTAL_MISMATCH" };
  }
  return { ok: true, ids: actual };
}

export function evaluateProductListPageCoverage({
  seenIds = [],
  rows = [],
  nextCursor = "",
  total,
} = {}) {
  const seen = new Set((Array.isArray(seenIds) ? seenIds : []).map(text).filter(Boolean));
  const pageIds = (Array.isArray(rows) ? rows : []).map(productId);
  if (pageIds.some((id) => !id)) {
    return { ok: false, reasonCode: "COMMISSION_PRODUCT_LIST_ID_MISSING" };
  }
  if (pageIds.length !== new Set(pageIds).size || pageIds.some((id) => seen.has(id))) {
    return { ok: false, reasonCode: "COMMISSION_PRODUCT_LIST_DUPLICATE" };
  }
  const combinedIds = [...seen, ...pageIds];
  const totalPresent = total !== undefined && total !== null && total !== "";
  const totalNumber = Number(total);
  if (totalPresent && (!Number.isSafeInteger(totalNumber) || totalNumber < 0)) {
    return { ok: false, reasonCode: "COMMISSION_PRODUCT_LIST_TOTAL_INVALID" };
  }
  const cursor = text(nextCursor);
  if (!cursor) {
    if (totalPresent && combinedIds.length !== totalNumber) {
      return { ok: false, reasonCode: "COMMISSION_PRODUCT_LIST_TOTAL_MISMATCH" };
    }
    return { ok: true, complete: true, combinedIds, nextCursor: "" };
  }
  if (totalPresent && combinedIds.length >= totalNumber) {
    return { ok: false, reasonCode: "COMMISSION_PRODUCT_LIST_PAGINATION_CONFLICT" };
  }
  return { ok: true, complete: false, combinedIds, nextCursor: cursor };
}

/**
 * Convert a complete, same-store Seller API read into a bounded pricing input.
 * This is learned-product evidence, not an Ozon category tariff claim.
 */
export function summarizeLearnedCommissionEvidence({
  job = {},
  environment = "",
  checkedAt = "",
  coverage = {},
  operationEvidence = [],
  productDetails = [],
  priceDetails = [],
} = {}) {
  const category = categoryScopeForCommission(job);
  if (!category) {
    return { ok: false, reasonCode: "COMMISSION_CATEGORY_SCOPE_REQUIRED" };
  }
  if (coverage?.complete !== true
    || Number(coverage?.detailCount || 0) !== Number(coverage?.productCount || 0)
    || Number(coverage?.priceCount || 0) !== Number(coverage?.productCount || 0)) {
    return { ok: false, reasonCode: "COMMISSION_READ_COVERAGE_INCOMPLETE" };
  }
  if (!operationEvidenceComplete(operationEvidence)) {
    return { ok: false, reasonCode: "COMMISSION_OPERATION_EVIDENCE_INCOMPLETE" };
  }
  const exactDetails = (Array.isArray(productDetails) ? productDetails : []).filter((detail) => {
    const scope = detailCategoryScope(detail);
    return scope.descriptionCategoryId === category.descriptionCategoryId
      && scope.typeId === category.typeId;
  });
  const priceByProductId = new Map(
    (Array.isArray(priceDetails) ? priceDetails : [])
      .map((detail) => [productId(detail), detail])
      .filter(([id]) => id),
  );
  const samplePercents = exactDetails
    .map((detail) => explicitFbsCommissionPercent(priceByProductId.get(productId(detail))));
  if (!samplePercents.length || samplePercents.some((value) => !(value > 0))) {
    return {
      ok: false,
      reasonCode: exactDetails.length
        ? "COMMISSION_FBS_SAMPLE_INCOMPLETE"
        : "COMMISSION_EXACT_CATEGORY_SAMPLE_MISSING",
    };
  }
  const uniquePercents = [...new Set(samplePercents)];
  if (uniquePercents.length !== 1) {
    return {
      ok: false,
      reasonCode: "COMMISSION_EVIDENCE_CONFLICT",
      sampleCount: samplePercents.length,
      observedPercents: uniquePercents.sort((left, right) => left - right),
    };
  }
  const percent = uniquePercents[0];
  const timestamp = text(checkedAt);
  const storeId = text(job.storeId);
  const sourceSnapshotHash = text(job.candidateData?.sourceEvidence?.snapshotHash);
  if (!timestamp || !storeId || !text(environment) || !sourceSnapshotHash) {
    return { ok: false, reasonCode: "COMMISSION_EVIDENCE_BINDING_REQUIRED" };
  }
  const evidenceRef = evidenceHash({
    version: "learned_product_commission_v1",
    storeId,
    environment: text(environment),
    categoryKey: category.categoryKey,
    sourceSnapshotHash,
    checkedAt: timestamp,
    percent,
    sampleCount: samplePercents.length,
    coverage: {
      complete: true,
      pageCount: positiveInteger(coverage.pageCount),
      productCount: Math.max(0, Number(coverage.productCount || 0)),
      detailCount: Math.max(0, Number(coverage.detailCount || 0)),
      priceCount: Math.max(0, Number(coverage.priceCount || 0)),
    },
    operationEvidence: operationEvidence.map((row) => ({
      operationPath: text(row?.operationPath),
      responseHash: text(row?.responseHash),
    })).sort((left, right) => left.operationPath.localeCompare(right.operationPath)),
  });
  const commissionSource = {
    source: "learned_product",
    label: "当前店铺同类已上架商品学习",
    confidence: "medium",
    categoryKey: category.categoryKey,
    sampleCount: samplePercents.length,
    coverageComplete: true,
    evidenceRef,
    updatedAt: timestamp,
    storeId,
    environment: text(environment),
    sourceSnapshotHash,
  };
  return {
    ok: true,
    commissionRate: percent / 100,
    commissions: [{ sale_schema: "FBS", percent }],
    commissionSource,
    evidence: {
      version: "learned_product_commission_v1",
      category,
      commissionSource,
      coverage: {
        complete: true,
        pageCount: positiveInteger(coverage.pageCount),
        productCount: Math.max(0, Number(coverage.productCount || 0)),
        detailCount: Math.max(0, Number(coverage.detailCount || 0)),
        priceCount: Math.max(0, Number(coverage.priceCount || 0)),
      },
    },
  };
}
