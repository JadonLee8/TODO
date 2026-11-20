package com.jadonlee.todoapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

/**
 * Home-screen widget: the top of the ranked Tasks list. It shows the snapshot the app last saved (WidgetBridgePlugin)
 * and never reads tasks or syncs itself. Tapping a task opens it in the app; "+" opens the app on the add box.
 */
public class TasksWidgetProvider extends AppWidgetProvider {

    static final String ACTION_OPEN_TASK = "com.jadonlee.todoapp.OPEN_TASK";
    static final String ACTION_ADD_TASK = "com.jadonlee.todoapp.ADD_TASK";
    static final String EXTRA_TASK_ID = "taskId";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) manager.updateAppWidget(id, fullViews(context, id));
        manager.notifyAppWidgetViewDataChanged(widgetIds, R.id.widget_list);
    }

    /** Redraws every placed widget from the saved snapshot. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TasksWidgetProvider.class));
        if (ids.length == 0) return;
        manager.partiallyUpdateAppWidget(ids, header(context));
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    /**
     * Colors, font, style and texts outside the list: everything that changes with the snapshot. The terminal style
     * draws a square window titled with a prompt (`todo:~$ ls`) and a bare "+".
     */
    private static RemoteViews header(Context context) {
        JSONObject snapshot = WidgetStore.load(context);
        int background = WidgetStore.color(snapshot, "background", "#FFFFFF");
        int text = WidgetStore.color(snapshot, "text", "#1E2433");
        int muted = WidgetStore.color(snapshot, "muted", "#5B6475");
        int accent = WidgetStore.color(snapshot, "accent", "#F2E35C");
        int ok = WidgetStore.color(snapshot, "ok", "#1F7A4D");
        boolean terminal = WidgetStore.terminal(snapshot);
        String family = WidgetStore.fontFamily(snapshot);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);
        views.setImageViewResource(R.id.widget_background, terminal ? R.drawable.widget_background_square : R.drawable.widget_background);
        views.setInt(R.id.widget_background, "setColorFilter", background);
        views.setTextColor(R.id.widget_title, text);
        views.setTextColor(R.id.widget_count, muted);
        views.setTextColor(R.id.widget_empty, muted);
        views.setInt(R.id.widget_add_background, "setColorFilter", accent);
        views.setViewVisibility(R.id.widget_add_background, terminal ? View.GONE : View.VISIBLE);
        views.setTextColor(R.id.widget_add_label, terminal ? ok : text);
        views.setTextViewText(R.id.widget_add_label, WidgetStore.inFamily("+", family));

        if (terminal) {
            SpannableStringBuilder prompt = new SpannableStringBuilder("todo");
            prompt.setSpan(new ForegroundColorSpan(ok), 0, prompt.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            prompt.append(":~$ ls");
            views.setTextViewText(R.id.widget_title, WidgetStore.inFamily(prompt, family));
        } else {
            views.setTextViewText(R.id.widget_title, WidgetStore.inFamily(context.getString(R.string.widget_title), family));
        }

        if (snapshot == null) {
            views.setTextViewText(R.id.widget_count, "");
            views.setTextViewText(R.id.widget_empty, WidgetStore.inFamily(context.getString(R.string.widget_not_loaded), family));
        } else {
            int open = snapshot.optInt("openCount", 0);
            String count = open == 0 ? "" : terminal ? "[" + open + "]" : String.valueOf(open);
            views.setTextViewText(R.id.widget_count, WidgetStore.inFamily(count, family));
            String empty = terminal ? "nothing to do" : context.getString(R.string.widget_empty);
            views.setTextViewText(R.id.widget_empty, WidgetStore.inFamily(empty, family));
        }
        return views;
    }

    /** The whole widget: the header plus the list's adapter and every tap target. */
    private static RemoteViews fullViews(Context context, int widgetId) {
        RemoteViews views = header(context);

        Intent service = new Intent(context, TasksWidgetService.class);
        service.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        // A distinct data URI per widget, so each placed widget gets its own list adapter.
        service.setData(Uri.parse(service.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, service);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        // Each row fills in its task id (TasksWidgetService), so this template must stay mutable.
        int mutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        Intent openTask = new Intent(context, MainActivity.class).setAction(ACTION_OPEN_TASK);
        views.setPendingIntentTemplate(
            R.id.widget_list,
            PendingIntent.getActivity(context, 1, openTask, PendingIntent.FLAG_UPDATE_CURRENT | mutable)
        );

        Intent add = new Intent(context, MainActivity.class).setAction(ACTION_ADD_TASK);
        views.setOnClickPendingIntent(
            R.id.widget_add,
            PendingIntent.getActivity(context, 2, add, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
        );

        Intent launch = new Intent(context, MainActivity.class).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        views.setOnClickPendingIntent(
            R.id.widget_header,
            PendingIntent.getActivity(context, 3, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
        );
        return views;
    }
}
