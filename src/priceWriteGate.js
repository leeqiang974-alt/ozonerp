const PRICE_FIELDS = ["price", "old_price", "min_price", "currency_code"];

function identity(row = {}) {
  const offerId = String(row.offer_id ?? row.offerId ?? "").trim();
  if (offerId) return `offer:${offerId}`;
  const productId = Number(row.product_id ?? row.productId ?? 0);
  return Number.isSafeInteger(productId) && productId > 0 ? `product:${productId}` : "";
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function rowsFromEvidence(evidence = {}) {
  const container = evidence?.result && typeof evidence.result === "object" ? evidence.result : evidence;
  return Array.isArray(container?.items) ? container.items : (Array.isArray(container?.products) ? container.products : []);
}

function value(row, field) {
  if (field === "currency_code") return String(row?.currency_code ?? row?.currencyCode ?? "").trim();
  const nested = row?.price && typeof row.price === "object" && field === "price" ? row.price.value : row?.[field];
  return numeric(nested);
}

export function buildPriceDiff(currentRows = [], proposedRows = []) {
  const current = new Map(currentRows.map((row) => [identity(row), row]).filter(([key]) => key));
  const diff = [];
  const missing = [];
  for (const proposed of proposedRows) {
    const key = identity(proposed);
    const observed = current.get(key);
    if (!key || !observed) {
      missing.push(key || "missing_identity");
      continue;
    }
    const changes = {};
    for (const field of PRICE_FIELDS) {
      const before = value(observed, field);
      const after = value(proposed, field);
      if (after !== null && after !== "" && before !== after) changes[field] = { before, after };
    }
    diff.push({ identity: key, offer_id: String(proposed.offer_id ?? observed.offer_id ?? ""), changes });
  }
  return { diff, missing };
}

export function validatePriceWritePreflight({ prices = [], evidence = {}, confirm = false, now = Date.now(), maxAgeMs = 30 * 60 * 1000 } = {}) {
  const blockers = [];
  const proposedRows = Array.isArray(prices) ? prices : [];
  if (!proposedRows.length) blockers.push("DIRECT_WRITE_PRICES_REQUIRED");
  if (confirm !== true) blockers.push("DIRECT_WRITE_PRICE_CONFIRMATION_REQUIRED");
  const verificationLevel = String(evidence.verificationLevel || "");
  if (verificationLevel !== "server_observed") blockers.push("DIRECT_WRITE_PRICE_EVIDENCE_SERVER_REQUIRED");
  const checkedAt = Date.parse(String(evidence.checkedAt || ""));
  if (!Number.isFinite(checkedAt) || now - checkedAt > maxAgeMs || checkedAt > now + 60_000) blockers.push("DIRECT_WRITE_PRICE_EVIDENCE_STALE");
  const readEvidence = evidence.readEvidence || {};
  if (readEvidence.readStatus !== "completed" || readEvidence.hasNext === true || readEvidence.safeToConclude !== true) blockers.push("DIRECT_WRITE_PRICE_EVIDENCE_INCOMPLETE");
  const currentRows = rowsFromEvidence(evidence);
  const { diff, missing } = buildPriceDiff(currentRows, proposedRows);
  if (missing.length) blockers.push("DIRECT_WRITE_PRICE_CURRENT_MISSING");
  if (!diff.some((item) => Object.keys(item.changes).length)) blockers.push("DIRECT_WRITE_PRICE_NO_CHANGE");
  const risks = [];
  for (const row of proposedRows) {
    const price = value(row, "price");
    const minPrice = value(row, "min_price");
    const source = row.priceSource || evidence.priceSource || {};
    if (!source.mode || !source.verificationLevel) risks.push({ identity: identity(row), code: "PRICE_SOURCE_UNKNOWN", level: "high" });
    if (price === null || price <= 0) risks.push({ identity: identity(row), code: "PRICE_INVALID", level: "high" });
    if (minPrice !== null && price !== null && minPrice >= price) risks.push({ identity: identity(row), code: "PRICING_MIN_PRICE_INVALID", level: "high" });
  }
  if (risks.length) blockers.push("DIRECT_WRITE_PRICE_RISK_BLOCKED");
  return {
    executable: blockers.length === 0,
    blockers: [...new Set(blockers)],
    diff,
    risks,
    verificationLevel,
    checkedAt: Number.isFinite(checkedAt) ? new Date(checkedAt).toISOString() : "",
    currentCount: currentRows.length,
    proposedCount: proposedRows.length,
    nextAction: blockers.length ? "先重新读取当前价格、核对来源和风险，再人工确认价格差异；未确认前不会写入 Ozon。" : "确认结构化价格差异后执行，并按相同 Offer 写后只读回查。",
    sideEffect: "本次仅生成价格写入前证据和差异预览；阻塞时不会调用 Ozon 写接口。",
  };
}

export function reconcilePriceWriteReadback({ prices = [], evidence = {} } = {}) {
  const container = evidence?.result && typeof evidence.result === "object" ? evidence.result : evidence;
  const recognized = Array.isArray(container?.items) || Array.isArray(container?.products);
  const hasNext = Boolean(container?.has_next || evidence?.has_next || container?.last_id || evidence?.last_id);
  const current = new Map(rowsFromEvidence(evidence).map((row) => [identity(row), row]).filter(([key]) => key));
  const missing = [];
  const mismatches = [];
  for (const target of prices) {
    const key = identity(target);
    const observed = current.get(key);
    if (!key || !observed) { missing.push(key || "missing_identity"); continue; }
    const changes = {};
    for (const field of PRICE_FIELDS) {
      const wanted = value(target, field);
      if (wanted === null || wanted === "") continue;
      const actual = value(observed, field);
      if (actual !== wanted) changes[field] = { expected: wanted, observed: actual };
    }
    if (Object.keys(changes).length) mismatches.push({ identity: key, changes });
  }
  const incomplete = !recognized || hasNext;
  return { reconciled: !incomplete && missing.length === 0 && mismatches.length === 0, missing, mismatches, incomplete, status: incomplete || missing.length || mismatches.length ? "needs_review" : "reconciled" };
}

export { identity as priceWriteIdentity };
