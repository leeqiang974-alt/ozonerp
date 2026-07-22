# Auto-Ozon Style ERP Shell Design

## Goal

把本机 Ozon ERP 主前端从“开发功能堆叠”收敛成更像 `auto-ozon` 的 ERP 操作台：左侧稳定业务导航、顶部经营状态条、首页经营驾驶舱、业务对象优先。

## Scope

- 只改主前端结构与视觉骨架：`public/index.html`、`public/styles.css`、必要的 `public/app.js` 文案/映射。
- 不改后端业务逻辑。
- 不改 Ozon 提交、预检、workflow lock、`waiting_human`、GPT/Image 人工确认等安全边界。
- 保留现有页面 id 和按钮 id，避免破坏已开发功能。

## Navigation Model

采用 `auto-ozon` 风格的业务模块顺序：

1. 数据驾驶舱
2. 店铺管理
3. 商品管理
4. 订单管理
5. 仓库库存
6. 营销活动
7. 财务利润
8. 智能选品
9. 上传管理
10. 任务配置
11. 系统配置

本机现有模块映射：

- `dashboard` -> 数据驾驶舱
- `system` -> 店铺管理 / 系统配置
- `products` -> 商品管理
- `orders` -> 订单管理
- `warehouse` -> 仓库库存
- `promotions` -> 营销活动
- `finance` -> 财务利润
- `sourcing` + `research` -> 智能选品
- `listing` -> 上传管理
- `workflow-console` -> 任务配置

## Homepage Shape

首页首屏按 ERP 管理系统组织：

- 顶部状态条：汇率、店铺数量、自动化模式、同步/工作流状态。
- 标题：数据驾驶舱。
- KPI 卡：销售/订单/商品/任务或对应可用统计。
- 主表：店铺经营概览。
- 侧栏：待处理任务。

现有高级说明、流程图、诊断地图继续保留，但视觉优先级降低。

## Visual Direction

- 借鉴 `auto-ozon-preview.html` 的深色侧边栏 + 浅色内容区。
- 卡片半径控制在 8px 左右。
- 颜色保持业务后台风格，避免大面积科技感渐变。
- 主内容强调表格、KPI、任务队列，而不是长说明文字。

## Acceptance Criteria

- 浏览器打开 `/` 时，第一屏明显像 ERP 后台，不再像开发诊断页。
- 左侧导航展示 `数据驾驶舱 / 店铺管理 / 商品管理 / 订单管理 / 仓库库存 / 营销活动 / 财务利润 / 智能选品 / 上传管理 / 任务配置 / 系统配置`。
- 现有关键页面 id、按钮 id 仍存在，静态测试通过。
- `npm test` 与 `npm run lint` 通过。
