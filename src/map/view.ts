import type { Viewport } from './geo';
import {
  JAPAN_BOUNDS,
  clampCamera,
  defaultZoomLimits,
  fitBounds,
  panBy,
  zoomAt,
  type Camera,
  type Point,
  type ZoomLimits,
} from './geo';
import { geometry, type MapGeometry } from './mapData';
import { MapRenderer } from './renderer';
import { buildScene, hitTest, type Marker, type MapScene, type SceneInput } from './scene';
import type { MapTheme } from './theme';

/**
 * Interactive map surface: owns the canvas, the camera, gestures and the render
 * loop. Application state is pushed in via `update()`; selection is reported
 * back through callbacks so the map never reaches into the store.
 */
export interface MapViewCallbacks {
  onSelectEvent: (id: string | null) => void;
  onCameraChange?: (camera: Camera, zoomRatio: number) => void;
  onError?: (message: string) => void;
}

export class MapView {
  private renderer: MapRenderer | null = null;
  private camera: Camera = { cx: 0.5, cy: 0.5, scale: 1 };
  private limits: ZoomLimits = { minScale: 0.1, maxScale: 10 };
  private viewport: Viewport = { width: 0, height: 0, dpr: 1 };
  private input: Omit<SceneInput, 'camera' | 'viewport'> | null = null;
  private scene: MapScene | null = null;
  private dirty = true;
  private rafId: number | null = null;
  private pointers = new Map<number, Point>();
  private lastSingle: Point | null = null;
  private lastPinch: { dist: number; centre: Point } | null = null;
  private dragMoved = false;
  /** Cleared on the first pan/zoom: until then, layout changes refit Japan. */
  private userAdjusted = false;
  private reduceMotion = false;
  private readonly geometryData: MapGeometry;
  private resizeObserver: ResizeObserver | null = null;
  private frameCount = 0;

  constructor(
    private host: HTMLElement,
    private canvas: HTMLCanvasElement,
    private theme: MapTheme,
    private callbacks: MapViewCallbacks,
  ) {
    this.geometryData = geometry();
    try {
      this.renderer = new MapRenderer(canvas, this.geometryData, theme);
    } catch (err) {
      this.callbacks.onError?.(`地図を初期化できませんでした: ${String(err)}`);
    }
    if (this.renderer && !this.renderer.supported) {
      this.callbacks.onError?.('この端末では地図を描画できません（Canvas 2D 非対応）');
      this.renderer = null;
    }
    this.attach();
  }

  /** Enable/disable pulsing animations. */
  setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
    this.dirty = true;
  }

  private attach(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    c.addEventListener('pointermove', this.onPointerMove, { passive: false });
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('dblclick', this.onDoubleClick);
    c.addEventListener('keydown', this.onKeyDown);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(this.host);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.measure);
    }
    this.measure();
  }

  destroy(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('dblclick', this.onDoubleClick);
    c.removeEventListener('keydown', this.onKeyDown);
    this.resizeObserver?.disconnect();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.measure);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  private measure = (): void => {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const first = this.viewport.width <= 1;
    this.viewport = { width, height, dpr };
    this.limits = defaultZoomLimits(this.viewport);
    if (first || !this.userAdjusted) {
      // Fit on first layout *and* on every layout change until the operator
      // takes control. Panels above the map reflow when an EEW arrives, and
      // refitting keeps Japan framed instead of leaving it small and off-centre.
      this.camera = fitBounds(JAPAN_BOUNDS, this.viewport, 16);
    } else {
      this.camera = clampCamera(this.camera, this.viewport, this.limits);
    }
    this.renderer?.resize(this.viewport);
    this.dirty = true;
    this.requestFrame();
  };

  /** Push application state; the map re-renders on the next frame. */
  update(input: Omit<SceneInput, 'camera' | 'viewport'>): void {
    this.input = input;
    this.dirty = true;
    this.requestFrame();
  }

  recenter(): void {
    this.userAdjusted = false;
    this.camera = fitBounds(JAPAN_BOUNDS, this.viewport, 16);
    this.dirty = true;
    this.requestFrame();
    this.callbacks.onCameraChange?.(this.camera, this.zoomRatio());
  }

  zoomBy(factor: number): void {
    this.userAdjusted = true;
    const anchor = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    this.camera = zoomAt(this.camera, this.viewport, anchor, factor, this.limits);
    this.dirty = true;
    this.requestFrame();
    this.callbacks.onCameraChange?.(this.camera, this.zoomRatio());
  }

  /** Centre on a geographic point without changing zoom much. */
  focusOn(lon: number, lat: number, minScale?: number): void {
    this.userAdjusted = true;
    const x = (lon + 180) / 360;
    const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
    const y = 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
    const scale = Math.max(this.camera.scale, minScale ?? this.limits.minScale * 2.2);
    this.camera = clampCamera({ cx: x, cy: y, scale }, this.viewport, this.limits);
    this.dirty = true;
    this.requestFrame();
  }

  zoomRatio(): number {
    const fit = fitBounds(JAPAN_BOUNDS, this.viewport);
    return this.camera.scale / fit.scale;
  }

  getScene(): MapScene | null {
    return this.scene;
  }

  private requestFrame(): void {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.render();
      return;
    }
    this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    this.rafId = null;
    const needsAnimation = Boolean(this.scene?.eew?.pulsing) && !this.reduceMotion;
    if (this.dirty || needsAnimation) this.render();
    this.frameCount += 1;
    // Keep animating only while something moves.
    if (needsAnimation) this.rafId = requestAnimationFrame(this.frame);
  };

  private render(): void {
    if (!this.renderer || !this.input) return;
    const scene = buildScene({ ...this.input, camera: this.camera, viewport: this.viewport });
    this.scene = scene;
    this.renderer.draw(scene, typeof performance !== 'undefined' ? performance.now() : Date.now(), {
      reduceMotion: this.reduceMotion,
    });
    this.dirty = false;
  }

  /* ---------------- gestures ---------------- */

  private localPoint(e: PointerEvent | MouseEvent | WheelEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, this.localPoint(e));
    this.dragMoved = false;
    if (this.pointers.size === 1) this.lastSingle = this.localPoint(e);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (a && b) {
        this.lastPinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const p = this.localPoint(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.userAdjusted = true;
      if (this.lastPinch && this.lastPinch.dist > 0) {
        const factor = dist / this.lastPinch.dist;
        this.camera = zoomAt(this.camera, this.viewport, centre, factor, this.limits);
        this.camera = panBy(this.camera, this.viewport, centre.x - this.lastPinch.centre.x, centre.y - this.lastPinch.centre.y, this.limits);
        this.dragMoved = true;
        this.dirty = true;
        this.requestFrame();
      }
      this.lastPinch = { dist, centre };
      return;
    }

    if (this.lastSingle) {
      const dx = p.x - this.lastSingle.x;
      if (Math.abs(dx) > 0) this.userAdjusted = true;
      const dy = p.y - this.lastSingle.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
      this.camera = panBy(this.camera, this.viewport, dx, dy, this.limits);
      this.dirty = true;
      this.requestFrame();
    }
    this.lastSingle = p;
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId) ?? this.localPoint(e);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.lastPinch = null;
    if (this.pointers.size === 0) this.lastSingle = null;

    if (!this.dragMoved && e.type === 'pointerup') {
      const marker = this.scene ? hitTest(this.scene, p) : null;
      this.callbacks.onSelectEvent(marker ? marker.id : null);
    }
    this.callbacks.onCameraChange?.(this.camera, this.zoomRatio());
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.userAdjusted = true;
    const factor = Math.exp(-e.deltaY * 0.0016);
    this.camera = zoomAt(this.camera, this.viewport, this.localPoint(e), factor, this.limits);
    this.dirty = true;
    this.requestFrame();
    this.callbacks.onCameraChange?.(this.camera, this.zoomRatio());
  };

  private onDoubleClick = (e: MouseEvent): void => {
    this.userAdjusted = true;
    this.camera = zoomAt(this.camera, this.viewport, this.localPoint(e), 1.8, this.limits);
    this.dirty = true;
    this.requestFrame();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const step = 60;
    switch (e.key) {
      case '+':
      case '=':
        this.zoomBy(1.3);
        break;
      case '-':
      case '_':
        this.zoomBy(1 / 1.3);
        break;
      case 'ArrowLeft':
        this.camera = panBy(this.camera, this.viewport, step, 0, this.limits);
        this.dirty = true;
        this.requestFrame();
        break;
      case 'ArrowRight':
        this.camera = panBy(this.camera, this.viewport, -step, 0, this.limits);
        this.dirty = true;
        this.requestFrame();
        break;
      case 'ArrowUp':
        this.camera = panBy(this.camera, this.viewport, 0, step, this.limits);
        this.dirty = true;
        this.requestFrame();
        break;
      case 'ArrowDown':
        this.camera = panBy(this.camera, this.viewport, 0, -step, this.limits);
        this.dirty = true;
        this.requestFrame();
        break;
      case 'Home':
        this.recenter();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /** Exposed for tests/diagnostics. */
  stats() {
    return {
      frames: this.frameCount,
      camera: this.camera,
      viewport: this.viewport,
      markers: this.scene?.markers.length ?? 0,
    };
  }
}

export type { Marker };
