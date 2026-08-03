# Ozon ERP backend MVP

FastAPI service for store management. It includes `Shop`, `Warehouse`, and
`ApiCredential` SQLAlchemy models plus CRUD endpoints for stores.

The ERP interface and operating terminology are Chinese (`zh-CN`). The only
permitted shop settlement/listing currency in this MVP is CNY.

## Security

The application reads configuration only from environment variables. Do not put
Ozon API keys in source control. `ApiCredential` deliberately stores only key
identifiers and an encrypted-secret placeholder; no API endpoint accepts or
returns plaintext secrets in this MVP.

To add a shop in the UI, use the same fields as the supplied `ozonapi.txt` and
Ozon Seller API: **店铺名称**, **Client ID** (the numeric `id`) and **API Key**
(the `key`). The API Key is accepted only by the write-only credential endpoint
and stored encrypted at rest; it is never returned to the browser.

For a runtime integration worker, inject credentials from a secret manager or
local environment (example placeholders only):

```powershell
$env:OZON_CLIENT_ID = "your-client-id"
$env:OZON_API_KEY = "your-api-key"
$env:ERP_CREDENTIAL_ENCRYPTION_KEY = "generate-a-fernet-key-before-starting"
```

`OzonSellerClient` accepts those values as constructor arguments; it does not
read secret files. Its available methods are read-only product and FBS posting
lists. The obsolete `warehouse/list` endpoint is intentionally not implemented.

## Run

正式环境使用 PostgreSQL；仓库根目录提供 `compose.yaml` 作为本地 PostgreSQL 开发实例。先在仓库根目录运行：

```powershell
docker compose up -d postgres
$env:DATABASE_URL = "postgresql+psycopg://ozon_erp:change-me-local@127.0.0.1:5432/ozon_erp"
$env:PYTHONPATH = "backend"
alembic upgrade head
```

然后从 `backend` 目录启动 API：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

SQLite 仅用于单机开发和测试：`$env:DATABASE_URL = "sqlite:///./ozon_erp.db"`。正式部署不得使用 SQLite。

Open `http://127.0.0.1:8000/docs` for Swagger UI.

## API

- `GET /health`
- `POST /api/v1/shops`
- `GET /api/v1/shops`
- `GET /api/v1/shops/{shop_id}`
- `PATCH /api/v1/shops/{shop_id}`
- `DELETE /api/v1/shops/{shop_id}`
- `PUT /api/v1/shops/{shop_id}/credentials/ozon` (write-only Client ID + API Key)
- `GET /api/v1/shops/{shop_id}/credentials/ozon` (safe configuration status)
- `POST /api/v1/shops/{shop_id}/sync/products` (read-only product sync)
- `POST /api/v1/shops/{shop_id}/sync/fbs-postings` (read-only FBS posting sync)
- `POST /api/v1/shops/{shop_id}/auto-sync` (local-first, five-minute incremental correction trigger)
- `GET /api/v1/shops/{shop_id}/sync-runs` (safe sync history)

业务页面始终读取本地数据库。选择店铺或切换左侧页面时，前端自动请求 `auto-sync`；后端根据 `sync_states` 判断资源是否仍在 5 分钟有效期内，并用租约避免重复任务。商品使用持久化滚动分页游标，FBS 订单使用最近成功窗口减 10 分钟的重叠校正。普通使用无需点击同步；“强制校正”仅用于人工完整检查。

Before the first store connection, set a real `ERP_CREDENTIAL_ENCRYPTION_KEY`
in the backend process environment for production. In local development the
backend automatically creates `.local-secrets/credential-fernet.key` (ignored
by Git) on first credential save, so the UI can work without manual setup.
Never copy this development fallback into production.

Example create request:

```json
{
  "name": "Demo Store",
  "legal_entity": "Demo Trading LLC",
  "currency": "CNY",
  "timezone": "Asia/Shanghai",
  "manager_name": "Operations",
  "is_active": true
}
```
