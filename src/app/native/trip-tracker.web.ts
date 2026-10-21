/* trip-tracker.web.ts — browser fallback: navigator.geolocation.watchPosition + screen Wake Lock.
 * Works only while the tab is visible (no background tracking in the browser). */
import { WebPlugin } from '@capacitor/core';
import type {
  NativeFix,
  TripPermissionState,
  TripTrackerPermissionStatus,
  TripTrackerPluginDef,
} from './trip-tracker.plugin';

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

export class TripTrackerWeb extends WebPlugin implements Omit<TripTrackerPluginDef, 'addListener' | 'removeAllListeners'> {
  private watchId: number | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible' && this.watchId !== null) void this.lockScreen();
  };

  async checkPermissions(): Promise<TripTrackerPermissionStatus> {
    let location: TripPermissionState = 'prompt';
    try {
      if (navigator.permissions?.query) {
        const st = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        location = st.state as TripPermissionState;
      }
    } catch {
      /* not supported (e.g. some Safari versions) */
    }
    let notifications: TripPermissionState = 'granted';
    if (typeof Notification !== 'undefined') {
      notifications = Notification.permission === 'default' ? 'prompt' : (Notification.permission as TripPermissionState);
    }
    return { location, notifications };
  }

  async requestPermissions(): Promise<TripTrackerPermissionStatus> {
    // The browser shows its own prompt on the first geolocation call.
    if ('geolocation' in navigator) {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(),
          () => resolve(),
          { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 },
        );
      });
    }
    return this.checkPermissions();
  }

  async start(): Promise<void> {
    if (!('geolocation' in navigator)) {
      const msg = 'المتصفح ما بيدعم تحديد الموقع.';
      this.notifyListeners('error', { message: msg });
      throw this.unavailable(msg);
    }
    if (this.watchId !== null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.onPos(p),
      (e) => this.onErr(e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    document.addEventListener('visibilitychange', this.onVisibility);
    await this.lockScreen();
  }

  async stop(): Promise<void> {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    try {
      await this.wakeLock?.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }

  async isRunning(): Promise<{ running: boolean }> {
    return { running: this.watchId !== null };
  }

  async drainFixes(): Promise<{ fixes: NativeFix[] }> {
    return { fixes: [] };
  }

  async updateNotification(_options: { title: string; text: string }): Promise<void> {
    /* no-op on web */
  }

  async openBatterySettings(): Promise<void> {
    /* no-op on web */
  }

  private onPos(p: GeolocationPosition): void {
    const c = p.coords;
    const fix: NativeFix = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
      speed: c.speed !== null && Number.isFinite(c.speed) ? c.speed : null,
      ts: p.timestamp || Date.now(),
    };
    this.notifyListeners('fix', fix);
  }

  private onErr(e: GeolocationPositionError): void {
    const message =
      e.code === 1
        ? 'رفضت إذن الموقع. فعّله من إعدادات المتصفح عشان العداد يشتغل.'
        : e.code === 2
          ? 'الموقع مش متوفر حاليًا. تأكد إن الـ GPS شغال.'
          : 'الـ GPS بطيء بالاستجابة…';
    this.notifyListeners('error', { message });
    if (e.code === 1) void this.stop();
  }

  private async lockScreen(): Promise<void> {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } })
        .wakeLock;
      if (wl) this.wakeLock = await wl.request('screen');
    } catch {
      /* not supported / denied */
    }
  }
}
