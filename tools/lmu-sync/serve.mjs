// Serves the local LMU pack in the same shape as /api/lmu on Firebase.
// The app reads it when EXPO_PUBLIC_LMU_API_BASE points here.

import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pack = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../sample_data/lmu/pack',
);
const port = Number(process.env.LMU_PORT || 8787);

function manifest() {
  return JSON.parse(readFileSync(resolve(pack, 'manifest.json'), 'utf8'));
}

createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const path = url.pathname;
  if (path.endsWith('/tracks')) {
    const laps = manifest();
    const byId = new Map();
    for (const lap of laps) {
      if (lap.track?.id != null) byId.set(lap.track.id, lap.track);
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({items: [...byId.values()]}));
    return;
  }
  const csv = path.match(/\/laps\/([^/]+)\/csv$/);
  if (csv) {
    const file = resolve(pack, 'laps', `${decodeURIComponent(csv[1])}.csv`);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, {'Content-Type': 'text/csv'});
    res.end(readFileSync(file));
    return;
  }
  if (path.endsWith('/laps')) {
    const laps = manifest();
    const tracks = String(url.searchParams.get('tracks') || '')
      .split(',')
      .map(Number)
      .filter(value => Number.isFinite(value) && value !== 0);
    const event = url.searchParams.get('event');
    const items = laps.filter(lap => {
      if (event && lap.event !== event) return false;
      if (tracks.length > 0 && !tracks.includes(lap.track?.id)) return false;
      return true;
    });
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({items, total: items.length}));
    return;
  }
  res.writeHead(404);
  res.end('not found');
}).listen(port, () => {
  console.log(`LMU pack on http://localhost:${port}/api/lmu`);
});
