import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaComplianceResult } from "../src/mediaCompliance.js";

const base = {
  id: "media:1",
  sourceUrl: "https://example.com/detail.jpg",
  sourceHash: `url-sha256:${"a".repeat(64)}`,
  evidenceRef: `snapshot:${"b".repeat(64)}`,
  checks: {
    ocr: { status: "clear" },
    dimensions: { status: "clear", width: 800, height: 800 },
    sourceRisk: "clear",
  },
};

test("media compliance exposes a seller-facing ready result only after OCR, size and source checks", () => {
  const result = buildMediaComplianceResult({ mediaAssets: [base] });
  assert.equal(result.status, "ready");
  assert.equal(result.blockers.length, 0);
  assert.match(result.nextAction, /人工批准/);
  assert.equal(result.verificationLevel, "locally_tested");
});

test("missing OCR, dimensions and source risk remain explicit blockers", () => {
  const result = buildMediaComplianceResult({
    mediaAssets: [{ ...base, checks: { humanApproved: true } }],
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers.map((item) => item.code), [
    "MEDIA_OCR_UNKNOWN",
    "MEDIA_DIMENSIONS_UNKNOWN",
    "MEDIA_SOURCE_RISK_UNKNOWN",
  ]);
  assert.match(result.nextAction, /OCR/);
});

test("OCR risk and invalid source evidence cannot be bypassed by human approval", () => {
  const result = buildMediaComplianceResult({
    mediaAssets: [{
      ...base,
      sourceHash: "bad",
      evidenceRef: "snapshot:bad",
      checks: {
        humanApproved: true,
        ocr: { status: "blocked", hasChinese: true },
        dimensions: { status: "blocked", width: 0, height: 800 },
        sourceRisk: "blocked",
      },
    }],
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((item) => item.code === "MEDIA_OCR_RISK"));
  assert.ok(result.blockers.some((item) => item.code === "MEDIA_DIMENSIONS_INVALID"));
  assert.ok(result.blockers.some((item) => item.code === "MEDIA_SOURCE_RISK"));
});
