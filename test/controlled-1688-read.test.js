import test from "node:test";
import assert from "node:assert/strict";
import {
  build1688ReadPlan,
  validate1688ReadPlan,
  build1688ReadReceipt,
  validate1688ReadReceipt,
  build1688ReadSellerTask,
} from "../src/controlled1688Read.js";

const plan = build1688ReadPlan({
  taskId: "ct-controlled-1",
  storeId: "store-fixture",
  environment: "1688-browser-fixture",
  scope: { name: "selected-offers", urls: ["https://detail.1688.com/offer/123456.html"], maxProducts: 1 },
});

test("controlled 1688 plan is bound to task/store/scope and remains read-only", () => {
  assert.equal(validate1688ReadPlan(plan).ok, true);
  assert.match(plan.planBinding, /^sha256:[a-f0-9]{64}$/);
  assert.equal(plan.readOnly, true);
  assert.equal(plan.writeAttempted, false);
  assert.equal(validate1688ReadPlan({ ...plan, writeAttempted: true }).ok, false);
  assert.equal(validate1688ReadPlan({ ...plan, scope: { ...plan.scope, maxProducts: 2 } }).ok, false);
});

test("persisted browser payload is server-observed but cannot claim real read verification", () => {
  const receipt = build1688ReadReceipt(plan, {
    status: "success",
    captureMode: "extension_browser",
    observations: [{ offerId: "123456", url: "https://detail.1688.com/offer/123456.html", snapshotHash: `sha256:${"a".repeat(64)}` }],
  }, { persisted: true, persistedAt: "2026-07-17T01:00:00.000Z" });
  assert.equal(receipt.origin, "server_observed");
  assert.equal(receipt.verificationLevel, "server_observed");
  assert.equal(receipt.realReadVerified, false);
  assert.equal(validate1688ReadReceipt(receipt).ok, true);
  assert.match(JSON.stringify(receipt), /不会|server_observed/);
  assert.doesNotMatch(JSON.stringify(receipt), /cookie|token|rawHtml/i);
  const seller = build1688ReadSellerTask(receipt);
  assert.equal(seller.status, "ready");
  assert.match(seller.nextAction, /real_read_verified/);
});

test("human verification remains resumable and blocks source use", () => {
  const receipt = build1688ReadReceipt(plan, { status: "success", waitingHuman: true, humanReason: "captcha", observations: [] }, { persisted: true });
  assert.equal(receipt.status, "waiting_human");
  assert.equal(validate1688ReadReceipt(receipt).ok, true);
  const seller = build1688ReadSellerTask(receipt);
  assert.equal(seller.code, "1688_HUMAN_VERIFICATION_REQUIRED");
  assert.match(seller.nextAction, /恢复采集/);
});

test("client synthetic fixture cannot smuggle real verification", () => {
  const receipt = build1688ReadReceipt(plan, { status: "success", observations: [] });
  assert.equal(receipt.origin, "client_asserted");
  assert.equal(validate1688ReadReceipt({ ...receipt, verificationLevel: "real_read_verified", realReadVerified: true }).ok, false);
});

test("controlled crawler task persists a server-observed receipt without upgrading verification", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "data", `controlled-1688-crawler-${Date.now()}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  process.env.CRAWLER1688_DATA_DIR = dir;
  process.env.WORKFLOW_RUNS_FILE = path.join(dir, "workflow-runs.json");
  const crawler = await import(`../src/crawler1688.js?controlled_receipt_${Date.now()}`);
  const created = await crawler.createCrawlerTask({
    sourceType: "search_url",
    sourceValue: "https://detail.1688.com/offer/777888.html",
    storeId: "store-controlled",
    controlledRead: true,
    options: { mustHaveSku: false, mustHaveSizeWeight: false, smallItemOnly: false },
  });
  const job = await crawler.claimCrawlerExtensionJob("worker-controlled");
  const result = await crawler.completeCrawlerExtensionDetail(job.id, {
    url: job.url,
    html: "<html><title>受控回执候选</title></html>",
    title: "受控回执候选",
    images: ["https://img.example.com/controlled.jpg"],
    skuVariants: [],
    packageInfo: {},
  });
  assert.ok(result.candidate.sourceEvidenceReceipt);
  assert.equal(result.candidate.sourceEvidenceReceipt.origin, "server_observed");
  assert.equal(result.candidate.sourceEvidenceReceipt.realReadVerified, false);
  const task = await crawler.getCrawlerTask(created.task.id, { storeId: "store-controlled" });
  assert.equal(task.controlledReadReceipt.verificationLevel, "server_observed");
  await fs.rm(dir, { recursive: true, force: true });
});

test("controlled crawler challenge HTML pauses instead of creating a synthetic candidate", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "data", `controlled-1688-challenge-${Date.now()}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  process.env.CRAWLER1688_DATA_DIR = dir;
  process.env.WORKFLOW_RUNS_FILE = path.join(dir, "workflow-runs.json");
  const crawler = await import(`../src/crawler1688.js?controlled_challenge_${Date.now()}`);
  const created = await crawler.createCrawlerTask({
    sourceType: "search_url",
    sourceValue: "https://detail.1688.com/offer/888999.html",
    storeId: "store-controlled",
    controlledRead: true,
    options: { mustHaveSku: false, mustHaveSizeWeight: false, smallItemOnly: false },
  });
  const job = await crawler.claimCrawlerExtensionJob("worker-controlled");
  const result = await crawler.completeCrawlerExtensionDetail(job.id, {
    url: job.url,
    html: "<html><title>请完成验证</title><div class='nc-container'>滑块</div></html>",
  });
  assert.equal(result.candidate, null);
  const task = await crawler.getCrawlerTask(created.task.id, { storeId: "store-controlled" });
  assert.equal(task.status, "waiting_human");
  assert.equal(task.controlledReadReceipt.status, "waiting_human");
  assert.equal((await crawler.listCrawlerCandidates({ taskId: created.task.id })).length, 0);
  await fs.rm(dir, { recursive: true, force: true });
});
