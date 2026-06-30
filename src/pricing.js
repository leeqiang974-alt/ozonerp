export const RMB_SHIPPING_LEVELS = [
  {
    id: "extraSmall",
    name: "Extra Small",
    weightMinG: 1,
    weightMaxG: 500,
    priceMinCny: 0.01,
    priceMaxCny: 135,
    sizeSumMaxCm: 90,
    maxSideCm: null,
    ratePerKg: 25,
    fixedFee: 3,
  },
  {
    id: "budget",
    name: "Budget",
    weightMinG: 500,
    weightMaxG: 30000,
    priceMinCny: 0.01,
    priceMaxCny: 135,
    sizeSumMaxCm: 150,
    maxSideCm: 80,
    ratePerKg: 17,
    fixedFee: 23,
  },
  {
    id: "small",
    name: "Small",
    weightMinG: 1,
    weightMaxG: 2000,
    priceMinCny: 135.01,
    priceMaxCny: 635,
    sizeSumMaxCm: 150,
    maxSideCm: 80,
    ratePerKg: 25,
    fixedFee: 16,
  },
  {
    id: "big",
    name: "Big",
    weightMinG: 2001,
    weightMaxG: 30000,
    priceMinCny: 135.01,
    priceMaxCny: 635,
    sizeSumMaxCm: 250,
    maxSideCm: 150,
    ratePerKg: 17,
    fixedFee: 36,
  },
];

export function matchRmbShippingLevel({ weightG, lengthMm, widthMm, heightMm, priceCny }) {
  const lengthCm = Number(lengthMm) / 10;
  const widthCm = Number(widthMm) / 10;
  const heightCm = Number(heightMm) / 10;
  const sizeSumCm = lengthCm + widthCm + heightCm;
  const maxSideCm = Math.max(lengthCm, widthCm, heightCm);

  return RMB_SHIPPING_LEVELS.find((level) => {
    const passWeight = weightG >= level.weightMinG && weightG <= level.weightMaxG;
    const passPrice = priceCny >= level.priceMinCny && priceCny <= level.priceMaxCny;
    const passSizeSum = sizeSumCm <= level.sizeSumMaxCm;
    const passMaxSide = !level.maxSideCm || maxSideCm <= level.maxSideCm;
    return passWeight && passPrice && passSizeSum && passMaxSide;
  }) || null;
}

export function calculateShippingFee(level, weightG) {
  return level.ratePerKg * (Number(weightG) / 1000) + level.fixedFee;
}

export function calculateOzonPrice(input) {
  const purchaseCost = Number(input.purchaseCost || 0);
  const weightG = Number(input.weightG || 0);
  const lengthMm = Number(input.lengthMm || 0);
  const widthMm = Number(input.widthMm || 0);
  const heightMm = Number(input.heightMm || 0);
  const commissionRate = Number(input.commissionRate ?? 0.15);
  const commissionSource = normalizeCommissionSource(input.commissionSource, commissionRate);
  const miscFeeRate = Number(input.miscFeeRate ?? 0.02);
  const fixedMiscFee = Number(input.fixedMiscFee ?? 2);
  const profitRate = Number(input.profitRate ?? 0.3);
  const maxIterations = Number(input.maxIterations || 30);

  if (purchaseCost <= 0 || weightG <= 0 || lengthMm <= 0 || widthMm <= 0 || heightMm <= 0) {
    throw new Error("采购价、重量和尺寸都必须大于 0");
  }

  let estimatedPriceCny = Math.max(0.01, purchaseCost * (1 + profitRate) + fixedMiscFee);
  let previousPrice = 0;
  const steps = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const level = matchRmbShippingLevel({
      weightG,
      lengthMm,
      widthMm,
      heightMm,
      priceCny: estimatedPriceCny,
    });

    if (!level) {
      throw new Error("无法匹配 Extra Small、Budget、Small、Big 四个仓库等级，请检查人民币售价、重量和尺寸。");
    }

    const logisticsFee = calculateShippingFee(level, weightG);
    const commission = estimatedPriceCny * commissionRate;
    const miscFee = estimatedPriceCny * miscFeeRate + fixedMiscFee;
    const baseCost = purchaseCost + commission + logisticsFee + miscFee;
    const nextPrice = baseCost * (1 + profitRate);

    steps.push({
      iteration,
      assumedPriceCny: roundMoney(estimatedPriceCny),
      levelId: level.id,
      levelName: level.name,
      logisticsFee: roundMoney(logisticsFee),
      commission: roundMoney(commission),
      miscFee: roundMoney(miscFee),
      baseCost: roundMoney(baseCost),
      nextPriceCny: roundMoney(nextPrice),
    });

    if (Math.abs(nextPrice - previousPrice) < 0.01 && Math.abs(nextPrice - estimatedPriceCny) < 0.01) {
      return resultPayload(nextPrice, level, logisticsFee, commission, miscFee, baseCost, profitRate, steps, commissionRate, commissionSource);
    }

    previousPrice = estimatedPriceCny;
    estimatedPriceCny = nextPrice;
  }

  const finalStep = steps[steps.length - 1];
  const finalLevel = RMB_SHIPPING_LEVELS.find((level) => level.id === finalStep.levelId);
  return {
    ...finalStep,
    level: finalLevel,
    steps,
    converged: false,
    message: "已达到最大迭代次数，请检查参数是否导致等级反复跳变。",
    commissionRate,
    commissionSource,
  };
}

export function derivePricingPolicyFields(input = {}) {
  const priceCny = roundMoney(input.priceCny || 0);
  const baseCost = roundMoney(input.baseCost || 0);
  const hasPolicy = input.policy && typeof input.policy === "object";
  const policy = normalizePricingPolicy(input.policy || {});
  const oldPriceCny = deriveOldPrice(priceCny, policy, hasPolicy);
  const minPrice = hasPolicy
    ? derivePolicyMinimumPrice(priceCny, baseCost, policy)
    : deriveLegacyMinimumPrice(priceCny);
  return {
    pricingPolicy: policy,
    oldPriceCny,
    oldPriceSource: {
      mode: hasPolicy ? policy.oldPriceMode : "legacy_double",
      multiplier: hasPolicy ? policy.oldPriceMultiplier : 2,
      label: hasPolicy ? "原价按促销倍率生成" : "旧规则：售价乘以 2",
    },
    minPriceCny: String(minPrice.value),
    minPriceSource: minPrice.source,
    marginFloor: minPrice.marginFloor,
    blocked: minPrice.value >= priceCny,
    reasonCode: minPrice.value >= priceCny ? "PRICING_MIN_PRICE_INVALID" : "",
  };
}

function resultPayload(priceCny, level, logisticsFee, commission, miscFee, baseCost, profitRate, steps, commissionRate, commissionSource) {
  return {
    priceCny: roundMoney(priceCny),
    level,
    logisticsFee: roundMoney(logisticsFee),
    commission: roundMoney(commission),
    commissionRate,
    commissionSource,
    miscFee: roundMoney(miscFee),
    baseCost: roundMoney(baseCost),
    profit: roundMoney(priceCny - baseCost),
    profitRate,
    steps,
    converged: true,
  };
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizePricingPolicy(policy = {}) {
  return {
    targetProfitRate: Number(policy.targetProfitRate ?? policy.profitRate ?? 0.3),
    minimumProfitRate: Number(policy.minimumProfitRate ?? 0.08),
    minimumProfitCny: Number(policy.minimumProfitCny ?? 3),
    oldPriceMode: String(policy.oldPriceMode || "promo_multiplier"),
    oldPriceMultiplier: Number(policy.oldPriceMultiplier || 1.6),
    version: String(policy.version || "pricing_policy_v1"),
  };
}

function deriveOldPrice(priceCny, policy, hasPolicy) {
  const multiplier = hasPolicy ? policy.oldPriceMultiplier : 2;
  return roundMoney(priceCny * multiplier);
}

function deriveLegacyMinimumPrice(priceCny) {
  const floored = Math.floor(Number(priceCny || 0));
  const value = Math.max(1, Number.isInteger(Number(priceCny)) ? floored - 1 : floored);
  return {
    value: String(value),
    source: {
      mode: "legacy_below_sale_price",
      label: "旧规则：小数向下取整，整数减一",
    },
    marginFloor: null,
  };
}

function derivePolicyMinimumPrice(priceCny, baseCost, policy) {
  const rateFloor = policy.minimumProfitRate > 0 && policy.minimumProfitRate < 1
    ? baseCost / (1 - policy.minimumProfitRate)
    : baseCost;
  const fixedFloor = baseCost + Math.max(0, policy.minimumProfitCny || 0);
  const floor = Math.max(rateFloor, fixedFloor, 1);
  const value = Math.ceil(floor);
  return {
    value: String(value),
    source: {
      mode: "minimum_profit_floor",
      label: "按最低利润底线生成",
      minimumProfitRate: policy.minimumProfitRate,
      minimumProfitCny: policy.minimumProfitCny,
    },
    marginFloor: {
      baseCost: roundMoney(baseCost),
      minimumProfitRate: policy.minimumProfitRate,
      minimumProfitCny: policy.minimumProfitCny,
      floorCny: roundMoney(floor),
      salePriceCny: roundMoney(priceCny),
    },
  };
}

function normalizeCommissionSource(source, commissionRate) {
  if (source && typeof source === "object") {
    return compactObject({
      source: String(source.source || "manual_default"),
      label: String(source.label || commissionSourceLabel(source.source)),
      confidence: String(source.confidence || "low"),
      categoryKey: String(source.categoryKey || ""),
      updatedAt: String(source.updatedAt || ""),
    });
  }
  return {
    source: "manual_default",
    label: "手填/默认佣金率",
    confidence: "low",
    categoryKey: "",
    updatedAt: "",
    rate: commissionRate,
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== ""));
}

function commissionSourceLabel(source = "") {
  if (source === "ozon_category") return "Ozon 类目真实佣金";
  if (source === "learned_product") return "同类已上架商品学习";
  return "手填/默认佣金率";
}
