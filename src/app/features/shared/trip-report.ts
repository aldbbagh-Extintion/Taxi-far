import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SavedTrip } from '../../contracts';
import { FareRows } from './fare-rows';
import { fmtDay, fmtTime, jd, km, minutes, mmss, periodName } from './format';
import { RouteSketch } from './route-sketch';

/** Read-only post-trip layout (total, trip card with route sketch, breakdown, GPS quality). */
@Component({
  selector: 'app-trip-report',
  imports: [FareRows, RouteSketch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let t = trip();
    <section class="card total-card">
      <h2>إجمالي الأجرة</h2>
      <p class="total"><span class="num">{{ jd(t.fare) }}</span><span class="cur">د.أ</span></p>
      <p class="muted">{{ periodName(t.period) }} · تقدير حسب الـ GPS</p>
    </section>

    <section class="card trip-card">
      <div class="info">
        <p class="muted small"><span class="iso">{{ fmtTime(t.start) }}</span> – <span class="iso">{{ fmtTime(t.end) }}</span></p>
        <p class="day">{{ fmtDay(t.start) }}</p>
        <p class="muted small">
          <span class="num">{{ minutes(t.durationSec) }}</span> دقيقة | <span class="num">{{ km(t.distanceKm) }}</span> كم
        </p>
      </div>
      <app-route-sketch class="sketch" [route]="t.route" />
    </section>

    <section class="card">
      <h3 class="card-title">تفاصيل الأجرة</h3>
      <app-fare-rows [parts]="t" totalLabel="إجمالي الأجرة" />
    </section>

    @if (quality().length) {
      <div class="alert warn" role="note">
        @for (q of quality(); track q) { <div>{{ q }}</div> }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 1.25rem; }
    .total-card { text-align: center; padding: 1.5rem; }
    .total-card h2 { font-size: 1.1rem; font-weight: 500; color: var(--ink-2); }
    .total { margin: .25rem 0 .35rem; display: flex; justify-content: center; align-items: baseline; gap: .5rem; color: var(--total-num); line-height: 1.2; }
    .total .num { font-size: 3rem; font-weight: 900; }
    .total .cur { font-size: 1.75rem; font-weight: 700; }
    .trip-card { display: flex; align-items: center; gap: 1rem; }
    .info { flex: 1; min-width: 0; }
    .day { font-weight: 700; margin: .15rem 0; }
    .small { font-size: .8rem; }
    .sketch { width: 84px; flex: none; }
  `,
})
export class TripReport {
  readonly trip = input.required<SavedTrip>();

  protected readonly quality = computed(() => {
    const t = this.trip(), q: string[] = [];
    if (t.fixes < 5) q.push('قراءات الـ GPS قليلة جدًا، النتيجة مش موثوقة.');
    if (t.gapSec > 60) q.push('انقطع الـ GPS حوالي ' + mmss(t.gapSec) + ' خلال الرحلة، المسافة الحقيقية غالبًا أطول شوي.');
    return q;
  });

  protected readonly jd = jd;
  protected readonly km = km;
  protected readonly minutes = minutes;
  protected readonly fmtDay = fmtDay;
  protected readonly fmtTime = fmtTime;
  protected readonly periodName = periodName;
}
