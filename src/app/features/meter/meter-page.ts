import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LOCATION_TRACKER, MeterStatus, TRIP_SESSION } from '../../contracts';
import { FareParts } from '../shared/fare-rows';
import { fmtDate, jd, km, mmss, periodAt, periodName } from '../shared/format';
import { ConfirmService, ToastService, uiFlag } from '../shared/ui.services';
import { FareSheet } from './fare-sheet';

const TIP_KEY = 'ui_tip_battery_v1';

const STATUS: Record<MeterStatus, { text: string; cls: string }> = {
  idle: { text: 'متوقفة', cls: 'idle' },
  searching: { text: 'يبحث عن الموقع…', cls: 'searching' },
  moving: { text: 'يتحرك', cls: 'moving' },
  waiting: { text: 'في الانتظار', cls: 'waiting' },
  stopped: { text: 'انتهت الرحلة', cls: 'idle' },
};

@Component({
  selector: 'app-meter-page',
  imports: [FareSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meter-page.html',
  styleUrl: './meter-page.scss',
})
export class MeterPage {
  protected readonly session = inject(TRIP_SESSION);
  private readonly tracker = inject(LOCATION_TRACKER);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly sheetOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly tipVisible = signal(!uiFlag.get(TIP_KEY));

  protected readonly running = computed(() => {
    const s = this.session.status();
    return s === 'searching' || s === 'moving' || s === 'waiting';
  });
  protected readonly status = computed(() => STATUS[this.session.status()] ?? STATUS.idle);
  protected readonly summary = this.session.summary;
  protected readonly period = computed(
    () => this.summary()?.period ?? periodAt(new Date(), this.session.tariff()),
  );
  protected readonly gpsText = computed(() => this.session.gpsText() || 'الموقع متوقف');
  protected readonly parts = computed<FareParts>(() => {
    const s = this.summary();
    return s ?? { base: 0, distanceKm: 0, distCharge: 0, waitingSec: 0, waitCharge: 0, minApplied: false, fare: 0 };
  });

  protected readonly jd = jd;
  protected readonly km = km;
  protected readonly mmss = mmss;
  protected readonly fmtDate = fmtDate;
  protected readonly periodName = periodName;

  protected async toggleTrip(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (this.running()) {
        await this.session.stop();
      } else {
        if (this.session.pending()) {
          const ok = await this.confirm.ask({
            message: 'في رحلة منتهية ما انحفظت. بدك تتجاهلها وتبلش رحلة جديدة؟',
            okText: 'تجاهل وابدأ',
          });
          if (!ok) return;
          this.session.discardPending();
        }
        await this.session.start();
      }
    } catch (e) {
      this.toast.show(errText(e, 'ما قدرت أشغّل العداد.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async resetTrip(): Promise<void> {
    if (this.running()) {
      const ok = await this.confirm.ask({
        title: 'إعادة ضبط العداد؟',
        message: 'الرحلة الحالية رح تنلغى وما رح تنحفظ.',
        okText: 'إعادة ضبط',
        danger: true,
      });
      if (!ok) return;
    }
    try { await this.session.reset(); } catch (e) { this.toast.show(errText(e, 'صار خطأ.')); }
  }

  protected async resume(): Promise<void> {
    try { await this.session.resumeUnfinished(); } catch (e) { this.toast.show(errText(e, 'ما قدرت أكمّل الرحلة.')); }
  }

  protected async discardUnfinished(): Promise<void> {
    const ok = await this.confirm.ask({ message: 'حذف الرحلة اللي ما انتهت؟ ما رح تنحفظ.', okText: 'احذفها', danger: true });
    if (ok) await this.session.discardUnfinished();
  }

  protected openResult(): void { this.router.navigateByUrl('/trip-result'); }

  protected dismissTip(): void {
    uiFlag.set(TIP_KEY);
    this.tipVisible.set(false);
  }

  protected async openBattery(): Promise<void> {
    try { await this.tracker.openBatterySettings(); } catch { /* no-op on web */ }
  }
}

export function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : typeof e === 'string' && e ? e : fallback;
}
