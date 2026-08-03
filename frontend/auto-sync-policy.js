(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AutoSyncPolicy = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const viewResources = Object.freeze({
    dashboard: ["products", "fbs_postings"],
    orders: ["fbs_postings", "fbs_product_images"],
    products: ["products"],
    listing: ["categories"],
    shops: [],
    pricing: [],
    sync: [],
  });

  function resourcesForView(view) {
    return [...(viewResources[view] || [])];
  }

  function createAutoSyncController({ post, wait = () => new Promise(resolve => setTimeout(resolve, 1500)), onStatus = () => {} }) {
    const inFlight = new Map();
    return {
      async activate({ shopId, view, loadLocal }) {
        await loadLocal();
        if (!shopId || resourcesForView(view).length === 0) return [];
        const key = `${shopId}:${view}`;
        if (inFlight.has(key)) return inFlight.get(key);
        const request = (async () => {
          try {
            const decisions = await post(shopId, view);
            onStatus(decisions);
            if (decisions.some(item => item.status === "started")) {
              await wait();
              await loadLocal();
            }
            return decisions;
          } finally {
            inFlight.delete(key);
          }
        })();
        inFlight.set(key, request);
        return request;
      },
    };
  }

  return { createAutoSyncController, resourcesForView };
});
