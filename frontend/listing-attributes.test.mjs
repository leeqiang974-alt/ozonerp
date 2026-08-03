import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { attributeFieldHtml, attributePayloadFromEntries, createRequestGate, dictionaryOptionHtml } = require("./listing-attributes.js");

test("renders large dictionary attributes as a searchable input", () => {
  const html = attributeFieldHtml(
    { id: "85", name: "品牌", required: true, dictionary_id: "1", type: "String" },
    [{ id: "970718", value: "测试品牌" }],
  );
  assert.match(html, /input/);
  assert.match(html, /datalist/);
  assert.match(html, /data-listing-attribute="85"/);
  assert.match(html, /品牌（必填）/);
});

test("renders required free text attributes as an input", () => {
  const html = attributeFieldHtml({ id: "100", name: "材质", required: true, dictionary_id: "", type: "String" }, []);
  assert.match(html, /input/);
  assert.match(html, /required/);
});

test("builds draft attribute payload without blank optional values", () => {
  assert.deepEqual(attributePayloadFromEntries([
    { attributeId: "85", name: "品牌", kind: "dictionary", value: "测试品牌", valueId: "970718" },
    { attributeId: "100", name: "材质", kind: "text", value: "棉", label: "" },
    { attributeId: "101", name: "备注", kind: "text", value: "", label: "" },
  ]), [
    { attribute_id: "85", name: "品牌", value_id: "970718", value_text: "测试品牌" },
    { attribute_id: "100", name: "材质", value_id: null, value_text: "棉" },
  ]);
});

test("dictionary options remain unique when Ozon labels are identical", () => {
  const first = dictionaryOptionHtml({ id: "1", value: "同名品牌" });
  const second = dictionaryOptionHtml({ id: "2", value: "同名品牌" });
  assert.notEqual(first, second);
  assert.match(first, /同名品牌 · Ozon #1/);
  assert.match(first, /data-value-text="同名品牌"/);
});

test("request gate rejects stale responses even when context changes back", () => {
  const gate = createRequestGate();
  const oldA = gate.begin("店铺A");
  gate.begin("店铺B");
  const newA = gate.begin("店铺A");
  assert.equal(gate.isCurrent(oldA, "店铺A"), false);
  assert.equal(gate.isCurrent(newA, "店铺A"), true);
});
