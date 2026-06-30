const IMAGE_RE = /https?:\\?\/\\?\/[^"'\s<>]+?(?:\.jpg|\.jpeg|\.png|\.webp)(?:[^"'\s<>]*)?/gi;

export function parsePddProduct({ url = "", html = "", hints = {} } = {}) {
  const cleanHtml = String(html || "");
  const embedded = extractEmbeddedPddData(cleanHtml);
  const title = productTitle(
    hints.title
    || embedded.title
    || meta(cleanHtml, "og:title")
    || meta(cleanHtml, "title")
    || match(cleanHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
    || match(cleanHtml, /<title[^>]*>([\s\S]*?)<\/title>/i)
  ).replace(/\s*[-_].*拼多多.*$/i, "");
  const images = pickImages(cleanHtml, hints, embedded);
  const attributes = normalizeAttributes(hints.attributes);
  const skuVariants = normalizeVariants(
    Array.isArray(hints.skuVariants) && hints.skuVariants.length ? hints.skuVariants : embedded.skuVariants,
    hints.price || embedded.price,
    images
  );
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
    detailImages: dedupe([...(hints.detailImages || []), ...(embedded.detailImages || [])].map(normalizeImage).filter(Boolean)),
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

function pickImages(html, hints, embedded = {}) {
  const set = new Set();
  for (const raw of hints.images || []) addImage(set, raw);
  for (const raw of embedded.images || []) addImage(set, raw);
  if (!set.size) {
    for (const raw of html.match(IMAGE_RE) || []) addImage(set, raw);
  }
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
  const inferredPrice = firstPddPrice(fallbackPrice, ...variants.map((item) => item.price || item.salePrice || item.groupPrice));
  const normalized = variants
    .map((item, index) => ({
      skuId: cleanupText(item.skuId || item.sku_id || item.id || ""),
      spec: cleanupPddVariantSpec(item.spec || item.specText || item.name || item.label || ""),
      price: firstPddPrice(item.price || item.salePrice || item.groupPrice || inferredPrice),
      stock: firstNumber(item.stock || item.quantity || item.stockQuantity),
      image: normalizeImage(item.image || item.imageUrl || images[index] || ""),
      weightG: firstNumber(item.weightG),
      lengthMm: firstNumber(item.lengthMm),
      widthMm: firstNumber(item.widthMm),
      heightMm: firstNumber(item.heightMm),
    }))
    .filter((item) => isLikelyPddVariantSpec(item.spec))
    .filter((item) => item.skuId || item.spec || item.price || item.image);
  if (normalized.length) return dedupeBy(normalized, (item) => `${item.skuId}:${item.spec}:${item.price}:${item.image}`).slice(0, 300);
  const price = firstPddPrice(fallbackPrice, inferredPrice);
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
  return /pddpic\.com|pinduoduo\.com|yangkeduo\.com/i.test(image)
    && !/avatar|logo|icon|sprite|coupon|promotion|brand|ddpay|oms_img_ng|funimg|garner-api|pdd_ims|img_check/i.test(image);
}

function isLikelyPddVariantSpec(value) {
  const text = cleanupText(value);
  if (!text) return true;
  if (text.length > 40) return false;
  if (/^¥?\s*\d+(?:\.\d+)?$/.test(text)) return false;
  if (/大促价|券后|满\d+减|件\d+\.?\d*折|^\d+(?:\.\d+)?折|买了又买|拼单|即将结束|立刻拼|这些人已拼|我拼过的店|人已拼/.test(text)) return false;
  if (/满\d+返|返\d+|优惠|券|活动|促销/.test(text)) return false;
  if (/畅销榜|榜第\d+名/.test(text)) return false;
  if (/查看|确定|顶部|首页|帮助|反馈|进店|价格说明|历史浏览|更多|开始采集|找货源|确认采集|采集本页|采集到\s*ERP|跳过/.test(text)) return false;
  if (/退货|运费|包邮|无理由/.test(text)) return false;
  if (/质量|外观|实用|包装|做工|态度|回头客|效果|评价|物美价廉|可爱|精致|异味|手感|模具很好|大小合适|尺码合适|美观|走的挺准|使用方便|已抢\d+件|物流|材质|好用|耐用|份量/.test(text)) return false;
  if (/^(颜色|色号|款式|规格|尺寸|型号|大小|容量|属性|参数)$/.test(text)) return false;
  if (/默认配|螺丝孔距离|孔距是|安装说明|适用范围/.test(text)) return false;
  if (/[（(]\d+[）)]$/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (/^[\d\s,，.]+$/.test(text)) return false;
  return true;
}

function cleanupPddVariantSpec(value) {
  return cleanupText(value).replace(/(?:即将售罄|库存紧张|仅剩\d+件|马上抢光|热卖)$/g, "").trim();
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

function extractEmbeddedPddData(html = "") {
  const title = firstEmbeddedString(html, [
    "goodsName",
    "goods_name",
    "goodsTitle",
    "goods_title",
    "productName",
    "product_name",
    "shareTitle",
    "share_title",
  ]);
  const price = firstEmbeddedString(html, [
    "price",
    "minPrice",
    "min_price",
    "groupPrice",
    "group_price",
    "normalPrice",
  ]);
  return {
    title,
    price,
    images: embeddedImagesByKeys(html, ["goodsGallery", "goods_gallery", "gallery", "imageGallery", "topGallery"]),
    detailImages: embeddedImagesByKeys(html, ["detailGallery", "detail_gallery", "detailImages", "detail_images", "descImages"]),
    skuVariants: embeddedSkuVariants(html),
  };
}

function firstEmbeddedString(html, keys) {
  for (const key of keys) {
    const patterns = [
      new RegExp(`["']${escapeRegExp(key)}["']\\s*:\\s*["']((?:\\\\.|[^"'\\\\]){1,300})["']`, "i"),
      new RegExp(`\\b${escapeRegExp(key)}\\b\\s*:\\s*["']((?:\\\\.|[^"'\\\\]){1,300})["']`, "i"),
      new RegExp(`${escapeRegExp(key)}\\s*=\\s*["']((?:\\\\.|[^"'\\\\]){1,300})["']`, "i"),
    ];
    for (const pattern of patterns) {
      const value = decodeJsonishString(match(html, pattern));
      if (value) return cleanupText(value);
    }
  }
  return "";
}

function embeddedImagesByKeys(html = "", keys = []) {
  const images = [];
  for (const key of keys) {
    const patterns = [
      new RegExp(`["']${escapeRegExp(key)}["']\\s*:\\s*\\[([\\s\\S]{0,8000}?)\\]`, "i"),
      new RegExp(`\\b${escapeRegExp(key)}\\b\\s*:\\s*\\[([\\s\\S]{0,8000}?)\\]`, "i"),
    ];
    for (const pattern of patterns) {
      const body = match(html, pattern);
      if (body) images.push(...(body.match(IMAGE_RE) || []).map(decodeJsonishString));
    }
  }
  return dedupe(images.map(normalizeImage).filter(isLikelyPddImage));
}

function embeddedSkuVariants(html = "") {
  const variants = [];
  const arrays = embeddedArrayBodies(html, ["sku", "skus", "skuList", "sku_list", "skuVariants", "sku_variants"]);
  for (const body of arrays) {
    for (const objectText of body.match(/\{[\s\S]*?\}/g) || []) {
      const spec = firstEmbeddedString(objectText, ["spec", "specText", "skuName", "sku_name", "name", "label"]);
      const skuId = firstEmbeddedString(objectText, ["skuId", "sku_id", "id"]);
      const price = firstEmbeddedString(objectText, ["price", "salePrice", "sale_price", "groupPrice", "group_price"]);
      const image = firstEmbeddedString(objectText, ["thumbUrl", "thumb_url", "imageUrl", "image_url", "skuImageUrl", "sku_image_url"]);
      if (spec || skuId || price || image) variants.push({ skuId, spec, price, image });
    }
  }
  return variants;
}

function embeddedArrayBodies(html = "", keys = []) {
  const bodies = [];
  for (const key of keys) {
    const patterns = [
      new RegExp(`["']${escapeRegExp(key)}["']\\s*:\\s*\\[([\\s\\S]{0,12000}?)\\]`, "i"),
      new RegExp(`\\b${escapeRegExp(key)}\\b\\s*:\\s*\\[([\\s\\S]{0,12000}?)\\]`, "i"),
    ];
    for (const pattern of patterns) {
      const body = match(html, pattern);
      if (body) bodies.push(body);
    }
  }
  return bodies;
}

function decodeJsonishString(value = "") {
  const text = String(value || "");
  if (!text) return "";
  try {
    return JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
  } catch {
    return text.replace(/\\\//g, "/").replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
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

function firstPddPrice(...values) {
  for (const value of values) {
    const number = typeof value === "string" ? Number(value.match(/\d+(?:\.\d+)?/)?.[0]) : Number(value);
    if (Number.isFinite(number) && number > 0 && number < 100000) return number;
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

function dedupe(items) {
  return [...new Set(items)];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
