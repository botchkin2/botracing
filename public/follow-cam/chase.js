// Chase view engine for the Race screen (prototype). The app owns the data and the clock; this draws one frame
// of it as a 3D chase view. Loaded at runtime on web only, with three.js, from /follow-cam/.
//
//   mountChase(container, THREE, {onPick}) -> {setRoad, update, setCam, dispose}
//   setRoad({stepM, lengthM, cx[], cy[], hl[], hr[], elev: number[] | null})   world metres, x east, y north (the sim's x, z)
//   update({cars, focus, playing, rate, dark})                                  cars: RaceCar-like, see below
//   car: {index, xM, zM, headingRad|null (0 along +z, pi/2 along +x), speedKmh, carClass, color, player, lapDistM, label, state}
//
// World frame here: x east, y north, z up. Three.js frame: (x, z, -y).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (a, n) => ((a % n) + n) % n;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => mod(b - a + Math.PI, TAU) - Math.PI;
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v); }
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;

// ---- car silhouettes by class (x forward, y up, z right) ----------------------------------------
const SPEC = {
  GT3: { L: 4.65, wr: .37, fx: 1.4, rx: -1.42, ft: .88, rt: .92,
    body: [[-2.30, .27], [-2.38, .60], [-2.26, .88], [-1.4, .93], [-.5, .92], [.85, .89], [1.65, .71], [2.24, .55], [2.37, .40], [2.27, .27], [1.2, .23], [-1.6, .23]], bw: 1.74,
    rear: [[-2.28, .30], [-2.34, .62], [-2.2, .86], [-1.25, .90], [-.78, .86], [-.78, .30]], rw: 1.98, front: [[.8, .30], [.8, .84], [1.55, .74], [2.15, .58], [2.25, .42], [2.15, .30]], fw: 1.9,
    glass: [[-1.02, .90], [-.62, 1.15], [.1, 1.17], [.76, .90]], gw: 1.46, roof: [[-.66, 1.14], [-.52, 1.19], [.04, 1.21], [.14, 1.16]], roofw: 1.3,
    fin: null, wing: { x: -2.34, y: 1.34, span: 1.95, chord: .55, post: 1.1 }, splitter: { x: 2.17, w: 1.9, d: .6 }, tail: -2.45, tailY: .78, nose: 2.33, noseY: .62 },
  Hyper: { L: 5.0, wr: .36, fx: 1.55, rx: -1.5, ft: .92, rt: .96,
    body: [[-2.45, .25], [-2.53, .60], [-2.3, .84], [-1.1, .88], [-.55, .80], [.9, .70], [1.7, .55], [2.4, .38], [2.52, .27], [2.4, .2], [1.2, .17], [-1.6, .17]], bw: 1.8,
    rear: [[-2.45, .27], [-2.5, .62], [-2.28, .86], [-1.2, .88], [-.9, .6], [-.9, .27]], rw: 2.0, front: [[.95, .27], [.95, .74], [1.7, .6], [2.3, .42], [2.35, .27]], fw: 1.96,
    glass: [[-.95, .80], [-.4, 1.06], [.3, 1.08], [.95, .74]], gw: 1.26, roof: [[-.5, 1.04], [-.3, 1.09], [.28, 1.1], [.42, 1.06]], roofw: 1.12,
    fin: { x: -1.7, len: 1.4, h: .42 }, wing: { x: -2.5, y: 1.06, span: 1.95, chord: .5, post: .7 }, splitter: { x: 2.4, w: 2.0, d: .7 }, tail: -2.55, tailY: .72, nose: 2.45, noseY: .46 },
  LMP2: { L: 4.75, wr: .35, fx: 1.5, rx: -1.45, ft: .86, rt: .9,
    body: [[-2.3, .22], [-2.4, .58], [-2.2, .8], [-1.3, .84], [-.5, .76], [.8, .64], [1.55, .5], [2.2, .38], [2.38, .28], [2.2, .2], [1.0, .17], [-1.5, .17]], bw: 1.68,
    rear: [[-2.28, .24], [-2.34, .6], [-2.15, .8], [-1.1, .84], [-.8, .56], [-.8, .24]], rw: 1.9, front: [[.9, .24], [.9, .66], [1.55, .52], [2.2, .4], [2.3, .24]], fw: 1.86,
    glass: [[-.8, .78], [-.35, 1.0], [.3, 1.02], [.8, .72]], gw: 1.2, roof: [[-.45, .98], [-.3, 1.03], [.26, 1.04], [.38, 1.0]], roofw: 1.06,
    fin: { x: -1.45, len: 1.6, h: .58 }, wing: { x: -2.38, y: 1.18, span: 1.8, chord: .48, post: .85 }, splitter: { x: 2.35, w: 1.86, d: .6 }, tail: -2.46, tailY: .7, nose: 2.4, noseY: .44 },
};
const LIVERIES = ['#f4f4f1', '#1b1f27', '#c8102e', '#0a5bd6', '#f2b705', '#0e8a5f', '#6d3fe0', '#ff6a13', '#13b5a6', '#d81b72', '#8c9199', '#1e3a8a'];

export async function mountChase(container, THREE, { onPick } = {}) {
  const V = (x, y, z) => new THREE.Vector3(x, z, -y), setV = (v, x, y, z) => v.set(x, z, -y);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.AgXToneMapping || THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const el = renderer.domElement; el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none'; container.appendChild(el);
  const chips = document.createElement('div'); chips.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'; container.appendChild(chips);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1, 0.3, 9000);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6), hemi = new THREE.HemisphereLight(0xb4cff5, 0x6f6345, 0.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.35;
  scene.add(sun, sun.target, hemi);

  // ---- sky ----
  const skyUni = { top: { value: new THREE.Color('#3f78d0') }, horizon: { value: new THREE.Color('#c5defa') }, sunDir: { value: new THREE.Vector3(.55, .62, -.5).normalize() }, sunColor: { value: new THREE.Color('#fff2d6') }, time: { value: 0 }, cloud: { value: .5 }, haze: { value: new THREE.Color('#c8dcee') } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), new THREE.ShaderMaterial({
    uniforms: skyUni, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vD; uniform vec3 top, horizon, sunDir, sunColor, haze; uniform float time, cloud;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
      void main(){ vec3 d = normalize(vD); float y = d.y; vec3 col = mix(horizon, top, pow(clamp(y, 0., 1.), .45)); float sd = max(dot(d, sunDir), 0.);
        col += sunColor * (pow(sd, 900.) * 6. + pow(sd, 18.) * .35 + pow(sd, 4.) * .08);
        if (y > 0.) { vec2 p = d.xz / (y + .12) * .9 + vec2(time * .004, 0.); float c = smoothstep(1. - cloud, 1. - cloud + .34, fbm(p * 1.6)); float lit = .55 + .45 * clamp(dot(vec3(0,1,0), sunDir) + .3, 0., 1.); vec3 cc = mix(horizon * 1.05, vec3(1.), .55) * lit + sunColor * pow(sd, 6.) * .25; col = mix(col, cc, c * smoothstep(0., .22, y) * .88); }
        col = mix(col, haze, smoothstep(.12, 0., y)); if (y < 0.) col = haze; gl_FragColor = vec4(col, 1.); }`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const THEMES = {
    day: { top: '#3f78d0', horizon: '#c5defa', haze: '#c8dcee', sunColor: '#fff2d6', sunDir: [.55, .62, -.5], sun: 1.6, hemiSky: '#b4cff5', hemiGround: '#6f6345', hemi: .6, fog: '#c2d6ea', fogD: .00032, cloud: .5, exposure: .95, lights: false },
    dusk: { top: '#16204a', horizon: '#ff9a55', haze: '#c98a73', sunColor: '#ff8a40', sunDir: [.8, .07, -.35], sun: 2.6, hemiSky: '#8a86c8', hemiGround: '#4a3a38', hemi: 1.05, fog: '#b07c70', fogD: .0005, cloud: .6, exposure: 1.2, lights: true },
  };
  let themeName = '';
  function applyTheme(name) {
    if (name === themeName) return; themeName = name; const T = THEMES[name];
    skyUni.top.value.set(T.top); skyUni.horizon.value.set(T.horizon); skyUni.haze.value.set(T.haze); skyUni.sunColor.value.set(T.sunColor); skyUni.sunDir.value.set(...T.sunDir).normalize(); skyUni.cloud.value = T.cloud;
    sun.intensity = T.sun; hemi.color.set(T.hemiSky); hemi.groundColor.set(T.hemiGround); hemi.intensity = T.hemi; scene.fog = new THREE.FogExp2(T.fog, T.fogD); renderer.toneMappingExposure = T.exposure;
    scene.environment = pmrem.fromScene(new THREE.Scene().add(sky.clone()), 0, .1, 9000).texture; scene.environmentIntensity = name === 'day' ? .3 : .2;
  }
  applyTheme('day');

  // ---- textures ----
  function tex(w, h, draw, repeat = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
  const asphaltTex = tex(512, 512, (g, w, h) => { const im = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 150 + (hash2(x, y) - .5) * 70 + (hash2(x * .21, y * .21) - .5) * 56, o = (y * w + x) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = clamp(v, 0, 255); im.data[o + 3] = 255; } g.putImageData(im, 0, 0); });
  const kerbTex = tex(64, 128, (g) => { g.fillStyle = '#d9d9dc'; g.fillRect(0, 0, 64, 128); g.fillStyle = '#c2332b'; g.fillRect(0, 0, 64, 64); });
  const checkTex = tex(128, 16, (g) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) & 1 ? '#111' : '#f2f2f2'; g.fillRect(x * 8, y * 8, 8, 8); } });
  const blobTex = tex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.55, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }, false);

  // ---- road, ground (rebuilt on setRoad) ----
  const world = new THREE.Group(); scene.add(world);
  let R = null, N = 0, BIN = 10, LEN = 0, hdg, rnx, rny, curv, zr, elevSample = null;
  let gH = null, gNx = 0, gNy = 0, gX0 = 0, gY0 = 0, gCell = 0;
  const groundZ = (x, y) => { if (!gH) return 0; const fx = clamp((x - gX0) / gCell, 0, gNx - 1.001), fy = clamp((y - gY0) / gCell, 0, gNy - 1.001), ix = Math.floor(fx), iy = Math.floor(fy), ux = fx - ix, uy = fy - iy, o = iy * gNx + ix; return lerp(lerp(gH[o], gH[o + 1], ux), lerp(gH[o + gNx], gH[o + gNx + 1], ux), uy); };
  const roadZ = s => { if (!zr) return 0; const f = mod(s / BIN, N), i = Math.floor(f), t = f - i; return lerp(zr[i], zr[(i + 1) % N], t); };
  const widthAt = (s, side) => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i, w = side < 0 ? R.hl : R.hr; return lerp(w[i], w[(i + 1) % N], t); };
  const curvAt = s => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i; return lerp(curv[i], curv[(i + 1) % N], t); };
  const grid = new Map(), CELLN = 100, gkey = (a, b) => a * 100003 + b; const nr = { d: 0, s: 0, side: 1 };
  function nearestRoad(x, y, reach = 4) {
    const cx0 = Math.floor(x / CELLN), cy0 = Math.floor(y / CELLN); let best = 1e18, bs = 0, bside = 1, found = false;
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) { const arr = grid.get(gkey(cx0 + a, cy0 + b)); if (!arr) continue;
      for (const i of arr) { const j = (i + 1) % N, dx = R.cx[j] - R.cx[i], dy = R.cy[j] - R.cy[i], t = clamp(((x - R.cx[i]) * dx + (y - R.cy[i]) * dy) / (dx * dx + dy * dy || 1), 0, 1), px = R.cx[i] + dx * t, py = R.cy[i] + dy * t, d2 = (x - px) ** 2 + (y - py) ** 2; if (d2 < best) { best = d2; bs = (i + t) * BIN; bside = ((x - px) * rnx[i] + (y - py) * rny[i]) >= 0 ? 1 : -1; found = true; } } }
    nr.d = found ? Math.sqrt(best) : 1e9; nr.s = bs; nr.side = bside; return found;
  }
  function ribbonGeom(rows, cols, at) {
    const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2), col = new Float32Array(rows * cols * 3).fill(1), out = { x: 0, y: 0, z: 0, u: 0, v: 0, c: 1 };
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { at(r, k, out); const o = r * cols + k; pos[o * 3] = out.x; pos[o * 3 + 1] = out.z; pos[o * 3 + 2] = -out.y; uv[o * 2] = out.u; uv[o * 2 + 1] = out.v; col[o * 3] = col[o * 3 + 1] = col[o * 3 + 2] = out.c; }
    const idx = new Uint32Array((rows - 1) * (cols - 1) * 6); let q = 0;
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) { const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); return g;
  }
  const rowPt = (r, lam, lift, out) => { const i = r % N; out.x = R.cx[i] + rnx[i] * lam; out.y = R.cy[i] + rny[i] * lam; out.z = zr[i] + lift; };
  function setRoad(road) {
    while (world.children.length) { const o = world.children.pop(); o.traverse?.(n => n.geometry?.dispose()); }
    R = road; N = road.cx.length; BIN = road.stepM; LEN = N * BIN; grid.clear();
    hdg = new Float64Array(N); rnx = new Float64Array(N); rny = new Float64Array(N); curv = new Float64Array(N); zr = new Float64Array(N);
    for (let i = 0; i < N; i++) { const a = (i - 1 + N) % N, b = (i + 1) % N; hdg[i] = Math.atan2(road.cy[b] - road.cy[a], road.cx[b] - road.cx[a]); rnx[i] = Math.sin(hdg[i]); rny[i] = -Math.cos(hdg[i]); const k = gkey(Math.floor(road.cx[i] / CELLN), Math.floor(road.cy[i] / CELLN)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -3; k < 3; k++) s += angDiff(hdg[mod(i + k, N)], hdg[mod(i + k + 1, N)]); curv[i] = s / (6 * BIN); }
    const E = road.elev; for (let i = 0; i < N; i++) { if (!E || !E.length) { zr[i] = 0; continue; } const f = (i / N) * E.length, a = Math.floor(f) % E.length, t = f - Math.floor(f); zr[i] = lerp(E[a], E[(a + 1) % E.length], t); }
    elevSample = E && E.length ? (frac) => { const f = mod(frac, 1) * E.length, a = Math.floor(f) % E.length, t = f - Math.floor(f); return lerp(E[a], E[(a + 1) % E.length], t); } : () => 0;
    buildGround(); buildRoad();
  }
  function buildGround() {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < N; i++) { a = Math.min(a, R.cx[i]); b = Math.min(b, R.cy[i]); c = Math.max(c, R.cx[i]); d = Math.max(d, R.cy[i]); }
    const M = 380; gCell = Math.max(14, Math.sqrt(((c - a + 2 * M) * (d - b + 2 * M)) / 150000)); gX0 = a - M; gY0 = b - M; gNx = Math.ceil((c - a + 2 * M) / gCell) + 1; gNy = Math.ceil((d - b + 2 * M) / gCell) + 1;
    let mean = 0; for (let i = 0; i < N; i++) mean += zr[i]; mean /= N;
    let H = new Float32Array(gNx * gNy), W = new Float32Array(gNx * gNy), ed = new Float32Array(gNx * gNy), gv = new Float32Array(gNx * gNy);
    for (let j = 0; j < gNy; j++) for (let i = 0; i < gNx; i++) { const x = gX0 + i * gCell, y = gY0 + j * gCell, o = j * gNx + i; let z = mean, e = 1e9; if (nearestRoad(x, y, 4)) { e = Math.max(0, nr.d - widthAt(nr.s, nr.side)); z = lerp(roadZ(nr.s) - .12, mean - 2 + (fbm(x * .004, y * .004) - .5) * 6, smooth(40, 400, e) * .75); } H[o] = z; ed[o] = e; W[o] = 1 - smooth(2, 26, e); { const k = Math.abs(curvAt(nr.s)); const outside = nr.d < 1e8 && (curvAt(nr.s) > 0 ? nr.side > 0 : nr.side < 0); gv[o] = nr.d < 1e8 && outside && k > .0028 ? smooth(3, 4.5, e) * (1 - smooth(14, 22, e)) : 0; } }
    for (let pass = 0; pass < 3; pass++) { const B = new Float32Array(H.length); for (let j = 0; j < gNy; j++) for (let i = 0; i < gNx; i++) { let s = 0, n = 0; for (let bb = -1; bb <= 1; bb++) for (let aa = -1; aa <= 1; aa++) { s += H[clamp(j + bb, 0, gNy - 1) * gNx + clamp(i + aa, 0, gNx - 1)]; n++; } const o = j * gNx + i, bl = s / n; B[o] = lerp(bl, H[o], W[o]); } H = B; }
    // never above the nearest road's surface within reach of it: a car at the edge must not sink into a bank the blur raised
    for (let j = 0; j < gNy; j++) for (let i = 0; i < gNx; i++) { const o = j * gNx + i; if (ed[o] < 90 && nearestRoad(gX0 + i * gCell, gY0 + j * gCell, 4)) H[o] = Math.min(H[o], roadZ(nr.s) - .12 + smooth(10, 90, ed[o]) * 8); }
    const pos = new Float32Array(gNx * gNy * 3), col = new Float32Array(gNx * gNy * 3), t1 = new THREE.Color('#2a3a2f'), t2 = new THREE.Color('#3b4a39'), mown = new THREE.Color('#36503a'), gravel = new THREE.Color('#8b8068'), tmp = new THREE.Color();
    for (let j = 0; j < gNy; j++) for (let i = 0; i < gNx; i++) { const o = j * gNx + i, x = gX0 + i * gCell, y = gY0 + j * gCell; pos[o * 3] = x; pos[o * 3 + 1] = H[o]; pos[o * 3 + 2] = -y; tmp.copy(t1).lerp(t2, fbm(x * .01, y * .01)).lerp(mown, smooth(34, 6, ed[o]) * .9); if (gv[o] > 0) tmp.lerp(gravel, gv[o] * (.7 + .3 * fbm(x * .6, y * .6))); const sh = .9 + fbm(x * .2, y * .2) * .2; col[o * 3] = tmp.r * sh; col[o * 3 + 1] = tmp.g * sh; col[o * 3 + 2] = tmp.b * sh; }
    const idx = new Uint32Array((gNx - 1) * (gNy - 1) * 6); let q = 0; for (let j = 0; j < gNy - 1; j++) for (let i = 0; i < gNx - 1; i++) { const p = j * gNx + i, p2 = p + 1, p3 = p + gNx, p4 = p3 + 1; idx[q++] = p; idx[q++] = p2; idx[q++] = p3; idx[q++] = p2; idx[q++] = p4; idx[q++] = p3; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = sh => {   // contour lines every 2 m, bold every 10 m: height as an instrument, not scenery
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWY = (modelMatrix * vec4(position, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <color_fragment>', `#include <color_fragment>
        { float u = vWY / 2.0; float w = fwidth(u) * 1.1; float l = 1.0 - smoothstep(0.0, w, abs(fract(u - 0.5) - 0.5)); float um = vWY / 10.0; float wm = fwidth(um) * 1.6; float lm = 1.0 - smoothstep(0.0, wm, abs(fract(um - 0.5) - 0.5)); float fade = clamp(1.0 - w * 3.0, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.78, 0.7), clamp(l * 0.22 * fade + lm * 0.5 * clamp(1.0 - wm * 1.6, 0.0, 1.0), 0.0, 0.8)); }`);
    };
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; world.add(m); gH = H;
  }
  const smoothK = (a, b, x) => smooth(a, b, x);
  function buildRoad() {
    const NL = 15, rl = 0;
    const asphalt = ribbonGeom(N + 1, NL, (r, k, o) => { const i = r % N, lam = -R.hl[i] + (R.hl[i] + R.hr[i]) * k / (NL - 1); rowPt(r, lam, 0, o); o.u = lam / 6; o.v = r * BIN / 6; o.c = .8 * (.94 + .06 * hash2(r, 3)); });
    const am = new THREE.Mesh(asphalt, new THREE.MeshStandardMaterial({ color: 0x8e9199, map: asphaltTex, vertexColors: true, roughness: .86 })); am.receiveShadow = true; world.add(am);
    for (const side of [-1, 1]) { const line = ribbonGeom(N + 1, 2, (r, k, o) => { const i = r % N, hw = side < 0 ? R.hl[i] : R.hr[i], a = side * (hw - .55), b = side * (hw - .3); rowPt(r, k ? Math.max(a, b) : Math.min(a, b), .025, o); }); world.add(new THREE.Mesh(line, new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))); }
    const kw = new Float64Array(N); for (let i = 0; i < N; i++) kw[i] = 1.3 * smooth(.0026, .0042, Math.abs(curv[i]));
    for (const side of [-1, 1]) { const kerb = ribbonGeom(N + 1, 2, (r, k, o) => { const i = r % N, inside = curv[i] > 0 ? -1 : 1, w = side === inside ? kw[i] : 0, hw = side < 0 ? R.hl[i] : R.hr[i]; rowPt(r, side * (hw - .05 + (k ? w : 0)), .045, o); o.u = k; o.v = r * BIN / 2.6; }); world.add(new THREE.Mesh(kerb, new THREE.MeshStandardMaterial({ map: kerbTex, roughness: .55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))); }
    const sl = ribbonGeom(2, 17, (r, k, o) => { const lam = -R.hl[0] + (R.hl[0] + R.hr[0]) * k / 16, jj = r ? 1 : 0; o.x = R.cx[0] + rnx[0] * lam + Math.cos(hdg[0]) * jj * 1.4; o.y = R.cy[0] + rny[0] * lam + Math.sin(hdg[0]) * jj * 1.4; o.z = zr[0] + .04; o.u = k / 1.6; o.v = r; });
    world.add(new THREE.Mesh(sl, new THREE.MeshStandardMaterial({ map: checkTex, roughness: .7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
  }

  // ---- cars ----
  function profile(pts) { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
  function extrude(shape, width, bevel = .05) { const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(width - 2 * bevel, .02), bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 }); g.translate(0, 0, -(width - 2 * bevel) / 2); return g; }
  // A body is a loft: cross-sections (rounded rectangles) along the car, so the shell is smooth and shares its normals.
  const sgn = v => (v < 0 ? -1 : 1);
  function loft(st, ringN = 20, e = 2.7) {
    const rows = st.length, pos = [], idx = [];
    for (let i = 0; i < rows; i++) { const { x, w, y0, y1 } = st[i], yc = (y0 + y1) / 2, hh = (y1 - y0) / 2;
      for (let j = 0; j < ringN; j++) { const t = (j / ringN) * TAU, c = Math.cos(t), sn = Math.sin(t); pos.push(x, yc + hh * sgn(sn) * Math.pow(Math.abs(sn), 2 / e), w * sgn(c) * Math.pow(Math.abs(c), 2 / e)); } }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < ringN; j++) { const a0 = i * ringN + j, b0 = i * ringN + (j + 1) % ringN, c0 = (i + 1) * ringN + j, d0 = (i + 1) * ringN + (j + 1) % ringN; idx.push(a0, c0, b0, b0, c0, d0); }
    for (const [row, flip] of [[0, 1], [rows - 1, 0]]) { const ci = pos.length / 3; pos.push(st[row].x, (st[row].y0 + st[row].y1) / 2, 0); for (let j = 0; j < ringN; j++) { const a0 = row * ringN + j, b0 = row * ringN + (j + 1) % ringN; if (flip) idx.push(ci, a0, b0); else idx.push(ci, b0, a0); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const S = (xs, wy, y0, y1) => xs.map((x, i) => ({ x, w: wy[i], y0: y0[i], y1: y1[i] }));
  const BODY = {
    GT3: { body: S([-2.36, -2.28, -1.9, -1.3, -.6, .2, .9, 1.5, 2.0, 2.3, 2.38], [.35, .92, 1.0, 1.0, .95, .93, .93, .95, .95, .88, .5], [.34, .3, .26, .24, .24, .24, .24, .24, .23, .25, .28], [.55, .86, .95, .95, .93, .92, .88, .74, .58, .46, .4]),
      cabin: S([-1.15, -.9, -.5, 0, .45, .8], [.5, .66, .7, .7, .66, .5], [.9, .9, .9, .9, .88, .84], [.98, 1.12, 1.2, 1.2, 1.1, .94]) },
    Hyper: { body: S([-2.57, -2.48, -2.0, -1.3, -.6, .2, 1.0, 1.7, 2.2, 2.5, 2.58], [.35, .95, 1.0, 1.0, .95, .9, .95, 1.0, .9, .7, .4], [.3, .24, .2, .18, .17, .17, .17, .17, .18, .2, .22], [.55, .82, .9, .88, .8, .72, .62, .5, .38, .3, .27]),
      cabin: S([-.98, -.6, -.1, .3, .7, .98], [.4, .55, .6, .58, .5, .36], [.78, .78, .78, .78, .74, .7], [.84, 1.02, 1.09, 1.09, .95, .76]) },
    LMP2: { body: S([-2.44, -2.36, -1.9, -1.2, -.5, .3, 1.0, 1.7, 2.2, 2.4], [.35, .9, .95, .95, .88, .85, .9, .93, .8, .4], [.28, .22, .2, .17, .17, .17, .17, .18, .2, .22], [.52, .78, .84, .84, .78, .66, .55, .42, .32, .28]),
      cabin: S([-.82, -.45, 0, .4, .78], [.36, .5, .55, .5, .34], [.74, .74, .74, .72, .68], [.84, .99, 1.03, .95, .74]) },
  };
  const GEOS = {}; for (const [k, v] of Object.entries(BODY)) { const roofSt = v.cabin.map(r => ({ x: r.x, w: r.w * .86, y0: r.y1 - .05, y1: r.y1 + .012 })); GEOS[k] = { body: loft(v.body), cabin: loft(v.cabin, 16, 2.3), roof: loft(roofSt, 14, 2.3) }; }
  const wheelGeo = new THREE.CylinderGeometry(.37, .37, .32, 32); wheelGeo.rotateX(Math.PI / 2); const rimGeo = new THREE.CylinderGeometry(.25, .25, .335, 20); rimGeo.rotateX(Math.PI / 2);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x131315, roughness: .92 }), rimMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: .35, metalness: .85 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x06080c, roughness: .06, metalness: .3, clearcoat: 1, envMapIntensity: 1.6 }), darkMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: .55 });
  function makeCar(c) {
    const cls = SPEC[c.carClass] ? c.carClass : 'GT3', sp = SPEC[cls], geo = GEOS[cls], g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const hue = c.player ? '#fea92f' : LIVERIES[(c.index * 7 + 3) % LIVERIES.length], accent = c.player ? '#f4f4f1' : LIVERIES[(c.index * 5 + 1) % LIVERIES.length];
    const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hue), roughness: .3, metalness: .08, clearcoat: 1, clearcoatRoughness: .06, toneMapped: false }), acc = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(accent), roughness: .35, clearcoat: .6, toneMapped: false });
    const add = (gm, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(gm, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; body.add(m); return m; };
    add(geo.body, paint); add(geo.cabin, glassMat); add(geo.roof, paint);
    const stripe = (len, x, y, rz, w = .3) => { const m = add(new THREE.BoxGeometry(len, .012, w), acc, x, y, 0); m.rotation.z = rz; m.castShadow = false; };
    if (cls === 'GT3') { stripe(1.5, 1.52, .765, -.2475); stripe(.7, -.28, 1.215, .06, .3); stripe(1.15, -1.82, .935, 0, .34); } else { stripe(1.3, 1.5, cls === 'Hyper' ? .66 : .55, -.25, .28); stripe(.9, -1.7, cls === 'Hyper' ? .87 : .83, 0, .3); }
    add(new THREE.BoxGeometry(sp.L - 1.4, .1, sp.rw + .02), darkMat, .1, .27, 0); add(new THREE.BoxGeometry(sp.splitter.d, .06, sp.splitter.w), darkMat, sp.splitter.x, .22, 0); add(new THREE.BoxGeometry(.8, .07, 1.7), darkMat, sp.tail + .2, .28, 0);
    add(new THREE.BoxGeometry(sp.wing.chord, .045, sp.wing.span), darkMat, sp.wing.x, sp.wing.y, 0);
    for (const sd of [1, -1]) { add(new THREE.BoxGeometry(sp.wing.chord + .15, .26, .04), cls === 'GT3' ? paint : acc, sp.wing.x, sp.wing.y - .12, sd * sp.wing.span / 2); add(new THREE.BoxGeometry(.07, sp.wing.post, .09), darkMat, sp.wing.x + .1, sp.wing.y - sp.wing.post / 2, sd * .5); }
    if (sp.fin) add(new THREE.BoxGeometry(sp.fin.len, sp.fin.h, .05), paint, sp.fin.x, .86 + sp.fin.h / 2, 0);
    const tail = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff1a10, emissiveIntensity: .4 }); add(new THREE.BoxGeometry(.05, .09, sp.rw * .74), tail, sp.tail - .02, sp.tailY, 0);
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cf, emissiveIntensity: 0 }); for (const sd of [1, -1]) add(new THREE.BoxGeometry(.06, .11, .42), lamp, sp.nose, sp.noseY, sd * .62);
    const band = new THREE.MeshBasicMaterial({ color: new THREE.Color(c.color) }), gl = sp.glass, bn = new THREE.Mesh(new THREE.BoxGeometry(.05, .07, sp.gw * .98), band); bn.position.set(gl[3][0] - .08, gl[3][1] + .03, 0); bn.rotation.z = -.9; body.add(bn);
    for (const sd of [1, -1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(.5, .32), band); d.position.set(.2, .62, sd * (sp.bw / 2 + .04)); d.rotation.y = sd > 0 ? 0 : Math.PI; body.add(d); }
    const wheels = [];
    for (const [x, z, front] of [[sp.fx, sp.ft, 1], [sp.fx, -sp.ft, 1], [sp.rx, sp.rt, 0], [sp.rx, -sp.rt, 0]]) {
      const w = new THREE.Group(); w.position.set(x, sp.wr, z); const spin = new THREE.Group(), tr = new THREE.Mesh(wheelGeo, tyreMat), rm = new THREE.Mesh(rimGeo, rimMat); tr.castShadow = true; spin.add(tr, rm); w.add(spin); w.scale.setScalar(sp.wr / .37); body.add(w);
      const arch = new THREE.Mesh(new THREE.CircleGeometry(.44, 24), darkMat); arch.position.set(x, sp.wr + .01, z > 0 ? sp.bw / 2 + .08 : -sp.bw / 2 - .08); arch.rotation.y = z > 0 ? 0 : Math.PI; body.add(arch); wheels.push({ spin });
    }
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(sp.L + 1.6, 3.6), new THREE.MeshBasicMaterial({ map: blobTex, color: 0, transparent: true, opacity: .5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 })); blob.rotation.x = -Math.PI / 2; blob.position.y = .03; g.add(blob);
    g.userData = { wheels, tail, lamp, cls }; return g;
  }
  const carObjs = new Map(), chipEls = new Map(), hist = new Map(); const tmpE = new THREE.Euler(0, 0, 0, 'YZX'), tmpP = new THREE.Vector3();

  // ---- camera ----
  const cam = { x: 0, y: 0, z: 0, yaw: 0, lx: 0, ly: 0, lz: 0, roll: 0, fov: 65, mode: 0, init: false, orbit: 0 };
  let camMode = 1, tvRig = null, st = { cars: [], focus: null, playing: false, rate: 1, dark: false }, last = performance.now(), skyT = 0, alive = true, dirty = true;
  const camTarget = new THREE.Vector3(), RIG_EVERY = 45;
  function rigAt(bi) { const i = mod(bi, N), s = i * BIN; let best = null; for (const side of [-1, 1]) for (const extra of [12, 18, 26]) { const off = (side > 0 ? R.hr[i] : R.hl[i]) + extra, x = R.cx[i] + rnx[i] * side * off, y = R.cy[i] + rny[i] * side * off, rise = groundZ(x, y) - roadZ(s) + (side === (curv[i] > 0 ? 1 : -1) ? 0 : 1.5); if (!best || rise < best.rise) best = { s, x, y, z: Math.max(groundZ(x, y), roadZ(s)) + 5, rise }; } return best; }
  function clearView(px, py, pz, tx, ty, tz) { for (let lift = 0; lift < 40; lift += 2) { let ok = true; for (let k = 1; k < 10; k++) { const f = k / 10; if (groundZ(lerp(px, tx, f), lerp(py, ty, f)) + .6 > lerp(pz + lift, tz, f)) { ok = false; break; } } if (ok) return pz + lift; } return pz + 40; }
  function updateCam(dt, me) {
    const dirx = Math.cos(me.hd), diry = Math.sin(me.hd); let px, py, pz, lx, ly, lz, fov = 62, rollT = 0, posK = 11, lookK = 12;
    const hard = !cam.init || cam.mode !== camMode || !st.playing, port = camera.aspect < .8;
    if (camMode === 1 || camMode === 2) {
      const back = (camMode === 1 ? 7.2 : 15) + (port ? 1.6 : 0), up = (camMode === 1 ? 2.1 : 6.4) + (port ? .4 : 0), ahead = port ? 15 : 20; if (hard) cam.yaw = me.hd;
      const bias = clamp(curvAt(me.ld + 30) * 26, -.2, .2); cam.yaw += angDiff(cam.yaw, me.hd + bias) * (hard ? 1 : 1 - Math.exp(-dt * 3.4));
      const cx = Math.cos(cam.yaw), cy = Math.sin(cam.yaw);
      px = me.x - cx * back; py = me.y - cy * back; pz = Math.max(me.z + up - me.pitch * 3, roadZ(me.ld - back) + 1.2); lx = me.x + cx * ahead; ly = me.y + cy * ahead; lz = roadZ(me.ld + ahead) + (camMode === 1 ? (port ? .3 : 1.5) : .4);
      fov = 64 + clamp(me.v / 90, 0, 1) * 16;
    } else if (camMode === 3) { px = me.x + dirx * .25; py = me.y + diry * .25; pz = me.z + 1.07; lx = me.x + dirx * 40; ly = me.y + diry * 40; lz = roadZ(me.ld + 40) + 1.1; fov = 82; posK = 60; lookK = 20; }
    else if (camMode === 4) {
      if (!tvRig) tvRig = rigAt(Math.floor(me.ld / BIN / RIG_EVERY) * RIG_EVERY + RIG_EVERY);
      const ahead = mod(tvRig.s - me.ld + LEN / 2, LEN) - LEN / 2; if (ahead < -60 || ahead > 650) tvRig = rigAt(Math.ceil((me.ld + 160) / BIN / RIG_EVERY) * RIG_EVERY);
      lx = me.x + dirx * 3; ly = me.y + diry * 3; lz = me.z + .9; px = tvRig.x; py = tvRig.y; pz = clearView(tvRig.x, tvRig.y, tvRig.z, lx, ly, lz); const dist = Math.hypot(lx - px, ly - py, lz - pz); fov = clamp(2 * Math.atan(13 / Math.max(dist, 1)) * 180 / Math.PI, 10, 60); posK = 400; lookK = 6;
    } else { if (hard && cam.mode !== camMode) cam.orbit = 0; const oa = me.hd + Math.PI + cam.orbit; px = me.x + Math.cos(oa) * 55; py = me.y + Math.sin(oa) * 55; pz = Math.max(me.z, groundZ(px, py)) + 38; lx = me.x + dirx * 8; ly = me.y + diry * 8; lz = me.z; fov = 48; posK = 3; lookK = 8; }
    const kp = hard ? 1 : 1 - Math.exp(-dt * posK), kl = hard ? 1 : 1 - Math.exp(-dt * lookK);
    cam.x = lerp(cam.x, px, kp); cam.y = lerp(cam.y, py, kp); cam.z = lerp(cam.z, pz, hard ? 1 : camMode <= 2 ? 1 - Math.exp(-dt * 7) : kp); cam.lx = lerp(cam.lx, lx, kl); cam.ly = lerp(cam.ly, ly, kl); cam.lz = lerp(cam.lz, lz, kl);
    cam.roll = lerp(cam.roll, rollT, hard ? 1 : 1 - Math.exp(-dt * 6)); cam.fov = lerp(cam.fov, fov, hard ? 1 : 1 - Math.exp(-dt * 4)); cam.mode = camMode; cam.init = true;
    const gz = groundZ(cam.x, cam.y); if (cam.z < gz + 1.1) cam.z = gz + 1.1;
    setV(camera.position, cam.x, cam.y, cam.z); setV(camTarget, cam.lx, cam.ly, cam.lz); camera.up.set(0, 1, 0); camera.lookAt(camTarget); camera.rotateZ(cam.roll); camera.fov = cam.fov; camera.updateProjectionMatrix();
  }

  // ---- the player's inputs painted on the road ahead, and brake boards ----
  // ribbon: {x[], y[], th[], br[], stepM} the lap's driven line in world metres with throttle and brake per point
  let ribbonMesh = null, boardGroup = new THREE.Group(); scene.add(boardGroup); let ribbonN = 0, inputIdx = -1;
  const boardTex = {}; const boardMat = d => boardTex[d] ||= new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: tex(128, 128, (g) => { g.fillStyle = '#0d0f12'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#e4e7ea'; g.lineWidth = 6; g.strokeRect(5, 5, 118, 118); g.fillStyle = '#e4e7ea'; g.font = '700 58px "IBM Plex Mono",Consolas,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(d), 64, 68); }, false) });
  function setInputs(rb) {
    if (ribbonMesh) { scene.remove(ribbonMesh); ribbonMesh.geometry.dispose(); ribbonMesh = null; }
    while (boardGroup.children.length) boardGroup.remove(boardGroup.children[0]);
    ribbonN = 0; if (!rb || !R || rb.x.length < 8) { dirty = true; return; }
    const n = rb.x.length, pos = new Float32Array(n * 6), col = new Float32Array(n * 6), cc = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), hd = Math.atan2(rb.y[b] - rb.y[a], rb.x[b] - rb.x[a]), nx = -Math.sin(hd) * .32, ny = Math.cos(hd) * .32;
      let z = groundZ(rb.x[k], rb.y[k]); if (nearestRoad(rb.x[k], rb.y[k], 3) && nr.d < widthAt(nr.s, nr.side) + 3) z = roadZ(nr.s);
      for (const [j, sg] of [[0, 1], [1, -1]]) { const o = (k * 2 + j) * 3; pos[o] = rb.x[k] + nx * sg; pos[o + 1] = z + .07; pos[o + 2] = -(rb.y[k] + ny * sg); }
      const br = rb.br[k], th = rb.th[k]; if (br > 4) cc.setRGB(.93, .29, .29); else if (th > 96) cc.setRGB(.4, .89, .53); else if (th > 8) cc.setRGB(.99, .66, .18); else cc.setRGB(.54, .57, .6);
      for (let j = 0; j < 2; j++) { const o = (k * 2 + j) * 3; col[o] = cc.r; col[o + 1] = cc.g; col[o + 2] = cc.b; }
    }
    const idx = new Uint32Array((n - 1) * 6); let q = 0; for (let k = 0; k < n - 1; k++) { const a = k * 2; idx[q++] = a; idx[q++] = a + 1; idx[q++] = a + 2; idx[q++] = a + 1; idx[q++] = a + 3; idx[q++] = a + 2; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    ribbonMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: .88, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
    ribbonMesh.frustumCulled = false; ribbonMesh.renderOrder = 2; scene.add(ribbonMesh); ribbonN = n;
    // boards: 150, 100 and 50 m before each brake-on, white on black, on the outside of the corner
    let on = false; const step = rb.stepM;
    for (let k = 0; k < n; k++) {
      if (!on && rb.br[k] > 55) { on = true;
        const k2 = Math.min(n - 1, k + 12), k3 = Math.min(n - 1, k + 24), turn = (rb.x[k2] - rb.x[k]) * (rb.y[k3] - rb.y[k2]) - (rb.y[k2] - rb.y[k]) * (rb.x[k3] - rb.x[k2]), side = turn > 0 ? -1 : 1;   // left turn: boards on the right
        for (const dist of [150, 100, 50]) { const kk = k - Math.round(dist / step); if (kk < 1 || kk >= n - 1) continue; const hd = Math.atan2(rb.y[kk + 1] - rb.y[kk - 1], rb.x[kk + 1] - rb.x[kk - 1]); let hw = 7; if (nearestRoad(rb.x[kk], rb.y[kk], 3)) hw = widthAt(nr.s, nr.side);
          const off = hw + 4, bx = rb.x[kk] + Math.sin(hd) * side * off, by = rb.y[kk] - Math.cos(hd) * side * off; let z = groundZ(bx, by); if (nearestRoad(bx, by, 3)) z = Math.max(z, roadZ(nr.s) - .5);
          const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), boardMat(dist)); board.position.set(bx, z + 2.1, -by); board.rotation.y = -hd + Math.PI / 2; boardGroup.add(board);
          const post = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.4, .08), new THREE.MeshStandardMaterial({ color: 0x333840 })); post.position.set(bx, z + 1.0, -by); boardGroup.add(post); }
      } else if (on && rb.br[k] < 10) on = false;
    }
    dirty = true;
  }

  // ---- per frame ----
  const states = new Map();   // index -> {x,y,z,hd,pitch,v,ld}
  // Height, pitch and heading come from the ROAD the car is on, so a car can never float above or sink into the mesh:
  // the position is projected onto the centre path, the height is the mesh's own, the pitch its grade, and the
  // heading is the game's yaw unless that disagrees with both the road and the car's own movement (a one-sample flip).
  const tangentAt = s => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i, j = (i + 1) % N; return Math.atan2(lerp(Math.sin(hdg[i]), Math.sin(hdg[j]), t), lerp(Math.cos(hdg[i]), Math.cos(hdg[j]), t)); };
  function ingest(cars) {
    const seen = new Set();
    for (const c of cars) {
      if (c.state === 'garage' || !isFinite(c.xM)) continue; seen.add(c.index);
      const h = hist.get(c.index), x = c.xM, y = c.zM; let trav = h ? h.trav : null;
      if (h) { const dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy); if (d > 40) trav = null; else if (d > .25) { const a = Math.atan2(dy, dx); trav = trav == null ? a : trav + angDiff(trav, a) * .5; } }
      let onRoad = false, tan = null, z = groundZ(x, y), grade = 0, s = 0;
      if (R && nearestRoad(x, y, 3)) {
        s = nr.s; tan = tangentAt(s); const hw = widthAt(s, nr.side);
        if (nr.d < hw + 3) { onRoad = true; z = roadZ(s); grade = (roadZ(s + 4) - roadZ(s - 4)) / 8; }
      }
      const yawG = c.headingRad == null ? null : Math.PI / 2 - c.headingRad; let hd;
      if (yawG != null && (!onRoad || tan == null || Math.abs(angDiff(yawG, tan)) < .9 || (trav != null && Math.abs(angDiff(yawG, trav)) < .9))) hd = yawG;
      else if (trav != null && c.speedKmh > 8) hd = trav;
      else hd = tan ?? yawG ?? 0;
      const prev = states.get(c.index); if (prev && Math.abs(angDiff(prev.hd, hd)) < 1.2 && st.playing) hd = prev.hd + angDiff(prev.hd, hd) * .6;
      hist.set(c.index, { x, y, trav });
      states.set(c.index, { x, y, z, hd, pitch: onRoad ? Math.atan(grade) : 0, v: c.speedKmh / 3.6, ld: onRoad ? s : mod(c.lapDistM, LEN || 1), c, onRoad });
    }
    for (const k of [...states.keys()]) if (!seen.has(k)) { states.delete(k); hist.delete(k); const o = carObjs.get(k); if (o) { scene.remove(o); carObjs.delete(k); } const e = chipEls.get(k); if (e) { e.remove(); chipEls.delete(k); } }
  }
  function render(dt) {
    const me0 = st.focus != null && states.has(st.focus) ? st.focus : [...states.values()].find(s => s.c.player)?.c.index ?? [...states.keys()][0];
    const me = states.get(me0); if (!me || !R) return;
    for (const [k, s] of states) {
      let o = carObjs.get(k); if (!o) { o = makeCar(s.c); scene.add(o); carObjs.set(k, o); }
      setV(o.position, s.x, s.y, s.z); tmpE.set(0, s.hd, s.pitch, 'YZX'); o.setRotationFromEuler(tmpE); o.visible = !(camMode === 3 && k === me0);
      const sp = st.playing ? s.v * dt * st.rate / .37 : 0; for (const w of o.userData.wheels) w.spin.rotation.z -= sp;
      o.userData.lamp.emissiveIntensity = THEMES[themeName].lights ? 2.2 : 0; o.userData.tail.emissiveIntensity = themeName === 'dusk' ? 1.1 : .35;
    }
    updateCam(dt * Math.sqrt(Math.max(st.rate, 1)), me);
    if (ribbonMesh) { const i0 = clamp(inputIdx + 1, 0, ribbonN - 2), cnt = clamp(Math.min(70, ribbonN - 2 - i0), 0, 70); ribbonMesh.geometry.setDrawRange(i0 * 6, cnt * 6); ribbonMesh.visible = me0 != null && states.get(me0)?.c.player === true && inputIdx >= 0; }
    const T = THEMES[themeName]; setV(sun.target.position, me.x, me.y, me.z); sun.position.copy(sun.target.position).addScaledVector(skyUni.sunDir.value, 160);
    if (st.playing) skyT += dt * st.rate; skyUni.time.value = skyT; sky.position.copy(camera.position);
    renderer.render(scene, camera);
    // class position over the ten nearest cars within 130 m of the followed car (a grid of 50 would be a wall of labels)
    const near = new Set([...states.entries()].filter(([k, s]) => k !== me0 && Math.hypot(s.x - me.x, s.y - me.y) < 130).sort((a, b) => Math.hypot(a[1].x - me.x, a[1].y - me.y) - Math.hypot(b[1].x - me.x, b[1].y - me.y)).slice(0, 10).map(([k]) => k));
    for (const [k, s] of states) {
      let e = chipEls.get(k); if (!e) { e = document.createElement('div'); e.style.cssText = 'position:absolute;left:0;top:0;padding:1px 6px;border-radius:3px;background:rgba(13,15,18,.82);border:1px solid #2e343a;font:600 11px "IBM Plex Mono",Consolas,monospace;color:#e4e7ea;white-space:nowrap;display:none;will-change:transform'; chips.appendChild(e); chipEls.set(k, e); }
      const d = Math.hypot(s.x - me.x, s.y - me.y); setV(tmpP, s.x, s.y, s.z + 1.9); tmpP.project(camera);
      const ok = near.has(k) && camMode !== 3 && tmpP.z < 1 && tmpP.z > -1 && Math.abs(tmpP.x) < 1.05 && Math.abs(tmpP.y) < 1.05 && s.c.label;
      e.style.display = ok ? 'block' : 'none'; if (ok) { e.textContent = s.c.label; e.style.borderColor = s.c.color; e.style.transform = `translate(${((tmpP.x * .5 + .5) * container.clientWidth).toFixed(0)}px,${((-tmpP.y * .5 + .5) * container.clientHeight).toFixed(0)}px) translate(-50%,-100%)`; e.style.opacity = clamp(1.5 - d / 120, .4, 1); }
    }
  }
  function frame(now) { if (!alive) return; const dt = Math.min(.05, (now - last) / 1000); last = now; if (dirty || st.playing) { dirty = false; render(dt); } requestAnimationFrame(frame); }
  function resize() { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  // press: the nearest car within a finger's reach; heli: drag to look around
  let drag = null;
  el.addEventListener('pointerdown', e => { drag = { x: e.clientX, o: cam.orbit, moved: false }; });
  addEventListener('pointermove', e => { if (drag && camMode === 5) { const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; cam.orbit = drag.o - dx * .008; dirty = true; } });
  addEventListener('pointerup', () => setTimeout(() => { drag = null; }, 0));
  el.addEventListener('click', e => {
    if (drag && drag.moved) return; const r = el.getBoundingClientRect(); let best = null, bd = 46;
    for (const [k, s] of states) { setV(tmpP, s.x, s.y, s.z + 1); tmpP.project(camera); if (tmpP.z > 1) continue; const d = Math.hypot((tmpP.x * .5 + .5) * r.width - (e.clientX - r.left), (-tmpP.y * .5 + .5) * r.height - (e.clientY - r.top)); if (d < bd) { bd = d; best = k; } }
    if (best != null && onPick) onPick(best);
  });
  requestAnimationFrame(frame);
  return {
    setRoad(r) { setRoad(r); dirty = true; },
    update(s) { const was = st.focus; st = { ...st, ...s }; if (s.inputIdx !== undefined) inputIdx = s.inputIdx; if (s.dark !== undefined) applyTheme(s.dark ? 'dusk' : 'day'); if (s.focus !== was) { tvRig = null; cam.init = false; } ingest(st.cars); dirty = true; },
    setCam(m) { camMode = m; dirty = true; },
    setInputs(rb) { setInputs(rb); },
    debug() { return [...states.entries()].slice(0, 80).map(([k, s]) => { const o = carObjs.get(k); return { k, onRoad: s.onRoad, z: +s.z.toFixed(2), roadZ: R ? +roadZ(s.ld).toFixed(2) : null, py: o ? +(o.position.y).toFixed(2) : null, pitch: +s.pitch.toFixed(3), v: +(s.v * 3.6).toFixed(0), dh: s.onRoad ? +Math.abs(angDiff(s.hd, tangentAt(s.ld))).toFixed(2) : null, yawErr: s.c.headingRad == null ? null : +Math.abs(angDiff(Math.PI / 2 - s.c.headingRad, s.hd)).toFixed(2) }; }); },
    dispose() { alive = false; ro.disconnect(); renderer.dispose(); el.remove(); chips.remove(); },
  };
}
