import { scopeHash } from "./readVerificationHarness.js";

export const CATEGORY_READ_ENDPOINTS = Object.freeze({
  tree: "/v1/description-category/tree",
  attributes: "/v1/description-category/attribute",
  values: "/v1/description-category/attribute/values",
});

// The Seller API returns `has_next` for dictionary values.  A response with
// `has_next: true` is a valid page, but it is not complete category evidence.
export function classifyCategoryValuesResponse(response = {}) {
  const values = response?.result;
  const recognized = Array.isArray(values);
  const hasNext = response?.has_next === true;
  return {
    recognized,
    hasNext,
    paginationComplete: recognized && !hasNext,
    status: !recognized ? "unknown" : hasNext ? "partial" : "completed",
  };
}

function text(value = "") {
  return String(value || "").trim();
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export function validateCategoryReadPlan(plan = {}) {
  const errors = [];
  const storeId = text(plan.store?.id || plan.store?.clientId);
  const environment = text(plan.environment);
  const descriptionCategoryId = positiveInt(plan.descriptionCategoryId || plan.description_category_id);
  const typeId = positiveInt(plan.typeId || plan.type_id);
  const language = text(plan.language || "ZH_HANS");
  const rawAttributeIds = Array.isArray(plan.attributeIds)
    ? plan.attributeIds
    : (Array.isArray(plan.attribute_ids) ? plan.attribute_ids : []);
  const attributeIds = [...new Set(rawAttributeIds
    .map(positiveInt).filter(Boolean))].slice(0, 100);
  if (!storeId) errors.push({ code: "CATEGORY_READ_STORE_REQUIRED", message: "类目读取计划必须绑定店铺。" });
  if (!environment) errors.push({ code: "CATEGORY_READ_ENVIRONMENT_REQUIRED", message: "类目读取计划必须绑定显式环境。" });
  if (!descriptionCategoryId) errors.push({ code: "CATEGORY_READ_CATEGORY_REQUIRED", message: "必须提供 description_category_id。" });
  if (!typeId) errors.push({ code: "CATEGORY_READ_TYPE_REQUIRED", message: "必须提供 type_id。" });
  if (!/^[A-Z_]{2,24}$/.test(language)) errors.push({ code: "CATEGORY_READ_LANGUAGE_INVALID", message: "language 格式无效。" });
  if (!attributeIds.length) errors.push({ code: "CATEGORY_READ_ATTRIBUTE_REQUIRED", message: "至少提供一个属性 ID 才能读取字典值。" });
  return {
    ok: errors.length === 0,
    errors,
    storeId,
    environment,
    descriptionCategoryId,
    typeId,
    language,
    attributeIds,
    endpoints: Object.values(CATEGORY_READ_ENDPOINTS),
  };
}

export function buildCategoryReadPlanBinding(plan = {}) {
  const validation = validateCategoryReadPlan(plan);
  if (!validation.ok) return "";
  return scopeHash({
    storeRef: scopeHash(validation.storeId),
    environmentRef: scopeHash(validation.environment),
    descriptionCategoryId: validation.descriptionCategoryId,
    typeId: validation.typeId,
    attributeIds: validation.attributeIds,
    language: validation.language,
    endpoints: validation.endpoints,
    readOnly: true,
  });
}

export function validateCategoryReadPlanBinding(plan = {}, binding = "") {
  const expected = buildCategoryReadPlanBinding(plan);
  return { ok: Boolean(expected && text(binding) === expected), expected };
}

export function buildCategoryReadPlanSummary(plan = {}) {
  const validation = validateCategoryReadPlan(plan);
  return {
    summaryType: "controlled_category_read_plan",
    ok: validation.ok,
    storeRefHash: validation.storeId ? scopeHash(validation.storeId) : "",
    environmentRefHash: validation.environment ? scopeHash(validation.environment) : "",
    descriptionCategoryId: validation.descriptionCategoryId || null,
    typeId: validation.typeId || null,
    attributeIds: validation.attributeIds,
    language: validation.language,
    endpoints: validation.endpoints,
    errors: validation.errors,
    sideEffect: "仅校验类目读取参数；不会联网、读取 Ozon、写入 Ozon 或保存凭据。",
  };
}

export function buildCategoryReadRequests(plan = {}) {
  const validation = validateCategoryReadPlan(plan);
  if (!validation.ok) return { ok: false, errors: validation.errors, requests: [] };
  const common = {
    description_category_id: validation.descriptionCategoryId,
    type_id: validation.typeId,
    language: validation.language,
  };
  return {
    ok: true,
    requests: [
      { key: "tree", endpoint: CATEGORY_READ_ENDPOINTS.tree, body: { language: validation.language } },
      { key: "attributes", endpoint: CATEGORY_READ_ENDPOINTS.attributes, body: common },
      ...validation.attributeIds.map((attributeId) => ({
        key: "values",
        attributeId,
        endpoint: CATEGORY_READ_ENDPOINTS.values,
        body: { ...common, attribute_id: attributeId, limit: 200, last_value_id: 0 },
      })),
    ],
  };
}
