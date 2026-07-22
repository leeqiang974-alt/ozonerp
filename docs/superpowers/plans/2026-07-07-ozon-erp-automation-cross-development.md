# Ozon ERP 自动化交叉开发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb useful ideas from `kennard520/ozon-helper` and `Linuxpizi/auto-ozon` into the local Ozon ERP while preserving preflight, workflow locks, `waiting_human`, pricing blockers, and human confirmation.

**Architecture:** Keep the local Node/Express ERP as the source of truth. External repositories are reference material only: parser behavior, workbench interaction patterns, Seller API coverage, and pricing data maintenance are copied as requirements and tests, not as framework-level code. Implement in small TDD slices that improve the current ERP’s collection, draft, workflow, pricing, and operations modules.

**Tech Stack:** Node.js ES modules, Express, local JSON-backed repositories, browser-extension collector code, `node:test`, existing frontend static contract tests.

---

## File Map

- `src/collector1688.js`: 1688 parser, normalized collector output, detail images, SKU, package data, parse issues.
- `test/collector1688-parser.test.js`: focused parser behavior tests.
- `src/crawler1688.js`: crawl task candidate scoring and detail collection; future consumer of parser `parseIssues`.
- `public/app.js`: collector and listing workbench presentation; future display of `parseIssues` and rich content readiness.
- `src/autoListing.js`: draft generation and payload safety gates; future consumer of rich content and media quality signals.
- `src/pricing.js`: current pricing core; future home for configurable commission/shipping tables.
- `docs/SESSION_HANDOFF.zh-CN.md`: current project state and completed stages.

---

## Task 1: 1688 Detail Images And Parse Issues

**Files:**
- Modify: `src/collector1688.js`
- Modify: `test/collector1688-parser.test.js`
- Modify: `docs/SESSION_HANDOFF.zh-CN.md`

- [x] **Step 1: Write failing parser tests**

Add tests proving that:

```js
parse1688Product({ html }).detailImages
```

extracts detail images from embedded 1688 detail HTML, that `richContentJson` is built as Ozon `raShowcase` content, and that missing core fields produce machine-readable `parseIssues`.

- [x] **Step 2: Run target test to verify failure**

Run: `node --test test/collector1688-parser.test.js`

Expected before implementation: two new tests fail because `detailImages` is empty and `parseIssues` is undefined.

- [x] **Step 3: Implement parser support**

Implement minimal helpers in `src/collector1688.js`:

```js
pickDetailHtml(html, jsonObjects)
pickDetailImages(detailHtml, jsonObjects, hints)
buildRichContent(detailImages)
buildParseIssues(result)
```

Normalize image URLs by removing query/hash noise before deduplication.

- [x] **Step 4: Verify target test passes**

Run: `node --test test/collector1688-parser.test.js`

Expected: all parser tests pass.

## Task 2: Surface Parse Issues In Collector UI

**Files:**
- Modify: `public/app.js`
- Modify: `test/frontend-static.test.js`

- [x] **Step 1: Write failing frontend contract test**

Add a static test that checks the collector rendering path references `parseIssues` and displays machine-readable issues as user-facing collector blockers/warnings.

- [x] **Step 2: Implement UI display**

In the 1688 collector result panel, show:

```text
解析问题：缺 SKU / 缺属性 / 缺重量 / 缺包装尺寸
```

Keep it read-only. Do not add submit actions.

- [x] **Step 3: Verify**

Run:

```powershell
node --test test/frontend-static.test.js --test-name-pattern "collector parse issues"
node --test test/frontend-static.test.js
```

## Task 3: Feed Rich Content Readiness Into Draft Quality

**Files:**
- Modify: `src/autoListing.js`
- Modify: `test/auto-listing-payload-draft.test.js`

- [x] **Step 1: Write failing draft test**

Add a test where a 1688 candidate has `richContentJson` from detail images and verify the generated listing content preserves it as a candidate source for rich content.

- [x] **Step 2: Implement minimal draft mapping**

Map parser `richContentJson` into existing listing content fields only when it is valid JSON-compatible Ozon rich content. Do not submit automatically and do not bypass rich content validation.

- [x] **Step 3: Verify**

Run:

```powershell
node --test test/auto-listing-payload-draft.test.js --test-name-pattern "rich content"
node --test test/auto-listing-payload-draft.test.js
```

## Task 4: External API Coverage Checklist

**Files:**
- Create: `docs/ozon-external-helper-cross-reference.zh-CN.md`

- [x] **Step 1: Document reference mapping**

Create a table mapping external useful modules to local targets:

```text
ozon-helper parse-1688.js -> src/collector1688.js
ozon-helper product-parse.js -> future Ozon competitor collector
ozon-helper ozon_api/client.py -> src/ozon.js / src/server.js API gaps
auto-ozon OzonClient -> Seller operations API gaps
```

- [x] **Step 2: Mark forbidden imports**

Document that direct publish paths, weak preflight, hardcoded remote extension backend URLs, and anti-verification bypass behavior are not allowed in the local ERP.

## Task 5: Configurable Pricing Data Follow-Up

**Files:**
- Modify: `docs/pricing-logic.zh-CN.md`
- Future modify: `src/pricing.js`
- Future test: `test/pricing-source.test.js`

- [x] **Step 1: Document target pricing evolution**

Record the intended evolution toward configurable commission and realFBS route tables, using `ozon-helper` as reference but preserving current blocked risk handling.

- [x] **Step 2: Plan TDD implementation separately**

Do not mix pricing table implementation into parser work. Create a separate plan before changing pricing code.
