const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

function isLoopbackHost(host = "") {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host || "").trim().toLowerCase());
}

export function isAllowedCorsOrigin({ origin = "", host = "127.0.0.1", allowedOrigins = new Set() } = {}) {
  const normalizedOrigin = String(origin || "").trim();
  if (!normalizedOrigin) return true;
  if (allowedOrigins.has(normalizedOrigin)) return true;
  return isLoopbackHost(host) && CHROME_EXTENSION_ORIGIN.test(normalizedOrigin);
}
