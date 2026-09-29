"""Is the layout we built reading real data? Checked at the start of every session.

A wrong layout does not crash, it reads plausible-looking numbers from the
wrong bytes. These checks look for things only a right layout gets right:
the same names in two different structs, a clock that is a clock, physics in
physical ranges. Ranges come from the 2026-09-27 captures
(telemetry-research/notes/lmu/live.md): tyre and brake temperatures are Kelvin.
"""

import math

from columns import text


def _printable(value):
    # Any printable text: entry names can carry non-ASCII letters (latin-1 from
    # the game), and a wrong layout reads control bytes, not letters.
    return bool(value) and value.isprintable()


def check_scoring(layout, info_raw, vehicles_raw, n):
    """(ok, reason) from the field alone, before the player is in a car."""
    info = layout.scoring.from_buffer_copy(info_raw)
    track = text(info.mTrackName)
    if not _printable(track):
        return False, f"track name is not text: {track!r}"
    if not 1 <= n <= layout.max_vehicles:
        return False, f"{n} vehicles"
    if not (math.isfinite(info.mCurrentET) and 0 <= info.mCurrentET < 1e6):
        return False, f"session clock {info.mCurrentET}"
    size = len(vehicles_raw) // n
    bad_names = []
    for i in range(n):
        car = layout.vehicle.from_buffer_copy(vehicles_raw[i * size : (i + 1) * size])
        name = text(car.mVehicleName)
        if not _printable(name):
            # Hex of the raw bytes: the next refusal shows the encoding.
            bad_names.append(f"car {i} {name!r} bytes {bytes(car.mVehicleName)[:32].hex(' ')}")
        if not 0 <= car.mPlace <= layout.max_vehicles:
            return False, f"car {i} place {car.mPlace}"
        if not (math.isfinite(car.mLapDist) and -1000 < car.mLapDist < 100_000):
            return False, f"car {i} lap distance {car.mLapDist}"
    # A wrong layout garbles every name; one odd or still-blank name while a
    # 58-car field loads does not (2026-09-29 Daytona: "car 30 name is not text"
    # refused the whole race). Refuse only when more than a quarter are bad.
    if len(bad_names) * 4 > n:
        return False, f"{len(bad_names)} of {n} car names are not text: {bad_names[0]}"
    return True, ""


def check_player(layout, info_raw, vehicles_raw, n, telem_raw):
    """(ok, reason) with the player in a car: names must agree across structs.

    ok is None while the car is not simulated yet (all wheel temperatures 0,
    as in the garage before the first frame): not decidable, check again.
    """
    info = layout.scoring.from_buffer_copy(info_raw)
    t = layout.telem.from_buffer_copy(telem_raw)
    if all(k == 0 for w in t.mWheel for k in w.mTemperature):
        return None, "car not simulated yet"
    if text(t.mTrackName) != text(info.mTrackName):
        return False, "track differs between telemetry and scoring"
    size = len(vehicles_raw) // n
    names = [
        text(layout.vehicle.from_buffer_copy(vehicles_raw[i * size : (i + 1) * size]).mVehicleName)
        for i in range(n)
    ]
    if text(t.mVehicleName) not in names:
        return False, "player car not in the field"
    if not (math.isfinite(t.mElapsedTime) and 0 <= t.mElapsedTime < 1e6):
        return False, f"player clock {t.mElapsedTime}"
    speed = math.sqrt(t.mLocalVel.x**2 + t.mLocalVel.y**2 + t.mLocalVel.z**2)
    if not speed < 150:
        return False, f"speed {speed:.0f} m/s"
    if not -2 <= t.mGear <= 12:
        return False, f"gear {t.mGear}"
    for w in t.mWheel:
        temps = list(w.mTemperature) + [w.mTireCarcassTemperature, w.mBrakeTemp]
        if not all(200 <= k <= 1500 for k in temps):
            return False, f"wheel temperatures {[round(k) for k in temps]} K"
    return True, ""
