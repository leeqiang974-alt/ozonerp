import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendRulePublishReviewIntent,
  listRulePublishReviewIntents,
  summarizeRulePublishReviewIntents,
} from "../src/rulePublishReview.js";

const tmpFile = path.join(os.tmpdir(), "ozonerp-rule-publish-review.test.json");

function reset() {
  try { fs.unlinkSync(tmpFile); } catch {}
  process.env.RULE_PUBLISH_REVIEW_FILE = tmpFile;
}

function validInput(overrides = {}) {
  return {
    categoryKey: "17028673:95183",
    categoryPath: "Дом / Кухня",
    attributeId: 1234,
    attributeName: "Комментарий к комплектации",
    approvalAuditIntentId: "raa_audit_1",
    reviewer: "operator-a",
    confirmPublishReviewIntent: true,
    sampleCoverage: {
      distinctProductCount: 2,
      sampleProductIds: ["SKU-CURRENT", "SKU-OLD-1"],
      sampleRunIds: ["wr_current", "wr_old"],
    },
    proof: {
      reviewedBy: "operator-a",
      independentPreflightRunId: "preflight-regression-1",
      independentPreflightPassed: true,
      rollbackPlan: "如规则命中异常，立即禁用规则并回滚到人工填写。",
    },
    ...overrides,
  };
}

test("rule publish review intent stores review proof without enabling rules", async () => {
  reset();

  const record = await appendRulePublishReviewIntent({
    id: "client-forged-id",
    createdAt: "2000-01-01T00:00:00.000Z",
    ...validInput(),
  });

  assert.match(record.id, /^rpr_/);
  assert.notEqual(record.id, "client-forged-id");
  assert.notEqual(record.createdAt, "2000-01-01T00:00:00.000Z");
  assert.equal(record.intentStatus, "stored_for_publish_review");
  assert.equal(record.publishStatus, "review_only_not_enabled");
  assert.equal(record.effectStatus, "no_rule_or_payload_effect");
  assert.equal(record.confirmPublishReviewIntent, true);
  assert.equal(record.approvalAuditIntentId, "raa_audit_1");
  assert.equal(record.reviewReadiness.status, "review_ready");
  assert.equal(record.reviewReadiness.canEnableRule, false);
  assert.equal(record.reviewReadiness.canWritePayload, false);
  assert.equal(record.safetyLocks.ruleEnable, false);
  assert.equal(record.safetyLocks.payloadWrite, false);
  assert.equal(record.safetyLocks.workflowUnlock, false);
  assert.equal(record.safetyLocks.ozonSubmit, false);
  assert.deepEqual(record.forbiddenEffects, ["rule_enable", "payload_write", "workflow_unlock", "ozon_submit"]);
  assert.match(record.safeNextStep, /独立人工发布流程/);

  const listed = await listRulePublishReviewIntents({ categoryKey: "17028673:95183" });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].attributeId, 1234);
  assert.equal(listed.items[0].reviewReadiness.canEnableRule, false);
});

test("rule publish review intent rejects missing safety proof", async () => {
  reset();

  await assert.rejects(
    () => appendRulePublishReviewIntent(validInput({ confirmPublishReviewIntent: false })),
    /人工确认/,
  );

  await assert.rejects(
    () => appendRulePublishReviewIntent(validInput({ approvalAuditIntentId: "" })),
    /审计/,
  );

  await assert.rejects(
    () => appendRulePublishReviewIntent(validInput({ attributeId: "" })),
    /类目和属性/,
  );

  await assert.rejects(
    () => appendRulePublishReviewIntent(validInput({
      sampleCoverage: {
        distinctProductCount: 1,
        sampleProductIds: ["SKU-CURRENT"],
        sampleRunIds: ["wr_current"],
      },
    })),
    /样本/,
  );

  await assert.rejects(
    () => appendRulePublishReviewIntent(validInput({
      sampleCoverage: {
        distinctProductCount: 2,
        sampleProductIds: ["SKU-CURRENT", "SKU-CURRENT"],
        sampleRunIds: ["wr_current"],
      },
    })),
    /样本/,
  );

  await assert.rejects(
    () => appendRulePublishReviewIntent(validInput({
      proof: {
        reviewedBy: "operator-a",
        independentPreflightRunId: "preflight-regression-1",
        independentPreflightPassed: false,
        rollbackPlan: "如规则命中异常，立即禁用规则并回滚到人工填写。",
      },
    })),
    /独立预检/,
  );

  await assert.rejects(
    () => appendRulePublishReviewIntent(validInput({
      proof: {
        reviewedBy: "operator-a",
        independentPreflightRunId: "preflight-regression-1",
        independentPreflightPassed: true,
        rollbackPlan: "",
      },
    })),
    /回滚/,
  );

  await assert.rejects(
    () => appendRulePublishReviewIntent(validInput({
      reviewer: "operator-b",
    })),
    /审核人/,
  );
});

test("rule publish review summary stays review-only", async () => {
  reset();
  await appendRulePublishReviewIntent(validInput());

  const summary = await summarizeRulePublishReviewIntents();

  assert.equal(summary.total, 1);
  assert.equal(summary.byIntentStatus.stored_for_publish_review, 1);
  assert.equal(summary.byPublishStatus.review_only_not_enabled, 1);
  assert.match(summary.safeNextStep, /不能自动启用规则、写草稿或提交 Ozon/);
});
