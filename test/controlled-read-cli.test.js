import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("controlled read CLI is fail-closed and emits only safe live-read inputs", async () => {
  const source = await fs.readFile(new URL("../scripts/controlled-read.mjs", import.meta.url), "utf8");
  assert.match(source, /--execute-live/);
  assert.match(source, /I_CONFIRM_READ_ONLY/);
  assert.match(source, /buildReadOperatorExecutionPreflight/);
  assert.match(source, /executionPreflight/);
  assert.match(source, /--overwrite-audit/);
  assert.match(source, /--session-proof/);
  assert.match(source, /buildReadOperatorSessionGate/);
  assert.match(source, /静态店铺密钥联网/);
  assert.match(source, /outputExists/);
  assert.match(source, /allowOverwrite/);
  assert.match(source, /READ_OPERATOR_SERVER_EXECUTION_REQUIRED/);
  assert.match(source, /\/api\/ozon\/read-operator\/execute/);
  assert.doesNotMatch(source, /ozonRequest|runReadVerification/);
  assert.match(source, /未联网、未读取 Ozon/);
  assert.doesNotMatch(source, /console\.log\(.*apiKey/);
});

test("single-store controlled-read defaults to current endpoints and exposes deprecated scope explicitly", async () => {
  const source = await fs.readFile(new URL("../scripts/controlled-read.mjs", import.meta.url), "utf8");
  assert.match(source, /CURRENT_READ_ENDPOINTS/);
  assert.doesNotMatch(source, /result = \{ endpoints: \[\.\.\.READ_ENDPOINTS\] \}/);
});
