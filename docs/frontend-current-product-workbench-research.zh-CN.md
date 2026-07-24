# 当前商品工作台：外部证据与设计决策

## 结论

当前 G2 阶段不再把首页设计成全域经营驾驶舱，而是设计成“一个真实商品、一个明确状态、一个安全动作”的上新工作台。店铺经营、历史工作流、规则池和完整编辑表保留在高级区域，不占用卖家首屏。

## 外部证据

- Shopify Polaris 的资源索引模式把列表作为摘要和导航入口，具体操作进入单资源详情页；筛选、排序和批量动作属于列表上下文，而不是单资源主任务。来源：<https://polaris-react.shopify.com/components/tables/index-table?example=index-table-without-checkboxes>、<https://polaris-site-prod-kit.shopify.prod.shopifyapps.com/patterns/resource-index-layout>。
- Polaris 的通用动作指南强调动作应放在上下文中，避免同时出现过多高强调按钮，并在动作后反馈结果。来源：<https://polaris-react.shopify.com/patterns/common-actions/overview>。
- Polaris 的空间组织指南强调按层级分组相关内容，减少无意义分隔和视觉噪声。来源：<https://polaris-react.shopify.com/design/layout/spacial-organization>。
- Ozon 官方商品内容文档把商品编辑和媒体处理放在商品卡片的明确标签页内，错误进入错误入口处理，而不是把所有工具堆在一个首屏。来源：<https://docs.ozon.ru/global/products/upload/adding-content/videocover/>。
- 开源 Ozon ERP `Shawn220528/ozon-erp` 的发布页使用“类目 → 商品信息 → 结果”的有限步骤，在线商品页使用状态筛选、列表和详情抽屉。可借鉴其任务分段，但其 README 声明和实现不足以证明真实 Ozon 安全门，因此不复制业务事实。来源：<https://github.com/Shawn220528/ozon-erp>。
- Vendure 的商品详情使用单商品页面、主/侧栏信息块和单一保存动作；只有无变体时才询问“简单商品或带选项商品”，避免无必要中间步骤。来源：<https://github.com/vendurehq/vendure>。

## 本项目采用

1. 首页首屏只显示当前真实 1688 商品、店铺与 Offer、链路进度、系统已完成事项和卖家唯一下一步。
2. 首页、全局任务条和商品草稿页共用同一当前商品解析规则。
3. 当前真实 capture 存在时，只允许匹配 `entity.candidateId === capture.id` 且 `entity.storeId === capture.storeId` 的 workflow；没有精确 workflow 就显示来源确认门，禁止退回最近历史或 Fixture workflow。
4. 提交、重建、回查、规则池、完整表单和历史诊断默认折叠；通过当前阶段门后才在相应上下文中出现。
5. 每个主动作同时说明点击后的副作用，真实 Ozon 提交仍受 preflight 和人工确认保护。

## 本项目不采用

- 不因外部 ERP 有更多模块就在 G2 扩建订单、活动、财务或售后。
- 不把 GitHub 项目 README 当作 Ozon 接口事实或真实账号验证。
- 不以“界面上已有字段”为理由宣称业务链路完成。

## 验证

- 静态测试检查 current capture 与 workflow 的精确绑定，禁止 Fixture/最近 workflow 回退。
- 浏览器分别验证工作台和商品草稿页使用同一真实商品、同一状态和同一主动作。
- 不点击“确认当前快照”，不调用 Seller API，不执行付费模型或 Ozon 写入。
