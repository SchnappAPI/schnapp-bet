"""
Regenerate database/<schema>/bootstrap.sql from the live SQL Server container.

Reconstruction of the original /tmp/gen_ddl.py (lost to a /tmp wipe; see
.claude/skills/regenerate-bootstrap-sql/SKILL.md). Emits bare CREATE TABLE
statements (--target-empty-db) matching the committed bootstrap.sql format:
tables alphabetical, columns by ordinal, bracketed identifiers, PK constraint
inline, nonclustered indexes as CREATE INDEX lines directly after the table.

Env: SQL_SERVER, SQL_DATABASE, SQL_USERNAME, SQL_PASSWORD, SQL_TARGET_SCHEMA.
Output: stdout.
"""

import os
import sys
from datetime import date

import pyodbc


def connect():
    conn_str = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={os.environ['SQL_SERVER']};"
        f"DATABASE={os.environ['SQL_DATABASE']};"
        f"UID={os.environ['SQL_USERNAME']};"
        f"PWD={os.environ['SQL_PASSWORD']};"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str)


def format_type(row):
    t = row.DATA_TYPE.upper()
    if t in ("VARCHAR", "CHAR", "NVARCHAR", "NCHAR", "VARBINARY", "BINARY"):
        length = row.CHARACTER_MAXIMUM_LENGTH
        return f"{t}(MAX)" if length == -1 else f"{t}({length})"
    if t in ("DECIMAL", "NUMERIC"):
        return f"{t}({row.NUMERIC_PRECISION},{row.NUMERIC_SCALE})"
    return t


def column_line(row, defaults):
    parts = [f"[{row.COLUMN_NAME}]", format_type(row)]
    default = defaults.get(row.COLUMN_NAME)
    if default is not None:
        parts.append(f"DEFAULT {default}")
    if row.IS_NULLABLE == "NO":
        parts.append("NOT NULL")
    return "    " + " ".join(parts)


def main():
    if "--target-empty-db" not in sys.argv:
        sys.exit("Refusing to run without --target-empty-db (bare CREATE TABLE output).")

    schema = os.environ["SQL_TARGET_SCHEMA"]
    cn = connect()
    cur = cn.cursor()

    cur.execute(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        schema,
    )
    tables = [r.TABLE_NAME for r in cur.fetchall()]

    out = [f"-- Generated {date.today().isoformat()}. Apply in order: common/odds schemas first, then sport schemas."]

    for table in tables:
        cur.execute(
            "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, "
            "NUMERIC_SCALE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            schema,
            table,
        )
        columns = cur.fetchall()

        cur.execute(
            "SELECT c.name AS col, dc.definition AS defn "
            "FROM sys.default_constraints dc "
            "JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id "
            "WHERE dc.parent_object_id = OBJECT_ID(?)",
            f"{schema}.{table}",
        )
        defaults = {r.col: r.defn for r in cur.fetchall()}

        cur.execute(
            "SELECT i.name AS index_name, i.is_primary_key, c.name AS col "
            "FROM sys.indexes i "
            "JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id "
            "JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id "
            "WHERE i.object_id = OBJECT_ID(?) AND i.type > 0 AND ic.is_included_column = 0 "
            "ORDER BY i.index_id, ic.key_ordinal",
            f"{schema}.{table}",
        )
        pk_name, pk_cols, indexes = None, [], {}
        for r in cur.fetchall():
            if r.is_primary_key:
                pk_name = r.index_name
                pk_cols.append(r.col)
            else:
                indexes.setdefault(r.index_name, []).append(r.col)

        lines = [f"\nCREATE TABLE [{schema}].[{table}] ("]
        body = [column_line(r, defaults) for r in columns]
        if pk_name:
            # System-generated PK names (PK__table__hex) are container-specific;
            # emit the stable PK_<table> form the committed file uses.
            name = pk_name if not pk_name.startswith("PK__") else f"PK_{table}"
            cols = ", ".join(f"[{c}]" for c in pk_cols)
            body.append(f"    CONSTRAINT [{name}] PRIMARY KEY ({cols})")
        lines.append(",\n".join(body))
        lines.append(");")
        for name, cols in sorted(indexes.items()):
            col_list = ", ".join(f"[{c}]" for c in cols)
            lines.append(f"CREATE INDEX [{name}] ON [{schema}].[{table}] ({col_list});")
        out.append("\n".join(lines))

    print("\n".join(out))


if __name__ == "__main__":
    main()
