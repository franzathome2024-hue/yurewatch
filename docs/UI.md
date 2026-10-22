# YureWatch UI (v0.2 redesign — current as of v0.4.0)

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

- **Desktop (≥ 900 px)**: map and a 372 px sidebar (420 px ≥ 1600 px, 320 px
  at 901–1200 px) side by side. The map gets 66–69 % of the work area at
  1280×800 and 1440×900; the sidebar is a fixed instrument column, not a
  third dashboard column. A chevron toggle at the end of the tab bar
  collapses it to a 44 px rail (the toggle stays in place, `aria-expanded`
  tracks it), giving the map up to ~92–94 % of the width; choosing any view
  — tab, event, info — re-expands it. At 1024×768 collapsing widens the map
  from 668 px to 944 px (measured). Below 901 px the toggle is hidden: the
  bottom-sheet handle already provides the same affordance there.
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
5. **Touch targets ≥ 34 px on desktop, ≥ 40 px on touch layouts** (map controls
   34–44 px depending on pane height; nothing below 34 px anywhere). Measured on
   the smallest target (360×800) and re-checked in `npm run qa:ui`.
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

## Milestone 1 — evidence-based refinement (v0.4.0)

Everything below was measured on the shipped `dist/yurewatch.html` with Playwright
before it was changed: six viewports (1920×1080, 1366×768, 820×1180, 390×844,
740×360, 360×800) × the ten demo states, plus computed-style dumps and rect
captures. No physical device was used; every number is headless Chromium.

### What was actually wrong

| # | Finding | Evidence (before) |
| --- | --- | --- |
| 1 | Map controls escaped a short pane and collided with the legend | 740×360: `.mapControls` ran from y=75 to y=271 inside a pane of y=126–280 — 51 px above the pane top and under the 凡例 button |
| 2 | A simulated alert showed the simulation notice three times | 1366×768 `demo=warning`: floating banner + `SIMULATION` badge + footer line; the dedupe existed only inside the ≤900 px media query |
| 3 | The list header did not sit over its own columns | header `46px 1fr 64px 56px`, row `42px 1fr auto` |
| 4 | The bottom sheet was pushed off-screen by a tall alert | 740×360 `demo=warning`: map pane bottom 459 px in a 360 px viewport; `.side`, `.sheet__handle` and `.mapControls` all clipped |
| 5 | Nine control classes under 44 px, six label classes under 11 px | `langSwitch__btn` 52×30, `hdr__btn` 34×34, `mapBtn--legend` 64×34, `sideTab` 34 px tall; `modeChip`, `badge--sim`, four `feed__head` labels at 10 px, banner meta at 10.5 px |
| 6 | The header overflowed at 360 px, clipping the info button | `scrollWidth` 375 vs `clientWidth` 360 |
| 7 | `docs/UI.md` claimed "touch targets ≥ 30 px (46 px for map controls)" while the measured map buttons were 44 px and five other controls were 30–38 px | the doc and the CSS disagreed |

Two impressions from the screenshots were **not** backed by the CSS and were
left alone: earthquake rows are already hairline-separated with no radius or
fill, and the stylesheet has no gradients and only two shadows. The "card-like
rows" reading came from the screenshot, not from the stylesheet.

### What changed

1. **Map controls fit their pane.** `.mapControls` gets `max-height`/`max-width`
   derived from the pane, and below 560 px of viewport height it lays out as a
   horizontal row of 34 px buttons along the bottom edge with the legend toggle
   in the 4 px gutter above it. The renderer reserves 168 px for that row instead
   of the 64 px column when the pane is shorter than 200 px, so the attribution
   no longer runs under the buttons.
2. **One notice per fact.** A simulated alert drops the floating map banner for
   as long as it is on screen, in `src/ui/app.ts` rather than in a media query, so
   it cannot drift from the banner again. The banner is also lighter: the bordered
   inner badge became a plain `SIMULATION` tag (one box, not two), 40 px → 25 px
   tall at desktop widths.
3. **The alert keeps the map and the sheet on screen.** On a landscape phone the
   alert slot is capped (`calc(100dvh - header - strip - 144px)`), scrolls
   internally, the banner drops to compact spacing and the sheet peek is 44 px.
   Nothing is hidden: the banner scrolls instead.
4. **List header matches the rows** (`42px 1fr auto` in both) and the magnitude
   label right-aligns with the magnitude values; the event count moved to its
   left instead of pushing `規模` off its column.
5. **Sizes that the doc already promised**: 11 px floor for interface metadata
   (map canvas labels keep their own smaller sizes), and 38–44 px targets
   (`hdr__btn` 38, `langSwitch__btn` 34, `sideTab` 38, `mapBtn--legend` 38; 40/44
   on touch layouts).
6. **Header fits 360 px.** In demo mode the connection label no longer repeats
   "DEMO" — the status strip chip and the simulation banner already say it — and
   `aria-label` keeps the full wording.

### Result

| Measure | Before | After |
| --- | --- | --- |
| Defects across 6 viewports × 10 demo states (60 combinations) | 10 | 0 |
| 740×360 EEW warning: map pane bottom / viewport | 459 px / 360 px (sheet clipped) | 308 px / 360 px |
| 740×360 EEW warning: controls inside pane, legend overlap | no / yes | yes / no |
| Simulation notices on a simulated alert (desktop) | 3 | 1 |
| Floating banner share of the map at 740×360 | 15 % | 0 % (alert states it) |
| Alert height at 740×360 (same content) | 217 px | 193 px, scrolls above 140 px |
| Control classes under 44 px / label classes under 11 px | 9 / 6 | 0 / 0 |
| Header `scrollWidth` at 360 px | 375 | 360 |
| List header tracks | `46 1fr 64 56` | `42 1fr auto` (same as rows) |

Known limits, not fixed here: at 740×360 the map is 84 px tall, so the country is
legible only as a silhouette and the user should tap 本土 or zoom; the alert
scrolls in that state. On a tall phone the archipelago frame shows a thin Ryūkyū
chain across open ocean — switching to 本土 is one tap.

Reproduce: `npm run qa:ui` prints the 60-state matrix, and
`node tools/ui-audit.mjs compare v0.3.0` builds the previous tag in a temporary
git worktree, captures both screenshot sets and writes
`docs/qa/ui-comparison.png`.

## EEW monitor window, camera framing, and audio tests (v0.5.0)

A JQuake-inspired pass, kept deliberately small: one new component, one new
pure helper, and wiring through the existing App/handlers:

- **EEW monitor window** (`src/ui/eewWindow.ts`, mounted in `src/ui/app.ts`)
  is the compact always-visible EEW readout at the map's **top-right**; the
  legend moved to the **bottom-left**, above the canvas scale bar, and opens
  upward. Both overlays keep `data-map-anchor` tags so camera framing
  reserves the corners they actually occupy. The window distinguishes
  待機中 (standby, with 監視中 / フィード遅延 / フィード接続なし / 接続中） /
  予報 / 警報 / 更新 / 取消 / 状態不明， badges 訓練/試験 and SIM bulletins,
  and shows, in priority order: earliest **source-supplied** arrival
  estimate with a live countdown (`nextArrival`, the same helper and
  phrasing as the banner), max predicted intensity, epicentre,
  magnitude/depth, serial + issue time, and the current tsunami grade.
  Anything the source did not supply renders as `---` — never 0 and never
  estimated. Raw Rt noise is never shown here; this window speaks only
  official JMA EEW values. The wide banner remains the detailed transient
  announcement; the window is not an aria-live region (it re-renders on the
  1 Hz countdown tick).
- **EEW camera framing** (`eewFocusKey` in `src/state/alert.ts`, wired in
  `src/main.ts`): the map centres **once** per distinct event — or when the
  epicentre moves ≥ ~0.1° — via `MapView.focusOn`, now a bounded ~380 ms
  ease that is instant under reduced-motion and is cancelled by any pan,
  wheel, zoom, recenter or profile switch. Test bulletins, cancellations
  and missing/fabricated coordinates never move the camera; small serial
  revisions never re-frame; manual navigation is never overridden. The
  labelled 全国 (nationwide) map control restores the default full-Japan
  framing (including the outlying islands of the active profile) at every
  viewport, and resize/rotation keep the visible centre via the existing
  `preserveVisible` path. Map QA's alert-strip scenario therefore measures
  the strip-resize refit after pressing that reset.
- **Compact forms**: below 900 px wide the window narrows (208 px, then
  188 px below 560 px); at ≤560 px tall (phone landscape) it shows only
  state, arrival, intensity and epicentre. At ≤560 px wide the demo
  SIMULATION banner keeps its tag but drops its explanatory sentence (the
  header DEMO chip carries the same marking), so banner and window never
  squeeze each other into unreadable columns. Verified by measurement at
  1440×900, 1280×800, 1024×768, 800×1280, 768×1024, 393×873, 360×800,
  915×412 and 844×390: no overlap with the legend or map controls and no
  horizontal overflow in any of them (screenshots: task evidence set).
- **Sound/voice tests** （設定 in the info panel): 音声テスト plays the
  synthesized info tone through `AlertAudio.testTone()` and reports the
  observed AudioContext state (`running` after a real click in headless
  Chromium); 読み上げテスト speaks the preview via `Speech.speak` and
  reports the engine's verdict — including the honest "no Japanese voice"
  and "confirming…" (pending) states instead of failing silently. The
  tests are explicit gestures, work while the alert preferences are off,
  and never change those preferences. What remains unverified is listed in
  `docs/AUDIO.md`: no background/locked-screen or audio-focus behaviour is
  claimed, and speech on a real device depends on its installed voices.

Sidebar collapse (≥901 px, 44 px rail) from the same release is described
with the layout above; below 901 px the bottom sheet is unchanged.

## Where the code lives

| Concern | File |
| --- | --- |
| Shell, view/sheet state, map wiring | `src/ui/app.ts` |
| EEW monitor window | `src/ui/eewWindow.ts` |
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
