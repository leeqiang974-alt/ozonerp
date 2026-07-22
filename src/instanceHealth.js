function asTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : NaN;
}

export function buildMultiInstanceHealthReport(instances = [], {
  now = Date.now(),
  staleAfterMs = 90 * 1000,
  maxFutureSkewMs = 5 * 60 * 1000,
  expectedRelease = "",
  requireReleaseEvidence = true,
} = {}) {
  const items = Array.isArray(instances) ? instances : [];
  const seen = new Map();
  const issues = [];
  if (!items.length) {
    issues.push({
      code: "INSTANCE_INVENTORY_EMPTY",
      severity: "high",
      nextAction: "重新采集实例摘要；在确认至少一个实例存活前不要报告部署就绪",
    });
  }
  const normalized = items.map((item) => {
    const instanceId = String(item?.instanceId || "").trim();
    const generatedAt = asTime(item?.generatedAt);
    const release = String(item?.release || item?.appRelease || "").trim();
    if (!instanceId) issues.push({ code: "INSTANCE_ID_MISSING", severity: "high", nextAction: "为每个进程配置唯一 OZON_ERP_INSTANCE_ID" });
    else seen.set(instanceId, (seen.get(instanceId) || 0) + 1);
    if (!Number.isFinite(generatedAt)) issues.push({ code: "INSTANCE_HEARTBEAT_INVALID", severity: "high", instanceId: instanceId || undefined, nextAction: "重新采集实例摘要" });
    else if (generatedAt - Number(now) > Math.max(0, Number(maxFutureSkewMs))) issues.push({ code: "INSTANCE_HEARTBEAT_FUTURE", severity: "high", instanceId, nextAction: "检查实例时钟和心跳签名；未来时间戳不能证明进程存活" });
    else if (Number(now) - generatedAt > staleAfterMs) issues.push({ code: "INSTANCE_HEARTBEAT_STALE", severity: "high", instanceId, nextAction: "检查实例进程和采集链路" });
    if ((expectedRelease || requireReleaseEvidence) && !release) issues.push({ code: "INSTANCE_RELEASE_MISSING", severity: "high", instanceId: instanceId || undefined, nextAction: "为实例摘要提供发布版本，再判断滚动发布是否完成" });
    // A mixed release means the fleet is not on the deployment that was
    // explicitly checked.  Treat it as a hard readiness failure: a medium
    // issue would otherwise leave `ok=true` when all heartbeats are fresh.
    else if (expectedRelease && release !== expectedRelease) issues.push({ code: "INSTANCE_RELEASE_MISMATCH", severity: "high", instanceId, nextAction: "确认滚动发布是否完成" });
    return { instanceId, generatedAt: item?.generatedAt || "", release };
  });
  const releases = [...new Set(normalized.map((item) => item.release).filter(Boolean))];
  if (!expectedRelease && releases.length > 1) {
    issues.push({
      code: "INSTANCE_RELEASE_MIXED",
      severity: "high",
      releases: releases.slice(0, 20),
      nextAction: "为发布检查指定 expectedRelease，或完成滚动发布后再判断实例是否就绪",
    });
  }
  for (const [instanceId, count] of seen) {
    if (count > 1) issues.push({ code: "INSTANCE_ID_DUPLICATE", severity: "high", instanceId, nextAction: "修正实例 ID，避免幂等/审计无法区分" });
  }
  return {
    ok: issues.every((issue) => issue.severity !== "high"),
    readOnly: true,
    instanceCount: normalized.length,
    instances: normalized,
    issues,
    sideEffect: "仅分析已采集的实例摘要；未连接实例、未重启进程、未执行修复。",
  };
}
