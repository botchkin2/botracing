// A stand-in for the API for the emulator run of the long-race check (pit wall
// thread 102, #39): every request goes through to production unchanged, except
// one session's field, which is answered with a synthetic long one
// (longRaceField.mjs) in the same gzipped-JSON form. A local build of the app
// (EXPO_PUBLIC_API_BASE=http://localhost:8099/api, cleartext allowed, never
// committed) reaches it through `adb reverse tcp:8099 tcp:8099`.
//
//   node tools/dev/longRaceProxy.mjs --id-token-file <file> --session <id> [--hours 2] [--cars 60] [--real] [--port 8099]
import {createServer} from 'node:http';
import {request} from 'node:https';
import {readFileSync} from 'node:fs';
import {gzipSync, gunzipSync} from 'node:zlib';
import {longRaceField} from './longRaceField.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const HOST = 'botracing-61.web.app';
const sessionId = arg('session');
const port = Number(arg('port', '8099'));
const hours = Number(arg('hours', '2'));
const cars = Number(arg('cars', '60'));
const real = process.argv.includes('--real');
const idToken = readFileSync(arg('id-token-file'), 'utf8').trim();

const get = (path, headers = {}) =>
  new Promise((ok, fail) => {
    request({host: HOST, path, headers: {Authorization: `Bearer ${idToken}`, ...headers}}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => ok({res, body: Buffer.concat(chunks)}));
    })
      .on('error', fail)
      .end();
  });

const session = JSON.parse((await get(`/api/sessions/${sessionId}`)).body);
const hash = session.field?.hash;
if (!hash) throw new Error('that session has no field');
const fieldPath = `/api/sessions/${sessionId}/field/${hash}`;
const realGz = (await get(fieldPath, {'Accept-Encoding': 'gzip'})).body;
const served = real ? realGz : gzipSync(Buffer.from(JSON.stringify(longRaceField(JSON.parse(gunzipSync(realGz)), {seconds: hours * 3600, cars}))));
console.log(`serving ${real ? 'the real field' : `${hours} h x ${cars} cars`} for ${sessionId}: ${(served.length / 1e6).toFixed(2)} MB gzipped, on :${port}`);

createServer((req, res) => {
  const path = req.url.replace(/^\/api/, '/api');
  if (req.method === 'GET' && path.startsWith(fieldPath)) {
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': served.length});
    res.end(served);
    console.log(`field served ${new Date().toISOString()}`);
    return;
  }
  const up = request({host: HOST, path, method: req.method, headers: {...req.headers, host: HOST}}, upstream => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res);
  });
  up.on('error', e => {
    res.writeHead(502);
    res.end(String(e));
  });
  req.pipe(up);
}).listen(port, '127.0.0.1');
