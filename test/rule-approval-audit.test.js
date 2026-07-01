import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendRuleApprovalAuditIntent,
  listRuleApprovalAuditIntents,
  summarizeRuleApprovalAuditIntents,
} from "../src/ruleApprovalAudit.js";

const tmpFile = path.join(os.tmpdir(), "ozonerp-rule-approval-audit.test.json");

function reset() {
  try { fs.unlinkSync(tmpFile); } catch {}
  process.env.RULE_APPROVAL_AUDIT_FILE = tmpFile;
}

test("rule approval audit intent stores proof without enabling rules or payload writes", async () => {
  reset();

  const record = await appendRuleApprovalAuditIntent({
    workflowRunId: "wr_1",
    id: "client-forged-id",
    createdAt: "2000-01-01T00:00:00.000Z",
    categoryKey: "17028673:95183",
    categoryPath: "Дом / Кухня",
    attributeId: 1234,
    attributeName: "Комментарий к комплектации",
    sampleProductIds: ["SKU-CURRENT", "SKU-OLD-1"],
    sampleRunIds: ["wr_1", "wr_0"],
    approver: "operator-a",
    note: "同类目两条样本一致，先记录人工批准意图。",
    confirmAuditIntent: true,
    proof: {
      sampleReviewRecord: "已复核两个同类目样本和 Ozon 字典。",
      approvedBy: "operator-a",
      independentPreflightRunId: "preflight-regression-1",
      independentPreflightPassed: true,
    },
  });

  assert.match(record.id, /^raa_/);
  assert.notEqual(record.id, "client-forged-id");
  assert.notEqual(record.createdAt, "2000-01-01T00:00:00.000Z");
  assert.equal(record.intentStatus, "stored_for_review");
  assert.equal(record.effectStatus, "no_rule_or_payload_effect");
  assert.equal(record.auditReadiness.status, "audit_ready");
  assert.equal(record.auditReadiness.canStoreApproval, true);
  assert.equal(record.auditReadiness.canEnableRule, false);
  assert.equal(record.safetyLocks.draftWrite, false);
  assert.equal(record.safetyLocks.ozonSubmit, false);
  assert.equal(record.safetyLocks.ruleEnable, false);
  assert.equal(record.safetyLocks.workflowUnlock, false);
  assert.equal(record.confirmAuditIntent, true);
  assert.deepEqual(record.requiredProofs, ["样本复核记录", "人工批准人和时间", "独立预检回归结果"]);
  assert.deepEqual(Object.keys(record).filter((key) => /payload|submit|action/i.test(key)), []);

  const listed = await listRuleApprovalAuditIntents({ categoryKey: "17028673:95183" });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].attributeId, 1234);
  assert.equal(listed.items[0].safetyLocks.ruleEnable, false);
});

test("rule approval audit intent rejects missing confirmation or proof", async () => {
  reset();

  await assert.rejects(
    () => appendRuleApprovalAuditIntent({
      categoryKey: "17028673:95183",
      attributeId: 1234,
      proof: {
        sampleReviewRecord: "已复核",
        approvedBy: "operator-a",
        independentPreflightRunId: "preflight-regression-1",
        independentPreflightPassed: true,
      },
    }),
    /人工确认/,
  );

  await assert.rejects(
    () => appendRuleApprovalAuditIntent({
      categoryKey: "17028673:95183",
      attributeId: 1234,
      confirmAuditIntent: true,
      proof: {
        sampleReviewRecord: "已复核",
        approvedBy: "operator-a",
        independentPreflightRunId: "preflight-regression-1",
        independentPreflightPassed: false,
      },
    }),
    /独立预检/,
  );

  await assert.rejects(
    () => appendRuleApprovalAuditIntent({
      categoryKey: "17028673:95183",
      attributeId: 1234,
      approver: "operator-b",
      confirmAuditIntent: true,
      proof: {
        sampleReviewRecord: "已复核",
        approvedBy: "operator-a",
        independentPreflightRunId: "preflight-regression-1",
        independentPreflightPassed: true,
      },
    }),
    /批准人/,
  );
});

test("rule approval audit summary stays audit-only", async () => {
  reset();
  await appendRuleApprovalAuditIntent({
    categoryKey: "17028673:95183",
    attributeId: 1234,
    attributeName: "Комментарий к комплектации",
    confirmAuditIntent: true,
    proof: {
      sampleReviewRecord: "已复核",
      approvedBy: "operator-a",
      independentPreflightRunId: "preflight-regression-1",
      independentPreflightPassed: true,
    },
  });

  const summary = await summarizeRuleApprovalAuditIntents();

  assert.equal(summary.total, 1);
  assert.equal(summary.byIntentStatus.stored_for_review, 1);
  assert.equal(summary.safeNextStep, "审计意图已记录，但仍不能自动启用规则、写草稿或提交 Ozon。");
});
