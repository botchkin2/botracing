// What every analysed session must have (docs/SESSION_PIPELINE.md, Feature
// set). Each check names its feature; a miss is a string the gate prints and,
// later, the analysis stores on the session. `expect` says what the source
// had, so absence is judged against it: {otherCars} from the capture's car
// list, 0 for a drive with no capture.
//
// The fill limit is not checked: the capture has no car setup yet (a gap in
// SESSION_PIPELINE.md), so every recorded drive would miss it.

const wheels = ['FL', 'FR', 'RL', 'RR'];

// A lap that ran from line to line, so the game times it or invalidates it.
const whole = lap => !lap.partial && !lap.pitIn && !lap.pitOut;

export function checkSession({session, laps}, {otherCars = 0} = {}) {
  const misses = [];
  const miss = (feature, detail) => misses.push(`${feature}: ${detail}`);
  if (!session) return ['session: missing'];
  if (laps.length === 0) miss('laps', 'none');

  for (const lap of laps.filter(whole))
    if (!lap.timed && lap.invalid !== true)
      miss('lap time', `L${lap.lapNumber + 1} has neither a time nor the game's invalid flag`);

  if (!session.weather) miss('weather', 'empty');
  if (session.fuel?.startL == null) miss('fuel', 'no start level');
  if (!session.stints?.length) miss('stints', 'none');
  if (/^r/i.test(session.sessionType ?? '') && !session.race?.minutes)
    miss('race length', 'none for a race');

  // Four wheels, not one copied four times (pit wall #5324): on some lap the
  // wheels must differ.
  const tyred = laps.filter(l => l.tyres?.wearPct || l.tyres?.pressureKpa);
  if (tyred.length === 0) miss('tyres', 'no lap has tyre data');
  else {
    const distinct = tyred.some(l =>
      ['wearPct', 'pressureKpa', 'rubberC'].some(k => {
        const v = l.tyres[k];
        return v && new Set(wheels.map(w => v[w])).size > 1;
      }),
    );
    if (!distinct) miss('tyres', 'all four wheels equal on every lap');
  }

  if (otherCars > 0) {
    if (!session.field) miss('other cars', `the source had ${otherCars}, none stored`);
    else if (session.field.cars < 2)
      miss('other cars', `${session.field.cars} car(s) stored`);
    if (!session.classLaps) miss('class laps', 'none with a field');
    if (!session.classBests) miss('class bests', 'none with a field');
    if (!session.result) miss('result', 'none with a field');
    if (!session.traffic) miss('traffic', 'no session traffic with a field');
    const noTraffic = laps.filter(l => !l.partial && l.traffic == null);
    if (noTraffic.length)
      miss('traffic', `${noTraffic.length} lap(s) without traffic`);
  }
  return misses;
}
