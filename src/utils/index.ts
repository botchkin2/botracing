// Export utility functions from here
export {apiClient} from './api';
export {queryClient} from './queryClient';

// Binary search utilities
export {findClosestIndex} from './binarySearch';

// Color utilities
export {
  SERIES_BASE_COLORS,
  LAP_COLOR_SCHEMES,
  generateLapColorScheme,
  type SeriesKey,
} from './colors';

// Data processing utilities
export {parseTelemetryData, type TimeSeriesData} from './dataProcessing';

// Geometry utilities
export {
  convertLatLongToXY,
  type TrackMapData,
  type TrackCoordinate,
} from './geometry';
