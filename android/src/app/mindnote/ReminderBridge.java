package app.mindnote;

import android.webkit.JavascriptInterface;

public final class ReminderBridge {
    private final MainActivity activity;

    ReminderBridge(MainActivity activity) { this.activity = activity; }

    @JavascriptInterface public boolean replace(String payload) {
        return ReminderReceiver.replace(activity.getApplicationContext(), payload);
    }

    @JavascriptInterface public String status() {
        return "{\"notifications\":" + ReminderReceiver.notificationsAllowed(activity)
                + ",\"exact\":" + ReminderReceiver.exactAllowed(activity)
                + ",\"fullscreen\":" + ReminderReceiver.fullScreenAllowed(activity) + "}";
    }

    @JavascriptInterface public boolean consumeOpenTodos() {
        return activity.consumeOpenTodos();
    }

    @JavascriptInterface public void openSettings(String type) {
        activity.runOnUiThread(() -> activity.openReminderSettings(type));
    }
}
