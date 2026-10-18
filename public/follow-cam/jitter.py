"""How good is a 5 Hz, decimetre field for a follow camera?

Full-rate truth: the player's own capture (mElapsedTime, mPos_x, mPos_z, ~100 Hz).
Field-like input: every 20th sample (5 Hz), positions rounded to 0.1 m (what the stored field keeps).
Reconstruction: the viewer's own (Catmull-Rom, after a 0.6-sample gaussian), sampled at the full-rate times.
Reported: position error against truth, and the camera-relevant roughness (second difference of the path
sampled at 60 fps, metres per second squared), truth vs reconstruction.
"""
import subprocess, sys, tempfile
from pathlib import Path
import numpy as np

cap, t0, t1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
DK = r"C:\Users\Botkin\AppData\Local\Temp\duckdb-cli\duckdb.exe"
f = (Path(tempfile.mkdtemp()) / "p.csv").as_posix()
subprocess.run([DK, "-csv", "-c", f"copy (select mElapsedTime et, mPos_x x, mPos_z z from read_parquet('{Path(cap).as_posix()}/player-*.parquet') where mElapsedTime between {t0} and {t1} order by mElapsedTime) to '{f}' (header false)"], check=True)
a = np.loadtxt(f, delimiter=",")
et, x, z = a[:, 0], a[:, 1], a[:, 2]
keep = np.concatenate([[True], np.diff(et) > 1e-4]); et, x, z = et[keep], x[keep], z[keep]
print("full-rate samples", len(et), "median dt", round(float(np.median(np.diff(et))), 4), "s")
# 5 Hz field samples, decimetres
ft = np.arange(np.ceil(et[0] * 5) / 5, et[-1], 0.2)
fx = np.round(np.interp(ft, et, x), 1); fz = np.round(np.interp(ft, et, z), 1)


def gauss(v, sg):
    r = int(np.ceil(sg * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sg) ** 2); k /= k.sum()
    p = np.pad(v, r, mode="edge"); return np.convolve(p, k, mode="valid")


def catmull(v, tq):
    tt = (tq - ft[0]) / 0.2; i = np.clip(np.floor(tt).astype(int), 0, len(v) - 2); u = tt - i
    g = lambda j: v[np.clip(j, 0, len(v) - 1)]
    p0, p1, p2, p3 = g(i - 1), g(i), g(i + 1), g(i + 2)
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)


for label, sg in (("no smoothing", None), ("gaussian 0.6 samples", 0.6)):
    sx, sz = (fx, fz) if sg is None else (gauss(fx, sg), gauss(fz, sg))
    m = (et >= ft[1]) & (et <= ft[-2])
    rx, rz = catmull(sx, et[m]), catmull(sz, et[m])
    err = np.hypot(rx - x[m], rz - z[m])
    print(f"{label:22s} position error vs full rate: p50 {np.median(err):.2f} m  p95 {np.percentile(err, 95):.2f} m  max {err.max():.2f} m")
    # roughness at 60 fps
    tq = np.arange(ft[1], ft[-2], 1 / 60)
    tx, tz = np.interp(tq, et, x), np.interp(tq, et, z)
    qx, qz = catmull(sx, tq), catmull(sz, tq)
    acc = lambda a, b: np.hypot(np.diff(a, 2), np.diff(b, 2)) * 60 * 60
    at, aq = acc(tx, tz), acc(qx, qz)
    print(f"{'':22s} path acceleration at 60 fps (m/s2) truth p95 {np.percentile(at, 95):.1f}  reconstruction p95 {np.percentile(aq, 95):.1f}  p99 {np.percentile(aq, 99):.1f}")
