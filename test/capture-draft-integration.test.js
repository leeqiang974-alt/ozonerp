import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const autoListingUrl = pathToFileURL(path.join(projectRoot, "src", "autoListing.js")).href;

function runIsolatedDraftContract(tempDir, operations) {
  const script = `
    process.chdir(${JSON.stringify(tempDir)});
    const { createListingDraftFrom1688Candidate } = await import(${JSON.stringify(autoListingUrl)});
    const results = [];
    for (const operation of ${JSON.stringify(operations)}) {
      results.push(await createListingDraftFrom1688Candidate(operation.id, {
        storeId: operation.storeId || "",
        storeIds: operation.storeIds || [],
        captureReview: operation.captureReview || {},
      }));
    }
    const jobsPath = ${JSON.stringify(path.join(tempDir, "data", "auto-listing-jobs.json"))};
    let jobs = [];
    try { jobs = JSON.parse(await (await import("node:fs/promises")).readFile(jobsPath, "utf8")).items || []; } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    process.stdout.write(JSON.stringify({ results, jobs }));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: tempDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`isolated draft contract failed (${code}): ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(new Error(`invalid contract output: ${error.message}; stderr=${stderr}`)); }
    });
  });
}

function runIsolatedCaptureWorkflowContract(tempDir, operations) {
  const script = `
    process.chdir(${JSON.stringify(tempDir)});
    const { createListingWorkflowFrom1688Capture } = await import(${JSON.stringify(autoListingUrl)});
    const results = [];
    for (const operation of ${JSON.stringify(operations)}) {
      results.push(await createListingWorkflowFrom1688Capture(operation.id, {
        storeId: operation.storeId || "",
        captureReview: operation.captureReview || {},
      }));
    }
    const jobsPath = ${JSON.stringify(path.join(tempDir, "data", "auto-listing-jobs.json"))};
    const jobs = JSON.parse(await (await import("node:fs/promises")).readFile(jobsPath, "utf8")).items || [];
    process.stdout.write(JSON.stringify({ results, jobs }));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: tempDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`isolated capture workflow failed (${code}): ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(new Error(`invalid capture workflow output: ${error.message}; stderr=${stderr}`)); }
    });
  });
}

function candidate(id, hash, offerId = "987654321", storeId = "store-fixture") {
  const url = `https://detail.1688.com/offer/${offerId}.html`;
  return {
    id,
    captureId: `capture-${id}`,
    storeId,
    source: "1688",
    url,
    title: "Fixture product",
    parsed: {
      source: "1688",
      url,
      title: "Fixture product",
      sourceEvidence: {
        platform: "1688",
        offerId,
        canonicalUrl: url,
        snapshotHash: hash,
        verificationState: "ok",
      },
      capture: { taskId: `task-${id}`, offerId, url, captureMode: "detail" },
      skuVariants: [],
      images: [],
    },
  };
}

test("capture-to-draft contract only creates a draft for approved, same-hash capture", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozonerp-capture-draft-"));
  const hash = `sha256:${"a".repeat(64)}`;
  const items = [candidate("approved", hash, "987654321"), candidate("mismatch", hash, "987654322")];
  // Promoting a reviewed capture historically left the approval only inside
  // parsed; the handoff must accept that persisted form too.
  items[0].parsed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash };
  items[1].parsed.sourceEvidence.snapshotHash = `sha256:${"b".repeat(64)}`;
  items.push(candidate("duplicate", hash, "987654323"));
  items.push(candidate("duplicate-existing", hash, "987654323"));
  items.push(candidate("foreign-store", hash, "987654324", "store-other"));
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "1688-crawler-candidates.json"), JSON.stringify({ items }, null, 2));

  const output = await runIsolatedDraftContract(tempDir, [
    { id: "mismatch", captureReview: { humanConfirmed: true, reviewedSnapshotHash: hash } },
    { id: "approved" },
    { id: "duplicate", captureReview: { humanConfirmed: true, reviewedSnapshotHash: hash } },
    { id: "foreign-store", storeIds: ["store-fixture"] },
  ]);
  assert.equal(output.results[0].ok, false);
  assert.equal(output.results[0].reasonCode, "CAPTURE_REVIEW_HASH_MISMATCH");
  assert.equal(output.results[1].ok, true);
  assert.equal(output.results[1].duplicate, false);
  assert.equal(output.results[2].ok, false);
  assert.equal(output.results[2].reasonCode, "CAPTURE_DUPLICATE_OFFER");
  assert.equal(output.results[3].ok, false);
  assert.equal(output.results[3].reasonCode, "1688_CANDIDATE_NOT_FOUND");
  assert.equal(output.jobs.length, 1);
  assert.equal(output.jobs[0].candidateId, "approved");
  assert.equal(output.jobs[0].storeId, "store-fixture");
  assert.equal(output.jobs[0].candidateData.sourceEvidence.snapshotHash, hash);
});

test("capture-to-draft does not reuse a same-URL draft from another store", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozonerp-capture-store-bound-"));
  const hash = `sha256:${"e".repeat(64)}`;
  const first = candidate("store-a-candidate", hash, "99887766", "store-a");
  const second = candidate("store-b-candidate", hash, "99887766", "store-b");
  first.parsed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash };
  second.parsed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash };
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "1688-crawler-candidates.json"), JSON.stringify({ items: [first, second] }, null, 2));
  const output = await runIsolatedDraftContract(tempDir, [
    { id: "store-a-candidate", storeId: "store-a", storeIds: ["store-a"] },
    { id: "store-b-candidate", storeId: "store-b", storeIds: ["store-b"] },
  ]);
  assert.equal(output.results[0].ok, true);
  assert.equal(output.results[0].duplicate, false);
  assert.equal(output.results[1].ok, true);
  assert.equal(output.results[1].duplicate, false);
  assert.equal(output.jobs.length, 2);
  assert.deepEqual(output.jobs.map((job) => job.storeId).sort(), ["store-a", "store-b"]);
});

test("capture preflight reuses the same store-scoped draft instead of duplicating it", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozonerp-capture-workflow-idempotent-"));
  const hash = `sha256:${"f".repeat(64)}`;
  const item = candidate("capture-repeat", hash, "88776655", "store-fixture");
  item.parsed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash };
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "1688-collection-box.json"), JSON.stringify({ items: [{
    id: item.id, storeId: item.storeId, parsed: item.parsed,
  }] }, null, 2));
  const output = await runIsolatedCaptureWorkflowContract(tempDir, [
    { id: item.id, storeId: item.storeId },
    { id: item.id, storeId: item.storeId },
  ]);
  assert.equal(output.results[0].ok, true);
  assert.equal(output.results[0].duplicate, false);
  assert.equal(output.results[1].ok, true);
  assert.equal(output.results[1].duplicate, true);
  assert.equal(output.results[0].job.id, output.results[1].job.id);
  assert.equal(output.jobs.length, 1);
});
