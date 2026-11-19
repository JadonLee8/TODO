package com.jadonlee.todoapp;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Receives text shared to the app from Android's share sheet (ACTION_SEND, text/*). The web app takes the pending
 * share with takePending() when it starts, and again whenever "shareReceived" fires (a share while it is running).
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    private JSObject pending;

    @Override
    public void load() {
        take(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (take(intent)) notifyListeners("shareReceived", new JSObject());
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject result = new JSObject();
        if (pending != null) result.put("share", pending);
        pending = null;
        call.resolve(result);
    }

    private boolean take(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return false;
        JSObject share = new JSObject();
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (subject != null) share.put("subject", subject);
        if (text != null) share.put("text", text.toString());
        pending = share;
        // Consume it, so the activity being recreated doesn't add the same task again.
        intent.setAction(Intent.ACTION_MAIN);
        return true;
    }
}
