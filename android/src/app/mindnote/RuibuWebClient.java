package app.mindnote;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Keep the WebView that contains the native reminder bridge on RUIBU's own origin. */
final class RuibuWebClient extends WebViewClient {
    private final int port;

    RuibuWebClient(int port) { this.port = port; }

    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if ("http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == port) {
            return false;
        }
        if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
            try { view.getContext().startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
            catch (ActivityNotFoundException ignored) { }
        }
        return true;
    }
}
