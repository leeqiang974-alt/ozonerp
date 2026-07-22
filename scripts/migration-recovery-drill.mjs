import path from "node:path";
import { runCoreMigrationRecoveryDrill } from "../src/migrationRecoveryRunner.js";

const result = await runCoreMigrationRecoveryDrill({
  migrationFile: process.argv[2] || path.resolve("supabase/migrations/20260715_001_core_job_storage.sql"),
  failAt: process.env.MIGRATION_DRILL_FAIL_AT || null,
});
console.log(JSON.stringify(result));
// A green local rehearsal is not production deployment evidence.  Keep the
// command fail-closed so CI cannot interpret simulated apply/restore as done.
if (!result.ok || result.deploymentReady !== true) process.exitCode = 1;
