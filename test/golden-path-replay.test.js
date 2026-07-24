import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { parse1688Product } from "../src/collector1688.js";
import { replay1688CaptureToOzonPreflight, replay1688ToOzonPreflight } from "../src/goldenPathReplay.js";

const execFileAsync = promisify(execFile);

async function fixture(name) {
  const root = new URL(`./fixtures/1688/${name}/`, import.meta.url);
  const manifest = JSON.parse(await fs.readFile(new URL("manifest.json", root), "utf8"));
  const html = await fs.readFile(new URL("page.html", root), "utf8");
  return parse1688Product({ url: manifest.url, html, hints: manifest.hints });
}

test("golden path replay reaches a deterministic blocked preflight result with procurement fixture", async () => {
  const parsed = await fixture("tier-price-moq");
  const result = replay1688ToOzonPreflight(parsed);
  assert.equal(result.verificationLevel, "locally_tested_fixture");
  assert.equal(result.stages.source.ok, true);
  assert.equal(result.stages.sku.count, 1);
  assert.equal(result.stages.pricing.status, "verified");
  assert.equal(result.stages.preflight.ok, false);
  assert.equal(result.ok, false);
  assert.equal(result.stages.preflight.issues.includes("SOURCE_IMAGES_TOO_FEW"), true);
  assert.match(result.nextAction, /禁止提交/);
  assert.equal(result.sellerTask.status, "blocked");
  assert.equal(result.sellerTask.blockedStage, "category");
  assert.equal(result.sellerTask.reasonCode, "CATEGORY_CURRENT_READ_REQUIRED");
  assert.deepEqual(result.sellerTask.stageProgress.completedStages, ["source", "sku", "media", "pricing"]);
  assert.equal(result.sellerTask.stageProgress.completedCount, 4);
  assert.equal(result.sellerTask.stageProgress.totalCount, 7);
  assert.match(result.sellerTask.nextAction, /当前店铺 Seller API/);
  assert.match(result.sellerTask.sideEffect, /不会访问 1688、不会调用 Ozon/);
});

test("capture replay closes the offline 1688-to-payload seam before preflight", async () => {
  const root = new URL("./fixtures/1688/complete-single/", import.meta.url);
  const manifest = JSON.parse(await fs.readFile(new URL("manifest.json", root), "utf8"));
  const html = await fs.readFile(new URL("page.html", root), "utf8");
  const parsed = await fixture("complete-single");
  const replayParsed = { ...parsed, capture: { ...parsed.capture, taskId: "fixture:complete-single" } };
  const result = replay1688CaptureToOzonPreflight({
    capture: replayParsed.capture,
    parsed: replayParsed,
    html,
  });
  assert.equal(result.replay.status, "replayable");
  assert.equal(result.verificationLevel, "locally_tested_fixture");
  assert.equal(result.stages.draft.ok, true);
  assert.equal(result.stages.preflight.ok, false);
  assert.equal(result.sellerTask.status, "blocked");
  assert.match(result.sellerTask.sideEffect, /不会.*草稿/);
  assert.equal(manifest.hints.captureMode, "fixture_replay");
});

test("capture replay blocks payload construction when task identity changes", async () => {
  const parsed = await fixture("complete-single");
  const replayParsed = { ...parsed, capture: { ...parsed.capture, taskId: "fixture:complete-single" } };
  const result = replay1688CaptureToOzonPreflight({
    capture: { ...replayParsed.capture, taskId: "fixture:wrong-task" },
    parsed: replayParsed,
  });
  assert.equal(result.ok, false);
  assert.equal(result.replay.status, "needs_review");
  assert.ok(result.replay.blockers.includes("CAPTURE_TASK_ID_MISMATCH"));
  assert.equal(result.stages.draft.ok, false);
  assert.equal(result.stages.draft.error, "CAPTURE_REPLAY_BLOCKED");
  assert.equal(result.sellerTask.reasonCode, "CAPTURE_REPLAY_BLOCKED");
  assert.match(result.nextAction, /禁止提交/);
});

test("golden path replay records category selection and its evidence boundary", async () => {
  const parsed = await fixture("tier-price-moq");
  const result = replay1688ToOzonPreflight(parsed, {
    category: {
      description_category_id: 17028673,
      type_id: 95183,
      path: "fixture / storage",
      reasons: ["来源标题命中收纳", "人工选择受控类目"],
      source: "fixture_category_match",
    },
  });
  assert.deepEqual(result.stages.category.selected, {
    descriptionCategoryId: 17028673,
    typeId: 95183,
    path: "fixture / storage",
  });
  assert.deepEqual(result.stages.category.selectionReasons, ["来源标题命中收纳", "人工选择受控类目"]);
  assert.equal(result.stages.category.byOffer.length, 1);
  assert.equal(result.stages.category.byOffer[0].offerId, result.stages.sku.bindingRows[0].offerId);
  assert.equal(result.stages.category.byOffer[0].sourceSkuId, result.stages.sku.bindingRows[0].sourceSkuId);
  assert.equal(result.stages.category.evidence.currentReadObserved, false);
  assert.equal(result.stages.category.evidence.verificationLevel, "locally_tested_fixture");
  assert.match(result.stages.category.nextAction, /当前店铺.*类目/);
});

test("single SKU replay feeds local category metadata into required-attribute preflight", async () => {
  const parsed = await fixture("tier-price-moq");
  const attributesFixture = JSON.parse(await fs.readFile(new URL("./fixtures/ozon/category-read/attributes.success.mocked.json", import.meta.url), "utf8"));
  const result = replay1688ToOzonPreflight(parsed, {
    categoryAttributes: attributesFixture.result,
    dictionaryValuesByAttributeId: {
      85: [{ id: 971082, value: "Нет бренда" }],
    },
    categoryReadEvidence: {
      source: "mocked_category_read_fixture",
      fixtureKind: attributesFixture.fixtureKind,
    },
  });
  assert.deepEqual(result.stages.category.requiredAttributeIds, [85]);
  assert.equal(result.stages.category.attributes.find((row) => row.id === 85).dictionaryId, 971082);
  assert.equal(result.stages.category.evidence.currentReadObserved, false);
  assert.equal(result.stages.category.evidence.verificationLevel, "locally_tested_fixture");
  assert.equal(result.stages.preflight.requiredAttributes.totalCount, 1);
  assert.equal(result.stages.preflight.requiredAttributes.readinessStatus, "ready");
  // Other local evidence (images/content/dictionary mapping) still blocks;
  // category fixture metadata must not accidentally unlock submission.
  assert.equal(result.ok, false);
  assert.ok(result.stages.preflight.issues.includes("CONTENT_EVIDENCE_REVIEW_REQUIRED"));
});

test("golden path replay reuses snapshot-bound detail SKU prices without unlocking submission", async () => {
  const parsed = await fixture("complete-single");
  const result = replay1688ToOzonPreflight(parsed);
  assert.equal(result.stages.source.ok, true);
  assert.equal(result.stages.pricing.status, "verified");
  assert.equal(result.ok, false);
  assert.match(result.nextAction, /禁止提交/);
});

test("golden path replay does not upgrade unreferenced size-weight numbers to 1688 evidence", async () => {
  const parsed = await fixture("complete-single");
  const tampered = {
    ...parsed,
    sizeWeight: { weightG: 500, lengthMm: 100, widthMm: 100, heightMm: 100 },
    sourceEvidence: {
      ...parsed.sourceEvidence,
      fields: { ...parsed.sourceEvidence.fields, package: { source: "missing", evidenceRef: "", values: {} } },
    },
  };
  const result = replay1688ToOzonPreflight(tampered);
  assert.equal(result.stages.draft.ok, false);
  assert.equal(result.stages.draft.error, "候选缺少可信尺重来源，无法生成 payload 草稿");
  assert.equal(result.ok, false);
});

test("golden path replay does not trust size-weight numbers changed after the source snapshot", async () => {
  const parsed = await fixture("complete-single");
  const tampered = {
    ...parsed,
    sizeWeight: { ...parsed.sizeWeight, weightG: Number(parsed.sizeWeight.weightG || 0) + 1 },
  };
  const result = replay1688ToOzonPreflight(tampered);
  assert.equal(result.stages.draft.ok, false);
  assert.equal(result.stages.draft.error, "候选缺少可信尺重来源，无法生成 payload 草稿");
});

test("golden path replay keeps a 1688 human-verification page out of source-ready state", async () => {
  const parsed = await fixture("human-verification");
  const result = replay1688ToOzonPreflight(parsed);
  assert.equal(result.stages.source.verificationState, "waiting_human");
  assert.equal(result.stages.source.ok, false);
  assert.equal(result.stages.preflight.issues.includes("SOURCE_EVIDENCE_NOT_VERIFIED"), true);
  assert.equal(result.ok, false);
  assert.match(result.nextAction, /禁止提交/);
  assert.equal(result.sellerTask.blockedStage, "source");
  assert.equal(result.sellerTask.reasonCode, "SOURCE_WAITING_HUMAN");
  assert.match(result.sellerTask.nextAction, /完成验证/);
});

test("golden path seller task exposes confirmation boundary without claiming live readiness", async () => {
  const result = await fixture("complete-single").then((parsed) => replay1688ToOzonPreflight(parsed));
  assert.equal(result.sellerTask.status, "blocked");
  assert.equal(result.sellerTask.blockedStage, "category");
  assert.equal(result.sellerTask.reasonCode, "CATEGORY_CURRENT_READ_REQUIRED");
  assert.match(result.sellerTask.nextAction, /当前店铺 Seller API/);
  assert.match(result.sellerTask.sideEffect, /不会修改草稿/);
});

test("golden path replay carries 1688 media evidence into the human-review gate", async () => {
  const parsed = await fixture("media-candidates");
  const result = replay1688ToOzonPreflight(parsed);
  assert.equal(result.verificationLevel, "locally_tested_fixture");
  assert.equal(result.stages.source.ok, true);
  assert.equal(result.stages.media.status, "needs_human_review");
  assert.equal(result.stages.media.detailImageCount > 0, true);
  assert.equal(result.stages.media.mediaAssetCount > 0, true);
  assert.equal(result.stages.media.richContentImageCount > 0, true);
  assert.equal(result.stages.preflight.ok, false);
  assert.equal(result.ok, false);
});

test("golden path replay applies the same Russian content evidence gate as real listing", async () => {
  const parsed = await fixture("tier-price-moq");
  const result = replay1688ToOzonPreflight(parsed);
  assert.equal(result.stages.content.status, "blocked");
  assert.ok(result.stages.content.blockerCodes.includes("CONTENT_FACT_REVIEW_REQUIRED"));
  assert.ok(result.stages.preflight.issues.includes("CONTENT_EVIDENCE_REVIEW_REQUIRED"));
  assert.match(result.stages.content.nextAction, /逐字段核对/);
});

test("golden path replay preserves a multi-SKU source matrix without collapsing variants", async () => {
  const parsed = await fixture("color-size-matrix");
  const result = replay1688ToOzonPreflight(parsed);
  assert.equal(result.stages.source.ok, true);
  assert.equal(result.stages.sku.count, 2);
  assert.equal(result.stages.sku.sourceVariantCount, 2);
  assert.equal(result.stages.sku.binding.ready, true);
  assert.equal(result.stages.sku.binding.boundCount, 2);
  assert.equal(result.stages.sku.bindingRows.length, 2);
  assert.equal(result.stages.draft.itemCount, 2);
  assert.equal(result.stages.media.status, "needs_human_review");
  assert.equal(result.stages.preflight.issues.includes("VARIANT_COLLAPSED"), false);
  assert.equal(result.ok, false);
});

test("golden path replay keeps moderation metadata offline for single and multi SKU fixtures", async () => {
  for (const [fixtureName, expectedCount] of [["complete-single", 1], ["color-size-matrix", 2]]) {
    const parsed = await fixture(fixtureName);
    const result = replay1688ToOzonPreflight(parsed);
    const moderation = result.stages.moderation;
    assert.equal(moderation.evidenceType, "offline_fixture_replay", fixtureName);
    assert.equal(moderation.verificationLevel, "locally_tested_fixture", fixtureName);
    assert.equal(moderation.synthetic, true, fixtureName);
    assert.equal(moderation.redacted, true, fixtureName);
    assert.equal(moderation.observed, false, fixtureName);
    assert.equal(moderation.offerCount, expectedCount, fixtureName);
    assert.equal(moderation.coveredOfferCount, 0, fixtureName);
    assert.equal(moderation.offerCoverage, "none", fixtureName);
    assert.match(moderation.nextAction, /不会提交|受控写入/, fixtureName);
  }
});

test("golden path CLI carries explicit offline fixture provenance and never implies live evidence", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/golden-path-replay.mjs", "complete-single"], {
    cwd: process.cwd(),
    maxBuffer: 2 * 1024 * 1024,
  });
  const output = JSON.parse(stdout.trim());
  assert.equal(output.fixtureEvidence.evidenceType, "offline_fixture_replay");
  assert.equal(output.fixtureEvidence.verificationLevel, "locally_tested_fixture");
  assert.equal(output.fixtureEvidence.captureMode, "fixture_replay");
  assert.equal(output.fixtureEvidence.synthetic, true);
  assert.equal(output.fixtureEvidence.redacted, true);
  assert.match(output.fixtureEvidence.manifestHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(output.fixtureEvidence.pageHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(output.fixtureEvidence.pageHash, output.fixtureEvidence.sourceSnapshotHash);
  assert.deepEqual(output.provenanceWarnings, []);
  assert.equal(output.verificationLevel, "locally_tested_fixture");
});

test("all 1688 replay fixtures carry immutable file provenance", async () => {
  const fixtureNames = [
    "bundle-partial-combinations",
    "color-size-matrix",
    "complete-single",
    "human-verification",
    "media-candidates",
    "tier-price-moq",
  ];
  for (const fixtureName of fixtureNames) {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/golden-path-replay.mjs", fixtureName], {
      cwd: process.cwd(),
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = JSON.parse(stdout.trim());
    assert.equal(output.fixtureEvidence.evidenceType, "offline_fixture_replay");
    assert.match(output.fixtureEvidence.manifestHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(output.fixtureEvidence.pageHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(output.fixtureEvidence.pageHash, output.fixtureEvidence.sourceSnapshotHash, fixtureName);
    assert.deepEqual(output.provenanceWarnings, [], fixtureName);
  }
});

test("golden path batch report audits every offline fixture without implying live evidence", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/golden-path-batch.mjs"], {
    cwd: process.cwd(),
    maxBuffer: 2 * 1024 * 1024,
  });
  const report = JSON.parse(stdout.trim());
  assert.equal(report.reportType, "offline_1688_to_ozon_golden_path_batch");
  assert.equal(report.evidenceType, "offline_fixture_replay");
  assert.equal(report.verificationLevel, "locally_tested_fixture");
  assert.equal(report.fixtureCount, 6);
  assert.equal(report.execution, "offline_only");
  assert.equal(report.moderationObservedCount, 0);
  assert.equal(report.localPreflightPassFixtureCount, 0);
  assert.match(report.preflightPassPolicy, /没有 local-only 通过 fixture/);
  assert.match(report.sideEffect, /不会访问 1688、Ozon/);
  assert.equal(report.results.every((result) => result.verificationLevel === "locally_tested_fixture"), true);
  assert.equal(report.results.every((result) => result.sellerTask?.status === "blocked"), true);
  assert.equal(report.results.every((result) => Number(result.sellerTask?.blockerCount || 0) > 0), true);
  assert.equal(report.results.every((result) => Array.isArray(result.sellerTask?.blockers)), true);
  assert.match(report.results.find((result) => result.fixture === "complete-single").sellerTask.nextAction, /当前店铺 Seller API/);
});
