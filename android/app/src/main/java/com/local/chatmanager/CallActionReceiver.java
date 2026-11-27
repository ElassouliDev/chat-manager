package com.local.chatmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Decline from the call notification: presses the service's Decline button without opening the app. */
public class CallActionReceiver extends BroadcastReceiver {

    static final String ACTION_DECLINE = "com.local.chatmanager.DECLINE_CALL";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_DECLINE.equals(intent.getAction())) return;
        String account = intent.getStringExtra(Notifier.EXTRA_ACCOUNT);
        int id = intent.getIntExtra(Notifier.EXTRA_NOTIFICATION, 0);
        if (account == null) return;
        Notifier.cancelCall(context, account, id);
        MainActivity activity = MainActivity.current();
        if (activity != null) activity.callAction(account, "decline");
    }
}
