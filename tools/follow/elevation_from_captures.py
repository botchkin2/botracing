"""A stand-in elevation profile per LMU track, from the tray's local field captures.

The LMU recordings carry no height; the live capture does (mPos_y, the game's own world height, for every car).
For each track, the median height per 10 m of lap distance over every car on track (pit lane excluded),
less the car reference point above the road, smoothed and closed into a loop. Stored by lap FRACTION so any
distance ruler (the map's, the surface's, the game's) can sample it.

This is a stand-in for atlas's curated `elevation` track field (pit wall thread 86); it exists so the Race
screen's chase view has height before that lands. Local data only: captures are pruned after 14 days.

usage: uv run --with numpy tools/follow/elevation_from_captures.py <out.json>
"""
import json, os, re, subprocess, sys, tempfile
from pathlib import Path
import numpy as np

DK = os.environ.get("DUCKDB") or r"C:\Users\Botkin\AppData\Local\Temp\duckdb-cli\duckdb.exe"
root = Path(os.environ["LOCALAPPDATA"]) / "lap-capture"
out = sys.argv[1]
STEP = 10.0
CG = 0.30
by_track = {}
for d in sorted(root.iterdir()):
    mp = d / "meta.json"
    if not mp.exists(): continue
    meta = json.loads(mp.read_text(encoding="utf8"))
    if meta.get("sim") not in (None, "lmu") or not list(d.glob("field-*.parquet")): continue
    by_track.setdefault(meta["track"], []).append(d)


def slug(s): return re.sub(r"^_|_$", "", re.sub(r"[^a-z0-9]+", "_", s.lower()))


def gauss(a, sg):
    p = int(np.ceil(3 * sg)); k = np.exp(-0.5 * (np.arange(-p, p + 1) / sg) ** 2); k /= k.sum()
    return np.convolve(np.concatenate([a[-p:], a, a[:p]]), k, mode="valid")


result = {}
for track, dirs in by_track.items():
    files = ", ".join("'" + (d / "field-*.parquet").as_posix() + "'" for d in dirs)
    f = (Path(tempfile.mkdtemp()) / "e.csv").as_posix()
    # one pass: per 10 m bin, the median height and the count; lap length as the largest lap distance
    q = f"""copy (select cast(floor(mLapDist / {STEP}) as int) b, median(mPos_y) h, count(*) n, max(mLapDist) len
      from read_parquet([{files}], union_by_name=true)
      where mInPits = false and mLapDist >= 0 and abs(mLocalVel_z) > 15 group by b order by b) to '{f}' (header false)"""
    subprocess.run([DK, "-csv", "-c", q], check=True)
    a = np.loadtxt(f, delimiter=",")
    length = float(a[:, 3].max()); nb = int(length // STEP)
    h = np.full(nb, np.nan); n = np.zeros(nb)
    for b, hh, cnt, _ in a:
        if 0 <= b < nb: h[int(b)] = hh; n[int(b)] = cnt
    ok = n >= 5
    if ok.sum() < nb * 0.8:
        print(track, "skipped: only", int(ok.sum()), "of", nb, "bins have 5 or more samples"); continue
    h = np.where(ok, h, np.nan); idx = np.arange(nb); h = np.interp(idx, idx[~np.isnan(h)], h[~np.isnan(h)])
    h = gauss(h, 1.5) - CG
    h = h - np.linspace(0, h[-1] - h[0], nb)          # a closed loop closes
    result["lmu-" + slug(track)] = dict(track=track, lengthM=round(length, 1), stepM=STEP, heightM=np.round(h, 2).tolist(),
                                       captures=len(dirs), rangeM=round(float(h.max() - h.min()), 1))
    print(track, "->", "lmu-" + slug(track), "bins", nb, "range", round(float(h.max() - h.min()), 1), "m, captures", len(dirs))
Path(out).write_text(json.dumps(result, separators=(",", ":")))
print("wrote", out, round(Path(out).stat().st_size / 1e3), "kB")
