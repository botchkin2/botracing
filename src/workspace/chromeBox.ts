import {lapSlots} from '@/src/analysis/lapSlots';
import {
  type Lap,
  type SessionDetail,
  type TrackCorner,
} from '@/src/data/sessions';
import {
  carLabel,
  formatDayMonth,
  lapStroke,
  type Scheme,
  shortTrackName,
  turnLabel,
} from '@/src/design';
import {type SessionTab} from '@/src/nav/activeTab';
import {parseSelection} from '@/src/nav/routes';
import {sessionTabs} from '@/src/nav/sessionTabs';
import {type ChromeSession} from '@/src/ui';

export type ChromeBox = Omit<
  ChromeSession<SessionTab>,
  'onTab' | 'onMenu' | 'onClose'
>;

/**
 * The desktop bar's session box as finished values (round 6 frame 1). The
 * component attaches the handlers. `cornerN` is the corner the tab will open,
 * or null before any corner is used, when the tab reads plain "Corner".
 */
export function chromeBox({
  session,
  hasField,
  laps,
  selection,
  cornerN,
  corners,
  tab,
  scheme,
}: {
  session: Pick<SessionDetail, 'sessionType' | 'track' | 'car' | 'startedAt'>;
  /** Whether the session has a recorded field: the fourth tab is Race or Field. */
  hasField: boolean;
  laps: Pick<Lap, 'id' | 'lapIndex'>[] | undefined;
  selection: {laps?: string; ref?: string; hl?: string};
  cornerN: number | null;
  corners: Pick<TrackCorner, 'n' | 'official'>[] | undefined;
  tab: SessionTab | null;
  scheme: Scheme;
}): ChromeBox {
  const car = carLabel(session.car);
  const {laps: lapIds, ref} = parseSelection(selection);
  const found = lapIds.flatMap(lapId => laps?.find(l => l.id === lapId) ?? []);
  // Chip colours are the lap's slot (Ref 0, the rest by lap number), not its URL position.
  const slots = lapSlots(found, ref);
  const lapRows = found.map(lap => ({
    label: `L${lap.lapIndex}`,
    color: lapStroke(scheme, slots.get(lap.id) as number, found.length, false)
      .color,
  }));
  const cornerLabel =
    cornerN == null
      ? 'Corner'
      : `Corner ${turnLabel(
          cornerN,
          corners?.find(c => c.n === cornerN)?.official,
        )}`;
  return {
    badge: session.sessionType,
    track: shortTrackName(session.track),
    detail: [car.model, car.entry, formatDayMonth(session.startedAt)]
      .filter(Boolean)
      .join(' · '),
    tabs: sessionTabs(
      {sessionType: session.sessionType, hasField},
      cornerLabel,
    ),
    activeTab: tab,
    laps: lapRows,
  };
}
