import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {HEADER_SIZE, VAR_HEADER_SIZE, openIbt, readColumn, rowsInFile} from './ibt.mjs';

// A minimal .ibt: the irsdk header, the disk header, one variable
// (SessionTime, a double) and `rows` rows of 8 bytes. `recordCount` is what
// the header claims; the file always holds `rows`.
function ibtBytes({rows, recordCount}) {
  const yaml = Buffer.from('---\nWeekendInfo:\n TrackID: 1\n...\n', 'latin1');
  const varOffset = HEADER_SIZE + 32 + yaml.length;
  const bufOffset = varOffset + VAR_HEADER_SIZE;
  const buf = Buffer.alloc(bufOffset + rows * 8);
  buf.writeInt32LE(60, 8); // tickRate
  buf.writeInt32LE(yaml.length, 16);
  buf.writeInt32LE(HEADER_SIZE + 32, 20);
  buf.writeInt32LE(1, 24); // numVars
  buf.writeInt32LE(varOffset, 28);
  buf.writeInt32LE(1, 32); // numBuf
  buf.writeInt32LE(8, 36); // bufLen
  buf.writeInt32LE(bufOffset, 52);
  buf.writeInt32LE(recordCount, HEADER_SIZE + 28);
  yaml.copy(buf, HEADER_SIZE + 32);
  buf.writeInt32LE(5, varOffset); // type double
  buf.writeInt32LE(0, varOffset + 4); // offset in the row
  buf.writeInt32LE(1, varOffset + 8);
  buf.write('SessionTime', varOffset + 16, 'latin1');
  for (let i = 0; i < rows; i++) buf.writeDoubleLE(100 + i / 60, bufOffset + i * 8);
  return buf;
}

function withFile(bytes, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ibt-'));
  const path = join(dir, 'a.ibt');
  writeFileSync(path, bytes);
  const ibt = openIbt(path);
  try {
    return fn(ibt);
  } finally {
    ibt.close();
    rmSync(dir, {recursive: true, force: true});
  }
}

test('a finalized file reads the rows its header counts', () => {
  withFile(ibtBytes({rows: 120, recordCount: 120}), ibt => {
    assert.equal(ibt.header.sessionRecordCount, 120);
    assert.equal(ibt.header.recovered, false);
  });
});

test('a file whose header was never finalized reads every row it holds', () => {
  // Header count 0 (sim crashed or was killed): the whole drive is on disk.
  withFile(ibtBytes({rows: 3600, recordCount: 0}), ibt => {
    assert.equal(ibt.header.sessionRecordCount, 3600);
    assert.equal(ibt.header.recovered, true);
    const t = readColumn(ibt, 'SessionTime');
    assert.equal(t.length, 3600);
    assert.equal(t[0], 100);
    assert.ok(Math.abs(t[3599] - (100 + 3599 / 60)) < 1e-9);
  });
});

test('a header that counts more rows than the file holds is cut to the file', () => {
  withFile(ibtBytes({rows: 50, recordCount: 500}), ibt => {
    assert.equal(ibt.header.sessionRecordCount, 50);
    assert.equal(ibt.header.recovered, false);
  });
});

test('a file with no rows stays empty, and a half row is not a row', () => {
  withFile(ibtBytes({rows: 0, recordCount: 0}), ibt => {
    assert.equal(ibt.header.sessionRecordCount, 0);
    assert.equal(ibt.header.recovered, false);
  });
  assert.equal(rowsInFile({bufLen: 8, bufOffset: 100}, 100 + 8 * 3 + 5), 3);
  assert.equal(rowsInFile({bufLen: 0, bufOffset: 100}, 1000), 0);
});
