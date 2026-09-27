import {type RawTrace} from '@/src/analysis/resample';

// GET /laps/{id}/csv: Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,
// SteeringWheelAngle,Gear,OffAsphalt, in iRacing's units: Speed is m/s (the
// uploader divides LMU's km/h by 3.6); Brake and Throttle are
// 0..1. For LMU, SteeringWheelAngle is the fraction of steering lock (-1..1),
// not radians (docs/LMU_SYNC_NOTES.md), so steering is shown as % of lock.
export function parseTraceCsv(csv: string): RawTrace {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`trace CSV has no ${name} column`);
    return i;
  };
  const c = {
    speed: col('Speed'),
    pct: col('LapDistPct'),
    lat: col('Lat'),
    lon: col('Lon'),
    brake: col('Brake'),
    throttle: col('Throttle'),
    steer: col('SteeringWheelAngle'),
    gear: col('Gear'),
  };
  const out: RawTrace = {
    lapDistPct: [],
    speedKph: [],
    throttlePct: [],
    brakePct: [],
    steeringPct: [],
    gear: [],
    lat: [],
    lon: [],
  };
  for (let i = 1; i < lines.length; i++) {
    const v = lines[i].split(',');
    out.lapDistPct.push(Number(v[c.pct]));
    out.speedKph.push(Number(v[c.speed]) * 3.6);
    out.throttlePct.push(Number(v[c.throttle]) * 100);
    out.brakePct.push(Number(v[c.brake]) * 100);
    out.steeringPct.push(Number(v[c.steer]) * 100);
    out.gear.push(Number(v[c.gear]));
    out.lat.push(Number(v[c.lat]));
    out.lon.push(Number(v[c.lon]));
  }
  return out;
}
