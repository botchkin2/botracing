// LMU's own replay file (.Vcr), read for the cars' state. The game saves one per session in
// Documents\Le Mans Ultimate\UserData\Replays; it holds every car 50 times a second, which is what a field is
// rebuilt from when the live recorder did not run (pit wall thread 100, L3b). The format is the game's own and
// unofficial: it was worked out by pit-wall rumble (thread 94 #6231) and checked against a capture on a full race
// (Algarve P1: pose within 0.37 m / 0.4 deg at p99), so every constant here comes from there and a file that does
// not parse says so instead of returning a partial field.
//
// Layout: 0x2d `IRSR`, a file block, then slices from 0x3d. A slice is a float32 time and a uint16 event count,
// then the events. An event is a uint32 header (driver = bits 0-7, size = bits 8-16, type = bits 17-22,
// class = bits 29-31), one extra byte and `size` payload bytes, so the next event is 5 + size on.
// A car state is type 7..16 (gear = type - 8), size 65, class 0 in the Algarve file rumble read and class 1 in the
// Sebring one from 2026-10-21 (the game moved it between versions), so both are taken. Slices do not carry one clock:
// the others (class 7, driver 255) keep their own, so time is read per car state and never required to rise across
// slices.
// Measured on tonight's Sebring race (R1 21, 406 MB, 2026-10-21): one pass reads it in 0.5 s, 200,560 slices, 4.8 M car
// states, ids 0..22 and 104 (a static object at one point), no car clock ever goes backwards, a 2.7 KB trailer. Not yet
// handled by the consumer (vcrField, not written): a car's state holds a placeholder position of about 1e18 on a few
// samples (cars 10, 17, 18, 22), and driver 0 sat still at one point for the whole file; neither is a pose to draw.
import {closeSync, fstatSync, openSync, readSync} from 'node:fs';

const MAGIC_AT = 0x2d;
const FIRST_SLICE = 0x3d;
const CAR_SIZE = 65;
/** Event classes a car state has been seen under. */
const CAR_CLASSES = [0, 1];
// A slice is a few kilobytes; the reader keeps this much ahead so one never straddles a read.
const CHUNK = 8 * 1024 * 1024;
const MIN_AHEAD = 256 * 1024;
const ENGINE_RPM = 1.3641;
/** What may follow the last slice: the format's trailer (4 KB on the files read so far). */
const TRAILER_MAX = 64 * 1024;

export const isVcr = buf =>
  buf.length > MAGIC_AT + 4 && buf.toString('latin1', MAGIC_AT, MAGIC_AT + 4) === 'IRSR';

/** The replay-time axis is the session clock (mElapsedTime) exactly, offset 0.000 s (rumble, 5 ms steps). */
export const CAR_FIELDS = [
  't',
  'id',
  'gear',
  'steer',
  'throttle',
  'brake',
  'pit',
  'rpm',
  'x',
  'y',
  'z',
  'rotX',
  'rotY',
  'rotZ',
];

/**
 * Walks complete slices of `buf` from `from`, calling `onCar(car)` for every car state. `car` is one reused object
 * (copy what you keep): t seconds, id driver, gear, steer -1..1, throttle and brake 0..1, pit flag, rpm, x y z world
 * metres, rotX rotY rotZ radians (rotY is the body yaw). Returns {end, slices}: where the walk stopped (the start of
 * the first slice that is not complete in `buf`) and how many it read; `bad` is the offset where the bytes stopped
 * being a slice header (the trailer, or a file that is not a replay), else null.
 */
export function parseSlices(buf, from, onCar) {
  const car = {t: 0, id: 0, gear: 0, steer: 0, throttle: 0, brake: 0, pit: false, rpm: 0, x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0};
  let o = from;
  let slices = 0;
  let bad = null;
  const L = buf.length;
  while (o + 6 <= L) {
    const t = buf.readFloatLE(o);
    const n = buf.readUInt16LE(o + 4);
    // Not a slice header: the trailer after the last slice, or a file that is not what it says.
    if (!(t >= 0 && t < 1e5)) {
      bad = o;
      break;
    }
    let p = o + 6;
    let complete = true;
    for (let i = 0; i < n; i++) {
      if (p + 4 > L) {
        complete = false;
        break;
      }
      const h = buf.readUInt32LE(p);
      const size = (h >>> 8) & 0x1ff;
      if (p + 5 + size > L) {
        complete = false;
        break;
      }
      const type = (h >>> 17) & 0x3f;
      if (CAR_CLASSES.includes(h >>> 29) && type >= 7 && type <= 16 && size === CAR_SIZE) {
        const b = p + 5;
        const info = buf.readUInt32LE(b);
        car.t = t;
        car.id = h & 0xff;
        car.gear = type - 8;
        car.steer = (info & 0x3ff) * 0.00195 - 0.9987;
        car.throttle = ((info >>> 11) & 0x3f) / 63;
        car.pit = ((info >>> 17) & 1) === 1;
        car.rpm = (info >>> 18) * ENGINE_RPM;
        car.brake = (buf[b + 40] & 0x3f) / 63;
        car.x = buf.readFloatLE(b + 41);
        car.y = buf.readFloatLE(b + 45);
        car.z = buf.readFloatLE(b + 49);
        car.rotX = buf.readFloatLE(b + 53);
        car.rotY = buf.readFloatLE(b + 57);
        car.rotZ = buf.readFloatLE(b + 61);
        onCar(car);
      }
      p += 5 + size;
    }
    if (!complete) break;
    o = p;
    slices++;
  }
  return {end: o, slices, bad};
}

/**
 * Streams a .Vcr file from disk through parseSlices without holding it (a race is 400-800 MB).
 * Returns {slices, bytes, trailerBytes}; throws when the file is not a replay or stops making sense before its end,
 * naming the offset (the trailer after the last slice, a few KB, is expected and ignored).
 */
export function readVcr(path, onCar) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(FIRST_SLICE);
    if (readSync(fd, head, 0, FIRST_SLICE, 0) < FIRST_SLICE || !isVcr(head)) throw new Error(`vcr: ${path} is not a replay file`);
    let buf = Buffer.alloc(CHUNK);
    let filePos = FIRST_SLICE;
    let have = 0;
    let slices = 0;
    for (;;) {
      const got = readSync(fd, buf, have, buf.length - have, filePos + have);
      have += got;
      const eof = filePos + have >= size;
      const view = buf.subarray(0, have);
      const r = parseSlices(view, 0, onCar);
      slices += r.slices;
      // The last few KB of the file are a trailer, not slices: expected at the end, a failure anywhere before it.
      if (r.bad !== null && !(eof && filePos + r.bad >= size - TRAILER_MAX))
        throw new Error(`vcr: ${path} stopped making sense at byte ${filePos + r.bad}`);
      if (eof) return {slices, bytes: filePos + r.end, trailerBytes: size - (filePos + r.end)};
      if (r.end === 0 && have >= MIN_AHEAD) throw new Error(`vcr: ${path} has a slice larger than ${MIN_AHEAD} bytes at ${filePos}`);
      buf.copy(buf, 0, r.end, have);
      filePos += r.end;
      have -= r.end;
    }
  } finally {
    closeSync(fd);
  }
}
