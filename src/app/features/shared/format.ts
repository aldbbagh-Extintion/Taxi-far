/* UI-local formatting helpers (tiny copies so features don't block on core). */
import { Period, Tariff } from '../../contracts';

/** 3-decimal Jordanian dinar string, e.g. 2.450 */
export const jd = (n: number | null | undefined): string =>
  (Math.round((Number(n) || 0) * 1000) / 1000).toFixed(3);

/** mm:ss or h:mm:ss */
export const mmss = (s: number | null | undefined): string => {
  let v = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), x = v % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
};

const LOCALE = 'ar-JO-u-nu-latn';

export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

export const fmtDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

export const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });

export const km = (n: number | null | undefined): string => (Number(n) || 0).toFixed(2);

export const minutes = (sec: number): number => Math.max(0, Math.round(sec / 60));

export const periodName = (p: Period): string => (p === 'day' ? 'تعرفة نهارية' : 'تعرفة ليلية');

export const monthKey = (ms: number): string => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};

export const monthLabel = (key: string): string => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
};

/** Which tariff period applies at a given time (mirrors the original periodFor). */
export function periodAt(date: Date, t: Tariff): Period {
  const h = date.getHours();
  const d = t.dayStartHour, n = t.nightStartHour;
  if (d < n) return h >= d && h < n ? 'day' : 'night';
  return h >= n && h < d ? 'night' : 'day';
}
