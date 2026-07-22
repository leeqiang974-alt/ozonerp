# ERP Tab 功能归属与 Ozon Seller API 对齐

更新时间：2026-06-11 +08:00

## 目标

把 ERP 从“功能堆在页面里”整理成“主链 + 支撑面板”的结构，明确每个 tab 负责什么、不负责什么，以及哪些功能已经对齐 Ozon Seller API。

## Tab 功能归属

| Tab | 定位 | 归属功能 | 不归属功能 | 下一步流向 |
| --- | --- | --- | --- | --- |
| 总览 | 健康与入口 | 店铺/API 连通、关键指标、最近响应、模块归属地图 | 不采集、不上架、不写库存 | 异常时进入对应业务 tab 或工作流控制台 |
| 学习与机会 | Ozon 学习与机会发现 | Ozon 竞品学习、机会池、反查 1688、规则分析、主链驾驶舱 | 不编辑最终 payload、不写库存 | 输出机会和关键词给 1688 反向选品 |
| 1688反向选品 | 货源采集与候选池 | 1688 搜索任务、详情解析、候选审核、Cookie/人机状态、入采集箱 | 不提交 Ozon、不处理审核回执 | 合格候选进入上架执行或工作流 |
| 上架执行 | 草稿、预检、提交 | 类目/属性读取、俄文内容生成、变体与图片、Payload 草稿、Ozon 提交 | 不替代流程诊断、不批量无确认提交 | 提交后进入审核回执和库存节点 |
| 商品状态 | 在售商品观察 | 商品列表、状态分组、价格读取、商品检索、异常状态查看 | 不采集货源、不重新生成内容 | 状态异常时回到工作流或上架执行修复 |
| 仓库与库存 | 仓库和库存写入 | 仓库读取、库存读取、库存提交、库存队列回放 | 不生成商品、不判断商品审核 | 商品可售或待补库存时执行 |
| 工作流控制台 | 节点诊断与人工介入 | 节点状态、输入/输出/诊断、Payload 校验、重试/继续、摘要导出 | 不是普通运营列表、不自动连点提交 | 所有卡点统一从这里定位和恢复 |
| 订单履约 | FBS 订单运营 | 订单看板、状态筛选、仓库/服务筛选、订单商品明细 | 不处理新品上架、不做采集分析 | 用于发货准备和订单状态追踪 |
| 营销活动 | 活动商品维护 | 活动读取、参与商品、可加入商品、活动商品移除 | 不改商品基础资料、不改库存 | 用于促销维护，不进入上架主链 |

## Ozon Seller API 对齐现状

| 业务区块 | 状态 | 已接入 Seller API | 当前缺口 |
| --- | --- | --- | --- |
| 店铺/仓库 | 已对齐 | `/v2/warehouse/list` | 缺少仓库详情与仓库状态变更类能力，当前只读为主 |
| 类目/属性 | 已对齐 | `/v1/description-category/tree`、`/v1/description-category/attribute`、`/v1/description-category/attribute/values` | 分类树、属性、属性值均按 `ZH_HANS` 读取并本地缓存；仍需继续把必填属性规则沉淀到 preflight 动态校验 |
| 上架/审核 | 部分对齐 | `/v3/product/import`、`/v1/product/import/info` | 提交和回执已接入；人工确认后的 payload-draft-submit 仍需最终安全闸口化 |
| 商品/价格/图片 | 部分对齐 | `/v3/product/list`、`/v3/product/info/list`、`/v4/product/info/prices`、`/v1/product/import/prices`、`/v1/product/pictures/import` | 商品资料更新、归档/恢复等能力尚未系统化 |
| 库存 | 已对齐 | `/v2/products/stocks`、`/v4/product/info/stocks` | 库存队列是本地增强；需继续补商品未就绪时的自动回查策略 |
| 订单履约 | 只读已迁移 | `/v4/posting/fbs/list`、`/v4/posting/fbs/unfulfilled/list`（当前契约；旧 v3 仅兼容） | 订单页已使用 cursor/sort_dir 和本批范围提示；仍缺真实店铺回放，打包、发运、取消、标签等履约动作未接齐 |
| 营销活动 | 部分对齐 | `/v1/actions`、`/v1/actions/products`、`/v1/actions/candidates`、`/v1/actions/products/deactivate` | 已读活动和移除商品；加入活动、活动价策略仍未完整闭环 |
| 采集/工作流/AI | 本地逻辑 | 1688 插件、`workflow_runs.json`、AI 内容/规则 | 不是 Ozon Seller API；必须保留安全边界，输出只能进入预检和人工闸口 |

## 本地化缓存现状

- 分类树：`/v1/description-category/tree` 使用 `ZH_HANS`，落盘到 `data/ozon-category-cache.json` 的 `tree` 与 `flat`。
- 属性元数据：`/v1/description-category/attribute` 使用 `ZH_HANS`，按 `description_category_id:type_id` 缓存在 `attributes`。
- 属性值字典：`/v1/description-category/attribute/values` 使用 `ZH_HANS`，按 `description_category_id:type_id:attribute_id:language` 缓存在 `attributeValues`。
- 佣金：当前定价诊断支持 `learned_product` 与 `manual_default` 来源；`ozon_category` 真实类目佣金来源预留，需按 Ozon 当前官方开放接口继续接入。

## 当前主链

```text
学习与机会
  -> 1688反向选品
  -> 上架执行
  -> 工作流控制台
  -> 商品状态
  -> 仓库与库存
```

订单履约和营销活动是 Ozon 运营支撑模块，不属于新品上架主链。

## 后续开发顺序

1. 继续做 `B：Ozon Seller API 对齐清单`，把缺口拆成可实现接口任务。
2. 做 `C：UI 前端展示修正`，以本文件的模块边界作为页面重排依据。
3. 保持自动化安全边界：采集、AI、工作流只能产出建议和 payload 草稿，不能绕过 preflight 与人工确认直接刷 Ozon 提交。
