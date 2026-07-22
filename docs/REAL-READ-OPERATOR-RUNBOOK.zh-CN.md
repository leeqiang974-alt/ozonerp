# Ozon 受控真实只读运维操作卡

这张操作卡只允许验证 Seller API 读取，不是商品、库存、价格、活动或订单写入授权。当前代码和本卡的验证等级为 `locally_tested`；没有真实账号回执时，不得写成 `real_read_verified`。

## 执行前逐项确认

1. **店铺**：填写本次实际店铺的 `id` 或 `clientId`。不要把 API Key 放入计划、命令行、日志或回执。
2. **环境**：填写唯一环境标识（例如 `seller-production-cn-1-2026-07-17`），不能留空，也不能跨环境复用回执。
3. **读取范围**：写明业务范围和数量，例如 `single_offer / offerCount=1`；同时列出完整端点范围。当前受控端点为：
   `/v3/product/list`、`/v3/product/info/list`、`/v4/product/info/stocks`、`/v2/warehouse/list`、`/v4/posting/fbs/list`、`/v4/posting/fbs/unfulfilled/list`。旧 `/v3/posting/fbs/*` 仅兼容旧计划，不得用于新计划。
4. **只读姿态**：计划必须 `readOnly=true`、`writeAttempted=false`，并注入 request 依赖；未注入依赖时 harness 默认不联网。
5. **人工确认**：操作者必须明确输入 `I_CONFIRM_READ_ONLY`。这只是确认读取，不是写入批准。
6. **新鲜度**：指定回执 `maxAgeMs`，只能在 1 分钟至 7 天内。过期回执保留审计，但不支持当前就绪或 `real_read_verified`。
7. **审计输出**：`scripts/controlled-read.mjs` 现在是 plan-only 校验器；`--out` 只保存本地计划摘要，不代表真实回执。真实读取必须通过已认证的 `/api/ozon/read-operator/execute`，由服务端保存 `server_observed` 回执。

## 执行与失败处理

- 先运行 `validateReadOperatorPlan`，有任一错误就停止；再由已验证的 ERP session 调用 `/api/ozon/read-operator/execute`，提交同一店铺、环境、范围、plan binding 和 `I_CONFIRM_READ_ONLY`。
- CLI 仅生成计划：`node scripts/controlled-read.mjs --store <storeId> --environment <env> --scope single_offer --confirm I_CONFIRM_READ_ONLY --session-proof <proof.json> --out <计划摘要.json>`。即使加上 `--execute-live`，CLI 也会 fail-closed 返回 `READ_OPERATOR_SERVER_EXECUTION_REQUIRED`，不会直连 Ozon。
- 已登录 ERP 会话可调用 `GET /api/auth/session-proof` 获取无 Token 的 proof 摘要；loopback/static secret 请求会被拒绝。该 proof 只用于计划边界校验，不能替代服务端再次验签。
- 类目黄金链路先生成参数化计划：`node scripts/category-read-plan.mjs --store <storeId> --environment <env> --category-id <id> --type-id <id> --attribute-ids 85,9048,10097`。该命令只校验请求体和计划绑定，不联网；真实执行必须把同一计划、绑定和 `I_CONFIRM_READ_ONLY` 交给服务端类目读取入口。
- 只保存端点、状态、时间、范围和摘要哈希。不得保存原始响应、请求体、Offer 标识或凭据。
- 401/403、429、5xx、超时或未知响应均保存失败回执，结果保持 `server_observed`/`observed_read_failure`；不能把失败当成空店铺或成功读取。
- 只有服务端持久化的成功与受控失败回执，在同一环境、端点覆盖完整且处于新鲜窗口内，才可由 evaluator 参与升级；harness 单次成功永远不能自行升级。
- CLI 的 `--out` 只是本地计划工件，不能升级验证等级；必须由服务端回执仓储写入 `server_observed`，再通过绑定和新鲜度校验。CLI 永远不联网。

## 本地服务端回执演练（不联网）

在没有真实账号授权时，可用以下命令重放脱敏 fixture，验证服务端回执边界和卖家失败任务：

```powershell
npm.cmd run readiness-receipt-replay -- --out C:\tmp\ozon-readiness-replay.json
```

演练固定覆盖 `success`、`partial`、`permission (403)`、`rate_limited (429)` 和 `server_failure (5xx)`。所有回执都通过本地 `recordServerObservation` 持久化为 `server_observed`，但不创建任何 Ozon 请求；单独的成功或失败场景不会升级 `real_read_verified`，失败任务分别保持补证据、权限修复、等待限流或依赖恢复。演练输出仅包含哈希、状态和下一步，不应提交到 Git。

## 结束检查

记录店铺引用、环境引用、端点范围、`checkedAt`、失败场景和 `responseHash`，然后检查回执查询的 `staleCount`。未完成范围、失败、权限未知或过期时，下一步是补证据/重新只读读取，不是执行写入。
