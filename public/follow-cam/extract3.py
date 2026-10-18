"""Build the follow-cam bundle from a tray field capture (every car at 5 Hz) plus the player's recording.

usage: uv run --with numpy extract3.py <capture dir> <player.duckdb> <base data js> <t0> <t1> <out.js>

- cars: every car in the window (class, model, number, position, the game's own height, orientation,
  speed, accelerations, pit flag). x/y are game-world metres east/north (field x, z), h is the
  game's height (mPos_y). The position frame was checked against the measured road (median 4.9 m).
- road elevation: median game height per 5 m of lap distance over every car in the window
  (the LMU recordings carry no height channel; the field's mPos_y is the game's own).
- player inputs: throttle, brake, steering, gear, rpm at the field's 5 Hz, aligned on the session clock.
- braking boards: where the player's brake goes on hard, per lap, clustered.
- sector gates: lap distance where cars change sector.
"""
import csv, json, math, re, subprocess, sys, tempfile
from pathlib import Path
import numpy as np

cap, player_db, base_js, t0, t1, out = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
DK = r"C:\Users\Botkin\AppData\Local\Temp\duckdb-cli\duckdb.exe"
tmp = Path(tempfile.mkdtemp())
FH = 5.0
txt = Path(base_js).read_text(encoding="utf8")
base = json.loads(txt[txt.index("=") + 1: txt.rindex(";")])
road = base["road"]; N = len(road["cx"]); BIN = base["bin"]; LEN = N * BIN
meta = json.load(open(Path(cap) / "meta.json"))

f = (tmp / "field.csv").as_posix()
subprocess.run([DK, "-csv", "-c", f"""copy (select mID id, et, mVehicleClass cls, mVehicleName vname, mIsPlayer pl, mInPits pit, mTotalLaps laps,
  mLapDist ld, mPlace place, mPos_x x, mPos_y h, mPos_z z, mLocalVel_x vx, mLocalVel_z vz, mLocalAccel_x ax, mLocalAccel_z az,
  mOri_0_x o0x, mOri_0_y o0y, mOri_0_z o0z, mOri_1_x o1x, mOri_1_y o1y, mOri_1_z o1z, mOri_2_x o2x, mOri_2_y o2y, mOri_2_z o2z,
  mSector sec, mHeadlights hl, mBestLapTime blt, mLocalRot_y rot from read_parquet('{Path(cap).as_posix()}/field-*.parquet') where et between {t0 - 1} and {t1 + 1} order by et, mID) to '{f}' (header true)"""], check=True)
rows = list(csv.DictReader(open(f, encoding="utf8")))
print("field rows", len(rows))
NT = int(round((t1 - t0) * FH)) + 1
ids = sorted({int(r["id"]) for r in rows})
car = {i: dict(cls="", vname="", pl=False, k=[], x=np.full(NT, np.nan), y=np.full(NT, np.nan), h=np.full(NT, np.nan), yaw=np.full(NT, np.nan), pitch=np.full(NT, np.nan),
               roll=np.full(NT, np.nan), blt=np.full(NT, -1.0), rot=np.full(NT, np.nan), v=np.full(NT, np.nan), lon=np.full(NT, np.nan), lat=np.full(NT, np.nan), ld=np.full(NT, np.nan), lap=np.zeros(NT), pit=np.zeros(NT), sec=np.zeros(NT), hl=np.zeros(NT)) for i in ids}
for r in rows:
    k = int(round((float(r["et"]) - t0) * FH))
    if not 0 <= k < NT: continue
    c = car[int(r["id"])]; c["cls"] = r["cls"]; c["vname"] = r["vname"]; c["pl"] = r["pl"] == "true"
    g = lambda n: float(r[n])
    fx, fy, fz = -g("o2x"), -g("o2y"), -g("o2z")          # forward = -local z
    rx, ry, rz = -g("o0x"), -g("o0y"), -g("o0z")          # right = -local x (local x is left)
    ux, uy, uz = g("o1x"), g("o1y"), g("o1z")
    c["x"][k] = g("x"); c["y"][k] = g("z"); c["h"][k] = g("h")
    c["yaw"][k] = math.atan2(fz, fx); c["pitch"][k] = -math.asin(max(-1, min(1, fy)))   # sign checked against the measured road slope: the matrix y is mirrored vs height
    c["roll"][k] = math.asin(max(-1, min(1, g("o0y"))))   # + = right side down (the right axis dips)
    c["v"][k] = math.hypot(g("vx"), g("vz")); c["lon"][k] = -g("az"); c["lat"][k] = g("ax")
    c["ld"][k] = g("ld"); c["lap"][k] = g("laps"); c["pit"][k] = 1 if r["pit"] == "true" else 0
    c["sec"][k] = g("sec") if r["sec"] != "" else 0; c["hl"][k] = g("hl"); c["blt"][k] = g("blt") if r["blt"] != "" else -1; c["rot"][k] = g("rot") if r["rot"] != "" else np.nan


def fillnan(a, wrap=None):
    idx = np.arange(len(a)); ok = ~np.isnan(a)
    if ok.sum() < 2: return np.nan_to_num(a)
    b = a.copy()
    if wrap is not None:
        u = np.unwrap(a[ok] * (2 * math.pi / wrap)) * (wrap / (2 * math.pi)); b[ok] = u
    return np.interp(idx, idx[ok], b[ok])


for i, c in car.items():
    for key in ["x", "y", "h", "v", "lon", "lat", "ld", "rot"]: c[key] = fillnan(c[key])
    for k in range(1, NT):
        if c["blt"][k] <= 0 and c["blt"][k - 1] > 0: c["blt"][k] = c["blt"][k - 1]
    c["yaw"] = fillnan(c["yaw"], wrap=2 * math.pi)
    for key in ["pitch", "roll"]: c[key] = fillnan(c[key])

# --- elevation from the game's own height ---------------------------------------------------
# per class, the game reports the car reference point a different height above the road: solve for it
classes = sorted({c["cls"] for c in car.values()}); cg = {k: 0.30 for k in classes}
for it in range(4):
    sums = [[] for _ in range(N)]
    for i, c in car.items():
        for k in range(NT):
            if c["pit"][k] == 0 and c["v"][k] > 15: sums[int(c["ld"][k] // BIN) % N].append(c["h"][k] - cg[c["cls"]])
    zg = np.array([np.median(s_) if len(s_) >= 3 else np.nan for s_ in sums])
    idx = np.arange(N); ok = ~np.isnan(zg); zg = np.interp(idx, idx[ok], zg[ok])
    res = {k: [] for k in classes}
    for i, c in car.items():
        for k in range(0, NT, 2):
            if c["pit"][k] == 0 and c["v"][k] > 25: res[c["cls"]].append(c["h"][k] - cg[c["cls"]] - zg[int(c["ld"][k] // BIN) % N])
    for k in classes: cg[k] += float(np.median(res[k]))
    mean = np.mean([cg[k] for k in classes]); cg = {k: v - mean + 0.30 for k, v in cg.items()}
print("reference point above road by class (m):", {k: round(v, 2) for k, v in cg.items()})
def gauss(a, sg):
    k = np.exp(-0.5 * (np.arange(-3 * sg, 3 * sg + 1) / sg) ** 2); k /= k.sum(); p = 3 * sg
    return np.convolve(np.concatenate([a[-p:], a, a[:p]]), k, mode="valid")


zg = gauss(zg, 2)
# road banking: the median body roll of every car per 5 m (camber dominates; body roll averages out left vs right)
rb = [[] for _ in range(N)]
for i, c in car.items():
    for k in range(NT):
        if c["pit"][k] == 0 and c["v"][k] > 15: rb[int(c["ld"][k] // BIN) % N].append(c["roll"][k])
bank = np.array([np.median(b) if len(b) >= 3 else np.nan for b in rb]); ok2 = ~np.isnan(bank); bank = np.interp(idx, idx[ok2], bank[ok2]); bank = gauss(bank, 2)
print("road bank range deg", round(math.degrees(bank.min()), 1), round(math.degrees(bank.max()), 1))
CG = 0.30                       # the game reports the car reference point; road surface sits about this far below it
zroad = zg
dem = np.array(road["z"]); off = float(np.mean(zroad - dem))
print("game height range", round(float(zg.min()), 1), round(float(zg.max()), 1), "vs DEM", round(float(dem.min() - dem.mean()), 1), round(float(dem.max() - dem.mean()), 1),
      "; game - DEM std", round(float(np.std(zroad - dem)), 2), "m")
terrain = dict(base["terrain"]); terrain["z"] = [round(v + off, 1) for v in terrain["z"]]

# --- player inputs on the field clock -------------------------------------------------------
def col(name):
    ff = (tmp / (name.replace(" ", "_") + ".csv")).as_posix()
    subprocess.run([DK, "-readonly", player_db, "-csv", "-c", f"copy (select value from \"{name}\" order by rowid) to '{ff}' (header false)"], check=True)
    return np.loadtxt(ff, delimiter=",")


ldv = col("Lap Dist"); wr = np.where(np.diff(ldv) < -1000)[0] + 1
pc = car[next(i for i, c in car.items() if c["pl"])]
# field clock: when the player's field lap distance wraps; recording clock: when Lap Dist wraps
fw = np.where(np.diff(pc["ld"]) < -1000)[0] + 1
print("player lap wraps in window (field et):", [round(t0 + w / FH, 1) for w in fw], " recording rows:", [round(w / 10, 1) for w in wr][:12])
# the recording starts at the first event; find the offset that makes the wraps agree
best = None
for w in wr:
    for v in fw:
        o = (t0 + v / FH) - w / 10
        score = sum(min(abs((t0 + vv / FH) - (ww / 10 + o)) for ww in wr) for vv in fw)
        if best is None or score < best[0]: best = (score, o)
off_t = best[1]
print("recording clock offset", round(off_t, 2), "(match error", round(best[0], 2), "s)")
chan = {k: col(n) for k, n in [("th", "Throttle Pos"), ("br", "Brake Pos"), ("st", "Steering Pos"), ("rpm", "Engine RPM")]}
rate = {"th": 50, "br": 50, "st": 100, "rpm": 100}
tt = t0 + np.arange(NT) / FH - off_t
inputs = {k: np.round(chan[k][np.clip(np.round(tt * rate[k]).astype(int), 0, len(chan[k]) - 1)], 1).tolist() for k in chan}
# gear: an event table
ff = (tmp / "gear.csv").as_posix()
subprocess.run([DK, "-readonly", player_db, "-csv", "-c", f"copy (select ts, value from \"Gear\" order by ts) to '{ff}' (header false)"], check=True)
gx = np.loadtxt(ff, delimiter=",", ndmin=2)
# Gear events are on the session clock already (like Lap): use et directly
gi = np.clip(np.searchsorted(gx[:, 0], t0 + np.arange(NT) / FH, side="right") - 1, 0, len(gx) - 1)
inputs["gear"] = gx[gi, 1].astype(int).tolist()

WB = 2.73
dl = np.array([WB * pc["rot"][k] / max(pc["v"][k], 1) for k in range(NT)]); stp = np.array(inputs["st"]); okf = np.array([pc["v"][k] > 20 and pc["pit"][k] == 0 for k in range(NT)])
a_fit = float(np.sum(dl[okf] * stp[okf]) / np.sum(dl[okf] ** 2)); corr = float(np.corrcoef(dl[okf], stp[okf])[0, 1])
print("steering fit: wheel pct =", round(a_fit, 1), "* (L*yawrate/v); corr", round(corr, 2))

# --- braking boards: where the player brakes hard, per lap, clustered -----------------------
br = inputs["br"]; ld = pc["ld"]; onsets = []; on = False
for k in range(NT):
    if not on and br[k] > 55: on = True; onsets.append(float(ld[k]))
    elif on and br[k] < 10: on = False
cl = []
for o in sorted(onsets):
    if cl and abs(cl[-1][-1] - o) < 120 or (cl and abs(cl[-1][-1] - o) > LEN - 120): cl[-1].append(o)
    else: cl.append([o])
brake_zones = [round(float(np.median(c)), 1) for c in cl if len(c) >= 1]
print("braking zones (m):", brake_zones)

# --- sector gates -----------------------------------------------------------------------------
gates = {}
for i, c in car.items():
    s = c["sec"]
    for k in range(1, NT):
        if s[k] != s[k - 1] and c["v"][k] > 20: gates.setdefault((int(s[k - 1]), int(s[k])), []).append(float(c["ld"][k]))
sector = {f"{a}-{b}": round(float(np.median(v)), 1) for (a, b), v in gates.items() if len(v) >= 3}
print("sector gates", sector)

# --- write --------------------------------------------------------------------------------------
def r(a, d=2): return np.round(np.asarray(a), d).tolist()
cars = []
for i, c in car.items():
    num = re.search(r"#(\S+?)(?::|$)", c["vname"]); team = re.sub(r"\s+\d{4}.*$", "", c["vname"]).strip()
    cars.append(dict(id=i, cls=c["cls"], model=meta["vehicleModels"].get(str(i), ""), team=team, num=num.group(1) if num else str(i), pl=bool(c["pl"]),
                     x=r(c["x"]), y=r(c["y"]), h=r(c["h"] - cg[c["cls"]]), yaw=r(c["yaw"], 3), pitch=r(c["pitch"], 3), roll=r(c["roll"], 3), v=r(c["v"], 1),
                     lon=r(c["lon"], 1), lat=r(c["lat"], 1), blt=r(c["blt"], 3), rot=r(c["rot"], 3), ld=r(c["ld"], 1), lap=c["lap"].astype(int).tolist(), pit=c["pit"].astype(int).tolist(), hl=c["hl"].astype(int).tolist()))
cars.sort(key=lambda c: (not c["pl"], c["cls"], c["id"]))
data = dict(track=base["track"], lengthM=LEN, bin=BIN, hz=FH, t0=t0, t1=t1,
            road=dict(cx=road["cx"], cy=road["cy"], hl=road["hl"], hr=road["hr"], z=r(zroad), bank=r(bank, 4)), terrain=terrain,
            cars=cars, steer=dict(k=round(a_fit, 2), corr=round(corr, 3), wheelbase=WB), inputs=inputs, brakeZones=brake_zones, sector=sector)
Path(out).write_text("window.FOLLOW_DATA=" + json.dumps(data, separators=(",", ":")) + ";\n")
print("wrote", out, round(Path(out).stat().st_size / 1e6, 2), "MB;", len(cars), "cars,", NT, "samples")
