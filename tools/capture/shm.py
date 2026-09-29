"""Read-only access to LMU's shared memory (Windows).

Never creates the mapping: Python's mmap would make an empty one under the
game's name if the game had not, so the name is checked with
OpenFileMappingW first.

No lock and no frame events. LMU's lock is shared with the game's writer, and
a reader holding it stalls the game; its frame events may be auto-reset, in
which case waiting on them would take frames from other tools (SimHub,
CrewChief). The header has no update counters either, and the clock sits at
the front of each struct, so a clock check alone can pass a half-written
frame. Each frame is copied twice and kept only when both copies are
identical (2 KB, a few microseconds).
"""

import ctypes as C
import mmap
import struct

MAPPING = "LMU_Data"
HOLD_EVENT = b"LMU_Data_HoldEvent"
SYNCHRONIZE = 0x00100000
FILE_MAP_READ = 0x0004
RETRIES = 3

_k32 = C.WinDLL("kernel32", use_last_error=True) if hasattr(C, "WinDLL") else None


def _handle_exists(open_fn, *args):
    if _k32 is None:
        return False
    handle = open_fn(*args)
    if handle:
        _k32.CloseHandle(handle)
        return True
    return False


def game_running():
    """True while LMU is up with its shared memory interface.

    The game holds its frame event open; once it exits the event is gone.
    Checking the mapping instead would be fooled by our own open view.
    """
    return _k32 is not None and _handle_exists(
        _k32.OpenEventA, SYNCHRONIZE, False, HOLD_EVENT
    )


def mapping_exists():
    return _k32 is not None and _handle_exists(
        _k32.OpenFileMappingW, FILE_MAP_READ, False, MAPPING
    )


class Reader:
    """Frames of the player car and the field, as raw struct bytes."""

    def __init__(self, layout, view=None):
        self.layout = layout
        self.view = view if view is not None else self._open()
        L = layout
        self.telem_size = C.sizeof(L.telem)
        self.veh_size = C.sizeof(L.vehicle)
        self.scoring_size = C.sizeof(L.scoring)
        self.telem_et = L.telem.mElapsedTime.offset
        self.scoring_et = L.scoring.mCurrentET.offset
        self.num_vehicles = L.scoring.mNumVehicles.offset

    def _open(self):
        if not mapping_exists():
            raise OSError("LMU_Data is not there (game not running)")
        # If the game exits between the check above and this line, Python
        # creates an empty mapping under the game's name. The window is
        # microseconds, and the next game check closes it.
        # Raises if the game's mapping is smaller than the header says.
        return mmap.mmap(-1, self.layout.size, tagname=MAPPING, access=mmap.ACCESS_READ)

    def close(self):
        if isinstance(self.view, mmap.mmap):
            self.view.close()

    def _read(self, offset, n):
        return self.view[offset : offset + n]

    def _f64(self, offset):
        return struct.unpack_from("<d", self.view, offset)[0]

    def game_version(self):
        return struct.unpack_from("<i", self.view, self.layout.offsets["gameVersion"])[0]

    def vehicle_models(self):
        """{car id: model} from every active telemetry slot.

        The model ("Porsche 911 GT3 R"), unlike the scoring vehicle name,
        which is the entry name with the car number in it.
        """
        o = self.layout.offsets
        t = self.layout.telem
        out = {}
        for i in range(self.view[o["activeVehicles"]]):
            slot = o["telemInfo"] + i * self.telem_size
            car_id = struct.unpack_from("<i", self.view, slot + t.mID.offset)[0]
            raw = self._read(slot + t.mVehicleModel.offset, t.mVehicleModel.size)
            out[car_id] = bytes(raw).split(b"\0", 1)[0].decode("latin-1").strip()
        return out

    def player_clock(self):
        """(slot offset, elapsed time) of the player's telemetry, or None."""
        o = self.layout.offsets
        if not self.view[o["playerHasVehicle"]]:
            return None
        slot = o["telemInfo"] + self.view[o["playerVehicleIdx"]] * self.telem_size
        return slot, self._f64(slot + self.telem_et)

    def player(self):
        """(raw TelemInfo bytes, elapsed time), or None when not in a car."""
        for _ in range(RETRIES):
            clock = self.player_clock()
            if clock is None:
                return None
            slot = clock[0]
            raw = self._read(slot, self.telem_size)
            if raw == self._read(slot, self.telem_size):
                return raw, struct.unpack_from("<d", raw, self.telem_et)[0]
        return None

    def scoring_clock(self):
        return self._f64(self.layout.offsets["scoringInfo"] + self.scoring_et)

    def scoring(self):
        """(raw ScoringInfo, raw vehicles, vehicle count, ET), or None."""
        o = self.layout.offsets
        for _ in range(RETRIES):
            info = self._read(o["scoringInfo"], self.scoring_size)
            n = struct.unpack_from("<i", info, self.num_vehicles)[0]
            if not 0 <= n <= self.layout.max_vehicles:
                return None
            span = n * self.veh_size
            vehicles = self._read(o["vehScoringInfo"], span)
            same = info == self._read(o["scoringInfo"], self.scoring_size)
            if same and vehicles == self._read(o["vehScoringInfo"], span):
                return info, vehicles, n, struct.unpack_from("<d", info, self.scoring_et)[0]
        return None
