#!/usr/bin/env bash
set -euo pipefail
cd /srv/ozon-erp

pg_container="$(docker ps -aq --filter ancestor=docker.m.daocloud.io/library/postgres:16 | head -n 1)"
dbpass="$(docker inspect "$pg_container" 2>/dev/null | grep -o 'POSTGRES_PASSWORD=[A-Za-z0-9]*' | head -n 1 | cut -d= -f2)"
if [ -z "$dbpass" ]; then
  dbpass="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | cut -d n -f1)"
fi
test -n "$dbpass"
cp env.production.template .env
fernet="$(openssl rand -base64 32 | tr '/+' '_-' | tr -d '=')"
sed -i "s|CHANGE_DB_PASSWORD|${dbpass}|g; s|CHANGE_FERNET_KEY|${fernet}|" .env
chmod 600 .env

export POSTGRES_PASSWORD="$dbpass"
# PostgreSQL was already started separately; do not ask docker-compose 1.29 to
# recreate it because that old client cannot inspect newer image metadata.
docker rm -f ozon-erp-backend 2>/dev/null || true
docker run -d --name ozon-erp-backend --restart unless-stopped --network host \
  --env-file /srv/ozon-erp/.env -e PYTHONPATH=/app/backend \
  -v /srv/ozon-erp:/app -w /app \
  --entrypoint /bin/sh mvp-skeleton-backend:latest \
  /app/deploy/start_backend.sh
sleep 3
curl -fsS http://127.0.0.1:8010/health
