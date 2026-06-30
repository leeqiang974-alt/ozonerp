# Ozon Listing Pricing Warehouse Next Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next Ozon-specific listing automation layer so the ERP can explain category/attribute/variant/content/pricing/warehouse blockers and guide a seller to safe next actions.

**Architecture:** Keep listing rules in the listing/workflow modules, pricing rules in the pricing module, and warehouse/stock rules in the warehouse module. Dashboard may summarize current product risk, but it must not own listing forms or workflow diagnostics. Every stage must preserve preflight, payload validation, workflow locks, `waiting_human`, pricing blocked states, and explicit human confirmation.

**Tech Stack:** Node.js ESM, JSON-backed local data, Ozon Seller API wrappers in `src/server.js`, frontend in `public/index.html` / `public/app.js` / `public/styles.css`, tests via `node --test`, lint via `npm run lint`, Claude Code NVIDIA review via `scripts/claude-ozon-review-nvidia.ps1`.

---

## Current Baseline

- Repo: `C:\Users\Administrator\Documents\ozonerp`
- Latest commit at planning time: `018ecb3 docs: add Ozon ERP benchmark assessment`
- Current dirty files are generated test data only:
  - `data/listing-edit-journal.test.json`
  - `data/workflow-runs.test.json`
- Recently completed listing foundation:
  - Local preflight blocks invalid dictionary values, duplicate/missing variant aspects, too few product images, and pricing blocked issues.
  - Attribute matrix supports dictionary repair and safe text repair without unlocking submission.
  - High-confidence brand/no-brand and origin-China autofill reads legal dictionary values from current category cache.
- Claude NVIDIA planning review result:
  - Direction is valid.
  - Module boundaries are listing, pricing, warehouse, and dashboard summary only.
  - Main risks are dynamic Ozon categories, pricing/auto-listing coupling, subjective content score thresholds, and unclear warehouse stock source.

## External Ozon Anchors

- `/v3/product/import` uses the newer Ozon category/type upload path; products need category/type and required characteristics before import.
- Mandatory characteristics affect search/filter discovery and must be completed before reliable listing submission.
- Ozon product rating/content guidance includes media, image requirements, and volume/weight characteristics.
- Price APIs distinguish `price`, `old_price`, and promotion/minimum-price behavior; local `old_price = price * 2` and `min_price = price - 1/floor` are only a starter rule.
- Warehouse/stock work should stay on current warehouse and stock endpoints and account for API changes such as `/v2/warehouse/list` changes and `/v2/products/stocks` compatibility updates.

## Execution Rules For Every Task

- [ ] Ask Claude NVIDIA for a short pre-implementation brief using `scripts/claude-ozon-review-nvidia.ps1`.
- [ ] Write or update the focused test first and confirm it fails for the intended reason.
- [ ] Implement the smallest scoped behavior change.
- [ ] Run the targeted test command listed in the task.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Ask Claude NVIDIA for a post-change review before commit.
- [ ] Update `docs/SESSION_HANDOFF.zh-CN.md` with what changed, safety boundaries, verification, and next step.
- [ ] Commit with a scoped message.

## Task 1: Ozon Content Score And Media Quality Gate

**Business value:** The seller sees why the current product may score poorly or fail before Ozon review: too few images, missing SKU images, weak description, missing rich content, missing package data, or unresolved attribute blockers.

**Files:**
- Modify: `src/listingQuality.js`
- Modify: `src/workflowRuns.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/listing-quality.test.js`
- Test: `test/workflow-runs.test.js`
- Test: `test/frontend-static.test.js`
- Docs: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Add failing backend score tests**

Run after editing tests:

```powershell
node --test test/listing-quality.test.js
```

Expected first failure: content/media score fields such as `mediaScore`, `attributeScore`, `descriptionScore`, `scoreBreakdown`, and media warnings do not exist.

- [ ] **Step 2: Implement local score breakdown**

Rules for first version:

- product images fewer than 3: blocked, already enforced.
- product images 3-4: warning.
- no SKU image for multi-variant items: warning first, blocked only when variant image is required by current UI submission path.
- missing package weight/dimensions: pricing blocked reason remains authoritative; content score also shows "尺重缺失".
- missing description/rich content: warning, not a submit bypass.
- invalid dictionary or variant aspect issues: blocked through existing listing quality issues.

- [ ] **Step 3: Surface score in listing/preflight UI**

The panel must answer:

- 当前商品是谁。
- 哪一项影响 Ozon 商品分值。
- 是否阻塞。
- 下一步按钮进入哪个安全动作。
- 点击后不会提交 Ozon 或自动花费 GPT/Image 成本。

- [ ] **Step 4: Verification**

```powershell
node --test test/listing-quality.test.js test/workflow-runs.test.js test/frontend-static.test.js
npm test
npm run lint
```

**Acceptance criteria:**

- Preflight panel displays score breakdown and blockers.
- No Ozon write API is called by the score calculation.
- GPT/Image buttons remain explicit cost-confirmed actions.

## Task 2: Required Attribute Rule Engine V2

**Business value:** Attribute filling stops being passive. The ERP explains which required fields are high-confidence auto-fill, which are dictionary candidates needing confirmation, and which are compliance-sensitive blockers.

**Files:**
- Modify: `src/autoListing.js`
- Modify: `src/workflowRuns.js`
- Modify: `src/ozonRequiredAttributeAnalysis.js`
- Modify: `public/app.js`
- Test: `test/auto-listing-payload-draft.test.js`
- Test: `test/workflow-runs.test.js`
- Docs: `docs/ozon-dictionary-fill-rules.zh-CN.md`
- Docs: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Add failing tests for source-explained autofill**

Test cases:

- `model_name_from_parent_sku` writes model text consistently across all variants and records source.
- package-derived fields are suggested only when 1688 package data exists.
- dictionary fields never use IDs outside the current `description_category_id:type_id:attribute_id` cache.
- medium-confidence fields create candidates, not automatic writes.

- [ ] **Step 2: Implement unified fill-plan output**

Create a local object shape inside existing modules before extracting a new file:

```js
{
  attributeId,
  name,
  strategy,
  confidence,
  action: "auto_fill" | "suggest_dictionary" | "manual_required" | "blocked_sensitive",
  source,
  value,
  dictionaryValueId,
  reasonZh
}
```

- [ ] **Step 3: UI display**

Show fill-plan rows in listing/preflight, grouped as:

- 已安全补齐。
- 建议确认。
- 必须人工处理。
- 合规敏感，不自动填。

- [ ] **Step 4: Verification**

```powershell
node --test test/auto-listing-payload-draft.test.js test/workflow-runs.test.js test/frontend-static.test.js
npm test
npm run lint
```

**Acceptance criteria:**

- Brand no-brand and origin China stay dictionary-safe.
- Model name and package data are explainable.
- Dictionary IDs are never guessed.
- Submit remains locked until validation/preflight passes and human confirms.

## Task 3: Variant Configuration Workbench

**Business value:** Multi-SKU products stop failing because colors/sizes/images collapse into duplicate Ozon cards. The operator sees each SKU row, variant aspect values, SKU image, and duplicate signature before submit.

**Files:**
- Modify: `src/workflowRuns.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/workflow-runs.test.js`
- Test: `test/frontend-static.test.js`
- Docs: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Add failing tests for variant signature panel data**

Cases:

- duplicate aspect signature produces a blocked row-level reason.
- missing SKU image produces warning or blocker according to current submission path.
- same model name across variants is accepted when aspects differ.

- [ ] **Step 2: Implement row-level variant summary**

Use existing `buildListingAttributeMatrix()` and variant aspect metadata. Do not create a separate variant truth source.

- [ ] **Step 3: UI display**

Add a compact matrix for:

- `offer_id`
- model name
- aspect fields
- SKU image presence
- duplicate/not duplicate
- safe next action

- [ ] **Step 4: Verification**

```powershell
node --test test/workflow-runs.test.js test/frontend-static.test.js
npm test
npm run lint
```

**Acceptance criteria:**

- Duplicate combinations are visible before preflight submit.
- Fix actions write only local draft data and revalidate.
- No Ozon submit/write occurs from the matrix.

## Task 4: Pricing Strategy Upgrade

**Business value:** Price, minimum price, and old price become explainable commercial strategy instead of formula leftovers. The seller can see target margin, acceptable floor, promo room, and why a product is blocked.

**Files:**
- Modify: `src/pricing.js`
- Modify: `src/autoListing.js`
- Modify: `src/workflowRuns.js`
- Modify: `public/app.js`
- Test: `test/pricing-source.test.js`
- Test: `test/listing-content-quality.test.js`
- Test: `test/workflow-runs.test.js`
- Docs: `docs/pricing-logic.zh-CN.md`
- Docs: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Add failing tests for strategy output**

Cases:

- `min_price` is calculated from minimum acceptable profit, not merely `price - 1`.
- `old_price` has a strategy source: promo multiplier, competitor reference, or manual default.
- when `min_price >= price`, pricing risk is blocked.
- when floor margin is below threshold, product enters `PRICING_PROFIT_LOW` or a stricter blocked reason.

- [ ] **Step 2: Implement `pricingPolicy` input and diagnostic output**

First policy fields:

```js
{
  targetProfitRate: 0.3,
  minimumProfitRate: 0.08,
  minimumProfitCny: 3,
  oldPriceMode: "promo_multiplier",
  oldPriceMultiplier: 1.6,
  commissionSourcePreference: ["ozon_category", "learned_product", "manual_default"]
}
```

- [ ] **Step 3: Keep blocked pricing non-bypassable**

Only manual-review pricing risks can be accepted. Missing package data, no shipping level, invalid min price, and non-converged price remain blocked.

- [ ] **Step 4: Verification**

```powershell
node --test test/pricing-source.test.js test/listing-content-quality.test.js test/workflow-runs.test.js test/frontend-static.test.js
npm test
npm run lint
```

**Acceptance criteria:**

- Pricing panel explains `price`, `min_price`, `old_price`, margin floor, and source.
- Old price is no longer blindly `price * 2` for new strategy paths.
- Existing payload paths remain compatible.

## Task 5: Warehouse Matching Rule Engine

**Business value:** The ERP recommends a warehouse because it matches store, delivery mode, status, product readiness, and previous failure history instead of picking the first usable warehouse.

**Files:**
- Modify: `src/stockQueue.js`
- Modify: `src/server.js`
- Modify: `public/app.js`
- Test: `test/stock-queue.test.js`
- Test: `test/server-routes.test.js`
- Test: `test/frontend-static.test.js`
- Docs: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Add failing tests for warehouse ranking**

Cases:

- prefer `created` warehouses.
- exclude warehouses that failed with `WAREHOUSE_WRONG_STATUS`.
- prefer warehouse matching product/store delivery mode when available.
- return recommendation reasons, not just an ID.

- [ ] **Step 2: Implement pure ranking function**

Keep this function deterministic and testable:

```js
rankWarehousesForStock({
  warehouses,
  excludedIds,
  product,
  store,
  previousFailures
})
```

- [ ] **Step 3: Wire stock queue carefully**

`resolveWarehouseIdForStore()` can use the ranked first item, but stock writes still happen only after product import/review readiness checks already in the stock queue.

- [ ] **Step 4: UI display**

Warehouse page and stock node should show:

- recommended warehouse.
- why selected.
- why others were excluded.
- last failed reason.
- retry action that stays in stock queue, not direct blind write.

- [ ] **Step 5: Verification**

```powershell
node --test test/stock-queue.test.js test/server-routes.test.js test/frontend-static.test.js
npm test
npm run lint
```

**Acceptance criteria:**

- Failed warehouse IDs are not reused in the same retry cycle.
- Stock failures remain visible and replayable.
- No silent stock write failure.

## Task 6: Review Feedback And Product Score Loop

**Business value:** After submission/review, the ERP learns whether Ozon accepted the product, which fields still hurt score, and which repair task should be shown for the current product.

**Files:**
- Modify: `src/workflowRuns.js`
- Modify: `src/autoListing.js`
- Modify: `public/app.js`
- Test: `test/workflow-runs.test.js`
- Test: `test/frontend-static.test.js`
- Docs: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Add tests for review/status-to-task mapping**

Cases:

- review failure maps to listing repair.
- accepted but low score maps to content improvement.
- stock write waiting maps to warehouse queue.
- dashboard only receives summary and next action.

- [ ] **Step 2: Implement feedback mapper**

Keep mapping in workflow/listing domain. Dashboard reads the mapped summary but does not inspect raw payload fields.

- [ ] **Step 3: Verification**

```powershell
node --test test/workflow-runs.test.js test/frontend-static.test.js
npm test
npm run lint
```

**Acceptance criteria:**

- Current product tells the seller: who, blocked where, why, next safe action.
- Historical failures stay folded into workflow console advanced diagnostics.
- Dashboard remains sales/operations overview plus side reminders.

## Recommended Order

1. Task 1: Ozon content score and media quality gate.
2. Task 2: Required attribute rule engine V2.
3. Task 3: Variant configuration workbench.
4. Task 4: Pricing strategy upgrade.
5. Task 5: Warehouse matching rule engine.
6. Task 6: Review feedback and product score loop.

Reason: listing success depends first on Ozon category/attributes/variant/media correctness. Pricing and warehouse matter immediately after, but they should not be mixed into attribute-filling work because their safety gates and ownership are different.

## First Implementation Slice After Approval

Start with Task 1 only.

Expected first commit:

```powershell
git add src/listingQuality.js src/workflowRuns.js public/app.js public/styles.css test/listing-quality.test.js test/workflow-runs.test.js test/frontend-static.test.js docs/SESSION_HANDOFF.zh-CN.md
git commit -m "feat: add Ozon listing content score gate"
```

Do not include the two dirty test data files unless the task explicitly changes test fixtures.
