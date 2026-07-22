function safeText(value, max = 256) {
  return String(value || "").trim().slice(0, max);
}

function isoDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function errorCount(container) {
  if (!container || typeof container !== "object") return 0;
  const count = (value) => Array.isArray(value) ? value.length : (value ? 1 : 0);
  return count(container.error) + count(container.errors)
    + (container.partial === true || String(container.status || "").toLowerCase() === "partial" ? 1 : 0);
}

function envelopeItems(value, paths = []) {
  for (const path of paths) {
    const result = path.reduce((current, key) => current?.[key], value);
    if (Array.isArray(result)) return { recognized: true, items: result };
  }
  return { recognized: false, items: [] };
}

// `has_next` is pagination evidence, not merely a truthy flag.  A malformed
// Seller response such as `{ has_next: "true" }` must not be interpreted as
// `false`, otherwise the page can be incorrectly promoted to a complete
// dataset.  Keep the absence of the field backwards compatible (some saved
// fixtures predate the flag), but make a present non-boolean value partial.
function paginationSignal(response) {
  const candidates = [response?.result?.has_next, response?.has_next]
    .filter((value) => value !== undefined && value !== null);
  const cursorCandidates = [response?.result?.cursor, response?.cursor, response?.result?.last_id, response?.last_id]
    .filter((value) => value !== undefined && value !== null);
  const nextCursor = cursorCandidates.length ? safeText(cursorCandidates[0], 512) : "";
  if (!candidates.length && !cursorCandidates.length) return { hasNext: false, invalid: false, nextCursor: "" };
  return {
    hasNext: candidates.some((value) => value === true) || Boolean(nextCursor),
    invalid: candidates.some((value) => typeof value !== "boolean")
      || cursorCandidates.some((value) => typeof value !== "string" && typeof value !== "number"),
    nextCursor,
  };
}

function safeImage(value) {
  const image = safeText(value, 2048);
  return /^https?:\/\//i.test(image) ? image : "";
}

function safeRequestScope(scope = {}) {
  const limit = Math.min(100, Math.max(1, Number(scope.limit || 100)));
  const offset = Math.max(0, Number(scope.offset || 0));
  const cursor = safeText(scope.cursor, 512);
  const sortDir = safeText(scope.sortDir || scope.sort_dir, 8).toUpperCase();
  const result = {
    since: isoDate(scope.since),
    to: isoDate(scope.to),
    status: safeText(scope.status, 64),
    warehouseId: Number(scope.warehouseId || 0) || null,
    limit,
    offset,
  };
  if (cursor || scope.pagination === "cursor") {
    result.cursor = cursor;
    result.sortDir = sortDir === "DESC" ? "DESC" : "ASC";
    result.pagination = "cursor";
  }
  return result;
}

function orderCounts(orders = []) {
  return {
    awaiting_packaging: orders.filter((order) => order.status === "awaiting_packaging").length,
    awaiting_deliver: orders.filter((order) => order.status === "awaiting_deliver").length,
    delivering: orders.filter((order) => order.status === "delivering").length,
    dispute: orders.filter((order) => isDisputeStatus(order)).length,
    delivered: orders.filter((order) => order.status === "delivered").length,
    cancelled: orders.filter((order) => order.status === "cancelled").length,
    unknown: orders.filter((order) => order.statusGroup === "unknown").length,
    all: orders.length,
  };
}

function isDisputeStatus(order = {}) {
  const status = String(order.status || "").trim().toLowerCase();
  const substatus = String(order.substatus || "").trim().toLowerCase();
  // Seller responses have used both a top-level status and a substatus for
  // after-sales disputes. Keep the family conservative: any explicit
  // `dispute` marker must not fall through to a fulfillment action.
  return status.includes("dispute") || substatus.includes("dispute");
}

const KNOWN_ORDER_STATUSES = new Set([
  "awaiting_packaging", "awaiting_deliver", "delivering", "delivered", "cancelled",
]);

const ORDER_STATUS_LABELS = Object.freeze({
  awaiting_packaging: "待备货",
  awaiting_deliver: "待发运",
  delivering: "运输中",
  delivered: "已送达",
  cancelled: "已取消",
});

// Keep machine codes for diagnostics/audit, but expose a seller-facing label
// and priority so the normal order page can tell an operator what to do.
const SELLER_TASK_LABELS = Object.freeze({
  FBS_READ_EVIDENCE_PARTIAL: "补齐订单读取证据",
  FBS_READ_PAGINATION_INCOMPLETE: "继续读取下一批订单",
  ORDER_PRODUCT_EVIDENCE_MISSING: "重新读取商品明细和数量",
  ORDER_WAREHOUSE_MAPPING_UNKNOWN: "补齐仓库映射",
  ORDER_SHIPMENT_DEADLINE_PASSED: "人工核对已超时订单",
  ORDER_SHIPMENT_DEADLINE_SOON: "优先处理临近截止订单",
  ORDER_SHIPMENT_DEADLINE_UNKNOWN: "重新读取发运截止时间",
  ORDER_DISPUTE: "人工处理争议订单",
  ORDER_STATUS_UNKNOWN: "人工核对未知状态",
});

const SELLER_TASK_PRIORITIES = Object.freeze({
  ORDER_SHIPMENT_DEADLINE_PASSED: "urgent",
  ORDER_SHIPMENT_DEADLINE_SOON: "urgent",
  ORDER_DISPUTE: "high",
  ORDER_WAREHOUSE_MAPPING_UNKNOWN: "high",
  ORDER_PRODUCT_EVIDENCE_MISSING: "high",
  ORDER_SHIPMENT_DEADLINE_UNKNOWN: "high",
  ORDER_STATUS_UNKNOWN: "high",
  FBS_READ_EVIDENCE_PARTIAL: "high",
  FBS_READ_PAGINATION_INCOMPLETE: "normal",
});

function orderTaskFor(order = {}, { checkedAt = "" } = {}) {
  const products = Array.isArray(order.products) ? order.products : [];
  // An order with no product rows is not an empty product list in the
  // business sense: the posting/detail read did not establish what must be
  // fulfilled. Do not let `some()` over an empty array promote it to a
  // ready-for-review task.
  const evidenceMissing = products.length === 0
    || products.some((product) => product.detailStatus !== "matched" || product.quantityStatus !== "known");
  if (evidenceMissing) {
    return {
      state: "blocked",
      code: "ORDER_PRODUCT_EVIDENCE_MISSING",
      nextAction: "重新读取商品详情和数量后再判断履约；当前不能据此备货。",
    };
  }
  // A dispute is a separate seller decision. Do not let a packaging/delivery
  // deadline or warehouse mapping rule turn a disputed posting into an
  // apparently executable fulfillment task.
  if (isDisputeStatus(order)) {
    return {
      state: "manual_review",
      code: "ORDER_DISPUTE",
      nextAction: "转人工处理争议；当前不自动备货、取消或发运。",
    };
  }
  if ((order.status === "awaiting_packaging" || order.status === "awaiting_deliver")
    && order.warehouseMapping?.status !== "mapped") {
    return {
      state: "blocked",
      code: "ORDER_WAREHOUSE_MAPPING_UNKNOWN",
      nextAction: "补齐订单对应的 Ozon 仓库映射（ID 和名称）后再判断履约；当前不能备货或发运。",
    };
  }
  if ((order.status === "awaiting_packaging" || order.status === "awaiting_deliver")
    && order.deadlineStatus === "overdue") {
    return {
      state: "manual_review",
      code: "ORDER_SHIPMENT_DEADLINE_PASSED",
      nextAction: "订单已超过发运截止时间，先人工核对 Ozon 状态和仓库；当前不自动发运。",
    };
  }
  if ((order.status === "awaiting_packaging" || order.status === "awaiting_deliver")
    && order.deadlineStatus === "due_soon") {
    return {
      state: "manual_review",
      code: "ORDER_SHIPMENT_DEADLINE_SOON",
      nextAction: "订单将在 12 小时内达到发运截止时间，优先人工核对商品、仓库和运单；当前不自动发运。",
    };
  }
  if ((order.status === "awaiting_packaging" || order.status === "awaiting_deliver")
    && order.deadlineStatus === "unknown") {
    return {
      state: "blocked",
      code: "ORDER_SHIPMENT_DEADLINE_UNKNOWN",
      nextAction: "订单发运截止时间未知，先重新读取订单并人工确认；当前不能安全安排履约。",
    };
  }
  if (order.status === "awaiting_packaging") {
    return {
      state: "ready_for_review",
      code: "AWAITING_PACKAGING",
      nextAction: "核对商品、数量和仓库；打包动作仍需受控接口与回读。",
    };
  }
  if (order.status === "awaiting_deliver") {
    return {
      state: "ready_for_review",
      code: "AWAITING_DELIVER",
      nextAction: "核对仓库和运单信息；发运动作仍需受控接口与回读。",
    };
  }
  if (order.statusGroup === "unknown") {
    return {
      state: "manual_review",
      code: "ORDER_STATUS_UNKNOWN",
      nextAction: "订单状态未被当前版本识别；先人工核对 Ozon 状态并重新读取，当前不能执行履约动作。",
    };
  }
  return {
    state: "no_action",
    code: "ORDER_STATUS_OBSERVED",
    nextAction: "当前状态无需履约动作；按同步时间重新读取。",
  };
}

function buildSellerTasks(orders = [], { partial = false, hasNext = false } = {}) {
  const grouped = new Map();
  const add = (task, count = 1) => {
    if (!task?.code) return;
    const existing = grouped.get(task.code);
    if (existing) existing.count += count;
    else grouped.set(task.code, {
      state: task.state || "manual_review",
      code: task.code,
      label: SELLER_TASK_LABELS[task.code] || "人工核对履约订单",
      priority: SELLER_TASK_PRIORITIES[task.code] || "normal",
      count,
      nextAction: safeText(task.nextAction, 500),
    });
  };
  if (partial) add({
    state: "blocked",
    code: "FBS_READ_EVIDENCE_PARTIAL",
    nextAction: "重新读取当前店铺和范围，补齐订单或商品详情证据；证据完整前不要执行履约动作。",
  });
  if (hasNext) add({
    state: "blocked",
    code: "FBS_READ_PAGINATION_INCOMPLETE",
    nextAction: "继续读取下一批订单后再判断全量履约范围；当前页不能代表全部订单。",
  });
  for (const order of orders) {
    if (["blocked", "manual_review"].includes(order?.task?.state)) add(order.task);
  }
  return [...grouped.values()];
}

function buildSellerView(orders = [], { partial = false, hasNext = false } = {}) {
  const counts = orderCounts(orders);
  const operationalReviewOrders = orders.filter((order) => ["blocked", "manual_review"].includes(order.task?.state));
  const deadlineSoonOrders = orders.filter((order) => order.deadlineStatus === "due_soon");
  const nextAction = partial
    ? "先重新读取当前店铺和范围，补齐订单或商品详情证据；证据完整前不要执行履约动作。"
    : counts.unknown > 0
      ? `有 ${counts.unknown} 单订单状态未知（当前版本未识别）；先人工核对并重新读取，当前不执行履约动作。`
      : counts.dispute > 0
        ? `有 ${counts.dispute} 单争议订单需要人工处理；当前页面不自动备货、取消或发运。`
      : deadlineSoonOrders.length > 0
        ? `有 ${deadlineSoonOrders.length} 单将在 12 小时内达到发运截止时间；优先人工核对，当前不自动发运。`
      : operationalReviewOrders.length > 0
        ? `有 ${operationalReviewOrders.length} 单履约条件需要人工处理（仓库映射、截止时间）；先完成订单级核对，当前不执行履约动作。`
        : counts.awaiting_packaging > 0
          ? `先核对 ${counts.awaiting_packaging} 单待备货订单的商品详情和数量；当前页面仍只读。`
          : counts.awaiting_deliver > 0
            ? `先核对 ${counts.awaiting_deliver} 单待发运订单的仓库和运单信息；发运动作仍需受控接口与回读。`
            : hasNext
              ? "当前页未发现待处理履约订单，但仍有后续分页；继续读取后才能判断全量范围。当前页面仍只读。"
            : "当前读取范围没有待处理履约订单；按同步时间重新读取即可。";
  const sellerStatus = partial
    ? "partial"
    : counts.unknown > 0
      ? "unknown"
      : operationalReviewOrders.length > 0
        ? "manual_review"
        : hasNext
          ? "partial"
          : "evidence_ready";
  const sellerReason = partial
    ? "订单已保留，但部分商品详情或读取证据缺失。"
    : counts.unknown > 0
      ? "订单已读取，但存在当前版本未识别的状态，不能安全推导履约动作。"
      : counts.dispute > 0
        ? "订单已读取，但存在争议订单，需要人工处理后才能决定履约动作。"
      : operationalReviewOrders.length > 0
        ? "订单已读取，但仓库映射或发运截止时间不足以安全安排履约。"
        : hasNext
          ? "当前页证据已汇总，但读取范围还有后续分页，不能据此判断全量订单。"
          : "FBS 订单和商品详情只读证据已汇总。";
  return {
    status: sellerStatus,
    reason: sellerReason,
    nextAction,
    sellerTasks: buildSellerTasks(orders, { partial, hasNext }),
    sideEffect: "仅读取 FBS 订单和商品详情；不发运、不取消、不生成标签。",
  };
}

function buildUniqueIndex(items, fields) {
  const values = new Map();
  const ambiguous = new Set();
  for (const item of items) {
    for (const field of fields) {
      const key = safeText(item?.[field], 128);
      if (!key) continue;
      if (values.has(key) && values.get(key) !== item) ambiguous.add(key);
      else values.set(key, item);
    }
  }
  for (const key of ambiguous) values.delete(key);
  return { values, ambiguous };
}

function postingIdentity(posting = {}) {
  return safeText(posting?.posting_number || posting?.order_number, 128);
}

function postingSignature(posting = {}) {
  return JSON.stringify({
    status: safeText(posting?.status, 64),
    substatus: safeText(posting?.substatus, 128),
    shipment_date: isoDate(posting?.shipment_date),
    products: (Array.isArray(posting?.products) ? posting.products : []).map((product) => ({
      offer_id: safeText(product?.offer_id || product?.offerId, 128),
      sku: safeText(product?.sku, 128),
      quantity: product?.quantity ?? null,
    })),
  });
}

export async function readFbsProductDetailsInBatches(offerIds = [], readBatch) {
  const canonical = [...new Set((Array.isArray(offerIds) ? offerIds : [])
    .map((offerId) => safeText(offerId, 128)).filter(Boolean))];
  const items = [];
  const batchAttempts = [];
  for (let offset = 0; offset < canonical.length; offset += 100) {
    const batch = canonical.slice(offset, offset + 100);
    const batchNumber = Math.floor(offset / 100) + 1;
    try {
      const response = await readBatch(batch);
      const envelope = envelopeItems(response, [["items"], ["result", "items"]]);
      const embedded = errorCount(response) + errorCount(response?.result)
        + envelope.items.reduce((sum, item) => sum + errorCount(item), 0);
      if (envelope.recognized) items.push(...envelope.items);
      batchAttempts.push({
        batch: batchNumber,
        size: batch.length,
        status: envelope.recognized ? (embedded > 0 ? "partial" : "completed") : "partial",
        errorCount: embedded + (envelope.recognized ? 0 : 1),
      });
    } catch {
      batchAttempts.push({ batch: batchNumber, size: batch.length, status: "failed", errorCount: 1 });
    }
  }
  return {
    items,
    batchAttempts,
    partial: batchAttempts.some((attempt) => attempt.status !== "completed"),
  };
}

export function buildFbsOrderReadModel(input = {}) {
  const postingEnvelope = envelopeItems(input.postingResponse, [["result", "postings"], ["postings"]]);
  const detailEnvelope = envelopeItems(input.productDetailResponse, [["items"], ["result", "items"]]);
  const postingErrors = errorCount(input.postingResponse) + errorCount(input.postingResponse?.result)
    + postingEnvelope.items.reduce((sum, item) => sum + errorCount(item), 0);
  const detailErrors = errorCount(input.productDetailResponse) + errorCount(input.productDetailResponse?.result)
    + detailEnvelope.items.reduce((sum, item) => sum + errorCount(item), 0);
  const detailFailed = input.productDetailFailed === true;
  const detailBatchAttempts = Array.isArray(input.productDetailBatchAttempts) ? input.productDetailBatchAttempts : [];
  const offerDetailIndex = buildUniqueIndex(detailEnvelope.items, ["offer_id", "offerId"]);
  // A posting's `sku` is not interchangeable with a Seller product `id` or
  // `product_id`.  Falling back across those namespaces can attach another
  // product's name/image when numeric identifiers happen to collide.  Keep
  // an unmatched row unknown instead of presenting cross-product detail as
  // trusted fulfillment evidence.
  const skuDetailIndex = buildUniqueIndex(detailEnvelope.items, ["sku"]);
  const missingEvidence = [];
  if (!postingEnvelope.recognized) missingEvidence.push("postings_response_unrecognized");
  // A detail response is only useful when it belongs to the posting the
  // seller selected.  Proxies/caches can return a valid posting object for a
  // different request; keep the row visible for diagnosis, but never attach
  // it to the selected identity as trusted evidence.
  const expectedPostingIdentity = safeText(input.expectedPostingIdentity, 128);
  if (expectedPostingIdentity) {
    const returnedIdentities = postingEnvelope.items.map((posting) => postingIdentity(posting)).filter(Boolean);
    if (returnedIdentities.length !== 1 || returnedIdentities[0] !== expectedPostingIdentity) {
      missingEvidence.push("posting_identity_mismatch");
    }
  }
  if (detailFailed) missingEvidence.push("product_details_failed");
  else if (!detailEnvelope.recognized) missingEvidence.push("product_details_response_unrecognized");
  if (postingErrors > 0) missingEvidence.push("postings_embedded_errors");
  if (detailErrors > 0) missingEvidence.push("product_details_embedded_errors");
  for (const attempt of detailBatchAttempts) {
    if (attempt?.status !== "completed") missingEvidence.push(`product_detail_batch:${Number(attempt?.batch || 0) || "unknown"}`);
  }

  const checkedAt = isoDate(input.checkedAt || new Date()) || new Date().toISOString();
  // Seller pagination can repeat the final row of the previous page. Collapse
  // exact duplicates before deriving counts/tasks, but keep conflicting rows
  // conservative: retain the first row and mark the identity ambiguous.
  const seenPostings = new Map();
  const uniquePostings = [];
  let duplicatePostingCount = 0;
  for (const posting of postingEnvelope.items) {
    const identity = postingIdentity(posting);
    if (!identity || !seenPostings.has(identity)) {
      if (identity) seenPostings.set(identity, postingSignature(posting));
      uniquePostings.push(posting);
      continue;
    }
    duplicatePostingCount += 1;
    if (seenPostings.get(identity) !== postingSignature(posting)) {
      missingEvidence.push(`posting_ambiguous:${identity}`);
    }
  }
  const orders = uniquePostings.map((posting) => {
    const products = (Array.isArray(posting?.products) ? posting.products : []).map((product) => {
      const offerId = safeText(product?.offer_id || product?.offerId, 128);
      const sku = safeText(product?.sku, 128);
      const detail = offerDetailIndex.values.get(offerId) || skuDetailIndex.values.get(sku) || null;
      if ((offerId && offerDetailIndex.ambiguous.has(offerId)) || (sku && skuDetailIndex.ambiguous.has(sku))) {
        missingEvidence.push(`product_detail_ambiguous:${offerId || sku}`);
      }
      if (!detail) missingEvidence.push(`product_detail:${offerId || sku || "unknown"}`);
      const rawQuantity = Number(product?.quantity);
      const quantityKnown = product?.quantity !== undefined
        && product?.quantity !== null
        && product?.quantity !== ""
        && Number.isInteger(rawQuantity)
        && rawQuantity >= 0;
      if (!quantityKnown) missingEvidence.push(`product_quantity:${offerId || sku || "unknown"}`);
      return {
        offer_id: offerId,
        sku,
        name: safeText(detail?.name || product?.name, 500),
        quantity: quantityKnown ? rawQuantity : null,
        quantityStatus: quantityKnown ? "known" : "unknown",
        image: safeImage(detail?.primary_image || detail?.primaryImage || detail?.images?.[0]?.file_name),
        detailStatus: detail ? "matched" : "unknown",
      };
    });
    if (products.length === 0) {
      missingEvidence.push(`product_details:${safeText(posting?.posting_number || posting?.order_number, 128) || "order"}`);
    }
    const status = safeText(posting?.status, 64) || "unknown";
    const substatus = safeText(posting?.substatus, 128).toLowerCase();
    const warehouseId = Number(posting?.analytics_data?.warehouse_id || posting?.delivery_method?.warehouse_id || posting?.warehouse_id || 0) || null;
    const warehouseName = safeText(posting?.analytics_data?.warehouse_name || posting?.delivery_method?.warehouse || posting?.warehouse_name, 256);
    const shipmentAt = isoDate(posting?.shipment_date);
    const deliveringAt = isoDate(posting?.delivering_date);
    const deliveryService = safeText(posting?.delivery_method?.tpl_provider || posting?.delivery_method?.name, 256);
    const deliveryType = safeText(posting?.analytics_data?.delivery_type, 128);
    const deliveryMethod = safeText(posting?.delivery_method?.name, 256);
    const isActionableStatus = status === "awaiting_packaging" || status === "awaiting_deliver";
    const deadlineStatus = isActionableStatus
      ? (shipmentAt
        ? (() => {
          const remainingMs = new Date(shipmentAt).getTime() - new Date(checkedAt).getTime();
          return remainingMs <= 0 ? "overdue" : remainingMs <= 12 * 60 * 60 * 1000 ? "due_soon" : "upcoming";
        })()
        : "unknown")
      : "not_applicable";
    const warehouseMapping = warehouseId && warehouseName
      ? { status: "mapped", id: warehouseId, name: warehouseName }
      : { status: "unknown", id: warehouseId, name: warehouseName };
    const order = {
      posting_number: safeText(posting?.posting_number, 128),
      order_number: safeText(posting?.order_number, 128),
      status,
      statusGroup: isDisputeStatus({ status, substatus }) ? "dispute" : (KNOWN_ORDER_STATUSES.has(status) ? status : "unknown"),
      substatus,
      status_label: substatus.includes("dispute") ? "争议" : (ORDER_STATUS_LABELS[status] || "状态未知"),
      tracking_number: safeText(posting?.tracking_number, 256),
      warehouse_id: warehouseId,
      warehouse: warehouseName,
      accepted_at: isoDate(posting?.accepted_at || posting?.in_process_at),
      shipment_date: shipmentAt,
      delivery_service: deliveryService,
      delivery_type: deliveryType,
      delivery_method: deliveryMethod,
      financialStatus: "not_requested",
      warehouseEvidence: { id: warehouseId, name: warehouseName },
      warehouseMapping,
      deadlines: {
        shipmentAt,
        deliveringAt,
      },
      deadlineStatus,
      products,
    };
    order.task = orderTaskFor(order, { checkedAt });
    return order;
  });
  const pagination = paginationSignal(input.postingResponse);
  if (pagination.invalid) missingEvidence.push("pagination_signal_invalid");
  const requestedCursor = safeText(input.requestScope?.cursor, 512);
  if (requestedCursor && pagination.nextCursor && requestedCursor === pagination.nextCursor) {
    missingEvidence.push("pagination_cursor_repeated");
  }
  const uniqueMissing = [...new Set(missingEvidence)];
  const partial = uniqueMissing.length > 0;
  const hasNext = pagination.hasNext;
  const counts = orderCounts(orders);
  const sellerView = buildSellerView(orders, { partial, hasNext });
  // Keep page and dataset coverage as explicit business evidence. A successful
  // HTTP response is not the same thing as a complete order read: product
  // detail failures and an unconsumed cursor must remain visible to receipts.
  const pageComplete = !partial;
  const datasetComplete = pageComplete && !hasNext;
  const requestScope = safeRequestScope(input.requestScope);
  const requestScoped = Boolean(input.requestScope && typeof input.requestScope === "object"
    && (requestScope.since || requestScope.to || requestScope.status || requestScope.warehouseId || requestScope.cursor || requestScope.pagination));
  return {
    readOnly: true,
    verificationLevel: ["documented", "mocked", "locally_tested", "server_observed", "real_read_verified", "real_write_verified"].includes(input.verificationLevel)
      ? input.verificationLevel
      : "locally_tested",
    storeId: safeText(input.storeId, 128),
    expectedPostingIdentity,
    partial,
    requestScoped,
    requestScope,
    checkedAt,
    hasNext,
    nextCursor: pagination.nextCursor,
    pageComplete,
    datasetComplete,
    readCoverage: {
      status: datasetComplete ? "complete" : partial || hasNext ? "partial" : "unknown",
      pageComplete,
      datasetComplete,
      currentPageCount: orders.length,
      hasNext,
      nextCursor: pagination.nextCursor,
      duplicatePostingCount,
    },
    duplicatePostingCount,
    orders,
    counts,
    endpointAttempts: [
      { source: "fbs_postings", status: postingErrors ? "partial" : (postingEnvelope.recognized ? "completed" : "failed"), errorCount: postingErrors },
      {
        source: "product_details",
        status: detailFailed ? "failed" : ((detailErrors || detailBatchAttempts.some((attempt) => attempt.status !== "completed")) ? "partial" : (detailEnvelope.recognized ? "completed" : "failed")),
        errorCount: detailFailed ? 1 : detailErrors + detailBatchAttempts.reduce((sum, attempt) => sum + Number(attempt?.errorCount || 0), 0),
        batchAttempts: detailBatchAttempts.map((attempt) => ({
          batch: Number(attempt?.batch || 0), size: Number(attempt?.size || 0),
          status: ["completed", "partial", "failed"].includes(attempt?.status) ? attempt.status : "partial",
          errorCount: Number(attempt?.errorCount || 0),
        })),
      },
    ],
    missingEvidence: uniqueMissing,
    sellerView,
  };
}

export function filterFbsOrderReadModel(model = {}, query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return model;
  const orders = (Array.isArray(model.orders) ? model.orders : []).filter((order) => ([
    order.posting_number,
    order.order_number,
    order.tracking_number,
    order.warehouse,
    ...order.products.flatMap((product) => [product.name, product.offer_id, product.sku]),
  ].join(" ").toLowerCase().includes(normalized)));
  const sellerView = {
    ...buildSellerView(orders, { partial: model.partial === true, hasNext: model.hasNext === true }),
    filtered: true,
  };
  // An empty search result is a view-level fact, not proof that the store has
  // no pending work. Keep the original evidence status but make the next
  // action explicit so sellers do not mistake a filter miss for a clean queue.
  if (orders.length === 0) {
    sellerView.filteredNoResults = true;
    sellerView.reason = model.partial === true
      ? "当前筛选没有匹配订单；原始读取仍有缺失证据，不能据此判断店铺履约范围。"
      : "当前筛选没有匹配订单；不能据此判断店铺没有待处理履约订单。";
    sellerView.nextAction = "清除或调整搜索条件后再查看完整读取范围；当前不执行履约动作。";
  }
  return {
    ...model,
    orders,
    counts: orderCounts(orders),
    sellerView,
    queryApplied: true,
  };
}
