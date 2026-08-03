# Ozon FBS ERP — MVP architecture

## Boundaries

All business data belongs to exactly one `shop`. A shop owns its Ozon Seller API credential, FBS warehouses, products, inventory, postings, price policies, promotions and audit records. Cross-shop views are read-only aggregates for authorized managers. The product language is Chinese (`zh-CN`) and the supported ERP/listing currency is CNY only.

## Core entities

`Shop` → `Warehouse` → `InventoryBalance` ← `Sku` ← `Product`.

`Shop` → `FbsPosting` → `PostingLine` → `Sku`.

`Shop` → `PricePolicy` → `PriceCalculation` → `PromotionDecision` → `AuditEvent`.

## Ozon integration seam

`OzonSellerClient` is the only adapter allowed to call Ozon. It obtains `Client-Id` and `Api-Key` from a secrets provider at runtime; credentials must not appear in source, logs, tests or repository history.

Initial API coverage, pending verification against the current official Seller API reference:

- Product discovery: `POST /v3/product/info/list`
- FBS postings: `POST /v3/posting/fbs/list`, `POST /v3/posting/fbs/get`, `POST /v3/posting/fbs/unfulfilled/list`
- Category tree: `POST /v1/description-category/tree`

### Compatibility note

On 2026-08-03, a credentialed **read-only** request to `POST /v1/warehouse/list` returned Ozon error code 9, `obsolete method cannot be used`. Do not implement this legacy endpoint. Before adding warehouse synchronization, locate the replacement method in the current Seller API reference and add an adapter contract test. No business-writing API calls were made during this validation.

Every sync records cursor, start/end time, outcome and retryable error class. Mutating Ozon calls require an explicit service method and audit event. The current official reference is [Ozon Seller API](https://docs.ozon.ru/api/seller/); the local exported documentation is not authoritative.

## FBS status policy

Keep raw Ozon status alongside the normalized ERP status. Valid internal forward flow is `new → awaiting_packaging → awaiting_deliver → delivering → delivered`; cancellation is allowed only before delivery. The adapter maps current Ozon status names rather than assuming them.

## Marketing guardrail

A promotion is eligible only when its proposed price is not below SKU `min_price` and projected profit rate meets the shop policy. Any override requires a named approver and an immutable audit record.

## First integration test

Use a dedicated test shop from local environment variables to issue one read-only request and confirm authentication. Do not execute price, inventory, promotion or fulfilment mutations during credential validation.
