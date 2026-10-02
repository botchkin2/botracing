"""The recorder's output as the uploader reads it.

tools/sessions/field.mjs lists the captures in the recorder's root and picks
the ones whose track and time overlap a session (listCaptures, capturesFor).
These tests record with the real Recorder, then run that real node code on the
folder, so a change to meta.json or the file names on either side fails here
and not on the night after a rollout.
"""

import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest

import shm
from recorder import Recorder

FIELD = Path(__file__).parents[2] / "sessions" / "field.mjs"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

READER = """
import {listCaptures, capturesFor} from %r;
const [root, tracks, startMs, endMs] = JSON.parse(process.argv[1]);
const all = listCaptures(root);
const hit = capturesFor(all, {tracks, startMs, endMs});
console.log(JSON.stringify({
  listed: all.map(c => ({name: c.name, track: c.meta.track, end: c.meta.endUtc, files: c.files.length})),
  matched: hit.map(c => c.name),
}));
"""


def make(lay, game, root):
    return Recorder(
        lay,
        root,
        open_reader=lambda: shm.Reader(lay, view=game.view),
        game_running=lambda: game.running,
        chunk_ms=1000,
    )


def drive(rec, game, start, seconds):
    now = start
    for i in range(int(seconds * 100)):
        game.step(scoring=i % 20 == 0)
        rec.tick(now)
        now += 10
    return now


def uploader_view(root, tracks, start_ms, end_ms):
    """What sync's field step sees in this folder, from node."""
    arg = json.dumps([str(root), tracks, start_ms, end_ms])
    out = subprocess.run(
        [NODE, "--input-type=module", "-e", READER % FIELD.as_uri(), arg],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    ).stdout
    return json.loads(out)


def ms(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000


NOW_MS = int(datetime.now(timezone.utc).timestamp() * 1000)


def test_a_finished_capture_is_listed_and_matched_by_its_window(lay, game, tmp_path):
    rec = make(lay, game, tmp_path)
    now = drive(rec, game, NOW_MS, 2.5)
    game.running = False
    rec.tick(now + 10_000)
    (cap,) = [p for p in tmp_path.iterdir() if p.is_dir()]
    meta = json.loads((cap / "meta.json").read_text())

    inside = uploader_view(tmp_path, ["Road Atlanta"], ms(meta["startUtc"]) + 500, ms(meta["endUtc"]) - 500)
    assert [c["name"] for c in inside["listed"]] == [cap.name]
    assert inside["listed"][0]["track"] == "Road Atlanta"
    assert inside["listed"][0]["end"] == meta["endUtc"]
    assert inside["listed"][0]["files"] == 3
    assert inside["matched"] == [cap.name]

    # Another track, or a session hours later: not this capture.
    other = uploader_view(tmp_path, ["Daytona"], ms(meta["startUtc"]), ms(meta["endUtc"]))
    assert other["matched"] == []
    later = uploader_view(tmp_path, ["Road Atlanta"], ms(meta["endUtc"]) + 3_600_000, ms(meta["endUtc"]) + 7_200_000)
    assert later["matched"] == []


def test_a_capture_cut_short_ends_at_its_last_chunk(lay, game, tmp_path):
    """No endUtc (crash, kill, power): it must not join every later session."""
    rec = make(lay, game, tmp_path)
    drive(rec, game, NOW_MS, 2.5)  # never finished: the process "dies" here
    (cap,) = [p for p in tmp_path.iterdir() if p.is_dir()]
    meta = json.loads((cap / "meta.json").read_text())
    assert meta["endUtc"] is None

    now_view = uploader_view(tmp_path, ["Road Atlanta"], NOW_MS - 1000, NOW_MS + 60_000)
    assert now_view["matched"] == [cap.name]
    assert now_view["listed"][0]["end"] is None
    # A session a day later, on the same track: the cut-short capture is not in it.
    next_day = uploader_view(tmp_path, ["Road Atlanta"], NOW_MS + 86_400_000, NOW_MS + 90_000_000)
    assert next_day["matched"] == []


def test_a_refused_session_leaves_nothing_for_the_uploader(lay, game, tmp_path):
    game.obj.scoring.vehScoringInfo[2].mVehicleName = b"\x01\x02\x03"
    game.view[:] = bytes(game.obj)
    rec = make(lay, game, tmp_path)
    drive(rec, game, NOW_MS, 1.0)
    view = uploader_view(tmp_path, ["Road Atlanta"], NOW_MS - 1000, NOW_MS + 60_000)
    assert view["listed"] == [] and view["matched"] == []
