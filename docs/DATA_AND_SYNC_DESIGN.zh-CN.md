# 数据库与 Ozon 同步设计

## 技术选择

- API：FastAPI。
- 开发环境：SQLite；生产环境：PostgreSQL 16。
- 任务：独立 worker（后续可使用 Redis 队列）；API 请求不直接承担长时间同步。
- 金额：`Decimal`，币种固定为 `CNY`。

## 核心表

| 表 | 关键字段 | 目的 |
|---|---|---|
| `shops` | id、name、currency、timezone、状态 | 店铺与数据隔离根节点 |
| `warehouses` | shop_id、ozon_warehouse_id、截单时间 | FBS 履约仓库 |
| `products` / `skus` | shop_id、offer_id、ozon_product_id | 商品与 Ozon 映射 |
| `inventory_balances` | shop_id、warehouse_id、sku_id、on_hand、reserved | 可售与预占库存 |
| `fbs_postings` / `posting_lines` | shop_id、posting_number、raw_status、pack_by | 订单履约状态 |
| `sync_runs` | shop_id、resource、cursor、状态、开始/结束时间、错误摘要 | 每次同步可追踪、可重试 |
| `price_policies` / `price_calculations` | shop_id、sku_id、CNY 价格 | 定价与利润保护 |
| `promotion_decisions` / `audit_events` | shop_id、操作人、前后值 | 营销审批与操作追溯 |

所有业务表必须有 `shop_id` 和 `created_at`/`updated_at`。店铺删除采用停用和归档，不直接删除历史订单、审计和同步记录。

## 同步流程

```text
运营员点击“同步”或定时器触发
  → 创建 sync_run（running）
  → 仅通过 OzonSellerClient 拉取一页数据
  → 校验字段并按 shop_id 幂等 upsert
  → 保存 cursor 和统计数
  → 完成（succeeded）或记录可读错误（failed）
```

1. 商品先同步，建立 `offer_id`、Ozon 商品 ID 和 SKU 映射。
2. 再同步 FBS 订单；新订单创建库存预占，取消订单释放预占。
3. 单店铺、单资源同一时刻只允许一个运行中的同步，避免游标与库存冲突。
4. 所有同步初期为只读；价格、库存、活动、发货等写回操作后置，并要求审批/审计。

## 凭据

数据库仅保存密钥引用或加密密文，绝不保存明文 API Key。生产 worker 运行时从密钥服务或环境变量读取加密主密钥；开发环境首次保存凭据时会创建 Git 忽略的本机 `.local-secrets/credential-fernet.key`。日志、HTTP 错误和前端响应都不得包含密钥。
