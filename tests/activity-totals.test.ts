import { describe, expect, test } from "vitest";

import type { PathToListProps } from "../src/redux/dataview/dataview-slice";
import { calculateDailyActivityDurations } from "../src/util/activity-log-summary";
import {
  filterActivitiesByMainKey,
  getAllActivitiesFromListProps,
  getActivityTotalsForRange,
} from "../src/util/activity-totals";
import type { Activity } from "../src/util/props";

describe("activity totals utilities", () => {
  test("monthly/daily summaries use base activity labels without mainKey values", () => {
    const activities: Activity[] = [
      {
        activity: "read",
        taskIds: [],
        read: { book: "Book A" },
        log: [{ start: "2024-09-10T10:00:00Z", end: "2024-09-10T11:00:00Z" }],
      } as Activity,
      {
        activity: "read",
        taskIds: [],
        read: { book: "Book B" },
        log: [{ start: "2024-09-10T12:00:00Z", end: "2024-09-10T12:30:00Z" }],
      } as Activity,
    ];

    const totals = calculateDailyActivityDurations(
      activities,
      window.moment("2024-09-10"),
    );

    expect(totals).toHaveLength(1);
    expect(totals[0].activity).toBe("📖 Read");
    expect(totals[0].duration.asMinutes()).toBe(90);
  });

  test("can filter totals by matching mainKey values", () => {
    const activities: Activity[] = [
      {
        activity: "read",
        taskIds: [],
        read: { book: "Book A" },
        log: [{ start: "2024-09-10T10:00:00Z", end: "2024-09-10T11:00:00Z" }],
      } as Activity,
      {
        activity: "read",
        taskIds: [],
        read: { book: "Book B" },
        log: [{ start: "2024-09-10T11:00:00Z", end: "2024-09-10T11:30:00Z" }],
      } as Activity,
    ];

    const totals = getActivityTotalsForRange(
      activities,
      window.moment("2024-09-10T00:00:00Z"),
      window.moment("2024-09-11T00:00:00Z"),
      { activityName: "read", mainKey: "book", mainKeyValue: "Book A" },
    );

    expect(totals).toHaveLength(1);
    expect(totals[0].activity).toBe("📖 Read");
    expect(totals[0].duration.asMinutes()).toBe(60);
  });

  test("can flatten activities from listProps", () => {
    const listProps: PathToListProps = {
      "Daily/2024-09-10.md": {
        1: {
          position: {
            start: { line: 1, col: 0, offset: 0 },
            end: { line: 1, col: 10, offset: 10 },
          },
          parsed: {
            activities: [
              {
                activity: "read",
                taskIds: [],
                log: [{ start: "2024-09-10T10:00:00Z" }],
              },
            ],
          },
        },
      },
    };

    const activities = getAllActivitiesFromListProps(listProps);
    const filtered = filterActivitiesByMainKey(activities, {
      activityName: "read",
      mainKey: "book",
    });

    expect(activities).toHaveLength(1);
    expect(filtered).toHaveLength(1);
  });
});
