import fs from "node:fs/promises";
import path from "node:path";
import { buildHealthSummary } from "../src/healthSummary.js";

const file = path.resolve("data", "auto-listing-jobs.json");

async function run() {
  let raw = null;
  let storageState = "present";
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      storageState = "missing";
      raw = { items: [] };
    }
    else storageState = "corrupt";
  }
  const summary = buildHealthSummary({ raw, storageState });
  console.log("[daily_health_check]", JSON.stringify(summary));
  if (!summary.ok) process.exitCode = 1;
}

run();
