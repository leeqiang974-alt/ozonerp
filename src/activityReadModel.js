/**
 * Convert the product rows returned by an Ozon activity read into a seller
 * facing, read-only impact summary.  Missing prices are deliberately kept as
 * unknown: an activity response is not enough evidence to calculate profit.
 */
function firstNumber(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export function buildPromotionImpactPreview(rows) {
  const items = Array.isArray(rows) ? rows : [];
  let known = 0;
  let unknown = 0;
  let totalReduction = 0;
  const unknownReasons = new Set();
  const products = items.map((row) => {
    // Ozon old_price is the original/strikethrough price, not proof of the
    // current selling price. Never use it to manufacture an activity impact.
    const currentPrice = firstNumber(row, ["current_price", "currentPrice", "price"]);
    // Range bounds are not an observed selling price.  Only an explicit
    // action/discount price can support a reduction preview; otherwise keep
    // the impact unknown rather than turning a candidate range into a seller
    // conclusion.
    const actionPrice = firstNumber(row, ["action_price", "actionPrice", "discount_price"]);
    // A zero action price is not a valid observed Ozon selling price. Treat it
    // as unknown rather than manufacturing a 100% activity reduction.
    if (currentPrice === null || actionPrice === null || currentPrice <= 0 || actionPrice <= 0) {
      unknown += 1;
      unknownReasons.add(currentPrice === null || actionPrice === null ? "活动商品缺少当前价或活动价" : "活动价格数值不可用于比较");
      return { productId: row?.product_id || row?.id || row?.productId || "", currentPrice, actionPrice, reductionPercent: null, impact: "unknown" };
    }
    const reductionPercent = Math.round(Math.max(0, (currentPrice - actionPrice) / currentPrice * 10000)) / 100;
    known += 1;
    totalReduction += Math.max(0, currentPrice - actionPrice);
    return { productId: row?.product_id || row?.id || row?.productId || "", currentPrice, actionPrice, reductionPercent, impact: "known" };
  });
  return {
    readOnly: true,
    productCount: items.length,
    knownPriceCount: known,
    unknownPriceCount: unknown,
    totalReduction,
    averageReductionPercent: known ? Math.round(products.filter((item) => item.impact === "known").reduce((sum, item) => sum + item.reductionPercent, 0) / known * 100) / 100 : null,
    unknownReasons: [...unknownReasons],
    profitConclusion: "unknown_without_cost_commission_and_settlement_rules",
    products,
  };
}

function activityRows(data = {}) {
  const candidates = [data?.actions, data?.activities, data?.products, data?.items, data?.result?.actions, data?.result?.activities, data?.result?.products, data?.result?.items];
  return candidates.find(Array.isArray) || [];
}

/**
 * Keep activity reads seller-facing and honest about coverage.  A page of
 * products is not a complete activity result unless the API explicitly says
 * there is no next page or supplies a total that has been fully consumed.
 */
export function buildActivityReadSellerResult(data = {}, { kind = "activity", offset = 0, limit = 1000 } = {}) {
  const rows = activityRows(data);
  const result = data?.result && typeof data.result === "object" ? data.result : {};
  const hasNextValue = data?.has_next ?? data?.hasNext ?? result?.has_next ?? result?.hasNext;
  const totalRaw = data?.total ?? data?.total_count ?? data?.totalCount ?? result?.total ?? result?.total_count ?? result?.totalCount;
  const total = Number.isFinite(Number(totalRaw)) && Number(totalRaw) >= 0 ? Number(totalRaw) : null;
  const start = Math.max(0, Number(offset) || 0);
  const pageSize = Math.min(1000, Math.max(1, Number(limit) || 1000));
  const totalCovered = total !== null && start + rows.length >= total;
  const totalIncomplete = total !== null && start + rows.length < total;
  // A page starting after the reported total, or extending beyond it, is not
  // a valid empty/final page. Treat stale offsets and contradictory totals as
  // unknown instead of telling the seller that the activity scope is complete.
  const totalRangeInvalid = total !== null && (start > total || start + rows.length > total);
  // Contradictory pagination metadata must never promote a page to complete
  // (or empty).  This can happen when an upstream proxy/cache returns a stale
  // has_next flag alongside a current total.  Keep the rows visible, but make
  // the seller resolve the read before relying on its coverage.
  const paginationSignalInvalid = totalRangeInvalid
    || (hasNextValue === false && totalIncomplete)
    || (hasNextValue === true && totalCovered);
  const complete = !paginationSignalInvalid && (hasNextValue === false || totalCovered);
  const partial = !paginationSignalInvalid && (hasNextValue === true || totalIncomplete);
  const status = paginationSignalInvalid
    ? "unknown"
    : partial ? "partial" : (complete ? (rows.length ? "complete" : "empty") : "unknown");
  const nextAction = paginationSignalInvalid
    ? "分页范围或标记与总数互相矛盾；重新读取活动范围后再判断是否完整。"
    : partial
    ? "继续读取下一页后再判断活动范围和价格影响。"
    : status === "unknown"
      ? "确认接口是否返回分页/总数，再决定是否可作为完整活动证据。"
      : status === "empty"
        ? "当前读取范围没有活动记录；不要据此推导全店状态。"
        : "当前读取范围已完成；活动影响仍需结合有效价格、成本、佣金和结算证据。";
  return {
    status,
    kind: String(kind || "activity"),
    rowCount: rows.length,
    total,
    offset: start,
    limit: pageSize,
    nextOffset: partial ? start + rows.length : null,
    coverageText: total === null ? `已读取 ${start + rows.length} 条，服务端总量未知` : `已读取 ${Math.min(start + rows.length, total)} / ${total} 条`,
    coverageComplete: complete,
    paginationSignalInvalid,
    nextAction,
    sideEffect: "仅读取活动数据和价格影响，不加入/移出活动，不修改价格、库存或订单。",
  };
}
