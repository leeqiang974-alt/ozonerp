# Ozon Seller API 端点参考（完整版）

> 来源: https://docs.ozon.ru/api/seller/zh/ （离线快照 2026-08-04）  
> 总计: 264 个端点 · 全部 POST（除 `/v1/actions` 为 GET）  
> 语言参数: `language=ZH_HANS` 可直接获取中文类目/属性名称，无需翻译  
> 本文档是 ERP 开发的 API 对接权威指导，按 MASTER_PLAN 阶段分组。

## 按 MASTER_PLAN 阶段分组

### 阶段 1-2 ｜ 店铺接入与只读同步

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/roles` | POST | 使用API密钥获取角色和方式列表 |
| `/v1/seller/info` | POST | 卖家个人中心信息 |
| `/v1/seller/ozon-logistics/info` | POST | Ozon配送开通信息 |
| `/v1/description-category/tree` | POST | 商品类别和类型的树形图 |
| `/v1/description-category/attribute` | POST | 类别特征列表 |
| `/v1/description-category/attribute/values` | POST | 特征值指南 |
| `/v1/description-category/attribute/values/search` | POST | 根据属性的参考值进行搜索 |
| `/v1/description-category/tips` | POST | 获取用于确定商品类目的提示 |
| `/v3/product/list` | POST | 品列表的 |
| `/v3/product/info/list` | POST | 根据标识符获取商品信息 |
| `/v4/product/info/attributes` | POST | 获取商品特征描述 |
| `/v4/product/info/limit` | POST | 品类限制、商品的创建和更新 |
| `/v4/product/info/stocks` | POST | 关于商品数量的信息 |
| `/v2/product/info/stocks-by-warehouse/fbs` | POST | 获取卖家仓库库存信息 |
| `/v5/product/info/prices` | POST | 获取商品价格信息 |
| `/v1/product/info/description` | POST | 获取商品详细信息 |
| `/v1/product/info/subscription` | POST | 订阅该商品的用户数 |
| `/v1/product/rating-by-sku` | POST | 按SKU获得商品的内容排名 |
| `/v2/product/pictures/info` | POST | 获取商品图片 |
| `/v1/warehouse/list` | POST | 仓库清单 |
| `/v2/warehouse/list` | POST | 仓库列表 |
| `/v1/delivery-method/list` | POST | 仓库物流方式清单 |
| `/v2/delivery-method/list` | POST | realFBS仓库的配送方式列表 |
| `/v3/posting/fbs/get` | POST | 按照ID获取货件信息 |
| `/v3/posting/fbs/list` | POST | 货件列表 已废弃 ⚠️已废弃 |
| `/v3/posting/fbs/unfulfilled/list` | POST | 未处理货件列表 已废弃 ⚠️已废弃 |
| `/v4/posting/fbs/list` | POST | 获取货件列表 |
| `/v4/posting/fbs/unfulfilled/list` | POST | 获取未处理货件列表 |
| `/v2/posting/fbs/get-by-barcode` | POST | 按条形码获取有关货件的信息 |

### 阶段 3 ｜ FBS 工作台（拣配 / 打包 / 面单 / 交接 / 发货）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v4/posting/fbs/ship` | POST | 搜集订单 (第4方案) |
| `/v4/posting/fbs/ship/package` | POST | 货件的部分装配 (第4方案) |
| `/v2/posting/fbs/package-label` | POST | 打印标签 |
| `/v2/posting/fbs/awaiting-delivery` | POST | 货件装运 |
| `/v2/fbs/posting/delivering` | POST | 将状态改成“运输中” |
| `/v2/fbs/posting/tracking-number/set` | POST | 添加跟踪号 |
| `/v2/fbs/posting/last-mile` | POST | 状态改为“最后一英里” |
| `/v2/fbs/posting/delivered` | POST | 将状态改成“已送达” |
| `/v2/posting/fbs/cancel` | POST | 取消货运 |
| `/v2/posting/fbs/cancel-reason/list` | POST | 货件取消原因 |
| `/v2/posting/fbs/product/cancel` | POST | 取消某些商品发货 |
| `/v1/posting/fbs/cancel-reason` | POST | 货运取消原因 |
| `/v1/posting/fbs/split` | POST | 将订单拆分为不带备货的货件 |
| `/v1/posting/cutoff/set` | POST | 确认货件发运日期 |
| `/v1/posting/carriage-available/list` | POST | 可供运输的列表 |
| `/v1/carriage/create` | POST | 创建发运 |
| `/v1/carriage/approve` | POST | 发运确认 |
| `/v1/carriage/get` | POST | 运输信息 |
| `/v1/carriage/cancel` | POST | 发运删除 |
| `/v1/carriage/set-postings` | POST | 发运组成商品更改 |
| `/v1/carriage/pass/create` | POST | 创建通行证 |
| `/v1/carriage/pass/update` | POST | 更新通行证 |
| `/v1/carriage/pass/delete` | POST | 删除通行证 |
| `/v1/pass/list` | POST | 通行证列表 |
| `/v1/assembly/carriage/posting/list` | POST | 获取发运中的货件列表 |
| `/v1/assembly/carriage/product/list` | POST | 获取发运中的商品列表 |
| `/v1/assembly/fbs/posting/list` | POST | 获取货件列表 |
| `/v1/assembly/fbs/product/list` | POST | 获取货件中的商品列表 |
| `/v2/posting/fbs/act/get-postings` | POST | 单据中的货件列表 |
| `/v2/posting/fbs/act/get-container-labels` | POST | 货位标签 |
| `/v1/rating/index/fbs/info` | POST | 获取错误指数：FBS 和 rFBS |
| `/v1/rating/index/fbs/posting/list` | POST | 影响错误指数的货件列表：FBS 和 rFBS |

### 阶段 4 ｜ 商品库存

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v2/products/stocks` | POST | 更新库存商品的数量 |
| `/v1/report/warehouse/stock` | POST | 关于FBS仓库库存报告 |
| `/v1/warehouse/invalid-products/get` | POST | 获取配送受限商品列表 |
| `/v1/warehouse/warehouses-with-invalid-products` | POST | 获取含有配送受限商品的仓库列表 |
| `/v1/warehouse/operation/status` | POST | 获取操作状态 |
| `/v1/warehouse/archive` | POST | 将仓库归档 |
| `/v1/warehouse/unarchive` | POST | 将仓库解除归档 |
| `/v1/product/action/timer/status` | POST | 获取已设置计时器状态 |
| `/v1/product/action/timer/update` | POST | 最低价格时效性计时器更新 |

### 阶段 5 ｜ 定价与营销控制

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/pricing-strategy/list` | POST | 策略列表 |
| `/v1/pricing-strategy/create` | POST | 创建策略 |
| `/v1/pricing-strategy/update` | POST | 更新策略 |
| `/v1/pricing-strategy/delete` | POST | 删除策略 |
| `/v1/pricing-strategy/info` | POST | 策略信息 |
| `/v1/pricing-strategy/status` | POST | 更改策略状态 |
| `/v1/pricing-strategy/products/add` | POST | 将商品添加到策略 |
| `/v1/pricing-strategy/products/list` | POST | 策略中的商品列表 |
| `/v1/pricing-strategy/products/delete` | POST | 从策略中删除商品 |
| `/v1/pricing-strategy/product/info` | POST | 竞争对手&nbsp; 的商品价格 |
| `/v1/pricing-strategy/competitors/list` | POST | 竞争对手名单 |
| `/v1/pricing-strategy/strategy-ids-by-product-ids` | POST | 策略ID列表 |
| `/v1/actions` | GET | 活动清单 |
| `/v1/actions/candidates` | POST | 可用的促销商品清单 |
| `/v1/actions/products` | POST | 参与&nbsp;活动的商品列表 |
| `/v1/actions/products/activate` | POST | 在促销活动中增加一个商品 |
| `/v1/actions/products/deactivate` | POST | 从活动中删除商品 |
| `/v1/actions/discounts-task/list` | POST | 申请折扣列表 |
| `/v1/actions/discounts-task/approve` | POST | 同意折扣申请 |
| `/v1/actions/discounts-task/decline` | POST | 取消折扣申请 |
| `/v1/actions/auto-add/products/list` | POST | 获取促销活动自动添加列表中的商品列表 |
| `/v1/actions/auto-add/products/candidates` | POST | 获取可自动添加到促销活动中的商品列表 |
| `/v1/actions/auto-add/products/update` | POST | 在促销活动自动添加列表中添加或更新商品 |
| `/v1/actions/auto-add/products/delete` | POST | 从促销活动自动添加列表中删除商品 |
| `/v2/actions/discounts-task/list` | POST | 获取折扣申请列表 |
| `/v1/seller-actions/list` | POST | 获取促销活动列表 |
| `/v1/seller-actions/archive` | POST | 将促销活动归档 |
| `/v1/seller-actions/change-activity` | POST | 启用或关闭活动 |
| `/v1/seller-actions/create/discount` | POST | 创建采用"折扣"机制的促销活动 |
| `/v1/seller-actions/create/discount-with-condition` | POST | 创建采用"基于订单总额的折扣"机制的促销活动 |
| `/v1/seller-actions/create/installment` | POST | 创建采用"免息分期付款"机制的促销活动 |
| `/v1/seller-actions/create/multi-level-discount` | POST | 创建采用"多级满额折扣"机制的促销活动 |
| `/v1/seller-actions/create/voucher` | POST | 创建采用"促销码折扣"机制的促销活动 |
| `/v1/seller-actions/update/discount` | POST | 更新“折扣”机制的促销活动 |
| `/v1/seller-actions/update/discount-with-condition` | POST | 更新“基于订单总额的折扣”机制的促销活动 |
| `/v1/seller-actions/update/installment` | POST | 更新“免息分期付款”机制的促销活动 |
| `/v1/seller-actions/update/multi-level-discount` | POST | 更新“多级满额折扣”机制的促销活动 |
| `/v1/seller-actions/update/voucher` | POST | 更新“促销码折扣”机制的促销活动 |
| `/v1/seller-actions/voucher/get` | POST | 获取CSV格式的促销码文件 |
| `/v1/seller-actions/products/add` | POST | 将商品添加到促销活动中 |
| `/v1/seller-actions/products/candidates` | POST | 获取促销活动可用商品列表 |
| `/v1/seller-actions/products/delete` | POST | 从促销活动中移除商品 |
| `/v1/seller-actions/products/list` | POST | 获取参与活动的商品列表 |
| `/v1/product/attributes/update` | POST | 更新商品特征 |
| `/v1/product/update/offer-id` | POST | 从卖家的系统中改变商品货号 |
| `/v1/product/archive` | POST | 将商品归档 |
| `/v1/product/unarchive` | POST | 从档案中还原商品 |
| `/v1/product/import/prices` | POST | 更新价格 |

### 阶段 6 ｜ 报表与运营分析

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/analytics/data` | POST | 分析数据 |
| `/v1/analytics/product-queries` | POST | 获取商品搜索查询信息 |
| `/v1/analytics/product-queries/details` | POST | 有关特定商品查询的信息 |
| `/v1/finance/balance` | POST | 获取余额报告 |
| `/v1/finance/cash-flow-statement/list` | POST | 财务报告 |
| `/v1/finance/realization/posting` | POST | 按订单细分的商品销售报告 |
| `/v1/finance/realization/by-day` | POST | 每日商品销售报告 |
| `/v2/finance/realization` | POST | 商品销售报告 （第2版） |
| `/v1/finance/compensation` | POST | 赔偿报告 |
| `/v1/finance/decompensation` | POST | 赔偿返还报告 |
| `/v1/finance/accrual/postings` | POST | 获取按货件统计的应计项目 |
| `/v1/finance/accrual/types` | POST | 获取应计项目参考信息 |
| `/v1/finance/accrual/by-day` | POST | 获取某日应计项目 |
| `/v3/finance/transaction/list` | POST | 交易清单 |
| `/v3/finance/transaction/totals` | POST | 清单数目 |
| `/v1/report/info` | POST | 报告信息 |
| `/v1/report/list` | POST | 报告清单 |
| `/v1/report/products/create` | POST | 商品报告 |
| `/v1/report/postings/create` | POST | 发货报告 |
| `/v1/report/discounted/create` | POST | 减价商品报告 |
| `/v1/report/marked-products-sales/create` | POST | 生成带有标记商品的销售报告 |
| `/v1/report/realization/posting/create` | POST | 获取每订单商品销售报告 |
| `/v1/search-queries/text` | POST | 获取按文本筛选的搜索查询列表 |
| `/v1/search-queries/top` | POST | 获取热门搜索查询列表 |

### 阶段 7 ｜ 受控写回（商品上架 / 发布）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v3/product/import` | POST | 创建或更新商品 |
| `/v1/product/import/info` | POST | 查询商品添加或更新状态 |
| `/v1/product/import-by-sku` | POST | 通过SKU创建商品 |
| `/v1/barcode/add` | POST | 为商品绑定条形码 |
| `/v1/barcode/generate` | POST | 创建商品条形码 |
| `/v1/product/pictures/import` | POST | 上传或更新商品图片 |
| `/v2/products/delete` | POST | 从存档删除没有SKU的商品 |
| `/v5/fbs/posting/product/exemplar/status` | POST | 获取样件添加状态 |
| `/v5/fbs/posting/product/exemplar/validate` | POST | 标志代码验证 |
| `/v6/fbs/posting/product/exemplar/set` | POST | 检查并保存份数数据 |
| `/v6/fbs/posting/product/exemplar/create-or-get` | POST | 获取已创建样件数据 |
| `/v1/fbs/posting/product/exemplar/update` | POST | Обновить данные экземпляров |
| `/v2/posting/fbs/product/country/list` | POST | 可用产地名单 |
| `/v2/posting/fbs/product/country/set` | POST | 添加商品产地信息 |
| `/v1/supply-order/bundle` | POST | 交货或交货申请的商品组成 |
| `/v1/polygon/create` | POST | 创建一个快递的设施 |
| `/v1/polygon/bind` | POST | 将快递方式与快递设施联系起来 |
| `/v1/warehouse/fbs/create` | POST | 创建仓库 |
| `/v1/warehouse/fbs/update` | POST | 更新仓库 |
| `/v1/warehouse/fbs/first-mile/update` | POST | 更新头程物流 |

### 客服与评价（跨阶段辅助）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/chat/send/message` | POST | 发送信息 |
| `/v1/chat/send/file` | POST | 发送文件 |
| `/v1/chat/start` | POST | 创建新聊天 |
| `/v2/chat/read` | POST | 将信息标记为已读 |
| `/v3/chat/list` | POST | 聊天清单 |
| `/v3/chat/history` | POST | 聊天历史记录 |
| `/v1/question/list` | POST | 问题列表 |
| `/v1/question/info` | POST | 问题详情 |
| `/v1/question/count` | POST | 按状态统计问题数量 |
| `/v1/question/answer/create` | POST | 创建对问题的回答 |
| `/v1/question/answer/delete` | POST | 删除问题回答 |
| `/v1/question/answer/list` | POST | 问题回答列表 |
| `/v1/question/change_status` | POST | 更改问题状态 |
| `/v1/question/top-sku` | POST | 提问数量最多的商品 |
| `/v1/review/list` | POST | 获取评价列表 已废弃 ⚠️已废弃 |
| `/v2/review/list` | POST | 获取评价列表 |
| `/v1/review/info` | POST | 获取评价信息 |
| `/v1/review/count` | POST | 根据状态统计的评价数量 |
| `/v1/review/comment/create` | POST | 对评价留下评论 |
| `/v1/review/comment/delete` | POST | 删除对评价的评论 |
| `/v1/review/comment/list` | POST | 评价的评论列表 |
| `/v1/review/change-status` | POST | 更改评价状态 |

### 退货（跨阶段辅助）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/returns/company/fbs/info` | POST | FBS退货数量 |
| `/v1/returns/list` | POST | FBO和FBS退货信息 |
| `/v1/returns/rfbs/action/set` | POST | 传递 rFBS 退货的可用操作 |
| `/v2/returns/rfbs/list` | POST | 退货申请列表 |
| `/v2/returns/rfbs/get` | POST | 退货申请信息 |
| `/v2/returns/rfbs/reject` | POST | 拒绝退货申请 |
| `/v2/returns/rfbs/compensate` | POST | 退还部分商品金额 |
| `/v2/returns/rfbs/verify` | POST | 批准退货申请 |
| `/v2/returns/rfbs/receive-return` | POST | 确认收到待检查商品 |
| `/v2/returns/rfbs/return-money` | POST | 向买家退款 |
| `/v1/return/pass/create` | POST | 创建退货通行证 |
| `/v1/return/pass/update` | POST | 更新退货通行证 |
| `/v1/return/pass/delete` | POST | 删除退货通行证 |
| `/v2/conditional-cancellation/list` | POST | 获取 rFBS 取消申请列表 |
| `/v2/conditional-cancellation/approve` | POST | 确认 rFBS 取消申请 |
| `/v2/conditional-cancellation/reject` | POST | 拒绝 rFBS 取消申请 |

### FBP（Fulfillment by Partner）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/posting/fbp/get` | POST | 按标识符获取货件信息 |
| `/v1/fbp/warehouse/list` | POST | 获取合作伙伴仓库列表 |
| `/v1/fbp/draft/get` | POST | 获取交货草稿信息 |
| `/v1/fbp/draft/list` | POST | 交货草稿列表 |
| `/v1/fbp/draft/direct/seller-dlv/create` | POST | 创建由卖家配送的草稿 |
| `/v1/fbp/draft/direct/seller-dlv/edit` | POST | 更新草稿中由卖家配送的信息 |
| `/v1/fbp/draft/direct/timeslot/edit` | POST | 编辑草稿中的时间段 |
| `/v1/fbp/draft/direct/timeslot/get` | POST | 获取直供的时间段列表 |
| `/v1/fbp/draft/direct/create` | POST | 创建不指定配送方法的交货申请草稿 |
| `/v1/fbp/draft/direct/delete` | POST | 删除交货申请草稿 |
| `/v1/fbp/draft/direct/product/validate` | POST | 检查合作伙伴仓库商品列表 |
| `/v1/fbp/draft/direct/registrate` | POST | 将草稿单转为正式交货 |
| `/v1/fbp/draft/direct/tpl-dlv/create` | POST | 创建第三方物流公司配送的申请草稿 |
| `/v1/fbp/draft/direct/tpl-dlv/edit` | POST | 编辑采用第三方承运商配送方法的交货草稿 |
| `/v1/fbp/draft/drop-off/province/list` | POST | 获取省份列表 |
| `/v1/fbp/draft/drop-off/point/list` | POST | 获取省份内接收点列表 |
| `/v1/fbp/draft/drop-off/point/timetable` | POST | 获取接收点的营业时间表 |
| `/v1/fbp/draft/drop-off/product/validate` | POST | 检查合作伙伴仓库可接收的商品列表 |
| `/v1/fbp/draft/drop-off/create` | POST | 创建接收点配送草稿 |
| `/v1/fbp/draft/drop-off/delete` | POST | 删除接收点配送草稿 |
| `/v1/fbp/draft/drop-off/dlv/edit` | POST | 编辑接收点配送草稿的配送详情 |
| `/v1/fbp/draft/drop-off/registrate` | POST | 将草稿转为正式交货 |
| `/v1/fbp/draft/pick-up/create` | POST | 创建 pick-up 交货申请草稿 |
| `/v1/fbp/draft/pick-up/delete` | POST | 取消 pick-up 交货申请草稿 |
| `/v1/fbp/draft/pick-up/dlv/edit` | POST | 修改 pick-up 交货申请 |
| `/v1/fbp/draft/pick-up/product/validate` | POST | 验证用于 pick-up 交货的商品列表 |
| `/v1/fbp/draft/pick-up/registrate` | POST | 将草稿单转为正式交货 |
| `/v1/fbp/order/direct/cancel` | POST | 取消交货 |
| `/v1/fbp/order/direct/seller-dlv/edit` | POST | 更新卖家自配送信息 |
| `/v1/fbp/order/direct/timeslot/edit` | POST | 编辑交货申请中的时间段 |
| `/v1/fbp/order/direct/timeslot/list` | POST | 获取交货时间段列表 |
| `/v1/fbp/order/drop-off/cancel` | POST | 取消 drop-off 交货 |
| `/v1/fbp/order/drop-off/dlv/edit` | POST | 编辑收货点的送货信息 |
| `/v1/fbp/order/drop-off/timetable` | POST | 获取接收点的营业时间表 |
| `/v1/fbp/order/pick-up/cancel` | POST | 取消上门揽收交货 |
| `/v1/fbp/order/pick-up/dlv/edit` | POST | 更改取货地点信息 |
| `/v1/fbp/act-from/create` | POST | 生成验收证明书 |
| `/v1/fbp/act-from/get` | POST | 获取验收证明书生成状态 |
| `/v1/fbp/act-to/create` | POST | 生成货物运单 |
| `/v1/fbp/act-to/get` | POST | 获取货物运单生成状态 |
| `/v1/fbp/archive/get` | POST | 获取已完成交货信息 |
| `/v1/fbp/archive/list` | POST | 获取已完成交货列表 |
| `/v1/fbp/label/create` | POST | 创建标签生成任务 |
| `/v1/fbp/label/get` | POST | 获取标签生成任务状态 |
| `/v1/fbp/order/get` | POST | 获取关于特定交货的信息 |
| `/v1/fbp/order/list` | POST | 获取交货列表 |
| `/v1/posting/fbp/list` | POST | 获取货件列表 |

### 仓库管理（Drop-off / Pick-up 时间段）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/warehouse/fbs/create/drop-off/list` | POST | 获取用于创建仓库的揽收点列表 |
| `/v1/warehouse/fbs/update/drop-off/list` | POST | 获取用于修改仓库信息的揽收点列表 |
| `/v1/warehouse/fbs/create/drop-off/timeslot/list` | POST | 获取用于创建drop-off发运仓库的时间段列表 |
| `/v1/warehouse/fbs/update/drop-off/timeslot/list` | POST | 获取用于更新drop-off发运仓库的时间段列表 |
| `/v1/warehouse/fbs/create/pick-up/timeslot/list` | POST | 获取用于创建pick-up发运仓库的时间段列表 |
| `/v1/warehouse/fbs/update/pick-up/timeslot/list` | POST | 获取用于更新pick-up发运仓库的时间段列表 |

### 未归入阶段的端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/v1/product/info/discounted` | POST | 通过减价商品的SKU查找减价商品和主商品的信息 |
| `/v1/product/info/stocks-by-warehouse/fbs` | POST | 关于卖家库存余额的信息 |
| `/v1/product/info/warehouse/stocks` | POST | 获取FBS和rFBS仓库库存信息 |
| `/v1/product/info/wrong-volume` | POST | 体积重量特征不正确的商品列表 |
| `/v1/product/prices/details` | POST | 获取商品价格的详细信息 |
| `/v1/product/related-sku/get` | POST | 获取相关SKU |
| `/v1/product/stairway-discount/by-quantity/get` | POST | 获取按数量折扣信息 |
| `/v1/product/stairway-discount/by-quantity/set` | POST | 管理按数量折扣 |
| `/v1/product/update/discount` | POST | 为打折商品设置折扣 |
| `/v1/product/visibility/info` | POST | 获取商品可见性信息 |
| `/v1/product/visibility/set` | POST | 新增了用于设置商品在Ozon和Ozon Select橱窗可见性的Beta方法。 |

## 完整端点索引（按路径字母序）

| 端点 | 方法 | 说明 | Operation ID |
|---|---|---|---|
| `/v1/actions` | GET | 活动清单 | `Promos` |
| `/v1/actions/auto-add/products/candidates` | POST | 获取可自动添加到促销活动中的商品列表 | `ActionsAutoAddProductsCandidates` |
| `/v1/actions/auto-add/products/delete` | POST | 从促销活动自动添加列表中删除商品 | `ActionsAutoAddProductsDelete` |
| `/v1/actions/auto-add/products/list` | POST | 获取促销活动自动添加列表中的商品列表 | `ActionsAutoAddProductsList` |
| `/v1/actions/auto-add/products/update` | POST | 在促销活动自动添加列表中添加或更新商品 | `ActionsAutoAddProductsUpdate` |
| `/v1/actions/candidates` | POST | 可用的促销商品清单 | `PromosCandidates` |
| `/v1/actions/discounts-task/approve` | POST | 同意折扣申请 | `promos_task_approve` |
| `/v1/actions/discounts-task/decline` | POST | 取消折扣申请 | `promos_task_decline` |
| `/v1/actions/discounts-task/list` | POST | 申请折扣列表 | `promos_task_list` |
| `/v1/actions/products` | POST | 参与&nbsp;活动的商品列表 | `PromosProducts` |
| `/v1/actions/products/activate` | POST | 在促销活动中增加一个商品 | `PromosProductsActivate` |
| `/v1/actions/products/deactivate` | POST | 从活动中删除商品 | `PromosProductsDeactivate` |
| `/v1/analytics/data` | POST | 分析数据 | `AnalyticsAPI_AnalyticsGetData` |
| `/v1/analytics/product-queries` | POST | 获取商品搜索查询信息 | `AnalyticsAPI_AnalyticsProductQueries` |
| `/v1/analytics/product-queries/details` | POST | 有关特定商品查询的信息 | `AnalyticsAPI_AnalyticsProductQueriesDetails` |
| `/v1/assembly/carriage/posting/list` | POST | 获取发运中的货件列表 | `AssemblyCarriagePostingList` |
| `/v1/assembly/carriage/product/list` | POST | 获取发运中的商品列表 | `AssemblyCarriageProductList` |
| `/v1/assembly/fbs/posting/list` | POST | 获取货件列表 | `AssemblyFbsPostingList` |
| `/v1/assembly/fbs/product/list` | POST | 获取货件中的商品列表 | `AssemblyFbsProductList` |
| `/v1/barcode/add` | POST | 为商品绑定条形码 | `add-barcode` |
| `/v1/barcode/generate` | POST | 创建商品条形码 | `generate-barcode` |
| `/v1/carriage/approve` | POST | 发运确认 | `CarriageAPI_CarriageApprove` |
| `/v1/carriage/cancel` | POST | 发运删除 | `CarriageAPI_CarriageCancel` |
| `/v1/carriage/create` | POST | 创建发运 | `CarriageAPI_CarriageCreate` |
| `/v1/carriage/get` | POST | 运输信息 | `CarriageGet` |
| `/v1/carriage/pass/create` | POST | 创建通行证 | `carriagePassCreate` |
| `/v1/carriage/pass/delete` | POST | 删除通行证 | `carriagePassDelete` |
| `/v1/carriage/pass/update` | POST | 更新通行证 | `carriagePassUpdate` |
| `/v1/carriage/set-postings` | POST | 发运组成商品更改 | `CarriageAPI_SetPostings` |
| `/v1/chat/send/file` | POST | 发送文件 | `ChatAPI_ChatSendFile` |
| `/v1/chat/send/message` | POST | 发送信息 | `ChatAPI_ChatSendMessage` |
| `/v1/chat/start` | POST | 创建新聊天 | `ChatAPI_ChatStart` |
| `/v1/delivery-method/list` | POST | 仓库物流方式清单 | `WarehouseAPI_DeliveryMethodList` |
| `/v1/description-category/attribute` | POST | 类别特征列表 | `DescriptionCategoryAPI_GetAttributes` |
| `/v1/description-category/attribute/values` | POST | 特征值指南 | `DescriptionCategoryAPI_GetAttributeValues` |
| `/v1/description-category/attribute/values/search` | POST | 根据属性的参考值进行搜索 | `DescriptionCategoryAPI_SearchAttributeValues` |
| `/v1/description-category/tips` | POST | 获取用于确定商品类目的提示 | `DescriptionCategoryTips` |
| `/v1/description-category/tree` | POST | 商品类别和类型的树形图 | `DescriptionCategoryAPI_GetTree` |
| `/v1/fbp/act-from/create` | POST | 生成验收证明书 | `FbpAPI_FbpCreateAct` |
| `/v1/fbp/act-from/get` | POST | 获取验收证明书生成状态 | `FbpAPI_FbpCheckActState` |
| `/v1/fbp/act-to/create` | POST | 生成货物运单 | `FbpAPI_FbpCreateConsignmentNote` |
| `/v1/fbp/act-to/get` | POST | 获取货物运单生成状态 | `FbpAPI_FbpCheckConsignmentNoteState` |
| `/v1/fbp/archive/get` | POST | 获取已完成交货信息 | `FbpAPI_FbpArchiveGet` |
| `/v1/fbp/archive/list` | POST | 获取已完成交货列表 | `FbpAPI_FbpArchiveList` |
| `/v1/fbp/draft/direct/create` | POST | 创建不指定配送方法的交货申请草稿 | `FbpDraftDirectCreate` |
| `/v1/fbp/draft/direct/delete` | POST | 删除交货申请草稿 | `FbpDraftDirectDelete` |
| `/v1/fbp/draft/direct/product/validate` | POST | 检查合作伙伴仓库商品列表 | `FbpDraftDirectProductValidate` |
| `/v1/fbp/draft/direct/registrate` | POST | 将草稿单转为正式交货 | `FbpDraftDirectRegistrate` |
| `/v1/fbp/draft/direct/seller-dlv/create` | POST | 创建由卖家配送的草稿 | `FbpDraftDirectSellerDlvCreate` |
| `/v1/fbp/draft/direct/seller-dlv/edit` | POST | 更新草稿中由卖家配送的信息 | `FbpDraftDirectSellerDlvEdit` |
| `/v1/fbp/draft/direct/timeslot/edit` | POST | 编辑草稿中的时间段 | `FbpDraftDirectTimeslotEdit` |
| `/v1/fbp/draft/direct/timeslot/get` | POST | 获取直供的时间段列表 | `FbpDraftDirectGetTimeslot` |
| `/v1/fbp/draft/direct/tpl-dlv/create` | POST | 创建第三方物流公司配送的申请草稿 | `FbpAPI_FbpDraftDirectTplDlvCreate` |
| `/v1/fbp/draft/direct/tpl-dlv/edit` | POST | 编辑采用第三方承运商配送方法的交货草稿 | `FbpAPI_FbpDraftDirectTplDlvEdit` |
| `/v1/fbp/draft/drop-off/create` | POST | 创建接收点配送草稿 | `FbpDraftDropOffCreate` |
| `/v1/fbp/draft/drop-off/delete` | POST | 删除接收点配送草稿 | `FbpDraftDropOffDelete` |
| `/v1/fbp/draft/drop-off/dlv/edit` | POST | 编辑接收点配送草稿的配送详情 | `FbpDraftDropOffDlvEdit` |
| `/v1/fbp/draft/drop-off/point/list` | POST | 获取省份内接收点列表 | `FbpDraftDropOffPointList` |
| `/v1/fbp/draft/drop-off/point/timetable` | POST | 获取接收点的营业时间表 | `FbpDraftDropOffPointTimetable` |
| `/v1/fbp/draft/drop-off/product/validate` | POST | 检查合作伙伴仓库可接收的商品列表 | `FbpDraftDropOffProductValidate` |
| `/v1/fbp/draft/drop-off/province/list` | POST | 获取省份列表 | `FbpDraftDropOffProvinceList` |
| `/v1/fbp/draft/drop-off/registrate` | POST | 将草稿转为正式交货 | `FbpDraftDropOffRegistrate` |
| `/v1/fbp/draft/get` | POST | 获取交货草稿信息 | `FbpAPI_FbpDraftGet` |
| `/v1/fbp/draft/list` | POST | 交货草稿列表 | `FbpAPI_FbpDraftList` |
| `/v1/fbp/draft/pick-up/create` | POST | 创建 pick-up 交货申请草稿 | `FbpAPI_FbpDraftPickupCreate` |
| `/v1/fbp/draft/pick-up/delete` | POST | 取消 pick-up 交货申请草稿 | `FbpAPI_FbpDraftPickUpDelete` |
| `/v1/fbp/draft/pick-up/dlv/edit` | POST | 修改 pick-up 交货申请 | `FbpAPI_FbpDraftPickupDlvEdit` |
| `/v1/fbp/draft/pick-up/product/validate` | POST | 验证用于 pick-up 交货的商品列表 | `FbpAPI_FbpDraftPickUpProductValidate` |
| `/v1/fbp/draft/pick-up/registrate` | POST | 将草稿单转为正式交货 | `FbpDraftPickUpRegistrate` |
| `/v1/fbp/label/create` | POST | 创建标签生成任务 | `FbpAPI_FbpCreateLabel` |
| `/v1/fbp/label/get` | POST | 获取标签生成任务状态 | `FbpAPI_FbpGetLabel` |
| `/v1/fbp/order/direct/cancel` | POST | 取消交货 | `FbpAPI_FbpOrderDirectCancel` |
| `/v1/fbp/order/direct/seller-dlv/edit` | POST | 更新卖家自配送信息 | `FbpAPI_FbpOrderDirectSellerDlvEdit` |
| `/v1/fbp/order/direct/timeslot/edit` | POST | 编辑交货申请中的时间段 | `FbpAPI_FbpEditTimeslot` |
| `/v1/fbp/order/direct/timeslot/list` | POST | 获取交货时间段列表 | `FbpAPI_FbpAvailableTimeslotList` |
| `/v1/fbp/order/drop-off/cancel` | POST | 取消 drop-off 交货 | `FbpAPI_FbpOrderDropOffCancel` |
| `/v1/fbp/order/drop-off/dlv/edit` | POST | 编辑收货点的送货信息 | `FbpAPI_FbpOrderDropOffDlvEdit` |
| `/v1/fbp/order/drop-off/timetable` | POST | 获取接收点的营业时间表 | `FbpAPI_FbpOrderDropOffTimetable` |
| `/v1/fbp/order/get` | POST | 获取关于特定交货的信息 | `FbpAPI_FbpOrderGet` |
| `/v1/fbp/order/list` | POST | 获取交货列表 | `FbpAPI_FbpOrderList` |
| `/v1/fbp/order/pick-up/cancel` | POST | 取消上门揽收交货 | `FbpAPI_FbpOrderPickUpCancel` |
| `/v1/fbp/order/pick-up/dlv/edit` | POST | 更改取货地点信息 | `FbpAPI_FbpOrderPickUpDlvEdit` |
| `/v1/fbp/warehouse/list` | POST | 获取合作伙伴仓库列表 | `FbpWarehouseList` |
| `/v1/fbs/posting/product/exemplar/update` | POST | Обновить данные экземпляров | `PostingAPI_FbsPostingProductExemplarUpdate` |
| `/v1/finance/accrual/by-day` | POST | 获取某日应计项目 | `GetFinanceAccrualByDay` |
| `/v1/finance/accrual/postings` | POST | 获取按货件统计的应计项目 | `GetFinanceAccrualPostings` |
| `/v1/finance/accrual/types` | POST | 获取应计项目参考信息 | `GetFinanceAccrualTypes` |
| `/v1/finance/balance` | POST | 获取余额报告 | `GetFinanceBalanceV1` |
| `/v1/finance/cash-flow-statement/list` | POST | 财务报告 | `FinanceAPI_FinanceCashFlowStatementList` |
| `/v1/finance/compensation` | POST | 赔偿报告 | `ReportAPI_GetCompensationReport` |
| `/v1/finance/decompensation` | POST | 赔偿返还报告 | `ReportAPI_GetDecompensationReport` |
| `/v1/finance/realization/by-day` | POST | 每日商品销售报告 | `FinanceAPI_GetRealizationByDayReportV1` |
| `/v1/finance/realization/posting` | POST | 按订单细分的商品销售报告 | `FinanceAPI_GetRealizationReportV1` |
| `/v1/pass/list` | POST | 通行证列表 | `PassList` |
| `/v1/polygon/bind` | POST | 将快递方式与快递设施联系起来 | `PolygonAPI_BindPolygon` |
| `/v1/polygon/create` | POST | 创建一个快递的设施 | `PolygonAPI_CreatePolygon` |
| `/v1/posting/carriage-available/list` | POST | 可供运输的列表 | `PostingAPI_GetCarriageAvailableList` |
| `/v1/posting/cutoff/set` | POST | 确认货件发运日期 | `PostingAPI_SetPostingCutoff` |
| `/v1/posting/fbp/get` | POST | 按标识符获取货件信息 | `GetFbpPosting` |
| `/v1/posting/fbp/list` | POST | 获取货件列表 | `PostingFbpList` |
| `/v1/posting/fbs/cancel-reason` | POST | 货运取消原因 | `PostingAPI_GetPostingFbsCancelReasonV1` |
| `/v1/posting/fbs/split` | POST | 将订单拆分为不带备货的货件 | `FbsSplit` |
| `/v1/pricing-strategy/competitors/list` | POST | 竞争对手名单 | `pricing_competitors` |
| `/v1/pricing-strategy/create` | POST | 创建策略 | `pricing_create` |
| `/v1/pricing-strategy/delete` | POST | 删除策略 | `pricing_delete` |
| `/v1/pricing-strategy/info` | POST | 策略信息 | `pricing_info` |
| `/v1/pricing-strategy/list` | POST | 策略列表 | `pricing_list` |
| `/v1/pricing-strategy/product/info` | POST | 竞争对手&nbsp; 的商品价格 | `pricing_items-info` |
| `/v1/pricing-strategy/products/add` | POST | 将商品添加到策略 | `pricing_items-add` |
| `/v1/pricing-strategy/products/delete` | POST | 从策略中删除商品 | `pricing_items-delete` |
| `/v1/pricing-strategy/products/list` | POST | 策略中的商品列表 | `pricing_items-list` |
| `/v1/pricing-strategy/status` | POST | 更改策略状态 | `pricing_status` |
| `/v1/pricing-strategy/strategy-ids-by-product-ids` | POST | 策略ID列表 | `pricing_ids` |
| `/v1/pricing-strategy/update` | POST | 更新策略 | `pricing_update` |
| `/v1/product/action/timer/status` | POST | 获取已设置计时器状态 | `ProductAPI_ActionTimerStatus` |
| `/v1/product/action/timer/update` | POST | 最低价格时效性计时器更新 | `ProductAPI_ActionTimerUpdate` |
| `/v1/product/archive` | POST | 将商品归档 | `ProductAPI_ProductArchive` |
| `/v1/product/attributes/update` | POST | 更新商品特征 | `ProductAPI_ProductUpdateAttributes` |
| `/v1/product/import-by-sku` | POST | 通过SKU创建商品 | `ProductAPI_ImportProductsBySKU` |
| `/v1/product/import/info` | POST | 查询商品添加或更新状态 | `ProductAPI_GetImportProductsInfo` |
| `/v1/product/import/prices` | POST | 更新价格 | `ProductAPI_ImportProductsPrices` |
| `/v1/product/info/description` | POST | 获取商品详细信息 | `ProductAPI_GetProductInfoDescription` |
| `/v1/product/info/discounted` | POST | 通过减价商品的SKU查找减价商品和主商品的信息 | `ProductAPI_GetProductInfoDiscounted` |
| `/v1/product/info/stocks-by-warehouse/fbs` | POST | 关于卖家库存余额的信息 | `ProductAPI_ProductStocksByWarehouseFbs` |
| `/v1/product/info/subscription` | POST | 订阅该商品的用户数 | `ProductAPI_GetProductInfoSubscription` |
| `/v1/product/info/warehouse/stocks` | POST | 获取FBS和rFBS仓库库存信息 | `ProductInfoWarehouseStocks` |
| `/v1/product/info/wrong-volume` | POST | 体积重量特征不正确的商品列表 | `ProductAPI_ProductInfoWrongVolume` |
| `/v1/product/pictures/import` | POST | 上传或更新商品图片 | `ProductAPI_ProductImportPictures` |
| `/v1/product/prices/details` | POST | 获取商品价格的详细信息 | `ProductPricesDetails` |
| `/v1/product/rating-by-sku` | POST | 按SKU获得商品的内容排名 | `ProductAPI_GetProductRatingBySku` |
| `/v1/product/related-sku/get` | POST | 获取相关SKU | `ProductAPI_ProductGetRelatedSKU` |
| `/v1/product/stairway-discount/by-quantity/get` | POST | 获取按数量折扣信息 | `ProductAPI_GetProductStairwayDiscountByQuantity` |
| `/v1/product/stairway-discount/by-quantity/set` | POST | 管理按数量折扣 | `ProductAPI_SetProductStairwayDiscountByQuantity` |
| `/v1/product/unarchive` | POST | 从档案中还原商品 | `ProductAPI_ProductUnarchive` |
| `/v1/product/update/discount` | POST | 为打折商品设置折扣 | `ProductAPI_ProductUpdateDiscount` |
| `/v1/product/update/offer-id` | POST | 从卖家的系统中改变商品货号 | `ProductAPI_ProductUpdateOfferID` |
| `/v1/product/visibility/info` | POST | 获取商品可见性信息 | `ProductVisibilityInfo` |
| `/v1/product/visibility/set` | POST | 新增了用于设置商品在Ozon和Ozon Select橱窗可见性的Beta方法。 | `ProductVisibilitySet` |
| `/v1/question/answer/create` | POST | 创建对问题的回答 | `QuestionAnswer_Create` |
| `/v1/question/answer/delete` | POST | 删除问题回答 | `QuestionAnswer_Delete` |
| `/v1/question/answer/list` | POST | 问题回答列表 | `QuestionAnswer_List` |
| `/v1/question/change_status` | POST | 更改问题状态 | `Question_ChangeStatus` |
| `/v1/question/count` | POST | 按状态统计问题数量 | `Question_Count` |
| `/v1/question/info` | POST | 问题详情 | `Question_Info` |
| `/v1/question/list` | POST | 问题列表 | `Question_List` |
| `/v1/question/top-sku` | POST | 提问数量最多的商品 | `Question_TopSku` |
| `/v1/rating/index/fbs/info` | POST | 获取错误指数：FBS 和 rFBS | `RatingAPI_GetFBSRatingIndexInfoV1` |
| `/v1/rating/index/fbs/posting/list` | POST | 影响错误指数的货件列表：FBS 和 rFBS | `RatingAPI_ListFBSRatingIndexPostingsV1` |
| `/v1/report/discounted/create` | POST | 减价商品报告 | `ReportAPI_CreateDiscountedReport` |
| `/v1/report/info` | POST | 报告信息 | `ReportAPI_ReportInfo` |
| `/v1/report/list` | POST | 报告清单 | `ReportAPI_ReportList` |
| `/v1/report/marked-products-sales/create` | POST | 生成带有标记商品的销售报告 | `CreateCompanyMarkedProductsSalesReport` |
| `/v1/report/postings/create` | POST | 发货报告 | `ReportAPI_CreateCompanyPostingsReport` |
| `/v1/report/products/create` | POST | 商品报告 | `ReportAPI_CreateCompanyProductsReport` |
| `/v1/report/realization/posting/create` | POST | 获取每订单商品销售报告 | `CreateCompanyFinanceRealizationPostingReport` |
| `/v1/report/warehouse/stock` | POST | 关于FBS仓库库存报告 | `ReportAPI_CreateStockByWarehouseReport` |
| `/v1/return/pass/create` | POST | 创建退货通行证 | `returnPassCreate` |
| `/v1/return/pass/delete` | POST | 删除退货通行证 | `returnPassDelete` |
| `/v1/return/pass/update` | POST | 更新退货通行证 | `returnPassUpdate` |
| `/v1/returns/company/fbs/info` | POST | FBS退货数量 | `returnsCompanyFBSInfo` |
| `/v1/returns/list` | POST | FBO和FBS退货信息 | `returnsList` |
| `/v1/returns/rfbs/action/set` | POST | 传递 rFBS 退货的可用操作 | `ReturnsAPI_ReturnsRfbsActionSet` |
| `/v1/review/change-status` | POST | 更改评价状态 | `ReviewAPI_ReviewChangeStatus` |
| `/v1/review/comment/create` | POST | 对评价留下评论 | `ReviewAPI_CommentCreate` |
| `/v1/review/comment/delete` | POST | 删除对评价的评论 | `ReviewAPI_CommentDelete` |
| `/v1/review/comment/list` | POST | 评价的评论列表 | `ReviewAPI_CommentList` |
| `/v1/review/count` | POST | 根据状态统计的评价数量 | `ReviewAPI_ReviewCount` |
| `/v1/review/info` | POST | 获取评价信息 | `ReviewAPI_ReviewInfo` |
| `/v1/review/list` | POST | 获取评价列表 | `ReviewAPI_ReviewList` |
| `/v1/roles` | POST | 使用API密钥获取角色和方式列表 | `AccessAPI_RolesByToken` |
| `/v1/search-queries/text` | POST | 获取按文本筛选的搜索查询列表 | `SearchQueriesAPI_SearchQueriesText` |
| `/v1/search-queries/top` | POST | 获取热门搜索查询列表 | `SearchQueriesAPI_SearchQueriesTop` |
| `/v1/seller-actions/archive` | POST | 将促销活动归档 | `SellerActionsArchive` |
| `/v1/seller-actions/change-activity` | POST | 启用或关闭活动 | `SellerActionsChangeActivity` |
| `/v1/seller-actions/create/discount` | POST | 创建采用"折扣"机制的促销活动 | `SellerActionsCreateDiscount` |
| `/v1/seller-actions/create/discount-with-condition` | POST | 创建采用"基于订单总额的折扣"机制的促销活动 | `SellerActionsCreateDiscountWithCondition` |
| `/v1/seller-actions/create/installment` | POST | 创建采用"免息分期付款"机制的促销活动 | `SellerActionsCreateInstallment` |
| `/v1/seller-actions/create/multi-level-discount` | POST | 创建采用"多级满额折扣"机制的促销活动 | `SellerActionsCreateMultiLevelDiscount` |
| `/v1/seller-actions/create/voucher` | POST | 创建采用"促销码折扣"机制的促销活动 | `SellerActionsCreateVoucher` |
| `/v1/seller-actions/list` | POST | 获取促销活动列表 | `SellerActionsList` |
| `/v1/seller-actions/products/add` | POST | 将商品添加到促销活动中 | `SellerActionsProductsAdd` |
| `/v1/seller-actions/products/candidates` | POST | 获取促销活动可用商品列表 | `SellerActionsProductsCandidates` |
| `/v1/seller-actions/products/delete` | POST | 从促销活动中移除商品 | `SellerActionsProductsDelete` |
| `/v1/seller-actions/products/list` | POST | 获取参与活动的商品列表 | `SellerActionsProductsList` |
| `/v1/seller-actions/update/discount` | POST | 更新“折扣”机制的促销活动 | `SellerActionsUpdateDiscount` |
| `/v1/seller-actions/update/discount-with-condition` | POST | 更新“基于订单总额的折扣”机制的促销活动 | `SellerActionsUpdateDiscountWithCondition` |
| `/v1/seller-actions/update/installment` | POST | 更新“免息分期付款”机制的促销活动 | `SellerActionsUpdateInstallment` |
| `/v1/seller-actions/update/multi-level-discount` | POST | 更新“多级满额折扣”机制的促销活动 | `SellerActionsUpdateMultiLevelDiscount` |
| `/v1/seller-actions/update/voucher` | POST | 更新“促销码折扣”机制的促销活动 | `SellerActionsUpdateVoucher` |
| `/v1/seller-actions/voucher/get` | POST | 获取CSV格式的促销码文件 | `SellerActionsVoucherGet` |
| `/v1/seller/info` | POST | 卖家个人中心信息 | `SellerAPI_SellerInfo` |
| `/v1/seller/ozon-logistics/info` | POST | Ozon配送开通信息 | `SellerAPI_SellerOzonLogisticsInfo` |
| `/v1/supply-order/bundle` | POST | 交货或交货申请的商品组成 | `SupplyOrderBundle` |
| `/v1/warehouse/archive` | POST | 将仓库归档 | `ArchiveWarehouseFBS` |
| `/v1/warehouse/fbs/create` | POST | 创建仓库 | `WarehouseAPI_CreateWarehouseFBS` |
| `/v1/warehouse/fbs/create/drop-off/list` | POST | 获取用于创建仓库的揽收点列表 | `WarehouseAPI_ListDropOffPointsForCreateFBSWarehouse` |
| `/v1/warehouse/fbs/create/drop-off/timeslot/list` | POST | 获取用于创建drop-off发运仓库的时间段列表 | `WarehouseFbsCreateDropOffTimeslotList` |
| `/v1/warehouse/fbs/create/pick-up/timeslot/list` | POST | 获取用于创建pick-up发运仓库的时间段列表 | `WarehouseFbsCreatePickUpTimeslotList` |
| `/v1/warehouse/fbs/first-mile/update` | POST | 更新头程物流 | `UpdateWarehouseFBSFirstMile` |
| `/v1/warehouse/fbs/update` | POST | 更新仓库 | `UpdateWarehouseFBS` |
| `/v1/warehouse/fbs/update/drop-off/list` | POST | 获取用于修改仓库信息的揽收点列表 | `WarehouseAPI_ListDropOffPointsForUpdateFBSWarehouse` |
| `/v1/warehouse/fbs/update/drop-off/timeslot/list` | POST | 获取用于更新drop-off发运仓库的时间段列表 | `WarehouseFbsUpdateDropOffTimeslotList` |
| `/v1/warehouse/fbs/update/pick-up/timeslot/list` | POST | 获取用于更新pick-up发运仓库的时间段列表 | `WarehouseFbsUpdatePickUpTimeslotList` |
| `/v1/warehouse/invalid-products/get` | POST | 获取配送受限商品列表 | `WarehouseInvalidProductsGet` |
| `/v1/warehouse/list` | POST | 仓库清单 | `WarehouseAPI_WarehouseList` |
| `/v1/warehouse/operation/status` | POST | 获取操作状态 | `GetWarehouseFBSOperationStatus` |
| `/v1/warehouse/unarchive` | POST | 将仓库解除归档 | `UnarchiveWarehouseFBS` |
| `/v1/warehouse/warehouses-with-invalid-products` | POST | 获取含有配送受限商品的仓库列表 | `WarehouseWithInvalidProducts` |
| `/v2/actions/discounts-task/list` | POST | 获取折扣申请列表 | `GetDiscountTaskListV2` |
| `/v2/chat/read` | POST | 将信息标记为已读 | `ChatAPI_ChatReadV2` |
| `/v2/conditional-cancellation/approve` | POST | 确认 rFBS 取消申请 | `CancellationAPI_ConditionalCancellationApproveV2` |
| `/v2/conditional-cancellation/list` | POST | 获取 rFBS 取消申请列表 | `CancellationAPI_GetConditionalCancellationListV2` |
| `/v2/conditional-cancellation/reject` | POST | 拒绝 rFBS 取消申请 | `CancellationAPI_ConditionalCancellationRejectV2` |
| `/v2/delivery-method/list` | POST | realFBS仓库的配送方式列表 | `WarehouseAPI_DeliveryMethodListV2` |
| `/v2/fbs/posting/delivered` | POST | 将状态改成“已送达” | `PostingAPI_FbsPostingDelivered` |
| `/v2/fbs/posting/delivering` | POST | 将状态改成“运输中” | `PostingAPI_FbsPostingDelivering` |
| `/v2/fbs/posting/last-mile` | POST | 状态改为“最后一英里” | `PostingAPI_FbsPostingLastMile` |
| `/v2/fbs/posting/tracking-number/set` | POST | 添加跟踪号 | `PostingAPI_FbsPostingTrackingNumberSet` |
| `/v2/finance/realization` | POST | 商品销售报告 （第2版） | `FinanceAPI_GetRealizationReportV2` |
| `/v2/posting/fbs/act/get-container-labels` | POST | 货位标签 | `PostingAPI_PostingFBSActGetContainerLabels` |
| `/v2/posting/fbs/act/get-postings` | POST | 单据中的货件列表 | `PostingAPI_ActPostingList` |
| `/v2/posting/fbs/awaiting-delivery` | POST | 货件装运 | `PostingAPI_MoveFbsPostingToAwaitingDelivery` |
| `/v2/posting/fbs/cancel` | POST | 取消货运 | `PostingAPI_CancelFbsPosting` |
| `/v2/posting/fbs/cancel-reason/list` | POST | 货件取消原因 | `PostingAPI_GetPostingFbsCancelReasonList` |
| `/v2/posting/fbs/get-by-barcode` | POST | 按条形码获取有关货件的信息 | `PostingAPI_GetFbsPostingByBarcode` |
| `/v2/posting/fbs/package-label` | POST | 打印标签 | `PostingAPI_PostingFBSPackageLabel` |
| `/v2/posting/fbs/product/cancel` | POST | 取消某些商品发货 | `PostingAPI_CancelFbsPostingProduct` |
| `/v2/posting/fbs/product/country/list` | POST | 可用产地名单 | `PostingAPI_ListCountryProductFbsPostingV2` |
| `/v2/posting/fbs/product/country/set` | POST | 添加商品产地信息 | `PostingAPI_SetCountryProductFbsPostingV2` |
| `/v2/product/info/stocks-by-warehouse/fbs` | POST | 获取卖家仓库库存信息 | `GetProductInfoStocksByWarehouseFbsV2` |
| `/v2/product/pictures/info` | POST | 获取商品图片 | `ProductAPI_ProductInfoPicturesV2` |
| `/v2/products/delete` | POST | 从存档删除没有SKU的商品 | `ProductAPI_DeleteProducts` |
| `/v2/products/stocks` | POST | 更新库存商品的数量 | `ProductAPI_ProductsStocksV2` |
| `/v2/returns/rfbs/compensate` | POST | 退还部分商品金额 | `RFBSReturnsAPI_ReturnsRfbsCompensateV2` |
| `/v2/returns/rfbs/get` | POST | 退货申请信息 | `RFBSReturnsAPI_ReturnsRfbsGetV2` |
| `/v2/returns/rfbs/list` | POST | 退货申请列表 | `RFBSReturnsAPI_ReturnsRfbsListV2` |
| `/v2/returns/rfbs/receive-return` | POST | 确认收到待检查商品 | `RFBSReturnsAPI_ReturnsRfbsReceiveReturnV2` |
| `/v2/returns/rfbs/reject` | POST | 拒绝退货申请 | `RFBSReturnsAPI_ReturnsRfbsRejectV2` |
| `/v2/returns/rfbs/return-money` | POST | 向买家退款 | `RFBSReturnsAPI_ReturnsRfbsReturnMoneyV2` |
| `/v2/returns/rfbs/verify` | POST | 批准退货申请 | `RFBSReturnsAPI_ReturnsRfbsVerifyV2` |
| `/v2/review/list` | POST | 获取评价列表 | `ReviewListV2` |
| `/v2/warehouse/list` | POST | 仓库列表 | `WarehouseListV2` |
| `/v3/chat/history` | POST | 聊天历史记录 | `ChatAPI_ChatHistoryV3` |
| `/v3/chat/list` | POST | 聊天清单 | `ChatAPI_ChatListV3` |
| `/v3/finance/transaction/list` | POST | 交易清单 | `FinanceAPI_FinanceTransactionListV3` |
| `/v3/finance/transaction/totals` | POST | 清单数目 | `FinanceAPI_FinanceTransactionTotalV3` |
| `/v3/posting/fbs/get` | POST | 按照ID获取货件信息 | `PostingAPI_GetFbsPostingV3` |
| `/v3/posting/fbs/list` | POST | 货件列表 | `PostingAPI_GetFbsPostingListV3` |
| `/v3/posting/fbs/unfulfilled/list` | POST | 未处理货件列表 | `PostingAPI_GetFbsPostingUnfulfilledList` |
| `/v3/product/import` | POST | 创建或更新商品 | `ProductAPI_ImportProductsV3` |
| `/v3/product/info/list` | POST | 根据标识符获取商品信息 | `ProductAPI_GetProductInfoList` |
| `/v3/product/list` | POST | 品列表的 | `ProductAPI_GetProductList` |
| `/v4/posting/fbs/list` | POST | 获取货件列表 | `PostingFbsList` |
| `/v4/posting/fbs/ship` | POST | 搜集订单 (第4方案) | `PostingAPI_ShipFbsPostingV4` |
| `/v4/posting/fbs/ship/package` | POST | 货件的部分装配 (第4方案) | `PostingAPI_ShipFbsPostingPackage` |
| `/v4/posting/fbs/unfulfilled/list` | POST | 获取未处理货件列表 | `PostingFbsUnfulfilledList` |
| `/v4/product/info/attributes` | POST | 获取商品特征描述 | `ProductAPI_GetProductAttributesV4` |
| `/v4/product/info/limit` | POST | 品类限制、商品的创建和更新 | `ProductAPI_GetUploadQuota` |
| `/v4/product/info/stocks` | POST | 关于商品数量的信息 | `ProductAPI_GetProductInfoStocks` |
| `/v5/fbs/posting/product/exemplar/status` | POST | 获取样件添加状态 | `PostingAPI_FbsPostingProductExemplarStatusV5` |
| `/v5/fbs/posting/product/exemplar/validate` | POST | 标志代码验证 | `PostingAPI_FbsPostingProductExemplarValidateV5` |
| `/v5/product/info/prices` | POST | 获取商品价格信息 | `ProductAPI_GetProductInfoPrices` |
| `/v6/fbs/posting/product/exemplar/create-or-get` | POST | 获取已创建样件数据 | `PostingAPI_FbsPostingProductExemplarCreateOrGetV6` |
| `/v6/fbs/posting/product/exemplar/set` | POST | 检查并保存份数数据 | `PostingAPI_FbsPostingProductExemplarSetV6` |