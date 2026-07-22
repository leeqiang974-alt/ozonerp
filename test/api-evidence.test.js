import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_MATRIX_DOCUMENT_BASELINE, buildApiEvidenceSummary, buildOperationEvidenceRecord, evaluateApiMatrixConsistency, inspectCanonicalStoreApi, inspectSellerApiDocument } from "../src/apiEvidence.js";

test("API evidence summary distinguishes local and real-read levels and keeps write safety text", () => {
  const summary = buildApiEvidenceSummary({ apiSourcePath: "missing-api.txt", sellerApiDocPath: "missing-doc.html", now: "2026-07-15T00:00:00.000Z" });
  assert.equal(summary.checkedAt, "2026-07-15T00:00:00.000Z");
  assert.equal(summary.sourceFiles.canonicalStoreApi.present, false);
  assert.equal(summary.sourceFiles.sellerApiDocument.present, false);
  assert.equal(summary.storeScope.canonicalStoreCount, null);
  assert.equal(summary.storeScope.expectedPrimaryStoreCount, 4);
  assert.equal(summary.counts.locally_tested, 6);
  assert.equal(summary.counts.real_read_verified || 0, 0);
  assert.match(summary.writeSafety, /人工确认/);
  assert.ok(summary.endpoints.some((entry) => entry.path === "/v3/product/import" && entry.kind === "write"));
  assert.equal(summary.matrixConsistency.ok, false);
  assert.ok(summary.matrixConsistency.reasons.includes("SELLER_API_DOCUMENT_MISSING"));
});

test("API evidence summary records the four-store canonical scope without counting duplicate profiles", () => {
  const summary = buildApiEvidenceSummary({ canonicalStoreCount: 4, sellerApiDocPath: "missing-doc.html" });
  assert.deepEqual(summary.storeScope, {
    canonicalStoreCount: 4,
    canonicalStoreCountVerified: false,
    expectedPrimaryStoreCount: 4,
    evidence: "调用方提供了店铺数量，但 canonical 文件审计未匹配；该数量不能作为四店铺证据。",
  });
});

test("provided four-store count cannot upgrade an unaudited canonical source", () => {
  const summary = buildApiEvidenceSummary({
    apiSourcePath: "missing-api.txt",
    canonicalStoreCount: 4,
    sellerApiDocPath: "missing-doc.html",
  });
  assert.equal(summary.storeScope.canonicalStoreCount, 4);
  assert.equal(summary.storeScope.canonicalStoreCountVerified, false);
  assert.match(summary.storeScope.evidence, /不能作为四店铺证据/);
  assert.equal(summary.canonicalStoreAudit.status, "missing");
});

test("canonical store audit keeps the four primary profiles and hashes duplicate-safe identities", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ozon-store-evidence-"));
  const filePath = path.join(dir, "ozonapi.txt");
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await fs.promises.writeFile(filePath, [
    "one", "100", uuid(1),
    "two", "200", uuid(2),
    "three", "300", uuid(3),
    "four", "400", uuid(4),
    "外部使用", "duplicate", "400", uuid(5),
    "个人使用", "duplicate", "400", uuid(6),
  ].join("\n"), "utf8");
  try {
    const evidence = inspectCanonicalStoreApi(filePath);
    assert.equal(evidence.status, "matched");
    assert.equal(evidence.primaryStoreCount, 4);
    assert.deepEqual(evidence.profileExclusions, { externalUse: 1, personalUse: 1 });
    assert.equal(evidence.storeRefHashes.length, 4);
    assert.equal(evidence.duplicateClientIds.length, 0);
    assert.doesNotMatch(JSON.stringify(evidence), /00000000-0000-4000-8000/);
    assert.equal(evidence.verificationLevel, "locally_tested");
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
});

test("API matrix gate rejects a changed Seller HTML fingerprint before claiming consistency", () => {
  const evidence = {
    present: true,
    sourceUrl: API_MATRIX_DOCUMENT_BASELINE.sourceUrl,
    contentHash: "sha256:" + "f".repeat(64),
    bytes: API_MATRIX_DOCUMENT_BASELINE.bytes,
    operationPaths: API_MATRIX_DOCUMENT_BASELINE.operationPaths,
  };
  const result = evaluateApiMatrixConsistency(evidence);
  assert.equal(result.ok, false);
  assert.equal(result.verificationEligible, false);
  assert.ok(result.reasons.includes("SELLER_API_DOCUMENT_FINGERPRINT_CHANGED"));
  assert.match(result.nextAction, /不升级任何验证等级/);
});

test("API matrix gate detects endpoint coverage drift even when the fingerprint is supplied", () => {
  const result = evaluateApiMatrixConsistency({
    present: true,
    sourceUrl: API_MATRIX_DOCUMENT_BASELINE.sourceUrl,
    contentHash: API_MATRIX_DOCUMENT_BASELINE.contentHash,
    bytes: API_MATRIX_DOCUMENT_BASELINE.bytes,
    operationPaths: API_MATRIX_DOCUMENT_BASELINE.operationPaths.slice(1),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingEndpoints, [API_MATRIX_DOCUMENT_BASELINE.operationPaths[0]]);
  assert.ok(result.reasons.includes("SELLER_API_DOCUMENT_ENDPOINT_COVERAGE_CHANGED"));
});

test("a matching Seller HTML fingerprint does not promote endpoints to real-read evidence", () => {
  const summary = buildApiEvidenceSummary({
    apiSourcePath: "missing-api.txt",
    sellerApiDocPath: "missing-doc.html",
  });
  const matched = evaluateApiMatrixConsistency({
    present: true,
    sourceUrl: API_MATRIX_DOCUMENT_BASELINE.sourceUrl,
    contentHash: API_MATRIX_DOCUMENT_BASELINE.contentHash,
    bytes: API_MATRIX_DOCUMENT_BASELINE.bytes,
    operationPaths: API_MATRIX_DOCUMENT_BASELINE.operationPaths,
  });
  assert.equal(matched.verificationEligible, true);
  assert.equal(summary.endpoints.every((entry) => entry.verification !== "real_read_verified"), true);
  assert.match(matched.nextAction, /真实账号/);
});

test("inspectSellerApiDocument records saved-from URL variants and priority operations", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ozon-api-doc-")), "seller.html");
  fs.writeFileSync(filePath, '<title>Ozon Seller API 文件</title><!-- saved from url=(0035)https://docs.ozon.ru/api/seller/zh/ --><div>/v3/product/import</div><div>/v1/product/import/info</div><div>/v2/products/stocks</div>');
  const evidence = inspectSellerApiDocument(filePath);
  assert.equal(evidence.title, "Ozon Seller API 文件");
  assert.equal(evidence.sourceUrl, "https://docs.ozon.ru/api/seller/zh/");
  assert.ok(evidence.bytes > 0);
  assert.match(evidence.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(evidence.operationPaths, ["/v3/product/import", "/v1/product/import/info", "/v2/products/stocks"]);
});

test("saved-from URL capture does not truncate hyphenated source URLs", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ozon-api-doc-url-")), "seller.html");
  fs.writeFileSync(filePath, '<!-- saved from url=(0048)https://docs.ozon.ru/api/seller/zh-cn/v1-beta/ -->');
  assert.equal(inspectSellerApiDocument(filePath).sourceUrl, "https://docs.ozon.ru/api/seller/zh-cn/v1-beta/");
});

test("buildOperationEvidenceRecord stores only hashed response metadata", () => {
  const record = buildOperationEvidenceRecord({
    operationPath: "/v1/product/import/info",
    checkedAt: "2026-07-15T01:02:03.000Z",
    statusCode: 200,
    response: { result: { items: [{ offer_id: "SAFE-OFFER" }] }, api_key: "must-not-persist" },
    verificationLevel: "server_observed",
    source: "seller-api-html-linked-read",
  });
  assert.equal(record.operationPath, "/v1/product/import/info");
  assert.match(record.responseHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(record.responsePersisted, false);
  assert.doesNotMatch(JSON.stringify(record), /must-not-persist/);
});

test("buildOperationEvidenceRecord rejects unverifiable levels and malformed status", () => {
  assert.throws(() => buildOperationEvidenceRecord({ operationPath: "/v1/test", statusCode: 200, verificationLevel: "production_ready" }), /verificationLevel/);
  assert.throws(() => buildOperationEvidenceRecord({ operationPath: "/v1/test", statusCode: 99 }), /statusCode/);
});

test("operation response hash is stable across object key order", () => {
  const first = buildOperationEvidenceRecord({ operationPath: "/v1/test", statusCode: 200, response: { z: 2, a: { y: 1, x: 0 } } });
  const second = buildOperationEvidenceRecord({ operationPath: "/v1/test", statusCode: 200, response: { a: { x: 0, y: 1 }, z: 2 } });
  assert.equal(first.responseHash, second.responseHash);
});
