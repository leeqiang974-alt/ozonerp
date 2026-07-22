# Ozon ERP 自动化交叉开发设计

## 目标

在不替换本机 Ozon ERP 架构、不削弱安全闸口的前提下，吸收 `Linuxpizi/auto-ozon` 与 `kennard520/ozon-helper` 的成熟做法，逐步把本机 ERP 推向“尽量自动化”：自动采集、自动生成草稿、自动诊断、自动给出修复建议，最终只让低风险、规则稳定的动作进入人工一键确认或白名单自动执行。

## 外部项目取优点

### `kennard520/ozon-helper`

- 1688/Ozon/WB 插件解析器有纯函数和测试，可参考其 `parse-1688.js`、`product-parse.js`、`collect-flow.js` 的做法。
- 上架工作台有草稿 tabs、图片池、变体组、pipeline、发布前预览，适合参考交互结构。
- `ozon_api` 客户端覆盖仓库、配送方式、商品导入、导入状态、复制卡等接口，可作为本机 API 对照清单。
- realFBS 运费路线和佣金类目表支持导入导出，适合演进本机定价资料维护。
- 数据层、用户、钱包、任务仓储工程化程度高，但不作为当前主线第一阶段。

### `Linuxpizi/auto-ozon`

- 店铺、订单、财务、商品、定时任务模块完整，适合参考 Seller 日常运营模块。
- FastAPI/Vue 页面展示可参考，但不直接迁移框架。
- 上架提交安全闸口弱于本机 ERP，只能参考 API 行为和 UI，不吸收其直接提交路径。

## 本机主线保留边界

- Ozon 提交不能绕过 Payload 预检、workflow lock 和人工确认。
- `waiting_human`、paused、browser human verification 必须阻断自动链路。
- GPT/Image 成本动作必须用户确认。
- 价格 blocked 风险不能被接受为安全，必须修复或换源。
- 外部项目中的“直接 publish / status=processed / 跳过缺必填属性继续发”不能进入本机主线。

## 自动化分级

1. **L1 自动采集**：自动采集 1688/Ozon/PDD/WB 商品候选，输出标准化标题、图片、详情图、SKU、属性、尺重和 `parseIssues`。
2. **L2 自动生成草稿**：自动生成 Ozon 草稿、来源变体上下文、详情图/rich content 候选、价格诊断。
3. **L3 自动诊断修复建议**：预检自动定位类目属性、变体、图片、尺重、价格、库存和审核回馈卡点。
4. **L4 人工一键确认**：低风险修复可由系统给出候选，用户一键确认写本地草稿并重新预检。
5. **L5 白名单自动执行**：仅对规则稳定、类目可信、无价格/属性/媒体/库存风险的动作启用；blocked 风险永远不能自动跳过。

## 第一阶段落地范围

第一阶段优先做采集自动化增强，因为它能直接提升后续变体、属性、图片、rich content、尺重和定价自动化质量。

已落地的首个切口：

- `src/collector1688.js` 从 1688 详情 HTML/JSON 中提取 `detailImages`。
- 采集结果生成 `richContentJson`，每张详情图对应一个 Ozon `raShowcase` block。
- 图片 URL 去除 query/hash 噪音，详情图去重更稳定。
- 输出机器可读 `parseIssues`，便于后续 workflow 自动定位缺标题、缺图、缺 SKU、缺属性、缺尺重。

下一步建议：

- 扩展 `crawler1688` 和前端采集页，展示 `parseIssues` 与详情图/rich content 就绪状态。
- 把详情图/rich content 候选接入上架草稿质量检查，但仍不自动提交 Ozon。
- 对照 `ozon-helper` 的 1688 SKU/包装解析测试样例，补更多 fixture 测试。
- 设计 API 对照清单，逐项补齐仓库配送方式、导入状态、商品详情、佣金/运费表维护。

## 验证

- 新增 `test/collector1688-parser.test.js` 用例覆盖详情图、rich content 和 `parseIssues`。
- 已运行 `node --test test/collector1688-parser.test.js`，5/5 通过。
