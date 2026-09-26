import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';
import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

if (!admin.apps.length) {
  admin.initializeApp();
}

const BUCKET = 'botracing-61.appspot.com';

function allowCors(req: any, res: any) {
  const origin = req.headers.origin;
  const allowed = [
    'https://botracing-61.web.app',
    'https://botracing-61.firebaseapp.com',
    'http://localhost:8080',
    'http://localhost:8081',
    'http://localhost:19006',
  ];
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0];
  res.set('Access-Control-Allow-Origin', allowOrigin);
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Cache-Control', 'private');
}

function pathname(req: any): string {
  let path =
    req.path ||
    (typeof req.url === 'string' ? req.url.split('?')[0] : '') ||
    '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      path = new URL(path).pathname;
    } catch {
      path = '';
    }
  }
  return path;
}

const SEED = join(__dirname, '../lmu-seed');

function readSeedManifest(): any[] {
  const file = join(SEED, 'manifest.json');
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

async function readManifest(): Promise<any[]> {
  try {
    const [buf] = await admin
      .storage()
      .bucket(BUCKET)
      .file('lmu/manifest.json')
      .download();
    const parsed = JSON.parse(buf.toString('utf8'));
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // Bucket is empty until the PC uploader runs. The seed ships with the function.
  }
  return readSeedManifest();
}

async function readLapCsv(id: string): Promise<string | null> {
  try {
    const file = admin.storage().bucket(BUCKET).file(`lmu/laps/${id}.csv`);
    const [exists] = await file.exists();
    if (exists) {
      const [body] = await file.download();
      return body.toString('utf8');
    }
  } catch {
    // Fall through to the copy that deployed with the function.
  }
  const seeded = join(SEED, 'laps', `${id}.csv`);
  if (!existsSync(seeded)) return null;
  return readFileSync(seeded, 'utf8');
}

export const lmuApi = onRequest(async (req, res) => {
  allowCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({error: 'GET only'});
    return;
  }

  const path = pathname(req);
  try {
    const laps = await readManifest();
    if (path.endsWith('/tracks')) {
      const byId = new Map<number, any>();
      for (const lap of laps) {
        if (lap.track?.id != null) byId.set(lap.track.id, lap.track);
      }
      res.status(200).json({items: Array.from(byId.values())});
      return;
    }

    const csv = path.match(/\/laps\/([^/]+)\/csv$/);
    if (csv) {
      const id = decodeURIComponent(csv[1]);
      const body = await readLapCsv(id);
      if (!body) {
        res.status(404).json({error: 'Lap telemetry not found'});
        return;
      }
      res.set('Content-Type', 'text/csv');
      res.status(200).send(body);
      return;
    }

    if (path.endsWith('/laps')) {
      const trackFilter = String(req.query.tracks || '')
        .split(',')
        .map(value => Number(value))
        .filter(value => Number.isFinite(value) && value !== 0);
      const event = String(req.query.event || '');
      const items = laps.filter(lap => {
        if (event && lap.event !== event) return false;
        if (trackFilter.length > 0 && !trackFilter.includes(lap.track?.id)) {
          return false;
        }
        return true;
      });
      res.status(200).json({items, total: items.length});
      return;
    }

    res.status(404).json({error: 'Not found', path});
  } catch (error: any) {
    res.status(500).json({
      error: 'LMU data is not available',
      message: error?.message || String(error),
    });
  }
});
