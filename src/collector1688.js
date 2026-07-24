import { createHash } from "node:crypto";
import { buildMediaComplianceResult } from "./mediaCompliance.js";

const IMAGE_RE = /https?:\\?\/\\?\/[^"'\\\s<>]+?(?:\.jpg|\.jpeg|\.png|\.webp)(?:[^"'\\\s<>]*)?/gi;
export const MANUAL_CAPTURE_CONTRACT_VERSION = "manual_capture_v1";

export async function fetch1688Html(url, options = {}) {
  if (!/^https?:\/\/.+1688\.com\//i.test(url)) {
    throw new Error("请输入有效的 1688 商品链接");
  }
  const extraHeaders = options.headers && typeof options.headers === "object" ? options.headers : {};
  const cookie = String(options.cookie || "").trim();

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: "https://www.1688.com/",
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
  });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(`1688 页面请求失败：HTTP ${response.status}`);
  }
  return html;
}

export function parse1688Product({ url = "", html = "", hints = {} }) {
  const cleanHtml = String(html || "");
  if (!cleanHtml.trim()) {
    throw new Error("没有可解析的 1688 页面内容");
  }

  const jsonObjects = extractJsonObjects(cleanHtml);
  const title = pickTitle(cleanHtml, jsonObjects, hints);
  const description = pickDescription(cleanHtml, jsonObjects);
  const images = pickImages(cleanHtml, jsonObjects, hints);
  const detailHtml = pickDetailHtml(cleanHtml, jsonObjects);
  const detailImages = pickDetailImages(detailHtml, jsonObjects, hints);
  const attributes = normalizeAttributes(hints.attributes).length
    ? normalizeAttributes(hints.attributes)
    : pickAttributes(cleanHtml, jsonObjects);
  const skuProps = pickSkuProps(jsonObjects);
  const skuVariants = pickSkuVariants(jsonObjects, skuProps, attributes, hints);
  const skuAxes = buildStructuredSkuModel(jsonObjects, skuVariants);
  const sizeWeight = pickSizeWeight(cleanHtml, jsonObjects, attributes, hints);
  const procurement = buildProcurementEvidence(cleanHtml, jsonObjects, hints);
  const media = buildMediaCandidates(cleanHtml, images, detailImages, skuVariants);
  const mediaCompliance = buildMediaComplianceResult(media);
  const parseIssues = buildParseIssues({ title, images, skuVariants, attributes, sizeWeight, ...procurement });
  const sourceEvidence = buildSourceEvidence({
    url,
    html: cleanHtml,
    hints,
    title,
    images,
    skuVariants,
    sizeWeight,
    attributes,
    procurement,
    media,
  });

  return {
    source: "1688",
    // Keep the hand-off envelope explicit.  Browser captures historically
    // used `sentAt` and relied on the crawler job for identity, which made a
    // saved payload impossible to replay on its own.  The envelope is local
    // metadata only; it contains no cookies or raw page content.
    capture: normalize1688CaptureEnvelope({ url, ...hints }, {
      taskId: hints.taskId,
      url,
      captureMode: hints.captureMode || hints.sourceType,
    }),
    sourceEvidence,
    url,
    title,
    supplier: procurement.supplier,
    procurementEvidence: procurement.procurementEvidence,
    skuProps,
    skuAxes,
    skuVariants,
    images,
    detail: {
      text: description,
      html: detailHtml,
    },
    video: normalizeVideo(hints.video),
    detailImages,
    richContentJson: buildRichContent(detailImages),
    mediaAssets: media.mediaAssets,
    mediaIssues: media.mediaIssues,
    mediaCompliance,
    attributes,
    sizeWeight,
    parseIssues,
    ozonDraft: toOzonDraft({ title, images, attributes, skuVariants, sizeWeight }),
    warnings: buildWarnings({ title, images, skuVariants, attributes, sizeWeight }),
  };
}

/**
 * Normalize the minimum resumable/idempotent capture identity required by
 * the 1688 -> ERP hand-off.  This is deliberately pure so extension payloads
 * and offline fixtures share the same contract.
 */
export function normalize1688CaptureEnvelope(input = {}, context = {}) {
  const payload = input && typeof input === "object" ? input : {};
  const fallback = context && typeof context === "object" ? context : {};
  const nestedCapture = payload.capture && typeof payload.capture === "object" ? payload.capture : {};
  const url = String(payload.url || nestedCapture.url || fallback.url || "").trim();
  const offerId = String(
    payload.offerId
      || nestedCapture.offerId
      || url.match(/(?:detail\.)?1688\.com\/offer\/(\d+)(?:\.html)?/i)?.[1]
      || url.match(/[?&]offerId=(\d+)/i)?.[1]
      || "",
  ).trim();
  const rawCollectedAt = payload.collectedAt || payload.capturedAt || payload.sentAt
    || nestedCapture.collectedAt || fallback.collectedAt;
  const parsedDate = rawCollectedAt ? new Date(rawCollectedAt) : new Date();
  const collectedAt = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
  return {
    contractVersion: MANUAL_CAPTURE_CONTRACT_VERSION,
    taskId: String(payload.taskId || nestedCapture.taskId || fallback.taskId || "").trim(),
    url,
    offerId,
    collectedAt,
    captureMode: String(payload.captureMode || nestedCapture.captureMode || fallback.captureMode || "unknown").trim() || "unknown",
  };
}

/**
 * Normalize the browser-to-ERP manual capture boundary. Older extensions may
 * omit the version, so absence is upgraded to v1; an explicit unknown version
 * is rejected before parsing or persistence. Raw HTML stays in the transient
 * input only and is never included in the receipt contract.
 */
export function normalizeManualCapturePayload(input = {}, context = {}) {
  const payload = input && typeof input === "object" ? input : {};
  const fallback = context && typeof context === "object" ? context : {};
  const requestedVersion = String(payload.contractVersion || payload.captureContractVersion || payload.capture?.contractVersion || "").trim();
  if (requestedVersion && requestedVersion !== MANUAL_CAPTURE_CONTRACT_VERSION) {
    const error = new Error(`不支持的 1688 采集契约版本：${requestedVersion}`);
    error.status = 400;
    error.reasonCode = "MANUAL_CAPTURE_CONTRACT_UNSUPPORTED";
    throw error;
  }
  const capture = normalize1688CaptureEnvelope(payload, fallback);
  const html = String(payload.html || "");
  const normalizedPayload = {
    ...payload,
    ...capture,
    source: "1688",
    stage: String(payload.stage || fallback.stage || "detail").trim() || "detail",
    contractVersion: MANUAL_CAPTURE_CONTRACT_VERSION,
  };
  return {
    contractVersion: MANUAL_CAPTURE_CONTRACT_VERSION,
    source: "1688",
    stage: normalizedPayload.stage,
    storeId: String(payload.storeId || fallback.storeId || "").trim(),
    includeVideo: payload.includeVideo !== false,
    url: capture.url,
    offerId: capture.offerId,
    taskId: capture.taskId,
    collectedAt: capture.collectedAt,
    captureMode: capture.captureMode,
    capture,
    html,
    hints: normalizedPayload,
  };
}

/**
 * Convert a 1688 source evidence envelope into the seller-facing contract used
 * by collection/crawler screens.  This deliberately contains no raw HTML,
 * cookies, or supplier secrets: the hash is the replay reference and the
 * action tells the seller what can safely happen next.
 */
export function build1688SourceEvidenceContract(sourceEvidence = {}) {
  const evidence = sourceEvidence && typeof sourceEvidence === "object" ? sourceEvidence : {};
  const verificationState = String(evidence.verificationState || "unknown");
  const verificationReason = String(evidence.verificationReason || "");
  const fields = evidence.fields && typeof evidence.fields === "object" ? evidence.fields : {};
  const missingFields = Object.entries(fields)
    .filter(([, field]) => field?.source === "missing")
    .map(([name]) => name);
  const variantCount = Number(fields.variants?.count || 0);
  const packageValues = fields.package?.values && typeof fields.package.values === "object"
    ? fields.package.values
    : {};
  const packageComplete = ["weightG", "lengthMm", "widthMm", "heightMm"]
    .every((key) => Number(packageValues[key] || 0) > 0);
  const completenessGaps = [
    variantCount < 1 ? "variants" : "",
    !packageComplete ? "package" : "",
  ].filter(Boolean);
  const requiredFields = [...new Set([...missingFields, ...completenessGaps])];
  const hasSnapshot = /^sha256:[a-f0-9]{64}$/i.test(String(evidence.snapshotHash || ""));
  const waitingHuman = verificationState === "waiting_human";
  const status = waitingHuman ? "waiting_human" : (verificationState === "ok" && hasSnapshot ? (requiredFields.length ? "needs_review" : "ready") : "unknown");
  const reasonLabel = {
    login_required: "1688 登录状态失效",
    captcha: "检测到验证码或滑块",
    access_rate_limited: "1688 访问频繁",
    security_verification: "检测到 1688 安全验证",
  }[verificationReason] || "1688 页面证据不可用";
  const nextAction = waitingHuman
    ? `请在浏览器完成${reasonLabel}，确认页面恢复后再点击“恢复采集”`
    : status === "ready"
      ? "来源证据已记录，可进入类目、属性、内容和定价预检"
      : requiredFields.length
        ? `补齐来源字段：${requiredFields.join("、")}，然后重新采集并预检`
        : "重新打开 1688 商品详情页并采集有效页面快照";
  return {
    status,
    verificationState,
    verificationReason,
    verificationLabel: waitingHuman ? reasonLabel : (status === "ready" ? "来源证据已验证" : "来源证据待补齐"),
    snapshotHash: hasSnapshot ? String(evidence.snapshotHash) : "",
    canonicalUrl: String(evidence.canonicalUrl || ""),
    capturedAt: String(evidence.capturedAt || ""),
    missingFields: requiredFields,
    completenessGaps,
    blocker: waitingHuman
      ? `${reasonLabel}；自动化已暂停`
      : status === "ready" ? "" : "缺少可安全使用的完整来源证据",
    nextAction,
    sideEffects: waitingHuman || status !== "ready"
      ? ["不会提交 Ozon", "不会修改价格", "不会写入库存"]
      : [],
  };
}

function buildMediaCandidates(html, images, detailImages, skuVariants) {
  if (hasVerificationChallenge(html)) return { mediaAssets: [], mediaIssues: [] };
  const snapshotHash = createHash("sha256").update(String(html || ""), "utf8").digest("hex");
  const evidenceRef = `snapshot:${snapshotHash}`;
  const detailSet = new Set(detailImages || []);
  const candidates = [];
  for (const sourceUrl of images || []) {
    if (!detailSet.has(sourceUrl)) candidates.push({ role: "main", sourceUrl, sourceSkuId: "" });
  }
  for (const variant of skuVariants || []) {
    if (variant?.image) candidates.push({ role: "variant", sourceUrl: variant.image, sourceSkuId: variant.skuId || "" });
  }
  for (const sourceUrl of detailImages || []) candidates.push({ role: "detail", sourceUrl, sourceSkuId: "" });

  const deduped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.role}:${candidate.sourceUrl}:${candidate.sourceSkuId}`;
    if (deduped.has(key)) continue;
    const urlHash = createHash("sha256").update(candidate.sourceUrl, "utf8").digest("hex");
    const idHash = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16);
    deduped.set(key, {
      id: `media:${idHash}`,
      role: candidate.role,
      sourceUrl: candidate.sourceUrl,
      sourceSkuId: candidate.sourceSkuId,
      evidenceRef,
      sourceHash: `url-sha256:${urlHash}`,
      checks: { humanApproved: false },
    });
  }
  return {
    mediaAssets: [...deduped.values()],
    mediaIssues: detailImages?.length ? ["detail_images_require_human_review_before_rich_content"] : [],
  };
}

function buildProcurementEvidence(html, jsonObjects, hints = {}) {
  const snapshotRef = `snapshot:${createHash("sha256").update(String(html || ""), "utf8").digest("hex")}`;
  const verificationBlocked = hasVerificationChallenge(html);
  const hintedSupplier = hints.supplier && typeof hints.supplier === "object" ? hints.supplier : {};
  const supplierId = verificationBlocked ? "" : cleanupText(
    hintedSupplier.id || hints.supplierId || findValuesByKey(jsonObjects, ["companyId", "supplierId", "sellerId"])[0] || "",
  );
  const supplierName = verificationBlocked ? "" : cleanupText(
    hintedSupplier.name || hints.supplierName || findValuesByKey(jsonObjects, ["companyName", "supplierName", "sellerName"])[0] || "",
  );
  const priceTiers = verificationBlocked ? [] : pickProcurementPriceTiers(jsonObjects, hints);
  const explicitMoq = verificationBlocked ? null : firstNumber(
    hints.moq,
    ...findValuesByKey(jsonObjects, ["beginAmount", "minOrderQuantity", "minimumOrderQuantity", "minOrder"]),
  );
  const moq = explicitMoq || priceTiers[0]?.minQuantity || null;
  const field = (value, hinted = false) => ({
    value,
    source: value == null || value === "" || (Array.isArray(value) && !value.length)
      ? "missing"
      : (hinted ? "capture_hint" : "page_content"),
    evidenceRef: value == null || value === "" || (Array.isArray(value) && !value.length) ? "" : snapshotRef,
  });
  return {
    supplier: { id: supplierId, name: supplierName },
    procurementEvidence: {
      supplierId: field(supplierId, Boolean(hintedSupplier.id || hints.supplierId)),
      supplierName: field(supplierName, Boolean(hintedSupplier.name || hints.supplierName)),
      moq: field(moq, hints.moq != null),
      priceTiers: {
        values: priceTiers,
        source: priceTiers.length ? (Array.isArray(hints.priceTiers) ? "capture_hint" : "page_content") : "missing",
        evidenceRef: priceTiers.length ? snapshotRef : "",
      },
    },
  };
}

function pickProcurementPriceTiers(jsonObjects, hints = {}) {
  const tierArrays = [];
  if (Array.isArray(hints.priceTiers)) tierArrays.push(hints.priceTiers);
  for (const object of walkObjects(jsonObjects)) {
    for (const key of ["priceRanges", "priceTiers", "rangePrices", "ladderPrices"]) {
      if (Array.isArray(object?.[key])) tierArrays.push(object[key]);
    }
  }
  const tiers = tierArrays.flatMap((items) => items.map((item) => {
    const minQuantity = firstNumber(item?.minQuantity, item?.startQuantity, item?.beginAmount, item?.minAmount);
    const unitPriceCny = firstNumber(item?.unitPriceCny, item?.price, item?.unitPrice);
    const maxQuantity = firstNumber(item?.maxQuantity, item?.endQuantity, item?.maxAmount);
    if (!minQuantity || !unitPriceCny) return null;
    return { minQuantity, maxQuantity: maxQuantity || null, unitPriceCny };
  }).filter(Boolean));
  const deduped = new Map();
  for (const tier of tiers) deduped.set(`${tier.minQuantity}:${tier.maxQuantity || ""}:${tier.unitPriceCny}`, tier);
  return [...deduped.values()].sort((a, b) => a.minQuantity - b.minQuantity);
}

function buildStructuredSkuModel(jsonObjects, skuVariants) {
  const axes = pickSourceSkuAxes(jsonObjects);
  const axisByName = new Map(axes.map((axis) => [normalizedSkuKey(axis.name), axis]));

  for (const variant of skuVariants) {
    const pairs = parseVariantSpecPairs(variant.spec);
    variant.specPairs = pairs.map(({ name, value }) => {
      const axisKey = normalizedSkuKey(name);
      let axis = axisByName.get(axisKey);
      if (!axis) {
        axis = {
          name,
          sourcePropId: derivedSourceId("prop", name),
          sourceIdKind: "derived",
          values: [],
        };
        axes.push(axis);
        axisByName.set(axisKey, axis);
      }
      const valueKey = normalizedSkuKey(value);
      let axisValue = axis.values.find((item) => normalizedSkuKey(item.name) === valueKey);
      if (!axisValue) {
        axisValue = {
          name: value,
          sourceValueId: derivedSourceId("value", `${axis.name}:${value}`),
          sourceIdKind: "derived",
        };
        axis.values.push(axisValue);
      }
      const sourceIdKind = axis.sourceIdKind === "platform" && axisValue.sourceIdKind === "platform"
        ? "platform"
        : "derived";
      return {
        name,
        value,
        sourcePropId: axis.sourcePropId,
        sourceValueId: axisValue.sourceValueId,
        sourceIdKind,
      };
    });
  }
  return axes;
}

function pickSourceSkuAxes(jsonObjects) {
  const axes = [];
  for (const object of walkObjects(jsonObjects)) {
    const name = cleanupText(object?.propName || object?.specName || object?.skuPropName || object?.attributeName || "");
    const values = object?.valueList || object?.specItems || object?.skuPropertyValues;
    if (!name || !Array.isArray(values) || !values.length) continue;
    const rawPropId = scalarText(object.propId || object.specId || object.skuPropId || object.attributeId);
    const sourcePropId = rawPropId || derivedSourceId("prop", name);
    const sourceIdKind = rawPropId ? "platform" : "derived";
    const normalizedValues = values.map((item) => {
      const valueName = cleanupText(item?.name || item?.value || item?.specValue || item?.valueName || item?.propertyValueName || "");
      const rawValueId = scalarText(item?.valueId || item?.specId || item?.skuValueId || item?.propertyValueId);
      return valueName ? {
        name: valueName,
        sourceValueId: rawValueId || derivedSourceId("value", `${name}:${valueName}`),
        sourceIdKind: rawValueId ? "platform" : "derived",
      } : null;
    }).filter(Boolean);
    if (normalizedValues.length) axes.push({ name, sourcePropId, sourceIdKind, values: normalizedValues });
  }
  const deduped = new Map();
  for (const axis of axes) if (!deduped.has(normalizedSkuKey(axis.name))) deduped.set(normalizedSkuKey(axis.name), axis);
  return [...deduped.values()];
}

function parseVariantSpecPairs(spec = "") {
  return cleanupText(spec).split(/[;；|]/).map((part) => {
    const separator = part.search(/[:：]/);
    if (separator < 0) return null;
    const name = cleanupText(part.slice(0, separator));
    const value = cleanupText(part.slice(separator + 1));
    return name && value ? { name, value } : null;
  }).filter(Boolean);
}

function derivedSourceId(kind, value) {
  const digest = createHash("sha256").update(`${kind}:${normalizedSkuKey(value)}`, "utf8").digest("hex").slice(0, 12);
  return `derived:${kind}:${digest}`;
}

function normalizedSkuKey(value) {
  return cleanupText(value).toLocaleLowerCase("zh-CN");
}

function buildSourceEvidence({ url, html, hints, title, images, skuVariants, sizeWeight, attributes, procurement, media = {} }) {
  const offerId = String(url || "").match(/detail\.1688\.com\/offer\/(\d+)\.html/i)?.[1] || "";
  const verificationReason = classifyVerificationChallenge(html, url);
  const verificationState = verificationReason ? "waiting_human" : "ok";
  const packageValues = {
    weightG: sizeWeight?.weightG || "",
    lengthMm: sizeWeight?.lengthMm || "",
    widthMm: sizeWeight?.widthMm || "",
    heightMm: sizeWeight?.heightMm || "",
  };
  const packagePresent = Object.values(packageValues).some((value) => Number(value || 0) > 0);
  const supplier = procurement?.supplier || {};
  const procurementEvidence = procurement?.procurementEvidence || {};
  const procurementPresent = Boolean(
    procurementEvidence.moq?.value
      && Array.isArray(procurementEvidence.priceTiers?.values)
      && procurementEvidence.priceTiers.values.length,
  );
  const pageRef = `snapshot:${createHash("sha256").update(String(html || ""), "utf8").digest("hex")}`;
  const field = (present, hinted, extra = {}) => ({
    source: present && verificationState === "ok" ? (hinted ? "capture_hint" : "page_content") : "missing",
    evidenceRef: present && verificationState === "ok" ? pageRef : "",
    ...extra,
  });

  const evidence = {
    platform: "1688",
    offerId,
    canonicalUrl: offerId ? `https://detail.1688.com/offer/${offerId}.html` : String(url || "").split(/[?#]/)[0],
    capturedAt: normalizedCapturedAt(hints?.capturedAt),
    captureMode: cleanupText(hints?.captureMode || hints?.sourceType || "direct_html"),
    snapshotHash: pageRef.replace(/^snapshot:/, "sha256:"),
    verificationState,
    verificationReason,
    // Keep only replay provenance metadata.  The manifest/page contents are
    // parsed in memory and are never persisted in the collection box.
    fixtureProvenance: normalizeFixtureProvenance(hints?.fixtureProvenance),
    fields: {
      title: field(Boolean(title), Boolean(hints?.title), { value: title || "" }),
      images: field(Boolean(images?.length), Boolean(hints?.images?.length), { count: images?.length || 0, values: images || [] }),
      variants: field(Boolean(skuVariants?.length), Boolean(hints?.skuVariants?.length), {
        count: skuVariants?.length || 0,
        skuIds: (skuVariants || []).map((item) => item.skuId || ""),
      }),
      package: field(packagePresent, Boolean(hints?.packageInfo), { values: packageValues }),
      attributes: field(Boolean(attributes?.length), Boolean(hints?.attributes?.length), { count: attributes?.length || 0 }),
      supplier: field(Boolean(supplier.id || supplier.name), Boolean(hints?.supplier || hints?.supplierId || hints?.supplierName), {
        id: supplier.id || "",
        name: supplier.name || "",
      }),
      procurement: field(procurementPresent, Boolean(hints?.moq != null || hints?.priceTiers), {
        moq: procurementEvidence.moq?.value || null,
        priceTierCount: procurementEvidence.priceTiers?.values?.length || 0,
      }),
      media: field(Boolean(media?.mediaAssets?.length), false, {
        assetCount: Array.isArray(media?.mediaAssets) ? media.mediaAssets.length : 0,
        mainCount: Array.isArray(media?.mediaAssets) ? media.mediaAssets.filter((asset) => asset?.role === "main").length : 0,
        variantCount: Array.isArray(media?.mediaAssets) ? media.mediaAssets.filter((asset) => asset?.role === "variant").length : 0,
        detailCount: Array.isArray(media?.mediaAssets) ? media.mediaAssets.filter((asset) => asset?.role === "detail").length : 0,
        issueCount: Array.isArray(media?.mediaIssues) ? media.mediaIssues.length : 0,
      }),
    },
  };
  return { ...evidence, sellerFacing: build1688SourceEvidenceContract(evidence) };
}

function normalizeFixtureProvenance(value) {
  if (!value || typeof value !== "object") return null;
  const fixtureKind = cleanupText(value.fixtureKind);
  const verificationLevel = cleanupText(value.verificationLevel);
  const manifestHash = /^sha256:[a-f0-9]{64}$/i.test(String(value.manifestHash || ""))
    ? String(value.manifestHash)
    : "";
  if (!fixtureKind && !manifestHash && !verificationLevel) return null;
  return {
    fixtureKind,
    synthetic: typeof value.synthetic === "boolean" ? value.synthetic : null,
    redacted: typeof value.redacted === "boolean" ? value.redacted : null,
    verificationLevel,
    manifestHash,
    captureMode: cleanupText(value.captureMode),
    capturedAt: cleanupText(value.capturedAt),
    validationTargets: Array.isArray(value.validationTargets)
      ? value.validationTargets.map((item) => cleanupText(item)).filter(Boolean).slice(0, 20)
      : [],
  };
}

function normalizedCapturedAt(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function hasVerificationChallenge(html = "", url = "") {
  return Boolean(classifyVerificationChallenge(html, url));
}

function classifyVerificationChallenge(html = "", url = "") {
  const text = `${html} ${url}`;
  if (/login\.1688|passport\.alibaba|登录|请先登录|登录后查看/i.test(text)) return "login_required";
  if (/验证码|人机验证|滑块|captcha|please slide/i.test(text)) return "captcha";
  if (/访问频繁|too\s*many\s*requests|频繁访问|rate.?limit/i.test(text)) return "access_rate_limited";
  if (/安全验证|安全风险|security verification/i.test(text)) return "security_verification";
  return "";
}

function pickTitle(html, jsonObjects, hints) {
  const candidates = [
    hints.title,
    meta(html, "og:title"),
    meta(html, "title"),
    match(html, /<div[^>]+class=["'][^"']*(?:title|subject)[^"']*["'][^>]*>([\s\S]{2,500}?)<\/div>/i),
    match(html, /<span[^>]+class=["'][^"']*(?:title|subject)[^"']*["'][^>]*>([\s\S]{2,500}?)<\/span>/i),
    match(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    match(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    ...findValuesByKey(jsonObjects, ["subject", "productTitle", "offerTitle", "title", "name"]),
  ];
  return cleanupText(candidates
    .map((item) => cleanupTitle(item))
    .find((item) => item && isLikelyProductTitle(item)) || "");
}

function pickDescription(html, jsonObjects) {
  const candidates = [
    meta(html, "description"),
    ...findValuesByKey(jsonObjects, ["description", "desc", "detail", "productDescription"]),
  ];
  const text = cleanupText(candidates.find((item) => item && cleanupText(item).length > 8) || "");
  return /^https?:\/\//i.test(text) ? "" : text;
}

function pickImages(html, jsonObjects, hints) {
  const images = new Set();
  for (const raw of hints.images || []) addImage(images, raw);
  for (const raw of html.match(IMAGE_RE) || []) addImage(images, raw);
  for (const value of findValuesByKey(jsonObjects, ["image", "imageUrl", "imgUrl", "originalImageURI", "summImagePath", "url"])) {
    if (typeof value === "string") addImage(images, value);
  }
  return [...images]
    .filter(isLikelyProductImage)
    .sort((a, b) => imageScore(b) - imageScore(a))
    .slice(0, 60);
}

function pickAttributes(html, jsonObjects) {
  const attrs = [];
  for (const object of walkObjects(jsonObjects)) {
    const name = object.name || object.attrName || object.attributeName || object.key || object.title;
    const value = object.value || object.attrValue || object.attributeValue || object.text;
    if (isUsefulText(name) && isUsefulText(value)) {
      attrs.push({ name: cleanupText(name), value: cleanupText(value) });
    }
  }

  const rowRegexes = [
    /<tr[^>]*class=["'][^"']*ant-descriptions-row[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi,
    /<[^>]*(?:class|data-[^=]+)=["'][^"']*(?:attr|attribute|参数|属性)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
    /<tr[^>]*>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<\/tr>/gi,
  ];
  for (const regex of rowRegexes) {
    let row;
    while ((row = regex.exec(html))) {
      if (regex.source.includes("ant-descriptions-row")) {
        attrs.push(...parseDescriptionRow(row[1]));
      } else if (row.length >= 3) {
        const name = cleanupText(row[1]);
        const value = cleanupText(row[2]);
        if (isUsefulText(name) && isUsefulText(value)) attrs.push({ name, value });
      }
    }
  }

  return dedupePairs(attrs)
    .filter((item) => isUsefulAttribute(item.name, item.value))
    .slice(0, 120);
}

function pickSkuProps(jsonObjects) {
  const props = [];
  for (const object of walkObjects(jsonObjects)) {
    const name = object.prop || object.propName || object.specName || object.name || object.skuPropName || object.attributeName;
    const values = object.value || object.values || object.valueList || object.specItems || object.skuPropertyValues;
    if (!isUsefulText(name) || !Array.isArray(values)) continue;
    const normalizedValues = values
      .map((item) => ({
        name: cleanupText(item.name || item.value || item.specValue || item.valueName || item.propertyValueName || item.text || ""),
        image: normalizeImage(item.image || item.imageUrl || item.imgUrl || item.skuImageUrl || ""),
      }))
      .filter((item) => item.name);
    if (normalizedValues.length) props.push({ name: cleanupText(name), values: normalizedValues });
  }
  return dedupeSkuProps(props).slice(0, 8);
}

function pickSkuVariants(jsonObjects, skuProps, attributes, hints) {
  const variants = [];
  const mappedSkuObjects = new WeakSet();
  const specItemObjects = new WeakSet();
  for (const item of hints.skuVariants || []) {
    variants.push(normalizeVariant(item));
  }
  for (const object of walkObjects(jsonObjects)) {
    if (Array.isArray(object.specItems)) {
      for (const item of object.specItems) {
        if (item && typeof item === "object") specItemObjects.add(item);
      }
    }
    for (const [key, value] of Object.entries(object)) {
      if (!/^(?:skuMap|sku_map|skuMapData|skuInfoMap|productSkuMap)$/i.test(key) || !value || typeof value !== "object" || Array.isArray(value)) continue;
      for (const [specKey, skuData] of Object.entries(value)) {
        if (!skuData || typeof skuData !== "object" || Array.isArray(skuData)) continue;
        mappedSkuObjects.add(skuData);
        variants.push(normalizeVariant({
          skuId: skuData.skuId || skuData.skuID || skuData.specId || skuData.sku_id || skuData.id,
          spec: normalizeSkuMapSpec(specKey),
          price: firstNumber(skuData.price, skuData.discountPrice, skuData.salePrice, skuData.priceCent && skuData.priceCent / 100),
          stock: firstNumber(skuData.stock, skuData.canBookCount, skuData.quantity, skuData.amount),
          image: skuData.image || skuData.imageUrl || skuData.imgUrl || skuData.skuImageUrl || "",
        }));
      }
    }
  }
  for (const object of walkObjects(jsonObjects)) {
    if (mappedSkuObjects.has(object) || specItemObjects.has(object)) continue;
    const skuId = scalarText(object.skuId || object.skuID || object.specId || object.sku_id || object.id);
    const price = firstNumber(object.price, object.discountPrice, object.salePrice, object.priceCent && object.priceCent / 100);
    const image = normalizeImage(object.image || object.imageUrl || object.imgUrl || object.skuImageUrl || "");
    const stock = firstNumber(object.stock, object.canBookCount, object.quantity, object.amount);
    const specText = cleanupText(firstScalar(
      object.specAttrs,
      object.specText,
      object.skuName,
      object.name,
      object.cargoNumber,
      object.skuProps
    ));
    const hasVariantSignal = skuId || object.skuId || object.skuID || object.specId || object.sku_id;
    const hasSellableData = price || stock || image || /[:：]/.test(specText);
    if (hasVariantSignal && hasSellableData) {
      variants.push(normalizeVariant({
        skuId: skuId ? String(skuId) : "",
        spec: specText,
        price: price ?? null,
        stock: stock ?? null,
        image,
      }));
    }
  }

  if (!variants.length && skuProps.length) {
    const values = skuProps.flatMap((prop) => prop.values.map((value) => ({ prop: prop.name, ...value })));
    return values.map((value, index) => normalizeVariant({
      skuId: "",
      spec: `${value.prop}: ${value.name}`,
      price: null,
      stock: null,
      image: value.image,
      index,
    }));
  }

  if (!variants.length) {
    const styleAttr = attributes.find((item) => /款式|颜色|规格|型号/i.test(item.name) && splitVariantValues(item.value).length > 1);
    if (styleAttr) {
      const fallbackImages = (hints.images || []).map(normalizeImage).filter(Boolean);
      return splitVariantValues(styleAttr.value)
        .slice(0, 200)
        .map((value, index) => normalizeVariant({
          skuId: "",
          spec: `${styleAttr.name}: ${value}`,
          price: null,
          stock: null,
          image: fallbackImages[index] || "",
          index,
        }));
    }
  }

  return dedupeVariants(variants).slice(0, 300);
}

function normalizeSkuMapSpec(value) {
  return cleanupText(value)
    .split(/[;；|]/)
    .map((part) => cleanupText(part))
    .filter(Boolean)
    .map((part) => {
      const separator = part.search(/[:：]/);
      if (separator < 0) return part;
      const name = cleanupText(part.slice(0, separator));
      const option = cleanupText(part.slice(separator + 1));
      return name && option ? `${name}: ${option}` : part;
    })
    .join("; ");
}

function splitVariantValues(value) {
  return cleanupText(value)
    .split(/[,，;；/|、]/)
    .map((item) => cleanupText(item))
    .filter(Boolean);
}

function pickSizeWeight(html, jsonObjects, attributes, hints = {}) {
  if (hints.packageInfo) {
    const hinted = {
      weightG: firstNumber(hints.packageInfo.weightG) || normalizeWeight(hints.packageInfo.weight),
      lengthMm: firstNumber(hints.packageInfo.lengthMm),
      widthMm: firstNumber(hints.packageInfo.widthMm),
      heightMm: firstNumber(hints.packageInfo.heightMm),
    };
    if (hinted.weightG || hinted.lengthMm || hinted.widthMm || hinted.heightMm) return hinted;
  }

  const text = `${cleanupText(html)} ${attributes.map((item) => `${item.name} ${item.value}`).join(" ")}`;
  const result = {
    weightG: firstNumberFromText(text, [/重量[^\d]{0,8}(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克)/i]),
    lengthMm: firstNumberFromText(text, [/长[^\d]{0,8}(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米)/i]),
    widthMm: firstNumberFromText(text, [/宽[^\d]{0,8}(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米)/i]),
    heightMm: firstNumberFromText(text, [/高[^\d]{0,8}(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米)/i]),
  };

  const sizeText = attributes.find((item) => /尺寸|规格|长宽高|尺码/i.test(item.name))?.value || "";
  const parsedSize = parseDimensions(sizeText);
  result.lengthMm ||= parsedSize.lengthMm;
  result.widthMm ||= parsedSize.widthMm;
  result.heightMm ||= parsedSize.heightMm;

  for (const object of walkObjects(jsonObjects)) {
    result.weightG ||= normalizeWeight(object.weight || object.grossWeight || object.packageWeight);
    result.lengthMm ||= normalizeLength(object.length || object.packageLength);
    result.widthMm ||= normalizeLength(object.width || object.packageWidth);
    result.heightMm ||= normalizeLength(object.height || object.packageHeight);
  }
  return result;
}

function toOzonDraft({ title, images, attributes, skuVariants, sizeWeight }) {
  const firstVariant = skuVariants[0] || {};
  return {
    name: title,
    offer_id: firstVariant.skuId ? `1688-${firstVariant.skuId}` : "",
    price: firstVariant.price || "",
    images: images.slice(0, 30),
    attributes,
    weight: sizeWeight.weightG || "",
    depth: sizeWeight.lengthMm || "",
    width: sizeWeight.widthMm || "",
    height: sizeWeight.heightMm || "",
  };
}

function buildWarnings(result) {
  const warnings = [];
  if (!result.title) warnings.push("未解析到标题，建议粘贴完整商品页源码。");
  if (!result.images.length) warnings.push("未解析到图片，1688 可能要求登录或页面被风控。");
  if (!result.skuVariants.length) warnings.push("未解析到 SKU 变体，可能需要粘贴页面源码或登录后源码。");
  if (!result.attributes.length) warnings.push("未解析到商品属性。");
  if (!result.sizeWeight.weightG) warnings.push("未解析到重量。");
  if (!result.sizeWeight.lengthMm || !result.sizeWeight.widthMm || !result.sizeWeight.heightMm) warnings.push("未解析到完整包装尺寸。");
  const missingSkuSizeWeight = result.skuVariants
    .map((sku, index) => ({ index: index + 1, missing: missingSizeWeightFields(sku) }))
    .filter((item) => item.missing.length);
  if (missingSkuSizeWeight.length) {
    warnings.push(`有 ${missingSkuSizeWeight.length} 个 SKU 缺少独立尺重；可用商品级尺重回填，或在上架前手动补齐。`);
  }
  return warnings;
}

function buildParseIssues(result) {
  const issues = [];
  if (!result.title) issues.push("missing_title");
  if (!result.images.length) issues.push("missing_images");
  if (!result.skuVariants.length) issues.push("missing_sku_variants");
  if (!result.attributes.length) issues.push("missing_attributes");
  if (!result.sizeWeight.weightG) issues.push("missing_package_weight");
  if (!result.sizeWeight.lengthMm || !result.sizeWeight.widthMm || !result.sizeWeight.heightMm) {
    issues.push("missing_package_dimensions");
  }
  if (!result.supplier?.id) issues.push("missing_supplier_id");
  if (!result.supplier?.name) issues.push("missing_supplier_name");
  if (!result.procurementEvidence?.moq?.value) issues.push("missing_procurement_moq");
  if (!result.procurementEvidence?.priceTiers?.values?.length) issues.push("missing_procurement_price_tiers");
  return issues;
}

function missingSizeWeightFields(source = {}) {
  return [
    ["weightG", "重量"],
    ["lengthMm", "长"],
    ["widthMm", "宽"],
    ["heightMm", "高"],
  ].filter(([key]) => !Number(source[key] || 0)).map(([, label]) => label);
}

function parseDescriptionRow(rowHtml) {
  const cells = [];
  const cellRe = /<t[hd][^>]*class=["'][^"']*ant-descriptions-item-(label|content)[^"']*["'][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let cell;
  while ((cell = cellRe.exec(rowHtml))) {
    cells.push({ type: cell[1], text: cleanupText(cell[2]) });
  }

  const attrs = [];
  for (let index = 0; index < cells.length - 1; index += 1) {
    if (cells[index].type === "label" && cells[index + 1].type === "content") {
      attrs.push({ name: cells[index].text, value: cells[index + 1].text });
    }
  }
  return attrs;
}

function extractJsonObjects(html) {
  const objects = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let script;
  while ((script = scriptRe.exec(html))) {
    const text = script[1];
    for (const candidate of jsonCandidates(text)) {
      try {
        objects.push(JSON.parse(candidate));
      } catch {
        // keep scanning
      }
    }
  }
  return objects;
}

function jsonCandidates(text) {
  const candidates = [];
  const assignmentRe = /(?:window\.)?[A-Za-z0-9_$.-]+\s*=\s*({[\s\S]*?});/g;
  let matchResult;
  while ((matchResult = assignmentRe.exec(text))) candidates.push(matchResult[1]);
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) candidates.push(text.slice(braceStart, braceEnd + 1));
  return candidates
    .map((item) => item.replace(/undefined/g, "null"))
    .filter((item) => item.length > 20 && item.length < 3_000_000);
}

function* walkObjects(input, depth = 0) {
  if (depth > 12 || input == null) return;
  if (Array.isArray(input)) {
    for (const item of input) yield* walkObjects(item, depth + 1);
    return;
  }
  if (typeof input === "object") {
    yield input;
    for (const value of Object.values(input)) yield* walkObjects(value, depth + 1);
  }
}

function findValuesByKey(objects, keys) {
  const keySet = new Set(keys);
  const values = [];
  for (const object of walkObjects(objects)) {
    for (const [key, value] of Object.entries(object)) {
      if (keySet.has(key) && (typeof value === "string" || typeof value === "number")) values.push(String(value));
    }
  }
  return values;
}

function meta(html, name) {
  return match(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["']`, "i"));
}

function match(text, regex) {
  const result = regex.exec(text);
  return result ? result[1] : "";
}

function cleanupText(value) {
  return stripTags(String(value || ""))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupTitle(value) {
  return cleanupText(value)
    .replace(/\s*[-–—]\s*(?:阿里巴巴|1688).*$/i, "")
    .replace(/\s*[-_].*1688.*$/i, "")
    .replace(/^\d+\s*/, "");
}

function isLikelyProductTitle(value) {
  const text = cleanupText(value);
  if (text.length < 6 || text.length > 220) return false;
  if (/有限公司|电子商务商行|旗舰店|1688首页|阿里巴巴|登录|采购|收藏|店铺/.test(text) && text.length < 40) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(text);
}

function stripTags(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function addImage(set, value) {
  const image = normalizeImage(value);
  if (image) set.add(image);
}

function normalizeImage(value) {
  if (!value || typeof value !== "string") return "";
  let image = value
    .replaceAll("\\/", "/")
    .trim()
    .replace(/&quot;.*$/i, "")
    .replace(/\).*$/i, "")
    .replace(/^\/\//, "https://");
  image = image.replace(/[?#].*$/i, "");
  image = image.replace(/(?:_|\.)(?:\d+x\d+|sum|search|summ)(?=\.(?:jpg|jpeg|png|webp)$)/i, "");
  if (image.startsWith("http") && /\.(jpg|jpeg|png|webp)/i.test(image)) return image;
  return "";
}

function isLikelyProductImage(image) {
  if (!image) return false;
  if (!/cbu01\.alicdn\.com\/img\/ibank|alicdn\.com\/img\/ibank/i.test(image)) return false;
  if (/tps-|cms\/upload|overseas_pic|icon|logo/i.test(image)) return false;
  return true;
}

function imageScore(image) {
  let score = 0;
  if (/cbu01\.alicdn\.com\/img\/ibank/i.test(image)) score += 20;
  if (/!!\d+/.test(image)) score += 10;
  if (/\.jpg$/i.test(image)) score += 5;
  if (/220x220|310x310|search|summ/i.test(image)) score -= 10;
  return score;
}

function isUsefulText(value) {
  const text = cleanupText(value);
  return text.length > 0 && text.length < 180 && !/^\d+$/.test(text);
}

function isUsefulAttribute(name, value) {
  if (!isUsefulText(name) || !isUsefulText(value)) return false;
  if (/重量\(g\)|价格|库存/.test(value) && value.length < 8) return false;
  return true;
}

function normalizeVariant(item) {
  return {
    skuId: scalarText(item.skuId || item.sku_id || item.id),
    spec: cleanupText(item.spec || item.specText || item.name || ""),
    price: firstNumber(item.price),
    stock: firstNumber(item.stock),
    image: normalizeImage(item.image || item.imageUrl || ""),
    weightG: firstNumber(item.weightG) || "",
    lengthMm: firstNumber(item.lengthMm) || "",
    widthMm: firstNumber(item.widthMm) || "",
    heightMm: firstNumber(item.heightMm) || "",
  };
}

function normalizeAttributes(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      name: cleanupText(item.name || item.key || ""),
      value: cleanupText(item.value || item.val || ""),
    }))
    .filter((item) => isUsefulAttribute(item.name, item.value));
}

function parseDimensions(value) {
  const text = cleanupText(value);
  const result = { lengthMm: "", widthMm: "", heightMm: "" };
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:cm|厘米|mm|毫米)?\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(?:cm|厘米|mm|毫米)?\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米)?/);
  if (!match) return result;
  const unit = match[4] || (/(mm|毫米)/i.test(text) ? "mm" : "cm");
  const factor = /mm|毫米/i.test(unit) ? 1 : 10;
  result.lengthMm = Math.round(Number(match[1]) * factor);
  result.widthMm = Math.round(Number(match[2]) * factor);
  result.heightMm = Math.round(Number(match[3]) * factor);
  return result;
}

function normalizeVideo(value) {
  if (!value) return null;
  if (typeof value === "string") return value ? { url: value } : null;
  const url = value.url || value.videoUrl || "";
  return url ? {
    url,
    coverUrl: value.coverUrl || "",
    title: value.title || "",
    videoId: value.videoId || "",
  } : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = typeof value === "string" ? Number(value.match(/\d+(?:\.\d+)?/)?.[0]) : Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function firstNumberFromText(text, regexes) {
  for (const regex of regexes) {
    const result = regex.exec(text);
    if (!result) continue;
    const value = Number(result[1]);
    const unit = result[2] || "";
    if (/kg|公斤|千克/i.test(unit)) return Math.round(value * 1000);
    if (/cm|厘米/i.test(unit)) return Math.round(value * 10);
    return Math.round(value);
  }
  return "";
}

function normalizeWeight(value) {
  const text = String(value || "");
  const number = firstNumber(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (/g|克/i.test(text) && !/kg|公斤|千克/i.test(text)) return Math.round(number);
  return number < 50 ? Math.round(number * 1000) : Math.round(number);
}

function normalizeLength(value) {
  const text = String(value || "");
  const number = firstNumber(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (/mm|毫米/i.test(text)) return Math.round(number);
  if (/cm|厘米/i.test(text)) return Math.round(number * 10);
  return number < 50 ? Math.round(number * 10) : Math.round(number);
}

function firstScalar(...values) {
  return values.find((value) => typeof value === "string" || typeof value === "number") || "";
}

function scalarText(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function dedupePairs(items) {
  const map = new Map();
  for (const item of items) map.set(`${item.name}:${item.value}`, item);
  return [...map.values()];
}

function dedupeSkuProps(items) {
  const map = new Map();
  for (const item of items) map.set(`${item.name}:${item.values.map((value) => value.name).join("|")}`, item);
  return [...map.values()];
}

function dedupeVariants(items) {
  const map = new Map();
  for (const item of items) map.set(`${item.skuId}:${item.spec}:${item.price}:${item.image}`, item);
  return [...map.values()];
}

function pickDetailHtml(html, jsonObjects = []) {
  const jsonDetail = findValuesByKey(jsonObjects, ["content", "detailHtml", "detailContent", "descHtml", "descriptionHtml"])
    .find((value) => /<img\b|ant-descriptions|detail|desc/i.test(value));
  if (jsonDetail) return jsonDetail;
  const candidate = match(html, /<div[^>]+(?:id|class)=["'][^"']*(?:desc|detail|description)[^"']*["'][^>]*>([\s\S]{100,20000}?)<\/div>/i);
  return candidate || "";
}

function pickDetailImages(detailHtml, jsonObjects, hints) {
  const images = new Set();
  for (const raw of hints.detailImages || []) addImage(images, raw);
  for (const raw of String(detailHtml || "").match(IMAGE_RE) || []) addImage(images, raw);
  for (const value of findValuesByKey(jsonObjects, ["detailImage", "detailImages", "detailImg", "descImage", "descImages"])) {
    if (typeof value === "string") addImage(images, value);
  }
  return [...images].filter(isLikelyProductImage).slice(0, 60);
}

function buildRichContent(detailImages) {
  const images = Array.isArray(detailImages) ? detailImages.filter(Boolean) : [];
  if (!images.length) return null;
  return {
    content: images.map((image) => ({
      widgetName: "raShowcase",
      type: "billboard",
      blocks: [{ img: { src: image, srcMobile: image, alt: "" } }],
    })),
    version: 0.3,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
