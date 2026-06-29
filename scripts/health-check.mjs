import fs from "node:fs/promises";
import path from "node:path";

const file = path.resolve("data", "auto-listing-jobs.json");

function within24h(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() <= 24 * 60 * 60 * 1000;
}

function topReasons(items) {
  const map = new Map();
  for (const it of items) {
    const key = (it.reasonCode || it.error || "UNKNOWN").slice(0, 80);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

async function run() {
  let items = [];
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    items = Array.isArray(raw.items) ? raw.items : [];
  } catch {
    items = [];
  }
  const last24 = items.filter((x) => within24h(x.updatedAt || x.createdAt));
  const failed = last24.filter((x) => x.status === "failed").length;
  const listed = last24.filter((x) => x.status === "listed" || x.status === "submitted").length;
  const listingFailed = last24.filter((x) => x.status === "listing_failed").length;
  const timeout = last24.filter((x) => (x.error || "").includes("超时")).length;
  const summary = {
    ts: new Date().toISOString(),
    total24h: last24.length,
    failed,
    listed,
    listingFailed,
    timeout,
    topReasons: topReasons(last24),
  };
  console.log("[daily_health_check]", JSON.stringify(summary));
}

run();

