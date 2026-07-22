import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
// Category/type dictionaries change independently of the ERP process.  A
// cached tree without a freshness signal must not silently look like current
// Ozon evidence.  The default is deliberately conservative but configurable
// for operators who have a documented refresh cadence.
const DEFAULT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function categoryCacheFile() {
  return process.env.OZON_CATEGORY_CACHE_FILE || path.join(DATA_DIR, "ozon-category-cache.json");
}

export async function loadCategoryCache() {
  try {
    return normalizeCategoryCache(JSON.parse(await readFile(categoryCacheFile(), "utf8")));
  } catch {
    return normalizeCategoryCache({});
  }
}

export async function saveCategoryCache(cache) {
  const file = categoryCacheFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, JSON.stringify(normalizeCategoryCache(cache), null, 2), "utf8");
  await renameFile(tmp, file);
}

/**
 * Return a seller-safe freshness contract for a category cache.  This is a
 * local signal only: `fresh` means the cache is within the configured age,
 * not that Ozon has been contacted now.  Missing/invalid timestamps stay
 * unusable so category matching cannot be mistaken for current platform
 * evidence.
 */
export function inspectCategoryCacheFreshness(cache = {}, {
  now = Date.now(),
  maxAgeMs = Number(process.env.OZON_CATEGORY_CACHE_MAX_AGE_MS || DEFAULT_CACHE_MAX_AGE_MS),
} = {}) {
  const updatedAt = String(cache?.updatedAt || "").trim();
  const updatedMs = Date.parse(updatedAt);
  const ageLimit = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : DEFAULT_CACHE_MAX_AGE_MS;
  if (!updatedAt || !Number.isFinite(updatedMs)) {
    return { status: "unknown", reasonCode: "CATEGORY_CACHE_TIMESTAMP_MISSING", updatedAt, ageMs: null, maxAgeMs: ageLimit, usable: false };
  }
  const ageMs = Number(now) - updatedMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { status: "unknown", reasonCode: "CATEGORY_CACHE_TIMESTAMP_INVALID", updatedAt, ageMs: Number.isFinite(ageMs) ? ageMs : null, maxAgeMs: ageLimit, usable: false };
  }
  if (ageMs > ageLimit) {
    return { status: "stale", reasonCode: "CATEGORY_CACHE_STALE", updatedAt, ageMs, maxAgeMs: ageLimit, usable: false };
  }
  return { status: "fresh", reasonCode: "", updatedAt, ageMs, maxAgeMs: ageLimit, usable: true };
}

export function attributeValueCacheKey({
  descriptionCategoryId = 0,
  typeId = 0,
  attributeId = 0,
  language = "ZH_HANS",
} = {}) {
  return [
    Number(descriptionCategoryId || 0),
    Number(typeId || 0),
    Number(attributeId || 0),
    String(language || "ZH_HANS"),
  ].join(":");
}

export async function upsertAttributeValuesCache({
  storeId = "",
  descriptionCategoryId = 0,
  typeId = 0,
  attributeId = 0,
  language = "ZH_HANS",
  values = [],
  operationEvidence = null,
} = {}) {
  const cache = await loadCategoryCache();
  const key = attributeValueCacheKey({ descriptionCategoryId, typeId, attributeId, language });
  const updatedAt = new Date().toISOString();
  const next = {
    ...cache,
    updatedAt: cache.updatedAt || updatedAt,
    storeId: storeId || cache.storeId || "",
    attributeValues: {
      ...(cache.attributeValues || {}),
      [key]: {
        storeId: storeId || cache.storeId || "",
        descriptionCategoryId: Number(descriptionCategoryId || 0),
        typeId: Number(typeId || 0),
        attributeId: Number(attributeId || 0),
        language: String(language || "ZH_HANS"),
        updatedAt,
        values: Array.isArray(values) ? values : [],
      },
    },
    categoryReadEvidence: {
      ...(cache.categoryReadEvidence || {}),
      attributeValues: {
        ...(cache.categoryReadEvidence?.attributeValues || {}),
        ...(operationEvidence ? { [key]: operationEvidence } : {}),
      },
    },
  };
  await saveCategoryCache(next);
  return next.attributeValues[key];
}

function normalizeCategoryCache(cache = {}) {
  return {
    updatedAt: cache.updatedAt || "",
    storeId: cache.storeId || "",
    tree: Array.isArray(cache.tree) ? cache.tree : [],
    flat: Array.isArray(cache.flat) ? cache.flat : [],
    attributes: cache.attributes && typeof cache.attributes === "object" ? cache.attributes : {},
    attributeStores: cache.attributeStores && typeof cache.attributeStores === "object" ? cache.attributeStores : {},
    attributeUpdatedAt: cache.attributeUpdatedAt && typeof cache.attributeUpdatedAt === "object" ? cache.attributeUpdatedAt : {},
    attributeValues: cache.attributeValues && typeof cache.attributeValues === "object" ? cache.attributeValues : {},
    categoryReadEvidence: cache.categoryReadEvidence && typeof cache.categoryReadEvidence === "object"
      ? {
        tree: cache.categoryReadEvidence.tree && typeof cache.categoryReadEvidence.tree === "object" ? cache.categoryReadEvidence.tree : null,
        attributes: cache.categoryReadEvidence.attributes && typeof cache.categoryReadEvidence.attributes === "object" ? cache.categoryReadEvidence.attributes : {},
        attributeValues: cache.categoryReadEvidence.attributeValues && typeof cache.categoryReadEvidence.attributeValues === "object" ? cache.categoryReadEvidence.attributeValues : {},
      }
      : { tree: null, attributes: {}, attributeValues: {} },
  };
}

async function renameFile(from, to) {
  const { copyFile, unlink } = await import("node:fs/promises");
  await copyFile(from, to);
  await unlink(from);
}

export function flattenCategories(nodes, parents = [], inheritedCategoryId = 0) {
  const rows = [];
  for (const node of nodes || []) {
    const label = fixMojibake(node.category_name || node.type_name || "");
    const pathParts = [...parents, label].filter(Boolean);
    const descriptionCategoryId = node.description_category_id || inheritedCategoryId;
    if (node.type_id && descriptionCategoryId) {
      rows.push({
        description_category_id: descriptionCategoryId,
        type_id: node.type_id,
        name: label,
        path: pathParts.join(" / "),
        searchText: normalizeText(pathParts.join(" ") + " " + label),
        disabled: Boolean(node.disabled),
      });
    }
    rows.push(...flattenCategories(node.children || [], pathParts, descriptionCategoryId));
  }
  return rows;
}

export function matchCategory(product, flatCategories, limit = 8) {
  const titleText = normalizeText(product.title || "");
  const text = normalizeText([
    product.title,
    product.url,
    ...(product.attributes || []).flatMap((item) => [item.name, item.value]),
    ...(product.skuVariants || []).map((item) => item.spec),
  ].filter(Boolean).join(" "));
  const titleCore = inferTitleCore(titleText);
  const tokens = buildProductTokens(text);

  return (flatCategories || [])
    .filter((item) => !item.disabled)
    .map((item) => {
      const categoryText = normalizeText(`${item.path} ${item.name}`);
      let score = 0;
      const reasons = [];
      for (const token of tokens) {
        if (categoryText.includes(token.cn) || token.ru.some((word) => categoryText.includes(word))) {
          score += token.weight;
          reasons.push(token.label);
        }
      }
      for (const word of text.split(/\s+/).filter((word) => word.length >= 2)) {
        if (categoryText.includes(word)) score += 1;
      }
      if (/头巾|帽|围巾|披肩|服装|配饰/.test(text) && item.path.startsWith("服装 / 配饰")) score += 18;
      if (/手机壳|保护壳|软壳|防摔壳|iphone|苹果型号|适用机型/.test(text) && /手机|智能手机|电话|电子/.test(item.path)) score += 70;
      if (/手机壳|保护壳|软壳|防摔壳|iphone/.test(text) && / чехол|чехол|смартфон|телефон|手机壳|保护壳/.test(categoryText)) score += 95;
      if (/手机壳|保护壳|iphone/.test(text) && /宠物|烘焙|厨房|成人|蜡烛|模具|首饰|服装|鞋|包/.test(item.path)) score -= 90;
      if (/卷笔刀|削笔器|削笔机|铅笔刀/.test(text) && item.path === "文具 / 文具 / 卷笔刀") score += 95;
      if (/卷笔刀|削笔器|削笔机|铅笔刀|文具/.test(text) && item.path.startsWith("文具 /")) score += 28;
      if (/卷笔刀|削笔器|削笔机|铅笔刀/.test(text) && /美妆|美容|宠物|建筑|刀叉|园林|运动/.test(item.path)) score -= 70;
      if (/头巾/.test(text) && /头巾/.test(item.path)) score += 20;
      if (/民族帽|帽子|化疗帽/.test(text) && /帽子|带檐帽|贝雷帽|遮阳帽|头巾/.test(item.path)) score += 12;
      if (/汽车|家具|建筑|洗澡|摩托车|桑拿/.test(item.path) && /头巾|民族帽|帽子|围巾|披肩/.test(text)) score -= 30;
      const craftMold = titleCore.kind === "craft_mold" || (/滴胶|树脂|香薰|石膏|蜡烛|皂|肥皂|手工|diy/.test(text) && /模具|模/.test(titleText));
      if (craftMold && item.path === "爱好和创作 / 手工制作套件 / DIY蜡烛套装") score += 130;
      if (craftMold && /爱好和创作|手工制作/.test(item.path)) score += 55;
      if (craftMold && /模具/.test(item.name)) score += 45;
      if (craftMold && /烘焙|烤盘|厨房|厨具|烹饪/.test(item.path)) score -= 85;
      if (craftMold && /蜡烛和烛台|烛台|蜡烛配件|蜡烛$|手工艺品材料|石膏$|环氧树脂|丙烯酸树脂|建筑|药店|医用/.test(item.path)) score -= 75;
      if (craftMold && /烛台|摆件|蜡烛|石膏|树脂/.test(item.name) && !/模具|套装/.test(item.name)) score -= 55;
      const jewelry = /项链|吊坠|挂坠|首饰|饰品|耳环|戒指|手链|宝石|玻璃项链/.test(text);
      if (jewelry && /珠宝|首饰|饰品|项链|吊坠|挂坠|手链|耳环|戒指/.test(item.path)) score += 90;
      if (jewelry && /成人|情趣|性爱|女性乳房|模拟器|玩具/.test(item.path)) score -= 120;
      if (/女性乳房模拟器|乳房模拟器|成人用品|情趣/.test(text) && /成人用品|情趣玩具|性模拟器/.test(item.path)) score += 90;
      if (!craftMold && /烤盘|蛋糕模|蛋糕磨具|模具|布朗尼|烘焙|面包/.test(text) && /烘焙|烤盘|模具|蛋糕|厨房|厨具|烹饪/.test(item.path)) score += 42;
      if (!craftMold && /蛋糕模|蛋糕磨具|慕斯|布朗尼|模具|烘焙用品|烘焙/.test(text) && item.name === "烘焙模具，烤盘") score += 55;
      if (/普通烤盘|烤盘托盘|烤箱托盘|烧烤盘/.test(text) && item.name === "烤盘") score += 35;
      if (/蛋糕模|蛋糕磨具|慕斯|布朗尼|模具/.test(text) && item.name === "烤盘") score -= 20;
      if (/烤盘|蛋糕模|蛋糕磨具|模具|布朗尼|烘焙|面包|滴胶|树脂|香薰|石膏|蜡烛/.test(text) && /宠物|箱包|包装|步行|训练/.test(item.path)) score -= 60;
      if (/扭扭棒|毛条|毛根|синельная проволока|проволока|diy花束|花束材料/.test(text) && /爱好和创作|手工艺品材料|手工铁丝|花艺造型骨架/.test(item.path)) score += 115;
      if (/扭扭棒|毛条|毛根|синельная проволока|проволока/.test(text) && /儿童用品|玩具小汽车|汽车|商业设备/.test(item.path)) score -= 70;
      const roseDomeGift = /роза|玫瑰|永生花|rose/.test(text) && /колб|玻璃罩|亚克力罩|灯罩|led|подсвет|摆件|礼品|подар/.test(text);
      const keychainSouvenir = /брелок|сувенир|подвеск|ключ|钥匙扣|钥匙链|挂件|挂饰|纪念品/.test(text);
      const crystalDecorIntent = /水晶|кристалл|crystal|玻璃摆件|琉璃|水晶小饰品/.test(text);
      if (keychainSouvenir && /纪念品|礼品|сувенир|подар/.test(item.path)) score += 135;
      if (keychainSouvenir && /宠物用品|宠物护理用品|宠物玩具|动物/.test(item.path)) score -= 120;
      if (keychainSouvenir && /брелок|ключ|钥匙扣|钥匙链/.test(text) && item.name === "纪念品" && /纪念品和礼品/.test(item.path)) score += 155;
      if (keychainSouvenir && /брелок|ключ|钥匙扣|钥匙链/.test(text) && /袖珍钥匙扣|钥匙扣/.test(item.path + item.name)) score += 60;
      if (keychainSouvenir && /брелок|ключ|钥匙扣|钥匙链|挂件|挂饰/.test(text) && /住宅和花园|纪念品和礼品|装饰|сувенир|подар/.test(item.path)) score += 80;
      if (keychainSouvenir && !crystalDecorIntent && /水晶小饰品/.test(item.path + item.name)) score -= 160;
      if (keychainSouvenir && /汽车用品|汽车配件|汽车爱好者|摩托车|成人用品|情趣|节庆商品|礼品包装|礼品蝴蝶结|丝带|礼品袋|礼品盒|包装/.test(item.path)) score -= 170;
      if (roseDomeGift && /纪念品|礼品|сувенир|подар|家居|装饰|夜灯|灯/.test(item.path)) score += 150;
      if (roseDomeGift && /礼品包装纸|包装纸|包装材料|包材/.test(item.path)) score -= 180;
      if (!/包装纸|包材|礼品包装|包装材料|wrapping|упаковочн|бумага/.test(text) && /礼品包装纸|包装纸|包装材料/.test(item.path)) score -= 120;
      if (/纪念币|收藏钱币|钱币|硬币|монета|рубл|рубль|сувенирная монета/.test(text) && /古董和收藏品|收藏品|收藏钱币|纪念品和礼品|纪念奖牌|奖牌/.test(item.path)) score += 120;
      if (/纪念币|收藏钱币|钱币|硬币|монета|рубл|рубль/.test(text) && /硬币盒|计数器|商业设备|办公设备/.test(item.path)) score -= 100;
      if (!keychainSouvenir && /宠物|猫|狗|кош|собак|автокормушка|кормушка|поилка|миска|猫碗|狗碗|宠物碗|饮水机|喂食器/.test(text) && /宠物用品|宠物餐具|宠物自动喂食器|宠物饮水器|宠物碗/.test(item.path)) score += 125;
      if (/автокормушка|кормушка|поилка|автопоилка|自动饮水机|饮水机|喂食器|自动喂食/.test(text) && /宠物自动喂食器|宠物饮水器/.test(item.path)) score += 80;
      if (/поилка|автопоилка|фонтан|饮水机|饮水器|喂水器/.test(text) && !/кормушка|автокормушка|喂食器|自动喂食/.test(text) && /宠物饮水器/.test(item.path + item.name)) score += 95;
      if (/поилка|автопоилка|фонтан|饮水机|饮水器|喂水器/.test(text) && !/кормушка|автокормушка|喂食器|自动喂食/.test(text) && /宠物自动喂食器/.test(item.path + item.name)) score -= 45;
      if (/автокормушка|кормушка|поилка|автопоилка|自动饮水机|饮水机|喂食器|自动喂食/.test(text) && /宠物碗架|宠物碗垫|宠物碗$|配件/.test(item.path)) score -= 55;
      if (/宠物|猫|狗|кош|собак|автокормушка|кормушка|поилка|миска|猫碗|狗碗|宠物碗/.test(text) && /儿童用品|儿童喂食|婴儿/.test(item.path)) score -= 95;
      if (titleCore.kind === "jewelry" && /服装首饰|珠宝|首饰|饰品/.test(item.path)) score += 70;
      if (titleCore.kind === "baking_mold" && item.name === "烘焙模具，烤盘") score += 95;
      if (titleCore.kind === "water_bottle" && item.path === "运动与休闲 / 旅游餐具 / 运动水壶") score += 140;
      if (titleCore.kind === "water_bottle" && /运动与休闲|旅游餐具|运动水壶|野营水壶|登山杯/.test(item.path)) score += 55;
      if (titleCore.kind === "water_bottle" && /成人用品|汽车|建筑|文具|烘焙|宠物|服装|鞋|箱包/.test(item.path)) score -= 80;
      if (titleCore.kind === "stationery_sharpener" && item.path === "文具 / 文具 / 卷笔刀") score += 95;
      if (titleCore.kind === "adult_simulator" && /成人用品|情趣玩具|性模拟器/.test(item.path)) score += 120;
      return { ...item, score, reasons: [...new Set(reasons)] };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function normalizeText(value) {
  return fixMojibake(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{Script=Han}\p{Script=Cyrillic}a-z0-9]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fixMojibake(value = "") {
  const text = String(value || "");
  if (!/[ÃÂÐÑåæçèé]/.test(text)) return text;
  try {
    const decoded = Buffer.from(text, "latin1").toString("utf8");
    return /[\u4e00-\u9fffА-Яа-я]/.test(decoded) ? decoded : text;
  } catch {
    return text;
  }
}

function inferTitleCore(title) {
  const value = String(title || "");
  const positions = [
    { kind: "adult_simulator", pattern: /女性乳房模拟器|乳房模拟器|成人用品|情趣用品|情趣玩具|性模拟器/g, weight: 120 },
    { kind: "stationery_sharpener", pattern: /卷笔刀|削笔器|削笔机|铅笔刀/g, weight: 105 },
    { kind: "jewelry", pattern: /宝石项链|玻璃项链|项链|吊坠|挂坠|首饰|饰品/g, weight: 100 },
    { kind: "water_bottle", pattern: /运动水壶|旅行水壶|户外水壶|折叠水壶|折叠水杯|水瓶|水壶|水杯|杯子/g, weight: 98 },
    { kind: "baking_mold", pattern: /布朗尼烤盘|蛋糕模具|蛋糕磨具|烘焙模具|慕斯模具|烤盘|面包模具/g, weight: 95 },
    { kind: "craft_mold", pattern: /滴胶模具|树脂模具|硅胶模具|石膏模具|蜡烛模具|香薰模具|肥皂模具|皂模|模具|模/g, weight: 90 },
    { kind: "candle_holder", pattern: /烛台|蜡烛台/g, weight: 60 },
    { kind: "ornament", pattern: /摆件|挂件|装饰/g, weight: 45 },
  ];
  let best = { kind: "", label: "", score: 0, index: -1 };
  for (const item of positions) {
    for (const match of value.matchAll(item.pattern)) {
      const index = match.index || 0;
      const score = item.weight + index / Math.max(value.length, 1) * 40;
      if (score > best.score) best = { kind: item.kind, label: match[0], score, index };
    }
  }
  if (best.kind === "candle_holder" && /模具|模/.test(value) && best.index < value.lastIndexOf("模")) {
    return { kind: "craft_mold", label: "模具" };
  }
  if (best.kind === "ornament" && /模具|模/.test(value) && best.index < value.lastIndexOf("模")) {
    return { kind: "craft_mold", label: "模具" };
  }
  if (best.kind === "craft_mold" && /蛋糕|烘焙|慕斯|布朗尼|面包|烤盘/.test(value) && !/滴胶|树脂|石膏|蜡烛|香薰|皂|肥皂/.test(value)) {
    return { kind: "baking_mold", label: best.label };
  }
  return best.kind ? { kind: best.kind, label: best.label } : { kind: "", label: "" };
}

function buildProductTokens(text) {
  const rules = [
    { cn: "头巾", ru: ["платок", "головной убор", "бандана", "шапка"], label: "头巾/帽", weight: 30 },
    { cn: "帽", ru: ["шапка", "головной убор", "панама", "кепка"], label: "帽子", weight: 24 },
    { cn: "围巾", ru: ["шарф", "платок"], label: "围巾", weight: 26 },
    { cn: "包包", ru: ["сумка", "рюкзак", "клатч"], label: "箱包", weight: 28 },
    { cn: "手提包", ru: ["сумка", "клатч"], label: "箱包", weight: 28 },
    { cn: "斜挎包", ru: ["сумка", "кроссбоди"], label: "箱包", weight: 28 },
    { cn: "背包", ru: ["рюкзак"], label: "箱包", weight: 28 },
    { cn: "衣架", ru: ["вешалка"], label: "衣架", weight: 32 },
    { cn: "卷笔刀", ru: ["точилка"], label: "卷笔刀", weight: 40 },
    { cn: "削笔器", ru: ["точилка"], label: "削笔器", weight: 38 },
    { cn: "铅笔刀", ru: ["точилка"], label: "铅笔刀", weight: 38 },
    { cn: "文具", ru: ["канцелярский"], label: "文具", weight: 22 },
    { cn: "项链", ru: ["ожерелье", "колье", "цепочка"], label: "项链", weight: 40 },
    { cn: "吊坠", ru: ["подвеска", "кулон"], label: "吊坠", weight: 40 },
    { cn: "首饰", ru: ["украшение", "бижутерия"], label: "首饰", weight: 34 },
    { cn: "饰品", ru: ["украшение", "бижутерия"], label: "饰品", weight: 30 },
    { cn: "宝石", ru: ["камень", "кристалл"], label: "宝石", weight: 24 },
    { cn: "烤盘", ru: ["форма для выпечки", "противень", "форма"], label: "烤盘/模具", weight: 36 },
    { cn: "蛋糕模", ru: ["форма для выпечки", "форма для кекса"], label: "蛋糕模具", weight: 34 },
    { cn: "烘焙", ru: ["выпечка", "пекарский"], label: "烘焙", weight: 26 },
    { cn: "滴胶", ru: ["смола", "эпоксидная"], label: "滴胶/树脂", weight: 32 },
    { cn: "树脂", ru: ["смола", "эпоксидная"], label: "树脂", weight: 30 },
    { cn: "蜡烛", ru: ["свеча", "свечи"], label: "蜡烛", weight: 32 },
    { cn: "香薰", ru: ["ароматический", "аромасвеча"], label: "香薰", weight: 24 },
    { cn: "石膏", ru: ["гипс"], label: "石膏", weight: 24 },
    { cn: "鞋", ru: ["обувь", "туфли", "сандалии", "тапочки"], label: "鞋", weight: 24 },
    { cn: "收纳", ru: ["органайзер", "хранение", "контейнер"], label: "收纳", weight: 22 },
    { cn: "厨房", ru: ["кухня", "кухонный"], label: "厨房", weight: 18 },
    { cn: "玩具", ru: ["игрушка"], label: "玩具", weight: 22 },
    { cn: "宠物碗", ru: ["миска"], label: "宠物碗", weight: 44 },
    { cn: "猫碗", ru: ["миска", "кошка"], label: "猫碗", weight: 42 },
    { cn: "狗碗", ru: ["миска", "собака"], label: "狗碗", weight: 42 },
    { cn: "喂食器", ru: ["кормушка", "автокормушка"], label: "宠物喂食器", weight: 42 },
    { cn: "饮水机", ru: ["поилка"], label: "宠物饮水器", weight: 42 },
    { cn: "扭扭棒", ru: ["синельная проволока", "проволока"], label: "扭扭棒/毛条", weight: 48 },
    { cn: "毛条", ru: ["синельная проволока", "проволока"], label: "毛条", weight: 44 },
    { cn: "手工铁丝", ru: ["проволока"], label: "手工铁丝", weight: 44 },
    { cn: "纪念币", ru: ["монета", "рубль", "рубл"], label: "纪念币", weight: 52 },
    { cn: "收藏钱币", ru: ["монета", "рубль", "рубл"], label: "收藏钱币", weight: 52 },
    { cn: "钱币", ru: ["монета", "рубль", "рубл"], label: "钱币", weight: 44 },
    { cn: "运动水壶", ru: ["бутылка", "фляга", "бутылка для воды"], label: "运动水壶", weight: 48 },
    { cn: "旅行水壶", ru: ["бутылка", "фляга", "туристическая"], label: "旅行水壶", weight: 44 },
    { cn: "折叠水壶", ru: ["складная бутылка", "бутылка"], label: "折叠水壶", weight: 44 },
    { cn: "折叠水杯", ru: ["складная бутылка", "складной стакан"], label: "折叠水杯", weight: 38 },
    { cn: "水瓶", ru: ["бутылка", "фляга"], label: "水瓶", weight: 36 },
    { cn: "水壶", ru: ["бутылка", "фляга"], label: "水壶", weight: 36 },
    { cn: "手机壳", ru: ["чехол", "смартфон", "телефон"], label: "手机壳", weight: 46 },
    { cn: "保护壳", ru: ["чехол", "смартфон", "телефон"], label: "保护壳", weight: 42 },
    { cn: "适用机型", ru: ["смартфон", "телефон"], label: "手机型号", weight: 24 },
    { cn: "女", ru: ["женский", "женщина"], label: "女士", weight: 8 },
    { cn: "儿童", ru: ["детский", "дети"], label: "儿童", weight: 8 },
  ];
  return rules.filter((rule) => text.includes(rule.cn) || rule.ru.some((word) => text.includes(word)));
}
