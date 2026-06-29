import test from "node:test";
import assert from "node:assert/strict";
import { continueWorkflowNode, runControlledWorkflowChain } from "../src/workflowNodeExecutor.js";

function fakeDeps(run) {
  const calls = [];
  return {
    calls,
    getWorkflowRun: async () => run,
    updateCrawlerTaskStatus: async (taskId, status) => {
      calls.push(["updateCrawlerTaskStatus", taskId, status]);
      return { id: taskId, status };
    },
    validatePayloadDraft: async (runId) => {
      calls.push(["validatePayloadDraft", runId]);
      return { ok: true, issues: [] };
    },
    rerunAutoListingMatch: async (autoListingJobId) => {
      calls.push(["rerunAutoListingMatch", autoListingJobId]);
      return { ok: true, jobId: autoListingJobId, matched: true };
    },
    rerunAutoListingContent: async (autoListingJobId) => {
      calls.push(["rerunAutoListingContent", autoListingJobId]);
      return { ok: true, jobId: autoListingJobId, contentReady: true };
    },
    retryWorkflowAfterManualFix: async (runId, nodeKey, data) => {
      calls.push(["retryWorkflowAfterManualFix", runId, nodeKey, data]);
      return { ...run, id: runId, status: "running", currentNode: nodeKey };
    },
    appendWorkflowEvent: async (runId, event) => {
      calls.push(["appendWorkflowEvent", runId, event]);
      return { ...run, id: runId, events: [...(run.events || []), event] };
    },
  };
}

test("continueWorkflowNode resumes bound 1688 crawler task", async () => {
  const run = {
    id: "wr_continue_crawler",
    currentNode: "crawler_1688",
    entity: { crawlerTaskId: "ct_1" },
    nodes: [{ key: "crawler_1688", input: { keyword: "宠物饮水机" } }],
  };
  const deps = fakeDeps(run);

  const result = await continueWorkflowNode(run.id, "crawler_1688", { note: "继续采集" }, deps);

  assert.deepEqual(result.actions, ["crawler_resumed"]);
  assert.deepEqual(deps.calls[0], ["updateCrawlerTaskStatus", "ct_1", "running"]);
  assert.equal(deps.calls.at(-1)[2].type, "continue_requested");
  assert.match(deps.calls.at(-1)[2].message, /crawler_resumed/);
});

test("continueWorkflowNode validates payload draft for preflight gate", async () => {
  const run = {
    id: "wr_continue_preflight",
    currentNode: "preflight_check",
    payloadDraft: { items: [] },
    nodes: [{ key: "preflight_check" }],
  };
  const deps = fakeDeps(run);

  const result = await continueWorkflowNode(run.id, "preflight_check", {}, deps);

  assert.deepEqual(result.actions, ["payload_draft_validated"]);
  assert.deepEqual(deps.calls[0], ["validatePayloadDraft", run.id]);
  assert.equal(deps.calls.at(-1)[2].type, "continue_requested");
});

test("continueWorkflowNode records unsupported nodes without unsafe side effects", async () => {
  const run = {
    id: "wr_continue_match",
    currentNode: "match_profit",
    nodes: [{ key: "match_profit", input: { candidateId: "c1" } }],
  };
  const deps = fakeDeps(run);

  const result = await continueWorkflowNode(run.id, "match_profit", {}, deps);

  assert.deepEqual(result.actions, ["continue_recorded"]);
  assert.equal(deps.calls.some(([name]) => name === "updateCrawlerTaskStatus"), false);
  assert.equal(deps.calls.some(([name]) => name === "validatePayloadDraft"), false);
  assert.equal(deps.calls.at(-1)[2].data.supported, false);
});

test("continueWorkflowNode reruns match profit when auto listing job is bound", async () => {
  const run = {
    id: "wr_continue_match",
    currentNode: "match_profit",
    entity: { autoListingJobId: "al_1" },
    nodes: [{ key: "match_profit", input: { candidateCount: 3 } }],
  };
  const deps = fakeDeps(run);

  const result = await continueWorkflowNode(run.id, "match_profit", {}, deps);

  assert.deepEqual(result.actions, ["match_profit_rerun"]);
  assert.deepEqual(deps.calls[0], ["rerunAutoListingMatch", "al_1"]);
  assert.equal(deps.calls.at(-1)[2].data.supported, true);
});

test("continueWorkflowNode reruns content generation when auto listing job is bound", async () => {
  const run = {
    id: "wr_continue_content",
    currentNode: "content_generate",
    entity: { autoListingJobId: "al_2" },
    nodes: [{ key: "content_generate", input: { bestMatch: "c1" } }],
  };
  const deps = fakeDeps(run);

  const result = await continueWorkflowNode(run.id, "content_generate", {}, deps);

  assert.deepEqual(result.actions, ["content_generate_rerun"]);
  assert.deepEqual(deps.calls[0], ["rerunAutoListingContent", "al_2"]);
  assert.equal(deps.calls.at(-1)[2].data.supported, true);
});

test("runControlledWorkflowChain executes match content and preflight without Ozon submit", async () => {
  const run = {
    id: "wr_chain",
    currentNode: "match_profit",
    entity: { autoListingJobId: "al_chain" },
    payloadDraft: { items: [{ offer_id: "SKU1", name: "Title" }] },
    nodes: [
      { key: "match_profit", input: { candidateCount: 3 } },
      { key: "content_generate", input: { bestMatch: "c1" } },
      { key: "preflight_check", input: { payloadDraftReady: true } },
    ],
  };
  const deps = fakeDeps(run);

  const result = await runControlledWorkflowChain(run.id, { startNode: "match_profit" }, deps);

  assert.equal(result.ok, true);
  assert.deepEqual(result.actions, ["match_profit_rerun", "content_generate_rerun", "payload_draft_validated"]);
  assert.deepEqual(
    deps.calls
      .filter(([name]) => ["rerunAutoListingMatch", "rerunAutoListingContent", "validatePayloadDraft"].includes(name))
      .map(([name]) => name),
    ["rerunAutoListingMatch", "rerunAutoListingContent", "validatePayloadDraft"],
  );
  assert.equal(deps.calls.some(([name]) => /submit|import/i.test(name)), false);
  assert.equal(deps.calls.at(-1)[2].type, "controlled_chain_completed");
});
