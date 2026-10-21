/* DEV-ONLY entry: real app + fake TripSession / TripRepository / LocationTracker.
 * Run: npx ng serve -c mock   (or: npx ng build -c mock → dist/taxi-meter-app-mock/browser)
 * Playwright hooks: window.__mock.session (fastForward(sec), warning.set('…'), hasUnfinished.set(null)…) */
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { provideDevMocks } from './app/features/dev/mock-session';

bootstrapApplication(App, {
  ...appConfig,
  providers: [...appConfig.providers, ...provideDevMocks()], // later providers win
}).catch((err) => console.error(err));
