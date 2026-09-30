import {StatusBanner} from './StatusBanner';

/**
 * The neutral banner for laps whose trace failed to load (round 3 R4c).
 * `othersShow`: some laps did load and are drawn below.
 */
export function TraceRetryBanner({
  failed,
  othersShow,
  onRetry,
}: {
  failed: number;
  othersShow: boolean;
  onRetry: () => void;
}) {
  const what = failed === 1 ? '1 lap’s trace' : `${failed} laps’ traces`;
  return (
    <StatusBanner
      dot='idle'
      text={`Couldn’t load ${what}.${
        othersShow ? ' The other laps still show.' : ''
      }`}
      actionLabel='Retry'
      onAction={onRetry}
    />
  );
}
