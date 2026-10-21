package jo.taqneen.taximeter;

import android.content.Context;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Thread-safe buffer of GPS fixes collected by {@link TrackingService}.
 *
 * Every fix is kept in memory AND appended to {@code filesDir/fixes.jsonl} so that a
 * WebView reload (or even a process restart) does not lose fixes. {@link #drain(Context)}
 * returns everything and clears both.
 */
public final class FixStore {

    private static final String TAG = "FixStore";
    private static final String FILE_NAME = "fixes.jsonl";
    /** Safety cap for the in-memory list (~5.5 h at 1 Hz). The file is the source of truth. */
    private static final int MAX_MEMORY = 20000;

    private static final Object LOCK = new Object();
    private static final List<Fix> MEMORY = new ArrayList<>();

    private FixStore() {}

    /** Immutable GPS fix. accuracy / speed may be null. */
    public static final class Fix {
        public final double lat;
        public final double lon;
        public final Double accuracy;
        public final Double speed;
        public final long ts;

        public Fix(double lat, double lon, Double accuracy, Double speed, long ts) {
            this.lat = lat;
            this.lon = lon;
            this.accuracy = accuracy;
            this.speed = speed;
            this.ts = ts;
        }

        String key() {
            return ts + "|" + lat + "|" + lon;
        }

        JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("lat", lat);
            o.put("lon", lon);
            o.put("accuracy", accuracy != null ? accuracy : JSONObject.NULL);
            o.put("speed", speed != null ? speed : JSONObject.NULL);
            o.put("ts", ts);
            return o;
        }

        static Fix fromJson(JSONObject o) throws JSONException {
            Double acc = o.isNull("accuracy") ? null : o.getDouble("accuracy");
            Double spd = o.isNull("speed") ? null : o.getDouble("speed");
            return new Fix(o.getDouble("lat"), o.getDouble("lon"), acc, spd, o.getLong("ts"));
        }
    }

    private static File file(Context ctx) {
        return new File(ctx.getFilesDir(), FILE_NAME);
    }

    /** Appends a fix to memory and to the jsonl file. */
    public static void append(Context ctx, Fix fix) {
        synchronized (LOCK) {
            if (MEMORY.size() >= MAX_MEMORY) {
                MEMORY.remove(0);
            }
            MEMORY.add(fix);
            FileOutputStream out = null;
            try {
                String line = fix.toJson().toString() + "\n";
                out = new FileOutputStream(file(ctx), true);
                out.write(line.getBytes(StandardCharsets.UTF_8));
            } catch (IOException | JSONException e) {
                Log.w(TAG, "append failed", e);
            } finally {
                if (out != null) {
                    try {
                        out.close();
                    } catch (IOException ignored) {
                        // ignore
                    }
                }
            }
        }
    }

    /** Returns all buffered fixes (file + memory, de-duplicated, sorted by ts) and clears both. */
    public static List<Fix> drain(Context ctx) {
        synchronized (LOCK) {
            Map<String, Fix> merged = new LinkedHashMap<>();
            File f = file(ctx);
            if (f.exists()) {
                BufferedReader reader = null;
                try {
                    reader = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8));
                    String line;
                    while ((line = reader.readLine()) != null) {
                        line = line.trim();
                        if (line.isEmpty()) continue;
                        try {
                            Fix fix = Fix.fromJson(new JSONObject(line));
                            merged.put(fix.key(), fix);
                        } catch (JSONException bad) {
                            // a partially written last line after a crash – skip it
                        }
                    }
                } catch (IOException e) {
                    Log.w(TAG, "read failed", e);
                } finally {
                    if (reader != null) {
                        try {
                            reader.close();
                        } catch (IOException ignored) {
                            // ignore
                        }
                    }
                }
                if (!f.delete()) {
                    Log.w(TAG, "could not delete " + f);
                }
            }
            for (Fix fix : MEMORY) {
                merged.put(fix.key(), fix);
            }
            MEMORY.clear();

            List<Fix> result = new ArrayList<>(merged.values());
            java.util.Collections.sort(result, (a, b) -> Long.compare(a.ts, b.ts));
            return result;
        }
    }
}
