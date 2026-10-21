import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SavedTrip, TRIP_REPOSITORY } from '../../contracts';
import { exportCsv, verdict } from '../shared/core-bridge';
import { fmtDate, jd, km, mmss, monthKey, monthLabel, periodName } from '../shared/format';
import { ConfirmService, ToastService } from '../shared/ui.services';

interface Row { t: SavedTrip; v: ReturnType<typeof verdict> | null; }

@Component({
  selector: 'app-history-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './history-page.html',
  styleUrl: './history-page.scss',
})
export class HistoryPage {
  private readonly repo = inject(TRIP_REPOSITORY);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  protected readonly trips = signal<SavedTrip[] | null>(null);
  protected readonly selected = signal<string>('');

  protected readonly months = computed(() =>
    [...new Set((this.trips() ?? []).map((t) => monthKey(t.start)))].sort().reverse(),
  );
  protected readonly month = computed(() => {
    const ms = this.months(), s = this.selected();
    return ms.includes(s) ? s : (ms[0] ?? '');
  });
  protected readonly rows = computed<Row[]>(() =>
    (this.trips() ?? [])
      .filter((t) => monthKey(t.start) === this.month())
      .sort((a, b) => b.start - a.start)
      .map((t) => ({ t, v: t.meter ? verdict(t.fare, t.meter) : null })),
  );
  protected readonly total = computed(() => this.rows().reduce((s, r) => s + (r.t.meter ?? r.t.fare), 0));

  protected readonly jd = jd;
  protected readonly km = km;
  protected readonly mmss = mmss;
  protected readonly fmtDate = fmtDate;
  protected readonly periodName = periodName;
  protected readonly monthLabel = monthLabel;

  constructor() { this.load(); }

  private async load(): Promise<void> {
    try {
      const list = await this.repo.listTrips();
      const focus = this.route.snapshot.queryParamMap.get('trip');
      const hit = focus ? list.find((t) => t.id === focus) : undefined;
      if (hit) this.selected.set(monthKey(hit.start));
      this.trips.set(list);
    } catch {
      this.trips.set([]);
      this.toast.show('ما قدرت أقرأ السجل.');
    }
  }

  protected pick(m: string): void { this.selected.set(m); }

  protected async exportAll(): Promise<void> {
    try { await exportCsv(this.trips() ?? []); }
    catch (e) { this.toast.show(e instanceof Error && e.message ? e.message : 'ما قدرت أصدّر الملف.'); }
  }

  protected async clearAll(): Promise<void> {
    if (!(this.trips() ?? []).length) { this.toast.show('السجل فاضي.'); return; }
    const ok = await this.confirm.ask({
      title: 'مسح كل السجل؟',
      message: 'رح ينمسح كل السجل نهائيًا. صدّره قبل إذا بدك. متأكد؟',
      okText: 'امسح الكل',
      danger: true,
    });
    if (!ok) return;
    try { await this.repo.clearTrips(); this.trips.set([]); this.toast.show('انمسح السجل.'); }
    catch { this.toast.show('ما قدرت أمسح السجل.'); }
  }
}
