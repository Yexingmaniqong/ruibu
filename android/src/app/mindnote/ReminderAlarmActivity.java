package app.mindnote;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

public final class ReminderAlarmActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        String id = getIntent().getStringExtra(ReminderReceiver.ALARM_ID);
        String title = getIntent().getStringExtra(ReminderReceiver.ALARM_TITLE);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("RUIBU 待办提醒")
                .setMessage(title).setPositiveButton("停止提醒", (d, which) -> d.dismiss()).create();
        dialog.setOnDismissListener(d -> {
            ReminderReceiver.dismiss(this, id);
            finish();
        });
        dialog.show();
    }
}
