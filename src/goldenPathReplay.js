import { buildListingPayloadDraftFromJob } from "./autoListing.js";
import { buildListingContentEvidence } from "./llmListing.js";
import { buildPreflightGateNode, buildSourceVariantBindingSummary } from "./workflowRuns.js";
import { inspect1688CaptureReplay } from "./captureReplay.js";

const DEFAULT_CATEGORY = {
  description_category_id: 17028673,
  type_id: 95183,
  path: "fixture / controlled category",
};

/**
 * Turn a fixture replay into one seller-facing task.  The replay already
 * exposes technical stage data, but a seller needs one current blocker and a
 * safe next action to know where to continue.  This summary is deliberately
 * separate from the listing preflight evidenceSummary: it describes the
 * replay's stage boundary and never approves a write.
 */
export function buildGoldenPathSellerTask({
  source = {},
  binding = {},
  categoryEvidence = {},
  content = {},
  media = {},
  pricing = {},
  preflight = {},
} = {}) {
  const stageNames = ["source", "sku", "category", "content", "media", "pricing", "preflight"];
  const blockers = [];
  if (source.verificationState === "waiting_human") {
    blockers.push({ stage: "source", code: "SOURCE_WAITING_HUMAN", nextAction: "回到 1688 页面完成验证后恢复采集；不要用不完整快照建草稿。" });
  } else if (source.ok !== true) {
    blockers.push({ stage: "source", code: "SOURCE_EVIDENCE_NOT_VERIFIED", nextAction: "重新读取 1688 商品并确认来源快照；当前回放不会创建 Ozon 草稿。" });
  }
  if (binding.ready !== true) {
    blockers.push({ stage: "sku", code: "SKU_SOURCE_BINDING_MISSING", nextAction: "补齐每个 Ozon offer 与 1688 SKU 的绑定后重新预检；不会自动合并变体。" });
  }
  if (categoryEvidence.currentReadObserved !== true) {
    blockers.push({ stage: "category", code: "CATEGORY_CURRENT_READ_REQUIRED", nextAction: "用当前店铺 Seller API 读取类目/属性并人工确认；fixture 类目不等于当前店铺证据。" });
  }
  if (content.status === "blocked") {
    blockers.push({ stage: "content", code: "CONTENT_FACT_REVIEW_REQUIRED", nextAction: String(content.nextAction || "逐字段核对 1688 事实与俄文内容后重新预检。") });
  }
  if (media.status === "needs_human_review") {
    blockers.push({ stage: "media", code: "MEDIA_HUMAN_REVIEW_REQUIRED", nextAction: "确认主图、SKU 图和详情媒体来源后重新预检；不会自动提交图片。" });
  }
  if (pricing.status === "blocked") {
    blockers.push({ stage: "pricing", code: "PRICING_EVIDENCE_MISSING", nextAction: "补齐采购成本、物流和佣金证据后重新计算价格；阻塞风险不能确认提交。" });
  }
  if (preflight.ok !== true) {
    blockers.push({ stage: "preflight", code: "PREFLIGHT_BLOCKED", nextAction: "按预检问题修复商品字段后重新运行预检；本回放不会提交 Ozon。" });
  }
  const primary = blockers[0] || {
    stage: "confirmation",
    code: "HUMAN_CONFIRMATION_REQUIRED",
    nextAction: "仅可进入人工确认阶段；先核对当前草稿、类目和费用，再决定是否受控提交。",
  };
  const blockedStages = new Set(blockers.map((blocker) => blocker.stage));
  const completedStages = stageNames.filter((stage) => !blockedStages.has(stage));
  return {
    status: blockers.length ? "blocked" : "needs_confirmation",
    blockedStage: blockers.length ? primary.stage : null,
    reasonCode: primary.code,
    nextAction: primary.nextAction,
    blockerCount: blockers.length,
    blockers: blockers.slice(0, 8),
    stageProgress: {
      completedStages,
      remainingStages: stageNames.filter((stage) => !completedStages.includes(stage)),
      completedCount: completedStages.length,
      totalCount: stageNames.length,
    },
    sideEffect: "仅提供离线 fixture 的操作建议；不会访问 1688、不会调用 Ozon、不会修改草稿或提交商品。",
  };
}

export function replay1688ToOzonPreflight(parsed = {}, {
  parentSku = "FIXTURE-PARENT-001",
  category = DEFAULT_CATEGORY,
  // Category metadata is an explicit local fixture input.  It must never be
  // inferred from the 1688 page or treated as a current Seller API read.
  categoryAttributes = [],
  dictionaryValuesByAttributeId = {},
  categoryReadEvidence = null,
  candidateTitle = "脱敏家居收纳用品",
  commissionRate = 0.15,
  commissionSource = "controlled_fixture",
} = {}) {
  const candidateData = {
    source: "1688",
    url: parsed.url || parsed.sourceEvidence?.canonicalUrl || "",
    sourceEvidence: parsed.sourceEvidence || null,
    title: parsed.title || candidateTitle,
    images: parsed.images || [],
    detailImages: parsed.detailImages || [],
    richContentJson: parsed.richContentJson || null,
    mediaAssets: parsed.mediaAssets || [],
    mediaIssues: parsed.mediaIssues || [],
    skuVariants: parsed.skuVariants || [],
    attributes: parsed.attributes || [],
    // The numeric fields alone are not source proof.  The listing builder
    // validates the package field against this snapshot before trusting it.
    sizeWeight: { ...(parsed.sizeWeight || {}) },
    procurementEvidence: parsed.procurementEvidence || {},
  };
  const job = {
    id: `fixture-${parsed.sourceEvidence?.offerId || "unknown"}`,
    source: "1688",
    pendingParentSku: parentSku,
    listingContent: {
      title_ru: "Органайзер для хранения",
      description_ru: "Контролируемый офлайн fixture для проверки цепочки 1688 → Ozon.",
      annotation: "Требует проверки продавцом перед отправкой.",
    },
    bestMatch: {
      candidateTitle,
      candidateUrl: candidateData.url,
      purchasePriceCny: Number(parsed.skuVariants?.[0]?.price || parsed.procurementEvidence?.priceTiers?.values?.[0]?.unitPriceCny || 0),
      source: "1688",
    },
    candidateData,
  };
  let draft = null;
  let draftError = "";
  try {
    draft = buildListingPayloadDraftFromJob(job, {
      categoryMatch: category,
      parentSku,
      pricingPolicy: { commissionRate, commissionSource },
    });
  } catch (error) {
    draftError = String(error?.message || error || "draft_build_failed");
    draft = {
      items: [],
      summary: {
        sourceVariants: [],
        pricingDiagnosis: { status: "blocked", missing: ["payload_draft"], commissionSource },
      },
    };
  }
  const sourceEvidence = parsed.sourceEvidence || null;
  const contentSummary = {
    candidateImageCount: candidateData.images.length,
    detailImageCount: candidateData.detailImages.length,
    mediaAssetCount: candidateData.mediaAssets.length,
    richContentImageCount: candidateData.detailImages.length,
    mediaReviewStatus: (candidateData.mediaAssets.length || candidateData.richContentJson)
      ? "needs_human_review"
      : "not_present",
    skuVariantCount: candidateData.skuVariants.length,
    sizeWeightReady: Boolean(candidateData.sizeWeight.weightG && candidateData.sizeWeight.lengthMm && candidateData.sizeWeight.widthMm && candidateData.sizeWeight.heightMm),
    contentIssues: [],
  };
  // Keep the offline replay aligned with the real auto-listing path: Russian
  // content is not considered reviewed merely because fixture text exists.
  // This makes the replay exercise the same fact-evidence gate that protects
  // a real 1688 submission.
  contentSummary.contentEvidence = buildListingContentEvidence(job.listingContent, candidateData, {
    humanConfirmed: false,
  });
  const preflight = buildPreflightGateNode({
    payload: { items: draft.items },
    category,
    attrsMeta: Array.isArray(categoryAttributes) ? categoryAttributes : [],
    dictionaryValuesByAttributeId: dictionaryValuesByAttributeId && typeof dictionaryValuesByAttributeId === "object"
      ? dictionaryValuesByAttributeId
      : {},
    sourceEvidence,
    sourceEvidenceRequired: true,
    sourceVariants: draft.summary.sourceVariants,
    sourceVariantBindingRequired: draft.summary.sourceVariants.length > 0,
    contentSummary,
    pricing: draft.summary.pricingDiagnosis,
    variantCount: draft.items.length,
  });
  const sourceBinding = buildSourceVariantBindingSummary({
    payload: { items: draft.items },
    sourceVariants: draft.summary.sourceVariants,
  });
  const procurement = draft.summary.pricingDiagnosis?.procurementEvidence || { status: "unknown", missing: [] };
  const ok = Boolean(preflight.output?.ok && procurement.status !== "blocked");
  const sellerTask = buildGoldenPathSellerTask({
    source: {
      ok: Boolean(sourceEvidence?.snapshotHash) && sourceEvidence?.verificationState === "ok",
      verificationState: sourceEvidence?.verificationState || "unknown",
    },
    binding: sourceBinding.summary,
    categoryEvidence: { currentReadObserved: false },
    content: contentSummary.contentEvidence,
    media: contentSummary,
    pricing: { status: procurement.status },
    preflight: { ok: Boolean(preflight.output?.ok) },
  });
  // Moderation is deliberately represented as an offline stage only.  A
  // fixture replay must never look like an Ozon moderation response or imply
  // that the product was submitted.  Keeping the offer count here makes the
  // single-SKU and multi-SKU paths auditable without inventing a platform
  // status for an account we did not call.
  const moderation = {
    evidenceType: "offline_fixture_replay",
    verificationLevel: "locally_tested_fixture",
    synthetic: true,
    redacted: true,
    observed: false,
    status: preflight.output?.ok ? "not_requested_offline" : "not_run_preflight_blocked",
    offerCount: draft.items.length,
    coveredOfferCount: 0,
    offerCoverage: "none",
    sourceSnapshotHash: sourceEvidence?.snapshotHash || "",
    nextAction: preflight.output?.ok
      ? "仅可在人工确认后通过受控写入，再用 Ozon 只读回查审核状态。"
      : "先修复预检阻塞；本回放不会提交，也不会产生审核回执。",
  };
  return {
    ok,
    verificationLevel: "locally_tested_fixture",
    stages: {
      source: {
        ok: Boolean(sourceEvidence?.snapshotHash) && sourceEvidence?.verificationState === "ok",
        offerId: sourceEvidence?.offerId || "",
        snapshotHash: sourceEvidence?.snapshotHash || "",
        verificationState: sourceEvidence?.verificationState || "unknown",
      },
      sku: {
        count: candidateData.skuVariants.length,
        sourceVariantCount: draft.summary.sourceVariants.length,
        binding: sourceBinding.summary,
        bindingRows: sourceBinding.rows,
      },
      // Keep the category decision auditable in the same replay artifact as
      // the SKU/source binding.  A category passed to this offline helper is
      // an input fixture (or a previously observed response), not proof of a
      // current Ozon category read; callers must supply a fresh cache/read
      // before using it for a real submission.
      category: {
        selected: {
          descriptionCategoryId: Number(category?.description_category_id || 0) || null,
          typeId: Number(category?.type_id || 0) || null,
          path: String(category?.path || ""),
        },
        selectionReasons: Array.isArray(category?.reasons)
          ? category.reasons.slice(0, 20).map((reason) => String(reason || "").trim()).filter(Boolean)
          : [],
        byOffer: draft.items.slice(0, 100).map((item) => ({
          offerId: String(item?.offer_id || "").trim(),
          sourceSkuId: String((draft.summary?.sourceVariants || []).find((variant) => String(variant?.offerId || variant?.offer_id || "").trim() === String(item?.offer_id || "").trim())?.sourceSkuId || "").trim(),
          descriptionCategoryId: Number(category?.description_category_id || 0) || null,
          typeId: Number(category?.type_id || 0) || null,
          selectionReasons: Array.isArray(category?.reasons)
            ? category.reasons.slice(0, 20).map((reason) => String(reason || "").trim()).filter(Boolean)
            : [],
        })),
        attributes: (Array.isArray(categoryAttributes) ? categoryAttributes : []).slice(0, 100).map((meta) => ({
          id: Number(meta?.id || 0) || null,
          name: String(meta?.name || meta?.attribute_name || "").trim(),
          required: meta?.is_required === true,
          aspect: meta?.is_aspect === true,
          dictionary: Number(meta?.dictionary_id || meta?.dictionaryId || 0) > 0,
          dictionaryId: Number(meta?.dictionary_id || meta?.dictionaryId || 0) || null,
        })).filter((meta) => meta.id),
        requiredAttributeIds: (Array.isArray(categoryAttributes) ? categoryAttributes : [])
          .filter((meta) => meta?.is_required === true && Number(meta?.id || 0))
          .map((meta) => Number(meta.id)).slice(0, 100),
        evidence: {
          source: String(categoryReadEvidence?.source || category?.source || "controlled_fixture"),
          verificationLevel: "locally_tested_fixture",
          currentReadObserved: false,
          fixtureKind: String(categoryReadEvidence?.fixtureKind || "mocked_redacted_category_read"),
          responseHash: String(categoryReadEvidence?.responseHash || ""),
        },
        nextAction: "提交前用当前店铺的 Ozon 类目/属性读取回执复核选择，并由卖家确认。",
      },
      draft: { ok: !draftError, itemCount: draft.items.length, parentSku, error: draftError },
      pricing: { status: procurement.status, missing: procurement.missing || [], commissionSource: draft.summary.pricingDiagnosis?.commissionSource || commissionSource },
      media: {
        status: contentSummary.mediaReviewStatus,
        detailImageCount: contentSummary.detailImageCount,
        mediaAssetCount: contentSummary.mediaAssetCount,
        richContentImageCount: contentSummary.richContentImageCount,
        issues: candidateData.mediaIssues.slice(0, 20),
      },
      content: {
        status: contentSummary.contentEvidence.status,
        blockerCodes: contentSummary.contentEvidence.blockerCodes,
        verificationLevel: contentSummary.contentEvidence.verificationLevel,
        sourceSnapshotHash: contentSummary.contentEvidence.source.snapshotHash,
        factCount: contentSummary.contentEvidence.facts.length,
        unsupportedFieldCount: contentSummary.contentEvidence.unsupportedClaims.length,
        nextAction: contentSummary.contentEvidence.action,
      },
      preflight: {
        ok: Boolean(preflight.output?.ok),
        issueCount: preflight.output?.issueCount || 0,
        issues: (preflight.output?.issues || []).map((issue) => issue.code || issue.message).slice(0, 20),
        requiredAttributes: preflight.output?.requiredAttributeFillSummary || null,
      },
      moderation,
    },
    sellerTask,
    // Keep the historical replay contract stable for automation consumers;
    // the more actionable seller-facing instruction lives in sellerTask.
    nextAction: ok ? "仅可进入人工确认阶段；本回放未调用 Ozon 写接口。" : "修复阶段阻塞后重新回放；本回放禁止提交 Ozon。",
  };
}

/**
 * Run the actual offline capture boundary before building an Ozon payload.
 *
 * The older replay helper accepted a parsed product directly, which made it
 * possible for a caller to accidentally skip task/offer/hash identity checks.
 * This wrapper is the capture -> replay -> preflight seam used by the seller
 * workflow: a failed identity check returns a blocked, write-free result and
 * never invokes payload construction.  It is intentionally offline and does
 * not promote fixture evidence to a live-account verification level.
 */
export function replay1688CaptureToOzonPreflight({ capture = {}, parsed = {}, html = "" } = {}, options = {}) {
  const replay = inspect1688CaptureReplay({ capture, parsed, html });
  if (replay.status !== "replayable") {
    return {
      ok: false,
      verificationLevel: "locally_tested_fixture",
      replay,
      stages: {
        source: {
          ok: false,
          offerId: String(parsed?.sourceEvidence?.offerId || parsed?.capture?.offerId || ""),
          snapshotHash: String(parsed?.sourceEvidence?.snapshotHash || ""),
          verificationState: String(parsed?.sourceEvidence?.verificationState || "unknown"),
        },
        draft: { ok: false, itemCount: 0, parentSku: String(options.parentSku || "FIXTURE-PARENT-001"), error: "CAPTURE_REPLAY_BLOCKED" },
        preflight: { ok: false, issueCount: replay.blockers.length, issues: replay.blockers.slice(0, 20) },
        moderation: {
          evidenceType: "offline_fixture_replay",
          verificationLevel: "locally_tested_fixture",
          synthetic: true,
          redacted: true,
          observed: false,
          status: "not_run_capture_replay_blocked",
          offerCount: 0,
          coveredOfferCount: 0,
          offerCoverage: "none",
          nextAction: "先修复 capture 身份或来源快照，再进入预检；本回放不会提交 Ozon。",
        },
      },
      sellerTask: {
        status: "blocked",
        blockedStage: "source",
        reasonCode: "CAPTURE_REPLAY_BLOCKED",
        nextAction: replay.nextAction,
        blockerCount: replay.blockers.length,
        blockers: replay.blockers.map((code) => ({ stage: "source", code, nextAction: replay.nextAction })),
        sideEffect: "仅检查本地 capture 身份与快照；不会访问 1688、不会调用 Ozon、不会创建草稿或提交商品。",
      },
      nextAction: "修复 capture 身份或来源快照证据后再恢复采集；本回放禁止提交 Ozon。",
    };
  }
  return { ...replay1688ToOzonPreflight(parsed, options), replay };
}
