"""One-time verified copy from the Ozon SQLite backup into an empty PostgreSQL database."""
import sqlite3
import sys
import os
from collections import OrderedDict

import psycopg
from psycopg import sql

source_path = sys.argv[1]
database_url = sys.argv[2] if len(sys.argv) > 2 else os.environ["DATABASE_URL"]
database_url = database_url.replace("postgresql+psycopg://", "postgresql://", 1)
source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
source.row_factory = sqlite3.Row

with psycopg.connect(database_url) as target:
    target.autocommit = False
    with target.cursor() as cursor:
        cursor.execute("SET session_replication_role = replica")
        cursor.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        target_tables = {row[0] for row in cursor.fetchall()}
        source_tables = [row[0] for row in source.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )]
        tables = [name for name in source_tables if name in target_tables and name != "alembic_version"]
        if not tables:
            raise RuntimeError("no common source/target tables")
        cursor.execute(sql.SQL("TRUNCATE TABLE {} RESTART IDENTITY CASCADE").format(
            sql.SQL(", ").join(map(sql.Identifier, tables))
        ))
        expected = OrderedDict()
        for table in tables:
            source_columns = [row[1] for row in source.execute(f'PRAGMA table_info("{table}")')]
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s "
                "ORDER BY ordinal_position",
                (table,),
            )
            target_columns = {row[0] for row in cursor.fetchall()}
            # SQLite may contain retired audit/timestamp columns that are no
            # longer part of the current SQLAlchemy model.  Copy the shared
            # schema only; PostgreSQL supplies defaults for newer columns.
            columns = [column for column in source_columns if column in target_columns]
            if not columns:
                raise RuntimeError(f"no shared columns for {table}")
            expected[table] = source.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            if not expected[table]:
                continue
            statement = sql.SQL("COPY {} ({}) FROM STDIN").format(
                sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, columns))
            )
            with cursor.copy(statement) as copy:
                if table == "ozon_global_category_cache":
                    # Old SQLite data predates the global-cache uniqueness
                    # constraint.  Keep the newest cache entry per Ozon
                    # category/type pair; the older duplicate cannot carry a
                    # different current dictionary contract.
                    rows = source.execute(
                        'WITH latest AS (SELECT category_id, type_id, MAX(id) AS id '
                        'FROM "ozon_global_category_cache" GROUP BY category_id, type_id) '
                        'SELECT t.* FROM "ozon_global_category_cache" AS t '
                        'JOIN latest AS l ON l.id = t.id'
                    )
                    expected[table] = source.execute(
                        'SELECT COUNT(*) FROM (SELECT category_id, type_id FROM "ozon_global_category_cache" '
                        'GROUP BY category_id, type_id)'
                    ).fetchone()[0]
                else:
                    rows = source.execute(f'SELECT * FROM "{table}"')
                for row in rows:
                    copy.write_row(tuple(row[column] for column in columns))
            cursor.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
            actual = cursor.fetchone()[0]
            if actual != expected[table]:
                raise RuntimeError(f"count mismatch {table}: {actual} != {expected[table]}")
            print(f"{table}: {actual}", flush=True)
        for table in tables:
            columns = {row[1] for row in source.execute(f'PRAGMA table_info("{table}")')}
            if "id" in columns:
                cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", (table,))
                sequence = cursor.fetchone()[0]
                if sequence:
                    cursor.execute(sql.SQL("SELECT setval({}, COALESCE((SELECT MAX(id) FROM {}), 1), true)").format(
                        sql.Literal(sequence), sql.Identifier(table)
                    ))
        cursor.execute("SET session_replication_role = origin")
    target.commit()

print("migration completed and row counts verified")
