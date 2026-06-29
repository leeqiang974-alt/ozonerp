# Payload Draft Submit Safety Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe workflow endpoint that submits a saved payload draft to Ozon only after validation and explicit human confirmation.

**Architecture:** Put gate logic in `src/workflowRuns.js` as a dependency-injected service, expose it from `src/server.js`, and add a small workflow-console action in `public/app.js`. The service reuses existing validation and workflow node/event persistence.

**Tech Stack:** Node.js ESM, Express, built-in `node:test`, static frontend JavaScript.

---

### Task 1: Workflow Service Gate

**Files:**
- Modify: `test/workflow-runs.test.js`
- Modify: `src/workflowRuns.js`

- [x] **Step 1: Write failing tests**

Add tests that import `submitPayloadDraftToOzon`, save valid/invalid drafts, and assert invalid or unconfirmed requests never call the fake Ozon dependency while confirmed valid requests do.

- [x] **Step 2: Run red test**

Run: `node --test test\workflow-runs.test.js`

Expected: fail because `submitPayloadDraftToOzon` is not exported.

- [x] **Step 3: Implement minimal service**

Add `submitPayloadDraftToOzon(runId, input, deps)` to `src/workflowRuns.js`. It loads the run, validates `payloadDraft`, requires `input.confirmSubmit === true`, calls `deps.getStore(storeId)` and `deps.ozonRequest(store, "/v3/product/import", { items })`, then writes `preflight_check`, `ozon_submit`, and `payload_draft_submitted`.

- [x] **Step 4: Run green test**

Run: `node --test test\workflow-runs.test.js`

Expected: pass.

### Task 2: Server Route

**Files:**
- Modify: `test/server-routes.test.js`
- Modify: `src/server.js`

- [x] **Step 1: Write failing static route test**

Assert `src/server.js` imports `submitPayloadDraftToOzon` and exposes `/api/workflows/:id/payload-draft/submit`.

- [x] **Step 2: Run red test**

Run: `node --test test\server-routes.test.js`

Expected: fail because the route does not exist.

- [x] **Step 3: Implement route**

Import `submitPayloadDraftToOzon` and add `POST /api/workflows/:id/payload-draft/submit`, passing `parseBody(req.body)`, `getStore`, and `ozonRequest`.

- [x] **Step 4: Run green test**

Run: `node --test test\server-routes.test.js`

Expected: pass.

### Task 3: Frontend Action

**Files:**
- Modify: `test/frontend-static.test.js`
- Modify: `public/app.js`

- [x] **Step 1: Write failing static frontend test**

Assert the workflow console includes `submit-payload-draft`, `确认提交 Ozon`, and calls `/payload-draft/submit`.

- [x] **Step 2: Run red test**

Run: `node --test test\frontend-static.test.js`

Expected: fail because the UI action is missing.

- [x] **Step 3: Implement UI action**

Add a danger button near payload validation, prompt the user with `confirm()`, save the current editor draft, and call the new endpoint with `{ confirmSubmit: true }`.

- [x] **Step 4: Run green test**

Run: `node --test test\frontend-static.test.js`

Expected: pass.

### Task 4: Documentation And Full Verification

**Files:**
- Modify: `docs/SESSION_HANDOFF.zh-CN.md`

- [x] **Step 1: Update handoff**

Append a 2026-06-12 entry describing the new endpoint, safety rules, and tests.

- [x] **Step 2: Run full tests**

Run: `npm test`

Expected: all tests pass.

- [x] **Step 3: Check runtime status**

Run: `powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 status`

Expected: server remains on port `5178`, distributor state is visible, and no test touched real Ozon.
