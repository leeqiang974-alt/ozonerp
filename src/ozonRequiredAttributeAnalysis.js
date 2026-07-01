export function classifyAttributeFillStrategy(attribute = {}) {
  const id = Number(attribute.id || 0);
  const name = normalizeText(attribute.name || "");
  const description = normalizeText(attribute.description || "");
  const text = `${name} ${description}`;
  const dictionaryId = Number(attribute.dictionary_id || 0);
  const isAspect = Boolean(attribute.is_aspect);

  if (id === 9048 || /название модели|модель.*карточ|型号|模型名称/.test(text)) {
    return strategy("model_name_from_parent_sku", "用父 SKU/商品族名称统一生成模型名，用于 Ozon 合并同一卡片。", "high");
  }
  if (isOriginCountryAttribute(attribute)) {
    return strategy("fixed_country_china", "跨境 1688 货源默认中国；字典值优先匹配 Китай/中国。", "high");
  }
  if (id === 85 || /бренд|brand|品牌/.test(text)) {
    return strategy("fixed_no_brand", "固定填“Нет бренда/无品牌”，除非货源明确品牌且允许使用。", "high");
  }
  if (isAspect && /цвет|颜色|colour|color/.test(text)) {
    return strategy("variant_aspect_from_sku", "从 1688 SKU 规格提取颜色，映射 Ozon 字典值；同父 SKU 下必须区分。", "high");
  }
  if (isAspect) {
    return strategy("variant_aspect_from_sku", "从 1688 SKU 规格/变体名提取可变特性，避免同组 SKU 特征重复。", "medium");
  }
  if (/размер|尺码|尺寸|size/.test(text)) {
    return strategy("size_from_sku_or_package", "优先从 SKU 规格提取尺码；包装长宽高只用于物流，不直接冒充商品尺码。", "medium");
  }
  if (/материал|材质|材料/.test(text)) {
    return strategy(dictionaryId ? "dictionary_lookup_from_product_text" : "text_from_product_attributes", "从 1688 属性、Ozon 学习样本、标题/描述提取材质。", "medium");
  }
  if (/(^|\s)пол($|\s)|gender|性别|适用性别|назначение|применение|для кого|для чего|сценар|тип|вид|категор|объем|объ[её]м|volume|容量|体积|колич|комплект|набор|упаков|штук|шт|pieces?|pcs?|用途|适用对象|适用人群|适用场景|场景|类型|种类|数量|件数|套装|包装/.test(text) && dictionaryId) {
    return strategy("dictionary_lookup_from_product_text", "用标题、类目路径、1688 参数和 Ozon 学习样本匹配合法字典值。", "medium");
  }
  if (dictionaryId) {
    return strategy("dictionary_lookup_or_manual_rule", "需要读取属性值字典，按商品文本匹配；低置信时进入人工规则补充。", "medium");
  }
  if (/аннотац|описан|ключевые слова|тег|описание|说明|描述|关键词/.test(text)) {
    return strategy("generated_content", "由俄文标题/描述生成内容字段，提交前检查禁用词和中文残留。", "medium");
  }
  if (/вес|длина|ширина|высота|重量|长|宽|高/.test(text)) {
    return strategy("package_data", "从 1688 详情页尺重解析结果填充，缺失则阻塞。", "high");
  }
  return strategy("manual_rule_needed", "暂未归纳自动填写规则，需要积累样本或人工映射。", "low");
}

export function analyzeRequiredAttributes(cache = {}) {
  const flat = Array.isArray(cache.flat) ? cache.flat : [];
  const attributes = cache.attributes && typeof cache.attributes === "object" ? cache.attributes : {};
  const attributeValues = cache.attributeValues && typeof cache.attributeValues === "object" ? cache.attributeValues : {};
  const rows = [];
  const strategySummary = {};
  const attributeSummary = {};
  let categoriesWithCachedAttributes = 0;
  let dictionaryRequiredRows = 0;
  let dictionaryValuesCachedRows = 0;

  for (const category of flat) {
    const categoryKey = categoryAttributeCacheKey(category);
    const attrs = Array.isArray(attributes[categoryKey]) ? attributes[categoryKey] : [];
    if (attrs.length) categoriesWithCachedAttributes += 1;
    for (const attribute of attrs.filter((item) => Boolean(item.is_required))) {
      const classified = classifyAttributeFillStrategy(attribute);
      const dictionaryId = Number(attribute.dictionary_id || 0);
      const valuesKey = attributeValueCacheKey(category, attribute);
      const hasDictionaryValues = Boolean(dictionaryId && Array.isArray(attributeValues[valuesKey]?.values) && attributeValues[valuesKey].values.length);
      if (dictionaryId) dictionaryRequiredRows += 1;
      if (hasDictionaryValues) dictionaryValuesCachedRows += 1;
      strategySummary[classified.strategy] = (strategySummary[classified.strategy] || 0) + 1;
      const attrKey = String(attribute.id || attribute.name || "");
      attributeSummary[attrKey] = attributeSummary[attrKey] || {
        attributeId: Number(attribute.id || 0),
        attributeName: attribute.name || "",
        count: 0,
        dictionaryId,
        isAspect: Boolean(attribute.is_aspect),
        strategy: classified.strategy,
        confidence: classified.confidence,
      };
      attributeSummary[attrKey].count += 1;
      rows.push({
        categoryKey,
        descriptionCategoryId: Number(category.description_category_id || 0),
        typeId: Number(category.type_id || 0),
        categoryPath: category.path || category.name || "",
        attributeId: Number(attribute.id || 0),
        attributeName: attribute.name || "",
        attributeType: attribute.type || "",
        dictionaryId,
        isAspect: Boolean(attribute.is_aspect),
        maxValueCount: Number(attribute.max_value_count || 0),
        strategy: classified.strategy,
        confidence: classified.confidence,
        fillLogic: classified.fillLogic,
        dictionaryValuesCached: hasDictionaryValues,
        dictionaryValueCacheKey: dictionaryId ? valuesKey : "",
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    cacheUpdatedAt: cache.updatedAt || "",
    summary: {
      categoryTypeCount: flat.length,
      categoriesWithCachedAttributes,
      categoriesMissingAttributes: Math.max(0, flat.length - categoriesWithCachedAttributes),
      requiredAttributeRows: rows.length,
      uniqueRequiredAttributes: Object.keys(attributeSummary).length,
      dictionaryRequiredRows,
      dictionaryValuesCachedRows,
    },
    strategySummary,
    topRequiredAttributes: Object.values(attributeSummary)
      .sort((a, b) => b.count - a.count || a.attributeName.localeCompare(b.attributeName))
      .slice(0, 80),
    rows,
  };
}

export function buildRequiredAttributeFillPlan(input = {}) {
  const attrsMeta = Array.isArray(input.attrsMeta) ? input.attrsMeta : [];
  const categoryMatch = input.categoryMatch || {};
  const attributeValuesById = input.attributeValuesById || {};
  const categoryCache = input.categoryCache || {};
  const modelName = String(input.modelName || input.parentSku || "").replace(/\s+/g, " ").trim();
  const productText = normalizeText([
    input.productText,
    input.title,
    input.description,
    input.categoryPath || categoryMatch.path,
  ].filter(Boolean).join(" "));
  const packageInfo = normalizePackageInfo(input.packageInfo || {});

  return attrsMeta
    .filter((meta) => Boolean(meta?.is_required) && Number(meta?.id || 0))
    .map((meta) => fillPlanRow({
      meta,
      categoryMatch,
      attributeValuesById,
      categoryCache,
      modelName,
      productText,
      packageInfo,
    }))
    .filter(Boolean)
    .map(withFillPlanSafety);
}

export function categoryAttributeCacheKey(category = {}) {
  return `${Number(category.description_category_id || 0)}:${Number(category.type_id || 0)}`;
}

export function attributeValueCacheKey(category = {}, attribute = {}, language = "ZH_HANS") {
  return `${Number(category.description_category_id || 0)}:${Number(category.type_id || 0)}:${Number(attribute.id || 0)}:${language}`;
}

function strategy(strategyName, fillLogic, confidence) {
  return { strategy: strategyName, fillLogic, confidence };
}

function fillPlanSafetyForAction(action = "") {
  if (action === "auto_fill") {
    return {
      safetyTier: "autofill-safe",
      safetyLabelZh: "可自动填",
      requiresHumanConfirmation: false,
      blocksAutomation: false,
      safeNextStep: "进入草稿前仍需经过 Payload validation 和预检校验；不会跳过人工提交确认。",
    };
  }
  if (action === "suggest_dictionary") {
    return {
      safetyTier: "candidate-needs-human-confirmation",
      safetyLabelZh: "候选需确认",
      requiresHumanConfirmation: true,
      blocksAutomation: false,
      safeNextStep: "人工确认后只能通过 waiting_human + confirmLocalDraftRepair 写本地草稿，然后重新预检；不会提交 Ozon。",
    };
  }
  if (action === "blocked_sensitive") {
    return {
      safetyTier: "blocked-never-guess",
      safetyLabelZh: "禁止猜测",
      requiresHumanConfirmation: true,
      blocksAutomation: true,
      safeNextStep: "必须人工核实真实属性或更换货源后重新预检；系统不能猜测或自动接受。",
    };
  }
  return {
    safetyTier: "manual-required",
    safetyLabelZh: "必须人工填",
    requiresHumanConfirmation: true,
    blocksAutomation: true,
    safeNextStep: "人工填写真实属性后重新预检；系统不会用低置信内容自动补齐。",
  };
}

function withFillPlanSafety(row = {}) {
  const safety = fillPlanSafetyForAction(row.action);
  return {
    ...row,
    ...safety,
    safeNextStep: row.safeNextStep || safety.safeNextStep,
  };
}

function fillPlanRow({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  modelName = "",
  productText = "",
  packageInfo = {},
} = {}) {
  const attributeId = Number(meta.id || 0);
  const classified = classifyAttributeFillStrategy(meta);
  const base = {
    attributeId,
    name: meta.name || `属性 ${attributeId}`,
    strategy: classified.strategy,
    confidence: classified.confidence,
    action: "manual_required",
    source: "",
    reasonZh: classified.fillLogic || "需要人工确认属性值。",
  };
  if (isComplianceSensitive(meta)) {
    return {
      ...base,
      strategy: "compliance_sensitive",
      confidence: "low",
      action: "blocked_sensitive",
      source: "manual_compliance_review",
      reasonZh: "该字段涉及合规或商品安全信息，不能由系统自动填写，必须人工确认。",
    };
  }
  if (classified.strategy === "model_name_from_parent_sku") {
    return modelName
      ? {
          ...base,
          action: "auto_fill",
          source: "parent_sku",
          value: modelName,
          reasonZh: "型号名称来自父 SKU/商品族名，同一父 SKU 下所有变体保持一致，用于 Ozon 合并商品卡。",
        }
      : {
          ...base,
          action: "manual_required",
          reasonZh: "缺少父 SKU 或商品族名，不能生成稳定型号名称。",
        };
  }
  if (classified.strategy === "fixed_no_brand") {
    return fixedDictionaryOrTextPlan({
      base,
      meta,
      categoryMatch,
      attributeValuesById,
      categoryCache,
      pattern: /нет бренда|без бренда|no brand|без торговой марки|无品牌/i,
      value: "Нет бренда",
      source: "fixed_no_brand",
      reasonZh: "当前无授权品牌时固定使用无品牌；字典 ID 只来自当前 Ozon 类目缓存。",
    });
  }
  if (classified.strategy === "fixed_country_china") {
    return fixedDictionaryOrTextPlan({
      base,
      meta,
      categoryMatch,
      attributeValuesById,
      categoryCache,
      pattern: /китай|кнр|china|中国|中國/i,
      value: "Китай",
      source: "fixed_country_china",
      reasonZh: "1688 跨境货源默认原产国中国；字典 ID 只来自当前 Ozon 类目缓存。",
    });
  }
  if (classified.strategy === "package_data") {
    const value = packageValueForMeta(meta, packageInfo);
    return value
      ? {
          ...base,
          action: "auto_fill",
          source: "1688_package",
          value,
          reasonZh: "尺重来自 1688 详情解析，用于 Ozon 属性、定价和物流判断；缺失时不能猜。",
        }
      : {
          ...base,
          action: "manual_required",
          source: "1688_package_missing",
          reasonZh: "当前货源缺少完整尺重，不能自动填写包装/重量属性。",
        };
  }
  if (classified.strategy === "size_from_sku_or_package" && Number(meta.dictionary_id || meta.dictionaryId || 0)) {
    const candidates = dictionaryCandidatesForMeta({
      meta,
      categoryMatch,
      attributeValuesById,
      categoryCache,
      productText,
    });
    return {
      ...base,
      action: "suggest_dictionary",
      source: "current_category_dictionary",
      dictionaryCandidates: candidates,
      reasonZh: candidates.length
        ? "根据 SKU/商品文本匹配到当前类目合法尺码候选；需人工确认后才可写入草稿。"
        : "当前类目没有匹配到可靠尺码候选，不能用包装尺重冒充商品尺码。",
    };
  }
  if (classified.strategy === "dictionary_lookup_from_product_text"
    || classified.strategy === "dictionary_lookup_or_manual_rule") {
    const candidates = dictionaryCandidatesForMeta({
      meta,
      categoryMatch,
      attributeValuesById,
      categoryCache,
      productText,
    });
    return {
      ...base,
      action: "suggest_dictionary",
      source: "current_category_dictionary",
      dictionaryCandidates: candidates,
      reasonZh: candidates.length
        ? "根据商品文本匹配到当前类目合法字典候选；需人工确认后才可写入草稿。"
        : "当前类目没有匹配到可靠字典候选，需人工选择合法值。",
    };
  }
  return base;
}

function fixedDictionaryOrTextPlan({
  base,
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  pattern,
  value = "",
  source = "",
  reasonZh = "",
} = {}) {
  if (Number(meta.dictionary_id || meta.dictionaryId || 0)) {
    const match = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache })
      .find((entry) => pattern.test(String(entry?.value || entry?.name || "")));
    if (!match) {
      return {
        ...base,
        action: "manual_required",
        source,
        reasonZh: "当前类目字典没有找到合法固定值，不能硬编码或跨类目复用字典 ID。",
      };
    }
    return {
      ...base,
      action: "auto_fill",
      source,
      value: String(match.value || match.name || value || "").trim(),
      dictionaryValueId: dictionaryValueId(match),
      reasonZh,
    };
  }
  return {
    ...base,
    action: "auto_fill",
    source,
    value,
    reasonZh,
  };
}

function dictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  return dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache })
    .map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      if (!value) return null;
      const normalizedValue = normalizeText(value);
      const matched = normalizedValue && productText.includes(normalizedValue);
      return matched ? {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: 0.78,
        source: "product_text",
      } : null;
    })
    .filter(Boolean)
    .concat(synonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .concat(typeSynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .concat(purposeSynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .concat(genderSynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .concat(capacitySynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .concat(sizeSynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .concat(packageCountSynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .concat(countSynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .concat(scenarioSynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
    .filter((candidate, index, list) => (
      candidate.dictionaryValueId
      && list.findIndex((item) => item.dictionaryValueId === candidate.dictionaryValueId) === index
    ))
    .slice(0, 5);
}

function synonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (classified.strategy !== "dictionary_lookup_from_product_text") return [];
  const text = normalizeText(productText);
  if (!/материал|材质|材料/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const materialRules = [
    {
      sourcePattern: /пластик|plastic|pp|abs|пп|塑料|聚丙烯|pp材质|abs材质/,
      valuePattern: /пластик|полипропилен|polypropylene|plastic|abs|пп|pp|塑料|聚丙烯/i,
      source: "material_synonym",
      confidence: 0.72,
    },
    {
      sourcePattern: /металл|metal|steel|iron|alloy|不锈钢|金属|铁|合金/,
      valuePattern: /металл|сталь|нержав|желез|metal|steel|iron|alloy|金属|不锈钢|铁|合金/i,
      source: "material_synonym",
      confidence: 0.72,
    },
    {
      sourcePattern: /силикон|silicone|硅胶/,
      valuePattern: /силикон|silicone|硅胶/i,
      source: "material_synonym",
      confidence: 0.72,
    },
  ];
  const values = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache });
  return materialRules
    .filter((rule) => rule.sourcePattern.test(text))
    .flatMap((rule) => values.map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      if (!value || !rule.valuePattern.test(value)) return null;
      return {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: rule.confidence,
        source: rule.source,
      };
    }))
    .filter(Boolean);
}

function numericDictionaryCandidates({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  numbers = [],
  valuePattern,
  source = "",
  confidence = 0.68,
} = {}) {
  if (!numbers.length) return [];
  const values = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache });
  return values.map((entry) => {
    const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
    const normalizedValue = normalizeText(value);
    if (!value || !valuePattern.test(normalizedValue)) return null;
    const matched = numbers.some((number) => new RegExp(`(^|\\D)${number.replace(".", "[.,]")}(\\D|$)`).test(normalizedValue));
    if (!matched) return null;
    return {
      dictionaryValueId: dictionaryValueId(entry),
      value,
      confidence,
      source,
    };
  }).filter(Boolean);
}

function capacitySynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (classified.strategy !== "dictionary_lookup_from_product_text") return [];
  if (!/объем|объ[её]м|volume|容量|体积|毫升|литр|мл/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const numbers = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:мл|ml|毫升|литр|литра|литров|л|l)\b/g)]
    .map((match) => match[1].replace(",", "."));
  return numericDictionaryCandidates({
    meta,
    categoryMatch,
    attributeValuesById,
    categoryCache,
    numbers,
    valuePattern: /мл|ml|毫升|литр|литра|литров|(^|\s)л(\s|$)|(^|\s)l(\s|$)/,
    source: "capacity_synonym",
    confidence: 0.68,
  });
}

function countSynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (classified.strategy !== "dictionary_lookup_from_product_text") return [];
  if (!/колич|комплект|штук|шт|pieces?|pcs?|数量|件数|件|个|只|套/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const numbers = [...text.matchAll(/(\d+)\s*(?:шт|штук|pcs?|pieces?|件|个|只|套)/g)].map((match) => match[1]);
  return numericDictionaryCandidates({
    meta,
    categoryMatch,
    attributeValuesById,
    categoryCache,
    numbers,
    valuePattern: /шт|штук|pcs?|pieces?|件|个|只|套/,
    source: "count_synonym",
    confidence: 0.68,
  });
}

function sizeSynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (!["size_from_sku_or_package", "dictionary_lookup_from_product_text"].includes(classified.strategy)) return [];
  if (!/размер|尺码|尺寸|size/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const dimensionCombos = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:x|х|\*)\s*(\d+(?:[.,]\d+)?)\s*(?:см|cm|мм|mm)?\b/g)]
    .map((match) => `${match[1].replace(",", ".")}x${match[2].replace(",", ".")}`);
  const values = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache });
  if (dimensionCombos.length) {
    return values.map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      const normalizedValue = normalizeText(value);
      const valueCombo = normalizedValue.match(/(\d+(?:[.,]\d+)?)\s*(?:x|х|\*)\s*(\d+(?:[.,]\d+)?)/);
      if (!value || !valueCombo) return null;
      const signature = `${valueCombo[1].replace(",", ".")}x${valueCombo[2].replace(",", ".")}`;
      if (!dimensionCombos.includes(signature)) return null;
      return {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: 0.68,
        source: "size_synonym",
      };
    }).filter(Boolean);
  }
  const numericNumbers = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:см|cm|мм|mm)\b/g)]
    .map((match) => match[1].replace(",", "."));
  const numericCandidates = numericDictionaryCandidates({
    meta,
    categoryMatch,
    attributeValuesById,
    categoryCache,
    numbers: numericNumbers,
    valuePattern: /см|cm|мм|mm/,
    source: "size_synonym",
    confidence: 0.68,
  });
  const letterSizes = [...text.matchAll(/(?:размер|size|尺码)\s*(xs|s|m|l|xl|xxl)\b/g)]
    .map((match) => match[1]);
  const letterCandidates = values.map((entry) => {
    const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
    const normalizedValue = normalizeText(value);
    if (!value || !letterSizes.some((size) => normalizedValue === size)) return null;
    return {
      dictionaryValueId: dictionaryValueId(entry),
      value,
      confidence: 0.68,
      source: "size_synonym",
    };
  }).filter(Boolean);
  return numericCandidates.concat(letterCandidates);
}

function packageCountSynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (classified.strategy !== "dictionary_lookup_from_product_text") return [];
  if (!/упаков|комплект|набор|pack|set|套装|包装|每包|一包/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const numbers = [
    ...[...text.matchAll(/(\d+)\s*-?\s*(?:pack|packs|set|sets|комплект|набор|упаковк|件套|套装|套|包)/g)].map((match) => match[1]),
    ...[...text.matchAll(/(?:pack of|упаковк|комплект|набор|每包|一包|包装)\s*(\d+)/g)].map((match) => match[1]),
  ];
  return numericDictionaryCandidates({
    meta,
    categoryMatch,
    attributeValuesById,
    categoryCache,
    numbers,
    valuePattern: /шт|штук|pcs?|pieces?|件|个|只|套|包/,
    source: "package_count_synonym",
    confidence: 0.68,
  });
}

function typeSynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (classified.strategy !== "dictionary_lookup_from_product_text") return [];
  if (!/тип|вид|категор|用途|类型|种类/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const typeRules = [
    {
      sourcePattern: /органайзер|organizer|organiser|收纳盒|收纳架|整理盒|置物架/,
      valuePattern: /органайзер|organizer|organiser|收纳/i,
      source: "type_synonym",
      confidence: 0.7,
    },
  ];
  const values = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache });
  return typeRules
    .filter((rule) => rule.sourcePattern.test(text))
    .flatMap((rule) => values.map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      if (!value || !rule.valuePattern.test(value)) return null;
      return {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: rule.confidence,
        source: rule.source,
      };
    }))
    .filter(Boolean);
}

function purposeSynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (classified.strategy !== "dictionary_lookup_from_product_text") return [];
  if (!/назначение|применение|для кого|для чего|用途|适用对象|适用人群/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const purposeRules = [
    {
      sourcePattern: /кухн|kitchen|厨房/,
      valuePattern: /кухн|kitchen|厨房/i,
      source: "purpose_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /животн|pet|cat|dog|кошка|собак|宠物|猫|狗/,
      valuePattern: /животн|pet|cat|dog|кош|собак|宠物|猫|狗/i,
      source: "purpose_synonym",
      confidence: 0.7,
    },
  ];
  const values = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache });
  return purposeRules
    .filter((rule) => rule.sourcePattern.test(text))
    .flatMap((rule) => values.map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      if (!value || !rule.valuePattern.test(value)) return null;
      return {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: rule.confidence,
        source: rule.source,
      };
    }))
    .filter(Boolean);
}

function scenarioSynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (classified.strategy !== "dictionary_lookup_from_product_text") return [];
  if (!/сценар|назначение|применение|для чего|用途|适用场景|场景/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const scenarioRules = [
    {
      sourcePattern: /home|дом|дома|家用|家居|家庭|居家/,
      valuePattern: /home|дом|дома|家用|家居|家庭|居家/i,
      source: "scenario_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /car|auto|авто|автомоб|车载|汽车|车用/,
      valuePattern: /car|auto|авто|автомоб|车载|汽车|车用/i,
      source: "scenario_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /school|школ|учеб|student|学生|学校|上学/,
      valuePattern: /school|школ|учеб|student|学生|学校|上学/i,
      source: "scenario_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /travel|путеше|туризм|旅行|旅游|出差/,
      valuePattern: /travel|путеше|туризм|旅行|旅游/i,
      source: "scenario_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /office|офис|рабоч|办公室|办公/,
      valuePattern: /office|офис|рабоч|办公室|办公/i,
      source: "scenario_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /bath|ванн|浴室|卫生间|洗漱/,
      valuePattern: /bath|ванн|浴室|卫生间|洗漱/i,
      source: "scenario_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /outdoor|camp|поход|户外|露营/,
      valuePattern: /outdoor|camp|поход|户外|露营/i,
      source: "scenario_synonym",
      confidence: 0.7,
    },
  ];
  const values = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache });
  return scenarioRules
    .filter((rule) => rule.sourcePattern.test(text))
    .flatMap((rule) => values.map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      if (!value || !rule.valuePattern.test(value)) return null;
      return {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: rule.confidence,
        source: rule.source,
      };
    }))
    .filter(Boolean);
}

function genderSynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (classified.strategy !== "dictionary_lookup_from_product_text") return [];
  if (!/(^|\s)пол($|\s)|gender|性别|适用性别/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const genderRules = [
    {
      sourcePattern: /жен|woman|women|female|女士|女性|女式|女/,
      valuePattern: /жен|woman|women|female|女性|女士|女/i,
      source: "gender_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /муж|\b(?:man|men|male)\b|男士|男性|男式|男/,
      valuePattern: /муж|\b(?:man|men|male)\b|男性|男士|男/i,
      source: "gender_synonym",
      confidence: 0.7,
    },
    {
      sourcePattern: /дет|child|children|kid|kids|儿童|童|小孩|宝宝/,
      valuePattern: /дет|child|children|kid|kids|儿童|童/i,
      source: "gender_synonym",
      confidence: 0.7,
    },
  ];
  const values = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache });
  return genderRules
    .filter((rule) => rule.sourcePattern.test(text))
    .flatMap((rule) => values.map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      if (!value || !rule.valuePattern.test(value)) return null;
      return {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: rule.confidence,
        source: rule.source,
      };
    }))
    .filter(Boolean);
}

function dictionaryValuesForPlan({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
} = {}) {
  const id = Number(meta.id || 0);
  if (!id) return [];
  if (Array.isArray(attributeValuesById[id])) return attributeValuesById[id];
  if (Array.isArray(attributeValuesById[String(id)])) return attributeValuesById[String(id)];
  const cache = categoryCache.attributeValues || {};
  const keys = [
    attributeValueCacheKey(categoryMatch, { id }),
    attributeValueCacheKey(categoryMatch, { id }, "RU"),
  ];
  for (const key of keys) {
    if (Array.isArray(cache[key]?.values)) return cache[key].values;
  }
  return [];
}

function dictionaryValueId(entry = {}) {
  return Number(entry.dictionary_value_id || entry.dictionaryValueId || entry.id || entry.value_id || 0) || undefined;
}

function normalizePackageInfo(packageInfo = {}) {
  return {
    weight: Number(packageInfo.weight || packageInfo.weightG || packageInfo.weight_g || 0),
    depth: Number(packageInfo.depth || packageInfo.lengthMm || packageInfo.length_mm || packageInfo.length || 0),
    width: Number(packageInfo.width || packageInfo.widthMm || packageInfo.width_mm || 0),
    height: Number(packageInfo.height || packageInfo.heightMm || packageInfo.height_mm || 0),
  };
}

function packageValueForMeta(meta = {}, packageInfo = {}) {
  const text = normalizeText(meta.name || "");
  if (/вес|重量|weight/.test(text)) return packageInfo.weight > 0 ? String(Math.round(packageInfo.weight)) : "";
  if (/длина|глубина|长|length|depth/.test(text)) return packageInfo.depth > 0 ? String(Math.round(packageInfo.depth)) : "";
  if (/ширина|宽|width/.test(text)) return packageInfo.width > 0 ? String(Math.round(packageInfo.width)) : "";
  if (/высота|高|height/.test(text)) return packageInfo.height > 0 ? String(Math.round(packageInfo.height)) : "";
  return "";
}

function isComplianceSensitive(attribute = {}) {
  if (isOriginCountryAttribute(attribute)) return false;
  const text = normalizeText(`${attribute.name || ""} ${attribute.description || ""}`);
  return /срок годности|годност|условия хран|хранени|состав|опасн|hazard|danger|температур|сертификат|сертификац|медицин|лекарств|аккумулятор|батаре|детск|пище|космет|изготовител|производител|保质期|储存|成分|危险|温度|认证|医疗|电池|儿童|食品|化妆|制造商/.test(text);
}

function isOriginCountryAttribute(attribute = {}) {
  const id = Number(attribute.id || 0);
  const text = normalizeText(`${attribute.name || ""} ${attribute.description || ""}`);
  return id === 4389
    || /страна[\s-]*(изготов|производ)/.test(text)
    || /country of origin|origin country/.test(text)
    || /原产国|生产国|制造国/.test(text);
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}
