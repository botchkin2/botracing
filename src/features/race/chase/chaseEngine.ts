// Chase view engine for the Race screen. The app owns the data and the clock; this draws one frame of it as an
// instrument: near-black space, a faint datum grid under the road, the road at its measured width and curated height
// with thin edges and cross rungs, every car a lit low-poly body in its class colour standing on the road at the road's
// grade and bank, the player's inputs painted on the road. Nothing is drawn that the data does not hold: no sky, grass,
// kerbs, gravel, liveries, or height or bank the track does not have. Web only (three.js).
//
// World frame: x east, y north, z up (the sim's x and z); three.js is (x, z, -y), see sceneFrame.ts.

import * as THREE from 'three';
import {clamp, mod} from '@/src/analysis/chaseMath';
import {clockAt, followApp, type ChaseClock} from '@/src/analysis/chaseClock';
import {surfacePose} from '@/src/analysis/chasePose';
import {dragFree, isFree, resetFree, zoomFree} from '@/src/analysis/chaseFreeCam';
import {createPanRule} from '@/src/analysis/panGesture';
import {chaseHeading, stepTravel} from '@/src/analysis/chaseHeading';
import type {ChaseRoad} from '@/src/analysis/chaseRoad';
import {roadIndex, type RoadIndex} from '@/src/analysis/chaseRoadIndex';
import type {ChaseCamMode, ChaseCar, ChaseEngine, ChaseRibbon, ChaseTheme, ChaseUpdate} from '@/src/features/race/chase/chaseTypes';
import type {ChaseFrame} from './chaseInputsAt';
import {createCarLabels, declutterLabels, type LabelCandidate} from './carLabels';
import {createCarKit, type CarObject} from './carMeshes';
import {createCameraRig} from './cameraRig';
import {setCarRotation} from './carPose';
import {buildInputsScene, type InputsScene} from './inputsScene';
import {buildRoadScene, disposeGroup} from './roadScene';
import {setWorld} from './sceneFrame';


const FOG_NEAR_M = 260;
const FOG_FAR_M = 1500;
const ON_ROAD_MARGIN_M = 3;
/** A car whose pose moves further than this in one sample has been placed (pits, a rewind), not driven. */
/** A car is see-through once nearer the camera than the followed car less this, solid again past it plus FADE_BAND_M. */
const FADE_IN_M = 1;
const FADE_BAND_M = 2;
const LABELLED_CARS = 8;
const LABEL_RANGE_M = 120;
const LABEL_LIFT_M = 1.6;
const PICK_REACH_PX = 46;
const INPUT_WINDOW = 70;
const HELI_DRAG_RAD_PER_PX = 0.008;

interface CarState {
  /** The pose drawn: the data's own at the engine's clock. */
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  /** The road's roll under the car, radians, + with the car's right side up. */
  roll: number;
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
  opts: {
    theme: ChaseTheme;
    onPick: (index: number) => void; onFree?: (free: boolean) => void;
    onPan?: (dy: number) => void;
    /** Every frame drawn: the followed car's lap distance at the engine's own clock (the HUD reads the recording there). */
    onFollowed?: (frame: ChaseFrame) => void;
  },
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
  let state: ChaseUpdate = {sample: () => [], timeS: 0, focus: null, playing: false, rate: 1, inputIdx: -1};
  let clock: ChaseClock = {timeS: 0, atMs: performance.now(), playing: false, rate: 1, appS: 0};
  let dirty = true;
  let alive = true;
  let last = performance.now();
  const states = new Map<number, CarState>();
  const objects = new Map<number, CarObject>();
  const rig = createCameraRig(camera, () => ix);
  const kit = createCarKit({bg: T.bg, edge: T.text, mark: T.text});
  // a key light high and to one side, a weak fill: a body's top, flanks and tail come out in three tones and the road's
  // slopes shade; nothing glows
  scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(T.bg), 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(0.9, 1.3, -0.4);
  scene.add(key);
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
      const lapS = ix ? mod(((c.lapDistM || 0) * ix.lengthM) / (ix.lapM || 1), ix.lengthM || 1) : 0;
      let z = ix ? ix.heightAt(lapS) : 0;
      let pitch = 0;
      let roll = 0;
      let ld = lapS;
      const near = ix?.nearest(x, y, 3) ?? null;
      if (ix && near) {
        tangent = ix.tangentAt(near.s);
        // the road's grade and bank under or beside the car: a car touching the edge margin must not change pitch
        // with it, and a car beyond the margin stands on the surface at the margin, not at its distance from it
        const reach = ix.widthAt(near.s, near.side) + ON_ROAD_MARGIN_M;
        const pose = surfacePose(ix, near.s, near.side * Math.min(near.dist, reach));
        z = pose.z;
        pitch = pose.pitch;
        roll = pose.roll;
        if (near.dist < ix.widthAt(near.s, near.side) + ON_ROAD_MARGIN_M) {
          onRoad = true;
          ld = near.s;
        }
      }
      const pose = {
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
        pitch,
        roll,
      };
      if (prior) {
        Object.assign(prior, pose, {car: c, v: c.speedKmh / 3.6, ld, onRoad, travel, prev: {x, y}});
      } else {
        states.set(c.index, {...pose, car: c, v: c.speedKmh / 3.6, ld, onRoad, travel, prev: {x, y}});
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
    // only the road around the followed car is drawn (a draw range per piece)
    roadGroup?.userData.window(me.ld);
    for (const [k, s] of states) {
      let o = objects.get(k);
      if (o && (o.userData.player !== s.car.player || o.userData.vehicle !== (s.car.vehicle ?? null))) {
        scene.remove(o);
        kit.release(o);
        o = undefined;
      }
      if (!o) {
        o = kit.make(s.car.carClass, s.car.color, s.car.player, s.car.vehicle);
        scene.add(o);
        objects.set(k, o);
      }
      setWorld(o.position, s.x, s.y, s.z + 0.02);
      setCarRotation(o, s.heading, s.pitch, s.roll);
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
      state.rate,
    );
    // a car nearer the camera than the followed one would hide it: draw it see-through
    const meObj = [...states].find(([, s]) => s === me)?.[0];
    const meAt = meObj !== undefined ? objects.get(meObj) : undefined;
    if (meAt) {
      const reach = camera.position.distanceTo(meAt.position);
      for (const [k, o] of objects) {
        const d = camera.position.distanceTo(o.position);
        const faded = o.userData.faded ? d < reach - FADE_IN_M + FADE_BAND_M : d < reach - FADE_IN_M;
        kit.fade(o, k !== meObj && faded);
      }
    }
    const mine = me.car.player;
    opts.onFollowed?.({lapDistM: me.car.lapDistM, player: mine});
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
    const at = new Map<number, {x: number; y: number}>();
    const candidates: LabelCandidate[] = [];
    for (const [k, s] of states) {
      setWorld(probe, s.x, s.y, s.z + LABEL_LIFT_M).project(camera);
      const inView = probe.z < 1 && probe.z > -1 && Math.abs(probe.x) < 1.05 && Math.abs(probe.y) < 1.05;
      if (!(nearest.has(k) && s.car.label !== '' && inView)) continue;
      const pos = {x: (probe.x * 0.5 + 0.5) * w, y: (-probe.y * 0.5 + 0.5) * h};
      at.set(k, pos);
      candidates.push({key: k, ...pos, text: s.car.label, distM: dist(s)});
    }
    // labels that would sit on top of each other: the nearer car keeps its number
    const shown = declutterLabels(candidates);
    for (const [k, s] of states) labels.place(k, s.car.label, s.car.color, shown.has(k) ? at.get(k)! : null, dist(s));
  }

  let wasFree = false;
  function frame(now: number) {
    if (!alive) return;
    const panDy = pan?.frame(now) ?? 0;
    if (panDy !== 0) opts.onPan?.(panDy);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dirty || state.playing) {
      dirty = false;
      // every car where the data puts it at this instant: the field interpolated, paused too, so pausing moves nothing
      ingest(state.sample(clockAt(clock, now), false));
      render(dt);
      if (rig.free.resetting) dirty = true;
      const free = isFree(rig.free);
      if (free !== wasFree) opts.onFree?.((wasFree = free));
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

  // press: the nearest car within a finger's reach; drag: Heli looks round, Chase and High turn and raise the camera
  // round the car (chaseFreeCam); the wheel zooms; a double click is Reset. With `onPan` (the app's WebView) a finger
  // drag is the camera's by its sideways travel only, or the page's when it is steep: panGesture decides once, and
  // the page's share goes out once a frame. It is the page's from anywhere in the WebView (the strip and the camera
  // chips are in it too), the camera's only from the canvas. A mouse keeps the free drag.
  const pan = opts.onPan ? createPanRule() : null;
  let panPointer: number | null = null;
  let panOnCanvas = false;
  const rootTouchAction = document.documentElement.style.touchAction;
  if (pan) document.documentElement.style.touchAction = 'none';
  // The drag is measured on the screen (screenX/Y, from the touch's raw position): the page scrolls under the finger as it
  // forwards the drag, so clientY would shrink to nothing as the page catches up and the scroll would stop at about half.
  const onPanDown = (e: PointerEvent) => {
    if (!pan || e.pointerType !== 'touch' || panPointer !== null) return;
    panPointer = e.pointerId;
    panOnCanvas = e.target === el;
    pan.down(e.screenX, e.screenY, e.timeStamp);
  };
  let drag: {x: number; y: number; px: number; py: number; orbit: number; moved: boolean} | null = null;
  const onDown = (e: PointerEvent) => {
    drag = {x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, orbit: rig.orbit, moved: false};
  };
  const onMove = (e: PointerEvent) => {
    let turnPx: number | null = null;
    if (pan && panPointer !== null) {
      if (e.pointerId !== panPointer) return;
      const turn = pan.move(e.screenX, e.screenY, e.timeStamp);
      turnPx = panOnCanvas ? turn : 0;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4 || Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    if (turnPx !== null) {
      if (rig.mode === 4) rig.orbit -= turnPx * HELI_DRAG_RAD_PER_PX;
      else if (rig.mode === 1 || rig.mode === 2) dragFree(rig.free, turnPx, 0);
    } else if (rig.mode === 4) rig.orbit = drag.orbit - dx * HELI_DRAG_RAD_PER_PX;
    else if ((rig.mode === 1 || rig.mode === 2) && drag.moved) dragFree(rig.free, e.clientX - drag.px, e.clientY - drag.py);
    drag.px = e.clientX;
    drag.py = e.clientY;
    dirty = true;
  };
  const onUp = (e: PointerEvent) => {
    if (pan && e.pointerId === panPointer) {
      pan.up(e.timeStamp);
      panPointer = null;
    }
    setTimeout(() => (drag = null), 0);
  };
  // The browser took the gesture (a pan it owns) or the pointer was lost: the drag is over, the camera is let go. A touch
  // gets lostpointercapture right after its pointerup (implicit capture): by then the finger has lifted and the fling
  // is the page's to finish, and another finger's cancel is not this drag's.
  const onCancel = (e: PointerEvent) => {
    if (pan && e.pointerType === 'touch' && e.pointerId !== panPointer) return;
    pan?.cancel();
    panPointer = null;
    drag = null;
  };
  const onWheel = (e: WheelEvent) => {
    if (rig.mode !== 1 && rig.mode !== 2) return;
    e.preventDefault();
    zoomFree(rig.free, e.deltaY);
    dirty = true;
  };
  const onDouble = () => {
    resetFree(rig.free);
    dirty = true;
  };
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
  el.addEventListener('dblclick', onDouble);
  el.addEventListener('wheel', onWheel, {passive: false});
  addEventListener('pointermove', onMove);
  addEventListener('pointerdown', onPanDown, true);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onCancel);
  requestAnimationFrame(frame);

  return {
    setRoad(r) {
      setRoad(r);
    },
    setInputs,
    update(u) {
      const was = state.focus;
      state = {...state, ...u};
      if (u.timeS !== undefined || u.playing !== undefined || u.rate !== undefined) {
        clock = followApp(clock, {timeS: state.timeS, playing: state.playing, rate: state.rate}, performance.now());
      }
      if (u.inputIdx !== undefined) inputIdx = u.inputIdx;
      if (u.focus !== undefined && u.focus !== was) rig.reset();
      dirty = true;
    },
    resetCam() {
      resetFree(rig.free);
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
      el.removeEventListener('dblclick', onDouble);
      el.removeEventListener('wheel', onWheel);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerdown', onPanDown, true);
      document.documentElement.style.touchAction = rootTouchAction;
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onCancel);
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
