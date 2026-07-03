# shared/db.py
import os
import time
from sqlalchemy import create_engine, text


def _build_conn_str():
    trust = os.environ.get("SQL_TRUST_CERT", "no")
    return (
        f"mssql+pyodbc://{os.environ['SQL_USERNAME']}:"
        f"{os.environ['SQL_PASSWORD']}@"
        f"{os.environ['SQL_SERVER']}/"
        f"{os.environ['SQL_DATABASE']}"
        "?driver=ODBC+Driver+18+for+SQL+Server"
        f"&Encrypt=yes&TrustServerCertificate={trust}"
    )


def get_engine(max_retries=3, retry_wait=45):
    """
    Returns a SQLAlchemy engine with fast_executemany=True.
    Use for all normal upserts where column widths are numeric or
    short fixed-width strings that pandas infers correctly.
    """
    engine = create_engine(_build_conn_str(), fast_executemany=True)
    for i in range(max_retries):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return engine
        except Exception:
            if i == max_retries - 1:
                raise
            time.sleep(retry_wait)


def get_engine_slow(max_retries=3, retry_wait=45):
    """
    Returns a SQLAlchemy engine with fast_executemany=False.

    Use when inserting into staging tables that contain long VARCHAR columns
    (e.g. mlb.play_by_play description fields). fast_executemany=True causes
    pyodbc to pre-calculate buffer sizes from the first row in each batch and
    ignores SQLAlchemy dtype overrides, producing right-truncation errors when
    a later row in the same batch contains a longer string.

    Also required for NVARCHAR(MAX) columns (see grading engine notes).
    """
    engine = create_engine(_build_conn_str(), fast_executemany=False)
    for i in range(max_retries):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return engine
        except Exception:
            if i == max_retries - 1:
                raise
            time.sleep(retry_wait)


def record_workflow_run(workflow_name: str) -> None:
    """
    Upsert a completion timestamp into common.workflow_runs.

    Creates the table on first call (idempotent). One row per workflow_name;
    completed_at is set to the current DB server time (UTC) via SYSDATETIMEOFFSET().

    Call this at the end of any workflow step that writes data the UI displays,
    so the front-end can show when each data source was last refreshed.
    """
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("""
            IF OBJECT_ID('common.workflow_runs', 'U') IS NULL
            CREATE TABLE common.workflow_runs (
                workflow_name VARCHAR(100) NOT NULL PRIMARY KEY,
                completed_at  DATETIMEOFFSET NOT NULL
            )
        """))
        conn.execute(text("""
            MERGE common.workflow_runs AS t
            USING (SELECT :name AS workflow_name) AS s
            ON t.workflow_name = s.workflow_name
            WHEN MATCHED THEN
                UPDATE SET t.completed_at = SYSDATETIMEOFFSET()
            WHEN NOT MATCHED THEN
                INSERT (workflow_name, completed_at)
                VALUES (:name, SYSDATETIMEOFFSET());
        """), {"name": workflow_name})


def upsert(engine, df, schema, table, keys, dtype=None, source_workflow=None):
    """
    Upsert a DataFrame into a permanent table using a SQL Server MERGE statement.

    Tables registered in shared.integrity.CRITICAL_FIELDS are passed through
    validate_and_filter first (Layer 1/2, ADR-20260424-2): invalid rows are
    quarantined instead of written. Unregistered tables pass through
    unchanged, so this stays pure infrastructure — the policy lives in the
    catalog, not here.

    dtype (optional): dict mapping column name -> SQLAlchemy type, passed to
    to_sql for staging table creation. Only effective when engine was created
    with fast_executemany=False (use get_engine_slow for wide VARCHAR tables).

    Staging pattern:
      1. Drop temp table if it exists from a previous call in this session.
      2. Create fresh via to_sql with if_exists='append'.
      3. MERGE from staging into destination.
    """
    # Lazy import: integrity pulls in the full catalog; db.py must stay
    # importable without it in minimal contexts.
    from shared.integrity import CRITICAL_FIELDS, validate_and_filter

    full_name = f"{schema}.{table}"
    if full_name in CRITICAL_FIELDS and not df.empty:
        import pandas as _pd
        records = df.astype(object).where(_pd.notnull(df), None).to_dict("records")
        valid = validate_and_filter(records, full_name, engine, source_workflow)
        if len(valid) != len(records):
            print(f"  {full_name}: {len(records) - len(valid)} row(s) quarantined by integrity checks")
        if not valid:
            return
        df = _pd.DataFrame(valid, columns=df.columns)

    staging = f"#stage_{table}"

    with engine.begin() as conn:
        conn.execute(text(f"IF OBJECT_ID('tempdb..{staging}') IS NOT NULL DROP TABLE {staging}"))

    df.to_sql(staging, engine, index=False, if_exists="append", chunksize=200, dtype=dtype)

    set_clause  = ", ".join(f"t.{c} = s.{c}" for c in df.columns if c not in keys)
    key_clause  = " AND ".join(f"t.{k} = s.{k}" for k in keys)
    insert_cols = ", ".join(df.columns)
    insert_vals = ", ".join(f"s.{c}" for c in df.columns)

    sql = f"""
    MERGE {schema}.{table} AS t
    USING {staging} AS s
    ON ({key_clause})
    WHEN MATCHED THEN UPDATE SET {set_clause}
    WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals});
    """

    with engine.begin() as conn:
        conn.execute(text(sql))
