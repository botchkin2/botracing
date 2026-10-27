// Whether the phone's Race screen is in its 3D, and so whether the key (the
// class colours and the dot glyphs of the 2D map) is shown under the map
// (pit-wall thread 118, ticket 67: the "Key ▾" word in the corner of the text
// line opened it, closed by default, and he took it for a button that does
// nothing). The key is always there when the 2D map is, as on the desktop.
import type {MapMode} from './components/RaceMap';

/**
 * The phone's 3D: the 3D mode is picked, this build can draw it, and the field
 * has something to chase. Without chase data RaceMap draws the 2D map whatever
 * the picked mode is (`chasing` in RaceMap.tsx), so that is not the 3D.
 */
export function phone3dOn(input: {
  desktop: boolean;
  mapMode: MapMode;
  chaseAvailable: boolean;
  hasChase: boolean;
}): boolean {
  return (
    !input.desktop &&
    input.mapMode === 'chase' &&
    input.chaseAvailable &&
    input.hasChase
  );
}

/** The key sits under the phone's 2D map, and nowhere in the phone's 3D (its tower and strip carry the classes). */
export function phoneKeyShown(phone3d: boolean): boolean {
  return !phone3d;
}
