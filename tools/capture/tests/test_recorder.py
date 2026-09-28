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
