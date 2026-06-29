# On-Demand Ozon Reference Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace front-loaded Ozon image/style learning with a per-product, on-demand reference guidance card that supports copywriting, attributes, and image reconstruction for the current 1688 listing candidate.

**Architecture:** Reuse existing Ozon learning samples and GPT routing, but add a focused service that accepts one product/candidate plus related Ozon reference items and returns a structured guidance card. The first implementation is API/test driven and safe: it only creates guidance, does not submit to Ozon and does not trigger image generation.

**Tech Stack:** Node.js ESM, existing `callAiTask`, JSON file-backed ERP data, Node test runner, existing static frontend.

---

### Task 1: Add guidance-card service

**Files:**
- Create: `src/ozonReferenceGuidance.js`
- Test: `test/ozon-reference-guidance.test.js`

- [ ] Write failing tests for building a guidance prompt that includes product facts, Ozon reference rows, image-style dimensions, carousel plan, image2 prompt requirements, and explicit anti-copying boundary.
- [ ] Implement `buildReferenceGuidancePrompt({ product, references })`.
- [ ] Implement `normalizeReferenceGuidance(product, references, aiResult)` returning stable fields: `copywritingGuidance`, `attributeGuidance`, `imageStyleProfile`, `carouselPlan`, `image2Prompts`, `qualityChecklist`, `riskFlags`, `referenceSummary`.
- [ ] Implement `generateOzonReferenceGuidance({ product, references, aiTask })` using `callAiTask` with `taskType: "ozon_reference_guidance"`.
- [ ] Run `npm test -- test/ozon-reference-guidance.test.js` and verify pass.

### Task 2: Add API route

**Files:**
- Modify: `src/server.js`
- Test: `test/server-routes.test.js`

- [ ] Write failing route static test for `POST /api/ozon-learning/reference-guidance`.
- [ ] Add route that accepts `{ product, references, limit }`, calls `generateOzonReferenceGuidance`, and returns JSON.
- [ ] Keep route read-only: no Ozon submit, no image generation, no API key exposure.
- [ ] Run `npm test -- test/server-routes.test.js`.

### Task 3: Surface guidance in frontend

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/frontend-static.test.js`

- [ ] Write failing static tests for a "单品实时参照" panel, a guidance button, and rendering keys for image style profile / carousel plan / image2 prompts / quality checklist.
- [ ] Add a compact panel in Ozon 学习 or workflow area explaining that guidance runs per product and does not use the bulk image library by default.
- [ ] Add frontend renderer for returned guidance cards.
- [ ] Run `npm test -- test/frontend-static.test.js`.

### Task 4: Verify integration

**Files:**
- Existing files only.

- [ ] Run focused guidance tests.
- [ ] Run full `npm test`.
- [ ] Run `npm run lint`.
- [ ] Restart local ERP on `127.0.0.1:5178` and verify the UI loads.
