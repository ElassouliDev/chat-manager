package com.local.chatmanager;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The accounts in the hub and their order. Each account points at one
 * installed app copy: a package in a user profile (the main phone, a dual /
 * clone copy, or a work profile), identified by the profile's serial number.
 */
final class AccountStore {

    static final class Account {
        String id;
        String name;
        String service;
        String pkg;
        long userSerial;

        /** Key that matches notifications from the same app copy. */
        String key() {
            return key(pkg, userSerial);
        }

        static String key(String pkg, long serial) {
            return pkg + "|" + serial;
        }
    }

    private final SharedPreferences prefs;
    final List<Account> accounts = new ArrayList<>();

    AccountStore(Context context) {
        prefs = context.getSharedPreferences("chat_manager_hub", Context.MODE_PRIVATE);
        try {
            JSONArray arr = new JSONArray(prefs.getString("accounts", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Account a = new Account();
                a.id = o.getString("id");
                a.name = o.optString("name", "Account");
                a.service = o.optString("service", "whatsapp");
                a.pkg = o.getString("pkg");
                a.userSerial = o.optLong("userSerial", 0);
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
                arr.put(new JSONObject()
                        .put("id", a.id).put("name", a.name).put("service", a.service)
                        .put("pkg", a.pkg).put("userSerial", a.userSerial));
            }
        } catch (JSONException ignored) {
            // Only plain strings and numbers.
        }
        prefs.edit().putString("accounts", arr.toString()).apply();
    }

    boolean has(String pkg, long serial) {
        for (Account a : accounts) if (a.pkg.equals(pkg) && a.userSerial == serial) return true;
        return false;
    }

    Account add(String service, String pkg, long serial, String name) {
        Account a = new Account();
        a.id = "acc-" + System.currentTimeMillis() + "-" + accounts.size();
        a.name = name;
        a.service = service;
        a.pkg = pkg;
        a.userSerial = serial;
        accounts.add(a);
        save();
        return a;
    }

    void remove(Account a) {
        accounts.remove(a);
        save();
    }

    void move(Account a, int delta) {
        int i = accounts.indexOf(a);
        int j = Math.max(0, Math.min(accounts.size() - 1, i + delta));
        if (i < 0 || i == j) return;
        accounts.remove(i);
        accounts.add(j, a);
        save();
    }
}
