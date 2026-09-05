/* v4 - combobox + tree browser with search + match history */
"use strict";
const API_BASE = window.ERP_API_BASE || `http://${location.hostname || "127.0.0.1"}:8000`;
const state = { shopId: null, categoryId: null, typeId: null, attributes: [], attributeOptionsCache: {}, attrValues: {}, attributeLoadToken: 0, images: [], variants: [], variantDimensions: [], sourceProduct: null, sourceSkuImageUrls: new Set(), draftId: null, isSubmitted: false, lastImportTaskId: null, editorDirty: false, editorQueue: [], categorySearchTimer: null, dictSearchTimers: {}, richContentCompact: null, richContentAuto: false, contentGenerationPromise: null, selectedImages: new Set(), translatedImageCache: {}, listingTemplates: [], learningAttributeIds: new Set(), aiImageJob: null, selectedAiImages: new Set(), selectedAiJobId: null, aiCreativeGroupKey: "__product__", skuImageUrls: new Set(), watermark: { enabled: false, image_data_url: "", position: "br", scale: 1, opacity: 0.65 } };

function skuImageUrlSet() {
  const urls = new Set(state.sourceSkuImageUrls || []);
  // Without a source snapshot, only treat a variant URL as SKU-owned when it
  // is not present in the persisted public gallery. This avoids removing a
  // public image merely because it was selected as one SKU's primary image.
  if (!urls.size) (state.variants || []).forEach(v => {
    if (v?.image_url && !(state.images || []).includes(String(v.image_url))) urls.add(String(v.image_url));
  });
  return urls;
}

function separateSkuImagesFromGallery() {
  const skuUrls = skuImageUrlSet();
  state.skuImageUrls = skuUrls;
  if (skuUrls.size) state.images = (state.images || []).filter(url => !skuUrls.has(String(url)));
}

function publicGalleryImages() {
  const skuUrls = skuImageUrlSet();
  return (state.images || []).filter(url => url && !skuUrls.has(String(url)));
}

function variantProductImages(variantIdx) {
  const variant = state.variants?.[variantIdx] || {};
  if (Array.isArray(variant.image_urls)) {
    return [...new Set(variant.image_urls.map(url => String(url || "").trim()).filter(Boolean))];
  }
  const skuUrl = String(variant.image_url || "").trim();
  // Product image per SKU: Ozon distinguishes a colour/SKU image from the
  // public gallery precisely because each SKU's picture is unique (e.g. 10
  // sizes => 10 annotated photos). Appending the shared public gallery here
  // made every SKU show the same ~13 images, which loses SKU distinction.
  // Show the SKU's own image; the public gallery lives in the product-level
  // image library (step 6), not on every variant row.
  return skuUrl ? [skuUrl] : publicGalleryImages();
}

function variantImageChoices(variantIdx) {
  const variant = state.variants?.[variantIdx] || {};
  const skuUrl = String(variant.image_url || "").trim();
  return [...new Set([skuUrl, ...publicGalleryImages()].filter(Boolean))];
}
const WATERMARK_PRESET_KEY = "ozon-erp.watermark-preset.v1";

function watermarkPresetStore() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open("ozon-erp-settings", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("presets");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}
async function loadWatermarkPreset() {
  try {
    const db = await watermarkPresetStore();
    const preset = await new Promise((resolve, reject) => { const tx = db.transaction("presets", "readonly"); const req = tx.objectStore("presets").get(WATERMARK_PRESET_KEY); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    db.close();
    if (preset && typeof preset === "object") state.watermark = { ...state.watermark, ...preset };
  } catch (_) {
    try { const raw = localStorage.getItem(WATERMARK_PRESET_KEY); if (raw) state.watermark = { ...state.watermark, ...JSON.parse(raw) }; } catch (_) { /* keep defaults */ }
  }
}
async function saveWatermarkPreset() {
  try {
    const db = await watermarkPresetStore();
    await new Promise((resolve, reject) => { const tx = db.transaction("presets", "readwrite"); tx.objectStore("presets").put({ ...state.watermark }, WATERMARK_PRESET_KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  } catch (_) {
    try { localStorage.setItem(WATERMARK_PRESET_KEY, JSON.stringify(state.watermark)); } catch (_) { /* draft persistence still works */ }
  }
}
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
function toast(msg, type = "") { const el = $("#le-toast"); el.textContent = msg; el.className = "show " + type; setTimeout(() => (el.className = ""), 3000); }
const EDITOR_RETURN_VIEWS = new Set(["collection-box", "automation", "candidate-pool", "bulk-listing", "approval-center", "listing", "jxhy"]);
function configureEditorBackLink() {
  const requested = new URLSearchParams(location.search).get("returnTo") || "collection-box";
  const view = EDITOR_RETURN_VIEWS.has(requested) ? requested : "collection-box";
  const labels = { "collection-box": "采集箱", automation: "自动上品", "candidate-pool": "候选商品", "bulk-listing": "批量刊登", "approval-center": "审批发布", listing: "商品上架", jxhy: "1688 严选" };
  const href = `./index.html#${view}`;
  $$(".le-back, .le-btn-back").forEach(link => { link.href = href; link.textContent = `← 返回${labels[view]}`; });
}
function apiErrorText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(apiErrorText).filter(Boolean).join("；");
  if (typeof value === "object") {
    const nested = value.message ?? value.detail ?? value.error ?? value.msg;
    if (nested != null) return apiErrorText(nested);
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }
  return String(value);
}
async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, opts);
  } catch (error) {
    throw new Error(`ERP 后端暂时无法连接（${API_BASE}）。请稍后重试；本次没有提交 Ozon。`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`);
    throw new Error(`接口返回不是有效的 JSON: ${text.slice(0, 120) || "(空响应)"}`);
  }
  if (!res.ok) throw new Error(apiErrorText(data.detail) || `HTTP ${res.status}`);
  return data;
}

const OZON_OFFER_ID_MAX_LENGTH = 50;
function offerIdHash(value) {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function normalizeOfferId(value) {
  const cleaned = String(value || "").trim().replace(/\s+/g, "_");
  if (cleaned.length <= OZON_OFFER_ID_MAX_LENGTH) return cleaned;
  const digest = offerIdHash(cleaned);
  return `${cleaned.slice(0, OZON_OFFER_ID_MAX_LENGTH - digest.length - 1).replace(/[-_.]+$/, "")}-${digest}`;
}

async function loadShops() {
  try {
    const shops = await api("GET", "/api/v1/shops");
    const sel = $("#le-shop-select");
    sel.innerHTML = '<option value="">选择店铺</option>' + shops.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    const urlShop = new URLSearchParams(location.search).get("shop");
    if (urlShop && shops.some((s) => String(s.id) === urlShop)) sel.value = urlShop;
  } catch (e) {
    toast(`店铺加载失败：${e.message}`, "error");
  }
}

function renderListingTemplates() {
  const select = $("#le-template-select");
  if (!select) return;
  select.innerHTML = '<option value="">选择上品模板</option>' + state.listingTemplates.map((template) =>
    `<option value="${template.id}">${esc(template.name)}</option>`
  ).join("");
}

async function loadListingTemplates() {
  if (!state.shopId) { state.listingTemplates = []; renderListingTemplates(); return; }
  try {
    state.listingTemplates = await api("GET", `/api/v1/shops/${state.shopId}/listing-templates`);
    renderListingTemplates();
  } catch (e) { toast("模板加载失败: " + e.message, "error"); }
}

async function saveListingTemplate() {
  if (!state.shopId || !state.categoryId || !state.typeId) { toast("请先选择 Ozon 类目后再存模板", "error"); return; }
  const name = window.prompt("模板名称（例如：硅胶模具通用模板）");
  if (!name || !name.trim()) return;
  const selectedIds = new Set(state.learningAttributeIds);
  const attributes = collectAttributePayload().filter((attr) => selectedIds.has(String(attr.attribute_id)));
  if (!attributes.length && !$("#le-template-description")?.checked) { toast("请先勾选需要保存到模板的属性", "error"); return; }
  const includeDescription = Boolean($("#le-template-description")?.checked);
  try {
    const saved = await api("POST", `/api/v1/shops/${state.shopId}/listing-templates`, {
      name: name.trim(), category_id: state.categoryId, type_id: state.typeId,
      attributes, description: includeDescription ? ($("#le-description").value || null) : null,
    });
    state.listingTemplates.push(saved);
    state.listingTemplates.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    renderListingTemplates();
    $("#le-template-select").value = String(saved.id);
    toast(`模板已保存：${saved.name}（${attributes.length} 个属性${includeDescription ? " + 描述" : ""}）`, "success");
  } catch (e) { toast("保存模板失败: " + e.message, "error"); }
}

async function applyListingTemplate() {
  const templateId = $("#le-template-select").value;
  const template = state.listingTemplates.find((item) => String(item.id) === String(templateId));
  if (!template) { toast("请先选择模板", "error"); return; }
  try {
    const categories = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories`);
    const category = categories.find((item) => String(item.category_id) === String(template.category_id) && String(item.type_id) === String(template.type_id));
    state.categoryId = String(template.category_id);
    state.typeId = String(template.type_id);
    state.learningAttributeIds = new Set((template.attributes || []).map((attr) => String(attr.attribute_id)));
    // The category API defines the complete form. A template owns only the
    // non-empty fixed values it saved; automatic matching fills the other blanks.
    state.attrValues = Object.fromEntries((template.attributes || []).filter((attr) => attr.value_text).map((attr) => [String(attr.attribute_id), {
      value_id: attr.value_id || null, value_text: attr.value_text || "", method: "template",
    }]));
    const title = category?.title_zh || category?.title || `模板类目 ${template.category_id}`;
    $("#le-category-search").value = title;
    $("#le-category-path").textContent = `已套用模板类目: ${title} (ID: ${template.category_id}, Type: ${template.type_id})`;
    $("#le-template-description").checked = Boolean(template.description);
    if (template.description) $("#le-description").value = template.description;
    await loadAttributes({ autoFill: false });
    const templateValueCount = Object.keys(state.attrValues).length;
    await autoFillFromAPI({ quiet: true });
    autoFillDefaults();
    await autoGenerateHashtags();
    generateRichContentAuto();
    renderAttributes();
    toast(`已套用模板：固定 ${templateValueCount} 项，其余空属性已继续自动匹配`, "success");
  } catch (e) { toast("套用模板失败: " + e.message, "error"); }
}

async function onShopChange() {
  state.shopId = $("#le-shop-select").value;
  if (!state.shopId) return;
  state.categoryId = null; state.typeId = null; state.attributes = []; state.attrValues = {};
  $("#le-category-search").value = ""; $("#le-category-dropdown").innerHTML = ""; $("#le-category-dropdown").style.display = "none";
  $("#le-category-path").textContent = "未选择类目"; $("#le-category-suggestions").innerHTML = "";
  renderAttributes();
  const hasDraftInUrl = new URLSearchParams(window.location.search).has("draft");
  const tasks = [loadSourceProductsList(), loadListingTemplates()];
  // Existing drafts already own a stable Offer ID. A late next-ID response
  // must never overwrite the draft that is loading after a queue switch.
  if (!hasDraftInUrl) tasks.push(autoGenerateOfferId());
  await Promise.all(tasks);
}

async function autoGenerateOfferId() {
  if (!state.shopId) return;
  try {
    const r = await api("GET", `/api/v1/shops/${state.shopId}/next-offer-id`);
    $("#le-offer-id").value = r.offer_id;
  } catch (_) {}
}

let categoryMatchTimer = null;
let manualCategorySelection = false;
let categoryMatchRequestId = 0;
async function autoMatchCategories() {
  if (manualCategorySelection) return;
  const rawTitle = state.sourceProduct?.title || $("#le-title").value;
  const title = rawTitle ? cleanSourceTitle(rawTitle) : $("#le-title").value;
  if (!title || title.length < 4) return;
  clearTimeout(categoryMatchTimer);
  categoryMatchTimer = setTimeout(async () => {
    if (manualCategorySelection) return;
    const container = $("#le-category-suggestions");
    container.innerHTML = '<small class="le-hint"><span class="le-loading"></span> 正在自动匹配类目...</small>';
    const requestId = ++categoryMatchRequestId;
    try {
      const r = await api("POST", `/api/v1/shops/${state.shopId}/ai/match-category`, { title, material: state.sourceProduct?.material || "", brand: state.sourceProduct?.brand || "", source_product_id: state.sourceProduct?.id || null });
      if (manualCategorySelection || requestId !== categoryMatchRequestId) return;
      renderCategorySuggestions(r.candidates || r);
    } catch (e) { container.innerHTML = `<small class="le-hint" style="color:var(--le-danger)">匹配失败: ${esc(e.message)}</small>`; }
  }, 500);
}

function renderCategorySuggestions(candidates) {
  const container = $("#le-category-suggestions");
  if (!candidates.length) { container.innerHTML = '<small class="le-hint">未找到匹配类目，请手动搜索或点击🗂浏览类目树。</small>'; return; }
  const label = candidates[0]?.source === "trusted_memory" ? "可信记忆推荐" : (candidates[0]?.source === "ai_rerank" ? "AI 理解排序" : "自动匹配");
  container.innerHTML = '<small class="le-hint" style="margin-bottom:6px">' + label + '结果（已选第一个，可点击切换）：</small>' +
    candidates.map((c, i) => `<div class="le-cat-suggestion ${i === 0 ? "selected" : ""}" data-cat-id="${esc(c.category_id)}" data-type-id="${esc(c.type_id)}" data-title="${esc(c.title_zh || c.title)}"><span>${i === 0 ? "★ " : ""}${esc(c.title_zh || c.title)}</span><span class="le-cat-score">${i === 0 ? '<span class="le-cat-badge">已选</span>' : "评分 " + c.score}</span></div>`).join("");
  $$(".le-cat-suggestion").forEach((el) => { el.addEventListener("click", () => { $$(".le-cat-suggestion").forEach((e) => e.classList.remove("selected")); el.classList.add("selected"); selectCategory(el.dataset.catId, el.dataset.typeId, el.dataset.title); }); });
  if (candidates[0]) selectCategory(candidates[0].category_id, candidates[0].type_id, candidates[0].title_zh || candidates[0].title, false);
}

let categoryDropdownOpen = false; let categoryAllItems = [];
function toggleCategoryDropdown() { const d = $("#le-category-dropdown"); if (categoryDropdownOpen) { d.style.display = "none"; categoryDropdownOpen = false; return; } d.style.display = "block"; categoryDropdownOpen = true; if (!d.innerHTML.trim()) loadAllCategories(); }
async function loadAllCategories() { if (!state.shopId) return; const d = $("#le-category-dropdown"); d.innerHTML = '<div class="le-combobox-empty"><span class="le-loading"></span> 加载类目...</div>'; try { const cats = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories`); categoryAllItems = cats; renderCategoryDropdown(cats.slice(0, 100)); } catch (e) { d.innerHTML = `<div class="le-combobox-empty">加载失败: ${esc(e.message)}</div>`; } }
let _catSearchAbort = null; const _catSearchCache = new Map();
async function searchCategories(query) {
  if (!state.shopId) return;
  const d = $("#le-category-dropdown");
  d.style.display = "block"; categoryDropdownOpen = true;
  if (!query) { renderCategoryDropdown(categoryAllItems.slice(0, 100)); return; }
  // Check local cache first (case-insensitive)
  const cacheKey = state.shopId + ":" + query.trim().toLowerCase();
  if (_catSearchCache.has(cacheKey)) { renderCategoryDropdown(_catSearchCache.get(cacheKey)); return; }
  // Abort previous in-flight request to avoid race conditions
  if (_catSearchAbort) { _catSearchAbort.abort(); }
  _catSearchAbort = new AbortController();
  const signal = _catSearchAbort.signal;
  try {
    const res = await fetch(`${API_BASE}/api/v1/shops/${state.shopId}/metadata/categories?query=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cats = await res.json();
    _catSearchCache.set(cacheKey, cats);
    renderCategoryDropdown(cats.slice(0, 80));
    if (!cats.length) {
      d.insertAdjacentHTML("afterbegin", `<div style="padding:6px;font-size:11px;color:#999;border-bottom:1px solid #eee">无匹配结果，试试其他关键词或使用「类目树」浏览</div>`);
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    d.innerHTML = `<div class="le-combobox-empty">搜索失败: ${esc(e.message)}</div>`;
  } finally {
    if (_catSearchAbort && _catSearchAbort.signal === signal) { _catSearchAbort = null; }
  }
}
function renderCategoryDropdown(cats) { const d = $("#le-category-dropdown"); if (!cats.length) { d.innerHTML = '<div class="le-combobox-empty">无匹配类目</div>'; return; } d.innerHTML = cats.map((c) => `<div class="le-combobox-option" data-cat-id="${esc(c.category_id)}" data-type-id="${esc(c.type_id)}" data-title="${esc(c.title_zh || c.title)}"><span class="le-cat-zh">${esc(c.title_zh || c.title)}</span>${c.title && c.title_zh ? `<span class="le-cat-ru">${esc(c.title)}</span>` : ""}</div>`).join(""); $$(".le-combobox-option").forEach((el) => { el.addEventListener("click", () => selectCategory(el.dataset.catId, el.dataset.typeId, el.dataset.title)); }); }
function selectCategory(catId, typeId, title, userSelected = true) {
  const changed = Boolean(state.categoryId && (String(state.categoryId) !== String(catId) || String(state.typeId) !== String(typeId)));
  const isManualChange = changed;
  if (changed) {
    // Values belong to an exact Ozon category/type pair. Never carry a text
    // placeholder or dictionary ID from the old category into the new form.
    state.attrValues = {};
    state.attributes = [];
    state.variantDimensions = [];
    state.learningAttributeIds.clear();
    state.colorOptionsCache = {};
    state.attributeLoadToken += 1;
  }
  state.categoryId = catId; state.typeId = typeId; state.categoryTitle = title;
  $("#le-category-search").value = title; $("#le-category-path").textContent = `已选: ${title} (ID: ${catId}, Type: ${typeId})`;
  $("#le-category-dropdown").style.display = "none"; categoryDropdownOpen = false;
  if (userSelected) { manualCategorySelection = true; categoryMatchRequestId += 1; clearTimeout(categoryMatchTimer); $("#le-category-suggestions").innerHTML = ""; }
  loadAttributes();
  if (userSelected) showCategoryLearningPanel(isManualChange);
}

async function hydrateSavedCategoryLabel(categoryId, typeId) {
  const fallback = `已选类目 (ID: ${categoryId}, Type: ${typeId})`;
  let title = "";
  try {
    const categories = await api(
      "GET",
      `/api/v1/shops/${state.shopId}/metadata/categories?category_id=${encodeURIComponent(categoryId)}&type_id=${encodeURIComponent(typeId)}&limit=1`,
    );
    const category = categories[0];
    title = category?.title_zh || category?.title || "";
  } catch (_) {
    // Keep the saved IDs visible even if the local metadata cache is briefly unavailable.
  }
  state.categoryTitle = title || "";
  $("#le-category-search").value = title || `类目 ${categoryId}`;
  $("#le-category-path").textContent = title
    ? `已选: ${title} (ID: ${categoryId}, Type: ${typeId})`
    : fallback;
}

  state.colorOptionsCache = {}; // Clear color cache on category change
let categoryTree = null; let treePath = [];
async function openTreeBrowser() {
  $("#le-tree-modal").style.display = "flex"; treePath = [];
  if (!categoryTree) {
    $("#le-tree-content").innerHTML = '<div class="le-tree-loading"><span class="le-loading"></span> 正在加载类目树...</div>';
    try { categoryTree = await api("GET", `/api/v1/shops/${state.shopId}/metadata/category-tree`); }
    catch (e) { $("#le-tree-content").innerHTML = `<div class="le-tree-error">加载失败: ${esc(e.message)}</div>`; return; }
  }
  renderTreeLevel(categoryTree);
}
function closeTreeBrowser() { $("#le-tree-modal").style.display = "none"; }

function renderTreeLevel(items) {
  const content = $("#le-tree-content");
  let bc = '<div class="le-tree-breadcrumb"><span class="le-tree-crumb" data-level="-1">全部类目</span>';
  treePath.forEach((p, i) => { bc += ` <span class="le-tree-sep">›</span> <span class="le-tree-crumb" data-level="${i}">${esc(p.name)}</span>`; });
  bc += "</div>";
  const sb = '<div class="le-tree-search-wrap"><input type="text" id="le-tree-search" class="le-tree-search" placeholder="在当前层级搜索..." autocomplete="off" /><span class="le-tree-search-count"></span></div>';
  content.innerHTML = bc + sb + renderTreeItems(items);
  const si = $("#le-tree-search");
  if (si) {
    si.addEventListener("input", () => {
      const q = si.value.trim().toLowerCase();
      const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
      const le = $("#le-tree-list");
      if (le) { le.innerHTML = renderTreeItems(filtered); wireTreeItemClicks(); }
      const ce = $(".le-tree-search-count");
      if (ce) ce.textContent = q ? filtered.length + "/" + items.length : "";
    });
    si.focus();
  }
  wireTreeItemClicks();
  $$(".le-tree-crumb").forEach(el => {
    el.addEventListener("click", () => {
      const level = parseInt(el.dataset.level);
      if (level === -1) { treePath = []; renderTreeLevel(categoryTree); }
      else { treePath = treePath.slice(0, level + 1); const n = findTreeNode(categoryTree, treePath[level].id); renderTreeLevel(n ? (n.children || []) : categoryTree); }
    });
  });
}

function renderTreeItems(items) {
  if (!items.length) return '<div class="le-tree-empty">没有子类目</div>';
  const cats = items.filter(i => i.type === "category");
  const types = items.filter(i => i.type === "type");
  let h = '<div id="le-tree-list">';
  if (cats.length) {
    h += '<div class="le-tree-section">分类</div>';
    h += cats.map(c => `<div class="le-tree-item le-tree-category" data-id="${esc(c.id)}" data-name="${esc(c.name)}"><span class="le-tree-icon">📁</span><span class="le-tree-name">${esc(c.name)}</span><span class="le-tree-count">${c.children_count}</span></div>`).join("");
  }
  if (types.length) {
    h += '<div class="le-tree-section">类型（可选）</div>';
    h += types.map(t => `<div class="le-tree-item le-tree-type" data-cat-id="${esc(t.category_id)}" data-type-id="${esc(t.id)}" data-name="${esc(t.name)}"><span class="le-tree-icon">📄</span><span class="le-tree-name">${esc(t.name)}</span><span class="le-tree-select">选择</span></div>`).join("");
  }
  return h + "</div>";
}

function wireTreeItemClicks() {
  $$(".le-tree-category").forEach(el => {
    el.addEventListener("click", () => {
      const n = findTreeNode(categoryTree, el.dataset.id);
      if (n) { treePath.push({id: el.dataset.id, name: el.dataset.name, type: "category"}); renderTreeLevel(n.children || []); }
    });
  });
  $$(".le-tree-type").forEach(el => {
    el.addEventListener("click", () => {
      const fullName = treePath.map(p => p.name).concat(el.dataset.name).join(" / ");
      selectCategory(el.dataset.catId, el.dataset.typeId, fullName);
      closeTreeBrowser();
    });
  });
}

function findTreeNode(tree, id) {
  for (const n of tree) { if (n.id === id) return n; if (n.children) { const f = findTreeNode(n.children, id); if (f) return f; } }
  return null;
}

function showCategoryLearningPanel(isCorrection) {
  const panel = $("#le-category-memory-actions");
  if (!panel) return;
  $("#le-memory-action-title").textContent = isCorrection ? "这是一次类目纠正，要记住吗？" : "确认这个类目正确并记住？";
  state.categoryLearningMode = isCorrection ? "remember" : "confirm";
  const feedback = $("#le-memory-action-feedback");
  if (feedback) { feedback.textContent = ""; feedback.className = "le-memory-feedback"; }
  panel.hidden = false;
}

function setCategoryMemoryFeedback(message, kind = "") {
  const feedback = $("#le-memory-action-feedback");
  if (!feedback) return;
  feedback.textContent = message || "";
  feedback.className = `le-memory-feedback${kind ? ` is-${kind}` : ""}`;
}

async function ensureCompleteCategorySelection() {
  if (state.categoryId && state.typeId) return true;
  if (!state.shopId || !state.typeId) {
    setCategoryMemoryFeedback("当前类目不完整，请重新从下拉菜单选择。", "error");
    toast("当前类目不完整，请重新选择", true);
    return false;
  }
  setCategoryMemoryFeedback("正在补全类目 ID…");
  try {
    const categories = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories?type_id=${encodeURIComponent(state.typeId)}&limit=50`);
    const currentTitle = String(state.categoryTitle || $("#le-category-search")?.value || "").trim();
    const exactTitle = categories.find((row) => {
      const title = String(row.title_zh || row.title || "").trim();
      return currentTitle && (title === currentTitle || currentTitle.endsWith(title) || title.endsWith(currentTitle));
    });
    const resolved = exactTitle || (categories.length === 1 ? categories[0] : null);
    if (!resolved?.category_id) throw new Error("无法唯一确定该 Type 对应的 Category ID，请重新从下拉菜单选择");
    state.categoryId = String(resolved.category_id);
    state.categoryTitle = resolved.title_zh || resolved.title || currentTitle;
    $("#le-category-search").value = state.categoryTitle;
    $("#le-category-path").textContent = `已选: ${state.categoryTitle} (ID: ${state.categoryId}, Type: ${state.typeId})`;
    setCategoryMemoryFeedback(`已补全类目 ID：${state.categoryId}`);
    return true;
  } catch (error) {
    setCategoryMemoryFeedback(error.message || "类目 ID 补全失败", "error");
    toast(`类目 ID 补全失败: ${error.message}`, true);
    return false;
  }
}

async function recordCategoryDecision(learningMode) {
  const panel = $("#le-category-memory-actions");
  if (!state.shopId) { setCategoryMemoryFeedback("请先选择店铺。", "error"); toast("请先选择店铺", true); return false; }
  if (!await ensureCompleteCategorySelection()) return false;
  const payload = {
    source_product_id: state.sourceProduct?.id || null,
    title: state.sourceProduct?.title || $("#le-title").value || state.categoryTitle,
    material: state.sourceProduct?.material || "",
    category_id: state.categoryId,
    type_id: state.typeId,
    category_title: state.categoryTitle || $("#le-category-search").value,
    learning_mode: learningMode,
  };
  try {
    setCategoryMemoryFeedback("正在保存可信记忆…");
    const result = await api("POST", `/api/v1/shops/${state.shopId}/decision-memory/category`, payload);
    setCategoryMemoryFeedback(learningMode === "one_off" ? "已设为仅本次使用。" : `已记住${result.memory_id ? `（记录 ${result.memory_id}）` : ""}。`, "success");
    toast(learningMode === "one_off" ? "已仅用于本次，不会进入系统记忆" : "已保存为可信记忆；后续 Ozon 结果会继续校准", false);
    if (learningMode === "one_off") panel.hidden = true;
    return true;
  } catch (error) {
    setCategoryMemoryFeedback(`保存失败：${error.message}`, "error");
    toast(`记忆保存失败: ${error.message}`, true);
    return false;
  }
}

// Category memory button bindings are in DOMContentLoaded below (line ~2565)
// to ensure elements exist before attaching listeners.

async function openDecisionMemory() {
  const modal = $("#le-memory-modal");
  const list = $("#le-memory-list");
  modal.style.display = "flex";
  list.innerHTML = '<p class="le-placeholder"><span class="le-loading"></span> 正在加载可信记忆...</p>';
  try {
    const rows = await api("GET", `/api/v1/shops/${state.shopId}/decision-memory`);
    if (!rows.length) { list.innerHTML = '<div class="le-memory-empty">暂无可信记忆。商品成功导入 Ozon 后会出现在这里。</div>'; return; }
    const sourceLabel = {manual_confirmed:"人工确认", manual_corrected:"人工纠正", ozon:"Ozon验证", ozon_verified:"Ozon导入验证"};
    list.innerHTML = rows.map(row => {
      const decisionLabel = row.decision_type === "attribute"
        ? `属性：${row.decision.name || row.decision.attribute_id} = ${row.decision.value_text || row.decision.value_id || ""}`
        : (row.decision.category_title || `${row.decision.category_id} / ${row.decision.type_id}`);
      return `<article class="le-memory-card ${esc(row.status)}">
      <div class="le-memory-card-main"><strong>${esc(row.title)}</strong><span>${esc(decisionLabel)} · ${esc(row.domain)}</span><small>来源：${esc(sourceLabel[row.source] || row.source)}　可信度：${Math.round(row.trust_score * 100)}%　人工确认 ${row.confirmation_count} 次　Ozon 成功 ${row.ozon_success_count} 次 / 拒绝 ${row.rejection_count} 次</small></div>
      <div class="le-memory-card-status"><b>${row.status === "active" ? "使用中" : row.status === "negative" ? "负反馈" : row.status === "disabled" ? "已停用" : "已撤销"}</b>
      ${row.status === "active" ? `<button data-memory-id="${row.id}" data-status="disabled">停用</button>` : row.status === "disabled" ? `<button data-memory-id="${row.id}" data-status="active">恢复</button>` : ""}
      ${row.status !== "revoked" ? `<button class="danger" data-memory-id="${row.id}" data-status="revoked">撤销</button>` : ""}</div>
    </article>`; }).join("");
    list.querySelectorAll("button[data-memory-id]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await api("POST", `/api/v1/shops/${state.shopId}/decision-memory/${button.dataset.memoryId}/status`, {status:button.dataset.status}); await openDecisionMemory(); }
      catch (error) { toast(error.message, true); button.disabled = false; }
    }));
  } catch (error) { list.innerHTML = `<div class="le-memory-empty">加载失败：${esc(error.message)}</div>`; }
}

$("#le-memory-manage")?.addEventListener("click", openDecisionMemory);
$("#le-memory-close")?.addEventListener("click", () => { $("#le-memory-modal").style.display = "none"; });
$("#le-memory-modal")?.addEventListener("click", event => { if (event.target.id === "le-memory-modal") event.currentTarget.style.display = "none"; });

async function loadAttributes(options = {}) {
  if (!state.shopId || !state.categoryId || !state.typeId) return;
  const categoryId = String(state.categoryId);
  const typeId = String(state.typeId);
  const loadToken = ++state.attributeLoadToken;
  const c = $("#le-attributes-container");
  c.innerHTML = '<p class="le-placeholder"><span class="le-loading"></span> 正在加载 Ozon 属性…</p>';
  try {
    state.colorOptions = null; // clear cached color dict on category change
    state._selectedAspects = null; // reset aspect selection on category change
    const [attributes, cachedOptions] = await Promise.all([
      api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${categoryId}/types/${typeId}/attributes`),
      api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${categoryId}/types/${typeId}/cached-values?limit_per_attribute=100`).catch(() => ({})),
    ]);
    if (loadToken !== state.attributeLoadToken || String(state.categoryId) !== categoryId || String(state.typeId) !== typeId) return;
    state.attributes = attributes;
    state.attributeOptionsCache = cachedOptions && typeof cachedOptions === "object" ? cachedOptions : {};
    // Saved multi-select dictionary attributes are persisted compactly as
    // value_id="id1|id2" and value_text="text1|text2". Restore their
    // component arrays before rendering; otherwise the multi-select widget
    // initializes empty and a subsequent Save destroys a valid selection.
    for (const attr of state.attributes) {
      if (!attr.is_collection) continue;
      const aid = String(attr.id);
      const saved = state.attrValues[aid];
      if (!saved || Array.isArray(saved.value_ids)) continue;
      saved.value_ids = String(saved.value_id || "").split("|").map(value => value.trim()).filter(Boolean);
      saved.value_texts = String(saved.value_text || "").split("|").map(value => value.trim()).filter(Boolean);
      saved.is_collection = true;
    }
    $("#le-attr-count").textContent = `(${state.attributes.filter(a=>a.required).length} 必填)`;
    renderAttributes(); identifyVariantAttributes();
    // A brand-new/category-changed listing can be auto-filled. A saved draft must
    // only render its persisted values: delayed AI responses must never overwrite
    // a dictionary value selected by the operator.
    if (options.autoFill !== false) {
      autoFillFromAPI({ categoryId, typeId, loadToken }).then(() => autoFillDefaults());
      autoGenerateHashtags();
    }
  }
  catch (e) { c.innerHTML = `<p class="le-placeholder" style="color:var(--le-danger)">属性加载失败: ${esc(e.message)}</p>`; }
}

function renderAttributes() {
  const c = $("#le-attributes-container");
  if (!state.attributes.length) { c.innerHTML = '<p class="le-placeholder">请先在上方选择类目，属性将自动加载。</p>'; $("#le-attr-count").textContent = ""; return; }
  // A dictionary label without an Ozon value_id is only an old AI/search
  // residue, never a usable attribute selection. Do not render it as filled.
  state.attributes.filter(isDictionaryAttribute).forEach(attr => {
    const value = state.attrValues[attr.id];
    if (!value) return;
    if (attr.is_collection) {
      if (!Array.isArray(value.value_ids) || !value.value_ids.length) {
        state.attrValues[attr.id] = { value_ids: [], value_texts: [], is_collection: true, method: "manual" };
      }
    } else if (value.value_text && !value.value_id) {
      state.attrValues[attr.id] = { value_id: null, value_text: "", method: "manual" };
    }
  });
  const showOpt = $("#le-show-optional").checked;
  const skipIds = ["100001", "100002"];
  const skipKw = ["视频", "видео", "Видео", "PDF", "pdf", "组合成类似", "объединить в похожие", "JSON", "富内容", "rich", "简介", "Описание"];
  const isSkip = a => skipIds.includes(String(a.complex_id)) || skipKw.some(k => (a.name || "").includes(k));
  const req = state.attributes.filter(a => a.required && !isSkip(a)); const opt = state.attributes.filter(a => !a.required && !isSkip(a));
  $("#le-attr-count").textContent = `(${req.length} 必填 / ${opt.length} 选填)`;
  let h = "";
  if (req.length) { h += '<div class="le-attr-group-title">必填属性</div>'; h += req.map(a => attrRowHtml(a)).join(""); }
  if (showOpt && opt.length) { h += '<div class="le-attr-group-title">选填属性</div>'; h += opt.map(a => attrRowHtml(a)).join(""); }
  c.innerHTML = h;
  $$(".le-attr-input[data-dictionary]").forEach(i => setupDictionarySearch(i));
  $$(".le-ai-btn[data-attr-id]").forEach(b => b.addEventListener("click", () => aiSuggestAttribute(b.dataset.attrId)));
  $$(".le-template-attr-check[data-attr-id]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const id = String(checkbox.dataset.attrId);
    if (checkbox.checked) state.learningAttributeIds.add(id); else state.learningAttributeIds.delete(id);
  }));
}

function attrRowHtml(attr) {
  const dict = attr.dictionary_id && String(attr.dictionary_id).trim();
  const isColl = attr.is_collection && dict;
  const val = state.attrValues[attr.id] || {};
  const rm = attr.required ? '<span class="le-required">*</span>' : "";
  const vb = attr.is_aspect ? ' <small class="le-variant-badge">变体</small>' : "";
  const msBadge = isColl ? ' <small class="le-variant-badge" style="background:#6c5ce7">多选</small>' : "";
  let inp;
  if (isColl) {
    const displayText = Array.isArray(val.value_texts) && val.value_texts.length ? val.value_texts.join(", ") : (val.value_text || "");
    inp = `<div class="le-combobox le-attr-combobox"><input class="le-attr-input" dir="ltr" data-dictionary="${esc(attr.dictionary_id)}" data-attr-id="${esc(attr.id)}" data-attr-name="${esc(attr.name)}" data-is-collection="1" placeholder="输入搜索，点击选项可多选" value="${esc(displayText)}" autocomplete="off" /><button type="button" class="le-combobox-arrow le-attr-arrow" data-attr-id="${esc(attr.id)}">&#9660;</button><div class="le-combobox-dropdown le-attr-dropdown" data-attr-id="${esc(attr.id)}" style="display:none;max-height:300px;overflow-y:auto"></div></div>`;
  } else if (dict) {
    // Keep the canonical Ozon selection on the DOM node as well as in state.
    // Attribute rows can be re-rendered while an AI fill request is pending;
    // the visible label alone is never a valid dictionary submission.
    inp = `<div class="le-combobox le-attr-combobox"><input class="le-attr-input" dir="ltr" data-dictionary="${esc(attr.dictionary_id)}" data-attr-id="${esc(attr.id)}" data-attr-name="${esc(attr.name)}" data-selected-value-id="${esc(val.value_id || "")}" data-selected-value-text="${esc(val.value_text || "")}" placeholder="仅可从下拉菜单选择（可输入关键词搜索）" value="${esc(val.value_text || "")}" autocomplete="off" /><button type="button" class="le-combobox-arrow le-attr-arrow" data-attr-id="${esc(attr.id)}" title="打开下拉菜单">&#9660;</button><div class="le-combobox-dropdown le-attr-dropdown" data-attr-id="${esc(attr.id)}" style="display:none"></div></div>`;
  }
  else { inp = `<input class="le-attr-input" data-attr-id="${esc(attr.id)}" data-attr-name="${esc(attr.name)}" type="text" value="${esc(val.value_text || "")}" placeholder="输入文本" />`; }
  const manualCls = (state.attrValues[attr.id]?.method === "manual") ? " le-attr-manual" : "";
  const saveChecked = state.learningAttributeIds.has(String(attr.id)) ? " checked" : "";
  return `<div class="le-attr-row${manualCls}"><div class="le-attr-label"><span>${esc(attr.name)} ${rm}${vb}${msBadge}</span><label class="le-template-check" title="随草稿保存；Ozon 导入成功后成为可信记忆，下次同类目仅补充空值"><input type="checkbox" class="le-template-attr-check" data-attr-id="${esc(attr.id)}"${saveChecked}> 记住此属性</label></div><div class="le-attr-input-row">${inp}<button class="le-ai-btn" data-attr-id="${esc(attr.id)}" title="AI推荐">AI</button></div></div>`;
}

// ── Global dropdown manager (added ONCE, no handler accumulation) ──
if (!window._leDropdownReady) {
  window._leDropdownReady = true;
  window._leOpenDropdown = null;
  document.addEventListener("click", function (e) {
    var od = window._leOpenDropdown;
    if (!od) return;
    if (od.dropdown.contains(e.target) || e.target === od.input || (od.arrow && od.arrow.contains(e.target))) return;
    od.closeFn();
    window._leOpenDropdown = null;
  });
}

function setupDictionarySearch(input) {
  var attrId = input.dataset.attrId;
  var dropdown = document.querySelector('.le-attr-dropdown[data-attr-id="' + attrId + '"]');
  var arrow = document.querySelector('.le-attr-arrow[data-attr-id="' + attrId + '"]');
  var isColl = input.dataset.isCollection === "1";
  var isOpen = false;
  var opts = [];
  // A late response for an earlier search must never replace the menu being
  // typed into now.  Selection remains explicit: only clicking an option
  // writes an Ozon dictionary value_id.
  var singleSearchRequest = 0;

  console.log("[dict] setupDictionarySearch attrId=" + attrId + " isColl=" + isColl + " hasDropdown=" + !!dropdown + " hasArrow=" + !!arrow);

  if (isColl) {
    if (!state.attrValues[attrId]) state.attrValues[attrId] = {};
    if (!Array.isArray(state.attrValues[attrId].value_ids)) state.attrValues[attrId].value_ids = [];
    if (!Array.isArray(state.attrValues[attrId].value_texts)) state.attrValues[attrId].value_texts = [];
    state.attrValues[attrId].is_collection = true;
    // NOT using readOnly - it can block click events in some browsers
    input.style.cursor = "pointer";
    input.value = (state.attrValues[attrId].value_texts || []).join(", ");
  }
  var _restoring = false;

  function refreshDisplay() {
    if (!isColl) return;
    input.value = (state.attrValues[attrId].value_texts || []).join(", ");
  }

  function openDropdown() {
    if (window._leOpenDropdown) {
      window._leOpenDropdown.closeFn();
      window._leOpenDropdown = null;
    }
    isOpen = true;
    dropdown.style.display = "block";
    window._leOpenDropdown = {
      dropdown: dropdown, input: input, arrow: arrow,
      closeFn: function () { isOpen = false; dropdown.style.display = "none"; }
    };
    console.log("[dict] OPEN attrId=" + attrId);
    if (isColl) { if (!opts.length) loadOpts(""); else renderOpts(""); }
    else { if (!dropdown.innerHTML.trim()) searchSingle(""); }
  }

  function closeDropdown() {
    isOpen = false;
    dropdown.style.display = "none";
    if (window._leOpenDropdown && window._leOpenDropdown.input === input) window._leOpenDropdown = null;
    console.log("[dict] CLOSE attrId=" + attrId);
  }

  function toggleDropdown() {
    console.log("[dict] TOGGLE attrId=" + attrId + " isOpen=" + isOpen);
    if (isOpen) closeDropdown(); else openDropdown();
  }

  async function loadOpts(q) {
    if (!state.shopId || !state.categoryId) { dropdown.innerHTML = '<div class="le-combobox-empty">请先选择类目</div>'; return; }
    if (!state.typeId) { dropdown.innerHTML = '<div class="le-combobox-empty">缺少类型ID</div>'; return; }
    const cached = Array.isArray(state.attributeOptionsCache?.[attrId]) ? state.attributeOptionsCache[attrId] : null;
    if (!q && cached) { opts = cached.slice(); renderOpts(""); return; }
    dropdown.innerHTML = '<div class="le-combobox-empty">加载中...</div>';
    try {
      opts = await api("GET", '/api/v1/shops/' + state.shopId + '/metadata/categories/' + state.categoryId + '/types/' + state.typeId + '/attributes/' + attrId + '/values?query=' + encodeURIComponent(q) + '&limit=50');
      console.log("[dict] loaded " + opts.length + " opts for attrId=" + attrId);
      renderOpts("");
    } catch (e) {
      console.error("[dict] loadOpts error:", e);
      dropdown.innerHTML = '<div class="le-combobox-empty">加载失败: ' + esc(e.message) + '</div>';
    }
  }

  function renderOpts(ft) {
    // Ensure state has proper structure (autoFillFromAPI may have overwritten it)
    if (!state.attrValues[attrId] || !Array.isArray(state.attrValues[attrId].value_ids)) {
      state.attrValues[attrId] = { value_ids: [], value_texts: [], is_collection: true };
    }
    var sv = state.attrValues[attrId];
    var selIds = (sv.value_ids || []).map(String);
    var list = ft ? opts.filter(function (o) { return (o.value || "").toLowerCase().indexOf(ft.toLowerCase()) >= 0; }) : opts;
    var searchBox = dropdown.querySelector(".le-ms-search");
    var optionsBox = dropdown.querySelector(".le-ms-options");
    if (!searchBox || !optionsBox) {
      dropdown.innerHTML = '<div style="padding:4px 6px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff;z-index:1"><input type="text" dir="ltr" class="le-ms-search" placeholder="输入中文、俄文或单个字符搜索" style="width:100%;padding:3px 6px;border:1px solid #ddd;border-radius:3px;font-size:12px;direction:ltr;text-align:left;unicode-bidi:isolate" /></div><div class="le-ms-options"></div>';
      searchBox = dropdown.querySelector(".le-ms-search");
      optionsBox = dropdown.querySelector(".le-ms-options");
      var composing = false;
      var applyFilter = function () { if (!composing) renderOpts(searchBox.value); };
      searchBox.addEventListener("compositionstart", function () { composing = true; });
      searchBox.addEventListener("compositionend", function () { composing = false; renderOpts(searchBox.value); });
      searchBox.addEventListener("input", applyFilter);
    }
    var h = "";
    if (!list.length) { h = '<div class="le-combobox-empty">无选项</div>'; }
    else {
      list.forEach(function (v) {
        var ck = selIds.indexOf(String(v.id)) >= 0;
        h += '<div class="le-ms-item" data-vid="' + esc(v.id) + '" data-vt="' + esc(v.value) + '" style="padding:5px 10px;cursor:pointer;' + (ck ? 'background:#e8f0fe' : '') + '">';
        h += '<span style="display:inline-block;width:16px">' + (ck ? '\u2713' : '') + '</span><span>' + esc(v.value) + '</span></div>';
      });
    }
    optionsBox.innerHTML = h;
    var si = searchBox;
    optionsBox.querySelectorAll(".le-ms-item").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        // Re-read sv in case it was overwritten by autoFillFromAPI
        if (!state.attrValues[attrId] || !Array.isArray(state.attrValues[attrId].value_ids)) {
          state.attrValues[attrId] = { value_ids: [], value_texts: [], is_collection: true };
        }
        var sv2 = state.attrValues[attrId];
        var vid = String(el.dataset.vid), vt = el.dataset.vt;
        var idx = sv2.value_ids.indexOf(vid);
        if (idx >= 0) { sv2.value_ids.splice(idx, 1); sv2.value_texts.splice(idx, 1); }
        else { sv2.value_ids.push(vid); sv2.value_texts.push(vt); }
        console.log("[dict] SELECT attrId=" + attrId + " vid=" + vid + " total=" + sv2.value_ids.length);
        refreshDisplay();
        renderOpts(si ? si.value : "");
        if (si) si.focus();
      });
    });
  }

  async function searchSingle(q) {
    if (!state.shopId || !state.categoryId) return;
    var requestId = ++singleSearchRequest;
    var requestedQuery = String(q || "").trim();
    function selectSingle(vid, vt) {
      input.value = vt;
      state.attrValues[attrId] = { value_id: String(vid), value_text: String(vt || "") };
      input.dataset.selectedValueId = String(vid);
      input.dataset.selectedValueText = String(vt || "");
      closeDropdown();
    }
    var cachedValues = Array.isArray(state.attributeOptionsCache?.[attrId]) ? state.attributeOptionsCache[attrId] : null;
    if (cachedValues && !requestedQuery) {
      dropdown.innerHTML = cachedValues.length ? cachedValues.map(function (v) { return '<div class="le-combobox-option" data-vid="' + esc(v.id) + '" data-vt="' + esc(v.value) + '"><span class="le-cat-zh">' + esc(v.value) + '</span></div>'; }).join("") : '<div class="le-combobox-empty">暂无本地选项，请输入关键词搜索</div>';
      dropdown.querySelectorAll(".le-combobox-option").forEach(function (el) { el.addEventListener("click", function () { selectSingle(el.dataset.vid, el.dataset.vt); }); });
      return;
    }
    if (cachedValues && requestedQuery) {
      var localMatches = cachedValues.filter(function (v) { return String(v.value || "").toLowerCase().indexOf(requestedQuery.toLowerCase()) >= 0; });
      if (localMatches.length) {
        dropdown.innerHTML = localMatches.map(function (v) { return '<div class="le-combobox-option" data-vid="' + esc(v.id) + '" data-vt="' + esc(v.value) + '"><span class="le-cat-zh">' + esc(v.value) + '</span></div>'; }).join("");
        dropdown.querySelectorAll(".le-combobox-option").forEach(function (el) { el.addEventListener("click", function () { selectSingle(el.dataset.vid, el.dataset.vt); }); });
        return;
      }
    }
    dropdown.innerHTML = '<div class="le-combobox-empty">加载中...</div>';
    try {
      var vals = await api("GET", '/api/v1/shops/' + state.shopId + '/metadata/categories/' + state.categoryId + '/types/' + state.typeId + '/attributes/' + attrId + '/values?query=' + encodeURIComponent(requestedQuery) + '&limit=50');
      if (requestId !== singleSearchRequest || !isOpen || input.value.trim() !== requestedQuery) return;
      if (!vals.length) { dropdown.innerHTML = '<div class="le-combobox-empty">无匹配</div>'; return; }
      dropdown.innerHTML = vals.map(function (v) {
        return '<div class="le-combobox-option" data-vid="' + esc(v.id) + '" data-vt="' + esc(v.value) + '"><span class="le-cat-zh">' + esc(v.value) + '</span></div>';
      }).join("");
      dropdown.querySelectorAll(".le-combobox-option").forEach(function (el) {
        el.addEventListener("click", function (e) {
          e.stopPropagation();
          input.value = el.dataset.vt;
          state.attrValues[attrId] = { value_id: el.dataset.vid, value_text: el.dataset.vt };
          input.dataset.selectedValueId = el.dataset.vid;
          input.dataset.selectedValueText = el.dataset.vt;
          closeDropdown();
        });
      });
    } catch (e) { dropdown.innerHTML = '<div class="le-combobox-empty">失败</div>'; }
  }

  // Arrow click toggles for both single and multi-select
  if (arrow) arrow.addEventListener("click", function (e) { e.stopPropagation(); toggleDropdown(); });

  if (isColl) {
    // Multi-select: click on input toggles dropdown
    input.addEventListener("click", function (e) { e.stopPropagation(); toggleDropdown(); });
    // Block typing in multi-select (no readOnly, so we prevent manually)
    input.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        var sv = state.attrValues[attrId];
        if (sv.value_ids && sv.value_ids.length) { sv.value_ids.pop(); sv.value_texts.pop(); refreshDisplay(); }
      } else if (e.key === "Tab" || e.ctrlKey || e.metaKey || e.altKey) {
        // allow navigation and shortcuts
      } else if (e.key.length === 1) {
        e.preventDefault(); // block character typing
      }
    });
    // Restore display value if paste or other input sneaks in
    input.addEventListener("input", function () {
      if (_restoring) return;
      _restoring = true;
      refreshDisplay();
      _restoring = false;
    });
  } else {
    // Single-select: focus opens dropdown, typing searches
    input.addEventListener("focus", function () { if (!isOpen) openDropdown(); });
    var singleComposing = false;
    input.addEventListener("compositionstart", function () { singleComposing = true; });
    input.addEventListener("compositionend", function () { singleComposing = false; searchSingle(input.value.trim()); });
    input.addEventListener("input", function () {
      if (singleComposing) return;
      // Typed text is only a search term until an Ozon option is clicked.
      // Never carry an earlier option ID forward under changed text.
      input.dataset.selectedValueId = "";
      input.dataset.selectedValueText = "";
      if (state.attrValues[attrId]) state.attrValues[attrId].value_id = null;
      clearTimeout(state.dictSearchTimers[attrId]);
      ++singleSearchRequest;
      var q = input.value.trim();
      state.dictSearchTimers[attrId] = setTimeout(function () { searchSingle(q); }, 300);
    });
  }
}


async function autoFillFromAPI(options = {}) {
  if (!state.shopId || !state.categoryId || !state.typeId) return;
  const categoryId = String(options.categoryId || state.categoryId);
  const typeId = String(options.typeId || state.typeId);
  const loadToken = options.loadToken || state.attributeLoadToken;
  const offerId = $("#le-offer-id").value || "";
  const spId = state.sourceProduct?.id || null;
  const btn = $("#le-ai-fill-all-attrs");
  if (btn) { btn.classList.add("loading"); btn.disabled = true; btn.textContent = "自动填写中..."; }
  try {
    const r = await api("POST", `/api/v1/shops/${state.shopId}/auto-fill`, {
      category_id: categoryId, type_id: typeId,
      source_product_id: spId, offer_id: offerId,
    });
    let filled = 0;
    for (const item of r.results) {
      if (item.method === "skip" || item.method === "skip_rich_content") continue;
      const aid = String(item.attribute_id);
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`);
      const attrMeta = state.attributes.find((attr) => String(attr.id) === aid);
      const isColl = Boolean(attrMeta?.is_collection && attrMeta?.dictionary_id);
      const isDictionary = isDictionaryAttribute(attrMeta);
      const existing = state.attrValues[aid];
      const hasExistingValue = isColl
        ? Boolean(existing && ((existing.value_ids && existing.value_ids.length) || (existing.value_texts && existing.value_texts.length)))
        : Boolean(existing && (existing.value_id || existing.value_text));
      // AI is a first-fill assistant, never an override for a saved/manual value.
      if (hasExistingValue) continue;

      // Dictionary fields are valid only with a canonical menu value_id.
      // Never render an AI/free-text guess as though it were selected.
      if (isDictionary && !item.value_id) {
        state.attrValues[aid] = isColl
          ? { value_ids: [], value_texts: [], is_collection: true, method: "manual" }
          : { value_id: null, value_text: "", method: "manual" };
        const row = inp?.closest(".le-attr-row");
        if (row) row.classList.add("le-attr-manual");
        continue;
      }
      if (item.value_text) {
        if (isColl) {
          // Multi-select: only select a canonical option from the global
          // cache. A text-only AI answer is never a submission value.
          const cachedOptions = Array.isArray(state.attributeOptionsCache?.[aid]) ? state.attributeOptionsCache[aid] : [];
          // A dictionary suggestion is valid only when its ID is present in
          // the global menu cache; unknown/text-only values stay manual.
          const option = cachedOptions.find(o => String(o.id) === String(item.value_id || "")) || null;
          if (!item.value_id || !option) {
            state.attrValues[aid] = { value_ids: [], value_texts: [], is_collection: true, method: "manual" };
            const row = inp?.closest(".le-attr-row");
            if (row) row.classList.add("le-attr-manual");
            continue;
          }
          if (!state.attrValues[aid]) state.attrValues[aid] = {};
          if (!Array.isArray(state.attrValues[aid].value_ids)) state.attrValues[aid].value_ids = [];
          if (!Array.isArray(state.attrValues[aid].value_texts)) state.attrValues[aid].value_texts = [];
          if (!state.attrValues[aid].value_ids.includes(String(option.id))) {
            state.attrValues[aid].value_ids.push(String(option.id));
            state.attrValues[aid].value_texts.push(option.value);
          }
          state.attrValues[aid].is_collection = true;
          state.attrValues[aid].method = item.method;
          if (inp) inp.value = state.attrValues[aid].value_texts.join(", ");
        } else {
          // Single-select or text: replace as before
          const cachedOptions = isDictionary && Array.isArray(state.attributeOptionsCache?.[aid]) ? state.attributeOptionsCache[aid] : [];
          const returnedOption = isDictionary && item.value_id ? { id: String(item.value_id), value: item.value_text || "" } : null;
          const menuOptions = isDictionary ? [...cachedOptions, ...(returnedOption && !cachedOptions.some(o => String(o.id) === String(returnedOption.id)) ? [returnedOption] : [])] : null;
          const applied = applyAttributeSuggestion(attrMeta, { value_id: item.value_id, value: item.value_text, method: item.method }, menuOptions);
          if (applied) filled++;
          continue;
        }
        filled++;
      } else if (item.method === "manual") {
        if (isColl) {
          // Multi-select: init empty arrays, mark manual
          if (!state.attrValues[aid]) state.attrValues[aid] = {};
          if (!Array.isArray(state.attrValues[aid].value_ids)) state.attrValues[aid].value_ids = [];
          if (!Array.isArray(state.attrValues[aid].value_texts)) state.attrValues[aid].value_texts = [];
          state.attrValues[aid].is_collection = true;
          state.attrValues[aid].method = "manual";
        } else {
          state.attrValues[aid] = { value_id: null, value_text: "", method: "manual" };
        }
        const row = inp?.closest(".le-attr-row");
        if (row) row.classList.add("le-attr-manual");
      } else {
        if (isColl) {
          if (!state.attrValues[aid]) state.attrValues[aid] = {};
          if (!Array.isArray(state.attrValues[aid].value_ids)) state.attrValues[aid].value_ids = [];
          if (!Array.isArray(state.attrValues[aid].value_texts)) state.attrValues[aid].value_texts = [];
          state.attrValues[aid].is_collection = true;
          state.attrValues[aid].method = item.method;
        } else {
          state.attrValues[aid] = { value_id: item.value_id, value_text: item.value_text || "", method: item.method };
        }
      }
    }
    const s = r.stats;
    if (!options.quiet) toast(`自动填写 ${filled} 项 (写死${s.hardcoded||0} 硬匹配${s.hard_match||0} AI匹配${s.ai_match||0})`, "success");
  } catch (e) {
    toast("自动填写失败: " + e.message, "error");
  } finally {
    if (btn) { btn.classList.remove("loading"); btn.disabled = false; btn.textContent = "AI 填充全部"; }
  }
}

// Convert dimension value: if attribute name expects cm, convert mm -> cm
function _convertDim(mmVal, attrName) {
  const v = parseFloat(mmVal);
  if (!v) return String(mmVal);
  const lower = (attrName || "").toLowerCase();
  // If attribute name contains см or cm, convert mm to cm
  if (lower.includes("см") || lower.includes("cm") || lower.includes("厘米")) {
    return String(v / 10);
  }
  return String(mmVal);
}

function autoFillDefaults(forcePackage = false) {
  // Auto-fill known default values for common attributes
  const sp = state.sourceProduct;
  const pkg = sp?.packageInfo || {};
  let raw = {};
  try { raw = typeof sp?.raw_json === "string"
    ? JSON.parse(sp.raw_json) : (sp?.raw_json || {}); } catch (_) {}
  const rawPkg = raw.packageInfo || {};
  // Extract weight/dims: direct packageInfo first, raw_json fallback, then attributes
  let srcWeight = pkg.weightG || rawPkg.weightG || null;
  let srcLength = pkg.lengthMm || rawPkg.lengthMm || null;
  let srcWidth = pkg.widthMm || rawPkg.widthMm || null;
  let srcHeight = pkg.heightMm || rawPkg.heightMm || null;
  const srcAttrs = raw.attributes || [];
  for (const a of srcAttrs) {
    const n = (a.name || "").toLowerCase();
    const v = a.value || "";
    if (!srcWeight && (n.includes("重量") || n.includes("вес") || n.includes("weight"))) srcWeight = v;
    if (!srcLength && (n.includes("长") || n.includes("длин"))) srcLength = v;
    if (!srcWidth && (n.includes("宽") || n.includes("ширин"))) srcWidth = v;
    if (!srcHeight && (n.includes("高") || n.includes("высот"))) srcHeight = v;
  }
  // Also check source product top-level fields
  if (!srcWeight && sp?.weight_g) srcWeight = sp.weight_g;

  for (const attr of state.attributes) {
    const name = attr.name || "";
    const aid = String(attr.id);
    // Skip if already has a value
    const isPackageAttr = name.includes("重量") || name.toLowerCase().includes("вес") || name.includes("长度") || name.toLowerCase().includes("длин") || name.includes("宽度") || name.toLowerCase().includes("ширин") || name.includes("高度") || name.toLowerCase().includes("высот");
    if (state.attrValues[aid]?.value_text && !(forcePackage && isPackageAttr)) continue;
    // Defaults such as brand/country must also come through the actual Ozon
    // dictionary. The backend auto-fill path resolves those selections.
    if (isDictionaryAttribute(attr)) continue;
    // Brand -> Нет бренда (no brand)
    if (name.includes("品牌") || name.toLowerCase().includes("бренд")) {
      state.attrValues[aid] = { value_id: "126745801", value_text: "Нет бренда" };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = "Нет бренда";
    }
    // Country -> Китай (China)
    else if (name.includes("原产国") || name.toLowerCase().includes("страна")) {
      state.attrValues[aid] = { value_id: "90296", value_text: "中国" };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = "中国";
    }
    // Model name -> use offer_id
    else if (name.includes("型号名称") || name.toLowerCase().includes("название модели")) {
      const oid = $("#le-offer-id").value || "SKU";
      state.attrValues[aid] = { value_id: null, value_text: oid };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = oid;
    }
    // 原厂包装数量 -> default 1
    else if (name.includes("原厂包装数量") || name.includes("统一计量单位中的商品数量") || name.includes("一件商品中的件数")) {
      state.attrValues[aid] = { value_id: null, value_text: "1" };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = "1";
    }
    // Weight attributes -> from 1688 source (grams, no conversion)
    // Ozon: "Вес товара, г" expects grams
    else if ((name.includes("重量") || name.toLowerCase().includes("вес")) && srcWeight) {
      state.attrValues[aid] = { value_id: null, value_text: String(srcWeight) };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = String(srcWeight);
    }
    // Dimension attributes -> from 1688 source
    // packageInfo is in mm; Ozon attributes with "см"/"cm" expect cm -> divide by 10
    else if ((name.includes("长度") || name.toLowerCase().includes("длин")) && srcLength) {
      const val = _convertDim(srcLength, name);
      state.attrValues[aid] = { value_id: null, value_text: val };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = val;
    }
    else if ((name.includes("宽度") || name.toLowerCase().includes("ширин")) && srcWidth) {
      const val = _convertDim(srcWidth, name);
      state.attrValues[aid] = { value_id: null, value_text: val };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = val;
    }
    else if ((name.includes("高度") || name.toLowerCase().includes("высот") || name.toLowerCase().includes("глубин")) && srcHeight) {
      // "Высота" = height, "Глубина" = depth -> both map to heightMm from package
      const val = _convertDim(srcHeight, name);
      state.attrValues[aid] = { value_id: null, value_text: val };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = val;
    }
  }
}

// Auto-generate hashtags without requiring a button click (called on source load)
async function autoGenerateHashtags() {
  if (!state.attributes.length) return;
  const title = state.sourceProduct?.title || $("#le-title").value;
  if (!title) return;
  // Find hashtag attribute
  const hashtagAttr = state.attributes.find(a => {
    const n = a.name || "";
    return n.includes("主题标签") || n.includes("Хештег") || n.includes("хештег") || n.includes("Hashtag") || n.includes("hashtag") || n.startsWith("#");
  });
  if (!hashtagAttr) return;
  // Skip if already has a value
  if (state.attrValues[String(hashtagAttr.id)]?.value_text) return;
  try {
    const catZh = $("#le-category-search").value || "";
    const r = await api("POST", "/api/v1/ai/generate-hashtags", {
      title, description: $("#le-description").value || "", category_zh: catZh
    });
    const inp = $(`.le-attr-input[data-attr-id="${hashtagAttr.id}"]`);
    if (inp) inp.value = r.hashtags;
    state.attrValues[String(hashtagAttr.id)] = { value_id: null, value_text: r.hashtags };
  } catch (e) { console.error("[autoGenerateHashtags] failed:", e.message); }
}

async function aiGenerateHashtags(btn) {
  const title = state.sourceProduct?.title || $("#le-title").value;
  if (!title) { toast("缺少商品标题", "error"); return; }
  if (!state.attributes.length) { toast("请先选择类目，加载属性后再生成标签", "error"); return; }
  aiCall(btn, async () => {
    const catZh = $("#le-category-search").value || "";
    const r = await api("POST", "/api/v1/ai/generate-hashtags", {
      title, description: $("#le-description").value || "", category_zh: catZh
    });
    // Find hashtag attribute by multiple name patterns
    const hashtagAttr = state.attributes.find(a => {
      const n = a.name || "";
      return n.includes("主题标签") || n.includes("Хештег") || n.includes("хештег") || n.includes("Hashtag") || n.includes("hashtag") || n.startsWith("#");
    });
    if (hashtagAttr) {
      const inp = $(`.le-attr-input[data-attr-id="${hashtagAttr.id}"]`);
      if (inp) inp.value = r.hashtags;
      else toast("标签已生成但输入框未找到，请检查属性列表", "error");
      state.attrValues[hashtagAttr.id] = { value_id: null, value_text: r.hashtags };
    } else {
      // Fallback: find any free-text attribute with id 23171 or similar
      const fallback = state.attributes.find(a => String(a.id) === "23171");
      if (fallback) {
        const inp = $(`.le-attr-input[data-attr-id="${fallback.id}"]`);
        if (inp) inp.value = r.hashtags;
        state.attrValues[fallback.id] = { value_id: null, value_text: r.hashtags };
      }
      toast("未找到主题标签属性，标签内容：" + r.hashtags.slice(0, 60) + "...", "success");
    }
  });
}

async function aiMatchMaterials(btn) {
  if (!state.attributes.length) { toast("请先选择类目", "error"); return; }
  if (!state.sourceProduct) { toast("请先加载采集商品", "error"); return; }
  aiCall(btn, async () => {
    const title = state.sourceProduct.title || "";
    const sourceDesc = state.sourceProduct.raw_json || "";
    let filled = 0;
    // Find material-related attributes
    const materialAttrs = state.attributes.filter(a => {
      const n = a.name || "";
      return n.includes("材料") || n.includes("材质") || n.toLowerCase().includes("материал");
    });
    for (const attr of materialAttrs) {
      if (state.attrValues[attr.id]?.value_text) continue;
      try {
        let dictOpts = null;
        if (attr.dictionary_id) {
          try { dictOpts = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attr.id}/values?query=${encodeURIComponent(title.slice(0,3))}&limit=30`); } catch (_) {}
        }
        const r = await api("POST", "/api/v1/ai/suggest-attribute", {
          attribute_name: attr.name, product_title: title,
          product_description: sourceDesc, dictionary_options: dictOpts,
        });
        if (applyAttributeSuggestion(attr, r, dictOpts)) filled++;
      } catch (_) {}
    }
    toast(`材料属性已匹配 ${filled} 项`, "success");
  });
}

async function aiCall(btn, fn) { if (!btn) return; const orig = btn.textContent; btn.classList.add("loading"); btn.disabled = true; try { await fn(); } catch (e) { toast(e.message || "AI 操作失败", "error"); } finally { btn.classList.remove("loading"); btn.disabled = false; btn.textContent = orig; } }
async function aiTranslateTitle(btn) { const t = state.sourceProduct?.title || $("#le-title").value; if (!t) { toast("请先输入或加载标题", "error"); return; } aiCall(btn, async () => { const r = await api("POST", "/api/v1/ai/translate", { text: t, target_lang: "ru", context: titleTranslateContext(state.sourceProduct?.category_hint) }); $("#le-title").value = r.translated; autoMatchCategories(); toast("标题已翻译", "success"); }); }

async function intelligentTitleGenerate(btn) {
  const imageUrl = String(state.images?.[0] || state.sourceProduct?.image_url || state.sourceProduct?.media?.find(item => item.media_type === "image")?.url || "").trim();
  const categoryId = Number(state.categoryId || 0);
  if (!imageUrl) { toast("当前商品没有可用主图，无法调用智能标题接口", "error"); return; }
  if (!categoryId) { toast("请先选择并确认 Ozon 类目", "error"); return; }
  const resultBox = $("#le-intelligent-title-result");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "识别中…"; }
    const response = await api("POST", "/api/v1/image-product-intelligent/generate", { image_url: imageUrl, cat_id: categoryId });
    const subjects = Array.isArray(response.subjects) ? response.subjects.map(value => String(value || "").trim()).filter(Boolean) : [];
    const points = Array.isArray(response.points) ? response.points.map(value => String(value || "").trim()).filter(Boolean) : [];
    const cpv = response.offer_cpv?.featureValues || response.offer_cpv?.feature_values || [];
    if (!resultBox) return;
    resultBox.hidden = false;
    resultBox.innerHTML = `<strong>1688 智能识别结果</strong>${subjects.length ? `<div style="margin-top:6px"><span>建议标题（点击可替换当前标题）</span>${subjects.map((value, index) => `<div class="le-intelligent-subject"><span>${esc(value)}</span><button type="button" class="le-btn le-btn-sm le-btn-validate" data-intelligent-subject="${esc(value)}">${index === 0 ? "采用" : "使用"}</button></div>`).join("")}</div>` : ""}${points.length ? `<div style="margin-top:8px"><span>卖点</span><div class="le-intelligent-cpv">${points.map(value => `<span>${esc(value)}</span>`).join("")}</div></div>` : ""}${cpv.length ? `<div style="margin-top:8px"><span>CPV 属性参考（1688 fid/vid，仅作证据，不直接当作 Ozon 字典 ID）</span><div class="le-intelligent-cpv">${cpv.map(item => `<span>${esc(item.name || item.fid || "属性")}: ${esc(item.value || item.vid || "")}</span>`).join("")}</div></div>` : ""}${!subjects.length && !points.length && !cpv.length ? `<div style="margin-top:6px">接口未返回可用建议，请继续使用现有 AI 文案流程。</div>` : ""}`;
    resultBox.querySelectorAll("[data-intelligent-subject]").forEach(action => action.addEventListener("click", () => { $("#le-title").value = action.dataset.intelligentSubject || ""; state.editorDirty = true; toast("已将智能标题建议放入标题框，可继续修改", "success"); }));
    toast("智能标题、卖点和 CPV 已返回；未覆盖现有内容", "success");
  } catch (error) {
    if (resultBox) { resultBox.hidden = false; resultBox.textContent = `智能标题调用失败：${error.message}`; }
    toast(`智能标题调用失败：${error.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "1688 智能识别"; }
  }
}
function sourceDescriptionForAi() {
  const raw = state.sourceProduct?.raw_json;
  let source = raw;
  if (typeof raw === "string") {
    try { source = JSON.parse(raw); } catch (_) { source = raw; }
  }
  if (source && typeof source === "object") source = source.source_description || source.description || source.title || "";
  return String(source || "").slice(0, 9000);
}
async function aiGenerateDescription(btn) { const t = state.sourceProduct?.title || $("#le-title").value; if (!t) { toast("缺少商品标题", "error"); return; } aiCall(btn, async () => { const specs = Object.entries(state.attrValues).filter(([,v]) => v.value_text).map(([k,v]) => { const a = state.attributes.find(a => String(a.id) === k); return { name: a?.name || k, value: v.value_text }; }); const r = await api("POST", "/api/v1/ai/generate-description", { product_title: t, source_description: sourceDescriptionForAi(), specs, target_lang: "ru" }); $("#le-description").value = r.description; toast("描述已生成", "success"); }); }
async function aiTranslateDescription(btn) { const d = $("#le-description").value || state.sourceProduct?.title; if (!d) { toast("缺少描述内容", "error"); return; } aiCall(btn, async () => { const r = await api("POST", "/api/v1/ai/translate", { text: d, target_lang: "ru" }); $("#le-description").value = r.translated; toast("描述已翻译", "success"); }); }
// Auto-generate rich content (no button needed, called after attributes loaded)
async function generateRichContentAuto() {
  const d = $("#le-description").value;
  const imgs = publicGalleryImages().slice(0, 5);
  if (!d && !imgs.length) return;
  try {
    const sn = $("#le-shop-select").selectedOptions[0]?.textContent || "";
    const r = await api("POST", "/api/v1/ai/generate-rich-content", { description: d, image_urls: imgs, shop_name: sn });
    const richEl = $("#le-rich-content");
    if (richEl) richEl.value = r.raw_json || "";
    state.richContentCompact = r.rich_content;
    state.richContentAuto = true;
  } catch (e) {
    console.error("[auto-content] rich content failed:", e);
    throw e;
  }
}

async function autoGenerateDescriptionThenRichContent(cleanTitle) {
  if (!cleanTitle || !state.sourceProduct) return;
  if (state.contentGenerationPromise) return state.contentGenerationPromise;
  state.contentGenerationPromise = (async () => {
    const descriptionEl = $("#le-description");
    const richEl = $("#le-rich-content");
    if (descriptionEl) descriptionEl.placeholder = "AI 正在生成俄文描述…";
    if (richEl) richEl.placeholder = "等待描述生成后自动生成富内容 JSON…";
    try {
      const specs = Object.entries(state.attrValues)
        .filter(([, value]) => value?.value_text)
        .map(([id, value]) => ({
          name: state.attributes.find(attr => String(attr.id) === String(id))?.name || id,
          value: value.value_text,
        }));
      const descriptionResult = await api("POST", "/api/v1/ai/generate-description", {
        product_title: cleanTitle,
        source_description: sourceDescriptionForAi(),
        specs,
        target_lang: "ru",
      });
      const description = (descriptionResult.description || "").trim();
      if (!description) throw new Error("AI 没有返回产品描述");
      descriptionEl.value = description;
      if (richEl) richEl.placeholder = "AI 正在使用产品描述生成富内容 JSON…";
      await generateRichContentAuto();
      toast("描述和富内容 JSON 已按顺序自动生成", "success");
    } catch (e) {
      console.error("[auto-content] sequential generation failed:", e);
      toast(`自动生成描述/富内容失败：${e.message || "未知错误"}`, "error");
    } finally {
      if (descriptionEl) descriptionEl.placeholder = "AI 生成俄文产品描述";
      if (richEl) richEl.placeholder = "自动生成的 Ozon 富内容 JSON";
      state.contentGenerationPromise = null;
    }
  })();
  return state.contentGenerationPromise;
}

async function aiGenerateRichContent(btn) { const d = $("#le-description").value; const imgs = publicGalleryImages().slice(0, 5); if (!d && !imgs.length) { toast("请先生成描述或添加图片", "error"); return; } aiCall(btn, async () => { const sn = $("#le-shop-select").selectedOptions[0]?.textContent || ""; const r = await api("POST", "/api/v1/ai/generate-rich-content", { description: d, image_urls: imgs, shop_name: sn }); $("#le-rich-content").value = r.raw_json; state.richContentCompact = r.rich_content; state.richContentAuto = true; toast("富内容已生成", "success"); }); }
async function aiSuggestAttribute(attrId) {
  if (!state.shopId) { toast("请先选择店铺", "error"); return; }
  const attr = state.attributes.find(a => String(a.id) === String(attrId));
  if (!attr) return;
  const t = state.sourceProduct?.title || $("#le-title").value || "";
  if (!t) { toast("缺少商品标题", "error"); return; }
  const attrName = (attr.name || "").toLowerCase();
  // Hashtag attribute -> use dedicated generate-hashtags endpoint
  if (attrName.includes("主题标签") || attrName.includes("хештег") || attr.name.startsWith("#")) {
    aiCall($(`.le-ai-btn[data-attr-id="${attrId}"]`), async () => {
      const catZh = $("#le-category-search").value || "";
      const r = await api("POST", "/api/v1/ai/generate-hashtags", {
        title: t, description: $("#le-description").value || "", category_zh: catZh
      });
      const inp = $(`.le-attr-input[data-attr-id="${attrId}"]`);
      if (inp) inp.value = r.hashtags;
      state.attrValues[attrId] = { value_id: null, value_text: r.hashtags };
      toast("已生成20–30个俄文主题标签", "success");
    });
    return;
  }
  // Rich content attribute -> use dedicated generate-rich-content endpoint
  if (attrName.includes("json") || attrName.includes("富内容") || attrName.includes("rich")) {
    aiCall($(`.le-ai-btn[data-attr-id="${attrId}"]`), async () => {
      const sn = $("#le-shop-select").selectedOptions[0]?.textContent || "";
      const r = await api("POST", "/api/v1/ai/generate-rich-content", {
        description: $("#le-description").value || "", image_urls: publicGalleryImages().slice(0, 5), shop_name: sn
      });
      const inp = $(`.le-attr-input[data-attr-id="${attrId}"]`);
      if (inp) inp.value = r.raw_json || "";
      state.richContentCompact = r.rich_content; state.richContentAuto = true;
      state.attrValues[attrId] = { value_id: null, value_text: r.rich_content || r.raw_json || "" };
      toast("已生成富内容JSON", "success");
    });
    return;
  }
  // Description attribute -> use dedicated generate-description endpoint
  if (attrName.includes("描述") || attrName.includes("описан")) {
    aiCall($(`.le-ai-btn[data-attr-id="${attrId}"]`), async () => {
      const r = await api("POST", "/api/v1/ai/generate-description", {
        title: t, source_description: state.sourceProduct?.raw_json?.source_description || "",
        attributes: state.sourceProduct?.raw_json?.attributes || []
      });
      const inp = $(`.le-attr-input[data-attr-id="${attrId}"]`);
      if (inp) inp.value = r.description || "";
      state.attrValues[attrId] = { value_id: null, value_text: r.description };
      toast("已生成产品描述", "success");
    });
    return;
  }
  // Default: generic attribute suggestion
  aiCall($(`.le-ai-btn[data-attr-id="${attrId}"]`), async () => {
    let dictOpts = null;
    if (attr.dictionary_id) {
      try { dictOpts = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attrId}/values?query=${encodeURIComponent(t.slice(0,5))}&limit=30`); } catch (_) {}
    }
    const r = await api("POST", "/api/v1/ai/suggest-attribute", {
      attribute_name: attr.name, attribute_description: "",
      product_title: t, product_description: $("#le-description").value || "",
      dictionary_options: dictOpts
    });
    if (applyAttributeSuggestion(attr, r, dictOpts)) {
      toast(`已推荐: ${r.value}`, "success");
    } else if (isDictionaryAttribute(attr)) {
      toast("未在 Ozon 下拉菜单中找到可用选项，未填写；请从菜单选择。", "error");
    } else {
      toast("AI 未返回可用内容", "error");
    }
  });
}
async function aiFillAllAttrs(btn) { if (!state.attributes.length) { toast("请先选择类目", "error"); return; } aiCall(btn, async () => { const t = state.sourceProduct?.title || $("#le-title").value || ""; if (!t) { toast("缺少商品标题", "error"); return; } let filled = 0; for (const attr of state.attributes.filter(a => a.required)) { if (state.attrValues[attr.id]?.value_text) continue; const an = (attr.name || "").toLowerCase(); if (an.includes("主题标签") || an.includes("хештег") || attr.name.startsWith("#") || an.includes("json") || an.includes("富内容") || an.includes("rich")) continue; try { let dictOpts = null; if (isDictionaryAttribute(attr)) { try { dictOpts = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attr.id}/values?query=${encodeURIComponent(t.slice(0,5))}&limit=30`); } catch (_) {} } const r = await api("POST", "/api/v1/ai/suggest-attribute", { attribute_name: attr.name, product_title: t, product_description: $("#le-description").value || "", dictionary_options: dictOpts }); if (applyAttributeSuggestion(attr, r, dictOpts)) filled++; } catch (_) {} } toast(`已填充 ${filled} 个必填属性`, "success"); }); }

function setupVideoHandlers() {
  const urlInput = $("#le-video-url");
  const player = $("#le-video-player");
  const removeBtn = $("#le-video-remove");
  function updatePlayer() {
    const url = urlInput.value.trim();
    if (url && (url.endsWith(".mp4") || url.endsWith(".webm") || url.includes("video"))) {
      const previewUrl = videoPreviewUrl(url);
      player.innerHTML = `<video src="${esc(previewUrl)}" controls style="max-width:100%;max-height:240px;border-radius:6px"></video><small class="le-hint le-video-preview-error" hidden>视频源拒绝播放，请在 1688 商品页重新采集后再试。</small>`;
      player.querySelector("video").addEventListener("error", () => player.querySelector(".le-video-preview-error").hidden = false, { once: true });
      player.style.display = "block";
    } else if (url) {
      player.innerHTML = `<small class="le-hint">视频链接已填入，预览不支持此格式</small>`;
      player.style.display = "block";
    } else {
      player.style.display = "none";
      player.innerHTML = "";
    }
  }
  urlInput.addEventListener("input", updatePlayer);
  removeBtn.addEventListener("click", () => { urlInput.value = ""; updatePlayer(); });
}
function videoPreviewUrl(url) {
  // The external media proxy rejects the browser's playback request. The local
  // endpoint resolves only an allowed 1688/Taobao source with the supplier
  // referer, then redirects the player to the signed CDN video URL.
  if (/^https:\/\/media\.woxq\.cn\/proxy\?/i.test(url)) return `${API_BASE}/api/v1/media-preview?url=${encodeURIComponent(url)}`;
  return url;
}
function autoFillVideoFromSource() {
  if (!state.sourceProduct?.media) return;
  const video = state.sourceProduct.media.find(m => m.media_type === "video");
  // Never overwrite a video link deliberately saved on an existing draft.
  if (video && video.url && !$("#le-video-url").value.trim()) { $("#le-video-url").value = video.url; $("#le-video-url").dispatchEvent(new Event("input")); }
}

function isDictionaryAttribute(attr) {
  return Boolean(attr?.dictionary_id && String(attr.dictionary_id).trim());
}

function dictionaryMenuOption(options, valueId) {
  const id = String(valueId || "").trim();
  return id ? (options || []).find(option => String(option.id || "") === id) || null : null;
}

function applyAttributeSuggestion(attr, result, options) {
  if (!result || (!result.value && !result.value_id && !result.value_ids?.length)) return false;
  const input = $(`.le-attr-input[data-attr-id="${attr.id}"]`);
  if (!isDictionaryAttribute(attr)) {
    state.attrValues[attr.id] = { value_id: null, value_text: result.value, method: result.method || "ai" };
    if (input) input.value = result.value;
    return true;
  }
  // Collection dictionaries must be persisted as individual menu selections.
  // Never place AI pipe/comma-delimited text into the input as a scalar.
  if (attr.is_collection) {
    const candidateIds = Array.isArray(result.value_ids)
      ? result.value_ids.map(String)
      : String(result.value_id || "").split("|").map(v => v.trim()).filter(Boolean);
    const candidateTexts = Array.isArray(result.value_texts)
      ? result.value_texts.map(v => String(v || ""))
      : String(result.value || "").split("|").map(v => v.trim()).filter(Boolean);
    if (!candidateIds.length) return false;
    const selected = candidateIds.map((id, index) => {
      const option = dictionaryMenuOption(options, id);
      if (!option) return null;
      return { id: String(option.id), value: option.value || candidateTexts[index] || "" };
    });
    if (selected.some(option => !option)) return false;
    state.attrValues[attr.id] = {
      value_ids: selected.map(option => option.id),
      value_texts: selected.map(option => option.value),
      is_collection: true,
      method: result.method || "ai_match",
    };
    if (input) input.value = selected.map(option => option.value).join(", ");
    return true;
  }
  const option = dictionaryMenuOption(options, result.value_id);
  if (!option) return false;
  state.attrValues[attr.id] = { value_id: String(option.id), value_text: option.value, method: result.method || "ai_match" };
  if (input) {
    input.value = option.value;
    input.dataset.selectedValueId = String(option.id);
    input.dataset.selectedValueText = option.value;
  }
  return true;
}

// Central handler: called whenever state.images changes (add/delete/replace/reorder).
// Ensures variant images, color samples, and rich-content JSON all stay in sync.
// Translate selected images via Xiangji (象寄)
async function translateSelectedImages() {
  if (!state.selectedImages.size) { toast("请先点击选择要翻译的图片", "error"); return; }
  const indices = Array.from(state.selectedImages).sort((a, b) => a - b);
  const publicImages = publicGalleryImages();
  const urls = indices.map(i => publicImages[i]).filter(Boolean);
  if (!urls.length) { toast("无有效图片URL", "error"); return; }

  const btn = $("#le-translate-images");
  if (btn) { btn.textContent = "翻译中..."; btn.disabled = true; }
  toast(`正在翻译 ${urls.length} 张图片...`, "");

  try {
    const r = await api("POST", "/api/v1/image/translate", {
      urls: urls, source_lang: "CHS", target_lang: "RUS"
    });
    // Xiangji returns translated[]; the backend also exposes results[] so
    // partial responses keep their original request index.
    const results = Array.isArray(r.results) ? r.results : (Array.isArray(r.translated) ? r.translated.map((url, index) => ({
      index, source_url: urls[index], translated_url: url, error: null,
    })) : []);
    const succeeded = results.filter(item => item && item.translated_url);
    if (succeeded.length) {
      // The API returns the original request index, so partial failures cannot
      // shift a later result onto a different product image.
      for (const item of succeeded) {
        const publicIndex = indices[item.index];
        const source = publicImages[publicIndex];
        const imageIndex = state.images.indexOf(source);
        if (imageIndex >= 0) state.images[imageIndex] = item.translated_url;
      }
      state.selectedImages.clear();
      // Cache original->translated URL mapping for persistence
      for (const item of succeeded) {
        if (!state.translatedImageCache) state.translatedImageCache = {};
        state.translatedImageCache[item.source_url] = item.translated_url;
      }
      // Persist to backend cache
      try {
        const mappings = {};
        for (const item of succeeded) mappings[item.source_url] = item.translated_url;
        if (Object.keys(mappings).length) {
          await api("POST", "/api/v1/image/translation-cache", { mappings });
        }
      } catch (_) {}
      onImagesChanged();
      const failures = results.filter(item => item && item.error);
      if (failures.length) {
        const details = failures.map(item => `第 ${item.index + 1} 张：${item.error}${item.request_id ? `（请求号 ${item.request_id}）` : ""}`).join("；");
        toast(`已翻译 ${succeeded.length} 张；${details}`, "error");
        console.error("Image translation failures:", failures);
      } else {
        toast(`已翻译 ${succeeded.length} 张图片`, "success");
      }
    } else {
      const details = results.filter(item => item && item.error).map(item => `第 ${item.index + 1} 张：${item.error}${item.request_id ? `（请求号 ${item.request_id}）` : ""}`).join("；");
      toast(details || "翻译返回空结果，请检查 API 返回", "error");
        console.error("Xiangji image translation response:", r);
    }
  } catch (e) {
    toast("图片翻译失败: " + e.message, "error");
  } finally {
    if (btn) { btn.textContent = "翻译图片"; btn.disabled = false; }
  }
}

function onImagesChanged() {
  // 0. Clear image selection (indices may have changed)
  state.selectedImages.clear();
  // Public product images and SKU-specific images are separate collections.
  // Never overwrite a SKU image when the public gallery changes.
  state.skuImageUrls = skuImageUrlSet();
  // 2. Re-render gallery
  renderImages();
  // 3. Re-render variant table (updates color samples + product images)
  if (state.variants && state.variants.length) {
    renderVariantTable();
    renderColorSamples();
  }
  // 4. Update image URLs inside existing rich-content JSON
  updateRichContentImages();
}

// Update image blocks in existing rich-content JSON to match current gallery.
// Preserves text blocks; replaces all raShowcase image blocks with current images.
function updateRichContentImages() {
  const richEl = $("#le-rich-content");
  if (!richEl || !richEl.value.trim()) return;
  try {
    const richObj = JSON.parse(richEl.value.trim());
    if (!richObj.content || !Array.isArray(richObj.content)) return;
    // Keep text blocks, drop old image blocks
    const textBlocks = richObj.content.filter(w => w.widgetName === "raTextBlock");
    const currentImgs = publicGalleryImages().slice(0, 5).filter(u => u && u.trim());
    const imgBlocks = currentImgs.length ? [{
      widgetName: "raShowcase",
      type: "roll",
      blocks: currentImgs.map(url => ({
        imgLink: "",
        img: { src: url.trim(), srcMobile: url.trim(), alt: "", position: "width_full", positionMobile: "width_full" }
      }))
    }] : [];
    richObj.content = [...textBlocks, ...imgBlocks];
    richObj.version = 0.3;
    richEl.value = JSON.stringify(richObj, null, 2);
    state.richContentCompact = JSON.stringify(richObj);
  } catch (_) { /* malformed JSON – leave untouched */ }
}

function allSkuGalleryImages() {
  const groups = [];
  (state.variants || []).forEach((v, i) => {
    const urls = (Array.isArray(v.image_urls) ? v.image_urls : []).map(u => String(u || "").trim()).filter(Boolean);
    if (!urls.length) return;
    const name = String(v.name_ru || v.seller_sku || `SKU ${i + 1}`).trim();
    groups.push({ skuName: name, urls });
  });
  return groups;
}

function renderImages() {
  const g = $("#le-image-grid");
  const images = publicGalleryImages();
  const skuGroups = allSkuGalleryImages();
  const skuCount = skuGroups.reduce((n, e) => n + e.urls.length, 0);
  $("#le-image-count").textContent = (images.length || skuCount)
    ? `(${images.length} 张公共产品图${skuCount ? ` + ${skuCount} 张SKU图` : ""})` : "";
  const skuHtml = skuGroups.length
    ? `<div style="grid-column:1/-1;margin-top:14px;border-top:1px dashed #d0d0d0;padding-top:10px"><div style="font-size:12px;color:#888;margin-bottom:8px">SKU 图集（按变体归属，同时在变体表“产品图”列展示，共 ${skuCount} 张）</div>${skuGroups.map(grp => `<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:600;color:#444;margin-bottom:6px">${esc(grp.skuName)} (${grp.urls.length})</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">${grp.urls.map(u => `<div style="position:relative;aspect-ratio:1;border:1px solid #e2e2e2;border-radius:5px;overflow:hidden;background:#f7f7f7;cursor:pointer" onclick="zoomSkuImage('${esc(u)}')" title="查看大图"><img src="${esc(u)}" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover" /><div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:2px 4px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(grp.skuName)}</div></div>`).join("")}</div></div>`).join("")}</div>`
    : "";
  g.innerHTML = images.map((url, i) => {
    const selected = state.selectedImages.has(i);
    return `<div class="le-image-card ${i === 0 ? "le-image-primary" : ""} ${selected ? "le-image-selected" : ""}" data-index="${i}" onclick="toggleImageSelect(${i})" style="cursor:pointer">
      <img src="${esc(url)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" />
      <button class="le-image-remove" onclick="event.stopPropagation();removeImage(${i})">×</button>
      <button class="le-image-zoom" onclick="event.stopPropagation();zoomImage(${i})" title="放大查看">\uD83D\uDD0D</button>
      ${selected ? '<div class="le-image-selected-badge">\u2713</div>' : ''}
      <div class="le-image-resolution">${i === 0 ? "主图" : ""}</div>
    </div>`;
  }).join("") + skuHtml;
  const tBtn = $("#le-translate-images");
  if (tBtn) {
    const cnt = state.selectedImages.size;
    tBtn.textContent = cnt ? `翻译图片 (${cnt})` : "翻译图片";
  }
}

// Full-size product gallery viewer. It stays open while the operator moves
// through the complete public gallery with buttons or keyboard arrows.
window.zoomImage = function(index) {
  const images = publicGalleryImages();
  if (!images[index]) return;
  let dialog = $("#le-product-image-viewer");
  if (!dialog) {
    document.body.insertAdjacentHTML("beforeend", '<dialog id="le-product-image-viewer" class="le-source-image-dialog le-product-image-viewer"><div class="le-source-image-head"><strong id="le-product-image-title">产品图</strong><button type="button" id="le-product-image-close" aria-label="关闭">×</button></div><div class="le-source-image-stage"><button type="button" id="le-product-image-prev" aria-label="上一张">‹</button><img id="le-product-image-large" alt="产品大图" referrerpolicy="no-referrer"><button type="button" id="le-product-image-next" aria-label="下一张">›</button></div><div class="le-source-image-foot"><span id="le-product-image-count"></span><small>← → 可切换图片</small><button type="button" id="le-product-image-done">关闭</button></div></dialog>');
    dialog = $("#le-product-image-viewer");
    $("#le-product-image-close").onclick = () => dialog.close();
    $("#le-product-image-done").onclick = () => dialog.close();
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  }
  let current = index;
  const show = () => {
    $("#le-product-image-large").src = images[current];
    $("#le-product-image-title").textContent = current === 0 ? "产品图 · 主图" : "产品图";
    $("#le-product-image-count").textContent = `${current + 1} / ${images.length}`;
    $("#le-product-image-prev").disabled = images.length < 2;
    $("#le-product-image-next").disabled = images.length < 2;
  };
  const previous = () => { current = (current - 1 + images.length) % images.length; show(); };
  const next = () => { current = (current + 1) % images.length; show(); };
  $("#le-product-image-prev").onclick = previous;
  $("#le-product-image-next").onclick = next;
  dialog.onkeydown = event => {
    if (event.key === "ArrowLeft") { event.preventDefault(); previous(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); next(); }
    else if (event.key === "Escape") dialog.close();
  };
  show();
  dialog.showModal();
  dialog.focus();
};

window.zoomSkuImage = function(url) {
  if (!url) return;
  let dialog = $("#le-sku-image-viewer");
  if (!dialog) {
    document.body.insertAdjacentHTML("beforeend", '<dialog id="le-sku-image-viewer" style="padding:0;border:none;border-radius:8px;background:#fff;max-width:90vw"><div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #eee"><strong>SKU 图</strong><button type="button" id="le-sku-image-close" style="border:none;background:none;font-size:18px;cursor:pointer;color:#888" aria-label="关闭">\u00d7</button></div><img id="le-sku-image-large" alt="SKU 图" referrerpolicy="no-referrer" style="display:block;max-width:100%;max-height:80vh;margin:0 auto" /></dialog>');
    dialog = $("#le-sku-image-viewer");
    $("#le-sku-image-close").onclick = () => dialog.close();
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    dialog.onkeydown = event => { if (event.key === "Escape") dialog.close(); };
  }
  $("#le-sku-image-large").src = url;
  dialog.showModal();
  dialog.focus();
};

window.toggleImageSelect = function(i) {
  if (state.selectedImages.has(i)) state.selectedImages.delete(i);
  else state.selectedImages.add(i);
  renderImages();
};
window.removeImage = function(i) { const target = publicGalleryImages()[i]; const at = state.images.indexOf(target); if (at >= 0) state.images.splice(at, 1); onImagesChanged(); };
function addImage() { const u = $("#le-image-url-input").value.trim(); if (!u) return; if (!u.startsWith("http")) { toast("请输入有效的图片 URL", "error"); return; } state.images.push(u); $("#le-image-url-input").value = ""; onImagesChanged(); }
function importSourceImages() {
  if (!state.sourceProduct?.media?.length) { toast("没有采集图片可导入", "error"); return; }
  let urls = state.sourceProduct.media.filter(m => m.media_type === "image").map(m => m.url);
  urls = urls.filter(u => !u.endsWith("_"));
  urls = urls.filter(u => !u.includes("_60x60") && !u.includes("_50x50") && !u.includes("_40x40") && !u.includes("_30x30"));
  const seen = new Set();
  urls = urls.filter(u => { const k = u.toLowerCase().replace(/\.jpg_$/, ".jpg"); if (seen.has(k)) return false; seen.add(k); return true; });
  const nu = urls.filter(u => !state.images.includes(u));
  state.images.push(...nu);
  onImagesChanged();
  toast(`导入了 ${nu.length} 张采集图片`, "success");
}

function identifyVariantAttributes() {
  // List all is_aspect attributes, let user choose which to use as variant dimensions
  const aspectAttrs = state.attributes.filter(a => a.is_aspect);
  const c = $("#le-variant-attrs");

  if (!aspectAttrs.length) {
    state.variantDimensions = [];
    c.innerHTML = '<small class="le-hint">当前类目未识别到可映射的变体属性；仍将保留采集到的每个 SKU，属性可稍后补选。</small>';
    $("#le-variant-color-samples").style.display = "none";
    if (state.sourceProduct && !state.variants.length) autoPopulateVariantsFromSource();
    return;
  }

  // Default: auto-select color-like attributes, leave others unchecked
  const isColorLike = (a) => {
    const n = (a.name || "").toLowerCase();
    return n.includes("颜色") || n.includes("цвет") || n.includes("color");
  };
  // Initialize selected set if not yet set
  if (!state._selectedAspects) {
    state._selectedAspects = new Set();
    aspectAttrs.forEach(a => { if (isColorLike(a) && !isColorNameVariantAttribute(a)) state._selectedAspects.add(String(a.id)); });
    // Ozon captures carry every real variant dimension in their SKU spec
    // (e.g. "颜色: 米色, 紫红色 / 每包数量,pcs: 2"). Auto-select any aspect
    // whose name matches a dimension present in the captured spec, so the
    // variant table opens with the true Ozon dimensions (colour x qty)
    // instead of colour alone; an operator can still uncheck them.
    const sourceDims = new Set();
    (state.sourceProduct?.variants || []).forEach(sv => {
      parseSourceSkuSpec(sv.spec_name || "").forEach(item => {
        const n = String(item.attributeName || item.name || "").trim().toLowerCase();
        if (n) sourceDims.add(n);
      });
    });
    if (sourceDims.size) {
      aspectAttrs.forEach(a => {
        if (isColorNameVariantAttribute(a)) return; // free-text colour-name column stays manual
        const target = String(a.name || "").trim().toLowerCase();
        if (!target) return;
        if (sourceDims.has(target)) { state._selectedAspects.add(String(a.id)); return; }
        const colorFuzzy = [...sourceDims].some(d =>
          (target.includes("颜色") || target.includes("цвет") || target.includes("color"))
          && (d.includes("颜色") || d.includes("цвет") || d.includes("color")));
        const sizeFuzzy = !(target.includes("颜色") || target.includes("цвет") || target.includes("color"))
          && [...sourceDims].some(d => SIZE_VARIANT_NAME_RE.test(target) && SIZE_VARIANT_NAME_RE.test(d));
        if (colorFuzzy || sizeFuzzy) state._selectedAspects.add(String(a.id));
      });
    }
  }

  // Build checkbox UI
  const checkboxes = aspectAttrs.map(a => {
    const aid = String(a.id);
    const checked = state._selectedAspects.has(aid) ? "checked" : "";
    return `<label style="display:inline-flex;align-items:center;gap:3px;font-size:13px;margin-right:10px;cursor:pointer;white-space:nowrap">
      <input type="checkbox" class="le-aspect-cb" data-attr-id="${aid}" data-attr-name="${esc(a.name)}" ${checked} />
      ${esc(a.name)}
    </label>`;
  }).join("");

  c.innerHTML = `<small class="le-hint" style="margin-bottom:6px;display:block">可选变体维度（勾选启用的维度，不勾选的不作为 SKU 区分项）：</small>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">${checkboxes}</div>`;

  // Wire up checkbox changes
  $$(".le-aspect-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      const aid = cb.dataset.attrId;
      if (cb.checked) state._selectedAspects.add(aid);
      else state._selectedAspects.delete(aid);
      updateVariantDimensions();
    });
  });

  updateVariantDimensions();
}

// Rebuild state.variantDimensions from selected aspects + re-render
function updateVariantDimensions() {
  const aspectAttrs = state.attributes.filter(a => a.is_aspect);
  state.variantDimensions = aspectAttrs.filter(a => state._selectedAspects?.has(String(a.id)));

  // Source data and Ozon attributes arrive independently.  A new source can
  // create its SKU rows before the category's aspect attributes finish
  // loading; in that order the rows used to keep empty values forever.  Fill
  // only newly exposed *empty* dimensions from the matching source SKU.  This
  // deliberately never overwrites an operator's saved selection or text.
  if (state.sourceProduct && state.variants.length) {
    backfillVariantValuesFromSource();
  }

  // Show/hide color samples
  const hasColor = state.variantDimensions.some(a => {
    const n = (a.name || "").toLowerCase();
    return n.includes("颜色") || n.includes("цвет") || n.includes("color");
  });
  $("#le-variant-color-samples").style.display = hasColor ? "flex" : "none";

  // Auto-populate from source if variants empty and source exists
  if (state.sourceProduct && !state.variants.length) {
    autoPopulateVariantsFromSource();
  } else {
    renderVariantTable();
    renderColorSamples();
  }
}

async function autoPopulateVariantsFromSource(placeholderVariant = null) {
  if (!state.sourceProduct || !state.sourceProduct.variants) return;
  const allSourceVariants = state.sourceProduct.variants;
  // Ozon public pages never expose stock, so the captured value is 'unknown',
  // never a real 'out of stock'. Filtering it out emptied the whole variant
  // table for every Ozon capture. For Ozon sources keep every SKU regardless
  // of the (unknown/zero) stock value; 1688 sources keep the stock>0 rule.
  const isOzonSource = String(state.sourceProduct.source_platform || "").includes("ozon");
  const sourceVariants = allSourceVariants.filter(sv => {
    if (isOzonSource) return true;
    if (sv.stock === null || sv.stock === undefined || sv.stock === "") return true;
    const stock = Number(sv.stock);
    return !Number.isFinite(stock) || stock > 0;
  });
  const excludedCount = allSourceVariants.length - sourceVariants.length;
  if (!sourceVariants.length) {
    toast("采集商品的全部 SKU 库存均为 0，已阻止生成上架变体", "error");
    renderVariantTable();
    renderColorSamples();
    return;
  }
  if (state.variants.length > 0) return; // Don't overwrite existing

  const variantAttrs = state.variantDimensions || [];
  const oid = $("#le-offer-id").value || "SKU";

  // Extract weight/dims from source product packageInfo (API field) + raw_json fallback
  const pkg = state.sourceProduct.packageInfo || {};
  let raw = {};
  try { raw = typeof state.sourceProduct.raw_json === "string"
    ? JSON.parse(state.sourceProduct.raw_json) : (state.sourceProduct.raw_json || {}); } catch (_) {}
  const rawPkg = raw.packageInfo || {};
  let srcWeight = pkg.weightG || rawPkg.weightG || null;
  let srcLength = pkg.lengthMm || rawPkg.lengthMm || null;
  let srcWidth = pkg.widthMm || rawPkg.widthMm || null;
  let srcHeight = pkg.heightMm || rawPkg.heightMm || null;
  // Fallback: search attributes array
  const srcAttrs = raw.attributes || [];
  for (const a of srcAttrs) {
    const n = (a.name || "").toLowerCase();
    const v = a.value || "";
    if (!srcWeight && (n.includes("重量") || n.includes("вес") || n.includes("weight"))) srcWeight = v;
    if (!srcLength && (n.includes("长") || n.includes("длин"))) srcLength = v;
    if (!srcWidth && (n.includes("宽") || n.includes("ширин"))) srcWidth = v;
    if (!srcHeight && (n.includes("高") || n.includes("высот"))) srcHeight = v;
  }

  state.variants = sourceVariants.map((sv, i) => {
    const specName = sv.spec_name || sv.source_sku || `variant-${i+1}`;
    const structured = parseSourceSkuSpec(specName);
    const parts = structured.length ? structured.map(x => String(x.attributeValue || x.value || "").trim()).filter(Boolean) : specName.split(/[‐–—·]/);
    const primaryValue = parts[0] || specName;
    const sourceVariantLabel = parts.filter(Boolean).join(" / ") || specName;

    const variantValues = {};
    variantAttrs.forEach((attr, idx) => {
      const matched = structured.find(x => {
        const n = String(x.attributeName || x.name || "").toLowerCase();
        const target = String(attr.name || "").toLowerCase();
        return n && (n === target
          || (n.includes("颜色") && (target.includes("цвет") || target.includes("color") || target.includes("颜色")))
          || (SIZE_VARIANT_NAME_RE.test(n) && SIZE_VARIANT_NAME_RE.test(target)));
      });
      if (matched) variantValues[attr.name] = String(matched.attributeValue || matched.value || "");
      else if (isColorNameVariantAttribute(attr)) variantValues[attr.name] = sourceVariantLabel;
      else if (isColorVariantAttribute(attr)) variantValues[attr.name] = "";
      else if (idx === 0) variantValues[attr.name] = primaryValue;
      else if (parts.length > idx) variantValues[attr.name] = parts[idx];
    });

    const suffix = (sv.source_sku || primaryValue).replace(/[^\w\u4e00-\u9fff]/g, "").slice(0, 20) || `v${i+1}`;

    const srcPrice = parseFloat(sv.price_cny);

    return {
      seller_sku: `${oid}-${suffix}`,
      // A legacy draft may have one erroneous parent-SKU placeholder. Keep
      // operator-entered common fields when expanding it, but always take
      // SKU-specific evidence (source price, image and package) from 1688.
      barcode: placeholderVariant?.barcode || "",
      source_price_cny: Number.isFinite(srcPrice) ? srcPrice : null,
      source_variant_label: sourceVariantLabel,
      price_cny: placeholderVariant?.price_cny || "",
      old_price_cny: placeholderVariant?.old_price_cny || "",
      min_price_cny: placeholderVariant?.min_price_cny || "",
      cost_cny: placeholderVariant?.cost_cny || "",
      stock: placeholderVariant?.stock || "999",
      warehouse_level: placeholderVariant?.warehouse_level || "",
      // 1688 may provide different package measurements per SKU. Product-level
      // packageInfo is only a fallback when this particular SKU has no evidence.
      length_mm: sv.lengthMm || srcLength || "",
      width_mm: sv.widthMm || srcWidth || "",
      height_mm: sv.heightMm || srcHeight || "",
      weight_g: sv.weightG || srcWeight || "",
      name_ru: placeholderVariant?.name_ru || "",
      image_url: sv.image_url || sv.sku_image_url || "",
      variant_values: variantValues,
      combo: variantValues
    };
  });

  await autoMatchVariantColors();
  renderVariantTable();
  renderColorSamples();
  if (excludedCount) toast(`已排除 ${excludedCount} 个货源库存为 0 的 SKU，保留 ${sourceVariants.length} 个可售 SKU`, "success");
  const quotable = state.variants.every(v => v.source_price_cny !== null && Number(v.weight_g) > 0 && Number(v.length_mm) > 0 && Number(v.width_mm) > 0 && Number(v.height_mm) > 0);
  if (quotable) {
    try {
      const response = await api("POST", "/api/v1/pricing/quotes", {
        shop_id: Number(state.shopId),
        items: state.variants.map(v => ({
          source_sku: v.seller_sku,
          source_price_cny: v.source_price_cny,
          weight_g: Number(v.weight_g),
          length_mm: Number(v.length_mm),
          width_mm: Number(v.width_mm),
          height_mm: Number(v.height_mm)
        }))
      });
      response.results.forEach((quote, index) => {
        const variant = state.variants[index];
        variant.cost_cny = String(quote.purchase_cost_cny);
        variant.price_cny = String(quote.price_cny);
        variant.old_price_cny = String(quote.old_price_cny);
        variant.min_price_cny = String(quote.min_price_cny);
        variant.warehouse_level = quote.shipping_level;
        variant.shipping_fee = quote.logistics_fee_cny;
      });
      renderVariantTable();
      toast(`已按当前自动定价策略计算 ${state.variants.length} 个变体`, "success");
    } catch (error) {
      toast(error.message || "自动定价失败，请检查定价参数", "error");
    }
  } else {
    toast("变体已导入；货源价或包装尺重不完整，自动定价已阻塞", "error");
  }
  // Match warehouse for each variant based on weight, price, dimensions
  await matchVariantWarehouses();
}

const AI_IMAGE_DEFAULT_SLOTS = [
  {slot:"hero",title:"销售首图"},
  {slot:"dimensions",title:"尺寸规格"},
  {slot:"details",title:"结构细节"},
  {slot:"steps",title:"使用步骤"},
  {slot:"lifestyle",title:"场景用途"},
  {slot:"scene_home",title:"居家场景"},
  {slot:"scene_entry",title:"玄关场景"},
  {slot:"scene_gift",title:"礼赠场景"}
];

const SIZE_VARIANT_NAME_RE = /(尺寸|尺码|大小|size|dimension|规格|length|width|height|длин|ширин|размер|数量|每包|колич|qty|quantity)/i;
const STYLE_VARIANT_NAME_RE = /(款式|花色|图案|颜色|color|цвет|style|model|модель)/i;

function sourceVariantForEditorVariant(variant) {
  const sellerSku = String(variant?.seller_sku || "");
  const imageUrl = String(variant?.image_url || "");
  return (state.sourceProduct?.variants || []).find(source => {
    const sourceSku = String(source?.source_sku || "");
    return (sourceSku && sellerSku.endsWith(sourceSku)) || (imageUrl && imageUrl === String(source?.image_url || source?.sku_image_url || ""));
  }) || null;
}

function styleVariantDimension() {
  const candidates = (state.variantDimensions || []).filter(attr => {
    const name = String(attr?.name || "");
    return name && !SIZE_VARIANT_NAME_RE.test(name) && !isColorNameVariantAttribute(attr);
  });
  return candidates.find(attr => STYLE_VARIANT_NAME_RE.test(String(attr.name || ""))) || candidates[0] || null;
}

function sourceStyleEvidence(variant) {
  const source = sourceVariantForEditorVariant(variant);
  const specName = String(source?.spec_name || variant?.spec_name || variant?.source_variant_label || "").trim();
  const structured = parseSourceSkuSpec(specName);
  const entry = structured.find(item => {
    const name = String(item?.attributeName || item?.name || "");
    return name && !SIZE_VARIANT_NAME_RE.test(name) && STYLE_VARIANT_NAME_RE.test(name);
  }) || structured.find(item => !SIZE_VARIANT_NAME_RE.test(String(item?.attributeName || item?.name || "")));
  if (entry) {
    const value = String(entry.attributeValue || entry.value || "").trim();
    if (value) return { name: String(entry.attributeName || entry.name || "款式"), value };
  }
  // Some extension snapshots are plain text such as "橡木色 - 45×75cm".
  // The leading token is the only safe style evidence; never fall back to a
  // generated seller SKU, otherwise every size becomes a fake style group.
  const first = specName.split(/[|,，;；/\\\n]|\s+-\s+|\s+—\s+|\s+–\s+/).map(token => token.trim()).find(Boolean);
  return first ? { name: "款式", value: first } : null;
}

function creativeGroupForVariant(variant) {
  const dimension = styleVariantDimension();
  const name = String(dimension?.name || "").trim();
  let value = name ? String(variant?.variant_values?.[name] || "").trim() : "";
  const sourceEvidence = sourceStyleEvidence(variant);
  if (!value && sourceEvidence) value = sourceEvidence.value;
  // An unlabelled single-SKU source has no reliable shared-style evidence.
  // It remains a singleton, but is explicitly marked rather than pretending
  // the generated Ozon SKU is a product style.
  if (!value) value = "未识别款式";
  const groupName = name || sourceEvidence?.name || "款式";
  const sourceIdentity = value === "未识别款式" ? String(variant?.seller_sku || "未识别") : value;
  return { key: `${groupName}:${sourceIdentity}`, label: value, dimension };
}

function variantCreativeGroups() {
  const groups = new Map();
  state.variants.forEach((variant, index) => {
    const group = creativeGroupForVariant(variant);
    const existing = groups.get(group.key) || { ...group, indexes: [], image_url: "" };
    existing.indexes.push(index);
    if (!existing.image_url) existing.image_url = variant.image_url || "";
    groups.set(group.key, existing);
  });
  return [...groups.values()];
}

function creativeGroupAtIndex(index) {
  return variantCreativeGroups().find(group => group.indexes.includes(index)) || null;
}

function applyImagesToCreativeGroup(index, imageUrls) {
  const group = creativeGroupAtIndex(index);
  const urls = [...new Set((imageUrls || []).map(url => String(url || "").trim()).filter(Boolean))];
  const indexes = group?.indexes || [index];
  indexes.forEach(variantIndex => {
    const variant = state.variants[variantIndex];
    if (!variant) return;
    variant.image_urls = [...urls];
    variant.image_url = urls[0] || "";
  });
  return group;
}

function syncAiCreativeGroupPicker() {
  const picker = $("#le-ai-creative-group");
  if (!picker) return;
  const groups = variantCreativeGroups();
  // Always keep the global ("current product") option so operators can generate
  // a shared gallery for all SKUs even when style variants exist.
  const globalOption = '<option value="__product__">当前商品（全局生图，所有 SKU 共用）</option>';
  const styleOptions = groups.map(group => `<option value="${esc(group.key)}">${esc(group.label)}（${group.indexes.length} 个尺寸 SKU）</option>`).join("");
  picker.innerHTML = globalOption + styleOptions;
  // If the current key is neither global nor a known style, fall back to global.
  const validKeys = new Set(["__product__", ...groups.map(g => g.key)]);
  if (!validKeys.has(state.aiCreativeGroupKey)) state.aiCreativeGroupKey = "__product__";
  picker.value = state.aiCreativeGroupKey;
}

function renderEmptyAiImageSlots(grid) {
  grid.innerHTML = AI_IMAGE_DEFAULT_SLOTS.map(slot => `<div class="le-ai-image-card le-ai-slot-placeholder state-not_started"><div class="le-ai-slot-empty"><b>○</b></div><span>${esc(slot.title)}</span><small class="le-ai-slot-state">未开始</small><button type="button" class="le-ai-slot-retry" data-ai-retry-slot="${esc(slot.slot)}">生成此图</button></div>`).join("");
  bindAiSlotRetryButtons(grid);
}

function bindAiSlotRetryButtons(grid) {
  grid.querySelectorAll("[data-ai-retry-slot]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    generateAiImages([button.dataset.aiRetrySlot]);
  }));
}

function renderAiImageJob() {
  const job = state.aiImageJob;
  const status = $("#le-ai-image-status");
  const analysis = $("#le-ai-image-analysis");
  const grid = $("#le-ai-image-grid");
  const applyBtn = $("#le-ai-apply-images");
  const selectAll = $("#le-ai-select-all");
  if (!job || job.status === "not_started") { status.textContent = "尚未生成"; analysis.textContent = "每个款式使用自己的 SKU 图作为唯一参考生成 8 张候选图；结果只应用到该款式的尺寸 SKU，不会混入公共详情图库或其他款式。"; renderEmptyAiImageSlots(grid); applyBtn.disabled = true; if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; selectAll.disabled = true; } return; }
  const labels = { queued:"已排队", analyzing:"分析商品图库中", generating:"生成套图中", interrupted:"已中断 · 未自动重试", ready:"生成完成 · 等待选择", applied:"已应用到草稿", failed:"生成结束 · 有失败项" };
  status.textContent = labels[job.status] || job.status;
  const a = job.analysis || {};
  const images = job.generated_images || [];
  if(state.selectedAiJobId!==job.id){state.selectedAiImages=new Set((job.selected_images||[]).length ? job.selected_images : images.map(item=>item.url));state.selectedAiJobId=job.id;}
  const sold = aiAnalysisLabel(a.sold_product, ["sale_subject", "name", "type", "form"]);
  const sku = aiAnalysisLabel(a.sku_strategy, ["strategy", "current_sku_count", "sku_count"]);
  const history = job.attempt_history || [];
  const currentRun = history.filter(item => item.kind === "run").at(-1);
  const currentAttempts = history.filter(item => item.kind === "image_request" && (!currentRun || item.run_id === currentRun.run_id));
  // Counts belong to the current run only. Historical retries remain in the
  // ledger but must not make a Terra-only failure look like Image 2 requests
  // were sent during this run.
  const providerCalls = currentAttempts.filter(item => item.provider_request_started_at);
  const returnedCalls = currentAttempts.filter(item => item.provider_response_at);
  const attemptsBySlot = new Map();
  history.filter(item => item.kind === "image_request").forEach(item => attemptsBySlot.set(item.slot, item));
  const imagesBySlot = new Map(images.map((item, index) => [item.slot, { item, index }]));
  const planBySlot = new Map((job.plan || []).map(item => [item.slot, item]));
  const slots = AI_IMAGE_DEFAULT_SLOTS.map(defaultSlot => ({...defaultSlot, ...(planBySlot.get(defaultSlot.slot) || {})}));
  const slotLabels = { preparing_reference:"准备参考图", provider_requesting:"已发送 · 等待供应商", response_received:"已回包 · 正在保存", succeeded:"生成成功", failed:"生成失败", interrupted_unknown:"进程中断 · 扣费待确认" };
  const activeAttempt = currentAttempts.at(-1);
  const activeAt = activeAttempt?.provider_response_at || activeAttempt?.provider_request_started_at || activeAttempt?.started_at;
  const activeAge = activeAt ? Math.max(0, (Date.now() - Date.parse(activeAt)) / 1000) : 0;
  let guidance = "";
  if (job.status === "failed" && currentAttempts.length === 0) {
    status.textContent = "分析失败 · 本次未生图";
    guidance = `Terra分析失败，本次没有发送Image 2生图请求；已保留此前成功的 ${images.length} 张，可直接使用。`;
  }
  else if (job.status === "generating" && activeAttempt?.state === "response_received" && activeAge > 180) guidance = "当前图片回包后保存超过3分钟，任务可能卡住；不要重复点击生成。重启后会标记为已中断，已生成图片会保留。";
  else if (job.status === "generating") guidance = "任务仍在运行，请等待；各图片会按顺序更新状态。";
  else if (job.status === "interrupted") guidance = images.length ? "任务已中断且不会自动重试；可先使用已生成图片，核对供应商明细后再开启新批次。" : "任务已中断且不会自动重试；请先核对供应商明细，再决定是否开启新批次。";
  else if ((job.status === "failed" || job.status === "ready") && images.length < slots.length) guidance = `本次已结束，成功 ${images.length} 张、失败 ${Math.max(0, slots.length-images.length)} 张；可直接使用成功图片。`;
  else if (job.status === "ready") guidance = "八张均已完成，可选择后应用到当前款式的 SKU 图片库。";
  else if (job.status === "applied") guidance = "所选图片已持久化到当前款式的 SKU 图片库。";
  const error = job.error_message ? `<span class="le-ai-image-error">${esc(job.error_message)}</span>` : "";
  const runInfo = currentRun ? `　<b>本次运行：</b>${esc(currentRun.run_id.slice(-8))}　<b>供应商请求：</b>${providerCalls.length}　<b>已回包：</b>${returnedCalls.length}` : "";
  analysis.innerHTML = `${error}<span class="le-ai-image-progress">已生成 ${images.length} 张，可选 ${state.selectedAiImages.size} 张</span>${runInfo}<div class="le-ai-image-guidance">${esc(guidance)}</div>　<b>识别商品：</b>${esc(sold)}　<b>SKU策略：</b>${esc(sku)}　<b>参考图：</b>${(job.reference_images || []).length}张${a.manual_review_required ? '<span class="le-ai-image-warning">　需要人工注意SKU/事实冲突</span>' : ''}`;
  grid.innerHTML = slots.map(slot => {
    const generated = imagesBySlot.get(slot.slot);
    const attempt = attemptsBySlot.get(slot.slot);
    if (generated) {
      const {item,index}=generated;
      return `<div class="le-ai-image-card selected-ready ${state.selectedAiImages.has(item.url) ? "selected" : ""}" data-ai-image-index="${index}" role="button" tabindex="0" aria-pressed="${state.selectedAiImages.has(item.url)}"><img src="${esc(item.url)}" loading="lazy"><span>${item.slot === "hero" ? "SKU首图 · " : ""}${esc(item.title || slot.title)}</span><small class="le-ai-slot-state success">生成成功</small><div class="le-ai-slot-actions"><button type="button" data-ai-zoom="${index}">放大</button><button type="button" class="le-ai-slot-retry" data-ai-retry-slot="${esc(slot.slot)}">重做此图</button></div></div>`;
    }
    // A missing attempt means this slot was never started/sent, even when an
    // earlier slot caused the overall run to be interrupted.  Only ledger
    // entries explicitly marked interrupted_unknown carry charge uncertainty.
    const attemptState = attempt?.state || "not_started";
    const stateText = slotLabels[attemptState] || (attemptState === "not_started" ? (["interrupted","failed"].includes(job.status) ? "未开始 · 未发送" : "等待前序图片") : attemptState);
    const errorText = attempt?.error ? String(attempt.error).replace(/\s+/g," ").slice(0,160) : "";
    const canRetry = !["queued","analyzing","generating"].includes(job.status) && !["provider_requesting","response_received","preparing_reference"].includes(attemptState);
    return `<div class="le-ai-image-card le-ai-slot-placeholder state-${esc(attemptState)}"><div class="le-ai-slot-empty"><b>${attemptState === "failed" ? "!" : attemptState === "provider_requesting" || attemptState === "response_received" ? "…" : "○"}</b></div><span>${esc(slot.title)}</span><small class="le-ai-slot-state">${esc(stateText)}</small>${errorText ? `<em title="${esc(attempt.error)}">${esc(errorText)}</em>` : ""}${canRetry ? `<button type="button" class="le-ai-slot-retry" data-ai-retry-slot="${esc(slot.slot)}">${attemptState === "failed" || attemptState === "interrupted_unknown" ? "重做此图" : "生成此图"}</button>` : ""}</div>`;
  }).join("");
  grid.querySelectorAll("[data-ai-image-index]").forEach(card => {
    const toggle = () => { const item=images[Number(card.dataset.aiImageIndex)]; if(!item)return; if(state.selectedAiImages.has(item.url))state.selectedAiImages.delete(item.url);else state.selectedAiImages.add(item.url); renderAiImageJob(); };
    card.addEventListener("click", event => { if(event.target.closest("button"))return; toggle(); });
    card.addEventListener("keydown", event => { if(event.key === "Enter" || event.key === " "){event.preventDefault();toggle();} });
  });
  grid.querySelectorAll("[data-ai-zoom]").forEach(button => button.addEventListener("click", event => { event.stopPropagation(); zoomAiImage(Number(button.dataset.aiZoom)); }));
  bindAiSlotRetryButtons(grid);
  const allSelected = images.length > 0 && images.every(item => state.selectedAiImages.has(item.url));
  if (selectAll) { selectAll.disabled = !images.length; selectAll.checked = allSelected; selectAll.indeterminate = !allSelected && state.selectedAiImages.size > 0; }
  if (selectAll && !selectAll.dataset.bound) { selectAll.dataset.bound = "1"; selectAll.addEventListener("change", () => { const current = state.aiImageJob?.generated_images || []; state.selectedAiImages = selectAll.checked ? new Set(current.map(item => item.url)) : new Set(); renderAiImageJob(); }); }
  applyBtn.disabled = !state.selectedAiImages.size || !["ready","failed","interrupted","applied"].includes(job.status);
  applyBtn.title = !state.selectedAiImages.size ? "请至少选择一张图片" : (!state.draftId ? "立即应用到当前编辑器；保存草稿后持久化" : (job.status === "failed" ? "任务部分失败，但可以使用已生成图片" : "将所选图片加入产品图片库"));
}

function isColorVariantAttribute(attr) {
  const name = String(attr?.name || "").toLowerCase();
  // "Color name" is a free-text SKU label, not the Ozon color dictionary
  // dimension.  Treating it as a color causes SKU names to be cleared or
  // passed into dictionary matching instead of being inherited verbatim.
  if (isColorNameVariantAttribute(attr)) return false;
  return name.includes("颜色") || name.includes("цвет") || name.includes("color");
}

function backfillVariantValuesFromSource() {
  const dimensions = state.variantDimensions || [];
  if (!dimensions.length) return false;
  let changed = false;
  for (const variant of state.variants) {
    const sourceVariant = (state.sourceProduct?.variants || []).find(item =>
      item.source_sku && String(variant.seller_sku || "").endsWith(String(item.source_sku))
    );
    if (!sourceVariant) continue;
    const structured = parseSourceSkuSpec(sourceVariant.spec_name || "");
    const parts = structured.length
      ? structured.map(item => String(item.attributeValue || item.value || "").trim()).filter(Boolean)
      : String(sourceVariant.spec_name || "").split(/[‐–—·]/).map(item => item.trim()).filter(Boolean);
    const sourceVariantLabel = parts.join(" / ") || String(sourceVariant.spec_name || "").trim();
    variant.variant_values = variant.variant_values || {};
    for (const [index, attr] of dimensions.entries()) {
      if (String(variant.variant_values[attr.name] || "").trim()) continue;
      const matched = structured.find(item => {
        const sourceName = String(item.attributeName || item.name || "").toLowerCase();
        const target = String(attr.name || "").toLowerCase();
        return sourceName && (sourceName === target
          || (sourceName.includes("颜色") && (target.includes("颜色") || target.includes("цвет") || target.includes("color")))
          || (SIZE_VARIANT_NAME_RE.test(sourceName) && SIZE_VARIANT_NAME_RE.test(target)));
      });
      const value = matched
        ? String(matched.attributeValue || matched.value || "").trim()
        : (isColorNameVariantAttribute(attr)
          ? sourceVariantLabel
          : (!isColorVariantAttribute(attr) ? (parts[index] || "") : ""));
      if (value) {
        variant.variant_values[attr.name] = value;
        changed = true;
      }
    }
  }
  return changed;
}

// Extension snapshots from 1688 can carry either standard JSON or a
// Python-style list of dictionaries.  Normalize both before using an SKU label
// as a color-name candidate; never put the raw serialized object into the UI.
function parseSourceSkuSpec(specName) {
  const text = String(specName || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(item => item && typeof item === "object");
  } catch (_) { /* fall through to the common Python-style snapshot */ }
  // Ozon public collection uses a deliberately readable format such as
  // "颜色: 生机绿意 / 尺寸: 80×100".  Treat it as structured evidence so
  // the editor maps color and size to their own Ozon dimensions instead of
  // falling back to positional values (which merges different style groups).
  const readablePairs = text.split(/\s*\/\s*/).map(part => {
    const match = part.match(/^\s*([^:：]+?)\s*[:：]\s*(.+?)\s*$/);
    return match ? { attributeName: match[1].trim(), attributeValue: match[2].trim() } : null;
  }).filter(Boolean);
  if (readablePairs.length) return readablePairs;
  const rows = [];
  const blocks = text.match(/\{[^{}]*\}/g) || [];
  for (const block of blocks) {
    const field = name => {
      const match = block.match(new RegExp(`['"]${name}['"]\\s*:\\s*['"]([^'"]*)['"]`, "i"));
      return match ? match[1].trim() : "";
    };
    const attributeName = field("attributeName") || field("name");
    const attributeValue = field("attributeValue") || field("value");
    const skuImageUrl = field("skuImageUrl");
    if (attributeName || attributeValue || skuImageUrl) rows.push({ attributeName, attributeValue, skuImageUrl });
  }
  return rows;
}

function isColorNameVariantAttribute(attr) {
  const name = String(attr?.name || "").toLowerCase();
  return name.includes("颜色名称") || name.includes("название цвета") || name.includes("color name");
}

function renderWatermarkSettings() {
  const w = state.watermark || {};
  const enabled = $("#le-watermark-enabled"); if (enabled) enabled.checked = Boolean(w.enabled);
  const scale = $("#le-watermark-scale"); if (scale) scale.value = String(w.scale ?? 1);
  const opacity = $("#le-watermark-opacity"); if (opacity) opacity.value = String(w.opacity ?? .65);
  const scaleOut = $("#le-watermark-scale-value"); if (scaleOut) scaleOut.textContent = `${Math.round(Number(scale?.value || 1) * 100)}%`;
  const opacityOut = $("#le-watermark-opacity-value"); if (opacityOut) opacityOut.textContent = `${Math.round(Number(opacity?.value || .65) * 100)}%`;
  $$("[data-watermark-position]").forEach(btn => btn.classList.toggle("active", btn.dataset.watermarkPosition === (w.position || "br")));
  const mark = $("#le-watermark-preview-mark"); if (mark) { const p = w.position || "br"; const vertical = p[0] === "t" ? "8%" : p[0] === "m" ? "42%" : "76%"; const horizontal = p[1] === "l" ? "8%" : p[1] === "m" ? "42%" : "76%"; mark.hidden = !w.image_data_url; mark.src = w.image_data_url || ""; mark.style.opacity = String(w.opacity ?? .65); mark.style.width = `${Math.round(22 * Number(w.scale || 1))}%`; mark.style.left = horizontal; mark.style.top = vertical; mark.style.transform = "translate(-50%, -50%)"; }
}
async function initWatermarkSettings() {
  await loadWatermarkPreset();
  $("#le-watermark-enabled")?.addEventListener("change", e => { state.watermark.enabled = e.target.checked; saveWatermarkPreset(); renderWatermarkSettings(); });
  $("#le-watermark-file")?.addEventListener("change", e => { const file = e.target.files?.[0]; if (!file) return; if (file.type !== "image/png") { toast("水印必须是 PNG 图片", "error"); return; } const reader = new FileReader(); reader.onload = () => { state.watermark.image_data_url = String(reader.result || ""); state.watermark.enabled = true; saveWatermarkPreset(); renderWatermarkSettings(); }; reader.readAsDataURL(file); });
  $("#le-watermark-scale")?.addEventListener("input", e => { state.watermark.scale = Number(e.target.value); saveWatermarkPreset(); renderWatermarkSettings(); });
  $("#le-watermark-opacity")?.addEventListener("input", e => { state.watermark.opacity = Number(e.target.value); saveWatermarkPreset(); renderWatermarkSettings(); });
  $$('[data-watermark-position]').forEach(btn => btn.addEventListener("click", () => { state.watermark.position = btn.dataset.watermarkPosition; saveWatermarkPreset(); renderWatermarkSettings(); }));
  renderWatermarkSettings();
}

function aiAnalysisLabel(value, preferredKeys = []) {
  if (value == null || value === "") return "等待分析";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(item => aiAnalysisLabel(item, preferredKeys)).join("、") || "待判断";
  for (const key of preferredKeys) if (value[key] != null && value[key] !== "") return aiAnalysisLabel(value[key], preferredKeys);
  return Object.entries(value).slice(0, 3).map(([key, item]) => `${key}: ${aiAnalysisLabel(item, [])}`).join("；") || "待判断";
}

window.zoomAiImage = function(index) { const item=state.aiImageJob?.generated_images?.[index]; if(!item)return; const modal=document.createElement("div"); modal.className="le-ai-image-lightbox"; modal.innerHTML=`<img src="${esc(item.url)}"><button>×</button>`; modal.addEventListener("click",()=>modal.remove()); document.body.appendChild(modal); };

async function loadAiImageJob() {
  state.aiImageJob=null; state.selectedAiImages.clear(); state.selectedAiJobId=null; renderAiImageJob();
  if(!state.shopId || !state.sourceProduct?.id)return;
  try { state.aiImageJob=await api("GET",`/api/v1/shops/${state.shopId}/ai-images/source-products/${state.sourceProduct.id}?creative_group_key=${encodeURIComponent(state.aiCreativeGroupKey || "__product__")}`); renderAiImageJob(); } catch(e) { console.warn("AI image job load failed",e); }
}

async function generateAiImages(requestedSlots = null) {
  if(!state.shopId || !state.sourceProduct?.id){toast("请先选择采集商品","error");return;}
  if(state.aiImageJob?.status === "interrupted" && !window.confirm("上一次任务因后端重启中断，供应商是否已扣费无法确认。确认已核对沧猿调用明细后，才开始一个新的付费生图批次。继续吗？")) return;
  const sourceId=state.sourceProduct.id;
  const mode = $("#le-ai-generate-mode")?.value || "all";
  const slots = Array.isArray(requestedSlots) && requestedSlots.length ? requestedSlots : (mode === "hero" ? ["hero"] : AI_IMAGE_DEFAULT_SLOTS.map(item => item.slot));
  const slotTitle = slots.length === 1 ? (AI_IMAGE_DEFAULT_SLOTS.find(item => item.slot === slots[0])?.title || "图片") : `全套 ${slots.length} 张`;
  const btn=$("#le-ai-generate-images"); btn.disabled=true; btn.textContent="分析并生成中..."; toast(`正在分析图库并生成${slotTitle}，请勿关闭页面`,"");
  try {
    state.selectedAiImages.clear();
    state.aiImageJob=await api("POST",`/api/v1/shops/${state.shopId}/ai-images/generate`,{source_product_id:sourceId,listing_draft_id:state.draftId||null,creative_group_key:state.aiCreativeGroupKey || "__product__",slots});
    renderAiImageJob(); toast(`${slotTitle}任务已提交，可继续编辑其他字段`, "success");
    while (["queued","analyzing","generating"].includes(state.aiImageJob?.status)) {
      await new Promise(resolve=>setTimeout(resolve,3000));
      if(state.sourceProduct?.id!==sourceId)return;
      state.aiImageJob=await api("GET",`/api/v1/shops/${state.shopId}/ai-images/source-products/${sourceId}?creative_group_key=${encodeURIComponent(state.aiCreativeGroupKey || "__product__")}`);
      renderAiImageJob();
    }
    if(state.aiImageJob?.status==="ready")toast("AI套图已生成，请点击图片选择后使用","success");
    else if(state.aiImageJob?.status==="failed")toast(`套图部分失败，但已生成 ${state.aiImageJob.generated_images?.length || 0} 张仍可选择使用`, "");
  }
  catch(e){toast("AI套图生成失败："+e.message,"error"); await loadAiImageJob();}
  finally{btn.disabled=false;btn.textContent="✨ 开始生图";}
}

async function applyAiImages(skipConfirm = false) {
  const selected=(state.aiImageJob.generated_images||[]).map(x=>x.url).filter(url=>state.selectedAiImages.has(url));
  if(!selected.length){toast("请至少选择一张图片","error");return;}
  const targetGroup = (variantCreativeGroups()).find(group => group.key === state.aiCreativeGroupKey);
  const targetIndexes = targetGroup?.indexes || state.variants.map((_, index) => index);
  const targetSkus = targetIndexes.map(index => state.variants[index]?.seller_sku).filter(Boolean);
  if(!targetSkus.length){toast("当前款式没有可应用的 SKU","error");return;}
  if(!skipConfirm && !window.confirm(`将 ${selected.length} 张AI图片应用到“${targetGroup?.label || "当前款式"}”的 ${targetSkus.length} 个尺寸 SKU。不会修改公共详情图库或其他款式。确认继续？`))return;
  const btn=$("#le-ai-apply-images");btn.disabled=true;
  try {
    // Applying images is an explicit persistence action.  If this is still a
    // new editor session, first save the complete current form so the selected
    // images cannot disappear on refresh or navigation.
    targetIndexes.forEach(index=>{
      const variant=state.variants[index];
      const prior=Array.isArray(variant.image_urls) ? variant.image_urls : (variant.image_url ? [variant.image_url] : []);
      variant.image_urls=[...selected,...prior.filter(url=>!selected.includes(url))].slice(0,15);
      variant.image_url=selected[0];
    });
    onImagesChanged(); renderVariantTable();
    if(!state.draftId){
      const saved=await saveDraft();
      if(!saved) throw new Error("自动保存草稿失败，套图尚未应用");
    }
    state.aiImageJob=await api("POST",`/api/v1/shops/${state.shopId}/ai-images/jobs/${state.aiImageJob.id}/apply`,{listing_draft_id:state.draftId,selected_urls:selected,variant_skus:targetSkus,confirm_replace:true});
    renderAiImageJob();
    toast("AI图片已写入当前款式的 SKU 图片库，公共详情图库未改动","success");
  }
  catch(e){toast("应用套图失败："+e.message,"error");}
  finally{btn.disabled=false;}
}

// Style-exclusive hero: generate one Ozon-style hero for a specific style/SKU,
// using that style's SKU image as reference, then auto-apply to all size SKUs
// of that style. This is for the "AI 作图" button in the variant table.
async function generateAndApplyStyleHero(styleKey) {
  if(!state.shopId || !state.sourceProduct?.id){toast("请先选择采集商品","error");return;}
  state.aiCreativeGroupKey = styleKey;
  syncAiCreativeGroupPicker();
  document.querySelector("#le-ai-image-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  toast("正在生成该款式的 Ozon 风格首图...", "");
  try {
    await generateAiImages(["hero"]);
    // After generation, auto-select the hero and apply to all size SKUs of this style.
    const heroImage = state.aiImageJob?.generated_images?.find(x => x.slot === "hero");
    if (!heroImage) {
      toast("首图生成失败，请查看 AI 款式套图面板的错误信息", "error");
      return;
    }
    state.selectedAiImages.clear();
    state.selectedAiImages.add(heroImage.url);
    await applyAiImages(true); // skipConfirm = true
    toast("款式首图已生成并应用到该款式的所有尺寸 SKU", "success");
  } catch(e) {
    toast("款式首图生成失败："+e.message, "error");
  }
}

async function matchVariantWarehouses() {
  for (let i = 0; i < state.variants.length; i++) {
    const v = state.variants[i];
    const weight = parseFloat(v.weight_g);
    const price = parseFloat(v.price_cny);
    const length = parseFloat(v.length_mm);
    const width = parseFloat(v.width_mm);
    const height = parseFloat(v.height_mm);
    if (!weight || !price || !length || !width || !height) continue;
    try {
      const r = await api("POST", `/api/v1/shops/${state.shopId}/match-warehouse`, {
        weight_g: weight, price_cny: price, length_mm: length, width_mm: width, height_mm: height
      });
      if (r.matched) {
        v.warehouse_level = r.level;
        v.shipping_fee = r.shipping_fee_cny;
        v.stock = "999"; // Set stock to 999 for matched warehouse
        // min_price = floor(price), if integer then -1
        const priceVal = parseFloat(v.price_cny) || 0;
        v.min_price_cny = String(Math.floor(priceVal) === priceVal ? Math.floor(priceVal) - 1 : Math.floor(priceVal));
      } else {
        v.warehouse_level = null;
        v.stock = "0";
      }
    } catch (_) {}
  }
  renderVariantTable();
}

function updateVariantDerivedPrice(variant) {
  const price = parseFloat(variant?.price_cny);
  if (!Number.isFinite(price) || price <= 0) return;
  variant.old_price_cny = String(Math.ceil(price * 2 * 100) / 100);
  const minPrice = Math.floor(price) === price ? Math.floor(price) - 1 : Math.floor(price);
  variant.min_price_cny = String(Math.max(1, minPrice));
}

let variantWarehouseMatchTimer = null;
function scheduleVariantWarehouseMatch() {
  clearTimeout(variantWarehouseMatchTimer);
  // A numeric cell fires input for every character (26.9 -> four events).
  // Match only once after the operator finishes the cell, never during typing.
  variantWarehouseMatchTimer = setTimeout(() => { matchVariantWarehouses(); }, 650);
}

function renderColorSamples() {
  const container = $("#le-variant-color-samples");
  if (!container) return;
  const variantAttrs = state.variantDimensions || [];
  const colorAttr = variantAttrs.find(a => {
    const n = (a.name || "").toLowerCase();
    return n.includes("颜色") || n.includes("цвет") || n.includes("color");
  });

  if (!colorAttr) { container.style.display = "none"; return; }

  // One sample represents one style/color group, never every size SKU.
  container.innerHTML = variantCreativeGroups().map(group => {
    const i = group.indexes[0];
    const v = state.variants[i] || {};
    const colorName = group.label || v.variant_values?.[colorAttr.name] || "";
    const image = group.image_url || v.image_url || state.images[0] || "";
    return `<div class="le-color-sample" data-idx="${i}">
      <input type="checkbox" checked data-sample-idx="${i}" />
      <img src="${esc(image)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" onclick="event.stopPropagation(); zoomVariantImage(${i})" title="点击查看该款式图片" style="cursor:zoom-in" />
      <small>${esc(colorName)}</small>
      <button type="button" class="le-btn le-btn-sm" onclick="event.stopPropagation(); translateVariantImage(${i})" title="翻译此款式图片并回填" style="padding:1px 8px;margin-top:3px">翻译</button>
    </div>`;
  }).join("");

  $$("#le-variant-color-samples input[data-sample-idx]").forEach(cb => {
    cb.addEventListener("change", () => {
      const idx = parseInt(cb.dataset.sampleIdx);
      const group = creativeGroupAtIndex(idx);
      (group?.indexes || [idx]).forEach(rowIndex => {
        const row = $(`#le-variant-rows tr[data-row-idx="${rowIndex}"]`);
        if (row) row.style.opacity = cb.checked ? "1" : "0.4";
      });
    });
  });
}

function normalizeLoadedVariantValues(values, sellerSku = "") {
  const source = values && typeof values === "object" ? { ...values } : {};
  const dimensions = state.variantDimensions || [];
  if (!dimensions.length) return Object.keys(source).length ? source : null;

  // Existing drafts may use the source Chinese axis name (颜色), while the
  // current Ozon dictionary uses the Russian/English axis name (Цвет/Color).
  // Re-key by the selected aspect definition instead of dropping the value.
  const normalized = {};
  for (const attr of dimensions) {
    const target = String(attr.name || "");
    const targetLower = target.toLowerCase();
    const exact = Object.keys(source).find(key => key === target);
    const compatible = Object.keys(source).find(key => {
      const name = String(key || "").toLowerCase();
      return (name.includes("颜色") && (targetLower.includes("цвет") || targetLower.includes("color") || targetLower.includes("颜色")))
        || (name.includes("цвет") && (targetLower.includes("颜色") || targetLower.includes("color") || targetLower.includes("цвет")))
        || (name.includes("color") && (targetLower.includes("颜色") || targetLower.includes("цвет") || targetLower.includes("color")));
    });
    const key = exact || compatible;
    if (key && source[key] !== undefined && source[key] !== null) normalized[target] = source[key];
  }
  // Preserve non-axis values for custom/manual dimensions.
  for (const [key, value] of Object.entries(source)) {
    if (!Object.values(normalized).includes(value) && !key.startsWith("__")) normalized[key] = value;
  }

  // Old drafts can contain only an unstructured/empty value. Recover the
  // source SKU spec as evidence when the seller SKU identifies that source
  // variant; this does not invent an Ozon dictionary value.
  if (!Object.keys(normalized).length && state.sourceProduct?.variants?.length) {
    const sourceVariant = state.sourceProduct.variants.find(item =>
      sellerSku && item.source_sku && String(sellerSku).endsWith(String(item.source_sku))
    );
    if (sourceVariant?.spec_name) {
      const parsed = parseSourceSkuSpec(sourceVariant.spec_name);
      for (const attr of dimensions) {
        const match = parsed.find(item => {
          const name = String(item.attributeName || item.name || "").toLowerCase();
          const target = String(attr.name || "").toLowerCase();
          return name === target || (name.includes("颜色") && (target.includes("цвет") || target.includes("color") || target.includes("颜色")));
        });
        if (match) normalized[attr.name] = String(match.attributeValue || match.value || "");
      }
    }
  }
  return Object.keys(normalized).length ? normalized : null;
}

function renderVariantTable() {
  const tb = $("#le-variant-rows");
  const variantAttrs = state.variantDimensions || [];
  const groupDimension = styleVariantDimension();
  // A style/color belongs to the merged style cell.  Only the remaining
  // dimensions (normally size) are rendered as the SKU rows on the right.
  const skuRowAttrs = variantAttrs.filter(attr => String(attr?.name || "") !== String(groupDimension?.name || ""));
  const creativeGroups = variantCreativeGroups();
  const groupByIndex = new Map();
  creativeGroups.forEach(group => group.indexes.forEach((index, position) => groupByIndex.set(index, { group, position })));
  syncAiCreativeGroupPicker();

  const dimCols = skuRowAttrs.map(a => {
    const isColorDim = isColorVariantAttribute(a);
    const randomLink = isColorDim
      ? `<br><a href="javascript:void(0)" onclick="randomColorAssign()" style="font-size:10px;color:#e74c3c;text-decoration:none" title="随机分配1-2个颜色">随机</a> <a href="javascript:void(0)" onclick="suggestColorAssign()" style="font-size:10px;color:#16803c;text-decoration:none" title="按采集 SKU 颜色匹配 Ozon 字典">建议</a>`
      : "";
    const colorNameLink = isColorNameVariantAttribute(a)
      ? ` <a href="javascript:void(0)" onclick="fillVariantColorNames()" style="font-size:10px;color:#16803c;text-decoration:none" title="使用商品颜色的 Ozon 俄文值填充">按颜色填充</a>`
      : "";
    const copyDimensionLink = `<br><a href="javascript:void(0)" onclick="copyFirstRowVariantDimension('${esc(a.name)}')" style="font-size:10px;color:#999;text-decoration:none" title="复制首行到此列">同首行</a>`;
    return `<th>${esc(a.name)}${randomLink}${colorNameLink}${copyDimensionLink}</th>`;
  }).join("");

  const thead = $("#le-variant-table thead");
  if (thead) {
    const copyLink = (field) => `<a href="javascript:void(0)" onclick="copyFirstRowField('${field}')" style="font-size:10px;color:#999;text-decoration:none;display:block;margin-top:2px" title="复制首行到此列">同首行</a>`;
    thead.innerHTML = `<tr>
      <th style="width:30px"><input type="checkbox" id="le-variant-select-all" /></th>
      <th style="width:82px">款式图<br><small>独立素材</small></th>
      <th style="min-width:130px">款式 / 颜色<br><small>一套素材，合并同款尺寸</small></th>
      <th style="width:60px">颜色样本</th>
      <th style="width:60px">产品图</th>
      ${dimCols}
      <th>SKU编号<br><a href="javascript:void(0)" onclick="generateSkuDialog()" style="font-size:10px;color:var(--le-primary,#4a90d9);text-decoration:none">生成</a> <a href="javascript:void(0)" onclick="translateAllSku()" style="font-size:10px;color:var(--le-primary,#4a90d9);text-decoration:none">全部翻译</a></th>
      <th>条形码${copyLink("barcode")}</th>
      <th>售价(CNY)${copyLink("price_cny")}</th>
      <th>原价(CNY)${copyLink("old_price_cny")}</th>
      <th>最低售价(CNY)${copyLink("min_price_cny")}</th>
      <th>成本价(CNY)${copyLink("cost_cny")}</th>
      <th>*仓库/库存<br><small style="font-weight:400;color:#888">等级+数量</small>${copyLink("stock")}</th>
      <th>*包裹尺寸(mm)<br><small>长×宽×高</small>${copyLink("dimensions")}</th>
      <th>*毛重(g)${copyLink("weight_g")}</th>
      <th>操作</th>
    </tr>`;
  }

  const sa = $("#le-variant-select-all");
  if (sa) sa.addEventListener("change", () => {
    $$(".le-variant-row-check").forEach(cb => { cb.checked = sa.checked; });
  });

  if (!state.variants.length) {
    tb.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:20px;color:#999">暂无变体。请加载采集商品或点击\u300c添加一行\u300d。</td></tr>';
    return;
  }

  tb.innerHTML = state.variants.map((v, i) => {
    const dimInputs = skuRowAttrs.map(a => {
      const val = v.variant_values?.[a.name] || "";
      const isColor = (a.name || "").toLowerCase().includes("颜色") || (a.name || "").toLowerCase().includes("цвет") || (a.name || "").toLowerCase().includes("color");
      if (isColorNameVariantAttribute(a)) {
        return `<td><input type="text" value="${esc(val)}" data-field="variant_value" data-dim="${esc(a.name)}" data-idx="${i}" style="width:150px" title="采集到的 SKU 名称，可翻译" /><button type="button" class="le-btn le-btn-sm" onclick="translateVariantName(${i}, '${esc(a.name)}')" style="padding:1px 5px;margin-left:3px" title="翻译采集到的 SKU 名称">翻译</button></td>`;
      }
      if (isColor) {
        // Color with dictionary -> multi-select with checkboxes (is_collection=1)
        const selColors = val ? String(val).split(",").map(s => s.trim()).filter(Boolean) : [];
        const displayText = selColors.length ? selColors.join(", ") : "请选择";
        const note = v.color_match_note ? `<small style="display:block;color:#16803c;white-space:nowrap;font-size:10px" title="${esc(v.color_match_note)}">自动匹配</small>` : "";
        return `<td style="position:relative"><input class="le-color-ms-trigger" type="text" value="${esc(selColors.join(", "))}" placeholder="请选择" data-field="variant_value" data-dim="${esc(a.name)}" data-idx="${i}" onclick="toggleColorMultiSelect(${i}, this)" title="点击搜索或勾选颜色（可多选）" autocomplete="off" />${note}</td>`;
      }
      return `<td><input type="text" value="${esc(val)}" data-field="variant_value" data-dim="${esc(a.name)}" data-idx="${i}" style="width:80px" /></td>`;
    }).join("");

    const skuImg = v.image_url || state.images[0] || "";
    const colorImg = skuImg; // Color sample follows product image
    // The badge and popup must use the exact same deduplicated list: this
    // SKU's dedicated first image plus every public product image.
    const imgCount = variantProductImages(i).length;

    const groupEntry = groupByIndex.get(i);
    const groupSize = groupEntry?.group.indexes.length || 1;
    const groupLead = state.variants[groupEntry?.group.indexes[0] ?? i] || v;
    const groupImg = groupEntry?.group.image_url || groupLead.image_url || skuImg;
    const groupImages = variantProductImages(groupEntry?.group.indexes[0] ?? i);
    const groupDimensionValue = groupDimension ? String(groupLead.variant_values?.[groupDimension.name] || groupEntry?.group.label || "") : "";
    const groupStyleEditor = !groupDimension ? "" : (isColorVariantAttribute(groupDimension)
      ? `<input class="le-color-ms-trigger le-group-style-trigger" type="text" value="${esc(groupDimensionValue)}" placeholder="请选择" data-group-first-idx="${i}" data-group-dim="${esc(groupDimension.name)}" title="设置后同步到同款全部尺寸" autocomplete="off" />`
      : `<input class="le-group-style-input" type="text" value="${esc(groupDimensionValue)}" data-group-first-idx="${i}" data-group-dim="${esc(groupDimension.name)}" title="设置后同步到同款全部尺寸" />`);
    const groupCells = groupEntry?.position === 0 ? `<td rowspan="${groupSize}" class="le-variant-group-image"><img class="le-variant-thumb" src="${esc(groupImg)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" /><button type="button" class="le-variant-group-ai" data-ai-style-key="${esc(groupEntry.group.key)}">AI 作图</button></td><td rowspan="${groupSize}" class="le-variant-group-name"><strong>${esc(groupEntry.group.label)}</strong>${groupStyleEditor}<small>${groupSize} 个尺寸 SKU</small></td><td rowspan="${groupSize}" class="le-variant-group-image"><img class="le-variant-thumb le-color-thumb" src="${esc(groupImg)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" title="同款颜色样本" /></td><td rowspan="${groupSize}" style="position:relative" class="le-variant-group-image"><img class="le-variant-thumb" src="${esc(groupImg)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" data-click="product-img" data-idx="${i}" title="点击设置该款式图片库" style="cursor:pointer" /><span class="le-img-badge">${groupImages.length}</span></td>` : "";
    return `<tr data-row-idx="${i}">
      <td><input type="checkbox" class="le-variant-row-check" data-idx="${i}" /></td>
      ${groupCells}
      ${dimInputs}
      <td style="white-space:nowrap"><input type="text" maxlength="50" value="${esc(v.seller_sku)}" data-field="seller_sku" data-idx="${i}" style="width:150px" title="Ozon 最多 50 个字符" /><div style="display:flex;gap:4px;margin-top:2px"><small>${String(v.seller_sku || "").length}/50</small><button class="le-btn le-btn-sm" onclick="translateSku(${i})" title="翻译后缀为俄文" style="padding:1px 6px;font-size:11px;border:1px solid #4a90d9;color:#4a90d9;background:#f0f7ff">译俄文</button></div></td>
      <td><input type="text" value="${esc(v.barcode)}" data-field="barcode" data-idx="${i}" style="width:80px" placeholder="Ozon自动" /></td>
      <td><input type="number" step="0.01" value="${esc(v.price_cny)}" data-field="price_cny" data-idx="${i}" style="width:60px" /></td>
      <td><input type="number" step="0.01" value="${esc(v.old_price_cny)}" data-field="old_price_cny" data-idx="${i}" style="width:60px" /></td>
      <td><input type="number" step="0.01" value="${esc(v.min_price_cny)}" data-field="min_price_cny" data-idx="${i}" style="width:60px" placeholder="自动" /></td>
      <td><input type="number" step="0.01" value="${esc(v.cost_cny)}" data-field="cost_cny" data-idx="${i}" style="width:60px" /></td>
      <td style="text-align:center">
        <select data-field="warehouse_level" data-idx="${i}" style="width:100%;font-size:11px;padding:2px;margin-bottom:3px;border:1px solid #ddd;border-radius:3px">
          <option value="">未匹配</option>
          <option value="Extra Small" ${v.warehouse_level === "Extra Small" ? "selected" : ""}>Extra Small</option>
          <option value="Budget" ${v.warehouse_level === "Budget" ? "selected" : ""}>Budget</option>
          <option value="Small" ${v.warehouse_level === "Small" ? "selected" : ""}>Small</option>
          <option value="Big" ${v.warehouse_level === "Big" ? "selected" : ""}>Big</option>
        </select>
        <input type="number" value="${esc(v.stock)}" data-field="stock" data-idx="${i}" style="width:50px" />
      </td>
      <td style="white-space:nowrap"><input type="number" value="${esc(v.length_mm)}" data-field="length_mm" data-idx="${i}" style="width:42px" />\u00d7<input type="number" value="${esc(v.width_mm)}" data-field="width_mm" data-idx="${i}" style="width:42px" />\u00d7<input type="number" value="${esc(v.height_mm)}" data-field="height_mm" data-idx="${i}" style="width:42px" /></td>
      <td><input type="number" step="0.01" value="${esc(v.weight_g)}" data-field="weight_g" data-idx="${i}" style="width:55px" /></td>
      <td><button class="le-variant-del" onclick="removeVariant(${i})" title="移除">\u00d7</button></td>
    </tr>`;
  }).join("");

  // Wire up input changes
  $$("#le-variant-rows input[data-field]").forEach(inp => {
    inp.addEventListener("input", () => {
      const idx = parseInt(inp.dataset.idx);
      const field = inp.dataset.field;
      if (field === "variant_value") {
        const dim = inp.dataset.dim;
        if (!state.variants[idx].variant_values) state.variants[idx].variant_values = {};
        state.variants[idx].variant_values[dim] = inp.value;
        renderColorSamples();
      } else {
        if (field === "seller_sku") {
          const normalized = normalizeOfferId(inp.value);
          state.variants[idx][field] = normalized;
          inp.value = normalized;
        } else {
          state.variants[idx][field] = inp.value;
        }
        if (field === "price_cny") {
          updateVariantDerivedPrice(state.variants[idx]);
          const oldInp = $(`#le-variant-rows input[data-field="old_price_cny"][data-idx="${idx}"]`);
          const minInp = $(`#le-variant-rows input[data-field="min_price_cny"][data-idx="${idx}"]`);
          if (oldInp) oldInp.value = state.variants[idx].old_price_cny || "";
          if (minInp) minInp.value = state.variants[idx].min_price_cny || "";
        }
      }
    });
    inp.addEventListener("change", () => {
      if (["price_cny", "length_mm", "width_mm", "height_mm", "weight_g"].includes(inp.dataset.field)) scheduleVariantWarehouseMatch();
    });
  });

  // Wire up warehouse_level select changes
  $$("#le-variant-rows select[data-field='warehouse_level']").forEach(sel => {
    sel.addEventListener("change", () => {
      const idx = parseInt(sel.dataset.idx);
      state.variants[idx].warehouse_level = sel.value || null;
    });
  });

  // Wire up image clicks to open gallery selector
  $$("#le-variant-rows img[data-click]").forEach(img => {
    img.addEventListener("click", () => openImageGallery(parseInt(img.dataset.idx), img.dataset.click));
  });

  // One style/color editor is intentionally shared by its size rows.  The
  // source dimensions stay per-SKU, while the visual style must not drift
  // between 40×60, 50×80, etc. of the same style.
  $$(".le-group-style-input").forEach(inp => inp.addEventListener("input", () => {
    const group = creativeGroupAtIndex(Number(inp.dataset.groupFirstIdx));
    if (!group) return;
    group.indexes.forEach(index => {
      const variant = state.variants[index];
      variant.variant_values = variant.variant_values || {};
      variant.variant_values[inp.dataset.groupDim] = inp.value;
    });
    renderColorSamples();
  }));
  $$(".le-group-style-trigger").forEach(inp => inp.addEventListener("click", () => {
    const group = creativeGroupAtIndex(Number(inp.dataset.groupFirstIdx));
    toggleColorMultiSelect(Number(inp.dataset.groupFirstIdx), inp, group?.indexes || []);
  }));
  $$("[data-ai-style-key]").forEach(button => button.addEventListener("click", async () => {
    // "AI 作图" button: generate one Ozon-style hero for this style, using its
    // SKU image as reference, featuring the style's exclusive attributes (color,
    // quantity, size), then auto-apply to all size SKUs of this style.
    await generateAndApplyStyleHero(button.dataset.aiStyleKey);
  }));

}

// Product image library for one style. The public gallery is read-only here;
// selection is copied only to the current style's size SKUs.
function openImageGallery(variantIdx, imgType) {
  const modal = document.createElement("div");
  modal.className = "le-product-gallery-modal";
  document.body.appendChild(modal);

  const render = () => {
    const previousDialog = modal.querySelector(".le-product-gallery-dialog");
    const previousDialogScrollTop = previousDialog?.scrollTop || 0;
    const previousPaneScrollTops = Array.from(modal.querySelectorAll(".le-product-gallery-pane"), pane => pane.scrollTop || 0);
    const variant = state.variants[variantIdx] || {};
    const imgs = [...new Set([
      ...variantImageChoices(variantIdx),
      ...(Array.isArray(variant.image_urls) ? variant.image_urls : []),
    ])];
    if (!imgs.length) {
      modal.innerHTML = `<div class="le-product-gallery-dialog"><div class="le-product-gallery-head"><strong>产品图片库</strong><button type="button" data-gallery-close>×</button></div><p class="le-product-gallery-empty">图片库为空，请先在第⑥步添加图片。</p><div class="le-product-gallery-foot"><button type="button" data-gallery-close>关闭</button></div></div>`;
    } else {
      const selectedImgs = Array.isArray(variant.image_urls)
        ? [...new Set(variant.image_urls.filter(url => imgs.includes(url)))]
        : [...imgs];
      const selected = new Set(selectedImgs);
      const current = variant.image_url || selectedImgs[0] || imgs[0];
      const availableImgs = publicGalleryImages();
      const card = (url, isSelected, index) => { const isSku = url === variant.image_url; return `<div class="le-product-gallery-card ${isSelected ? "active" : ""}" data-gallery-url="${esc(url)}" draggable="${isSelected ? "true" : "false"}" data-selected-index="${isSelected ? index : ""}"><img src="${esc(url)}" loading="lazy" referrerpolicy="no-referrer" /><span class="le-product-gallery-order">${isSelected ? `${index + 1}${index === 0 ? " · 首图" : ""}` : "可补充"}${isSku ? " · 款式图" : " · 公共图"}</span>${isSelected ? `<button type="button" class="le-product-gallery-primary" data-gallery-primary="${esc(url)}">${url === current ? "当前首图" : "设为首图"}</button><button type="button" class="le-product-gallery-delete" data-gallery-remove="${esc(url)}" title="从当前款式移除">×</button>` : `<button type="button" class="le-product-gallery-add" data-gallery-add="${esc(url)}">加入此款式</button>`}</div>`; };
      const sourceCard = url => { const isAdded = selected.has(url); return `<div class="le-product-gallery-card le-product-gallery-source-card ${isAdded ? "active" : ""}" data-gallery-url="${esc(url)}"><img src="${esc(url)}" loading="lazy" referrerpolicy="no-referrer" /><span class="le-product-gallery-order">公共图${isAdded ? " · 已加入" : " · 可补充"}</span>${isAdded ? '<button type="button" class="le-product-gallery-added" disabled>已加入当前款式</button>' : `<button type="button" class="le-product-gallery-add" data-gallery-add="${esc(url)}">加入此款式</button>`}</div>`; };
      const targetCount = creativeGroupAtIndex(variantIdx)?.indexes.length || 1;
      const styleKey = creativeGroupAtIndex(variantIdx)?.key || "__product__";
      modal.innerHTML = `<div class="le-product-gallery-dialog"><div class="le-product-gallery-head"><div><strong>款式图片设置</strong><small>左侧为当前款式已选图片，右侧为完整公共总图库；会同步本款 ${targetCount} 个尺寸 SKU，不影响公共图库或其他款式。</small></div><div style="display:flex;gap:8px;align-items:center"><button type="button" class="le-btn le-btn-sm" data-gallery-ai-gen style="background:#6c5ce7;color:#fff;border-color:#6c5ce7">✨ AI 生套图</button><button type="button" data-gallery-close>×</button></div></div><div class="le-product-gallery-columns"><section class="le-product-gallery-pane"><h4>当前款式已选（${selectedImgs.length}）</h4><div class="le-product-gallery-grid le-product-gallery-selected">${selectedImgs.map((url, i) => card(url, true, i)).join("") || '<p class="le-product-gallery-empty">暂无已选图片</p>'}</div></section><section class="le-product-gallery-pane"><h4>总图库（${availableImgs.length}）</h4><div class="le-product-gallery-grid le-product-gallery-available">${availableImgs.map(sourceCard).join("") || '<p class="le-product-gallery-empty">暂无公共图库图片</p>'}</div></section></div><div class="le-product-gallery-foot"><span>拖动左侧图片调整顺序；第一张会成为本款所有尺寸的首图。右侧只补充图片，不会删除公共图库。</span><button type="button" data-gallery-close>完成</button></div></div>`;
    }
    modal.querySelectorAll("[data-gallery-close]").forEach(button => button.addEventListener("click", () => modal.remove()));
    // AI 生套图 button: generate a full 8-image set for this style, then add
    // the generated images to this style's selected gallery.
    const aiGenBtn = modal.querySelector("[data-gallery-ai-gen]");
    if (aiGenBtn) {
      aiGenBtn.addEventListener("click", async () => {
        if(!state.shopId || !state.sourceProduct?.id){toast("请先选择采集商品","error");return;}
        aiGenBtn.disabled = true;
        aiGenBtn.textContent = "生成中...";
        state.aiCreativeGroupKey = styleKey;
        syncAiCreativeGroupPicker();
        try {
          await generateAiImages(); // full 8-slot set
          // After generation, add all generated images to this style's gallery.
          const generatedUrls = (state.aiImageJob?.generated_images || []).map(x => x.url).filter(Boolean);
          if (generatedUrls.length) {
            const currentVariant = state.variants[variantIdx];
            const existing = Array.isArray(currentVariant.image_urls) ? [...currentVariant.image_urls] : [...imgs];
            const merged = [...new Set([...generatedUrls, ...existing])].slice(0, 15);
            applyImagesToCreativeGroup(variantIdx, merged);
            onImagesChanged();
            toast(`已生成 ${generatedUrls.length} 张 AI 套图并加入当前款式`, "success");
          } else {
            toast("AI 套图生成失败，请查看 AI 款式套图面板", "error");
          }
        } catch(e) {
          toast("AI 套图生成失败："+e.message, "error");
        } finally {
          render(); // re-render the modal with the new images
        }
      });
    }
    const moveSelectedImage = (from, to) => {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
      const currentVariant = state.variants[variantIdx];
      const ordered = Array.isArray(currentVariant.image_urls) ? [...currentVariant.image_urls] : [...imgs];
      if (from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) return false;
      const moved = ordered.splice(from, 1)[0];
      if (!moved) return false;
      ordered.splice(to, 0, moved);
      applyImagesToCreativeGroup(variantIdx, ordered);
      onImagesChanged();
      render();
      return true;
    };
    modal.querySelectorAll(".le-product-gallery-card").forEach(card => {
      card.addEventListener("dragstart", event => { const index = Number(card.dataset.selectedIndex); if (!Number.isInteger(index)) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); card.classList.add("dragging"); });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("dragover", event => { if (card.dataset.selectedIndex !== "") { event.preventDefault(); card.classList.add("drag-over"); } });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
      card.addEventListener("drop", event => { event.preventDefault(); card.classList.remove("drag-over"); const from = Number(event.dataTransfer.getData("text/plain")); const to = Number(card.dataset.selectedIndex); moveSelectedImage(from, to); });

      // Pointer fallback keeps drag-to-reorder working when the browser does not
      // provide a DataTransfer object (touch devices and some embedded browsers).
      let pointerDrag = null;
      card.addEventListener("pointerdown", event => {
        const index = Number(card.dataset.selectedIndex);
        if (!Number.isInteger(index) || event.target.closest("button")) return;
        event.preventDefault();
        modal.__galleryMouseDrag = null;
        pointerDrag = { id: event.pointerId, from: index, startX: event.clientX, startY: event.clientY, active: false };
        card.setPointerCapture?.(event.pointerId);
      });
      card.addEventListener("pointermove", event => {
        if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
        if (!pointerDrag.active && Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 6) return;
        pointerDrag.active = true;
        card.classList.add("dragging");
        modal.querySelectorAll(".le-product-gallery-selected .le-product-gallery-card").forEach(item => item.classList.remove("drag-over"));
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".le-product-gallery-selected .le-product-gallery-card");
        if (target) target.classList.add("drag-over");
      });
      const finishPointerDrag = event => {
        if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
        const drag = pointerDrag;
        pointerDrag = null;
        card.classList.remove("dragging");
        modal.querySelectorAll(".le-product-gallery-card").forEach(item => item.classList.remove("drag-over"));
        if (!drag.active) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".le-product-gallery-selected .le-product-gallery-card");
        const to = target ? Number(target.dataset.selectedIndex) : drag.from;
        moveSelectedImage(drag.from, to);
      };
      card.addEventListener("pointerup", finishPointerDrag);
      card.addEventListener("pointercancel", finishPointerDrag);
    });
    modal.querySelectorAll("[data-gallery-add]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      const variant = state.variants[variantIdx];
      const url = button.dataset.galleryAdd;
      const selectedUrls = Array.isArray(variant.image_urls) ? [...variant.image_urls] : [...imgs];
      if (!selectedUrls.includes(url)) selectedUrls.push(url);
      applyImagesToCreativeGroup(variantIdx, selectedUrls);
      onImagesChanged();
      render();
    }));
    modal.querySelectorAll("[data-gallery-remove]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      const variant = state.variants[variantIdx];
      const url = button.dataset.galleryRemove;
      const selectedUrls = (Array.isArray(variant.image_urls) ? variant.image_urls : imgs).filter(item => item !== url);
      if (!selectedUrls.length) { toast("每个 SKU 至少保留一张图片", "error"); return; }
      applyImagesToCreativeGroup(variantIdx, selectedUrls);
      onImagesChanged();
      render();
    }));
    modal.querySelectorAll("[data-gallery-primary]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      const variant = state.variants[variantIdx];
      const url = button.dataset.galleryPrimary;
      const currentUrls = Array.isArray(variant.image_urls) ? variant.image_urls : [...imgs];
      if (!currentUrls.includes(url)) return;
      applyImagesToCreativeGroup(variantIdx, [url, ...currentUrls.filter(item => item !== url)]);
      onImagesChanged();
      render();
    }));
    const nextDialog = modal.querySelector(".le-product-gallery-dialog");
    if (nextDialog) nextDialog.scrollTop = previousDialogScrollTop;
    modal.querySelectorAll(".le-product-gallery-pane").forEach((pane, index) => {
      pane.scrollTop = previousPaneScrollTops[index] || 0;
    });
  };
  modal.addEventListener("click", event => { if (event.target === modal) modal.remove(); });
  // Embedded browsers may expose mouse events without a usable HTML5
  // DataTransfer. Keep one modal-level fallback so the drag survives when the
  // pointer leaves the source card.
  modal.__galleryMouseDrag = null;
  modal.addEventListener("mousedown", event => {
    const card = event.target.closest?.(".le-product-gallery-selected .le-product-gallery-card");
    if (!card || event.target.closest("button")) return;
    const from = Number(card.dataset.selectedIndex);
    if (!Number.isInteger(from)) return;
    event.preventDefault();
    modal.__galleryMouseDrag = { from, startX: event.clientX, startY: event.clientY, active: false };
  });
  modal.addEventListener("mousemove", event => {
    const drag = modal.__galleryMouseDrag;
    if (!drag) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    drag.active = true;
    modal.querySelectorAll(".le-product-gallery-selected .le-product-gallery-card").forEach(item => item.classList.remove("drag-over"));
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".le-product-gallery-selected .le-product-gallery-card");
    if (target) target.classList.add("drag-over");
  });
  modal.addEventListener("mouseup", event => {
    const drag = modal.__galleryMouseDrag;
    if (!drag) return;
    modal.__galleryMouseDrag = null;
    modal.querySelectorAll(".le-product-gallery-card").forEach(item => item.classList.remove("drag-over", "dragging"));
    if (!drag.active) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".le-product-gallery-selected .le-product-gallery-card");
    const to = target ? Number(target.dataset.selectedIndex) : drag.from;
    if (!Number.isInteger(to) || drag.from === to) return;
    const currentVariant = state.variants[variantIdx];
    const currentImgs = [...new Set([
      ...variantImageChoices(variantIdx),
      ...(Array.isArray(currentVariant.image_urls) ? currentVariant.image_urls : []),
    ])];
    const ordered = Array.isArray(currentVariant.image_urls) ? [...currentVariant.image_urls] : [...currentImgs];
    if (drag.from < 0 || to < 0 || drag.from >= ordered.length || to >= ordered.length) return;
    const moved = ordered.splice(drag.from, 1)[0];
    if (!moved) return;
    ordered.splice(to, 0, moved);
    applyImagesToCreativeGroup(variantIdx, ordered);
    onImagesChanged();
    render();
  });
  render();
}

// Cache color dictionary options for reuse (random assign, etc.)
state.colorOptions = null;
async function ensureColorOptions(attr) {
  const cacheKey = String(attr.id);
  if (!state.colorOptionsCache) state.colorOptionsCache = {};
  if (state.colorOptionsCache[cacheKey]) return state.colorOptionsCache[cacheKey];
  try {
    const vals = attr.dictionary_id ? await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attr.id}/values?query=&limit=100`) : [];
    const sourceValues = (state.sourceProduct?.variants || []).map(v => String(v.spec_name || v.color || "").trim()).filter(Boolean);
    const seen = new Set(vals.map(v => String(v.value)));
    sourceValues.forEach(value => { if (!seen.has(value)) { vals.push({ id: `manual:${value}`, value }); seen.add(value); } });
    state.colorOptionsCache[cacheKey] = vals;
  } catch (_) { state.colorOptionsCache[cacheKey] = (state.sourceProduct?.variants || []).map(v => ({ id: `manual:${v.spec_name}`, value: v.spec_name })).filter(v => v.value); }
  return state.colorOptionsCache[cacheKey];
}

function normalizeColorToken(value) {
  return String(value || "").toLowerCase()
    .replace(/[\s\-_/，、,]/g, "")
    .replace(/颜色|色号|款|型号|colour|color|цвет/gi, "");
}

function colorFamily(value) {
  const token = normalizeColorToken(value);
  // Compound colour words win first: 粉红→pink, 紫红→purple, 墨绿→green.
  // Without this a bare /红/ matched 粉红 before /粉/, mis-routing 深粉红色
  // into the red family and producing wrong colour suggestions.
  const compound = [
    [/粉红|桃红|玫红/, "pink"], [/紫红/, "purple"], [/橘红|橙红/, "orange"],
    [/枣红|砖红|朱红|绛红/, "red"], [/藏青|宝蓝|藏蓝|湖蓝/, "blue"],
    [/墨绿|草绿|军绿|豆绿|蓝绿|祖母绿/, "green"],
  ];
  for (const [re, fam] of compound) if (re.test(token)) return fam;
  const families = [
    ["black", /黑|black|черн/], ["white", /白|white|бел/],
    ["beige", /米|beige|беж|крем|ivory|象牙/], ["green", /绿|green|зел/],
    ["red", /红|red|красн/], ["blue", /蓝|blue|син|голуб/],
    ["yellow", /黄|yellow|желт/], ["brown", /棕|褐|brown|коричн/],
    ["gray", /灰|grey|gray|сер/], ["pink", /粉|pink|розов/],
    ["purple", /紫|purple|фиолет/], ["orange", /橙|orange|оранж/],
    ["gold", /金(?!属灰)|gold|золот/], ["silver", /银|silver|серебр/],
  ];
  return families.find(([, pattern]) => pattern.test(token))?.[0] || "";
}

function scoreColorMatch(source, option) {
  const left = normalizeColorToken(source);
  const right = normalizeColorToken(option);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftFamily = colorFamily(left);
  const rightFamily = colorFamily(right);
  if (leftFamily && leftFamily === rightFamily) return 0.96;
  if (left.includes(right) || right.includes(left)) return 0.88;
  const shared = [...new Set(left)].filter(char => right.includes(char)).length;
  return shared / Math.max(left.length, right.length);
}

// --- Ozon colour dictionary matching (keyword fuzzy + multi-select + uniqueness) ---
function splitColorSegments(value) {
  return String(value || "").split(/[,，、+＋;；/]/).map(s => s.trim()).filter(Boolean);
}
// Strip leading modifiers so 现代黑→黑, 高亮紫→紫, 深粉红色→粉红色.
const COLOR_MODIFIER_RE = /^(深|浅|亮|暗|高亮|哑光|亚光|磨砂|金属|纯|新|老|现代|复古|简约|经典|亮面|雾面|柔和|淡|鲜|正|荧光|珠光|渐变|冰|暖|冷|烟灰|奶酪|橡皮|象牙|糖果|莫兰迪)+/;
function stripColorModifiers(value) {
  return String(value || "").trim().replace(COLOR_MODIFIER_RE, "");
}
function coreColorWords(segment) {
  const core = stripColorModifiers(segment);
  const norm = normalizeColorToken(core);
  if (!norm) return [];
  const words = core.match(/(黑|白|米|绿|红|蓝|黄|棕|褐|灰|粉|紫|橙|金|银|青|卡其|酒红|藏青|橄榄|柠檬|天蓝|翡翠|玫红|砖红|咖啡|可可|薄荷|湖蓝|藏蓝|宝蓝|肤色|肉色|杏|香槟|祖母绿|朱红|绛红|驼色|燕麦|军绿|墨绿|草绿|豆绿|蓝绿|靛)/g) || [];
  const uniq = [...new Set(words.map(w => w))];
  return uniq.length ? uniq : [core];
}
function bestOptionForSegment(segment, options, usedValues, single) {
  const avail = options.filter(o => !(single && usedValues.has(o.value)));
  const words = coreColorWords(segment);
  let best = null;
  let bestScore = 0;
  for (const opt of avail) {
    const o = normalizeColorToken(opt.value);
    if (!o) continue;
    let s = scoreColorMatch(segment, opt.value);
    const literal = words.some(w => o.includes(normalizeColorToken(w)) || normalizeColorToken(w).includes(o));
    if (literal) s = Math.max(s, 0.95);
    if (s > bestScore) { bestScore = s; best = opt; }
  }
  if (!best) return null;
  const b = normalizeColorToken(best.value);
  const literal = words.some(w => b.includes(normalizeColorToken(w)) || normalizeColorToken(w).includes(b));
  const family = words.some(w => colorFamily(w) && colorFamily(w) === colorFamily(best.value));
  if (literal || family || bestScore >= 0.96) return best;
  return null;
}
function matchVariantColor(sourceColor, options, usedValues, single, multi) {
  const chosen = [];
  for (const seg of splitColorSegments(sourceColor)) {
    if (!multi && chosen.length) break;
    const opt = bestOptionForSegment(seg, options, usedValues, single);
    if (!opt) continue;
    chosen.push(opt);
    usedValues.add(opt.value);
  }
  return chosen;
}
async function autoMatchVariantColors() {
  const colorAttr = (state.variantDimensions || []).find(isColorVariantAttribute);
  if (!colorAttr || !state.variants?.length || !colorAttr.dictionary_id) return false;
  const options = (await ensureColorOptions(colorAttr)).filter(option => option?.id && !String(option.id).startsWith("manual:"));
  if (!options.length) return false;
  // Only one variant dimension (colour alone) → different SKUs must not pick
  // the same dictionary colour. With two dimensions (colour × qty/size) the
  // colour may repeat because the second dimension tells the SKUs apart.
  const singleDim = (state.variantDimensions || []).length === 1;
  const multi = Boolean(colorAttr.is_collection);
  const usedValues = new Set();
  let matched = 0;
  for (const variant of state.variants) {
    let current = variant.variant_values?.[colorAttr.name];
    if (!current) current = sourceColorForVariant(variant, colorAttr);
    if (!current) continue;
    const chosen = matchVariantColor(current, options, usedValues, singleDim, multi);
    if (!chosen.length) continue;
    variant.variant_values = variant.variant_values || {};
    variant.variant_value_ids = variant.variant_value_ids || {};
    variant.variant_values[colorAttr.name] = chosen.map(o => o.value).join(", ");
    variant.variant_value_ids[colorAttr.name] = chosen.map(o => String(o.id));
    variant.color_match_note = `自动匹配：${current} → ${chosen.map(o => o.value).join(" + ")}`;
    matched += 1;
  }
  return matched > 0;
}

function sourceColorForVariant(variant, colorAttr) {
  const source = (state.sourceProduct?.variants || []).find(item =>
    item.source_sku && String(variant.seller_sku || "").endsWith(String(item.source_sku))
  );
  if (!source?.spec_name) return "";
  const rows = parseSourceSkuSpec(source.spec_name);
  const row = rows.find(item => {
    const name = String(item.attributeName || item.name || "").toLowerCase();
    const target = String(colorAttr.name || "").toLowerCase();
    return name === target || (name.includes("颜色") && (target.includes("颜色") || target.includes("цвет") || target.includes("color")));
  });
  return String(row?.attributeValue || row?.value || "").trim();
}

window.suggestColorAssign = async function() {
  const colorAttr = (state.variantDimensions || []).find(isColorVariantAttribute);
  if (!colorAttr) { toast("当前类目无颜色变体属性", "error"); return; }
  try {
    const applied = await autoMatchVariantColors();
    renderVariantTable();
    renderColorSamples();
    toast(applied ? "已按采集 SKU 颜色给出 Ozon 字典建议" : "未找到足够确定的颜色建议，请手动选择", applied ? "success" : "error");
  } catch (error) { toast(`颜色建议失败：${error.message}`, "error"); }
};

window.fillVariantColorNames = function() {
  const colorAttr = (state.variantDimensions || []).find(isColorVariantAttribute);
  const nameAttr = (state.variantDimensions || []).find(isColorNameVariantAttribute);
  if (!colorAttr || !nameAttr) { toast("请先启用商品颜色和颜色名称两个变体维度", "error"); return; }
  let count = 0;
  state.variants.forEach(v => {
    const color = String(v.variant_values?.[colorAttr.name] || "").split(",")[0].trim();
    if (!color) return;
    v.variant_values = v.variant_values || {};
    v.variant_values[nameAttr.name] = color;
    count += 1;
  });
  renderVariantTable();
  renderColorSamples();
  toast(count ? `已用商品颜色填充 ${count} 个颜色名称` : "请先在商品颜色中选择 Ozon 颜色", count ? "success" : "error");
};

window.translateVariantName = async function(idx, dimName) {
  const v = state.variants[idx];
  const text = String(v?.variant_values?.[dimName] || "").trim();
  if (!text) { toast("该 SKU 没有可翻译的名称", "error"); return; }
  try {
    const result = await api("POST", "/api/v1/ai/translate", { text, target_lang: "ru" });
    v.variant_values = v.variant_values || {};
    v.variant_values[dimName] = result.translated || result.text || text;
    renderVariantTable();
    toast("SKU 名称已翻译", "success");
  } catch (error) { toast(`SKU 名称翻译失败：${error.message}`, "error"); }
};

// Toggle multi-select color dropdown panel
window.toggleColorMultiSelect = async function(idx, triggerEl, targetIndexes = null) {
  // Close any existing panel
  const existing = document.querySelector(".le-color-ms-panel");
  if (existing) { existing.remove(); return; }

  const variantAttrs = state.variantDimensions || [];
  const dimName = triggerEl.dataset.dim || triggerEl.dataset.groupDim;
  const attr = variantAttrs.find(a => a.name === dimName);
  if (!attr) return;

  const opts = await ensureColorOptions(attr);
  if (!opts.length) { toast("未获取到颜色选项", "error"); return; }

  const v = state.variants[idx];
  if (!v) return;
  if (!v.variant_values) v.variant_values = {};
  const current = v.variant_values[dimName] || "";
  const selectedSet = new Set(current ? String(current).split(",").map(s => s.trim()) : []);

  // Build panel
  const panel = document.createElement("div");
  panel.className = "le-color-ms-panel";
  panel.innerHTML = `
    <div class="le-color-ms-search"><input type="text" placeholder="搜索颜色..." style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px" /></div>
    <div class="le-color-ms-list">
      ${opts.map(o => `<label class="le-color-ms-option"><input type="checkbox" value="${esc(o.value)}" data-value-id="${esc(o.id)}" ${selectedSet.has(o.value) ? "checked" : ""} /><span>${esc(o.value)}</span></label>`).join("")}
    </div>
    <div class="le-color-ms-footer">
      <button class="le-color-ms-clear" style="font-size:11px;color:#999;background:none;border:none;cursor:pointer">清空</button>
    </div>
  `;
  // Position panel below trigger
  const rect = triggerEl.getBoundingClientRect();
  panel.style.cssText = `position:fixed;top:${rect.bottom + 2}px;left:${rect.left}px;z-index:10000;background:#fff;border:1px solid #d1d5db;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);padding:8px;max-height:300px;display:flex;flex-direction:column;min-width:180px`;
  document.body.appendChild(panel);

  // Search filter
  const searchInput = panel.querySelector(".le-color-ms-search input");
  let activeIndex = 0;
  const visibleOptions = () => Array.from(panel.querySelectorAll(".le-color-ms-option"))
    .filter(label => label.style.display !== "none");
  const setActiveOption = (index) => {
    const visible = visibleOptions();
    if (!visible.length) return;
    activeIndex = (index + visible.length) % visible.length;
    visible.forEach((label, position) => {
      const active = position === activeIndex;
      label.style.background = active ? "#eaf3ff" : "";
      label.style.outline = active ? "1px solid #83b7ec" : "";
      label.scrollIntoView({ block: "nearest" });
    });
  };
  const filterOptions = () => {
    const q = searchInput.value.toLowerCase();
    panel.querySelectorAll(".le-color-ms-option").forEach(label => {
      const text = label.querySelector("span").textContent.toLowerCase();
      label.style.display = text.includes(q) ? "" : "none";
    });
    setActiveOption(0);
  };
  searchInput.addEventListener("input", filterOptions);

  const applyColors = () => {
    const checked = Array.from(panel.querySelectorAll(".le-color-ms-option input:checked"));
    const nextValue = checked.map(cb => cb.value).join(", ");
    const nextIds = checked.map(cb => cb.dataset.valueId);
    const indexes = Array.isArray(targetIndexes) && targetIndexes.length ? targetIndexes : [idx];
    indexes.forEach(targetIndex => {
      const target = state.variants[targetIndex];
      if (!target) return;
      target.variant_values = target.variant_values || {};
      target.variant_value_ids = target.variant_value_ids || {};
      target.variant_values[dimName] = nextValue;
      target.variant_value_ids[dimName] = [...nextIds];
    });
    triggerEl.value = nextValue;
    renderColorSamples();
    renderVariantTable();
  };
  panel.querySelectorAll(".le-color-ms-option input").forEach(cb => cb.addEventListener("change", applyColors));
  searchInput.addEventListener("keydown", event => {
    const visible = visibleOptions();
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveOption(activeIndex + 1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveOption(activeIndex - 1); return; }
    if (event.key === "Enter") {
      event.preventDefault();
      const checkbox = visible[activeIndex]?.querySelector("input");
      if (!checkbox) return;
      checkbox.checked = !checkbox.checked;
      applyColors();
      panel.remove();
      triggerEl.focus();
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); panel.remove(); triggerEl.focus(); }
  });
  // Clear button
  panel.querySelector(".le-color-ms-clear").addEventListener("click", () => {
    panel.querySelectorAll(".le-color-ms-option input").forEach(cb => cb.checked = false);
    applyColors();
  });

  // Click outside to close
  setTimeout(() => {
    document.addEventListener("click", function closeHandler(e) {
      if (!panel.contains(e.target) && e.target !== triggerEl) {
        panel.remove();
        document.removeEventListener("click", closeHandler);
      }
    });
  }, 0);

  searchInput.focus();
  filterOptions();
};

// Random color assignment - pick 1-2 colors per variant
window.randomColorAssign = async function() {
  const variantAttrs = state.variantDimensions || [];
  const colorAttr = variantAttrs.find(a => {
    const n = a.name || "";
    return n.includes("颜色") || n.toLowerCase().includes("цвет");
  });
  if (!colorAttr) { toast("当前类目无颜色属性", "error"); return; }

  const opts = await ensureColorOptions(colorAttr);
  if (!opts.length) { toast("未获取到颜色选项", "error"); return; }

  toast("慎选多色！已随机分配1-2个颜色", "success");
  for (let i = 0; i < state.variants.length; i++) {
    const v = state.variants[i];
    if (!v.variant_values) v.variant_values = {};
    // Randomly pick 1-2 colors
    const count = Math.random() < 0.7 ? 1 : 2; // 70% single, 30% double
    const shuffled = [...opts].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(count, opts.length));
    v.variant_values[colorAttr.name] = picked.map(p => p.value).join(", ");
    if (!v.variant_value_ids) v.variant_value_ids = {};
    v.variant_value_ids[colorAttr.name] = picked.map(p => p.id);
  }
  renderVariantTable();
  renderColorSamples();
};

// Translate all SKU suffixes to Russian (batch, single render)
window.translateAllSku = async function() {
  if (!state.variants.length) { toast("无变体可翻译", "error"); return; }
  const btn = event?.target;
  if (btn) { btn.style.opacity = "0.5"; btn.style.pointerEvents = "none"; }
  toast("正在批量翻译SKU...", "");
  let ok = 0, fail = 0;
  for (let i = 0; i < state.variants.length; i++) {
    const v = state.variants[i];
    if (!v) continue;
    const parts = v.seller_sku.split("-");
    const prefix = parts[0];
    const suffix = parts.slice(1).join("-");
    if (!suffix) continue;
    try {
      const r = await api("POST", "/api/v1/ai/translate", { text: suffix, target_lang: "ru" });
      v.seller_sku = normalizeOfferId(`${prefix}-${r.translated.replace(/\s+/g, "_")}`);
      ok++;
    } catch (_) { fail++; }
  }
  renderVariantTable();
  if (btn) { btn.style.opacity = ""; btn.style.pointerEvents = ""; }
  toast(`翻译完成: ${ok}成功${fail ? ", " + fail + "失败" : ""}`, fail ? "error" : "success");
};

// Translate SKU suffix to Russian
window.translateSku = async function(idx) {
  const v = state.variants[idx];
  if (!v) return;
  const parts = v.seller_sku.split("-");
  const prefix = parts[0];
  const suffix = parts.slice(1).join("-");
  if (!suffix) return;
  try {
    const r = await api("POST", "/api/v1/ai/translate", { text: suffix, target_lang: "ru" });
    const translated = r.translated.replace(/\s+/g, "_");
    v.seller_sku = normalizeOfferId(`${prefix}-${translated}`);
    renderVariantTable();
    toast("SKU后缀已翻译为俄文", "success");
  } catch (e) { toast("翻译失败: " + e.message, "error"); }
};

// Batch operations
// Copy first row value to all rows for a specific field
window.copyFirstRowField = function(field) {
  if (state.variants.length < 2) return;
  const first = state.variants[0];
  if (field === "dimensions") {
    const fields = ["length_mm", "width_mm", "height_mm"];
    for (let i = 1; i < state.variants.length; i++) {
      for (const f of fields) state.variants[i][f] = first[f];
    }
  } else if (field === "stock") {
    // Copy both stock and warehouse_level together
    for (let i = 1; i < state.variants.length; i++) {
      state.variants[i].stock = first.stock;
      state.variants[i].warehouse_level = first.warehouse_level;
    }
  } else {
    for (let i = 1; i < state.variants.length; i++) {
      state.variants[i][field] = first[field];
      if (field === "price_cny") updateVariantDerivedPrice(state.variants[i]);
    }
  }
  renderVariantTable();
  renderColorSamples();
  if (["price_cny", "dimensions", "weight_g"].includes(field)) scheduleVariantWarehouseMatch();
  toast("已复制首行到此列", "success");
};

window.copyFirstRowVariantDimension = function(dimName) {
  if (state.variants.length < 2) return;
  const firstValue = state.variants[0]?.variant_values?.[dimName] || "";
  const firstIds = state.variants[0]?.variant_value_ids?.[dimName];
  for (let i = 1; i < state.variants.length; i++) {
    if (!state.variants[i].variant_values) state.variants[i].variant_values = {};
    state.variants[i].variant_values[dimName] = firstValue;
    if (firstIds) {
      if (!state.variants[i].variant_value_ids) state.variants[i].variant_value_ids = {};
      state.variants[i].variant_value_ids[dimName] = Array.isArray(firstIds) ? [...firstIds] : firstIds;
    }
  }
  renderVariantTable();
  renderColorSamples();
  toast(`已将首行${dimName}复制到全部 SKU`, "success");
};

window.zoomVariantImage = function(idx) {
  const url = state.variants[idx]?.image_url || state.images[0];
  if (!url) { toast("该 SKU 没有图片", "error"); return; }
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2147483647;display:flex;align-items:center;justify-content:center;cursor:zoom-out";
  modal.innerHTML = `<img src="${esc(url)}" style="max-width:92vw;max-height:92vh;object-fit:contain" referrerpolicy="no-referrer"><button type="button" style="position:fixed;right:18px;top:12px;border:0;background:transparent;color:white;font-size:30px;cursor:pointer">×</button>`;
  modal.addEventListener("click", () => modal.remove());
  modal.querySelector("button").addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);
};

window.translateVariantImage = async function(idx) {
  const variant = state.variants[idx];
  const sourceUrl = variant?.image_url || state.images[0];
  if (!sourceUrl) { toast("该 SKU 没有可翻译图片", "error"); return; }
  try {
    toast("正在翻译 SKU 图...", "");
    let translatedUrl = state.translatedImageCache?.[sourceUrl] || "";
    if (!translatedUrl) {
      const result = await api("POST", "/api/v1/image/translate", { urls: [sourceUrl], source_lang: "CHS", target_lang: "RUS" });
      const row = (result.results || []).find(item => item?.translated_url) || (result.translated?.[0] ? { translated_url: result.translated[0] } : null);
      if (!row?.translated_url) throw new Error((result.results || []).find(item => item?.error)?.error || "翻译未返回图片");
      translatedUrl = row.translated_url;
    }
    if (!state.translatedImageCache) state.translatedImageCache = {};
    state.translatedImageCache[sourceUrl] = translatedUrl;

    // SKU translation is isolated to this variant. It never enters or
    // replaces the shared public product gallery.
    variant.image_url = translatedUrl;
    state.skuImageUrls = skuImageUrlSet();
    renderImages();
    renderVariantTable();
    renderColorSamples();
    toast("SKU 图已翻译并回填到该 SKU；保存草稿后持久化", "success");
  } catch (error) {
    toast(`SKU 图翻译失败：${error.message}`, "error");
  }
};

// SKU generation dialog
window.generateSkuDialog = function() {
  const oid = $("#le-offer-id").value || "SKU";
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center";
  modal.innerHTML = `<div style="background:#fff;border-radius:8px;padding:20px;min-width:360px;box-shadow:0 4px 20px rgba(0,0,0,0.15)">
    <h4 style="margin:0 0 12px">一键生成SKU编号</h4>
    <div style="margin-bottom:12px">
      <label style="display:block;margin-bottom:6px;font-size:13px">Offer ID 前缀:</label>
      <input type="text" id="sku-gen-prefix" value="${esc(oid)}" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px" />
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:13px;margin-bottom:6px">选择作为 SKU 后缀的变体维度</div>
      <div id="sku-gen-dimensions">${(state.variantDimensions || []).map((attr, index) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin:4px 0"><input type="checkbox" class="sku-gen-dimension" value="${esc(attr.name)}" ${state.variantDimensions.length > 1 && index === 0 ? "checked" : ""} /> ${esc(attr.name)}</label>`).join("") || "<small>当前没有可用变体维度，将使用序号。</small>"}</div>
      <small style="display:block;color:#777;margin-top:4px">只有颜色时默认保留现有 SKU；颜色和数量同时存在时，可勾选颜色、数量或两者。</small>
    </div>
    <div style="margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="sku-gen-keep-existing" ${(state.variantDimensions || []).length === 1 ? "checked" : ""} /> 仅颜色时保留现有 SKU 后缀</label>
    </div>
    <div style="margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="sku-gen-translate" /> 后缀翻译为俄文
      </label>
    </div>
    <div style="margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="sku-gen-numeric" /> 使用数字序号（如 ${esc(oid)}-01, ${esc(oid)}-02）
      </label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;cursor:pointer">取消</button>
      <button id="sku-gen-confirm" style="padding:6px 16px;background:var(--le-primary,#4a90d9);color:#fff;border:none;border-radius:4px;cursor:pointer">生成</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById("sku-gen-confirm").addEventListener("click", async () => {
    const prefix = document.getElementById("sku-gen-prefix").value.trim() || "SKU";
    const selectedDimensions = [...modal.querySelectorAll(".sku-gen-dimension:checked")].map(input => input.value);
    const keepExisting = document.getElementById("sku-gen-keep-existing").checked;
    const translate = document.getElementById("sku-gen-translate").checked;
    const numeric = document.getElementById("sku-gen-numeric").checked;
    const variantAttrs = state.variantDimensions || [];
    for (let i = 0; i < state.variants.length; i++) {
      let suffix = "";
      if (numeric) {
        suffix = String(i + 1).padStart(2, "0");
      } else if (keepExisting && variantAttrs.length === 1 && selectedDimensions.length === 0) {
        continue;
      } else if (selectedDimensions.length) {
        suffix = selectedDimensions.map(name => state.variants[i].variant_values?.[name] || "").filter(Boolean).join("-").slice(0, 30) || String(i + 1);
      } else {
        suffix = String(i + 1);
      }
      state.variants[i].seller_sku = normalizeOfferId(prefix + "-" + suffix);
    }
    renderVariantTable();
    modal.remove();
    toast("SKU编号已生成", "success");
    // If translate is checked, translate all suffixes
    if (translate) {
      for (let i = 0; i < state.variants.length; i++) {
        await translateSku(i);
      }
    }
  });
};

window.copyFirstRowToAll = function() {
  if (state.variants.length < 2) return;
  const first = state.variants[0];
  const fields = ["barcode", "price_cny", "old_price_cny", "stock", "warehouse_level", "length_mm", "width_mm", "height_mm", "weight_g", "name_ru"];
  for (let i = 1; i < state.variants.length; i++) {
    for (const f of fields) { state.variants[i][f] = first[f]; }
    updateVariantDerivedPrice(state.variants[i]);
  }
  renderVariantTable();
  renderColorSamples();
  scheduleVariantWarehouseMatch();
  toast("已复制首行数据到所有变体", "success");
};
window.fillEanBarcodes = function() {
  for (let i = 0; i < state.variants.length; i++) {
    if (!state.variants[i].barcode) {
      // Generate a simple EAN-13-like barcode (starts with 200 = in-store)
      const base = "200" + String(Date.now()).slice(-9) + String(i).padStart(1, "0");
      state.variants[i].barcode = base.substring(0, 13);
    }
  }
  renderVariantTable();
  toast("已为空条形码填充EAN", "success");
};

// Global warehouse override - set all variants to a specific level
window.setAllWarehouseLevel = function(level) {
  if (!state.variants.length) return;
  if (!level) {
    // Auto-match: re-run warehouse matching
    matchVariantWarehouses();
    toast("已重新自动匹配仓库", "success");
    return;
  }
  for (let i = 0; i < state.variants.length; i++) {
    state.variants[i].warehouse_level = level;
    if (!state.variants[i].stock || state.variants[i].stock === "0") {
      state.variants[i].stock = "999";
    }
  }
  renderVariantTable();
  toast(`已将所有变体仓库设为 ${level}`, "success");
};
window.batchRemoveVariants = function() {
  const checked = $$(".le-variant-row-check:checked");
  if (!checked.length) { toast("请先勾选要删除的变体", "error"); return; }
  const indices = Array.from(checked).map(cb => parseInt(cb.dataset.idx)).sort((a, b) => b - a);
  for (const idx of indices) { state.variants.splice(idx, 1); }
  renderVariantTable();
  renderColorSamples();
  toast(`已删除 ${indices.length} 个变体`, "success");
};
window.removeVariant = function(i) { state.variants.splice(i, 1); renderVariantTable(); renderColorSamples(); };
function addVariantRow() {
  const oid = $("#le-offer-id").value || "SKU";
  const variantAttrs = state.variantDimensions || [];
  const variantValues = {};
  variantAttrs.forEach(a => { variantValues[a.name] = ""; });
  state.variants.push({
    seller_sku: `${oid}-${state.variants.length + 1}`,
    barcode: "", price_cny: "", old_price_cny: "", cost_cny: "",
    stock: "0", length_mm: "", width_mm: "", height_mm: "",
    weight_g: "", name_ru: "", image_url: "", variant_values: variantValues, combo: variantValues
  });
  renderVariantTable();
  renderColorSamples();
}

function editorStatusMeta(status) {
  return {
    unedited: { label: "未编辑", className: "unedited" },
    edited: { label: "已编辑", className: "edited" },
    published: { label: "已发布", className: "published" },
  }[status] || { label: "未编辑", className: "unedited" };
}

function renderEditorQueue() {
  const list = $("#le-queue-list");
  const count = $("#le-queue-count");
  if (!list || !count) return;
  const scrollKey = `ozon-erp.editor-queue-scroll.${state.shopId || "none"}`;
  const alreadyRendered = Boolean(list.querySelector(".le-queue-item"));
  const previousScrollTop = alreadyRendered ? list.scrollTop : Number(sessionStorage.getItem(scrollKey) || 0);
  const params = new URLSearchParams(window.location.search);
  const currentSourceId = String(params.get("sp") || state.sourceProduct?.id || "");
  count.textContent = `${state.editorQueue.length} 个`;
  if (!state.editorQueue.length) {
    list.innerHTML = '<p class="le-placeholder">当前店铺还没有采集商品</p>';
    return;
  }
  list.innerHTML = state.editorQueue.map(product => {
    const meta = editorStatusMeta(product.editor_status);
    const active = String(product.id) === currentSourceId;
    return `<button type="button" class="le-queue-item ${active ? "active" : ""}" data-queue-sp="${product.id}" data-queue-draft="${product.draft_id || ""}" aria-current="${active ? "true" : "false"}">
      <img src="${esc(product.main_image_url || "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="le-queue-copy"><strong title="${esc(product.title || "")}">${esc(product.title || "未命名商品")}</strong><small>${esc(product.offer_id || `货源 ${product.source_product_id || product.id}`)}</small><em class="le-queue-status ${meta.className}">${meta.label}</em></span>
    </button>`;
  }).join("");
  requestAnimationFrame(() => {
    list.scrollTop = Number.isFinite(previousScrollTop) ? previousScrollTop : 0;
    const active = list.querySelector(".le-queue-item.active");
    if (!active) return;
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < listRect.top || activeRect.bottom > listRect.bottom) {
      active.scrollIntoView({ block: previousScrollTop > 0 ? "nearest" : "center" });
    }
    sessionStorage.setItem(scrollKey, String(list.scrollTop));
  });
  list.querySelectorAll("[data-queue-sp]").forEach(button => button.addEventListener("click", () => {
    if (button.classList.contains("active")) return;
    if (state.editorDirty && !window.confirm("当前商品有尚未保存的修改，确定切换到其他商品吗？")) return;
    sessionStorage.setItem(scrollKey, String(list.scrollTop));
    const url = new URL(window.location.href);
    url.searchParams.set("shop", String(state.shopId));
    url.searchParams.set("sp", button.dataset.queueSp);
    url.searchParams.set("returnTo", new URLSearchParams(window.location.search).get("returnTo") || "candidate-pool");
    if (button.dataset.queueDraft) url.searchParams.set("draft", button.dataset.queueDraft); else url.searchParams.delete("draft");
    url.hash = "";
    window.location.href = url.href;
  }));
}

async function loadSourceProductsList() {
  try {
    const products = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products`);
    state.editorQueue = products;
    $("#le-source-select").innerHTML = '<option value="">选择采集商品...</option>' + products.map(p => `<option value="${p.id}">[${p.source_platform}] ${esc(p.title)}</option>`).join("");
    renderEditorQueue();
    toast(`已刷新商品列表（${products.length} 个）`, "success");
  } catch (error) {
    const list = $("#le-queue-list");
    if (list) list.innerHTML = `<p class="le-placeholder">商品列表读取失败：${esc(error.message)}</p>`;
    toast(`商品列表读取失败：${error.message}`, "error");
  }
}
async function loadSourceProductDetail(spId, skipAI) {
  if (!spId) { state.sourceProduct = null; state.sourceSkuImageUrls = new Set(); renderSourcePanel(); return; }
  try {
    state.sourceProduct = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products/${spId}`);
    state.sourceSkuImageUrls = new Set((state.sourceProduct.variants || [])
      .map(v => String(v.image_url || v.sku_image_url || "").trim())
      .filter(Boolean));
    // Existing drafts may still contain legacy SKU images in the public array;
    // remove only source-owned SKU URLs, never images selected from the public
    // gallery for one specific SKU.
    separateSkuImagesFromGallery();
    // A draft may be assigned to a source collected under another shop. The
    // detail endpoint authorizes that exact draft binding, but the shop's
    // source-product list will not contain an option for it. Add a local
    // selected option so the editor visibly reflects the automatic binding.
    const sourceSelect = $("#le-source-select");
    if (sourceSelect) {
      const value = String(spId);
      if (![...sourceSelect.options].some(option => option.value === value)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `[1688] ${state.sourceProduct.title || `货源 ${value}`}（当前草稿绑定）`;
        sourceSelect.appendChild(option);
      }
      sourceSelect.value = value;
    }
    renderSourcePanel();
    await loadAiImageJob();
    if (state.sourceProduct.source_url && !$("#le-source-url").value) $("#le-source-url").value = state.sourceProduct.source_url || "";
    // Older drafts could be created before source SKU inheritance ran, leaving
    // only an empty product-level placeholder. Restore only that safe shape;
    // any real operator-entered variant remains authoritative.
    if (skipAI && shouldRestoreEmptyDraftVariants()) {
      const placeholderVariant = state.variants[0];
      state.variants = [];
      await autoPopulateVariantsFromSource(placeholderVariant);
      toast(`已从采集结果恢复 ${state.variants.length} 个 SKU 及尺重，请保存草稿以持久化`, "success");
    }
    // When skipAI (editing existing draft), do NOT clear images or re-import - draft data takes priority
    if (!skipAI) {
    // Clear previous product's images and translation cache to prevent cross-product pollution
    state.images = [];
    state.translatedImageCache = {};
    state.selectedImages.clear();
    // Auto-import source images (no need to click import button)
    if (state.sourceProduct.media?.length) {
      let imgUrls = state.sourceProduct.media.filter(m => m.media_type === "image").map(m => m.url);
      // Fix 4: Filter out bad images
      // 1. Remove trailing-underscore duplicates (1688 scraper artifact: "xxx.jpg_" duplicates "xxx.jpg")
      imgUrls = imgUrls.filter(u => !u.endsWith("_"));
      // 2. Remove duplicates (case-insensitive)
      const seen = new Set();
      imgUrls = imgUrls.filter(u => { const k = u.toLowerCase().replace(/\.jpg_$/, ".jpg"); if (seen.has(k)) return false; seen.add(k); return true; });
      // 4. Filter out very small images (likely icons/thumbnails) by URL pattern
      imgUrls = imgUrls.filter(u => !u.includes("_60x60") && !u.includes("_50x50") && !u.includes("_40x40") && !u.includes("_30x30"));
      const sourceSkuUrls = new Set((state.sourceProduct.variants || []).map(v => String(v.image_url || v.sku_image_url || "")).filter(Boolean));
      state.images.push(...imgUrls.filter(url => !sourceSkuUrls.has(String(url))));
      onImagesChanged();
    }
    // Auto-fill video from source
    autoFillVideoFromSource();
    if (state.sourceProduct.variants?.length) { state.variants = []; identifyVariantAttributes(); }
    } // end if (!skipAI)
    // Auto-generate Russian title translation + description via AI (no button click needed)
    if (!skipAI) {
    const rawTitle = state.sourceProduct.title || "";
    const cleanTitle = cleanSourceTitle(rawTitle); // Strip supplier name prefix
    if (cleanTitle) {
      // Translate cleaned title to Russian
      try {
        const tr = await api("POST", "/api/v1/ai/translate", { text: cleanTitle, target_lang: "ru", context: titleTranslateContext(state.sourceProduct?.category_hint) });
        $("#le-title").value = tr.translated;
      } catch (_) { $("#le-title").value = cleanTitle; }
      // Auto-match categories with translated title
      autoMatchCategories();
      // Strict sequence: description must finish before rich-content JSON starts.
      await autoGenerateDescriptionThenRichContent(cleanTitle);
      // Note: autoGenerateHashtags() is called after category match completes
      // and attributes are loaded, in the autoMatchCategories callback
    }
    } // end if (!skipAI) for AI generation
  } catch (e) { toast("加载采集商品失败: " + e.message, "error"); }
}

function shouldRestoreEmptyDraftVariants() {
  if (!state.draftId || !Array.isArray(state.sourceProduct?.variants) || state.sourceProduct.variants.length < 2) return false;
  if (state.variants.length !== 1) return false;
  const row = state.variants[0] || {};
  const offerId = $("#le-offer-id")?.value || "";
  // A source with several SKUs must never be represented by the parent Offer
  // ID as its only row. Old drafts may have already inherited an image,
  // dimensions, stock or automatic prices, so those fields cannot decide
  // whether this is the broken placeholder. A real operator-created SKU has
  // its own suffix; preserve that instead of expanding it automatically.
  return row.seller_sku === offerId;
}
function cleanSourceTitle(title) {
  if (!title) return "";
  let cleaned = title.trim();
  // Strip supplier/manufacturer name patterns at the start
  // Pattern 1: "亿兴制品diy..." -> "diy..." (supplier name + suffix)
  // Pattern 2: "华美厂家直销..." -> "..." (direct suffix)
  const supplierPatterns = [
    /^[\u4e00-\u9fff]{2,8}(制品|厂家直销|厂家|工厂|直销|旗舰店|专营店|供货商|供应商|贸易|商贸|工贸|实业)/,
    /^厂家直销/,
    /^跨境(新款|专供|直供|专卖)/,
    /^现货(新款|直供|专供)/,

  ];
  for (const pat of supplierPatterns) {
    const m = cleaned.match(pat);
    if (m) {
      cleaned = cleaned.substring(m[0].length);
      break;
    }
  }
  return cleaned.trim();
}

// Build AI context instruction for title translation: strip supplier names
function titleTranslateContext(baseContext) {
  let ctx = baseContext || "";
  ctx += (ctx ? " " : "") + "重要：标题开头如果是供应商/厂家/公司名称前缀（通常2-4个中文字符，如「亿兴」「华美」等，不是产品本身），翻译时请去掉，从实际产品描述开始翻译。如果是正规品牌名则保留。";
  return ctx;
}

async function refreshOfficialSourceDetail() {
  if (!state.shopId || !state.sourceProduct?.id) return;
  const button = $("#le-refresh-official-detail");
  if (button) { button.disabled = true; button.textContent = "从1688补采中..."; }
  try {
    const result = await api("POST", `/api/v1/shops/${state.shopId}/pipeline/source-products/${state.sourceProduct.id}/refresh-official-detail`);
    state.sourceProduct = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products/${state.sourceProduct.id}`);
    if (state.draftId) await loadDraft(state.draftId);
    renderSourcePanel();
    const officialImageCount = Number(result.official_image_count || 0);
    const refreshedMedia = Number(result.refreshed_media || 0);
    const refreshedPrices = Number(result.refreshed_prices || 0);
    const videoText = result.refreshed_video ? "，已补回视频" : "，视频无新增";
    const detail = `官方详情返回 ${officialImageCount} 张图片，新增 ${refreshedMedia} 张${videoText}，补回 ${refreshedPrices} 个价格；当前图库 ${((state.sourceProduct.media || []).filter(m => m.media_type === "image")).length} 张`;
    const status = $("#le-official-detail-status");
    if (status) { status.textContent = detail; status.className = "le-official-detail-status success"; }
    toast(detail, "success");
  } catch (error) {
    const status = $("#le-official-detail-status");
    if (status) { status.textContent = `补采失败：${error.message}`; status.className = "le-official-detail-status error"; }
    toast(`官方详情补采失败：${error.message}`, "error");
  } finally {
    if (button) { button.disabled = false; button.textContent = "从1688官方详情补采价格/图片/视频"; }
  }
}

async function refreshDraftSourceMaterials() {
  if (!state.shopId || !state.draftId) {
    toast("请先保存或加载当前上架草稿", "error");
    return;
  }
  const button = $("#le-refresh-draft-materials");
  if (button) { button.disabled = true; button.textContent = "回填中..."; }
  try {
    const result = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/refresh-source-materials`);
    await loadDraft(state.draftId);
    if (state.sourceProduct?.id) {
      state.sourceProduct = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products/${state.sourceProduct.id}`);
    }
    renderSourcePanel();
    const videoText = result.video_filled ? "，已补回视频" : "";
    toast(`已本地回填：新增 ${result.added_images} 张图片，更新 ${result.updated_sku_images} 个 SKU 图${videoText}；尚未提交 Ozon。`, "success");
  } catch (error) {
    toast(`货源素材回填失败：${error.message}`, "error");
  } finally {
    const currentButton = $("#le-refresh-draft-materials");
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = "回填最新货源图片与 SKU 图到当前草稿"; }
  }
}

function renderSourcePanel() { const c = $("#le-source-content"); if (!state.sourceProduct) { c.innerHTML = '<p class="le-placeholder">当前草稿没有关联采集商品。</p>'; return; } const sp = state.sourceProduct; const allImgs = (sp.media || []).filter(m => m.media_type === "image"); const skuUrls = new Set((sp.variants || []).map(v => String(v.image_url || "").trim()).filter(Boolean)); const skuImgs = allImgs.filter(m => skuUrls.has(String(m.url || "").trim())); const imgs = allImgs.filter(m => !skuUrls.has(String(m.url || "").trim())); const videos = (sp.media || []).filter(m => m.media_type === "video"); const pkg=sp.packageInfo||{}; const materialButton = state.draftId ? '<button type="button" class="le-btn le-btn-secondary" id="le-refresh-draft-materials" style="margin-top:8px">回填最新货源图片与 SKU 图到当前草稿</button><p class="le-source-image-hint">只更新本地草稿；确认图片后再点击“保存并提交 Ozon”。</p>' : ''; const gallery = imgs.length ? `<h4>详情/公共产品图（${imgs.length}，上传最多取15张）</h4><p class="le-source-image-hint">SKU 图不在此图库中，不会因15张上限被删除。</p><div class="le-source-images">${imgs.map((m,index) => `<button type="button" class="le-source-image-button" data-index="${index}"><img src="${esc(m.url)}" loading="lazy" referrerpolicy="no-referrer" alt="详情图 ${index+1}" /></button>`).join("")}</div>` : '<p class="le-source-image-hint">暂无详情/公共产品图。</p>'; const skuGallery = skuImgs.length ? `<h4>SKU 专属图（${skuImgs.length}，按变体保留）</h4><div class="le-source-images">${skuImgs.slice(0, 100).map((m,index) => `<button type="button" class="le-source-image-button" data-index="${imgs.length + index}"><img src="${esc(m.url)}" loading="lazy" referrerpolicy="no-referrer" alt="SKU图 ${index+1}" /></button>`).join("")}</div>` : ''; c.innerHTML = `<div class="le-source-info"><h4>标题</h4><strong>${esc(sp.title)}</strong>${sp.brand ? `<h4>品牌</h4>${esc(sp.brand)}` : ""}${sp.material ? `<h4>材质</h4>${esc(sp.material)}` : ""}${sp.category_hint ? `<h4>类目提示</h4>${esc(sp.category_hint)}` : ""}</div><form id="le-source-package-form" class="le-source-package"><h4>人工尺重修正</h4><p>保存后立即覆盖商品及全部 SKU，并刷新页面相关属性。</p><div><label>重量（g）<input name="weight_g" type="number" min="0.01" step="0.01" value="${esc(pkg.weightG||'')}" required></label><label>长（mm）<input name="length_mm" type="number" min="0.01" step="0.01" value="${esc(pkg.lengthMm||'')}" required></label><label>宽（mm）<input name="width_mm" type="number" min="0.01" step="0.01" value="${esc(pkg.widthMm||'')}" required></label><label>高（mm）<input name="height_mm" type="number" min="0.01" step="0.01" value="${esc(pkg.heightMm||'')}" required></label></div><button class="le-btn le-btn-primary" type="submit">保存尺重并刷新属性</button></form><button type="button" class="le-btn le-btn-secondary" id="le-refresh-official-detail" style="margin-top:8px">从1688官方详情补采价格/图片/视频</button>${materialButton}<div id="le-official-detail-status" class="le-official-detail-status" role="status" aria-live="polite"></div>${videos.length ? `<h4>视频 (${videos.length})</h4><div class="le-source-videos">${videos.map(v => `<video src="${esc(v.url)}" controls preload="metadata" style="width:100%;max-height:220px;border-radius:6px;background:#111"></video>`).join("")}</div>` : ""}${sp.variants?.length ? `<div class="le-source-info"><h4>变体 (${sp.variants.length})</h4>${sp.variants.map(v => `<div>${esc(v.spec_name)} - ¥${v.price_cny || "?"} (库存${v.stock})</div>`).join("")}</div>` : ""}${gallery}${skuGallery}`; $("#le-source-package-form")?.addEventListener("submit",saveSourcePackage); $("#le-refresh-official-detail")?.addEventListener("click",refreshOfficialSourceDetail); $("#le-refresh-draft-materials")?.addEventListener("click",refreshDraftSourceMaterials); $$(".le-source-image-button").forEach(button=>button.addEventListener("click",()=>openSourceImage(Number(button.dataset.index),[...imgs,...skuImgs]))); }

async function saveSourcePackage(event){event.preventDefault();const form=event.currentTarget;const values=Object.fromEntries(new FormData(form));const payload={weight_g:Number(values.weight_g),length_mm:Number(values.length_mm),width_mm:Number(values.width_mm),height_mm:Number(values.height_mm)};const button=form.querySelector("button");button.disabled=true;try{const result=await api("PUT",`/api/v1/shops/${state.shopId}/pipeline/source-products/${state.sourceProduct.id}/package`,payload);state.sourceProduct=await api("GET",`/api/v1/shops/${state.shopId}/pipeline/source-products/${state.sourceProduct.id}`);state.variants.forEach(variant=>{variant.weight_g=payload.weight_g;variant.length_mm=payload.length_mm;variant.width_mm=payload.width_mm;variant.height_mm=payload.height_mm;});renderSourcePanel();autoFillDefaults(true);renderVariantTable();await matchVariantWarehouses();toast("尺重已写回商品及全部 SKU，属性和物流档位已刷新","success");}catch(error){toast(`尺重保存失败：${error.message}`,"error");}finally{button.disabled=false;}}

function openSourceImage(index,images){let dialog=$("#le-source-image-dialog");if(!dialog){document.body.insertAdjacentHTML("beforeend",'<dialog id="le-source-image-dialog" class="le-source-image-dialog"><div class="le-source-image-head"><strong id="le-source-image-title">查看原图</strong><button type="button" id="le-source-image-close" aria-label="关闭">×</button></div><div class="le-source-image-stage"><button type="button" id="le-source-image-prev" aria-label="上一张">‹</button><img id="le-source-image-large" alt="采集原图"><button type="button" id="le-source-image-next" aria-label="下一张">›</button></div><div class="le-source-image-foot"><span id="le-source-image-count"></span><a id="le-source-image-url" target="_blank" rel="noopener">打开原始地址</a><button type="button" id="le-source-image-done">关闭</button></div></dialog>');dialog=$("#le-source-image-dialog");$("#le-source-image-close").onclick=()=>dialog.close();$("#le-source-image-done").onclick=()=>dialog.close();}let current=index;const show=()=>{const image=images[current];$("#le-source-image-large").src=image.url;$("#le-source-image-count").textContent=`${current+1} / ${images.length}`;$("#le-source-image-url").href=image.url;$("#le-source-image-prev").disabled=current===0;$("#le-source-image-next").disabled=current===images.length-1;};$("#le-source-image-prev").onclick=()=>{if(current>0){current--;show();}};$("#le-source-image-next").onclick=()=>{if(current<images.length-1){current++;show();}};show();dialog.showModal();}

function collectAttributePayload() {
  const payload = [];
  const seen = new Set();
  // First: collect from DOM inputs (rendered attributes)
  $$(".le-attr-input[data-attr-id]").forEach(inp => {
    const aid = inp.dataset.attrId;
    seen.add(aid);
    const a = state.attributes.find(a => String(a.id) === aid);
    // is_collection: use arrays from state
    if (inp.dataset.isCollection === "1") {
      const sv = state.attrValues[aid];
      if (sv && Array.isArray(sv.value_texts) && sv.value_texts.length) {
        payload.push({
          attribute_id: aid,
          name: a?.name || inp.dataset.attrName || "",
          value_id: (sv.value_ids || []).join("|"),
          value_text: sv.value_texts.join("|"),
          is_collection: true
        });
      }
      return;
    }
    const v = inp.value.trim();
    if (!v) return;
    const selectedId = inp.dataset.selectedValueId || null;
    const selectedText = inp.dataset.selectedValueText || "";
    const vid = selectedId || state.attrValues[aid]?.value_id || null;
    if (isDictionaryAttribute(a) && !vid) {
      // The visible text is a search keyword, not a submit value.
      return;
    }
    // Use Ozon's canonical label paired with the selected ID. This protects
    // labels with invisible spaces and avoids a stale AI value mismatching a
    // manually selected dictionary item during backend normalization.
    const valueText = selectedId ? selectedText : v;
    payload.push({ attribute_id: aid, name: a?.name || inp.dataset.attrName || "", value_id: vid, value_text: valueText });
  });
  // Also: include state.attrValues for attributes not rendered in DOM (e.g., optional attrs that were auto-filled)
  for (const attr of state.attributes) {
    const aid = String(attr.id);
    if (seen.has(aid)) continue;
    const sv = state.attrValues[aid];
    if (!sv) continue;
    if (sv.is_collection && Array.isArray(sv.value_texts) && sv.value_texts.length) {
      payload.push({ attribute_id: aid, name: attr.name, value_id: (sv.value_ids || []).join("|"), value_text: sv.value_texts.join("|"), is_collection: true });
    } else if (sv.value_text && (!isDictionaryAttribute(attr) || sv.value_id)) {
      payload.push({ attribute_id: aid, name: attr.name, value_id: sv.value_id || null, value_text: sv.value_text });
    }
  }
  return payload;
}
function collectVariantPayload() {
  return state.variants.map(v => {
    const cleanImage = (value) => {
      const normalized = String(value || "").trim();
      return normalized && !["none", "null", "undefined"].includes(normalized.toLowerCase()) && /^https?:\/\//i.test(normalized) ? normalized : null;
    };
    // Pack variant_values and value_ids together into variant_values_json
    let vvj = null;
    if (v.variant_values) {
      const packed = { ...v.variant_values }; delete packed.__ids__; // Clean stale __ids__
      if (v.variant_value_ids && Object.keys(v.variant_value_ids).length) {
        packed.__ids__ = v.variant_value_ids;
      }
      vvj = JSON.stringify(packed);
    }
    return {
      seller_sku: normalizeOfferId(v.seller_sku),
      purchase_cost_cny: v.cost_cny ? parseFloat(v.cost_cny) : null,
      weight_g: v.weight_g ? parseFloat(v.weight_g) : null,
      length_mm: v.length_mm ? parseFloat(v.length_mm) : null,
      width_mm: v.width_mm ? parseFloat(v.width_mm) : null,
      height_mm: v.height_mm ? parseFloat(v.height_mm) : null,
      barcode: v.barcode || null,
      stock: v.stock ? parseInt(v.stock) : null,
      name_ru: v.name_ru || null,
      image_url: cleanImage(v.image_url),
      image_urls: Array.isArray(v.image_urls) ? v.image_urls.map(cleanImage).filter(Boolean) : null,
      price_cny: v.price_cny ? parseFloat(v.price_cny) : null,
      min_price_cny: v.min_price_cny ? String(v.min_price_cny) : null,
      variant_values_json: vvj
    };
  });
}

async function saveDraft() {
  if (!state.shopId) { toast("请先选择店铺", "error"); return false; }
  const oid = $("#le-offer-id").value.trim(); const t = $("#le-title").value.trim();
  if (!oid || !t) { toast("Offer ID 和标题为必填项", "error"); return false; }
  // Auto-generate rich content if empty
  const richEl = $("#le-rich-content");
  if (richEl && !richEl.value.trim()) {
    try {
      const sn = $("#le-shop-select").selectedOptions[0]?.textContent || "";
      const r = await api("POST", "/api/v1/ai/generate-rich-content", {
        description: $("#le-description").value || "", image_urls: publicGalleryImages().slice(0, 5), shop_name: sn
      });
      richEl.value = r.raw_json; state.richContentCompact = r.rich_content; state.richContentAuto = true;
    } catch (_) { /* proceed without rich content */ }
  }
  // Include rich content in attributes payload
  const attrs = collectAttributePayload();
  const richAttr = state.attributes.find(a => (a.name || "").includes("JSON") || (a.name || "").includes("富内容"));
  if (richAttr) {
    // The visible textarea is authoritative so a manual correction can never
    // be overwritten by stale auto-generated state during save.
    const richVal = richEl?.value?.trim() || state.richContentCompact || "";
    if (richVal) {
      try {
        const parsed = JSON.parse(richVal);
        if (!Array.isArray(parsed?.content) || !parsed.content.length) throw new Error("content 不能为空");
      } catch (error) {
        toast(`富内容 JSON 格式错误：${error.message}`, "error");
        richEl?.focus();
        return false;
      }
      state.richContentCompact = richVal;
      const existing = attrs.find(a => a.attribute_id === String(richAttr.id));
      if (existing) { existing.value_text = richVal; }
      else { attrs.push({ attribute_id: String(richAttr.id), name: richAttr.name, value_id: null, value_text: richVal }); }
    }
  }
  // Map description from section 4 to description attribute
  const descText = $("#le-description").value?.trim() || "";
  if (descText) {
    const descAttr = state.attributes.find(a => a.name === "简介" || ((a.name || "").includes("Описание") && !(a.name || "").includes("JSON")));
    if (descAttr) {
      const existingDesc = attrs.find(a => a.attribute_id === String(descAttr.id));
      if (existingDesc) { existingDesc.value_text = descText; }
      else { attrs.push({ attribute_id: String(descAttr.id), name: descAttr.name, value_id: null, value_text: descText }); }
    }
  }
  const payload = { offer_id: oid, title: t, description: $("#le-description").value || null, category_id: state.categoryId || null, type_id: state.typeId || null, primary_image_url: state.images[0] || null, video_url: $("#le-video-url").value.trim() || null, images: state.images, watermark_config: state.watermark?.enabled && state.watermark?.image_data_url ? { ...state.watermark, applied_hash: null } : { enabled: false }, source_product_id: state.sourceProduct?.id || null, learn_attribute_ids: Array.from(state.learningAttributeIds), attributes: attrs, variants: collectVariantPayload().length ? collectVariantPayload() : [{ seller_sku: oid, purchase_cost_cny: null, weight_g: null, length_mm: null, width_mm: null, height_mm: null }] };
  try {
    if (state.draftId) {
      await api("PUT", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}`, payload);
    } else {
      const d = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts`, payload);
      state.draftId = d.id;
      // Bind this editor session to the newly-created draft immediately.  A
      // refresh after an automatic save (for example AI image apply) must load
      // the persisted draft rather than rebuilding a new unsaved source view.
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set("draft", String(d.id));
      window.history.replaceState({}, "", currentUrl);
    }
    state.editorDirty = false;
    await loadSourceProductsList();
    renderAiImageJob(); toast("草稿已保存", "success"); return true;
  } catch (e) { toast("保存失败: " + e.message, "error"); return false; }
}

function showSubmittedState(message, taskId = state.lastImportTaskId) {
  state.isSubmitted = true;
  state.lastImportTaskId = taskId || state.lastImportTaskId;
  const btn = $("#le-submit-btn");
  const status = $("#le-submit-status");
  if (btn) { btn.textContent = "修改后重新提交"; btn.disabled = false; btn.classList.remove("le-submitted"); }
  const attributesBtn = $("#le-update-attributes-btn");
  if (attributesBtn) attributesBtn.style.display = "inline-block";
  if (status) { status.hidden = false; status.textContent = message || `已提交${state.lastImportTaskId ? ` · task_id: ${state.lastImportTaskId}` : ""}；修改后可重新提交`; }
  const feedbackBtn = $("#le-sync-feedback-btn");
  if (feedbackBtn) feedbackBtn.style.display = "inline-block";
  configureEditorBackLink();
}

function ozonIssueFixable(issue) {
  return Boolean(issue?.auto_fixable || ["VALUE_MIN_LIMIT", "BR_ASSORTMENT"].includes(String(issue?.code || "").toUpperCase()));
}

function ozonIssueDisplay(issue) {
  const code = String(issue?.code || "").toUpperCase();
  const offer = issue?.offer_id ? `SKU：${issue.offer_id}` : "";
  if (code === "DESCRIPTION_CATEGORY_HAS_NO_DESCRIPTION_TYPE") {
    return `${offer}${offer ? "。" : ""}此 Offer 已有 Ozon 商品卡，不能用重新导入变更类目。请恢复该卡原有类目/类型和属性，或改用新 Offer ID 新建商品卡。`;
  }
  if (code === "VALUE_MIN_LIMIT") {
    return `${offer}${offer ? "。" : ""}数值低于 Ozon 最小值，请确认单位；自动修复会移除无证据的可选 0 值。`;
  }
  if (code === "BR_ASSORTMENT") {
    return `${offer}${offer ? "。" : ""}描述中不能出现“随机/混款/按订单确认颜色”。该商品已有颜色 SKU，自动修复会删除这类文案。`;
  }
  return issue?.description || issue?.message || issue?.field || issue?.code || "Ozon 导入失败";
}

function locateOzonIssue(issue) {
  const code = String(issue?.code || "").toUpperCase();
  const field = String(issue?.field || "").toLowerCase();
  let target = null;
  if (code === "DESCRIPTION_CATEGORY_HAS_NO_DESCRIPTION_TYPE" || field.includes("description_category") || field === "type_id") {
    target = $("#le-section-category");
    $("#le-category-search")?.focus({ preventScroll: true });
  } else if (issue?.attribute_id) {
    const attributeInput = document.querySelector(`.le-attr-input[data-attr-id="${CSS.escape(String(issue.attribute_id))}"]`);
    target = attributeInput?.closest(".le-attr-row") || attributeInput;
  } else if (field.includes("image")) {
    target = $("#le-section-images");
  } else if (field.includes("name") || field.includes("title")) {
    target = $("#le-title");
  } else if (field.includes("description") || field.includes("annotation")) {
    target = $("#le-description");
  } else if (/(weight|length|width|height|depth)/.test(field)) {
    target = $("#le-section-variants");
  }
  if (!target) { toast("Ozon 未返回可定位字段，请按错误说明检查对应内容", "error"); return; }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("le-issue-target");
  window.setTimeout(() => target.classList.remove("le-issue-target"), 1800);
  if (target.matches("input, textarea, select")) target.focus({ preventScroll: true });
}

function uniqueOzonIssues(issues) {
  const seen = new Set();
  return (issues || []).filter(issue => {
    const key = [issue?.offer_id || "", issue?.code || "", issue?.field || "", issue?.description || issue?.message || ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function submitDraft() {
  if (!state.shopId) { toast("请先选择店铺", "error"); return; }
  if (state.isSubmitted && !window.confirm("这是完整重新导入，用于价格、尺重、图片、标题或 SKU 变更。Ozon 会返回新的导入任务号，但原 Offer ID 不变。若只改产品属性，请取消并使用‘仅更新产品属性’。继续完整提交？")) return;
  // Save first
  const saved = await saveDraft();
  if (!saved || !state.draftId) { toast("保存失败，无法提交", "error"); return; }
  const btn = $("#le-submit-btn");
  if (btn) { btn.textContent = state.isSubmitted ? "重新提交中..." : "提交中..."; btn.disabled = true; }
  try {
    const r = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/submit`);
    const hasImportErrors = Array.isArray(r.import_errors) && r.import_errors.length > 0;
    toast(r.message || (hasImportErrors ? "Ozon 已返回导入问题" : "提交成功"), hasImportErrors ? "error" : "success");
    await loadDraft(state.draftId);
    if (r.submission_mode === "no_changes") {
      showSubmittedState("没有检测到待提交改动，未调用 Ozon，也未创建新任务。", null);
      return;
    }
    if (r.submission_mode === "attributes_update") {
      showSubmittedState(`系统识别为仅属性修改，已更新原 Ozon Offer（${(r.updated_offer_ids || []).join("、")}），未创建导入任务。`, null);
      return;
    }
    showSubmittedState(hasImportErrors
      ? `Ozon 已返回导入问题 · task_id: ${r.task_id || ""}；请按左侧错误修正后再提交`
      : `${state.lastImportTaskId ? "已重新提交" : "已提交"}到 Ozon${r.task_id ? ` · 新 task_id: ${r.task_id}` : ""}；库存状态将在采集箱持续更新`, r.task_id || null);
  } catch (e) {
    toast("提交失败: " + e.message, "error");
    if (btn) { btn.textContent = state.isSubmitted ? "修改后重新提交" : "保存并提交"; btn.disabled = false; }
  }
}

async function updateProductAttributes() {
  if (!state.shopId || !state.draftId || !state.isSubmitted) { toast("请先完成一次完整提交，确认 Ozon 商品已存在", "error"); return; }
  if (!window.confirm("将只更新当前 Ozon Offer 的产品属性。价格、尺重、图片、标题和 SKU 不会发送，也不会创建新的导入任务。确认更新？")) return;
  const saved = await saveDraft();
  if (!saved) return;
  const btn = $("#le-update-attributes-btn");
  if (btn) { btn.textContent = "属性更新中..."; btn.disabled = true; }
  try {
    const result = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/attributes/update`);
    toast(result.message || "已更新原商品属性", "success");
    showSubmittedState(`已更新原 Ozon 商品属性（${(result.updated_offer_ids || []).join("、")}），未创建导入任务。`, null);
  } catch (error) {
    toast("属性更新失败: " + error.message, "error");
  } finally {
    if (btn) { btn.textContent = "仅更新产品属性"; btn.disabled = false; }
  }
}

// Sync quality feedback from Ozon
async function syncFeedback() {
  if (!state.draftId) { toast("请先保存草稿", "error"); return; }
  const btn = $("#le-sync-feedback-btn");
  if (btn) { btn.textContent = "刷新中..."; btn.disabled = true; }
  try {
    const r = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/sync-feedback`);
    renderFeedbackPanel(r);
    toast(r.ozon_product_id == null ? "已同步 Ozon 导入任务结果" : (r.overall_rating == null ? "反馈已同步，Ozon 暂未生成评分" : `反馈已同步，评分: ${r.overall_rating}`), "success");
  } catch (e) {
    toast("同步反馈失败: " + e.message, "error");
  } finally {
    if (btn) { btn.textContent = "刷新 Ozon 状态"; btn.disabled = false; }
  }
}

function renderFeedbackPanel(data) {
  const panel = $("#le-feedback-panel");
  panel.style.display = "block";
  $("#le-feedback-rating").textContent = data.overall_rating == null ? "Ozon 暂未评分" : `${data.overall_rating}/100`;
  // Render group scores
  const groupsEl = $("#le-feedback-groups");
  groupsEl.innerHTML = (data.groups || []).map(g => {
    const pct = g.rating || 0;
    const color = pct >= 80 ? "#27ae60" : pct >= 50 ? "#f39c12" : "#e74c3c";
    return `<div style="flex:1;min-width:120px;padding:6px;border-radius:6px;background:#fff;border:1px solid #eee">
      <div style="font-size:11px;color:#666">${esc(g.name || g.key || "")}</div>
      <div style="font-size:16px;font-weight:bold;color:${color}">${pct}</div>
      <div style="font-size:10px;color:#999">权重 ${g.weight || 0}%</div>
    </div>`;
  }).join("");
  // Render issues - prioritize real Ozon errors
  const issuesEl = $("#le-feedback-issues");
  const issues = uniqueOzonIssues(data.issues || []);
  // Show moderation/validation status
  let statusHtml = "";
  if (data.moderation_status || data.validation_status) {
    const mod = data.moderation_status || "";
    const val = data.validation_status || "";
    const modColor = mod === "approved" ? "#27ae60" : "#e74c3c";
    const valColor = val === "success" ? "#27ae60" : "#e74c3c";
    statusHtml = '<div style="padding:4px 6px;background:#fff;border-radius:4px;margin-bottom:4px;font-size:12px">审核状态: <span style="color:' + modColor + ';font-weight:600">' + esc(mod) + '</span> | 验证状态: <span style="color:' + valColor + ';font-weight:600">' + esc(val) + '</span></div>';
  }
  if (!issues.length && !(data.ozon_errors || []).length) {
    issuesEl.innerHTML = statusHtml + '<div style="color:#27ae60;padding:8px;font-weight:600">✓ 没有发现问题</div>';
  } else {
    // Split into hard errors vs rating improvement suggestions
    const errors = issues.filter(i => i.type === "ozon_error");
    const suggestions = issues.filter(i => i.type !== "ozon_error");
    let html = statusHtml;
    if (errors.length) {
      html += '<div style="font-weight:600;color:#e74c3c;font-size:13px;padding:6px 4px 2px;border-bottom:2px solid #e74c3c;margin-bottom:4px">⚠ Ozon 错误（必须处理）</div>';
      html += errors.map(function(iss) {
        var detail = esc(ozonIssueDisplay(iss));
        if (iss.field) detail = '<small style="color:#999">[' + esc(iss.field) + ']</small> ' + detail;
        var severity = iss.level === "critical" ? "#e74c3c" : (iss.level === "warning" ? "#f39c12" : "#e67e22");
        var levelLabel = iss.level === "critical" ? "严重 " : (iss.level === "warning" ? "警告 " : "");
        var fixLabel = ozonIssueFixable(iss) ? '<span style="font-size:10px;color:#e17055;white-space:nowrap">可自动修复</span>' : '<span style="font-size:10px;color:#999;white-space:nowrap">需手动</span>';
        return '<div style="padding:6px 4px;border-bottom:1px solid #f3d6d6;display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:' + severity + '">' + (levelLabel ? '<strong>' + levelLabel + '</strong>' : '') + detail + '</span>' + fixLabel + '</div>';
      }).join("");
    }
    if (suggestions.length) {
      if (errors.length) html += '<div style="height:8px"></div>';
      html += '<div style="font-weight:600;color:#2980b9;font-size:13px;padding:6px 4px 2px;border-bottom:2px solid #3498db;margin-bottom:4px">💡 优化建议（提升内容评分）</div>';
      html += suggestions.map(function(iss) {
        var detail = esc(iss.description || iss.attribute_name || iss.key || "");
        if (iss.group) detail = '<small style="color:#999">[' + esc(iss.group) + ']</small> ' + detail;
        var fixLabel = iss.auto_fixable ? '<span style="font-size:10px;color:#27ae60;white-space:nowrap">可自动优化</span>' : '<span style="font-size:10px;color:#999;white-space:nowrap">手动</span>';
        return '<div style="padding:6px 4px;border-bottom:1px solid #d6eaf8;display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:#2c3e50">' + detail + '</span>' + fixLabel + '</div>';
      }).join("");
    }
    issuesEl.innerHTML = html;
  }
  // Show auto-fix button if there are fixable issues
  const hasFixable = issues.some(ozonIssueFixable);
  $("#le-auto-fix-btn").style.display = hasFixable ? "inline-block" : "none";
}

// Auto-fix listing issues
async function autoFixListing() {
  if (!state.draftId) { toast("请先保存草稿", "error"); return; }
  const btn = $("#le-auto-fix-btn");
  if (btn) { btn.textContent = "修复中..."; btn.disabled = true; }
  try {
    const r = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/auto-fix`);
    if (r.fix_count > 0) {
      toast("已修复 " + r.fix_count + " 项", "success");
      // Reload the corrected local draft. Do not sync the old task here: its
      // errors are historical evidence, while this draft now awaits a fresh
      // submission with the corrected payload.
      await loadDraft(state.draftId);
      toast("本地内容已修复，请点击“修改后重新提交”发送新 task", "success");
    } else {
      toast("没有可自动修复的问题", "");
    }
  } catch (e) {
    toast("自动修复失败: " + e.message, "error");
  } finally {
    if (btn) { btn.textContent = "自动修复"; btn.disabled = false; }
  }
}

async function loadDraft(draftId) {
  try {
    const d = await api("GET", `/api/v1/shops/${state.shopId}/listing-drafts/${draftId}`);
    // A draft is a complete persisted snapshot. Clear the previous product's
    // transient state before applying it, otherwise omitted/empty values can
    // leak in from the product that was open immediately beforehand.
    state.attrValues = {};
    state.images = [];
    state.variants = [];
    state.richContentCompact = null;
    state.richContentAuto = false;
    state.draftId = d.id;
    state.isSubmitted = d.status === "submitted";
    state.lastImportTaskId = d.import_task_id || null;
    $("#le-offer-id").value = d.offer_id || "";
    $("#le-title").value = d.title || "";
    $("#le-description").value = d.description || "";
    $("#le-video-url").value = d.video_url || "";
    $("#le-video-url").dispatchEvent(new Event("input"));
    state.categoryId = d.category_id || null;
    state.typeId = d.type_id || null;
    if (state.categoryId && state.typeId) {
      await hydrateSavedCategoryLabel(state.categoryId, state.typeId);
    }
    state.learningAttributeIds = new Set((d.learning_attribute_ids || []).map(String));
    if (d.watermark_config) { state.watermark = { ...state.watermark, ...d.watermark_config }; saveWatermarkPreset(); renderWatermarkSettings(); }
    // Load images
    if (d.images && d.images.length) state.images = d.images;
    // Load attributes
    if (d.attribute_values) {
      for (const av of d.attribute_values) {
        state.attrValues[String(av.attribute_id)] = { value_id: av.value_id, value_text: av.value_text };
      }
    }
    // JSON rich content has its own editor outside the dynamic attribute
    // list. Restore it explicitly from the canonical Ozon attribute 11254.
    const savedRichContent = (d.attribute_values || []).find(av => String(av.attribute_id) === "11254")?.value_text || "";
    const richContentEl = $("#le-rich-content");
    if (richContentEl) richContentEl.value = savedRichContent;
    state.richContentCompact = savedRichContent || null;
    state.richContentAuto = Boolean(savedRichContent);
    // Reload category attributes if category is set
    if (state.categoryId && state.typeId) {
      await loadAttributes({ autoFill: false });
      // Re-apply attribute values after attributes are loaded
      for (const av of d.attribute_values) {
        const inp = $(`.le-attr-input[data-attr-id="${av.attribute_id}"]`);
        if (inp) inp.value = av.value_text || "";
      }
    }
    // Load variants
    if (d.variants && d.variants.length) {
      state.variants = d.variants.map(v => ({
        seller_sku: v.seller_sku, cost_cny: v.purchase_cost_cny?.toString() || "",
        weight_g: v.weight_g?.toString() || "", length_mm: v.length_mm?.toString() || "",
        width_mm: v.width_mm?.toString() || "", height_mm: v.height_mm?.toString() || "",
        barcode: v.barcode || "", stock: v.stock?.toString() || "",
        name_ru: v.name_ru || "", image_url: v.image_url || "",
        image_urls: Array.isArray(v.image_urls) ? [...v.image_urls] : null,
        price_cny: v.price_cny?.toString() || "", old_price_cny: v.old_price_cny?.toString() || "",
        min_price_cny: v.min_price_cny || "",
        variant_values: (() => {
          if (!v.variant_values_json) return null;
          try {
            const parsed = JSON.parse(v.variant_values_json);
            const ids = parsed.__ids__;
            if (ids) delete parsed.__ids__;
            return normalizeLoadedVariantValues(parsed, v.seller_sku);
          } catch (_) { return null; }
        })(),
        variant_value_ids: (() => {
          if (!v.variant_values_json) return null;
          try {
            const parsed = JSON.parse(v.variant_values_json);
            return parsed.__ids__ || null;
          } catch (_) { return null; }
        })()
      }));
    }
    separateSkuImagesFromGallery();
    await autoMatchVariantColors();
    renderAttributes();
    renderImages();
    renderVariantTable();
    // Warehouse eligibility is derived entirely from the loaded price and
    // package data. Re-evaluate it immediately instead of making operators
    // click the unrelated package-save button.
    if (state.variants.some(v => Number(v.price_cny) > 0 && Number(v.weight_g) > 0 && Number(v.length_mm) > 0 && Number(v.width_mm) > 0 && Number(v.height_mm) > 0)) {
      await matchVariantWarehouses();
    }
    onImagesChanged();
    // Show Ozon issues panel if available
    if (d.ozon_issues && d.ozon_issues.length) {
      const panel = document.getElementById("le-issues-panel");
      const list = document.getElementById("le-issues-list");
      if (panel && list) {
        const uniqueIssues = uniqueOzonIssues(d.ozon_issues);
        list.innerHTML = uniqueIssues.map((iss, index) => {
          const color = iss.level === "ERROR_LEVEL_ERROR" || iss.type === "ozon_error" ? "#d32f2f" : "#f57c00";
          const fixable = ozonIssueFixable(iss) ? '<span style="font-size:10px;color:#388e3c">可自动修复</span>' : "";
          const location = String(iss.code || "").toUpperCase() === "DESCRIPTION_CATEGORY_HAS_NO_DESCRIPTION_TYPE" ? "修改位置：顶部 ① 店铺与类目" : (iss.attribute_id ? `修改位置：属性 ${esc(String(iss.attribute_name || iss.attribute_id))}` : "");
          return `<div style="padding:8px;border-bottom:1px solid #eee"><div style="display:flex;justify-content:space-between"><span style="color:${color};font-weight:600;font-size:12px">${esc(iss.code || iss.type || "问题")}</span>${fixable}</div><div style="font-size:11px;color:#666;margin-top:4px;line-height:1.4">${esc(ozonIssueDisplay(iss))}</div>${iss.field ? `<div style="font-size:10px;color:#999;margin-top:2px">字段: ${esc(iss.field)}</div>` : ""}${location ? `<div style="font-size:11px;color:#b45309;margin-top:4px">${location}</div><button type="button" class="le-issue-locate" data-issue-index="${index}">定位修改处</button>` : ""}</div>`;
        }).join("");
        list.querySelectorAll(".le-issue-locate").forEach(button => button.addEventListener("click", () => locateOzonIssue(uniqueIssues[Number(button.dataset.issueIndex)])));
        panel.style.display = "block";
        const autoFixButton = $("#le-auto-fix-btn");
        if (autoFixButton) autoFixButton.style.display = uniqueIssues.some(ozonIssueFixable) ? "inline-block" : "none";
      }
    }
    state.editorDirty = false;
    toast("草稿已加载", "success");
    // Show sync-feedback button for submitted drafts
    const feedbackBtn = $("#le-sync-feedback-btn");
    if (feedbackBtn) feedbackBtn.style.display = (d.status === "submitted") ? "inline-block" : "none";
    if (d.status === "submitted") showSubmittedState(`该商品已提交${d.import_task_id ? ` · task_id: ${d.import_task_id}` : ""}；修改尺寸后可重新提交`, d.import_task_id || null);
    // A draft already carries its exact source product. Load that source into
    // the right-hand evidence panel automatically; never make the operator
    // search the full source list to find the current product.
    if (d.source_product_id) await loadSourceProductDetail(d.source_product_id, true);
  } catch (e) {
    toast("加载草稿失败: " + e.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  configureEditorBackLink();
  // Don't load global translation cache - each product should start with fresh original images
  state.translatedImageCache = {};
  setupVideoHandlers();
  $("#le-queue-refresh")?.addEventListener("click", loadSourceProductsList);
  $("#le-queue-list")?.addEventListener("scroll", event => {
    if (!state.shopId) return;
    sessionStorage.setItem(`ozon-erp.editor-queue-scroll.${state.shopId}`, String(event.currentTarget.scrollTop));
  }, { passive: true });
  ["input", "change"].forEach(eventName => document.addEventListener(eventName, event => {
    if (event.isTrusted && event.target.closest?.("#le-form-area")) state.editorDirty = true;
  }));
  $("#le-open-source-url")?.addEventListener("click", () => {
    const rawUrl = String($("#le-source-url")?.value || "").trim();
    let sourceUrl;
    try { sourceUrl = new URL(rawUrl); }
    catch (_) { toast("来源 URL 无效，无法打开", "error"); return; }
    if (!["http:", "https:"].includes(sourceUrl.protocol)) { toast("来源 URL 必须是 HTTP(S) 地址", "error"); return; }
    window.open(sourceUrl.href, "_blank", "noopener,noreferrer");
  });
  await initWatermarkSettings();
  await loadShops();
  $("#le-shop-select").addEventListener("change", onShopChange);
  $("#le-category-search").addEventListener("input", (e) => { manualCategorySelection = false; clearTimeout(state.categorySearchTimer); clearTimeout(categoryMatchTimer); state.categorySearchTimer = setTimeout(() => searchCategories(e.target.value.trim()), 300); });
  $("#le-category-dropdown-btn").addEventListener("click", toggleCategoryDropdown);
  $("#le-tree-browser-btn").addEventListener("click", openTreeBrowser);
  $("#le-tree-close").addEventListener("click", closeTreeBrowser);
  $("#le-tree-modal").addEventListener("click", (e) => { if (e.target.id === "le-tree-modal") closeTreeBrowser(); });
  document.addEventListener("click", (e) => { if (categoryDropdownOpen && !e.target.closest(".le-combobox")) { $("#le-category-dropdown").style.display = "none"; categoryDropdownOpen = false; } });
  $("#le-show-optional").addEventListener("change", renderAttributes);
  $$("[data-ai-action]").forEach(btn => btn.addEventListener("click", () => { const a = btn.dataset.aiAction; if (a === "translate-title") aiTranslateTitle(btn); else if (a === "generate-description") aiGenerateDescription(btn); else if (a === "translate-description") aiTranslateDescription(btn); else if (a === "generate-rich-content") aiGenerateRichContent(btn);
      else if (a === "generate-hashtags") aiGenerateHashtags(btn);
      else if (a === "match-materials") aiMatchMaterials(btn); }));
  $("#le-intelligent-title")?.addEventListener("click", () => intelligentTitleGenerate($("#le-intelligent-title")));
  $("#le-ai-fill-all-attrs").addEventListener("click", () => autoFillFromAPI());
  $("#le-add-image").addEventListener("click", addImage);
  $("#le-image-url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addImage(); } });
  $("#le-import-source-images").addEventListener("click", importSourceImages);
  $("#le-translate-images").addEventListener("click", translateSelectedImages);
  $("#le-ai-generate-images").addEventListener("click", generateAiImages);
  $("#le-ai-apply-images").addEventListener("click", applyAiImages);
  $("#le-ai-creative-group")?.addEventListener("change", async event => { state.aiCreativeGroupKey = event.target.value || "__product__"; await loadAiImageJob(); });
  $("#le-add-variant-row").addEventListener("click", addVariantRow);
  $("#le-source-select").addEventListener("change", (e) => loadSourceProductDetail(e.target.value));
  $("#le-save-template-btn").addEventListener("click", saveListingTemplate);
  $("#le-apply-template-btn").addEventListener("click", applyListingTemplate);
  $("#le-save-btn").addEventListener("click", saveDraft);
  $("#le-submit-btn").addEventListener("click", submitDraft);
  $("#le-update-attributes-btn").addEventListener("click", updateProductAttributes);
  $("#le-sync-feedback-btn").addEventListener("click", syncFeedback);
  $("#le-auto-fix-btn").addEventListener("click", autoFixListing);
  $$(".le-section-title").forEach(t => t.addEventListener("click", () => t.parentElement.classList.toggle("le-section-collapsed")));
  // 分类记忆确认按钮
  const confirmBtn = document.getElementById("le-memory-confirm");
  const onceBtn = document.getElementById("le-memory-once");
  if (confirmBtn) confirmBtn.addEventListener("click", () => {
    confirmBtn.disabled = true; const orig = confirmBtn.textContent; confirmBtn.textContent = "保存中…";
    recordCategoryDecision(state.categoryLearningMode || "confirm").finally(() => {
      confirmBtn.disabled = false; confirmBtn.textContent = orig;
    });
  });
  if (onceBtn) onceBtn.addEventListener("click", () => {
    onceBtn.disabled = true; const orig = onceBtn.textContent; onceBtn.textContent = "处理中…";
    recordCategoryDecision("one_off").finally(() => {
      onceBtn.disabled = false; onceBtn.textContent = orig;
    });
  });

  // Parse URL params for shop, source product, and draft
  const params = new URLSearchParams(window.location.search);
  const urlShop = params.get("shop");
  const urlSp = params.get("sp");
  const urlDraft = params.get("draft");
  if (urlShop && $("#le-shop-select").value === urlShop) {
    await onShopChange();
    if (urlDraft) {
      // Draft exists: load draft first (no AI re-generation), then source for reference only.
      await loadDraft(urlDraft);
      if (urlSp) await loadSourceProductDetail(urlSp, true);
    } else if (urlSp) {
      // No draft yet: source loading may run the initial AI fill.
      await loadSourceProductDetail(urlSp, false);
    }
  }
  state.editorDirty = false;
  renderEditorQueue();
});

