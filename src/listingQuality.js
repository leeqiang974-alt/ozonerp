function payloadItems(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : (payload.offer_id ? [payload] : []);
}

function attrValues(attribute = {}) {
  return Array.isArray(attribute.values) ? attribute.values : [];
}

function attributeById(item = {}, id) {
  return (item.attributes || []).find((attribute) => Number(attribute?.id || 0) === Number(id)) || null;
}

function attributeValueSignature(attribute = {}) {
  return attrValues(attribute).map((value) => (
    Number(value?.dictionary_value_id || 0)
      ? `d:${Number(value.dictionary_value_id)}`
      : `v:${String(value?.value || "").trim().toLowerCase()}`
  )).filter((value) => !value.endsWith(":")).sort().join(",");
}

function metaName(meta = {}) {
  return String(meta.name || meta.attribute_name || `属性 ${Number(meta.id || 0)}`);
}

function hasAnyValue(attribute = {}) {
  return attrValues(attribute).some((value) => (
    String(value?.value || "").trim() || Number(value?.dictionary_value_id || 0)
  ));
}

function normalizeDictionaryText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{Script=Han}\p{Script=Cyrillic}a-z0-9]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dictionaryValueId(value = {}) {
  return Number(value.dictionary_value_id || value.value_id || value.id || 0);
}

function dictionaryValueText(value = {}) {
  return String(value.value || value.name || value.label || "").trim();
}

function dictionaryValueSources(input = {}, item = {}, meta = {}) {
  const attributeId = Number(meta?.id || 0);
  const sources = [];
  const descriptionCategoryId = Number(item?.description_category_id || item?.descriptionCategoryId || 0);
  const typeId = Number(item?.type_id || item?.typeId || 0);
  const cache = input.dictionaryValueCache && typeof input.dictionaryValueCache === "object"
    ? input.dictionaryValueCache
    : {};
  const languages = [
    input.dictionaryLanguage || "",
    "ZH_HANS",
    "RU",
    "EN",
    "DEFAULT",
  ].filter(Boolean);

  for (const language of [...new Set(languages)]) {
    if (!descriptionCategoryId || !typeId || !attributeId) continue;
    const key = [descriptionCategoryId, typeId, attributeId, language].join(":");
    if (Array.isArray(cache[key]?.values)) {
      sources.push({ source: "ozon_dictionary_cache", values: cache[key].values });
    }
  }
  const byAttribute = input.dictionaryValuesByAttributeId || input.dictionaryValues || {};
  const directValues = byAttribute[String(attributeId)] || byAttribute[attributeId];
  if (Array.isArray(directValues)) {
    sources.push({ source: "provided_dictionary_values", values: directValues });
  }
  for (const values of [meta.dictionary_values, meta.dictionaryValues, meta.values]) {
    if (Array.isArray(values) && values.some((value) => dictionaryValueId(value))) {
      sources.push({ source: "attrs_meta_dictionary", values });
    }
  }
  return sources;
}

function knownDictionaryValueIds(input = {}, item = {}, meta = {}) {
  const ids = new Set();
  for (const source of dictionaryValueSources(input, item, meta)) {
    for (const value of source.values || []) {
      const id = dictionaryValueId(value);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function displayEnteredDictionaryValue(value = {}) {
  const id = Number(value?.dictionary_value_id || 0);
  const text = String(value?.value || "").trim();
  return [id ? `#${id}` : "", text].filter(Boolean).join(" ");
}

function clampScore(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function scoreStatus(score, blocked = false) {
  if (blocked) return "blocked";
  return score >= 90 ? "ready" : "warning";
}

function descriptionLengthForItem(item = {}) {
  return String(
    item.description
    || item.description_ru
    || item.descriptionRu
    || item.marketing_description
    || "",
  ).trim().length;
}

function richContentReadyForItem(item = {}) {
  if (item.rich_content_json || item.richContentJson || item.rich_content || item.richContent) return true;
  const complex = item.complex_attributes || item.complexAttributes || [];
  return Array.isArray(complex) && complex.length > 0;
}

function imageSignature(images = []) {
  return (Array.isArray(images) ? images : [])
    .filter(Boolean)
    .map((url) => String(url || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function hasPackageData(item = {}) {
  const weight = Number(item.weight || item.weight_g || item.weightG || item.package_weight || item.packageWeight || 0);
  const width = Number(item.width || item.width_mm || item.widthMm || item.package_width || item.packageWidth || 0);
  const height = Number(item.height || item.height_mm || item.heightMm || item.package_height || item.packageHeight || 0);
  const depth = Number(item.depth || item.depth_mm || item.depthMm || item.length || item.length_mm || item.lengthMm || item.package_length || item.packageLength || 0);
  return weight > 0 && width > 0 && height > 0 && depth > 0;
}

function pushUnique(list, item) {
  const key = [
    item.code || "",
    item.offerId || "",
    item.attributeId || "",
    item.message || "",
  ].join("|");
  if (!list.some((entry) => [
    entry.code || "",
    entry.offerId || "",
    entry.attributeId || "",
    entry.message || "",
  ].join("|") === key)) {
    list.push(item);
  }
}

function pushImageRecommendation(list, item) {
  const key = [item.code || "", item.offerId || ""].join("|");
  if (list.some((entry) => [entry.code || "", entry.offerId || ""].join("|") === key)) return;
  list.push({
    readOnly: true,
    severity: item.severity || "warning",
    code: item.code || "IMAGE_QUALITY_RECOMMENDATION",
    title: item.title || "图片质量建议",
    offerId: item.offerId || "",
    action: item.action || "人工检查图片质量。",
    nextStep: item.nextStep || "处理后重新预检；仅提示，不写 Payload。",
  });
}

function preparedImageRows(input = {}) {
  const sources = [
    input.imagePreparation?.images,
    input.preparedImages?.images,
    input.preparedImages,
    input.contentSummary?.imagePreparation?.images,
    input.contentSummary?.preparedImages?.images,
    input.contentSummary?.preparedImages,
  ];
  return sources.find((rows) => Array.isArray(rows)) || [];
}

function preparedImageRisk(row = {}) {
  const reason = String(row.reason || row.skipReason || "").trim();
  const ocr = row.ocr || row.ozonImageOcr || {};
  if (reason === "factory_intro" || ocr.isFactoryIntro) {
    return {
      code: "IMAGE_OCR_FACTORY_TEXT",
      title: "图片含工厂/批发文字",
      action: "移除含厂家、批发、包邮等平台外营销文字的图片，改用干净产品图或详情图。",
    };
  }
  if (reason === "ozon_image_policy_text" || ocr.hasOzonPolicyText) {
    return {
      code: "IMAGE_OCR_POLICY_TEXT",
      title: "图片含平台政策文字",
      action: "移除含配送、退货、平台政策或促销承诺的图片，避免影响 Ozon 审核。",
    };
  }
  if (reason === "needs_translation" || (ocr.hasChinese && reason !== "translated")) {
    return {
      code: "IMAGE_OCR_NEEDS_TRANSLATION",
      title: "图片含中文文字",
      action: "替换或人工处理含中文说明的图片，确保 Ozon 展示图不残留中文营销文字。",
    };
  }
  return null;
}

function buildScoreBreakdown({ mediaScore, attributeScore, descriptionScore, packageScore }) {
  return {
    media: {
      label: "图片与媒体",
      score: clampScore(mediaScore),
      status: scoreStatus(mediaScore),
      reasonZh: mediaScore >= 90 ? "图片数量和 SKU 图覆盖较完整。" : "图片数量、SKU 图或详情图仍会影响商品分值。",
    },
    attributes: {
      label: "分类属性与变体",
      score: clampScore(attributeScore.score),
      status: scoreStatus(attributeScore.score, attributeScore.blocked),
      reasonZh: attributeScore.blocked ? "存在必填属性、字典值或变体组合阻塞项。" : "必填属性和变体组合未发现阻塞项。",
    },
    description: {
      label: "标题描述与富内容",
      score: clampScore(descriptionScore),
      status: scoreStatus(descriptionScore),
      reasonZh: descriptionScore >= 90 ? "描述和富内容基础完整。" : "描述长度或 rich content 仍可优化。",
    },
    package: {
      label: "尺重与物流基础",
      score: clampScore(packageScore),
      status: scoreStatus(packageScore),
      reasonZh: packageScore >= 90 ? "尺重信息可用于后续定价和物流判断。" : "尺重缺失会影响价格、物流等级和商品分值。",
    },
  };
}

function candidateConfidence(enteredValues = [], candidate = {}) {
  const candidateText = normalizeDictionaryText(dictionaryValueText(candidate));
  if (!candidateText) return 0.4;
  let best = 0.42;
  for (const entered of enteredValues) {
    const enteredText = normalizeDictionaryText(entered);
    if (!enteredText) continue;
    if (enteredText === candidateText) best = Math.max(best, 0.96);
    else if (candidateText.includes(enteredText) || enteredText.includes(candidateText)) best = Math.max(best, 0.78);
    else {
      const enteredTokens = new Set(enteredText.split(" ").filter((token) => token.length >= 2));
      const candidateTokens = candidateText.split(" ").filter((token) => token.length >= 2);
      const overlap = candidateTokens.filter((token) => enteredTokens.has(token)).length;
      if (overlap) best = Math.max(best, 0.62 + Math.min(0.14, overlap * 0.04));
    }
  }
  return Number(best.toFixed(2));
}

function dictionaryCandidatesForAttribute(input = {}, item = {}, meta = {}, attribute = {}) {
  const enteredValues = attrValues(attribute)
    .map((value) => String(value?.value || "").trim())
    .filter(Boolean);
  const seen = new Set();
  const candidates = [];
  for (const source of dictionaryValueSources(input, item, meta)) {
    for (const value of source.values || []) {
      const id = dictionaryValueId(value);
      const text = dictionaryValueText(value);
      if (!id || !text) continue;
      const key = `${id}:${normalizeDictionaryText(text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        dictionary_value_id: id,
        value: text,
        confidence: candidateConfidence(enteredValues, value),
        source: source.source,
      });
    }
  }
  return candidates
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0)
      || String(left.value || "").localeCompare(String(right.value || "")))
    .slice(0, 5);
}

function findPricingBlockedReason(workflowRun = null, pricing = null) {
  const directCode = String(pricing?.reasonCode || pricing?.status || "").trim();
  if (/^PRICING_/.test(directCode) || directCode === "blocked") {
    return {
      code: "PRICING_BLOCKED",
      message: pricing?.message || "定价风险仍处于阻塞状态，不能进入 Ozon 提交。",
      nextAction: "先修正尺重、运费等级、最低价或利润风险，再重新生成价格。",
    };
  }
  const node = (workflowRun?.nodes || []).find((item) => {
    const reasonCode = String(item?.diagnosis?.reasonCode || item?.diagnostic?.reasonCode || "").trim();
    return reasonCode.startsWith("PRICING_")
      && (item?.branch === "blocked" || item?.status === "waiting_human" || item?.status === "failed");
  });
  if (!node) return null;
  return {
    code: "PRICING_BLOCKED",
    message: node.reason || node.diagnosis?.messageZh || "定价风险仍处于阻塞状态，不能进入 Ozon 提交。",
    nextAction: "先处理价格风险节点，再重新校验 Payload。",
  };
}

function variantAspectIssues(items = [], attrsMeta = []) {
  if (items.length < 2) return [];
  const aspectIds = new Set((attrsMeta || [])
    .filter((meta) => meta?.is_aspect && Number(meta?.id || 0))
    .map((meta) => Number(meta.id)));
  if (!aspectIds.size) return [];
  const bySignature = new Map();
  const issues = [];
  for (const item of items) {
    const offerId = String(item?.offer_id || "").trim();
    const signature = (item.attributes || [])
      .filter((attribute) => aspectIds.has(Number(attribute?.id || 0)))
      .map((attribute) => `${Number(attribute.id)}:${attributeValueSignature(attribute)}`)
      .filter((value) => !value.endsWith(":"))
      .sort()
      .join("|");
    if (!signature) {
      issues.push({
        code: "MISSING_VARIANT_ASPECT",
        offerId,
        message: `${offerId || "变体"} 缺少 Ozon 可变特性，不能确认变体合并。`,
      });
      continue;
    }
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(offerId);
  }
  for (const offers of bySignature.values()) {
    if (offers.length < 2) continue;
    issues.push({
      code: "DUPLICATE_VARIANT_ASPECTS",
      offerIds: offers,
      message: `变体的 Ozon 可变特性重复：${offers.join("、")}`,
    });
  }
  return issues;
}

export function diagnoseListingQuality(input = {}) {
  const payload = input.payload || {};
  const attrsMeta = Array.isArray(input.attrsMeta) ? input.attrsMeta : [];
  const contentSummary = input.contentSummary || {};
  const items = payloadItems(payload);
  const blockedReasons = [];
  const warnings = [];
  const nextActions = [];
  const imageQualityRecommendations = [];
  let mediaScore = 100;
  let descriptionScore = 100;
  let packageScore = 100;
  let hasDetailImageWarning = false;

  for (const item of items) {
    const offerId = String(item?.offer_id || "").trim();
    const images = Array.isArray(item?.images) ? item.images.filter(Boolean) : [];
    if (images.length < 3) {
      blockedReasons.push({
        code: "PRODUCT_IMAGES_TOO_FEW",
        offerId,
        message: `${offerId || "当前商品"} 产品图少于 3 张，不能安全提交 Ozon。`,
      });
      nextActions.push("补齐至少 3 张产品图和必要 SKU 图。");
      pushImageRecommendation(imageQualityRecommendations, {
        severity: "blocked",
        code: "PRODUCT_IMAGES_TOO_FEW",
        title: "补齐产品图",
        offerId,
        action: "为该 SKU 补齐至少 3 张产品图，首图需要能代表当前变体。",
        nextStep: "补图后重新预检；仅提示，不写 Payload。",
      });
    } else if (images.length >= 3 && images.length < 5) {
      warnings.push({
        code: "DETAIL_IMAGES_TOO_FEW",
        offerId,
        message: `${offerId || "当前商品"} 详情/产品图偏少，可能影响 Ozon 商品分值。`,
      });
      nextActions.push("补充详情图、场景图或 SKU 图以提高商品分值。");
      pushImageRecommendation(imageQualityRecommendations, {
        severity: "warning",
        code: "DETAIL_IMAGES_TOO_FEW",
        title: "补充详情图",
        action: "补充产品细节、尺寸、材质或使用场景图，避免轮播图只剩基础产品图。",
        nextStep: "补图后重新预检；仅提示，不写 Payload。",
      });
    }

    if (images.length >= 3 && images.length < 5) hasDetailImageWarning = true;

    for (const meta of attrsMeta) {
      const id = Number(meta?.id || 0);
      if (!id) continue;
      const attribute = attributeById(item, id);
      const required = meta?.is_required === true;
      const dictionary = Number(meta?.dictionary_id || meta?.dictionaryId || 0) > 0;
      if (required && (!attribute || !hasAnyValue(attribute))) {
        blockedReasons.push({
          code: "REQUIRED_ATTRIBUTE_MISSING",
          offerId,
          attributeId: id,
          message: `${offerId || "当前商品"} 缺少 Ozon 必填属性：${metaName(meta)}。`,
        });
        nextActions.push("补齐当前类目的 Ozon 必填属性后重新校验。");
        continue;
      }
      if (!dictionary || !attribute) continue;
      const values = attrValues(attribute);
      const legalIds = knownDictionaryValueIds(input, item, meta);
      const invalid = values.some((value) => !Number(value?.dictionary_value_id || 0)
        || (legalIds.size > 0 && !legalIds.has(Number(value.dictionary_value_id || 0))));
      if (invalid) {
        const enteredValues = values
          .filter((value) => !Number(value?.dictionary_value_id || 0)
            || (legalIds.size > 0 && !legalIds.has(Number(value.dictionary_value_id || 0))))
          .map(displayEnteredDictionaryValue)
          .filter(Boolean);
        blockedReasons.push({
          code: "DICTIONARY_VALUE_INVALID",
          offerId,
          attributeId: id,
          enteredValues,
          dictionaryCandidates: dictionaryCandidatesForAttribute(input, item, meta, attribute),
          message: `${offerId || "当前商品"} 的字典属性 ${metaName(meta)} 缺少合法 dictionary_value_id。`,
        });
        nextActions.push("为字典属性选择当前类目合法的 dictionary_value_id");
      }
    }
  }

  if (hasDetailImageWarning) mediaScore -= 15;

  if (items.length > 1) {
    const signatures = items.map((item) => imageSignature(item?.images || [])).filter(Boolean);
    const hasDuplicateImageCombo = signatures.length && new Set(signatures).size < signatures.length;
    const firstImages = items
      .map((item) => String((Array.isArray(item?.images) ? item.images : [])[0] || "").trim().toLowerCase())
      .filter(Boolean);
    if (!hasDuplicateImageCombo && firstImages.length && new Set(firstImages).size < firstImages.length) {
      mediaScore -= 15;
      pushUnique(warnings, {
        code: "SKU_FIRST_IMAGE_NOT_UNIQUE",
        message: "多个 SKU 使用相同首图，建议让每个变体首图可区分。",
      });
      pushImageRecommendation(imageQualityRecommendations, {
        severity: "warning",
        code: "SKU_FIRST_IMAGE_NOT_UNIQUE",
        title: "区分 SKU 首图",
        action: "为不同颜色、尺码或套装准备可区分的第一张 SKU 图，避免变体在商品卡中混淆。",
        nextStep: "换图后重新预检；仅提示，不写 Payload。",
      });
      nextActions.push("为每个变体准备可区分的第一张 SKU 图，修复后重新预检。");
    }
    if (hasDuplicateImageCombo) {
      mediaScore -= 15;
      pushUnique(warnings, {
        code: "SKU_IMAGES_NOT_UNIQUE",
        message: "多 SKU 使用了相同图片组合，建议为每个变体准备可区分的 SKU 图。",
      });
      pushImageRecommendation(imageQualityRecommendations, {
        severity: "warning",
        code: "SKU_IMAGES_NOT_UNIQUE",
        title: "区分 SKU 图组合",
        action: "为每个变体准备不同的 SKU 图组合，至少首图、颜色或套装差异应可见。",
        nextStep: "换图后重新预检；仅提示，不写 Payload。",
      });
      nextActions.push("为每个变体补充可区分的 SKU 图，修复后重新预检。");
    }
  }

  for (const row of preparedImageRows(input)) {
    if (!row?.skipped && !row?.ocr?.hasChinese && !row?.ocr?.isFactoryIntro && !row?.ocr?.hasOzonPolicyText) continue;
    const risk = preparedImageRisk(row);
    if (!risk) continue;
    mediaScore -= 5;
    pushUnique(warnings, {
      code: risk.code,
      message: `${risk.title}，建议人工替换或处理后重新预检。`,
    });
    pushImageRecommendation(imageQualityRecommendations, {
      severity: "warning",
      code: risk.code,
      title: risk.title,
      action: risk.action,
      nextStep: "处理图片后重新预检；仅提示，不写 Payload，不触发任何成本动作。",
    });
  }

  const descriptionLength = Number(contentSummary.descriptionLength || 0)
    || Math.max(0, ...items.map(descriptionLengthForItem));
  if (items.length && descriptionLength > 0 && descriptionLength < 80) {
    descriptionScore -= 20;
    pushUnique(warnings, {
      code: "DESCRIPTION_TOO_SHORT",
      message: "商品描述偏短，可能影响 Ozon 商品分值和转化。",
    });
    nextActions.push("补充俄文描述、卖点、使用场景和规格信息后重新预检。");
  }
  const richContentKnown = Object.prototype.hasOwnProperty.call(contentSummary, "richContentReady")
    || Object.prototype.hasOwnProperty.call(contentSummary, "visualCardReady")
    || items.some((item) => richContentReadyForItem(item));
  const richContentReady = Boolean(contentSummary.richContentReady || contentSummary.visualCardReady)
    || items.some((item) => richContentReadyForItem(item));
  if (items.length && richContentKnown && !richContentReady) {
    descriptionScore -= 15;
    pushUnique(warnings, {
      code: "RICH_CONTENT_MISSING",
      message: "未检测到 rich content/视觉详情内容，建议补充以提高商品分值。",
    });
    nextActions.push("补充详情图或 rich content 后重新预检。");
  }

  const packageKnown = Object.prototype.hasOwnProperty.call(contentSummary, "sizeWeightReady")
    || items.some((item) => hasPackageData(item));
  const packageReady = contentSummary.sizeWeightReady === true || items.some((item) => hasPackageData(item));
  if (items.length && packageKnown && !packageReady) {
    packageScore -= 20;
    pushUnique(warnings, {
      code: "PACKAGE_SIZE_WEIGHT_MISSING",
      message: "尺重信息不完整，会影响价格、物流等级和 Ozon 商品分值。",
    });
    nextActions.push("补齐重量和长宽高尺重，重新生成价格并预检。");
  }

  for (const issue of variantAspectIssues(items, attrsMeta)) {
    blockedReasons.push(issue);
    nextActions.push("修正每个 SKU 的 Ozon 可变特性，确保同一模型下组合唯一。");
  }

  const pricingBlocked = findPricingBlockedReason(input.workflowRun || null, input.pricing || null);
  if (pricingBlocked) {
    blockedReasons.push({
      code: pricingBlocked.code,
      message: pricingBlocked.message,
    });
    nextActions.push(pricingBlocked.nextAction);
  }

  const uniqueNextActions = [...new Set(nextActions.filter(Boolean))];
  const attributeScore = {
    score: Math.max(0, 100 - blockedReasons.filter((reason) => String(reason.code || "") !== "PRICING_BLOCKED").length * 18),
    blocked: blockedReasons.some((reason) => String(reason.code || "") !== "PRICING_BLOCKED"),
  };
  const scoreBreakdown = buildScoreBreakdown({
    mediaScore,
    attributeScore,
    descriptionScore,
    packageScore,
  });
  const score = clampScore(
    (scoreBreakdown.media.score
      + scoreBreakdown.attributes.score
      + scoreBreakdown.description.score
      + scoreBreakdown.package.score) / 4
      - blockedReasons.filter((reason) => String(reason.code || "") === "PRICING_BLOCKED").length * 12,
  );
  return {
    status: blockedReasons.length ? "blocked" : (warnings.length ? "warning" : "ready"),
    score,
    scoreBreakdown,
    blockedReasons,
    warnings,
    imageQualityRecommendations,
    nextActions: uniqueNextActions.length ? uniqueNextActions : ["继续保持 Payload 预检和人工确认提交。"],
  };
}
