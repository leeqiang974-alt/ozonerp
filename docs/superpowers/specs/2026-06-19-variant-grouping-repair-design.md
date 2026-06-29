# Ozon 变体分组缺陷修复台设计

## 目标

当 Ozon 返回 `double_without_merger_offer` 时，工作流控制台不再只展示原始 JSON，而是明确展示哪几个 SKU 的型号与可变特征发生重复，并允许人工生成、编辑、校验整组修复 Payload。

## 方案

采用工作流详情内的专用缺陷卡，不新建独立页面。后端把审核回执、原提交 Payload 和类目变体元数据整理为稳定的 `variantGroupingDiagnosis`；前端仅负责可视化和触发安全动作。

## 数据结构

`review_reconcile.output.variantGroupingDiagnosis` 包含：

- `modelAttributeIds`：当前类目用于合并的型号属性。
- `aspectAttributeIds`：当前类目的 `is_aspect=true` 属性。
- `rows`：每个 `offer_id` 的型号值、可变特征、组合签名和重复组编号。
- `duplicateGroups`：相同组合签名对应的 SKU 列表。
- `repairable`：是否具备生成整组修复草稿所需的原 Payload。

## 前端交互

- `listing_defect` 或 `VARIANT_GROUPING_FAILED` 节点显示红色专用卡。
- 表格逐 SKU 展示型号、颜色/尺寸等可变特征和重复状态。
- “生成整组修复草稿”只把完整原提交 Payload 写入工作流草稿，并保留全部 SKU。
- 用户在编辑器修改后必须先校验；只有预检通过且二次确认后才能调用现有安全提交接口。
- 不提供单 SKU 重试，不自动调用 Ozon，不自动排库存。

## 错误处理

- 缺少原 Payload：卡片仍展示 Ozon 缺陷，但禁用修复草稿按钮并提示重新生成完整批次。
- 缺少类目元数据：显示已有属性值，不猜测属性 ID。
- 草稿中 SKU 数量少于原批次：预检阻断并提示“整组 SKU 不完整”。
- 草稿仍有重复变体组合：沿用 `DUPLICATE_VARIANT_ASPECTS` 阻断。

## 测试

- 后端诊断器能识别重复变体组合并保留所有 SKU。
- 修复草稿生成器拒绝单 SKU/缺失 SKU 的降级草稿。
- 前端静态测试确认专用卡、逐 SKU 表格和整组草稿动作存在。
- 原有 Payload 保存、校验、人工确认提交安全闸保持通过。
