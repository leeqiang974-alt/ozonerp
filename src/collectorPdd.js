const IMAGE_RE = /https?:\\?\/\\?\/[^"'\s<>]+?(?:\.jpg|\.jpeg|\.png|\.webp)(?:[^"'\s<>]*)?/gi;

export function parsePddProduct({ url = "", html = "", hints = {} } = {}) {
  const cleanHtml = String(html || "");
  const title = productTitle(
    hints.title
    || meta(cleanHtml, "og:title")
    || meta(cleanHtml, "title")
    || match(cleanHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
    || match(cleanHtml, /<title[^>]*>([\s\S]*?)<\/title>/i)
  ).replace(/\s*[-_].*拼多多.*$/i, "");
  const images = pickImages(cleanHtml, hints);
  const attributes = normalizeAttributes(hints.attributes);
  const skuVariants = normalizeVariants(hints.skuVariants, hints.price, images);
  const sizeWeight = normalizePackageInfo(hints.packageInfo || hints.sizeWeight || {});
  const goodsId = pddGoodsId(url || hints.url || "");

  return {
    source: "pdd",
    sourcePlatform: "拼多多",
    goodsId,
    url,
    title,
    skuProps: [],
    skuVariants,
    images,
    detail: {
      text: cleanupText(hints.description || meta(cleanHtml, "description") || ""),
      html: "",
    },
    video: normalizeVideo(hints.video),
    detailImages: (hints.detailImages || []).map(normalizeImage).filter(Boolean),
    attributes,
    sizeWeight,
    ozonDraft: toOzonDraft({ title, images, attributes, skuVariants, sizeWeight }),
    warnings: buildWarnings({ title, images, skuVariants, attributes, sizeWeight }),
  };
}

function pddGoodsId(url = "") {
  const value = String(url || "");
  const patterns = [
    /[?&]goods_id=(\d+)/i,
    /[?&]goodsId=(\d+)/i,
    /\/goods(?:\.html)?\/?(\d{5,})/i,
    /\/goods_detail\/(\d{5,})/i,
  ];
  for (const pattern of patterns) {
    const result = value.match(pattern);
    if (result) return result[1];
  }
  return "";
}

function productTitle(value) {
  const title = cleanupText(value).replace(/\s*[-_].*拼多多.*$/i, "");
  if (!title || title.length < 6) return "";
  if (/^拼多多$|登录|验证码|安全验证|个人中心|商品详情/i.test(title)) return "";
  return title;
}

function pickImages(html, hints) {
  const set = new Set();
  for (const raw of hints.images || []) addImage(set, raw);
  for (const raw of html.match(IMAGE_RE) || []) addImage(set, raw);
  return [...set].filter(isLikelyPddImage).slice(0, 80);
}

function normalizeAttributes(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      name: cleanupText(item.name || item.key || ""),
      value: cleanupText(item.value || item.val || ""),
    }))
    .filter((item) => item.name && item.value)
    .slice(0, 120);
}

function normalizeVariants(items, fallbackPrice, images) {
  const variants = Array.isArray(items) ? items : [];
  const normalized = variants
    .map((item, index) => ({
      skuId: cleanupText(item.skuId || item.sku_id || item.id || ""),
      spec: cleanupText(item.spec || item.specText || item.name || item.label || ""),
      price: firstNumber(item.price || item.salePrice || item.groupPrice || fallbackPrice),
      stock: firstNumber(item.stock || item.quantity || item.stockQuantity),
      image: normalizeImage(item.image || item.imageUrl || images[index] || ""),
      weightG: firstNumber(item.weightG),
      lengthMm: firstNumber(item.lengthMm),
      widthMm: firstNumber(item.widthMm),
      heightMm: firstNumber(item.heightMm),
    }))
    .filter((item) => item.skuId || item.spec || item.price || item.image);
  if (normalized.length) return dedupeBy(normalized, (item) => `${item.skuId}:${item.spec}:${item.price}:${item.image}`).slice(0, 300);
  const price = firstNumber(fallbackPrice);
  return price ? [{
    skuId: "",
    spec: "默认规格",
    price,
    stock: "",
    image: images[0] || "",
    weightG: "",
    lengthMm: "",
    widthMm: "",
    heightMm: "",
  }] : [];
}

function normalizePackageInfo(input) {
  return {
    weightG: firstNumber(input.weightG || input.weight),
    lengthMm: firstNumber(input.lengthMm || input.length),
    widthMm: firstNumber(input.widthMm || input.width),
    heightMm: firstNumber(input.heightMm || input.height),
  };
}

function toOzonDraft({ title, images, attributes, skuVariants, sizeWeight }) {
  const first = skuVariants[0] || {};
  return {
    name: title,
    offer_id: first.skuId ? `pdd-${first.skuId}` : "",
    price: first.price || "",
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
  if (!result.title) warnings.push("未解析到标题，请在已登录拼多多商品页用插件读取页面。");
  if (!result.images.length) warnings.push("未解析到图片，拼多多页面可能未加载完成或需要登录。");
  if (!result.skuVariants.length) warnings.push("未解析到 SKU/价格，上架前需要人工补齐。");
  if (!result.sizeWeight.weightG || !result.sizeWeight.lengthMm || !result.sizeWeight.widthMm || !result.sizeWeight.heightMm) {
    warnings.push("未解析到完整包装尺寸，上架前必须补齐尺重。");
  }
  return warnings;
}

function normalizeVideo(value) {
  if (!value) return null;
  if (typeof value === "string") return value ? { url: value } : null;
  const url = value.url || value.videoUrl || "";
  return url ? { url, coverUrl: value.coverUrl || "", title: value.title || "", videoId: value.videoId || "" } : null;
}

function addImage(set, value) {
  const image = normalizeImage(value);
  if (image) set.add(image);
}

function normalizeImage(value) {
  if (!value || typeof value !== "string") return "";
  let image = value.replaceAll("\\/", "/").replace(/^\/\//, "https://");
  image = image.replace(/[?#].*$/, "");
  if (!/^https?:\/\//i.test(image)) return "";
  if (!/\.(jpg|jpeg|png|webp)$/i.test(image)) return "";
  return image;
}

function isLikelyPddImage(image) {
  return /pddpic\.com|pinduoduo\.com|yangkeduo\.com/i.test(image) && !/avatar|logo|icon|sprite/i.test(image);
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

function stripTags(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function meta(html, name) {
  return match(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["']`, "i"));
}

function match(text, regex) {
  const result = regex.exec(text);
  return result ? result[1] : "";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = typeof value === "string" ? Number(value.match(/\d+(?:\.\d+)?/)?.[0]) : Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return "";
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
