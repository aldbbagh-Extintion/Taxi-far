/* location-tracker.service.ts — LocationTracker (contracts.ts) over the TripTracker plugin.
 * Android: Google Fused Location inside a foreground service (keeps running during calls / screen off).
 * Web:     navigator.geolocation fallback. */
import { Injectable } from '@angular/core';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type { GpsFix, LocationTracker, PermissionState, TrackerPermissions } from '../contracts';
import { TripTracker, type NativeFix, type TripPermissionState, type TripTrackerPermissionStatus } from './trip-tracker.plugin';

const DEDUPE_LIMIT = 5000;

@Injectable({ providedIn: 'root' })
export class NativeLocationTracker implements LocationTracker {
  readonly isNative = Capacitor.isNativePlatform();

  private readonly fixCbs = new Set<(fix: GpsFix) => void>();
  private readonly errCbs = new Set<(message: string) => void>();
  private handles: PluginListenerHandle[] = [];
  private attaching: Promise<void> | null = null;

  /** Keys of fixes already delivered (live or drained) so a fix is never counted twice. */
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];

  async checkPermissions(): Promise<TrackerPermissions> {
    return this.mapPerms(await TripTracker.checkPermissions());
  }

  async requestPermissions(): Promise<TrackerPermissions> {
    return this.mapPerms(await TripTracker.requestPermissions());
  }

  async start(): Promise<void> {
    await this.ensureListeners();
    try {
      await TripTracker.start();
    } catch (e) {
      const msg = this.errMessage(e, 'تعذّر تشغيل تتبّع الموقع.');
      this.emitError(msg);
      throw e;
    }
  }

  async stop(): Promise<void> {
    await TripTracker.stop();
  }

  async isRunning(): Promise<boolean> {
    // Attach listeners early so a trip that survived a WebView reload keeps streaming.
    await this.ensureListeners();
    const r = await TripTracker.isRunning();
    return !!r.running;
  }

  onFix(cb: (fix: GpsFix) => void): () => void {
    this.fixCbs.add(cb);
    void this.ensureListeners();
    return () => this.fixCbs.delete(cb);
  }

  onError(cb: (message: string) => void): () => void {
    this.errCbs.add(cb);
    void this.ensureListeners();
    return () => this.errCbs.delete(cb);
  }

  async drainBufferedFixes(): Promise<GpsFix[]> {
    if (!this.isNative) return [];
    const { fixes } = await TripTracker.drainFixes();
    const out: GpsFix[] = [];
    for (const f of fixes ?? []) {
      const fix = this.normalize(f);
      if (fix && this.markNew(fix)) out.push(fix);
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  async updateNotification(title: string, text: string): Promise<void> {
    if (!this.isNative) return;
    try {
      await TripTracker.updateNotification({ title, text });
    } catch {
      /* notification text is cosmetic */
    }
  }

  async openBatterySettings(): Promise<void> {
    if (!this.isNative) return;
    await TripTracker.openBatterySettings();
  }

  // ------------------------------------------------------------------ internals

  private ensureListeners(): Promise<void> {
    if (!this.attaching) {
      this.attaching = (async () => {
        this.handles.push(
          await TripTracker.addListener('fix', (f) => {
            const fix = this.normalize(f);
            if (!fix || !this.markNew(fix)) return;
            for (const cb of this.fixCbs) cb(fix);
          }),
        );
        this.handles.push(await TripTracker.addListener('error', (e) => this.emitError(e?.message ?? '')));
      })().catch((err) => {
        this.attaching = null;
        console.warn('[TripTracker] addListener failed', err);
      });
    }
    return this.attaching;
  }

  private emitError(message: string): void {
    if (!message) return;
    for (const cb of this.errCbs) cb(message);
  }

  private normalize(f: NativeFix | null | undefined): GpsFix | null {
    if (!f || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return null;
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      lat: f.lat,
      lon: f.lon,
      accuracy: num(f.accuracy),
      speed: num(f.speed),
      ts: num(f.ts) ?? Date.now(),
    };
  }

  /** Returns true the first time a fix is seen. Live events and drained buffers overlap natively. */
  private markNew(fix: GpsFix): boolean {
    const key = `${fix.ts}|${fix.lat}|${fix.lon}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > DEDUPE_LIMIT) {
      const old = this.seenOrder.splice(0, this.seenOrder.length - DEDUPE_LIMIT);
      for (const k of old) this.seen.delete(k);
    }
    return true;
  }

  private mapPerms(p: TripTrackerPermissionStatus): TrackerPermissions {
    return { location: this.mapState(p?.location), notifications: this.mapState(p?.notifications) };
  }

  private mapState(s: TripPermissionState | undefined): PermissionState {
    if (s === 'granted' || s === 'denied') return s;
    return 'prompt';
  }

  private errMessage(e: unknown, fallback: string): string {
    const m = (e as { message?: unknown })?.message;
    return typeof m === 'string' && m ? m : fallback;
  }
}
