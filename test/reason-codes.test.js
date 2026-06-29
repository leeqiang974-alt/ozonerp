import test from "node:test";
import assert from "node:assert/strict";
import { mapReasonCode, ReasonCode } from "../src/reasonCodes.js";

test("mapReasonCode detects common listing failures", () => {
  assert.equal(mapReasonCode("型号名称必填"), ReasonCode.MODEL_REQUIRED);
  assert.equal(mapReasonCode("尺寸或重量有误"), ReasonCode.WEIGHT_SIZE_INVALID);
  assert.equal(mapReasonCode("品牌检查值错误"), ReasonCode.BRAND_INVALID);
  assert.equal(mapReasonCode("category/type mismatch"), ReasonCode.CATEGORY_INVALID);
});

test("mapReasonCode detects storage corruption issues", () => {
  assert.equal(mapReasonCode("EPERM rename ...json"), ReasonCode.STORAGE_WRITE_ERROR);
  assert.equal(mapReasonCode("Unexpected end of JSON input"), ReasonCode.STORAGE_WRITE_ERROR);
});

