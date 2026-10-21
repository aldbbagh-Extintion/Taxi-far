import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { TRIP_SESSION } from './contracts';
import { ICON } from './features/shared/icons';
import { Overlays } from './features/shared/overlays';
import { ThemeService } from './features/shared/ui.services';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Overlays],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly session = inject(TRIP_SESSION);
  private readonly router = inject(Router);
  protected readonly icon = ICON;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  /** The post-trip screen asks for a decision (save / ignore), so the tab bar is hidden there. */
  protected readonly showNav = computed(() => !this.url().startsWith('/trip-result'));

  constructor() {
    inject(ThemeService); // applies the persisted theme class on <html>
    this.session.init().catch((e) => console.error('TripSession.init failed', e));

    // A trip just finished (or a pending one was restored) → show the result screen.
    let lastPendingId: string | null = null;
    effect(() => {
      const id = this.session.pending()?.id ?? null;
      if (id && id !== lastPendingId) this.router.navigateByUrl('/trip-result');
      lastPendingId = id;
    });
  }
}
