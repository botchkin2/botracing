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
  turnNumber,
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
  laps,
  selection,
  cornerN,
  corners,
  tab,
  scheme,
}: {
  session: Pick<SessionDetail, 'sessionType' | 'track' | 'car' | 'startedAt'>;
  laps: Pick<Lap, 'id' | 'lapIndex'>[] | undefined;
  selection: {laps?: string; hl?: string};
  cornerN: number | null;
  corners: Pick<TrackCorner, 'n' | 'official'>[] | undefined;
  tab: SessionTab | null;
  scheme: Scheme;
}): ChromeBox {
  const car = carLabel(session.car);
  const lapIds = parseSelection(selection).laps;
  const lapRows = lapIds.flatMap((lapId, i) => {
    const lap = laps?.find(l => l.id === lapId);
    return lap
      ? [
          {
            label: `L${lap.lapIndex}`,
            color: lapStroke(scheme, i, lapIds.length, false).color,
          },
        ]
      : [];
  });
  const cornerLabel =
    cornerN == null
      ? 'Corner'
      : `Corner T${turnNumber(
          cornerN,
          corners?.find(c => c.n === cornerN)?.official,
        )}`;
  return {
    badge: session.sessionType,
    track: shortTrackName(session.track),
    detail: [car.model, car.entry, formatDayMonth(session.startedAt)]
      .filter(Boolean)
      .join(' · '),
    tabs: sessionTabs(session.sessionType, cornerLabel),
    activeTab: tab,
    laps: lapRows,
  };
}
