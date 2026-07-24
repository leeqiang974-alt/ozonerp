import test from "node:test";
import assert from "node:assert/strict";
import { ozonGetRequest, ozonRequest } from "../src/ozon.js";

const store = { id: "store-a", clientId: "client-a", apiKey: "secret" };

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  };
}

test("ordinary Ozon POST does not retry a transient write failure", async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return response(503, { message: "temporary" }, { "x-request-id": "req-write" });
  };
  await assert.rejects(
    ozonRequest(store, "/v3/product/import", { items: [] }, { fetch, sleep: async () => {}, now: () => 0, random: () => 0 }),
    (error) => error.status === 503 && error.requestId === "req-write" && error.attempts === 1
  );
  assert.equal(calls, 1);
});

test("retrySafe cannot opt a write POST into automatic replay", async () => {
  let calls = 0;
  await assert.rejects(
    ozonRequest(store, "/v3/product/import", { items: [] }, {
      retrySafe: true,
      fetch: async () => { calls += 1; return response(503); },
      sleep: async () => {},
      throttleMs: 0,
    }),
    (error) => error.code === "OZON_RETRY_SAFE_ENDPOINT_NOT_ALLOWLISTED"
      && error.path === "/v3/product/import"
  );
  assert.equal(calls, 0);
});

test("category tree, attributes, and dictionary reads are retry-safe allowlisted", async () => {
  const endpoints = [
    "/v1/description-category/tree",
    "/v1/description-category/attribute",
    "/v1/description-category/attribute/values",
  ];
  for (const endpoint of endpoints) {
    let calls = 0;
    const result = await ozonRequest(store, endpoint, {}, {
      retrySafe: true,
      maxRetries: 0,
      fetch: async () => {
        calls += 1;
        return response(200, { result: [] });
      },
      sleep: async () => {},
      throttleMs: 0,
    });
    assert.deepEqual(result, { result: [] });
    assert.equal(calls, 1);
  }
});

test("retry-safe POST honors Retry-After and preserves final error context", async () => {
  let calls = 0;
  const sleeps = [];
  const fetch = async () => {
    calls += 1;
    if (calls === 1) return response(429, { message: "slow down" }, { "retry-after": "2", "x-request-id": "req-1" });
    return response(500, { code: "server_error" }, { "x-request-id": "req-2" });
  };
  await assert.rejects(
    ozonRequest(store, "/v1/product/import/info", { task_id: 1 }, {
      retrySafe: true,
      maxRetries: 1,
      fetch,
      sleep: async (ms) => sleeps.push(ms),
      now: () => 0,
      random: () => 0,
      throttleMs: 0,
    }),
    (error) => error.status === 500 && error.details.code === "server_error" && error.requestId === "req-2" && error.attempts === 2
  );
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
});

test("GET retries network errors and succeeds", async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("socket reset");
    return response(200, { ok: true });
  };
  const result = await ozonGetRequest(store, "/v1/actions", {
    fetch,
    sleep: async () => {},
    now: () => 0,
    random: () => 0,
    throttleMs: 0,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test("requests sharing client and endpoint are conservatively throttled", async () => {
  let current = 0;
  const sleeps = [];
  const options = {
    fetch: async () => response(200, { ok: true }),
    sleep: async (ms) => { sleeps.push(ms); current += ms; },
    now: () => current,
    random: () => 0,
    throttleMs: 100,
  };
  await ozonGetRequest(store, "/v1/actions", options);
  await ozonGetRequest(store, "/v1/actions", options);
  assert.deepEqual(sleeps, [100]);

  await ozonGetRequest({ ...store, clientId: "client-b" }, "/v1/actions", options);
  assert.deepEqual(sleeps, [100]);
});

test("Retry-After HTTP date is parsed with injected clock", async () => {
  const sleeps = [];
  const now = Date.parse("2026-07-12T00:00:00.000Z");
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return calls === 1
      ? response(429, {}, { "retry-after": "Sun, 12 Jul 2026 00:00:03 GMT" })
      : response(200, { ok: true });
  };
  await ozonGetRequest(store, "/v1/actions", {
    fetch,
    sleep: async (ms) => sleeps.push(ms),
    now: () => now,
    random: () => 0,
    throttleMs: 0,
  });
  assert.deepEqual(sleeps, [3000]);
});
