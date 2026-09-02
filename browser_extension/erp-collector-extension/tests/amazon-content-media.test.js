const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "amazon-content.js"), "utf8");
const testHook = {};
const sandbox = {
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  location: { origin: "https://www.amazon.com", pathname: "/dp/B000TEST01", href: "https://www.amazon.com/dp/B000TEST01", hash: "" },
  __MELI_AMAZON_COLLECTOR_TEST__: testHook,
  document: {
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement() { return { style: {}, addEventListener() {} }; },
    documentElement: { appendChild() {} },
    scripts: [],
  },
  chrome: {
    runtime: { onMessage: { addListener() {} } },
  },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "amazon-content.js" });

assert.equal(typeof testHook.fullImageUrl, "function", "image normalizer must be exposed to its parser test");
assert.equal(
  testHook.fullImageUrl("https://m.media-amazon.com/images/I/71Plkrjg7vL._SX342_.jpg"),
  "https://m.media-amazon.com/images/I/71Plkrjg7vL.jpg",
);
assert.equal(
  testHook.fullImageUrl("https://m.media-amazon.com/images/I/614dza6J7IL._AC_SL1500_.jpg"),
  "https://m.media-amazon.com/images/I/614dza6J7IL.jpg",
);
assert.equal(
  testHook.fullImageUrl("https://m.media-amazon.com/images/I/41DFwtawoGL._SX38_SY50_CR,0,0,38,50_.jpg"),
  "https://m.media-amazon.com/images/I/41DFwtawoGL.jpg",
);

assert.equal(typeof testHook.isProductVideoUrl, "function", "product video validator must be exposed to its parser test");
assert.equal(
  testHook.isProductVideoUrl("https://m.media-amazon.com/images/S/vse-vms-transcoding-artifact-us-east-1-prod/a/video.mp4"),
  true,
);
assert.equal(
  testHook.isProductVideoUrl("https://m.media-amazon.com/images/S/ads/recommendation.mp4"),
  false,
);
assert.equal(testHook.isProductVideoUrl("https://cdn.example/video.mp4"), false);

assert.equal(typeof testHook.variantValue, "function", "variant title normalizer must be exposed to its parser test");
assert.equal(testHook.variantValue("Click to select Black"), "Black");
assert.equal(testHook.variantValue("Choose a color"), "a color");

function variantOption(asin, title, selected = false) {
  return {
    dataset: { defaultasin: asin },
    textContent: title,
    getAttribute(name) {
      if (name === "title") return title;
      if (name === "data-defaultAsin") return asin;
      return null;
    },
    querySelector() { return null; },
    classList: { contains(name) { return selected && name === "swatchSelect"; } },
  };
}

const amazonColorGroup = {
  id: "variation_color_name",
  querySelectorAll(selector) {
    assert.match(selector, /data-defaultasin/i);
    return [
      variantOption("B0FZ8YTXFC", "Click to select Black", true),
      variantOption("B0FZ8WSVSB", "Click to select Brown"),
      variantOption("B0FZ916R1F", "Click to select Gray"),
    ];
  },
};
sandbox.document.querySelectorAll = (selector) => {
  if (selector === "[id^='variation_'][id$='_name']") return [amazonColorGroup];
  if (selector === 'script[type="a-state"]') return [];
  return [];
};
const capturedVariants = JSON.parse(JSON.stringify(Array.from(testHook.captureVariants())));
assert.deepEqual(capturedVariants.map((item) => ({ asin: item.asin, attributes: item.attributes, selected: item.selected })), [
  { asin: "B0FZ8YTXFC", attributes: { Color: "Black" }, selected: true },
  { asin: "B0FZ8WSVSB", attributes: { Color: "Brown" }, selected: false },
  { asin: "B0FZ916R1F", attributes: { Color: "Gray" }, selected: false },
]);
console.log("amazon original-image normalizer tests passed");
