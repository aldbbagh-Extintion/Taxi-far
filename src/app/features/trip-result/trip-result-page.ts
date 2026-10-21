import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TRIP_SESSION } from '../../contracts';
import { verdict } from '../shared/core-bridge';
import { TripReport } from '../shared/trip-report';
import { ConfirmService, ToastService } from '../shared/ui.services';

/** Post-trip screen (post-trip_&_invoice_screen_6/7). Shown while session.pending is non-null. */
@Component({
  selector: 'app-trip-result-page',
  imports: [TripReport],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-header"><h1>اكتملت الرحلة</h1></header>
      @if (session.pending(); as p) {
        <app-trip-report [trip]="p" />

        <section class="card section-gap">
          <div class="field">
            <label for="meterIn">شو قرا عداد التكسي؟ (اختياري)</label>
            <input id="meterIn" class="input" type="number" inputmode="decimal" step="0.001" min="0"
                   placeholder="مثلاً 2.450" [value]="meterText()" (input)="meterText.set($any($event.target).value)" />
          </div>
          @if (cmp(); as v) { <div class="alert" [class]="'alert ' + v.cls" role="status">{{ v.text }}</div> }
          <div class="field">
            <label for="noteIn">ملاحظة / الغرض (اختياري)</label>
            <input id="noteIn" class="input" type="text" maxlength="120" placeholder="مثلاً: اجتماع وزارة الزراعة"
                   [value]="note()" (input)="note.set($any($event.target).value)" />
          </div>
        </section>

        @if (session.warning()) { <div class="alert warn" role="alert">{{ session.warning() }}</div> }

        <div class="actions">
          <button type="button" class="btn btn-lg btn-block btn-primary save" [disabled]="saving()" (click)="save()">حفظ الرحلة</button>
          <button type="button" class="btn btn-block btn-ghost" [disabled]="saving()" (click)="drop()">تجاهل</button>
        </div>
      }
    </div>
  `,
  styles: `
    .actions { display: flex; flex-direction: column; gap: .75rem; padding-bottom: var(--safe-bottom); }
    .save { border-radius: 1rem; }
  `,
})
export class TripResultPage {
  protected readonly session = inject(TRIP_SESSION);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  protected readonly meterText = signal('');
  protected readonly note = signal('');
  protected readonly saving = signal(false);

  private readonly meter = computed(() => {
    const v = parseFloat(this.meterText());
    return isFinite(v) && v > 0 ? v : null;
  });
  protected readonly cmp = computed(() => {
    const p = this.session.pending(), m = this.meter();
    return p && m !== null ? verdict(p.fare, m) : null;
  });

  constructor() {
    // Nothing to show (e.g. deep link / after discard elsewhere) → home.
    effect(() => { if (!this.session.pending() && !this.saving()) this.router.navigateByUrl('/'); });
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const saved = await this.session.savePending(this.meter(), this.note().trim());
      if (saved) {
        await this.router.navigate(['/history'], { queryParams: { trip: saved.id } });
        this.toast.show('انحفظت الرحلة.');
      }
      // null → storage failed; core sets session.warning and keeps pending visible.
    } catch (e) {
      this.toast.show(e instanceof Error && e.message ? e.message : 'ما قدرت أحفظ الرحلة.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async drop(): Promise<void> {
    const ok = await this.confirm.ask({ message: 'أكيد بدك تتجاهل هالرحلة؟', okText: 'تجاهل', danger: true });
    if (!ok) return;
    this.session.discardPending();
    this.router.navigateByUrl('/');
  }
}
