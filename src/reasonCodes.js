export const ReasonCode = {
  CATEGORY_INVALID: "CATEGORY_INVALID",
  WEIGHT_SIZE_INVALID: "WEIGHT_SIZE_INVALID",
  BRAND_INVALID: "BRAND_INVALID",
  MODEL_REQUIRED: "MODEL_REQUIRED",
  TITLE_INVALID: "TITLE_INVALID",
  RICH_CONTENT_INVALID: "RICH_CONTENT_INVALID",
  COUNTRY_INVALID: "COUNTRY_INVALID",
  ATTRIBUTE_DUPLICATE: "ATTRIBUTE_DUPLICATE",
  ATTRIBUTE_REQUIRED: "ATTRIBUTE_REQUIRED",
  STORAGE_WRITE_ERROR: "STORAGE_WRITE_ERROR",
  TIMEOUT: "TIMEOUT",
  MATCH_FAILED: "MATCH_FAILED",
  PROFIT_FAILED: "PROFIT_FAILED",
  STOCK_WAREHOUSE_INVALID: "STOCK_WAREHOUSE_INVALID",
  STOCK_WRITE_FAILED: "STOCK_WRITE_FAILED",
  EXTERNAL_API_ERROR: "EXTERNAL_API_ERROR",
  UNKNOWN: "UNKNOWN",
};

export function mapReasonCode(message = "") {
  const text = String(message || "").toLowerCase();
  if (!text) return ReasonCode.UNKNOWN;
  if (text.includes("型号") || text.includes("model")) return ReasonCode.MODEL_REQUIRED;
  if (text.includes("названи") || text.includes("标题") || text.includes("повтор")) return ReasonCode.TITLE_INVALID;
  if (text.includes("rich-контент") || text.includes("rich content") || text.includes("富内容")) return ReasonCode.RICH_CONTENT_INVALID;
  if (text.includes("страна-изготовитель") || text.includes("原产国")) return ReasonCode.COUNTRY_INVALID;
  if (text.includes("attribute_is_duplicate") || text.includes("поле указано повторно") || text.includes("重复")) return ReasonCode.ATTRIBUTE_DUPLICATE;
  if (text.includes("error_attribute_values_empty") || text.includes("обязательное поле") || text.includes("必填")) return ReasonCode.ATTRIBUTE_REQUIRED;
  if (text.includes("品牌") || text.includes("brand")) return ReasonCode.BRAND_INVALID;
  if (text.includes("尺重") || text.includes("重量") || text.includes("尺寸") || text.includes("weight") || text.includes("size") || text.includes("габарит")) {
    return ReasonCode.WEIGHT_SIZE_INVALID;
  }
  if (text.includes("类目") || text.includes("category") || text.includes("type") || text.includes("категор") || text.includes("группа товаров") || text.includes("неверный тип")) return ReasonCode.CATEGORY_INVALID;
  if (text.includes("eperm") || text.includes("enoent") || text.includes("json") || text.includes("rename")) {
    return ReasonCode.STORAGE_WRITE_ERROR;
  }
  if (text.includes("timeout") || text.includes("超时")) return ReasonCode.TIMEOUT;
  if (text.includes("匹配") || text.includes("match")) return ReasonCode.MATCH_FAILED;
  if (text.includes("利润") || text.includes("price")) return ReasonCode.PROFIT_FAILED;
  if (text.includes("warehouse_wrong_status") || text.includes("warehouseid") || text.includes("warehouse id") || text.includes("склад") || text.includes("仓库")) return ReasonCode.STOCK_WAREHOUSE_INVALID;
  if (text.includes("остат") || text.includes("stock") || text.includes("库存")) return ReasonCode.STOCK_WRITE_FAILED;
  if (text.includes("fetch") || text.includes("api") || text.includes("request")) return ReasonCode.EXTERNAL_API_ERROR;
  return ReasonCode.UNKNOWN;
}
