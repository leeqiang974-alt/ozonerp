# ERP 工作流控制台设计

更新时间：2026-06-08

## 目标

把现有 `1688 采集 → Ozon 学习 → 匹配分析 → 内容生成 → Ozon 上架 → 审核回执 → 库存写入` 从黑盒自动化改造成可观察、可暂停、可人工干预、可定点重试的标准工作流。

第一版重点不是做复杂拖拽编排，而是建立统一工作流记录和人工可干预控制台，让操作者能明确知道：

- 当前卡在哪个节点。
- 节点输入是什么。
- 节点输出是什么。
- Ozon/1688 原始错误是什么。
- 系统诊断出的中文原因是什么。
- 可以执行哪些修复或重试动作。

## 设计原则

1. **每个关节点显式化**：每个节点都有独立状态、输入、输出、错误和诊断。
2. **自动化可暂停**：遇到人机验证、Ozon 必填字段、类目疑似错误时进入 `waiting_human`，不继续刷任务。
3. **人工确认提交**：人工编辑 payload 后必须先校验、保存草稿，再确认提交；禁止自动连点提交。
4. **失败可定位**：错误必须能映射到节点、字段、SKU、offer_id、product_id、task_id。
5. **重试可控**：支持从失败节点重试、从指定节点继续、自动修复后重试，但每次只产生一个 Ozon task。
6. **兼容现有系统**：第一版复用现有 `auto-listing-jobs.json`、`1688-crawler-*`、`stock-queue.json`，新增 `workflow-runs.json` 做统一观察层。

## 工作流节点

第一版固定 10 个节点：

| 节点 key | 名称 | 主要来源 | 成功产出 | 常见失败 |
| --- | --- | --- | --- | --- |
| `ozon_learning` | Ozon 采集学习 | `ozonLearning.js` | Ozon 机会商品、价格、类目上下文 | 人机验证、页面结构变化、采集为空 |
| `keyword_expand` | 关键词扩展 | `pipeline.js` / `crawler1688.js` | 1688 搜索关键词 | AI 超时、关键词泛化 |
| `crawler_1688` | 1688 采集 | `crawler1688.js` / 插件 | 搜索任务、详情任务、候选商品 | 1688 人机、cookie 失效、详情解析失败 |
| `candidate_parse` | 候选解析 | `collector1688.js` | 图片、价格、SKU、尺重、属性 | 图片为空、尺重为空、SKU 异常 |
| `match_profit` | 匹配与利润 | `crawler1688.js` / `autoListing.js` | 匹配分、利润测算、候选选择 | 不同款、利润不达标、候选重复 |
| `content_generate` | 内容生成 | `autoListing.js` / AI | 俄文标题、描述、属性提示 | 中文残留、标题类型不符、描述质量差 |
| `preflight_check` | 上架前预检 | 新增校验层 | 可提交 payload 草稿、风险列表 | 类目疑似错误、必填属性缺失、变体特征重复 |
| `ozon_submit` | Ozon 提交 | `completeListing()` | task_id、skuOffers、submitPayload | Ozon 属性必填、类目不匹配、重复卡 |
| `review_reconcile` | 审核回执 | `reconcileSubmittedJobs()` | product_id、审核状态、reasonCode | 审核拒绝、字段错误、图片/类型不匹配 |
| `stock_sync` | 库存写入 | `stockQueue.js` | 库存成功、仓库 ID | 商品未就绪、仓库不可用、属性未过审 |

## 数据结构

新增文件：

`data/workflow-runs.json`

顶层结构：

```json
{
  "items": []
}
```

单个 workflow run：

```json
{
  "id": "wr_mq4pmfhq",
  "source": "auto_listing",
  "status": "waiting_human",
  "currentNode": "preflight_check",
  "title": "宠物喂食饮水二合一",
  "createdAt": "2026-06-08T04:20:00.000Z",
  "updatedAt": "2026-06-08T04:28:00.000Z",
  "entity": {
    "ozonOpportunityId": "opp_mq4sample",
    "crawlerTaskId": "ct_mq4sample",
    "candidateId": "cc_mq4sample",
    "autoListingJobId": "al_mq4sample",
    "stockQueueId": "sq_mq4sample",
    "parentSku": "SKUlq00136",
    "taskId": 4728558469,
    "productIds": [4971852162],
    "storeId": "3815760-4"
  },
  "nodes": [],
  "events": [],
  "locks": {
    "paused": false,
    "waitingHuman": true,
    "submitLocked": false
  }
}
```

节点结构：

```json
{
  "key": "preflight_check",
  "name": "上架前预检",
  "status": "failed",
  "startedAt": "2026-06-08T04:27:00.000Z",
  "finishedAt": "2026-06-08T04:27:03.000Z",
  "input": {},
  "output": {},
  "error": {
    "raw": "Это обязательное поле...",
    "source": "ozon",
    "field": "Название модели (для объединения в одну карточку)",
    "attributeId": 9048,
    "offerId": "SKUlq00136-seryy"
  },
  "diagnosis": {
    "reasonCode": "ATTRIBUTE_REQUIRED",
    "messageZh": "缺少 Ozon 必填属性：Название модели，用于合并到同一张卡片。",
    "severity": "blocking",
    "fixHints": [
      "补充属性 9048：模型名称",
      "确认 retry_model 不会删除其它必填属性",
      "重新校验 payload 后提交"
    ]
  },
  "actions": [
    "view_input",
    "view_output",
    "edit_payload",
    "validate_payload",
    "auto_fix",
    "retry_node",
    "continue_from_here"
  ]
}
```

事件结构：

```json
{
  "time": "2026-06-08T04:28:33.000Z",
  "node": "ozon_submit",
  "type": "task_submitted",
  "message": "已提交 Ozon task 4728558469",
  "data": {
    "taskId": 4728558469,
    "parentSku": "SKUlq00136"
  }
}
```

## 状态枚举

Workflow 状态：

- `draft`：已创建，尚未开始。
- `running`：正在执行。
- `paused`：人工暂停。
- `waiting_human`：等待人工处理。
- `failed`：失败且无法自动继续。
- `live`：商品已上线且库存成功。
- `completed`：流程完成，但不一定在售。
- `cancelled`：人工取消。

节点状态：

- `pending`
- `running`
- `success`
- `failed`
- `skipped`
- `waiting_human`
- `retrying`

## API 设计

新增工作流 API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/workflows` | 查询工作流列表 |
| `GET` | `/api/workflows/:id` | 查询单个工作流详情 |
| `POST` | `/api/workflows` | 创建工作流 |
| `POST` | `/api/workflows/:id/pause` | 暂停工作流 |
| `POST` | `/api/workflows/:id/resume` | 恢复工作流 |
| `POST` | `/api/workflows/:id/nodes/:key/retry` | 重试指定节点 |
| `POST` | `/api/workflows/:id/nodes/:key/continue` | 从指定节点继续 |
| `POST` | `/api/workflows/:id/nodes/:key/auto-fix` | 执行自动修复 |
| `GET` | `/api/workflows/:id/payload` | 查看当前 submit payload |
| `PUT` | `/api/workflows/:id/payload-draft` | 保存人工编辑 payload 草稿 |
| `POST` | `/api/workflows/:id/payload-draft/validate` | 校验 payload 草稿 |
| `POST` | `/api/workflows/:id/payload-draft/submit` | 人工确认提交 payload |

## 前端控制台

新增页面：`工作流控制台`

### 左侧：工作流列表

显示字段：

- 标题
- 当前节点
- 总状态
- SKU
- task_id
- reasonCode
- 更新时间

筛选：

- 全部
- 运行中
- 等人工
- 失败
- 已上线
- 今日创建

### 中间：节点时间线

以流程图或纵向时间线展示 10 个节点。

每个节点显示：

- 节点名
- 状态颜色
- 耗时
- 错误摘要
- 是否可重试

### 右侧：节点详情

Tabs：

1. `诊断`
2. `输入`
3. `输出`
4. `错误原文`
5. `Payload`
6. `操作记录`

关键按钮：

- `暂停工作流`
- `恢复工作流`
- `重试本节点`
- `从这里继续`
- `自动修复`
- `编辑 payload`
- `校验 payload`
- `人工确认提交`

## Payload 编辑保护

允许人工编辑 `submitPayload`，但必须经过保护流程：

1. 打开 payload 编辑器。
2. 保存为 `payloadDraft`，不直接覆盖原 payload。
3. 点击 `校验 payload`。
4. 校验通过后才显示 `人工确认提交`。
5. 提交前弹出二次确认，显示：
   - 店铺
   - parentSku
   - offer_id 数量
   - 类目
   - 价格
   - 图片数量
   - 风险项

禁止行为：

- 禁止未校验直接提交。
- 禁止连续自动提交多个 Ozon task。
- 禁止缺 `offer_id`、图片、价格、类目、type_id 时提交。
- 禁止存在重复 `offer_id` 时提交。

## 预检规则

第一版内置以下检查：

1. **基础字段**
   - `offer_id`
   - `name`
   - `description_category_id`
   - `type_id`
   - `price`
   - `images`
   - `attributes`

2. **Ozon 必填属性**
   - `85`：品牌。
   - `9048`：`Название модели (для объединения в одну карточку)`。
   - `4958`：`Предназначено для`，宠物类目常见必填。
   - 其它必填属性从 Ozon 类目属性接口动态读取。

3. **变体合并**
   - 多 offer 时 `offer_id` 不得重复。
   - `is_aspect` 属性必须至少一个不同。
   - 颜色名称 `10097` 不得全部相同。

4. **中文残留**
   - 标题不得含中文。
   - 描述、富文本、属性可先提示风险，不阻塞。

5. **类目风险**
   - 宠物强意图不得提交到纪念品/礼品类。
   - 钥匙扣强意图不得提交到汽车礼品套装/成人纪念品。
   - 饮水机强意图优先宠物饮水器。

6. **图片**
   - 至少 3 张可下载图片。
   - OCR 未处理时显示提示，但第一版不强制阻塞。

7. **尺重**
   - 重量、长宽高必须大于 0。
   - 超大或明显异常时提示。

## 错误诊断映射

第一版诊断规则从 `reasonCode` 和 Ozon 原始错误生成：

| reasonCode | 节点 | 中文诊断 | 推荐动作 |
| --- | --- | --- | --- |
| `ATTRIBUTE_REQUIRED` | `preflight_check` / `ozon_submit` / `review_reconcile` | 缺少必填属性 | 自动补属性、编辑 payload、重试 |
| `CATEGORY_INVALID` | `preflight_check` / `review_reconcile` | 类目或类型不匹配 | 切换候选类目、重新拉属性、重试 |
| `TITLE_INVALID` | `content_generate` / `ozon_submit` | 标题不符合类型或含非法内容 | 清洗标题、重试 |
| `DUPLICATE_LISTING` | `preflight_check` / `review_reconcile` | Ozon 判定重复卡 | 人工清理旧卡或换候选 |
| `WEIGHT_SIZE_INVALID` | `candidate_parse` / `preflight_check` | 尺重错误 | 使用安全尺重、重试 |
| `STOCK_FAILED` | `stock_sync` | 库存写入失败 | 等商品就绪、重试库存 |
| `WAITING_HUMAN` | `ozon_learning` / `crawler_1688` | 平台人机验证 | 暂停并等待人工验证 |

## 与现有模块的对接

### `crawler1688.js`

- 创建/更新 `crawler_1688`、`candidate_parse` 节点。
- 遇到 `waiting_human` 时同步 workflow 状态。
- 保存采集 job id、task id、candidate id。

### `pipeline.js`

- 创建/更新 `keyword_expand`、`match_profit` 节点。
- 记录关键词扩展结果和候选匹配结果。

### `autoListing.js`

- 创建/更新 `content_generate`、`preflight_check`、`ozon_submit`、`review_reconcile` 节点。
- `completeListing()` 提交前保存 payload 草稿。
- Ozon 回执写入 `review_reconcile` 节点。

### `stockQueue.js`

- 创建/更新 `stock_sync` 节点。
- 记录仓库、offer_id、库存数量、失败原因。

### `flowSupervisor.js`

- 作为总调度器读取 workflow 状态。
- 只对允许自动继续的节点继续推进。
- `waiting_human`、`paused`、`failed` 不自动推进。

## 最小实现步骤

1. 新增 `src/workflowRuns.js`
   - 读写 `data/workflow-runs.json`
   - 创建 run
   - upsert node
   - append event
   - 诊断错误

2. 新增工作流 API
   - 列表、详情、暂停、恢复、节点重试。
   - payload 草稿查看、保存、校验、提交。

3. 接入 `autoListing.js`
   - 先覆盖 `preflight_check`、`ozon_submit`、`review_reconcile`、`stock_sync`。
   - 第一阶段不用把所有历史流程一次性接完。

4. 新增前端页面
   - 工作流列表。
   - 节点时间线。
   - 节点详情。
   - payload 编辑器。

5. 接入 1688/Ozon 学习
   - 把 `crawler1688.js` 和 `ozonLearning.js` 的状态写入 workflow。

## 第一版验收标准

1. 跑一轮受控自动上架时，能在控制台看到每个节点的状态。
2. Ozon 报缺 `9048` 或 `4958` 时，控制台能显示中文诊断和字段 ID。
3. `preflight_check` 能阻止明显坏 payload。
4. 人工编辑 payload 后必须校验才能提交。
5. 任一节点失败后，工作流停在 `waiting_human` 或 `failed`，不会自动继续刷任务。
6. 成功上架后，workflow 状态变为 `live`，记录 SKU、task_id、product_id、库存结果。

## 非目标

第一版不做：

- 拖拽式流程编排。
- 多商品批量无确认提交。
- 自动清理 Ozon 后台旧卡。
- 完整替换现有 `auto-listing-jobs.json`。
- 实时 WebSocket 推送；可以先用轮询。
