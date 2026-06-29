import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const tmpDir = path.join(process.cwd(), "data", "ozon-learning-workflow-test");
const workflowFile = path.join(tmpDir, "workflow-runs.json");

async function reset() {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  process.env.OZON_LEARNING_DATA_DIR = tmpDir;
  process.env.WORKFLOW_RUNS_FILE = workflowFile;
}

test("Ozon learning search task writes sampled workflow node", async () => {
  await reset();
  const suffix = Date.now();
  const ozonLearning = await import(`../src/ozonLearning.js?ozon_workflow_${suffix}`);
  const workflow = await import(`../src/workflowRuns.js?ozon_workflow_${suffix}`);

  const created = await ozonLearning.createOzonLearningTask({
    sourceType: "keyword",
    sourceValue: "поилка для кошек",
    maxProducts: 5,
    detailSampleSize: 2,
  });
  const job = await ozonLearning.claimOzonLearningJob("worker-test");
  await ozonLearning.completeOzonSearchJob(job.id, {
    items: [
      { title: "Автоматическая поилка", url: "https://ozon.ru/product/1", price: 1200, category: "Зоотовары" },
      { title: "Фонтан для кошек", url: "https://ozon.ru/product/2", price: 900, category: "Зоотовары" },
    ],
  });

  const runs = await workflow.listWorkflowRuns();
  const run = runs.items.find((item) => item.entity?.ozonLearningTaskId === created.task.id);
  assert.ok(run);
  assert.equal(run.source, "ozon_learning");
  const node = run.nodes.find((item) => item.key === "ozon_learning");
  assert.equal(node.status, "success");
  assert.equal(node.output.sourceValue, "поилка для кошек");
  assert.equal(node.output.totalFound, 2);
  assert.equal(node.output.detailQueued, 2);
  assert.equal(node.output.priceMinRub, 900);
  assert.equal(node.output.categoryCounts["Зоотовары"], 2);
});

test("Ozon learning human verification marks workflow waiting human", async () => {
  await reset();
  const suffix = Date.now() + 1;
  const ozonLearning = await import(`../src/ozonLearning.js?ozon_human_${suffix}`);
  const workflow = await import(`../src/workflowRuns.js?ozon_human_${suffix}`);

  const created = await ozonLearning.createOzonLearningTask({
    sourceType: "keyword",
    sourceValue: "товары для кошек",
  });
  const job = await ozonLearning.claimOzonLearningJob("worker-test");
  await ozonLearning.completeOzonSearchJob(job.id, {
    needsHuman: true,
    error: "Ozon просит подтвердить вход",
  });

  const runs = await workflow.listWorkflowRuns();
  const run = runs.items.find((item) => item.entity?.ozonLearningTaskId === created.task.id);
  const node = run.nodes.find((item) => item.key === "ozon_learning");
  assert.equal(run.status, "waiting_human");
  assert.equal(run.locks.waitingHuman, true);
  assert.equal(node.status, "failed");
  assert.equal(node.output.needsHuman, true);
});
