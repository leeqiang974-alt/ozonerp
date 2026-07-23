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

function runIsolatedCaptureWorkflowContract(tempDir, operations, { parallel = false } = {}) {
  const script = `
    process.chdir(${JSON.stringify(tempDir)});
    process.env.WORKFLOW_RUNS_FILE = ${JSON.stringify(path.join(tempDir, "data", "workflow-runs.json"))};
    const { createListingWorkflowFrom1688Capture } = await import(${JSON.stringify(autoListingUrl)});
    const fs = await import("node:fs/promises");
    const results = [];
    const execute = async (operation) => {
      if (operation.replaceParsed) {
        const capturePath = ${JSON.stringify(path.join(tempDir, "data", "1688-collection-box.json"))};
        const collection = JSON.parse(await fs.readFile(capturePath, "utf8"));
        const capture = collection.items.find((entry) => entry.id === operation.id);
        if (!capture) throw new Error("capture replacement target not found");
        capture.parsed = operation.replaceParsed;
        await fs.writeFile(capturePath, JSON.stringify(collection, null, 2));
      }
      return createListingWorkflowFrom1688Capture(operation.id, {
        storeId: operation.storeId || "",
        captureReview: operation.captureReview || {},
      });
    };
    const operations = ${JSON.stringify(operations)};
    if (${JSON.stringify(parallel)}) {
      results.push(...await Promise.all(operations.map(execute)));
    } else {
      for (const operation of operations) results.push(await execute(operation));
    }
    const jobsPath = ${JSON.stringify(path.join(tempDir, "data", "auto-listing-jobs.json"))};
    const jobs = JSON.parse(await (await import("node:fs/promises")).readFile(jobsPath, "utf8")).items || [];
    const workflowPath = ${JSON.stringify(path.join(tempDir, "data", "workflow-runs.json"))};
    const workflows = JSON.parse(await (await import("node:fs/promises")).readFile(workflowPath, "utf8")).items || [];
    process.stdout.write(JSON.stringify({ results, jobs, workflows }));
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

test("capture workflow persists one seller-facing draft skeleton with unique source SKUs and concentrated blockers", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozonerp-capture-skeleton-"));
  const hash = `sha256:${"9".repeat(64)}`;
  const item = candidate("capture-skeleton", hash, "992997159052", "store-fixture");
  item.parsed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash };
  item.parsed.skuVariants = [
    { skuId: "sku-a", spec: "红色", price: 2.3, image: "https://img.example/a.jpg", weightG: 10 },
    { skuId: "sku-b", spec: "蓝色", price: 2.4, image: "https://img.example/b.jpg", weightG: 11 },
    { skuId: "sku-a", spec: "", price: 2.3, image: "https://img.example/a.jpg" },
    { skuId: "sku-b", spec: "", price: 2.4, image: "https://img.example/b.jpg" },
  ];
  item.parsed.images = ["https://img.example/a.jpg", "https://img.example/b.jpg"];
  item.parsed.attributes = [{ name: "材质", value: "合金" }];
  item.parsed.sourceEvidence.fields = {
    variants: { source: "capture_hint", count: 4 },
    images: { source: "capture_hint", count: 2 },
    supplier: { source: "missing" },
    procurement: { source: "missing" },
    package: { source: "capture_hint", values: { weightG: 1, lengthMm: 1, widthMm: 1, heightMm: 1 } },
  };
  item.parsed.mediaCompliance = { status: "blocked", blockers: [{ code: "MEDIA_OCR_UNKNOWN" }] };
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "1688-collection-box.json"), JSON.stringify({ items: [{
    id: item.id, storeId: item.storeId, parsed: item.parsed,
  }] }, null, 2));

  const output = await runIsolatedCaptureWorkflowContract(tempDir, [
    { id: item.id, storeId: item.storeId },
    { id: item.id, storeId: item.storeId },
  ]);

  const first = output.results[0];
  const repeated = output.results[1];
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(repeated.duplicate, true);
  assert.equal(first.job.id, repeated.job.id);
  assert.equal(first.workflowRunId, repeated.workflowRunId);
  assert.equal(first.draftSkeleton.captureId, item.id);
  assert.equal(first.draftSkeleton.storeId, item.storeId);
  assert.equal(first.draftSkeleton.snapshotHash, hash);
  assert.equal(first.draftSkeleton.rawVariantCount, 4);
  assert.equal(first.draftSkeleton.variantCount, 2);
  assert.equal(first.draftSkeleton.duplicateVariantCount, 2);
  assert.deepEqual(first.draftSkeleton.sourceSkuIds, ["sku-a", "sku-b"]);
  assert.deepEqual(repeated.draftSkeleton, first.draftSkeleton);
  assert.deepEqual(output.jobs[0].candidateData.skuVariants.map((row) => row.skuId), ["sku-a", "sku-b"]);
  assert.deepEqual(output.jobs[0].draftSkeleton, first.draftSkeleton);
  assert.equal(output.workflows.length, 1);
  const handoff = output.workflows[0].nodes.find((node) => node.key === "capture_handoff");
  assert.equal(handoff.status, "success");
  assert.deepEqual(handoff.output.draftSkeleton, first.draftSkeleton);
  assert.ok(first.draftSkeleton.blockers.some((entry) => entry.reasonCode === "DRAFT_SUPPLIER_EVIDENCE_REQUIRED"));
  assert.ok(first.draftSkeleton.blockers.some((entry) => entry.reasonCode === "DRAFT_PROCUREMENT_EVIDENCE_REQUIRED"));
  assert.ok(first.draftSkeleton.blockers.some((entry) => entry.reasonCode === "DRAFT_PACKAGE_EVIDENCE_REQUIRED"));
  assert.ok(first.draftSkeleton.blockers.some((entry) => entry.reasonCode === "DRAFT_MEDIA_REVIEW_REQUIRED"));
  assert.ok(first.draftSkeleton.blockers.some((entry) => entry.reasonCode === "DRAFT_RUSSIAN_CONTENT_REQUIRED"));
  assert.ok(first.draftSkeleton.blockers.some((entry) => entry.reasonCode === "DRAFT_CATEGORY_REQUIRED"));
  assert.match(first.draftSkeleton.sideEffect, /不会调用 Ozon/);
});

test("concurrent capture handoffs reuse one job and one workflow", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozonerp-capture-concurrent-"));
  const hash = `sha256:${"7".repeat(64)}`;
  const item = candidate("capture-concurrent", hash, "77112233", "store-fixture");
  item.parsed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash };
  item.parsed.skuVariants = [{ skuId: "sku-concurrent", spec: "标准款", price: 3.2 }];
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "1688-collection-box.json"), JSON.stringify({ items: [{
    id: item.id, storeId: item.storeId, parsed: item.parsed,
  }] }, null, 2));

  const output = await runIsolatedCaptureWorkflowContract(tempDir, Array.from({ length: 8 }, () => ({
    id: item.id,
    storeId: item.storeId,
  })), { parallel: true });

  assert.equal(output.jobs.length, 1);
  assert.equal(output.workflows.length, 1);
  assert.equal(new Set(output.results.map((result) => result.job.id)).size, 1);
  assert.equal(new Set(output.results.map((result) => result.workflowRunId)).size, 1);
});

test("a newly confirmed capture snapshot refreshes an untouched handoff draft", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozonerp-capture-refresh-"));
  const firstHash = `sha256:${"1".repeat(64)}`;
  const secondHash = `sha256:${"2".repeat(64)}`;
  const item = candidate("capture-refresh", firstHash, "88112233", "store-fixture");
  item.parsed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: firstHash };
  item.parsed.skuVariants = [{ skuId: "sku-old", spec: "旧规格", price: 1 }];
  const refreshed = structuredClone(item.parsed);
  refreshed.sourceEvidence.snapshotHash = secondHash;
  refreshed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: secondHash };
  refreshed.skuVariants = [{ skuId: "sku-new", spec: "新规格", price: 2 }];
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "1688-collection-box.json"), JSON.stringify({ items: [{
    id: item.id, storeId: item.storeId, parsed: item.parsed,
  }] }, null, 2));

  const output = await runIsolatedCaptureWorkflowContract(tempDir, [
    { id: item.id, storeId: item.storeId },
    { id: item.id, storeId: item.storeId, replaceParsed: refreshed },
  ]);

  assert.equal(output.jobs.length, 1);
  assert.equal(output.workflows.length, 1);
  assert.equal(output.results[1].duplicate, true);
  assert.equal(output.results[1].draftSkeleton.snapshotHash, secondHash);
  assert.deepEqual(output.results[1].draftSkeleton.sourceSkuIds, ["sku-new"]);
  assert.equal(output.jobs[0].candidateData.sourceEvidence.snapshotHash, secondHash);
  assert.deepEqual(output.jobs[0].candidateData.skuVariants.map((row) => row.skuId), ["sku-new"]);
});

test("draft skeleton blocks a variant without a traceable source SKU id", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozonerp-capture-missing-sku-id-"));
  const hash = `sha256:${"3".repeat(64)}`;
  const item = candidate("capture-missing-sku-id", hash, "99112233", "store-fixture");
  item.parsed.captureReview = { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash };
  item.parsed.skuVariants = [{ spec: "无来源 ID", image: "https://img.example/no-id.jpg", price: 4 }];
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "1688-collection-box.json"), JSON.stringify({ items: [{
    id: item.id, storeId: item.storeId, parsed: item.parsed,
  }] }, null, 2));

  const output = await runIsolatedCaptureWorkflowContract(tempDir, [{ id: item.id, storeId: item.storeId }]);
  assert.ok(output.results[0].draftSkeleton.blockers.some((entry) => entry.reasonCode === "DRAFT_SOURCE_SKU_BINDING_REQUIRED"));
});
