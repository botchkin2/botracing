// Chase view engine for the Race screen (prototype). The app owns the data and the clock; this draws one frame of it
// as an instrument: near-black ground, the road at its measured width as a flat fill with thin edges, every car a flat
// wedge in its class colour (yours in the accent), the player's inputs painted on the road. Nothing is drawn that the data
// does not hold: no sky, grass, kerbs, gravel, liveries, banking or height the track does not have.
// Loaded at runtime on web only, with three.js, from /follow-cam/.
//
//   mountChase(container, THREE, {onPick, theme}) -> {setRoad, setInputs, update, setCam, dispose}
//   theme: {bg, fill, edge, edgeFaint, text, muted, line, accent, good, bad}   (the app's design tokens)
//   setRoad({stepM, lengthM, cx[], cy[], hl[], hr[], elev: number[] | null})   world metres, x east, y north (the sim's x, z)
//   setInputs({x[], y[], th[], br[], stepM} | null)                             the player's lap as driven
//   update({cars, focus, playing, rate, inputIdx})                               car: {index, xM, zM, headingRad|null, speedKmh, carClass, color, player, lapDistM, label, state}
//
// World frame here: x east, y north, z up. Three.js frame: (x, z, -y).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (a, n) => ((a % n) + n) % n;
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => mod(b - a + Math.PI, TAU) - Math.PI;
// frame-rate independent exponential approach: the fraction of the gap closed in dt with time constant tau
const ease = (dt, tau) => 1 - Math.exp(-dt / tau);

// real car footprints by class (length x width, metres): the class nominal, the data carries no model dimensions
const SIZE = { Hyper: [5.0, 2.0], LMP2: [4.75, 1.9], GT3: [4.65, 1.95] };

export async function mountChase(container, THREE, { onPick, theme } = {}) {
  const T = Object.assign({ bg: '#0d0f12', fill: '#1a1d22', edge: '#4d555d', edgeFaint: '#343a42', text: '#e4e7ea', muted: '#8a929b', line: '#2e343a', accent: '#fea92f', good: '#65e287', bad: '#ed4a49' }, theme);
  const setV = (v, x, y, z) => v.set(x, z, -y);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(new THREE.Color(T.bg), 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  const el = renderer.domElement; el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none'; container.appendChild(el);
  const chips = document.createElement('div'); chips.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'; container.appendChild(chips);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(T.bg); scene.fog = new THREE.Fog(new THREE.Color(T.bg), 260, 1500);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 6000);

  // ---- road (rebuilt on setRoad) ----
  const world = new THREE.Group(); scene.add(world);
  let R = null, N = 0, BIN = 10, LEN = 0, hdg, rnx, rny, curv, zr, hasElev = false, dirty = true;
  const roadZ = s => { if (!zr) return 0; const f = mod(s / BIN, N), i = Math.floor(f), t = f - i; return lerp(zr[i], zr[(i + 1) % N], t); };
  const widthAt = (s, side) => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i, w = side < 0 ? R.hl : R.hr; return lerp(w[i], w[(i + 1) % N], t); };
  const curvAt = s => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i; return lerp(curv[i], curv[(i + 1) % N], t); };
  const tangentAt = s => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i, j = (i + 1) % N; return Math.atan2(lerp(Math.sin(hdg[i]), Math.sin(hdg[j]), t), lerp(Math.cos(hdg[i]), Math.cos(hdg[j]), t)); };
  const grid = new Map(), CELLN = 100, gkey = (a, b) => a * 100003 + b, nr = { d: 0, s: 0, side: 1 };
  function nearestRoad(x, y, reach = 3) {
    const cx0 = Math.floor(x / CELLN), cy0 = Math.floor(y / CELLN); let best = 1e18, bs = 0, bside = 1, found = false;
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) { const arr = grid.get(gkey(cx0 + a, cy0 + b)); if (!arr) continue;
      for (const i of arr) { const j = (i + 1) % N, dx = R.cx[j] - R.cx[i], dy = R.cy[j] - R.cy[i], t = clamp(((x - R.cx[i]) * dx + (y - R.cy[i]) * dy) / (dx * dx + dy * dy || 1), 0, 1), px = R.cx[i] + dx * t, py = R.cy[i] + dy * t, d2 = (x - px) ** 2 + (y - py) ** 2; if (d2 < best) { best = d2; bs = (i + t) * BIN; bside = ((x - px) * rnx[i] + (y - py) * rny[i]) >= 0 ? 1 : -1; found = true; } } }
    nr.d = found ? Math.sqrt(best) : 1e9; nr.s = bs; nr.side = bside; return found;
  }
  const flat = (c, extra) => new THREE.MeshBasicMaterial(Object.assign({ color: new THREE.Color(c) }, extra));
  function ribbon(rows, cols, at, material, order = 0) {
    const pos = new Float32Array(rows * cols * 3), out = { x: 0, y: 0, z: 0 };
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { at(r, k, out); const o = (r * cols + k) * 3; pos[o] = out.x; pos[o + 1] = out.z; pos[o + 2] = -out.y; }
    const idx = []; for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) { const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, material); m.renderOrder = order; return m;
  }
  const rowPt = (r, lam, lift, out) => { const i = r % N; out.x = R.cx[i] + rnx[i] * lam; out.y = R.cy[i] + rny[i] * lam; out.z = zr[i] + lift; };
  function setRoad(road) {
    while (world.children.length) { const o = world.children.pop(); o.traverse?.(n => n.geometry?.dispose()); }
    R = road; N = road.cx.length; BIN = road.stepM; LEN = N * BIN; grid.clear();
    hdg = new Float64Array(N); rnx = new Float64Array(N); rny = new Float64Array(N); curv = new Float64Array(N); zr = new Float64Array(N);
    for (let i = 0; i < N; i++) { const a = (i - 1 + N) % N, b = (i + 1) % N; hdg[i] = Math.atan2(road.cy[b] - road.cy[a], road.cx[b] - road.cx[a]); rnx[i] = Math.sin(hdg[i]); rny[i] = -Math.cos(hdg[i]); const k = gkey(Math.floor(road.cx[i] / CELLN), Math.floor(road.cy[i] / CELLN)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -3; k < 3; k++) s += angDiff(hdg[mod(i + k, N)], hdg[mod(i + k + 1, N)]); curv[i] = s / (6 * BIN); }
    // height only where the track has it (the curated profile), by lap fraction; otherwise the road is flat at 0
    const E = road.elev; hasElev = !!(E && E.length > 3);
    for (let i = 0; i < N; i++) { if (!hasElev) { zr[i] = 0; continue; } const f = (i / N) * E.length, a = Math.floor(f) % E.length, t = f - Math.floor(f); zr[i] = lerp(E[a], E[(a + 1) % E.length], t); }
    // the road at its measured width: a flat fill, thin edges
    world.add(ribbon(N + 1, 2, (r, k, o) => { const i = r % N; rowPt(r, k ? R.hr[i] : -R.hl[i], 0, o); }, flat(T.fill), 0));
    for (const side of [-1, 1]) world.add(ribbon(N + 1, 2, (r, k, o) => { const i = r % N, hw = side < 0 ? R.hl[i] : R.hr[i]; rowPt(r, side * (hw - (k ? 0 : .38)), .02, o); }, flat(T.edge), 1));
    // height made readable without scenery: where there is a measured profile, a faint drop line from each edge every 20 m
    if (hasElev) {
      let lo = Infinity; for (let i = 0; i < N; i++) lo = Math.min(lo, zr[i]); const datum = lo - 2, pos = [];
      for (let i = 0; i < N; i += Math.max(1, Math.round(20 / BIN))) for (const side of [-1, 1]) { const hw = side < 0 ? R.hl[i] : R.hr[i], x = R.cx[i] + rnx[i] * side * hw, y = R.cy[i] + rny[i] * side * hw; pos.push(x, zr[i], -y, x, datum, -y); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); world.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(T.edgeFaint) })));
    }
    // the start line, flat on the road
    world.add(ribbon(2, 2, (r, k, o) => { const i = 0, lam = k ? R.hr[i] : -R.hl[i]; o.x = R.cx[i] + rnx[i] * lam + Math.cos(hdg[i]) * (r ? 1.2 : 0); o.y = R.cy[i] + rny[i] * lam + Math.sin(hdg[i]) * (r ? 1.2 : 0); o.z = zr[i] + .03; }, flat(T.text), 1));
  }

  // ---- the player's inputs painted on the road ahead, and distance ticks at the road edge ----
  let ribbonMesh = null, ribbonN = 0, inputIdx = -1, rbData = null; const tickGroup = new THREE.Group(); scene.add(tickGroup);
  function setInputs(rb) {
    if (ribbonMesh) { scene.remove(ribbonMesh); ribbonMesh.geometry.dispose(); ribbonMesh = null; }
    while (tickGroup.children.length) { const o = tickGroup.children.pop(); o.geometry?.dispose(); }
    ribbonN = 0; rbData = rb; if (!rb || !R || rb.x.length < 8) { dirty = true; return; }
    const n = rb.x.length, pos = new Float32Array(n * 6), col = new Float32Array(n * 6), cc = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), hd = Math.atan2(rb.y[b] - rb.y[a], rb.x[b] - rb.x[a]), nx = -Math.sin(hd) * .3, ny = Math.cos(hd) * .3;
      let z = 0; if (nearestRoad(rb.x[k], rb.y[k], 3)) z = roadZ(nr.s);
      for (const [j, sg] of [[0, 1], [1, -1]]) { const o = (k * 2 + j) * 3; pos[o] = rb.x[k] + nx * sg; pos[o + 1] = z + .06; pos[o + 2] = -(rb.y[k] + ny * sg); }
      const br = rb.br[k], th = rb.th[k]; cc.set(br > 4 ? T.bad : th > 96 ? T.good : th > 8 ? T.accent : T.muted);
      for (let j = 0; j < 2; j++) { const o = (k * 2 + j) * 3; col[o] = cc.r; col[o + 1] = cc.g; col[o + 2] = cc.b; }
    }
    const idx = []; for (let k = 0; k < n - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
    ribbonMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
    ribbonMesh.frustumCulled = false; ribbonMesh.renderOrder = 3; scene.add(ribbonMesh); ribbonN = n;
    // 150, 100 and 50 m before each brake-on: 3, 2 and 1 bars across the road edge, on the outside of the corner (the player's own braking)
    const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(T.text), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 });
    const step = rb.stepM; let on = false;
    for (let k = 0; k < n; k++) {
      if (!on && rb.br[k] > 55) { on = true;
        const k2 = Math.min(n - 1, k + 12), k3 = Math.min(n - 1, k + 24), turn = (rb.x[k2] - rb.x[k]) * (rb.y[k3] - rb.y[k2]) - (rb.y[k2] - rb.y[k]) * (rb.x[k3] - rb.x[k2]), side = turn > 0 ? -1 : 1;
        for (const [dist, bars] of [[150, 3], [100, 2], [50, 1]]) { const kk = k - Math.round(dist / step); if (kk < 1 || kk >= n - 1) continue;
          const hd = Math.atan2(rb.y[kk + 1] - rb.y[kk - 1], rb.x[kk + 1] - rb.x[kk - 1]); let hw = 7, z = 0; if (nearestRoad(rb.x[kk], rb.y[kk], 3)) { hw = widthAt(nr.s, nr.side); z = roadZ(nr.s); }
          for (let b = 0; b < bars; b++) { const along = b * .9, cx = rb.x[kk] + Math.cos(hd) * along + Math.sin(hd) * side * (hw - .9), cy = rb.y[kk] + Math.sin(hd) * along - Math.cos(hd) * side * (hw - .9);
            const m = new THREE.Mesh(new THREE.PlaneGeometry(.38, 1.7), barMat); m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, hd - Math.PI / 2, 0); m.position.set(cx, z + .05, -cy); tickGroup.add(m); } }
      } else if (on && rb.br[k] < 10) on = false;
    }
    dirty = true;
  }

  // ---- cars: a flat chevron on the road plane at the class footprint, a short heading tick, a thin edge; the player keeps
  // the class colour and is marked by a white edge and a ring on the road ----
  const geos = {};
  function chevron(cls) {
    if (geos[cls]) return geos[cls]; const [L, W] = SIZE[cls] || SIZE.GT3, s = new THREE.Shape();
    s.moveTo(L / 2, 0); s.lineTo(L * .12, W / 2); s.lineTo(-L / 2, W * .46); s.lineTo(-L / 2 + .55, 0); s.lineTo(-L / 2, -W * .46); s.lineTo(L * .12, -W / 2); s.closePath();
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2);   // shape (x, y) lies on the ground as (x, -z)
    const pts = s.getPoints().map(p => new THREE.Vector3(p.x, 0, -p.y)), edge = new THREE.BufferGeometry().setFromPoints(pts);
    const tick = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(L / 2, 0, 0), new THREE.Vector3(L / 2 + 1.3, 0, 0)]);
    return (geos[cls] = { g, edge, tick });
  }
  const carObjs = new Map(), chipEls = new Map(), hist = new Map(), states = new Map(), tmpP = new THREE.Vector3();
  const ringGeo = new THREE.RingGeometry(3.2, 3.3, 64); ringGeo.rotateX(-Math.PI / 2);
  function makeCar(c) {
    const { g, edge, tick } = chevron(c.carClass), grp = new THREE.Group(), line = c.player ? '#ffffff' : T.bg;
    const body = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(c.color), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const outline = new THREE.LineLoop(edge, new THREE.LineBasicMaterial({ color: new THREE.Color(line) })), nose = new THREE.Line(tick, new THREE.LineBasicMaterial({ color: new THREE.Color(c.color) }));
    outline.position.y = nose.position.y = .03; grp.add(body, outline, nose);
    if (c.player) grp.add(new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    grp.userData = { body, player: !!c.player }; return grp;
  }

  // ---- camera: a smoothed follow, no bounce ----
  const cam = { x: 0, y: 0, z: 0, yaw: 0, lx: 0, ly: 0, lz: 0, mode: 0, init: false, orbit: 0 };
  let camMode = 1, tvRig = null, st = { cars: [], focus: null, playing: false, rate: 1 }, last = performance.now(), alive = true;
  const camTarget = new THREE.Vector3(), RIG_EVERY = 45;
  function rigAt(bi) { const i = mod(bi, N), s = i * BIN, side = curv[i] > 0 ? 1 : -1, off = (side > 0 ? R.hr[i] : R.hl[i]) + 18; return { s, x: R.cx[i] + rnx[i] * side * off, y: R.cy[i] + rny[i] * side * off, z: roadZ(s) + 5 }; }
  function updateCam(dt, me) {
    const dirx = Math.cos(me.hd), diry = Math.sin(me.hd); let px, py, pz, lx, ly, lz, tp = .28, tl = .2;
    const hard = !cam.init || cam.mode !== camMode || !st.playing;
    if (camMode === 1 || camMode === 2) {
      const back = camMode === 1 ? 11 : 18, up = camMode === 1 ? 4.2 : 8, ahead = 32;
      if (hard) cam.yaw = me.hd; cam.yaw += angDiff(cam.yaw, me.hd + clamp(curvAt(me.ld + 30) * 18, -.12, .12)) * (hard ? 1 : ease(dt, .5));
      const cx = Math.cos(cam.yaw), cy = Math.sin(cam.yaw);
      px = me.x - cx * back; py = me.y - cy * back; pz = Math.max(me.z + up, roadZ(me.ld - back) + 1.4); lx = me.x + cx * ahead; ly = me.y + cy * ahead; lz = roadZ(me.ld + ahead) + .6;
    } else if (camMode === 3) {
      if (!tvRig) tvRig = rigAt(Math.floor(me.ld / BIN / RIG_EVERY) * RIG_EVERY + RIG_EVERY);
      const ahead = mod(tvRig.s - me.ld + LEN / 2, LEN) - LEN / 2; if (ahead < -60 || ahead > 650) tvRig = rigAt(Math.ceil((me.ld + 160) / BIN / RIG_EVERY) * RIG_EVERY);
      px = tvRig.x; py = tvRig.y; pz = tvRig.z; lx = me.x + dirx * 3; ly = me.y + diry * 3; lz = me.z + .4; tp = 0; tl = .25;
    } else { if (hard && cam.mode !== camMode) cam.orbit = 0; const oa = me.hd + Math.PI + cam.orbit; px = me.x + Math.cos(oa) * 60; py = me.y + Math.sin(oa) * 60; pz = me.z + 42; lx = me.x + dirx * 8; ly = me.y + diry * 8; lz = me.z; tp = .6; tl = .3; }
    const kp = hard || tp === 0 ? 1 : ease(dt, tp), kl = hard ? 1 : ease(dt, tl), kz = hard || tp === 0 ? 1 : ease(dt, tp * 1.4);
    cam.x = lerp(cam.x, px, kp); cam.y = lerp(cam.y, py, kp); cam.z = lerp(cam.z, pz, kz); cam.lx = lerp(cam.lx, lx, kl); cam.ly = lerp(cam.ly, ly, kl); cam.lz = lerp(cam.lz, lz, kl); cam.mode = camMode; cam.init = true;
    setV(camera.position, cam.x, cam.y, cam.z); setV(camTarget, cam.lx, cam.ly, cam.lz); camera.up.set(0, 1, 0); camera.lookAt(camTarget);
    const fov = camMode === 3 ? clamp(2 * Math.atan(14 / Math.max(Math.hypot(lx - px, ly - py, lz - pz), 1)) * 180 / Math.PI, 12, 55) 
      : camMode === 1 ? 50 + clamp(me.v / 80, 0, 1) * 9 : 55;
    if (Math.abs(camera.fov - fov) > .01) { camera.fov = lerp(camera.fov, fov, hard ? 1 : ease(dt, .3)); camera.updateProjectionMatrix(); }
  }

  // ---- ingest: the road gives each car its height, pitch and (against a flipped sample) its heading ----
  function ingest(cars) {
    const seen = new Set();
    for (const c of cars) {
      if (c.state === 'garage' || !isFinite(c.xM)) continue; seen.add(c.index);
      const h = hist.get(c.index), x = c.xM, y = c.zM; let trav = h ? h.trav : null;
      if (h) { const dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy); if (d > 40) trav = null; else if (d > .25) { const a = Math.atan2(dy, dx); trav = trav == null ? a : trav + angDiff(trav, a) * .5; } }
      let onRoad = false, tan = null, z = R ? roadZ(mod(c.lapDistM || 0, LEN || 1)) : 0, grade = 0, s = 0;
      if (R && nearestRoad(x, y, 3)) { s = nr.s; tan = tangentAt(s); z = roadZ(s); if (nr.d < widthAt(s, nr.side) + 3) { onRoad = true; grade = (roadZ(s + 4) - roadZ(s - 4)) / 8; } }
      const yawG = c.headingRad == null ? null : Math.PI / 2 - c.headingRad; let hd;
      if (yawG != null && (!onRoad || tan == null || Math.abs(angDiff(yawG, tan)) < .9 || (trav != null && Math.abs(angDiff(yawG, trav)) < .9))) hd = yawG;
      else if (trav != null && c.speedKmh > 8) hd = trav; else hd = tan ?? yawG ?? 0;
      hist.set(c.index, { x, y, trav });
      const t = { x, y, z, hd, pitch: onRoad ? Math.atan(grade) : 0, v: c.speedKmh / 3.6, ld: onRoad ? s : mod(c.lapDistM, LEN || 1), onRoad };
      const p = states.get(c.index); if (p) { p.tgt = t; p.c = c; p.v = t.v; } else states.set(c.index, Object.assign({}, t, { tgt: t, c }));
    }
    for (const k of [...states.keys()]) if (!seen.has(k)) { states.delete(k); hist.delete(k); const o = carObjs.get(k); if (o) { scene.remove(o); carObjs.delete(k); } const e = chipEls.get(k); if (e) { e.remove(); chipEls.delete(k); } }
  }
  function render(dt) {
    const me0 = st.focus != null && states.has(st.focus) ? st.focus : ([...states.values()].find(s => s.c.player)?.c.index ?? [...states.keys()][0]);
    if (!R || me0 == null) { renderer.render(scene, camera); return; }
    // the 5 Hz field is interpolated by the app; the pose here glides toward it, so a car never steps
    for (const s of states.values()) { const t = s.tgt, jump = Math.hypot(t.x - s.x, t.y - s.y) > 12, k = !st.playing || jump ? 1 : ease(dt, .07); s.x = lerp(s.x, t.x, k); s.y = lerp(s.y, t.y, k); s.z = lerp(s.z, t.z, k); s.hd += angDiff(s.hd, t.hd) * k; s.pitch = lerp(s.pitch, t.pitch, k); s.ld = t.ld; s.onRoad = t.onRoad; }
    const me = states.get(me0);
    for (const [k, s] of states) { let o = carObjs.get(k); if (o && o.userData.player !== !!s.c.player) { scene.remove(o); o = null; } if (!o) { o = makeCar(s.c); scene.add(o); carObjs.set(k, o); } o.userData.body.material.color.set(s.c.color); setV(o.position, s.x, s.y, s.z + .06); o.rotation.order = 'YZX'; o.rotation.set(0, s.hd, s.pitch); }
    updateCam(dt, me);
    const mine = states.get(me0)?.c.player === true;
    if (ribbonMesh) { const i0 = clamp(inputIdx + 1, 0, ribbonN - 2), cnt = clamp(Math.min(70, ribbonN - 2 - i0), 0, 70); ribbonMesh.geometry.setDrawRange(i0 * 6, cnt * 6); ribbonMesh.visible = mine && inputIdx >= 0; }
    tickGroup.visible = mine;
    renderer.render(scene, camera);
    // class position over the nearest cars: mono, flat, in the app's tokens
    const near = new Set([...states.entries()].filter(([k, s]) => k !== me0 && Math.hypot(s.x - me.x, s.y - me.y) < 120).sort((a, b) => Math.hypot(a[1].x - me.x, a[1].y - me.y) - Math.hypot(b[1].x - me.x, b[1].y - me.y)).slice(0, 8).map(([k]) => k));
    for (const [k, s] of states) {
      let e = chipEls.get(k); if (!e) { e = document.createElement('div'); e.style.cssText = `position:absolute;left:0;top:0;padding:0 5px;border-radius:2px;background:rgba(13,15,18,.88);border:1px solid ${T.line};font:500 11px "IBM Plex Mono",Consolas,monospace;color:${T.text};white-space:nowrap;display:none;will-change:transform`; chips.appendChild(e); chipEls.set(k, e); }
      const d = Math.hypot(s.x - me.x, s.y - me.y); setV(tmpP, s.x, s.y, s.z + 1.6); tmpP.project(camera);
      const ok = near.has(k) && s.c.label && tmpP.z < 1 && tmpP.z > -1 && Math.abs(tmpP.x) < 1.05 && Math.abs(tmpP.y) < 1.05; e.style.display = ok ? 'block' : 'none';
      if (ok) { e.textContent = s.c.label; e.style.borderColor = s.c.color; e.style.transform = `translate(${((tmpP.x * .5 + .5) * container.clientWidth).toFixed(0)}px,${((-tmpP.y * .5 + .5) * container.clientHeight).toFixed(0)}px) translate(-50%,-100%)`; e.style.opacity = clamp(1.5 - d / 100, .45, 1); }
    }
  }
  function frame(now) { if (!alive) return; const dt = Math.min(.05, (now - last) / 1000); last = now; if (dirty || st.playing) { dirty = false; render(dt); } requestAnimationFrame(frame); }
  function resize() { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  // press: the nearest car within a finger's reach; heli: drag to look around
  let drag = null;
  el.addEventListener('pointerdown', e => { drag = { x: e.clientX, o: cam.orbit, moved: false }; });
  const move = e => { if (drag && camMode === 4) { const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; cam.orbit = drag.o - dx * .008; dirty = true; } }, up = () => setTimeout(() => { drag = null; }, 0);
  addEventListener('pointermove', move); addEventListener('pointerup', up);
  el.addEventListener('click', e => {
    if (drag && drag.moved) return; const r = el.getBoundingClientRect(); let best = null, bd = 46;
    for (const [k, s] of states) { setV(tmpP, s.x, s.y, s.z + .4); tmpP.project(camera); if (tmpP.z > 1) continue; const d = Math.hypot((tmpP.x * .5 + .5) * r.width - (e.clientX - r.left), (-tmpP.y * .5 + .5) * r.height - (e.clientY - r.top)); if (d < bd) { bd = d; best = k; } }
    if (best != null && onPick) onPick(best);
  });
  requestAnimationFrame(frame);
  return {
    setRoad(r) { setRoad(r); dirty = true; },
    setInputs(rb) { setInputs(rb); },
    update(s) { const was = st.focus; st = { ...st, ...s }; if (s.inputIdx !== undefined) inputIdx = s.inputIdx; if (s.focus !== was) { tvRig = null; cam.init = false; } ingest(st.cars); dirty = true; },
    setCam(m) { camMode = m; dirty = true; },
    debug() { const me0 = st.focus != null && states.has(st.focus) ? st.focus : ([...states.values()].find(s => s.c.player)?.c.index ?? null); const pl = states.get(me0); let near = null; if (rbData && pl) { let best = 1e9, bi = -1; for (let i = 0; i < rbData.x.length; i++) { const d = Math.hypot(rbData.x[i] - pl.x, rbData.y[i] - pl.y); if (d < best) { best = d; bi = i; } } near = { dist: +best.toFixed(1), idx: bi, inputIdx, stepM: rbData.stepM, n: rbData.x.length }; } return { near, me: me0, focus: st.focus, accent: T.accent, players: [...states.values()].filter(s => s.c.player).map(s => s.c.index), cars: [...states.entries()].slice(0, 80).map(([k, s]) => ({ k, onRoad: s.onRoad, z: +s.tgt.z.toFixed(2), roadZ: R ? +roadZ(s.ld).toFixed(2) : null, v: +(s.v * 3.6).toFixed(0), dh: s.onRoad ? +Math.abs(angDiff(s.tgt.hd, tangentAt(s.ld))).toFixed(2) : null, player: s.c.player })) }; },
    dispose() { alive = false; ro.disconnect(); removeEventListener('pointermove', move); removeEventListener('pointerup', up); renderer.dispose(); el.remove(); chips.remove(); },
  };
}
