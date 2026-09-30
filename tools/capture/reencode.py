"""Rewrite capture chunks with the current writer, losslessly (pit-wall thread 30, #1028).

Chunks written between #95 and its fix used byte-stream-split on integer
columns, which the uploader's DuckDB cannot read. This rewrites them:

  uv run --project tools/capture tools/capture/reencode.py <capture dir> [<capture dir> ...]
  uv run --project tools/capture tools/capture/reencode.py --all [--root <dir>]

--all takes every capture folder under the root (default %LOCALAPPDATA%\\lap-capture).
A chunk that is already fine is left alone, so running it twice changes nothing.
Each chunk is rewritten to a .tmp file, read back and compared to the original
value for value (row count, schema, every column), and only then replaces it
(atomic). A chunk that fails the comparison or is held open by another program
is reported and left as it was; the exit code is 1 if any was.

Run it with the recorder and the uploader idle: it replaces files they read.
"""

import argparse
import os
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

import duckdb_cli
from capture import write_table


def has_integer_byte_stream_split(path):
    """True when an integer column of the chunk is byte-stream-split (the
    encoding DuckDB refuses on integers). Read from the file's metadata."""
    parquet = pq.ParquetFile(path)
    schema = parquet.schema_arrow
    for group in range(parquet.metadata.num_row_groups):
        row_group = parquet.metadata.row_group(group)
        for i in range(row_group.num_columns):
            column = row_group.column(i)
            if pa.types.is_integer(schema.field(column.path_in_schema).type) and (
                "BYTE_STREAM_SPLIT" in [str(e) for e in column.encodings]
            ):
                return True
    return False


def readable_in_duckdb(path):
    """True when the DuckDB CLI can read every column, False when it cannot,
    None with no CLI to ask."""
    if duckdb_cli.find() is None:
        return None
    try:
        duckdb_cli.read_every_column(path)
        return True
    except RuntimeError:
        return False


def needs_fix(path):
    """The chunk cannot be read by DuckDB. Asks DuckDB itself when the CLI is
    there; else goes by the encoding that broke it."""
    ok = readable_in_duckdb(path)
    return has_integer_byte_stream_split(path) if ok is None else not ok


def reencode(path):
    """Rewrite one chunk. Returns (bytes before, bytes after); raises if the copy differs."""
    path = Path(path)
    before = pq.read_table(path)
    tmp = path.with_name(path.name + ".fix")
    write_table(tmp, {name: before[name] for name in before.column_names})
    try:
        after = pq.read_table(tmp)
        if after.schema != before.schema:
            raise ValueError(f"schema changed: {before.schema} -> {after.schema}")
        if after.num_rows != before.num_rows or not after.equals(before):
            raise ValueError("rewritten chunk differs from the original")
        if readable_in_duckdb(tmp) is False:
            raise ValueError("DuckDB still cannot read the rewritten chunk")
        if duckdb_cli.find() and duckdb_cli.read_every_column(tmp) != before.num_rows:
            raise ValueError("DuckDB reads a different row count")
        sizes = (path.stat().st_size, tmp.stat().st_size)
        os.replace(tmp, path)
        return sizes
    finally:
        if tmp.exists():
            tmp.unlink()


def capture_dirs(args):
    if args.all:
        root = Path(args.root or Path(os.environ.get("LOCALAPPDATA", ".")) / "lap-capture")
        return sorted(p for p in root.iterdir() if (p / "meta.json").exists())
    return [Path(p) for p in args.dirs]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("dirs", nargs="*", help="capture folders")
    parser.add_argument("--all", action="store_true", help="every capture under --root")
    parser.add_argument("--root", help=r"default %%LOCALAPPDATA%%\lap-capture")
    args = parser.parse_args(argv)
    if not args.all and not args.dirs:
        parser.error("give capture folders or --all")
    failed = fixed = fine = 0
    for folder in capture_dirs(args):
        for path in sorted(folder.glob("*.parquet")):
            try:
                if not needs_fix(path):
                    fine += 1
                    continue
                old, new = reencode(path)
                fixed += 1
                print(f"fixed  {folder.name}/{path.name}  {old / 1e6:.2f} -> {new / 1e6:.2f} MB")
            except Exception as error:  # a locked or odd chunk must not stop the rest
                failed += 1
                print(f"FAILED {folder.name}/{path.name}: {error}", file=sys.stderr)
    print(f"{fixed} rewritten, {fine} already fine, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
