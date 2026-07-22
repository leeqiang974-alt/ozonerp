import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("auto-listing media approval persistence is hash-bound and rollback-safe", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "ozonerp-media-persistence-"));
  const dataDir = path.join(workdir, "data");
  const jobFile = path.join(dataDir, "auto-listing-jobs.json");
  const sourceHash = `sha256:${"a".repeat(64)}`;
  const draftHash = `sha256:${"b".repeat(64)}`;
  const assetId = "media:one";
  const approvalDraft = {
    status: "approved_draft",
    expectedDraftHash: draftHash,
    expectedSourceHash: sourceHash,
    assetIds: [assetId],
  };
  const fixture = {
    items: [{
      id: "job-media-persistence",
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
      candidateData: {
        sourceEvidence: { snapshotHash: sourceHash },
        mediaApprovalDraft: approvalDraft,
        mediaAssets: [{ id: assetId, checks: {} }],
      },
    }],
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(jobFile, JSON.stringify(fixture, null, 2), "utf8");
  const moduleUrl = new URL("../src/autoListing.js", import.meta.url).href;
  const script = `
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const api = await import(${JSON.stringify(moduleUrl)});
    const fs = await import("node:fs/promises");
    const before = await fs.readFile("data/auto-listing-jobs.json", "utf8");
    const snapshot = await api.getAutoListingJobSnapshot("job-media-persistence");
    const afterSnapshot = await fs.readFile("data/auto-listing-jobs.json", "utf8");
    const mismatch = await api.saveAutoListingMediaApprovalDraft("job-media-persistence", snapshot.candidateData, "sha256:wrong");
    const publishedCandidate = {
      ...snapshot.candidateData,
      mediaApprovalDraft: { ...snapshot.candidateData.mediaApprovalDraft, status: "published_local" },
      mediaApprovalPublished: { ...snapshot.candidateData.mediaApprovalDraft, status: "published_local" },
      mediaAssets: snapshot.candidateData.mediaAssets.map((asset) => ({
        ...asset,
        checks: { humanApproved: true, approvalBinding: { status: "published_local" } },
      })),
    };
    const binding = {
      expectedDraftHash: ${JSON.stringify(draftHash)},
      expectedSourceHash: ${JSON.stringify(sourceHash)},
      assetIds: [${JSON.stringify(assetId)}],
    };
    const published = await api.publishAutoListingMediaApproval("job-media-persistence", publishedCandidate, binding);
    const rolledBack = await api.rollbackAutoListingMediaApproval("job-media-persistence", { ...binding, reason: "workflow_changed_during_publish" });
    const finalSnapshot = await api.getAutoListingJobSnapshot("job-media-persistence");
    process.stdout.write(JSON.stringify({
      snapshotReadOnly: before === afterSnapshot,
      mismatch,
      published,
      rolledBack,
      publishedStatus: finalSnapshot.candidateData.mediaApprovalPublished.status,
      humanApproved: finalSnapshot.candidateData.mediaAssets[0].checks.humanApproved,
      approvalStatus: finalSnapshot.candidateData.mediaAssets[0].checks.approvalBinding.status,
    }));
  `;
  try {
    const childEnv = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !/(SUPABASE|DATABASE|POSTGRES|PGHOST|PGPORT|PGUSER|PGPASSWORD)/i.test(key)));
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: workdir,
      env: childEnv,
      timeout: 30000,
      windowsHide: true,
    });
    const result = JSON.parse(stdout);
    assert.deepEqual(result, {
      snapshotReadOnly: true,
      mismatch: false,
      published: true,
      rolledBack: true,
      publishedStatus: "stale",
      humanApproved: false,
      approvalStatus: "stale",
    });
    const persisted = JSON.parse(await readFile(jobFile, "utf8"));
    assert.equal(persisted.items.length, 1);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
