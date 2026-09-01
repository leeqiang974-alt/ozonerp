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

console.log("amazon original-image normalizer tests passed");
