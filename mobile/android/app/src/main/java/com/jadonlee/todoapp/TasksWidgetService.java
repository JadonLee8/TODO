package com.jadonlee.todoapp;

import android.content.Context;
import android.content.Intent;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import org.json.JSONArray;
import org.json.JSONObject;

/** Supplies the widget's task rows from the saved snapshot. */
public class TasksWidgetService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Rows(getApplicationContext());
    }

    private static final class Rows implements RemoteViewsFactory {

        private final Context context;
        private JSONArray tasks = new JSONArray();
        private int text;
        private int muted;
        private int danger;
        private boolean terminal;
        private String family = "sans-serif";

        Rows(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            JSONObject snapshot = WidgetStore.load(context);
            JSONArray loaded = snapshot == null ? null : snapshot.optJSONArray("tasks");
            tasks = loaded == null ? new JSONArray() : loaded;
            text = WidgetStore.color(snapshot, "text", "#1E2433");
            muted = WidgetStore.color(snapshot, "muted", "#5B6475");
            danger = WidgetStore.color(snapshot, "danger", "#B3261E");
            terminal = WidgetStore.terminal(snapshot);
            family = WidgetStore.fontFamily(snapshot);
        }

        @Override
        public void onDestroy() {}

        @Override
        public int getCount() {
            return tasks.length();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_task_row);
            JSONObject task = tasks.optJSONObject(position);
            if (task == null) return row;

            int priority = task.optInt("priority", 3);
            boolean starred = task.optBoolean("starred");
            String title = task.optString("title");
            row.setTextColor(R.id.widget_row_title, text);
            if (terminal) {
                // One line, as the app's terminal lists it: `[ ] p1 * Title`.
                SpannableStringBuilder line = new SpannableStringBuilder();
                appendColored(line, "[ ] ", muted);
                appendColored(line, "p" + priority, priority == 1 ? danger : muted);
                line.append(starred ? " * " : "   ").append(title);
                row.setViewVisibility(R.id.widget_row_priority, View.GONE);
                row.setViewVisibility(R.id.widget_row_star, View.GONE);
                row.setTextViewText(R.id.widget_row_title, WidgetStore.inFamily(line, family));
            } else {
                row.setViewVisibility(R.id.widget_row_priority, View.VISIBLE);
                row.setTextViewText(R.id.widget_row_priority, WidgetStore.inFamily("P" + priority, family));
                row.setTextColor(R.id.widget_row_priority, priority == 1 ? danger : muted);
                row.setTextViewText(R.id.widget_row_title, WidgetStore.inFamily(title, family));
                row.setViewVisibility(R.id.widget_row_star, starred ? View.VISIBLE : View.GONE);
                row.setTextColor(R.id.widget_row_star, text);
            }

            String due = task.isNull("due") ? null : task.optString("due", null);
            row.setViewVisibility(R.id.widget_row_due, due == null ? View.GONE : View.VISIBLE);
            if (due != null) {
                row.setTextViewText(R.id.widget_row_due, WidgetStore.inFamily(terminal ? "due " + due : due, family));
                row.setTextColor(R.id.widget_row_due, task.optBoolean("overdue") ? danger : muted);
            }

            Intent open = new Intent().putExtra(TasksWidgetProvider.EXTRA_TASK_ID, task.optString("id"));
            row.setOnClickFillInIntent(R.id.widget_row, open);
            return row;
        }

        private static void appendColored(SpannableStringBuilder builder, String part, int color) {
            int start = builder.length();
            builder.append(part);
            builder.setSpan(new ForegroundColorSpan(color), start, builder.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }
    }
}
