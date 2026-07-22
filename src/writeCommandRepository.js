import fs from "node:fs/promises";
import path from "node:path";

const BUSINESS_SUMMARY_FIELDS = new Set([
  "action",
  "offerCount",
  "offers",
  "skuCount",
  "warehouseId",
  "targetCount",
  "currencyCode",
  "minPrice",
  "maxPrice",
]);
const RESULT_SUMMARY_FIELDS = new Set([
  "status",
  "taskId",
  "requestId",
  "offerCount",
  "acceptedCount",
  "failedCount",
  "reconciledCount",
]);
const ERROR_SUMMARY_FIELDS = new Set(["status", "code", "message", "requestId"]);
const STALE_REVIEW_REASONS = new Set([
  "timeout",
  "worker_interrupted",
  "process_restarted",
  "unknown_outcome",
  "manual_review_required",
]);

function selectSafeFields(value = {}, allowed = new Set()) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key, item]) => (
    allowed.has(key)
    && (item === null || ["string", "number", "boolean"].includes(typeof item)
      || (Array.isArray(item) && item.every((entry) => ["string", "number", "boolean"].includes(typeof entry))))
  )));
}

function commandId(scope, key) {
  return `${String(scope || "").trim()}::${String(key || "").trim()}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class WriteCommandRepository {
  constructor({ file, now = () => new Date().toISOString(), staleAfterMs = 15 * 60 * 1000 } = {}) {
    if (!file) throw new Error("write command repository requires a file");
    this.file = path.resolve(file);
    this.now = now;
    this.staleAfterMs = Math.max(1, Number(staleAfterMs || 0));
    this.writeTail = Promise.resolve();
    this.lockFile = `${this.file}.lock`;
  }

  async read() {
    let raw;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, commands: [] };
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.commands)) throw new Error("invalid schema");
      return parsed;
    } catch (cause) {
      const error = new Error(`Write command storage is corrupt: ${this.file}`, { cause });
      error.code = "COMMAND_STORE_CORRUPT";
      throw error;
    }
  }

  commandView(command = {}) {
    const nowMs = Date.parse(this.now());
    const createdMs = Date.parse(command.createdAt);
    const ageMs = Number.isFinite(nowMs) && Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0;
    return {
      id: String(command.id || ""),
      scope: String(command.scope || ""),
      key: String(command.key || ""),
      payloadHash: String(command.payloadHash || ""),
      actorId: String(command.actorId || ""),
      storeId: String(command.storeId || ""),
      businessSummary: selectSafeFields(command.businessSummary, BUSINESS_SUMMARY_FIELDS),
      state: String(command.state || ""),
      createdAt: String(command.createdAt || ""),
      updatedAt: String(command.updatedAt || ""),
      completedAt: String(command.completedAt || ""),
      resultSummary: selectSafeFields(command.resultSummary, RESULT_SUMMARY_FIELDS),
      errorSummary: selectSafeFields(command.errorSummary, ERROR_SUMMARY_FIELDS),
      review: command.review ? {
        reason: STALE_REVIEW_REASONS.has(command.review.reason) ? command.review.reason : "manual_review_required",
        actorId: String(command.review.actorId || ""),
        markedAt: String(command.review.markedAt || ""),
      } : null,
      ageMs,
      stale: command.state === "in_progress" && ageMs >= this.staleAfterMs,
    };
  }

  async listCommands(filter = {}) {
    const store = await this.read();
    const states = Array.isArray(filter.state) ? filter.state.map(String) : (filter.state ? [String(filter.state)] : []);
    const scopes = Array.isArray(filter.scope) ? filter.scope.map(String) : (filter.scope ? [String(filter.scope)] : []);
    const storeId = String(filter.storeId || "");
    const olderThan = filter.olderThan;
    const olderThanAgeMs = typeof olderThan === "number" ? Math.max(0, olderThan) : null;
    const olderThanDateMs = typeof olderThan === "string" ? Date.parse(olderThan) : null;
    const priority = (item) => item.state === "needs_review" ? 0 : (item.stale ? 1 : 2);
    const filtered = store.commands
      .map((command) => this.commandView(command))
      .filter((item) => !states.length || states.includes(item.state))
      .filter((item) => !scopes.length || scopes.includes(item.scope))
      .filter((item) => !storeId || item.storeId === storeId)
      .filter((item) => olderThanAgeMs === null || item.ageMs >= olderThanAgeMs)
      .filter((item) => !Number.isFinite(olderThanDateMs) || Date.parse(item.createdAt) <= olderThanDateMs)
      .sort((a, b) => priority(a) - priority(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    const requestedLimit = Number(filter.limit || 50);
    const requestedOffset = Number(filter.offset || 0);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 50;
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
      hasMore: offset + limit < filtered.length,
    };
  }

  async summarizeNeedsReview() {
    const store = await this.read();
    const items = store.commands.map((command) => this.commandView(command));
    const attention = items.filter((item) => item.state === "needs_review" || item.stale);
    const countBy = (field) => Object.fromEntries([...attention.reduce((map, item) => {
      const key = String(item[field] || "unknown");
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));
    return {
      needsReview: attention.filter((item) => item.state === "needs_review").length,
      staleInProgress: attention.filter((item) => item.stale).length,
      totalAttention: attention.length,
      byScope: countBy("scope"),
      byStore: countBy("storeId"),
    };
  }

  async atomicWrite(store) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const backup = `${this.file}.bak`;
    try {
      await fs.writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", flag: "wx" });
      // Keep the last known-good command evidence before replacing the live file.
      // This mirrors the JSON repositories and makes the recovery drill useful
      // for unresolved write outcomes as well.
      try {
        await fs.copyFile(this.file, backup);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await fs.rename(temporary, this.file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async acquireFileLock() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const handle = await fs.open(this.lockFile, "wx");
        await handle.writeFile(`${process.pid}\n`, "utf8");
        return async () => {
          await handle.close().catch(() => {});
          await fs.rm(this.lockFile, { force: true }).catch(() => {});
        };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          const stat = await fs.stat(this.lockFile);
          if (Date.now() - stat.mtimeMs > 30_000) await fs.rm(this.lockFile, { force: true });
        } catch (statError) {
          if (statError.code !== "ENOENT") throw statError;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const error = new Error(`Write command storage lock timeout: ${this.file}`);
    error.code = "COMMAND_STORE_LOCK_TIMEOUT";
    throw error;
  }

  mutate(operation) {
    const run = this.writeTail.then(async () => {
      const release = await this.acquireFileLock();
      try {
        const store = await this.read();
        const result = await operation(store);
        if (result.write) await this.atomicWrite(store);
        return clone(result.value);
      } finally {
        await release();
      }
    });
    this.writeTail = run.catch(() => {});
    return run;
  }

  beginCommand(scope, key, payloadHash, context = {}) {
    return this.mutate(async (store) => {
      const normalizedScope = String(scope || "").trim();
      const normalizedKey = String(key || "").trim();
      const normalizedHash = String(payloadHash || "").trim();
      const normalizedStoreId = String(context.storeId || context.store || "");
      if (!normalizedScope || !normalizedKey || !normalizedHash) throw new Error("scope, key, and payloadHash are required");
      const id = commandId(normalizedScope, normalizedKey);
      const existing = store.commands.find((command) => command.id === id);
      if (existing) {
        if (existing.payloadHash !== normalizedHash) return { write: false, value: { status: "conflict", command: existing } };
        const ageMs = Math.max(0, Date.parse(this.now()) - Date.parse(existing.createdAt));
        const stale = existing.state === "in_progress" && Number.isFinite(ageMs) && ageMs >= this.staleAfterMs;
        return {
          write: false,
          value: {
            status: existing.state === "in_progress" ? "in_progress" : "replay",
            command: existing,
            ...(existing.state === "in_progress" ? { ageMs, stale } : {}),
          },
        };
      }
      const unresolvedPayload = store.commands.find((command) => (
        command.scope === normalizedScope
        && command.storeId === normalizedStoreId
        && command.payloadHash === normalizedHash
        && ["in_progress", "needs_review"].includes(command.state)
      ));
      if (unresolvedPayload) {
        return { write: false, value: { status: "unresolved_payload" } };
      }
      const createdAt = this.now();
      const command = {
        id,
        scope: normalizedScope,
        key: normalizedKey,
        payloadHash: normalizedHash,
        actorId: String(context.actorId || context.actor || ""),
        storeId: normalizedStoreId,
        businessSummary: selectSafeFields(context.summary, BUSINESS_SUMMARY_FIELDS),
        state: "in_progress",
        createdAt,
        updatedAt: createdAt,
      };
      store.commands.push(command);
      return { write: true, value: { status: "created", command } };
    });
  }

  completeCommand(scope, key, result = {}) {
    return this.finish(scope, key, "completed", {
      resultSummary: selectSafeFields(result, RESULT_SUMMARY_FIELDS),
    });
  }

  failCommand(scope, key, error = {}) {
    return this.finish(scope, key, "failed", {
      errorSummary: selectSafeFields(error, ERROR_SUMMARY_FIELDS),
    });
  }

  reviewCommand(scope, key, reason = "unknown_outcome", error = {}) {
    const normalizedReason = String(reason || "").trim();
    if (!STALE_REVIEW_REASONS.has(normalizedReason)) {
      const invalid = new Error("Write command review reason is not allowed");
      invalid.code = "COMMAND_REVIEW_REASON_INVALID";
      return Promise.reject(invalid);
    }
    return this.mutate(async (store) => {
      const command = store.commands.find((item) => item.id === commandId(scope, key));
      if (!command) {
        const missing = new Error(`Write command not found: ${scope}/${key}`);
        missing.code = "COMMAND_NOT_FOUND";
        throw missing;
      }
      if (command.state !== "in_progress") return { write: false, value: command };
      const markedAt = this.now();
      command.state = "needs_review";
      command.errorSummary = selectSafeFields(error, ERROR_SUMMARY_FIELDS);
      command.review = { reason: normalizedReason, actorId: "", markedAt };
      command.updatedAt = markedAt;
      return { write: true, value: command };
    });
  }

  markStaleForReview(scope, key, reason, actor = "") {
    return this.mutate(async (store) => {
      const command = store.commands.find((item) => item.id === commandId(scope, key));
      if (!command) {
        const error = new Error(`Write command not found: ${scope}/${key}`);
        error.code = "COMMAND_NOT_FOUND";
        throw error;
      }
      const normalizedReason = String(reason || "").trim();
      if (!STALE_REVIEW_REASONS.has(normalizedReason)) {
        const error = new Error("Write command review reason is not allowed");
        error.code = "COMMAND_REVIEW_REASON_INVALID";
        throw error;
      }
      const ageMs = Math.max(0, Date.parse(this.now()) - Date.parse(command.createdAt));
      if (command.state !== "in_progress" || !Number.isFinite(ageMs) || ageMs < this.staleAfterMs) {
        const error = new Error("Write command is not stale and cannot be moved to review");
        error.code = "COMMAND_NOT_STALE";
        throw error;
      }
      const markedAt = this.now();
      command.state = "needs_review";
      command.review = {
        reason: normalizedReason,
        actorId: String(actor || ""),
        markedAt,
      };
      command.updatedAt = markedAt;
      return { write: true, value: command };
    });
  }

  finish(scope, key, state, patch) {
    return this.mutate(async (store) => {
      const command = store.commands.find((item) => item.id === commandId(scope, key));
      if (!command) {
        const error = new Error(`Write command not found: ${scope}/${key}`);
        error.code = "COMMAND_NOT_FOUND";
        throw error;
      }
      if (command.state !== "in_progress") return { write: false, value: command };
      const completedAt = this.now();
      Object.assign(command, patch, { state, completedAt, updatedAt: completedAt });
      return { write: true, value: command };
    });
  }
}
