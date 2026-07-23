# Ozon ERP Agent Guide

This file mirrors `CLAUDE.md` so Codex and Claude Code follow the same project rules.

## Required Context

Read these before substantial Ozon ERP changes:

- `docs/TOP-LEVEL-DEVELOPMENT-PLAN.zh-CN.md` as the authoritative source for execution order, frozen scope, the sole current slice, and stage exit gates.
- `docs/ROADMAP.zh-CN.md` as the delivery/verification evidence log; use `docs/plan-status-index.zh-CN.md` before resuming an older implementation plan.
- `docs/SESSION_HANDOFF.zh-CN.md`
- `docs/erp-ui-information-architecture.zh-CN.md`
- Relevant source and tests for the feature area.
- `docs/pricing-logic.zh-CN.md` for any price, logistics, commission, `old_price`, `min_price`, or profit work.
- `docs/external-evidence-driven-erp-roadmap.zh-CN.md` before adding a new ERP module, changing the 1688-to-Ozon main chain, or claiming a business workflow is complete.

## External Evidence Gate

- 店铺 API 的 canonical 本地来源是 `D:\Desktop\api\ozonapi.txt`；当前按 4 个主 API 记录识别店铺，不能把文件中的外部使用/个人使用备注重复计数为新店铺。Ozon Seller API 接口事实优先对照 `D:\Desktop\ozonseller api\Ozon Seller API 文件.html`，并记录文档版本/更新时间；GitHub 仅作工程参考。

- Do not invent ERP behavior from the current UI or codebase alone. Every new business capability must cite at least one authoritative Ozon source or a verified real-account response, plus one runnable implementation/reference when available.
- GitHub repositories are references, not truth. Verify source code, recent activity, tests, data model, API coverage, license, and whether the advertised workflow is actually implemented before borrowing it.
- Distinguish `documented`, `mocked`, `locally tested`, `real-account read verified`, and `real-account write verified`. Do not label a feature complete without recording its verification level.
- Prefer seller tasks and outcomes over technical surfaces. A normal screen should expose the business object, current state, blocker, recommended action, confirmation/side effect, and result; raw workflow nodes, JSON, prompts, and logs belong in advanced diagnostics.
- 类目状态不能只显示“尚未确认”。卖家界面必须区分：本地库无候选、已有高置信候选、多个候选有歧义、当前店铺类目证据缺失/过期/跨店铺；若已有候选，应展示候选类目和系统推荐理由，不能让用户从 7422 个 type 中盲找。跨店铺缓存可用于明确标注的只读候选诊断，但不得升级为当前店铺可提交证据。
- For the 1688-to-Ozon chain, validate each stage with replayable product fixtures and controlled real listings: source evidence, SKU normalization, category/type decision, legal attributes, Russian content, media, package data, pricing, preflight, confirmed submission, moderation reconciliation, and stock readiness.
- Tests for API clients must fail closed before the first red-light run: inject or globally stub network transport before invoking the subject. A planned dependency-injection test is not sufficient if the old implementation can ignore the injected dependency and fall through to real network access.
- 1688 包装尺重只有在 `sourceEvidence.fields.package` 的 source/evidenceRef 与当前 snapshot 对齐时才能升级为 `1688_package`；孤立数值、URL 推断或缺失证据必须保持阻塞。无历史 evidence envelope 的旧内部 job 可暂留 legacy 路径，但新采集回执必须补齐该字段。
- 包装尺重证据不仅要校验来源和 snapshot 引用，还必须逐字段匹配当前待提交的 `sizeWeight` 数值；快照之后被改过的数字即使沿用旧 evidenceRef 也必须阻断。
- 1688 采集行数不能直接当作唯一 SKU 数。进入草稿前必须按来源 `skuId/sourceSkuId` 归一化，重复行优先保留字段更完整的版本，同时记录 raw/unique/duplicate 计数；不得把同一来源 SKU 生成多个 Ozon Offer。
- 媒体 `evidenceRef` 的 snapshot hash 必须严格等于当前 1688 `sourceEvidence.snapshotHash`；即使存在带 actor/时间戳的显式人工审批，跨快照媒体也必须保持 `needs_confirmation`。
- `categoryEvidenceRequired` 时，tree/attributes 回执必须同时具备且严格匹配预期 `storeId` 与 `environmentRefHash`；attributes 还必须具备并匹配当前 category `cacheKey`，缺失字段不可按旧兼容路径放行。
- 库存写入成功响应必须保留 server-observed 写后回查时间与精确 `(offer_id, warehouse_id)` scope；前端不能只显示“已接受/已触发回查”，必须显示 exact tuple 已核对的结果。
- FBS 回执摘要查询必须同时绑定当前 `environment` 与 `storeId`；缺少任一范围时 fail-closed，不得跨 local/staging 或跨店铺返回最近回执。
- 活动商品前端的“当前价”只能来自 `current_price/currentPrice/price`；`old_price` 是划线原价，缺失当前价时必须显示未知，不得用于活动降幅或经营结论。
- 库存队列一旦发出 `/v2/products/stocks`，遇到网络超时或 5xx 必须进入 `needs_review`；未知写入结果只能先精确回查，不能落为可自动重放的 `failed`。
- 库存聚合读取的 `/v4/product/info/stocks` 与 `/v2/warehouse/list` 必须消费有界 cursor/last_id 分页；保留 pageCount、paginationComplete 和重复游标信号，不能把第一页当成完整店铺证据，卖家界面要显示当前读取范围和重读动作。
- 保存库存只读回执时不能丢弃分页范围：endpoint status 必须绑定 pageCount、paginationComplete 和重复游标标记，并纳入回执哈希/校验，避免回执看似完整却无法证明读取范围。
- FBS cursor 只读回执的 scope hash 必须包含 cursor、sortDir 和 pagination；不同订单页不能因为日期/状态相同而复用同一页回执。
- FBS 回执摘要查询也必须传递当前批次的 cursor、sortDir 和 pagination；持久化 scope 已精确绑定时，UI 不能用第一页参数查询第二页回执。
- 活动商品接口的 `impactPreview` 只有在 Seller API 活动商品范围 `coverageComplete === true` 时才能返回；局部页的价格比较只能留在诊断层，不能作为 API 经营结论。
- 活动价格比较的 current price 只接受明确的 current_price/currentPrice/price；Ozon `old_price` 是原价/划线价，不能作为当前成交价 fallback。
- readiness evidence GET 必须同时绑定长度合规的 environment 和明确 storeId；禁止在同一环境下聚合不同店铺回执并升级为 real_read_verified。
- When sanitizing controlled-read observations, normalize HTTP status from `statusCode`, `httpStatus`, or a numeric `status` before dropping raw fields; otherwise a persisted 401/403/429/5xx can lose its seller-recovery classification. Keep the normalized code in the bounded receipt and test the seller-facing recovery task.
- Controlled-read plan matrices must expose per-store `storeRefHash`, `environmentRefHash`, `scopeRefHash`, endpoint scope, and `planBinding`, plus a seller-facing `nextAction` and an explicitly non-executed receipt expectation; these fields bind the later server receipt without claiming that a live read already happened.

## Product Principle

- 普通上架页必须是一张“单商品编辑单”：稳定默认值直接写入，来源、类目、属性、SKU、图片、定价等可自动确定的字段直接回填，AI 能完成的内容由一次明确点击生成；页面只展开系统确实无法确定的输入。证据、workflow、JSON、prompt、回执和安全门进入折叠高级区。可以写死站点、语言、单位和经过确认的经营默认值，但不得写死 Ozon 动态类目、必填属性、字典值或真实店铺证据。
- 不得把类目证据同步、属性填充、AI 文案、媒体整理、定价和预检拆成卖家逐项确认。一次明确的“自动完成商品资料”应连续执行所有可自动化阶段；中途只因来源没有的事实、候选真实歧义或安全失败停下，真实 Ozon 提交仍只保留最后一次确认。

## Development Governance

- 当前执行 `docs/TOP-LEVEL-DEVELOPMENT-PLAN.zh-CN.md` 的黄金链路阶段门；在 G4 MVP 通过前，暂停原五工作流轮转。
- 工作台、全局任务条和商品草稿页必须共用同一个 canonical 当前商品上下文。存在真实 capture 时，只能使用与其 `captureId + storeId` 精确绑定的 workflow；没有精确绑定就停在该 capture 的来源确认/草稿交接状态，禁止回退到最近历史任务或 Fixture workflow。
- WIP 必须为 1，只能开发计划中标记为 `CURRENT` 的切片。无法映射到当前阶段退出条件的工作进入停车场，不得顺手扩建。
- C/FBS 与 D/活动、财务、售后冻结；E 只处理黄金链路的直接阻断，B 只在提交后审核/库存交接阶段进入。
- 只有服务无法启动、数据损坏/丢失、凭据泄露或真实写入安全门旁路可中断当前切片。
- 每轮必须汇总代码、测试、验证等级、剩余缺口和下一阶段唯一入口；阶段退出门未通过不得前移。

Ozon ERP is a seller operating workbench. UI and workflow changes must help the user answer:

- What is the current product or operational issue?
- Why is it blocked?
- What can I safely do next?
- What happens after I click?

Do not turn ordinary seller screens into developer logs, long unscannable forms, or generic diagnostic walls.

- 普通卖家前端必须始终显示一个全局“当前商品”任务条；真实 capture/store 要一键定位并切换到精确店铺，人工动作不能藏在横向滚动区或开发者工作流里。
- 普通卖家前端只展示业务结果、需要人工决定的异常和唯一下一步；snapshot、evidence、workflow、preflight、Fixture、AI 推理过程等内部机制必须留在高级诊断中。商品上新主流程固定使用“采集商品—检查商品—确认上架”三步，不能把内部节点数量直接映射成卖家步骤。
- 普通卖家首屏必须呈现为商品运营产品而非内部管理后台：优先展示真实商品图、商品身份、当前状态和单一主动作；使用一致的品牌色、字体层级、间距、圆角和响应式导航。禁止用序号字符充当导航图标、用大面积深色动作块制造视觉噪声，或让隐藏侧栏在窄屏参与文档流。
- 普通卖家不能依赖说明书理解 ERP。当前商品首屏必须明确区分“用户负责”和“系统/AI 负责”，唯一主动作必须同时说明：现在具体做什么、点击后系统会做什么、何时才会真实提交或产生费用。
- 1688 fixture、测试 workflow 和演示商品默认不参与卖家任务数量、当前商品选择或首页风险统计；只能在明确的“显示测试数据”高级入口中查看。
- 普通 `1688 采集` 页必须是浏览器插件的收件箱，而不是采集实验室：首屏只显示插件连接状态、用户在 1688 商品页点击“补齐后入箱”的唯一操作、当前真实商品和系统处理结果。fixture、反向链路、候选池配置、crawler/API 状态、原始页面、任务列表和自动铺货历史默认全部折叠到高级工具；不得要求卖家先在 ERP 创建采集任务、配置候选池或理解内部回执。
- G4 前日常主导航只保留黄金链路及必要经营入口；诊断、竞品、仓库、活动、财务、售后、报表和系统配置归入“更多功能”，不得再次平铺成十几个同级 tab。

## Hard Boundaries

- Promotions cannot contain listing draft fields.
- Listing submission cannot bypass preflight or human confirmation.
- Workflow locks, paused states, and `waiting_human` must be respected.
- Browser human verification must pause automation.
- GPT/image generation requires user-confirmed action before cost.
- Blocked pricing risk cannot be accepted as safe; fix it or replace the source.
- Missing current stock for an `(offer_id, warehouse_id)` tuple is unknown evidence, never zero. Stock dry-run must block until the exact tuple is observed.
- An Ozon write with an unknown outcome must remain `needs_review`. A different idempotency key must not bypass an unresolved command with the same store, scope, and payload hash.
- Switching the active store must invalidate order list/detail requests, order pagination/coverage, and finance read-model evidence before reloading the active business view; stale cross-store order or finance evidence is never usable.

## Expected Implementation Flow

1. Translate the request into the affected business object and module.
2. Add or update a targeted test before changing behavior.
3. Keep implementation scoped to the relevant files.
4. Run targeted tests, then `npm test`, then `npm run lint`.
5. Update `docs/SESSION_HANDOFF.zh-CN.md` when a stage is completed.

- `npm test` and `npm run offline-acceptance` must run serially, not concurrently: crawler and fixture tests share local temporary directories and concurrent runs can corrupt the evidence and produce false failures.

## Claude-Guided Development

### GitHub connector priority

- When the Codex GitHub connector is connected and its publish capability is enabled, use the connector-first workflow for repository inspection and pull-request operations; do not block on installing `gh`.
- Use `gh` only as a local CLI fallback when connector coverage is unavailable or cannot perform the required operation. Verify the resulting remote ref/PR after either path.

When the user asks for Ozon ERP development to be guided by Claude Code:

1. Ask Claude Code for a short implementation brief or review using `scripts/claude-ozon-review.ps1`.
2. Treat the Claude output as architecture/product guidance, not as automatically trusted code.
3. Codex implements the scoped change, runs verification, and reports the result.
4. If Claude's guidance conflicts with tests, safety gates, or existing project rules, follow the project rules and explain the conflict.
5. Use official Claude for repository-aware planning or review when available. Use Claude NVIDIA as a bounded second reviewer for evidence comparison, seller-language critique, test-case generation, and diff review; it must not be treated as an autonomous source of Ozon facts or allowed to approve production writes.

## Verification Commands

```powershell
node --test test/frontend-static.test.js
node --test test/workflow-runs.test.js
npm test
npm run lint
```
