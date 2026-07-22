const baseUrl = process.env.OZON_ERP_SMOKE_URL || "http://127.0.0.1:5178/";

const response = await fetch(baseUrl, { headers: { accept: "text/html" } });
if (!response.ok) throw new Error(`frontend returned HTTP ${response.status}`);
const html = await response.text();

// Keep one business-state contract in the runtime smoke: the product page
// must be able to tell a seller that a filter matched nothing, rather than
// presenting it as an unread/empty store. This is a source-backed check of the
// served bundle, not a claim that a live Seller API account was read.
const appResponse = await fetch(new URL("/app.js", baseUrl), { headers: { accept: "text/javascript" } });
if (!appResponse.ok) throw new Error(`app.js returned HTTP ${appResponse.status}`);
const appSource = await appResponse.text();
for (const token of ["data-product-empty-state", "当前筛选没有匹配的商品", "清除关键词或切换状态筛选后再查看；不会修改商品"]) {
  if (!appSource.includes(token)) throw new Error(`missing product business-state token: ${token}`);
}

const requiredViews = ["dashboard", "products", "listing", "warehouse", "promotions", "finance", "system"];
const missingViews = requiredViews.filter((id) => !new RegExp(`id=[\"']${id}[\"']`).test(html));
if (missingViews.length) throw new Error(`missing view containers: ${missingViews.join(", ")}`);

const navViews = [...html.matchAll(/button[^>]*data-view=["']([^"']+)["']/g)].map((match) => match[1]);
const missingNav = requiredViews.filter((id) => !navViews.includes(id));
if (missingNav.length) throw new Error(`missing view navigation: ${missingNav.join(", ")}`);

const storesResponse = await fetch(new URL("/api/stores", baseUrl), { headers: { accept: "application/json" } });
if (!storesResponse.ok) throw new Error(`stores endpoint returned HTTP ${storesResponse.status}`);
const storesPayload = await storesResponse.json();
const storeOptions = Array.isArray(storesPayload.stores) ? storesPayload.stores : [];
if (storeOptions.length !== 4) throw new Error(`expected exactly four stores, found ${storeOptions.length}`);

console.log(JSON.stringify({
  ok: true,
  url: baseUrl,
  status: response.status,
  views: requiredViews.length,
  navBindings: new Set(navViews).size,
  stores: storeOptions.length,
  productFilterEmptyState: "served_bundle",
  network: "loopback-only"
}));
