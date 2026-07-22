#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse1688Product } from "../src/collector1688.js";
import { replay1688ToOzonPreflight } from "../src/goldenPathReplay.js";

const fixtureRoot = path.resolve("test", "fixtures", "1688");

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function replayFixture(fixture) {
  const root = path.join(fixtureRoot, fixture);
  const [manifestBytes, pageBytes] = await Promise.all([
    fs.readFile(path.join(root, "manifest.json")),
    fs.readFile(path.join(root, "page.html")),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const html = pageBytes.toString("utf8");
  const parsed = parse1688Product({ url: manifest.url, html, hints: manifest.hints });
  const result = replay1688ToOzonPreflight(parsed);
  const source = result.stages?.source || {};
  const content = result.stages?.content || {};
  const moderation = result.stages?.moderation || {};
  const preflight = result.stages?.preflight || {};
  const sellerTask = result.sellerTask || {};
  const provenanceWarnings = [];
  if (manifest.synthetic !== true || manifest.redacted !== true) provenanceWarnings.push("FIXTURE_PROVENANCE_NOT_EXPLICITLY_SYNTHETIC_REDACTED");
  if (manifest.hints?.captureMode !== "fixture_replay") provenanceWarnings.push("FIXTURE_CAPTURE_MODE_UNEXPECTED");
  if (sha256(pageBytes) !== source.snapshotHash) provenanceWarnings.push("FIXTURE_PAGE_SNAPSHOT_HASH_MISMATCH");
  return {
    fixture,
    verificationLevel: result.verificationLevel,
    provenanceWarnings,
    source: { ok: source.ok === true, verificationState: source.verificationState || "unknown" },
    sku: { count: Number(result.stages?.sku?.count || 0), bindingReady: result.stages?.sku?.binding?.ready === true },
    content: { status: content.status || "unknown", blockerCodes: content.blockerCodes || [] },
    media: { status: result.stages?.media?.status || "unknown" },
    pricing: { status: result.stages?.pricing?.status || "unknown" },
    preflight: { ok: preflight.ok === true, issues: Array.isArray(preflight.issues) ? preflight.issues : [] },
    sellerTask: {
      status: String(sellerTask.status || "blocked"),
      blockedStage: sellerTask.blockedStage || null,
      reasonCode: sellerTask.reasonCode || "",
      blockerCount: Number(sellerTask.blockerCount || 0),
      blockers: Array.isArray(sellerTask.blockers) ? sellerTask.blockers.slice(0, 8) : [],
      stageProgress: sellerTask.stageProgress || { completedStages: [], remainingStages: [], completedCount: 0, totalCount: 7 },
      nextAction: String(sellerTask.nextAction || result.nextAction || "修复阶段阻塞后重新回放；本回放禁止提交 Ozon。"),
    },
    moderation: { observed: moderation.observed === true, offerCount: Number(moderation.offerCount || 0), coveredOfferCount: Number(moderation.coveredOfferCount || 0) },
    nextAction: String(sellerTask.nextAction || result.nextAction || "修复离线回放阻塞后再准备真实受控验证。"),
  };
}

const entries = (await fs.readdir(fixtureRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const results = [];
for (const fixture of entries) {
  try {
    results.push(await replayFixture(fixture));
  } catch (error) {
    results.push({ fixture, ok: false, reasonCode: "FIXTURE_REPLAY_FAILED", message: String(error?.message || error) });
  }
}
const summary = {
  reportType: "offline_1688_to_ozon_golden_path_batch",
  evidenceType: "offline_fixture_replay",
  verificationLevel: "locally_tested_fixture",
  fixtureCount: results.length,
  preflightBlockedCount: results.filter((result) => result.preflight?.ok !== true).length,
  waitingHumanCount: results.filter((result) => result.source?.verificationState === "waiting_human").length,
  moderationObservedCount: results.filter((result) => result.moderation?.observed === true).length,
  localPreflightPassFixtureCount: results.filter((result) => result.preflight?.ok === true).length,
  preflightPassPolicy: "当前仓库没有 local-only 通过 fixture；所有离线样本必须保留来源/类目/内容/人工确认边界，不能用合成通过结果代替当前店铺证据。",
  results,
  execution: "offline_only",
  sideEffect: "仅回放仓库内脱敏 fixture；不会访问 1688、Ozon，不提交、不改价、不写库存。",
  nextAction: "使用该报告定位离线阻塞；真实阶段仍需受控 1688 页面快照、Seller API 读取和人工确认。",
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
