# Map framing & clipping QA

`tools/map-qa.mjs` loads the **built** single-file app in Chromium, drives it through
eight viewport classes, reads the live camera out of the running app, re-projects the
shipped geometry with the same maths, and then checks the prediction against the
pixels the renderer actually produced. It exits non-zero on failure, so it can gate CI.

```bash
npm run build
node tools/map-qa.mjs --label after      # writes docs/qa/after.md + screenshots
npm run qa:map                           # same, default label
```

## What it measures per viewport

| Measurement | Source | Why |
| --- | --- | --- |
| map host + canvas box | `getBoundingClientRect` | the space actually available |
| camera centre and scale | `window.__yurewatch.map()` | what the framing decided |
| declared profile + ring list | `debugState().coverage` | what the app *claims* to show |
| projected coverage box | geometry re-projected in Node | where the country landed |
| land/ocean pixel probes | `getImageData` on the canvas | whether the pixels agree |
| label boxes | `debugState().labels` | so ocean probes don't count text |

## Checks

1. **Intended coverage fully on canvas** — every ring the active profile declares is
   inside the canvas. This is the clipping test.
2. **No feature half-cut at an edge.**
3. **Map fills the space left for it** — coverage ÷ the inset box, ≥97% on the
   dominant axis. Measured against the *inset* box, not the raw canvas, because the
   chrome (controls, scale bar) sits on top of the map.
4. **Map is centred in its inset box** — offsets are deliberately asymmetric.
5. **Canvas is not stretched** — backing-store aspect vs CSS aspect, ≤0.5% drift.
6. **Backing store matches the CSS box** — catches DPR rounding errors.
7. **Renderer painted land** and **land covers a plausible share (3–60%)**.
8. **Predicted land is actually painted** — area centroids of visible rings, ≥95%.
   Rings narrower than 6 px are counted and skipped: 1:10m carries dozens of 4–8
   point islets that no zoom can make testable.
9. **Open ocean stays water** — reference water points (Pacific, Sea of Japan, East
   China Sea) with at most one sample allowed to be covered by a marker or callout.
10. **No overlay covers the map centre.**

## Viewport matrix

| Case | Size | DPR |
| --- | --- | --- |
| Desktop landscape | 1920×1080 | 1 |
| Laptop landscape | 1366×768 | 1 |
| Tablet landscape | 1024×768 | 1 |
| Tablet portrait | 820×1180 | 1 |
| Narrow Android portrait | 360×740 | 2 |
| Android landscape | 740×360 | 2 |
| Resize after launch | 1440×900 → 900×1200 | 1 |
| Alert strip changes height | 1366×768, `?demo=warning` | 1 |
| Sakishima island probe (probe-only) | 1024×768, five islands | 1 |

Screenshots for every case: `docs/qa/before/` (pre-fix commit `c5d51f9`) and
`docs/qa/after/` (the v0.3.0 run these tables report). The **current** release's
run, including the five Sakishima probe images, is `docs/qa/v040/` with its report
in `docs/qa/v040.md`; `docs/qa/comparison.png` is a hand-assembled v0.2 → v0.3.0
contact sheet — a historical record of the framing regression, not the current UI.

## Result

| Run | Build | Checks |
| --- | --- | --- |
| before | `c5d51f9` + camera diagnostics only | **71/88** |
| after (v0.3.0) | inlined single file | **88/88** |
| after (v0.4.0, basemap fix) | this release | **93/93** |
| after (v0.4.0, framing & overlay audit) | this release | **109/109** |

The before-run uses the identical harness. The only change made to the old build was
adding `cx`/`cy` to `debugState()`, because the old version exposed no way to recover
the camera.

## Root causes found, all reproduced

**1. Coverage was declared by a hand-written lat/lon box that excluded shipped
islands** (`src/map/geo.ts`, `PRIMARY_VIEW_BOUNDS`). The box stopped at 26.0 °N while
the dataset carries Ogasawara and the Izu volcanoes down to 24.2 °N. Those rings were
fitted *outside* the frame and fell off the bottom edge.

- Desktop 1920×1080: coverage ran to `B −54 px`; 3 rings entirely off-canvas.
- Tablet portrait: `B −57 px`. Resize case: `B −59 px`. Alert-strip case: `B −17 px`.
- Not a canvas, CSS or projection fault: aspect drift was 0.0% and the pixel probe
  confirmed the renderer agreed with the camera.

**2. Fixed pixel padding on short panes.** `fitBounds(..., 18)` spent 36 of a 154 px
Android-landscape height on padding — 23% — leaving the map at 82% of the strip.

**3. Vertical centring drifted** by 41–44 px wherever (1) applied, because the extra
southern rings pushed the measured coverage box off-centre while the camera stayed
centred on the box that excluded them.

**4. Context land was truncated at a clip box inside the view** (`127.5 °E`). China
ended in a straight vertical line partway across the map. Fixed in the generator by
clipping neighbours at `114–162 °E / 16–56 °N`, beyond the pan limits.

**5. Labels were drawn left-aligned but collision-tested as if centred**, so adjacent
prefecture names overlapped (`秋田県`/`岩手県` at fit) and names printed across
epicentre markers. Found by looking at the screenshots, not by the harness.

## What was *not* the cause

Checked and cleared: canvas sizing and DPR rounding (backing store matched CSS in all
eight cases), CSS overflow (`overflow: hidden` on `.mapPane` clips only outside the
canvas), projection (round-trip error < 1e-12, see `tests/framing.test.ts`), and
polygon winding (`fill(path, 'evenodd')` already handled holes).

## Limitations

- Browser and emulated-viewport only. No physical Android device is available in the
  build environment (no `/dev/kvm`), so GPU compositing, real touch gestures and
  vendor WebView differences are untested.
- The ocean probe tolerates one covered sample; it cannot distinguish "ocean drawn as
  land" from "ocean obscured" at the single-pixel level.
- Sub-pixel islets are counted, not asserted.

## v0.4.0 — the southern Ryūkyū probe

Milestone 2 asked whether Miyakojima, Ishigakijima, Iriomote and Yonaguni are drawn.
They were not, and the reason turned out to be two independent faults. The harness now
has a probe case (`sakishima-rendering`, `probeOnly: true`) that recentres the map,
zooms to the island, focuses on it, reads the resulting camera, screenshots it and
samples the canvas luminance at the island's centroid.

| Island | lon / lat probed | v0.3.0 | now |
| --- | --- | --- | --- |
| Miyakojima | 125.30 / 24.79 | PASS | PASS |
| Ishigakijima | 124.16 / 24.34 | **FAIL** — probe at x = −402 | PASS |
| Iriomote | 123.80 / 24.34 | **FAIL** — probe at x = −1,540 | PASS |
| Yonaguni | 123.00 / 24.46 | **FAIL** — probe at x = −2,670 | PASS |
| Hateruma | 123.78 / 24.06 | **FAIL** — probe at x = −1,620 | PASS |

**Fault 1, data:** the generator clipped at 127.5 °E (§DATA_SOURCES 2a). Fixed by
widening `BOUNDS` and gap-filling 16 islands from N03.

**Fault 2, camera:** even with the geometry shipped, `clampCamera()` clamped panning to
the hard-coded `JAPAN_BOUNDS` whose west edge is 129.3 °E. At the zoom needed to look
at a 20 km island the camera stopped at **128.68 °E** — 4.5° short — so the geometry was
painted but unreachable. The clamp now takes the *shipped geometry* extent
(`boundsOfGeometry()` in `src/map/view.ts`) with `JAPAN_BOUNDS` as the fallback, and
`tests/framing.test.ts` keeps a regression test that a Sakishima camera survives
`clampCamera`.

Neither fault was detectable from the old checks, which is why the probe case exists:
"land pixels exist in the frame" was true both times. What changed the verdict was
asking the running app to *navigate* to a named place and then confirming it appeared.

## Known limitations of this run

- The Sakishima probe asserts "land is painted at the island's centroid"; it does not
  measure coastline accuracy against a survey source.
- The five probe screenshots (`docs/qa/<label>/sakishima-rendering-*.png`) are single
  island close-ups, not product views, and are not part of the published screenshot set.
- Everything here is Chromium with emulated viewports. No physical device was used.

## v0.4.0 — framing, overlays and legibility audit

Three new checks were added and two existing ones were rewritten, because two of
them were measuring the wrong thing.

| Check | What it measures | Why it exists |
| --- | --- | --- |
| on-map overlays do not hide sampled land | every overlay rect (banner, legend, controls) against sampled ring centroids | the simulation banner was covering southern Sakhalin and the Kurils at the default framing |
| land and ocean are measurably distinct | mean luma of land samples vs open-ocean samples, Δ ≥ 10 | "the basemap should make land obvious" is testable |
| never reserve more than half the pane (unit test) | static insets vs viewport | the old 18 px fixed padding cost 23 % of a 154 px strip |

Rewritten:

- **Land probe threshold.** It was a fixed `luma > 35`, tuned on undimmed land
  (≈ 40–50). The renderer dims prefectures an event does not touch, which puts
  them at ≈ 21 — below the threshold — so three correctly drawn prefectures were
  reported as unpainted. The probe now uses each frame's own ocean median as the
  reference (`land ≥ ocean + 6`).
- **Ocean probe points.** `129 °E 25 °N` was "open water" only until the southern
  Ryūkyūs arrived; it is a few kilometres off Yonaguni now. Candidates are kept
  only if they are outside every ring and more than 0.25° from the nearest, and
  samples that land in the reserved chrome band or under an overlay are excluded
  rather than counted as failures.

### Defects found and fixed

| # | Defect | Measurement before | After |
| --- | --- | --- | --- |
| 1 | Simulation banner drawn over geography | 430 × 110 px banner over the Sea of Japan / Sakhalin; **3 land samples** under it on 360 × 740 | 0 land samples under any overlay in all 9 cases |
| 2 | Framing ignored on-map chrome | insets were a static guess (top ~10 px on a 154 px pane) | measured from the DOM, capped per side, floor 20 px for the attribution line |
| 3 | Attribution line printed over the 沖縄県 label | overlapped on 740 × 360 | labels are excluded from the reserved chrome band |
| 4 | `全国` wrapped to one character per line | frame button 34 × 34 with 2 glyphs | `white-space: nowrap`, 40 px min-width |
| 5 | Renderer's zoom ratio disagreed with the camera | styling used a fit from a box 1.33–1.38× smaller than the profile actually framed, so the default view was drawn as if zoomed out | `zoomRatio` = camera ÷ active profile fit |
| 6 | Dead clamp code | `Math.max(Math.max(loX, nw.x), Math.min(Math.min(hiX, se.x), cam.cx))` — the second `max` always won | removed; the centre is clamped once |
| 7 | Hand-written `PRIMARY_VIEW_BOUNDS` still exported | unused, and 22° too narrow to contain the shipped data | removed |

### Label coverage

| Viewport | Labels drawn (measured from `debugState().labels`) |
| --- | --- |
| 1440 x 900 (mainland profile) | 17 |
| 1024 x 768 (archipelago profile) | 11 |
| 360 x 740 (archipelago profile) | 9 |

The 360 x 740 case drew **one** label before this pass: every prefecture on a
360 px-wide archipelago view is 14–20 px across, and the gate required 34 x 16 px,
so the whole map was unlabelled. Below 1.8x the profile fit the renderer now draws
**region names** (北海道 / 東北 / 関東 / 中部 / 近畿 / 中国 / 四国 / 九州 / 沖縄) at
their member prefectures' area-weighted centroid, and only when the prefecture tier
placed fewer than 12 names — on a desktop frame the prefecture names already carry
the map and adding 東北/関東 on top of them was pure clutter.

### Not a defect (measured, then left alone)

- Canvas sizing and DPR: backing store matched the CSS box at 1×, 2× and 3×; aspect
  drift 0.0 %.
- Projection: `project`/`unproject` round-trip error < 1e-9 for all ten test islands.
- Collision handling: no two prefecture labels overlapped in any of the nine cases.
- Ocean/land contrast: measured Δ luma ≈ 27 at 360 × 740, well above the 10 threshold.

### Known limitations of this audit

- The banner still overlaps open water on short panes: its reservation is capped at
  34 % of the pane, and a four-line banner on a 154 px strip is ~40 % of it. The
  alternative — reserving the whole banner — left a 40 px map.
- Land sampling uses ring centroids. Prefectures narrower than 6 px on screen are
  counted as sub-pixel and skipped rather than asserted on.
- Chromium with emulated viewports only. No physical device was available.
