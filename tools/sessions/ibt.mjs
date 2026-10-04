// iRacing .ibt reader. Binary layout is irsdk_header (112) + disk
// subheader (32) + YAML + var headers + 60 Hz rows.
import {closeSync, openSync, readSync, statSync} from 'node:fs';

export const HEADER_SIZE = 112;
const DISK_SIZE = 32;
export const VAR_HEADER_SIZE = 144;

const TYPE_SIZE = {0: 1, 1: 1, 2: 4, 3: 4, 4: 4, 5: 8};
const TYPE_NAME = {
  0: 'char',
  1: 'bool',
  2: 'int',
  3: 'bitfield',
  4: 'float',
  5: 'double',
};

function cstr(buf, start, max) {
  const end = buf.indexOf(0, start);
  const n = end === -1 ? max : Math.min(end, start + max) - start;
  return buf.toString('latin1', start, start + n);
}

export function parseHeader(buf) {
  const tickRate = buf.readInt32LE(8);
  const sessionInfoLen = buf.readInt32LE(16);
  const sessionInfoOffset = buf.readInt32LE(20);
  const numVars = buf.readInt32LE(24);
  const varHeaderOffset = buf.readInt32LE(28);
  const numBuf = buf.readInt32LE(32);
  const bufLen = buf.readInt32LE(36);
  const bufOffset = buf.readInt32LE(52);
  const sessionStartDate = Number(buf.readBigInt64LE(HEADER_SIZE));
  const sessionStartTime = buf.readDoubleLE(HEADER_SIZE + 8);
  const sessionEndTime = buf.readDoubleLE(HEADER_SIZE + 16);
  const sessionLapCount = buf.readInt32LE(HEADER_SIZE + 24);
  const sessionRecordCount = buf.readInt32LE(HEADER_SIZE + 28);
  return {
    tickRate,
    sessionInfoLen,
    sessionInfoOffset,
    numVars,
    varHeaderOffset,
    numBuf,
    bufLen,
    bufOffset,
    sessionStartDate,
    sessionStartTime,
    sessionEndTime,
    sessionLapCount,
    sessionRecordCount,
  };
}

export function parseVars(buf, header) {
  const vars = [];
  for (let i = 0; i < header.numVars; i++) {
    const at = header.varHeaderOffset + i * VAR_HEADER_SIZE;
    const type = buf.readInt32LE(at);
    vars.push({
      name: cstr(buf, at + 16, 32),
      desc: cstr(buf, at + 48, 64),
      unit: cstr(buf, at + 112, 32),
      type,
      typeName: TYPE_NAME[type] || String(type),
      offset: buf.readInt32LE(at + 4),
      count: buf.readInt32LE(at + 8),
      size: TYPE_SIZE[type] || 4,
    });
  }
  return vars;
}

export function yamlField(yaml, key) {
  const m = yaml.match(new RegExp(`^[ ]*${key}:[ ]*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

export function yamlKmToM(text) {
  const m = String(text).match(/([0-9.]+)\s*km/i);
  return m ? Number(m[1]) * 1000 : null;
}

export function openIbt(path) {
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  const head = Buffer.alloc(Math.min(size, 2 * 1024 * 1024));
  readSync(fd, head, 0, head.length, 0);
  const header = parseHeader(head);
  const need = Math.max(
    header.sessionInfoOffset + header.sessionInfoLen,
    header.varHeaderOffset + header.numVars * VAR_HEADER_SIZE,
  );
  let meta = head;
  if (need > head.length) {
    meta = Buffer.alloc(need);
    readSync(fd, meta, 0, need, 0);
  }
  const yaml = meta
    .subarray(
      header.sessionInfoOffset,
      header.sessionInfoOffset + header.sessionInfoLen,
    )
    .toString('latin1');
  const vars = parseVars(meta, header);
  const byName = new Map(vars.map(v => [v.name, v]));
  return {path, fd, size, header, yaml, vars, byName, close: () => closeSync(fd)};
}

function readNumber(buf, type, at) {
  if (type === 5) return buf.readDoubleLE(at);
  if (type === 4) return buf.readFloatLE(at);
  if (type === 2 || type === 3) return buf.readInt32LE(at);
  if (type === 1 || type === 0) return buf[at];
  return NaN;
}

export function sampleAt(ibt, name, index) {
  const v = ibt.byName.get(name);
  if (!v) return null;
  const {bufLen, bufOffset, sessionRecordCount: n} = ibt.header;
  if (index < 0 || index >= n) return null;
  const row = Buffer.alloc(bufLen);
  readSync(ibt.fd, row, 0, bufLen, bufOffset + index * bufLen);
  return readNumber(row, v.type, v.offset);
}

export function readColumn(ibt, name) {
  const v = ibt.byName.get(name);
  if (!v) return null;
  const {bufLen, bufOffset, sessionRecordCount: n} = ibt.header;
  const chunk = Buffer.alloc(n * bufLen);
  readSync(ibt.fd, chunk, 0, chunk.length, bufOffset);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = readNumber(chunk, v.type, i * bufLen + v.offset);
  }
  return out;
}
