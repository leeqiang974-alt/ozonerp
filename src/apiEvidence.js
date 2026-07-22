import fs from "node:fs";
import { createHash } from "node:crypto";
import { loadStores } from "./config.js";

const PRIORITY_ENDPOINTS = [
  { path: "/v3/product/import", object: "商品上架提交", kind: "write", verification: "locally_tested", official: "待核验" },
  { path: "/v1/product/import/info", object: "商品导入回查", kind: "read", verification: "locally_tested", official: "待核验" },
  { path: "/v4/product/info/stocks", object: "商品库存读取", kind: "read", verification: "locally_tested", official: "待核验" },
  { path: "/v2/products/stocks", object: "库存写入", kind: "write", verification: "locally_tested", official: "待核验" },
  { path: "/v4/product/info/prices", object: "商品价格读取", kind: "read", verification: "locally_tested", official: "待核验" },
  // The repository currently has no persisted, server-observed category read
  // receipt bound to a store/environment.  Keep this at local verification
  // until that evidence chain exists; a historical claim must not upgrade it.
  { path: "/v1/description-category/tree", object: "类目树读取", kind: "read", verification: "locally_tested", official: "待核验" },
];
// This is deliberately an explicit, reviewable baseline.  Updating the local
// Seller HTML must be accompanied by a matrix review; otherwise an endpoint
// row could silently outlive the document version it was checked against.
export const API_MATRIX_DOCUMENT_BASELINE = Object.freeze({
  sourceUrl: "https://docs.ozon.ru/api/seller/zh/",
  contentHash: "sha256:aa6fb7ee12b3e492f7d1bd9da6324a16762a6cd8920dc5923ac948774d43b0e8",
  bytes: 5567952,
  operationPaths: Object.freeze(PRIORITY_ENDPOINTS.map((entry) => entry.path)),
});
const VERIFICATION_LEVELS = new Set(["documented", "mocked", "locally_tested", "server_observed", "real_read_verified", "real_write_verified", "partial", "failed"]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fileState(filePath) {
  try {
    const stat = fs.statSync(filePath);
    // Keep only a content fingerprint in the evidence summary.  The source
    // files contain credentials (store API) or a large saved HTML document;
    // returning their contents would make the diagnostics endpoint unsafe.
    const contentHash = `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
    return { present: true, modifiedAt: stat.mtime.toISOString(), bytes: stat.size, contentHash };
  } catch {
    return { present: false, modifiedAt: "", bytes: 0, contentHash: "" };
  }
}

/**
 * Audit the seller-owned API file without returning credentials or store names.
 * The file intentionally contains duplicate profiles for external/personal
 * use; those lines are counted as exclusions, never as additional stores.
 * This is a local evidence check only and does not contact Ozon.
 */
export function inspectCanonicalStoreApi(filePath = "") {
  const state = fileState(filePath);
  const empty = {
    ...state,
    expectedPrimaryStoreCount: 4,
    primaryStoreCount: 0,
    profileExclusions: { externalUse: 0, personalUse: 0 },
    duplicateClientIds: [],
    storeRefHashes: [],
    status: state.present ? "unreadable" : "missing",
    verificationLevel: "locally_tested",
    sideEffect: "仅读取本地配置元数据；不会联网、暴露凭据或调用 Seller API。",
  };
  if (!state.present) return empty;
  let lines = [];
  try { lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/); } catch { return empty; }
  const profileExclusions = {
    externalUse: lines.filter((line) => /外部使用/i.test(line)).length,
    personalUse: lines.filter((line) => /个人使用/i.test(line)).length,
  };
  let stores = [];
  try { stores = loadStores(filePath); } catch { return { ...empty, profileExclusions }; }
  const clientIds = stores.map((store) => String(store.clientId || "").trim()).filter(Boolean);
  const counts = new Map();
  clientIds.forEach((clientId) => counts.set(clientId, (counts.get(clientId) || 0) + 1));
  const duplicateClientIds = [...counts.entries()].filter(([, count]) => count > 1).map(([clientId]) =>
    `sha256:${createHash("sha256").update(clientId, "utf8").digest("hex")}`);
  return {
    ...state,
    expectedPrimaryStoreCount: 4,
    primaryStoreCount: stores.length,
    profileExclusions,
    duplicateClientIds,
    storeRefHashes: [...new Set(clientIds.map((clientId) => `sha256:${createHash("sha256").update(clientId, "utf8").digest("hex")}`))],
    status: stores.length === 4 && duplicateClientIds.length === 0 ? "matched" : "scope_mismatch",
    verificationLevel: "locally_tested",
    sideEffect: "仅读取本地配置元数据；不会联网、暴露凭据或调用 Seller API。",
  };
}

export function inspectSellerApiDocument(filePath = "") {
  const state = fileState(filePath);
  if (!state.present) return { ...state, title: "", sourceUrl: "", operationPaths: [] };
  let html = "";
  try { html = fs.readFileSync(filePath, "utf8"); } catch { return { ...state, title: "", sourceUrl: "", operationPaths: [] }; }
  const title = (html.match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i)?.[1] || "").trim();
  // 浏览器“网页，完整”保存的 HTML 使用 `saved from url=(0035)https://...`，
  // 但测试/工具生成的片段可能使用带引号的 `saved from url="https://..."`。
  // 两种格式都只作为本地文档来源元数据，不能升级官方或真实账号验证等级。
  const sourceUrl = (html.match(/saved from url=\((?:\d+)\)(https?:\/\/[^\s"'<]+)/i)?.[1]
    || html.match(/saved from url=[\"'](https?:\/\/[^\"']+)/i)?.[1]
    || "").trim();
  const operationPaths = [...new Set([
    ...[...html.matchAll(/>\/(v\d+\/[^<\s]+)</g)].map((match) => `/${match[1]}`),
    ...[...html.matchAll(/#operation[^\">]*\">\/(v\d+\/[^<\s"]+)/g)].map((match) => `/${match[1]}`),
  ])]
    .filter((value) => /product\/import|product\/info|products?\/.*stocks|description-category/.test(value));
  return { ...state, title, sourceUrl, operationPaths };
}

export function buildOperationEvidenceRecord({ operationPath = "", checkedAt = "", statusCode = 0, response = null, verificationLevel = "locally_tested", source = "" } = {}) {
  const pathValue = String(operationPath || "").trim();
  const timestamp = new Date(checkedAt || Date.now());
  if (!pathValue.startsWith("/")) throw new Error("operationPath 必须以 / 开头");
  if (!Number.isFinite(timestamp.getTime())) throw new Error("checkedAt 无效");
  if (!Number.isInteger(Number(statusCode)) || Number(statusCode) < 100) throw new Error("statusCode 无效");
  const level = String(verificationLevel || "locally_tested").trim();
  if (!VERIFICATION_LEVELS.has(level)) throw new Error("verificationLevel 无效");
  const responseHash = `sha256:${createHash("sha256").update(canonicalJson(response ?? null)).digest("hex")}`;
  return {
    operationPath: pathValue,
    checkedAt: timestamp.toISOString(),
    statusCode: Number(statusCode),
    responseHash,
    verificationLevel: level,
    source: String(source || "").slice(0, 240),
    responsePersisted: false,
    sideEffect: "仅保存脱敏元数据；未保存完整响应、API Key 或请求正文。",
  };
}

export function evaluateApiMatrixConsistency(documentEvidence = {}, baseline = API_MATRIX_DOCUMENT_BASELINE) {
  const expectedPaths = [...new Set((baseline.operationPaths || []).map((value) => String(value).trim()).filter(Boolean))];
  const actualPaths = [...new Set((documentEvidence.operationPaths || []).map((value) => String(value).trim()).filter(Boolean))];
  const missingEndpoints = expectedPaths.filter((path) => !actualPaths.includes(path));
  const sourceMatches = Boolean(documentEvidence.sourceUrl)
    && documentEvidence.sourceUrl === baseline.sourceUrl;
  const fingerprintMatches = Boolean(documentEvidence.present)
    && documentEvidence.contentHash === baseline.contentHash
    && Number(documentEvidence.bytes) === Number(baseline.bytes);
  const ok = Boolean(documentEvidence.present) && sourceMatches && fingerprintMatches && missingEndpoints.length === 0;
  const reasons = [];
  if (!documentEvidence.present) reasons.push("SELLER_API_DOCUMENT_MISSING");
  else {
    if (!sourceMatches) reasons.push("SELLER_API_DOCUMENT_SOURCE_CHANGED");
    if (!fingerprintMatches) reasons.push("SELLER_API_DOCUMENT_FINGERPRINT_CHANGED");
    if (missingEndpoints.length) reasons.push("SELLER_API_DOCUMENT_ENDPOINT_COVERAGE_CHANGED");
  }
  return {
    status: ok ? "matched" : "stale",
    ok,
    baseline: {
      sourceUrl: baseline.sourceUrl,
      contentHash: baseline.contentHash,
      bytes: Number(baseline.bytes) || 0,
      operationPaths: expectedPaths,
    },
    current: {
      present: Boolean(documentEvidence.present),
      sourceUrl: String(documentEvidence.sourceUrl || ""),
      contentHash: String(documentEvidence.contentHash || ""),
      bytes: Number(documentEvidence.bytes) || 0,
      operationPaths: actualPaths,
    },
    missingEndpoints,
    reasons,
    verificationEligible: ok,
    nextAction: ok
      ? "Seller HTML 与矩阵基线一致；仍需分别满足真实账号和端点版本核验门。"
      : "重新审核 Seller HTML 来源、内容指纹和端点集合，更新矩阵基线后再核验；当前不升级任何验证等级。",
  };
}

export function buildApiEvidenceSummary({ apiSourcePath = "", sellerApiDocPath = "", canonicalStoreCount = null, now = new Date(), matrixBaseline = API_MATRIX_DOCUMENT_BASELINE } = {}) {
  const canonicalStoreAudit = inspectCanonicalStoreApi(apiSourcePath);
  const sellerApiDocument = inspectSellerApiDocument(sellerApiDocPath);
  const matrixConsistency = evaluateApiMatrixConsistency(sellerApiDocument, matrixBaseline);
  const hasCanonicalStoreCount = canonicalStoreCount !== null
    && canonicalStoreCount !== undefined
    && String(canonicalStoreCount).trim() !== ""
    && Number.isInteger(Number(canonicalStoreCount))
    && Number(canonicalStoreCount) >= 0;
  const canonicalStoreCountVerified = canonicalStoreAudit.status === "matched"
    && hasCanonicalStoreCount
    && Number(canonicalStoreCount) === Number(canonicalStoreAudit.primaryStoreCount);
  const endpoints = PRIORITY_ENDPOINTS.map((entry) => ({ ...entry, evidenceSource: entry.verification === "real_read_verified" ? "历史真实只读记录" : "本地测试/模拟依赖" }));
  const counts = endpoints.reduce((result, entry) => {
    result[entry.verification] = (result[entry.verification] || 0) + 1;
    return result;
  }, {});
  return {
    checkedAt: new Date(now).toISOString(),
    storeScope: {
      canonicalStoreCount: hasCanonicalStoreCount
        ? Number(canonicalStoreCount)
        : null,
      canonicalStoreCountVerified,
      expectedPrimaryStoreCount: 4,
      evidence: hasCanonicalStoreCount
        ? (canonicalStoreCountVerified
          ? "当前进程按 canonical 店铺解析结果计数；不含外部使用/个人使用重复配置。"
          : "调用方提供了店铺数量，但 canonical 文件审计未匹配；该数量不能作为四店铺证据。")
        : "本次未读取店铺配置，不能确认 canonical 店铺数量。",
    },
    sourceFiles: {
      canonicalStoreApi: { path: apiSourcePath, ...fileState(apiSourcePath) },
      sellerApiDocument: { path: sellerApiDocPath, ...sellerApiDocument },
    },
    canonicalStoreAudit,
    matrixConsistency,
    endpoints,
    counts,
    nextAction: "优先核验商品上架提交与导入回查接口，保存官方版本、字段和脱敏响应证据后再升级验证等级。",
    writeSafety: "接口覆盖摘要不代表拥有写入权限，也不解除预检、人工确认、幂等和回查门禁。",
  };
}
