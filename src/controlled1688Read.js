import { createHash, randomUUID } from "node:crypto";

const HASH = /^sha256:[a-f0-9]{64}$/i;
const text = (value) => String(value ?? "").trim();

function hash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function normalizedOffers(value = []) {
  return [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))].slice(0, 1000).sort();
}

export function build1688ReadPlanBinding(plan = {}) {
  const { planBinding: _ignored, ...withoutBinding } = plan && typeof plan === "object" ? plan : {};
  return hash(withoutBinding);
}

/**
 * Build a bounded plan for a browser-assisted 1688 read.  This is a local
 * identity only: it does not contain cookies and it never authorizes Ozon
 * writes.  A plan is required before a task can be called controlled.
 */
export function build1688ReadPlan(input = {}) {
  const taskId = text(input.taskId);
  const storeId = text(input.storeId);
  const environment = text(input.environment || "1688-browser");
  const scope = input.scope && typeof input.scope === "object" ? input.scope : {};
  const urls = [...new Set((Array.isArray(scope.urls) ? scope.urls : [scope.url])
    .map(text).filter((url) => /^https?:\/\/(?:detail\.)?1688\.com\//i.test(url)))].slice(0, 1000).sort();
  const offerIds = normalizedOffers(scope.offerIds || scope.offers);
  const plan = {
    schemaVersion: 1,
    source: "1688",
    taskId,
    storeId,
    environment,
    scope: {
      name: text(scope.name || (urls.length ? "offer_urls" : "crawler_task")),
      urls,
      offerIds,
      maxProducts: Math.max(0, Math.min(1000, Number(scope.maxProducts || 0))),
    },
    readOnly: true,
    writeAttempted: false,
  };
  return { ...plan, planBinding: validate1688ReadPlan(plan).ok ? build1688ReadPlanBinding(plan) : "" };
}

export function validate1688ReadPlan(plan = {}) {
  const errors = [];
  if (text(plan.source) !== "1688") errors.push("1688_READ_SOURCE_INVALID");
  if (!text(plan.taskId)) errors.push("1688_READ_TASK_REQUIRED");
  if (!text(plan.storeId)) errors.push("1688_READ_STORE_REQUIRED");
  if (!text(plan.environment)) errors.push("1688_READ_ENVIRONMENT_REQUIRED");
  if (plan.readOnly !== true || plan.writeAttempted === true) errors.push("1688_READ_ONLY_REQUIRED");
  const scope = plan.scope && typeof plan.scope === "object" ? plan.scope : {};
  const urls = Array.isArray(scope.urls) ? scope.urls.map(text).filter(Boolean) : [];
  const offerIds = normalizedOffers(scope.offerIds);
  if (!text(scope.name)) errors.push("1688_READ_SCOPE_REQUIRED");
  if (!urls.length && !offerIds.length && Number(scope.maxProducts || 0) <= 0) errors.push("1688_READ_SCOPE_EMPTY");
  if (urls.some((url) => !/^https?:\/\/(?:detail\.)?1688\.com\//i.test(url))) errors.push("1688_READ_URL_NOT_ALLOWLISTED");
  if (plan.planBinding && (!HASH.test(text(plan.planBinding)) || text(plan.planBinding) !== build1688ReadPlanBinding(plan))) errors.push("1688_READ_PLAN_BINDING_INVALID");
  return { ok: errors.length === 0, errors, scope: { name: text(scope.name), urls, offerIds, maxProducts: Number(scope.maxProducts || 0) } };
}

export function build1688ReadReceipt(plan = {}, result = {}, { persisted = false, persistedAt = "" } = {}) {
  const check = validate1688ReadPlan(plan);
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const status = text(result.status || (result.waitingHuman ? "waiting_human" : result.readSucceeded === true ? "success" : "partial"));
  const challenge = text(result.humanReason || result.challengeReason);
  const receipt = {
    schemaVersion: 1,
    id: `1688-read:${randomUUID()}`,
    source: "1688",
    origin: persisted ? "server_observed" : "client_asserted",
    persisted: persisted === true,
    // Receiving and persisting a browser payload is not proof that the page
    // was real.  Only a separately audited capture may ever upgrade this.
    verificationLevel: persisted ? "server_observed" : "client_asserted",
    verificationEligible: false,
    realReadVerified: false,
    persistedAt: persisted ? (text(persistedAt) || new Date().toISOString()) : "",
    taskId: text(plan.taskId),
    storeRefHash: text(plan.storeId) ? hash(plan.storeId) : "",
    environmentRefHash: text(plan.environment) ? hash(plan.environment) : "",
    scopeRefHash: check.ok ? hash(check.scope) : "",
    planBinding: text(plan.planBinding),
    checkedAt: text(result.checkedAt) || new Date().toISOString(),
    status: challenge ? "waiting_human" : status,
    readOnly: true,
    writeAttempted: false,
    captureMode: text(result.captureMode || "extension_browser"),
    observations: observations.slice(0, 100).map((item) => ({
      offerId: text(item?.offerId),
      url: text(item?.url).split(/[?#]/)[0],
      status: text(item?.status || "observed").slice(0, 40),
      snapshotHash: HASH.test(text(item?.snapshotHash)) ? text(item.snapshotHash) : "",
    })),
    human: challenge ? { required: true, reason: challenge, resumeRequired: true } : { required: false },
  };
  receipt.responseHash = hash({ status: receipt.status, observations: receipt.observations, human: receipt.human });
  return receipt;
}

export function validate1688ReadReceipt(receipt = {}) {
  const errors = [];
  if (receipt.schemaVersion !== 1 || receipt.source !== "1688") errors.push("1688_READ_RECEIPT_SCHEMA_INVALID");
  if (!["client_asserted", "server_observed"].includes(text(receipt.origin))) errors.push("1688_READ_RECEIPT_ORIGIN_INVALID");
  if (receipt.origin === "server_observed" && receipt.persisted !== true) errors.push("1688_READ_RECEIPT_PERSISTENCE_INVALID");
  if (receipt.realReadVerified === true || receipt.verificationLevel === "real_read_verified") errors.push("1688_READ_RECEIPT_REAL_VERIFICATION_UNSUPPORTED");
  if (!text(receipt.taskId) || !HASH.test(text(receipt.storeRefHash)) || !HASH.test(text(receipt.environmentRefHash)) || !HASH.test(text(receipt.scopeRefHash))) errors.push("1688_READ_RECEIPT_SCOPE_INVALID");
  if (receipt.readOnly !== true || receipt.writeAttempted === true) errors.push("1688_READ_RECEIPT_WRITE_POSTURE_INVALID");
  if (!text(receipt.checkedAt) || !Number.isFinite(Date.parse(receipt.checkedAt))) errors.push("1688_READ_RECEIPT_TIME_INVALID");
  if (!HASH.test(text(receipt.responseHash))) errors.push("1688_READ_RECEIPT_RESPONSE_HASH_INVALID");
  if (receipt.status === "waiting_human" && receipt.human?.required !== true) errors.push("1688_READ_RECEIPT_HUMAN_STATE_INVALID");
  return { ok: errors.length === 0, errors };
}

export function build1688ReadSellerTask(receipt = {}) {
  if (receipt.status === "waiting_human" || receipt.human?.required === true) {
    return { status: "waiting", code: "1688_HUMAN_VERIFICATION_REQUIRED", title: "1688 需要人工验证", nextAction: "在浏览器完成登录/验证码后，确认页面恢复，再点击恢复采集。", sideEffect: "采集已暂停；不会刷新绕过验证，不会提交 Ozon。" };
  }
  if (receipt.status === "partial") {
    return { status: "needs_review", code: "1688_READ_PARTIAL", title: "1688 来源读取不完整", nextAction: "按同一受控任务范围补齐详情页，再进入来源证据审核。", sideEffect: "不会把部分来源证据用于提交、改价或库存写入。" };
  }
  return { status: "ready", code: "1688_READ_SERVER_OBSERVED_ONLY", title: "1688 页面已由服务端接收", nextAction: "人工核对来源快照；当前仍不是 real_read_verified，不能据此宣称真实账号验证。", sideEffect: "不会自动提交 Ozon、修改价格或写入库存。" };
}
