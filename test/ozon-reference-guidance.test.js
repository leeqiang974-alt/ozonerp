import test from "node:test";
import assert from "node:assert/strict";

test("buildReferenceGuidancePrompt asks for per-product copy and image reconstruction guidance", async () => {
  const { buildReferenceGuidancePrompt } = await import("../src/ozonReferenceGuidance.js");
  const prompt = buildReferenceGuidancePrompt({
    product: {
      title: "适用苹果安卓V8迈克四合一弹簧伸缩手机快充数据线车载充电线",
      category: "数据线",
      images: ["https://img.1688.com/sample.jpg"],
      variants: ["蓝色", "黄色"],
    },
    references: [{
      title: "Кабель для зарядки USB спиральный 4-в-1",
      category: "Электроника / Кабели",
      images: ["https://cdn1.ozonusercontent.com/s3/product-service-meta-media/real.jpg"],
    }],
  });

  assert.match(prompt, /按当前单品实时参照/);
  assert.match(prompt, /布局/);
  assert.match(prompt, /色调/);
  assert.match(prompt, /轮播图脚本/);
  assert.match(prompt, /image2/);
  assert.match(prompt, /至少 5 张/);
  assert.match(prompt, /俄语字段不得夹中文/);
  assert.match(prompt, /不要复制竞品/);
  assert.match(prompt, /适用苹果安卓/);
  assert.match(prompt, /Кабель для зарядки/);
});

test("generateOzonReferenceGuidance returns a normalized guidance card", async () => {
  const { generateOzonReferenceGuidance } = await import("../src/ozonReferenceGuidance.js");
  const calls = [];
  const result = await generateOzonReferenceGuidance({
    product: {
      title: "合金回力警车模型儿童玩具车",
      category: "玩具车",
      images: ["https://img.1688.com/car.jpg"],
    },
    references: [{
      title: "Машинка инерционная полицейская",
      category: "Игрушки / Машинки",
      images: ["https://cdn1.ozonusercontent.com/s3/product-service-meta-media/car.jpg"],
    }],
    aiTask: async (payload) => {
      calls.push(payload);
      return {
        ok: true,
        provider: "apimart",
        model: "gpt-5-nano-2025-08-07",
        json: {
          copywriting_guidance: ["标题突出 инерционная машинка 和材质"],
          attribute_guidance: ["材质填写 металл/пластик"],
          image_style_profile: {
            layout: ["主体三分之二偏中", "配件放右下角"],
            color_tone: ["明亮低饱和", "儿童玩具可用浅蓝背景"],
            typography: ["俄语短标签，不超过 4 个词"],
            scene_logic: ["儿童桌面或玩具房场景"],
          },
          carousel_plan: [
            { index: 1, goal: "主图", composition: "车身 75% 占比", text: "без текста" },
            { index: 2, goal: "细节", composition: "轮胎和车门特写", text: "металл + пластик" },
          ],
          image2_prompts: [
            { index: 1, prompt: "真实电商产品摄影，浅蓝背景，警车玩具居中，占画面75%" },
          ],
          quality_checklist: ["必须有尺寸图", "不得出现竞品 logo"],
          risk_flags: ["避免侵权警徽"],
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "apimart");
  assert.equal(result.model, "gpt-5-nano-2025-08-07");
  assert.equal(result.copywritingGuidance[0], "标题突出 инерционная машинка 和材质");
  assert.equal(result.attributeGuidance[0], "材质填写 металл/пластик");
  assert.equal(result.imageStyleProfile.layout[0], "主体三分之二偏中");
  assert.equal(result.carouselPlan[0].goal, "主图");
  assert.match(result.image2Prompts[0].prompt, /警车玩具/);
  assert.equal(result.qualityChecklist[0], "必须有尺寸图");
  assert.equal(result.riskFlags[0], "避免侵权警徽");
  assert.equal(result.referenceSummary.count, 1);
  assert.match(calls[0].userPrompt, /图片风格画像/);
  assert.equal(calls[0].taskType, "ozon_reference_guidance");
  assert.equal(calls[0].responseFormat, "json");
});
