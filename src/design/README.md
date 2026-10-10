# src/design

Tokens and theme from `docs/design_handoff_lap_analysis/README.md`: colors (dark default, light), lap palette and modes, type, space, radius, sizes, fonts, number formats, `useTheme()`, `useLayout()`.

- Not here: components.
- Imports: `analysis` only.
- `useLayout()` decides desktop and wide by window width, except a phone on its side (wider than tall and under `size.landscapePhoneMaxHeight`): that keeps the phone layouts (`isLandscapePhone`), with the width the turn gives. The rule is `layoutMetrics.ts`.
