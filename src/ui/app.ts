import { DARK_MAP_THEME } from '../map/theme';
import { geometry } from '../map/mapData';
import { MapView } from '../map/view';
import { formatJstClock } from '../core/time';
import { tsunamiGradeLabel } from '../core/format';
import { getLocaleVersion, t } from '../i18n';
import { ingestEvents, intensityByPrefecture } from '../state/events';
import { effectiveFreshness, freshnessLabel, selectEvent, type AppState, type Store } from '../state/store';
import { createAlertPanel } from './alertPanel';
import { createDetails } from './details';
import { badge, el } from './dom';
import { createEventList } from './eventList';
import { createHeader } from './header';
import { createInfoPanel } from './sections';
import { createLegend } from './sections';

export type SideView = 'list' | 'detail' | 'info';

export interface AppHandlers {
  onSelectEvent: (id: string | null) => void;
  onDemoStart: (id: string) => void;
  onDemoStop: () => void;
  onExportState: () => void;
  onToggleSound: () => void;
  onToggleTsunamiLayer: () => void;
  onToggleVoice?: () => void;
  describeVoice?: () => string;
  onRecenter: () => void;
  onZoom: (factor: number) => void;
}

const NARROW = '(max-width: 900px)';

/**
 * Application shell.
 *
 * Desktop: header · status strip · alert strip · [map | sidebar].
 * Phone:   header · status strip · alert strip · [map / bottom sheet].
 *
 * The map is the working surface at every size; everything else is either a thin
 * strip of status or a panel that can be dismissed. One state object drives every
 * component, so the map, the list and the detail panel cannot disagree about
 * what is selected.
 */
export class App {
  readonly root: HTMLElement;
  private header: ReturnType<typeof createHeader>;
  private alertPanel = createAlertPanel();
  private list: ReturnType<typeof createEventList>;
  private detail: ReturnType<typeof createDetails>;
  private info: ReturnType<typeof createInfoPanel>;
  private legend = createLegend();
  private map: MapView | null = null;
  private mapFallback: HTMLElement;
  private simBanner: HTMLElement;
  private simBannerText = el('span', { class: 'simBanner__text' });
  private side: HTMLElement;
  private sideTabs = new Map<SideView, HTMLButtonElement>();
  private sidePanels = new Map<SideView, HTMLElement>();
  private sheetToggle: HTMLButtonElement;
  private peekText: HTMLElement;
  private peekHint: HTMLElement;
  private statusSource = el('span', { class: 'statusStrip__source' });
  private statusFresh = el('span', { class: 'statusStrip__fresh' });
  private statusMode = el('span', { class: 'statusStrip__mode' });
  /** Tsunami state, visible without opening any panel while a bulletin is in force. */
  private tsunamiChip = el('button', { class: 'tsunamiChip', type: 'button' });
  private modeChip = el('span', { class: 'modeChip' });
  private mapButtons: { canvas: HTMLElement; zoomIn: HTMLElement; zoomOut: HTMLElement; recenter: HTMLElement } | null = null;
  private view: SideView = 'list';
  private sheetExpanded = false;
  private lastMapSignature = '';

  constructor(
    private store: Store,
    private handlers: AppHandlers,
  ) {
    this.header = createHeader({ onOpenInfo: () => this.setView('info') });
    this.list = createEventList({ onSelect: (id) => handlers.onSelectEvent(id) });
    this.detail = createDetails({ onClose: () => handlers.onSelectEvent(null) });
    this.info = createInfoPanel({
      onToggleSound: handlers.onToggleSound,
      onToggleTsunamiLayer: handlers.onToggleTsunamiLayer,
      onToggleVoice: handlers.onToggleVoice,
      describeVoice: handlers.describeVoice,
      onDemoStart: handlers.onDemoStart,
      onDemoStop: handlers.onDemoStop,
      onExport: handlers.onExportState,
    });

    /* ---------------------------------------------------------------- map -- */
    const canvas = el('canvas', {
      class: 'map__canvas',
      tabindex: '0',
      role: 'application',
      'aria-label': t('map.aria'),
    });

    const icon = (path: string) =>
      el('span', { class: 'mapBtn__icon', html: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>` });

    const zoomIn = el('button', { class: 'mapBtn', type: 'button', 'aria-label': t('map.zoomIn') },
      icon('<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'));
    const zoomOut = el('button', { class: 'mapBtn', type: 'button', 'aria-label': t('map.zoomOut') },
      icon('<path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'));
    const recenter = el('button', { class: 'mapBtn', type: 'button', 'aria-label': t('map.recenter') },
      icon(
        '<path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
          '<circle cx="12" cy="12" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7"/>',
      ));
    zoomIn.addEventListener('click', () => handlers.onZoom(1.35));
    zoomOut.addEventListener('click', () => handlers.onZoom(1 / 1.35));
    recenter.addEventListener('click', () => handlers.onRecenter());

    const controls = el('div', { class: 'mapControls', role: 'group' }, zoomIn, zoomOut, recenter);
    this.mapButtons = { canvas, zoomIn, zoomOut, recenter };

    this.mapFallback = el('div', { class: 'map__fallback', hidden: 'hidden' });

    this.simBanner = el('div', { class: 'simBanner', hidden: 'hidden' },
      badge(t('demo.simBadge'), 'sim'),
      this.simBannerText,
    );

    const mapPane = el('section', { class: 'mapPane' },
      canvas,
      this.simBanner,
      this.legend.el,
      controls,
      this.mapFallback,
    );

    requestAnimationFrame(() => {
      try {
        this.map = new MapView(mapPane, canvas as HTMLCanvasElement, DARK_MAP_THEME, {
          onSelectEvent: (id) => handlers.onSelectEvent(id),
          onError: (message) => this.showMapError(message),
        });
        this.pushMapState(this.store.get());
      } catch (err) {
        this.showMapError(t('map.error', { message: String(err) }));
      }
    });

    /* -------------------------------------------------------------- side -- */
    const tabs = el('nav', { class: 'sideTabs', role: 'tablist', 'aria-label': t('nav.label') });
    const views: SideView[] = ['list', 'detail', 'info'];
    for (const view of views) {
      const label = view === 'list' ? t('list.title') : view === 'detail' ? t('nav.detail') : t('nav.info');
      const button = el('button', {
        class: 'sideTab',
        type: 'button',
        role: 'tab',
        'data-view': view,
        'aria-selected': view === 'list' ? 'true' : 'false',
        text: label,
      });
      button.addEventListener('click', () => {
        this.setView(view);
        this.setSheetExpanded(true);
      });
      this.sideTabs.set(view, button);
      tabs.appendChild(button);
    }

    this.peekText = el('span', { class: 'sheet__peekText' });
    this.peekHint = el('span', { class: 'sheet__peekHint' });
    this.sheetToggle = el('button', {
      class: 'sheet__handle',
      type: 'button',
      'aria-expanded': 'false',
    },
      el('span', { class: 'sheet__grip', 'aria-hidden': 'true' }),
      el('span', { class: 'sheet__peekMain' }, this.peekText, this.peekHint),
      el('span', { class: 'sheet__chevron', 'aria-hidden': 'true', html:
        '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
    );
    this.sheetToggle.addEventListener('click', () => this.setSheetExpanded(!this.sheetExpanded));

    const sideBody = el('div', { class: 'sideBody' });
    for (const view of views) {
      const panel = el('div', { class: 'sidePanel', 'data-panel': view, role: 'tabpanel' },
        view === 'list' ? this.list.el : view === 'detail' ? this.detail.el : this.info.el,
      );
      this.sidePanels.set(view, panel);
      sideBody.appendChild(panel);
    }

    this.side = el('aside', { class: 'side', 'aria-label': t('sheet.label') },
      this.sheetToggle,
      tabs,
      sideBody,
    );

    /* ------------------------------------------------------------ status -- */
    const statusStrip = el('div', { class: 'statusStrip' },
      this.modeChip,
      this.statusSource,
      el('span', { class: 'statusStrip__dot', 'aria-hidden': 'true' }),
      this.statusFresh,
      this.tsunamiChip,
      el('span', { class: 'statusStrip__spacer' }),
      el('span', { class: 'statusStrip__clock', text: '' }),
    );

    const work = el('main', { class: 'work' }, mapPane, this.side);

    this.root = el('div', { class: 'app', 'data-view': 'list', 'data-sheet': 'peek' },
      this.header.el,
      statusStrip,
      el('div', { class: 'alertSlot' }, this.alertPanel.el),
      work,
    );

    this.tsunamiChip.hidden = true;
    this.tsunamiChip.addEventListener('click', () => {
      this.setView('info');
      this.setSheetExpanded(true);
    });

    this.setView('list');
    this.setSheetExpanded(false);
    // Desktop shows the detail panel under the list; entering the info view is a
    // deliberate navigation, so returning to the list keeps the selection.
    this.root.querySelector('.statusStrip__clock')!.textContent = '';
  }

  mount(target: HTMLElement): void {
    target.appendChild(this.root);
  }

  private showMapError(message: string): void {
    this.mapFallback.hidden = false;
    this.mapFallback.textContent = `${message} ${t('map.errorSuffix')}`;
  }

  getInfoPanel(): HTMLElement {
    return this.info.el;
  }

  setView(view: SideView): void {
    this.view = view;
    this.root.dataset.view = view;
    for (const [id, button] of this.sideTabs) {
      const active = id === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const [id, panel] of this.sidePanels) panel.hidden = id !== view;
  }

  private setSheetExpanded(expanded: boolean): void {
    this.sheetExpanded = expanded;
    this.root.dataset.sheet = expanded ? 'full' : 'peek';
    this.sheetToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    this.sheetToggle.setAttribute('aria-label', expanded ? t('sheet.collapse') : t('sheet.expand'));
  }

  update(state: AppState): void {
    /* ---- localised chrome ------------------------------------------- */
    this.simBannerText.textContent = t('sim.banner');
    this.legend.update(state);
    if (this.mapButtons) {
      this.mapButtons.canvas.setAttribute('aria-label', t('map.aria'));
      this.mapButtons.zoomIn.setAttribute('aria-label', t('map.zoomIn'));
      this.mapButtons.zoomOut.setAttribute('aria-label', t('map.zoomOut'));
      this.mapButtons.recenter.setAttribute('aria-label', t('map.recenter'));
    }
    this.side.setAttribute('aria-label', t('sheet.label'));
    for (const [view, button] of this.sideTabs) {
      button.textContent = view === 'list' ? t('list.title') : view === 'detail' ? t('nav.detail') : t('nav.info');
    }

    /* ---- components -------------------------------------------------- */
    this.header.update(state);
    this.alertPanel.update(state);
    this.list.update(state);
    this.detail.update(state);
    this.info.update(state);

    /* ---- status strip ------------------------------------------------ */
    const demo = state.mode === 'demo';
    this.modeChip.textContent = demo ? t('status.mode.demo') : t('status.mode.live');
    this.modeChip.dataset.mode = demo ? 'demo' : 'live';
    this.statusSource.textContent = demo ? t('diag.provider.demo') : t('status.source');
    const fresh = effectiveFreshness(state);
    this.statusFresh.textContent =
      state.health.lastSuccessAt !== null
        ? `${t('status.lastUpdate', { time: formatJstClock(state.health.lastSuccessAt) })} · ${freshnessLabel(fresh)}`
        : `${t('status.noData')} · ${freshnessLabel(fresh)}`;
    this.statusFresh.dataset.freshness = fresh;
    this.statusFresh.dataset.conn = state.health.state;

    /* ---- simulation marking ------------------------------------------ */
    const sim = demo || state.alert?.simulated === true || state.events.some((e) => e.simulated);
    this.simBanner.hidden = !sim;
    this.root.classList.toggle('app--sim', sim);
    // Drives the compact phone treatment: with a live alert the banner carries
    // the SIMULATION marking itself, so the map's duplicate badge is dropped and
    // the banner is tightened to keep the map usable.
    this.root.classList.toggle('app--alert', Boolean(state.alert));
    this.updateTsunamiChip(state);
    this.root.dataset.conn = state.health.state;

    /* ---- sheet summary ----------------------------------------------- */
    const selected = selectEvent(state);
    const peekEvent = selected ?? state.events[0] ?? null;
    if (peekEvent) {
      const magnitude = peekEvent.epicenter ? `M${peekEvent.epicenter.magnitude.toFixed(1)}` : '';
      this.peekText.textContent = t('sheet.peekSummary', {
        name: peekEvent.epicenter?.name ?? t('feed.name.unknown'),
        magnitude,
        time: formatJstClock(peekEvent.originTime ?? peekEvent.receivedAt),
      });
    } else {
      this.peekText.textContent = t('sheet.peekEmpty');
    }
    this.peekHint.textContent = this.sheetExpanded ? t('sheet.hintCollapse') : t('sheet.peekHint');
    if (this.sheetToggle) {
      this.sheetToggle.setAttribute('aria-label', this.sheetExpanded ? t('sheet.collapse') : t('sheet.expand'));
    }

    this.pushMapState(state);
  }

  /** Called by main.ts after a selection so the detail is visible on phones. */
  focusDetail(): void {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches) {
      this.setView('detail');
      this.setSheetExpanded(true);
    }
  }

  private pushMapState(state: AppState): void {
    if (!this.map) return;
    const selected = selectEvent(state);
    const focus = selected ?? state.events[0] ?? null;
    const perPref = focus ? intensityByPrefecture([focus]) : new Map<string, number>();
    const tsunamiSig = state.tsunami
      ? `${state.tsunami.id}:${state.tsunami.cancelled}:${state.tsunami.receivedAt}:${state.tsunami.areas
          .map((a) => `${a.name}/${a.grade}`)
          .join(',')}`
      : 'none';
    const signature = [
      state.events.map((e) => `${e.id}:${e.maxIntensity}:${e.revision}`).join(','),
      state.selectedEventId,
      state.alert ? `${state.alert.eventId}:${state.alert.serial}:${state.alert.state}` : 'none',
      focus?.id ?? 'none',
      tsunamiSig,
      String(state.preferences.tsunamiLayer),
      getLocaleVersion(),
    ].join('|');
    if (signature === this.lastMapSignature) {
      this.map.update({
        geometry: geometry(),
        theme: DARK_MAP_THEME,
        events: state.events,
        selectedId: state.selectedEventId,
        alert: state.alert,
        intensityByPref: perPref,
        tsunami: state.tsunami,
        tsunamiLayerVisible: state.preferences.tsunamiLayer,
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
      tsunami: state.tsunami,
      tsunamiLayerVisible: state.preferences.tsunamiLayer,
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

  /**
   * The status strip carries the tsunami state because a tsunami bulletin is not
   * an EEW and must not be squeezed into the EEW strip. It shows only what the
   * current bulletin actually says; a cancelled or absent bulletin shows nothing
   * (取消/なし are never implied by a greyed-out colour).
   */
  private updateTsunamiChip(state: AppState): void {
    const bulletin = state.tsunami;
    const inForce = bulletin && !bulletin.cancelled ? bulletin.areas.filter((a) => a.grade !== 'None' && a.grade !== 'Unknown') : [];
    if (!bulletin || bulletin.cancelled || inForce.length === 0) {
      this.tsunamiChip.hidden = true;
      return;
    }
    const rank: Record<string, number> = { MajorWarning: 5, Warning: 4, Watch: 3, NonEffective: 2, Checking: 1 };
    const strongest = inForce.reduce((acc, a) => ((rank[a.grade] ?? 0) > (rank[acc.grade] ?? 0) ? a : acc), inForce[0]!);
    const gradeLabel = tsunamiGradeLabel(strongest.grade);
    this.tsunamiChip.hidden = false;
    this.tsunamiChip.dataset.grade = strongest.grade;
    this.tsunamiChip.textContent = `${gradeLabel} · ${t('tsunami.areas', { n: inForce.length })}`;
    this.tsunamiChip.setAttribute(
      'aria-label',
      `${t('tsunami.sectionTitle')}: ${gradeLabel}, ${t('tsunami.areas', { n: inForce.length })}`,
    );
  }

  /** Diagnostics for the QA harness (viewport targets, framing checks). */
  debugState(): unknown {
    return this.map?.debugState() ?? null;
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
