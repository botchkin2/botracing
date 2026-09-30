"""The chunk writer, checked the way the uploader reads it.

pyarrow reading its own output proves nothing about DuckDB: an integer column
with byte-stream-split read fine in pyarrow and failed in DuckDB, and the first
race written that way could not be uploaded (pit-wall thread 30, #1028). So
readability is checked with the DuckDB CLI, on every column type the recorder
produces, and the encoding rule is checked on the file itself, which needs no CLI.
"""

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

import capture
import duckdb_cli
import reencode

needs_duckdb = pytest.mark.skipif(
    duckdb_cli.find() is None, reason="no DuckDB CLI (set DUCKDB or put duckdb on PATH)"
)

ROWS = 500
RNG = np.random.default_rng(7)


def every_type():
    """One column of each type the recorder writes (columns.py, capture.py)."""
    return {
        "wall_ms": np.arange(ROWS, dtype=np.int64) + 1_790_000_000_000,
        "update": np.arange(ROWS, dtype=np.int64) // 60,
        "mID": RNG.integers(0, 62, ROWS).astype(np.int32),
        "mGear": RNG.integers(-1, 8, ROWS).astype(np.int8),
        "mSteps": RNG.integers(-30000, 30000, ROWS).astype(np.int16),
        "mFlagBits": RNG.integers(0, 255, ROWS).astype(np.uint8),
        "mSmall": RNG.integers(0, 60000, ROWS).astype(np.uint16),
        "mLap": RNG.integers(0, 90, ROWS).astype(np.uint32),
        "mResultsStream": RNG.integers(0, 2**60, ROWS).astype(np.uint64),
        "mIsPlayer": RNG.integers(0, 2, ROWS).astype(bool),
        "mSpeed": RNG.normal(60, 20, ROWS),  # float64
        "mTemp": RNG.normal(300, 10, ROWS).astype(np.float32),
        "mVehicleName": np.array([f"Car {i % 9}" for i in range(ROWS)], dtype=object),
    }


def duckdb_column(path, name):
    """One column as DuckDB reads it: the CSV lines below the header."""
    quoted = str(path).replace("\\", "/")
    out = duckdb_cli.sql(f"select \"{name}\" from read_parquet('{quoted}')")
    return out.strip().splitlines()[1:]


def test_only_floating_columns_are_byte_stream_split(tmp_path):
    path = tmp_path / "chunk.parquet"
    capture.write_table(path, every_type())
    parquet = pq.ParquetFile(path)
    row_group = parquet.metadata.row_group(0)
    schema = parquet.schema_arrow
    split = {}
    for i in range(row_group.num_columns):
        column = row_group.column(i)
        split[column.path_in_schema] = "BYTE_STREAM_SPLIT" in [str(e) for e in column.encodings]
    for name, on in split.items():
        assert on == pa.types.is_floating(schema.field(name).type), name
    assert split["mSpeed"] and split["mTemp"]  # the point of it stays
    assert not any(split[n] for n in ("wall_ms", "mID", "mGear", "mResultsStream"))


@needs_duckdb
def test_duckdb_reads_every_column_of_every_type(tmp_path):
    path = tmp_path / "chunk.parquet"
    cols = every_type()
    capture.write_table(path, cols)
    assert duckdb_cli.read_every_column(path) == ROWS
    for name, expected in cols.items():
        got = duckdb_column(path, name)
        assert len(got) == ROWS, name
        if name == "mVehicleName":
            assert got == list(expected), name
        elif name == "mIsPlayer":
            assert got == ["true" if v else "false" for v in expected], name
        elif expected.dtype.kind == "f":
            assert np.allclose([float(v) for v in got], expected, rtol=1e-6), name
        else:
            assert [int(v) for v in got] == [int(v) for v in expected], name


def write_broken(path, cols):
    """A chunk as #95 wrote it: byte-stream-split on the integer columns too."""
    table = pa.table(cols)
    numeric = [
        f.name
        for f in table.schema
        if pa.types.is_floating(f.type) or f.type in (pa.int32(), pa.int64())
    ]
    text = [f.name for f in table.schema if pa.types.is_string(f.type)]
    pq.write_table(
        table, path, compression="zstd", use_byte_stream_split=numeric, use_dictionary=text or False
    )


def test_reencode_finds_and_fixes_a_broken_chunk(tmp_path):
    path = tmp_path / "player-0000.parquet"
    write_broken(path, every_type())
    before = pq.read_table(path)
    assert reencode.has_integer_byte_stream_split(path)
    assert reencode.needs_fix(path)
    reencode.reencode(path)
    assert not reencode.has_integer_byte_stream_split(path)
    assert not reencode.needs_fix(path)
    after = pq.read_table(path)
    assert after.equals(before)  # every value, schema and row count
    assert not list(tmp_path.glob("*.fix*"))  # nothing left behind


@needs_duckdb
def test_a_broken_chunk_really_fails_in_duckdb_and_is_readable_after(tmp_path):
    path = tmp_path / "player-0000.parquet"
    write_broken(path, every_type())
    with pytest.raises(RuntimeError):
        duckdb_cli.read_every_column(path)
    reencode.reencode(path)
    assert duckdb_cli.read_every_column(path) == ROWS


def test_reencode_leaves_a_good_chunk_alone_and_a_second_run_changes_nothing(tmp_path):
    folder = tmp_path / "2026-09-30T02-04-33Z_daytona_10"
    folder.mkdir()
    write_broken(folder / "player-0000.parquet", every_type())
    capture.write_table(folder / "player-0001.parquet", every_type())
    (folder / "meta.json").write_text("{}")
    assert reencode.main([str(folder)]) == 0
    first = {p.name: p.read_bytes() for p in folder.glob("*.parquet")}
    assert reencode.main([str(folder)]) == 0
    assert {p.name: p.read_bytes() for p in folder.glob("*.parquet")} == first


def test_reencode_reports_a_bad_chunk_and_keeps_going(tmp_path, capsys):
    folder = tmp_path / "capture"
    folder.mkdir()
    (folder / "player-0000.parquet").write_bytes(b"not parquet")
    write_broken(folder / "player-0001.parquet", every_type())
    assert reencode.main([str(folder)]) == 1
    out = capsys.readouterr()
    assert "FAILED" in out.err and "player-0000" in out.err
    assert not reencode.has_integer_byte_stream_split(folder / "player-0001.parquet")
    assert (folder / "player-0000.parquet").read_bytes() == b"not parquet"
