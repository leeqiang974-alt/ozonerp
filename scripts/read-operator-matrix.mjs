#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_API_FILE, loadStores } from "../src/config.js";
import { buildApiEvidenceSummary } from "../src/apiEvidence.js";
import { LIVE_CONFIRMATION } from "../src/readVerificationHarness.js";
import { buildCanonicalReadOperatorSessionGate, buildReadOperatorPlanMatrixSummary } from "../src/readVerificationOperator.js";
import { buildReadEndpointRequest } from "../src/readEndpointRequest.js";

function usage() {
  return "用法: node scripts/read-operator-matrix.mjs --environment <env> --session-proof <proof.json> [--scope single_offer] [--offer-count N] [--endpoints a,b] [--category-id N --type-id N --attribute-id N] [--since ISO --to ISO] [--cutoff-from YYYY-MM-DD --cutoff-to YYYY-MM-DD] [--out file]";
}

// The full allowlist includes category dictionaries and FBS reads that need
// extra scope fields. A default single-offer plan must remain runnable, so
// those endpoints are opt-in through --endpoints.
const DEFAULT_OPERATOR_ENDPOINTS = ["/v3/product/list", "/v2/warehouse/list"];

function parseArgs(argv) {
  const result = { scope: "single_offer", offerCount: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (["--environment", "--scope", "--offer-count", "--endpoints", "--category-id", "--type-id", "--attribute-id", "--language", "--warehouse-ids", "--since", "--to", "--cutoff-from", "--cutoff-to", "--delivering-date-from", "--delivering-date-to", "--out", "--session-proof"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要值。`);
      result[arg.slice(2).replaceAll("-", "_")] = value;
    } else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  if (typeof result.endpoints === "string") result.endpoints = result.endpoints.split(",").map((item) => item.trim()).filter(Boolean);
  return result;
}

function buildPlanScope(args) {
  return {
    name: String(args.scope || "single_offer").trim(),
    offerCount: Math.max(0, Math.min(1000, Number(args.offer_count || args.offerCount || 1))),
    ...(args.category_id ? { descriptionCategoryId: Number(args.category_id) } : {}),
    ...(args.type_id ? { typeId: Number(args.type_id) } : {}),
    ...(args.attribute_id ? { attributeId: Number(args.attribute_id) } : {}),
    ...(args.language ? { language: String(args.language).trim() } : {}),
    ...(args.warehouse_ids ? { warehouseIds: String(args.warehouse_ids).split(/[,\s]+/).filter(Boolean) } : {}),
    ...(args.since ? { since: String(args.since).trim() } : {}),
    ...(args.to ? { to: String(args.to).trim() } : {}),
    ...(args.cutoff_from ? { cutoffFrom: String(args.cutoff_from).trim() } : {}),
    ...(args.cutoff_to ? { cutoffTo: String(args.cutoff_to).trim() } : {}),
    ...(args.delivering_date_from ? { deliveringDateFrom: String(args.delivering_date_from).trim() } : {}),
    ...(args.delivering_date_to ? { deliveringDateTo: String(args.delivering_date_to).trim() } : {}),
  };
}

function validateInitialEndpointScope(plan) {
  const dependentEndpoints = new Set(["/v3/product/info/list", "/v4/product/info/stocks"]);
  return plan.endpoints.flatMap((endpoint) => {
    if (dependentEndpoints.has(endpoint)) return [];
    const request = buildReadEndpointRequest(endpoint, plan.scope);
    return request.ok ? [] : [{ endpoint, code: request.reasonCode, message: request.message }];
  });
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n${usage()}`); process.exitCode = 2; return; }
  if (args.help) { console.log(usage()); return; }
  const environment = String(args.environment || "").trim();
  if (!environment || !args.session_proof) { console.error(`--environment 和 --session-proof 不能为空。\n${usage()}`); process.exitCode = 2; return; }
  const canonicalApiPath = DEFAULT_API_FILE;
  const stores = loadStores(canonicalApiPath);
  const endpoints = Array.isArray(args.endpoints) && args.endpoints.length ? args.endpoints : DEFAULT_OPERATOR_ENDPOINTS;
  const scope = buildPlanScope(args);
  const plans = stores.map((store) => ({ store: { id: store.id, clientId: store.clientId }, environment, scope, endpoints, readOnly: true, writeAttempted: false, confirm: LIVE_CONFIRMATION, maxAgeMs: 60 * 60 * 1000 }));
  let sessionProof;
  try { sessionProof = JSON.parse(await fs.readFile(path.resolve(args.session_proof), "utf8")); }
  catch (error) { console.error(`无法读取本地 session proof：${error.message}`); process.exitCode = 2; return; }
  const summary = buildReadOperatorPlanMatrixSummary(plans, { expectedPrimaryStoreCount: 4 });
  const endpointScopeErrors = [...new Map(plans.flatMap(validateInitialEndpointScope).map((error) => [`${error.endpoint}:${error.code}`, error])).values()];
  const sessionGate = buildCanonicalReadOperatorSessionGate(plans, { canonicalStores: stores, sessionProof, expectedPrimaryStoreCount: 4 });
  const apiEvidence = buildApiEvidenceSummary({ apiSourcePath: canonicalApiPath, sellerApiDocPath: "D:\\Desktop\\ozonseller api\\Ozon Seller API 文件.html" });
  const evidenceErrors = [];
  if (apiEvidence.canonicalStoreAudit.status !== "matched") evidenceErrors.push({ code: "READ_OPERATOR_CANONICAL_STORE_EVIDENCE_INVALID", message: "canonical 店铺来源不是恰好四个 primary 店铺，不能生成受控只读矩阵。" });
  if (apiEvidence.matrixConsistency.ok !== true) evidenceErrors.push({ code: "READ_OPERATOR_SELLER_API_DOCUMENT_STALE", message: "Seller API 本地文档与已审计矩阵基线不一致，不能把旧文档当作读取计划证据。" });
  const gatedSummary = { ...summary, ok: summary.ok && endpointScopeErrors.length === 0 && sessionGate.ok && evidenceErrors.length === 0, errors: [...summary.errors, ...endpointScopeErrors, ...evidenceErrors] };
  const output = {
    summaryType: "canonical_store_controlled_read_matrix",
    canonicalStoreCount: stores.length,
    expectedPrimaryStoreCount: 4,
    planMatrix: gatedSummary,
    endpointScopeErrors,
    evidenceGate: { canonicalStoreStatus: apiEvidence.canonicalStoreAudit.status, canonicalStoreCount: apiEvidence.canonicalStoreAudit.primaryStoreCount, sellerApiDocumentStatus: apiEvidence.matrixConsistency.status, sellerApiDocumentReasons: apiEvidence.matrixConsistency.reasons },
    sessionGate,
    execution: "not_started",
    sideEffect: "仅生成并校验四店铺只读计划；不会联网、读取 Ozon、写入 Ozon 或保存凭据。",
    nextAction: gatedSummary.ok ? "人工确认后，按同一计划逐店执行受控只读，并保存服务端脱敏回执。" : endpointScopeErrors.length ? "补齐当前端点所需类目/属性或 FBS 日期范围，或用 --endpoints 选择商品/仓库基线。" : "修复计划错误后再考虑任何真实读取。",
  };
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) await fs.writeFile(path.resolve(args.out), text, "utf8");
  process.stdout.write(text);
  if (!gatedSummary.ok) process.exitCode = 1;
}

await main();
