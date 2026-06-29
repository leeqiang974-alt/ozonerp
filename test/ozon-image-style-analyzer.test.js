import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("analyzeOzonImageStyleQueue saves GPT image observations", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ozon-image-style-analysis-"));
  const oldDir = process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR;
  process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR = dir;
  try {
    const { analyzeOzonImageStyleQueue } = await import(`../src/ozonImageStyleAnalyzer.js?case=${Date.now()}`);
    const calls = [];
    const result = await analyzeOzonImageStyleQueue({
      limit: 1,
      observations: {
        visionQueue: [{
          id: "sample-1",
          title: "Кабель USB",
          category: "Электроника / Кабели",
          url: "https://www.ozon.ru/product/sample-1",
          images: [
            "https://cdn1.ozonusercontent.com/s3/product-service-meta-media/sample-main.jpg",
            "https://cdn1.ozonusercontent.com/s3/product-service-meta-media/sample-detail.jpg",
          ],
        }],
      },
      aiTask: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          provider: "apimart",
          model: "gpt-5-nano-2025-08-07",
          json: {
            product_type: "USB cable",
            image_sequence: ["main product", "detail closeup"],
            observed_facts: ["no preset style labels"],
            listing_guidance: ["keep cable connectors visible"],
            risk_flags: ["none"],
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.totalAnalyzed, 1);
    assert.equal(result.rows[0].productType, "USB cable");
    assert.equal(result.rows[0].provider, "apimart");
    assert.match(calls[0].userPrompt, /Кабель USB/);
    assert.match(calls[0].userPrompt, /sample-main\.jpg/);
    assert.equal(calls[0].responseFormat, "json");

    const saved = JSON.parse(await readFile(path.join(dir, "ozon-image-style-analysis.json"), "utf8"));
    assert.equal(saved.rows[0].listingGuidance[0], "keep cable connectors visible");
  } finally {
    if (oldDir === undefined) delete process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR;
    else process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test("analyzeOzonImageStyleQueue removes marketing images before GPT analysis", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ozon-image-style-analysis-"));
  const oldDir = process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR;
  process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR = dir;
  try {
    const { analyzeOzonImageStyleQueue } = await import(`../src/ozonImageStyleAnalyzer.js?case=${Date.now()}`);
    const calls = [];
    const result = await analyzeOzonImageStyleQueue({
      limit: 1,
      observations: {
        visionQueue: [{
          id: "sample-2",
          title: "Холсты",
          category: "Хобби / Холсты",
          url: "https://www.ozon.ru/product/sample-2",
          images: [
            "https://cdn1.ozonusercontent.com/s3/marketing-api/7e/ta7/wc100/banner.png",
            "https://cdn1.ozonusercontent.com/s3/product-service-meta-media/real-product.jpg",
          ],
        }],
      },
      aiTask: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          json: {
            product_type: "canvas",
            image_sequence: ["real product"],
            observed_facts: ["real product image only"],
            listing_guidance: ["use product images"],
            risk_flags: ["none"],
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.latestRows[0].images.length, 1);
    assert.match(result.latestRows[0].images[0], /real-product\.jpg/);
    assert.doesNotMatch(calls[0].userPrompt, /marketing-api/);
    assert.match(calls[0].userPrompt, /real-product\.jpg/);
  } finally {
    if (oldDir === undefined) delete process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR;
    else process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test("analyzeOzonImageStyleQueue drops dirty cached analysis rows", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ozon-image-style-analysis-"));
  const oldDir = process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR;
  process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR = dir;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "ozon-image-style-analysis.json"), JSON.stringify({
      ok: true,
      builtAt: "2026-06-28T00:00:00.000Z",
      totalAnalyzed: 1,
      rows: [{
        id: "dirty-cached",
        title: "Cached banner",
        images: ["https://cdn1.ozonusercontent.com/s3/marketing-api/old/banner.png"],
        riskFlags: ["old dirty row"],
        analyzedAt: "2026-06-28T00:00:00.000Z",
      }],
      summary: { riskCount: 1, productTypes: [] },
    }), "utf8");

    const { analyzeOzonImageStyleQueue } = await import(`../src/ozonImageStyleAnalyzer.js?case=${Date.now()}`);
    const result = await analyzeOzonImageStyleQueue({
      limit: 1,
      observations: { visionQueue: [] },
      aiTask: async () => {
        throw new Error("should not analyze an empty queue");
      },
    });

    assert.equal(result.totalAnalyzed, 0);
    assert.equal(result.rows.length, 0);
  } finally {
    if (oldDir === undefined) delete process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR;
    else process.env.OZON_IMAGE_STYLE_ANALYSIS_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});
