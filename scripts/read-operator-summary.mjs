#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { buildReadOperatorPlanSummary } from "../src/readVerificationOperator.js";

function usage() {
  return "用法: node scripts/read-operator-summary.mjs --plan <plan.json> [--out <summary.json>]";
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan" || arg === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要文件路径。`);
      result[arg.slice(2)] = value;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return result;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.plan) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  let plan;
  try {
    const raw = await fs.readFile(path.resolve(args.plan), "utf8");
    plan = JSON.parse(raw);
  } catch (error) {
    console.error(`无法读取本地计划文件: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  // This command deliberately imports no server/client and has no request
  // transport. It is a local preflight summary, not a read execution.
  const summary = buildReadOperatorPlanSummary(plan);
  const output = `${JSON.stringify(summary, null, 2)}\n`;
  if (args.out) await fs.writeFile(path.resolve(args.out), output, "utf8");
  process.stdout.write(output);
  if (!summary.ok) process.exitCode = 1;
}

await main();

