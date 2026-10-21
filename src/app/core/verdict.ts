/* مقارنة تقدير التطبيق مع قراءة العداد الحقيقي — نفس منطق الأصل */
import { jd } from './format';

export interface Verdict {
  cls: 'ok' | 'bad' | 'warn';
  short: string;
  text: string;
}

export function verdict(est: number, meter: number): Verdict {
  const diff = meter - est,
    pct = est > 0 ? (diff / est) * 100 : 0;
  // هامش: 8% أو 10 قروش، أيهما أكبر (دقة GPS + تقريب العداد)
  const tol = Math.max(0.1, est * 0.08);
  if (Math.abs(diff) <= tol)
    return {
      cls: 'ok',
      short: 'منطقي',
      text: `العداد قريب من التقدير (فرق ${jd(diff)} د.أ، ${pct.toFixed(0)}%). يبدو سليم.`,
    };
  if (diff > 0)
    return {
      cls: 'bad',
      short: 'أعلى',
      text: `العداد أعلى من التقدير بـ ${jd(diff)} د.أ (${pct.toFixed(0)}%). ممكن يكون في مبالغة، أو الـ GPS قصّر بالمسافة.`,
    };
  return {
    cls: 'warn',
    short: 'أقل',
    text: `العداد أقل من التقدير بـ ${jd(-diff)} د.أ (${pct.toFixed(0)}%).`,
  };
}
