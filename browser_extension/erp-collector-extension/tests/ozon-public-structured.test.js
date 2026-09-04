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
console.log("ozon structured public-page parser tests passed");
