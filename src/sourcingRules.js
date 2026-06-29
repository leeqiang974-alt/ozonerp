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
