package com.nicklawrence.dayplanner.notifications;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Pixel regressions for activity content across the widget's hourly bitmap rows. */
public class WidgetTimelineRendererTest {
    @Test public void multiHourActivityDoesNotRepeatDetailsInContinuationRows() throws Exception {
        Context context = context();
        JSONObject model = model(570);
        Bitmap actual = WidgetTimelineRenderer.render(context, model, 2, 276);
        Bitmap empty = WidgetTimelineRenderer.render(context, withoutDetails(model), 2, 276);
        assertEquals("The middle hour must contain only the continuing activity box", 0,
            changedPixels(actual, empty, 48, 0, 276, 96));
    }

    @Test public void detailsStartingJustBeforeAnHourBoundaryContinueIntoTheNextRow() throws Exception {
        Context context = context();
        JSONObject model = model(599);
        Bitmap actual = WidgetTimelineRenderer.render(context, model, 1, 276);
        Bitmap empty = WidgetTimelineRenderer.render(context, withoutDetails(model), 1, 276);
        assertTrue("Details must survive clipping at the end of the starting hour",
            changedPixels(actual, empty, 53, 0, 271, 80) > 0);
    }

    @Test public void qualityAppearsInTheTopRightCorner() throws Exception {
        Context context = context();
        JSONObject model = model(540);
        JSONObject noQuality = new JSONObject(model.toString());
        noQuality.getJSONArray("blocks").getJSONObject(0).put("qualityLabel", "");
        Bitmap actual = WidgetTimelineRenderer.render(context, model, 0, 276);
        Bitmap empty = WidgetTimelineRenderer.render(context, noQuality, 0, 276);
        assertTrue("Quality must be visible beside the title on the right",
            changedPixels(actual, empty, 230, 3, 271, 25) > 0);
        assertEquals("Quality must not appear underneath the activity details", 0,
            changedPixels(actual, empty, 230, 30, 271, 85));
    }

    private static Context context() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Configuration configuration = new Configuration(context.getResources().getConfiguration());
        configuration.fontScale = 1f;
        return context.createConfigurationContext(configuration);
    }

    private static JSONObject model(int startMinute) throws Exception {
        JSONArray hours = new JSONArray();
        for (int hour = 9; hour <= 12; hour++) {
            hours.put(new JSONObject().put("label", hour + ":00")
                .put("startMinute", hour * 60).put("endMinute", (hour + 1) * 60));
        }
        JSONObject block = new JSONObject().put("startMinute", startMinute).put("endMinute", 750)
            .put("placing", new JSONObject().put("offsetPercent", 0).put("spanPercent", 100))
            .put("background", "#f0f4ff").put("border", "#8899cc")
            .put("title", "Read").put("timeLabel", "09:00 – 12:30")
            .put("qualityLabel", "8 \uD83D\uDE04").put("notes", "From Obsidian")
            .put("durationLabel", "3h 30m").put("active", false);
        return new JSONObject().put("dark", false).put("nowMinute", JSONObject.NULL)
            .put("hours", hours).put("blocks", new JSONArray().put(block));
    }

    private static JSONObject withoutDetails(JSONObject model) throws Exception {
        JSONObject result = new JSONObject(model.toString());
        result.getJSONArray("blocks").getJSONObject(0).put("title", "").put("timeLabel", "")
            .put("qualityLabel", "").put("notes", "");
        return result;
    }

    private static int changedPixels(Bitmap actual, Bitmap expected, int left, int top, int right, int bottom) {
        float scale = actual.getWidth() / 276f;
        int changes = 0;
        for (int y = Math.round(top * scale); y < Math.round(bottom * scale); y++) {
            for (int x = Math.round(left * scale); x < Math.round(right * scale); x++) {
                if (actual.getPixel(x, y) != expected.getPixel(x, y)) changes++;
            }
        }
        return changes;
    }
}
