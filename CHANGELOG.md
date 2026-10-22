# Changelog

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
