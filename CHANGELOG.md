# Changelog

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
