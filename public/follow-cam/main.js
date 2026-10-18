import * as THREE from 'three';

// ----------------------------------------------------------------------------------------
// Follow cam. A race replay from the recorded field.
//   cars     every car of the session at 5 Hz: position, the game's own height, orientation,
//            speed, accelerations (captured by the tray recorder, class and model included)
//   road     centre path and asphalt edges measured from the game's PathLateral / TrackEdge
//   height   the game's own height (mPos_y), median per 5 m of lap distance over every car
//   terrain  a real elevation model around the track, drawn as contour lines
//   inputs   throttle and brake painted on the road ahead of the followed car: recorded for
//            the player, estimated from longitudinal acceleration for everyone else
// World frame (data): x east, y north, z up, metres. Three.js frame: (x, z, -y).
// ----------------------------------------------------------------------------------------
const D = window.FOLLOW_DATA;
const R = D.road, N = R.cx.length, BIN = D.bin, LEN = N * BIN, HZ = D.hz, NT = D.cars[0].x.length, DUR = (NT - 1) / HZ;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (a, n) => ((a % n) + n) % n;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => mod(b - a + Math.PI, TAU) - Math.PI;
const $ = id => document.getElementById(id);
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v); }
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;
let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// ---- classes -------------------------------------------------------------------------------
const CLASS = { Hyper: { color: '#e8261c', tag: 'HYPER' }, LMP2: { color: '#2f7bff', tag: 'LMP2' }, GT3: { color: '#22c55e', tag: 'GT3' } };
const LIVERIES = ['#f4f4f1', '#1b1f27', '#c8102e', '#0a5bd6', '#f2b705', '#0e8a5f', '#6d3fe0', '#ff6a13', '#13b5a6', '#d81b72', '#8c9199', '#1e3a8a'];
const teamPaint = t => { let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return [LIVERIES[h % LIVERIES.length], LIVERIES[(h >> 5) % LIVERIES.length]]; };

// ---- road precompute -----------------------------------------------------------------------
const hdg = new Float64Array(N), rnx = new Float64Array(N), rny = new Float64Array(N), curv = new Float64Array(N);
for (let i = 0; i < N; i++) { const a = (i - 1 + N) % N, b = (i + 1) % N; hdg[i] = Math.atan2(R.cy[b] - R.cy[a], R.cx[b] - R.cx[a]); rnx[i] = Math.sin(hdg[i]); rny[i] = -Math.cos(hdg[i]); }
for (let i = 0; i < N; i++) { let s = 0; for (let k = -3; k < 3; k++) s += angDiff(hdg[mod(i + k, N)], hdg[mod(i + k + 1, N)]); curv[i] = s / (6 * BIN); }
const zMin = Math.min(...R.z), zMax = Math.max(...R.z);
let relief = 1;
const Zt = z => zMin + (z - zMin) * relief;
const zRaw = s => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i; return lerp(R.z[i], R.z[(i + 1) % N], t); };
const roadZ = s => Zt(zRaw(s));
const gradeAt = s => (zRaw(s + 6) - zRaw(s - 6)) / 12;
const curvAt = s => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i; return lerp(curv[i], curv[(i + 1) % N], t); };
const widthAt = (s, side) => { const f = mod(s / BIN, N), i = Math.floor(f), t = f - i, w = side < 0 ? R.hl : R.hr; return lerp(w[i], w[(i + 1) % N], t); };

// ---- smoothing: 5 Hz game samples are steady in position but noisy in attitude, height and acceleration
function gauss(a, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = []; let sum = 0; for (let j = -r; j <= r; j++) { const w = Math.exp(-0.5 * (j / sigma) ** 2); k.push(w); sum += w; }
  const out = new Array(a.length); for (let i = 0; i < a.length; i++) { let s = 0; for (let j = -r; j <= r; j++) s += a[clamp(i + j, 0, a.length - 1)] * k[j + r]; out[i] = s / sum; } return out;
}
for (const c of D.cars) {
  c.x = gauss(c.x, .6); c.y = gauss(c.y, .6); c.h = gauss(c.h, 2); c.pitch = gauss(c.pitch, 1.5); c.roll = gauss(c.roll, 1.5); c.v = gauss(c.v, 1); c.lon = gauss(c.lon, 1.2); c.lat = gauss(c.lat, 1.2);
}
// ---- cars: continuous progress, interpolation ----------------------------------------------
const cars = D.cars.map((c, k) => {
  const prog = new Float64Array(NT), yaw = new Float64Array(NT); let off = 0; prog[0] = c.ld[0];
  for (let i = 1; i < NT; i++) { const d = c.ld[i] - c.ld[i - 1]; if (d < -LEN / 2) off += LEN; else if (d > LEN / 2) off -= LEN; prog[i] = c.ld[i] + off; }
  yaw[0] = c.yaw[0]; for (let i = 1; i < NT; i++) yaw[i] = yaw[i - 1] + angDiff(yaw[i - 1], c.yaw[i]);
  const ys = gauss(Array.from(yaw), .8); for (let i = 0; i < NT; i++) yaw[i] = ys[i];
  const info = CLASS[c.cls] || { color: '#9aa4b2' }, [paint, accent] = c.pl ? ['#ff8a00', '#f4f4f1'] : teamPaint(c.team);
  return { k, d: c, prog, yaw, color: info.color, paint, accent, cls: c.cls, num: c.num, label: '#' + c.num };
});
const player = cars.findIndex(c => c.d.pl);
function carAt(c, t) {
  const tt = clamp(t * HZ, 0, NT - 1.001), i = Math.floor(tt), f = tt - i, d = c.d, g = (a, j) => a[clamp(j, 0, NT - 1)];
  const cr = a => { const p0 = g(a, i - 1), p1 = g(a, i), p2 = g(a, i + 1), p3 = g(a, i + 2); return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f); };
  const li = a => lerp(a[i], a[i + 1], f), prog = lerp(c.prog[i], c.prog[i + 1], f);
  return { x: cr(d.x), y: cr(d.y), z: Zt(cr(d.h)), hd: lerp(c.yaw[i], c.yaw[i + 1], f), pitch: li(d.pitch), roll: li(d.roll), v: li(d.v), lon: li(d.lon), lat: li(d.lat), ld: mod(prog, LEN), prog, lap: d.lap[i], pit: d.pit[i], hl: d.hl[i] };
}
const INP = D.inputs;
const inpAt = (t, key) => { const tt = clamp(t * HZ, 0, NT - 1.001), i = Math.floor(tt); return lerp(INP[key][i], INP[key][i + 1], tt - i); };
const gearAt = t => INP.gear[clamp(Math.round(t * HZ), 0, NT - 1)];
function pedals(ci, s, t) {
  if (ci === player) return { th: inpAt(t, 'th'), br: inpAt(t, 'br'), est: false };
  const a = s.lon; return { th: a > 1.2 ? clamp(40 + a * 14, 0, 100) : a > -1.5 ? (s.v > 25 ? 20 : 0) : 0, br: a < -2.5 ? clamp(-a * 9, 0, 100) : 0, est: true };
}

// ---- renderer, scene -----------------------------------------------------------------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1, 0.3, 9000);
const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.35; scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6a5d44, 0.8); scene.add(hemi);
const head = new THREE.SpotLight(0xfff1d0, 0, 140, 0.5, 0.6, 1.2); scene.add(head, head.target);
const V = (x, y, z) => new THREE.Vector3(x, z, -y), setV = (v, x, y, z) => v.set(x, z, -y);

const skyUni = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, time: { value: 0 }, cloud: { value: 0.5 }, haze: { value: new THREE.Color() } };
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
  day: { top: '#3f78d0', horizon: '#c5defa', haze: '#c8dcee', sunColor: '#fff2d6', sunDir: [0.55, 0.62, -0.5], sun: 2.0, sunHex: '#fff1d8', hemiSky: '#b4cff5', hemiGround: '#6f6345', hemi: 0.45, fog: '#c2d6ea', fogD: 0.00032, cloud: 0.5, exposure: 0.82, lights: false },
  dusk: { top: '#16204a', horizon: '#ff9a55', haze: '#c98a73', sunColor: '#ff8a40', sunDir: [0.8, 0.07, -0.35], sun: 2.6, sunHex: '#ff9650', hemiSky: '#8a86c8', hemiGround: '#4a3a38', hemi: 1.05, fog: '#b07c70', fogD: 0.0005, cloud: 0.6, exposure: 1.2, lights: true },
};
let themeName = 'day';
function applyTheme(name) {
  themeName = name; const T = THEMES[name];
  skyUni.top.value.set(T.top); skyUni.horizon.value.set(T.horizon); skyUni.haze.value.set(T.haze); skyUni.sunColor.value.set(T.sunColor); skyUni.sunDir.value.set(...T.sunDir).normalize(); skyUni.cloud.value = T.cloud;
  sun.color.set(T.sunHex); sun.intensity = T.sun; hemi.color.set(T.hemiSky); hemi.groundColor.set(T.hemiGround); hemi.intensity = T.hemi;
  scene.fog = new THREE.FogExp2(T.fog, T.fogD); renderer.toneMappingExposure = T.exposure;
  const rt = pmrem.fromScene(new THREE.Scene().add(sky.clone()), 0.0, 0.1, 9000); scene.environment = rt.texture; scene.environmentIntensity = name === 'day' ? 0.3 : 0.2;
  head.intensity = T.lights ? 260 : 0; $('theme').textContent = name === 'day' ? 'Day' : 'Dusk';
}

// ---- textures ------------------------------------------------------------------------------
function tex(w, h, draw, repeat = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
const noiseFill = (g, w, h, base, amp, scale = 1) => { const im = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = base + (hash2(x * scale, y * scale) - 0.5) * amp + (hash2(x * .21, y * .21) - .5) * amp * .8, o = (y * w + x) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = clamp(v, 0, 255); im.data[o + 3] = 255; } g.putImageData(im, 0, 0); };
const asphaltTex = tex(512, 512, (g, w, h) => { noiseFill(g, w, h, 150, 70); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${.03 + rnd() * .05})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 30, 1 + rnd() * 4); } });
const kerbTex = tex(64, 128, (g) => { g.fillStyle = '#d9d9dc'; g.fillRect(0, 0, 64, 128); g.fillStyle = '#c2332b'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, 6, 128); });
const checkTex = tex(128, 16, (g) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) & 1 ? '#111' : '#f2f2f2'; g.fillRect(x * 8, y * 8, 8, 8); } });
const blobTex = tex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.55, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }, false);
const labelTex = (text, bg, fg = '#fff', w = 256, h = 128, size = 84) => tex(w, h, (g) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `800 ${size}px Segoe UI, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4); }, false);

// ---- world ---------------------------------------------------------------------------------
const CELL = 40, grid = new Map(), gk = (cx, cy) => cx * 100003 + cy;
for (let i = 0; i < N; i++) { const k = gk(Math.floor(R.cx[i] / CELL), Math.floor(R.cy[i] / CELL)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
const nr = { d: 0, s: 0, side: 1 };
function nearestRoad(x, y, reach = 3) {
  const cx0 = Math.floor(x / CELL), cy0 = Math.floor(y / CELL); let best = 1e18, bs = 0, bside = 1, found = false;
  for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) { const arr = grid.get(gk(cx0 + a, cy0 + b)); if (!arr) continue;
    for (const i of arr) { const j = (i + 1) % N, dx = R.cx[j] - R.cx[i], dy = R.cy[j] - R.cy[i], t = clamp(((x - R.cx[i]) * dx + (y - R.cy[i]) * dy) / (dx * dx + dy * dy || 1), 0, 1), px = R.cx[i] + dx * t, py = R.cy[i] + dy * t, d2 = (x - px) ** 2 + (y - py) ** 2;
      if (d2 < best) { best = d2; bs = (i + t) * BIN; bside = ((x - px) * rnx[i] + (y - py) * rny[i]) >= 0 ? 1 : -1; found = true; } } }
  nr.d = found ? Math.sqrt(best) : 1e9; nr.s = bs; nr.side = bside; return found;
}
const world = new THREE.Group(); scene.add(world);
let terrainH = null, tNx = 0, tNy = 0, tX0 = 0, tY0 = 0, tCell = 0;
const groundZ = (x, y) => { if (!terrainH) return 0; const fx = clamp((x - tX0) / tCell, 0, tNx - 1.001), fy = clamp((y - tY0) / tCell, 0, tNy - 1.001), ix = Math.floor(fx), iy = Math.floor(fy), ux = fx - ix, uy = fy - iy, o = iy * tNx + ix; return lerp(lerp(terrainH[o], terrainH[o + 1], ux), lerp(terrainH[o + tNx], terrainH[o + tNx + 1], ux), uy); };

// terrain: a quiet dark ground with elevation contour lines (every 2 m, bold every 10 m)
const GROUND_A = new THREE.Color('#2a3a2f'), GROUND_B = new THREE.Color('#3b4a39'), GROUND_C = new THREE.Color('#4d5a43'), MOWN = new THREE.Color('#36503a'), EARTH = new THREE.Color('#5a4d3e');
function buildTerrain() {
  const T = D.terrain, f = 3; tNx = (T.nx - 1) * f + 1; tNy = (T.ny - 1) * f + 1; tX0 = T.x0; tY0 = T.y0; tCell = T.step / f;
  let H = new Float32Array(tNx * tNy); const dem = (i, j) => T.z[clamp(j, 0, T.ny - 1) * T.nx + clamp(i, 0, T.nx - 1)];
  for (let j = 0; j < tNy; j++) for (let i = 0; i < tNx; i++) { const fx = i / f, fy = j / f, ix = Math.floor(fx), iy = Math.floor(fy); let ux = fx - ix, uy = fy - iy; ux = ux * ux * (3 - 2 * ux); uy = uy * uy * (3 - 2 * uy); H[j * tNx + i] = lerp(lerp(dem(ix, iy), dem(ix + 1, iy), ux), lerp(dem(ix, iy + 1), dem(ix + 1, iy + 1), ux), uy); }
  for (let pass = 0; pass < 2; pass++) { const B = new Float32Array(H.length); for (let j = 0; j < tNy; j++) for (let i = 0; i < tNx; i++) { let s = 0, c = 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { s += H[clamp(j + b, 0, tNy - 1) * tNx + clamp(i + a, 0, tNx - 1)]; c++; } B[j * tNx + i] = s / c; } H = B; }
  const pos = new Float32Array(tNx * tNy * 3), col = new Float32Array(tNx * tNy * 3), ed = new Float32Array(tNx * tNy), tmp = new THREE.Color();
  for (let j = 0; j < tNy; j++) for (let i = 0; i < tNx; i++) {
    const x = tX0 + i * tCell, y = tY0 + j * tCell, o = j * tNx + i; let z = Zt(H[o]), e = 1e9;
    if (nearestRoad(x, y)) { const hw = widthAt(nr.s, nr.side); e = Math.max(0, nr.d - hw); z = lerp(roadZ(nr.s) - 0.12, z, smooth(1.2, 60, e)); }
    ed[o] = e; H[o] = z; pos[o * 3] = x; pos[o * 3 + 1] = z; pos[o * 3 + 2] = -y;
  }
  for (let j = 0; j < tNy; j++) for (let i = 0; i < tNx; i++) {
    const o = j * tNx + i, x = tX0 + i * tCell, y = tY0 + j * tCell, sl = Math.hypot(H[Math.min(o + 1, H.length - 1)] - H[Math.max(o - 1, 0)], H[Math.min(o + tNx, H.length - 1)] - H[Math.max(o - tNx, 0)]) / (2 * tCell), e = ed[o];
    tmp.copy(GROUND_A).lerp(GROUND_B, fbm(x * .01, y * .01)).lerp(GROUND_C, smooth(.55, .85, fbm(x * .004 + 5, y * .004)) * .6); tmp.lerp(MOWN, smooth(34, 6, e) * .9).lerp(EARTH, smooth(.25, .5, sl) * .6);
    const sh = 0.9 + fbm(x * .2, y * .2) * .2; col[o * 3] = tmp.r * sh; col[o * 3 + 1] = tmp.g * sh; col[o * 3 + 2] = tmp.b * sh;
  }
  const idx = new Uint32Array((tNx - 1) * (tNy - 1) * 6); let q = 0;
  for (let j = 0; j < tNy - 1; j++) for (let i = 0; i < tNx - 1; i++) { const a = j * tNx + i, b = a + 1, c = a + tNx, d = c + 1; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWY = (modelMatrix * vec4(position, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <color_fragment>', `#include <color_fragment>
      { float u = vWY / 2.0; float w = fwidth(u) * 1.1; float l = 1.0 - smoothstep(0.0, w, abs(fract(u - 0.5) - 0.5));
        float um = vWY / 10.0; float wm = fwidth(um) * 1.6; float lm = 1.0 - smoothstep(0.0, wm, abs(fract(um - 0.5) - 0.5));
        float fade = clamp(1.0 - w * 3.0, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.78, 0.7), clamp(l * 0.22 * fade + lm * 0.5 * clamp(1.0 - wm * 1.6, 0.0, 1.0), 0.0, 0.8)); }`);
  };
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; world.add(m); terrainH = H;
}

// racing line offset per bin (from the whole field), for the rubbered-in line
const rl = new Float64Array(N);
(function () { const sums = new Float64Array(N), cnt = new Float64Array(N);
  for (const c of cars) for (let i = 0; i < NT; i += 2) { const b = mod(Math.floor(c.d.ld[i] / BIN), N), lat = (c.d.x[i] - R.cx[b]) * rnx[b] + (c.d.y[i] - R.cy[b]) * rny[b]; if (Math.abs(lat) < 9 && !c.d.pit[i]) { sums[b] += lat; cnt[b]++; } }
  for (let i = 0; i < N; i++) rl[i] = cnt[i] > 3 ? sums[i] / cnt[i] : 0; })();
function ribbonGeom(rows, cols, at) {
  const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2), col = new Float32Array(rows * cols * 3).fill(1), out = { x: 0, y: 0, z: 0, u: 0, v: 0, c: 1 };
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { at(r, k, out); const o = r * cols + k; pos[o * 3] = out.x; pos[o * 3 + 1] = out.z; pos[o * 3 + 2] = -out.y; uv[o * 2] = out.u; uv[o * 2 + 1] = out.v; col[o * 3] = col[o * 3 + 1] = col[o * 3 + 2] = out.c; }
  const idx = new Uint32Array((rows - 1) * (cols - 1) * 6); let q = 0;
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) { const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); return g;
}
const rowPt = (r, lam, lift, out) => { const i = r % N; out.x = R.cx[i] + rnx[i] * lam; out.y = R.cy[i] + rny[i] * lam; out.z = Zt(R.z[i]) - lam * Math.tan(R.bank[i]) + lift; };   // + bank = right side down
const ldPoint = (ld, lam, lift) => { const i = mod(Math.floor(ld / BIN), N), t = ld / BIN - Math.floor(ld / BIN), j = (i + 1) % N; return V(lerp(R.cx[i], R.cx[j], t) + lerp(rnx[i], rnx[j], t) * lam, lerp(R.cy[i], R.cy[j], t) + lerp(rny[i], rny[j], t) * lam, roadZ(ld) + lift); };
function gateLine(ld, color, lift = 0.05, len = 1.4) {
  const i = mod(Math.floor(ld / BIN), N), g = ribbonGeom(2, 2, (r, k, o) => { const p = ldPoint(r ? ld + len : ld, k ? R.hr[i] : -R.hl[i], lift); o.x = p.x; o.y = -p.z; o.z = p.y; });
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
}
function buildRoad() {
  const NL = 21;
  const asphalt = ribbonGeom(N + 1, NL, (r, k, o) => { const i = r % N, lam = -R.hl[i] + (R.hl[i] + R.hr[i]) * k / (NL - 1); rowPt(r, lam, 0, o); o.u = lam / 6; o.v = r * BIN / 6; const d = lam - rl[i]; o.c = 0.8 * (1 - 0.3 * Math.exp(-((d / 0.95) ** 2)) - 0.12 * Math.exp(-((d / 2.8) ** 2))) * (0.94 + 0.06 * hash2(r, 3)); });
  const am = new THREE.Mesh(asphalt, new THREE.MeshStandardMaterial({ color: 0x8e9199, map: asphaltTex, vertexColors: true, roughness: .86 })); am.receiveShadow = true; world.add(am);
  for (const side of [-1, 1]) {
    const line = ribbonGeom(N + 1, 2, (r, k, o) => { const i = r % N, hw = side < 0 ? R.hl[i] : R.hr[i], a = side * (hw - 0.55), b = side * (hw - 0.3); rowPt(r, k ? Math.max(a, b) : Math.min(a, b), 0.025, o); });
    world.add(new THREE.Mesh(line, new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  }
  const kw = new Float64Array(N); for (let i = 0; i < N; i++) kw[i] = 1.3 * smooth(0.0026, 0.0042, Math.abs(curv[i]));
  for (const side of [-1, 1]) {
    const kerb = ribbonGeom(N + 1, 2, (r, k, o) => { const i = r % N, inside = curv[i] > 0 ? -1 : 1, w = side === inside ? kw[i] : 0, hw = side < 0 ? R.hl[i] : R.hr[i]; rowPt(r, side * (hw - 0.05 + (k ? w : 0)), 0.045, o); o.u = k; o.v = r * BIN / 2.6; });
    world.add(new THREE.Mesh(kerb, new THREE.MeshStandardMaterial({ map: kerbTex, roughness: .55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
  }
  const sl = ribbonGeom(2, 17, (r, k, o) => { const lam = -R.hl[0] + (R.hl[0] + R.hr[0]) * k / 16, jj = r ? 1 : 0; o.x = R.cx[0] + rnx[0] * lam + Math.cos(hdg[0]) * jj * 1.4; o.y = R.cy[0] + rny[0] * lam + Math.sin(hdg[0]) * jj * 1.4; o.z = Zt(R.z[0]) + 0.04; o.u = k / 1.6; o.v = r; });
  world.add(new THREE.Mesh(sl, new THREE.MeshStandardMaterial({ map: checkTex, roughness: .7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
  const SC = { '1-2': ['S2', '#ff4fa3'], '2-0': ['S3', '#ffd23f'] };
  for (const [k, ld] of Object.entries(D.sector)) { if (!SC[k]) continue; world.add(gateLine(ld, SC[k][1])); const i = mod(Math.floor(ld / BIN), N), p = ldPoint(ld, -R.hl[i] - 3.2, 3.4), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(SC[k][0], SC[k][1], '#0a0d12', 128, 64, 44), fog: false })); sp.position.copy(p); sp.scale.set(3, 1.5, 1); world.add(sp); }
  // braking boards 150 / 100 / 50 m before each of the player's braking zones: white on black, on the outside verge
  for (const z of D.brakeZones) for (const dist of [150, 100, 50]) {
    const ld = mod(z - dist, LEN), i = mod(Math.floor(ld / BIN), N), side = curv[mod(Math.floor(z / BIN), N)] > 0 ? 1 : -1;
    const base = ldPoint(ld, side * ((side < 0 ? R.hl[i] : R.hr[i]) + 3.5), 0), tx = tex(128, 128, (g) => { g.fillStyle = '#0b0d10'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(5, 5, 118, 118); g.fillStyle = '#fff'; g.font = '800 62px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(dist), 64, 70); }, false);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide })); board.position.set(base.x, base.y + 2.1, base.z); board.rotation.y = -hdg[i] + Math.PI / 2; world.add(board);
    const post = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.4, .08), new THREE.MeshStandardMaterial({ color: 0x333840 })); post.position.set(base.x, base.y + 1.0, base.z); world.add(post);
  }
}
function buildWorld() { while (world.children.length) { const o = world.children.pop(); o.traverse?.(n => n.geometry?.dispose()); } seed = 99; buildTerrain(); buildRoad(); }

// ---- car models: three classes ---------------------------------------------------------------
function profile(pts) { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
function extrude(shape, width, bevel = .05) { const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(width - 2 * bevel, .02), bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 }); g.translate(0, 0, -(width - 2 * bevel) / 2); return g; }
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
const GEOS = {}; for (const [k, s] of Object.entries(SPEC)) GEOS[k] = { body: extrude(profile(s.body), s.bw, .09), rear: extrude(profile(s.rear), s.rw, .09), front: extrude(profile(s.front), s.fw, .08), glass: extrude(profile(s.glass), s.gw, .02), roof: extrude(profile(s.roof), s.roofw, .03) };
const wheelGeo = new THREE.CylinderGeometry(.37, .37, .32, 32); wheelGeo.rotateX(Math.PI / 2); const rimGeo = new THREE.CylinderGeometry(.25, .25, .335, 20); rimGeo.rotateX(Math.PI / 2);
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x131315, roughness: .92 }), rimMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: .35, metalness: .85 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x06080c, roughness: .06, metalness: .3, clearcoat: 1, envMapIntensity: 1.6 }), darkMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: .55 });
const plateTex = {};
const plate = (num, hex) => plateTex[num + hex] ||= tex(128, 128, (g) => { g.fillStyle = hex; g.beginPath(); g.roundRect(4, 4, 120, 120, 22); g.fill(); g.fillStyle = '#0a0d12'; g.beginPath(); g.roundRect(14, 14, 100, 100, 14); g.fill(); g.fillStyle = '#fff'; g.font = `800 ${String(num).length > 2 ? 52 : 68}px Segoe UI, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(num), 64, 68); }, false);
function makeCar(c) {
  const sp = SPEC[c.cls] || SPEC.GT3, geo = GEOS[c.cls] || GEOS.GT3, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c.paint), roughness: .3, metalness: .08, clearcoat: 1, clearcoatRoughness: .06 }), acc = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c.accent), roughness: .35, clearcoat: .6 });
  const add = (gm, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(gm, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; body.add(m); return m; };
  add(geo.body, paint); add(geo.rear, paint); add(geo.front, paint); add(geo.glass, glassMat); add(geo.roof, paint);
  const stripe = (len, x, y, rz, w = .3) => { const m = add(new THREE.BoxGeometry(len, .012, w), acc, x, y, 0); m.rotation.z = rz; m.castShadow = false; };
  if (c.cls === 'GT3') { stripe(1.5, 1.52, .765, -.2475); stripe(.7, -.28, 1.215, .06, .3); stripe(1.15, -1.82, .935, 0, .34); } else { stripe(1.3, 1.5, c.cls === 'Hyper' ? .66 : .55, -.25, .28); stripe(.9, -1.7, c.cls === 'Hyper' ? .87 : .83, 0, .3); }
  add(new THREE.BoxGeometry(sp.L - 1.4, .1, sp.rw + .02), darkMat, .1, .27, 0); add(new THREE.BoxGeometry(sp.splitter.d, .06, sp.splitter.w), darkMat, sp.splitter.x, .22, 0); add(new THREE.BoxGeometry(.8, .07, 1.7), darkMat, sp.tail + .2, .28, 0);
  add(new THREE.BoxGeometry(sp.wing.chord, .045, sp.wing.span), darkMat, sp.wing.x, sp.wing.y, 0);
  for (const sd of [1, -1]) { add(new THREE.BoxGeometry(sp.wing.chord + .15, .26, .04), c.cls === 'GT3' ? paint : acc, sp.wing.x, sp.wing.y - .12, sd * sp.wing.span / 2); add(new THREE.BoxGeometry(.07, sp.wing.post, .09), darkMat, sp.wing.x + .1, sp.wing.y - sp.wing.post / 2, sd * .5); }
  if (sp.fin) add(new THREE.BoxGeometry(sp.fin.len, sp.fin.h, .05), paint, sp.fin.x, .86 + sp.fin.h / 2, 0);
  for (const sd of [1, -1]) add(new THREE.BoxGeometry(.16, .08, .22), paint, .5, c.cls === 'GT3' ? .98 : .86, sd * (sp.gw / 2 + .1));
  const tail = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff1a10, emissiveIntensity: .4 }); add(new THREE.BoxGeometry(.05, .09, sp.rw * .74), tail, sp.tail - .02, sp.tailY, 0);
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cf, emissiveIntensity: 0 }); for (const sd of [1, -1]) add(new THREE.BoxGeometry(.06, .11, .42), lamp, sp.nose, sp.noseY, sd * .62);
  const band = new THREE.MeshBasicMaterial({ color: new THREE.Color(c.color) }), gl = sp.glass, bn = new THREE.Mesh(new THREE.BoxGeometry(.05, .07, sp.gw * .98), band); bn.position.set(gl[3][0] - .08, gl[3][1] + .03, 0); bn.rotation.z = -.9; body.add(bn);
  const pm = new THREE.MeshBasicMaterial({ map: plate(c.num, c.color), transparent: true });
  for (const sd of [1, -1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(.5, .5), pm); d.position.set(.2, .62, sd * (sp.bw / 2 + .04)); d.rotation.y = sd > 0 ? 0 : Math.PI; body.add(d); }
  const rn = new THREE.Mesh(new THREE.PlaneGeometry(.42, .42), pm); rn.rotation.x = -Math.PI / 2; rn.rotation.z = -Math.PI / 2; rn.position.set(gl[2][0] - .2, gl[2][1] + .03 + (c.cls === 'GT3' ? .06 : 0), 0); body.add(rn);
  const wheels = [];
  for (const [x, z, front] of [[sp.fx, sp.ft, 1], [sp.fx, -sp.ft, 1], [sp.rx, sp.rt, 0], [sp.rx, -sp.rt, 0]]) {
    const w = new THREE.Group(); w.position.set(x, sp.wr, z); const spin = new THREE.Group(), tr = new THREE.Mesh(wheelGeo, tyreMat), rm = new THREE.Mesh(rimGeo, rimMat); tr.castShadow = true; spin.add(tr, rm); w.add(spin); w.scale.setScalar(sp.wr / .37); body.add(w);
    const arch = new THREE.Mesh(new THREE.CircleGeometry(.44, 24), darkMat); arch.position.set(x, sp.wr + .01, z > 0 ? sp.bw / 2 + .08 : -sp.bw / 2 - .08); arch.rotation.y = z > 0 ? 0 : Math.PI; body.add(arch); wheels.push({ w, spin, front });
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(sp.L + 1.6, 3.6), new THREE.MeshBasicMaterial({ map: blobTex, color: 0, transparent: true, opacity: .5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 })); blob.rotation.x = -Math.PI / 2; blob.position.y = .03; g.add(blob);
  g.userData = { body, wheels, tail, lamp, blob }; return g;
}
const carObjs = cars.map(c => { const m = makeCar(c); scene.add(m); return m; });
const tmpE = new THREE.Euler(0, 0, 0, 'YZX');
function poseCar(i, s, dt) {
  const o = carObjs[i], u = o.userData; setV(o.position, s.x, s.y, s.z); tmpE.set(s.roll, s.hd, s.pitch, 'YZX'); o.setRotationFromEuler(tmpE);
  const sp = s.v * dt / .37; for (const w of u.wheels) w.spin.rotation.z -= sp;
  const p = pedals(i, s, t); u.tail.emissiveIntensity = (themeName === 'dusk' ? 1.1 : .35) + clamp(p.br / 25, 0, 1) * 3.4; u.lamp.emissiveIntensity = (THEMES[themeName].lights || s.hl) ? 2.2 : 0;
}

// ---- inputs ribbon -------------------------------------------------------------------------
let ribbon = null, ribbonFor = -1; const SUB = 4;
function buildRibbon(ci) {
  if (ribbon) { world.remove(ribbon); ribbon.geometry.dispose(); }
  const c = cars[ci], d = c.d, n = (NT - 1) * SUB + 1, pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3), cc = new THREE.Color();
  const sample = tt => { const i = Math.min(NT - 2, Math.floor(tt)), f = tt - i, g = (a, j) => a[clamp(j, 0, NT - 1)]; const cr = a => { const p0 = g(a, i - 1), p1 = g(a, i), p2 = g(a, i + 1), p3 = g(a, i + 2); return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f); }; return { x: cr(d.x), y: cr(d.y), z: Zt(cr(d.h)) }; };
  const pts = []; for (let k = 0; k < n; k++) pts.push(sample(k / SUB));
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)], hd = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(hd) * .3, ny = Math.cos(hd) * .3, p = pts[k];
    for (const [j, sg] of [[0, 1], [1, -1]]) { const o = (k * 2 + j) * 3; pos[o] = p.x + nx * sg; pos[o + 1] = p.z + 0.06; pos[o + 2] = -(p.y + ny * sg); }
    const fi = Math.min(NT - 1, Math.round(k / SUB)), pl = ci === player, th = pl ? INP.th[fi] : 0, br = pl ? INP.br[fi] : 0, lon = d.lon[fi];
    const isBr = pl ? br > 4 : lon < -2.5, brk = pl ? br : clamp(-lon * 9, 0, 100), isTh = pl ? th > 96 : lon > 2.2, part = pl ? th > 8 : lon > -1.5;
    if (isBr) cc.setRGB(1, .2 + (1 - brk / 100) * .35, .16); else if (isTh) cc.setRGB(.12, .95, .5); else if (part) cc.setRGB(1, .72, .18); else cc.setRGB(.55, .6, .68);
    for (let j = 0; j < 2; j++) { const o = (k * 2 + j) * 3; col[o] = cc.r; col[o + 1] = cc.g; col[o + 2] = cc.b; }
  }
  const idx = new Uint32Array((n - 1) * 6); let q = 0; for (let k = 0; k < n - 1; k++) { const a = k * 2; idx[q++] = a; idx[q++] = a + 1; idx[q++] = a + 2; idx[q++] = a + 1; idx[q++] = a + 3; idx[q++] = a + 2; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  ribbon = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: .88, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
  ribbon.frustumCulled = false; ribbon.renderOrder = 2; world.add(ribbon); ribbonFor = ci;
}

// ---- camera --------------------------------------------------------------------------------
const cam = { x: 0, y: 0, z: 0, yaw: 0, lx: 0, ly: 0, lz: 0, roll: 0, fov: 65, mode: 0, init: false, orbit: 0 };
let camMode = 1, follow = player, showLine = true, tvRig = null, playing = true, rate = 1, t = 0;
const hidden = new Set(), CAM_NAMES = ['Chase', 'High', 'Hood', 'TV', 'Heli'], RIG_EVERY = 90;
function rigAt(bi) {
  const i = mod(bi, N), s = i * BIN; let best = null;
  for (const side of [-1, 1]) for (const extra of [12, 18, 26]) { const off = (side > 0 ? R.hr[i] : R.hl[i]) + extra, x = R.cx[i] + rnx[i] * side * off, y = R.cy[i] + rny[i] * side * off, rise = groundZ(x, y) - roadZ(s) + (side === (curv[i] > 0 ? 1 : -1) ? 0 : 1.5); if (!best || rise < best.rise) best = { s, x, y, z: Math.max(groundZ(x, y), roadZ(s)) + 5, rise }; }
  return best;
}
function clearView(px, py, pz, tx, ty, tz) { for (let lift = 0; lift < 40; lift += 2) { let ok = true; for (let k = 1; k < 10; k++) { const f = k / 10; if (groundZ(lerp(px, tx, f), lerp(py, ty, f)) + 0.6 > lerp(pz + lift, tz, f)) { ok = false; break; } } if (ok) return pz + lift; } return pz + 40; }
const camTarget = new THREE.Vector3();
function updateCam(dt, me) {
  const dirx = Math.cos(me.hd), diry = Math.sin(me.hd); let px, py, pz, lx, ly, lz, fov = 62, rollT = 0, posK = 11, lookK = 12, shake = 0;
  const hard = !cam.init || cam.mode !== camMode;
  if (camMode === 1 || camMode === 2) {
    const port = camera.aspect < 0.8, back = (camMode === 1 ? 7.2 : 15) + (port ? 1.6 : 0), up = (camMode === 1 ? 2.1 : 6.4) + (port ? .4 : 0), ahead = port ? 15 : 20; if (hard) cam.yaw = me.hd;
    const bias = clamp(curvAt(me.ld + 30) * 26, -0.2, 0.2); cam.yaw += angDiff(cam.yaw, me.hd + bias) * (1 - Math.exp(-dt * 3.4));
    const cx = Math.cos(cam.yaw), cy = Math.sin(cam.yaw);
    px = me.x - cx * back; py = me.y - cy * back; pz = Math.max(me.z + up - me.pitch * 3, roadZ(me.ld - back) + 1.2);
    lx = me.x + cx * ahead; ly = me.y + cy * ahead; lz = roadZ(me.ld + ahead) + (camMode === 1 ? (port ? .3 : 1.5) : 0.4);
    fov = 64 + clamp(me.v / 90, 0, 1) * 16 - clamp(me.lon, -15, 15) * .12; rollT = clamp(-me.lat * 0.0035, -.1, .1) - me.roll * .5; shake = clamp((me.v - 40) / 60, 0, 1) * .015;
  } else if (camMode === 3) {
    px = me.x + dirx * .25; py = me.y + diry * .25; pz = me.z + 1.07 + Math.sin(me.pitch) * .5; lx = me.x + dirx * 40; ly = me.y + diry * 40; lz = roadZ(me.ld + 40) + 1.1;
    fov = 82; rollT = -me.roll * .8; posK = 60; lookK = 20; shake = clamp((me.v - 20) / 70, 0, 1) * .01;
  } else if (camMode === 4) {
    if (!tvRig) tvRig = rigAt(Math.floor(me.ld / BIN / RIG_EVERY) * RIG_EVERY + RIG_EVERY);
    const ahead = mod(tvRig.s - me.ld + LEN / 2, LEN) - LEN / 2; if (ahead < -60 || ahead > 650) tvRig = rigAt(Math.ceil((me.ld + 160) / BIN / RIG_EVERY) * RIG_EVERY);
    lx = me.x + dirx * 3; ly = me.y + diry * 3; lz = me.z + .9; px = tvRig.x; py = tvRig.y; pz = clearView(tvRig.x, tvRig.y, tvRig.z, lx, ly, lz);
    const dist = Math.hypot(lx - px, ly - py, lz - pz); fov = clamp(2 * Math.atan(13 / Math.max(dist, 1)) * 180 / Math.PI, 10, 60); posK = 400; lookK = 6;
  } else {
    cam.orbit += dt * .16; px = me.x + Math.cos(cam.orbit) * 62; py = me.y + Math.sin(cam.orbit) * 62; pz = Math.max(me.z, groundZ(px, py)) + 40 + Math.sin(cam.orbit * .5) * 6; lx = me.x + dirx * 8; ly = me.y + diry * 8; lz = me.z; fov = 48; posK = 3; lookK = 8;
  }
  const kp = hard ? 1 : 1 - Math.exp(-dt * posK), kl = hard ? 1 : 1 - Math.exp(-dt * lookK);
  cam.x = lerp(cam.x, px, kp); cam.y = lerp(cam.y, py, kp); cam.z = lerp(cam.z, pz, camMode === 1 || camMode === 2 ? 1 - Math.exp(-dt * 7) : kp);
  cam.lx = lerp(cam.lx, lx, kl); cam.ly = lerp(cam.ly, ly, kl); cam.lz = lerp(cam.lz, lz, kl);
  cam.roll = lerp(cam.roll, rollT, hard ? 1 : 1 - Math.exp(-dt * 6)); cam.fov = lerp(cam.fov, fov, hard ? 1 : 1 - Math.exp(-dt * 4)); cam.mode = camMode; cam.init = true;
  const gz = groundZ(cam.x, cam.y); if (cam.z < gz + 1.1) cam.z = gz + 1.1;
  setV(camera.position, cam.x, cam.y, cam.z); const tn = performance.now() * .001; camera.position.x += Math.sin(tn * 31) * shake; camera.position.y += Math.sin(tn * 43 + 1) * shake;
  setV(camTarget, cam.lx, cam.ly, cam.lz); camera.up.set(0, 1, 0); camera.lookAt(camTarget); camera.rotateZ(cam.roll); camera.fov = cam.fov; camera.updateProjectionMatrix();
}

// ---- HUD -----------------------------------------------------------------------------------
const hex2rgba = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const emaMap = new Map(), who = $('who'), near = $('near'), chips = $('chips'), tmpP = new THREE.Vector3(); let curStates = [];
const chipEls = cars.map(c => { const e = document.createElement('div'); e.className = 'chip mono'; e.innerHTML = `<i style="background:${c.color}"></i>${c.label}`; chips.appendChild(e); return e; });
const leds = $('leds'); for (let i = 0; i < 22; i++) leds.appendChild(document.createElement('i'));
const ICONS = { Chase: '<path d="M4 17l3-8h10l3 8"/><path d="M3 17h18"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>', High: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/>', Hood: '<path d="M3 15c0-5 4-8 9-8s9 3 9 8"/><path d="M8 15h8"/>', TV: '<rect x="4" y="6" width="16" height="11" rx="2"/><path d="M9 21h6"/>', Heli: '<path d="M4 8h16"/><path d="M12 8v3"/><rect x="7" y="11" width="10" height="5" rx="2.5"/><path d="M17 14h4"/>' };
CAM_NAMES.forEach((n, i) => { const b = document.createElement('button'); b.id = 'cam' + (i + 1); b.title = n + ' (' + (i + 1) + ')'; b.innerHTML = `<svg class="ico" viewBox="0 0 24 24">${ICONS[n]}</svg>`; b.onclick = () => setCam(i + 1); $('cams').appendChild(b); });
for (const k of ['Hyper', 'LMP2', 'GT3']) { const b = document.createElement('button'); b.className = 'on'; b.innerHTML = `<i style="width:9px;height:9px;border-radius:2px;background:${CLASS[k].color};display:block"></i>${CLASS[k].tag}`; b.title = 'Show / hide ' + CLASS[k].tag; b.onclick = () => { hidden.has(k) ? hidden.delete(k) : hidden.add(k); b.classList.toggle('on', !hidden.has(k)); }; $('classes').appendChild(b); }
function toast(msg) { const e = $('toast'); e.textContent = msg; e.style.opacity = 1; clearTimeout(toast.h); toast.h = setTimeout(() => e.style.opacity = 0, 1100); }
function setCam(m) { camMode = m; for (let i = 1; i <= 5; i++) $('cam' + i).classList.toggle('on', i === m); toast(CAM_NAMES[m - 1]); }
const RATES = [0.25, 0.5, 1, 2, 4, 8, 16];
function setRate(d) { rate = RATES[clamp(RATES.indexOf(rate) + d, 0, RATES.length - 1)]; $('spdx').textContent = rate + '×'; }
function setPlaying(v) { playing = v; $('playico').innerHTML = v ? '<path d="M7 5v14l12-7z"/>' : '<path d="M7 5v14M17 5v14"/>'; }
function pick(i) { follow = i; tvRig = null; cam.init = false; }
const rankOrder = () => cars.map((c, i) => i).sort((a, b) => curStates[b].prog - curStates[a].prog);
const bar = $('bar'); try { if (localStorage.getItem('fc-bar') === 'open') bar.classList.remove('collapsed'); } catch (e) {}
function toggleBar() { bar.classList.toggle('collapsed'); try { localStorage.setItem('fc-bar', bar.classList.contains('collapsed') ? 'closed' : 'open'); } catch (e) {} }
$('more').onclick = toggleBar;
$('play').onclick = () => setPlaying(!playing); $('slower').onclick = () => setRate(-1); $('faster').onclick = () => setRate(1);
$('seek').oninput = e => { t = e.target.value / 1000 * DUR; };
function cycleRelief() { relief = relief >= 3 ? 1 : relief + 1; $('relief').textContent = 'Relief ' + relief + '×'; buildWorld(); buildRibbon(follow); toast('Relief ' + relief + '×'); }
$('relief').onclick = cycleRelief; $('theme').onclick = () => applyTheme(themeName === 'day' ? 'dusk' : 'day');
$('line').onclick = () => { showLine = !showLine; $('line').classList.toggle('on', showLine); };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return; const k = e.key;
  if (k === ' ') { e.preventDefault(); setPlaying(!playing); } else if (k === 'ArrowRight') t = Math.min(DUR, t + 5); else if (k === 'ArrowLeft') t = Math.max(0, t - 5);
  else if (k >= '1' && k <= '5') setCam(+k); else if (k === '[') setRate(-1); else if (k === ']') setRate(1);
  else if (k === 'ArrowUp' || k === 'ArrowDown') { const order = rankOrder(), r = order.indexOf(follow); pick(order[clamp(r + (k === 'ArrowUp' ? -1 : 1), 0, order.length - 1)]); e.preventDefault(); }
  else if (k === 'm' || k === 'M') toggleBar(); else if (k === 'e' || k === 'E') cycleRelief(); else if (k === 't' || k === 'T') $('theme').click(); else if (k === 'l' || k === 'L') $('line').click();
});
canvas.addEventListener('click', e => {   // click a car in the 3D view to follow it
  const r = canvas.getBoundingClientRect(); let best = -1, bd = 46;
  curStates.forEach((s, i) => { if (hidden.has(cars[i].cls) || i === follow) return; setV(tmpP, s.x, s.y, s.z + 1); tmpP.project(camera); if (tmpP.z > 1) return; const d = Math.hypot((tmpP.x * .5 + .5) * r.width - (e.clientX - r.left), (-tmpP.y * .5 + .5) * r.height - (e.clientY - r.top)); if (d < bd) { bd = d; best = i; } });
  if (best >= 0) pick(best);
});

const mapc = $('mapc'), mctx = mapc.getContext('2d'), profc = $('profc'), pctx = profc.getContext('2d'), stripc = $('stripc'), sctx = stripc.getContext('2d'), gball = $('gball'), gctx = gball.getContext('2d');
const bb = (() => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < N; i++) { a = Math.min(a, R.cx[i]); b = Math.min(b, R.cy[i]); c = Math.max(c, R.cx[i]); d = Math.max(d, R.cy[i]); } return { a, b, c, d }; })();
function drawMap(cs) {
  const w = mapc.width, h = mapc.height, k = w / 210, pad = 20 * k, sc = Math.min((w - 2 * pad) / (bb.c - bb.a), (h - 2 * pad) / (bb.d - bb.b)), ox = (w - (bb.c - bb.a) * sc) / 2, oy = (h - (bb.d - bb.b) * sc) / 2, mp = (x, y) => [ox + (x - bb.a) * sc, h - (oy + (y - bb.b) * sc)];
  mctx.clearRect(0, 0, w, h); mctx.lineJoin = mctx.lineCap = 'round'; mctx.strokeStyle = 'rgba(0,0,0,.55)'; mctx.lineWidth = 7 * k; mctx.beginPath();
  for (let i = 0; i <= N; i++) { const p = mp(R.cx[i % N], R.cy[i % N]); i ? mctx.lineTo(p[0], p[1]) : mctx.moveTo(p[0], p[1]); } mctx.stroke();
  for (let i = 0; i < N; i += 2) { const j = (i + 2) % N, a = mp(R.cx[i], R.cy[i]), b = mp(R.cx[j], R.cy[j]), f = (R.z[i] - zMin) / Math.max(zMax - zMin, 1); mctx.strokeStyle = `hsl(${215 - f * 195},55%,${32 + f * 14}%)`; mctx.lineWidth = 3.4 * k; mctx.beginPath(); mctx.moveTo(a[0], a[1]); mctx.lineTo(b[0], b[1]); mctx.stroke(); }
  cs.forEach((s, i) => { if (hidden.has(cars[i].cls) || i === follow) return; const p = mp(s.x, s.y); mctx.fillStyle = cars[i].color; mctx.strokeStyle = '#05070a'; mctx.lineWidth = 1.2 * k; mctx.beginPath(); mctx.arc(p[0], p[1], 3.2 * k, 0, TAU); mctx.fill(); mctx.stroke(); });
  const me = cs[follow], p = mp(me.x, me.y); mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.arc(p[0], p[1], 5 * k, 0, TAU); mctx.fill(); mctx.strokeStyle = cars[follow].color; mctx.lineWidth = 2.4 * k; mctx.beginPath(); mctx.arc(p[0], p[1], 8.5 * k, 0, TAU); mctx.stroke();
}
function drawProfile(cs) {
  const w = profc.width, h = profc.height, k = w / 210, p = 10 * k, zr = Math.max(zMax - zMin, 10), X = s => p + (w - 2 * p) * s / LEN, Y = z => h - p - 6 * k - (h - 2 * p - 18 * k) * ((z - zMin) / zr);
  pctx.clearRect(0, 0, w, h); pctx.beginPath(); pctx.moveTo(p, h - p); for (let i = 0; i <= N; i++) pctx.lineTo(X(i * BIN), Y(R.z[i % N])); pctx.lineTo(w - p, h - p); pctx.closePath();
  const g = pctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,176,32,.6)'); g.addColorStop(1, 'rgba(255,176,32,.06)'); pctx.fillStyle = g; pctx.fill();
  const me = cs[follow]; pctx.strokeStyle = 'rgba(255,255,255,.4)'; pctx.lineWidth = k; pctx.beginPath(); pctx.moveTo(X(me.ld), p); pctx.lineTo(X(me.ld), h - p); pctx.stroke();
  pctx.fillStyle = '#fff'; pctx.beginPath(); pctx.arc(X(me.ld), Y(zRaw(me.ld)), 4.2 * k, 0, TAU); pctx.fill(); pctx.fillStyle = '#8e99a8'; pctx.font = `${10.5 * k}px Segoe UI`; pctx.fillText(Math.round(zMax - zMin) + ' m', p, p + 6 * k);
}
function drawStrip(cs) {   // the whole lap as a line, one lane per class, every car a tick; the followed car is the white one
  const w = stripc.width, h = stripc.height, k = w / Math.max(stripc.clientWidth, 1), p = 12 * k, X = s => p + (w - 2 * p) * s / LEN, lanes = ['Hyper', 'LMP2', 'GT3'], laneH = (h - 20 * k) / 3;
  sctx.clearRect(0, 0, w, h);
  lanes.forEach((cl, li) => { const y = 6 * k + li * laneH + laneH / 2; sctx.fillStyle = hex2rgba(CLASS[cl].color, hidden.has(cl) ? .05 : .16); sctx.fillRect(p, y - 1.5 * k, w - 2 * p, 3 * k); });
  for (const ld of Object.values(D.sector)) { sctx.fillStyle = 'rgba(255,255,255,.3)'; sctx.fillRect(X(ld) - .5 * k, 3 * k, k, h - 18 * k); }
  sctx.fillStyle = 'rgba(255,255,255,.55)'; sctx.fillRect(p - .5 * k, 3 * k, 1.4 * k, h - 18 * k);
  for (const z of D.brakeZones) { sctx.fillStyle = 'rgba(255,90,77,.55)'; sctx.fillRect(X(z) - 1.2 * k, h - 13 * k, 2.4 * k, 6 * k); }
  const draw = (i, big) => { const c = cars[i]; if (hidden.has(c.cls)) return; const li = Math.max(0, lanes.indexOf(c.cls)), y = 6 * k + li * laneH + laneH / 2, x = X(cs[i].ld), r = (big ? 5 : 3) * k; sctx.fillStyle = big ? '#fff' : c.color; sctx.fillRect(x - r / 2, y - r * 1.5, r, r * 3); if (big) { sctx.strokeStyle = c.color; sctx.lineWidth = 1.6 * k; sctx.strokeRect(x - r / 2 - 1.5 * k, y - r * 1.5 - 1.5 * k, r + 3 * k, r * 3 + 3 * k); } };
  cs.forEach((s, i) => { if (i !== follow) draw(i, false); }); draw(follow, true);
  sctx.fillStyle = '#8e99a8'; sctx.font = `${9.5 * k}px Segoe UI`; sctx.fillText('S1', X(0) + 4 * k, h - 3 * k); sctx.fillText('S2', X(D.sector['1-2']) + 4 * k, h - 3 * k); sctx.fillText('S3', X(D.sector['2-0']) + 4 * k, h - 3 * k);
}
function drawG(me) {
  const w = gball.width, c = w / 2, r = w * .42; gctx.clearRect(0, 0, w, w); gctx.strokeStyle = '#3a4350'; gctx.lineWidth = 3; for (const f of [1, .5]) { gctx.beginPath(); gctx.arc(c, c, r * f, 0, TAU); gctx.stroke(); }
  gctx.strokeStyle = '#2a323d'; gctx.lineWidth = 2; gctx.beginPath(); gctx.moveTo(c - r, c); gctx.lineTo(c + r, c); gctx.moveTo(c, c - r); gctx.lineTo(c, c + r); gctx.stroke();
  const lat = clamp(-me.lat / 9.81 / 3, -1, 1), lon = clamp(me.lon / 9.81 / 3, -1, 1);   // 3 g at the rim; accelerating moves the dot up
  gctx.fillStyle = lon < -.05 ? '#ff5a4d' : '#39e08a'; gctx.beginPath(); gctx.arc(c + lat * r, c - lon * r, 6, 0, TAU); gctx.fill();
}
const fmtClock = s => { const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); };
const SECT = [0, D.sector['1-2'], D.sector['2-0'], LEN], sectorOf = ld => ld < SECT[1] ? 0 : ld < SECT[2] ? 1 : 2;
function hud(cs, me) {
  const mc = cars[follow], cls = CLASS[mc.cls] || { color: '#9aa4b2', tag: mc.cls }, ord = rankOrder(), overall = ord.indexOf(follow) + 1, inCls = ord.filter(i => cars[i].cls === mc.cls), clsPos = inCls.indexOf(follow) + 1;
  const model = mc.d.model.replace(/ LMGT3.*$/, '').replace(/\.$/, ''), sec = sectorOf(me.ld);
  who.innerHTML = `<div class="l1"><span class="cb" style="background:${cls.color}">${cls.tag}</span><span class="mono">#${mc.num}</span><span style="margin-left:auto;font-weight:500;color:var(--muted)" class="mono">P${overall}</span></div><div class="l2">${mc.d.team} · ${model}</div><div class="l3"><i class="sec ${sec === 0 ? 'on' : ''}"></i><i class="sec ${sec === 1 ? 'on' : ''}"></i><i class="sec ${sec === 2 ? 'on' : ''}"></i><span class="tag mono">${me.pit ? 'PIT' : 'L' + me.lap}</span><span class="tag mono">${follow === player ? 'YOU' : 'C' + clsPos}</span></div>`;
  const others = cs.map((s, i) => ({ i, d: s.prog - me.prog })).filter(o => o.i !== follow && !hidden.has(cars[o.i].cls));
  const ahead = others.filter(o => o.d > 0).sort((a, b) => a.d - b.d).slice(0, 4).reverse(), behind = others.filter(o => o.d <= 0).sort((a, b) => b.d - a.d).slice(0, 4);
  const ema = (k, v) => { const p = emaMap.get(k); const n = p == null ? v : p + (v - p) * .18; emaMap.set(k, n); return n; };
  const row = o => { const c = cars[o.i], s = cs[o.i], ci = CLASS[c.cls] || { color: '#9aa4b2', tag: c.cls }, gap = ema('g' + o.i, Math.abs(o.d) / Math.max(me.v, 20)), cl = ema('c' + o.i, (o.d > 0 ? me.v - s.v : s.v - me.v) * 3.6), cc = Math.abs(cl) < 3 ? '' : cl > 0 ? 'c' : 'f';
    return `<div class="row" data-i="${o.i}"><span class="cb" style="background:${ci.color}">${ci.tag}</span><span>#${c.num}</span><span class="t">${c.d.team}</span><span class="g ${cc}">${o.d > 0 ? '−' : '+'}${gap.toFixed(1)}<small style="color:var(--muted)"> ${cl > 0 ? '▲' : '▼'}${Math.abs(cl).toFixed(0)}</small></span></div>`; };
  near.innerHTML = ahead.map(row).join('') + `<div class="row me"><span class="cb" style="background:${cls.color}">${cls.tag}</span><span>#${mc.num}</span><span class="t">${mc.d.team}</span><span class="g"></span></div>` + behind.map(row).join('');
  near.querySelectorAll('.row[data-i]').forEach(e => e.onclick = () => pick(+e.dataset.i));
  const p = pedals(follow, me, t); $('est').style.display = p.est ? 'block' : 'none';
  $('spd').textContent = Math.round(me.v * 3.6); const g = follow === player ? gearAt(t) : 0; $('gear').textContent = follow === player ? (g <= 0 ? (g < 0 ? 'R' : 'N') : g) : '–';
  $('pBrake').style.height = clamp(p.br, 0, 100) + '%'; $('pThr').style.height = clamp(p.th, 0, 100) + '%';
  const lit = follow === player ? Math.round(clamp(inpAt(t, 'rpm') / 9200, 0, 1) * 22) : 0; [...leds.children].forEach((e, i) => { e.style.background = i < lit ? (i > 18 ? '#ff5a4d' : i > 14 ? '#ffb020' : '#39e08a') : ''; });
  const gr = gradeAt(me.ld) * 100; $('grade').textContent = (gr > 0 ? '+' : '') + gr.toFixed(1) + '%'; $('grade').style.color = gr > 2.5 ? '#ffb020' : gr < -2.5 ? '#5cc8ff' : '';
  $('alt').textContent = Math.round(zRaw(me.ld) - zMin) + ' m'; $('clock').textContent = fmtClock(t); $('seek').value = t / DUR * 1000;
  drawMap(cs); drawProfile(cs); drawStrip(cs); drawG(me);
}
function chipsUpdate(cs) {
  const me = cs[follow];
  cs.forEach((s, i) => { const e = chipEls[i]; if (i === follow || camMode === 3 || hidden.has(cars[i].cls)) { e.style.display = 'none'; return; }
    const d = Math.hypot(s.x - me.x, s.y - me.y); setV(tmpP, s.x, s.y, s.z + 1.9); tmpP.project(camera);
    const ok = d < 170 && tmpP.z < 1 && tmpP.z > -1 && Math.abs(tmpP.x) < 1.05 && Math.abs(tmpP.y) < 1.05; e.style.display = ok ? 'flex' : 'none';
    if (ok) { e.style.transform = `translate(${((tmpP.x * .5 + .5) * innerWidth).toFixed(0)}px,${((-tmpP.y * .5 + .5) * innerHeight).toFixed(0)}px) translate(-50%,-100%)`; e.style.opacity = clamp(1.5 - d / 120, .4, 1); e.style.left = e.style.top = 0; } });
}

// ---- size, frame loop ----------------------------------------------------------------------
let W = 0, H = 0;
function resize() { W = canvas.clientWidth; H = canvas.clientHeight; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); const dpr = Math.min(devicePixelRatio || 1, 2); for (const c of [mapc, profc, stripc]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); } }
addEventListener('resize', resize);
let frameN = 0, last = performance.now();
function advance(dtReal) {
  if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
  if (playing) t += dtReal * rate; if (t > DUR) t = 0; if (t < 0) t = 0;
  const cs = cars.map(c => carAt(c, t)); curStates = cs; const me = cs[follow];
  if (ribbonFor !== follow) buildRibbon(follow);
  cs.forEach((s, i) => { poseCar(i, s, playing ? dtReal * rate : 0); carObjs[i].visible = !hidden.has(cars[i].cls) && !(camMode === 3 && i === follow); });
  updateCam(dtReal * Math.sqrt(Math.max(rate, 1)), me);
  if (ribbon) { const i0 = clamp(Math.floor(t * HZ * SUB) + 1, 0, (NT - 1) * SUB - 2), cnt = clamp(Math.min(SUB * HZ * 5, (NT - 1) * SUB - 1 - i0), 0, 1e6); ribbon.geometry.setDrawRange(i0 * 6, cnt * 6); ribbon.visible = showLine; }
  const T = THEMES[themeName]; setV(sun.target.position, me.x, me.y, me.z); sun.position.copy(sun.target.position).addScaledVector(skyUni.sunDir.value, 160);
  skyUni.time.value = performance.now() * .001; sky.position.copy(camera.position);
  if (T.lights) { setV(head.position, me.x, me.y, me.z + 1.0); setV(head.target.position, me.x + Math.cos(me.hd) * 30, me.y + Math.sin(me.hd) * 30, me.z + .3); }
  renderer.render(scene, camera);
  if ((frameN++ & 1) === 0) { hud(cs, me); chipsUpdate(cs); }
}
function frame(now) { advance(Math.min(0.05, (now - last) / 1000)); last = now; requestAnimationFrame(frame); }
resize(); applyTheme('day'); buildWorld(); setCam(1); buildRibbon(follow); $('load').remove(); requestAnimationFrame(frame);
window.__proto = {
  cars, THREE, tick(n, dt = 1 / 60) { const a = performance.now(); for (let i = 0; i < n; i++) advance(dt); return (performance.now() - a) / n; },
  get t() { return t; }, set t(v) { t = v; }, set cam(v) { setCam(v); }, set playing(v) { setPlaying(v); }, set follow(v) { pick(v); }, theme(n) { applyTheme(n); }, get renderer() { return renderer; }, get states() { return curStates; },
  seekLd(ld, car = player) { const c = cars[car]; for (let i = 6; i < NT; i++) if (mod(c.d.ld[i], LEN) >= ld) { t = i / HZ; return t; } }, setRate(r) { rate = r; },
};
