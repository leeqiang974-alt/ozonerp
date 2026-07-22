# 1688 → Ozon 黄金链路真实回放执行包

本文件把 Phase 1 的“至少 10 次受控真实回放”变成可执行记录模板。它不是授权书，也不允许绕过人工确认、Seller API 预检或写后回读。

## 从 R01 开始记录（离线）

原来的表格只能手填，容易把“准备开始”误读成真实证据。先用记录命令建立一个明确仍未开始的 R01：

```powershell
npm.cmd run golden-path-record -- --replay-id R01 --shape single_sku `
  --url https://detail.1688.com/offer/<商品ID>.html `
  --out .\data\golden-path\R01.json
```

命令只写本地计划记录，不打开 URL、不调用 1688/Ozon、不创建草稿、不产生真实回执。输出固定为
`evidenceType=real_replay_plan`、`verificationLevel=configuration_declared`、`status=not_started`，并列出来源快照、店铺范围、Ozon 只读、草稿和预检阻塞。出现验证码、登录失效或页面风控时，不要把 URL 或本地记录当作快照证据，按 `waiting_human` 停止并补充受控采集回执。

已有脱敏 `manifest.json + page.html` 后，仍使用下面的 fixture/capture replay 命令做离线核对；它们不会把本地结果升级为真实账号验证：

```powershell
npm.cmd run replay-1688-capture -- .\my-capture
npm.cmd run golden-path-replay -- complete-single
```

## 先做离线基线

```powershell
npm.cmd run golden-path-batch
npm.cmd run offline-acceptance
```

当前仓库的 6 个 fixture 都会保持 `preflightBlocked`；这是安全预期，不是失败的真实账号证据。典型阻塞包括：

- `CONTENT_FACT_REVIEW_REQUIRED`：俄文事实未人工确认；
- `SOURCE_IMAGES_TOO_FEW` / `IMAGES_TOO_FEW`：媒体范围不足；
- `PRICING_COMMISSION_SOURCE_MISSING`：当前店铺/类目佣金未读；
- `SOURCE_SIZE_WEIGHT_MISSING`：包装尺重未绑定当前来源快照；
- `NO_VARIANT_ASPECT_METADATA`：多 SKU 变体属性未绑定当前类目证据。

## 每次真实回放的固定顺序

1. **选定一个受控商品**：记录 `replayId`、1688 URL、是否单 SKU/多 SKU、脱敏 source snapshot hash；验证码、登录失效或页面风控立即进入 `waiting_human`。
2. **确认来源快照**：人工确认当前页面快照、供应商、SKU 矩阵、采购阶梯价、图片和尺重；快照 hash 变化后必须重新确认。
3. **读取 Ozon 事实**：同一 signed session、环境和店铺范围读取类目/type/必填属性/合法字典值；保存端点、请求范围、时间和脱敏响应 hash。
4. **生成本地草稿**：绑定 `storeId`、source snapshot、每个 `sourceSkuId → offer_id`，不得按数组位置猜绑；俄文内容、媒体、尺重和价格证据分别标状态。
5. **运行 preflight**：记录每个 blocker 的业务字段/SKU、卖家下一步和副作用；只要有 blocker，不得提交。
6. **人工确认提交**：确认当前草稿 hash、店铺、SKU 数量、价格和副作用后，才允许一次提交；提交结果缺 `task_id` 或超时都进入 `needs_review`，禁止自动重试。
7. **审核回读**：用相同 workflow/task/store 绑定回读 `product/import/info`，记录 `task_id`、`product_id`、每个 SKU 的错误/警告和最终审核状态。
8. **库存就绪**：审核明确可售后，读取商品状态、仓库分页和精确 `(offer_id, warehouse_id)` tuple；写入若获授权，必须保存写前 diff、幂等键、写后回查和不一致结果。

## 10 次回放记录表

| replayId | 商品形态 | 来源/类目/属性 | 草稿 hash | 提交结果 | 审核回读 | 库存回查 | 验证等级 | 备注 |
|---|---|---|---|---|---|---|---|---|
| R01 | 单 SKU | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |
| R02 | 单 SKU | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |
| R03 | 多 SKU-颜色 | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |
| R04 | 多 SKU-颜色/尺寸 | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |
| R05 | 套装 | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |
| R06 | 缺尺重后人工补录 | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |
| R07 | 人机验证暂停/恢复 | 待填 | 待填 | 不得提交 | 未开始 | 未开始 | `locally_tested_fixture` |  |
| R08 | 佣金读取失败恢复 | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |
| R09 | 审核失败字段修复 | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |
| R10 | 写后库存回查 | 待填 | 待填 | 未开始 | 未开始 | 未开始 | `configuration_declared` |  |

## 证据与停止条件

- 客户端、fixture 或示例 proof 不能升级 `real_read_verified`；必须有服务端保存的 `server_observed` 回执。
- 任何未知写入结果必须是 `needs_review`；不得换 idempotency key 逃避未决命令。
- 没有当前店铺和环境匹配的 signed session 时，只能生成计划，不能联网。
- 没有精确仓库 tuple、完整分页或写后回查时，库存状态保持未知/待复核。
- 10 次记录完成前，不把单次成功描述成“ERP 已全链路可用”。
