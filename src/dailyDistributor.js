import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API = process.env.OZON_ERP_API_BASE || "http://127.0.0.1:5178";
const DAILY_LIMIT_PER_STORE = Number(process.env.OZON_DAILY_LIMIT_PER_STORE || 100);
const MAX_CONCURRENT_JOBS = Number(process.env.OZON_MAX_CONCURRENT_JOBS || 8);
const LOOP_MS = Number(process.env.OZON_DISTRIBUTOR_LOOP_MS || 15000);
const MAX_RETRY_PER_OPPORTUNITY_PER_DAY = Number(process.env.OZON_MAX_RETRY_PER_OPPORTUNITY_PER_DAY || 3);
const BLIND_RUN_BATCH = Number(process.env.OZON_BLIND_RUN_BATCH || 8);
const ALLOW_VOLUME_FALLBACK_SUBMIT = String(process.env.OZON_ALLOW_VOLUME_FALLBACK_SUBMIT || "0") === "1";
const AUTOMATION_ENABLED = distributorAutomationEnabled(process.env);
const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "daily-distributor-state.json");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
export function distributorAutomationEnabled(env = process.env) {
  return String(env.OZON_DISTRIBUTOR_AUTORUN || "0") === "1";
}

export function serverAutoHealEnabled(env = process.env) {
  return String(env.OZON_SERVER_AUTO_HEAL || "0") === "1";
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function http(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || data?.message || `${res.status} ${res.statusText}`);
  return data;
}

async function readState() {
  try {
    const raw = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function normalizeDailyState(state = {}, day = todayKey()) {
  const next = state && typeof state === "object" ? { ...state } : {};
  if (next.attemptsDay !== day) {
    next.attemptsDay = day;
    next.attemptsByOpportunity = {};
  } else if (!next.attemptsByOpportunity || typeof next.attemptsByOpportunity !== "object") {
    next.attemptsByOpportunity = {};
  }
  return next;
}

function isRunningStatus(status) {
  return [
    "translating",
    "searching_1688",
    "waiting_crawl",
    "matching",
    "generating_content",
    "ready_for_listing",
    "listing",
    "submitted_to_ozon",
  ].includes(String(status || ""));
}

function chooseStore(stores, successMap) {
  const candidates = stores
    .map((s) => ({ store: s, success: Number(successMap[s.id] || 0) }))
    .filter((row) => row.success < DAILY_LIMIT_PER_STORE)
    .sort((a, b) => a.success - b.success);
  return candidates.length ? candidates[0].store : null;
}

function isSafeAutoSubmitJob(job) {
  if (job.status !== "ready_for_listing") return false;
  const tier = String(job.bestMatch?.matchTier || "");
  if (tier === "volume_profit_fallback" && !ALLOW_VOLUME_FALLBACK_SUBMIT) return false;
  return true;
}

async function filterStoresWithWarehouses(stores) {
  const usable = [];
  let stockJobs = [];
  try {
    const queue = await http("GET", "/api/ozon/stock-queue");
    stockJobs = Array.isArray(queue.jobs) ? queue.jobs : [];
  } catch (e) {
    console.log("[distributor] stock-queue-read-failed", e.message);
  }
  const blockedByStore = new Map();
  for (const job of stockJobs) {
    if (String(job.reasonCode || "") !== "STOCK_WAREHOUSE_INVALID") continue;
    const storeId = String(job.storeId || "");
    if (!storeId) continue;
    if (!blockedByStore.has(storeId)) blockedByStore.set(storeId, new Set());
    for (const stock of job.stocks || []) {
      const warehouseId = Number(stock.warehouse_id || 0);
      if (warehouseId) blockedByStore.get(storeId).add(warehouseId);
    }
  }
  for (const store of stores) {
    try {
      const data = await http("GET", `/api/ozon/warehouses?storeId=${encodeURIComponent(store.id)}`);
      const warehouses = Array.isArray(data.warehouses) ? data.warehouses : (Array.isArray(data.result) ? data.result : []);
      const blocked = blockedByStore.get(store.id) || new Set();
      const ok = warehouses.some((w) => {
        const warehouseId = Number(w.warehouse_id || w.id || 0);
        return warehouseId && !blocked.has(warehouseId) && (w.status === "created" || w.is_rfbs || w.is_rf !== false);
      });
      if (ok) usable.push(store);
      else console.log("[distributor] store-skip-blocked-warehouse", { storeId: store.id, blocked: [...blocked] });
    } catch (e) {
      console.log("[distributor] store-skip-no-warehouse", { storeId: store.id, error: e.message });
    }
  }
  return usable;
}

function shuffle(arr = []) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickDiverse(items = [], limit = 1) {
  const picked = [];
  const usedCats = new Set();
  for (const it of items) {
    const cat = String(it.category || "").split(">").slice(-2).join(">").trim() || "unknown";
    if (usedCats.has(cat)) continue;
    picked.push(it);
    usedCats.add(cat);
    if (picked.length >= limit) return picked;
  }
  for (const it of items) {
    if (picked.length >= limit) break;
    if (!picked.find((x) => x.id === it.id)) picked.push(it);
  }
  return picked;
}

async function main() {
  console.log("[distributor] started", { API, DAILY_LIMIT_PER_STORE, MAX_CONCURRENT_JOBS, LOOP_MS, automationEnabled: AUTOMATION_ENABLED });
  for (;;) {
    try {
      const storesResp = await http("GET", "/api/stores");
      const stores = Array.isArray(storesResp.stores) ? storesResp.stores : [];
      if (!stores.length) {
        console.log("[distributor] no stores configured");
        await sleep(LOOP_MS);
        continue;
      }

      const usableStores = await filterStoresWithWarehouses(stores);
      if (!usableStores.length) {
        console.log("[distributor] no stores with usable warehouses");
        await sleep(LOOP_MS);
        continue;
      }

      const jobsResp = await http("GET", "/api/ozon-learning/auto-list-jobs");
      const jobs = Array.isArray(jobsResp.items) ? jobsResp.items : [];
      const day = todayKey();
      const successMap = {};
      for (const s of usableStores) successMap[s.id] = 0;
      for (const job of jobs) {
        if (!["listed", "live", "submitted"].includes(String(job.status || ""))) continue;
        const updated = String(job.updatedAt || "");
        if (!updated.startsWith(day)) continue;
        const sid = job.listingResult?.storeId;
        if (sid && successMap[sid] !== undefined) successMap[sid] += 1;
      }

      // Submit all ready jobs immediately with least-loaded store.
      const readyJobs = jobs.filter(isSafeAutoSubmitJob);
      if (AUTOMATION_ENABLED) {
        for (const job of readyJobs) {
          const store = chooseStore(usableStores, successMap);
          if (!store) break;
          try {
            const result = await http("POST", "/api/ozon-learning/complete-listing", { jobId: job.id, storeId: store.id });
            console.log("[distributor] submitted", { jobId: job.id, storeId: store.id, sku: result?.sku, taskId: result?.taskId });
          } catch (e) {
            console.log("[distributor] submit-failed", { jobId: job.id, error: e.message });
          }
        }
      } else if (readyJobs.length) {
        console.log("[distributor] automation-disabled-ready-jobs", { count: readyJobs.length });
      }

      // Refresh counters after submit/processing.
      const jobsResp2 = await http("GET", "/api/ozon-learning/auto-list-jobs");
      const jobs2 = Array.isArray(jobsResp2.items) ? jobsResp2.items : [];
      const running = jobs2.filter((j) => isRunningStatus(j.status)).length;

      // Trigger new auto-list tasks when below concurrency.
      const canStart = Math.max(0, MAX_CONCURRENT_JOBS - running);
      if (canStart > 0 && AUTOMATION_ENABLED) {
        let itemsResp = await http("GET", "/api/ozon-learning/items");
        let items = Array.isArray(itemsResp.items) ? itemsResp.items : [];
        const state = normalizeDailyState(await readState(), day);
        const seen = state.seenOpportunityIds && typeof state.seenOpportunityIds === "object" ? state.seenOpportunityIds : {};
        const attempts = state.attemptsByOpportunity && typeof state.attemptsByOpportunity === "object" ? state.attemptsByOpportunity : {};
        const startedToday = [];
        const activeOpp = new Set(
          jobs2
            .filter((j) => isRunningStatus(j.status) || ["needs_review", "submitted", "live"].includes(String(j.status || "")))
            .map((j) => j.opportunityId),
        );
        const failedTodayCount = {};
        for (const job of jobs2) {
          if (job.status !== "failed") continue;
          const dayKey = String(job.updatedAt || "");
          if (!dayKey.startsWith(day)) continue;
          const oid = String(job.opportunityId || "");
          if (!oid) continue;
          failedTodayCount[oid] = Number(failedTodayCount[oid] || 0) + 1;
        }
        let candidates = items
          .filter((it) => !it.excluded && it.status === "detailed")
          .filter((it) => !activeOpp.has(it.id))
          .filter((it) => {
            const failCount = Number(failedTodayCount[it.id] || 0);
            const tried = Number(attempts[it.id] || 0);
            return Math.max(failCount, tried) < MAX_RETRY_PER_OPPORTUNITY_PER_DAY;
          });
        // If pool is too small, proactively create a new blind-run sampling batch.
        if (candidates.length < Math.max(2, Math.ceil(canStart / 2))) {
          try {
            await http("POST", "/api/ozon-learning/blind-run", { count: BLIND_RUN_BATCH });
            await sleep(2500);
            itemsResp = await http("GET", "/api/ozon-learning/items");
            items = Array.isArray(itemsResp.items) ? itemsResp.items : [];
            candidates = items
              .filter((it) => !it.excluded && it.status === "detailed")
              .filter((it) => !activeOpp.has(it.id))
              .filter((it) => {
                const failCount = Number(failedTodayCount[it.id] || 0);
                const tried = Number(attempts[it.id] || 0);
                return Math.max(failCount, tried) < MAX_RETRY_PER_OPPORTUNITY_PER_DAY;
              });
          } catch (e) {
            console.log("[distributor] blind-run-failed", e.message);
          }
        }
        candidates = pickDiverse(shuffle(candidates), Math.min(canStart, candidates.length));
        for (let i = 0; i < Math.min(canStart, candidates.length); i += 1) {
          const item = candidates[i];
          try {
            const r = await http("POST", "/api/ozon-learning/auto-list", { itemId: item.id });
            startedToday.push({ itemId: item.id, jobId: r.jobId });
            seen[item.id] = day;
            attempts[item.id] = Number(attempts[item.id] || 0) + 1;
            console.log("[distributor] started", { itemId: item.id, jobId: r.jobId, title: item.title });
          } catch (e) {
            console.log("[distributor] start-failed", { itemId: item.id, error: e.message });
          }
        }
        state.seenOpportunityIds = seen;
        state.attemptsByOpportunity = attempts;
        state.lastRunAt = new Date().toISOString();
        state.lastStarted = startedToday;
        state.successMap = successMap;
        await writeState(state);
      }

      console.log("[distributor] heartbeat", { running, ready: readyJobs.length, successMap, automationEnabled: AUTOMATION_ENABLED });
    } catch (e) {
      console.log("[distributor] error", e.message);
    }
    await sleep(LOOP_MS);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[distributor] fatal", e);
    process.exit(1);
  });
}
