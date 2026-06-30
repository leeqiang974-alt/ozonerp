# Ozon ERP 专属经验学习与当前差距评估

更新时间：2026-06-30

## 结论

这次学习确认：Ozon ERP 不能只按通用 ERP 的商品、库存、订单、财务模块来设计。Ozon 上架成败主要受 `description_category_id/type_id`、当前类目属性字典、变体可变特性、内容评分、媒体素材和审核回执影响。

当前系统方向总体正确：已经围绕 Ozon 草稿、属性矩阵、预检闸口、字典候选、人工确认、pricing blocked、工作流锁做了 Ozon 专属逻辑；不是单纯泛 ERP。

但还缺三块 Ozon 专属能力：内容评分模型、类目/属性填写的可解释人工确认、媒体结构化质量闸。后续开发优先级应继续围绕“让一个商品成功上架并提高展示分值”，而不是先扩通用 ERP 报表。

## 学习来源

### Ozon 官方/准官方规则

- Ozon Seller API `type_id` 说明：`/v3/product/import` 和商品属性回读都依赖商品类型；`type_id` 是上架和属性解释的核心。
  - https://dev.ozon.ru/start/334-Ispolzovanie-polia-type-id-v-Seller-API/
- Ozon Seller API 自动导入/更新商品：导入或更新商品需要二级类目和商品类型，即 `description_category_id` 与 `type_id`。
  - https://dev.ozon.ru/start/294-Avtomaticheskii-import-i-obnovlenie-tovarov-v-Seller-API/
- Ozon Seller API 更新：`/v3/product/import`、`/v1/description-category/tree`、`/v1/description-category/attribute`、`attribute_complex_id`、`type_id` 都是商品导入链路的关键字段。
  - https://dev.ozon.ru/news/270-Vazhnye-izmeneniia-v-Seller-API/
- Ozon 属性值搜索：官方曾新增 `/v1/description-category/attribute/values/search`，说明“找合法字典值”是平台专门支持的流程，不应靠猜 ID。
  - https://dev.ozon.ru/news/410-Novyi-metod-poiska-po-spravochnym-znacheniiam-kharakteristiki/
- 内容评分新规则：Ozon 2026 年更新内容评分权重，商品特征项权重下降，媒体内容更重要。
  - https://seller.ozon.ru/media/news/povyshajte-konversiyu-v-pokupku-cherez-novyj-kontent-rejting/
- Seller Edu 内容评分：内容评分由媒体、特征和描述组成，总分 100。
  - https://seller-edu.ozon.ru/work-with-goods/reference-goods/content-rating
- Seller Edu 标杆商品卡：建议围绕标题、图片/视频、rich-content、商品特征和竞品卡片学习来提升商品卡质量。
  - https://seller-edu.ozon.ru/work-with-goods/reference-goods/etalonnye-kartochki
- Seller Edu 商品卡错误：特征与真实商品不一致会成为商品卡错误来源。
  - https://seller-edu.ozon.ru/work-with-goods/oshibki-pri-rabote-s-kartochkami
- Ozon 在线表格/模板批量创建商品：批量上架不是泛 ERP 导入表，而是按 Ozon 类目模板填写商品字段。
  - https://seller-edu.ozon.ru/work-with-goods/zagruzka-tovarov/creating-goods/cherez-online-tablitcu
- Ozon 商品列表/状态：商品上传后还要看审核、错误、上架状态。
  - https://seller-edu.ozon.ru/work-with-goods/zagruzka-tovarov/created-goods/spisok-i-statysi-tovara

### 同类 Ozon 工具/集成经验

- SelSup 批量创建 Ozon 商品卡：流程是导入商品、设置 Ozon 类目、配置必填参数、先填 1 个商品、再批量填写参数、最后导入 Ozon。
  - https://selsup.ru/help/perenos-kartochek-tovarov-v-ozon/
- SelSup AI Formalizer：AI 可以根据文本描述建议 marketplace 参数，但必须由卖家检查并确认；且必须先选择 marketplace 类目，否则参数不会出现。
  - https://selsup.ru/help/formalizator-ai-funktsiya-dlya-mgnovennogo-zapolneniya-parametrov-v-kartochke/
- МойСклад Ozon 集成：主能力集中在商品、价格、库存、订单同步，说明运营 ERP 层重要，但不等同于上架自动化核心。
  - https://www.moysklad.ru/integratsii/apps/tigratika-ozon-tigratika/
  - https://support.moysklad.ru/hc/ru/онлайн%20торговля/маркетплейсы/ozon
- Ozon Seller 2.0 / Topseller Connect：同类集成强调订单、商品、价格、库存、利润/费用同步；对我们来说这是后续店铺运营层，不应抢在上架成功率之前。
  - https://www.moysklad.ru/integratsii/apps/ozon-seller/
  - https://topseller.ru/integraciya-s-ozon
- Ozon rich-content 经验：rich-content 是商品卡转化和内容表达的重要媒体层，不只是普通描述文本。
  - https://seller-edu.ozon.ru/work-with-goods/trebovaniya-k-kartochkam-tovarov/media/rich-content
  - https://seller.ozon.ru/media/boost/chto-takoe-rich-kontent-i-kak-ego-sozdat/

## 对当前系统的评估

### 已经符合 Ozon 专属方向

1. 上架链路围绕 Ozon 草稿与预检，而不是泛商品表。
   - `buildListingPayloadDraftFromJob()` 已生成 `description_category_id/type_id`、价格、图片、属性、变体等 Ozon payload。
   - `submitPayloadDraftToOzon()` 仍保留预检和人工确认，不允许绕过。

2. 类目属性字典方向正确。
   - 已缓存 Ozon 分类、属性、字典值。
   - 已有 `docs/ozon-required-attributes-analysis.zh-CN.md` 和 `docs/ozon-dictionary-fill-rules.zh-CN.md`。
   - 最近补齐的品牌无品牌、原产国中国遵守当前类目合法字典值，不硬编码 ID。

3. 字典修复采用同类工具经验中的“建议 + 人工确认”模式。
   - 属性矩阵能展示非法字典值候选。
   - 本地写回必须人工确认，并重新预检。
   - 普通文本属性也只能人工输入，不自动提交 Ozon。

4. 变体 aspect 已进入阻塞模型。
   - 多 SKU 缺少 `is_aspect=true` 元数据会阻塞。
   - 可变特性重复会阻塞。
   - 这符合 Ozon 商品卡合并逻辑。

5. 定价与安全门没有被“自动化率”绑架。
   - pricing blocked、workflow lock、waiting_human、人工提交确认都还在。
   - 这是 Ozon ERP 的核心安全能力，不是效率问题。

### 需要改进的 Ozon 专属差距

1. 内容评分模型还太粗。
   - 现在只有图片数量阻塞/警告和一些 listing quality 提示。
   - Ozon 经验要求按媒体、特征、描述/rich-content 分组看分值，尤其 2026 年媒体权重更重要。
   - 应新增“商品分值预估/缺口清单”，而不是只显示图片少于 3 张。

2. 类目/type 选择需要可解释与可人工切换。
   - 当前已有 `matchCategory()` 和 `description_category_id/type_id` 写入，Claude 认为“没有 mapping”不完全准确。
   - 真正缺口是：为什么选这个 type、有哪些备选 type、每个 type 的必填属性/佣金/内容要求差异是什么、人工切换后会发生什么。

3. 必填属性补齐还没有形成完整策略引擎。
   - 已完成高置信：品牌、原产国。
   - 型号名称已有自动值，但前端缺少“来源解释”和“同组 SKU 必须一致”的显式提示。
   - `类型`、材质、用途、适用对象等中置信字典字段还需要候选推荐 + 人工确认，不应直接自动写。

4. 媒体结构不够 Ozon 化。
   - 当前 payload 主要是 `images` 数量和图片 URL。
   - 应区分主图、SKU 图、详情图、视频、视频封面、rich-content、图片文字风险。
   - 1688/PDD 图片不能只作为素材堆，需要进入 Ozon 内容评分与审核风险模型。

5. 同类工具的“先填一个样板商品，再批量应用”还没成为产品能力。
   - SelSup 的经验不是单纯 Excel，而是类目级默认参数和样板商品。
   - 我们应做“类目规则模板”：某个 Ozon type 下品牌、原产国、型号、包装数量、常见材质/用途候选、图片要求、人工确认策略。

6. 审核回执与上架后分值回读还不足。
   - Ozon 同类工具强调商品、价格、库存、订单同步；上架后还要知道商品状态。
   - 我们已有审核回执/失败修复入口，但需要进一步读取商品状态、属性回读、内容评分/缺口、图片状态，并反哺修复面板。

## Claude NVIDIA 分析与纠偏

本轮已用 `scripts/claude-code-nvidia.ps1` 做两次分析。

Claude 提出的有效方向：

- 内容评分/竞品卡片分析是必须补的 Ozon 专属能力。
- 媒体结构要升级，不能只停留在泛图片数组。
- 同类工具普遍有批量模板/样板商品/参数批量应用能力。
- 字典值必须按当前类目合法值验证。

需要纠偏的地方：

- Claude 认为当前“没有 `description_category_id/type_id` mapping”，这不准确。当前已有 `matchCategory()` 和 payload 写入；缺口是解释、人工切换、候选差异比较。
- Claude 认为品牌/原产国处理“过于硬编码”，这也需要区分。当前实现没有硬编码 `dictionary_value_id`，而是从当前类目字典值匹配；这个方向符合 Ozon API 边界。
- Claude 建议“structured media object”可作为内部质量模型推进，但真正提交到 Ozon 仍要遵守 Seller API 当前 payload 字段，不应为了抽象而改坏 API 结构。

## 后续开发优先级

### P0：Ozon 内容评分预估面板

目标：让卖家看到当前商品离 Ozon 高分商品卡还差什么。

先做本地预估，不调用真实写接口：

- 媒体：主图、SKU 图、详情图、视频、rich-content、图片数量、图片文字/水印风险。
- 特征：必填属性覆盖率、字典合法率、可变特性唯一性、中置信候选待确认数。
- 描述：俄文标题、描述长度、rich-content JSON 可用性、hashtags。
- 输出：分值分组、阻塞项、建议项、下一步按钮。

### P1：类目/type 决策卡

目标：把“为什么选这个 Ozon type”变成可检查的业务对象。

- 展示当前 `description_category_id/type_id`。
- 展示 3 个候选 type、匹配原因、风险、必填属性数、已缓存字典值覆盖。
- 允许人工切换 type，但切换后只重建本地草稿并重新预检，不提交 Ozon。

### P2：类目规则模板

目标：复用 SelSup “先填 1 个商品，再批量应用参数”的经验。

- 对每个 Ozon type 保存规则模板：
  - 高置信默认值：品牌、原产国、包装数量等。
  - 中置信候选字段：类型、材质、用途、适用对象。
  - 禁止自动字段：危险等级、成分、保质期、制造商等。
- 模板来源可以是人工确认、Ozon 竞品学习、历史成功商品回读。

### P3：媒体结构化质量闸

目标：让素材库不仅存图片，还能回答“这组图能不能拿 Ozon 高分”。

- 分类主图、SKU 图、详情图、场景图、尺寸图、视频/rich-content。
- 接入现有 Ozon 图片风格学习和 GPT Image 2，但继续保持人工点击和成本确认。
- 图片质量只进入草稿/预检建议，不自动上传或生成。

### P4：审核回执与商品状态回读

目标：让失败修复闭环。

- 读取 Ozon 商品状态、审核错误、属性回读、图片状态、内容评分。
- 对比本地草稿与 Ozon 回读值，形成“平台实际接受了什么/拒绝了什么”。
- 反哺属性规则和内容评分预估。

## 明确不要被泛 ERP 分散的事

- 暂时不要把主要精力放在通用库存、财务、订单大看板。
- 不要先做多平台抽象层。
- 不要追求“自动化率”指标来削弱人工确认。
- 不要把 PDD/1688 采集做成上架主线的替代品；它们只是货源和素材输入。
- 不要让营销活动页出现分类、属性、描述、图片采集等上架字段。

## 下一步建议

下一次开发优先做 P0：`Ozon 内容评分预估面板`。

最小高价值切口：

1. 新增本地 `buildOzonContentScore()`。
2. 输入当前 payload、attrsMeta、图片/内容信息。
3. 输出 `mediaScore`、`characteristicsScore`、`descriptionScore`、`blockingIssues`、`improvementHints`。
4. 在工作流/上架中心预检区显示“商品分值缺口”。
5. 不调用 Ozon 写接口，不生成图片，不提交 payload。
