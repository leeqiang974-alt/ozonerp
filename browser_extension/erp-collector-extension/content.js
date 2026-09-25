// ============ v0.7.61 搜索页独立注入（放在最开头，不依赖任何代码） ============
(function(){
  if (!location.hostname.includes("ozon.ru")) return;
  const isSearch = location.pathname.includes("/category") || location.search.includes("text=") || location.pathname.includes("/search");
  if (!isSearch) return;
  let totalRequests = 0;
  const MAX_REQUESTS = 25;
  let scrollTimer = null;
  let running = false;
  async function processNewCards() {
    if (running || totalRequests >= MAX_REQUESTS) return;
    running = true;
    const cards = Array.from(document.querySelectorAll('a[href*="/product/"]')).map(a => {
      const m = a.href.match(/-(\d{6,})/);
      if (!m) return null;
      let root = a.closest('.tile-clickable-element, [class*="tile"]') || a.parentElement?.parentElement?.parentElement;
      return root && !root.dataset.ozonInj ? { pid: m[1], root } : null;
    }).filter(Boolean).slice(0,8);
    if (!cards.length) { running = false; return; }
    const pids = [...new Set(cards.map(c=>c.pid))].slice(0, Math.min(cards.length, MAX_REQUESTS - totalRequests));
    if (!pids.length) { running = false; return; }
    totalRequests += pids.length;
    const map = {};
    const sleep = ms => new Promise(r=>setTimeout(r,ms));
    for (let i=0;i<pids.length;i+=2) {
      const batch = pids.slice(i,i+2);
      const res = await Promise.all(batch.map(async pid=>{
        try {
          await sleep(1000+Math.random()*800);
          const resp = await chrome.runtime.sendMessage({type:"OZON_FETCH_SALES_DATA",productId:pid});
          return [pid, resp?.ok ? resp.data?.items?.[0] : null];
        } catch(e){ return [pid,null]; }
      }));
      res.forEach(([pid,row])=>{ if(row) map[pid]=row; });
      await sleep(1800+Math.random()*1000);
    }
    cards.forEach(c=>{
      c.root.dataset.ozonInj = "1";
      const row = map[c.pid];
      const b = document.createElement("div");
      b.style.cssText = "margin:6px 0;padding:7px;background:#f0f5ff;border-radius:5px;font-size:10px;line-height:1.45;color:#333;";
      if (!row) {
        b.innerHTML = `<div style="color:#999;">暂无销量数据</div>`;
      } else {
        const sales = parseInt(row.soldCount || 0);
        const revenue = Math.round(parseFloat(row.gmvSum || 0)).toLocaleString();
        const daily = Math.round(parseFloat(row.avgOrdersOnAccDays || 0)*10)/10;
        const visitors = parseInt(row.sessionCount || 0);
        const cartRate = Math.round(parseFloat(row.convToCartPdp || 0)*10)/10;
        const brand = row.brand || "无品牌";
        const minPrice = parseInt(row.minSellerPrice || 0);
        b.innerHTML = `<div style="display:flex;justify-content:space-between;font-weight:700;color:#005bff;font-size:11px;"><span>月销 ${sales}件</span><span>${revenue} ₽</span></div><div style="margin:2px 0;color:#444;">日销${daily} · 访客${visitors} · 加购${cartRate}%</div><div style="color:#444;">品牌:${brand} · 最低 ${minPrice}₽</div><div style="color:#666;">发货:${row.salesSchema||"-"} · 卖家:${row.sellerId||"-"}</div><div style="color:#999;margin-top:2px;">SKU:${c.pid}</div>`;
      }
      c.root.appendChild(b);
    });
    running = false;
  }
  setTimeout(processNewCards, 5000);
  window.addEventListener("scroll", () => {
    if (totalRequests >= MAX_REQUESTS) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(processNewCards, 3000);
  });
})();
// ============ 全局：获取 Ozon 商品销量数据（v0.7.44 对标胜利者插件） ============
async function fetchOzonSalesData(productId) {
  if (!productId) return null;
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "OZON_FETCH_SALES_DATA",
      productId: productId
    });
    console.log("[Ozon ERP] 接口返回:", resp);
    if (!resp || !resp.ok) {
      console.log("[Ozon ERP] 接口失败:", resp?.error);
      return null;
    }
    // 解析seller返回的what_to_sell数据（实测接口直接返回顶层items）
    const data = resp.data;
    const rows = data?.items || data?.result?.items || [];
    if (!Array.isArray(rows) || rows.length === 0) return {
      monthlySales: 0,
      monthlyRevenue: 0,
      dailySales: 0,
      note: "该商品为新品/无销量数据"
    };
    const row = rows[0];
    return {
      monthlySales: parseInt(row.soldCount || 0),
      monthlyRevenue: Math.round(parseFloat(row.gmvSum || 0)),
      dailySales: Math.round(parseFloat(row.avgOrdersOnAccDays || 0) * 10) / 10,
      visitors: parseInt(row.sessionCount || 0),
      cartRate: Math.round(parseFloat(row.convToCartPdp || 0) * 100) / 100,
      avgPrice: Math.round(parseFloat(row.avgPrice || 0)),
      stock: parseInt(row.stock || 0),
      drr: Math.round(parseFloat(row.drr || 0) * 100) / 100,
      brand: row.brand || "无品牌",
      category: row.category3 || row.category1 || "-",
      minSellerPrice: parseInt(row.minSellerPrice || 0),
      sellerId: row.sellerId || "-",
      salesType: row.salesSchema || "-",
      blocked: row.blockedBySeller ? "是（被卖家屏蔽）" : "否"
    };
  } catch (e) {
    console.log("[Ozon ERP] 异常:", e.message);
    return null;
  }
}

async function initOzonProductSidebar() {
  if (!location.hostname.includes("ozon.ru") || !location.pathname.includes("/product/")) return;
  if (document.getElementById("ozon-erp-sidebar")) return;
  const productId = (location.pathname.match(/-(\d{6,})/) || [])[1];
  if (!productId) return;
  const sidebar = document.createElement("div");
  sidebar.id = "ozon-erp-sidebar";
  sidebar.style.cssText = "position:fixed;top:20px;right:20px;width:320px;background:white;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.15);z-index:99998;padding:16px;font-family:sans-serif;max-height:90vh;overflow-y:auto;";
  sidebar.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><div style="font-weight:600;font-size:16px;color:#333;">📊 Ozon ERP 数据</div><button id="ozon-erp-sidebar-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#999;">×</button></div><div id="ozon-erp-sidebar-content" style="font-size:13px;color:#666;"><div style="text-align:center;padding:20px;color:#999;">⏳ 正在加载数据...</div></div><div id="ozon-erp-sidebar-actions" style="margin-top:12px;padding-top:10px;border-top:1px solid #eee;"><button id="ozon-mvideo-preview-button" style="width:100%;border:1px solid #7c3aed;background:#f5f3ff;color:#5b21b6;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:600;cursor:pointer;">M.Video 单SKU预览</button><div id="ozon-mvideo-single-preview" style="display:none;margin-top:8px;border:1px solid #ddd6fe;background:#faf5ff;border-radius:8px;padding:9px;font-size:12px;color:#4c1d95;"></div><div id="ozon-embedded-collector" style="margin-top:10px;border:1px solid #f87171;border-radius:8px;overflow:hidden;"><div style="padding:7px 9px;background:#dc2626;color:#fff;font-size:12px;font-weight:700;">Ozon 当前商品采集</div><div style="padding:9px;background:#fff5f5;"><select id="ozon-embedded-store" style="width:100%;box-sizing:border-box;border:1px solid #fca5a5;border-radius:6px;padding:6px;font-size:12px;background:#fff;color:#333;"></select><button id="ozon-embedded-collect" style="width:100%;margin-top:7px;border:none;border-radius:6px;padding:7px;background:#dc2626;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">采集当前商品</button><div id="ozon-embedded-status" style="margin-top:7px;min-height:16px;font-size:11px;line-height:1.4;color:#7f1d1d;"></div></div></div></div>`;
  document.body.appendChild(sidebar);
  document.getElementById("ozon-erp-sidebar-close").addEventListener("click", () => sidebar.remove());
  setupMvideoSinglePreview(sidebar, productId);
  setupEmbeddedOzonCollector(sidebar);
  fetchOzonSalesData(productId).then((data) => {
    const content = document.getElementById("ozon-erp-sidebar-content");
    if (!data) {
      content.innerHTML = `<div style="text-align:center;padding:20px;color:#e53e3e;">❌ 请保持卖家后台标签页打开并登录（seller.ozonru.cn 或 seller.ozon.ru）</div>`;
      return;
    }
    content.innerHTML = `
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">品牌</span><span style="font-weight:500;">${data.brand || "-"}</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">类目</span><span style="font-weight:500;">${data.category || "-"}</span></div>
<div style="margin:15px 0;height:1px;background:#eee;"></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">月销量</span><span style="font-weight:600;color:#005bff;">${data.monthlySales || 0} 件</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">月销售额</span><span style="font-weight:600;color:#005bff;">${(data.monthlyRevenue || 0).toLocaleString()} ₽</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">日销量</span><span style="font-weight:600;">${data.dailySales || 0} 件</span></div>
<div style="margin:15px 0;height:1px;background:#eee;"></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">月访客数</span><span>${(data.visitors || 0).toLocaleString()}</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">详情加购率</span><span>${data.cartRate || 0}%</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">均价</span><span>${data.avgPrice || 0} ₽</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">当前库存</span><span>${data.stock || 0} 件</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">广告费率DRR</span><span>${data.drr || 0}%</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">最低卖家价</span><span>${data.minSellerPrice || 0} ₽</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">卖家ID</span><span>${data.sellerId}</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">发货模式</span><span>${data.salesType}</span></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">是否被屏蔽</span><span style="color:#e53e3e;">${data.blocked}</span></div>
${data.note ? `<div style="margin:8px 0;color:#999;font-size:12px;">${data.note}</div>` : ""}
<div style="margin:15px 0;height:1px;background:#eee;"></div>
<div style="margin:8px 0;display:flex;justify-content:space-between;"><span style="color:#999;">商品ID</span><span>${productId}</span></div>
`;
  });
}

function toFiniteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!text) return null;
  let normalized = text;
  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized)) {
    normalized = normalized.replace(/,/g, "");
  } else {
    normalized = normalized.replace(",", ".");
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = toFiniteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function mmToCm(value) {
  const number = toFiniteNumber(value);
  return number === null ? null : number / 10;
}

function gToKg(value) {
  const number = toFiniteNumber(value);
  return number === null ? null : number / 1000;
}

function createDefaultMvideoPricingParams() {
  return {
    cnyToRub: 13.2,
    usdToRub: 95,
    targetMargin: 0.25,
    categoryCommissionRate: 0.15,
    acquiringFeeRate: 0.015,
    crossBorderFeeRate: 0.01,
    advertisingRate: 0,
    returnLossRate: 0,
    labelingFeeCny: 1.5,
    handlingFeeUsd: 0.5,
    channel: "economy",
    economy: { perKgUsd: 4.2, per100gUsd: 0.42 },
    express: { perKgUsd: 7.5, per100gUsd: 0.75 },
    localDelivery: { upTo1LRub: 50, upTo2LRub: 100, extraPerLRub: 4, capRub: 1490 },
  };
}

function mergeMvideoPricingParams(overrides = {}) {
  const defaults = createDefaultMvideoPricingParams();
  return {
    ...defaults,
    ...overrides,
    channel: overrides.channel || defaults.channel,
    economy: { ...defaults.economy, ...overrides.economy },
    express: { ...defaults.express, ...overrides.express },
    localDelivery: { ...defaults.localDelivery, ...overrides.localDelivery },
  };
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function mvideoInternationalFreightUsd(weightKg, channel, params) {
  const weight = positiveNumber(weightKg);
  if (weight === null) return null;
  const rate = channel === "express" ? params.express : params.economy;
  if (weight < 1) return Math.ceil((weight * 1000) / 100) * rate.per100gUsd;
  return weight * rate.perKgUsd;
}

function mvideoPackageVolume(lengthCm, widthCm, heightCm) {
  const length = positiveNumber(lengthCm);
  const width = positiveNumber(widthCm);
  const height = positiveNumber(heightCm);
  if (length === null || width === null || height === null) return null;
  const rawVolumeL = (length * width * height) / 1000;
  return {
    rawVolumeL,
    billVolumeL: Math.max(1, Math.ceil(rawVolumeL - 1e-9)),
  };
}

function mvideoLocalDeliveryRub(billVolumeL, params) {
  const billVolume = positiveNumber(billVolumeL);
  if (billVolume === null || billVolume <= 0) return null;
  let fee;
  if (billVolume <= 1) fee = params.localDelivery.upTo1LRub;
  else if (billVolume <= 2) fee = params.localDelivery.upTo2LRub;
  else fee = params.localDelivery.upTo2LRub + (billVolume - 2) * params.localDelivery.extraPerLRub;
  return Math.min(fee, params.localDelivery.capRub);
}

function calculateMvideoPrice(input = {}) {
  const params = mergeMvideoPricingParams(input.params);
  const purchaseCostCny = positiveNumber(input.purchaseCostCny);
  const lengthCm = positiveNumber(input.lengthCm);
  const widthCm = positiveNumber(input.widthCm);
  const heightCm = positiveNumber(input.heightCm);
  const weightKg = positiveNumber(input.weightKg);
  const targetMargin = toFiniteNumber(input.targetMargin ?? params.targetMargin);
  const categoryCommissionRate = toFiniteNumber(input.categoryCommissionRate ?? params.categoryCommissionRate);
  const acquiringFeeRate = toFiniteNumber(input.acquiringFeeRate ?? params.acquiringFeeRate);
  const crossBorderFeeRate = toFiniteNumber(input.crossBorderFeeRate ?? params.crossBorderFeeRate);
  const advertisingRate = toFiniteNumber(input.advertisingRate ?? params.advertisingRate);
  const returnLossRate = toFiniteNumber(input.returnLossRate ?? params.returnLossRate);
  const channel = String(input.channel || params.channel);
  const errors = [];
  if (purchaseCostCny === null) errors.push("CNY 采购价必须是大于 0 的真实采购成本");
  if (lengthCm === null) errors.push("包装长度必须是大于 0 的 cm 数值");
  if (widthCm === null) errors.push("包装宽度必须是大于 0 的 cm 数值");
  if (heightCm === null) errors.push("包装高度必须是大于 0 的 cm 数值");
  if (weightKg === null) errors.push("包装重量必须是大于 0 的 kg 数值");
  if (targetMargin === null || targetMargin < 0 || targetMargin >= 1) errors.push("目标净利率必须是 0% 到 100% 之间的数值");
  for (const [label, rate] of [
    ["类目佣金率", categoryCommissionRate],
    ["收单手续费率", acquiringFeeRate],
    ["境外交易手续费率", crossBorderFeeRate],
    ["广告费率", advertisingRate],
    ["退货损耗率", returnLossRate],
  ]) {
    if (rate === null || rate < 0 || rate >= 1) errors.push(`${label}必须是 0% 到 100% 之间的数值`);
  }
  if (!["economy", "express"].includes(channel)) errors.push("物流渠道必须是 Economy 或 Express");
  if (errors.length) return { ok: false, errors };

  const volume = mvideoPackageVolume(lengthCm, widthCm, heightCm);
  const weightG = weightKg * 1000;
  const freightUsd = mvideoInternationalFreightUsd(weightKg, channel, params);
  const freightRub = freightUsd * params.usdToRub;
  const handlingRub = params.handlingFeeUsd * params.usdToRub;
  const localDeliveryRub = mvideoLocalDeliveryRub(volume.billVolumeL, params);
  const labelingFeeRub = params.labelingFeeCny * params.cnyToRub;
  const goodsCostRub = purchaseCostCny * params.cnyToRub;
  const fixedCostRub = goodsCostRub + freightRub + handlingRub + localDeliveryRub + labelingFeeRub;
  const variableRate = categoryCommissionRate + acquiringFeeRate + crossBorderFeeRate + advertisingRate + returnLossRate;
  const breakEvenDenominator = 1 - variableRate;
  const targetDenominator = breakEvenDenominator - targetMargin;
  if (breakEvenDenominator <= 0) return { ok: false, errors: ["变动费率合计已达到或超过 100%，无法形成有效售价"] };
  if (targetDenominator <= 0) return { ok: false, errors: ["目标净利率过高，在当前费率下无法形成有效售价"] };

  const quote = {
    purchaseCostCny,
    packaging: { lengthCm, widthCm, heightCm, weightKg },
    channel,
    categoryCommissionRate,
    targetMargin,
    weightG,
    rawVolumeL: volume.rawVolumeL,
    billVolumeL: volume.billVolumeL,
    goodsCostRub,
    freightUsd,
    freightRub,
    handlingRub,
    localDeliveryRub,
    labelingFeeRub,
    fixedCostRub,
    variableRate,
    breakEvenPriceRub: roundMoney(fixedCostRub / breakEvenDenominator),
    targetPriceRub: roundMoney(fixedCostRub / targetDenominator),
  };
  return { ok: true, quote };
}

function buildMvideoReviewGates(review = {}, priceConfirmed = false) {
  const purchaseCostCny = positiveNumber(review.purchaseCostCny);
  const packaging = review.packaging || {};
  const packageComplete = Boolean(review.packageComplete) || ["lengthCm", "widthCm", "heightCm", "weightKg"].every((key) => positiveNumber(packaging[key]) !== null);
  const inventory = positiveNumber(review.inventory);
  const pricing = review.pricing;
  const gates = [];
  const addGate = (label, ok, reason) => gates.push({ label, ok: Boolean(ok), reason: ok ? "" : reason });
  addGate("CNY 采购价", purchaseCostCny !== null, "缺少人工核对的 CNY 采购成本");
  if (!pricing?.ok) {
    addGate("M.Video RUB 售价", false, pricing?.errors?.[0] || "需由定价模型根据尺重和 CNY 采购价生成");
  } else {
    addGate("M.Video RUB 售价", Boolean(priceConfirmed), priceConfirmed ? "" : "目标售价生成后必须人工明确确认");
  }
  addGate("库存", inventory !== null, "发布前必须确认 M.Video 库存");
  addGate("包装尺重", packageComplete, "包装长宽高和重量必须为有效正数（mm→cm，g→kg）");
  addGate("标题重构", false, "待模型生成无品牌标题，允许保留型号");
  addGate("描述重构", false, "待模型生成无品牌描述，允许保留型号");
  addGate("类目合规预检", false, "待按类目预检证书、TN VED、品牌授权等要求");
  return gates;
}

function selectSingleOzonSku(variants = [], preferredSkuId = "") {
  if (!Array.isArray(variants)) return { ok: false, error: "SKU 数据格式不正确" };
  const preferred = String(preferredSkuId ?? "").trim();
  if (preferred) {
    const exact = variants.filter((sku) => String(sku?.skuId ?? "").trim() === preferred);
    if (exact.length === 1) return { ok: true, sku: exact[0] };
    if (exact.length > 1) return { ok: false, error: `当前 SKU ${preferred} 在采集结果中重复` };
  }
  if (variants.length === 1) return { ok: true, sku: variants[0] };
  if (!variants.length) return { ok: false, error: "未采集到当前商品 SKU" };
  const candidateIds = variants.map((sku) => String(sku?.skuId || "未知")).join(", ");
  return { ok: false, error: `无法仅凭当前链接确定唯一 SKU；当前 ${preferred || "未知"}，候选 ${candidateIds}` };
}

function skuOrPackageNumber(sku, packageInfo, skuKey, packageKey) {
  return positiveNumber(sku?.[skuKey]) ?? positiveNumber(packageInfo?.[packageKey]);
}

function buildMvideoSingleSkuPreviewModel(payload = {}, sku = {}, currentSkuId = "", reviewInput = {}) {
  const packageInfo = payload.packageInfo || {};
  const packaging = {
    lengthCm: mmToCm(skuOrPackageNumber(sku, packageInfo, "lengthMm", "lengthMm")),
    widthCm: mmToCm(skuOrPackageNumber(sku, packageInfo, "widthMm", "widthMm")),
    heightCm: mmToCm(skuOrPackageNumber(sku, packageInfo, "heightMm", "heightMm")),
    weightKg: gToKg(skuOrPackageNumber(sku, packageInfo, "weightG", "weightG")),
  };
  const marketPriceRub = positiveNumber(sku.priceRub) ?? positiveNumber(payload.price);
  const purchaseCostCny = positiveNumber(reviewInput.purchaseCostCny);
  const inventory = positiveNumber(reviewInput.inventory);
  const packageComplete = Object.values(packaging).every((value) => value !== null && value > 0);
  const pricing = packageComplete
    ? calculateMvideoPrice({ purchaseCostCny, ...packaging, channel: reviewInput.channel })
    : { ok: false, errors: ["缺少完整包装尺重，无法计算 M.Video RUB 售价"] };
  const salePriceRub = pricing.ok ? pricing.quote.targetPriceRub : null;
  const priceConfirmed = Boolean(reviewInput.priceConfirmed) && pricing.ok;
  const gates = buildMvideoReviewGates(
    { purchaseCostCny, packaging, packageComplete, inventory, pricing },
    priceConfirmed,
  );
  return {
    dryRun: true,
    currentSkuId: String(currentSkuId || ""),
    skuId: String(sku.skuId || ""),
    spec: cleanText(sku.spec || ""),
    sourceTitle: cleanText(payload.title || ""),
    sourceCategory: cleanText(payload.category || ""),
    marketPriceRub,
    marketPriceNote: "Ozon RUB 仅作市场价格证据，不进入 CNY 采购成本",
    packaging,
    brand: "无品牌",
    titleStatus: "待模型重构（去除品牌，保留型号）",
    descriptionStatus: "待模型重构（去除品牌，保留型号）",
    complianceStatus: "待按类目预检：证书、TN VED、品牌授权等",
    purchaseCostCny,
    salePriceRub,
    inventory,
    priceConfirmed,
    pricing,
    gates,
    publishReady: gates.every((gate) => gate.ok),
  };
}

function formatPreviewNumber(value, unit = "") {
  if (value === null || value === undefined) return "未获取";
  const normalized = Number(value.toFixed(4));
  return `${normalized.toLocaleString("zh-CN")}${unit ? ` ${unit}` : ""}`;
}

function previewRow(label, value) {
  return `<div style="display:flex;justify-content:space-between;gap:8px;margin:5px 0;"><span style="color:#7c3aed;flex:0 0 82px;">${escapeHtml(label)}</span><span style="text-align:right;color:#312e81;font-weight:600;word-break:break-word;">${value}</span></div>`;
}

function renderMvideoGateRows(gates = []) {
  return gates.map((gate) => `<div style="display:flex;justify-content:space-between;gap:8px;margin:5px 0;color:${gate.ok ? "#15803d" : "#b42318"};"><span>${gate.ok ? "✅" : "⛔"} ${escapeHtml(gate.label)}</span><span style="text-align:right;font-weight:600;">${gate.ok ? "通过" : escapeHtml(gate.reason)}</span></div>`).join("");
}

function renderMvideoSinglePreview(model) {
  const quote = model.pricing?.ok ? model.pricing.quote : null;
  const gateRows = renderMvideoGateRows(model.gates);
  return `<div style="padding:6px;margin-bottom:7px;border-radius:6px;background:#fef3c7;color:#92400e;font-weight:700;">Dry-run 预览：不会真实发布</div>
${previewRow("当前SKU", escapeHtml(model.currentSkuId || model.skuId))}
${previewRow("规格", escapeHtml(model.spec || "-"))}
${previewRow("来源标题", escapeHtml(model.sourceTitle || "-"))}
${previewRow("来源类目", escapeHtml(model.sourceCategory || "-"))}
${previewRow("Ozon市场价", escapeHtml(formatPreviewNumber(model.marketPriceRub, "₽")))}
<div style="margin:4px 0 8px;color:#b45309;line-height:1.4;">${escapeHtml(model.marketPriceNote)}</div>
${previewRow("长×宽×高", escapeHtml(`${formatPreviewNumber(model.packaging.lengthCm, "cm")} × ${formatPreviewNumber(model.packaging.widthCm, "cm")} × ${formatPreviewNumber(model.packaging.heightCm, "cm")}`))}
${previewRow("重量", escapeHtml(formatPreviewNumber(model.packaging.weightKg, "kg")))}
<form id="mvideo-review-form" style="margin:7px 0;padding:8px 0;border-top:1px solid #ddd6fe;border-bottom:1px solid #ddd6fe;">
<label style="display:block;margin-bottom:7px;color:#5b21b6;font-weight:700;">CNY 采购价
<input id="mvideo-purchase-cost" type="number" min="0" step="0.01" inputmode="decimal" value="${model.purchaseCostCny === null ? "" : model.purchaseCostCny}" placeholder="人工核对后的人民币采购价" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;border:1px solid #c4b5fd;border-radius:6px;padding:6px;font-size:12px;color:#312e81;">
</label>
<label style="display:block;margin-bottom:7px;color:#5b21b6;font-weight:700;">M.Video 库存
<input id="mvideo-inventory" type="number" min="1" step="1" inputmode="numeric" value="${model.inventory === null ? "" : model.inventory}" placeholder="发布前可售库存" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;border:1px solid #c4b5fd;border-radius:6px;padding:6px;font-size:12px;color:#312e81;">
</label>
${previewRow("保本售价", `<span id="mvideo-break-even-price">${quote ? escapeHtml(formatPreviewNumber(quote.breakEvenPriceRub, "₽")) : "待计算"}</span>`)}
${previewRow("目标售价", `<span id="mvideo-target-price" style="color:#7c3aed;">${quote ? escapeHtml(formatPreviewNumber(quote.targetPriceRub, "₽")) : "待计算"}</span>`)}
<div id="mvideo-pricing-error" style="display:${quote ? "none" : "block"};margin:6px 0;color:#b42318;line-height:1.4;">${escapeHtml(model.pricing?.ok === false ? model.pricing.errors[0] : "")}</div>
<label style="display:flex;gap:6px;align-items:flex-start;margin-top:7px;color:#3730a3;font-weight:600;line-height:1.4;">
<input id="mvideo-price-confirmed" type="checkbox" style="margin-top:2px;" ${quote ? "" : "disabled"} ${model.priceConfirmed ? "checked" : ""}>
<span>我确认按上述 RUB 目标售价和库存发布</span>
</label>
</form>
${previewRow("品牌", escapeHtml(model.brand))}
${previewRow("标题", escapeHtml(model.titleStatus))}
${previewRow("描述", escapeHtml(model.descriptionStatus))}
${previewRow("合规", escapeHtml(model.complianceStatus))}
<div id="mvideo-gate-rows" style="margin-top:8px;padding-top:7px;border-top:1px solid #ddd6fe;">${gateRows}</div>
<div id="mvideo-single-preview-status" style="margin-top:8px;color:${model.publishReady ? "#15803d" : "#b42318"};font-weight:700;">${model.publishReady ? "门禁通过" : "发布门禁未通过"}</div>`;
}

function updateMvideoSinglePreview(panel, model) {
  const quote = model.pricing?.ok ? model.pricing.quote : null;
  const breakEvenEl = panel.querySelector("#mvideo-break-even-price");
  const targetEl = panel.querySelector("#mvideo-target-price");
  const errorEl = panel.querySelector("#mvideo-pricing-error");
  const confirmEl = panel.querySelector("#mvideo-price-confirmed");
  if (breakEvenEl) breakEvenEl.textContent = quote ? formatPreviewNumber(quote.breakEvenPriceRub, "₽") : "待计算";
  if (targetEl) targetEl.textContent = quote ? formatPreviewNumber(quote.targetPriceRub, "₽") : "待计算";
  if (errorEl) {
    errorEl.textContent = model.pricing?.ok === false ? model.pricing.errors[0] : "";
    errorEl.style.display = quote ? "none" : "block";
  }
  if (confirmEl) {
    confirmEl.disabled = !quote;
    confirmEl.checked = Boolean(quote && model.priceConfirmed);
  }
  const gateRowsEl = panel.querySelector("#mvideo-gate-rows");
  if (gateRowsEl) gateRowsEl.innerHTML = renderMvideoGateRows(model.gates);
  const statusText = panel.querySelector("#mvideo-single-preview-status");
  if (statusText) {
    statusText.textContent = model.publishReady ? "门禁通过" : "发布门禁未通过";
    statusText.style.color = model.publishReady ? "#15803d" : "#b42318";
  }
}

async function setupMvideoSinglePreview(root, currentSkuId) {
  const button = root.querySelector("#ozon-mvideo-preview-button");
  const panel = root.querySelector("#ozon-mvideo-single-preview");
  if (!button || !panel) return;
  const sourceContext = {
    payload: null,
    sku: null,
    currentSkuId: String(currentSkuId || ""),
    channel: "economy",
  };
  const reviewState = {
    purchaseCostCny: "",
    inventory: "",
    priceConfirmed: false,
  };
  const buildCurrentModel = () => {
    if (!sourceContext.payload || !sourceContext.sku) return null;
    return buildMvideoSingleSkuPreviewModel(
      sourceContext.payload,
      sourceContext.sku,
      sourceContext.currentSkuId,
      { ...reviewState, channel: sourceContext.channel },
    );
  };
  const refreshPreview = () => {
    const model = buildCurrentModel();
    if (model) updateMvideoSinglePreview(panel, model);
  };
  panel.addEventListener("submit", (event) => {
    if (event.target?.id === "mvideo-review-form") event.preventDefault();
  });
  panel.addEventListener("input", (event) => {
    if (event.target?.id === "mvideo-purchase-cost") {
      reviewState.purchaseCostCny = event.target.value;
      reviewState.priceConfirmed = false;
      refreshPreview();
    } else if (event.target?.id === "mvideo-inventory") {
      reviewState.inventory = event.target.value;
      reviewState.priceConfirmed = false;
      refreshPreview();
    }
  });
  panel.addEventListener("change", (event) => {
    if (event.target?.id === "mvideo-price-confirmed") {
      reviewState.priceConfirmed = Boolean(event.target.checked);
      refreshPreview();
    }
  });
  let loaded = false;
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return;
    if (panel.style.display !== "none") {
      panel.style.display = "none";
      button.textContent = "M.Video 单SKU预览";
      return;
    }
    panel.style.display = "block";
    button.textContent = "收起 M.Video 预览";
    if (loaded) return;
    busy = true;
    button.disabled = true;
    panel.innerHTML = `<div style="color:#6d28d9;">正在采集并匹配当前单 SKU...</div>`;
    try {
      if (pageNeedsOzonHumanCheck()) throw new Error("当前 Ozon 页面需要登录或人工验证，请完成后再试");
      const payload = await collectOzonDetail();
      if (!payload.title) throw new Error("商品标题尚未加载完成，请等待页面加载后重试");
      const resolvedSkuId = String(currentSkuId || ozonProductIdFromUrl(location.href));
      const selected = selectSingleOzonSku(payload.skuVariants || [], resolvedSkuId);
      if (!selected.ok) throw new Error(selected.error);
      sourceContext.payload = payload;
      sourceContext.sku = selected.sku;
      sourceContext.currentSkuId = resolvedSkuId;
      panel.innerHTML = renderMvideoSinglePreview(buildCurrentModel());
      loaded = true;
    } catch (error) {
      loaded = false;
      panel.innerHTML = `<div style="color:#b42318;line-height:1.5;">${escapeHtml(error?.message || "单 SKU 预览失败")}</div>`;
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
}

async function setupEmbeddedOzonCollector(root) {
  const select = root.querySelector("#ozon-embedded-store");
  const button = root.querySelector("#ozon-embedded-collect");
  const status = root.querySelector("#ozon-embedded-status");
  if (!select || !button || !status) return;
  await loadStoreOptions(select, status);
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return;
    const storeId = String(select.value || "").trim();
    if (!storeId) {
      status.textContent = "请先选择 Ozon 店铺";
      status.style.color = "#b42318";
      return;
    }
    if (pageNeedsOzonHumanCheck()) {
      status.textContent = "当前页面需要登录或人工验证，请完成后再采集";
      status.style.color = "#b42318";
      return;
    }
    busy = true;
    button.disabled = true;
    status.style.color = "#7f1d1d";
    status.textContent = "正在采集当前商品...";
    try {
      const payload = await collectOzonDetail();
      if (!payload.title) throw new Error("商品标题尚未加载完成，请等待页面加载后重试");
      const { baseUrl } = await getActiveStoreId();
      const result = await erpRequest("/api/ozon-learning/extension/detail-result", {
        method: "POST",
        body: { storeId, payload },
      }, baseUrl);
      if (!result?.ok || result.ingested !== true) throw new Error(result?.error || "ERP 未接收该商品");
      const skuCount = Array.isArray(payload.skuVariants) ? payload.skuVariants.length : 0;
      status.style.color = "#15803d";
      status.textContent = `已采集并回传：${skuCount} 个 SKU`;
    } catch (error) {
      status.style.color = "#b42318";
      status.textContent = `采集失败：${error?.message || "未知错误"}`;
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
}
setTimeout(initOzonProductSidebar, 1500);

let pageContext = null;
let floatingState = { minimized: false, selectedSkuKeys: new Set(), allSelected: true };
const SHOP_SCAN_STORAGE_KEY = "ozonErp1688ShopScan";
// Must change with every collector behaviour change. popup.js uses this
// handshake to force-replace stale content scripts already living in a tab.
const COLLECTOR_VERSION = "0.7.75"; // [Iteration 2026-09-26 v0.7.75] Bound Ozon structured requests and fetch composer/entrypoint in parallel for M.Video single-SKU preview; // [Iteration 2026-09-26 v0.7.74] M.Video single-SKU human-reviewed pricing, inventory and dry-run gates; // [Iteration 2026-09-25 v0.7.73] Add embedded Ozon collection and M.Video dry-run single-SKU preview; // [Iteration 2026-09-23 v0.7.72] Fix payload: collectOzonDetail now includes the precise entrypoint packageInfo (it was computed but dropped from the return, so only the weak DOM-text fallback shipped); // [Iteration 2026-09-23 v0.7.71] Fix packageInfo: parse Weight/Dimensions when they are top-level webCharacteristics row sections (no short/long wrapper), as on real PDP; // [Iteration 2026-09-23 v0.7.70] Keep BOTH seller backends seller.ozonru.cn + seller.ozon.ru; background finds the seller tab across both and calls the API via that tab origin; // [Iteration 2026-09-23 v0.7.69] Extract package weight/dimensions from entrypoint webCharacteristics (keys Weight/Dimensions) into packageInfo; [Iteration 2026-09-22 v0.7.68] Read JSON-LD from DOM <script type="application/ld+json"> (composer PDP has no seo widget) so brand/rating/reviewCount/price are captured; [Iteration 2026-09-22 v0.7.67] Ozon PDP: extract product video(s) from composer webGallery.videos (type=pdp only), brand/rating/reviewCount/description from JSON-LD, category from breadCrumbs; [Iteration 2026-09-22] Support new 1688 factory catalog (sale.1688.com/factory) full-shop scan via scroll+DOM, b2b- memberId // [Iteration 2026-09-21] Add seller ID, shipping model, blocked status, full vendor info matching 胜利者 // [Iteration 2026-09-21] Add full product analytics: visitors/cart rate/avg price/stock/DRR/min seller price, same data as 胜利者/上品帮 // [Iteration 2026-09-21] Fix response path: items at top level, map soldCount/gmvSum/avgOrdersOnAccDays fields, verified with real API call // [Iteration 2026-09-21] Fix sales data response parsing, return structured data // [Iteration 2026-09-21] Extract product data directly from public Ozon page, no seller API needed // [Iteration 2026-09-21] Fix duplicate collection: dedup by product_id, only scrape main list, brand default empty
let extensionContextAvailable = true;

function getExtensionRuntime() {
  if (!extensionContextAvailable) return null;
  try {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime) extensionContextAvailable = false;
    return runtime || null;
  } catch (_) {
    extensionContextAvailable = false;
    return null;
  }
}

function extensionReloadedError() {
  return new Error("扩展已重新加载，请刷新当前 1688 页面后再操作");
}

async function sendRuntimeMessage(message) {
  const runtime = getExtensionRuntime();
  if (typeof runtime?.sendMessage !== "function") throw extensionReloadedError();
  try {
    return await runtime.sendMessage(message);
  } catch (error) {
    if (/Extension context invalidated|context invalidated/i.test(String(error?.message || error))) {
      extensionContextAvailable = false;
      throw extensionReloadedError();
    }
    throw error;
  }
}

if (is1688Page()) {
  injectPageReader();
  mountFloatingCollector();
}
if (isOzonSellerPage()) {
  mountOzonSellerEditMonitor();
}
if (isOzonPage()) {
  injectOzonNetworkReader();
  mountOzonListInfo();
}
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type === "OZON_ERP_1688_CONTEXT") {
    pageContext = event.data.context || null;
  }
  if (event.data?.type === "OZON_ERP_NETWORK_JSON" && isOzonPage()) {
    applyOzonNetworkPayload(event.data.url || "", event.data.payload);
  }
  if (event.data?.type === "OZON_ERP_1688_SHOP_SCAN_PAGE") handleShopScanPage(event.data);
  if (event.data?.type === "OZON_ERP_1688_SHOP_SCAN_ERROR") handleShopScanError(event.data);
  if (event.data?.type === "OZON_ERP_1688_SKU_DATA" && is1688Page()) {
    recordNetworkSkuData(event.data.url || "", event.data.payload);
  }
});

// Network-captured SKU data (from 1688 API responses).
// Used as a fallback when window.context has no skuMapOriginal.
let __netSkuData = {};
function recordNetworkSkuData(url, payload) {
  if (!url || !payload) return;
  __netSkuData[String(url).slice(0, 200)] = payload;
}

function normalizeSkuMapRows(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    return [{
      ...item,
      skuId: item.skuId || item.sku_id || item.id || key,
      specAttrs: item.specAttrs || item.skuName || item.specName || item.name || key,
    }];
  });
}

function looksLikeSkuRow(value) {
  if (!value || typeof value !== "object") return false;
  return [
    "skuId", "sku_id", "specId", "specAttrs", "skuName", "specName",
    "price", "skuPrice", "discountPrice", "canBookCount", "stock", "quantity",
  ].some((key) => value[key] !== undefined && value[key] !== null && value[key] !== "");
}

function findNestedSkuRows(root) {
  const results = [];
  const seen = new WeakSet();
  const skuKey = /(?:sku|spec)(?:map|list|infos?|arr|data|prices?|inventory|snapshot|props)?/i;
  const visit = (value, depth = 0, fieldName = "") => {
    if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return;
    seen.add(value);
    if (skuKey.test(fieldName)) {
      const rows = normalizeSkuMapRows(value).filter(looksLikeSkuRow);
      if (rows.length) results.push(rows);
    }
    if (Array.isArray(value)) {
      value.slice(0, 1000).forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.entries(value).slice(0, 1500).forEach(([key, child]) => visit(child, depth + 1, key));
  };
  visit(root);
  return results.sort((left, right) => right.length - left.length);
}

function getNetworkSkuLists() {
  const results = [];
  for (const payload of Object.values(__netSkuData)) {
    if (!payload || typeof payload !== "object") continue;
    const data = payload.data || payload.result || payload;
    if (!data || typeof data !== "object") continue;
    results.push(...findNestedSkuRows(data));
    for (const key of ["skuList", "skuInfos", "skuMap", "skus", "skuArr", "sku", "specs", "specList"]) {
      const rows = normalizeSkuMapRows(data[key]);
      if (rows.length > 0) results.push(rows);
    }
    const model = data.skuModel || data.skuInfo || data.sku || data.specInfo;
    if (model && typeof model === "object") {
      for (const key of ["skuList", "skuInfos", "skuMap", "skus", "props", "skuProps"]) {
        const rows = normalizeSkuMapRows(model[key]);
        if (rows.length > 0) results.push(rows);
      }
    }
  }
  return results;
}

if (is1688Page()) {
  // Retrieve requests captured before the normal content script reached
  // document_idle. The page-world hook replies with its bounded cache.
  window.postMessage({ type: "OZON_ERP_1688_REQUEST_SKU_DATA" }, "*");
}


function is1688Page() {
  return /(^|\.)1688\.com$/i.test(location.hostname);
}

function isOzonPage() {
  return /(^|\.)ozon\.ru$/i.test(location.hostname);
}

function isOzonSellerPage() {
  return /^seller\.ozon\.ru$/i.test(location.hostname);
}

function isOzonProductDetailPage() {
  return isOzonPage() && /^\/product\/[^/]+-\d+\/?$/i.test(location.pathname);
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

// Public Ozon search cards do not expose all fields in the ERP.  Add a small,
// read-only overlay from the currently rendered card and keep it idempotent.
// Detailed collection still happens on the product page through the popup.

// ---------- Shangpinbang (上品帮) panel reader ----------
// Reads data that is already rendered on the page by the 上品帮 extension.
// This is strictly DOM reading of displayed content; we do not call its
// backend API, nor do we intercept its network requests.
function detectShangpinbangPanel(card) {
  if (!card) return null;
  // 上品帮 injects an info panel inside or near the product card.
  // Try to find a panel that contains known labels.
  const candidates = card.querySelectorAll('[class*="bang"], [class*="shangpin"], [class*="spb"], [id*="bang"]');
  for (const el of candidates) {
    const text = el.innerText || "";
    if (text.includes("月销量") || text.includes("包装重量") || text.includes("上品帮")) {
      return el;
    }
  }
  // Fallback: search within the card parent chain for nearby 上品帮 panel
  let parent = card;
  for (let i = 0; i < 4; i++) {
    parent = parent.parentElement;
    if (!parent) break;
    for (const el of parent.querySelectorAll('div')) {
      const t = el.innerText || "";
      if ((t.includes("月销量") || t.includes("包装重量")) && t.includes("上品帮")) {
        return el;
      }
    }
  }
  return null;
}

function parseShangpinbangText(container) {
  if (!container) return null;
  const text = container.innerText || "";
  if (!text) return null;
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const data = {};
  const labelValue = (label) => {
    const line = lines.find(l => l.includes(label));
    if (!line) return null;
    // Try "label: value" or "label value" pattern
    const m = line.match(/[:：]\s*(.+)$/);
    if (m) return m[1].trim();
    // fallback: take everything after label
    const idx = line.indexOf(label);
    if (idx >= 0) return line.substring(idx + label.length).trim();
    return null;
  };

  const category = labelValue("类目");
  if (category) data.category = category;
  const brand = labelValue("品牌");
  if (brand) data.brand = brand;

  const monthlySales = labelValue("月销量");
  if (monthlySales) data.monthlySales = monthlySales;
  const monthlyGmv = labelValue("月销售额");
  if (monthlyGmv) data.monthlyGmv = monthlyGmv;
  const dailySales = labelValue("日销量");
  if (dailySales) data.dailySales = dailySales;
  const dailyGmv = labelValue("日销售额");
  if (dailyGmv) data.dailyGmv = dailyGmv;
  const salesDynamics = labelValue("月销售动态");
  if (salesDynamics) data.salesDynamics = salesDynamics;

  const cardPv = labelValue("商品卡片浏览量");
  if (cardPv) data.cardPv = cardPv;
  const searchPv = labelValue("搜索和目录浏览量");
  if (searchPv) data.searchPv = searchPv;
  const cartRatePdp = labelValue("商品卡片加购率");
  if (cartRatePdp) data.cartRatePdp = cartRatePdp;
  const cartRateSearch = labelValue("搜索和目录加购率");
  if (cartRateSearch) data.cartRateSearch = cartRateSearch;
  const clickRate = labelValue("点击率");
  if (clickRate) data.clickRate = clickRate;

  const weight = labelValue("包装重量");
  if (weight) data.packageWeight = weight;
  const dimensions = labelValue("长宽高(mm)");
  if (dimensions) data.packageDimensions = dimensions;
  const shippingMode = labelValue("发货模式");
  if (shippingMode) data.shippingMode = shippingMode;
  const volume = labelValue("商品体积");
  if (volume) data.volume = volume;

  const sellerCount = labelValue("跟卖者");
  if (sellerCount) data.sellerCount = sellerCount;
  const minPrice = labelValue("跟卖最低价");
  if (minPrice) data.followMinPrice = minPrice;
  const sku = labelValue("SKU");
  if (sku) data.spbSku = sku;

  const rfbsCommission = labelValue("rFBS佣金");
  if (rfbsCommission) data.rfbsCommission = rfbsCommission;
  const fbpCommission = labelValue("FBP佣金");
  if (fbpCommission) data.fbpCommission = fbpCommission;

  const upDays = labelValue("上架时间");
  if (upDays) data.upTime = upDays;

  if (Object.keys(data).length === 0) return null;
  return data;
}

function getShangpinbangDataForCard(card) {
  const panel = detectShangpinbangPanel(card);
  if (!panel) return null;
  const parsed = parseShangpinbangText(panel);
  if (!parsed) return null;
  return {
    source: "shangpinbang_display",
    confidence: "reference",
    capturedAt: new Date().toISOString(),
    data: parsed,
  };
}

// ---------- ERP import ----------
async function getActiveStoreId() {
  try {
    const cfg = await new Promise((resolve) => {
      chrome.storage?.local?.get?.(["selectedStoreId", "serverBaseUrl"], (res) => resolve(res || {}));
    });
    return {
      storeId: cfg.selectedStoreId || "1",
      // Ozon collection is handled by the dedicated LAN notebook. Do not
      // route it through the separate Mercado Libre ERP service.
      baseUrl: "http://192.168.0.147:8000",
    };
  } catch (e) {
    return { storeId: "1", baseUrl: "http://192.168.0.147:8000" };
  }
}

async function erpRequest(path, options = {}, baseUrl = "") {
  const result = await sendRuntimeMessage({
    type: "OZON_ERP_REQUEST",
    path,
    baseUrl,
    options,
  });
  if (!result?.ok) throw new Error(result?.error || "本地 ERP 请求失败");
  return result.data;
}

async function importProductToErp(productData) {
  try {
    const { storeId, baseUrl } = await getActiveStoreId();
    return await erpRequest("/api/1688/capture", {
      method: "POST",
      body: {
        storeId: String(storeId),
        payload: productData,
      },
    }, baseUrl);
  } catch (e) {
    return { error: e.message };
  }
}

async function importCurrentOzonDetailToErp() {
  if (pageNeedsOzonHumanCheck()) return { error: "当前 Ozon 页面需要登录或人工验证，请完成后再采集" };
  const payload = await collectOzonDetail();
  if (!payload.title) return { error: "商品标题尚未加载完成，请等待页面加载后重试" };
  try {
    const { storeId, baseUrl } = await getActiveStoreId();
    const result = await erpRequest("/api/ozon-learning/extension/detail-result", {
      method: "POST",
      body: { storeId: String(storeId || ""), payload },
    }, baseUrl);
    if (!result?.ok || !result?.ingested) return { error: result?.error || "ERP 未接收该商品，请检查店铺选择" };
    return result;
  } catch (error) {
    return { error: error?.message || "Ozon 商品回传失败" };
  }
}

async function importCurrentPageProducts() {
  if (isOzonSellerProductsAnalyticsPage()) return importVisibleOzonMarketAnalytics();
  const products = collectAllVisibleOzonProducts();
  if (!products.length) return { error: "未找到商品" };
  const results = [];
  for (const p of products.slice(0, 20)) {
    const r = await importProductToErp(p);
    results.push({ sku: p.sku, result: r });
  }
  return { total: products.length, imported: results.length, results };
}

function cleanAnalyticsText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function analyticsNumber(value) {
  const match = cleanAnalyticsText(value).replace(/\s/g, "").match(/-?[\d.,]+/);
  if (!match) return null;
  const normalized = match[0].replace(/,(?=\d{3}(?:\D|$))/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function isOzonSellerProductsAnalyticsPage() {
  if (!isOzonSellerPage()) return false;
  const text = cleanAnalyticsText(document.body?.innerText).slice(0, 12000).toLowerCase();
  return (text.includes("ozon 上的商品") || text.includes("товары на ozon")) &&
    (text.includes("订购金额") || text.includes("заказ") || text.includes("ordered"));
}

function findOzonAnalyticsTable() {
  return [...document.querySelectorAll("table, [role='table'], [role='grid']")].find((node) => {
    const text = cleanAnalyticsText(node.innerText).toLowerCase();
    return (text.includes("商品名称") || text.includes("товар")) && (text.includes("订购金额") || text.includes("заказ"));
  }) || null;
}

function collectVisibleOzonMarketAnalytics() {
  const table = findOzonAnalyticsTable();
  if (!table) return { error: "未识别到“Ozon 上的商品”数据表，请等待页面加载完成" };
  const headers = [...table.querySelectorAll("thead th, [role='columnheader']")].map((node) => cleanAnalyticsText(node.innerText));
  const aliases = {
    product: ["商品名称", "товар", "product"], category: ["类目", "категор", "category"], features: ["商品特征", "признак", "feature"],
    searchPosition: ["搜索结果中的位置", "позици", "search position"], orderedAmount: ["订购金额", "заказано на сумму", "ordered amount"],
    dynamics: ["动态", "динамик", "dynamic"], orderedUnits: ["已订购商品", "заказано товар", "ordered product"], averagePrice: ["平均", "средн", "average"],
  };
  const index = {};
  for (const [key, values] of Object.entries(aliases)) index[key] = headers.findIndex((h) => values.some((a) => h.toLowerCase().includes(a)));
  const rowNodes = [...table.querySelectorAll("tbody tr, [role='row']")].filter((row) => !row.matches("thead tr") && row.querySelector("td, [role='gridcell']"));
  const rows = rowNodes.map((row) => {
    const cells = [...row.querySelectorAll(":scope > td, :scope > [role='gridcell']")];
    const textAt = (key) => index[key] >= 0 ? cleanAnalyticsText(cells[index[key]]?.innerText) : "";
    const first = cells[index.product >= 0 ? index.product : 0] || row;
    const productText = textAt("product") || cleanAnalyticsText(first.innerText);
    const readLabel = (labels) => productText.match(new RegExp(`(?:${labels})\\s*[:：]?\\s*([^\\n]+)`, "i"))?.[1]?.trim() || "";
    return {
      title: productText.split("\n").find((line) => !/^(?:品牌|卖家|货号|бренд|продавец|артикул)/i.test(line)) || productText,
      productUrl: first.querySelector('a[href*="/product/"], a[href]')?.href || "", imageUrl: first.querySelector("img")?.src || "",
      offerId: readLabel("货号|артикул|offer\\s*id"), seller: readLabel("卖家|продавец|seller"), brand: readLabel("品牌|бренд|brand"),
      category: textAt("category"), features: textAt("features"), searchPositionText: textAt("searchPosition"),
      orderedAmountRub: analyticsNumber(textAt("orderedAmount")), dynamicsPercent: analyticsNumber(textAt("dynamics")),
      orderedUnits: analyticsNumber(textAt("orderedUnits")), averagePriceRub: analyticsNumber(textAt("averagePrice")),
      evidenceText: cleanAnalyticsText(row.innerText).slice(0, 4000),
    };
  }).filter((row) => row.title && !/商品平均值|среднее/i.test(row.title));
  const pageText = cleanAnalyticsText(document.body?.innerText).slice(0, 20000);
  const periodDays = /(^|\D)28\s*天|28\s*дн/i.test(pageText) ? 28 : (/(^|\D)7\s*天|7\s*дн/i.test(pageText) ? 7 : null);
  return { sourcePage: "products_on_ozon", sourceUrl: location.href, capturedAt: new Date().toISOString(), captureMethod: "visible_dom", periodDays, categoryFilter: pageText.match(/(?:类目|категория)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim() || "", headers, rows };
}

async function importVisibleOzonMarketAnalytics() {
  const snapshot = collectVisibleOzonMarketAnalytics();
  if (snapshot.error) return snapshot;
  const { storeId, baseUrl } = await getActiveStoreId();
  try {
    return await erpRequest("/api/ozon/market-snapshots", { method: "POST", body: { storeId: String(storeId), snapshot } }, baseUrl);
  } catch (error) {
    return { error: error?.message || "市场分析快照入库失败" };
  }
}

function collectAllVisibleOzonProducts() {
  const list = [];
  const seen = new Set();
  for (const link of document.querySelectorAll('a[href*="/product/"]')) {
    const item = extractOzonCardFromLink(link, 0);
    const card = item && findOzonCardContainer(link);
    if (!item || !card || seen.has(item.url)) continue;
    seen.add(item.url);
    const spb = getShangpinbangDataForCard(card);
    const packageHint = extractOzonPackageHint(card.innerText || "");
    const salesHint = extractOzonSalesHint(card.innerText || "");
    list.push({
      ...item,
      sourceUrl: item.url,
      collectedAt: new Date().toISOString(),
      sources: {
        ozon_dom: { capturedAt: new Date().toISOString(), fields: ["title", "price", "rating", "reviewCount", "image"] },
        ...(packageHint.label ? { ozon_dom_package_hint: { label: packageHint.label, capturedAt: new Date().toISOString() } } : {}),
        ...(salesHint.label ? { ozon_dom_sales_hint: { label: salesHint.label, capturedAt: new Date().toISOString() } } : {}),
        ...(spb ? { shangpinbang_display: spb } : {}),
      },
      shangpinbang: spb?.data || null,
    });
  }
  return list;
}
function mountOzonListInfo() {
  if (window.__ozonErpListInfoMounted) return;
// batch bar styles added by shangpinbang integration
(function () {
  var s = document.createElement('style');
  s.textContent = [
    '.ozon-erp-list-bar { position: fixed; top: 80px; right: 20px; z-index: 999999; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; box-shadow: 0 4px 16px rgba(0,0,0,.12); font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 13px; display: flex; flex-direction: column; gap: 8px; min-width: 160px; }',
    '.ozon-erp-list-bar-title { font-weight: 600; color: #c0392b; }',
    '.ozon-erp-list-bar-btn { background: #c0392b; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; }',
    '.ozon-erp-list-bar-btn:hover { background: #a93226; }',
    '.ozon-erp-list-bar-status { color: #666; font-size: 12px; }',
    '.ozon-erp-list-import-btn { background: #c0392b !important; color: #fff !important; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; margin-top: 4px; }',
    '.ozon-erp-list-import-btn:disabled { opacity: .6; cursor: not-allowed; }',
    '.ozon-erp-list-info-source { font-size: 11px; color: #f39c12; margin-top: 2px; }',
  ].join(' ');
  document.head.appendChild(s);
})();
  window.__ozonErpListInfoMounted = true;
  const processedProducts = new Set();
  window.__ozonErpListPanels = window.__ozonErpListPanels || [];

  const isDetailPage = isOzonProductDetailPage();
  // A public product page has no product-card list, so show the detail
  // capture action instead of the list-page "import visible" action.
  const bar = document.createElement("div");
  bar.className = "ozon-erp-list-bar";
  bar.innerHTML = `
    <div class="ozon-erp-list-bar-title">Ozon ERP 采集</div>
    <button class="ozon-erp-list-bar-btn" id="ozon-erp-import-visible">${isDetailPage ? "采集当前商品" : (isOzonSellerProductsAnalyticsPage() ? "采集当前分析表" : "导入可见商品")}</button>
    <span class="ozon-erp-list-bar-status" id="ozon-erp-list-status"></span>
  `;
  document.body.appendChild(bar);
  bar.querySelector("#ozon-erp-import-visible").addEventListener("click", async () => {
    const status = bar.querySelector("#ozon-erp-list-status");
    status.textContent = isDetailPage ? "采集当前商品中..." : "导入中...";
    const result = isDetailPage ? await importCurrentOzonDetailToErp() : await importCurrentPageProducts();
    if (result?.error) {
      status.textContent = result.error;
    } else {
      status.textContent = isDetailPage ? "当前商品已进入 ERP" : "已采集 " + (result.imported || 0) + " 条";
    }
    setTimeout(() => { status.textContent = ""; }, 3000);
  });
  const scan = () => {
    if (pageNeedsOzonHumanCheck()) return;
    for (const link of document.querySelectorAll('a[href*="/product/"]')) {
      const item = extractOzonCardFromLink(link, 0);
      const card = item && findOzonCardContainer(link);
      if (!item || !card || processedProducts.has(item.url) || card.dataset.ozonErpListInfo === "1") continue;
      processedProducts.add(item.url);
      card.dataset.ozonErpListInfo = "1";
      const panel = document.createElement("div");
      panel.className = "ozon-erp-list-info";
      const packageHint = extractOzonPackageHint(card.innerText || "");
      const salesHint = extractOzonSalesHint(card.innerText || "");
      panel.innerHTML = "<div class='ozon-erp-list-info-title'>Ozon ERP</div>";
      const spbData = getShangpinbangDataForCard(card);
      const spb = spbData?.data || {};
      const rows = [
        ["评分", item.rating || "—"],
        ["评价", item.reviewCount || "—"],
        ["价格", item.price ? item.price + " ₽" : "—"],
        ["尺重", spb.packageWeight || packageHint.label || "列表页未展示"],
        ["尺寸", spb.packageDimensions || "—"],
        ["月销量", spb.monthlySales || "—"],
        ["月销额", spb.monthlyGmv || "—"],
        ["卖家数", spb.sellerCount || "—"],
      ];
      if (spbData) {
        const srcRow = document.createElement("div");
        srcRow.className = "ozon-erp-list-info-source";
        srcRow.textContent = "补充: 上品帮展示";
        panel.appendChild(srcRow);
      }
      for (const [label, value] of rows) {
        const row = document.createElement("div");
        row.className = "ozon-erp-list-info-row";
        row.textContent = `${label}：${value}`;
        panel.appendChild(row);
      }
      const linkButton = document.createElement("a");
      linkButton.className = "ozon-erp-list-info-action";
      linkButton.href = item.url;
      linkButton.target = "_blank";
      linkButton.rel = "noopener";
      linkButton.textContent = "打开详情采集";
      panel.appendChild(linkButton);

      const importButton = document.createElement("button");
      importButton.className = "ozon-erp-list-info-action ozon-erp-list-import-btn";
      importButton.textContent = "导入ERP";
      importButton.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        importButton.textContent = "导入中...";
        importButton.disabled = true;
        const spb = getShangpinbangDataForCard(card);
        const packageHint = extractOzonPackageHint(card.innerText || "");
        const salesHint = extractOzonSalesHint(card.innerText || "");
        const payload = {
          ...item,
          sourceUrl: item.url,
          collectedAt: new Date().toISOString(),
          sources: {
            ozon_dom: { capturedAt: new Date().toISOString(), fields: ["title", "price", "rating", "reviewCount", "image"] },
            ...(packageHint.label ? { ozon_dom_package_hint: { label: packageHint.label, capturedAt: new Date().toISOString() } } : {}),
            ...(salesHint.label ? { ozon_dom_sales_hint: { label: salesHint.label, capturedAt: new Date().toISOString() } } : {}),
            ...(spb ? { shangpinbang_display: spb } : {}),
          },
          shangpinbang: spb?.data || null,
        };
        const result = await importProductToErp(payload);
        if (result?.error) {
          importButton.textContent = "失败:" + result.error.slice(0, 8);
        } else {
          importButton.textContent = "已导入";
        }
        setTimeout(() => {
          importButton.textContent = "重新导入";
          importButton.disabled = false;
        }, 2000);
      });
      panel.appendChild(importButton);

      card.appendChild(panel);
      window.__ozonErpListPanels.push({ panel, productId: item.sku || ozonProductIdFromUrl(item.url), url: item.url });
      fetchOzonComposerSnapshot(item.url).then((snapshot) => {
        if (!snapshot) return;
        const mergedPackage = snapshot.packageInfo?.label ? snapshot.packageInfo : packageHint;
        const mergedSales = snapshot.salesHint?.label ? snapshot.salesHint : salesHint;
        updateOzonListInfoRow(panel, "尺重", mergedPackage.label || "列表页未展示");
        updateOzonListInfoRow(panel, "销量", mergedSales.label || "列表页未展示");
        panel.dataset.dataSource = snapshot.source || "ozon_page_json";
      }).catch(() => {});
    }
  };
  const style = document.createElement("style");
  style.textContent = `.ozon-erp-list-info{margin:6px 0;padding:8px;border:1px solid #fed7aa;border-radius:8px;background:#fff7ed;color:#7c2d12;font:12px/1.45 Arial,sans-serif;position:relative;z-index:2}.ozon-erp-list-info-title{font-weight:700;margin-bottom:3px}.ozon-erp-list-info-row{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ozon-erp-list-info-action{display:inline-block;margin-top:5px;color:#c2410c;font-weight:700;text-decoration:none}`;
  document.documentElement.appendChild(style);
  scan();
  const observer = new MutationObserver(() => window.requestAnimationFrame(scan));
  observer.observe(document.body, { childList: true, subtree: true });
  window.setInterval(scan, 2500);
}

function injectOzonNetworkReader() {
  if (window.__ozonErpNetworkReaderInjected) return;
  window.__ozonErpNetworkReaderInjected = true;
  const script = document.createElement("script");
  const getUrl = getExtensionRuntime()?.getURL;
  if (!getUrl) return;
  script.src = getUrl("injected.js");
  script.dataset.ozonErpNetworkReader = "1";
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
}

function applyOzonNetworkPayload(url, payload) {
  if (!payload || typeof payload !== "object") return;
  const text = (() => { try { return JSON.stringify(payload).slice(0, 900000); } catch { return ""; } })();
  const snapshot = parseOzonComposerPayload(payload);
  if (!snapshot?.packageInfo?.label && !snapshot?.salesHint?.label) return;
  for (const entry of window.__ozonErpListPanels || []) {
    if (!entry.panel?.isConnected) continue;
    const matchesProduct = entry.productId && text.includes(String(entry.productId));
    const matchesUrl = url && entry.url && url.includes(new URL(entry.url).pathname.split("/").pop());
    if (!matchesProduct && !matchesUrl) continue;
    if (snapshot.packageInfo.label) updateOzonListInfoRow(entry.panel, "尺重", snapshot.packageInfo.label);
    if (snapshot.salesHint.label) updateOzonListInfoRow(entry.panel, "销量", snapshot.salesHint.label);
  }
}

function updateOzonListInfoRow(panel, label, value) {
  const row = [...panel.querySelectorAll(".ozon-erp-list-info-row")].find((node) => node.textContent.startsWith(`${label}：`));
  if (row) row.textContent = `${label}：${value}`;
}

async function fetchOzonComposerSnapshot(productUrl) {
  if (!window.__ozonErpPageJsonCache) window.__ozonErpPageJsonCache = new Map();
  if (window.__ozonErpPageJsonCache.has(productUrl)) return window.__ozonErpPageJsonCache.get(productUrl);
  const pending = (async () => {
    const payload = await fetchOzonPageJson(productUrl, "composer", 7000);
    if (!payload) return null;
    return parseOzonComposerPayload(payload);
  })();
  window.__ozonErpPageJsonCache.set(productUrl, pending);
  return pending;
}

function parseOzonComposerPayload(payload) {
  const result = { source: "ozon_page_json", packageInfo: { weightG: "", lengthMm: "", widthMm: "", heightMm: "", label: "" }, salesHint: { sales: "", label: "" } };
  const values = [];
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length < 500000) {
        try { visit(JSON.parse(trimmed), key); } catch { /* widget state can be plain text */ }
      }
      values.push({ key: key.toLowerCase(), value: trimmed });
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) values.push({ key: key.toLowerCase(), value });
    if (!value || typeof value !== "object") return;
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
  };
  visit(payload);
  const readNumber = (keys) => {
    const entry = values.find((item) => keys.some((key) => item.key === key || item.key.endsWith(`_${key}`)) && typeof item.value === "number");
    if (entry) return entry.value;
    const text = values.find((item) => keys.some((key) => item.key.includes(key)) && typeof item.value === "string" && /\d/.test(item.value));
    return text ? parseFloat(String(text.value).replace(/[^\d.,-]/g, "").replace(",", ".")) : "";
  };
  result.packageInfo.weightG = readNumber(["weight", "weightg"]);
  result.packageInfo.lengthMm = readNumber(["depth", "length", "lengthmm"]);
  result.packageInfo.widthMm = readNumber(["width", "widthmm"]);
  result.packageInfo.heightMm = readNumber(["height", "heightmm"]);
  if (result.packageInfo.weightG || (result.packageInfo.lengthMm && result.packageInfo.widthMm && result.packageInfo.heightMm)) {
    const parts = [];
    if (result.packageInfo.weightG) parts.push(`${result.packageInfo.weightG} g`);
    if (result.packageInfo.lengthMm && result.packageInfo.widthMm && result.packageInfo.heightMm) parts.push(`${result.packageInfo.lengthMm}×${result.packageInfo.widthMm}×${result.packageInfo.heightMm} mm`);
    result.packageInfo.label = parts.join(" / ");
  }
  result.salesHint.sales = readNumber(["soldcount", "sales", "sold", "monthly_sales"]);
  if (result.salesHint.sales) result.salesHint.label = `${result.salesHint.sales}（页面数据）`;
  return result;
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
  await erpRequest("/api/listing-edit-journal/events", {
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
  const title = pickTitle(contextData);
  const images = pickImages(contextData);
  const detailResult = await fetchDetailImages(pickDescription(contextData));
  const attributes = pickAttributes(contextData);

  return {
    url: location.href,
    offerId: pickOfferId(contextData),
    title,
    supplier: pickSupplier(contextData),
    description: pickDescription(contextData),
    html: document.documentElement.outerHTML,
    images,
    detailImages: detailResult.images,
    mediaComplete: detailResult.complete,
    video: options.includeVideo === false ? null : pickVideo(contextData),
    attributes,
    skuVariants,
    packageInfo,
    storeId: options.storeId || "",
    includeVideo: options.includeVideo !== false,
    sentAt: new Date().toISOString(),
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
        <a class="ozon-erp-link" href="http://192.168.0.147:5500/" target="_blank" title="打开笔记本 ERP">ERP</a>
        <button type="button" id="ozon-erp-toggle" title="缩小">-</button>
      </div>
    </div>
    <div id="ozon-erp-expanded">
      <div class="ozon-erp-row">
        <select id="ozon-erp-1688-store"><option value="">选择店铺</option></select>
        <label class="ozon-erp-switch"><input type="checkbox" id="ozon-erp-1688-video" checked /> 视频</label>
      </div>
      <button type="button" id="ozon-erp-1688-collect">采集到 ERP</button>
      <div class="ozon-erp-shop-scan">
      <button type="button" id="ozon-erp-shop-scan-start">全店采集</button>
        <span id="ozon-erp-shop-scan-status">店铺页静默扫描，每页30条</span>
      </div>
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
    #ozon-erp-1688-floating .ozon-erp-shop-scan{display:grid;grid-template-columns:126px 1fr;align-items:center;gap:8px;padding:8px;border:1px solid #fed7aa;border-radius:8px;background:#fff7ed}
    #ozon-erp-1688-floating #ozon-erp-shop-scan-start{height:32px;border:0;border-radius:6px;background:#ea580c;color:#fff;font-size:12px;font-weight:800;cursor:pointer}
    #ozon-erp-1688-floating #ozon-erp-shop-scan-start:disabled{opacity:.65;cursor:wait}
    #ozon-erp-1688-floating #ozon-erp-shop-scan-status{font-size:11px;line-height:16px;color:#9a3412}
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
  let currentCapturePayload = null;
  const refreshSkuPreview = async () => {
    const payload = await collectPage({ includeVideo: false });
    currentCapturePayload = payload;
    panel.querySelector("#ozon-erp-title").textContent = payload.title || "当前商品";
    prefillManualPackageInfo(panel, payload.packageInfo || {});
    renderSkuSelector(panel, payload.skuVariants || []);
    return payload;
  };
  refreshSkuPreview().then((payload) => {
    if (payload.skuVariants?.length) return;
    // The new detail UI can render SKU state after the initial page context.
    // Retry without changing any user SKU selection once rows are available.
    [1200, 3200, 6500].forEach((delay) => {
      setTimeout(() => {
        if (currentCapturePayload?.skuVariants?.length) return;
        refreshSkuPreview().catch(() => {});
      }, delay);
    });
  }).catch(() => {});
  const floatingStoreSelect = panel.querySelector("#ozon-erp-1688-store");
  loadStoreOptions(floatingStoreSelect, panel.querySelector("#ozon-erp-1688-status")).then(() => showCurrentCaptureStatus(panel, currentCapturePayload));
  floatingStoreSelect.addEventListener("change", () => showCurrentCaptureStatus(panel, currentCapturePayload));
  bindShopScanner(panel);
  panel.querySelector("#ozon-erp-1688-collect").addEventListener("click", async () => {
    const button = panel.querySelector("#ozon-erp-1688-collect");
    const status = panel.querySelector("#ozon-erp-1688-status");
    const sizeBox = panel.querySelector("#ozon-erp-1688-size-box");
    button.disabled = true;
    status.textContent = "采集中...";
    try {
      const payload = await collectPage({
        includeVideo: panel.querySelector("#ozon-erp-1688-video").checked,
        storeId: panel.querySelector("#ozon-erp-1688-store").value,
      });
      payload.skuVariants = filterSelectedSkus(payload.skuVariants || []);
      const manualPackageInfo = readManualPackageInfo(panel);
      if (manualPackageInfo) applyManualPackageInfo(payload, manualPackageInfo, panel.querySelector("#ozon-erp-apply-all-sku").checked);
      const sizeWeightStatus = productSizeWeightStatus(payload);
      if (!sizeWeightStatus.ok) {
        prefillManualPackageInfo(panel, payload.packageInfo || {});
        status.textContent = sizeWeightStatus.message;
        status.style.color = "#b42318";
        button.textContent = "补齐后入箱";
        return;
      }
      const result = await erpRequest("/api/1688/capture", {
        method: "POST",
        body: payload,
      });
      button.textContent = "采集到 ERP";
      if (result.duplicate) {
        status.textContent = `${result.duplicateMessage || `已采集过 ${result.id || ""}`}，当前图库 ${result.imageCount ?? payload.images.length} 张`;
        status.style.color = "#b54708";
        return;
      }
      status.textContent = sizeWeightStatus.ok
        ? `已入箱 ${result.id || ""}，本次识别 ${payload.images.length} 张，图库现有 ${result.imageCount ?? payload.images.length} 张`
        : `已入箱，${sizeWeightStatus.message}`;
      status.style.color = sizeWeightStatus.ok ? "#667085" : "#b42318";
    } catch (error) {
      status.textContent = error.message || "失败";
      status.style.color = "#b42318";
    } finally {
      button.disabled = false;
    }
  });
}

function is1688ShopListPage() {
  // [Iteration 2026-09-22 v0.7.65] 适配新版工厂店“产品目录”页 sale.1688.com/factory/*.html
  // （memberId 为 b2b- 加密串、滚动懒加载、无 offerlist URL）；旧版旺铺 /page/offerlist 逻辑保持不变。
  return /page\/offerlist|offerlist_|1688\.com\/factory\/[a-z0-9_-]+\.html/i.test(location.href);
}

function shopScanStorageGet() {
  return new Promise((resolve) => chrome.storage.local.get([SHOP_SCAN_STORAGE_KEY], (data) => resolve(data?.[SHOP_SCAN_STORAGE_KEY] || null)));
}

function shopScanStorageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set({ [SHOP_SCAN_STORAGE_KEY]: value }, resolve));
}

function shopScanIdentity() {
  return `${location.hostname}${location.pathname.split("/page/")[0]}`;
}

async function bindShopScanner(panel) {
  const button = panel.querySelector("#ozon-erp-shop-scan-start");
  const status = panel.querySelector("#ozon-erp-shop-scan-status");
  if (!is1688ShopListPage()) {
    button.disabled = true;
    status.textContent = "进入店铺“全部商品”页后可用";
    return;
  }
  const saved = await shopScanStorageGet();
  if (saved?.shopKey === shopScanIdentity()) {
    const count = Object.keys(saved.items || {}).length;
    status.textContent = saved.finished ? `已扫描 ${count}/${saved.total || count}，去重 ${saved.duplicateCount || 0}` : `可从第 ${saved.nextPage || 1} 页继续，已有 ${count} 条`;
    button.textContent = saved.finished ? "重新采集缺失商品" : "全店采集";
  }
  button.addEventListener("click", async () => {
    const previous = await shopScanStorageGet();
    const hasSavedScan = previous?.shopKey === shopScanIdentity() && Object.keys(previous.items || {}).length > 0;
    const state = hasSavedScan ? previous : { shopKey: shopScanIdentity(), items: {}, total: 0, nextPage: 1, duplicateCount: 0, finished: false, startedAt: new Date().toISOString() };
    const wasFinished = Boolean(state.finished);
    state.requestId = `shop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.error = "";
    state.storeId = panel.querySelector("#ozon-erp-1688-store")?.value || state.storeId || "";
    if (!state.storeId) {
      status.textContent = "请先选择归属店铺";
      return;
    }
    await shopScanStorageSet(state);
    button.disabled = true;
    button.textContent = "扫描并采集中...";
    status.textContent = `正在把已扫描的 ${Object.keys(state.items || {}).length} 个商品写入详情队列`;
    try {
      await syncStoredShopScanToErp(state, status);
    } catch (error) {
      button.disabled = false;
      button.textContent = "继续全店采集";
      status.textContent = error?.message || "ERP详情队列写入失败";
      return;
    }
    sendRuntimeMessage({ type: "OZON_ERP_CRAWLER_POLL_NOW" }).catch(() => {});
    // [Iteration 2026-09-22 v0.7.66] 修复“重新采集缺失商品”在工厂滚动页失效：旧逻辑在
    // wasFinished 时补写本地缓存后直接 return，不发 SHOP_SCAN_START，导致页面不回顶滚动、
    // 采不到懒加载遗漏/新增商品。现补写后统一重新发起扫描：工厂页 scanFactoryByScroll
    // 总是回顶重滚，旧旺铺分页从第 1 页重扫；扫描中按钮保持禁用，由 finished 回执复位。
    state.finished = false;
    if (wasFinished) state.nextPage = 1;
    await shopScanStorageSet(state);
    button.disabled = true;
    button.textContent = "扫描并采集中...";
    status.textContent = wasFinished
      ? "重新滚动全店，补采缺失/新增商品…"
      : `从第 ${state.nextPage || 1} 页继续扫描并采集`;
    window.postMessage({ type: "OZON_ERP_1688_SHOP_SCAN_START", requestId: state.requestId, startPage: state.nextPage || 1, expectedTotal: state.total || 0 }, "*");
  });
}

async function syncStoredShopScanToErp(state, statusElement) {
  const items = Object.values(state.items || {});
  for (let index = 0; index < items.length; index += 100) {
    const result = await erpRequest("/api/1688/shop-scan/chunk", {
      method: "POST",
      body: { storeId: state.storeId, shopKey: state.shopKey, items: items.slice(index, index + 100), total: state.total || 0, finished: state.finished },
    });
    state.runId = result.runId;
    state.queued = result.queued;
    state.collected = result.collected;
    if (statusElement) statusElement.textContent = `补写详情队列 ${Math.min(index + 100, items.length)}/${items.length}，待采 ${result.queued}，已完整采集 ${result.collected}`;
  }
  await shopScanStorageSet(state);
}

async function handleShopScanPage(message) {
  const state = await shopScanStorageGet();
  if (!state || state.requestId !== message.requestId || state.shopKey !== shopScanIdentity()) return;
  let duplicateCount = Number(state.duplicateCount || 0);
  state.items ||= {};
  // [Iteration 2026-09-22 v0.7.66] 重扫会重发整页商品，只把本地未见的新 offer POST 后端；
  // 已采的本地去重跳过（后端另有 (run_id,offer_id) 幂等兜底），避免整店重复刷请求触发风控。
  const freshItems = [];
  for (const item of message.items || []) {
    if (state.items[item.offerId]) duplicateCount += 1;
    else { state.items[item.offerId] = item; freshItems.push(item); }
  }
  try {
    const queued = await erpRequest("/api/1688/shop-scan/chunk", {
      method: "POST",
      body: { storeId: state.storeId, shopKey: state.shopKey, items: freshItems, total: message.total || state.total || 0, finished: Boolean(message.finished) },
    });
    state.runId = queued.runId;
    state.queued = queued.queued;
    state.collected = queued.collected;
    state.erpExistingCount = Number(queued.alreadyKnown || 0) + Number(state.erpExistingCount || 0);
  } catch (error) {
    state.erpCheckError = error?.message || "ERP详情队列写入失败";
  }
  state.total = Number(message.total || state.total || 0);
  state.nextPage = Number(message.pageNum || 0) + 1;
  state.duplicateCount = duplicateCount;
  state.finished = Boolean(message.finished);
  state.memberId = message.memberId || state.memberId || "";
  state.categoryId = message.categoryId || "";
  state.updatedAt = new Date().toISOString();
  await shopScanStorageSet(state);
  const panel = document.querySelector("#ozon-erp-1688-floating");
  const button = panel?.querySelector("#ozon-erp-shop-scan-start");
  const status = panel?.querySelector("#ozon-erp-shop-scan-status");
  const count = Object.keys(state.items).length;
  if (status) status.textContent = `${state.finished ? "扫描完成" : `第${message.pageNum}页`}：发现 ${count}/${state.total || "?"}，待详情 ${state.queued || 0}，已完整 ${state.collected || 0}`;
  if (state.finished && button) { button.disabled = false; button.textContent = "重新采集缺失商品"; }
}

async function handleShopScanError(message) {
  const state = await shopScanStorageGet();
  if (!state || state.requestId !== message.requestId) return;
  state.error = message.error || "扫描失败";
  state.updatedAt = new Date().toISOString();
  await shopScanStorageSet(state);
  const panel = document.querySelector("#ozon-erp-1688-floating");
  const button = panel?.querySelector("#ozon-erp-shop-scan-start");
  const status = panel?.querySelector("#ozon-erp-shop-scan-status");
  if (button) { button.disabled = false; button.textContent = "继续全店采集"; }
  if (status) status.textContent = `${state.error}；断点在第 ${state.nextPage || 1} 页`;
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
    const data = await erpRequest("/api/stores");
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

async function showCurrentCaptureStatus(panel, payload) {
  const storeId = panel.querySelector("#ozon-erp-1688-store")?.value || "";
  const offerId = String(payload?.offerId || "").trim();
  const status = panel.querySelector("#ozon-erp-1688-status");
  if (!storeId || !offerId || !status) return;
  try {
    const result = await erpRequest(`/api/1688/status?storeId=${encodeURIComponent(storeId)}&offerId=${encodeURIComponent(offerId)}`);
    if (result.other_shop_published) {
      status.textContent = `其他店已发布：${result.published_shops.map(row => `${row.shop_name}(${row.offer_id})`).join("、")}`;
      status.style.color = "#b42318";
    } else if (result.current_shop_published) {
      status.textContent = "本店已发布";
      status.style.color = "#15803d";
    } else if (result.collected) {
      status.textContent = "该 1688 商品已采集过";
      status.style.color = "#b54708";
    }
  } catch (_) {}
}

function injectPageReader() {
  if (document.documentElement.dataset.ozonErp1688Injected === "1") return true;
  const getUrl = getExtensionRuntime()?.getURL;
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
  // Public gallery only: SKU-specific images are sent separately in
  // `skuVariants` and must never be mixed into `images`.
  const structured = [
    ...(Array.isArray(gallery.mainImage) ? gallery.mainImage : []),
    ...(Array.isArray(gallery.offerImgList) ? gallery.offerImgList : []),
  ];
  // The DOM fallback is restricted to the product-detail description area.
  const images = structured.some(Boolean) ? structured : domProductImages();
  return dedupe(images.map(normalizeImage).filter(Boolean)).slice(0, 80);
}

async function fetchDetailImages(detailUrl) {
  const url = String(detailUrl || "").trim();
  if (!/^https:\/\/itemcdn\.tmall\.com\/1688offer\//i.test(url)) return { images: [], complete: false };
  try {
    const response = await sendRuntimeMessage({ type: "FETCH_1688_DETAIL_IMAGES", url });
    return response?.ok
      ? { images: dedupe((response.images || []).map(normalizeImage).filter(Boolean)).slice(0, 80), complete: true }
      : { images: [], complete: false };
  } catch (_) {
    return { images: [], complete: false };
  }
}

function pickVideo(data) {
  const video = data?.gallery?.fields?.video || {};
  const candidates = [
    video.videoUrl, video.url, data?.productInfo?.fields?.mainVedio,
    data?.productInfo?.mainVedio, data?.mainVedio, data?.mainVideo,
    document.querySelector("video")?.currentSrc, document.querySelector("video")?.src,
    ...findVideoUrls(data),
    ...findVideoUrlsFromScripts(),
  ];
  const url = candidates.map(value => String(value || "").trim()).find(value => /^https?:\/\//i.test(value) && /\.(mp4|m3u8)(?:[?#]|$)/i.test(value)) || "";
  if (!url) return null;
  return {
    url,
    coverUrl: video.coverUrl || "",
    title: video.title || "",
    videoId: video.videoId || "",
  };
}

function findVideoUrls(value, depth = 0, found = []) {
  if (!value || depth > 5 || found.length >= 8) return found;
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^"'\\s]+\.(?:mp4|m3u8)(?:\?[^"'\\s]*)?/gi)) found.push(match[0]);
    return found;
  }
  if (Array.isArray(value)) { value.forEach(item => findVideoUrls(item, depth + 1, found)); return found; }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (/video|vedio|media/i.test(key) || depth < 2) findVideoUrls(child, depth + 1, found);
    }
  }
  return found;
}

function findVideoUrlsFromScripts() {
  const urls = [];
  document.querySelectorAll("script").forEach(script => {
    if (urls.length >= 8) return;
    const text = script.textContent || "";
    for (const match of text.matchAll(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?/gi)) {
      urls.push(match[0].replace(/\\\//g, "/"));
      if (urls.length >= 8) break;
    }
  });
  return urls;
}

function domProductImages() {
  // Only scrape images from the product detail description area,
  // never the full page — avoids picking up recommended products, ads, etc.
  const selectors = [
    "#desc-lazyload-container",
    "#de-description-detail",
    ".detail-desc",
    ".detail-content",
    ".desc-module",
    ".product-detail",
    ".detail-gallery",
    ".pc-offer-detail__main",
  ];
  let root = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.children.length > 0) { root = el; break; }
  }
  if (!root) return [];
  const values = [];
  root.querySelectorAll("img, source").forEach((node) => {
    const attrs = [
      node.currentSrc, node.src,
      node.getAttribute("data-src"), node.getAttribute("data-original"),
      node.getAttribute("data-lazy-src"), node.getAttribute("data-image-url"),
      node.getAttribute("srcset"), node.getAttribute("data-srcset"),
    ];
    attrs.filter(Boolean).forEach((value) => {
      String(value).split(",").forEach((part) => values.push(part.trim().split(/\s+/)[0]));
    });
  });
  return values
    .filter((src) => /(?:cbu\d+|img)\.alicdn\.com\/img\/ibank|alicdn\.com\/img\/ibank/i.test(src))
    .filter((src) => !/tps-|cms\/upload|icon|logo|overseas_pic/i.test(src));
}

function domSkuVariants() {
  // Newer 1688 pages sometimes render SKU rows after context data is loaded.
  // Only rows with explicit SKU-related data attributes are considered.
  const rows = [];
  document.querySelectorAll("[data-sku-id], [data-skuid], [data-sku]").forEach((node) => {
    const skuId = String(
      node.getAttribute("data-sku-id") || node.getAttribute("data-skuid") || node.getAttribute("data-sku") || ""
    ).trim();
    const specAttrs = cleanText(
      node.getAttribute("data-spec-attrs") || node.getAttribute("data-spec-name") ||
      node.getAttribute("data-sku-name") || node.getAttribute("title") || node.innerText || ""
    );
    const priceNode = node.querySelector("[class*=price], [class*=Price]");
    const imageNode = node.querySelector("img");
    if (!skuId && !specAttrs) return;
    rows.push({
      skuId,
      specAttrs,
      price: node.getAttribute("data-price") || priceNode?.innerText || "",
      stock: node.getAttribute("data-stock") || node.getAttribute("data-quantity") || "",
      imageUrl: imageNode?.currentSrc || imageNode?.src || "",
    });
  });
  return dedupeBy(rows, (item) => item.skuId || item.specAttrs);
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
  // Try multiple known SKU data paths - 1688 has several page architectures.
  // The first path that returns a non-empty array wins.
  const skuCandidates = [
    // Original: mainPrice -> tradeWithoutPromotion -> skuMapOriginal
    (() => {
      const priceData = data?.mainPrice?.fields?.finalPriceModel?.tradeWithoutPromotion || {};
      return normalizeSkuMapRows(priceData.skuMapOriginal);
    })(),
    // Alternate: direct mainPrice skuMap / skuList / skuInfos
    (() => {
      const priceData = data?.mainPrice?.fields || {};
      for (const key of ["skuMapOriginal", "skuMap", "skuList", "skuInfos"]) {
        const rows = normalizeSkuMapRows(priceData[key]);
        if (rows.length) return rows;
      }
      return [];
    })(),
    // Root level skuList / skuInfos / skuMap (newer page architectures)
    (() => {
      for (const key of ["skuList", "skuInfos", "skuMap", "skuArr"]) {
        const rows = normalizeSkuMapRows(data?.[key]);
        if (rows.length) return rows;
      }
      return [];
    })(),
    // Root -> dataJson -> skuModel -> skuProps / skuMap
    (() => {
      const skuModel = data?.Root?.fields?.dataJson?.skuModel;
      if (!skuModel) return [];
      for (const key of ["skuMap", "skuList", "skuInfos"]) {
        const rows = normalizeSkuMapRows(skuModel[key]);
        if (rows.length) return rows;
      }
      const props = skuModel.skuProps || [];
      if (Array.isArray(props) && props.length) {
        const flat = [];
        for (const prop of props) {
          for (const v of prop.value || []) {
            flat.push({
              skuId: v.specId || v.valueId || "",
              specAttrs: `${prop.prop || prop.name || ""}: ${v.name || v.value}`,
              skuName: v.name || v.value || "",
              price: v.price || "",
              imageUrl: v.imageUrl || "",
            });
          }
        }
        if (flat.length) return flat;
      }
      return [];
    })(),
    // Newer 1688 React payloads often nest the SKU model below an opaque
    // state key. Search those containers only after the explicit paths.
    (() => findNestedSkuRows(data)[0] || [])(),
    // Network-captured SKU data (from intercepted 1688 API responses)
    (() => {
      const lists = (typeof getNetworkSkuLists === "function") ? getNetworkSkuLists() : [];
      if (lists.length === 0) return [];
      for (const list of lists) {
        if (Array.isArray(list) && list.length > 0) return list;
      }
      return [];
    })(),
    // offerPriceInfo / priceInfo -> skuPriceMap / skuList
    (() => {
      const priceInfo = data?.offerPriceInfo || data?.priceInfo || {};
      for (const key of ["skuPriceMap", "skuList", "skuMap", "skuInfos"]) {
        const rows = normalizeSkuMapRows(priceInfo[key]);
        if (rows.length) return rows;
      }
      if (priceInfo.skuPriceMap && typeof priceInfo.skuPriceMap === "object") {
        const out = [];
        for (const [skuId, info] of Object.entries(priceInfo.skuPriceMap)) {
          out.push({ skuId, ...info });
        }
        if (out.length) return out;
      }
      return [];
    })(),
  ];

  let skuMap = [];
  for (const candidates of skuCandidates) {
    if (Array.isArray(candidates) && candidates.length) {
      skuMap = candidates;
      break;
    }
  }
  if (!skuMap.length) skuMap = domSkuVariants();

  const priceData = data?.mainPrice?.fields?.finalPriceModel?.tradeWithoutPromotion || {};
  const displayPrice = data?.mainPrice?.fields?.displayPrice || "";
  const priceRange = priceData.offerMinPrice && priceData.offerMaxPrice
    ? (priceData.offerMinPrice === priceData.offerMaxPrice ? priceData.offerMinPrice : `${priceData.offerMinPrice}-${priceData.offerMaxPrice}`)
    : "";
  const imageMap = skuImageMap(data);
  const mainImages = data?.gallery?.fields?.mainImage || [];

  const variants = skuMap.map((item, index) => {
    const skuId = String(item.skuId || item.sku_id || item.id || item.specId || "");
    const spec = cleanText(item.specAttrs || item.skuName || item.name || item.specName || item.title || "");
    const pkg = skuPackageMap[skuId] || {};
    return {
      skuId,
      spec,
      price: cleanPrice(item.price || item.discountPrice || item.skuPrice || item.tradePrice || item.priceRange || item.originalPrice || priceRange || displayPrice),
      stock: toNumber(item.canBookCount || item.stock || item.quantity || item.canBook || item.inventory),
      image: normalizeImage(item.imageUrl || item.imgUrl || item.picUrl || item.image || imageMap[spec] || mainImages[index % Math.max(mainImages.length, 1)] || ""),
      weightG: pkg.weightG || item.weight || "",
      lengthMm: pkg.lengthMm || item.length || "",
      widthMm: pkg.widthMm || item.width || "",
      heightMm: pkg.heightMm || item.height || "",
    };
  }).filter((item) => item.spec || item.price || item.skuId);

  if (variants.length) return dedupeBy(variants, (item) => item.spec || item.skuId);

  // Last-ditch fallback: parse from spec attributes in CPV data
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
  // Multiple fallback paths for SKU image mapping
  const candidates = [
    // Original path
    data?.Root?.fields?.dataJson?.skuModel?.skuProps,
    // Alternate: direct skuProps at root
    data?.skuProps,
    // Alternate: mainPrice skuImageMap
    data?.mainPrice?.fields?.skuImageMap,
    // Alternate: gallery skuList
    data?.gallery?.fields?.skuList,
  ];

  const map = {};
  for (const props of candidates) {
    if (!Array.isArray(props) || !props.length) continue;
    for (const prop of props) {
      const values = prop.value || prop.values;
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (value?.name && value?.imageUrl) {
          map[cleanText(value.name)] = normalizeImage(value.imageUrl);
        } else if (value?.specName && value?.imgUrl) {
          map[cleanText(value.specName)] = normalizeImage(value.imgUrl);
        }
      }
    }
    if (Object.keys(map).length) break;
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
  const raw = String(value || "").trim();
  // URL("", base) resolves to the Ozon homepage. That is not an image and
  // previously leaked into a SKU row as https://www.ozon.ru/.
  if (!raw) return "";
  try {
    const url = new URL(raw.replace(/^\/\//, "https://"), "https://www.ozon.ru");
    if (!/(^|\.)ozon\.ru$/i.test(url.hostname) && !/(^|\.)ozonusercontent\.com$/i.test(url.hostname) && !/(^|\.)ozonstatic\.cn$/i.test(url.hostname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isOzonProductImageUrl(value = "") {
  const url = normalizeOzonImageUrl(value);
  if (!url) return false;
  // Public product pages include global promotion banners in document.images.
  // Those are page chrome, never product media, and must not become a main image.
  return !/\/marketing-api\/+banners?\//i.test(new URL(url).pathname);
}

// Ozon CDN serves variant thumbnails as /s3/.../wc140/<file> (~140px). The
// same file without the wc<n> segment is the full-resolution original, which
// is far more useful as a SKU image. Safe no-op for URLs without a wc<n> part.
function upgradeOzonThumbUrl(value = "") {
  return String(value || "").replace(/\/wc\d+\//i, "/");
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

  const card = findOzonCardContainer(link);
  if (!card) return null;

  const cardText = cleanText(card.innerText || "");
  if (cardText.length < 5) return null;

  const title = extractOzonTitle(link, card);
  if (!title || title.length < 3) return null;

  const image = extractOzonCardImage(card, link);
  const { price, oldPrice, discount } = extractOzonPrices(card, cardText);
  const { rating, reviewCount } = extractOzonRating(card, cardText);
  const badges = extractOzonBadges(card, cardText);

  return {
    url,
    title,
    image,
    price,
    oldPrice,
    discount,
    rating,
    reviewCount,
    position: index + 1,
    sku: ozonProductIdFromUrl(url),
    badges,
  };
}

function findOzonCardContainer(link) {
  const selectors = [
    '[data-widget="searchResultsV2"] [data-index]',
    '[class*="widget-search-result-container"] > div > div',
    '[class*="search结果"] > div > div',
    'a[href*="/product/"]',
  ];
  for (const sel of selectors) {
    const parent = link.closest(sel);
    if (parent && parent.innerText && parent.innerText.length > 10) return parent;
  }
  let el = link;
  for (let i = 0; i < 6; i++) {
    el = el.parentElement;
    if (!el) break;
    const text = el.innerText || "";
    if (text.length > 30 && /\d+\s*₽/.test(text) && el.querySelector("img")) return el;
  }
  return link.parentElement;
}

function extractOzonTitle(link, card) {
  const candidates = [
    link.getAttribute("title"),
    link.querySelector("span")?.innerText,
    link.innerText,
  ];
  for (const c of candidates) {
    const t = cleanText(c);
    if (t.length >= 8 && !/распродажа|скидка|акция|вау-цены|цена/i.test(t)) return t;
  }
  const lines = (card.innerText || "").split("\n").map(cleanText);
  for (const line of lines) {
    if (line.length >= 10 && !/₽|руб|%|скид|акци|отзыв|оцен|распрод|вау/i.test(line)) return line;
  }
  return "";
}

function extractOzonCardImage(card, link) {
  const img = card.querySelector("img");
  if (!img) return "";
  const src = img.currentSrc || img.src || "";
  return normalizeOzonImageUrl(src);
}

function extractOzonPrices(card, cardText) {
  let price = "";
  let oldPrice = "";
  let discount = "";
  const priceEl = card.querySelector("[class*='price'] [class*='value'], [class*='price'] span, [data-widget*='price'] span");
  if (priceEl) {
    price = parseRubPrice(priceEl.innerText);
  }
  if (!price) {
    const lines = cardText.split("\n");
    for (const line of lines) {
      if (/\d+\s*₽/.test(line) && !/−|−|−/.test(line)) {
        price = parseRubPrice(line);
        if (price) break;
      }
    }
  }
  if (!price) {
    const match = cardText.match(/(\d[\d\s]*)\s*₽/);
    if (match) price = parseRubPrice(match[1] + " ₽");
  }
  const oldPriceEl = card.querySelector("[class*='old'], [class*='original'], s, del, [style*='line-through']");
  if (oldPriceEl) oldPrice = parseRubPrice(oldPriceEl.innerText);
  if (!oldPrice) {
    const discountMatch = cardText.match(/(\d[\d\s]*)\s*₽[\s\S]*?[−-]\s*\d+%/);
    if (discountMatch) oldPrice = parseRubPrice(discountMatch[1] + " ₽");
  }
  const discountMatch = cardText.match(/[−-]\s*(\d+)\s*%/);
  if (discountMatch) discount = `-${discountMatch[1]}%`;
  return { price, oldPrice, discount };
}

function extractOzonRating(card, cardText) {
  let rating = "";
  let reviewCount = "";
  const ratingEl = card.querySelector("[class*='rating'] span, [data-widget*='rating'] span");
  if (ratingEl) {
    const m = ratingEl.innerText.match(/[\d,.]+/);
    if (m) rating = m[0].replace(",", ".");
  }
  if (!rating) {
    const m = cardText.match(/([1-5][,.]\d)/);
    if (m) rating = m[1].replace(",", ".");
  }
  const reviewEl = card.querySelector("a[href*='review'], [class*='review'] span");
  if (reviewEl) {
    const m = reviewEl.innerText.match(/\d+/);
    if (m) reviewCount = m[0];
  }
  if (!reviewCount) {
    const m = cardText.match(/(\d+)\s*(?:отзыв|review)/i);
    if (m) reviewCount = m[1];
  }
  return {
    rating: rating ? Number(rating) : "",
    reviewCount: reviewCount ? Number(reviewCount) : "",
  };
}

function extractOzonBadges(card, cardText) {
  const badgeEls = card.querySelectorAll("[class*='badge'], [class*='label'], [class*='tag'], [class*='mark']");
  const badges = [];
  badgeEls.forEach((el) => {
    const t = cleanText(el.innerText);
    if (t && t.length < 50 && /скид|акци|sale|распрод|новинк|хит|best/i.test(t)) badges.push(t);
  });
  if (!badges.length) {
    const lines = cardText.split("\n").map(cleanText);
    for (const line of lines) {
      if (line.length < 30 && /скид|акци|sale|распрод|новинк|хит/i.test(line)) badges.push(line);
      if (badges.length >= 4) break;
    }
  }
  return badges;
}

function extractOzonPackageHint(text = "") {
  const value = cleanText(text);
  const weight = value.match(/(?:вес(?:s+товара|s+упаковки)?|масса|weight|包装重量)\D{0,18}(\d+(?:[.,]\d+)?)\s*(кг|kg|г|g)/i);
  const dimensions = value.match(/(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(см|cm|мм|mm)/i);
  const result = { weightG: "", lengthMm: "", widthMm: "", heightMm: "", source: "capture_hint", label: "" };
  if (weight) {
    const amount = Number(weight[1].replace(",", "."));
    result.weightG = /кг|kg/i.test(weight[2]) ? Math.round(amount * 1000) : Math.round(amount);
  }
  if (dimensions) {
    const factor = /см|cm/i.test(dimensions[4]) ? 10 : 1;
    result.lengthMm = Math.round(Number(dimensions[1].replace(",", ".")) * factor);
    result.widthMm = Math.round(Number(dimensions[2].replace(",", ".")) * factor);
    result.heightMm = Math.round(Number(dimensions[3].replace(",", ".")) * factor);
  }
  const parts = [];
  if (result.weightG) parts.push(`${result.weightG} g`);
  if (result.lengthMm && result.widthMm && result.heightMm) parts.push(`${result.lengthMm}×${result.widthMm}×${result.heightMm} mm`);
  result.label = parts.join(" / ");
  return result;
}

function extractOzonSalesHint(text = "") {
  const value = cleanText(text);
  const match = value.match(/(?:купили|продано|sold|orders?|за\s+месяц|за\s+30\s+дн(?:ей|я))\D{0,12}(\d[\d\s]*)/i);
  const sales = match ? Number(match[1].replace(/\s/g, "")) : "";
  return { sales, source: sales ? "capture_hint" : "", label: sales ? `${sales}（页面提示）` : "" };
}

function extractOzonSearchItems() {
  const seen = new Set();
  const rows = [];
  const links = [...document.querySelectorAll('a[href*="/product/"]')];
  for (const link of links) {
    const url = normalizeOzonUrl(link.href || link.getAttribute("href") || "");
    if (!url || seen.has(url)) continue;
    const item = extractOzonCardFromLink(link, rows.length);
    if (!item) continue;
    seen.add(url);
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

function collectOzonPublicVariants(primaryTitle, primaryImage) {
  const currentUrl = new URL(location.href);
  const currentId = ozonProductIdFromUrl(currentUrl.href);
  const variants = [];
  const seen = new Set();
  const add = (url, label, image = "") => {
    const productId = ozonProductIdFromUrl(url);
    if (!productId || seen.has(productId)) return;
    seen.add(productId);
    variants.push({
      skuId: productId,
      // This is public Ozon reference data. Its RUB price intentionally stays
      // out of skuVariants.price, which the ERP treats as a CNY source cost.
      spec: cleanText(label || `Ozon ${productId}`),
      image: normalizeOzonImageUrl(image) || "",
    });
  };
  add(currentUrl.href, primaryTitle, primaryImage);
  // Ozon renders sibling color/size choices as product links with from_sku.
  // Restrict to those explicit variation links so recommendations never become
  // fake SKU rows in the ERP.
  for (const link of document.querySelectorAll('a[href*="/product/"][href*="from_sku="]')) {
    const href = link.href || link.getAttribute("href") || "";
    const label = link.getAttribute("title") || cleanText(link.innerText) || cleanText(link.querySelector("img")?.alt || "");
    const image = link.querySelector("img")?.currentSrc || link.querySelector("img")?.src || "";
    add(href, label, image);
  }
  return variants;
}

function collectOzonDomFallback() {
  const title = cleanText(document.querySelector("h1")?.innerText || document.title.replace(/\s+\|.*$/, ""));
  // Prefer the visible product gallery.  document.images also contains site
  // banners and recommendation cards, which are only a fallback after the
  // gallery and are filtered by URL.
  const galleryImages = [...document.querySelectorAll("[data-widget*='gallery' i] img, [class*='gallery' i] img")];
  const images = dedupe([...galleryImages, ...document.images]
    .map((image) => normalizeOzonImageUrl(image.currentSrc || image.src))
    .filter(isOzonProductImageUrl)
    .filter((url) => !/\/s3\/video-\d|\/vod\/video-/i.test(url))
    .slice(0, 80));

  // 提取价格
  let price = "";
  const priceEl = document.querySelector("[data-widget='webPrice'] span, .pdp-block__price .tsHeadline500Medium, [class*='price'] [class*='value']");
  if (priceEl) {
    price = parseRubPrice(priceEl.innerText);
  }
  // New Ozon product pages frequently render the actual price as a button.
  // Use a strict ₽ candidate fallback, never an arbitrary number on the page.
  if (!price) {
    const priceText = [...document.querySelectorAll("button, [data-widget*='price' i], [class*='price' i]")]
      .map(node => cleanText(node.innerText || ""))
      .find(text => /\d[\d\s.,]*₽/.test(text));
    price = parseRubPrice(priceText || "");
  }

  // 提取属性 - 多种选择器
  const attributes = [];
  const attrSelectors = [
    "[data-widget='webCharacteristics']",
    "[data-widget*='haracterist']",
    "[class*='characteristic']",
    "[class*='specification']",
    "[class*='attribute']",
    "dl",
    "table",
    "[data-widget*='DetailInfo']",
    "[data-widget*='detailInfo']",
    "[data-widget*='product-info']",
  ];
  
  const attrContainers = document.querySelectorAll(attrSelectors.join(", "));
  attrContainers.forEach((box) => {
    const text = box.innerText || "";
    for (const line of text.split(/\n+/)) {
      const parts = line.split(/\s{2,}|:|—/).map(cleanText).filter(Boolean);
      if (parts.length >= 2 && parts[0].length < 80 && parts[1].length < 240) {
        attributes.push({ name: parts[0], value: parts.slice(1).join(" ") });
      }
    }
  });

  // 回退：从页面全文中提取属性模式（如 "Тип проволока\nМатериал медь"）
  if (attributes.length < 3) {
    const bodyText = document.body?.innerText || "";
    const lines = bodyText.split(/\n+/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // 匹配 "属性名 属性值" 模式（属性名短，值在下一行或同行后半段）
      if (/^(Тип|Материал|Цвет|Размер|Вес|Длина|Ширина|Высота|Глубина|Объем|Количество|Страна|Бренд|Пол|Возраст|Сезон|Повод|Стиль|Форма|Назначение|Температура|Мощность|Напряжение|Емкость|Комплектация)/i.test(line)) {
        const parts = line.split(/\s{2,}/);
        if (parts.length >= 2) {
          attributes.push({ name: parts[0], value: parts.slice(1).join(" ") });
        } else if (i + 1 < lines.length) {
          attributes.push({ name: parts[0], value: lines[i + 1].trim() });
        }
      }
    }
  }

  const breadcrumbs = [...document.querySelectorAll('a[href*="/category/"], a[href*="/highlight/"]')]
    .map((link) => cleanText(link.innerText))
    .filter(Boolean)
    .slice(0, 8);

  // 提取评分和评论数
  let rating = "";
  let reviewCount = "";
  const ratingEl = document.querySelector("[data-widget='webRating'] span, [class*='rating'] span");
  if (ratingEl) {
    const m = ratingEl.innerText.match(/[\d,.]+/);
    if (m) rating = m[0].replace(",", ".");
  }
  const reviewEl = document.querySelector("[data-widget='webRating'] a, a[href*='review']");
  if (reviewEl) {
    const m = reviewEl.innerText.match(/\d+/);
    if (m) reviewCount = m[0];
  }
  if (!rating || !reviewCount) {
    const ratingMatch = (document.body?.innerText || "").match(/(\d[,.]\d)\s*[•·]\s*([\d\s]+)\s*(?:отзыв|review)/i);
    if (ratingMatch) {
      if (!rating) rating = ratingMatch[1].replace(",", ".");
      if (!reviewCount) reviewCount = ratingMatch[2].replace(/\s/g, "");
    }
  }

  return {
    url: location.href,
    productId: ozonProductIdFromUrl(location.href),
    title,
    price,
    rating,
    reviewCount,
    image: images[0] || "",
    images,
    // A complete public-page re-capture is allowed to replace an earlier
    // blind-DOM snapshot, removing stale banners and blank pseudo-image URLs.
    mediaComplete: images.length > 0,
    skuVariants: collectOzonPublicVariants(title, images[0] || ""),
    category: breadcrumbs.join(" > "),
    packageInfo: extractOzonPackageHint(document.body?.innerText || ""),
    salesHint: extractOzonSalesHint(document.body?.innerText || ""),
    attributes: dedupeBy(attributes, (item) => `${item.name}:${item.value}`).slice(0, 80),
    description: cleanText(document.body?.innerText || "").slice(0, 4000),
    collectedAt: new Date().toISOString(),
  };
}

function parseOzonWidgetStates(payload = {}) {
  const states = payload && typeof payload.widgetStates === "object" ? payload.widgetStates : {};
  return Object.entries(states).map(([key, value]) => {
    if (value && typeof value === "object") return { key, value };
    try { return { key, value: JSON.parse(String(value || "")) }; } catch { return { key, value: null }; }
  }).filter((entry) => entry.value && typeof entry.value === "object");
}

function findOzonWidget(states, name) {
  return states.find((entry) => entry.key.toLowerCase().includes(name.toLowerCase()))?.value || null;
}

function ozonWidgetImages(gallery) {
  return dedupe((Array.isArray(gallery?.images) ? gallery.images : [])
    .map((item) => normalizeOzonImageUrl(item?.src || item?.url || item?.image?.src || ""))
    .filter(isOzonProductImageUrl));
}

// [Iteration 2026-09-22 v0.7.67] ---- Ozon PDP video / brand / category / rating ----
function ozonVideoIdFromUrl(url) {
  // Standard product CDN: https://v-1.ozone.ru/vod/video-72/<ULID>/asset_3_h264.mp4?type=pdp
  const m = String(url || "").match(/\/vod\/video-7\d\/([0-9A-Za-z]{16,})\//);
  return m ? m[1] : "";
}
function normalizeOzonVideoEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const u = String(raw.url || raw.videoUrl || raw.src || "").trim();
  if (!u || !/\.mp4(\?|$)/i.test(u)) return null;
  return {
    url: u,
    coverUrl: String(raw.coverUrl || raw.previewUrl || raw.cover || "").trim(),
    title: cleanText(raw.name || raw.title || ""),
    videoId: String(raw.videoId || raw.uuid || ozonVideoIdFromUrl(u) || "").trim(),
  };
}
// The product's OWN videos only. webGallery.videos carries ?type=pdp; buyer
// review / recommendation clips (?type=review) must never become product media.
function ozonPdpVideos(states) {
  const gallery = findOzonWidget(states, "webGallery");
  const out = [];
  const seen = new Set();
  for (const source of (Array.isArray(gallery?.videos) ? gallery.videos : [])) {
    const item = normalizeOzonVideoEntry(source);
    if (!item || !/type=pdp/i.test(item.url) || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
// Test contract: prefer the PDP video; fall back to a webListPhotos review clip
// only when the product has no own video. The collect flow itself uses
// ozonPdpVideos (strict) so buyer-review clips are never collected as the video.
function ozonVideoFromStates(states) {
  const own = ozonPdpVideos(states);
  if (own.length) return own[0];
  const photos = findOzonWidget(states, "webListPhotos");
  for (const media of (Array.isArray(photos?.mediaContent) ? photos.mediaContent : [])) {
    if (!media || String(media.type || "").toUpperCase() !== "VIDEO") continue;
    const item = normalizeOzonVideoEntry({ url: media.videoUrl, coverUrl: media.previewUrl, videoId: media.uuid, name: "" });
    if (item) return item;
  }
  return null;
}
// [Iteration 2026-09-22 v0.7.68] On PDP the Product JSON-LD is rendered in the DOM as
// <script type="application/ld+json">; the composer API response has no seo widget, so the
// previous payload.seo.script path came back empty. Read DOM JSON-LD first (content scripts
// share the DOM), then fall back to composer seo for older layouts / vm tests.
function ozonDomJsonLd() {
  const out = [];
  try {
    if (typeof document === "undefined" || !document || !document.querySelectorAll) return out;
    const nodes = document.querySelectorAll('script[type="application/ld+json"]');
    Array.prototype.forEach.call(nodes, (node) => {
      try {
        const txt = (node.textContent || node.innerText || "").trim();
        if (!txt) return;
        const parsed = JSON.parse(txt);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        arr.forEach((o) => { if (o && typeof o === "object") out.push(o); });
      } catch (_) { /* one malformed ld+json block should not break the rest */ }
    });
  } catch (_) { /* document unavailable (vm unit tests) */ }
  return out;
}
function ozonPickProductLd(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.find((o) => {
    const t = String((o && o["@type"]) || "").toLowerCase();
    return t === "product" || Boolean(o && (o.brand || o.aggregateRating || o.offers));
  }) || arr[0] || null;
}
function ozonStructuredSeo(payload) {
  const out = { title: "", brand: "", rating: "", reviewCount: "", description: "", image: "" };
  try {
    let data = ozonPickProductLd(ozonDomJsonLd());
    if (!data) {
      const script = payload?.seo?.script?.[0]?.innerHTML;
      data = script ? JSON.parse(script) : null;
    }
    out.title = cleanText(data?.name || data?.title || "");
    const brand = data?.brand;
    out.brand = cleanText(typeof brand === "object" ? (brand?.name || brand?.brand || "") : brand);
    const agg = data?.aggregateRating || {};
    out.rating = cleanText(agg.ratingValue || agg.rating || "");
    out.reviewCount = cleanText(agg.reviewCount || agg.ratingCount || "");
    out.description = String(data?.description || "").trim();
    out.image = cleanText(Array.isArray(data?.image) ? data.image[0] : data?.image);
  } catch (_) { /* JSON-LD absent */ }
  return out;
}
function ozonStructuredCategory(states, brandName) {
  const widget = findOzonWidget(states, "breadCrumbs") || findOzonWidget(states, "breadcrumbs");
  const crumbs = Array.isArray(widget?.breadcrumbs) ? widget.breadcrumbs : [];
  const parts = crumbs.map((c) => cleanText(c?.text || c?.name || "")).filter(Boolean);
  // Ozon appends the brand directory as the final crumb; drop it.
  if (brandName && parts.length && parts[parts.length - 1].toLowerCase() === String(brandName).toLowerCase()) parts.pop();
  return parts.join(" > ");
}
function ozonBrandFromAttributes(attributes) {
  for (const attr of (attributes || [])) {
    const name = String(attr?.name || "").trim();
    if (/^(бренд|brand|торговая марка|изготовитель|品牌)\b/i.test(name) || /бренд|brand|品牌/i.test(name)) {
      return cleanText(attr?.value || "");
    }
  }
  return "";
}

function ozonWidgetPrice(priceWidget, fallback = "") {
  const candidate = priceWidget?.cardPrice || priceWidget?.price || priceWidget?.marketingPrice || fallback;
  return parseRubPrice(typeof candidate === "object" ? candidate?.value || candidate?.price || "" : candidate);
}

function ozonStructuredAttributes(states) {
  const result = [];
  for (const { key, value } of states) {
    if (!/webcharacteristics|characteristics/i.test(key) || !Array.isArray(value?.characteristics)) continue;
    for (const section of value.characteristics) {
      for (const block of [section?.short, section?.long]) {
        if (!Array.isArray(block)) continue;
        for (const row of block) {
          const name = cleanText(row?.name || row?.title || "");
          const valueText = cleanText((row?.values || []).map((item) => item?.text || item?.value || "").filter(Boolean).join(", "));
          if (name && valueText) result.push({ name, value: valueText });
        }
      }
    }
  }
  return dedupeBy(result, (item) => `${item.name}:${item.value}`);
}

// [Iteration 2026-09-23 v0.7.69] Package weight & dimensions live in the
// entrypoint webCharacteristics widget (keys "Weight" / "Dimensions"), not in
// the composer payload. Parse them by language-independent keys (translated
// names as fallback) into packageInfo, which the backend bridge maps to each
// variant's weight_g / length_mm / width_mm / height_mm.
function ozonPackageInfoFromStates(states) {
  const pkg = { weightG: "", lengthMm: "", widthMm: "", heightMm: "", label: "" };
  let weightText = "";
  let dimsText = "";
  for (const { key, value } of states) {
    if (!/webcharacteristics|characteristics/i.test(key) || !Array.isArray(value && value.characteristics)) continue;
    for (const section of value.characteristics) {
      // [Iteration 2026-09-23 v0.7.71] A section may itself be a single row
      // ({key,name,values}) with no short/long wrapper (real PDP Weight/
      // Dimensions). Include the section itself in that case.
      const blocks = [section && section.short, section && section.long];
      if (section && (section.key || Array.isArray(section.values))) blocks.push([section]);
      for (const block of blocks) {
        if (!Array.isArray(block)) continue;
        for (const row of block) {
          const rk = String((row && row.key) || "");
          const nm = String((row && row.name) || "");
          const text = cleanText(((row && row.values) || []).map((it) => (it && (it.text || it.value)) || "").filter(Boolean).join(", "));
          if (!weightText && (/^weight/i.test(rk) || /(вес товара|商品重量|item weight|product weight)/i.test(nm))) weightText = text;
          if (!dimsText && (/^dimension/i.test(rk) || /(габарит|размеры|dimension|尺寸)/i.test(nm))) dimsText = text;
        }
      }
    }
  }
  const wm = String(weightText).match(/\d+(?:[.,]\d+)?/);
  if (wm) pkg.weightG = wm[0].replace(",", ".");
  const nums = String(dimsText).match(/\d+(?:[.,]\d+)?/g) || [];
  if (nums.length >= 3) {
    pkg.lengthMm = nums[0].replace(",", ".");
    pkg.widthMm = nums[1].replace(",", ".");
    pkg.heightMm = nums[2].replace(",", ".");
  }
  const parts = [];
  if (pkg.weightG) parts.push(pkg.weightG + " g");
  if (pkg.lengthMm && pkg.widthMm && pkg.heightMm) parts.push(pkg.lengthMm + "x" + pkg.widthMm + "x" + pkg.heightMm + " mm");
  pkg.label = parts.join(" / ");
  return pkg;
}

function ozonStructuredDescription(states) {
  const text = [];
  const images = [];
  let richContent = null;
  for (const { key, value } of states) {
    if (!/webdescription|description/i.test(key)) continue;
    if (value?.richAnnotation) text.push(String(value.richAnnotation));
    const content = value?.richAnnotationJson?.content;
    if (Array.isArray(content)) {
      richContent ||= value.richAnnotationJson;
      for (const section of content) for (const block of (section?.blocks || [])) {
        const image = normalizeOzonImageUrl(block?.img?.src || "");
        if (isOzonProductImageUrl(image)) images.push(image);
        const blockText = cleanText(block?.text || block?.content || "");
        if (blockText) text.push(blockText);
      }
    }
  }
  return { description: cleanText(text.join("\n")), detailImages: dedupe(images), richContent };
}

function ozonStructuredSeller(states) {
  const candidates = ["webCurrentSeller", "webSellerInfo"].flatMap((widgetName) =>
    states.filter((entry) => entry.key.toLowerCase().includes(widgetName.toLowerCase())).map((entry) => entry.value)
  );
  for (const seller of candidates) {
    const source = seller?.seller || seller?.data?.seller || seller?.data || seller || {};
    const sellerId = String(source?.id || source?.sellerId || source?.seller_id || "").trim();
    const sellerName = cleanText(source?.name || source?.sellerName || source?.title || "");
    const sellerLink = String(source?.link || source?.url || source?.sellerUrl || "").trim();
    const sellerUrl = sellerLink ? normalizeOzonUrl(sellerLink) : "";
    if (sellerId || sellerName || sellerUrl) return { sellerId, sellerName, sellerUrl };
  }
  return { sellerId: "", sellerName: "", sellerUrl: "" };
}

function ozonAspectVariants(states, currentUrl) {
  const aspects = findOzonWidget(states, "webAspects")?.aspects || [];
  const rows = new Map();
  for (const aspect of aspects) {
    const name = cleanText(aspect?.descriptionRs?.[0]?.content || aspect?.name || "").replace(/:\s*$/, "");
    for (const variant of (aspect?.variants || [])) {
      const skuId = String(variant?.sku || variant?.data?.sku || "").trim();
      if (!skuId) continue;
      const current = rows.get(skuId) || { skuId, properties: [], url: "", price: "", image: "", title: "" };
      const value = cleanText(variant?.data?.searchableText || variant?.data?.title || variant?.title || "");
      if (name && value && !current.properties.some((item) => item.name === name && item.value === value)) current.properties.push({ name, value });
      current.title = cleanText(variant?.data?.title || variant?.title || current.title);
      current.url = normalizeOzonUrl(variant?.link || currentUrl) || current.url;
      current.price = ozonWidgetPrice(null, variant?.data?.price || current.price);
      current.image = normalizeOzonImageUrl(upgradeOzonThumbUrl(variant?.data?.coverImage || current.image));
      rows.set(skuId, current);
    }
  }
  return [...rows.values()];
}

function ozonAspectOptions(states) {
  const aspects = findOzonWidget(states, "webAspects")?.aspects || [];
  return aspects.map((aspect, index) => {
    const name = cleanText(aspect?.descriptionRs?.[0]?.content || aspect?.name || `属性${index + 1}`).replace(/:\s*$/, "");
    const options = (aspect?.variants || []).map((variant, optionIndex) => ({
      skuId: String(variant?.sku || variant?.data?.sku || variant?.data?.skuId || "").trim(),
      value: cleanText(variant?.data?.searchableText || variant?.data?.title || variant?.title || ""),
      url: normalizeOzonUrl(variant?.link || ""),
      image: normalizeOzonImageUrl(variant?.data?.coverImage || variant?.data?.image || ""),
      priceRub: ozonWidgetPrice(null, variant?.data?.price || ""),
      index: optionIndex,
    })).filter(option => option.value || option.skuId || option.url);
    return { name, options };
  }).filter(aspect => aspect.options.length);
}

function isOzonStyleAspect(aspect) {
  const name = String(aspect?.name || "");
  return aspect?.options?.some(option => option.image) || /(颜色|花色|图案|款式|color|цвет|style|model)/i.test(name);
}

function isOzonSizeAspect(aspect) {
  return /(尺寸|尺码|大小|长[度]?|宽[度]?|size|dimension|length|width|размер|длин|ширин)/i.test(String(aspect?.name || ""));
}

function buildOzonStyleSizeRows(style, states, fallbackImages = []) {
  const aspects = ozonAspectOptions(states);
  const sizeAspect = aspects.find(aspect => isOzonSizeAspect(aspect) && aspect.name !== style.name);
  const sizes = sizeAspect?.options || [];
  const gallery = findOzonWidget(states, "webGallery");
  const images = ozonWidgetImages(gallery).length ? ozonWidgetImages(gallery) : fallbackImages;
  const styleId = `${style.name}:${style.value || style.skuId || style.index}`;
  const styleImage = style.image || images[0] || "";
  const toRow = (size, index) => ({
    skuId: String(size?.skuId || style.skuId || `${styleId}:${index + 1}`),
    spec: `${style.name}: ${style.value}${size?.value ? ` / ${sizeAspect.name}: ${size.value}` : ""}`,
    image: styleImage,
    imageUrls: images.length ? images : (styleImage ? [styleImage] : []),
    styleId,
    styleLabel: style.value || style.name,
    // A style option price is evidence only for that style SKU, not for every
    // size underneath it. Size rows receive a price only from their own option.
    priceRub: size ? (size.priceRub || "") : (style.priceRub || ""),
  });
  return sizes.length ? sizes.map(toRow) : [toRow(null, 0)];
}

async function fetchOzonPageJson(productUrl, endpoint = "composer", timeoutMs = 7000) {
  const target = new URL(productUrl, location.origin);
  if (!/(^|\.)ozon\.ru$/i.test(target.hostname)) return null;
  const apiPath = endpoint === "entrypoint" ? "/api/entrypoint-api.bx/page/json/v2" : "/api/composer-api.bx/page/json/v2";
  const api = new URL(apiPath, target.origin);
  let pagePath = `${target.pathname}${target.search || ""}`;
  if (endpoint === "entrypoint") {
    pagePath = `${target.pathname}?layout_container=pdpPage2column&layout_page_index=2&oos_search=false`;
  }
  api.searchParams.set("url", pagePath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(api.toString(), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function ozonStructuredTitle(payload) {
  try {
    let data = ozonPickProductLd(ozonDomJsonLd());
    if (!data) {
      const script = payload?.seo?.script?.[0]?.innerHTML;
      data = script ? JSON.parse(script) : null;
    }
    return cleanText(data?.name || data?.title || "");
  } catch { return ""; }
}

async function collectOzonDetail() {
  const fallback = collectOzonDomFallback();
  const [primaryPayload, detailPayload] = await Promise.all([
    fetchOzonPageJson(location.href, "composer", 6000),
    fetchOzonPageJson(location.href, "entrypoint", 6000),
  ]);
  if (!primaryPayload) return { ...fallback, parseIssues: ["未获取到 Ozon 结构化页面数据，已使用页面可见内容"] };
  const primaryStates = parseOzonWidgetStates(primaryPayload);
  const primaryGallery = findOzonWidget(primaryStates, "webGallery");
  const primaryImages = ozonWidgetImages(primaryGallery);
  const primaryAspects = ozonAspectVariants(primaryStates, location.href);
  // Ozon variants arrive as independent aspect dimensions (colour × quantity,
  // colour × size, or more), and every SKU is a real combination that carries
  // its own thumbnail in webAspects. Merge every aspect value per SKU so a
  // capture always knows all of its dimensions — the old style×size model
  // silently dropped the "每包数量/Qty" dimension and reused the style
  // thumbnail for every SKU underneath it. This model works for any category.
  const primaryAspectOptions = ozonAspectOptions(primaryStates);
  const styleAspect = primaryAspectOptions.find(isOzonStyleAspect);
  const styleDimName = styleAspect?.name || "";
  // Every SKU keeps its own image. Ozon distinguishes the colour image from the
  // product cover precisely because one SKU's picture is unique — e.g. a silicone
  // plate in 10 sizes has 10 annotated photos (one per size) as product covers.
  // Reusing a style image across the SKUs under it would defeat telling SKUs
  // apart by picture, so each SKU row carries its own image (one SKU per row).
  const aspectDimNames = primaryAspectOptions.map((item) => item.name);
  const currentProductId = ozonProductIdFromUrl(location.href);
  const variants = [];
  const variantGroups = [];
  const seenSku = new Set();
  for (const row of primaryAspects) {
    if (!row.skuId || seenSku.has(row.skuId)) continue;
    seenSku.add(row.skuId);
    const properties = [...(row.properties || [])];
    // Ozon does not list every combination under every aspect: a colour SKU
    // may appear only in the colour aspect while its quantity is encoded in
    // the variant title ("烹饪铲, 1 个"). Backfill a missing dimension from
    // that title so every SKU knows all of its variant values.
    for (const dimName of aspectDimNames) {
      if (properties.some((item) => item.name === dimName)) continue;
      if (!/数量|колич|qty|quantity|шт|pcs/i.test(dimName)) continue;
      const qtyMatch = String(row.title || "").match(/(\d+)\s*(?:个|шт\.?|pcs)/i);
      if (qtyMatch) properties.push({ name: dimName, value: qtyMatch[1] });
    }
    const spec = properties.map((item) => `${item.name}: ${item.value}`).join(" / ");
    const styleProp = styleDimName ? properties.find((item) => item.name === styleDimName) : null;
    const styleValue = styleProp?.value || properties[0]?.value || "";
    const styleId = styleDimName ? `${styleDimName}:${styleValue}` : (styleValue ? `款式:${styleValue}` : row.skuId);
    const styleLabel = styleValue || styleDimName || "款式";
    variants.push({
      skuId: row.skuId,
      spec,
      image: row.image || primaryImages[0] || "",
      styleId,
      styleLabel,
      imageUrls: primaryImages.length ? primaryImages : (row.image ? [row.image] : []),
      priceRub: row.price || "",
    });
    const group = variantGroups.find((item) => item.styleId === styleId);
    if (group) group.skuIds.push(row.skuId);
    else variantGroups.push({ styleId, styleLabel, skuIds: [row.skuId], imageUrls: [row.image].filter(Boolean) });
  }
  if (!variants.length && currentProductId) {
    variants.push({ skuId: currentProductId, spec: cleanText(primaryGallery?.title || `Ozon ${currentProductId}`), image: primaryImages[0] || "", styleId: currentProductId, styleLabel: cleanText(primaryGallery?.title || ""), imageUrls: primaryImages });
    variantGroups.push({ styleId: currentProductId, styleLabel: cleanText(primaryGallery?.title || ""), skuIds: [currentProductId], imageUrls: primaryImages });
  }
  const detailStates = parseOzonWidgetStates(detailPayload || {});
  const structuredDescription = ozonStructuredDescription(detailStates);
  const structuredAttributes = ozonStructuredAttributes(detailStates);
  const packageInfo = ozonPackageInfoFromStates(detailStates);
  const seller = ozonStructuredSeller([...primaryStates, ...detailStates]);
  // [Iteration 2026-09-22 v0.7.67] authoritative brand / rating / reviewCount /
  // description from the page's JSON-LD, category from breadCrumbs widget.
  const seo = ozonStructuredSeo(primaryPayload);
  const attrsForBrand = structuredAttributes.length ? structuredAttributes : fallback.attributes;
  const brand = seo.brand || ozonBrandFromAttributes(attrsForBrand) || "";
  const category = ozonStructuredCategory(primaryStates, brand) || fallback.category || "";
  const scoreWidget = findOzonWidget(primaryStates, "webReviewProductScore") || findOzonWidget(primaryStates, "webSingleProductScore");
  const rating = seo.rating || cleanText(scoreWidget?.totalScore || "") || fallback.rating || "";
  const reviewCount = seo.reviewCount || cleanText(scoreWidget?.reviewsCount || "") || fallback.reviewCount || "";
  // Product's own PDP video(s) only; buyer-review clips are never collected.
  const pdpVideos = ozonPdpVideos(primaryStates);
  const video = pdpVideos[0] || null;
  const title = seo.title || ozonStructuredTitle(primaryPayload) || fallback.title;
  const price = ozonWidgetPrice(findOzonWidget(primaryStates, "webPrice"), fallback.price);
  const images = primaryImages.length ? primaryImages : fallback.images;
  const description = structuredDescription.description || seo.description || fallback.description;
  return {
    ...fallback,
    title,
    price,
    image: images[0] || "",
    images,
    mediaComplete: images.length > 0,
    skuVariants: variants.length ? variants : fallback.skuVariants,
    variantGroups,
    detailImages: structuredDescription.detailImages,
    richContent: structuredDescription.richContent,
    attributes: structuredAttributes.length ? structuredAttributes : fallback.attributes,
    description,
    // [Iteration 2026-09-23 v0.7.72] ship precise entrypoint packageInfo; DOM fallback only when it is absent
    packageInfo: packageInfo.label ? packageInfo : (fallback.packageInfo && fallback.packageInfo.label ? fallback.packageInfo : packageInfo),
    brand,
    category,
    rating,
    reviewCount,
    video,
    videos: pdpVideos,
    ...seller,
    captureSource: "ozon_page_json_v3",
    parseIssues: variants.length ? [] : ["结构化页面数据未返回可识别变体，已保留页面变体回退"],
  };
}

async function sendToErp(payload) {
  return erpRequest("/api/1688/capture", {
    method: "POST",
    body: payload,
  });
}

if (window.__OZON_ERP_COLLECTOR_TEST__) {
  Object.assign(window.__OZON_ERP_COLLECTOR_TEST__, {
    parseOzonWidgetStates,
    ozonAspectVariants,
    ozonAspectOptions,
    buildOzonStyleSizeRows,
    ozonWidgetImages,
    ozonStructuredAttributes,
    ozonStructuredDescription,
    ozonStructuredSeller,
    ozonVideoFromStates,
    ozonPdpVideos,
    ozonStructuredSeo,
    ozonStructuredCategory,
    ozonDomJsonLd,
    ozonPickProductLd,
    ozonPackageInfoFromStates,
    toFiniteNumber,
    positiveNumber,
    mmToCm,
    gToKg,
    selectSingleOzonSku,
    calculateMvideoPrice,
    buildMvideoReviewGates,
    buildMvideoSingleSkuPreviewModel,
  });
}

getExtensionRuntime()?.onMessage?.addListener?.((message, _sender, sendResponse) => {
  if (message?.type === "PING_1688_COLLECTOR_061") {
    sendResponse({ ok: true, version: COLLECTOR_VERSION });
    return false;
  }
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
  if (message?.type === "START_1688_SHOP_SCAN") {
    const button = document.querySelector("#ozon-erp-shop-scan-start");
    if (!button || button.disabled) {
      sendResponse({ ok: false, error: document.querySelector("#ozon-erp-shop-scan-status")?.textContent || "请进入店铺全部商品页" });
      return false;
    }
    button.click();
    sendResponse({ ok: true, version: COLLECTOR_VERSION });
    return false;
  }
  if (message?.type === "COLLECT_1688_PRODUCT_RAW") {
    (async () => {
      try {
        const payload = await collectPage({ includeVideo: message.includeVideo !== false, storeId: message.storeId || "" });
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
        sendResponse({ ok: true, payload: await collectOzonDetail(), needsHuman: pageNeedsOzonHumanCheck() });
      } catch (error) {
        sendResponse({ ok: false, error: error.message, needsHuman: pageNeedsOzonHumanCheck() });
      }
    })();
    return true;
  }
  return false;
});

getExtensionRuntime()?.onMessage?.addListener?.((message, _sender, sendResponse) => {
  if (message?.type === "PING_1688_COLLECTOR") {
    sendResponse({ ok: true, version: COLLECTOR_VERSION });
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
         title: result.title || payload.title || "",
          imageCount: payload.images.length,
        url: payload.url,
         receivedAt: result.receivedAt || "",
         imageCount: result.imageCount ?? payload.images.length,
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
