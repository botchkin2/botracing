"""The measurements behind tools/sessions/fieldTags.mjs (pit-wall thread 30, #763/#787).

Reads one capture folder's field-*.parquet (tools/capture) and prints:
  1. the tow table: speed gained on a straight with a car 15-30 m ahead in the
     same lane against passes 80 m or more from the nearest car, same entry
     speed by regression, bootstrap 95% interval;
  2. per-lap traffic for the player: seconds within 1 s ahead and behind, blue
     flag seconds, passes made and suffered.

  uv run --project tools/capture python tools/sessions/fixtures/fieldTags/measure.py <capture dir> [A_m B_m]

A_m, B_m: the straight, as lap distance (default 4200 5700, the Daytona road
course back straight). Rerun on each new race before changing the constants.
The JS module reads the encoded field, so its numbers differ by decimetre
rounding and by how the first update of a run has no speed.
"""

import glob
import sys

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

COLS = ["et", "mID", "mLapDist", "mPathLateral", "mLocalVel_x", "mLocalVel_y", "mLocalVel_z",
        "mInPits", "mFlag", "mTotalLaps", "mIsPlayer", "mVehicleClass"]
LANE_M = 2.0


def load(folder):
    t = pa.concat_tables([pq.read_table(f, columns=COLS) for f in sorted(glob.glob(f"{folder}/field-*.parquet"))])
    d = {c: t[c].to_numpy(zero_copy_only=False) for c in COLS}
    d["mVehicleClass"] = np.array(t["mVehicleClass"].to_pylist())
    d["speed"] = np.sqrt(d["mLocalVel_x"] ** 2 + d["mLocalVel_y"] ** 2 + d["mLocalVel_z"] ** 2) * 3.6
    return d


def neighbours(d, L):
    """Nearest in-lane car ahead of each row: its distance, and closing speed inputs."""
    et = d["et"]
    ups = np.unique(et)
    order = np.argsort(et, kind="stable")
    bounds = list(np.searchsorted(et[order], ups)) + [len(et)]
    gap = np.full(len(et), np.inf)
    ahead_speed = np.full(len(et), np.nan)
    for k in range(len(ups)):
        ix = order[bounds[k]:bounds[k + 1]]
        ld, pl, sp = d["mLapDist"][ix], d["mPathLateral"][ix], d["speed"][ix]
        pit = d["mInPits"][ix] != 0
        g = (ld[None, :] - ld[:, None]) % L
        ok = (g > 0) & (g < L / 2) & (np.abs(pl[None, :] - pl[:, None]) < LANE_M) & ~pit[None, :] & ~pit[:, None]
        gm = np.where(ok, g, np.inf)
        j = gm.argmin(1)
        gi = gm[np.arange(len(ix)), j]
        gap[ix] = gi
        ahead_speed[ix] = np.where(np.isfinite(gi), sp[j], np.nan)
    d["gap"], d["ahead_speed"] = gap, ahead_speed


def straight_passes(d, a, b):
    out = []
    for cid in np.unique(d["mID"]):
        m = np.where(d["mID"] == cid)[0]
        m = m[np.argsort(d["et"][m])]
        idx = np.where((d["mLapDist"][m] >= a) & (d["mLapDist"][m] <= b))[0]
        if len(idx) == 0:
            continue
        for r in np.split(idx, np.where(np.diff(idx) != 1)[0] + 1):
            rr = m[r]
            ld = d["mLapDist"][rr]
            if len(rr) < 80 or ld.min() > a + 60 or ld.max() < b - 60 or (d["mInPits"][rr] != 0).any():
                continue
            if not np.all(np.diff(ld) > 0):
                continue
            sp, g = d["speed"][rr], d["gap"][rr]
            fin = np.isfinite(g).any()
            out.append(dict(cls=d["mVehicleClass"][rr[0]], entry=sp[ld < a + 100].mean(), exit=sp[ld > b - 100].mean(),
                            gmed=np.median(g), close=np.nanmean(sp - d["ahead_speed"][rr]) if fin else np.nan))
    return out


def tow_table(passes):
    rng = np.random.default_rng(1)
    print("\nTow: median km/h gained vs passes with the nearest car 80 m or more ahead (95% CI), n")
    for cls in sorted({p["cls"] for p in passes}):
        P = [p for p in passes if p["cls"] == cls]
        far = [p for p in P if p["gmed"] >= 80]
        if len(far) < 3:
            print(f"{cls}: {len(far)} far passes, no baseline")
            continue
        slope, icpt = np.polyfit([p["entry"] for p in far], [p["exit"] for p in far], 1)
        for lo, hi in ((0, 15), (15, 30), (30, 50), (50, 80)):
            r = np.array([p["exit"] - (icpt + slope * p["entry"]) for p in P if lo <= p["gmed"] < hi and abs(p["close"]) < 5])
            if len(r) < 3:
                print(f"{cls:6s} {lo:>2}-{hi:<3} m n={len(r)}")
                continue
            bs = [np.median(rng.choice(r, len(r))) for _ in range(2000)]
            print(f"{cls:6s} {lo:>2}-{hi:<3} m n={len(r):3d} {np.median(r):+5.2f} [{np.percentile(bs, 2.5):5.2f}, {np.percentile(bs, 97.5):5.2f}]  (far n={len(far)})")


def wrap(x, L):
    return (x + L / 2) % L - L / 2


def player_traffic(d, L):
    pl = d["mIsPlayer"] != 0
    m = np.where(pl)[0]
    m = m[np.argsort(d["et"][m])]
    oth = np.where(~pl)[0]
    oth = oth[np.argsort(d["et"][oth], kind="stable")]
    ue = np.unique(d["et"][oth])
    bd = list(np.searchsorted(d["et"][oth], ue)) + [len(oth)]
    row = {e: oth[bd[k]:bd[k + 1]] for k, e in enumerate(ue)}
    laps = d["mTotalLaps"][m]
    stat = {int(n): dict(ahead=0.0, behind=0.0, blue=0.0, made=0, suffered=0) for n in np.unique(laps)}
    prev = {}
    for i, e in enumerate(d["et"][m]):
        s = stat[int(laps[i])]
        if d["mFlag"][m][i] == 6:
            s["blue"] += 0.2
        if e not in row or d["mInPits"][m][i]:
            prev = {}
            continue
        ix = row[e][d["mInPits"][row[e]] == 0]
        sg = wrap(d["mLapDist"][ix] - d["mLapDist"][m][i], L)
        inl = np.abs(d["mPathLateral"][ix] - d["mPathLateral"][m][i]) < LANE_M
        near = np.abs(sg) < 150
        for cid, g in zip(d["mID"][ix][near], sg[near]):
            if cid in prev and prev[cid] * g < 0:
                s["made" if prev[cid] > 0 else "suffered"] += 1
        prev = {c: g for c, g in zip(d["mID"][ix][near], sg[near])}
        v = max(d["speed"][m][i] / 3.6, 20)
        ah, bh = sg[(sg > 0) & inl], -sg[(sg < 0) & inl]
        s["ahead"] += 0.2 * (len(ah) > 0 and ah.min() / v < 1)
        s["behind"] += 0.2 * (len(bh) > 0 and bh.min() / v < 1)
    print("\nPlayer traffic per lap (lap 0 is the standing start)")
    for n, s in stat.items():
        print(f" lap {n}: within 1 s ahead {s['ahead']:5.1f}  behind {s['behind']:5.1f}  blue {s['blue']:5.1f}  made {s['made']}  suffered {s['suffered']}")


if __name__ == "__main__":
    folder = sys.argv[1]
    a, b = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (4200.0, 5700.0)
    d = load(folder)
    L = float(np.nanmax(d["mLapDist"]))
    print(f"{len(np.unique(d['mID']))} cars, {len(np.unique(d['et']))} updates, lap length {L:.0f} m")
    neighbours(d, L)
    tow_table(straight_passes(d, a, b))
    player_traffic(d, L)
