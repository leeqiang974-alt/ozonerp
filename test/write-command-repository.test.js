import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WriteCommandRepository } from "../src/writeCommandRepository.js";

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-write-commands-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let tick = 0;
  return {
    file: path.join(dir, "commands.json"),
    now: () => new Date(Date.UTC(2026, 6, 12, 0, 0, tick++)).toISOString(),
  };
}

test("begin command creates once, reports in progress, and replays completed result", async (t) => {
  const config = await fixture(t);
  const repository = new WriteCommandRepository(config);
  const created = await repository.beginCommand("stock.write", "stock:key-1", "sha256:payload-1", {
    actorId: "user-1",
    storeId: "store-1",
    summary: { offerCount: 2, offers: ["A", "B"] },
  });
  assert.equal(created.status, "created");

  const pending = await repository.beginCommand("stock.write", "stock:key-1", "sha256:payload-1", {
    actorId: "user-1",
    storeId: "store-1",
  });
  assert.equal(pending.status, "in_progress");

  await repository.completeCommand("stock.write", "stock:key-1", {
    status: "accepted",
    taskId: "task-1",
    offerCount: 2,
  });
  const replay = await repository.beginCommand("stock.write", "stock:key-1", "sha256:payload-1", {
    actorId: "user-1",
    storeId: "store-1",
  });
  assert.equal(replay.status, "replay");
  assert.deepEqual(replay.command.resultSummary, { status: "accepted", taskId: "task-1", offerCount: 2 });
});

test("in-progress command reports age and stale state but never auto re-executes", async (t) => {
  const config = await fixture(t);
  let nowMs = Date.parse("2026-07-12T00:00:00.000Z");
  const repository = new WriteCommandRepository({
    file: config.file,
    now: () => new Date(nowMs).toISOString(),
    staleAfterMs: 60_000,
  });
  await repository.beginCommand("stock.write", "stale-key", "sha256:one", { storeId: "store-1" });
  nowMs += 61_000;
  const pending = await repository.beginCommand("stock.write", "stale-key", "sha256:one", { storeId: "store-1" });
  assert.equal(pending.status, "in_progress");
  assert.equal(pending.stale, true);
  assert.equal(pending.ageMs, 61_000);
  const stored = await repository.read();
  assert.equal(stored.commands[0].state, "in_progress");
});

test("only stale in-progress commands can move to needs review and the key stays occupied", async (t) => {
  const config = await fixture(t);
  let nowMs = Date.parse("2026-07-12T00:00:00.000Z");
  const repository = new WriteCommandRepository({
    file: config.file,
    now: () => new Date(nowMs).toISOString(),
    staleAfterMs: 60_000,
  });
  await repository.beginCommand("product.import", "old-key", "sha256:payload", { actorId: "user-1", storeId: "store-1" });
  await assert.rejects(
    repository.markStaleForReview("product.import", "old-key", "timeout", "reviewer-1"),
    (error) => error.code === "COMMAND_NOT_STALE"
  );
  nowMs += 61_000;
  const reviewed = await repository.markStaleForReview("product.import", "old-key", "unknown_outcome", "reviewer-1");
  assert.equal(reviewed.state, "needs_review");
  assert.equal(reviewed.completedAt, undefined);
  assert.deepEqual(reviewed.review, {
    reason: "unknown_outcome",
    actorId: "reviewer-1",
    markedAt: "2026-07-12T00:01:01.000Z",
  });

  const sameKey = await repository.beginCommand("product.import", "old-key", "sha256:payload", {});
  assert.equal(sameKey.status, "replay");
  assert.equal(sameKey.command.state, "needs_review");
  const newKey = await repository.beginCommand("product.import", "new-key", "sha256:payload", { storeId: "store-1" });
  assert.deepEqual(newKey, { status: "unresolved_payload" });
});

test("different idempotency keys cannot bypass an unresolved payload in the same scope and store", async (t) => {
  const repository = new WriteCommandRepository(await fixture(t));
  await repository.beginCommand("stock.write", "key-1", "sha256:same-payload", { storeId: "store-1" });

  const blocked = await repository.beginCommand("stock.write", "key-2", "sha256:same-payload", { storeId: "store-1" });
  assert.deepEqual(blocked, { status: "unresolved_payload" });
  assert.equal((await repository.read()).commands.length, 1);

  const otherStore = await repository.beginCommand("stock.write", "key-3", "sha256:same-payload", { storeId: "store-2" });
  assert.equal(otherStore.status, "created");
  const otherPayload = await repository.beginCommand("stock.write", "key-4", "sha256:different-payload", { storeId: "store-1" });
  assert.equal(otherPayload.status, "created");
});

test("stale review accepts only whitelisted reasons and cannot complete directly", async (t) => {
  const config = await fixture(t);
  let nowMs = Date.parse("2026-07-12T00:00:00.000Z");
  const repository = new WriteCommandRepository({
    file: config.file,
    now: () => new Date(nowMs).toISOString(),
    staleAfterMs: 1,
  });
  await repository.beginCommand("stock.write", "review-key", "sha256:x", {});
  nowMs += 2;
  await assert.rejects(
    repository.markStaleForReview("stock.write", "review-key", "apiKey=secret arbitrary text", "reviewer"),
    (error) => error.code === "COMMAND_REVIEW_REASON_INVALID"
  );
  await repository.markStaleForReview("stock.write", "review-key", "worker_interrupted", "reviewer");
  const unchanged = await repository.completeCommand("stock.write", "review-key", { status: "completed" });
  assert.equal(unchanged.state, "needs_review");
  const raw = await fs.readFile(config.file, "utf8");
  assert.doesNotMatch(raw, /apiKey=secret|arbitrary text/);
});

test("same scope and key with a different payload hash conflicts", async (t) => {
  const repository = new WriteCommandRepository(await fixture(t));
  await repository.beginCommand("product.import", "cmd-1", "sha256:first", { actorId: "user-1", storeId: "store-1" });
  const conflict = await repository.beginCommand("product.import", "cmd-1", "sha256:second", {
    actorId: "user-1",
    storeId: "store-1",
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.command.payloadHash, "sha256:first");
});

test("concurrent begin calls persist one command and never create duplicate execution", async (t) => {
  const repository = new WriteCommandRepository(await fixture(t));
  const results = await Promise.all(Array.from({ length: 8 }, () => (
    repository.beginCommand("stock.write", "same-key", "sha256:same", { storeId: "store-1" })
  )));
  assert.equal(results.filter((item) => item.status === "created").length, 1);
  assert.equal(results.filter((item) => item.status === "in_progress").length, 7);
  const stored = await repository.read();
  assert.equal(stored.commands.length, 1);
});

test("failed command records safe error summary and is replayed", async (t) => {
  const repository = new WriteCommandRepository(await fixture(t));
  await repository.beginCommand("price.write", "price-1", "sha256:price", { actorId: "user-2", storeId: "store-2" });
  const failed = await repository.failCommand("price.write", "price-1", {
    status: 429,
    code: "RATE_LIMITED",
    message: "retry later",
    requestId: "req-1",
    apiKey: "must-not-save",
    responseBody: { secret: "must-not-save" },
  });
  assert.equal(failed.state, "failed");
  const replay = await repository.beginCommand("price.write", "price-1", "sha256:price", {});
  assert.equal(replay.status, "replay");
  assert.deepEqual(replay.command.errorSummary, {
    status: 429,
    code: "RATE_LIMITED",
    message: "retry later",
    requestId: "req-1",
  });
});

test("uncertain write outcome moves immediately to needs review and keeps the same key occupied", async (t) => {
  const repository = new WriteCommandRepository(await fixture(t));
  await repository.beginCommand("stock.write", "stock-unknown", "sha256:stock", { storeId: "store-1" });
  const reviewed = await repository.reviewCommand("stock.write", "stock-unknown", "unknown_outcome", {
    status: 503,
    code: "DIRECT_WRITE_UNKNOWN_OUTCOME",
    message: "safe summary",
    requestId: "req-unknown",
  });
  assert.equal(reviewed.state, "needs_review");
  assert.equal(reviewed.review.reason, "unknown_outcome");
  assert.deepEqual(reviewed.errorSummary, {
    status: 503,
    code: "DIRECT_WRITE_UNKNOWN_OUTCOME",
    message: "safe summary",
    requestId: "req-unknown",
  });
  const replay = await repository.beginCommand("stock.write", "stock-unknown", "sha256:stock", {});
  assert.equal(replay.status, "replay");
  assert.equal(replay.command.state, "needs_review");
});

test("repository never persists api keys or complete payloads", async (t) => {
  const config = await fixture(t);
  const repository = new WriteCommandRepository(config);
  await repository.beginCommand("stock.write", "safe-1", "sha256:safe", {
    actorId: "user-1",
    storeId: "store-1",
    apiKey: "ozon-secret",
    payload: { items: [{ offer_id: "SECRET-SKU", stock: 999 }] },
    summary: { offerCount: 1, action: "stock_update", arbitrary: "drop-me" },
  });
  const raw = await fs.readFile(config.file, "utf8");
  assert.doesNotMatch(raw, /ozon-secret|SECRET-SKU|drop-me/);
  assert.match(raw, /sha256:safe|offerCount|stock_update/);
});

test("corrupt command storage fails conservatively without overwriting evidence", async (t) => {
  const config = await fixture(t);
  await fs.writeFile(config.file, "{broken", "utf8");
  const repository = new WriteCommandRepository(config);
  await assert.rejects(
    repository.beginCommand("stock.write", "key", "sha256:x", {}),
    (error) => error.code === "COMMAND_STORE_CORRUPT"
  );
  assert.equal(await fs.readFile(config.file, "utf8"), "{broken");
});

test("command writes retain the previous valid snapshot for recovery drills", async (t) => {
  const config = await fixture(t);
  const repository = new WriteCommandRepository(config);
  await repository.beginCommand("stock.write", "backup-1", "sha256:first", { storeId: "store-1" });
  await repository.completeCommand("stock.write", "backup-1", { status: "accepted" });
  await repository.beginCommand("price.write", "backup-2", "sha256:second", { storeId: "store-1" });

  const backup = JSON.parse(await fs.readFile(`${config.file}.bak`, "utf8"));
  assert.deepEqual(backup.commands.map((command) => command.key), ["backup-1"]);
  assert.equal(backup.commands[0].state, "completed");
});

test("list commands filters and prioritizes safe review work with pagination", async (t) => {
  const config = await fixture(t);
  let nowMs = Date.parse("2026-07-12T00:00:00.000Z");
  const repository = new WriteCommandRepository({
    file: config.file,
    now: () => new Date(nowMs).toISOString(),
    staleAfterMs: 60_000,
  });
  await repository.beginCommand("stock.write", "stale", "sha256:stale", {
    actorId: "user-1",
    storeId: "store-1",
    apiKey: "never-list",
    payload: { secret: "never-list-payload" },
    summary: { action: "stock_update", offerCount: 2 },
  });
  nowMs += 30_000;
  await repository.beginCommand("product.import", "review", "sha256:review", { storeId: "store-1" });
  nowMs += 61_000;
  await repository.markStaleForReview("product.import", "review", "unknown_outcome", "reviewer");
  await repository.beginCommand("price.write", "fresh", "sha256:fresh", { storeId: "store-2" });

  const page = await repository.listCommands({ limit: 2 });
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.items.map((item) => item.key), ["review", "stale"]);
  assert.equal(page.hasMore, true);
  assert.equal(page.items[0].state, "needs_review");
  assert.equal(page.items[1].stale, true);
  assert.deepEqual(Object.keys(page.items[0]).sort(), [
    "actorId", "ageMs", "businessSummary", "completedAt", "createdAt", "errorSummary", "id", "key",
    "payloadHash", "resultSummary", "review", "scope", "stale", "state", "storeId", "updatedAt",
  ]);
  assert.doesNotMatch(JSON.stringify(page), /never-list|never-list-payload/);

  const filtered = await repository.listCommands({ state: "in_progress", scope: "stock.write", storeId: "store-1", olderThan: 60_000, limit: 10 });
  assert.deepEqual(filtered.items.map((item) => item.key), ["stale"]);
  const secondPage = await repository.listCommands({ limit: 2, offset: 2 });
  assert.deepEqual(secondPage.items.map((item) => item.key), ["fresh"]);
});

test("summarize needs review returns safe aggregate and corrupt storage still fails", async (t) => {
  const config = await fixture(t);
  let nowMs = Date.parse("2026-07-12T00:00:00.000Z");
  const repository = new WriteCommandRepository({ file: config.file, now: () => new Date(nowMs).toISOString(), staleAfterMs: 10 });
  await repository.beginCommand("stock.write", "stale", "sha256:1", { storeId: "store-1" });
  nowMs += 11;
  await repository.beginCommand("product.import", "review", "sha256:2", { storeId: "store-2" });
  nowMs += 11;
  await repository.markStaleForReview("product.import", "review", "worker_interrupted", "reviewer");
  const summary = await repository.summarizeNeedsReview();
  assert.deepEqual(summary, {
    needsReview: 1,
    staleInProgress: 1,
    totalAttention: 2,
    byScope: { "product.import": 1, "stock.write": 1 },
    byStore: { "store-1": 1, "store-2": 1 },
  });

  await fs.writeFile(config.file, "broken", "utf8");
  await assert.rejects(repository.listCommands(), (error) => error.code === "COMMAND_STORE_CORRUPT");
  await assert.rejects(repository.summarizeNeedsReview(), (error) => error.code === "COMMAND_STORE_CORRUPT");
});

test("separate repository instances serialize read-modify-write operations with a file lock", async (t) => {
  const config = await fixture(t);
  const first = new WriteCommandRepository(config);
  const second = new WriteCommandRepository(config);
  const results = await Promise.all([
    first.beginCommand("stock.write", "key-a", "sha256:a", { storeId: "store-1" }),
    second.beginCommand("price.write", "key-b", "sha256:b", { storeId: "store-2" }),
  ]);
  assert.deepEqual(results.map((item) => item.status).sort(), ["created", "created"]);
  const list = await first.listCommands({ limit: 10 });
  assert.deepEqual(list.items.map((item) => item.key).sort(), ["key-a", "key-b"]);
});
