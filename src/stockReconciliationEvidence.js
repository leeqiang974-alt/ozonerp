import { normalizeOzonProductStatusProducts } from "./autoListing.js";
import { buildOperationEvidenceRecord } from "./apiEvidence.js";
import { buildReadEndpointRequest } from "./readEndpointRequest.js";

const READ_ENDPOINTS = [
  "/v3/product/list",
  "/v3/product/info/list",
  "/v4/product/info/stocks",
  "/v2/warehouse/list",
];

function validationFailure(reasonCode, message) {
  return { ok: false, status: 400, reasonCode, message, readOnly: true };
}

function canonicalOfferIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function canonicalWarehouseIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isSafeInteger(item) && item > 0))];
}

function explicitProductStatus(product = {}) {
  const status = product.status;
  const text = [
    typeof status === "string" ? status : status?.state,
    typeof status === "object" ? status?.state_name || status?.name : "",
    product.status_group,
    product.status_name,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/fail|error|declin|reject|revision|доработ|ошиб/.test(text)) return "failed";
  if (/selling|ready_for_sale|готов.*продаж|прода/.test(text) && product.visible === true) return "ready";
  if (/moder|pending|process|созда|провер/.test(text)) return "pending";
  return "unknown";
}

function warehouseRows(value = {}) {
  const recognized = Array.isArray(value?.warehouses) || Array.isArray(value?.result);
  const source = Array.isArray(value?.warehouses) ? value.warehouses
    : (Array.isArray(value?.result) ? value.result : []);
  const rows = source.map((row) => ({
    warehouse_id: Number(row?.warehouse_id || row?.warehouseId || 0),
    status: String(row?.status || "unknown"),
    is_rf: row?.is_rf === true,
    is_rfbs: row?.is_rfbs === true,
    delivery_method_type: String(row?.delivery_method_type || ""),
  })).filter((row) => row.warehouse_id > 0);
  return { recognized, rows };
}

function stockRows(value = {}) {
  const recognized = Array.isArray(value?.result?.items) || Array.isArray(value?.items) || Array.isArray(value?.result);
  const items = value?.result?.items || value?.items || (Array.isArray(value?.result) ? value.result : []);
  const rows = [];
  for (const item of Array.isArray(items) ? items : []) {
    for (const stock of Array.isArray(item?.stocks) ? item.stocks : []) {
      const warehouseId = Number(stock?.warehouse_id || stock?.warehouseId || 0);
      const hasPresent = stock?.present !== undefined && stock?.present !== null && stock?.present !== "";
      const hasReserved = stock?.reserved !== undefined && stock?.reserved !== null && stock?.reserved !== "";
      const present = Number(stock?.present);
      const reserved = Number(stock?.reserved);
      if (!warehouseId || !hasPresent || !hasReserved || !Number.isFinite(present) || !Number.isFinite(reserved)) continue;
      rows.push({
        offer_id: String(item?.offer_id || item?.offerId || ""),
        product_id: Number(item?.product_id || item?.productId || 0),
        warehouse_id: warehouseId,
        present,
        reserved,
      });
    }
  }
  return { recognized, rows };
}

function errorValueCount(value) {
  if (Array.isArray(value)) return value.length;
  return value ? 1 : 0;
}

function embeddedErrors(value = {}) {
  let errorCount = 0;
  const offerIds = new Set();
  const inspectContainer = (container) => {
    if (!container || typeof container !== "object") return;
    errorCount += errorValueCount(container.error);
    errorCount += errorValueCount(container.errors);
    if (container.partial === true || String(container.status || "").toLowerCase() === "partial") errorCount += 1;
  };
  inspectContainer(value);
  inspectContainer(value?.result);
  const items = value?.result?.items || value?.items || (Array.isArray(value?.result) ? value.result : []);
  for (const item of Array.isArray(items) ? items : []) {
    const itemErrorCount = errorValueCount(item?.error) + errorValueCount(item?.errors);
    errorCount += itemErrorCount;
    const offerId = String(item?.offer_id || item?.offerId || "").trim();
    if (itemErrorCount > 0 && offerId) offerIds.add(offerId);
  }
  return { errorCount, offerIds: [...offerIds] };
}

function responseCursor(value = {}, endpoint = "") {
  const cursor = value?.cursor ?? value?.result?.cursor ?? value?.last_id ?? value?.result?.last_id ?? "";
  return String(cursor || "").trim();
}

function responseRows(value = {}, endpoint = "") {
  if (endpoint === "/v4/product/info/stocks") {
    return value?.result?.items || value?.items || (Array.isArray(value?.result) ? value.result : []);
  }
  return value?.warehouses || value?.result || [];
}

function mergePagedResponse(endpoint, pages) {
  const first = pages[0]?.data || {};
  const firstRecognized = endpoint === "/v4/product/info/stocks"
    ? (Array.isArray(first?.result?.items) || Array.isArray(first?.items) || Array.isArray(first?.result))
    : (Array.isArray(first?.warehouses) || Array.isArray(first?.result));
  if (!firstRecognized) return first;
  const rows = pages.flatMap((page) => responseRows(page.data, endpoint));
  if (endpoint === "/v4/product/info/stocks") {
    if (Array.isArray(first?.result?.items)) return { ...first, result: { ...first.result, items: rows, cursor: "", last_id: "", has_next: false } };
    return { ...first, items: rows, cursor: "", last_id: "", has_next: false };
  }
  if (Array.isArray(first?.warehouses)) return { ...first, warehouses: rows, cursor: "", last_id: "", has_next: false };
  return { ...first, result: rows, cursor: "", last_id: "", has_next: false };
}

export async function readBoundedPages(endpoint, initialPayload, deps, maxPages = 20) {
  const pages = [];
  const cursors = new Set();
  let payload = initialPayload;
  let paginationComplete = true;
  let paginationCursorRepeated = false;
  for (let page = 0; page < maxPages; page += 1) {
    const data = await deps.readEndpoint(endpoint, payload);
    pages.push({ data });
    const nextCursor = responseCursor(data, endpoint);
    if (!nextCursor) break;
    if (cursors.has(nextCursor) || page + 1 >= maxPages) {
      paginationComplete = false;
      paginationCursorRepeated = cursors.has(nextCursor);
      break;
    }
    cursors.add(nextCursor);
    payload = { ...initialPayload, cursor: nextCursor };
  }
  return {
    data: mergePagedResponse(endpoint, pages),
    pageCount: pages.length,
    paginationComplete,
    paginationCursorRepeated,
    nextCursor: responseCursor(pages[pages.length - 1]?.data || {}, endpoint),
  };
}

export async function gatherStockReconciliationEvidence(input = {}, deps = {}) {
  const storeId = String(input.storeId || "").trim();
  const offerIds = canonicalOfferIds(input.offerIds);
  const warehouseIds = canonicalWarehouseIds(input.warehouseIds);
  if (!storeId) return validationFailure("STOCK_EVIDENCE_STORE_REQUIRED", "请提供店铺 ID。");
  if (!offerIds.length) return validationFailure("STOCK_EVIDENCE_OFFERS_REQUIRED", "请提供 1 到 100 个 Offer ID。");
  if (offerIds.length > 100) return validationFailure("STOCK_EVIDENCE_OFFERS_LIMIT_EXCEEDED", "单次最多读取 100 个 Offer ID。");
  if (warehouseIds.length > 100) return validationFailure("STOCK_EVIDENCE_WAREHOUSES_LIMIT_EXCEEDED", "单次最多绑定 100 个仓库 ID。");
  if (offerIds.some((offerId) => offerId.length > 128 || !/^[^\s]+$/.test(offerId))) {
    return validationFailure("STOCK_EVIDENCE_OFFER_INVALID", "Offer ID 格式无效。");
  }
  if (typeof deps.readEndpoint !== "function") {
    return validationFailure("STOCK_EVIDENCE_READ_DEPENDENCY_REQUIRED", "缺少只读库存证据依赖。");
  }

  // Keep this aggregate read on the same endpoint-specific contracts used by
  // the controlled-read operator.  In particular, v4 stocks is cursor based;
  // sending the old `last_id` shape can silently return an unscoped/first page
  // and make an exact offer/warehouse tuple look current when it is not.
  const payloads = [
    buildReadEndpointRequest(READ_ENDPOINTS[0], { offerIds, limit: offerIds.length }).body,
    buildReadEndpointRequest(READ_ENDPOINTS[1], { offerIds }).body,
    buildReadEndpointRequest(READ_ENDPOINTS[2], { offerIds, limit: offerIds.length, cursor: "" }).body,
    buildReadEndpointRequest(READ_ENDPOINTS[3], { warehouseIds, limit: 200, cursor: "" }).body,
  ];
  const settled = await Promise.all(READ_ENDPOINTS.map(async (endpoint, index) => {
    try {
      const paged = endpoint === READ_ENDPOINTS[2] || endpoint === READ_ENDPOINTS[3]
        ? await readBoundedPages(endpoint, payloads[index], deps)
        : { data: await deps.readEndpoint(endpoint, payloads[index]), pageCount: 1, paginationComplete: true, paginationCursorRepeated: false, nextCursor: "" };
      const data = paged.data;
      const embedded = embeddedErrors(data);
      return {
        endpoint,
        status: embedded.errorCount > 0 || !paged.paginationComplete ? "partial" : "completed",
        errorCount: embedded.errorCount,
        errorOfferIds: embedded.offerIds,
        data,
        pageCount: paged.pageCount,
        paginationComplete: paged.paginationComplete,
        paginationCursorRepeated: paged.paginationCursorRepeated,
        nextCursor: paged.nextCursor,
      };
    } catch {
      return { endpoint, status: "failed", errorCount: 1, errorOfferIds: [], data: null, pageCount: 0, paginationComplete: false, paginationCursorRepeated: false, nextCursor: "" };
    }
  }));
  const byEndpoint = new Map(settled.map((item) => [item.endpoint, item]));
  const listAttempt = byEndpoint.get(READ_ENDPOINTS[0]);
  const detailAttempt = byEndpoint.get(READ_ENDPOINTS[1]);
  const normalizedProducts = normalizeOzonProductStatusProducts({
    listResponse: listAttempt?.data || {},
    detailResponse: detailAttempt?.data || {},
  });
  const products = normalizedProducts.map((product) => ({
    offer_id: String(product.offer_id || ""),
    product_id: Number(product.product_id || 0),
    status: explicitProductStatus(product),
    visible: typeof product.visible === "boolean" ? product.visible : null,
  }));
  const warehouseEvidence = warehouseRows(byEndpoint.get(READ_ENDPOINTS[3])?.data || {});
  const stockEvidence = stockRows(byEndpoint.get(READ_ENDPOINTS[2])?.data || {});
  const warehouses = warehouseEvidence.rows;
  const currentStocks = stockEvidence.rows;
  const productByOffer = new Map(products.map((product) => [product.offer_id, product]));
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.warehouse_id, warehouse]));
  const missingEvidence = [];
  // Inventory readiness is only meaningful for an exact (offer_id,
  // warehouse_id) tuple. Without a target warehouse, preserve the read for
  // diagnostics but mark it incomplete so an arbitrary stock row cannot look
  // like the seller's target tuple.
  if (!warehouseIds.length) missingEvidence.push("warehouse_scope_required");
  if (listAttempt?.status !== "completed") missingEvidence.push("product_list");
  if (detailAttempt?.status !== "completed") missingEvidence.push("product_details");
  if (byEndpoint.get(READ_ENDPOINTS[2])?.status !== "completed") missingEvidence.push("current_stocks");
  if (byEndpoint.get(READ_ENDPOINTS[3])?.status !== "completed") missingEvidence.push("warehouses");
  for (const attempt of [byEndpoint.get(READ_ENDPOINTS[2]), byEndpoint.get(READ_ENDPOINTS[3])]) {
    if (attempt?.paginationCursorRepeated) missingEvidence.push(`pagination_cursor_repeated:${attempt.endpoint}`);
  }
  if (byEndpoint.get(READ_ENDPOINTS[2])?.status === "completed" && !stockEvidence.recognized) missingEvidence.push("current_stocks_response_unrecognized");
  if (byEndpoint.get(READ_ENDPOINTS[3])?.status === "completed" && !warehouseEvidence.recognized) missingEvidence.push("warehouses_response_unrecognized");
  const createdWarehouses = warehouses.filter((warehouse) => warehouse.status === "created");
  const modeVerified = createdWarehouses.some((warehouse) => warehouse.is_rf === true
    || warehouse.is_rfbs === true || Boolean(warehouse.delivery_method_type));
  const warehouseEligibility = !createdWarehouses.length
    ? "none_created"
    : modeVerified ? "mode_observed" : "mode_unknown";
  if (warehouseEvidence.recognized && !createdWarehouses.length) missingEvidence.push("eligible_warehouse");
  if (warehouseEvidence.recognized && createdWarehouses.length > 0 && !modeVerified) {
    missingEvidence.push("warehouse_mode_unverified");
  }
  const detailData = detailAttempt?.data;
  const listData = listAttempt?.data;
  const listRecognized = Array.isArray(listData?.items) || Array.isArray(listData?.result?.items);
  const detailRecognized = Array.isArray(detailData?.items) || Array.isArray(detailData?.result?.items);
  if (listAttempt?.status === "completed" && !listRecognized) missingEvidence.push("product_list_response_unrecognized");
  if (detailAttempt?.status === "completed" && !detailRecognized) missingEvidence.push("product_details_response_unrecognized");
  const sourceNames = ["product_list", "product_details", "current_stocks", "warehouses"];
  READ_ENDPOINTS.forEach((endpoint, index) => {
    const attempt = byEndpoint.get(endpoint);
    if (attempt?.status !== "partial") return;
    const source = sourceNames[index];
    missingEvidence.push(`embedded_errors:${source}`);
    for (const offerId of attempt.errorOfferIds || []) {
      if (offerIds.includes(offerId)) missingEvidence.push(`embedded_error:${source}:${offerId}`);
    }
  });
  for (const offerId of offerIds) {
    if (!products.some((product) => product.offer_id === offerId)) missingEvidence.push(`product:${offerId}`);
    if (!currentStocks.some((stock) => stock.offer_id === offerId)) missingEvidence.push(`current_stock:${offerId}`);
    for (const warehouseId of warehouseIds) {
      if (!currentStocks.some((stock) => stock.offer_id === offerId && stock.warehouse_id === warehouseId)) {
        missingEvidence.push(`current_stock:${offerId}:${warehouseId}`);
      }
    }
  }
  // Offer/warehouse presence alone is not enough: a stale or mixed Seller
  // response can attach the tuple to a different product_id. Keep that tuple
  // unknown instead of allowing a stock write to cross product identities.
  for (const stock of currentStocks) {
    const product = productByOffer.get(stock.offer_id);
    if (!product || !offerIds.includes(stock.offer_id)) continue;
    if (Number(product.product_id || 0) > 0 && Number(stock.product_id || 0) !== Number(product.product_id)) {
      missingEvidence.push(`current_stock_product_mismatch:${stock.offer_id}:${stock.warehouse_id}`);
    }
  }
  // A current stock row alone does not prove that the requested warehouse is
  // an observed, writable Ozon warehouse.  Keep the exact target warehouse in
  // the evidence contract so an unrelated created warehouse cannot make the
  // tuple look ready.
  for (const warehouseId of warehouseIds) {
    const warehouse = warehouseById.get(warehouseId);
    if (!warehouse) {
      missingEvidence.push(`warehouse:${warehouseId}`);
    } else if (String(warehouse.status || "").toLowerCase() !== "created") {
      missingEvidence.push(`warehouse_not_ready:${warehouseId}`);
    }
  }
  const checkedAtValue = typeof deps.now === "function" ? deps.now() : new Date();
  const checkedAt = (checkedAtValue instanceof Date ? checkedAtValue : new Date(checkedAtValue)).toISOString();
  const partial = missingEvidence.length > 0;
  const productStatusReadyForAll = !partial
    && offerIds.every((offerId) => products.some((product) => product.offer_id === offerId && product.status === "ready"));
  const completeForRequestedIds = !partial
    && productStatusReadyForAll
    && offerIds.every((offerId) => currentStocks.some((stock) => stock.offer_id === offerId))
    && offerIds.every((offerId) => warehouseIds.every((warehouseId) => currentStocks.some((stock) => stock.offer_id === offerId && stock.warehouse_id === warehouseId)));
  const operationEvidence = settled.map((attempt) => buildOperationEvidenceRecord({
    operationPath: attempt.endpoint,
    checkedAt,
    statusCode: attempt.status === "failed" ? 599 : 200,
    response: attempt.data,
    verificationLevel: attempt.status === "completed" ? "server_observed" : "partial",
    source: "stock-reconciliation-evidence",
  }));
  // The aggregate response must carry the same evidence level as its
  // operation records. A controlled server read is not merely a local
  // fixture, but it is also not a persisted real-account receipt yet.
  const liveReadObserved = deps.observationMode === "server_read"
    && completeForRequestedIds
    && settled.every((attempt) => attempt.status === "completed")
    && operationEvidence.length === READ_ENDPOINTS.length
    && operationEvidence.every((entry) => entry.verificationLevel === "server_observed");
  // Keep only bounded warehouse identity/mode evidence.  Dropping RFBS or
  // delivery_method_type here would make the seller-facing dry-run reject a
  // genuinely observed RFBS warehouse as "mode unknown" after the mode gate
  // was tightened.
  const publicWarehouses = warehouses.map(({ warehouse_id, status, is_rf, is_rfbs, delivery_method_type }) => ({
    warehouse_id,
    status,
    is_rf,
    ...(is_rfbs === true ? { is_rfbs: true } : {}),
    ...(delivery_method_type ? { delivery_method_type } : {}),
  }));
  return {
    ok: true,
    readOnly: true,
    partial,
    requestScoped: true,
    productStatusReadyForAll,
    completeForRequestedIds,
    liveReadObserved,
    verificationLevel: liveReadObserved ? "server_observed" : (partial ? "partial" : "locally_tested"),
    storeId,
    offerIds,
    warehouseIds,
    products,
    warehouses: publicWarehouses,
    warehouseEligibility,
    currentStocks,
    checkedAt,
    endpointAttempts: settled.map(({ endpoint, status, errorCount, pageCount, paginationComplete, paginationCursorRepeated, nextCursor }) => ({ endpoint, status, errorCount, pageCount, paginationComplete, paginationCursorRepeated, nextCursor })),
    operationEvidence,
    missingEvidence: [...new Set(missingEvidence)],
    sellerView: {
      status: partial ? "partial" : (productStatusReadyForAll ? "evidence_ready" : "product_not_ready"),
      reason: partial
        ? "部分只读证据缺失，不能判定库存已就绪。"
        : (productStatusReadyForAll ? "商品、仓库和当前库存只读证据已汇总。" : "商品状态已读取，但至少一个 Offer 尚未明确可售。"),
      nextAction: partial
        ? "补齐缺失证据后重新预演；不要提交库存。"
        : (productStatusReadyForAll ? "进入库存 dry-run 比对目标库存；仍不会写入 Ozon。" : "等待商品审核通过后重新读取商品状态；不要进入库存写入。"),
      sideEffect: "仅调用 Ozon 只读接口；不写库存、不排队、不修改商品。",
    },
  };
}
