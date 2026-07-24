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

export function classifyCategoryMetadataResponse(response = {}) {
  const recognized = Array.isArray(response?.result);
  return {
    recognized,
    status: recognized ? "success" : "unknown",
  };
}

function text(value = "") {
  return String(value || "").trim();
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function categoryReadPhase(value = "") {
  return text(value).toLowerCase() === "metadata" ? "metadata" : "complete";
}

export function requiredDictionaryAttributeIds(attributes = []) {
  if (!Array.isArray(attributes)) return [];
  return [...new Set(attributes
    .filter((attribute) => attribute?.is_required === true && positiveInt(attribute?.dictionary_id))
    .map((attribute) => positiveInt(attribute?.id))
    .filter(Boolean))].slice(0, 100);
}

export function buildCategoryReadContinuationPlan(plan = {}, attributes = []) {
  const validation = validateCategoryReadPlan({ ...plan, phase: "metadata" });
  const attributeIds = requiredDictionaryAttributeIds(attributes);
  if (!validation.ok || !attributeIds.length) return null;
  return {
    store: { id: validation.storeId },
    environment: validation.environment,
    descriptionCategoryId: validation.descriptionCategoryId,
    typeId: validation.typeId,
    language: validation.language,
    phase: "complete",
    attributeIds,
  };
}

export function validateCategoryReadAttributeScope(plan = {}, attributes = []) {
  const validation = validateCategoryReadPlan(plan);
  if (!validation.ok || validation.phase !== "complete") {
    return { ok: validation.ok, expected: validation.attributeIds, observed: [] };
  }
  const observed = requiredDictionaryAttributeIds(attributes);
  const expected = [...validation.attributeIds].sort((a, b) => a - b);
  const actual = [...observed].sort((a, b) => a - b);
  return {
    ok: expected.length === actual.length && expected.every((id, index) => id === actual[index]),
    expected,
    observed: actual,
  };
}

export function summarizeCategoryReadObservations(observations = []) {
  const failures = (Array.isArray(observations) ? observations : [])
    .filter((item) => !["success", "completed"].includes(text(item?.status).toLowerCase()));
  return {
    complete: failures.length === 0,
    status: failures.length ? "partial" : "completed",
    failures,
  };
}

export function validateCategoryReadPlan(plan = {}) {
  const errors = [];
  const phase = categoryReadPhase(plan.phase);
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
  if (phase === "complete" && !attributeIds.length) errors.push({ code: "CATEGORY_READ_ATTRIBUTE_REQUIRED", message: "完整类目读取至少需要一个字典属性 ID。" });
  return {
    ok: errors.length === 0,
    errors,
    storeId,
    environment,
    descriptionCategoryId,
    typeId,
    language,
    phase,
    attributeIds,
    endpoints: phase === "metadata"
      ? [CATEGORY_READ_ENDPOINTS.tree, CATEGORY_READ_ENDPOINTS.attributes]
      : Object.values(CATEGORY_READ_ENDPOINTS),
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
    phase: validation.phase,
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
    phase: validation.phase,
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
