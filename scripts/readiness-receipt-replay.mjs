import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { ReadinessEvidenceReceiptRepository } from "../src/readinessEvidenceReceipt.js";
import { runReadinessReceiptReplay } from "../src/readinessReceiptReplay.js";

const outIndex = process.argv.findIndex((arg) => arg === "--out");
const output = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6)
  || (outIndex >= 0 ? process.argv[outIndex + 1] : "")
  || path.join(os.tmpdir(), "ozon-readiness-receipt-replay.json");
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
const repository = new ReadinessEvidenceReceiptRepository({ file: `${output}.store.json` });
const result = await runReadinessReceiptReplay({ repository });
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  replayType: result.replayType,
  network: result.network,
  scenarios: result.scenarios.map(({ scenario, receipt, sellerTask, failureOnlyVerificationLevel }) => ({
    scenario,
    origin: receipt.origin,
    persisted: receipt.persisted,
    success: receipt.success,
    failureScenario: receipt.failureScenario,
    sellerTask: sellerTask.code,
    failureOnlyVerificationLevel,
  })),
  verificationLevel: result.verification.verificationLevel,
  output,
  sideEffect: result.sideEffect,
}, null, 2));
