import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parse1688Product } from "../src/collector1688.js";
import { build1688CaptureImportReview, inspect1688CaptureReplay, replay1688CaptureFixture } from "../src/captureReplay.js";

test("offline capture replay verifies normalized identity and snapshot", async () => {
  const root = path.join(process.cwd(), "test", "fixtures", "1688", "complete-single");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  const html = await fs.readFile(path.join(root, "page.html"), "utf8");
  const parsed = parse1688Product({ url: manifest.url, html, hints: manifest.hints });
  const replayParsed = { ...parsed, capture: { ...parsed.capture, taskId: "fixture:complete-single" } };
  const result = inspect1688CaptureReplay({ capture: replayParsed.capture, parsed: replayParsed, html });
  assert.equal(result.status, "replayable");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.execution, "offline_only");
  assert.equal(result.evidence.rawContentStored, false);
});

test("offline capture replay blocks mismatched snapshot or task identity", async () => {
  const root = path.join(process.cwd(), "test", "fixtures", "1688", "complete-single");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  const html = await fs.readFile(path.join(root, "page.html"), "utf8");
  const parsed = parse1688Product({ url: manifest.url, html, hints: manifest.hints });
  const replayParsed = { ...parsed, capture: { ...parsed.capture, taskId: "fixture:complete-single" } };
  const result = inspect1688CaptureReplay({
    capture: { ...replayParsed.capture, taskId: "wrong-task" },
    parsed: replayParsed,
    html: `${html}\nchanged`,
  });
  assert.equal(result.status, "needs_review");
  assert.ok(result.blockers.includes("CAPTURE_TASK_ID_MISMATCH"));
  assert.ok(result.blockers.includes("CAPTURE_SNAPSHOT_HASH_MISMATCH"));
});

test("capture import requires explicit review of the exact snapshot hash", async () => {
  const root = path.join(process.cwd(), "test", "fixtures", "1688", "complete-single");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  const html = await fs.readFile(path.join(root, "page.html"), "utf8");
  const parsed = parse1688Product({ url: manifest.url, html, hints: manifest.hints });
  const pending = build1688CaptureImportReview({ parsed });
  assert.equal(pending.status, "needs_review");
  assert.ok(pending.blockers.includes("CAPTURE_HUMAN_REVIEW_REQUIRED"));
  const approved = build1688CaptureImportReview({
    parsed,
    captureReview: { humanConfirmed: true, reviewedSnapshotHash: parsed.sourceEvidence.snapshotHash },
  });
  assert.equal(approved.status, "approved");
  assert.deepEqual(approved.blockers, []);
});

test("capture import rejects an offer id that does not belong to the canonical source URL", () => {
  const hash = `sha256:${"b".repeat(64)}`;
  const result = build1688CaptureImportReview({
    parsed: {
      url: "https://detail.1688.com/offer/222222.html",
      sourceEvidence: {
        offerId: "111111",
        canonicalUrl: "https://detail.1688.com/offer/222222.html",
        snapshotHash: hash,
        verificationState: "ok",
      },
    },
    captureReview: { humanConfirmed: true, reviewedSnapshotHash: hash },
  });
  assert.equal(result.status, "needs_review");
  assert.ok(result.blockers.includes("CAPTURE_OFFER_URL_MISMATCH"));
});

test("capture import blocks a duplicate offer before draft creation", async () => {
  const parsed = { url: "https://detail.1688.com/offer/123456.html", sourceEvidence: { offerId: "123456", canonicalUrl: "https://detail.1688.com/offer/123456.html", snapshotHash: `sha256:${"a".repeat(64)}` } };
  const result = build1688CaptureImportReview({
    parsed,
    captureReview: { humanConfirmed: true, reviewedSnapshotHash: parsed.sourceEvidence.snapshotHash },
    existingCandidates: [{ id: "existing", url: parsed.url, parsed }],
    candidateId: "new",
  });
  assert.equal(result.status, "duplicate");
  assert.ok(result.blockers.includes("CAPTURE_DUPLICATE_OFFER"));
  assert.equal(result.duplicateId, "existing");
});

test("capture import blocks a non-1688 source or missing offer identity before draft creation", () => {
  const hash = `sha256:${"c".repeat(64)}`;
  const result = build1688CaptureImportReview({
    parsed: { url: "https://example.com/product/1", sourceEvidence: { snapshotHash: hash } },
    captureReview: { humanConfirmed: true, reviewedSnapshotHash: hash },
  });
  assert.equal(result.status, "needs_review");
  assert.ok(result.blockers.includes("CAPTURE_SOURCE_URL_INVALID"));
  assert.ok(result.blockers.includes("CAPTURE_OFFER_ID_MISSING"));
  assert.match(result.nextAction, /确认同一 SHA-256/);
});

test("capture import does not promote an unverified source snapshot after human approval", () => {
  const hash = `sha256:${"f".repeat(64)}`;
  const result = build1688CaptureImportReview({
    parsed: {
      url: "https://detail.1688.com/offer/456789.html",
      sourceEvidence: {
        offerId: "456789",
        canonicalUrl: "https://detail.1688.com/offer/456789.html",
        snapshotHash: hash,
        verificationState: "waiting_human",
      },
    },
    captureReview: { humanConfirmed: true, reviewedSnapshotHash: hash },
  });
  assert.equal(result.status, "needs_review");
  assert.ok(result.blockers.includes("CAPTURE_SOURCE_EVIDENCE_UNVERIFIED"));
});

test("capture import rejects an approval explicitly invalidated after candidate edits", () => {
  const hash = `sha256:${"d".repeat(64)}`;
  const parsed = {
    url: "https://detail.1688.com/offer/987654.html",
    sourceEvidence: { offerId: "987654", canonicalUrl: "https://detail.1688.com/offer/987654.html", snapshotHash: hash },
  };
  const result = build1688CaptureImportReview({
    parsed,
    captureReview: {
      status: "stale",
      humanConfirmed: true,
      reviewedSnapshotHash: hash,
      invalidatedAt: "2026-07-17T10:00:00.000Z",
    },
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.reviewInvalidated, true);
  assert.ok(result.blockers.includes("CAPTURE_REVIEW_INVALIDATED"));
  assert.equal(result.nextAction, "核对当前快照并由人工确认同一 SHA-256 后再生成草稿");
});

test("capture fixture replay emits auditable hashes without retaining page content", async () => {
  const root = path.join(process.cwd(), "test", "fixtures", "1688", "complete-single");
  const manifestBytes = await fs.readFile(path.join(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestBytes);
  const html = await fs.readFile(path.join(root, "page.html"), "utf8");
  const result = replay1688CaptureFixture({ fixtureName: "complete-single", manifest, manifestBytes, html });
  assert.equal(result.ok, true);
  assert.equal(result.fixtureEvidence.fixtureKind, "synthetic_redacted_replay");
  assert.equal(result.fixtureEvidence.captureOrigin, "synthetic_fixture");
  assert.match(result.fixtureEvidence.manifestHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.fixtureEvidence.pageHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.replay.execution, "offline_only");
  assert.equal(result.replay.evidence.rawContentStored, false);
  assert.equal(result.parsed.sourceEvidence.snapshotHash, result.fixtureEvidence.pageHash);
  assert.equal(Object.hasOwn(result.fixtureEvidence, "html"), false);
});

test("capture fixture replay refuses incomplete provenance before parsing", () => {
  const result = replay1688CaptureFixture({ fixtureName: "untrusted", manifest: { url: "https://detail.1688.com/offer/1.html" }, html: "<html>" });
  assert.equal(result.ok, false);
  assert.ok(result.provenanceWarnings.includes("FIXTURE_KIND_UNSUPPORTED"));
  assert.ok(result.provenanceWarnings.includes("FIXTURE_PROVENANCE_INCOMPLETE"));
  assert.equal(result.parsed, null);
  assert.equal(result.replay, null);
});
