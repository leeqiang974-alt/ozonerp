import path from "node:path";
import { buildCoreMigrationDryRun } from "../src/migrationCheck.js";

const result = await buildCoreMigrationDryRun({
  migrationFile: process.argv[2] || path.resolve("supabase/migrations/20260715_001_core_job_storage.sql"),
});
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
