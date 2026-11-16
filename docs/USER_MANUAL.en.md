# User Manual — "Taxi Meter" (عداد التاكسي) for Android

> For ordinary users. Every figure the app shows is an **estimate** based on the GPS signal; the meter installed in the taxi remains the official reference. A difference of about 5–8% is normal (the app says the same under «الإعدادات» "Settings", then «عن التطبيق» "About the app"). The app interface is in Arabic, so each screen label is quoted in Arabic inside « » with an English gloss.

## 1. Overview

«عداد التاكسي» ("Taxi Meter") is an Android app that estimates a trip fare in Jordanian dinars (د.أ, JD) while you ride, the way a real taxi meter works: a flag-fall (base fare), then, for each stretch of road, the distance charge or the waiting-time charge, whichever is higher.

What it gives you:

- A live meter for fare, distance, duration and waiting time.
- Counting continues with the screen locked or during a phone call (through a persistent notification).
- A comparison of the app's estimate with the real taxi meter reading after the trip.
- A trip history with a monthly total and export to a CSV file that opens in Excel.
- Three editable tariff profiles: «التاكسي الأصفر» (Yellow Taxi), «سيارتي» (My Car) and «أخرى» (Other).
- A light, dark or automatic theme.

What it does not do: there is no account and no server connection. All data (trips and tariffs) stays on your phone. The phone needs **Google Play services**, because tracking depends on them (some recent Huawei phones lack them, and tracking will not work there).

The bottom navigation bar has three destinations: «الرئيسية» (Home), «السجل» (History) and «الإعدادات» (Settings).

## 2. Installing from the APK file

1. Open this link in your phone's browser:
   `https://github.com/aldbbagh-Extintion/Taxi-far/releases/latest/download/taxi-meter.apk`
   (it is the `taxi-meter.apk` file attached to the latest release at `https://github.com/aldbbagh-Extintion/Taxi-far/releases/latest`).
2. When the download finishes, open the file. If Android asks, allow your browser (or file manager) to **Install unknown apps** ("unknown sources"), go back, and tap Install.
3. This is a test (debug) build produced automatically from the latest change in the project, so Android may show a warning when installing it.
4. After installing, you may switch the unknown-sources option back to what it was.

**Updating over an older copy.** Builds from this version on are signed with one fixed key, so they install over each other and keep your history and tariffs. Copies installed before this version need one uninstall before the new one is installed, so follow this rule first:

> Open «السجل» (History), tap «تصدير Excel (CSV)» (Export Excel (CSV)) and save the file (or share it to yourself) before updating.

## 3. Permissions

The app asks for permissions the first time you tap «ابدأ الرحلة» (Start trip):

| Permission | What to choose | Why |
|---|---|---|
| Location | **While using the app**; "all the time" is not needed | To compute distance and time |
| Location accuracy | **Precise** location, not approximate | A correct distance |
| Notifications (Android 13 and later) | Allow | To show the persistent notification during a trip |

- If you refuse the location permission the trip does not start, and the app shows «رفضت إذن الموقع. فعّله من إعدادات التطبيق عشان العداد يشتغل.» ("You refused the location permission. Enable it in the app settings so the meter works."). Enable it in Android Settings, then Apps, then «عداد التاكسي», then Permissions.
- Refusing the notification permission does not stop a trip from starting, but the persistent notification may not appear.

## 4. The home screen and the meter

At the top is the title «عداد التاكسي», and under it the large meter card, which shows:

- «الأجرة الحالية» (Current fare) in dinars (د.أ).
- Three cells: «المسافة» (Distance, km), «المدة» (Duration, minutes:seconds) and «الانتظار» (Waiting, minutes:seconds).
- Two small chips: the tariff profile name and period (for example «تعرفة نهارية», day tariff), and the location status (for example «دقة الموقع», "location accuracy", with the value in metres, or «الموقع متوقف», "location off").
- The hint «اضغط للتفاصيل» (Tap for details): tap the card to open the «تفاصيل الأجرة» (Fare details) sheet (flag-fall, distance, waiting time). Its numbers update every second during a trip. Close it with «إغلاق» (Close).

Below the card are two buttons: «ابدأ الرحلة» (Start trip), which becomes «إنهاء الرحلة» (End trip) during a trip, and «إعادة ضبط» (Reset). Then the «الحالة» (Status) section, with five values:

| Status | Meaning |
|---|---|
| «متوقفة» (Stopped) | No trip |
| «يبحث عن الموقع…» (Searching for location…) | The trip started and the first GPS reading has not arrived yet |
| «يتحرك» (Moving) | The last stretch was charged by distance |
| «في الانتظار» (Waiting) | The last stretch was charged by time (stopped or in traffic) |
| «انتهت الرحلة» (Trip ended) | The trip is over and waiting to be saved or discarded |

On first use a battery-tip card appears with the buttons «إعدادات البطارية» (Battery settings) and «فهمت» (Got it). «فهمت» hides it for good.

## 5. Starting and ending a trip

1. Tap «ابدأ الرحلة» and grant the permissions if asked.
2. **The live fare starts at the flag-fall.** During the trip the large number shows flag-fall + distance charge + waiting charge only, like a real taxi meter.
3. **The minimum fare is not in the live number**; it is applied when the trip ends. If the current fare is below it, a line appears under the number containing «الحد الأدنى» (the minimum) with its value and the phrase «بينطبق عند إنهاء الرحلة» ("applies when the trip ends").
4. Tap «إنهاء الرحلة» on arrival to go to the «اكتملت الرحلة» (Trip complete) screen (section 6). The final fare is the larger of the live fare and the minimum.
5. «إعادة ضبط» cancels the running trip without saving it; the app asks first: «إعادة ضبط العداد؟» (Reset the meter?).
6. If you have a finished trip that was not saved and you tap «ابدأ الرحلة», the app asks whether to discard it and start a new trip («تجاهل وابدأ», Discard and start).

**Day and night.** The tariff period (day or night) is decided by the time the trip **starts** and stays the same until it ends.

**The persistent notification.** During a trip a notification titled «عداد التاكسي» sits in the notification bar. It updates with the fare and distance roughly every 5 seconds and disappears when the trip ends. Tapping it brings you back to the app on the same trip.

**Locked screen and phone calls.** Tracking runs in an Android foreground service, so counting continues if you lock the screen or take a call. When you return to the app the readings stored while you were away are added, so distance and time are complete. Set up the battery as described in section 9.

**An interrupted trip.** If the app is closed during a trip (for example the battery died), opening it shows a banner containing «في رحلة ما انتهت من قبل» ("there is a trip that did not finish") with two buttons: «كمّل الرحلة» (Resume trip) and «احذفها» (Delete it). If the location service is still running, the app resumes the trip by itself.

## 6. Trip result and the meter comparison

After «إنهاء الرحلة» the «اكتملت الرحلة» screen appears (the navigation bar is hidden there):

- An «إجمالي الأجرة» (Total fare) card with the tariff name and period.
- Start and end time, date, duration, distance, and a small sketch of the route.
- «تفاصيل الأجرة» (Fare details): «فتحة العداد» (Flag-fall), «المسافة» (Distance) and «وقت الانتظار» (Waiting time), plus the line «تم تطبيق الحد الأدنى للأجرة» (Minimum fare applied) when it was applied.
- GPS quality warnings when needed, such as «قراءات الـ GPS قليلة جدًا، النتيجة مش موثوقة.» (Very few GPS readings; the result is not reliable).

To compare with the taxi meter, type what the taxi meter showed (for example 2.450) into the field «شو قرا عداد التكسي؟ (اختياري)» ("What did the taxi meter read? (optional)"). The verdict appears at once; the tolerance is 8% of the estimate or 100 fils, whichever is larger.

| Verdict | Condition |
|---|---|
| «منطقي» (Reasonable, green) | The meter is within the tolerance |
| «أعلى» (Higher, red) | The meter is above the estimate by more than the tolerance |
| «أقل» (Lower, warning) | The meter is below the estimate by more than the tolerance |

You can also add text in «ملاحظة / الغرض (اختياري)» (Note / purpose, optional; up to 120 characters).

Then choose «حفظ الرحلة» (Save trip), which saves it and opens «السجل», or «تجاهل» (Discard), which asks for confirmation and does not save.

## 7. History, trip details, export and sharing

**«السجل» (History):**

- Month buttons at the top select the month, newest first.
- A totals card: «مجموع» (Total) for the selected month and the number of trips. The amount counted is **the meter reading if you recorded one, otherwise the estimate**.
- The trip list: for each trip the date, amount, distance, duration and tariff, the verdict tag («منطقي», «أعلى» or «أقل») and your note if any. If you recorded a meter reading, the estimate is shown next to it.
- With no trips you see «لسا ما في رحلات محفوظة.» ("No saved trips yet.") and a «ابدأ رحلة» (Start a trip) button.

**«تفاصيل الرحلة» (Trip details)**, opened by tapping a trip: the same layout as the trip result, read-only, with «قراءة العداد» (Meter reading), the verdict and «ملاحظة» (Note), and a «حذف» (Delete) button, which asks «حذف هالرحلة؟» (Delete this trip?). The back button is at the top of the page.

**Export and sharing** (bottom of «السجل»):

- «تصدير Excel (CSV)»: creates a file named `taxi-trips-DATE.csv` with all trips (oldest first) and opens the Android share sheet (titled «مشاركة السجل», Share history) so you can save or send it. Columns: date, time, period, tariff, distance (km), duration (minutes), waiting (minutes), estimate (JD), meter reading (JD), difference (JD), note (the headers inside the file are in Arabic). If the history is empty the app shows «ما في رحلات للتصدير.» ("No trips to export.").
- «مسح كل السجل» (Clear all history): permanently deletes every trip after a confirmation («امسح الكل», Clear all). Export first.

There is no export for a single trip; export covers the whole history.

## 8. Tariff settings

Go to «الإعدادات» then «إعدادات التعرفة» (Tariff settings). Three tabs at the top:

| Profile | Description |
|---|---|
| «التاكسي الأصفر» (Yellow Taxi) | Day and night tariffs (9 fields) |
| «سيارتي» (My Car) | **One tariff** all day, no day/night split (4 fields) |
| «أخرى» (Other) | Like the taxi: day and night, for a tariff you define yourself |

The dual-profile fields are: «فتحة العداد نهارًا (د.أ)» and «فتحة العداد ليلًا (د.أ)» (flag-fall, day and night), «الكيلومتر نهارًا (د.أ)» and «الكيلومتر ليلًا (د.أ)» (per km), «انتظار/35ث نهارًا (د.أ)» and «انتظار/35ث ليلًا (د.أ)» (waiting per 35 s), «بداية النهار (ساعة)» and «بداية الليل (ساعة)» (start hour of day and of night, 0–23), and «الحد الأدنى للأجرة (0 = بدون)» (minimum fare, 0 = none). «سيارتي» has four fields: «فتحة العداد (د.أ)», «الكيلومتر (د.أ)», «انتظار/35ث (د.أ)» and the minimum fare.

Defaults for Yellow Taxi (and for «أخرى» at first): flag-fall 0.39 by day and 0.40 by night, per km 0.28 and 0.33, waiting per 35 seconds 0.028 and 0.032, minimum fare 1.00 JD, day from 08:00 and night from 20:00. «سيارتي» starts with the day values.

- **«حفظ الإعدادات» (Save settings) makes the profile on screen the one in use**, marked «المستخدمة» ("in use"). The tariff applies from the **next trip**; a running trip keeps its own copy.
- «القيم الافتراضية» (Default values) resets only the profile on screen to its defaults and does not change which profile is in use.
- Invalid values (negative, non-numeric, or equal day-start and night-start hours) are rejected with «في قيمة غلط، تأكد من الأرقام.» ("A value is wrong, check the numbers.").
- Each saved trip keeps the tariff name and rates from when it was taken, so editing a tariff does not change old trips.

«الإعدادات» also holds «المظهر» (Appearance: «تلقائي» auto, «فاتح» light, «داكن» dark), «البطارية» (Battery) and «عن التطبيق» (About the app).

## 9. Battery settings by manufacturer

For counting to continue with the screen locked, the app must be exempt from battery saving. From inside the app: «الإعدادات», then «البطارية», then «فتح إعدادات توفير البطارية» (Open battery saver settings), or the «إعدادات البطارية» button on the home-screen tip card. If that is not enough, do it by hand:

| Brand | Steps |
|---|---|
| **Samsung** | Settings > Battery > Background usage limits > remove the app from "Sleeping apps" and "Deep sleeping apps". Then App info > Battery > **Unrestricted** |
| **Xiaomi / Redmi / POCO** (MIUI / HyperOS) | App info > Battery saver > **No restrictions**. Enable **Autostart**. In the recent-apps list tap the lock icon on the app |
| **Huawei / Honor** | Settings > Battery > App launch > turn off "Manage automatically" for the app and enable all three options (auto-launch, secondary launch, run in background) |
| **Other devices (Pixel etc.)** | App info > Battery > **Unrestricted** |

A reference for every brand: <https://dontkillmyapp.com>

## 10. Accuracy tips

- Wait until «دقة الموقع» (location accuracy) shows a small value before moving. The app ignores readings whose accuracy is worse than 35 metres.
- Choose **Precise** location and keep GPS on.
- GPS drains the battery; for long trips plug in a charger.
- Set up the battery as in section 9 and do not force-stop the app during a trip.
- If you see the warning «انقطع الـ GPS حوالي» ("the GPS was cut off for about"), the real distance is probably slightly longer, because the app charges the gap as a straight line.
- If the location chip shows «ما في إشارة من» ("no signal for"), wait for the signal to return (tunnels, tall buildings).

## 11. Frequently asked questions

**Does the app need internet?** No. It talks to no server, and GPS works without internet.

**Why does my number differ from the taxi meter?** Because ours is a GPS estimate; a difference of about 5–8% is normal. Type the meter reading on the result screen to see the verdict.

**The live number is below the minimum fare. Is that a bug?** No. The minimum is applied only when the trip ends, and the «الحد الأدنى» line under the number reminds you.

**Where is my data stored?** On the phone only. You can export it with «تصدير Excel (CSV)».

**A message about Google Play services appeared.** Update "Google Play services" from the store; tracking needs it.

**Does «سيارتي» distinguish day from night?** No, it is one tariff all day.

**I changed the tariff and the running trip did not change.** Expected: a change applies from the next trip.

**How do I delete a trip?** In «السجل» open the trip and tap «حذف».
