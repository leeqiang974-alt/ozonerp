import crypto from "crypto";
import { load1688OpenApiConfig } from "./open1688Config.js";

const DEFAULT_GATEWAY = "https://gw.open.1688.com/openapi";

function stringifyParamValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function sign1688OpenApiPath(urlPath, params = {}, appSecret = "") {
  const base = Object.keys(params)
    .sort()
    .map((key) => `${key}${stringifyParamValue(params[key])}`)
    .join("");
  return crypto
    .createHmac("sha1", appSecret)
    .update(urlPath + base, "utf8")
    .digest("hex")
    .toUpperCase();
}

export function build1688OpenApiPath({ namespace = "", apiName = "", version = 1, appKey = "" } = {}) {
  const cleanNamespace = String(namespace || "").replace(/^\/+|\/+$/g, "");
  const cleanApiName = String(apiName || "").replace(/^\/+|\/+$/g, "");
  if (!cleanApiName) throw new Error("缺少 1688 API 名称");
  return cleanNamespace
    ? `param2/${version}/${cleanNamespace}/${cleanApiName}/${appKey}`
    : `param2/${version}/${cleanApiName}/${appKey}`;
}

export async function call1688OpenApi({
  namespace = "",
  apiName,
  version = 1,
  params = {},
  method = "GET",
  includeAccessToken = true,
  gateway = DEFAULT_GATEWAY,
} = {}) {
  const config = load1688OpenApiConfig();
  const urlPath = build1688OpenApiPath({ namespace, apiName, version, appKey: config.appKey });
  const payload = {
    ...(includeAccessToken ? { access_token: config.accessToken } : {}),
    ...params,
  };
  const signed = {
    ...payload,
    _aop_signature: sign1688OpenApiPath(urlPath, payload, config.appSecret),
  };
  const url = new URL(`${gateway}/${urlPath}`);
  const fetchOptions = { method: method.toUpperCase() };
  if (fetchOptions.method === "GET") {
    for (const [key, value] of Object.entries(signed)) {
      url.searchParams.set(key, stringifyParamValue(value));
    }
  } else {
    fetchOptions.headers = { "content-type": "application/x-www-form-urlencoded" };
    fetchOptions.body = new URLSearchParams(
      Object.entries(signed).map(([key, value]) => [key, stringifyParamValue(value)]),
    );
  }
  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    urlPath,
    requestId: json?.request_id || json?.requestId || "",
    errorCode: json?.error_code || json?.errorCode || "",
    errorMessage: json?.error_message || json?.errorMessage || json?.exception || "",
    text,
    json,
  };
}
