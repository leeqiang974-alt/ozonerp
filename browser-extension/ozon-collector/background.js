const ERP_BASE = "http://localhost:5178";
const WORKER_ID_KEY = "ozonErpOzonWorkerId";
let busy = false;
let lastState = { status: "idle", job: null, message: "等待 ERP 任务", updatedAt: "" };

initializeWorker();

chrome.runtime.onInstalled.addListener(() => { initializeWorker(); pollJob(); });
chrome.runtime.onStartup.addListener(() => { initializeWorker(); pollJob(); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "ozon-erp-poll") pollJob(); });

async function pollJob() {
  if (busy) return;
  busy = true;
  await setState({ status: "checking", job: null, message: "正在检查 ERP 任务" });
  try {
    const wid = await getWorkerId();
    const resp = await fetch(ERP_BASE + "/api/ozon-learning/extension/next?workerId=" + encodeURIComponent(wid));
    if (!resp.ok) { await setState({ status: "error", job: null, message: "ERP " + resp.status }); return; }
    const data = await resp.json();
    if (!data.job) { await setState({ status: "idle", job: null, message: "暂无任务" }); return; }
    await setState({ status: "running", job: data.job, message: "执行 " + data.job.kind });
    await runJob(data.job);
    await setState({ status: "idle", job: null, message: "作业已回传" });
  } catch (e) {
    await setState({ status: "error", job: null, message: "ERP 未连接", lastError: e.message });
  } finally { busy = false; }
}

async function runJob(job) {
  if (job.kind === "ozon_search") {
    // Open search page and wait for content script
    const tab = await chrome.tabs.create({ url: job.url, active: false });
    await waitForTabLoad(tab.id);
    await sleep(3000);
    // Inject search extraction
    const results = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_SEARCH" }).catch(() => []);
    await fetch(ERP_BASE + "/api/ozon-learning/extension/search-result", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, items: results || [] }),
    });
    chrome.tabs.remove(tab.id);
  } else if (job.kind === "ozon_detail") {
    const tab = await chrome.tabs.create({ url: job.url, active: false });
    await waitForTabLoad(tab.id);
    await sleep(3000);
    const detail = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_DETAIL" }).catch(() => ({}));
    await fetch(ERP_BASE + "/api/ozon-learning/extension/detail-result", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, payload: detail }),
    });
    chrome.tabs.remove(tab.id);
  }
}

async function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === "complete") { chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    });
  });
}

async function getWorkerId() {
  let id = (await chrome.storage.local.get(WORKER_ID_KEY))[WORKER_ID_KEY];
  if (!id) { id = "ow_" + Date.now() + Math.random().toString(36).slice(2, 8); await chrome.storage.local.set({ [WORKER_ID_KEY]: id }); }
  return id;
}

async function setState(s) {
  lastState = { ...s, updatedAt: new Date().toISOString() };
  if (s.status === "idle" || s.status === "running") {
    // Heartbeat
    try { await fetch(ERP_BASE + "/api/ozon-learning/extension/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workerId: await getWorkerId(), status: lastState.status, message: lastState.message, currentJobId: lastState.job?.id || "" }) }); } catch(e) {}
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "OZON_ERP_STATUS") { sendResponse({ ok: true, state: lastState }); return false; }
  if (msg.type === "OZON_ERP_POLL") { pollJob(); sendResponse({ ok: true }); return false; }
});

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }