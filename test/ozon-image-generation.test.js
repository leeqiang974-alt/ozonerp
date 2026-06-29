import test from "node:test";
import assert from "node:assert/strict";

import {
  getImageGenerationTask,
  normalizeImageGenerationRequest,
  submitGptImage2Generation,
} from "../src/ozonImageGeneration.js";

test("normalizes GPT Image 2 request defaults for Ozon product images", () => {
  const request = normalizeImageGenerationRequest({
    prompt: "Generate an Ozon-ready product main image",
    imageUrls: ["https://example.com/reference.png"],
  });

  assert.equal(request.model, "gpt-image-2");
  assert.equal(request.prompt, "Generate an Ozon-ready product main image");
  assert.equal(request.n, 1);
  assert.equal(request.size, "1:1");
  assert.equal(request.resolution, "1k");
  assert.deepEqual(request.image_urls, ["https://example.com/reference.png"]);
});

test("rejects GPT Image 2 generation without a prompt", () => {
  assert.throws(
    () => normalizeImageGenerationRequest({ prompt: "   " }),
    /prompt is required/,
  );
});

test("submits APIMart GPT Image 2 generation and returns task id", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ data: [{ task_id: "task_123" }] }),
    };
  };

  const result = await submitGptImage2Generation(
    {
      prompt: "Generate an Ozon-ready product main image",
      imageUrls: ["https://example.com/reference.png"],
      size: "16:9",
      resolution: "2k",
    },
    {
      fetchImpl,
      apiKey: "sk-test",
      baseUrl: "https://api.apimart.ai/v1",
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.provider, "apimart");
  assert.equal(result.model, "gpt-image-2");
  assert.equal(result.taskId, "task_123");
  assert.equal(calls[0].url, "https://api.apimart.ai/v1/images/generations");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: "gpt-image-2",
    prompt: "Generate an Ozon-ready product main image",
    n: 1,
    size: "16:9",
    resolution: "2k",
    image_urls: ["https://example.com/reference.png"],
  });
});

test("normalizes completed APIMart image generation task", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.apimart.ai/v1/tasks/task_123");
    assert.equal(options.method, "GET");
    return {
      ok: true,
      json: async () => ({
        id: "task_123",
        status: "completed",
        progress: 100,
        cost: 0.04,
        credits_cost: 4,
        result: {
          images: [
            {
              url: ["https://upload.apimart.ai/generated.png"],
              expires_at: 1790000000,
            },
          ],
        },
      }),
    };
  };

  const result = await getImageGenerationTask("task_123", {
    fetchImpl,
    apiKey: "sk-test",
    baseUrl: "https://api.apimart.ai/v1",
  });

  assert.equal(result.taskId, "task_123");
  assert.equal(result.status, "completed");
  assert.equal(result.progress, 100);
  assert.equal(result.cost, 0.04);
  assert.equal(result.creditsCost, 4);
  assert.deepEqual(result.imageUrls, ["https://upload.apimart.ai/generated.png"]);
});
