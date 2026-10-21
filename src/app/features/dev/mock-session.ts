/* DEV-ONLY fakes for visual testing (used by src/main.dev-mock.ts, never by the real app).
 * MockTripSession simulates a moving taxi around Amman with fake live data. */
import { Provider, signal } from '@angular/core';
import {
  FareSummary, LOCATION_TRACKER, LocationTracker, MeterStatus, SavedTrip, Tariff, TRIP_REPOSITORY,
  TRIP_SESSION, TripRepository, TripSession,
} from '../../contracts';
import { DEFAULT_TARIFF } from '../shared/core-bridge';
import { periodAt } from '../shared/format';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function fakeRoute(seed: number, n = 60): [number, number][] {
  let lat = 31.9539 + (seed % 7) * 0.004, lon = 35.9106 + (seed % 5) * 0.004, a = seed;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    a += Math.sin(i / 14 + seed) * 0.12;
    lat += Math.cos(a) * 0.0009;
    lon += Math.sin(a) * 0.0011;
    pts.push([+lat.toFixed(6), +lon.toFixed(6)]);
  }
  return pts;
}

function fakeTrip(start: number, km: number, min: number, wait: number, meter: number | null, note: string, t: Tariff): SavedTrip {
  const period = periodAt(new Date(start), t), rate = t[period];
  const distCharge = r3(km * rate.perKm), waitCharge = r3(Math.floor(wait / 35) * rate.waitPer35s);
  const raw = rate.base + distCharge + waitCharge, fare = r3(Math.max(raw, t.minFare));
  return {
    id: String(start), start, end: start + min * 60000, period, distanceKm: km, durationSec: min * 60,
    waitingSec: wait, base: rate.base, distCharge, waitCharge, fare, minApplied: raw < t.minFare,
    gapSec: 0, fixes: 120, tariff: t.version, rate, meter, note, route: fakeRoute(start % 97),
  };
}

export class MockTripRepository implements TripRepository {
  private trips: SavedTrip[] = [];
  private tariff: Tariff | null = null;
  constructor() {
    const now = Date.now(), d = 86400000, t = clone(DEFAULT_TARIFF) as Tariff;
    this.trips = [
      fakeTrip(now - 2 * 3600000, 7.4, 21, 260, 2.75, 'اجتماع وزارة الزراعة', t),
      fakeTrip(now - 1 * d - 5 * 3600000, 3.1, 11, 90, null, '', t),
      fakeTrip(now - 3 * d, 12.8, 34, 420, 5.1, 'المطار – تسليم أوراق', t),
      fakeTrip(now - 6 * d, 1.2, 6, 30, 1.0, '', t),
      fakeTrip(now - 38 * d, 9.6, 27, 300, 3.4, 'زيارة موقع', t),
      fakeTrip(now - 45 * d, 4.4, 15, 120, null, '', t),
    ];
  }
  async init() {}
  async listTrips() { return [...this.trips].sort((a, b) => b.start - a.start); }
  async getTrip(id: string) { return this.trips.find((t) => t.id === id) ?? null; }
  async saveTrip(trip: SavedTrip) { this.trips = [...this.trips.filter((t) => t.id !== trip.id), trip]; }
  async deleteTrip(id: string) { this.trips = this.trips.filter((t) => t.id !== id); }
  async clearTrips() { this.trips = []; }
  async getTariff() { return this.tariff; }
  async saveTariff(t: Tariff | null) { this.tariff = t; }
  async getActiveTrip() { return null; }
  async saveActiveTrip() {}
}

export class MockLocationTracker implements LocationTracker {
  readonly isNative = false;
  async checkPermissions() { return { location: 'granted', notifications: 'granted' } as const; }
  async requestPermissions() { return this.checkPermissions(); }
  async start() {}
  async stop() {}
  async isRunning() { return false; }
  onFix() { return () => {}; }
  onError() { return () => {}; }
  async drainBufferedFixes() { return []; }
  async updateNotification() {}
  async openBatterySettings() { console.info('[mock] openBatterySettings()'); }
}

export class MockTripSession implements TripSession {
  readonly status = signal<MeterStatus>('idle');
  readonly summary = signal<FareSummary | null>(null);
  readonly gpsText = signal('');
  readonly warning = signal('');
  readonly pending = signal<SavedTrip | null>(null);
  readonly hasUnfinished = signal<number | null>(Date.now() - 25 * 60000);
  readonly route = signal<[number, number][]>([]);
  readonly tariff = signal<Tariff>(clone(DEFAULT_TARIFF) as Tariff);

  private timer: ReturnType<typeof setInterval> | null = null;
  private startMs = 0;
  private tick = 0;

  constructor(private readonly repo: MockTripRepository) {}

  async init() {}

  async start() {
    this.startMs = Date.now();
    this.tick = 0;
    this.pending.set(null);
    this.hasUnfinished.set(null);
    this.route.set([]);
    this.status.set('searching');
    this.gpsText.set('بيدوّر على الموقع…');
    this.emit();
    this.timer = setInterval(() => this.step(), 1000);
  }

  /** Jump the simulation forward (for screenshots): window.__mock.session.fastForward(600) */
  fastForward(sec: number) { for (let i = 0; i < sec; i++) this.step(); }

  private step() {
    this.tick++;
    if (this.tick < 3) return this.emit();
    const waiting = this.tick % 40 > 30;
    this.status.set(waiting ? 'waiting' : 'moving');
    this.gpsText.set('دقة الموقع ' + (6 + (this.tick % 5)) + ' م');
    const all = fakeRoute(7, 400);
    this.route.set(all.slice(0, Math.min(all.length, Math.floor(this.tick / 2) + 2)));
    this.emit();
  }

  private emit() {
    const t = this.tariff(), period = periodAt(new Date(this.startMs), t), rate = t[period];
    const dur = this.tick, moving = Math.max(0, dur - 3);
    const waitingSec = Math.floor(moving / 40) * 10 + Math.max(0, (moving % 40) - 30);
    const distanceKm = (moving - waitingSec) * 0.0105;
    const distCharge = distanceKm * rate.perKm, waitCharge = Math.floor(waitingSec / 35) * rate.waitPer35s;
    const raw = rate.base + distCharge + waitCharge, fare = Math.max(raw, t.minFare);
    this.summary.set({
      durationSec: dur, distanceKm, waitingSec, base: rate.base, distCharge, waitCharge, raw, fare,
      minApplied: raw < t.minFare, period, crossoverKmh: 12, gapSec: 0, fixes: Math.max(0, moving),
      rejected: 0, lastFixAgeSec: 1,
    });
  }

  private halt() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async stop() {
    this.halt();
    const s = this.summary();
    if (!s) { this.status.set('idle'); return; }
    const t = this.tariff();
    this.pending.set({
      id: String(this.startMs), start: this.startMs, end: this.startMs + s.durationSec * 1000, period: s.period,
      distanceKm: r3(s.distanceKm), durationSec: s.durationSec, waitingSec: s.waitingSec, base: s.base,
      distCharge: r3(s.distCharge), waitCharge: r3(s.waitCharge), fare: r3(s.fare), minApplied: s.minApplied,
      gapSec: s.gapSec, fixes: s.fixes, tariff: t.version, rate: t[s.period], meter: null, note: '',
      route: this.route().length > 1 ? this.route() : fakeRoute(3),
    });
    this.status.set('stopped');
    this.gpsText.set('');
  }

  async reset() {
    this.halt();
    this.status.set('idle');
    this.summary.set(null);
    this.route.set([]);
    this.gpsText.set('');
    this.warning.set('');
  }

  async resumeUnfinished() {
    this.hasUnfinished.set(null);
    await this.start();
    this.fastForward(25 * 60);
  }

  async discardUnfinished() { this.hasUnfinished.set(null); }

  async savePending(meter: number | null, note: string) {
    const p = this.pending();
    if (!p) return null;
    const saved = { ...p, meter, note };
    await this.repo.saveTrip(saved);
    this.pending.set(null);
    this.summary.set(null);
    this.status.set('idle');
    return saved;
  }

  discardPending() {
    this.pending.set(null);
    this.summary.set(null);
    this.status.set('idle');
  }

  async setTariff(t: Tariff | null) {
    if (t) {
      const nums = [t.day.base, t.day.perKm, t.day.waitPer35s, t.night.base, t.night.perKm, t.night.waitPer35s, t.minFare];
      const hs = [t.dayStartHour, t.nightStartHour];
      if (nums.some((v) => !isFinite(v) || v < 0) || hs.some((h) => !(h >= 0 && h <= 23)) || hs[0] === hs[1])
        throw new Error('في قيمة غلط، تأكد من الأرقام.');
    }
    this.tariff.set(t ? clone(t) : (clone(DEFAULT_TARIFF) as Tariff));
  }
}

/** Providers that override the real core/native ones. */
export function provideDevMocks(): Provider[] {
  const repo = new MockTripRepository();
  const session = new MockTripSession(repo);
  const tracker = new MockLocationTracker();
  (globalThis as Record<string, unknown>)['__mock'] = { session, repo, tracker };
  return [
    { provide: TRIP_REPOSITORY, useValue: repo },
    { provide: TRIP_SESSION, useValue: session },
    { provide: LOCATION_TRACKER, useValue: tracker },
  ];
}
