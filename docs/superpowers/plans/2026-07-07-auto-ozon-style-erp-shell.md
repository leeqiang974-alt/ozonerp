# Auto-Ozon Style ERP Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the Ozon ERP frontend around an auto-ozon-style ERP shell without changing backend business behavior.

**Architecture:** Keep the existing static SPA files and current view ids. Add an ERP business navigation contract, top status strip, dashboard KPI/table/task presentation, and CSS shell styling while preserving current feature panels and safety gates.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Express static files, `node:test` frontend static contract tests.

---

## File Map

- `test/frontend-static.test.js`: add static contracts for the new ERP shell labels and styling hooks.
- `public/index.html`: update navigation labels/order and dashboard header/KPI/task wording.
- `public/styles.css`: add/adjust shell styling to match the auto-ozon-style preview.
- `public/app.js`: update dashboard status text only if required by tests; preserve view ids and event handlers.
- `docs/SESSION_HANDOFF.zh-CN.md`: record the UI shell stage and verification.

## Task 1: ERP Shell Contract

**Files:**
- Modify: `test/frontend-static.test.js`

- [x] **Step 1: Write failing static test**

Add a test asserting the shell exposes `auto-ozon-style ERP` labels: `数据驾驶舱`, `店铺管理`, `商品管理`, `订单管理`, `仓库库存`, `智能选品`, `上传管理`, `任务配置`, plus CSS hooks `auto-ozon-erp-shell`, `erp-status-strip`, and `erp-dashboard-table`.

- [x] **Step 2: Run targeted test**

Run:

```powershell
node --test test/frontend-static.test.js --test-name-pattern "auto ozon style"
```

Expected: fail before implementation because the new labels/hooks are missing.

## Task 2: Apply Shell HTML/CSS

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`

- [x] **Step 1: Update HTML shell**

Change body/app shell classes and visible labels to the approved ERP wording while preserving existing `data-view` values.

- [x] **Step 2: Add CSS shell styling**

Add auto-ozon-style CSS hooks and styling for sidebar, status strip, dashboard KPI/table/task cards.

- [x] **Step 3: Verify targeted tests**

Run:

```powershell
node --test test/frontend-static.test.js --test-name-pattern "auto ozon style"
node --test test/frontend-static.test.js
```

## Task 3: Browser Smoke

**Files:**
- Modify: `docs/SESSION_HANDOFF.zh-CN.md`

- [x] **Step 1: Open local browser**

Start or reuse `npm start`, open `http://localhost:5178/`, and verify the dashboard looks like an ERP shell.

- [x] **Step 2: Run full verification**

Run:

```powershell
node --test test/collector1688-parser.test.js
node --test test/workflow-runs.test.js
npm test
npm run lint
```

- [x] **Step 3: Update handoff**

Record completed UI shell refactor and verification in `docs/SESSION_HANDOFF.zh-CN.md`.
