/* trip-session.service.ts — منسّق الرحلة (signals) — بيطبق TripSession من contracts.ts
 * نفس سلوك النسخة الأصلية: بدء/إنهاء، استكمال رحلة غير منتهية، الحفظ، إعدادات التعرفة.
 */
import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import {
  FareSummary,
  GpsFix,
  LOCATION_TRACKER,
  MeterStatus,
  SavedTrip,
  TRIP_REPOSITORY,
  Tariff,
  TripSession,
} from '../contracts';
import {
  EngineTrip,
  addFix,
  cloneDefaultTariff,
  createTrip,
  isEngineTrip,
  lastSegmentKind,
  roundFils,
  summary as fareSummary,
} from './fare-engine';
import { jd, mmss } from './format';
import { RoutePoint, appendRoutePoint, downsampleRoute } from './route';
import { effectiveTariff, validateTariff } from './tariff';

export { verdict } from './verdict';
export type { Verdict } from './verdict';

/** شكل الرحلة الشغّالة المحفوظة بالقاعدة */
interface ActiveState {
  v: 1;
  trip: EngineTrip;
  route: RoutePoint[];
}

function parseActive(raw: unknown): ActiveState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<ActiveState>;
  if (isEngineTrip(o.trip)) return { v: 1, trip: o.trip, route: Array.isArray(o.route) ? o.route : [] };
  if (isEngineTrip(raw)) return { v: 1, trip: raw, route: [] }; // صيغة قديمة: الرحلة مباشرة
  return null;
}

const PERSIST_MIN_MS = 3000;
const NOTIFY_EVERY_TICKS = 5;
const NOTIFY_TITLE = 'عداد التاكسي — الرحلة شغّالة';
const MSG_SAVE_FAILED = 'ما قدرت أحفظ — مساحة التخزين ممتلئة أو محظورة.';
const MSG_DB_FAILED = 'ما قدرت أفتح قاعدة البيانات المحلية.';

@Injectable()
export class TripSessionService implements TripSession, OnDestroy {
  private readonly tracker = inject(LOCATION_TRACKER);
  private readonly repo = inject(TRIP_REPOSITORY);

  private readonly _status = signal<MeterStatus>('idle');
  private readonly _summary = signal<FareSummary | null>(null);
  private readonly _gpsText = signal('');
  private readonly _warning = signal('');
  private readonly _pending = signal<SavedTrip | null>(null);
  private readonly _hasUnfinished = signal<number | null>(null);
  private readonly _route = signal<[number, number][]>([]);
  private readonly _tariff = signal<Tariff>(cloneDefaultTariff());

  readonly status = this._status.asReadonly();
  readonly summary = this._summary.asReadonly();
  readonly gpsText = this._gpsText.asReadonly();
  readonly warning = this._warning.asReadonly();
  readonly pending = this._pending.asReadonly();
  readonly hasUnfinished = this._hasUnfinished.asReadonly();
  readonly route = this._route.asReadonly();
  readonly tariff = this._tariff.asReadonly();

  private trip: EngineTrip | null = null;
  private routePts: RoutePoint[] = [];
  private unfinished: ActiveState | null = null;

  private unsubFix: (() => void) | null = null;
  private unsubErr: (() => void) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private lastAcc: number | null = null;
  private speedSeen = false;
  private gpsWarn = false;
  private hiddenAt: number | null = null;

  private lastPersistMs = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  private initPromise: Promise<void> | null = null;
  private busy = false; // start/stop/resume بنفس الوقت

  private readonly onVisibility = () => void this.handleVisibility();

  /* ================= init ================= */
  init(): Promise<void> {
    return (this.initPromise ??= this.doInit());
  }

  private async doInit(): Promise<void> {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    try {
      await this.repo.init();
      this._tariff.set(effectiveTariff(await this.repo.getTariff()));
      this.unfinished = parseActive(await this.repo.getActiveTrip());
    } catch (e) {
      console.error('[core] repository init failed', e);
      this._warning.set(MSG_DB_FAILED);
      return;
    }
    if (!this.unfinished) return;
    // إذا خدمة الموقع لسا شغّالة (النظام سكّر الواجهة بس)، الرحلة فعليًا مستمرة: بنكمّلها تلقائيًا
    let running = false;
    try {
      running = await this.tracker.isRunning();
    } catch {
      running = false;
    }
    if (running) await this.resumeUnfinished();
    else this._hasUnfinished.set(this.unfinished.trip.startMs);
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.detach();
  }

  /* ================= start / stop ================= */
  async start(): Promise<void> {
    if (this.trip || this.busy) return;
    this.busy = true;
    try {
      this._warning.set('');
      if (!(await this.ensureLocationPermission())) return;
      this._pending.set(null); // مثل الأصل: رحلة جديدة بتلغي النتيجة غير المحفوظة (الواجهة بتأكد قبل)
      this.unfinished = null;
      this._hasUnfinished.set(null);
      try { await this.tracker.drainBufferedFixes(); } catch { /* مخزن قديم من رحلة سابقة: بنرميه */ }
      this.trip = createTrip(Date.now(), this._tariff());
      this.routePts = [];
      this._route.set([]);
      this.speedSeen = false;
      this.lastAcc = null;
      this.gpsWarn = false;
      this.hiddenAt = null;
      await this.persistNow();
      if (!(await this.startTracking())) {
        this.trip = null;
        await this.enqueueWrite(() => this.repo.saveActiveTrip(null));
        this.toIdle(false);
      }
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.trip || this.busy) return;
    this.busy = true;
    try {
      await this.drain(); // القراءات المخزّنة بالخدمة قبل الحساب النهائي
      const trip = this.trip;
      if (!trip) return;
      const end = Date.now();
      this.detach();
      const s = fareSummary(trip, end);
      const pending: SavedTrip = {
        id: String(trip.startMs),
        start: trip.startMs,
        end,
        period: s.period,
        distanceKm: +s.distanceKm.toFixed(3),
        durationSec: Math.round(s.durationSec),
        waitingSec: Math.round(s.waitingSec),
        base: +s.base.toFixed(3),
        distCharge: +s.distCharge.toFixed(3),
        waitCharge: +s.waitCharge.toFixed(3),
        fare: roundFils(s.fare),
        minApplied: s.minApplied,
        gapSec: Math.round(s.gapSec),
        fixes: s.fixes,
        tariff: trip.tariffVersion,
        rate: { ...trip.rate },
        meter: null,
        note: '',
        route: downsampleRoute(this.routePts),
      };
      this.trip = null;
      await this.stopTracker();
      await this.enqueueWrite(() => this.repo.saveActiveTrip(null));
      this._summary.set(s);
      this._gpsText.set('');
      this._pending.set(pending);
      this._status.set('stopped');
    } finally {
      this.busy = false;
    }
  }

  async reset(): Promise<void> {
    this.detach();
    this.trip = null;
    this.routePts = [];
    this._route.set([]);
    await this.stopTracker();
    await this.enqueueWrite(() => this.repo.saveActiveTrip(null));
    this._pending.set(null);
    this.toIdle(true);
  }

  /* ================= رحلة غير منتهية ================= */
  async resumeUnfinished(): Promise<void> {
    if (this.trip || this.busy) return;
    this.busy = true;
    try {
      const st = this.unfinished ?? parseActive(await this.repo.getActiveTrip());
      if (!st) {
        this._hasUnfinished.set(null);
        return;
      }
      this._hasUnfinished.set(null);
      if (!(await this.ensureLocationPermission())) {
        this._hasUnfinished.set(st.trip.startMs);
        return;
      }
      this.unfinished = null;
      this.trip = st.trip;
      this.routePts = st.route.slice();
      this._route.set(this.routePts.slice());
      this._pending.set(null);
      if (!(await this.startTracking())) {
        this.trip = null;
        this.unfinished = st;
        this._hasUnfinished.set(st.trip.startMs);
        this.toIdle(false);
        return;
      }
      await this.drain();
    } finally {
      this.busy = false;
    }
  }

  async discardUnfinished(): Promise<void> {
    this.unfinished = null;
    this._hasUnfinished.set(null);
    await this.enqueueWrite(() => this.repo.saveActiveTrip(null));
    if (!this.trip) await this.stopTracker();
  }

  /* ================= النتيجة ================= */
  async savePending(meter: number | null, note: string): Promise<SavedTrip | null> {
    const p = this._pending();
    if (!p) return null;
    const saved: SavedTrip = {
      ...p,
      meter: meter != null && isFinite(meter) && meter > 0 ? meter : null,
      note: (note ?? '').trim(),
    };
    try {
      await this.repo.saveTrip(saved);
    } catch (e) {
      console.error('[core] saveTrip failed', e);
      this._warning.set(MSG_SAVE_FAILED);
      return null;
    }
    this._pending.set(null);
    this.toIdle(false);
    return saved;
  }

  discardPending(): void {
    this._pending.set(null);
    if (!this.trip) this.toIdle(false);
  }

  /* ================= التعرفة ================= */
  async setTariff(t: Tariff | null): Promise<void> {
    if (t == null) {
      await this.repo.saveTariff(null);
      this._tariff.set(cloneDefaultTariff());
      return;
    }
    const clean = validateTariff(t); // بيرمي Error برسالة عربية إذا في قيمة غلط
    await this.repo.saveTariff(clean);
    this._tariff.set(clean); // بتنطبق من الرحلة الجاية
  }

  /* ================= داخلي ================= */
  private async ensureLocationPermission(): Promise<boolean> {
    try {
      const perms = await this.tracker.requestPermissions();
      if (perms.location === 'denied') {
        this._warning.set(
          this.tracker.isNative
            ? 'رفضت إذن الموقع. فعّله من إعدادات التطبيق عشان العداد يشتغل.'
            : 'رفضت إذن الموقع. فعّله من إعدادات المتصفح عشان العداد يشتغل.',
        );
        return false;
      }
    } catch (e) {
      console.warn('[core] requestPermissions failed', e);
    }
    return true;
  }

  private async startTracking(): Promise<boolean> {
    this.detach();
    this.unsubFix = this.tracker.onFix((f) => this.onFix(f));
    this.unsubErr = this.tracker.onError((m) => {
      this.gpsWarn = true;
      this._warning.set(m);
    });
    try {
      if (!(await this.tracker.isRunning())) await this.tracker.start();
    } catch (e) {
      this.detach();
      const msg = e instanceof Error && e.message ? e.message : '';
      this._warning.set(msg || 'ما قدرت أشغّل تحديد الموقع.');
      return false;
    }
    this.tickCount = 0;
    this.ticker = setInterval(() => this.tick(), 1000);
    this.refresh();
    return true;
  }

  /** يفصل الاشتراكات والمؤقتات (بدون ما يوقف الخدمة) */
  private detach(): void {
    this.unsubFix?.();
    this.unsubErr?.();
    this.unsubFix = this.unsubErr = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
  }

  private async stopTracker(): Promise<void> {
    try {
      await this.tracker.stop();
    } catch (e) {
      console.warn('[core] tracker.stop failed', e);
    }
  }

  private toIdle(clearWarning: boolean): void {
    this._summary.set(null);
    this._gpsText.set('');
    this._status.set(this._pending() ? 'stopped' : 'idle');
    if (clearWarning) this._warning.set('');
  }

  private onFix(fix: GpsFix): void {
    if (!this.trip) return;
    this.ingest(fix);
    this.persistThrottled();
    this.refresh();
  }

  /** نفس onPos بالأصل + نقاط المسار */
  private ingest(fix: GpsFix): void {
    const trip = this.trip;
    if (!trip) return;
    // الخدمة الأصلية ما بتفضّي المخزن عند البدء: أي قراءة أقدم من بداية الرحلة (أو قديمة جدًا بعد ما بلشت) بتنرمى
    if (fix.ts < trip.startMs - 2000) return;
    this.lastAcc = fix.accuracy;
    if (this.gpsWarn) {
      this.gpsWarn = false;
      this._warning.set('');
    }
    if (typeof fix.speed === 'number' && isFinite(fix.speed)) this.speedSeen = true;
    if (addFix(trip, fix) === 'ok' && appendRoutePoint(this.routePts, fix.lat, fix.lon)) {
      this._route.set(this.routePts.slice());
    }
  }

  /** يجيب القراءات اللي تخزّنت بالخدمة لما التطبيق كان بالخلفية */
  private async drain(): Promise<void> {
    if (!this.trip) return;
    let fixes: GpsFix[] = [];
    try {
      fixes = await this.tracker.drainBufferedFixes();
    } catch (e) {
      console.warn('[core] drainBufferedFixes failed', e);
      return;
    }
    if (!this.trip || !fixes?.length) return;
    for (const f of [...fixes].sort((a, b) => a.ts - b.ts)) this.ingest(f); // المكرر بيترفض بالمحرك
    await this.persistNow();
    this.refresh();
  }

  private tick(): void {
    if (!this.trip) return;
    this.refresh();
    if (++this.tickCount % NOTIFY_EVERY_TICKS === 0) {
      const s = this._summary();
      if (s) {
        this.tracker
          .updateNotification(NOTIFY_TITLE, `${jd(s.fare)} د.أ · ${s.distanceKm.toFixed(2)} كم`)
          .catch(() => {});
      }
    }
  }

  private refresh(): void {
    const trip = this.trip;
    if (!trip) return;
    const s = fareSummary(trip, Date.now());
    this._summary.set(s);

    let status: MeterStatus;
    if (!trip.fixes) status = 'searching';
    else status = lastSegmentKind(trip) === 'distance' ? 'moving' : 'waiting';
    this._status.set(status);

    let g: string;
    if (!trip.fixes) g = 'بيدوّر على الموقع…';
    else if (s.lastFixAgeSec > 15) g = 'ما في إشارة من ' + Math.round(s.lastFixAgeSec) + ' ث';
    else g = 'دقة الموقع ' + Math.round(this.lastAcc ?? 0) + ' م' + (this.speedSeen ? ' · سرعة الجهاز' : '');
    this._gpsText.set(g);
  }

  private async handleVisibility(): Promise<void> {
    if (!this.trip) return;
    if (document.hidden) {
      this.hiddenAt = Date.now();
      await this.persistNow();
      return;
    }
    const hiddenAt = this.hiddenAt;
    this.hiddenAt = null;
    await this.drain();
    // بالمتصفح ما في خدمة بالخلفية: نفس تحذير الأصل
    if (hiddenAt && !this.tracker.isNative) {
      const sec = (Date.now() - hiddenAt) / 1000;
      if (sec > 10) {
        this._warning.set(
          `التطبيق كان بالخلفية ${mmss(sec)}. لو السيارة كانت ماشية، المسافة بهالفترة انحسبت كخط مستقيم وممكن تكون أقل من الحقيقة.`,
        );
      }
    }
    this.refresh();
  }

  /* ---- حفظ الرحلة الشغّالة (أقصى مرة كل 3 ث) ---- */
  private persistThrottled(): void {
    if (!this.trip) return;
    const wait = PERSIST_MIN_MS - (Date.now() - this.lastPersistMs);
    if (wait <= 0) {
      void this.persistNow();
    } else if (!this.persistTimer) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        void this.persistNow();
      }, wait);
    }
  }

  private persistNow(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.trip) return Promise.resolve();
    this.lastPersistMs = Date.now();
    // نسخة لحظية عشان الكتابة غير المتزامنة ما تشوف حالة متغيرة
    const snap = JSON.parse(
      JSON.stringify({ v: 1, trip: this.trip, route: downsampleRoute(this.routePts, 2000) }),
    ) as ActiveState;
    return this.enqueueWrite(() => this.repo.saveActiveTrip(snap));
  }

  /** الكتابات على active trip بالترتيب (عشان حفظ قديم ما يرجّع رحلة انمسحت) */
  private enqueueWrite(op: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(op).catch((e) => {
      console.error('[core] active trip write failed', e);
    });
    return this.writeChain;
  }
}
