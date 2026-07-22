# Ozon 外部 Helper 项目交叉参考

更新时间：2026-07-07

本文件记录 `kennard520/ozon-helper` 与 `Linuxpizi/auto-ozon` 对本机 Ozon ERP 的可借鉴点。外部仓库只作为需求、测试样例和架构参考，不作为整仓合并来源。

## 可借鉴映射

| 外部项目模块 | 可借鉴点 | 本机目标模块 | 当前处理 |
| --- | --- | --- | --- |
| `ozon-helper/ozon-seller-helper-ext/parse-1688.js` | 1688 商品详情、SKU、图片、包装信息解析思路 | `src/collector1688.js`、`test/collector1688-parser.test.js` | 已吸收详情图、富内容候选、`parseIssues` 方向 |
| `ozon-helper/ozon-seller-helper-ext/product-parse.js` | Ozon 竞品页字段采集、标题/图片/价格样本 | 未来 Ozon 竞品采集器、`src/ozonLearning.js` | 后续作为竞品学习和图片风格观察参考 |
| `ozon-helper/apps/webui` | 上架工作台分阶段处理、采集结果到草稿的界面流 | `public/app.js`、工作流控制台 | 已加强采集缺口提示，后续可继续优化草稿质量状态 |
| `ozon-helper/packages/ozon_api` | Seller API client 分层、类目/属性/佣金/realFBS 路由覆盖 | `src/ozon.js`、`src/server.js`、`docs/ozon-seller-api-gap-backlog.zh-CN.md` | 作为 API 覆盖缺口清单来源 |
| `ozon-helper/packages/ozon_common` | 数据访问层、任务对象、状态统一 | `src/workflowRuns.js`、`src/jobRepository.js` | 参考状态命名，不替换本机数据层 |
| `Linuxpizi/auto-ozon/backend` | FastAPI/SQLite/调度任务组织方式、店铺/订单/财务同步领域划分 | `src/server.js`、订单/财务/库存模块 | 参考业务域，不迁移 Python 架构 |
| `Linuxpizi/auto-ozon/frontend` | ERP 面板维度、店铺运营页组织 | `public/index.html`、`public/app.js` | 仅参考卖家运营视角 |
| `Linuxpizi/auto-ozon/extension` | 浏览器采集与本地 ERP 通信形态 | 本机 1688 采集助手、`src/crawler1688.js` | 仅吸收可诊断采集队列思路 |

## 禁止导入项

- 不导入任何绕过 Ozon 提交前预检、人工确认、workflow lock、`waiting_human` 的直接发布路径。
- 不导入硬编码远程后端地址、外部固定 IP、个人 token、cookie 或店铺凭证。
- 不导入会绕过浏览器人机验证的逻辑；遇到验证码必须暂停并返回人工处理。
- 不导入弱价格逻辑；价格、`old_price`、`min_price`、佣金、物流费和利润底线必须遵守 `docs/pricing-logic.zh-CN.md`。
- 不把促销模块和上架草稿字段混放；促销仍不能包含 listing draft 字段。
- 不整仓合并外部项目，不替换本机 Node/Express 工作流与测试体系。

## 自动化演进方向

| 自动化层级 | 目标 | 安全门 |
| --- | --- | --- |
| L1 采集自动化 | 1688/Ozon 信息稳定采集，输出结构化缺口 | 人机验证暂停，`parseIssues` 可见 |
| L2 草稿自动化 | 标题、图片、富内容、属性、尺重、价格形成本地草稿 | payload 校验，不提交 |
| L3 修复自动化 | 对可解释、低风险字段生成本地修复建议 | `waiting_human` 下人工确认写回 |
| L4 提交流程半自动 | 预检通过后进入明确提交确认 | 显式人工确认，记录 workflow event |
| L5 运营闭环 | 审核回馈、库存、订单、价格复盘进入任务队列 | 风险节点可追溯，可暂停可回滚 |

## 近期优先级

1. 继续补 1688 parser fixture，尤其是 SKU 规格、详情图、包装尺重和异常页。
2. 对照 `ozon-helper` 的 API 覆盖，补齐类目属性、佣金、realFBS、库存、审核回馈的本机缺口清单。
3. 把可规则化的人工属性修复沉淀为候选规则，但默认仍只读展示。
4. 单独规划可配置佣金与物流路由表，避免和采集解析改动混在一起。
