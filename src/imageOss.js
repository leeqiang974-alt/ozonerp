import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import OSS from "ali-oss";
import { translateImageUrls } from "./xiangjiImageTranslate.js";

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_FILE = path.join(DATA_DIR, "oss-config.json");
const MAP_FILE = path.join(DATA_DIR, "image-cache-map.json");
const CACHE_DIR = path.join(DATA_DIR, "image-cache");
const execFileAsync = promisify(execFile);
const OCR_PYTHON = process.env.OZON_ERP_OCR_PYTHON || "D:\\OzonERP\\python-venv\\Scripts\\python.exe";
const OCR_MODEL_DIR = process.env.EASYOCR_MODEL_DIR || "D:\\OzonERP\\easyocr-models";

const FACTORY_TEXT_RE = /工厂|厂房|车间|公司简介|企业介绍|厂家直销|源头厂家|实力商家|联系我们|联系电话|电话|微信|地址|扫码|营业执照|生产设备|仓库实拍|工厂实拍|厂区|展厅|团队|客服|производств|завод|фабрик|factory|manufacturer|wholesale/i;
const OZON_IMAGE_POLICY_TEXT_RE = /配送|发货|发出|包邮|免邮|运费|物流|快递|退货|退换|退款|售后|保修|质保|到货|时效|delivery|shipping|ship|return|refund|warranty|free\s*shipping|доставк|бесплатн\w*\s+доставк|возврат|возврат\w*|гаранти|срок\w*\s+доставк/i;
const CHINESE_RE = /[\u3400-\u9fff]/;
const MIN_PUBLIC_IMAGE_BYTES = 1024;

async function readJson(file, fallback) {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function extensionFrom(url, contentType = "") {
  const fromUrl = String(url || "").match(/\.(jpg|jpeg|png|webp)(?:\?|$)/i)?.[1];
  if (fromUrl) return fromUrl.toLowerCase() === "jpeg" ? "jpg" : fromUrl.toLowerCase();
  if (/png/i.test(contentType)) return "png";
  if (/webp/i.test(contentType)) return "webp";
  return "jpg";
}

function normalizeSourceUrl(url = "") {
  return String(url || "")
    .trim()
    .replace(/\.jpg_b\.jpg$/i, ".jpg")
    .replace(/\.jpeg_b\.jpg$/i, ".jpeg")
    .replace(/\.png_b\.jpg$/i, ".png")
    .replace(/_+$/i, "");
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 OzonERP/1.0",
      Referer: "https://detail.1688.com/",
    },
  });
  if (!response.ok) throw new Error(`图片下载失败 ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/^image\//i.test(contentType)) throw new Error(`不是图片响应：${contentType || "unknown"}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("图片内容为空");
  return { bytes, contentType, ext: extensionFrom(url, contentType) };
}

async function verifyPublicImageUrl(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 OzonERP/1.0",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      return { ok: false, reason: "http_error", status: response.status, contentType, byteLength: bytes.length };
    }
    if (!/^image\//i.test(contentType)) {
      return { ok: false, reason: "not_image", status: response.status, contentType, byteLength: bytes.length };
    }
    if (bytes.length < MIN_PUBLIC_IMAGE_BYTES) {
      return { ok: false, reason: "too_small", status: response.status, contentType, byteLength: bytes.length };
    }
    return { ok: true, status: response.status, contentType, byteLength: bytes.length };
  } catch (error) {
    return { ok: false, reason: "request_failed", message: error.message };
  }
}

export function classifyOzonImageText(text = "") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return {
    hasChinese: CHINESE_RE.test(normalized),
    isFactoryIntro: FACTORY_TEXT_RE.test(normalized),
    hasOzonPolicyText: OZON_IMAGE_POLICY_TEXT_RE.test(normalized),
  };
}

async function analyzeImageText(localPath) {
  try {
    const { stdout } = await execFileAsync(OCR_PYTHON, [path.join(process.cwd(), "src", "image_ocr.py"), localPath], {
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        EASYOCR_MODEL_DIR: OCR_MODEL_DIR,
      },
    });
    const data = JSON.parse(stdout || "{}");
    const text = (data.texts || []).map((item) => item.text).join(" ");
    const classified = classifyOzonImageText(text);
    return {
      available: Boolean(data.available),
      text,
      texts: data.texts || [],
      ...classified,
      error: data.error || "",
    };
  } catch (error) {
    return {
      available: false,
      text: "",
      texts: [],
      hasChinese: false,
      isFactoryIntro: false,
      hasOzonPolicyText: false,
      error: error.message,
    };
  }
}

async function createOssClient() {
  const config = await readJson(CONFIG_FILE, null);
  if (!config?.bucket || !config?.region || !config?.accessKeyId || !config?.accessKeySecret) {
    throw new Error("OSS 配置不完整，请检查 data/oss-config.json");
  }
  return {
    config,
    client: new OSS({
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    }),
  };
}

async function uploadDownloadedImage(client, publicBaseUrl, objectName, downloaded) {
  await client.put(objectName, downloaded.bytes, {
    headers: {
      "Content-Type": downloaded.contentType,
      "Cache-Control": "public, max-age=31536000",
      "x-oss-object-acl": "public-read",
    },
  });
  const url = `${publicBaseUrl}/${objectName}`;
  const publicCheck = await verifyPublicImageUrl(url);
  if (!publicCheck.ok) {
    const reason = publicCheck.reason || "public_check_failed";
    throw new Error(`OSS 图片公网校验失败：${reason}`);
  }
  return { url, publicCheck };
}

async function translateAndUploadImage({ sourceUrl, hash, ocr, cache, client, prefix, publicBaseUrl }) {
  try {
    const translated = await translateImageUrls([sourceUrl]);
    if (!translated.enabled) {
      return { skipped: true, reason: "needs_translation", translation: { reason: translated.reason } };
    }
    const translatedUrl = translated.images?.[0]?.translatedUrl;
    if (!translatedUrl) {
      return { skipped: true, reason: "needs_translation", translation: { reason: "no_translated_url", raw: translated.raw } };
    }
    const downloaded = await downloadImage(translatedUrl);
    const localPath = path.join(CACHE_DIR, `${hash}-ru.${downloaded.ext}`);
    await writeFile(localPath, downloaded.bytes);
    const translatedOcr = await analyzeImageText(localPath);
    if (translatedOcr?.isFactoryIntro || translatedOcr?.hasOzonPolicyText) {
      cache[sourceUrl] = {
        skipped: true,
        reason: translatedOcr.isFactoryIntro ? "factory_intro" : "ozon_image_policy_text",
        localPath,
        translatedUrl,
        ocr,
        translatedOcr,
        ozonImageOcr: translatedOcr,
        updatedAt: new Date().toISOString(),
      };
      return {
        skipped: true,
        reason: translatedOcr.isFactoryIntro ? "factory_intro" : "ozon_image_policy_text",
        ocr,
        translatedOcr,
      };
    }
    const objectName = `${prefix}${hash}-ru.${downloaded.ext}`;
    const uploaded = await uploadDownloadedImage(client, publicBaseUrl, objectName, downloaded);
    cache[sourceUrl] = {
      url: uploaded.url,
      objectName,
      localPath,
      contentType: downloaded.contentType,
      translated: true,
      translatedUrl,
      ocr,
      translatedOcr,
      ozonImageOcr: translatedOcr,
      publicCheck: uploaded.publicCheck,
      updatedAt: new Date().toISOString(),
    };
    return { url: uploaded.url, translated: true, translatedUrl, ocr, translatedOcr, publicCheck: uploaded.publicCheck };
  } catch (error) {
    return {
      skipped: true,
      reason: "needs_translation",
      translation: { reason: "translate_error", message: error.message },
    };
  }
}

export async function prepareOzonImages(urls = [], options = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const uniqueUrls = [...new Set((urls || []).map(normalizeSourceUrl).filter(Boolean))];
  const cache = await readJson(MAP_FILE, {});
  const { config, client } = await createOssClient();
  const prefix = String(config.prefix || "ozon-erp/").replace(/^\/+/, "");
  const publicBaseUrl = String(config.publicBaseUrl || `https://${config.bucket}.${config.region}.aliyuncs.com`).replace(/\/+$/, "");
  const results = [];

  for (const sourceUrl of uniqueUrls) {
    if (sourceUrl.startsWith(publicBaseUrl)) {
      const publicCheck = await verifyPublicImageUrl(sourceUrl);
      if (!publicCheck.ok) {
        results.push({ sourceUrl, skipped: true, reason: "public_url_failed", publicCheck, cached: true });
        continue;
      }
      results.push({ sourceUrl, url: sourceUrl, cached: true, publicCheck });
      continue;
    }
    if (cache[sourceUrl]?.skipped && !(options.translateChinese && cache[sourceUrl].reason === "needs_translation")) {
      results.push({
        sourceUrl,
        skipped: true,
        reason: cache[sourceUrl].reason,
        ocr: cache[sourceUrl].ocr,
        cached: true,
      });
      continue;
    }
    if (cache[sourceUrl]?.url) {
      if (options.ocr && cache[sourceUrl].localPath && !cache[sourceUrl].ocr) {
        const ocr = await analyzeImageText(cache[sourceUrl].localPath);
        cache[sourceUrl].ocr = ocr;
        if (ocr?.isFactoryIntro || ocr?.hasOzonPolicyText) {
          cache[sourceUrl].skipped = true;
          cache[sourceUrl].reason = ocr.isFactoryIntro ? "factory_intro" : "ozon_image_policy_text";
          results.push({ sourceUrl, skipped: true, reason: cache[sourceUrl].reason, ocr, cached: true });
          continue;
        }
        if (ocr?.hasChinese && options.blockChinese !== false) {
          if (options.translateChinese) {
            const translated = await translateAndUploadImage({ sourceUrl, hash: crypto.createHash("sha256").update(sourceUrl).digest("hex"), ocr, cache, client, prefix, publicBaseUrl });
            results.push({ sourceUrl, cached: true, ...translated });
            continue;
          }
          cache[sourceUrl].skipped = true;
          cache[sourceUrl].reason = "needs_translation";
          results.push({ sourceUrl, skipped: true, reason: "needs_translation", ocr, cached: true });
          continue;
        }
      }
      if (
        options.translateChinese
        && cache[sourceUrl].ocr?.hasChinese
        && !cache[sourceUrl].translated
        && options.blockChinese !== false
      ) {
        const translated = await translateAndUploadImage({
          sourceUrl,
          hash: crypto.createHash("sha256").update(sourceUrl).digest("hex"),
          ocr: cache[sourceUrl].ocr,
          cache,
          client,
          prefix,
          publicBaseUrl,
        });
        results.push({ sourceUrl, cached: true, ...translated });
        continue;
      }
      if (options.ocr && cache[sourceUrl].localPath) {
        var outputOcr = cache[sourceUrl].ozonImageOcr || cache[sourceUrl].translatedOcr || (!cache[sourceUrl].translated ? cache[sourceUrl].ocr : null);
        if (!outputOcr) {
          outputOcr = await analyzeImageText(cache[sourceUrl].localPath);
          cache[sourceUrl].ozonImageOcr = outputOcr;
        }
        if (outputOcr?.isFactoryIntro || outputOcr?.hasOzonPolicyText) {
          cache[sourceUrl].skipped = true;
          cache[sourceUrl].reason = outputOcr.isFactoryIntro ? "factory_intro" : "ozon_image_policy_text";
          results.push({ sourceUrl, skipped: true, reason: cache[sourceUrl].reason, ocr: cache[sourceUrl].ocr || null, ozonImageOcr: outputOcr, cached: true });
          continue;
        }
      }
      const publicCheck = await verifyPublicImageUrl(cache[sourceUrl].url);
      if (!publicCheck.ok) {
        cache[sourceUrl].skipped = true;
        cache[sourceUrl].reason = "public_url_failed";
        cache[sourceUrl].publicCheck = publicCheck;
        results.push({ sourceUrl, skipped: true, reason: "public_url_failed", publicCheck, cached: true, ocr: cache[sourceUrl].ocr || null });
        continue;
      }
      cache[sourceUrl].publicCheck = publicCheck;
      cache[sourceUrl].publicVerifiedAt = new Date().toISOString();
      results.push({ sourceUrl, url: cache[sourceUrl].url, cached: true, ocr: cache[sourceUrl].ocr || null, publicCheck });
      continue;
    }
    if (cache[sourceUrl]?.skipped && options.translateChinese && cache[sourceUrl].reason === "needs_translation") {
      const translated = await translateAndUploadImage({
        sourceUrl,
        hash: crypto.createHash("sha256").update(sourceUrl).digest("hex"),
        ocr: cache[sourceUrl].ocr || null,
        cache,
        client,
        prefix,
        publicBaseUrl,
      });
      results.push({ sourceUrl, cached: true, ...translated });
      continue;
    }

    const hash = crypto.createHash("sha256").update(sourceUrl).digest("hex");
    const downloaded = await downloadImage(sourceUrl);
    const localPath = path.join(CACHE_DIR, `${hash}.${downloaded.ext}`);
    await writeFile(localPath, downloaded.bytes);

    const ocr = options.ocr ? await analyzeImageText(localPath) : null;
    if (ocr && !ocr.available) {
      results.push({ sourceUrl, ocr, ocrUnavailable: true });
    }
    if (ocr?.isFactoryIntro || ocr?.hasOzonPolicyText) {
      cache[sourceUrl] = {
        skipped: true,
        reason: ocr.isFactoryIntro ? "factory_intro" : "ozon_image_policy_text",
        localPath,
        ocr,
        updatedAt: new Date().toISOString(),
      };
      results.push({ sourceUrl, skipped: true, reason: cache[sourceUrl].reason, ocr });
      continue;
    }
    if (ocr?.hasChinese && options.blockChinese !== false) {
      if (options.translateChinese) {
        const translated = await translateAndUploadImage({ sourceUrl, hash, ocr, cache, client, prefix, publicBaseUrl });
        results.push({ sourceUrl, ...translated });
        continue;
      }
      cache[sourceUrl] = {
        skipped: true,
        reason: "needs_translation",
        localPath,
        ocr,
        updatedAt: new Date().toISOString(),
      };
      results.push({ sourceUrl, skipped: true, reason: "needs_translation", ocr });
      continue;
    }

    const objectName = `${prefix}${hash}.${downloaded.ext}`;
    const uploaded = await uploadDownloadedImage(client, publicBaseUrl, objectName, downloaded);
    cache[sourceUrl] = {
      url: uploaded.url,
      objectName,
      localPath,
      contentType: downloaded.contentType,
      ozonImageOcr: ocr,
      publicCheck: uploaded.publicCheck,
      publicVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    results.push({ sourceUrl, url: uploaded.url, cached: false, publicCheck: uploaded.publicCheck });
  }

  await writeFile(MAP_FILE, JSON.stringify(cache, null, 2), "utf8");
  return { images: results };
}
