# Lap Analysis: app mark and icons

The mark is "Trace" (round 3 N1a, `docs/design_handoff_round3_field/README.md`): a lap trace over a zero line with the cursor in amber. It is drawn in the app by `src/ui/AppMark.tsx` (from tokens); the SVGs here are the sources for the PNGs.

| File                                                               | Purpose                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `app-mark.svg`                                                     | Bordered rounded square: web favicon, splash.                     |
| `app-icon.svg`                                                     | Full-bleed `#15181c`, no border: `icon.png` (iOS and store icon). |
| `app-icon-foreground.svg`                                          | Android adaptive foreground (glyph only, on the background PNG).  |
| `app-icon-monochrome.svg`                                          | Android themed icon (white glyph).                                |
| `icon.png`, `favicon.png`, `splash-icon.png`, `android-icon-*.png` | Generated. Referenced in `app.json`.                              |

## Regenerate

```bash
node scripts/generate-icons.js
```

Needs `sharp` (already a dev dependency). Edit the SVGs, not the PNGs.
