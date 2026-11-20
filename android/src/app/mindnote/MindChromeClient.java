package app.mindnote;

import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/** 单独一个类：网页里的 <input type="file"> 需要它才能弹系统相册/相机 */
public class MindChromeClient extends WebChromeClient {

    private final MainActivity activity;

    MindChromeClient(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                     FileChooserParams params) {
        return activity.startFileChooser(callback, params);
    }
}
