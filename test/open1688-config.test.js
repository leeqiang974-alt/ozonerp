import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { sign1688OpenApiPath } from "../src/open1688Client.js";

test("1688 Open API status reports missing credentials without leaking secrets", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "open1688-config-"));
  process.env.OPEN1688_DATA_DIR = tmpDir;
  const mod = await import(`../src/open1688Config.js?missing_${Date.now()}`);

  const status = mod.get1688OpenApiStatus();
  assert.equal(status.configured, false);
  assert.ok(status.missing.includes("AppSecret"));
  assert.ok(status.missing.includes("授权 token"));
  assert.equal(status.appKey, "7076779");
  assert.equal(status.appSecretMasked, "");
  assert.equal(status.accessTokenMasked, "");
});

test("1688 Open API status masks configured credentials", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "open1688-config-"));
  process.env.OPEN1688_DATA_DIR = tmpDir;
  await fs.writeFile(path.join(tmpDir, "1688-openapi.json"), JSON.stringify({
    appSecret: "abcdef1234567890",
    accessToken: "12345678-1234-1234-1234-123456789012",
  }), "utf8");
  const mod = await import(`../src/open1688Config.js?ready_${Date.now()}`);

  const status = mod.get1688OpenApiStatus();
  assert.equal(status.configured, true);
  assert.equal(status.appSecretMasked, "abcd...7890");
  assert.equal(status.accessTokenMasked, "1234...9012");
  assert.doesNotMatch(JSON.stringify(status), /abcdef1234567890/);
  assert.doesNotMatch(JSON.stringify(status), /12345678-1234-1234-1234-123456789012/);
});

test("1688 Open API status tolerates Windows UTF-8 BOM config files", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "open1688-config-"));
  process.env.OPEN1688_DATA_DIR = tmpDir;
  await fs.writeFile(path.join(tmpDir, "1688-openapi.json"), "\uFEFF" + JSON.stringify({
    appSecret: "abcdef1234567890",
    accessToken: "12345678-1234-1234-1234-123456789012",
  }), "utf8");
  const mod = await import(`../src/open1688Config.js?bom_${Date.now()}`);

  const status = mod.get1688OpenApiStatus();
  assert.equal(status.configured, true);
  assert.equal(status.configReadError, "");
});

test("1688 Open API signature is stable and uppercase", () => {
  const signature = sign1688OpenApiPath(
    "param2/1/system/currentTime/123",
    { b: "2", a: "1" },
    "secret",
  );

  assert.match(signature, /^[A-F0-9]{40}$/);
  assert.equal(signature, sign1688OpenApiPath("param2/1/system/currentTime/123", { a: "1", b: "2" }, "secret"));
});
