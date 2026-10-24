import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workflowRuns} from './workflowRuns.mjs';

const YML = `name: T
on:
  pull_request:
jobs:
  app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm install
      - name: Types
        run: npx tsc --noEmit
      - name: Block
        run: |
          echo one
          echo two
  desktop:
    defaults:
      run:
        working-directory: desktop
    steps:
      - name: Tray tests
        run: cargo test
      - name: Elsewhere
        working-directory: tools/x
        run: node --test a.mjs
`;

test('reads single-line and block runs with their job, name and directory', () => {
  assert.deepEqual(workflowRuns(YML), [
    {job: 'app', name: null, cwd: null, run: 'npm install'},
    {job: 'app', name: 'Types', cwd: null, run: 'npx tsc --noEmit'},
    {job: 'app', name: 'Block', cwd: null, run: 'echo one\necho two'},
    {job: 'desktop', name: 'Tray tests', cwd: 'desktop', run: 'cargo test'},
    {job: 'desktop', name: 'Elsewhere', cwd: 'tools/x', run: 'node --test a.mjs'},
  ]);
});

test('a run in a shape it does not know is an error, never skipped', () => {
  assert.throws(
    () => workflowRuns('jobs:\n  a:\n    steps:\n      - run: {x: 1}\n'),
    /does not know/,
  );
});
