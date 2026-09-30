import {describe, expect, it} from '@jest/globals';

import {parseTraceCsv} from './parse';

// First rows of lap a367e0c6253951e8-020 (Road Atlanta), as served.
const CSV = `Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt
62.2833,0.000000,60.000083,0.000115,0.0000,1.0000,8336.0,0.0270,5,0
62.3056,0.000137,60.000080,0.000124,0.2500,0.5000,8334.0,-0.1000,5,0`;

describe('parseTraceCsv', () => {
  it('converts to app units: km/h, % pedal, % lock', () => {
    const t = parseTraceCsv(CSV);
    expect(t.speedKph[0]).toBeCloseTo(224.2, 1);
    expect(t.brakePct[1]).toBe(25);
    expect(t.throttlePct[1]).toBe(50);
    expect(t.steeringPct[1]).toBeCloseTo(-10);
    expect(t.gear).toEqual([5, 5]);
    expect(t.lapDistPct[1]).toBe(0.000137);
  });

  it('reads an empty cell as no sample, not zero', () => {
    const t =
      parseTraceCsv(`Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt
62.2833,0.000000,60.000083,0.000115,0.0000,1.0000,8336.0,0.0270,5,0
62.3056,0.000137,,,,,8334.0,-0.1000,5,0`);
    expect(t.brakePct[1]).toBeNaN();
    expect(t.throttlePct[1]).toBeNaN();
    expect(t.lat[1]).toBeNaN();
    expect(t.speedKph[1]).toBeCloseTo(224.3, 1);
  });
});

describe('lateral position (analysis version 9)', () => {
  const V9 = `Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt,PathLateral,TrackEdge
62.2833,0.000000,60.000083,0.000115,0.0000,1.0000,8336.0,0.0270,5,0,3.41,5.75
62.3056,0.000137,,,,,8334.0,-0.1000,5,0,,`;

  it('reads lateral and edge in metres, signed, empty as no sample', () => {
    const t = parseTraceCsv(V9);
    expect(t.pathLateralM).toEqual([3.41, NaN]);
    expect(t.trackEdgeM?.[0]).toBe(5.75);
    expect(t.trackEdgeM?.[1]).toBeNaN();
  });

  it('a trace from before version 9 has no lateral arrays, and still parses', () => {
    const t = parseTraceCsv(CSV);
    expect(t.pathLateralM).toBeUndefined();
    expect(t.trackEdgeM).toBeUndefined();
    expect(t.brakePct[1]).toBe(25);
  });
});
