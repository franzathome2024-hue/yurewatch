# YureWatch UI (v0.2)

This document records the v0.2 interface redesign: what changed, why, and which
constraints the layout is required to satisfy. It is written for whoever touches
the UI next, not as marketing copy.

## The problem with v0.1.1

The v0.1.1 shell was a three-column dashboard (alert column, map, event column).
On a 1280 px desktop the map received roughly 45 % of the workspace; on a phone
the columns stacked and the map was pushed below a large idle alert card, so the
first screenful contained almost no map. It read like an admin console, it was
more decoration than instrument, and the phone layout was the desktop layout
squeezed.

## The v0.2 layout

```
┌───────────────────────────────────────────────────────────────┐
│ header: brand · connection · JST clock · 日本語|English · info  │  52 px (48 on phones)
├───────────────────────────────────────────────────────────────┤
│ status strip: LIVE/DEMO · source · last update · freshness    │  30 px
├───────────────────────────────────────────────────────────────┤
│ alert slot: thin strip when idle, banner only when it matters │  auto
├──────────────────────────────────────────┬────────────────────┤
│                                          │ 最近の地震│詳細│情報 │
│ map (canvas)                             │                    │
│ + legend toggle + zoom/recenter          │ list / detail /    │
│                                          │ info panel         │
└──────────────────────────────────────────┴────────────────────┘
```

- **Desktop (≥ 900 px)**: map and a 372 px sidebar (420 px ≥ 1600 px) side by
  side. The map gets 66–69 % of the work area at 1280×800 and 1440×900; the
  sidebar is a fixed instrument column, not a third dashboard column.
- **Phones (< 900 px)**: the map is the whole workspace and the sidebar becomes
  a bottom sheet with two states — *peek* (64 px summary line) and *full*
  (56 vh). Default is peek, so the map is on screen at launch.
- **Tablet portrait**: same as phone; the map benefits from the extra height.

### Hierarchy decisions

- **Idle alert = one 30 px strip.** Most of the time nothing is happening. A
  large empty "all clear" card wastes the most valuable area on the screen and
  trains people to ignore it. The strip carries the classification (`緊急地震
  速報`), the state (`受信なし`), the last check time and the freshness label, and
  keeps the full explanation in a visually-hidden line for screen readers.
- **An alert expands the strip into a banner, and only then.** The banner puts
  the classification first (`緊急地震速報（警報）`), then the estimated max
  intensity, then epicentre/magnitude/depth, then the arrival estimate with its
  "not the arrival time at your location" disclaimer, then the warning areas.
- **The map is never covered by decoration.** The simulation badge is a compact
  pill; when a simulated banner is already on screen the map badge is hidden, so
  the two do not compete for the same corner.
- **One accent colour for interaction, one for simulation.** Intensities keep the
  JMA scale colours; the interface around them does not use colour for taste.
  `--accent: #6fa9d8` means "interactive", `--sim: #b07be8` means "not real".
- **List rows are a table, not cards.** A grid of intensity / epicentre /
  magnitude / age lets the eye compare down a column. Rows are separated by a
  hairline.

### Typography and density

System font stack; no downloaded fonts (the app must work offline and as a single
file). Japanese-first metrics: 11–13 px for metadata, 13–15 px for names,
tabular numerals for magnitudes, times and counts so the columns do not jitter
as values change.

## Screen-level requirements the layout must keep

1. **Map first.** On every target viewport the map occupies > 55 % of the work
   area (measured: 66–89 %), and Japan is fully framed at launch with no panning
   required.
2. **States are distinguishable without colour.** Idle / forecast / warning /
   updated / cancelled / unavailable each have their own label, border treatment
   and wording. Cancelled and unavailable never read as "safe".
3. **No fabricated values.** Unknown intensity, depth, epicentre or timestamp
   renders `—` or `未発表`; nothing is filled with `0` or a guess. Times are
   labelled by kind (発生 / 発表 / 受信) and never conflated.
4. **Status is always visible.** Connection state (with words, not only a dot),
   data age, and whether the data is simulated all live in fixed positions.
5. **Touch targets ≥ 30 px** (46 px for the map controls, 48 dp preferred), on
   the smallest target (360×800).
6. **Both languages fit.** English strings are longer; column headers truncate
   with an ellipsis rather than pushing the layout, and the sidebar width is
   shared between both locales.
7. **Reduced motion and forced colours are honoured** (`prefers-reduced-motion`,
   `forced-colors`), and focus states are visible on every interactive element.

## What was deliberately not done

- No new intensity scale, no recolouring of the JMA scale, no invented alert
  levels. Only official classifications appear as classifications.
- No JMA/government branding, logos or imitations thereof.
- No cards added for the sake of filling space; the v0.2 pass removed more
  container chrome than it added.
- No non-functional controls: every map button zooms, recenters or opens the
  legend.
- No screenshot-as-UI: the map is a live canvas, the feed is live state.
- No marketing claims. Wording stays descriptive ("viewer", "relay", "estimate").

## Where the code lives

| Concern | File |
| --- | --- |
| Shell, view/sheet state, map wiring | `src/ui/app.ts` |
| Header (brand, connection, clock, language, info) | `src/ui/header.ts` |
| Alert strip / banner | `src/ui/alertPanel.ts` |
| Recent earthquakes list | `src/ui/eventList.ts` |
| Earthquake detail panel | `src/ui/details.ts` |
| Info panel (status, tsunami, NIED, settings, demo, about) + legend | `src/ui/sections.ts` |
| Demo scenario runner UI | `src/ui/demoPanel.ts` |
| Design tokens, layout, breakpoints | `src/styles.css` |

Verification lives in `tests/uiShell.test.ts` (structure, view switching, sheet
state, honest-freshness rules, legend, info order) and in `tools/verify-web.mjs`
(layout, framing, overflow and touch-target measurements at 360×800, 390×844,
430×932, 768×1024, 1280×800 and 1440×900, plus the cancelled/offline/stale
states). Screenshots in `docs/screenshots/` are generated from the shipped
`dist/yurewatch.html` by `node tools/screenshots.mjs`.
