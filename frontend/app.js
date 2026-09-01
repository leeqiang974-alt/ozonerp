const apiBase = window.ERP_API_BASE || ((location.hostname === "127.0.0.1" || location.hostname === "localhost") ? "http://127.0.0.1:8000" : "");
let shops = [];
let allPostings = [];
let activeOrderFilter = "all";
let activeView = "dashboard";
const collectionState = { page: 1, pageSize: 100, total: 0, pages: 1 };
const listingCategoryRequests = window.ListingAttributes.createRequestGate();
const listingAttributeRequests = window.ListingAttributes.createRequestGate();
const $ = selector => document.querySelector(selector);

function toast(message, isError = false) { const box = $("#toast"); box.textContent = message; box.className = isError ? "show error" : "show"; setTimeout(() => box.className = "", 2800); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function lineImage(url, name) { return url ? `<img class="line-image" src="${escapeHtml(url)}" alt="${escapeHtml(name || "商品图片")}" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="line-image-placeholder">无图</span>'; }
function installCategorySelector() { const input = document.querySelector('#listing-form input[name="category_id"]'); if (!input) return; input.outerHTML = '<select name="category_choice" id="listing-category" required><option value="">请先选择店铺并加载类目</option></select>'; const select = $("#listing-category"); select.parentElement.insertAdjacentHTML("afterend", '<div id="listing-required-attributes"><span class="listing-attribute-title">选择类目后填写 Ozon 必填属性</span></div>'); select.addEventListener("change", loadCategoryAttributes); }
async function loadListingCategories() { const shopId = $("#shop-filter").value; const select = $("#listing-category"); const token = listingCategoryRequests.begin(shopId); select.dataset.shopId = ""; select.innerHTML = '<option value="">正在加载 Ozon 类目…</option>'; try { let response = await fetch(`${apiBase}/api/v1/shops/${shopId}/metadata/categories`); let categories = response.ok ? await response.json() : []; if (!categories.length) { await fetch(`${apiBase}/api/v1/shops/${shopId}/metadata/categories`, { method: "POST" }); response = await fetch(`${apiBase}/api/v1/shops/${shopId}/metadata/categories`); categories = await response.json(); } if (!listingCategoryRequests.isCurrent(token, $("#shop-filter").value)) return; select.dataset.shopId = shopId; select.innerHTML = '<option value="">请选择末级类目与商品类型</option>' + categories.map(item => `<option value="${item.category_id}:${item.type_id}">${escapeHtml(item.title)}</option>`).join(""); } catch (_) { if (listingCategoryRequests.isCurrent(token, $("#shop-filter").value)) select.innerHTML = '<option value="">类目加载失败，请稍后重试</option>'; } }
function installDictionarySearch(categoryId, typeId, shopId) { document.querySelectorAll('#listing-required-attributes input[data-attribute-kind="dictionary"]').forEach(control => { let timer; const requests = window.ListingAttributes.createRequestGate(); control.addEventListener("input", () => { control.setCustomValidity(""); clearTimeout(timer); const query = control.value.trim(); const list = document.getElementById(control.getAttribute("list")); const selected = [...(list?.options || [])].find(item => item.value === query); if (selected) { control.dataset.valueId = selected.dataset.valueId || ""; control.dataset.valueText = selected.dataset.valueText || ""; requests.invalidate(); return; } control.dataset.valueId = ""; control.dataset.valueText = ""; const token = requests.begin(query); if (query.length < 2) { if (list) list.innerHTML = ""; return; } timer = setTimeout(async () => { try { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/metadata/categories/${categoryId}/types/${typeId}/attributes/${control.dataset.listingAttribute}/values?query=${encodeURIComponent(query)}&limit=50`); if (!response.ok) throw new Error((await response.json()).detail || "属性值搜索失败"); const values = await response.json(); if (!requests.isCurrent(token, control.value.trim()) || $("#shop-filter").value !== shopId || !list) return; list.innerHTML = values.map(window.ListingAttributes.dictionaryOptionHtml).join(""); } catch (error) { if (requests.isCurrent(token, control.value.trim()) && list) { list.innerHTML = ""; toast(error.message || "Ozon 属性值搜索失败", true); } } }, 300); }); }); }
async function loadCategoryAttributes() { const shopId = $("#shop-filter").value; const value = $("#listing-category").value; const context = `${shopId}:${value}`; const token = listingAttributeRequests.begin(context); const container = $("#listing-required-attributes"); if (!value) { container.innerHTML = '<span class="listing-attribute-title">选择类目后填写 Ozon 必填属性</span>'; return; } const [categoryId, typeId] = value.split(":"); container.innerHTML = '<span class="listing-attribute-title">正在加载 Ozon 必填属性…</span>'; try { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/metadata/categories/${categoryId}/types/${typeId}/attributes`); if (!response.ok) throw new Error((await response.json()).detail || "属性加载失败"); const attributes = (await response.json()).filter(item => item.required); if (!listingAttributeRequests.isCurrent(token, `${$("#shop-filter").value}:${$("#listing-category").value}`)) return; const fields = attributes.map(attribute => window.ListingAttributes.attributeFieldHtml(attribute, [])); container.innerHTML = `<span class="listing-attribute-title">Ozon 必填属性（${attributes.length}）</span>${fields.join("") || '<span class="muted">该商品类型没有必填属性</span>'}`; installDictionarySearch(categoryId, typeId, shopId); $("#listing-category").setCustomValidity(""); } catch (error) { if (listingAttributeRequests.isCurrent(token, `${$("#shop-filter").value}:${$("#listing-category").value}`)) { container.innerHTML = `<span class="listing-attribute-title">${escapeHtml(error.message || "属性加载失败，当前草稿不能保存")}</span>`; $("#listing-category").setCustomValidity("Ozon 必填属性加载失败"); } } }
async function loadViewLocal(view) {
  if (["dashboard", "orders", "products"].includes(view)) return loadOperationalData();
  if (view === "pricing") return loadPricingPolicy();
  if (view === "yunniudun") return loadYunNewtonSettings();
  if (view === "sync") return loadSyncRuns();
  if (view === "listing") return loadListingDrafts();
  if (view === "collection-box") return loadCollectionBox();
  if (view === "candidate-pool") return loadCandidatePool();
  if (view === "jxhy") return loadJxhyView();
  if (view === "authorization-center") return loadAuthorizationCenter();
  if (view === "bulk-listing") return loadBulkListingBatches();
  if (view === "approval-center") return loadApprovalCenter();
  if (view === "automation") return loadAutomationCenter();
  if (view === "operation-logs") return loadOperationLogs();
}

const jxhyState = { page: 1, pageSize: 20, total: 0, rawTotal: 0, items: [], selected: new Set(), inspected: new Map(), collected: new Set(), loading: false, filtersLoaded: false };

function jxhySafeImage(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function jxhySelectedFilters() {
  return [...document.querySelectorAll('#jxhy-official-filters input[name="jxhy-filter"]:checked')].map(input => input.value).filter(Boolean);
}

function jxhyApplyLocalHardFilters(items) {
  const start = Number($("#jxhy-price-start")?.value || "");
  const end = Number($("#jxhy-price-end")?.value || "");
  return (Array.isArray(items) ? items : []).filter(item => {
    const price = Number(item.price_min);
    if (Number.isFinite(start) && start > 0 && (!Number.isFinite(price) || price < start)) return false;
    if (Number.isFinite(end) && end > 0 && (!Number.isFinite(price) || price > end)) return false;
    return true;
  });
}

function jxhyRenderPagination() {
  const container = $("#jxhy-pagination");
  if (!container) return;
  const pages = Math.max(1, Math.ceil(jxhyState.total / jxhyState.pageSize));
  container.innerHTML = jxhyState.total ? `<button type="button" class="secondary" data-jxhy-page="prev" ${jxhyState.page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${jxhyState.page} / ${pages} 页 · 共 ${jxhyState.total} 个候选</span><button type="button" class="secondary" data-jxhy-page="next" ${jxhyState.page >= pages ? "disabled" : ""}>下一页</button>` : "";
}

function jxhyRenderRows() {
  const rows = $("#jxhy-rows");
  if (!rows) return;
  if (!jxhyState.items.length) {
    rows.innerHTML = '<div class="jxhy-empty"><strong>没有符合条件的商品</strong><span>调整关键词或筛选条件后重新搜索。</span></div>';
    jxhyRenderPagination();
    return;
  }
  rows.innerHTML = jxhyState.items.map(item => {
    const id = String(item.offer_id || "");
    const image = jxhySafeImage(item.image_url);
    const inspected = jxhyState.inspected.get(id);
    const collected = jxhyState.collected.has(id);
    const packageText = inspected ? (inspected.has_complete_package ? "尺重完整" : "缺少完整尺重") : "尚未核验尺重";
    const packageClass = inspected ? (inspected.has_complete_package ? "jxhy-package-ok" : "jxhy-package-warn") : "";
    return `<article class="jxhy-product-card ${collected ? "jxhy-collected" : ""}">
      <div class="jxhy-product-media">${image ? `<img class="jxhy-product-image" src="${escapeHtml(image)}" alt="${escapeHtml(item.title || "商品图片")}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="jxhy-product-media jxhy-no-image">无主图</div>'}
        <label class="jxhy-card-select" title="选择此商品"><input type="checkbox" class="jxhy-check" data-offer-id="${escapeHtml(id)}" ${jxhyState.selected.has(id) ? "checked" : ""}><span aria-hidden="true"></span></label>
        <span class="jxhy-source-tag">严选 API</span>
      </div>
      <div class="jxhy-product-body"><h3>${escapeHtml(item.title || "未命名商品")}</h3>
        <div class="jxhy-price-row"><span class="jxhy-price">¥${Number(item.price_min || 0).toFixed(2)}</span><span class="jxhy-price-range">${item.price_max && Number(item.price_max) !== Number(item.price_min) ? `- ¥${Number(item.price_max).toFixed(2)}` : ""}</span><span class="jxhy-sku-count">${Number(item.sku_count || 0)} SKU</span></div>
        <div class="jxhy-product-meta"><span>90天销量 ${Number(item.sales_90d || 0)}</span><span title="${escapeHtml(item.supplier || "")}">${escapeHtml(item.supplier || "供应商未提供")}</span></div>
        <div class="jxhy-card-footer"><span class="${packageClass}">${packageText}</span><a class="jxhy-detail-link" href="${escapeHtml(item.url || `https://detail.1688.com/offer/${id}.html`)}" target="_blank" rel="noreferrer">查看货源</a></div>
        <div class="jxhy-offer-id">Offer ID：${escapeHtml(id)}${collected ? " · 已入库" : ""}</div>
      </div>
    </article>`;
  }).join("");
  const selectAll = $("#jxhy-select-all");
  if (selectAll) selectAll.checked = jxhyState.items.length > 0 && jxhyState.items.every(item => jxhyState.selected.has(String(item.offer_id)));
  jxhyRenderPagination();
}

async function loadJxhyFilters() {
  if (jxhyState.filtersLoaded) return;
  const container = $("#jxhy-official-filters");
  if (!container) return;
  try {
    const response = await fetch(`${apiBase}/api/v1/open1688/jxhy/product-filters`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "严选筛选条件加载失败");
    const items = Array.isArray(data.items) ? data.items : [];
    const normalized = items.map((item, index) => {
      if (typeof item === "string" || typeof item === "number") return { value: String(item), label: String(item) };
      const value = String(item.id ?? item.value ?? item.code ?? item.ruleId ?? index);
      const label = String(item.name ?? item.title ?? item.label ?? item.text ?? value);
      return { value, label };
    });
    container.innerHTML = normalized.length ? normalized.map(item => `<label><input type="checkbox" name="jxhy-filter" value="${escapeHtml(item.value)}"> ${escapeHtml(item.label)}</label>`).join("") : '<span class="muted">当前账号没有返回官方筛选标签</span>';
    jxhyState.filtersLoaded = true;
  } catch (error) {
    container.innerHTML = `<span class="muted">${escapeHtml(error.message || "筛选条件加载失败")}</span>`;
  }
}

async function loadJxhyView() {
  const status = $("#jxhy-status");
  if (!status) return;
  try {
    const response = await fetch(`${apiBase}/api/v1/open1688/status`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "1688 授权状态读取失败");
    status.textContent = data.configured ? "● 严选 API 已连接" : "● 尚未配置严选 API 授权";
    status.dataset.configured = data.configured ? "true" : "false";
  } catch (error) {
    status.textContent = "● 严选 API 不可用";
    status.dataset.configured = "false";
  }
  await loadIntelligentTitleStatus();
  jxhyRenderRows();
}

async function loadIntelligentTitleStatus() {
  const status = $("#intelligent-title-status");
  if (!status) return;
  try {
    const response = await fetch(`${apiBase}/api/v1/image-product-intelligent/status`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "智能标题配置读取失败");
    status.textContent = data.configured ? "● 已配置，可在编辑器调用" : `● ${data.message || "尚未配置"}`;
    status.className = data.configured ? "live success" : "live";
  } catch (error) {
    status.textContent = "● 智能标题接口不可用";
    status.className = "live error";
  }
}

async function loadAuthorizationCenter() {
  const open1688Status = $("#auth-open1688-status");
  const yunNewtonStatus = $("#auth-yunniudun-status");
  if (!open1688Status && !yunNewtonStatus) return;
  const readStatus = async (path, target, successText, missingText) => {
    if (!target) return;
    try {
      const response = await fetch(`${apiBase}${path}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "状态读取失败");
      target.textContent = data.configured ? successText : missingText;
      target.className = data.configured ? "live success" : "live";
    } catch (_) {
      target.textContent = "● 接口不可用";
      target.className = "live error";
    }
  };
  await Promise.all([
    readStatus("/api/v1/open1688/status", open1688Status, "● 已配置", "● 尚未配置"),
    readStatus("/api/v1/yunniudun/status", yunNewtonStatus, "● 已配置", "● 尚未配置"),
    loadIntelligentTitleStatus(),
  ]);
}

async function saveIntelligentTitleCredentials(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const appKey = String($("#intelligent-title-app-key")?.value || "").trim();
  const appSecret = String($("#intelligent-title-app-secret")?.value || "").trim();
  const accessToken = String($("#intelligent-title-access-token")?.value || "").trim();
  if (!appKey || !appSecret || !accessToken) { toast("请填写 AppKey、AppSecret 和 AccessToken。", true); return; }
  const button = form.querySelector('button[type="submit"]');
  try {
    if (button) { button.disabled = true; button.textContent = "保存中…"; }
    const appResponse = await fetch(`${apiBase}/api/v1/image-product-intelligent/application`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_key: appKey, app_secret: appSecret }) });
    const appData = await appResponse.json();
    if (!appResponse.ok) throw new Error(appData.detail || "AppKey 配置保存失败");
    const tokenResponse = await fetch(`${apiBase}/api/v1/image-product-intelligent/access-token`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: accessToken }) });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenData.detail || "AccessToken 保存失败");
    $("#intelligent-title-app-secret").value = "";
    $("#intelligent-title-access-token").value = "";
    await loadIntelligentTitleStatus();
    toast("商品智能标题凭据已加密保存。", false);
  } catch (error) {
    $("#intelligent-title-access-token").value = "";
    toast(error.message || "商品智能标题凭据保存失败", true);
  } finally {
    if (button) { button.disabled = false; button.textContent = "安全保存凭据"; }
  }
}

async function openIntelligentTitleAuthorization() {
  try {
    const response = await fetch(`${apiBase}/api/v1/image-product-intelligent/authorize`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "授权链接生成失败");
    if (data.authorization_url) window.open(data.authorization_url, "_blank", "noopener,noreferrer");
    toast("已打开商品智能标题 author 授权页；授权后把回调地址粘贴到下方。", false);
  } catch (error) { toast(error.message || "授权链接生成失败", true); }
}

async function exchangeIntelligentTitleToken() {
  const value = String($("#intelligent-title-code")?.value || "").trim();
  if (!value) { toast("请先粘贴授权回调地址或 code。", true); return; }
  const button = $("#intelligent-title-exchange");
  try {
    if (button) { button.disabled = true; button.textContent = "换取中…"; }
    const response = await fetch(`${apiBase}/api/v1/image-product-intelligent/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code_or_url: value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "AccessToken 换取失败");
    $("#intelligent-title-code").value = "";
    await loadIntelligentTitleStatus();
    toast("商品智能标题 AccessToken 已加密保存。", false);
  } catch (error) { toast(error.message || "AccessToken 换取失败", true); }
  finally { if (button) { button.disabled = false; button.textContent = "换取并保存 AccessToken"; } }
}

async function searchJxhyProducts(event) {
  event?.preventDefault();
  const keyword = String($("#jxhy-keyword")?.value || "").trim();
  const categoryId = String($("#jxhy-category-id")?.value || "").trim();
  const priceStart = String($("#jxhy-price-start")?.value || "").trim();
  const priceEnd = String($("#jxhy-price-end")?.value || "").trim();
  const ruleIds = String($("#jxhy-rule-ids")?.value || "").split(",").map(value => value.trim()).filter(Boolean);
  const filters = jxhySelectedFilters();
  if (!keyword && !categoryId && !ruleIds.length && !filters.length) { toast("请输入关键词或至少选择一个筛选条件。", true); return; }
  const rows = $("#jxhy-rows");
  if (rows) rows.innerHTML = '<div class="jxhy-loading"><strong>正在筛选严选商品…</strong><span>只读取候选摘要，不会创建草稿。</span></div>';
  const params = new URLSearchParams({ keyword, page_num: String(jxhyState.page), page_size: String(jxhyState.pageSize) });
  if (categoryId) params.set("category_id", categoryId);
  if (priceStart) params.set("price_start", priceStart);
  if (priceEnd) params.set("price_end", priceEnd);
  ruleIds.forEach(value => params.append("rule_ids", value));
  filters.forEach(value => params.append("filters", value));
  try {
    const response = await fetch(`${apiBase}/api/v1/open1688/jxhy/products?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "严选商品搜索失败");
    jxhyState.rawTotal = Number(data.total || 0);
    jxhyState.items = jxhyApplyLocalHardFilters(data.items);
    jxhyState.total = jxhyState.rawTotal || jxhyState.items.length;
    jxhyState.selected.clear();
    $("#jxhy-result-count").textContent = jxhyState.items.length === jxhyState.rawTotal ? `找到 ${jxhyState.total} 个候选` : `当前页 ${jxhyState.items.length} 个可选 · 接口共返回 ${jxhyState.rawTotal} 个`;
    $("#jxhy-batch-status").textContent = jxhyState.items.length === (Array.isArray(data.items) ? data.items.length : 0) ? "搜索结果只代表候选摘要；选中后先核验尺重，再入库。" : "已按价格区间再次过滤本页结果；选中后先核验尺重，再入库。";
    jxhyRenderRows();
  } catch (error) {
    jxhyState.items = []; jxhyState.total = 0; jxhyState.rawTotal = 0; jxhyRenderRows();
    $("#jxhy-result-count").textContent = "搜索失败";
    $("#jxhy-batch-status").textContent = error.message || "严选商品搜索失败";
  }
}

async function inspectJxhySelected() {
  const offerIds = [...jxhyState.selected];
  if (!offerIds.length) { toast("请先勾选商品。", true); return; }
  const button = $("#jxhy-inspect");
  if (button) { button.disabled = true; button.textContent = "核验中…"; }
  try {
    const response = await fetch(`${apiBase}/api/v1/open1688/jxhy/inspect-package`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offer_ids: offerIds }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "尺重核验失败");
    (data.items || []).forEach(item => jxhyState.inspected.set(String(item.offer_id), item));
    jxhyRenderRows();
    const complete = (data.items || []).filter(item => item.has_complete_package).length;
    toast(`已核验 ${data.returned || 0} 个商品，${complete} 个尺重完整。`, complete ? false : true);
  } catch (error) { toast(error.message || "尺重核验失败", true); }
  finally { if (button) { button.disabled = false; button.textContent = "仅核验所选"; } }
}

async function collectJxhySelected() {
  const offerIds = [...jxhyState.selected];
  const shopId = Number($("#shop-filter")?.value || 0);
  const allowIncomplete = Boolean($("#jxhy-allow-incomplete")?.checked);
  if (!offerIds.length) { toast("请先勾选商品。", true); return; }
  if (!shopId) { toast("请先在顶部选择目标 Ozon 店铺；这里只写入采集箱，不会提交 Ozon。", true); return; }
  const button = $("#jxhy-collect");
  if (button) { button.disabled = true; button.textContent = "入库中…"; }
  try {
    const response = await fetch(`${apiBase}/api/v1/open1688/jxhy/collect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offer_ids: offerIds, shop_id: shopId, require_complete_package: !allowIncomplete }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "商品入库失败");
    (data.collected || []).forEach(item => jxhyState.collected.add(String(item.offer_id)));
    jxhyRenderRows();
    const skipped = data.skipped?.length || 0, failed = data.failed?.length || 0;
    const pendingPackage = (data.collected || []).filter(item => !item.has_complete_package).length;
    toast(`已入库 ${data.collected?.length || 0} 个${pendingPackage ? `，其中 ${pendingPackage} 个待补尺重` : ""}；${skipped ? `仍跳过尺重不完整 ${skipped} 个；` : ""}${failed ? `失败 ${failed} 个。` : ""} 去“采集箱”点“编辑”继续处理。`, skipped + failed > 0);
  } catch (error) { toast(error.message || "商品入库失败", true); }
  finally { if (button) { button.disabled = false; button.textContent = "采集所选"; } }
}

function bindJxhyControls() {
  if (window._jxhyControlsBound) return;
  window._jxhyControlsBound = true;
  $("#jxhy-search-form")?.addEventListener("submit", searchJxhyProducts);
  $("#jxhy-page-size")?.addEventListener("change", event => { jxhyState.pageSize = Number(event.target.value || 20); jxhyState.page = 1; searchJxhyProducts(); });
  $("#jxhy-filter-picker")?.addEventListener("toggle", event => { if (event.target.open) loadJxhyFilters(); });
  $("#jxhy-select-all")?.addEventListener("change", event => { jxhyState.items.forEach(item => event.target.checked ? jxhyState.selected.add(String(item.offer_id)) : jxhyState.selected.delete(String(item.offer_id))); jxhyRenderRows(); });
  $("#jxhy-rows")?.addEventListener("change", event => { const input = event.target.closest(".jxhy-check"); if (!input) return; input.checked ? jxhyState.selected.add(input.dataset.offerId) : jxhyState.selected.delete(input.dataset.offerId); jxhyRenderRows(); });
  $("#jxhy-inspect")?.addEventListener("click", inspectJxhySelected);
  $("#jxhy-collect")?.addEventListener("click", collectJxhySelected);
  $("#jxhy-pagination")?.addEventListener("click", event => { const action = event.target.closest("[data-jxhy-page]")?.dataset.jxhyPage; if (!action) return; const pages = Math.max(1, Math.ceil(jxhyState.total / jxhyState.pageSize)); if (action === "prev" && jxhyState.page > 1) jxhyState.page -= 1; if (action === "next" && jxhyState.page < pages) jxhyState.page += 1; searchJxhyProducts(); });
  document.querySelectorAll(".jxhy-category").forEach(button => button.addEventListener("click", () => { $("#jxhy-keyword").value = button.dataset.jxhyKeyword || ""; jxhyState.page = 1; searchJxhyProducts(); }));
  $("#jxhy-configure")?.addEventListener("click", () => $("#open1688-dialog")?.showModal());
}

async function saveOpen1688Application(event) {
  event.preventDefault();
  const payload = {
    app_key: String($("#open1688-app-key")?.value || "").trim(),
    app_secret: String($("#open1688-app-secret")?.value || "").trim(),
    redirect_uri: String($("#open1688-redirect-uri")?.value || "").trim(),
  };
  const button = event.currentTarget.querySelector('button[type="submit"]');
  try {
    if (button) { button.disabled = true; button.textContent = "保存中…"; }
    const response = await fetch(`${apiBase}/api/v1/open1688/application`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "1688 授权配置失败");
    toast("配置已保存，正在打开 1688 授权页。");
    if (data.authorization_url) window.open(data.authorization_url, "_blank", "noopener,noreferrer");
  } catch (error) { toast(error.message || "1688 授权配置失败", true); }
  finally { if (button) { button.disabled = false; button.textContent = "保存并打开授权页"; } }
}

async function exchangeOpen1688Token() {
  const value = String($("#open1688-code")?.value || "").trim();
  if (!value) { toast("请粘贴授权后返回的完整地址或 code。", true); return; }
  const button = $("#open1688-exchange");
  try {
    if (button) { button.disabled = true; button.textContent = "换取中…"; }
    const response = await fetch(`${apiBase}/api/v1/open1688/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code_or_url: value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "AccessToken 换取失败");
    $("#open1688-code").value = "";
    $("#open1688-dialog")?.close();
    toast("1688 AccessToken 已加密保存。");
    await loadJxhyView();
  } catch (error) { toast(error.message || "AccessToken 换取失败", true); }
  finally { if (button) { button.disabled = false; button.textContent = "换取 AccessToken"; } }
}

const autoSyncController = window.AutoSyncPolicy.createAutoSyncController({ post: async (shopId, view) => { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/auto-sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view }) }); if (!response.ok) throw new Error((await response.json()).detail || "自动校正启动失败"); return response.json(); }, onStatus: decisions => { if (decisions.some(item => item.status === "started")) $("#data-status").textContent = "● 已显示本地数据，后台正在增量校正"; } });
function activateCurrentView() { return autoSyncController.activate({ shopId: $("#shop-filter").value, view: activeView, loadLocal: () => loadViewLocal(activeView) }).catch(error => toast(error.message || "自动校正失败，本地数据仍可使用。", true)); }
async function loadCollectionBox() {
  if (!window._cbTopBound) {
    window._cbTopBound = true;
    const selectAll = $("#cb-select-all");
    if (selectAll) selectAll.addEventListener("change", () => {
      document.querySelectorAll(".cb-select").forEach(box => { box.checked = selectAll.checked; });
      updateCollectionSelection();
    });
    const refreshSelected = $("#cb-refresh-selected");
    if (refreshSelected) refreshSelected.addEventListener("click", async () => {
      const boxes = Array.from(document.querySelectorAll(".cb-select:checked"));
      if (!boxes.length) return;
      const items = boxes.map(b => ({ source_product_id: Number(b.dataset.sp) }));
      refreshSelected.disabled = true; refreshSelected.textContent = "刷新中...";
      try {
        const r = await fetch(`${apiBase}/api/v1/collection-box/refresh-selected`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "刷新失败");
        toast(`已刷新 ${data.refreshed} 条${data.errors?.length ? `，失败 ${data.errors.length} 条` : ""}。`, !data.refreshed);
        await loadCollectionBox();
      } catch (e) { toast(e.message || "刷新失败", true); }
      finally { refreshSelected.disabled = false; refreshSelected.textContent = "刷新所选结果"; updateCollectionSelection(); }
    });
    const refreshAll = $("#cb-refresh-all");
    if (refreshAll) refreshAll.addEventListener("click", async () => {
      if (!confirm("确认刷新当前列表中所有已提交商品的 Ozon 反馈？将跨店铺刷新，可能较慢。")) return;
      refreshAll.disabled = true; refreshAll.textContent = "刷新中...";
      try {
        const allItems = [];
        let listPage = 1;
        let listPages = 1;
        do {
          const params = new URLSearchParams({ paged: "true", page: String(listPage), page_size: "200" });
          const shopId = $("#cb-ozon-shop-filter")?.value || "";
          const sourceShop = $("#cb-source-shop-filter")?.value || "";
          if (shopId) params.set("shop_id", shopId);
          if (sourceShop) params.set("source_shop", sourceShop);
          const listR = await fetch(`${apiBase}/api/v1/collection-box?${params}`);
          if (!listR.ok) throw new Error("读取采集箱失败");
          const pageData = await listR.json();
          allItems.push(...(pageData.items || []));
          listPages = Number(pageData.pages || 1);
          listPage += 1;
        } while (listPage <= listPages);
        const spIds = [...new Set(allItems.filter(it => it.draft_id && it.offer_id).map(it => it.source_product_id))];
        const items = spIds.map(id => ({ source_product_id: id }));
        if (!items.length) { toast("没有可刷新的已提交商品。", true); return; }
        const r = await fetch(`${apiBase}/api/v1/collection-box/refresh-selected`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "刷新失败");
        toast(`已刷新 ${data.refreshed} 条${data.errors?.length ? `，失败 ${data.errors.length} 条` : ""}。`, !data.refreshed);
        await loadCollectionBox();
      } catch (e) { toast(e.message || "刷新失败", true); }
      finally { refreshAll.disabled = false; refreshAll.textContent = "刷新全部结果"; }
    });
    const deleteSelected = $("#cb-delete-selected");
    if (deleteSelected) deleteSelected.addEventListener("click", async () => {
      const boxes = Array.from(document.querySelectorAll(".cb-select:checked"));
      if (!boxes.length) return;
      if (!confirm(`确认删除所选 ${boxes.length} 条采集商品？将删除全部店铺的草稿和关联记录，不可恢复。`)) return;
      const items = boxes.map(b => ({ source_product_id: Number(b.dataset.sp) }));
      deleteSelected.disabled = true; deleteSelected.textContent = "删除中...";
      try {
        const r = await fetch(`${apiBase}/api/v1/collection-box/delete-selected`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "删除失败");
        toast(`已删除 ${data.removed_products} 个商品，共 ${data.removed_drafts} 份草稿。`, false);
        await loadCollectionBox();
      } catch (e) { toast(e.message || "删除失败", true); }
      finally { deleteSelected.disabled = false; deleteSelected.textContent = "删除所选"; updateCollectionSelection(); }
    });
    const reloadCollectionFromFirstPage = () => { collectionState.page = 1; loadCollectionBox(); };
    $("#cb-source-shop-filter")?.addEventListener("change", reloadCollectionFromFirstPage);
    $("#cb-ozon-shop-filter")?.addEventListener("change", reloadCollectionFromFirstPage);
    $("#cb-page-size")?.addEventListener("change", event => { collectionState.pageSize = Number(event.target.value || 100); reloadCollectionFromFirstPage(); });
    $("#cb-prev")?.addEventListener("click", () => { if (collectionState.page > 1) { collectionState.page -= 1; loadCollectionBox(); } });
    $("#cb-next")?.addEventListener("click", () => { if (collectionState.page < collectionState.pages) { collectionState.page += 1; loadCollectionBox(); } });
  }
  try {
    const params = new URLSearchParams({ paged: "true", page: String(collectionState.page), page_size: String(collectionState.pageSize) });
    const shopId = $("#cb-ozon-shop-filter")?.value || "";
    const sourceShop = $("#cb-source-shop-filter")?.value || "";
    if (shopId) params.set("shop_id", shopId);
    if (sourceShop) params.set("source_shop", sourceShop);
    const url = `${apiBase}/api/v1/collection-box?${params}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("加载采集箱失败");
    const data = await response.json();
    collectionState.total = Number(data.total || 0);
    collectionState.pages = Number(data.pages || 1);
    if (collectionState.page > collectionState.pages) { collectionState.page = collectionState.pages; return loadCollectionBox(); }
    const sourceSelect = $("#cb-source-shop-filter");
    if (sourceSelect) {
      const selected = sourceSelect.value;
      sourceSelect.innerHTML = '<option value="">全部来源店铺</option>' + (data.source_shops || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
      sourceSelect.value = selected;
    }
    const ozonSelect = $("#cb-ozon-shop-filter");
    if (ozonSelect) {
      const selected = ozonSelect.value;
      ozonSelect.innerHTML = '<option value="">全部Ozon店铺</option>' + (data.ozon_shops || []).map(shop => `<option value="${shop.id}">${escapeHtml(shop.name || `店铺 #${shop.id}`)}</option>`).join("");
      ozonSelect.value = selected;
    }
    $("#cb-page-label").textContent = `第 ${collectionState.page} / ${collectionState.pages} 页`;
    $("#cb-prev").disabled = collectionState.page <= 1;
    $("#cb-next").disabled = collectionState.page >= collectionState.pages;
    renderCollectionBox(data.items || [], collectionState.total);
  } catch (error) {
    $("#cb-rows").innerHTML = '<tr><td colspan="6" class="muted">加载失败</td></tr>';
    toast(error.message || "加载采集箱失败", true);
  }
}

function renderCollectionBox(items, total = items.length) {
  $("#cb-count").textContent = `共 ${total} 个采集商品，本页 ${items.length} 个`;
  if (!items.length) {
    $("#cb-rows").innerHTML = '<tr><td colspan="10" class="muted">暂无采集商品</td></tr>';
    return;
  }
  const statusColors = { "未编辑": "#999", "保存": "#1976d2", "已提交": "#388e3c", "待修改": "#f57c00" };
  const statusLabels = {
    submitted: "已提交", succeeded: "已生效", confirmed: "已确认", pending: "等待确认", syncing: "同步中",
    waiting_product: "等待商品生成", waiting_price: "等待价格生效", retry: "重试中",
    verifying: "回读确认中", partial: "部分SKU已同步", completed: "库存已生效", import_failed: "导入失败", failed: "失败",
  };
  const duplicateLabel = duplicate => {
    if (!duplicate) return "";
    if (duplicate.current_shop_published) return "本店已发布";
    if (duplicate.other_shop_published) return "其他店铺已发布";
    return duplicate.collected ? "已采集" : "待采集";
  };
  const resultLabel = item => {
    const issues = Array.isArray(item.ozon_issues) ? item.ozon_issues : [];
    const feedback = item.feedback_history?.[0];
    const ratingValue = feedback?.overall_rating ?? item.quality_rating;
    const feedbackCount = Number(item.feedback_count || item.feedback_history?.length || 0);
    const ozonErrors = issues.filter(issue => issue?.type === "ozon_error");
    const qualityIssues = issues.filter(issue => issue?.type !== "ozon_error");
    if (issues.length) {
      const rating = ratingValue == null ? "暂未评分" : `${ratingValue}/100`;
      const history = feedbackCount ? `反馈 ${feedbackCount} 次` : "当前反馈";
      const issueLabel = [
        ozonErrors.length ? `${ozonErrors.length} 项 Ozon 错误` : "",
        qualityIssues.length ? `${qualityIssues.length} 项内容建议` : "",
      ].filter(Boolean).join("，");
      const stock = item.stock_sync_status ? (statusLabels[item.stock_sync_status] || item.stock_sync_status) : "库存待确认";
      const stockMessage = item.stock_sync_message ? ` · ${item.stock_sync_message}` : "";
      return `<span class="status off">${escapeHtml(issueLabel)}</span><br><small>${escapeHtml(rating)} · ${escapeHtml(history)} · ${escapeHtml(stock)}${stockMessage ? `<span title="${escapeHtml(item.stock_sync_message)}">${escapeHtml(stockMessage)}</span>` : ""}</small>`;
    }
    if (feedback || item.draft_status === "已提交") {
      const rating = ratingValue == null ? "暂未评分" : `${ratingValue}/100`;
      const stock = item.stock_sync_status ? (statusLabels[item.stock_sync_status] || item.stock_sync_status) : "库存待确认";
      const history = feedbackCount ? `反馈 ${feedbackCount} 次` : "暂无历史反馈";
      return `<span class="status ready">${escapeHtml(rating)}</span><br><small>${escapeHtml(history)} · ${escapeHtml(stock)}</small>`;
    }
    if (item.stock_sync_message) return `<small>${escapeHtml(item.stock_sync_message)}</small>`;
    return '<span class="muted">—</span>';
  };
  $("#cb-rows").innerHTML = items.map(item => {
    const img = item.main_image_url ? `<img src="${escapeHtml(item.main_image_url)}" class="cb-thumb" data-src="${escapeHtml(item.main_image_url)}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:8px;cursor:zoom-in" referrerpolicy="no-referrer" />` : "";
    const videoLink = Array.isArray(item.video_urls) && item.video_urls[0]
      ? ` <a href="${escapeHtml(item.video_urls[0])}" target="_blank" rel="noopener noreferrer" title="打开采集视频链接" style="white-space:nowrap">视频${item.video_urls.length > 1 ? ` (${item.video_urls.length})` : ""}</a>`
      : "";
    const statusColor = statusColors[item.draft_status] || "#999";
    const code = item.offer_id || `KC${String(item.source_product_id || "").padStart(6, "0")}`;
    const duplicate = duplicateLabel(item.source_duplicate_status);
    let actions = "";
    if (item.draft_status === "未编辑") {
      actions = `<button class="link cb-edit" data-sp="${item.source_product_id}" data-shop="${item.shop_id}">编辑</button>`;
    } else if (item.draft_status === "保存") {
      actions = `<button class="link cb-edit" data-sp="${item.source_product_id}" data-draft="${item.draft_id}" data-shop="${item.shop_id}">编辑</button> <button class="link cb-submit" data-draft="${item.draft_id}" data-shop="${item.shop_id}">提交</button>`;
    } else if (item.draft_status === "已提交") {
      actions = `<button class="link cb-edit" data-sp="${item.source_product_id}" data-draft="${item.draft_id}" data-shop="${item.shop_id}">查看</button>`;
    } else if (item.draft_status === "待修改") {
      actions = `<button class="link cb-edit" data-sp="${item.source_product_id}" data-draft="${item.draft_id}" data-shop="${item.shop_id}">编辑</button>`;
    }
    const date = item.collected_at ? new Date(item.collected_at).toLocaleDateString("zh-CN") : "-";
    return `<tr>
      <td><input type="checkbox" class="cb-select" data-sp="${item.source_product_id}" data-shop="${item.shop_id}" aria-label="选择 ${escapeHtml(code)}"></td>
      <td><b>${escapeHtml(code)}</b><br><small>货源 ${escapeHtml(item.source_offer_id || "—")}</small></td>
      <td><div class="line-product">${img}<span>${escapeHtml(item.title || "未命名商品")}</span>${videoLink}</div></td>
      <td>${escapeHtml(item.source_platform || "—")}<br><small>${escapeHtml(item.source_shop_name || "来源店铺未知")}</small></td>
      <td>${escapeHtml(item.shop_name || "—")}</td>
      <td>${date}</td>
      <td><span style="color:${statusColor};font-weight:600">${escapeHtml(item.draft_status || "—")}</span></td>
      <td><span class="cb-review-chip ${duplicate === "本店已发布" ? "ok" : duplicate === "其他店铺已发布" ? "warn" : ""}">${escapeHtml(duplicate || "—")}</span></td>
      <td>${resultLabel(item)}</td>
      <td>${actions}</td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".cb-edit").forEach(btn => btn.addEventListener("click", () => {
    const sp = btn.dataset.sp; const draft = btn.dataset.draft; const shop = btn.dataset.shop;
    let url = `./listing-editor.html?shop=${shop}&sp=${sp}&returnTo=collection-box`; if (draft) url += `&draft=${draft}`;
    window.location.href = url;
  }));
  document.querySelectorAll(".cb-submit").forEach(btn => btn.addEventListener("click", async () => {
    const draft = btn.dataset.draft; const shop = btn.dataset.shop;
    if (!confirm("确认提交到 Ozon？")) return;
    try {
      const r = await fetch(`${apiBase}/api/v1/shops/${shop}/listing-drafts/${draft}/submit`, { method: "POST" });
      const data = await r.json(); if (!r.ok) throw new Error(data.detail || "提交失败");
      toast(data.message || "提交成功", false); loadCollectionBox();
    } catch (e) { toast(e.message || "提交失败", true); }
  }));
  document.querySelectorAll(".cb-select").forEach(box => box.addEventListener("change", () => {
    updateCollectionSelection();
    const selectAll = $("#cb-select-all");
    if (!selectAll) return;
    const total = document.querySelectorAll(".cb-select").length;
    const checked = document.querySelectorAll(".cb-select:checked").length;
    selectAll.checked = total > 0 && checked === total;
    selectAll.indeterminate = checked > 0 && checked < total;
  }));
  updateCollectionSelection();
  const selectAll = $("#cb-select-all");
  if (selectAll) {
    const total = document.querySelectorAll(".cb-select").length;
    const checked = document.querySelectorAll(".cb-select:checked").length;
    selectAll.checked = total > 0 && checked === total;
    selectAll.indeterminate = checked > 0 && checked < total;
  }
}

function updateCollectionSelection() {
  const selected = document.querySelectorAll(".cb-select:checked");
  const refresh = $("#cb-refresh-selected");
  const remove = $("#cb-delete-selected");
  if (refresh) refresh.disabled = selected.length === 0;
  if (remove) remove.disabled = selected.length === 0;
}

window.loadCollectionBox = loadCollectionBox;

function setView(view) {
  if (!view) view = "dashboard";
  if (!document.querySelector(`.view#${CSS.escape(view)}`)) view = "dashboard";
  activeView = view;
  document.querySelectorAll(".view").forEach(item => item.classList.toggle("active", item.id === view));
  document.querySelectorAll("#nav button").forEach(item => item.classList.toggle("active", item.dataset.view === view));
  const navItem = document.querySelector(`#nav button[data-view="${view}"]`);
  if (navItem) $("#crumb").textContent = navItem.textContent.trim();
  $("#primary-action").style.display = view === "shops" || view === "dashboard" ? "inline-flex" : "none";
  activateCurrentView();
}

// Pricing is a single ERP-wide persisted rule set.  The form always reads the
// backend record on entering this view; URL query values and HTML defaults must
// never masquerade as the active pricing policy.
const pricingFormFieldMap = {
  purchase_buffer_cny: "purchase_buffer_cny",
  commission_percent: "commission_rate",
  misc_percent: "misc_fee_rate",
  fixed_misc_fee: "fixed_misc_fee",
  target_profit_percent: "target_profit_rate",
  listing_price_floor_cny: "listing_price_floor_cny",
  old_price_multiplier: "old_price_multiplier",
  minimum_profit_percent: "minimum_profit_rate",
  minimum_profit_cny: "minimum_profit_cny",
  logistics_warn_percent: "logistics_ratio_warn",
  max_iterations: "max_iterations",
};

function pricingNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits).replace(/\.00$/, "") : "";
}

function pricingPolicyPayload(form) {
  const data = Object.fromEntries(new FormData(form));
  return {
    purchase_buffer_cny: Number(data.purchase_buffer_cny),
    commission_rate: Number(data.commission_percent) / 100,
    misc_fee_rate: Number(data.misc_percent) / 100,
    fixed_misc_fee: Number(data.fixed_misc_fee),
    target_profit_rate: Number(data.target_profit_percent) / 100,
    listing_price_floor_cny: Number(data.listing_price_floor_cny),
    old_price_multiplier: Number(data.old_price_multiplier),
    minimum_profit_rate: Number(data.minimum_profit_percent) / 100,
    minimum_profit_cny: Number(data.minimum_profit_cny),
    logistics_ratio_warn: Number(data.logistics_warn_percent) / 100,
    max_iterations: Number(data.max_iterations),
  };
}

function fillPricingPolicy(policy) {
  const form = $("#pricing-policy-form");
  if (!form || !policy) return;
  const percentageFields = new Set(["commission_percent", "misc_percent", "target_profit_percent", "minimum_profit_percent", "logistics_warn_percent"]);
  Object.entries(pricingFormFieldMap).forEach(([formName, policyName]) => {
    const control = form.elements.namedItem(formName);
    if (!control || policy[policyName] == null) return;
    const value = percentageFields.has(formName) ? Number(policy[policyName]) * 100 : policy[policyName];
    control.value = formName === "max_iterations" ? String(value) : pricingNumber(value);
  });
  const meta = $("#pricing-policy-meta");
  if (meta) meta.textContent = `当前全局规则 · 版本 ${policy.formula_version || "—"} · 最近保存：${policy.updated_at ? new Date(policy.updated_at).toLocaleString("zh-CN") : "—"}`;
}

async function loadPricingPolicy() {
  const form = $("#pricing-policy-form");
  if (!form) return;
  const meta = $("#pricing-policy-meta");
  if (meta) meta.textContent = "正在读取当前定价规则…";
  try {
    const response = await fetch(`${apiBase}/api/v1/pricing/policy`);
    const policy = await response.json();
    if (!response.ok) throw new Error(policy.detail || "读取定价规则失败");
    fillPricingPolicy(policy);
  } catch (error) {
    if (meta) meta.textContent = "当前规则读取失败，未使用页面默认值。";
    toast(error.message || "读取定价规则失败", true);
  }
}

async function savePricingPolicy(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const payload = pricingPolicyPayload(form);
  const button = form.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = "保存中…"; }
  try {
    const response = await fetch(`${apiBase}/api/v1/pricing/policy`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const policy = await response.json();
    if (!response.ok) throw new Error(policy.detail || "保存定价规则失败");
    fillPricingPolicy(policy);
    toast("自动定价策略已保存；新建草稿和重新报价将使用这套全局规则。");
  } catch (error) { toast(error.message || "保存定价规则失败", true); }
  finally { if (button) { button.disabled = false; button.textContent = "保存自动定价策略"; } }
}

async function runPricingSimulator() {
  const form = $("#pricing-policy-form");
  const result = $("#pricing-test-result");
  if (!form || !result || !form.reportValidity()) return;
  const shopId = Number($("#shop-filter")?.value || shops[0]?.id);
  if (!shopId) { toast("请先接入或选择一个店铺后试算。", true); return; }
  const number = id => Number($(id)?.value);
  const item = { source_sku: "模拟 SKU", source_price_cny: number("#pricing-test-source"), weight_g: number("#pricing-test-weight"), length_mm: number("#pricing-test-length"), width_mm: number("#pricing-test-width"), height_mm: number("#pricing-test-height") };
  if (Object.values(item).some(value => typeof value === "number" && !Number.isFinite(value))) { toast("请填写完整的试算尺重和货源价。", true); return; }
  result.className = "pricing-result muted"; result.textContent = "正在按当前输入参数试算…";
  try {
    const response = await fetch(`${apiBase}/api/v1/pricing/quotes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop_id: shopId, items: [item], policy: pricingPolicyPayload(form) }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "试算失败");
    const quote = body.results?.[0];
    if (!quote) throw new Error("未返回试算结果");
    result.className = "pricing-result";
    result.innerHTML = `<b>建议售价 ¥${escapeHtml(pricingNumber(quote.price_cny))}</b>　原价 ¥${escapeHtml(pricingNumber(quote.old_price_cny))}　最低价 ¥${escapeHtml(String(quote.min_price_cny))}<br><small>采购成本 ¥${escapeHtml(pricingNumber(quote.purchase_cost_cny))} · 物流 ${escapeHtml(quote.shipping_level || "—")} ¥${escapeHtml(pricingNumber(quote.logistics_fee_cny))} · 佣金 ¥${escapeHtml(pricingNumber(quote.commission_cny))} · 杂费 ¥${escapeHtml(pricingNumber(quote.misc_fee_cny))} · 预计利润 ¥${escapeHtml(pricingNumber(quote.profit_cny))}（${escapeHtml(pricingNumber(Number(quote.profit_rate) * 100))}%）</small>`;
  } catch (error) { result.className = "pricing-result muted"; result.textContent = error.message || "试算失败"; toast(error.message || "试算失败", true); }
}
function renderShops() { const query = $("#shop-search").value.trim().toLowerCase(); const displayed = shops.filter(shop => shop.name.toLowerCase().includes(query)); $("#shop-count").textContent = `${displayed.length} 个店铺`; $("#shop-rows").innerHTML = displayed.length ? displayed.map(shop => `<tr><td><b>${shop.name}</b><br><small>${shop.legal_entity || "未设置主体"}</small></td><td><span class="badge">FBS</span></td><td>CNY</td><td>${shop.manager_name || "未分配"}</td><td><span class="status ${shop.is_active ? "ready" : "off"}">${shop.is_active ? "待同步" : "已停用"}</span></td><td><button class="link delete-shop" data-shop-id="${shop.id}" data-shop-name="${shop.name}">删除</button></td></tr>`).join("") : '<tr><td colspan="6" class="muted">没有符合条件的店铺</td></tr>'; document.querySelectorAll(".delete-shop").forEach(button => button.addEventListener("click", () => deleteShop(button.dataset.shopId, button.dataset.shopName))); const filter = $("#shop-filter"); filter.innerHTML = '<option value="">全部店铺</option>' + shops.map(shop => `<option value="${shop.id}">${shop.name}</option>`).join(""); }
async function loadShops() { try { const response = await fetch(`${apiBase}/api/v1/shops`); if (!response.ok) throw new Error(); shops = await response.json(); renderShops(); } catch (_) { $("#shop-rows").innerHTML = '<tr><td colspan="6" class="muted">无法连接后端。请先启动 FastAPI 服务。</td></tr>'; } }
async function loadSyncRuns() { const shopId = $("#shop-filter").value; if (!shopId) { $("#sync-rows").innerHTML = '<tr><td colspan="6" class="muted">请选择一个店铺后查看或执行同步</td></tr>'; return; } try { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/sync-runs`); if (!response.ok) throw new Error(); const runs = await response.json(); const shop = shops.find(item => String(item.id) === shopId); $("#sync-rows").innerHTML = runs.length ? runs.map(run => `<tr><td>${shop?.name || "—"}</td><td>${run.resource === "products" ? "商品" : "FBS 订单"}</td><td><span class="status ${run.status === "succeeded" ? "ready" : "off"}">${run.status === "succeeded" ? "成功" : "失败"}</span></td><td>${run.records_seen} / ${run.records_changed}</td><td>${run.finished_at ? new Date(run.finished_at).toLocaleString("zh-CN") : "进行中"}</td><td>${run.error_summary || "—"}</td></tr>`).join("") : '<tr><td colspan="6" class="muted">尚无同步记录</td></tr>'; } catch (_) { $("#sync-rows").innerHTML = '<tr><td colspan="6" class="muted">无法读取同步记录</td></tr>'; } }
function displayTime(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—"; }
async function loadOperationLogs() {
  const rows = $("#operation-log-rows"); if (!rows) return;
  const shop = $("#operation-log-shop")?.value || "";
  const action = $("#operation-log-action")?.value.trim() || "";
  try {
    if (!shops.length) await loadShops();
    const select = $("#operation-log-shop");
    if (select && select.options.length <= 1) select.insertAdjacentHTML("beforeend", shops.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join(""));
    const params = new URLSearchParams({ limit: "200" }); if (shop) params.set("shop_id", shop); if (action) params.set("action", action);
    const response = await fetch(`${apiBase}/api/v1/operation-logs?${params}`); const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "操作日志读取失败");
    rows.innerHTML = data.items?.length ? data.items.map(item => {
      const detail = typeof item.details === "string" ? item.details : JSON.stringify(item.details || {});
      const shopName = (shops.find(s => Number(s.id) === Number(item.shop_id)) || {}).name || `店铺 ${item.shop_id || "—"}`;
      const objectLabel = `${item.entity_type || "—"} / ${item.entity_id || "—"}`;
      return `<tr><td>${escapeHtml(displayTime(item.created_at))}</td><td>${escapeHtml(item.actor_id || "—")}</td><td>${escapeHtml(shopName)}</td><td><code>${escapeHtml(item.action || "—")}</code></td><td>${escapeHtml(objectLabel)}</td><td title="${escapeHtml(detail)}">${escapeHtml(detail.length > 260 ? detail.slice(0, 260) + "…" : detail)}</td></tr>`;
    }).join("") : '<tr><td colspan="6" class="muted">暂无操作记录</td></tr>';
    $("#operation-log-summary").textContent = `共 ${data.total || 0} 条（显示最近 ${data.items?.length || 0} 条）`;
  } catch (error) { rows.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(error.message || "操作日志读取失败")}</td></tr>`; }
}
function orderRisk(posting) { const closed = ["delivered", "cancelled"].includes(posting.normalized_status); if (closed || !posting.pack_by) return "normal"; const remaining = new Date(posting.pack_by).getTime() - Date.now(); if (remaining < 0) return "overdue"; if (remaining <= 2 * 60 * 60 * 1000) return "urgent"; return "normal"; }
function riskLabel(risk) { return risk === "overdue" ? "已超截单" : risk === "urgent" ? "2 小时内截单" : "正常"; }
function statusLabel(status) { return ({ awaiting_packaging: "待打包", awaiting_deliver: "待交接", delivering: "配送中", delivered: "已送达", cancelled: "已取消" })[status] || status; }
function renderPostingRows() { const selected = allPostings.filter(posting => activeOrderFilter === "all" || (activeOrderFilter === "risk" ? orderRisk(posting) !== "normal" : posting.normalized_status === activeOrderFilter)); $("#posting-rows").innerHTML = selected.length ? selected.map(posting => { const risk = orderRisk(posting); return `<tr><td><b>${escapeHtml(posting.posting_number)}</b></td><td>${escapeHtml(posting.raw_ozon_status || "—")}</td><td><span class="badge">${escapeHtml(statusLabel(posting.normalized_status))}</span></td><td>${displayTime(posting.pack_by)}</td><td><span class="status ${risk === "normal" ? "ready" : "off"}">${riskLabel(risk)}</span></td><td><button class="link view-posting" data-posting-id="${posting.id}">查看明细</button></td></tr>`; }).join("") : '<tr><td colspan="6" class="muted">当前筛选条件下没有订单</td></tr>'; document.querySelectorAll(".view-posting").forEach(button => button.addEventListener("click", () => loadPostingDetail(button.dataset.postingId))); }
async function loadOperationalData() { const shopId = $("#shop-filter").value; if (!shopId) { allPostings = []; $("#posting-rows").innerHTML = '<tr><td colspan="6" class="muted">请选择店铺后查看订单</td></tr>'; $("#product-rows").innerHTML = '<tr><td colspan="4" class="muted">请选择店铺后查看商品</td></tr>'; return; } try { const [productsResponse, postingsResponse] = await Promise.all([fetch(`${apiBase}/api/v1/shops/${shopId}/products`), fetch(`${apiBase}/api/v1/shops/${shopId}/fbs-postings`)]); if (!productsResponse.ok || !postingsResponse.ok) throw new Error(); const [products, postings] = await Promise.all([productsResponse.json(), postingsResponse.json()]); $("#product-rows").innerHTML = products.length ? products.map(product => `<tr><td><b>${escapeHtml(product.name)}</b></td><td>${escapeHtml(product.offer_id || "—")}</td><td>${escapeHtml(product.ozon_product_id)}</td><td>${displayTime(product.updated_at)}</td></tr>`).join("") : '<tr><td colspan="4" class="muted">本次同步未返回商品</td></tr>'; allPostings = postings; renderPostingRows(); const now = Date.now(); const awaiting = postings.filter(item => item.normalized_status === "awaiting_packaging").length; const risk = postings.filter(item => item.pack_by && new Date(item.pack_by).getTime() - now <= 2 * 60 * 60 * 1000 && new Date(item.pack_by).getTime() >= now).length; $("#awaiting-packaging").textContent = awaiting; $("#delivery-risk").textContent = risk; $("#stock-risk").textContent = "—"; $("#promotion-review").textContent = "—"; $("#data-status").textContent = `● 已加载 ${postings.length} 个 FBS 订单`; $("#next-task").textContent = awaiting ? `优先处理 ${awaiting} 个待打包订单` : "当前没有待打包订单"; $("#nav button[data-view=\"orders\"] em").textContent = postings.filter(item => orderRisk(item) !== "normal").length; } catch (_) { $("#data-status").textContent = "● 无法读取运营数据"; } }
async function loadPostingDetail(postingId) { const shopId = $("#shop-filter").value; if (!shopId) return; const drawer = $("#order-drawer"); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); $("#drawer-posting-number").textContent = "加载中…"; $("#drawer-content").textContent = "正在读取订单商品明细…"; try { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/fbs-postings/${postingId}`); if (!response.ok) throw new Error((await response.json()).detail || "读取订单明细失败"); const posting = await response.json(); $("#drawer-posting-number").textContent = posting.posting_number; const lines = posting.lines || []; $("#drawer-content").innerHTML = `<div class="meta"><span>Ozon 状态：${escapeHtml(posting.raw_ozon_status || "—")}</span><span>ERP 状态：${escapeHtml(posting.normalized_status)}</span><span>截单时间：${displayTime(posting.pack_by)}</span></div>${lines.length ? `<table><thead><tr><th>商品</th><th>Offer ID</th><th>数量</th></tr></thead><tbody>${lines.map(line => `<tr><td><div class="line-product">${lineImage(line.image_url, line.name)}<span>${escapeHtml(line.name || "—")}</span></div></td><td>${escapeHtml(line.offer_id)}</td><td>${line.quantity}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">该订单暂无商品明细；请重新同步 FBS 订单。</p>'}`; } catch (error) { $("#drawer-content").textContent = error.message || "读取订单明细失败"; } }
async function loadListingDrafts() { const shopId = $("#shop-filter").value; if (!shopId) { $("#listing-rows").innerHTML = '<tr><td colspan="5" class="muted">请选择店铺后查看上架草稿</td></tr>'; return; } try { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/listing-drafts`); if (!response.ok) throw new Error(); const drafts = await response.json(); $("#listing-rows").innerHTML = drafts.length ? drafts.map(draft => `<tr><td><b>${escapeHtml(draft.title)}</b><br><small>${escapeHtml(draft.category_id || "未选类目")}</small></td><td>${escapeHtml(draft.offer_id)}</td><td>${draft.variants.length}</td><td><span class="status ${draft.status === "ready_for_approval" ? "ready" : "off"}">${draft.status === "ready_for_approval" ? "可进入审批" : draft.status === "validation_failed" ? "预检未通过" : "草稿"}</span></td><td><button class="link validate-listing" data-draft-id="${draft.id}">预检</button></td></tr>`).join("") : '<tr><td colspan="5" class="muted">还没有草稿，先新建一个商品。</td></tr>'; document.querySelectorAll(".validate-listing").forEach(button => button.addEventListener("click", () => validateListing(button.dataset.draftId))); } catch (_) { $("#listing-rows").innerHTML = '<tr><td colspan="5" class="muted">无法读取上架草稿</td></tr>'; } }

const candidateState = { page: 1, pageSize: 30, items: [], selected: new Set(), sampleDraftId: Number(localStorage.getItem("ozon-erp.batch-sample-draft") || 0), sampleLabel: localStorage.getItem("ozon-erp.batch-sample-label") || "" };
const candidateLabels = { ready_for_review: "待人工上架", package_pending: "待人工确认尺重", manual_editing: "人工编辑中", needs_review: "需人工处理", ai_failed: "AI失败", draft_ready: "草稿就绪", approved: "已审批", submitted: "已提交", imported: "已导入", publish_failed: "发布失败" };
function candidateQueryParams() {
  const params = new URLSearchParams({ page: String(candidateState.page), page_size: String(candidateState.pageSize) });
  const status = $("#candidate-status")?.value || "";
  const query = $("#candidate-query")?.value.trim() || "";
  if (status) params.set("status", status);
  if (query) params.set("query", query);
  return params;
}
function renderCandidateStats(counts = {}) {
  const container = $("#candidate-stats");
  if (!container) return;
  container.innerHTML = ["ready_for_review", "package_pending", "manual_editing", "needs_review", "draft_ready"].map(key => `<span class="candidate-stat"><b>${counts[key] || 0}</b><small>${candidateLabels[key]}</small></span>`).join("");
}
function updateCandidateSelection() {
  const count = candidateState.selected.size;
  const label = $("#candidate-selected-count");
  const action = $("#candidate-batch-ai");
  const sampleAction = $("#candidate-set-sample");
  if (label) label.textContent = count ? `已选择 ${count} 个商品` : "未选择商品";
  if (action) action.disabled = count === 0;
  if (sampleAction) sampleAction.disabled = count !== 1;
  const sampleLabel = $("#candidate-sample-label");
  if (sampleLabel) sampleLabel.textContent = candidateState.sampleDraftId ? `当前样板：${candidateState.sampleLabel || `草稿 #${candidateState.sampleDraftId}`}` : "尚未设置样板";
  const selectAll = $("#candidate-select-all");
  if (selectAll) selectAll.checked = candidateState.items.length > 0 && candidateState.items.every(item => candidateState.selected.has(item.id));
}
function renderCandidateRows() {
  const rows = $("#candidate-rows");
  if (!rows) return;
  if (!candidateState.items.length) { rows.innerHTML = '<tr><td colspan="7" class="muted">当前筛选下没有可处理候选</td></tr>'; updateCandidateSelection(); return; }
  const reviewFilter = $("#candidate-review-level")?.value || "";
  const visibleItems = reviewFilter ? candidateState.items.filter(item => item.review_level === reviewFilter) : candidateState.items;
  if (!visibleItems.length) { rows.innerHTML = '<tr><td colspan="7" class="muted">当前审核等级下没有商品</td></tr>'; updateCandidateSelection(); return; }
  rows.innerHTML = visibleItems.map(item => {
    const packageInfo = item.package || {};
    const size = packageInfo.has_complete_package ? "已采集" : "待人工确认";
    const shop = item.shop_id ? `店铺 #${item.shop_id}` : "未分配店铺";
    const supplement = item.yunniudun_supplement;
    const supplementActive = supplement && ["submitted", "running", "waiting_human"].includes(supplement.status);
    const supplementDone = supplement?.status === "completed";
    const supplementText = supplementDone ? '<small class="candidate-cloud-status">云牛顿已回传</small>' : supplementActive ? `<small class="candidate-cloud-status">云牛顿${supplement.status === "waiting_human" ? "等待人工验证" : "采集中"}</small>` : "";
    const canSupplement = Boolean(item.source_url && item.shop_id && !supplementDone && !supplementActive && ["ready_for_review", "package_pending", "needs_review", "ai_failed"].includes(item.status));
    const action = item.shop_id && ["ready_for_review", "package_pending"].includes(item.status) ? `<button class="link candidate-manual" data-id="${item.id}">进入人工编辑</button>` : "";
    const cloudAction = canSupplement ? ` <button class="link candidate-yunniudun" data-id="${item.id}">云牛顿补采 SKU</button>` : supplement?.error_message ? `<small class="candidate-cloud-status error">${escapeHtml(supplement.error_message)}</small>` : "";
    const image = item.image_url
      ? `<button type="button" class="candidate-thumb-button" data-image-preview="${escapeHtml(item.image_url)}" aria-label="放大查看 ${escapeHtml(item.title || "商品图片")}"><img class="candidate-thumb" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title || "商品图片")}" loading="lazy" referrerpolicy="no-referrer"></button>`
      : '<span class="candidate-thumb candidate-thumb-empty">无图</span>';
    const reviewLabels = {green:"绿色·可批次审批",yellow:"黄色·局部处理",red:"红色·完整审核"};
    const evidence = item.review_evidence || {};
    const evidenceText = Object.entries(evidence).filter(([,ok])=>ok).map(([key])=>({category:"类目",sku:"SKU",pricing:"价格",package:"尺重",images:"图片",quality:"质检"}[key]||key)).join("/");
    return `<tr data-review-level="${escapeHtml(item.review_level || "yellow")}"><td><input type="checkbox" class="candidate-check" data-id="${item.id}" ${candidateState.selected.has(item.id) ? "checked" : ""}></td><td><div class="candidate-product">${image}<span><b>${escapeHtml(item.title || "未命名商品")}</b><br><small>${escapeHtml(item.offer_id || "-")}</small></span></div></td><td>${item.price_min == null ? "-" : `${item.price_min} 元`}<br><small>90天销量 ${item.sales_90d ?? "-"}</small></td><td>${size}<br><small>${packageInfo.sku_count || "-"} 个 SKU</small></td><td>${escapeHtml(shop)}</td><td><span class="status review-${escapeHtml(item.review_level || "yellow")}">${escapeHtml(reviewLabels[item.review_level] || "黄色·局部处理")}<br><small>${escapeHtml(item.review_reason || "")}</small>${evidenceText ? `<br><small>已验证：${escapeHtml(evidenceText)}</small>` : ""}</span></td><td>${action}${cloudAction}${supplementText}</td></tr>`;
  }).join("");
  rows.querySelectorAll(".candidate-check").forEach(input => input.addEventListener("change", () => { const id = Number(input.dataset.id); input.checked ? candidateState.selected.add(id) : candidateState.selected.delete(id); updateCandidateSelection(); }));
  rows.querySelectorAll(".candidate-manual").forEach(button => button.addEventListener("click", () => startManualListing(Number(button.dataset.id))));
  rows.querySelectorAll(".candidate-yunniudun").forEach(button => button.addEventListener("click", () => {
    const item = candidateState.items.find(candidate => Number(candidate.id) === Number(button.dataset.id));
    if (item) startCandidateYunNewtonSupplement(item, button);
  }));
  rows.querySelectorAll(".candidate-thumb").forEach(image => image.addEventListener("error", () => { image.classList.add("candidate-thumb-empty"); image.removeAttribute("src"); image.textContent = "图片加载失败"; }));
  updateCandidateSelection();
}
async function loadCandidatePool() {
  const rows = $("#candidate-rows");
  if (!rows) return;
  rows.innerHTML = '<tr><td colspan="7" class="muted">正在加载候选商品…</td></tr>';
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/candidates?${candidateQueryParams()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "候选商品加载失败");
    candidateState.items = data.items || [];
    candidateState.selected = new Set([...candidateState.selected].filter(id => candidateState.items.some(item => item.id === id)));
    renderCandidateStats(data.status_counts || {});
    $("#candidate-total").textContent = `${data.total || 0} 个候选`;
    $("#candidate-page").textContent = `第${data.page || candidateState.page}页`;
    $("#candidate-prev").disabled = candidateState.page <= 1;
    $("#candidate-next").disabled = candidateState.page * candidateState.pageSize >= (data.total || 0);
    renderCandidateRows();
  } catch (error) {
    rows.innerHTML = `<tr><td colspan="7" class="muted">${escapeHtml(error.message || "候选商品加载失败")}</td></tr>`;
    toast(error.message || "候选商品加载失败", true);
  }
}
async function startManualListing(candidateId) {
  const response = await fetch(`${apiBase}/api/v1/automation/candidates/${candidateId}/start-manual-listing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  const data = await response.json();
  if (!response.ok) { toast(data.detail || "无法进入人工编辑", true); return; }
  window.location.href = `./listing-editor.html?shop=${data.shop_id}&sp=${data.source_product_id}&returnTo=candidate-pool`;
}
function setCandidateBatchSample() {
  const selected = candidateState.items.filter(item => candidateState.selected.has(item.id));
  if (selected.length !== 1) { toast("请选择一个已经编辑完成的商品作为样板", true); return; }
  const item = selected[0];
  if (!item.draft_id) { toast("该商品还没有已保存草稿，不能作为样板", true); return; }
  candidateState.sampleDraftId = Number(item.draft_id);
  candidateState.sampleLabel = `${item.offer_id || item.title || "商品"} / 草稿 #${item.draft_id}`;
  localStorage.setItem("ozon-erp.batch-sample-draft", String(candidateState.sampleDraftId));
  localStorage.setItem("ozon-erp.batch-sample-label", candidateState.sampleLabel);
  updateCandidateSelection();
  toast("批次样板已设置；分类和勾选记忆属性将继承，图片、SKU、价格、尺重仍按各商品独立处理");
}
async function applyCandidateBatchSample() {
  const ids = [...candidateState.selected];
  if (!ids.length) return;
  if (!candidateState.sampleDraftId) { toast("请先选择一个已编辑商品，并点击“设为批次样板”", true); return; }
  if (!window.confirm(`确认用当前样板处理 ${ids.length} 个候选？\n只生成本地草稿，不会提交 Ozon；异常商品会留在人工队列。`)) return;
  const button = $("#candidate-batch-ai");
  button.disabled = true; button.textContent = "正在批量生成…";
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/candidate-batches/apply-sample`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({candidate_ids:ids, sample_draft_id:candidateState.sampleDraftId})});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
    candidateState.selected.clear();
    await loadCandidatePool();
    toast(`批量处理完成：草稿就绪 ${data.draft_ready} 个，需人工处理 ${data.needs_review} 个`, data.needs_review > 0);
  } catch (error) { toast(error.message || "批量套用样板失败", true); }
  finally { button.textContent = "批量套用样板生成草稿"; updateCandidateSelection(); }
}
let bulkBatchSourcePreview = null;
async function refreshBulkBatchPreview() {
  const form = $("#bulk-batch-form");
  const sourceKey = form?.elements.source_shop_key.value || "";
  if (!sourceKey) { $("#bulk-batch-preview").textContent = "请选择来源店铺"; return; }
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/source-preview?source_shop_key=${encodeURIComponent(sourceKey)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "读取来源范围失败");
    bulkBatchSourcePreview = data;
    $("#bulk-batch-preview").textContent = `${data.source_shop_name || sourceKey}：${data.product_count} 个商品、${data.sku_count} 条SKU。创建后仅建立本地队列。`;
  } catch (error) { $("#bulk-batch-preview").textContent = error.message || "读取来源范围失败"; }
}
async function autofillBulkBatchAttributes() {
  const sourceProductId = Number(bulkBatchSourcePreview?.representative_source_product_id || 0);
  const pair = $("#bulk-batch-category")?.value || "";
  const shopId = bulkMetadataShopId();
  if (!sourceProductId) { toast("请先选择来源店铺", true); return; }
  if (!shopId || !pair) { toast("请先确认一个候选分类", true); return; }
  const [categoryId, typeId] = pair.split(":");
  const button = $("#bulk-batch-autofill");
  button.disabled = true; button.textContent = "正在补空…";
  let filled = 0;
  try {
    const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/auto-fill`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({category_id:categoryId, type_id:typeId, source_product_id:sourceProductId, offer_id:""})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "属性自动回填失败");
    for (const item of data.results || []) {
      if (!item.value_text) continue;
      const input = $("#bulk-batch-attributes").querySelector(`[data-listing-attribute="${CSS.escape(String(item.attribute_id))}"]`);
      if (!input || input.value.trim()) continue;
      if (input.dataset.attributeKind === "dictionary") {
        if (!item.value_id) continue;
        input.value = `${item.value_text} · Ozon #${item.value_id}`;
        input.dataset.valueId = String(item.value_id);
        input.dataset.valueText = String(item.value_text);
      } else {
        input.value = String(item.value_text);
      }
      input.dataset.autofillMethod = item.method || "auto";
      input.title = `自动回填：${item.method || "规则匹配"}；可人工修改`;
      input.classList.add("bulk-attribute-autofilled");
      filled++;
    }
    toast(`已自动回填 ${filled} 项；其余属性请人工纠错或选择Ozon菜单`);
  } catch (error) {
    toast(error.message || "属性自动回填失败", true);
  } finally { button.disabled = false; button.textContent = "按本批代表商品补空"; }
}
async function openBulkBatchDialog() {
  const dialog = $("#bulk-batch-dialog");
  const form = $("#bulk-batch-form");
  if (!dialog || !form) return;
  $("#bulk-batch-shops").innerHTML = shops.map(shop => `<label><input type="checkbox" name="target_shop_ids" value="${shop.id}"> ${escapeHtml(shop.name || `店铺 #${shop.id}`)}</label>`).join("") || '<span class="muted">尚未接入Ozon店铺</span>';
  try {
    const sourceResponse = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/sources`);
    const sources = await sourceResponse.json();
    if (!sourceResponse.ok) throw new Error(sources.detail || "读取来源范围失败");
    $("#bulk-batch-source").innerHTML = '<option value="">请选择来源店铺</option>' + sources.map(item => `<option value="${escapeHtml(item.source_shop_key)}">${escapeHtml(item.source_shop_name || item.source_shop_key)} · ${item.product_count}个商品</option>`).join("");
  } catch (error) { $("#bulk-batch-preview").textContent = error.message || "读取来源范围失败"; }
  syncBulkPricingFields();
  await loadBulkTemplates();
  dialog.showModal();
}

function syncBulkPricingFields() {
  const form = $("#bulk-batch-form");
  if (!form) return;
  const useSystem = form.elements.pricing_mode_system?.checked;
  for (const name of ["sale_price_cny","old_price_cny","min_price_cny"]) {
    const el = form.elements[name];
    if (el) { el.disabled = !!useSystem; if (useSystem) el.removeAttribute("required"); else el.setAttribute("required",""); }
  }
  const internalCost = form.elements.internal_cost_cny;
  if (internalCost) { internalCost.disabled = !useSystem; internalCost.removeAttribute("required"); }
}

async function loadBulkTemplates() {
  const select = $("#bulk-template-select");
  if (!select) return;
  try {
    const resp = await fetch(`${apiBase}/api/v1/automation/bulk-listing-templates`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || "模板加载失败");
    select.innerHTML = '<option value="">加载已保存模板…</option>' + data.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
    $("#bulk-delete-template").style.display = data.length ? "inline-block" : "none";
  } catch(e) { select.innerHTML = '<option value="">模板加载失败</option>'; }
}

function collectBulkTemplatePayload() {
  const form = $("#bulk-batch-form");
  if (!form) return null;
  const numeric = name => Number(form.elements[name]?.value || 0);
  const categoryPair = form.elements.category_pair?.value || "";
  const [categoryId, typeId] = categoryPair.split(":");
  const attributeEntries = [...form.querySelectorAll("#bulk-batch-attributes [data-listing-attribute]")].map(input => ({
    attribute_id: input.dataset.listingAttribute,
    name: input.dataset.attributeName,
    value_id: input.dataset.attributeKind === "dictionary" ? (input.dataset.valueId || "") : "",
    value_text: input.dataset.attributeKind === "dictionary" ? (input.dataset.valueText || input.value.trim()) : input.value.trim(),
  }));
  return {
    name: form.elements.template_name?.value.trim() || form.elements.name?.value.trim() || "未命名模板",
    metadata_shop_id: bulkMetadataShopId(),
    category_id: categoryId || "", type_id: typeId || "",
    attributes: attributeEntries,
    target_shop_ids: [...form.querySelectorAll('input[name="target_shop_ids"]:checked')].map(input => Number(input.value)),
    distribution_mode: form.elements.distribution_mode?.value,
    pricing_mode_system: form.elements.pricing_mode_system?.checked ?? true,
    sale_price_cny: numeric("sale_price_cny"), old_price_cny: numeric("old_price_cny"),
    min_price_cny: numeric("min_price_cny"), internal_cost_cny: numeric("internal_cost_cny"),
    stock: numeric("stock"), weight_g: numeric("weight_g"),
    length_mm: numeric("length_mm"), width_mm: numeric("width_mm"), height_mm: numeric("height_mm"),
    sku_prefix: form.elements.sku_prefix?.value.trim() || "",
    color_strategy: form.elements.color_strategy?.value,
    ocr_remove_chinese_size_weight: form.elements.ocr_remove_chinese_size_weight?.checked ?? false,
    ocr_remove_marketing_images: form.elements.ocr_remove_marketing_images?.checked ?? false,
    translate_product_images: form.elements.translate_product_images?.checked ?? false,
    use_original_video: form.elements.use_original_video?.checked ?? false,
    auto_continue_next_day: form.elements.auto_continue_next_day?.checked ?? false,
  };
}

async function saveBulkTemplate() {
  const payload = collectBulkTemplatePayload();
  if (!payload) return;
  if (!payload.name || payload.name === "未命名模板") { toast("请在模板名称输入框填写名称", true); return; }
  try {
    const resp = await fetch(`${apiBase}/api/v1/automation/bulk-listing-templates`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || "保存失败");
    toast(`模板"${payload.name}"已保存`);
    await loadBulkTemplates();
    if (data.id) $("#bulk-template-select").value = String(data.id);
  } catch(e) { toast(e.message, true); }
}

async function loadBulkTemplateIntoForm(templateId) {
  if (!templateId) return;
  try {
    const resp = await fetch(`${apiBase}/api/v1/automation/bulk-listing-templates/${templateId}`);
    const t = await resp.json();
    if (!resp.ok) throw new Error(t.detail || "加载失败");
    const form = $("#bulk-batch-form");
    const set = (name, val) => { const el = form.elements[name]; if (el) { if (el.type === "checkbox") el.checked = !!val; else el.value = val ?? ""; } };
    form.querySelectorAll('input[name="target_shop_ids"]').forEach(input => { input.checked = (t.target_shop_ids || []).includes(Number(input.value)); });
    if (t.distribution_mode) set("distribution_mode", t.distribution_mode);
    set("template_name", t.name);
    set("pricing_mode_system", t.rules?.pricing_mode_system === true);
    for (const f of ["sale_price_cny","old_price_cny","min_price_cny","internal_cost_cny","stock","weight_g","length_mm","width_mm","height_mm"]) set(f, t.rules?.[f]);
    set("sku_prefix", t.rules?.sku_prefix); set("color_strategy", t.rules?.color_strategy);
    for (const c of ["ocr_remove_chinese_size_weight","ocr_remove_marketing_images","translate_product_images","use_original_video","auto_continue_next_day"]) set(c, t.rules?.[c]);
    if (t.category_id) {
      form.elements.category_pair.value = `${t.category_id}:${t.type_id || ""}`;
      await loadBulkBatchAttributes();
      for (const attr of t.rules?.attributes || []) {
        const input = form.querySelector(`#bulk-batch-attributes [data-listing-attribute="${CSS.escape(String(attr.attribute_id))}"]`);
        if (!input) continue;
        if (input.dataset.attributeKind === "dictionary") {
          input.value = attr.value_text || "";
          input.dataset.valueId = attr.value_id || "";
          input.dataset.valueText = attr.value_text || "";
        } else {
          input.value = attr.value_text || "";
        }
        input.classList.remove("bulk-attribute-autofilled");
      }
    }
    syncBulkPricingFields();
    toast(`已加载模板"${t.name}"`);
  } catch(e) { toast(e.message, true); }
}

async function deleteBulkTemplate() {
  const select = $("#bulk-template-select");
  const id = select?.value;
  if (!id) { toast("请先选择要删除的模板", true); return; }
  const name = select.options[select.selectedIndex]?.text || "";
  if (!confirm(`确认删除模板"${name}"？`)) return;
  try {
    const resp = await fetch(`${apiBase}/api/v1/automation/bulk-listing-templates/${id}`, {method:"DELETE"});
    if (!resp.ok) throw new Error((await resp.json()).detail || "删除失败");
    toast("模板已删除"); await loadBulkTemplates();
  } catch(e) { toast(e.message, true); }
}
async function loadBulkListingBatchesOnce() {
  const rows = $("#bulk-listing-rows");
  if (!rows) return;
  if (!window._bulkSilentBatchLoad) rows.innerHTML = '<tr><td colspan="9" class="muted">正在加载批量任务…</td></tr>';
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches`);
    const batches = await response.json();
    if (!response.ok) throw new Error(batches.detail || "批量任务加载失败");
    const totals = batches.reduce((sum, item) => ({total:sum.total+item.total_count, waiting:sum.waiting+(item.waiting_count ?? item.prepared_count ?? 0), review:sum.review+item.needs_review_count+item.failed_count, success:sum.success+item.succeeded_count}), {total:0,waiting:0,review:0,success:0});
    $("#bulk-listing-summary").innerHTML = `<article><small>任务数</small><strong>${batches.length}</strong></article><article><small>商品队列</small><strong>${totals.total}</strong></article><article><small>等待中</small><strong>${totals.waiting}</strong></article><article><small>需处理</small><strong>${totals.review}</strong></article><article><small>已成功</small><strong>${totals.success}</strong></article>`;
    rows.innerHTML = batches.length ? batches.map(item => {
      const pending = item.queued_count ?? item.waiting_count ?? item.prepared_count ?? 0;
      const quota = item.waiting_quota_count ?? 0;
      const waitingText = quota ? `可处理 ${pending} / 等额度 ${quota}` : pending;
      const action = item.status === "running"
          ? '<button type="button" class="danger bulk-task-pause" data-id="' + item.id + '">暂停任务</button>'
          : item.status === "waiting_quota"
            ? '<button type="button" class="primary bulk-task-execute" data-id="' + item.id + '">重新读取额度并继续</button>'
            : (item.status !== "submitted"
              ? '<button type="button" class="primary bulk-task-execute" data-id="' + item.id + '">' + (item.status === "draft" ? "开始处理并提交" : "继续处理并提交") + '</button>'
              : "");
      return `<tr><td><b>#${item.id} ${escapeHtml(item.name)}</b><br><small>${displayTime(item.created_at)}</small></td><td>${escapeHtml(item.source_shop_name || item.source_shop_key)}</td><td>${(item.target_shop_ids || []).map(id => escapeHtml(shops.find(shop => Number(shop.id) === Number(id))?.name || `#${id}`)).join("、")}</td><td>${item.total_count}</td><td>${waitingText}</td><td>${item.needs_review_count + item.failed_count}</td><td>${item.submitted_count} / ${item.succeeded_count}</td><td><span class="status ${bulkBatchStatusClass(item.status)}">${escapeHtml(bulkBatchStatusLabel(item.status))}</span><small class="bulk-status-time">${displayTime(item.updated_at)}</small></td><td><button type="button" class="secondary bulk-task-detail" data-id="${item.id}">查看明细</button> ${action}</td></tr>`;
    }).join("") : '<tr><td colspan="9" class="muted">暂无批量刊登任务</td></tr>';
  } catch (error) { rows.innerHTML = `<tr><td colspan="9" class="muted">${escapeHtml(error.message || "批量任务加载失败")}</td></tr>`; }
}

async function startCandidateYunNewtonSupplement(item, button) {
  const shopId = Number(item.shop_id || 0);
  if (!item.source_url || !shopId) { toast("该候选缺少 1688 链接或目标店铺，无法调用云牛顿。", true); return; }
  if (!window.confirm("将直接为当前候选调用云牛顿只读补采 SKU，可能消耗积分；不会询盘、下单或提交 Ozon。确认吗？")) return;
  const idleLabel = button.textContent;
  try {
    button.disabled = true; button.textContent = "提交中…";
    const createResponse = await fetch(`${apiBase}/api/v1/yunniudun/supplements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_url: item.source_url, shop_id: shopId }) });
    const created = await createResponse.json();
    if (!createResponse.ok) throw new Error(created.detail || "云牛顿补采任务创建失败");
    const jobId = created.item?.id;
    if (!jobId) throw new Error("云牛顿未返回本地任务编号");
    const startResponse = await fetch(`${apiBase}/api/v1/yunniudun/supplements/${jobId}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    const started = await startResponse.json();
    if (!startResponse.ok) throw new Error(started.detail || "云牛顿补采启动失败");
    toast("已从当前商品行提交云牛顿补采，后台自动等待回传。", false);
    button.textContent = "云牛顿采集中…";
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 1000 : 5000));
      const pollResponse = await fetch(`${apiBase}/api/v1/yunniudun/supplements/${jobId}/poll`, { method: "POST" });
      const polled = await pollResponse.json();
      if (!pollResponse.ok) throw new Error(polled.detail || "读取云牛顿回传失败");
      const state = polled.item?.status;
      if (state === "completed") { toast("云牛顿结果已回传并入库采集箱。", false); await loadCandidatePool(); return; }
      if (state === "waiting_human") { toast("云牛顿任务等待人工验证，未绕过验证。", true); await loadCandidatePool(); return; }
      if (state === "failed") throw new Error(polled.item?.error_message || "云牛顿补采失败");
    }
    toast("云牛顿任务仍在运行，候选页可稍后刷新查看。", false);
    await loadCandidatePool();
  } catch (error) {
    toast(error.message || "云牛顿补采失败", true);
    await loadCandidatePool();
  } finally {
    if (button) { button.disabled = false; button.textContent = idleLabel; }
  }
}

async function loadYunNewtonSettings() {
  const status = $("#yunniudun-status");
  const detail = $("#yunniudun-detail");
  const validate = $("#yunniudun-validate");
  const save = $("#yunniudun-token-form button[type=\"submit\"]");
  const supplementSubmit = $("#yunniudun-supplement-form button[type=\"submit\"]");
  const supplementShop = $("#yunniudun-shop-id");
  if (!status || !detail) return;
  // The initial hash view can load before the shared shop request completes.
  // Fill the target-store selector only after the existing shop list is ready.
  if (!shops.length) await loadShops();
  if (supplementShop) {
    const selected = supplementShop.value || $("#shop-filter")?.value || "";
    supplementShop.innerHTML = '<option value="">选择目标 Ozon 店铺</option>' + shops.map(shop => `<option value="${shop.id}">${escapeHtml(shop.name || `店铺 #${shop.id}`)}</option>`).join("");
    supplementShop.value = selected;
  }
  status.textContent = "正在读取授权状态…";
  try {
    const response = await fetch(`${apiBase}/api/v1/yunniudun/status`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "读取授权状态失败");
    status.textContent = data.configured ? "● 已保存本地授权" : "● 尚未配置完整授权";
    detail.textContent = data.message || "授权状态未知";
    if (save) save.disabled = false;
    if (supplementSubmit) supplementSubmit.disabled = shops.length === 0;
    if (validate) validate.disabled = !data.configured;
    await loadYunNewtonSupplementJobs();
  } catch (error) {
    status.textContent = "● 后端尚未启用云牛顿接口";
    detail.textContent = "请在后端受控重启后再保存或验证令牌。";
    if (save) save.disabled = true;
    if (supplementSubmit) supplementSubmit.disabled = true;
    if (validate) validate.disabled = true;
  }
}

async function loadYunNewtonSupplementJobs() {
  const rows = $("#yunniudun-supplement-rows");
  if (!rows) return;
  try {
    const response = await fetch(`${apiBase}/api/v1/yunniudun/supplements`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "读取补采任务失败");
    rows.innerHTML = (data.items || []).length ? data.items.map(item => {
      const shopName = shops.find(shop => Number(shop.id) === Number(item.shop_id))?.name || `店铺 #${item.shop_id}`;
      const issues = Array.isArray(item.parse_issues) && item.parse_issues.length ? item.parse_issues.join("、") : (item.error_message || (item.status === "completed" ? "已解析" : "待云牛顿回包"));
      const state = ({ draft: "待启动", submitted: "已提交补采", running: "采集中", completed: "已完成", failed: "失败", waiting_human: "等待人工验证" })[item.status] || item.status;
      const action = ["draft", "failed"].includes(item.status) && !item.provider_task_id ? `<button type="button" class="secondary yunniudun-start" data-job-id="${item.id}">${item.status === "failed" ? "重新启动" : "启动补采"}</button>` : (item.provider_task_id && ["submitted", "running", "waiting_human"].includes(item.status) ? `<button type="button" class="secondary yunniudun-poll" data-job-id="${item.id}">刷新回传</button>` : "");
      return `<tr><td><a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(item.offer_id)}</a></td><td>${escapeHtml(shopName)}</td><td>${escapeHtml(state)}</td><td>${escapeHtml(issues)}</td><td>${displayTime(item.updated_at)}</td><td>${action}</td></tr>`;
    }).join("") : '<tr><td colspan="5" class="muted">暂无本地补采任务</td></tr>';
  } catch (error) {
    rows.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(error.message || "读取补采任务失败")}</td></tr>`;
  }
}

async function startYunNewtonSupplement(jobId, button) {
  if (!window.confirm("将调用云牛顿 task.create 读取该 1688 商品链接，可能消耗积分；任务提示词禁止询盘、下单和其他外部写操作。确认启动吗？")) return;
  const idleLabel = button?.textContent || "启动补采";
  try {
    if (button) { button.disabled = true; button.textContent = "提交中…"; }
    const response = await fetch(`${apiBase}/api/v1/yunniudun/supplements/${jobId}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "云牛顿补采启动失败");
    toast(data.message || "云牛顿补采任务已提交");
    await loadYunNewtonSupplementJobs();
  } catch (error) { toast(error.message || "云牛顿补采启动失败", true); }
  finally { if (button) { button.disabled = false; button.textContent = idleLabel; } }
}

async function pollYunNewtonSupplement(jobId, button) {
  try {
    if (button) { button.disabled = true; button.textContent = "读取中…"; }
    const response = await fetch(`${apiBase}/api/v1/yunniudun/supplements/${jobId}/poll`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "读取云牛顿回传失败");
    toast(data.item?.status === "completed" ? "补采结果已入库采集箱。" : `云牛顿状态：${data.provider_status || data.item?.status || "未知"}`);
    await loadYunNewtonSupplementJobs();
  } catch (error) { toast(error.message || "读取云牛顿回传失败", true); }
  finally { if (button) { button.disabled = false; button.textContent = "刷新回传"; } }
}

async function createYunNewtonSupplement(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const sourceUrl = String($("#yunniudun-source-url")?.value || "").trim();
  const shopId = Number($("#yunniudun-shop-id")?.value || 0);
  if (!sourceUrl || !shopId) { toast("请填写 1688 商品链接并选择目标店铺。", true); return; }
  const submit = form.querySelector('button[type="submit"]');
  try {
    if (submit) { submit.disabled = true; submit.textContent = "创建中…"; }
    const response = await fetch(`${apiBase}/api/v1/yunniudun/supplements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_url: sourceUrl, shop_id: shopId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "创建本地补采任务失败");
    form.reset();
    toast(data.message || "本地补采任务已创建");
    await loadYunNewtonSettings();
  } catch (error) {
    toast(error.message || "创建本地补采任务失败", true);
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = "创建本地补采任务"; }
  }
}

async function saveYunNewtonAccessToken(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = $("#yunniudun-access-token");
  const accessToken = String(input?.value || "").trim();
  if (!accessToken) { toast("请粘贴 AccessToken。", true); return; }
  const submit = form.querySelector('button[type="submit"]');
  try {
    if (submit) { submit.disabled = true; submit.textContent = "保存中…"; }
    const response = await fetch(`${apiBase}/api/v1/yunniudun/access-token`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "令牌保存失败");
    form.reset();
    await loadYunNewtonSettings();
    toast("令牌已加密保存，页面未保留原文。");
  } catch (error) {
    if (input) input.value = "";
    toast(error.message || "令牌保存失败", true);
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = "安全保存令牌"; }
  }
}

async function validateYunNewtonAccessToken() {
  if (!window.confirm("将执行一次云牛顿 task.get 只读查询；文档提示 API 调用可能消耗积分。确认继续吗？")) return;
  const button = $("#yunniudun-validate");
  try {
    if (button) { button.disabled = true; button.textContent = "验证中…"; }
    const response = await fetch(`${apiBase}/api/v1/yunniudun/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "授权验证失败");
    toast(data.message || "授权验证已完成", data.authorized !== true);
    await loadYunNewtonSettings();
  } catch (error) {
    toast(error.message || "授权验证失败", true);
  } finally {
    if (button) button.textContent = "只读验证授权";
  }
}
let bulkBatchPollTimer = 0;
let bulkBatchRequestInFlight = false;
let bulkTaskDetailPollTimer = 0;
let bulkTaskDetailRequestInFlight = false;
function bulkBatchIsBusy(item) { return item.status === "running" || Number(item.processing_count || 0) > 0; }
function bulkBatchActivityText(item) {
  const current = item.processing_items?.[0];
  if (current) return "当前：" + String(current.title || current.source_offer_id || ("商品 #" + current.id)).slice(0, 54) + " · " + bulkShopName(current.assigned_shop_id) + (current.attempts ? "，第 " + current.attempts + " 次" : "");
  if (item.status === "paused") return "当前：已暂停，等待点击继续";
  if (item.status === "paused_quality_audit") return "当前：已暂停，先处理质量问题后再继续";
  if (item.status === "waiting_quota") return "当前：等待店铺额度恢复";
  if (item.status === "needs_review") return "当前：有商品需要处理";
  if (item.status === "submitted") return "当前：批次已完成提交";
  return "当前：等待后台领取下一条";
}
function bulkBatchProgressMarkup(item) {
  const total = Number(item.total_count || 0);
  const processed = Number(item.processed_count ?? ((item.submitted_count || 0) + (item.needs_review_count || 0) + (item.failed_count || 0)));
  const percent = Math.max(0, Math.min(100, Number(item.progress_percent ?? (total ? processed / total * 100 : 0))));
  return '<span class="bulk-progress-live"><div class="bulk-progress-track" aria-label="已处理 ' + processed + ' / ' + total + '"><i style="width:' + percent.toFixed(1) + '%"></i></div><small class="bulk-progress-label">已处理 ' + processed + ' / ' + total + '（' + percent.toFixed(1) + '%）</small><small class="bulk-live-line">' + escapeHtml(bulkBatchActivityText(item)) + '</small></span>';
}
async function refreshBulkLiveProgress() {
  const rows = $("#bulk-listing-rows");
  if (!rows) return [];
  try {
    const response = await fetch(apiBase + "/api/v1/automation/bulk-listing-batches");
    const batches = await response.json();
    if (!response.ok) return [];
    batches.forEach(item => {
      const button = rows.querySelector(".bulk-task-detail[data-id='" + item.id + "']");
      const row = button?.closest("tr");
      if (!row) return;
      let taskCell = row.children[0].querySelector(".bulk-task-cell");
      if (!taskCell) {
        const legacyContent = row.children[0].innerHTML;
        row.children[0].innerHTML = '<div class="bulk-task-cell">' + legacyContent + '</div>';
        taskCell = row.children[0].querySelector(".bulk-task-cell");
      }
      if (taskCell) { taskCell.querySelector(".bulk-progress-live")?.remove(); taskCell.insertAdjacentHTML("beforeend", bulkBatchProgressMarkup(item)); }
      const operation = row.children[8];
      if (operation && bulkBatchIsBusy(item) && !operation.querySelector(".bulk-live-hint")) operation.insertAdjacentHTML("beforeend", '<small class="bulk-live-hint">后台处理中…</small>');
    });
    return batches;
  } catch (_) { return []; }
}
function scheduleBulkBatchPoll(batches) {
  clearTimeout(bulkBatchPollTimer);
  bulkBatchPollTimer = 0;
  if (activeView === "bulk-listing" && batches.some(bulkBatchIsBusy)) bulkBatchPollTimer = window.setTimeout(() => loadBulkListingBatches({silent:true}), 5000);
}
async function loadBulkListingBatches(options = {}) {
  if (bulkBatchRequestInFlight) return;
  bulkBatchRequestInFlight = true;
  window._bulkSilentBatchLoad = Boolean(options.silent);
  try {
    await loadBulkListingBatchesOnce();
    const batches = await refreshBulkLiveProgress();
    scheduleBulkBatchPoll(batches);
  } finally {
    window._bulkSilentBatchLoad = false;
    bulkBatchRequestInFlight = false;
  }
}
const BULK_BATCH_STATUS_LABELS = {draft:"待开始", running:"正在处理", paused:"已暂停", pilot_complete:"等待处理", ready_to_continue:"等待处理", paused_quality_audit:"已暂停（需处理）", waiting_quota:"等待额度", submitted:"已完成", needs_review:"需处理", prepared:"等待处理", approved:"等待处理", failed:"提交失败"};
const BULK_ITEM_STATUS_LABELS = {queued:"等待处理", prepared:"等待处理", processing:"正在处理", approved:"等待处理", waiting_quota:"等待额度", submitted:"Ozon处理中", imported:"已成功", failed:"提交失败", needs_review:"需处理", needs_resubmit:"需修正提交", skipped:"已归档"};
const bulkTaskState = {batchId:0, items:[], statusFilter:"", shopIds:new Set(), timeSort:"desc", selected:new Set(), batchStatus:"", processingCount:0};
function bulkBatchStatusLabel(status) { return BULK_BATCH_STATUS_LABELS[status] || "状态待同步"; }
function bulkItemStatusLabel(status) { return BULK_ITEM_STATUS_LABELS[status] || "状态待同步"; }
function bulkBatchStatusClass(status) {
  if (status === "submitted" || status === "imported") return "status-success";
  if (status === "running") return "status-running";
  if (["waiting_quota", "ready_to_continue", "prepared", "approved", "pilot_complete"].includes(status)) return "status-waiting";
  if (["needs_review", "paused_quality_audit", "failed"].includes(status)) return "status-problem";
  return "status-neutral";
}
function bulkItemStatusClass(status) {
  if (status === "imported") return "status-success";
  if (status === "processing" || status === "submitted") return "status-running";
  if (["queued", "prepared", "approved", "waiting_quota", "partial"].includes(status)) return "status-waiting";
  if (status === "failed" || status === "needs_review" || status === "needs_resubmit") return "status-problem";
  if (status === "skipped") return "status-neutral";
  return "status-neutral";
}
function bulkShopName(shopId) { return shops.find(shop => Number(shop.id) === Number(shopId))?.name || `#${shopId}`; }
function bulkItemActions(batchId, item) {
  const actions = [];
  const problemStates = ["failed", "needs_review", "waiting_quota"];
  const needsResubmit = Boolean(item.requires_resubmit || String(item.error || "").startsWith("Ozon回传需修正提交："));
  if (item.status === "skipped") actions.push(`<button type="button" class="secondary bulk-item-retry" data-batch-id="${batchId}" data-item-id="${item.id}">恢复并提交</button>`);
  else if (item.status === "waiting_quota") actions.push(`<button type="button" class="secondary bulk-item-retry" data-batch-id="${batchId}" data-item-id="${item.id}">重新校验后继续</button>`);
  else if (problemStates.includes(item.status)) actions.push(`<button type="button" class="secondary bulk-item-retry" data-batch-id="${batchId}" data-item-id="${item.id}">${needsResubmit ? "修正后重新提交" : "重新处理并提交"}</button>`);
  if (problemStates.includes(item.status)) actions.push(`<button type="button" class="secondary bulk-item-skip" data-batch-id="${batchId}" data-item-id="${item.id}">归档</button>`);
  if (item.status === "needs_review" && String(item.error || "").includes("OCR")) actions.push(`<button type="button" class="primary bulk-ocr-review" data-batch-id="${batchId}" data-item-id="${item.id}">处理OCR</button>`);
  if (item.draft_id) actions.push(`<a class="secondary" href="./listing-editor.html?shop=${item.assigned_shop_id}&draft=${item.draft_id}&returnTo=bulk-listing">编辑草稿</a>`);
  return actions.length ? `<div class="bulk-item-actions">${actions.join("")}</div>` : "—";
}
function bulkRetryable(item) {
  return ["failed", "needs_review", "waiting_quota", "processing", "prepared", "approved", "skipped"].includes(item.status);
}
function bulkItemsMatchingFilters() {
  return bulkTaskState.items.filter(item => {
    const statusMatches = !bulkTaskState.statusFilter
      || (bulkTaskState.statusFilter === "queued" ? ["queued", "prepared", "approved"].includes(item.status) : item.status === bulkTaskState.statusFilter);
    const shopMatches = !bulkTaskState.shopIds.size || bulkTaskState.shopIds.has(Number(item.assigned_shop_id));
    return statusMatches && shopMatches;
  });
}
function bulkVisibleTaskItems() {
  const direction = bulkTaskState.timeSort === "asc" ? 1 : -1;
  return bulkItemsMatchingFilters().slice().sort((left, right) => {
    const leftTime = Date.parse(left.updated_at || left.created_at || "") || 0;
    const rightTime = Date.parse(right.updated_at || right.created_at || "") || 0;
    return (leftTime - rightTime) * direction || (Number(right.id) - Number(left.id)) * direction;
  });
}
function renderBulkShopFilterOptions() {
  const options = $("#bulk-item-shop-filter-options");
  const label = $("#bulk-item-shop-filter-label");
  if (!options || !label) return;
  const shopIds = [...new Set(bulkTaskState.items.map(item => Number(item.assigned_shop_id)).filter(Boolean))]
    .sort((left, right) => bulkShopName(left).localeCompare(bulkShopName(right), "zh-Hans-CN"));
  const counts = new Map(shopIds.map(id => [id, bulkTaskState.items.filter(item => Number(item.assigned_shop_id) === id).length]));
  options.innerHTML = shopIds.length ? shopIds.map(id => {
    const checked = !bulkTaskState.shopIds.size || bulkTaskState.shopIds.has(id);
    return `<label><input class="bulk-item-shop-option" type="checkbox" value="${id}" ${checked ? "checked" : ""}> ${escapeHtml(bulkShopName(id))} <small>${counts.get(id)}</small></label>`;
  }).join("") : '<span class="muted">暂无店铺</span>';
  label.textContent = !bulkTaskState.shopIds.size ? "Ozon店铺：全部" : `Ozon店铺：已选 ${bulkTaskState.shopIds.size}/${shopIds.length}`;
}
function bulkSelectedItems() {
  return bulkTaskState.items.filter(item => bulkTaskState.selected.has(Number(item.id)));
}
function updateBulkRetrySelection() {
  const selected = bulkSelectedItems();
  const button = $("#bulk-retry-selected");
  if (button) { button.disabled = !selected.length; button.textContent = selected.length ? `批量重新处理所选（${selected.length}）` : "批量重新处理所选"; }
  const visible = bulkVisibleTaskItems();
  const allChecked = visible.length > 0 && visible.every(item => bulkTaskState.selected.has(Number(item.id)));
  [$("#bulk-detail-select-all"), $("#bulk-detail-select-all-head")].forEach(box => {
    if (box) {
      box.disabled = visible.length === 0;
      box.checked = allChecked;
      box.indeterminate = !allChecked && visible.some(item => bulkTaskState.selected.has(Number(item.id)));
    }
  });
}
function setBulkVisibleSelection(checked) {
  bulkVisibleTaskItems().forEach(item => {
    if (checked) bulkTaskState.selected.add(Number(item.id));
    else bulkTaskState.selected.delete(Number(item.id));
  });
  renderBulkTaskItems();
}
function renderBulkTaskItems() {
  const rows = $("#bulk-task-detail-rows");
  if (!rows) return;
  const items = bulkVisibleTaskItems();
  renderBulkShopFilterOptions();
  $("#bulk-task-detail-meta").textContent = `共 ${bulkTaskState.items.length} 个商品，显示 ${items.length} 个；按更新时间${bulkTaskState.timeSort === "asc" ? "正序" : "倒序"}；当前批次状态：${bulkBatchStatusLabel(bulkTaskState.batchStatus || "")}`;
  rows.innerHTML = items.length ? items.map(item => { const displayStatus = item.requires_resubmit || String(item.error || "").startsWith("Ozon回传需修正提交：") ? "needs_resubmit" : item.status; return `<tr><td><input type="checkbox" class="bulk-detail-select" data-item-id="${item.id}" ${bulkTaskState.selected.has(Number(item.id)) ? "checked" : ""} aria-label="选择 ${escapeHtml(item.erp_offer_id || item.source_offer_id || "商品")}"></td><td><b>${escapeHtml(item.erp_offer_id || "待生成")}</b></td><td>${escapeHtml(item.source_offer_id || item.offer_id)}</td><td><span class="line-product">${lineImage(item.image_url, item.title)} ${escapeHtml(item.title || "未命名")}</span></td><td>${escapeHtml(bulkShopName(item.assigned_shop_id))}</td><td><span class="status ${bulkItemStatusClass(displayStatus)}">${escapeHtml(bulkItemStatusLabel(displayStatus))}</span>${item.ozon_task_id ? `<small>Ozon任务：${escapeHtml(item.ozon_task_id)}</small>` : ""}${item.attempts ? `<small>尝试 ${item.attempts} 次</small>` : ""}${item.stock_sync_status ? `<small>库存：${escapeHtml(item.stock_sync_status)}${item.stock_sync_message ? ` · ${escapeHtml(item.stock_sync_message)}` : ""}</small>` : "<small>库存：待确认</small>"}</td><td><time class="bulk-status-time">${displayTime(item.updated_at)}</time></td><td>${item.error ? `<span class="bulk-item-error">${escapeHtml(item.error)}</span>` : "—"}</td><td>${bulkItemActions(bulkTaskState.batchId, item)}</td></tr>`; }).join("") : '<tr><td colspan="9" class="muted">当前筛选条件下没有商品</td></tr>';
  updateBulkRetrySelection();
}
function scheduleBulkTaskDetailPoll() {
  clearTimeout(bulkTaskDetailPollTimer);
  bulkTaskDetailPollTimer = 0;
  const detail = $("#bulk-task-detail");
  const live = bulkTaskState.batchStatus === "running" || bulkTaskState.batchStatus === "submitted" || Number(bulkTaskState.processingCount || 0) > 0;
  if (!detail?.hidden && activeView === "bulk-listing" && bulkTaskState.batchId && live) {
    bulkTaskDetailPollTimer = window.setTimeout(() => showBulkTaskDetail(bulkTaskState.batchId, {scrollToDetail:false, preserveScroll:true}), 5000);
  }
}
async function showBulkTaskDetail(batchId, options = {}) {
  if (bulkTaskDetailRequestInFlight) return;
  bulkTaskDetailRequestInFlight = true;
  const tableWrap = $("#bulk-task-detail .table-wrap");
  const scrollTop = options.preserveScroll && tableWrap ? tableWrap.scrollTop : 0;
  const scrollLeft = options.preserveScroll && tableWrap ? tableWrap.scrollLeft : 0;
  try {
  const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/${batchId}?page=1&page_size=5000`);
  const data = await response.json();
  if (!response.ok) { toast(data.detail || "任务明细加载失败", true); return; }
  if (bulkTaskState.batchId !== batchId) { bulkTaskState.statusFilter = ""; bulkTaskState.shopIds.clear(); bulkTaskState.selected.clear(); }
  bulkTaskState.batchId = batchId; bulkTaskState.items = data.items; bulkTaskState.batchStatus = data.status; bulkTaskState.processingCount = data.processing_count || 0;
  $("#bulk-task-detail-title").textContent = `任务 #${data.id} ${data.name}`;
  const filter = $("#bulk-item-status-filter");
  if (filter) filter.value = bulkTaskState.statusFilter || "";
  const timeSort = $("#bulk-item-time-sort");
  if (timeSort) timeSort.value = bulkTaskState.timeSort;
  renderBulkTaskItems();
  $("#bulk-task-detail").hidden = false;
  if (options.scrollToDetail !== false) $("#bulk-task-detail").scrollIntoView({behavior:"smooth", block:"start"});
  if (options.preserveScroll && tableWrap) { tableWrap.scrollTop = scrollTop; tableWrap.scrollLeft = scrollLeft; }
  } finally {
    bulkTaskDetailRequestInFlight = false;
    scheduleBulkTaskDetailPoll();
  }
}
async function retryBulkItem(batchId, itemId, button) {
  // Refresh first: the worker may have advanced this row since the detail
  // dialog was opened. Never retry from a stale status snapshot.
  try {
    await showBulkTaskDetail(batchId);
  } catch (_) {
    toast("无法刷新商品状态，请确认后端在线后重试", true);
    return;
  }
  const item = bulkTaskState.items.find(row => Number(row.id) === Number(itemId));
  if (!item || !["failed", "needs_review", "waiting_quota", "processing", "prepared", "approved", "skipped"].includes(item.status)) {
    toast(`当前商品已变为“${bulkItemStatusLabel(item?.status || "未知状态")}”，无需重复重试`, true);
    return;
  }
  const actionLabel = item?.status === "skipped" ? "恢复并提交" : (item?.status === "waiting_quota" ? "重新校验后继续" : "重新处理并提交");
  const detail = item?.status === "waiting_quota"
    ? "后台会重新校验草稿和店铺额度；额度仍不足会继续停在“等待额度”，不会反复外发。"
    : "后台会从货源重新生成草稿，执行图片隔离、属性/内容预检和可自动修复规则；仍有阻塞问题会回到“需处理”，只有通过后才真实提交 Ozon。";
  if (!confirm(`确认${actionLabel}这条商品？\n\n${detail}`)) return;
  const oldText = button.textContent;
  button.disabled = true; button.textContent = "处理中…";
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/${batchId}/items/${itemId}/retry`, {method:"POST"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "重试失败");
    toast(data.status === "queued" ? "已重新排队：将先预检修正，再决定是否提交" : "重新处理指令已发送");
    await showBulkTaskDetail(batchId); await loadBulkListingBatches();
  } catch (error) {
    const message = error instanceof TypeError ? "后端连接中断，请确认后端在线后刷新页面" : (error.message || "重试失败");
    toast(message, true); button.disabled = false; button.textContent = oldText;
  }
}
async function retrySelectedBulkItems() {
  const items = bulkSelectedItems();
  if (!items.length) return;
  if (!confirm(`确认处理所选 ${items.length} 条商品？\n\n需要处理、失败、等待额度等状态会重新预检并提交；已成功或正在等待 Ozon 回执的条目保持原状，不会重复提交。`)) return;
  const button = $("#bulk-retry-selected");
  if (button) { button.disabled = true; button.textContent = "正在重新处理…"; }
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/${bulkTaskState.batchId}/items/batch-retry`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({item_ids:items.map(item => Number(item.id)), actor_id:"operator"})});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || "批量重试失败"));
    items.forEach(item => bulkTaskState.selected.delete(Number(item.id)));
    toast(data.queued_count ? `已重新排队 ${data.queued_count} 条；${data.skipped_count || 0} 条当前无需处理，保持原状态` : `所选 ${data.skipped_count || 0} 条当前均无需重新处理，状态未改变`);
    await showBulkTaskDetail(bulkTaskState.batchId); await loadBulkListingBatches();
  } catch (error) { toast(error.message || "批量重试失败", true); updateBulkRetrySelection(); }
}
async function skipBulkItem(batchId, itemId, button) {
  if (!confirm("确认归档这条商品？归档后不会继续提交，之后可在“已归档”筛选中恢复。")) return;
  const oldText = button.textContent;
  button.disabled = true; button.textContent = "归档中…";
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/${batchId}/items/${itemId}/skip`, {method:"POST"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "归档失败");
    toast("已归档");
    await showBulkTaskDetail(batchId); await loadBulkListingBatches();
  } catch (error) { toast(error.message || "归档失败", true); button.disabled = false; button.textContent = oldText; }
}

async function loadApprovalCenter() {
  const rows = $("#approval-rows"); if (!rows) return;
  rows.innerHTML = '<tr><td colspan="7" class="muted">正在加载审批批次与店铺额度…</td></tr>';
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/approval-batches`); const batches = await response.json();
    if (!response.ok) throw new Error(batches.detail || "审批批次加载失败");
    const capacityEntries = await Promise.all([...new Set(batches.map(item => Number(item.shop_id)))].map(async shopId => {
      try {
        const capacityResponse = await fetch(`${apiBase}/api/v1/automation/approval-batches/capacity/${shopId}`);
        const capacity = await capacityResponse.json();
        return [shopId, capacityResponse.ok ? capacity : {warning:capacity.detail || "额度读取失败"}];
      } catch (error) { return [shopId, {warning:error.message || "额度读取失败"}]; }
    }));
    const capacities = Object.fromEntries(capacityEntries);
    const counts = key => batches.filter(item => item.status === key).length;
    $("#approval-pending").textContent = counts("pending_approval"); $("#approval-approved").textContent = counts("approved");
    $("#approval-partial").textContent = counts("partially_submitted"); $("#approval-submitted").textContent = counts("submitted");
    rows.innerHTML = batches.length ? batches.map(item => {
      const quota = capacities[Number(item.shop_id)] || {};
      const quotaText = Number.isFinite(Number(quota.remaining)) ? `剩余 ${quota.remaining} / ${quota.limit}` : "暂不可读";
      const quotaSource = quota.source === "ozon_v4_product_info_limit" ? "Ozon实时额度" : "本地保守额度";
      return `<tr><td><b>#${item.id} ${escapeHtml(item.name)}</b><small>${displayTime(item.created_at)}</small></td><td>${escapeHtml(shops.find(shop => Number(shop.id) === Number(item.shop_id))?.name || `店铺 #${item.shop_id}`)}</td><td>${item.item_count}</td><td>${escapeHtml(({pending_approval:"待审批",approved:"已批准待发布",partially_submitted:"部分提交，待续传",submitted:"已提交"})[item.status] || item.status)}</td><td><b>${escapeHtml(quotaText)}</b><small title="${escapeHtml(quota.warning || "")}">${escapeHtml(quotaSource)}${quota.reset_at ? ` · ${displayTime(quota.reset_at)}重置` : ""}</small></td><td>${item.approved_by ? `${escapeHtml(item.approved_by)}<small>${displayTime(item.approved_at)}</small>` : "—"}</td><td>${item.status === "pending_approval" ? `<button class="primary approval-approve" data-id="${item.id}">批准</button>` : ["approved","partially_submitted"].includes(item.status) ? `<button class="danger approval-submit" data-id="${item.id}" data-count="${item.item_count}" data-quota="${escapeHtml(String(quota.remaining ?? "未知"))}">确认提交Ozon</button><small>每次最多20条；未提交部分保留队列</small>` : "—"}</td></tr>`;
    }).join("") : '<tr><td colspan="7" class="muted">暂无审批发布批次</td></tr>';
  } catch (error) { rows.innerHTML = `<tr><td colspan="7" class="muted">${escapeHtml(error.message || "审批批次加载失败")}</td></tr>`; }
}
async function approveExistingBatch(batchId) {
  if (!confirm("确认批准该批本地草稿进入发布队列？此操作不会提交Ozon。")) return;
  const response = await fetch(`${apiBase}/api/v1/automation/approval-batches/${batchId}/approve`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({approver_id:"operator",confirmed:true})});
  const data = await response.json(); if (!response.ok) return toast(data.detail || "审批失败",true); toast(`已批准 ${data.approved} 个商品，尚未提交Ozon。`); loadApprovalCenter();
}
async function submitApprovalBatch(batchId, count, quota) {
  if (!confirm(`即将真实调用Ozon API提交商品。\n\n本批共 ${count} 个商品；当前页面显示今日可用额度：${quota}。本次最多提交20条，后端会在发送前重新读取额度，未提交部分保留在队列。确认继续？`)) return;
  const response = await fetch(`${apiBase}/api/v1/automation/approval-batches/${batchId}/submit`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({actor_id:"operator",confirmed:true,max_items:20})});
  const data = await response.json(); if (!response.ok) return toast(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data),true);
  const quotaSource = data.capacity?.source === "ozon_v4_product_info_limit" ? "Ozon实时额度" : "本地保守额度";
  toast(`本次已向Ozon提交 ${data.submitted} 个，队列剩余 ${data.remaining} 个（${quotaSource}）。`, data.results?.some(item => item.status === "failed")); loadApprovalCenter();
}

async function openBulkOcrReview(batchId, itemId) {
  let dialog = $("#bulk-ocr-review-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "bulk-ocr-review-dialog";
    dialog.style.cssText = "width:min(1050px,94vw);max-height:90vh;padding:0;border:0;border-radius:14px";
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `<div style="padding:20px"><h3>OCR图片复核</h3><p class="muted">不需要重启整批任务。对失败图片先点“重新识别”；仍失败时，请看原图后明确选择“保留图片”或“从本次草稿排除”。原始采集图片始终保留。</p><div id="bulk-ocr-review-images">正在读取…</div><div style="text-align:right;margin-top:16px"><button type="button" class="secondary bulk-ocr-close">关闭</button></div></div>`;
  dialog.querySelector(".bulk-ocr-close").addEventListener("click", () => dialog.close());
  dialog.showModal();
  async function render() {
    const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/${batchId}/items/${itemId}/ocr-review`);
    const data = await response.json();
    if (!response.ok) { $("#bulk-ocr-review-images").textContent = data.detail || "OCR记录读取失败"; return; }
    const failures = data.images.filter(row => row.error);
    $("#bulk-ocr-review-images").innerHTML = `<p><b>${failures.length ? `还有 ${failures.length} 张需要决定` : "本条OCR问题已处理完成"}</b></p><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px">${data.images.map(row => `<article style="border:1px solid ${row.error ? "#ef4444" : row.excluded ? "#f59e0b" : "#d1d5db"};border-radius:10px;padding:10px"><img src="${escapeHtml(row.url)}" alt="OCR复核图" style="width:100%;height:170px;object-fit:contain;background:#f8fafc;cursor:zoom-in" class="cb-thumb"><p style="margin:8px 0"><b>${row.error ? "识别失败" : row.excluded ? "已从草稿排除" : "保留"}</b></p><small style="display:block;max-height:54px;overflow:auto">${escapeHtml(row.error || row.text || "未识别到文字")}</small>${row.error ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px"><button type="button" class="primary bulk-ocr-action" data-action="retry" data-url="${escapeHtml(row.url)}">重新识别</button><button type="button" class="secondary bulk-ocr-action" data-action="keep" data-url="${escapeHtml(row.url)}">保留图片</button><button type="button" class="danger bulk-ocr-action" data-action="exclude" data-url="${escapeHtml(row.url)}">排除图片</button></div>` : ""}</article>`).join("")}</div>`;
    $("#bulk-ocr-review-images").querySelectorAll(".bulk-ocr-action").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true; const old = button.textContent; button.textContent = button.dataset.action === "retry" ? "识别中…" : "处理中…";
      try {
        const resultResponse = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/${batchId}/items/${itemId}/ocr-review`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:button.dataset.action,url:button.dataset.url})});
        const result = await resultResponse.json();
        if (!resultResponse.ok) throw new Error(result.detail || "OCR处理失败");
        toast(result.status === "queued" ? "本条OCR问题已处理，已自动重新加入处理队列" : "已保存处理结果");
        await render(); await showBulkTaskDetail(batchId); await loadBulkListingBatches();
      } catch (error) { toast(error.message || "OCR处理失败", true); button.disabled = false; button.textContent = old; }
    }));
  }
  await render();
}
async function startBulkTask(batchId) {
  const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/${batchId}/start`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({max_items:5})});
  const data = await response.json();
  if (!response.ok) { toast(data.detail || "启动预处理失败", true); return; }
  toast(`任务 #${batchId} 已开始预处理 ${data.started_items} 条；不会提交Ozon`);
  loadBulkListingBatches();
}
async function pauseBulkTask(batchId, button) {
  if (!confirm("确认暂停这个批量任务？\n\n暂停后不会继续生成或提交新商品；已经提交到 Ozon 的商品仍会继续回读回执和库存。当前正在进行的一条请求可能先完成，之后停止领取下一条。")) return;
  if (button?.dataset.busy === "1") return;
  const oldText = button?.textContent || "暂停任务";
  if (button) { button.dataset.busy = "1"; button.disabled = true; button.textContent = "暂停中…"; }
  try {
    const response = await fetch(apiBase + "/api/v1/automation/bulk-listing-batches/" + batchId + "/pause", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
    toast(data.message || ("任务 #" + batchId + " 已暂停"));
    await loadBulkListingBatches();
  } catch (error) {
    const message = error instanceof TypeError ? "后端连接中断，请确认后端在线后刷新页面" : (error.message || "暂停批量任务失败");
    toast(message, true);
    if (button) { button.dataset.busy = ""; button.disabled = false; button.textContent = oldText; }
  }
}
async function executeBulkTask(batchId, button) {
  if (!confirm("确认按当前批量规则连续处理并真实提交到 Ozon？\n\n系统会按店铺轮转逐条处理；某店达到 Ozon 发布额度后只暂停该店，其他店继续，不再按 200 条人为截断。")) return;
  if (button?.dataset.busy === "1") return;
  if (button) { button.dataset.busy = "1"; button.disabled = true; button.textContent = "已启动，处理中…"; }
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches/${batchId}/execute`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmed:true,max_items:10000,actor_id:"operator"})});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
    toast(`任务 #${batchId} 已开始连续处理 ${data.started_items} 条队列；某店额度用完会单独暂停，其他店继续。`);
    await loadBulkListingBatches();
  } catch (error) {
    const message = error instanceof TypeError ? "后端连接中断，请确认后端在线后刷新页面" : (error.message || "批量执行启动失败");
    toast(message, true);
    if (button) { button.dataset.busy = ""; button.disabled = false; button.textContent = "继续处理并提交"; }
  }
}
let bulkCategoryTimer = 0;
function bulkMetadataShopId() {
  const checked = $("#bulk-batch-form")?.querySelector('input[name="target_shop_ids"]:checked');
  const currentShopId = Number($("#shop-filter")?.value || 0);
  return Number(checked?.value || currentShopId || shops[0]?.id || 0);
}
async function loadBulkBatchCategories() {
  const shopId = bulkMetadataShopId();
  const query = $("#bulk-batch-category-search")?.value.trim() || "";
  const menu = $("#bulk-batch-category-menu");
  if (!shopId) { menu.innerHTML = '<div class="muted">尚未接入可读取分类的Ozon店铺</div>'; menu.hidden = false; return; }
  menu.innerHTML = '<div class="muted">正在加载分类…</div>'; menu.hidden = false;
  try {
    const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/metadata/categories?query=${encodeURIComponent(query)}&limit=100`);
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.detail || "分类加载失败");
    menu.innerHTML = rows.length ? rows.map(item => {
      const zh = String(item.title_zh || "").trim();
      const ru = String(item.title || "").trim();
      const label = zh && ru && zh !== ru ? `${zh}（${ru}）` : (zh || ru || `类目 ${item.category_id}`);
      return `<button type="button" data-category-pair="${escapeHtml(item.category_id)}:${escapeHtml(item.type_id)}" data-category-label="${escapeHtml(label)}"><span>${escapeHtml(label)}</span><small>Category ${escapeHtml(item.category_id)} · Type ${escapeHtml(item.type_id)}</small></button>`;
    }).join("") : '<div class="muted">没有匹配的分类</div>';
  } catch (error) { menu.innerHTML = `<div class="muted">${escapeHtml(error.message || "分类加载失败")}</div>`; }
}
function installBulkDictionarySearch(shopId, categoryId, typeId) {
  $("#bulk-batch-attributes").querySelectorAll('input[data-attribute-kind="dictionary"]').forEach(control => {
    let timer = 0;
    let composing = false;
    const menu = control.parentElement.querySelector(".bulk-dictionary-menu");
    const closeMenu = () => { if (menu) { menu.innerHTML = ""; menu.hidden = true; } };
    const loadOptions = async query => {
      const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/metadata/categories/${categoryId}/types/${typeId}/attributes/${control.dataset.listingAttribute}/values?query=${encodeURIComponent(query)}&limit=50`);
      const values = await response.json();
      if (!response.ok || !menu) return;
      menu.innerHTML = values.length ? values.map(item => `<button type="button" data-value-id="${escapeHtml(item.id)}" data-value-text="${escapeHtml(item.value)}">${escapeHtml(item.value)} <small>Ozon #${escapeHtml(item.id)}</small></button>`).join("") : '<div class="muted">没有匹配的Ozon菜单项</div>';
      menu.hidden = false;
    };
    const search = () => {
      control.dataset.valueId = "";
      control.dataset.valueText = "";
      control.classList.remove("bulk-attribute-autofilled");
      clearTimeout(timer);
      const query = control.value.trim();
      if (!query) { closeMenu(); return; }
      timer = setTimeout(async () => {
        if (control.value.trim() === query) await loadOptions(query);
      }, 250);
    };
    control.addEventListener("compositionstart", () => { composing = true; });
    control.addEventListener("compositionend", () => { composing = false; search(); });
    control.addEventListener("input", () => {
      if (!composing) search();
    });
    control.addEventListener("focus", () => {
      clearTimeout(timer);
      // Clicking an empty field must reveal the menu; typing is only an
      // optional way to narrow the same canonical Ozon choices.
      loadOptions("");
    });
    menu?.addEventListener("mousedown", event => event.preventDefault());
    menu?.addEventListener("click", event => {
      const option = event.target.closest("button[data-value-id]");
      if (!option) return;
      control.value = option.dataset.valueText || "";
      control.dataset.valueId = option.dataset.valueId || "";
      control.dataset.valueText = option.dataset.valueText || "";
      control.setCustomValidity("");
      closeMenu();
    });
    control.addEventListener("blur", () => setTimeout(closeMenu, 120));
  });
}
async function loadBulkBatchAttributes() {
  const shopId = bulkMetadataShopId();
  const pair = $("#bulk-batch-category")?.value || "";
  const box = $("#bulk-batch-attributes");
  if (!shopId || !pair) { box.innerHTML = '<span class="muted">选择分类后加载全部 Ozon 属性</span>'; return; }
  const [categoryId, typeId] = pair.split(":");
  box.innerHTML = '<span class="muted">正在加载完整分类属性…</span>';
  try {
    const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/metadata/categories/${categoryId}/types/${typeId}/attributes`);
    const attributes = await response.json();
    if (!response.ok) throw new Error(attributes.detail || "属性加载失败");
    const delegated = item => {
      const name = String(item.name || "").toLowerCase();
      return ["名称", "название"].includes(name.trim()) || String(item.id) === "9048" || ["型号名称", "название модели", "主题标签", "хештег", "json富内容", "rich content", "简介", "описание", "视频", "видео"].some(token => name.includes(token));
    };
    box.innerHTML = `<div class="listing-attribute-title">共 ${attributes.length} 项；绿色为自动回填；灰色为原上架流程逐商品生成</div>${attributes.map(item => delegated(item)
      ? `<label class="listing-attribute-field bulk-attribute-delegated">${escapeHtml(item.name)}${item.required ? "（必填）" : ""}<input value="由原上架流程按每个商品生成" disabled title="不在批量属性区重新实现"></label>`
      : String(item.dictionary_id || "")
        ? `<label class="listing-attribute-field bulk-dictionary-field">${escapeHtml(item.name)}${item.required ? "（必填）" : ""}<input data-listing-attribute="${escapeHtml(item.id)}" data-attribute-name="${escapeHtml(item.name)}" data-attribute-kind="dictionary" autocomplete="off" placeholder="点击展开选项；输入可筛选"${item.required ? " required" : ""}><div class="bulk-dictionary-menu" hidden></div></label>`
        : window.ListingAttributes.attributeFieldHtml(item, [])).join("")}`;
    installBulkDictionarySearch(shopId, categoryId, typeId);
    if (bulkBatchSourcePreview?.representative_source_product_id) await autofillBulkBatchAttributes();
  } catch (error) { box.innerHTML = `<span class="muted">${escapeHtml(error.message || "属性加载失败")}</span>`; }
}
async function createBulkListingBatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const inlineError = $("#bulk-batch-error");
  inlineError.hidden = true; inlineError.textContent = "";
  const selectedShops = [...form.querySelectorAll('input[name="target_shop_ids"]:checked')].map(input => Number(input.value));
  if (!selectedShops.length) { toast("请至少选择一个目标Ozon店铺", true); return; }
  const categoryPair = form.elements.category_pair.value;
  if (!categoryPair) { toast("请先选择Ozon分类", true); return; }
  const [categoryId, typeId] = categoryPair.split(":");
  const attributeEntries = [...form.querySelectorAll("#bulk-batch-attributes [data-listing-attribute]")].map(input => ({
    attribute_id: input.dataset.listingAttribute,
    name: input.dataset.attributeName,
    value_id: input.dataset.attributeKind === "dictionary" ? (input.dataset.valueId || "") : "",
    value_text: input.dataset.attributeKind === "dictionary" ? (input.dataset.valueText || input.value.trim()) : input.value.trim(),
  }));
  const invalidDictionary = attributeEntries.find(item => {
    const input = form.querySelector(`[data-listing-attribute="${CSS.escape(String(item.attribute_id))}"]`);
    return input?.dataset.attributeKind === "dictionary" && item.value_text && !item.value_id;
  });
  if (invalidDictionary) { toast(`“${invalidDictionary.name}”必须从Ozon下拉菜单选择，不能直接输入文字`, true); return; }
  const useSystemPricing = form.elements.pricing_mode_system.checked;
  const numeric = name => Number(form.elements[name].value);
  if (!useSystemPricing) {
    for (const name of ["sale_price_cny","old_price_cny","min_price_cny"]) {
      if (!(numeric(name) > 0)) { toast(`手动定价时${name}必须大于0`, true); form.elements[name]?.focus(); return; }
    }
  }
  const payload = {
    name: form.elements.name.value.trim(), source_shop_key: form.elements.source_shop_key.value.trim(),
    metadata_shop_id: bulkMetadataShopId(), category_id: categoryId, type_id: typeId,
    attributes: attributeEntries, target_shop_ids: selectedShops,
    distribution_mode: form.elements.distribution_mode.value,
    auto_continue_next_day: form.elements.auto_continue_next_day.checked,
    template_name: form.elements.template_name?.value.trim() || null,
    pricing_mode_system: useSystemPricing,
    sale_price_cny: numeric("sale_price_cny"), old_price_cny: numeric("old_price_cny"), min_price_cny: numeric("min_price_cny"),
    internal_cost_cny: numeric("internal_cost_cny"), stock: numeric("stock"), weight_g: numeric("weight_g"),
    length_mm: numeric("length_mm"), width_mm: numeric("width_mm"), height_mm: numeric("height_mm"),
    sku_prefix: form.elements.sku_prefix.value.trim(), color_strategy: form.elements.color_strategy.value,
    ocr_remove_chinese_size_weight: form.elements.ocr_remove_chinese_size_weight.checked,
    ocr_remove_marketing_images: form.elements.ocr_remove_marketing_images.checked,
    translate_product_images: form.elements.translate_product_images.checked,
    use_original_video: form.elements.use_original_video.checked,
  };
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; submit.textContent = "正在建立3076条队列…";
  try {
    const response = await fetch(`${apiBase}/api/v1/automation/bulk-listing-batches`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
    $("#bulk-batch-dialog").close();
    toast(`批量刊登任务 #${data.id} 已建立：${data.total_count} 个商品。尚未生成草稿或提交Ozon。`);
    if (activeView === "bulk-listing") loadBulkListingBatches();
  } catch (error) {
    const message = error.message || "批量刊登任务创建失败";
    inlineError.textContent = message; inlineError.hidden = false;
    inlineError.scrollIntoView({block:"nearest"});
    toast(message, true);
  }
  finally { submit.disabled = false; submit.textContent = "创建本地任务"; }
}
async function loadAutomationCenter() {
  const rows = $("#automation-task-rows");
  if (!rows) return;
  try { const response = await fetch(`${apiBase}/api/v1/automation/overview`); const data = await response.json(); if (!response.ok) throw new Error(data.detail || "任务加载失败"); const tasks = data.tasks || []; rows.innerHTML = tasks.length ? tasks.map(task => `<tr><td>${escapeHtml(task.name || `任务 #${task.id}`)}</td><td>${escapeHtml(task.status || "-")}</td><td>${escapeHtml(task.schedule_time || "-")}</td></tr>`).join("") : '<tr><td colspan="3" class="muted">暂无采集任务</td></tr>'; $("#automation-task-count").textContent = `${tasks.length} 个任务`; } catch (error) { rows.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(error.message || "任务加载失败")}</td></tr>`; }
}
async function validateListing(draftId) { const shopId = $("#shop-filter").value; try { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/listing-drafts/${draftId}/validate`, { method: "POST" }); const result = await response.json(); if (!response.ok) throw new Error(result.detail || "预检失败"); await loadListingDrafts(); const riskCodes = result.risk_codes || []; const riskMsg = riskCodes.length ? ` 风险码: ${riskCodes.join(", ")}` : ""; toast(result.issues.length ? `预检发现 ${result.issues.length} 项问题，请修正后再审批。${riskMsg}` : `预检通过：已完成 CNY 核价。${riskMsg || "无风险"}`, result.issues.length > 0 || riskCodes.length > 0); } catch (error) { toast(error.message || "预检失败", true); } }
async function saveListingDraft(event) { event.preventDefault(); const shopId = $("#shop-filter").value; if (!shopId) { toast("请先选择一个店铺。", true); return; } if ($("#listing-category").dataset.shopId !== shopId) { toast("店铺已切换，请重新打开草稿并选择类目。", true); return; } const controls = [...event.target.querySelectorAll("[data-listing-attribute]")]; const entries = []; for (const control of controls) { let valueId = ""; let value = control.value; if (control.dataset.attributeKind === "dictionary") { const list = document.getElementById(control.getAttribute("list")); const option = [...(list?.options || [])].find(item => item.value === control.value); valueId = option?.dataset.valueId || ""; value = option?.dataset.valueText || ""; if (control.required && !valueId) { control.setCustomValidity("请输入至少 2 个字，并从 Ozon 搜索结果中选择"); control.reportValidity(); return; } } entries.push({ attributeId: control.dataset.listingAttribute, name: control.dataset.attributeName, kind: control.dataset.attributeKind, value, valueId }); } const data = Object.fromEntries(new FormData(event.target)); const [categoryId, typeId] = String(data.category_choice || "").split(":"); const payload = { offer_id: data.offer_id, title: data.title, category_id: categoryId, type_id: typeId, primary_image_url: data.primary_image_url, attributes: window.ListingAttributes.attributePayloadFromEntries(entries), variants: [{ seller_sku: data.seller_sku, purchase_cost_cny: Number(data.purchase_cost_cny), weight_g: Number(data.weight_g), length_mm: Number(data.length_mm), width_mm: Number(data.width_mm), height_mm: Number(data.height_mm) }] }; try { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/listing-drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error((await response.json()).detail || "草稿保存失败"); $("#listing-dialog").close(); event.target.reset(); $("#listing-required-attributes").innerHTML = '<span class="listing-attribute-title">选择类目后填写 Ozon 必填属性</span>'; await loadListingDrafts(); toast("草稿与 Ozon 属性已保存；请执行预检后再进入审批。 "); } catch (error) { toast(error.message || "草稿保存失败", true); } }
async function runReadOnlySync() { const shopId = $("#shop-filter").value; if (!shopId) { toast("请先在顶部选择一个店铺。", true); return; } const now = new Date(); const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); const requests = [{ path: "products", payload: { limit: 100, last_id: "" } }, { path: "fbs-postings", payload: { since: since.toISOString(), to: now.toISOString(), limit: 100, offset: 0, status: "" } }, { path: "fbs-product-images", payload: null }]; try { $("#run-sync").disabled = true; $("#sync-button").disabled = true; toast("正在只读同步商品、图片和近 7 天 FBS 订单…"); for (const request of requests) { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}/sync/${request.path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: request.payload ? JSON.stringify(request.payload) : undefined }); if (!response.ok) throw new Error((await response.json()).detail || "同步失败"); } await Promise.all([loadSyncRuns(), loadOperationalData()]); toast("只读同步已完成。 "); } catch (error) { await loadSyncRuns(); toast(error.message || "同步失败，请查看同步记录。", true); } finally { $("#run-sync").disabled = false; $("#sync-button").disabled = false; } }
async function saveShop(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); const shopPayload = { name: data.name, manager_name: data.manager_name || null, legal_entity: data.legal_entity || null, currency: "CNY" }; const credentialPayload = { client_id: data.client_id, api_key: data.api_key, key_label: data.key_label || null }; let createdShop; try { const shopResponse = await fetch(`${apiBase}/api/v1/shops`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shopPayload) }); if (!shopResponse.ok) throw new Error((await shopResponse.json()).detail || "店铺保存失败"); createdShop = await shopResponse.json(); const credentialResponse = await fetch(`${apiBase}/api/v1/shops/${createdShop.id}/credentials/ozon`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentialPayload) }); if (!credentialResponse.ok) throw new Error((await credentialResponse.json()).detail || "授权保存失败"); $("#shop-dialog").close(); event.target.reset(); await loadShops(); toast("店铺已接入，下一步可配置仓库并执行只读同步。"); } catch (error) { if (createdShop) await fetch(`${apiBase}/api/v1/shops/${createdShop.id}`, { method: "DELETE" }).catch(() => {}); toast(error.message || "保存失败", true); } }
async function deleteShop(shopId, shopName) { if (!window.confirm(`确认删除未完成店铺“${shopName}”？\n已同步的订单和审计数据不可删除。`)) return; try { const response = await fetch(`${apiBase}/api/v1/shops/${shopId}`, { method: "DELETE" }); if (!response.ok) throw new Error((await response.json()).detail || "删除失败"); await loadShops(); toast(`店铺“${shopName}”已删除。`); } catch (error) { toast(error.message || "删除失败", true); } }
function viewFromHash() {
  const view = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (!view) return "dashboard";
  return document.querySelector(`.view#${CSS.escape(view)}`) ? view : "dashboard";
}
document.querySelectorAll("#nav button").forEach(button => button.addEventListener("click", () => {
  const view = button.dataset.view;
  if (location.hash !== `#${view}`) location.hash = view;
  else setView(view);
}));
window.addEventListener("hashchange", () => setView(viewFromHash()));
document.querySelectorAll(".open-shops").forEach(button => button.addEventListener("click", () => setView("shops")));
$("#add-shop").addEventListener("click", () => $("#shop-dialog").showModal()); $("#primary-action").addEventListener("click", () => $("#shop-dialog").showModal()); $("#shop-form").addEventListener("submit", saveShop); $("#shop-search").addEventListener("input", renderShops); $("#shop-filter").addEventListener("change", () => { listingCategoryRequests.invalidate(); listingAttributeRequests.invalidate(); const select = $("#listing-category"); if (select) { select.dataset.shopId = ""; select.innerHTML = '<option value="">店铺已切换，请重新加载类目</option>'; } activateCurrentView(); }); $("#sync-button").addEventListener("click", runReadOnlySync); $("#run-sync").addEventListener("click", runReadOnlySync); $("#close-order-drawer").addEventListener("click", () => { $("#order-drawer").classList.remove("open"); $("#order-drawer").setAttribute("aria-hidden", "true"); });
$("#operation-logs-refresh")?.addEventListener("click", loadOperationLogs);
$("#operation-log-shop")?.addEventListener("change", loadOperationLogs);
$("#operation-log-action")?.addEventListener("keydown", event => { if (event.key === "Enter") loadOperationLogs(); });
const addListingButton = $("#add-listing");
if (addListingButton) addListingButton.addEventListener("click", async () => { if (!$("#shop-filter").value) { toast("请先选择一个店铺。", true); return; } await loadListingCategories(); $("#listing-dialog").showModal(); });
const listingForm = $("#listing-form");
if (listingForm) listingForm.addEventListener("submit", saveListingDraft);
const pricingPolicyForm = $("#pricing-policy-form");
if (pricingPolicyForm) pricingPolicyForm.addEventListener("submit", savePricingPolicy);
const yunniudunTokenForm = $("#yunniudun-token-form");
if (yunniudunTokenForm) yunniudunTokenForm.addEventListener("submit", saveYunNewtonAccessToken);
const yunniudunValidateButton = $("#yunniudun-validate");
if (yunniudunValidateButton) yunniudunValidateButton.addEventListener("click", validateYunNewtonAccessToken);
const yunniudunSupplementForm = $("#yunniudun-supplement-form");
if (yunniudunSupplementForm) yunniudunSupplementForm.addEventListener("submit", createYunNewtonSupplement);
$("#yunniudun-supplement-rows")?.addEventListener("click", event => { const start = event.target.closest(".yunniudun-start"); if (start) return startYunNewtonSupplement(Number(start.dataset.jobId), start); const poll = event.target.closest(".yunniudun-poll"); if (poll) pollYunNewtonSupplement(Number(poll.dataset.jobId), poll); });
bindJxhyControls();
$("#open1688-form")?.addEventListener("submit", saveOpen1688Application);
$("#intelligent-title-credentials")?.addEventListener("submit", saveIntelligentTitleCredentials);
$("#intelligent-title-refresh")?.addEventListener("click", loadIntelligentTitleStatus);
$("#intelligent-title-authorize")?.addEventListener("click", openIntelligentTitleAuthorization);
$("#intelligent-title-exchange")?.addEventListener("click", exchangeIntelligentTitleToken);
$("#auth-open1688-configure")?.addEventListener("click", () => $("#open1688-dialog")?.showModal());
$("#auth-yunniudun-open")?.addEventListener("click", () => { if (location.hash !== "#yunniudun") location.hash = "yunniudun"; else setView("yunniudun"); });
$("#open1688-exchange")?.addEventListener("click", exchangeOpen1688Token);
$("#open1688-close")?.addEventListener("click", () => $("#open1688-dialog")?.close());
const pricingTestButton = $("#pricing-test-button");
if (pricingTestButton) pricingTestButton.addEventListener("click", runPricingSimulator);
document.querySelectorAll("[data-order-filter]").forEach(button => button.addEventListener("click", () => { activeOrderFilter = button.dataset.orderFilter; document.querySelectorAll("[data-order-filter]").forEach(tab => tab.classList.toggle("active", tab === button)); renderPostingRows(); }));
const candidateRefresh = $("#candidate-refresh");
if (candidateRefresh) candidateRefresh.addEventListener("click", () => loadCandidatePool());
const candidateSearch = $("#candidate-search");
if (candidateSearch) candidateSearch.addEventListener("click", () => { candidateState.page = 1; candidateState.selected.clear(); loadCandidatePool(); });
const candidateStatus = $("#candidate-status");
if (candidateStatus) candidateStatus.addEventListener("change", () => { candidateState.page = 1; candidateState.selected.clear(); loadCandidatePool(); });
const candidateReviewLevel = $("#candidate-review-level");
if (candidateReviewLevel) candidateReviewLevel.addEventListener("change", () => { candidateState.selected.clear(); renderCandidateRows(); });
const candidateSelectAll = $("#candidate-select-all");
if (candidateSelectAll) candidateSelectAll.addEventListener("change", () => { candidateState.items.forEach(item => candidateSelectAll.checked ? candidateState.selected.add(item.id) : candidateState.selected.delete(item.id)); renderCandidateRows(); });
const candidatePrev = $("#candidate-prev");
if (candidatePrev) candidatePrev.addEventListener("click", () => { if (candidateState.page > 1) { candidateState.page -= 1; loadCandidatePool(); } });
const candidateNext = $("#candidate-next");
if (candidateNext) candidateNext.addEventListener("click", () => { candidateState.page += 1; loadCandidatePool(); });
const candidateBatchAi = $("#candidate-batch-ai");
if (candidateBatchAi) candidateBatchAi.addEventListener("click", applyCandidateBatchSample);
const candidateSetSample = $("#candidate-set-sample");
if (candidateSetSample) candidateSetSample.addEventListener("click", setCandidateBatchSample);
const bulkListingCreate = $("#bulk-listing-create");
if (bulkListingCreate) bulkListingCreate.addEventListener("click", openBulkBatchDialog);
$("#bulk-listing-refresh")?.addEventListener("click", loadBulkListingBatches);
$("#bulk-detail-refresh")?.addEventListener("click", () => { if (bulkTaskState.batchId) showBulkTaskDetail(bulkTaskState.batchId); });
$("#bulk-item-status-filter")?.addEventListener("change", event => { bulkTaskState.statusFilter = event.target.value; renderBulkTaskItems(); });
$("#bulk-item-time-sort")?.addEventListener("change", event => { bulkTaskState.timeSort = event.target.value === "asc" ? "asc" : "desc"; renderBulkTaskItems(); });
$("#bulk-item-shop-filter-options")?.addEventListener("change", event => {
  const option = event.target.closest(".bulk-item-shop-option");
  if (!option) return;
  const allShopIds = [...new Set(bulkTaskState.items.map(item => Number(item.assigned_shop_id)).filter(Boolean))];
  const next = new Set([...document.querySelectorAll(".bulk-item-shop-option:checked")].map(box => Number(box.value)));
  bulkTaskState.shopIds = next.size === allShopIds.length ? new Set() : next;
  renderBulkTaskItems();
});
$("#bulk-retry-selected")?.addEventListener("click", retrySelectedBulkItems);
$("#bulk-detail-select-all")?.addEventListener("change", event => setBulkVisibleSelection(event.target.checked));
$("#bulk-detail-select-all-head")?.addEventListener("change", event => setBulkVisibleSelection(event.target.checked));
$("#bulk-listing-rows")?.addEventListener("click", event => { const detail = event.target.closest(".bulk-task-detail"); if (detail) return showBulkTaskDetail(Number(detail.dataset.id)); const pause = event.target.closest(".bulk-task-pause"); if (pause) return pauseBulkTask(Number(pause.dataset.id), pause); const execute = event.target.closest(".bulk-task-execute"); if (execute) return executeBulkTask(Number(execute.dataset.id), execute); const start = event.target.closest(".bulk-task-start"); if (start) startBulkTask(Number(start.dataset.id)); });
$("#bulk-task-detail-rows")?.addEventListener("click", event => {
  const checkbox = event.target.closest(".bulk-detail-select");
  if (checkbox) { checkbox.checked ? bulkTaskState.selected.add(Number(checkbox.dataset.itemId)) : bulkTaskState.selected.delete(Number(checkbox.dataset.itemId)); updateBulkRetrySelection(); return; }
  const ocr = event.target.closest(".bulk-ocr-review");
  if (ocr) return openBulkOcrReview(Number(ocr.dataset.batchId), Number(ocr.dataset.itemId));
  const retry = event.target.closest(".bulk-item-retry");
  if (retry) return retryBulkItem(Number(retry.dataset.batchId), Number(retry.dataset.itemId), retry);
  const skip = event.target.closest(".bulk-item-skip");
  if (skip) return skipBulkItem(Number(skip.dataset.batchId), Number(skip.dataset.itemId), skip);
});
$("#approval-refresh")?.addEventListener("click", loadApprovalCenter);
$("#approval-rows")?.addEventListener("click", event => { const approve=event.target.closest(".approval-approve"); if (approve) return approveExistingBatch(Number(approve.dataset.id)); const submit=event.target.closest(".approval-submit"); if (submit) submitApprovalBatch(Number(submit.dataset.id),Number(submit.dataset.count),submit.dataset.quota || "未知"); });
const bulkBatchForm = $("#bulk-batch-form");
if (bulkBatchForm) bulkBatchForm.addEventListener("submit", createBulkListingBatch);
$("#bulk-batch-source")?.addEventListener("change", refreshBulkBatchPreview);
$("#bulk-batch-shops")?.addEventListener("change", loadBulkBatchCategories);
$("#bulk-batch-autofill")?.addEventListener("click", autofillBulkBatchAttributes);
$("#bulk-batch-category-search")?.addEventListener("focus", () => loadBulkBatchCategories());
$("#bulk-batch-category-search")?.addEventListener("input", () => {
  $("#bulk-batch-category").value = "";
  $("#bulk-batch-attributes").innerHTML = '<span class="muted">请从分类候选中确认后加载属性</span>';
  clearTimeout(bulkCategoryTimer); bulkCategoryTimer = setTimeout(loadBulkBatchCategories, 300);
});
$("#bulk-batch-category-menu")?.addEventListener("mousedown", event => event.preventDefault());
$("#bulk-batch-category-menu")?.addEventListener("click", async event => {
  const option = event.target.closest("button[data-category-pair]");
  if (!option) return;
  $("#bulk-batch-category").value = option.dataset.categoryPair || "";
  $("#bulk-batch-category-search").value = option.dataset.categoryLabel || "";
  $("#bulk-batch-category-menu").hidden = true;
  await loadBulkBatchAttributes();
});
$("#bulk-batch-category-search")?.addEventListener("blur", () => setTimeout(() => { $("#bulk-batch-category-menu").hidden = true; }, 120));
$("#bulk-batch-close")?.addEventListener("click", () => $("#bulk-batch-dialog").close());
$("#bulk-batch-cancel")?.addEventListener("click", () => $("#bulk-batch-dialog").close());
$("#bulk-batch-form")?.querySelector('[name="pricing_mode_system"]')?.addEventListener("change", syncBulkPricingFields);
$("#bulk-save-template")?.addEventListener("click", saveBulkTemplate);
$("#bulk-template-select")?.addEventListener("change", e => loadBulkTemplateIntoForm(e.target.value));
$("#bulk-delete-template")?.addEventListener("click", deleteBulkTemplate);
const candidateSelectGreen = $("#candidate-select-green");
if (candidateSelectGreen) candidateSelectGreen.addEventListener("click", () => {
  candidateState.items.filter(item => item.review_level === "green").forEach(item => candidateState.selected.add(item.id));
  renderCandidateRows();
  toast(candidateState.selected.size ? `已选择本页 ${candidateState.selected.size} 个绿色商品` : "本页暂无满足硬门禁的绿色商品", candidateState.selected.size === 0);
});
const candidateOnlyExceptions = $("#candidate-only-exceptions");
if (candidateOnlyExceptions) candidateOnlyExceptions.addEventListener("change", () => {
  if (!candidateOnlyExceptions.checked) { loadCandidatePool(); return; }
  const exceptionStatuses = new Set(["needs_review", "ai_failed", "publish_failed", "package_pending"]);
  candidateState.items = candidateState.items.filter(item => exceptionStatuses.has(item.status) || item.reason);
  candidateState.selected.clear(); renderCandidateRows();
});
$("#sync-button").textContent = "↻ 强制校正"; $("#run-sync").textContent = "↻ 强制完整校正"; // 全局图片预览（点击 .cb-thumb 显示大图，点空白关闭）
(function () {
  function openImage(src) {
    const modal = document.getElementById("image-modal");
    const img = document.getElementById("image-modal-img");
    if (!modal || !img || !src) return;
    img.src = src;
    modal.style.display = "grid";
  }
  function closeImage() {
    const modal = document.getElementById("image-modal");
    const img = document.getElementById("image-modal-img");
    if (!modal) return;
    modal.style.display = "none";
    if (img) img.src = "";
  }
  document.addEventListener("click", function (e) {
    const preview = e.target.closest && e.target.closest("[data-image-preview]");
    if (preview && preview.dataset && preview.dataset.imagePreview) {
      e.preventDefault();
      e.stopPropagation();
      openImage(preview.dataset.imagePreview);
      return;
    }
    const thumb = e.target.closest && e.target.closest(".cb-thumb");
    if (thumb && thumb.dataset && thumb.dataset.src) {
      e.preventDefault();
      e.stopPropagation();
      openImage(thumb.dataset.src);
      return;
    }
    const modal = document.getElementById("image-modal");
    if (modal && modal.style.display === "grid") {
      if (e.target === modal || e.target.id === "image-modal-img") closeImage();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeImage();
  });
})();
installCategorySelector(); loadShops(); setView(viewFromHash());
