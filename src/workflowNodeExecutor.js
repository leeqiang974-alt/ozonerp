function nodeInput(run = {}, key = "") {
  return (run.nodes || []).find((node) => node.key === key)?.input || {};
}

function requireDep(deps = {}, name = "") {
  if (typeof deps[name] !== "function") throw new Error(`workflowNodeExecutor 缺少依赖: ${name}`);
  return deps[name];
}

const CONTROLLED_CHAIN = ["match_profit", "content_generate", "preflight_check"];
const PAID_AI_CONFIRMATION = "I_CONFIRM_PAID_AI_FOR_CURRENT_PRODUCT";
const PAID_AI_BINDING_KEYS = [
  "workflowRunId",
  "autoListingJobId",
  "captureId",
  "storeId",
  "sourceSnapshotHash",
];

function workflowPaidAiBinding(run = {}) {
  return {
    workflowRunId: String(run.id || "").trim(),
    autoListingJobId: String(run.entity?.autoListingJobId || "").trim(),
    captureId: String(run.entity?.candidateId || "").trim(),
    storeId: String(run.entity?.storeId || "").trim(),
    sourceSnapshotHash: String(run.entity?.sourceEvidence?.snapshotHash || "").trim(),
  };
}

function validatePaidAiAuthorization(run = {}, body = {}) {
  if (body.confirmPaidAi !== true || String(body.confirmation || "") !== PAID_AI_CONFIRMATION) {
    return {
      ok: false,
      reasonCode: "PAID_AI_CONFIRMATION_REQUIRED",
      error: "调用付费 AI 前需要卖家针对当前商品明确确认。",
    };
  }
  const actual = workflowPaidAiBinding(run);
  const expected = body.expectedBinding || {};
  const bindingComplete = PAID_AI_BINDING_KEYS.every((key) => (
    String(actual[key] || "").trim() && String(expected[key] || "").trim()
  ));
  const bindingMatches = bindingComplete && PAID_AI_BINDING_KEYS.every((key) => (
    String(actual[key]) === String(expected[key])
  ));
  if (!bindingMatches) {
    return {
      ok: false,
      reasonCode: "PAID_AI_CONTEXT_STALE",
      error: "当前商品、店铺、来源快照或工作流已变化，系统未调用付费 AI。",
      expectedBinding: expected,
      actualBinding: actual,
    };
  }
  return { ok: true, binding: actual };
}

function validateWorkflowAutomationState(run = {}) {
  if (run.status === "paused" || run.locks?.paused === true) {
    return {
      ok: false,
      reasonCode: "WORKFLOW_PAUSED",
      error: "当前工作流已暂停，系统未继续自动处理。",
    };
  }
  if (run.status === "waiting_human" || run.locks?.waitingHuman === true) {
    return {
      ok: false,
      reasonCode: "WORKFLOW_WAITING_HUMAN",
      error: "当前商品仍有明确的人工阻断，系统未自动解除等待状态。",
    };
  }
  return { ok: true };
}

async function recordControlledStop(runId, nodeKey, denial, deps = {}) {
  const appendWorkflowEvent = requireDep(deps, "appendWorkflowEvent");
  const paidAiCalled = denial.paidAiCalled === true;
  await appendWorkflowEvent(runId, {
    node: nodeKey,
    type: denial.type || "controlled_chain_stopped",
    message: denial.error,
    data: {
      reasonCode: denial.reasonCode,
      submittedToOzon: false,
      paidAiCalled,
    },
  });
  return {
    ...denial,
    ok: false,
    actions: [],
    supported: true,
    completed: false,
    submittedToOzon: false,
    paidAiCalled,
  };
}

async function recordPaidAiDenial(runId, nodeKey, denial, deps = {}) {
  return recordControlledStop(runId, nodeKey, {
    ...denial,
    type: "paid_ai_call_denied",
  }, deps);
}

export async function continueWorkflowNode(runId, nodeKey, body = {}, deps = {}) {
  const getWorkflowRun = requireDep(deps, "getWorkflowRun");
  const retryWorkflowAfterManualFix = requireDep(deps, "retryWorkflowAfterManualFix");
  const appendWorkflowEvent = requireDep(deps, "appendWorkflowEvent");
  const run = await getWorkflowRun(runId);
  if (!run) throw new Error("工作流不存在");

  const key = String(nodeKey || run.currentNode || "").trim();
  if (!key) throw new Error("节点 key 不能为空");
  if (["match_profit", "content_generate"].includes(key)) {
    const workflowState = validateWorkflowAutomationState(run);
    if (!workflowState.ok) return recordControlledStop(runId, key, workflowState, deps);
  }

  const actions = [];
  let result = null;
  let supported = true;

  if (key === "crawler_1688" && run.entity?.crawlerTaskId) {
    const updateCrawlerTaskStatus = requireDep(deps, "updateCrawlerTaskStatus");
    result = await updateCrawlerTaskStatus(run.entity.crawlerTaskId, "running");
    actions.push("crawler_resumed");
  } else if (key === "preflight_check" && run.payloadDraft) {
    const validatePayloadDraft = requireDep(deps, "validatePayloadDraft");
    result = await validatePayloadDraft(runId, {
      validatePaidAiPayloadDraftCurrent: deps.validatePaidAiPayloadDraftCurrent,
    });
    actions.push("payload_draft_validated");
  } else if (key === "match_profit" && run.entity?.autoListingJobId) {
    const authorization = validatePaidAiAuthorization(run, body);
    if (!authorization.ok) return recordPaidAiDenial(runId, key, authorization, deps);
    const rerunAutoListingMatch = requireDep(deps, "rerunAutoListingMatch");
    result = await rerunAutoListingMatch(run.entity.autoListingJobId, {
      expectedBinding: body.expectedBinding,
      expectedEnvironment: body.environment,
    });
    actions.push("match_profit_rerun");
  } else if (key === "content_generate" && run.entity?.autoListingJobId) {
    const authorization = validatePaidAiAuthorization(run, body);
    if (!authorization.ok) return recordPaidAiDenial(runId, key, authorization, deps);
    const rerunAutoListingContent = requireDep(deps, "rerunAutoListingContent");
    result = await rerunAutoListingContent(run.entity.autoListingJobId, {
      expectedBinding: body.expectedBinding,
      expectedEnvironment: body.environment,
    });
    actions.push("content_generate_rerun");
  } else {
    supported = false;
    actions.push("continue_recorded");
  }

  if (result?.ok === false) {
    return recordControlledStop(runId, key, {
      reasonCode: result.reasonCode || "WORKFLOW_NODE_EXECUTION_FAILED",
      error: result.error || "自动处理节点失败，系统已停止后续步骤。",
      result,
      nodeExecuted: true,
      paidAiCalled: result.paidAiCalled === true,
    }, deps);
  }
  if (key === "content_generate" && result?.payloadDraftReady !== true) {
    return recordControlledStop(runId, key, {
      reasonCode: "PAYLOAD_DRAFT_REFRESH_REQUIRED",
      error: "AI 内容未形成当前商品的新 Payload 草稿，系统未运行旧草稿预检。",
      result,
      paidAiCalled: result.paidAiCalled === true,
    }, deps);
  }
  if (actions.some((action) => ["match_profit_rerun", "content_generate_rerun"].includes(action))) {
    const afterRun = await getWorkflowRun(runId);
    const afterState = validateWorkflowAutomationState(afterRun);
    if (!afterState.ok) return recordControlledStop(runId, key, {
      ...afterState,
      paidAiCalled: result?.paidAiCalled === true,
    }, deps);
    const afterAuthorization = validatePaidAiAuthorization(afterRun, body);
    if (!afterAuthorization.ok) {
      return recordControlledStop(runId, key, {
        ...afterAuthorization,
        type: "paid_ai_context_changed_after_call",
        paidAiCalled: result?.paidAiCalled === true,
      }, deps);
    }
  }

  const updated = await retryWorkflowAfterManualFix(runId, key, {
    note: body.note || "页面人工选择：从此继续",
    input: body.input || nodeInput(run, key),
    actions,
    result,
    supported,
  });

  await appendWorkflowEvent(runId, {
    node: key,
    type: "continue_requested",
    message: supported
      ? `已执行节点继续动作: ${actions.join(", ")}`
      : "已记录节点继续请求，当前节点尚未接入自动执行器",
    data: { actions, result, supported },
  });

  return { ok: true, run: updated, actions, result, supported };
}

export async function runControlledWorkflowChain(runId, body = {}, deps = {}) {
  const getWorkflowRun = requireDep(deps, "getWorkflowRun");
  const appendWorkflowEvent = requireDep(deps, "appendWorkflowEvent");
  const initialRun = await getWorkflowRun(runId);
  if (!initialRun) throw new Error("工作流不存在");

  const startNode = String(body.startNode || initialRun.currentNode || "match_profit").trim();
  const startIndex = CONTROLLED_CHAIN.includes(startNode) ? CONTROLLED_CHAIN.indexOf(startNode) : 0;
  const chain = CONTROLLED_CHAIN.slice(startIndex);
  const initialState = validateWorkflowAutomationState(initialRun);
  if (!initialState.ok) {
    return recordControlledStop(runId, startNode, initialState, deps);
  }
  const requiresPaidAi = chain.includes("content_generate");
  if (requiresPaidAi) {
    const authorization = validatePaidAiAuthorization(initialRun, body);
    if (!authorization.ok) {
      return recordPaidAiDenial(runId, "content_generate", authorization, deps);
    }
  }
  const steps = [];

  for (const key of chain) {
    const currentRun = await getWorkflowRun(runId);
    const currentState = validateWorkflowAutomationState(currentRun);
    if (!currentState.ok) {
      const denial = await recordControlledStop(runId, key, currentState, deps);
      steps.push({ node: key, ...denial });
      break;
    }
    if (requiresPaidAi) {
      const currentAuthorization = validatePaidAiAuthorization(currentRun, body);
      if (!currentAuthorization.ok) {
        const denial = await recordPaidAiDenial(runId, key, currentAuthorization, deps);
        steps.push({ node: key, ...denial });
        break;
      }
    }
    const step = await continueWorkflowNode(runId, key, {
      note: body.note || "页面人工选择：受控串跑到提交前总闸",
      input: nodeInput(currentRun || initialRun, key),
      confirmPaidAi: body.confirmPaidAi,
      confirmation: body.confirmation,
      expectedBinding: body.expectedBinding,
      environment: body.environment,
    }, deps);
    steps.push({ node: key, ...step });
    if (step.ok === false || !step.supported || step.result?.ok === false) break;
  }

  const actions = steps.flatMap((step) => step.actions || []);
  const finalRun = await getWorkflowRun(runId);
  const reachedPreflight = steps.some((step) => (
    step.node === "preflight_check" && (step.ok !== false || step.nodeExecuted === true)
  ));
  const preflightStepSucceeded = steps.some((step) => (
    step.node === "preflight_check" && step.ok !== false && step.result?.ok !== false
  ));
  const draftHash = String(finalRun?.payloadDraftHash || "").trim();
  const validatedDraftHash = String(
    finalRun?.validatedDraftHash
    || finalRun?.payloadDraftValidation?.draftHash
    || "",
  ).trim();
  const preflightPassed = reachedPreflight
    && preflightStepSucceeded
    && finalRun?.payloadDraftValidation?.ok === true
    && Boolean(draftHash)
    && draftHash === validatedDraftHash;
  const completed = preflightPassed;
  await appendWorkflowEvent(runId, {
    node: steps.at(-1)?.node || startNode,
    type: "controlled_chain_completed",
    message: completed
      ? "受控链路已执行到提交前总闸，未触发 Ozon 提交"
      : "受控链路已停止，未触发 Ozon 提交",
    data: {
      actions,
      reachedPreflight,
      preflightPassed,
      draftHash,
      validatedDraftHash,
      submittedToOzon: false,
      steps: steps.map((step) => ({
        node: step.node,
        actions: step.actions,
        supported: step.supported,
        ok: step.ok,
      })),
    },
  });

  return {
    ok: true,
    actions,
    steps,
    reachedPreflight,
    preflightPassed,
    draftHash,
    validatedDraftHash,
    completed,
    submittedToOzon: false,
  };
}
