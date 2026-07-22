# Ozon ERP GitHub 工程对照（2026-07-17）

## 结论先行

本次检索没有找到一个同时满足“公开源码、有明确许可证、持续维护、真实实现 1688→Ozon 全链路”的 GitHub 项目。因此 GitHub 只能作为 Seller API 客户端、数据快照和测试组织方式的工程参考，不能作为 Ozon 业务事实、类目映射或 1688 页面解析规则的依据。

目前最值得借鉴的是 `gam6itko/ozon-seller` 的“已实现方法清单”和测试组织方式；`salacoste/ozon-daytona-seller-api` 可参考 TypeScript API 分类、类型和 fixture 结构，但其 README 中的覆盖率、生产规模和端点数量均需要逐项复核；`pavelhalanin/ozon-seller-database` 可参考只读快照→规范化→SQLite 的分层，但不能直接作为 ERP 同步实现。

## 评估方法

检索日期：2026-07-17。每个候选项目至少核对：

1. GitHub 源码树中是否存在实现代码、测试和许可证；
2. 提交/发行/问题等公开活跃度信号；
3. README 宣称与可见源码、脚本、测试是否一致；
4. 能否安全映射到本项目的 Seller API 适配层、1688 采集、业务预检和回执模型。

“有 endpoint 类/函数”只证明代码存在，不证明该 endpoint 在当前 Ozon 文档或真实店铺上可用；所有业务能力仍需以本地 Seller API 文档 `D:\Desktop\ozonseller api\Ozon Seller API 文件.html`、四个店铺 API 记录和受控真实只读回执验证。

## 候选仓库

### 1. gam6itko/ozon-seller

- 仓库：[github.com/gam6itko/ozon-seller](https://github.com/gam6itko/ozon-seller)
- 定位：PHP Ozon Seller API client，MIT license。
- 可见工程证据：仓库页显示 `src/`、`tests/`、`examples/`、CI workflow、`bin/is_realized.php`；332 commits、122 stars、51 forks、48 releases，页面列出的最新稳定版本为 `v0.25.0`（2026-05-12）。`composer.json` 声明 MIT、PHP >=7.1、PHPUnit、Psalm，并提供 `tests` 脚本。
- README 与实现的对应：README 明确承认未实现的方法会输出 `NotRealized`，示例覆盖 categories、posting、product import，并展示 `task_id` 查询思路。这是比“全覆盖”更可审计的能力矩阵。
- 可借鉴：
  - 为每个 Seller API endpoint 维护 `implemented / not_implemented / response fixture / last verified` 矩阵；
  - 将接口调用封装为薄 client，业务状态和卖家任务留在 ERP 层；
  - 用 PHPUnit/HTTP client 替身回放响应，不把 README 示例当作真实验证。
- 不能借鉴：
  - 不能直接复制旧的 `/v1/product/import`、sandbox host 或旧字段；当前 Ozon 文档可能已经变更；
  - 不能把“有 PHP 方法”当作当前店铺可写；本项目仍需预检、人工确认、幂等和未知结果 `needs_review`。
- 对本项目任务：建立 `docs/seller-api-capability-matrix.zh-CN.md` 或扩充现有 API matrix，记录四店铺范围、文档版本、响应 fixture 和验证等级；优先补商品读取、类目/属性读取、库存读取和 FBS 读取，而不是一次性追求所有端点。

### 2. salacoste/ozon-daytona-seller-api

- 仓库：[github.com/salacoste/ozon-daytona-seller-api](https://github.com/salacoste/ozon-daytona-seller-api)
- 定位：TypeScript SDK；仓库页声明 MIT，66 commits、12 stars、5 forks、1 issue、10 pull requests，并可见 `src/`、`tests/`、`vitest` 配置、API 文档生成和 CI 脚本。GitHub 页面显示最新 release `v2.2.23` 为 2025-09-08；搜索索引给出的更新时间不能替代提交历史证据。
- README/`package.json` 宣称：278 methods、33 categories、95%+ coverage、生产级、性能和安全指标。`package.json` 可见 `test`/`test:coverage`、`nock`、`vitest`、`zod` 和 `validate:structure`；这证明存在测试和结构校验脚本，但不能从 README 直接证明 95% 覆盖率、100% 当前 Seller API 覆盖、真实生产使用或列出的性能指标。
- 可借鉴：
  - TypeScript 类型层、按业务类别拆 client、生成 API 文档和 `nock` 响应替身；
  - 对 SDK 做结构校验、类型检查、lint、构建和覆盖率分层；
  - 把 API 适配层与 ERP 业务流程分离，避免将 SDK 方法暴露成卖家 UI 动作。
- 不能借鉴：
  - 不能采信其“278/33/95%/production ready”作为事实；需要逐类别对照本地 Seller API HTML 和真实响应；
  - README 示例含价格更新、FBS 发货和 webhook 等写操作，不能复制到本项目绕过确认/回读门槛；
  - “processAllOrders”一类示例不能作为真实 FBS 状态机，因为没有证明其状态转换、幂等和未知回执处理。
- 对本项目任务：只借鉴 API 分类、类型定义、fixture 和测试脚手架；为每个写操作增加本项目的 `preflight → human confirmation → idempotency → post-read reconciliation` 包装层。

### 3. pavelhalanin/ozon-seller-database

- 仓库：[github.com/pavelhalanin/ozon-seller-database](https://github.com/pavelhalanin/ozon-seller-database)
- 定位：PHP 定时下载 Ozon Seller API 数据，规范化到 JSON/目录后写入 SQLite；GPL-3.0 license。
- 可见工程证据：仓库页显示 8 commits、0 stars、无公开 tests 目录；README 提供 `--download-all --normolize-all --save-to-sqlite`、Windows Task Scheduler 示例，并列出 product list/info/attributes、finance transaction 的路径和表结构。
- 可借鉴：
  - 原始 API 快照、规范化模型、持久化模型分层；
  - 为商品、价格、库存、佣金、状态、财务交易保留来源字段和更新时间；
  - 定时同步应可重放，而不是只保留最终值。
- 不能借鉴：
  - README 使用 `limit:1000` 示例，但没有可见的分页完整性、断点、过期或失败回执证明；不能当作完整店铺同步；
  - 没有可见测试和较少提交，不能把数据库字段映射当作当前 Ozon schema 真相；
  - GPL-3.0 与本项目许可证/分发策略可能不兼容，不能复制代码或数据库设计前先做法律审查。
- 对本项目任务：将其作为“只读快照与审计回放”概念参考；实现时必须加入 `coverageComplete`、分页游标、freshness、store scope、server-observed receipt 和失败重试任务。

## 未纳入“可借鉴实现”的结果

- 公开搜索中出现的 Ozon ERP/1688 产品官网或营销页面不是 GitHub 源码，不能验证实现、许可证、测试和 API 覆盖，因此不作为工程证据。
- 1688 采集项目通常是通用 scraper 或单页脚本；没有找到同时提供 Ozon Seller API 映射、SKU 规范化、类目/属性、俄文内容、预检、人工确认、提交和审核回读的完整公开仓库。
- 不应从商业产品的功能宣传反推本项目已具备同等能力。可把“商品资料体检、利润预估、订单/库存集中处理”等卖家任务作为 UI 研究线索，但必须重新验证来源和实现。

## 对本项目的具体行动项

| 优先级 | 行动 | 验收证据 |
| --- | --- | --- |
| P0 | 建立 Seller API endpoint capability matrix，复用 `implemented/NotRealized` 思路 | 每个 endpoint 有文档指纹、fixture、分页/错误语义、验证等级 |
| P0 | 为 1688→Ozon 黄金链路补跨阶段 fixture | 同一 `candidateId` 从来源证据、SKU、类目属性、媒体、价格到预检的可重放链路 |
| P0 | 将所有 SDK/HTTP 调用置于服务器端 transport stub 可替换层 | 测试第一次调用前即注入全局网络阻断；禁止测试漏过 stub 访问真实网络 |
| P1 | 增加读取快照与回执数据字典 | store/environment/scope/hash/freshness/coverageComplete/nextAction 一致 |
| P1 | 逐项核对 README 类“全覆盖”声明 | 只将 `documented`、`mocked`、`locally_tested`、`real_read_verified`、`real_write_verified` 分开记录 |
| P1 | 设计卖家 UI 而非 SDK UI | 每个页面显示对象、当前状态、阻塞原因、安全下一步、影响预览和结果；原始 JSON 仅在诊断区 |
| P2 | 评估许可证和依赖风险 | MIT 可参考；GPL 项目只允许概念借鉴，复制前完成法律审查 |

## 最终判断

GitHub 证据支持我们改进“适配器可审计性、响应 fixture、测试分层、只读快照”，不支持直接复制任何仓库来声称 1688→Ozon 或真实 ERP 已完成。当前项目应继续以官方 Seller API 文档和受控真实只读回执为事实源，GitHub 只作为工程实现参考。

