// The long-race check in the real app on an emulator (pit wall thread 102,
// #39): opens a race through the app's own link, waits for the map and the
// board to be on the screen, and samples memory the whole time. The app is a
// local build whose API base is longRaceProxy.mjs (port 8099, reached through
// `adb reverse`), already signed in as seat-test.
//
//   node tools/dev/longRaceEmulator.mjs --serial emulator-5556 --session <id> [--runs 3] [--tab 3d|2d] [--proxy http://localhost:8099]
//
// Prints per run: time to open, peak total PSS of the app and of the WebView
// renderer (dumpsys meminfo), and any OOM or crash line from logcat.
//
// --tab 3d goes on to the 3D: taps the 3D mode, attaches to the WebView's devtools
// socket (the local APK sets webviewDebuggingEnabled; a release build does not),
// answers the page's own field request with the proxy's body (CDP Fetch, so the
// page parses the same synthetic field in V8), and prints the time to the first
// frame, the page's used JS heap peak and jsHeapSizeLimit, and the WebView PSS.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {centreOf, measureThreeD} from './longRaceWebView.mjs';

const run1 = promisify(execFile);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const serial = arg('serial', 'emulator-5554');
const sessionId = arg('session');
const runs = Number(arg('runs', '3'));
const tab = arg('tab', '2d');
const proxy = arg('proxy', 'http://localhost:8099');
const PACKAGE = 'app.botracing.android';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const adb = async (...args) => (await run1('adb', ['-s', serial, ...args], {maxBuffer: 64e6, env: {...process.env, MSYS_NO_PATHCONV: '1'}})).stdout;

/** TOTAL PSS in KB of a `dumpsys meminfo <process>` text, 0 when the process is not there. */
export const pssKb = text => Number(/TOTAL PSS:\s+(\d+)/.exec(text)?.[1] ?? /^\s+TOTAL\s+(\d+)/m.exec(text)?.[1] ?? 0);

async function memory() {
  let app = 0;
  let web = 0;
  try {
    app = pssKb(await adb('shell', 'dumpsys', 'meminfo', PACKAGE));
  } catch {
    // not running
  }
  try {
    const pids = (await adb('shell', 'ps', '-A')).split('\n').filter(l => /sandboxed_process/.test(l)).map(l => l.trim().split(/\s+/)[1]);
    for (const pid of pids) web += pssKb(await adb('shell', 'dumpsys', 'meminfo', pid));
  } catch {
    // none
  }
  return {app, web};
}

async function screenText() {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  return adb('exec-out', 'cat', '/sdcard/ui.xml');
}

for (let run = 1; run <= runs; run++) {
  await adb('shell', 'am', 'force-stop', PACKAGE);
  await adb('logcat', '-c');
  await sleep(1500);
  let peakApp = 0;
  let peakWeb = 0;
  let peakSum = 0;
  let sampling = true;
  // memory is sampled beside the screen poll: a dumpsys takes seconds and must not set the open time's grain
  const sampler = (async () => {
    while (sampling) {
      const m = await memory();
      peakApp = Math.max(peakApp, m.app);
      peakWeb = Math.max(peakWeb, m.web);
      peakSum = Math.max(peakSum, m.app + m.web);
    }
  })();
  const t0 = Date.now();
  await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `botracing61://session/${sessionId}/race`, PACKAGE);
  let openMs = null;
  while (Date.now() - t0 < 240_000) {
    const text = await screenText().catch(() => '');
    if (/Track/.test(text) && /CLASS/.test(text) && !/Loading field/.test(text)) {
      openMs = Date.now() - t0;
      break;
    }
  }
  let three = null;
  if (tab === '3d' && openMs !== null) {
    const at = centreOf(await screenText(), '3D');
    if (!at) three = {error: 'no 3D tab on the screen'};
    else {
      const t3 = Date.now();
      await adb('shell', 'input', 'tap', String(at.x), String(at.y));
      three = await measureThreeD({serial, sessionId, proxy, t0: t3}).catch(e => ({error: String(e.message ?? e)}));
    }
  }
  await sleep(4000);
  sampling = false;
  await sampler;
  const lines = (await adb('logcat', '-d', '-b', 'all')).split(/\r?\n/);
  const bad = lines.filter(l => /OutOfMemory|lowmemorykiller.*(kill|Kill)|Fatal signal|FATAL EXCEPTION|renderer.*crash|Killing (process|app)|has died/i.test(l) && !/Not killing/.test(l)).slice(0, 5);
  const mb = kb => Math.round(kb / 1024);
  const opened = openMs === null ? 'NEVER (240 s)' : `${(openMs / 1000).toFixed(1)} s`;
  console.log(`run ${run}: open ${opened}, peak PSS app ${mb(peakApp)} MB, WebView ${mb(peakWeb)} MB, sum ${mb(peakSum)} MB`);
  if (three) console.log(`  3D: ${three.error ?? `first frame ${(three.readyMs / 1000).toFixed(1)} s after the tap (field answered at ${(three.fieldAnsweredMs / 1000).toFixed(1)} s), page JS heap peak ${three.usedPeakMb} MB of a ${three.limitMb} MB limit (${Math.round((100 * three.usedPeakMb) / three.limitMb)} %)`}`);
  console.log(bad.length ? `  logcat: ${bad.join(' | ')}` : '  no OOM or crash lines in logcat');
}
