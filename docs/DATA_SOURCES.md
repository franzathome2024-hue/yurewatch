# Data sources

Every source below was verified against its live endpoint on **2026-10-22**
(actual HTTP requests, actual response bodies). Nothing in the app is mocked to
look live: where a source is unavailable, the UI says so.

## 1. In use — P2P地震情報 JSON API v2

| Property | Value |
| --- | --- |
| Base URL | `https://api.p2pquake.net/v2` |
| Spec | <https://www.p2pquake.net/develop/json_api_v2/> · OpenAPI: `/swagger-ui/specification.yaml` (version 2.3.0) |
| Auth | None |
| Cost | Free, commercial and non-commercial ("商用・非商用問わず無償") |
| Reuse terms | <https://www.p2pquake.net/secondary_use/> — attribution for JMA-derived information |
| Rate limits | `/history` 60 req/min/IP · `/jma` 10 req/min/IP · `/ws` 2 connections/IP |
| CORS | `access-control-allow-origin: *` (verified) |
| Transport used | HTTP polling of `/history` |

### Endpoints used

```
GET /history?codes=556&limit=20   緊急地震速報（警報）      → alerts
GET /history?codes=551&limit=30   地震情報                  → event feed
GET /history?codes=552&limit=5    津波予報                  → tsunami panel
```

### Request budget

| Mode | Cadence | Requests/min |
| --- | --- | --- |
| Idle | 20 s | 9 |
| EEW in force (5 min after last EEW) | 6 s | 30 |
| Failure | exponential backoff, 1.8 s → 54 s + 20 % jitter | ≤ 3.3 |

All well inside 60 req/min. `tests/liveFeed.test.ts` asserts the cadence
arithmetic so a future change cannot silently exceed the limit.

### Verified response shapes (abridged, real bodies)

`code: 551` (地震情報):

```json
{"code":551,"id":"6ad94144e88ee598246bf40b","time":"2026/10/22 07:48:36.23",
 "issue":{"source":"気象庁","time":"2026/10/22 07:48:35","type":"DetailScale","correct":"None"},
 "earthquake":{"time":"2026/10/22 07:45:00","maxScale":10,"domesticTsunami":"None",
   "hypocenter":{"name":"熊本県熊本地方","latitude":32.4,"longitude":130.6,"depth":10,"magnitude":2.9}},
 "points":[{"addr":"五木村甲","pref":"熊本県","scale":10,"isArea":false}]}
```

`code: 556` (緊急地震速報):

```json
{"code":556,"id":"…","cancelled":false,"test":false,
 "issue":{"time":"…","eventId":"20261016123810","serial":"2"},
 "earthquake":{"originTime":"…","arrivalTime":"…","condition":null,
   "hypocenter":{"name":"…","latitude":…,"longitude":…,"depth":…,"magnitude":…}},
 "areas":[{"pref":"北海道道東","name":"根室地方北部","scaleFrom":45,"scaleTo":70,
           "kindCode":"11","arrivalTime":null}]}
```

`code: 552` (津波予報): `cancelled`, `issue{source,time,type}`, `areas[]` with
`grade` (`MajorWarning|Warning|Watch|Unknown`), `firstHeight.arrivalTime`,
`maxHeight{description,value}`.

### Documented fields the app deliberately ignores

| Field / code | Why |
| --- | --- |
| `554` EEW detection, `561` userquake, `9611` area peers, `556`-adjacent social telegrams | Not official information; presenting them would blur the official/unofficial line. |
| `test: true` telegrams | Accepted by the parser, but the alert state machine can be configured to ignore them, and the panel badges them 訓練/試験 so they never adopt warning styling. |
| `comments.freeFormComment` | Free-form, unvetted text. |

### Gotchas found while building against it (all handled in code)

1. **`/history` returns history.** One poll of `codes=556` at 07:48 JST returned
   EEW telegrams from six days earlier (2026-10-16). A naive viewer shows that as
   an active warning. `partitionEews()` gates alerts to a 10-minute window, and
   `pickCurrentTsunami()` keeps only the newest bulletin within 12 hours.
2. **JMA sentinels leak into JSON**: `latitude/longitude: -200`, `depth: -1`,
   `magnitude: -1`, `maxScale: -1`. `parseEpicenter()` converts these to
   "unknown" and never to `0`.
3. **Intensity codes arrive as floats** (`45.0`, and the spec notes "システムの都合で
   小数点が付きますが整数部のみ有効です"). `normaliseScale()` truncates and rejects
   negatives.
4. **Area intensities are ranges** (`scaleFrom`/`scaleTo`) plus a `kindCode`
   describing whether the main motion has arrived (`10`/`11`) or is PLUM-only
   (`19`). The panel shows the range and the arrival state; it does not collapse
   them into a single number.
5. **`cancelled` telegrams carry `earthquake: null`.** Parsing must not treat
   that as an error, and the map must stop drawing the crosshair (fixed after
   review: see `src/map/scene.ts`).
6. **Timestamps are JST strings without a zone** (`2026/10/22 07:45:00.123`), and
   some are unparsable. `parseJst()` is strict and returns `null`.

## 1a. Coastline & context land — Natural Earth 1:10m (public domain)

| Property | Value |
| --- | --- |
| Files | `ne_10m_admin_1_states_provinces` (Japan), `ne_10m_admin_0_countries` (neighbours) |
| URL | `https://naciscdn.org/naturalearth/10m/cultural/…zip` |
| Licence | Public domain — no attribution required, no share-alike |
| Generator | `scripts/build_map_data.py` → `src/data/japan-map.json` |

### Coverage claims (measured, not declared)

| Property | Value (this release) |
| --- | --- |
| Japan clip box (`meta.bounds`) | 122.5, 23.5, 148.0, 46.5 |
| **Measured** geometry extent (`meta.geometryBounds`) | 122.938, 24.046, 145.825, 45.52 |
| Context clip box (`meta.contextBounds`) | 114.0, 16.0, 162.0, 56.0 |
| Prefectures / rings / vertices | 47 / 173 / 10,392 |
| Context land rings / vertices | 9 / 174 rings / 7,568 vertices |
| File size | 308,845 B (302 KiB) |

`meta.bounds` is the box the generator *asked* for; `meta.geometryBounds` is what it
actually got. Earlier releases published only the clip box, which made 148 °E and
24.0 °N look like real coordinates when the easternmost point in the data is 145.8 °E.

Context land is clipped at 114–162 °E / 16–56 °N, deliberately wider than the camera's
pan limits (118–158 °E / 20–52 °N) so neighbouring countries never end in a straight
line inside a reachable view. This also brought Taiwan, the Philippines, Mongolia,
Hong Kong and the Northern Marianas into the context layer.

### Coverage gap found in v0.3.0 and how it was closed

**The v0.3.0 claim "the southern Ryukyus are not in this dataset" was wrong, and the
error was ours.** Natural Earth 1:10m does carry Miyakojima (157 km²), Ishigakijima
(212 km²), Iriomote (274 km²) and Yonaguni (25 km²) — they are four of the 29 polygons
in `ne_10m_admin_1_states_provinces` for JP-47. The generator clipped them away: the
`BOUNDS` box started at **127.5 °E**, which is east of all four. What shipped was a
basemap with no land west of 127.5 °E, a note blaming the upstream dataset, and no test
that could notice.

Measured before/after on this release (2026-10-22):

| | v0.3.0 | now |
| --- | --- | --- |
| Okinawa (JP-47) rings / vertices | 12 / 344 | 35 / 471 + reattribution |
| Kagoshima (JP-46) rings / vertices | 13 / 408 | 27 / 720 |
| Westernmost vertex | 127.636 °E | 122.938 °E (Yonaguni) |
| Southernmost vertex | 24.212 °N | 24.046 °N (Hateruma) |
| File size | 302,097 B | 308,845 B (+2.2 %) |

Two separate fixes were needed, and they are worth keeping apart:

1. **Our clip box** (`BOUNDS` → 122.5, 23.5, 148.0, 46.5) restores everything Natural
   Earth has, at no data cost. This alone recovers the four headline islands.
2. **A real upstream gap of 16 islands ≥ 5 km²** (Tarama 20.1 km², Hateruma 12.9 km²,
   Kuroshima 10.1 km², the Kerama group, Kumejima's satellites, 黒島/竹富 in the
   Yaeyama, and six in Kagoshima) that Natural Earth 1:10m genuinely does not carry.
   These are filled from 国土数値情報 N03 (§2a-2) — see below for why only these.

Natural Earth also mis-assigns the **Amami group to Okinawa**: `ne_10m_admin_1_states_provinces`
puts Amami Ōshima (742 km²), Kakeroma, Tokunoshima, Kikaijima, Okinoerabu and Yoron in
JP-47. They are Kagoshima (JP-46). N03 now corrects six rings. A test asserts that no
island-sized ring north of 27.2 °N is attributed to Okinawa.

### What a basemap is not

The land and border geometry is orientation only. It is not a tsunami inundation area,
not a seismic intensity distribution, and not an impact estimate; nothing in the data
carries a hazard value. The legend and the About panel say so.

## 2. In use — bundled geographic data

Three geographic products are bundled. They are **not** interchangeable, and the app
never presents one as another: Natural Earth supplies the basemap, MLIT N03 supplies
only the islands Natural Earth lacks, and JMA supplies the tsunami forecast regions.

### 2a. Basemap: Natural Earth 1:10m (public domain) + MLIT N03 gap fill

| Property | Value |
| --- | --- |
| Dataset | `ne_10m_admin_1_states_provinces` (Japan, 47 features), `ne_10m_admin_0_countries` (neighbouring land), plus 国土数値情報 N03-2025 for prefectures 46/47 |
| Source | <https://www.naturalearthdata.com/> (NACIS CDN); <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html> |
| Licence | Natural Earth: public domain. N03: 公共データ利用規約（第1.0版）, attribution **出典：国土数値情報（行政区域）を加工して作成** |
| Bundled file | `src/data/japan-map.json` (308,845 B / 302 KiB, 17,960 vertices, 347 rings) |
| Generator | `scripts/build_map_data.py` (reproducible: downloads, dissolves, simplifies, clips, records provenance) |
| Processing | Douglas-Peucker 0.0015° for Japan, 0.008° for neighbours; islands ≥ 1e-6 deg²; lakes ≥ 2e-5 deg² kept as hole rings; coordinates rounded to 3 dp (N03 rings snapped to a 0.001° grid with `set_precision` so simplification cannot create bow-ties) |

**What it is:** Natural Earth's *administrative* polygons. There is no separate
"coastline" layer in the data: the land/water edge the user sees is the exterior
ring of the prefecture (and country) polygons. Prefecture borders and the
coastline therefore come from the same source and cannot drift apart, which is
why alert outlines and markers stay aligned with the coast at every zoom level.

**Known limitation (measured, not guessed).** Natural Earth 1:10m is generalised.
Against 国土数値情報 C23 海岸線 (a 1:25,000 national coastline, below), a random
sample of 9,776 shoreline vertices around Kantō shows a **median offset of
≈1.0 km, p90 ≈7.9 km**. At the default country framing that is invisible; past
roughly ×3 zoom the shapes read as blocky (Tokyo Bay, Bōsō, the Seto Inland Sea
islands). The app does not claim survey accuracy and the legend says the layer is
for orientation, not navigation.

**Why the higher-detail source is not bundled wholesale.** See 2c. Short version:
mixing a detailed coastline with generalised fills puts two different shorelines on
the same screen (≈1 km apart, i.e. several pixels at working zoom), and polygonising
a line-only dataset would invent topology the source does not define.

#### 2a-2. Gap fill — 国土数値情報（行政区域）N03-2025, prefectures 46 and 47 only

| Property | Value |
| --- | --- |
| Dataset | 国土数値情報（行政区域）`N03-2025`, `N03-20250101_{46,47}_GML.zip` |
| Source | <https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html> (MLIT 国土数値情報ダウンロードサービス) |
| Version / data date | `N03-2025`, **data date 2025-01-01** (shapefile written 2025-01-16), EPSG:6668 |
| Licence | 公共データ利用規約（第1.0版）. Attribution **出典：国土数値情報（行政区域）を加工して作成** is shown in the map attribution line, the About panel and `meta.sources` |
| Retrieved | 2026-10-22 |
| Size used | 2 prefectures: 9,034 + 5,860 municipal polygons (**not** the 600 MB national set) |
| What is taken | 16 island polygons ≥ 5 km² that the Natural Earth basemap does not contain, dissolved to prefecture and simplified to 0.0015° (327 vertices total), plus 6 rings re-assigned between prefectures |
| What is *not* taken | the mainland coastline, prefecture borders, cities, and any attribute other than the prefecture code |

**Why this and not a full swap.** Swapping the whole basemap for N03 would multiply
the download by roughly 20× (a national N03 build is ~600 MB of shapefile before
simplification), replace a 1:10m generalised coastline with a 1:25,000 one for all of
Japan (so every polygon the app already ships would move by up to ~1 km), and change
the visual weight of every screen for no gain in what the app is for. The measured
gap was 16 islands, all in two prefectures; 327 vertices close it. The rule the
generator applies is therefore *gap fill, never overlap*: an N03 island is only added
when less than 20 % of its area is already covered by the shipped basemap (buffered
0.01° to absorb Natural Earth's generalisation), and a Natural Earth ring is dropped
when 50 % of it sits inside an added island (otherwise two coastlines a few hundred
metres apart are drawn on top of each other).

**Trade-off accepted.** Inside the 16 filled islands the shoreline detail is 1:25,000
simplified, while adjacent islands are 1:10m; at very high zoom the difference is
visible as a slightly finer outline on Tarama or Hateruma than on Ishigaki. Recorded
in `meta.coverage.islandsAdded` with area, bbox and vertex count for each island.

**Reproducibility.** `python3 scripts/build_map_data.py` re-downloads both sources
(cached in `scripts/.naturalearth/`), rebuilds the file byte-identically apart from
the `built` timestamp, and writes `meta.sources`, `meta.coverage` and `meta.note`.
`tests/islandCoverage.test.ts` re-checks 10 named islands by point-in-polygon, the
declared geometry bounds against the actual vertices, ring validity (no self
intersections, no duplicate or zero-length rings), the clip window, the two framing
profiles, and the provenance fields.

### 2b. Tsunami forecast regions: 気象庁 予報区等GISデータ「津波予報区」

| Property | Value |
| --- | --- |
| Dataset | 津波予報区 (tsunami forecast regions), file `20240520_AreaTsunami_GIS.zip`, data date **2024-05-14** |
| Source | <https://www.data.jma.go.jp/developer/gis.html> (JMA 予報区等GISデータ) |
| Licence | 公共データ利用規約（第1.0版） — Japan's Public Data Licence 1.0, CC BY 4.0 compatible. Attribution **and** a statement that the data was modified are required |
| CRS | JGD2011 (EPSG:6668) — WGS84-compatible for display |
| Bundled file | `src/data/tsunami-areas.json` (211 KiB, 66 regions, 320 rings, 12,542 vertices) |
| Generator | `scripts/build_tsunami_areas.py` (documented, reproducible) |
| Attribution (shown in-app) | 出典：気象庁ホームページ「予報区等GISデータ（津波予報区）」を加工して作成 |

**What it is:** the regions JMA uses when it issues 津波警報 / 津波注意報 / 津波予報.
The source stores each region as a MultiLineString whose parts are *closed* rings;
the generator treats them as polygon outlines, drops rings below 0.00035 deg²
(~3.5 km²) while always keeping each region's largest ring, simplifies at 0.004°
(~440 m) and rounds to 3 decimals. 113,764 islet rings and 8.9 M vertices were
reduced to 12,542 vertices, so the layer costs 211 KiB instead of ~90 MB.

**Excluded on purpose:** four features carry `code = "0"` and names 帰属未定1–4 —
JMA itself marks them *unassigned*. They are not in the bundle; inventing an
identifier would fabricate a code the authority did not issue.

**What it is not:** not a coastline, and **not a tsunami inundation hazard zone**.
The app states both in the legend and in the info panel, and no inundation data
is bundled or implied.

**How it is used:** the layer paints only the regions *named by the currently
received bulletin* (`matchRegionsByName`), each in its own grade colour. Areas a
bulletin names that cannot be matched to geometry are counted and disclosed in
the info panel rather than dropped silently. Nothing is ever inferred from an
earthquake's location, and a cancelled bulletin paints nothing.

### 2c. Evaluated and deliberately not bundled

| Dataset | Terms | Verdict |
| --- | --- | --- |
| 国土数値情報 N03 行政区域 — **full basemap swap** | 公共データ利用規約 1.0 — redistribution permitted with attribution | **Rejected as a replacement, adopted as a gap fill (§2a-2).** A national N03 build is ~600 MB of shapefile before simplification; it would replace the whole 1:10m coastline with 1:25,000 polygons (every shipped shape moves up to ~1 km) and add 5× the vertices for detail the app never shows. Measured gap: 16 islands in two prefectures, closed with 327 vertices. Revisit only if the app starts needing city-level boundaries. |
| 国土数値情報 C23 海岸線 (MLIT, coastline) | 公共データ利用規約 1.0 — redistribution permitted with attribution | **Verified, usable, not bundled.** Per-prefecture shapefiles (~3 MB each, 47 files). Measured ~1 km median offset from the Natural Earth fills, so drawing it over the current basemap would show two shorelines. It becomes viable only together with polygon data from the same family for the land fill. |
| 気象庁 予報区等GISデータ（地震情報／細分区域, 緊急地震速報／府県予報区） | same PDL 1.0 | Usable, but the app already highlights EEW areas by prefecture name; a second regional geometry set would duplicate the same information with a different boundary definition. |
| GSI 基盤地図情報 / 地球地図日本 | 基盤地図情報の利用規約 (attribution, some products require registration) | Not evaluated further: registration/licence review not completed, so not bundled. |
| INI JMA region geoshapes (geoshape.ex.nii.ac.jp) | Research-institute mirror of JMA region data; terms not verified | **Not used** — the primary JMA source was available and verifiable. |
| `trigger-info.bosai.go.jp` JMA_TNM_WARN feature service | Service terms not stated for redistribution | **Not used** for bundled geometry; treated as a research pointer only. |

## 3. Not connected (and not simulated)

| Source | Status | Reason |
| --- | --- | --- |
| **Project DM-D.S.S.** (dmdata.jp) | Not used | Paid subscription with per-account API key; credentials cannot ship in an APK. Adapter path documented below. |
| **NIED 長周期地震動モニタ / リアルタイム震度** | Not used | No documented, licensed machine-readable API was identified; values are published as imagery and the source itself labels them 参考値. The UI section states this explicitly rather than substituting different data. |
| **Tsunami observations** (measured heights) | Not used | Not relayed by the chosen API. |
| **気象庁 震度データベース** | Not used | HTML search interface, not an API; scraping is out of scope. |
| **JMA XML direct** (xml.kishou.go.jp) | Not used | Requires a push endpoint ( Laboratory / 防災情報XML) — infrastructure out of scope for v0.1; documented as an option. |

## 4. Adding a source (the integration interface)

A new provider only has to satisfy two shapes:

```ts
// 1. Produce raw telegrams or parsed models.
interface Transport { getText(url: string, opts?: {timeoutMs?: number}): Promise<{status: number; body: string}> }

// 2. Emit into the app. Nothing else changes.
type FeedEvent =
  | { type: 'connection'; state: 'connecting'|'live'|'degraded'|'stale'|'offline'; at: number; detail?: string }
  | { type: 'batch'; at: number; events: EarthquakeEvent[]; eews: EewAlert[]; tsunami: TsunamiInfo | null; rejected: number };
```

The reducers (`src/state/store.ts`), alert state machine (`src/state/alert.ts`) and
all UI are source-agnostic. To wire DM-D.S.S.:

1. Implement `DmdataTransport` (WireGuard/socket or REST long-poll) behind the same
   `FeedEvent` emitter, mapping its `556`/`551`/`552` equivalents through
   `parseEew`/`parseEarthquake`/`parseTsunami` — they are pure and already handle
   the JMA XML vocabulary the service relays.
2. Keep the API key in the OS keystore / a config screen; **never** in the bundle.
   For an APK, that means either a user-supplied key stored natively, or a proxy
   server you operate — both are documented options, neither is in v0.1.
3. Add the provider to `SourceRef` (`authority: 'jma-via-dmdss'`) so the UI keeps
   distinguishing official-but-relayed from simulated.
