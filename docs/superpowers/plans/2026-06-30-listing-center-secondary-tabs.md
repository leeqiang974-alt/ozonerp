# Listing Center Secondary Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Listing Center into a clear second-level workflow for one product, without changing Ozon submit behavior.

**Architecture:** Keep existing listing form IDs, workflow diagnostics, and safety gates. Add a secondary tab layer above the existing workbench that explains and routes the eight listing stages: current product, collection parse, match sourcing, pricing profit, content images, preflight submit, review feedback, and failure repair.

**Tech Stack:** Static HTML shell in `public/index.html`, vanilla JavaScript render/binding in `public/app.js`, CSS in `public/styles.css`, Node static tests in `test/frontend-static.test.js`.

---

### Task 1: Listing Center Secondary Workflow Tabs

**Files:**
- Modify: `test/frontend-static.test.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Write the failing test**

Add a static test requiring the Listing Center to expose real second-level stage tabs and panels:

```js
test("listing center exposes second-level workflow tabs", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /listingSecondaryTabs/);
  assert.match(html, /listingStagePanels/);
  for (const label of ["当前商品", "采集解析", "匹配选品", "定价利润", "内容图片", "预检提交", "审核回执", "失败修复"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(js, /LISTING_CENTER_STAGES/);
  assert.match(js, /renderListingStagePanels/);
  assert.match(js, /setListingStage/);
  assert.match(css, /listing-secondary-tabs/);
  assert.match(css, /listing-stage-panel/);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/frontend-static.test.js
```

Expected: FAIL because `listingSecondaryTabs`, `LISTING_CENTER_STAGES`, and the new styles do not exist.

- [ ] **Step 3: Implement minimal production code**

Add static containers to the listing view:

```html
<section id="listingSecondaryTabs" class="listing-secondary-tabs" aria-label="上架中心二级流程"></section>
<section id="listingStagePanels" class="listing-stage-panels"></section>
```

Add `LISTING_CENTER_STAGES`, `renderListingStagePanels()`, and `setListingStage(stageKey)` in `public/app.js`. Bind clicks on `[data-listing-stage]`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- test/frontend-static.test.js
npm test
npm run lint
```

Expected: all tests and lint pass.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-06-30-listing-center-secondary-tabs.md test/frontend-static.test.js public/index.html public/app.js public/styles.css
git commit -m "feat: add listing center secondary workflow tabs"
```
