const button = document.querySelector("#collectButton");
const statusEl = document.querySelector("#status");
const includeVideo = document.querySelector("#includeVideo");
const storeSelect = document.querySelector("#storeSelect");
const sizeWeightBox = document.querySelector("#sizeWeightBox");
const manualWeight = document.querySelector("#manualWeight");
const manualLength = document.querySelector("#manualLength");
const manualWidth = document.querySelector("#manualWidth");
const manualHeight = document.querySelector("#manualHeight");
const applyAllSku = document.querySelector("#applyAllSku");
const workerStatus = document.querySelector("#workerStatus");
const pollWorkerButton = document.querySelector("#pollWorkerButton");
const skuList = document.querySelector("#skuList");
const skuToggleButton = document.querySelector("#skuToggleButton");
const shopScanButton = document.querySelector("#shopScanButton");
const extensionVersion = document.querySelector("#extensionVersion");
const meliBrowserIdentity = document.querySelector("#meliBrowserIdentity");
const meliUnlimitedStatus = document.querySelector("#meliUnlimitedStatus");
const startMeliUnlimitedButton = document.querySelector("#startMeliUnlimitedButton");
const stopMeliUnlimitedButton = document.querySelector("#stopMeliUnlimitedButton");
const EXPECTED_CONTENT_VERSION = "0.7.75";
let pendingPayload = null;
let skuVariants = [];
let selectedSkuKeys = new Set();
let allSkuSelected = true;

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

async function erpRequest(path, options = {}) {
  const result = await chrome.runtime.sendMessage({ type: "OZON_ERP_REQUEST", path, options });
  if (!result?.ok) throw new Error(result?.error || "本地 ERP 请求失败");
  return result.data;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有找到当前标签页。");
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "PING_1688_COLLECTOR_061" });
    if (pong?.version === EXPECTED_CONTENT_VERSION) return;
  } catch {
    // Fall through to a full page reload below. Re-injecting a content script
    // into an already open tab leaves the old chrome.runtime.onMessage listener
    // alive, so it may win the reply race and return an obsolete payload.
  }
  // A browser refresh destroys all old content-script listeners. This is the
  // only reliable upgrade boundary for an unpacked MV3 extension on an already
  // open Ozon/1688 detail page.
  await chrome.tabs.reload(tabId);
  await waitForTabComplete(tabId);
  const refreshed = await chrome.tabs.sendMessage(tabId, { type: "PING_1688_COLLECTOR_061" });
  if (refreshed?.version !== EXPECTED_CONTENT_VERSION) {
    throw new Error("采集脚本未完成更新，请在 chrome://extensions 重新加载扩展后再试");
  }
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("页面刷新超时，请待页面加载完成后重试")), timeoutMs);
    function finish(error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    }
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function startShopScan() {
  shopScanButton.disabled = true;
  setStatus("正在连接当前1688店铺页面...");
  try {
    const tab = await activeTab();
    if (!/^https:\/\/[^/]*1688\.com\//i.test(tab.url || "")) throw new Error("请先打开1688店铺的“全部商品”页面");
    await ensureContentScript(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, { type: "START_1688_SHOP_SCAN" });
    if (!result?.ok) throw new Error(result?.error || "无法启动全店扫描");
    setStatus("全店采集已经启动，发现商品后会立即采集详情。请查看网页右侧浮窗中的实时进度。", "ok");
  } catch (error) {
    setStatus(error.message || "全店扫描启动失败", "error");
  } finally {
    shopScanButton.disabled = false;
  }
}

async function collectCurrentProduct() {
  button.disabled = true;
  button.textContent = pendingPayload ? "补齐后入箱..." : "采集中...";
  setStatus(pendingPayload ? "正在补齐尺重并发送到 ERP..." : "正在识别当前商品页面...");

  try {
    const tab = await activeTab();
    const isOzon = /^https:\/\/[^/]*ozon\.(ru|com|by|kz)\//i.test(tab.url || "");
    const is1688 = /^https:\/\/[^/]*1688\.com\//i.test(tab.url || "");
    if (!isOzon && !is1688) throw new Error("请先打开 Ozon 或 1688 商品详情页，再点击采集。");
    await ensureContentScript(tab.id);
    if (isOzon) {
      setStatus("正在读取 Ozon 商品、SKU 和图片...");
      const ozonResult = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_OZON_PRODUCT_DETAIL" });
      if (!ozonResult?.ok) throw new Error(ozonResult?.error || "Ozon 商品采集失败");
      setStatus("已读取 Ozon 页面，正在发送到笔记本 ERP...");
      const result = await erpRequest("/api/ozon-learning/extension/detail-result", {
        method: "POST",
        body: { storeId: storeSelect.value, payload: ozonResult.payload || {} },
      });
      if (!result?.ok || !result?.ingested) {
        throw new Error(result?.error || "ERP 未接收该商品，请检查已选择的店铺");
      }
      setStatus(result.duplicate ? "已更新 Ozon 商品采集快照" : "Ozon 商品采集成功，已进入 ERP 二开草稿", "ok");
      return;
    }
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "COLLECT_1688_PRODUCT",
      includeVideo: includeVideo.checked,
      storeId: storeSelect.value,
      preflightOnly: !pendingPayload,
      manualPackageInfo: readManualPackageInfo(),
      applyAllSku: applyAllSku.checked,
      selectedSkuKeys: [...selectedSkuKeys],
    });
    if (!result?.ok) throw new Error(result?.error || "采集失败。");
    if (result.needsSizeWeight) {
      pendingPayload = true;
      prefillManualPackageInfo(result.packageInfo || {});
      renderSkuSelector(result.skuVariants || skuVariants);
      button.textContent = "补齐后入箱";
      setStatus(result.message || "尺重不完整，请补齐重量和长宽高。", "error");
      return;
    }
    pendingPayload = null;
    if (result.duplicate) {
      setStatus(`${result.duplicateMessage || `已采集过：${result.title || "未命名商品"}`}\n本次识别 ${result.imageCount ?? "-"} 张，图库现有 ${result.imageCount ?? "-"} 张。`, "ok");
      return;
    }
    setStatus(`采集成功：${result.title || "未命名商品"}\n本次识别 ${result.imageCount ?? "-"} 张，图库现有 ${result.imageCount ?? "-"} 张。`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = pendingPayload ? "补齐后入箱" : "采集当前商品";
  }
}

function getSavedStoreId() {
  return new Promise((resolve) => {
    const extensionApi = globalThis.chrome || {};
    const localStorageApi = extensionApi.storage && extensionApi.storage.local;
    if (!localStorageApi || typeof localStorageApi.get !== "function") {
      resolve("");
      return;
    }
    try {
      localStorageApi.get(["lastStoreId"], (result) => resolve(result?.lastStoreId || ""));
    } catch {
      resolve("");
    }
  });
}

function saveStoreId(storeId) {
  try {
    const extensionApi = globalThis.chrome || {};
    const localStorageApi = extensionApi.storage && extensionApi.storage.local;
    if (localStorageApi && typeof localStorageApi.set === "function") localStorageApi.set({ lastStoreId: storeId });
  } catch {}
}

function readManualPackageInfo() {
  const values = {
    weightG: Number(manualWeight.value || 0),
    lengthMm: Number(manualLength.value || 0),
    widthMm: Number(manualWidth.value || 0),
    heightMm: Number(manualHeight.value || 0),
  };
  return Object.values(values).some(Boolean) ? values : null;
}

function prefillManualPackageInfo(packageInfo = {}) {
  if (!manualWeight.value && packageInfo.weightG) manualWeight.value = packageInfo.weightG;
  if (!manualLength.value && packageInfo.lengthMm) manualLength.value = packageInfo.lengthMm;
  if (!manualWidth.value && packageInfo.widthMm) manualWidth.value = packageInfo.widthMm;
  if (!manualHeight.value && packageInfo.heightMm) manualHeight.value = packageInfo.heightMm;
}

async function loadStores() {
  try {
    const data = await erpRequest("/api/stores");
    const saved = await getSavedStoreId();
    storeSelect.innerHTML = (data.stores || [])
      .map((store) => `<option value="${store.id}">${store.name} - ${store.clientId}</option>`)
      .join("");
    if (saved && [...storeSelect.options].some((option) => option.value === saved)) storeSelect.value = saved;
    setStatus("等待采集");
  } catch (error) {
    storeSelect.innerHTML = `<option value="">请先打开本地 ERP</option>`;
    setStatus(error.message, "error");
  }
}

function skuKey(sku, index) {
  return String(sku?.skuId || sku?.spec || index);
}

function renderSkuSelector(variants = []) {
  skuVariants = variants;
  const rows = variants.map((sku, index) => ({
    key: skuKey(sku, index),
    label: String(sku.spec || sku.skuId || `SKU${index + 1}`).replace(/\s+/g, " ").trim(),
  }));
  if (allSkuSelected) selectedSkuKeys = new Set(rows.map((row) => row.key));
  skuList.innerHTML = rows.length
    ? rows.map((row) => `<label><input type="checkbox" data-sku-key="${escapeAttr(row.key)}" ${selectedSkuKeys.has(row.key) ? "checked" : ""}/> <span>${escapeHtml(row.label)}</span></label>`).join("")
    : "当前页面没有识别到可选 SKU，将按商品整体采集。";
  skuList.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const key = checkbox.dataset.skuKey || "";
      if (checkbox.checked) selectedSkuKeys.add(key);
      else selectedSkuKeys.delete(key);
      allSkuSelected = rows.length > 0 && selectedSkuKeys.size === rows.length;
      skuToggleButton.textContent = allSkuSelected ? "不全选" : "全选";
    });
  });
  skuToggleButton.textContent = allSkuSelected ? "不全选" : "全选";
  skuToggleButton.disabled = rows.length === 0;
}

async function loadPageOptions() {
  try {
    const tab = await activeTab();
    if (!/^https:\/\/[^/]*1688\.com\//i.test(tab.url || "")) return;
    await ensureContentScript(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "COLLECT_1688_PRODUCT_RAW",
      includeVideo: false,
      storeId: storeSelect.value,
    });
    if (!result?.ok) return;
    const payload = result.payload || {};
    renderSkuSelector(payload.skuVariants || []);
    prefillManualPackageInfo(payload.packageInfo || {});
  } catch {
    skuList.textContent = "未读取到 SKU，可在商品详情页刷新后再打开插件。";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

async function refreshWorkerStatus() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "OZON_ERP_CRAWLER_STATUS" });
    const state = result?.state || {};
    const time = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : "";
    workerStatus.textContent = `${state.message || "等待 ERP 任务"}${time ? ` / ${time}` : ""}`;
    pollWorkerButton.textContent = state.needsHuman ? "恢复采集" : "立即检查任务";
  } catch {
    workerStatus.textContent = "后台 worker 未响应，请在扩展页面重新加载插件";
  }
}

async function pollWorkerNow() {
  pollWorkerButton.disabled = true;
  pollWorkerButton.textContent = "检查中...";
  try {
    const current = await chrome.runtime.sendMessage({ type: "OZON_ERP_CRAWLER_STATUS" }).catch(() => null);
    const type = current?.state?.needsHuman ? "OZON_ERP_CRAWLER_RESUME_AFTER_HUMAN" : "OZON_ERP_CRAWLER_POLL_NOW";
    const result = await chrome.runtime.sendMessage({ type });
    const state = result?.state || {};
    workerStatus.textContent = state.message || "已检查 ERP 任务";
    pollWorkerButton.textContent = state.needsHuman ? "恢复采集" : "立即检查任务";
  } catch (error) {
    workerStatus.textContent = error.message || "检查失败";
  } finally {
    pollWorkerButton.disabled = false;
    refreshWorkerStatus();
  }
}

function setMeliControlsBusy(busy) {
  startMeliUnlimitedButton.disabled = busy;
  stopMeliUnlimitedButton.disabled = busy;
}

async function refreshMeliUnlimitedStatus() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "MELI_UNLIMITED_STATUS" });
    if (!result?.ok) throw new Error(result?.error || "状态读取失败");
    const { identity = {}, server = {}, localEnabled = false } = result;
    const browserVersion = identity.browserVersion ? ` ${identity.browserVersion}` : "";
    meliBrowserIdentity.textContent = `${identity.browserName || "当前浏览器"}${browserVersion} · 插件 ${identity.extensionVersion || "-"}`;
    const campaign = server.campaign || {};
    if (server.active && server.owns_active && localEnabled) {
      meliUnlimitedStatus.textContent = `运行中：任务 #${campaign.id} 已绑定本浏览器`;
      meliUnlimitedStatus.className = "meli-unlimited-status running";
      startMeliUnlimitedButton.disabled = true;
      stopMeliUnlimitedButton.disabled = false;
      return;
    }
    if (server.active && !server.owns_active) {
      const owner = campaign.bound_browser_name || "另一个浏览器";
      const ownerVersion = campaign.bound_browser_version ? ` ${campaign.bound_browser_version}` : "";
      meliUnlimitedStatus.textContent = `其他浏览器正在执行：${owner}${ownerVersion}（任务 #${campaign.id}）`;
      meliUnlimitedStatus.className = "meli-unlimited-status occupied";
      startMeliUnlimitedButton.disabled = false;
      stopMeliUnlimitedButton.disabled = true;
      return;
    }
    if (server.active && server.owns_active && !localEnabled) {
      meliUnlimitedStatus.textContent = `服务器仍绑定本浏览器，但本机领取已停止；可点击“停止采集”完成同步`;
      meliUnlimitedStatus.className = "meli-unlimited-status warning";
      startMeliUnlimitedButton.disabled = false;
      stopMeliUnlimitedButton.disabled = false;
      return;
    }
    meliUnlimitedStatus.textContent = campaign.id ? `已停止（最近任务 #${campaign.id}）` : "已停止；服务器暂无可用采集任务";
    meliUnlimitedStatus.className = "meli-unlimited-status stopped";
    startMeliUnlimitedButton.disabled = !campaign.id;
    stopMeliUnlimitedButton.disabled = true;
  } catch (error) {
    meliUnlimitedStatus.textContent = error.message || "无法读取无限筛选采集状态";
    meliUnlimitedStatus.className = "meli-unlimited-status warning";
    startMeliUnlimitedButton.disabled = false;
    stopMeliUnlimitedButton.disabled = false;
  }
}

async function startMeliUnlimited() {
  setMeliControlsBusy(true);
  meliUnlimitedStatus.textContent = "正在绑定当前浏览器并启动...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "MELI_UNLIMITED_START" });
    if (!result?.ok) throw new Error(result?.error || "启动失败");
    setStatus(`无限筛选采集已绑定到 ${result.identity?.browserName || "当前浏览器"}`, "ok");
  } catch (error) {
    setStatus(error.message || "无限筛选采集启动失败", "error");
  } finally {
    await refreshMeliUnlimitedStatus();
  }
}

async function stopMeliUnlimited() {
  setMeliControlsBusy(true);
  meliUnlimitedStatus.textContent = "正在停止本浏览器领取新任务...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "MELI_UNLIMITED_STOP" });
    if (!result?.ok) throw new Error(result?.error || "服务器暂停失败；本浏览器已停止领取新任务");
    setStatus("无限筛选采集已停止；当前任务允许收尾。", "ok");
  } catch (error) {
    setStatus(error.message || "停止失败", "error");
  } finally {
    await refreshMeliUnlimitedStatus();
  }
}

storeSelect.addEventListener("change", () => saveStoreId(storeSelect.value));
button.addEventListener("click", collectCurrentProduct);
shopScanButton.addEventListener("click", startShopScan);
pollWorkerButton.addEventListener("click", pollWorkerNow);
startMeliUnlimitedButton.addEventListener("click", startMeliUnlimited);
stopMeliUnlimitedButton.addEventListener("click", stopMeliUnlimited);
skuToggleButton.addEventListener("click", () => {
  const nextAll = !allSkuSelected;
  allSkuSelected = nextAll;
  selectedSkuKeys = new Set(nextAll ? skuVariants.map((sku, index) => skuKey(sku, index)) : []);
  renderSkuSelector(skuVariants);
});
loadStores();
refreshWorkerStatus();
extensionVersion.textContent = chrome.runtime.getManifest().version;
refreshMeliUnlimitedStatus();
loadPageOptions();

// [Iteration 2026-09-20] Ozon 搜索结果页批量采集
document.getElementById("ozonBatchButton").addEventListener("click", async () => {
  const btn = document.getElementById("ozonBatchButton");
  const statusEl = document.getElementById("ozonBatchStatus");
  btn.disabled = true;
  statusEl.textContent = "开始批量采集...";

  // 获取筛选条件
  const filters = {
    minPrice: parseInt(document.getElementById("ozonMinPrice").value) || 30,
    maxPrice: parseInt(document.getElementById("ozonMaxPrice").value) || 100,
    minRating: parseFloat(document.getElementById("ozonMinRating").value) || 4.6,
    maxPages: parseInt(document.getElementById("ozonMaxPages").value) || 10,
  };

  // 发送消息给 content script 执行批量采集
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "OZON_BATCH_COLLECT",
    filters,
  });

  if (response?.ok) {
    statusEl.textContent = `完成！采集到 ${response.count} 个产品`;
  } else {
    statusEl.textContent = `失败：${response?.error || "未知错误"}`;
  }
  btn.disabled = false;
});
