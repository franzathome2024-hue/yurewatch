import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEarthquake, parseEew } from '../src/sources/p2pquake/parse';
import {
  Store,
  effectiveFreshness,
  freshnessOf,
  initialState,
  reduce,
  type AppState,
} from '../src/state/store';
import { App } from '../src/ui/app';
import { createLegend, createInfoPanel } from '../src/ui/sections';
import { __resetI18nForTests, setLocale } from '../src/i18n';
import { eewWarning, quakeDetail } from './fixtures';

const T = Date.parse('2026-10-22T07:50:00Z');

const quakeEvent = (() => {
  const r = parseEarthquake(quakeDetail, T);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
})();

const eewAlert = (raw: unknown) => {
  const r = parseEew(raw, T);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

function boot(patch: (s: AppState) => AppState = (s) => s): { store: Store; app: App; state: AppState } {
  const store = new Store(patch(initialState('live', T)));
  const app = new App(store, {
    onSelectEvent: (id) => store.dispatch({ type: 'select', id }),
    onDemoStart: () => {},
    onDemoStop: () => {},
    onExportState: () => {},
    onToggleSound: () => {},
    onToggleTsunamiLayer: () => {},
    onRecenter: () => {},
  onFrameToggle: () => {},
    onZoom: () => {},
  });
  document.body.innerHTML = '';
  app.mount(document.body);
  const state = store.get();
  app.update(state);
  return { store, app, state };
}

beforeEach(() => {
  __resetI18nForTests('ja');
  document.body.innerHTML = '';
  // jsdom has no canvas backend; the shell is expected to survive that (it shows
  // the map fallback), so swallow the not-implemented call instead of logging it.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

describe('application shell', () => {
  it('mounts the monitoring screen: header, status strip, alert strip, map, sidebar', () => {
    const { app } = boot();
    expect(app.root.querySelector('.hdr')).not.toBeNull();
    expect(app.root.querySelector('.statusStrip')).not.toBeNull();
    expect(app.root.querySelector('.alert .strip')).not.toBeNull();
    expect(app.root.querySelector('.mapPane')).not.toBeNull();
    expect(app.root.querySelector('.side')).not.toBeNull();
    // The map is not a decorative placeholder: it owns a canvas.
    expect(app.root.querySelector('.map__canvas')).not.toBeNull();
  });

  it('collapses and re-expands the docked sidebar from its tab-bar toggle', () => {
    const { app } = boot();
    const toggle = app.root.querySelector<HTMLButtonElement>('.sideToggle');
    expect(toggle).not.toBeNull();
    expect(app.root.dataset.side).toBe('open');
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');

    toggle!.click();
    expect(app.root.dataset.side).toBe('collapsed');
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(toggle!.getAttribute('aria-label')).toBe('サイドバーを開く');

    toggle!.click();
    expect(app.root.dataset.side).toBe('open');
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
  });

  it('reveals the sidebar again when a view is requested while collapsed', () => {
    const { app } = boot();
    app.root.querySelector<HTMLButtonElement>('.sideToggle')!.click();
    expect(app.root.dataset.side).toBe('collapsed');
    app.setView('detail');
    expect(app.root.dataset.side).toBe('open');
    expect(app.root.dataset.view).toBe('detail');
  });

  it('exposes the three sidebar views and switches between them', () => {
    const { app } = boot();
    const tabs = Array.from(app.root.querySelectorAll<HTMLButtonElement>('.sideTab'));
    expect(tabs.map((t) => t.dataset.view)).toEqual(['list', 'detail', 'info']);
    expect(app.root.dataset.view).toBe('list');

    app.setView('info');
    expect(app.root.dataset.view).toBe('info');
    expect(app.root.querySelector('[data-view="info"]')?.getAttribute('aria-selected')).toBe('true');
    expect(app.root.querySelector('[data-panel="list"]')?.hasAttribute('hidden')).toBe(true);
    expect(app.root.querySelector('[data-panel="info"]')?.hasAttribute('hidden')).toBe(false);

    app.setView('detail');
    expect(app.root.querySelector('[data-panel="detail"]')?.hasAttribute('hidden')).toBe(false);
  });

  it('collapses and expands the phone sheet without losing the selection', () => {
    const state = reduce(
      reduce(initialState('live', T), {
        type: 'batch',
        events: [quakeEvent],
        eews: [],
        tsunami: null,
        at: T,
        rejected: 0,
      }),
      { type: 'select', id: quakeEvent.id },
    );
    const store = new Store(initialState('live', T));
    const app = new App(store, {
      onSelectEvent: () => {},
      onDemoStart: () => {},
      onDemoStop: () => {},
      onExportState: () => {},
      onToggleSound: () => {},
      onToggleTsunamiLayer: () => {},
      onRecenter: () => {},
  onFrameToggle: () => {},
      onZoom: () => {},
    });
    document.body.innerHTML = '';
    app.mount(document.body);
    app.update(state);

    const handle = app.root.querySelector<HTMLButtonElement>('.sheet__handle')!;
    expect(app.root.dataset.sheet).toBe('peek');
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    handle.click();
    expect(app.root.dataset.sheet).toBe('full');
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    // Selection survives the collapse/expand cycle.
    handle.click();
    app.update(state);
    expect(app.root.dataset.sheet).toBe('peek');
    expect(app.root.querySelector('.feed__item.is-selected')).not.toBeNull();
  });

  it('summarises the newest/selected event in the sheet peek line', () => {
    const { app } = boot((s) =>
      reduce(s, { type: 'batch', events: [quakeEvent], eews: [], tsunami: null, at: T, rejected: 0 }),
    );
    const peek = app.root.querySelector('.sheet__peekText')?.textContent ?? '';
    expect(peek).toContain('熊本県熊本地方');
    expect(peek).toContain('M2.9');
    expect(app.root.querySelector('.sheet__peekHint')?.textContent).toBe('タップして地震情報を開く');
  });

  it('states connection and freshness in the status strip, in words', () => {
    const { app } = boot((s) => reduce(s, { type: 'connection', state: 'offline', at: T }));
    const strip = app.root.querySelector('.statusStrip')?.textContent ?? '';
    // The strip names the consequence; the header names the connection state.
    expect(strip).toContain('データ取得不可');
    expect(app.root.querySelector('.hdr')?.textContent).toContain('オフライン');
    expect((app.root.querySelector('.conn') as HTMLElement).dataset.conn).toBe('offline');
  });

  it('marks the strip LIVE or DEMO without pretending a demo is a live feed', () => {
    const { app } = boot();
    expect(app.root.querySelector('.modeChip')?.textContent).toBe('LIVE');
    app.update({ ...initialState('demo', T), mode: 'demo' });
    expect(app.root.querySelector('.modeChip')?.textContent).toBe('DEMO');
    expect(app.root.querySelector('.simBanner')?.hasAttribute('hidden')).toBe(false);
  });

  it('keeps one SIMULATION marking: the banner replaces the map badge during a simulated alert', () => {
    // Documented in docs/UI.md but implemented only inside the <=900px media
    // query until Milestone 1, so desktop and tablet showed the floating map
    // banner, the banner's own SIMULATION badge and its footer line at once.
    const parsed = parseEew(eewWarning, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    const simulated = { ...parsed.value, simulated: true };

    const { app, store } = boot((s) => ({ ...s, mode: 'demo' }));
    expect(app.root.querySelector('.simBanner')?.hasAttribute('hidden')).toBe(false);

    store.dispatch({ type: 'batch', events: [], eews: [simulated], tsunami: null, at: T, rejected: 0 });
    app.update(store.get());
    
    // The alert banner still says it is a simulation; nothing else needs to.
    expect(app.root.querySelector('.alert')?.textContent).toContain('SIMULATION');
    expect(app.root.querySelectorAll('.simBanner:not([hidden])').length).toBe(0);

    store.dispatch({ type: 'dismiss-alert' });
    app.update(store.get());
    expect(app.root.querySelector('.simBanner')?.hasAttribute('hidden')).toBe(false);
  });

  it('switches the whole shell to English on a locale change', () => {
    const { app } = boot();
    expect(app.root.querySelector('.sideTab')?.textContent).toBe('最近の地震');
    setLocale('en');
    app.update(initialState('live', T));
    expect(app.root.querySelector('.sideTab')?.textContent).toBe('Recent earthquakes');
    expect(app.root.querySelector('.hdr__context')?.textContent).toBe('Japan earthquake monitoring');
    expect(app.root.querySelector('.statusStrip__mode')?.textContent ?? '').not.toContain('LIVE');
  });
});

describe('effective freshness', () => {
  it('does not call a stalled feed "fresh" just because data arrived recently', () => {
    let state = reduce(initialState('live', T), {
      type: 'batch',
      events: [],
      eews: [],
      tsunami: null,
      at: T,
      rejected: 0,
    });
    state = reduce(state, { type: 'connection', state: 'stale', at: T + 1_000 });
    const view = { ...state, now: T + 5_000 };
    // Age alone says "fresh"; the transport says updates stopped. The transport wins.
    expect(freshnessOf(view.health.lastSuccessAt, view.now)).toBe('fresh');
    expect(effectiveFreshness(view)).toBe('stale');
  });

  it('keeps "no data" honest when nothing has ever arrived', () => {
    const state = reduce(initialState('live', T), { type: 'connection', state: 'stale', at: T });
    expect(effectiveFreshness(state)).toBe('no-data');
  });

  it('keeps an offline feed from looking up to date', () => {
    let state = initialState('live', T);
    state = reduce(state, { type: 'batch', events: [], eews: [], tsunami: null, at: T, rejected: 0 });
    state = reduce(state, { type: 'connection', state: 'offline', at: T + 1_000 });
    expect(effectiveFreshness({ ...state, now: T + 2_000 })).toBe('stale');
  });

  it('reports a healthy connection as fresh', () => {
    let state = initialState('live', T);
    state = reduce(state, { type: 'batch', events: [], eews: [], tsunami: null, at: T, rejected: 0 });
    state = reduce(state, { type: 'connection', state: 'live', at: T + 1_000 });
    expect(effectiveFreshness({ ...state, now: T + 5_000 })).toBe('fresh');
  });
});

describe('alert strip vs banner', () => {
  it('uses a thin strip (not a giant card) when nothing is in effect', () => {
    const { app } = boot();
    expect(app.root.querySelector('.alert .strip')).not.toBeNull();
    expect(app.root.querySelector('.banner__head')).toBeNull();
  });

  it('never claims "no alert" when the source is offline', () => {
    const { app } = boot((s) => reduce(s, { type: 'connection', state: 'offline', at: T }));
    const alert = app.root.querySelector('.alert')!;
    expect((alert as HTMLElement).dataset.state).toBe('unavailable');
    expect(alert.textContent).toContain('状態不明');
    expect(alert.textContent).not.toContain('発表されていません');
  });

  it('expands to a banner with the classification first when a warning arrives', () => {
    const parsed = parseEew(eewWarning, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    const { app } = boot((s) =>
      reduce(s, { type: 'batch', events: [], eews: [parsed.value], tsunami: null, at: T, rejected: 0 }),
    );
    const head = app.root.querySelector('.banner__head')?.textContent ?? '';
    expect(head.startsWith('緊急地震速報（警報）')).toBe(true);
    expect(app.root.querySelector('.banner__scaleValue')?.textContent).toBe('6弱');
    expect(app.root.textContent).toContain('茨城県南部');
    // The alert switches the shell into its compact phone treatment.
    expect(app.root.classList.contains('app--alert')).toBe(true);
  });
});

describe('list header alignment', () => {
  it('describes the same columns the rows use', () => {
    const { app } = boot((s) =>
      reduce(s, { type: 'batch', events: [quakeEvent], eews: [], tsunami: null, at: T, rejected: 0 }),
    );
    const head = app.root.querySelector('.feed__head')!;
    const row = app.root.querySelector('.feed__button')!;
    // Scale column and gap must be identical; magnitude + count share one
    // right-aligned track so the labels cannot drift off their numbers.
    expect(head.children.length).toBe(3);
    expect(row.children.length).toBe(3);
    expect(head.querySelector('.feed__headRight')?.children.length).toBe(2);
  });
});

describe('legend', () => {
  it('is collapsed by default, opens on demand and explains shapes as well as colours', () => {
    const legend = createLegend();
    document.body.appendChild(legend.el);
    legend.update(initialState('live', T));
    const toggle = legend.el.querySelector<HTMLButtonElement>('.mapBtn--legend')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(legend.el.querySelector('.legend__panel')?.hasAttribute('hidden')).toBe(true);

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = legend.el.querySelector('.legend__panel')!;
    expect(panel.textContent).toContain('震度');
    expect(panel.textContent).toContain('EEW 震源');
    expect(panel.textContent).toContain('選択中の地震');
    // The tsunami forecast-region layer is explained, and NOT as a coastline.
    expect(panel.textContent).toContain('津波予報区');
    expect(panel.textContent).toContain('浸水想定区域ではありません');
    // Nine intensity steps plus four tsunami grades are named, not only coloured.
    expect(panel.querySelectorAll('.legend__swatchItem')).toHaveLength(9 + 4);
  });

  it('localizes the legend', () => {
    const legend = createLegend();
    document.body.appendChild(legend.el);
    legend.update(initialState('live', T));
    setLocale('en');
    legend.update(initialState('live', T));
    expect(legend.el.textContent).toContain('Map key');
    expect(legend.el.textContent).toContain('EEW epicenter');
  });
});

describe('info panel', () => {
  const mount = (handlers: Partial<Parameters<typeof createInfoPanel>[0]> = {}) => {
    const panel = createInfoPanel({
      onToggleSound: () => {},
      onToggleTsunamiLayer: () => {},
      onDemoStart: () => {},
      onDemoStop: () => {},
      onExport: () => {},
      ...handlers,
    });
    document.body.appendChild(panel.el);
    panel.update(initialState('live', T));
    return panel;
  };

  it('puts operational status first and developer tools last', () => {
    const panel = mount();
    const text = panel.el.textContent ?? '';
    const status = text.indexOf('接続とデータの鮮度');
    const dev = text.indexOf('開発者向け');
    const about = text.indexOf('このアプリについて');
    expect(status).toBeGreaterThan(-1);
    expect(dev).toBeGreaterThan(status);
    expect(about).toBeGreaterThan(dev);
  });

  it('offers language, sound and a clearly separated demo section', () => {
    const onToggleSound = vi.fn();
    const panel = mount({ onToggleSound });
    const langButtons = Array.from(panel.el.querySelectorAll('[data-locale]'));
    expect(langButtons.map((b) => b.textContent)).toEqual(['日本語', 'English']);
    expect(panel.el.textContent).toContain('SIMULATION');
    expect(panel.el.querySelectorAll('.demoItem').length).toBeGreaterThanOrEqual(9);

    const sound = Array.from(panel.el.querySelectorAll<HTMLButtonElement>('.segBtn')).find((b) =>
      b.textContent?.startsWith('OFF'),
    );
    sound?.click();
    expect(onToggleSound).toHaveBeenCalled();
  });

  it('reports the data provider and the last successful update', () => {
    const panel = mount();
    expect(panel.el.textContent).toContain('P2P地震情報');
    expect(panel.el.textContent).toContain('最終成功');
  });

  it('offers explicit sound and voice tests and reports their outcome inline', () => {
    const onTestSound = vi.fn(() => '音声の状態: running');
    const onTestVoice = vi.fn(() => 'テスト読み上げを送信しました');
    const panel = mount({ onTestSound, onTestVoice });
    const buttons = Array.from(panel.el.querySelectorAll<HTMLButtonElement>('.segBtn--test'));
    expect(buttons.map((b) => b.textContent)).toEqual(['音声テスト', '読み上げテスト']);
    buttons[0]?.click();
    expect(onTestSound).toHaveBeenCalledTimes(1);
    expect(panel.el.textContent).toContain('音声の状態: running');
    buttons[1]?.click();
    expect(onTestVoice).toHaveBeenCalledTimes(1);
    expect(panel.el.textContent).toContain('テスト読み上げを送信しました');
  });
});

describe('EEW monitor window', () => {
  it('sits at the map top-right in standby with honest placeholders; legend anchors bottom-left', () => {
    const { app } = boot();
    const win = app.root.querySelector('.eewWin');
    expect(win).not.toBeNull();
    expect(win?.getAttribute('data-map-anchor')).toBe('top-right');
    expect(win?.getAttribute('data-state')).toBe('standby');
    expect(win?.textContent).toContain('待機中');
    // Unavailable values are dashes, never invented numbers.
    expect(win?.textContent).toContain('---');
    expect(app.root.querySelector('.legend')?.getAttribute('data-map-anchor')).toBe('bottom-left');
  });

  it('shows warning state, predicted intensity and source arrival only', () => {
    const { app, store } = boot();
    store.dispatch({ type: 'batch', events: [], eews: [eewAlert(eewWarning)], tsunami: null, at: T, rejected: 0 });
    app.update(store.get());
    const win = app.root.querySelector('.eewWin');
    expect(win?.getAttribute('data-state')).toBe('warning');
    expect(win?.textContent).toContain('警報');
    expect(win?.textContent).toContain('茨城県南部');
    expect(win?.textContent).toContain('M6.1');
    // The fixture's earliest source-supplied arrival renders as a clock time.
    expect(win?.textContent).toContain('07:45');
  });

  it('labels test bulletins in the window', () => {
    const { app, store } = boot();
    store.dispatch({ type: 'batch', events: [], eews: [eewAlert({ ...eewWarning, test: true })], tsunami: null, at: T, rejected: 0 });
    app.update(store.get());
    const win = app.root.querySelector('.eewWin');
    expect(win?.textContent).toContain('訓練/試験');
  });
});
