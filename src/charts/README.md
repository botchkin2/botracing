# src/charts

The react-native-svg chart layer: Axis, Trace, Band, Cursor, Bars, DotStrip, CornerGrid, RaceLanes (the YOUR RACE lanes; the layout is `raceLanesLayout.ts`), FuelScatter (practice fuel use against lap time), SplitBar (a small to-scale bar in two neutral inks, made of plain views: the Pit stops card's VE out, pit lane and used-and-left). Pure props in, SVG out.

- **Text inside the box.** Every chart svg clips at its edges, so a chart is a `ChartSvg` and its text is a `ChartLabel` (`ChartLabel.tsx`): the label's box (`labelBox.ts`, the axis font's measured metrics) is held 1 pt inside the svg, moved only as far as it would cross an edge. `chartLabelRule.test.ts` fails on a raw `<SvgText>` outside the maps (BrakeMap, CarDots, FollowMap, TrackMap place labels on the track's own geometry). Axis ticks carry their unit (`tickFormat.ts`): `500 m`, `260 km/h`, `−50 %`, `L10`, `+0.5 s`.

- Not here: fetching, selection state, screen layout.
- Imports: `design`, `ui`, `analysis`.
