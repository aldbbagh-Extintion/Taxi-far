/* نقاط مسار الرحلة (للرسم) */
import { haversineM } from './fare-engine';

export type RoutePoint = [number, number]; // [lat, lon]
export const ROUTE_MIN_STEP_M = 15;
export const ROUTE_MAX_POINTS = 300;

/** يضيف نقطة إذا بعدت أكثر من 15 م عن آخر نقطة. يرجع true إذا انضافت. */
export function appendRoutePoint(route: RoutePoint[], lat: number, lon: number): boolean {
  const last = route[route.length - 1];
  if (last && haversineM({ lat: last[0], lon: last[1] }, { lat, lon }) <= ROUTE_MIN_STEP_M) {
    return false;
  }
  route.push([lat, lon]);
  return true;
}

/** تقليل النقاط لـ max (بيحافظ على أول وآخر نقطة) */
export function downsampleRoute(route: RoutePoint[], max = ROUTE_MAX_POINTS): RoutePoint[] {
  if (route.length <= max) return route.map((p) => [p[0], p[1]]);
  const out: RoutePoint[] = [];
  const step = (route.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const p = route[Math.round(i * step)];
    out.push([p[0], p[1]]);
  }
  return out;
}
