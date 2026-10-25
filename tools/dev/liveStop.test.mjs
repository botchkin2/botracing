import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {createStopper, killTree} from './liveStop.mjs';
import {mirrorLoopback, shutMirror} from './loopbackMirror.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const preload = path.join(here, 'exitWithParent.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const gone = async (pid, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    if (!alive(pid)) return true;
    await sleep(100);
  }
  return false;
};
// A node process that starts a grandchild, prints "<grandchild pid>" and stays up.
const TREE = `
  const {spawn} = require('node:child_process');
  const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
  console.log(g.pid);
  setInterval(() => {}, 1000);
`;
const firstLine = child =>
  new Promise(resolve =>
    child.stdout.once('data', d => resolve(Number(String(d).trim()))),
  );

test('killTree ends the child and its grandchild, not only the first process', async () => {
  const child = spawn(process.execPath, ['-e', TREE], {
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: process.platform !== 'win32',
  });
  const grandchild = await firstLine(child);
  assert.ok(alive(child.pid) && alive(grandchild));
  killTree(child.pid);
  assert.ok(await gone(child.pid), 'the child should be gone');
  assert.ok(await gone(grandchild), 'its grandchild should be gone');
});

// launcher -> metro. The launcher is killed outright (no handler runs). `detached` puts metro outside the launcher's
// Windows job (which would end it with the launcher), as in the leak where Metro outlived its launcher.
async function metroAfterLauncherKilled({withPreload}) {
  const launcher = spawn(
    process.execPath,
    [
      '-e',
      `
      const {spawn} = require('node:child_process');
      const env = {...process.env, LIVE_LAUNCHER_PID: String(process.pid)};
      if (process.env.PRELOAD) env.NODE_OPTIONS = '--require ' + JSON.stringify(process.env.PRELOAD);
      const m = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore', detached: true, env});
      console.log(m.pid);
      setInterval(() => {}, 1000);
    `,
    ],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        PRELOAD: withPreload ? preload.split(path.sep).join('/') : '',
      },
    },
  );
  const metro = await firstLine(launcher);
  assert.ok(alive(metro));
  process.kill(launcher.pid, 'SIGKILL');
  return metro;
}

test('without the preload a Metro outside its launcher outlives it (the leak this guards)', async () => {
  const metro = await metroAfterLauncherKilled({withPreload: false});
  await sleep(3500);
  const stillThere = alive(metro);
  killTree(metro);
  assert.ok(stillThere, 'the control Metro should still be running');
});

test('with the preload Metro ends once its launcher is gone, hard-killed or not', async () => {
  const metro = await metroAfterLauncherKilled({withPreload: true});
  assert.ok(await gone(metro), 'Metro should end once its launcher is gone');
});

test('shutMirror ends its connections and frees the port at once', async () => {
  const upstream = await new Promise(resolve => {
    const s = net.createServer(c => c.on('data', d => c.write(d)));
    s.listen({host: '::1', port: 0}, () => resolve(s));
  }).catch(() => null);
  if (!upstream) return; // no IPv6 loopback here
  const port = upstream.address().port;
  const mirror = await mirrorLoopback({port});
  const client = net.connect({host: '127.0.0.1', port});
  await new Promise(r => client.once('connect', r));
  const closed = new Promise(r => client.once('close', r));
  shutMirror(mirror);
  await closed;
  // The port is free for the next slot's mirror.
  const next = await mirrorLoopback({port});
  assert.ok(next, '127.0.0.1:port should be free again');
  shutMirror(next);
  upstream.close();
});

test('the stopper closes the mirror, ends the tree and exits after the delay whatever the child does', async () => {
  const calls = [];
  const exited = new Promise(resolve => {
    const stop = createStopper({
      child: {pid: 4242},
      mirror: null,
      kill: pid => calls.push(['kill', pid]),
      exit: code => resolve(code),
      delayMs: 50,
    });
    stop();
    stop(); // every signal and the exit handler may call it
  });
  assert.equal(await exited, 0);
  assert.deepEqual(calls, [['kill', 4242]]);
});
