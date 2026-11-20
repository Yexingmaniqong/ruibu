package app.mindnote;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

/** Alarm registrations are kept alongside the Android scheduler, even while the WebView is closed. */
public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL = "todo-alarms-v2";
    static final String OPEN_TODOS = "open-todos";
    static final String ALARM_ID = "alarm-id";
    static final String ALARM_TITLE = "alarm-title";
    private static final String FIRE = "app.mindnote.REMINDER";
    private static final String DISMISS = "app.mindnote.DISMISS_REMINDER";
    private static final String KEY = "reminders";
    private static final long[] VIBRATION = {0, 220, 100, 220};

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(KEY, Context.MODE_PRIVATE);
    }

    private static JSONObject load(Context context) {
        try {
            return new JSONObject(preferences(context).getString(KEY, "{}"));
        } catch (JSONException invalid) {
            return new JSONObject();
        }
    }

    static boolean exactAllowed(Context context) {
        return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    static boolean notificationsAllowed(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    static boolean fullScreenAllowed(Context context) {
        return Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager.class).canUseFullScreenIntent();
    }

    private static AudioAttributes alarmAudio() {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
    }

    static void dismiss(Context context, String id) {
        if (id != null) context.getSystemService(NotificationManager.class).cancel(id, 1);
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "待办闹铃", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("在设定的时间提醒 RUIBU 待办");
        channel.enableVibration(true);
        channel.setVibrationPattern(VIBRATION);
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmAudio());
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private static PendingIntent trigger(Context context, String id) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(FIRE);
        intent.setData(Uri.fromParts("ruibu-reminder", id, null));
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE);
    }

    private static void schedule(Context context, String id, long at) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        PendingIntent pending = trigger(context, id);
        if (exactAllowed(context)) {
            try {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                return;
            } catch (SecurityException permissionChanged) {
                // Permission may change while processing a grant broadcast.
            }
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
    }

    static synchronized boolean replace(Context context, String payload) {
        JSONObject previous = load(context);
        JSONObject next = new JSONObject();
        long now = System.currentTimeMillis();
        try {
            JSONArray tasks = new JSONArray(payload);
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject task = tasks.getJSONObject(i);
                String id = task.getString("id");
                String title = task.getString("title").trim();
                long at = task.getLong("at");
                if (!id.matches("[A-Za-z0-9_-]{1,80}") || title.isEmpty() || title.length() > 160 || at <= 0) continue;
                JSONObject old = previous.optJSONObject(id);
                boolean sameTime = old != null && old.optLong("at") == at;
                next.put(id, new JSONObject().put("at", at).put("title", title)
                        .put("fired", sameTime ? old.optBoolean("fired") : at <= now));
            }
        } catch (JSONException invalid) {
            return false;
        }
        if (!preferences(context).edit().putString(KEY, next.toString()).commit()) return false;
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        Iterator<String> ids = previous.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            JSONObject old = previous.optJSONObject(id);
            JSONObject task = next.optJSONObject(id);
            if (task == null || task.optLong("at") != old.optLong("at")) {
                alarms.cancel(trigger(context, id));
                notifications.cancel(id, 1);
            }
        }
        reschedule(context, next, false);
        return true;
    }

    private static void reschedule(Context context, JSONObject tasks, boolean systemRestart) {
        long now = System.currentTimeMillis();
        Iterator<String> ids = tasks.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            JSONObject task = tasks.optJSONObject(id);
            if (task == null || task.optBoolean("fired")) continue;
            long at = task.optLong("at");
            if (at > now) schedule(context, id, at);
            else if (systemRestart) deliver(context, tasks, id);
        }
    }

    private static void deliver(Context context, JSONObject tasks, String id) {
        JSONObject task = tasks.optJSONObject(id);
        if (task == null || task.optBoolean("fired") || task.optLong("at") > System.currentTimeMillis()) return;
        try {
            task.put("fired", true);
        } catch (JSONException invalid) {
            return;
        }
        if (!preferences(context).edit().putString(KEY, tasks.toString()).commit()
                || !notificationsAllowed(context)) return;
        ensureChannel(context);
        Intent open = new Intent(context, MainActivity.class);
        open.putExtra(OPEN_TODOS, true);
        open.setData(Uri.fromParts("ruibu-todo", id, null));
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String title = task.optString("title");
        Intent dismiss = new Intent(context, ReminderReceiver.class)
                .setAction(DISMISS).setData(Uri.fromParts("ruibu-reminder", id, null));
        PendingIntent stop = PendingIntent.getBroadcast(context, 0, dismiss, PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder notice = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        notice.setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("RUIBU 待办提醒")
                .setContentText(title)
                .setStyle(new Notification.BigTextStyle().bigText(title))
                .setPriority(Notification.PRIORITY_HIGH)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(content)
                .addAction(new Notification.Action.Builder(null, "停止提醒", stop).build())
                .setAutoCancel(true);
        if (Build.VERSION.SDK_INT < 26) {
            notice.setVibrate(VIBRATION);
            notice.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmAudio());
        } else notice.setTimeoutAfter(60000);
        if (!MainActivity.showForegroundReminder(id, title)) {
            Intent alarm = new Intent(context, ReminderAlarmActivity.class)
                    .setData(Uri.fromParts("ruibu-alarm", id, null))
                    .putExtra(ALARM_ID, id).putExtra(ALARM_TITLE, title)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent panel = PendingIntent.getActivity(context, 0, alarm,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            notice.setFullScreenIntent(panel, true);
        }
        Notification notification = notice.build();
        if (Build.VERSION.SDK_INT >= 26) notification.flags |= Notification.FLAG_INSISTENT;
        context.getSystemService(NotificationManager.class).notify(id, 1, notification);
    }

    @Override public void onReceive(Context context, Intent intent) {
        synchronized (ReminderReceiver.class) {
            JSONObject tasks = load(context);
            String action = intent.getAction();
            if (DISMISS.equals(action) && intent.getData() != null) {
                dismiss(context, intent.getData().getSchemeSpecificPart());
            } else if (FIRE.equals(action) && intent.getData() != null) {
                deliver(context, tasks, intent.getData().getSchemeSpecificPart());
            } else if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                    || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                    || AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
                reschedule(context, tasks, true);
            }
        }
    }
}
