package jo.taqneen.taximeter;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Capacitor bridge for background trip tracking (Google Fused Location in a foreground service).
 *
 * JS: registerPlugin('TripTracker') – see src/app/native/trip-tracker.plugin.ts
 */
@CapacitorPlugin(
    name = "TripTracker",
    permissions = {
        @Permission(
            alias = TripTrackerPlugin.ALIAS_LOCATION,
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(alias = TripTrackerPlugin.ALIAS_NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class TripTrackerPlugin extends Plugin {

    private static final String TAG = "TripTracker";

    static final String ALIAS_LOCATION = "location";
    static final String ALIAS_NOTIFICATIONS = "notifications";

    private final TrackingService.Listener listener = new TrackingService.Listener() {
        @Override
        public void onFix(FixStore.Fix fix) {
            notifyListeners("fix", toJs(fix));
        }

        @Override
        public void onError(String message) {
            JSObject o = new JSObject();
            o.put("message", message);
            notifyListeners("error", o);
        }
    };

    @Override
    public void load() {
        TrackingService.setListener(listener);
    }

    @Override
    protected void handleOnDestroy() {
        TrackingService.setListener(null);
        super.handleOnDestroy();
    }

    // ---------------------------------------------------------------- permissions

    /** Maps Capacitor states to the app contract: granted | denied | prompt. */
    private static String simpleState(PermissionState s) {
        if (s == PermissionState.GRANTED) return "granted";
        if (s == PermissionState.DENIED) return "denied";
        return "prompt"; // PROMPT, PROMPT_WITH_RATIONALE or unknown
    }

    private JSObject permissionResult() {
        JSObject res = new JSObject();
        res.put(ALIAS_LOCATION, simpleState(getPermissionState(ALIAS_LOCATION)));
        if (Build.VERSION.SDK_INT >= 33) {
            res.put(ALIAS_NOTIFICATIONS, simpleState(getPermissionState(ALIAS_NOTIFICATIONS)));
        } else {
            // POST_NOTIFICATIONS is not a runtime permission before Android 13.
            res.put(ALIAS_NOTIFICATIONS, "granted");
        }
        return res;
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionResult());
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        List<String> requested = null;
        JSArray provided = call.getArray("permissions");
        if (provided != null) {
            try {
                requested = provided.toList();
            } catch (JSONException ignored) {
                requested = null;
            }
        }
        boolean all = requested == null || requested.isEmpty();

        List<String> aliases = new ArrayList<>();
        if ((all || requested.contains(ALIAS_LOCATION)) && getPermissionState(ALIAS_LOCATION) != PermissionState.GRANTED) {
            aliases.add(ALIAS_LOCATION);
        }
        if (
            Build.VERSION.SDK_INT >= 33 &&
            (all || requested.contains(ALIAS_NOTIFICATIONS)) &&
            getPermissionState(ALIAS_NOTIFICATIONS) != PermissionState.GRANTED
        ) {
            aliases.add(ALIAS_NOTIFICATIONS);
        }

        if (aliases.isEmpty()) {
            call.resolve(permissionResult());
            return;
        }
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "permissionsCallback");
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        call.resolve(permissionResult());
    }

    private boolean hasLocationPermission(Context ctx) {
        return (
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        );
    }

    // ---------------------------------------------------------------- tracking

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        if (!hasLocationPermission(ctx)) {
            call.reject(TrackingService.ERR_PERMISSION, "PERMISSION_DENIED");
            return;
        }
        int gms = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx);
        if (gms != ConnectionResult.SUCCESS) {
            Log.w(TAG, "Google Play services not available: " + gms);
            call.reject("خدمات Google Play مش متوفرة أو بحاجة تحديث على هذا الجهاز.", "GMS_UNAVAILABLE");
            return;
        }
        TrackingService.setActive(ctx, true);
        Intent intent = new Intent(ctx, TrackingService.class);
        intent.setAction(TrackingService.ACTION_START);
        try {
            ContextCompat.startForegroundService(ctx, intent);
            call.resolve();
        } catch (Exception e) {
            // e.g. ForegroundServiceStartNotAllowedException if called while app is in background.
            TrackingService.setActive(ctx, false);
            Log.e(TAG, "start failed", e);
            call.reject(TrackingService.ERR_START, "START_FAILED", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        TrackingService.setActive(ctx, false);
        try {
            ctx.stopService(new Intent(ctx, TrackingService.class));
        } catch (Exception e) {
            Log.w(TAG, "stopService failed", e);
        }
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject res = new JSObject();
        res.put("running", TrackingService.isRunning());
        call.resolve(res);
    }

    @PluginMethod
    public void drainFixes(PluginCall call) {
        List<FixStore.Fix> fixes = FixStore.drain(getContext());
        JSArray arr = new JSArray();
        for (FixStore.Fix f : fixes) {
            arr.put(toJs(f));
        }
        JSObject res = new JSObject();
        res.put("fixes", arr);
        call.resolve(res);
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        TrackingService.updateNotification(title, text);
        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Activity activity = getActivity();
        Context ctx = activity != null ? activity : getContext();
        String pkg = ctx.getPackageName();

        boolean ignoring = false;
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            ignoring = pm.isIgnoringBatteryOptimizations(pkg);
        }

        Intent primary;
        if (!ignoring) {
            primary = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
        } else {
            primary = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        }
        Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        Intent lastResort = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));

        boolean opened = launch(ctx, primary, activity == null) || launch(ctx, fallback, activity == null) || launch(ctx, lastResort, activity == null);

        JSObject res = new JSObject();
        res.put("opened", opened);
        res.put("ignoring", ignoring);
        call.resolve(res);
    }

    private boolean launch(Context ctx, Intent intent, boolean newTask) {
        try {
            if (newTask) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            Log.w(TAG, "cannot open " + intent.getAction(), e);
            return false;
        }
    }

    // ---------------------------------------------------------------- helpers

    private static JSObject toJs(FixStore.Fix f) {
        JSObject o = new JSObject();
        o.put("lat", f.lat);
        o.put("lon", f.lon);
        if (f.accuracy != null) {
            o.put("accuracy", f.accuracy.doubleValue());
        } else {
            o.put("accuracy", JSONObject.NULL);
        }
        if (f.speed != null) {
            o.put("speed", f.speed.doubleValue());
        } else {
            o.put("speed", JSONObject.NULL);
        }
        o.put("ts", f.ts);
        return o;
    }
}
