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
const erpBaseUrl = document.querySelector("#erpBaseUrl");
const erpSessionToken = document.querySelector("#erpSessionToken");
const saveErpConfigButton = document.querySelector("#saveErpConfigButton");
const clearErpConfigButton = document.querySelector("#clearErpConfigButton");
const erpConfigStatus = document.querySelector("#erpConfigStatus");
const openCaptureLink = document.querySelector("#openCaptureLink");
let pendingPayload = null;
let skuVariants = [];
let selectedSkuKeys = new Set();
let allSkuSelected = true;

function captureErpUrl(captureId = "") {
  const id = String(captureId || "").trim();
  if (!id) return "";
  const base = String(erpBaseUrl?.value || "http://127.0.0.1:5178").trim().replace(/\/+$/, "");
  return `${base}/?view=sourcing&captureId=${encodeURIComponent(id)}`;
}

function showCaptureLink(captureId = "") {
  if (!openCaptureLink) return;
  const url = captureErpUrl(captureId);
  if (!url) {
    openCaptureLink.hidden = true;
    return;
  }
  openCaptureLink.href = url;
  openCaptureLink.hidden = false;
}

async function openCurrentCapture(captureId = "") {
  const url = captureErpUrl(captureId);
  showCaptureLink(captureId);
  if (!url) return false;
  if (globalThis.chrome?.tabs?.create) {
    try {
      await chrome.tabs.create({ url });
      return true;
    } catch (error) {
      // The capture is already persisted. Keep the manual link usable rather
      // than turning a post-capture tab-opening failure into a false capture
      // failure.
      console.warn("自动打开 ERP 当前商品失败，保留手动链接", error?.message || error);
    }
  }
  return false;
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function updateCollectAvailability() {
  if (button.dataset.collecting === "true") return;
  const ready = Boolean(String(storeSelect?.value || "").trim());
  button.disabled = !ready;
  button.title = ready ? "" : "请先连接 ERP 并选择归属店铺";
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有找到当前标签页。");
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING_1688_COLLECTOR" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}

function is1688Tab(tab) {
  return /^https:\/\/[^/]*1688\.com\//i.test(tab?.url || "");
}

function isPddTab(tab) {
  return /^https:\/\/[^/]*(pinduoduo|yangkeduo)\.com\//i.test(tab?.url || "");
}

async function collectCurrentProduct() {
  if (!String(storeSelect?.value || "").trim()) {
    setStatus("请先连接 ERP 并选择归属店铺，再采集商品。", "error");
    updateCollectAvailability();
    return;
  }
  button.dataset.collecting = "true";
  button.disabled = true;
  button.textContent = pendingPayload ? "补齐后入箱..." : "采集中...";
  setStatus(pendingPayload ? "正在补齐尺重并发送到 ERP..." : "正在读取当前页面...");

  try {
    const tab = await activeTab();
    if (isPddTab(tab)) {
      await collectPddProduct(tab);
      return;
    }
    if (!is1688Tab(tab)) {
      throw new Error("请先打开 1688 或拼多多商品详情页，再点击采集。");
    }
    await collect1688Product(tab);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.dataset.collecting = "false";
    updateCollectAvailability();
    button.textContent = pendingPayload ? "补齐后入箱" : "采集当前商品";
  }
}

async function collect1688Product(tab) {
  setStatus(pendingPayload ? "正在补齐尺重并发送到 ERP..." : "正在读取当前 1688 页面...");
  await ensureContentScript(tab.id);
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
  const captureId = result.id || result.collectionId || result.captureReceipt?.collectionId;
  await openCurrentCapture(captureId);
  if (result.duplicate) {
    setStatus(`已采集过：${result.title || "未命名商品"}\nERP 已自动打开原记录，可继续补资料或预检。`, "ok");
    return;
  }
  setStatus(`采集成功：${result.title || "未命名商品"}\nERP 已自动打开当前商品，可继续生成本地草稿。`, "ok");
}

async function collectPddProduct(tab) {
  pendingPayload = null;
  setStatus("正在读取当前拼多多页面...");
  await ensureContentScript(tab.id);
  const result = await chrome.tabs.sendMessage(tab.id, {
    type: "COLLECT_PDD_PRODUCT",
    includeVideo: includeVideo.checked,
  });
  if (!result?.ok) throw new Error(result?.error || "拼多多采集失败。");
  if (result.needsHuman) {
    throw new Error("拼多多商品详情页需要登录或人工验证，处理完成后再采集。");
  }
  const response = await fetchErp("/api/pdd/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(result.payload || {}),
      storeId: storeSelect.value,
      includeVideo: includeVideo.checked,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || "ERP 接收拼多多商品失败。");
  if (data.duplicate) {
    showCaptureLink(data.id || data.collectionId || data.captureReceipt?.collectionId);
    setStatus(`已采集过：${data.title || "未命名商品"}\nERP 已保留原记录。`, "ok");
    return;
  }
  showCaptureLink(data.id || data.collectionId || data.captureReceipt?.collectionId);
  setStatus(`拼多多采集成功：${data.title || "未命名商品"}\n点击下方按钮继续生成本地草稿。`, "ok");
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
    const response = await fetchErp("/api/stores");
    if (!response.ok) throw new Error("ERP 未连接");
    const data = await response.json();
    const saved = await getSavedStoreId();
    storeSelect.innerHTML = (data.stores || [])
      .map((store) => `<option value="${store.id}">${store.name} - ${store.clientId}</option>`)
      .join("");
    if (saved && [...storeSelect.options].some((option) => option.value === saved)) storeSelect.value = saved;
    updateCollectAvailability();
    setStatus("等待采集");
  } catch (error) {
    storeSelect.innerHTML = `<option value="">请先打开本地 ERP</option>`;
    updateCollectAvailability();
    setStatus(error.message, "error");
  }
}

async function fetchErp(path, options = {}) {
  const body = options.body === undefined ? undefined : (() => {
    try { return JSON.parse(options.body); } catch { return options.body; }
  })();
  const result = await chrome.runtime.sendMessage({
    type: "OZON_ERP_API_REQUEST",
    path,
    method: options.method || "GET",
    body,
  });
  if (!result?.ok && !result?.status) throw new Error(result?.error || "ERP 未连接");
  return {
    ok: Boolean(result.ok),
    status: Number(result.status || 0),
    json: async () => result.data || {},
    text: async () => typeof result.data === "string" ? result.data : JSON.stringify(result.data || {}),
  };
}

async function loadErpConfig() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "OZON_ERP_CONFIG_STATUS" });
    erpBaseUrl.value = result?.baseUrl || "http://127.0.0.1:5178";
    erpConfigStatus.textContent = result?.tokenConfigured ? "已配置会话 Token（不会显示或持久化明文）" : "未配置 Token；本机 ERP 可直接使用";
  } catch { erpConfigStatus.textContent = "后台配置读取失败"; }
}

saveErpConfigButton.addEventListener("click", async () => {
  saveErpConfigButton.disabled = true;
  try {
    const configuredUrl = new URL(erpBaseUrl.value.trim());
    const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(configuredUrl.hostname);
    if (configuredUrl.protocol === "https:" && !isLoopback && chrome.permissions?.request) {
      const granted = await chrome.permissions.request({ origins: [`${configuredUrl.origin}/*`] });
      if (!granted) throw new Error("未授予外部 ERP 地址访问权限");
    }
    const result = await chrome.runtime.sendMessage({ type: "OZON_ERP_CONFIG_SAVE", baseUrl: erpBaseUrl.value, sessionToken: erpSessionToken.value });
    if (!result?.ok) throw new Error(result?.error || "连接配置无效");
    erpSessionToken.value = "";
    erpConfigStatus.textContent = result.tokenConfigured ? "已保存（Token 仅在当前浏览器会话有效）" : "已保存地址，未配置 Token";
    setStatus("ERP 连接配置已更新", "ok");
    loadStores();
  } catch (error) { erpConfigStatus.textContent = error.message; }
  finally { saveErpConfigButton.disabled = false; }
});

clearErpConfigButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OZON_ERP_CONFIG_CLEAR" });
  erpBaseUrl.value = "http://127.0.0.1:5178";
  erpSessionToken.value = "";
  erpConfigStatus.textContent = "已恢复本机默认，未配置 Token";
  loadStores();
});

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
    if (isPddTab(tab)) {
      skuList.textContent = "拼多多商品详情页可直接点击“采集当前商品”。";
      return;
    }
    if (!is1688Tab(tab)) return;
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

storeSelect.addEventListener("change", () => {
  saveStoreId(storeSelect.value);
  updateCollectAvailability();
});
button.addEventListener("click", collectCurrentProduct);
pollWorkerButton.addEventListener("click", pollWorkerNow);
skuToggleButton.addEventListener("click", () => {
  const nextAll = !allSkuSelected;
  allSkuSelected = nextAll;
  selectedSkuKeys = new Set(nextAll ? skuVariants.map((sku, index) => skuKey(sku, index)) : []);
  renderSkuSelector(skuVariants);
});
loadStores();
loadErpConfig();
refreshWorkerStatus();
loadPageOptions();
