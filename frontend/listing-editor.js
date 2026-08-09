/* v4 - combobox + tree browser with search + match history */
"use strict";
const API_BASE = window.ERP_API_BASE || "http://127.0.0.1:8000";
const state = { shopId: null, categoryId: null, typeId: null, attributes: [], attrValues: {}, images: [], variants: [], variantDimensions: [], sourceProduct: null, draftId: null, categorySearchTimer: null, dictSearchTimers: {}, richContentCompact: null, richContentAuto: false, selectedImages: new Set(), translatedImageCache: {} };
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
function toast(msg, type = "") { const el = $("#le-toast"); el.textContent = msg; el.className = "show " + type; setTimeout(() => (el.className = ""), 3000); }
async function api(method, path, body) { const opts = { method, headers: { "Content-Type": "application/json" } }; if (body) opts.body = JSON.stringify(body); const res = await fetch(`${API_BASE}${path}`, opts); if (!res.ok) { const err = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(err.detail || `HTTP ${res.status}`); } return res.json(); }

async function loadShops() {
  const shops = await api("GET", "/api/v1/shops");
  const sel = $("#le-shop-select");
  sel.innerHTML = '<option value="">选择店铺</option>' + shops.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  const urlShop = new URLSearchParams(location.search).get("shop");
  if (urlShop && shops.some((s) => String(s.id) === urlShop)) { sel.value = urlShop; onShopChange(); }
}

async function onShopChange() {
  state.shopId = $("#le-shop-select").value;
  if (!state.shopId) return;
  state.categoryId = null; state.typeId = null; state.attributes = []; state.attrValues = {};
  $("#le-category-search").value = ""; $("#le-category-dropdown").innerHTML = ""; $("#le-category-dropdown").style.display = "none";
  $("#le-category-path").textContent = "未选择类目"; $("#le-category-suggestions").innerHTML = "";
  renderAttributes(); loadSourceProductsList(); autoGenerateOfferId();
}

async function autoGenerateOfferId() {
  if (!state.shopId) return;
  try {
    const r = await api("GET", `/api/v1/shops/${state.shopId}/next-offer-id`);
    $("#le-offer-id").value = r.offer_id;
  } catch (_) {}
}

let categoryMatchTimer = null;
async function autoMatchCategories() {
  const rawTitle = state.sourceProduct?.title || $("#le-title").value;
  const title = rawTitle ? cleanSourceTitle(rawTitle) : $("#le-title").value;
  if (!title || title.length < 4) return;
  clearTimeout(categoryMatchTimer);
  categoryMatchTimer = setTimeout(async () => {
    const container = $("#le-category-suggestions");
    container.innerHTML = '<small class="le-hint"><span class="le-loading"></span> 正在自动匹配类目...</small>';
    try {
      const r = await api("POST", `/api/v1/shops/${state.shopId}/ai/match-category`, { title, material: state.sourceProduct?.material || "", brand: state.sourceProduct?.brand || "" });
      renderCategorySuggestions(r.candidates || r);
    } catch (e) { container.innerHTML = `<small class="le-hint" style="color:var(--le-danger)">匹配失败: ${esc(e.message)}</small>`; }
  }, 500);
}

function renderCategorySuggestions(candidates) {
  const container = $("#le-category-suggestions");
  if (!candidates.length) { container.innerHTML = '<small class="le-hint">未找到匹配类目，请手动搜索或点击🗂浏览类目树。</small>'; return; }
  const label = candidates[0]?.source === "history" ? "👉历史匹配" : "自动匹配";
  container.innerHTML = '<small class="le-hint" style="margin-bottom:6px">' + label + '结果（已选第一个，可点击切换）：</small>' +
    candidates.map((c, i) => `<div class="le-cat-suggestion ${i === 0 ? "selected" : ""}" data-cat-id="${esc(c.category_id)}" data-type-id="${esc(c.type_id)}" data-title="${esc(c.title_zh || c.title)}"><span>${i === 0 ? "★ " : ""}${esc(c.title_zh || c.title)}</span><span class="le-cat-score">${i === 0 ? '<span class="le-cat-badge">已选</span>' : "评分 " + c.score}</span></div>`).join("");
  $$(".le-cat-suggestion").forEach((el) => { el.addEventListener("click", () => { $$(".le-cat-suggestion").forEach((e) => e.classList.remove("selected")); el.classList.add("selected"); selectCategory(el.dataset.catId, el.dataset.typeId, el.dataset.title); }); });
  if (candidates[0]) selectCategory(candidates[0].category_id, candidates[0].type_id, candidates[0].title_zh || candidates[0].title);
}

let categoryDropdownOpen = false; let categoryAllItems = [];
function toggleCategoryDropdown() { const d = $("#le-category-dropdown"); if (categoryDropdownOpen) { d.style.display = "none"; categoryDropdownOpen = false; return; } d.style.display = "block"; categoryDropdownOpen = true; if (!d.innerHTML.trim()) loadAllCategories(); }
async function loadAllCategories() { if (!state.shopId) return; const d = $("#le-category-dropdown"); d.innerHTML = '<div class="le-combobox-empty"><span class="le-loading"></span> 加载类目...</div>'; try { const cats = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories`); categoryAllItems = cats; renderCategoryDropdown(cats.slice(0, 100)); } catch (e) { d.innerHTML = `<div class="le-combobox-empty">加载失败: ${esc(e.message)}</div>`; } }
async function searchCategories(query) { if (!state.shopId) return; const d = $("#le-category-dropdown"); d.style.display = "block"; categoryDropdownOpen = true; if (query.length < 2) { renderCategoryDropdown(categoryAllItems.slice(0, 100)); return; } try { let cats = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories?query=${encodeURIComponent(query)}`); if (!cats.length) { await api("POST", `/api/v1/shops/${state.shopId}/metadata/categories`); cats = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories?query=${encodeURIComponent(query)}`); } renderCategoryDropdown(cats); } catch (e) { d.innerHTML = `<div class="le-combobox-empty">搜索失败: ${esc(e.message)}</div>`; } }
function renderCategoryDropdown(cats) { const d = $("#le-category-dropdown"); if (!cats.length) { d.innerHTML = '<div class="le-combobox-empty">无匹配类目</div>'; return; } d.innerHTML = cats.map((c) => `<div class="le-combobox-option" data-cat-id="${esc(c.category_id)}" data-type-id="${esc(c.type_id)}" data-title="${esc(c.title_zh || c.title)}"><span class="le-cat-zh">${esc(c.title_zh || c.title)}</span>${c.title && c.title_zh ? `<span class="le-cat-ru">${esc(c.title)}</span>` : ""}</div>`).join(""); $$(".le-combobox-option").forEach((el) => { el.addEventListener("click", () => selectCategory(el.dataset.catId, el.dataset.typeId, el.dataset.title)); }); }
function selectCategory(catId, typeId, title) { const isManualChange = state.categoryId && state.categoryId !== catId; state.categoryId = catId; state.typeId = typeId; $("#le-category-search").value = title; $("#le-category-path").textContent = `已选: ${title} (ID: ${catId}, Type: ${typeId})`; $("#le-category-dropdown").style.display = "none"; categoryDropdownOpen = false; if (isManualChange) { $("#le-category-suggestions").innerHTML = '<small class="le-hint" style="color:var(--le-primary)">已手动切换类目，属性重新加载中...</small>'; } loadAttributes(); saveCategoryMatch(title, catId, typeId); }

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

async function saveCategoryMatch(titleZh, catId, typeId) {
  const title = state.sourceProduct?.title || $("#le-title").value || titleZh;
  if (!title || !catId || !typeId) return;
  try { await api("POST", `/api/v1/shops/${state.shopId}/category-match-history`, { title, category_id: catId, type_id: typeId, category_title_zh: titleZh, source: "manual" }); } catch (_) {}
}

async function loadAttributes() {
  if (!state.shopId || !state.categoryId || !state.typeId) return;
  const c = $("#le-attributes-container");
  c.innerHTML = '<p class="le-placeholder"><span class="le-loading"></span> 正在加载 Ozon 属性…</p>';
  try {
    state.colorOptions = null; // clear cached color dict on category change
    state._selectedAspects = null; // reset aspect selection on category change
    state.attributes = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes`);
    $("#le-attr-count").textContent = `(${state.attributes.filter(a=>a.required).length} 必填)`;
    renderAttributes(); identifyVariantAttributes(); autoFillFromAPI().then(() => autoFillDefaults());
  }
  catch (e) { c.innerHTML = `<p class="le-placeholder" style="color:var(--le-danger)">属性加载失败: ${esc(e.message)}</p>`; }
}

function renderAttributes() {
  const c = $("#le-attributes-container");
  if (!state.attributes.length) { c.innerHTML = '<p class="le-placeholder">请先在上方选择类目，属性将自动加载。</p>'; $("#le-attr-count").textContent = ""; return; }
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
}

function attrRowHtml(attr) {
  const dict = attr.dictionary_id && String(attr.dictionary_id).trim();
  const val = state.attrValues[attr.id] || {};
  const rm = attr.required ? '<span class="le-required">*</span>' : "";
  const vb = attr.is_aspect ? ' <small class="le-variant-badge">变体</small>' : "";
  let inp;
  if (dict) { inp = `<div class="le-combobox le-attr-combobox"><input class="le-attr-input" data-dictionary="${esc(attr.dictionary_id)}" data-attr-id="${esc(attr.id)}" data-attr-name="${esc(attr.name)}" placeholder="输入至少2字搜索" value="${esc(val.value_text || "")}" autocomplete="off" /><button type="button" class="le-combobox-arrow le-attr-arrow" data-attr-id="${esc(attr.id)}">&#9660;</button><div class="le-combobox-dropdown le-attr-dropdown" data-attr-id="${esc(attr.id)}" style="display:none"></div></div>`; }
  else { inp = `<input class="le-attr-input" data-attr-id="${esc(attr.id)}" data-attr-name="${esc(attr.name)}" type="text" value="${esc(val.value_text || "")}" placeholder="输入文本" />`; }
  const manualCls = (state.attrValues[attr.id]?.method === "manual") ? " le-attr-manual" : "";
  return `<div class="le-attr-row${manualCls}"><div class="le-attr-label">${esc(attr.name)} ${rm}${vb}</div><div class="le-attr-input-row">${inp}<button class="le-ai-btn" data-attr-id="${esc(attr.id)}" title="AI推荐">AI</button></div></div>`;
}

function setupDictionarySearch(input) {
  const attrId = input.dataset.attrId;
  const dropdown = $(`.le-attr-dropdown[data-attr-id="${attrId}"]`);
  const arrow = $(`.le-attr-arrow[data-attr-id="${attrId}"]`);
  let dropdownOpen = false;

  function toggleDropdown() {
    if (dropdownOpen) { dropdown.style.display = "none"; dropdownOpen = false; return; }
    dropdown.style.display = "block"; dropdownOpen = true;
    if (!dropdown.innerHTML.trim()) searchDictValues("");
  }

  async function searchDictValues(query) {
    if (!state.shopId || !state.categoryId) return;
    if (query.length > 0 && query.length < 2) { dropdown.innerHTML = '<div class="le-combobox-empty">请输入至少2字搜索</div>'; return; }
    dropdown.innerHTML = '<div class="le-combobox-empty"><span class="le-loading"></span> 加载中...</div>';
    try {
      const vals = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attrId}/values?query=${encodeURIComponent(query)}&limit=50`);
      if (!vals.length) { dropdown.innerHTML = '<div class="le-combobox-empty">无匹配选项</div>'; return; }
      dropdown.innerHTML = vals.map(v => `<div class="le-combobox-option" data-value-id="${esc(v.id)}" data-value-text="${esc(v.value)}"><span class="le-cat-zh">${esc(v.value)}</span></div>`).join("");
      dropdown.querySelectorAll(".le-combobox-option").forEach(el => {
        el.addEventListener("click", () => {
          input.value = el.dataset.valueText;
          state.attrValues[attrId] = { value_id: el.dataset.valueId, value_text: el.dataset.valueText };
          dropdown.style.display = "none"; dropdownOpen = false;
        });
      });
    } catch (e) { dropdown.innerHTML = '<div class="le-combobox-empty">搜索失败</div>'; }
  }

  if (arrow) arrow.addEventListener("click", toggleDropdown);
  input.addEventListener("input", () => {
    clearTimeout(state.dictSearchTimers[attrId]);
    const q = input.value.trim();
    state.dictSearchTimers[attrId] = setTimeout(() => searchDictValues(q), 300);
  });
  input.addEventListener("focus", () => { if (!dropdownOpen && !input.value) { toggleDropdown(); } });
  input.addEventListener("blur", () => {
    setTimeout(() => { if (dropdownOpen) { dropdown.style.display = "none"; dropdownOpen = false; } }, 200);
    if (!state.attrValues[attrId]) state.attrValues[attrId] = {};
    state.attrValues[attrId].value_text = input.value;
  });
}


async function autoFillFromAPI() {
  if (!state.shopId || !state.categoryId || !state.typeId) return;
  const offerId = $("#le-offer-id").value || "";
  const spId = state.sourceProduct?.id || null;
  const btn = $("#le-ai-fill-all-attrs");
  if (btn) { btn.classList.add("loading"); btn.disabled = true; btn.textContent = "自动填写中..."; }
  try {
    const r = await api("POST", `/api/v1/shops/${state.shopId}/auto-fill`, {
      category_id: state.categoryId, type_id: state.typeId,
      source_product_id: spId, offer_id: offerId,
    });
    let filled = 0;
    for (const item of r.results) {
      if (item.method === "skip" || item.method === "skip_rich_content") continue;
      const aid = String(item.attribute_id);
      if (item.value_text) {
        state.attrValues[aid] = { value_id: item.value_id, value_text: item.value_text, method: item.method };
        const inp = $(`.le-attr-input[data-attr-id="${aid}"]`);
        if (inp) inp.value = item.value_text;
        filled++;
      } else if (item.method === "manual") {
        state.attrValues[aid] = { value_id: null, value_text: "", method: "manual" };
        const row = $(`.le-attr-input[data-attr-id="${aid}"]`)?.closest(".le-attr-row");
        if (row) row.classList.add("le-attr-manual");
      } else {
        state.attrValues[aid] = { value_id: item.value_id, value_text: item.value_text || "", method: item.method };
      }
    }
    const s = r.stats;
    toast(`自动填写 ${filled} 项 (写死${s.hardcoded||0} 硬匹配${s.hard_match||0} AI匹配${s.ai_match||0})`, "success");
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

function autoFillDefaults() {
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
    if (state.attrValues[aid]?.value_text) continue;
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
  } catch (_) {}
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
        if (r.value) {
          const inp = $(`.le-attr-input[data-attr-id="${attr.id}"]`);
          if (inp) inp.value = r.value;
          state.attrValues[attr.id] = { value_id: r.value_id, value_text: r.value };
          filled++;
        }
      } catch (_) {}
    }
    toast(`材料属性已匹配 ${filled} 项`, "success");
  });
}

async function aiCall(btn, fn) { if (!btn) return; const orig = btn.textContent; btn.classList.add("loading"); btn.disabled = true; try { await fn(); } catch (e) { toast(e.message || "AI 操作失败", "error"); } finally { btn.classList.remove("loading"); btn.disabled = false; btn.textContent = orig; } }
async function aiTranslateTitle(btn) { const t = state.sourceProduct?.title || $("#le-title").value; if (!t) { toast("请先输入或加载标题", "error"); return; } aiCall(btn, async () => { const r = await api("POST", "/api/v1/ai/translate", { text: t, target_lang: "ru", context: titleTranslateContext(state.sourceProduct?.category_hint) }); $("#le-title").value = r.translated; autoMatchCategories(); toast("标题已翻译", "success"); }); }
async function aiGenerateDescription(btn) { const t = state.sourceProduct?.title || $("#le-title").value; if (!t) { toast("缺少商品标题", "error"); return; } aiCall(btn, async () => { const specs = Object.entries(state.attrValues).filter(([,v]) => v.value_text).map(([k,v]) => { const a = state.attributes.find(a => String(a.id) === k); return { name: a?.name || k, value: v.value_text }; }); const r = await api("POST", "/api/v1/ai/generate-description", { product_title: t, source_description: state.sourceProduct?.raw_json || "", specs, target_lang: "ru" }); $("#le-description").value = r.description; toast("描述已生成", "success"); }); }
async function aiTranslateDescription(btn) { const d = $("#le-description").value || state.sourceProduct?.title; if (!d) { toast("缺少描述内容", "error"); return; } aiCall(btn, async () => { const r = await api("POST", "/api/v1/ai/translate", { text: d, target_lang: "ru" }); $("#le-description").value = r.translated; toast("描述已翻译", "success"); }); }
async function aiGenerateRichContent(btn) { const d = $("#le-description").value; const imgs = state.images.slice(0, 5); if (!d && !imgs.length) { toast("请先生成描述或添加图片", "error"); return; } aiCall(btn, async () => { const sn = $("#le-shop-select").selectedOptions[0]?.textContent || ""; const r = await api("POST", "/api/v1/ai/generate-rich-content", { description: d, image_urls: imgs, shop_name: sn }); $("#le-rich-content").value = r.raw_json; state.richContentCompact = r.rich_content; state.richContentAuto = true; toast("富内容已生成", "success"); }); }
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
      toast("已生成30个俄文主题标签", "success");
    });
    return;
  }
  // Rich content attribute -> use dedicated generate-rich-content endpoint
  if (attrName.includes("json") || attrName.includes("富内容") || attrName.includes("rich")) {
    aiCall($(`.le-ai-btn[data-attr-id="${attrId}"]`), async () => {
      const sn = $("#le-shop-select").selectedOptions[0]?.textContent || "";
      const r = await api("POST", "/api/v1/ai/generate-rich-content", {
        description: $("#le-description").value || "", image_urls: state.images.slice(0, 5), shop_name: sn
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
    const inp = $(`.le-attr-input[data-attr-id="${attrId}"]`);
    if (inp) { inp.value = r.value || ""; state.attrValues[attrId] = { value_id: r.value_id, value_text: r.value }; }
    toast(`已推荐: ${r.value || "(空)"}`, "success");
  });
}
async function aiFillAllAttrs(btn) { if (!state.attributes.length) { toast("请先选择类目", "error"); return; } aiCall(btn, async () => { const t = state.sourceProduct?.title || $("#le-title").value || ""; if (!t) { toast("缺少商品标题", "error"); return; } let filled = 0; for (const attr of state.attributes.filter(a => a.required)) { if (state.attrValues[attr.id]?.value_text) continue; const an = (attr.name || "").toLowerCase(); if (an.includes("主题标签") || an.includes("хештег") || attr.name.startsWith("#") || an.includes("json") || an.includes("富内容") || an.includes("rich")) continue; try { let dictOpts = null; if (attr.dictionary_id) { try { dictOpts = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attr.id}/values?query=${encodeURIComponent(t.slice(0,5))}&limit=30`); } catch (_) {} } const r = await api("POST", "/api/v1/ai/suggest-attribute", { attribute_name: attr.name, product_title: t, product_description: $("#le-description").value || "", dictionary_options: dictOpts }); if (r.value) { const inp = $(`.le-attr-input[data-attr-id="${attr.id}"]`); if (inp) inp.value = r.value; state.attrValues[attr.id] = { value_id: r.value_id, value_text: r.value }; filled++; } } catch (_) {} } toast(`已填充 ${filled} 个必填属性`, "success"); }); }

function setupVideoHandlers() {
  const urlInput = $("#le-video-url");
  const player = $("#le-video-player");
  const removeBtn = $("#le-video-remove");
  function updatePlayer() {
    const url = urlInput.value.trim();
    if (url && (url.endsWith(".mp4") || url.endsWith(".webm") || url.includes("video"))) {
      player.innerHTML = `<video src="${esc(url)}" controls style="max-width:100%;max-height:240px;border-radius:6px"></video>`;
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
function autoFillVideoFromSource() {
  if (!state.sourceProduct?.media) return;
  const video = state.sourceProduct.media.find(m => m.media_type === "video");
  if (video && video.url) { $("#le-video-url").value = video.url; $("#le-video-player").innerHTML = `<video src="${esc(video.url)}" controls style="max-width:100%;max-height:240px;border-radius:6px"></video>`; $("#le-video-player").style.display = "block"; }
}

// Central handler: called whenever state.images changes (add/delete/replace/reorder).
// Ensures variant images, color samples, and rich-content JSON all stay in sync.
// Translate selected images via Xiangji (象寄)
async function translateSelectedImages() {
  if (!state.selectedImages.size) { toast("请先点击选择要翻译的图片", "error"); return; }
  const indices = Array.from(state.selectedImages).sort((a, b) => a - b);
  const urls = indices.map(i => state.images[i]).filter(Boolean);
  if (!urls.length) { toast("无有效图片URL", "error"); return; }

  const btn = $("#le-translate-images");
  if (btn) { btn.textContent = "翻译中..."; btn.disabled = true; }
  toast(`正在翻译 ${urls.length} 张图片...`, "");

  try {
    const r = await api("POST", "/api/v1/image/translate-tencent", {
      urls: urls, source_lang: "CHS", target_lang: "ru"
    });
    if (r.translated && r.translated.length) {
      // Replace original images with translated ones
      for (let j = 0; j < indices.length && j < r.translated.length; j++) {
        if (r.translated[j]) {
          state.images[indices[j]] = r.translated[j];
        }
      }
      state.selectedImages.clear();
      // Cache original->translated URL mapping for persistence
      for (let j = 0; j < indices.length && j < r.translated.length; j++) {
        if (r.translated[j] && state.images[indices[j]]) {
          if (!state.translatedImageCache) state.translatedImageCache = {};
          state.translatedImageCache[urls[j]] = r.translated[j];
        }
      }
      // Persist to backend cache
      try {
        const mappings = {};
        for (let j = 0; j < indices.length && j < r.translated.length; j++) {
          if (r.translated[j] && urls[j]) mappings[urls[j]] = r.translated[j];
        }
        if (Object.keys(mappings).length) {
          await api("POST", "/api/v1/image/translation-cache", { mappings });
        }
      } catch (_) {}
      onImagesChanged();
      toast(`已翻译 ${r.translated.length} 张图片`, "success");
    } else {
      toast("翻译返回空结果，请检查API返回", "error");
      console.log("Xiangji response:", r);
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
  // 1. Clean up stale variant image_url references
  if (state.variants && state.variants.length) {
    for (const v of state.variants) {
      if (v.image_url && !state.images.includes(v.image_url)) {
        v.image_url = state.images[0] || "";
      }
    }
  }
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
    const currentImgs = state.images.slice(0, 5).filter(u => u && u.trim());
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

function renderImages() {
  const g = $("#le-image-grid");
  $("#le-image-count").textContent = state.images.length ? `(${state.images.length} 张)` : "";
  g.innerHTML = state.images.map((url, i) => {
    const selected = state.selectedImages.has(i);
    return `<div class="le-image-card ${i === 0 ? "le-image-primary" : ""} ${selected ? "le-image-selected" : ""}" data-index="${i}" onclick="toggleImageSelect(${i})" style="cursor:pointer">
      <img src="${esc(url)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" />
      <button class="le-image-remove" onclick="event.stopPropagation();removeImage(${i})">×</button>
      <button class="le-image-zoom" onclick="event.stopPropagation();zoomImage(${i})" title="放大查看">\uD83D\uDD0D</button>
      ${selected ? '<div class="le-image-selected-badge">\u2713</div>' : ''}
      <div class="le-image-resolution">${i === 0 ? "主图" : ""}</div>
    </div>`;
  }).join("");
  const tBtn = $("#le-translate-images");
  if (tBtn) {
    const cnt = state.selectedImages.size;
    tBtn.textContent = cnt ? `翻译图片 (${cnt})` : "翻译图片";
  }
}

// Lightbox modal for full-size image viewing
window.zoomImage = function(i) {
  const url = state.images[i];
  if (!url) return;
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:2147483647;display:flex;align-items:center;justify-content:center;cursor:zoom-out";
  modal.innerHTML = `<img src="${esc(url)}" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:4px" referrerpolicy="no-referrer" onclick="event.stopPropagation()" /><div style="position:fixed;top:12px;right:16px;color:#fff;font-size:28px;cursor:pointer" onclick="this.parentElement.remove()">\u00d7</div>`;
  modal.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);
};

window.toggleImageSelect = function(i) {
  if (state.selectedImages.has(i)) state.selectedImages.delete(i);
  else state.selectedImages.add(i);
  renderImages();
};
window.removeImage = function(i) { state.images.splice(i, 1); onImagesChanged(); };
function addImage() { const u = $("#le-image-url-input").value.trim(); if (!u) return; if (!u.startsWith("http")) { toast("请输入有效的图片 URL", "error"); return; } state.images.push(u); $("#le-image-url-input").value = ""; onImagesChanged(); }
function importSourceImages() { if (!state.sourceProduct?.media?.length) { toast("没有采集图片可导入", "error"); return; } const urls = state.sourceProduct.media.filter(m => m.media_type === "image").map(m => m.url); const nu = urls.filter(u => !state.images.includes(u)); state.images.push(...nu); onImagesChanged(); toast(`导入了 ${nu.length} 张采集图片`, "success"); }

function identifyVariantAttributes() {
  // List all is_aspect attributes, let user choose which to use as variant dimensions
  const aspectAttrs = state.attributes.filter(a => a.is_aspect);
  const c = $("#le-variant-attrs");

  if (!aspectAttrs.length) {
    state.variantDimensions = [];
    c.innerHTML = '<small class="le-hint">当前类目未识别到变体属性（is_aspect）。可手动添加 SKU 行。</small>';
    $("#le-variant-color-samples").style.display = "none";
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
    aspectAttrs.forEach(a => { if (isColorLike(a)) state._selectedAspects.add(String(a.id)); });
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

function autoPopulateVariantsFromSource() {
  if (!state.sourceProduct || !state.sourceProduct.variants) return;
  const sourceVariants = state.sourceProduct.variants;
  if (!sourceVariants.length) return;
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
    const parts = specName.split(/[‐–—·]/);
    const primaryValue = parts[0] || specName;

    const variantValues = {};
    variantAttrs.forEach((attr, idx) => {
      if (idx === 0) variantValues[attr.name] = primaryValue;
      else if (parts.length > idx) variantValues[attr.name] = parts[idx];
    });

    const suffix = primaryValue.replace(/[^\w\u4e00-\u9fff]/g, "").slice(0, 20) || `v${i+1}`;

    // Cost = source price + 5 (shipping)
    const srcPrice = parseFloat(sv.price_cny) || 0;
    const cost = Math.ceil((srcPrice + 5) * 100) / 100;
    // Basic pricing: cost * 3 (cross-border markup)
    const price = Math.ceil(cost * 3 * 100) / 100;
    // Old price = price * 2
    const oldPrice = Math.ceil(price * 2 * 100) / 100;

    return {
      seller_sku: `${oid}-${suffix}`,
      barcode: "",
      price_cny: String(price),
      old_price_cny: String(oldPrice),
      min_price_cny: String(Math.floor(price) === price ? Math.floor(price) - 1 : Math.floor(price)),
      cost_cny: String(cost),
      stock: "999",
      length_mm: srcLength || "",
      width_mm: srcWidth || "",
      height_mm: srcHeight || "",
      weight_g: srcWeight || "",
      name_ru: "",
      image_url: sv.image_url || "",
      variant_values: variantValues,
      combo: variantValues
    };
  });

  renderVariantTable();
  renderColorSamples();
  toast(`已导入 ${state.variants.length} 个变体（成本+5运费，售价=成本×3，原价=售价×2）`, "success");
  // Match warehouse for each variant based on weight, price, dimensions
  matchVariantWarehouses();
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

function renderColorSamples() {
  const container = $("#le-variant-color-samples");
  if (!container) return;
  const variantAttrs = state.variantDimensions || [];
  const colorAttr = variantAttrs.find(a => {
    const n = (a.name || "").toLowerCase();
    return n.includes("颜色") || n.includes("цвет") || n.includes("color");
  });

  if (!colorAttr) { container.style.display = "none"; return; }

  container.innerHTML = state.variants.map((v, i) => {
    const colorName = v.variant_values?.[colorAttr.name] || "";
    return `<div class="le-color-sample" data-idx="${i}">
      <input type="checkbox" checked data-sample-idx="${i}" />
      <img src="${esc(v.image_url || state.images[0] || "")}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" />
      <small>${esc(colorName)}</small>
    </div>`;
  }).join("");

  $$("#le-variant-color-samples input[data-sample-idx]").forEach(cb => {
    cb.addEventListener("change", () => {
      const idx = parseInt(cb.dataset.sampleIdx);
      const row = $(`#le-variant-rows tr[data-row-idx="${idx}"]`);
      if (row) row.style.opacity = cb.checked ? "1" : "0.4";
    });
  });
}

function renderVariantTable() {
  const tb = $("#le-variant-rows");
  const variantAttrs = state.variantDimensions || [];

  const dimCols = variantAttrs.map(a => {
    const isColorDim = (a.name || "").includes("颜色") || (a.name || "").toLowerCase().includes("цвет");
    const randomLink = (isColorDim && a.dictionary_id)
      ? `<br><a href="javascript:void(0)" onclick="randomColorAssign()" style="font-size:10px;color:#e74c3c;text-decoration:none" title="随机分配1-2个颜色">随机</a>`
      : "";
    return `<th>${esc(a.name)}${randomLink}</th>`;
  }).join("");

  const thead = $("#le-variant-table thead");
  if (thead) {
    const copyLink = (field) => `<a href="javascript:void(0)" onclick="copyFirstRowField('${field}')" style="font-size:10px;color:#999;text-decoration:none;display:block;margin-top:2px" title="复制首行到此列">同首行</a>`;
    thead.innerHTML = `<tr>
      <th style="width:30px"><input type="checkbox" id="le-variant-select-all" /></th>
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

  // Count images per variant (main image + all product images)
  const totalImgs = state.images.length;

  tb.innerHTML = state.variants.map((v, i) => {
    const dimInputs = variantAttrs.map(a => {
      const val = v.variant_values?.[a.name] || "";
      const isColor = (a.name || "").includes("颜色") || (a.name || "").toLowerCase().includes("цвет");
      if (isColor && a.dictionary_id) {
        // Color with dictionary -> multi-select with checkboxes (is_collection=1)
        const selColors = val ? String(val).split(",").map(s => s.trim()).filter(Boolean) : [];
        const displayText = selColors.length ? selColors.join(", ") : "请选择";
        return `<td style="position:relative"><div class="le-color-ms-trigger" data-field="variant_value" data-dim="${esc(a.name)}" data-idx="${i}" onclick="toggleColorMultiSelect(${i}, this)" title="点击选择颜色（可多选）">${esc(displayText)}</div></td>`;
      }
      return `<td><input type="text" value="${esc(val)}" data-field="variant_value" data-dim="${esc(a.name)}" data-idx="${i}" style="width:80px" /></td>`;
    }).join("");

    const skuImg = v.image_url || state.images[0] || "";
    const colorImg = skuImg; // Color sample follows product image
    const imgCount = 1 + totalImgs; // SKU image + product detail images

    return `<tr data-row-idx="${i}">
      <td><input type="checkbox" class="le-variant-row-check" data-idx="${i}" /></td>
      <td><img class="le-variant-thumb le-color-thumb" src="${esc(colorImg)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" data-click="color-sample" data-idx="${i}" title="点击更换" style="cursor:pointer" /></td>
      <td style="position:relative"><img class="le-variant-thumb" src="${esc(skuImg)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" data-click="product-img" data-idx="${i}" title="点击更换" style="cursor:pointer" /><span class="le-img-badge">${imgCount}</span></td>
      ${dimInputs}
      <td style="white-space:nowrap"><input type="text" value="${esc(v.seller_sku)}" data-field="seller_sku" data-idx="${i}" style="width:90px" /><div style="display:flex;gap:2px;margin-top:2px"><button class="le-btn le-btn-sm" onclick="translateSku(${i})" title="翻译后缀为俄文" style="padding:1px 6px;font-size:11px;border:1px solid #4a90d9;color:#4a90d9;background:#f0f7ff">译俄文</button></div></td>
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
    inp.addEventListener("change", () => {
      const idx = parseInt(inp.dataset.idx);
      const field = inp.dataset.field;
      if (field === "variant_value") {
        const dim = inp.dataset.dim;
        if (!state.variants[idx].variant_values) state.variants[idx].variant_values = {};
        state.variants[idx].variant_values[dim] = inp.value;
        renderColorSamples();
      } else {
        state.variants[idx][field] = inp.value;
        // Auto-update old_price when price changes
        if (field === "price_cny" && inp.value) {
          const pVal = parseFloat(inp.value);
          // old_price = price * 2
          const oldP = Math.ceil(pVal * 2 * 100) / 100;
          state.variants[idx].old_price_cny = String(oldP);
          const oldInp = $(`#le-variant-rows input[data-field="old_price_cny"][data-idx="${idx}"]`);
          if (oldInp) oldInp.value = oldP;
          // min_price = floor(price), if integer then -1
          const minP = Math.floor(pVal) === pVal ? Math.floor(pVal) - 1 : Math.floor(pVal);
          state.variants[idx].min_price_cny = String(minP);
          const minInp = $(`#le-variant-rows input[data-field="min_price_cny"][data-idx="${idx}"]`);
          if (minInp) minInp.value = minP;
        }
      }
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

}

// Open image gallery for variant image selection
function openImageGallery(variantIdx, imgType) {
  const imgs = state.images;
  if (!imgs.length) { toast("没有可选择的图片", "error"); return; }
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center";
  modal.innerHTML = `<div style="background:#fff;border-radius:8px;padding:16px;max-width:600px;max-height:80vh;overflow-y:auto"><h4 style="margin:0 0 12px">选择图片</h4><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${imgs.map((url, i) => `<img src="${esc(url)}" data-img-idx="${i}" style="width:120px;height:120px;object-fit:cover;border-radius:4px;cursor:pointer;border:2px solid transparent" referrerpolicy="no-referrer" />`).join("")}</div><button onclick="this.closest('div[style*=fixed]').remove()" style="margin-top:12px">取消</button></div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll("img[data-img-idx]").forEach(im => {
    im.addEventListener("click", () => {
      const url = imgs[parseInt(im.dataset.imgIdx)];
      if (imgType === "color-sample") {
        // Color sample follows product image
        state.variants[variantIdx].image_url = url;
      } else {
        // Product image = variant image
        state.variants[variantIdx].image_url = url;
      }
      renderVariantTable();
      renderColorSamples();
      modal.remove();
    });
  });
}

// Cache color dictionary options for reuse (random assign, etc.)
state.colorOptions = null;
async function ensureColorOptions(attr) {
  if (state.colorOptions) return state.colorOptions;
  try {
    const vals = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attr.id}/values?query=&limit=50`);
    state.colorOptions = vals || [];
  } catch (_) { state.colorOptions = []; }
  return state.colorOptions;
}

// Toggle multi-select color dropdown panel
window.toggleColorMultiSelect = async function(idx, triggerEl) {
  // Close any existing panel
  const existing = document.querySelector(".le-color-ms-panel");
  if (existing) { existing.remove(); return; }

  const variantAttrs = state.variantDimensions || [];
  const dimName = triggerEl.dataset.dim;
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
      <button class="le-color-ms-ok" style="font-size:11px;color:#fff;background:#4a90d9;border:none;border-radius:4px;padding:2px 10px;cursor:pointer">确定</button>
    </div>
  `;
  // Position panel below trigger
  const rect = triggerEl.getBoundingClientRect();
  panel.style.cssText = `position:fixed;top:${rect.bottom + 2}px;left:${rect.left}px;z-index:10000;background:#fff;border:1px solid #d1d5db;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);padding:8px;max-height:300px;display:flex;flex-direction:column;min-width:180px`;
  document.body.appendChild(panel);

  // Search filter
  const searchInput = panel.querySelector(".le-color-ms-search input");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase();
    panel.querySelectorAll(".le-color-ms-option").forEach(label => {
      const text = label.querySelector("span").textContent.toLowerCase();
      label.style.display = text.includes(q) ? "" : "none";
    });
  });

  // Clear button
  panel.querySelector(".le-color-ms-clear").addEventListener("click", () => {
    panel.querySelectorAll(".le-color-ms-option input").forEach(cb => cb.checked = false);
  });

  // OK button - collect checked values
  panel.querySelector(".le-color-ms-ok").addEventListener("click", () => {
    const checked = Array.from(panel.querySelectorAll(".le-color-ms-option input:checked"));
    const values = checked.map(cb => cb.value);
    if (!v.variant_values) v.variant_values = {};
    v.variant_values[dimName] = values.join(", ");
    // Also store value_ids for later submission
    if (!v.variant_value_ids) v.variant_value_ids = {};
    v.variant_value_ids[dimName] = checked.map(cb => cb.dataset.valueId);
    panel.remove();
    renderVariantTable();
    renderColorSamples();
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
};

// Random color assignment - pick 1-2 colors per variant
window.randomColorAssign = async function() {
  const variantAttrs = state.variantDimensions || [];
  const colorAttr = variantAttrs.find(a => {
    const n = a.name || "";
    return n.includes("颜色") || n.toLowerCase().includes("цвет");
  });
  if (!colorAttr || !colorAttr.dictionary_id) { toast("当前类目无颜色属性", "error"); return; }

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
      v.seller_sku = `${prefix}-${r.translated.replace(/\s+/g, "_")}`;
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
    v.seller_sku = `${prefix}-${translated}`;
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
    }
  }
  renderVariantTable();
  renderColorSamples();
  toast("已复制首行到此列", "success");
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
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="sku-gen-variant" checked /> 使用变体名称作为后缀（如 ${esc(oid)}-绿色）
      </label>
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
    const useVariant = document.getElementById("sku-gen-variant").checked;
    const translate = document.getElementById("sku-gen-translate").checked;
    const numeric = document.getElementById("sku-gen-numeric").checked;
    const variantAttrs = state.variantDimensions || [];
    for (let i = 0; i < state.variants.length; i++) {
      let suffix = "";
      if (numeric) {
        suffix = String(i + 1).padStart(2, "0");
      } else if (useVariant && variantAttrs.length) {
        suffix = variantAttrs.map(a => state.variants[i].variant_values?.[a.name] || "").filter(Boolean).join("-").slice(0, 30) || String(i + 1);
      } else {
        suffix = String(i + 1);
      }
      state.variants[i].seller_sku = prefix + "-" + suffix;
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
  }
  renderVariantTable();
  renderColorSamples();
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

async function loadSourceProductsList() { try { const ps = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products`); $("#le-source-select").innerHTML = '<option value="">选择采集商品...</option>' + ps.map(p => `<option value="${p.id}">[${p.source_platform}] ${esc(p.title)}</option>`).join(""); } catch (_) {} }
async function loadSourceProductDetail(spId) {
  if (!spId) { state.sourceProduct = null; renderSourcePanel(); return; }
  try {
    state.sourceProduct = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products/${spId}`);
    renderSourcePanel();
    if (state.sourceProduct.source_url && !$("#le-source-url").value) $("#le-source-url").value = state.sourceProduct.source_url || "";
    // Auto-import source images (no need to click import button)
    if (state.sourceProduct.media?.length) {
      const imgUrls = state.sourceProduct.media.filter(m => m.media_type === "image").map(m => m.url);
      const newUrls = imgUrls.filter(u => !state.images.includes(u));
      // Apply cached translations if available (from backend cache loaded on init)
      const finalUrls = newUrls.map(u => state.translatedImageCache?.[u] || u);
      state.images.push(...finalUrls);
      onImagesChanged();
      // Also check backend for any new translations not yet in local state
      if (newUrls.length) {
        try {
          const tc = await api("GET", `/api/v1/image/translation-cache/apply?urls=${encodeURIComponent(newUrls.join(","))}`);
          if (tc.translations && Object.keys(tc.translations).length) {
            let replaced = false;
            for (const [origUrl, transUrl] of Object.entries(tc.translations)) {
              const idx = state.images.indexOf(origUrl);
              if (idx >= 0) { state.images[idx] = transUrl; replaced = true; }
            }
            if (replaced) { onImagesChanged(); }
          }
        } catch (_) {}
      }
    }
    // Auto-fill video from source
    autoFillVideoFromSource();
    if (state.sourceProduct.variants?.length) { state.variants = []; identifyVariantAttributes(); }
    // Auto-generate Russian title translation + description via AI (no button click needed)
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
      // Generate description from cleaned title + source data
      try {
        const dr = await api("POST", "/api/v1/ai/generate-description", {
          title: cleanTitle,
          source_description: state.sourceProduct?.raw_json?.source_description || "",
          attributes: state.sourceProduct?.raw_json?.attributes || []
        });
        $("#le-description").value = dr.description || "";
      } catch (_) {}
      // Auto-generate hashtags after title + description are ready
      autoGenerateHashtags();
    }
  } catch (e) { toast("加载采集商品失败: " + e.message, "error"); }
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

function renderSourcePanel() { const c = $("#le-source-content"); if (!state.sourceProduct) { c.innerHTML = '<p class="le-placeholder">选择采集商品后，此处展示货源信息。</p>'; return; } const sp = state.sourceProduct; const imgs = (sp.media || []).filter(m => m.media_type === "image"); c.innerHTML = `<div class="le-source-info"><h4>标题</h4><strong>${esc(sp.title)}</strong>${sp.brand ? `<h4>品牌</h4>${esc(sp.brand)}` : ""}${sp.material ? `<h4>材质</h4>${esc(sp.material)}` : ""}${sp.category_hint ? `<h4>类目提示</h4>${esc(sp.category_hint)}` : ""}</div>${sp.variants?.length ? `<div class="le-source-info"><h4>变体 (${sp.variants.length})</h4>${sp.variants.map(v => `<div>${esc(v.spec_name)} - ¥${v.price_cny || "?"} (库存${v.stock})</div>`).join("")}</div>` : ""}${imgs.length ? `<h4>图片 (${imgs.length})</h4><div class="le-source-images">${imgs.slice(0, 9).map(m => `<img src="${esc(m.url)}" loading="lazy" referrerpolicy="no-referrer" />`).join("")}</div>` : ""}`; }

function collectAttributePayload() { const payload = []; $$(".le-attr-input[data-attr-id]").forEach(inp => { const aid = inp.dataset.attrId; const v = inp.value.trim(); if (!v) return; const a = state.attributes.find(a => String(a.id) === aid); const vid = state.attrValues[aid]?.value_id || null; payload.push({ attribute_id: aid, name: a?.name || inp.dataset.attrName || "", value_id: vid, value_text: v }); }); return payload; }
function collectVariantPayload() { return state.variants.map(v => ({ seller_sku: v.seller_sku, purchase_cost_cny: v.cost_cny ? parseFloat(v.cost_cny) : null, weight_g: v.weight_g ? parseFloat(v.weight_g) : null, length_mm: v.length_mm ? parseFloat(v.length_mm) : null, width_mm: v.width_mm ? parseFloat(v.width_mm) : null, height_mm: v.height_mm ? parseFloat(v.height_mm) : null, barcode: v.barcode || null, stock: v.stock ? parseInt(v.stock) : null, name_ru: v.name_ru || null, image_url: v.image_url || null, price_cny: v.price_cny ? parseFloat(v.price_cny) : null, min_price_cny: v.min_price_cny ? String(v.min_price_cny) : null, variant_values_json: v.variant_values ? JSON.stringify(v.variant_values) : null })); }

async function precheckDraft() {
  if (!state.shopId) { toast("请先选择店铺", "error"); return; }
  if (!state.draftId) {
    // Auto-save first if no draft exists
    await saveDraft();
    if (!state.draftId) { toast("请先保存草稿", "error"); return; }
  }
  const btn = $("#le-precheck-btn");
  if (btn) { btn.textContent = "预检中..."; btn.disabled = true; }
  try {
    const r = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/validate`);
    if (r.issues && r.issues.length) {
      const msgs = r.issues.map(i => "- " + i.message).join("\n");
      alert("预检发现 " + r.issues.length + " 个问题:\n\n" + msgs);
    } else {
      alert("预检通过，可以提交上架。");
    }
  } catch (e) {
    toast("预检失败: " + e.message, "error");
  } finally {
    if (btn) { btn.textContent = "预检"; btn.disabled = false; }
  }
}

async function saveDraft() {
  if (!state.shopId) { toast("请先选择店铺", "error"); return; }
  const oid = $("#le-offer-id").value.trim(); const t = $("#le-title").value.trim();
  if (!oid || !t) { toast("Offer ID 和标题为必填项", "error"); return; }
  // Auto-generate rich content if empty
  const richEl = $("#le-rich-content");
  if (richEl && !richEl.value.trim()) {
    try {
      const sn = $("#le-shop-select").selectedOptions[0]?.textContent || "";
      const r = await api("POST", "/api/v1/ai/generate-rich-content", {
        description: $("#le-description").value || "", image_urls: state.images.slice(0, 5), shop_name: sn
      });
      richEl.value = r.raw_json; state.richContentCompact = r.rich_content; state.richContentAuto = true;
    } catch (_) { /* proceed without rich content */ }
  }
  // Include rich content in attributes payload
  const attrs = collectAttributePayload();
  const richAttr = state.attributes.find(a => (a.name || "").includes("JSON") || (a.name || "").includes("富内容"));
  if (richAttr) {
    const richVal = state.richContentCompact || richEl?.value?.trim() || "";
    if (richVal) {
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
  const payload = { offer_id: oid, title: t, description: $("#le-description").value || null, category_id: state.categoryId || null, type_id: state.typeId || null, primary_image_url: state.images[0] || null, images: state.images, source_product_id: state.sourceProduct?.id || null, attributes: attrs, variants: collectVariantPayload().length ? collectVariantPayload() : [{ seller_sku: oid, purchase_cost_cny: null, weight_g: null, length_mm: null, width_mm: null, height_mm: null }] };
  try { if (state.draftId) await api("PUT", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}`, payload); else { const d = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts`, payload); state.draftId = d.id; } toast("草稿已保存", "success"); } catch (e) { toast("保存失败: " + e.message, "error"); }
}

async function submitDraft() {
  if (!state.shopId) { toast("请先选择店铺", "error"); return; }
  // Save first
  await saveDraft();
  if (!state.draftId) { toast("保存失败，无法提交", "error"); return; }
  const btn = $("#le-submit-btn");
  if (btn) { btn.textContent = "提交中..."; btn.disabled = true; }
  try {
    const r = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/submit`);
    toast(r.message || "提交成功", "success");
  } catch (e) {
    toast("提交失败: " + e.message, "error");
  } finally {
    if (btn) { btn.textContent = "保存并提交"; btn.disabled = false; }
  }
}

async function loadDraft(draftId) {
  try {
    const d = await api("GET", `/api/v1/shops/${state.shopId}/listing-drafts/${draftId}`);
    state.draftId = d.id;
    $("#le-offer-id").value = d.offer_id || "";
    $("#le-title").value = d.title || "";
    $("#le-description").value = d.description || "";
    state.categoryId = d.category_id || null;
    state.typeId = d.type_id || null;
    // Load images
    if (d.images && d.images.length) {
      state.images = d.images;
    }
    // Load attributes
    if (d.attribute_values) {
      for (const av of d.attribute_values) {
        state.attrValues[String(av.attribute_id)] = { value_id: av.value_id, value_text: av.value_text };
      }
    }
    // Reload category attributes if category is set
    if (state.categoryId && state.typeId) {
      await loadAttributes();
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
        price_cny: v.price_cny?.toString() || "", old_price_cny: v.old_price_cny?.toString() || "",
        min_price_cny: v.min_price_cny || "", variant_values: v.variant_values_json ? JSON.parse(v.variant_values_json) : null
      }));
    }
    renderAttributes();
    renderImages();
    renderVariantTable();
    onImagesChanged();
    toast("草稿已加载", "success");
  } catch (e) {
    toast("加载草稿失败: " + e.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Load translated image cache from backend
  try {
    const tc = await api("GET", "/api/v1/image/translation-cache");
    state.translatedImageCache = tc.cache || {};
  } catch (_) { state.translatedImageCache = {}; }
  setupVideoHandlers();
  loadShops();
  $("#le-shop-select").addEventListener("change", onShopChange);
  $("#le-category-search").addEventListener("input", (e) => { clearTimeout(state.categorySearchTimer); state.categorySearchTimer = setTimeout(() => searchCategories(e.target.value.trim()), 300); });
  $("#le-category-dropdown-btn").addEventListener("click", toggleCategoryDropdown);
  $("#le-tree-browser-btn").addEventListener("click", openTreeBrowser);
  $("#le-tree-close").addEventListener("click", closeTreeBrowser);
  $("#le-tree-modal").addEventListener("click", (e) => { if (e.target.id === "le-tree-modal") closeTreeBrowser(); });
  document.addEventListener("click", (e) => { if (categoryDropdownOpen && !e.target.closest(".le-combobox")) { $("#le-category-dropdown").style.display = "none"; categoryDropdownOpen = false; } });
  $("#le-show-optional").addEventListener("change", renderAttributes);
  $$("[data-ai-action]").forEach(btn => btn.addEventListener("click", () => { const a = btn.dataset.aiAction; if (a === "translate-title") aiTranslateTitle(btn); else if (a === "generate-description") aiGenerateDescription(btn); else if (a === "translate-description") aiTranslateDescription(btn); else if (a === "generate-rich-content") aiGenerateRichContent(btn);
      else if (a === "generate-hashtags") aiGenerateHashtags(btn);
      else if (a === "match-materials") aiMatchMaterials(btn); }));
  $("#le-ai-fill-all-attrs").addEventListener("click", () => autoFillFromAPI());
  $("#le-add-image").addEventListener("click", addImage);
  $("#le-image-url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addImage(); } });
  $("#le-import-source-images").addEventListener("click", importSourceImages);
  $("#le-translate-images").addEventListener("click", translateSelectedImages);
  $("#le-add-variant-row").addEventListener("click", addVariantRow);
  $("#le-source-select").addEventListener("change", (e) => loadSourceProductDetail(e.target.value));
  $("#le-save-btn").addEventListener("click", saveDraft);
  $("#le-precheck-btn").addEventListener("click", precheckDraft);
  $("#le-submit-btn").addEventListener("click", submitDraft);
  $$(".le-section-title").forEach(t => t.addEventListener("click", () => t.parentElement.classList.toggle("le-section-collapsed")));

  // Parse URL params for shop, source product, and draft
  const params = new URLSearchParams(window.location.search);
  const urlShop = params.get("shop");
  const urlSp = params.get("sp");
  const urlDraft = params.get("draft");
  if (urlShop) {
    // Wait for shops to load, then select
    setTimeout(async () => {
      const select = $("#le-shop-select");
      if (select.options.length > 1) {
        select.value = urlShop;
        await onShopChange();
        if (urlSp) {
          // Load source product
          await loadSourceProductDetail(urlSp);
        }
        if (urlDraft) {
          // Load existing draft
          await loadDraft(urlDraft);
        }
      }
    }, 500);
  }
});

