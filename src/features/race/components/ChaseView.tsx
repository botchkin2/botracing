import {View} from 'react-native';

import {type ChaseRoad} from '@/src/analysis/chaseRoad';

import {type ChaseCar} from './chaseTypes';

/** The 3D chase draws with WebGL, in a page: the phone build is the web build, a native build has no 3D yet. */
export const chaseAvailable = false;

export function ChaseView(_props: {
  width: number;
  height: number;
  road: ChaseRoad;
  cars: ChaseCar[];
  focus: number | null;
  playing: boolean;
  rate: number;
  onPressCar: (index: number) => void;
}) {
  return <View />;
}
