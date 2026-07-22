import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

// CI wrapper for the local recovery rehearsal.  Keep the child environment
// deliberately narrow so a runner cannot accidentally turn this check into a
// database/Ozon operation merely because secrets are present in CI.
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/(OZON|SUPABASE|DATABASE|POSTGRES|PGHOST|PGPORT|PGUSER|PGPASSWORD|REDIS|ALI_OSS)/i.test(key)),
);
const result = spawnSync(process.execPath, [path.resolve("scripts/recovery-rehearsal.mjs")], {
  cwd: path.resolve("."),
  encoding: "utf8",
  env: {
    ...inherited,
    CI: "1",
    OZON_ERP_RECOVERY_CI: "1",
    OZON_ERP_NETWORK_DISABLED: "1",
  },
});

if (result.error) {
  console.error(JSON.stringify({ ok: false, code: "RECOVERY_REHEARSAL_PROCESS_ERROR", message: result.error.message }));
  process.exitCode = 1;
} else if (result.status !== 0) {
  console.error(JSON.stringify({ ok: false, code: "RECOVERY_REHEARSAL_FAILED", status: result.status, stderr: result.stderr?.trim() || null }));
  process.exitCode = 1;
} else {
  let rehearsal;
  try {
    rehearsal = JSON.parse(result.stdout.trim());
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: "RECOVERY_REHEARSAL_INVALID_OUTPUT", message: error.message }));
    process.exitCode = 1;
  }
  const safe = rehearsal
    && rehearsal.ok === true
    && rehearsal.execution === "local_recovery_rehearsal"
    && rehearsal.verificationLevel === "locally_tested"
    && rehearsal.temporaryFixture === true
    && rehearsal.databaseObserved === false
    && rehearsal.networkAccessed === false
    && rehearsal.writesExecuted === false
    && rehearsal.deploymentReady === false;
  if (!safe) {
    console.error(JSON.stringify({ ok: false, code: "RECOVERY_REHEARSAL_SAFETY_ASSERTION_FAILED", rehearsal: rehearsal || null }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      ok: true,
      gate: "recovery_rehearsal",
      verificationLevel: rehearsal.verificationLevel,
      temporaryFixture: rehearsal.temporaryFixture,
      databaseObserved: rehearsal.databaseObserved,
      networkAccessed: rehearsal.networkAccessed,
      writesExecuted: rehearsal.writesExecuted,
      deploymentReady: rehearsal.deploymentReady,
    }));
  }
}
