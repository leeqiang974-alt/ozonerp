# ERP Business Object IA Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the Ozon ERP frontend tabs around business objects instead of automation internals.

**Architecture:** Keep the existing static SPA and view ids. Update labels, ownership contracts, first-screen ordering, and progressive disclosure priorities so each tab answers a clear ERP business question. Do not change backend APIs, Ozon submission, pricing logic, workflow locks, GPT cost confirmation, or human confirmation behavior.

**Tech Stack:** HTML, CSS, vanilla JavaScript, `node:test` static frontend contracts, Playwright smoke via local browser.

---

## File Map

- `test/frontend-static.test.js`: add static contracts for business-object tab definitions and first-screen priority hooks.
- `public/index.html`: update navigation labels and reorder key panels in product, sourcing, listing, warehouse, and research views.
- `public/app.js`: update ownership contracts, task cards, and progressive disclosure priority logic.
- `public/styles.css`: add compact ERP module workbench styles for business-object panels.
- `docs/SESSION_HANDOFF.zh-CN.md`: record phase 1 IA decision and verification.

## Task 1: Business Object Contracts

**Files:**
- Modify: `test/frontend-static.test.js`

- [x] **Step 1: Write failing static test**

Add tests asserting:
- 商品管理 is a store product overview with `productAssetLedger` before filter/table controls.
- 上传管理 uses `上传队列`, `当前草稿`, and `上传状态`, with the full listing workbench behind advanced disclosure.
- 智能选品 starts with sourcing task/capture/candidate context, not image detail.
- Ozon 竞品参照 does not expose main-chain automation buttons as first-screen primary controls.
- 仓库库存 keeps raw stock JSON in advanced/collapsed content.

- [x] **Step 2: Run targeted test**

Run:

```powershell
node --test test/frontend-static.test.js --test-name-pattern "business object ERP tab"
```

Expected before implementation: fail because current labels/order still reflect old automation-centric layout.

## Task 2: Reorder First Screens

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [x] **Step 1: Update labels and contracts**

Change the user-facing tab framing:
- 商品中心 -> 商品总览
- 上传管理 group remains, listing tab becomes 上传队列
- 1688 货源采集 remains under 选品采集
- Ozon 竞品参照 becomes 竞品素材
- 任务配置 becomes 自动化任务

- [x] **Step 2: Reorder critical panels**

Make first-screen business panels appear before filters/tools:
- Products: `product-asset-ledger` before status tabs, toolbar, and full table.
- Sourcing: page header and capture/task entry before `图片与详情`.
- Listing: current draft/upload status and minimal queue before full listing form.
- Warehouse: inventory risk/queue before raw JSON.
- Research: reference/material panels before main-chain automation buttons.

- [x] **Step 3: Make disclosure priority explicit**

Update `applyProgressiveDisclosure()` so panels with business-priority classes remain visible and old diagnostic/tool panels collapse. Do not collapse product ledger, listing current draft, order table, promotion detail, or workflow focus.

## Task 3: Verify and Document

**Files:**
- Modify: `docs/SESSION_HANDOFF.zh-CN.md`

- [x] **Step 1: Run tests**

Run:

```powershell
node --test test/frontend-static.test.js
node --test test/collector1688-parser.test.js
node --test test/workflow-runs.test.js
npm test
npm run lint
```

- [x] **Step 2: Browser smoke**

Open `http://localhost:5178/` and inspect the tabs:
- 商品管理 first screen is store product overview.
- 上传管理 first screen is upload queue/current draft, not the full technical form.
- 自动化任务 first screen is workflow status and blocked actions.
- 智能选品 first screen is source/candidate workflow.

- [x] **Step 3: Update handoff**

Record completed IA phase 1 and note what remains for later phases.
