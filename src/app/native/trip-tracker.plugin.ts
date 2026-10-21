/* trip-tracker.plugin.ts — JS bridge to the native TripTracker Capacitor plugin
 * (android/app/src/main/java/jo/taqneen/taximeter/TripTrackerPlugin.java). */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type TripPermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

export interface TripTrackerPermissionStatus {
  location: TripPermissionState;
  notifications: TripPermissionState;
}

export interface NativeFix {
  lat: number;
  lon: number;
  accuracy: number | null; // meters
  speed: number | null;    // m/s
  ts: number;              // epoch ms (fix time)
}

export interface TripTrackerPluginDef {
  checkPermissions(): Promise<TripTrackerPermissionStatus>;
  requestPermissions(options?: {
    permissions?: ('location' | 'notifications')[];
  }): Promise<TripTrackerPermissionStatus>;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<{ running: boolean }>;
  /** Returns and clears every fix buffered natively (memory + fixes.jsonl). */
  drainFixes(): Promise<{ fixes: NativeFix[] }>;
  updateNotification(options: { title: string; text: string }): Promise<void>;
  openBatterySettings(): Promise<{ opened?: boolean; ignoring?: boolean } | void>;

  addListener(eventName: 'fix', listener: (fix: NativeFix) => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'error',
    listener: (e: { message: string }) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const TripTracker = registerPlugin<TripTrackerPluginDef>('TripTracker', {
  web: () => import('./trip-tracker.web').then((m) => new m.TripTrackerWeb()),
});
