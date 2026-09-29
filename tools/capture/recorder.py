"""Record LMU's shared memory while the game runs: the player car and the field.

  uv run --project tools/capture tools/capture/recorder.py
  uv run --project tools/capture tools/capture/recorder.py --root D:\\lap-capture

Waits for the game, records every session to %LOCALAPPDATA%\\lap-capture, and
idles between. One instance per user. status.json in the root says what it is
doing, for the uploader's heartbeat (pit-wall thread 30):
  {state: no-game | waiting | recording | refused | stopped, gameVersion,
   layoutOk, layoutReason, lastChunkAt, sessionDir, captureBytes, pid, updatedAt}
sessionDir is the capture's folder name, relative to the root: the heartbeat
is served without sign-in, so no user paths leave the PC.
"""

import argparse
import ctypes as C
import math
import os
import shutil
import signal
import struct
import sys
import time
from pathlib import Path

import layout as layout_mod
import sanity
import shm
from capture import Capture, dir_bytes, iso, utc_ms, write_json
from columns import text

POLL_S = 0.004  # 250 Hz: every 100 Hz telemetry frame, at a few microseconds each
IDLE_S = 0.5
NO_GAME_S = 5.0
GAME_CHECK_MS = 5_000
# No scoring update this long: the session is over. Long enough that a pause
# or a garage wait with the clock frozen stays in one capture.
SESSION_GONE_MS = 10 * 60_000
# A refused session is checked again after this, so a glitch while the game
# loads the field recovers instead of losing the whole session.
REFUSE_RETRY_MS = 10_000
STATUS_MS = 30_000
RECOUNT_MS = 5 * 60_000  # recount disk use while idle: the uploader prunes old captures
# A frame is suspect when speed changes faster than this between frames
# (m/s per s, about 20 g) or the car moves further than speed allows. Counted,
# not dropped: the first sessions tell us how often reads tear.
SUSPECT_ACCEL = 200.0
BELOW_NORMAL_PRIORITY_CLASS = 0x4000


class Recorder:
    def __init__(self, layout, root, open_reader, game_running, chunk_ms=60_000):
        self.layout = layout
        self.root = Path(root)
        self.open_reader = open_reader
        self.game_running = game_running
        self.chunk_ms = chunk_ms
        self.reader = None
        self.capture = None
        self.key = None
        self.refused_key = None
        self.refused_at = 0
        self.player_ok = None
        self.last_scoring_et = None
        self.last_scoring_ms = 0
        self.last_player_et = None
        self.last_game_check = -GAME_CHECK_MS
        self._last_field = None
        self._prev_motion = None  # (et, speed, x, y, z) of the last player frame
        t = layout.telem
        self._motion_at = (
            t.mElapsedTime.offset,
            t.mLocalVel.offset,
            t.mPos.offset,
        )
        self.status = {
            "state": "no-game",
            "gameVersion": None,
            "layoutOk": None,
            "layoutReason": "",
            "lastChunkAt": None,
            "sessionDir": None,
            "captureBytes": 0,
            "pid": os.getpid(),
        }
        self.status_written = -STATUS_MS
        self.recounted = -RECOUNT_MS
        self.status["captureBytes"] = dir_bytes(self.root) if self.root.exists() else 0

    # Status -----------------------------------------------------------------

    def set_status(self, now, **fields):
        changed = any(self.status.get(k) != v for k, v in fields.items())
        self.status.update(fields)
        if changed or now - self.status_written >= STATUS_MS:
            self.root.mkdir(parents=True, exist_ok=True)
            write_json(self.root / "status.json", {**self.status, "updatedAt": iso(now)})
            self.status_written = now

    def _recount(self, now):
        """Walk the capture root for its size. Only while no capture is open:
        the walk grows with every capture kept, and must not stall recording."""
        if now - self.recounted >= RECOUNT_MS:
            self.recounted = now
            self.status["captureBytes"] = dir_bytes(self.root)

    def _add_bytes(self, n):
        self.status["captureBytes"] += n

    # Captures ---------------------------------------------------------------

    def _open_capture(self, now, info, key):
        self.capture = Capture(
            self.root,
            self.layout,
            {
                "track": key[0],
                "session": key[1],
                "gameVersion": self.status["gameVersion"],
                "playerName": text(info.mPlayerName),
                "serverName": text(info.mServerName),
                "gameMode": info.mGameMode,
            },
            start_ms=now,
        )
        self.key = key
        self.player_ok = None
        self._prev_motion = None
        self.set_status(now, state="recording", sessionDir=self.capture.dir.name)

    def _close_capture(self, now):
        if self.capture:
            self._add_bytes(self.capture.close(now))
            self.set_status(now, lastChunkAt=iso(now))
        self.capture = None
        self.key = None

    def _refuse(self, now, key, reason):
        if self.capture:
            self._add_bytes(-self.capture.bytes)
            shutil.rmtree(self.capture.dir, ignore_errors=True)
        self.capture = None
        self.key = None
        self.refused_key = key
        self.refused_at = now
        self.set_status(now, state="refused", layoutOk=False, layoutReason=reason, sessionDir=None)

    # The loop ---------------------------------------------------------------

    def tick(self, now):
        """One poll. Returns how long to sleep before the next."""
        if now - self.last_game_check >= GAME_CHECK_MS:
            self.last_game_check = now
            if not self.game_running():
                self._close_capture(now)
                if self.reader:
                    self.reader.close()
                    self.reader = None
                self._recount(now)
                self.set_status(now, state="no-game")
                return NO_GAME_S
        if self.reader is None:
            try:
                self.reader = self.open_reader()
            except OSError as error:
                self.set_status(now, state="refused", layoutOk=False, layoutReason=str(error))
                return NO_GAME_S
            self.set_status(now, gameVersion=self.reader.game_version())

        et = self.reader.scoring_clock()
        if et != self.last_scoring_et:
            self._scoring(now)
        elif self.capture and now - self.last_scoring_ms > SESSION_GONE_MS:
            self._close_capture(now)
            self.set_status(now, state="waiting", sessionDir=None)

        if self.capture:
            self._player(now)
        if self.capture:
            if self.capture.due(now, self.chunk_ms):
                self._add_bytes(self.capture.flush(now))
                self.set_status(now, lastChunkAt=iso(now))
            else:
                self.set_status(now)
            return POLL_S
        self._recount(now)
        if self.status["state"] not in ("refused",):
            self.set_status(now, state="waiting")
        else:
            self.set_status(now)
        return IDLE_S

    def _scoring(self, now):
        frame = self.reader.scoring()
        if frame is None:
            return
        info_raw, vehicles_raw, n, et = frame
        restarted = self.last_scoring_et is not None and et < self.last_scoring_et - 1
        self.last_scoring_et, self.last_scoring_ms = et, now
        if n == 0:
            return
        info = self.layout.scoring.from_buffer_copy(info_raw)
        key = (text(info.mTrackName), int(info.mSession))
        if self.capture and (key != self.key or restarted):
            self._close_capture(now)
        if self.capture is None:
            if (
                key == self.refused_key
                and not restarted
                and now - self.refused_at < REFUSE_RETRY_MS
            ):
                return
            ok, reason = sanity.check_scoring(self.layout, info_raw, vehicles_raw, n)
            if not ok:
                self._refuse(now, key, reason)
                return
            self.refused_key = None
            self.set_status(now, layoutOk=True, layoutReason="")
            self._open_capture(now, info, key)
        self.capture.add_scoring(info_raw, vehicles_raw, n, et, now)
        self._last_field = (info_raw, vehicles_raw, n)
        self._note_models(vehicles_raw, n)

    def _note_models(self, vehicles_raw, n):
        """Look up car models once per new car id, from the telemetry slots."""
        known = self.capture.meta["vehicleModels"]
        size = len(vehicles_raw) // n if n else 0
        id_at = self.layout.vehicle.mID.offset
        ids = {
            struct.unpack_from("<i", vehicles_raw, i * size + id_at)[0] for i in range(n)
        }
        if all(str(i) in known for i in ids):
            return
        for car_id, model in self.reader.vehicle_models().items():
            if model and car_id in ids:
                known[str(car_id)] = model

    def _player(self, now):
        clock = self.reader.player_clock()
        if clock is None or clock[1] == self.last_player_et:
            return
        frame = self.reader.player()
        if frame is None:
            return
        raw, et = frame
        self.last_player_et = et
        if self.player_ok is None:
            self.player_ok, reason = sanity.check_player(self.layout, *self._last_field, raw)
            if self.player_ok is False:
                self._refuse(now, self.key, reason)
                return
        if self._suspect(raw):
            self.capture.meta["suspectFrames"] += 1
        self.capture.add_player(raw, now)

    def _suspect(self, raw):
        """Does this frame break physical continuity with the previous one?"""
        et_at, vel_at, pos_at = self._motion_at
        et = struct.unpack_from("<d", raw, et_at)[0]
        vx, vy, vz = struct.unpack_from("<3d", raw, vel_at)
        x, y, z = struct.unpack_from("<3d", raw, pos_at)
        speed = math.sqrt(vx * vx + vy * vy + vz * vz)
        prev, self._prev_motion = self._prev_motion, (et, speed, x, y, z)
        if prev is None:
            return False
        dt = et - prev[0]
        if not 0 < dt < 0.1:
            return False  # a pause or a reset, not a torn read
        moved = math.dist((x, y, z), prev[2:])
        return abs(speed - prev[1]) / dt > SUSPECT_ACCEL or moved > max(speed, prev[1]) * dt * 2 + 1


def _single_instance():
    """Hold a named mutex for the life of the process; False if another holds it."""
    if not hasattr(C, "WinDLL"):
        return True
    k32 = C.WinDLL("kernel32", use_last_error=True)
    _single_instance.handle = k32.CreateMutexW(None, False, "Local\\lap-capture-recorder")
    return C.get_last_error() != 183  # ERROR_ALREADY_EXISTS


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    default_root = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "lap-capture"
    ap.add_argument("--root", default=str(default_root))
    ap.add_argument("--header-dir", default=str(layout_mod.DEFAULT_HEADER_DIR))
    ap.add_argument("--chunk-s", type=float, default=60)
    args = ap.parse_args()
    if not _single_instance():
        print("another recorder is running", file=sys.stderr)
        return 0
    if hasattr(C, "WinDLL"):
        # Always yield to the game, the VR compositor and SimHub.
        k32 = C.WinDLL("kernel32")
        k32.SetPriorityClass(k32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)
    layout = layout_mod.load(args.header_dir)
    rec = Recorder(
        layout,
        args.root,
        open_reader=lambda: shm.Reader(layout),
        game_running=shm.game_running,
        chunk_ms=int(args.chunk_s * 1000),
    )
    # Closing the console sends CTRL_BREAK; finish the open chunk first.
    signal.signal(signal.SIGBREAK, signal.default_int_handler)
    try:
        while True:
            time.sleep(rec.tick(utc_ms()))
    except KeyboardInterrupt:
        now = utc_ms()
        rec._close_capture(now)
        rec.set_status(now, state="stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
