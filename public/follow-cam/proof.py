"""Numbers behind two ideas for thread 88, from Botkin's 17 Oct Portimao practice.
(a) faster-class passes of the player in the field window; (b) brake-on distance spread per braking zone over every clean lap.
usage: uv run --with numpy proof.py <data-portimao.js> <recording.duckdb>...
"""
import json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np

t = Path(sys.argv[1]).read_text(encoding="utf8"); d = json.loads(t[t.index("=") + 1: t.rindex(";")])
LEN = d["lengthM"]; NT = len(d["cars"][0]["x"]); pl = next(c for c in d["cars"] if c["pl"])
def prog(c):
    ld = np.array(c["ld"]); off = 0; out = [ld[0]]
    for i in range(1, len(ld)):
        dd = ld[i] - ld[i - 1]; off += LEN if dd < -LEN / 2 else (-LEN if dd > LEN / 2 else 0); out.append(ld[i] + off)
    return np.array(out)
pp = prog(pl); passes = {"Hyper": [], "LMP2": [], "GT3": []}
for c in d["cars"]:
    if c["pl"] or c["cls"] == "GT3": continue
    diff = prog(c) - pp
    for i in range(1, NT):
        if diff[i - 1] < 0 <= diff[i] and abs(diff[i]) < 60:
            passes[c["cls"]].append((i / 5, (c["v"][i] - pl["v"][i]) * 3.6, float(pl["ld"][i])))
print("(a) cars of a faster class that passed the player in", NT / 5, "s:")
for k, v in passes.items():
    if v: print("   ", k, len(v), "passes, mean closing speed at the pass", round(float(np.mean([x[1] for x in v])), 0), "km/h, at lap distance", [round(x[2]) for x in v][:8])
print("    passes per minute", round(sum(len(v) for v in passes.values()) / (NT / 5 / 60), 1))

DK = r"C:\Users\Botkin\AppData\Local\Temp\duckdb-cli\duckdb.exe"; tmp = Path(tempfile.mkdtemp())
def col(rec, n):
    f = (tmp / (n.replace(" ", "_") + ".csv")).as_posix()
    subprocess.run([DK, "-readonly", rec, "-csv", "-c", f'copy (select value from "{n}" order by rowid) to \'{f}\' (header false)'], check=True); return np.loadtxt(f, delimiter=",")
zones = d["brakeZones"]; on = {z: [] for z in zones}; laps = 0
for rec in sys.argv[2:]:
    ld = col(rec, "Lap Dist"); br = col(rec, "Brake Pos"); wraps = np.where(np.diff(ld) < -1000)[0] + 1
    for a, b in zip(wraps[:-1], wraps[1:]):
        if b - a < 900 or b - a > 1200: continue            # a clean lap: 90 to 120 s at 10 Hz
        laps += 1; l = ld[a:b]; bb = br[np.clip((np.arange(a, b) * 5), 0, len(br) - 1)]; state = False
        for i in range(len(l)):
            if not state and bb[i] > 55:
                state = True
                z = min(zones, key=lambda q: abs(q - l[i]))
                if abs(z - l[i]) < 120: on[z].append(float(l[i]))
            elif state and bb[i] < 10: state = False
print("(b) brake-on distance per zone over", laps, "laps (m before/after the zone's median):")
for z, v in on.items():
    if len(v) >= 3: v = np.array(v); print("   zone", round(z), "n", len(v), "median", round(float(np.median(v)), 1), "p10..p90 spread", round(float(np.percentile(v, 90) - np.percentile(v, 10)), 1), "m, range", round(float(v.max() - v.min()), 1), "m")
