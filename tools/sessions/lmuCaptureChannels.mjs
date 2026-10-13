// The capture's player columns as the archive's channels and events
// (lmuCapture.mjs): names, units and column types are lmu.mjs's, so the two
// archives read the same; the SQL converts TelemInfoV01's units.
const KELVIN = 273.15;
export const wheels = ['fl', 'fr', 'rl', 'rr'];

// Channels as [archive name, unit, column type, SQL over the player row p and
// the computed lap distance, path lateral and edge]. Types are lmu.mjs's by unit.
export const channelSql = [
  ['speed_kmh', 'km/h', 'DECIMAL(7,2)', 'p.v * 3.6'],
  ['rpm', 'RPM', 'INTEGER', 'p.mEngineRPM'],
  ['throttle_pct', '%', 'DECIMAL(5,1)', 'p.mFilteredThrottle * 100'],
  ['brake_pct', '%', 'DECIMAL(5,1)', 'p.mFilteredBrake * 100'],
  ['clutch_pct', '%', 'DECIMAL(5,1)', 'p.mFilteredClutch * 100'],
  ['steer_pct', '%', 'DECIMAL(5,1)', 'p.mFilteredSteering * 100'],
  [
    'throttle_pos_unfiltered',
    '%',
    'DECIMAL(5,1)',
    'p.mUnfilteredThrottle * 100',
  ],
  ['brake_pos_unfiltered', '%', 'DECIMAL(5,1)', 'p.mUnfilteredBrake * 100'],
  ['lap_dist_m', 'm', 'DECIMAL(10,4)', 'lap_dist'],
  ['lat_deg', 'deg', 'DECIMAL(11,7)', '60 + p.mPos_z * 8.9947e-6'],
  ['lon_deg', 'deg', 'DECIMAL(11,7)', 'p.mPos_x * 1.7978e-5'],
  ['path_lateral_m', 'm', 'DECIMAL(10,4)', 'path_lateral'],
  ['track_edge_m', 'm', 'DECIMAL(10,4)', 'track_edge'],
  ['fuel_l', 'L', 'DECIMAL(6,2)', 'p.mFuel'],
  ['virtual_energy_pct', '%', 'DECIMAL(5,1)', 'p.mVirtualEnergy * 100'],
  // mSoC is already 0-100, as the .duckdb's State of Charge.
  ['so_c', '%', 'DECIMAL(5,1)', 'p.mSoC'],
  // The .duckdb's Regen Rate is watts under a kW label (hybrid.mjs); FLOAT
  // there too, since watts overflow the kW decimal.
  ['regen_rate', 'kW', 'FLOAT', 'p.mRegen * 1000'],
];
export const wheelSql = [
  ['tyres_wear', '%', 'DECIMAL(5,1)', w => `p.${w}_mWear * 100`],
  ['tyres_pressure', 'kPa', 'DECIMAL(6,1)', w => `p.${w}_mPressure`],
  [
    'tyres_carcass_temp',
    'C',
    'DECIMAL(5,1)',
    w => `p.${w}_mTireCarcassTemperature - ${KELVIN}`,
  ],
  [
    'tyres_rubber_temp',
    'C',
    'DECIMAL(5,1)',
    w =>
      `(p.${w}_mTireInnerLayerTemperature_0 + p.${w}_mTireInnerLayerTemperature_1 + ` +
      `p.${w}_mTireInnerLayerTemperature_2 + p.${w}_mTireCarcassTemperature) / 4 - ${KELVIN}`,
  ],
  [
    'tyres_temp_left',
    'C',
    'DECIMAL(5,1)',
    w => `p.${w}_mTireInnerLayerTemperature_0 - ${KELVIN}`,
  ],
  [
    'tyres_temp_centre',
    'C',
    'DECIMAL(5,1)',
    w => `p.${w}_mTireInnerLayerTemperature_1 - ${KELVIN}`,
  ],
  [
    'tyres_temp_right',
    'C',
    'DECIMAL(5,1)',
    w => `p.${w}_mTireInnerLayerTemperature_2 - ${KELVIN}`,
  ],
];

export const playerCols = [
  'mElapsedTime',
  'mLapNumber',
  'mLapStartET',
  'mPos_x',
  'mPos_z',
  'mEngineRPM',
  'mFilteredThrottle',
  'mFilteredBrake',
  'mFilteredClutch',
  'mFilteredSteering',
  'mUnfilteredThrottle',
  'mUnfilteredBrake',
  'mFuel',
  'mVirtualEnergy',
  'mSoC',
  'mRegen',
  'mGear',
  'mCurrentSector',
  'mLastImpactET',
  ...wheels.flatMap(w => [
    `${w}_mWear`,
    `${w}_mPressure`,
    `${w}_mTireCarcassTemperature`,
    `${w}_mTireInnerLayerTemperature_0`,
    `${w}_mTireInnerLayerTemperature_1`,
    `${w}_mTireInnerLayerTemperature_2`,
    `${w}_mSurfaceType`,
    `${w}_mCompoundIndex`,
  ]),
];

export const eventList = [
  ['lap', 1],
  ['lap_time', 1],
  ['sector1_time', 1],
  ['sector2_through_time', 1],
  ['in_pits', 1],
  ['gear', 1],
  ['impact', 1],
  ['surface', 4],
  ['tyres_compound', 4],
  ['current_sector', 1],
  ['yellow_flag', 1],
  ['sector1_flag', 1],
  ['sector2_flag', 1],
  ['sector3_flag', 1],
  ['minimum_path_wetness', 1],
];

export function channelsInfo() {
  return [
    {source: 'mElapsedTime', name: 't', hz: 100, unit: 's', columns: ['t']},
    ...channelSql.map(([name, unit]) => ({
      source: 'capture',
      name,
      hz: 100,
      unit,
      columns: [name],
    })),
    ...wheelSql.map(([name, unit]) => ({
      source: 'capture',
      name,
      hz: 100,
      unit,
      columns: wheels.map(w => `${name}_${w}`),
    })),
  ];
}
