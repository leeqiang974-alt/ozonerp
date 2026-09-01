const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require("node:path").join(__dirname, "..", "content.js"), "utf8");
const sandbox = {
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  location: { hostname: "example.test", href: "https://example.test/" },
  window: { addEventListener() {} },
  document: {
    querySelectorAll() { return []; },
    querySelector() { return null; },
  },
  chrome: { runtime: { onMessage: { addListener() {} } } },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "content.js" });

const run = (expression) => vm.runInContext(expression, sandbox);

run(`recordNetworkSkuData("https://example.test/api/sku", {
  data: { skuMap: {
    red: { skuId: "sku-red", skuName: "红色", price: "12.50", stock: "8", imgUrl: "//img.alicdn.com/red.jpg" },
    blue: { skuId: "sku-blue", skuName: "蓝色", price: "13.50", stock: "9", imgUrl: "//img.alicdn.com/blue.jpg" }
  }}
})`);
const variants = run("pickSkuVariants({}, {})");
assert.equal(variants.length, 2, "object-shaped skuMap must become two SKU rows");
assert.deepEqual(Array.from(variants, (item) => item.skuId), ["sku-red", "sku-blue"]);
assert.deepEqual(Array.from(variants, (item) => item.spec), ["红色", "蓝色"]);

const nestedVariants = run(`pickSkuVariants({
  opaqueReactState: { payload: { response: { skuInventory: {
    "17:42": { sku_id: "sku-gold", specName: "金色 / 大号", skuPrice: "18.80", quantity: 5 },
    "17:43": { sku_id: "sku-silver", specName: "银色 / 大号", skuPrice: "19.80", quantity: 6 }
  }}}}
}, {})`);
assert.equal(nestedVariants.length, 2, "nested SKU response must be discovered");
assert.deepEqual(Array.from(nestedVariants, (item) => item.skuId), ["sku-gold", "sku-silver"]);

const publicImages = run(`pickImages({
  gallery: { fields: { mainImage: ["//img.alicdn.com/public.jpg"] } },
  skuList: [{ skuId: "sku-red", imageUrl: "//img.alicdn.com/sku-only.jpg" }]
})`);
assert.deepEqual(Array.from(publicImages), ["https://img.alicdn.com/public.jpg"], "SKU-only image must not enter the public gallery");

sandbox.document = {
  querySelector(selector) {
    if (selector !== ".detail-desc") return null;
    return {
      children: [{}],
      querySelectorAll() {
        return [{
          currentSrc: "https://cbu01.alicdn.com/img/ibank/detail.jpg",
          src: "",
          getAttribute() { return ""; },
        }];
      },
    };
  },
  querySelectorAll() { return []; },
};
assert.deepEqual(Array.from(run("domProductImages()")), ["https://cbu01.alicdn.com/img/ibank/detail.jpg"], "detail-area images must be retained");

const invalidatedSandbox = {
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  location: { hostname: "example.test", href: "https://example.test/" },
  window: { addEventListener() {} },
  document: { querySelectorAll() { return []; }, querySelector() { return null; } },
  chrome: {},
};
vm.createContext(invalidatedSandbox);
assert.doesNotThrow(
  () => vm.runInContext(source, invalidatedSandbox, { filename: "content-invalidated.js" }),
  "invalidated extension context must not crash script startup",
);

console.log("content collector parser tests passed");
