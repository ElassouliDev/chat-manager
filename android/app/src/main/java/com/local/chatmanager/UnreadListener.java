package com.local.chatmanager;

import android.app.Notification;
import android.os.Bundle;
import android.os.Parcelable;
import android.os.UserManager;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.HashMap;
import java.util.Map;

/**
 * Reads the notifications other chat apps post (only with your permission,
 * in Settings → Notification access) to show unread counts and the latest
 * message per account. It never opens, answers or dismisses anything.
 */
public class UnreadListener extends NotificationListenerService {

    static final class Unread {
        int count;
        String latest = "";
        long when;
    }

    interface Callback {
        void onUnreadChanged();
    }

    private static final Map<String, Unread> unread = new HashMap<>();
    private static volatile boolean connected;
    private static Callback callback;

    static synchronized Unread get(String key) {
        return unread.get(key);
    }

    static boolean isConnected() {
        return connected;
    }

    static void setCallback(Callback cb) {
        callback = cb;
    }

    @Override
    public void onListenerConnected() {
        connected = true;
        recount();
    }

    @Override
    public void onListenerDisconnected() {
        connected = false;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        recount();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        recount();
    }

    private void recount() {
        StatusBarNotification[] active;
        try {
            active = getActiveNotifications();
        } catch (SecurityException | NullPointerException e) {
            return;
        }
        if (active == null) return;
        UserManager um = getSystemService(UserManager.class);
        Map<String, Unread> next = new HashMap<>();
        for (StatusBarNotification sbn : active) {
            if (Services.forPackage(sbn.getPackageName()) == null) continue;
            Notification n = sbn.getNotification();
            // Skip "running", "calling now" and group summary notifications.
            if (sbn.isOngoing() || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) continue;
            String key = AccountStore.Account.key(sbn.getPackageName(), um.getSerialNumberForUser(sbn.getUser()));
            Unread u = next.get(key);
            if (u == null) next.put(key, u = new Unread());
            Bundle x = n.extras;
            Parcelable[] messages = x.getParcelableArray(Notification.EXTRA_MESSAGES);
            u.count += messages != null && messages.length > 0 ? messages.length : 1;
            if (n.when >= u.when) {
                u.when = n.when;
                CharSequence title = x.getCharSequence(Notification.EXTRA_TITLE);
                CharSequence text = x.getCharSequence(Notification.EXTRA_TEXT);
                u.latest = (title != null ? title + ": " : "") + (text != null ? text : "");
            }
        }
        synchronized (UnreadListener.class) {
            unread.clear();
            unread.putAll(next);
        }
        Callback cb = callback;
        if (cb != null) cb.onUnreadChanged();
    }
}
