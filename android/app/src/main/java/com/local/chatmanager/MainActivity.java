package com.local.chatmanager;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.text.InputType;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.Profile;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.local.chatmanager.AccountStore.Account;
import com.local.chatmanager.Services.Service;

/**
 * The whole app: a bar of account icons at the top and, below it, one web page
 * per account. Each account has its own WebView profile, so logins never mix.
 */
public class MainActivity extends Activity {

    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    static MainActivity current() {
        return current.get();
    }

    private static final int REQ_FILES = 10;
    private static final int REQ_MEDIA = 11;
    private static final int REQ_NOTIFY = 12;

    private static final long HOUR = 60L * 60 * 1000;

    private AccountStore store;
    private LinearLayout bar;
    private FrameLayout stage;
    private TextView emptyHint;
    private final Map<String, WebView> views = new HashMap<>();
    private final Map<String, int[]> unread = new HashMap<>(); // {from title, from badge}
    private final Map<String, Integer> reloads = new HashMap<>();
    private String activeId;
    private boolean visible;
    private boolean profiles;
    private String bridgeJs;
    private String mobileUa;
    private String desktopUa;
    private ValueCallback<Uri[]> pendingFiles;
    private PermissionRequest pendingMedia;

    // ---------- lifecycle ----------

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);
        store = new AccountStore(this);
        Notifier.createChannels(this);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        profiles = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
        bridgeJs = readAsset("bridge.js");

        // Present the phone's real Chrome version; drop the "wv" marker that some
        // sign-in pages use to refuse embedded browsers.
        String def = WebSettings.getDefaultUserAgent(this);
        mobileUa = def.replace("; wv", "").replaceAll(" Version/[\\d.]+", "");
        Matcher m = Pattern.compile("Chrome/([\\d.]+)").matcher(def);
        String chrome = m.find() ? m.group(1) : "140.0.0.0";
        desktopUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                + chrome + " Safari/537.36";

        buildUi();
        seedForTesting(getIntent());
        for (Account a : store.accounts) createView(a);
        if (!store.accounts.isEmpty()) activate(store.accounts.get(0).id);
        renderBar();

        askNotificationPermission();
        startForegroundService(new Intent(this, KeepAliveService.class));
        handleIntent(getIntent());

        if (!profiles) {
            Toast.makeText(this, "Update \"Android System WebView\" from the Play Store to keep accounts fully separate.",
                    Toast.LENGTH_LONG).show();
        }
        if (store.accounts.isEmpty()) bar.post(this::showAddDialog);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        renderBar(); // timed mutes may have ended
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false; // the pages keep running in the background
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        for (WebView wv : views.values()) wv.destroy();
        views.clear();
        // With the pages gone nothing is left to keep running.
        stopService(new Intent(this, KeepAliveService.class));
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        WebView wv = views.get(activeId);
        if (wv != null && wv.canGoBack()) {
            wv.goBack();
        } else {
            // Keep the chats running instead of closing the app.
            moveTaskToBack(true);
        }
    }

    /** Opened from a notification: switch to the account, then open the chat or answer the call. */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String account = intent.getStringExtra(Notifier.EXTRA_ACCOUNT);
        if (account == null || store.find(account) == null) return;
        int id = intent.getIntExtra(Notifier.EXTRA_NOTIFICATION, 0);
        String action = intent.getStringExtra(Notifier.EXTRA_ACTION);
        activate(account);
        WebView wv = views.get(account);
        if ("answer".equals(action)) {
            Notifier.cancelCall(this, account, id);
            callAction(account, "answer");
        } else if (wv != null && id > 0) {
            Notifier.cancel(this, account, id);
            wv.evaluateJavascript("window.__chatMgrClick && window.__chatMgrClick(" + id + ")", null);
        }
        intent.removeExtra(Notifier.EXTRA_ACCOUNT);
    }

    /** Answer or Decline: press the service's own button in that account's page. */
    void callAction(String accountId, String action) {
        WebView wv = views.get(accountId);
        if (wv == null) return;
        if ("answer".equals(action)) activate(accountId);
        wv.evaluateJavascript("window.__chatMgrCallAction && window.__chatMgrCallAction('" + action + "')", null);
    }

    // ---------- layout ----------

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private int color(int res) {
        return getColor(res);
    }

    private boolean isDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @SuppressWarnings("deprecation")
    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(color(R.color.side));

        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(6), dp(6), dp(6), dp(6));
        scroll.addView(bar);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        stage = new FrameLayout(this);
        stage.setBackgroundColor(color(R.color.bg));
        emptyHint = new TextView(this);
        emptyHint.setText("Tap + to add your first account");
        emptyHint.setTextColor(color(R.color.muted));
        emptyHint.setTextSize(16);
        emptyHint.setGravity(Gravity.CENTER);
        stage.addView(emptyHint, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(stage, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);

        // Draw edge to edge and pad for the status bar, navigation bar and keyboard.
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        boolean light = !isDark();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (light) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets s = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(s.left, s.top, s.right, s.bottom);
                return WindowInsets.CONSUMED;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
    }

    private static String initials(String name) {
        String[] parts = name.trim().split("\\s+");
        if (parts.length == 0 || parts[0].isEmpty()) return "?";
        String s = parts[0].substring(0, 1);
        if (parts.length > 1) s += parts[1].substring(0, 1);
        return s.toUpperCase();
    }

    private int unreadOf(String id) {
        int[] u = unread.get(id);
        if (u == null) return 0;
        int best = Math.max(0, Math.max(u[0], u[1]));
        if (best > 0) return best;
        return (u[0] == -1 || u[1] == -1) ? -1 : 0;
    }

    private GradientDrawable circle(int fill) {
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(fill);
        return d;
    }

    /** The account icons along the top, then "+". */
    private void renderBar() {
        if (bar == null) return;
        bar.removeAllViews();
        for (Account a : store.accounts) bar.addView(accountIcon(a));

        TextView add = new TextView(this);
        add.setText("+");
        add.setTextSize(24);
        add.setGravity(Gravity.CENTER);
        add.setTextColor(color(R.color.muted));
        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        ring.setStroke(dp(1.5f), color(R.color.muted), dp(4), dp(3));
        add.setBackground(ring);
        add.setContentDescription("Add account");
        add.setOnClickListener(v -> showAddDialog());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(44), dp(44));
        lp.setMargins(dp(6), dp(6), dp(6), dp(6));
        bar.addView(add, lp);

        emptyHint.setVisibility(store.accounts.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private View accountIcon(Account a) {
        Service s = Services.get(a.service);
        boolean active = a.id.equals(activeId);
        boolean muted = a.isMuted();

        FrameLayout box = new FrameLayout(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(56), dp(56));
        box.setLayoutParams(lp);

        TextView face = new TextView(this);
        face.setText(initials(a.name));
        face.setTextColor(Color.WHITE);
        face.setTextSize(16);
        face.setGravity(Gravity.CENTER);
        face.setTypeface(face.getTypeface(), android.graphics.Typeface.BOLD);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(a.color);
        if (active) bg.setCornerRadius(dp(14));
        else bg.setShape(GradientDrawable.OVAL);
        face.setBackground(bg);
        face.setAlpha(active ? 1f : 0.6f);
        box.addView(face, new FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER));

        // Which service it is: a small coloured dot with its first letter.
        TextView kind = new TextView(this);
        kind.setText(s.label.substring(0, 1));
        kind.setTextColor(Color.WHITE);
        kind.setTextSize(9);
        kind.setGravity(Gravity.CENTER);
        kind.setTypeface(kind.getTypeface(), android.graphics.Typeface.BOLD);
        GradientDrawable kd = circle(s.color);
        kd.setStroke(dp(2), color(R.color.side));
        kind.setBackground(kd);
        box.addView(kind, new FrameLayout.LayoutParams(dp(18), dp(18), Gravity.BOTTOM | Gravity.END));

        if (muted) {
            TextView mm = new TextView(this);
            mm.setText("🔕");
            mm.setTextSize(8);
            mm.setGravity(Gravity.CENTER);
            GradientDrawable md = circle(color(R.color.chip));
            md.setStroke(dp(2), color(R.color.side));
            mm.setBackground(md);
            box.addView(mm, new FrameLayout.LayoutParams(dp(18), dp(18), Gravity.BOTTOM | Gravity.START));
        }

        int n = unreadOf(a.id);
        if (n != 0) {
            TextView badge = new TextView(this);
            badge.setText(n > 0 ? (n > 99 ? "99+" : String.valueOf(n)) : "");
            badge.setTextColor(Color.WHITE);
            badge.setTextSize(10);
            badge.setGravity(Gravity.CENTER);
            badge.setTypeface(badge.getTypeface(), android.graphics.Typeface.BOLD);
            badge.setPadding(dp(4), 0, dp(4), 0);
            GradientDrawable bd = new GradientDrawable();
            bd.setCornerRadius(dp(10));
            bd.setColor(muted ? color(R.color.muted) : color(R.color.accent));
            bd.setStroke(dp(2), color(R.color.side));
            badge.setBackground(bd);
            int size = n > 0 ? dp(20) : dp(14);
            FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(n > 0 ? ViewGroup.LayoutParams.WRAP_CONTENT : size, size, Gravity.TOP | Gravity.END);
            badge.setMinWidth(size);
            box.addView(badge, blp);
        }

        String desc = a.name + ", " + s.label + (n > 0 ? ", " + n + " unread" : "") + (muted ? ", muted" : "");
        box.setContentDescription(desc);
        box.setOnClickListener(v -> activate(a.id));
        box.setOnLongClickListener(v -> {
            showAccountMenu(v, a);
            return true;
        });
        return box;
    }

    private void activate(String id) {
        if (!views.containsKey(id)) return;
        activeId = id;
        for (Map.Entry<String, WebView> e : views.entrySet()) {
            e.getValue().setVisibility(e.getKey().equals(id) ? View.VISIBLE : View.INVISIBLE);
        }
        WebView wv = views.get(id);
        if (wv != null) wv.requestFocus();
        renderBar();
    }

    // ---------- pages ----------

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            return "";
        }
    }

    private void configure(WebView wv, Service s) {
        WebSettings st = wv.getSettings();
        st.setJavaScriptEnabled(true);
        st.setDomStorageEnabled(true);
        st.setMediaPlaybackRequiresUserGesture(false);
        st.setSupportMultipleWindows(true);
        st.setJavaScriptCanOpenWindowsAutomatically(true);
        st.setUseWideViewPort(true);
        st.setLoadWithOverviewMode(true);
        st.setBuiltInZoomControls(true);
        st.setDisplayZoomControls(false);
        st.setAllowFileAccess(false);
        st.setUserAgentString(s.desktop ? desktopUa : mobileUa);
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);
    }

    private WebView newWebView(Account a) {
        WebView wv = new WebView(this);
        if (profiles) {
            ProfileStore.getInstance().getOrCreateProfile(a.profile());
            WebViewCompat.setProfile(wv, a.profile()); // must come before anything else touches the WebView
        }
        configure(wv, Services.get(a.service));
        return wv;
    }

    private void createView(Account a) {
        Service s = Services.get(a.service);
        WebView wv = newWebView(a);
        final String id = a.id;
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(wv, "ChatManagerBridge", Collections.singleton("*"),
                    (view, message, sourceOrigin, isMainFrame, reply) -> onBridge(id, message.getData()));
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(wv, bridgeJs, Collections.singleton("*"));
        }
        wv.setWebViewClient(new PageClient(id));
        wv.setWebChromeClient(new PageChrome(id));
        wv.setDownloadListener((url, ua, disposition, mime, length) -> {
            if (url.startsWith("http")) openExternal(Uri.parse(url));
        });
        wv.setVisibility(View.INVISIBLE);
        stage.addView(wv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        views.put(id, wv);
        wv.loadUrl(s.url);
    }

    private void openExternal(Uri url) {
        try {
            Intent i;
            if ("intent".equals(url.getScheme())) {
                i = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } else {
                i = new Intent(Intent.ACTION_VIEW, url);
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (URISyntaxException | ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    /** Messages from bridge.js in an account's page. */
    private void onBridge(String accountId, String data) {
        Account a = store.find(accountId);
        if (a == null || data == null) return;
        JSONObject msg;
        try {
            msg = new JSONObject(data);
        } catch (JSONException e) {
            return;
        }
        int id = msg.optInt("id");
        String title = msg.optString("title");
        String body = msg.optString("body");
        switch (msg.optString("type")) {
            case "notify":
                // Muted accounts stay quiet; skip the one you're looking at right now.
                if (a.isMuted() || (visible && accountId.equals(activeId))) return;
                Notifier.showMessage(this, a, id, title, body);
                break;
            case "notify-close":
                Notifier.cancel(this, accountId, id);
                break;
            case "call":
                Notifier.showCall(this, a, id, title, body); // calls ring even when muted
                break;
            case "call-ended":
                Notifier.cancelCall(this, accountId, id);
                break;
            case "badge":
                setUnread(accountId, 1, Math.max(0, msg.optInt("count")));
                break;
            case "call-action-result":
                if (!msg.optBoolean("pressed")) {
                    // The service's own button wasn't found: show the call so you can handle it.
                    // Android doesn't let a background app open itself, so ask with a notification then.
                    if (visible) activate(accountId);
                    else Notifier.showHandleCall(this, a);
                }
                break;
            default:
                break;
        }
    }

    private void setUnread(String id, int source, int n) {
        int[] u = unread.get(id);
        if (u == null) unread.put(id, u = new int[2]);
        if (u[source] == n) return;
        u[source] = n;
        renderBar();
    }

    private final class PageClient extends WebViewClient {
        private final String accountId;

        PageClient(String accountId) {
            this.accountId = accountId;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme();
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                openExternal(url); // mailto:, tel:, intent:, app links
                return true;
            }
            if (!request.isForMainFrame()) return false;
            Account a = store.find(accountId);
            if (a == null || Services.staysInApp(Services.get(a.service), url)) return false;
            openExternal(url);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            Account a = store.find(accountId);
            if (a == null || url == null) return;
            Service s = Services.get(a.service);
            if (s.signInWhen != null && s.signInWhen.matcher(url).find()) view.loadUrl(s.signInUrl);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // A page crashed: rebuild that account's page instead of closing the app.
            Account a = store.find(accountId);
            stage.removeView(view);
            views.remove(accountId);
            view.destroy();
            if (a != null) {
                createView(a);
                if (accountId.equals(activeId)) activate(accountId);
            }
            return true;
        }
    }

    private class PageChrome extends WebChromeClient {
        final String accountId;

        PageChrome(String accountId) {
            this.accountId = accountId;
        }

        @Override
        public void onReceivedTitle(WebView view, String title) {
            Account a = store.find(accountId);
            if (a != null) setUnread(accountId, 0, Services.get(a.service).unreadFromTitle(title));
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> handleMediaRequest(request));
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_FILES);
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                return false;
            }
            return true;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            openPopup(accountId, resultMsg);
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Account a = store.find(accountId);
            if (a == null) return false;
            Service s = Services.get(a.service);
            if (s.reloadOn != null && s.reloadOn.matcher(message.message()).find()) {
                int n = reloads.containsKey(accountId) ? reloads.get(accountId) : 0;
                WebView wv = views.get(accountId);
                if (n < 3 && wv != null) {
                    reloads.put(accountId, n + 1);
                    wv.postDelayed(wv::reload, 1500);
                }
            }
            return false;
        }
    }

    // ---------- microphone, camera, files ----------

    private void handleMediaRequest(PermissionRequest request) {
        List<String> needed = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO);
                needed.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.CAMERA);
            }
        }
        if (needed.isEmpty()) {
            grantAllowed(request);
        } else {
            if (pendingMedia != null) pendingMedia.deny();
            pendingMedia = request;
            requestPermissions(needed.toArray(new String[0]), REQ_MEDIA);
        }
    }

    /** Grant what the app has permission for: microphone, camera, and protected media. */
    private void grantAllowed(PermissionRequest request) {
        List<String> grant = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grant.add(r);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                    && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grant.add(r);
            if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(r)) grant.add(r);
        }
        if (grant.isEmpty()) request.deny();
        else request.grant(grant.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_MEDIA && pendingMedia != null) {
            grantAllowed(pendingMedia);
            pendingMedia = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILES && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingFiles = null;
        }
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
        }
    }

    // ---------- popups (sign-in, call windows) ----------

    /**
     * window.open() from a page. Sign-in pages and the service's own windows
     * (calls, pop-outs) open full screen inside the app, in the same account;
     * anything else goes to the browser.
     */
    private void openPopup(String accountId, Message resultMsg) {
        Account a = store.find(accountId);
        if (a == null) return;
        Service s = Services.get(a.service);
        WebView child = newWebView(a);
        Dialog dialog = new Dialog(this, Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? android.R.style.Theme_DeviceDefault_DayNight
                : (isDark() ? android.R.style.Theme_DeviceDefault : android.R.style.Theme_DeviceDefault_Light));
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(color(R.color.side));
        TextView close = new TextView(this);
        close.setText("✕  Close");
        close.setTextColor(color(R.color.text));
        close.setTextSize(16);
        close.setPadding(dp(16), dp(14), dp(16), dp(14));
        close.setOnClickListener(v -> dialog.dismiss());
        box.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        box.addView(child, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        dialog.setContentView(box);
        dialog.setOnDismissListener(d -> child.destroy());

        final boolean[] decided = {false};
        child.setWebViewClient(new WebViewClient() {
            private boolean allowed(Uri url) {
                return "about".equals(url.getScheme()) || s.sso
                        || Services.onHost(url, Services.SIGN_IN_HOSTS) || Services.onHost(url, s.hosts);
            }

            private boolean decide(Uri url) {
                if (decided[0]) return true;
                decided[0] = true;
                if (allowed(url)) {
                    dialog.show();
                    return true;
                }
                openExternal(url);
                dialog.dismiss();
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                if (!"http".equals(scheme) && !"https".equals(scheme) && !"about".equals(scheme)) {
                    openExternal(url);
                    return true;
                }
                return !decide(url);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (url != null && !decide(Uri.parse(url))) view.stopLoading();
            }
        });
        child.setWebChromeClient(new PageChrome(accountId) {
            @Override
            public void onReceivedTitle(WebView view, String title) {
                close.setText(TextUtils.isEmpty(title) ? "✕  Close" : "✕  " + title);
            }

            @Override
            public void onCloseWindow(WebView window) {
                dialog.dismiss();
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message msg) {
                return false;
            }
        });

        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
        transport.setWebView(child);
        resultMsg.sendToTarget();
    }

    // ---------- adding and managing accounts ----------

    private void showAddDialog() {
        List<Service> list = new ArrayList<>(Services.ALL.values());
        String[] names = new String[list.size()];
        for (int i = 0; i < list.size(); i++) names[i] = list.get(i).label;
        new AlertDialog.Builder(this)
                .setTitle("Add account")
                .setItems(names, (d, which) -> askName(list.get(which)))
                .setNegativeButton("Cancel", null)
                .show();
    }

    /** A text box where Enter (or Done on the keyboard) confirms. */
    private void askText(String title, String message, String value, String ok, ValueCallback<String> done) {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        input.setText(value);
        input.selectAll();
        FrameLayout pad = new FrameLayout(this);
        pad.setPadding(dp(20), dp(8), dp(20), 0);
        pad.addView(input);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setView(pad)
                .setPositiveButton(ok, (d, w) -> {
                    String text = input.getText().toString().trim();
                    done.onReceiveValue(text.isEmpty() ? value : text);
                })
                .setNegativeButton("Cancel", null)
                .create();
        input.setOnEditorActionListener((v, actionId, event) -> {
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN;
            if (actionId == EditorInfo.IME_ACTION_DONE || enter) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
                return true;
            }
            return false;
        });
        dialog.setOnShowListener(d -> {
            input.requestFocus();
            if (dialog.getWindow() != null) dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        });
        dialog.show();
    }

    private void askName(Service s) {
        askText("Add " + s.label, s.hint, "Account " + (store.accounts.size() + 1), "Add", name -> {
            Account a = store.add(s.id, name);
            createView(a);
            activate(a.id);
        });
    }

    private void showAccountMenu(View anchor, Account a) {
        int index = store.accounts.indexOf(a);
        int last = store.accounts.size() - 1;
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, "Rename");
        if (a.isMuted()) {
            menu.getMenu().add(0, 2, 1, "Unmute notifications");
        } else {
            menu.getMenu().add(0, 3, 1, "Mute for 1 hour");
            menu.getMenu().add(0, 4, 2, "Mute for 8 hours");
            menu.getMenu().add(0, 5, 3, "Mute for 1 day");
            menu.getMenu().add(0, 6, 4, "Mute until I unmute");
        }
        if (index > 0) {
            menu.getMenu().add(0, 7, 5, "Move left");
            menu.getMenu().add(0, 8, 6, "Move to start");
        }
        if (index < last) {
            menu.getMenu().add(0, 9, 7, "Move right");
            menu.getMenu().add(0, 10, 8, "Move to end");
        }
        menu.getMenu().add(0, 11, 9, "Reload");
        menu.getMenu().add(0, 12, 10, "Remove & log out");
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1:
                    askText("Rename account", null, a.name, "Save", name -> {
                        a.name = name;
                        store.save();
                        renderBar();
                    });
                    break;
                case 2: setMute(a, 0); break;
                case 3: setMute(a, System.currentTimeMillis() + HOUR); break;
                case 4: setMute(a, System.currentTimeMillis() + 8 * HOUR); break;
                case 5: setMute(a, System.currentTimeMillis() + 24 * HOUR); break;
                case 6: setMute(a, AccountStore.MUTE_FOREVER); break;
                case 7: move(a, index - 1); break;
                case 8: move(a, 0); break;
                case 9: move(a, index + 1); break;
                case 10: move(a, last); break;
                case 11: {
                    WebView wv = views.get(a.id);
                    if (wv != null) wv.reload();
                    break;
                }
                case 12: confirmRemove(a); break;
                default: return false;
            }
            return true;
        });
        menu.show();
    }

    private void setMute(Account a, long until) {
        a.mutedUntil = until;
        store.save();
        renderBar();
    }

    private void move(Account a, int to) {
        store.move(a.id, to);
        renderBar();
    }

    private void confirmRemove(Account a) {
        Service s = Services.get(a.service);
        new AlertDialog.Builder(this)
                .setTitle("Remove \"" + a.name + "\"?")
                .setMessage("This logs this " + s.label + " account out of Chat Manager and deletes its data on this phone. " + s.keeps)
                .setPositiveButton("Remove", (d, w) -> removeAccount(a))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void removeAccount(Account a) {
        WebView wv = views.remove(a.id);
        if (wv != null) {
            stage.removeView(wv);
            wv.destroy();
        }
        unread.remove(a.id);
        store.remove(a.id);
        if (profiles) {
            String name = a.profile();
            Profile p = ProfileStore.getInstance().getProfile(name);
            if (p != null) {
                p.getCookieManager().removeAllCookies(null);
                p.getWebStorage().deleteAllData();
            }
            // The profile can only be deleted once no page uses it any more.
            stage.postDelayed(() -> {
                try {
                    ProfileStore.getInstance().deleteProfile(name);
                } catch (RuntimeException ignored) {
                    // Still in use: its data is already cleared, and it is removed on next start.
                }
            }, 1000);
        }
        if (a.id.equals(activeId)) {
            activeId = null;
            if (!store.accounts.isEmpty()) activate(store.accounts.get(0).id);
        }
        renderBar();
    }

    /** Debug builds only: pre-add accounts from the "seed" extra, for testing on an emulator. */
    private void seedForTesting(Intent intent) {
        if (!BuildConfig.DEBUG || intent == null || !store.accounts.isEmpty()) return;
        String seed = intent.getStringExtra("seed");
        if (seed == null) return;
        for (String id : seed.split(",")) {
            if (Services.ALL.containsKey(id.trim())) store.add(id.trim(), Services.get(id.trim()).label + " Test");
        }
    }
}
