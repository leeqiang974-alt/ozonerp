(function () {
  const isOzon = /(^|\.)ozon\.ru$/i.test(location.hostname);

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
  });
})();
