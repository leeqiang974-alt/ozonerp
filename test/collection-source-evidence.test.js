import test from "node:test";
import assert from "node:assert/strict";
import { buildPersistedSourceEvidenceRecord } from "../src/collectionBox.js";

test("persisted source evidence gives sellers a safe next step for missing evidence", () => {
  const record = buildPersistedSourceEvidenceRecord({ platform: "1688", verificationState: "unknown" });
  assert.equal(record.sellerFacing.status, "unknown");
  assert.match(record.sellerFacing.nextAction, /重新打开来源商品详情页/);
  assert.deepEqual(record.sellerFacing.sideEffects, ["不会提交 Ozon", "不会修改价格", "不会写入库存"]);
});

test("persisted source evidence preserves waiting-human blocker without raw page data", () => {
  const record = buildPersistedSourceEvidenceRecord({
    platform: "1688",
    verificationState: "waiting_human",
    verificationReason: "captcha",
    html: "SECRET_RAW_PAGE",
  });
  assert.equal(record.sellerFacing.status, "waiting_human");
  assert.match(record.sellerFacing.blocker, /验证码/);
  assert.equal(record.snapshot.rawContentStored, false);
  assert.equal("html" in record, false);
});

test("persisted source evidence exposes bounded domain coverage without raw page content", () => {
  const record = buildPersistedSourceEvidenceRecord({
    platform: "1688",
    verificationState: "ok",
    snapshotHash: `sha256:${"a".repeat(64)}`,
    fields: {
      variants: { source: "page_content", count: 2 },
      supplier: { source: "page_content", id: "supplier-1", name: "示例供应商" },
      procurement: { source: "page_content", moq: 2, priceTierCount: 2 },
      media: { source: "page_content", assetCount: 3, issueCount: 0 },
    },
  });

  assert.equal(record.domainCoverage.sku.status, "captured");
  assert.equal(record.domainCoverage.procurement.status, "captured");
  assert.equal(record.domainCoverage.media.status, "captured");
  assert.deepEqual(record.missingDomains, []);
  assert.equal(record.snapshot.rawContentStored, false);
});

test("persisted source evidence keeps a bounded capture identity for task handoff", () => {
  const record = buildPersistedSourceEvidenceRecord({
    platform: "1688",
    offerId: "offer-42",
    canonicalUrl: "https://detail.1688.com/offer/42.html?secret=drop",
    verificationState: "ok",
    snapshotHash: `sha256:${"b".repeat(64)}`,
  }, {
    taskId: "crawler-task-42",
    offerId: "offer-42",
    captureMode: "extension_browser",
    collectedAt: "2026-07-19T12:00:00.000Z",
  });

  assert.deepEqual(record.captureIdentity, {
    taskId: "crawler-task-42",
    offerId: "offer-42",
    canonicalUrl: "https://detail.1688.com/offer/42.html",
    captureMode: "extension_browser",
    collectedAt: "2026-07-19T12:00:00.000Z",
  });
  assert.equal(record.snapshot.rawContentStored, false);
});
