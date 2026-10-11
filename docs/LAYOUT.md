# Layout rules per screen

Theme F: one rule per screen, checked at 375, 1024, 1440 and 1920 wide. Breakpoints are `size.desktopBreakpoint` (900) and `size.wideBreakpoint` (1280) through `useLayout()`; a phone on its side keeps the phone layout (`layoutMetrics.ts`). The phone is primary (`CODE_STANDARDS.md` section 0).

The checks, at every width: no side scroll on the page; nothing past the right edge outside a component's own horizontal scroller; every scroller's last row can be reached (its bottom is inside the window); charts take their column's width; on the phone every control is 44 pt or more (hit slop counts).

| Screen           | 375                                      | 900 to 1279                                                                                 | 1280 and up                                     |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Sessions         | one list, rows 54                        | table, full width                                                                           | table, full width                               |
| Session          | laps, chart, tires in one scrolling page | rail, centre column; the page scrolls                                                       | three columns, each scrolls on its own          |
| Compare          | charts first, controls pinned under      | side column and charts, each scrolls                                                        | three-pane workspace                            |
| Corner           | charts first, chips pinned               | one scrolling page, charts the full width                                                   | table and shape left, charts right              |
| Race             | map, board, lanes as one page            | map, lanes and controls, board below; the column scrolls as a page when the window is short | map left, board right (draggable)               |
| Plan             | one column                               | one column                                                                                  | stops and class pace side by side, capped width |
| Track            | one column                               | map and facts side by side                                                                  | map and facts side by side, capped width        |
| Settings, Tracks | one column                               | one column, capped width                                                                    | one column, capped width                        |

Measure with `tools/dev/layoutProbe.js` on a live slot (`docs/TESTING.md`): store it in `window.name`, navigate to each route at each width, run `eval(window.name)`. A scroller whose `bottom` is past the window's height is the #481 bug (its last rows are under the fold).

Chart text: `tools/dev/chartLabelProbe.js`, the same way. It lists every svg's labels and any label box that crosses its svg's edge (`outside`, should be empty), plus text views laid over a clipped chart wrapper (`overlays`). The rule it checks is `src/charts/README.md` (inside the box).
