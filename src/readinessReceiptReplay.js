import {
  buildReadFailureSellerTask,
  buildReadOperatorReport,
} from "./readVerificationOperator.js";
import {
  ReadinessEvidenceReceiptRepository,
  evaluateRealReadVerification,
} from "./readinessEvidenceReceipt.js";
import { scopeHash } from "./readVerificationHarness.js";

const ENDPOINTS = ["/v3/product/list", "/v3/product/info/list"];
const REPLAY_ENVIRONMENT = "local-server-observed-replay";
const REPLAY_STORE = "replay-store-1";

function inspectionFor(scenario, checkedAt) {
  const failure = scenario === "permission" ? { endpoint: ENDPOINTS[0], statusCode: 403, reasonCode: "forbidden" }
    : scenario === "rate_limited" ? { endpoint: ENDPOINTS[0], statusCode: 429, reasonCode: "rate_limited" }
      : scenario === "server_failure" ? { endpoint: ENDPOINTS[0], statusCode: 503, reasonCode: "server_error" }
        : scenario === "partial" ? { endpoint: ENDPOINTS[1], reasonCode: "coverage_incomplete" }
        : null;
  const partial = scenario === "partial";
  const success = scenario === "success";
  return {
    jobId: `replay-${scenario}`,
    storeId: REPLAY_STORE,
    evidenceSummary: {
      readStatus: success ? "completed" : partial ? "partial" : "dependency_failed",
      state: success ? "ready_for_sale" : "pending_moderation",
      live: success,
      requestedOfferCount: 1,
      coverageComplete: success,
      // A partial read may have attempted both endpoints but still lack
      // complete offer coverage; endpoint omission is a different failure.
      endpointAttempts: ENDPOINTS,
      endpointFailures: failure ? [failure] : [],
      operationEvidence: ENDPOINTS.map((operationPath) => ({
        operationPath,
        responseHash: `sha256:${"a".repeat(64)}`,
        verificationLevel: "server_observed",
      })),
    },
    sellerView: {
      evidenceAt: checkedAt,
      offers: [{ offerId: `replay-offer-${scenario}`, productId: 1, moderationStatus: success ? "ready" : "pending", errorCount: 0 }],
    },
  };
}

function operatorPlan() {
  return {
    store: { id: REPLAY_STORE },
    environment: REPLAY_ENVIRONMENT,
    scope: { name: "single_offer", offerCount: 1 },
    endpoints: ENDPOINTS,
    readOnly: true,
    writeAttempted: false,
    confirm: "I_CONFIRM_READ_ONLY",
    maxAgeMs: 24 * 60 * 60 * 1000,
  };
}

/**
 * Run deterministic server-observed receipt scenarios without a transport.
 * This is intentionally a replay harness: recordServerObservation is the
 * same durable boundary used by the server route, while every input is a
 * redacted fixture and no Ozon/1688 network is reachable from this module.
 */
export async function runReadinessReceiptReplay({ repository, now = "2026-07-17T00:00:00.000Z" } = {}) {
  if (!repository || typeof repository.recordServerObservation !== "function") {
    throw new Error("READINESS_REPLAY_REPOSITORY_REQUIRED");
  }
  const plan = operatorPlan();
  const scenarios = ["success", "partial", "permission", "rate_limited", "server_failure"];
  const results = [];
  for (const scenario of scenarios) {
    const recorded = await repository.recordServerObservation({
      recordEvidence: true,
      inspection: inspectionFor(scenario, now),
      environment: REPLAY_ENVIRONMENT,
      endpointVersions: ENDPOINTS,
      requestScope: "controlled_fixture",
    });
    if (!recorded.ok) throw new Error(`READINESS_REPLAY_RECORD_FAILED:${scenario}`);
    const receipt = recorded.receipt;
    const verification = evaluateRealReadVerification([receipt], {
      environment: REPLAY_ENVIRONMENT,
      maxAgeMs: plan.maxAgeMs,
      now,
    });
    results.push({
      scenario,
      receipt: {
        id: receipt.id,
        origin: receipt.origin,
        persisted: receipt.persisted,
        verificationEligible: receipt.verificationEligible,
        success: receipt.success,
        readStatus: receipt.readStatus,
        failureScenario: receipt.failureScenario,
        responseHash: receipt.responseHash,
      },
      report: buildReadOperatorReport(plan, {
        verificationLevel: "server_observed",
        persisted: true,
        storeRefHash: scopeHash(REPLAY_STORE),
        environmentRefHash: scopeHash(REPLAY_ENVIRONMENT),
        scopeRefHash: scopeHash(plan.scope),
        endpoints: receipt.endpointAttempts,
        checkedAt: receipt.checkedAt,
        status: receipt.success ? "success" : receipt.readStatus,
        failureScenario: receipt.failureScenario,
        failureEvidence: receipt.failureEvidence,
        readSucceeded: receipt.readStatus === "completed",
        responseHash: receipt.responseHash,
      }),
      sellerTask: buildReadFailureSellerTask(receipt),
      failureOnlyVerificationLevel: verification.verificationLevel,
      noWrite: true,
    });
  }
  return {
    replayType: "server_observed_readiness_receipt",
    network: "not_used",
    storeRef: scopeHash(REPLAY_STORE),
    environmentRef: scopeHash(REPLAY_ENVIRONMENT),
    scenarios: results,
    // This repository boundary is identical to the server path, but every
    // input here is a redacted offline fixture.  Persistence alone must not
    // promote a replay to real-account evidence.
    verification: {
      ...evaluateRealReadVerification(await repository.list(), {
      environment: REPLAY_ENVIRONMENT,
      maxAgeMs: plan.maxAgeMs,
      now,
      }),
      verificationLevel: "locally_tested",
      verificationSource: "offline_fixture_replay",
      realReadVerified: false,
    },
    sideEffect: "仅使用脱敏 fixture 写入本地 server_observed 回执；不会联网、写入 Ozon 或修改商品/库存/订单。",
  };
}

export { ENDPOINTS, REPLAY_ENVIRONMENT, REPLAY_STORE };
