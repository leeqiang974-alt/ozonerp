import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src");
const files = readdirSync(srcDir).filter((f) => f.endsWith(".js")).map((f) => path.join(srcDir, f));
for (const file of files) {
  const res = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status || 1);
}
console.log(`lint-check passed (${files.length} files)`);

