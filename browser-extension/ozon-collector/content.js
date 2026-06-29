// Ozon 页面采集 - 内容脚本
(function() {
  "use strict";

  function toAbsUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return "https:" + value;
    if (value.startsWith("/")) return location.origin + value;
    return value;
  }

  function normalizeOzonImageUrl(value) {
    try {
      const url = new URL(String(value || "").replace(/^\/\//, "https://"), "https://www.ozon.ru");
      if (!/(^|\.)ozon\.ru$/i.test(url.hostname) && !/(^|\.)ozonusercontent\.com$/i.test(url.hostname)) return "";
      if (/\/marketing-api\/+banners\//i.test(url.pathname)) return "";
      if (/\/fs-my-account-avatar\//i.test(url.pathname)) return "";
      if (/seller|avatar|logo|icon|badge|sprite|placeholder/i.test(url.pathname)) return "";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function ozonImageScore(url, source) {
    const text = String((url || "") + " " + (source || "")).toLowerCase();
    let score = 0;
    if (/ozonusercontent\.com/.test(text)) score += 20;
    if (/product|product-service|multimedia|s3\//.test(text)) score += 18;
    if (/webgallery|gallery|cover|photo|image/.test(text)) score += 10;
    if (/wc\d{2,4}|ws\d{2,4}|w\d{2,4}|h\d{2,4}/.test(text)) score += 4;
    if (/marketing-api|banner|avatar|seller|logo|icon|badge|sprite|placeholder|my-account/.test(text)) score -= 80;
    if (/\/category\/|\/highlight\//.test(text)) score -= 25;
    return score;
  }

  function collectOzonGalleryImages() {
    const rows = [];
    const scopedSelectors = [
      '[data-widget*="webGallery"] img',
      '[data-widget*="WebGallery"] img',
      '[data-widget*="gallery"] img',
      '[data-widget*="Gallery"] img',
      '[class*="gallery"] img',
      '[class*="Gallery"] img',
      '[class*="swiper"] img',
      '[class*="carousel"] img',
    ];
    scopedSelectors.forEach(function(selector) {
      document.querySelectorAll(selector).forEach(function(image, index) {
        const src = normalizeOzonImageUrl(image.currentSrc || image.src || image.getAttribute("src") || image.getAttribute("data-src") || "");
        if (src) rows.push({ src: src, score: ozonImageScore(src, selector) + 120 - index });
      });
    });
    Array.from(document.images).forEach(function(image, index) {
      const src = normalizeOzonImageUrl(image.currentSrc || image.src || image.getAttribute("src") || "");
      if (!src) return;
      const context = image.closest && image.closest("[data-widget], [class]");
      rows.push({ src: src, score: ozonImageScore(src, context ? context.outerHTML.slice(0, 300) : "") - index / 100 });
    });
    return uniq(rows
      .filter(function(row) { return row.score > 0; })
      .sort(function(a, b) { return b.score - a.score; })
      .map(function(row) { return row.src; }))
      .slice(0, 20);
  }

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    (arr || []).forEach(function(item) {
      const key = String(item || "").trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    return out;
  }

  function parseJsonSafe(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function collectEmbeddedJsonCandidates() {
    const list = [];
    const nextData = document.getElementById("__NEXT_DATA__");
    if (nextData && nextData.textContent) list.push(nextData.textContent);
    document.querySelectorAll('script[type="application/ld+json"], script').forEach(function(s) {
      const txt = String(s.textContent || "");
      if (!txt) return;
      if (txt.includes("aggregateRating") || txt.includes("offers") || txt.includes("webProduct") || txt.includes("productId")) {
        list.push(txt);
      }
    });
    return list;
  }

  function pickFromDeep(obj, keys) {
    if (!obj || typeof obj !== "object") return "";
    const queue = [obj];
    const lower = keys.map(function(k) { return String(k).toLowerCase(); });
    const visited = new Set();
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || typeof cur !== "object") continue;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (Array.isArray(cur)) {
        cur.forEach(function(x) { queue.push(x); });
        continue;
      }
      for (const k of Object.keys(cur)) {
        const lk = k.toLowerCase();
        if (lower.includes(lk)) {
          const v = cur[k];
          if (typeof v === "string" || typeof v === "number") return v;
        }
        const v = cur[k];
        if (v && typeof v === "object") queue.push(v);
      }
    }
    return "";
  }

  function collectImageUrlsFromDeep(obj, limit) {
    const out = [];
    if (!obj || typeof obj !== "object") return out;
    const queue = [obj];
    const visited = new Set();
    while (queue.length && out.length < (limit || 20)) {
      const cur = queue.shift();
      if (!cur || typeof cur !== "object") continue;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (Array.isArray(cur)) {
        cur.forEach(function(x) { queue.push(x); });
        continue;
      }
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (typeof v === "string" && /(https?:)?\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(v)) out.push(toAbsUrl(v));
        if (v && typeof v === "object") queue.push(v);
      }
    }
    return uniq(out).slice(0, limit || 20);
  }

  // Extract search results from Ozon search page
  function extractSearchResults() {
    const items = [];
    
    // Try multiple selectors for Ozon search result cards
    const cards = document.querySelectorAll('[data-widget="searchResultsV2"] a[href*="/product/"], [class*="widget-search-result"] a[href*="/product/"], .tile, .tile-hover-target, a[href*="/product/"][class*="tile"]');
    const seen = new Set();
    
    cards.forEach(function(card) {
      const url = card.href || card.getAttribute("href") || "";
      if (!url || seen.has(url)) return;
      seen.add(url);
      
      // Extract info from card
      const titleEl = card.querySelector('[class*="name"], [class*="title"], [data-widget="searchResultsV2"] .tsBodyL, .tile-name');
      const priceEl = card.querySelector('[class*="price"], [class*="cost"], [data-widget="searchResultsV2"] [class*="price"], .tile-price');
      const ratingEl = card.querySelector('[class*="rating"], [data-widget="searchResultsV2"] [class*="rating"]');
      const reviewEl = card.querySelector('[class*="reviews"], [data-widget="searchResultsV2"] [class*="reviews"], [class*="feedback"]');
      const imageEl = card.querySelector("img");
      
      const title = normalizeTitle(titleEl ? (titleEl.textContent || titleEl.innerText || "").trim() : "");
      if (!title) return;
      
      const priceText = priceEl ? (priceEl.textContent || priceEl.innerText || "").replace(/\s+/g, " ").trim() : "";
      const price = parsePrice(priceText);
      const rating = ratingEl ? parseFloat((ratingEl.textContent || "").replace(",", ".")) : 0;
      const reviewText = reviewEl ? (reviewEl.textContent || reviewEl.innerText || "").trim() : "";
      const reviewCount = parseInt(reviewText.replace(/[^0-9]/g, "")) || 0;
      const image = imageEl ? (imageEl.src || imageEl.getAttribute("src") || "") : "";
      
      items.push({
        url: url.startsWith("http") ? url : "https://www.ozon.ru" + url,
        title: title,
        price: price,
        priceText: priceText,
        oldPrice: 0,
        rating: rating,
        reviewCount: reviewCount,
        image: image,
        position: items.length + 1,
      });
    });
    
    // Fallback: try to extract from JSON-LD or page data
    if (items.length === 0) {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      scripts.forEach(function(s) {
        try {
          const data = JSON.parse(s.textContent);
          if (data.itemListElement) {
            data.itemListElement.forEach(function(el, i) {
              if (el.url) {
                items.push({
                  url: el.url,
                  title: el.name || "",
                  price: el.offers?.price || 0,
                  oldPrice: 0,
                  rating: el.aggregateRating?.ratingValue || 0,
                  reviewCount: el.aggregateRating?.reviewCount || 0,
                  image: el.image || "",
                  position: i + 1,
                });
              }
            });
          }
        } catch(e) {}
      });
    }
    
    return items;
  }

  // Extract product detail from Ozon product page
  function extractProductDetail() {
    var detail = {
      url: window.location.href,
      title: "",
      price: 0,
      oldPrice: 0,
      image: "",
      images: [],
      description: "",
      category: "",
      attributes: [],
      sku: "",
      rating: 0,
      reviewCount: 0,
    };

    // Title (DOM first)
    var titleEl = document.querySelector("h1, [data-widget='webProductHeading'] h1, .product-title");
    if (titleEl) detail.title = normalizeTitle(titleEl.textContent || "");

    // Price
    var priceEl = document.querySelector('[class*="price"], [data-widget="webPrice"]');
    if (priceEl) {
      detail.priceText = (priceEl.textContent || "").replace(/\s+/g, " ").trim();
      detail.price = parsePrice(detail.priceText);
    }

    // Images
    detail.images = collectOzonGalleryImages();
    if (detail.images.length > 0) detail.image = detail.images[0] || "";

    // Description
    var descEl = document.querySelector('[data-widget="webDescription"], [class*="description"], [itemprop="description"]');
    if (descEl) detail.description = (descEl.textContent || "").trim().slice(0, 5000);

    // Category/breadcrumbs
    var catEls = document.querySelectorAll('[class*="breadcrumb"] a, nav a[href*="category"]');
    var cats = Array.from(catEls).map(function(a) { return (a.textContent || "").trim(); }).filter(Boolean);
    detail.category = cats.join(" / ");

    // Attributes / Characteristics
    var attrRows = document.querySelectorAll('[data-widget="webCharacteristics"] tr, [class*="characteristic"] tr, .product-attributes tr');
    attrRows.forEach(function(row) {
      var cells = row.querySelectorAll("th, td, dt, dd");
      if (cells.length >= 2) {
        var name = (cells[0].textContent || "").trim();
        var value = (cells[1].textContent || "").trim();
        if (name && value) detail.attributes.push({ name: name, value: value });
      }
    });

    // Rating
    var ratingEl = document.querySelector('[class*="rating"], [itemprop="ratingValue"]');
    if (ratingEl) detail.rating = parseFloat((ratingEl.textContent || "").replace(",", ".")) || 0;

    // SKU / offer_id
    var skuEl = document.querySelector('[data-widget="webSKU"], [class*="sku"], [itemprop="sku"]');
    if (skuEl) detail.sku = (skuEl.textContent || "").trim();

    // Embedded JSON fallback/enhancement
    var scripts = collectEmbeddedJsonCandidates();
    for (var i = 0; i < scripts.length; i += 1) {
      var data = parseJsonSafe(scripts[i]);
      if (!data) continue;
      if (!detail.title) detail.title = normalizeTitle(String(pickFromDeep(data, ["name", "title"]) || ""));
      if (!detail.description) detail.description = String(pickFromDeep(data, ["description"]) || "").trim().slice(0, 5000);
      if (!detail.price) {
        var p = pickFromDeep(data, ["price", "finalprice", "pricevalue"]);
        var pv = parsePrice(String(p || ""));
        if (pv) detail.price = pv;
      }
      if (!detail.rating) {
        var rv = parseFloat(String(pickFromDeep(data, ["ratingvalue", "rating"]) || "").replace(",", "."));
        if (rv) detail.rating = rv;
      }
      if (!detail.reviewCount) {
        var rc = parseInt(String(pickFromDeep(data, ["reviewcount", "ratingcount", "feedbackcount"]) || "").replace(/[^0-9]/g, ""), 10);
        if (rc) detail.reviewCount = rc;
      }
      if (!detail.sku) detail.sku = String(pickFromDeep(data, ["sku", "offerid", "offer_id", "productid", "product_id"]) || "").trim();
      if (!detail.images.length) detail.images = collectImageUrlsFromDeep(data, 20).map(normalizeOzonImageUrl).filter(Boolean);
    }

    detail.images = uniq(detail.images.map(normalizeOzonImageUrl).filter(Boolean)).slice(0, 20);
    if (!detail.image && detail.images.length) detail.image = detail.images[0];

    // Parse attribute-like text fallback from description block
    if (!detail.attributes.length && detail.description) {
      var lines = detail.description.split(/\n|;|；/).map(function(x) { return x.trim(); }).filter(Boolean).slice(0, 120);
      lines.forEach(function(line) {
        if (!/:|：/.test(line)) return;
        var parts = line.split(/[:：]/);
        if (parts.length < 2) return;
        var name = parts[0].trim();
        var value = parts.slice(1).join(":").trim();
        if (!name || !value || name.length > 40 || value.length > 120) return;
        detail.attributes.push({ name: name, value: value });
      });
    }

    // frontSignals: for ERP learning feedback
    detail.frontSignals = {
      rating: detail.rating || 0,
      reviewCount: detail.reviewCount || 0,
      sku: detail.sku || "",
      imageCount: detail.images.length,
      source: "ozon_front",
      collectedAt: new Date().toISOString(),
    };

    return detail;
  }

  function parsePrice(text) {
    if (!text) return 0;
    var rubMatches = [];
    var re = /(\d[\d\s]{1,8})\s*₽/g;
    var match;
    while ((match = re.exec(text))) {
      var rub = parseInt(String(match[1] || "").replace(/\s+/g, ""), 10);
      if (rub > 0) rubMatches.push(rub);
    }
    if (rubMatches.length) {
      var sane = rubMatches.find(function(p) { return p >= 80 && p <= 8000; });
      return sane || rubMatches[0];
    }
    var cleaned = text.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
    var nums = cleaned.match(/\d+\.?\d*/g);
    if (nums) return parseFloat(nums[0]) || 0;
    return 0;
  }

  function normalizeTitle(text) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    if (/^(скидки недели|похожие|каталог|в корзину)$/i.test(value)) return "";
    return value;
  }

  // Listen for extraction requests from background script
  chrome.runtime.onMessage.addListener(function(message, _sender, sendResponse) {
    if (message.type === "EXTRACT_SEARCH") {
      sendResponse(extractSearchResults());
    } else if (message.type === "EXTRACT_DETAIL") {
      sendResponse(extractProductDetail());
    }
    return true;
  });
})();
