# Reference inspection — kotoho7/scratch-realtime-earthquake-viewer-page

Inspected 2026-10-22 by cloning the repository (`git clone --depth 1`) and reading
its source, assets, workflows and terms. This file records what was found, what
was reusable, and why almost none of it was reused.

## 1. What the project actually is

| Fact | Evidence |
| --- | --- |
| It is a **Scratch 3 project**, not a web-app codebase. | `docs/assets/project.json` (5.9 MB) contains 7 sprites with **12,427 blocks** in the receiver sprite, 6,813 in the map sprite, 8,209 in the UI sprite; `meta.platform` = TurboWarp. |
| The web page is a **TurboWarp Packager** artefact. | `docs/index.html` header comment: `<!-- Created with https://packager.turbowarp.org/ -->`; `docs/index.js` is the packager runtime. |
| Desktop packaging is **Tauri v2**. | `src-tauri/tauri.conf.json`, `Cargo.toml`, `package.json` dependencies `@tauri-apps/plugin-http`. |
| Distribution is GitHub Pages + PWA, plus Tauri installers on release. | `README.md`, `docs/manifest.json`, `.github/workflows/publish.yaml` (matrix macos/ubuntu/windows, `tauri-action`, draft release). |
| Assets: 1,531 files under `docs/assets` — 1,495 SVG costumes, 32 MP3 sounds, 2 PNG, plus `project.json`. | `ls docs/assets`. The map is drawn from imported SVG costumes, one per map state. |
| Extensions used: `srevExtension` (the author's cloud-variable client), `lmsAssets`/`files` loaders, `text2speech`, `localstorage`, `pen`, `cubesterWindowControls`, `MouseCursor`, `runtimeoptions`, `shovelColorPicker`. | `project.json` → `extensions`. |

**Consequence:** there is no component structure, map library, data adapter or
build pipeline to reuse. The application logic is not expressible as source code
in this repository — it is a Scratch block graph with numeric opcode ids.

## 2. Data pipeline of the reference

From `README.md` (Japanese):

- JMA 緊急地震速報（予報）, 地震情報, 長周期地震動情報, 津波予報/観測 — received via
  **Project DM-D.S.S (dmdata.jp)** over a persistent WebSocket. The author states
  they hold redistribution permission for JMA EEW through DM-D.S.S.
- 震度データベース検索 (JMA) for updates within 2 days.
- **防災科学技術研究所 (NIED) 長周期地震動モニタ** for real-time intensity —
  derived by **scraping/decode of the monitor's PNG imagery** (the README cites a
  Qiita article on polynomial interpolation of 強震モニタ images).
- 海しる (MSIL) 強震動情報 for seafloor seismometers.
- Since v1.6 the packaged app talks to the author's **own cloud-variable server**
  (a Scratch cloud-variable relay), governed by `terms.md`.

### Why none of this was reused

| Item | Why not |
| --- | --- |
| DM-D.S.S. | Paid subscription, per-account API key. The author's permission is not transferable. Using it would require the user's own credentials — and credentials must never ship inside an APK. |
| The author's cloud-variable server | `terms.md` §3 explicitly forbids accessing the service's internal API by any means other than the service itself. Off-limits by the author's own terms. |
| NIED monitor imagery decoding | Requires bypassing the presentation layer of a site that publishes no machine-readable API; the reference README itself calls the values 参考値 (reference values). Not attempted. |
| `docs/assets/*.svg` (map, UI) | See licence below: CC BY-SA 2.0 (Scratch shared-project assets). |
| Sounds (`*.mp3`) | Sourced from OtoLogic (different licence) and JQuake-inspired; the README credits them, they are not the project's to relicense. |

## 3. Licence review

| Artefact | Stated licence | What it means for us |
| --- | --- | --- |
| Images/audio in `docs/assets` | **CC BY-SA 2.0** (README: "このプロジェクトはScratchで共有されているため、/docs/assets にある画像や音声は CC BY-SA 2.0 になります") | Reusable *with* attribution **and** share-alike: any derivative must carry CC BY-SA 2.0. Mixing that into an MIT-licensed app would force the whole combined work into share-alike. **Decision: not reused.** |
| Application code (the Scratch blocks) | No `LICENSE` file in the repository. `terms.md` governs *use of the service*, not reuse of the software. | No clear grant → **not reused.** |
| `terms.md` / privacy policy | Service terms, not a software licence. Prohibits third-party access to the internal API. | Respected; we do not touch that service. |
| Map geometry provenance | JMA 予報区等GISデータ + 国土数値情報 湖沼データ (**not** CC BY-SA, JMA/MLIT terms) + Natural Earth 1:10m (public domain) + NOAA ETOPO. | The reference's own credits note the map mixes sources with different terms, and the compiled SVG is redistributed under CC BY-SA. **Decision: build our own geometry from Natural Earth 1:10m (public domain) instead** — see `scripts/build_map_data.py`. |
| Fonts (Akshar, BIZ UDPGothic) | SIL OFL 1.1 | OFL allows redistribution with the licence; we did not bundle them (system font stack instead) to keep the APK self-contained and avoid licence files for fonts we do not ship. |

## 4. What was recreated by observation (and how)

Screenshots in the reference `docs/images/` were read as *design references only*.

| Recognisable element | How YureWatch implements it |
| --- | --- |
| Dark sea/land basemap with light prefecture outlines | Own Mercator projection + `Path2D` canvas renderer, palette designed in-house (`src/map/theme.ts`). |
| Intensity-coloured prefecture shading and numeral badges | Own ramp (`src/core/intensity.ts`) keyed to the JMA scale encoding (`10`–`70`), with contrast-checked text colours. |
| Epicentre markers sized by magnitude | `markerRadius()` in `src/map/scene.ts` (original formula). |
| Left panel: max intensity block, magnitude/depth rows, tsunami line | `src/ui/details.ts`, `src/ui/alertPanel.ts` — same information hierarchy, original markup/CSS. |
| EEW crosshair on the map | Drawn as an X with pulsing rings in `src/map/renderer.ts`; original geometry and animation. |
| Tabbed phone layout | `src/ui/app.ts` bottom tab bar (地震情報 / 詳細 / 情報) — different information grouping (the reference has 地震情報 / リアルタイム / 津波情報 / 設定). |
| Alert jingle | **Not reused** (OtoLogic licence). Replaced with a synthesised WebAudio two-tone chime. |

Nothing in this repository is a copy of a reference asset; the similarity is at
the level of layout conventions and colour semantics, which is what the brief
asked for ("preserve the recognizable aspects … use original project branding").

## 5. Things that were unavailable and how they were handled

| Item | Status in v0.1 |
| --- | --- |
| DM-D.S.S. WebSocket feed | Not available (paid, per-account). Documented adapter path instead. |
| JMA EEW 予報 (prediction-grade) wire feed | The public relay forwards 警報; the app distinguishes 予報/警報 by the presence of 警報対象区域 and says so. |
| NIED real-time intensity | No licensed machine-readable API identified → feature explicitly marked "未接続" in the UI. |
| Tsunami observations | Not relayed by the chosen source → not shown. |
| Reference project's own API/credentials | Prohibited by its terms; not used. |
| Play Store signing key | Not available; CI uses a throwaway debug key, documented. |
| Android device/emulator | No KVM in the build environment; APK built + signature-verified, bridge tested in Chromium. Manual device check outstanding. |
