/* التحقق من التعرفة — نفس قواعد زر الحفظ (sSave) بالنسخة الأصلية */
import type { Tariff } from '../contracts';
import { cloneDefaultTariff } from './fare-engine';

export const TARIFF_INVALID_MSG = 'في قيمة غلط، تأكد من الأرقام.';

/** يرجع تعرفة نظيفة (version = 'custom' مثل الأصل) أو يرمي Error برسالة عربية */
export function validateTariff(t: Tariff): Tariff {
  const vals = [
    t?.day?.base,
    t?.night?.base,
    t?.day?.perKm,
    t?.night?.perKm,
    t?.day?.waitPer35s,
    t?.night?.waitPer35s,
    t?.minFare,
  ].map(Number);
  const hs = [t?.dayStartHour, t?.nightStartHour].map(Number);
  if (
    vals.some((v) => !isFinite(v) || v < 0) ||
    hs.some((h) => !(Number.isInteger(h) && h >= 0 && h <= 23)) ||
    hs[0] === hs[1]
  ) {
    throw new Error(TARIFF_INVALID_MSG);
  }
  return {
    version: 'custom',
    dayStartHour: hs[0],
    nightStartHour: hs[1],
    day: { base: vals[0], perKm: vals[2], waitPer35s: vals[4] },
    night: { base: vals[1], perKm: vals[3], waitPer35s: vals[5] },
    minFare: vals[6],
  };
}

/** نفس getTariff بالأصل: المحفوظة إذا صالحة، غير هيك الافتراضية */
export function effectiveTariff(stored: Tariff | null | undefined): Tariff {
  return stored && stored.day && stored.night ? stored : cloneDefaultTariff();
}
