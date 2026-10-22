package net.yurewatch.app;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * HTTPS bridge for the WebView.
 *
 * Why this exists: assets are loaded from file://, so the page's origin is
 * opaque and a cross-origin fetch() to https://api.p2pquake.net would be
 * rejected by the WebView's CORS rules. Doing the request natively also lets us
 * set an honest User-Agent, which the data provider asks API clients to do, and
 * keeps the API host out of any page-level fetch that a bug could redirect.
 *
 * Contract with src/net/transport.ts:
 *   request(id, url, timeoutMs)               <- called from JS
 *   window.__yurewatchNativeResolve(id, json) <- called back on the UI thread
 * where json is {"status":<int>,"body":"<text>"} or {"error":"<message>"}.
 */
final class NativeNet {

    private final WebView webView;
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private static final String USER_AGENT = "YureWatch/0.1 (Android; +https://github.com/)";

    NativeNet(MainActivity activity, WebView webView) {
        this.webView = webView;
    }

    @JavascriptInterface
    public void request(final String id, final String url, final int timeoutMs) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            respond(id, errorPayload("許可されていないURLです"));
            return;
        }
        pool.execute(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(url).openConnection();
                    int timeout = timeoutMs > 0 ? timeoutMs : 15000;
                    connection.setConnectTimeout(timeout);
                    connection.setReadTimeout(timeout);
                    connection.setRequestMethod("GET");
                    connection.setRequestProperty("Accept", "application/json");
                    connection.setRequestProperty("User-Agent", USER_AGENT);
                    connection.setInstanceFollowRedirects(true);
                    connection.setUseCaches(false);

                    int status = connection.getResponseCode();
                    InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    String body = stream == null ? "" : readFully(stream);

                    JSONObject payload = new JSONObject();
                    payload.put("status", status);
                    payload.put("body", body);
                    respond(id, payload.toString());
                } catch (Exception e) {
                    String message = e.getClass().getSimpleName();
                    if (e.getMessage() != null) {
                        message = message + ": " + e.getMessage();
                    }
                    respond(id, errorPayload(message));
                } finally {
                    if (connection != null) {
                        connection.disconnect();
                    }
                }
            }
        });
    }

    private static String readFully(InputStream stream) throws Exception {
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            int total = 0;
            // Hard cap so a misbehaving endpoint cannot exhaust memory.
            while ((read = stream.read(chunk)) != -1) {
                total += read;
                if (total > 8 * 1024 * 1024) {
                    break;
                }
                buffer.write(chunk, 0, read);
            }
            return buffer.toString("UTF-8");
        } finally {
            stream.close();
        }
    }

    private static String errorPayload(String message) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("error", message);
            return payload.toString();
        } catch (Exception e) {
            return "{\"error\":\"unknown\"}";
        }
    }

    private void respond(final String id, final String payloadJson) {
        final String script =
                "window.__yurewatchNativeResolve && window.__yurewatchNativeResolve("
                        + JSONObject.quote(id) + "," + JSONObject.quote(payloadJson) + ")";
        if (webView == null) {
            return;
        }
        webView.post(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(script, null);
                }
            }
        });
    }
}
