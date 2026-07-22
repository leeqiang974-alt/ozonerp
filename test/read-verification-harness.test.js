import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_CONFIRMATION, runReadVerification } from "../src/readVerificationHarness.js";

const store = { id: "store-1", clientId: "123", apiKey: "secret-api-key" };

test("offline read verification is explicitly scoped and never calls network", async () => {
  let networkCalls = 0;
  const result = await runReadVerification({
    store,
    environment: "local-fixture",
    scope: { name: "single_offer", offerCount: 1 },
    reader: async () => ({ observations: [{ endpoint: "/v3/product/list", response: { apiKey: "must-not-leak" }, status: "completed" }] }),
    request: async () => { networkCalls += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.verificationLevel, "locally_tested");
  assert.equal(result.writeAttempted, false);
  assert.equal(networkCalls, 0);
  assert.equal(result.storeRef.startsWith("sha256:"), true);
  assert.equal(result.environmentRef.startsWith("sha256:"), true);
  assert.equal(result.scopeRef.startsWith("sha256:"), true);
  assert.equal(JSON.stringify(result).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("live read requires explicit confirmation and an injected request dependency", async () => {
  const reader = async () => ({ observations: [] });
  const denied = await runReadVerification({ store, environment: "staging", scope: { name: "single_offer" }, mode: "live_read", reader });
  assert.equal(denied.reasonCode, "READ_VERIFY_CONFIRMATION_REQUIRED");
  const missingDependency = await runReadVerification({ store, environment: "staging", scope: { name: "single_offer" }, mode: "live_read", confirm: LIVE_CONFIRMATION, reader });
  assert.equal(missingDependency.reasonCode, "READ_VERIFY_REQUEST_DEPENDENCY_REQUIRED");
});

test("live reader only uses injected allowlisted read requests; writes are blocked", async () => {
  const calls = [];
  const result = await runReadVerification({
    store,
    environment: "staging",
    scope: { name: "single_offer", offerCount: 1 },
    mode: "live_read",
    confirm: LIVE_CONFIRMATION,
    request: async (endpoint, options) => { calls.push({ endpoint, options }); return { items: [] }; },
    reader: async ({ readRequest }) => {
      await assert.rejects(() => readRequest("/v3/product/list", { method: "PUT", body: { items: [] } }), /READ_VERIFY_WRITE_METHOD_BLOCKED/);
      await assert.rejects(() => readRequest("/v2/products/stocks", { method: "POST", body: { items: [] } }), /READ_VERIFY_ENDPOINT_NOT_ALLOWLISTED/);
      const response = await readRequest("/v3/product/list", { method: "POST", body: { filter: { offer_id: ["SKU-1"] } } });
      return { observations: [{ endpoint: "/v3/product/list", status: "completed", responseSummary: { count: response.items.length } }] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.writeAttempted, false);
  assert.equal(result.verificationLevel, "server_observed");
  assert.deepEqual(calls.map((call) => call.options.method), ["POST"]);
  assert.deepEqual(calls[0].options.body, { filter: { offer_id: ["SKU-1"] } });
  assert.equal(JSON.stringify(result).includes("items"), false);
});

test("live read preserves endpoint request scope needed by FBS contracts", async () => {
  let observedScope;
  const result = await runReadVerification({
    store,
    environment: "staging",
    scope: {
      name: "single_offer",
      offerCount: 1,
      since: "2026-07-19T00:00:00Z",
      to: "2026-07-20T00:00:00Z",
      cutoffFrom: "2026-07-19",
      cutoffTo: "2026-07-20",
    },
    mode: "live_read",
    confirm: LIVE_CONFIRMATION,
    request: async () => ({ items: [] }),
    reader: async ({ scope }) => {
      observedScope = scope;
      return { observations: [] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(observedScope.since, "2026-07-19T00:00:00Z");
  assert.equal(observedScope.to, "2026-07-20T00:00:00Z");
  assert.equal(observedScope.cutoffFrom, "2026-07-19");
  assert.equal(observedScope.cutoffTo, "2026-07-20");
});

test("live read rejects unlisted GET endpoints instead of treating method as proof of safety", async () => {
  const result = await runReadVerification({
    store,
    environment: "staging",
    scope: { name: "single_offer", offerCount: 1 },
    mode: "live_read",
    confirm: LIVE_CONFIRMATION,
    request: async () => ({ ok: true }),
    reader: async ({ readRequest }) => {
      await assert.rejects(() => readRequest("/v1/product/import/prices", { method: "GET" }), /READ_VERIFY_ENDPOINT_NOT_ALLOWLISTED/);
      return { observations: [] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.writeAttempted, false);
});

test("missing store, environment, and scope fail closed", async () => {
  const reader = async () => ({ observations: [] });
  assert.equal((await runReadVerification({ environment: "x", scope: { name: "x" }, reader })).reasonCode, "READ_VERIFY_STORE_REQUIRED");
  assert.equal((await runReadVerification({ store, scope: { name: "x" }, reader })).reasonCode, "READ_VERIFY_ENVIRONMENT_REQUIRED");
  assert.equal((await runReadVerification({ store, environment: "x", reader })).reasonCode, "READ_VERIFY_SCOPE_REQUIRED");
});

test("live HTTP failures remain observed failures and never claim real read verification", async () => {
  const result = await runReadVerification({
    store,
    environment: "staging",
    scope: { name: "single_offer" },
    mode: "live_read",
    confirm: LIVE_CONFIRMATION,
    request: async () => ({ ok: false }),
    reader: async () => ({ observations: [
      { endpoint: "/v3/product/list", statusCode: 403, status: "forbidden" },
      { endpoint: "/v3/product/info/list", statusCode: 429, status: "rate_limited" },
      { endpoint: "/v4/product/info/stocks", statusCode: 503, status: "server_error" },
    ] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.verificationLevel, "server_observed");
  assert.equal(result.readSucceeded, false);
  assert.equal(result.observedFailure, true);
  assert.equal(result.failureScenario, "permission_denied");
  assert.equal(result.permissionFailureVerified, true);
  assert.equal(result.rateLimitFailureVerified, true);
  assert.equal(result.serverFailureVerified, true);
  assert.notEqual(result.verificationLevel, "real_read_verified");
});

test("reader exceptions are recorded as generic observed failures without permission coverage", async () => {
  const result = await runReadVerification({
    store,
    environment: "staging",
    scope: { name: "single_offer" },
    mode: "live_read",
    confirm: LIVE_CONFIRMATION,
    request: async () => ({ ok: true }),
    reader: async () => { const error = new Error("timeout"); error.code = "ETIMEDOUT"; throw error; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.verificationLevel, "server_observed");
  assert.equal(result.readSucceeded, false);
  assert.equal(result.observedFailure, true);
  assert.equal(result.failureScenario, "observed_read_failure");
  assert.equal(result.permissionFailureVerified, false);
});

test("a reader-level failed response is not silently treated as an empty successful read", async () => {
  const result = await runReadVerification({
    store,
    environment: "staging",
    scope: { name: "single_offer" },
    mode: "live_read",
    confirm: LIVE_CONFIRMATION,
    request: async () => ({ ok: false, statusCode: 403 }),
    reader: async () => ({ ok: false, statusCode: 403, status: "forbidden" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.readSucceeded, false);
  assert.equal(result.observedFailure, true);
  assert.equal(result.permissionFailureVerified, true);
  assert.equal(result.observations[0].statusCode, 403);
});

test("numeric HTTP status carried in status is preserved for seller permission recovery", async () => {
  const result = await runReadVerification({
    store,
    environment: "staging",
    scope: { name: "single_offer" },
    mode: "live_read",
    confirm: LIVE_CONFIRMATION,
    request: async () => ({ ok: false }),
    reader: async () => ({ observations: [{ endpoint: "/v3/product/list", status: 403 }] }),
  });
  assert.equal(result.failureScenario, "permission_denied");
  assert.equal(result.observations[0].statusCode, 403);
  assert.equal(result.permissionFailureVerified, true);
});
