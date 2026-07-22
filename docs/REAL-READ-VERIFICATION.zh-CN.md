# Ozon 受控真实只读验证入口

`src/readVerificationHarness.js` 是实验性只读验证 harness。它不属于普通卖家工作流，也不会执行商品、库存、价格、活动或订单写入。

## 默认离线

`runReadVerification()` 默认使用 `mode: "offline_fixture"`。fixture reader 可以返回脱敏的 endpoint observation；harness 只保存 endpoint、状态和响应摘要哈希，不保存原始响应、Offer、店铺 API Key 或请求体。离线模式即使调用 `readRequest` 也会被 `READ_VERIFY_NETWORK_DISABLED` 阻断。

## 真实读取前置条件

真实读取必须由运维人员在受控环境显式传入：

- `store.id` 或 `store.clientId`；harness 只生成 `storeRef`，不会把 `apiKey` 传给 reader。
- 非空 `environment`，例如 `staging-read-2026-07-16`。
- 有界 `scope`，至少包含 `name`，并应声明 Offer 数量或具体读取范围。
- `mode: "live_read"` 和 `confirm: "I_CONFIRM_READ_ONLY"`。
- 调用方注入 `request` 依赖；没有依赖不会联网。harness 只允许登记的 `GET` 或只读 `POST`，拒绝写方法、未登记路径和不受控请求体。

真实读取入口仍需由上层按当前 Seller API 文档选择端点、按店铺权限执行，并由服务端保存 `server_observed` 回执。Seller API 的读取接口很多使用 POST 承载筛选和分页，因此 harness 允许 GET 和 POST；FBS 新计划只允许当前 `/v4/posting/fbs/list`、`/v4/posting/fbs/unfulfilled/list`，旧 `/v3/` 路径仅为 deprecated 计划兼容而保留。其他方法（尤其 PUT/PATCH/DELETE）和未登记路径都会被拒绝，库存/价格/图片写入路径即使使用 GET 也不在 allowlist 内。harness 返回 `readOnly: true`、`writeAttempted: false`，但不能把一次成功读取自动升级为 `real_read_verified`；升级仍遵循现有 readiness/stock 回执的完整覆盖、受控失败和新鲜度条件。

## 验证等级

fixture 回放为 `locally_tested`；注入网络依赖后的真实读取最多产生脱敏 `server_observed` 输入。任何 API Key、完整响应或未知写入结果不得进入日志、fixture 或回执。

Harness 输出同时显式标记 `verificationLevel`：离线模式为 `locally_tested`，注入网络的只读模式为 `server_observed`；两者都不能直接升级为 `real_read_verified`。

客户端重试契约与 harness 的读取边界分开执行：`src/ozon.js` 对 GET 采用有限重试；POST 只有在显式 `retrySafe: true` 且端点属于读取白名单时才允许重试。对写端点或未登记端点传入 `retrySafe` 会在网络请求前 fail-closed，不得用该选项绕过写入结果未知/回查闸门。

失败响应也必须单独解释：注入 reader 返回 401/403、429、5xx 或通用异常时，结果会保留 `observedFailure=true`、`failureScenario=observed_read_failure` 和 `readSucceeded=false`；HTTP 403 等响应只在受控在线响应中标记 `permissionFailureVerified`，异常本身不会伪造权限失败。`server_observed` 仅表示服务端/注入依赖观察到了这次结果，绝不等于 `real_read_verified`；后者仍须由持久化回执 evaluator 按同环境成功、失败覆盖和新鲜度门槛升级。
