import fs from "node:fs/promises";
import path from "node:path";

const JOB_FILE = path.resolve("data", "auto-listing-jobs.json");
const STOCK_FILE = path.resolve("data", "stock-queue.json");

function withinDays(iso, days) {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= days * 24 * 60 * 60 * 1000;
}

async function readItems(file, key) {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(raw[key]) ? raw[key] : [];
  } catch {
    return [];
  }
}

export async function buildKpiReport({ days = 7 } = {}) {
  const jobs = await readItems(JOB_FILE, "items");
  const stockJobs = await readItems(STOCK_FILE, "jobs");
  const scopedJobs = jobs.filter((j) => withinDays(j.updatedAt || j.createdAt, days));
  const scopedStock = stockJobs.filter((j) => withinDays(j.updatedAt || j.createdAt, days));

  const sampled = scopedJobs.length;
  const submitted = scopedJobs.filter((j) => j.status === "submitted" || j.status === "listed").length;
  const listed = scopedJobs.filter((j) => j.status === "listed").length;
  const failed = scopedJobs.filter((j) => j.status === "failed" || j.status === "listing_failed").length;

  const closureRate = sampled ? Number(((submitted / sampled) * 100).toFixed(2)) : 0;
  const firstPassRate = sampled ? Number((((submitted - failed) / sampled) * 100).toFixed(2)) : 0;
  const stockSuccess = scopedStock.filter((j) => j.status === "success").length;
  const stockTotal = scopedStock.length;
  const stockSuccessRate = stockTotal ? Number(((stockSuccess / stockTotal) * 100).toFixed(2)) : 0;

  const reasonCount = {};
  for (const j of scopedJobs.filter((x) => x.status === "failed" || x.status === "listing_failed")) {
    const key = String(j.reasonCode || "UNKNOWN");
    reasonCount[key] = (reasonCount[key] || 0) + 1;
  }
  const topReasons = Object.entries(reasonCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reasonCode, count]) => ({ reasonCode, count }));

  return {
    windowDays: days,
    generatedAt: new Date().toISOString(),
    metrics: {
      sampled,
      submitted,
      listed,
      failed,
      closureRate,
      firstPassRate,
      stockTotal,
      stockSuccess,
      stockSuccessRate,
    },
    topReasons,
    targets: {
      closureRate: ">=45%",
      firstPassRate: ">=55%",
      stockSuccessRate: ">=90%",
    },
  };
}

