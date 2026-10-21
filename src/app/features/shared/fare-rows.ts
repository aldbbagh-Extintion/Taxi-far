import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { jd, km, mmss } from './format';

export interface FareParts {
  base: number;
  distanceKm: number;
  distCharge: number;
  waitingSec: number;
  waitCharge: number;
  minApplied: boolean;
  fare: number;
}

/** Breakdown rows: فتحة العداد / المسافة / الانتظار / الحد الأدنى + الإجمالي. */
@Component({
  selector: 'app-fare-rows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = parts();
    <div class="rows">
      <div class="row"><span>فتحة العداد</span><span><span class="num">{{ jd(p.base) }}</span> د.أ</span></div>
      <div class="row">
        <span>المسافة (<span class="num">{{ km(p.distanceKm) }}</span> كم)</span>
        <span><span class="num">{{ jd(p.distCharge) }}</span> د.أ</span>
      </div>
      <div class="row">
        <span>وقت الانتظار (<span class="num">{{ mmss(p.waitingSec) }}</span>)</span>
        <span><span class="num">{{ jd(p.waitCharge) }}</span> د.أ</span>
      </div>
      @if (p.minApplied) {
        <div class="row min"><span>تم تطبيق الحد الأدنى للأجرة</span><span><span class="num">{{ jd(p.fare) }}</span> د.أ</span></div>
      }
    </div>
    <div class="row-total" [class.big]="big()">
      <span>{{ totalLabel() }}</span>
      <span class="total"><span class="num">{{ jd(p.fare) }}</span> د.أ</span>
    </div>
  `,
  styles: `
    :host { display: block; }
    .row-total { margin-top: 1rem; }
    .row-total .total { color: var(--total-num); }
    .row-total.big { font-size: 1.125rem; }
    .row-total.big .total { color: var(--primary); font-size: 1.5rem; }
    .min > :first-child { color: var(--warn); }
  `,
})
export class FareRows {
  readonly parts = input.required<FareParts>();
  readonly totalLabel = input('الإجمالي');
  /** Large yellow total (bottom-sheet style). */
  readonly big = input(false);
  protected readonly jd = jd;
  protected readonly km = km;
  protected readonly mmss = mmss;
}
