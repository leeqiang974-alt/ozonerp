const DEFAULT_ERP_BASE = "http://127.0.0.1:5178";
const LOOPBACK_ERP_BASES = ["http://127.0.0.1:5178", "http://localhost:5178"];
const ERP_BASE_URL_KEY = "ozonErpBaseUrl";
const ERP_SESSION_TOKEN_KEY = "ozonErpSessionToken";
let memorySessionToken = "";
const WORKER_ID_KEY = "ozonErpCrawlerWorkerId";
const HUMAN_CHECK_PAUSED_KEY = "ozonErpHumanCheckPaused";
let busy = false;
let lastWorkerState = {
  status: "idle",
  job: null,
  message: "等待 ERP 任务",
  updatedAt: "",
  lastError: "",
  needsHuman: false,
};

initializeCrawlerWorker();

chrome.runtime.onInstalled.addListener(() => {
  initializeCrawlerWorker();
  pollCrawlerJob();
});

chrome.runtime.onStartup.addListener(() => {
  initializeCrawlerWorker();
  pollCrawlerJob();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "ozon-erp-crawler-poll") pollCrawlerJob();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OZON_ERP_CRAWLER_STATUS") {
    sendResponse({ ok: true, state: lastWorkerState });
    return false;
  }
  if (message?.type === "OZON_ERP_API_REQUEST") {
    proxyErpRequest(message).then(sendResponse);
    return true;
  }
  if (message?.type === "OZON_ERP_CONFIG_STATUS") {
    getErpConfig().then((config) => sendResponse({ ok: true, baseUrl: config.base, tokenConfigured: Boolean(config.token) }));
    return true;
  }
  if (message?.type === "OZON_ERP_CONFIG_SAVE") {
    saveErpConfig(message).then((result) => sendResponse(result));
    return true;
  }
  if (message?.type === "OZON_ERP_CONFIG_CLEAR") {
    clearErpConfig().then((result) => sendResponse(result));
    return true;
  }
  if (message?.type === "OZON_ERP_CRAWLER_POLL_NOW") {
    pollCrawlerJob({ manual: true }).then(() => sendResponse({ ok: true, state: lastWorkerState }));
    return true;
  }
  if (message?.type === "OZON_ERP_CRAWLER_RESUME_AFTER_HUMAN") {
    resumeAfterHumanCheck().then(() => sendResponse({ ok: true, state: lastWorkerState }));
    return true;
  }
  return false;
});

async function proxyErpRequest(message) {
  try {
    const path = String(message.path || "");
    if (!path.startsWith("/api/")) throw new Error("不允许访问非 ERP API 路径");
    const response = await fetchWithErpFallback(path, {
      method: String(message.method || "GET").toUpperCase(),
      headers: {
        "Content-Type": "application/json",
      },
      body: message.body === undefined ? undefined : (typeof message.body === "string" ? message.body : JSON.stringify(message.body)),
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? "" : [data.error || `ERP 返回 HTTP ${response.status}`, data.reasonCode].filter(Boolean).join(" · "),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error.message || "ERP 连接失败",
    };
  }
}

function normalizeErpBase(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return DEFAULT_ERP_BASE;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("ERP 地址格式不正确"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("ERP 地址只允许 HTTP(S) 主机地址");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !loopback) throw new Error("外部 ERP 必须使用 HTTPS");
  return parsed.toString().replace(/\/+$/, "");
}

async function storageGet(area, keys) {
  if (!area?.get) return {};
  try { return await area.get(keys); } catch { return new Promise((resolve) => area.get(keys, resolve)); }
}

async function getErpConfig() {
  const local = await storageGet(chrome.storage?.local, [ERP_BASE_URL_KEY]);
  const session = await storageGet(chrome.storage?.session, [ERP_SESSION_TOKEN_KEY]);
  const base = normalizeErpBase(local[ERP_BASE_URL_KEY] || DEFAULT_ERP_BASE);
  const token = String(session[ERP_SESSION_TOKEN_KEY] || memorySessionToken || "").trim();
  return { base, token };
}

async function saveErpConfig(message) {
  try {
    const base = normalizeErpBase(message.baseUrl);
    await chrome.storage.local.set({ [ERP_BASE_URL_KEY]: base });
    const token = String(message.sessionToken || "").trim();
    if (token) {
      memorySessionToken = token;
      if (chrome.storage?.session?.set) await chrome.storage.session.set({ [ERP_SESSION_TOKEN_KEY]: token });
    } else {
      memorySessionToken = "";
      if (chrome.storage?.session?.remove) await chrome.storage.session.remove(ERP_SESSION_TOKEN_KEY);
    }
    return { ok: true, baseUrl: base, tokenConfigured: Boolean(token) };
  } catch (error) { return { ok: false, error: error.message || "ERP 配置无效" }; }
}

async function clearErpConfig() {
  await chrome.storage.local.remove(ERP_BASE_URL_KEY);
  memorySessionToken = "";
  if (chrome.storage?.session?.remove) await chrome.storage.session.remove(ERP_SESSION_TOKEN_KEY);
  return { ok: true, baseUrl: DEFAULT_ERP_BASE, tokenConfigured: false };
}

async function erpRequest(path, options = {}) {
  const config = await getErpConfig();
  const headers = { ...(options.headers || {}) };
  delete headers.Authorization;
  delete headers.authorization;
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const bases = config.base === DEFAULT_ERP_BASE ? LOOPBACK_ERP_BASES : [config.base];
  let lastError = null;
  for (const base of bases) {
    try { return await fetch(`${base}${path}`, { ...options, headers }); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error("ERP 连接失败");
}

async function fetchWithErpFallback(path, options = {}) {
  return erpRequest(path, options);
}

async function initializeCrawlerWorker() {
  ensureCrawlerAlarm();
  await setWorkerState({ status: "idle", job: null, message: "插件后台已启动", lastError: "", needsHuman: false });
}

function ensureCrawlerAlarm() {
  chrome.alarms.create("ozon-erp-crawler-poll", { periodInMinutes: 0.5 });
}

async function pollCrawlerJob(options = {}) {
  if (busy) return;
  const humanPause = await getHumanCheckPause();
  if (!options.resume && humanPause?.paused) {
    await setWorkerState({
      status: "waiting_human",
      job: humanPause.job || lastWorkerState.job,
      message: "等待人工验证，自动采集已暂停。处理完验证后点“恢复采集”继续",
      lastError: humanPause.message || lastWorkerState.lastError || "等待人工验证",
      needsHuman: true,
    });
    return;
  }
  busy = true;
  await setWorkerState({ status: "checking", job: null, message: "正在检查 ERP 任务", lastError: "", needsHuman: false });
  try {
    const workerId = await getWorkerId();
    const response = await erpRequest(`/api/1688-crawler/extension/next?workerId=${encodeURIComponent(workerId)}`);
    if (!response.ok) {
      await setWorkerState({ status: "error", job: null, message: `ERP 返回 ${response.status}`, lastError: `ERP 返回 ${response.status}` });
      return;
    }
    const data = await response.json();
    if (!data.job) {
      const ozonResponse = await erpRequest(`/api/ozon-learning/extension/next?workerId=${encodeURIComponent(workerId)}`);
      if (ozonResponse.ok) {
        const ozonData = await ozonResponse.json();
        if (ozonData.job) data.job = ozonData.job;
      }
    }
    if (!data.job) {
      await setWorkerState({ status: "idle", job: null, message: "暂无 ERP 采集任务", lastError: "", needsHuman: false });
      return;
    }
    await setWorkerState({ status: "running", job: data.job, message: `正在执行 ${data.job.kind} 作业`, lastError: "", needsHuman: false });
    const result = await runJob(data.job);
    if (!result?.keepState) {
      await setWorkerState({ status: "idle", job: null, message: "作业已回传，等待下一轮", lastError: "", needsHuman: false });
    }
  } catch (error) {
    await setWorkerState({ status: "error", job: null, message: "ERP 未连接或后台任务失败", lastError: error.message || "ERP 未连接或后台任务失败" });
  } finally {
    busy = false;
  }
}

async function setWorkerState(patch) {
  lastWorkerState = {
    ...lastWorkerState,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await sendHeartbeat();
}

async function getWorkerId() {
  const saved = await chrome.storage.local.get([WORKER_ID_KEY]);
  if (saved[WORKER_ID_KEY]) return saved[WORKER_ID_KEY];
  const id = `cw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await chrome.storage.local.set({ [WORKER_ID_KEY]: id });
  return id;
}

async function runJob(job) {
  const isOzonJob = String(job.kind || "").startsWith("ozon_");
  let humanCheckDetected = false;
  const tab = await chrome.tabs.create({ url: job.url, active: job.kind === "discover" || job.kind === "ozon_search" });
  try {
    await waitForTabLoad(tab.id);
    await sleep((isOzonJob ? 2600 : 1800) + Math.floor(Math.random() * 1400));
    await ensureContentScript(tab.id);
    if (job.kind === "ozon_search") {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "EXTRACT_OZON_SEARCH_ITEMS",
        maxProducts: Number(job.maxProducts || 30),
      });
      if (result?.needsHuman) {
        humanCheckDetected = true;
        await reportHumanCheck(job, tab.id, "Ozon 页面需要人工验证或登录");
      }
      await postJson("/api/ozon-learning/extension/search-result", {
        jobId: job.id,
        items: result?.items || [],
        needsHuman: Boolean(result?.needsHuman),
        error: result?.error || (result?.needsHuman ? "Ozon 页面需要人工验证或登录" : ""),
      });
      return { keepState: Boolean(result?.needsHuman) };
    }
    if (job.kind === "ozon_detail") {
      const result = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_OZON_PRODUCT_DETAIL" });
      if (result?.needsHuman) {
        humanCheckDetected = true;
        await reportHumanCheck(job, tab.id, result?.error || "Ozon 页面需要人工验证或登录");
      }
      await postJson("/api/ozon-learning/extension/detail-result", {
        jobId: job.id,
        payload: result?.payload || {},
        needsHuman: Boolean(result?.needsHuman),
        error: result?.error || "",
      });
      return { keepState: Boolean(result?.needsHuman) };
    }
    if (job.kind === "discover") {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "EXTRACT_1688_OFFER_LINKS",
        maxProducts: Number(job.maxProducts || 20),
      });
      if (result?.needsHuman) {
        humanCheckDetected = true;
        await reportHumanCheck(job, tab.id, "1688 页面需要人工验证");
      }
      await postJson("/api/1688-crawler/extension/discover-result", {
        jobId: job.id,
        urls: result?.urls || [],
        needsHuman: Boolean(result?.needsHuman),
        error: result?.needsHuman ? "1688 页面需要人工验证" : "",
      });
      return { keepState: Boolean(result?.needsHuman) };
    }
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "COLLECT_1688_PRODUCT_RAW",
      includeVideo: true,
      storeId: job.storeId || "",
    });
    if (result?.needsHuman) {
      humanCheckDetected = true;
      await reportHumanCheck(job, tab.id, result?.error || "1688 页面需要人工验证");
    }
    await postJson("/api/1688-crawler/extension/detail-result", {
      jobId: job.id,
      payload: result?.payload || {},
      needsHuman: Boolean(result?.needsHuman),
      error: result?.error || "",
    });
    return { keepState: Boolean(result?.needsHuman) };
  } catch (error) {
    const path = job.kind === "ozon_search"
      ? "/api/ozon-learning/extension/search-result"
      : job.kind === "ozon_detail"
        ? "/api/ozon-learning/extension/detail-result"
        : job.kind === "discover"
      ? "/api/1688-crawler/extension/discover-result"
      : "/api/1688-crawler/extension/detail-result";
    await setWorkerState({
      status: "error",
      job,
      message: "作业执行失败",
      lastError: error.message,
      needsHuman: false,
    });
    await postJson(path, { jobId: job.id, needsHuman: false, error: error.message });
    return { keepState: true };
  } finally {
    if (!humanCheckDetected && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function reportHumanCheck(job, tabId, message) {
  await setHumanCheckPause(job, message);
  if (tabId) chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await setWorkerState({
    status: "waiting_human",
    job,
    message: `${message}。自动采集已暂停，当前验证页已保留。处理完验证后点“恢复采集”继续`,
    lastError: message,
    needsHuman: true,
  });
}

async function isHumanCheckPaused() {
  return Boolean((await getHumanCheckPause())?.paused);
}

async function getHumanCheckPause() {
  const saved = await chrome.storage.local.get([HUMAN_CHECK_PAUSED_KEY]);
  return saved[HUMAN_CHECK_PAUSED_KEY] || null;
}

async function setHumanCheckPause(job, message) {
  chrome.alarms.clear("ozon-erp-crawler-poll");
  await chrome.storage.local.set({
    [HUMAN_CHECK_PAUSED_KEY]: {
      paused: true,
      job,
      message,
      pausedAt: new Date().toISOString(),
    },
  });
}

async function clearHumanCheckPause() {
  await chrome.storage.local.remove(HUMAN_CHECK_PAUSED_KEY);
}

async function resumeAfterHumanCheck() {
  const humanPause = await getHumanCheckPause();
  await clearHumanCheckPause();
  ensureCrawlerAlarm();
  if (humanPause?.job?.taskId && !String(humanPause.job.kind || "").startsWith("ozon_")) {
    await postJson(`/api/1688-crawler/tasks/${encodeURIComponent(humanPause.job.taskId)}/resume`, {});
  }
  await pollCrawlerJob({ resume: true });
}

async function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, 30000);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING_1688_COLLECTOR" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }
}

async function postJson(path, payload) {
  await erpRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function sendHeartbeat() {
  try {
    const workerId = await getWorkerId();
    const payload = {
      workerId,
      status: lastWorkerState.status,
      message: lastWorkerState.message,
      currentJob: lastWorkerState.job,
      currentJobId: lastWorkerState.job?.id || "",
      lastCheckAt: lastWorkerState.updatedAt,
      lastError: lastWorkerState.lastError || "",
      needsHuman: Boolean(lastWorkerState.needsHuman),
      userAgent: navigator.userAgent,
    };
    await erpRequest("/api/1688-crawler/extension/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await erpRequest("/api/ozon-learning/extension/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // ERP may be closed; popup still shows the local worker state.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
