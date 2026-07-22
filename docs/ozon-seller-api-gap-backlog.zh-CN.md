# Ozon Seller API 缺口开发清单

更新时间：2026-07-17 +08:00

## 目标

把 ERP 已有功能与 Ozon Seller API 的差距拆成可执行开发任务。优先补齐会影响“采集 → 分析 → 上架 → 审核回馈 → 库存”的闭环能力。

## 2026-07-17 状态校正

P0/P1 表中的部分安全闸、回执模型和只读 UI 已有本地实现与测试，但仍属于 `locally_tested`；没有受控店铺的服务端回执或真实写入对账时，不得把“代码已实现”改写成 Seller API 业务闭环完成。真实账号验证继续以 `docs/ROADMAP.zh-CN.md` 的验证等级和 `docs/SESSION_HANDOFF.zh-CN.md` 为准。

## 优先级规则

- `P0`：影响上架安全、审核回执、库存安全闸口；不做会导致流程继续黑盒化或反复刷接口。
- `P1`：影响日常运营闭环；现阶段可用人工绕过，但长期需要纳入 ERP。
- `P2`：接口兼容、报表、财务、体验增强；不阻塞主链。

## P0：必须先补

| 缺口 | 所属 tab | API | 开发任务 | 验收 |
| --- | --- | --- | --- | --- |
| 上架安全闸口 | 工作流控制台 / 上架执行 | `/v3/product/import`、`/v1/product/import/info` | 补齐 `payload-draft-submit`：只有预检通过、人工确认后才允许提交 Ozon task | 未校验 payload 不能提交；提交后自动写入 `ozon_submit` 事件 |
| 审核回执闭环 | 工作流控制台 / 商品状态 | `/v1/product/import/info`、`/v3/product/info/list` | 把 `task_id` 回查、`product_id`、错误/警告、状态组统一落到 `review_reconcile` 节点 | 审核失败能定位字段、SKU、reasonCode、下一步动作 |
| 库存安全回查 | 仓库与库存 | `/v2/products/stocks`、`/v4/product/info/stocks` | 库存写入前后自动回查商品是否可写库存，失败进入 `stock_sync` 节点 | 商品未就绪时不盲重试，显示中文原因 |

## P1：运营闭环

| 缺口 | 所属 tab | API | 开发任务 | 验收 |
| --- | --- | --- | --- | --- |
| 订单履约动作 | 订单履约 | `/v4/posting/fbs/list`、`/v4/posting/fbs/unfulfilled/list`（旧 v3 仅兼容） | 先迁移订单看板的 cursor/sort_dir 覆盖模型，再拆出待接入动作：打包、发运、取消、标签/条码 | 订单页能明确区分“已读能力”和“待接入动作”，且不把旧 v3 看作当前契约 |
| 商品资料维护 | 商品状态 | `/v3/product/info/list`、`/v1/product/import/prices`、`/v1/product/pictures/import` | 把改价、换图、异常状态修复合并到商品状态页的受控操作面板 | 商品页不再只是列表，能从异常状态进入修复 |
| 营销活动闭环 | 营销活动 | `/v1/actions`、`/v1/actions/products`、`/v1/actions/candidates`、`/v1/actions/products/deactivate` | 补加入活动、活动价校验、移除后的回查刷新 | 活动页能完成“读活动 → 选商品 → 操作 → 回查” |

## P2：兼容和增强

| 缺口 | 所属 tab | API | 开发任务 | 验收 |
| --- | --- | --- | --- | --- |
| 仓库分页与详情 | 仓库与库存 | `/v2/warehouse/list` | 增加分页/详情兼容层，适配 Ozon 仓库列表接口返回变化 | 仓库读取不因返回结构变化而前端空白 |
| 报表与财务 | 总览 / 商品状态 | 待选：Analytics / Finance / Reports | 先做接口调研和字段地图，不进入自动化主链 | 形成独立调研文档，不影响现有上架流程 |

## 不属于 Seller API 的本地能力

以下能力不能当作 Ozon 官方能力来处理，只能输出到预检和人工闸口：

- 1688 页面采集和详情解析。
- Ozon 前台竞品学习。
- AI 标题、描述、属性建议。
- 利润和匹配判断。
- 工作流节点诊断、人工介入、自动修复建议。

## 推荐开发顺序

1. `payload-draft-submit` 安全提交闸口。
2. `review_reconcile` 回执标准化。
3. `stock_sync` 库存安全回查。
4. 商品状态页受控修复入口。
5. 订单履约动作地图。
6. 营销活动闭环。
7. 仓库接口兼容层。
8. 报表/财务接口调研。

## 安全边界

- 任何自动化都不能绕过 `preflight_check`。
- 任何 Ozon 提交都必须写入 workflow 事件。
- 任何失败都必须回到对应节点，而不是继续刷浏览器或重复提交。
- 1688、AI、Ozon 前台学习只提供建议和草稿，不直接提交到 Ozon Seller API。
