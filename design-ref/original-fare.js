/* fare.js — محرك حساب أجرة التاكسي (يشتغل بالمتصفح وبـ Node للاختبار)
 *
 * طريقة الحساب مثل العداد الحقيقي (Crossover meter):
 * كل مقطع بين قراءتين GPS بينحسب إما بالمسافة أو بالوقت، أيهما أعلى.
 * - السيارة ماشية بسرعة  → أجرة المسافة أعلى  → بينحسب بالكيلومتر
 * - السيارة واقفة/بطيئة → أجرة الوقت أعلى    → بينحسب انتظار
 * هيك ما في ازدواج (مسافة + انتظار بنفس اللحظة)، وما في عتبة سرعة عشوائية.
 */
(function (root) {
  'use strict';

  // ===== التعرفة الافتراضية (تحققت منها بتاريخ 2026-10-18) =====
  // فتحة العداد والكيلومتر: تعرفة 11 أيار 2026 (المملكة / نقابة التكسي)
  // الانتظار: آخر قيمة رسمية معلنة (هيئة تنظيم النقل البري، حزيران 2025) — لم يُعلن تغيير عليها
  // الحد الأدنى للأجرة (1.00 د.أ) ومواعيد الفترتين (8:00 نهاري، 20:00 ليلي): نفس قيم النسخة الأصلية
  const DEFAULT_TARIFF = {
    version: '2026-05-11',
    dayStartHour: 8,     // بداية الفترة النهارية (شامل)
    nightStartHour: 20,  // بداية الفترة الليلية (شامل)
    day:   { base: 0.390, perKm: 0.280, waitPer35s: 0.028 },
    night: { base: 0.400, perKm: 0.330, waitPer35s: 0.032 },
    minFare: 1.00       // الحد الأدنى للأجرة
  };

  // ===== إعدادات فلترة GPS =====
  const GPS = {
    maxAccuracyM: 35,      // تجاهل أي قراءة دقتها أسوأ من 35 متر
    minMoveM: 8,           // أقل من هيك = تذبذب، السيارة واقفة
    maxSpeedKmh: 180       // أي قفزة أسرع من هيك = قراءة غلط
  };

  function haversineM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function periodFor(date, tariff) {
    const h = date.getHours();
    const isDay = tariff.dayStartHour < tariff.nightStartHour
      ? (h >= tariff.dayStartHour && h < tariff.nightStartHour)
      : (h >= tariff.dayStartHour || h < tariff.nightStartHour);
    return isDay ? 'day' : 'night';
  }

  // سعر ثانية الانتظار، وسرعة التحول بين الحسابين
  function ratesOf(t) {
    const perSec = t.waitPer35s / 35;
    const crossoverKmh = (perSec * 3600) / t.perKm;
    return { perSec, crossoverKmh };
  }

  /* ===== رحلة ===== */
  function createTrip(startMs, tariff) {
    tariff = tariff || DEFAULT_TARIFF;
    const period = periodFor(new Date(startMs), tariff);
    return {
      startMs,
      period,
      rate: Object.assign({}, tariff[period]),
      minFare: Number(tariff.minFare) || 0,
      tariffVersion: tariff.version || 'custom',
      anchor: null,          // آخر نقطة معتمدة للمسافة
      lastFixMs: startMs,    // آخر وقت انحسب لغايته
      distanceM: 0,          // المسافة الكلية المقطوعة
      distChargeJD: 0,
      waitChargeJD: 0,
      waitingSec: 0,         // الوقت اللي انحسب انتظار
      fixes: 0,
      rejected: 0,
      gapSec: 0              // فترات انقطاع الـ GPS (> 20 ثانية بين قراءتين)
    };
  }

  // يحسب مقطع زمني dt مع مسافة d بالمتر (d ممكن تكون صفر)
  function chargeSegment(trip, dtSec, dM) {
    if (dtSec <= 0) return;
    const { perSec } = ratesOf(trip.rate);
    const distCost = (dM / 1000) * trip.rate.perKm;
    const timeCost = dtSec * perSec;
    if (timeCost >= distCost) {
      trip.waitChargeJD += timeCost;
      trip.waitingSec += dtSec;
    } else {
      trip.distChargeJD += distCost;
    }
    trip.distanceM += dM;
  }

  // متوسط آخر عدة قراءات (بيخفف التذبذب العشوائي)
  function smoothed(buf) {
    let lat = 0, lon = 0, acc = 0;
    for (const p of buf) { lat += p.lat; lon += p.lon; acc += p.acc; }
    const n = buf.length;
    return { lat: lat / n, lon: lon / n, acc: acc / n / Math.sqrt(n) };
  }

  /* يضيف قراءة GPS. fix = {lat, lon, accuracy, speed (م/ث أو null), ts}
   * المسافة بتنحسب بطريقتين:
   * 1) إذا الجهاز بيعطي سرعة (Doppler) — وهي أدق بكثير من فرق المواقع: المسافة = السرعة × الزمن
   * 2) غير هيك: مواقع مُنعّمة + نقطة ارتكاز ما بتتحرك إلا إذا الحركة أكبر من هامش الخطأ
   * يرجع 'ok' | 'rejected' */
  function addFix(trip, fix) {
    const ts = fix.ts;
    if (trip.anchor && ts <= trip.lastFixMs) return 'rejected';
    const acc = fix.accuracy != null ? fix.accuracy : 15;
    if (acc > GPS.maxAccuracyM) { trip.rejected++; return 'rejected'; }

    const p = { lat: fix.lat, lon: fix.lon, acc };
    const dt = (ts - trip.lastFixMs) / 1000;

    if (!trip.anchor) {
      trip.fixes++;
      // أول قراءة: الوقت من البداية لغايتها انتظار
      chargeSegment(trip, dt, 0);
      trip.buf = [p];
      trip.anchor = smoothed(trip.buf);
      trip.lastFixMs = ts;
      return 'ok';
    }

    // رفض القفزات المستحيلة (مقارنة بالموقع المنعّم)
    const jumpKmh = (haversineM(trip.anchor, p) / Math.max(dt, 1)) * 3.6;
    if (jumpKmh > GPS.maxSpeedKmh * 1.5 && dt < 30) { trip.rejected++; return 'rejected'; }

    trip.fixes++;
    if (dt > 20) trip.gapSec += dt;
    trip.buf.push(p);
    if (trip.buf.length > 5) trip.buf.shift();
    const sm = smoothed(trip.buf);

    const hasSpeed = typeof fix.speed === 'number' && isFinite(fix.speed) && fix.speed >= 0;
    let d;
    if (hasSpeed && dt <= 10) {
      // طريقة 1: سرعة الجهاز
      const v = Math.min(fix.speed, GPS.maxSpeedKmh / 3.6);
      const vPrev = trip.lastSpeed != null ? trip.lastSpeed : v;
      const vAvg = (v + vPrev) / 2;
      d = vAvg < 0.8 ? 0 : vAvg * dt;   // أقل من ~3 كم/س = واقف
      trip.lastSpeed = v;
      trip.speedFixes = (trip.speedFixes || 0) + 1;
      trip.anchor = sm;
    } else {
      // طريقة 2: فرق المواقع المنعّمة
      trip.lastSpeed = hasSpeed ? fix.speed : null;
      if (dt > 20) {
        // انقطاع طويل: خط مستقيم من آخر موقع (تقدير أقل من الحقيقة غالبًا)
        const gapD = haversineM(trip.anchor, p);
        d = gapD < Math.max(GPS.minMoveM, acc) ? 0 : gapD;
        trip.buf = [p];
        trip.anchor = { lat: p.lat, lon: p.lon, acc: p.acc };
      } else {
        const moved = haversineM(trip.anchor, sm);
        const threshold = Math.max(GPS.minMoveM, 1.5 * Math.max(trip.anchor.acc, sm.acc));
        const perSec = ratesOf(trip.rate).perSec;
        if (moved < threshold) {
          // حركة أقل من هامش الخطأ: بنحسبها انتظار مؤقتًا (pending)
          chargeSegment(trip, dt, 0);
          trip.pendingSec = (trip.pendingSec || 0) + dt;
          if (trip.pendingSec > 30) trip.pendingSec = 0;   // وقوف حقيقي: بنثبّته انتظار
          trip.lastFixMs = ts;
          return 'ok';
        }
        // الارتكاز تحرك: الفترة كلها من آخر حركة بتنحسب مرة وحدة (مسافة أو وقت، أيهما أعلى)
        const pend = trip.pendingSec || 0;
        trip.waitChargeJD -= pend * perSec;
        trip.waitingSec -= pend;
        trip.pendingSec = 0;
        chargeSegment(trip, pend + dt, moved);
        trip.anchor = sm;
        trip.lastFixMs = ts;
        return 'ok';
      }
      trip.pendingSec = 0;
    }

    chargeSegment(trip, dt, d);
    trip.lastFixMs = ts;
    return 'ok';
  }

  /* ملخص الأجرة لغاية nowMs.
   * الوقت من آخر قراءة لغاية الآن بينحسب انتظار (المتصفح بيقلل القراءات لما الجهاز واقف) */
  function summary(trip, nowMs) {
    const tail = Math.max(0, (nowMs - trip.lastFixMs) / 1000);
    const { perSec, crossoverKmh } = ratesOf(trip.rate);
    const waitCharge = trip.waitChargeJD + tail * perSec;
    const raw = trip.rate.base + trip.distChargeJD + waitCharge;
    const fare = Math.max(trip.minFare, raw);
    return {
      durationSec: Math.max(0, (nowMs - trip.startMs) / 1000),
      distanceKm: trip.distanceM / 1000,
      waitingSec: trip.waitingSec + tail,
      base: trip.rate.base,
      distCharge: trip.distChargeJD,
      waitCharge,
      raw,
      fare,
      minApplied: fare > raw,
      period: trip.period,
      crossoverKmh,
      gapSec: trip.gapSec,
      fixes: trip.fixes,
      rejected: trip.rejected,
      lastFixAgeSec: tail
    };
  }

  // تقريب للفلس
  function roundFils(jd) { return Math.round(jd * 1000) / 1000; }

  const api = { DEFAULT_TARIFF, GPS, haversineM, periodFor, createTrip, addFix, summary, roundFils, ratesOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaxiFare = api;
})(typeof self !== 'undefined' ? self : this);
