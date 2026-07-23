let pageContext = null;
let floatingState = { minimized: false, selectedSkuKeys: new Set(), allSelected: true };

if (is1688Page()) {
  injectPageReader();
  mountFloatingCollector();
}
if (isOzonSellerPage()) {
  mountOzonSellerEditMonitor();
}
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type === "OZON_ERP_1688_CONTEXT") {
    pageContext = event.data.context || null;
  }
});

function is1688Page() {
  return /(^|\.)1688\.com$/i.test(location.hostname);
}

function isOzonPage() {
  return /(^|\.)ozon\.ru$/i.test(location.hostname);
}

function isOzonSellerPage() {
  return /^seller\.ozon\.ru$/i.test(location.hostname);
}

function mountOzonSellerEditMonitor() {
  if (window.__ozonErpSellerEditMonitor) return;
  window.__ozonErpSellerEditMonitor = {
    baseline: snapshotOzonSellerForm(),
    timer: 0,
    lastSignature: "",
  };
  document.addEventListener("input", scheduleOzonSellerEditCapture, true);
  document.addEventListener("change", scheduleOzonSellerEditCapture, true);
}

function scheduleOzonSellerEditCapture() {
  const state = window.__ozonErpSellerEditMonitor;
  if (!state) return;
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => reportOzonSellerEditDiff(), 1400);
}

function snapshotOzonSellerForm() {
  const fields = {};
  const nodes = [...document.querySelectorAll("input, textarea, select, [contenteditable='true']")];
  for (const node of nodes) {
    if (!isTrackableSellerField(node)) continue;
    const field = ozonSellerFieldKey(node);
    if (!field || Object.prototype.hasOwnProperty.call(fields, field)) continue;
    fields[field] = ozonSellerFieldValue(node);
  }
  return fields;
}

function isTrackableSellerField(node) {
  if (!node || node.disabled || node.type === "hidden" || node.type === "password") return false;
  const rect = node.getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return false;
  return true;
}

function ozonSellerFieldKey(node) {
  const id = node.id ? `#${node.id}` : "";
  const named = node.getAttribute("name") || node.getAttribute("data-testid") || node.getAttribute("aria-label") || node.getAttribute("placeholder") || "";
  const label = id ? cleanText(document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.innerText || "") : "";
  const nearby = cleanText(node.closest("label, [data-testid], div")?.innerText || "").slice(0, 80);
  return cleanText(label || named || nearby || node.className || node.tagName).slice(0, 120);
}

function ozonSellerFieldValue(node) {
  if (node.matches?.("[contenteditable='true']")) return cleanText(node.innerText || node.textContent || "");
  if (node.type === "checkbox" || node.type === "radio") return Boolean(node.checked);
  return cleanText(node.value || "");
}

function erpApiRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        type: "OZON_ERP_API_REQUEST",
        path,
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body,
      }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || "插件后台连接失败"));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "ERP 连接失败"));
          return;
        }
        resolve(response.data || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function reportOzonSellerEditDiff() {
  const state = window.__ozonErpSellerEditMonitor;
  if (!state) return;
  const current = snapshotOzonSellerForm();
  const changes = Object.keys({ ...state.baseline, ...current })
    .filter((field) => JSON.stringify(state.baseline[field] ?? "") !== JSON.stringify(current[field] ?? ""))
    .map((field) => ({ field, before: state.baseline[field] ?? "", after: current[field] ?? "" }))
    .filter((change) => String(change.after || "").length < 1000)
    .slice(0, 80);
  if (!changes.length) return;
  const signature = JSON.stringify(changes);
  if (signature === state.lastSignature) return;
  state.lastSignature = signature;
  await erpApiRequest("/api/listing-edit-journal/events", {
    method: "POST",
    body: {
      stage: "ozon_backend_edit",
      source: "ozon_seller_plugin",
      offerId: ozonSellerOfferId(),
      productId: ozonSellerProductId(),
      changes,
      context: {
        url: location.href,
        title: document.title,
        capturedAt: new Date().toISOString(),
      },
    },
  }).catch(() => {});
}

function ozonSellerProductId() {
  return String(location.href.match(/(?:product|products|sku|item)[=/_-](\d{6,})/i)?.[1] || location.href.match(/\/(\d{6,})(?:[/?#]|$)/)?.[1] || "");
}

function ozonSellerOfferId() {
  const text = `${document.title} ${document.body?.innerText || ""}`;
  return String(text.match(/SKU[a-z0-9_-]+/i)?.[0] || text.match(/offer[_\s-]*id[:\s]+([a-z0-9_-]+)/i)?.[1] || "");
}

async function collectPage(options = {}) {
  const contextData = await getContextData();
  const packageInfo = pickPackageInfo(contextData);
  const skuVariants = pickSkuVariants(contextData, packageInfo.skuPackageMap || {});
  const title = normalizeCaptureTitle(pickTitle(contextData));
  const images = pickImages(contextData);
  const attributes = pickAttributes(contextData);
  const captureData = {
    title,
    supplier: pickSupplier(contextData),
    description: pickDescription(contextData),
    images,
    detailImages: [],
    video: options.includeVideo === false ? null : pickVideo(contextData),
    attributes,
    skuVariants,
    packageInfo,
  };

  return {
    contractVersion: "manual_capture_v1",
    taskId: String(options.taskId || "").trim(),
    url: location.href,
    offerId: pickOfferId(contextData),
    ...captureData,
    html: buildCompactCaptureHtml(captureData),
    sourceHtmlBytes: document.documentElement.outerHTML.length,
    storeId: options.storeId || "",
    includeVideo: options.includeVideo !== false,
    collectedAt: new Date().toISOString(),
    // Keep the legacy field for older ERP versions while the server-side
    // boundary normalizes both names into the resumable capture envelope.
    sentAt: new Date().toISOString(),
    captureMode: options.captureMode || "extension_browser",
  };
}

function normalizeCaptureTitle(value) {
  return cleanText(value).replace(/\s*[-–—]\s*(?:阿里巴巴|1688).*$/i, "");
}

function buildCompactCaptureHtml(captureData = {}) {
  const snapshot = {
    contractVersion: "manual_capture_v1",
    source: "1688",
    url: location.href,
    offerId: String(location.pathname.match(/\/offer\/(\d+)/)?.[1] || ""),
    capturedAt: new Date().toISOString(),
    ...captureData,
  };
  const json = JSON.stringify(snapshot).replace(/</g, "\\u003c");
  const title = String(snapshot.title || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<html><head><title>${title}</title></head><body><script type="application/json" data-ozon-erp-capture>${json}</script></body></html>`;
}

function captureDataForSnapshot(payload = {}) {
  return {
    title: payload.title || "",
    supplier: payload.supplier || "",
    description: payload.description || "",
    images: Array.isArray(payload.images) ? payload.images : [],
    detailImages: Array.isArray(payload.detailImages) ? payload.detailImages : [],
    video: payload.video || null,
    attributes: Array.isArray(payload.attributes) ? payload.attributes : [],
    skuVariants: Array.isArray(payload.skuVariants) ? payload.skuVariants : [],
    packageInfo: payload.packageInfo && typeof payload.packageInfo === "object" ? payload.packageInfo : {},
  };
}

function mountFloatingCollector() {
  if (document.getElementById("ozon-erp-1688-floating")) return;
  const panel = document.createElement("div");
  panel.id = "ozon-erp-1688-floating";
  panel.innerHTML = `
    <div class="ozon-erp-head">
      <div class="ozon-erp-drag-handle">
        <span class="ozon-erp-mark">1688</span>
        <div>
          <strong>Ozon ERP</strong>
          <small>商品采集器</small>
        </div>
      </div>
      <div class="ozon-erp-head-actions">
        <a class="ozon-erp-link" href="http://localhost:5178/" target="_blank" title="打开 ERP">ERP</a>
        <button type="button" id="ozon-erp-toggle" title="缩小">-</button>
      </div>
    </div>
    <div id="ozon-erp-expanded">
      <div class="ozon-erp-row">
        <select id="ozon-erp-1688-store"><option value="">选择店铺</option></select>
        <label class="ozon-erp-switch"><input type="checkbox" id="ozon-erp-1688-video" checked /> 视频</label>
      </div>
      <button type="button" id="ozon-erp-1688-collect">采集到 ERP</button>
      <div class="ozon-erp-sku-box">
        <div class="ozon-erp-sku-head">
          <span>SKU 采集</span>
          <button type="button" id="ozon-erp-sku-toggle">不全选</button>
        </div>
        <div id="ozon-erp-sku-list" class="ozon-erp-sku-list">读取 SKU 中...</div>
      </div>
      <div class="ozon-erp-meta">
        <span id="ozon-erp-title">读取页面中...</span>
        <span id="ozon-erp-1688-status"></span>
      </div>
      <div id="ozon-erp-1688-size-box" class="ozon-erp-size-box">
        <div class="ozon-erp-size-title">手动尺重（选填）</div>
        <div class="ozon-erp-size-grid">
          <input id="ozon-erp-weight" type="number" min="1" placeholder="重量g" />
          <input id="ozon-erp-length" type="number" min="1" placeholder="长mm" />
          <input id="ozon-erp-width" type="number" min="1" placeholder="宽mm" />
          <input id="ozon-erp-height" type="number" min="1" placeholder="高mm" />
        </div>
        <label class="ozon-erp-apply-sku"><input type="checkbox" id="ozon-erp-apply-all-sku" checked /> 同步填入所有缺尺重 SKU</label>
      </div>
    </div>
    <button type="button" id="ozon-erp-minimized" hidden title="展开采集器">采</button>
  `;
  Object.assign(panel.style, {
    position: "fixed",
    right: "18px",
    bottom: "88px",
    zIndex: "2147483647",
    display: "grid",
    alignItems: "stretch",
    gap: "12px",
    width: "360px",
    padding: "12px",
    border: "1px solid rgba(15, 23, 42, .12)",
    borderRadius: "8px",
    background: "rgba(255,255,255,.96)",
    boxShadow: "0 18px 42px rgba(15, 23, 42, .16)",
    fontSize: "13px",
    color: "#1f2937",
    backdropFilter: "blur(14px)",
  });
  const style = document.createElement("style");
  style.textContent = `
    #ozon-erp-1688-floating *{box-sizing:border-box}
    #ozon-erp-1688-floating .ozon-erp-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #ozon-erp-1688-floating .ozon-erp-head-actions{display:flex;align-items:center;gap:8px}
    #ozon-erp-1688-floating .ozon-erp-drag-handle{display:flex;align-items:center;gap:9px;min-width:0;cursor:move;user-select:none}
    #ozon-erp-1688-floating .ozon-erp-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:8px;background:#ff6a00;color:#fff;font-size:11px;font-weight:800;letter-spacing:0}
    #ozon-erp-1688-floating .ozon-erp-head strong{display:block;font-size:14px;line-height:18px;color:#111827}
    #ozon-erp-1688-floating .ozon-erp-head small{display:block;font-size:11px;line-height:15px;color:#6b7280}
    #ozon-erp-1688-floating .ozon-erp-link{display:grid;place-items:center;min-width:36px;height:28px;border:1px solid rgba(15,23,42,.12);border-radius:7px;color:#374151;text-decoration:none;font-size:12px;font-weight:800;background:#fff}
    #ozon-erp-1688-floating #ozon-erp-toggle{border:1px solid rgba(15,23,42,.12);border-radius:7px;width:28px;height:28px;padding:0;cursor:pointer;background:#fff;color:#374151;font-size:16px;font-weight:800;line-height:1}
    #ozon-erp-1688-floating #ozon-erp-expanded{display:grid;gap:9px}
    #ozon-erp-1688-floating .ozon-erp-row{display:flex;align-items:center;gap:8px}
    #ozon-erp-1688-floating select{height:36px;flex:1;min-width:0;border:1px solid rgba(15,23,42,.14);border-radius:7px;padding:0 10px;background:#f9fafb;color:#111827;font-size:13px;outline:none}
    #ozon-erp-1688-floating select:focus{border-color:#ff8a3d;box-shadow:0 0 0 3px rgba(255,106,0,.14)}
    #ozon-erp-1688-floating #ozon-erp-1688-collect{width:100%;height:38px;border:0;border-radius:7px;background:#ff6a00;color:#fff;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 8px 18px rgba(255,106,0,.22)}
    #ozon-erp-1688-floating #ozon-erp-1688-collect:disabled{opacity:.68;cursor:wait;box-shadow:none}
    #ozon-erp-1688-floating .ozon-erp-switch{display:flex;align-items:center;gap:5px;height:36px;padding:0 10px;border:1px solid rgba(15,23,42,.12);border-radius:7px;background:#fff;color:#4b5563;font-size:12px;white-space:nowrap}
    #ozon-erp-1688-floating .ozon-erp-switch input{accent-color:#ff6a00}
    #ozon-erp-1688-floating .ozon-erp-meta{display:grid;gap:5px;padding:9px 10px;border:1px solid rgba(15,23,42,.10);border-radius:8px;background:#f8fafc}
    #ozon-erp-1688-floating #ozon-erp-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#111827;font-weight:700}
    #ozon-erp-1688-floating #ozon-erp-1688-status{min-height:16px;color:#64748b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #ozon-erp-1688-floating .ozon-erp-sku-box{display:grid;gap:7px;padding:9px 10px;border:1px solid rgba(15,23,42,.10);border-radius:8px;background:#fff}
    #ozon-erp-1688-floating .ozon-erp-sku-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    #ozon-erp-1688-floating .ozon-erp-sku-head span{font-size:12px;font-weight:800;color:#111827}
    #ozon-erp-1688-floating .ozon-erp-sku-head button{height:26px;border:1px solid rgba(15,23,42,.12);border-radius:6px;background:#fff;color:#374151;font-size:12px;font-weight:800;cursor:pointer}
    #ozon-erp-1688-floating .ozon-erp-sku-list{max-height:118px;overflow:auto;display:grid;gap:5px;color:#64748b;font-size:12px}
    #ozon-erp-1688-floating .ozon-erp-sku-list label{display:flex;align-items:center;gap:6px;min-width:0;color:#374151}
    #ozon-erp-1688-floating .ozon-erp-sku-list input{accent-color:#ff6a00}
    #ozon-erp-1688-floating .ozon-erp-sku-list span{color:#94a3b8}
    #ozon-erp-1688-floating .ozon-erp-size-box{display:grid;gap:8px;border:1px solid rgba(255,106,0,.22);border-radius:8px;padding:9px;background:#fff7ed}
    #ozon-erp-1688-floating .ozon-erp-size-title{color:#9a3412;font-weight:800}
    #ozon-erp-1688-floating .ozon-erp-size-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
    #ozon-erp-1688-floating .ozon-erp-size-grid input{width:100%;height:32px;border:1px solid rgba(15,23,42,.14);border-radius:6px;padding:0 8px;font-size:12px;background:#fff;color:#111827;outline:none}
    #ozon-erp-1688-floating .ozon-erp-apply-sku{display:flex;align-items:center;gap:5px;font-size:12px;color:#7c2d12}
    #ozon-erp-1688-floating.minimized{width:54px;height:54px;padding:0;border-radius:999px;display:flex;align-items:center;justify-content:center}
    #ozon-erp-1688-floating.minimized .ozon-erp-head,
    #ozon-erp-1688-floating.minimized #ozon-erp-expanded{display:none}
    #ozon-erp-1688-floating.minimized #ozon-erp-minimized{display:block !important;border:0;border-radius:999px;width:46px;height:46px;background:#ff6a00;color:#fff;font-size:15px;font-weight:800;cursor:move;box-shadow:0 10px 24px rgba(255,106,0,.28)}
  `;
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(panel);
  bindFloatingDrag(panel);
  bindMinimizeToggle(panel);
  collectPage({ includeVideo: false }).then((payload) => {
    panel.querySelector("#ozon-erp-title").textContent = payload.title || "当前商品";
    prefillManualPackageInfo(panel, payload.packageInfo || {});
    renderSkuSelector(panel, payload.skuVariants || []);
  }).catch(() => {});
  loadStoreOptions(panel.querySelector("#ozon-erp-1688-store"), panel.querySelector("#ozon-erp-1688-status"));
  const manualSizeInputs = ["#ozon-erp-weight", "#ozon-erp-length", "#ozon-erp-width", "#ozon-erp-height"]
    .map((selector) => panel.querySelector(selector))
    .filter(Boolean);
  manualSizeInputs.forEach((input) => input.addEventListener("input", () => {
    const values = manualSizeInputs.map((field) => toNumber(field.value));
    const status = panel.querySelector("#ozon-erp-1688-status");
    const button = panel.querySelector("#ozon-erp-1688-collect");
    if (values.every((value) => value > 0) && !button.disabled) {
      const previousLabel = button.textContent || "";
      button.textContent = "采集到 ERP";
      if (previousLabel === "补齐后入箱" || /Internal server error|补齐/.test(status.textContent || "")) {
        status.textContent = "尺重已补齐，可重新入箱";
        status.style.color = "#667085";
      }
    }
  }));
  panel.querySelector("#ozon-erp-1688-collect").addEventListener("click", async () => {
    const button = panel.querySelector("#ozon-erp-1688-collect");
    const status = panel.querySelector("#ozon-erp-1688-status");
    const sizeBox = panel.querySelector("#ozon-erp-1688-size-box");
    button.disabled = true;
    button.textContent = "采集中...";
    status.textContent = "采集中...";
    try {
      const payload = await collectPage({
        includeVideo: panel.querySelector("#ozon-erp-1688-video").checked,
        storeId: panel.querySelector("#ozon-erp-1688-store").value,
      });
      payload.skuVariants = filterSelectedSkus(payload.skuVariants || []);
      const manualPackageInfo = readManualPackageInfo(panel);
      if (manualPackageInfo) applyManualPackageInfo(payload, manualPackageInfo, panel.querySelector("#ozon-erp-apply-all-sku").checked);
      payload.html = buildCompactCaptureHtml(captureDataForSnapshot(payload));
      const sizeWeightStatus = productSizeWeightStatus(payload);
      if (!sizeWeightStatus.ok) {
        prefillManualPackageInfo(panel, payload.packageInfo || {});
        status.textContent = sizeWeightStatus.message;
        status.style.color = "#b42318";
        button.textContent = "补齐后入箱";
        return;
      }
      const result = await erpApiRequest("/api/1688/capture", {
        method: "POST",
        body: payload,
      });
      const captureReceipt = result.captureReceipt || {};
      const receiptIdentity = captureReceipt.captureIdentity || captureReceipt.identity || {};
      const captureIdentity = receiptIdentity;
      const snapshotHash = String(captureReceipt.snapshotHash || captureIdentity.snapshotHash || "");
      const hashShort = snapshotHash ? `${snapshotHash.slice(0, 15)}…${snapshotHash.slice(-8)}` : "快照未回传";
      button.textContent = "采集到 ERP";
      if (result.duplicate) {
        status.textContent = `已采集过 ${result.id || ""}`;
        status.style.color = "#b54708";
        return;
      }
      status.textContent = sizeWeightStatus.ok
        ? `已入箱 ${result.id || ""}`
        : `已入箱，${sizeWeightStatus.message}`;
      if (captureReceipt.snapshotHash || receiptIdentity.taskId) {
        status.textContent += ` · ${receiptIdentity.taskId ? `任务 ${receiptIdentity.taskId}` : "任务未绑定"} · 快照 ${hashShort}`;
      }
      status.style.color = sizeWeightStatus.ok ? "#667085" : "#b42318";
    } catch (error) {
      status.textContent = error.message || "失败";
      status.style.color = "#b42318";
      button.textContent = "重试采集";
    } finally {
      button.disabled = false;
    }
  });
}

function bindFloatingDrag(panel) {
  const handles = [
    panel,
    panel.querySelector(".ozon-erp-drag-handle"),
    panel.querySelector("#ozon-erp-minimized"),
  ].filter(Boolean);
  let dragging = false;
  let dragged = false;
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let offsetY = 0;
  const startDrag = (event) => {
    if (event.button !== 0) return;
    const isMini = event.target.closest("#ozon-erp-minimized");
    const isHandle = event.target.closest(".ozon-erp-drag-handle");
    const isControl = event.target.closest("button, a, input, select, textarea, label");
    if (!isMini && !isHandle && isControl) return;
    dragging = true;
    dragged = false;
    startX = event.clientX;
    startY = event.clientY;
    const rect = panel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    event.preventDefault();
  };
  handles.forEach((handle) => handle.addEventListener("mousedown", startDrag));
  document.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > 4) dragged = true;
    const width = panel.offsetWidth || 54;
    const height = panel.offsetHeight || 54;
    const left = Math.min(Math.max(0, event.clientX - offsetX), Math.max(0, window.innerWidth - width));
    const top = Math.min(Math.max(0, event.clientY - offsetY), Math.max(0, window.innerHeight - height));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
  document.addEventListener("mouseup", () => {
    dragging = false;
    panel.dataset.wasDragged = dragged ? "1" : "0";
    window.setTimeout(() => {
      panel.dataset.wasDragged = "0";
    }, 0);
  });
}

function bindMinimizeToggle(panel) {
  const toggle = panel.querySelector("#ozon-erp-toggle");
  const mini = panel.querySelector("#ozon-erp-minimized");
  const expandedStyle = {
    display: "grid",
    alignItems: "stretch",
    gap: "12px",
    width: "360px",
    height: "auto",
    padding: "12px",
    border: "1px solid rgba(15, 23, 42, .12)",
    borderRadius: "8px",
    background: "rgba(255,255,255,.96)",
    boxShadow: "0 18px 42px rgba(15, 23, 42, .16)",
  };
  const minimizedStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0",
    width: "54px",
    height: "54px",
    padding: "0",
    border: "0",
    borderRadius: "999px",
    background: "transparent",
    boxShadow: "none",
  };
  const clamp = (value, size, max) => Math.min(Math.max(0, value), Math.max(0, max - size));
  const setState = (minimized) => {
    const rect = panel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    floatingState.minimized = minimized;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.classList.toggle("minimized", minimized);
    Object.assign(panel.style, minimized ? minimizedStyle : expandedStyle);
    const width = panel.offsetWidth || (minimized ? 54 : 360);
    const height = panel.offsetHeight || (minimized ? 54 : rect.height);
    panel.style.left = `${clamp(centerX - width / 2, width, window.innerWidth)}px`;
    panel.style.top = `${clamp(centerY - height / 2, height, window.innerHeight)}px`;
    if (toggle) toggle.textContent = minimized ? "+" : "-";
  };
  toggle?.addEventListener("click", () => setState(!floatingState.minimized));
  mini?.addEventListener("click", (event) => {
    if (panel.dataset.wasDragged === "1" || Math.abs(event.detail) > 1) return;
    setState(false);
  });
}

function skuKey(sku, index) {
  return String(sku?.skuId || sku?.spec || index);
}

function skuRows(variants) {
  return (variants || []).map((sku, index) => ({
    key: skuKey(sku, index),
    label: cleanText(sku.spec || sku.skuId || `SKU${index + 1}`),
  }));
}

function renderSkuSelector(panel, variants) {
  const list = panel.querySelector("#ozon-erp-sku-list");
  const toggle = panel.querySelector("#ozon-erp-sku-toggle");
  if (!list || !toggle) return;
  const rows = skuRows(variants);
  if (floatingState.allSelected) {
    floatingState.selectedSkuKeys = new Set(rows.map((row) => row.key));
  }
  list.innerHTML = rows.length
    ? rows.map((row) => `<label><input type="checkbox" data-sku-key="${escapeAttr(row.key)}" ${floatingState.selectedSkuKeys.has(row.key) ? "checked" : ""}/> <span>${escapeHtml(row.label)}</span></label>`).join("")
    : "<span>当前页面没有识别到可选 SKU，将按商品整体采集。</span>";
  list.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const key = checkbox.dataset.skuKey || "";
      if (checkbox.checked) floatingState.selectedSkuKeys.add(key);
      else floatingState.selectedSkuKeys.delete(key);
      floatingState.allSelected = rows.length > 0 && floatingState.selectedSkuKeys.size === rows.length;
      toggle.textContent = floatingState.allSelected ? "不全选" : "全选";
    });
  });
  toggle.textContent = floatingState.allSelected ? "不全选" : "全选";
  toggle.onclick = () => {
    const nextAll = !floatingState.allSelected;
    floatingState.allSelected = nextAll;
    floatingState.selectedSkuKeys = new Set(nextAll ? rows.map((row) => row.key) : []);
    renderSkuSelector(panel, variants);
  };
}

function filterSelectedSkus(variants, selectedKeys = floatingState.selectedSkuKeys) {
  if (!Array.isArray(variants) || !variants.length || !(selectedKeys instanceof Set)) return variants;
  return variants.filter((sku, index) => selectedKeys.has(skuKey(sku, index)));
}

function sizeWeightFields() {
  return [
    { key: "weightG", label: "重量" },
    { key: "lengthMm", label: "长" },
    { key: "widthMm", label: "宽" },
    { key: "heightMm", label: "高" },
  ];
}

function missingSizeWeightFields(source = {}) {
  return sizeWeightFields()
    .filter((field) => !Number(source[field.key] || 0))
    .map((field) => field.label);
}

function productSizeWeightStatus(payload = {}) {
  const productMissing = missingSizeWeightFields(payload.packageInfo || {});
  const skuMissing = (payload.skuVariants || [])
    .map((sku, index) => ({ index: index + 1, missing: missingSizeWeightFields(sku) }))
    .filter((item) => item.missing.length);
  if (!productMissing.length && !skuMissing.length) return { ok: true, message: "" };
  const parts = [];
  if (productMissing.length) parts.push(`商品缺${productMissing.join("、")}`);
  if (skuMissing.length) parts.push(`${skuMissing.length}个SKU缺尺重`);
  return { ok: false, message: parts.join("；") };
}

function readManualPackageInfo(panel) {
  const values = {
    weightG: toNumber(panel.querySelector("#ozon-erp-weight")?.value),
    lengthMm: toNumber(panel.querySelector("#ozon-erp-length")?.value),
    widthMm: toNumber(panel.querySelector("#ozon-erp-width")?.value),
    heightMm: toNumber(panel.querySelector("#ozon-erp-height")?.value),
  };
  return Object.values(values).some(Boolean) ? values : null;
}

function prefillManualPackageInfo(panel, packageInfo = {}) {
  const mapping = [
    ["#ozon-erp-weight", "weightG"],
    ["#ozon-erp-length", "lengthMm"],
    ["#ozon-erp-width", "widthMm"],
    ["#ozon-erp-height", "heightMm"],
  ];
  for (const [selector, key] of mapping) {
    const input = panel.querySelector(selector);
    if (input && !input.value && packageInfo[key]) input.value = packageInfo[key];
  }
}

function applyManualPackageInfo(payload, manual, applyAllSku = true) {
  payload.packageInfo = {
    ...(payload.packageInfo || {}),
    weightG: payload.packageInfo?.weightG || manual.weightG || "",
    lengthMm: payload.packageInfo?.lengthMm || manual.lengthMm || "",
    widthMm: payload.packageInfo?.widthMm || manual.widthMm || "",
    heightMm: payload.packageInfo?.heightMm || manual.heightMm || "",
  };
  payload.packageInfo.weight = payload.packageInfo.weightG ? `${payload.packageInfo.weightG} g` : "";
  payload.packageInfo.dimensions = payload.packageInfo.lengthMm && payload.packageInfo.widthMm && payload.packageInfo.heightMm
    ? `${payload.packageInfo.lengthMm}x${payload.packageInfo.widthMm}x${payload.packageInfo.heightMm} mm`
    : "";
  if (!applyAllSku) return;
  payload.skuVariants = (payload.skuVariants || []).map((sku) => ({
    ...sku,
    weightG: sku.weightG || manual.weightG || payload.packageInfo.weightG || "",
    lengthMm: sku.lengthMm || manual.lengthMm || payload.packageInfo.lengthMm || "",
    widthMm: sku.widthMm || manual.widthMm || payload.packageInfo.widthMm || "",
    heightMm: sku.heightMm || manual.heightMm || payload.packageInfo.heightMm || "",
  }));
}

async function loadStoreOptions(select, statusEl) {
  try {
    const data = await erpApiRequest("/api/stores");
    const saved = await getSavedStoreId();
    select.innerHTML = (data.stores || [])
      .map((store) => `<option value="${escapeAttr(store.id)}">${escapeHtml(store.name)} - ${escapeHtml(store.clientId)}</option>`)
      .join("");
    if (saved && [...select.options].some((option) => option.value === saved)) select.value = saved;
    select.addEventListener("change", () => saveStoreId(select.value));
  } catch (error) {
    statusEl.textContent = "未连接 ERP";
  }
}

function getSavedStoreId() {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local?.get(["lastStoreId"], (result) => resolve(result?.lastStoreId || ""));
    } catch {
      resolve(localStorage.getItem("ozonErpLastStoreId") || "");
    }
  });
}

function saveStoreId(storeId) {
  try {
    chrome.storage?.local?.set({ lastStoreId: storeId });
  } catch {
    localStorage.setItem("ozonErpLastStoreId", storeId);
  }
}

function injectPageReader() {
  if (document.documentElement.dataset.ozonErp1688Injected === "1") return true;
  const getUrl = globalThis.chrome?.runtime?.getURL;
  if (!getUrl) return false;
  document.documentElement.dataset.ozonErp1688Injected = "1";
  const script = document.createElement("script");
  script.src = getUrl("injected.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
  return true;
}

async function getContextData() {
  if (!injectPageReader()) return null;
  for (let i = 0; i < 12; i += 1) {
    window.postMessage({ type: "OZON_ERP_1688_REQUEST_CONTEXT" }, "*");
    await sleep(250);
    const data = pageContext?.result?.data || pageContext?.data || null;
    if (data) return data;
  }
  return null;
}

function pickOfferId(data) {
  return String(data?.gallery?.fields?.offerId || location.pathname.match(/\/offer\/(\d+)/)?.[1] || "");
}

function pickTitle(data) {
  const candidates = [
    data?.productTitle?.fields?.title,
    document.querySelector("h1.mod-detail-title__name")?.innerText,
    document.querySelector("h1")?.innerText,
    document.title,
  ];
  return candidates.map(cleanText).find((text) => text.length > 5 && !isCompanyName(text)) || "";
}

function pickSupplier(data) {
  const shop = data?.productTitle?.fields?.shopInfo || {};
  return cleanText(shop.companyName || shop.authCompanyName || "");
}

function pickDescription(data) {
  return data?.description?.fields?.detailUrl || "";
}

function pickImages(data) {
  const gallery = data?.gallery?.fields || {};
  const images = [
    ...(Array.isArray(gallery.mainImage) ? gallery.mainImage : []),
    ...(Array.isArray(gallery.offerImgList) ? gallery.offerImgList : []),
    ...domProductImages(),
  ];
  return dedupe(images.map(normalizeImage).filter(Boolean)).slice(0, 80);
}

function pickVideo(data) {
  const video = data?.gallery?.fields?.video || {};
  const url = video.videoUrl || document.querySelector("video")?.currentSrc || document.querySelector("video")?.src || "";
  if (!url) return null;
  return {
    url,
    coverUrl: video.coverUrl || "",
    title: video.title || "",
    videoId: video.videoId || "",
  };
}

function domProductImages() {
  return [...document.images]
    .map((image) => image.currentSrc || image.src)
    .filter((src) => /cbu01\.alicdn\.com\/img\/ibank|alicdn\.com\/img\/ibank/i.test(src))
    .filter((src) => !/tps-|cms\/upload|icon|logo|overseas_pic/i.test(src));
}

function pickAttributes(data) {
  const attrs = [];
  const cpv = data?.gallery?.fields?.CpvEnhance;
  for (const list of [cpv?.decisionCpv, cpv?.normalCpv]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item?.name || item.values == null) continue;
      attrs.push({
        name: cleanText(item.name),
        value: Array.isArray(item.values) ? item.values.map(cleanText).join(", ") : cleanText(item.values),
      });
    }
  }

  if (attrs.length) return attrs;

  return [...document.querySelectorAll(".ant-descriptions-row")].flatMap((row) => {
    const cells = [...row.querySelectorAll(".ant-descriptions-item-label, .ant-descriptions-item-content")];
    const rowAttrs = [];
    for (let index = 0; index < cells.length - 1; index += 1) {
      if (!cells[index].className.includes("label")) continue;
      const name = cleanText(cells[index].innerText);
      const value = cleanText(cells[index + 1].innerText);
      if (name && value) rowAttrs.push({ name, value });
    }
    return rowAttrs;
  });
}

function pickPackageInfo(data) {
  const packRows = data?.productPackInfo?.fields?.pieceWeightScale?.pieceWeightScaleInfo;
  const skuPackageMap = {};
  if (Array.isArray(packRows)) {
    for (const item of packRows) {
      if (!item?.skuId) continue;
      skuPackageMap[String(item.skuId)] = {
        weightG: toNumber(item.weight),
        lengthMm: toNumber(item.length) * 10,
        widthMm: toNumber(item.width) * 10,
        heightMm: toNumber(item.height) * 10,
        weightText: `${toNumber(item.weight)} g`,
        dimensions: `${toNumber(item.length)}x${toNumber(item.width)}x${toNumber(item.height)} cm`,
      };
    }
  }
  const first = Object.values(skuPackageMap)[0] || {};
  return {
    weightG: first.weightG || "",
    lengthMm: first.lengthMm || "",
    widthMm: first.widthMm || "",
    heightMm: first.heightMm || "",
    weight: first.weightText || "",
    dimensions: first.dimensions || "",
    skuPackageMap,
  };
}

function pickSkuVariants(data, skuPackageMap) {
  const priceData = data?.mainPrice?.fields?.finalPriceModel?.tradeWithoutPromotion || {};
  const skuMap = Array.isArray(priceData.skuMapOriginal) ? priceData.skuMapOriginal : [];
  const displayPrice = data?.mainPrice?.fields?.displayPrice || "";
  const priceRange = priceData.offerMinPrice && priceData.offerMaxPrice
    ? (priceData.offerMinPrice === priceData.offerMaxPrice ? priceData.offerMinPrice : `${priceData.offerMinPrice}-${priceData.offerMaxPrice}`)
    : "";
  const imageMap = skuImageMap(data);
  const mainImages = data?.gallery?.fields?.mainImage || [];

  const variants = skuMap.map((item, index) => {
    const skuId = String(item.skuId || "");
    const spec = cleanText(item.specAttrs || item.skuName || "");
    const pkg = skuPackageMap[skuId] || {};
    return {
      skuId,
      spec,
      price: cleanPrice(item.price || item.discountPrice || item.skuPrice || item.tradePrice || priceRange || displayPrice),
      stock: toNumber(item.canBookCount || item.stock || item.quantity),
      image: normalizeImage(imageMap[spec] || mainImages[index % Math.max(mainImages.length, 1)] || ""),
      weightG: pkg.weightG || "",
      lengthMm: pkg.lengthMm || "",
      widthMm: pkg.widthMm || "",
      heightMm: pkg.heightMm || "",
    };
  }).filter((item) => item.spec || item.price || item.skuId);

  if (variants.length) return dedupeBy(variants, (item) => item.spec || item.skuId);

  const styleAttr = pickAttributes(data).find((item) => /款式|颜色|规格|型号/.test(item.name) && item.value.includes(","));
  if (!styleAttr) return [];
  return styleAttr.value.split(/[,，]/).map(cleanText).filter(Boolean).map((value) => ({
    skuId: "",
    spec: `${styleAttr.name}: ${value}`,
    price: cleanPrice(priceRange || displayPrice),
    stock: "",
    image: "",
  }));
}

function skuImageMap(data) {
  const props = data?.Root?.fields?.dataJson?.skuModel?.skuProps || [];
  const map = {};
  for (const prop of props) {
    for (const value of prop.value || []) {
      if (value?.name && value?.imageUrl) map[cleanText(value.name)] = normalizeImage(value.imageUrl);
    }
  }
  return map;
}

function extractOfferLinksFromPage() {
  const urls = new Set();
  const addOfferId = (value) => {
    const id = String(value || "").match(/\d{8,14}/)?.[0];
    if (id) urls.add(`https://detail.1688.com/offer/${id}.html`);
  };
  const add = (value) => {
    const url = String(value || "").replace(/^\/\//, "https://");
    const match = url.match(/https?:\/\/detail\.1688\.com\/offer\/\d+\.html/i);
    if (match) urls.add(match[0]);
    try {
      const parsed = new URL(url);
      addOfferId(parsed.searchParams.get("offerId"));
      for (const id of String(parsed.searchParams.get("offerIds") || "").split(/[,\s]+/)) addOfferId(id);
    } catch {
      for (const match of url.matchAll(/offerIds?=(\d{8,14})/gi)) addOfferId(match[1]);
    }
  };
  document.querySelectorAll("a[href]").forEach((link) => add(link.href || link.getAttribute("href")));
  const html = document.documentElement.outerHTML;
  for (const match of html.matchAll(/(?:https?:)?\/\/detail\.1688\.com\/offer\/\d+\.html/gi)) add(match[0]);
  for (const match of html.matchAll(/offerIds?["'=:\s%]+(\d{8,14})/gi)) addOfferId(match[1]);
  return [...urls];
}

async function extractOfferLinksWithScroll(maxProducts = 20) {
  const target = Math.max(1, Number(maxProducts || 20));
  let urls = extractOfferLinksFromPage();
  for (let i = 0; i < 12 && urls.length < target; i += 1) {
    window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.85)));
    await sleep(900);
    urls = [...new Set([...urls, ...extractOfferLinksFromPage()])];
  }
  window.scrollTo(0, 0);
  return urls.slice(0, target);
}

function pageNeedsHumanCheck() {
  const text = `${document.title} ${document.body?.innerText || ""}`.toLowerCase();
  return /验证码|人机|滑块|访问频繁|安全验证|登录|please slide|verify/.test(text);
}

function pageNeedsOzonHumanCheck() {
  const text = `${document.title} ${document.body?.innerText || ""}`.toLowerCase();
  return /captcha|robot|access denied|доступ ограничен|подтвердите|проверка|войдите/.test(text);
}

function normalizeOzonUrl(value = "") {
  try {
    const url = new URL(String(value || "").replace(/^\/\//, "https://"), "https://www.ozon.ru");
    if (!/(^|\.)ozon\.ru$/i.test(url.hostname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeOzonImageUrl(value = "") {
  try {
    const url = new URL(String(value || "").replace(/^\/\//, "https://"), "https://www.ozon.ru");
    if (!/(^|\.)ozon\.ru$/i.test(url.hostname) && !/(^|\.)ozonusercontent\.com$/i.test(url.hostname)) return "";
    if (/\/marketing-api\/+banners\//i.test(url.pathname)) return "";
    if (/\/fs-my-account-avatar\//i.test(url.pathname)) return "";
    if (/seller|avatar|logo|icon|badge|sprite|placeholder/i.test(url.pathname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function ozonImageScore(url = "", source = "") {
  const text = `${url} ${source}`.toLowerCase();
  let score = 0;
  if (/ozonusercontent\.com/.test(text)) score += 20;
  if (/product|product-service|multimedia|s3\//.test(text)) score += 18;
  if (/webgallery|gallery|cover|photo|image/.test(text)) score += 10;
  if (/wc\d{2,4}|ws\d{2,4}|w\d{2,4}|h\d{2,4}/.test(text)) score += 4;
  if (/marketing-api|banner|avatar|seller|logo|icon|badge|sprite|placeholder|my-account/.test(text)) score -= 80;
  if (/\/category\/|\/highlight\//.test(text)) score -= 25;
  return score;
}

function collectOzonGalleryImages() {
  const rows = [];
  const scopedSelectors = [
    '[data-widget*="webGallery"] img',
    '[data-widget*="WebGallery"] img',
    '[data-widget*="gallery"] img',
    '[data-widget*="Gallery"] img',
    '[class*="gallery"] img',
    '[class*="Gallery"] img',
    '[class*="swiper"] img',
    '[class*="carousel"] img',
  ];
  scopedSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((image, index) => {
      const src = normalizeOzonImageUrl(image.currentSrc || image.src || image.getAttribute("src") || image.getAttribute("data-src") || "");
      if (src) rows.push({ src, score: ozonImageScore(src, selector) + 120 - index });
    });
  });
  [...document.images].forEach((image, index) => {
    const src = normalizeOzonImageUrl(image.currentSrc || image.src || image.getAttribute("src") || "");
    if (!src) return;
    rows.push({ src, score: ozonImageScore(src, image.closest?.("[data-widget], [class]")?.outerHTML?.slice(0, 300) || "") - index / 100 });
  });
  return dedupe(rows
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.src))
    .slice(0, 20);
}

function parseRubPrice(text = "") {
  const match = String(text || "").replace(/\s+/g, "").match(/\d+(?:[,.]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : "";
}

function ozonProductIdFromUrl(url = "") {
  return String(url || "").match(/-(\d+)\/?\??/)?.[1] || String(url || "").match(/\/product\/[^/]+\/(\d+)/)?.[1] || "";
}

function extractOzonCardFromLink(link, index) {
  const url = normalizeOzonUrl(link.href || link.getAttribute("href") || "");
  if (!url || !/\/product\//i.test(url)) return null;
  const card = link.closest('[data-widget], [class*="tile"], [class*="product"], article, div') || link.parentElement;
  const text = cleanText(card?.innerText || link.innerText || "");
  if (text.length < 8) return null;
  const image = normalizeOzonImageUrl(card?.querySelector("img")?.currentSrc || card?.querySelector("img")?.src || "");
  const titleCandidates = [
    link.getAttribute("title"),
    link.querySelector("span")?.innerText,
    link.innerText,
    text.split("\n").find((line) => line.length > 12 && !/[₽%]/.test(line)),
  ];
  const title = titleCandidates.map(cleanText).find((item) => item.length > 6) || cleanText(document.title);
  const priceLine = text.split(/\n/).find((line) => /₽|руб/i.test(line)) || "";
  const oldPriceLine = text.split(/\n/).find((line) => /−|%/.test(line) && /₽|руб/i.test(line)) || "";
  const ratingMatch = text.match(/([1-5][,.]\d)\s*(?:\d+\s*)?(?:отзыв|review|оцен)/i);
  const reviewMatch = text.match(/([\d\s]+)\s*(?:отзыв|reviews?)/i);
  const badges = text.split(/\n/).map(cleanText).filter((line) => /скид|акци|sale|распрод/i.test(line)).slice(0, 6);
  return {
    url,
    title,
    image,
    price: parseRubPrice(priceLine),
    oldPrice: parseRubPrice(oldPriceLine),
    discount: cleanText(text.match(/−\s*\d+%|-\s*\d+%/)?.[0] || ""),
    rating: ratingMatch ? Number(ratingMatch[1].replace(",", ".")) : "",
    reviewCount: reviewMatch ? Number(reviewMatch[1].replace(/\s+/g, "")) : "",
    position: index + 1,
    sku: ozonProductIdFromUrl(url),
    badges,
  };
}

function extractOzonSearchItems() {
  const seen = new Set();
  const rows = [];
  const links = [...document.querySelectorAll('a[href*="/product/"]')];
  for (const link of links) {
    const item = extractOzonCardFromLink(link, rows.length);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    rows.push(item);
  }
  return rows;
}

async function extractOzonSearchItemsWithScroll(maxProducts = 30) {
  const target = Math.max(1, Number(maxProducts || 30));
  let items = extractOzonSearchItems();
  for (let i = 0; i < 12 && items.length < target; i += 1) {
    window.scrollBy(0, Math.max(700, Math.floor(window.innerHeight * 0.9)));
    await sleep(1000);
    const merged = [...items, ...extractOzonSearchItems()];
    const byUrl = new Map();
    for (const item of merged) if (item.url && !byUrl.has(item.url)) byUrl.set(item.url, { ...item, position: byUrl.size + 1 });
    items = [...byUrl.values()];
  }
  window.scrollTo(0, 0);
  return items.slice(0, target);
}

function collectOzonDetail() {
  const title = cleanText(document.querySelector("h1")?.innerText || document.title.replace(/\s+\|.*$/, ""));
  const images = collectOzonGalleryImages();
  const attributes = [];
  document.querySelectorAll("dl, table, [data-widget*='webCharacteristics']").forEach((box) => {
    const text = box.innerText || "";
    for (const line of text.split(/\n+/)) {
      const parts = line.split(/\s{2,}|:|—/).map(cleanText).filter(Boolean);
      if (parts.length >= 2 && parts[0].length < 80 && parts[1].length < 240) {
        attributes.push({ name: parts[0], value: parts.slice(1).join(" ") });
      }
    }
  });
  const breadcrumbs = [...document.querySelectorAll('a[href*="/category/"], a[href*="/highlight/"]')]
    .map((link) => cleanText(link.innerText))
    .filter(Boolean)
    .slice(0, 8);
  return {
    url: location.href,
    productId: ozonProductIdFromUrl(location.href),
    title,
    image: images[0] || "",
    images,
    category: breadcrumbs.join(" > "),
    attributes: dedupeBy(attributes, (item) => `${item.name}:${item.value}`).slice(0, 80),
    description: cleanText(document.body?.innerText || "").slice(0, 4000),
    collectedAt: new Date().toISOString(),
  };
}

async function sendToErp(payload) {
  return erpApiRequest("/api/1688/capture", {
    method: "POST",
    body: payload,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "EXTRACT_1688_OFFER_LINKS") {
    (async () => {
      sendResponse({
        ok: true,
        urls: await extractOfferLinksWithScroll(message.maxProducts),
        needsHuman: pageNeedsHumanCheck(),
        url: location.href,
        title: document.title,
      });
    })();
    return true;
  }
  if (message?.type === "COLLECT_1688_PRODUCT_RAW") {
    (async () => {
      try {
        const payload = await collectPage({ includeVideo: message.includeVideo !== false, storeId: message.storeId || "", taskId: message.taskId || "", captureMode: "extension_browser" });
        sendResponse({ ok: true, payload, needsHuman: pageNeedsHumanCheck() });
      } catch (error) {
        sendResponse({ ok: false, error: error.message, needsHuman: pageNeedsHumanCheck() });
      }
    })();
    return true;
  }
  if (message?.type === "EXTRACT_OZON_SEARCH_ITEMS") {
    (async () => {
      try {
        if (!isOzonPage()) throw new Error("当前不是 Ozon 页面。");
        sendResponse({
          ok: true,
          items: await extractOzonSearchItemsWithScroll(message.maxProducts),
          needsHuman: pageNeedsOzonHumanCheck(),
          url: location.href,
          title: document.title,
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message, items: [], needsHuman: pageNeedsOzonHumanCheck() });
      }
    })();
    return true;
  }
  if (message?.type === "COLLECT_OZON_PRODUCT_DETAIL") {
    (async () => {
      try {
        if (!isOzonPage()) throw new Error("当前不是 Ozon 页面。");
        sendResponse({ ok: true, payload: collectOzonDetail(), needsHuman: pageNeedsOzonHumanCheck() });
      } catch (error) {
        sendResponse({ ok: false, error: error.message, needsHuman: pageNeedsOzonHumanCheck() });
      }
    })();
    return true;
  }
  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING_1688_COLLECTOR") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type !== "COLLECT_1688_PRODUCT") return false;

  (async () => {
    try {
      if (!/\.1688\.com$/i.test(location.hostname) && !/^1688\.com$/i.test(location.hostname)) {
        throw new Error("请在 1688 商品详情页使用采集插件。");
      }
      const payload = await collectPage({ includeVideo: message.includeVideo !== false, storeId: message.storeId || "" });
      if (Array.isArray(message.selectedSkuKeys)) {
        payload.skuVariants = filterSelectedSkus(payload.skuVariants || [], new Set(message.selectedSkuKeys));
      }
      if (message.manualPackageInfo) applyManualPackageInfo(payload, message.manualPackageInfo, message.applyAllSku !== false);
      const sizeWeightStatus = productSizeWeightStatus(payload);
      if (!sizeWeightStatus.ok) {
        sendResponse({
          ok: true,
          needsSizeWeight: true,
          message: sizeWeightStatus.message,
          packageInfo: payload.packageInfo || {},
          skuVariants: payload.skuVariants || [],
          title: payload.title || "",
        });
        return;
      }
      const result = await sendToErp(payload);
      sendResponse({
        ok: true,
        duplicate: Boolean(result.duplicate),
        message: result.duplicateMessage || "",
        id: result.id || "",
        collectionId: result.id || "",
        title: result.title || payload.title || "",
        url: payload.url,
        receivedAt: result.receivedAt || "",
        captureReceipt: result.captureReceipt || null,
      });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function cleanPrice(value) {
  const text = String(value || "");
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : "";
}

function toNumber(value) {
  const number = Number(String(value || "").match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : "";
}

function normalizeImage(value) {
  if (!value) return "";
  let url = String(value).replace(/^\/\//, "https://").replaceAll("\\/", "/");
  url = url.replace(/(?:_|\.)((?:\d+x\d+)|sum|search|summ|webp).*$/i, "");
  if (!/^https?:\/\//i.test(url)) return "";
  if (!/\.(jpg|jpeg|png|webp)/i.test(url)) return "";
  if (/tps-|cms\/upload|icon|logo|overseas_pic/i.test(url)) return "";
  return url;
}

function isCompanyName(text) {
  return /有限公司|股份有限公司|合作社|商行|经营部|贸易公司|实业公司|科技公司|官方旗舰店|工厂店|专营店/i.test(text || "");
}

function dedupe(items) {
  return [...new Set(items)];
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
