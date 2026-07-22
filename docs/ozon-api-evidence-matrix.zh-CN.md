# Ozon Seller API 端点证据矩阵

更新日期：2026-07-19

## 1. 目的与审计口径

本文记录当前 `src/` 实际调用的全部 Ozon 端点，用来阻止以下误判：代码中有路径不等于当前官方版本仍有效；模拟响应通过不等于真实账号可用；HTTP 接受不等于业务动作最终成功。 

2026-07-17 本地审计结果：`scripts/read-operator-matrix.mjs --environment local` 解析到 canonical 4 个 primary 店铺，计划矩阵 `ok=true`，Seller API HTML 指纹与矩阵基线匹配；执行仍为 `not_started`，不能升级任何真实读取等级。

本轮通过检索 `src/*.js` 中的 `ozonRequest()`、`ozonGetRequest()` 和 Ozon 路径字面量得到 20 个唯一的“当前实际调用”端点。Seller API 本地 HTML 文档本身解析出 29 个 operation 路径；后者是文档候选全集，不能当作项目已调用或已验证的端点。实现位置以当前源码为准；验证等级采用 `docs/ROADMAP.zh-CN.md` 的定义。

官方入口：

- [Ozon Seller API 官方文档](https://docs.ozon.ru/api/seller/)
- [Ozon Seller 帮助中心](https://docs.ozon.ru/global/)

2026-07-19 复核时，项目已读取本地 Seller API 文档 `D:\Desktop\ozonseller api\Ozon Seller API 文件.html`；该本地版本明确说明 `/v3/posting/fbs/list` 与 `/v3/posting/fbs/unfulfilled/list` 已于 2026-06-01 停用，当前 FBS 读取应使用对应 `/v4/` operation。文档文件指纹和 operation 路径只能证明审计输入存在，不能替代当前线上版本核验或真实店铺响应；因此本矩阵不升级任何真实读取等级。

### 矩阵基线指纹门（必须显式更新）

当前矩阵基线固定为：来源 URL `https://docs.ozon.ru/api/seller/zh/`、文件大小 `5,567,952` bytes、内容指纹 `sha256:aa6fb7ee12b3e492f7d1bd9da6324a16762a6cd8920dc5923ac948774d43b0e8`。`src/apiEvidence.js` 的 `evaluateApiMatrixConsistency` 会同时比较来源、大小、内容指纹和矩阵要求的端点集合；任一变化都会返回 `stale`/`verificationEligible=false`，并要求重新审核矩阵，不能静默沿用旧的端点版本或真实读取声明。合法更新必须在同一变更中重新取得证据、更新基线和本节记录；指纹相同也不等于线上官方版本或真实账号已核验。

实现注意：浏览器“网页，完整”保存的文档使用 `saved from url=(长度)URL` 注释格式，证据解析器同时兼容该格式和带引号格式；重点路径提取也覆盖 `/v2/products/stocks` 这类复数资源路径。解析出路径或来源 URL 仍只属于本地文档证据，不会自动升级官方版本或真实账号验证等级。

当前代码通过 `/api/system/api-evidence` 暴露该文档证据摘要，通过 operation evidence 记录商品、库存、价格、活动和导入回查的脱敏响应哈希；哈希不等于真实业务成功，也不升级写入验证等级。

## 2. 通用客户端事实

当前客户端位于 `src/ozon.js`：

- 使用 `Client-Id`、`Api-Key` 和 JSON 请求。
- 默认超时 30 秒，按“店铺 + path”做最小间隔节流。
- HTTP `GET` 可自动重试；HTTP `POST` 只有显式 `retrySafe: true` 且路径属于 `src/ozon.js` 的读取端点白名单时才自动重试（当前白名单包含商品导入回查、商品/库存/价格读取、仓库、活动商品和 FBS 读取）。未登记路径即使传入 `retrySafe: true` 也会在发出请求前以 `OZON_RETRY_SAFE_ENDPOINT_NOT_ALLOWLISTED` fail-closed。
- 当前业务读取调用点多数没有传 `retrySafe: true`，因此保持单次请求；接入重试前必须先把端点加入白名单并补充官方语义/脱敏 fixture 证据。
- 写端点默认不自动重试是正确的保守行为，但网络超时会产生“结果未知”，必须通过业务回查而不是盲重发。
- 当前客户端没有全局认证/RBAC、业务幂等键或响应 schema 契约；这些必须在业务层补齐。

## 3. 端点总表

“Fixture”表示仓库中是否存在针对该 Ozon path/响应形状的独立可回放 fixture；普通静态路由测试不算真实 fixture。

| Ozon 端点 | 业务对象 | HTTP / 性质 | 副作用 | 当前实现位置 | 当前验证等级 | 官方事实状态 | Fixture | 重试安全性 | 权限、确认、幂等、回查要求 |
|---|---|---|---|---|---|---|---|---|---|
| `/v2/warehouse/list` | 仓库 | POST / 读 | 无平台写入；会更新本地类目/推荐相关视图 | `src/server.js`, `src/stockQueue.js` | `locally_tested` | **端点版本待核验**；需在官方 Warehouse operation 确认当前路径、字段和状态枚举 | 无独立响应 fixture | 语义只读，但当前 POST 不自动重试；可在确认官方限流后标 `retrySafe` | 需要店铺读取权限；保存最后同步时间和 request id；仓库状态必须在库存写入前重新确认 |
| `/v1/description-category/tree` | 类目树 | POST / 读 | 更新本地类目缓存 | `src/server.js` | `locally_tested` | 缺当前账号的服务端持久回执和端点版本；本地 fixture 仅 mocked | `test/fixtures/ozon/category-read/tree.success.mocked.json`（mocked/redacted，不是真实账号回执） | 只读可有限重试；当前 POST 不自动重试；全量刷新需限速、断点恢复 | 需要类目读取权限；记录读取日期、账号、language、接口版本和缓存失效策略 |
| `/v1/description-category/attribute` | 类目属性 | POST / 读 | 更新本地属性缓存 | `src/server.js`, `src/autoListing.js` | `locally_tested` | 缺当前账号的服务端持久回执和端点版本；本地 fixture 仅 mocked | `test/fixtures/ozon/category-read/attributes.success.mocked.json`（mocked/redacted，不是真实账号回执） | 只读可有限重试；当前 POST 不自动重试 | 当前类目/type 范围内使用；缓存必须带版本/日期，不能跨类目复用属性 |
| `/v1/description-category/attribute/values` | 属性字典值 | POST / 读 | 更新本地字典缓存 | `src/server.js`, `src/autoListing.js` | `locally_tested` | 缺当前账号的服务端持久回执和端点版本；空页/缺字段仅 mocked | `test/fixtures/ozon/category-read/values.empty.mocked.json`（mocked/redacted，不是真实账号回执） | 只读可有限重试；当前 POST 不自动重试 | 必须绑定 description_category_id/type_id/attribute_id/language；禁止跨类目写入旧 dictionary id |
| `/v4/posting/fbs/list` | FBS 订单 | POST / 读 | 无平台写入；前端订单表和首页统计变化 | `src/server.js` | `locally_tested` | 本地 Seller HTML 当前 operation：`cursor`、`sort_dir`、`filter.since/to`、`limit<=100`；仍需真实账号回放确认状态枚举 | `test/fixtures/ozon/fbs-postings-basic.synthetic.json`（仅 synthetic/redacted 离线契约，不是真实账号回执） | 只读可按 cursor 有限重试；当前 POST 不自动重试 | 订单含敏感经营数据；需角色权限、分页完整性、最后同步时间、陈旧状态和 request id |
| `/v4/posting/fbs/unfulfilled/list` | 未履约 FBS 订单 | POST / 读 | 无 | `src/server.js` | `locally_tested` | 本地 Seller HTML 当前 operation：`cursor`、`sort_dir`，日期过滤使用 `cutoff_from/to` 或 `delivering_date_from/to`；仍需真实账号回放确认边界和状态枚举 | 无独立响应 fixture | 只读可按 cursor 有限重试；当前 POST 不自动重试 | 读取权限；必须保留日期范围和分页，不能把一次空响应解释为无待办 |
| `/v3/posting/fbs/list`（deprecated） | FBS 订单 | POST / 读（兼容） | 无平台写入 | `src/server.js`（仅旧计划兼容） | `locally_tested` | 本地 Seller HTML 标注 2026-06-01 停用；禁止新计划使用，计划/回执须标注 deprecated | 旧 synthetic fixture 不代表当前 operation | 不应发起新请求；旧计划需人工迁移到 v4 | 仅用于识别旧计划，不升级任何真实读取证据 |
| `/v3/posting/fbs/unfulfilled/list`（deprecated） | 未履约 FBS 订单 | POST / 读（兼容） | 无 | `src/server.js`（仅旧计划兼容） | `locally_tested` | 本地 Seller HTML 标注 2026-06-01 停用；禁止新计划使用，计划/回执须标注 deprecated | 无独立响应 fixture | 不应发起新请求；旧计划需人工迁移到 v4 | 仅用于识别旧计划，不升级任何真实读取证据 |
| `/v3/product/list` | 商品索引 | POST / 读 | 无；驱动本地商品列表 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认 visibility、last_id 和返回总数 | 无独立响应 fixture | 只读分页可重试；当前 POST 不自动重试 | 商品读取权限；保存游标/同步时间；分页未完成时不得显示全店总数结论 |
| `/v3/product/info/list` | 商品详情 | POST / 读 | 无；补商品/订单展示信息 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认 product_id/offer_id 批量上限和响应字段 | 无独立响应 fixture | 只读分批可重试；当前 POST 不自动重试 | 读取权限；批次部分失败要保留成功项并标缺失详情 |
| `/v4/product/info/prices` | 商品价格 | POST / 读 | 无 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认 price/index/promotion 字段含义 | 无独立响应 fixture | 只读分页可重试；当前 POST 不自动重试 | 价格读取权限；展示数据时间和币种；不能将返回价格替代本地可复算成本模型 |
| `/v4/product/info/stocks` | 商品库存 | POST / 读 | 无 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认 filter、last_id 和仓库维度 | 无独立响应 fixture | 只读分页可重试；当前 POST 不自动重试 | 库存读取权限；写后必须使用官方确认的读取端点回查 offer/product/warehouse 结果 |
| `/v1/actions` | 促销活动 | GET / 读 | 无 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认 GET 方式和活动状态字段 | `test/ozon-client.test.js` 只有客户端 mock，不是业务响应 fixture | GET 自动重试 429/5xx/网络；需遵守 Retry-After | 活动读取权限；保存同步时间；一次空响应不能与无权限混淆 |
| `/v1/actions/products` | 活动参与商品 | POST / 读 | 无 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认分页及价格字段 | 无独立响应 fixture | 只读可有限重试；当前 POST 不自动重试 | 活动读取权限；分页、活动 ID 和商品范围必须可审计 |
| `/v1/actions/candidates` | 活动候选商品 | POST / 读 | 无 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认候选资格及价格约束字段 | 无独立响应 fixture | 只读可有限重试；当前 POST 不自动重试 | 活动读取权限；候选不等于可安全加入，加入前需价格/利润校验 |
| `/v3/product/import` | 商品草稿/上架提交 | POST / **写** | 创建或更新商品，返回异步 task | `src/workflowRuns.js`, `src/autoListing.js` | `locally_tested` | **端点版本待核验**；需用官方 Product operation 确认当前 schema、批量上限和异步语义 | `test/workflow-runs.test.js`, `test/ozon-client.test.js` 有依赖 mock；缺脱敏真实响应 fixture | **不可自动重试**；超时/5xx 后先按 offer/task/事件回查，防重复写 | 只允许 workflow preflight + 当前草稿 hash + 显式人工确认路径；直接 `/api/ozon/product-import` 已移除。仍需店铺写权限、并发幂等、审计、重复 offer 防护和 `/v1/product/import/info` 回查 |
| `/v1/product/import/info` | 商品导入任务 | POST / 读/异步回查 | 无平台写入；推进审核/库存本地状态 | `src/autoListing.js`, `src/stockQueue.js`, `src/server.js` | `locally_tested` | **端点版本待核验**；需确认 task 状态、errors 和 product_id 字段；fixture 仅 mocked | `test/fixtures/ozon/product-import-info/{pending,imported,error,partial,timeout}.mocked.json`（mocked/redacted，不是真实账号回执） | 只读轮询可有限重试；当前 POST 不自动重试；必须退避和最大次数 | 读取权限；关联 store/task/offer；accepted 不等于 imported；保存原始错误、request id 和最终回读时间 |
| `/v2/products/stocks` | FBS 库存 | POST / **写** | 修改一个或多个 offer 在仓库的库存 | `src/server.js`, `src/stockQueue.js` | `locally_tested` | **端点版本待核验**；需确认当前推荐写库存 operation、批量上限和逐项错误 | 无独立 Ozon 响应 fixture；仅本地队列逻辑测试 | **不可把网络失败当安全重试**；当前队列有业务重试，必须先回查，避免结果未知时重复覆盖 | 需要库存写权限、商品/仓库就绪检查、结构化 diff、人工确认、幂等策略、逐项结果、写后库存回查。`/api/ozon/warehouse-stocks` 与 `/confirmed` 均要求管理员确认、幂等键和服务端精确库存 dry-run；`/confirmed` 额外执行写后回查 |
| `/v1/product/import/prices` | 商品价格 | POST / **写** | 修改 price/old_price/min_price 等 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认当前价格更新 operation、字段语义和批量限制 | 无独立响应 fixture | 写操作不自动重试；超时先读价格回查 | 需要价格写权限、资料来源/版本、利润闸、old/min price 校验、变更 diff、人工确认、逐项回执和价格读取回查。当前直接路由缺这些统一门 |
| `/v1/actions/products/deactivate` | 活动参与商品 | POST / **写** | 将商品移出活动 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认动作是否可恢复、批量限制和返回语义 | 无独立响应 fixture | 不自动重试；超时后先读取活动商品确认 | 活动写权限；只能对明确选中商品；展示活动/商品/价格影响；人工确认；逐项结果；重新读取参与商品。后端当前只校验 ID/非空，确认主要在前端，需服务端权限/确认契约 |
| `/v1/barcode/generate` | 商品条码 | POST / **写/生成** | 为 product_id 请求生成条码，可能改变商品资料 | `src/server.js`, `src/autoListing.js` | `locally_tested` | **端点版本待核验**；需确认适用商品、上限和异步/重复调用语义 | 无独立响应 fixture | 不自动重试；重复调用安全性未知，必须先回查 | 商品写权限；仅审核/创建状态允许时执行；展示产品范围、人工确认、生成结果和后续商品详情回查 |
| `/v1/product/pictures/import` | 商品媒体 | POST / **写** | 替换/导入商品图片 | `src/server.js` | `locally_tested` | **端点版本待核验**；需确认当前图片更新 operation、URL 要求和异步审核 | 无独立响应 fixture | 不自动重试；网络结果未知时先读商品详情/媒体状态 | 商品写权限、媒体合规检查、目标商品和图片顺序 diff、人工确认、审核回读；付费生图确认与本端点写入确认是两个独立门 |

### FBS v3 → v4 迁移记录

本地 Seller HTML 已将 `/v3/posting/fbs/list` 和 `/v3/posting/fbs/unfulfilled/list` 标注为 2026-06-01 停用；新受控只读计划使用 `/v4/` 契约。订单看板现在请求 `/v4/posting/fbs/list`，服务端和前端以 `cursor/sort_dir` 维护分页，会校验响应游标、拒绝重复游标，并在刷新/筛选时清空游标历史。

已完成本地迁移前置任务：cursor 会话状态、响应游标绑定、重复边界去重、刷新/筛选时游标失效、失败重试及前端覆盖证据测试。真实读取等级仍不升级；未履约 v4 的 `cutoff_from/to` 或 `delivering_date_from/to` 入口和履约写动作继续保持关闭。v3 仅作为旧计划兼容路径并标记 `deprecated`，禁止新计划继续选择。

## 4. 当前最严重的契约缺口

### P0：写端点不能只靠前端按钮约束

`src/server.js` 暴露了可直接调用的商品导入、库存、价格、活动移出、条码和图片写路由。部分前端存在确认，但服务端没有统一认证/RBAC、确认令牌、草稿版本或幂等契约。普通业务入口必须走服务端安全门；诊断直通路由在生产环境应禁用或限制管理员角色。

### P0：真实异步结果必须回读

- `/v3/product/import` 的 HTTP 成功只能视为任务已接受，必须使用 task 回读确认每个 offer 的状态。
- 库存、价格、图片和活动写入超时后不能直接重发；先使用对应读取端点确认实际状态。
- 所有批量写入必须区分全部成功、部分成功、全部失败和结果未知。

### P0：为读取型 POST 建立明确重试白名单

当前读取型 POST 不会自动重试。不能简单把全部 POST 标成 `retrySafe`；应逐端点在官方语义确认后建立白名单，增加分页/退避/最大次数，并保存 request id。写端点继续默认不自动重试。

### P1：建立最小契约 fixture

每个端点至少需要：成功、空响应、401/403、429、5xx、schema 缺字段。分页端点增加多页/重复游标；批量写端点增加部分成功；异步端点增加 pending/imported/error/超时。fixture 必须脱敏并记录来源等级，模拟 fixture 不能标成真实账号证据。

## 5. 官方核验任务清单

每次核验一个端点时，在总表“官方事实状态”中加入：官方 operation 直链、核验日期、请求方法、版本/弃用信息、关键请求字段、批量/分页限制、权限范围、响应/错误语义。若官方页面需要登录或无法稳定链接，保存脱敏截图/PDF/响应元数据到项目证据目录，并保留官方 URL。

优先顺序：

1. `/v3/product/import` 与 `/v1/product/import/info`。
2. `/v2/products/stocks` 与 `/v4/product/info/stocks`。
3. `/v1/product/import/prices` 与 `/v4/product/info/prices`。
4. 类目树、属性和字典值。
5. FBS 订单读取，然后才是履约写端点立项。
6. 活动、条码和图片端点。

## 6. 维护规则

- 新增或更换任何 Ozon path 时，必须先更新本文，再实现调用。
- 删除端点时保留历史行并标 `retired`、替代端点和迁移日期。
- 验证等级升级必须链接脱敏 fixture/回放记录，不能只写“测试通过”。
- GitHub 项目和 SDK 只能帮助发现候选端点，不能填充“官方事实状态”。
- 本矩阵只描述 Ozon API 证据；业务阶段优先级仍以 `docs/ROADMAP.zh-CN.md` 为准。
