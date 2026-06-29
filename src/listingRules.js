import fs from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const RULES_FILE = path.join(DATA_DIR, "listing-rules.json");
const ITEM_FILE = path.join(DATA_DIR, "ozon-learning-items.json");

export function normalizeAttributeEntries(attributes) {
  if (Array.isArray(attributes)) {
    return attributes.map(function(attribute) {
      return {
        name: String(attribute?.name || attribute?.attribute_name || ""),
        value: String(attribute?.value || attribute?.attribute_value || ""),
      };
    }).filter(function(attribute) { return attribute.name && attribute.value; });
  }
  if (attributes && typeof attributes === "object") {
    return Object.entries(attributes).map(function([name, value]) {
      return { name: String(name || ""), value: String(value || "") };
    }).filter(function(attribute) { return attribute.name && attribute.value; });
  }
  return [];
}

async function analyzeAndBuildRules() {
  let items = [];
  try {
    const raw = JSON.parse(await fs.readFile(ITEM_FILE, "utf8"));
    items = (raw.items || []).filter(function(i) { return i.detail && i.detail.title; });
  } catch (e) {
    return { ok: false, reason: "no data", itemsAnalyzed: 0 };
  }
  if (!items.length) return { ok: false, reason: "no data", itemsAnalyzed: 0 };
  const byCategory = {};
  for (const item of items) {
    const cat = item.category || item.detail.category || "other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }
  const rules = { builtAt: new Date().toISOString(), totalItems: items.length, categories: {} };
  for (const cat of Object.keys(byCategory)) {
    const catItems = byCategory[cat];
    const titles = catItems.map(function(i) { return i.detail.title || i.title || ""; }).filter(Boolean);
    const p = analyzeTitlePatterns(titles);
    const attrs = {};
    for (const item of catItems) {
      const a = normalizeAttributeEntries(item.detail.attributes);
      for (const at of a) {
        const n = at.name;
        const v = at.value;
        if (n && v) { if (!attrs[n]) attrs[n] = {}; attrs[n][v] = (attrs[n][v] || 0) + 1; }
      }
    }
    const ca = {};
    for (const n of Object.keys(attrs)) {
      const vals = attrs[n];
      const tv = Object.keys(vals).sort(function(a,b) { return vals[b] - vals[a]; })[0];
      const t = Object.values(vals).reduce(function(s,v) { return s+v; }, 0);
      ca[n] = { topValue: tv, frequency: Math.round((vals[tv]/t)*100), sampleSize: t };
    }
    const pr = catItems.map(function(i) { return Number(i.price||i.detail.price||0); }).filter(function(p) { return p>0; });
    const ps = pr.length > 0 ? {
      min: Math.min.apply(null, pr), max: Math.max.apply(null, pr),
      avg: Math.round(pr.reduce(function(s,p) { return s+p; }, 0)/pr.length),
      median: pr.sort(function(a,b) { return a-b; })[Math.floor(pr.length/2)],
      sampleCount: pr.length
    } : null;
    rules.categories[cat] = { sampleCount: catItems.length, titlePattern: p, commonAttributes: ca, priceStats: ps };
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RULES_FILE, JSON.stringify(rules, null, 2), "utf8");
  return { ok: true, itemsAnalyzed: items.length, categoriesBuilt: Object.keys(rules.categories).length };
}

function analyzeTitlePatterns(titles) {
  if (!titles.length) return null;
  const wf = {}, pm = {};
  for (const t of titles) {
    const ws = t.split(/[\s,;!?]+/).filter(Boolean);
    for (let i=0; i<ws.length; i++) {
      const w = ws[i].toLowerCase().replace(/[^a-z0-9\u0430-\u044f\u0451-]+/g, "");
      if (w.length<2) continue;
      wf[w] = (wf[w]||0)+1; if(!pm[w]) pm[w]=[]; pm[w].push(i);
    }
  }
  const tt = titles.length;
  const tw = Object.keys(wf).map(function(w) { var p = pm[w]; return { word: w, count: wf[w], freq: Math.round((wf[w]/tt)*100), avgPos: p.length>0 ? Math.round(p.reduce(function(s,p) { return s+p; },0)/p.length) : -1 }; }).filter(function(w) { return w.count >= Math.max(2, Math.ceil(tt*0.2)); }).sort(function(a,b) { return b.count-a.count; }).slice(0,30);
  const fw = {};
  for (const t of titles) {
    const ws = t.split(/[\s,;!?]+/).filter(Boolean);
    if (ws.length>0) { var f = ws[0].toLowerCase().replace(/[^a-z0-9\u0430-\u044f\u0451-]+/g,""); if (f.length>2) fw[f] = (fw[f]||0)+1; }
  }
  return {
    totalTitles: tt,
    avgLength: Math.round(titles.reduce(function(s,t) { return s + t.split(/\s+/).length; }, 0)/tt),
    commonWords: tw.slice(0,15).map(function(w) { return w.word; }).join(","),
    commonFirstWords: Object.keys(fw).sort(function(a,b) { return fw[b]-fw[a]; }).slice(0,5),
    commonWordObjects: tw.slice(0,10)
  };
}

function generateTitleTemplate(p) {
  if (!p||!p.commonWordObjects||p.commonWordObjects.length<2) return null;
  const e = p.commonWordObjects.filter(function(w) { return w.avgPos < 1.5; });
  const m = p.commonWordObjects.filter(function(w) { return w.avgPos >= 1.5 && w.avgPos < 3; });
  const l = p.commonWordObjects.filter(function(w) { return w.avgPos >= 3; });
  const parts = [];
  if (e.length > 0) parts.push("[Type/Material]");
  parts.push("[Product Name]");
  if (m.length > 0) parts.push("[Purpose/Feature]");
  if (l.length > 0) parts.push("[Spec/Pack]");
  return { template: parts.join(" "), commonStartsWith: p.commonFirstWords || [], avgLength: p.avgLength || 5 };
}

function buildRulePrompt(productType, category) {
  try {
    const raw = JSON.parse(readFileSync(RULES_FILE, "utf8"));
    const cats = raw.categories || {};
    let cr = null;
    const ck = Object.keys(cats).find(function(k) { return k.toLowerCase().includes((category||productType||"").toLowerCase().slice(0,10)); });
    if (ck) cr = cats[ck];
    if (!cr) return "";
    let prompt = "<competitor_patterns>";
    if (cr.titlePattern) {
      const tp = cr.titlePattern;
      prompt += "avg_title_length:" + tp.avgLength + " words common_words:" + tp.commonWords + " common_first_words:" + (tp.commonFirstWords||[]).join(",");
    }
    if (cr.commonAttributes && Object.keys(cr.commonAttributes).length > 0) {
      prompt += " common_attributes:";
      Object.keys(cr.commonAttributes).slice(0,8).forEach(function(a) { var i = cr.commonAttributes[a]; prompt += a + ":" + i.topValue + "(" + i.frequency + "%)"; });
    }
    if (cr.priceStats) prompt += " price_range:" + cr.priceStats.min + "-" + cr.priceStats.max + "RUB";
    prompt += "</competitor_patterns>";
    return prompt;
  } catch(e) { return ""; }
}



const STOP_WORDS_RU = new Set([
  "для", "и", "в", "на", "с", "по", "от", "из", "у", "к", "о", "не", "это", "что",
  "или", "как", "со", "до", "за", "но", "а", "то", "все", "так", "если", "чтобы",
  "товар", "описание", "страна", "бренд",
]);

function extractFrequentWords(text, limit) {
  const words = text.toLowerCase().split(/[\s,;!?\.]+/).filter(function(w) { return w.length > 3 && !STOP_WORDS_RU.has(w); });
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.keys(freq).sort(function(a, b) { return freq[b] - freq[a]; }).slice(0, limit);
}
export async function triggerRuleAnalysis() { return await analyzeAndBuildRules(); }

export async function getRuleSummary() {
  try {
    const raw = JSON.parse(readFileSync(RULES_FILE,"utf8"));
    const rules = raw;
    return {ok:true,builtAt:rules.builtAt,totalItems:rules.totalItems,categories:Object.keys(rules.categories||{}).map(function(k) { return {category:k,sampleCount:rules.categories[k].sampleCount,hasTitlePattern:Boolean(rules.categories[k].titlePattern),attributeCount:Object.keys(rules.categories[k].commonAttributes||{}).length,hasPriceStats:Boolean(rules.categories[k].priceStats)}; })};
  } catch(e) { return {ok:false,reason:"no rules"}; }
}

export async function getRulePrompt(product) {
  if (!product) return "";
  return buildRulePrompt(product.title_ru||product.title||"", product.category||product.product_type_ru||"");
}

export async function getEnhancedRuleSummary() {
  try {
    const raw = JSON.parse(readFileSync(RULES_FILE,"utf8"));
    const cats = raw.categories||{};
    const su = [];
    for (const c of Object.keys(cats)) {
      const r = cats[c];
      const s = {category:c,sampleCount:r.sampleCount||0};
      if (r.titlePattern) s.titleGuide = generateTitleTemplate(r.titlePattern);
      if (r.priceStats) { s.priceRange = r.priceStats.min+"-"+r.priceStats.max; s.avgPrice = r.priceStats.avg; }
      su.push(s);
    }
    return {ok:true,builtAt:raw.builtAt,totalItems:raw.totalItems,categories:su};
  } catch(e) { return {ok:false,reason:"no rules"}; }
}
