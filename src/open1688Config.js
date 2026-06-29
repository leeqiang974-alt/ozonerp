import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.env.OPEN1688_DATA_DIR || "data");
const CONFIG_FILE = path.join(DATA_DIR, "1688-openapi.json");

const DEFAULT_CONFIG = {
  solutionName: "代发解决方案（分销买家版）",
  appName: "ozonerp-分销",
  appKey: "7076779",
  appSecret: "",
  accessToken: "",
  accountName: "piggary",
  accountType: "主账号",
  authorizedAt: "2026-06-12 21:30:15",
  validFrom: "2026-06-12",
  validTo: "2027-06-12",
};

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    return { __readError: error.message };
  }
}

function hasValue(value) {
  return String(value || "").trim().length > 0;
}

function maskSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function load1688OpenApiConfig() {
  const loaded = readJson(CONFIG_FILE);
  return {
    ...DEFAULT_CONFIG,
    ...loaded,
    configPath: CONFIG_FILE,
    configReadError: loaded.__readError || "",
  };
}

export function get1688OpenApiStatus() {
  const config = load1688OpenApiConfig();
  const required = [
    ["appKey", "APPKEY"],
    ["appSecret", "AppSecret"],
    ["accessToken", "授权 token"],
  ];
  const missing = required
    .filter(([key]) => !hasValue(config[key]))
    .map(([, label]) => label);
  return {
    configured: missing.length === 0 && !config.configReadError,
    missing,
    solutionName: config.solutionName,
    appName: config.appName,
    appKey: config.appKey,
    appSecretMasked: maskSecret(config.appSecret),
    accessTokenMasked: maskSecret(config.accessToken),
    accountName: config.accountName,
    accountType: config.accountType,
    authorizedAt: config.authorizedAt,
    validFrom: config.validFrom,
    validTo: config.validTo,
    configPath: config.configPath,
    configReadError: config.configReadError,
    nextStep: missing.length
      ? `缺少 ${missing.join("、")}，暂不能调用 1688 官方 API。`
      : "官方 API 凭据已配置，下一步需要接入具体搜索/商品详情接口并做签名测试。",
  };
}
