import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("server exposes both legacy and concise flow status routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /app\.get\("\/api\/ozon-learning\/flow-status"/);
  assert.match(source, /app\.get\("\/api\/flow\/status"/);
});

test("server exposes workflow continue node route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/nodes\/:key\/continue/);
  assert.match(source, /continueWorkflowNode/);
  assert.match(source, /rerunAutoListingMatch/);
  assert.match(source, /rerunAutoListingContent/);
  assert.match(source, /requestAutoListingNewSource/);
});

test("server exposes controlled workflow chain route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/controlled-chain/);
  assert.match(source, /runControlledWorkflowChain/);
  assert.match(source, /validatePayloadDraft/);
});

test("server exposes payload draft submit safety route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/payload-draft\/submit/);
  assert.match(source, /submitPayloadDraftToOzon/);
  assert.match(source, /confirmSubmit/);
});

test("server exposes confirmed local payload attribute repair route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/payload-draft\/attribute-repair/);
  assert.match(source, /applyPayloadDraftAttributeRepair/);
  assert.match(source, /confirmLocalDraftRepair/);
});

test("server exposes stale workflow reconciliation route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/reconcile-stale/);
  assert.match(source, /reconcileStaleWorkflowRuns/);
});

test("server exposes workflow pricing risk action routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/workflows\/:id\/nodes\/:key\/pricing-risk\/accept/);
  assert.match(source, /\/api\/workflows\/:id\/nodes\/:key\/pricing-risk\/recalculate/);
  assert.match(source, /acceptWorkflowPricingRisk/);
  assert.match(source, /requestWorkflowPricingRecalculation/);
});

test("server exposes external Ozon learning monitor routes and starts the monitor", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/ozon-learning\/external-source\/status/);
  assert.match(source, /\/api\/ozon-learning\/external-source\/sync/);
  assert.match(source, /getExternalOzonLearningStatus/);
  assert.match(source, /syncExternalOzonLearning/);
  assert.match(source, /startExternalOzonLearningMonitor\(\)/);
});

test("server exposes listing edit journal routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /listingEditJournal/);
  assert.match(source, /\/api\/listing-edit-journal\/events/);
  assert.match(source, /appendListingEditEvent/);
  assert.match(source, /listListingEditEvents/);
  assert.match(source, /summarizeListingEditJournal/);
});

test("server exposes listing rule approval audit routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /ruleApprovalAudit/);
  assert.match(source, /\/api\/listing-rule-approval-audit\/intents/);
  assert.match(source, /appendRuleApprovalAuditIntent/);
  assert.match(source, /listRuleApprovalAuditIntents/);
  assert.match(source, /summarizeRuleApprovalAuditIntents/);
});

test("server exposes listing rule publish review routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /rulePublishReview/);
  assert.match(source, /\/api\/listing-rule-publish-review\/intents/);
  assert.match(source, /appendRulePublishReviewIntent/);
  assert.match(source, /listRulePublishReviewIntents/);
  assert.match(source, /summarizeRulePublishReviewIntents/);
});

test("server exposes GPT image style analysis routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /getOzonImageStyleAnalysis/);
  assert.match(source, /analyzeOzonImageStyleQueue/);
  assert.match(source, /\/api\/ozon-learning\/image-style-analysis"/);
  assert.match(source, /\/api\/ozon-learning\/image-style-analysis\/run/);
});

test("server exposes on-demand Ozon reference guidance route", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /generateOzonReferenceGuidance/);
  assert.match(source, /\/api\/ozon-learning\/reference-guidance/);
});

test("server exposes APIMart GPT Image 2 generation routes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /submitGptImage2Generation/);
  assert.match(source, /getImageGenerationTask/);
  assert.match(source, /\/api\/image-generation\/status/);
  assert.match(source, /\/api\/image-generation\/gpt-image-2/);
  assert.match(source, /\/api\/image-generation\/tasks\/:taskId/);
});

test("server exposes stock queue warehouse recommendation enrichment", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(source, /\/api\/ozon\/stock-queue/);
  assert.match(source, /includeWarehouseRecommendation/);
  assert.match(source, /stockJobWarehouseRecommendation/);
  assert.match(source, /warehouseRecommendationError/);
});
