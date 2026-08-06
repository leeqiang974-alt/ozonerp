# 阶段交接：MVP 领域骨架

## 已完成（2026-08-03）

- FastAPI 店铺管理：健康检查、店铺 CRUD、仓库及 API 凭据的安全数据模型。
- FBS 领域服务：商品/SKU、可售库存和预占、订单状态机、取消释放库存、打包时限风险。
- 定价与营销控制：人民币物流档位、迭代定价、`old_price`/`min_price`、活动价格与利润保护、审批及审计事件。
- 静态运营概览前端壳，可读取 `/api/v1/shops`。
- 12 个本地领域测试通过。
- 产品语言固定为中文（`zh-CN`），店铺和商品价格币种固定为 CNY；创建或更新店铺时拒绝其他币种。
- 店铺接入已改为 Ozon Seller 标准的“店铺名称 + Client ID + API Key”；密钥写入时加密、读取时绝不回显。
- 商品与 FBS 订单的只读同步 API 已接入本地持久化和同步运行日志；前端同步中心可选择店铺后触发。
- 删除规则已校正：仅有失败同步记录的未完成店铺可删除；已拥有商品、订单或审计等业务数据的店铺只能停用/归档。
- 项目总目标、范围控制和阶段验收以根目录 `AGENTS.md` 与 `docs/MASTER_PLAN.zh-CN.md` 为最高指示。
- 已完成一个真实已授权店铺的只读同步验证：FBS 订单同步成功写入 5 条；商品同步接口成功但该次响应为 0 条。已新增商品与 FBS 订单本地列表 API，前端可展示同步结果。
- FBS 订单现按“订单头 + 商品行”落库；同步会替换同一订单的商品行，避免旧明细残留。订单列表新增“查看明细”抽屉，展示订单状态、截单时间与商品/Offer ID/数量。
- 已用真实授权店铺再次完成只读验证：同步得到 5 条 FBS 订单，抽样订单的商品行可由详情接口读取。验证过程未输出 Client ID 或 API Key。
- 后端测试增至 26 项通过，前端脚本语法检查与差异格式检查通过。
- FBS 订单图片已接入：订单图片同步通过只读 `/v3/product/info/list` 按 SKU 或 product_id 获取图片，并保存主图链接；订单明细抽屉展示缩略图，缺图时显示“无图”占位。已对真实授权店铺验证抽样订单的商品主图可显示。
- FBS 订单风险队列已完成：订单页支持全部、待打包、配送中、风险订单筛选；对未关闭订单自动识别已超截单和两小时内截单风险，状态中文显示，导航红点显示风险数量。已在本地页面完成筛选交互和浏览器控制台验证。
- 已完成商品上架模块边界与开发方案：以草稿、类目/属性映射、图片与 CNY 核价预检、审批、`task_id` 跟踪为核心；真实 `/v3/product/import` 写回归入阶段 7，避免绕过审批和审计。
- 商品上架第一期已完成：本地上架草稿、单变体、CNY 核价和预检 API/中文页面可用；缺类目、主图、采购成本、重量或包装尺寸会阻止草稿进入审批。未调用任何 Ozon 写 API。
- 商品上架类目基础已接入：4 个测试店铺均完成 Ozon 末级类目与商品类型的只读缓存，共 29,688 条；草稿页面改为中文类目选择器，不再要求运营手填类目 ID。
- 已接入当前只读 `/v1/description-category/attribute` 属性接口。真实抽样类型返回 44 个属性，其中 3 个必填；页面选择类目后会展示必填属性摘要。当前仅完成“发现与提示”，属性字典值、属性录入和逐项校验仍是下一步，不得把当前状态描述为可直接发布。
- 草稿模型新增 `type_id`，本机 SQLite 采用向前兼容的增量迁移；预检缺少商品类型时会阻止进入审批。整个流程仍未调用 Ozon 商品写 API。
- 已建立后台数据库同步架构：正式环境配置 PostgreSQL 16、psycopg 与 Alembic 完整初始迁移，SQLite 仅保留给单机开发和自动化测试。
- 页面改为本地数据库优先：选择店铺或切换经营概览、FBS 订单、商品与库存、商品上架页面时，先显示本地数据，再请求统一 `auto-sync` 入口进行后台校正；普通操作不再要求点击同步。
- `sync_states` 按店铺和资源保存最近成功时间、商品滚动游标、订单窗口及可续期任务租约。同一资源成功后 5 分钟内不重复访问 Ozon；PostgreSQL advisory lock 保护首次建状态的并发竞争，多标签页同时触发只允许一个任务启动。
- FBS 订单采用上次成功窗口减 10 分钟的重叠校正并完整遍历全部分页；任一页失败都不推进检查点。商品每轮最多滚动 5 页并持久化下一游标。类目和图片资源缓存 24 小时；订单图片增加行级校正时间并在订单行 upsert 时保留，避免重复下载已有图片。
- 人工按钮保留但改为“强制校正/强制完整校正”；所有自动流程仍为 Ozon → ERP 只读，不含库存、价格、营销、发货或商品发布写回。
- 商品上架必填属性闭环已完成：属性模板和字典值均落本地数据库缓存；页面按类目动态生成必填字段；字典字段输入至少 2 个字后调用 `/v1/description-category/attribute/values/search`，单次最多 50 条，必须选择带 `value_id` 的 Ozon 返回项才能保存。草稿属性独立持久化，预检会逐项拒绝缺失的必填字典值。
- 真实授权店铺已完成只读验证：缓存类目 1000 条、抽样商品类型属性 44 条、字典搜索 20 条，重复请求结果一致；未创建虚假商品，未调用任何 Ozon 写 API。
- 完成独立代码审查后的安全收口：字典 `value_id` 必须存在于当前店铺/类目/类型/属性缓存且文本一致；前端用请求序号抵御店铺 A→B→A 的旧响应覆盖；后端拒绝跨店类目；同名字典值以 Ozon ID 区分；属性与查询缓存不会阻止删除未完成店铺；空搜索和窄/宽搜索按查询维度独立缓存。

## 安全与 API 结论

- 不可把店铺 API Key 写入源码、测试、日志、Git 或本文件；仅在本地 `.env`/密钥管理服务提供。
- Seller API 的旧 `POST /v1/warehouse/list` 已在只读探测中被明确标为废弃，禁止接入。
- 后续只读连通性优先使用当前产品或 FBS posting 查询接口；写类 API 必须先有人工确认、审计和沙箱/小范围验证。

## 下一阶段验收

1. 为 FBS 订单列表实现状态筛选与可执行的本地拣配清单（不调用 Ozon 写 API）。
2. 使用当前 Seller API 的替代仓库接口完成只读适配，并以 mock contract test 固化。
3. 将当前应用内后台任务迁移到独立 worker，并补限流退避与订单/商品多页完整周期契约测试。
4. 商品上架下一步完成图片可访问性/数量/格式预检和多变体属性模型；随后建设审批界面与 payload 预览，不提前接入发布写回。


## 1688 -> Ozon 自动上架流水线（P0-P7）

### 主线调整（2026-08-05）

- 取消“同一主体下店铺 A -> 店铺 B 直接复制商品”方案；该方案不作为 ERP 商品来源主线。
- 新主线改为 Ozon 公开详情页采集 -> 本地二开草稿 -> 内容/图片/价格重做 -> 预检 -> 审批 -> 发布。
- 扩展已支持 Ozon 详情页快照发送到 `/api/ozon/capture`；后端以 `source_platform=ozon_public` 入库，公开页面价格只保留在 `raw_json`，不得当作 CNY 采购成本。
- 公开采集仍需人工处理品牌、版权、水印和重复内容风险，当前不自动发布。
- 已将可用扩展复制到 `browser_extension/erp-collector-extension`，保留 1688/Ozon 详情采集、SKU 筛选、店铺选择和 crawler worker；新增 Ozon 搜索列表卡片浮层。浮层通过 MutationObserver 处理无限滚动卡片，展示评分、评价、页面可见尺重和销量提示，并避免重复挂载。
- Ozon 详情快照新增 `packageInfo`（`weightG`、`lengthMm`、`widthMm`、`heightMm`）与 `salesHint`；页面推测数据仅标记 `capture_hint`，缺失时不填默认值。扩展语法检查通过，后端测试 78 项通过。
- 新增浏览器端 `composer-api.bx/page/json/v2` 尝试：列表商品链接会用当前 Ozon 页面会话读取同源页面 JSON，解析可用尺重/销量字段并回填浮层；失败时静默回退到 DOM，未向浏览器暴露店铺 API Key。
- 已增加主世界 Fetch/XHR 观察器：仅转发当前 Ozon 页面已加载的 JSON 响应摘要到内容脚本，按商品 ID 匹配浮层并回填字段；不读取或转发 Cookie/API Key，响应过大时丢弃。

- 新增 `backend/app/pipeline/` 包，覆盖 P0-P7 全链路：
  - P0 `contract.py`：1688 商品快照 JSON Schema、幂等键、校验与规范化。
  - P1 `ingestion_service.py`：幂等 upsert 导入，重复导入更新而非新建。
  - P2 `fact_extraction.py` + `category_matching.py`：产品事实提取、Ozon 类目召回 Top 20 + 规则重排 Top 5 + 人工锁定。**已加入产品类型-类目域映射和负向关键词排除**，防止跨域误匹配（如耳机匹配到消防设备）。
  - P3 `attribute_mapping.py`：确定性映射规则（材质 -> Material 等）+ 中俄同义词表 + 字典搜索与 value_id 验证。
  - P4 `variant_mapping.py`：1688 规格轴解析、稳定 SKU 编码（SHA-256）、图片编排（8-15 张）与合规检查。
  - P5 `content_generation.py` + `llm_translate.py`：**LLM 驱动的中俄翻译**（OpenAI 兼容 API，通过 `LLM_API_KEY` 环境变量配置）；无 API key 时使用词典回退并标记 `content_verified=False`。俄语标题/描述/规格块生成 + 每 SKU CNY 定价（复用 PricingService，规则版本 1.0.0）。
  - P6 `quality_check.py`：类目置信度、属性覆盖率、内容完整度（**含西里尔字母验证和中文字符惩罚**）、图片/SKU 合规、定价健康度评分 + Ozon payload 预览。未通过 AI 验证的内容会被标记为需人工审核。
  - P7 `publish_service.py`：草稿创建 -> 审批（审计记录）-> **真实提交 Ozon `/v3/product/import`** -> 状态轮询。用户已批准使用真实写回以便发现问题。
- 新增 5 个数据模型：`SourceProductRecord`、`SourceVariantRecord`、`SourceMediaRecord`、`PipelineProductRecord`（含 `content_verified` 字段）、`PipelineProgressRecord`。
- 新增 14 个 API 端点 + Chrome 扩展桥接端点，全部注册到 `main.py`。
- `frontend/progress.html` 从后端 API 实时拉取进度，10 秒自动刷新。
- 后端测试增至 74 项通过（含域兼容性测试、LLM 翻译回退测试）。

### 已发现并修复的问题（2026-08-04）

1. **内容语言错误**：P5 曾直接输出中文标题作为 `title_ru`，已修复为 LLM 翻译 + 词典回退。
2. **类目跨域误匹配**：P2 曾将蓝牙耳机匹配到"防护和消防设备"类目，已加入域兼容性检查。
3. **质量分虚高**：P6 曾只检查字段是否存在不检查语言，已加入西里尔字母验证和中文字符惩罚。
4. **测试破损**：4 项测试失败已修复（FakeOzonClient 签名、缺失属性缓存、P7 API mock）。
5. **代码卫生**：清理了 5 个根目录临时脚本。

### 待改进项

- 定价模型仍使用硬编码尺寸（500g/200x150x100mm），需从 1688 采集数据中提取真实重量和尺寸。
- LLM 翻译需要配置 `LLM_API_KEY` 才能产出高质量俄语内容；无 key 时词典回退质量有限。
- P7 真实写回已用于测试，已成功发布 1 个商品到 Ozon（task_id 5306797528），但该商品的标题曾为中文（已修复代码，旧数据需重新生成内容后重新发布）。


## 2026-08-06 商品发布编辑器开发

### 完成内容

**后端新增**
- `ai_service.py` — DeepSeek AI 服务模块（翻译、属性推荐、描述生成、富内容生成）
- `POST /api/v1/ai/translate` — 文本翻译（中文→俄文）
- `POST /api/v1/ai/suggest-attribute` — 属性值 AI 推荐
- `POST /api/v1/ai/generate-description` — 商品描述 AI 生成
- `POST /api/v1/ai/generate-rich-content` — 富内容 JSON 生成
- `GET /api/v1/shops/{shop_id}/pipeline/source-products/{sp_id}` — 采集商品详情（含变体和图片）
- `GET /api/v1/shops/{shop_id}/listing-drafts/{draft_id}` — 获取单个草稿
- `PUT /api/v1/shops/{shop_id}/listing-drafts/{draft_id}` — 更新草稿
- `OzonAttributeCacheRecord` 新增 `complex_id`、`is_aspect`、`description`、`is_collection` 字段
- 正确从 Ozon API 捕获 `attribute_complex_id` 和 `is_aspect`（变体属性标识）

**前端新增**
- `listing-editor.html` — 完整商品发布编辑器（9 个分区，对齐无忧易售）
  1. 店铺与类目（搜索+选择+Offer ID+标题+智能标题）
  2. 产品属性（动态渲染，必填/选填分组，字典搜索，AI填充）
  3. 本地信息（来源URL+备注）
  4. 文字描述（AI生成+AI翻译）
  5. JSON富内容（AI生成：欢迎语+描述+5张图）
  6. 产品图片（URL添加+采集导入+主图标记）
  7. 视频（链接+封面）
  8. 变体设置（is_aspect驱动变体识别+笛卡尔积生成SKU行）
  9. 产品信息（增值税+积分评价）
- `listing-editor.js` — 编辑器逻辑（类目联动、AI填充、变体生成、草稿保存）
- `listing-editor.css` — 编辑器样式
- `index.html` 商品上架 tab 新增"进入发布编辑器"链接

### 关键设计决策
- **表单驱动**：不是流水线/Agent，而是每个字段独立填写+AI辅助
- **is_aspect**：Ozon API 通过 `is_aspect=true` 标记变体属性，非 `complex_id`
- **属性值收集**：保存时直接从 DOM 读取，不依赖事件回调
- **DeepSeek**：翻译走 `deepseek-chat` 模型，API Key 在 `.env` 中配置

### 文件路径
- 编辑器页面：`E:\new ozon erp\frontend\listing-editor.html`
- 编辑器JS：`E:\new ozon erp\frontend\listing-editor.js`
- 编辑器CSS：`E:\new ozon erp\frontend\listing-editor.css`
- AI服务：`E:\new ozon erp\backend\app\ai_service.py`
- 访问地址：`http://127.0.0.1:5500/listing-editor.html`

### 待后续完善
- 富内容可视化编辑器（当前为文本编辑）
- 图片处理（裁剪、去水印、白底）
- 定价模型集成到变体表格
- 草稿列表管理（在主页面展示已保存草稿）
