#!/usr/bin/env sh
set -eu

cd /app
export PYTHONPATH="/app/backend${PYTHONPATH:+:${PYTHONPATH}}"

# Apply only versioned, additive migrations.  The API itself deliberately does
# not call SQLAlchemy create_all in PostgreSQL production mode.
alembic upgrade head
exec python -m uvicorn app.main:app --host "${UVICORN_HOST:-127.0.0.1}" --port "${UVICORN_PORT:-8010}" --workers "${UVICORN_WORKERS:-1}"
