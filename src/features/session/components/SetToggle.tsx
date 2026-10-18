import {Segment} from '@/src/ui';

const OPTIONS = [
  {value: 'session', label: 'Session'},
  {value: 'day', label: 'Day'},
] as const;

export type SetKind = (typeof OPTIONS)[number]['value'];

/** Session | Day: the set of laps the screen describes (data/sessions/lapSet.ts). */
export function SetToggle({
  value,
  onChange,
}: {
  value: SetKind;
  onChange: (value: SetKind) => void;
}) {
  return <Segment options={OPTIONS} value={value} onChange={onChange} />;
}
