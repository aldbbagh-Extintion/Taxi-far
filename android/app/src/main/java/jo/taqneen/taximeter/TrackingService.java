package jo.taqneen.taximeter;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationAvailability;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.lang.ref.WeakReference;

/**
 * Foreground service (type "location") that keeps receiving Google Fused Location fixes
 * while the app is in background, the screen is locked, or a phone call is in progress.
 *
 * Fixes are stored in {@link FixStore} and forwarded live to the Capacitor plugin if attached.
 */
public class TrackingService extends Service {

    private static final String TAG = "TrackingService";

    public static final String ACTION_START = "jo.taqneen.taximeter.action.START";

    public static final String CHANNEL_ID = "trip_meter";
    private static final int NOTIFICATION_ID = 4711;

    private static final String PREFS = "trip_tracker";
    private static final String PREF_ACTIVE = "active";

    static final String ERR_PERMISSION = "إذن الموقع مرفوض";
    static final String ERR_UNAVAILABLE = "الموقع مش متوفر حاليًا. تأكد إن الـ GPS شغال.";
    static final String ERR_START = "تعذّر تشغيل خدمة الموقع. تأكد إن خدمات Google Play مثبتة ومحدّثة.";

    private static final long WAKELOCK_TIMEOUT_MS = 12L * 60L * 60L * 1000L; // 12 h safety net

    /** Live listener (the plugin). Weak so a destroyed bridge is never leaked. */
    public interface Listener {
        void onFix(FixStore.Fix fix);

        void onError(String message);
    }

    private static volatile WeakReference<Listener> listenerRef = new WeakReference<>(null);
    private static volatile boolean running = false;
    private static volatile TrackingService instance = null;

    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private PowerManager.WakeLock wakeLock;
    private boolean updatesRequested = false;
    private String notifTitle = "عداد التاكسي";
    private String notifText = "الرحلة شغّالة – جاري تتبّع الموقع";

    // ---------------------------------------------------------------- static API

    public static void setListener(@Nullable Listener l) {
        listenerRef = new WeakReference<>(l);
    }

    public static boolean isRunning() {
        return running;
    }

    static void setActive(Context ctx, boolean active) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREF_ACTIVE, active).apply();
    }

    static boolean isActive(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return p.getBoolean(PREF_ACTIVE, false);
    }

    /** Updates the ongoing notification if the service is running. Safe from any thread. */
    public static void updateNotification(final String title, final String text) {
        final TrackingService svc = instance;
        if (svc == null) return;
        new Handler(Looper.getMainLooper()).post(() -> svc.applyNotification(title, text));
    }

    private static void emitError(String message) {
        Log.w(TAG, message);
        Listener l = listenerRef.get();
        if (l != null) {
            try {
                l.onError(message);
            } catch (Exception e) {
                Log.w(TAG, "listener.onError failed", e);
            }
        }
    }

    private static void emitFix(FixStore.Fix fix) {
        Listener l = listenerRef.get();
        if (l != null) {
            try {
                l.onFix(fix);
            } catch (Exception e) {
                Log.w(TAG, "listener.onFix failed", e);
            }
        }
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        fused = LocationServices.getFusedLocationProviderClient(this);
        createChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        boolean restartedBySystem = intent == null;

        if (restartedBySystem && !isActive(this)) {
            // Sticky restart (not via startForegroundService, so no 5 s rule) but no trip in progress.
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        // Must be called within 5 s of startForegroundService().
        if (!enterForeground()) {
            emitError(ERR_START);
            setActive(this, false);
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        setActive(this, true);
        running = true;
        acquireWakeLock();
        startLocationUpdates();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        releaseWakeLock();
        running = false;
        if (instance == this) instance = null;
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {
            // ignore
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------------------------------------------------------------- foreground + notification

    private boolean enterForeground() {
        try {
            int type = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                type = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
            return true;
        } catch (Exception e) {
            // SecurityException (no location permission / started from background on Android 14+)
            // or ForegroundServiceStartNotAllowedException (Android 12+ background start).
            Log.e(TAG, "startForeground failed", e);
            return false;
        }
    }

    private void stopSelfSafely() {
        try {
            stopSelf();
        } catch (Exception ignored) {
            // ignore
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "عداد الرحلة", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("إشعار ثابت أثناء تشغيل عداد الرحلة");
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_taxi)
            .setContentTitle(notifTitle)
            .setContentText(notifText)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(notifText))
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void applyNotification(String title, String text) {
        if (title != null && !title.isEmpty()) notifTitle = title;
        if (text != null) notifText = text;
        if (!running) return;
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return; // notification hidden anyway; service keeps running
        }
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification());
        } catch (SecurityException e) {
            Log.w(TAG, "notify failed", e);
        }
    }

    // ---------------------------------------------------------------- wake lock

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TaxiMeter::TripTracking");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(WAKELOCK_TIMEOUT_MS);
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
            // ignore
        }
        wakeLock = null;
    }

    // ---------------------------------------------------------------- location

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressLint("MissingPermission")
    private void startLocationUpdates() {
        if (updatesRequested) return;
        if (!hasLocationPermission()) {
            emitError(ERR_PERMISSION);
            setActive(this, false);
            stopSelfSafely();
            return;
        }

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
            .setMinUpdateIntervalMillis(1000)
            .setWaitForAccurateLocation(false)
            .build();

        callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                for (Location loc : result.getLocations()) {
                    handleLocation(loc);
                }
            }

            @Override
            public void onLocationAvailability(@NonNull LocationAvailability availability) {
                if (!availability.isLocationAvailable()) {
                    emitError(ERR_UNAVAILABLE);
                }
            }
        };

        try {
            fused
                .requestLocationUpdates(request, callback, Looper.getMainLooper())
                .addOnFailureListener(e -> {
                    updatesRequested = false;
                    emitError(e instanceof SecurityException ? ERR_PERMISSION : ERR_START);
                });
            updatesRequested = true;
        } catch (SecurityException se) {
            updatesRequested = false;
            emitError(ERR_PERMISSION);
            setActive(this, false);
            stopSelfSafely();
        }
    }

    private void stopLocationUpdates() {
        if (fused != null && callback != null) {
            try {
                fused.removeLocationUpdates(callback);
            } catch (Exception ignored) {
                // ignore
            }
        }
        callback = null;
        updatesRequested = false;
    }

    private void handleLocation(@Nullable Location loc) {
        if (loc == null) return;
        Double acc = loc.hasAccuracy() ? Double.valueOf(loc.getAccuracy()) : null;
        Double spd = loc.hasSpeed() ? Double.valueOf(loc.getSpeed()) : null;
        long ts = loc.getTime();
        if (ts <= 0) ts = System.currentTimeMillis();
        FixStore.Fix fix = new FixStore.Fix(loc.getLatitude(), loc.getLongitude(), acc, spd, ts);
        FixStore.append(this, fix);
        emitFix(fix);
    }
}
