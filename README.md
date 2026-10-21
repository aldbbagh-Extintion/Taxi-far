# عداد التاكسي — تطبيق أندرويد (نموذج أولي MVP)

إعادة بناء `taxi-fare-pwa` بـ **Angular 20 + Capacitor 7** كتطبيق أندرويد أصلي.

## شو الجديد عن نسخة الـ PWA
| | PWA القديمة | التطبيق الجديد |
|---|---|---|
| العمل بالخلفية / أثناء مكالمة | ❌ التتبع بيوقف | ✅ خدمة Foreground بتكمّل العدّ |
| الموقع | GPS المتصفح | **Google Fused Location** (مجاني، بدون مفتاح API ولا حد استخدام) |
| التخزين | localStorage | **SQLite محلي** على الجهاز |
| الواجهة | صفحة واحدة | تصاميم Stitch: العداد، تفاصيل الأجرة، ملخص الرحلة، السجل، الإعدادات + وضع داكن |

محرك الأجرة نفسه (`fare.js`) منقول حرفيًا لـ TypeScript، ومعه اختبارات بتقارن النتائج بالأصلي رقم برقم.

## البنية
```
src/app/contracts.ts   العقود المشتركة
src/app/core/          محرك الأجرة، SQLite، منسّق الرحلة، تصدير CSV  (+ اختبارات vitest)
src/app/native/        جسر خدمة الموقع (أندرويد) + بديل المتصفح
src/app/features/      الشاشات
android/               مشروع أندرويد: TrackingService.java, TripTrackerPlugin.java, FixStore.java
.github/workflows/     بناء APK مجاني على GitHub Actions
```

## أوامر
```bash
npm ci
npm start                 # تجربة بالمتصفح (GPS المتصفح)
npx ng serve -c mock      # معاينة الواجهة ببيانات وهمية
npm run test:core         # اختبارات محرك الأجرة (25 اختبار)
npm run build:android     # بناء + مزامنة مشروع أندرويد
npx cap open android      # فتحه بـ Android Studio
```

طريقة استخراج ملف APK وقائمة الاختبار على الموبايل: **[BUILD-ANDROID.md](BUILD-ANDROID.md)**

> الرقم تقديري حسب الـ GPS، والعداد المعتمد هو المرجع الرسمي.
