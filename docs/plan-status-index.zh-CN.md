# Ozon ERP 历史计划状态索引

更新日期：2026-07-22

当前唯一 active 执行计划是 `docs/TOP-LEVEL-DEVELOPMENT-PLAN.zh-CN.md`。`docs/ROADMAP.zh-CN.md` 负责记录交付和验证证据；以下历史计划不得自行恢复为当前任务。

## 1. 使用方法

本文只治理 `docs/superpowers/plans/` 下的历史实施计划。状态表示该计划作为“当前执行方案”是否仍有效，不等同于业务验证等级：

- `active`：仍有明确未完成交付，且与当前 `ROADMAP` 一致。
- `completed`：计划约定的实现切片已有代码/测试证据；不表示真实账号业务闭环完成。
- `superseded`：目标或交互方向已被后续计划/路线图替代；可保留其中已实现资产。
- `paused`：仍有价值，但缺少前置证据、真实环境或当前优先级，不应继续扩建。

旧文档中的 checkbox 很多没有随实现同步，不能单独作为状态证据。本索引依据当前源码测试、交接记录和后续设计方向保守判定。

## 2. 计划状态

| 历史计划 | 状态 | 判定理由 | 后续归属 |
|---|---|---|---|
| `2026-06-08-workflow-console.md` | `completed` | 工作流运行、节点、事件、锁、草稿、诊断和控制台均已有源码及大量测试；原 checklist 未回填属于文档滞后。技术控制台继续保留为高级诊断，不再主导普通 UX。 | Roadmap Phase 1 高级诊断 |
| `2026-06-12-payload-draft-submit.md` | `completed` | 草稿验证、confirmSubmit、提交事件、task id、人工确认和草稿 hash 绑定已有实现/测试。完成是实现范围结论，真实账号写入仍需 Phase 1 回放。 | Roadmap Phase 1 提交安全门 |
| `2026-06-19-variant-grouping-repair.md` | `completed` | 逐 SKU 变体诊断、整组修复草稿、前端修复卡和测试已存在；旧 checklist 未同步。 | Roadmap Phase 1 多 SKU fixture |
| `2026-06-21-erp-flow-cockpit-ui.md` | `superseded` | 深色、workflow-first 驾驶舱目标已被业务对象 IA、卖家工作台和外部证据路线取代。导航/组件资产可保留，视觉目标不再继续。 | Roadmap Phase 0/1 任务式 UX |
| `2026-06-28-gpt5-ozon-image-observation.md` | `completed` | 图片观察队列、分析接口、前端控制和测试已有实现；仅为本地学习工具，不代表真实商品图片合规或转化有效。 | Roadmap Phase 1 媒体证据子项 |
| `2026-06-28-listing-pipeline-workbench.md` | `superseded` | 九节点展示已实现过，但“流程面板”不再是主要产品目标；后续改为单商品对象和当前步骤。 | Roadmap Phase 1 单商品工作区 |
| `2026-06-28-on-demand-ozon-reference-guidance.md` | `completed` | 按单品指导服务、接口、界面和付费生图前确认已有实现/测试；输出仍是建议，不能作为 Ozon 事实。 | Roadmap Phase 1 内容/媒体辅助 |
| `2026-06-29-ozon-erp-business-domain-restructure.md` | `superseded` | 第一阶段业务导航和面板已落地，但“完整 ERP 域全部进入导航”的扩张方向被验证门纠偏；未验证财务/售后/报表不得因导航存在而称为模块。 | Roadmap Phase 0 导航收敛 |
| `2026-06-30-listing-center-secondary-tabs.md` | `completed` | 八阶段二级 tab 和静态测试已存在；后续应在此基础上减少技术层，而不是继续增加 tab。 | Roadmap Phase 1 单商品工作区 |
| `2026-06-30-ozon-listing-pricing-warehouse-next-plan.md` | `paused` | 已完成部分属性、变体、内容和库存诊断切片，但定价资料版本化、真实佣金/物流、库存真实对账等尚缺外部/账号证据。继续前必须通过 Phase 0 证据门。 | Roadmap Phase 0、1、2 分拆执行 |
| `2026-06-30-product-asset-ledger.md` | `completed` | 商品资产摘要、待处理/在售/审核/归档分组和静态测试已实现；真实分页、状态时效和操作详情仍属于 Phase 2。 | Roadmap Phase 2 商品运营 |
| `2026-07-07-auto-ozon-style-erp-shell.md` | `superseded` | 外部项目风格壳已落地，但硬编码汇率、伪在线和静态经营行证明“仿外观”不能作为产品目标；现由真实同步状态和任务式 UX 取代。 | Roadmap Phase 0 诚实状态 |
| `2026-07-07-erp-business-object-ia-phase1.md` | `completed` | 高频 tab 的业务对象契约、首屏业务面板、渐进披露和回归测试已实现。后续阶段必须用真实卖家任务验证。 | Roadmap Phase 0/1 UX 状态矩阵 |
| `2026-07-07-ozon-erp-automation-cross-development.md` | `completed` | 计划内首轮详情图、rich content、parseIssues、外部 helper 对照与测试已实现；继续借鉴外仓必须重新走证据门，不能把该计划无限延伸。 | Roadmap Phase 0 fixture、Phase 1 媒体 |

当前没有单独标为 `active` 的旧 superpowers plan。当前唯一 active 执行计划是 `docs/TOP-LEVEL-DEVELOPMENT-PLAN.zh-CN.md`；具体实现任务只能从其中标记为 `CURRENT` 的切片领取，不能恢复旧计划的未勾选项。

## 3. 设计规格状态

规格不是执行计划，但需要防止旧视觉目标重新支配产品：

| 规格 | 状态 | 说明 |
|---|---|---|
| `2026-06-12-payload-draft-submit-design.md` | `active reference` | 提交安全设计仍有效，补充以当前草稿 hash 绑定和真实回放。 |
| `2026-06-19-variant-grouping-repair-design.md` | `active reference` | 变体诊断和整组修复边界仍有效。 |
| `2026-06-21-erp-flow-cockpit-ui-design.md` | `superseded` | workflow-first 深色驾驶舱不再是普通用户目标。 |
| `2026-06-29-ozon-erp-business-domain-restructure-design.md` | `partially superseded` | 业务域边界保留；未经验证就铺开完整 ERP 导航的部分失效。 |
| `2026-07-07-auto-ozon-style-erp-shell-design.md` | `superseded` | 可保留组件样式，不再接受伪实时状态或竞品外观驱动。 |
| `2026-07-07-ozon-erp-automation-cross-development-design.md` | `active reference` | 外部仓只作需求/测试参考、安全门不降级的原则继续有效。 |

## 4. 旧计划中的未完成项如何处理

- 与 `ROADMAP` Phase 0–2 一致的内容，拆成新的短任务，并明确证据、验证等级和真实回放要求。
- 仅为了增加大屏、导航、技术诊断、评分或规则面板的内容，不自动迁移。
- 依赖真实 Ozon 写操作、库存、订单或活动的内容，在获得受控账号、权限和回读方案前保持 paused。
- 每个新任务只允许一个主要业务对象和一个可验证结果；完成后更新本索引状态或 Roadmap 矩阵，而不是重写所有旧文档。

## 5. 审计依据

- `docs/SESSION_HANDOFF.zh-CN.md`：历史实现和测试记录，仅作证据线索。
- `docs/erp-ui-information-architecture.zh-CN.md`：业务对象与界面边界。
- `docs/external-evidence-driven-erp-roadmap.zh-CN.md`：外部证据门和黄金路径。
- `docs/ozon-seller-api-gap-backlog.zh-CN.md`：Seller API 缺口。
- `docs/ozon-erp-benchmark.zh-CN.md`：Ozon 专属差距和旧优先级；其“评分面板优先”等结论已由当前黄金路径优先级覆盖。
- 当前源码、测试名称与 Git 历史：用于核实旧 checklist 未回填但实现已经存在的情况。
