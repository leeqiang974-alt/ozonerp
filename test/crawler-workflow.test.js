import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const tmpDir = path.join(process.cwd(), "data", "crawler-workflow-test");
const workflowFile = path.join(tmpDir, "workflow-runs.json");

async function reset() {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.CRAWLER1688_DATA_DIR = tmpDir;
  process.env.WORKFLOW_RUNS_FILE = workflowFile;
}

test("1688 crawler task and parsed candidate are written to workflow nodes", async () => {
  await reset();
  const suffix = Date.now();
  const crawler = await import(`../src/crawler1688.js?crawler_workflow_${suffix}`);
  const workflow = await import(`../src/workflowRuns.js?crawler_workflow_${suffix}`);

  const created = await crawler.createCrawlerTask({
    sourceType: "search_url",
    sourceValue: "https://detail.1688.com/offer/123456.html",
    options: { mustHaveSku: true, mustHaveSizeWeight: true, smallItemOnly: false },
  });

  let runs = await workflow.listWorkflowRuns();
  let run = runs.items.find((item) => item.entity?.crawlerTaskId === created.task.id);
  assert.ok(run);
  assert.equal(run.source, "crawler_1688");
  assert.equal(run.nodes.find((node) => node.key === "crawler_1688")?.status, "running");

  const job = await crawler.claimCrawlerExtensionJob("worker-test");
  assert.equal(job.kind, "detail");
  const captureResult = await crawler.completeCrawlerExtensionDetail(job.id, {
    url: job.url,
    html: "<html><title>宠物饮水机</title></html>",
    title: "宠物饮水机",
    images: [
      "https://img.example.com/1.jpg",
      "https://img.example.com/2.jpg",
      "https://img.example.com/3.jpg",
    ],
    skuVariants: [{ name: "白色", price: 12.5 }],
    packageInfo: {
      weightG: 300,
      lengthMm: 120,
      widthMm: 100,
      heightMm: 80,
    },
  });
  assert.equal(captureResult.candidate.sourceEvidence.verificationState, "ok");
  assert.equal(captureResult.candidate.parsed.capture.taskId, created.task.id);
  assert.equal(captureResult.candidate.parsed.capture.offerId, "123456");
  assert.match(captureResult.candidate.parsed.capture.collectedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(captureResult.candidate.parsed.capture.captureMode, "extension_browser");
  assert.equal(captureResult.candidate.sourceEvidenceSummary.status, "needs_review");
  assert.match(captureResult.candidate.sourceEvidenceSummary.nextAction, /补齐来源字段/);
  assert.deepEqual(captureResult.candidate.sourceEvidenceSummary.sideEffects, ["不会提交 Ozon", "不会修改价格", "不会写入库存"]);

  runs = await workflow.listWorkflowRuns();
  run = runs.items.find((item) => item.entity?.crawlerTaskId === created.task.id);
  const parseNode = run.nodes.find((node) => node.key === "candidate_parse");
  assert.equal(parseNode.status, "success");
  assert.equal(parseNode.output.candidateCount, 1);
  assert.equal(parseNode.output.acceptedCount, 1);
  assert.equal(parseNode.output.candidate.title, "宠物饮水机");
  assert.equal(parseNode.output.candidate.skuCount, 1);
});

test("1688 extension workers cannot claim or complete another store job", async () => {
  await reset();
  const suffix = Date.now() + "_worker_scope";
  const crawler = await import(`../src/crawler1688.js?crawler_worker_scope_${suffix}`);
  const created = await crawler.createCrawlerTask({
    storeId: "store-a",
    sourceType: "search_url",
    sourceValue: "https://detail.1688.com/offer/923456.html",
    options: { mustHaveSku: false, mustHaveSizeWeight: false, smallItemOnly: false },
  });
  assert.equal(await crawler.claimCrawlerExtensionJob("worker-b", { storeId: "store-b" }), null);
  const job = await crawler.claimCrawlerExtensionJob("worker-a", { storeId: "store-a" });
  assert.equal(job.storeId, "store-a");
  const denied = await crawler.completeCrawlerExtensionDetail(job.id, { title: "跨店回写" }, { storeId: "store-b" });
  assert.equal(denied.scopeDenied, true);
  assert.equal(denied.reasonCode, "WORKER_JOB_STORE_ACCESS_DENIED");
  const stillRunning = JSON.parse(await fs.readFile(path.join(tmpDir, "1688-crawler-jobs.json"), "utf8"))
    .items.find((item) => item.id === job.id);
  assert.equal(stillRunning.status, "running");
  assert.equal(created.task.storeId, "store-a");
});

test("1688 crawler rejects a stale extension payload from another task", async () => {
  await reset();
  const suffix = Date.now() + "_task_identity";
  const crawler = await import(`../src/crawler1688.js?crawler_task_identity_${suffix}`);
  const created = await crawler.createCrawlerTask({
    sourceType: "search_url",
    sourceValue: "https://detail.1688.com/offer/923457.html",
    options: { mustHaveSku: false, mustHaveSizeWeight: false, smallItemOnly: false },
  });
  const job = await crawler.claimCrawlerExtensionJob("worker-test");
  const result = await crawler.completeCrawlerExtensionDetail(job.id, {
    taskId: "stale-task-from-previous-tab",
    url: job.url,
    html: "<html><title>不应入候选池</title></html>",
  });
  assert.equal(result.candidate, null);
  assert.equal(result.reasonCode, "CAPTURE_TASK_ID_MISMATCH");
  assert.equal((await crawler.listCrawlerCandidates({ taskId: created.task.id })).length, 0);
  const task = await crawler.getCrawlerTask(created.task.id);
  assert.equal(task.status, "failed");
  assert.match(task.lastError, /任务身份不匹配/);
});

test("worker heartbeat survives restart and keeps principal bindings separate", async () => {
  await reset();
  const suffix = Date.now() + "_worker_heartbeat_principal";
  const crawler = await import(`../src/crawler1688.js?crawler_heartbeat_${suffix}`);
  const first = await crawler.recordCrawlerWorkerHeartbeat({
    workerId: "shared-browser-worker",
    storeId: "store-a",
    principalId: "seller-a",
    principalStoreIds: ["store-a"],
    principalRole: "operator",
    status: "running",
  });
  assert.equal(first.principalId, "seller-a");
  const second = await crawler.recordCrawlerWorkerHeartbeat({
    workerId: "shared-browser-worker",
    storeId: "store-b",
    principalId: "seller-b",
    principalStoreIds: ["store-b"],
    principalRole: "viewer",
    status: "idle",
  });
  assert.equal(second.principalId, "seller-b");

  // Read from the durable file through a fresh module instance: worker
  // ownership must not depend on the process-local lastWorkerState.
  const restarted = await import(`../src/crawler1688.js?crawler_heartbeat_restart_${suffix}`);
  const status = await restarted.getCrawlerWorkerStatus();
  const workers = status.items.filter((item) => item.workerId === "shared-browser-worker");
  assert.equal(workers.length, 2);
  assert.deepEqual(workers.map((item) => item.principalId).sort(), ["seller-a", "seller-b"]);
  assert.deepEqual(workers.find((item) => item.principalId === "seller-a").principalStoreIds, ["store-a"]);
  assert.equal(workers.find((item) => item.principalId === "seller-b").principalRole, "viewer");
  const sellerAStatus = await restarted.getCrawlerWorkerStatus({ principalId: "seller-a", storeIds: ["store-a"] });
  assert.deepEqual(sellerAStatus.items.map((item) => item.principalId), ["seller-a"]);
});

test("editing a captured candidate invalidates its prior local approval", async () => {
  await reset();
  const suffix = Date.now() + "_capture_review_invalidation";
  const crawler = await import(`../src/crawler1688.js?crawler_review_invalidation_${suffix}`);
  const candidateFile = path.join(tmpDir, "1688-crawler-candidates.json");
  const hash = `sha256:${"e".repeat(64)}`;
  const candidate = {
    id: "capture-candidate-1",
    captureId: "capture-1",
    storeId: "store-fixture",
    title: "原商品",
    url: "https://detail.1688.com/offer/456789.html",
    parsed: { url: "https://detail.1688.com/offer/456789.html", sourceEvidence: { snapshotHash: hash } },
    captureReview: { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash },
  };
  await fs.writeFile(candidateFile, JSON.stringify({ items: [candidate] }, null, 2));
  const updated = await crawler.updateCrawlerCandidate(candidate.id, {
    title: "人工修订标题",
    captureReview: { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash },
  }, { storeId: "store-fixture" });
  assert.equal(updated.captureReview.status, "stale");
  assert.equal(updated.captureReview.humanConfirmed, false);
  assert.equal(updated.captureReview.invalidationReason, "candidate_content_changed");
  assert.match(updated.captureReview.invalidatedAt, /^2026-|^20/);
});

test("1688 crawler human verification marks workflow waiting human", async () => {
  await reset();
  const suffix = Date.now() + 1;
  const crawler = await import(`../src/crawler1688.js?crawler_human_${suffix}`);
  const workflow = await import(`../src/workflowRuns.js?crawler_human_${suffix}`);

  const created = await crawler.createCrawlerTask({
    sourceType: "keyword",
    sourceValue: "猫咪饮水机",
  });
  const job = await crawler.claimCrawlerExtensionJob("worker-test");
  await crawler.completeCrawlerExtensionDiscover(job.id, {
    needsHuman: true,
    error: "1688 需要滑块验证",
  });

  const runs = await workflow.listWorkflowRuns();
  const run = runs.items.find((item) => item.entity?.crawlerTaskId === created.task.id);
  const crawlerNode = run.nodes.find((node) => node.key === "crawler_1688");
  assert.equal(run.status, "waiting_human");
  assert.equal(run.locks.waitingHuman, true);
  assert.equal(crawlerNode.status, "failed");
  assert.equal(crawlerNode.output.needsHuman, true);
});

test("1688 crawler ignores a retried completion after the same job was already finalized", async () => {
  await reset();
  const suffix = Date.now() + "_idempotent_completion";
  const crawler = await import(`../src/crawler1688.js?crawler_idempotent_completion_${suffix}`);
  const created = await crawler.createCrawlerTask({
    sourceType: "search_url",
    sourceValue: "https://detail.1688.com/offer/123457.html",
    options: { mustHaveSku: false, mustHaveSizeWeight: false, smallItemOnly: false },
  });
  const job = await crawler.claimCrawlerExtensionJob("worker-test");
  const payload = {
    url: job.url,
    html: "<html><title>幂等候选</title></html>",
    title: "幂等候选",
    images: ["https://img.example.com/idempotent.jpg"],
    skuVariants: [],
    packageInfo: {},
  };
  const first = await crawler.completeCrawlerExtensionDetail(job.id, payload);
  assert.equal(first.duplicate, undefined);
  assert.ok(first.candidate);
  const second = await crawler.completeCrawlerExtensionDetail(job.id, payload);
  assert.equal(second.duplicate, true);
  assert.equal(second.candidate, null);
  assert.equal((await crawler.listCrawlerCandidates({ taskId: created.task.id })).length, 1);
});

test("1688 crawler resume requeues human verification job for extension pickup", async () => {
  const suffix = Date.now() + "_resume";
  const crawler = await import(`../src/crawler1688.js?crawler_human_resume_${suffix}`);
  const created = await crawler.createCrawlerTask({
    sourceType: "keyword",
    sourceValue: "自动喂食器",
    options: { maxProducts: 3, maxPages: 1 },
  });
  const firstJob = await crawler.claimCrawlerExtensionJob("worker-test");
  await crawler.completeCrawlerExtensionDiscover(firstJob.id, {
    needsHuman: true,
    error: "1688 页面需要人工验证",
  });

  const resumed = await crawler.updateCrawlerTaskStatus(created.task.id, "running");
  assert.equal(resumed.requeuedJobs, 1);
  assert.equal((await crawler.getCrawlerTask(created.task.id)).status, "running");
  const nextJob = await crawler.claimCrawlerExtensionJob("worker-test");
  assert.equal(nextJob.id, firstJob.id);
  assert.equal(nextJob.status, "running");
});

test("1688 crawler breadth mode limits detail jobs and stops after accepted candidates", async () => {
  await reset();
  const suffix = Date.now() + 2;
  const crawler = await import(`../src/crawler1688.js?crawler_breadth_${suffix}`);

  const created = await crawler.createCrawlerTask({
    sourceType: "keyword",
    sourceValue: "多类目海选",
    options: {
      maxProducts: 20,
      maxAcceptedCandidates: 2,
      maxDetailJobs: 6,
      mustHaveSku: false,
      mustHaveSizeWeight: false,
      smallItemOnly: false,
    },
  });
  const discoverJob = await crawler.claimCrawlerExtensionJob("worker-test");
  const urls = Array.from({ length: 20 }, (_, index) => `https://detail.1688.com/offer/${900000 + index}.html`);

  const discoverResult = await crawler.completeCrawlerExtensionDiscover(discoverJob.id, { urls });

  assert.equal(discoverResult.urlsCreated, 6);
  let jobs = JSON.parse(await fs.readFile(path.join(tmpDir, "1688-crawler-jobs.json"), "utf8")).items;
  assert.equal(jobs.filter((job) => job.taskId === created.task.id && job.kind === "detail").length, 6);

  for (let i = 0; i < 2; i += 1) {
    const detailJob = await crawler.claimCrawlerExtensionJob("worker-test");
    await crawler.completeCrawlerExtensionDetail(detailJob.id, {
      url: detailJob.url,
      html: `<html><title>合格候选 ${i + 1}</title></html>`,
      title: `合格候选 ${i + 1}`,
      images: ["https://img.example.com/1.jpg"],
      skuVariants: [],
      packageInfo: {},
    });
  }

  jobs = JSON.parse(await fs.readFile(path.join(tmpDir, "1688-crawler-jobs.json"), "utf8")).items;
  assert.equal(jobs.filter((job) => job.taskId === created.task.id && job.kind === "detail" && job.status === "queued").length, 0);
  assert.ok(jobs.filter((job) => job.taskId === created.task.id && job.kind === "detail" && job.status === "paused").length >= 1);
  const task = await crawler.getCrawlerTask(created.task.id);
  assert.equal(task.status, "finished");
  assert.equal(task.progress.candidatesSaved, 2);
});

test("1688 crawler default breadth mode only opens two detail pages per keyword", async () => {
  await reset();
  const suffix = Date.now() + "_default_breadth";
  const crawler = await import(`../src/crawler1688.js?crawler_default_breadth_${suffix}`);

  const created = await crawler.createCrawlerTask({
    sourceType: "keyword",
    sourceValue: "默认海选",
    options: {
      maxProducts: 20,
      mustHaveSku: false,
      mustHaveSizeWeight: false,
      smallItemOnly: false,
    },
  });
  const discoverJob = await crawler.claimCrawlerExtensionJob("worker-test");
  const urls = Array.from({ length: 20 }, (_, index) => `https://detail.1688.com/offer/${910000 + index}.html`);

  const discoverResult = await crawler.completeCrawlerExtensionDiscover(discoverJob.id, { urls });
  const jobs = JSON.parse(await fs.readFile(path.join(tmpDir, "1688-crawler-jobs.json"), "utf8")).items;

  assert.equal(discoverResult.urlsCreated, 2);
  assert.equal(jobs.filter((job) => job.taskId === created.task.id && job.kind === "detail").length, 2);
});

test("1688 crawler candidate repository restores a corrupt primary from its backup", async () => {
  await reset();
  const suffix = Date.now() + "_candidate_recovery";
  const crawler = await import(`../src/crawler1688.js?crawler_candidate_recovery_${suffix}`);
  const candidate = {
    id: "cc_backup_1",
    taskId: "ct_backup_1",
    storeId: "2367028-1",
    status: "pending_review",
    title: "备份候选",
    url: "https://detail.1688.com/offer/998877.html",
    updatedAt: new Date().toISOString(),
  };
  const file = path.join(tmpDir, "1688-crawler-candidates.json");
  await fs.writeFile(`${file}.bak`, JSON.stringify({ items: [candidate] }), "utf8");
  await fs.writeFile(file, "{\"items\":[", "utf8");

  const rows = await crawler.listCrawlerCandidates({ storeId: "2367028-1" });
  assert.deepEqual(rows.map((row) => row.id), [candidate.id]);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).items.map((row) => row.id), [candidate.id]);
});

test("capture to crawler candidate preserves the capture store scope", async () => {
  await reset();
  const suffix = Date.now() + "_capture_store_scope";
  const crawler = await import(`../src/crawler1688.js?crawler_capture_store_scope_${suffix}`);
  const collection = await import(`../src/collectionBox.js?crawler_capture_store_scope_${suffix}`);
  const capture = await collection.addCollectionItem({
    storeId: "2536021-2",
    parsed: {
      source: "1688",
      url: "https://detail.1688.com/offer/887766.html",
      title: "店铺隔离候选",
      skuVariants: [], images: [], attributes: [], sizeWeight: {}, warnings: [],
    },
  });
  const moved = await crawler.moveCaptureToCrawlerCandidate(capture.id, { storeId: "2536021-2" });
  assert.equal(moved.candidate.storeId, "2536021-2");
  assert.equal((await crawler.listCrawlerCandidates({ storeId: "2367028-1" })).length, 0);
  assert.equal((await crawler.listCrawlerCandidates({ storeId: "2536021-2" })).length, 1);
});

test("capture approval survives promotion into candidate listing handoff", async () => {
  await reset();
  const suffix = Date.now() + "_capture_review_handoff";
  const crawler = await import(`../src/crawler1688.js?crawler_capture_review_handoff_${suffix}`);
  const collection = await import(`../src/collectionBox.js?crawler_capture_review_handoff_${suffix}`);
  const hash = `sha256:${"f".repeat(64)}`;
  const capture = await collection.addCollectionItem({
    storeId: "2536021-2",
    parsed: {
      source: "1688",
      url: "https://detail.1688.com/offer/887767.html",
      title: "已确认快照",
      sourceEvidence: {
        platform: "1688",
        canonicalUrl: "https://detail.1688.com/offer/887767.html",
        offerId: "887767",
        snapshotHash: hash,
        verificationState: "ok",
      },
      capture: { taskId: "capture-task", offerId: "887767", url: "https://detail.1688.com/offer/887767.html" },
      captureReview: { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash },
      skuVariants: [], images: [], attributes: [], sizeWeight: {}, warnings: [],
    },
  });
  const reviewed = await collection.updateCollectionItem(capture.id, {
    captureReview: { status: "approved", humanConfirmed: true, reviewedSnapshotHash: hash },
  }, { storeId: "2536021-2" });
  const moved = await crawler.moveCaptureToCrawlerCandidate(reviewed.id, { storeId: "2536021-2" });
  assert.equal(moved.candidate.captureReview.status, "approved");
  assert.equal(moved.candidate.captureReview.reviewedSnapshotHash, hash);
});
