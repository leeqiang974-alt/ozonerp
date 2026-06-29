# Ozon ERP Flow Cockpit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有九个平级页面重构为以商品全链路为核心的深色流程驾驶舱，同时保留全部业务功能、DOM 选择器、API 调用和安全闸。

**Architecture:** 保持单页原生 JavaScript 架构，不引入前端框架。`public/index.html` 负责应用壳层和语义结构，`public/app.js` 负责导航状态与驾驶舱数据渲染，`public/styles.css` 通过主题变量和组件层覆盖现有样式；既有页面 ID 和业务控件 ID 不变。

**Tech Stack:** HTML5、原生 JavaScript、CSS Grid/Flexbox、Node.js test runner、Codex in-app browser。

---

### Task 1: 建立应用壳层与两级导航

**Files:**
- Modify: `public/index.html:9`
- Modify: `public/app.js:5587`
- Modify: `public/styles.css:1`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Write the failing shell test**

在 `test/frontend-static.test.js` 增加：

```js
test("frontend exposes the flow cockpit application shell", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /app-rail/);
  assert.match(html, /app-sidebar/);
  assert.match(html, /mobileNavToggle/);
  assert.match(js, /ERP_NAVIGATION_GROUPS/);
  assert.match(js, /activateErpView/);
  assert.match(css, /--erp-bg:/);
  assert.match(css, /\.app-shell/);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/frontend-static.test.js`

Expected: FAIL because the new shell selectors and functions do not exist.

- [ ] **Step 3: Replace the flat sidebar with a stable shell**

Use this structure while preserving every existing `.tab[data-view]` button:

```html
<div class="app-shell">
  <aside class="app-rail" aria-label="一级导航">...</aside>
  <aside class="app-sidebar" id="appSidebar">
    <div class="sidebar-brand">...</div>
    <nav class="tabs app-secondary-nav" aria-label="模块">...</nav>
    <div class="sidebar-store">...</div>
  </aside>
  <main class="main">...</main>
</div>
```

Move `storeSelect`, `testButton`, and `storeHint` into `.sidebar-store`. Add `mobileNavToggle` without changing their IDs.

- [ ] **Step 4: Centralize navigation activation**

Add to `public/app.js`:

```js
const ERP_NAVIGATION_GROUPS = [
  { key: "cockpit", label: "驾驶舱", views: ["dashboard", "workflow-console"] },
  { key: "product-flow", label: "商品全链路", views: ["research", "sourcing", "listing"] },
  { key: "operations", label: "运营管理", views: ["products", "warehouse", "orders", "promotions"] },
];

function activateErpView(view) {
  const tab = document.querySelector(`.tab[data-view="${view}"]`);
  const targetView = document.querySelector(`#${view}`);
  if (!tab || !targetView) return false;
  document.querySelectorAll(".tab, .view").forEach((item) => item.classList.remove("active"));
  tab.classList.add("active");
  targetView.classList.add("active");
  document.body.dataset.activeView = view;
  return true;
}
```

Refactor `bindTabs()` to call this function before the existing lazy-load logic.

- [ ] **Step 5: Add the theme foundation**

Define the confirmed tokens in `:root`: `--erp-bg`, `--erp-sidebar`, `--erp-panel`, `--erp-panel-raised`, `--erp-line`, `--erp-cyan`, `--erp-blue`, `--erp-success`, `--erp-warning`, `--erp-danger`, `--erp-text`, and `--erp-muted`.

- [ ] **Step 6: Verify Task 1**

Run: `node --test test/frontend-static.test.js`

Expected: PASS.

### Task 2: 重构驾驶舱首屏

**Files:**
- Modify: `public/index.html:41`
- Modify: `public/app.js:390`
- Modify: `public/styles.css`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Write the failing cockpit test**

```js
test("dashboard exposes the operational cockpit hierarchy", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /cockpitRiskBanner/);
  assert.match(html, /cockpitKpis/);
  assert.match(html, /cockpitWorkflowFocus/);
  assert.match(html, /systemPulseGrid/);
  assert.match(js, /renderCockpitDashboard/);
  assert.match(js, /cockpitWorkflowPhases/);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/frontend-static.test.js`

Expected: FAIL on the missing cockpit selectors.

- [ ] **Step 3: Build the dashboard hierarchy**

Replace the current dashboard body with semantic sections in this order:

```html
<div id="cockpitRiskBanner" class="cockpit-risk-banner"></div>
<div id="cockpitKpis" class="cockpit-kpis"></div>
<section class="panel cockpit-flow-panel">
  <div id="erpWorkflowNavigator" class="cockpit-flow"></div>
</section>
<div class="cockpit-content-grid">
  <section id="cockpitWorkflowFocus" class="panel"></section>
  <section class="panel"><div id="systemPulseGrid"></div></section>
</div>
```

Move module ownership, API coverage, API backlog, and recent response into a closed `<details class="cockpit-reference">` block.

- [ ] **Step 4: Render dashboard data from existing state**

Add `renderCockpitDashboard()` that reads `state.workflowSummary`, `state.workflowRuns`, `state.stores`, crawler worker state, and existing counters. It must render fallback values when data is unavailable and never call an API directly.

- [ ] **Step 5: Make the five phases navigable**

Render `采集 / 分析 / 上架 / 审核 / 库存` from `ERP_WORKFLOW_NAVIGATION`; clicking continues to use `data-view` and `activateErpView()`.

- [ ] **Step 6: Verify Task 2**

Run: `node --test test/frontend-static.test.js`

Expected: PASS.

### Task 3: 统一组件与业务页面视觉层级

**Files:**
- Modify: `public/styles.css`
- Modify: `public/index.html`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Write the failing component-system test**

```js
test("frontend uses the cockpit component system", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.erp-panel/);
  assert.match(css, /\.erp-status-pill/);
  assert.match(css, /\.erp-empty-state/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.view\.active/);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/frontend-static.test.js`

Expected: FAIL on the new component classes.

- [ ] **Step 3: Define component styles**

Create reusable styles for panels, KPI cards, status pills, buttons, inputs, tables, filter chips, empty states, code blocks, and risk banners. Map existing `.panel`, `.metrics article`, `.workflow-*`, `.product-*`, `.order-*`, and `.promotion-*` selectors onto the new tokens so no business markup must be rewritten wholesale.

- [ ] **Step 4: Normalize page headers and actions**

All `.page-head` elements use one title/subtitle/actions layout. Primary actions are blue, safe secondary actions are ghost, and destructive or Ozon-submit actions remain danger-colored.

- [ ] **Step 5: Verify Task 3**

Run: `node --test test/frontend-static.test.js`

Expected: PASS.

### Task 4: 修正宽屏与窄屏响应式行为

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Write the failing responsive test**

```js
test("frontend provides desktop compact and mobile navigation modes", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /sidebarBackdrop/);
  assert.match(js, /toggleMobileNavigation/);
  assert.match(css, /@media \(max-width: 1439px\)/);
  assert.match(css, /@media \(max-width: 1023px\)/);
  assert.match(css, /transform:\s*translateX\(-100%\)/);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/frontend-static.test.js`

Expected: FAIL on responsive navigation contracts.

- [ ] **Step 3: Implement three layout modes**

- `>=1440px`: 72px rail + 220px sidebar.
- `1024px–1439px`: 64px rail + 72px compact sidebar with labels hidden via CSS.
- `<1024px`: rail and sidebar become an off-canvas drawer; `.main` has zero left margin.

- [ ] **Step 4: Implement safe drawer behavior**

`toggleMobileNavigation(force)` toggles `body.mobile-nav-open`; navigation closes after a view is selected, after Escape, or after backdrop click. It must not alter active view state.

- [ ] **Step 5: Verify Task 4**

Run: `node --test test/frontend-static.test.js`

Expected: PASS.

### Task 5: Browser visual verification

**Files:**
- Modify if needed: `public/index.html`
- Modify if needed: `public/styles.css`

- [ ] **Step 1: Run focused and full automated checks**

Run:

```powershell
node --test test/frontend-static.test.js
npm test
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 2: Verify 1920px-class desktop layout**

Use the in-app browser viewport capability at 1600×900. Confirm the rail, secondary sidebar, risk banner, four KPI cards, five workflow phases, workflow focus, and system pulse are visible without horizontal page scrolling.

- [ ] **Step 3: Verify 1366px compact layout**

Use 1366×768. Confirm the compact secondary navigation leaves enough main content width and tables remain usable.

- [ ] **Step 4: Verify 1024px and narrow layouts**

Use 1024×768 and the natural Codex side-panel width. Confirm sidebar content no longer stacks above the main page; drawer open/close and table horizontal scrolling work.

- [ ] **Step 5: Check key pages**

Open dashboard, workflow console, sourcing, listing, products/warehouse, orders, and promotions. Confirm each page is reachable, readable, and retains existing buttons and IDs.

### Task 6: Documentation and handoff

**Files:**
- Modify: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Record the new navigation map**

Document the four navigation areas and mapping of every original page.

- [ ] **Step 2: Record safety and compatibility**

State that API contracts, Ozon confirmation, workflow locks, and business selectors were not changed.

- [ ] **Step 3: Record verification evidence**

Include final test count, lint result, and verified viewport sizes.

## Execution Notes

- The project is not a Git repository, so commit steps are replaced by file backups before the first production edit and by test checkpoints after every task.
- Do not redesign business forms beyond the agreed visual hierarchy in this phase.
- Do not remove IDs or rename API-facing controls.
