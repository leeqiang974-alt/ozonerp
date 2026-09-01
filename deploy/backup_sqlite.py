import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists():
    raise SystemExit(f"backup target already exists: {target}")

source_db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
target_db = sqlite3.connect(target)
try:
    source_db.backup(target_db, pages=2048, sleep=0.05)
    print(target)
finally:
    target_db.close()
    source_db.close()
