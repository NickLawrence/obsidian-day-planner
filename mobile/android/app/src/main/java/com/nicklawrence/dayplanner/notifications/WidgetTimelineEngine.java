package com.nicklawrence.dayplanner.notifications;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Executes the bundled shared TypeScript without requiring an open Capacitor app. */
final class WidgetTimelineEngine {
    private static final Handler main = new Handler(Looper.getMainLooper());

    @SuppressLint("SetJavaScriptEnabled")
    static JSONObject build(Context context, JSONArray files, String day, long now, boolean dark) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) throw new IllegalStateException("Widget data must load off the UI thread");
        String engine;
        try (InputStream input = context.getAssets().open("public/widget-engine.js")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            engine = bytes.toString(StandardCharsets.UTF_8.name());
        }
        String expression = engine + "\nJSON.stringify(window.DayPlannerWidget.build(" + files + ","
            + JSONObject.quote(day) + "," + now + "," + dark + "))";
        CountDownLatch complete = new CountDownLatch(1);
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<Exception> failure = new AtomicReference<>();
        AtomicReference<WebView> browser = new AtomicReference<>();
        AtomicBoolean cancelled = new AtomicBoolean();
        main.post(() -> {
            if (cancelled.get()) return;
            try {
                WebView view = new WebView(context.getApplicationContext());
                browser.set(view);
                view.getSettings().setJavaScriptEnabled(true);
                view.getSettings().setBlockNetworkLoads(true);
                view.getSettings().setAllowFileAccess(false);
                view.getSettings().setAllowContentAccess(false);
                AtomicBoolean evaluated = new AtomicBoolean();
                view.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView ignored, String url) {
                        if (cancelled.get() || !evaluated.compareAndSet(false, true)) return;
                        view.evaluateJavascript(expression, value -> {
                            try {
                                Object decoded = new JSONTokener(value).nextValue();
                                if (!(decoded instanceof String)) throw new IOException("Unable to run the shared timeline engine");
                                JSONObject response = new JSONObject((String) decoded);
                                if (response.has("error")) throw new IOException(response.getString("error"));
                                result.set(response.getJSONObject("model"));
                            } catch (Exception error) { failure.set(error); }
                            finally { complete.countDown(); }
                        });
                    }
                });
                // Only trusted, bundled JavaScript is evaluated; YAML remains a JSON argument.
                view.loadDataWithBaseURL("https://timeline.invalid/", "<html><body></body></html>", "text/html", "UTF-8", null);
            } catch (Exception error) { failure.set(error); complete.countDown(); }
        });
        try {
            if (!complete.await(15, TimeUnit.SECONDS)) throw new IOException("Timeline refresh timed out. Tap refresh to retry.");
            if (failure.get() != null) throw failure.get();
            return result.get();
        } finally {
            cancelled.set(true);
            main.post(() -> { if (browser.get() != null) browser.get().destroy(); });
        }
    }
}
