# Ozon Variant Grouping Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作流控制台展示逐 SKU 变体重复诊断，并安全生成保留整组 SKU 的修复草稿。

**Architecture:** 在 `workflowRuns.js` 增加纯诊断与草稿生成函数，由 `autoListing.js` 把原提交 Payload 和属性元数据传给审核节点。前端根据稳定输出渲染专用卡，复用现有草稿保存、校验和人工确认提交接口。

**Tech Stack:** Node.js ES modules、原生前端 JavaScript、Node test runner。

---

### Task 1: 变体重复诊断

**Files:**
- Modify: `src/workflowRuns.js`
- Test: `test/workflow-runs.test.js`

- [ ] **Step 1: Write the failing test**

新增测试，调用 `buildVariantGroupingDiagnosis({items, attrsMeta})`，断言两个相同颜色 SKU 进入同一 `duplicateGroups`，且所有 SKU 都保留在 `rows`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/workflow-runs.test.js`
Expected: FAIL because `buildVariantGroupingDiagnosis` is not exported.

- [ ] **Step 3: Write minimal implementation**

实现纯函数：从 `attrsMeta` 提取型号与 `is_aspect` ID，从每个 item 的 attributes 生成签名，并按签名分组。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/workflow-runs.test.js`
Expected: PASS.

### Task 2: 整组修复草稿安全约束

**Files:**
- Modify: `src/workflowRuns.js`
- Test: `test/workflow-runs.test.js`

- [ ] **Step 1: Write the failing test**

新增测试，调用 `buildVariantGroupingRepairDraft({originalPayload, skuOffers})`，断言完整批次返回 `{items:[...]}`，缺少任一 `offer_id` 时返回 `ok:false` 与 `INCOMPLETE_VARIANT_GROUP`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/workflow-runs.test.js`
Expected: FAIL because the repair draft builder is missing.

- [ ] **Step 3: Write minimal implementation**

规范化单品或 `{items}` Payload；比较原 SKU 集合与期望集合；只在集合完全一致时返回完整草稿。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/workflow-runs.test.js`
Expected: PASS.

### Task 3: 审核节点接入诊断

**Files:**
- Modify: `src/autoListing.js`
- Modify: `src/workflowRuns.js`
- Test: `test/workflow-runs.test.js`

- [ ] **Step 1: Write the failing test**

扩展 `workflowReviewReconcileNode` 测试，断言 `output.variantGroupingDiagnosis` 和 `output.variantGroupingRepairDraft` 存在，且修复草稿保留全部 SKU。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/workflow-runs.test.js`
Expected: FAIL because node output does not contain the new fields.

- [ ] **Step 3: Write minimal implementation**

审核节点接收 `submitPayload` 与 `attrsMeta`，调用两个纯函数；提交阶段传入本次完整 Payload 和类目属性元数据。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/workflow-runs.test.js`
Expected: PASS.

### Task 4: 前端专用缺陷卡

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/frontend-static.test.js`

- [ ] **Step 1: Write the failing test**

断言前端包含 `renderVariantGroupingDefectCard`、`variant-grouping-defect`、`generate-variant-repair-draft` 和“整组修复草稿”。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/frontend-static.test.js`
Expected: FAIL because the renderer and action are absent.

- [ ] **Step 3: Write minimal implementation**

渲染 SKU、型号、变体签名和重复组；按钮只把节点输出中的完整修复草稿写入编辑器并保存，不调用提交接口。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/frontend-static.test.js`
Expected: PASS.

### Task 5: 验证与交接

**Files:**
- Modify: `docs/SESSION_HANDOFF.zh-CN.md`

- [ ] **Step 1: Run full verification**

Run: `npm test && npm run lint`
Expected: all tests pass and lint exits 0.

- [ ] **Step 2: Update handoff**

记录新诊断结构、人工操作边界、测试结果和下一步真实 Ozon 回放计划。
