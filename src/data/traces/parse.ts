import {type RawTrace} from '@/src/analysis/resample';

// GET /laps/{id}/csv: Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,
// SteeringWheelAngle,Gear,OffAsphalt, in iRacing's units: Speed is m/s (the
// uploader divides LMU's km/h by 3.6); Brake and Throttle are
// 0..1. For LMU, SteeringWheelAngle is the fraction of steering lock (-1..1),
// not radians (docs/LMU_SYNC_NOTES.md), so steering is shown as % of lock.
// A channel logged slower than the file (Lat, Lon, Brake, Throttle) is empty
// on rows where it recorded nothing; those parse as NaN, "no sample".
// PathLateral and TrackEdge (analysis version 9) are metres, positive right of
// the game's centre path; TrackEdge is the edge on the car's side and has the
// lateral's sign. A trace uploaded before that has no such columns.
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
  // Optional columns: -1 when the file predates them.
  const optional = (name: string) => header.indexOf(name);
  const lateralAt = optional('PathLateral');
  const edgeAt = optional('TrackEdge');
  const out: RawTrace = {
    lapDistPct: [],
    speedKph: [],
    throttlePct: [],
    brakePct: [],
    steeringPct: [],
    gear: [],
    lat: [],
    lon: [],
    ...(lateralAt >= 0 ? {pathLateralM: []} : {}),
    ...(edgeAt >= 0 ? {trackEdgeM: []} : {}),
  };
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const v = cells.map(x => (x === '' ? NaN : x));
    out.lapDistPct.push(Number(v[c.pct]));
    out.speedKph.push(Number(v[c.speed]) * 3.6);
    out.throttlePct.push(Number(v[c.throttle]) * 100);
    out.brakePct.push(Number(v[c.brake]) * 100);
    out.steeringPct.push(Number(v[c.steer]) * 100);
    out.gear.push(Number(v[c.gear]));
    out.lat.push(Number(v[c.lat]));
    out.lon.push(Number(v[c.lon]));
    out.pathLateralM?.push(Number(v[lateralAt]));
    out.trackEdgeM?.push(Number(v[edgeAt]));
  }
  return out;
}
