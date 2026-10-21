/* أدوات عرض — نفس دوال النسخة الأصلية */
import type { Period } from '../contracts';

export const jd = (n: number): string => (Math.round(n * 1000) / 1000).toFixed(3);

export const mmss = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
};

export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleString('ar-JO', { dateStyle: 'medium', timeStyle: 'short' });

export const periodName = (p: Period): string => (p === 'day' ? 'تعرفة نهارية' : 'تعرفة ليلية');

export const monthKey = (ms: number): string => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
