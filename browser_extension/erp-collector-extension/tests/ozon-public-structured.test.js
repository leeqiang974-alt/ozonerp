const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const hooks = {};
const sandbox = {
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  location: { hostname: "example.test", origin: "https://example.test", href: "https://example.test/" },
  window: { addEventListener() {}, __OZON_ERP_COLLECTOR_TEST__: hooks },
  document: { querySelectorAll() { return []; }, querySelector() { return null; } },
  chrome: { runtime: { onMessage: { addListener() {} } } },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "content.js" });

const states = hooks.parseOzonWidgetStates({
  widgetStates: {
    "webGallery-1": JSON.stringify({ sku: "1001", images: [{ src: "https://cdn1.ozonusercontent.com/s3/multimedia-a/ok.jpg" }] }),
    "webAspects-1": JSON.stringify({ aspects: [
      { descriptionRs: [{ content: "颜色:" }], variants: [{ sku: "1001", link: "/product/demo-1001/", data: { searchableText: "棕色", price: "1 200 ₽" } }] },
      { descriptionRs: [{ content: "尺寸:" }], variants: [{ sku: "1001", link: "/product/demo-1001/", data: { searchableText: "55 см", price: "1 200 ₽" } }] },
    ] }),
    "webCharacteristics-1": JSON.stringify({ characteristics: [{ short: [{ name: "Материал", values: [{ text: "Полиэстер" }] }] }] }),
  },
});
assert.equal(states.length, 3);
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonAspectVariants(states, "https://www.ozon.ru/product/demo-1001/"))),
  [{ skuId: "1001", properties: [{ name: "颜色", value: "棕色" }, { name: "尺寸", value: "55 см" }], url: "https://www.ozon.ru/product/demo-1001/", price: 1200, image: "" }],
);
assert.deepEqual(
  Array.from(hooks.ozonWidgetImages({ images: [{ src: "https://cdn1.ozonusercontent.com/s3/multimedia-a/ok.jpg" }, { src: "https://cdn1.ozonusercontent.com/s3/marketing-api/banners/no.png" }] })),
  ["https://cdn1.ozonusercontent.com/s3/multimedia-a/ok.jpg"],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonStructuredAttributes(states))),
  [{ name: "Материал", value: "Полиэстер" }],
);
const matrixStates = hooks.parseOzonWidgetStates({ widgetStates: {
  "webGallery-1": JSON.stringify({ images: [{ src: "https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg" }] }),
  "webAspects-1": JSON.stringify({ aspects: [
    { descriptionRs: [{ content: "颜色:" }], variants: [{ sku: "green", link: "/product/demo-green-1/", data: { searchableText: "生机绿意", coverImage: "https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg" } }] },
    { descriptionRs: [{ content: "尺寸:" }], variants: [
      { sku: "green-55", data: { searchableText: "55 cm" } }, { sku: "green-70", data: { searchableText: "70 cm" } },
    ] },
  ] }),
} });
const style = hooks.ozonAspectOptions(matrixStates)[0];
assert.deepEqual(JSON.parse(JSON.stringify(hooks.buildOzonStyleSizeRows({ ...style.options[0], name: style.name }, matrixStates))), [
  { skuId: "green-55", spec: "颜色: 生机绿意 / 尺寸: 55 cm", image: "https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg", imageUrls: ["https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg"], styleId: "颜色:生机绿意", styleLabel: "生机绿意" },
  { skuId: "green-70", spec: "颜色: 生机绿意 / 尺寸: 70 cm", image: "https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg", imageUrls: ["https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg"], styleId: "颜色:生机绿意", styleLabel: "生机绿意" },
]);
console.log("ozon structured public-page parser tests passed");
