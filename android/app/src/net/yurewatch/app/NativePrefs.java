package net.yurewatch.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

/**
 * Tiny key/value store for user preferences that must survive a restart.
 *
 * Why not just use WebView localStorage: the app loads its assets from
 * file:///android_asset/, and storage is not reliably persistent for that origin
 * across process restarts (and can be cleared with the WebView cache). The
 * language choice is a user preference, not cache, so it lives in
 * SharedPreferences and the web layer treats this bridge as authoritative.
 *
 * Contract with src/i18n/storage.ts:
 *   getPref(key): string | null
 *   setPref(key, value): void
 *
 * Only a locale code is ever written here. Nothing sensitive goes through this
 * interface, and the values are size-capped so a bug cannot grow the prefs file.
 */
final class NativePrefs {

    private static final String STORE = "yurewatch-prefs";
    private static final int MAX_VALUE_LENGTH = 256;

    private final SharedPreferences prefs;

    NativePrefs(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String getPref(String key) {
        if (key == null || key.isEmpty()) return null;
        try {
            return prefs.getString(key, null);
        } catch (ClassCastException e) {
            // A value stored under the same key with a different type: ignore it
            // rather than crashing the app over a preference.
            return null;
        }
    }

    @JavascriptInterface
    public void setPref(String key, String value) {
        if (key == null || key.isEmpty()) return;
        if (value != null && value.length() > MAX_VALUE_LENGTH) return;
        prefs.edit().putString(key, value).apply();
    }
}
