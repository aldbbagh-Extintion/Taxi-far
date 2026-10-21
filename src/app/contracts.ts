/* contracts.ts — العقود المشتركة بين أجزاء التطبيق.
 * أي تعديل هنا يلزم تنسيقه بين الفريق (core / native / ui).
 * Ownership:
 *   core   → src/app/core/**     (fare engine, repository, session orchestrator, csv)
 *   native → src/app/native/** + android/**  (background GPS via Google Fused Location)
 *   ui     → src/app/features/**, src/app/app.*, src/styles.scss, src/index.html
 */
import { InjectionToken, Signal } from '@angular/core';

/* ===== Tariff ===== */
export interface PeriodRate { base: number; perKm: number; waitPer35s: number; }
export interface Tariff {
  version: string;
  dayStartHour: number;   // inclusive
  nightStartHour: number; // inclusive
  day: PeriodRate;
  night: PeriodRate;
  minFare: number;        // 0 = none
}
export type Period = 'day' | 'night';

/* ===== GPS ===== */
export interface GpsFix {
  lat: number;
  lon: number;
  accuracy: number | null; // meters
  speed: number | null;    // m/s (Doppler) or null
  ts: number;              // epoch ms
}

/* ===== Fare engine output ===== */
export interface FareSummary {
  durationSec: number;
  distanceKm: number;
  waitingSec: number;
  base: number;
  distCharge: number;
  waitCharge: number;
  raw: number;
  fare: number;
  minApplied: boolean;
  period: Period;
  crossoverKmh: number;
  gapSec: number;
  fixes: number;
  rejected: number;
  lastFixAgeSec: number;
}

/* ===== Persisted trip (history) ===== */
export interface SavedTrip {
  id: string;            // String(startMs)
  start: number;         // epoch ms
  end: number;           // epoch ms
  period: Period;
  distanceKm: number;
  durationSec: number;
  waitingSec: number;
  base: number;
  distCharge: number;
  waitCharge: number;
  fare: number;          // rounded to fils (3 decimals)
  minApplied: boolean;
  gapSec: number;
  fixes: number;
  tariff: string;        // tariff version
  rate: PeriodRate;
  meter: number | null;  // what the real taxi meter showed (optional)
  note: string;
  route: [number, number][]; // downsampled [lat, lon] points (<= 300) for the route sketch
}

/* ===== Local database (SQLite on Android, localStorage fallback in browser) ===== */
export interface TripRepository {
  init(): Promise<void>;
  listTrips(): Promise<SavedTrip[]>;           // newest first
  getTrip(id: string): Promise<SavedTrip | null>;
  saveTrip(trip: SavedTrip): Promise<void>;    // insert or replace
  deleteTrip(id: string): Promise<void>;
  clearTrips(): Promise<void>;
  getTariff(): Promise<Tariff | null>;         // null = use default
  saveTariff(t: Tariff | null): Promise<void>; // null = reset to default
  getActiveTrip(): Promise<unknown | null>;    // serialized engine state of an unfinished trip
  saveActiveTrip(state: unknown | null): Promise<void>;
}
export const TRIP_REPOSITORY = new InjectionToken<TripRepository>('TRIP_REPOSITORY');

/* ===== Location tracker (native foreground service / browser geolocation) ===== */
export type PermissionState = 'granted' | 'denied' | 'prompt';
export interface TrackerPermissions { location: PermissionState; notifications: PermissionState; }

export interface LocationTracker {
  readonly isNative: boolean;
  checkPermissions(): Promise<TrackerPermissions>;
  requestPermissions(): Promise<TrackerPermissions>;
  /** Starts tracking. On Android this starts a foreground service (keeps running during phone calls / screen off). */
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  /** Live fixes while the JS side is alive. */
  onFix(cb: (fix: GpsFix) => void): () => void;   // returns unsubscribe
  /** Errors / status messages (Arabic, user-facing). */
  onError(cb: (message: string) => void): () => void;
  /** Returns and clears all fixes buffered natively (needed after the app returns from background). Sorted by ts. */
  drainBufferedFixes(): Promise<GpsFix[]>;
  /** Updates the ongoing-notification text (e.g. live fare). No-op on web. */
  updateNotification(title: string, text: string): Promise<void>;
  /** Opens Android battery-optimization settings so OEMs don't kill the service. No-op on web. */
  openBatterySettings(): Promise<void>;
}
export const LOCATION_TRACKER = new InjectionToken<LocationTracker>('LOCATION_TRACKER');

/* ===== Trip session (orchestrator, owned by core, consumed by ui) ===== */
export type MeterStatus = 'idle' | 'searching' | 'moving' | 'waiting' | 'stopped';
//  idle      : no trip
//  searching : trip started, no GPS fix yet
//  moving    : last segment charged by distance
//  waiting   : last segment charged by time (stopped in traffic)
//  stopped   : trip ended, result pending save

export interface TripSession {
  readonly status: Signal<MeterStatus>;
  readonly summary: Signal<FareSummary | null>;  // live, refreshed every second while running
  readonly gpsText: Signal<string>;              // e.g. "دقة الموقع 8 م"
  readonly warning: Signal<string>;              // '' when none
  readonly pending: Signal<SavedTrip | null>;    // finished trip awaiting save/discard
  readonly hasUnfinished: Signal<number | null>; // start ms of an interrupted trip, or null
  readonly route: Signal<[number, number][]>;    // live route points
  readonly tariff: Signal<Tariff>;

  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;          // ends trip → pending
  reset(): Promise<void>;         // aborts running trip without saving
  resumeUnfinished(): Promise<void>;
  discardUnfinished(): Promise<void>;
  savePending(meter: number | null, note: string): Promise<SavedTrip | null>;
  discardPending(): void;
  setTariff(t: Tariff | null): Promise<void>;
}
export const TRIP_SESSION = new InjectionToken<TripSession>('TRIP_SESSION');
