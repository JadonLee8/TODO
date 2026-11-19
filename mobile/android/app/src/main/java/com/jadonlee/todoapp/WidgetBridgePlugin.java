package com.jadonlee.todoapp;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The web app's side of the home-screen widget: update() saves a new snapshot and redraws the widget, and taps on the
 * widget come back as a pending action (takePending, plus "widgetAction" while the app is running).
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    private JSObject pending;

    @Override
    public void load() {
        take(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (take(intent)) notifyListeners("widgetAction", new JSObject());
    }

    @PluginMethod
    public void update(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null) {
            call.reject("snapshot is required");
            return;
        }
        WidgetStore.save(getContext(), snapshot);
        TasksWidgetProvider.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject result = new JSObject();
        if (pending != null) result.put("action", pending);
        pending = null;
        call.resolve(result);
    }

    private boolean take(Intent intent) {
        if (intent == null || intent.getAction() == null) return false;
        JSObject action = new JSObject();
        if (TasksWidgetProvider.ACTION_OPEN_TASK.equals(intent.getAction())) {
            String id = intent.getStringExtra(TasksWidgetProvider.EXTRA_TASK_ID);
            if (id == null) return false;
            action.put("kind", "task");
            action.put("taskId", id);
        } else if (TasksWidgetProvider.ACTION_ADD_TASK.equals(intent.getAction())) {
            action.put("kind", "add");
        } else {
            return false;
        }
        pending = action;
        // Consume it, so the activity being recreated doesn't repeat the action.
        intent.setAction(Intent.ACTION_MAIN);
        return true;
    }
}
