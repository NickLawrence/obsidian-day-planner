package com.nicklawrence.dayplanner.notifications;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.widget.RemoteViews;
import com.nicklawrence.dayplanner.MainActivity;
import com.nicklawrence.dayplanner.R;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/** A launcher collection widget: each row is one continuous hour of the timeline. */
public class ActivityTimelineWidget extends AppWidgetProvider {
    static final String REFRESH = "com.nicklawrence.dayplanner.WIDGET_REFRESH";
    static final String NOW = "com.nicklawrence.dayplanner.WIDGET_NOW";
    static final String WIDTH = "timeline_width";
    static final String DARK = "timeline_dark";

    public static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : manager.getAppWidgetIds(new ComponentName(context, ActivityTimelineWidget.class)))
            update(context, manager, id, false);
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id, false);
    }

    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        update(context, manager, id, false);
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!REFRESH.equals(intent.getAction()) && !NOW.equals(intent.getAction())) return;
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        // Only act on widgets belonging to this provider, including stale pending intents.
        for (int owned : manager.getAppWidgetIds(new ComponentName(context, ActivityTimelineWidget.class)))
            if (owned == id) update(context, manager, id, NOW.equals(intent.getAction()));
    }

    private static void update(Context context, AppWidgetManager manager, int id, boolean jumpToNow) {
        Bundle options = manager.getAppWidgetOptions(id);
        boolean dark = (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        boolean landscape = context.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        int width = Math.max(140, options.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
            : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 300) - 24);
        Intent adapter = new Intent(context, ActivityTimelineService.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(WIDTH, width).putExtra(DARK, dark);
        adapter.setData(Uri.parse("dayplanner://timeline/" + id + "/" + width + "/" + dark));
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.activity_timeline_widget);
        views.setTextViewText(R.id.widget_date, new SimpleDateFormat("EEE, d MMM", Locale.getDefault()).format(new Date()));
        views.setRemoteAdapter(R.id.widget_hours, adapter);
        views.setEmptyView(R.id.widget_hours, R.id.widget_empty);
        views.setOnClickPendingIntent(R.id.widget_refresh, action(context, id, REFRESH));
        views.setOnClickPendingIntent(R.id.widget_now, action(context, id, NOW));
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_heading, PendingIntent.getActivity(context, id, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        views.setPendingIntentTemplate(R.id.widget_hours, PendingIntent.getActivity(context, ~id, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        if (jumpToNow) {
            Calendar midnight = Calendar.getInstance();
            midnight.set(Calendar.HOUR_OF_DAY, 0); midnight.set(Calendar.MINUTE, 0);
            midnight.set(Calendar.SECOND, 0); midnight.set(Calendar.MILLISECOND, 0);
            int hour = (int) ((System.currentTimeMillis() - midnight.getTimeInMillis()) / 3_600_000L);
            views.setScrollPosition(R.id.widget_hours, hour + 1); // First row contains update status.
        }
        manager.updateAppWidget(id, views);
        manager.notifyAppWidgetViewDataChanged(id, R.id.widget_hours);
    }

    private static PendingIntent action(Context context, int id, String action) {
        Intent intent = new Intent(context, ActivityTimelineWidget.class).setAction(action)
            .setData(Uri.parse("dayplanner://timeline-action/" + id + "/" + action))
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
