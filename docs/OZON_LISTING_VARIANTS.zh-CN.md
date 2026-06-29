# Ozon 上架与变体合并规范

更新时间：2026-06-19

## 1. 目的

本规范约束 ERP 的 Ozon 上架链路。竞品数据只用于学习标题、类目、属性覆盖率和内容表达，不能直接作为待上架商品的事实值。1688 货源详情和人工确认结果才是商品事实来源，Ozon Seller API 的实时类目元数据是提交格式的唯一依据。

## 2. 官方 API 顺序

1. `/v1/description-category/tree`：选择描述类目与 `type_id`。
2. `/v1/description-category/attribute`：读取该类目的必填属性、字典属性和 `is_aspect` 变体属性。
3. `/v1/description-category/attribute/values`：为 `dictionary_id != 0` 的属性读取合法字典值。
4. `/v3/product/import`：整组提交同一型号的全部 SKU。
5. `/v1/product/import/info`：轮询异步任务，逐 SKU 检查错误、警告和业务缺陷。

## 3. 变体合并不变量

- 同一卡片的所有 SKU 必须使用相同的“Название модели (для объединения в одну карточку)”值。
- 每个 SKU 的 `offer_id` 必须唯一且稳定，重试时不得重新生成父 SKU。
- 每个 SKU 至少有一个真实 `is_aspect=true` 属性，且整组的变体属性组合必须唯一。
- 颜色、尺寸等字典属性必须提交实时字典中的 `dictionary_value_id`，不得凭名称伪造 ID。
- 不允许硬编码某一类目的变体属性 ID；必须使用当前类目的实时元数据。
- 多变体提交失败时不得只拿第一条 SKU 自动重试。任何修复都必须保留整组 SKU，重新执行唯一性预检后整组提交。

## 4. 提交前总闸

提交前必须阻断以下情况：

- 缺少类目、`type_id`、标题、图片、价格、重量或尺寸。
- 缺少当前类目的必填型号字段。
- `offer_id` 重复。
- 多 SKU 缺少实际变体属性。
- 两个 SKU 的 Ozon 变体属性组合完全相同。
- 字典属性没有合法 `dictionary_value_id`。

## 5. 审核回执判定

`product_id` 已生成不等于卡片业务成功。回执按三层处理：

- 阻塞错误：任务失败，进入 `failed`。
- 普通警告：保留诊断，但允许继续。
- 上架业务缺陷：例如 `double_without_merger_offer`，即使 `level=warning` 且已有 `product_id`，也必须进入 `needs_review / listing_defect`，禁止生成条码、禁止排库存、禁止标记 `live`。

变体合并失败统一使用原因码 `VARIANT_GROUPING_FAILED`，人工动作是检查每个 SKU 的颜色/尺寸等可变特征，修正后整组重提。

## 6. 已验证失败样本

历史任务 `al_mq3g1i6scat2`、父 SKU `SKUlq00131` 含 5 个变体。旧 Payload 给所有 SKU 写入同一个颜色特征，Ozon 返回 `double_without_merger_offer`。旧逻辑因为它是 warning 且存在 `product_id`，错误地将任务标记为 `live`。

当前修复会：

- 从类目实时读取 `10097 Название цвета` 和字典属性 `10096 Цвет товара`。
- 将不同 1688 颜色映射为不同文本及字典值。
- 在提交前检查整组变体组合唯一性。
- 将 Ozon 的未合并警告升级为业务缺陷，停止后续库存流程。

## 7. 研究资料

- Ozon Seller API 文档镜像：https://github.com/DragonSigh/ozon-seller-api-docs
- Ozon 官方变体合并视频：https://www.youtube.com/watch?v=_THiGQmRL5A
- Ozon 官方商品上传方式：https://www.youtube.com/watch?v=ZytkHhr2j-M
- Selsup 同类 ERP 变体管理：https://www.youtube.com/watch?v=1DtzgP9ZuFI
- Selsup Ozon 商品卡创建：https://www.youtube.com/watch?v=ADIVlaO87vo

## 8. 后续开发边界

- 竞品学习库可推荐字段、提示常见值和比较缺失项，但不能覆盖货源事实。
- 自动修复仅适用于单 SKU 且不会改变商品事实的格式问题。
- 类目切换、变体重组、字典值不确定和多 SKU 重提必须进入工作流诊断，并保留人工确认入口。
