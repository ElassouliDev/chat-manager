package com.local.chatmanager;

import android.graphics.Color;
import android.net.Uri;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Every service Chat Manager can host. Mirrors src/services.js in the desktop app.
 *
 * desktop  load the desktop site: these services only show "get our app" on a phone
 * hosts    sites the account may move between inside the app
 * sso      sign-in may go through a company's own login page, so any site is allowed
 */
final class Services {

    static final class Service {
        final String id;
        final String label;
        final String url;
        final int color;
        final boolean desktop;
        final String[] hosts;
        final boolean sso;
        final Pattern titleCount;
        final Pattern titleDot;
        final String hint;
        final String keeps;
        // Signed-out page that should go straight to sign-in (Google Chat).
        Pattern signInWhen;
        String signInUrl;
        // Console message meaning the page is stuck and needs a reload (Teams).
        Pattern reloadOn;

        Service(String id, String label, String url, String color, boolean desktop, String[] hosts, boolean sso,
                String titleCount, String titleDot, String hint, String keeps) {
            this.id = id;
            this.label = label;
            this.url = url;
            this.color = Color.parseColor(color);
            this.desktop = desktop;
            this.hosts = hosts;
            this.sso = sso;
            this.titleCount = Pattern.compile(titleCount != null ? titleCount : "^\\((\\d+)\\)");
            this.titleDot = titleDot != null ? Pattern.compile(titleDot) : null;
            this.hint = hint;
            this.keeps = keeps;
        }

        /** Unread count from the page title: a number, -1 for "unread without a count", or 0. */
        int unreadFromTitle(String title) {
            if (title == null) return 0;
            Matcher m = titleCount.matcher(title);
            if (m.find()) {
                try {
                    return Integer.parseInt(m.group(1));
                } catch (NumberFormatException e) {
                    return 0;
                }
            }
            return titleDot != null && titleDot.matcher(title).find() ? -1 : 0;
        }
    }

    // Sign-in pages any service may use ("Continue with Google / Apple / Microsoft").
    static final String[] SIGN_IN_HOSTS = {
            "accounts.google.com", "appleid.apple.com",
            "login.microsoftonline.com", "login.microsoft.com", "login.live.com", "account.live.com",
    };

    static final Map<String, Service> ALL = new LinkedHashMap<>();

    private static void add(Service s) {
        ALL.put(s.id, s);
    }

    static {
        add(new Service("whatsapp", "WhatsApp", "https://web.whatsapp.com/", "#25D366", true,
                new String[]{"web.whatsapp.com"}, false, null, null,
                "On the phone with that WhatsApp account: Settings → Linked devices → Link a device → \"Link with phone number instead\", then enter the code shown here.",
                "Your chats stay on your phone."));
        add(new Service("telegram", "Telegram", "https://web.telegram.org/a/", "#2AABEE", false,
                new String[]{"web.telegram.org"}, false, null, null,
                "Log in with your phone number, or scan the QR code from another device (Settings → Devices → Add Device).",
                "Your chats stay in your Telegram account."));
        Service teams = new Service("teams", "Teams", "https://teams.microsoft.com/v2/", "#5B5FC7", true,
                new String[]{"teams.microsoft.com", "teams.cloud.microsoft", "teams.live.com"}, true, null, null,
                "Sign in with your Microsoft work, school, or personal account.",
                "Your chats stay in your Microsoft account.");
        teams.reloadOn = Pattern.compile("Pre-loader startup failed");
        add(teams);
        add(new Service("slack", "Slack", "https://app.slack.com/client", "#611F69", true,
                new String[]{"slack.com"}, true, null, "^[*!]\\s",
                "Sign in to your Slack workspace (email, Google, Apple, or your company sign-in).",
                "Your messages stay in your Slack workspace."));
        add(new Service("messenger", "Messenger", "https://www.messenger.com/", "#0084FF", true,
                new String[]{"messenger.com", "facebook.com"}, false, null, null,
                "Log in with your Facebook account.", "Your chats stay in your Facebook account."));
        add(new Service("facebook", "Facebook", "https://www.facebook.com/", "#1877F2", false,
                new String[]{"facebook.com", "fb.com"}, false, null, null,
                "Log in with your Facebook account.", "Your account is not affected."));
        add(new Service("instagram", "Instagram", "https://www.instagram.com/direct/inbox/", "#E1306C", false,
                new String[]{"instagram.com", "facebook.com"}, false, null, null,
                "Log in with your Instagram account (or with Facebook).", "Your account is not affected."));
        add(new Service("linkedin", "LinkedIn", "https://www.linkedin.com/feed/", "#0A66C2", false,
                new String[]{"linkedin.com"}, false, null, null,
                "Sign in with your LinkedIn account.", "Your account is not affected."));
        add(new Service("x", "X", "https://x.com/home", "#000000", false,
                new String[]{"x.com", "twitter.com"}, false, null, null,
                "Sign in with your X account.", "Your account is not affected."));
        add(new Service("discord", "Discord", "https://discord.com/app", "#5865F2", true,
                new String[]{"discord.com"}, false, null, "^•\\s?",
                "Log in with your Discord account.", "Your messages stay in your Discord account."));
        add(new Service("gmail", "Gmail", "https://mail.google.com/mail/u/0/#inbox", "#EA4335", false,
                new String[]{"mail.google.com"}, true, "\\((\\d+)\\)", null,
                "Sign in with your Google account (Gmail or Google Workspace).",
                "Your email stays in your Google account."));
        Service chat = new Service("googlechat", "Google Chat", "https://chat.google.com/", "#00AC47", true,
                new String[]{"chat.google.com"}, true, "\\((\\d+)\\)", null,
                "Sign in with your Google account (Gmail or Google Workspace).",
                "Your chats stay in your Google account.");
        chat.signInWhen = Pattern.compile("^https://workspace\\.google\\.com/(intl/[^/]+/)?products/chat");
        chat.signInUrl = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fchat.google.com%2F&followup=https%3A%2F%2Fchat.google.com%2F";
        add(chat);
        add(new Service("outlook", "Outlook", "https://outlook.office.com/mail/", "#0078D4", false,
                new String[]{"outlook.office.com", "outlook.office365.com", "outlook.live.com"}, true, "\\((\\d+)\\)", null,
                "Sign in with your Microsoft work, school, or personal account (Outlook.com, Hotmail, Live).",
                "Your email stays in your Microsoft account."));
    }

    static Service get(String id) {
        Service s = ALL.get(id);
        return s != null ? s : ALL.get("whatsapp");
    }

    static boolean onHost(Uri url, String[] hosts) {
        String host = url.getHost();
        if (host == null) return false;
        for (String h : hosts) {
            if (host.equals(h) || host.endsWith("." + h)) return true;
        }
        return false;
    }

    /** Whether a page may open inside the account (otherwise it goes to the browser). */
    static boolean staysInApp(Service s, Uri url) {
        return s.sso || onHost(url, s.hosts) || onHost(url, SIGN_IN_HOSTS);
    }

    private Services() {}
}
