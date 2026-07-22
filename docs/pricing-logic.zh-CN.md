# Ozon ERP 定价、运费、原价、最低价逻辑

本文档描述当前 ERP 内已经实现的定价口径，覆盖 1688 采集候选进入 Ozon 自动上架 payload 时的售价、运费、原价和最低价。

## 1. 参与字段

| 字段 | 含义 | 当前口径 |
|---|---|---|
| `purchaseCost` | 采购成本 | 自动上架取匹配货源价/1688 SKU 价，再加 `5 RMB` 采购缓冲 |
| `price` | Ozon 售价 | 通过运费、佣金、杂费、利润率迭代计算，币种为 `CNY` |
| `old_price` | 原价/划线价 | 默认兼容旧规则 `price * 2`；传入 `pricingPolicy` 时按策略倍率生成并记录来源 |
| `min_price` | 最低价 | 默认兼容 `minPriceFromPrice(price)`；传入 `pricingPolicy` 时按最低利润底线生成 |
| `logisticsFee` | 运费/物流成本 | 按重量、尺寸、售价匹配人民币物流等级后计算 |
| `commission` | Ozon 佣金预估 | 必须绑定当前类目/商品的佣金证据；旧的 `15%` 仅作为兼容计算输入，命中 `manual_default` 时工作流阻塞，不得提交 |
| `miscFee` | 杂费 | 默认 `price * 2% + 2 RMB` |
| `profitRate` | 目标利润率 | 默认 `30%` |

## 2. 售价计算逻辑

售价不是简单的“采购价 × 倍数”，而是一个迭代公式，因为 Ozon 佣金、杂费和仓库/运费等级都会随售价变化。没有可信佣金来源时可以生成诊断草稿，但工作流必须阻塞，不能把默认比例当作真实利润结论。

计算步骤：

1. 初始预估售价：`purchaseCost * (1 + profitRate) + fixedMiscFee`。
2. 用当前预估售价、重量、长宽高匹配人民币物流等级。
3. 计算运费：`ratePerKg * weightKg + fixedFee`。
4. 计算佣金：`estimatedPrice * commissionRate`。
5. 计算杂费：`estimatedPrice * miscFeeRate + fixedMiscFee`。
6. 计算成本基数：`purchaseCost + commission + logisticsFee + miscFee`。
7. 计算下一轮售价：`baseCost * (1 + profitRate)`。
8. 循环迭代，直到前后价格变化小于 `0.01 RMB`，或达到最大迭代次数。

核心实现位置：`src/pricing.js` 的 `calculateOzonPrice()`。

## 3. 运费/物流等级逻辑

当前 ERP 内置 4 个人民币物流等级：

| 等级 | 重量范围 | 售价范围 | 尺寸限制 | 运费公式 |
|---|---:|---:|---:|---:|
| Extra Small | 1-500g | 0.01-135 RMB | 三边和 ≤ 90cm | `25 RMB/kg + 3` |
| Budget | 500-30000g | 0.01-135 RMB | 三边和 ≤ 150cm，最长边 ≤ 80cm | `17 RMB/kg + 23` |
| Small | 1-2000g | 135.01-635 RMB | 三边和 ≤ 150cm，最长边 ≤ 80cm | `25 RMB/kg + 16` |
| Big | 2001-30000g | 135.01-635 RMB | 三边和 ≤ 250cm，最长边 ≤ 150cm | `17 RMB/kg + 36` |

注意：

- 系统输入尺寸是 `mm`，匹配等级时会换算成 `cm`。
- 系统输入重量是 `g`，计算运费时会换算成 `kg`。
- 如果重量、尺寸、售价都无法匹配任何等级，该商品应阻塞上架，进入诊断/人工修正。

核心实现位置：`src/pricing.js` 的 `RMB_SHIPPING_LEVELS`、`matchRmbShippingLevel()`、`calculateShippingFee()`。

## 4. 原价/划线价逻辑

默认兼容路径仍保持：

```text
old_price = round(price * 2)
```

也就是说，售价 58.6 RMB 时，原价约为 117.2 RMB；售价 59 RMB 时，原价为 118 RMB。

当传入 `pricingPolicy` 时，原价会按策略生成：

```text
old_price = round(price * oldPriceMultiplier)
oldPriceSource.mode = oldPriceMode
```

当前首版策略支持 `oldPriceMode = promo_multiplier`，例如 `oldPriceMultiplier = 1.6`。

这个字段主要用于 Ozon 展示折扣/划线价，不参与当前利润公式。

核心实现位置：`src/pricing.js` 的 `derivePricingPolicyFields()` 和 `src/autoListing.js` 自动上架 payload 组装。

## 5. 最低价逻辑

默认兼容路径的最低价规则为：

```text
如果 price 非法或 <= 0：返回空
如果 price 是小数：最低价 = floor(price)
如果 price 是整数：最低价 = price - 1
最低不得低于 1
```

示例：

| 售价 | 最低价 |
|---:|---:|
| 25.2 | 25 |
| 25 | 24 |
| 1 | 1 |

这样做的目的：避免 `min_price` 等于 `price`，降低 Ozon 拒绝或促销价异常风险。

当传入 `pricingPolicy` 时，最低价按利润底线生成：

```text
rateFloor = baseCost / (1 - minimumProfitRate)
fixedFloor = baseCost + minimumProfitCny
min_price = ceil(max(rateFloor, fixedFloor, 1))
```

如果策略最低价不低于售价，诊断会标记 `blocked=true` 和 `PRICING_MIN_PRICE_INVALID`，不能当作安全价格继续。

核心实现位置：`src/autoListing.js` 的 `minPriceFromPrice()` 和 `src/pricing.js` 的 `derivePricingPolicyFields()`。

## 6. 自动上架中的整体价格流程

父商品：

```text
purchaseCost = max(bestMatchPrice + 5, 1)
price = calculateOzonPrice(purchaseCost, weight, dimensions, profitRate=30%).priceCny
old_price = round(price * 2) 或 pricingPolicy 策略价
min_price = minPriceFromPrice(price) 或 pricingPolicy 利润底线价
currency_code = CNY
```

变体商品：

```text
variantPurchase = max(variant.price 或 bestMatchPrice + 5, 1)
variantPrice = calculateOzonPrice(variantPurchase, variantPackage 或 parentPackage).priceCny
variant.old_price = round(variantPrice * 2) 或 pricingPolicy 策略价
variant.min_price = minPriceFromPrice(variantPrice) 或 pricingPolicy 利润底线价
```

如果某个变体缺少独立尺重，会回退使用父商品尺重；如果价格计算失败，会尽量回退父商品价格，但该情况后续应在工作流诊断里暴露出来。

## 7. 后续建议

当前逻辑能跑通基础自动上架，但还不是完整商业定价系统。建议后续补强：

1. 按 Ozon 类目读取真实佣金率，而不是固定 `15%`。
2. 运费等级配置化，支持后台维护和历史版本。
3. 增加人民币/卢布汇率策略，明确 Ozon `CNY` 与实际结算口径。
4. 在工作流节点中输出完整价格诊断：采购价、加价、仓库等级、运费、佣金、杂费、利润、最低价原因。
5. 对高风险商品阻塞上架：无尺重、无法匹配运费等级、计算不收敛、售价超过等级上限。

### 可配置佣金与 realFBS 路由表演进

`kennard520/ozon-helper` 对 Seller API 覆盖较完整，可作为后续维护佣金、类目费用和 realFBS 路由资料的参考；但不能直接搬运发布链路或弱预检逻辑。建议单独开 TDD 计划推进：

1. 新增版本化价格资料源，至少包含 `source`、`effectiveFrom`、`categoryKey`、`rate`、`confidence`、`updatedAt`。
2. 佣金率优先级：Ozon 官方/类目资料 > 同类已上架商品学习 > 人工维护类目表 > 当前 `15%` 默认兜底。
3. realFBS/物流路由表应记录路由、重量/尺寸边界、费用公式、生效日期和禁用状态，不覆盖现有阻塞规则。
4. `commissionSource` 和 `packageInfoSource` 必须继续写入 `pricingDiagnosis`，前端显示来源和可信度。
5. 如果资料冲突、过期、缺失或导致 `min_price >= price`，必须保持 blocked/manual_review，不允许把风险当作安全价格。

类目佣金的最低证据要求：当 `commissionSource.source = ozon_category` 时，诊断必须同时携带 `evidenceRef`（对应 Seller API 只读回执或官方资料快照）和 `updatedAt`。只有比例没有这两个字段时，使用 `PRICING_COMMISSION_EVIDENCE_UNTRACEABLE` 阻断；`learned_product` 仍只能标记为估算，不能解释为 Ozon 当前类目事实。

实现边界：该演进只改变价格资料来源和诊断解释，不改变“预检 + 人工确认 + workflow lock”总闸；价格代码改动应另建测试文件，例如 `test/pricing-source.test.js`，先覆盖来源优先级、过期资料、冲突资料和 blocked 风险。

## 8. 工作流定价诊断接入

当前已将定价诊断接入 `match_profit` 工作流节点。自动上架生成 Payload 草稿或真实流程计算价格后，会把以下结构写入节点输出的 `pricingDiagnosis`：

| 字段 | 含义 |
|---|---|
| `sourcePriceCny` | 原始货源价/匹配价 |
| `purchaseMarkupRmb` | 采购缓冲，当前固定 `5 RMB` |
| `purchaseCost` | 计价采购成本，即货源价 + 缓冲 |
| `priceCny` | 最终建议售价 |
| `oldPriceCny` | Ozon 原价/划线价 |
| `minPriceCny` | Ozon 最低价 |
| `logisticsFee` | 物流/运费 |
| `commission` | 佣金预估 |
| `commissionRate` | 本次计算使用的佣金率 |
| `commissionSource` | 佣金率来源：Ozon 类目真实佣金、同类已上架商品学习、手填/默认兜底 |
| `miscFee` | 杂费 |
| `baseCost` | 采购成本 + 佣金 + 运费 + 杂费 |
| `profit` | 预计利润 |
| `profitStatus` | 利润证据状态：`unknown`（默认佣金或缺少结算规则）/ `estimate`（有佣金证据但仍未核对结算） |
| `profitConclusion` | 面向卖家的结论；`unknown_without_trusted_commission_and_settlement_rules` 不得展示为确定利润 |
| `profitEvidence` | 佣金、人民币物流假设和结算规则的来源/验证等级；当前结算规则未接入时明确为 `missing` |
| `level` | 匹配到的运费等级 |
| `package` | 计价使用的重量和长宽高 |
| `steps` | 价格迭代过程，最多保留最近步骤 |
| `variants` | 多 SKU 时每个变体的价格、最低价、运费等级和尺重 |

前端“工作流控制台”在节点详情中显示“定价诊断”卡片，展示采购成本、售价、最低价、运费等级、佣金、利润、尺重、成本基数、迭代步数和变体价格明细。

### 佣金来源规则

当前已把佣金来源接入定价诊断：

1. 如果 `ozonContext.commissions` 或任务自身携带可解析的 Ozon 商品佣金字段，会使用该比例，并标记为 `learned_product` / `同类已上架商品学习`。
2. 如果没有可学习佣金，继续使用 `15%`，并标记为 `manual_default` / `手填/默认佣金率`。
3. 预留 `ozon_category` 来源，用于后续接入 Ozon 当前开放的类目真实佣金或费率接口。

无论公式返回了数值，当前尚未接入 Ozon 结算/费用明细时都只能称为“估算”；没有可信佣金时 `profitStatus` 为 `unknown`，工作流保持阻塞，不能把数字当成确定利润。

注意：`learned_product` 是同类商品经验学习，不能等同于 Ozon 官方类目实时佣金；工作流会显示来源和可信度，避免把兜底值误当成真实值。

安全边界：

- 定价诊断只解释价格来源，不自动提交 Ozon。
- 即使定价诊断正常，也必须继续经过 Payload 预检和人工确认。
- 价格异常、尺重异常或运费等级异常，应在工作流中进入人工修正，不应跳过总闸。

## 9. 价格风险阻塞规则

当前 `match_profit` 节点已经接入价格风险判断。只要触发风险，节点状态会变为 `waiting_human`，并显示价格风险 reasonCode。

| reasonCode | 分支 | 风险 | 触发条件 | 建议动作 |
|---|---|---|---|---|
| `PRICING_PROCUREMENT_EVIDENCE_MISSING` | `blocked` | high | 1688 采集已声明采购证据，但供应商、MOQ 或数量绑定阶梯价不完整 | 补充供应商与 MOQ，读取对应采购数量的阶梯价，人工核对采购成本快照 |
| `PRICING_PACKAGE_MISSING` | `blocked` | high | 重量或长宽高不完整 | 补齐商品尺重，重新解析 1688 详情，重新生成 Payload 草稿 |
| `PRICING_SHIPPING_LEVEL_MISSING` | `blocked` | high | 无法匹配 Extra Small / Budget / Small / Big 任一运费等级 | 检查尺重单位，调整售价或换货源，维护运费等级配置 |
| `PRICING_NOT_CONVERGED` | `blocked` | high | 价格迭代未收敛 | 检查运费等级边界，人工指定售价，重新计算价格 |
| `PRICING_MIN_PRICE_INVALID` | `blocked` | high | 最低价为空、为 0，或不低于售价 | 重新生成最低价，人工检查售价，重新校验 Payload |
| `PRICING_PROFIT_LOW` | `manual_review` | medium | 利润小于等于 0，或利润/售价低于 8% | 复核采购价和运费，提高售价，换更高利润货源 |
| `PRICING_LOGISTICS_RATIO_HIGH` | `manual_review` | medium | 运费/售价超过 35% | 复核尺重，检查是否可换轻小货源，人工确认售价 |

说明：

- `blocked` 表示不能继续自动链路，应先修正基础数据。
- `manual_review` 表示可人工判断是否接受风险，但系统不会无确认继续。
- 这些规则不替代 Ozon Payload 预检；它们发生在更早的利润匹配/定价阶段。
- 1688 页面上的 SKU 展示价不是单件可采购成本。只要采集结果带有 `procurementEvidence`，定价必须同时校验供应商、MOQ 和数量绑定阶梯价；证据缺失时保持 `blocked`。旧任务没有该字段时维持兼容，但不得据此升级为真实验证。
- 手工保存采购资料会保留 `source: "manual_seller"`、`verificationState: "manual_unverified"` 和空 `evidenceRef`，定价诊断显示 `needs_review`，不能冒充 1688 页面事实。只有每个采购字段的 `evidenceRef` 与候选 `sourceEvidence.snapshotHash` 对齐时，才可标记 `source_verified/verified`。

## 10. 价格风险人工处理动作

工作流控制台的“定价诊断”卡片已提供人工动作：

| 动作 | 作用 | 安全规则 |
|---|---|---|
| 重新生成价格 | 将 `match_profit` 节点置为 `retrying`，记录 `pricing_recalculation_requested` 事件 | 不提交 Ozon，只请求定价节点重跑 |
| 接受价格风险 | 将可接受的 `manual_review` 风险改为 `success`，记录 `pricing_risk_accepted` 事件 | 仅允许 `PRICING_PROFIT_LOW`、`PRICING_LOGISTICS_RATIO_HIGH`；`blocked` 类风险会被后端拒绝 |
| 转到 Payload 草稿 | 前端滚动并聚焦 Payload 编辑器 | 只是定位，不修改数据 |
| 标记换货源 | 复用工作流“换新货源”动作 | 当前候选放弃或生成新采集任务，不提交 Ozon |

接受价格风险后仍保留提交锁，后续必须经过 Payload 预检和人工确认，不允许直接提交 Ozon。
