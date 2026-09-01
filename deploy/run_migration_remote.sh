#!/usr/bin/env bash
set -euo pipefail
cd /srv/ozon-erp
rm -f migration/import.log migration/import.exit
nohup docker run --rm --network host --env-file /srv/ozon-erp/.env \
  -e PYTHONPATH=/app/backend -v /srv/ozon-erp:/app -w /app \
  --entrypoint python mvp-skeleton-backend:latest -u \
  /app/migration/migrate_sqlite_to_postgres.py /app/migration/ozon_erp_20260830-222132.sqlite \
  > migration/import.log 2>&1
echo $? > migration/import.exit
