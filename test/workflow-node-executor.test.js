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
    validatePaidAiPayloadDraftCurrent: async (jobId, binding, receipt) => {
      calls.push(["validatePaidAiPayloadDraftCurrent", jobId, binding, receipt]);
      return { ok: true };
    },
    invalidatePayloadDraftValidation: async (runId, reason) => {
      calls.push(["invalidatePayloadDraftValidation", runId, reason]);
      return { ok: true };
    },
    rerunAutoListingMatch: async (autoListingJobId, options = {}) => {
      calls.push(["rerunAutoListingMatch", autoListingJobId, options]);
      return { ok: true, jobId: autoListingJobId, matched: true, paidAiCalled: true };
    },
    rerunAutoListingContent: async (autoListingJobId, options = {}) => {
      calls.push(["rerunAutoListingContent", autoListingJobId, options]);
      return { ok: true, jobId: autoListingJobId, contentReady: true, payloadDraftReady: true, paidAiCalled: true };
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

test("continueWorkflowNode delegates paid AI receipt checking to canonical payload validation", async () => {
  const receipt = {
    version: "paid_ai_content_v1",
    binding: { workflowRunId: "wr_paid_preflight" },
    inputHash: "sha256:old-input",
    contentHash: "sha256:old-content",
  };
  const run = {
    id: "wr_paid_preflight",
    currentNode: "preflight_check",
    entity: { autoListingJobId: "al_paid_preflight" },
    payloadDraft: { items: [], paidAiContentReceipt: receipt },
    nodes: [{ key: "preflight_check" }],
  };
  const deps = fakeDeps(run);
  deps.validatePayloadDraft = async (runId, options = {}) => {
    deps.calls.push(["validatePayloadDraft", runId, options]);
    return options.validatePaidAiPayloadDraftCurrent(
      run.entity.autoListingJobId,
      { workflowRunId: run.id },
      receipt,
    );
  };
  deps.validatePaidAiPayloadDraftCurrent = async (...args) => {
    deps.calls.push(["validatePaidAiPayloadDraftCurrent", ...args]);
    return {
      ok: false,
      reasonCode: "PAID_AI_PAYLOAD_CONTEXT_STALE",
      error: "当前商品输入已变化",
    };
  };

  const result = await continueWorkflowNode(run.id, "preflight_check", {
    expectedBinding: { workflowRunId: run.id },
  }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "PAID_AI_PAYLOAD_CONTEXT_STALE");
  assert.equal(deps.calls.some(([name]) => name === "validatePaidAiPayloadDraftCurrent"), true);
  assert.equal(deps.calls.some(([name]) => name === "retryWorkflowAfterManualFix"), false);
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
    entity: {
      autoListingJobId: "al_1",
      candidateId: "capture_1",
      storeId: "store_1",
      sourceEvidence: { snapshotHash: "sha256:snapshot_1" },
    },
    nodes: [{ key: "match_profit", input: { candidateCount: 3 } }],
  };
  const deps = fakeDeps(run);

  const result = await continueWorkflowNode(run.id, "match_profit", {
    confirmPaidAi: true,
    confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
    expectedBinding: {
      workflowRunId: run.id,
      autoListingJobId: "al_1",
      captureId: "capture_1",
      storeId: "store_1",
      sourceSnapshotHash: "sha256:snapshot_1",
    },
  }, deps);

  assert.deepEqual(result.actions, ["match_profit_rerun"]);
  assert.equal(deps.calls[0][0], "rerunAutoListingMatch");
  assert.equal(deps.calls[0][1], "al_1");
  assert.equal(deps.calls[0][2].expectedBinding.captureId, "capture_1");
  assert.equal(deps.calls.at(-1)[2].data.supported, true);
});

test("continueWorkflowNode reruns content generation when auto listing job is bound", async () => {
  const run = {
    id: "wr_continue_content",
    currentNode: "content_generate",
    entity: {
      autoListingJobId: "al_2",
      candidateId: "capture_2",
      storeId: "store_2",
      sourceEvidence: { snapshotHash: "sha256:snapshot_2" },
    },
    nodes: [{ key: "content_generate", input: { bestMatch: "c1" } }],
  };
  const deps = fakeDeps(run);

  const result = await continueWorkflowNode(run.id, "content_generate", {
    confirmPaidAi: true,
    confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
    expectedBinding: {
      workflowRunId: run.id,
      autoListingJobId: "al_2",
      captureId: "capture_2",
      storeId: "store_2",
      sourceSnapshotHash: "sha256:snapshot_2",
    },
  }, deps);

  assert.deepEqual(result.actions, ["content_generate_rerun"]);
  assert.equal(deps.calls[0][0], "rerunAutoListingContent");
  assert.equal(deps.calls[0][1], "al_2");
  assert.equal(deps.calls[0][2].expectedBinding.captureId, "capture_2");
  assert.equal(deps.calls.at(-1)[2].data.supported, true);
});

test("continueWorkflowNode rejects content generation without exact paid AI authorization", async () => {
  const run = {
    id: "wr_content_guard",
    currentNode: "content_generate",
    entity: {
      autoListingJobId: "al_guard",
      candidateId: "capture_guard",
      storeId: "store_guard",
      sourceEvidence: { snapshotHash: "sha256:guard" },
    },
  };
  const deps = fakeDeps(run);

  const missingConfirmation = await continueWorkflowNode(run.id, "content_generate", {}, deps);
  assert.equal(missingConfirmation.ok, false);
  assert.equal(missingConfirmation.reasonCode, "PAID_AI_CONFIRMATION_REQUIRED");
  assert.equal(deps.calls.some(([name]) => name === "rerunAutoListingContent"), false);

  const staleBinding = await continueWorkflowNode(run.id, "content_generate", {
    confirmPaidAi: true,
    confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
    expectedBinding: {
      workflowRunId: run.id,
      autoListingJobId: "al_guard",
      captureId: "another_capture",
      storeId: "store_guard",
      sourceSnapshotHash: "sha256:guard",
    },
  }, deps);
  assert.equal(staleBinding.ok, false);
  assert.equal(staleBinding.reasonCode, "PAID_AI_CONTEXT_STALE");
  assert.equal(deps.calls.some(([name]) => name === "rerunAutoListingContent"), false);
});

test("continueWorkflowNode rejects match rerun before its optional paid AI matching", async () => {
  const run = {
    id: "wr_match_guard",
    currentNode: "match_profit",
    entity: {
      autoListingJobId: "al_match_guard",
      candidateId: "capture_match_guard",
      storeId: "store_match_guard",
      sourceEvidence: { snapshotHash: "sha256:match_guard" },
    },
  };
  const deps = fakeDeps(run);

  const result = await continueWorkflowNode(run.id, "match_profit", {}, deps);

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "PAID_AI_CONFIRMATION_REQUIRED");
  assert.equal(deps.calls.some(([name]) => name === "rerunAutoListingMatch"), false);
});

test("runControlledWorkflowChain executes match content and preflight without Ozon submit", async () => {
  const run = {
    id: "wr_chain",
    currentNode: "match_profit",
    entity: {
      autoListingJobId: "al_chain",
      candidateId: "capture_chain",
      storeId: "store_chain",
      sourceEvidence: { snapshotHash: "sha256:chain" },
    },
    payloadDraft: { items: [{ offer_id: "SKU1", name: "Title" }] },
    payloadDraftHash: "sha256:draft",
    payloadDraftValidation: { ok: true, draftHash: "sha256:draft", issues: [] },
    nodes: [
      { key: "match_profit", input: { candidateCount: 3 } },
      { key: "content_generate", input: { bestMatch: "c1" } },
      { key: "preflight_check", input: { payloadDraftReady: true } },
    ],
  };
  const deps = fakeDeps(run);

  const result = await runControlledWorkflowChain(run.id, {
    startNode: "match_profit",
    confirmPaidAi: true,
    confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
    expectedBinding: {
      workflowRunId: run.id,
      autoListingJobId: "al_chain",
      captureId: "capture_chain",
      storeId: "store_chain",
      sourceSnapshotHash: "sha256:chain",
    },
  }, deps);

  assert.equal(result.ok, true);
  assert.equal(result.completed, true);
  assert.equal(result.preflightPassed, true);
  assert.equal(result.submittedToOzon, false);
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

test("runControlledWorkflowChain does not call AI when current product binding is stale", async () => {
  const run = {
    id: "wr_stale_chain",
    currentNode: "content_generate",
    entity: {
      autoListingJobId: "al_stale",
      candidateId: "capture_current",
      storeId: "store_current",
      sourceEvidence: { snapshotHash: "sha256:current" },
    },
  };
  const deps = fakeDeps(run);
  const result = await runControlledWorkflowChain(run.id, {
    startNode: "content_generate",
    confirmPaidAi: true,
    confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
    expectedBinding: {
      workflowRunId: run.id,
      autoListingJobId: "al_stale",
      captureId: "capture_old",
      storeId: "store_current",
      sourceSnapshotHash: "sha256:current",
    },
  }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "PAID_AI_CONTEXT_STALE");
  assert.equal(result.completed, false);
  assert.equal(result.submittedToOzon, false);
  assert.equal(deps.calls.some(([name]) => name === "rerunAutoListingContent"), false);
});

test("runControlledWorkflowChain only completes when strong preflight validates the current draft hash", async () => {
  const run = {
    id: "wr_blocked_chain",
    currentNode: "content_generate",
    entity: {
      autoListingJobId: "al_blocked",
      candidateId: "capture_blocked",
      storeId: "store_blocked",
      sourceEvidence: { snapshotHash: "sha256:blocked" },
    },
    payloadDraft: { items: [{ offer_id: "SKU1" }] },
    payloadDraftHash: "sha256:current_draft",
    payloadDraftValidation: {
      ok: false,
      draftHash: "sha256:old_draft",
      issues: [{ code: "TITLE_REQUIRED" }],
    },
    nodes: [{ key: "content_generate" }, { key: "preflight_check" }],
  };
  const deps = fakeDeps(run);
  deps.validatePayloadDraft = async (runId) => {
    deps.calls.push(["validatePayloadDraft", runId]);
    return run.payloadDraftValidation;
  };

  const result = await runControlledWorkflowChain(run.id, {
    startNode: "content_generate",
    confirmPaidAi: true,
    confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
    expectedBinding: {
      workflowRunId: run.id,
      autoListingJobId: "al_blocked",
      captureId: "capture_blocked",
      storeId: "store_blocked",
      sourceSnapshotHash: "sha256:blocked",
    },
  }, deps);

  assert.equal(result.ok, true);
  assert.equal(result.reachedPreflight, true);
  assert.equal(result.preflightPassed, false);
  assert.equal(result.completed, false);
  assert.equal(result.draftHash, "sha256:current_draft");
  assert.equal(result.validatedDraftHash, "sha256:old_draft");
});

test("runControlledWorkflowChain stops when AI content did not refresh the current payload draft", async () => {
  const run = {
    id: "wr_payload_refresh_failed",
    currentNode: "content_generate",
    entity: {
      autoListingJobId: "al_payload_refresh_failed",
      candidateId: "capture_payload_refresh_failed",
      storeId: "store_payload_refresh_failed",
      sourceEvidence: { snapshotHash: "sha256:payload_refresh_failed" },
    },
    payloadDraft: { items: [{ offer_id: "OLD" }] },
    payloadDraftHash: "sha256:old",
    payloadDraftValidation: { ok: true, draftHash: "sha256:old", issues: [] },
    nodes: [{ key: "content_generate" }, { key: "preflight_check" }],
  };
  const deps = fakeDeps(run);
  deps.rerunAutoListingContent = async (jobId) => {
    deps.calls.push(["rerunAutoListingContent", jobId]);
    return {
      ok: true,
      jobId,
      contentReady: true,
      payloadDraftReady: false,
      paidAiCalled: true,
    };
  };

  const result = await runControlledWorkflowChain(run.id, {
    startNode: "content_generate",
    confirmPaidAi: true,
    confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
    expectedBinding: {
      workflowRunId: run.id,
      autoListingJobId: "al_payload_refresh_failed",
      captureId: "capture_payload_refresh_failed",
      storeId: "store_payload_refresh_failed",
      sourceSnapshotHash: "sha256:payload_refresh_failed",
    },
  }, deps);

  assert.equal(result.completed, false);
  assert.equal(result.reachedPreflight, false);
  assert.equal(deps.calls.some(([name]) => name === "validatePayloadDraft"), false);
  assert.equal(deps.calls.some(([name]) => name === "retryWorkflowAfterManualFix"), false);
  const stopEvent = deps.calls.find(([name, , event]) => (
    name === "appendWorkflowEvent" && event.type === "controlled_chain_stopped"
  ))?.[2];
  assert.equal(stopEvent?.data?.paidAiCalled, true);
});

test("runControlledWorkflowChain respects paused and waiting-human locks before paid AI", async () => {
  for (const lockedRun of [
    {
      id: "wr_paused",
      status: "paused",
      locks: { paused: true },
    },
    {
      id: "wr_waiting",
      status: "waiting_human",
      locks: { waitingHuman: true },
    },
  ]) {
    const run = {
      ...lockedRun,
      currentNode: "content_generate",
      entity: {
        autoListingJobId: `al_${lockedRun.id}`,
        candidateId: `capture_${lockedRun.id}`,
        storeId: "store_lock",
        sourceEvidence: { snapshotHash: "sha256:lock" },
      },
    };
    const deps = fakeDeps(run);
    const result = await runControlledWorkflowChain(run.id, {
      startNode: "content_generate",
      confirmPaidAi: true,
      confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
      expectedBinding: {
        workflowRunId: run.id,
        autoListingJobId: run.entity.autoListingJobId,
        captureId: run.entity.candidateId,
        storeId: run.entity.storeId,
        sourceSnapshotHash: run.entity.sourceEvidence.snapshotHash,
      },
    }, deps);

    assert.equal(result.ok, false);
    assert.match(result.reasonCode, /WORKFLOW_(PAUSED|WAITING_HUMAN)/);
    assert.equal(deps.calls.some(([name]) => name === "rerunAutoListingContent"), false);
    assert.equal(deps.calls.some(([name]) => name === "retryWorkflowAfterManualFix"), false);
  }
});

test("continueWorkflowNode does not clear a lock raised while paid AI is running", async () => {
  const unlocked = {
    id: "wr_lock_during_ai",
    status: "running",
    locks: { paused: false, waitingHuman: false },
    currentNode: "content_generate",
    entity: {
      autoListingJobId: "al_lock_during_ai",
      candidateId: "capture_lock_during_ai",
      storeId: "store_lock_during_ai",
      sourceEvidence: { snapshotHash: "sha256:lock_during_ai" },
    },
  };
  const locked = {
    ...unlocked,
    status: "paused",
    locks: { paused: true, waitingHuman: false },
  };
  const deps = fakeDeps(unlocked);
  let reads = 0;
  deps.getWorkflowRun = async () => {
    reads += 1;
    return reads >= 2 ? locked : unlocked;
  };

  const result = await continueWorkflowNode(unlocked.id, "content_generate", {
    confirmPaidAi: true,
    confirmation: "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT",
    expectedBinding: {
      workflowRunId: unlocked.id,
      autoListingJobId: unlocked.entity.autoListingJobId,
      captureId: unlocked.entity.candidateId,
      storeId: unlocked.entity.storeId,
      sourceSnapshotHash: unlocked.entity.sourceEvidence.snapshotHash,
    },
  }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "WORKFLOW_PAUSED");
  assert.equal(result.paidAiCalled, true);
  assert.equal(deps.calls.some(([name]) => name === "retryWorkflowAfterManualFix"), false);
});
