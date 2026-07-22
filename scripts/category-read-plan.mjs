#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "../src/config.js";
import { buildCategoryReadPlanSummary, buildCategoryReadPlanBinding, buildCategoryReadRequests } from "../src/categoryReadPlan.js";

function usage() {
  return "用法: node scripts/category-read-plan.mjs --store <storeId> --environment <env> --category-id <id> --type-id <id> --attribute-ids <id,id,...> [--language ZH_HANS] [--out file]";
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (["--store", "--environment", "--category-id", "--type-id", "--attribute-ids", "--language", "--out"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要值。`);
      result[arg.slice(2).replaceAll("-", "_")] = value;
    } else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return result;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n${usage()}`); process.exitCode = 2; return; }
  if (args.help) { console.log(usage()); return; }
  let store;
  try { store = getStore(args.store || ""); } catch (error) { console.error(`${error.message}\n${usage()}`); process.exitCode = 2; return; }
  const plan = {
    store: { id: store.id, clientId: store.clientId },
    environment: args.environment,
    descriptionCategoryId: args.category_id,
    typeId: args.type_id,
    attributeIds: String(args.attribute_ids || "").split(",").map((value) => value.trim()).filter(Boolean),
    language: args.language || "ZH_HANS",
  };
  const summary = buildCategoryReadPlanSummary(plan);
  const requests = summary.ok ? buildCategoryReadRequests(plan).requests : [];
  const output = {
    summary,
    planBinding: summary.ok ? buildCategoryReadPlanBinding(plan) : "",
    requests,
    execution: "not_started",
    sideEffect: "仅生成并校验类目读取计划；不会联网、读取 Ozon、写入 Ozon 或保存凭据。",
    nextAction: summary.ok ? "人工确认后，把相同计划和绑定交给服务端受控只读入口。" : "修复计划参数后再考虑任何真实读取。",
  };
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) await fs.writeFile(path.resolve(args.out), text, "utf8");
  process.stdout.write(text);
  if (!summary.ok) process.exitCode = 1;
}

await main();
