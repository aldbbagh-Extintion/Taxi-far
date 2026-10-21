import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SavedTrip, TRIP_REPOSITORY } from '../../contracts';
import { verdict } from '../shared/core-bridge';
import { jd } from '../shared/format';
import { ICON } from '../shared/icons';
import { TripReport } from '../shared/trip-report';
import { ConfirmService, ToastService } from '../shared/ui.services';

/** Read-only trip view reusing the post-trip layout, with delete. Route: /history/:id */
@Component({
  selector: 'app-trip-detail-page',
  imports: [TripReport],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-header">
        <button type="button" class="back" aria-label="رجوع" (click)="back()">
          <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path [attr.d]="icon.back" /></svg>
        </button>
        <h1>تفاصيل الرحلة</h1>
      </header>

      @if (trip(); as t) {
        <app-trip-report [trip]="t" />
        @if (t.meter || t.note) {
          <section class="card section-gap">
            @if (t.meter) {
              <div class="row"><span>قراءة العداد</span><span><span class="num">{{ jd(t.meter) }}</span> د.أ</span></div>
              @if (cmp(); as v) { <div class="alert" [class]="'alert ' + v.cls">{{ v.text }}</div> }
            }
            @if (t.note) { <div class="row"><span>ملاحظة</span><span class="note">{{ t.note }}</span></div> }
          </section>
        }
        <button type="button" class="btn btn-block btn-ghost-danger" (click)="remove(t)">حذف</button>
      } @else if (missing()) {
        <p class="muted" style="text-align:center;padding:2rem 0">الرحلة مش موجودة.</p>
      }
    </div>
  `,
  styles: `.note { white-space: normal !important; text-align: start; font-weight: 500; }`,
})
export class TripDetailPage {
  private readonly repo = inject(TRIP_REPOSITORY);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  protected readonly trip = signal<SavedTrip | null>(null);
  protected readonly missing = signal(false);
  protected readonly cmp = computed(() => {
    const t = this.trip();
    return t?.meter ? verdict(t.fare, t.meter) : null;
  });
  protected readonly icon = ICON;
  protected readonly jd = jd;

  constructor() {
    const sub = inject(ActivatedRoute).paramMap.subscribe((pm) => this.load(pm.get('id') ?? ''));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  private async load(id: string): Promise<void> {
    try {
      const t = id ? await this.repo.getTrip(id) : null;
      this.trip.set(t);
      this.missing.set(!t);
    } catch {
      this.missing.set(true);
    }
  }

  protected back(): void { this.router.navigateByUrl('/history'); }

  protected async remove(t: SavedTrip): Promise<void> {
    const ok = await this.confirm.ask({ message: 'حذف هالرحلة؟', okText: 'حذف', danger: true });
    if (!ok) return;
    try {
      await this.repo.deleteTrip(t.id);
      this.toast.show('انحذفت الرحلة.');
      this.router.navigateByUrl('/history');
    } catch {
      this.toast.show('ما قدرت أحذف الرحلة.');
    }
  }
}
