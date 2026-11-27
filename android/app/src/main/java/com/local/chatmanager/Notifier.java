package com.local.chatmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import java.util.regex.Pattern;

/** Android notifications for messages, incoming calls, and the "running" notice. */
final class Notifier {

    static final String CH_MESSAGES = "messages";
    static final String CH_CALLS = "calls";
    static final String CH_RUNNING = "running";
    static final int RUNNING_ID = 1;

    static final String EXTRA_ACCOUNT = "account";
    static final String EXTRA_NOTIFICATION = "notification";
    static final String EXTRA_ACTION = "action";

    private static final Pattern CALL_WORDS = Pattern.compile(
            "(incoming|voice|video)\\s+call|calling|huddle|مكالمة|يتصل", Pattern.CASE_INSENSITIVE);

    static void createChannels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);

        NotificationChannel messages = new NotificationChannel(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("New messages from your accounts");
        nm.createNotificationChannel(messages);

        NotificationChannel calls = new NotificationChannel(CH_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Rings for incoming calls, with Answer and Decline");
        calls.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[]{0, 800, 600, 800, 600});
        nm.createNotificationChannel(calls);

        NotificationChannel running = new NotificationChannel(CH_RUNNING, "Running in background", NotificationManager.IMPORTANCE_MIN);
        running.setDescription("Keeps your chats connected so messages and calls arrive");
        running.setShowBadge(false);
        nm.createNotificationChannel(running);
    }

    private static int requestCode(String accountId, int id, int kind) {
        return (accountId.hashCode() * 31 + id) * 4 + kind;
    }

    static Intent openIntent(Context c, String accountId, int notificationId, String action) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(EXTRA_ACCOUNT, accountId);
        i.putExtra(EXTRA_NOTIFICATION, notificationId);
        if (action != null) i.putExtra(EXTRA_ACTION, action);
        return i;
    }

    private static PendingIntent activity(Context c, String accountId, int id, String action, int kind) {
        return PendingIntent.getActivity(c, requestCode(accountId, id, kind), openIntent(c, accountId, id, action),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void showMessage(Context c, AccountStore.Account a, int id, String title, String body) {
        Services.Service s = Services.get(a.service);
        Notification n = new Notification.Builder(c, CH_MESSAGES)
                .setSmallIcon(R.drawable.ic_stat_chat)
                .setColor(s.color)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setSubText(a.name + " · " + s.label)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setGroup(a.id)
                .setContentIntent(activity(c, a.id, id, "open", 0))
                .build();
        c.getSystemService(NotificationManager.class).notify(a.id, id, n);
    }

    static void cancel(Context c, String accountId, int id) {
        c.getSystemService(NotificationManager.class).cancel(accountId, id);
    }

    static void cancelCall(Context c, String accountId, int id) {
        c.getSystemService(NotificationManager.class).cancel("call:" + accountId, id);
    }

    /** Services put the caller in the title or the body, and "Incoming call" in the other. */
    static String[] splitCaller(String title, String body) {
        boolean titleIsCall = CALL_WORDS.matcher(title).find();
        boolean bodyIsCall = CALL_WORDS.matcher(body).find();
        if (titleIsCall && !body.isEmpty() && !bodyIsCall) return new String[]{body, title};
        if (bodyIsCall && !title.isEmpty() && !titleIsCall) return new String[]{title, body};
        return new String[]{body.isEmpty() ? (title.isEmpty() ? "Incoming call" : title) : body, body.isEmpty() ? "" : title};
    }

    /** A ringing call notification with Answer and Decline, shown full screen when the phone is locked. */
    static void showCall(Context c, AccountStore.Account a, int id, String title, String body) {
        Services.Service s = Services.get(a.service);
        String[] parts = splitCaller(title, body);
        String caller = parts[0];
        String kind = parts[1].isEmpty() ? "Incoming call" : parts[1];

        PendingIntent open = activity(c, a.id, id, "open", 1);
        PendingIntent answer = activity(c, a.id, id, "answer", 2);
        Intent declineIntent = new Intent(c, CallActionReceiver.class)
                .setAction(CallActionReceiver.ACTION_DECLINE)
                .putExtra(EXTRA_ACCOUNT, a.id)
                .putExtra(EXTRA_NOTIFICATION, id);
        PendingIntent decline = PendingIntent.getBroadcast(c, requestCode(a.id, id, 3), declineIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = new Notification.Builder(c, CH_CALLS)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setColor(s.color)
                .setContentTitle(caller)
                .setContentText(kind + " · " + s.label + " — " + a.name)
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setAutoCancel(true)
                .setTimeoutAfter(60_000)
                .setContentIntent(open)
                .setFullScreenIntent(open, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Person person = new Person.Builder().setName(caller).setImportant(true).build();
            b.setStyle(Notification.CallStyle.forIncomingCall(person, decline, answer));
        } else {
            b.addAction(new Notification.Action.Builder(null, "Decline", decline).build());
            b.addAction(new Notification.Action.Builder(null, "Answer", answer).build());
        }
        c.getSystemService(NotificationManager.class).notify("call:" + a.id, id, b.build());
    }

    /** Answer/Decline couldn't press the service's button: ask to open the account. */
    static void showHandleCall(Context c, AccountStore.Account a) {
        Services.Service s = Services.get(a.service);
        Notification n = new Notification.Builder(c, CH_CALLS)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setColor(s.color)
                .setContentTitle("Tap to handle the call")
                .setContentText(s.label + " — " + a.name)
                .setCategory(Notification.CATEGORY_CALL)
                .setAutoCancel(true)
                .setTimeoutAfter(60_000)
                .setContentIntent(activity(c, a.id, 0, "open", 1))
                .build();
        c.getSystemService(NotificationManager.class).notify("handle:" + a.id, 0, n);
    }

    static Notification running(Context c) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(c, CH_RUNNING)
                .setSmallIcon(R.drawable.ic_stat_chat)
                .setContentTitle("Chat Manager is running")
                .setContentText("Keeping your chats connected for messages and calls")
                .setOngoing(true)
                .setContentIntent(open)
                .build();
    }

    private Notifier() {}
}
