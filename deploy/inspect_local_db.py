import sqlite3
import sys

path = sys.argv[1]
db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
print("integrity", db.execute("PRAGMA integrity_check").fetchone()[0])
tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
print("tables", len(tables))
for table in tables:
    quoted = '"' + table.replace('"', '""') + '"'
    print(table, db.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0])
