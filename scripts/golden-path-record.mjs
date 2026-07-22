#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createGoldenPathRecord } from "../src/goldenPathRecord.js";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "force") {
      args.force = true;
      continue;
    }
    args[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "";
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const record = createGoldenPathRecord({
  replayId: args["replay-id"] || args.replayId,
  productShape: args.shape || args["product-shape"],
  sourceUrl: args.url,
  recordedAt: args["recorded-at"],
});
const output = `${JSON.stringify(record, null, 2)}\n`;
if (args.out) {
  const destination = path.resolve(args.out);
  try {
    if (!args.force) await fs.access(destination);
    if (!args.force) throw new Error("RECORD_EXISTS_USE_FORCE");
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.message !== "RECORD_EXISTS_USE_FORCE") throw error;
    if (error?.message === "RECORD_EXISTS_USE_FORCE") throw error;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, output, "utf8");
}
process.stdout.write(output);
