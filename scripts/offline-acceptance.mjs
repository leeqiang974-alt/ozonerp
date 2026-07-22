import { spawnSync } from "node:child_process";
import { buildApiEvidenceSummary } from "../src/apiEvidence.js";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

// Offline acceptance aggregator. Commands are local test/lint/fixture replay
// only; this script never starts the server, creates a DB client, or writes an
// output artifact.
const checks = [];
function run(name, command, args) {
  // npm.cmd cannot be launched directly by spawnSync on this Windows runtime;
  // invoke the fixed, local command through cmd.exe without shell=true so the
  // aggregator does not emit DEP0190 and never interpolates user input.
  const executable = process.platform === "win32" && command === npmCommand ? (process.env.ComSpec || "cmd.exe") : command;
  const executableArgs = executable === command ? args : ["/d", "/s", "/c", command, ...args];
  const result = spawnSync(executable, executableArgs, { encoding: "utf8" });
  const output = `${result.stdout || ""}${result.stderr || ""}${result.error?.message || ""}`.trim();
  checks.push({
    name,
    ok: result.status === 0,
    exitCode: result.status,
    summary: output.split(/\r?\n/).slice(-3).join(" ").slice(0, 600),
    nextAction: result.status === 0 ? "通过" : `查看 ${name} 的本地输出并修复后重跑。`,
  });
}

run("tests", npmCommand, ["test"]);
run("lint", npmCommand, ["run", "lint"]);
run("golden_path_fixture", process.execPath, ["scripts/golden-path-replay.mjs", "tier-price-moq"]);

const apiEvidence = buildApiEvidenceSummary({
  apiSourcePath: "D:\\Desktop\\api\\ozonapi.txt",
  sellerApiDocPath: "D:\\Desktop\\ozonseller api\\Ozon Seller API 文件.html",
});
const matrixOk = apiEvidence.canonicalStoreAudit.status === "matched" && apiEvidence.matrixConsistency.ok === true;
checks.push({
  name: "api_matrix_local",
  ok: matrixOk,
  exitCode: matrixOk ? 0 : 1,
  summary: `canonical=${apiEvidence.canonicalStoreAudit.status}; sellerHtml=${apiEvidence.matrixConsistency.status}; stores=${apiEvidence.canonicalStoreAudit.primaryStoreCount}/4`,
  nextAction: matrixOk ? "通过；仍需人工确认后才可真实读取。" : "核对 canonical 四店铺文件和 Seller HTML 指纹，不能执行真实读取。",
});

const blockers = checks.filter((check) => !check.ok);
const output = {
  ok: blockers.length === 0,
  execution: "offline_acceptance_only",
  checks,
  blockers: blockers.map(({ name, summary, nextAction }) => ({ name, summary, nextAction })),
  nextAction: blockers[0]?.nextAction || "离线验收通过；真实部署/读取仍需单独授权、确认和服务端回执。",
  networkAccessed: false,
  databaseObserved: false,
  writesExecuted: false,
  outputPersisted: false,
  sideEffect: "仅执行本地测试、lint、fixture replay 和本地证据指纹检查；不联网、不连接数据库、不写入验收工件。",
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
