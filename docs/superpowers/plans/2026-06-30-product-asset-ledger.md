# Product Asset Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Product Center from a status table into an ERP product asset ledger.

**Architecture:** Keep the existing `products` view and Ozon product dashboard API. Add a summary band and five business sections that classify the already-loaded `state.productRows` into actionable product asset groups.

**Tech Stack:** Static HTML shell, vanilla JavaScript rendering in `public/app.js`, CSS in `public/styles.css`, Node test runner static tests.

---

### Task 1: Product Asset Ledger Shell

**Files:**
- Modify: `test/frontend-static.test.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Write the failing test**

Add a static test that requires the Product Center to expose asset ledger selectors, rendering helpers, and CSS classes:

```js
test("product center exposes an ERP product asset ledger", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  for (const id of [
    "productAssetSummary",
    "productAssetActionQueue",
    "productSellingLedger",
    "productReviewLedger",
    "productArchivedLedger",
  ]) {
    assert.match(html, new RegExp(id));
  }
  assert.match(html, /商品资产台账/);
  assert.match(js, /productAssetSnapshot/);
  assert.match(js, /renderProductAssetLedger/);
  assert.match(css, /product-asset-summary/);
  assert.match(css, /product-ledger-section/);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/frontend-static.test.js
```

Expected: one failing test because the new selectors and functions do not exist.

- [ ] **Step 3: Implement minimal shell**

Add the five ledger containers to the `products` view. Add `productAssetSnapshot()` and `renderProductAssetLedger()` in `public/app.js`, called from `renderProducts()`. Add CSS classes for summary cards and ledger sections.

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
git add docs/superpowers/plans/2026-06-30-product-asset-ledger.md test/frontend-static.test.js public/index.html public/app.js public/styles.css
git commit -m "feat: add product asset ledger"
```
