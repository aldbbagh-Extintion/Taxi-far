import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

let seq = 0;

/** Offline route thumbnail: an SVG polyline of [lat, lon] points (no map APIs). */
@Component({
  selector: 'app-route-sketch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 100 100" role="img" [attr.aria-label]="sketch() ? 'مسار الرحلة' : 'لا يوجد مسار'">
      <defs>
        <pattern [attr.id]="pid" width="12.5" height="12.5" patternUnits="userSpaceOnUse">
          <path d="M12.5 0H0V12.5" fill="none" class="grid" />
        </pattern>
      </defs>
      <rect width="100" height="100" [attr.fill]="'url(#' + pid + ')'" />
      @if (sketch(); as s) {
        <polyline [attr.points]="s.points" class="halo" />
        <polyline [attr.points]="s.points" class="line" />
        <circle [attr.cx]="s.start[0]" [attr.cy]="s.start[1]" r="5" class="start" />
        <circle [attr.cx]="s.end[0]" [attr.cy]="s.end[1]" r="5" class="end" />
      } @else {
        <text x="50" y="54" text-anchor="middle" class="empty">لا يوجد مسار</text>
      }
    </svg>
  `,
  styles: `
    :host { display: block; aspect-ratio: 1; border-radius: 1rem; overflow: hidden; background: var(--route-tile); }
    svg { display: block; width: 100%; height: 100%; }
    .grid { stroke: var(--route-grid); stroke-width: .6; }
    polyline { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .halo { stroke: var(--route-halo); stroke-width: 7; }
    .line { stroke: var(--route-line); stroke-width: 3.2; }
    .start { fill: #16a34a; stroke: #fff; stroke-width: 2; }
    .end { fill: #dc2626; stroke: #fff; stroke-width: 2; }
    .empty { font-size: 9px; fill: var(--ink-3); font-family: inherit; }
  `,
})
export class RouteSketch {
  protected readonly pid = 'rs-grid-' + ++seq;
  readonly route = input<[number, number][] | null | undefined>([]);

  protected readonly sketch = computed(() => {
    const pts = (this.route() ?? []).filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]));
    if (pts.length < 2) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [la, lo] of pts) {
      if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
      if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
    }
    // equirectangular: shrink longitude by cos(lat) so shapes aren't stretched
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const w = (maxLon - minLon) * kx, h = maxLat - minLat;
    const span = Math.max(w, h) || 1e-9;
    const pad = 14, size = 100 - pad * 2, scale = size / span;
    const ox = pad + (size - w * scale) / 2, oy = pad + (size - h * scale) / 2;
    const xy = pts.map(([la, lo]) => [
      +(ox + (lo - minLon) * kx * scale).toFixed(2),
      +(oy + (maxLat - la) * scale).toFixed(2),
    ]);
    return { points: xy.map((p) => p.join(',')).join(' '), start: xy[0], end: xy[xy.length - 1] };
  });
}
