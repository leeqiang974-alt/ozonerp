import fs from "node:fs/promises";
import path from "node:path";
import iconv from "iconv-lite";
import { addCollectionItem, getCollectionItem, updateCollectionItem } from "./collectionBox.js";
import { fetch1688Html, parse1688Product } from "./collector1688.js";
import { calculateOzonPrice, matchRmbShippingLevel } from "./pricing.js";
import { callAiTask } from "./aiTaskRouter.js";
import { llmConfig } from "./llmListing.js";
import {
  createWorkflowRun,
  listWorkflowRuns,
  upsertWorkflowNode,
  workflowNodeFromAutoListingStage,
} from "./workflowRuns.js";
import {
  SOURCING_MAX_SKU_COUNT,
  SOURCING_MAX_SOURCE_WEIGHT_G,
  evaluateSourcingCandidate,
} from "./sourcingRules.js";

const DATA_DIR = path.resolve(process.env.CRAWLER1688_DATA_DIR || "data");
const TASK_FILE = path.join(DATA_DIR, "1688-crawler-tasks.json");
const CANDIDATE_FILE = path.join(DATA_DIR, "1688-crawler-candidates.json");
const SESSION_FILE = path.join(DATA_DIR, "1688-crawler-session.json");
const JOB_FILE = path.join(DATA_DIR, "1688-crawler-jobs.json");
const WORKER_FILE = path.join(DATA_DIR, "1688-crawler-workers.json");
const RUNNING_JOB_TIMEOUT_MS = 5 * 60 * 1000;
const WORKER_ONLINE_WINDOW_MS = 90 * 1000;
const DEFAULT_MAX_ACCEPTED_CANDIDATES = Number(process.env.CRAWLER1688_MAX_ACCEPTED_CANDIDATES || 2);
const DEFAULT_MAX_DETAIL_JOBS = Number(process.env.CRAWLER1688_MAX_DETAIL_JOBS || 2);
const runningTasks = new Set();
const writeChains = new Map();

function parseJsonWithRecovery(raw = "") {
  let text = String(raw || "");
  if (text && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (_) {
    // Recover from truncated tail by cutting to the last top-level closing brace.
    const lastBrace = text.lastIndexOf("}");
    if (lastBrace > 0) {
      const cut = text.slice(0, lastBrace + 1);
      return JSON.parse(cut);
    }
    throw _;
  }
}

async function readJsonList(file) {
  try {
    const data = parseJsonWithRecovery(await fs.readFile(file, "utf8"));
    return Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJsonListUnlocked(file, items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload = JSON.stringify({ items }, null, 2);
  let lastError = null;
  for (let i = 0; i < 8; i += 1) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fs.writeFile(tmp, payload, "utf8");
      await fs.rename(tmp, file);
      return;
    } catch (error) {
      lastError = error;
      try { await fs.unlink(tmp); } catch {}
      if (!error || !["EPERM", "ENOENT", "EBUSY"].includes(error.code)) break;
      await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
  await fs.writeFile(file, payload, "utf8");
  if (lastError) return;
}

async function writeJsonList(file, items) {
  const previous = writeChains.get(file) || Promise.resolve();
  const next = previous.catch(function() {}).then(function() {
    return writeJsonListUnlocked(file, items);
  });
  writeChains.set(file, next.catch(function() {}));
  return next;
}

async function readSession() {
  try {
    const data = parseJsonWithRecovery(await fs.readFile(SESSION_FILE, "utf8"));
    return { cookie: String(data.cookie || ""), updatedAt: data.updatedAt || "" };
  } catch (error) {
    if (error.code === "ENOENT") return { cookie: "", updatedAt: "" };
    throw error;
  }
}

async function writeSession(cookie = "") {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload = { cookie: String(cookie || ""), updatedAt: nowIso() };
  await fs.writeFile(SESSION_FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function makeId(prefix) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function randomDelay(minMs = 800, maxMs = 2000) {
  const span = Math.max(0, maxMs - minMs);
  return minMs + Math.floor(Math.random() * (span + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasHumanCheck(html = "", url = "") {
  const text = `${html} ${url}`.toLowerCase();
  return /验证码|人机|滑块|访问频繁|风控|安全验证|login\.1688|passport\.alibaba|please slide|verify/.test(text);
}

function sourceUrlForTask(task) {
  const sourceType = String(task.sourceType || "keyword");
  const sourceValue = String(task.sourceValue || "").trim();
  if (sourceType === "search_url" || sourceType === "shop") return sourceValue;
  return `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeGbkURIComponent(sourceValue)}`;
}

function encodeGbkURIComponent(text = "") {
  const bytes = iconv.encode(String(text || ""), "gbk");
  return [...bytes].map((byte) => {
    const char = String.fromCharCode(byte);
    return /[A-Za-z0-9_.~-]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

function isDirectOfferUrl(url = "") {
  return /https?:\/\/detail\.1688\.com\/offer\/\d+\.html/i.test(String(url || ""));
}

function pageUrl(baseUrl, page) {
  if (!baseUrl) return "";
  if (page <= 1) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("beginPage", String(page));
  return url.toString();
}

function normalizeOfferUrl(url = "") {
  const match = String(url).match(/https?:\/\/detail\.1688\.com\/offer\/\d+\.html/i);
  return match ? match[0] : "";
}

function extractOfferUrlsFromHtml(html = "") {
  const urls = new Set();
  const patterns = [
    /https?:\/\/detail\.1688\.com\/offer\/\d+\.html/gi,
    /\/\/detail\.1688\.com\/offer\/\d+\.html/gi,
    /href=["'](https?:\/\/detail\.1688\.com\/offer\/\d+\.html[^"']*)["']/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const raw = match[1] || match[0];
      const url = normalizeOfferUrl(raw.startsWith("//") ? `https:${raw}` : raw);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

function safeTitle(text = "", fallback = "") {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value || fallback;
}

function candidateFromParsed(taskId, parsed, index) {
  const prices = (parsed.skuVariants || []).map((sku) => Number(sku.price || 0)).filter((item) => item > 0);
  const priceMin = prices.length ? Math.min(...prices) : Number(parsed.ozonDraft?.price || 0);
  const priceMax = prices.length ? Math.max(...prices) : Number(parsed.ozonDraft?.price || 0);
  const sizeWeightReady = Boolean(parsed.sizeWeight?.weightG && parsed.sizeWeight?.lengthMm && parsed.sizeWeight?.widthMm && parsed.sizeWeight?.heightMm);
  const skuCount = parsed.skuVariants?.length || 0;
  const imageCount = parsed.images?.length || 0;
  const score = Math.max(20, Math.min(98, 45 + (sizeWeightReady ? 20 : 0) + Math.min(20, skuCount * 2) + Math.min(13, imageCount)));
  return {
    id: makeId("cc_"),
    taskId,
    status: "pending_review",
    title: safeTitle(parsed.title, `候选商品 ${index + 1}`),
    url: parsed.url,
    supplier: safeTitle(parsed.supplier || "", "未知供应商"),
    priceMin: Number(priceMin || 0),
    priceMax: Number(priceMax || 0),
    skuCount,
    imageCount,
    sizeWeightReady,
    riskLevel: sizeWeightReady ? "low" : "medium",
    score,
    parsed,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

async function updateTask(id, patch = {}) {
  const tasks = await readJsonList(TASK_FILE);
  const index = tasks.findIndex((item) => item.id === id);
  if (index === -1) return null;
  tasks[index] = { ...tasks[index], ...patch, updatedAt: nowIso() };
  await writeJsonList(TASK_FILE, tasks);
  return tasks[index];
}

async function appendCandidates(rows = []) {
  if (!rows.length) return;
  const items = await readJsonList(CANDIDATE_FILE);
  items.push(...rows);
  await writeJsonList(CANDIDATE_FILE, items);
}

function crawlerTaskTitle(task = {}) {
  return String(task.sourceValue || task.keyword || task.sourceType || task.id || "1688 采集任务");
}

async function findOrCreateCrawlerWorkflow(task = {}) {
  const crawlerTaskId = String(task.id || "").trim();
  if (!crawlerTaskId) return null;
  const runs = await listWorkflowRuns();
  const existing = (runs.items || []).find((run) => run.entity?.crawlerTaskId === crawlerTaskId);
  if (existing) return existing;
  return createWorkflowRun({
    source: "crawler_1688",
    title: crawlerTaskTitle(task),
    status: "running",
    currentNode: "crawler_1688",
    entity: {
      crawlerTaskId,
      sourceType: task.sourceType || "",
      sourceValue: task.sourceValue || "",
      storeId: task.storeId || "",
    },
  });
}

async function emitCrawlerWorkflowNode(taskOrId, stage, data = {}) {
  try {
    const task = typeof taskOrId === "string" ? await getCrawlerTask(taskOrId) : taskOrId;
    if (!task) return null;
    const workflow = await findOrCreateCrawlerWorkflow(task);
    if (!workflow) return null;
    const node = workflowNodeFromAutoListingStage(stage, data);
    return upsertWorkflowNode(workflow.id, {
      ...node,
      input: {
        crawlerTaskId: task.id,
        sourceType: task.sourceType || "",
        sourceValue: task.sourceValue || "",
        options: task.options || {},
        ...(data.input || {}),
      },
      output: {
        ...(node.output || {}),
        taskStatus: task.status || "",
        progress: task.progress || {},
        ...(data.output || {}),
      },
      runStatus: data.runStatus,
    });
  } catch {
    return null;
  }
}

async function readJobs() {
  return readJsonList(JOB_FILE);
}

async function writeJobs(items) {
  return writeJsonList(JOB_FILE, items);
}

async function readWorkers() {
  return readJsonList(WORKER_FILE);
}

async function writeWorkers(items) {
  return writeJsonList(WORKER_FILE, items);
}

async function enqueueJobs(rows = []) {
  if (!rows.length) return;
  const jobs = await readJobs();
  jobs.push(...rows);
  await writeJobs(jobs);
}

function jobForTask(task, kind, url, extra = {}) {
  return {
    id: makeId("cj_"),
    taskId: task.id,
    kind,
    url,
    storeId: task.storeId || "",
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    lastError: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...extra,
  };
}

function maxAcceptedCandidatesForTask(task = {}) {
  return Math.max(1, toNumber(task.options?.maxAcceptedCandidates, DEFAULT_MAX_ACCEPTED_CANDIDATES));
}

function maxDetailJobsForTask(task = {}) {
  const maxProducts = Math.max(1, toNumber(task.options?.maxProducts, 20));
  const acceptedTarget = maxAcceptedCandidatesForTask(task);
  const defaultDetailJobs = Math.max(acceptedTarget, DEFAULT_MAX_DETAIL_JOBS);
  return Math.min(maxProducts, Math.max(1, toNumber(task.options?.maxDetailJobs, defaultDetailJobs)));
}

async function stopRemainingDetailJobsAfterAcceptedTarget(taskId, acceptedCount) {
  const task = await getCrawlerTask(taskId);
  if (!task || acceptedCount < maxAcceptedCandidatesForTask(task)) return 0;
  const jobs = await readJobs();
  let stopped = 0;
  const nextJobs = jobs.map((job) => {
    if (job.taskId !== taskId || job.kind !== "detail" || job.status !== "queued") return job;
    stopped += 1;
    return {
      ...job,
      status: "paused",
      lastError: "海选已拿到足够合格候选，剩余详情页暂停以切换下一个关键词。",
      updatedAt: nowIso(),
    };
  });
  if (stopped) await writeJobs(nextJobs);
  return stopped;
}

async function maybeFinishExtensionTask(taskId) {
  const jobs = (await readJobs()).filter((job) => job.taskId === taskId);
  if (!jobs.length) return;
  const active = jobs.some((job) => ["queued", "running"].includes(job.status));
  if (active) return;
  const failed = jobs.filter((job) => job.status === "failed");
  const candidates = await listCrawlerCandidates({ taskId });
  await updateTask(taskId, {
    status: failed.length && !candidates.length ? "failed" : "finished",
    lastError: failed.length ? failed.map((job) => job.lastError).filter(Boolean).slice(0, 3).join("；") : "",
    progress: {
      page: 1,
      urlsDiscovered: jobs.filter((job) => job.kind === "detail").length,
      productsParsed: jobs.filter((job) => job.kind === "detail" && job.status === "done").length,
      candidatesSaved: candidates.length,
    },
  });
}

function releaseStaleRunningJobs(jobs = []) {
  const now = Date.now();
  return jobs.map((job) => {
    if (job.status !== "running") return job;
    const updatedAt = new Date(job.updatedAt || job.createdAt || 0).getTime();
    if (Number.isFinite(updatedAt) && now - updatedAt < RUNNING_JOB_TIMEOUT_MS) return job;
    return {
      ...job,
      status: Number(job.attempts || 0) >= Number(job.maxAttempts || 3) ? "failed" : "queued",
      lastError: "后台 worker 超时未回传，已自动释放作业",
      updatedAt: nowIso(),
    };
  });
}

function isHumanRecoverableJob(job = {}) {
  const text = String(job.lastError || "").toLowerCase();
  return /人机|验证|登录|login|human|captcha|滑块|未提取|没有提取|no offer/.test(text);
}

async function requeueRecoverableJobsForTask(taskId) {
  const jobs = await readJobs();
  let changed = 0;
  const nextJobs = jobs.map((job) => {
    if (job.taskId !== taskId || job.status !== "failed" || !isHumanRecoverableJob(job)) return job;
    changed += 1;
    return {
      ...job,
      status: "queued",
      attempts: 0,
      workerId: "",
      lastError: "",
      updatedAt: nowIso(),
    };
  });
  if (changed) await writeJobs(nextJobs);
  return changed;
}

async function hasExtensionJobsForTask(taskId) {
  const jobs = await readJobs();
  return jobs.some((job) => job.taskId === taskId && ["queued", "running"].includes(job.status));
}

async function runTask(taskId) {
  if (runningTasks.has(taskId)) return;
  runningTasks.add(taskId);
  try {
    let task = await getCrawlerTask(taskId);
    if (!task) return;
    const session = await readSession();
    const baseUrl = sourceUrlForTask(task);
    if (!baseUrl) {
      await updateTask(taskId, { status: "failed", lastError: "缺少采集来源内容。" });
      return;
    }
    let discovered = [];
    if (isDirectOfferUrl(baseUrl)) {
      discovered = [normalizeOfferUrl(baseUrl)];
    }
    const maxPages = Math.max(1, toNumber(task.options?.maxPages, 3));
    for (let page = 1; page <= maxPages; page += 1) {
      if (discovered.length && isDirectOfferUrl(baseUrl)) break;
      task = await getCrawlerTask(taskId);
      if (!task || task.status === "stopped") return;
      if (task.status === "paused") {
        while (true) {
          await sleep(1000);
          const next = await getCrawlerTask(taskId);
          if (!next || next.status === "stopped") return;
          if (next.status !== "paused") break;
        }
      }
      const listUrl = pageUrl(baseUrl, page);
      const listHtml = await fetch1688Html(listUrl, { cookie: session.cookie });
      if (hasHumanCheck(listHtml, listUrl)) {
        await updateTask(taskId, {
          status: "waiting_human",
          lastError: "触发 1688 人机校验，请补登录/验证后点击继续。",
          progress: { ...(task.progress || {}), page },
        });
        return;
      }
      const pageUrls = extractOfferUrlsFromHtml(listHtml);
      discovered = [...new Set([...discovered, ...pageUrls])];
      await updateTask(taskId, {
        progress: { ...(task.progress || {}), page, urlsDiscovered: discovered.length },
      });
      if (discovered.length >= toNumber(task.options?.maxProducts, 20)) break;
      await sleep(randomDelay(600, 1600));
    }
    if (!discovered.length) {
      await updateTask(taskId, {
        status: "waiting_human",
        lastError: "未发现商品链接，可能被 1688 动态渲染或风控拦截。请补充 cookie 或直接使用商品详情链接。",
      });
      return;
    }
    const maxProducts = Math.min(discovered.length, Math.max(1, toNumber(task.options?.maxProducts, 20)));
    const targetUrls = discovered.slice(0, maxProducts);
    const candidates = [];
    for (let i = 0; i < targetUrls.length; i += 1) {
      task = await getCrawlerTask(taskId);
      if (!task || task.status === "stopped") return;
      if (task.status === "paused") {
        while (true) {
          await sleep(1000);
          const next = await getCrawlerTask(taskId);
          if (!next || next.status === "stopped") return;
          if (next.status !== "paused") break;
        }
      }
      const url = targetUrls[i];
      try {
        const html = await fetch1688Html(url, { cookie: session.cookie });
        if (hasHumanCheck(html, url)) {
          await updateTask(taskId, {
            status: "waiting_human",
            lastError: `抓取商品时触发人机验证：${url}`,
            progress: {
              ...(task.progress || {}),
              productsParsed: i,
              candidatesSaved: candidates.length,
            },
          });
          return;
        }
        const parsed = parse1688Product({
          url,
          html,
          hints: { sourceType: "crawler1688", source: "crawler1688" },
        });
        if (!parsed.title && task.options?.mustHaveSku !== false && !(parsed.skuVariants || []).length) continue;
        const candidate = candidateFromParsed(taskId, parsed, i);
        if (task.options?.mustHaveSizeWeight && !candidate.sizeWeightReady) continue;
        if (task.options?.mustHaveSku && candidate.skuCount < 1) continue;
        if (task.options?.smallItemOnly) {
          const gate = evaluateSourcingCandidate(candidate, {
            maxSkuCount: task.options?.maxSkuCount,
            maxWeightG: task.options?.maxWeightG,
          });
          if (!gate.ok) continue;
          candidate.sourcingGate = gate;
        }
        const minPrice = toNumber(task.options?.priceMin, 0);
        const maxPrice = toNumber(task.options?.priceMax, 99999);
        if ((candidate.priceMin && candidate.priceMin < minPrice) || (candidate.priceMin && candidate.priceMin > maxPrice)) continue;
        candidates.push(candidate);
      } catch (error) {
        await updateTask(taskId, { lastError: `部分商品采集失败：${error.message}` });
      }
      await updateTask(taskId, {
        progress: {
          ...(task.progress || {}),
          productsParsed: i + 1,
          candidatesSaved: candidates.length,
        },
      });
      await sleep(randomDelay(1200, 2600));
    }
    await appendCandidates(candidates);
    await updateTask(taskId, {
      status: "finished",
      lastError: "",
      progress: {
        ...(task.progress || {}),
        productsParsed: targetUrls.length,
        candidatesSaved: candidates.length,
      },
    });
  } catch (error) {
    await updateTask(taskId, { status: "failed", lastError: error.message || "任务执行失败" });
  } finally {
    runningTasks.delete(taskId);
  }
}

export async function listCrawlerTasks() {
  const items = await readJsonList(TASK_FILE);
  return items.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function getCrawlerTask(id) {
  const items = await readJsonList(TASK_FILE);
  return items.find((item) => item.id === id) || null;
}

export async function createCrawlerTask(input = {}) {
  const now = nowIso();
  const tasks = await readJsonList(TASK_FILE);
  const sourceText = String(input.sourceValue || input.keyword || "").trim();
  const task = {
    id: makeId("ct_"),
    status: "queued",
    sourceType: String(input.sourceType || "keyword"),
    sourceValue: sourceText,
    storeId: String(input.storeId || ""),
    options: {
      maxProducts: Math.min(200, Math.max(1, toNumber(input.options?.maxProducts || input.maxProducts, 20))),
      maxPages: Math.max(1, toNumber(input.options?.maxPages || input.maxPages, 3)),
      maxAcceptedCandidates: Math.max(1, toNumber(input.options?.maxAcceptedCandidates || input.maxAcceptedCandidates, DEFAULT_MAX_ACCEPTED_CANDIDATES)),
      maxDetailJobs: Math.max(1, toNumber(input.options?.maxDetailJobs || input.maxDetailJobs, DEFAULT_MAX_DETAIL_JOBS)),
      mustHaveSku: input.options?.mustHaveSku !== false,
      mustHaveSizeWeight: input.options?.mustHaveSizeWeight !== false,
      smallItemOnly: input.options?.smallItemOnly !== false,
      maxSkuCount: Math.max(1, toNumber(input.options?.maxSkuCount || input.maxSkuCount, SOURCING_MAX_SKU_COUNT)),
      maxWeightG: Math.max(1, toNumber(input.options?.maxWeightG || input.maxWeightG, SOURCING_MAX_SOURCE_WEIGHT_G)),
      priceMin: toNumber(input.options?.priceMin || input.priceMin, 0),
      priceMax: toNumber(input.options?.priceMax || input.priceMax, 99999),
    },
    progress: {
      page: 0,
      urlsDiscovered: 0,
      productsParsed: 0,
      candidatesSaved: 0,
    },
    lastError: "",
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  await writeJsonList(TASK_FILE, tasks);
  const baseUrl = sourceUrlForTask(task);
  const initialJob = isDirectOfferUrl(baseUrl)
    ? jobForTask(task, "detail", normalizeOfferUrl(baseUrl))
    : jobForTask(task, "discover", baseUrl, { maxPages: task.options.maxPages, maxProducts: task.options.maxProducts });
  await enqueueJobs([initialJob]);
  await emitCrawlerWorkflowNode(task, "searching_1688", {
    nodeStatus: "running",
    keyword: task.sourceValue,
    crawlerTaskIds: [task.id],
    output: {
      initialJob: {
        id: initialJob.id,
        kind: initialJob.kind,
        url: initialJob.url,
      },
    },
  });
  return { task, candidatesCreated: 0 };
}

export async function updateCrawlerTaskStatus(id, status) {
  const allowed = new Set(["paused", "running", "stopped"]);
  if (!allowed.has(status)) throw new Error("不支持的任务状态");
  const requeuedJobs = status === "running" ? await requeueRecoverableJobsForTask(id) : 0;
  const item = await updateTask(id, { status });
  const hasExtensionJobs = status === "running" ? await hasExtensionJobsForTask(id) : false;
  if (item && status === "running" && !hasExtensionJobs) runTask(id);
  return item ? { ...item, requeuedJobs } : item;
}

export async function deleteCrawlerTask(id) {
  const taskId = String(id || "").trim();
  if (!taskId) return null;
  const tasks = await readJsonList(TASK_FILE);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return null;
  await writeJsonList(TASK_FILE, tasks.filter((item) => item.id !== taskId));
  await writeJobs((await readJobs()).filter((job) => job.taskId !== taskId));
  await writeJsonList(CANDIDATE_FILE, (await readJsonList(CANDIDATE_FILE)).filter((candidate) => candidate.taskId !== taskId));
  runningTasks.delete(taskId);
  return task;
}

export async function listCrawlerCandidates(filter = {}) {
  const items = await readJsonList(CANDIDATE_FILE);
  const taskId = String(filter.taskId || "").trim();
  const status = String(filter.status || "").trim();
  const query = String(filter.query || "").trim().toLowerCase();
  let rows = items;
  if (taskId) rows = rows.filter((item) => item.taskId === taskId);
  if (status) rows = rows.filter((item) => item.status === status);
  if (query) {
    rows = rows.filter((item) =>
      [item.title, item.url, item.supplier]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }
  return rows.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function updateCrawlerCandidate(id, patch = {}) {
  const items = await readJsonList(CANDIDATE_FILE);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  items[index] = {
    ...items[index],
    ...patch,
    updatedAt: nowIso(),
  };
  await writeJsonList(CANDIDATE_FILE, items);
  return items[index];
}

export async function moveCrawlerCandidateToCapture(id, storeId = "") {
  const items = await readJsonList(CANDIDATE_FILE);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const candidate = items[index];
  const parsed = candidate.parsed || {
    source: "1688",
    url: candidate.url,
    title: candidate.title,
    skuVariants: [],
    images: [],
    attributes: [],
    sizeWeight: {},
    ozonDraft: {},
    warnings: [],
  };
  const result = await addCollectionItem({
    parsed,
    storeId: String(storeId || ""),
    includeVideo: true,
  });
  items[index] = {
    ...candidate,
    status: "captured",
    captureId: result.id,
    updatedAt: nowIso(),
  };
  await writeJsonList(CANDIDATE_FILE, items);
  return { candidate: items[index], capture: result };
}

export async function moveCaptureToCrawlerCandidate(id) {
  const capture = await getCollectionItem(id);
  if (!capture) return null;
  const parsed = capture.parsed || {};
  const url = parsed.url || "";
  const items = await readJsonList(CANDIDATE_FILE);
  const existing = url ? items.find((item) => String(item.url || item.parsed?.url || "") === String(url)) : null;
  if (existing) {
    await updateCollectionItem(id, {
      status: "candidate_ready",
      candidateId: existing.id,
    });
    return { capture, candidate: existing, duplicate: true };
  }

  const candidate = {
    ...candidateFromParsed(`capture:${id}`, parsed, items.length),
    id: makeId(parsed.source === "pdd" ? "pddc_" : "cc_"),
    source: parsed.source || "capture",
    sourcePlatform: parsed.sourcePlatform || (parsed.source === "pdd" ? "拼多多" : "1688"),
    captureId: id,
    storeId: capture.storeId || "",
    includeVideo: capture.includeVideo !== false,
    status: parsed.title ? "pending_review" : "needs_review",
    riskLevel: parsed.title ? (parsed.sizeWeight?.weightG ? "low" : "medium") : "high",
    reviewIssues: [
      ...(parsed.title ? [] : ["缺少商品标题"]),
      ...(parsed.sizeWeight?.weightG && parsed.sizeWeight?.lengthMm && parsed.sizeWeight?.widthMm && parsed.sizeWeight?.heightMm ? [] : ["缺少完整尺重"]),
      ...(parsed.warnings || []),
    ],
  };
  items.push(candidate);
  await writeJsonList(CANDIDATE_FILE, items);
  const updatedCapture = await updateCollectionItem(id, {
    status: "candidate_ready",
    candidateId: candidate.id,
  });
  return { capture: updatedCapture || capture, candidate, duplicate: false };
}

export async function setCrawlerSessionCookie(cookie = "") {
  return writeSession(cookie);
}

export async function getCrawlerSessionStatus() {
  const session = await readSession();
  return {
    hasCookie: Boolean(String(session.cookie || "").trim()),
    updatedAt: session.updatedAt || "",
  };
}

export async function clearCrawlerSessionCookie() {
  await writeSession("");
  return { ok: true };
}

export async function recordCrawlerWorkerHeartbeat(input = {}) {
  const workerId = String(input.workerId || "").trim() || "unknown-worker";
  const now = nowIso();
  const workers = await readWorkers();
  const index = workers.findIndex((item) => item.workerId === workerId);
  const currentJob = input.currentJob || input.job || null;
  const payload = {
    workerId,
    status: String(input.status || "idle"),
    message: String(input.message || ""),
    currentTaskId: String(input.currentTaskId || currentJob?.taskId || ""),
    currentJobId: String(input.currentJobId || currentJob?.id || ""),
    currentJobKind: String(input.currentJobKind || currentJob?.kind || ""),
    currentJobUrl: String(input.currentJobUrl || currentJob?.url || ""),
    lastCheckAt: input.lastCheckAt || now,
    lastError: String(input.lastError || ""),
    needsHuman: Boolean(input.needsHuman),
    userAgent: String(input.userAgent || ""),
    updatedAt: now,
  };
  if (index === -1) workers.push({ ...payload, createdAt: now });
  else workers[index] = { ...workers[index], ...payload };
  await writeWorkers(workers);
  return payload;
}

export async function getCrawlerWorkerStatus() {
  const workers = await readWorkers();
  const now = Date.now();
  const items = workers
    .map((worker) => {
      const updatedAt = new Date(worker.updatedAt || 0).getTime();
      const online = Number.isFinite(updatedAt) && now - updatedAt <= WORKER_ONLINE_WINDOW_MS;
      return {
        ...worker,
        online,
      };
    })
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return {
    online: items.some((worker) => worker.online),
    items,
    updatedAt: nowIso(),
  };
}

export async function claimCrawlerExtensionJob(workerId = "") {
  let jobs = releaseStaleRunningJobs(await readJobs());
  await writeJobs(jobs);
  const tasks = await readJsonList(TASK_FILE);
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  let index = -1;
  let task = null;
  const claimable = jobs
    .map((job, i) => ({ job, i }))
    .filter(({ job }) => job.status === "queued")
    .sort((a, b) => {
      const kindA = a.job.kind === "discover" ? 0 : 1;
      const kindB = b.job.kind === "discover" ? 0 : 1;
      return kindA - kindB || a.i - b.i;
    });
  for (const { job, i } of claimable) {
    const candidateTask = taskById.get(job.taskId);
    if (!candidateTask || ["stopped", "paused", "waiting_human", "failed", "finished"].includes(candidateTask.status)) continue;
    index = i;
    task = candidateTask;
    break;
  }
  if (index === -1 || !task) return null;
  jobs[index] = {
    ...jobs[index],
    status: "running",
    attempts: Number(jobs[index].attempts || 0) + 1,
    workerId: String(workerId || ""),
    updatedAt: nowIso(),
  };
  await writeJobs(jobs);
  if (task.status === "queued" || task.status === "waiting_human") await updateTask(task.id, { status: "running", lastError: "" });
  return jobs[index];
}

export async function completeCrawlerExtensionDiscover(jobId, payload = {}) {
  const jobs = await readJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return null;
  const job = jobs[index];
  const urls = [...new Set((payload.urls || []).map(normalizeOfferUrl).filter(Boolean))];
  if (payload.needsHuman) {
    jobs[index] = { ...job, status: "failed", lastError: payload.error || "浏览器需要人工验证", updatedAt: nowIso() };
    await writeJobs(jobs);
    await updateTask(job.taskId, { status: "waiting_human", lastError: jobs[index].lastError });
    await emitCrawlerWorkflowNode(job.taskId, "waiting_crawl", {
      nodeStatus: "failed",
      runStatus: "waiting_human",
      output: { error: jobs[index].lastError, needsHuman: true },
    });
    return { job: jobs[index], urlsCreated: 0 };
  }
  if (payload.error && !(payload.urls || []).length) {
    jobs[index] = { ...job, status: "failed", lastError: payload.error, updatedAt: nowIso() };
    await writeJobs(jobs);
    await updateTask(job.taskId, { lastError: payload.error });
    await maybeFinishExtensionTask(job.taskId);
    return { job: jobs[index], urlsCreated: 0 };
  }
  if (!urls.length) {
    const message = "插件已打开 1688 搜索页，但没有提取到商品链接。可能是搜索无结果、页面未完全加载或 1688 页面结构变化。";
    jobs[index] = { ...job, status: "failed", lastError: message, updatedAt: nowIso() };
    await writeJobs(jobs);
    await updateTask(job.taskId, { status: "waiting_human", lastError: message });
    await emitCrawlerWorkflowNode(job.taskId, "waiting_crawl", {
      nodeStatus: "failed",
      runStatus: "waiting_human",
      output: { error: message, urlsDiscovered: 0 },
    });
    return { job: jobs[index], urlsCreated: 0 };
  }
  jobs[index] = { ...job, status: "done", updatedAt: nowIso() };
  const task = await getCrawlerTask(job.taskId);
  const limit = maxDetailJobsForTask(task || {});
  const existingDetailUrls = new Set(jobs.filter((item) => item.taskId === job.taskId && item.kind === "detail").map((item) => item.url));
  const detailJobs = urls
    .filter((url) => !existingDetailUrls.has(url))
    .slice(0, limit)
    .map((url) => jobForTask(task || { id: job.taskId }, "detail", url));
  await writeJobs(jobs);
  await enqueueJobs(detailJobs);
  await updateTask(job.taskId, {
    progress: {
      ...(task?.progress || {}),
      page: 1,
      urlsDiscovered: urls.length,
    },
  });
  await emitCrawlerWorkflowNode(job.taskId, "waiting_crawl", {
    nodeStatus: "running",
    candidateCount: 0,
    output: {
      urlsDiscovered: urls.length,
      detailJobsCreated: detailJobs.length,
    },
  });
  await maybeFinishExtensionTask(job.taskId);
  return { job: jobs[index], urlsCreated: detailJobs.length };
}

export async function completeCrawlerExtensionDetail(jobId, payload = {}) {
  const jobs = await readJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) return null;
  const job = jobs[index];
  if (payload.needsHuman) {
    jobs[index] = { ...job, status: "failed", lastError: payload.error || "浏览器需要人工验证", updatedAt: nowIso() };
    await writeJobs(jobs);
    await updateTask(job.taskId, { status: "waiting_human", lastError: jobs[index].lastError });
    await emitCrawlerWorkflowNode(job.taskId, "waiting_crawl", {
      nodeStatus: "failed",
      runStatus: "waiting_human",
      output: { error: jobs[index].lastError, needsHuman: true, url: job.url },
    });
    return { job: jobs[index], candidate: null };
  }
  if (payload.error && !payload.html) {
    jobs[index] = { ...job, status: "failed", lastError: payload.error, updatedAt: nowIso() };
    await writeJobs(jobs);
    await updateTask(job.taskId, { lastError: payload.error });
    await maybeFinishExtensionTask(job.taskId);
    return { job: jobs[index], candidate: null };
  }
  try {
    const parsed = parse1688Product({
      url: payload.url || job.url,
      html: payload.html || "",
      hints: { ...payload, sourceType: "crawler1688", source: "crawler1688" },
    });
    const task = await getCrawlerTask(job.taskId);
    const candidate = candidateFromParsed(job.taskId, parsed, 0);
    const shouldKeep = (!task?.options?.mustHaveSku || candidate.skuCount > 0)
      && (!task?.options?.mustHaveSizeWeight || candidate.sizeWeightReady)
      && (!task?.options?.smallItemOnly || evaluateSourcingCandidate(candidate, {
        maxSkuCount: task.options?.maxSkuCount,
        maxWeightG: task.options?.maxWeightG,
      }).ok);
    jobs[index] = { ...job, status: "done", updatedAt: nowIso() };
    await writeJobs(jobs);
    if (shouldKeep) await appendCandidates([candidate]);
    const candidates = await listCrawlerCandidates({ taskId: job.taskId });
    const pausedAfterTarget = await stopRemainingDetailJobsAfterAcceptedTarget(job.taskId, candidates.length);
    await updateTask(job.taskId, {
      progress: {
        ...(task?.progress || {}),
        urlsDiscovered: jobs.filter((item) => item.taskId === job.taskId && item.kind === "detail").length,
        productsParsed: jobs.filter((item) => item.taskId === job.taskId && item.kind === "detail" && item.status === "done").length,
        candidatesSaved: candidates.length,
      },
    });
    await emitCrawlerWorkflowNode(job.taskId, "crawled", {
      nodeStatus: "success",
      candidateCount: candidates.length,
      acceptedCount: shouldKeep ? 1 : 0,
      rejectedCount: shouldKeep ? 0 : 1,
      output: {
        parsedUrl: parsed.url || job.url,
        candidate: shouldKeep ? {
          id: candidate.id,
          title: parsed.title || payload.title || candidate.title,
          url: candidate.url,
          priceMin: candidate.priceMin,
          priceMax: candidate.priceMax,
          skuCount: candidate.skuCount,
          imageCount: candidate.imageCount,
          sizeWeightReady: candidate.sizeWeightReady,
          score: candidate.score,
        } : null,
        rejectedReason: shouldKeep ? "" : "候选未通过 SKU/尺寸重量/小件门禁",
        pausedAfterTarget,
      },
    });
    await maybeFinishExtensionTask(job.taskId);
    return { job: jobs[index], candidate: shouldKeep ? candidate : null };
  } catch (error) {
    jobs[index] = { ...job, status: "failed", lastError: error.message, updatedAt: nowIso() };
    await writeJobs(jobs);
    await emitCrawlerWorkflowNode(job.taskId, "crawled", {
      nodeStatus: "failed",
      runStatus: "waiting_human",
      output: { error: error.message, url: job.url },
    });
    await maybeFinishExtensionTask(job.taskId);
    return { job: jobs[index], candidate: null };
  }
}

// ====== 自动拓词 ======
// ====== 增强版拓词（多维度 + 利润 + 风险） ======
const RMB_TO_RUB = 12;

const EXPAND_DIMENSIONS = [
  { name: "核心品类词", desc: "商品核心品类名称，最直接的搜索词" },
  { name: "材质/规格词", desc: "不同材质、尺寸、规格的变体" },
  { name: "场景/用途词", desc: "使用场景、人群、功能描述" },
  { name: "风格/款式词", desc: "不同风格、款式、设计" },
  { name: "关联品类词", desc: "同场景/同人群的关联品类" },
  { name: "低价/走量词", desc: "价格敏感型搜索词、批发词" },
];

export async function expandKeywords(seeds, options = {}) {
  const words = (seeds || []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
  if (!words.length) throw new Error("请输入至少一个种子词。");
  
  const multiDim = options.multiDim !== false;
  const countPerDim = options.countPerDim || 8;
  
  let prompt;
  if (multiDim) {
    prompt = "你是一个专业1688跨境电商选品助理。基于用户提供的种子词，从6个维度生成搜索关键词。\n"
      + "每个维度生成" + countPerDim + "个具体、可搜索的1688商品关键词。\n\n"
      + "维度要求：\n"
      + EXPAND_DIMENSIONS.map(function(d) { return "- " + d.name + "：" + d.desc; }).join("\n")
      + "\n\n约束：\n"
      + "1. 每个词6-20个汉字\n"
      + "2. 必须是1688上真实可搜的商品词\n"
      + "3. 同一维度内不能重复\n"
      + "4. 跨维度可以有一定重叠但尽量不同\n"
      + "5. 低价/走量词偏重批发、便宜、实惠、工厂\n"
      + "6. 必须保持同一商品类型，不能扩到用途相似但品类不同的商品\n"
      + "7. 如果种子词是滴胶/环氧树脂/首饰/蜡烛/石膏/手作模具，只能生成手工DIY、树脂、首饰、蜡烛、石膏模具词，禁止生成蛋糕、烘焙、巧克力、翻糖模具词\n"
      + "\n输出格式：\n"
      + '{\n'
      + '  "dimensions": {\n'
      + '    "核心品类词": ["词1", "词2", ...],\n'
      + '    "材质/规格词": [...],\n'
      + '    "场景/用途词": [...],\n'
      + '    "风格/款式词": [...],\n'
      + '    "关联品类词": [...],\n'
      + '    "低价/走量词": [...]\n'
      + '  }\n'
      + '}\n'
      + "只输出JSON，不要Markdown。\n"
      + "种子词：" + words.join("、");
  } else {
    prompt = "你是一个1688电商选品助手。基于用户提供的种子词，生成紧密相关的、具体的1688商品搜索关键词。\n"
      + "要求：每个词必须与种子词属于同一品类或相关品类，是适合在1688搜索的具体产品词。\n"
      + "每个词8-20个汉字。\n"
      + "输出JSON数组，如 [\\'词1\\', \\'词2\\', \\'词3\\']\n"
      + "不要输出Markdown，只输出JSON。\n"
      + "必须和种子词是同类商品。\n"
      + "如果种子词是滴胶/环氧树脂/首饰/蜡烛/石膏/手作模具，禁止输出蛋糕、烘焙、巧克力、翻糖模具。\n"
      + "种子词：" + words.join("、");
  }

  const ai = await callAiTask({
    taskType: "keyword_expand",
    userPrompt: prompt,
    responseFormat: "json",
    temperature: 0.3,
    maxTokens: 2048,
  });
  if (!ai.ok) return { ok: false, reason: ai.error || "AI 未配置，无法自动拓词。", expanded: [] };

  const cleaned = ai.content.replace(/```(?:json)?\s*([\s\S]*?)```/i, "$1").trim();
  
  let expanded = [];
  let dimensions = {};
  
  try {
    const parsed = ai.json || JSON.parse(cleaned);
    if (parsed.dimensions) {
      // Multi-dimensional result
      dimensions = parsed.dimensions;
      for (const dim of Object.keys(dimensions)) {
        const dimWords = (dimensions[dim] || []).filter(Boolean).map(function(w) { return String(w).trim(); }).filter(Boolean);
        expanded = expanded.concat(dimWords);
      }
    } else if (Array.isArray(parsed)) {
      expanded = parsed.filter(Boolean).map(function(w) { return String(w).trim(); }).filter(Boolean);
    } else {
      expanded = [];
    }
  } catch (e) {
    console.warn("Failed to parse LLM response:", cleaned.slice(0, 100));
    // Fallback: try to extract as array
    try { expanded = JSON.parse(cleaned); } catch(e2) {}
  }

  // Deduplicate
  const seen = new Set();
  expanded = expanded.filter(function(w) { var key = w.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });

  return { ok: true, expanded: expanded.slice(0, 60), count: Math.min(expanded.length, 60), dimensions: dimensions };
}
export async function createExpandedTasks(seeds, options) {
  const preset = Array.isArray(options?.expandedKeywords) ? options.expandedKeywords.filter(Boolean).map((x) => String(x).trim()).filter(Boolean) : [];
  const result = preset.length
    ? { ok: true, expanded: preset }
    : await expandKeywords(seeds);
  if (!result.ok || !result.expanded.length) return { ok: false, reason: result.reason || "未生成扩展词", tasks: [] };

  const tasks = [];
  for (const keyword of result.expanded) {
    const task = await createCrawlerTask({
      sourceType: "keyword",
      sourceValue: keyword,
      options: {
        maxProducts: Number(options?.maxProducts || 20),
        maxPages: Number(options?.maxPages || 2),
      },
    });
    tasks.push(task?.task || task);
  }
  return { ok: true, expanded: result.expanded, count: tasks.length, tasks };
}

// ====== 机会商品匹配 1688 候选 ======
// ====== 增强版匹配（LLM品类判断 + 利润计算 + 风险过滤 + 综合评分） ======
export async function matchCandidatesWithOpportunities(opportunityItems, candidates, options = {}) {
  const opps = (opportunityItems || []).filter(Boolean);
  const cands = (candidates || []).filter(Boolean);
  if (!opps.length || !cands.length) return { matches: [] };

  const config = llmConfig();
  const useLlm = config.enabled && options.useLlm !== false;
  const minScore = options.minScore || 30;
  const matches = [];

  for (const opp of opps) {
    const oppPrice = Number(opp.price || 0);
    const oppTitle = String(opp.title || "");
    const oppCategory = String(opp.category || "");

    for (const cand of cands) {
      const candPriceMin = Number(cand.priceMin || 0);
      const candPriceMax = Number(cand.priceMax || 0);
      const candTitle = String(cand.title || "");
      const candRisk = String(cand.riskLevel || "low");

      // --- Score calculation ---
      
      // 1. Price suitability (30 points)
      let priceScore = 0;
      if (oppPrice > 0 && candPriceMin > 0) {
        const oppPriceCny = oppPrice / RMB_TO_RUB;
        const priceRatio = Math.min(candPriceMax, candPriceMin * 1.5) / oppPriceCny;
        // Good if 1688 price is 5-20% of Ozon price (typical cross-border margin)
        if (priceRatio >= 0.05 && priceRatio <= 0.25) {
          priceScore = 30;
        } else if (priceRatio > 0 && priceRatio < 0.05) {
          priceScore = 15; // Too cheap, might be low quality
        } else if (priceRatio > 0.25 && priceRatio <= 0.4) {
          priceScore = 20; // Margin might be tight
        }
      }

      // 2. Title keyword overlap (20 points)
      const oppWords = new Set(oppTitle.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 2; }));
      const candWords = candTitle.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 1; });
      const overlap = candWords.filter(function(w) { return oppWords.has(w); }).length;
      const titleScore = oppWords.size > 0 ? Math.min(20, Math.round((overlap / oppWords.size) * 20)) : 0;

      // 3. Risk deduction
      let riskPenalty = 0;
      if (candRisk === "high") riskPenalty = 20;
      else if (candRisk === "medium") riskPenalty = 10;

      // 4. Size/weight completeness bonus (10 points)
      const parsed = cand.parsed || {};
      const sw = parsed.sizeWeight || {};
      const hasSize = sw.weightG > 0 && sw.lengthMm > 0;
      const sizeBonus = hasSize ? 10 : 0;

      // 5. Estimated profit bonus (20 points)
      const estimatedMargin = Number(cand.estimatedMargin || cand.estimatedProfitCny || 0);
      const profitBonus = estimatedMargin >= 30 ? 20 : estimatedMargin >= 20 ? 15 : estimatedMargin >= 10 ? 10 : 0;

      let matchScore = priceScore + titleScore + sizeBonus + profitBonus - riskPenalty;
      matchScore = Math.max(0, Math.min(100, matchScore));

      if (matchScore >= minScore) {
        matches.push({
          opportunityId: opp.id,
          opportunityTitle: opp.title,
          opportunityPrice: oppPrice,
          opportunityCategory: oppCategory,
          candidateId: cand.id,
          candidateTitle: cand.title,
          candidateUrl: cand.url || "",
          candidatePriceMin: candPriceMin,
          candidatePriceMax: candPriceMax,
          matchScore: matchScore,
          priceScore: priceScore,
          titleScore: titleScore,
          riskLevel: candRisk,
          riskPenalty: riskPenalty,
          sizeBonus: sizeBonus,
          profitBonus: profitBonus,
          estimatedMargin: estimatedMargin,
          candRiskFlags: cand.riskFlags || [],
          candRiskReasons: cand.riskReasons || [],
        });
      }
    }
  }

  // LLM validation for top matches (if enabled)
  if (useLlm && matches.length > 0) {
    const topMatches = matches.sort(function(a, b) { return b.matchScore - a.matchScore; }).slice(0, 10);
    for (const match of topMatches) {
      try {
        const opp = opps.find(function(o) { return o.id === match.opportunityId; });
        const cand = cands.find(function(c) { return c.id === match.candidateId; });
        if (opp && cand) {
          const llmResult = await callLlmJudge(opp, cand);
          if (llmResult.ok) {
            match.llmMatch = llmResult.match;
            match.llmConfidence = llmResult.confidence;
            match.llmReason = llmResult.reason;
            match.llmValidated = true;
            // Adjust score based on LLM
            if (llmResult.match === false) {
              match.matchScore = Math.max(0, match.matchScore - 30);
              match.llmPenalty = 30;
            } else if (llmResult.match === true && llmResult.confidence >= 80) {
              match.matchScore = Math.min(100, match.matchScore + 10);
              match.llmBonus = 10;
            }
          } else {
            match.llmValidated = false;
            match.llmError = llmResult.error;
          }
        }
      } catch (ignore) {}
    }
  }

  matches.sort(function(a, b) { return b.matchScore - a.matchScore; });
  return { matches: matches.slice(0, 200) };
}

// LLM judge for match validation
async function callLlmJudge(ozonItem, candidate) {
  try {
    const ozonTitle = String(ozonItem.title || "");
    const candTitle = String(candidate.title || "");
    const ozonPrice = Number(ozonItem.price || 0);
    const candPrice = Number(candidate.priceMin || 0);
    const result = await callAiTask({
      taskType: "match_candidate_basic",
      systemPrompt: '你是跨境选品匹配专家。判断Ozon商品和1688商品是否是同一品类。只输出JSON: {"match":true/false,"confidence":0-100,"reason":"简短原因"}',
      userPrompt: "Ozon: " + ozonTitle + "(" + ozonPrice + "RUB)\n1688: " + candTitle + "(" + candPrice + "CNY)\n\n是同一品类吗？",
      responseFormat: "json",
      temperature: 0.1,
      maxTokens: 200,
    });
    if (!result.ok) return { ok: false, error: result.error || "AI not configured" };
    const parsed = result.json || JSON.parse(result.content.replace(/```(?:json)?\s*([\s\S]*?)```/i, "$1").trim());
    return { ok: true, match: Boolean(parsed.match), confidence: Number(parsed.confidence) || 0, reason: String(parsed.reason || "") };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}



