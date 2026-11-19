package com.jadonlee.todoapp;

import android.content.Context;
import android.graphics.Color;
import org.json.JSONException;
import org.json.JSONObject;

/** The last snapshot the app handed to the widget (shared/widget.ts `WidgetSnapshot`), kept in SharedPreferences. */
final class WidgetStore {

    private static final String PREFS = "widget";
    private static final String KEY = "snapshot";

    private WidgetStore() {}

    static void save(Context context, String snapshot) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, snapshot).apply();
    }

    /** Null until the app has run once since the widget was added. */
    static JSONObject load(Context context) {
        String json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        if (json == null) return null;
        try {
            return new JSONObject(json);
        } catch (JSONException e) {
            return null;
        }
    }

    /** A snapshot color, or the default theme's when there is no snapshot yet. */
    static int color(JSONObject snapshot, String name, String fallback) {
        JSONObject colors = snapshot == null ? null : snapshot.optJSONObject("colors");
        String value = colors == null ? null : colors.optString(name, null);
        try {
            return Color.parseColor(value != null ? value : fallback);
        } catch (IllegalArgumentException e) {
            return Color.parseColor(fallback);
        }
    }
}
