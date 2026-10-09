import {Segment} from '@/src/ui';

import {type CompareSelection, clearRef, setRef} from '../model';

type Basis = 'median' | 'ref';

/**
 * Median | Ref: what every "vs" in Compare is measured against. Ref takes the
 * highlighted lap, else the quickest checked one; a row's own "Ref" picks any.
 */
export function BasisSwitch({
  selection,
  fastestLapId,
  onSelectionChange,
}: {
  selection: CompareSelection;
  fastestLapId: string | null;
  onSelectionChange: (next: CompareSelection) => void;
}) {
  const hl = selection.hl && selection.laps.includes(selection.hl) ? selection.hl : null;
  return (
    <Segment<Basis>
      options={[
        {value: 'median', label: 'Median'},
        {value: 'ref', label: 'Ref'},
      ]}
      value={selection.ref ? 'ref' : 'median'}
      onChange={basis => {
        if (basis === 'median') return onSelectionChange(clearRef(selection));
        const lapId = hl ?? fastestLapId;
        if (lapId) onSelectionChange(setRef(selection, lapId));
      }}
    />
  );
}
