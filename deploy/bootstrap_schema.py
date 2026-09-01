"""Apply the versioned database schema before starting the API.

PostgreSQL production databases must never be initialized with
``Base.metadata.create_all``.  Running Alembic here keeps this one-shot helper
consistent with the long-running deployment entrypoint and makes it safe to
rerun after a restart.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config


root = Path(__file__).resolve().parents[1]
config = Config(str(root / "alembic.ini"))
config.set_main_option("prepend_sys_path", str(root / "backend"))
command.upgrade(config, "head")
print("ozon schema migrated to Alembic head")
