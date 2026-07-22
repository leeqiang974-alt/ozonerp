import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function readValidJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return { raw, value: JSON.parse(raw) };
}

/**
 * Exercises a JSON backup in an isolated temporary directory. It never replaces
 * the caller's live file and returns only bounded metadata, not business data.
 */
export async function runJsonRecoveryDrill(filePath) {
  const target = path.resolve(filePath);
  const backup = `${target}.bak`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ozon-erp-recovery-"));
  const tempTarget = path.join(tempDir, path.basename(target));
  try {
    const backupSnapshot = await readValidJson(backup);
    await fs.copyFile(backup, tempTarget);
    const restored = await readValidJson(tempTarget);
    return {
      ok: true,
      source: backup,
      target: target,
      restoredDigest: digest(restored.raw),
      backupDigest: digest(backupSnapshot.raw),
      sameContent: digest(restored.raw) === digest(backupSnapshot.raw),
      topLevel: Array.isArray(restored.value) ? "array" : typeof restored.value,
    };
  } catch (error) {
    return {
      ok: false,
      source: backup,
      target,
      reasonCode: error?.code === "ENOENT" ? "BACKUP_MISSING" : "BACKUP_INVALID",
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/recovery-drill.mjs <json-file>");
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(await runJsonRecoveryDrill(filePath)));
  }
}
