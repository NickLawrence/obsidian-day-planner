package com.nicklawrence.dayplanner;

import com.getcapacitor.BridgeActivity;
import com.nicklawrence.dayplanner.notifications.ActivityNotificationsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ActivityNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
