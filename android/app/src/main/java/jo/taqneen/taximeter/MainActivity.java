package jo.taqneen.taximeter;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local (in-app) plugins must be registered before super.onCreate builds the bridge.
        registerPlugin(TripTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
