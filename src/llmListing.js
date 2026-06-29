import fs from "node:fs";
import dns from "node:dns";

dns.setDefaultResultOrder?.("ipv4first");

const DEFAULT_MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1";
const DEFAULT_MODELSCOPE_MODEL = "Qwen/Qwen3-235B-A22B-Instruct-2507";
const DEFAULT_BIGMODEL_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_BIGMODEL_MODEL = "glm-4.7";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_DEEPSEEK_KEY_FILE = "D:\\Desktop\\api\\deepseek.txt";
const DEFAULT_APIMART_BASE_URL = "https://api.apib.ai/v1";
const DEFAULT_APIMART_MODEL = "gpt-5-nano-2025-08-07";
const DEFAULT_APIMART_KEY_FILE = "D:\\Desktop\\api\\apid-api.txt";

function readKeyFromFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    const text = String(fs.readFileSync(filePath, "utf8") || "");
    const direct = text.match(/\b(sk-[A-Za-z0-9_-]{8,})\b/);
    if (direct?.[1]) return direct[1].trim();
    return text.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/token|key|secret|initial/i.test(line)) || "";
  } catch {
    return "";
  }
}

function getDeepseekApiKey() {
  return process.env.DEEPSEEK_API_KEY || readKeyFromFile(process.env.DEEPSEEK_API_KEY_FILE || DEFAULT_DEEPSEEK_KEY_FILE);
}

function getApimartApiKey() {
  return process.env.APIMART_API_KEY
    || process.env.APIB_API_KEY
    || process.env.GPT5_API_KEY
    || readKeyFromFile(process.env.APIMART_API_KEY_FILE || process.env.APIB_API_KEY_FILE || DEFAULT_APIMART_KEY_FILE);
}

function normalizeProvider(provider = "") {
  const value = String(provider || "").trim().toLowerCase();
  if (["apimart", "apib", "gpt5", "gpt-5", "openai-compatible"].includes(value)) return "apimart";
  return value;
}

export function resolveApiKeyForProvider(provider) {
  provider = normalizeProvider(provider);
  if (provider === "bigmodel") return process.env.BIGMODEL_API_KEY || "";
  if (provider === "deepseek") return getDeepseekApiKey();
  if (provider === "apimart") return getApimartApiKey();
  return process.env.MODELSCOPE_API_KEY || "";
}

export function llmConfig() {
  const provider = normalizeProvider(process.env.AI_PROVIDER)
    || (getApimartApiKey() ? "apimart" : getDeepseekApiKey() ? "deepseek" : process.env.BIGMODEL_API_KEY ? "bigmodel" : "modelscope");
  if (provider === "apimart") {
    return {
      provider,
      enabled: Boolean(getApimartApiKey()),
      baseUrl: process.env.APIMART_BASE_URL || process.env.APIB_BASE_URL || DEFAULT_APIMART_BASE_URL,
      model: process.env.APIMART_MODEL || process.env.APIB_MODEL || process.env.GPT5_MODEL || DEFAULT_APIMART_MODEL,
    };
  }
  if (provider === "bigmodel") {
    return {
      provider,
      enabled: Boolean(process.env.BIGMODEL_API_KEY),
      baseUrl: process.env.BIGMODEL_BASE_URL || DEFAULT_BIGMODEL_BASE_URL,
      model: process.env.BIGMODEL_MODEL || DEFAULT_BIGMODEL_MODEL,
    };
  }
  if (provider === "deepseek") {
    return {
      provider,
      enabled: Boolean(getDeepseekApiKey()),
      baseUrl: process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
    };
  }
  return {
    provider,
    enabled: Boolean(process.env.MODELSCOPE_API_KEY),
    baseUrl: process.env.MODELSCOPE_BASE_URL || DEFAULT_MODELSCOPE_BASE_URL,
    model: process.env.MODELSCOPE_MODEL || DEFAULT_MODELSCOPE_MODEL,
  };
}

export async function generateListingContentWithLlm(product, options = {}) {
  // Include listing rules if available
  var rulePrompt = "";
  try {
    var rulesModule = await import("./listingRules.js");
    rulePrompt = await rulesModule.getRulePrompt(product);
  } catch (e) {
    // rules not available, continue without
  }
  var learningPrompt = "";
  try {
    var memoryModule = await import("./learningMemory.js");
    learningPrompt = await memoryModule.getLearningPrompt({
      candidate: product,
      ozonContext: options.ozonContext || {},
      listingContent: product,
    });
  } catch (e) {
    // learning memory not available, continue without
  }
  const config = llmConfig();
  if (!config.enabled) {
    return { enabled: false, provider: config.provider, reason: `未配置 ${apiKeyEnvName(config.provider)}` };
  }

  const useResponsesApi = config.provider === "apimart";
  const systemPrompt = [
    "你是 Ozon 俄罗斯电商 ERP 的自动上架助手。",
    "只输出 JSON，不要输出 Markdown。",
    "所有面向买家的内容必须使用俄语。",
    "品牌是独立下拉属性，不要写进标题。",
    "不要把 Нет бренда、No brand、Без бренда 当作商品标题。",
    "标题必须优先表达商品是什么，其次才是材质、用途、颜色、规格。",
    "如果原始标题中没有品牌，attributes_hint.brand 使用 Нет бренда。",
    "禁止编造与原始商品不相干的品类。",
            (rulePrompt ? "\\n\\n参考以下Ozon同类竞品的标题规律和属性：\\n" + rulePrompt : ""),
            (learningPrompt ? "\\n\\n参考以下系统历史自我学习经验，吸收成功模式，避开失败模式：\\n" + learningPrompt : "")
  ].join("\\n");
  const userPrompt = buildListingPrompt(product, options);

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}${useResponsesApi ? "/responses" : "/chat/completions"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKeyForProvider(config.provider)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(useResponsesApi
      ? {
          model: config.model,
          instructions: systemPrompt,
          input: userPrompt,
          max_output_tokens: 4096,
          reasoning: { effort: "minimal" },
        }
      : {
          model: config.model,
          temperature: 0.25,
          max_tokens: 2048,
          ...(config.provider === "bigmodel" ? { thinking: { type: "disabled" } } : {}),
          ...(config.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
          ...(config.provider === "modelscope" ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
  });

  const text = await response.text();
  const data = parseChatCompletionText(text);
  if (!response.ok) {
    return {
      enabled: true,
      model: "deterministic-fallback",
      fallback: true,
      reason: data?.error?.message || data?.message || response.statusText,
      content: normalizeListingContent(fallbackListingContent(product, options), product, options),
      raw: data,
    };
  }

  const content = modelTextFromResponse(data) || "{}";
  const jsonText = extractJsonObject(content);
  try {
    const parsed = JSON.parse(jsonText);
    return {
      enabled: true,
      model: config.model,
      content: normalizeListingContent(parsed, product, options),
      raw: data,
    };
  } catch {
    return {
      enabled: true,
      model: config.model,
      content: normalizeListingContent({ description_ru: content }, product, options),
      raw: data,
    };
  }
}

export function normalizeListingContent(content = {}, product = {}, options = {}) {
  const title = String(content.title_ru || product.title || options.ozonContext?.title || "").trim().slice(0, 200);
  const description = String(content.description_ru || "").trim();
  const productType = String(content.product_type_ru || title || "").trim().slice(0, 120);
  const hashtagsRaw = String(content.hashtags_ru || "").trim();
  const hashtags = normalizeHashtags(hashtagsRaw || hashtagsFromText(`${title} ${productType}`));
  const richJson = normalizeRichContent(content.rich_content_json, description || title);
  return {
    ...content,
    title_ru: title,
    description_ru: description || title,
    product_type_ru: productType,
    hashtags_ru: hashtags,
    annotation_ru: String(content.annotation_ru || description || title).slice(0, 480),
    rich_content_json: richJson,
    attributes_hint: {
      ...(content.attributes_hint || {}),
      brand: "Нет бренда",
      origin_country: "Китай",
    },
  };
}

function fallbackListingContent(product = {}, options = {}) {
  const sourceTitle = String(options.ozonContext?.title || product.title || "").replace(/\s+/g, " ").trim();
  const title = sourceTitle.slice(0, 160) || "Товар для дома";
  const description = [
    title,
    "Подходит для ежедневного использования.",
    "Изготовлено в Китае.",
    "Перед покупкой проверьте выбранный вариант товара.",
  ].join(" ");
  return {
    title_ru: title,
    product_type_ru: title.split(/[,.]/)[0].slice(0, 100) || title,
    description_ru: description,
    annotation_ru: description,
    hashtags_ru: hashtagsFromText(title + " " + String(options.ozonContext?.category || "")),
    attributes_hint: {
      brand: "Нет бренда",
      origin_country: "Китай",
    },
  };
}

function normalizeHashtags(text = "") {
  const parts = String(text || "")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("#") ? p : `#${p}`))
    .map((p) => p.replace(/[^\p{Script=Cyrillic}a-zA-Z0-9#_-]/gu, ""))
    .filter((p) => p.length >= 3);
  return Array.from(new Set(parts)).slice(0, 25).join(" ");
}

function hashtagsFromText(text = "") {
  const words = String(text || "")
    .toLowerCase()
    .split(/[\s,.;:!?/\\|()\[\]{}"']+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4)
    .slice(0, 25);
  return words.map((w) => `#${w}`).join(" ");
}

function normalizeRichContent(raw, description) {
  if (raw && typeof raw === "string") {
    try { JSON.parse(raw); return raw; } catch {}
  }
  if (raw && typeof raw === "object") {
    try { return JSON.stringify(raw); } catch {}
  }
  return JSON.stringify({
    content: [
      {
        widgetName: "raTextBlock",
        text: { size: "size2", color: "color1", content: [String(description || "").slice(0, 1500)] },
      },
    ],
    version: 0.3,
  });
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) return value.slice(start, end + 1);
  return value;
}

function parseChatCompletionText(raw = "") {
  const text = String(raw || "");
  if (!/^data:\s*/m.test(text)) {
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
  }
  const chunks = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, "").trim())
    .filter((line) => line && line !== "[DONE]");
  const parsed = [];
  for (const chunk of chunks) {
    try { parsed.push(JSON.parse(chunk)); } catch {}
  }
  const content = parsed.map((item) => item.choices?.[0]?.delta?.content || item.choices?.[0]?.message?.content || "").join("");
  const last = parsed[parsed.length - 1] || {};
  return {
    ...last,
    choices: [{ message: { content } }],
    stream: true,
    chunks: parsed.length,
  };
}

function modelTextFromResponse(data = {}) {
  if (typeof data.output_text === "string") return data.output_text;
  const outputText = (data.output || [])
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || part.output_text || "")
    .join("");
  return outputText || data.choices?.[0]?.message?.content || "";
}

function apiKeyForProvider(provider) {
  return resolveApiKeyForProvider(provider);
}

function apiKeyEnvName(provider) {
  if (provider === "apimart") return "APIMART_API_KEY / APIB_API_KEY / GPT5_API_KEY";
  if (provider === "bigmodel") return "BIGMODEL_API_KEY";
  if (provider === "deepseek") return "DEEPSEEK_API_KEY";
  return "MODELSCOPE_API_KEY";
}

function buildListingPrompt(product = {}, options = {}) {
  const compact = compactProductForPrompt(product);
  const ozon = compactOzonContext(options.ozonContext || {});
  const profit = options.profit || {};
  const match = options.match || {};
  return [
    "任务：根据下面的 1688 商品数据，生成 Ozon 俄罗斯站上架内容。",
    "",
    "最重要规则：",
    "1. 原始标题是最高优先级，必须先判断商品到底是什么。",
    "2. 禁止输出与原始标题无关的品类。比如原始标题是头巾/发带，绝不能输出手机壳、灯具、包、玩具等。",
    "3. title_ru 必须包含真实商品类型的俄文核心名词。",
    "4. 品牌不要写进标题；没有品牌时 attributes_hint.brand 写 Нет бренда。",
    "5. 删除跨境、新款、批发、爆款、多色可选等营销词。",
    "6. 标题必须是通用标题，不特指某个 SKU 规格；不要写重量、数量、具体变体规格。",
    "7. 禁止使用 Товар 作为标题或商品类型。",
    "8. 标题结构优先：商品核心名词 + 材质/形状/用途长尾词。",
    "9. 输出前自检：title_ru 和 product_type_ru 是否与原始标题一致；不一致就重写。",
    "10. 如果原始标题包含滴胶、树脂、香薰、石膏、蜡烛、手工DIY等词，它是手工/蜡烛/树脂模具，不是烘焙蛋糕模；标题应使用 Силиконовая форма для свечей и смолы 等表达。",
    "11. Ozon前台采集信息是竞品反哺依据：必须参考其真实商品类型、类目、属性表达、价格带、评价量和描述里的俄文关键词，但不要照抄竞品标题或品牌。",
    "12. 如果1688商品与Ozon竞品在用途/场景上不一致，以1688真实商品为准，并降低泛化描述；禁止把竞品中不存在于1688商品的数据写成事实。",
    "",
    "只输出一个 JSON 对象，字段如下：",
    "{",
    '  "title_ru": "200字符以内俄文通用标题，必须说清楚产品是什么",',
    '  "description_ru": "俄文描述，约500-900字符，不含品牌和虚假营销词；必须可直接写入Ozon商品描述",',
    '  "annotation_ru": "俄文简介/营销文本，180-480字符，概括用途、材质、适用场景，不要留空",',
    '  "hashtags_ru": "约25个俄文搜索标签，每个以#开头，1-2个单词，优先参考Ozon同类商品关键词",',
    '  "rich_content_json": "Ozon rich_content JSON字符串，至少包含一个raTextBlock，俄文，不要包含中文",',
    '  "product_type_ru": "俄文通用产品类型",',
    '  "attributes_hint": {"brand": "Нет бренда", "origin_country": "Китай", "material": "", "color": "", "purpose": ""}',
    "}",
    "",
    "Ozon前台竞品反哺信息：",
    `竞品标题：${ozon.title || "无"}`,
    `竞品价格RUB：${ozon.priceRub || 0}`,
    `竞品类目：${ozon.category || "无"}`,
    `竞品评分/评论：${ozon.rating || 0} / ${ozon.reviewCount || 0}`,
    `机会评分原因：${JSON.stringify(ozon.opportunityReasons || [])}`,
    `竞品属性：${JSON.stringify(ozon.attributes || [])}`,
    `竞品详情文本：${ozon.description || "无"}`,
    "",
    "匹配和利润信息：",
    `匹配判断：${JSON.stringify({ match: match.match, confidence: match.confidence, reason: match.reason })}`,
    `利润口径：${profit.basis || "cost_plus"}，目标成本利润率：${profit.targetProfitRate || 0}%`,
    `预计售价：${profit.estSellPriceCny || 0} CNY / ${profit.estRubPrice || 0} RUB，Ozon前台价：${profit.actualOzonPrice || 0} RUB，价差：${profit.priceDiff ?? "无"}%`,
    "",
    "1688货源信息：",
    `原始标题：${compact.title || "无"}`,
    `商品属性：${JSON.stringify(compact.attributes)}`,
    `SKU变体：${JSON.stringify(compact.skuVariants)}`,
    `尺重：${JSON.stringify(compact.sizeWeight)}`,
    `详情文本：${compact.detailText || "无"}`,
  ].join("\n");
}

function compactOzonContext(ozon = {}) {
  return {
    title: ozon.title || "",
    priceRub: Number(ozon.priceRub || 0),
    url: ozon.url || "",
    category: ozon.category || "",
    rating: Number(ozon.rating || 0),
    reviewCount: Number(ozon.reviewCount || 0),
    opportunityScore: Number(ozon.opportunityScore || 0),
    opportunityReasons: Array.isArray(ozon.opportunityReasons) ? ozon.opportunityReasons.slice(0, 10) : [],
    attributes: Array.isArray(ozon.attributes) ? ozon.attributes.slice(0, 40) : [],
    description: String(ozon.description || "").slice(0, 2500),
  };
}

function compactProductForPrompt(product = {}) {
  return {
    title: product.title || "",
    url: product.url || "",
    attributes: (product.attributes || []).slice(0, 40),
    skuVariants: (product.skuVariants || []).slice(0, 30).map((item) => ({
      spec: item.spec,
      price: item.price,
      stock: item.stock,
      weightG: item.weightG,
      lengthMm: item.lengthMm,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
    })),
    sizeWeight: product.sizeWeight || {},
    detailText: product.detail?.text || "",
  };
}
