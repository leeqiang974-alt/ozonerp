import test from "node:test";
import assert from "node:assert/strict";
import { buildHealthSummary } from "../src/healthSummary.js";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

test("health summary fails closed on malformed local task storage", () => {
  const result = buildHealthSummary({ raw: { items: "not-an-array" } });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "HEALTH_STORAGE_CORRUPT");
  assert.match(result.nextAction, /JSON 结构/);
});

test("health summary exposes needs-review and pending work instead of healthy zero", () => {
  const result = buildHealthSummary({
    nowMs: NOW,
    raw: {
      items: [
        { status: "needs_review", updatedAt: "2026-07-20T11:00:00.000Z", reasonCode: "UNKNOWN_WRITE" },
        { status: "listing_failed", updatedAt: "2026-07-20T10:00:00.000Z" },
        { status: "matching", updatedAt: "2026-07-20T09:00:00.000Z" },
        { status: "listed", updatedAt: "2026-07-19T10:00:00.000Z" },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.total24h, 3);
  assert.equal(result.needsReview, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  assert.match(result.nextAction, /待复核/);
  assert.match(result.sideEffect, /Ozon 写入/);
});

test("health summary treats a missing first-run snapshot as an explicit state", () => {
  const result = buildHealthSummary({ raw: { items: [] }, storageState: "missing", nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.storageState, "missing");
  assert.match(result.nextAction, /尚未生成/);
});
