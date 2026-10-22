package net.yurewatch.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * Android shell for YureWatch v0.1.
 *
 * The whole application is a single self-contained HTML file in
 * assets/index.html (see scripts/inline-single-file.mjs). Consequences:
 *
 *  - There is no local server, no localhost, and nothing to start by hand.
 *  - The UI appears as soon as the activity is created.
 *  - Network access is delegated to {@link NativeNet} rather than done by the
 *    page: a WebView loading from file:// has an opaque origin, so
 *    cross-origin fetch() would be blocked by CORS. The native bridge is also
 *    where the User-Agent is set, which the data provider asks clients to do.
 *
 * Lifecycle: onPause/onResume are forwarded to the JS feed so polling stops in
 * the background (no wake-lock is held, no foreground service in v0.1) and
 * resumes with an immediate refresh when the user returns. Back navigation is
 * handled by JS first (closes the detail panel / leaves demo mode) and only
 * then falls through to finishing the activity.
 */
public class MainActivity extends Activity {

    private static final String APP_URL = "file:///android_asset/index.html";
    private static final String DEMO_QUERY_EXTRA = "demo";

    private WebView webView;
    private View errorView;
    private boolean pageLoaded = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#070C12"));
        window.setNavigationBarColor(Color.parseColor("#080E15"));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#070C12"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#070C12"));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        // Let the layout use the notch area; the web CSS adds safe-area padding.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            webView.setFitsSystemWindows(false);
            root.setFitsSystemWindows(false);
            window.getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        webView.addJavascriptInterface(new NativeNet(this, webView), "YureWatchNative");
        // Language preference storage (see NativePrefs / src/i18n/storage.ts).
        webView.addJavascriptInterface(new NativePrefs(this), "YureWatchPrefs");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                hideError();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Only the main document failing is fatal: sub-resource errors
                // (none exist in a single-file build) are noise.
                if (request != null && request.isForMainFrame()) {
                    showError(getString(R.string.load_error) + " (" + error.getErrorCode() + ")");
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // The app is entirely offline-local. Any navigation away (a
                // tapped link in the "about" panel) opens externally instead of
                // replacing the application UI.
                String url = request.getUrl().toString();
                if (url.startsWith("file://")) {
                    return false;
                }
                try {
                    startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,
                            android.net.Uri.parse(url)));
                } catch (Exception ignored) {
                    // No browser installed: keep the app on screen.
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                android.util.Log.d("YureWatchWeb", message.message() + " @" + message.lineNumber());
                return true;
            }
        });

        TextView error = new TextView(this);
        error.setTextColor(Color.parseColor("#FFC3C9"));
        error.setBackgroundColor(Color.parseColor("#1A0E12"));
        error.setPadding(48, 48, 48, 48);
        error.setTextSize(15f);
        error.setVisibility(View.GONE);
        errorView = error;

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);

        applyEdgeToEdge(window);

        String demo = getIntent() != null ? getIntent().getStringExtra(DEMO_QUERY_EXTRA) : null;
        String url = APP_URL + (demo != null ? "?demo=" + demo : "");
        if (savedInstanceState == null) {
            webView.loadUrl(url);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void applyEdgeToEdge(Window window) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    private void showError(String message) {
        if (errorView instanceof TextView) {
            ((TextView) errorView).setText(message);
            errorView.setVisibility(View.VISIBLE);
        }
    }

    private void hideError() {
        if (errorView != null) {
            errorView.setVisibility(View.GONE);
        }
    }

    private void callJs(String expression) {
        if (webView == null || !pageLoaded) {
            return;
        }
        webView.evaluateJavascript(expression, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                // no-op
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        callJs("window.YureWatchOnPause && window.YureWatchOnPause()");
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
        }
        callJs("window.YureWatchOnResume && window.YureWatchOnResume()");
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return window.YureWatchBack?window.YureWatchBack():false}catch(e){return false}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String handled) {
                        // JS returns the literal string "true" when it consumed
                        // the gesture (closed a panel, left demo mode).
                        if (!"true".equals(handled)) {
                            MainActivity.super.onBackPressed();
                        }
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("YureWatchNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
