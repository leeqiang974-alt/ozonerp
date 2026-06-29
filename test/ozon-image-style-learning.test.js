import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SRC_DIR = new URL("../src/", import.meta.url);

test("Ozon image style learning keeps product images and rejects dirty media", async () => {
  const source = await readFile(new URL("ozonImageStyleLearning.js", SRC_DIR), "utf8");

  assert.match(source, /function ozonProductImageScore/);
  assert.match(source, /ozonProductImageScore\(b\) - ozonProductImageScore\(a\)/);
  assert.match(source, /product\|product-service\|multimedia\|s3/);
  assert.match(source, /marketing-api\|banner\|avatar\|seller\|logo\|icon/);
  assert.match(source, /fs-my-account-avatar/);
});
