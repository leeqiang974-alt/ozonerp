# Ozon ERP Business Domain Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Ozon ERP front page and navigation around ecommerce ERP business domains instead of a developer workflow cockpit.

**Architecture:** Keep existing view IDs and API/event bindings for compatibility, but change the visible information architecture, dashboard hierarchy, and module boundaries. Add a small business-language layer in `public/app.js` and static tests that prevent the dashboard from drifting back into workflow-first UI.

**Tech Stack:** Vanilla HTML/CSS/JS, Express static app, Node test runner, existing `test/frontend-static.test.js`.

---

## File Structure

- Modify `public/index.html`: replace the first-level rail and second-level navigation labels, reshape the dashboard shell, and add stable IDs for business overview and reminder sections.
- Modify `public/app.js`: update `ERP_NAVIGATION_GROUPS`, ownership contracts, dashboard renderers, and status-to-business-language helpers.
- Modify `public/styles.css`: add ERP business-domain layout styles for dashboard overview, reminder rail, domain navigation, and listing center tabs.
- Modify `test/frontend-static.test.js`: add static guardrails for full ERP domains, dashboard hierarchy, listing center placement, and forbidden homepage workflow dominance.
- Keep existing backend files unchanged in phase 1; use existing `/api/stores`, `/api/ozon/order-dashboard`, `/api/workflows`, products, stock, and promotions behavior.

## Task 1: Navigation Domain Skeleton

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Write static tests for complete ERP navigation**

Append tests that assert these exact business domains exist in the HTML/JS:

```js
test("frontend exposes complete ecommerce ERP business domains", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  for (const label of ["店铺总览", "商品管理", "选品采购", "上架中心", "订单履约", "库存仓库", "营销活动", "财务利润", "客户售后", "数据报表", "系统配置"]) {
    assert.match(html + js, new RegExp(label));
  }
  assert.doesNotMatch(html, /今日工作台[\s\S]{0,80}商品上架流水线/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/frontend-static.test.js --test-name-pattern "complete ecommerce ERP business domains"`

Expected: FAIL because the current shell still uses `今日工作台`, `商品上架流水线`, `学习与素材`, and `店铺运营`.

- [ ] **Step 3: Replace rail/nav labels while preserving view IDs**

Use the existing view IDs but map them to ERP domains:

```js
const ERP_NAVIGATION_GROUPS = [
  { key: "store-overview", label: "店铺总览", views: ["dashboard"] },
  { key: "product-management", label: "商品管理", views: ["products"] },
  { key: "sourcing-procurement", label: "选品采购", views: ["sourcing", "research"] },
  { key: "listing-center", label: "上架中心", views: ["listing", "workflow-console"] },
  { key: "order-fulfillment", label: "订单履约", views: ["orders"] },
  { key: "inventory-warehouse", label: "库存仓库", views: ["warehouse"] },
  { key: "marketing", label: "营销活动", views: ["promotions"] },
  { key: "finance-profit", label: "财务利润", views: ["finance"] },
  { key: "customer-service", label: "客户售后", views: ["service"] },
  { key: "analytics", label: "数据报表", views: ["reports"] },
  { key: "system", label: "系统配置", views: ["system"] },
];
```

Create placeholder view sections for `finance`, `service`, `reports`, and `system` so every primary domain has a real landing surface.

- [ ] **Step 4: Run focused test and verify pass**

Run: `node --test test/frontend-static.test.js --test-name-pattern "complete ecommerce ERP business domains"`

Expected: PASS.

## Task 2: Dashboard Store Operating Overview

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Write static tests for dashboard hierarchy**

Add tests:

```js
test("dashboard is store operating overview with reminders as side rail", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="workflow-console"'));
  assert.match(dashboard, /店铺经营总览/);
  assert.match(dashboard, /storeSalesOverview/);
  assert.match(dashboard, /storeProductHealth/);
  assert.match(dashboard, /storeOrderFulfillment/);
  assert.match(dashboard, /storeInventoryRisk/);
  assert.match(dashboard, /storeProfitSnapshot/);
  assert.match(dashboard, /todayReminderRail/);
  assert.match(css, /store-overview-layout/);
  assert.match(js, /renderStoreOperatingOverview/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test test/frontend-static.test.js --test-name-pattern "store operating overview"`

Expected: FAIL because the dashboard still centers listing/workflow panels.

- [ ] **Step 3: Replace dashboard main layout**

Create dashboard layout:

```html
<section id="dashboard" class="view active">
  <header class="page-head store-dashboard-head">
    <div>
      <span class="page-eyebrow">STORE OPERATING OVERVIEW</span>
      <h1>店铺经营总览</h1>
      <p>先看店铺销售、订单、商品、库存、利润和活动风险；今日提醒只在右侧提示。</p>
    </div>
    <div class="actions">
      <button id="refreshDashboard" class="ghost">刷新经营数据</button>
      <button class="primary" type="button" data-cockpit-view="orders">处理订单</button>
    </div>
  </header>
  <div class="store-overview-layout">
    <section class="store-overview-main">
      <div id="storeSalesOverview" class="store-metric-grid"></div>
      <div id="storeBusinessHealthGrid" class="store-business-health-grid"></div>
    </section>
    <aside id="todayReminderRail" class="today-reminder-rail"></aside>
  </div>
</section>
```

Keep old diagnostic content available under `system` or `workflow-console`; do not keep it in dashboard first screen.

- [ ] **Step 4: Implement `renderStoreOperatingOverview()`**

Use current state arrays and existing loaded summaries:

```js
function renderStoreOperatingOverview() {
  const orders = state.orderRows || [];
  const products = state.productRows || [];
  const promotions = state.promotionRows || [];
  const workflows = state.workflowRuns || [];
  // render sales/order/product/inventory/profit/activity cards with safe fallback values
}
```

- [ ] **Step 5: Run focused test and verify pass**

Run: `node --test test/frontend-static.test.js --test-name-pattern "store operating overview"`

Expected: PASS.

## Task 3: Listing Center and Automation Diagnostics Placement

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Write tests for listing center boundaries**

Add tests:

```js
test("listing workflow belongs under listing center, not dashboard", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="workflow-console"'));
  assert.doesNotMatch(dashboard, /listingPipelineWorkbench/);
  assert.doesNotMatch(dashboard, /当前商品流程/);
  assert.match(html, /上架中心/);
  assert.match(html, /上架草稿/);
  assert.match(html, /工作流诊断/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `node --test test/frontend-static.test.js --test-name-pattern "listing workflow belongs"`

Expected: FAIL because dashboard currently owns listing pipeline workbench.

- [ ] **Step 3: Move listing pipeline panels out of dashboard**

Keep `listingPipelineWorkbench`, `singleListingOutcomePanel`, and workflow focus renderers inside `listing` or `workflow-console` sections, not the dashboard.

- [ ] **Step 4: Rename user-facing workflow language**

Keep code identifiers but change labels:

```js
function workflowStatusBusinessLabel(status = "") {
  const labels = {
    waiting_human: "需要人工确认后继续",
    node_failed: "业务步骤失败，需要修复字段或策略",
    blocked: "当前步骤被安全闸阻止",
    preflight_blocked: "提交前检查未通过",
    manual_intervention: "需要人工处理页面或数据",
  };
  return labels[status] || workflowStatusLabel(status);
}
```

Use this helper in dashboard reminders and listing center summary cards.

- [ ] **Step 5: Run focused test and verify pass**

Run: `node --test test/frontend-static.test.js --test-name-pattern "listing workflow belongs"`

Expected: PASS.

## Task 4: Full Regression and Baseline Commit

**Files:**
- Modify: only files touched in Tasks 1-3.

- [ ] **Step 1: Run static frontend tests**

Run: `node --test test/frontend-static.test.js`

Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS or existing lint warning unrelated to changed files; investigate any new failure.

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: PASS. If failing tests expose legacy assumptions, update tests only when the new business-domain spec is the intentional source of truth.

- [ ] **Step 4: Commit phase 1**

```bash
git add public/index.html public/app.js public/styles.css test/frontend-static.test.js docs/superpowers/plans/2026-06-29-ozon-erp-business-domain-restructure.md
git commit -m "feat: restructure ERP business domains and dashboard"
```

## Self-Review

- Spec coverage: covers full primary ERP domains, dashboard as store overview, reminders as side rail, listing center placement, workflow diagnosis demotion, module boundary tests, and business-language status mapping.
- Placeholder scan: no TBD/TODO markers; all task steps have concrete commands or code shape.
- Type consistency: keeps existing view IDs for compatibility and adds placeholder views for new domains referenced by navigation.
