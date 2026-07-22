import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobRepository, normalizeDurableItems, parseAutoListingFile, restoreJsonFile } from "../src/jobRepository.js";

test("durable rows normalize timestamps and reject invalid or backwards chronology", () => {
  const rows = normalizeDurableItems([{ id: "job-1", createdAt: "2026-07-19T01:00:00+08:00", updatedAt: "2026-07-19T02:00:00+08:00" }], { now: "2026-07-19T03:00:00.000Z", collection: "auto_listing_jobs" });
  assert.equal(rows[0].created_at, "2026-07-18T17:00:00.000Z");
  assert.equal(rows[0].updated_at, "2026-07-18T18:00:00.000Z");
  assert.throws(() => normalizeDurableItems([{ id: "bad", updatedAt: "not-a-date" }]), (error) => error.code === "JOB_TIMESTAMP_INVALID");
  assert.throws(() => normalizeDurableItems([{ id: "backwards", createdAt: "2026-07-19T02:00:00Z", updatedAt: "2026-07-19T01:00:00Z" }]), (error) => error.code === "JOB_TIMESTAMP_ORDER_INVALID");
});

test("JSON job repository writes atomically and keeps the previous valid snapshot", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-job-repository-"));
  const file = path.join(dir, "jobs.json");

  await JobRepository.writeAutoListingJobs(file, [{ id: "job-1", status: "queued" }]);
  await JobRepository.writeAutoListingJobs(file, [{ id: "job-1", status: "running" }]);
  assert.deepEqual(JSON.parse(await fs.readFile(`${file}.bak`, "utf8")), {
    items: [{ id: "job-1", status: "queued" }],
  });
  assert.deepEqual(await JobRepository.readAutoListingJobs(file), [{ id: "job-1", status: "running" }]);
});

test("durable job writes fail closed when an item has no stable id", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-job-id-required-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "jobs.json");
  await assert.rejects(
    JobRepository.writeAutoListingJobs(file, [{ title: "没有主键" }]),
    (error) => error.code === "JOB_ID_REQUIRED"
  );
  await assert.rejects(fs.access(file));
});

test("durable job writes reject duplicate ids instead of collapsing audit rows", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-job-id-duplicate-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "jobs.json");
  await assert.rejects(
    JobRepository.writeStockQueueJobs(file, [
      { id: "job-1", status: "queued" },
      { id: "job-1", status: "running" },
    ]),
    (error) => error.code === "JOB_ID_DUPLICATE"
  );
  await assert.rejects(fs.access(file));
});

test("JSON job repository restores only an explicitly requested valid backup", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-job-restore-"));
  const file = path.join(dir, "jobs.json");

  await JobRepository.writeAutoListingJobs(file, [{ id: "job-1", status: "queued" }]);
  await JobRepository.writeAutoListingJobs(file, [{ id: "job-1", status: "running" }]);
  await fs.writeFile(file, "{broken", "utf8");
  assert.deepEqual(await JobRepository.readAutoListingJobs(file), []);
  const restored = await restoreJsonFile(file);
  assert.equal(restored.restored, true);
  assert.deepEqual(await JobRepository.readAutoListingJobs(file), [{ id: "job-1", status: "queued" }]);
});

test("JSON recovery waits for the writer lock before replacing the live snapshot", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-job-restore-lock-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "jobs.json");
  await JobRepository.writeAutoListingJobs(file, [{ id: "job-1", status: "queued" }]);
  await JobRepository.writeAutoListingJobs(file, [{ id: "job-1", status: "running" }]);
  await fs.writeFile(file, "{broken", "utf8");

  const lock = await fs.open(`${file}.lock`, "wx");
  const pending = restoreJsonFile(file);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await fs.readFile(file, "utf8"), "{broken");
  await lock.close();
  await fs.rm(`${file}.lock`, { force: true });
  await pending;
  assert.deepEqual(await JobRepository.readAutoListingJobs(file), [{ id: "job-1", status: "queued" }]);
});

test("JSON fallback does not persist credential-shaped fields in job payloads", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-job-redaction-"));
  const file = path.join(dir, "jobs.json");
  await JobRepository.writeAutoListingJobs(file, [{
    id: "job-secret",
    title: "商品",
    apiKey: "secret-key",
    nested: { access_token: "secret-token", safe: "kept" },
  }]);
  const raw = await fs.readFile(file, "utf8");
  assert.doesNotMatch(raw, /secret-key|secret-token|apiKey|access_token/);
  assert.match(raw, /商品|kept/);
});

test("migration parser fails closed on malformed or trailing JSON while compatibility reads remain bounded", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-job-strict-parse-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "jobs.json");
  await fs.writeFile(file, '{"items":[{"id":"job-1"}]} trailing-garbage', "utf8");

  await assert.rejects(
    parseAutoListingFile(file, { strict: true }),
    (error) => error.code === "PERSISTED_JSON_INVALID",
  );
  // The non-migration compatibility path may still expose a valid prefix, but
  // this must never be used by migrateOnce before its first durable upsert.
  assert.deepEqual(await parseAutoListingFile(file), [{ id: "job-1" }]);

  await fs.writeFile(file, JSON.stringify({ unexpected: [] }), "utf8");
  await assert.rejects(
    parseAutoListingFile(file, { strict: true }),
    (error) => error.code === "PERSISTED_JSON_SCHEMA_INVALID",
  );
});

test("strict migration parser does not turn a missing snapshot into an empty migrated collection", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-job-strict-missing-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    parseAutoListingFile(path.join(dir, "not-mounted.json"), { strict: true }),
    (error) => error.code === "ENOENT",
  );
});
