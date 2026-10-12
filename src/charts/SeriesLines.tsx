import {memo} from 'react';
import {Path} from 'react-native-svg';

import {areaPath} from './chunkPaths';

// One series' line, as the chunks it draws (chunkPaths.ts). While Compare
// plays, the chart scrolls these with a transform on a group outside this
// component, and the chunk strings stay the same for many frames. This memo
// skips every Path of a series whose chunks and style did not change, so a
// frame reconciles the groups and not the 170 paths under them.

/** Neighbour laps across the line are context, not the selected lap. */
const WRAP_OPACITY = 0.4;

export type Chunk = {k: string | number; d: string};

export type SeriesLinesProps = {
  /** The line's chunks, in order. */
  ds: Chunk[];
  /** The neighbour laps' chunks, drawn fainter. */
  wraps: Chunk[];
  color: string;
  width: number;
  opacity: number;
  dash?: string;
  /** Fill under the line down to `base`, at this opacity. */
  fill?: number;
  base: number;
};

const sameChunks = (a: Chunk[], b: Chunk[]) =>
  a === b ||
  (a.length === b.length &&
    a.every((c, i) => c.k === b[i].k && c.d === b[i].d));

/**
 * Whether two renders of a series draw the same pixels. The chunk arrays are
 * rebuilt every frame, so they are compared by key and path string.
 */
export function sameLines(a: SeriesLinesProps, b: SeriesLinesProps): boolean {
  return (
    a.color === b.color &&
    a.width === b.width &&
    a.opacity === b.opacity &&
    a.dash === b.dash &&
    a.fill === b.fill &&
    a.base === b.base &&
    sameChunks(a.ds, b.ds) &&
    sameChunks(a.wraps, b.wraps)
  );
}

function SeriesLinesView({
  ds,
  wraps,
  color,
  width,
  opacity,
  dash,
  fill,
  base,
}: SeriesLinesProps) {
  return (
    <>
      {wraps.map(c => (
        <Path
          key={c.k}
          d={c.d}
          stroke={color}
          strokeWidth={width}
          strokeOpacity={opacity * WRAP_OPACITY}
          strokeDasharray={dash}
          strokeLinejoin='round'
          vectorEffect='non-scaling-stroke'
          fill='none'
        />
      ))}
      {ds.map(c =>
        fill == null ? null : (
          <Path
            key={`a${c.k}`}
            d={areaPath(c.d, base)}
            fill={color}
            fillOpacity={fill * opacity}
          />
        ),
      )}
      {ds.map(c => (
        <Path
          key={c.k}
          d={c.d}
          stroke={color}
          strokeWidth={width}
          strokeOpacity={opacity}
          strokeDasharray={dash}
          strokeLinejoin='round'
          vectorEffect='non-scaling-stroke'
          fill='none'
        />
      ))}
    </>
  );
}

export const SeriesLines = memo(SeriesLinesView, sameLines);
