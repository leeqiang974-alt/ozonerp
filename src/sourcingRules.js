const PACKAGE_WEIGHT_PADDING_G = 50;
const PACKAGE_SIZE_PADDING_MM = 20;

export const SOURCING_MAX_SKU_COUNT = toNumber(process.env.OZON_SOURCING_MAX_SKU_COUNT, 5);
export const SOURCING_MAX_SOURCE_WEIGHT_G = toNumber(process.env.OZON_SOURCING_MAX_SOURCE_WEIGHT_G, 400);
export const SOURCING_EXTRA_SMALL_SIZE_SUM_MAX_MM = toNumber(process.env.OZON_SOURCING_EXTRA_SMALL_SIZE_SUM_MAX_MM, 900);

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getCandidateParsed(candidate = {}) {
  return candidate.parsed && typeof candidate.parsed === "object" ? candidate.parsed : candidate;
}

function maxPositive(values = []) {
  const nums = values.map((value) => toNumber(value)).filter((value) => value > 0);
  return nums.length ? Math.max(...nums) : 0;
}

/**
 * Summarize procurement facts without making them a hard sourcing filter.
 * A candidate can still enter the review pool with missing supplier/MOQ/tier
 * data, but the seller must see that it cannot safely enter pricing or upload
 * until those facts are completed.
 */
export function buildProcurementEvidenceSummary(candidate = {}) {
  const parsed = getCandidateParsed(candidate);
  const evidence = parsed.procurementEvidence;
  const missing = [];
  if (!evidence || typeof evidence !== "object") {
    return {
      status: "unknown",
      code: "PROCUREMENT_EVIDENCE_NOT_CAPTURED",
      missing: ["supplier", "moq", "price_tiers"],
      nextAction: "重新采集供应商、MOQ 和数量绑定阶梯价，再进入定价预检。",
    };
  }
  if (!evidence.supplierId?.value && !evidence.supplierName?.value) missing.push("supplier");
  if (!(Number(evidence.moq?.value || 0) > 0)) missing.push("moq");
  const tiers = Array.isArray(evidence.priceTiers?.values) ? evidence.priceTiers.values : [];
  if (!tiers.some((tier) => Number(tier?.minQuantity || 0) > 0 && Number(tier?.unitPriceCny || 0) > 0)) missing.push("price_tiers");
  const complete = missing.length === 0;
  const fields = [evidence.supplierId, evidence.supplierName, evidence.moq, evidence.priceTiers];
  const manual = fields.some((field) => {
    if (!field || field.source === "missing") return false;
    return !["page_content", "1688_page"].includes(String(field.source || ""));
  });
  return {
    status: complete ? (manual ? "needs_review" : "observed") : "blocked",
    code: complete ? (manual ? "PROCUREMENT_EVIDENCE_REVIEW_REQUIRED" : "PROCUREMENT_EVIDENCE_OBSERVED") : "PROCUREMENT_EVIDENCE_MISSING",
    missing,
    supplierPresent: Boolean(evidence.supplierId?.value || evidence.supplierName?.value),
    moq: Number(evidence.moq?.value || 0) || null,
    priceTierCount: tiers.length,
    nextAction: complete
      ? (manual ? "核对手工/提示采购资料，并补充可回放来源快照后再定价。" : "采购证据可进入定价预检。")
      : "补齐供应商、MOQ 和数量绑定阶梯价后再进入定价预检。",
  };
}

export function evaluateSourcingCandidate(candidate = {}, options = {}) {
  const maxSkuCount = toNumber(options.maxSkuCount, SOURCING_MAX_SKU_COUNT);
  const maxWeightG = toNumber(options.maxWeightG, SOURCING_MAX_SOURCE_WEIGHT_G);
  const extraSmallSizeSumMaxMm = toNumber(options.extraSmallSizeSumMaxMm, SOURCING_EXTRA_SMALL_SIZE_SUM_MAX_MM);
  const parsed = getCandidateParsed(candidate);
  const variants = Array.isArray(parsed.skuVariants) ? parsed.skuVariants : [];
  const skuCount = variants.length || toNumber(candidate.skuCount || parsed.skuCount);
  if (skuCount > maxSkuCount) {
    return { ok: false, reasonCode: "SKU_TOO_MANY", reason: "SKU数量超过 " + maxSkuCount + " 个" };
  }

  const sw = parsed.sizeWeight || {};
  const sourceWeight = maxPositive([sw.weightG].concat(variants.map((v) => v.weightG)));
  const sourceLength = maxPositive([sw.lengthMm].concat(variants.map((v) => v.lengthMm)));
  const sourceWidth = maxPositive([sw.widthMm].concat(variants.map((v) => v.widthMm)));
  const sourceHeight = maxPositive([sw.heightMm].concat(variants.map((v) => v.heightMm)));

  if (!sourceWeight || !sourceLength || !sourceWidth || !sourceHeight) {
    return { ok: false, reasonCode: "SIZE_WEIGHT_MISSING", reason: "缺少可信重量或包装尺寸" };
  }
  if (sourceWeight > maxWeightG) {
    return { ok: false, reasonCode: "WEIGHT_TOO_HEAVY", reason: "1688重量 " + sourceWeight + "g 超过 " + maxWeightG + "g" };
  }

  const paddedWeight = sourceWeight + PACKAGE_WEIGHT_PADDING_G;
  const paddedSizeSum = sourceLength + sourceWidth + sourceHeight + PACKAGE_SIZE_PADDING_MM * 3;
  if (paddedWeight > 500 || paddedSizeSum > extraSmallSizeSumMaxMm) {
    return {
      ok: false,
      reasonCode: "NOT_EXTRA_SMALL",
      reason: "加包装余量后不符合 Extra Small: " + Math.round(paddedWeight) + "g / 尺寸和 " + Math.round(paddedSizeSum) + "mm",
    };
  }

  return {
    ok: true,
    reasonCode: "",
    reason: "符合小件选品门槛",
    skuCount,
    sourceWeight,
    sourceLength,
    sourceWidth,
    sourceHeight,
    paddedWeight,
    paddedSizeSum,
    procurement: buildProcurementEvidenceSummary(candidate),
  };
}

export function filterSourcingCandidates(candidates = [], options = {}) {
  const rejected = [];
  const accepted = [];
  for (const candidate of candidates || []) {
    const gate = evaluateSourcingCandidate(candidate, options);
    if (gate.ok) {
      accepted.push({ ...candidate, sourcingGate: gate });
    } else {
      rejected.push({ candidate, gate });
    }
  }
  return { accepted, rejected };
}
