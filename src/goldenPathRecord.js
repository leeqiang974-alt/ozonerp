const PRODUCT_SHAPES = new Set([
  "single_sku",
  "multi_sku_color",
  "multi_sku_color_size",
  "bundle",
  "missing_package_data",
  "human_verification_resume",
  "commission_read_recovery",
  "moderation_repair",
  "stock_write_readback",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validReplayId(value) {
  return /^R(?:0[1-9]|10)$/.test(text(value));
}

function normalizeUrl(value) {
  const raw = text(value);
  if (!raw) return { value: null, valid: false, reason: "SOURCE_URL_REQUIRED" };
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host !== "1688.com" && !host.endsWith(".1688.com")) {
      return { value: raw, valid: false, reason: "SOURCE_URL_NOT_1688" };
    }
    return { value: url.toString(), valid: true, reason: null };
  } catch {
    return { value: raw, valid: false, reason: "SOURCE_URL_INVALID" };
  }
}

function blocker(code, stage, nextAction) {
  return { code, stage, nextAction };
}

/**
 * Create the offline starting record for one controlled 1688 -> Ozon replay.
 * This is a plan/recording artifact only. It never reads a page or Ozon and
 * intentionally cannot contain server-observed evidence.
 */
export function createGoldenPathRecord(input = {}) {
  const replayId = text(input.replayId) || "R01";
  const shape = text(input.productShape) || "single_sku";
  const sourceUrl = normalizeUrl(input.sourceUrl || input.url);
  const blockers = [];

  if (!validReplayId(replayId)) blockers.push(blocker("REPLAY_ID_INVALID", "record", "使用 R01-R10 的回放编号。"));
  if (!PRODUCT_SHAPES.has(shape)) blockers.push(blocker("PRODUCT_SHAPE_UNSUPPORTED", "record", "选择记录模板支持的商品形态。"));
  if (!sourceUrl.valid) blockers.push(blocker(sourceUrl.reason, "source", "补充可访问的 1688 商品详情 URL；本命令不会访问该 URL。"));

  blockers.push(blocker("SOURCE_SNAPSHOT_REQUIRED", "source", "通过受控 1688 页面采集并保存脱敏 manifest/page 快照；验证码或风控时暂停。"));
  blockers.push(blocker("OZON_READ_REQUIRED", "ozon_read", "在同一 signed session、环境和店铺范围完成 Seller API 类目/属性只读回查。"));
  blockers.push(blocker("STORE_SCOPE_REQUIRED", "scope", "确认一个当前店铺和环境；没有匹配 session 只能停留在计划阶段。"));
  blockers.push(blocker("DRAFT_NOT_BUILT", "draft", "绑定 source snapshot、SKU、媒体、俄文内容、尺重和价格证据后再生成草稿。"));
  blockers.push(blocker("PREFLIGHT_NOT_RUN", "preflight", "草稿完成后运行预检；存在任一 blocker 不得提交。"));

  const recordedAt = text(input.recordedAt) || new Date().toISOString();
  return {
    schemaVersion: "golden_path_replay_record.v1",
    evidenceType: "real_replay_plan",
    replayId,
    productShape: shape,
    source: {
      url: sourceUrl.value,
      snapshotHash: null,
      status: "not_captured",
      verificationLevel: "configuration_declared",
    },
    ozon: {
      environment: null,
      storeId: null,
      readStatus: "not_read",
      verificationLevel: "configuration_declared",
    },
    draft: { status: "not_started", hash: null },
    submission: { status: "not_started", taskId: null },
    moderation: { status: "not_started", observed: false },
    stock: { status: "not_started", exactTuples: [], paginationComplete: false },
    status: "not_started",
    verificationLevel: "configuration_declared",
    recordedAt,
    blockers,
    nextAction: "先完成受控 1688 页面快照，再在同店铺/环境读取 Ozon 类目和必填属性；当前记录不得提交 Ozon。",
    execution: "offline_only",
    sideEffect: "仅生成本地回放记录；不会访问 1688/Ozon、创建草稿或执行写入。",
  };
}

export { PRODUCT_SHAPES };
