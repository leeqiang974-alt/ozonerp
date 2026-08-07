/* v4 - combobox + tree browser with search + match history */
"use strict";
const API_BASE = window.ERP_API_BASE || "http://127.0.0.1:8000";
const state = { shopId: null, categoryId: null, typeId: null, attributes: [], attrValues: {}, images: [], variants: [], sourceProduct: null, draftId: null, categorySearchTimer: null, dictSearchTimers: {}, richContentCompact: null };
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
  const title = state.sourceProduct?.title || $("#le-title").value;
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
    state.attributes = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes`);
    $("#le-attr-count").textContent = `(${state.attributes.filter(a=>a.required).length} 必填)`;
    renderAttributes(); identifyVariantAttributes(); autoFillFromAPI();
  }
  catch (e) { c.innerHTML = `<p class="le-placeholder" style="color:var(--le-danger)">属性加载失败: ${esc(e.message)}</p>`; }
}

function renderAttributes() {
  const c = $("#le-attributes-container");
  if (!state.attributes.length) { c.innerHTML = '<p class="le-placeholder">请先在上方选择类目，属性将自动加载。</p>'; $("#le-attr-count").textContent = ""; return; }
  const showOpt = $("#le-show-optional").checked;
  const skipIds = ["100001", "100002"];
  const skipKw = ["视频", "видео", "Видео", "PDF", "pdf", "组合成类似", "объединить в похожие"];
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

function autoFillDefaults() {
  // Auto-fill known default values for common attributes
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
    // Quantity per pack -> use source product variant count
    else if (name.includes("原厂包装数量") || name.includes("统一计量单位中的商品数量") || name.includes("一件商品中的件数")) {
      const qty = state.sourceProduct?.variants?.length || 1;
      state.attrValues[aid] = { value_id: null, value_text: String(qty) };
      const inp = $(`.le-attr-input[data-attr-id="${aid}"]`); if (inp) inp.value = String(qty);
    }
  }
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
async function aiTranslateTitle(btn) { const t = state.sourceProduct?.title || $("#le-title").value; if (!t) { toast("请先输入或加载标题", "error"); return; } aiCall(btn, async () => { const r = await api("POST", "/api/v1/ai/translate", { text: t, target_lang: "ru", context: state.sourceProduct?.category_hint || "" }); $("#le-title").value = r.translated; autoMatchCategories(); toast("标题已翻译", "success"); }); }
async function aiGenerateDescription(btn) { const t = state.sourceProduct?.title || $("#le-title").value; if (!t) { toast("缺少商品标题", "error"); return; } aiCall(btn, async () => { const specs = Object.entries(state.attrValues).filter(([,v]) => v.value_text).map(([k,v]) => { const a = state.attributes.find(a => String(a.id) === k); return { name: a?.name || k, value: v.value_text }; }); const r = await api("POST", "/api/v1/ai/generate-description", { product_title: t, source_description: state.sourceProduct?.raw_json || "", specs, target_lang: "ru" }); $("#le-description").value = r.description; toast("描述已生成", "success"); }); }
async function aiTranslateDescription(btn) { const d = $("#le-description").value || state.sourceProduct?.title; if (!d) { toast("缺少描述内容", "error"); return; } aiCall(btn, async () => { const r = await api("POST", "/api/v1/ai/translate", { text: d, target_lang: "ru" }); $("#le-description").value = r.translated; toast("描述已翻译", "success"); }); }
async function aiGenerateRichContent(btn) { const d = $("#le-description").value; const imgs = state.images.slice(0, 5); if (!d && !imgs.length) { toast("请先生成描述或添加图片", "error"); return; } aiCall(btn, async () => { const sn = $("#le-shop-select").selectedOptions[0]?.textContent || ""; const r = await api("POST", "/api/v1/ai/generate-rich-content", { description: d, image_urls: imgs, shop_name: sn }); $("#le-rich-content").value = r.raw_json; state.richContentCompact = r.rich_content; toast("富内容已生成", "success"); }); }
async function aiSuggestAttribute(attrId) { if (!state.shopId) { toast("请先选择店铺", "error"); return; } const attr = state.attributes.find(a => String(a.id) === String(attrId)); if (!attr) return; const t = state.sourceProduct?.title || $("#le-title").value || ""; if (!t) { toast("缺少商品标题", "error"); return; } aiCall($(`.le-ai-btn[data-attr-id="${attrId}"]`), async () => { let dictOpts = null; if (attr.dictionary_id) { try { dictOpts = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attrId}/values?query=${encodeURIComponent(t.slice(0,5))}&limit=30`); } catch (_) {} } const r = await api("POST", "/api/v1/ai/suggest-attribute", { attribute_name: attr.name, attribute_description: "", product_title: t, product_description: $("#le-description").value || "", dictionary_options: dictOpts }); const inp = $(`.le-attr-input[data-attr-id="${attrId}"]`); if (inp) { inp.value = r.value || ""; state.attrValues[attrId] = { value_id: r.value_id, value_text: r.value }; } toast(`已推荐: ${r.value || "(空)"}`, "success"); }); }
async function aiFillAllAttrs(btn) { if (!state.attributes.length) { toast("请先选择类目", "error"); return; } aiCall(btn, async () => { const t = state.sourceProduct?.title || $("#le-title").value || ""; if (!t) { toast("缺少商品标题", "error"); return; } let filled = 0; for (const attr of state.attributes.filter(a => a.required)) { if (state.attrValues[attr.id]?.value_text) continue; try { let dictOpts = null; if (attr.dictionary_id) { try { dictOpts = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attr.id}/values?query=${encodeURIComponent(t.slice(0,5))}&limit=30`); } catch (_) {} } const r = await api("POST", "/api/v1/ai/suggest-attribute", { attribute_name: attr.name, product_title: t, product_description: $("#le-description").value || "", dictionary_options: dictOpts }); if (r.value) { const inp = $(`.le-attr-input[data-attr-id="${attr.id}"]`); if (inp) inp.value = r.value; state.attrValues[attr.id] = { value_id: r.value_id, value_text: r.value }; filled++; } } catch (_) {} } toast(`已填充 ${filled} 个必填属性`, "success"); }); }

function renderImages() { const g = $("#le-image-grid"); $("#le-image-count").textContent = state.images.length ? `(${state.images.length} 张)` : ""; g.innerHTML = state.images.map((url, i) => `<div class="le-image-card ${i === 0 ? "le-image-primary" : ""}" data-index="${i}"><img src="${esc(url)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" /><button class="le-image-remove" onclick="removeImage(${i})">×</button><div class="le-image-resolution">${i === 0 ? "主图" : ""}</div></div>`).join(""); }
window.removeImage = function(i) { state.images.splice(i, 1); renderImages(); };
function addImage() { const u = $("#le-image-url-input").value.trim(); if (!u) return; if (!u.startsWith("http")) { toast("请输入有效的图片 URL", "error"); return; } state.images.push(u); $("#le-image-url-input").value = ""; renderImages(); }
function importSourceImages() { if (!state.sourceProduct?.media?.length) { toast("没有采集图片可导入", "error"); return; } const urls = state.sourceProduct.media.filter(m => m.media_type === "image").map(m => m.url); const nu = urls.filter(u => !state.images.includes(u)); state.images.push(...nu); renderImages(); toast(`导入了 ${nu.length} 张采集图片`, "success"); }

function identifyVariantAttributes() {
  const vn = ["цвет","color","размер","size","пол","цвета","颜色","尺寸"];
  const ka = state.attributes.filter(a => { if (a.is_aspect) return true; const c = String(a.complex_id || "0"); if (c !== "0" && c !== "") return true; const n = (a.name || "").toLowerCase(); return vn.some(v => n.includes(v)); });
  const c = $("#le-variant-attrs");
  if (!ka.length) { c.innerHTML = '<small class="le-hint">当前类目未识别到变体属性，可手动添加 SKU 行。</small>'; return; }
  c.innerHTML = '<small class="le-hint" style="margin-bottom:6px">以下属性可创建变体，输入值后用逗号分隔（如：红色,蓝色,黑色）</small>' + ka.map(a => `<div class="le-variant-attr-row"><label>${esc(a.name)} ${a.is_aspect ? '<small style="color:var(--le-ai)">[变体]</small>' : ""}:</label><input type="text" data-variant-attr="${esc(a.id)}" placeholder="变体值，逗号分隔" /></div>`).join("");
  $$("[data-variant-attr]").forEach(i => i.addEventListener("change", generateVariantRows));
}

function generateVariantRows() {
  const ai = $$("[data-variant-attr]"); if (!ai.length) return;
  const avs = [];
  ai.forEach(i => { const vs = i.value.split(",").map(v => v.trim()).filter(Boolean); if (vs.length) avs.push({ attrId: i.dataset.variantAttr, attrName: i.previousElementSibling?.textContent || "", values: vs }); });
  if (!avs.length) return;
  let combos = [{}];
  for (const av of avs) { const nc = []; for (const c of combos) for (const v of av.values) nc.push({ ...c, [av.attrName]: v }); combos = nc; }
  const oid = $("#le-offer-id").value || "SKU";
  state.variants = combos.map((combo, i) => { const sfx = Object.values(combo).join("-"); const ex = state.variants[i]; return { seller_sku: `${oid}-${sfx}`, barcode: "", price_cny: ex?.price_cny || "", old_price_cny: ex?.old_price_cny || "", cost_cny: ex?.cost_cny || "", stock: ex?.stock || "1000", length_mm: ex?.length_mm || "", width_mm: ex?.width_mm || "", height_mm: ex?.height_mm || "", weight_g: ex?.weight_g || "", name_ru: ex?.name_ru || Object.values(combo).join(" "), image_url: "", combo }; });
  renderVariantTable();
}

function renderVariantTable() {
  const tb = $("#le-variant-rows");
  tb.innerHTML = state.variants.map((v, i) => `<tr><td><img class="le-variant-thumb" src="${esc(v.image_url || state.images[0] || "")}" onerror="this.style.display='none'" /></td><td><input type="text" value="${esc(v.seller_sku)}" data-field="seller_sku" data-idx="${i}" /></td><td><input type="text" value="${esc(v.barcode)}" data-field="barcode" data-idx="${i}" /></td><td><input type="number" step="0.01" value="${esc(v.price_cny)}" data-field="price_cny" data-idx="${i}" placeholder="自动" /></td><td><input type="number" step="0.01" value="${esc(v.old_price_cny)}" data-field="old_price_cny" data-idx="${i}" /></td><td><input type="number" step="0.01" value="${esc(v.cost_cny)}" data-field="cost_cny" data-idx="${i}" /></td><td><input type="number" value="${esc(v.stock)}" data-field="stock" data-idx="${i}" /></td><td style="display:flex;gap:2px"><input type="number" value="${esc(v.length_mm)}" data-field="length_mm" data-idx="${i}" style="width:50px" /><input type="number" value="${esc(v.width_mm)}" data-field="width_mm" data-idx="${i}" style="width:50px" /><input type="number" value="${esc(v.height_mm)}" data-field="height_mm" data-idx="${i}" style="width:50px" /></td><td><input type="number" step="0.01" value="${esc(v.weight_g)}" data-field="weight_g" data-idx="${i}" /></td><td><input type="text" value="${esc(v.name_ru)}" data-field="name_ru" data-idx="${i}" /></td><td><button class="le-variant-del" onclick="removeVariant(${i})">×</button></td></tr>`).join("");
  $$("#le-variant-rows input[data-field]").forEach(inp => inp.addEventListener("change", () => { state.variants[parseInt(inp.dataset.idx)][inp.dataset.field] = inp.value; }));
}
window.removeVariant = function(i) { state.variants.splice(i, 1); renderVariantTable(); };
function addVariantRow() { state.variants.push({ seller_sku: `${$("#le-offer-id").value || "SKU"}-${state.variants.length + 1}`, barcode: "", price_cny: "", old_price_cny: "", cost_cny: "", stock: "1000", length_mm: "", width_mm: "", height_mm: "", weight_g: "", name_ru: "", image_url: "", combo: {} }); renderVariantTable(); }

async function loadSourceProductsList() { try { const ps = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products`); $("#le-source-select").innerHTML = '<option value="">选择采集商品...</option>' + ps.map(p => `<option value="${p.id}">[${p.source_platform}] ${esc(p.title)}</option>`).join(""); } catch (_) {} }
async function loadSourceProductDetail(spId) { if (!spId) { state.sourceProduct = null; renderSourcePanel(); return; } try { state.sourceProduct = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products/${spId}`); renderSourcePanel(); if (state.sourceProduct.title && !$("#le-title").value) $("#le-title").value = state.sourceProduct.title; autoMatchCategories(); if (state.sourceProduct.source_url && !$("#le-source-url").value) $("#le-source-url").value = state.sourceProduct.source_url || ""; } catch (e) { toast("加载采集商品失败: " + e.message, "error"); } }
function renderSourcePanel() { const c = $("#le-source-content"); if (!state.sourceProduct) { c.innerHTML = '<p class="le-placeholder">选择采集商品后，此处展示货源信息。</p>'; return; } const sp = state.sourceProduct; const imgs = (sp.media || []).filter(m => m.media_type === "image"); c.innerHTML = `<div class="le-source-info"><h4>标题</h4><strong>${esc(sp.title)}</strong>${sp.brand ? `<h4>品牌</h4>${esc(sp.brand)}` : ""}${sp.material ? `<h4>材质</h4>${esc(sp.material)}` : ""}${sp.category_hint ? `<h4>类目提示</h4>${esc(sp.category_hint)}` : ""}</div>${sp.variants?.length ? `<div class="le-source-info"><h4>变体 (${sp.variants.length})</h4>${sp.variants.map(v => `<div>${esc(v.spec_name)} - ¥${v.price_cny || "?"} (库存${v.stock})</div>`).join("")}</div>` : ""}${imgs.length ? `<h4>图片 (${imgs.length})</h4><div class="le-source-images">${imgs.slice(0, 9).map(m => `<img src="${esc(m.url)}" loading="lazy" referrerpolicy="no-referrer" />`).join("")}</div>` : ""}`; }

function collectAttributePayload() { const payload = []; $$(".le-attr-input[data-attr-id]").forEach(inp => { const aid = inp.dataset.attrId; const v = inp.value.trim(); if (!v) return; const a = state.attributes.find(a => String(a.id) === aid); const vid = state.attrValues[aid]?.value_id || null; payload.push({ attribute_id: aid, name: a?.name || inp.dataset.attrName || "", value_id: vid, value_text: v }); }); return payload; }
function collectVariantPayload() { return state.variants.map(v => ({ seller_sku: v.seller_sku, purchase_cost_cny: v.cost_cny ? parseFloat(v.cost_cny) : null, weight_g: v.weight_g ? parseFloat(v.weight_g) : null, length_mm: v.length_mm ? parseFloat(v.length_mm) : null, width_mm: v.width_mm ? parseFloat(v.width_mm) : null, height_mm: v.height_mm ? parseFloat(v.height_mm) : null })); }

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
      richEl.value = r.raw_json; state.richContentCompact = r.rich_content;
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
  }
  const payload = { offer_id: oid, title: t, description: $("#le-description").value || null, category_id: state.categoryId || null, type_id: state.typeId || null, primary_image_url: state.images[0] || null, attributes: attrs, variants: collectVariantPayload().length ? collectVariantPayload() : [{ seller_sku: oid, purchase_cost_cny: null, weight_g: null, length_mm: null, width_mm: null, height_mm: null }] };
  try { if (state.draftId) await api("PUT", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}`, payload); else { const d = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts`, payload); state.draftId = d.id; } toast("草稿已保存", "success"); } catch (e) { toast("保存失败: " + e.message, "error"); }
}

async function validateDraft() {
  if (!state.draftId) { await saveDraft(); if (!state.draftId) return; }
  try { const r = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/validate`); if (!r.issues.length) toast("预检通过！可进入审批发布。", "success"); else { toast(`预检发现 ${r.issues.length} 个问题`, "error"); console.log("Validation issues:", r.issues); } } catch (e) { toast("预检失败: " + e.message, "error"); }
}

document.addEventListener("DOMContentLoaded", () => {
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
  $("#le-add-variant-row").addEventListener("click", addVariantRow);
  $("#le-source-select").addEventListener("change", (e) => loadSourceProductDetail(e.target.value));
  $("#le-save-btn").addEventListener("click", saveDraft);
  $("#le-validate-btn").addEventListener("click", validateDraft);
  $$(".le-section-title").forEach(t => t.addEventListener("click", () => t.parentElement.classList.toggle("le-section-collapsed")));
});
