(() => {
  const MLI_ENDPOINT = "https://ml-erp.woxq.cn/api/imports/amazon-extension/capture";
  const buttonId = "meli-amazon-capture";
  const automaticSourceId = new URLSearchParams(location.hash.replace(/^#/, "")).get("meli-recollect-source");

  const cleanNodeText = (node) => {
    if (!node) return "";
    // A+ blocks can contain inline <style>/<script> payloads. Read rendered
    // text from a clone so CSS/JSON is never sent as product description.
    const clone = node.cloneNode?.(true);
    clone?.querySelectorAll?.("script, style, noscript, template").forEach((item) => item.remove());
    return String(clone?.innerText || clone?.textContent || node.innerText || node.textContent || "")
      .replace(/\s+/g, " ").trim();
  };
  const text = (selector) => cleanNodeText(document.querySelector(selector));
  const textList = (selector) => [...document.querySelectorAll(selector)].map(cleanNodeText).filter(Boolean);
  const unique = (values) => [...new Set(values.filter((value) => /^https?:\/\//.test(value)))];
  // Amazon's carousel returns one source image in many render sizes, e.g.
  // ``..._SX342_`` / ``..._SX385_`` alongside ``..._SL1500_``. Converting
  // each to the unrendered original removes duplicates and thumbnail pixels.
  const fullImageUrl = (value) => String(value || "")
    .replace(/\._[^/?]+_\.(jpg|jpeg|png|webp)(?=\?.*$|$)/i, ".$1");

  // Only used by the extension's offline parser test; normal pages do not set it.
  if (globalThis.__MELI_AMAZON_COLLECTOR_TEST__ && typeof globalThis.__MELI_AMAZON_COLLECTOR_TEST__ === "object") {
    globalThis.__MELI_AMAZON_COLLECTOR_TEST__.fullImageUrl = fullImageUrl;
  }

  function canonicalUrl() {
    const asin = location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i)?.[1];
    return asin ? `${location.origin}/dp/${asin.toUpperCase()}` : location.href;
  }

  function variantLabel(id) {
    const raw = String(id || "").replace(/^variation_/, "").replace(/_name$/, "");
    if (/color|colour/i.test(raw)) return "Color";
    if (/size|style|pattern/i.test(raw)) return raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    return raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function captureVariants() {
    const variants = new Map();
    const addVariant = (asin, attribute, value, imageUrl, selected = false) => {
      const normalizedAsin = String(asin || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(normalizedAsin) || !value || /select|choose/i.test(value)) return;
      const existing = variants.get(normalizedAsin) || { asin: normalizedAsin, attributes: {}, image_urls: [], selected: false };
      existing.attributes[attribute] = value;
      if (/^https?:\/\//.test(imageUrl || "") && !/grey[-_]pixel/i.test(imageUrl)) existing.image_urls.push(fullImageUrl(imageUrl));
      existing.image_urls = unique(existing.image_urls);
      existing.selected = existing.selected || selected;
      variants.set(normalizedAsin, existing);
    };
    for (const group of document.querySelectorAll("[id^='variation_'][id$='_name']")) {
      const attribute = variantLabel(group.id);
      for (const option of group.querySelectorAll("li, option")) {
        const asin = String(option.dataset.defaultasin || option.dataset.asin || option.getAttribute("data-asin") || "").trim().toUpperCase();
        const value = String(option.getAttribute("title") || option.dataset.defaultasinLabel || option.querySelector("img")?.alt || option.textContent || "").replace(/\s+/g, " ").trim();
        if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !value || /select|choose/i.test(value)) continue;
        const image = option.querySelector("img");
        addVariant(asin, attribute, value, image?.getAttribute("data-old-hires") || image?.currentSrc || image?.src || "", option.classList.contains("selected") || option.getAttribute("aria-selected") === "true");
      }
    }
    // New Amazon desktop pages keep the twister choices in an a-state JSON
    // script rather than regular variation_* elements.
    for (const script of document.querySelectorAll('script[type="a-state"]')) {
      let state;
      try { state = JSON.parse(script.textContent || "{}"); } catch (_) { continue; }
      const dimensions = state?.sortedDimValuesForAllDims;
      if (!dimensions || typeof dimensions !== "object") continue;
      for (const [dimension, choices] of Object.entries(dimensions)) {
        const attribute = variantLabel(dimension);
        for (const choice of Array.isArray(choices) ? choices : []) {
          addVariant(choice?.defaultAsin, attribute, choice?.dimensionValueDisplayText, choice?.imageAttribute?.url || "", choice?.dimensionValueState === "SELECTED");
        }
      }
    }
    const currentAsin = canonicalUrl().match(/\/dp\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase();
    return [...variants.values()].map((variant) => ({ ...variant, selected: variant.selected || variant.asin === currentAsin }));
  }

  function amazonStatePayloads() {
    const values = [];
    for (const script of document.querySelectorAll('script[type="a-state"], script[type="application/json"]')) {
      const raw = script.textContent || "";
      if (!raw.includes("amazon") && !raw.includes("image") && !raw.includes("video") && !raw.includes("twister")) continue;
      try { values.push(JSON.parse(raw)); } catch (_) {}
    }
    return values;
  }

  function urlsFromState(values, kind) {
    const urls = [];
    const seen = new Set();
    const imageKeys = /(?:image|img|hires|large|main|landing|variant|color)/i;
    const videoKeys = /(?:video|playback|stream|mp4|hls)/i;
    const wanted = kind === "video" ? videoKeys : imageKeys;
    const accept = kind === "video"
      ? (url) => /\.(?:mp4|m3u8)(?:[?#].*)?$/i.test(url) || /video/i.test(url)
      : (url) => /m\.media-amazon\.com\/images\//i.test(url) && !/(?:grey[-_]pixel|pkplay-button|play-button-mb-image-grid|video-thumb)/i.test(url);
    const visit = (value, key = "", depth = 0) => {
      if (depth > 12 || value == null) return;
      if (typeof value === "string") {
        const url = value.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
        if (wanted.test(key) && /^https?:\/\//i.test(url) && accept(url) && !seen.has(url)) { seen.add(url); urls.push(url); }
        return;
      }
      if (Array.isArray(value)) { for (const item of value) visit(item, key, depth + 1); return; }
      if (typeof value === "object") for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey, depth + 1);
    };
    for (const value of values) visit(value);
    return urls;
  }

  function captureTechnicalDetails() {
    const details = {};
    const add = (label, value) => {
      const key = String(label || "").replace(/\s+/g, " ").trim().replace(/:$/, "");
      const textValue = String(value || "").replace(/\s+/g, " ").trim();
      if (key && textValue && key.length <= 120 && textValue.length <= 1000 && !details[key]) details[key] = textValue;
    };
    for (const row of document.querySelectorAll("[id^='productDetails_techSpec_section_'] tr, [id^='productDetails_detailBullets_sections'] tr, [id^='productDetails_db_sections'] tr, #productOverview_feature_div tr")) {
      add(cleanNodeText(row.querySelector("th, .prodDetSectionEntry, .a-span3")), cleanNodeText(row.querySelector("td, .prodDetAttrValue, .a-span9")));
    }
    for (const item of document.querySelectorAll("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li, #productOverview_feature_div li")) {
      const label = cleanNodeText(item.querySelector(".a-text-bold, .a-list-item .a-text-bold"));
      const value = cleanNodeText(item).replace(label, "");
      add(label, value);
    }
    return details;
  }

  async function waitForProductEvidence() {
    // Title and the landing image arrive before Amazon's lazy detail modules.
    // Wait for those modules to settle when available, while still allowing
    // products with no bullets/details to finish after a bounded delay.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const hasTitle = Boolean(text("#productTitle"));
      const hasImage = Boolean(document.querySelector("#landingImage[data-a-dynamic-image], #landingImage[data-old-hires], #altImages img"));
      const hasAdditionalEvidence = Boolean(document.querySelector(
        "#feature-bullets li, #productDescription, #aplus, #bookDescription_feature_div, [id^='productDetails_techSpec_section_'] tr, #detailBullets_feature_div li, #productOverview_feature_div tr, [id^='variation_'][id$='_name']",
      ));
      if (hasTitle && hasImage && (hasAdditionalEvidence || attempt >= 8)) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async function capture() {
    await waitForProductEvidence();
    const landing = document.querySelector("#landingImage");
    const dynamic = landing?.getAttribute("data-a-dynamic-image") || "{}";
    let dynamicUrls = [];
    try { dynamicUrls = Object.keys(JSON.parse(dynamic)); } catch (_) {}
    const statePayloads = amazonStatePayloads();
    const images = unique([
      landing?.getAttribute("data-old-hires"),
      ...dynamicUrls,
      ...[...document.querySelectorAll("#altImages img, #imageBlock img")]
        .flatMap((node) => [node.getAttribute("data-old-hires"), node.getAttribute("data-src"), node.currentSrc || node.src]),
      ...urlsFromState(statePayloads, "image"),
    ].map(fullImageUrl).filter((url) => !/grey[-_]pixel|pkplay-button|play-button-mb-image-grid|video-thumb/i.test(url || ""))).slice(0, 20);
    const videos = unique([
      ...[...document.querySelectorAll("video, video source")].map((node) => node.currentSrc || node.src),
      ...[...document.querySelectorAll("[data-video-url], [data-video-sd-url], [data-video-hd-url]")]
        .flatMap((node) => [node.dataset.videoUrl, node.dataset.videoSdUrl, node.dataset.videoHdUrl]),
      ...urlsFromState(statePayloads, "video"),
      ...[...document.scripts].flatMap((node) => [...String(node.textContent || "").replace(/\\\//g, "/").matchAll(/https?:\/\/[^"'\s]+?\.(?:mp4|m3u8)(?:[?#][^"'\s]*)?/gi)].map((match) => match[0])),
    ]).slice(0, 8);
    const priceText = text("#corePrice_feature_div .a-offscreen, #apex_desktop .a-price .a-offscreen, #priceblock_ourprice");
    const amount = Number((priceText.match(/[\d,.]+/)?.[0] || "").replace(/,/g, ""));
    const currency = location.hostname.includes("amazon.com.mx") ? "MXN" : location.hostname.includes("amazon.ca") ? "CAD" : location.hostname.includes("amazon.co.uk") ? "GBP" : /amazon\.(de|fr|it|es)/.test(location.hostname) ? "EUR" : "USD";
    return {
      source_url: canonicalUrl(),
      target_site_id: "CBT",
      snapshot: {
        source_url: canonicalUrl(), title: text("#productTitle"),
        price: { amount: Number.isFinite(amount) && amount > 0 ? amount : null, currency },
        brand: text("#bylineInfo").replace(/^(Brand:|Visit the)\s*/i, "").replace(/\s*Store$/i, ""),
        bullets: textList("#feature-bullets li, #feature-bullets_feature_div li"),
        description: [...new Set(textList("#productDescription, #productDescription_feature_div, #aplus, #aplus_feature_div, #bookDescription_feature_div"))].join("\n\n").slice(0, 30000), images, video_urls: videos, variants: captureVariants(), technical_details: captureTechnicalDetails(), measurements: {},
      },
    };
  }

  function mount() {
    if (document.getElementById(buttonId)) return;
    const button = document.createElement("button");
    button.id = buttonId;
    button.type = "button";
    button.textContent = automaticSourceId ? `正在自动更新草稿 #${automaticSourceId}…` : "采集到美客多 ERP";
    button.disabled = Boolean(automaticSourceId);
    Object.assign(button.style, { position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647", border: "0", borderRadius: "6px", padding: "10px 14px", background: "#16a34a", color: "#111827", fontWeight: "700", cursor: "pointer" });
    button.addEventListener("click", async () => {
      button.disabled = true; button.textContent = "正在推送...";
      try {
        const response = await chrome.runtime.sendMessage({ type: "MELI_AMAZON_CAPTURE", payload: await capture() });
        if (!response?.ok) throw new Error(response?.error || "美客多 ERP 未接受该商品");
        button.textContent = `已入上架库 #${response.data?.id || ""}`;
      } catch (error) { button.textContent = error?.message || "推送失败"; button.disabled = false; }
    });
    document.documentElement.appendChild(button);
  }

  mount();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING_MELI_AMAZON_COLLECTOR") {
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "MELI_AMAZON_AUTO_CAPTURE_FINISHED") {
      const button = document.getElementById(buttonId);
      if (button) {
        button.disabled = true;
        button.textContent = `已自动更新草稿 #${message.sourceProductId || ""}`;
      }
      return false;
    }
    if (message?.type !== "COLLECT_MELI_AMAZON_PRODUCT") return false;
    const button = document.getElementById(buttonId);
    if (message.automatic && button) {
      button.disabled = true;
      button.textContent = "ERP 正在自动采集…请勿点击";
    }
    const pageText = `${document.title} ${document.body?.innerText || ""}`.toLowerCase();
    if (/robot check|validatecaptcha|enter the characters|captcha/.test(pageText)) {
      if (button) { button.disabled = false; button.textContent = "需要验证后重新采集"; }
      sendResponse({ ok: false, needsHuman: true, error: "Amazon 需要人工验证" });
      return false;
    }
    (async () => {
      try { sendResponse({ ok: true, payload: await capture() }); }
      catch (error) {
        if (button) { button.disabled = false; button.textContent = "自动采集失败，点击重试"; }
        sendResponse({ ok: false, error: error?.message || "Amazon 页面解析失败" });
      }
    })();
    return true;
  });
})();
