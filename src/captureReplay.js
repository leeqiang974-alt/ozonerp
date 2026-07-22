import { createHash } from "node:crypto";
import { normalize1688CaptureEnvelope, parse1688Product } from "./collector1688.js";

function hashSnapshot(value = "") {
  return `sha256:${createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function offerIdFromUrl(url = "") {
  return String(url).match(/(?:detail\.)?1688\.com\/offer\/(\d+)(?:\.html)?/i)?.[1]
    || String(url).match(/[?&]offerId=(\d+)/i)?.[1]
    || "";
}

/**
 * Gate importing a persisted 1688 snapshot into the listing workbench.
 * A hash alone is not an operator review.  The operator must confirm the
 * exact snapshot hash, and the offer must not already exist in the candidate
 * pool.  This is pure/local so the API can use it without touching 1688/Ozon.
 */
export function build1688CaptureImportReview({ capture = {}, parsed = {}, captureReview = {}, existingCandidates = [], candidateId = "" } = {}) {
  const source = parsed.sourceEvidence && typeof parsed.sourceEvidence === "object" ? parsed.sourceEvidence : {};
  const snapshotHash = String(source.snapshotHash || "").trim();
  const canonicalUrl = String(source.canonicalUrl || parsed.url || capture.url || "").trim().split(/[?#]/)[0];
  const offerId = String(source.offerId || capture.offerId || offerIdFromUrl(canonicalUrl)).trim();
  const urlOfferId = offerIdFromUrl(canonicalUrl);
  const dedupeKey = offerId ? `offer:${offerId}` : canonicalUrl ? `url:${canonicalUrl.toLowerCase()}` : "";
  const sameKey = (row = {}) => {
    if (String(row.id || "") === String(candidateId || "")) return false;
    const value = row.parsed || row.product || row;
    const rowSource = value.sourceEvidence || row.sourceEvidence || {};
    const rowOffer = String(rowSource.offerId || value.capture?.offerId || offerIdFromUrl(rowSource.canonicalUrl || value.url || row.url || "")).trim();
    const rowUrl = String(rowSource.canonicalUrl || value.url || row.url || "").trim().split(/[?#]/)[0];
    return dedupeKey && (rowOffer ? `offer:${rowOffer}` : rowUrl ? `url:${rowUrl.toLowerCase()}` : "") === dedupeKey;
  };
  const duplicate = Array.isArray(existingCandidates) && existingCandidates.find(sameKey);
  const reviewedHash = String(captureReview.reviewedSnapshotHash || captureReview.snapshotHash || "").trim();
  const humanConfirmed = captureReview.humanConfirmed === true || captureReview.status === "approved";
  const reviewInvalidated = Boolean(captureReview.invalidatedAt)
    || String(captureReview.status || "").trim().toLowerCase() === "stale";
  const blockers = [];
  if (!dedupeKey) blockers.push("CAPTURE_DEDUPE_KEY_MISSING");
  if (!/^https?:\/\/detail\.1688\.com\/offer\/\d+(?:\.html)?$/i.test(canonicalUrl)) blockers.push("CAPTURE_SOURCE_URL_INVALID");
  if (!offerId) blockers.push("CAPTURE_OFFER_ID_MISSING");
  // A source SKU/offer from one page must not be rebound to another page URL.
  if (urlOfferId && offerId && urlOfferId !== offerId) blockers.push("CAPTURE_OFFER_URL_MISMATCH");
  if (!/^sha256:[a-f0-9]{64}$/i.test(snapshotHash)) blockers.push("CAPTURE_SNAPSHOT_HASH_MISSING");
  if (String(source.verificationState || "").trim().toLowerCase() !== "ok") blockers.push("CAPTURE_SOURCE_EVIDENCE_UNVERIFIED");
  if (duplicate) blockers.push("CAPTURE_DUPLICATE_OFFER");
  if (reviewInvalidated) blockers.push("CAPTURE_REVIEW_INVALIDATED");
  if (!humanConfirmed) blockers.push("CAPTURE_HUMAN_REVIEW_REQUIRED");
  if (humanConfirmed && reviewedHash !== snapshotHash) blockers.push("CAPTURE_REVIEW_HASH_MISMATCH");
  return {
    status: duplicate ? "duplicate" : blockers.length ? "needs_review" : "approved",
    dedupeKey: dedupeKey || null,
    offerId: offerId || null,
    canonicalUrl: canonicalUrl || null,
    snapshotHash: snapshotHash || null,
    reviewedSnapshotHash: reviewedHash || null,
    reviewInvalidated,
    duplicateId: duplicate?.id || null,
    blockers,
    verificationLevel: "locally_tested",
    sideEffect: "仅检查本地快照与候选去重；不会访问 1688、不会调用 Ozon、不会创建草稿",
    nextAction: duplicate ? "打开已有候选商品，不要重复创建草稿" : blockers.length ? "核对当前快照并由人工确认同一 SHA-256 后再生成草稿" : "可生成本地商品草稿；仍需后续预检和人工提交确认",
  };
}

/**
 * Check whether a persisted crawler completion can be replayed locally.
 * This is deliberately pure: it reads no files, performs no network calls,
 * and never submits anything to Ozon.  The caller may pass fixture HTML as a
 * verification witness; raw HTML is not included in the returned receipt.
 */
export function inspect1688CaptureReplay({ capture = {}, parsed = {}, html = "" } = {}) {
  const envelope = normalize1688CaptureEnvelope(capture, {
    taskId: parsed.capture?.taskId,
    url: parsed.url,
    captureMode: parsed.capture?.captureMode,
    collectedAt: parsed.capture?.collectedAt,
  });
  const parsedCapture = normalize1688CaptureEnvelope(parsed.capture || {}, {
    taskId: parsed.capture?.taskId,
    url: parsed.url,
    captureMode: parsed.capture?.captureMode,
    collectedAt: parsed.capture?.collectedAt,
  });
  const source = parsed.sourceEvidence && typeof parsed.sourceEvidence === "object" ? parsed.sourceEvidence : {};
  const expectedHash = String(source.snapshotHash || "");
  const actualHash = String(html) ? hashSnapshot(html) : "";
  const checks = {
    taskId: Boolean(envelope.taskId) && envelope.taskId === parsedCapture.taskId,
    offerId: Boolean(envelope.offerId) && envelope.offerId === parsedCapture.offerId,
    url: Boolean(envelope.url) && offerIdFromUrl(envelope.url) === envelope.offerId,
    snapshot: !html || !expectedHash || actualHash === expectedHash,
    sourceVerified: source.verificationState === "ok" && /^sha256:[a-f0-9]{64}$/i.test(expectedHash),
  };
  const blockers = [];
  if (!checks.taskId) blockers.push("CAPTURE_TASK_ID_MISMATCH");
  if (!checks.offerId) blockers.push("CAPTURE_OFFER_ID_MISMATCH");
  if (!checks.url) blockers.push("CAPTURE_URL_INVALID");
  if (!checks.snapshot) blockers.push("CAPTURE_SNAPSHOT_HASH_MISMATCH");
  if (!checks.sourceVerified) blockers.push("CAPTURE_SOURCE_EVIDENCE_UNVERIFIED");
  return {
    replayType: "offline_1688_capture_replay",
    verificationLevel: "locally_tested_fixture",
    status: blockers.length ? "needs_review" : "replayable",
    envelope,
    checks,
    blockers,
    evidence: {
      sourceSnapshotHash: expectedHash || null,
      replayedSnapshotHash: actualHash || null,
      rawContentStored: false,
    },
    execution: "offline_only",
    sideEffects: ["不会访问 1688", "不会调用 Ozon", "不会修改任务或商品"],
    nextAction: blockers.length ? "修复 capture 身份或来源快照证据后再恢复采集" : "可从本地 capture 恢复到后续预检",
  };
}

/**
 * Replay a complete, locally supplied capture fixture.  The caller owns the
 * bytes (normally manifest.json + page.html copied from a browser capture);
 * this helper never opens a URL or persists the page.  Provenance is kept in
 * the returned receipt so a real browser capture cannot be mistaken for a
 * synthetic fixture, while raw HTML remains an input-only witness.
 */
export function replay1688CaptureFixture({ fixtureName = "", manifest = {}, manifestBytes = "", html = "" } = {}) {
  const name = String(fixtureName || "").trim();
  const metadata = manifest && typeof manifest === "object" ? manifest : {};
  const page = String(html || "");
  const warnings = [];
  if (!name) warnings.push("FIXTURE_NAME_MISSING");
  if (!String(metadata.url || "").trim()) warnings.push("FIXTURE_URL_MISSING");
  if (!page.trim()) warnings.push("FIXTURE_PAGE_MISSING");
  const manifestText = typeof manifestBytes === "string" && manifestBytes.length
    ? manifestBytes
    : JSON.stringify(metadata);
  const manifestHash = hashSnapshot(manifestText);
  const pageHash = hashSnapshot(page);
  let parsed = null;
  let replay = null;
  const fixtureEvidence = {
    evidenceType: "offline_1688_capture_fixture",
    fixtureName: name || null,
    fixtureKind: String(metadata.fixtureKind || "unspecified"),
    synthetic: typeof metadata.synthetic === "boolean" ? metadata.synthetic : null,
    redacted: typeof metadata.redacted === "boolean" ? metadata.redacted : null,
    verificationLevel: String(metadata.verificationLevel || "unspecified"),
    captureOrigin: String(metadata.captureOrigin || (metadata.synthetic === true ? "synthetic_fixture" : "unspecified")),
    capturedAt: metadata.hints?.capturedAt || metadata.capturedAt || null,
    captureMode: metadata.hints?.captureMode || metadata.captureMode || "unspecified",
    validationTargets: Array.isArray(metadata.validationTargets) ? metadata.validationTargets : [],
    manifestHash,
    pageHash,
  };
  if (!["synthetic_redacted_replay", "real_redacted_capture"].includes(fixtureEvidence.fixtureKind)) warnings.push("FIXTURE_KIND_UNSUPPORTED");
  if (fixtureEvidence.synthetic === null || fixtureEvidence.redacted !== true) warnings.push("FIXTURE_PROVENANCE_INCOMPLETE");
  if (!fixtureEvidence.capturedAt || Number.isNaN(new Date(fixtureEvidence.capturedAt).getTime())) warnings.push("FIXTURE_CAPTURED_AT_MISSING_OR_INVALID");
  if (fixtureEvidence.captureMode === "unspecified") warnings.push("FIXTURE_CAPTURE_MODE_MISSING");
  if (!warnings.length) {
    try {
      parsed = parse1688Product({
        url: metadata.url,
        html: page,
        hints: { ...(metadata.hints || {}), taskId: metadata.taskId || `fixture:${name}` },
      });
      const replayParsed = {
        ...parsed,
        capture: { ...parsed.capture, taskId: metadata.taskId || `fixture:${name}` },
      };
      replay = inspect1688CaptureReplay({ capture: replayParsed.capture, parsed: replayParsed, html: page });
      if (replay.evidence.replayedSnapshotHash !== pageHash) warnings.push("FIXTURE_PAGE_HASH_UNEXPECTED");
      if (replay.status !== "replayable") warnings.push(...replay.blockers);
    } catch (error) {
      warnings.push("FIXTURE_PARSE_FAILED");
    }
  }
  const safeParsed = parsed ? {
    ...parsed,
    detail: parsed.detail ? { ...parsed.detail, html: "" } : parsed.detail,
    richContentJson: null,
  } : null;
  return {
    ok: warnings.length === 0,
    fixtureEvidence,
    provenanceWarnings: warnings,
    parsed: safeParsed,
    replay,
    execution: "offline_only",
    sideEffects: ["不会访问 1688", "不会调用 Ozon", "不会保存原始页面"],
  };
}
