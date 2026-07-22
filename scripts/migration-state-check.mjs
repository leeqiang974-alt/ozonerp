import { buildMigrationStateAudit } from "../src/migrationStateAudit.js";

const result = await buildMigrationStateAudit({ stateFile: process.argv[2] || undefined });
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;

