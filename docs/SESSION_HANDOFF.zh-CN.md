# Ozon ERP 会话接管与恢复记录

更新时间：2026-06-30

## 项目根目录

`C:\Users\Administrator\Documents\ozonerp`

本轮 Codex 桌面环境以 `C:\Users\Administrator\Documents\ozonerp` 为实际项目根；继续开发前仍需先确认 `git status` 和最近提交，避免误入旧复制目录。

## 2026-06-30 Claude NVIDIA 默认审阅链路修复

### 已完成

- 已定位 Claude NVIDIA 无有效输出根因：
  - NVIDIA `/v1/models` 与 API key 正常。
  - `moonshotai/kimi-k2.6` 官方 chat completion 在 30 秒 smoke 中超时。
  - `qwen/qwen3-next-80b-a3b-instruct` 与 `meta/llama-3.3-70b-instruct` 在同一 NVIDIA endpoint 下可正常返回。
  - 旧 `scripts/claude-ozon-review-nvidia.ps1` 不会自动启动 LiteLLM，也没有超时诊断，容易表现为“空输出/长时间卡住”。
- `config/litellm-nvidia.yaml` 新增 `nvidia-qwen-next`，映射 `openai/qwen/qwen3-next-80b-a3b-instruct`。
- `scripts/claude-code-nvidia.ps1` 默认模型改为 `nvidia-qwen-next`。
- `scripts/claude-ozon-review-nvidia.ps1` 默认模型改为 `nvidia-qwen-next`，并新增：
  - 自动启动本地 NVIDIA LiteLLM gateway。
  - `-TimeoutSeconds`，默认 120 秒。
  - 空输出/超时显式报错，不再静默失败。
  - 无效工具调用式输出检测：如果模型返回 XML/JSON tool-call 痕迹，会自动用更严格的纯文本提示重试一次；仍无效则明确失败，不把坏复审当作可用审核。
  - 子进程 exit code 检测：`claude` 非 0 退出时直接报错并带出错误摘要，避免把认证/模型/gateway 错误文本误当成复审意见。
- 本轮继续加固 Claude NVIDIA 复审输出：
  - wrapper 会把当前 `git diff` / staged / untracked 文件列表写入提示词，要求只引用真实 changed-file list、项目规则或任务中明确给出的文件，不再让模型随意编造 `src/llm/*` 等不存在路径。
  - 非 `OK/Important/Critical` 开头且过短的单词输出会被视为无效并自动严格重试。
  - `Critical` / `Important` 只有单词、没有理由时会被视为无效；风险级别必须带出与 changed-file list 或项目规则相关的具体理由。
  - 进一步定位到 Claude CLI 兼容层会在 NVIDIA/LiteLLM 场景下丢失或误读上下文；wrapper 已改为直连本地 LiteLLM `/v1/chat/completions`，用 UTF-8 bytes 发送 prompt，确保实际使用 `nvidia-qwen-next`。
  - 新增 `-PromptOutputPath`，可保存实际发给 NVIDIA 的 prompt；后续若复审异常，可直接核对模型是否收到了 changed-file list。
  - 对中文返回的 mojibake 做一次 UTF-8 修复，避免 PowerShell/REST 解码异常把可用复审变成乱码。
  - 如果 changed-file list 非空但模型声称“无变更文件/未提供变更文件”，wrapper 会判为矛盾输出并重试；重试后仍矛盾则失败，不把坏复审当作可用审核。
- 新增 `test/claude-nvidia-scripts.test.js`，静态锁定默认模型、gateway 启动和配置别名。
  - 本轮测试继续锁定 changed-file list 上下文、禁止编造路径、拒绝一词式无效输出。

### 已验证

- `node --test test/claude-nvidia-scripts.test.js`，1/1 通过。
- 本轮追加验证 `node --test test/claude-nvidia-scripts.test.js`，1/1 通过。
- 本轮追加 smoke：`scripts/claude-ozon-review-nvidia.ps1` 返回 `OK`。
- 本轮追加 smoke：wrapper 能识别一词式无效输出并触发严格重试，最终返回带理由的 `OK` 文本。
- 本轮追加 direct smoke：wrapper 直连 LiteLLM 后能读取真实 changed files，返回带理由的中文 `OK`，不再声称没有变更文件。
- `scripts/claude-ozon-review-nvidia.ps1` smoke 已自动启动 gateway 并返回：`OK，我是 NVIDIA review wrapper。`
- `scripts/claude-code-nvidia.ps1` smoke 已返回：`OK，Claude Code NVIDIA 默认模型可用。`
- `npm test`，297/297 通过。
- `npm run lint`，通过。

### 后续规则

- Ozon ERP 默认 Claude Code 搭配继续使用 NVIDIA，但默认别名为 `nvidia-qwen-next`。
- `nvidia-kimi-k2` 可保留为手动模型别名；如果后续恢复稳定，可显式传 `-Model nvidia-kimi-k2` 测试，但不再作为默认复审模型。

## 2026-06-30 审核回执与当前商品任务闭环 V1

### 已完成

- `src/workflowRuns.js` 新增 `workflowCurrentProductTask()`，在 workflow/listing 域统一把节点状态映射为当前商品下一步任务：
  - `review_reconcile` 失败或变体合并失败 -> `listing_repair`，引导修复 Payload/变体后重新预检。
  - 审核成功但内容分值/评分分项偏低 -> `content_improvement`，引导回上架内容和图片优化。
  - `stock_sync` running/failed/waiting -> `warehouse_queue`，引导进入库存队列和仓库推荐，不盲写库存。
  - 审核通过且无明显分值问题 -> `live_monitoring`，引导库存/运营检查。
- `summarizeWorkflowRun()` 现在输出 `summary.currentProductTask`，让首页/工作流列表可消费统一业务任务。
- Dashboard 单品结果卡优先读取 `latestRun.summary.currentProductTask`：
  - Dashboard 不直接解析 Ozon 原始审核回执、Payload 或库存写入结果。
  - 仍只显示当前商品、卡点、原因、下一步和跳转入口。
- 工作流控制台 run card 与当前焦点条新增只读“当前商品任务”摘要：
  - 展示商品、卡点、原因和安全下一步。
  - 数据只来自 `summary.currentProductTask`。
  - 不新增提交按钮、不触发重试、不解析 raw payload。
- Dashboard 今日提醒侧栏与商品中心产品资产台账新增只读“当前商品任务”提醒：
  - 两处共用 `summary.currentProductTask`，优先显示被阻塞/等待人工/需优化的当前商品。
  - Dashboard 仍是店铺经营总览，提醒只在侧栏出现，不把原始 workflow 诊断放进首页主区域。
  - 商品中心只展示当前商品的状态提醒，不新增上架表单、采集入口或 Ozon 提交动作。

### 安全边界

- 当前商品任务只是摘要和跳转建议，不调用 Ozon 写接口，不提交商品。
- 审核失败、变体合并失败、库存等待不会被当作成功。
- 内容分值优化不会绕过 preflight、payload validation 或人工确认。
- 库存任务仍进入库存队列/仓库页，不绕过 stock queue、商品就绪检查或 `WAREHOUSE_WRONG_STATUS` 排除。
- 不改变 workflow lock、`waiting_human`、pricing blocked 或 GPT/Image 成本确认。

### Claude Code 搭配

- 开发前调用 `scripts/claude-ozon-review-nvidia.ps1` 请求 Task 6 简报；进程正常结束但无有效文字输出，因此按本地计划和测试先推进。
- 修复 Claude NVIDIA wrapper 后，完成后复审已能稳定输出；复审提醒继续守住 `summary.currentProductTask`、preflight、`waiting_human`、pricing blocked 和 stock queue 边界。
- 复审输出里提到的 Vue/独立 JS 文件名并不存在，已按实际代码路径核对后只采纳安全边界提醒。
- 工作流控制台展示切片复审给出 Critical 级边界提醒，但未指出当前 diff 的具体违规点；已核对实际实现为只读渲染，无新增按钮、API、重试或提交副作用。
- 后续 Dashboard/商品中心复用切片仍需用 Claude NVIDIA 复审，重点检查是否误解析 raw payload、误加提交/重试按钮、或污染模块边界。

### 已验证

- TDD 红灯：
  - `test/workflow-runs.test.js` 先因 `workflowCurrentProductTask` 未导出失败。
- 已通过：
  - `node --test test/workflow-runs.test.js`，61/61 通过。
  - `node --test test/workflow-runs.test.js test/frontend-static.test.js`，132/132 通过。
  - `node --test test/frontend-static.test.js`，72/72 通过。
  - `node --test test/claude-nvidia-scripts.test.js test/workflow-runs.test.js test/frontend-static.test.js`，133/133 通过。
  - `node --test test/frontend-static.test.js`，73/73 通过。
  - `npm test`，297/297 通过。
  - 最新全量 `npm test`，298/298 通过。
  - `npm run lint`，通过。
  - `git diff --check`，通过。

### 下一步

- 继续推进“分类属性与变体填写主动化”主线：把当前类目的必填属性、字典候选、变体 aspect/SKU 图、商品分值影响项做成更明确的填报任务队列。
- 后续仍默认 Claude NVIDIA 搭配开发：实现后必须复审，Codex 以项目规则、测试和安全边界为最终判断。

## 2026-06-30 上架填报任务队列 V1

### 已完成

- 上架中心二级流程顶部新增只读“填报任务队列”：
  - 从当前 workflow 的 `payloadDraftValidation.requiredAttributeFillPlan` 汇总必填属性任务。
  - 从 `variantConfiguration` 汇总变体组合阻塞与 SKU 图提醒。
  - 从 `listingQuality` 汇总内容分值、图片/属性/描述/尺重影响项。
- 队列卡只提供“定位处理区”本地跳转：
  - 可切换到上架中心内部阶段，如内容图片、预检提交。
  - 不新增保存、自动填充、提交、重试、GPT/Image 生图或 Ozon API 调用。
- 窄屏响应式已处理，任务卡在平板两列、手机单列，避免信息挤压。

### 安全边界

- 数据源只读，沿用当前 workflow 摘要和预检结果，不创造新的属性真源。
- 建议字典值仍需人工确认；合规敏感和人工必填项不会自动写入。
- 变体阻塞必须回到草稿/预检修复，不绕过 payload validation。
- 内容分值提醒不会触发 GPT/Image 成本，不绕过 preflight 或人工确认。

### 已验证

- TDD 红灯：
  - `node --test test/frontend-static.test.js` 先因缺少 `renderListingFillTaskQueue` 失败。
- 已通过：
  - `node --test test/frontend-static.test.js`，74/74 通过。

### 下一步

- 继续把安全修复入口从“缺失字典值”扩展到更多低风险、人工确认后可本地修复的字段，例如普通文本属性、可解释型号名和可复制的变体 aspect 修复建议。

## 2026-06-30 必填属性安全修复入口 V1

### 已完成

- 后端 `applyPayloadDraftAttributeRepair()` 扩展字典修复边界：
  - 仍支持修复“已有但非法”的字典值。
  - 新增支持修复“缺失的字典属性”，但必须满足：
    - 属性矩阵判定该单元格为 `missing` 且该属性是当前类目的字典属性。
    - 候选字典值来自当前类目缓存/属性矩阵候选。
    - 前端传入 `confirmLocalDraftRepair: true`，即人工确认。
    - workflow 必须处于 `waiting_human` 或 `locks.waitingHuman=true`，避免运行中流程被静默改草稿。
  - 非候选字典 ID 仍拒绝，不能信任前端注入。
- 上架中心“只读填报任务队列”新增安全确认入口：
  - 从属性矩阵里挑出第一个 `canApplyLocalDraftRepair` 的候选。
  - 只有当前 workflow 处于等待人工时才展示候选写回按钮。
  - 点击后复用现有 `apply-attribute-dictionary-repair` 动作、确认弹窗和 `/payload-draft/attribute-repair` API。
  - 写回后立即重新预检，仍保持 `submitLocked`，不提交 Ozon。

### 安全边界

- 只写本地 Payload 草稿，不调用 `/v3/product/import`。
- 不绕过 preflight、payload validation、workflow lock、`waiting_human`、pricing blocked 或人工确认。
- 非 `waiting_human` 的 workflow 不能通过属性修复 API 写回本地草稿。
- 缺失字典属性只接受当前属性矩阵里的合法候选，不接受任意字典 ID。
- 任务队列按钮只是现有修复动作的入口，不新增独立写接口。

### 已验证

- TDD 红灯：
  - `node --test test/workflow-runs.test.js` 先因缺失字典属性仍被拒绝失败。
  - `node --test test/frontend-static.test.js` 先因缺少 `listingFillTaskRepairCandidate` 失败。
- 已通过：
  - `node --test test/workflow-runs.test.js`，62/62 通过。
  - `node --test test/frontend-static.test.js`，74/74 通过。

### 后续补充

- 上架中心任务队列已继续接入普通文本属性安全入口：
  - 从属性矩阵里挑出第一个 `canApplyTextDraftRepair` 的缺失普通文本属性。
  - 只有当前 workflow 处于等待人工时才展示“填写文本属性并预检”按钮。
  - 点击后复用现有 `apply-attribute-text-repair` prompt、`/payload-draft/attribute-repair` API 和重新预检流程。
  - 后端同样要求 `waiting_human` / `locks.waitingHuman=true`、`confirmLocalDraftRepair=true`，且只能修复非字典、非变体的缺失普通文本属性。
- 上架中心任务队列已接入变体 aspect 安全修复建议：
  - 从当前 workflow 的 `variantConfiguration.rows` 读取 `duplicate_aspect` / `missing_aspect` 行。
  - 在“变体/SKU 图”任务卡内显示“变体属性修复建议”、受影响 SKU、首个业务原因和人工修法。
  - 提供“复制修复建议”和“查看变体工作簿”两个本地动作；定位时带当前 workflow run 与 `preflight_check` 节点。
  - 本轮不写 Payload、不自动补 aspect、不提交 Ozon；修正后仍必须重新预检和人工确认。
- 工作流“变体配置工作簿”已补充字段级定位入口：
  - 每个 SKU 行新增“定位该 SKU 属性”，复用现有 Payload 编辑器高亮逻辑。
  - 当前版本会携带 `offer_id` 与首个 aspect attribute id，优先在对应 SKU 片段内定位颜色/尺码等 aspect id。
  - 如果没有可定位 aspect id，仍回退到 `offer_id` 这个稳定 SKU 锚点，帮助人工在 JSON 中找到对应变体行。
  - 该动作只移动光标和高亮，不保存、不修复、不提交。
- 上架中心“只读填报任务队列”已回流变体阻塞的行级业务上下文：
  - 变体/SKU 图任务卡会列出受影响 SKU、首个 aspect 名称/属性 ID、为什么卡住、下一步。
  - 数据仍来自 `variantConfiguration.rows`，只读展示；复制建议和查看工作簿不写 Payload、不提交 Ozon。
  - 修正后仍必须回到预检/Workflow Console 重新校验。
- 上架草稿侧的变体修复入口 V2 已接入非字典 aspect 文本属性：
  - `applyPayloadDraftAttributeRepair()` 新增 `repairType: "variant_text_value"`。
  - 仅允许 `waiting_human` / `locks.waitingHuman=true` 且 `confirmLocalDraftRepair=true` 的 workflow 写回本地 Payload 草稿。
  - 仅允许属性矩阵中 `status=missing`、`is_aspect=true`、非字典属性的单元格；字典 aspect 和重复 aspect 仍拒绝自动修复。
  - 写回后立即重新预检，仍保持 `submitLocked`，不会调用 Ozon 提交接口。
  - 上架中心“变体/SKU 图”任务卡和属性矩阵单元格新增“填写变体文本并预检 / 填写变体文本”按钮；用户输入后只写本地草稿并刷新 workflow 诊断。
- 变体配置工作簿新增只读“变体覆盖摘要”：
  - `variantConfiguration.summary` 现在输出 aspect 覆盖数、缺失 aspect 数、重复 aspect 数、唯一 SKU 图数、缺图数、未区分 SKU 图数、`readinessStatus` 和 `safeNextAction`。
  - 前端工作簿顶部展示“属性覆盖 / SKU 图区分 / 安全下一步”，帮助用户先看整组是否达标，再看逐 SKU 明细。
  - 该摘要只读取当前预检结果，不新增按钮、不写 Payload、不提交 Ozon，不触发 GPT/Image 成本。
- 必填属性规则引擎 V2 继续修正原产国/制造商边界：
  - `Страна-изготовитель` / 原产国 / 生产国 / 制造国 走 `fixed_country_china`，只使用当前类目字典中的 Китай/中国。
  - 单独的 `Производитель` / 制造商不再被误识别为原产国；仍进入合规敏感人工阻塞。
  - 避免中国原产国被 `изготовител` 敏感词误挡成 `blocked_sensitive`，也避免把制造商错误自动填中国。
- 必填属性规则引擎 V2 已开始接入中置信字典同义词候选：
  - `Материал` / 材质字段在商品文本含 PP/ABS/塑料、金属/不锈钢/铁/合金、硅胶等词时，可匹配当前类目字典里的俄文候选。
  - 候选来源标记为 `material_synonym`，置信度 `0.72`，只进入 `dictionaryCandidates`。
  - 仍保持 `action=suggest_dictionary`，不写 `dictionaryValueId`，必须人工确认后才可写本地草稿并重新预检。
- 必填属性规则引擎 V2 继续补充类型字段窄范围同义词候选：
  - `Тип` / `Вид` / 用途 / 类型 / 种类 字段在商品文本含 organizer / 收纳盒 / 收纳架 / 整理盒 / 置物架时，可候选当前类目字典里的 `органайзер`。
  - 候选来源标记为 `type_synonym`，置信度 `0.7`，只用于人工确认候选。
  - 非类型字段不触发该规则；例如材质字段里出现 organizer 不会生成类型候选。
- 必填属性规则引擎 V2 继续补充用途/适用对象窄范围同义词候选：
  - `Назначение` / `Применение` / `Для кого` / 用途 / 适用对象 字段在商品文本含 厨房/kitchen 时，可候选当前类目字典里的 `для кухни` 等用途值。
  - 商品文本含 宠物/猫/狗/pet 时，可候选当前类目字典里的 `для животных` 等适用对象值。
  - 候选来源标记为 `purpose_synonym`，置信度 `0.7`，只进入 `dictionaryCandidates`；仍保持 `action=suggest_dictionary`，不设置行级 `dictionaryValueId`，不自动写 Payload。
  - 非用途/适用对象字段不触发该规则；例如 `Тип` 字段里出现 厨房 不会生成用途候选。
- 必填属性规则引擎 V2 继续补充性别/适用性别窄范围同义词候选：
  - `Пол` / `gender` / 性别 / 适用性别 字段在商品文本含 女士/women/female/жен 时，可候选当前类目字典里的 `женский` 等值。
  - 商品文本含 男士/men/male/муж 时，可候选 `мужской`；含 儿童/kids/дет 时，可候选 `детский`。
  - 候选来源标记为 `gender_synonym`，置信度 `0.7`，只进入 `dictionaryCandidates`；仍保持 `action=suggest_dictionary`，不设置行级 `dictionaryValueId`，不自动写 Payload。
  - 非性别字段不触发该规则；例如用途字段里出现 women 不会生成性别候选。
- 必填属性规则引擎 V2 继续补充容量/件数数值同义候选：
  - `Объем` / 容量 / 体积字段在商品文本含 `500ml`、`500 мл`、`1L` 等容量表达时，只候选当前类目当前属性字典中的同数值容量值。
  - `Количество` / 件数 / 数量字段在商品文本含 `10件`、`10pcs`、`10 шт` 等数量表达时，只候选当前类目当前属性字典中的同数值件数值。
  - 候选来源标记为 `capacity_synonym` / `count_synonym`，置信度 `0.68`，只进入 `dictionaryCandidates`；仍保持 `action=suggest_dictionary`，不设置行级 `dictionaryValueId`，不自动写 Payload。
  - 非容量/件数字段不触发该规则；例如材质字段里出现 `500ml` 不会生成容量候选。

### 下一步

- 继续做“必填属性规则引擎 V2”：把尺码、套装/包装数量、适用场景等中置信候选继续沉淀，但仍只生成候选，不自动写入；同时把变体修复推进到整组差异建议和 SKU 图质量提升建议。

## 2026-06-30 仓库匹配规则引擎 V1

### 已完成

- `src/stockQueue.js` 新增 `rankWarehousesForStock()`：
  - 输入 `warehouses`、`excludedIds`、`product`、`store`、`previousFailures`。
  - 优先推荐 `created` 且匹配商品/店铺配送模式的仓库。
  - 排除本轮重试已排除仓库、历史 `WAREHOUSE_WRONG_STATUS` / `STOCK_WAREHOUSE_INVALID` 仓库、禁用/不可写仓库。
  - 输出 `recommended`、`recommendedReason`、`safeNextAction`、候选仓库、排除原因，不再只返回一个 ID。
- `resolveWarehouseIdForStore()` 与仓库状态失败后的替换仓库选择改用排名结果。
- `stockJobWarehouseRecommendation()` 可按库存队列 job 生成可解释推荐，失败仓库不会在同一轮重试被复用。
- `/api/ozon/stock-queue?includeWarehouseRecommendation=1` 可在读取队列时尝试附加仓库推荐；仓库接口失败时仍返回队列，并输出 `warehouseRecommendationError`。
- 库存页新增“库存队列与仓库推荐”只读工作台：
  - 展示库存队列任务、最后失败、推荐仓库、推荐原因、安全下一步。
  - 排除原因默认折叠，避免库存页变成诊断墙。
  - “回放可重试失败”仍调用库存队列回放，不直接盲写库存。

### 安全边界

- 仓库推荐只做本地排序和解释；不绕过库存队列、不直接写 Ozon 库存。
- `/v2/products/stocks` 写入仍只发生在现有 stock queue worker 内，并继续等待商品 import/review readiness。
- `WAREHOUSE_WRONG_STATUS` 仓库会进入排除，不把 blocked warehouse 当作安全推荐。
- 不改变 preflight、payload validation、workflow lock、`waiting_human`、pricing blocked 或人工确认。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 请求 Task 5 简报；本地未收到有效文字输出，因此按项目安全边界和测试优先流程继续推进。
- 完成后第一次 Claude NVIDIA 复审超时无输出，已终止审阅进程；第二次短复审有输出但引用不存在的 `recommendWarehouse()`、`/api/warehouse/recommend` 等内容，经 `rg` 核对为误报。
- 复审中唯一有效风险点是“不要复用错误状态仓库”，已补充测试覆盖 `status: WAREHOUSE_WRONG_STATUS` 被排除。

### 已验证

- TDD 红灯：
  - `test/stock-queue.test.js` 先因 `rankWarehousesForStock` 未导出失败。
- 已通过：
  - `node --test test/stock-queue.test.js`，8/8 通过。
  - `node --test test/stock-queue.test.js test/server-routes.test.js test/frontend-static.test.js`，91/91 通过。
  - `npm test`，292/292 通过。
  - `npm run lint`，通过。
  - `git diff --check`，通过。

### 下一步

- 继续开发“审核回执与商品分值闭环”：把 Ozon review/status、低分原因、库存等待状态映射成当前商品下一步任务；Dashboard 只接收经营摘要和侧栏提醒，不承载原始 payload 细节。

## 2026-06-30 定价策略 V1：最低价/原价来源解释

### 已完成

- `src/pricing.js` 新增 `derivePricingPolicyFields()`：
  - 无 `pricingPolicy` 时保持旧规则：`old_price = price * 2`，`min_price` 继续使用小数向下取整/整数减一。
  - 有 `pricingPolicy` 时支持 `targetProfitRate`、`minimumProfitRate`、`minimumProfitCny`、`oldPriceMode`、`oldPriceMultiplier`。
  - `min_price` 可按最低利润底线计算，并输出 `minPriceSource`、`marginFloor`。
  - `old_price` 输出 `oldPriceSource`，当前策略模式支持促销倍率。
  - 若最低价不低于售价，标记 `blocked=true` 与 `PRICING_MIN_PRICE_INVALID`。
- `buildListingPayloadDraftFromJob()` 和真实 `completeListing()` 路径都接入策略字段，避免草稿和真实流程分叉。
- `pricingDiagnosis` 新增 `pricingPolicy`、`oldPriceSource`、`minPriceSource`、`marginFloor`、`pricingBlockedReasonCode`。
- 前端定价诊断卡新增“最低价来源 / 原价策略 / 利润底线”说明。

### 安全边界

- 定价策略只计算本地 payload 字段和诊断，不调用 Ozon 写接口。
- `PRICING_MIN_PRICE_INVALID` 仍走既有 pricing blocked/preflight 阻塞逻辑，不能被当作安全通过。
- 不改变 workflow lock、`waiting_human`、preflight 或人工二次确认。
- 旧路径默认保持兼容，只有显式传入 `pricingPolicy` 才启用最低利润底线策略。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 做 Task 4 简报。
- Claude 重点提醒：旧自动上架不能破坏；最低价低于利润底线必须阻断；来源字段必须可追溯；pricing blocked 不能被接受为安全。

### 已验证

- TDD 红灯：
  - `test/pricing-source.test.js` 先因 `derivePricingPolicyFields` 未导出失败。
  - `test/auto-listing-payload-draft.test.js` 先因草稿缺少 `oldPriceSource/minPriceSource/pricingPolicy` 失败。
  - `test/frontend-static.test.js` 先因前端缺少“最低价来源/原价策略/利润底线”失败。
- 已通过：
  - `node --test test/pricing-source.test.js`，3/3 通过。
  - `node --test test/auto-listing-payload-draft.test.js`，8/8 通过。
  - `node --test test/frontend-static.test.js`，69/69 通过。

### 下一步

- 继续开发“仓库匹配规则引擎”：仓库选择不再取第一个可用，而是按仓库状态、店铺/配送模式、历史失败原因和商品 readiness 排名。
- 定价后续可继续接类目真实佣金、汇率策略和前端策略配置入口；所有策略修改仍需人工确认和重新预检。

## 2026-06-30 变体配置工作簿

### 已完成

- 新增 `buildVariantConfigurationSummary()`，在 preflight/workflow 中输出逐 SKU 变体配置摘要：
  - `offerId`、型号名称、Ozon 可变特性、aspect signature。
  - SKU 图状态：已区分、未区分、缺失。
  - 行状态：`valid`、`duplicate_aspect`、`missing_aspect`、`missing_image`、`pricing_blocked`。
  - 行级原因和安全下一步。
- `buildPayloadDraftValidation()` 与 `buildPreflightGateNode()` 现在输出 `variantConfiguration`，复用现有 `buildVariantGroupingDiagnosis()`，不创建第二套变体真相源。
- 工作流 Payload 草稿区新增“变体配置工作簿”只读表格：
  - 展示 SKU、型号、可变特性、SKU 图、判断、安全下一步。
  - 多 SKU 使用相同首图会显示图片提醒。
  - 重复 aspect 组合会显示行级阻塞，并引导修正后重新预检。

### 安全边界

- 工作簿只读展示，不调用 Ozon 写接口，不提交商品。
- 修复仍走现有 Payload 草稿编辑/本地修复和重新预检。
- 不改变 preflight、payload validation、workflow lock、`waiting_human`、pricing blocked 或人工二次确认。
- 型号相同但 aspect 不同被视为合法；重点阻塞重复 aspect 组合。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 做 Task 3 简报。
- Claude 重点提醒：工作簿必须以预检/Payload 为事实源；不能提供快速提交；pricing blocked 必须能下沉到行级状态。

### 已验证

- TDD 红灯：
  - `test/workflow-runs.test.js` 先因 `buildVariantConfigurationSummary` 未导出失败。
  - `test/frontend-static.test.js` 先因缺少 `renderVariantConfigurationWorkbench` 失败。
- 已通过：
  - `node --test test/workflow-runs.test.js`，58/58 通过。
  - `node --test test/frontend-static.test.js`，69/69 通过。

### 下一步

- 继续开发“定价策略升级”：把 `price`、`min_price`、`old_price` 从简单公式升级为可解释商业策略，并保持 blocked pricing 不可接受跳过。
- 后续可把变体工作簿的“定位字段”与现有 Payload 字段定位进一步打通，但仍只改本地草稿并重新预检。

## 2026-06-30 必填属性规则引擎 V2：可解释填充计划

### 已完成

- 新增 `buildRequiredAttributeFillPlan()`，为当前类目必填属性输出可解释计划：
  - `attributeId` / `name` / `strategy` / `confidence`。
  - `action`: `auto_fill`、`suggest_dictionary`、`manual_required`、`blocked_sensitive`。
  - `source`、`value`、`dictionaryValueId`、`dictionaryCandidates`、`reasonZh`。
- `buildListingPayloadDraftFromJob()` 现在把 `requiredAttributeFillPlan` 写入草稿 `summary`：
  - 型号名称来自父 SKU/商品族上下文，跨变体保持一致，并记录 `source=parent_sku`。
  - 品牌无品牌、原产国中国仍只使用当前类目合法字典值，不硬编码字典 ID。
  - 尺重类必填字段仅在 1688 尺重存在时进入自动填充计划，缺失时进入人工处理。
  - 材质/类型/用途等中置信字典字段只给当前类目合法候选，不自动写入。
  - 保质期、储存条件、成分、危险、温度、儿童/食品/化妆品/医疗/电池等合规敏感字段进入 `blocked_sensitive`。
- `buildPayloadDraftValidation()` 与 `buildPreflightGateNode()` 输出 `requiredAttributeFillPlan`，让工作流总闸展示“系统准备怎么填、为什么、是否需要人工”。
- 工作流 Payload 草稿区新增“必填属性填充计划”只读面板，按“已安全补齐 / 建议确认 / 必须人工处理 / 合规敏感”分组展示。

### 安全边界

- fill-plan 是本地解释与计划，不调用 Ozon 写接口，不提交商品。
- 中置信字典候选不自动写草稿；仍需人工确认后走已有本地草稿修复和重新预检。
- 合规敏感字段不自动填，不能被当作安全通过。
- 不改变 preflight、payload validation、workflow lock、`waiting_human`、pricing blocked 或人工二次确认。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 做 Task 2 简报。
- Claude 重点提醒：字典缓存必须按当前 category/type/attribute 校验；`package_data` 不能缺尺重硬猜；合规敏感字段必须人工处理；fill-plan 不能推进状态机或绕过 preflight。

### 已验证

- TDD 红灯：
  - `test/auto-listing-payload-draft.test.js` 先因 `buildRequiredAttributeFillPlan` 未导出失败。
  - `test/workflow-runs.test.js` 先因 `requiredAttributeFillPlan` 未接入 preflight 输出失败。
  - `test/frontend-static.test.js` 先因前端缺少 `renderRequiredAttributeFillPlan` 失败。
- 目标验证：`node --test test/auto-listing-payload-draft.test.js test/workflow-runs.test.js test/frontend-static.test.js`，130/130 通过。

### 下一步

- 继续开发“变体配置工作台”：逐 SKU 展示型号、aspect 字段、SKU 图、重复组合和安全下一步，集中解决多 SKU 合并失败。
- 之后再进入定价策略升级，把 `price/min_price/old_price` 从固定公式升级为可解释商业策略。

## 2026-06-30 Ozon 内容评分与媒体质量闸口

### 已完成

- `diagnoseListingQuality()` 新增本地 Ozon 内容评分分项：
  - 图片与媒体：产品图 3-4 张提示分值风险，多 SKU 图片组合重复提示缺 SKU 区分图。
  - 分类属性与变体：沿用必填属性、字典合法值、变体可变特性阻塞。
  - 标题描述与富内容：描述过短、rich content/视觉详情缺失会进入商品分值提醒。
  - 尺重与物流基础：缺少完整尺重会进入商品分值提醒，并引导回尺重/价格预检。
- `buildPreflightGateNode()` 现在把 `contentSummary` 传入 listing quality 诊断，让预检总闸能展示内容评分分项。
- 工作流 Listing 质量诊断面板新增“评分分项”卡片，展示图片与媒体、分类属性与变体、标题描述与富内容、尺重与物流基础四项分数和原因。
- 若本地 Payload 草稿保存后尚未重新校验，面板会显示“旧分数已过期 / 修改后需重新预检”，避免继续展示旧预检分数。

### 安全边界

- 内容评分全量本地计算，不调用 Ozon 写接口，不提交商品。
- 评分只解释商品分值/内容风险，不替代 Payload validation、preflight 或人工确认。
- 不触发 GPT/Image 生成，不绕过 GPT/Image 成本确认。
- 不改变 workflow lock、`waiting_human`、pricing blocked 或提交确认逻辑。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-ozon-review-nvidia.ps1` 做 Task 1 实现简报。
- Claude 重点提醒：评分只能作为 preflight 前置解释，不能替代 preflight；不能引入图片处理/生图成本；不能侵入营销活动或商品运营页。
- 提交前复审指出需防止“草稿改动后继续显示旧分数”；已补充 stale UI 防护和静态测试。

### 已验证

- TDD 红灯：
  - `node --test test/listing-quality.test.js` 先因 `scoreBreakdown` 缺失失败。
  - `node --test test/workflow-runs.test.js` 先因 `contentSummary` 未接入预检诊断失败。
  - `node --test test/frontend-static.test.js` 先因前端未渲染评分分项失败。
- 目标验证：`node --test test/listing-quality.test.js test/workflow-runs.test.js test/frontend-static.test.js`，125/125 通过。

### 下一步

- 继续开发“必填属性规则引擎 V2”：把 `model_name_from_parent_sku`、包装尺重字段、高置信自动补齐、中置信字典候选和合规敏感阻塞做成可解释填充计划。
- 后续再进入“变体配置工作台”，集中解决 SKU 图、颜色/尺寸 aspect、重复组合和模型名一致性。

## 2026-06-30 Ozon ERP 专属经验学习与差距评估

### 已完成

- 新增 `docs/ozon-erp-benchmark.zh-CN.md`，把 Ozon 官方规则、Seller Edu、同类 Ozon 工具/集成经验与当前系统做了对照评估。
- 明确纠偏：Ozon ERP 不能只按通用 ERP 模块推进；上架主线必须围绕 `description_category_id/type_id`、当前类目属性字典、变体可变特性、内容评分、媒体素材和审核回执。
- 结论：当前系统方向总体正确，已经不是纯泛 ERP；但还缺内容评分模型、类目/type 决策解释、类目规则模板、媒体结构化质量闸和审核/状态回读闭环。

### Claude Code 搭配

- 已使用 `scripts/claude-code-nvidia.ps1` 做两轮分析。
- Claude 有效建议：内容评分、媒体结构、样板商品/批量参数、字典合法值校验都是 Ozon 专属关键能力。
- 已纠偏 Claude 的两点误判：
  - 当前并非没有 `description_category_id/type_id` 映射，缺的是解释、候选对比和人工切换。
  - 当前品牌/原产国没有硬编码字典 ID，而是从当前类目字典值匹配。

### 后续建议

- 下一步优先开发 `Ozon 内容评分预估面板`：
  - 媒体：主图、SKU 图、详情图、视频、rich-content、图片文字风险。
  - 特征：必填属性覆盖率、字典合法率、可变特性唯一性。
  - 描述：俄文标题、描述长度、rich-content JSON、hashtags。
  - 输出阻塞项、建议项和安全下一步，不提交 Ozon、不生成图片、不绕过预检。

## 2026-06-30 高置信必填属性补齐：品牌与原产国

### 已完成

- `buildListingPayloadDraftFromJob()` 新增高置信必填属性补齐：
  - 品牌字段固定业务语义为 `Нет бренда` / 无品牌。
  - 原产国字段固定业务语义为 `Китай` / 中国。
  - 若字段是 Ozon 字典属性，只在当前类目字典值里找到匹配值时写入 `dictionary_value_id`。
  - 若当前类目没有合法字典值，不硬编码、不猜 ID，保留给预检/属性矩阵阻塞和人工处理。
  - 非字典字段才写文本值。
- 草稿生成可从两类来源读取当前类目字段和值：
  - 调用方传入的 `attrsMeta` + `attributeValuesById`。
  - 本地 `categoryCache.attributes` + `categoryCache.attributeValues`。
- 真实 workflow 草稿刷新现在会把本地类目缓存传入草稿生成，并把 `attrsMeta` 保存到 workflow run，便于后续预检和属性矩阵解释字段。

### 安全边界

- 不调用 Ozon 写接口，不提交商品，不绕过 preflight、人工确认、workflow lock 或 `waiting_human`。
- 不硬编码任何 `dictionary_value_id`；字典值必须来自当前 `description_category_id/type_id/attribute_id` 的缓存。
- 不触碰定价、库存、GPT/Image 成本确认、变体 aspect 自动修复或 PDD 采集。

### Claude Code 搭配

- 开发前已使用 `scripts/claude-code-nvidia.ps1` 做实现简报审查。
- Claude 建议核心边界：字典属性不得硬编码 ID；helper 保持同步、无副作用，复用现有 category cache。

### 已验证

- TDD 红灯：`node --test test/auto-listing-payload-draft.test.js` 先因品牌/原产国未补齐、仍误留品牌文本失败。
- 目标验证：`node --test test/auto-listing-payload-draft.test.js`，5/5 通过。
- 相关回归：`node --test test/auto-listing-payload-draft.test.js test/listing-content-quality.test.js`，33/33 通过。
- 工作流/预检回归：`node --test test/workflow-runs.test.js test/listing-quality.test.js`，56/56 通过。

### 下一步

- 继续接 `model_name_from_parent_sku` 的可解释补齐来源显示，让用户知道型号名称来自父 SKU/商品族。
- 再推进包装尺重字段映射，把 1688 尺重进入 Ozon 相关属性/商品分值提示，但保持缺尺重阻塞。
- 中置信字典字段如类型、材质、用途仍保持候选推荐 + 人工确认，不自动写入。

## 2026-06-30 属性矩阵缺失文本属性本地修复

### 已完成

- 上架中心/工作流属性矩阵新增“填写文本属性”人工入口。
- 后端 `applyPayloadDraftAttributeRepair()` 新增 `repairType: "text_value"`：
  - 只允许修复属性矩阵中 `status=missing` 的普通文本属性。
  - 明确排除字典属性和 `is_aspect=true` 变体属性，避免错误自动填变体/字典值。
  - 只写回本地 `payloadDraft.attributes[].values[{ value }]`，随后立即重新执行 `validatePayloadDraft()`。
  - 保持 `waitingHuman` 和 `submitLocked=true`，事件记录 `submittedToOzon=false`。
- 前端只在 `canApplyTextDraftRepair=true` 时显示按钮；点击后由人工输入文本值，并提示“不会提交 Ozon”。

### 安全边界

- 不调用 Ozon 写接口，不绕过 preflight、人工确认、workflow lock 或 `waiting_human`。
- 不自动修复字典属性、变体 aspect、定价、GPT/Image 或图片生成成本相关逻辑。
- 字典候选写回仍保持原有合法候选校验，不因文本修复放宽。

### Claude Code 搭配

- 使用 `scripts/claude-code-nvidia.ps1` 进行 NVIDIA Claude Code 审核。
- 审核结论：Critical / Important / Minor findings 均无；仅提示并发草稿修改属于通用模型问题，不构成本次改动风险。

### 已验证

- `node --test test/workflow-runs.test.js`：53/53 通过。
- `node --test test/frontend-static.test.js`：67/67 通过。
- `npm test`：271/271 通过。
- `npm run lint`：41 files 通过。
- `git diff --check`：通过。

### 下一步

- 继续把高置信必填属性补齐器接入上架草稿：品牌无品牌、型号名称、原产国、包装尺重等可解释来源字段。
- 对中置信字典匹配继续保持“候选推荐 + 人工确认写回”，不要自动越过 Ozon 字典合法值校验。
- 把商品分值相关的图片数量、SKU 图、详情图要求继续沉入预检/修复面板，让卖家看到分数影响和安全下一步。

## 2026-06-30 上架质量诊断接入预检总闸

### 已完成

- 新增 `src/listingQuality.js`，把 Ozon 上架质量诊断从 UI 提示沉到后端本地预检：
  - 必填字典属性存在文本值但缺少当前类目合法 `dictionary_value_id` 时阻塞。
  - 变体 `is_aspect=true` 属性缺失或组合重复时阻塞。
  - 产品图少于 3 张时阻塞；3-4 张时只作为商品分值警告。
  - 已存在 `PRICING_*` 阻塞节点或直接 pricing blocked 时阻塞。
- `validatePayloadDraft()` 现在返回合并后的 `payloadDraftValidation`：
  - 保留原有 payload 结构校验。
  - 增加 `listingQuality`、`listingQualityWarnings` 和 `LISTING_QUALITY_*` issues。
  - 阻塞时继续保持 `submitLocked=true`。
- `submitPayloadDraftToOzon()` 在本地质量诊断阻塞时直接返回 `blocked`：
  - 更新 `preflight_check` 节点。
  - 进入 `waiting_human`。
  - 不调用 `/v3/product/import`。
  - 不改变 `confirmSubmit` 人工二次确认安全门。
- `buildPreflightGateNode()` 现在把上架质量诊断纳入提交前总闸输出，供工作流控制台展示具体字段、原因和下一步。

### Claude Code 搭配

- 开发前已执行 Claude Code NVIDIA fallback 审查：`logs/claude-listing-quality-preflight-pre-review.md`。
- 审查结论要求：新增诊断必须位于 `confirmSubmit` 之前，阻塞时不得调用 Ozon 写接口，pricing blocked 不能被强制提交绕过。
- 开发后已执行两轮 Claude Code NVIDIA fallback diff 审查：
  - `logs/claude-listing-quality-preflight-post-review.md`
  - `logs/claude-listing-quality-preflight-final-review.md`
- 第一轮后审指出需显式补齐 `waiting_human` 提交锁与 pricing blocked 集成测试；已补充并验证。

### 已验证

- 已按 focused test 先看到失败，再实现：
  - `test/listing-quality.test.js`
  - `test/workflow-runs.test.js`
- 目标验证：`node --test test/listing-quality.test.js test/workflow-runs.test.js`，45/45 通过。
- 前端契约：`node --test test/frontend-static.test.js`，62/62 通过。
- 全量测试：`npm test`，254/254 通过。
- Lint：`npm run lint`，41 files 通过。

### 下一步

- 把 `listingQuality` 的阻塞/警告结果在“上架中心/预检提交”页面做成字段级修复面板：当前商品是谁、哪个属性缺字典值、哪个 SKU 图或变体 aspect 卡住、下一步点什么。
- 继续接 Ozon Seller API 的分类属性/字典缓存，让属性填写从“发现缺失”升级为“高置信自动填、低置信人工确认”。
- 开发后必须继续执行 Claude Code diff 审查，通过后才能提交。

## 2026-06-30 Listing 质量字段级只读诊断

### 已完成

- 工作流 Payload 草稿区新增 `Listing 质量诊断` 只读路由卡：
  - 数据只读来自 `payloadDraftValidation.listingQuality`、`payloadDraftValidation.issues` 和 `preflight_check.output.listingQuality`。
  - 展示状态、分数、阻塞项、`offerId`、`attributeId`、商品分值 warning 和 `nextActions`。
  - 每个阻塞项提供“定位 Payload 字段”，复用原有编辑器高亮，不自动改字段；修复后必须重新预检。
- 新增 `collectListingQualityDiagnosis()`、`renderListingQualityPanel()` 和 `workflowPayloadLocationForIssue()`：
  - 支持 `LISTING_QUALITY_DICTIONARY_VALUE_INVALID` 定位字典值。
  - 支持 `LISTING_QUALITY_PRICING_BLOCKED` 定位价格/定价诊断。
  - 支持变体 aspect 和图片数量问题定位到对应 Payload 区域。
- 前端静态契约新增测试：`frontend renders listing quality field repair panel`。

### 安全边界

- 本卡片只解释和定位，不新增任何 Ozon 写接口，不提供自动修复按钮。
- 不绕过 `confirmSubmit`、preflight、workflow lock、`waiting_human`、pricing blocked、GPT/Image 成本确认。
- 未改 PDD、营销活动、Dashboard、订单或仓储模块。

### Claude Code 搭配

- 开发前审查：`logs/claude-listing-quality-repair-panel-pre-review.md`。
- 开发后第一轮审查指出：面板必须避免暗示“可直接修复 Listing 字段”。
- 已收窄为只读诊断路由卡，`nextActions` 只渲染为文字列表，唯一交互是高亮 Payload 字段。
- 最终复审：`logs/claude-listing-quality-repair-panel-final-review.md`，结论可提交，要求 blocking/warning 视觉区分和全量验证；已完成。

### 已验证

- 已按 TDD 先看到 `node --test test/frontend-static.test.js` 红灯，再实现面板。
- 目标验证：`node --test test/frontend-static.test.js`，63/63 通过。
- 质量/工作流回归：`node --test test/listing-quality.test.js test/workflow-runs.test.js`，45/45 通过。
- 全量测试：`npm test`，255/255 通过。
- Lint：`npm run lint`，41 files 通过。
- 本地服务检查：`http://127.0.0.1:5178` 返回 200，`/app.js` 可访问并包含新面板代码。

### 下一步

- 接入 Ozon 字典值候选推荐：对 `DICTIONARY_VALUE_INVALID` 不只定位字段，还展示当前类目合法值候选和置信度。
- 把高置信字段（品牌无品牌、型号、原产国、颜色/尺寸 aspect）做成“建议填入草稿”，仍需人工保存和预检。

## 启动与验证

- 启动后台：`powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 start`
- 停止后台：`powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 stop`
- 查看状态：`powershell -ExecutionPolicy Bypass -File .\scripts\ops.ps1 status`
- 测试：`npm test`
- 当前前端静态测试基线：`node --test test/frontend-static.test.js`，52 个测试通过。

## 2026-06-29 前端功能归属与串区修复

用户反馈：ERP 左侧选中“营销活动”时，主内容区却出现 `平台分类 / 无忧易售信息 / 描述 / 产品采集图` 等上架草稿字段，说明不是单个 tab 文案问题，而是整个功能区归属和导航运行逻辑不清晰。

本阶段修复：

1. 新增 `ERP_VIEW_OWNERSHIP_CONTRACTS`，为每个业务页定义：
   - 当前功能区。
   - 本页处理什么。
   - 本页不处理什么。
   - 错页提示。
2. 新增 `renderViewOwnershipBars()`，所有业务页顶部都会显示功能归属契约，普通操作员先知道“这个页面是干嘛的”。
3. 修正导航同步：
   - `activateErpView()` 只激活目标 view，并通过 `syncNavigationForView()` 同步左侧 tab 与一级分组。
   - 一级导航点击时固定进入该组第一个 tab，不再复用隐藏/历史 active tab，避免串区错觉。
4. 明确营销活动页边界：
   - 只处理 Ozon 活动读取、活动商品、可加入商品和移出活动。
   - 如果营销活动页出现上架字段，按“路由/内容串区 bug”处理。
5. 更新 `docs/erp-ui-information-architecture.zh-CN.md`，加入“功能区归属契约”和全局区检查原则。

已验证：

- `node --test test/frontend-static.test.js`：52 个测试通过。

## 2026-06-29 Tab 长页面瘦身

用户继续反馈：每个 tab 内部页面过长，一打开就是大量面板和字段，看不出系统到底想让用户做什么。

本阶段修复：

1. 新增 `ERP_TAB_TASK_CARDS`，每个业务 tab 都有顶部任务入口卡。
2. 新增 `renderTabTaskCards()`，在功能区归属契约后展示：
   - 这个页面先做什么。
   - 当前页面的核心任务。
   - 2-3 个下一步按钮。
3. 新增 `applyProgressiveDisclosure()`：
   - 每个 view 只默认露出前 1-2 个关键业务面板。
   - 后续长内容统一加 `tab-secondary-panel tab-secondary-collapsed`。
   - 用户需要时点“展开本页高级内容”再查看。
4. 新增样式：
   - `tab-task-card`
   - `tab-disclosure-toggle`
   - `tab-secondary-panel`
   - `tab-secondary-collapsed`
5. 更新 `docs/erp-ui-information-architecture.zh-CN.md`，加入“Tab 页面层级”规则：标题 → 归属契约 → 任务入口卡 → 关键面板 → 高级内容折叠。

已验证：

- `node --test test/frontend-static.test.js`：53 个测试通过。

## 2026-06-29 侧栏文字被隐藏回归修复

用户截图反馈：左侧二级导航只剩图标，文字全部消失。根因是旧的 `@media (max-width: 1439px)` 窄侧栏规则在普通桌面浏览器宽度下生效，把 `.tab > span:not(.tab-icon)`、分组标题、品牌和店铺卡全部 `display: none`。

本阶段修复：

1. 在 `@media (max-width: 1439px)` 内为 `business-erp-theme` 加业务版覆盖规则：
   - 侧栏继续保持 `292px`。
   - tab 文字继续 `display: inline`。
   - 品牌、分组标题、店铺卡继续可见。
   - 主内容左边距保持 `378px`。
2. 新增回归测试 `business ERP sidebar keeps text labels visible on desktop widths`。

已验证：

- `node --test test/frontend-static.test.js`：54 个测试通过。
- `npm test`：223 个测试通过。
- `npm run lint`：通过。

## 当前运行注意

为避免 EasyOCR 卡住上架请求，当前可用临时运行参数：

- `OZON_IMAGE_PREPARE_COUNT=4`
- `OZON_IMAGE_OCR_ENABLED=0`

默认代码仍保持 OCR 开启；该参数只用于小量实跑或紧急验证。长期方案应改成图片 OCR 异步队列，不阻塞 `/complete-listing`。

## 已修复的关键问题

1. 同一 job 重试时复用同一个父 SKU，避免 OCR 卡住后重复生成 `SKUlq00126 / SKUlq00127` 这种重复卡。
2. 已归档幽灵重复卡：
   - 归档：`SKUlq00126`
   - product_id：`4904379384`
   - 保留在售：`SKUlq00127`
   - product_id：`4904387807`
3. 已重新保存 `SKUlq00127`：
   - task_id：`4677748900`
   - import errors：空
4. 自动上架最低价规则已修正：
   - 售价小数：向下取整，例如 `25.2 -> 25`
   - 售价整数：减 1，例如 `25 -> 24`
5. 自动上架已支持 1688 多 SKU 展开：
   - SKU 数 2-5 个时展开多个 Ozon offer
   - 子 SKU 命名格式：`父SKU-俄文化变体属性`
   - 示例：`SKUlq00127-makaronnye-tsveta-miks-tsvetov-100-sht`
6. 自动上架已补 `is_aspect` 变体属性：
   - 例如 `颜色名称(10097)`、`长度，m(4678)`、`厚度，毫米(4662)`
7. 已保留 Ozon 同类反哺、1688 属性、DeepSeek `attributes_hint` 的懒加载属性补全。
8. 1688/Ozon 浏览器插件已修复人机暂停逻辑：
   - 发现人机验证后写入暂停标记。
   - 清理 `ozon-erp-crawler-poll` 定时轮询。
   - 保持当前验证页打开并激活，不再继续刷任务。
   - 普通“立即检查任务”不会误清除暂停；只有人工通过后才恢复。
9. 玫瑰玻璃罩/灯罩礼品类目误配已修复：
   - `Роза в колбе / 玫瑰 / 永生花 / LED / 摆件` 优先走纪念品/礼品/家居装饰/夜灯方向。
   - 明确压低 `礼品包装纸 / 包装纸 / 包装材料`，避免被“礼品”泛化误配。
10. Ozon 多变体 `offer_id` 重复已修复：
   - 同色不同罩材（玻璃罩/亚克力罩）会生成不同俄文化 SKU 后缀。
   - Ozon 提交和库存队列前新增 `offer_id` 去重保险。
   - 去重时会记录 `variants_deduped` 步骤，避免重复库存行。
11. 多变体可变特征覆盖已修复：
   - `mergeVariantListingAttributes()` 会让变体属性覆盖基础属性。
   - 避免所有子 SKU 继承同一个基础颜色，导致 Ozon 报“无法与其他商品合并/可变特性相同”。
12. Ozon 标题中文残留已修复：
   - `normalizeOzonTitleForListing()` 会清理中文片段和中文标点。
   - 已覆盖猫咪钥匙扣标题中 `卡通立体` 混入俄文标题的问题。
13. 类目规则新增三类保护：
   - 猫咪钥匙扣优先 `住宅和花园 / 纪念品和礼品 / 纪念品`，避免误入汽车礼品套装、成人纪念品、水晶小饰品。
   - `礼品` 供应商属性不再单独触发纪念品逻辑，避免宠物饮水机误入纪念奖牌。
   - 纯饮水/喷泉意图优先 `宠物用品 / 宠物餐具 / 宠物饮水器`，压过宠物自动喂食器。
14. Ozon 模型重试属性保留已修复：
   - `retry_model` 不再只保留品牌/型号字段。
   - 新增 `mergeRetryModelAttributes()`，补模型名时保留 `4958 Предназначено для` 等其它必填属性。
   - 覆盖 Ozon 报错：`Название модели (для объединения в одну карточку)` / `Предназначено для` 这类必填字段在重试中被误删的问题。
15. 工作流控制台设计已完成：
   - 设计文档：`docs/workflow-console-design.zh-CN.md`
   - 目标：把 1688 采集、Ozon 学习、分析、上架、审核、库存写入做成可观察、可暂停、可编辑 payload、可定点重试的标准工作流。

## 最近成功闭环

Ozon 参考：

`https://www.ozon.ru/product/sinelnaya-provoloka-dlya-rukodeliya-tvorchestva-i-podelok-10-tsvetov-100-shtuk-3536437377/`

1688 货源：

`https://detail.1688.com/offer/978985041695.html`

结果：

- SKU：`SKUlq00127`
- task_id：`4677516306`
- product_id：`4904387807`
- 店铺：`3815760-4 / xymallc`
- 状态：`live`
- 库存：已写入 100，仓库 `1020005003350730`

## 2026-06-04 自动化实跑记录

### 1688 单品采集

- 任务：`ct_1780577898504umska`
- 候选：`cc_178057820632620g39`
- 1688 URL：`https://detail.1688.com/offer/654891318123.html`
- 标题：`DIY环氧树脂硅胶模具书包 饰品钥匙挂件四格迷你猫爪硅胶模具批发`
- 结果：完成采集，`candidatesSaved=1`

### Ozon 自动上架

- 上架 job：`al_mpzigq92direct`
- Ozon 参考机会：`mpqfuc35o36lzz`
- Ozon 标题：`Роза в колбе с подсветкой красная, подарок девушке`
- 1688 候选：`cc_1780078066310ujb0i`
- 1688 URL：`https://detail.1688.com/offer/676736066669.html`
- 父 SKU：`SKUlq00128`
- Ozon task_id：`4685902627`
- 店铺：`3815760-4`
- 状态：`live`
- 导入 product_id：
  - `SKUlq00128-krasnyy` → `4916398209`
  - `SKUlq00128-zheltyy` → `4916398204`
  - `SKUlq00128-rozovyy` → `4916398329`
- 库存队列：`sq17805785284398cuou`
- 仓库：`1020005003350730`

### 本次实跑暴露并已修复的问题

1. 类目误配：玫瑰玻璃罩礼品被打到 `爱好和创作 / 手工艺品材料 / 礼品包装纸`，已通过类目规则回归测试修复。
2. SKU 重复：同色不同罩材只生成颜色后缀，导致 `krasnyy / zheltyy` 重复，已通过变体后缀和提交前去重修复。
3. 插件人机暂停：旧插件遇人机仍会持续轮询刷新，已改为硬暂停并等待人工恢复。

### 已验证

- `node --test test\extension-unified.test.js`
- `node --test test\category-match.test.js test\listing-content-quality.test.js`
- `npm test`
- 当前结果：48 个测试全部通过。

## 2026-06-08 自动化实跑记录

### 本轮代码修复

- `src/autoListing.js`
  - 标题清洗移除中文字符片段，避免 Ozon 标题中混入 1688 中文。
  - 多变体属性合并时，变体属性覆盖基础属性，确保 `颜色名称(10097)` 等可变特征按子 SKU 区分。
- `src/ozonCategoryCache.js`
  - 猫咪钥匙扣类目从 `水晶小饰品` 修正为更稳的 `纪念品`。
  - 宠物饮水机类目从 `纪念奖牌` 修正为 `宠物饮水器`。
  - 收窄 `礼品` 泛词对纪念品类目的影响。
- 新增/更新测试：
  - `test/listing-content-quality.test.js`
  - `test/category-match.test.js`
- 验证：`npm test`，当前 54 个测试全部通过。

### 猫咪钥匙扣验证

- 1688 候选：`cc_1780052530307aed2w`
- 1688 URL：`https://detail.1688.com/offer/1050435735127.html`
- 旧失败任务：`al_mq3ogyz6cat3`
  - SKU：`SKUlq00132`
  - Ozon task_id：`4721273538`
  - 失败原因：标题/类型不匹配，标题中残留中文 `卡通立体`，并误入 `水晶小饰品`。
  - 核对结果：变体属性已经区分，颜色分别为 `черный 23 шт`、`черный оранжевый 23 шт`、`желтый 23 шт`、`серый 23 шт`、`оранжевый 23 шт`。
- 修复后重跑任务：`al_mq3t1x14cat4`
  - SKU：`SKUlq00133`
  - Ozon task_id：`4722124545`
  - 类目：`住宅和花园 / 纪念品和礼品 / 纪念品`
  - 标题：已无中文残留。
  - 结果：Ozon 判定与旧 `SKUlq00132` 部分变体重复，未继续作为成功样本。

### 宠物饮水机成功闭环

- 1688 候选：`cc_17800832113116zoa6`
- 1688 URL：`https://detail.1688.com/offer/1039844389103.html`
- 商品：宠物 USB 自动饮水机/流动饮水器
- 成功任务：`al_mq3tpwv3water2`
- 父 SKU：`SKUlq00135`
- Ozon task_id：`4722250151`
- 店铺：`3815760-4`
- 状态：`live`
- 类目：`宠物用品 / 宠物餐具 / 宠物饮水器`
- 子 SKU：
  - `SKUlq00135-belyy-043-sht`
  - `SKUlq00135-zheltyy-043-sht`
- 库存队列：成功写入，事件 `stock_success`

### 本轮失败样本与原因

- `al_mq3tf085water1 / SKUlq00134`
  - 失败原因：供应商属性里的 `是否属于礼品 / 商务礼品` 误触发纪念品类目，提交到 `纪念奖牌`。
  - 已修复：`礼品` 不再单独触发 `keychainSouvenir`，饮水机预检已命中 `宠物饮水器`。
- `al_mq3t1x14cat4 / SKUlq00133`
  - 失败原因：与旧 `SKUlq00132` 两个变体重复。
  - 结论：不是变体特征 bug；标题和类目修复已生效，但旧失败导入残留会影响同货源重复上架。

## 2026-06-08 受控自动上架第二轮

### 宠物喂食饮水二合一成功闭环

- 1688 候选：`cc_1780084623362lpjt0`
- 1688 URL：`https://detail.1688.com/offer/676537176601.html`
- 商品：猫咪自动喂食器/饮水机二合一，3 个颜色变体来源。
- 上架 job：`al_mq4pmfhqfeed1`
- 父 SKU：`SKUlq00136`
- Ozon task_id：`4728558469`
- product_id：`4971852162`
- 店铺：`3815760-4`
- 状态：`live`
- Ozon 前台状态：`Продается`
- 审核状态：`approved`
- 类目：`宠物用品 / 宠物餐具 / 宠物自动喂食器`
- 库存：已写入 100，库存队列事件 `stock_success`

### 本轮暴露并已修复的问题

1. 首次提交 `SKUlq00136` 时，Ozon 回执报：
   - `Предназначено для(4958)` 必填缺失。
   - 根因：Ozon 触发 `retry_model` 后，代码用品牌/型号字段替换了整个属性数组，误删了其它必填属性。
2. 已修复：
   - 新增 `mergeRetryModelAttributes()`。
   - `retry_model` 只替换品牌/模型相关字段，保留其它必填属性。
   - 测试：`mergeRetryModelAttributes preserves required non-model attributes`。
3. 用户后续看到的 Ozon 提示：
   - `Название модели (для объединения в одну карточку)`。
   - 已核查当前 `SKUlq00136` 的 Ozon API 属性：`9048` 已存在，当前值为 `SKUlq00136`。
   - 当前 product_id `4971852162` errors 为空，状态已在售。

### 已验证

- `node --test test/listing-content-quality.test.js`
- `npm test`
- 当前结果：55 个测试全部通过。

## 2026-06-08 工作流控制台设计

### 已完成设计文档

- 文件：`docs/workflow-console-design.zh-CN.md`
- 方案：标准版 `workflow-runs.json` + 人工可干预控制台。
- 目标：把 ERP 从“黑盒自动化”改造成“可观察、可暂停、可修复、可定点重试”的工作流。

### 第一版设计范围

- 新增统一数据文件：`data/workflow-runs.json`
- 固定 10 个节点：
  1. `ozon_learning`
  2. `keyword_expand`
  3. `crawler_1688`
  4. `candidate_parse`
  5. `match_profit`
  6. `content_generate`
  7. `preflight_check`
  8. `ozon_submit`
  9. `review_reconcile`
  10. `stock_sync`
- 每个节点保存：
  - `status`
  - `input`
  - `output`
  - `error`
  - `diagnosis`
  - `actions`
- 控制台支持：
  - 工作流列表
  - 节点时间线
  - 节点详情
  - payload 查看/编辑/保存草稿/校验/人工确认提交
  - 暂停、恢复、重试本节点、从这里继续、自动修复

### 关键设计约束

- payload 人工编辑后必须先校验，再二次确认提交。
- 禁止自动连续提交多个 Ozon task。
- 遇到人机、必填字段、类目风险、重复卡等问题时进入 `waiting_human`，不继续刷任务。
- 第一版不做拖拽编排，不替换现有 `auto-listing-jobs.json`，先作为统一观察与干预层。

## 2026-06-08 工作流控制台第一版实现

更新时间：2026-06-08 17:23:58 +08:00

### 已完成

- 新增工作流持久化模块：`src/workflowRuns.js`
  - 数据文件：`data/workflow-runs.json`
  - 支持创建/读取工作流、节点 upsert、事件追加、暂停/恢复、payload 草稿保存与校验。
  - 新增 `diagnoseWorkflowError()`，可识别 `9048 Название модели`、`4958 Предназначено для`、类目/type 等常见 Ozon 报错。
  - 新增 `validateSubmitPayload()`，提交前检查重复 `offer_id`、标题中文、类目/type、价格、图片、品牌 `85`、模型名 `9048`。
- 新增 `/api/workflows` 系列 API：
  - `GET /api/workflows`
  - `POST /api/workflows`
  - `GET /api/workflows/:id`
  - `POST /api/workflows/:id/pause`
  - `POST /api/workflows/:id/resume`
  - `POST /api/workflows/:id/nodes/:key/retry`
  - `PUT /api/workflows/:id/payload-draft`
  - `POST /api/workflows/:id/payload-draft/validate`
- 前端新增“工作流控制台”：
  - 文件：`public/index.html`、`public/app.js`、`public/styles.css`
  - 支持运行列表、节点时间线、节点详情、诊断展示、输入/输出查看、payload 草稿编辑、保存、校验、暂停、恢复、重试节点。
- 自动上架真实流程已接入工作流：
  - `src/autoListing.js`
  - `findOrCreateWorkflowForAutoListingJob()` 按 `autoListingJobId` 复用同一条 workflow。
  - `completeListing()` 写入：
    - `ozon_submit`
    - `preflight_check`
    - `review_reconcile`
  - Ozon 回执错误会进入诊断，并在失败时把 workflow 标成 `waiting_human`。
- 库存队列已接入工作流：
  - `src/stockQueue.js`
  - 新增 `workflowStockNodeFromJob()`。
  - 库存排队/成功/失败会同步 `stock_sync` 节点。
  - 库存成功时 workflow 可进入 `live`；库存失败时进入 `waiting_human`。
- 总流程状态已纳入 workflow 摘要：
  - `src/flowSupervisor.js`
  - 新增 `summarizeWorkflowRuns()`。
  - `getFlowStatusSnapshot()` 返回 `workflowRuns` 统计：`total/running/waitingHuman/failed/live/paused`。

### 新增/更新测试

- `test/workflow-runs.test.js`
  - 工作流创建、节点 upsert、事件追加、诊断、payload 校验、暂停/恢复、payload 草稿校验、自动上架 job 绑定复用。
- `test/frontend-static.test.js`
  - 前端工作流控制台 shell 和 payload editor hooks。
- `test/stock-queue.test.js`
  - `workflowStockNodeFromJob()` 映射库存成功为 `stock_sync`。
- `test/flow-supervisor.test.js`
  - `summarizeWorkflowRuns()` 统计 waiting-human/failed/live。

### 验证结果

- `node --test test\frontend-static.test.js`
- `node --test test\workflow-runs.test.js`
- `node --test test\stock-queue.test.js`
- `node --test test\flow-supervisor.test.js`
- `npm test`
- 当前结果：65 个测试全部通过。

### 下一阶段建议

1. 手动启动 ERP，打开“工作流控制台”，用 `/api/workflows` 做一次 UI 冒烟验证。
2. 再跑 1 条受控自动上架，确认 `preflight_check -> ozon_submit -> review_reconcile -> stock_sync` 能出现在控制台。
3. 如果出现 `waiting_human`，优先在控制台查看诊断和 payload 草稿，不要立即重复点击全自动上架。
4. 下一步再接入更早阶段节点：`ozon_learning`、`keyword_expand`、`crawler_1688`、`candidate_parse`、`match_profit`、`content_generate`。

## 当前主要风险

1. OCR 仍可能卡死 Python 子进程，导致提交接口长时间无响应。
2. 已上架的 `SKUlq00127` 是旧单 SKU 结构；新代码支持多 SKU，但不应直接覆盖旧商品，避免再次重复。
3. 后续应使用新候选商品验证多 SKU 展开，不要在同一已上架商品上反复试。
4. Ozon 前台/1688 插件遇人机验证必须进入 `waiting_human`，禁止持续刷新；当前代码已修，但本地 Chrome 需要重新加载/安装最新扩展包。
5. 上架内容标题已补中文残留清洗；描述、属性、营销词仍建议继续增加中文残留检查。
6. 旧的队列文件里可能残留历史 crawler/listing 任务；继续实跑前应先确认队列只保留本轮目标任务。
7. 同一个 1688 货源如果已有失败导入残留，Ozon 可能继续判重复；再次验证应优先换新货源，或先在 Ozon 后台清理残留卡片。
8. `workflow-runs.json` 统一观察层已实现第一版，但目前主要接入了上架/审核/库存后半段；采集、学习、匹配、内容生成前半段还需要继续接入。

## 下一步建议

1. 选新的 1688 小件多 SKU 候选，走 Ozon 反哺后提交一条多 SKU 测试。
2. 验证 Ozon 内容评分里“特征”是否因为变体属性和懒加载属性提升。
3. 把图片 OCR 改成异步队列：先筛缓存图，缺 OCR 的进入图片审核队列，不阻塞上架提交。
4. 对自动上架的 submit payload 增加快照检查：属性数量、min_price、skuOffers、is_aspect 属性必须达标后才提交。
5. 给描述、属性和 rich content 增加中文残留检查，尤其是节日词、1688 促销词、工厂/批发词。
6. 自动上架候选进入 submit 前增加“类目强校验”：当宠物/饮水/喂食等强意图存在时，禁止提交到纪念品/礼品等泛类目。
7. 增加重复残留处理策略：同一 1688 URL 或同款 Ozon 已有失败导入时，自动提示人工清理或换候选，不要盲目新建 SKU。
8. 继续把 `ozon_learning`、`keyword_expand`、`crawler_1688`、`candidate_parse`、`match_profit`、`content_generate` 接入 `workflow-runs.json`。

## 2026-06-09 工作流控制台第二阶段增强

更新时间：2026-06-09  +08:00

### 沟通说明

- 之前每个阶段末尾的“现在请你执行：更新交接文档”，是按用户早先约定给出的阶段提醒。
- 如果用户明确说“请执行：更新交接文档”，则由 Codex 直接更新本文件。
- 后续建议改成更清晰表述：`阶段完成；是否需要我更新交接文档？`，避免误解为必须用户手动执行。

### 已完成：安全自动化默认观察模式

- `src/dailyDistributor.js`
  - `OZON_DISTRIBUTOR_AUTORUN` 默认关闭。
  - `OZON_SERVER_AUTO_HEAL` 默认关闭。
  - distributor 默认只观察，不自动创建/提交任务。
- `src/server.js`
  - server auto-heal 仅在显式开启时执行。
- `src/flowSupervisor.js`
  - 新增自动化安全状态：`observe_only`。
  - `/api/flow/status` 返回 `automation.mode`、`distributorAutorun`、`serverAutoHeal`。
  - observe-only 下阻止自动修复创建/重试/重新提交任务。
- 当前接口状态：`automation.mode = observe_only`。

### 已完成：人工介入闭环

- `src/workflowRuns.js`
  - 新增 `requestWorkflowNewSource()`：人工选择换新货源，关闭当前候选并写事件。
  - 新增 `retryWorkflowAfterManualFix()`：人工确认外部残留已清理后重试当前节点。
  - 新增 `confirmWorkflowContinue()`：人工确认风险可接受后解除等待/提交锁。
  - workflow 节点 upsert 保留已有 metadata/diagnosis/input/output/actions，避免后续写入覆盖诊断。
  - waiting-human/run 状态自动同步 `locks.waitingHuman`。
- `src/server.js`
  - 新增 API：
    - `POST /api/workflows/:id/request-new-source`
    - `POST /api/workflows/:id/nodes/:key/manual-fix-retry`
    - `POST /api/workflows/:id/nodes/:key/confirm-continue`
- `public/app.js`
  - waiting-human 节点详情显示“人工介入”面板。
  - 三个按钮：`换新货源`、`已清理残留，重试`、`确认继续提交`。
  - `确认继续提交` 有浏览器二次确认。
- `public/styles.css`
  - 新增人工介入面板样式和危险按钮样式。

### 已完成：workflow 汇总与锁状态

- `src/workflowRuns.js`
  - `summarizeWorkflowRunList()` 新增：
    - `lockedWaitingHuman`
    - `submitLocked`
    - `lockedPaused`
- `public/app.js`
  - 工作流汇总卡显示等待人工锁、提交锁、暂停锁。
  - 节点详情和卡片显示锁徽章：`已暂停`、`等待人工`、`提交锁定`、`无锁`。
- 已修正历史 workflow 数据：等待人工流程带 `locks.waitingHuman=true`，陈旧 `ozon_submit running` 节点改为 skipped。

### 已完成：前半段 workflow 接入

- `src/crawler1688.js`
  - 1688 采集任务创建时自动创建/绑定 workflow。
  - 写入 `crawler_1688` 节点：任务 ID、搜索词/URL、初始插件任务、采集状态。
  - 插件 discover/detail 遇人机时写入 `waiting_human`，不继续派发。
  - 详情解析后写入 `candidate_parse` 节点：候选数量、通过/拒绝数量、标题、URL、价格、SKU 数、图片数、尺重状态。
  - 新增 `CRAWLER1688_DATA_DIR` 支持测试隔离。
- `src/autoListing.js`
  - `match_profit` 节点增强：记录评估数、拒绝数、拒绝原因统计、拒绝样本、最佳匹配利润/置信度/采购价/目标价/价差。
  - `content_generate` 节点增强：记录俄文标题、描述长度、属性提示字段、候选图片数、SKU 变体数、尺重状态、视觉卡片状态、内容问题。

### 已完成：提交前总闸与审核回执

- `src/workflowRuns.js`
  - 新增 `buildPreflightGateNode()`。
  - 总闸汇总：payload 问题、重复货源、内容问题、图片不足、尺重缺失、类目缺失、多变体塌缩为单 SKU。
  - preflight 失败时：`status=failed`、`runStatus=waiting_human`、`reasonCode=PREFLIGHT_BLOCKED`。
  - 新增 `workflowReviewReconcileNode()`。
  - Ozon 回执节点输出：`taskId`、`skuOffers`、`importedCount`、`errorCount`、`warningCount`、`reasonCode`、`firstError`、`importErrors`、`importWarnings`。
- `src/autoListing.js`
  - `completeListing()` 改为调用 `buildPreflightGateNode()`。
  - preflight 失败会真正阻断，不再继续调用 Ozon `/v3/product/import`。
  - 阻断时 job 状态为 `preflight_blocked`。
  - Ozon 回执改为 `workflowReviewReconcileNode()` 写入，错误进入 waiting-human。

### 已完成：存储稳定性

- `src/workflowRuns.js`
  - 写入 `workflow-runs.json` 增加串行写队列。
  - Windows `EPERM/EBUSY/ENOENT rename` 增加重试。
  - 解决全量测试中 workflow 测试并发写 JSON 偶发失败。

### 当前测试状态

- 最新全量验证：`npm test`
- 当前结果：`102/102` 通过。

### 当前运行状态

- 后台已重启。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行。
- `/api/flow/status`：`observe_only`。
- 当前 workflow 概况：约 4 条历史 workflow，其中约 3 条仍处于 `waiting_human`，主要是重复货源/重复参考品风险。

### 当前项目判断

- 工作流已从“后半段观察层”升级为“采集到审核的主流程可观察层”。
- 已接入节点：
  - `crawler_1688`
  - `candidate_parse`
  - `match_profit`
  - `content_generate`
  - `preflight_check`
  - `ozon_submit`
  - `review_reconcile`
  - `stock_sync`
- 仍需加强节点：
  - `ozon_learning`
  - `keyword_expand`
- 当前策略正确：不要立即恢复无人值守全自动，应先跑单条受控流程，观察每个节点输入/输出/诊断。

### 下一步建议

1. 接入 `ozon_learning` 节点：Ozon 采样任务、竞品数量、类目/价格/标题样本、采样失败原因。
2. 接入 `keyword_expand` 节点：翻译词、扩展词、多维度关键词、拓词失败原因。
3. 做 workflow “从节点继续”的真实执行闭环，而不只是标记重试。
4. 增加“换新货源”动作的自动后续：从当前 Ozon 样本重新采集一个新 1688 候选。
5. 跑一条受控链路：`1 个 Ozon 学习样本 -> 1688 采集 -> 匹配 -> 内容生成 -> preflight`，暂不自动提交 Ozon。
6. 确认 Chrome 扩展已重新加载最新版，避免人机后继续刷页面。

## 2026-06-09 工作流源头节点接入补充

更新时间：2026-06-09 +08:00

### 用户偏好更新

- 用户明确要求：`更新交接文档。不要问。继续后面的开发`。
- 后续阶段完成后，Codex 应直接更新本交接文档，不再询问“是否需要更新交接文档”。

### 已完成：`ozon_learning` 接入 workflow

- `src/ozonLearning.js`
  - 新增 `OZON_LEARNING_DATA_DIR`，支持测试隔离。
  - 新增 `summarizeLearningRows()`，汇总 Ozon 学习样本。
  - 新增 `findOrCreateOzonLearningWorkflow()`，按 `ozonLearningTaskId` 绑定 workflow。
  - 新增 `emitOzonLearningWorkflowNode()`，统一写入 `ozon_learning` 节点。
  - Ozon 学习任务创建时写入 running 节点。
  - 搜索完成后写入：样本数量、详情队列数、机会品数量、价格区间、类目统计、样本标题。
  - Ozon 人机/登录验证会进入 `waiting_human` 并设置 `locks.waitingHuman=true`。

### 已完成：`keyword_expand` 接入 workflow

- `src/workflowRuns.js`
  - `workflowNodeFromAutoListingStage()` 的 output 新增源头字段：
    - `sourceType`
    - `sourceValue`
    - `sourceText`
    - `keywordCount`
    - `totalFound`
    - `detailQueued`
    - `detailedCount`
    - `opportunityCount`
    - `priceMinRub`
    - `priceMaxRub`
    - `categoryCounts`
    - `sampleTitles`
- `src/autoListing.js`
  - `sampled` 阶段写入 Ozon 样本摘要。
  - `translating` 阶段写入原始 Ozon 文本 `sourceText`、翻译关键词 `keyword`、扩展关键词 `searchKeywords`。

### 新增/更新测试

- `test/ozon-learning-workflow.test.js`
  - Ozon 学习搜索任务会写入 `ozon_learning` workflow 节点。
  - Ozon 人机会让 workflow 进入 `waiting_human`。
- `test/workflow-runs.test.js`
  - `workflowNodeFromAutoListingStage()` 覆盖 Ozon 学习样本摘要和 keyword_expand 摘要。
- `test/frontend-static.test.js`
  - 覆盖 Ozon 学习和关键词扩展诊断字段。

### 验证结果

- `npm test`
- 当前结果：`106/106` 通过。

### 当前链路状态

主链路已基本完整可视化：

`ozon_learning -> keyword_expand -> crawler_1688 -> candidate_parse -> match_profit -> content_generate -> preflight_check -> ozon_submit -> review_reconcile -> stock_sync`

### 下一步开发方向

1. 做 workflow “从节点继续”的真实执行闭环，而不只是修改状态/写事件。
2. 优先支持安全动作：
   - `preflight_check`：重新校验 payload 草稿/提交前总闸。
   - `crawler_1688`：恢复采集任务。
   - `review_reconcile`：按诊断进入修复/重试路径。
3. 动作必须继续尊重 `observe_only`，不能绕过人工确认自动提交 Ozon。

## 2026-06-09 工作流“从节点继续”闭环补充

更新时间：2026-06-09 +08:00

### 已完成：安全续跑入口

- `src/server.js`
  - 新增 `continueWorkflowNode()`，作为页面“从此继续”的统一后端入口。
  - 新增接口：`POST /api/workflows/:id/nodes/:key/continue`。
  - 当前支持安全动作：
    - `crawler_1688`：如果 workflow 绑定了 `crawlerTaskId`，将采集任务恢复为 `running`。
    - `preflight_check`：如果存在 `payloadDraft`，重新执行 payload 草稿校验。
    - 其他节点：只记录续跑请求与审计事件，不绕过人工锁强行提交。
  - 每次点击会追加 `continue_requested` 事件，便于在事件时间线追踪是谁、在哪个节点触发了继续。

### 已完成：前端人工控制台入口

- `public/app.js`
  - 节点操作区新增按钮：`从此继续`。
  - 点击后调用 `/api/workflows/:id/nodes/:key/continue`。
  - 事件时间线新增 `continue_requested -> 从此继续` 中文标签。
  - 保留已有动作：暂停、恢复、重试节点、换新货源、已清理残留重试、确认继续提交。

### 新增/更新测试

- `test/server-routes.test.js`
  - 覆盖 workflow continue node route。
- `test/frontend-static.test.js`
  - 覆盖 `continue-node` 按钮与 `continue_requested` 事件标签。

### 验证结果

- 局部验证：`node --test test\server-routes.test.js test\frontend-static.test.js`
  - `19/19` 通过。
- 全量验证：`npm test`
  - `107/107` 通过。

### 当前运行状态

- 已执行 `scripts\ops.ps1 stop` / `scripts\ops.ps1 start` 重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status` 当前安全模式：`observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。
- 当前主要人工动作仍是：`人工确认是否换货源`。

### 当前判断

- 工作流控制台已具备第一版“人工可干预控制台”闭环：能看节点、看诊断、看锁、保存/校验 payload、暂停/恢复、换货源、重试、确认继续、从节点继续。
- 当前“从此继续”是安全版续跑：只恢复可安全恢复的节点，不会在 `observe_only` 下偷偷自动提交 Ozon。
- 下一步应把“从此继续”扩展为节点执行器：按节点 key 调用对应 runner，并把每一步结果重新写回 workflow。

### 下一步开发方向

1. 做 `workflowNodeExecutor`：把 `crawler_1688`、`candidate_parse`、`match_profit`、`content_generate`、`preflight_check` 的续跑动作统一封装。
2. 优先把 `request-new-source` 做成真实换货源：从当前 Ozon 学习样本/关键词重新挑 1 个 1688 候选。
3. 增加前端按钮禁用规则：高风险节点只允许人工确认后的动作，避免误点。
4. 跑一条受控链路到 `preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-09 工作流节点执行器第一版

更新时间：2026-06-09 +08:00

### 已完成：`workflowNodeExecutor` 模块化

- 新增 `src/workflowNodeExecutor.js`
  - 把原来写在 `src/server.js` 里的“从此继续”逻辑拆成独立执行器。
  - 导出 `continueWorkflowNode()`，后续所有节点续跑逻辑统一从这里扩展。
  - 使用依赖注入方式接入外部动作，便于测试和避免执行器直接耦合 Express。

### 当前支持的安全续跑动作

- `crawler_1688`
  - 如果 workflow 绑定了 `entity.crawlerTaskId`，调用 `updateCrawlerTaskStatus(taskId, "running")`。
  - 追加动作：`crawler_resumed`。
- `preflight_check`
  - 如果存在 `payloadDraft`，调用 `validatePayloadDraft(runId)`。
  - 追加动作：`payload_draft_validated`。
- 其他节点
  - 只记录 `continue_requested` 事件。
  - 追加动作：`continue_recorded`。
  - 明确 `supported=false`，表示还没有接入真实自动执行器。
  - 不会触发 Ozon 提交，不会绕过 `observe_only`。

### 已完成：server 接入执行器

- `src/server.js`
  - `POST /api/workflows/:id/nodes/:key/continue` 改为调用 `workflowNodeExecutor.continueWorkflowNode()`。
  - 传入依赖：`getWorkflowRun`、`updateCrawlerTaskStatus`、`validatePayloadDraft`、`retryWorkflowAfterManualFix`、`appendWorkflowEvent`。
  - 避免 server 内继续堆积节点执行分支。

### 新增测试

- `test/workflow-node-executor.test.js`
  - 覆盖 `crawler_1688` 续跑会恢复绑定采集任务。
  - 覆盖 `preflight_check` 续跑会重新校验 payload 草稿。
  - 覆盖未支持节点只记录事件，不产生不安全副作用。

### 验证结果

- 局部验证：`node --test test\workflow-node-executor.test.js test\server-routes.test.js test\frontend-static.test.js`
  - `22/22` 通过。
- 全量验证：`npm test`
  - `110/110` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。

### 下一步开发方向

1. 为 `match_profit` 接入真实续跑动作：基于 workflow/entity 找回 auto listing job 或候选，重新执行匹配/利润评估。
2. 为 `content_generate` 接入真实续跑动作：基于已有候选和类目，重新生成标题、描述、属性、图片摘要。
3. 为 `request-new-source` 接入真实换货源动作：从现有 Ozon 学习样本/关键词重新创建一个 1688 采集任务。
4. 前端补充按钮状态：对 `supported=false` 的节点显示“仅记录，未接入自动执行”。

## 2026-06-09 `match_profit` 真实续跑第一版

更新时间：2026-06-09 +08:00

### 已完成：匹配/利润节点接入真实续跑

- `src/workflowNodeExecutor.js`
  - `continueWorkflowNode()` 新增 `match_profit` 分支。
  - 当 workflow 绑定 `entity.autoListingJobId` 时，调用 `rerunAutoListingMatch(autoListingJobId)`。
  - 成功动作标记为 `match_profit_rerun`。
  - 仍会追加 `continue_requested` 审计事件。

### 已完成：autoListing 只重跑匹配，不提交 Ozon

- `src/autoListing.js`
  - 新增 `selectBestMatchForOzon()`：纯匹配选择函数，复用本地/AI 匹配、利润计算、跑量兜底逻辑。
  - 新增 `rerunAutoListingMatch()`：按 auto listing job 重新获取 Ozon 上下文、候选池、小件门禁、排序候选，然后只执行匹配/利润分析。
  - 匹配成功后：job 状态更新为 `matched`，写入 `bestMatch`、`candidateData`、`ozonContext`，workflow `match_profit` 节点写入 success 诊断。
  - 匹配失败后：job 停在 `matching`/`failed`，workflow `match_profit` 节点进入 `waiting_human`，记录 rejectedReasons/rejectedSamples。
  - 不生成 listingContent，不调用 `completeListing()`，不提交 Ozon。

### 已完成：server 接入

- `src/server.js`
  - 从 `autoListing.js` 导入 `rerunAutoListingMatch`。
  - `POST /api/workflows/:id/nodes/:key/continue` 的执行器依赖新增 `rerunAutoListingMatch`。

### 新增/更新测试

- `test/workflow-node-executor.test.js`
  - 覆盖 `match_profit` 节点点击“从此继续”会调用 `rerunAutoListingMatch()`。
- `test/auto-listing-match-rerun.test.js`
  - 覆盖 `selectBestMatchForOzon()` 能在不提交/不生成内容的情况下选出同族且有利润的候选。
- `test/server-routes.test.js`
  - 覆盖 server 已把 `rerunAutoListingMatch` 接入 workflow continue route。

### 验证结果

- 局部验证：`node --test test\auto-listing-match-rerun.test.js test\workflow-node-executor.test.js test\server-routes.test.js`
  - `7/7` 通过。
- 全量验证：`npm test`
  - `112/112` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。

### 当前判断

- “从此继续”已经从记录型按钮升级为第一批真实节点执行器：
  - `crawler_1688`：恢复采集任务。
  - `preflight_check`：重新校验 payload 草稿。
  - `match_profit`：重新执行匹配/利润分析。
- 仍然没有自动提交 Ozon，符合当前安全策略。

### 下一步开发方向

1. 为 `content_generate` 接入真实续跑：基于 `matched` job 的 `bestMatch/candidateData/ozonContext` 重新生成标题、描述、属性和视觉卡片 prompt。
2. 前端对 `supported=false` 的节点显示“仅记录，未接入自动执行”。
3. 把 `request-new-source` 做成真实换货源动作：重新创建 1688 采集任务或从候选池挑下一个候选。
4. 跑一条受控链路到 `content_generate`，继续保持不自动提交 Ozon。

## 2026-06-10 `content_generate` 真实续跑第一版

更新时间：2026-06-10 +08:00

### 已完成：内容生成节点接入真实续跑

- `src/workflowNodeExecutor.js`
  - `continueWorkflowNode()` 新增 `content_generate` 分支。
  - 当 workflow 绑定 `entity.autoListingJobId` 时，调用 `rerunAutoListingContent(autoListingJobId)`。
  - 成功动作标记为 `content_generate_rerun`。
  - 仍会追加 `continue_requested` 审计事件。

### 已完成：autoListing 只重跑内容生成，不提交 Ozon

- `src/autoListing.js`
  - 新增 `rerunAutoListingContent()`。
  - 基于已匹配 job 的 `bestMatch`、`candidateData`、`ozonContext` 重新调用 `generateListingContentWithLlm()`。
  - 重新生成：`listingContent`、`visualCard.prompt`、`contentGenerationWorkflowSummary()`。
  - 成功后 job 状态更新为 `ready_for_listing`，workflow `content_generate` 节点写入 success 诊断。
  - 失败时 job 进入 failed/guided，workflow `content_generate` 节点进入 `waiting_human`，提示 LLM 未配置或内容生成失败。
  - 不调用 `completeListing()`，不调用 Ozon Seller API，不自动提交。

### 已完成：server 接入

- `src/server.js`
  - 从 `autoListing.js` 导入 `rerunAutoListingContent`。
  - `POST /api/workflows/:id/nodes/:key/continue` 的执行器依赖新增 `rerunAutoListingContent`。

### 新增/更新测试

- `test/workflow-node-executor.test.js`
  - 覆盖 `content_generate` 节点点击“从此继续”会调用 `rerunAutoListingContent()`。
- `test/server-routes.test.js`
  - 覆盖 server 已把 `rerunAutoListingContent` 接入 workflow continue route。

### 验证结果

- 局部验证：`node --test test\workflow-node-executor.test.js test\server-routes.test.js test\frontend-static.test.js`
  - `24/24` 通过。
- 全量验证：`npm test`
  - `113/113` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。

### 当前判断

- “从此继续”当前真实支持节点：
  - `crawler_1688`：恢复采集任务。
  - `preflight_check`：重新校验 payload 草稿。
  - `match_profit`：重新执行匹配/利润分析。
  - `content_generate`：重新生成上架内容和视觉卡片 prompt。
- 整体仍处于安全观察模式，不会绕过人工确认自动提交 Ozon。

### 下一步开发方向

1. 前端对 `supported=false` 或 `continue_recorded` 的节点显示“仅记录，未接入自动执行”。
2. 为 `request-new-source` 接入真实换货源动作：重新创建 1688 采集任务或从候选池挑下一个候选。
3. 把 `content_generate -> preflight_check` 的衔接增强：内容生成成功后可自动写入/刷新 payloadDraft，然后由人工点击校验。
4. 跑一条受控链路到 `preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 `content_generate -> preflight_check` 草稿衔接

更新时间：2026-06-10 +08:00

### 已完成：内容生成后自动刷新 Payload 草稿

- `src/autoListing.js`
  - 新增 `buildListingPayloadDraftFromJob()`：从已生成内容的 auto listing job 构建 Ozon payload 草稿。
  - 草稿包含：`items`、offer_id、标题、描述、图片、尺重、价格、类目、品牌、模型名称、营销属性、变体 SKU。
  - 新增 `saveWorkflowPayloadDraftForListingJob()`：为 auto listing job 找到/创建 workflow，并写入 `payloadDraft`。
  - `rerunAutoListingContent()` 成功后会自动刷新 workflow `payloadDraft`。
  - 刷新成功后写入 `preflight_check` pending 节点，提示“等待人工点击校验 Payload”。
  - 不调用 `completeListing()`，不调用 Ozon Seller API，不自动提交。

### 当前交互逻辑

- 人工在 workflow 控制台点击 `content_generate` 的“从此继续”。
- 系统重新生成上架内容。
- 系统自动生成/刷新 Payload 草稿。
- `preflight_check` 节点变为 pending，并给出推荐动作：
  - 校验 Payload
  - 检查图片/属性/变体
  - 必要时编辑草稿
- 人工再点击“校验 Payload”，进入提交前总闸。

### 新增测试

- `test/auto-listing-payload-draft.test.js`
  - 覆盖 `buildListingPayloadDraftFromJob()` 能从 ready job 构建可通过 `validateSubmitPayload()` 的 payload 草稿。

### 验证结果

- 局部验证：`node --test test\auto-listing-payload-draft.test.js test\workflow-node-executor.test.js test\server-routes.test.js test\frontend-static.test.js`
  - `25/25` 通过。
- 全量验证：`npm test`
  - `114/114` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。
- 当前 workflow 概况：`total=4`，`waitingHuman=3`，`highRisk=4`，`blocking=4`。

### 当前判断

- 工作流已经形成更完整的人工可控链路：
  - `match_profit` 可真实续跑。
  - `content_generate` 可真实续跑。
  - 内容生成成功后会自动准备 payload 草稿。
  - `preflight_check` 仍由人工点击校验，不会自动提交 Ozon。

### 下一步开发方向

1. 前端增加“真实执行 / 仅记录”的按钮反馈：显示 `continue_requested.data.supported` 和 `actions`。
2. 为 `request-new-source` 接入真实换货源动作：重新创建 1688 采集任务或从候选池挑下一个候选。
3. 增强 payload 草稿 UI：显示草稿 item 数、父 SKU、类目路径、变体数。
4. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 workflow 续跑执行反馈显示

更新时间：2026-06-10 +08:00

### 已完成：前端区分“真实执行 / 仅记录”

- `public/app.js`
  - 新增 `workflowEventExecutionBadge()`。
  - 新增 `workflowEventActionText()`。
  - workflow 最近事件里，`continue_requested` 事件会显示：
    - `真实执行`：后端执行器实际调用了节点动作。
    - `仅记录`：当前节点尚未接入自动执行器，只记录了人工请求。
  - 事件 meta 中同步展示 actions，例如：`match_profit_rerun`、`content_generate_rerun`、`payload_draft_validated`、`continue_recorded`。

### 已完成：样式

- `public/styles.css`
  - 新增 `.workflow-event-meta`。
  - 新增 `.workflow-event-badge`。
  - 新增 `.workflow-event-badge-live` / `.workflow-event-badge-record`。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖事件时间线会显示续跑执行反馈。
  - 覆盖 `真实执行` / `仅记录` / actions 文案与样式钩子。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `18/18` 通过。
- 全量验证：`npm test`
  - `115/115` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。

### 当前判断

- 现在人工控制台不仅能点“从此继续”，还能在事件流里看清楚该次点击到底触发了真实执行，还是只是审计记录。
- 这能降低误操作和误判，适合继续扩展更多节点执行器。

### 下一步开发方向

1. 为 `request-new-source` 接入真实换货源动作：重新创建 1688 采集任务或从候选池挑下一个候选。
2. 增强 payload 草稿 UI：显示草稿 item 数、父 SKU、类目路径、变体数。
3. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 真实换货源第一版

更新时间：2026-06-10 +08:00

### 已完成：`request-new-source` 变成真实动作

- `src/autoListing.js`
  - 新增 `deriveNewSourceKeywords()`：从已有 `searchKeywords`、`keyword`、`bestMatch.candidateTitle`、`ozonTitle` 推导换源关键词。
  - 新增 `requestAutoListingNewSource()`：为当前 auto listing job 重新创建 1688 搜索任务。
  - 换源后会：
    - 创建新的 `crawler_1688` 搜索任务。
    - 更新 job 状态为 `waiting_crawl`。
    - 追加 `new_source_requested` 记录。
    - 重新写入 `waiting_crawl` workflow 节点。
    - 尝试刷新 payload 草稿（如果已有内容上下文可用）。

### 已完成：workflow 层不再盲目取消

- `src/workflowRuns.js`
  - `requestWorkflowNewSource()` 现在支持 `replacementCrawlerTaskIds`。
  - 如果有 replacement 任务，workflow 保持 `running`，不再变成 `cancelled`。
  - 如果没有 replacement 任务，仍保留原来的取消行为。

### 已完成：server 接入

- `src/server.js`
  - `POST /api/workflows/:id/request-new-source` 会先尝试对 `autoListingJobId` 调用 `requestAutoListingNewSource()`。
  - 再把 `replacementCrawlerTaskIds` 传回 workflow 状态更新。
  - 这样按钮“换新货源”在自动上架 workflow 上会真的开新 1688 搜索任务。

### 新增测试

- `test/auto-listing-new-source.test.js`
  - 覆盖换源关键词推导顺序。
- `test/workflow-runs.test.js`
  - 覆盖有 replacement 任务时 workflow 保持运行。
- `test/server-routes.test.js`
  - 覆盖 server 已接入 `requestAutoListingNewSource`。

### 验证结果

- 局部验证：`node --test test\auto-listing-new-source.test.js test\workflow-runs.test.js test\server-routes.test.js`
  - `26/26` 通过。
- 全量验证：`npm test`
  - `117/117` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。

### 当前判断

- 现在 `request-new-source` 已经不只是“放弃当前候选”，而是可以真的重新发起下一轮 1688 采集。
- 这让 workflow 从“看见失败”进一步变成“现场换血源”。

### 下一步开发方向

1. 给换源按钮增加更明确的 UI 文案：显示“已创建 X 个新 1688 任务”。
2. 增强 payload 草稿 UI：显示草稿 item 数、父 SKU、类目路径、变体数。
3. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 换货源按钮提示增强

更新时间：2026-06-10 +08:00

### 已完成：换货源提示更明确

- `public/app.js`
  - 新增 `workflowNewSourceToast()`。
  - 点击“换新货源”后，前端会根据后端返回的 `replacementCrawlerTaskIds` / `replacement.crawlerTaskIds` 提示：
    - `已创建 X 个新 1688 采集任务`
    - 若没有任务，则回退为 `已关闭当前候选，请重新选择新货源`
  - 这样能直观看到这次换源是否真的开了新任务。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowNewSourceToast` 与 `replacementCrawlerTaskIds` 的静态可见性。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js test\server-routes.test.js test\auto-listing-new-source.test.js test\workflow-runs.test.js`
  - `44/44` 通过。
- 全量验证：`npm test`
  - `117/117` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：`automation.mode = observe_only`。

### 下一步开发方向

1. 增强 payload 草稿 UI：显示草稿 item 数、父 SKU、类目路径、变体数。
2. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。

## 2026-06-10 Payload 草稿摘要 UI

更新时间：2026-06-10 +08:00

### 已完成：草稿摘要可视化

- `public/app.js`
  - 新增 `workflowPayloadDraftItems()` 和 `workflowPayloadDraftSummary()`。
  - 在工作流节点详情的 `Payload 草稿` 编辑框上方显示摘要：
    - 商品数
    - 父 SKU
    - 类目
    - 变体数
    - 图片数
  - 摘要优先读取 `payloadDraft.summary`，没有 summary 时从 `items` / 单 item 草稿中兜底推导。

- `public/styles.css`
  - 新增 `.workflow-payload-summary` 样式。
  - 摘要以胶囊指标形式展示，便于人工介入时快速判断草稿结构是否正确。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowPayloadDraftSummary`、`父SKU`、`类目`、`变体数`、`.workflow-payload-summary` 的前端可见性。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `19/19` 通过。
- 全量验证：`npm test`
  - `118/118` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 跑一条受控链路：`match_profit -> content_generate -> payloadDraft -> preflight_check`，继续保持不自动提交 Ozon。
2. 给工作流详情增加“节点输入/输出摘要”，减少人工排查时翻 JSON 的次数。
3. 增加 preflight 问题的“一键定位字段”提示，让必填字段缺失能直接指向 Payload 编辑位置。

## 2026-06-10 受控链路：跑到提交前总闸

更新时间：2026-06-10 +08:00

### 已完成：受控串跑执行器

- `src/workflowNodeExecutor.js`
  - 新增 `runControlledWorkflowChain()`。
  - 固定只串联执行：
    - `match_profit`
    - `content_generate`
    - `preflight_check`
  - 每一步复用既有安全执行器 `continueWorkflowNode()`。
  - 若节点不支持或结果 `ok === false`，链路会停止。
  - 最后追加 `controlled_chain_completed` 事件，明确记录“未触发 Ozon 提交”。

### 已完成：后端入口

- `src/server.js`
  - 新增 `POST /api/workflows/:id/controlled-chain`。
  - 接入依赖：
    - `rerunAutoListingMatch`
    - `rerunAutoListingContent`
    - `validatePayloadDraft`
    - `appendWorkflowEvent`
  - 该入口不调用 Ozon import / submit 类接口。

### 已完成：前端入口

- `public/app.js`
  - 工作流节点详情操作区新增按钮：`受控跑到总闸`。
  - 点击后调用 `/api/workflows/:id/controlled-chain`。
  - Toast 显示：`受控链路已跑 X 步，未触发 Ozon 提交`。
  - 事件时间线新增 `controlled_chain_completed` 标签：`受控链路`。

### 新增测试

- `test/workflow-node-executor.test.js`
  - 覆盖受控链路按 `match_profit -> content_generate -> preflight_check` 顺序执行。
  - 覆盖不调用 submit/import 类动作。
- `test/server-routes.test.js`
  - 覆盖后端受控链路路由。
- `test/frontend-static.test.js`
  - 覆盖前端按钮、文案和安全提示。

### 验证结果

- 局部验证：
  - `node --test test\workflow-node-executor.test.js`
    - `6/6` 通过。
  - `node --test test\server-routes.test.js test\frontend-static.test.js`
    - `23/23` 通过。
- 全量验证：`npm test`
  - `121/121` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 给 `preflight_check` 的 issues 增加“一键定位字段”提示。
2. 给工作流详情增加“节点输入/输出摘要”，减少人工排查时翻 JSON。
3. 增加受控链路结果面板：显示每步动作、是否真实执行、停止原因。

## 2026-06-10 preflight 问题一键定位字段

更新时间：2026-06-10 +08:00

### 已完成：问题定位映射

- `public/app.js`
  - 新增 `workflowPayloadIssueLocator()`。
  - 针对常见校验问题补了字段映射：
    - `EMPTY_PAYLOAD` → `payload.items`
    - `MISSING_OFFER_ID` → `items[0].offer_id`
    - `MISSING_NAME` / `CHINESE_IN_TITLE` → `items[0].name`
    - `MISSING_CATEGORY` → `items[0].description_category_id / type_id`
    - `MISSING_PRICE` → `items[0].price`
    - `IMAGES_TOO_FEW` → `items[0].images`
    - `MISSING_BRAND` → `items[0].attributes[85]`
    - `MISSING_MODEL_NAME` → `items[0].attributes[9048]`
  - 在 `Payload 草稿` 区域内新增校验问题列表。
  - 点击某条问题后，编辑器会聚焦并选中对应字段附近文本，同时提示“已定位字段”。

- `public/styles.css`
  - 新增 `.workflow-payload-issues`、`.workflow-payload-issue-list`、`.workflow-payload-issue` 样式。
  - 让问题列表更像可操作的诊断卡片。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowPayloadIssueLocator`、`data-payload-path`、`定位字段` 文案。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `21/21` 通过。
- 全量验证：`npm test`
  - `122/122` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 增加“定位字段”后的视觉高亮和问题计数汇总。
2. 给 preflight 校验补一个“按错误码分组”的总结面板。
3. 继续完善受控链路结果面板，减少翻 JSON 的成本。

## 2026-06-10 preflight 错误码汇总面板

更新时间：2026-06-10 +08:00

### 已完成：按错误码汇总

- `public/app.js`
  - 新增 `workflowPayloadIssueSummary()`。
  - 在 `Payload 草稿` 的校验问题区域顶部显示“按错误码汇总”。
  - 每个分组以 `规则/错误码：数量` 的胶囊标签展示，方便先看问题类型，再点单条问题定位字段。

- `public/styles.css`
  - 新增 `.workflow-payload-issue-summary` 和 `.workflow-payload-issue-summary-list` 样式。
  - 汇总区与单条问题卡分层展示，阅读顺序更清晰。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowPayloadIssueSummary`、`按错误码汇总`、`规则/` 文案。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `22/22` 通过。
- 全量验证：`npm test`
  - `123/123` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 给问题定位补一个高亮闪烁/滚动到目标字段的视觉反馈。
2. 给 summary 面板增加“最常见 3 类错误”的排序提示。
3. 继续完善受控链路结果面板，减少人工排查步骤。

## 2026-06-10 Payload 字段定位高亮

更新时间：2026-06-10 +08:00

### 已完成：定位后的视觉反馈

- `public/app.js`
  - 新增 `highlightWorkflowPayloadEditor()`。
  - 点击 `Payload` 校验问题后，会：
    - 聚焦 `Payload` 编辑框。
    - 选中目标字段附近文本。
    - 调用 `scrollIntoView()` 自动滚动到编辑器。
    - 给编辑框临时添加 `payload-located` 高亮类。

- `public/styles.css`
  - 新增 `.workflow-payload-editor.payload-located`。
  - 新增 `@keyframes payloadLocatePulse`，让定位动作有短暂高亮反馈。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `highlightWorkflowPayloadEditor`、`scrollIntoView`、`payload-located`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `23/23` 通过。
- 全量验证：`npm test`
  - `124/124` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 继续完善受控链路结果面板：显示每步动作、真实执行/仅记录、停止原因。
2. 给工作流节点输入/输出加摘要卡，减少翻 JSON。
3. 给 preflight 问题补“自动修复建议模板”，例如模型名称 9048 的建议值。

## 2026-06-10 受控链路结果面板

更新时间：2026-06-10 +08:00

### 已完成：链路结果可视化

- `public/app.js`
  - 新增 `workflowControlledChainResultPanel()`。
  - 会从最近的 `controlled_chain_completed` 事件读取：
    - 链路结果
    - 停止原因
    - 每一步是否 `真实执行` / `仅记录`
    - 每步动作列表
  - 面板插入到节点详情中，和事件时间线并列展示。

- `public/styles.css`
  - 新增 `.workflow-chain-result` 和 `.workflow-chain-steps` 样式。
  - 用卡片化结构展示每一步执行状态。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowControlledChainResultPanel`、`链路结果`、`停止原因`、`workflow-chain-result`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `24/24` 通过。
- 全量验证：`npm test`
  - `125/125` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 给工作流节点输入/输出增加摘要卡，减少翻 JSON。
2. 给 preflight 问题补“自动修复建议模板”，例如模型名称 9048 的建议值。
3. 继续收敛链路结果与事件日志的重复信息。

## 2026-06-10 节点输入/输出摘要卡

更新时间：2026-06-10 +08:00

### 已完成：节点 IO 摘要

- `public/app.js`
  - 新增 `workflowNodeIoSummaryValue()`。
  - 新增 `workflowNodeIoSummary()`。
  - 在节点详情的 JSON 展开区上方新增：
    - `输入摘要`
    - `输出摘要`
  - 摘要会优先展示常用关键字段：
    - `candidateCount`
    - `acceptedCount`
    - `rejectedCount`
    - `itemCount`
    - `variantCount`
    - `candidateImageCount`
    - `skuVariantCount`
    - `payloadDraftReady`
    - `listingContentReady`
    - `ok`
  - 若输出里有 `issues` 或 `issueCount`，会显示 `问题数`。
  - 若有 `actions`，会显示 `动作数`。
  - 原始 JSON 仍保留在 `节点输入` / `节点输出` details 中。

- `public/styles.css`
  - 新增 `.workflow-io-summary-grid` 和 `.workflow-io-summary` 样式。
  - 输入/输出摘要以双卡片展示，适合快速扫一眼。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowNodeIoSummary`、`输入摘要`、`输出摘要`、`问题数`、`.workflow-io-summary`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `25/25` 通过。
- 全量验证：`npm test`
  - `126/126` 通过。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`paused = 1`，`waitingHuman = 0`

### 下一步开发方向

1. 给 preflight 问题补“自动修复建议模板”，例如模型名称 9048 的建议值。
2. 继续收敛链路结果与事件日志的重复信息。
3. 增加一键复制节点摘要，方便发给人工/供应商排查。

## 2026-06-11 Payload 自动修复建议模板

更新时间：2026-06-11 +08:00

### 已完成：问题修复建议卡

- `public/app.js`
  - 新增 `workflowPayloadRepairTemplate()`。
  - 在问题卡内直接展示：
    - `自动修复建议`
    - `建议值`
  - 已覆盖常见问题：
    - `MISSING_MODEL_NAME` → `9048 Название модели`
    - `MISSING_BRAND` → 品牌属性 85
    - `MISSING_PRICE` → 价格回填
    - `MISSING_CATEGORY` → 类目 / 类型重新匹配
    - `IMAGES_TOO_FEW` → 补足图片
    - `EMPTY_PAYLOAD` → 恢复 `payload.items`
    - `CHINESE_IN_TITLE` → 改为纯俄文标题

- `public/styles.css`
  - 新增 `.workflow-payload-repair` 样式。
  - 让修复建议块在问题卡内部独立显示。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowPayloadRepairTemplate`、`自动修复建议`、`建议值`、`9048`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `26/26` 通过。
- 全量验证：`npm test`
  - `127/127` 通过。

## 2026-06-12 P0-1：payload-draft-submit 安全提交闸口

更新时间：2026-06-12 +08:00

### 已完成

- 新增设计与实施计划：
  - `docs/superpowers/specs/2026-06-12-payload-draft-submit-design.md`
  - `docs/superpowers/plans/2026-06-12-payload-draft-submit.md`
- `src/workflowRuns.js`
  - 新增 `submitPayloadDraftToOzon(runId, input, deps)`。
  - 每次提交前重新校验 `payloadDraft`，无草稿/校验失败时不调用 Ozon。
  - 必须传入 `confirmSubmit: true`，否则返回 `confirmation_required`。
  - 真实提交只通过注入的 `ozonRequest(store, "/v3/product/import", { items })` 执行，便于测试隔离。
  - 提交成功后写入：
    - `preflight_check` 成功节点。
    - `ozon_submit` 成功节点。
    - `payload_draft_submitted` 工作流事件。
  - 提交成功后保持 `locks.submitLocked=true`，防止重复点击再次提交。
- `src/server.js`
  - 新增 `POST /api/workflows/:id/payload-draft/submit`。
  - 路由显式标准化 `confirmSubmit`，并注入 `getStore` / `ozonRequest`。
- `public/app.js`
  - 工作流 Payload 草稿区新增 `确认提交 Ozon`。
  - 点击后先浏览器二次确认，再保存当前编辑器草稿，最后调用 `/payload-draft/submit`。
  - 后端仍会重新校验，前端按钮不能绕过安全闸口。

### 新增测试

- `test/workflow-runs.test.js`
  - 无效草稿阻断且不调用 Ozon。
  - 有效草稿缺少人工确认时阻断。
  - 人工确认后的有效草稿会提交并记录 workflow 节点/事件。
- `test/server-routes.test.js`
  - 覆盖 `/api/workflows/:id/payload-draft/submit` 路由。
- `test/frontend-static.test.js`
  - 覆盖 `确认提交 Ozon`、`submit-payload-draft`、`confirmSubmit` 和 `/payload-draft/submit`。

### 验证结果

- 局部验证：
  - `node --test test\workflow-runs.test.js`：`26/26` 通过。
  - `node --test test\server-routes.test.js`：`4/4` 通过。
  - `node --test test\frontend-static.test.js`：`29/29` 通过。

### 下一步建议

1. 进入 `P0-2：review_reconcile 回执标准化`，把草稿提交后的 `task_id` 回查、`product_id`、错误/警告和 reasonCode 统一沉淀到 `review_reconcile`。
2. 给 `payload-draft-submit` 增加前端可见的“最近提交 task_id / offer 列表”小摘要，减少提交后翻事件日志。
3. 再做一次人工 UI 冒烟：打开工作流控制台，用测试 workflow 的草稿验证按钮、弹窗和阻断提示。

## 2026-06-12 轻量上架编辑日志与 Ozon Seller 表单监听

更新时间：2026-06-12 +08:00

### 背景

用户确认当前阶段不继续追求“一键全自动上架”，优先做流程化学习层：

`1688 候选 -> ERP 建议 -> 人工填写/修改 -> Ozon Seller 后台二次修改 -> Ozon 回执 -> 规则沉淀`

本轮先做最小可用底座，不重构现有主链。

### 已完成

- 新增 `src/listingEditJournal.js`
  - 数据文件：`data/listing-edit-journal.json`
  - 支持追加结构化编辑事件。
  - 支持按 `candidateId / offerId / productId / workflowRunId / stage / source` 查询。
  - 支持摘要：总数、按来源、按阶段、最常修改字段。
  - 支持 `diffListingFields(before, after)`，用于后续 ERP 作业单建议值/人工值 diff。
- 新增 API：
  - `GET /api/listing-edit-journal/events`
  - `POST /api/listing-edit-journal/events`
  - `GET /api/listing-edit-journal/summary`
- 浏览器统一插件新增 Ozon Seller 后台轻量监听：
  - 生效域名：`https://seller.ozon.ru/*`
  - 内容脚本函数：`mountOzonSellerEditMonitor()`
  - 页面加载后记录初始表单快照。
  - 监听 `input/change`，debounce 后生成字段差异。
  - 回传到 `/api/listing-edit-journal/events`。
  - 事件标记：
    - `stage = ozon_backend_edit`
    - `source = ozon_seller_plugin`
  - 只记录变化，不点击、不保存、不自动操作 Ozon 后台。
- 已同步两个插件目录：
  - `browser-extension/1688-collector`
  - `browser-extension/erp-collector-extension`
- 已重建插件包：
  - `browser-extension/erp-collector-extension.zip`

### 验证与运行状态

- 局部验证：
  - `node --test test\listing-edit-journal.test.js`
  - `node --test test\server-routes.test.js`
  - `node --test test\extension-unified.test.js`
- 本地 API 冒烟：
  - `POST /api/listing-edit-journal/events` 可写入。
  - `GET /api/listing-edit-journal/summary` 可读取摘要。
  - 冒烟测试产生的 `cc_smoke` 临时数据已删除。
- 采集插件状态：
  - 插件在线。
  - 当前 `1688-crawler/extension/status` 显示 `waiting_human`。
  - 原因：浏览器侧人机验证暂停。不能强行继续采集；需人工在浏览器里完成验证后点插件“恢复采集”。

### 下一步建议

1. 增加 ERP 内部“人工上架作业单 diff”：保存系统建议值、人工最终值，并写入 `listingEditJournal`。
2. 把 Ozon API 回执中的错误/警告也写入 `listingEditJournal`，来源标记为 `ozon_api_review`。
3. 等用户手动完成 Ozon/1688 人机验证后，恢复采集插件，跑少量候选采集，不直接触发自动提交。

### 当前运行状态

- 已重启后台。
- `src/server.js` 正常监听 `5178`。
- `src/dailyDistributor.js` 正常运行，但自动分发仍关闭。
- `/api/flow/status`：
  - `automation.distributorAutorun = false`
  - `automation.serverAutoHeal = false`
  - `automation.mode = observe_only`
  - 当前 `workflowRuns.total = 12`，`running = 11`，`waitingHuman = 0`

### 下一步开发方向

1. 增加一键复制节点摘要，方便发给人工/供应商排查。
2. 继续收敛链路结果与事件日志的重复信息。
3. 给自动修复建议增加可复制模板按钮。

## 2026-06-11 ERP 模块归属与 Ozon API 对齐

更新时间：2026-06-11 +08:00

### 已完成：模块地图与接口对照

- `public/index.html`
  - 总览页新增：
    - `ERP 模块归属地图`
    - `Ozon Seller API 对齐概览`

- `public/app.js`
  - 新增 `ERP_MODULE_OWNERSHIP`。
  - 新增 `OZON_SELLER_API_ALIGNMENT`。
  - 新增 `renderErpModuleOwnership()`。
  - 启动时直接渲染模块边界和 API 缺口。

- `public/styles.css`
  - 新增模块地图和 API 覆盖卡片样式。
  - 总览页更像“控制台首页”而不是纯表格堆叠。

- `docs/erp-tab-api-map.zh-CN.md`
  - 单独沉淀 tab 归属、Seller API 对齐现状和后续顺序。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `moduleOwnershipGrid`、`sellerApiCoverageGrid`、`ERP_MODULE_OWNERSHIP`、`OZON_SELLER_API_ALIGNMENT`、`.api-coverage-card`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `27/27` 通过。
- 全量验证：`npm test`
  - `128/128` 通过。

### 当前结论

- `学习与机会 / 1688反向选品 / 上架执行 / 商品状态 / 仓库与库存 / 工作流控制台 / 订单履约 / 营销活动` 的边界已经明确。
- Ozon Seller API 里已对齐的主要是：类目、属性、上架、审核回执、商品、价格、图片、库存、订单、活动。
- 仍明显偏本地逻辑的模块是：1688 采集、Ozon 学习、规则分析、工作流控制、AI 内容与利润判断。

## 2026-06-12 1688 官方 OpenAPI 接入状态

更新时间：2026-06-12 +08:00

### 当前结论

- 已订购 `代发解决方案（分销买家版）`，应用名 `ozonerp-分销`。
- 本机已配置 1688 OpenAPI 凭据，配置文件为 `data/1688-openapi.json`，该文件已加入 `.gitignore`，不得提交。
- 已新增官方 API 配置状态卡，ERP 前端只显示脱敏后的 AppSecret/token 状态。
- 已验证 1688 OpenAPI 网关和签名可用：
  - `system/currentTime` 返回成功。
- 已试探业务接口，但当前应用仍被 ACL 拒绝：
  - `alibaba.product.get`
  - `alibaba.agent.product.get`
  - `alibaba.trade.fastCreateOrder`
  - `alibaba.fenxiao.productInfo.get`
- 返回核心错误：`gw.APIACLDecline / AppKey is not allowed(acl)`。

### 暂缓原因

- 用户确认应用仍在审核中。
- 在审核通过或接口权限正式放行前，不继续投入业务接口适配，避免反复猜接口名浪费时间。

### 已落地文件

- `src/open1688Config.js`
  - 读取本机 1688 OpenAPI 配置。
  - 支持 Windows UTF-8 BOM JSON。
  - 只对外返回脱敏状态。
- `src/open1688Client.js`
  - 封装 `param2` 网关路径、HMAC-SHA1 签名和 HTTP 调用。
- `scripts/probe-1688-openapi.mjs`
  - 可重复运行官方 API 探针。
- `public/index.html`
  - `1688 官方接口` 状态面板。
- `public/app.js`
  - `loadOpen1688Status()` / `renderOpen1688Status()`。
- `public/styles.css`
  - `.open1688-status-*` 样式。
- `test/open1688-config.test.js`
  - 覆盖配置缺项、脱敏、BOM、签名稳定性。

### 后续恢复条件

1. 应用审核通过。
2. 用户提供开放平台“已授权 API / 接口权限列表”的截图或接口名。
3. 运行 `node scripts\probe-1688-openapi.mjs` 复测 ACL。
4. 若业务接口返回参数错误而非 ACL，则开始接入真实商品/分销接口。

### 2026-06-13 更新

- 用户提供新的生产 AppKey / AppSecret / accessToken，已更新到本机 `data/1688-openapi.json`。
- 已用真实 API 复测：
  - namespace：`com.alibaba.search`
  - apiName：`alibaba.search.relation.supply`
  - 返回：HTTP `200`
  - 结果：`{ pageNum: 1, pageSize: 20, result: [], totalRecords: 0 }`
- 结论：OpenAPI 网关、签名、授权 token 均已打通；当前接口返回空结果是业务数据为空，不是 ACL/授权失败。
- 下一步：把 `alibaba.search.relation.supply` 接入 ERP，作为官方 API 搜索/供应商推荐的第一条可用通道。

## 2026-06-12 1688 插件恢复采集修复

更新时间：2026-06-12 +08:00

### 问题

- 插件遇到 1688 人机验证后会暂停，并在浏览器扩展里显示“恢复采集”。
- 旧逻辑只清理浏览器扩展本地暂停状态，没有同步恢复 ERP 服务端 task。
- 服务端 `/api/1688-crawler/extension/next` 会跳过 `waiting_human` task，导致点击“恢复采集”后不一定继续领取原任务。
- 另外，服务端 resume 旧逻辑会触发后端直连 1688 的 `runTask()`，在插件队列模式下反而可能再次把任务打回 `waiting_human`。

### 修复

- `src/crawler1688.js`
  - 新增可恢复 job 判断。
  - task resume 时把人机/登录/验证类 failed job 重新置为 `queued`。
  - 若 task 已有插件队列 job，则不再启动服务端直连 1688 的 `runTask()`。
- `browser-extension/1688-collector/background.js`
  - 插件点击“恢复采集”时调用 `/api/1688-crawler/tasks/:id/resume`。
- `browser-extension/erp-collector-extension/background.js`
  - 同步上述恢复逻辑。
- `browser-extension/erp-collector-extension.zip`
  - 已重新打包。

### 当前现场

- 服务端已重启。
- 3 条 `waiting_human` task 已恢复为 `running`。
- 队列中有 `32` 个 `queued` job 等待插件领取。
- 插件 worker 仍离线，最后心跳停在 `2026-06-12T12:42:08Z`。
- 用户需要重新加载/更新浏览器扩展，并点击插件里的“恢复采集”。

### 验证

- `node --test test\crawler-workflow.test.js test\extension-unified.test.js`
  - `10/10` 通过。
- `node --test test\*.test.js`
  - `148/148` 通过。

## 2026-06-12 1688 海选队列提速

更新时间：2026-06-12 +08:00

### 问题

- 用户反馈插件和后台仍在少数几个品类/关键词上反复采集。
- 排查发现 queued job 里残留了大量旧详情页：
  - `自动喂食器` 12 个 queued job。
  - 多个旧关键词各 6 个详情页。
- 插件按队列顺序领取，导致看起来一直围着几个品深挖，不符合“一个关键词只找一两个合格链接，然后切下一个分类”的海选目标。

### 修复

- `src/crawler1688.js`
  - 默认 `CRAWLER1688_MAX_DETAIL_JOBS` 从 `6` 改为 `2`。
  - `claimCrawlerExtensionJob()` 认领时优先处理 `discover` 搜索页，再处理详情页，避免旧详情页阻塞新关键词搜索。
- `test/crawler-workflow.test.js`
  - 新增默认海选只打开 2 个详情页的测试。

### 一次性队列整理

- 已暂停旧队列中每个关键词超过 2 个的 queued 详情页。
- 结果：
  - queued job 从 `46` 降到 `18`。
  - 暂停多余详情页 `28` 个。
  - discover 搜索页保留，不影响新关键词展开。

### 验证

- `node --test test\crawler-workflow.test.js test\extension-unified.test.js`
  - `11/11` 通过。
- `node --test test\*.test.js`
  - `149/149` 通过。

## 2026-06-11 Ozon Seller API 缺口开发清单

更新时间：2026-06-11 +08:00

### 已完成：缺口优先级拆分

- `public/index.html`
  - 总览页新增 `Seller API 缺口开发清单`。

- `public/app.js`
  - 新增 `OZON_SELLER_API_GAP_BACKLOG`。
  - 把缺口按 `P0 / P1 / P2` 显示：
    - `P0`：上架安全闸口、审核回执闭环、库存安全回查。
    - `P1`：订单履约动作、商品资料维护、营销活动闭环。
    - `P2`：仓库分页与详情、报表与财务。
  - `renderErpModuleOwnership()` 同时渲染模块归属、API 对齐、API 缺口。

- `public/styles.css`
  - 新增 `.seller-api-gap-grid`、`.api-gap-card`、`.api-gap-p0/.api-gap-p1/.api-gap-p2`。
  - 用颜色区分开发优先级。

- `docs/ozon-seller-api-gap-backlog.zh-CN.md`
  - 新增完整 Seller API 缺口开发路线图。
  - 明确本地能力和 Seller API 能力边界。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `sellerApiGapGrid`、`OZON_SELLER_API_GAP_BACKLOG`、`payload-draft-submit`、`P0/P1/P2`。
  - 覆盖新文档 `docs/ozon-seller-api-gap-backlog.zh-CN.md`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `28/28` 通过。
- 全量验证：`npm test`
  - `129/129` 通过。

### 下一步建议

1. 进入 `P0-1：payload-draft-submit 安全提交闸口`。
2. 或继续做 `C：UI 前端展示修正`，把总览和工作流控制台整体视觉再收敛。

## 2026-06-11 工作流摘要一键复制

更新时间：2026-06-11 +08:00

### 已完成：工作流摘要复制

- `public/app.js`
  - 新增 `workflowRunCopySummaryText()`，可把当前工作流的：
    - 运行 ID
    - 状态和锁
    - 当前节点
    - 风险与下一步
    - Payload 问题
    - 节点进度
    - 最近事件
    汇总成可直接发送的纯文本。
  - 在详情页头部新增 `复制工作流摘要`。
  - 复用现有 `copyWorkflowText()`。

- `public/styles.css`
  - 新增 `.workflow-detail-head-actions`，让头部按钮与状态标签对齐。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `workflowRunCopySummaryText`、`复制工作流摘要`、`工作流摘要已复制`、`.workflow-detail-head-actions`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `26/26` 通过。
- 全量验证：`npm test`
  - `127/127` 通过。

## 2026-06-11 修复建议一键复制 + 链路结果收口

更新时间：2026-06-11 +08:00

### 已完成：修复建议复制按钮

- `public/app.js`
  - 新增 `copyWorkflowText()`，兼容 `navigator.clipboard` 与回退复制。
  - `workflowPayloadRepairTemplate()` 现在在建议卡内显示 `复制建议`。
  - `workflowPayloadIssueLocator()` 改成独立问题卡，支持：
    - `定位字段`
    - `复制建议`
  - `handleWorkflowAction()` 新增 `copy-repair-template` 分支。

- `public/styles.css`
  - 新增 `.workflow-payload-copy`、`.workflow-payload-issue-actions`、`.workflow-payload-repair-head`。
  - 问题卡改为分区布局，按钮更适合人工排查。

### 已完成：链路结果面板收口

- `public/app.js`
  - `workflowControlledChainResultPanel()` 现在优先展示摘要：
    - 步骤数
    - 真实执行数
    - 仅记录数
    - 末节点 / 末动作
  - 详细步骤收纳到 `查看步骤明细` 内，减少与事件日志重复。

- `public/styles.css`
  - 新增 `.workflow-chain-result-summary`。
  - 将步骤明细折叠成更轻量的详情区。

### 新增测试

- `test/frontend-static.test.js`
  - 覆盖 `复制建议`、`.workflow-payload-copy`、`查看步骤明细`、`.workflow-chain-result-summary`。

### 验证结果

- 局部验证：`node --test test\frontend-static.test.js`
  - `26/26` 通过。
- 全量验证：`npm test`
  - `127/127` 通过。

## 2026-06-16 C：ERP 前端展示修正（工作流设计导航）

更新时间：2026-06-16 22:19:02 +08:00

### 已完成：总览主链导航

- public/index.html
  - 总览页新增 ERP 主链导航 面板。
  - 新增 erpWorkflowNavigator 容器，用于把采集、分析、上架、审核回馈、库存闭环串成一条可点击路径。

- public/app.js
  - 新增 ERP_WORKFLOW_NAVIGATION。
  - 新增 enderErpWorkflowNavigator()，复用模块/API 对齐渲染，同时渲染主链导航。
  - 主链步骤点击后跳转到对应业务 tab：
    - 采集 → 1688反向选品
    - 分析 → 学习与机会
    - 上架 → 上架执行
    - 审核回馈 → 工作流控制台
    - 库存闭环 → 仓库与库存

### 已完成：工作流焦点条

- public/index.html
  - 工作流控制台新增 workflowFocusBar。

- public/app.js
  - 新增 enderWorkflowFocusBar()。
  - 工作流列表渲染时同步显示当前节点、运行状态、风险分和下一步建议。
  - 无运行记录时显示空状态说明，避免用户不知道页面是否加载失败。

- public/styles.css
  - 新增 .erp-workflow-navigator、.erp-workflow-step。
  - 新增 .workflow-focus-bar、.workflow-focus-step 和不同风险层级样式。
  - 总览和工作流控制台的信息层级更清晰，减少“功能散在不同 tab 不知道去哪处理”的问题。

### 新增测试

- 	est/frontend-static.test.js
  - 新增 rontend exposes ERP workflow design navigation。
  - 覆盖 erpWorkflowNavigator、workflowFocusBar、ERP_WORKFLOW_NAVIGATION、enderErpWorkflowNavigator()、enderWorkflowFocusBar() 和相关 CSS 类。

### 验证结果

- TDD 红灯：
ode --test test\frontend-static.test.js
  - 新测试按预期失败，缺少 erpWorkflowNavigator。
- 局部验证：
ode --test test\frontend-static.test.js
  - 32/32 通过。
- 全量验证：
pm test
  - 150/150 通过。
- 浏览器冒烟：http://127.0.0.1:5178/
  - erpWorkflowNavigator 存在。
  - workflowFocusBar 存在。
  - 主链步骤数量：5。
  - 阶段：采集、分析、上架、审核回馈、库存闭环。

### 下一步建议

1. 继续做 P0-2：review_reconcile 审核回执闭环增强，把 task_id 回查、错误字段、SKU 和下一步修复动作进一步汇总到工作流焦点条/详情页。
2. 或做 商品状态页维护面板，把改价、换图、资料修复入口统一收口，减少散落操作。
## 2026-06-18 外部 DataHunter 插件对比评估

评估目录：`C:\Users\Administrator\WorkBuddy\20260401160514\ozon-browser-plugin`

### DataHunter 相对现有 ERP 插件的优势

- 支持平台更广：除 Ozon、1688 外，还内置 Amazon、MercadoLibre 详情采集。
- 页面解析更重：1688 详情解析器、Ozon 增强解析器和网络请求拦截器覆盖字段更多。
- 支持 1688 列表页批量采集，并能后台打开多个详情页抓取。
- 内置自动发送/手动发送、采集历史和较完整的 popup 操作界面。

### 不能直接替换现有插件的原因

- DataHunter 固定连接 `localhost:8891`，当前 ERP 使用 `localhost:5178`，接口协议也不同。
- DataHunter 没有接入 ERP 的 crawler/learning 任务领取、节点回传、heartbeat 和 workflow_runs 状态。
- 自动发送默认开启，且网络拦截器自动启动，不符合当前项目“人机立即暂停、人工确认、禁止连续刷页”的安全要求。
- 权限包含 `<all_urls>`，权限面明显大于现有 ERP 插件。
- 页面解析逻辑大量堆在插件端，维护和测试成本高；当前插件把主要解析放在 ERP 后端，便于统一修复。

### 结论

- 不建议直接替换现有 `erp-collector-extension`。
- 建议把 DataHunter 当作“采集能力仓库”，优先移植：
  1. 1688 详情字段/颜色 SKU 解析规则。
  2. Ozon API 网络数据拦截解析。
  3. Amazon、MercadoLibre 采集适配器。
  4. 1688 列表批量候选提取，但必须接入现有任务队列、限速和人机暂停。
- 保留现有插件的工作流协议、人机暂停、heartbeat、Seller 编辑日志和安全控制。

## 2026-06-18 DataHunter 1688 详情解析能力第一批迁移

更新时间：2026-06-18 15:04:29 +08:00

### 本次迁移范围

- src/collector1688.js
  - 支持 DataHunter 常见的 specList/specItems 结构。
  - 支持对象型 skuMap，保留 map key 中的组合规格，如 颜色: 白色; 尺寸: S。
  - SKU map 同步读取价格、库存、SKU ID 和 SKU 图片。
  - 颜色/款式属性兜底支持逗号、中文逗号、分号、中文分号、斜杠、竖线和顿号。
  - 没有复制 DataHunter 的整套重型脚本，解析仍集中在 ERP 后端，保持可测试和可维护。

### 安全边界

- 未修改浏览器插件的自动开页逻辑。
- 未提高并发数或采集频率。
- 未修改人机验证暂停与恢复机制。
- 未修改 Ozon 提交和人工确认闸口。

### 新增测试

- 	est/collector1688-parser.test.js
  - 对象型 skuMap 组合规格。
  - specList/specItems 颜色规格。
  - 中文多分隔符颜色属性兜底。

### 验证结果

- 解析回归：3/3 通过。
- 扩展/采集局部测试：14/14 通过。
- Lint：33 files 通过。
- 全量测试：153/153 通过。

### 下一批可迁移能力

1. 1688 详情参数表的更多 DOM 结构兼容。
2. Ozon 前台网络接口数据拦截，但只做只读采集并接入现有任务队列。
3. 1688 SKU 图片与规格组合映射的更多异常结构。

## 2026-06-18 ERP 综合开发状态评估

更新时间：2026-06-18 20:25:19 +08:00

### 综合完成度

- 功能与架构完成度：约 82%。
- 采集 → 分析 → 上架主链：约 75%。
- 工作流控制台与人工干预：约 80%。
- Ozon Seller API 运营闭环：约 60%。
- 可长期无人值守的生产成熟度：约 55%。

### 已形成的能力

- 119 条本地 API 路由。
- 1688 插件采集、候选解析、SKU/颜色/参数解析、人机暂停与恢复。
- Ozon 竞品学习、机会分析、货源匹配、内容生成、类目属性、图片处理。
- Payload 草稿、preflight 校验、人工确认提交 Ozon。
- workflow_runs 节点、输入输出、诊断、重试、继续、受控链路、事件审计。
- Ozon 商品、价格、图片、仓库、库存、订单、促销基础接口。
- 总览主链导航、模块归属地图、API 对齐与缺口面板。

### 当前实时状态

- 服务端口 5178 在线。
- 自动化模式：observe_only；没有正在执行的自动上架 job。
- 工作流：190 条，其中 running 173、waiting_human 16、paused 1。
- 173 条 running 全部超过 3 天，属于陈旧状态而非真实运行。
- 工作流主要卡在：candidate_parse 125、ozon_learning 42、crawler_1688 22。
- 自动上架：needs_review 48。
- 库存队列：成功 10、失败 47；主要原因是标题和必填属性问题。
- 1688 插件 worker 离线，最后状态为 waiting_human。
- 1688 Open API 凭据已配置，但具体搜索/详情接口尚未真正接入。

### 关键未完成项

1. 工作流生命周期收口：识别陈旧 running，自动转为 waiting_human、failed、paused 或 archived。
2. review_reconcile 审核回执闭环：把 task_id、SKU、字段错误、警告和修复动作统一展示。
3. stock_sync 库存安全闭环：商品未就绪时避免重复写入，修正 47 条失败队列。
4. 商品状态页受控维护：把改价、换图、资料修复统一到商品页。
5. 订单履约动作：目前以读取为主，尚未补打包、发运、取消和标签。
6. 营销活动闭环：目前可读取和移除，加入活动和活动价策略未完成。
7. 1688 Open API 真实接口接入。

### 验证

- 
pm test：153/153 通过。
- 
pm run lint：33 files 通过。

### 推荐下一阶段

优先做“工作流状态治理 + review_reconcile”，先让控制台显示真实进程，再继续扩大自动化范围。

## 2026-06-18 工作流陈旧状态治理

更新时间：2026-06-18 20:32:35 +08:00

### 已完成

- src/workflowRuns.js
  - 新增 econcileStaleWorkflowRuns()。
  - 仅处理超过阈值仍为 unning 的工作流。
  - 转为 waiting_human，保留当前节点、输入、输出和历史事件。
  - 当前运行节点同步转为 waiting_human，增加风险说明和人工处理动作。
  - 追加 workflow_stale_reconciled 审计事件。

- src/server.js
  - 新增 POST /api/workflows/reconcile-stale。
  - 默认阈值 2 小时，允许传 	hresholdHours，限制在 1 至 720 小时。

- public/index.html、public/app.js
  - 工作流控制台新增“清理陈旧状态”按钮。
  - 点击前浏览器二次确认。
  - 只修改陈旧状态，不删除工作流，不自动重试，不提交 Ozon。

### 测试

- 新增陈旧运行、近期运行、暂停流程三类治理测试。
- 新增路由和前端按钮静态测试。
- 局部测试：66/66 通过。
- 全量测试：156/156 通过。
- Lint：33 files 通过。

### 运行验证

- ERP 服务已重启并监听 5178。
- 以 720 小时阈值调用接口，扫描 190 条、治理 0 条，确认接口可用且没有修改现有数据。
- 页面已确认包含 workflowReconcileStale 按钮。

### 使用方式

进入“工作流控制台”，点击“清理陈旧状态”。确认后，超过 2 小时未更新的 unning 流程会转入“等待人工”，之后可逐条重试、换货源或暂停。

### 下一步

增强 eview_reconcile：把 task_id、SKU、错误字段、警告和修复动作汇总到工作流详情和焦点条。

## 2026-06-18 陈旧工作流数据清理执行

更新时间：2026-06-18 20:34:34 +08:00

### 执行结果

- 清理前：190 条 workflow。
- 删除超过 2 小时仍为 unning 的陈旧记录：173 条。
- 清理后：17 条。
- 当前状态：
  - unning：0。
  - waiting_human：16。
  - paused：1。

### 删除记录原节点分布

- candidate_parse：110 条。
- ozon_learning：42 条。
- crawler_1688：21 条。

### 备份

- 已在删除前保存完整备份：
  - data/workflow-runs.json.bak_stale_purge_20260618_203402

### 验证

- workflow-runs.json 可正常解析，剩余 17 条。
- /api/workflows 返回 total=17、running=0、waitingHuman=16、paused=1。
- ERP 服务已重启，端口 5178 正常在线。

## 2026-06-18 外部 Ozon 竞品学习监控接入

更新时间：2026-06-18 20:50 +08:00

### 目标

- 只读监控另一个插件维护的 `E:\ozonerp\ozon_competitors.json`。
- 将可靠的 Ozon 商品详情增量合并到 ERP 学习库，用于标题、属性、类目和价格规则学习。
- 不触发 Ozon 上架，不控制外部插件，也不导入促销卡片和页面导航噪声。

### 已完成

- 新增 `src/externalOzonLearning.js`：
  - 默认每 60 秒检查一次源文件的修改时间和大小签名。
  - 文件未变化时不重复解析；文件正在写入或 JSON 不完整时仅记录运行错误，下轮自动重试，不影响 ERP 服务。
  - 只接受包含 `detail`、有效 Ozon 商品 URL、有效标题，且至少具有价格、图片、类目或属性之一的记录。
  - 从 URL 提取真实 Ozon 商品 ID，不信任外部记录中可能错误的短 SKU。
  - 清理促销标题、伪图片、导航/支付属性和采集器说明文字。
- `src/ozonLearning.js` 新增 `importExternalOzonLearningItems()`：
  - 按规范化 URL 去重。
  - 写入统一 `ozon-learning-items.json`，来源标记为 `external_ozonerp`，状态为 `detailed`。
  - 不覆盖其他来源中已经完整的详情记录。
- `src/listingRules.js`：
  - 规则分析器现同时支持历史数组属性和外部对象属性。
- `src/server.js`：
  - `GET /api/ozon-learning/external-source/status` 查看源文件、签名、同步和运行状态。
  - `POST /api/ozon-learning/external-source/sync` 手动同步；传 `{ "force": true }` 可强制重扫。
  - ERP 启动时自动开启只读增量监控。

### 真实数据结果

- 源文件：`E:\ozonerp\ozon_competitors.json`，7,874,864 字节。
- 扫描：11,875 条。
- 通过质量门槛：316 条。
- 拒绝噪声或不完整记录：11,559 条。
- 本轮更新：315 条；跳过：1 条；统一学习库总量：767 条。
- 同步后已自动重建 listing rules。
- 同步前已备份 `ozon-learning-items.json` 和 `listing-rules.json`，备份文件名包含 `bak_external_` 时间戳。

### 验证

- 新增外部数据清洗、增量签名、统一学习库去重、属性结构兼容和服务路由测试。
- 全量测试：162/162 通过。
- Lint：34 files 通过。
- ERP 服务已重启并监听 5178。
- 状态接口确认源文件存在，监控已启用，当前签名未变化。

### 后续建议

- 在 ERP 的 Ozon 学习页增加“外部学习源”可视化卡片，显示接受率、拒绝原因分布、最近同步时间和手动强制同步按钮。
- 将高频拒绝原因和规则样本暴露到工作流控制台，便于人工审阅哪些竞品信息真正影响了上架内容。

## 2026-06-19 Ozon 变体合并假成功修复

更新时间：2026-06-19

### 根因

- Ozon 对 `double_without_merger_offer` 返回 `level=warning`，但其业务含义是同一型号下的 SKU 没有成功合并。
- 旧代码把所有 warning 都当成非阻塞信息；只要回执存在 `product_id`，异步对账就把任务标记为 `live`。
- 旧自动重试还可能在多变体批次失败后只保留第一条 SKU 重试，破坏整组变体结构。

### 已完成

- `src/autoListing.js`
  - `splitImportWarningsAndErrors()` 新增 `listingDefects` 分类，将变体未合并警告从普通 warning 中分离。
  - 新增 `importFeedbackState()`，明确“已导入但分组失败”必须进入 `needs_review / listing_defect`。
  - 新增 `shouldAutoRetryImport()`，仅允许单 SKU 自动修复；多 SKU 批次不得降级为单品重试。
  - 提交阶段遇到分组缺陷时不生成条码、不排库存、不记录为成功提交。
  - 异步审核对账遇到分组缺陷时不再标记 `live`，统一原因码为 `VARIANT_GROUPING_FAILED`。
- `src/workflowRuns.js`
  - `review_reconcile` 节点支持 `listingDefects`。
  - 变体合并失败进入 `waiting_human` 和 `variant_grouping_fix` 分支，提示修正可变特征后整组重提。
- 新增规范文档 `docs/OZON_LISTING_VARIANTS.zh-CN.md`，固化 API 顺序、字段边界、变体不变量、审核判定和研究资料。

### 回归测试

- 普通 warning 仍保持非阻塞。
- `double_without_merger_offer` 被识别为上架业务缺陷。
- 已生成 `product_id` 的变体分组失败不会进入 `live`。
- 多变体批次不会自动折叠为单 SKU 重试。
- 工作流审核节点会阻断库存并要求整组修复。

### 下一步

- 在工作流控制台增加 `listing_defect` 专用卡片，逐 SKU 对比型号、颜色、尺寸和字典值。
- 增加“整组修复草稿”操作：仅生成可编辑 Payload，不自动提交，人工确认后整组重提。

## 2026-06-19 变体合并缺陷修复台

更新时间：2026-06-19

### 已完成

- `src/workflowRuns.js`
  - 新增 `buildVariantGroupingDiagnosis()`：按 Ozon 实时类目元数据提取型号属性和 `is_aspect` 属性，逐 SKU 生成可读值与组合签名，并标记重复组。
  - 新增 `buildVariantGroupingRepairDraft()`：只允许包含原批次全部 `offer_id` 的整组草稿；缺少任一 SKU 时返回 `INCOMPLETE_VARIANT_GROUP`。
  - `review_reconcile` 输出新增 `variantGroupingDiagnosis` 和 `variantGroupingRepairDraft`。
- `src/autoListing.js`
  - 首次提交回执将完整提交 Payload 和实时属性元数据传入审核节点。
  - `listingResult` 持久化 `attrsMeta`，供后续异步回查诊断使用。
  - 如果分组缺陷在异步审核回查时才出现，会同步更新对应工作流的 `review_reconcile` 节点。
- `public/app.js`、`public/styles.css`
  - 新增变体合并失败专用卡片，逐 SKU 展示型号、可变特征、重复组和唯一状态。
  - 新增“生成整组修复草稿”按钮。
  - 按钮只把完整批次写入 Payload 编辑器并保存草稿，不调用 Ozon 提交接口。
  - 后续仍必须执行 Payload 校验，并通过现有人工二次确认才能提交。

### 安全边界

- 不允许单 SKU 修复或降级重试多变体批次。
- 不完整的 SKU 集合不能生成修复草稿。
- 生成草稿不会自动提交 Ozon、不会生成条码、不会排库存。
- 草稿仍存在重复变体组合时，提交前总闸继续以 `DUPLICATE_VARIANT_ASPECTS` 阻断。

### 验证

- 后端诊断、完整批次草稿、缺失 SKU 阻断和审核节点输出测试通过。
- 前端专用卡、逐 SKU 表格和仅生成草稿动作测试通过。
- 全量测试：173/173 通过。
- Lint：34 files 通过。

### 操作方式

1. 打开“工作流控制台”。
2. 选择原因码为 `VARIANT_GROUPING_FAILED` 的 `review_reconcile` 节点。
3. 在红色“变体合并失败”卡片中检查重复 SKU 的型号、颜色、尺寸等特征。
4. 点击“生成整组修复草稿”。
5. 在 Payload 编辑器修正重复的可变特征，点击“校验 Payload”。
6. 只有校验通过后，人工二次确认才可整组提交 Ozon。

### 下一步

- 使用历史失败任务 `al_mq3g1i6scat2 / SKUlq00131` 重建工作流诊断卡，确认 5 个 SKU 的颜色文本与字典值显示正确。
- 在不自动提交的前提下生成整组修复草稿，人工检查后再决定是否进行真实 Ozon 回放。

## 2026-06-19 SKUlq00131 历史失败回放

更新时间：2026-06-19

### 回放范围

- 自动上架任务：`al_mq3g1i6scat2`。
- 父 SKU：`SKUlq00131`。
- Ozon 历史任务 ID：`4719643287`。
- 工作流：`wr_mql3mi8kvb6we`。
- 本次只读取本地历史数据、重建诊断和保存草稿，没有调用 Ozon Seller API，没有提交商品，没有写库存。

### 确认的历史根因

- 历史提交包含 5 个 SKU。
- 5 个 SKU 的型号字段 `9048` 都为 `Брелок`，符合合并要求。
- 5 个 SKU 的可变特征 `10097 Название цвета` 全部错误地写为 `белый`。
- Ozon 因此返回 `double_without_merger_offer`，但旧系统错误地将任务标记为 `live`。

### 生成的修复草稿

- 保留原有 5 个 `offer_id`，不创建新 SKU：
  - `SKUlq00131-variant-1`
  - `SKUlq00131-chernyy`
  - `SKUlq00131-belyy`
  - `SKUlq00131-zheltyy`
  - `SKUlq00131-siniy`
- 变体颜色已改为唯一组合：
  - 米色：`10097=бежевый`，`10096.dictionary_value_id=61573`。
  - 黑色：`10097=черный`，`10096.dictionary_value_id=61574`。
  - 白色：`10097=белый`，`10096.dictionary_value_id=61571`。
  - 黄色：`10097=желтый`，`10096.dictionary_value_id=61578`。
  - 蓝色：`10097=синий`，`10096.dictionary_value_id=61581`。
- 修复草稿包含 5 个 SKU，动态变体预检通过，问题数为 0。

### 工作流状态

- 历史任务已从错误的 `live` 修正为 `needs_review / listing_defect`。
- 原因码：`VARIANT_GROUPING_FAILED`。
- 工作流处于 `waiting_human`。
- 页面已实测显示红色“变体合并失败”卡片、5 行重复诊断和可用的“生成整组修复草稿”按钮。
- 页面 Payload 编辑器已显示修复后的五 SKU 颜色文本和字典值。

### 同步修复的安全缺口

- `savePayloadDraft()` 现在会持久化 `payloadDraftAttrsMeta`。
- 草稿再次保存后不会丢失 Ozon `is_aspect` 元数据。
- `validatePayloadDraft()` 和最终人工确认提交前总闸统一使用保存的类目元数据，可持续阻断重复变体组合。
- `workflowReviewReconcileNode()` 支持分别传入失败 Payload 与修复 Payload：诊断展示旧错误，草稿保存新值。

### 备份

- `data/auto-listing-jobs.json.bak_variant_replay_20260619154349`
- `data/workflow-runs.json.bak_variant_replay_20260619154349`
- `data/auto-listing-jobs.json.bak_variant_offer_fix_20260619154530`
- `data/workflow-runs.json.bak_variant_offer_fix_20260619154530`

### 验证

- 页面实测：诊断卡 5 行，5 行均显示历史重复组；修复按钮可用。
- 修复草稿：5 个原始 `offer_id`，5 组唯一颜色与字典值。
- 工作流提交事件 `payload_draft_submitted` 数量：0。
- 全量测试：175/175 通过。
- Lint：34 files 通过。

### 下一步

- 当前已经具备真实回放条件，但仍停在人工闸口。
- 下一步应由人工检查标题、图片、价格、尺重和五个变体映射；确认无误后再决定是否点击“确认提交 Ozon”。

## 2026-06-21 ERP 流程驾驶舱前端重构

更新时间：2026-06-21

### 已完成

- 将九个平级功能页重组为两级导航：
  - 驾驶舱：运营总览、工作流中心。
  - 商品全链路：Ozon 学习、1688 选品、上架执行。
  - 运营管理：商品状态、仓库与库存、订单履约、营销活动。
  - 系统状态：店铺与 Seller API 入口。
- 运营总览改为流程驾驶舱，统一显示风险横幅、四项关键指标、采集/分析/上架/审核回馈/库存闭环五阶段、当前工作流焦点和系统脉冲。
- 建立深色组件视觉系统，统一面板、指标卡、状态胶囊、按钮、输入框、表格、空状态和代码块，并保留危险提交操作的红色语义。
- 完成三档响应式布局：
  - `>=1440px`：72px 一级栏 + 220px 二级栏。
  - `1024px–1439px`：64px 一级栏 + 72px 紧凑二级栏。
  - `<1024px`：移动抽屉；支持按钮打开、选中页面后关闭、遮罩关闭和 Escape 关闭。

### 兼容与安全边界

- 未改动后端 API 合约、业务请求路径和 Ozon Seller API 调用逻辑。
- 保留原有页面 ID、业务控件 ID、`.tab[data-view]` 选择器和惰性加载逻辑。
- 未绕过 Payload 预检、工作流锁、人工二次确认或 Ozon 提交安全闸。
- 自动化仍遵守人机验证暂停规则；本轮没有执行真实 Ozon 提交、库存写入或外部副作用。

### 浏览器验收

- `1600×900`：完整一级栏、二级栏、风险横幅、四项 KPI、五阶段流程、工作流焦点和系统脉冲均可见，无页面横向溢出。
- `1366×768`：紧凑二级导航生效，主内容保持可读，无页面横向溢出。
- `1024×768`：临界紧凑布局正常，流程卡允许自然换行，无页面横向溢出。
- `900×768`：移动顶部栏和抽屉生效；抽屉可打开、切组、切页并自动关闭。
- 已逐页实测：运营总览、工作流中心、Ozon 学习、1688 选品、上架执行、商品状态、仓库与库存、订单履约、营销活动。
- 浏览器控制台错误：0。

### 自动验证

- `node --test test/frontend-static.test.js`：38/38 通过。
- `npm test`：179/179 通过。
- `npm run lint`：通过，34 files。

### 相关文件

- 设计规格：`docs/superpowers/specs/2026-06-21-erp-flow-cockpit-ui-design.md`。
- 实施计划：`docs/superpowers/plans/2026-06-21-erp-flow-cockpit-ui.md`。
- 前端实现：`public/index.html`、`public/app.js`、`public/styles.css`。
- 静态契约测试：`test/frontend-static.test.js`。

## 2026-06-26 定价/运费/原价/最低价逻辑沉淀

更新时间：2026-06-26

### 已完成

- 新增项目文档 `docs/pricing-logic.zh-CN.md`，用中文文字化说明当前 ERP 的定价口径。
- 新增 Codex skill `ozon-erp-pricing-logic`，用于后续解释、审查或修改 Ozon ERP 售价、运费、原价、最低价逻辑。
- 明确自动上架当前核心规则：
  - 采购成本：匹配货源价或 1688 SKU 价 + `5 RMB` 采购缓冲。
  - 售价：通过采购成本、运费等级、佣金、杂费、利润率迭代计算，币种 `CNY`。
  - 运费：按 Extra Small / Budget / Small / Big 四个人民币物流等级匹配。
  - 原价/划线价：`old_price = price * 2`。
  - 最低价：小数向下取整，整数减一，最低不低于 `1`，避免最低价等于售价。

### 当前实现锚点

- 物流等级与售价公式：`src/pricing.js`。
- 自动上架 payload 价格字段：`src/autoListing.js`。
- 前端价格计算器入口：`public/index.html`、`public/app.js`。
- 最低价测试保护：`test/listing-content-quality.test.js`。

### 验证

- Skill 结构校验：`quick_validate.py C:\Users\Administrator\.codex\skills\ozon-erp-pricing-logic`，结果 `Skill is valid!`。

### 后续建议

- 将 Ozon 类目真实佣金率接入定价计算，替代固定 `15%` 默认值。
- 将物流等级后台配置化，支持维护历史版本。
- 在工作流节点中输出完整价格诊断：采购价、缓冲、等级、运费、佣金、杂费、利润、原价、最低价。
- 对无尺重、无法匹配运费等级、价格不收敛、售价超等级范围的商品进入人工阻塞。

## 2026-06-27 工作流定价诊断接入

更新时间：2026-06-27

### 已完成

- 将自动上架定价结果结构化为 `pricingDiagnosis`，接入 `match_profit` 工作流节点。
- Payload 草稿刷新路径和真实自动上架流程都会写入定价诊断。
- 工作流节点输出现在包含：
  - 原始货源价、`5 RMB` 采购缓冲、计价采购成本。
  - 售价、原价/划线价、最低价、币种。
  - 运费等级、运费、佣金、杂费、成本基数、利润、利润率。
  - 计价尺重、价格迭代步骤。
  - 多变体 SKU 的独立售价、最低价、运费等级和尺重。
- 前端“工作流控制台”节点详情新增“定价诊断”卡片，直接展示成本拆解和变体价格明细。

### 安全边界

- 定价诊断只解释价格来源，不自动调用 Ozon 提交接口。
- 未绕过 Payload 预检、人工二次确认、工作流锁或提交流程总闸。
- 价格异常仍应进入人工检查；本次没有执行真实 Ozon 提交、库存写入或外部副作用。

### 相关文件

- 后端节点摘要：`src/workflowRuns.js`。
- 自动上架价格诊断生成：`src/autoListing.js`。
- 前端诊断卡：`public/app.js`、`public/styles.css`。
- 定价文档：`docs/pricing-logic.zh-CN.md`。
- 测试：`test/workflow-runs.test.js`、`test/frontend-static.test.js`。

### 验证

- 已先写失败测试，再实现功能。
- 目标测试：`node --test test/workflow-runs.test.js test/frontend-static.test.js`，74/74 通过。

## 2026-06-27 价格异常阻塞规则

更新时间：2026-06-27

### 已完成

- 在 `match_profit` 节点定价诊断基础上新增价格风险评估。
- 以下价格异常会把节点状态置为 `waiting_human`：
  - `PRICING_PACKAGE_MISSING`：缺少完整尺重，`blocked / high`。
  - `PRICING_SHIPPING_LEVEL_MISSING`：无法匹配运费等级，`blocked / high`。
  - `PRICING_NOT_CONVERGED`：价格迭代未收敛，`blocked / high`。
  - `PRICING_MIN_PRICE_INVALID`：最低价为空或不低于售价，`blocked / high`。
  - `PRICING_PROFIT_LOW`：利润过低或为负，`manual_review / medium`。
  - `PRICING_LOGISTICS_RATIO_HIGH`：运费占售价超过 35%，`manual_review / medium`。
- 前端“定价诊断”卡片新增价格风险标签，显示 `PRICING_*` reasonCode。

### 安全边界

- 价格风险只影响工作流状态和人工介入，不调用 Ozon 提交接口。
- 触发 `blocked` 或 `manual_review` 后，流程必须经过人工确认/修正后再继续。
- 未绕过 Payload 预检、人工二次确认、工作流锁或提交流程总闸。

### 相关文件

- 风险评估与节点状态：`src/workflowRuns.js`。
- 前端风险标签：`public/app.js`、`public/styles.css`。
- 文档规则：`docs/pricing-logic.zh-CN.md`。
- 测试：`test/workflow-runs.test.js`、`test/frontend-static.test.js`。

### 验证

- 已按 TDD 先写失败测试，再实现功能。
- 目标测试：`node --test test/workflow-runs.test.js`，37/37 通过。
- 前端契约：`node --test test/frontend-static.test.js`，39/39 通过。

## 2026-06-27 价格风险人工处理动作

更新时间：2026-06-27

### 已完成

- 工作流价格风险节点新增人工处理动作：
  - `重新生成价格`：调用 `/api/workflows/:id/nodes/:key/pricing-risk/recalculate`，节点置为 `retrying`，记录 `pricing_recalculation_requested`。
  - `接受价格风险`：调用 `/api/workflows/:id/nodes/:key/pricing-risk/accept`，只允许接受 `PRICING_PROFIT_LOW` 与 `PRICING_LOGISTICS_RATIO_HIGH`。
  - `转到 Payload 草稿`：前端定位到 Payload 编辑器，不改数据。
  - `标记换货源`：复用已有 `request-new-source` 安全动作。
- 后端强制拒绝直接接受 `blocked` 类价格风险，例如缺尺重、无运费等级、不收敛、最低价异常。
- 接受价格风险后流程可继续，但仍保留提交锁，后续必须经过 Payload 预检和人工确认。

### 安全边界

- 所有价格风险处理动作都不会调用 Ozon 提交接口。
- `blocked` 风险不能被“接受风险”跳过，只能修正后重算或换货源。
- `manual_review` 风险接受后仍不会绕过 Payload 预检、人工二次确认、工作流锁或提交总闸。

### 相关文件

- 后端动作函数：`src/workflowRuns.js`。
- API 路由：`src/server.js`。
- 前端按钮与调用：`public/app.js`、`public/styles.css`。
- 测试：`test/workflow-runs.test.js`、`test/server-routes.test.js`、`test/frontend-static.test.js`。

### 验证

- 已按 TDD 先写失败测试，再实现功能。
- 后端目标测试：`node --test test/workflow-runs.test.js`，39/39 通过。
- 接口/前端契约：`node --test test/server-routes.test.js test/frontend-static.test.js`，47/47 通过。

## 2026-06-27 佣金来源与 Ozon 分类字典本地化

更新时间：2026-06-27

### 已完成

- 定价计算结果新增 `commissionRate` 与 `commissionSource`，工作流定价诊断可明确显示佣金比例、来源和可信度。
- 自动上架 Payload 草稿路径和真实流程路径都会调用统一佣金来源解析：
  - 有 `ozonContext.commissions` 或任务佣金数据时，使用可解析比例，标记为 `learned_product / 同类已上架商品学习`。
  - 没有可学习佣金时，继续使用 `15%`，标记为 `manual_default / 手填/默认佣金率`。
  - 预留 `ozon_category` 来源，后续可接 Ozon 官方类目真实佣金/费率接口。
- Ozon 属性值字典新增本地持久化缓存：
  - 缓存 key：`description_category_id:type_id:attribute_id:language`。
  - 默认语言：`ZH_HANS`。
  - 落盘位置：`data/ozon-category-cache.json` 的 `attributeValues`。
- `/api/ozon/description-attribute-values` 现在支持先读本地缓存；传 `refresh: true` 时刷新 Ozon 并写回缓存。
- 前端工作流“定价诊断”卡显示佣金率、佣金来源和可信度。

### 安全边界

- 本次只改定价解释、缓存和诊断展示，不自动提交 Ozon。
- `learned_product` 只是同类已上架商品经验学习，不等同于 Ozon 官方实时类目佣金。
- 缺真实类目佣金时仍有明确兜底来源，不会把默认 `15%` 冒充真实值。
- 未绕过 Payload 预检、人工二次确认、工作流锁或提交总闸。

### 相关文件

- 定价结果元数据：`src/pricing.js`。
- 自动上架佣金来源解析：`src/autoListing.js`。
- Ozon 分类/属性值缓存：`src/ozonCategoryCache.js`。
- 属性值字典 API：`src/server.js`。
- 工作流前端展示：`public/app.js`。
- 文档：`docs/pricing-logic.zh-CN.md`、`docs/erp-tab-api-map.zh-CN.md`。
- 测试：`test/pricing-source.test.js`、`test/ozon-category-cache.test.js`、`test/auto-listing-payload-draft.test.js`。

### 验证

- 已按 TDD 先写失败测试，再实现功能。
- 目标测试：`node --test test\pricing-source.test.js test\ozon-category-cache.test.js test\auto-listing-payload-draft.test.js`，5/5 通过。

## 2026-06-27 Ozon 必填属性字典分析自动化

更新时间：2026-06-27

### 已完成

- 新增 Ozon 必填属性分析模块，可从本地分类缓存中提取每个 `description_category_id/type_id` 的必填属性。
- 新增填写策略归类：
  - `fixed_no_brand`：品牌默认无品牌。
  - `model_name_from_parent_sku`：型号名称由父 SKU/商品族名生成。
  - `fixed_country_china`：生产国/制造国默认中国。
  - `variant_aspect_from_sku`：颜色、尺码等变体特征从 1688 SKU 规格提取。
  - `dictionary_lookup_from_product_text`：材质、类型、用途等从商品文本匹配字典。
  - `dictionary_lookup_or_manual_rule`：需继续沉淀字典映射规则。
  - `package_data`：尺重字段来自 1688 详情解析。
  - `generated_content`：描述/关键词由俄文内容生成。
  - `manual_rule_needed`：暂缺可靠自动规则。
- 新增可恢复脚本：
  - `npm run analyze:ozon-required-attributes`
  - `npm run analyze:ozon-required-attributes -- --refresh-attributes --limit=50 --throttle-ms=350`
  - `npm run analyze:ozon-required-attributes -- --refresh-values --limit=50 --throttle-ms=350`
- 已生成本地分析产物：`data/ozon-required-attribute-analysis.json`。
- 已完成全局真实刷新：
  - 分类属性：7422/7422 个 type 已缓存。
  - 必填字典值：16797/16797 行已缓存。
  - 中途遇到 Ozon 脏 type、网络 `fetch failed` 和 Windows 覆盖写入问题，已修复脚本容错和缓存保存逻辑，并重试补齐。

### 当前分析快照

- 分类 type 总数：7422。
- 已缓存属性的 type：7422。
- 未缓存属性的 type：0。
- 必填属性行：27394。
- 唯一必填属性：62。
- 必填字典属性行：16797。
- 已缓存字典值行：16797。

当前策略分布：

```json
{
  "dictionary_lookup_from_product_text": 7551,
  "fixed_no_brand": 7418,
  "model_name_from_parent_sku": 7612,
  "dictionary_lookup_or_manual_rule": 788,
  "variant_aspect_from_sku": 1128,
  "manual_rule_needed": 2135,
  "package_data": 316,
  "fixed_country_china": 446
}
```

### 安全边界

- 该自动化只读取 Ozon 分类/属性/字典接口并写本地 JSON。
- 不创建商品、不提交 Payload、不改库存、不触发审核。
- 全量刷新已完成；后续再次刷新仍建议分批、限速、可恢复执行，避免 Ozon API 限流。
- 分析结果用于后续自动填写规则反哺，不代表所有属性已经可以无人工确认提交。

### 相关文件

- 分析模块：`src/ozonRequiredAttributeAnalysis.js`。
- 批量脚本：`scripts/analyze-ozon-required-attributes.mjs`。
- npm 命令：`package.json`。
- 分类/字典缓存：`data/ozon-category-cache.json`。
- 分析产物：`data/ozon-required-attribute-analysis.json`。
- 说明文档：`docs/ozon-required-attributes-analysis.zh-CN.md`。
- 测试：`test/ozon-required-attribute-analysis.test.js`。

### 后续建议

1. 把 `dictionary_lookup_from_product_text` 接入 Payload 预检/属性自动补齐节点。
2. 把 `fixed_country_china`、`fixed_no_brand`、`model_name_from_parent_sku` 写入统一必填属性补齐器。
3. 把 `manual_rule_needed` 高频属性整理成规则 backlog。
4. 在工作流中展示“当前类目必填属性覆盖率/缺失字段/自动填充策略”。

## 2026-06-27 Ozon 字典填写规则与技巧沉淀

更新时间：2026-06-27

### 已完成

- 检索并归纳 Ozon 官方 Seller API、Ozon Seller 教程、俄语卖家经验中关于商品属性、字典值、标题、合并商品卡和变体属性的规则。
- 结合本地全量字典分析，新增规则文档：`docs/ozon-dictionary-fill-rules.zh-CN.md`。
- 形成可接入自动化的策略分层：
  - 高置信自动填：品牌无品牌、型号名称父 SKU、原产国中国、颜色/尺码等 SKU 变体属性、尺重字段。
  - 中置信半自动匹配：类型、材质、用途、性别、尺码、容量、件数、适用对象。
  - 低置信/合规敏感阻塞：危险等级、保质期、储存条件、成分、制造商、温度范围、儿童/食品/化妆品/医疗/化学/电池/机动车配件相关字段。
- 明确关键边界：
  - 字典值必须来自当前 `description_category_id/type_id/attribute_id` 的合法字典，不能跨类目复用。
  - `型号名称` 用于商品卡合并，同父 SKU 应保持一致。
  - `is_aspect=true` 的变体属性必须在同组 SKU 中形成差异，否则会触发 Ozon 合并失败。
  - 标题、类型、品牌、模型、颜色必须共用同一套属性结果，不能各自独立生成。

### 后续建议

1. 新增 `requiredAttributeAutofill` 模块，把规则文档转成可执行代码。
2. 先接入高置信自动填字段：品牌、型号名称、原产国、颜色、尺重。
3. 再接入中置信字典匹配字段：类型、材质、用途、性别、尺码、容量。
4. 在工作流/Payload 预检里展示每个必填属性的填充来源、置信度和是否需要人工确认。
5. 把低置信与合规敏感字段自动放入人工规则池，不允许无确认提交。

### 相关文件

- 规则文档：`docs/ozon-dictionary-fill-rules.zh-CN.md`。
- 全量分析产物：`data/ozon-required-attribute-analysis.json`。
- 分类/字典缓存：`data/ozon-category-cache.json`。
