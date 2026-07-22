// Conservative read contracts for Seller API product price/stock pages.
// Raw rows remain untouched; this projection only records what is evidenced.
export function buildProductReadEvidence(data = {}, { kind = "product" } = {}) {
  const container = data?.result && typeof data.result === "object" ? data.result : data;
  const recognized = Boolean(container && Array.isArray(container.items));
  const rows = recognized ? container.items : [];
  const cursor = String(container?.last_id || data?.last_id || "").trim();
  const hasNext = Boolean(container?.has_next || data?.has_next || cursor);
  const missingEvidence = [];
  if (!recognized) missingEvidence.push(`${kind}_response`);
  if (hasNext) missingEvidence.push("pagination");
  rows.forEach((row, index) => {
    const identity = row?.product_id || row?.offer_id || row?.offerId;
    if (!identity) missingEvidence.push(`${kind}_identity:${index}`);
    // old_price/min_price/acquiring_price are reference or guardrail fields,
    // not evidence that a current selling price was observed. Keep a row
    // partial when only those fields are present so a stale/reference price
    // cannot look like a complete price batch.
    const hasValue = kind === "prices"
      ? [row?.current_price, row?.currentPrice, row?.price].some((value) => value !== undefined && value !== null && value !== "")
      : (Array.isArray(row?.stocks) || row?.stock !== undefined || row?.present !== undefined);
    if (!hasValue) missingEvidence.push(`${kind}_value:${index}`);
  });
  const uniqueMissing = [...new Set(missingEvidence)];
  const readStatus = !recognized ? "unknown" : uniqueMissing.length ? "partial" : (rows.length ? "completed" : "empty");
  return {
    readOnly: true,
    responseRecognized: recognized,
    rowCount: rows.length,
    hasNext,
    last_id: cursor,
    partial: readStatus === "partial",
    readStatus,
    missingEvidence: uniqueMissing,
    safeToConclude: readStatus === "completed" && !hasNext,
    nextAction: readStatus === "completed" && !hasNext
      ? "可查看本批 Seller API 返回结果；成本、佣金、物流和利润仍需单独复算。"
      : "补读缺失字段或下一页后再判断价格/库存；当前未知值不得按 0 或默认价处理。",
  };
}
