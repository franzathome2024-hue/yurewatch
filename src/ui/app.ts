import { DARK_MAP_THEME } from '../map/theme';
import { geometry } from '../map/mapData';
import { MapView } from '../map/view';
import { formatJstClock } from '../core/time';
import { tsunamiGradeLabel } from '../core/format';
import { getLocaleVersion, t } from '../i18n';
import { ingestEvents, intensityByPrefecture } from '../state/events';
import { effectiveFreshness, freshnessLabel, selectEvent, type AppState, type Store } from '../state/store';
import { createAlertPanel } from './alertPanel';
import { createEewWindow } from './eewWindow';
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
  /** Explicit user-gesture audio test; returns a localised diagnostic line. */
  onTestSound?: () => string;
  /** Explicit user-gesture speech test; returns a localised diagnostic line. */
  onTestVoice?: () => string;
  onRecenter: () => void;
  onZoom: (factor: number) => void;
  /** Switch the map between mainland and full-archipelago framing. */
  onFrameToggle: () => void;
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
  private eewWindow = createEewWindow();
  private list: ReturnType<typeof createEventList>;
  private detail: ReturnType<typeof createDetails>;
  private info: ReturnType<typeof createInfoPanel>;
  private legend = createLegend();
  private map: MapView | null = null;
  private mapFallback: HTMLElement;
  private simBanner: HTMLElement;
  private measureMapInsets: (() => void) | null = null;
  private simBannerText = el('span', { class: 'simBanner__text' });
  private side: HTMLElement;
  private sideTabs = new Map<SideView, HTMLButtonElement>();
  private sidePanels = new Map<SideView, HTMLElement>();
  private sheetToggle: HTMLButtonElement;
  /** Collapse control for the docked sidebar (≥901 px; the sheet handle covers smaller layouts). */
  private sideToggle: HTMLButtonElement;
  private sideCollapsed = false;
  private peekText: HTMLElement;
  private peekHint: HTMLElement;
  private statusSource = el('span', { class: 'statusStrip__source' });
  private statusFresh = el('span', { class: 'statusStrip__fresh' });
  private statusMode = el('span', { class: 'statusStrip__mode' });
  /** Tsunami state, visible without opening any panel while a bulletin is in force. */
  private tsunamiChip = el('button', { class: 'tsunamiChip', type: 'button' });
  private modeChip = el('span', { class: 'modeChip' });
  private mapButtons: {
    canvas: HTMLElement;
    zoomIn: HTMLElement;
    zoomOut: HTMLElement;
    recenter: HTMLElement;
    frame: HTMLElement;
  } | null = null;
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
      onTestSound: handlers.onTestSound,
      onTestVoice: handlers.onTestVoice,
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
    // Framing toggle: the audit's "separate mainland and full-Japan framing
    // modes" made explicit, labelled with the target rather than a symbol, and
    // never hiding which coverage the current frame guarantees.
    const frame = el('button', { class: 'mapBtn mapBtn--frame', type: 'button' });
    zoomIn.addEventListener('click', () => handlers.onZoom(1.35));
    zoomOut.addEventListener('click', () => handlers.onZoom(1 / 1.35));
    recenter.addEventListener('click', () => handlers.onRecenter());
    frame.addEventListener('click', () => handlers.onFrameToggle());

    const controls = el('div', {
      class: 'mapControls',
      role: 'group',
      'aria-label': t('map.controlsLabel'),
      'data-map-anchor': 'bottom-right',
    }, zoomIn, zoomOut, recenter, frame);
    this.mapButtons = { canvas, zoomIn, zoomOut, recenter, frame };

    this.mapFallback = el('div', { class: 'map__fallback', hidden: 'hidden' });

    // The banner is the container; a bordered badge inside it was a container
    // inside a container for a single word. The tag keeps the label, loses the
    // second rounded rectangle.
    this.simBanner = el('div', { class: 'simBanner', hidden: 'hidden', 'data-map-anchor': 'top-left' },
      el('span', { class: 'simBanner__tag', text: t('demo.simBadge') }),
      this.simBannerText,
    );

    // The EEW monitor owns the map's top-right; the legend moves to the
    // bottom-left (above the canvas scale bar), JQuake-style. Both carry
    // data-map-anchor so EEW camera framing reserves space for whichever
    // corner each overlay actually occupies.
    this.eewWindow.el.dataset.mapAnchor = 'top-right';
    this.legend.el.dataset.mapAnchor = 'bottom-left';

    const mapPane = el('section', { class: 'mapPane' },
      canvas,
      this.simBanner,
      this.eewWindow.el,
      this.legend.el,
      controls,
      this.mapFallback,
    );

    /**
     * Reserve the space the on-map overlays actually occupy.
     *
     * Every element with `data-map-anchor` is measured against the map pane and
     * the largest reservation on each side wins. Static padding guessed at these
     * sizes in framingInsets(); it could not know that the demo banner is
     * showing, and the banner then sat on top of Sakhalin and the Kurils.
     */
    const measureInsets = (): void => {
      const host = canvas.getBoundingClientRect();
      if (host.width < 1 || host.height < 1) return;
      const out = { top: 0, right: 0, bottom: 0, left: 0 };
      const gap = 8;
      const overlays = mapPane.querySelectorAll<HTMLElement>('[data-map-anchor]');
      overlays.forEach((node) => {
        if (node.hidden || !node.offsetParent) return;
        const anchor = node.dataset.mapAnchor;
        const r = node.getBoundingClientRect();
        if (!anchor || r.width < 2 || r.height < 2) return;
        if (anchor.includes('top')) out.top = Math.max(out.top, r.bottom - host.top + gap);
        if (anchor.includes('bottom')) out.bottom = Math.max(out.bottom, host.bottom - r.top + gap);
        if (anchor.includes('right')) out.right = Math.max(out.right, host.right - r.left + gap);
        if (anchor.includes('left')) out.left = Math.max(out.left, r.right - host.left + gap);
      });
      // Cap every reservation. A wrapped four-line banner on a 360 px phone
      // measured 300 px tall, and reserving all of it left a 40 px map; the
      // point of the reservation is that overlays do not hide the *country*,
      // not that the map is squeezed into whatever is left over.
      this.map?.setOverlayInsets({
        // Short panes need a taller top reservation than tall ones: the banner
        // is a fixed-height object, and on a 150 px landscape strip 14 % of it
        // (21 px) is less than the banner itself.
        top: Math.min(out.top, Math.round(host.height * (host.height < 420 ? 0.3 : 0.14))),
        bottom: Math.min(out.bottom, Math.round(host.height * 0.18)),
        left: Math.min(out.left, Math.round(host.width * 0.1)),
        right: Math.min(out.right, Math.round(host.width * 0.14)),
      });
    };
    this.measureMapInsets = measureInsets;

    requestAnimationFrame(() => {
      try {
        this.map = new MapView(mapPane, canvas as HTMLCanvasElement, DARK_MAP_THEME, {
          onSelectEvent: (id) => handlers.onSelectEvent(id),
          onError: (message) => this.showMapError(message),
          onProfileChange: () => {
            this.refreshFrameButton();
            requestAnimationFrame(measureInsets);
          },
        });
        this.refreshFrameButton();
        this.pushMapState(this.store.get());
        requestAnimationFrame(measureInsets);
      } catch (err) {
        this.showMapError(t('map.error', { message: String(err) }));
      }
    });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => measureInsets()).observe(mapPane);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', measureInsets);
    }

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

    // Sidebar collapse (docked layouts only; CSS hides this ≤900 px where
    // the bottom-sheet handle already provides the same affordance). Lives
    // in the existing tab bar so it is always in the same place, collapsed
    // or not, and keeps keyboard focus when toggled.
    this.sideToggle = el('button', {
      class: 'sideToggle',
      type: 'button',
      'aria-expanded': 'true',
      'aria-label': t('side.collapse'),
    },
      el('span', { class: 'sideToggle__chevron', 'aria-hidden': 'true', html:
        '<svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
    );
    this.sideToggle.addEventListener('click', () => this.setSideCollapsed(!this.sideCollapsed));
    tabs.appendChild(this.sideToggle);

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

    this.root = el('div', { class: 'app', 'data-view': 'list', 'data-sheet': 'peek', 'data-side': 'open' },
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

  /** Collapse/expand the docked sidebar. The map resizes itself (ResizeObserver, centre-preserving). */
  private setSideCollapsed(collapsed: boolean): void {
    this.sideCollapsed = collapsed;
    this.root.dataset.side = collapsed ? 'collapsed' : 'open';
    this.sideToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    this.sideToggle.setAttribute('aria-label', collapsed ? t('side.expand') : t('side.collapse'));
  }

  setView(view: SideView): void {
    // Navigating to a panel (tab, event selection, info) always reveals it:
    // a collapsed sidebar must never swallow the thing the user asked for.
    if (this.sideCollapsed) this.setSideCollapsed(false);
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
      this.refreshFrameButton();
    }
    this.side.setAttribute('aria-label', t('sheet.label'));
    this.sideToggle.setAttribute('aria-label', this.sideCollapsed ? t('side.expand') : t('side.collapse'));
    for (const [view, button] of this.sideTabs) {
      button.textContent = view === 'list' ? t('list.title') : view === 'detail' ? t('nav.detail') : t('nav.info');
    }

    /* ---- components -------------------------------------------------- */
    this.header.update(state);
    this.alertPanel.update(state);
    this.eewWindow.update(state);
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
        : state.historySnapshotAt !== null && state.events.length > 0
          ? `${t('status.history', { time: formatJstClock(state.historySnapshotAt) })} · ${freshnessLabel(fresh)}`
          : `${t('status.noData')} · ${freshnessLabel(fresh)}`;
    this.statusFresh.dataset.freshness = fresh;
    this.statusFresh.dataset.conn = state.health.state;

    /* ---- simulation marking ------------------------------------------ */
    const sim = demo || state.alert?.simulated === true || state.events.some((e) => e.simulated);
    // One notice per fact. A simulated alert banner already carries the
    // SIMULATION badge and footer line, so the floating map banner is dropped
    // for its lifetime — previously this only happened below 900 px, and on a
    // 740x360 landscape phone the duplicate covered 15 % of the map. Decided in
    // JS rather than in a media query so it cannot drift from the banner again.
    const alertStatesSimulation = state.alert?.simulated === true;
    const bannerWasHidden = this.simBanner.hidden;
    this.simBanner.hidden = !sim || alertStatesSimulation;
    if (bannerWasHidden !== this.simBanner.hidden) requestAnimationFrame(() => this.measureMapInsets?.());
    this.root.classList.toggle('app--sim', sim);
    // Drives the compact phone treatment for an alert in force.
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

  /** Label the framing button with the profile it would switch *to*. */
  private refreshFrameButton(): void {
    const btn = this.mapButtons?.frame;
    if (!btn || !this.map) return;
    const active = this.map.activeProfile();
    const next = active === 'mainland' ? 'archipelago' : 'mainland';
    btn.textContent = next === 'archipelago' ? t('map.frameArchipelago') : t('map.frameMainland');
    btn.setAttribute('aria-label', t('map.frameSwitch', {
      to: next === 'archipelago' ? t('map.frameArchipelago') : t('map.frameMainland'),
    }));
    btn.setAttribute('data-active', active);
  }

  setFrame(profile: 'mainland' | 'archipelago'): void {
    this.map?.setProfile(profile);
    this.refreshFrameButton();
  }

  toggleFrame(): void {
    this.map?.toggleProfile();
    this.refreshFrameButton();
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
