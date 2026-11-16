import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { LOCATION_TRACKER, ProfileId, TariffProfile, TRIP_SESSION } from '../../contracts';
import { PROFILE_IDS, PROFILE_NAMES } from '../../core';
import { ThemeMode, ThemeService, ToastService } from '../shared/ui.services';

type Key = 'dBase' | 'nBase' | 'dKm' | 'nKm' | 'dWait' | 'nWait' | 'dayH' | 'nightH' | 'min';
interface FieldDef { key: Key; label: string; step: string; min?: string; max?: string; int?: boolean; }

const FIELDS: FieldDef[] = [
  { key: 'dBase', label: 'فتحة العداد نهارًا (د.أ)', step: '0.001' },
  { key: 'nBase', label: 'فتحة العداد ليلًا (د.أ)', step: '0.001' },
  { key: 'dKm', label: 'الكيلومتر نهارًا (د.أ)', step: '0.001' },
  { key: 'nKm', label: 'الكيلومتر ليلًا (د.أ)', step: '0.001' },
  { key: 'dWait', label: 'انتظار/35ث نهارًا (د.أ)', step: '0.001' },
  { key: 'nWait', label: 'انتظار/35ث ليلًا (د.أ)', step: '0.001' },
  { key: 'dayH', label: 'بداية النهار (ساعة)', step: '1', min: '0', max: '23', int: true },
  { key: 'nightH', label: 'بداية الليل (ساعة)', step: '1', min: '0', max: '23', int: true },
  { key: 'min', label: 'الحد الأدنى للأجرة (0 = بدون)', step: '0.01', min: '0' },
];

/** ملف «سيارتي»: تعرفة واحدة، 4 حقول */
const FLAT_FIELDS: FieldDef[] = [
  { key: 'dBase', label: 'فتحة العداد (د.أ)', step: '0.001' },
  { key: 'dKm', label: 'الكيلومتر (د.أ)', step: '0.001' },
  { key: 'dWait', label: 'انتظار/35ث (د.أ)', step: '0.001' },
  { key: 'min', label: 'الحد الأدنى للأجرة (0 = بدون)', step: '0.01', min: '0' },
];

const TABS: { id: ProfileId; name: string }[] = PROFILE_IDS.map((id) => ({ id, name: PROFILE_NAMES[id] }));

const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: 'auto', label: 'تلقائي' },
  { mode: 'light', label: 'فاتح' },
  { mode: 'dark', label: 'داكن' },
];

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly session = inject(TRIP_SESSION);
  private readonly tracker = inject(LOCATION_TRACKER);
  private readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  protected readonly tabs = TABS;
  protected readonly themes = THEMES;
  protected readonly selTab = signal<ProfileId>(this.session.profiles().active);
  protected readonly isFlat = computed(() => this.selTab() === 'mycar');
  protected readonly fields = computed(() => (this.isFlat() ? FLAT_FIELDS : FIELDS));
  protected readonly activeId = computed(() => this.session.profiles().active);
  protected readonly values = signal<Record<Key, string>>(toForm(this.profile(this.selTab())));
  protected readonly msg = signal<{ text: string; err: boolean } | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    // لما الملفات تتغير (حفظ/إعادة ضبط) أو التبويب: نعبّي الحقول من الملف المختار
    effect(() => this.values.set(toForm(this.session.profiles().profiles[this.selTab()])));
  }

  private profile(id: ProfileId): TariffProfile {
    return this.session.profiles().profiles[id];
  }

  protected selectTab(id: ProfileId): void {
    this.selTab.set(id);
    this.msg.set(null);
  }

  protected setVal(k: Key, v: string): void {
    this.values.update((o) => ({ ...o, [k]: v }));
    this.msg.set(null);
  }

  protected async save(): Promise<void> {
    const v = this.values(), n = (k: Key) => parseFloat(v[k]), i = (k: Key) => parseInt(v[k], 10);
    const id = this.selTab(), name = PROFILE_NAMES[id];
    const p: TariffProfile =
      id === 'mycar'
        ? { id, name, version: 'custom', flat: { base: n('dBase'), perKm: n('dKm'), waitPer35s: n('dWait') }, minFare: n('min') }
        : {
            id, name, version: 'custom',
            dayStartHour: i('dayH'),
            nightStartHour: i('nightH'),
            day: { base: n('dBase'), perKm: n('dKm'), waitPer35s: n('dWait') },
            night: { base: n('nBase'), perKm: n('nKm'), waitPer35s: n('nWait') },
            minFare: n('min'),
          };
    this.saving.set(true);
    try {
      await this.session.setProfile(p);
      this.msg.set({ text: 'انحفظت وصارت «' + name + '» هي المستخدمة. بتنطبق من الرحلة الجاية.', err: false });
    } catch (e) {
      this.msg.set({ text: e instanceof Error && e.message ? e.message : 'في قيمة غلط، تأكد من الأرقام.', err: true });
    } finally {
      this.saving.set(false);
    }
  }

  protected async resetDefaults(): Promise<void> {
    const id = this.selTab();
    try {
      await this.session.resetProfile(id);
      this.values.set(toForm(this.profile(id)));
      this.msg.set({ text: 'رجعت القيم الافتراضية لـ «' + PROFILE_NAMES[id] + '».', err: false });
    } catch (e) {
      this.msg.set({ text: e instanceof Error ? e.message : 'صار خطأ.', err: true });
    }
  }

  protected async openBattery(): Promise<void> {
    try {
      await this.tracker.openBatterySettings();
      if (!this.tracker.isNative) this.toast.show('هالإعداد متوفر على تطبيق أندرويد بس.');
    } catch { /* ignore */ }
  }
}

function toForm(t: TariffProfile): Record<Key, string> {
  if ('flat' in t) {
    return {
      dBase: String(t.flat.base), nBase: '', dKm: String(t.flat.perKm), nKm: '',
      dWait: String(t.flat.waitPer35s), nWait: '', dayH: '', nightH: '', min: String(t.minFare),
    };
  }
  return {
    dBase: String(t.day.base), nBase: String(t.night.base),
    dKm: String(t.day.perKm), nKm: String(t.night.perKm),
    dWait: String(t.day.waitPer35s), nWait: String(t.night.waitPer35s),
    dayH: String(t.dayStartHour), nightH: String(t.nightStartHour),
    min: String(t.minFare),
  };
}
