import { OZON_API_BASE } from "./config.js";

const OZON_REQUEST_TIMEOUT_MS = Number(process.env.OZON_REQUEST_TIMEOUT_MS || 30_000);

export async function ozonRequest(store, path, body = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, OZON_REQUEST_TIMEOUT_MS));
  let response;
  try {
    response = await fetch(`${OZON_API_BASE}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Client-Id": store.clientId,
        "Api-Key": store.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error?.name === "AbortError" ? `Ozon request timeout: ${path}` : (error?.message || "Ozon request failed");
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText;
    const error = new Error(`Ozon ${response.status}: ${message}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

export async function ozonGetRequest(store, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, OZON_REQUEST_TIMEOUT_MS));
  let response;
  try {
    response = await fetch(`${OZON_API_BASE}${path}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Client-Id": store.clientId,
        "Api-Key": store.apiKey,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const message = error?.name === "AbortError" ? `Ozon request timeout: ${path}` : (error?.message || "Ozon request failed");
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText;
    const error = new Error(`Ozon ${response.status}: ${message}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

export function defaultFbsDateRange() {
  const to = new Date();
  const since = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  return {
    since: since.toISOString(),
    to: to.toISOString(),
  };
}
