// Opens a race in a headless phone-sized Chrome whose CPU is throttled, with
// the race's field answered by a synthetic long one (longRaceField.mjs), and
// prints time-to-open and the JS heap peak (pit wall thread 102, #39). This
// is the quick loop; the proof is the same field in the real app on an
// emulator (longRaceProxy.mjs).
//
//   node tools/dev/longRaceProbe.mjs --origin https://botracing-61.web.app \
//     --custom-token-file <file> --id-token-file <file> --session <id> \
//     [--hours 2] [--cars 60] [--throttle 4] [--runs 3] [--real] [--api <base, default production>]
//
// --real serves the session's own field (the baseline).
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {longRaceField} from './longRaceField.mjs';
import {openPane} from './livePane.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const flag = name => process.argv.includes(`--${name}`);
const origin = arg('origin');
const customTokenFile = arg('custom-token-file');
const idToken = readFileSync(arg('id-token-file'), 'utf8').trim();
const sessionId = arg('session');
const hours = Number(arg('hours', '2'));
const cars = Number(arg('cars', '60'));
const throttle = Number(arg('throttle', '4'));
const runs = Number(arg('runs', '3'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const apiBase = arg('api', 'https://botracing-61.web.app/api');
const api = async path => fetch(`${apiBase}${path}`, {headers: {Authorization: `Bearer ${idToken}`, 'Accept-Encoding': 'gzip'}});
const session = await (await api(`/sessions/${sessionId}`)).json();
const hash = session.field?.hash;
if (!hash) throw new Error('that session has no field');
// fetch has already undone the gzip; the body served below is gzipped again, as the API sends it
const realText = Buffer.from(await (await api(`/sessions/${sessionId}/field/${hash}`)).arrayBuffer());
const realJson = JSON.parse(realText);
const body = flag('real')
  ? gzipSync(realText)
  : gzipSync(Buffer.from(JSON.stringify(longRaceField(realJson, {seconds: hours * 3600, cars}))));
console.log(`field served: ${flag('real') ? 'the real one' : `${hours} h, ${cars} cars`}, ${(body.length / 1e6).toFixed(2)} MB gzipped`);

const results = [];
for (let run = 1; run <= runs; run++) {
  const pane = await openPane({origin, customTokenFile});
  const {send} = pane;
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true});
  await send('Emulation.setCPUThrottlingRate', {rate: throttle});
  await send('Fetch.enable', {patterns: [{urlPattern: `*/sessions/${sessionId}/field/*`}]});
  await send('Performance.enable');
  pane.onEvent(async msg => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const {requestId, request} = msg.params;
    if (request.method === 'OPTIONS') {
      await send('Fetch.continueRequest', {requestId});
      return;
    }
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        {name: 'Content-Type', value: 'application/json; charset=utf-8'},
        {name: 'Content-Encoding', value: 'gzip'},
        {name: 'Access-Control-Allow-Origin', value: origin},
        {name: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization'},
      ],
      body: body.toString('base64'),
    });
  });
  let peak = 0;
  const sampler = setInterval(async () => {
    try {
      const {metrics} = await send('Performance.getMetrics');
      const used = metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0;
      peak = Math.max(peak, used);
    } catch {
      // the page is between loads
    }
  }, 100);
  const t0 = Date.now();
  await pane.goto(`/session/${sessionId}/race`, 0);
  let openMs = null;
  while (Date.now() - t0 < 180_000) {
    await sleep(250);
    const text = await pane.text().catch(() => '');
    // the map's mode control and the leaderboard's rows are drawn only with the field
    if (/Track\s+Follow/.test(text) && /CLASS/.test(text) && !/Loading field/.test(text)) {
      openMs = Date.now() - t0;
      break;
    }
  }
  clearInterval(sampler);
  results.push({run, openMs, heapPeakMB: Math.round(peak / 1e6)});
  console.log(`run ${run}: open ${openMs === null ? 'NEVER (180 s)' : `${(openMs / 1000).toFixed(1)} s`}, JS heap peak ${Math.round(peak / 1e6)} MB`);
  await pane.close();
}
const ok = results.filter(r => r.openMs !== null);
if (ok.length) {
  const mean = ok.reduce((a, r) => a + r.openMs, 0) / ok.length;
  console.log(`mean open ${(mean / 1000).toFixed(1)} s over ${ok.length}/${runs}, heap peak max ${Math.max(...results.map(r => r.heapPeakMB))} MB, throttle ${throttle}x`);
}
