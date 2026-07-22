const MAX_IDS = 100;
const MAX_PRODUCT_LIST_IDS = 1000;
const READ_ENDPOINT_PRIORITY = new Map([
  ["/v1/description-category/tree", 10],
  ["/v1/description-category/attribute", 20],
  ["/v1/description-category/attribute/values", 30],
  ["/v3/product/list", 40],
  ["/v3/product/info/list", 50],
  ["/v1/product/import/info", 55],
  ["/v4/product/info/stocks", 60],
  ["/v2/warehouse/list", 70],
  ["/v4/posting/fbs/list", 80],
  ["/v4/posting/fbs/unfulfilled/list", 90],
  ["/v3/posting/fbs/list", 80],
  ["/v3/posting/fbs/unfulfilled/list", 90],
]);

function text(value = "") { return String(value ?? "").trim(); }

function boundedIds(value, max = MAX_IDS) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, max);
}

function boundedLimit(value, fallback = 100, maximum = 100) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(1, Math.min(maximum, number)) : fallback;
}

/**
 * Keep prerequisite reads ahead of dependent reads. Plan validation sorts
 * endpoint names for deterministic hashes, so execution must restore the
 * business dependency order without changing the persisted plan.
 */
export function orderReadEndpoints(endpoints = []) {
  return [...new Set(Array.isArray(endpoints) ? endpoints : [])].sort((left, right) => {
    const leftPriority = READ_ENDPOINT_PRIORITY.get(text(left)) ?? 1000;
    const rightPriority = READ_ENDPOINT_PRIORITY.get(text(right)) ?? 1000;
    return leftPriority - rightPriority || text(left).localeCompare(text(right));
  });
}

/**
 * Build the documented request body for one allowlisted read endpoint.
 * Unknown dependencies fail closed instead of sending a syntactically valid
 * but semantically wrong `{limit, offset}` body to Seller API.
 */
export function buildReadEndpointRequest(endpoint = "", scope = {}) {
  const path = text(endpoint).split("?", 1)[0];
  const input = scope && typeof scope === "object" && !Array.isArray(scope) ? scope : {};
  const limit = boundedLimit(input.limit || input.offerCount);
  const offset = Math.max(0, Number.isSafeInteger(Number(input.offset)) ? Number(input.offset) : 0);
  const offerIds = boundedIds(input.offerIds || input.offer_ids);
  const productIds = boundedIds(input.productIds || input.product_ids);
  if (path === "/v3/product/list") {
    const listOfferIds = boundedIds(input.offerIds || input.offer_ids, MAX_PRODUCT_LIST_IDS);
    const listProductIds = boundedIds(input.productIds || input.product_ids, MAX_PRODUCT_LIST_IDS);
    if (listOfferIds.length && listProductIds.length) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_SINGLE_IDENTIFIER_SET", message: "商品列表筛选一次只能使用 offer_id 或 product_id 其中一组。" };
    if (listOfferIds.length || listProductIds.length) return {
      ok: true,
      endpoint: path,
      body: { filter: listOfferIds.length ? { offer_id: listOfferIds } : { product_id: listProductIds } },
      pagination: "identifier_batch",
    };
    return {
      ok: true,
      endpoint: path,
      body: { filter: { visibility: text(input.visibility) || "ALL" }, limit: boundedLimit(input.limit || input.offerCount, 100, MAX_PRODUCT_LIST_IDS), last_id: text(input.lastId || input.last_id) },
      pagination: "last_id",
    };
  }
  if (path === "/v3/product/info/list") {
    if (!offerIds.length && !productIds.length) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_IDENTIFIERS", message: "商品详情读取必须先由商品列表响应提供 offer_id/product_id。" };
    return { ok: true, endpoint: path, body: offerIds.length ? { offer_id: offerIds } : { product_id: productIds }, pagination: "identifier_batch" };
  }
  if (path === "/v1/product/import/info") {
    const taskId = Number(input.taskId || input.task_id);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_TASK_ID", message: "商品导入回查必须绑定 /v3/product/import 返回的 task_id。" };
    return { ok: true, endpoint: path, body: { task_id: taskId }, pagination: "none" };
  }
  if (path === "/v4/product/info/stocks") {
    if (!offerIds.length && !productIds.length) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_IDENTIFIERS", message: "库存读取必须先由商品列表响应提供 offer_id/product_id。" };
    return {
      ok: true,
      endpoint: path,
      body: { filter: { ...(offerIds.length ? { offer_id: offerIds } : { product_id: productIds }), visibility: text(input.visibility) || "ALL" }, limit: boundedLimit(input.limit || input.offerCount, 100, MAX_PRODUCT_LIST_IDS), cursor: text(input.cursor) },
      pagination: "cursor",
    };
  }
  if (path === "/v2/warehouse/list") return {
    ok: true,
    endpoint: path,
    // Seller API HTML documents the warehouse list as cursor based with a
    // bounded limit and optional warehouse_ids filter. Keep the contract
    // explicit so a later page cannot silently replay the first page.
    body: {
      cursor: text(input.cursor),
      limit: boundedLimit(input.limit, 200, 200),
      ...(boundedIds(input.warehouseIds || input.warehouse_ids, 200).length
        ? { warehouse_ids: boundedIds(input.warehouseIds || input.warehouse_ids, 200).map((value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value > 0) }
        : {}),
    },
    pagination: "cursor",
  };
  if (path === "/v3/posting/fbs/list" || path === "/v3/posting/fbs/unfulfilled/list") {
    const since = text(input.since);
    const to = text(input.to);
    if (!since || !to) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_DATE_RANGE", message: "FBS 读取必须绑定 since/to 时间范围后才能执行。" };
    return { ok: true, endpoint: path, ...(path.startsWith("/v3/") ? { deprecated: true } : {}), body: { dir: text(input.dir) || "ASC", filter: { since, to, ...(text(input.status) ? { status: text(input.status) } : {}) }, limit, offset }, pagination: "offset" };
  }
  if (path === "/v4/posting/fbs/list") {
    const since = text(input.since);
    const to = text(input.to);
    if (!since || !to) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_DATE_RANGE", message: "v4 FBS 读取必须绑定 filter.since/filter.to 时间范围后才能执行。" };
    return { ok: true, endpoint: path, body: { cursor: text(input.cursor), sort_dir: text(input.sortDir || input.sort_dir) || "ASC", filter: { since, to }, limit }, pagination: "cursor" };
  }
  if (path === "/v4/posting/fbs/unfulfilled/list") {
    const cutoffFrom = text(input.cutoffFrom || input.cutoff_from);
    const cutoffTo = text(input.cutoffTo || input.cutoff_to);
    const deliveringDateFrom = text(input.deliveringDateFrom || input.delivering_date_from);
    const deliveringDateTo = text(input.deliveringDateTo || input.delivering_date_to);
    const filter = cutoffFrom && cutoffTo ? { cutoff_from: cutoffFrom, cutoff_to: cutoffTo } : deliveringDateFrom && deliveringDateTo ? { delivering_date_from: deliveringDateFrom, delivering_date_to: deliveringDateTo } : null;
    if (!filter) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_CUTOFF_OR_DELIVERING_DATE", message: "v4 未履约 FBS 读取必须绑定 cutoff_from/to 或 delivering_date_from/to。" };
    return { ok: true, endpoint: path, body: { cursor: text(input.cursor), sort_dir: text(input.sortDir || input.sort_dir) || "ASC", filter, limit }, pagination: "cursor" };
  }
  if (path === "/v1/description-category/tree") return { ok: true, endpoint: path, body: { language: text(input.language) || "DEFAULT" }, pagination: "none" };
  if (path === "/v1/description-category/attribute") {
    const descriptionCategoryId = Number(input.descriptionCategoryId || input.description_category_id);
    const typeId = Number(input.typeId || input.type_id);
    if (!Number.isSafeInteger(descriptionCategoryId) || descriptionCategoryId <= 0 || !Number.isSafeInteger(typeId) || typeId <= 0) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_CATEGORY", message: "类目属性读取必须绑定 description_category_id/type_id。" };
    return { ok: true, endpoint: path, body: { description_category_id: descriptionCategoryId, type_id: typeId, language: text(input.language) || "DEFAULT" }, pagination: "none" };
  }
  if (path === "/v1/description-category/attribute/values") {
    const descriptionCategoryId = Number(input.descriptionCategoryId || input.description_category_id);
    const typeId = Number(input.typeId || input.type_id);
    const attributeId = Number(input.attributeId || input.attribute_id);
    if (![descriptionCategoryId, typeId, attributeId].every((value) => Number.isSafeInteger(value) && value > 0)) return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_SCOPE_REQUIRES_CATEGORY", message: "字典值读取必须绑定类目、type 和 attribute。" };
    return { ok: true, endpoint: path, body: { description_category_id: descriptionCategoryId, type_id: typeId, attribute_id: attributeId, language: text(input.language) || "DEFAULT", limit: 200, last_value_id: 0 }, pagination: "last_value_id" };
  }
  return { ok: false, endpoint: path, reasonCode: "READ_ENDPOINT_NOT_SUPPORTED", message: "该只读端点尚未完成请求体契约。" };
}

export function extractBoundedProductIdentifiers(response = {}) {
  const container = response?.result && typeof response.result === "object" ? response.result : response;
  const rows = Array.isArray(container?.items) ? container.items : [];
  const offerIds = boundedIds(rows.map((row) => row?.offer_id || row?.offerId));
  const productIds = boundedIds(rows.map((row) => row?.product_id || row?.productId));
  return { offerIds, productIds };
}
