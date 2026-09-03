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
const EXPECTED_CONTENT_VERSION = "0.7.7";
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
    if (pong?.version !== EXPECTED_CONTENT_VERSION) throw new Error("旧页面脚本");
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.querySelector("#ozon-erp-1688-floating")?.remove();
        delete document.documentElement.dataset.ozonErp1688Injected;
      },
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
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
  setStatus(pendingPayload ? "正在补齐尺重并发送到 ERP..." : "正在读取当前 1688 页面...");

  try {
    const tab = await activeTab();
    const isOzon = /^https:\/\/[^/]*ozon\.(ru|com|by|kz)\//i.test(tab.url || "");
    const is1688 = /^https:\/\/[^/]*1688\.com\//i.test(tab.url || "");
    if (!isOzon && !is1688) throw new Error("请先打开 Ozon 或 1688 商品详情页，再点击采集。");
    await ensureContentScript(tab.id);
    if (isOzon) {
      const ozonResult = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_OZON_PRODUCT_DETAIL" });
      if (!ozonResult?.ok) throw new Error(ozonResult?.error || "Ozon 商品采集失败");
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

storeSelect.addEventListener("change", () => saveStoreId(storeSelect.value));
button.addEventListener("click", collectCurrentProduct);
shopScanButton.addEventListener("click", startShopScan);
pollWorkerButton.addEventListener("click", pollWorkerNow);
skuToggleButton.addEventListener("click", () => {
  const nextAll = !allSkuSelected;
  allSkuSelected = nextAll;
  selectedSkuKeys = new Set(nextAll ? skuVariants.map((sku, index) => skuKey(sku, index)) : []);
  renderSkuSelector(skuVariants);
});
loadStores();
refreshWorkerStatus();
loadPageOptions();
