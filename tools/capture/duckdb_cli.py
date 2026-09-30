"""Find and run the DuckDB CLI, the reader the uploader uses (tools/sessions/duck.mjs).

pyarrow reading its own output proves nothing about DuckDB: a byte-stream-split
integer column read fine in pyarrow and failed in DuckDB (thread 30, #1028). So
the checks that a chunk is readable go through this.
"""

import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent


def find():
    """The DuckDB CLI path, or None: $DUCKDB, the copies next to the other
    tools, the uploader's temp copy, then PATH."""
    candidates = [
        os.environ.get("DUCKDB"),
        HERE.parent / "sessions" / "duckdb.exe",
        HERE.parent / "lmu-sync" / "duckdb.exe",
        Path(os.environ.get("TEMP", "")) / "duckdb-cli" / "duckdb.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Temp" / "duckdb-cli" / "duckdb.exe",
        shutil.which("duckdb"),
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return str(c)
    return None


def sql(query):
    """Run a query in :memory: and return the CSV text. Raises on any error."""
    exe = find()
    if exe is None:
        raise FileNotFoundError("no DuckDB CLI: set DUCKDB or put duckdb on PATH")
    done = subprocess.run(
        [exe, ":memory:", "-csv", "-c", query], capture_output=True, text=True, check=False
    )
    if done.returncode != 0:
        raise RuntimeError((done.stderr or done.stdout or "duckdb failed")[:800])
    return done.stdout


def read_every_column(path):
    """Rows in the Parquet file, after reading every column of it (a sum or a
    min and max per column, so a column DuckDB cannot decode fails here)."""
    quoted = str(path).replace("\\", "/").replace("'", "''")
    cols = sql(f"select column_name, column_type from (describe select * from read_parquet('{quoted}'))")
    parts = ["count(*) as rows"]
    for line in cols.strip().splitlines()[1:]:
        name, _, kind = line.rpartition(",")
        name = name.strip('"')
        q = '"' + name.replace('"', '""') + '"'
        if kind in ("VARCHAR",):
            parts.append(f"min({q}) is null as \"{name}\"")
        else:
            parts.append(f"sum({q}::DOUBLE) is null as \"{name}\"")
    out = sql(f"select {', '.join(parts)} from read_parquet('{quoted}')")
    return int(out.strip().splitlines()[1].split(",")[0])
