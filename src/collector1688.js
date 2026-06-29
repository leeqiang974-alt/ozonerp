const IMAGE_RE = /https?:\\?\/\\?\/[^"'\\\s<>]+?(?:\.jpg|\.jpeg|\.png|\.webp)(?:[^"'\\\s<>]*)?/gi;

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
  const attributes = normalizeAttributes(hints.attributes).length
    ? normalizeAttributes(hints.attributes)
    : pickAttributes(cleanHtml, jsonObjects);
  const skuProps = pickSkuProps(jsonObjects);
  const skuVariants = pickSkuVariants(jsonObjects, skuProps, attributes, hints);
  const sizeWeight = pickSizeWeight(cleanHtml, jsonObjects, attributes, hints);

  return {
    source: "1688",
    url,
    title,
    skuProps,
    skuVariants,
    images,
    detail: {
      text: description,
      html: pickDetailHtml(cleanHtml),
    },
    video: normalizeVideo(hints.video),
    detailImages: (hints.detailImages || []).map(normalizeImage).filter(Boolean),
    attributes,
    sizeWeight,
    ozonDraft: toOzonDraft({ title, images, attributes, skuVariants, sizeWeight }),
    warnings: buildWarnings({ title, images, skuVariants, attributes, sizeWeight }),
  };
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
    .replace(/&quot;.*$/i, "")
    .replace(/\).*$/i, "")
    .replace(/^\/\//, "https://");
  image = image.replace(/(?:_|\.)((?:\d+x\d+)|sum|search|summ|webp).*$/i, "");
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

function pickDetailHtml(html) {
  const candidate = match(html, /<div[^>]+(?:id|class)=["'][^"']*(?:desc|detail|description)[^"']*["'][^>]*>([\s\S]{100,20000}?)<\/div>/i);
  return candidate || "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
