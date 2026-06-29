# Listing Pipeline Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the redesigned ERP information architecture into an actionable listing pipeline workbench.

**Architecture:** Keep the backend untouched in this phase. Add a front-end stage model, render a 9-node pipeline workbench from existing workflow state, and expose clear stage actions that navigate to the correct module.

**Tech Stack:** Vanilla HTML/CSS/JS, Node test runner, existing `public/index.html`, `public/app.js`, `public/styles.css`, `test/frontend-static.test.js`.

---

### Task 1: Frontend Static Contract

**Files:**
- Modify: `test/frontend-static.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that requires the HTML shell to expose `listingPipelineWorkbench`, and `public/app.js` to define `ERP_LISTING_PIPELINE_STAGES`, `renderListingPipelineWorkbench`, `pipelineStageStats`, `data-pipeline-stage-view`, and all 9 listing stages.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend-static.test.js`
Expected: FAIL because the pipeline workbench model and shell do not exist yet.

- [ ] **Step 3: Implement minimal frontend**

Add the HTML container, JS stage model, renderer, click navigation, and CSS cards.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/frontend-static.test.js`
Expected: PASS.

### Task 2: Full Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Restart local ERP**

Restart `http://127.0.0.1:5178/` and verify the homepage contains `listingPipelineWorkbench`.
