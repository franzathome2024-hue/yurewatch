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
| Japan clip box (`meta.bounds`) | 127.5, 24.0, 148.0, 46.5 |
| **Measured** geometry extent (`meta.geometryBounds`) | 127.636, 24.212, 145.825, 45.52 |
| Context clip box (`meta.contextBounds`) | 114.0, 16.0, 162.0, 56.0 |
| Prefectures / rings / vertices | 47 / 136 / 17,777 |

`meta.bounds` is the box the generator *asked* for; `meta.geometryBounds` is what it
actually got. Earlier releases published only the clip box, which made 148 °E and
24.0 °N look like real coordinates when the easternmost point in the data is 145.8 °E.

Context land is clipped at 114–162 °E / 16–56 °N, deliberately wider than the camera's
pan limits (118–158 °E / 20–52 °N) so neighbouring countries never end in a straight
line inside a reachable view. This also brought Taiwan, the Philippines, Mongolia,
Hong Kong and the Northern Marianas into the context layer.

### Known completeness gap

**The southern Ryukyus are not in this dataset.** Natural Earth 1:10m holds only the
northern part of Okinawa prefecture: every 沖縄県 ring starts north of 25.8 °N, so
Miyakojima, Ishigakijima, Iriomote and Yonaguni are absent. `ne_10m_minor_islands` was
checked and does not contain them either (verified 2026-10-22: 2,795 polygons, none in
the 124–125 °E / 24.3–24.8 °N box). Nothing is drawn there, and the app does not
pretend otherwise.

Replacing the basemap with a Japanese national source was evaluated and rejected on
measured grounds in §2c (MLIT C23 coastline: 2006 only, ≈1.0 km median offset from the
current data). GSI 行政区域データ would close the gap but is a per-prefecture GML
dataset orders of magnitude larger than this app's entire geography budget; it has not
been adopted because it has not been tested here, not because of a licensing problem.

## 2. In use — bundled geographic data

Two different geographic products are bundled. They are **not** interchangeable,
and the app never presents one as the other.

### 2a. Basemap: Natural Earth 1:10m (public domain)

| Property | Value |
| --- | --- |
| Dataset | `ne_10m_admin_1_states_provinces` (Japan, 47 features), `ne_10m_admin_0_countries` (neighbouring land) |
| Source | <https://www.naturalearthdata.com/> (NACIS CDN) |
| Licence | Public domain — no attribution required, no share-alike |
| Bundled file | `src/data/japan-map.json` (~189 KiB, 11,351 vertices, 162 rings) |
| Generator | `scripts/build_map_data.py` (reproducible; downloads, simplifies, clips) |
| Processing | Douglas-Peucker 0.0015° for Japan, 0.008° for neighbours; islands ≥ 1e-6 deg²; lakes ≥ 2e-5 deg² kept as hole rings; coordinates rounded to 3 dp |

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

**Why the higher-detail source is not bundled.** See 2c. Short version: mixing a
detailed coastline with generalised fills puts two different shorelines on the
same screen (≈1 km apart, i.e. several pixels at working zoom), and polygonising
a line-only dataset would invent topology the source does not define.

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
