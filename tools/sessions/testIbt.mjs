// A synthetic iRacing .ibt for tests: the layout ibt.mjs reads (irsdk header,
// disk subheader, YAML, var headers, 60 Hz rows), from named channels. No real
// telemetry, so CI can run the real describe/writeArchive path (a raw .ibt
// carries the driver's name and ids, which the golden set never stores).
import {writeFileSync} from 'node:fs';
import {HEADER_SIZE, VAR_HEADER_SIZE} from './ibt.mjs';

const DISK_SIZE = 32;
const SIZE = {bool: 1, int: 4, float: 4, double: 8};
const TYPE = {bool: 1, int: 2, float: 4, double: 5};

/**
 * channels: {name: {type: 'float'|'double'|'int'|'bool', values: number[]}},
 * every one the same length (the rows). yaml: the session info text.
 */
export function writeTestIbt(path, {channels, yaml = '', tickRate = 60}) {
  const names = Object.keys(channels);
  const rows = channels[names[0]].values.length;
  let offset = 0;
  const vars = names.map(name => {
    const {type} = channels[name];
    const v = {name, type, offset};
    offset += SIZE[type];
    return v;
  });
  const bufLen = offset;
  const yamlBuf = Buffer.from(yaml, 'latin1');
  const sessionInfoOffset = HEADER_SIZE + DISK_SIZE;
  const varHeaderOffset = sessionInfoOffset + yamlBuf.length;
  const bufOffset = varHeaderOffset + vars.length * VAR_HEADER_SIZE;
  const buf = Buffer.alloc(bufOffset + rows * bufLen);

  buf.writeInt32LE(2, 0); // version
  buf.writeInt32LE(tickRate, 8);
  buf.writeInt32LE(yamlBuf.length, 16);
  buf.writeInt32LE(sessionInfoOffset, 20);
  buf.writeInt32LE(vars.length, 24);
  buf.writeInt32LE(varHeaderOffset, 28);
  buf.writeInt32LE(1, 32); // numBuf
  buf.writeInt32LE(bufLen, 36);
  buf.writeInt32LE(bufOffset, 52);
  const time = channels.SessionTime?.values ?? [0];
  buf.writeBigInt64LE(1760000000n, HEADER_SIZE); // session start date (unix s)
  buf.writeDoubleLE(time[0], HEADER_SIZE + 8);
  buf.writeDoubleLE(time[time.length - 1], HEADER_SIZE + 16);
  buf.writeInt32LE(0, HEADER_SIZE + 24);
  buf.writeInt32LE(rows, HEADER_SIZE + 28);
  yamlBuf.copy(buf, sessionInfoOffset);

  vars.forEach((v, i) => {
    const at = varHeaderOffset + i * VAR_HEADER_SIZE;
    buf.writeInt32LE(TYPE[v.type], at);
    buf.writeInt32LE(v.offset, at + 4);
    buf.writeInt32LE(1, at + 8); // count
    buf.write(v.name, at + 16, 31, 'latin1');
  });

  for (let r = 0; r < rows; r++) {
    const base = bufOffset + r * bufLen;
    for (const v of vars) {
      const x = channels[v.name].values[r];
      const at = base + v.offset;
      if (v.type === 'double') buf.writeDoubleLE(x, at);
      else if (v.type === 'float') buf.writeFloatLE(x, at);
      else if (v.type === 'int') buf.writeInt32LE(x, at);
      else buf[at] = x ? 1 : 0;
    }
  }
  writeFileSync(path, buf);
}
