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
  const items = payloadItems(payload);
  const blockedReasons = [];
  const warnings = [];
  const nextActions = [];

  for (const item of items) {
    const offerId = String(item?.offer_id || "").trim();
    const images = Array.isArray(item?.images) ? item.images.filter(Boolean) : [];
    if (images.length > 0 && images.length < 3) {
      blockedReasons.push({
        code: "PRODUCT_IMAGES_TOO_FEW",
        offerId,
        message: `${offerId || "当前商品"} 产品图少于 3 张，不能安全提交 Ozon。`,
      });
      nextActions.push("补齐至少 3 张产品图和必要 SKU 图。");
    } else if (images.length >= 3 && images.length < 5) {
      warnings.push({
        code: "DETAIL_IMAGES_TOO_FEW",
        offerId,
        message: `${offerId || "当前商品"} 详情/产品图偏少，可能影响 Ozon 商品分值。`,
      });
      nextActions.push("补充详情图、场景图或 SKU 图以提高商品分值。");
    }

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
  const score = Math.max(0, 100 - blockedReasons.length * 18 - warnings.length * 5);
  return {
    status: blockedReasons.length ? "blocked" : (warnings.length ? "warning" : "ready"),
    score,
    blockedReasons,
    warnings,
    nextActions: uniqueNextActions.length ? uniqueNextActions : ["继续保持 Payload 预检和人工确认提交。"],
  };
}
