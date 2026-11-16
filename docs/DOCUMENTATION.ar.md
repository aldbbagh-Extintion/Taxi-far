# التوثيق التقني — تطبيق «عداد التاكسي» (Angular + Capacitor)

مرجع للمطورين. المصدر الوحيد للحقيقة هو الكود على الفرع `main` (commit `bcde3e8`). أي ملف أو دالة تذكر هنا يمكن فتحها بالمسار المكتوب.

## 1. نظرة عامة ومعمارية

التطبيق **Angular 20** (standalone components، zoneless change detection، signals) مغلف بإطار **Capacitor 7** ليعمل كتطبيق أندرويد (`appId: jo.taqneen.taximeter`، `webDir: dist/taxi-meter-app/browser`). يقدر أجرة الرحلة بالدينار الأردني من قراءات GPS بمنطق **crossover meter**. لا يوجد backend؛ كل البيانات محلية.

الطبقات الثلاث وملكيتها (كما في رأس `src/app/contracts.ts`):

| الطبقة | المسار | المسؤولية |
|---|---|---|
| **core** | `src/app/core/**` | fare engine، repository، منسق الرحلة (`TripSessionService`)، تصدير CSV |
| **native** | `src/app/native/**` + `android/**` | تتبع GPS في الخلفية عبر Google Fused Location، Capacitor plugin، foreground service |
| **ui** | `src/app/features/**`, `src/app/app.*`, `src/styles.scss`, `src/index.html` | الشاشات والمكونات المشتركة |

الطبقات لا تعرف بعضها إلا عبر **عقود** `contracts.ts` (واجهات + `InjectionToken`). الواجهة تحقن `TRIP_SESSION` و`TRIP_REPOSITORY` و`LOCATION_TRACKER` ولا تستورد تنفيذا مباشرة. التوصيل في `src/app/app.config.ts`:

```ts
providers: [
  provideBrowserGlobalErrorListeners(),
  provideZonelessChangeDetection(),
  provideRouter(routes),
  ...provideCore(),          // TRIP_REPOSITORY + TripSessionService + TRIP_SESSION
  ...provideNativeTracker(), // LOCATION_TRACKER -> NativeLocationTracker
]
```

## 2. هيكل المجلدات

```
src/app/contracts.ts          العقود المشتركة
src/app/app.{ts,html,scss,config.ts,routes.ts}
src/app/core/                 fare-engine.ts · tariff.ts · trip-session.service.ts · trip-repository.ts
                              route.ts · verdict.ts · format.ts · csv-export.ts · index.ts
                              fare-engine.spec.ts · tariff-profiles.spec.ts   (vitest)
src/app/native/               trip-tracker.plugin.ts · trip-tracker.web.ts · location-tracker.service.ts · index.ts
src/app/features/
  meter/ (meter-page, fare-sheet)   trip-result/   history/ (history-page, trip-detail-page)
  settings/   shared/ (core-bridge, fare-rows, trip-report, route-sketch, format, icons, overlays, ui.services)
  dev/mock-session.ts               بيانات وهمية لمعاينة الواجهة
src/main.ts · src/main.dev-mock.ts  نقطتا الإقلاع (الثانية لإعداد build اسمه mock)
android/                      مشروع Gradle: MainActivity, TripTrackerPlugin, TrackingService, FixStore (Java)
.github/workflows/android-apk.yml  البناء والنشر
BUILD-ANDROID.md · README.md  أدلة البناء وقائمة فحص الهاتف
```

## 3. contracts.ts

الملف الوحيد المشترك بين الطبقات؛ **أي تعديل فيه يستلزم تنسيقا بين core وnative وui**. محتواه:

- **التعرفة:** `PeriodRate {base, perKm, waitPer35s}`، `Tariff` (نهاري/ليلي: `dayStartHour`, `nightStartHour`, `day`, `night`, `minFare`, `version`, `id?`, `name?`)، `FlatTariff` (حقل `flat` بدل النهاري والليلي)، `AnyTariff`، `Period = 'day' | 'night' | 'flat'`.
- **الملفات:** `ProfileId = 'taxi' | 'mycar' | 'other'`، `DualProfile` (`taxi` و`other`)، `FlatProfile` (`mycar`)، `TariffProfile`، `ProfilesState {active, profiles}`.
- **GPS:** `GpsFix {lat, lon, accuracy|null (م), speed|null (م/ث), ts (ms)}`.
- **مخرجات المحرك:** `FareSummary` (المدة، المسافة، الانتظار، `base`، `distCharge`، `waitCharge`، `raw`، `fare`، `minApplied`، `period`، `crossoverKmh`، `gapSec`، `fixes`، `rejected`، `lastFixAgeSec`).
- **الرحلة المحفوظة:** `SavedTrip` (`id = String(startMs)`، `tariffId?`, `tariffName?`، `rate` وقت الرحلة، `meter: number|null`، `note`، `route` حتى 300 نقطة...).
- **`TripRepository`** مع `TRIP_REPOSITORY`: `init`, `listTrips`, `getTrip`, `saveTrip`, `deleteTrip`, `clearTrips`, `getTariff/saveTariff` (قديمة للترحيل)، `getProfiles/saveProfiles`, `getActiveTrip/saveActiveTrip`.
- **`LocationTracker`** مع `LOCATION_TRACKER`: `isNative`, `checkPermissions`, `requestPermissions`, `start`, `stop`, `isRunning`, `onFix`, `onError`, `drainBufferedFixes`, `updateNotification`, `openBatterySettings`.
- **`TripSession`** مع `TRIP_SESSION`: signals للقراءة (`status`, `summary`, `gpsText`, `warning`, `pending`, `hasUnfinished`, `route`, `tariff`, `profiles`) وأوامر (`init`, `start`, `stop`, `reset`, `resumeUnfinished`, `discardUnfinished`, `savePending`, `discardPending`, `setProfile`, `resetProfile`). و`MeterStatus = 'idle' | 'searching' | 'moving' | 'waiting' | 'stopped'`.

## 4. fare-engine: الواجهة وخوارزمية الحساب

الملف `src/app/core/fare-engine.ts` منقول من `design-ref/original-fare.js` بنفس الحساب. حالة الرحلة `EngineTrip` كائن JSON عادي (يخزن ويستعاد كما هو).

**الواجهة العامة:**

| الدالة | الوظيفة |
|---|---|
| `createTrip(startMs, tariff?)` | ينشئ `EngineTrip`، ويحدد الفترة من وقت البدء ويثبت نسخة من `rate` و`minFare` و`tariffId/tariffName` |
| `addFix(trip, fix)` | يضيف قراءة ويرجع `'ok' \| 'rejected'` |
| `summary(trip, nowMs)` | يرجع `FareSummary`؛ الزمن من آخر قراءة حتى الآن يحسب انتظارا |
| `periodFor(date, tariff)` | `'flat'` للتعرفة المفردة، وإلا `'day'/'night'` حسب الساعة (تدعم عبور منتصف الليل) |
| `ratesOf(rate)` | `perSec = waitPer35s/35` و`crossoverKmh = perSec*3600/perKm` |
| `roundFils(jd)` | تقريب إلى 3 منازل |
| `haversineM`, `lastSegmentKind`, `isEngineTrip` | مساعدات |

**الخوارزمية:** كل مقطع بين قراءتين يحتسب بالمسافة أو بالوقت أيهما أعلى (`chargeSegment`): `distCost = km * perKm` و`timeCost = dtSec * perSec`؛ إن كان `timeCost >= distCost` أضيف إلى `waitChargeJD` وزاد `waitingSec`، وإلا إلى `distChargeJD`. المسافة تتراكم في الحالتين.

**فلترة GPS** (الثابت `GPS`):

- `maxAccuracyM = 35`: قراءة دقتها أسوأ ترفض (وتزيد `rejected`). عند غياب الدقة يفترض 15.
- `maxSpeedKmh = 180`: قفزة أسرع من `180*1.5` كم/س خلال أقل من 30 ث ترفض.
- `minMoveM = 8`: أدنى عتبة حركة.
- قراءة بزمن `ts <= lastFixMs` (بعد وجود `anchor`) ترفض (تكرار).
- فترة بين قراءتين أكبر من 20 ث تسجل في `gapSec`.

**طرق قياس المسافة:**

1. **سرعة الجهاز (Doppler)** إذا توفرت `speed` و`dt <= 10`: `d = vAvg * dt` حيث `vAvg` متوسط السرعة الحالية والسابقة (مقصورة على 180 كم/س)، و`d = 0` إن كانت `vAvg < 0.8` م/ث.
2. **فرق المواقع المنعمة** (`smoothed`: متوسط آخر ≤ 5 قراءات). عتبة الحركة `max(8, 1.5*max(acc_anchor, acc_smoothed))`؛ ما دونها يحتسب انتظارا مؤقتا في `pendingSec` ويعاد احتسابه مرة واحدة عندما يتحرك anchor فعلا. انقطاع > 20 ث يحتسب خطا مستقيما من آخر موقع.
3. أول قراءة: الزمن من البدء إليها يحتسب انتظارا.

**الأجرة:** `raw = base + distCharge + waitCharge`، و`fare = max(minFare, raw)`، و`minApplied = fare > raw`. ملاحظة تصميمية: `raw` هو ما تعرضه الواجهة أثناء الرحلة (`MeterPage.parts`)، و`fare` تظهر في النتيجة بعد الإنهاء.

**التعرفة الافتراضية** (`DEFAULT_TARIFF`، نسخة `2026-05-11`): نهار من 8، ليل من 20؛ نهارا `{0.39, 0.28, 0.028}` وليلا `{0.40, 0.33, 0.032}` (فتحة، كم، انتظار/35ث)؛ `minFare = 1.0`.

## 5. نموذج التعرفة وprofiles والترحيل

ثلاثة ملفات ثابتة (`PROFILE_IDS`, `PROFILE_NAMES`):

| id | الاسم | النوع | الافتراضي |
|---|---|---|---|
| `taxi` | التاكسي الأصفر | `DualProfile` | نسخة من `DEFAULT_TARIFF` |
| `mycar` | سيارتي | `FlatProfile` | `flat` = قيم النهار، `version: 'default'` |
| `other` | أخرى | `DualProfile` | نسخة من `DEFAULT_TARIFF` |

- `defaultProfiles()` ترجع نسخة عميقة قابلة للتعديل من `DEFAULT_PROFILES`.
- **التحقق:** `validateTariff` / `validateProfile` في `src/app/core/tariff.ts`: كل القيم أرقام منتهية ≥ 0؛ الساعتان صحيحتان ضمن 0–23 ومختلفتان؛ يعاد كائن نظيف `version: 'custom'` والاسم يفرض من `PROFILE_NAMES`. الخطأ يرمي `Error(TARIFF_INVALID_MSG)`.
- **التحميل والترحيل:** `loadProfiles(v3, oldTariff)`: الحالة المحفوظة الصالحة (`{active, profiles}`) تغلب؛ تتحقق كل ملف على حدة (`validProfile`) والتالف يستبدل بالافتراضي، و`active` غير الصالح يصبح `taxi`. إن لم يوجد v3 صالح ترحل التعرفة القديمة المفردة (مفتاح `tariff`) إلى الملف `taxi` ويكون `active = 'taxi'`، وإلا الافتراضي.
- **`TripSessionService.setProfile(p)`:** يتحقق، يحفظ، ويجعل `clean.id` هو `active` (حفظ ملف = استخدامه). ينطبق من الرحلة التالية لأن `createTrip` يأخذ نسخة. **`resetProfile(id)`:** يعيد الافتراضي لذلك الملف دون تغيير `active`.
- الرحلات القديمة بلا `tariffId` تعامل `taxi`؛ والاسم الاحتياطي `التاكسي الأصفر`.

## 6. التخزين

`createTripRepository()` يختار التنفيذ: `SqliteTripRepository` على المنصة الأصلية، `LocalStorageTripRepository` في المتصفح (تطوير).

**SQLite** (`@capacitor-community/sqlite`، قاعدة `taxi_meter`، `SCHEMA_VERSION = 1`، بلا تشفير):

- جدول `trips (id TEXT PK, start INTEGER, data TEXT)` وفهرس `idx_trips_start`؛ الرحلة كاملة JSON في `data`.
- جدول `kv (key TEXT PK, value TEXT)` (قيمة JSON). المفاتيح:

| المفتاح | المحتوى |
|---|---|
| `tariff_profiles_v3` | `ProfilesState` |
| `active_trip` | حالة الرحلة غير المنتهية `{v:1, trip, route}` |
| `tariff` | تعرفة قديمة مفردة (للترحيل فقط) |
| `schema_version` | `"1"` |

**localStorage** (احتياطي المتصفح): `taxi_trips_v2` (مصفوفة رحلات)، `taxi_active_v2`، `taxi_tariffs_v3`، `taxi_tariff_v2` (قديم). كتابة تفشل ترمي `ما قدرت أحفظ — مساحة التخزين ممتلئة أو محظورة.`

مفاتيح الواجهة في localStorage: `ui_theme_v1` (المظهر)، `ui_tip_battery_v1` (إخفاء نصيحة البطارية).

`normalizeTrip` يكمل `meter` و`note` و`route` للرحلات القديمة. الصفوف التالفة في `listTrips` تتجاهل.

الجانب الأصلي يخزن القراءات أيضا: `FixStore` يحتفظ بها في الذاكرة (حتى 20000) وفي `filesDir/fixes.jsonl` ليعيدها `drainFixes()` بعد عودة التطبيق من الخلفية.

## 7. TripSessionService ودورة حياة الرحلة

`src/app/core/trip-session.service.ts` يطبق `TripSession` باستخدام signals خاصة (`_status`, `_summary`...) تعرض `asReadonly()`.

**الإقلاع:** `App` تستدعي `session.init()` (مرة واحدة، idempotent). `doInit`: يفتح repository، يحمل الملفات (`loadProfiles`)، ويقرأ الرحلة غير المنتهية (`parseActive`). إن وجدت: إذا كانت خدمة الموقع ما زالت تعمل (`tracker.isRunning()`) تستأنف تلقائيا، وإلا يضبط `hasUnfinished` فتعرض الواجهة «كمّل / احذفها».

**`start()`:** يطلب الأذونات (`ensureLocationPermission`؛ رفض الموقع يضبط `warning` ويلغي)، يفرغ المخزن الأصلي القديم، ينشئ `createTrip(Date.now(), tariff)`، يحفظ فورا، ثم `startTracking()`: اشتراك في `onFix`/`onError`، `tracker.start()` إن لم تكن شغالة، و`setInterval` كل ثانية (`tick`). عند الفشل تلغى الرحلة.

**أثناء الرحلة:** `onFix` يمرر القراءة إلى `ingest` (يرمي أي قراءة أقدم من بدء الرحلة بأكثر من 2 ث، ويضيف نقطة مسار كل ≥ 15 م بحد `ROUTE_MAX_POINTS = 300` للمحفوظ)، ثم `persistThrottled` (حفظ `active_trip` بحد أدنى 3 ث بين كتابتين، والكتابات تسلسل في `writeChain`). `refresh()` يحسب `summary` والحالة: `searching` بلا قراءات، `moving` إن كان آخر مقطع بالمسافة، وإلا `waiting`، ونص `gpsText`. كل 5 ثوان يحدث نص الإشعار الأصلي بقيمة `jd(raw)` والمسافة.

**الخلفية:** عند `visibilitychange` إلى hidden يحفظ فورا؛ وعند العودة يستدعى `drain()` فيدخل القراءات المخزنة مرتبة حسب `ts` (المكرر يرفض في المحرك وفي `NativeLocationTracker.markNew`). في المتصفح فقط يظهر تحذير أن فترة الخلفية حسبت خطا مستقيما.

**`stop()`:** `drain()` ثم `summary` ثم يبني `SavedTrip` (تقريب: المسافة 3 منازل، المدة والانتظار ثواني صحيحة، `fare = roundFils`) ويضعه في `pending`، يوقف tracker، يمسح `active_trip`، وتصبح الحالة `stopped`. الواجهة تلتقط `pending` وتنتقل إلى `/trip-result`.

**`savePending(meter, note)`:** يحفظ في repository (`meter > 0` وإلا `null`)؛ عند الفشل `warning` ويبقى `pending`. **`discardPending()`**, **`reset()`** (يلغي بلا حفظ)، **`resumeUnfinished()`**, **`discardUnfinished()`** كما في العقد. علم `busy` يمنع تداخل start/stop/resume.

**المقارنة:** `verdict(est, meter)` في `core/verdict.ts`: `tol = max(0.1, est*0.08)`؛ داخل الهامش `ok` (منطقي)، `diff > 0` → `bad` (أعلى)، وإلا `warn` (أقل).

## 8. طبقة native

**الجسر في TypeScript:**

- `trip-tracker.plugin.ts`: `registerPlugin<TripTrackerPluginDef>('TripTracker', {web: ...})`. الطرق: `checkPermissions`, `requestPermissions`, `start`, `stop`, `isRunning`, `drainFixes`, `updateNotification`, `openBatterySettings`، والأحداث `fix` و`error`.
- `trip-tracker.web.ts`: بديل المتصفح عبر `navigator.geolocation.watchPosition` + Screen Wake Lock؛ يعمل والتبويب ظاهر فقط.
- `location-tracker.service.ts` (`NativeLocationTracker`): يطبق `LocationTracker`؛ يربط مستمعي `fix` و`error` عند أول استخدام (lazy)، يطبع `NativeFix` إلى `GpsFix`، ويمنع العد المزدوج بمجموعة مفاتيح `ts|lat|lon` (حد 5000) لأن الأحداث الحية والمخزن الأصلي يتداخلان.

**الجانب الأصلي (Java)** في `android/app/src/main/java/jo/taqneen/taximeter/`:

- `MainActivity`: `registerPlugin(TripTrackerPlugin.class)` قبل `super.onCreate`.
- `TripTrackerPlugin`: طرق `@PluginMethod`، وأذونات بأسماء مستعارة `location` (FINE + COARSE) و`notifications` (POST_NOTIFICATIONS من أندرويد 13). `start` يرفض برمز الخطأ `GMS_UNAVAILABLE` إن غابت Google Play services، ثم `ContextCompat.startForegroundService`. `openBatterySettings` يجرب `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` ثم قائمة الإعدادات ثم تفاصيل التطبيق.
- `TrackingService`: **foreground service** نوعه `location` (`FOREGROUND_SERVICE_TYPE_LOCATION` من Q)، يطلب `LocationRequest.Builder(PRIORITY_HIGH_ACCURACY, 1000)` عبر **Fused Location Provider** (`setMinUpdateIntervalMillis(1000)`)، يمسك `PARTIAL_WAKE_LOCK`، ويعيد `START_STICKY`. إن أعيد تشغيله من النظام دون رحلة نشطة يوقف نفسه. قناة الإشعار «عداد الرحلة» بأهمية LOW، والضغط على الإشعار يفتح `MainActivity`.
- `FixStore`: مخزن القراءات (الذاكرة + `fixes.jsonl`).

**الأذونات في `AndroidManifest.xml`:** `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`؛ و`uses-feature` على `android.hardware.location.gps` بقيمة `required="false"`. الخدمة `TrackingService` مع `exported="false"` و`foregroundServiceType="location"`، والنشاط `portrait` و`launchMode="singleTask"`، و`FileProvider` للمشاركة. `minSdkVersion = 23` و`targetSdkVersion = 35`.

## 9. الواجهات (routes والصفحات)

التوجيه في `src/app/app.routes.ts` (كل المسارات `loadComponent` كسولة):

| المسار | الصفحة | عنوان التبويب |
|---|---|---|
| `''` | `MeterPage` (`features/meter`) | عداد التاكسي |
| `trip-result` | `TripResultPage` | اكتملت الرحلة |
| `history` | `HistoryPage` | السجل |
| `history/:id` | `TripDetailPage` | تفاصيل الرحلة |
| `settings` | `SettingsPage` | الإعدادات |
| `**` | إعادة توجيه إلى `''` | |

- `App` تعرض `router-outlet` وشريط تنقل سفلي يخفى عند `/trip-result`؛ وتنتقل تلقائيا إلى `/trip-result` عند ظهور `session.pending()` جديدة.
- `MeterPage`: تعرض `raw` أثناء الرحلة (الحد الأدنى بملاحظة)، `FareSheet` نافذة سفلية للتفاصيل، بطاقة نصيحة البطارية (`ui_tip_battery_v1`).
- `TripResultPage`: `TripReport` + حقل قراءة العداد وملاحظة + `verdict`، وحفظ/تجاهل.
- `HistoryPage`: أشهر (`monthKey`)، المجموع = `meter ?? fare`، تصدير CSV عبر `exportCsv`، ومسح السجل بتأكيد.
- `TripDetailPage`: عرض قراءة فقط وحذف.
- `SettingsPage`: تبويبات الملفات، حقول `FIELDS` (9) و`FLAT_FIELDS` (4)، مظهر (`ThemeService`)، زر البطارية.
- مشتركة: `TripReport`, `FareRows`, `RouteSketch`, `Overlays` (`ConfirmService`, `ToastService`).
- نصوص الواجهة عربية (RTL).
- `ng serve -c mock` يشغل `main.dev-mock.ts` (بيانات وهمية من `features/dev/mock-session.ts`).

**تصدير CSV** (`core/csv-export.ts`): BOM + أعمدة عربية (التاريخ، الوقت، الفترة، التعرفة، المسافة، المدة، الانتظار، التقدير، قراءة العداد، الفرق، ملاحظة)، الرحلات من الأقدم، الاسم `taxi-trips-YYYY-MM-DD.csv`. على أندرويد: `Filesystem.writeFile` إلى `Directory.Cache` ثم `Share.share`؛ وإلغاء المشاركة ليس خطأ. في المتصفح: تنزيل عبر `Blob`.

## 10. الاختبارات

```bash
npm run test:core     # vitest run src/app/core
```

ملفان: `fare-engine.spec.ts` (مطابقة نتائج المحرك للنسخة الأصلية رقما برقم) و`tariff-profiles.spec.ts` (الملفات والتحقق والترحيل). الاختبارات على طبقة core فقط؛ **لا توجد اختبارات لطبقة native أو الواجهة** في المستودع. الفحص على هاتف حقيقي بقائمة `BUILD-ANDROID.md` (الأذونات، الخلفية، المكالمات، البطارية، الموقع الوهمي).

## 11. البناء وCI والإصدار latest

**محليا:** Node 22، JDK 21، Android SDK 35.

```bash
npm ci
npm start                 # متصفح
npm run build:android     # ng build && npx cap sync android
npx cap open android      # Android Studio
cd android && ./gradlew assembleDebug   # APK في android/app/build/outputs/apk/debug/
```

**GitHub Actions** (`.github/workflows/android-apk.yml`، الاسم `Android debug APK`): يعمل على كل `push` وعلى `workflow_dispatch`؛ `ubuntu-24.04`، مهلة 30 دقيقة، `concurrency` يلغي الأقدم لنفس المرجع. الخطوات: `npm ci` ثم `npx ng build` ثم `npx cap sync android` ثم `./gradlew assembleDebug`، ورفع artifact باسم `taxi-meter-debug-apk` (احتفاظ 14 يوما). **النشر:** عند الدفع إلى `main` فقط تنسخ APK إلى `taxi-meter.apk`، ويحذف الإصدار `latest` وتاغه ثم ينشأ من جديد (`gh release create latest ... --target $GITHUB_SHA`). فرابط آخر نسخة ثابت: `https://github.com/aldbbagh-Extintion/Taxi-far/releases/latest/download/taxi-meter.apk`.

## 12. قيود معروفة

- **debug فقط:** التوقيع بمفتاح debug ثابت مأخوذ من سرّ المستودع `ANDROID_DEBUG_KEYSTORE_B64` (يفشل البناء إن غاب السرّ أو اختلفت البصمة). النسخ المبنية من هذه النسخة فصاعدًا تشترك في مفتاح واحد وتُثبَّت فوق بعضها؛ أما المثبتة قبلها فتحتاج حذفًا واحدًا (يُصدَّر CSV أولًا). كما أن `versionCode` ثابت `1` و`versionName "1.0"`.
- يحتاج **Google Play services** (Fused Location)؛ بدونها `start` يرفض برمز الخطأ `GMS_UNAVAILABLE`.
- الفلترة والمسافة تعتمد على جودة GPS؛ الانقطاع الطويل يحتسب خطا مستقيما فقد تقل المسافة.
- الفترة (نهار/ليل) تحسب مرة عند البدء ولا تتبدل أثناء الرحلة.
- المتصفح: لا تتبع في الخلفية، والتخزين `localStorage` للتطوير فقط.
- `README.md` يذكر «25 اختبار»؛ لم يتحقق من هذا الرقم هنا.
- لا تصدير لرحلة منفردة، ولا مزامنة ولا نسخ احتياطي سحابي (البيانات على الجهاز؛ `allowBackup="true"` في المانيفست).
- `schema_version` موجود لكن لا توجد migrations بعد (تعليق «مستقبلًا» في الكود).

## 13. إضافة تعرفة جديدة (how-to)

**أ) تعديل قيم ملف موجود:** غير `DEFAULT_TARIFF` أو `DEFAULT_PROFILES` في `fare-engine.ts` (وارفع `version`)، وحدث الاختبارات في `fare-engine.spec.ts` / `tariff-profiles.spec.ts`. المستخدمون الذين حفظوا قيما يحتفظون بها لأن الحالة المحفوظة تغلب الافتراضي في `loadProfiles`.

**ب) إضافة ملف رابع (مثلا `van`):**

1. `contracts.ts`: أضف القيمة إلى `ProfileId`، وعدل `DualProfile['id']` أو `FlatProfile['id']` حسب النوع.
2. `fare-engine.ts`: أضفه إلى `PROFILE_IDS` و`PROFILE_NAMES` و`DEFAULT_PROFILES` (`loadProfiles` و`validProfile` يمران على `PROFILE_IDS`؛ راجع التفريع `id === 'mycar'` إن كان النوع مفردا).
3. `tariff.ts`: عدل شرط `validateProfile` الذي يفحص `id` صراحة (`taxi`/`mycar`/`other`).
4. `settings-page.ts`: التبويبات تبنى من `PROFILE_IDS`؛ راجع `isFlat` وتفريع `save()` الخاصين بالملف `mycar`، و`toForm`.
5. `csv-export.ts` و`format.ts`: تأكد من أسماء الفترة (`flat` / `day` / `night`) إن أضفت نوع فترة جديدا.
6. اختبر: `npm run test:core`، ثم `npx ng serve -c mock` لمعاينة الشاشة.

**ج) نوع تعرفة جديد (غير نهاري/ليلي/مفرد):** يلزم توسيع `Period` و`periodFor` و`createTrip` و`validProfile` و`validateProfile` وقوالب العرض (`periodName`)، وهو تعديل في `contracts.ts` يستلزم تنسيق الطبقات الثلاث.
