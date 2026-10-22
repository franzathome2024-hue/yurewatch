# Changelog

## v0.5.0 — 2026-10-22

### Added

- **EEW monitor window** (JQuake-inspired): a compact, always-visible EEW
  readout anchored to the map's top-right (the legend moved to the
  bottom-left). It distinguishes STANDBY / FORECAST / WARNING / REVISED /
  CANCELLED, badges test and simulated bulletins, and shows — in priority
  order — the earliest source-supplied arrival estimate with a live
  countdown, max predicted intensity, epicentre, magnitude/depth, revision
  serial and the current tsunami bulletin grade. Values the source did not
  supply render as `---`; nothing is estimated or invented. Feed
  offline/stale states are labelled on the standby window.
- **EEW camera framing**: a qualifying EEW (new event or a meaningful
  epicentre move; never a test bulletin, cancellation, or missing
  coordinates) centres the map once with a bounded ease that honours
  reduced-motion. Serial revisions do not re-frame, manual pan/zoom is
  never overridden, and the labelled nationwide reset restores the full
  Japan view at every size.
- **Explicit sound/voice tests** in 設定 (Settings): dedicated
  音声テスト / Test sound and 読み上げテスト / Test voice buttons beside
  the existing toggles. The sound test reports the observed AudioContext
  state (e.g. `running` after the gesture); the voice test reports the
  speech engine's verdict (including "no Japanese voice") instead of
  failing silently. Synthesized tones only; preferences remain independent
  and take effect immediately.
- **Collapsible sidebar** (desktop/tablet landscape): the sidebar collapses
  to a 44 px rail, returning the width to the map; choosing a tab reopens
  it. Small screens keep the bottom-sheet behaviour.

### Changed

- Map QA's alert-strip scenario now measures the strip-resize refit from
  the nationwide view restored by the reset button, because a qualifying
  warning legitimately centres the epicentre first (EEW framing above).
- **Public website** (Milestone 4): landing page and the browser viewer at
  <https://franzathome2024-hue.github.io/yurewatch/viewer/>, deployed by
  `.github/workflows/pages.yml` from the same single-file build as the APK.
  See `docs/WEBSITE.md`.
- **Installable PWA** (Milestone 5): the web viewer can be installed; its
  service worker caches only the application shell for offline startup and
  never intercepts or caches feed data. See `docs/PWA.md`.
- **Release hardening** (Milestone 6): tagged releases must be signed with
  the project release key (build fails otherwise), `SHA256SUMS` uses bare
  filenames and is verified in CI, map QA runs as a blocking CI job, and a
  package.json ↔ AndroidManifest version-drift check gates CI.
  See `docs/RELEASING.md`.
- **Saved recent-event history** (reliability audit): a cold start with no
  network now shows the previous session's recent earthquakes, labelled
  保存済みの履歴 / "Saved history" with the snapshot time. Only earthquake
  records are stored (bounded, on-device) — EEW and tsunami state is never
  persisted, so no warning can be revived from storage.

### Fixed

- **Undated bulletins could look brand-new.** The recency gate anchored
  EEW/tsunami telegrams with a missing issue time to the local receive
  time ("now"), so a days-old warning held by the relay could pass as
  fresh. Telegrams are now dated only from source fields (issue time,
  then earthquake origin time); a telegram that cannot be dated is
  treated as historical, never as an active warning.
- **A test bulletin could displace a real warning.** A 訓練/試験 telegram
  for a different event no longer replaces a live warning on screen.
  Test bulletins remain visible (badged TEST) when no genuine alert is
  active, and still never trigger sound or speech.

### Known limitations

- Polling, not push: warnings can arrive seconds after publication; no
  background EEW delivery in either the APK or the PWA, and no notification
  guarantee is made anywhere.
- EEW shown is 緊急地震速報（警報）via a third-party relay (P2P地震情報)
  with no availability warranty; tsunami content is 津波予報 (forecasts),
  not observed heights.
- Full list: README “Limitations” and `docs/PWA.md` (browser-specific).

### Migration

- **Android:** releases up to v0.4.0 were signed with an ephemeral CI key.
  The first release signed with the project release key cannot be installed
  over those builds — uninstall the old app once, then install. Your only
  stored setting is the language preference; nothing else is lost.
- **Web / PWA:** none. The site deploys in place; the service worker picks
  up new deployments automatically and evicts stale caches.

## v0.4.0 — 2026-10-22 (published: tag `v0.4.0`, APK 226,233 B, SHA-256 `6a334093c7…2afac3`)

One release containing Milestones 1–3 below.

### Milestone 2 — geographic data audit

- **The southern Ryūkyūs were missing because of our clip box, not because of
  Natural Earth.** `BOUNDS` in `scripts/build_map_data.py` started at 127.5 °E,
  which is east of Miyakojima (125.3), Ishigakijima (124.2), Iriomote (123.8) and
  Yonaguni (123.0). All four are present in the upstream `ne_10m_admin_1_states_provinces`
  file. The box now covers 122.5–148.0 °E / 23.5–46.5 °N; the previous release
  note blaming the dataset was wrong and has been corrected in `docs/DATA_SOURCES.md`.
- **16 islands that Natural Earth genuinely lacks** (≥ 5 km²: Tarama 20.1 km²,
  Hateruma 12.9, Kuroshima 10.1, the Kerama group, Kumejima's satellites, six in
  Kagoshima) are filled from 国土数値情報 N03-2025 (data date 2025-01-01,
  公共データ利用規約 1.0). 327 vertices. Attribution added to the map line, the
  About panel and `meta.sources`. The full national N03 swap was measured and
  rejected — see §2c of `docs/DATA_SOURCES.md`.
- **Amami Ōshima, Kakeroma, Tokunoshima, Kikaijima, Okinoerabu and Yoron are
  Kagoshima, not Okinawa.** Natural Earth attributes all six to JP-47; N03
  re-assigns them. `tests/islandCoverage.test.ts` fails if that regresses.
- **The Sakishima islands were drawn but unreachable.** `clampCamera()` clamped
  panning to a hard-coded mainland box, so the camera stopped at 128.68 °E — 4.5°
  short of Ishigakijima. The clamp now uses the shipped geometry's extent.
- Generator fixes: open rings (the repeated closing vertex is gone), 3-decimal
  snapping with `set_precision` for N03 rings (independent rounding had produced
  two bow-ties and dropped two islands), superseded Natural Earth islets removed
  when an N03 island replaces them, and `meta.note`/`meta.coverage` record exactly
  what was added.
- Data: 347 rings / 17,960 vertices / 302 KiB (was 162 rings / 11,351 / 189 KiB).

### Milestone 3 — framing, projection, overlays and labels

- **Coverage is a contract, not a constant.** `src/map/framing.ts` defines
  `mainland` and `archipelago` as rules over the shipped rings and measures the
  camera rectangle from the rings each rule selects, so a profile cannot promise
  what it does not frame.
- **On-map overlays reserve their own space.** Elements with `data-map-anchor`
  (simulation banner, legend, control column) are measured and passed to the
  camera as insets, capped per side. The banner used to sit across Sakhalin and
  the Kurils at the default framing.
- **`全国` no longer breaks into one character per line** on a 34 px button.
- **Labels are excluded from the reserved chrome band**, so attribution text no
  longer prints across the 沖縄県 label on a landscape phone.
- **Region-level labels below 1.8× the profile fit.** A 360 px phone drew one
  prefecture name; it now draws 9 labels (regions + the prefectures that fit).
- **Renderer zoom ratio now matches the camera** (it was computed from a box
  1.33–1.38× smaller than the profile, so the default view was styled as if zoomed
  out).
- Removed: the dead double clamp in `clampCamera()` and the unused
  `PRIMARY_VIEW_BOUNDS`.
- QA: `tools/map-qa.mjs` gained an overlay-vs-land check and a land/ocean contrast
  check; two existing probes were rewritten because they were measuring the wrong
  thing (fixed luma threshold vs dimmed prefectures; hard-coded "ocean" points that
  the new islands invalidated). **109/109 across 9 viewports**; 281 unit tests.

### Milestone 1 — evidence-based interface refinement

Every change below was measured
on the shipped build first (Playwright, 6 viewports × 10 demo states = 60 layout
states); the audit and the before/after table live in `docs/UI.md`.

### Fixed

- **Map controls no longer escape a short pane.** `.mapControls` is bounded by the
  pane it belongs to, and below 560 px of viewport height it becomes a horizontal
  row along the bottom edge. At 740×360 the column used to start 51 px above the
  map and run under the 凡例 button.
- **An alert can no longer push the bottom sheet off-screen.** On a landscape
  phone the alert slot is capped and scrolls internally, the banner compacts
  (217 → 193 px of content) and the sheet keeps a 44 px peek. Before: the map pane
  ended 99 px below the fold and the only way into the event list was clipped.
- **A simulated alert states SIMULATION once.** The floating map banner is dropped
  while the alert banner (badge + footer line) is on screen, decided in
  `src/ui/app.ts` instead of inside a media query.
- **The list header sits over its own columns**: `42px 1fr auto`, the same tracks
  as the rows, with magnitude right-aligned over the magnitudes.
- **The header fits a 360 px phone** (info button was clipped by 15 px). In demo
  mode the connection label no longer repeats "DEMO"; the status strip already
  says it, and `aria-label` keeps the full wording.
- **Metadata is ≥ 11 px and controls are ≥ 34 px** (40–44 px on touch layouts);
  six label classes were 10–10.5 px and nine controls were 30–38 px.
- The map attribution is reserved against the control row instead of a fixed
  64 px, so it no longer runs underneath the buttons on a short pane.

### Tooling

- `tools/ui-audit.mjs` (`npm run qa:ui`): 60-state layout matrix, screenshot
  capture and a `compare <ref>` mode that builds the previous tag in a git
  worktree for the before/after sheet.

## v0.3.0 — 2026-10-22

Map-correctness release: framing is now derived from the geometry it promises
instead of a hand-written box, and the map's visual hierarchy was fixed against
the reference application. Nothing decorative was added.

### Fixed — geographic framing and clipping

- **Islands were being cropped off the bottom of the map.** `PRIMARY_VIEW_BOUNDS`
  stopped at 26.0 °N while the shipped data runs to 24.2 °N (Ogasawara and the Izu
  volcanoes), so those rings were fitted outside the frame: coverage ran 54 px past
  the canvas edge on desktop, 57 px on tablet portrait, 59 px after a resize. Framing
  is now computed from the rings each profile includes (`src/map/framing.ts`), so what
  a profile claims is what the camera frames, by construction.
- **Two explicit framing profiles**, both user-selectable from a new map control and
  reflected in `debugState()`: `mainland` (Hokkaidō/Honshū/Shikoku/Kyūshū, everything
  from 30 °N) and `archipelago` (adds the Nansei chain and Ogasawara). Landscape panes
  open with `mainland`, portrait panes with `archipelago`. `?frame=…` pins either.
- **Fixed pixel padding on short panes**: 36 of 154 px of Android-landscape height went
  to padding. Insets are now derived from the viewport with a floor and ceiling.
- **Camera clamping** no longer lets the country leave the canvas; a hard pan put the
  viewport edge 1.5° east of Hokkaidō with nothing on screen. The clamp keeps at least
  a third of Japan visible and still permits inspecting the edges.
- **Neighbouring countries are no longer truncated inside the view.** Context land is
  clipped at 114–162 °E / 16–56 °N instead of 127.5–148 °E, which removes the straight
  vertical edge that used to cut China partway across the map, and brings Taiwan, the
  Philippines, Mongolia and the Northern Marianas into the backdrop.
- `meta.geometryBounds` now reports the **measured** extent, separately from the clip
  box, so the metadata stops advertising 148 °E as a coordinate the data reaches.

### Changed — map readability

- **Prefecture names are on the map at the default zoom.** Previously nothing was
  labelled until 1.7× fit, leaving an unlabelled outline. Labels are placed by
  priority, culled against other labels *and* marker footprints, and increase with zoom.
- Label anchors are now centred in both the renderer and the collision test; the two
  disagreed, so adjacent names overlapped and text printed across epicentre markers.
- Flat ocean: the vertical gradient plus radial "lift" behind Japan was decoration that
  tinted the sea unevenly and made land/water contrast depend on where you looked.
- Slightly stronger context-land stroke so a neighbour coast does not dissolve at fit.

### Added — verification

- `tools/map-qa.mjs` + `npm run qa:map`: loads the built app in Chromium across eight
  viewport classes (desktop, laptop, tablet landscape/portrait, narrow Android
  portrait/landscape, post-launch resize, alert-strip height change), reads the live
  camera, re-projects the shipped geometry, and checks it against the rendered pixels.
  88 checks, screenshots in `docs/qa/`. **71/88 before this release, 88/88 after.**
- `tests/framing.test.ts` (21 tests): profile membership, detached-islet rule,
  projection round trip, and "the declared rect is inside the canvas" at five viewports.
- `docs/MAP_QA.md` with the viewport matrix, checks and reproduced root causes.

## v0.2.1 — 2026-10-22

Data and honesty release: a real tsunami forecast-region layer, spoken alerts with
a tested policy, and a coastline/data audit that records what the geometry can and
cannot do.

### Added

- **Tsunami forecast-region map layer** (`src/map/tsunamiData.ts`,
  `scripts/build_tsunami_areas.py`, `src/data/tsunami-areas.json`). Built from
  JMA's own 予報区等GISデータ「津波予報区」 (dataset date 2024-05-14, JGD2011) under
  the 公共データ利用規約 第1.0版, with the required modification notice. 70 source
  features → 66 bundled regions (4 features JMA marks 帰属未定 are excluded), 8.9 M
  source vertices → 12,542. Only regions named by the *currently received* bulletin
  are painted, each in its own grade colour; unmatched names are counted and shown,
  cancelled bulletins paint nothing, and nothing is ever inferred from an
  earthquake's location.
- **Tsunami state chip** in the status strip while a bulletin is in force.
- **Spoken alerts** (`src/ui/speech.ts`, `src/core/announce.ts`): platform TTS in
  the active UI language, one announcement per revision, cancellations announced
  with explicit "not an all-clear" wording, test and (by default) simulated alerts
  never spoken, missing fields omitted rather than guessed. Unavailable voices
  produce a localised reason instead of a dead toggle.
- **Tsunami demo scenario** (`?demo=tsunami`) — warning + advisory + non-effective
  areas, clearly marked SIMULATION.
- `docs/AUDIO.md`; the data-source section of `docs/DATA_SOURCES.md` now covers
  every geographic dataset evaluated, including the ones deliberately not used.

### Changed

- **Coastline detail roughly doubled**: Douglas-Peucker tolerance 0.006° → 0.0015°
  for Japan, island floor 1e-5 → 1e-6 deg², and lakes/enclosed bays are now kept as
  interior rings (5,286 → 10,034 vertices, 134 → 136 rings, file 104 → 189 KiB).
- Land and prefecture fills use the **even-odd** rule so lake holes punch through
  instead of being painted as land (Lake Biwa, Lake Saroma, calderas).
- Legend explains the tsunami-region layer separately from the intensity scale and
  states that it is not an inundation-hazard map.
- Settings gained the tsunami-layer toggle and the spoken-alert toggle.
- Version `0.2.1` (versionCode 4).

### Fixed

- A prefecture's islands and holes are compiled into one path per shape, so a hole
  can no longer be drawn as an independent filled island.
- Speech never overlaps: the in-flight utterance is cancelled before the next one.

### Notes / not delivered

- Higher-detail coastline (国土数値情報 C23 海岸線, PDL 1.0) was verified as usable
  but is **not** bundled: it sits ~1 km (median) away from the Natural Earth fills,
  so overlaying it would show two shorelines. Evidence and the path forward are in
  `docs/DATA_SOURCES.md` §2c.
- The APK is still built, signed and verified but **not launched on a device or
  emulator** in this environment (no `/dev/kvm`); audio and speech are therefore
  unverified on hardware.

## v0.2.0 — 2026-10-22

Complete interface rebuild. No change to the data pipeline, the parsers, the EEW
state machine or the Android bridge: this release is about the screen — what is
on it, in which order, and at what size.

### Added

- **Map-first shell** (`src/ui/app.ts`): header, status strip, alert slot, work
  area. The map takes 66–89 % of the working area at every target viewport
  (desktop map share in v0.1.1 was ~45 %).
- **Phone layout built for phones**: below 900 px the map is the workspace and
  the panels live in a two-state bottom sheet (64 px peek / 56 vh), starting at
  peek. Selecting an event opens the sheet in the detail view.
- **Map legend** (`createLegend()`): collapsed button on the map; explains marker
  shapes and the nine intensity steps by name as well as colour, and says plainly
  that no intensity-distribution map is provided.
- **`docs/UI.md`**: the redesign rationale, the rules the layout is held to, and
  where each piece lives.
- **Honest freshness rule** (`effectiveFreshness()`): a transport that reports
  "updates stopped" or "offline" can no longer produce an "up to date" label just
  because the last packet was recent.
- 19 new shell tests (`tests/uiShell.test.ts`) and 37 new browser checks —
  layout, framing, overflow and touch-target measurements at 360×800, 390×844,
  430×932, 768×1024, 1280×800 and 1440×900, plus cancelled/offline/stale states.
- QA hooks: `window.__yurewatch.map()` exposes camera diagnostics for the
  harness (no user data).

### Changed

- **Alert area**: a 30 px strip (`緊急地震速報 受信なし`) while nothing is in effect;
  the full banner (classification → estimated intensity → epicentre/magnitude/
  depth → arrival estimate → warning areas) appears only for a real state. The
  idle explanation is still available to screen readers.
- **Recent earthquakes** is a grid-aligned table — intensity, epicentre,
  magnitude, age — instead of a stack of cards; column headers re-localise on a
  language switch.
- **Detail panel**: identity block with the intensity scale, then labelled rows
  (magnitude, depth, epicentre, issued, received, report type), then a tsunami
  statement, then per-station observations with bars.
- **Info panel order** is now operational status → tsunami → NIED (not
  connected) → settings → developer demo → about, with the demo scenarios in an
  explicitly separated developer group.
- **Map framing** fits the main islands plus Okinawa from a named
  `PRIMARY_VIEW_BOUNDS`; the dataset's detached islets are reachable by panning
  and still covered by the zoom limits.
- **Map theme** is neutral: land reads as a surface, ocean as space, and only
  seismic information carries saturation. No intensity colour was changed.
- On phones with a live alert, the map's SIMULATION badge is dropped because the
  banner already states it — two badges were covering the map.
- Version bumped to `0.2.0` (versionCode 3).

### Fixed

- **Phone layout could be stretched horizontally** by a long unbreakable status
  line (an implicit grid column sized to max-content). `.app` now declares a
  shrinkable column.
- **The bottom sheet's peek could be clipped** by the map's minimum height; the
  work area is a flex column with the sheet at a fixed height.
- **Sheet peek text ran together** ("…07:45:00タップして…") in the phone media
  query; the two lines are now stacked.
- English feed column headers no longer wrap mid-word ("Max intensity" broke into
  two lines); they truncate with an ellipsis at the same column width.
- `tests/` now sees `__APP_VERSION__` (the vitest config mirrors the Vite
  `define`), so panel tests no longer fail on an undefined global.
- The Android debug keystore's certificate DN no longer carries a version string.

## v0.1.1 — 2026-10-22

Localisation release. The viewer was Japanese-only in v0.1.0; it is now bilingual,
and the "stuck on a logo" failure mode is fixed.

### Added

- **Japanese and English localisation** (`src/i18n/`): complete catalogs, `t()`
  with `{placeholder}` interpolation, instant switching from the header
  (`日本語 | English`), and persistence across restarts.
- **Japanese is the default** for a fresh install, regardless of the device
  language.
- **Native preference storage** on Android (`NativePrefs.java` →
  `YureWatchPrefs`), because WebView `localStorage` is not dependable for the
  `file:///android_asset/` origin.
- **The other language stays visible on the EEW panel**: the active language is
  the headline, the other is a subtitle.
- `docs/I18N.md`, `tools/screenshots.mjs`, `CHANGELOG.md`.
- 25 new unit tests (localisation) and 8 new browser checks.

### Changed

- Header is a two-row layout on phones, so brand, language switch, mode,
  connection state, JST clock and freshness all fit without truncation in
  either language.
- Map EEW label and attribution are localised; the label keeps clear of the zoom
  controls.
- EEW warning-area rows keep the area name, intensity range and arrival state on
  one line in both languages.
- Feed list has an explicit `list-style`/overflow reset (markers appeared in the
  gutter on some layouts).
- Version bumped to `0.1.1` (versionCode 2).

### Fixed

- **Startup no longer stalls on a splash screen.** The shell shows a progress
  line and, after six seconds without a mounted app, replaces it with an
  explanation and a reload button. This is the state produced by opening the
  source `index.html` without the bundler.
- Intensity labels of the form `5弱`/`5強` render as `5-`/`5+` in English instead
  of leaking Japanese into the English UI.

## v0.1.0 — 2026-10-22

First functional release: canvas map of Japan, JMA earthquake feed via the public
P2P地震情報 JSON API v2, EEW state machine, tsunami panel, nine deterministic
situations in demo mode, installable Android APK, CI and a GitHub Release.
