package app.mindnote;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import java.io.File;
import java.io.FileOutputStream;
import java.util.UUID;
import java.lang.ref.WeakReference;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {

    private static final int PORT = 8899;
    private static final String START_PAGE = "http://127.0.0.1:" + PORT + "/index.html";
    private static final int REQ_FILE = 1001;
    private static final int REQ_CAMERA = 1002;

    private MiniServer server;
    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutput;
    private final AtomicBoolean openTodos = new AtomicBoolean();
    private static WeakReference<MainActivity> foreground = new WeakReference<>(null);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openTodos.set(getIntent().getBooleanExtra(ReminderReceiver.OPEN_TODOS, false));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().setStatusBarColor(Color.WHITE);
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        File files = getFilesDir();
        server = new MiniServer(getAssets(), new File(files, "sync-data.json"), PORT);
        boolean ownServer = false;
        try {
            server.start();
            ownServer = true;
        } catch (Exception e) {
            // 端口被占（极少数情况）：页面照开，同步降级为「仅本机」
        }

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);   // 选图要读 content:// 的图片
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        web.setBackgroundColor(Color.WHITE);
        web.setWebViewClient(new RuibuWebClient(PORT));
        if (ownServer) web.addJavascriptInterface(new ReminderBridge(this), "RuibuReminders");
        web.setWebChromeClient(new MindChromeClient(this));
        setContentView(web);
        web.loadUrl(START_PAGE);
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = new WeakReference<>(this);
        reminderStateChanged();
    }

    @Override protected void onPause() {
        if (foreground.get() == this) foreground.clear();
        super.onPause();
    }

    static boolean showForegroundReminder(String id, String title) {
        MainActivity activity = foreground.get();
        if (activity == null || activity.isFinishing()) return false;
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("RUIBU 待办提醒")
                .setMessage(title).setPositiveButton("停止提醒", (d, which) -> d.dismiss()).create();
        dialog.setOnDismissListener(d -> ReminderReceiver.dismiss(activity, id));
        dialog.show();
        return true;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getBooleanExtra(ReminderReceiver.OPEN_TODOS, false)) openTodos.set(true);
        reminderStateChanged();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 1003) reminderStateChanged();
    }

    private void reminderStateChanged() {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('ruibu-reminders-resume'))", null);
    }

    boolean consumeOpenTodos() {
        return openTodos.getAndSet(false);
    }

    void openReminderSettings(String type) {
        if ("exact".equals(type) && Build.VERSION.SDK_INT >= 31) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (ActivityNotFoundException ignored) { }
        } else if ("fullscreen".equals(type) && Build.VERSION.SDK_INT >= 34) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                        Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException ignored) { }
        } else if ("notifications".equals(type)) {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                if (shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
                        || !getPreferences(MODE_PRIVATE).getBoolean("askedNotifications", false)) {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("askedNotifications", true).apply();
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1003);
                    return;
                }
            }
            openNotificationSettings();
        }
    }

    private void openNotificationSettings() {
        Intent intent;
        if (Build.VERSION.SDK_INT >= 26) {
            ReminderReceiver.ensureChannel(this);
            NotificationManager manager = getSystemService(NotificationManager.class);
            intent = new Intent(manager.areNotificationsEnabled()
                    ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS : Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            intent.putExtra(Settings.EXTRA_CHANNEL_ID, ReminderReceiver.CHANNEL);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        }
        try { startActivity(intent); }
        catch (ActivityNotFoundException ignored) { }
    }

    /** 由 MindChromeClient 调用：拉起系统相册 / 相机 */
    boolean startFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
        }
        filePathCallback = callback;
        if (params.isCaptureEnabled()) {
            return startCamera();
        }
        try {
            Intent intent = params.createIntent();
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(intent, REQ_FILE);
            return true;
        } catch (Exception e) {
            filePathCallback = null;
            callback.onReceiveValue(null);
            return true;
        }
    }

    private boolean startCamera() {
        try {
            File directory = CaptureProvider.directory(this);
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Camera cache");
            File[] oldCaptures = directory.listFiles();
            if (oldCaptures != null) {
                long cutoff = System.currentTimeMillis() - 86400000L;
                for (File file : oldCaptures) if (file.lastModified() < cutoff) file.delete();
            }
            String name = UUID.randomUUID().toString().replace("-", "") + ".jpg";
            cameraOutput = Uri.parse("content://" + getPackageName() + ".capture/" + name);
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutput);
            camera.setClipData(ClipData.newRawUri("photo", cameraOutput));
            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            startActivityForResult(camera, REQ_CAMERA);
        } catch (Exception e) {
            cameraOutput = null;
            finishFileSelection(null);
            android.widget.Toast.makeText(this, "无法打开系统相机", android.widget.Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void finishFileSelection(Uri[] results) {
        ValueCallback<Uri[]> callback = filePathCallback;
        filePathCallback = null;
        if (callback != null) callback.onReceiveValue(results);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_CAMERA) {
            Uri output = cameraOutput;
            cameraOutput = null;
            Uri result = null;
            if (output != null) {
                File file = CaptureProvider.fileFor(this, output);
                if (resultCode == RESULT_OK) {
                    if (file.length() == 0 && data != null && data.getExtras() != null) {
                        Object thumbnail = data.getExtras().get("data");
                        if (thumbnail instanceof Bitmap) {
                            try (FileOutputStream bytes = new FileOutputStream(file)) {
                                ((Bitmap) thumbnail).compress(Bitmap.CompressFormat.JPEG, 95, bytes);
                            } catch (Exception ignored) { }
                        }
                    }
                    result = file.length() > 0 ? output : data == null ? null : data.getData();
                }
                if (result != output) file.delete();
                revokeUriPermission(output, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            }
            finishFileSelection(result == null ? null : new Uri[]{result});
            return;
        }
        if (requestCode == REQ_FILE) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    results = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        results[i] = clip.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            finishFileSelection(results);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** 返回键交给页面：图片 → 画布 → 笔记，一层一层退 */
    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.__ruibuBack ? window.__ruibuBack() : '')", value -> {
            boolean handled = value != null && value.contains("ok");
            if (!handled) {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        finishAndRemoveTask();
                    } else {
                        finish();
                    }
                });
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
