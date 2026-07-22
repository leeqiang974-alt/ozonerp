import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("durable storage migration covers the repositories used by the runtime", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260715_001_core_job_storage.sql", import.meta.url), "utf8");
  for (const table of ["auto_listing_jobs", "stock_queue_jobs", "pipeline_runs"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`public\\.${table}.*enable row level security`, "s"));
  }
  assert.match(sql, /payload jsonb not null/);
  assert.match(sql, /service role only/);
  assert.doesNotMatch(sql, /SUPABASE_SERVICE_ROLE_KEY|postgres:\/\/|eyJ/);
});
