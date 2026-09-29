import json

import pyarrow.parquet as pq

import shm
from recorder import Recorder


def make(lay, game, tmp_path, chunk_ms=1000):
    return Recorder(
        lay,
        tmp_path,
        open_reader=lambda: shm.Reader(lay, view=game.view),
        game_running=lambda: game.running,
        chunk_ms=chunk_ms,
    )


def status(tmp_path):
    return json.loads((tmp_path / "status.json").read_text())


def drive(rec, game, start, seconds, now=None):
    """Tick at 100 Hz of game time, with a scoring update every 20 frames."""
    now = start
    for i in range(int(seconds * 100)):
        game.step(scoring=i % 20 == 0)
        rec.tick(now)
        now += 10
    return now


def test_no_game(lay, game, tmp_path):
    game.running = False
    rec = make(lay, game, tmp_path)
    assert rec.tick(0) == 5.0
    assert status(tmp_path)["state"] == "no-game"
    assert [p.name for p in tmp_path.iterdir()] == ["status.json"]


def test_records_chunks_and_finishes(lay, game, tmp_path):
    rec = make(lay, game, tmp_path)
    now = drive(rec, game, 0, 2.5)
    s = status(tmp_path)
    assert s["state"] == "recording" and s["layoutOk"] is True and s["gameVersion"] == 14200
    (cap,) = [p for p in tmp_path.iterdir() if p.is_dir()]
    assert cap.name.endswith("_road-atlanta_10")
    meta = json.loads((cap / "meta.json").read_text())
    assert meta["endUtc"] is None and meta["track"] == "Road Atlanta"

    game.running = False
    rec.tick(now + 10_000)
    meta = json.loads((cap / "meta.json").read_text())
    assert meta["endUtc"] and meta["chunks"] == 3
    player = pq.read_table(sorted(cap.glob("player-*.parquet"))[0]).to_pydict()
    assert player["mGear"][0] == 3 and "fl_mTemperature_0" in player and "wall_ms" in player
    rows = sum(pq.read_table(p).num_rows for p in cap.glob("player-*.parquet"))
    assert rows == 250  # every frame, none twice
    field = pq.read_table(sorted(cap.glob("field-*.parquet"))[0]).to_pydict()
    assert field["mPlace"][:3] == [1, 2, 3] and field["update"][:3] == [0, 0, 0]
    assert status(tmp_path)["state"] == "no-game"


def test_garbage_layout_is_refused(lay, game, tmp_path):
    game.obj.scoring.vehScoringInfo[2].mVehicleName = b"\x01\x02\x03"
    rec = make(lay, game, tmp_path)
    drive(rec, game, 0, 1)
    s = status(tmp_path)
    assert s["state"] == "refused" and s["layoutOk"] is False and "name" in s["layoutReason"]
    assert not [p for p in tmp_path.iterdir() if p.is_dir()]


def test_implausible_player_removes_the_capture(lay, game, tmp_path):
    for w in game.obj.telemetry.telemInfo[1].mWheel:
        w.mBrakeTemp = 90_000.0
    rec = make(lay, game, tmp_path)
    drive(rec, game, 0, 1)
    s = status(tmp_path)
    assert s["state"] == "refused" and "temperatures" in s["layoutReason"]
    assert not [p for p in tmp_path.iterdir() if p.is_dir()]


def test_car_not_simulated_yet_waits(lay, game, tmp_path):
    for w in game.obj.telemetry.telemInfo[1].mWheel:
        w.mTemperature[:] = [0.0, 0.0, 0.0]
    rec = make(lay, game, tmp_path)
    drive(rec, game, 0, 0.5)
    assert status(tmp_path)["state"] == "recording"
    assert rec.player_ok is None


def test_new_session_starts_a_new_capture(lay, game, tmp_path):
    rec = make(lay, game, tmp_path)
    now = drive(rec, game, 0, 0.5)
    game.obj.scoring.scoringInfo.mSession = 11
    drive(rec, game, now + 1000, 0.5)
    caps = sorted(p.name for p in tmp_path.iterdir() if p.is_dir())
    assert len(caps) == 2 and caps[1].endswith("_11")


def test_status_paths_are_relative_and_bytes_add_up(lay, game, tmp_path):
    rec = make(lay, game, tmp_path)
    drive(rec, game, 0, 1.5)
    s = status(tmp_path)
    (cap,) = [p for p in tmp_path.iterdir() if p.is_dir()]
    assert s["sessionDir"] == cap.name
    on_disk = sum(p.stat().st_size for p in cap.glob("*.parquet"))
    assert s["captureBytes"] == on_disk > 0


def test_a_jump_counts_as_suspect(lay, game, tmp_path):
    rec = make(lay, game, tmp_path)
    now = drive(rec, game, 0, 0.3)
    game.obj.telemetry.telemInfo[1].mPos.x += 500.0  # 500 m in one 10 ms frame
    now = drive(rec, game, now, 0.1)
    assert rec.capture.meta["suspectFrames"] == 1


class Tearing(bytearray):
    """A view whose first slice of `size` bytes comes back half-written."""

    def __init__(self, data, size):
        super().__init__(data)
        self.size, self.torn = size, 1

    def __getitem__(self, key):
        out = super().__getitem__(key)
        if isinstance(key, slice) and len(out) == self.size and self.torn:
            self.torn -= 1
            return bytes(len(out) // 2) + out[len(out) // 2 :]
        return out


def test_a_torn_copy_is_read_again(lay, game):
    import ctypes as C

    view = Tearing(game.view, C.sizeof(lay.telem))
    raw, et = shm.Reader(lay, view=view).player()
    assert raw == bytes(game.obj.telemetry.telemInfo[1])
    assert view.torn == 0


def test_field_rows_keep_car_text(lay, game, tmp_path):
    rec = make(lay, game, tmp_path)
    now = drive(rec, game, 0, 0.5)
    rec.tick(now)
    rec.capture.flush(now)
    (cap,) = [p for p in tmp_path.iterdir() if p.is_dir()]
    field = pq.read_table(sorted(cap.glob("field-*.parquet"))[0]).to_pydict()
    assert field["mVehicleName"][:3] == ["Car 0", "Car 1", "Car 2"]
    assert "mVehicleClass" in field and "mDriverName" in field
