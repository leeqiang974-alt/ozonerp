function cleanText(v, max) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, max || 160);
}

export function buildVisualCardPrompt({ ozonContext = {}, listingContent = {}, candidate = {} } = {}) {
  const headline = cleanText(listingContent.title_ru || ozonContext.title || "", 160);
  const subline = cleanText(listingContent.product_type_ru || "", 80);
  const sourceImage = Array.isArray(candidate.images) && candidate.images[0] ? String(candidate.images[0]) : "";
  const style = cleanText(process.env.OZON_VISUAL_CARD_STYLE || "high-conversion catalog card, sharp product edges, studio lighting", 180);
  const bg = cleanText(process.env.OZON_VISUAL_CARD_BG || "clean light background", 80);
  return [
    "Create a realistic ecommerce visual card for Ozon marketplace.",
    "Language: Russian only.",
    "Show product clearly centered on " + bg + ".",
    "Avoid logos, brand claims, watermarks, QR codes, UI chrome.",
    "Headline: " + headline,
    "Subline: " + subline,
    "Style: " + style + ".",
    sourceImage ? ("Reference image URL: " + sourceImage) : "No reference image URL.",
    "Output: square 1:1, high detail, ready for product listing.",
  ].join(" ");
}

