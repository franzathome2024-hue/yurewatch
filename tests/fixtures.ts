/**
 * Fixtures shaped exactly like p2pquake JSON API v2 responses (spec 2.3.0).
 * These are illustrative values, not real events.
 */

export const quakeDetail = {
  code: 551,
  id: 'fixture-quake-detail',
  time: '2026/10/22 07:48:36.23',
  issue: { source: '気象庁', time: '2026/10/22 07:48:35', type: 'DetailScale', correct: 'None' },
  earthquake: {
    time: '2026/10/22 07:45:00',
    hypocenter: { name: '熊本県熊本地方', latitude: 32.4, longitude: 130.6, depth: 10, magnitude: 2.9 },
    maxScale: 10,
    domesticTsunami: 'None',
    foreignTsunami: 'Unknown',
  },
  points: [{ addr: '五木村甲', isArea: false, pref: '熊本県', scale: 10 }],
};

export const quakeScalePrompt = {
  code: 551,
  id: 'fixture-quake-prompt',
  time: '2026/10/22 07:45:20.00',
  issue: { source: '気象庁', time: '2026/10/22 07:45:18', type: 'ScalePrompt', correct: 'None' },
  earthquake: {
    time: '2026/10/22 07:45:00',
    maxScale: 30,
    domesticTsunami: 'Unknown',
  },
  points: [{ addr: '仙台市青葉区', isArea: false, pref: '宮城県', scale: 30 }],
};

export const eewWarning = {
  code: 556,
  id: 'fixture-eew-1',
  time: '2026/10/22 07:45:02.10',
  test: false,
  cancelled: false,
  earthquake: {
    originTime: '2026/10/22 07:45:00',
    arrivalTime: '2026/10/22 07:45:01',
    hypocenter: {
      name: '茨城県南部',
      reduceName: '茨城県南部',
      latitude: 35.9,
      longitude: 140.6,
      depth: 40,
      magnitude: 6.1,
    },
  },
  issue: { time: '2026/10/22 07:45:01', eventId: '20261022074500', serial: '1' },
  areas: [
    { pref: '茨城県', name: '茨城県南部', scaleFrom: 45, scaleTo: 55, kindCode: '10', arrivalTime: '2026/10/22 07:45:12' },
    { pref: '栃木県', name: '栃木県南部', scaleFrom: 40, scaleTo: 50, kindCode: '10', arrivalTime: null },
    { pref: '東京都', name: '東京都２３区', scaleFrom: 30, scaleTo: 45, kindCode: '11', arrivalTime: '2026/10/22 07:45:30' },
  ],
};

export const eewForecast = {
  code: 556,
  id: 'fixture-eew-forecast',
  time: '2026/10/22 07:45:02.10',
  test: false,
  cancelled: false,
  earthquake: {
    originTime: '2026/10/22 07:45:00',
    arrivalTime: '2026/10/22 07:45:01',
    hypocenter: { name: '茨城県沖', latitude: 36.4, longitude: 141.2, depth: 30, magnitude: 5.1 },
  },
  issue: { time: '2026/10/22 07:45:01', eventId: '20261022074501', serial: '1' },
  areas: [],
};

export const eewCancelled = {
  code: 556,
  id: 'fixture-eew-cancel',
  time: '2026/10/22 07:48:02.10',
  cancelled: true,
  earthquake: null,
  issue: { time: '2026/10/22 07:48:01', eventId: '20261022074500', serial: '4' },
  areas: [],
};

export const tsunamiWatch = {
  code: 552,
  id: 'fixture-tsunami-1',
  time: '2026/10/22 07:55:00.00',
  cancelled: false,
  issue: { source: '気象庁', time: '2026/10/22 07:55:00', type: 'Focus' },
  areas: [
    {
      grade: 'Watch',
      name: '宮城県',
      immediate: false,
      firstHeight: { arrivalTime: '2026/10/22 08:10:00', condition: '津波到達中と推測' },
      maxHeight: { description: '１ｍ', value: 1 },
    },
  ],
};
