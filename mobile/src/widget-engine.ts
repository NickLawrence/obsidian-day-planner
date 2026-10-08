import { readStoredActivities } from "../../src/shared/activity";
import { buildActivityDayTimeline } from "../../src/shared/activity-timeline";
import { activityYaml } from "./lib/activity-files";

// A short-lived, offline WebView runs the actual shared TypeScript for native widgets.
// No bridge, vault permissions, or activity storage are exposed to this page.
Object.assign(window, {
  DayPlannerWidget: {
    build(files: [string, string][], day: string, now: number, dark: boolean) {
      try {
        return {
          model: buildActivityDayTimeline(
            readStoredActivities(files, activityYaml),
            day,
            now,
            dark,
          ),
        };
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "Unable to read activity files",
        };
      }
    },
  },
});
