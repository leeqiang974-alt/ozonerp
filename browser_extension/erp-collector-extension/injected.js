(function () {
  const isOzon = /(^|\.)ozon\.ru$/i.test(location.hostname);
  const is1688 = /(^|\.)1688\.com$/i.test(location.hostname);
  let replay1688SkuData = () => {};

  function publishJson(url, payload) {
    if (!isOzon || !url || !payload || typeof payload !== "object") return;
    try {
      const encoded = JSON.stringify(payload);
      if (encoded.length > 900000) return;
      window.postMessage({ type: "OZON_ERP_NETWORK_JSON", url, payload }, "*");
    } catch {}
  }

  if (isOzon && !window.__ozonErpNetworkHooks) {
    window.__ozonErpNetworkHooks = true;
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const requestUrl = String(args[0]?.url || args[0] || response.url || "");
      if (/api|composer|analytics|search/i.test(requestUrl)) {
        response.clone().json().then((payload) => publishJson(requestUrl, payload)).catch(() => {});
      }
      return response;
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__ozonErpRequestUrl = String(url || "");
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        const requestUrl = this.__ozonErpRequestUrl || this.responseURL || "";
        if (!/api|composer|analytics|search/i.test(requestUrl)) return;
        try {
          const payload = typeof this.response === "object" ? this.response : JSON.parse(this.responseText || "");
          publishJson(requestUrl, payload);
        } catch {}
      });
      return originalSend.apply(this, args);
    };
  }

  if (is1688 && !window.__ozonErp1688NetworkHooks) {
    window.__ozonErp1688NetworkHooks = true;
    const skuData = window.__ozonErp1688SkuData = {};
    function recordSku(url, payload) {
      if (!url || !payload || typeof payload !== "object") return;
      const u = String(url).toLowerCase();
      if (/sku|price|offer.*detail|detail.*offer|spec|prop|product|pifa|consign/i.test(u)) {
        try {
          if (JSON.stringify(payload).length > 900000) return;
        } catch { return; }
        const key = u.slice(0, 160);
        skuData[key] = payload;
        try {
          window.postMessage({ type: "OZON_ERP_1688_SKU_DATA", url, payload }, "*");
        } catch {}
      }
    }
    function publishSkuStateSnapshots() {
      const snapshots = [];
      const seen = new WeakSet();
      let visitedCount = 0;
      const visit = (value, depth = 0, fieldName = "") => {
        if (!value || typeof value !== "object" || depth > 8 || seen.has(value) || snapshots.length >= 20 || visitedCount >= 5000) return;
        visitedCount += 1;
        seen.add(value);
        if (/(sku|spec)(map|list|infos?|arr|data|prices?|inventory|props)?/i.test(fieldName)) {
          try {
            if (JSON.stringify(value).length <= 500000) snapshots.push({ [fieldName || "skuSnapshot"]: value });
          } catch {}
        }
        if (Array.isArray(value)) {
          value.slice(0, 1000).forEach((child) => visit(child, depth + 1));
          return;
        }
        Object.entries(value).slice(0, 1500).forEach(([key, child]) => visit(child, depth + 1, key));
      };
      [window.context, window.__INIT_DATA__, window.__GLOBAL_DATA__, window.__INITIAL_STATE__, window.__PRELOADED_STATE__]
        .forEach((source) => visit(source));
      snapshots.forEach((snapshot, index) => recordSku(`page-state://sku-snapshot/${index}`, { data: snapshot }));
    }
    replay1688SkuData = () => {
      Object.entries(window.__ozonErp1688SkuData || {}).forEach(([url, payload]) => {
        try {
          window.postMessage({ type: "OZON_ERP_1688_SKU_DATA", url, payload }, "*");
        } catch {}
      });
      publishSkuStateSnapshots();
    };
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const requestUrl = String(args[0]?.url || args[0] || response.url || "");
      response.clone().json().then((p) => recordSku(requestUrl, p)).catch(() => {});
      return response;
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__ozonErp1688Url = String(url || "");
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        const requestUrl = this.__ozonErp1688Url || this.responseURL || "";
        try {
          const payload = typeof this.response === "object" ? this.response : JSON.parse(this.responseText || "");
          recordSku(requestUrl, payload);
        } catch {}
      });
      return originalSend.apply(this, args);
    };
    setTimeout(replay1688SkuData, 0);
  }

  function sendContext() {
    let context = null;
    try {
      context = window.context || null;
    } catch {
      context = null;
    }
    window.postMessage({
      type: "OZON_ERP_1688_CONTEXT",
      context,
      href: location.href,
      title: document.title,
    }, "*");
  }

  sendContext();
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "OZON_ERP_1688_REQUEST_CONTEXT") {
      sendContext();
    }
    if (event.data?.type === "OZON_ERP_1688_REQUEST_SKU_DATA" && is1688) {
      replay1688SkuData();
    }
    if (event.data?.type === "OZON_ERP_1688_SHOP_SCAN_START") {
      scan1688ShopCatalog(event.data).catch((error) => window.postMessage({
        type: "OZON_ERP_1688_SHOP_SCAN_ERROR",
        requestId: event.data.requestId,
        error: error?.message || "店铺清单扫描失败",
      }, "*"));
    }
  });

  function requestMtop(options) {
    const client = window.lib?.mtop || window.mtop || window.Mtop;
    if (!client || typeof client.request !== "function") throw new Error("当前页面没有加载1688店铺列表服务，请进入店铺“全部商品”页重试");
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      const fail = (value) => { if (!settled) { settled = true; reject(new Error(value?.ret?.join?.("；") || value?.message || "1688列表请求失败")); } };
      try {
        const result = client.request(options, done, fail);
        if (result && typeof result.then === "function") result.then(done, fail);
      } catch (error) { fail(error); }
    });
  }

  function extractSellerMemberId(source) {
    if (!source) return "";
    let text = typeof source === "string" ? source : JSON.stringify(source);
    try { text = decodeURIComponent(text); } catch {}
    text = text.replaceAll("&quot;", '"').replaceAll("\\\"", '"').replaceAll("\\/", "/");
    const patterns = [
      /sellerMemberId\s*["'=:\s]+([\w-]{3,160})/i,
      /memberId\s*["'=:\s]+([\w-]{3,160})/i,
      /[?&](?:sellerMemberId|memberId)=([\w-]{3,160})/i,
      /"memberId"\s*:\s*"([^"]{3,160})"/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1] && !/^(null|undefined|true|false)$/i.test(match[1])) return match[1];
    }
    return "";
  }

  async function findSellerMemberId() {
    for (const source of [window.context, window.__INIT_DATA__, window.__GLOBAL_DATA__, document.documentElement.innerHTML]) {
      if (!source) continue;
      const memberId = extractSellerMemberId(source);
      if (memberId) return memberId;
    }
    for (const node of document.querySelectorAll("[data-member-id],[data-memberid],[data-seller-member-id],a[href*='memberId']")) {
      const memberId = extractSellerMemberId(node.outerHTML || node.getAttribute("href") || "");
      if (memberId) return memberId;
    }
    try {
      const response = await fetch(location.href, { credentials: "include", cache: "no-store" });
      if (response.ok) {
        const memberId = extractSellerMemberId(await response.text());
        if (memberId) return memberId;
      }
    } catch {}
    return "";
  }

  function currentShopCategoryId() {
    return (location.pathname.match(/offerlist_(\d+)\.htm/i) || location.search.match(/[?&](?:catId|categoryId)=(\d+)/i))?.[1] || "";
  }

  function unwrapShopList(response) {
    let value = response?.data ?? response;
    if (typeof value === "string") try { value = JSON.parse(value); } catch {}
    if (typeof value?.content === "string") try { value.content = JSON.parse(value.content); } catch {}
    const content = value?.content || value?.data?.content || value || {};
    return { total: Number(content.offerCount || content.totalCount || 0), list: Array.isArray(content.offerList) ? content.offerList : [] };
  }

  async function requestShopListPage(memberId, categoryId, pageNum) {
    const params = { appName: "pcmodules", appdata: { catId: categoryId, count: 30, mixFilter: false, pageNum, quantityBegin: null, sellerRecommendFilter: false, sortType: "wangpu_score", tradenumFilter: false }, memberId, resourceName: "wpOfferColumn", type: "view", version: "1.0.0" };
    const response = await requestMtop({ api: "mtop.alibaba.alisite.cbu.server.ModuleAsyncService", v: "1.0", type: "POST", dataType: "json", data: { componentKey: "Wp_pc_common_offerlist", params: JSON.stringify(params) } });
    return unwrapShopList(response);
  }

  async function scan1688ShopCatalog(message) {
    if (!/page\/offerlist|offerlist_/i.test(location.href)) throw new Error("请先进入1688店铺的“全部商品”或分类商品页");
    const memberId = await findSellerMemberId();
    if (!memberId) throw new Error("没有识别到店铺 memberId，请刷新店铺全部商品页后重试");
    const categoryId = currentShopCategoryId();
    let pageNum = Math.max(1, Number(message.startPage || 1));
    let total = Number(message.expectedTotal || 0);
    for (let pageCount = 0; pageCount < 2000; pageCount += 1, pageNum += 1) {
      const result = await requestShopListPage(memberId, categoryId, pageNum);
      if (result.total > 0) total = result.total;
      const items = result.list.map((item) => ({ offerId: String(item?.id || item?.offerId || "").trim(), title: String(item?.title || item?.subject || "").trim(), image: String(item?.imageUrl || item?.offerImgUrl || item?.picUrl || "").replace(/^\/\//, "https://"), url: item?.id || item?.offerId ? `https://detail.1688.com/offer/${item.id || item.offerId}.html` : "" })).filter((item) => /^\d+$/.test(item.offerId));
      const finished = items.length === 0 || (total > 0 && pageNum >= Math.ceil(total / 30)) || items.length < 30;
      window.postMessage({ type: "OZON_ERP_1688_SHOP_SCAN_PAGE", requestId: message.requestId, memberId, categoryId, pageNum, total, items, finished }, "*");
      if (finished) return;
      await new Promise((resolve) => setTimeout(resolve, 650 + Math.floor(Math.random() * 500)));
    }
    throw new Error("店铺页数超过安全上限，扫描已暂停");
  }
})();
