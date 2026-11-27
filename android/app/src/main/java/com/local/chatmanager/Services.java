package com.local.chatmanager;

import android.graphics.Color;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The chat apps the Android hub knows, by their Android package names.
 * The hub never signs in to anything: each account opens the real app
 * (or its dual / clone / work-profile copy), which is already signed in.
 */
final class Services {

    static final class Service {
        final String id;
        final String label;
        final int color;
        final String[] packages;

        Service(String id, String label, String color, String... packages) {
            this.id = id;
            this.label = label;
            this.color = Color.parseColor(color);
            this.packages = packages;
        }
    }

    static final Map<String, Service> ALL = new LinkedHashMap<>();

    private static void add(Service s) {
        ALL.put(s.id, s);
    }

    static {
        add(new Service("whatsapp", "WhatsApp", "#25D366", "com.whatsapp", "com.whatsapp.w4b"));
        add(new Service("telegram", "Telegram", "#2AABEE", "org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram"));
        add(new Service("teams", "Teams", "#5B5FC7", "com.microsoft.teams"));
        add(new Service("slack", "Slack", "#611F69", "com.Slack"));
        add(new Service("messenger", "Messenger", "#0084FF", "com.facebook.orca"));
        add(new Service("facebook", "Facebook", "#1877F2", "com.facebook.katana"));
        add(new Service("instagram", "Instagram", "#E1306C", "com.instagram.android"));
        add(new Service("linkedin", "LinkedIn", "#0A66C2", "com.linkedin.android"));
        add(new Service("x", "X", "#000000", "com.twitter.android"));
        add(new Service("discord", "Discord", "#5865F2", "com.discord"));
        add(new Service("gmail", "Gmail", "#EA4335", "com.google.android.gm"));
        add(new Service("googlechat", "Google Chat", "#00AC47", "com.google.android.apps.dynamite"));
        add(new Service("outlook", "Outlook", "#0078D4", "com.microsoft.office.outlook"));
        add(new Service("signal", "Signal", "#3A76F0", "org.thoughtcrime.securesms"));
        add(new Service("viber", "Viber", "#7360F2", "com.viber.voip"));
    }

    static Service forPackage(String pkg) {
        for (Service s : ALL.values()) for (String p : s.packages) if (p.equals(pkg)) return s;
        return null;
    }

    static Service get(String id) {
        Service s = ALL.get(id);
        return s != null ? s : ALL.get("whatsapp");
    }

    private Services() {}
}
