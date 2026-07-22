/**
 * Conservative finance-domain read model.
 *
 * Orders, activity price impact and settlement/cost evidence are deliberately
 * separate inputs.  A cached order batch is not a settlement statement, and
 * an activity discount is not a profit result.
 */

const COST_EVIDENCE_FIELDS = Object.freeze([
  ["procurementCost", "采购成本"],
  ["logisticsFee", "物流费"],
  ["commission", "佣金"],
  ["miscFee", "杂费"],
  ["settlementRules", "结算规则"],
]);

function finiteAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function orderRevenue(orders) {
  let value = 0;
  let knownLines = 0;
  let unknownLines = 0;
  let excludedOrderCount = 0;
  for (const order of Array.isArray(orders) ? orders : []) {
    // Keep both normalized and raw status fields. An adapter may set
    // statusGroup="unknown" while retaining a raw `canceled`/`disputed`
    // status; preferring statusGroup alone would hide the settlement risk.
    const statuses = [order?.statusGroup, order?.status, order?.status_name]
      .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
    const substatus = String(order?.substatus || "").trim().toLowerCase();
    // Cancelled and disputed postings are not realized sales evidence. Do
    // not silently add their product rows to revenue while settlement/return
    // data is absent; surface the unresolved status to the seller instead.
    // Seller/API integrations use both US/UK spellings and occasionally a
    // past-tense `disputed` status. Treat every known cancellation/dispute
    // spelling as unresolved settlement evidence; otherwise a cancelled line
    // can be promoted into a complete revenue total.
    // Statuses can be qualified (for example cancelled_by_customer or
    // dispute_pending). Treat the whole cancellation/dispute family as
    // unresolved settlement evidence instead of counting a suffixed status as
    // realized revenue.
    if (statuses.some((status) => status.includes("cancel") || status.includes("disput")) || substatus.includes("dispute")) {
      excludedOrderCount += 1;
      continue;
    }
    for (const product of Array.isArray(order?.products) ? order.products : []) {
      const lineTotal = finiteAmount(product?.total_price ?? product?.totalPrice ?? product?.line_total ?? product?.amount);
      const unitPrice = finiteAmount(product?.price ?? product?.offer_price ?? product?.offerPrice);
      const quantity = finiteAmount(product?.quantity ?? product?.count ?? product?.qty);
      const amount = lineTotal !== null
        ? lineTotal
        : unitPrice === null
          ? null
          // A unit price without an observed quantity is not a line total.
          // Treating it as quantity=1 makes a partial order payload look like
          // complete revenue evidence (and can silently undercount bundles).
          : quantity !== null ? unitPrice * quantity : null;
      if (amount === null) {
        unknownLines += 1;
        continue;
      }
      value += amount;
      knownLines += 1;
    }
  }
  return { value, knownLines, unknownLines, excludedOrderCount, complete: unknownLines === 0 && excludedOrderCount === 0 };
}

function orderEvidence(batch = {}, { now = Date.now(), maxAgeMs = 60 * 60 * 1000 } = {}) {
  const hasNext = batch.hasNext === true || batch.has_next === true;
  const checkedAtProvided = batch.checkedAt !== undefined && batch.checkedAt !== null && String(batch.checkedAt).trim() !== "";
  const checkedAtMs = checkedAtProvided ? Date.parse(String(batch.checkedAt)) : null;
  const freshness = checkedAtProvided
    ? !Number.isFinite(checkedAtMs) || checkedAtMs > Number(now) + 5 * 60 * 1000
      ? "invalid"
      : Number(now) - checkedAtMs > Math.max(0, Number(maxAgeMs)) ? "stale" : "fresh"
    : "not_provided";
  const freshnessBlock = checkedAtProvided && freshness !== "fresh";
  if (freshnessBlock) {
    return {
      state: "unknown",
      code: freshness === "stale" ? "ORDER_READ_STALE" : "ORDER_READ_TIMESTAMP_INVALID",
      reason: freshness === "stale" ? "订单读取证据已过期，当前缓存不能作为当前销售额。" : "订单读取时间无效，不能判断当前销售额证据是否新鲜。",
      checkedAt: Number.isFinite(checkedAtMs) ? new Date(checkedAtMs).toISOString() : null,
      freshness,
    };
  }
  // Revenue is a scope-level number.  If the upstream read did not preserve
  // an explicit pagination signal, a successful page must not be promoted to
  // a complete store/range read.  Older direct callers may omit this field;
  // the guarded server route supplies `false` when the signal is absent.
  if (batch.paginationComplete === false) {
    return { state: "unknown", code: "ORDER_PAGINATION_EVIDENCE_MISSING", reason: "订单读取缺少可核对的分页结束证据，当前页面不能代表销售额范围。", checkedAt: checkedAtProvided ? new Date(checkedAtMs).toISOString() : null, freshness };
  }
  const complete = batch.loaded === true
    && batch.failed !== true
    && batch.partial !== true
    && !hasNext;
  if (batch.failed === true) {
    return { state: "unknown", code: "ORDER_READ_FAILED", reason: "订单读取失败，当前缓存不能作为全店销售额。", checkedAt: checkedAtProvided ? new Date(checkedAtMs).toISOString() : null, freshness };
  }
  if (batch.loaded !== true) {
    return { state: "unknown", code: "ORDER_READ_NOT_RUN", reason: "订单尚未读取，当前没有销售额证据。", checkedAt: checkedAtProvided ? new Date(checkedAtMs).toISOString() : null, freshness };
  }
  if (batch.partial === true || hasNext) {
    return { state: "partial", code: "ORDER_READ_INCOMPLETE", reason: "订单批次不完整或仍有后续分页，不能代表全店销售额。", checkedAt: checkedAtProvided ? new Date(checkedAtMs).toISOString() : null, freshness };
  }
  return { state: complete ? "complete" : "unknown", code: complete ? "ORDER_READ_COMPLETE" : "ORDER_READ_UNKNOWN", reason: complete ? "订单读取批次已结束。" : "订单读取状态未知，不能推导销售额。", checkedAt: checkedAtProvided ? new Date(checkedAtMs).toISOString() : null, freshness };
}

function costEvidence(input = {}) {
  const evidence = input && typeof input === "object" ? input : {};
  const missing = COST_EVIDENCE_FIELDS
    .filter(([key]) => evidence[key] !== true && evidence[key]?.observed !== true)
    .map(([, label]) => label);
  return {
    state: missing.length ? "unknown" : "observed",
    missing,
    source: evidence.source || "not_connected",
  };
}

function pricingEvidence(input = {}) {
  const diagnosis = input && typeof input === "object" ? input : null;
  if (!diagnosis) {
    return {
      status: "unknown",
      code: "PRICING_EVIDENCE_NOT_AVAILABLE",
      label: "定价证据未知",
      reason: "没有可追溯的定价诊断，不能把售价或利润数字当作经营结论。",
      nextAction: "先生成定价诊断并补齐佣金、物流和结算规则来源。",
    };
  }
  if (diagnosis.pricingBlocked === true || diagnosis.pricingBlockedReasonCode) {
    return {
      status: "blocked",
      code: String(diagnosis.pricingBlockedReasonCode || "PRICING_BLOCKED"),
      label: "定价被阻断",
      reason: "定价诊断存在必须先修复的阻塞，不能提交或接受为安全利润。",
      nextAction: "按阻塞原因修正采购、尺重、运费或最低价后重新预检。",
    };
  }
  const profitStatus = String(diagnosis.profitStatus || "unknown");
  if (profitStatus === "estimate") {
    return {
      status: "estimate",
      code: "PRICING_PROFIT_ESTIMATE",
      label: "利润为估算",
      reason: "价格公式可重算，但尚未以结算明细证明实际利润。",
      nextAction: "补充当前店铺/类目佣金与结算规则，再复核利润。",
    };
  }
  return {
    status: "unknown",
    code: "PRICING_PROFIT_UNKNOWN",
    label: "利润证据未知",
    reason: "佣金或结算规则证据不足，定价数字不能作为确定利润。",
    nextAction: "补齐可追溯佣金、物流、杂费和结算规则证据。",
  };
}

function buildFinanceEvidenceSummary({ order, costs, activity, pricing }) {
  const revenueKnown = order.revenueCoverage?.complete === true;
  const summary = [
    {
      key: "revenue",
      label: "订单销售额",
      status: order.state !== "complete" ? order.state === "partial" ? "blocked" : "unknown" : revenueKnown ? "observed" : "unknown",
      // Keep the value on the same server-built evidence entry consumed by
      // the finance panel.  Do not expose a number unless both the order
      // batch and every observed order line are complete.
      value: revenueKnown && Number.isFinite(Number(order.revenue)) ? Number(order.revenue) : null,
      code: order.state !== "complete" ? order.code : revenueKnown ? order.code : "ORDER_REVENUE_FIELDS_UNKNOWN",
      reason: order.state !== "complete"
        ? order.reason
        : revenueKnown
          ? order.reason
          : order.revenueCoverage?.excludedOrderCount > 0
            ? "订单范围包含取消或争议订单；在结算/退款明细回读前，当前合计不能作为净销售额。"
            : "订单范围已读取，但部分订单行缺少可核对金额字段，当前合计不能代表全店销售额。",
      nextAction: order.state !== "complete"
        ? "完成订单范围读取（含全部分页）后再查看销售额。"
        : revenueKnown
          ? "可查看当前已完成订单范围的销售额。"
          : order.revenueCoverage?.excludedOrderCount > 0
            ? "回读当前店铺结算/退款明细并复核取消、争议订单后，再查看净销售额。"
            : "补齐订单行金额或改用带财务明细的订单读取，再查看销售额。",
    },
    {
      key: "activityImpact",
      label: "活动价格影响",
      status: activity.state === "impact_only" ? "estimate" : "unknown",
      code: activity.state === "impact_only" ? "ACTIVITY_PRICE_IMPACT_ONLY" : "ACTIVITY_IMPACT_NOT_AVAILABLE",
      reason: activity.state === "impact_only" ? "仅比较活动价与当前价，不代表利润或结算结果。" : "没有活动价格影响证据。",
      nextAction: "仅将活动数据用于价格影响参考，不要据此宣称利润。",
    },
    {
      key: "costSettlement",
      label: "成本与结算证据",
      status: costs.state === "observed" ? "observed" : "unknown",
      code: costs.state === "observed" ? "FINANCE_COST_SETTLEMENT_OBSERVED" : "FINANCE_COST_SETTLEMENT_EVIDENCE_MISSING",
      reason: costs.state === "observed" ? "所需成本与结算字段均有观察证据。" : `缺少：${costs.missing.join("、") || "成本/结算字段"}。`,
      nextAction: costs.state === "observed" ? "可继续核对利润口径。" : "补齐缺失成本、费用和结算规则证据。",
    },
    {
      key: "profit",
      label: "利润结论",
      status: "unknown",
      code: "FINANCE_SETTLEMENT_NOT_VERIFIED",
      reason: "财务模型不从订单金额、活动折扣或定价估算推导确定利润。",
      nextAction: "完成结算证据回读并核对成本后，再生成利润报表。",
    },
  ];
  const pricingSummary = pricing && ["observed", "estimate", "unknown", "blocked"].includes(pricing.status) && pricing.code
    ? pricing
    : pricingEvidence(pricing);
  summary.push({ key: "listingPricing", label: "上架定价", ...pricingSummary });
  return summary;
}

export function buildFinanceDomainReadModel(input = {}) {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const order = orderEvidence(input.orderBatch, { now: input.now || Date.now(), maxAgeMs: input.orderMaxAgeMs });
  const serverReadDeclared = input.observationMode === "server_read";
  const revenue = order.state === "complete"
    ? orderRevenue(orders)
    : { value: null, knownLines: 0, unknownLines: 0, excludedOrderCount: 0, complete: false };
  const costs = costEvidence(input.costEvidence);
  const activityInput = input.activityImpact && typeof input.activityImpact === "object"
    ? input.activityImpact
    : null;
  const knownActivityPrices = Number(activityInput?.knownPriceCount || 0);
  // A page can contain comparable prices while still being only a partial
  // activity scope.  Those rows are useful for a local preview, but they
  // must not become a finance estimate until the Seller API confirms the
  // activity range is complete.  Keep the legacy behaviour for callers that
  // do not provide coverage metadata; explicit false/partial/unknown states
  // are the safety boundary for real responses.
  const activityCoverageIncomplete = activityInput?.coverageComplete === false
    || ["partial", "unknown"].includes(String(activityInput?.status || "").toLowerCase());
  const activity = activityInput
    ? {
      // An activity response with no comparable prices is not an impact
      // estimate. Keep it unavailable so an empty/unknown read cannot look
      // like evidence to a seller.
      state: knownActivityPrices > 0 && !activityCoverageIncomplete ? "impact_only" : "not_available",
      knownPriceCount: activityCoverageIncomplete ? 0 : knownActivityPrices,
      unknownPriceCount: Number(activityInput.unknownPriceCount || 0),
      profitConclusion: knownActivityPrices > 0 && !activityCoverageIncomplete
        ? "unknown_without_cost_commission_and_settlement_rules"
        : activityCoverageIncomplete
          ? "unknown_with_incomplete_activity_scope"
          : "unknown_without_comparable_activity_prices",
    }
    : { state: "not_available", knownPriceCount: 0, unknownPriceCount: 0, profitConclusion: "unknown" };
  const pricing = pricingEvidence(input.pricingDiagnosis);
  const blockers = [];
  if (order.state !== "complete") blockers.push(order.code);
  if (order.state === "complete" && revenue.complete !== true) blockers.push("ORDER_REVENUE_FIELDS_UNKNOWN");
  if (order.state === "complete" && revenue.excludedOrderCount > 0) blockers.push("ORDER_REVENUE_STATUS_UNRESOLVED");
  if (costs.state !== "observed") blockers.push("FINANCE_COST_SETTLEMENT_EVIDENCE_MISSING");
  if (activity.state === "impact_only") blockers.push("ACTIVITY_PRICE_IMPACT_NOT_PROFIT");
  if (activityInput && activityCoverageIncomplete) blockers.push("ACTIVITY_SCOPE_INCOMPLETE");
  if (pricing.status === "blocked") blockers.push(pricing.code);
  // Surface the highest-risk actionable blocker first.  Previously a missing
  // cost snapshot could hide a pricing block in the seller-facing nextAction,
  // leaving the operator without the repair they must perform before any
  // write.  Unknown/estimate evidence remains non-profit evidence.
  const nextAction = pricing.status === "blocked"
    ? pricing.nextAction
    : ["ORDER_READ_STALE", "ORDER_READ_TIMESTAMP_INVALID"].includes(order.code)
      ? "重新读取当前店铺订单范围，确认读取时间有效且在新鲜窗口内后再查看销售额。"
    : order.state !== "complete"
      ? "先读取并完成当前店铺订单范围（含全部分页），再查看销售额。"
      : revenue.complete !== true
        ? revenue.excludedOrderCount > 0
          ? "回读当前店铺结算/退款明细并复核取消、争议订单后，再查看净销售额。"
          : "补齐订单行金额或改用带财务明细的订单读取，再查看销售额。"
      : costs.state !== "observed"
        ? "补齐采购成本、物流费、佣金、杂费和结算规则的可追溯证据；未补齐前不要宣称利润。"
        : "核对成本与结算证据后再生成利润报表；活动数据只能作为价格影响参考。";
  const evidenceSummary = buildFinanceEvidenceSummary({
    order: { ...order, revenue: revenue.complete === true ? revenue.value : null, revenueCoverage: revenue },
    costs,
    activity,
    pricing,
  });
  return {
    readOnly: true,
    liveReadObserved: serverReadDeclared && order.state === "complete" && revenue.complete === true,
    verificationLevel: serverReadDeclared
      ? (order.state === "complete" && revenue.complete === true ? "server_observed" : "partial")
      : "locally_tested",
    order: {
      ...order,
      revenue: revenue.complete === true ? revenue.value : null,
      knownRevenueLines: revenue.knownLines,
      unknownRevenueLines: revenue.unknownLines,
      excludedRevenueOrders: revenue.excludedOrderCount,
      revenueCoverage: {
        complete: revenue.complete === true,
        knownLines: revenue.knownLines,
        unknownLines: revenue.unknownLines,
        excludedOrderCount: revenue.excludedOrderCount,
      },
      checkedAt: order.checkedAt || null,
      freshness: order.freshness || "not_provided",
    },
    costs,
    activity,
    profit: { state: "unknown", value: null, reasonCode: "FINANCE_SETTLEMENT_NOT_VERIFIED" },
    evidenceSummary,
    sellerResult: {
      state: blockers.length ? "blocked" : "ready_for_review",
      blockerCodes: blockers,
      nextAction,
      evidenceSummary,
      sideEffect: "只生成只读经营摘要，不会修改订单、活动、价格或结算数据。",
    },
  };
}

export { COST_EVIDENCE_FIELDS, buildFinanceEvidenceSummary, pricingEvidence };
