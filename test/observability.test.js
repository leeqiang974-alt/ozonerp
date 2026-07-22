import test from "node:test";
import assert from "node:assert/strict";
import { buildObservabilitySummary, buildSafeErrorSummary, sanitizeObservabilityValue } from "../src/observability.js";

test("observability summary is bounded and read-only", () => {
  const result = buildObservabilitySummary({
    env: { OZON_ERP_INSTANCE_ID: "instance-a", SENTRY_DSN: "" },
    now: Date.parse("2026-01-01T00:00:00.000Z"),
    uptimeSeconds: 12,
  });
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.instanceId, "instance-a");
  assert.equal(result.processId > 0, true);
  assert.equal(result.sentryConfigured, false);
  assert.equal(result.alerts.some((item) => item.code === "SENTRY_NOT_CONFIGURED"), true);
  assert.doesNotMatch(JSON.stringify(result), /api[_-]?key|access[_-]?token|authorization/i);
});

test("observability sanitizer drops credentials, raw payloads, and seller identifiers", () => {
  const safe = sanitizeObservabilityValue({
    api_key: "secret-key",
    payload: { offer_id: "OFFER-PRIVATE", price: 99 },
    nested: { authorization: "Bearer abc", task_id: "TASK-PRIVATE", note: "safe" },
    message: "authorization=Bearer secret and offer_id=OFFER-PRIVATE",
  });
  assert.equal(Object.hasOwn(safe, "api_key"), false);
  assert.equal(Object.hasOwn(safe, "payload"), false);
  assert.equal(safe.nested.authorization, undefined);
  assert.equal(safe.nested.task_id, "[REDACTED_IDENTIFIER]");
  assert.doesNotMatch(JSON.stringify(safe), /secret-key|OFFER-PRIVATE|Bearer abc/i);
  assert.match(safe.message, /\[REDACTED\]/);
});

test("safe error summary never reflects upstream details or invalid request ids", () => {
  const summary = buildSafeErrorSummary({
    status: 502,
    code: "UPSTREAM_FAILURE",
    message: "api_key=secret-key offer_id=OFFER-PRIVATE",
    requestId: "bad id with spaces",
    details: { api_key: "secret-key", raw: "private response" },
    attempts: 99,
  });
  assert.deepEqual(summary, {
    status: 502,
    code: "UPSTREAM_FAILURE",
    message: "api_key=[REDACTED] offer_id=[REDACTED_IDENTIFIER]",
    attempts: 20,
  });
  assert.doesNotMatch(JSON.stringify(summary), /secret-key|private response/i);
});
