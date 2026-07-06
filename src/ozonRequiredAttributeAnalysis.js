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

export function summarizeRequiredAttributeFillPlan(plan = []) {
  const rows = Array.isArray(plan) ? plan : [];
  const safetyTierCounts = {
    "autofill-safe": 0,
    "candidate-needs-human-confirmation": 0,
    "manual-required": 0,
    "blocked-never-guess": 0,
  };
  const actionCounts = {
    auto_fill: 0,
    suggest_dictionary: 0,
    manual_required: 0,
    blocked_sensitive: 0,
  };
  for (const row of rows) {
    const tier = String(row.safetyTier || "manual-required");
    safetyTierCounts[tier] = (safetyTierCounts[tier] || 0) + 1;
    const action = String(row.action || "manual_required");
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }
  const autofillSafeCount = safetyTierCounts["autofill-safe"] || 0;
  const candidateNeedsHumanConfirmationCount = safetyTierCounts["candidate-needs-human-confirmation"] || 0;
  const manualRequiredCount = safetyTierCounts["manual-required"] || 0;
  const blockedNeverGuessCount = safetyTierCounts["blocked-never-guess"] || 0;
  const humanRequiredCount = candidateNeedsHumanConfirmationCount + manualRequiredCount + blockedNeverGuessCount;
  const blockingCount = manualRequiredCount + blockedNeverGuessCount;
  const readinessStatus = blockedNeverGuessCount ? "blocked" : manualRequiredCount ? "manual_required" : candidateNeedsHumanConfirmationCount ? "needs_confirmation" : "ready";
  let safeNextAction = "必填属性已安全补齐，仍需经过 Payload validation、预检和人工提交确认。";
  if (blockedNeverGuessCount) {
    safeNextAction = "存在禁止猜测的合规/敏感属性，必须人工核实真实值或更换货源后重新预检。";
  } else if (manualRequiredCount) {
    safeNextAction = "存在必须人工填写的属性，补齐真实值后重新预检；系统不会用低置信内容自动补齐。";
  } else if (candidateNeedsHumanConfirmationCount) {
    safeNextAction = "存在候选字典值，需人工确认后通过等待人工的本地草稿修复路径写入并重新预检。";
  }
  return {
    totalCount: rows.length,
    autofillSafeCount,
    candidateNeedsHumanConfirmationCount,
    manualRequiredCount,
    blockedNeverGuessCount,
    humanRequiredCount,
    blockingCount,
    readinessStatus,
    safeNextAction,
    safetyTierCounts,
    actionCounts,
  };
}

export function buildRequiredAttributeManualBacklog(plan = []) {
  const rows = Array.isArray(plan) ? plan : [];
  const buckets = [
    { key: "rule_candidate", title: "可规则化", items: [] },
    { key: "manual_required", title: "必须人工", items: [] },
    { key: "replace_source", title: "建议换货源", items: [] },
  ];
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const row of rows) {
    const tier = String(row.safetyTier || "");
    const action = String(row.action || "");
    if (!["manual-required", "blocked-never-guess"].includes(tier) && !["manual_required", "blocked_sensitive"].includes(action)) continue;
    const bucketKey = manualBacklogBucketKey(row);
    const bucket = bucketByKey.get(bucketKey);
    if (!bucket) continue;
    bucket.items.push({
      attributeId: Number(row.attributeId || 0),
      attributeName: row.name || `属性 ${row.attributeId || ""}`,
      strategy: row.strategy || "",
      action: row.action || "manual_required",
      safetyTier: row.safetyTier || "manual-required",
      source: row.source || "",
      reasonZh: row.reasonZh || "需要人工确认属性值。",
      safeNextStep: manualBacklogNextStep(bucketKey),
      readOnly: true,
    });
  }
  const ruleCandidateCount = bucketByKey.get("rule_candidate")?.items.length || 0;
  const manualRequiredCount = bucketByKey.get("manual_required")?.items.length || 0;
  const replaceSourceCount = bucketByKey.get("replace_source")?.items.length || 0;
  let readinessStatus = "ready";
  let safeNextAction = "没有人工属性 backlog；继续保持预检和人工提交确认。";
  if (replaceSourceCount) {
    readinessStatus = "replace_source";
    safeNextAction = "存在货源缺关键资料的属性，优先补齐尺重/规格证据或更换货源后重新预检。";
  } else if (manualRequiredCount) {
    readinessStatus = "manual_review";
    safeNextAction = "存在必须人工核实的属性，补齐真实资料后重新预检；系统不能猜测。";
  } else if (ruleCandidateCount) {
    readinessStatus = "rule_backlog";
    safeNextAction = "存在可规则化的人工属性，先人工填写本次商品，再沉淀为后续类目规则。";
  }
  return {
    totalCount: ruleCandidateCount + manualRequiredCount + replaceSourceCount,
    ruleCandidateCount,
    manualRequiredCount,
    replaceSourceCount,
    readinessStatus,
    safeNextAction,
    buckets,
  };
}

export function buildRequiredAttributeRuleCandidateIndex({
  categoryMatch = {},
  manualBacklog = {},
  fillPlan = [],
} = {}) {
  const categoryKey = `${Number(categoryMatch.description_category_id || categoryMatch.descriptionCategoryId || 0)}:${Number(categoryMatch.type_id || categoryMatch.typeId || 0)}`;
  const ruleBucket = (Array.isArray(manualBacklog.buckets) ? manualBacklog.buckets : [])
    .find((bucket) => bucket.key === "rule_candidate") || {};
  const manualCandidates = (Array.isArray(ruleBucket.items) ? ruleBucket.items : []).map((item) => ({
    attributeId: Number(item.attributeId || 0),
    attributeName: item.attributeName || `属性 ${item.attributeId || ""}`,
    categoryKey,
    categoryPath: categoryMatch.path || categoryMatch.categoryPath || "",
    ruleStatus: "candidate",
    occurrenceCount: 1,
    source: "required_attribute_manual_backlog",
    suggestedRuleKey: `${categoryKey}:${Number(item.attributeId || 0)}`,
    reasonZh: item.reasonZh || "当前类目存在可沉淀的人工属性。",
    safeNextStep: "先人工填写本次商品；后续收集更多样本后再沉淀类目规则，不自动写 Payload。",
    readOnly: true,
  }));
  const dictionaryCandidates = requiredAttributeDictionaryRuleCandidates({
    categoryKey,
    categoryPath: categoryMatch.path || categoryMatch.categoryPath || "",
    fillPlan,
  });
  const candidates = manualCandidates.concat(dictionaryCandidates);
  return {
    categoryKey,
    categoryPath: categoryMatch.path || categoryMatch.categoryPath || "",
    totalCount: candidates.length,
    readOnly: true,
    safeNextAction: candidates.length
      ? "这些字段只是规则沉淀候选；本次仍需人工填写并重新预检，不会自动生成规则或写入 Payload。"
      : "当前没有可沉淀规则候选；继续按预检结果处理。",
    candidates,
  };
}

function requiredAttributeDictionaryRuleCandidates({
  categoryKey = "",
  categoryPath = "",
  fillPlan = [],
} = {}) {
  return (Array.isArray(fillPlan) ? fillPlan : [])
    .filter((row) => row?.action === "suggest_dictionary")
    .filter((row) => Array.isArray(row.dictionaryCandidates) && row.dictionaryCandidates.length)
    .map((row) => {
      const attributeId = Number(row.attributeId || 0);
      const candidateValues = row.dictionaryCandidates
        .map((candidate) => ({
          dictionaryValueId: dictionaryValueId(candidate),
          value: String(candidate.value || candidate.name || "").trim(),
          confidence: Number(candidate.confidence || 0),
          source: candidate.source || "current_category_dictionary",
        }))
        .filter((candidate) => candidate.dictionaryValueId && candidate.value);
      if (!attributeId || !candidateValues.length) return null;
      return {
        attributeId,
        attributeName: row.name || `属性 ${attributeId}`,
        categoryKey,
        categoryPath,
        ruleStatus: "candidate",
        occurrenceCount: 1,
        source: "required_attribute_dictionary_candidate",
        suggestedRuleKey: `${categoryKey}:${attributeId}:dictionary_candidate`,
        action: "suggest_dictionary",
        strategy: row.strategy || "",
        confidence: row.confidence || "medium",
        candidateValues,
        requiresHumanApproval: true,
        forbiddenEffects: ["payload_write", "ozon_submit", "rule_auto_enable"],
        reasonZh: row.reasonZh || "当前类目出现中置信字典候选，可作为后续规则沉淀样本。",
        safeNextStep: "先人工确认当前商品候选并重新预检；收集多个样本和人工批准前不会自动写 Payload、提交 Ozon 或启用自动规则。",
        readOnly: true,
      };
    })
    .filter(Boolean);
}

export function buildRequiredAttributeRuleCandidateHistory(samples = []) {
  const rows = [];
  const inputSamples = Array.isArray(samples) ? samples : [];
  for (let sampleIndex = 0; sampleIndex < inputSamples.length; sampleIndex += 1) {
    const sample = inputSamples[sampleIndex];
    const index = sample?.index && typeof sample.index === "object" ? sample.index : sample;
    const candidates = Array.isArray(index?.candidates) ? index.candidates : [];
    const sampleProductId = sample?.sourceProductId || index?.sourceProductId || "";
    const sampleRunId = sample?.sourceRunId || index?.sourceRunId || "";
    const seenCandidateKeys = new Set();
    for (const candidate of candidates) {
      const attributeId = Number(candidate.attributeId || 0);
      const categoryKey = String(candidate.categoryKey || index?.categoryKey || "");
      if (!attributeId || !categoryKey) continue;
      const sampleKey = sampleProductId || sampleRunId || `sample-${sampleIndex}`;
      const candidateKey = `${categoryKey}:${attributeId}:${sampleKey}`;
      if (seenCandidateKeys.has(candidateKey)) continue;
      seenCandidateKeys.add(candidateKey);
      rows.push({
        categoryKey,
        categoryPath: candidate.categoryPath || index?.categoryPath || "",
        attributeId,
        attributeName: candidate.attributeName || `属性 ${attributeId}`,
        candidateValues: normalizeRuleCandidateValues(candidate.candidateValues),
        sampleProductId,
        sampleRunId,
      });
    }
  }

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.categoryKey}:${row.attributeId}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        categoryKey: row.categoryKey,
        categoryPath: row.categoryPath,
        attributeId: row.attributeId,
        attributeName: row.attributeName,
        occurrenceCount: 0,
        sampleProductIds: [],
        sampleRunIds: [],
        candidateValueCounts: new Map(),
        readOnly: true,
      });
    }
    const item = grouped.get(key);
    item.occurrenceCount += 1;
    if (!item.categoryPath && row.categoryPath) item.categoryPath = row.categoryPath;
    if (row.sampleProductId && !item.sampleProductIds.includes(row.sampleProductId)) {
      item.sampleProductIds.push(row.sampleProductId);
    }
    if (row.sampleRunId && !item.sampleRunIds.includes(row.sampleRunId)) {
      item.sampleRunIds.push(row.sampleRunId);
    }
    for (const value of row.candidateValues || []) {
      const valueKey = `${value.dictionaryValueId}:${value.value}:${value.source}`;
      const current = item.candidateValueCounts.get(valueKey) || {
        ...value,
        confidence: Number(value.confidence || 0),
        occurrenceCount: 0,
      };
      current.occurrenceCount += 1;
      current.confidence = Math.max(Number(current.confidence || 0), Number(value.confidence || 0));
      item.candidateValueCounts.set(valueKey, current);
    }
  }

  const reviewQueue = [...grouped.values()]
    .map((item) => {
      const candidateValues = [...item.candidateValueCounts.values()]
        .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.value.localeCompare(b.value));
      const { candidateValueCounts, ...publicItem } = item;
      return {
        ...publicItem,
        ...(candidateValues.length ? { candidateValues } : {}),
        ruleStatus: item.occurrenceCount >= 2 ? "ready_for_review" : "collect_more_samples",
        safeNextStep: item.occurrenceCount >= 2
          ? "已在多个样本出现，可进入人工审核规则池；审核通过前不会自动生成规则或写入草稿。"
          : "继续收集同类目样本；本次商品仍需人工填写并重新预检。",
      };
    })
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.categoryKey.localeCompare(b.categoryKey) || a.attributeId - b.attributeId);

  const categoryCount = new Set(reviewQueue.map((item) => item.categoryKey)).size;
  return {
    readOnly: true,
    totalCount: rows.length,
    categoryCount,
    ruleCandidateCount: reviewQueue.length,
    readyForReviewCount: reviewQueue.filter((item) => item.ruleStatus === "ready_for_review").length,
    safeNextStep: reviewQueue.length
      ? "类目规则池草案仅供人工审核；不会自动生成规则、不会写 Payload，也不会绕过预检或人工提交确认。"
      : "暂无可聚合的规则候选；继续按当前商品预检结果处理。",
    reviewQueue,
  };
}

function normalizeRuleCandidateValues(candidateValues = []) {
  return (Array.isArray(candidateValues) ? candidateValues : [])
    .map((candidate) => ({
      dictionaryValueId: dictionaryValueId(candidate),
      value: String(candidate.value || candidate.name || "").trim(),
      confidence: Number(candidate.confidence || 0),
      source: candidate.source || "current_category_dictionary",
    }))
    .filter((candidate) => candidate.dictionaryValueId && candidate.value);
}

export function buildRequiredAttributeApprovalDraftPreview(history = {}) {
  const reviewQueue = Array.isArray(history?.reviewQueue) ? history.reviewQueue : [];
  const approvalDraftQueue = reviewQueue
    .filter((item) => item.ruleStatus === "ready_for_review")
    .map((item) => ({
      categoryKey: item.categoryKey || "",
      categoryPath: item.categoryPath || "",
      attributeId: Number(item.attributeId || 0),
      attributeName: item.attributeName || `属性 ${item.attributeId || ""}`,
      occurrenceCount: Number(item.occurrenceCount || 0),
      sampleProductIds: Array.isArray(item.sampleProductIds) ? [...item.sampleProductIds] : [],
      sampleRunIds: Array.isArray(item.sampleRunIds) ? [...item.sampleRunIds] : [],
      draftStatus: "pending_human_approval",
      requiredChecks: ["同类目样本复核", "人工批准", "独立预检回归"],
      forbiddenEffects: ["payload_write", "ozon_submit", "rule_auto_enable"],
      auditReadiness: {
        readOnly: true,
        status: "blocked_until_audit_ready",
        canStoreApproval: false,
        canEnableRule: false,
        missingProofs: ["样本复核记录", "人工批准人和时间", "独立预检回归结果"],
        safeNextStep: "先补齐审计记录设计和独立预检结果，再进入真实人工批准存储；当前仍不能启用规则。",
      },
      safeNextStep: "批准前只做草案预览；必须人工复核样本并跑独立预检，不能自动写草稿、提交 Ozon 或启用规则。",
      readOnly: true,
    }));
  return {
    readOnly: true,
    approvalDraftCount: approvalDraftQueue.length,
    approvalDraftQueue,
    safeNextStep: approvalDraftQueue.length
      ? "人工批准草案仅为上架中心预览；不会持久化、不会自动启用规则、不会写 Payload。"
      : "暂无可预览的人工批准草案。",
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

function manualBacklogBucketKey(row = {}) {
  const source = String(row.source || "");
  const strategyName = String(row.strategy || "");
  const reason = normalizeText(`${row.reasonZh || ""} ${row.safeNextStep || ""} ${row.name || ""}`);
  if (source === "1688_package_missing" || strategyName === "package_data" || /尺重|重量|вес|длина|ширина|высота/.test(reason)) {
    return "replace_source";
  }
  if (String(row.safetyTier || "") === "blocked-never-guess" || String(row.action || "") === "blocked_sensitive") {
    return "manual_required";
  }
  return "rule_candidate";
}

function manualBacklogNextStep(bucketKey = "") {
  if (bucketKey === "replace_source") return "补齐货源尺重/规格证据或更换货源后重新预检；不会自动写 Payload。";
  if (bucketKey === "manual_required") return "人工核实真实属性后再写本地草稿并重新预检；系统不能猜测。";
  return "先人工填写本次商品，同时把样本沉淀为类目规则；不会自动写 Payload。";
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
  const text = normalizeText(productText);
  const numericUnitManaged = isCapacityAttributeMeta(meta) || isCountAttributeMeta(meta);
  return dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache })
    .map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      if (!value) return null;
      const normalizedValue = normalizeText(value);
      if (numericUnitManaged && /\d/.test(normalizedValue)) return null;
      const matched = normalizedValue && (
        /\d/.test(normalizedValue)
          ? new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedValue)}(?=$|[^\\p{L}\\p{N}])`, "u").test(text)
          : text.includes(normalizedValue)
      );
      return matched ? {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: 0.78,
        source: "product_text",
      } : null;
    })
    .filter(Boolean)
    .concat(colorSynonymDictionaryCandidatesForMeta({ meta, categoryMatch, attributeValuesById, categoryCache, productText }))
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

function colorSynonymDictionaryCandidatesForMeta({
  meta = {},
  categoryMatch = {},
  attributeValuesById = {},
  categoryCache = {},
  productText = "",
} = {}) {
  const classified = classifyAttributeFillStrategy(meta);
  if (!["dictionary_lookup_from_product_text", "dictionary_lookup_or_manual_rule"].includes(classified.strategy)) return [];
  if (!/цвет|color|colour|颜色|顏色|色彩|色号|色號/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
  const text = normalizeText(productText);
  const colorRules = [
    { sourcePattern: /красн|\bred\b|红|紅/, valuePattern: /красн|\bred\b|红|紅/i },
    { sourcePattern: /син|голуб|\bblue\b|蓝|藍/, valuePattern: /син|голуб|\bblue\b|蓝|藍/i },
    { sourcePattern: /бел|\bwhite\b|白/, valuePattern: /бел|\bwhite\b|白/i },
    { sourcePattern: /черн|чёрн|\bblack\b|黑/, valuePattern: /черн|чёрн|\bblack\b|黑/i },
    { sourcePattern: /зелен|зелён|\bgreen\b|绿|綠/, valuePattern: /зелен|зелён|\bgreen\b|绿|綠/i },
    { sourcePattern: /желт|жёлт|\byellow\b|黄|黃/, valuePattern: /желт|жёлт|\byellow\b|黄|黃/i },
    { sourcePattern: /розов|\bpink\b|粉/, valuePattern: /розов|\bpink\b|粉/i },
    { sourcePattern: /фиолет|\bpurple\b|紫/, valuePattern: /фиолет|\bpurple\b|紫/i },
    { sourcePattern: /оранж|\borange\b|橙/, valuePattern: /оранж|\borange\b|橙/i },
    { sourcePattern: /коричнев|\bbrown\b|棕|咖啡/, valuePattern: /коричнев|\bbrown\b|棕|咖啡/i },
    { sourcePattern: /\bсер(ый|ая|ое|ые|ого|ому|ым|ом|ую|ой|ых|ыми)\b|\bgray\b|\bgrey\b|灰/, valuePattern: /\bсер(ый|ая|ое|ые|ого|ому|ым|ом|ую|ой|ых|ыми)\b|\bgray\b|\bgrey\b|灰/i },
    { sourcePattern: /прозрач|\btransparent\b|透明/, valuePattern: /прозрач|\btransparent\b|透明/i },
  ];
  const values = dictionaryValuesForPlan({ meta, categoryMatch, attributeValuesById, categoryCache });
  return colorRules
    .filter((rule) => rule.sourcePattern.test(text))
    .flatMap((rule) => values.map((entry) => {
      const value = String(entry?.value || entry?.name || "").replace(/\s+/g, " ").trim();
      if (!value || !rule.valuePattern.test(value)) return null;
      return {
        dictionaryValueId: dictionaryValueId(entry),
        value,
        confidence: 0.7,
        source: "color_synonym",
      };
    }))
    .filter(Boolean);
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
  if (!isCapacityAttributeMeta(meta)) return [];
  const text = normalizeText(productText);
  const numbers = [...text.matchAll(/(^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(?:литров|литра|литр|мл|ml|毫升|л|l)(?=$|[^\p{L}\p{N}])/gu)]
    .map((match) => match[2].replace(",", "."));
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
  if (!isCountAttributeMeta(meta)) return [];
  const text = normalizeText(productText);
  const numbers = [...text.matchAll(/(^|[^\p{L}\p{N}])(\d+)\s*(?:pieces?|штук|pcs?|шт|件|个|只|套)(?=$|[^\p{L}\p{N}])/gu)].map((match) => match[2]);
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
      sourcePattern: /животн|\b(?:pet|cat|dog)\b|кошка|собак|宠物|猫|狗/,
      valuePattern: /животн|\b(?:pet|cat|dog)\b|кош|собак|宠物|猫|狗/i,
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
  if (!/сценар|назначение|применение|для чего|用途|适用场景/.test(normalizeText(`${meta.name || ""} ${meta.description || ""}`))) return [];
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
      sourcePattern: /(^|[^\p{L}\p{N}])жен(?:ск|щин)|\b(?:woman|women|female)\b|女士|女性|女式|女/u,
      valuePattern: /(^|[^\p{L}\p{N}])жен(?:ск|щин)|\b(?:woman|women|female)\b|女性|女士|女/iu,
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
      sourcePattern: /(^|[^\p{L}\p{N}])дет(?:ск|и|ей|ям)|реб[её]н|\b(?:child|children|kid|kids)\b|儿童|童|小孩|宝宝/u,
      valuePattern: /(^|[^\p{L}\p{N}])дет(?:ск|и|ей|ям)|реб[её]н|\b(?:child|children|kid|kids)\b|儿童|童/iu,
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

function isCapacityAttributeMeta(attribute = {}) {
  return /объем|объ[её]м|volume|容量|体积|毫升|литр|мл/.test(normalizeText(`${attribute.name || ""} ${attribute.description || ""}`));
}

function isCountAttributeMeta(attribute = {}) {
  return /колич|комплект|штук|шт|pieces?|pcs?|数量|件数|件|个|只|套/.test(normalizeText(`${attribute.name || ""} ${attribute.description || ""}`));
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
