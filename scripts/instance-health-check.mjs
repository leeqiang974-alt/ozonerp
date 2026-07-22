import fs from "node:fs/promises";
import { buildMultiInstanceHealthReport } from "../src/instanceHealth.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/instance-health-check.mjs <instances.json>");
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(await fs.readFile(file, "utf8"));
    const instances = Array.isArray(input) ? input : input.instances;
    const result = buildMultiInstanceHealthReport(instances, {
      expectedRelease: process.env.APP_RELEASE || "",
    });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, reasonCode: "INSTANCE_INPUT_INVALID", message: error.message }));
    process.exitCode = 1;
  }
}
