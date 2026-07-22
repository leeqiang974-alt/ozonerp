import path from "node:path";
import { inspectCoreMigration } from "../src/migrationCheck.js";

const file = process.argv[2] || path.resolve("supabase/migrations/20260715_001_core_job_storage.sql");
const result = await inspectCoreMigration(file);
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
