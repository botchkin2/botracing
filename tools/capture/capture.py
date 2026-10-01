"""One capture on disk: meta.json and 60 s chunks of Parquet.

  <root>/<startUtc>_<track>_<session>/
    meta.json            written at the start, and again at the end with endUtc
    player-0000.parquet  the player car, one row per telemetry frame (~100 Hz)
    field-0000.parquet   every car, one row per car per scoring update (5 Hz)
    session-0000.parquet one row per scoring update: flags, weather, phase

A chunk is written to a .tmp file and renamed, so a crash leaves only whole
chunks. meta.json without endUtc means the recorder did not finish: the
uploader should treat the capture as cut short, not as ended.
"""

import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from columns import FLOAT32_FIELD, FLOAT32_PLAYER, columns, narrow

VERSION = 1
# Text kept per field row: which car is which. Driver names stay on this PC;
# the uploader does not send them (pit-wall thread 30, #626).
FIELD_TEXT = ("mVehicleName", "mVehicleClass", "mDriverName")
# Text kept per player row: the tyre compound names. The numeric compound
# index within a brand reads 0 on every capture so far and names nothing, so
# the names are the only way to tell soft from medium or a wet (pit-wall
# thread 44, setup #1539 item 3). A dictionary-encoded column: a few bytes a chunk.
PLAYER_TEXT = ("mFrontTireCompoundName", "mRearTireCompoundName")


def utc_ms():
    return int(datetime.now(UTC).timestamp() * 1000)


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "unknown"


def write_json(path, value):
    tmp = Path(f"{path}.tmp")
    tmp.write_text(json.dumps(value, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def write_table(path, cols):
    """Byte-stream-split for floating-point columns: the game's floats are
    noisy in the low bytes, and splitting by byte lets zstd squeeze the steady
    high bytes (-35% on a race chunk, lossless; pit-wall thread 30, #763).

    Floats only. The format allows integers too, and pyarrow writes them, but
    DuckDB (the uploader's reader) refuses to read an integer column that uses
    it, so a chunk written that way could not be uploaded (#1028). Text keeps
    its dictionary, everything else the writer default."""
    table = pa.table(cols)
    floats = [f.name for f in table.schema if pa.types.is_floating(f.type)]
    text = [f.name for f in table.schema if pa.types.is_string(f.type)]
    tmp = Path(f"{path}.tmp")
    pq.write_table(
        table, tmp, compression="zstd", use_byte_stream_split=floats, use_dictionary=text or False
    )
    os.replace(tmp, path)


class Capture:
    def __init__(self, root, layout, meta, start_ms=None):
        """meta: track, session, gameVersion, and anything else known at the start."""
        self.layout = layout
        self.start_ms = start_ms if start_ms is not None else utc_ms()
        stamp = datetime.fromtimestamp(self.start_ms / 1000, UTC).strftime("%Y-%m-%dT%H-%M-%SZ")
        self.dir = Path(root) / f"{stamp}_{slug(meta['track'])}_{meta['session']}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.meta = {
            "version": VERSION,
            "startUtc": iso(self.start_ms),
            "endUtc": None,
            "chunks": 0,
            "headerHash": layout.hash,
            "layoutBytes": layout.size,
            "suspectFrames": 0,
            # Car id -> model, from the telemetry slots (the field upload
            # labels cars with this, never with the entry name).
            "vehicleModels": {},
            **meta,
        }
        write_json(self.dir / "meta.json", self.meta)
        self.chunk_started_ms = self.start_ms
        self.bytes = 0
        self._reset()

    def _reset(self):
        self.player_raw, self.player_ms = bytearray(), []
        self.field_raw, self.field_ms, self.field_et, self.field_update = bytearray(), [], [], []
        self.session_raw, self.session_ms = bytearray(), []
        self.updates = 0

    def add_player(self, raw, ms):
        self.player_raw += raw
        self.player_ms.append(ms)

    def add_scoring(self, info_raw, vehicles_raw, n, et, ms):
        self.session_raw += info_raw
        self.session_ms.append(ms)
        self.field_raw += vehicles_raw
        self.field_ms += [ms] * n
        self.field_et += [et] * n
        self.field_update += [self.updates] * n
        self.updates += 1

    def due(self, ms, every_ms=60_000):
        return ms - self.chunk_started_ms >= every_ms

    def flush(self, ms=None):
        """Write the open chunk, if it holds anything. Returns bytes written."""
        if not self.player_ms and not self.session_ms:
            return 0
        n = self.meta["chunks"]
        L = self.layout
        written = 0
        parts = [
            ("player", self.player_raw, L.telem, {"wall_ms": self.player_ms}),
            ("session", self.session_raw, L.scoring, {"wall_ms": self.session_ms}),
            (
                "field",
                self.field_raw,
                L.vehicle,
                {"wall_ms": self.field_ms, "et": self.field_et, "update": self.field_update},
            ),
        ]
        for name, raw, ctype, extra in parts:
            if not raw:
                continue
            cols = {k: np.asarray(v) for k, v in extra.items()}
            text = {"field": FIELD_TEXT, "player": PLAYER_TEXT}.get(name, ())
            cols.update(columns(bytes(raw), ctype, text))
            if name != "session":
                cols = narrow(cols, FLOAT32_FIELD if name == "field" else FLOAT32_PLAYER)
            path = self.dir / f"{name}-{n:04d}.parquet"
            write_table(path, cols)
            written += path.stat().st_size
        self.meta["chunks"] = n + 1
        # Rewritten per chunk, so a capture cut short still has its car models.
        write_json(self.dir / "meta.json", self.meta)
        self.bytes += written
        self.chunk_started_ms = ms if ms is not None else utc_ms()
        self._reset()
        return written

    def close(self, ms=None):
        """Flush and mark the capture finished. Returns bytes written."""
        written = self.flush(ms)
        self.meta["endUtc"] = iso(ms if ms is not None else utc_ms())
        write_json(self.dir / "meta.json", self.meta)
        return written


def dir_bytes(root):
    total = 0
    for dirpath, _, files in os.walk(root):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(dirpath, f))
            except OSError:
                pass
    return total
