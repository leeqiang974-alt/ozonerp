// 快速审核模块 - 采集箱快速审核弹窗
// 依赖：apiBase, window.window.__qrItems__, loadCollectionBox, escapeHtml, toast, $

let quickReviewItem = null;
let quickReviewDetail = null;
let quickReviewImages = [];
let quickReviewImagesLoaded = false;
let quickReviewSuspendedForImage = false;
let quickReviewCategoryCandidates = [];

// The review modal is rendered repeatedly. Keep one document-level outside
// click handler instead of accumulating a new handler on every render.
if (!window._qrCategoryOutsideReady) {
  window._qrCategoryOutsideReady = true;
  window._qrActiveCategorySearch = null;
  document.addEventListener("click", event => {
    const active = window._qrActiveCategorySearch;
    if (!active) return;
    if (event.target === active.input || active.dropdown.contains(event.target)) return;
    active.close();
  });
}

function reviewValue(value) {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

function closeImageDialogs() {
  const d1 = document.getElementById("cb-image-dialog");
  const d2 = document.getElementById("cb-quick-image-dialog");
  if (d1 && d1.open) d1.close();
  if (d2 && d2.open) d2.close();
}

function updateQuickTranslateSelection() {
  const button = document.getElementById("cb-quick-translate-images");
  if (!button || button.disabled) return;
  const selected = document.querySelectorAll(".cb-quick-image-select:checked").length;
  button.textContent = selected ? `翻译所选图片（${selected} 张）` : "请勾选图片后翻译";
}

function openQuickReviewImage(url) {
  const collectionDialog = document.getElementById("cb-image-dialog");
  if (collectionDialog?.open) collectionDialog.close();
  const review = document.getElementById("cb-quick-review");
  quickReviewSuspendedForImage = Boolean(review?.open);
  if (quickReviewSuspendedForImage) review.close();
  let dialog = document.getElementById("cb-quick-image-dialog");
  if (!dialog) {
    document.body.insertAdjacentHTML("beforeend",
      '<dialog id="cb-quick-image-dialog" class="cb-quick-image-dialog">' +
      '<button type="button" class="icon" aria-label="关闭">×</button>' +
      '<img id="cb-quick-image-large" alt="商品图片原图"></dialog>');
    dialog = document.getElementById("cb-quick-image-dialog");
    const restoreReview = () => {
      if (!quickReviewSuspendedForImage) return;
      quickReviewSuspendedForImage = false;
      const currentReview = document.getElementById("cb-quick-review");
      if (currentReview && !currentReview.open) currentReview.showModal();
    };
    dialog.querySelector("button").onclick = () => { dialog.close(); restoreReview(); };
    dialog.addEventListener("click", event => {
      if (event.target === dialog || event.target.id === "cb-quick-image-large") {
        dialog.close(); restoreReview();
      }
    });
    dialog.addEventListener("cancel", restoreReview);
    dialog.addEventListener("close", restoreReview);
  }
  document.getElementById("cb-quick-image-large").src = url;
  dialog.showModal();
}

function renderQuickReview(item, detail) {
  quickReviewDetail = detail;
  const box = document.getElementById("cb-quick-review-content");
  if (!box) return;
  const fallbackVariants = detail.variants || [];
  const fallbackPackage = detail.packageInfo || {};
  const summary = item.review_summary || {
    package: fallbackPackage,
    package_complete: ["weightG", "lengthMm", "widthMm", "heightMm"].every(
      key => ![undefined, null, "", 0, "0"].includes(fallbackPackage[key])),
    variant_count: fallbackVariants.length,
    variants_with_package: fallbackVariants.filter(v => v.weightG && v.lengthMm && v.widthMm && v.heightMm).length,
    source_variant_count: fallbackVariants.length,
    image_count: (detail.media || []).filter(m => m.media_type === "image").length,
    has_chinese_text: false,
    draft_exists: Boolean(item.draft_id),
    submitted: item.draft_status === "已提交",
  };
  const pkg = summary.package || {};
  const packageReady = Boolean(summary.package_complete);
  const variantCount = Number(summary.variant_count || 0);
  const priceReady = Boolean(summary.draft_exists && variantCount && summary.variants_with_package === variantCount);
  const imageCount = Number(summary.image_count || (detail.media?.filter(m => m.media_type === "image").length) || 0);
  const issueCount = Array.isArray(item.ozon_issues) ? item.ozon_issues.length : 0;
  const imageWarn = summary.has_chinese_text || !imageCount;
  const fallbackImages = (detail.media || []).filter(m => m.media_type === "image" && m.url).map(m => m.url);
  const sourceImages = quickReviewImagesLoaded ? quickReviewImages : fallbackImages;
  const canTranslateImages = Boolean(sourceImages.length);
  const translateButtonLabel = !item.draft_id ? "翻译所选图片（自动建立草稿）" : "翻译所选图片";
  const translateNote = !item.draft_id
    ? "首次翻译会自动建立图片草稿并回填，不需要先进入完整编辑器。"
    : "点击图片查看细节；勾选后统一翻译并回填。AI 套图应用后默认排在图库最前。";
  const imageCards = sourceImages.map((url, index) =>
    `<article class="cb-quick-image-card">
      <input type="checkbox" class="cb-quick-image-select" data-index="${index}" aria-label="选择第 ${index + 1} 张图片翻译">
      <img src="${escapeHtml(url)}" alt="商品图片 ${index + 1}" loading="lazy" referrerpolicy="no-referrer" data-image-url="${escapeHtml(url)}">
      <button type="button" class="cb-quick-image-delete" data-index="${index}" aria-label="删除第 ${index + 1} 张图片" title="从该商品草稿删除图片">×</button>
      <span>第 ${index + 1} 张</span>
    </article>`
  ).join("");

  box.innerHTML = `
    <section class="cb-review-card cb-review-images">
      <h4>图片审核</h4>
      <div class="cb-quick-image-grid">${imageCards || '<p class="cb-review-note">暂无可用图片</p>'}</div>
      <div class="cb-review-actions">
        <button type="button" class="secondary" id="cb-quick-translate-images" ${canTranslateImages ? "" : "disabled"}>${translateButtonLabel}</button>
        <button type="button" class="secondary" id="cb-quick-ai-images">✨ 生成 AI 套图（应用后置顶）</button>
      </div>
      <p class="cb-review-note" id="cb-quick-translate-status">${translateNote}</p>
    </section>
    <section class="cb-review-card">
      <h4>商品</h4>
      <div class="cb-review-status">
        <span class="cb-review-dot ${item.title ? "" : "warn"}"></span>
        <strong>${escapeHtml(item.title || "未命名商品")}</strong>
      </div>
      <p class="cb-review-note">${escapeHtml(item.shop_name || "")} · ${escapeHtml(item.source_offer_id || "无货源 ID")} · ${variantCount || "待生成"} 个 SKU</p>
    </section>
    <section class="cb-review-card cb-review-sku-card">
      <h4>SKU 列表 <small id="cb-quick-sku-count" class="muted">加载中…</small></h4>
      <div id="cb-quick-sku-list"><p class="cb-review-note">正在读取变体信息…</p></div>
    </section>
    <section class="cb-review-card">
      <h4>分类匹配</h4>
      <div id="cb-quick-category-block"><span class="muted">正在匹配类目…</span></div>
      <p class="cb-review-note" id="cb-quick-category-note">系统自动根据标题匹配 Ozon 类目，确认后再提交。属性明细请进入完整编辑器查看。</p>
    </section>
    <section class="cb-review-card">
      <h4>1 · 尺重与价格</h4>
      <div class="cb-review-status">
        <span class="cb-review-dot ${packageReady ? "" : "warn"}"></span>
        <span>${packageReady ? "尺重已完整，保存后自动联动变体和仓库" : "需要确认尺重；保存后自动覆盖全部变体"}</span>
      </div>
      <div class="cb-review-grid">
        <label>重量（g）<input id="cb-quick-weight" type="number" min="0.01" step="0.01" value="${reviewValue(pkg.weightG)}"></label>
        <label>长（mm）<input id="cb-quick-length" type="number" min="0.01" step="0.01" value="${reviewValue(pkg.lengthMm)}"></label>
        <label>宽（mm）<input id="cb-quick-width" type="number" min="0.01" step="0.01" value="${reviewValue(pkg.widthMm)}"></label>
        <label>高（mm）<input id="cb-quick-height" type="number" min="0.01" step="0.01" value="${reviewValue(pkg.heightMm)}"></label>
      </div>
      <p class="cb-review-note">${priceReady ? "当前草稿变体已有尺重和定价。" : "保存尺重后进入编辑器时，统一定价接口会补齐售价、原价、最低价和物流档位。"}</p>
    </section>
    <section class="cb-review-card">
      <h4>2 · 图片</h4>
      <div class="cb-review-status">
        <span class="cb-review-dot ${imageWarn ? "warn" : ""}"></span>
        <span>${imageCount ? `已采集 ${imageCount} 张图片` : "没有可用图片"}${summary.has_chinese_text ? "，描述仍含中文" : ""}</span>
      </div>
      <div class="cb-review-actions">
        <span class="cb-review-chip ${imageWarn ? "warn" : "ok"}">${summary.has_chinese_text ? "需要翻译/质检" : imageCount ? "待确认是否翻译" : "需要补图"}</span>
        <span class="cb-review-chip">AI 套图由编辑器确认后应用</span>
      </div>
    </section>
    <section class="cb-review-card">
      <h4>3 · SKU</h4>
      <div class="cb-review-status">
        <span class="cb-review-dot ${summary.draft_exists ? "" : "todo"}"></span>
        <span>${summary.draft_exists ? `已建立 ${variantCount} 行变体，编辑器会校验 50 字符限制和首图` : "尚未建立 SKU 草稿"}</span>
      </div>
    </section>
    <section class="cb-review-card">
      <h4>4 · 内容质检</h4>
      <div class="cb-review-status">
        <span class="cb-review-dot ${issueCount || summary.has_chinese_text ? "warn" : "todo"}"></span>
        <span>${issueCount ? `Ozon 返回 ${issueCount} 项问题` : summary.has_chinese_text ? "发现中文内容，进入编辑器自动重译" : "提交时后台自动预检"}</span>
      </div>
      ${issueCount ? `<div class="cb-review-actions"><button type="button" class="secondary" id="cb-quick-auto-fix">自动修复明确问题（${issueCount}）</button></div>` : ""}
      <p class="cb-review-note">确定规则的问题由后台自动处理；涉及品牌、材质或类目事实的内容仍需人工确认。</p>
    </section>
  `;

  // 绑定图片点击
  box.querySelectorAll(".cb-quick-image-card img").forEach(img => {
    img.addEventListener("click", () => openQuickReviewImage(img.dataset.imageUrl));
  });
  box.querySelectorAll(".cb-quick-image-select").forEach(input => {
    input.addEventListener("change", updateQuickTranslateSelection);
  });
  box.querySelectorAll(".cb-quick-image-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteQuickReviewImage(Number(btn.dataset.index));
    });
  });
  const translateBtn = document.getElementById("cb-quick-translate-images");
  if (translateBtn) translateBtn.addEventListener("click", translateQuickReviewImages);

  const autoFixBtn = document.getElementById("cb-quick-auto-fix");
  if (autoFixBtn) autoFixBtn.addEventListener("click", async () => {
    const button = autoFixBtn;
    button.disabled = true;
    button.textContent = "自动修复中…";
    try {
      const r = await fetch(`${apiBase}/api/v1/shops/${item.shop_id}/listing-drafts/${item.draft_id}/auto-fix`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "自动修复失败");
      toast(`已自动修复 ${data.fix_count || 0} 项，仍需确认的内容请打开编辑器`, false);
      await window.window.__qrRefresh__ && window.__qrRefresh__();
      const refreshed = window.window.__qrItems__.find(x =>
        Number(x.source_product_id) === Number(item.source_product_id) && Number(x.shop_id) === Number(item.shop_id));
      if (refreshed) { quickReviewItem = refreshed; renderQuickReview(refreshed, detail); }
    } catch (error) {
      toast(error.message || "自动修复失败", true);
    } finally {
      button.disabled = false;
      button.textContent = `自动修复明确问题（${issueCount}）`;
    }
  });

  // 加载分类匹配（异步）
  setTimeout(() => loadQuickReviewCategory(item, detail), 0);
}

function renderQuickReviewSkus(variants) {
  const list = document.getElementById("cb-quick-sku-list");
  const countEl = document.getElementById("cb-quick-sku-count");
  if (!list) return;
  const skus = Array.isArray(variants) ? variants : [];
  if (countEl) countEl.textContent = `共 ${skus.length} 个`;
  if (!skus.length) {
    list.innerHTML = '<p class="cb-review-note">暂无变体信息</p>';
    return;
  }
  list.innerHTML = `
    <div style="overflow-x:auto">
      <table class="cb-sku-table" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f6f8fc">
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e9f2">规格</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e9f2">首图</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e5e9f2">采购价</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e5e9f2">售价</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e5e9f2">重量(g)</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e5e9f2">尺寸(mm)</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #e5e9f2">库存</th>
          </tr>
        </thead>
        <tbody>
          ${skus.map((sku, i) => {
            const dims = [sku.length_mm, sku.width_mm, sku.height_mm].filter(v => v != null).join("×") || "-";
            const spec = sku.variant_values || sku.seller_sku || `SKU ${i + 1}`;
            const img = sku.image_url
              ? `<img src="${escapeHtml(sku.image_url)}" style="width:28px;height:28px;border-radius:4px;object-fit:cover" referrerpolicy="no-referrer">`
              : '<span class="muted">-</span>';
            return `<tr>
              <td style="padding:6px 8px;border-bottom:1px solid #eef1f7;max-width:180px">${escapeHtml(spec)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eef1f7">${img}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eef1f7;text-align:right">${sku.purchase_cost_cny != null ? sku.purchase_cost_cny.toFixed(2) : "-"}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eef1f7;text-align:right">${sku.price_cny != null ? Number(sku.price_cny).toFixed(2) : "-"}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eef1f7;text-align:right">${sku.weight_g != null ? sku.weight_g : "-"}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eef1f7;text-align:right">${dims}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eef1f7;text-align:right">${sku.stock != null ? sku.stock : "-"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function loadQuickReviewCategory(item, detail) {
  const block = document.getElementById("cb-quick-category-block");
  const note = document.getElementById("cb-quick-category-note");
  if (!block) return;
  block.innerHTML = '<span class="muted">正在匹配类目…</span>';
  try {
    let currentCategory = null;
    let candidates = [];
    // Reuse the editor's category contract. Merely opening quick review must
    // not create a draft or run a second matching pipeline.
    const matchResp = await fetch(`${apiBase}/api/v1/shops/${item.shop_id}/ai/match-category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title || detail?.title || "",
        material: detail?.material || "",
        brand: detail?.brand || "",
        source_product_id: item.source_product_id,
      }),
    });
    if (!matchResp.ok) {
      const error = await matchResp.json().catch(() => ({}));
      throw new Error(error.detail || "匹配类目失败");
    }
    const matchData = await matchResp.json();
    candidates = (matchData.candidates || []).slice(0, 5);
    if (item.draft_id) {
      const draftResp = await fetch(`${apiBase}/api/v1/shops/${item.shop_id}/listing-drafts/${item.draft_id}`);
      if (draftResp.ok) {
        const draft = await draftResp.json();
        if (draft.category_id && draft.type_id) {
          const matched = candidates.find(c => String(c.category_id) === String(draft.category_id) && String(c.type_id) === String(draft.type_id));
          currentCategory = {
            category_id: draft.category_id,
            type_id: draft.type_id,
            title_zh: matched?.title_zh || matched?.title || `${draft.category_id} / ${draft.type_id}`,
            is_suggestion: false,
          };
        }
        renderQuickReviewSkus(draft.variants || []);
      }
    } else {
      renderQuickReviewSkus((detail?.variants || []).map(v => ({
        seller_sku: v.source_sku,
        variant_values: v.spec_name,
        image_url: v.image_url,
        purchase_cost_cny: v.price_cny,
        price_cny: null,
        weight_g: v.weightG,
        length_mm: v.lengthMm,
        width_mm: v.widthMm,
        height_mm: v.heightMm,
        stock: v.stock,
      })));
    }
    if (!currentCategory && candidates.length) {
      const top = candidates[0];
      currentCategory = {
        category_id: top.category_id, type_id: top.type_id,
        title_zh: top.title_zh || top.title || "", is_suggestion: true
      };
    }
    quickReviewCategoryCandidates = candidates;
    const topLabel = currentCategory
      ? (currentCategory.title_zh || `${currentCategory.category_id} / ${currentCategory.type_id}`)
      : "未能匹配到类目";
    const topStatus = currentCategory
      ? (currentCategory.is_suggestion ? "建议类目" : "已保存类目")
      : "未匹配";
    const topClass = currentCategory
      ? (currentCategory.is_suggestion ? "todo" : "ok")
      : "warn";
    const candidateList = candidates.length
      ? candidates.map((c, i) => {
          const label = c.title_zh || c.title || `${c.category_id} / ${c.type_id}`;
          const score = c.score != null ? `（得分 ${c.score}）` : "";
          return `<button type="button" class="secondary cb-quick-category-candidate" data-index="${i}">${escapeHtml(label)}${escapeHtml(score)}</button>`;
        }).join("")
      : '<span class="muted">没有可用候选，请进入编辑器手动选择。</span>';
    block.innerHTML = `
      <div class="cb-review-status">
        <span class="cb-review-dot ${topClass}"></span>
        <strong id="cb-quick-category-current">${escapeHtml(topLabel)}</strong>
        <span class="cb-review-chip" id="cb-quick-category-status">${topStatus}</span>
      </div>
      <div class="cb-quick-cat-search" style="position:relative;margin-top:10px">
        <input type="text" id="cb-quick-category-search" placeholder="搜索类目，例如：徽章、烘焙模具、手机壳…" style="width:100%;padding:8px 10px;border:1px solid #d4d9e4;border-radius:6px;font-size:13px;box-sizing:border-box">
        <div id="cb-quick-category-dropdown" style="position:absolute;top:100%;left:0;right:0;margin-top:4px;background:#fff;border:1px solid #e0e5ef;border-radius:6px;box-shadow:0 4px 16px #071c3d18;max-height:280px;overflow-y:auto;z-index:30;display:none"></div>
      </div>
      <div class="cb-review-actions">
        <button type="button" class="secondary" id="cb-quick-category-rematch">重新匹配</button>
        <button type="button" class="secondary" id="cb-quick-category-open-editor">进入编辑器查看属性</button>
      </div>
      <div class="cb-quick-cat-recommend" style="margin-top:10px">
        <div class="cb-review-note" style="margin-bottom:6px">推荐候选（${candidates.length}）</div>
        <div class="cb-quick-candidate-list">${candidateList}</div>
      </div>
    `;
    const rematchBtn = document.getElementById("cb-quick-category-rematch");
    if (rematchBtn) rematchBtn.onclick = async () => {
      rematchBtn.disabled = true; rematchBtn.textContent = "匹配中…";
      try {
        const r = await fetch(`${apiBase}/api/v1/shops/${item.shop_id}/ai/match-category`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: item.title || (detail && detail.title) || "", source_product_id: item.source_product_id }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "匹配失败");
        candidates = (data.candidates || []).slice(0, 5);
        quickReviewCategoryCandidates = candidates;
        const list = document.querySelector(".cb-quick-candidate-list");
        if (list) {
          list.innerHTML = candidates.length
            ? candidates.map((c, i) => {
                const label = c.title_zh || c.title || `${c.category_id} / ${c.type_id}`;
                const score = c.score != null ? `（得分 ${c.score}）` : "";
                return `<button type="button" class="secondary cb-quick-category-candidate" data-index="${i}">${escapeHtml(label)}${escapeHtml(score)}</button>`;
              }).join("")
            : '<span class="muted">没有可用候选。</span>';
          bindQuickCategoryCandidates(candidates, item, note);
        }
        if (note) note.textContent = `已重新匹配，共 ${candidates.length} 个候选；点击候选即可应用到草稿。`;
      } catch (error) {
        toast(error.message || "重新匹配失败", true);
      } finally {
        rematchBtn.disabled = false; rematchBtn.textContent = "重新匹配";
      }
    };
    const openEditorBtn = document.getElementById("cb-quick-category-open-editor");
    if (openEditorBtn) openEditorBtn.onclick = () => {
      if (!quickReviewItem) return;
      const it = quickReviewItem;
      let url = `./listing-editor.html?shop=${it.shop_id}&sp=${it.source_product_id}&returnTo=collection-box`;
      if (it.draft_id) url += `&draft=${it.draft_id}`;
      window.location.href = url;
    };
    bindQuickCategoryCandidates(candidates, item, note);
    bindQuickCategorySearch(item, note);
  } catch (error) {
    if (block) block.innerHTML = `<span class="muted">类目匹配失败：${escapeHtml(error.message || "未知错误")}</span>`;
  }
}

function bindQuickCategorySearch(item, noteEl) {
  const input = document.getElementById("cb-quick-category-search");
  const dropdown = document.getElementById("cb-quick-category-dropdown");
  if (!input || !dropdown) return;
  let searchTimer = null;
  let searchToken = 0;
  const closeDropdown = () => { dropdown.style.display = "none"; };
  const openDropdown = () => { dropdown.style.display = "block"; };
  input.addEventListener("focus", () => {
    if (input.value.trim()) doSearch(input.value.trim());
    else showRecommendedDropdown();
  });
  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearTimeout(searchTimer);
    if (!query) { showRecommendedDropdown(); return; }
    searchTimer = setTimeout(() => doSearch(query), 250);
  });
  window._qrActiveCategorySearch = { input, dropdown, close: closeDropdown };
  async function doSearch(query) {
    const token = ++searchToken;
    try {
      const r = await fetch(`${apiBase}/api/v1/shops/${item.shop_id}/metadata/categories?query=${encodeURIComponent(query)}&limit=20`);
      if (!r.ok) throw new Error("搜索失败");
      const list = await r.json();
      if (token !== searchToken) return;
      if (!list.length) {
        dropdown.innerHTML = '<div style="padding:12px;text-align:center;color:#889">没有匹配的类目</div>';
      } else {
        dropdown.innerHTML = list.map((c, i) => {
          const label = c.title_zh || c.title || `${c.category_id} / ${c.type_id}`;
          return `<div class="cb-quick-cat-option" data-ci="${i}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f1f3f9;display:flex;justify-content:space-between;align-items:center;gap:10px">
            <span>${escapeHtml(label)}</span>
            <small class="muted">${c.category_id}/${c.type_id}</small>
          </div>`;
        }).join("");
        dropdown.querySelectorAll(".cb-quick-cat-option").forEach((el, idx) => {
          el.onclick = () => applySearchCategory(list[idx], item, noteEl, input);
        });
      }
      openDropdown();
    } catch (err) {
      if (token === searchToken) {
        dropdown.innerHTML = `<div style="padding:12px;text-align:center;color:#c00">${escapeHtml(err.message || "搜索失败")}</div>`;
        openDropdown();
      }
    }
  }
  function showRecommendedDropdown() {
    const candidates = quickReviewCategoryCandidates || [];
    if (!candidates.length) {
      dropdown.innerHTML = '<div style="padding:12px;text-align:center;color:#889">无推荐候选，输入关键词搜索</div>';
    } else {
      dropdown.innerHTML = '<div style="padding:6px 12px;font-size:12px;color:#728099;background:#f6f8fc">推荐候选</div>' +
        candidates.map((c, i) => {
          const label = c.title_zh || c.title || `${c.category_id} / ${c.type_id}`;
          const score = c.score != null ? `（${c.score} 分）` : "";
          return `<div class="cb-quick-cat-option" data-ri="${i}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f1f3f9;display:flex;justify-content:space-between;align-items:center;gap:10px">
            <span>${escapeHtml(label)}${escapeHtml(score)}</span>
            <small class="muted">${c.category_id}/${c.type_id}</small>
          </div>`;
        }).join("");
      dropdown.querySelectorAll(".cb-quick-cat-option").forEach((el, idx) => {
        el.onclick = () => { applySearchCategory(candidates[idx], item, noteEl, input); };
      });
    }
    openDropdown();
  }
}

async function applySearchCategory(cand, item, noteEl, inputEl) {
  if (!cand) return;
  const label = cand.title_zh || cand.title || `${cand.category_id} / ${cand.type_id}`;
  try {
    const r = await fetch(
      `${apiBase}/api/v1/shops/${item.shop_id}/pipeline/source-products/${item.source_product_id}/apply-category`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: String(cand.category_id),
          type_id: String(cand.type_id),
          title_zh: cand.title_zh || cand.title || "",
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "应用类目失败");
    const dot = document.querySelector("#cb-quick-category-block .cb-review-dot");
    const strong = document.getElementById("cb-quick-category-current");
    const chip = document.getElementById("cb-quick-category-status");
    if (dot) { dot.className = "cb-review-dot ok"; }
    if (strong) { strong.textContent = label; }
    if (chip) { chip.textContent = "已应用"; }
    if (noteEl) noteEl.textContent = `已应用类目：${label}。属性明细请进入编辑器查看。`;
    if (inputEl) {
      inputEl.value = label;
      const dropdown = document.getElementById("cb-quick-category-dropdown");
      if (dropdown) dropdown.style.display = "none";
    }
    toast(`已应用类目：${label}`, false);
  } catch (error) {
    toast(error.message || "应用类目失败", true);
  }
}

function bindQuickCategoryCandidates(candidates, item, noteEl) {
  document.querySelectorAll(".cb-quick-category-candidate").forEach(btn => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.index);
      const cand = candidates[idx];
      if (!cand) return;
      const originalText = btn.textContent;
      btn.disabled = true; btn.textContent = "应用中…";
      try {
        const r = await fetch(
          `${apiBase}/api/v1/shops/${item.shop_id}/pipeline/source-products/${item.source_product_id}/apply-category`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category_id: cand.category_id,
              type_id: cand.type_id,
              title_zh: cand.title_zh || cand.title || ""
            }),
          }
        );
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "应用类目失败");
        if (data.draft_id && !item.draft_id) { item.draft_id = data.draft_id; quickReviewItem = item; }
        const dot = document.querySelector("#cb-quick-category-block .cb-review-dot");
        const chip = document.querySelector("#cb-quick-category-block .cb-review-chip");
        const strong = document.querySelector("#cb-quick-category-block strong");
        if (dot) { dot.className = "cb-review-dot ok"; }
        if (chip) { chip.textContent = "已保存类目"; }
        if (strong) { strong.textContent = cand.title_zh || cand.title || `${cand.category_id} / ${cand.type_id}`; }
        if (noteEl) noteEl.textContent = "类目已保存到草稿；提交时以后台自动填充的属性为准，属性明细请进入编辑器确认。";
        toast("类目已保存", false);
      } catch (error) {
        toast(error.message || "应用类目失败", true);
      } finally {
        btn.disabled = false; btn.textContent = originalText;
      }
    };
  });
}

async function translateQuickReviewImages() {
  const item = quickReviewItem;
  const selected = [...document.querySelectorAll(".cb-quick-image-select:checked")]
    .map(input => Number(input.dataset.index));
  const fallbackImages = (quickReviewDetail?.media || []).filter(m => m.media_type === "image" && m.url).map(m => m.url);
  const sourceImages = quickReviewImagesLoaded ? quickReviewImages : fallbackImages;
  const urls = selected.map(index => sourceImages[index]).filter(Boolean);
  if (!urls.length) { toast("请先勾选需要翻译的图片", true); return; }
  const button = document.getElementById("cb-quick-translate-images");
  button.disabled = true; button.textContent = "翻译回填中…";
  const status = document.getElementById("cb-quick-translate-status");
  if (status) status.textContent = `正在提交 ${urls.length} 张图片到象寄翻译…`;
  try {
    if (!item?.draft_id) {
      const ensureResponse = await fetch(
        `${apiBase}/api/v1/shops/${item.shop_id}/pipeline/source-products/${item.source_product_id}/ensure-draft`,
        { method: "POST" }
      );
      const ensureData = await ensureResponse.json();
      if (!ensureResponse.ok) throw new Error(ensureData.detail || "快速建立图片草稿失败");
      item.draft_id = ensureData.draft_id;
      quickReviewItem = item;
    }
    // Reuse the same provider endpoint as the full editor. Quick review only
    // owns the selection UI; persistence remains the normal draft PUT flow.
    const response = await fetch(`${apiBase}/api/v1/image/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, source_lang: "CHS", target_lang: "RUS" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "翻译失败");
    const results = data.results || [];
    const successCount = results.filter(r => r.translated_url).length;
    const failedCount = results.length - successCount;
    const images = quickReviewImagesLoaded ? [...quickReviewImages] : [...(data.images || [])];
    results.forEach(result => {
      const originalUrl = result.original_url || result.source_url;
      if (!result.translated_url || !originalUrl) return;
      const idx = images.findIndex(u => u === originalUrl);
      if (idx >= 0) images[idx] = result.translated_url;
    });
    const saveResp = await fetch(
      `${apiBase}/api/v1/shops/${item.shop_id}/listing-drafts/${item.draft_id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      }
    );
    if (!saveResp.ok) {
      const sd = await saveResp.json();
      throw new Error(sd.detail || "保存翻译后图片失败");
    }
    quickReviewImages = images; quickReviewImagesLoaded = true;
    const successMessage = failedCount > 0
      ? `已翻译并回填 ${successCount} 张，失败 ${failedCount} 张，已保存到草稿`
      : `已翻译并回填 ${successCount} 张图片，已保存到草稿`;
    toast(successMessage, failedCount > 0);
    await window.window.__qrRefresh__ && window.__qrRefresh__();
    const refreshed = window.window.__qrItems__.find(row =>
      Number(row.source_product_id) === Number(item.source_product_id) && Number(row.shop_id) === Number(item.shop_id));
    if (refreshed) {
      quickReviewItem = refreshed;
      renderQuickReview(refreshed, quickReviewDetail);
      const resultStatus = document.getElementById("cb-quick-translate-status");
      if (resultStatus) {
        resultStatus.textContent = successMessage;
        resultStatus.className = failedCount ? "cb-review-note warn" : "cb-review-note success";
      }
    }
  } catch (error) {
    if (status) { status.textContent = error.message || "翻译失败"; status.className = "cb-review-note warn"; }
    toast(error.message || "图片翻译失败", true);
  } finally {
    button.disabled = false;
    updateQuickTranslateSelection();
  }
}

async function deleteQuickReviewImage(index) {
  const item = quickReviewItem;
  if (!item) return;
  if (!Number.isInteger(index) || !quickReviewImages[index]) return;
  const images = quickReviewImages.filter((_, i) => i !== index);
  try {
    if (!item.draft_id) {
      quickReviewImages = images; quickReviewImagesLoaded = true;
      renderQuickReview(item, quickReviewDetail);
      return;
    }
    const r = await fetch(`${apiBase}/api/v1/shops/${item.shop_id}/listing-drafts/${item.draft_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images }),
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.detail || "删除图片失败");
    }
    quickReviewImages = images; quickReviewImagesLoaded = true;
    renderQuickReview(item, quickReviewDetail);
  } catch (error) {
    toast(error.message || "删除图片失败", true);
  }
}

async function openQuickReview(item) {
  const dialog = document.getElementById("cb-quick-review");
  if (!dialog) return;
  closeImageDialogs();
  quickReviewItem = item;
  quickReviewImages = [];
  quickReviewImagesLoaded = false;
  quickReviewCategoryCandidates = [];
  const content = document.getElementById("cb-quick-review-content");
  content.innerHTML = '<p class="muted">正在读取商品审核信息…</p>';
  dialog.showModal();
  try {
    const r = await fetch(
      `${apiBase}/api/v1/shops/${item.shop_id}/pipeline/source-products/${item.source_product_id}`
    );
    const detail = await r.json();
    if (!r.ok) throw new Error(detail.detail || "读取商品失败");
    if (item.draft_id) {
      const draftResponse = await fetch(
        `${apiBase}/api/v1/shops/${item.shop_id}/listing-drafts/${item.draft_id}`
      );
      const draft = await draftResponse.json();
      if (draftResponse.ok) {
        quickReviewImages = (draft.images || []).filter(Boolean);
        quickReviewImagesLoaded = true;
      }
    }
    renderQuickReview(item, detail);
  } catch (error) {
    content.innerHTML = `<p class="muted">${escapeHtml(error.message || "读取失败")}</p>`;
  }
}

async function saveQuickReview() {
  const item = quickReviewItem;
  if (!item) return;
  const values = {
    weight_g: Number(document.getElementById("cb-quick-weight")?.value),
    length_mm: Number(document.getElementById("cb-quick-length")?.value),
    width_mm: Number(document.getElementById("cb-quick-width")?.value),
    height_mm: Number(document.getElementById("cb-quick-height")?.value),
  };
  if (Object.values(values).some(v => !Number.isFinite(v) || v <= 0)) {
    toast("请先填写完整尺重（g / mm）", true);
    return;
  }
  const button = document.getElementById("cb-quick-review-save");
  button.disabled = true; button.textContent = "保存并提交中…";
  try {
    if (!item.draft_id) {
      const ensureResponse = await fetch(
        `${apiBase}/api/v1/shops/${item.shop_id}/pipeline/source-products/${item.source_product_id}/ensure-draft`,
        { method: "POST" }
      );
      const ensureData = await ensureResponse.json();
      if (!ensureResponse.ok) throw new Error(ensureData.detail || "快速建立草稿失败");
      item.draft_id = ensureData.draft_id;
      quickReviewItem = item;
    }
    const r = await fetch(
      `${apiBase}/api/v1/shops/${item.shop_id}/pipeline/source-products/${item.source_product_id}/package`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "保存尺重失败");
    const submitResponse = await fetch(
      `${apiBase}/api/v1/shops/${item.shop_id}/listing-drafts/${item.draft_id}/submit`,
      { method: "POST" }
    );
    const submitData = await submitResponse.json();
    if (!submitResponse.ok) throw new Error(
      `尺重已保存，但提交 Ozon 失败：${submitData.detail || "请进入编辑器修正后重试"}`
    );
    const priceMessage = data.auto_priced_variants ? `，已自动生成 ${data.auto_priced_variants} 个 SKU 的售价` : "";
    toast(`已保存尺重并提交 Ozon${priceMessage}`, false);
    document.getElementById("cb-quick-review").close();
    const currentIndex = window.window.__qrItems__.findIndex(row =>
      Number(row.source_product_id) === Number(item.source_product_id) && Number(row.shop_id) === Number(item.shop_id));
    await window.window.__qrRefresh__ && window.__qrRefresh__();
    const next = window.window.__qrItems__.slice(currentIndex + 1).find(row => row.draft_status !== "已提交")
      || window.window.__qrItems__.find(row => row.draft_status !== "已提交");
    if (next) setTimeout(() => openQuickReview(next), 120);
  } catch (error) {
    toast(error.message || "保存并提交失败", true);
  } finally {
    button.disabled = false;
    button.textContent = "保存尺重并提交 Ozon";
  }
}

function setupQuickReview() {
  const dialog = document.getElementById("cb-quick-review");
  if (!dialog || dialog.dataset.ready === "1") return;
  dialog.dataset.ready = "1";
  dialog.addEventListener("toggle", () => { if (dialog.open) closeImageDialogs(); });
  document.getElementById("cb-quick-review-close").onclick = () => dialog.close();
  document.getElementById("cb-quick-review-save").onclick = saveQuickReview;
  document.getElementById("cb-quick-review-editor").onclick = () => {
    if (!quickReviewItem) return;
    const item = quickReviewItem;
    let url = `./listing-editor.html?shop=${item.shop_id}&sp=${item.source_product_id}&returnTo=collection-box`;
    if (item.draft_id) url += `&draft=${item.draft_id}`;
    window.location.href = url;
  };
}


// auto-inject quick review buttons into collection box list
(function() {
  function inject() {
    var rows = document.querySelectorAll('#cb-rows tr');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector('.cb-quick-review')) continue;
      var editBtn = row.querySelector('.cb-edit');
      if (!editBtn) continue;
      var sp = editBtn.dataset.sp;
      var shop = editBtn.dataset.shop;
      var draft = editBtn.dataset.draft || '';
      var qrBtn = document.createElement('button');
      qrBtn.className = 'link cb-quick-review';
      qrBtn.type = 'button';
      qrBtn.dataset.sp = sp;
      qrBtn.dataset.shop = shop;
      qrBtn.dataset.draft = draft;
      qrBtn.textContent = '快速审核';
      (function(spVal, shopVal) {
        qrBtn.addEventListener('click', function() {
          var spNum = Number(spVal);
          var shopNum = Number(shopVal);
          var items = window.window.__qrItems__ || [];
          var rowItem = null;
          for (var j = 0; j < items.length; j++) {
            if (Number(items[j].source_product_id) === spNum && Number(items[j].shop_id) === shopNum) {
              rowItem = items[j];
              break;
            }
          }
          if (rowItem && typeof openQuickReview === 'function') {
            openQuickReview(rowItem);
          }
        });
      })(sp, shop);
      var td = editBtn.parentElement;
      td.insertBefore(qrBtn, editBtn);
      td.insertBefore(document.createTextNode(' '), editBtn);
    }
  }
  function setup() {
    if (typeof setupQuickReview === 'function') setupQuickReview();
    inject();
    var cbRows = document.getElementById('cb-rows');
    if (cbRows) {
      var observer = new MutationObserver(function() { inject(); });
      observer.observe(cbRows, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
