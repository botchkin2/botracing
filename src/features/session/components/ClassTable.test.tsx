import {describe, expect, it} from '@jest/globals';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {type SessionClassBests} from '@/src/data/sessions';
import {ThemeProvider} from '@/src/design/theme';

import {classTable} from '../classTable';
import {ClassTableView} from './ClassTable';

// One real shape: the 3 Oct Road Atlanta race's two classes, cut to a few cars.
const bests: SessionClassBests = {
  version: 1,
  kind: 'race',
  vehicles: ['BMW M4 LMGT3', 'Cadillac V-Series.R'],
  classes: {
    hypercar: {
      bestsS: [70.336, 70.5, 70.741],
      vehicleAt: [1, 1, -1],
      player: null,
    },
    gt3: {
      bestsS: [79.641, 79.7, 79.8, 79.85, 79.885, 80.395],
      vehicleAt: [0, 0, 0, 0, 0, 0],
      player: 5,
    },
  },
};

const texts = (r: ReactTestRenderer): string[] =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => n.children.join(''));

function mount(): ReactTestRenderer {
  let r: ReactTestRenderer | undefined;
  act(() => {
    r = create(
      <ThemeProvider>
        <ClassTableView table={classTable(bests)!} />
      </ThemeProvider>,
    );
  });
  return r!;
}

describe('ClassTableView', () => {
  it('folded: Class, Best, 5th, Cars per class, the player first, with their own best and place', () => {
    const t = texts(mount());
    expect(t).toEqual(
      expect.arrayContaining([
        'Class',
        'Best',
        '5th',
        'Cars',
        'GT3',
        '1:19.641',
        '1:19.885',
        '6',
        'Hypercar',
        '1:10.336',
        '1:10.741',
        '3',
        'You',
        '1:20.395',
        'P6 / 6',
      ]),
    );
    expect(t.indexOf('GT3')).toBeLessThan(t.indexOf('Hypercar'));
    // Nothing unfolded: no per-car rank column yet.
    expect(t).not.toContain('+0.059');
  });

  it('a tap unfolds a class to every car with its gap to the class best, and a second tap folds it', () => {
    const r = mount();
    const row = r.root.findByProps({
      accessibilityLabel: 'GT3 cars by best lap',
    });
    act(() => row.props.onPress());
    const open = texts(r);
    expect(open).toContain('+0.059');
    expect(open).toContain('+0.754');
    expect(open.filter(s => s === 'BMW M4').length).toBe(6);
    act(() => row.props.onPress());
    expect(texts(r)).not.toContain('+0.754');
  });
});
