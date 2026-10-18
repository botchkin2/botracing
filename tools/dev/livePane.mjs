// A headless browser pane for the gates, with no dependency: the PC's own Edge
// (or Chrome) started with --remote-debugging-port, driven over the DevTools
// protocol through Node's built-in WebSocket. It signs in as seat-test with the
// custom-token fragment (src/auth/customTokenFragment.ts), opens a page and
// lets a gate read what the SCREEN shows (liveE2E: a lap counts only when it
// is on the screen, not when the API has it; thread 1 #4983).
//
//   const pane = await openPane({origin, customTokenFile});
//   await pane.goto('/session/<id>');
//   const text = await pane.text();      // document.body.innerText
//   await pane.close();
//
// Scratch profile in the OS temp folder; nothing of the user's browser is touched.
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {seedRecord, seedScript} from './seatSession.mjs';

const CANDIDATES = [
  process.env.LAP_BROWSER,
  String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
  String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
].filter(Boolean);

export const findBrowser = () => CANDIDATES.find(p => existsSync(p)) ?? null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The DevTools websocket URL of the page the browser opened, once it is listening. */
async function pageSocket(profile, deadline) {
  const portFile = resolve(profile, 'DevToolsActivePort');
  while (Date.now() < deadline) {
    try {
      const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
      const list = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Not up yet.
    }
    await sleep(200);
  }
  throw new Error('the browser did not start listening in time');
}

export async function openPane({
  origin,
  customTokenFile,
  // {uid, idToken, refreshToken, expiresAtMs} from seatSession.mjs: CI's way in.
  session = null,
  browser = findBrowser(),
  startMs = 30_000,
}) {
  if (!browser) throw new Error('no Edge or Chrome found (set LAP_BROWSER)');
  const profile = mkdtempSync(resolve(tmpdir(), 'live-pane-'));
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=390,844',
      'about:blank',
    ],
    {windowsHide: true, stdio: 'ignore'},
  );
  const ws = new WebSocket(await pageSocket(profile, Date.now() + startMs));
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, {once: true});
    ws.addEventListener(
      'error',
      () => fail(new Error('DevTools socket failed')),
      {once: true},
    );
  });
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      const {ok, fail} = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      const n = ++id;
      waiting.set(n, {ok, fail});
      ws.send(JSON.stringify({id: n, method, params}));
    });
  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const goto = async (path, waitMs = 1500) => {
    await send('Page.navigate', {url: `${origin}${path}`});
    await sleep(waitMs);
  };
  const pane = {
    goto,
    evaluate,
    text: () => evaluate('document.body.innerText'),
    screenshot: async () =>
      Buffer.from(
        (await send('Page.captureScreenshot', {format: 'png'})).data,
        'base64',
      ),
    close: async () => {
      try {
        ws.close();
      } catch {
        // Already closed.
      }
      child.kill();
      await sleep(300);
      try {
        rmSync(profile, {recursive: true, force: true});
      } catch {
        // The browser may still hold a file; the OS temp folder takes it later.
      }
    },
  };
  if (session) {
    // CI's way in (seatSession.mjs): seat-test's own tokens, seeded where the
    // web SDK restores a user from, on a same-origin page that runs no app
    // code, so nothing races the write; the app then loads signed in.
    await send('Page.navigate', {url: `${origin}/api/tray/latest`});
    await sleep(1500);
    await evaluate(seedScript(seedRecord(session)));
  } else if (customTokenFile) {
    // The fragment never reaches a server; the app takes it out of the address.
    const token = readFileSync(customTokenFile, 'utf8').trim();
    await send('Page.navigate', {url: `${origin}/#ct=${token}`});
    await sleep(5000);
  }
  return pane;
}
