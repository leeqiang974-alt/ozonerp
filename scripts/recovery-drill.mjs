import { runJsonRecoveryDrill } from "../src/recoveryDrill.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/recovery-drill.mjs <json-file>");
  process.exitCode = 2;
} else {
  const result = await runJsonRecoveryDrill(filePath);
  console.log(JSON.stringify(result));
  // This command is used as a deployment/CI gate. A missing or invalid
  // backup must fail the process rather than look like a successful drill.
  if (!result.ok) process.exitCode = 1;
}
