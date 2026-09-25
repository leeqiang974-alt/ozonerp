// [Iteration 2026-09-25 v0.7.73] Version sync for embedded Ozon collection and M.Video single-SKU dry-run preview.
// [Iteration 2026-09-23 v0.7.72] (no background logic change; version sync: collectOzonDetail returned payload now includes the precise packageInfo)
// [Iteration 2026-09-23 v0.7.71] (no background logic change; version sync for packageInfo parser fix in content.js)
// [Iteration 2026-09-23 v0.7.70] Seller backend: keep BOTH seller.ozonru.cn (new) and seller.ozon.ru; query the seller tab across both domains and call what_to_sell API via that tab's location.origin.
// [Iteration 2026-09-23 v0.7.69] Extract package weight/dimensions from entrypoint webCharacteristics (Weight/Dimensions) into packageInfo; backend bridge already maps packageInfo to variant weight_g/length/width/height.
// [Iteration 2026-09-22 v0.7.68] JSON-LD read from DOM ld+json (brand/rating/price); synced with content.js v0.7.68.
// [Iteration 2026-09-22 v0.7.67] Ozon PDP video/brand/category/rating extraction synced with content.js v0.7.67.
// [Iteration 2026-09-22 v0.7.66] Factory "rescan missing" re-triggers the scroll scan after resync (was returning early); content only POSTs newly seen offers; background queue logic unchanged.
// [Iteration 2026-09-22 v0.7.65] Full-shop scan now supports the new 1688 factory catalog (sale.1688.com/factory) via scroll+DOM; background queue logic unchanged.
// Ozon ERP runs on the dedicated LAN notebook. Amazon CBT collection remains
// on the separate Mercado Libre ERP queue; the two flows must not mix.
const ERP_BASE = "http://192.168.0.147:8000";
const ERP_ALLOWED_HOSTS = new Set(["192.168.0.147", "127.0.0.1", "localhost"]);
const MELI_BASE = "https://ml-erp.woxq.cn";
const WORKER_ID_KEY = "ozonErpCrawlerWorkerId";
const HUMAN_CHECK_PAUSED_KEY = "ozonErpHumanCheckPaused";
let busyByType = {};
// 【2026-09-22 迭代】记录每个 slot 持锁时间，配合看门狗给僵死任务解锁，
// 防止单个 Amazon 标签页采集卡死（sendMessage 永不返回）锁死整条串行队列。
let busySince = {};
// 【2026-09-22 迭代】通用超时包装：Amazon 采集消息/content script 一旦卡住，
// 到时强制 reject，由外层 catch 回传 failed、关闭标签页并释放 slot 锁。
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label || "操作超时")), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
let lastWorkerState = {
  status: "idle",
  job: null,
  message: "等待 ERP 任务",
  updatedAt: "",
  lastError: "",
  needsHuman: false,
};

initializeCrawlerWorker().then(() => startCrawlerSlots());

chrome.runtime.onInstalled.addListener(() => {
  initializeCrawlerWorker();
  startCrawlerSlots();
});

chrome.runtime.onStartup.addListener(() => {
  initializeCrawlerWorker();
  startCrawlerSlots();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "ozon-erp-crawler-poll") startCrawlerSlots();
  if (alarm.name === "ozon-erp-crawler-next-0") pollCrawlerJob({ slot: 0 });
  if (alarm.name === "ozon-erp-crawler-next-1") pollCrawlerJob({ slot: 1 });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FETCH_1688_DETAIL_IMAGES") {
    fetch1688DetailImages(message.url).then(sendResponse);
    return true;
  }
  if (message?.type === "OZON_ERP_REQUEST") {
    proxyErpRequest(message).then(sendResponse);
    return true;
  }
  if (message?.type === "MELI_AMAZON_CAPTURE") {
    fetch("https://ml-erp.woxq.cn/api/imports/amazon-extension/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload || {}),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (response.ok) await notifyMeliErpTabs({ draftId: data?.id ?? data?.draft_id ?? data?.draft?.id });
      sendResponse(response.ok ? { ok: true, data } : { ok: false, error: data.detail || `美客多 ERP 返回 HTTP ${response.status}` });
    }).catch((error) => sendResponse({ ok: false, error: error?.message || "无法连接美客多 ERP" }));
    return true;
  }
  if (message?.type === "MELI_AMAZON_RECOLLECT") {
    recollectAmazonForMeli(message).then(sendResponse);
    return true;
  }
  if (message?.type === "OPEN_OZON_CAPTURE_TAB" && /^https:\/\/[^/]*ozon\.(ru|com|by|kz)\//i.test(message.url || "")) {
    chrome.tabs.create({ url: message.url, active: true }).then((tab) => sendResponse({ ok: true, tabId: tab.id }));
    return true;
  }
  if (message?.type === "OZON_ERP_CRAWLER_STATUS") {
    sendResponse({ ok: true, state: lastWorkerState });
    return false;
  }
  if (message?.type === "OZON_FETCH_SALES_DATA") {
    fetchOzonSalesFromSellerTab(message.productId).then(sendResponse);
    return true;
  }
  if (message?.type === "OZON_ERP_CRAWLER_POLL_NOW") {
    Promise.all([pollCrawlerJob({ manual: true, slot: 0 }), pollCrawlerJob({ manual: true, slot: 1 })])
      .then(() => sendResponse({ ok: true, state: lastWorkerState }));
    return true;
  }
  // 【2026-09-22 迭代】ERP 页面保活心跳：唤醒被浏览器节流/休眠的 service worker，
  // 并只驱动美客多 Amazon 采集 slot0（不碰局域网 Ozon slot1）。
  if (message?.type === "MELI_KEEPALIVE_POLL") {
    pollCrawlerJob({ slot: 0 })
      .then(() => sendResponse({ ok: true, state: lastWorkerState }))
      .catch(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "OZON_ERP_CRAWLER_RESUME_AFTER_HUMAN") {
    resumeAfterHumanCheck().then(() => sendResponse({ ok: true, state: lastWorkerState }));
    return true;
  }
  return false;
});

async function notifyMeliErpTabs(detail) {
  const tabs = await chrome.tabs.query({ url: "https://ml-erp.woxq.cn/*" });
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(
    tab.id,
    { type: "MELI_AMAZON_DRAFT_READY", draftId: Number(detail?.draftId) || null },
  ).catch(() => {})));
}

async function recollectAmazonForMeli(message) {
  const sourceProductId = Number(message.sourceProductId);
  const sourceUrl = String(message.sourceUrl || "").trim();
  if (!Number.isInteger(sourceProductId) || sourceProductId < 1 || !/^https:\/\/[^/]*amazon\./i.test(sourceUrl)) {
    return { ok: false, error: "Amazon 重采集请求无效" };
  }
  let tab;
  let keepTabOpenForHumanCheck = false;
  try {
    const recollectUrl = new URL(sourceUrl);
    recollectUrl.hash = `meli-recollect-source=${sourceProductId}`;
    // Keep normal recollection out of the seller's way. We only foreground the
    // tab when Amazon asks the seller to log in or complete verification.
    tab = await chrome.tabs.create({ url: recollectUrl.toString(), active: false });
    await waitForTabLoad(tab.id);
    await sleep(1800);
    let captured;
    try {
      captured = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_MELI_AMAZON_PRODUCT", automatic: true, sourceProductId });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["amazon-content.js"] });
      captured = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_MELI_AMAZON_PRODUCT", automatic: true, sourceProductId });
    }
    if (!captured?.ok) {
      if (captured?.needsHuman) {
        keepTabOpenForHumanCheck = true;
        await chrome.tabs.update(tab.id, { active: true });
      }
      return { ok: false, error: captured?.error || "Amazon 页面采集失败" };
    }
    const response = await fetch(
      `https://ml-erp.woxq.cn/api/imports/source-products/${sourceProductId}/extension-capture`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(captured.payload) },
    );
    const responseData = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: responseData.detail || `美客多 ERP 返回 HTTP ${response.status}` };
    }
    for (const draftId of responseData.draft_ids || []) await notifyMeliErpTabs({ draftId });
    await chrome.tabs.sendMessage(tab.id, { type: "MELI_AMAZON_AUTO_CAPTURE_FINISHED", sourceProductId }).catch(() => {});
    return { ok: true, data: responseData };
  } catch (error) {
    return { ok: false, error: error?.message || "本机 Amazon 采集失败" };
  } finally {
    // Every unattended task-created tab closes after success, filtering, or a
    // normal failure. Only Amazon login/captcha pages stay open for the seller.
    if (tab?.id && !keepTabOpenForHumanCheck) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function fetch1688DetailImages(value) {
  const url = String(value || "").trim();
  if (!/^https:\/\/itemcdn\.tmall\.com\/1688offer\/[a-z0-9_-]+$/i.test(url)) {
    return { ok: false, images: [], error: "详情地址不合法" };
  }
  try {
    const response = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!response.ok) return { ok: false, images: [], error: `详情图接口 HTTP ${response.status}` };
    const text = await response.text();
    const jsonText = text.replace(/^\s*var\s+offer_details\s*=\s*/, "").replace(/;\s*$/, "");
    const payload = JSON.parse(jsonText);
    const html = String(payload?.content || "").replaceAll("\\/", "/");
    const images = [];
    for (const match of html.matchAll(/(?:src|data-src)=["'](https?:\/\/[^"']+)["']/gi)) images.push(match[1].replace(/&amp;/g, "&"));
    return { ok: true, images: [...new Set(images)] };
  } catch (error) {
    return { ok: false, images: [], error: error?.message || "详情图读取失败" };
  }
}

function resolveErpUrl(baseUrl, path) {
  const origin = new URL(baseUrl || ERP_BASE);
  const allowed = origin.protocol === "http:" && ERP_ALLOWED_HOSTS.has(origin.hostname) && origin.port === "8000";
  if (!allowed) {
    throw new Error("Ozon 插件只允许连接局域网笔记本 ERP http://192.168.0.147:8000");
  }
  if (!String(path || "").startsWith("/api/")) throw new Error("ERP 请求路径不合法");
  return new URL(path, origin).toString();
}

async function proxyErpRequest(message) {
  let url = "";
  try {
    url = resolveErpUrl(message.baseUrl, message.path);
    const options = message.options || {};
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const detail = typeof data === "object" && data ? (data.detail || data.error) : text;
      return { ok: false, status: response.status, url, error: `ERP 返回 HTTP ${response.status}${detail ? `：${String(detail).slice(0, 300)}` : ""}`, data };
    }
    return { ok: true, status: response.status, url, data };
  } catch (error) {
    return { ok: false, status: 0, url, error: `无法连接笔记本 Ozon ERP：${error?.message || "网络请求失败"}。请确认 http://192.168.0.147:8000/health 可打开。` };
  }
}

async function initializeCrawlerWorker() {
  ensureCrawlerAlarm();
  await setWorkerState({ status: "idle", job: null, message: "插件后台已启动", lastError: "", needsHuman: false });
}

function ensureCrawlerAlarm() {
  chrome.alarms.create("ozon-erp-crawler-poll", { periodInMinutes: 0.5 });
}

function startCrawlerSlots(options = {}) {
  pollCrawlerJob({ ...options, slot: 0 });
  pollCrawlerJob({ ...options, slot: 1 });
}

function scheduleCrawlerSlot(slot, delayMs = 1200) {
  chrome.alarms.create(`ozon-erp-crawler-next-${slot}`, { when: Date.now() + delayMs });
}

async function pollCrawlerJob(options = {}) {
  const slot = Number(options.slot || 0) === 1 ? 1 : 0;
  const pollKey = `poll:${slot}`;
  // 【2026-09-22 迭代】看门狗：锁持有超过 150 秒视为上一任务僵死（采集消息
  // 已有 75 秒超时兜底，此处为双保险），强制解锁让本轮重新领取，避免队列停摆。
  if (busyByType[pollKey]) {
    if (busySince[pollKey] && Date.now() - busySince[pollKey] > 150000) {
      busyByType[pollKey] = false;
    } else {
      return;
    }
  }
  busyByType[pollKey] = true;
  busySince[pollKey] = Date.now();
  try {
    const workerId = `${await getWorkerId()}_slot${slot}`;
    let data = { job: null };

    // 【2026-09-22 迭代】Amazon CBT（美客多）采集优先领取，且不受 1688/Ozon
    // 人工验证暂停标志（ozonErpHumanCheckPaused）影响；否则一次 1688 验证码会把
    // 美客多夜间挂机一并挡死（该标志曾滞留近一个月导致插件完全不轮询美客多）。
    // Amazon CBT jobs are processed by the local browser extension so the
    // seller's signed-in browser session and human-verification flow are
    // available. Use one Amazon slot only to avoid a request burst.
    if (slot === 0) {
      const meliJob = await claimMeliAmazonJob(`${await getWorkerId()}_meli`);
      if (meliJob) {
        await setWorkerState({ status: "running", job: meliJob, message: "正在执行 Amazon CBT 智能采集", lastError: "", needsHuman: false });
        const result = await runMeliAmazonJob(meliJob, `${await getWorkerId()}_meli`);
        if (!result?.keepState) {
          await setWorkerState({ status: "idle", job: null, message: "Amazon 商品已回传，等待下一件", lastError: "", needsHuman: false });
          scheduleCrawlerSlot(slot, 2500);
        }
        return;
      }
    }

    // 人工验证暂停只阻断 1688/Ozon 采集（slot1，以及 slot0 没有美客多任务时）。
    const humanPause = await getHumanCheckPause();
    if (!options.resume && humanPause?.paused) {
      await setWorkerState({
        status: "waiting_human",
        job: humanPause.job || lastWorkerState.job,
        message: "等待人工验证，自动采集已暂停（不影响美客多 Amazon 采集）",
        lastError: humanPause.message || lastWorkerState.lastError || "等待人工验证",
        needsHuman: true,
      });
      return;
    }
    await setWorkerState({ status: "checking", job: null, message: "正在检查 ERP 任务", lastError: "", needsHuman: false });

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
      scheduleCrawlerSlot(slot);
    }
  } catch (error) {
    await setWorkerState({ status: "error", job: null, message: "ERP 未连接或后台任务失败", lastError: error.message || "ERP 未连接或后台任务失败" });
  } finally {
    busyByType[pollKey] = false;
    busySince[pollKey] = null;
  }
}

async function claimMeliAmazonJob(workerId) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    // 【2026-09-22 迭代】continuous 战役在后端绑定被置空后，需要请求显式带上
    // continuous_enabled=true 才允许领取（否则后端按 worker 绑定过滤会返回空）。
    const response = await fetch(`${MELI_BASE}/api/imports/amazon-extension/next?worker_id=${encodeURIComponent(workerId)}&continuous_enabled=true`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.job || null;
  } catch {
    return null;
  }
}

async function runMeliAmazonJob(job, workerId) {
  let humanCheckDetected = false;
  const tab = await chrome.tabs.create({ url: job.url, active: false });
  try {
    await waitForTabLoad(tab.id);
    await sleep(3500 + Math.floor(Math.random() * 1800));
    await ensureAmazonContentScript(tab.id);
    // [Iteration 2026-09-22] 搜索发现任务（kind=meli_amazon_search）：提取结果页商品链接回传 product_urls
    if (job.kind === "meli_amazon_search") {
      // 【2026-09-22 迭代】75 秒硬超时：content script 卡死时强制失败并释放队列
      const searchResult = await withTimeout(
        chrome.tabs.sendMessage(tab.id, {
          type: "EXTRACT_MELI_AMAZON_SEARCH",
          collectionJobId: job.id,
        }),
        75000,
        "Amazon 搜索页采集超时（75s 无响应），已跳过该任务",
      );
      if (searchResult?.needsHuman) {
        humanCheckDetected = true;
        await reportHumanCheck(job, tab.id, searchResult.error || "Amazon 页面需要人工验证");
        await postMeliJobResult(job, workerId, { status: "needs_manual_action", message: searchResult.error || "Amazon 搜索页需要人工验证" });
        return { keepState: true };
      }
      if (!searchResult?.ok) {
        await postMeliJobResult(job, workerId, { status: "failed", message: searchResult?.error || "Amazon 搜索页解析失败" });
        return { keepState: false };
      }
      const searchResp = await postMeliJobResult(job, workerId, {
        status: "collected",
        product_urls: searchResult.product_urls || [],
      });
      if (!searchResp.ok) {
        await setWorkerState({ status: "error", job, message: "Amazon 搜索结果回传失败，任务保留待恢复", lastError: searchResp.error, needsHuman: false });
        return { keepState: true };
      }
      return { keepState: false };
    }
    // 【2026-09-22 迭代】75 秒硬超时：content script 卡死时强制失败、关标签页、释放队列
    const result = await withTimeout(
      chrome.tabs.sendMessage(tab.id, {
        type: "COLLECT_MELI_AMAZON_PRODUCT",
        automatic: true,
        collectionJobId: job.id,
      }),
      75000,
      "Amazon 详情页采集超时（75s 无响应），已跳过该任务",
    );
    if (result?.needsHuman) {
      humanCheckDetected = true;
      await reportHumanCheck(job, tab.id, result.error || "Amazon 页面需要人工验证");
      await postMeliJobResult(job, workerId, { status: "needs_manual_action", message: result.error || "Amazon 页面需要人工验证" });
      return { keepState: true };
    }
    if (!result?.ok) {
      await postMeliJobResult(job, workerId, { status: "failed", message: result?.error || "Amazon 页面解析失败" });
      return { keepState: false };
    }
    const response = await postMeliJobResult(job, workerId, { status: "collected", snapshot: result.payload?.snapshot || {} });
    if (!response.ok) {
      await setWorkerState({ status: "error", job, message: "Amazon 采集结果回传失败，任务保留待恢复", lastError: response.error, needsHuman: false });
      return { keepState: true };
    }
    return { keepState: false };
  } catch (error) {
    const response = await postMeliJobResult(job, workerId, { status: "failed", message: error?.message || "Amazon 标签页执行失败" });
    if (!response.ok) {
      await setWorkerState({ status: "error", job, message: "Amazon 采集失败且结果未回传", lastError: response.error, needsHuman: false });
      return { keepState: true };
    }
    return { keepState: false };
  } finally {
    if (!humanCheckDetected && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function postMeliJobResult(job, workerId, result) {
  try {
    const response = await fetch(`${MELI_BASE}/api/imports/amazon-extension/jobs/${encodeURIComponent(job.id)}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker_id: workerId,
        source_url: job.sourceUrl || job.url,
        status: result.status,
        message: result.message || "",
        snapshot: result.snapshot || {},
        product_urls: result.product_urls || [],
      }),
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, data } : { ok: false, error: data.detail || `美客多 ERP 返回 HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error?.message || "无法连接美客多 ERP" };
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
  startCrawlerSlots({ resume: true });
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

async function ensureAmazonContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING_MELI_AMAZON_COLLECTOR" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["amazon-content.js"] });
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

async function fetchOzonSalesFromSellerTab(productId) {
  console.log("[Ozon ERP BG] 开始处理请求，productId:", productId);
  try {
    const tabs = await chrome.tabs.query({ url: ["https://seller.ozonru.cn/*", "https://seller.ozon.ru/*"] });
    console.log("[Ozon ERP BG] 找到卖家标签页:", tabs?.length, "个");
    if (!tabs || tabs.length === 0) {
      return { ok: false, error: "没找到卖家后台标签页（seller.ozonru.cn / seller.ozon.ru）" };
    }
    const sellerTab = tabs[0];
    console.log("[Ozon ERP BG] 用标签页:", sellerTab.id, sellerTab.url);

    const results = await chrome.scripting.executeScript({
      target: { tabId: sellerTab.id },
      func: async (pid) => {
        // 先从localStorage拿，再从cookie拿，最后硬编码兜底
        let cid = "";
        try { cid = localStorage.getItem('ozon_company_id') || ''; } catch (e) {}
        if (!cid) { const m = document.cookie.match(/(?:^|;\s*)sc_company_id=([^;]+)/); cid = m ? decodeURIComponent(m[1]) : ''; }
        if (!cid) { cid = "2367028"; } // 硬编码兜底，实测当前店铺company_id
        console.log("[Ozon ERP BG] company_id:", cid, "sku:", pid);

        const resp = await fetch(location.origin + "/api/site/seller-analytics/what_to_sell/data/v3", {
          method: "POST",
          credentials: "include",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-o3-company-id": cid,
            "x-o3-language": "zh-Hans"
          },
          body: JSON.stringify({
            limit: "50",
            offset: "0",
            filter: {
              stock: "any_stock",
              period: "monthly",
              categories: [],
              sku: String(pid)
            },
            sort: { key: "sum_gmv_desc" }
          })
        });
        const data = await resp.json();
        return { ok: true, status: resp.status, data: data };
      },
      args: [productId]
    });
    console.log("[Ozon ERP BG] executeScript结果:", results);
    if (!results || results.length === 0) return { ok: false, error: "executeScript没返回" };
    return results[0].result;
  } catch (e) {
    console.log("[Ozon ERP BG] 总错误:", e.message);
    return { ok: false, error: e.message };
  }
}









// 批量获取商品销量数据（搜索页用）
async function batchFetchOzonSalesFromSellerTab(productIds) {
  try {
    const tabs = await chrome.tabs.query({ url: ["https://seller.ozonru.cn/*", "https://seller.ozon.ru/*"] });
    if (!tabs || tabs.length === 0) return { ok: false, error: "没找到卖家后台标签页（seller.ozonru.cn / seller.ozon.ru）" };
    const sellerTab = tabs[0];
    const results = await chrome.scripting.executeScript({
      target: { tabId: sellerTab.id },
      func: async (pids) => {
        let cid = localStorage.getItem('ozon_company_id') || '';
        if (!cid) { const m = document.cookie.match(/(?:^|;\s*)sc_company_id=([^;]+)/); cid = m ? decodeURIComponent(m[1]) : ''; }
        const resp = await fetch(location.origin + "/api/site/seller-analytics/what_to_sell/data/v3", {
          method: "POST",
          credentials: "include",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-o3-company-id": cid,
            "x-o3-language": "zh-Hans"
          },
          body: JSON.stringify({
            limit: String(Math.min(pids.length, 100)),
            offset: "0",
            filter: { stock: "any_stock", period: "monthly", categories: [], skus: pids.map(String) },
            sort: { key: "sum_gmv_desc" }
          })
        });
        const data = await resp.json();
        return { ok: true, status: resp.status, data: data };
      },
      args: [productIds]
    });
    if (!results || results.length === 0) return { ok: false, error: "executeScript无返回" };
    return results[0].result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
