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
  await crawler.completeCrawlerExtensionDetail(job.id, {
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

  runs = await workflow.listWorkflowRuns();
  run = runs.items.find((item) => item.entity?.crawlerTaskId === created.task.id);
  const parseNode = run.nodes.find((node) => node.key === "candidate_parse");
  assert.equal(parseNode.status, "success");
  assert.equal(parseNode.output.candidateCount, 1);
  assert.equal(parseNode.output.acceptedCount, 1);
  assert.equal(parseNode.output.candidate.title, "宠物饮水机");
  assert.equal(parseNode.output.candidate.skuCount, 1);
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
