import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedCorsOrigin } from "../src/corsPolicy.js";

test("loopback ERP accepts a valid Chrome extension origin", () => {
  assert.equal(isAllowedCorsOrigin({
    origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    host: "127.0.0.1",
    allowedOrigins: new Set(),
  }), true);
});

test("Chrome extension origins stay denied on externally bound ERP deployments", () => {
  assert.equal(isAllowedCorsOrigin({
    origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    host: "0.0.0.0",
    allowedOrigins: new Set(),
  }), false);
});

test("CORS policy rejects malformed extension and ordinary website origins", () => {
  const input = { host: "127.0.0.1", allowedOrigins: new Set() };
  assert.equal(isAllowedCorsOrigin({ ...input, origin: "chrome-extension://not-an-extension-id" }), false);
  assert.equal(isAllowedCorsOrigin({ ...input, origin: "https://example.com" }), false);
});

test("CORS policy preserves no-origin and explicit allowlist behavior", () => {
  const allowedOrigins = new Set(["https://erp.example.test"]);
  assert.equal(isAllowedCorsOrigin({ origin: "", host: "127.0.0.1", allowedOrigins }), true);
  assert.equal(isAllowedCorsOrigin({ origin: "https://erp.example.test", host: "0.0.0.0", allowedOrigins }), true);
});
