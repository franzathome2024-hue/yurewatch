import { hasIntensity, scaleStyle } from '../core/intensity';
import type { Point, Viewport } from './geo';
import { worldToScreen } from './geo';
import type { MapGeometry } from './mapData';
import { tsunamiGradeColor, withAlpha, type MapScene } from './scene';
import { tsunamiLayer } from './tsunamiData';
import type { MapTheme } from './theme';

/**
 * Canvas renderer.
 *
 * Basemap geometry is compiled into world-space `Path2D` objects once; each
 * frame then only changes the transform, so panning 6k points at 60 fps is
 * cheap. Overlays (markers, labels, alerts) are drawn in screen space so text
 * and stroke widths stay crisp at every zoom level.
 */
export class MapRenderer {
  private ctx: CanvasRenderingContext2D | null;
  private landPaths: Path2D[] = [];
  private prefPaths = new Map<string, Path2D[]>();
  private tsunamiPaths = new Map<number, Path2D>();
  private viewport: Viewport = { width: 1, height: 1, dpr: 1 };

  constructor(
    private canvas: HTMLCanvasElement,
    private geometry: MapGeometry,
    private theme: MapTheme,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.compile();
  }

  get supported(): boolean {
    return this.ctx !== null;
  }

  private compile(): void {
    const toPath = (rings: Array<{ points: Float64Array }>): Path2D => {
      const path = new Path2D();
      for (const ring of rings) {
        const pts = ring.points;
        if (pts.length < 8) continue;
        path.moveTo(pts[0]!, pts[1]!);
        for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i]!, pts[i + 1]!);
        path.closePath();
      }
      return path;
    };
    // One Path2D per shape: a prefecture's islands AND its interior rings (lakes,
    // enclosed bays) go into a single path, then filled with the even-odd rule so
    // the holes punch back through instead of being painted as land.
    this.landPaths = this.geometry.land.map((l) => toPath([l]));
    for (const pref of this.geometry.prefectures) {
      this.prefPaths.set(pref.code, [toPath(pref.rings)]);
    }

    // Tsunami forecast regions are a separate layer with their own geometry.
    try {
      for (const region of tsunamiLayer().regions) {
        this.tsunamiPaths.set(region.code, toPath(region.rings.map((points) => ({ points }))));
      }
    } catch {
      // A geometry problem must never take the map down; the layer is optional.
    }
  }

  resize(viewport: Viewport): void {
    this.viewport = viewport;
    const { width, height, dpr } = viewport;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  draw(scene: MapScene, timeMs: number, opts: { reduceMotion?: boolean } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height, dpr } = this.viewport;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;

    // Flat ocean. The old vertical gradient plus a radial "lift" behind Japan
    // was decoration: it tinted the sea unevenly, cost a full-canvas composite
    // per frame, and made the land/water contrast depend on where you looked.
    ctx.fillStyle = this.theme.oceanTop;
    ctx.fillRect(0, 0, width, height);

    // Graticule.
    ctx.strokeStyle = this.theme.graticule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of scene.graticule.vertical) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }
    for (const y of scene.graticule.horizontal) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
    }
    ctx.stroke();

    // World transform for basemap.
    const cam = scene.camera;
    const scale = cam.scale;
    ctx.save();
    ctx.setTransform(
      dpr * scale,
      0,
      0,
      dpr * scale,
      dpr * (width / 2 - cam.cx * scale),
      dpr * (height / 2 - cam.cy * scale),
    );

    // Context land (neighbours). Clipped generously by the generator so it runs
    // off the edge of any reachable view instead of ending in a straight line.
    ctx.fillStyle = this.theme.landFill;
    ctx.strokeStyle = this.theme.landStroke;
    ctx.lineWidth = 1 / scale;
    for (const path of this.landPaths) {
      ctx.fill(path, 'evenodd');
      ctx.stroke(path);
    }

    // Japan prefectures.
    for (const pref of this.geometry.prefectures) {
      const style = scene.prefectureStyles.get(pref.code);
      const paths = this.prefPaths.get(pref.code);
      if (!paths) continue;
      ctx.fillStyle = style?.fill ?? this.theme.prefFill;
      for (const p of paths) ctx.fill(p, 'evenodd');
      ctx.strokeStyle = style?.stroke ?? this.theme.prefStroke;
      ctx.lineWidth = (style?.lineWidth ?? 0.7) / scale;
      ctx.setLineDash((style?.dash ?? []).map((v) => v / scale));
      for (const p of paths) ctx.stroke(p);
      ctx.setLineDash([]);
    }
    // Tsunami forecast regions: painted over the land/sea boundary but under the
    // markers, so an active warning is visible without hiding the epicentre.
    if (scene.tsunami && scene.tsunami.regions.length) {
      for (const hit of scene.tsunami.regions) {
        const path = this.tsunamiPaths.get(hit.code);
        if (!path) continue;
        const colour = tsunamiGradeColor(hit.grade);
        ctx.fillStyle = withAlpha(colour, 0.34);
        ctx.fill(path, 'evenodd');
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2 / scale;
        ctx.stroke(path);
      }
    }

    ctx.restore();

    // ---- overlays (screen space) ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (scene.eew) this.drawEew(ctx, scene, timeMs, opts.reduceMotion ?? false);

    for (const m of scene.markers) {
      this.drawMarker(ctx, m, scaleStyle(m.intensity).text);
    }

    // Labels last so nothing covers them. They are centred on their anchor:
    // the scene measures overlap boxes around the same point, and drawing them
    // left-aligned made that collision test disagree with the pixels (adjacent
    // prefecture names visibly overlapped at the default zoom).
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const label of scene.labels) {
      ctx.globalAlpha = label.alpha;
      ctx.font = `${label.weight} ${label.size}px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
      // Halo for legibility over both ocean and land.
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.theme.labelShadow;
      ctx.lineJoin = 'round';
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    this.drawScaleBar(ctx, scene);
    ctx.fillStyle = this.theme.attribution;
    ctx.font = '10px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
    ctx.textAlign = 'right';
    // Clear of the zoom controls in the bottom-right corner.
    ctx.fillText(scene.attribution, width - 64, height - 8);
    ctx.textAlign = 'left';
  }

  private drawMarker(ctx: CanvasRenderingContext2D, m: MapScene['markers'][number], textColor: string): void {
    ctx.globalAlpha = m.opacity;

    // Halo so markers stay visible over bright intensity fills.
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r + 3.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3,9,16,0.55)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fillStyle = m.fill;
    ctx.fill();
    ctx.lineWidth = m.selected ? 2.4 : 1.6;
    ctx.strokeStyle = m.selected ? '#ffffff' : this.theme.markerRing;
    ctx.stroke();

    if (m.selected) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r + 7, 0, Math.PI * 2);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (m.preliminary) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r + 4.5, 0, Math.PI * 2);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Intensity numeral inside the marker when there is room for it.
    if (m.r >= 9.5 && hasIntensity(m.intensity)) {
      const style = scaleStyle(m.intensity);
      ctx.fillStyle = textColor;
      ctx.font = `700 ${Math.round(m.r * 0.95)}px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(style.label, m.x, m.y + 0.5);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  private drawEew(
    ctx: CanvasRenderingContext2D,
    scene: MapScene,
    timeMs: number,
    reduceMotion: boolean,
  ): void {
    const eew = scene.eew;
    if (!eew) return;
    const { x, y } = eew;

    // Expanding rings mark "prediction, not observation".
    if (eew.pulsing) {
      const phase = reduceMotion ? 0.45 : (timeMs % 2000) / 2000;
      for (let i = 0; i < 2; i++) {
        const p = (phase + i * 0.5) % 1;
        const radius = 18 + p * 74;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,70,86,${(1 - p) * 0.5})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.eewGlow;
    ctx.fill();

    // X crosshair: the conventional EEW epicentre marker.
    const arm = 15;
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(8,12,18,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - arm, y - arm);
    ctx.lineTo(x + arm, y + arm);
    ctx.moveTo(x + arm, y - arm);
    ctx.lineTo(x - arm, y + arm);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.theme.eew;
    ctx.beginPath();
    ctx.moveTo(x - arm, y - arm);
    ctx.lineTo(x + arm, y + arm);
    ctx.moveTo(x + arm, y - arm);
    ctx.lineTo(x - arm, y + arm);
    ctx.stroke();

    // Label block. Kept inside the canvas: on a phone the crosshair can sit at
    // the right edge, and a clipped prediction label is worse than none.
    const compact = this.viewport.width < 520;
    // `sublabel` already carries the localized "estimated max intensity" line;
    // the short form keeps only its value, which is what a phone has room for.
    const shortSub = eew.sublabel ? eew.sublabel.replace(/^(予測最大震度|Est\. max intensity)\s*/, '') : '';
    const text = compact ? `${eew.label}${shortSub ? ` ${shortSub}` : ''}` : eew.sublabel ? `${eew.label}　${eew.sublabel}` : eew.label;
    ctx.font = `700 ${compact ? 11 : 12}px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
    const maxW = this.viewport.width - 24;
    let w = ctx.measureText(text).width;
    let label = text;
    if (w > maxW) {
      // Hard truncate with an ellipsis rather than overflowing the map.
      while (label.length > 4 && ctx.measureText(`${label}…`).width > maxW) label = label.slice(0, -1);
      label = `${label}…`;
      w = ctx.measureText(label).width;
    }
    // Keep the label clear of the zoom/recenter controls stacked on the right.
    const controlGutter = this.viewport.width < 700 ? 62 : 70;
    const bx = Math.min(Math.max(8, x + 26), this.viewport.width - w - controlGutter);
    const by = Math.min(Math.max(20, y - 12), this.viewport.height - 20);
    ctx.fillStyle = 'rgba(12,16,24,0.88)';
    roundRect(ctx, bx - 8, by - 14, w + 16, 26, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,90,105,0.7)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx - 8, by - 14, w + 16, 26, 7);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx, by - 1);
    ctx.lineWidth = 1;
  }

  private drawScaleBar(ctx: CanvasRenderingContext2D, scene: MapScene): void {
    const bar = scene.scaleBar;
    const x = 14;
    const y = this.viewport.height - 20;
    ctx.strokeStyle = this.theme.scaleBar;
    ctx.fillStyle = this.theme.scaleBar;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + bar.px, y);
    ctx.lineTo(x + bar.px, y - 5);
    ctx.stroke();
    ctx.font = '10px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(bar.label, x, y - 8);
  }

  /** Screen position of an event, for DOM overlays that point at the map. */
  positionOf(lon: number, lat: number, scene: MapScene): Point {
    return worldToScreen(scene.camera, scene.viewport, {
      x: (lon + 180) / 360,
      y: (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)) * -1 + 0.5,
    });
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
