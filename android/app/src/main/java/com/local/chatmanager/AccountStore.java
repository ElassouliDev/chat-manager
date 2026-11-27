package com.local.chatmanager;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** The accounts and their order, saved in SharedPreferences as JSON. */
final class AccountStore {

    static final long MUTE_FOREVER = -1;

    static final class Account {
        String id;
        String name;
        int color;
        String service;
        // 0 = not muted, -1 = until unmuted, otherwise a time in milliseconds.
        long mutedUntil;

        boolean isMuted() {
            return mutedUntil == MUTE_FOREVER || mutedUntil > System.currentTimeMillis();
        }

        /** WebView profile name: one per account keeps logins separate. */
        String profile() {
            return "account_" + id.replaceAll("[^A-Za-z0-9_]", "_");
        }
    }

    private final SharedPreferences prefs;
    final List<Account> accounts = new ArrayList<>();

    AccountStore(Context context) {
        prefs = context.getSharedPreferences("chat_manager", Context.MODE_PRIVATE);
        load();
    }

    private void load() {
        accounts.clear();
        try {
            JSONArray arr = new JSONArray(prefs.getString("accounts", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Account a = new Account();
                a.id = o.getString("id");
                a.name = o.optString("name", "Account");
                a.color = o.optInt("color", Services.get(o.optString("service")).color);
                a.service = o.optString("service", "whatsapp");
                a.mutedUntil = o.optLong("mutedUntil", 0);
                accounts.add(a);
            }
        } catch (JSONException e) {
            accounts.clear();
        }
    }

    void save() {
        JSONArray arr = new JSONArray();
        try {
            for (Account a : accounts) {
                JSONObject o = new JSONObject();
                o.put("id", a.id);
                o.put("name", a.name);
                o.put("color", a.color);
                o.put("service", a.service);
                o.put("mutedUntil", a.mutedUntil);
                arr.put(o);
            }
        } catch (JSONException ignored) {
            // Values are plain strings and numbers, so this does not happen.
        }
        prefs.edit().putString("accounts", arr.toString()).apply();
    }

    Account find(String id) {
        for (Account a : accounts) if (a.id.equals(id)) return a;
        return null;
    }

    Account add(String service, String name) {
        Account a = new Account();
        a.id = "acc-" + System.currentTimeMillis() + "-" + accounts.size();
        a.name = name;
        a.service = service;
        a.color = Services.get(service).color;
        accounts.add(a);
        save();
        return a;
    }

    void remove(String id) {
        accounts.remove(find(id));
        save();
    }

    void move(String id, int toIndex) {
        Account a = find(id);
        if (a == null) return;
        accounts.remove(a);
        accounts.add(Math.max(0, Math.min(toIndex, accounts.size())), a);
        save();
    }
}
