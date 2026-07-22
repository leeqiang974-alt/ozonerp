import test from "node:test";
import assert from "node:assert/strict";
import { buildMultiInstanceHealthReport } from "../src/instanceHealth.js";

test("multi-instance health report detects stale, duplicate, and mismatched instances", () => {
  const result = buildMultiInstanceHealthReport([
    { instanceId: "a", generatedAt: "2026-01-01T00:59:30.000Z", release: "r1" },
    { instanceId: "a", generatedAt: "2026-01-01T00:58:00.000Z", release: "r2" },
    { instanceId: "b", generatedAt: "2025-12-31T23:00:00.000Z", release: "r1" },
    { generatedAt: "2026-01-01T00:59:50.000Z", release: "r1" },
  ], { now: Date.parse("2026-01-01T01:00:00.000Z"), expectedRelease: "r1" });
  assert.equal(result.ok, false);
  assert.equal(result.instanceCount, 4);
  assert.equal(result.issues.some((issue) => issue.code === "INSTANCE_ID_DUPLICATE"), true);
  assert.equal(result.issues.some((issue) => issue.code === "INSTANCE_HEARTBEAT_STALE"), true);
  assert.equal(result.issues.some((issue) => issue.code === "INSTANCE_RELEASE_MISMATCH"), true);
  assert.equal(result.issues.some((issue) => issue.code === "INSTANCE_ID_MISSING"), true);
  assert.match(result.sideEffect, /未连接实例/);
});

test("multi-instance health report accepts fresh uniquely identified instances", () => {
  const result = buildMultiInstanceHealthReport([
    { instanceId: "a", generatedAt: "2026-01-01T00:59:30.000Z", release: "r1" },
    { instanceId: "b", generatedAt: "2026-01-01T00:59:40.000Z", release: "r1" },
  ], { now: Date.parse("2026-01-01T01:00:00.000Z"), expectedRelease: "r1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("multi-instance health report fails closed when inventory or release evidence is missing", () => {
  const empty = buildMultiInstanceHealthReport([], {
    now: Date.parse("2026-01-01T01:00:00.000Z"),
    expectedRelease: "r1",
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.issues.some((issue) => issue.code === "INSTANCE_INVENTORY_EMPTY"), true);

  const missingRelease = buildMultiInstanceHealthReport([
    { instanceId: "a", generatedAt: "2026-01-01T00:59:30.000Z" },
  ], {
    now: Date.parse("2026-01-01T01:00:00.000Z"),
    expectedRelease: "r1",
  });
  assert.equal(missingRelease.ok, false);
  assert.equal(missingRelease.issues.some((issue) => issue.code === "INSTANCE_RELEASE_MISSING"), true);
});

test("multi-instance health does not report ready when release evidence is absent", () => {
  const result = buildMultiInstanceHealthReport([
    { instanceId: "a", generatedAt: "2026-01-01T00:59:30.000Z" },
  ], { now: Date.parse("2026-01-01T01:00:00.000Z") });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "INSTANCE_RELEASE_MISSING"), true);
});

test("multi-instance health fails closed when a fresh instance is on another release", () => {
  const result = buildMultiInstanceHealthReport([
    { instanceId: "a", generatedAt: "2026-01-01T00:59:50.000Z", release: "r2" },
  ], { now: Date.parse("2026-01-01T01:00:00.000Z"), expectedRelease: "r1" });
  assert.equal(result.ok, false);
  assert.equal(result.issues.filter((issue) => issue.code === "INSTANCE_RELEASE_MISMATCH").length, 1);
  assert.equal(result.issues[0].severity, "high");
});

test("multi-instance health rejects a heartbeat too far in the future", () => {
  const result = buildMultiInstanceHealthReport([
    { instanceId: "a", generatedAt: "2026-01-01T01:10:01.000Z", release: "r1" },
  ], { now: Date.parse("2026-01-01T01:00:00.000Z"), expectedRelease: "r1" });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "INSTANCE_HEARTBEAT_FUTURE"), true);
});

test("multi-instance health fails closed when release evidence is mixed without an expected release", () => {
  const result = buildMultiInstanceHealthReport([
    { instanceId: "a", generatedAt: "2026-01-01T00:59:50.000Z", release: "r1" },
    { instanceId: "b", generatedAt: "2026-01-01T00:59:55.000Z", release: "r2" },
  ], { now: Date.parse("2026-01-01T01:00:00.000Z") });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "INSTANCE_RELEASE_MIXED"), true);
});
