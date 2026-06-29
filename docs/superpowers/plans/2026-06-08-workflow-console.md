# ERP Workflow Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of the ERP workflow console so 1688 collection, Ozon learning, analysis, listing, review, and stock sync are visible as node-based workflow runs with diagnostics and controlled human intervention.

**Architecture:** Add a workflow observation/control layer around existing JSON-backed modules instead of replacing them. `src/workflowRuns.js` owns `data/workflow-runs.json`, server routes expose run/node/payload operations, `autoListing.js` and `stockQueue.js` emit workflow node updates, and `public/app.js` renders a human-intervention console.

**Tech Stack:** Node.js ESM, Express, JSON file persistence via existing repository patterns, Node built-in test runner, existing vanilla JS frontend in `public/app.js`.

---

## File Structure

- Create: `src/workflowRuns.js`
  - Owns `data/workflow-runs.json`.
  - Provides run CRUD, node upsert, event append, payload draft storage, payload validation, and error diagnosis helpers.
- Modify: `src/server.js`
  - Adds `/api/workflows` routes.
  - Wires payload draft validation and submit endpoints.
- Modify: `src/autoListing.js`
  - Emits workflow nodes for `content_generate`, `preflight_check`, `ozon_submit`, and `review_reconcile`.
  - Reuses existing `completeListing()` and `reconcileSubmittedJobs()` behavior.
- Modify: `src/stockQueue.js`
  - Emits workflow node updates for `stock_sync`.
- Modify: `src/flowSupervisor.js`
  - Includes workflow summary in flow status and respects paused/waiting-human runs when added later.
- Modify: `public/index.html`
  - Adds navigation/container hooks for the Workflow Console.
- Modify: `public/app.js`
  - Adds workflow list, node timeline, node detail panel, payload editor, validation, pause/resume/retry buttons.
- Modify: `public/styles.css`
  - Adds workflow console layout and status styling.
- Test: `test/workflow-runs.test.js`
  - Unit tests for workflow persistence, node updates, diagnostics, payload validation.
- Modify: `test/listing-content-quality.test.js`
  - Adds preflight/payload validation coverage if exported from `autoListing.js`; otherwise keep validation tests in `workflow-runs.test.js`.
- Modify: `test/frontend-static.test.js`
  - Ensures new page hooks exist in static frontend.

---

### Task 1: Workflow Persistence Module

**Files:**
- Create: `src/workflowRuns.js`
- Test: `test/workflow-runs.test.js`

- [ ] **Step 1: Write failing tests for run creation and node upsert**

Add `test/workflow-runs.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createWorkflowRun,
  upsertWorkflowNode,
  appendWorkflowEvent,
  listWorkflowRuns,
  getWorkflowRun,
} from "../src/workflowRuns.js";

const tmpFile = path.join(process.cwd(), "data", "workflow-runs.test.json");

function reset() {
  try { fs.unlinkSync(tmpFile); } catch {}
  process.env.WORKFLOW_RUNS_FILE = tmpFile;
}

test("workflow runs can be created and node status can be updated", async () => {
  reset();
  const run = await createWorkflowRun({
    title: "宠物喂食器",
    source: "auto_listing",
    entity: { autoListingJobId: "al_test", parentSku: "SKUlq00999" },
  });

  assert.match(run.id, /^wr_/);
  assert.equal(run.status, "draft");
  assert.equal(run.currentNode, "");

  const updated = await upsertWorkflowNode(run.id, {
    key: "preflight_check",
    status: "success",
    output: { ok: true },
  });

  assert.equal(updated.currentNode, "preflight_check");
  assert.equal(updated.nodes.find((node) => node.key === "preflight_check")?.status, "success");
  assert.equal((await listWorkflowRuns()).items.length, 1);
  assert.equal((await getWorkflowRun(run.id)).entity.parentSku, "SKUlq00999");
});

test("workflow events append without overwriting nodes", async () => {
  reset();
  const run = await createWorkflowRun({ title: "事件测试" });
  await upsertWorkflowNode(run.id, { key: "ozon_submit", status: "running" });
  const updated = await appendWorkflowEvent(run.id, {
    node: "ozon_submit",
    type: "task_submitted",
    message: "已提交 task",
    data: { taskId: 123 },
  });

  assert.equal(updated.events.length, 1);
  assert.equal(updated.events[0].data.taskId, 123);
  assert.equal(updated.nodes.find((node) => node.key === "ozon_submit")?.status, "running");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test test/workflow-runs.test.js
```

Expected: FAIL because `src/workflowRuns.js` does not exist.

- [ ] **Step 3: Implement workflow persistence**

Create `src/workflowRuns.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

function workflowFile() {
  return process.env.WORKFLOW_RUNS_FILE || path.join(DATA_DIR, "workflow-runs.json");
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return "wr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function readStore() {
  try {
    const raw = await fs.readFile(workflowFile(), "utf8");
    const parsed = JSON.parse(raw || "{}");
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { items: [] };
    throw error;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(workflowFile()), { recursive: true });
  const tmp = `${workflowFile()}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify({ items: store.items || [] }, null, 2));
  await fs.rename(tmp, workflowFile());
}

export async function listWorkflowRuns() {
  const store = await readStore();
  return { items: store.items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))) };
}

export async function getWorkflowRun(id) {
  const store = await readStore();
  return store.items.find((item) => item.id === id) || null;
}

export async function createWorkflowRun(input = {}) {
  const store = await readStore();
  const now = nowIso();
  const run = {
    id: input.id || makeId(),
    source: String(input.source || "manual"),
    status: String(input.status || "draft"),
    currentNode: String(input.currentNode || ""),
    title: String(input.title || ""),
    createdAt: now,
    updatedAt: now,
    entity: input.entity || {},
    nodes: Array.isArray(input.nodes) ? input.nodes : [],
    events: Array.isArray(input.events) ? input.events : [],
    locks: {
      paused: false,
      waitingHuman: false,
      submitLocked: false,
      ...(input.locks || {}),
    },
  };
  store.items.unshift(run);
  await writeStore(store);
  return run;
}

export async function upsertWorkflowNode(runId, nodeInput = {}) {
  const store = await readStore();
  const index = store.items.findIndex((item) => item.id === runId);
  if (index < 0) throw new Error("工作流不存在: " + runId);
  const run = store.items[index];
  const key = String(nodeInput.key || "").trim();
  if (!key) throw new Error("节点 key 不能为空");
  const nodeIndex = (run.nodes || []).findIndex((node) => node.key === key);
  const now = nowIso();
  const nextNode = {
    key,
    name: String(nodeInput.name || key),
    status: String(nodeInput.status || "pending"),
    startedAt: nodeInput.startedAt || (nodeInput.status === "running" ? now : ""),
    finishedAt: nodeInput.finishedAt || (["success", "failed", "waiting_human", "skipped"].includes(String(nodeInput.status)) ? now : ""),
    input: nodeInput.input || {},
    output: nodeInput.output || {},
    error: nodeInput.error || {},
    diagnosis: nodeInput.diagnosis || {},
    actions: Array.isArray(nodeInput.actions) ? nodeInput.actions : [],
  };
  if (nodeIndex >= 0) {
    run.nodes[nodeIndex] = { ...run.nodes[nodeIndex], ...nextNode };
  } else {
    run.nodes = [...(run.nodes || []), nextNode];
  }
  run.currentNode = key;
  run.status = nodeInput.runStatus || run.status;
  run.updatedAt = now;
  store.items[index] = run;
  await writeStore(store);
  return run;
}

export async function appendWorkflowEvent(runId, event = {}) {
  const store = await readStore();
  const index = store.items.findIndex((item) => item.id === runId);
  if (index < 0) throw new Error("工作流不存在: " + runId);
  const run = store.items[index];
  run.events = [...(run.events || []), {
    time: event.time || nowIso(),
    node: String(event.node || ""),
    type: String(event.type || "event"),
    message: String(event.message || ""),
    data: event.data || {},
  }];
  run.updatedAt = nowIso();
  store.items[index] = run;
  await writeStore(store);
  return run;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node --test test/workflow-runs.test.js
```

Expected: PASS.

---

### Task 2: Diagnostics and Payload Validation

**Files:**
- Modify: `src/workflowRuns.js`
- Modify: `test/workflow-runs.test.js`

- [ ] **Step 1: Write failing tests for diagnostics and payload validation**

Append to `test/workflow-runs.test.js`:

```js
import {
  diagnoseWorkflowError,
  validateSubmitPayload,
} from "../src/workflowRuns.js";

test("diagnoseWorkflowError maps Ozon required model attribute to Chinese guidance", () => {
  const diagnosis = diagnoseWorkflowError({
    message: "Название модели (для объединения в одну карточку) - Это обязательное поле",
    attribute_id: 9048,
    attribute_name: "Название модели (для объединения в одну карточку)",
  });

  assert.equal(diagnosis.reasonCode, "ATTRIBUTE_REQUIRED");
  assert.match(diagnosis.messageZh, /模型名称|9048/);
  assert.ok(diagnosis.fixHints.some((hint) => /9048/.test(hint)));
});

test("validateSubmitPayload blocks duplicate offer ids and missing model attribute", () => {
  const result = validateSubmitPayload({
    items: [
      {
        offer_id: "SKU1-red",
        name: "Товар красный",
        description_category_id: 17028673,
        type_id: 95183,
        price: "100",
        images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
        attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }],
      },
      {
        offer_id: "SKU1-red",
        name: "Товар синий",
        description_category_id: 17028673,
        type_id: 95183,
        price: "100",
        images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
        attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_OFFER_ID"));
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_MODEL_NAME"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test test/workflow-runs.test.js
```

Expected: FAIL because exports do not exist.

- [ ] **Step 3: Add diagnosis and validation helpers**

Append to `src/workflowRuns.js`:

```js
function errorText(error = {}) {
  return [
    error.message,
    error.description,
    error.attribute_name,
    error.raw,
    JSON.stringify(error || {}),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function diagnoseWorkflowError(error = {}) {
  const text = errorText(error);
  const attributeId = Number(error.attribute_id || error.attributeId || 0);
  if (attributeId === 9048 || /название модели|model name|型号|模型/.test(text)) {
    return {
      reasonCode: "ATTRIBUTE_REQUIRED",
      severity: "blocking",
      messageZh: "缺少 Ozon 必填属性：9048 Название модели（用于合并到同一张卡片的模型名称）。",
      fixHints: ["补充属性 9048：模型名称", "确认 retry_model 不会删除其它必填属性", "重新校验 payload 后提交"],
    };
  }
  if (attributeId === 4958 || /предназначено для|适用/.test(text)) {
    return {
      reasonCode: "ATTRIBUTE_REQUIRED",
      severity: "blocking",
      messageZh: "缺少 Ozon 必填属性：4958 Предназначено для（适用对象）。",
      fixHints: ["按商品文本补充适用对象", "宠物猫商品优先使用 Для кошек", "重新校验 payload 后提交"],
    };
  }
  if (/категория|тип|category|type/.test(text)) {
    return {
      reasonCode: "CATEGORY_INVALID",
      severity: "blocking",
      messageZh: "Ozon 判断类目或类型与商品不匹配。",
      fixHints: ["重新执行类目匹配", "检查标题和图片是否与 type_id 一致", "必要时人工切换候选类目"],
    };
  }
  return {
    reasonCode: "UNKNOWN",
    severity: "warning",
    messageZh: "未识别的错误，需要查看 Ozon 原文。",
    fixHints: ["查看错误原文", "检查 offer_id、类目、必填属性和图片"],
  };
}

function payloadItems(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : (payload.offer_id ? [payload] : []);
}

function hasAttr(item, id) {
  return (item.attributes || []).some((attr) => Number(attr.id) === Number(id) && Array.isArray(attr.values) && attr.values.length > 0);
}

export function validateSubmitPayload(payload = {}) {
  const items = payloadItems(payload);
  const issues = [];
  if (!items.length) issues.push({ code: "EMPTY_PAYLOAD", message: "payload 没有可提交 item" });
  const seen = new Set();
  for (const item of items) {
    const offerId = String(item.offer_id || "").trim();
    if (!offerId) issues.push({ code: "MISSING_OFFER_ID", message: "缺少 offer_id" });
    if (offerId && seen.has(offerId)) issues.push({ code: "DUPLICATE_OFFER_ID", offerId, message: "offer_id 重复" });
    seen.add(offerId);
    if (!String(item.name || "").trim()) issues.push({ code: "MISSING_NAME", offerId, message: "缺少标题" });
    if (/[\u3400-\u9fff]/.test(String(item.name || ""))) issues.push({ code: "CHINESE_IN_TITLE", offerId, message: "标题含中文" });
    if (!Number(item.description_category_id || 0) || !Number(item.type_id || 0)) issues.push({ code: "MISSING_CATEGORY", offerId, message: "缺少 Ozon 类目或类型" });
    if (!Number(item.price || 0)) issues.push({ code: "MISSING_PRICE", offerId, message: "缺少价格" });
    if (!Array.isArray(item.images) || item.images.length < 3) issues.push({ code: "IMAGES_TOO_FEW", offerId, message: "图片少于 3 张" });
    if (!hasAttr(item, 85)) issues.push({ code: "MISSING_BRAND", offerId, message: "缺少品牌属性 85" });
    if (!hasAttr(item, 9048)) issues.push({ code: "MISSING_MODEL_NAME", offerId, message: "缺少模型名称属性 9048" });
  }
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node --test test/workflow-runs.test.js
```

Expected: PASS.

---

### Task 3: Workflow API Routes

**Files:**
- Modify: `src/server.js`
- Test: `test/workflow-runs.test.js`

- [ ] **Step 1: Write route-level helper tests without starting Express**

Append to `test/workflow-runs.test.js`:

```js
import {
  pauseWorkflowRun,
  resumeWorkflowRun,
  savePayloadDraft,
  validatePayloadDraft,
} from "../src/workflowRuns.js";

test("workflow run can be paused, resumed, and payload draft validated", async () => {
  reset();
  const run = await createWorkflowRun({ title: "草稿校验" });
  const paused = await pauseWorkflowRun(run.id);
  assert.equal(paused.status, "paused");
  assert.equal(paused.locks.paused, true);

  const resumed = await resumeWorkflowRun(run.id);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.locks.paused, false);

  await savePayloadDraft(run.id, {
    offer_id: "SKU1",
    name: "Товар",
    description_category_id: 1,
    type_id: 2,
    price: "10",
    images: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
    attributes: [
      { id: 85, values: [{ value: "Нет бренда" }] },
      { id: 9048, values: [{ value: "SKU1" }] },
    ],
  });
  const validation = await validatePayloadDraft(run.id);
  assert.equal(validation.ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test test/workflow-runs.test.js
```

Expected: FAIL because draft/pause exports do not exist.

- [ ] **Step 3: Implement pause/resume/draft helpers**

Append to `src/workflowRuns.js`:

```js
async function updateRun(runId, updater) {
  const store = await readStore();
  const index = store.items.findIndex((item) => item.id === runId);
  if (index < 0) throw new Error("工作流不存在: " + runId);
  const next = updater({ ...store.items[index] });
  next.updatedAt = nowIso();
  store.items[index] = next;
  await writeStore(store);
  return next;
}

export async function pauseWorkflowRun(runId) {
  return updateRun(runId, (run) => ({
    ...run,
    status: "paused",
    locks: { ...(run.locks || {}), paused: true },
  }));
}

export async function resumeWorkflowRun(runId) {
  return updateRun(runId, (run) => ({
    ...run,
    status: "running",
    locks: { ...(run.locks || {}), paused: false, waitingHuman: false },
  }));
}

export async function savePayloadDraft(runId, payloadDraft) {
  return updateRun(runId, (run) => ({
    ...run,
    payloadDraft,
    payloadDraftValidation: null,
    locks: { ...(run.locks || {}), submitLocked: true },
  }));
}

export async function validatePayloadDraft(runId) {
  return updateRun(runId, (run) => {
    const validation = validateSubmitPayload(run.payloadDraft || {});
    return {
      ...run,
      payloadDraftValidation: validation,
      locks: { ...(run.locks || {}), submitLocked: !validation.ok },
    };
  }).then((run) => run.payloadDraftValidation);
}
```

- [ ] **Step 4: Add Express routes**

Modify `src/server.js` imports:

```js
import {
  listWorkflowRuns,
  getWorkflowRun,
  createWorkflowRun,
  pauseWorkflowRun,
  resumeWorkflowRun,
  upsertWorkflowNode,
  savePayloadDraft,
  validatePayloadDraft,
} from "./workflowRuns.js";
```

Add routes near other ERP/workflow routes:

```js
app.get("/api/workflows", asyncRoute(async (_req, res) => {
  res.json(await listWorkflowRuns());
}));

app.post("/api/workflows", asyncRoute(async (req, res) => {
  res.json(await createWorkflowRun(req.body || {}));
}));

app.get("/api/workflows/:id", asyncRoute(async (req, res) => {
  const run = await getWorkflowRun(req.params.id);
  if (!run) return res.status(404).json({ error: "工作流不存在" });
  res.json(run);
}));

app.post("/api/workflows/:id/pause", asyncRoute(async (req, res) => {
  res.json(await pauseWorkflowRun(req.params.id));
}));

app.post("/api/workflows/:id/resume", asyncRoute(async (req, res) => {
  res.json(await resumeWorkflowRun(req.params.id));
}));

app.post("/api/workflows/:id/nodes/:key/retry", asyncRoute(async (req, res) => {
  res.json(await upsertWorkflowNode(req.params.id, {
    key: req.params.key,
    status: "retrying",
    input: req.body || {},
    runStatus: "running",
  }));
}));

app.put("/api/workflows/:id/payload-draft", asyncRoute(async (req, res) => {
  res.json(await savePayloadDraft(req.params.id, req.body || {}));
}));

app.post("/api/workflows/:id/payload-draft/validate", asyncRoute(async (req, res) => {
  res.json(await validatePayloadDraft(req.params.id));
}));
```

- [ ] **Step 5: Run tests**

Run:

```powershell
node --test test/workflow-runs.test.js
npm test
```

Expected: both PASS.

---

### Task 4: Auto Listing Workflow Integration

**Files:**
- Modify: `src/autoListing.js`
- Modify: `src/workflowRuns.js`
- Test: `test/workflow-runs.test.js`

- [ ] **Step 1: Write failing test for auto-listing run binding**

Append to `test/workflow-runs.test.js`:

```js
import {
  findOrCreateWorkflowForAutoListingJob,
} from "../src/workflowRuns.js";

test("findOrCreateWorkflowForAutoListingJob reuses workflow by autoListingJobId", async () => {
  reset();
  const first = await findOrCreateWorkflowForAutoListingJob({
    id: "al_bind",
    bestMatch: { candidateTitle: "宠物喂食器", candidateUrl: "https://detail.1688.com/offer/1.html" },
    listingResult: { sku: "SKUlq00998", taskId: 123 },
  });
  const second = await findOrCreateWorkflowForAutoListingJob({ id: "al_bind" });

  assert.equal(first.id, second.id);
  assert.equal(second.entity.autoListingJobId, "al_bind");
  assert.equal(second.entity.parentSku, "SKUlq00998");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test test/workflow-runs.test.js
```

Expected: FAIL because binding helper does not exist.

- [ ] **Step 3: Implement binding helper**

Append to `src/workflowRuns.js`:

```js
export async function findOrCreateWorkflowForAutoListingJob(job = {}) {
  const store = await readStore();
  const existing = store.items.find((run) => run.entity?.autoListingJobId === job.id);
  if (existing) {
    const entity = {
      ...(existing.entity || {}),
      autoListingJobId: job.id,
      candidateId: job.bestMatch?.candidateId || job.bestMatch?.id || existing.entity?.candidateId || "",
      parentSku: job.listingResult?.sku || job.pendingParentSku || existing.entity?.parentSku || "",
      taskId: job.listingResult?.taskId || existing.entity?.taskId || "",
      storeId: job.listingResult?.storeId || existing.entity?.storeId || "",
    };
    return updateRun(existing.id, (run) => ({ ...run, entity }));
  }
  return createWorkflowRun({
    source: "auto_listing",
    title: job.bestMatch?.candidateTitle || job.ozonTitle || job.id || "自动上架任务",
    entity: {
      autoListingJobId: job.id,
      candidateId: job.bestMatch?.candidateId || job.bestMatch?.id || "",
      candidateUrl: job.bestMatch?.candidateUrl || job.candidateData?.url || "",
      parentSku: job.listingResult?.sku || job.pendingParentSku || "",
      taskId: job.listingResult?.taskId || "",
      storeId: job.listingResult?.storeId || "",
    },
  });
}
```

- [ ] **Step 4: Emit workflow nodes from `completeListing()`**

Modify `src/autoListing.js` imports:

```js
import {
  findOrCreateWorkflowForAutoListingJob,
  upsertWorkflowNode,
  appendWorkflowEvent,
  diagnoseWorkflowError,
  validateSubmitPayload,
} from "./workflowRuns.js";
```

Inside `completeListing(jobId, storeId)`, after loading `job` and before duplicate check:

```js
var workflowRun = await findOrCreateWorkflowForAutoListingJob(job).catch(function() { return null; });
if (workflowRun) {
  await upsertWorkflowNode(workflowRun.id, {
    key: "ozon_submit",
    name: "Ozon 提交",
    status: "running",
    input: { jobId, storeId },
    runStatus: "running",
  }).catch(function() {});
}
```

Before calling `ozonRequest(store, "/v3/product/import", { items: submitItems })`, add:

```js
if (workflowRun) {
  var payloadForValidation = submitItems.length === 1 ? submitItems[0] : { items: submitItems };
  var preflight = validateSubmitPayload(payloadForValidation);
  await upsertWorkflowNode(workflowRun.id, {
    key: "preflight_check",
    name: "上架前预检",
    status: preflight.ok ? "success" : "failed",
    output: preflight,
    actions: preflight.ok ? ["view_output"] : ["edit_payload", "validate_payload", "auto_fix"],
    runStatus: preflight.ok ? "running" : "waiting_human",
  }).catch(function() {});
}
```

After `importInfo` is available and `importErrors` are calculated:

```js
if (workflowRun) {
  var firstError = importErrors[0] || null;
  await upsertWorkflowNode(workflowRun.id, {
    key: "review_reconcile",
    name: "审核回执",
    status: importErrors.length ? "failed" : "success",
    output: { taskId, importedItems, importWarnings },
    error: firstError || {},
    diagnosis: firstError ? diagnoseWorkflowError(firstError) : {},
    actions: importErrors.length ? ["auto_fix", "edit_payload", "retry_node"] : ["view_output"],
    runStatus: importErrors.length ? "waiting_human" : "running",
  }).catch(function() {});
}
```

After successful `updateJob()` and before return:

```js
if (workflowRun) {
  await appendWorkflowEvent(workflowRun.id, {
    node: "ozon_submit",
    type: "task_submitted",
    message: "已提交 Ozon task " + taskId,
    data: { taskId, parentSku, storeId, offers: submitItems.map((row) => row.offer_id) },
  }).catch(function() {});
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
node --test test/workflow-runs.test.js
npm test
```

Expected: PASS.

---

### Task 5: Stock Queue Workflow Integration

**Files:**
- Modify: `src/stockQueue.js`
- Test: `test/stock-queue.test.js`

- [ ] **Step 1: Add a small exported mapper test**

Modify `test/stock-queue.test.js` to import `workflowStockNodeFromJob` and add:

```js
test("workflowStockNodeFromJob maps stock success to stock_sync node", () => {
  const node = workflowStockNodeFromJob({
    id: "sq1",
    status: "success",
    taskId: 123,
    stocks: [{ offer_id: "SKU1", stock: 100, warehouse_id: 99 }],
  });

  assert.equal(node.key, "stock_sync");
  assert.equal(node.status, "success");
  assert.equal(node.output.taskId, 123);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test test/stock-queue.test.js
```

Expected: FAIL because export does not exist.

- [ ] **Step 3: Implement mapper and optional workflow update**

In `src/stockQueue.js`, add:

```js
export function workflowStockNodeFromJob(job = {}) {
  return {
    key: "stock_sync",
    name: "库存写入",
    status: String(job.status || "") === "success" ? "success" : String(job.status || "") === "failed" ? "failed" : "running",
    output: {
      stockQueueId: job.id,
      taskId: job.taskId,
      stocks: job.stocks || [],
      result: job.result || {},
    },
    error: job.status === "failed" ? { raw: job.lastError || job.error || "" } : {},
    actions: job.status === "failed" ? ["retry_node"] : ["view_output"],
  };
}
```

If `stockQueue.js` can identify workflow by `taskId`, import:

```js
import { listWorkflowRuns, upsertWorkflowNode } from "./workflowRuns.js";
```

Add helper:

```js
async function updateWorkflowStockNode(job) {
  const runs = await listWorkflowRuns().catch(() => ({ items: [] }));
  const run = runs.items.find((item) => String(item.entity?.taskId || "") === String(job.taskId || ""));
  if (!run) return;
  await upsertWorkflowNode(run.id, {
    ...workflowStockNodeFromJob(job),
    runStatus: job.status === "success" ? "live" : job.status === "failed" ? "waiting_human" : "running",
  }).catch(() => {});
}
```

Call `await updateWorkflowStockNode(nextJob)` wherever stock job status is persisted as `success` or `failed`.

- [ ] **Step 4: Run tests**

Run:

```powershell
node --test test/stock-queue.test.js
npm test
```

Expected: PASS.

---

### Task 6: Frontend Hooks and Static Test

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/frontend-static.test.js`

- [ ] **Step 1: Write failing static test**

Modify `test/frontend-static.test.js` and add:

```js
test("frontend exposes workflow console shell", () => {
  const html = readFileSync("public/index.html", "utf8");
  const js = readFileSync("public/app.js", "utf8");

  assert.match(html, /workflow-console/);
  assert.match(js, /loadWorkflowRuns/);
  assert.match(js, /renderWorkflowConsole/);
});
```

If `readFileSync` is not imported, add:

```js
import { readFileSync } from "node:fs";
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test test/frontend-static.test.js
```

Expected: FAIL because hooks do not exist.

- [ ] **Step 3: Add HTML shell**

Modify `public/index.html` to add a nav item/button consistent with existing navigation:

```html
<button class="nav-link" data-view="workflow-console">工作流控制台</button>
```

Add a section near other view sections:

```html
<section id="workflow-console" class="view-panel">
  <div class="workflow-console-layout">
    <aside id="workflow-run-list" class="workflow-run-list"></aside>
    <main id="workflow-node-timeline" class="workflow-node-timeline"></main>
    <aside id="workflow-node-detail" class="workflow-node-detail"></aside>
  </div>
</section>
```

- [ ] **Step 4: Add frontend loading/rendering functions**

Append to `public/app.js`:

```js
async function loadWorkflowRuns() {
  const data = await apiGet("/api/workflows");
  state.workflowRuns = data.items || [];
  renderWorkflowConsole();
}

function workflowStatusLabel(status) {
  const map = {
    draft: "草稿",
    running: "运行中",
    paused: "已暂停",
    waiting_human: "等人工",
    failed: "失败",
    live: "已上线",
    completed: "已完成",
    cancelled: "已取消",
  };
  return map[status] || status || "-";
}

function renderWorkflowConsole() {
  const list = document.getElementById("workflow-run-list");
  const timeline = document.getElementById("workflow-node-timeline");
  const detail = document.getElementById("workflow-node-detail");
  if (!list || !timeline || !detail) return;
  const runs = state.workflowRuns || [];
  const selected = runs.find((run) => run.id === state.selectedWorkflowRunId) || runs[0];
  if (selected) state.selectedWorkflowRunId = selected.id;
  list.innerHTML = runs.map((run) => `
    <button class="workflow-run-card ${selected?.id === run.id ? "active" : ""}" data-workflow-run-id="${run.id}">
      <strong>${escapeHtml(run.title || run.id)}</strong>
      <span>${escapeHtml(workflowStatusLabel(run.status))}</span>
      <small>${escapeHtml(run.entity?.parentSku || "")}</small>
    </button>
  `).join("") || "<p class=\"muted\">暂无工作流</p>";
  timeline.innerHTML = selected ? (selected.nodes || []).map((node) => `
    <button class="workflow-node workflow-node-${escapeHtml(node.status || "pending")}" data-workflow-node-key="${escapeHtml(node.key)}">
      <strong>${escapeHtml(node.name || node.key)}</strong>
      <span>${escapeHtml(workflowStatusLabel(node.status))}</span>
    </button>
  `).join("") : "<p class=\"muted\">请选择工作流</p>";
  const node = selected?.nodes?.find((item) => item.key === state.selectedWorkflowNodeKey) || selected?.nodes?.[0];
  detail.innerHTML = node ? `
    <h3>${escapeHtml(node.name || node.key)}</h3>
    <p>${escapeHtml(node.diagnosis?.messageZh || node.error?.raw || "无错误")}</p>
    <pre>${escapeHtml(JSON.stringify(node.output || {}, null, 2))}</pre>
  ` : "<p class=\"muted\">请选择节点</p>";
}
```

If `apiGet`, `state`, or `escapeHtml` names differ, use the existing equivalents in `public/app.js` and keep the function names `loadWorkflowRuns` and `renderWorkflowConsole`.

- [ ] **Step 5: Add click handlers**

Add to the existing delegated click handler in `public/app.js`:

```js
const workflowRunButton = event.target.closest("[data-workflow-run-id]");
if (workflowRunButton) {
  state.selectedWorkflowRunId = workflowRunButton.dataset.workflowRunId;
  state.selectedWorkflowNodeKey = "";
  renderWorkflowConsole();
  return;
}

const workflowNodeButton = event.target.closest("[data-workflow-node-key]");
if (workflowNodeButton) {
  state.selectedWorkflowNodeKey = workflowNodeButton.dataset.workflowNodeKey;
  renderWorkflowConsole();
  return;
}
```

When switching to the workflow console view, call:

```js
if (view === "workflow-console") loadWorkflowRuns();
```

- [ ] **Step 6: Add CSS**

Append to `public/styles.css`:

```css
.workflow-console-layout {
  display: grid;
  grid-template-columns: 280px minmax(360px, 1fr) 420px;
  gap: 16px;
  align-items: start;
}

.workflow-run-list,
.workflow-node-timeline,
.workflow-node-detail {
  background: var(--panel-bg, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  padding: 12px;
}

.workflow-run-card,
.workflow-node {
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 8px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
}

.workflow-run-card.active,
.workflow-node-success {
  border-color: #16a34a;
}

.workflow-node-failed,
.workflow-node-waiting_human {
  border-color: #dc2626;
}
```

- [ ] **Step 7: Run frontend static test**

Run:

```powershell
node --test test/frontend-static.test.js
npm test
```

Expected: PASS.

---

### Task 7: Payload Draft Editor Actions

**Files:**
- Modify: `public/app.js`
- Modify: `src/server.js`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Add static test for payload editor hooks**

Append to `test/frontend-static.test.js`:

```js
test("frontend exposes workflow payload editor hooks", () => {
  const js = readFileSync("public/app.js", "utf8");
  assert.match(js, /saveWorkflowPayloadDraft/);
  assert.match(js, /validateWorkflowPayloadDraft/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test test/frontend-static.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add payload editor functions**

Append to `public/app.js`:

```js
async function saveWorkflowPayloadDraft(runId, payloadText) {
  const payload = JSON.parse(payloadText);
  await apiPut(`/api/workflows/${encodeURIComponent(runId)}/payload-draft`, payload);
  await loadWorkflowRuns();
}

async function validateWorkflowPayloadDraft(runId) {
  const result = await apiPost(`/api/workflows/${encodeURIComponent(runId)}/payload-draft/validate`, {});
  alert(result.ok ? "Payload 校验通过" : "Payload 校验失败：" + (result.issues || []).map((item) => item.message).join("；"));
  await loadWorkflowRuns();
}
```

If existing helper names are `requestJson` rather than `apiPut/apiPost`, adapt to current `public/app.js` conventions.

- [ ] **Step 4: Render textarea and buttons in node detail**

In `renderWorkflowConsole()`, when selected run has `payloadDraft` or selected node key is `preflight_check`/`ozon_submit`, include:

```js
<textarea id="workflow-payload-editor" class="workflow-payload-editor">${escapeHtml(JSON.stringify(selected.payloadDraft || {}, null, 2))}</textarea>
<button data-workflow-action="save-payload">保存草稿</button>
<button data-workflow-action="validate-payload">校验 payload</button>
```

Add click handling:

```js
const workflowAction = event.target.closest("[data-workflow-action]");
if (workflowAction && state.selectedWorkflowRunId) {
  const action = workflowAction.dataset.workflowAction;
  const editor = document.getElementById("workflow-payload-editor");
  if (action === "save-payload") await saveWorkflowPayloadDraft(state.selectedWorkflowRunId, editor.value);
  if (action === "validate-payload") await validateWorkflowPayloadDraft(state.selectedWorkflowRunId);
  return;
}
```

- [ ] **Step 5: Run static and full tests**

Run:

```powershell
node --test test/frontend-static.test.js
npm test
```

Expected: PASS.

---

### Task 8: Flow Status Summary Integration

**Files:**
- Modify: `src/flowSupervisor.js`
- Test: `test/daily-distributor.test.js` or new `test/flow-supervisor.test.js`

- [ ] **Step 1: Write test for workflow summary helper**

Create `test/flow-supervisor.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeWorkflowRuns } from "../src/flowSupervisor.js";

test("summarizeWorkflowRuns counts waiting-human and failed workflows", () => {
  const summary = summarizeWorkflowRuns([
    { status: "waiting_human" },
    { status: "failed" },
    { status: "live" },
    { status: "waiting_human" },
  ]);

  assert.equal(summary.total, 4);
  assert.equal(summary.waitingHuman, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.live, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test test/flow-supervisor.test.js
```

Expected: FAIL because export does not exist.

- [ ] **Step 3: Implement helper and include in status**

In `src/flowSupervisor.js`, export:

```js
export function summarizeWorkflowRuns(runs = []) {
  return {
    total: runs.length,
    running: runs.filter((run) => run.status === "running").length,
    waitingHuman: runs.filter((run) => run.status === "waiting_human").length,
    failed: runs.filter((run) => run.status === "failed").length,
    live: runs.filter((run) => run.status === "live").length,
    paused: runs.filter((run) => run.status === "paused").length,
  };
}
```

Import `listWorkflowRuns`:

```js
import { listWorkflowRuns } from "./workflowRuns.js";
```

In the status-building function, add:

```js
const workflowRuns = await listWorkflowRuns().catch(() => ({ items: [] }));
```

Return:

```js
workflowRuns: summarizeWorkflowRuns(workflowRuns.items || []),
```

- [ ] **Step 4: Run tests**

Run:

```powershell
node --test test/flow-supervisor.test.js
npm test
```

Expected: PASS.

---

### Task 9: Documentation and Handoff Update

**Files:**
- Modify: `docs/SESSION_HANDOFF.zh-CN.md`
- Existing reference: `docs/workflow-console-design.zh-CN.md`
- Existing plan: `docs/superpowers/plans/2026-06-08-workflow-console.md`

- [ ] **Step 1: Update handoff after implementation**

Append a section:

```markdown
## 2026-06-08 工作流控制台第一版实现

- 新增 `src/workflowRuns.js`
- 新增 `data/workflow-runs.json`
- 新增 `/api/workflows` 系列 API
- 前端新增 `工作流控制台`
- 已接入自动上架节点：`preflight_check`、`ozon_submit`、`review_reconcile`
- 已接入库存节点：`stock_sync`
- Payload 草稿支持保存和校验，人工提交仍需二次确认
- 验证：`npm test`
```

- [ ] **Step 2: Run final verification**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Manual smoke check**

Start server:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 start
```

Open ERP page and verify:

- Navigation shows `工作流控制台`.
- `/api/workflows` returns `{ "items": [] }` or existing runs.
- Creating a run from API appears in the list.
- Payload draft validation returns issues for bad payload.

Stop server if needed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 stop
```

Expected: UI loads without console errors and API routes respond.

---

## Implementation Notes

- Do not delete or replace existing job files in first version.
- Do not introduce a database dependency; JSON persistence is enough for first version.
- Do not auto-submit payload drafts. The submit endpoint can be added now, but it must require validated draft state and an explicit request.
- Keep workflow integration best-effort: if workflow write fails, existing listing flow should continue and log only a non-blocking event.
- Do not run uncontrolled batch listing while implementing this plan.

