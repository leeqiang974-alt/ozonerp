import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse1688Product } from "../src/collector1688.js";
import { replay1688ToOzonPreflight } from "../src/goldenPathReplay.js";

const fixtureName = process.argv[2] || "tier-price-moq";
const root = path.resolve("test", "fixtures", "1688", fixtureName);
try {
  const manifestBytes = await fs.readFile(path.join(root, "manifest.json"));
  const pageBytes = await fs.readFile(path.join(root, "page.html"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const html = pageBytes.toString("utf8");
  const parsed = parse1688Product({ url: manifest.url, html, hints: manifest.hints });
  const result = replay1688ToOzonPreflight(parsed);
  const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  // Keep fixture provenance beside the replay result.  The replay is offline
  // evidence only; without the manifest metadata its JSON output is easy to
  // mistake for a real 1688 capture or an Ozon account observation.
  const fixtureEvidence = {
    evidenceType: "offline_fixture_replay",
    fixtureKind: manifest.fixtureKind || "unspecified",
    synthetic: typeof manifest.synthetic === "boolean" ? manifest.synthetic : null,
    redacted: typeof manifest.redacted === "boolean" ? manifest.redacted : null,
    verificationLevel: manifest.verificationLevel || "unspecified",
    capturedAt: manifest.hints?.capturedAt || null,
    captureMode: manifest.hints?.captureMode || "unspecified",
    validationTargets: Array.isArray(manifest.validationTargets) ? manifest.validationTargets : [],
    manifestHash: sha256(manifestBytes),
    pageHash: sha256(pageBytes),
    sourceSnapshotHash: result.stages?.source?.snapshotHash || null,
  };
  const provenanceWarnings = [];
  if (fixtureEvidence.verificationLevel !== "locally_tested_fixture") provenanceWarnings.push("FIXTURE_VERIFICATION_LEVEL_UNEXPECTED");
  if (fixtureEvidence.synthetic !== true || fixtureEvidence.redacted !== true) provenanceWarnings.push("FIXTURE_PROVENANCE_NOT_EXPLICITLY_SYNTHETIC_REDACTED");
  if (fixtureEvidence.captureMode !== "fixture_replay") provenanceWarnings.push("FIXTURE_CAPTURE_MODE_UNEXPECTED");
  if (!fixtureEvidence.capturedAt || Number.isNaN(new Date(fixtureEvidence.capturedAt).getTime())) provenanceWarnings.push("FIXTURE_CAPTURED_AT_MISSING_OR_INVALID");
  if (fixtureEvidence.pageHash !== fixtureEvidence.sourceSnapshotHash) provenanceWarnings.push("FIXTURE_PAGE_SNAPSHOT_HASH_MISMATCH");
  const moderation = result.stages?.moderation || {};
  if (moderation.evidenceType !== "offline_fixture_replay" || moderation.verificationLevel !== "locally_tested_fixture" || moderation.synthetic !== true || moderation.redacted !== true || moderation.observed !== false) {
    provenanceWarnings.push("MODERATION_PROVENANCE_NOT_EXPLICITLY_OFFLINE");
  }
  if (moderation.offerCount !== Number(result.stages?.draft?.itemCount || 0) || moderation.coveredOfferCount !== 0) {
    provenanceWarnings.push("MODERATION_OFFER_COVERAGE_UNEXPECTED");
  }
  console.log(JSON.stringify({ fixture: fixtureName, fixtureEvidence, provenanceWarnings, ...result }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, fixture: fixtureName, reasonCode: "FIXTURE_REPLAY_FAILED", message: error.message }));
  process.exitCode = 1;
}
