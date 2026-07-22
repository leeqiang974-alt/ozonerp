import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ReadinessEvidenceReceiptRepository } from "../src/readinessEvidenceReceipt.js";
import { runReadinessReceiptReplay } from "../src/readinessReceiptReplay.js";

test("server-observed readiness replay covers success, partial, permission, 429 and 5xx without network", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-readiness-replay-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let networkCalls = 0;
  const repository = new ReadinessEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  const result = await runReadinessReceiptReplay({ repository });
  assert.equal(networkCalls, 0);
  assert.equal(result.network, "not_used");
  assert.deepEqual(result.scenarios.map((item) => item.scenario), ["success", "partial", "permission", "rate_limited", "server_failure"]);
  assert.ok(result.scenarios.every((item) => item.receipt.origin === "server_observed" && item.receipt.persisted === true && item.noWrite));
  assert.equal(result.scenarios.find((item) => item.scenario === "success").receipt.success, true);
  assert.equal(result.scenarios.find((item) => item.scenario === "partial").sellerTask.code, "READ_EVIDENCE_PARTIAL");
  assert.equal(result.scenarios.find((item) => item.scenario === "permission").sellerTask.code, "READ_PERMISSION_REQUIRED");
  assert.equal(result.scenarios.find((item) => item.scenario === "rate_limited").sellerTask.code, "READ_RATE_LIMITED");
  assert.equal(result.scenarios.find((item) => item.scenario === "server_failure").sellerTask.code, "READ_DEPENDENCY_FAILED");
  for (const item of result.scenarios.filter((candidate) => candidate.scenario !== "success")) {
    assert.equal(item.failureOnlyVerificationLevel, "locally_tested", item.scenario);
  }
  assert.equal(result.verification.verificationLevel, "locally_tested");
  assert.equal(result.verification.verificationSource, "offline_fixture_replay");
  assert.equal(result.verification.realReadVerified, false);
  assert.equal((await repository.list()).length, 5);
  assert.doesNotMatch(JSON.stringify(result), /apiKey|rawResponse|store-secret|offer-secret/i);
});

test("replay cannot make a client-asserted or failure-only receipt real-read verified", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-readiness-replay-negative-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repository = new ReadinessEvidenceReceiptRepository({ file: path.join(dir, "receipts.json") });
  const result = await runReadinessReceiptReplay({ repository });
  const failures = result.scenarios.filter((item) => item.scenario !== "success");
  assert.ok(failures.every((item) => item.failureOnlyVerificationLevel !== "real_read_verified"));
  const stored = await repository.list();
  assert.ok(stored.every((receipt) => receipt.origin === "server_observed"));
  const forged = { ...stored.find((receipt) => receipt.readStatus === "partial"), success: true };
  const { evaluateRealReadVerification } = await import("../src/readinessEvidenceReceipt.js");
  assert.equal(evaluateRealReadVerification([forged], { environment: "local-server-observed-replay" }).verificationLevel, "locally_tested");
});
