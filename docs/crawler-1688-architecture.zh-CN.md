# 1688 自动爬虫对接 ERP 开发架构（保留现有功能）

## 1. 目标与边界
- 保留现有 ERP 与 1688 插件功能，不替换、不回退。
- 新增左侧栏目 `1688 自动选品`，用于自动采集与二次筛选。
- 爬虫结果先进入“候选池”，人工筛选后再入“采集箱”。
- 采集箱后的上架链路继续复用现有自动化流程。

## 2. 核心设计原则
- 反爬与人机机制优先：不做验证码破解，不做高风险绕过。
- 使用已登录 1688 浏览器上下文和合法 cookie 登录态。
- 自动任务可暂停、可继续、可停止、可重试，必须可审计。
- 采集与上架解耦：采集模块不直接触发上架。

## 3. 总体架构
```text
1688 自动选品栏（前端）
    -> 爬虫任务 API
    -> 爬虫任务队列（后端）
    -> 浏览器自动化采集引擎（使用登录态）
    -> 详情解析与标准化（复用 collector1688）
    -> 候选池存储（crawler-candidates）
    -> 人工二次筛选
    -> 入采集箱（/api/1688/capture 或 collectionBox service）
    -> 复用现有上架自动化流程
```

## 4. 前端栏目设计（新增）
左侧导航新增：`1688 自动选品`

页面分区：
- `任务区`
  - 关键词/店铺链接/搜索页链接/类目链接
  - 采集上限、翻页上限、并发上限（默认 1）
  - 采集偏好：必须有 SKU、必须有尺重、价格区间
  - 控制：开始、暂停、继续、停止
- `候选池区`
  - 列：标题、链接、价格、SKU 数、图片数、尺重状态、供应商、风险、评分、状态
  - 操作：预览、忽略、重试、入采集箱
- `筛选区`
  - 条件：状态、价格区间、SKU 条件、尺重条件、关键词包含/排除、风险等级
  - 动作：批量勾选、批量忽略、批量入采集箱

## 5. 后端模块划分（新增）
建议新增目录：`src/crawler1688`

- `taskStore.js`
  - 任务增删改查、状态流转、断点恢复
- `candidateStore.js`
  - 候选池持久化、筛选查询、批量状态更新
- `crawlerQueue.js`
  - 任务调度、并发控制、限速、重试
- `browserSession.js`
  - 登录态加载（浏览器上下文 / cookie 注入）
- `searchCrawler.js`
  - 搜索页/店铺页翻页抓取商品链接
- `detailCrawler.js`
  - 打开商品详情页并采集原始 payload
- `antiBotGuard.js`
  - 人机验证识别、频率控制、异常降速、暂停策略
- `normalizer.js`
  - 标准化字段，复用 `collector1688` 的解析约定
- `bridgeToCollectionBox.js`
  - 候选池 -> 采集箱映射与入箱

## 6. 数据结构（建议）
新增文件：
- `data/1688-crawler-tasks.json`
- `data/1688-crawler-candidates.json`
- `data/1688-crawler-session.json`（加密存储 cookie）

任务对象（示意）：
```json
{
  "id": "ct_20260527_xxxx",
  "status": "running",
  "sourceType": "keyword",
  "sourceValue": "折叠运动水壶",
  "storeId": "store_xxx",
  "options": {
    "maxProducts": 100,
    "maxPages": 5,
    "mustHaveSku": true,
    "mustHaveSizeWeight": true,
    "priceMin": 0,
    "priceMax": 200
  },
  "progress": {
    "page": 2,
    "urlsDiscovered": 58,
    "productsParsed": 34,
    "candidatesSaved": 21
  },
  "lastError": "",
  "createdAt": "2026-05-27T00:00:00.000Z",
  "updatedAt": "2026-05-27T00:10:00.000Z"
}
```

候选对象（示意）：
```json
{
  "id": "cc_20260527_xxxx",
  "taskId": "ct_20260527_xxxx",
  "status": "pending_review",
  "title": "750ml可折叠硅胶运动水壶",
  "url": "https://detail.1688.com/offer/xxxx.html",
  "supplier": "xxx旗舰店",
  "priceMin": 12.5,
  "priceMax": 16.8,
  "skuCount": 6,
  "imageCount": 14,
  "sizeWeightReady": true,
  "riskLevel": "low",
  "score": 84,
  "parsed": {},
  "createdAt": "2026-05-27T00:00:00.000Z",
  "updatedAt": "2026-05-27T00:10:00.000Z"
}
```

## 7. API 设计（建议）
任务相关：
- `POST /api/1688-crawler/tasks`
- `GET /api/1688-crawler/tasks`
- `GET /api/1688-crawler/tasks/:id`
- `POST /api/1688-crawler/tasks/:id/pause`
- `POST /api/1688-crawler/tasks/:id/resume`
- `POST /api/1688-crawler/tasks/:id/stop`

候选池相关：
- `GET /api/1688-crawler/candidates`
- `PATCH /api/1688-crawler/candidates/:id`
- `POST /api/1688-crawler/candidates/:id/retry`
- `POST /api/1688-crawler/candidates/:id/to-capture`
- `POST /api/1688-crawler/candidates/batch-to-capture`

登录态相关：
- `POST /api/1688-crawler/session/cookie`（导入 cookie）
- `GET /api/1688-crawler/session/status`
- `DELETE /api/1688-crawler/session/cookie`

## 8. 反爬与人机机制策略
- 默认并发 `1`，每次请求和操作间隔随机 `3~12s`。
- 每采集 `N` 个商品强制休眠 `60~180s`。
- 页面行为模拟：滚动、停顿、展开 SKU、等待图片加载完成。
- 识别这些信号并暂停任务：
  - 出现验证码/滑块/人机验证元素
  - 跳转登录页
  - HTTP 403/412/429 高频返回
  - 页面关键数据长时间为空
- 暂停后状态置为 `waiting_human`，人工处理后点击继续。

## 9. 与现有系统的对接点
- 详情标准化字段必须兼容现有 `collector1688` 输出结构。
- 入箱统一走 `collectionBox` 逻辑，保持去重规则一致。
- 不直接改动现有 `submitListing` 自动上架路径。
- 候选入箱时，保留来源标记：`source = crawler1688`。

## 10. 状态机设计
任务状态：
- `queued -> running -> paused -> running -> finished`
- `running -> waiting_human -> running`
- `running -> failed`
- `running/paused -> stopped`

候选状态：
- `pending_review`
- `ignored`
- `accepted_to_capture`
- `capture_failed`
- `captured`

## 11. MVP 里程碑
M1（可运行）：
- 新增栏目与任务创建
- 搜索页翻页提取商品 URL
- 详情页采集并写入候选池
- 候选池筛选与单条入采集箱

M2（可用）：
- 批量入采集箱
- 风险检测与 `waiting_human` 流程
- 任务恢复与断点续跑

M3（稳定）：
- 评分模型与优先级抓取
- 更完整的异常重试与限速策略
- 候选池统计报表

## 12. 风险与合规说明
- 严禁验证码破解、账号撞库、暴力请求。
- cookie 本地加密存储，不回传到前端页面明文展示。
- 所有任务写审计日志，支持追溯“何时、由谁、抓了什么”。
- 出现平台风控信号时自动降速或暂停，保护账号安全。

## 13. 与当前代码库的落地点（建议顺序）
1. 先加后端基础文件与 API 空壳（不接任务执行）。
2. 前端增加栏目与任务/候选 UI（可先 mock 数据）。
3. 接入真实爬虫执行器，先支持关键词->搜索页->详情页。
4. 打通候选池入采集箱。
5. 完成反爬暂停机制和断点恢复。

