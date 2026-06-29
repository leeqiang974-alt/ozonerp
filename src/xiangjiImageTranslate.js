import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_FILE = path.join(process.cwd(), "data", "xiangji-config.json");
const API_URL = "https://api.tosoiot.com";

async function readConfig() {
  try {
    const text = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex").toLowerCase();
}

function contentRows(data) {
  const content = data?.Data?.Content || data?.data?.content || data?.data?.Content || data?.Content || [];
  if (Array.isArray(content)) return content;
  return Object.values(content || {});
}

export async function translateImageUrls(urls = []) {
  const config = await readConfig();
  if (!config?.enabled) {
    return { enabled: false, reason: "xiangji_disabled", images: [] };
  }
  const userKey = String(config.userKey || "").trim();
  const imgTransKey = String(config.imgTransKey || "").trim();
  if (!userKey || !imgTransKey) {
    return { enabled: false, reason: "missing_user_key_or_img_trans_key", images: [] };
  }
  const cleanUrls = [...new Set((urls || []).filter(Boolean))];
  if (!cleanUrls.length) return { enabled: true, images: [] };

  const commitTime = Math.floor(Date.now() / 1000).toString();
  const params = new URLSearchParams({
    Action: "GetImageTranslateBatch",
    SourceLanguage: config.sourceLanguage || "CHS",
    TargetLanguage: config.targetLanguage || "RUS",
    Urls: cleanUrls.join(","),
    ImgTransKey: imgTransKey,
    CommitTime: commitTime,
    Sign: md5(`${commitTime}_${userKey}_${imgTransKey}`),
    Sync: String(config.sync || 1),
    EngineType: String(config.engineType || 0),
    NeedWatermark: "0",
    NeedRmUrl: "1",
    Qos: config.qos || "BestQuality",
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok || ![0, 101, 200].includes(Number(data.Code ?? data.code))) {
    throw new Error(`象寄图片翻译失败：${data.Message || data.msg || response.statusText}`);
  }

  const rows = contentRows(data);
  const images = rows.map((row) => ({
    sourceUrl: row.OriginUrl || row.originUrl || row.OriginSslUrl || "",
    translatedUrl: row.SslUrl || row.Url || row.sslUrl || row.url || "",
    requestId: row.RequestId || row.requestId || "",
    code: row.Code ?? row.code,
    raw: row,
  })).filter((row) => row.translatedUrl);
  return { enabled: true, raw: data, images };
}
