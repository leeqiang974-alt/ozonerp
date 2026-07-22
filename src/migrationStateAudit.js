import fs from "node:fs/promises";
import path from "node:path";
import { CORE_MIGRATION_TABLES, CORE_SCHEMA_VERSION } from "./migrationCheck.js";

const DEFAULT_STATE_FILE = path.resolve("data", "migration-state.json");

function issue(code, nextAction, extra = {}) {
  return { code, severity: "high", nextAction, ...extra };
}

function validTimestamp(value) {
  return typeof value === "string" && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}

/** Read-only audit; never connects to or writes the target database/state file. */
export async function buildMigrationStateAudit({
  stateFile = DEFAULT_STATE_FILE,
  requiredTables = CORE_MIGRATION_TABLES,
} = {}) {
  const file = path.resolve(stateFile);
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    const code = error?.code === "ENOENT" ? "MIGRATION_STATE_MISSING" : "MIGRATION_STATE_INVALID";
    return {
      ok: false, state: "unreadable", file, schemaVersion: null,
      completedTables: [], missingTables: [...requiredTables],
      blockers: [issue(code, "初始化或从隔离备份恢复迁移状态；不要把缺失状态当作已迁移")],
      nextAction: "初始化或从隔离备份恢复迁移状态；不要把缺失状态当作已迁移",
      databaseObserved: false, writeStarted: false, readOnly: true,
      sideEffect: "仅读取本地状态文件；未连接数据库、未修改状态、未执行恢复。",
    };
  }

  const blockers = [];
  const schemaVersion = raw?.schemaVersion;
  const done = raw?.done;
  if (schemaVersion !== CORE_SCHEMA_VERSION) {
    blockers.push(issue("MIGRATION_STATE_SCHEMA_UNKNOWN", "确认状态文件 schemaVersion 与当前迁移版本一致后再继续", { schemaVersion }));
  }
  if (!done || typeof done !== "object" || Array.isArray(done)) {
    blockers.push(issue("MIGRATION_STATE_DONE_INVALID", "恢复结构为 {schemaVersion: 1, done: {}} 的隔离状态文件"));
  }

  const completedTables = [];
  const missingTables = [];
  const invalidTables = [];
  if (done && typeof done === "object" && !Array.isArray(done)) {
    for (const table of requiredTables) {
      const value = done[table];
      if (value == null) missingTables.push(table);
      else if (!validTimestamp(value)) {
        invalidTables.push(table);
        blockers.push(issue("MIGRATION_STATE_TIMESTAMP_INVALID", "重新生成迁移状态或从隔离备份恢复可解析的 ISO 时间", { table }));
      } else completedTables.push(table);
    }
    if (missingTables.length) {
      blockers.push(issue("MIGRATION_STATE_INCOMPLETE", "先完成缺失表迁移并重新审计；禁止把部分状态报告为完成", { tables: missingTables }));
    }
  }

  return {
    ok: blockers.length === 0, state: blockers.length ? "blocked" : "complete", file,
    schemaVersion, requiredTables: [...requiredTables], completedTables, missingTables,
    invalidTables, blockers, databaseObserved: false, writeStarted: false, readOnly: true,
    nextAction: blockers[0]?.nextAction || "迁移状态完整；仍需按部署环境执行受控恢复演练。",
    sideEffect: "仅读取本地状态文件；未连接数据库、未修改状态、未执行恢复。",
    note: "状态审计只能证明本地迁移标记完整，不能证明目标数据库已执行或可恢复。",
  };
}
