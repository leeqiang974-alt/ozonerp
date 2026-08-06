const ERP_BASE = "http://localhost:8000";
const WORKER_ID_KEY = "ozonErpCrawlerWorkerId";
const HUMAN_CHECK_PAUSED_KEY = "ozonErpHumanCheckPaused";
let busyByType = {};
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
  if (message?.type === "OPEN_OZON_CAPTURE_TAB" && /^https:\/\/[^/]*ozon\.(ru|com|by|kz)\//i.test(message.url || "")) {
    chrome.tabs.create({ url: message.url, active: true }).then((tab) => sendResponse({ ok: true, tabId: tab.id }));
    return true;
  }
  if (message?.type === "OZON_ERP_CRAWLER_STATUS") {
    sendResponse({ ok: true, state: lastWorkerState });
    return false;
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

async function initializeCrawlerWorker() {
  ensureCrawlerAlarm();
  await setWorkerState({ status: "idle", job: null, message: "插件后台已启动", lastError: "", needsHuman: false });
}

function ensureCrawlerAlarm() {
  chrome.alarms.create("ozon-erp-crawler-poll", { periodInMinutes: 0.5 });
}

async function pollCrawlerJob(options = {}) {
  if (busyByType["poll"]) return;
  busyByType["poll"] = true;
  try {
    const humanPause = await getHumanCheckPause();
    if (!options.resume && humanPause?.paused) {
      await setWorkerState({
        status: "waiting_human",
        job: humanPause.job || lastWorkerState.job,
        message: "等待人工验证，自动采集已暂停",
        lastError: humanPause.message || lastWorkerState.lastError || "等待人工验证",
        needsHuman: true,
      });
      return;
    }
    await setWorkerState({ status: "checking", job: null, message: "正在检查 ERP 任务", lastError: "", needsHuman: false });
    const workerId = await getWorkerId();
    let data = { job: null };

    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const response = await fetch(`${ERP_BASE}/api/1688-crawler/extension/next?workerId=${encodeURIComponent(workerId)}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (response.ok) {
        const d = await response.json();
        if (d.job) data.job = d.job;
      }
    } catch {}

    if (!data.job) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 8000);
        const ozonResponse = await fetch(`${ERP_BASE}/api/ozon-learning/extension/next?workerId=${encodeURIComponent(workerId)}`, { signal: ctrl.signal });
        clearTimeout(tid);
        if (ozonResponse.ok) {
          const ozonData = await ozonResponse.json();
          if (ozonData.job) data.job = ozonData.job;
        }
      } catch {}
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
    busyByType["poll"] = false;
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
  // ozon_detail 走标签页模式（更可靠）
  if (job.kind === "ozon_detail") {
    let humanCheckDetected = false;
    const tab = await chrome.tabs.create({ url: job.url, active: false });
    try {
      await waitForTabLoad(tab.id);
      await sleep(3000 + Math.floor(Math.random() * 1000));
      await ensureContentScript(tab.id);
      const result = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_OZON_PRODUCT_DETAIL" });
      if (result?.needsHuman) {
        humanCheckDetected = true;
        await reportHumanCheck(job, tab.id, "Ozon 详情页需要人工验证");
      }
      await postJson("/api/ozon-learning/extension/detail-result", {
        jobId: job.id,
        storeId: job.storeId || "",
        payload: result?.ok ? result.payload : {},
        needsHuman: Boolean(result?.needsHuman),
        error: result?.ok ? "" : (result?.error || "采集失败"),
      });
      return { keepState: Boolean(result?.needsHuman) };
    } catch (error) {
      await postJson("/api/ozon-learning/extension/detail-result", {
        jobId: job.id,
        storeId: job.storeId || "",
        payload: {},
        needsHuman: false,
        error: error.message,
      });
      return { keepState: false };
    } finally {
      if (!humanCheckDetected && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  // 其他任务走标签页模式
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
  await fetch(`${ERP_BASE}${path}`, {
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
      currentJobId: lastWorkerState.job?.id || "",
      lastCheckAt: lastWorkerState.updatedAt,
      lastError: lastWorkerState.lastError || "",
      needsHuman: Boolean(lastWorkerState.needsHuman),
    };
    fetch(`${ERP_BASE}/api/1688-crawler/extension/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    fetch(`${ERP_BASE}/api/ozon-learning/extension/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ 快速详情采集（fetch + 正则，不开标签页） ============
async function fetchOzonDetailFast(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    const html = await res.text();

    const product = { url, title: "", price: "", rating: "", reviewCount: "", images: [], attributes: [], category: "", description: "" };

    // 标题
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (titleMatch) product.title = titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    // 价格
    const priceMatch = html.match(/"price":\s*"?(\d+)"?/);
    if (priceMatch) product.price = priceMatch[1];

    // 评分
    const ratingMatch = html.match(/"rating":\s*"?([\d.,]+)"?/);
    if (ratingMatch) product.rating = ratingMatch[1].replace(",", ".");

    // 评论数
    const reviewMatch = html.match(/"reviewCount":\s*(\d+)/);
    if (reviewMatch) product.reviewCount = reviewMatch[1];

    // 图片
    const imgMatches = html.matchAll(/"url":\s*"((?:https?:)?\/\/cdn\d*\.ozone\.ru\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/g);
    const seen = new Set();
    for (const m of imgMatches) {
      let u = m[1].replace(/\\/g, "");
      if (!seen.has(u)) { seen.add(u); product.images.push(u); }
      if (product.images.length >= 20) break;
    }

    // 属性 - 从 __NEXT_DATA__ 提取
    const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const widgetStates = data?.props?.pageProps?.layout?.widgetStates || {};
        for (const [, value] of Object.entries(widgetStates)) {
          if (!value || typeof value !== "object") continue;
          // 属性
          if (value.characteristics) {
            for (const group of (Array.isArray(value.characteristics) ? value.characteristics : [])) {
              for (const attr of (group.characteristics || group || [])) {
                if (attr.name && attr.value) {
                  product.attributes.push({ name: attr.name, value: String(attr.value) });
                }
              }
            }
          }
          // 类目
          if (value.breadcrumbs && Array.isArray(value.breadcrumbs)) {
            product.category = value.breadcrumbs.map(b => b.title || b.name || "").filter(Boolean).join(" > ");
          }
          // 价格覆盖
          if (value.price && !product.price) {
            product.price = String(value.price.price || value.price);
          }
          // 评分覆盖
          if (value.rating && !product.rating) {
            product.rating = String(value.rating);
          }
        }
      } catch {}
    }

    // 属性回退 - 从 HTML 文本提取
    if (product.attributes.length < 3) {
      const attrPatterns = html.matchAll(/"name":\s*"([^"]{1,60})",\s*"value":\s*"([^"]{1,200})"/g);
      for (const m of attrPatterns) {
        const name = m[1].trim();
        const value = m[2].trim();
        if (name && value && !product.attributes.some(a => a.name === name && a.value === value)) {
          product.attributes.push({ name, value });
        }
        if (product.attributes.length >= 40) break;
      }
    }

    // 描述 - 截取前 2000 字符
    const descMatch = html.match(/"description":\s*"((?:[^"\\]|\\.)*)"/);
    if (descMatch) product.description = descMatch[1].replace(/\\u[\da-f]{4}/gi, "").replace(/<[^>]+>/g, "").slice(0, 2000);

    return { ok: true, payload: product };
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, error: e.message };
  }
}
