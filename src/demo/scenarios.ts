/**
 * Deterministic demo scenarios.
 *
 * IMPORTANT: every message below is FABRICATED for testing. Payloads are shaped
 * exactly like the p2pquake /history items so they travel through the real
 * parsers, but they are tagged with `DEMO_SOURCE`, which sets `simulated: true`
 * on every model object. The UI renders a SIMULATION banner whenever that flag
 * is set, and the audio path refuses to sound for simulated events unless the
 * developer explicitly opts in (`?demoAudio=1`).
 *
 * Times are expressed as offsets from scenario start, never as wall-clock
 * values, so the demo behaves identically whenever it is run.
 */

export type DemoConnection = 'live' | 'offline' | 'stale' | 'degraded' | 'connecting';

export interface DemoStep {
  /** ms after scenario start */
  at: number;
  /** Human-readable description shown in the demo HUD. */
  label: string;
  /** Wire-shaped records (p2pquake JSON). */
  items?: unknown[];
  /** Connection state to publish with this step. */
  connection?: DemoConnection;
  /** Publish an explicit error instead of data. */
  error?: string;
}

export interface DemoScenario {
  id: string;
  label: string;
  summary: string;
  durationMs: number;
  steps: DemoStep[];
}

/* ------------------------------------------------------------------ *
 * Payload builders
 * ------------------------------------------------------------------ */

/** JST timestamp string for `msFromNow` offset. Format matches p2pquake. */
export function jstStamp(epochMs: number): string {
  const d = new Date(epochMs + 9 * 3600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.` +
    `${p(d.getUTCMilliseconds(), 3)}`
  );
}

interface QuakeSpec {
  id: string;
  origin: number;
  issue: number;
  type: 'ScalePrompt' | 'Destination' | 'ScaleAndDestination' | 'DetailScale';
  lat: number;
  lon: number;
  depth: number;
  mag: number;
  name: string;
  maxScale: number;
  tsunami?: string;
  points?: Array<[pref: string, addr: string, scale: number]>;
}

function quake(spec: QuakeSpec): unknown {
  return {
    code: 551,
    id: spec.id,
    time: jstStamp(spec.issue),
    issue: { source: '気象庁', time: jstStamp(spec.issue), type: spec.type, correct: 'None' },
    earthquake: {
      time: jstStamp(spec.origin),
      hypocenter: {
        name: spec.name,
        latitude: spec.lat,
        longitude: spec.lon,
        depth: spec.depth,
        magnitude: spec.mag,
      },
      maxScale: spec.maxScale,
      domesticTsunami: spec.tsunami ?? 'None',
      foreignTsunami: 'Unknown',
    },
    points: (spec.points ?? []).map(([pref, addr, scale]) => ({ pref, addr, isArea: false, scale })),
  };
}

interface EewSpec {
  id: string;
  eventId: string;
  serial: number;
  origin: number;
  issued: number;
  lat: number;
  lon: number;
  depth: number;
  mag: number;
  name: string;
  /** Empty array = 予報 (no 警報対象区域). */
  areas?: Array<[pref: string, name: string, from: number, to: number, kind: string, arrivalInMs?: number]>;
  cancelled?: boolean;
  test?: boolean;
  condition?: string;
  /** Detection time used for the message-level arrivalTime field. */
  detectedAt?: number;
}

function eew(spec: EewSpec, startAt: number): unknown {
  const areas = (spec.areas ?? []).map(([pref, name, from, to, kind, arrivalInMs]) => ({
    pref,
    name,
    scaleFrom: from,
    scaleTo: to,
    kindCode: kind,
    arrivalTime: arrivalInMs === undefined ? null : jstStamp(startAt + arrivalInMs),
  }));
  return {
    code: 556,
    id: spec.id,
    time: jstStamp(spec.issued),
    test: spec.test ?? false,
    cancelled: spec.cancelled ?? false,
    earthquake: spec.cancelled
      ? null
      : {
          originTime: jstStamp(spec.origin),
          arrivalTime: jstStamp(spec.detectedAt ?? spec.issued),
          condition: spec.condition,
          hypocenter: {
            name: spec.name,
            latitude: spec.lat,
            longitude: spec.lon,
            depth: spec.depth,
            magnitude: spec.mag,
          },
        },
    issue: { time: jstStamp(spec.issued), eventId: spec.eventId, serial: String(spec.serial) },
    areas,
  };
}

function tsunami(
  id: string,
  issued: number,
  cancelled: boolean,
  areas: Array<{ grade: string; name: string; immediate?: boolean; height?: string; value?: number }>,
): unknown {
  return {
    code: 552,
    id,
    time: jstStamp(issued),
    cancelled,
    issue: { source: '気象庁', time: jstStamp(issued), type: 'Focus' },
    areas: areas.map((a) => ({
      grade: a.grade,
      name: a.name,
      immediate: a.immediate ?? false,
      firstHeight: { arrivalTime: null, condition: undefined },
      maxHeight: a.height ? { description: a.height, value: a.value } : undefined,
    })),
  };
}

/** A small, stable set of plausible (but invented) historical reports. */
function historicalSet(startAt: number) {
  return [
    quake({
      id: 'demo-q-001',
      origin: startAt - 6 * 3600_000,
      issue: startAt - 6 * 3600_000 + 110_000,
      type: 'DetailScale',
      lat: 38.2,
      lon: 142.1,
      depth: 45,
      mag: 5.4,
      name: '宮城県沖',
      maxScale: 40,
      points: [
        ['宮城県', '石巻市', 40],
        ['宮城県', '仙台市宮城野区', 30],
        ['岩手県', '一関市', 30],
        ['福島県', '相馬市', 20],
      ],
    }),
    quake({
      id: 'demo-q-002',
      origin: startAt - 26 * 3600_000,
      issue: startAt - 26 * 3600_000 + 95_000,
      type: 'DetailScale',
      lat: 37.3,
      lon: 137.2,
      depth: 10,
      mag: 4.1,
      name: '能登半島沖',
      maxScale: 30,
      points: [
        ['石川県', '輪島市', 30],
        ['石川県', '七尾市', 20],
        ['富山県', '氷見市', 10],
      ],
    }),
    quake({
      id: 'demo-q-003',
      origin: startAt - 49 * 3600_000,
      issue: startAt - 49 * 3600_000 + 130_000,
      type: 'DetailScale',
      lat: 32.7,
      lon: 130.8,
      depth: 10,
      mag: 3.2,
      name: '熊本県熊本地方',
      maxScale: 20,
      points: [
        ['熊本県', '熊本市中央区', 20],
        ['熊本県', '宇土市', 10],
      ],
    }),
    quake({
      id: 'demo-q-004',
      origin: startAt - 71 * 3600_000,
      issue: startAt - 71 * 3600_000 + 140_000,
      type: 'DetailScale',
      lat: 35.4,
      lon: 140.3,
      depth: 70,
      mag: 4.6,
      name: '千葉県東方沖',
      maxScale: 30,
      points: [
        ['千葉県', '旭市', 30],
        ['千葉県', '千葉市中央区', 20],
        ['東京都', '千代田区', 10],
      ],
    }),
    quake({
      id: 'demo-q-005',
      origin: startAt - 96 * 3600_000,
      issue: startAt - 96 * 3600_000 + 160_000,
      type: 'DetailScale',
      lat: 43.1,
      lon: 145.6,
      depth: 60,
      mag: 5.0,
      name: '釧路沖',
      maxScale: 30,
      points: [
        ['北海道', '釧路市', 30],
        ['北海道', '根室市', 20],
      ],
    }),
  ];
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

const HISTORICAL_LABEL = '過去の地震情報を読み込む';

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'normal',
    label: '平常時',
    summary: 'EEW なし。直近の地震情報のみが流れ、地図に履歴マーカーが並びます。',
    durationMs: 12_000,
    steps: [
      { at: 0, connection: 'connecting', label: '接続を開始' },
      { at: 900, connection: 'live', label: 'ライブ接続（デモ）' },
      {
        at: 1_200,
        label: '地震情報を3件受信',
        items: historicalSet(Date.now()).slice(0, 3),
      },
      { at: 5_000, label: '追加の地震情報を受信', items: historicalSet(Date.now()).slice(3) },
      { at: 12_000, label: '平常時のシナリオ終了' },
    ],
  },
  {
    id: 'forecast',
    label: 'EEW 予報',
    summary:
      '緊急地震速報（予報）: 警報対象区域が無いため「予報」として表示します。警報として扱ってはいけません。',
    durationMs: 26_000,
    steps: [
      { at: 0, connection: 'connecting', label: '接続を開始' },
      { at: 600, connection: 'live', label: 'ライブ接続（デモ）' },
      {
        at: 1_000,
        label: 'EEW 予報 第1報（対象区域なし）',
        items: [
          eew(
            {
              id: 'demo-eew-f1',
              eventId: 'demo-eew-event-forecast',
              serial: 1,
              origin: Date.now(),
              issued: Date.now() + 2_000,
              lat: 36.4,
              lon: 141.2,
              depth: 30,
              mag: 5.1,
              name: '茨城県沖',
            },
            Date.now(),
          ),
        ],
      },
      { at: 26_000, label: '予報の有効期限が切れ、平常表示へ' },
    ],
  },
  {
    id: 'warning',
    label: 'EEW 警報',
    summary: '緊急地震速報（警報）第1報。予測最大震度と対象予報区を表示します。',
    durationMs: 30_000,
    steps: [
      { at: 0, connection: 'connecting', label: '接続を開始' },
      { at: 500, connection: 'live', label: 'ライブ接続（デモ）' },
      {
        at: 1_000,
        label: 'EEW 警報 第1報',
        items: [
          eew(
            {
              id: 'demo-eew-w1',
              eventId: 'demo-eew-event-warning',
              serial: 1,
              origin: Date.now(),
              issued: Date.now() + 1_500,
              lat: 35.9,
              lon: 140.6,
              depth: 40,
              mag: 6.1,
              name: '茨城県南部',
              areas: [
                ['茨城県', '茨城県南部', 45, 55, '10', 8_000],
                ['栃木県', '栃木県南部', 40, 50, '10', 12_000],
                ['埼玉県', '埼玉県北部', 40, 45, '10', 16_000],
                ['東京都', '東京都２３区', 30, 45, '11', 20_000],
              ],
            },
            Date.now(),
          ),
        ],
      },
      { at: 30_000, label: 'シナリオ終了' },
    ],
  },
  {
    id: 'updated',
    label: 'EEW 続報',
    summary: '第1報 → 第2報 → 第3報。予測震度とマグニチュードが更新される流れを再現します。',
    durationMs: 34_000,
    steps: [
      { at: 0, connection: 'connecting', label: '接続を開始' },
      { at: 500, connection: 'live', label: 'ライブ接続（デモ）' },
      {
        at: 1_000,
        label: '第1報',
        items: [
          eew(
            {
              id: 'demo-eew-u1',
              eventId: 'demo-eew-event-updated',
              serial: 1,
              origin: Date.now(),
              issued: Date.now() + 1_000,
              lat: 35.6,
              lon: 139.8,
              depth: 60,
              mag: 5.6,
              name: '東京湾',
              areas: [
                ['東京都', '東京都２３区', 30, 45, '10', 6_000],
                ['神奈川県', '東部', 30, 45, '10', 9_000],
              ],
            },
            Date.now(),
          ),
        ],
      },
      {
        at: 6_000,
        label: '第2報（M 更新 / 震度上限が上昇）',
        items: [
          eew(
            {
              id: 'demo-eew-u2',
              eventId: 'demo-eew-event-updated',
              serial: 2,
              origin: Date.now(),
              issued: Date.now() + 6_000,
              lat: 35.6,
              lon: 139.8,
              depth: 55,
              mag: 5.9,
              name: '東京湾',
              areas: [
                ['東京都', '東京都２３区', 40, 50, '10', 7_000],
                ['神奈川県', '東部', 40, 50, '11', 11_000],
                ['千葉県', '千葉県北西部', 40, 45, '11', 13_000],
              ],
            },
            Date.now(),
          ),
        ],
      },
      {
        at: 12_000,
        label: '第3報（PLUM法・到達予想なしの区域を追加）',
        items: [
          eew(
            {
              id: 'demo-eew-u3',
              eventId: 'demo-eew-event-updated',
              serial: 3,
              origin: Date.now(),
              issued: Date.now() + 12_000,
              lat: 35.6,
              lon: 139.9,
              depth: 50,
              mag: 6.0,
              name: '東京湾',
              areas: [
                ['東京都', '東京都２３区', 45, 50, '11', 8_000],
                ['神奈川県', '東部', 45, 55, '11', 9_500],
                ['千葉県', '千葉県北西部', 40, 50, '11', 11_000],
                ['埼玉県', '埼玉県南部', 30, 45, '19', undefined],
              ],
            },
            Date.now(),
          ),
        ],
      },
      { at: 34_000, label: 'シナリオ終了' },
    ],
  },
  {
    id: 'cancelled',
    label: 'EEW 取消',
    summary: '警報発表後に取消電文を受信する流れ。取消は「揺れが無い」ことを意味しません。',
    durationMs: 30_000,
    steps: [
      { at: 0, connection: 'live', label: 'ライブ接続（デモ）' },
      {
        at: 800,
        label: 'EEW 警報 第1報',
        items: [
          eew(
            {
              id: 'demo-eew-c1',
              eventId: 'demo-eew-event-cancel',
              serial: 1,
              origin: Date.now(),
              issued: Date.now() + 1_000,
              lat: 33.2,
              lon: 132.4,
              depth: 30,
              mag: 4.2,
              name: '豊後水道',
              areas: [['愛媛県', '愛媛県南予', 40, 45, '10', 12_000]],
            },
            Date.now(),
          ),
        ],
      },
      {
        at: 8_000,
        label: '取消電文を受信',
        items: [
          eew(
            {
              id: 'demo-eew-c2',
              eventId: 'demo-eew-event-cancel',
              serial: 2,
              origin: Date.now(),
              issued: Date.now() + 8_000,
              lat: 33.2,
              lon: 132.4,
              depth: 30,
              mag: 4.2,
              name: '豊後水道',
              cancelled: true,
            },
            Date.now(),
          ),
        ],
      },
      { at: 30_000, label: 'シナリオ終了' },
    ],
  },
  {
    id: 'historical',
    label: HISTORICAL_LABEL,
    summary: '震度速報 → 詳細情報への更新を含む履歴。速報段階は「暫定」と明示されます。',
    durationMs: 22_000,
    steps: [
      { at: 0, connection: 'live', label: 'ライブ接続（デモ）' },
      { at: 700, label: '過去の地震情報を5件読み込み', items: historicalSet(Date.now()) },
      {
        at: 6_000,
        label: '震度速報（暫定・震源未確定）',
        items: [
          quake({
            id: 'demo-q-live-1',
            origin: Date.now() - 90_000,
            issue: Date.now() - 60_000,
            type: 'ScalePrompt',
            lat: -200,
            lon: -200,
            depth: -1,
            mag: -1,
            name: '',
            maxScale: 30,
            points: [['宮城県', '仙台市青葉区', 30]],
          }),
        ],
      },
      {
        at: 11_000,
        label: '震源情報（震源確定）',
        items: [
          quake({
            id: 'demo-q-live-2',
            origin: Date.now() - 90_000,
            issue: Date.now() - 40_000,
            type: 'Destination',
            lat: 38.0,
            lon: 142.3,
            depth: 50,
            mag: 4.9,
            name: '宮城県沖',
            maxScale: 30,
            points: [['宮城県', '仙台市青葉区', 30]],
          }),
        ],
      },
      {
        at: 16_000,
        label: '各地の震度（詳細）',
        items: [
          quake({
            id: 'demo-q-live-3',
            origin: Date.now() - 90_000,
            issue: Date.now() - 20_000,
            type: 'DetailScale',
            lat: 38.0,
            lon: 142.3,
            depth: 50,
            mag: 4.9,
            name: '宮城県沖',
            maxScale: 40,
            points: [
              ['宮城県', '仙台市青葉区', 40],
              ['宮城県', '石巻市', 30],
              ['岩手県', '一関市', 30],
              ['福島県', '新地町', 20],
            ],
          }),
        ],
      },
      { at: 22_000, label: 'シナリオ終了' },
    ],
  },
  {
    id: 'disconnect',
    label: '通信断 → 復旧',
    summary: '接続断を検知し「オフライン」を明示、復旧後にデータを再取得します。',
    durationMs: 30_000,
    steps: [
      { at: 0, connection: 'live', label: 'ライブ接続（デモ）' },
      { at: 700, label: '地震情報を2件受信', items: historicalSet(Date.now()).slice(0, 2) },
      { at: 5_000, connection: 'offline', error: 'ネットワークに接続できません（デモ）', label: '通信断' },
      { at: 9_000, connection: 'offline', label: '再試行中…' },
      { at: 16_000, connection: 'live', label: '復旧', items: historicalSet(Date.now()).slice(0, 4) },
      { at: 30_000, label: 'シナリオ終了' },
    ],
  },
  {
    id: 'stale',
    label: '情報の停滞',
    summary: 'データが更新されない状態。アプリは「情報が古い」と明示し、ライブと誤認させません。',
    durationMs: 40_000,
    steps: [
      { at: 0, connection: 'live', label: 'ライブ接続（デモ）' },
      { at: 700, label: '地震情報を2件受信', items: historicalSet(Date.now()).slice(0, 2) },
      { at: 8_000, connection: 'stale', label: '更新が停止（stale）' },
      { at: 40_000, label: 'シナリオ終了' },
    ],
  },
  {
    id: 'unavailable',
    label: 'データ欠損',
    summary: '壊れたレコード・空応答を混在させ、不正データを捨てて表示を維持することを確認します。',
    durationMs: 24_000,
    steps: [
      { at: 0, connection: 'live', label: 'ライブ接続（デモ）' },
      { at: 600, label: '正常な地震情報', items: historicalSet(Date.now()).slice(0, 1) },
      {
        at: 4_000,
        label: '破損レコード混入（code 551 だが必須項目なし / 不正な座標）',
        items: [
          { code: 551, id: 'demo-broken-1' },
          {
            code: 551,
            id: 'demo-broken-2',
            time: 'not-a-date',
            issue: { type: 'ScalePrompt' },
            earthquake: { time: 'nope', hypocenter: { latitude: -200, longitude: -200 } },
          },
          quake({
            id: 'demo-q-missing-eew',
            origin: Date.now() - 3_600_000,
            issue: Date.now() - 3_540_000,
            type: 'DetailScale',
            lat: 34.1,
            lon: 135.2,
            depth: 30,
            mag: 3.5,
            name: '和歌山県北部',
            maxScale: 20,
            points: [['和歌山県', '和歌山市', 20]],
          }),
        ],
      },
      { at: 12_000, label: '空応答（データなし）', items: [] },
      { at: 24_000, label: 'シナリオ終了' },
    ],
  },
];

export function getScenario(id: string): DemoScenario | null {
  return DEMO_SCENARIOS.find((s) => s.id === id) ?? null;
}
