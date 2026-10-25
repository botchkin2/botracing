import {describe, expect, it} from '@jest/globals';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {ThemeProvider} from '@/src/design/theme';

import {finishedText, raceResultText} from '@/src/analysis/raceResult';

import {type Fact} from '../model';
import {SessionHead} from './SessionHead';

const texts = (r: ReactTestRenderer): string[] =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => n.children.join(''));

function mount(facts: Fact[]): ReactTestRenderer {
  let r: ReactTestRenderer | undefined;
  act(() => {
    r = create(
      <ThemeProvider>
        <SessionHead facts={facts} />
      </ThemeProvider>,
    );
  });
  return r!;
}

const facts: Fact[] = [
  {label: 'Laps', value: '31'},
  {label: 'Comparable', value: '25'},
  {label: 'Best', value: '2:02.700', best: true, basis: 'session'},
  {label: 'Median', value: '2:03.487', basis: 'of 25'},
  {label: 'Spread', value: '0.63 s'},
  {label: 'Class median', value: '2:05.325', basis: 'you −1.664 · 9 cars'},
];

describe('SessionHead', () => {
  it("the rest line keeps a fact's basis, so the class median reads with his gap at 375", () => {
    const t = texts(mount(facts));
    expect(t).toContain(
      '31 laps · 25 comparable · Class median 2:05.325 · you −1.664 · 9 cars',
    );
  });

  it('a fact with no basis prints as before, and the hero facts keep their labels', () => {
    const t = texts(
      mount([
        {label: 'Laps', value: '3'},
        {label: 'Best', value: '1:00.000', best: true, basis: 'session'},
        {label: 'Median', value: '1:01.000', basis: 'of 3'},
        {label: 'Other cars', value: 'none recorded'},
      ]),
    );
    expect(t).toContain('3 laps · Other cars none recorded');
    expect(t).toContain('Best · session');
    expect(t).toContain('Median · of 3');
  });

  it('prints the same "Finished …" line as the Race tab header (one string from raceResult.ts)', () => {
    const finish = {
      overall: 5,
      inClass: 1,
      ofOverall: 23,
      ofClass: 13,
      lapsDone: 30,
      leaderLapsDone: 33,
      classLeaderLapsDone: 30,
      leftEarly: false,
    };
    const t = texts(
      mount([
        {label: 'Best', value: '2:02.700', basis: 'session'},
        {label: 'Median', value: '2:03.487', basis: 'of 25'},
        {label: 'Result', value: raceResultText(finish)!},
      ]),
    );
    expect(t).toContain(finishedText(finish));
  });
});
