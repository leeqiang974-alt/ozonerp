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
    "webCurrentSeller-1": JSON.stringify({ seller: { id: 77, name: "Магазин", link: "/seller/demo-77/" } }),
  },
});
assert.equal(states.length, 4);
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonAspectVariants(states, "https://www.ozon.ru/product/demo-1001/"))),
  [{ skuId: "1001", properties: [{ name: "颜色", value: "棕色" }, { name: "尺寸", value: "55 см" }], url: "https://www.ozon.ru/product/demo-1001/", price: 1200, image: "", title: "" }],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonStructuredSeller(states))),
  { sellerId: "77", sellerName: "Магазин", sellerUrl: "https://www.ozon.ru/seller/demo-77/" },
);
const sellerFallbackStates = hooks.parseOzonWidgetStates({ widgetStates: {
  "webCurrentSeller-1": JSON.stringify({}),
  "webSellerInfo-1": JSON.stringify({ data: { sellerId: "88", sellerName: "Запасной магазин", sellerUrl: "/seller/fallback-88/" } }),
} });
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonStructuredSeller(sellerFallbackStates))),
  { sellerId: "88", sellerName: "Запасной магазин", sellerUrl: "https://www.ozon.ru/seller/fallback-88/" },
);
assert.deepEqual(
  Array.from(hooks.ozonWidgetImages({ images: [{ src: "https://cdn1.ozonusercontent.com/s3/multimedia-a/ok.jpg" }, { src: "https://cdn1.ozonusercontent.com/s3/marketing-api/banners/no.png" }, { src: "https://cdn1.ozonusercontent.com/s3/marketing-api//banners/no-double.png" }] })),
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
      { sku: "green-55", data: { searchableText: "55 cm", price: "1 350 ₽" } }, { sku: "green-70", data: { searchableText: "70 cm" } },
    ] },
  ] }),
} });
const style = hooks.ozonAspectOptions(matrixStates)[0];
assert.deepEqual(JSON.parse(JSON.stringify(hooks.buildOzonStyleSizeRows({ ...style.options[0], name: style.name }, matrixStates))), [
  { skuId: "green-55", spec: "颜色: 生机绿意 / 尺寸: 55 cm", image: "https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg", imageUrls: ["https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg"], styleId: "颜色:生机绿意", styleLabel: "生机绿意", priceRub: 1350 },
  { skuId: "green-70", spec: "颜色: 生机绿意 / 尺寸: 70 cm", image: "https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg", imageUrls: ["https://cdn1.ozonusercontent.com/s3/multimedia-a/green.jpg"], styleId: "颜色:生机绿意", styleLabel: "生机绿意", priceRub: "" },
]);
const styleOnlyStates = hooks.parseOzonWidgetStates({ widgetStates: {
  "webAspects-1": JSON.stringify({ aspects: [{ descriptionRs: [{ content: "颜色:" }], variants: [
    { sku: "real-green-sku", data: { searchableText: "绿色", price: "900 ₽" } },
  ] }] }),
} });
const styleOnly = hooks.ozonAspectOptions(styleOnlyStates)[0];
assert.equal(hooks.buildOzonStyleSizeRows({ ...styleOnly.options[0], name: styleOnly.name }, styleOnlyStates)[0].skuId, "real-green-sku");
// video extraction: pdp video from gallery.videos, review fallback from webListPhotos
const videoStates = hooks.parseOzonWidgetStates({ widgetStates: {
  "webGallery-1": JSON.stringify({ sku: "1001", videos: [
    { name: "", url: "https://cdnvideo.v.ozone.ru/vod/video-1/abc/asset_0_h264.mp4?type=pdp", coverUrl: "https://ir-2.ozone.ru/cover.jpg" },
  ] }),
  "webListPhotos-1": JSON.stringify({ mediaContent: [
    { type: "VIDEO", videoUrl: "https://v-1.ozone.ru/vod/video-2/def/asset_1_h264.mp4?type=review", previewUrl: "https://ir-2.ozone.ru/preview.jpg", uuid: "uuid-1" },
  ] }),
} });
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonVideoFromStates(videoStates))),
  { url: "https://cdnvideo.v.ozone.ru/vod/video-1/abc/asset_0_h264.mp4?type=pdp", coverUrl: "https://ir-2.ozone.ru/cover.jpg", title: "", videoId: "" },
);
// falls back to review video when no pdp video
const reviewOnlyStates = hooks.parseOzonWidgetStates({ widgetStates: {
  "webGallery-1": JSON.stringify({ sku: "1001" }),
  "webListPhotos-1": JSON.stringify({ mediaContent: [
    { type: "VIDEO", videoUrl: "https://v-1.ozone.ru/vod/video-2/def/asset_1_h264.mp4?type=review", previewUrl: "https://ir-2.ozone.ru/preview.jpg", uuid: "uuid-1" },
  ] }),
} });
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonVideoFromStates(reviewOnlyStates))),
  { url: "https://v-1.ozone.ru/vod/video-2/def/asset_1_h264.mp4?type=review", coverUrl: "https://ir-2.ozone.ru/preview.jpg", title: "", videoId: "uuid-1" },
);
// no video at all -> null
assert.equal(hooks.ozonVideoFromStates(hooks.parseOzonWidgetStates({ widgetStates: { "webGallery-1": JSON.stringify({ sku: "1001" }) } })), null);
// [v0.7.68] Product JSON-LD is read from the DOM <script type="application/ld+json">;
// the composer PDP response has no seo widget, so DOM must be the primary source.
const realLd = {
  "@type": "Product",
  name: "SEENVSS naushniki",
  brand: { name: "SEENVSS" },
  aggregateRating: { ratingValue: "4.8", reviewCount: "3694" },
  sku: "3240048548",
  offers: { price: "932" },
  description: "Opisanie tovara",
  image: "https://ir-20.ozonstatic.cn/s3/multimedia-1-4/x.jpg",
};
const origQSA = sandbox.document.querySelectorAll;
sandbox.document.querySelectorAll = function (sel) {
  return String(sel).indexOf("ld+json") >= 0 ? [{ textContent: JSON.stringify(realLd) }] : [];
};
const domSeo = hooks.ozonStructuredSeo({});
sandbox.document.querySelectorAll = origQSA;
assert.equal(domSeo.brand, "SEENVSS");
assert.equal(domSeo.rating, "4.8");
assert.equal(domSeo.reviewCount, "3694");
assert.equal(domSeo.title, "SEENVSS naushniki");
assert.equal(domSeo.image, "https://ir-20.ozonstatic.cn/s3/multimedia-1-4/x.jpg");
// brand as a plain string is also supported
sandbox.document.querySelectorAll = function (sel) {
  return String(sel).indexOf("ld+json") >= 0
    ? [{ textContent: JSON.stringify({ "@type": "Product", brand: "PlainBrand" }) }]
    : [];
};
assert.equal(hooks.ozonStructuredSeo({}).brand, "PlainBrand");
sandbox.document.querySelectorAll = origQSA;
// when DOM has no ld+json, composer seo.script remains the fallback path
const composerSeo = hooks.ozonStructuredSeo({ seo: { script: [{ innerHTML: JSON.stringify({
  "@type": "Product", brand: { name: "ComposerBrand" },
  aggregateRating: { ratingValue: "4.7", reviewCount: "10" },
}) }] } });
assert.equal(composerSeo.brand, "ComposerBrand");
assert.equal(composerSeo.rating, "4.7");
// ozonPickProductLd prefers the Product node among mixed ld+json blocks
const picked = hooks.ozonPickProductLd([
  { "@type": "BreadcrumbList", itemListElement: [] },
  { "@type": "Product", brand: "Picked" },
]);
assert.equal(picked.brand, "Picked");
// [Iteration 2026-09-23 v0.7.69] package weight & dimensions are read from the
// entrypoint webCharacteristics by language-independent English keys.
const pkgStates = hooks.parseOzonWidgetStates({ widgetStates: {
  "webCharacteristics-2": JSON.stringify({ characteristics: [{ short: [
    { key: "Weight", name: "商品重量，克", values: [{ text: "100" }] },
    { key: "Dimensions", name: "尺寸，毫米", values: [{ text: "50*40*30" }] },
  ] }] }),
} });
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonPackageInfoFromStates(pkgStates))),
  { weightG: "100", lengthMm: "50", widthMm: "40", heightMm: "30", label: "100 g / 50x40x30 mm" }
);
// Translated-name fallback (no English key) and a different separator still parse.
const pkgFallback = hooks.parseOzonWidgetStates({ widgetStates: {
  "webCharacteristics-3": JSON.stringify({ characteristics: [{ short: [
    { name: "Вес товара, г", values: [{ text: "120" }] },
    { name: "Габариты, мм", values: [{ text: "60×45×35" }] },
  ] }] }),
} });
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonPackageInfoFromStates(pkgFallback))),
  { weightG: "120", lengthMm: "60", widthMm: "45", heightMm: "35", label: "120 g / 60x45x35 mm" }
);

// [Iteration 2026-09-23 v0.7.71] Real PDP: Weight/Dimensions are TOP-LEVEL row
// sections (no short/long wrapper), lowercase x separator -> must still parse.
const pkgTopRows = hooks.parseOzonWidgetStates({ widgetStates: {
  "webCharacteristics-4": JSON.stringify({ characteristics: [
    { key: "Sku", name: "货号", values: [{ text: "3039011467" }] },
    { key: "Weight", name: "商品重量，克", values: [{ text: "198" }] },
    { key: "Dimensions", name: "尺寸，毫米", values: [{ text: "110x110x60" }] },
  ] }),
} });
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.ozonPackageInfoFromStates(pkgTopRows))),
  { weightG: "198", lengthMm: "110", widthMm: "110", heightMm: "60", label: "198 g / 110x110x60 mm" }
);

// [Iteration 2026-09-25 v0.7.73] M.Video single-SKU dry-run preview uses exact
// unit conversion and never derives CNY cost from an Ozon RUB price.
assert.equal(hooks.mmToCm(100), 10);
assert.equal(hooks.gToKg(1000), 1);
for (const invalid of ["", null, undefined, "abc", "abc123", NaN, Infinity]) {
  assert.equal(hooks.toFiniteNumber(invalid), null, `invalid numeric value: ${invalid}`);
}
assert.equal(hooks.positiveNumber(0), null);
assert.equal(hooks.positiveNumber(-3), null);

const twoSkus = [{ skuId: "sku-a" }, { skuId: "sku-b" }];
assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.selectSingleOzonSku(twoSkus, "sku-b"))),
  { ok: true, sku: { skuId: "sku-b" } },
);
assert.match(hooks.selectSingleOzonSku(twoSkus, "sku-x").error, /无法仅凭当前链接/);
assert.match(hooks.selectSingleOzonSku(twoSkus, "").error, /无法仅凭当前链接/);
assert.match(
  hooks.selectSingleOzonSku([{ skuId: "dup" }, { skuId: "dup" }], "dup").error,
  /重复/,
);
assert.equal(hooks.selectSingleOzonSku([{ skuId: "only" }], "other").ok, true);

const previewPayload = {
  title: "Brand Demo Model X title",
  category: "Electronics",
  price: 1234,
  packageInfo: { weightG: 1000, lengthMm: 100, widthMm: 50, heightMm: 25, label: "1000 g / 100x50x25 mm" },
};
const model = hooks.buildMvideoSingleSkuPreviewModel(
  previewPayload,
  { skuId: "sku-b", spec: "颜色: 黑色", priceRub: 2345 },
  "sku-b",
);
assert.equal(model.dryRun, true);
assert.equal(model.brand, "无品牌");
assert.equal(model.marketPriceRub, 2345);
assert.equal(model.purchaseCostCny, null);
assert.deepEqual(JSON.parse(JSON.stringify(model.packaging)), {
  lengthCm: 10,
  widthCm: 5,
  heightCm: 2.5,
  weightKg: 1,
});
assert.equal(model.publishReady, false);
const gateMap = new Map(model.gates.map((gate) => [gate.label, gate]));
assert.equal(gateMap.get("CNY 采购价").ok, false);
assert.equal(gateMap.get("M.Video RUB 售价").ok, false);
assert.equal(gateMap.get("库存").ok, false);
assert.equal(gateMap.get("标题重构").ok, false);
assert.equal(gateMap.get("描述重构").ok, false);
assert.equal(gateMap.get("类目合规预检").ok, false);
assert.equal(gateMap.get("包装尺重").ok, true);

const payloadPriceFallback = hooks.buildMvideoSingleSkuPreviewModel(
  previewPayload,
  { skuId: "sku-a" },
  "sku-a",
);
assert.equal(payloadPriceFallback.marketPriceRub, 1234);
const missingPackageModel = hooks.buildMvideoSingleSkuPreviewModel(
  { title: "Demo" },
  { skuId: "sku-x" },
  "sku-x",
);
assert.equal(
  new Map(missingPackageModel.gates.map((gate) => [gate.label, gate])).get("包装尺重").ok,
  false,
);

console.log("ozon structured public-page parser tests passed");
