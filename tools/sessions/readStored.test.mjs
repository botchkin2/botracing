import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {DEFAULT_LIMIT, parseArgs, readStored} from './readStored.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'readStored.mjs'), 'utf8');
const settings = JSON.parse(
  readFileSync(resolve(here, '../../.claude/settings.json'), 'utf8'),
);

const ALLOW_LINE = 'Bash(node tools/sessions/readStored.mjs:*)';

// The reader holds no write call. This reads the raw file, comments included,
// so a write cannot hide behind a rename, a bracket access or a string key.
test('the script contains no write call', () => {
  const methods =
    'set|update|delete|add|create|batch|runTransaction|bulkWriter|recursiveDelete|listCollections|terminate';
  const forms = [
    [new RegExp(`\\.\\s*(${methods})\\s*\\(`), 'a write method call'],
    [
      new RegExp(`\\[\\s*['"\`](${methods})['"\`]\\s*\\]`),
      'a bracket write call',
    ],
    [
      /\b(setDoc|updateDoc|deleteDoc|addDoc|writeBatch|FieldValue|WriteBatch|Transaction|BulkWriter)\b/,
      'a write API name',
    ],
    [
      /\.\s*(save|commit|write|destroy|remove|overwrite)\s*\(/,
      'a write-like call',
    ],
  ];
  for (const [pattern, what] of forms)
    assert.doesNotMatch(source, pattern, `readStored.mjs has ${what}`);
});

test('the script reaches Firestore only through get and getAll', () => {
  assert.match(source, /\.get\(\)/);
  assert.match(source, /\.getAll\(/);
  const calls = [...source.matchAll(/\b(?:query|coll|db)\.([A-Za-z]+)\(/g)].map(
    match => match[1],
  );
  assert.deepEqual([...new Set(calls)].sort(), [
    'collection',
    'doc',
    'get',
    'getAll',
    'limit',
    'select',
    'where',
  ]);
});

test('the script imports only node built-ins and firebase-admin', () => {
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(
    match => match[1],
  );
  assert.deepEqual(imports.sort(), ['node:module', 'node:path', 'node:url']);
  const requires = [...source.matchAll(/\brequire\(([^)]*)\)/g)].map(
    match => match[1],
  );
  assert.deepEqual(requires, ["'firebase-admin'"]);
  assert.doesNotMatch(source, /\bimport\s*\(/, 'dynamic import');
  assert.doesNotMatch(
    source,
    /\beval\b|new Function|child_process|node:fs|node:http|fetch\(/,
  );
});

test('settings.json allows exactly this script and nothing broader', () => {
  const lines = settings.permissions.allow.filter(line =>
    line.includes('readStored'),
  );
  assert.deepEqual(lines, [ALLOW_LINE]);
  // The rule is a prefix of the command line: no wildcard before the script.
  assert.ok(ALLOW_LINE.startsWith('Bash(node tools/sessions/readStored.mjs'));
});

test('parseArgs reads the options', () => {
  assert.deepEqual(
    parseArgs([
      '--collection',
      'sessions',
      '--owner',
      'LwTN',
      '--fields',
      'startedAt,analysis.v',
      '--sort',
      'startedAt',
      '--limit',
      '5',
    ]),
    {
      collection: 'sessions',
      owner: 'LwTN',
      ids: [],
      where: [],
      fields: ['startedAt', 'analysis.v'],
      sort: 'startedAt',
      limit: 5,
    },
  );
  const byId = parseArgs([
    '--collection',
    'sessions',
    '--id',
    'a,b',
    '--id',
    'c',
  ]);
  assert.deepEqual(byId.ids, ['a', 'b', 'c']);
  assert.equal(byId.limit, DEFAULT_LIMIT);
  assert.deepEqual(
    parseArgs(['--collection', 'laps', '--where', 'sessionId=x=y']).where,
    [{field: 'sessionId', value: 'x=y'}],
  );
});

test('parseArgs refuses what it cannot read safely', () => {
  const refused = [
    [[], /--collection is required/],
    [['--collection', 'a/b', '--owner', 'x'], /not a collection name/],
    [['--collection', 'sessions'], /whole collection/],
    [['--collection', 'sessions', '--id', 'a/b'], /ids are not paths/],
    [
      ['--collection', 'sessions', '--id', 'a', '--owner', 'x'],
      /cannot combine/,
    ],
    [
      ['--collection', 'sessions', '--owner', 'x', '--fields', 'a b'],
      /not a field path/,
    ],
    [
      ['--collection', 'sessions', '--owner', 'x', '--limit', '-1'],
      /whole number/,
    ],
    [['--collection', 'sessions', '--owner', 'x', '--limit'], /needs a value/],
    [
      ['--collection', 'sessions', '--owner', 'x', '--owner', 'y'],
      /given twice/,
    ],
    [
      ['--collection', 'sessions', '--owner', 'x', '--apply', '1'],
      /unknown option/,
    ],
    [['--collection', 'sessions', '--where', 'noequals'], /not field=value/],
    [['sessions'], /unexpected argument/],
  ];
  for (const [argv, message] of refused)
    assert.throws(() => parseArgs(argv), message, argv.join(' '));
});

// A Firestore with only the read calls; anything else is a TypeError.
function fakeDb(docs) {
  const log = [];
  const snapOf = entries => ({
    docs: entries.map(([id, data]) => ({id, exists: true, data: () => data})),
  });
  const db = {
    log,
    collection(name) {
      const rows = Object.entries(docs[name] ?? {});
      const make = steps => ({
        where: (field, op, value) =>
          make([...steps, {where: [field, op, value]}]),
        select: (...mask) => make([...steps, {select: mask}]),
        limit: n => make([...steps, {limit: n}]),
        get: async () => {
          log.push({collection: name, steps});
          let found = rows;
          let limit = Infinity;
          for (const step of steps) {
            if (step.where) {
              const [field, op, value] = step.where;
              found = found.filter(([, d]) =>
                op === '=='
                  ? d[field] === value
                  : op === '>='
                  ? d[field] >= value
                  : d[field] < value,
              );
            }
            if (step.limit) limit = step.limit;
          }
          return snapOf(found.slice(0, limit));
        },
      });
      return {...make([]), doc: id => ({id, name})};
    },
    getAll: async (...args) => {
      const options = typeof args.at(-1)?.id === 'string' ? null : args.pop();
      log.push({getAll: args.map(ref => ref.id), options});
      return args.map(ref => {
        const data = docs[ref.name]?.[ref.id];
        return {id: ref.id, exists: Boolean(data), data: () => data};
      });
    },
  };
  return db;
}

const DOCS = {
  sessions: {
    s1: {ownerId: 'LwTN1', startedAt: '2026-10-01', analysis: {v: 17}},
    s2: {ownerId: 'LwTN2', startedAt: '2026-10-03', analysis: {v: 18}},
    s3: {ownerId: 'Other', startedAt: '2026-10-05', analysis: {v: 18}},
  },
  laps: {
    l1: {ownerId: 'LwTN1', sessionId: 's1'},
    l2: {ownerId: 'LwTN1', sessionId: 's2'},
  },
};

test('an owner prefix matches only that owner, newest first', async () => {
  const db = fakeDb(DOCS);
  const rows = await readStored(
    db,
    parseArgs([
      '--collection',
      'sessions',
      '--owner',
      'LwTN',
      '--sort',
      'startedAt',
      '--fields',
      'analysis.v',
    ]),
  );
  assert.deepEqual(
    rows.map(row => row.id),
    ['s2', 's1'],
  );
  const select = db.log[0].steps.find(step => step.select).select;
  assert.deepEqual(select, ['analysis.v', 'startedAt']);
});

test('--limit cuts the rows and 0 keeps them all', async () => {
  const sorted = await readStored(
    fakeDb(DOCS),
    parseArgs([
      '--collection',
      'sessions',
      '--owner',
      'LwTN',
      '--sort',
      'startedAt',
      '--limit',
      '1',
    ]),
  );
  assert.deepEqual(
    sorted.map(row => row.id),
    ['s2'],
  );
  const unlimited = await readStored(
    fakeDb(DOCS),
    parseArgs(['--collection', 'sessions', '--owner', 'L', '--limit', '0']),
  );
  assert.equal(unlimited.length, 2);
});

test('--where adds an equality filter', async () => {
  const rows = await readStored(
    fakeDb(DOCS),
    parseArgs([
      '--collection',
      'laps',
      '--owner',
      'LwTN',
      '--where',
      'sessionId=s2',
    ]),
  );
  assert.deepEqual(
    rows.map(row => row.id),
    ['l2'],
  );
});

test('ids are read through getAll, and a missing one says so', async () => {
  const db = fakeDb(DOCS);
  const rows = await readStored(
    db,
    parseArgs([
      '--collection',
      'sessions',
      '--id',
      's1,nope',
      '--fields',
      'startedAt',
    ]),
  );
  assert.deepEqual(rows, [
    {id: 's1', ownerId: 'LwTN1', startedAt: '2026-10-01', analysis: {v: 17}},
    {id: 'nope', missing: true},
  ]);
  assert.deepEqual(db.log[0], {
    getAll: ['s1', 'nope'],
    options: {fieldMask: ['startedAt']},
  });
});
