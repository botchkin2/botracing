import {describe, expect, it} from '@jest/globals';
import {TRACE_SPEED_SLACK_KPH, traceAgrees} from './traceAgrees';

describe('traceAgrees', () => {
  it('rejects a trace that holds a standing value where the car is doing 118 km/h (R1 6, lap 0 on the grid)', () => {
    expect(traceAgrees(0, 118)).toBe(false);
  });
  it('accepts a trace within the slack of the field speed', () => {
    expect(traceAgrees(96, 100)).toBe(true);
    expect(traceAgrees(100, 100 + TRACE_SPEED_SLACK_KPH)).toBe(true);
  });
  it('rejects past the slack, either way', () => {
    expect(traceAgrees(100, 100 + TRACE_SPEED_SLACK_KPH + 1)).toBe(false);
    expect(traceAgrees(200, 100)).toBe(false);
  });
  it('accepts a standing car on both', () => {
    expect(traceAgrees(0, 0)).toBe(true);
  });
  it('rejects a missing trace value', () => {
    expect(traceAgrees(NaN, 100)).toBe(false);
  });
});
