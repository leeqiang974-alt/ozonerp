import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGoldenPathRecord } from "../src/goldenPathRecord.js";

const execFileAsync = promisify(execFile);

test("golden path record starts R01 as a local plan with explicit blockers", () => {
  const record = createGoldenPathRecord({
    replayId: "R01",
    productShape: "single_sku",
    sourceUrl: "https://detail.1688.com/offer/123456.html",
    recordedAt: "2026-07-20T00:00:00.000Z",
  });
  assert.equal(record.status, "not_started");
  assert.equal(record.verificationLevel, "configuration_declared");
  assert.equal(record.execution, "offline_only");
  assert.equal(record.source.url, "https://detail.1688.com/offer/123456.html");
  assert.equal(record.source.snapshotHash, null);
  assert.equal(record.moderation.observed, false);
  assert.equal(record.submission.taskId, null);
  assert.ok(record.blockers.some((item) => item.code === "SOURCE_SNAPSHOT_REQUIRED"));
  assert.ok(record.blockers.some((item) => item.code === "OZON_READ_REQUIRED"));
});

test("golden path record rejects non-1688 URLs without pretending to capture them", () => {
  const record = createGoldenPathRecord({ replayId: "R01", sourceUrl: "https://example.com/product" });
  assert.ok(record.blockers.some((item) => item.code === "SOURCE_URL_NOT_1688"));
  assert.equal(record.source.status, "not_captured");
  assert.equal(record.source.snapshotHash, null);
});

test("golden path record CLI emits a plan and never contacts a URL", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "scripts/golden-path-record.mjs",
    "--replay-id",
    "R01",
    "--shape",
    "single_sku",
    "--url",
    "https://detail.1688.com/offer/123456.html",
    "--recorded-at",
    "2026-07-20T00:00:00.000Z",
  ], { cwd: process.cwd(), maxBuffer: 1024 * 1024 });
  const output = JSON.parse(stdout);
  assert.equal(output.evidenceType, "real_replay_plan");
  assert.equal(output.verificationLevel, "configuration_declared");
  assert.equal(output.sideEffect.includes("不会访问"), true);
  assert.equal(output.submission.status, "not_started");
  assert.equal(output.moderation.observed, false);
});
