#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "../src/config.js";
import { CURRENT_READ_ENDPOINTS, LIVE_CONFIRMATION } from "../src/readVerificationHarness.js";
import { buildReadOperatorExecutionPreflight, buildReadOperatorPlanSummary, buildReadOperatorSessionGate } from "../src/readVerificationOperator.js";

const usage = () => [
  "用法:",
  "  node scripts/controlled-read.mjs --store <storeId> --environment <name> --scope <name> --session-proof <proof.json> [--offer-count N] [--since ISO] [--to ISO] [--cutoff-from YYYY-MM-DD --cutoff-to YYYY-MM-DD] [--endpoints a,b] [--confirm I_CONFIRM_READ_ONLY] [--execute-live] [--out file] [--overwrite-audit]",
  "默认只校验计划；--execute-live 还必须提供服务端验证的 session proof 摘要，否则不会使用静态店铺密钥联网。已有审计文件默认不会覆盖，需显式 --overwrite-audit。",
].join("\n");

function parseArgs(argv) {
  const result = { endpoints: [...CURRENT_READ_ENDPOINTS] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (["--store", "--environment", "--scope", "--offer-count", "--since", "--to", "--cutoff-from", "--cutoff-to", "--delivering-date-from", "--delivering-date-to", "--endpoints", "--confirm", "--out", "--session-proof"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要值。`);
      const key = arg.slice(2).replaceAll("-", "_");
      result[key] = value;
    } else if (arg === "--execute-live") result.executeLive = true;
    else if (arg === "--overwrite-audit") result.overwriteAudit = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  if (typeof result.endpoints === "string") result.endpoints = result.endpoints.split(",").map((item) => item.trim()).filter(Boolean);
  result.offerCount = Math.max(0, Math.min(1000, Number(result.offer_count || 0)));
  return result;
}

function buildPlan(args, store) {
  return {
    store: { id: store.id, clientId: store.clientId },
    environment: String(args.environment || "").trim(),
    scope: {
      name: String(args.scope || "").trim(),
      offerCount: args.offerCount,
      ...(args.since ? { since: String(args.since).trim() } : {}),
      ...(args.to ? { to: String(args.to).trim() } : {}),
      ...(args.cutoff_from ? { cutoffFrom: String(args.cutoff_from).trim() } : {}),
      ...(args.cutoff_to ? { cutoffTo: String(args.cutoff_to).trim() } : {}),
      ...(args.delivering_date_from ? { deliveringDateFrom: String(args.delivering_date_from).trim() } : {}),
      ...(args.delivering_date_to ? { deliveringDateTo: String(args.delivering_date_to).trim() } : {}),
    },
    endpoints: args.endpoints,
    readOnly: true,
    writeAttempted: false,
    confirm: String(args.confirm || ""),
    maxAgeMs: 60 * 60 * 1000,
  };
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n${usage()}`); process.exitCode = 2; return; }
  if (args.help) { console.log(usage()); return; }
  let store;
  try { store = getStore(args.store || ""); } catch (error) { console.error(error.message); process.exitCode = 2; return; }
  const plan = buildPlan(args, store);
  let sessionProof = null;
  if (args.executeLive && !args.session_proof) {
    console.error(`--execute-live 必须同时提供 --session-proof。\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  if (args.session_proof) {
    try { sessionProof = JSON.parse(await fs.readFile(path.resolve(args.session_proof), "utf8")); }
    catch (error) { console.error(`无法读取本地 session proof：${error.message}`); process.exitCode = 2; return; }
  }
  const sessionGate = buildReadOperatorSessionGate(plan, { sessionProof });
  const planSummary = buildReadOperatorPlanSummary(plan);
  const outputPath = args.out ? path.resolve(args.out) : "";
  let outputExists = false;
  if (outputPath) {
    try {
      await fs.stat(outputPath);
      outputExists = true;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error(`无法检查审计输出文件：${error.message}`);
        process.exitCode = 2;
        return;
      }
    }
  }
  const baseExecutionPreflight = buildReadOperatorExecutionPreflight(plan, {
    executeLive: args.executeLive === true,
    outputPath: args.out,
    credentialAvailable: Boolean(store.apiKey),
    outputExists,
    allowOverwrite: args.overwriteAudit === true,
  });
  const executionPreflight = args.executeLive && !sessionGate.ok
    ? {
      ...baseExecutionPreflight,
      ok: false,
      executionAllowed: false,
      execution: "blocked",
      errors: [...baseExecutionPreflight.errors, ...sessionGate.errors.map(({ code, message }) => ({ code, message }))],
    }
    : baseExecutionPreflight;
  if (args.executeLive) {
    executionPreflight.ok = false;
    executionPreflight.executionAllowed = false;
    executionPreflight.execution = "blocked";
    executionPreflight.errors = [
      ...executionPreflight.errors,
      { code: "READ_OPERATOR_SERVER_EXECUTION_REQUIRED", message: "CLI 仅生成计划；真实读取必须转到已认证的 /api/ozon/read-operator/execute。" },
    ];
  }
  const output = {
    ...planSummary,
    execution: args.executeLive ? "blocked" : "not_started",
    executionPreflight,
    sessionGate,
    executionRoute: "/api/ozon/read-operator/execute",
    sideEffect: "仅校验本地计划和执行边界；未联网、未读取 Ozon、未写入或保存凭据。真实读取必须转到已认证的服务端 endpoint。",
  };
  const safeOutput = JSON.stringify(output, null, 2);
  if (args.out) await fs.writeFile(outputPath, `${safeOutput}\n`, "utf8");
  process.stdout.write(`${safeOutput}\n`);
  if (!executionPreflight.ok) process.exitCode = 1;
}

await main();
