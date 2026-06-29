import { callAiTask } from "./aiTaskRouter.js";

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function arrayOfText(value) {
  if (Array.isArray(value)) return value.map(compactText).filter(Boolean).slice(0, 30);
  const text = compactText(value);
  return text ? [text] : [];
}

function normalizeImages(value) {
  return (Array.isArray(value) ? value : [])
    .map((url) => String(url || "").trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 8);
}

function normalizeReference(item = {}, index = 0) {
  return {
    index: index + 1,
    title: compactText(item.title || item.detail?.title || ""),
    category: compactText(item.category || item.detail?.category || ""),
    url: String(item.url || item.detail?.url || ""),
    images: normalizeImages(item.images || item.detail?.images || [item.image || item.detail?.image]),
    price: Number(item.price || item.detail?.price || 0),
    rating: Number(item.rating || item.detail?.frontSignals?.rating || 0),
    reviewCount: Number(item.reviewCount || item.detail?.frontSignals?.reviewCount || 0),
  };
}

function normalizeProduct(product = {}) {
  return {
    title: compactText(product.title || product.subject || product.name || ""),
    category: compactText(product.category || product.categoryName || ""),
    url: String(product.url || ""),
    images: normalizeImages(product.images || [product.image]),
    variants: arrayOfText(product.variants || product.skuNames || product.colors),
    attributes: product.attributes && typeof product.attributes === "object" ? product.attributes : {},
  };
}

export function buildReferenceGuidancePrompt({ product = {}, references = [] } = {}) {
  const normalizedProduct = normalizeProduct(product);
  const normalizedReferences = references.slice(0, 8).map(normalizeReference);
  return [
    "任务：按当前单品实时参照 Ozon 同类商品，输出上架文案、属性和后期产品图片重构指导。",
    "重要边界：不要复制竞品标题、图片、文案、品牌、logo 或独特设计；只学习同类商品的商业表达、布局、色调、构图、轮播逻辑和信息完整度。",
    "用途：指导当前 1688 产品的 Ozon 上架和 image2 后期作图，不直接提交 Ozon，不直接生成图片。",
    "语言要求：copywriting_guidance 中的俄语标题/卖点必须是自然俄语，俄语字段不得夹中文；中文解释可以单独写在同一条建议后半句。",
    "图片要求：carousel_plan 和 image2_prompts 至少 5 张，覆盖主图、接口/材质细节、尺寸参数、使用场景、SKU/颜色/套装差异。",
    "",
    "当前产品：",
    JSON.stringify(normalizedProduct, null, 2),
    "",
    "Ozon 参照样本：",
    JSON.stringify(normalizedReferences, null, 2),
    "",
    "请只输出 JSON 对象，字段如下：",
    "{",
    '  "copywriting_guidance": ["标题、卖点、描述、俄语表达建议"],',
    '  "attribute_guidance": ["Ozon 属性/参数填写建议，说明哪些来自产品事实，哪些需要人工确认"],',
    '  "image_style_profile": {',
    '    "layout": ["布局观察：主体位置、占比、多图拼接、放大框、参数区位置"],',
    '    "color_tone": ["色调观察：背景、饱和度、光线、整体商业气质"],',
    '    "composition": ["构图观察：视角、角度、包装/配件/细节展示方式"],',
    '    "typography": ["图中文字/图标/箭头/俄语短标签使用方式"],',
    '    "scene_logic": ["场景逻辑：什么环境最适合该品类"]',
    "  },",
    '  "carousel_plan": [{"index": 1, "goal": "这张图解决什么问题；至少 5 张", "composition": "画面怎么摆", "text": "建议文字，没有就写 без текста"}],',
    '  "image2_prompts": [{"index": 1, "prompt": "给 image2/图片模型的中文提示词；至少 5 张，要求保持当前产品本体准确"}],',
    '  "quality_checklist": ["上架前图片质检项：尺寸、材质、包装、配件、SKU、侵权、误导等"],',
    '  "risk_flags": ["如果有类目、图片、侵权、参数不确定、过度生成风险就列出；无风险写 none"]',
    "}",
    "",
    "必须覆盖：图片风格画像、布局、色调、构图、轮播图脚本、image2 prompt、质检清单。",
  ].join("\n");
}

function normalizeStyleProfile(value = {}) {
  return {
    layout: arrayOfText(value.layout),
    colorTone: arrayOfText(value.color_tone || value.colorTone),
    composition: arrayOfText(value.composition),
    typography: arrayOfText(value.typography),
    sceneLogic: arrayOfText(value.scene_logic || value.sceneLogic),
  };
}

function normalizeCarouselPlan(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((item, index) => ({
    index: Number(item.index || index + 1),
    goal: compactText(item.goal || ""),
    composition: compactText(item.composition || ""),
    text: compactText(item.text || ""),
  })).filter((item) => item.goal || item.composition || item.text);
}

function normalizeImage2Prompts(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((item, index) => ({
    index: Number(item.index || index + 1),
    prompt: compactText(item.prompt || item.text || ""),
  })).filter((item) => item.prompt);
}

export function normalizeReferenceGuidance(product = {}, references = [], aiResult = {}) {
  const json = aiResult.json || {};
  const normalizedReferences = references.slice(0, 8).map(normalizeReference);
  return {
    ok: true,
    product: normalizeProduct(product),
    referenceSummary: {
      count: normalizedReferences.length,
      titles: normalizedReferences.map((item) => item.title).filter(Boolean).slice(0, 8),
      categories: [...new Set(normalizedReferences.map((item) => item.category).filter(Boolean))].slice(0, 8),
    },
    copywritingGuidance: arrayOfText(json.copywriting_guidance || json.copywritingGuidance),
    attributeGuidance: arrayOfText(json.attribute_guidance || json.attributeGuidance),
    imageStyleProfile: normalizeStyleProfile(json.image_style_profile || json.imageStyleProfile),
    carouselPlan: normalizeCarouselPlan(json.carousel_plan || json.carouselPlan),
    image2Prompts: normalizeImage2Prompts(json.image2_prompts || json.image2Prompts),
    qualityChecklist: arrayOfText(json.quality_checklist || json.qualityChecklist),
    riskFlags: arrayOfText(json.risk_flags || json.riskFlags),
    provider: aiResult.provider || "",
    model: aiResult.model || "",
  };
}

export async function generateOzonReferenceGuidance({ product = {}, references = [], aiTask = callAiTask } = {}) {
  const result = await aiTask({
    taskType: "ozon_reference_guidance",
    systemPrompt: "You are an Ozon ecommerce listing and product image reconstruction advisor. Output JSON only.",
    userPrompt: buildReferenceGuidancePrompt({ product, references }),
    responseFormat: "json",
    maxTokens: 1800,
    temperature: 0,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || "AI reference guidance failed",
      provider: result.provider || "",
      model: result.model || "",
    };
  }
  return normalizeReferenceGuidance(product, references, result);
}
