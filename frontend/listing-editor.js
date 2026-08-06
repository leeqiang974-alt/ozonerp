/* v2 - centered layout + auto category match */
/* v2 - centered layout + auto category match */
"use strict";

const API_BASE = window.ERP_API_BASE || "http://127.0.0.1:8000";

// ─── State ──────────────────────────────────────────────────────────────
const state = {
  shopId: null,
  categoryId: null,
  typeId: null,
  attributes: [],
  attrValues: {},
  images: [],
  variants: [],
  sourceProduct: null,
  draftId: null,
  categorySearchTimer: null,
  dictSearchTimers: {},
};

// ─── Helpers ────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, type = "") {
  const el = $("#le-toast");
  el.textContent = msg;
  el.className = "show " + type;
  setTimeout(() => (el.className = ""), 3000);
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Shop loading ───────────────────────────────────────────────────────
async function loadShops() {
  const shops = await api("GET", "/api/v1/shops");
  const sel = $("#le-shop-select");
  sel.innerHTML = '<option value="">选择店铺</option>' + shops
    .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  // Auto-select from URL param
  const urlShop = new URLSearchParams(location.search).get("shop");
  if (urlShop && shops.some((s) => String(s.id) === urlShop)) {
    sel.value = urlShop;
    onShopChange();
  }
}

async function onShopChange() {
  state.shopId = $("#le-shop-select").value;
  if (!state.shopId) return;
  // Load source products for the panel
  loadSourceProductsList();

// ─── Auto category matching ─────────────────────────────────────────────
let categoryMatchTimer = null;

async function autoMatchCategories() {
  const title = state.sourceProduct?.title || $("#le-title").value;
  if (!title || title.length < 4) return;
  clearTimeout(categoryMatchTimer);
  categoryMatchTimer = setTimeout(async () => {
    const container = $("#le-category-suggestions") || createCategorySuggestionsContainer();
    container.innerHTML = '<small class="le-hint"><span class="le-loading"></span> 正在自动匹配类目...</small>';
    try {
      const r = await api("POST", `/api/v1/shops/${state.shopId}/ai/match-category`, {
        title,
        material: state.sourceProduct?.material || "",
        brand: state.sourceProduct?.brand || "",
      });
      renderCategorySuggestions(r);
    } catch (e) {
      container.innerHTML = `<small class="le-hint" style="color:var(--le-danger)">匹配失败: ${esc(e.message)}</small>`;
    }
  }, 500);
}

function createCategorySuggestionsContainer() {
  const div = document.createElement("div");
  div.id = "le-category-suggestions";
  div.className = "le-cat-suggestions";
  $("#le-section-category").appendChild(div);
  return div;
}

function renderCategorySuggestions(data) {
  const container = $("#le-category-suggestions");
  const candidates = data.candidates || data;
  if (!candidates.length) {
    container.innerHTML = '<small class="le-hint">未找到匹配类目，请手动搜索。</small>';
    return;
  }
  container.innerHTML = '<small class="le-hint" style="margin-bottom:6px">自动匹配结果（已选第一个，可点击切换）：</small>' +
    candidates.map((c, i) => `
      <div class="le-cat-suggestion ${i === 0 ? "selected" : ""}" data-cat-id="${esc(c.category_id)}" data-type-id="${esc(c.type_id)}" data-title="${esc(c.title)}">
        <span>${i === 0 ? "★ " : ""}${esc(c.title_zh || c.title)}</span>
        <span class="le-cat-score">${i === 0 ? '<span class="le-cat-badge">已选</span>' : "评分 " + c.score}</span>
      </div>`).join("");
  $$(".le-cat-suggestion").forEach((el) => {
    el.addEventListener("click", () => {
      $$(".le-cat-suggestion").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
      state.categoryId = el.dataset.catId;
      state.typeId = el.dataset.typeId;
      $("#le-category-path").textContent = "已选: " + el.dataset.title + " (ID: " + el.dataset.catId + ", Type: " + el.dataset.typeId + ")";
      loadAttributes();
    });
  });
  // Auto-select first (highest score)
  if (candidates[0]) {
    state.categoryId = candidates[0].category_id;
    state.typeId = candidates[0].type_id;
    $("#le-category-path").textContent = "已选: " + candidates[0].title + " (ID: " + candidates[0].category_id + ")";
    loadAttributes();
  }
}
  // Reset category
  state.categoryId = null;
  state.typeId = null;
  state.attributes = [];
  state.attrValues = {};
  $("#le-category-search").value = "";
  $("#le-category-select").innerHTML = "";
  $("#le-category-path").textContent = "未选择类目";
  renderAttributes();
}

// ─── Auto category matching ─────────────────────────────────────────────
let categoryMatchTimer = null;

async function autoMatchCategories() {
  const title = state.sourceProduct?.title || $("#le-title").value;
  if (!title || title.length < 4) return;
  clearTimeout(categoryMatchTimer);
  categoryMatchTimer = setTimeout(async () => {
    const container = $("#le-category-suggestions") || createCategorySuggestionsContainer();
    container.innerHTML = '<small class="le-hint"><span class="le-loading"></span> 正在自动匹配类目...</small>';
    try {
      const r = await api("POST", `/api/v1/shops/${state.shopId}/ai/match-category`, {
        title,
        material: state.sourceProduct?.material || "",
        brand: state.sourceProduct?.brand || "",
      });
      renderCategorySuggestions(r);
    } catch (e) {
      container.innerHTML = `<small class="le-hint" style="color:var(--le-danger)">匹配失败: ${esc(e.message)}</small>`;
    }
  }, 500);
}

function createCategorySuggestionsContainer() {
  const div = document.createElement("div");
  div.id = "le-category-suggestions";
  div.className = "le-cat-suggestions";
  $("#le-section-category").appendChild(div);
  return div;
}

function renderCategorySuggestions(candidates) {
  const container = $("#le-category-suggestions");
  if (!candidates.length) {
    container.innerHTML = '<small class="le-hint">未找到匹配类目，请手动搜索。</small>';
    return;
  }
  container.innerHTML = '<small class="le-hint" style="margin-bottom:6px">自动匹配结果（点击选择）：</small>' +
    candidates.map((c) => `
      <div class="le-cat-suggestion" data-cat-id="${esc(c.category_id)}" data-type-id="${esc(c.type_id)}" data-title="${esc(c.title)}">
        <span>${esc(c.title_zh || c.title)}</span>
        <span class="le-cat-score">评分 ${c.score}<span class="le-cat-badge">AI推荐</span></span>
      </div>`).join("");
  $(".le-cat-suggestion").forEach((el) => {
    el.addEventListener("click", () => {
      $(".le-cat-suggestion").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
      state.categoryId = el.dataset.catId;
      state.typeId = el.dataset.typeId;
      $("#le-category-path").textContent = `已选: ${el.dataset.title} (ID: ${el.dataset.catId}, Type: ${el.dataset.typeId})`;
      loadAttributes();
    });
  });
}

// ─── Category search & select ───────────────────────────────────────────
async function searchCategories(query) {
  if (!state.shopId || query.length < 2) {
    $("#le-category-select").innerHTML = "";
    return;
  }
  try {
    let cats = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories?query=${encodeURIComponent(query)}`);
    if (!cats.length) {
      await api("POST", `/api/v1/shops/${state.shopId}/metadata/categories`);
      cats = await api("GET", `/api/v1/shops/${state.shopId}/metadata/categories?query=${encodeURIComponent(query)}`);
    }
    const sel = $("#le-category-select");
    sel.innerHTML = cats.map((c) =>
      `<option value="${c.category_id}:${c.type_id}">${esc(c.title)}</option>`).join("");
  } catch (e) {
    toast("类目搜索失败: " + e.message, "error");
  }
}

async function onCategorySelect() {
  const val = $("#le-category-select").value;
  if (!val) return;
  const [catId, typeId] = val.split(":");
  state.categoryId = catId;
  state.typeId = typeId;
  const title = $("#le-category-select").selectedOptions[0]?.textContent || "";
  $("#le-category-path").textContent = `已选: ${title} (ID: ${catId}, Type: ${typeId})`;
  await loadAttributes();
}

// ─── Attributes ─────────────────────────────────────────────────────────
async function loadAttributes() {
  if (!state.shopId || !state.categoryId || !state.typeId) return;
  const container = $("#le-attributes-container");
  container.innerHTML = '<p class="le-placeholder"><span class="le-loading"></span> 正在加载 Ozon 属性…</p>';
  try {
    state.attributes = await api("GET",
      `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes`);
    renderAttributes();
    // Also update variant attribute identification
    identifyVariantAttributes();
  } catch (e) {
    container.innerHTML = `<p class="le-placeholder" style="color:var(--le-danger)">属性加载失败: ${esc(e.message)}</p>`;
  }
}

function renderAttributes() {
  const container = $("#le-attributes-container");
  if (!state.attributes.length) {
    container.innerHTML = '<p class="le-placeholder">请先在上方选择类目，属性将自动加载。</p>';
    $("#le-attr-count").textContent = "";
    return;
  }
  const showOptional = $("#le-show-optional").checked;
  const required = state.attributes.filter((a) => a.required);
  const optional = state.attributes.filter((a) => !a.required);
  $("#le-attr-count").textContent = `(${required.length} 必填 / ${optional.length} 选填)`;

  let html = "";
  if (required.length) {
    html += '<div class="le-attr-group-title">必填属性</div>';
    html += required.map((a) => attrRowHtml(a)).join("");
  }
  if (showOptional && optional.length) {
    html += '<div class="le-attr-group-title">选填属性</div>';
    html += optional.map((a) => attrRowHtml(a)).join("");
  }
  container.innerHTML = html;

  // Wire up dictionary search + AI buttons
  $$(".le-attr-input[data-dictionary]").forEach((input) => setupDictionarySearch(input));
  $$(".le-ai-btn[data-attr-id]").forEach((btn) => {
    btn.addEventListener("click", () => aiSuggestAttribute(btn.dataset.attrId));
  });
}

function attrRowHtml(attr) {
  const dict = attr.dictionary_id && String(attr.dictionary_id).trim();
  const val = state.attrValues[attr.id] || {};
  const requiredMark = attr.required ? '<span class="le-required">*</span>' : "";
  const variantBadge = attr.is_aspect ? ' <small class="le-variant-badge" title="变体属性">变体</small>' : "";
  let inputHtml;
  if (dict) {
    inputHtml = `<input class="le-attr-input" data-dictionary="${esc(attr.dictionary_id)}" data-attr-id="${esc(attr.id)}"
      data-attr-name="${esc(attr.name)}" placeholder="输入至少2字搜索" value="${esc(val.value_text || "")}"
      autocomplete="off" /><datalist id="le-dl-${esc(attr.id)}"></datalist>`;
  } else {
    inputHtml = `<input class="le-attr-input" data-attr-id="${esc(attr.id)}" data-attr-name="${esc(attr.name)}"
      type="text" value="${esc(val.value_text || "")}" placeholder="输入文本" />`;
  }
  return `<div class="le-attr-row">
    <div class="le-attr-label">${esc(attr.name)} ${requiredMark}${variantBadge}</div>
    <div class="le-attr-input-row">${inputHtml}<button class="le-ai-btn" data-attr-id="${esc(attr.id)}" title="AI推荐">AI</button></div>
  </div>`;
}

function setupDictionarySearch(input) {
  const attrId = input.dataset.attrId;
  input.addEventListener("input", () => {
    clearTimeout(state.dictSearchTimers[attrId]);
    const query = input.value.trim();
    if (query.length < 2) return;
    state.dictSearchTimers[attrId] = setTimeout(async () => {
      try {
        const values = await api("GET",
          `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attrId}/values?query=${encodeURIComponent(query)}&limit=50`);
        const dl = $(`#le-dl-${attrId}`);
        if (dl) dl.innerHTML = values.map((v) =>
          `<option value="${esc(v.value)}" data-value-id="${esc(v.id)}" data-value-text="${esc(v.value)}"></option>`).join("");
      } catch (e) { /* silent */ }
    }, 300);
  });
  // Save value_id when user selects from datalist
  input.addEventListener("change", () => {
    const dl = $(`#le-dl-${attrId}`);
    if (!dl) return;
    const opt = [...dl.options].find((o) => o.value === input.value);
    state.attrValues[attrId] = {
      value_id: opt ? opt.dataset.valueId : null,
      value_text: input.value,
    };
  });
  // Also save on blur for text
  input.addEventListener("blur", () => {
    if (!state.attrValues[attrId]) state.attrValues[attrId] = {};
    state.attrValues[attrId].value_text = input.value;
  });
}

// ─── AI functions ───────────────────────────────────────────────────────
async function aiCall(btn, fn) {
  if (!btn) return;
  const original = btn.textContent;
  btn.classList.add("loading");
  btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message || "AI 操作失败", "error");
  } finally {
    btn.classList.remove("loading");
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function aiTranslateTitle(btn) {
  const titleZh = state.sourceProduct?.title || $("#le-title").value;
  if (!titleZh) { toast("请先输入或加载标题", "error"); return; }
  aiCall(btn, async () => {
    const ctx = state.sourceProduct?.category_hint || "";
    const r = await api("POST", "/api/v1/ai/translate", { text: titleZh, target_lang: "ru", context: ctx });
    $("#le-title").value = r.translated;
    autoMatchCategories();
    toast("标题已翻译", "success");
  });
}

async function aiGenerateDescription(btn) {
  const title = state.sourceProduct?.title || $("#le-title").value;
  if (!title) { toast("缺少商品标题", "error"); return; }
  aiCall(btn, async () => {
    const specs = Object.entries(state.attrValues)
      .filter(([, v]) => v.value_text)
      .map(([k, v]) => {
        const attr = state.attributes.find((a) => String(a.id) === k);
        return { name: attr?.name || k, value: v.value_text };
      });
    const r = await api("POST", "/api/v1/ai/generate-description", {
      product_title: title,
      source_description: state.sourceProduct?.raw_json || "",
      specs,
      target_lang: "ru",
    });
    $("#le-description").value = r.description;
    toast("描述已生成", "success");
  });
}

async function aiTranslateDescription(btn) {
  const desc = $("#le-description").value || state.sourceProduct?.title;
  if (!desc) { toast("缺少描述内容", "error"); return; }
  aiCall(btn, async () => {
    const r = await api("POST", "/api/v1/ai/translate", { text: desc, target_lang: "ru" });
    $("#le-description").value = r.translated;
    toast("描述已翻译", "success");
  });
}

async function aiGenerateRichContent(btn) {
  const desc = $("#le-description").value;
  const imgs = state.images.slice(0, 5);
  if (!desc && !imgs.length) { toast("请先生成描述或添加图片", "error"); return; }
  aiCall(btn, async () => {
    const shopName = $("#le-shop-select").selectedOptions[0]?.textContent || "";
    const r = await api("POST", "/api/v1/ai/generate-rich-content", {
      description: desc,
      image_urls: imgs,
      shop_name: shopName,
    });
    $("#le-rich-content").value = r.raw_json;
    toast("富内容已生成", "success");
  });
}

async function aiSuggestAttribute(attrId) {
  if (!state.shopId) { toast("请先选择店铺", "error"); return; }
  const attr = state.attributes.find((a) => String(a.id) === String(attrId));
  if (!attr) return;
  const title = state.sourceProduct?.title || $("#le-title").value || "";
  const desc = $("#le-description").value || "";
  if (!title) { toast("缺少商品标题，无法推荐", "error"); return; }
  const btn = $(`.le-ai-btn[data-attr-id="${attrId}"]`);
  aiCall(btn, async () => {
    // If dictionary, first search for options
    let dictOpts = null;
    if (attr.dictionary_id) {
      try {
        dictOpts = await api("GET",
          `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attrId}/values?query=${encodeURIComponent(title.slice(0, 5))}&limit=30`);
      } catch (_) { /* ignore */ }
    }
    const r = await api("POST", "/api/v1/ai/suggest-attribute", {
      attribute_name: attr.name,
      attribute_description: "",
      product_title: title,
      product_description: desc,
      dictionary_options: dictOpts,
    });
    const input = $(`.le-attr-input[data-attr-id="${attrId}"]`);
    if (input) {
      input.value = r.value || "";
      state.attrValues[attrId] = { value_id: r.value_id, value_text: r.value };
    }
    toast(`已推荐: ${r.value || "(空)"}`, "success");
  });
}

async function aiFillAllAttrs(btn) {
  if (!state.attributes.length) { toast("请先选择类目", "error"); return; }
  aiCall(btn, async () => {
    const title = state.sourceProduct?.title || $("#le-title").value || "";
    if (!title) { toast("缺少商品标题", "error"); return; }
    let filled = 0;
    for (const attr of state.attributes.filter((a) => a.required)) {
      if (state.attrValues[attr.id]?.value_text) continue;
      try {
        let dictOpts = null;
        if (attr.dictionary_id) {
          try {
            dictOpts = await api("GET",
              `/api/v1/shops/${state.shopId}/metadata/categories/${state.categoryId}/types/${state.typeId}/attributes/${attr.id}/values?query=${encodeURIComponent(title.slice(0, 5))}&limit=30`);
          } catch (_) {}
        }
        const r = await api("POST", "/api/v1/ai/suggest-attribute", {
          attribute_name: attr.name,
          product_title: title,
          product_description: $("#le-description").value || "",
          dictionary_options: dictOpts,
        });
        if (r.value) {
          const input = $(`.le-attr-input[data-attr-id="${attr.id}"]`);
          if (input) input.value = r.value;
          state.attrValues[attr.id] = { value_id: r.value_id, value_text: r.value };
          filled++;
        }
      } catch (_) {}
    }
    toast(`已填充 ${filled} 个必填属性`, "success");
  });
}

// ─── Images ─────────────────────────────────────────────────────────────
function renderImages() {
  const grid = $("#le-image-grid");
  $("#le-image-count").textContent = state.images.length ? `(${state.images.length} 张)` : "";
  grid.innerHTML = state.images.map((url, i) => `
    <div class="le-image-card ${i === 0 ? "le-image-primary" : ""}" data-index="${i}">
      <img src="${esc(url)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.3" />
      <button class="le-image-remove" onclick="removeImage(${i})">×</button>
      <div class="le-image-resolution">${i === 0 ? "主图" : ""}</div>
    </div>`).join("");
}

window.removeImage = function (i) {
  state.images.splice(i, 1);
  renderImages();
};

function addImage() {
  const url = $("#le-image-url-input").value.trim();
  if (!url) return;
  if (!url.startsWith("http")) { toast("请输入有效的图片 URL", "error"); return; }
  state.images.push(url);
  $("#le-image-url-input").value = "";
  renderImages();
}

function importSourceImages() {
  if (!state.sourceProduct?.media?.length) { toast("没有采集图片可导入", "error"); return; }
  const urls = state.sourceProduct.media.filter((m) => m.media_type === "image").map((m) => m.url);
  const newUrls = urls.filter((u) => !state.images.includes(u));
  state.images.push(...newUrls);
  renderImages();
  toast(`导入了 ${newUrls.length} 张采集图片`, "success");
}

// ─── Variant attributes ─────────────────────────────────────────────────
function identifyVariantAttributes() {
  // Ozon uses is_aspect=true to mark variant-defining attributes
  // Also check attribute_complex_id (stored as complex_id) != 0
  // Fallback to name matching if neither is available
  const variantAttrNames = ["цвет", "color", "размер", "size", "пол", "цвета", "颜色", "尺寸"];
  const keyAttrs = state.attributes.filter((a) => {
    if (a.is_aspect) return true;
    const cid = String(a.complex_id || "0");
    if (cid !== "0" && cid !== "") return true;
    const name = (a.name || "").toLowerCase();
    return variantAttrNames.some((vn) => name.includes(vn));
  });
  const container = $("#le-variant-attrs");
  if (!keyAttrs.length) {
    container.innerHTML = '<small class="le-hint">当前类目未识别到变体属性，可手动添加 SKU 行。</small>';
    return;
  }
  container.innerHTML = '<small class="le-hint" style="margin-bottom:6px">以下属性可创建变体，输入值后用逗号分隔（如：红色,蓝色,黑色）</small>' + keyAttrs.map((a) => `
    <div class="le-variant-attr-row">
      <label>${esc(a.name)} ${a.is_aspect ? '<small style="color:var(--le-ai)">[变体]</small>' : ""}:</label>
      <input type="text" data-variant-attr="${esc(a.id)}" placeholder="变体值，逗号分隔" />
    </div>`).join("");
  $$("[data-variant-attr]").forEach((input) => {
    input.addEventListener("change", generateVariantRows);
  });
}

function generateVariantRows() {
  const attrInputs = $$("[data-variant-attr]");
  if (!attrInputs.length) return;
  // Parse comma-separated values for each variant attribute
  const attrValues = [];
  attrInputs.forEach((input) => {
    const values = input.value.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length) {
      attrValues.push({ attrId: input.dataset.variantAttr, attrName: input.previousElementSibling?.textContent || "", values });
    }
  });
  if (!attrValues.length) return;
  // Generate combinations (cartesian product)
  let combos = [{}];
  for (const av of attrValues) {
    const newCombos = [];
    for (const combo of combos) {
      for (const val of av.values) {
        newCombos.push({ ...combo, [av.attrName]: val });
      }
    }
    combos = newCombos;
  }
  // Create variant rows
  const offerId = $("#le-offer-id").value || "SKU";
  state.variants = combos.map((combo, i) => {
    const suffix = Object.values(combo).join("-");
    const existing = state.variants[i];
    return {
      seller_sku: `${offerId}-${suffix}`,
      barcode: "",
      price_cny: existing?.price_cny || "",
      old_price_cny: existing?.old_price_cny || "",
      cost_cny: existing?.cost_cny || "",
      stock: existing?.stock || "1000",
      length_mm: existing?.length_mm || "",
      width_mm: existing?.width_mm || "",
      height_mm: existing?.height_mm || "",
      weight_g: existing?.weight_g || "",
      name_ru: existing?.name_ru || Object.values(combo).join(" "),
      image_url: "",
      combo,
    };
  });
  renderVariantTable();
}

function renderVariantTable() {
  const tbody = $("#le-variant-rows");
  tbody.innerHTML = state.variants.map((v, i) => `
    <tr>
      <td><img class="le-variant-thumb" src="${esc(v.image_url || state.images[0] || "")}" onerror="this.style.display='none'" /></td>
      <td><input type="text" value="${esc(v.seller_sku)}" data-field="seller_sku" data-idx="${i}" /></td>
      <td><input type="text" value="${esc(v.barcode)}" data-field="barcode" data-idx="${i}" /></td>
      <td><input type="number" step="0.01" value="${esc(v.price_cny)}" data-field="price_cny" data-idx="${i}" placeholder="自动" /></td>
      <td><input type="number" step="0.01" value="${esc(v.old_price_cny)}" data-field="old_price_cny" data-idx="${i}" /></td>
      <td><input type="number" step="0.01" value="${esc(v.cost_cny)}" data-field="cost_cny" data-idx="${i}" /></td>
      <td><input type="number" value="${esc(v.stock)}" data-field="stock" data-idx="${i}" /></td>
      <td style="display:flex;gap:2px"><input type="number" value="${esc(v.length_mm)}" data-field="length_mm" data-idx="${i}" style="width:50px" /><input type="number" value="${esc(v.width_mm)}" data-field="width_mm" data-idx="${i}" style="width:50px" /><input type="number" value="${esc(v.height_mm)}" data-field="height_mm" data-idx="${i}" style="width:50px" /></td>
      <td><input type="number" step="0.01" value="${esc(v.weight_g)}" data-field="weight_g" data-idx="${i}" /></td>
      <td><input type="text" value="${esc(v.name_ru)}" data-field="name_ru" data-idx="${i}" /></td>
      <td><button class="le-variant-del" onclick="removeVariant(${i})">×</button></td>
    </tr>`).join("");
  // Wire up field changes
  $$("#le-variant-rows input[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const idx = parseInt(input.dataset.idx);
      state.variants[idx][input.dataset.field] = input.value;
    });
  });
}

window.removeVariant = function (i) {
  state.variants.splice(i, 1);
  renderVariantTable();
};

function addVariantRow() {
  state.variants.push({
    seller_sku: `${$("#le-offer-id").value || "SKU"}-${state.variants.length + 1}`,
    barcode: "", price_cny: "", old_price_cny: "", cost_cny: "",
    stock: "1000", length_mm: "", width_mm: "", height_mm: "",
    weight_g: "", name_ru: "", image_url: "", combo: {},
  });
  renderVariantTable();
}

// ─── Source products ────────────────────────────────────────────────────
async function loadSourceProductsList() {
  try {
    const products = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products`);
    const sel = $("#le-source-select");
    sel.innerHTML = '<option value="">选择采集商品...</option>' + products.map((p) =>
      `<option value="${p.id}">[${p.source_platform}] ${esc(p.title)}</option>`).join("");
  } catch (_) {}
}

async function loadSourceProductDetail(spId) {
  if (!spId) { state.sourceProduct = null; renderSourcePanel(); return; }
  try {
    state.sourceProduct = await api("GET", `/api/v1/shops/${state.shopId}/pipeline/source-products/${spId}`);
    renderSourcePanel();
    // Auto-fill title from source
    if (state.sourceProduct.title && !$("#le-title").value) {
      $("#le-title").value = state.sourceProduct.title;
    }
    autoMatchCategories();
    if (state.sourceProduct.source_url && !$("#le-source-url").value) {
      $("#le-source-url").value = state.sourceProduct.source_url || "";
    }
  } catch (e) {
    toast("加载采集商品失败: " + e.message, "error");
  }
}

function renderSourcePanel() {
  const c = $("#le-source-content");
  if (!state.sourceProduct) {
    c.innerHTML = '<p class="le-placeholder">选择采集商品后，此处展示货源信息，供 AI 填充时参考。</p>';
    return;
  }
  const sp = state.sourceProduct;
  const imgs = (sp.media || []).filter((m) => m.media_type === "image");
  c.innerHTML = `
    <div class="le-source-info">
      <h4>标题</h4><strong>${esc(sp.title)}</strong>
      ${sp.brand ? `<h4>品牌</h4>${esc(sp.brand)}` : ""}
      ${sp.material ? `<h4>材质</h4>${esc(sp.material)}` : ""}
      ${sp.category_hint ? `<h4>类目提示</h4>${esc(sp.category_hint)}` : ""}
    </div>
    ${sp.variants?.length ? `<div class="le-source-info"><h4>变体 (${sp.variants.length})</h4>${sp.variants.map(v => `<div>${esc(v.spec_name)} - ¥${v.price_cny || "?"} (库存${v.stock})</div>`).join("")}</div>` : ""}
    ${imgs.length ? `<h4>图片 (${imgs.length})</h4><div class="le-source-images">${imgs.slice(0, 9).map(m => `<img src="${esc(m.url)}" loading="lazy" referrerpolicy="no-referrer" />`).join("")}</div>` : ""}
  `;
}

// ─── Save & Validate ────────────────────────────────────────────────────
function collectAttributePayload() {
  // Read values directly from DOM for reliability
  const payload = [];
  $$(".le-attr-input[data-attr-id]").forEach((input) => {
    const attrId = input.dataset.attrId;
    const val = input.value.trim();
    if (!val) return;
    const attr = state.attributes.find((a) => String(a.id) === attrId);
    // Check if this is a dictionary field by looking for a datalist
    const dl = $(`#le-dl-${attrId}`);
    let valueId = null;
    if (dl) {
      const opt = [...dl.options].find((o) => o.value === val);
      valueId = opt ? opt.dataset.valueId : null;
      // Also check if we have a stored value_id
      if (!valueId && state.attrValues[attrId]?.value_id) {
        valueId = state.attrValues[attrId].value_id;
      }
    }
    payload.push({
      attribute_id: attrId,
      name: attr?.name || input.dataset.attrName || "",
      value_id: valueId,
      value_text: val,
    });
  });
  return payload;
}

function collectVariantPayload() {
  return state.variants.map((v) => ({
    seller_sku: v.seller_sku,
    purchase_cost_cny: v.cost_cny ? parseFloat(v.cost_cny) : null,
    weight_g: v.weight_g ? parseFloat(v.weight_g) : null,
    length_mm: v.length_mm ? parseFloat(v.length_mm) : null,
    width_mm: v.width_mm ? parseFloat(v.width_mm) : null,
    height_mm: v.height_mm ? parseFloat(v.height_mm) : null,
  }));
}

async function saveDraft() {
  if (!state.shopId) { toast("请先选择店铺", "error"); return; }
  const offerId = $("#le-offer-id").value.trim();
  const title = $("#le-title").value.trim();
  if (!offerId || !title) { toast("Offer ID 和标题为必填项", "error"); return; }
  const payload = {
    offer_id: offerId,
    title,
    description: $("#le-description").value || null,
    category_id: state.categoryId || null,
    type_id: state.typeId || null,
    primary_image_url: state.images[0] || null,
    attributes: collectAttributePayload(),
    variants: collectVariantPayload().length ? collectVariantPayload() : [{
      seller_sku: offerId, purchase_cost_cny: null, weight_g: null,
      length_mm: null, width_mm: null, height_mm: null,
    }],
  };
  try {
    if (state.draftId) {
      await api("PUT", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}`, payload);
    } else {
      const draft = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts`, payload);
      state.draftId = draft.id;
    }
    toast("草稿已保存", "success");
  } catch (e) {
    toast("保存失败: " + e.message, "error");
  }
}

async function validateDraft() {
  if (!state.draftId) {
    await saveDraft();
    if (!state.draftId) return;
  }
  try {
    const r = await api("POST", `/api/v1/shops/${state.shopId}/listing-drafts/${state.draftId}/validate`);
    if (!r.issues.length) {
      toast("预检通过！可进入审批发布。", "success");
    } else {
      toast(`预检发现 ${r.issues.length} 个问题`, "error");
      console.log("Validation issues:", r.issues);
    }
  } catch (e) {
    toast("预检失败: " + e.message, "error");
  }
}

// ─── Event wiring ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadShops();

  $("#le-shop-select").addEventListener("change", onShopChange);
  $("#le-category-search").addEventListener("input", (e) => {
    clearTimeout(state.categorySearchTimer);
    state.categorySearchTimer = setTimeout(() => searchCategories(e.target.value.trim()), 300);
  });
  $("#le-category-select").addEventListener("change", onCategorySelect);
  $("#le-show-optional").addEventListener("change", renderAttributes);

  // AI buttons
  $$("[data-ai-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.aiAction;
      if (action === "translate-title") aiTranslateTitle(btn);
      else if (action === "generate-description") aiGenerateDescription(btn);
      else if (action === "translate-description") aiTranslateDescription(btn);
      else if (action === "generate-rich-content") aiGenerateRichContent(btn);
    });
  });
  $("#le-ai-fill-all-attrs").addEventListener("click", () => aiFillAllAttrs($("#le-ai-fill-all-attrs")));

  // Images
  $("#le-add-image").addEventListener("click", addImage);
  $("#le-image-url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addImage(); } });
  $("#le-import-source-images").addEventListener("click", importSourceImages);

  // Variants
  $("#le-add-variant-row").addEventListener("click", addVariantRow);

  // Source panel
  $("#le-source-select").addEventListener("change", (e) => loadSourceProductDetail(e.target.value));

  // Save & validate
  $("#le-save-btn").addEventListener("click", saveDraft);
  $("#le-validate-btn").addEventListener("click", validateDraft);

  // Section collapse toggle
  $$(".le-section-title").forEach((title) => {
    title.addEventListener("click", () => title.parentElement.classList.toggle("le-section-collapsed"));
  });
});








