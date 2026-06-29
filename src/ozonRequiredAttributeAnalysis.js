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
  if (/страна|изготовител|производител|原产国|生产国|制造国/.test(text)) {
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
  if (/назначение|применение|тип|вид|категор|用途|类型|种类/.test(text) && dictionaryId) {
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

export function categoryAttributeCacheKey(category = {}) {
  return `${Number(category.description_category_id || 0)}:${Number(category.type_id || 0)}`;
}

export function attributeValueCacheKey(category = {}, attribute = {}, language = "ZH_HANS") {
  return `${Number(category.description_category_id || 0)}:${Number(category.type_id || 0)}:${Number(attribute.id || 0)}:${language}`;
}

function strategy(strategyName, fillLogic, confidence) {
  return { strategy: strategyName, fillLogic, confidence };
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}
