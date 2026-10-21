/* Native layer public API. Usage in app.config.ts: providers: [...provideNativeTracker()] */
import type { Provider } from '@angular/core';
import { LOCATION_TRACKER } from '../contracts';
import { NativeLocationTracker } from './location-tracker.service';

export function provideNativeTracker(): Provider[] {
  return [{ provide: LOCATION_TRACKER, useExisting: NativeLocationTracker }];
}

export { NativeLocationTracker } from './location-tracker.service';
export { TripTracker } from './trip-tracker.plugin';
export type { NativeFix, TripTrackerPluginDef } from './trip-tracker.plugin';
