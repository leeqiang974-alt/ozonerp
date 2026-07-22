import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.OZON_ERP_DATA_DIR || "data");
const BOX_FILE = path.join(DATA_DIR, "1688-collection-box.json");
const BOX_BACKUP_FILE = `${BOX_FILE}.bak`;
const BOX_LOCK_FILE = `${BOX_FILE}.lock`;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireBoxLock() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const startedAt = Date.now();
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  while (true) {
    try {
      const handle = await fs.open(BOX_LOCK_FILE, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() }));
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await fs.readFile(BOX_LOCK_FILE, "utf8"));
          if (current.token === token) await fs.rm(BOX_LOCK_FILE, { force: true });
        } catch (error) {
          if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
        }
      };
    } catch (error) {
      if (!(["EEXIST", "EPERM"].includes(error.code))) throw error;
      try {
        const stat = await fs.stat(BOX_LOCK_FILE);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) await fs.rm(BOX_LOCK_FILE, { force: true });
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        const timeout = new Error("collection box lock timeout");
        timeout.code = "COLLECTION_BOX_LOCK_TIMEOUT";
        throw timeout;
      }
      await sleep(20);
    }
  }
}

function parseBox(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.items)) {
    const error = new Error("collection box data must contain an items array");
    error.code = "COLLECTION_BOX_CORRUPT";
    throw error;
  }
  return data.items;
}

async function atomicReplaceBox(items) {
  const temporary = `${BOX_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ items }, null, 2), "utf8");
  try {
    // Never overwrite a known-good backup with a malformed/truncated primary.
    // This matters when this function is called by the corruption recovery path.
    const current = await fs.readFile(BOX_FILE, "utf8");
    parseBox(current);
    await fs.copyFile(BOX_FILE, BOX_BACKUP_FILE);
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError" && error.code !== "COLLECTION_BOX_CORRUPT") throw error;
  }
  try {
    await fs.rename(temporary, BOX_FILE);
  } catch (error) {
    // Windows does not replace an existing destination with rename().
    if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    await fs.rm(BOX_FILE, { force: true });
    await fs.rename(temporary, BOX_FILE);
  }
}

async function readBox() {
  try {
    const text = await fs.readFile(BOX_FILE, "utf8");
    return parseBox(text);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    if (error.name === "SyntaxError" || error.code === "COLLECTION_BOX_CORRUPT") {
      try {
        const backup = await fs.readFile(BOX_BACKUP_FILE, "utf8");
        const items = parseBox(backup);
        await atomicReplaceBox(items);
        return items;
      } catch (backupError) {
        if (backupError.code === "ENOENT") {
          const corrupt = new Error("collection box data is corrupt and no backup is available");
          corrupt.code = "COLLECTION_BOX_CORRUPT";
          throw corrupt;
        }
        throw backupError;
      }
    }
    throw error;
  }
}

async function readBoxLocked() {
  const release = await acquireBoxLock();
  try {
    return await readBox();
  } finally {
    await release();
  }
}

async function writeBox(items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await atomicReplaceBox(items);
}

async function mutateBox(mutator) {
  const release = await acquireBoxLock();
  try {
    const items = await readBox();
    const result = await mutator(items);
    if (result?.write !== false) await writeBox(result?.items || items);
    return result?.value;
  } finally {
    await release();
  }
}

function offerKeyFromUrl(url = "") {
  const value = String(url || "");
  const patterns = [
    { prefix: "pdd-goods", pattern: /[?&]goods_id=(\d+)/i },
    { prefix: "pdd-goods", pattern: /[?&]goodsId=(\d+)/i },
    { prefix: "pdd-goods", pattern: /\/goods(?:\.html)?\/?(\d{5,})/i },
    { prefix: "pdd-goods", pattern: /\/goods_detail\/(\d{5,})/i },
    /\/offer\/(\d+)\.html/i,
    /[?&]offerId=(\d+)/i,
    /[?&]offer_id=(\d+)/i,
  ];
  for (const pattern of patterns) {
    if (pattern instanceof RegExp) {
      const match = value.match(pattern);
      if (match) return match[1];
      continue;
    }
    const match = value.match(pattern.pattern);
    if (match) return `${pattern.prefix}:${match[1]}`;
  }
  return value.trim().toLowerCase().replace(/[?#].*$/, "");
}

function collectionKey(item = {}) {
  return offerKeyFromUrl(item.parsed?.url || item.url || "");
}

/**
 * Persist a small, redacted source-evidence receipt alongside the parsed
 * capture.  The parsed payload is useful for the seller workflow, but it is
 * not a durable contract: older extension payloads may omit source evidence
 * and must not accidentally make a candidate look verified.  Keep only
 * replay metadata here; raw HTML, cookies, headers and page text never enter
 * the collection box.
 */
export function buildPersistedSourceEvidenceRecord(sourceEvidence = {}, capture = {}) {
  const evidence = sourceEvidence && typeof sourceEvidence === "object" ? sourceEvidence : {};
  const captureEnvelope = capture && typeof capture === "object" ? capture : {};
  const snapshotHash = String(evidence.snapshotHash || "").trim();
  const validHash = /^sha256:[a-f0-9]{64}$/i.test(snapshotHash);
  const canonicalUrl = String(evidence.canonicalUrl || "").trim().split(/[?#]/)[0];
  const fields = evidence.fields && typeof evidence.fields === "object" ? evidence.fields : {};
  const verificationState = String(evidence.verificationState || "unknown").trim() || "unknown";
  const presentFields = Object.entries(fields)
    .filter(([, field]) => field && field.source && field.source !== "missing")
    .map(([name]) => name)
    .sort();
  // Keep a seller-usable domain summary next to the redacted snapshot.  A
  // page hash alone does not prove that the SKU, procurement facts, or media
  // needed by the next Ozon step were actually captured.  Counts and status
  // are safe to persist; raw page data and asset URLs remain in the parsed
  // workflow payload only.
  const domainField = (name) => fields[name] && typeof fields[name] === "object" ? fields[name] : {};
  const domainStatus = (field) => {
    if (verificationState === "waiting_human") return "waiting_human";
    return field.source && field.source !== "missing" && validHash ? "captured" : "needs_review";
  };
  const domainCoverage = {
    sku: {
      status: domainStatus(domainField("variants")),
      count: Number(domainField("variants").count || 0),
    },
    procurement: {
      status: domainStatus(domainField("procurement")),
      supplierPresent: Boolean(domainField("supplier").id || domainField("supplier").name),
      moqPresent: Boolean(domainField("procurement").moq),
      priceTierCount: Number(domainField("procurement").priceTierCount || 0),
    },
    media: {
      status: domainStatus(domainField("media")),
      assetCount: Number(domainField("media").assetCount || 0),
      issueCount: Number(domainField("media").issueCount || 0),
    },
  };
  const missingDomains = Object.entries(domainCoverage)
    .filter(([, domain]) => domain.status !== "captured")
    .map(([name]) => name);
  const suppliedSellerFacing = evidence.sellerFacing && typeof evidence.sellerFacing === "object"
    ? evidence.sellerFacing : {};
  const reason = String(evidence.verificationReason || "").trim();
  const status = ["ready", "needs_review", "waiting_human", "unknown"].includes(String(suppliedSellerFacing.status || ""))
    ? String(suppliedSellerFacing.status)
    : verificationState === "waiting_human"
      ? "waiting_human"
      : verificationState === "ok" && validHash
        ? (presentFields.length >= 4 ? "ready" : "needs_review")
        : "unknown";
  const reasonLabels = {
    login_required: "1688 登录状态失效",
    captcha: "检测到验证码或滑块",
    access_rate_limited: "1688 访问频繁",
    security_verification: "检测到 1688 安全验证",
  };
  const blocker = String(suppliedSellerFacing.blocker || "").trim()
    || (status === "ready" ? "" : status === "waiting_human"
      ? `${reasonLabels[reason] || "来源页面需要人工处理"}；自动化已暂停`
      : "缺少可安全使用的完整来源证据");
  const nextAction = String(suppliedSellerFacing.nextAction || "").trim()
    || (status === "ready" ? "来源证据已记录，可进入类目、属性、内容和定价预检"
      : status === "waiting_human" ? "完成来源页面的人机验证后，再点击恢复采集"
        : "重新打开来源商品详情页并采集有效页面快照");
  const captureIdentity = {
    taskId: String(captureEnvelope.taskId || "").trim().slice(0, 160),
    offerId: String(captureEnvelope.offerId || evidence.offerId || "").trim().slice(0, 160),
    canonicalUrl,
    captureMode: String(captureEnvelope.captureMode || evidence.captureMode || "").trim().slice(0, 80),
    collectedAt: String(captureEnvelope.collectedAt || evidence.capturedAt || "").trim().slice(0, 64),
  };
  return {
    platform: String(evidence.platform || "unknown"),
    offerId: String(evidence.offerId || ""),
    canonicalUrl,
    captureIdentity,
    capturedAt: String(evidence.capturedAt || ""),
    captureMode: String(evidence.captureMode || ""),
    verificationState,
    verificationReason: reason,
    snapshot: {
      hash: validHash ? snapshotHash : "",
      algorithm: "sha256",
      persisted: validHash,
      rawContentStored: false,
      redaction: "raw_html_cookie_headers_omitted",
    },
    presentFields,
    domainCoverage,
    missingDomains,
    sellerFacing: {
      status,
      label: status === "ready" ? "来源证据已验证" : status === "waiting_human" ? "需要人工处理" : status === "needs_review" ? "来源证据待补齐" : "来源证据不可用",
      blocker,
      nextAction,
      sideEffects: Array.isArray(suppliedSellerFacing.sideEffects) && suppliedSellerFacing.sideEffects.length
        ? suppliedSellerFacing.sideEffects.map(String).slice(0, 4)
        : ["不会提交 Ozon", "不会修改价格", "不会写入库存"],
    },
    persistedAt: new Date().toISOString(),
  };
}

function withPersistedSourceEvidence(parsed = {}) {
  const value = parsed && typeof parsed === "object" ? parsed : {};
  return {
    ...value,
    sourceEvidenceRecord: buildPersistedSourceEvidenceRecord(value.sourceEvidence, value.capture),
  };
}

function itemVisibleToScope(item = {}, { storeId = "", storeIds = [] } = {}) {
  const requested = String(storeId || "").trim();
  const principalStores = Array.isArray(storeIds) ? storeIds.map((value) => String(value || "").trim()).filter(Boolean) : [];
  if (requested) return String(item.storeId || "") === requested;
  if (principalStores.length) return principalStores.includes(String(item.storeId || ""));
  return true;
}

export async function listCollectionItems(scope = {}) {
  const items = await readBoxLocked();
  return items
    .filter((item) => itemVisibleToScope(item, scope))
    .sort((a, b) => String(b.updatedAt || b.receivedAt).localeCompare(String(a.updatedAt || a.receivedAt)));
}

export async function addCollectionItem({ parsed, storeId = "", includeVideo = true }) {
  const now = new Date().toISOString();
  return mutateBox((items) => {
    const key = offerKeyFromUrl(parsed?.url || "");
    const duplicateIndex = key ? items.findIndex((item) => collectionKey(item) === key) : -1;
    const duplicate = duplicateIndex >= 0 ? items[duplicateIndex] : null;
    if (duplicate) {
      const sourceLabel = parsed?.source === "pdd" ? "拼多多" : "1688";
      if (shouldRefreshDuplicate(duplicate.parsed, parsed)) {
        const refreshed = { ...duplicate, storeId: storeId || duplicate.storeId || "", includeVideo: Boolean(includeVideo), status: duplicate.status === "candidate_ready" ? duplicate.status : "collected", parsed: withPersistedSourceEvidence(parsed), updatedAt: now };
        items[duplicateIndex] = refreshed;
        return { items, value: { ...refreshed, duplicate: true, duplicateRefreshed: true, duplicateMessage: `这个 ${sourceLabel} 商品已经采集过，已用更完整的新数据刷新原记录。` } };
      }
      return { write: false, value: { ...duplicate, duplicate: true, duplicateMessage: `这个 ${sourceLabel} 商品已经采集过，已返回原记录。` } };
    }
    const item = { id: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`, storeId, includeVideo: Boolean(includeVideo), status: "collected", receivedAt: now, updatedAt: now, parsed: withPersistedSourceEvidence(parsed) };
    items.push(item);
    return { items, value: item };
  });
}

function shouldRefreshDuplicate(oldParsed = {}, newParsed = {}) {
  return captureQualityScore(newParsed) > captureQualityScore(oldParsed);
}

function captureQualityScore(parsed = {}) {
  const title = String(parsed.title || "").trim();
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.length : 0;
  const skuCount = Array.isArray(parsed.skuVariants) ? parsed.skuVariants.length : 0;
  const imageCount = Array.isArray(parsed.images) ? parsed.images.length : 0;
  const size = parsed.sizeWeight || {};
  const sizeReady = Boolean(size.weightG && size.lengthMm && size.widthMm && size.heightMm);
  let score = 0;
  if (title) score += 40;
  if (sizeReady) score += 20;
  score += Math.min(15, imageCount);
  if (skuCount > 0 && skuCount <= 10) score += 15;
  else if (skuCount > 10 && skuCount <= 30) score += 8;
  else if (skuCount > 30) score -= 8;
  score -= warnings * 8;
  return score;
}

export async function getCollectionItem(id, scope = {}) {
  const items = await readBoxLocked();
  return items.find((item) => item.id === id && itemVisibleToScope(item, scope)) || null;
}

export async function updateCollectionItem(id, patch, scope = {}) {
  return mutateBox((items) => {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1 || !itemVisibleToScope(items[index], scope)) return { write: false, value: null };
    items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
    return { items, value: items[index] };
  });
}

export async function deleteCollectionItem(id, scope = {}) {
  return mutateBox((items) => {
    if (!itemVisibleToScope(items.find((item) => item.id === id) || {}, scope)) return { write: false, value: false };
    const next = items.filter((item) => item.id !== id);
    return { items: next, value: next.length !== items.length };
  });
}
