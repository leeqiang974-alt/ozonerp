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
      const invalid = attrValues(attribute).some((value) => !Number(value?.dictionary_value_id || 0));
      if (invalid) {
        blockedReasons.push({
          code: "DICTIONARY_VALUE_INVALID",
          offerId,
          attributeId: id,
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
