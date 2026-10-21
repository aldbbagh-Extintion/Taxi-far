/* fare-engine.ts — port حرفي لـ design-ref/original-fare.js (نفس الحساب ونفس الأرقام).
 *
 * طريقة الحساب مثل العداد الحقيقي (Crossover meter):
 * كل مقطع بين قراءتين GPS بينحسب إما بالمسافة أو بالوقت، أيهما أعلى.
 * الحالة EngineTrip عبارة عن JSON عادي (بتنحفظ بقاعدة البيانات وبترجع زي ما هي).
 */
import type { FareSummary, GpsFix, Period, PeriodRate, Tariff } from '../contracts';

// ===== التعرفة الافتراضية (تحققت منها بتاريخ 2026-10-18) =====
export const DEFAULT_TARIFF: Readonly<Tariff> = Object.freeze({
  version: '2026-05-11',
  dayStartHour: 8,
  nightStartHour: 20,
  day: Object.freeze({ base: 0.39, perKm: 0.28, waitPer35s: 0.028 }),
  night: Object.freeze({ base: 0.4, perKm: 0.33, waitPer35s: 0.032 }),
  minFare: 1.0,
});

/** نسخة قابلة للتعديل من التعرفة الافتراضية */
export function cloneDefaultTariff(): Tariff {
  return JSON.parse(JSON.stringify(DEFAULT_TARIFF)) as Tariff;
}

// ===== إعدادات فلترة GPS =====
export const GPS = Object.freeze({
  maxAccuracyM: 35, // تجاهل أي قراءة دقتها أسوأ من 35 متر
  minMoveM: 8, // أقل من هيك = تذبذب، السيارة واقفة
  maxSpeedKmh: 180, // أي قفزة أسرع من هيك = قراءة غلط
});

export interface LatLon {
  lat: number;
  lon: number;
}
export interface EnginePoint extends LatLon {
  acc: number;
}
export type SegmentKind = 'distance' | 'time';

/** حالة الرحلة داخل المحرك — JSON عادي */
export interface EngineTrip {
  startMs: number;
  period: Period;
  rate: PeriodRate;
  minFare: number;
  tariffVersion: string;
  anchor: EnginePoint | null; // آخر نقطة معتمدة للمسافة
  lastFixMs: number; // آخر وقت انحسب لغايته
  distanceM: number;
  distChargeJD: number;
  waitChargeJD: number;
  waitingSec: number;
  fixes: number;
  rejected: number;
  gapSec: number; // فترات انقطاع الـ GPS (> 20 ثانية بين قراءتين)
  buf?: EnginePoint[];
  lastSpeed?: number | null;
  speedFixes?: number;
  pendingSec?: number;
  /** إضافة على الأصل: نوع آخر مقطع انحسب (للعرض فقط، ما بأثر على الأجرة) */
  lastKind?: SegmentKind | null;
}

export function haversineM(a: LatLon, b: LatLon): number {
  const R = 6371000,
    rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad,
    dLon = (b.lon - a.lon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function periodFor(
  date: Date,
  tariff: Pick<Tariff, 'dayStartHour' | 'nightStartHour'>,
): Period {
  const h = date.getHours();
  const isDay =
    tariff.dayStartHour < tariff.nightStartHour
      ? h >= tariff.dayStartHour && h < tariff.nightStartHour
      : h >= tariff.dayStartHour || h < tariff.nightStartHour;
  return isDay ? 'day' : 'night';
}

// سعر ثانية الانتظار، وسرعة التحول بين الحسابين
export function ratesOf(t: PeriodRate): { perSec: number; crossoverKmh: number } {
  const perSec = t.waitPer35s / 35;
  const crossoverKmh = (perSec * 3600) / t.perKm;
  return { perSec, crossoverKmh };
}

/* ===== رحلة ===== */
export function createTrip(startMs: number, tariff?: Tariff | null): EngineTrip {
  const t: Tariff = tariff || (DEFAULT_TARIFF as Tariff);
  const period = periodFor(new Date(startMs), t);
  return {
    startMs,
    period,
    rate: Object.assign({}, t[period]),
    minFare: Number(t.minFare) || 0,
    tariffVersion: t.version || 'custom',
    anchor: null,
    lastFixMs: startMs,
    distanceM: 0,
    distChargeJD: 0,
    waitChargeJD: 0,
    waitingSec: 0,
    fixes: 0,
    rejected: 0,
    gapSec: 0,
    lastKind: null,
  };
}

// يحسب مقطع زمني dt مع مسافة d بالمتر (d ممكن تكون صفر)
function chargeSegment(trip: EngineTrip, dtSec: number, dM: number): void {
  if (dtSec <= 0) return;
  const { perSec } = ratesOf(trip.rate);
  const distCost = (dM / 1000) * trip.rate.perKm;
  const timeCost = dtSec * perSec;
  if (timeCost >= distCost) {
    trip.waitChargeJD += timeCost;
    trip.waitingSec += dtSec;
    trip.lastKind = 'time';
  } else {
    trip.distChargeJD += distCost;
    trip.lastKind = 'distance';
  }
  trip.distanceM += dM;
}

// متوسط آخر عدة قراءات (بيخفف التذبذب العشوائي)
function smoothed(buf: EnginePoint[]): EnginePoint {
  let lat = 0,
    lon = 0,
    acc = 0;
  for (const p of buf) {
    lat += p.lat;
    lon += p.lon;
    acc += p.acc;
  }
  const n = buf.length;
  return { lat: lat / n, lon: lon / n, acc: acc / n / Math.sqrt(n) };
}

/** يضيف قراءة GPS ويرجع 'ok' | 'rejected' (نفس منطق الأصل حرفيًا) */
export function addFix(trip: EngineTrip, fix: GpsFix): 'ok' | 'rejected' {
  const ts = fix.ts;
  if (trip.anchor && ts <= trip.lastFixMs) return 'rejected';
  const acc = fix.accuracy != null ? fix.accuracy : 15;
  if (acc > GPS.maxAccuracyM) {
    trip.rejected++;
    return 'rejected';
  }

  const p: EnginePoint = { lat: fix.lat, lon: fix.lon, acc };
  const dt = (ts - trip.lastFixMs) / 1000;

  if (!trip.anchor) {
    trip.fixes++;
    // أول قراءة: الوقت من البداية لغايتها انتظار
    chargeSegment(trip, dt, 0);
    trip.buf = [p];
    trip.anchor = smoothed(trip.buf);
    trip.lastFixMs = ts;
    return 'ok';
  }

  // رفض القفزات المستحيلة (مقارنة بالموقع المنعّم)
  const jumpKmh = (haversineM(trip.anchor, p) / Math.max(dt, 1)) * 3.6;
  if (jumpKmh > GPS.maxSpeedKmh * 1.5 && dt < 30) {
    trip.rejected++;
    return 'rejected';
  }

  trip.fixes++;
  if (dt > 20) trip.gapSec += dt;
  const buf = trip.buf ?? (trip.buf = []);
  buf.push(p);
  if (buf.length > 5) buf.shift();
  const sm = smoothed(buf);

  const speed = fix.speed;
  const hasSpeed = typeof speed === 'number' && isFinite(speed) && speed >= 0;
  let d: number;
  if (hasSpeed && dt <= 10) {
    // طريقة 1: سرعة الجهاز
    const v = Math.min(speed, GPS.maxSpeedKmh / 3.6);
    const vPrev = trip.lastSpeed != null ? trip.lastSpeed : v;
    const vAvg = (v + vPrev) / 2;
    d = vAvg < 0.8 ? 0 : vAvg * dt; // أقل من ~3 كم/س = واقف
    trip.lastSpeed = v;
    trip.speedFixes = (trip.speedFixes || 0) + 1;
    trip.anchor = sm;
  } else {
    // طريقة 2: فرق المواقع المنعّمة
    trip.lastSpeed = hasSpeed ? speed : null;
    if (dt > 20) {
      // انقطاع طويل: خط مستقيم من آخر موقع
      const gapD = haversineM(trip.anchor, p);
      d = gapD < Math.max(GPS.minMoveM, acc) ? 0 : gapD;
      trip.buf = [p];
      trip.anchor = { lat: p.lat, lon: p.lon, acc: p.acc };
    } else {
      const moved = haversineM(trip.anchor, sm);
      const threshold = Math.max(GPS.minMoveM, 1.5 * Math.max(trip.anchor.acc, sm.acc));
      const perSec = ratesOf(trip.rate).perSec;
      if (moved < threshold) {
        // حركة أقل من هامش الخطأ: بنحسبها انتظار مؤقتًا (pending)
        chargeSegment(trip, dt, 0);
        trip.pendingSec = (trip.pendingSec || 0) + dt;
        if (trip.pendingSec > 30) trip.pendingSec = 0; // وقوف حقيقي: بنثبّته انتظار
        trip.lastFixMs = ts;
        return 'ok';
      }
      // الارتكاز تحرك: الفترة كلها من آخر حركة بتنحسب مرة وحدة
      const pend = trip.pendingSec || 0;
      trip.waitChargeJD -= pend * perSec;
      trip.waitingSec -= pend;
      trip.pendingSec = 0;
      chargeSegment(trip, pend + dt, moved);
      trip.anchor = sm;
      trip.lastFixMs = ts;
      return 'ok';
    }
    trip.pendingSec = 0;
  }

  chargeSegment(trip, dt, d);
  trip.lastFixMs = ts;
  return 'ok';
}

/** ملخص الأجرة لغاية nowMs. الوقت من آخر قراءة لغاية الآن بينحسب انتظار. */
export function summary(trip: EngineTrip, nowMs: number): FareSummary {
  const tail = Math.max(0, (nowMs - trip.lastFixMs) / 1000);
  const { perSec, crossoverKmh } = ratesOf(trip.rate);
  const waitCharge = trip.waitChargeJD + tail * perSec;
  const raw = trip.rate.base + trip.distChargeJD + waitCharge;
  const fare = Math.max(trip.minFare, raw);
  return {
    durationSec: Math.max(0, (nowMs - trip.startMs) / 1000),
    distanceKm: trip.distanceM / 1000,
    waitingSec: trip.waitingSec + tail,
    base: trip.rate.base,
    distCharge: trip.distChargeJD,
    waitCharge,
    raw,
    fare,
    minApplied: fare > raw,
    period: trip.period,
    crossoverKmh,
    gapSec: trip.gapSec,
    fixes: trip.fixes,
    rejected: trip.rejected,
    lastFixAgeSec: tail,
  };
}

// تقريب للفلس
export function roundFils(jd: number): number {
  return Math.round(jd * 1000) / 1000;
}

/** نوع آخر مقطع انحسب: 'distance' (ماشي) أو 'time' (انتظار) أو null (لسا ما انحسب شي) */
export function lastSegmentKind(trip: EngineTrip): SegmentKind | null {
  return trip.lastKind ?? null;
}

/** تحقق بسيط إن القيمة المحفوظة حالة رحلة صالحة */
export function isEngineTrip(v: unknown): v is EngineTrip {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['startMs'] === 'number' &&
    !!o['startMs'] &&
    typeof o['lastFixMs'] === 'number' &&
    !!o['rate'] &&
    typeof o['rate'] === 'object'
  );
}
