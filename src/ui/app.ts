import { DARK_MAP_THEME } from '../map/theme';
import { geometry } from '../map/mapData';
import { MapView } from '../map/view';
import { ingestEvents, intensityByPrefecture } from '../state/events';
import { selectEvent, type AppState, type Store } from '../state/store';
import { createAlertPanel } from './alertPanel';
import { createDetails } from './details';
import { badge, el } from './dom';
import { createEventList } from './eventList';
import { createHeader } from './header';
import { createDemoPanel } from './demoPanel';
import { createLegend, createSections } from './sections';

export type MobileTab = 'feed' | 'detail' | 'info';

/**
 * Application shell. Owns layout and wiring; every component is a small
 * `{ el, update }` pair driven by a single immutable state object.
 */
export interface AppHandlers {
  onSelectEvent: (id: string | null) => void;
  onDemoStart: (id: string) => void;
  onDemoStop: () => void;
  onExportState: () => void;
  onToggleSound: () => void;
  onRecenter: () => void;
  onZoom: (factor: number) => void;
}

export class App {
  readonly root: HTMLElement;
  private header = createHeader();
  private alertPanel = createAlertPanel();
  private feed: ReturnType<typeof createEventList>;
  private details = createDetails({ onClose: () => this.handlers.onSelectEvent(null) });
  private sections = createSections();
  private legend = createLegend();
  private demoPanel: ReturnType<typeof createDemoPanel>;
  private map: MapView | null = null;
  private mapFallback: HTMLElement;
  private tabBar: HTMLElement;
  private simBanner: HTMLElement;
  private soundButton: HTMLButtonElement;
  private tab: MobileTab = 'feed';
  private rails: { left: HTMLElement; right: HTMLElement };
  private lastMapSignature = '';

  constructor(
    private store: Store,
    private handlers: AppHandlers,
  ) {
    this.feed = createEventList({ onSelect: (id) => handlers.onSelectEvent(id) });
    this.demoPanel = createDemoPanel({
      onStart: handlers.onDemoStart,
      onStop: handlers.onDemoStop,
      onExport: handlers.onExportState,
    });

    const canvas = el('canvas', {
      class: 'map__canvas',
      tabindex: '0',
      role: 'application',
      'aria-label': '日本地図。ドラッグで移動、ピンチまたはスクロールで拡大縮小。',
    });

    // Inline SVG icons rather than text glyphs: "⌖"/"＋" are missing from some
    // Android system fonts and render as tofu boxes.
    const icon = (path: string) =>
      el('span', { class: 'mapControls__icon', html: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>` });
    const controls = el('div', { class: 'mapControls' });
    const zoomIn = el('button', { class: 'mapControls__btn', type: 'button', 'aria-label': '拡大' },
      icon('<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'));
    const zoomOut = el('button', { class: 'mapControls__btn', type: 'button', 'aria-label': '縮小' },
      icon('<path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'));
    const recenter = el('button', { class: 'mapControls__btn', type: 'button', 'aria-label': '日本全体を表示' },
      icon(
        '<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
          '<path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      ));
    zoomIn.addEventListener('click', () => handlers.onZoom(1.35));
    zoomOut.addEventListener('click', () => handlers.onZoom(1 / 1.35));
    recenter.addEventListener('click', () => handlers.onRecenter());
    controls.append(zoomIn, zoomOut, recenter);

    this.mapFallback = el('div', { class: 'map__fallback', hidden: 'hidden' });

    this.simBanner = el('div', { class: 'simBanner', hidden: 'hidden' },
      badge('SIMULATION', 'sim'),
      el('span', { text: '表示中のデータはすべて模擬データです。実際の地震情報ではありません。' }),
    );

    const mapWrap = el('section', { class: 'map' },
      canvas,
      el('div', { class: 'map__vignette', 'aria-hidden': 'true' }),
      this.simBanner,
      controls,
      this.legend.el,
      this.mapFallback,
    );

    // Map is created after the element is in the document so it can measure.
    requestAnimationFrame(() => {
      try {
        this.map = new MapView(mapWrap, canvas as HTMLCanvasElement, DARK_MAP_THEME, {
          onSelectEvent: (id) => handlers.onSelectEvent(id),
          onError: (message) => this.showMapError(message),
        });
        this.pushMapState(this.store.get());
      } catch (err) {
        this.showMapError(`地図の初期化に失敗しました: ${String(err)}`);
      }
    });

    const leftRail = el('aside', { class: 'rail rail--left', 'data-rail': 'feed' },
      this.feed.el,
      this.demoPanel.el,
    );
    const rightRail = el('aside', { class: 'rail rail--right', 'data-rail': 'detail' },
      this.details.el,
      this.sections.el,
    );
    this.rails = { left: leftRail, right: rightRail };

    this.tabBar = el('nav', { class: 'tabbar', 'aria-label': '表示切り替え' });
    const tabIcons: Record<MobileTab, string> = {
      feed: '<path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      detail:
        '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<circle cx="12" cy="12" r="2.4" fill="currentColor"/>',
      info:
        '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
        '<path d="M12 11v5.5M12 7.6v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    };
    const tabs: Array<[MobileTab, string]> = [
      ['feed', '地震情報'],
      ['detail', '詳細'],
      ['info', '情報'],
    ];
    for (const [id, label] of tabs) {
      const button = el('button', { class: 'tabbar__btn', type: 'button', 'data-tab': id },
        el('span', {
          class: 'tabbar__icon',
          'aria-hidden': 'true',
          html: `<svg viewBox="0 0 24 24">${tabIcons[id]}</svg>`,
        }),
        el('span', { class: 'tabbar__label', text: label }),
      );
      button.addEventListener('click', () => this.setTab(id));
      this.tabBar.appendChild(button);
    }

    this.soundButton = el('button', {
      class: 'footer__btn',
      type: 'button',
      'aria-pressed': 'false',
      text: '音声: OFF',
    });
    this.soundButton.addEventListener('click', () => handlers.onToggleSound());

    const footer = el('footer', { class: 'footer' },
      el('span', { class: 'footer__note', text: '情報閲覧アプリです。地震の予測・独自検出は行いません。必ず気象庁の発表と自治体の指示を確認してください。' }),
      el('span', { class: 'footer__spacer' }),
      this.soundButton,
      el('span', { class: 'footer__build', text: `v${__APP_VERSION__}` }),
    );

    this.root = el('div', { class: 'app', 'data-tab': this.tab },
      this.header.el,
      el('div', { class: 'alertSlot' }, this.alertPanel.el),
      el('main', { class: 'layout' }, leftRail, mapWrap, rightRail),
      this.tabBar,
      footer,
    );

    this.setTab('feed');
  }

  mount(target: HTMLElement): void {
    target.appendChild(this.root);
  }

  private showMapError(message: string): void {
    this.mapFallback.hidden = false;
    this.mapFallback.textContent = `${message} 一覧表示は引き続き利用できます。`;
  }

  setTab(tab: MobileTab): void {
    this.tab = tab;
    this.root.dataset.tab = tab;
    // Phones show one rail at a time. "情報" is the detail rail with the
    // event inspector hidden, so the disclosure sections get the space.
    this.rails.left.classList.toggle('rail--mobileActive', tab === 'feed');
    this.rails.right.classList.toggle('rail--mobileActive', tab === 'detail' || tab === 'info');
    for (const button of Array.from(this.tabBar.querySelectorAll<HTMLElement>('[data-tab]'))) {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'true' : 'false');
    }
  }

  update(state: AppState): void {
    this.header.update(state);
    this.alertPanel.update(state);
    this.feed.update(state);
    this.details.update(state);
    this.sections.update(state);
    this.demoPanel.update(state);

    const sim = state.mode === 'demo' || state.alert?.simulated === true || state.events.some((e) => e.simulated);
    this.simBanner.hidden = !sim;
    this.root.classList.toggle('app--sim', sim);

    this.soundButton.textContent = state.preferences.soundEnabled ? '音声: ON' : '音声: OFF';
    this.soundButton.setAttribute('aria-pressed', state.preferences.soundEnabled ? 'true' : 'false');
    this.soundButton.disabled = false;

    this.pushMapState(state);
  }

  private pushMapState(state: AppState): void {
    if (!this.map) return;
    const selected = selectEvent(state);
    const focus = selected ?? state.events[0] ?? null;
    const perPref = focus ? intensityByPrefecture([focus]) : new Map<string, number>();
    // Signature guards against rebuilding the scene on every 1 s tick.
    const signature = [
      state.events.map((e) => `${e.id}:${e.maxIntensity}:${e.revision}`).join(','),
      state.selectedEventId,
      state.alert ? `${state.alert.eventId}:${state.alert.serial}:${state.alert.state}` : 'none',
      focus?.id ?? 'none',
    ].join('|');
    if (signature === this.lastMapSignature) {
      // Only the clock changed: refresh so marker age fades stay accurate.
      this.map.update({
        geometry: geometry(),
        theme: DARK_MAP_THEME,
        events: state.events,
        selectedId: state.selectedEventId,
        alert: state.alert,
        intensityByPref: perPref,
        now: state.now,
      });
      return;
    }
    this.lastMapSignature = signature;
    this.map.update({
      geometry: geometry(),
      theme: DARK_MAP_THEME,
      events: state.events,
      selectedId: state.selectedEventId,
      alert: state.alert,
      intensityByPref: perPref,
      now: state.now,
    });
  }

  focusMapOn(lon: number, lat: number): void {
    this.map?.focusOn(lon, lat);
  }

  recenterMap(): void {
    this.map?.recenter();
  }

  zoomMap(factor: number): void {
    this.map?.zoomBy(factor);
  }

  setReduceMotion(value: boolean): void {
    this.map?.setReduceMotion(value);
  }

  /** Exported for the diagnostics export button. */
  static snapshot(state: AppState): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        mode: state.mode,
        health: state.health,
        diagnostics: state.diagnostics,
        alert: state.alert,
        events: state.events.slice(0, 10),
      },
      null,
      2,
    );
  }
}

/** Re-exported so tests can exercise the same reduction the UI uses. */
export { ingestEvents };
