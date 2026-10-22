import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EarthquakeEvent } from '../src/core/models';
import { parseEarthquake, parseEew } from '../src/sources/p2pquake/parse';
import { initialState, reduce, type AppState } from '../src/state/store';
import { createAlertPanel } from '../src/ui/alertPanel';
import { createDetails } from '../src/ui/details';
import { createEventList } from '../src/ui/eventList';
import { createHeader } from '../src/ui/header';
import { eewCancelled, eewForecast, eewWarning, quakeDetail } from './fixtures';

const T = Date.parse('2026-10-22T07:50:00Z');

function stateWith(patch: (s: AppState) => AppState): AppState {
  return patch(initialState('live', T));
}

function withEvents(events: EarthquakeEvent[]): AppState {
  return stateWith((s) =>
    reduce(s, { type: 'batch', events, eews: [], tsunami: null, at: T, rejected: 0 }),
  );
}

const quakeEvent = (() => {
  const r = parseEarthquake(quakeDetail, T);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
})();

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('alert panel', () => {
  it('shows a compact, truthful standby strip when there is no alert', () => {
    const panel = createAlertPanel();
    panel.update(initialState('live', T));
    // The visible strip is one line; the full sentence stays for screen readers.
    expect(panel.el.querySelector('.strip')?.textContent).toContain('受信なし');
    expect(panel.el.querySelector('.strip')?.textContent).toContain('緊急地震速報');
    expect(panel.el.querySelector('.srOnly')?.textContent).toContain('緊急地震速報は発表されていません');
    expect(panel.el.dataset.state).toBe('idle');
    // No fabricated green "all clear" and no giant empty card.
    expect(panel.el.querySelectorAll('.banner__body').length).toBe(0);
  });

  it('does not claim "no alert" while offline', () => {
    const panel = createAlertPanel();
    const state = stateWith((s) => reduce(s, { type: 'connection', state: 'offline', at: T }));
    panel.update(state);
    expect(panel.el.textContent).toContain('確認できません');
    expect(panel.el.textContent).not.toContain('発表されていません');
  });

  it('renders a warning with predicted intensity, epicentre and areas', () => {
    const parsed = parseEew(eewWarning, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    const panel = createAlertPanel();
    panel.update(stateWith((s) => reduce(s, { type: 'batch', events: [], eews: [parsed.value], tsunami: null, at: T, rejected: 0 })));
    const text = panel.el.textContent ?? '';
    expect(text).toContain('緊急地震速報（警報）');
    expect(text).toContain('予測最大震度');
    expect(text).toContain('6弱'); // scaleTo 55
    expect(text).toContain('茨城県南部');
    expect(text).toContain('現在地の到達時刻ではありません');
    expect(text).toContain('予測には誤差があり');
    expect(panel.el.dataset.state).toBe('warning');
  });

  it('labels a forecast as a forecast and never as a warning', () => {
    const parsed = parseEew(eewForecast, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    const panel = createAlertPanel();
    panel.update(stateWith((s) => reduce(s, { type: 'batch', events: [], eews: [parsed.value], tsunami: null, at: T, rejected: 0 })));
    const text = panel.el.textContent ?? '';
    expect(text).toContain('緊急地震速報（予報）');
    expect(text).not.toContain('緊急地震速報（警報）');
    expect(text).toContain('警報対象区域が含まれていません');
    expect(panel.el.classList.contains('alert--forecast')).toBe(true);
  });

  it('shows cancellation wording that does not imply safety', () => {
    let state = stateWith((s) =>
      reduce(s, {
        type: 'batch',
        events: [],
        eews: [parseEew(eewWarning, T).ok ? (parseEew(eewWarning, T) as { value: import('../src/core/models').EewAlert }).value : (() => { throw new Error('bad fixture'); })()],
        tsunami: null,
        at: T,
        rejected: 0,
      }),
    );
    const cancel = parseEew(eewCancelled, T + 60_000);
    if (!cancel.ok) throw new Error(cancel.reason);
    state = reduce(state, { type: 'batch', events: [], eews: [cancel.value], tsunami: null, at: T + 60_000, rejected: 0 });
    const panel = createAlertPanel();
    panel.update(state);
    const text = panel.el.textContent ?? '';
    expect(text).toContain('取消');
    expect(text).toContain('揺れが無かった」ことを意味しません');
  });

  it('marks simulated alerts as SIMULATION', () => {
    const parsed = parseEew(eewWarning, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    const sim = { ...parsed.value, simulated: true };
    const panel = createAlertPanel();
    panel.update(stateWith((s) => reduce(s, { type: 'batch', events: [], eews: [sim], tsunami: null, at: T, rejected: 0 })));
    expect(panel.el.textContent).toContain('SIMULATION');
    expect(panel.el.textContent).toContain('実際の地震情報ではありません');
    expect(panel.el.classList.contains('alert--sim')).toBe(true);
  });

  it('calls out a provisional hypocentre', () => {
    const parsed = parseEew(eewWarning, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    const provisional = {
      ...parsed.value,
      epicenter: { ...parsed.value.epicenter!, provisional: true },
    };
    const panel = createAlertPanel();
    panel.update(stateWith((s) => reduce(s, { type: 'batch', events: [], eews: [provisional], tsunami: null, at: T, rejected: 0 })));
    expect(panel.el.textContent).toContain('仮定震源要素');
  });
});

describe('event list', () => {
  it('renders one row per event with intensity, name and magnitude', () => {
    const list = createEventList({ onSelect: () => {} });
    list.update(withEvents([quakeEvent]));
    const text = list.el.textContent ?? '';
    expect(text).toContain('熊本県熊本地方');
    expect(text).toContain('M2.9');
    expect(text).toContain('深さ10km');
    expect(list.el.querySelectorAll('.feed__item')).toHaveLength(1);
  });

  it('fires the selection callback with the event id', () => {
    const onSelect = vi.fn();
    const list = createEventList({ onSelect });
    list.update(withEvents([quakeEvent]));
    (list.el.querySelector('.feed__button') as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith(quakeEvent.id);
  });

  it('marks the selected row', () => {
    const list = createEventList({ onSelect: () => {} });
    list.update(stateWith((s) => reduce(withEvents([quakeEvent]), { type: 'select', id: quakeEvent.id })));
    expect(list.el.querySelector('.feed__item')?.classList.contains('is-selected')).toBe(true);
  });

  it('explains an empty feed instead of showing nothing', () => {
    const list = createEventList({ onSelect: () => {} });
    list.update(initialState('live', T));
    expect(list.el.textContent).toContain('地震情報がまだありません');
  });
});

describe('details panel', () => {
  it('shows the selected event with observations and provenance', () => {
    const details = createDetails({ onClose: () => {} });
    details.update(stateWith((s) => reduce(withEvents([quakeEvent]), { type: 'select', id: quakeEvent.id })));
    const text = details.el.textContent ?? '';
    expect(text).toContain('最大震度');
    expect(text).toContain('マグニチュード');
    expect(text).toContain('M2.9');
    expect(text).toContain('各地の震度');
    expect(text).toContain('五木村甲');
    expect(text).toContain('気象庁');
    expect(text).toContain('この地震による津波の心配はありません');
  });

  it('asks for a selection when nothing is chosen', () => {
    const details = createDetails({ onClose: () => {} });
    details.update(initialState('live', T));
    expect(details.el.textContent).toContain('地震を選択してください');
  });

  it('flags preliminary reports', () => {
    const prompt = parseEarthquake(
      {
        ...quakeDetail,
        id: 'prompt',
        issue: { ...quakeDetail.issue, type: 'ScalePrompt' },
        earthquake: { ...quakeDetail.earthquake, time: '2026/10/22 07:44:00' },
      },
      T,
    );
    if (!prompt.ok) throw new Error(prompt.reason);
    const details = createDetails({ onClose: () => {} });
    details.update(stateWith((s) => reduce(withEvents([prompt.value]), { type: 'select', id: prompt.value.id })));
    expect(details.el.textContent).toContain('暫定情報');
  });
});

describe('header', () => {
  it('distinguishes live from demo mode', () => {
    const header = createHeader();
    const live = reduce(initialState('live', T), { type: 'connection', state: 'live', at: T });
    header.update(live);
    expect(header.el.textContent).toContain('ライブ接続');
    expect(header.el.textContent).not.toContain('デモ');
    const demoState = reduce(initialState('demo', T), { type: 'connection', state: 'demo', at: T });
    header.update({ ...demoState, mode: 'demo' });
    expect(header.el.textContent).toContain('デモ');
  });

  it('surfaces connection problems', () => {
    const header = createHeader();
    const state = stateWith((s) => reduce(s, { type: 'connection', state: 'offline', at: T }));
    header.update(state);
    expect(header.el.textContent).toContain('オフライン');
  });
});
