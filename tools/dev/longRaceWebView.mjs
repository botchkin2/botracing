// The 3D leg of the long-race check (pit wall thread 102, #39): the WebView page parses the field again, in V8, in the
// WebView's renderer process. Needs a local APK with webviewDebuggingEnabled (the release app does not set it): the
// WebView's devtools socket is forwarded with adb and driven over the protocol. Used by longRaceEmulator.mjs --tab 3d.
//
// The page's own request for the field is answered from the proxy's body (the same synthetic field the native screen got),
// so the page parses the long field through its own path: fetch, JSON.parse, toField.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run1 = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The WebView's devtools socket name from /proc/net/unix text, or null. */
export const devtoolsSocket = (text, pid) => (text.match(/@webview_devtools_remote_\d+/g) ?? []).map(n => n.slice(1)).find(n => n.endsWith(`_${pid}`)) ?? null;

/** The page target of a devtools /json listing: the 3D page (embed=3d), else the first page. */
export const pageTarget = list => list.find(t => t.type === 'page' && /embed=3d/.test(t.url)) ?? list.find(t => t.type === 'page') ?? null;

/** The centre of the node with this text in a uiautomator dump, or null. */
export const centreOf = (xml, text) => {
  for (const node of xml.match(/<node [^>]*>/g) ?? []) {
    if (!node.includes(`text="${text}"`)) continue;
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (b) return {x: Math.round((+b[1] + +b[3]) / 2), y: Math.round((+b[2] + +b[4]) / 2)};
  }
  return null;
};

/** Whether a paused request is the race's field (GET, under /sessions/<id>/field/). */
export const isFieldRequest = (req, sessionId) => req.method === 'GET' && req.url.includes(`/sessions/${sessionId}/field/`);

/**
 * Attaches to the WebView page as soon as its socket shows, answers the field request, and samples the page's JS heap
 * every 500 ms until the canvas is drawn. Returns {readyMs, usedPeakMb, limitMb, fieldAnsweredMs}; readyMs counts from `t0`.
 */
export async function measureThreeD({serial, sessionId, proxy, port = 9444, t0, timeoutMs = 240_000}) {
  const adb = async (...args) => (await run1('adb', ['-s', serial, ...args], {maxBuffer: 64e6, env: {...process.env, MSYS_NO_PATHCONV: '1'}})).stdout;
  let socket = null;
  while (!socket && Date.now() - t0 < timeoutMs) {
    const pid = (await adb('shell', 'pidof', 'app.botracing.android').catch(() => '')).trim().split(/\s+/)[0];
    if (pid) socket = devtoolsSocket(await adb('shell', 'cat', '/proc/net/unix').catch(() => ''), pid);
    if (!socket) await sleep(200);
  }
  if (!socket) throw new Error('no WebView devtools socket (is webviewDebuggingEnabled on?)');
  await adb('forward', `tcp:${port}`, `localabstract:${socket}`);
  let target = null;
  while (!target && Date.now() - t0 < timeoutMs) {
    try {
      target = pageTarget(await (await fetch(`http://127.0.0.1:${port}/json`)).json());
    } catch {
      // not up yet
    }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('no WebView page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    } else if (d.method) events.push(d);
  };
  const send = (method, params = {}) =>
    new Promise(ok => {
      const id = nextId++;
      pending.set(id, ok);
      ws.send(JSON.stringify({id, method, params}));
    });
  await send('Fetch.enable', {patterns: [{urlPattern: '*/field/*', requestStage: 'Request'}]});
  let fieldAnsweredMs = null;
  const eval1 = async expression => (await send('Runtime.evaluate', {expression, returnByValue: true})).result?.result?.value;
  let usedPeak = 0;
  let limit = 0;
  let readyMs = null;
  while (Date.now() - t0 < timeoutMs) {
    while (events.length) {
      const e = events.shift();
      if (e.method !== 'Fetch.requestPaused') continue;
      const req = e.params.request;
      if (!isFieldRequest(req, sessionId)) {
        await send('Fetch.continueRequest', {requestId: e.params.requestId});
        continue;
      }
      const path = new URL(req.url).pathname.replace(/^\/api/, '');
      const body = Buffer.from(await (await fetch(`${proxy}/api${path}`, {headers: {'Accept-Encoding': 'gzip'}})).arrayBuffer());
      await send('Fetch.fulfillRequest', {
        requestId: e.params.requestId,
        responseCode: 200,
        responseHeaders: [
          {name: 'Content-Type', value: 'application/json; charset=utf-8'},
          {name: 'Content-Encoding', value: 'gzip'},
          {name: 'Access-Control-Allow-Origin', value: '*'},
        ],
        body: body.toString('base64'),
      });
      fieldAnsweredMs = Date.now() - t0;
    }
    const s = await eval1(`({used: performance.memory.usedJSHeapSize, limit: performance.memory.jsHeapSizeLimit, canvas: !!document.querySelector('canvas')})`);
    if (s) {
      usedPeak = Math.max(usedPeak, s.used);
      limit = s.limit;
      if (s.canvas && readyMs === null) readyMs = Date.now() - t0;
    }
    if (readyMs !== null && Date.now() - t0 > readyMs + 4000) break;
    await sleep(500);
  }
  ws.close();
  const mb = b => Math.round(b / 1048576);
  return {readyMs, usedPeakMb: mb(usedPeak), limitMb: mb(limit), fieldAnsweredMs};
}
