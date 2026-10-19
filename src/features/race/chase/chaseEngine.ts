// Chase view engine for the Race screen. The app owns the data and the clock; this draws one frame of it as an
// instrument: near-black space, a faint datum grid under the road, the road at its measured width and curated height
// with thin edges and cross rungs, every car a lit low-poly body in its class colour standing on the road at the road's
// grade, the player's inputs painted on the road. Nothing is drawn that the data does not hold: no sky, grass, kerbs,
// gravel, liveries, banking, roll, or height the track does not have. Web only (three.js).
//
// World frame: x east, y north, z up (the sim's x and z); three.js is (x, z, -y), see sceneFrame.ts.

import * as THREE from 'three';
import {angDiff, clamp, ease, lerp, mod} from '@/src/analysis/chaseMath';
import {chaseHeading, stepTravel} from '@/src/analysis/chaseHeading';
import type {ChaseRoad} from '@/src/analysis/chaseRoad';
import {roadIndex, type RoadIndex} from '@/src/analysis/chaseRoadIndex';
import type {ChaseCamMode, ChaseCar, ChaseEngine, ChaseRibbon, ChaseTheme, ChaseUpdate} from '@/src/features/race/chase/chaseTypes';
import {createCarLabels} from './carLabels';
import {createCarKit, type CarObject} from './carMeshes';
import {createCameraRig} from './cameraRig';
import {buildInputsScene, type InputsScene} from './inputsScene';
import {buildRoadScene, disposeGroup} from './roadScene';
import {setWorld} from './sceneFrame';


const FOG_NEAR_M = 260;
const FOG_FAR_M = 1500;
const ON_ROAD_MARGIN_M = 3;
/** A car whose pose moves further than this in one sample has been placed (pits, a rewind), not driven. */
const JUMP_M = 12;
const GLIDE_S = 0.07;
const LABELLED_CARS = 8;
const LABEL_RANGE_M = 120;
const LABEL_LIFT_M = 1.6;
const PICK_REACH_PX = 46;
const INPUT_WINDOW = 70;
const DRAG_RAD_PER_PX = 0.008;

interface CarState {
  /** The pose drawn; it glides toward `target`. */
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  target: {x: number; y: number; z: number; heading: number; pitch: number};
  car: ChaseCar;
  /** m/s. */
  v: number;
  /** Lap distance: the nearest road point's when on the road, otherwise the reported one. */
  ld: number;
  onRoad: boolean;
  /** Direction of travel from recent positions, null until known. */
  travel: number | null;
  prev: {x: number; y: number} | null;
}

export function mountChase(
  container: HTMLElement,
  opts: {theme: ChaseTheme; onPick: (index: number) => void},
): ChaseEngine {
  const T = opts.theme;
  const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new THREE.Color(T.bg), 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const el = renderer.domElement;
  el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
  container.appendChild(el);
  const labels = createCarLabels(container, T);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(T.bg);
  scene.fog = new THREE.Fog(new THREE.Color(T.bg), FOG_NEAR_M, FOG_FAR_M);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);

  let road: ChaseRoad | null = null;
  let ix: RoadIndex | null = null;
  let roadGroup: THREE.Group | null = null;
  let inputs: InputsScene | null = null;
  let ribbon: ChaseRibbon | null = null;
  let inputIdx = -1;
  let state: ChaseUpdate = {cars: [], focus: null, playing: false, rate: 1, inputIdx: -1};
  let dirty = true;
  let alive = true;
  let last = performance.now();
  const states = new Map<number, CarState>();
  const objects = new Map<number, CarObject>();
  const rig = createCameraRig(camera, () => ix);
  const kit = createCarKit({bg: T.bg, edge: T.text, mark: T.text});
  // one soft light from above and ahead, so a body's facets and the road's slopes read; nothing glows
  scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(T.bg), 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.7, 1, 0.25);
  scene.add(sun);
  const probe = new THREE.Vector3();

  function freeInputs(i: InputsScene) {
    i.mesh.geometry.dispose();
    (i.mesh.material as THREE.Material).dispose();
    disposeGroup(i.bars);
  }

  function setInputs(rb: ChaseRibbon | null) {
    if (inputs) {
      scene.remove(inputs.mesh, inputs.bars);
      freeInputs(inputs);
      inputs = null;
    }
    ribbon = rb;
    dirty = true;
    if (!rb || !ix || rb.x.length < 8) return;
    inputs = buildInputsScene(rb, ix, T);
    scene.add(inputs.mesh, inputs.bars);
  }

  function setRoad(next: ChaseRoad) {
    if (roadGroup) {
      scene.remove(roadGroup);
      disposeGroup(roadGroup);
      roadGroup = null;
    }
    road = next;
    ix = roadIndex(next);
    roadGroup = buildRoadScene(next, ix, T);
    scene.add(roadGroup);
    setInputs(ribbon);
  }

  /** The road gives each car its height and pitch, and checks the stored yaw against its own direction. */
  function ingest(cars: ChaseCar[]) {
    const seen = new Set<number>();
    for (const c of cars) {
      if (c.state === 'garage' || !Number.isFinite(c.xM)) continue;
      seen.add(c.index);
      const prior = states.get(c.index);
      const x = c.xM;
      const y = c.zM;
      const travel = prior?.prev ? stepTravel(prior.travel, x - prior.prev.x, y - prior.prev.y) : null;
      let onRoad = false;
      let tangent: number | null = null;
      let z = ix ? ix.heightAt(mod(c.lapDistM || 0, ix.lengthM || 1)) : 0;
      let grade = 0;
      let ld = ix ? mod(c.lapDistM, ix.lengthM || 1) : 0;
      const near = ix?.nearest(x, y, 3) ?? null;
      if (ix && near) {
        tangent = ix.tangentAt(near.s);
        z = ix.heightAt(near.s);
        if (near.dist < ix.widthAt(near.s, near.side) + ON_ROAD_MARGIN_M) {
          onRoad = true;
          ld = near.s;
          grade = (ix.heightAt(near.s + 4) - ix.heightAt(near.s - 4)) / 8;
        }
      }
      const target = {
        x,
        y,
        z,
        heading: chaseHeading({
          gameYaw: c.headingRad === null ? null : Math.PI / 2 - c.headingRad,
          tangent,
          travel,
          speedKmh: c.speedKmh,
          onRoad,
        }),
        pitch: onRoad ? Math.atan(grade) : 0,
      };
      if (prior) {
        Object.assign(prior, {target, car: c, v: c.speedKmh / 3.6, ld, onRoad, travel, prev: {x, y}});
      } else {
        states.set(c.index, {...target, target, car: c, v: c.speedKmh / 3.6, ld, onRoad, travel, prev: {x, y}});
      }
    }
    for (const k of [...states.keys()]) {
      if (seen.has(k)) continue;
      states.delete(k);
      const o = objects.get(k);
      if (o) {
        scene.remove(o);
        kit.release(o);
      }
      objects.delete(k);
      labels.drop(k);
    }
  }

  function followed(): CarState | null {
    const byFocus = state.focus !== null ? states.get(state.focus) : undefined;
    if (byFocus) return byFocus;
    for (const s of states.values()) if (s.car.player) return s;
    return states.values().next().value ?? null;
  }

  function render(dt: number) {
    const me = followed();
    if (!road || !ix || !me) {
      renderer.render(scene, camera);
      return;
    }
    // the 5 Hz field is interpolated by the app; the pose here glides toward it, so a car never steps
    for (const s of states.values()) {
      const t = s.target;
      const k = !state.playing || Math.hypot(t.x - s.x, t.y - s.y) > JUMP_M ? 1 : ease(dt, GLIDE_S);
      s.x = lerp(s.x, t.x, k);
      s.y = lerp(s.y, t.y, k);
      s.z = lerp(s.z, t.z, k);
      s.heading += angDiff(s.heading, t.heading) * k;
      s.pitch = lerp(s.pitch, t.pitch, k);
    }
    for (const [k, s] of states) {
      let o = objects.get(k);
      if (o && o.userData.player !== s.car.player) {
        scene.remove(o);
        kit.release(o);
        o = undefined;
      }
      if (!o) {
        o = kit.make(s.car.carClass, s.car.color, s.car.player);
        scene.add(o);
        objects.set(k, o);
      }
      setWorld(o.position, s.x, s.y, s.z + 0.02);
      o.rotation.order = 'YZX';
      o.rotation.set(0, s.heading, s.pitch);
    }
    // the camera rides the road where the followed car is drawn (after its glide), so the two never drift apart
    const drawn = me.onRoad ? ix.nearest(me.x, me.y, 1) : null;
    rig.update(
      dt,
      {
        x: me.x,
        y: me.y,
        z: me.z,
        heading: me.heading,
        travel: me.travel,
        ld: drawn ? drawn.s : me.ld,
        lateral: drawn ? drawn.side * drawn.dist : 0,
        onRoad: drawn !== null,
        v: me.v,
      },
      state.playing,
    );
    const mine = me.car.player;
    if (inputs) {
      const first = clamp(inputIdx + 1, 0, inputs.count - 2);
      const count = clamp(Math.min(INPUT_WINDOW, inputs.count - 2 - first), 0, INPUT_WINDOW);
      inputs.mesh.geometry.setDrawRange(first * 6, count * 6);
      inputs.mesh.visible = mine && inputIdx >= 0;
      inputs.bars.visible = mine;
    }
    renderer.render(scene, camera);
    placeLabels(me);
  }

  function placeLabels(me: CarState) {
    const dist = (s: CarState) => Math.hypot(s.x - me.x, s.y - me.y);
    const nearest = new Set(
      [...states.entries()]
        .filter(([, s]) => s !== me && dist(s) < LABEL_RANGE_M)
        .sort((a, b) => dist(a[1]) - dist(b[1]))
        .slice(0, LABELLED_CARS)
        .map(([k]) => k),
    );
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const [k, s] of states) {
      setWorld(probe, s.x, s.y, s.z + LABEL_LIFT_M).project(camera);
      const inView = probe.z < 1 && probe.z > -1 && Math.abs(probe.x) < 1.05 && Math.abs(probe.y) < 1.05;
      const show = nearest.has(k) && s.car.label !== '' && inView;
      labels.place(
        k,
        s.car.label,
        s.car.color,
        show ? {x: (probe.x * 0.5 + 0.5) * w, y: (-probe.y * 0.5 + 0.5) * h} : null,
        dist(s),
      );
    }
  }

  function frame(now: number) {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dirty || state.playing) {
      dirty = false;
      render(dt);
    }
    requestAnimationFrame(frame);
  }
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // press: the nearest car within a finger's reach; Heli: drag to look around
  let drag: {x: number; orbit: number; moved: boolean} | null = null;
  const onDown = (e: PointerEvent) => {
    drag = {x: e.clientX, orbit: rig.orbit, moved: false};
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || rig.mode !== 4) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    rig.orbit = drag.orbit - dx * DRAG_RAD_PER_PX;
    dirty = true;
  };
  const onUp = () => setTimeout(() => (drag = null), 0);
  const onClick = (e: MouseEvent) => {
    if (drag?.moved) return;
    const r = el.getBoundingClientRect();
    let best: number | null = null;
    let bestD = PICK_REACH_PX;
    for (const [k, s] of states) {
      setWorld(probe, s.x, s.y, s.z + 0.4).project(camera);
      if (probe.z > 1) continue;
      const d = Math.hypot((probe.x * 0.5 + 0.5) * r.width - (e.clientX - r.left), (-probe.y * 0.5 + 0.5) * r.height - (e.clientY - r.top));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best !== null) opts.onPick(best);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('click', onClick);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  requestAnimationFrame(frame);

  return {
    setRoad(r) {
      setRoad(r);
    },
    setInputs,
    update(u) {
      const was = state.focus;
      state = {...state, ...u};
      if (u.inputIdx !== undefined) inputIdx = u.inputIdx;
      if (u.focus !== undefined && u.focus !== was) rig.reset();
      ingest(state.cars);
      dirty = true;
    },
    setCam(mode: ChaseCamMode) {
      rig.mode = mode;
      dirty = true;
    },
    dispose() {
      alive = false;
      observer.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      for (const o of objects.values()) {
        scene.remove(o);
        kit.release(o);
      }
      objects.clear();
      states.clear();
      kit.dispose();
      if (roadGroup) {
        scene.remove(roadGroup);
        disposeGroup(roadGroup);
        roadGroup = null;
      }
      if (inputs) {
        scene.remove(inputs.mesh, inputs.bars);
        freeInputs(inputs);
        inputs = null;
      }
      renderer.dispose();
      renderer.forceContextLoss(); // a browser allows only a handful of live WebGL contexts
      el.remove();
      labels.dispose();
    },
  };
}
