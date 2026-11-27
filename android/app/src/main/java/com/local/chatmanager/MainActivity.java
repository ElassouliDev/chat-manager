package com.local.chatmanager;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.LauncherActivityInfo;
import android.content.pm.LauncherApps;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.UserHandle;
import android.os.UserManager;
import android.provider.Settings;
import android.text.InputType;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Chat Manager hub: a list of your chat accounts. Tapping one opens the real
 * app copy it points to (main, dual/clone, or work profile), already signed in.
 */
public class MainActivity extends Activity implements UnreadListener.Callback {

    private AccountStore store;
    private LauncherApps launcher;
    private UserManager users;
    private LinearLayout list;
    private View accessBanner;

    // ---------- lifecycle ----------

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new AccountStore(this);
        launcher = getSystemService(LauncherApps.class);
        users = getSystemService(UserManager.class);
        buildUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        UnreadListener.setCallback(this);
        render();
    }

    @Override
    protected void onPause() {
        super.onPause();
        UnreadListener.setCallback(null);
    }

    @Override
    public void onUnreadChanged() {
        runOnUiThread(this::render);
    }

    // ---------- app copies installed on this phone ----------

    /** One launchable copy of a chat app: a package in a user profile. */
    static final class Target {
        Services.Service service;
        LauncherActivityInfo info;
        UserHandle user;
        long serial;
        String label;
    }

    /** Every installed copy of every known chat app, across the main profile, clones and work profiles. */
    private List<Target> installedTargets() {
        List<Target> out = new ArrayList<>();
        for (UserHandle user : launcher.getProfiles()) {
            for (Services.Service s : Services.ALL.values()) {
                for (String pkg : s.packages) {
                    List<LauncherActivityInfo> acts = launcher.getActivityList(pkg, user);
                    if (acts == null || acts.isEmpty()) continue;
                    Target t = new Target();
                    t.service = s;
                    t.info = acts.get(0);
                    t.user = user;
                    t.serial = users.getSerialNumberForUser(user);
                    // "WhatsApp", "WhatsApp Business", "Work WhatsApp", "Dual WhatsApp"...
                    t.label = getPackageManager().getUserBadgedLabel(t.info.getLabel(), user).toString();
                    out.add(t);
                }
            }
        }
        return out;
    }

    private Target targetFor(AccountStore.Account a) {
        UserHandle user = users.getUserForSerialNumber(a.userSerial);
        if (user == null) return null;
        List<LauncherActivityInfo> acts;
        try {
            acts = launcher.getActivityList(a.pkg, user);
        } catch (SecurityException e) {
            return null;
        }
        if (acts == null || acts.isEmpty()) return null;
        Target t = new Target();
        t.service = Services.get(a.service);
        t.info = acts.get(0);
        t.user = user;
        t.serial = a.userSerial;
        t.label = getPackageManager().getUserBadgedLabel(t.info.getLabel(), user).toString();
        return t;
    }

    private void open(AccountStore.Account a) {
        Target t = targetFor(a);
        if (t == null) {
            Toast.makeText(this, a.name + ": the app isn't installed on this phone anymore", Toast.LENGTH_LONG).show();
            return;
        }
        ComponentName c = t.info.getComponentName();
        try {
            launcher.startMainActivity(c, t.user, null, null);
        } catch (SecurityException | IllegalStateException e) {
            // The work profile is paused, or the app copy is locked.
            Toast.makeText(this, "Couldn't open " + t.label + ". If it's in a work profile, turn the work profile on.", Toast.LENGTH_LONG).show();
        }
    }

    // ---------- screen ----------

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private int color(int res) {
        return getColor(res);
    }

    private boolean isDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(color(R.color.bg));

        // Header: title and Add button.
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(20), dp(16), dp(12), dp(8));
        TextView title = new TextView(this);
        title.setText("Chat Manager");
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(color(R.color.text));
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        Button add = new Button(this);
        add.setText("+ Add");
        add.setAllCaps(false);
        add.setTextColor(Color.WHITE);
        GradientDrawable addBg = new GradientDrawable();
        addBg.setColor(color(R.color.accent));
        addBg.setCornerRadius(dp(20));
        add.setBackground(addBg);
        add.setPadding(dp(18), 0, dp(18), 0);
        add.setOnClickListener(v -> showAddDialog());
        header.addView(add, new LinearLayout.LayoutParams(-2, dp(40)));
        root.addView(header);

        // Asks for notification access, which unread counts need.
        accessBanner = banner("Turn on unread counts",
                "Allow Chat Manager to read chat notifications to show unread counts and the latest message for each account.",
                "Turn on", v -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        root.addView(accessBanner);

        ScrollView scroll = new ScrollView(this);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(12), dp(4), dp(12), dp(24));
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        // Edge to edge: keep content clear of the status and navigation bars.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom, left, right;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets s = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = s.top; bottom = s.bottom; left = s.left; right = s.right;
            } else {
                top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft(); right = insets.getSystemWindowInsetRight();
            }
            v.setPadding(left, top, right, bottom);
            return insets;
        });
        setContentView(root);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            int light = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(isDark() ? 0 : light, light);
        }
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
    }

    private View banner(String head, String body, String action, View.OnClickListener onClick) {
        LinearLayout b = new LinearLayout(this);
        b.setOrientation(LinearLayout.VERTICAL);
        b.setPadding(dp(16), dp(14), dp(16), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color(R.color.side));
        bg.setCornerRadius(dp(14));
        b.setBackground(bg);
        TextView h = new TextView(this);
        h.setText(head);
        h.setTextSize(16);
        h.setTypeface(Typeface.DEFAULT_BOLD);
        h.setTextColor(color(R.color.text));
        b.addView(h);
        TextView t = new TextView(this);
        t.setText(body);
        t.setTextSize(14);
        t.setTextColor(color(R.color.muted));
        t.setPadding(0, dp(4), 0, dp(8));
        b.addView(t);
        Button btn = new Button(this);
        btn.setText(action);
        btn.setAllCaps(false);
        btn.setTextColor(color(R.color.accent));
        btn.setBackground(null);
        btn.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        btn.setPadding(0, 0, 0, 0);
        btn.setOnClickListener(onClick);
        b.addView(btn, new LinearLayout.LayoutParams(-2, dp(36)));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(dp(12), dp(4), dp(12), dp(8));
        b.setLayoutParams(lp);
        return b;
    }

    private boolean hasNotificationAccess() {
        // Newer Android hides the secure setting from apps, so ask the notification service.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            return getSystemService(android.app.NotificationManager.class)
                    .isNotificationListenerAccessGranted(new ComponentName(this, UnreadListener.class));
        }
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(getPackageName());
    }

    private void render() {
        accessBanner.setVisibility(hasNotificationAccess() ? View.GONE : View.VISIBLE);
        list.removeAllViews();
        if (store.accounts.isEmpty()) {
            list.addView(emptyState());
            return;
        }
        for (AccountStore.Account a : store.accounts) list.addView(row(a));
    }

    private View emptyState() {
        TextView t = new TextView(this);
        t.setText("No accounts yet.\n\nTap \"+ Add\" to add WhatsApp, Telegram and your other chat apps. "
                + "Each account opens the real app, already signed in — nothing to log in to here.\n\n"
                + "More than one WhatsApp? Use WhatsApp's own \"Add account\" (Settings → arrow next to your name), "
                + "WhatsApp Business, your phone's Dual Apps / Dual Messenger, or a work profile. Each copy shows up here to add.");
        t.setTextSize(15);
        t.setTextColor(color(R.color.muted));
        t.setPadding(dp(12), dp(24), dp(12), dp(12));
        t.setLineSpacing(0, 1.15f);
        return t;
    }

    private static String initials(String name) {
        String[] parts = name.trim().split("\\s+");
        if (parts.length == 0 || parts[0].isEmpty()) return "?";
        String s = parts[0].substring(0, 1) + (parts.length > 1 ? parts[1].substring(0, 1) : "");
        return s.toUpperCase();
    }

    private View row(AccountStore.Account a) {
        Services.Service s = Services.get(a.service);
        Target t = targetFor(a);
        UnreadListener.Unread u = UnreadListener.get(a.key());

        LinearLayout r = new LinearLayout(this);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(dp(12), dp(12), dp(16), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color(R.color.side));
        bg.setCornerRadius(dp(16));
        r.setBackground(bg);
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(-1, -2);
        rlp.setMargins(0, dp(4), 0, dp(4));
        r.setLayoutParams(rlp);
        if (t == null) r.setAlpha(0.5f);

        // Avatar: account colour with initials, and the app's own icon (with its clone/work badge).
        FrameLayout avatar = new FrameLayout(this);
        TextView circle = new TextView(this);
        circle.setText(initials(a.name));
        circle.setTextColor(Color.WHITE);
        circle.setTextSize(17);
        circle.setTypeface(Typeface.DEFAULT_BOLD);
        circle.setGravity(Gravity.CENTER);
        GradientDrawable oval = new GradientDrawable();
        oval.setShape(GradientDrawable.OVAL);
        oval.setColor(s.color);
        circle.setBackground(oval);
        avatar.addView(circle, new FrameLayout.LayoutParams(dp(48), dp(48)));
        if (t != null) {
            ImageView icon = new ImageView(this);
            Drawable d = t.info.getBadgedIcon(0);
            icon.setImageDrawable(d);
            FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.END | Gravity.BOTTOM);
            ilp.setMargins(0, 0, -dp(4), -dp(4));
            avatar.addView(icon, ilp);
        }
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(dp(52), dp(52));
        r.addView(avatar, alp);

        // Name and the app copy (or the latest message).
        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(14), 0, dp(8), 0);
        TextView name = new TextView(this);
        name.setText(a.name);
        name.setTextSize(16);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setTextColor(color(R.color.text));
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(name);
        TextView sub = new TextView(this);
        String where = t != null ? t.label : s.label + " · not installed";
        sub.setText(u != null && !u.latest.isEmpty() ? u.latest : where);
        sub.setTextSize(14);
        sub.setTextColor(color(R.color.muted));
        sub.setSingleLine(true);
        sub.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(sub);
        r.addView(text, new LinearLayout.LayoutParams(0, -2, 1f));

        // Unread count.
        if (u != null && u.count > 0) {
            TextView badge = new TextView(this);
            badge.setText(u.count > 99 ? "99+" : String.valueOf(u.count));
            badge.setTextColor(Color.WHITE);
            badge.setTextSize(12);
            badge.setTypeface(Typeface.DEFAULT_BOLD);
            badge.setGravity(Gravity.CENTER);
            badge.setMinWidth(dp(24));
            badge.setPadding(dp(7), 0, dp(7), 0);
            GradientDrawable pill = new GradientDrawable();
            pill.setColor(color(R.color.accent));
            pill.setCornerRadius(dp(12));
            badge.setBackground(pill);
            r.addView(badge, new LinearLayout.LayoutParams(-2, dp(24)));
        }

        r.setOnClickListener(v -> open(a));
        r.setOnLongClickListener(v -> {
            showMenu(v, a);
            return true;
        });
        r.setContentDescription(a.name + ", " + where + (u != null && u.count > 0 ? ", " + u.count + " unread" : ""));
        return r;
    }

    // ---------- account actions ----------

    private void showMenu(View anchor, AccountStore.Account a) {
        PopupMenu m = new PopupMenu(this, anchor, Gravity.END);
        int i = store.accounts.indexOf(a);
        m.getMenu().add(0, 1, 0, "Rename");
        if (i > 0) m.getMenu().add(0, 2, 1, "Move up");
        if (i < store.accounts.size() - 1) m.getMenu().add(0, 3, 2, "Move down");
        m.getMenu().add(0, 4, 3, "Remove");
        m.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1:
                    askName("Rename account", a.name, "Save", n -> {
                        a.name = n;
                        store.save();
                        render();
                    });
                    break;
                case 2:
                    store.move(a, -1);
                    render();
                    break;
                case 3:
                    store.move(a, 1);
                    render();
                    break;
                case 4:
                    new AlertDialog.Builder(this)
                            .setTitle("Remove \"" + a.name + "\"?")
                            .setMessage("This only removes it from Chat Manager. The app and its chats are not affected.")
                            .setPositiveButton("Remove", (d, w) -> {
                                store.remove(a);
                                render();
                            })
                            .setNegativeButton("Cancel", null)
                            .show();
                    break;
            }
            return true;
        });
        m.show();
    }

    private void showAddDialog() {
        List<Target> targets = installedTargets();
        if (targets.isEmpty()) {
            new AlertDialog.Builder(this)
                    .setTitle("No chat apps found")
                    .setMessage("Install WhatsApp, Telegram or another chat app first, then add it here.")
                    .setPositiveButton("OK", null)
                    .show();
            return;
        }
        String[] labels = new String[targets.size()];
        for (int i = 0; i < targets.size(); i++) {
            Target t = targets.get(i);
            labels[i] = t.label + (store.has(t.info.getComponentName().getPackageName(), t.serial) ? "  (already added)" : "");
        }
        new AlertDialog.Builder(this)
                .setTitle("Which app?")
                .setItems(labels, (d, which) -> {
                    Target t = targets.get(which);
                    String pkg = t.info.getComponentName().getPackageName();
                    askName("Name this account", t.label, "Add", n -> {
                        store.add(t.service.id, pkg, t.serial, n);
                        render();
                    });
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    interface NameCallback {
        void onName(String name);
    }

    /** Name dialog; Enter on the keyboard confirms. */
    private void askName(String title, String value, String ok, NameCallback cb) {
        EditText input = new EditText(this);
        input.setText(value);
        input.setSelectAllOnFocus(true);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        FrameLayout box = new FrameLayout(this);
        box.setPadding(dp(20), dp(8), dp(20), 0);
        box.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(title)
                .setView(box)
                .setPositiveButton(ok, (d, w) -> {
                    String n = input.getText().toString().trim();
                    cb.onName(n.isEmpty() ? value : n);
                })
                .setNegativeButton("Cancel", null)
                .create();
        input.setOnEditorActionListener((v, action, event) -> {
            boolean enterKey = event != null && event.getKeyCode() == android.view.KeyEvent.KEYCODE_ENTER
                    && event.getAction() == android.view.KeyEvent.ACTION_DOWN;
            if (action == EditorInfo.IME_ACTION_DONE || enterKey) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
                return true;
            }
            return false;
        });
        dialog.setOnShowListener(d -> input.requestFocus());
        dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        dialog.show();
    }
}
