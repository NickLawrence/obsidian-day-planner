package com.nicklawrence.dayplanner.notifications;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;

/** Notification pointer only. The selected activity is always read from the vault. */
final class ActiveActivityStore {
    private final SharedPreferences preferences;
    private final VaultFiles files;

    ActiveActivityStore(Context context) {
        preferences = context.getSharedPreferences("activity_selection", Context.MODE_PRIVATE);
        files = new VaultFiles(context);
    }

    void select(String id, String label, long startedAt) throws IOException {
        synchronized (VaultFiles.LOCK) {
        // Never display a notification for an unsaved or already completed activity.
        new VaultActivityDocument(files.readFile(VaultActivityDocument.pathFromId(id))).findOpen(id);
        boolean changed = !id.equals(id());
        SharedPreferences.Editor editor = preferences.edit().putString("id", id).putString("label", label)
            .putLong("started_at", startedAt);
        if (changed) editor.putBoolean("finish_requested", false);
        editor.commit();
        }
    }

    void clear() { synchronized (VaultFiles.LOCK) { preferences.edit().clear().commit(); } }
    void requestFinish(boolean requested) { preferences.edit().putBoolean("finish_requested", requested).commit(); }
    boolean isActive() { return files.connected() && !id().isEmpty(); }
    String id() { return preferences.getString("id", ""); }
    String connectionId() { return files.connectionId(); }
    String label() { return preferences.getString("label", "Activity"); }
    long startedAt() { return preferences.getLong("started_at", System.currentTimeMillis()); }

    void appendNote(String note) throws IOException {
        synchronized (VaultFiles.LOCK) {
            String path = VaultActivityDocument.pathFromId(id());
            String contents = files.readFile(path);
            String updated = new VaultActivityDocument(contents).appendNote(id(), note);
            files.writeFile(path, updated, contents);
        }
    }

    JSONObject toJson() throws JSONException {
        JSONObject result = new JSONObject().put("active", isActive());
        if (!isActive()) return result;
        return result.put("id", id()).put("finishRequested", preferences.getBoolean("finish_requested", false));
    }
}
