const SHA256_RE = /^(?:(?:sha256|url-sha256):)?[a-f0-9]{64}$/i;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function statusOf(value) {
  const status = text(value).toLowerCase();
  return ["clear", "blocked", "unknown"].includes(status) ? status : "unknown";
}

function blocker(code, asset, fieldPath, message) {
  return {
    code,
    assetId: text(asset?.id),
    fieldPath,
    message,
  };
}

function inspectAsset(asset = {}, expectedSourceSnapshotHash = "") {
  const checks = asset?.checks && typeof asset.checks === "object" ? asset.checks : {};
  const blockers = [];
  const sourceUrl = text(asset.sourceUrl);
  if (!/^https?:\/\/[^\s]+$/i.test(sourceUrl)) {
    blockers.push(blocker("MEDIA_SOURCE_URL_INVALID", asset, "sourceUrl", "媒体来源链接无效，请重新采集可信来源。"));
  }

  const sourceHash = text(asset.sourceHash);
  if (!sourceHash) {
    blockers.push(blocker("MEDIA_SOURCE_HASH_MISSING", asset, "sourceHash", "缺少媒体来源哈希，请重新采集并保存来源证据。"));
  } else if (!SHA256_RE.test(sourceHash)) {
    blockers.push(blocker("MEDIA_SOURCE_HASH_INVALID", asset, "sourceHash", "媒体来源哈希格式无效，请重新采集来源。"));
  }
  const evidenceRef = text(asset.evidenceRef);
  if (!/^snapshot:(?:[a-f0-9]{64})$/i.test(evidenceRef)) {
    blockers.push(blocker("MEDIA_EVIDENCE_REF_INVALID", asset, "evidenceRef", "媒体缺少当前 1688 快照证据，请重新采集。"));
  } else if (/^sha256:[a-f0-9]{64}$/i.test(expectedSourceSnapshotHash)
    && `sha256:${evidenceRef.slice("snapshot:".length)}`.toLowerCase() !== expectedSourceSnapshotHash.toLowerCase()) {
    blockers.push(blocker("MEDIA_SOURCE_SNAPSHOT_MISMATCH", asset, "evidenceRef", "媒体来源快照与当前 1688 商品快照不一致，请重新采集并重新审批。"));
  }

  const ocr = checks.ocr && typeof checks.ocr === "object" ? checks.ocr : {};
  const ocrStatus = statusOf(ocr.status);
  if (ocrStatus === "blocked" || ocr.hasChinese || ocr.isFactoryIntro || ocr.hasOzonPolicyText) {
    blockers.push(blocker("MEDIA_OCR_RISK", asset, "checks.ocr", "图片包含待处理文字或平台政策风险，请翻译/替换后重新检查。"));
  } else if (ocrStatus !== "clear") {
    blockers.push(blocker("MEDIA_OCR_UNKNOWN", asset, "checks.ocr", "尚未完成图片 OCR 合规检查，请先完成检查。"));
  }

  const dimensions = checks.dimensions && typeof checks.dimensions === "object" ? checks.dimensions : {};
  const dimensionStatus = statusOf(dimensions.status);
  const width = Number(dimensions.width);
  const height = Number(dimensions.height);
  if (dimensionStatus === "blocked" || (Number.isFinite(width) && width <= 0) || (Number.isFinite(height) && height <= 0)) {
    blockers.push(blocker("MEDIA_DIMENSIONS_INVALID", asset, "checks.dimensions", "图片尺寸不合规，请替换或重新获取原图。"));
  } else if (dimensionStatus !== "clear") {
    blockers.push(blocker("MEDIA_DIMENSIONS_UNKNOWN", asset, "checks.dimensions", "尚未确认图片尺寸，请完成尺寸检查。"));
  }

  const sourceRisk = statusOf(checks.sourceRisk?.status || checks.sourceRisk);
  if (sourceRisk === "blocked") {
    blockers.push(blocker("MEDIA_SOURCE_RISK", asset, "checks.sourceRisk", "媒体来源存在版权或平台风险，请替换来源。"));
  } else if (sourceRisk !== "clear") {
    blockers.push(blocker("MEDIA_SOURCE_RISK_UNKNOWN", asset, "checks.sourceRisk", "尚未确认媒体来源风险，请核验来源后再批准。"));
  }

  return {
    assetId: text(asset.id),
    status: blockers.length ? "blocked" : "ready",
    blockers,
  };
}

/**
 * Seller-facing media gate. This is deliberately local evidence only: it does
 * not download media, run OCR, upload, or call Ozon. Producers may populate
 * checks.ocr/checks.dimensions/checks.sourceRisk asynchronously.
 */
export function buildMediaComplianceResult({ mediaAssets = [], mediaIssues = [], sourceSnapshotHash = "" } = {}) {
  const assets = Array.isArray(mediaAssets) ? mediaAssets.filter(Boolean) : [];
  if (!assets.length) {
    return {
      status: mediaIssues.length ? "blocked" : "not_present",
      verificationLevel: "locally_tested",
      blockers: mediaIssues.map((code) => ({ code: text(code), assetId: "", fieldPath: "mediaAssets", message: "媒体候选存在未解决问题，请重新检查。" })),
      assetResults: [],
      nextAction: mediaIssues.length ? "先处理媒体问题，再重新进行媒体合规检查。" : "没有待审查媒体候选。",
    };
  }
  const assetResults = assets.map((asset) => inspectAsset(asset, sourceSnapshotHash));
  const blockers = assetResults.flatMap((result) => result.blockers);
  for (const issue of mediaIssues) {
    const code = text(issue);
    if (!blockers.some((item) => item.code === code)) blockers.push({ code, assetId: "", fieldPath: "mediaIssues", message: "媒体候选存在未解决问题，请处理后重新检查。" });
  }
  return {
    status: blockers.length ? "blocked" : "ready",
    verificationLevel: "locally_tested",
    blockers,
    assetResults,
    nextAction: blockers.length ? "按阻断原因补齐 OCR、尺寸和来源风险证据，再重新创建媒体批准草稿。" : "媒体合规检查通过，可进入绑定当前草稿的人工批准。",
  };
}
