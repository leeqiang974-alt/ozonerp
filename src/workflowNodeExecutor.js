function nodeInput(run = {}, key = "") {
  return (run.nodes || []).find((node) => node.key === key)?.input || {};
}

function requireDep(deps = {}, name = "") {
  if (typeof deps[name] !== "function") throw new Error(`workflowNodeExecutor 缺少依赖: ${name}`);
  return deps[name];
}

const CONTROLLED_CHAIN = ["match_profit", "content_generate", "preflight_check"];

export async function continueWorkflowNode(runId, nodeKey, body = {}, deps = {}) {
  const getWorkflowRun = requireDep(deps, "getWorkflowRun");
  const retryWorkflowAfterManualFix = requireDep(deps, "retryWorkflowAfterManualFix");
  const appendWorkflowEvent = requireDep(deps, "appendWorkflowEvent");
  const run = await getWorkflowRun(runId);
  if (!run) throw new Error("工作流不存在");

  const key = String(nodeKey || run.currentNode || "").trim();
  if (!key) throw new Error("节点 key 不能为空");

  const actions = [];
  let result = null;
  let supported = true;

  if (key === "crawler_1688" && run.entity?.crawlerTaskId) {
    const updateCrawlerTaskStatus = requireDep(deps, "updateCrawlerTaskStatus");
    result = await updateCrawlerTaskStatus(run.entity.crawlerTaskId, "running");
    actions.push("crawler_resumed");
  } else if (key === "preflight_check" && run.payloadDraft) {
    const validatePayloadDraft = requireDep(deps, "validatePayloadDraft");
    result = await validatePayloadDraft(runId);
    actions.push("payload_draft_validated");
  } else if (key === "match_profit" && run.entity?.autoListingJobId) {
    const rerunAutoListingMatch = requireDep(deps, "rerunAutoListingMatch");
    result = await rerunAutoListingMatch(run.entity.autoListingJobId);
    actions.push("match_profit_rerun");
  } else if (key === "content_generate" && run.entity?.autoListingJobId) {
    const rerunAutoListingContent = requireDep(deps, "rerunAutoListingContent");
    result = await rerunAutoListingContent(run.entity.autoListingJobId);
    actions.push("content_generate_rerun");
  } else {
    supported = false;
    actions.push("continue_recorded");
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
  const steps = [];

  for (const key of CONTROLLED_CHAIN.slice(startIndex)) {
    const currentRun = await getWorkflowRun(runId);
    const step = await continueWorkflowNode(runId, key, {
      note: body.note || "页面人工选择：受控串跑到提交前总闸",
      input: nodeInput(currentRun || initialRun, key),
    }, deps);
    steps.push({ node: key, ...step });
    if (!step.supported || step.result?.ok === false) break;
  }

  const actions = steps.flatMap((step) => step.actions || []);
  const completed = steps.length > 0 && steps[steps.length - 1]?.node === "preflight_check";
  await appendWorkflowEvent(runId, {
    node: steps.at(-1)?.node || startNode,
    type: "controlled_chain_completed",
    message: completed
      ? "受控链路已执行到提交前总闸，未触发 Ozon 提交"
      : "受控链路已停止，未触发 Ozon 提交",
    data: { actions, steps: steps.map((step) => ({ node: step.node, actions: step.actions, supported: step.supported })) },
  });

  return { ok: true, actions, steps, completed };
}
