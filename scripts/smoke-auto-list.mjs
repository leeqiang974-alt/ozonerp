const base = process.env.ERP_BASE_URL || "http://127.0.0.1:5178";

async function run() {
  const storesRes = await fetch(`${base}/api/stores`);
  if (!storesRes.ok) throw new Error(`stores http ${storesRes.status}`);
  const stores = await storesRes.json();
  if (!Array.isArray(stores.stores) || !stores.stores.length) throw new Error("no stores");

  const jobsRes = await fetch(`${base}/api/ozon-learning/auto-list-jobs`);
  if (!jobsRes.ok) throw new Error(`jobs http ${jobsRes.status}`);
  const jobs = await jobsRes.json();
  if (!Array.isArray(jobs.items)) throw new Error("invalid jobs payload");

  const bad = jobs.items.find((j) => !("status" in j) || !("updatedAt" in j));
  if (bad) throw new Error("job payload missing status/updatedAt");

  console.log(`smoke passed: stores=${stores.stores.length}, jobs=${jobs.items.length}`);
}

run().catch((e) => {
  console.error("smoke failed:", e.message);
  process.exit(1);
});

