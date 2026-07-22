const DAY_MS = 24 * 60 * 60 * 1000;

function withinWindow(value, nowMs, windowMs) {
  if (!value) return false;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) && nowMs - timestamp >= 0 && nowMs - timestamp <= windowMs;
}

function statusOf(item = {}) {
  return String(item.status || item.stage || "unknown").trim().toLowerCase() || "unknown";
}

/**
 * Build a redacted, read-only operator summary from the local auto-listing
 * snapshot. A malformed snapshot is an operational failure, never an empty
 * healthy queue. `nowMs` is injectable so the 24-hour boundary is testable.
 */
export function buildHealthSummary({ raw = null, storageState = "present", nowMs = Date.now(), windowMs = DAY_MS } = {}) {
  if (storageState === "corrupt" || !raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.items)) {
    return {
      ok: false,
      reasonCode: "HEALTH_STORAGE_CORRUPT",
      storageState: "corrupt",
      verificationLevel: "local_file_read",
      nextAction: "检查 data/auto-listing-jobs.json 的 JSON 结构并从备份恢复后再运行健康检查。",
      sideEffect: "仅读取本地任务快照；未联网、未连接数据库、未修改任务。",
    };
  }

  const items = raw.items.filter((item) => item && typeof item === "object" && !Array.isArray(item));
  const recent = items.filter((item) => withinWindow(item.updatedAt || item.createdAt, nowMs, windowMs));
  const counts = {};
  for (const item of recent) {
    const status = statusOf(item);
    counts[status] = (counts[status] || 0) + 1;
  }
  const failed = recent.filter((item) => ["failed", "listing_failed"].includes(statusOf(item))).length;
  const listed = recent.filter((item) => ["listed", "submitted", "live"].includes(statusOf(item))).length;
  const needsReview = recent.filter((item) => ["needs_review", "needs_repair", "preflight_blocked"].includes(statusOf(item))).length;
  const pending = recent.filter((item) => !["failed", "listing_failed", "listed", "submitted", "live", "needs_review", "needs_repair", "preflight_blocked"].includes(statusOf(item))).length;
  const topReasons = new Map();
  for (const item of recent) {
    const reason = String(item.reasonCode || item.error || statusOf(item)).slice(0, 80);
    topReasons.set(reason, (topReasons.get(reason) || 0) + 1);
  }
  const reasonSummary = [...topReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
  const storageMissing = storageState === "missing";
  return {
    ok: true,
    storageState: storageMissing ? "missing" : "valid",
    verificationLevel: "local_file_read",
    window: { hours: Math.round(windowMs / (60 * 60 * 1000)), asOf: new Date(nowMs).toISOString() },
    total24h: recent.length,
    failed,
    listed,
    needsReview,
    pending,
    counts,
    topReasons: reasonSummary,
    nextAction: needsReview > 0
      ? "优先打开待复核/待修复任务，确认未知写入结果后再决定是否继续；不要重复提交。"
      : failed > 0
        ? "检查失败任务的原因和 Seller 回执，修复后重新预检。"
        : pending > 0
          ? "继续读取任务状态；未获得完整回执前不要把任务当作已完成。"
          : storageMissing
            ? "任务快照尚未生成；先启动 ERP 或执行一次只读任务检查。"
            : "最近 24 小时没有待处理任务。",
    sideEffect: "仅读取本地任务快照；未联网、未连接数据库、未修改任务或执行 Ozon 写入。",
  };
}
