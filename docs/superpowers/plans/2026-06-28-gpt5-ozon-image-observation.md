# GPT-5 Ozon Image Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal GPT-5 nano analysis loop that reads Ozon image observation samples, sends product image sequences to APIB Responses API, and saves reusable image-style observations.

**Architecture:** Keep the analysis service separate from collection. `ozonImageStyleLearning.js` continues to build the queue; a new analyzer module consumes that queue through `callAiTask`, persists results, and server routes expose rebuild/read actions.

**Tech Stack:** Node.js ESM, Express, `node:test`, existing `callAiTask` APIMart/APIB Responses API provider.

---

### Task 1: Analyzer Persistence

**Files:**
- Create: `src/ozonImageStyleAnalyzer.js`
- Test: `test/ozon-image-style-analyzer.test.js`

- [ ] Write a failing test proving one vision queue item is analyzed and saved.
- [ ] Implement `analyzeOzonImageStyleQueue({ limit, aiTask })`.
- [ ] Save results to `data/ozon-image-style-analysis.json`.

### Task 2: Server Routes

**Files:**
- Modify: `src/server.js`
- Test: `test/server-routes.test.js`

- [ ] Add `GET /api/ozon-learning/image-style-analysis`.
- [ ] Add `POST /api/ozon-learning/image-style-analysis/run`.
- [ ] Return summary counts and latest rows.

### Task 3: Frontend Controls

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Test: `test/frontend-static.test.js`

- [ ] Add an “GPT分析观察库” button and result panel.
- [ ] Load analysis results in the Ozon learning tab.
- [ ] Show total analyzed, provider/model, risk counts, and sample rows.

### Task 4: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Restart ERP on port `5178`.
