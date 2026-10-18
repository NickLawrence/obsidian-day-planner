import momentWithTimezone from "moment-timezone";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildActivityDashboard } from "../src/util/activity-dashboard";
import {
  getActivityDefinition,
  getActivityDefinitions,
} from "../src/util/activity-definitions";
import {
  calculateActivityDurationsForRange,
  calculateDailyActivityDisplayDurations,
  calculateWeeklyActivityDurations,
  calculateWeeklyUnrecordedActivityDuration,
} from "../src/util/activity-log-summary";
import { calculateActivityMainKeyProgress } from "../src/util/activity-progress";
import { getActivityTotalsForRange } from "../src/util/activity-totals";
import { formatActivityDuration } from "../src/util/duration";
import type { Activity } from "../src/util/props";

const day = "2024-09-09";
function entry(
  activity: string,
  start: string,
  end?: string,
  details = {},
): Activity {
  return {
    activity,
    taskIds: [],
    ...details,
    log: [
      {
        start: `${day}T${start}:00Z`,
        ...(end ? { end: `${day}T${end}:00Z` } : {}),
      },
    ],
  } as Activity;
}
function summarize(activities: Activity[]) {
  return calculateWeeklyActivityDurations(activities, window.moment(day)).map(
    (row) => ({
      key: row.activityKey,
      counted: row.duration.asMinutes(),
      total: row.totalDuration?.asMinutes(),
    }),
  );
}

describe("activity priorities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-09-20T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  test("defines priorities on activities with work above TV and social", () => {
    expect(
      getActivityDefinitions().every(({ priority }) =>
        Number.isFinite(priority),
      ),
    ).toBe(true);
    expect(getActivityDefinition("deep work")!.priority).toBeGreaterThan(
      getActivityDefinition("tv")!.priority!,
    );
    expect(getActivityDefinition("light work")!.priority).toBeGreaterThan(
      getActivityDefinition("social")!.priority!,
    );
  });

  test("credits each overlapping slice once and keeps full elapsed totals", () => {
    const activities = [
      entry("tv", "09:00", "14:00"),
      entry("light work", "10:00", "13:00"),
      entry("deep work", "11:00", "12:00"),
      entry("social", "11:30", "12:30"),
    ];
    expect(summarize(activities)).toEqual(
      expect.arrayContaining([
        { key: "tv", counted: 120, total: 300 },
        { key: "light work", counted: 120, total: 180 },
        { key: "deep work", counted: 60, total: 60 },
        { key: "social", counted: 0, total: 60 },
      ]),
    );
    const counted = summarize(activities).reduce(
      (sum, row) => sum + row.counted,
      0,
    );
    expect(
      counted +
        calculateWeeklyUnrecordedActivityDuration(
          activities,
          window.moment(day),
        ).asMinutes(),
    ).toBe(7 * 24 * 60);
  });

  test.each(["transit", "ride", "bed", "eat"])(
    "credits reading, games, and other goals over an earlier-started %s log",
    (background) => {
      const activities = [
        entry(background, "09:00", "14:00"),
        entry("read", "10:00", "11:00"),
        entry("game", "11:00", "12:00"),
        entry("language", "12:00", "13:00"),
        entry("custom activity", "13:00", "13:30"),
      ];
      const rows = summarize(activities);
      expect(rows).toEqual(
        expect.arrayContaining([
          { key: background, counted: 90, total: 300 },
          { key: "read", counted: 60, total: 60 },
          { key: "game", counted: 60, total: 60 },
          { key: "language", counted: 60, total: 60 },
          { key: "custom activity", counted: 30, total: 30 },
        ]),
      );
      expect(
        rows.reduce((sum, row) => sum + row.counted, 0) +
          calculateWeeklyUnrecordedActivityDuration(
            activities,
            window.moment(day),
          ).asMinutes(),
      ).toBe(7 * 24 * 60);
    },
  );

  test("merges repeated and overlapping logs for the same normalized activity", () => {
    const activities = [
      entry(" TV ", "09:00", "11:00"),
      entry("tv", "10:00", "12:00"),
      entry("tv", "09:00", "11:00"),
    ];
    expect(summarize(activities)).toEqual([
      { key: "tv", counted: 180, total: 180 },
    ]);
  });

  test("breaks equal priorities by original start, then activity name, independent of input order", () => {
    const activities = [
      entry("tv", "09:00", "12:00"),
      entry("social", "10:00", "13:00"),
    ];
    expect(summarize(activities)).toEqual(
      expect.arrayContaining([
        { key: "tv", counted: 180, total: 180 },
        { key: "social", counted: 60, total: 180 },
      ]),
    );
    expect(summarize([...activities].reverse())).toEqual(summarize(activities));
    const sameStart = [
      entry("tv", "09:00", "10:00"),
      entry("social", "09:00", "10:00"),
    ];
    expect(summarize(sameStart)).toEqual(summarize([...sameStart].reverse()));
    expect(
      summarize(sameStart).find(({ key }) => key === "social")?.counted,
    ).toBe(60);
    // Clamping to the range must preserve the original start used for ties.
    expect(
      calculateActivityDurationsForRange(
        activities,
        window.moment(`${day}T11:00:00Z`),
        window.moment(`${day}T12:00:00Z`),
      )
        .find(({ activityKey }) => activityKey === "tv")
        ?.duration.asMinutes(),
    ).toBe(60);
  });

  test("includes unknown activities with a default priority and does not double count ties", () => {
    expect(
      summarize([
        entry("unknown", "09:00", "11:00"),
        entry("other", "10:00", "12:00"),
      ]),
    ).toEqual([
      { key: "other", counted: 60, total: 120 },
      { key: "unknown", counted: 120, total: 120 },
    ]);
  });

  test("clips active and future logs at now, keeping elapsed weekly time balanced", () => {
    vi.setSystemTime(new Date(`${day}T12:00:00Z`));
    const activities = [
      entry("tv", "09:00"),
      entry("deep work", "10:00", "13:00"),
      entry("social", "13:00", "14:00"),
    ];
    expect(summarize(activities)).toEqual(
      expect.arrayContaining([
        { key: "tv", counted: 60, total: 180 },
        { key: "deep work", counted: 120, total: 120 },
      ]),
    );
    expect(summarize(activities)).toHaveLength(2);
    expect(
      summarize(activities).reduce((sum, row) => sum + row.counted, 0) +
        calculateWeeklyUnrecordedActivityDuration(
          activities,
          window.moment(day),
        ).asMinutes(),
    ).toBe(12 * 60);
  });

  test.each([
    ["2024-03-04", 167, 3],
    ["2023-10-30", 169, 5],
  ])(
    "balances the daylight-saving week starting %s",
    (start, hours, workHours) => {
      const week = momentWithTimezone.tz(start, "America/Los_Angeles");
      const weekEnd = week.clone().add(1, "week");
      const sunday = week.clone().add(6, "days");
      const activities: Activity[] = [
        {
          activity: "tv",
          taskIds: [],
          log: [{ start: week.toISOString(), end: weekEnd.toISOString() }],
        },
        {
          activity: "deep work",
          taskIds: [],
          log: [
            {
              start: sunday.toISOString(),
              end: sunday.clone().hour(4).toISOString(),
            },
          ],
        },
      ];
      const totals = calculateWeeklyActivityDurations(activities, week);
      expect(
        totals
          .find(({ activityKey }) => activityKey === "tv")
          ?.totalDuration?.asHours(),
      ).toBe(hours);
      expect(
        totals
          .find(({ activityKey }) => activityKey === "deep work")
          ?.duration.asHours(),
      ).toBe(workHours);
      expect(
        totals.reduce((sum, row) => sum + row.duration.asHours(), 0) +
          calculateWeeklyUnrecordedActivityDuration(activities, week).asHours(),
      ).toBe(hours);
    },
  );

  test("returns no totals for invalid or reversed ranges", () => {
    const activities = [entry("tv", "09:00", "12:00")];
    expect(
      calculateActivityDurationsForRange(
        activities,
        window.moment.invalid(),
        window.moment(day),
      ),
    ).toEqual([]);
    expect(
      calculateActivityDurationsForRange(
        activities,
        window.moment(day),
        window.moment.invalid(),
      ),
    ).toEqual([]);
    expect(
      calculateActivityDurationsForRange(
        activities,
        window.moment(day).add(1, "day"),
        window.moment(day),
      ),
    ).toEqual([]);
  });

  test("clips across week boundaries and skips invalid, reversed, and zero-length logs", () => {
    const activities: Activity[] = [
      {
        activity: "tv",
        taskIds: [],
        log: [
          { start: "2024-09-08T23:00:00Z", end: "2024-09-09T02:00:00Z" },
          { start: "2024-09-15T23:00:00Z", end: "2024-09-16T01:00:00Z" },
        ],
      },
      entry("deep work", "00:00", "01:00"),
      entry("tv", "11:00", "10:00"),
      entry("tv", "11:00", "11:00"),
      {
        activity: "social",
        taskIds: [],
        log: [
          { start: "invalid" },
          { start: `${day}T10:00:00Z`, end: "invalid" },
        ],
      },
    ];
    expect(summarize(activities)).toEqual(
      expect.arrayContaining([
        { key: "tv", counted: 120, total: 180 },
        { key: "deep work", counted: 60, total: 60 },
      ]),
    );
    expect(summarize(activities)).toHaveLength(2);
  });

  test("daily main-key rows resolve overlaps against all activities before grouping", () => {
    const activities = [
      entry("tv", "09:00", "12:00", { tv: { name: "Show A" } }),
      entry("tv", "10:00", "13:00", { tv: { name: "Show B" } }),
      entry("deep work", "11:00", "12:00"),
    ];
    const totals = calculateDailyActivityDisplayDurations(
      activities,
      window.moment(day),
    );
    expect(
      totals
        .find(({ activity }) => activity === "Show A")
        ?.duration.asMinutes(),
    ).toBe(120);
    expect(
      totals
        .find(({ activity }) => activity === "Show B")
        ?.duration.asMinutes(),
    ).toBe(60);
    expect(
      totals
        .filter(({ activityKey }) => activityKey === "tv")
        .map(({ totalDuration }) => totalDuration?.asMinutes()),
    ).toEqual([180, 180]);
    expect(totals.reduce((sum, row) => sum + row.duration.asMinutes(), 0)).toBe(
      240,
    );
  });

  test("filtered API totals retain higher-priority competitors", () => {
    const totals = getActivityTotalsForRange(
      [
        entry("tv", "09:00", "12:00", { tv: { name: "Show A" } }),
        entry("deep work", "10:00", "12:00"),
      ],
      window.moment(day),
      window.moment(day).add(1, "day"),
      { activityName: "tv", mainKey: "name", mainKeyValue: "Show A" },
    );
    expect(totals).toHaveLength(1);
    expect(totals[0].duration.asMinutes()).toBe(60);
    expect(totals[0].totalDuration?.asMinutes()).toBe(180);
  });

  test("activity dashboard groups and heatmap weeks show credited and full time", () => {
    const dashboard = buildActivityDashboard(
      [
        {
          activity: "read",
          taskIds: [],
          read: { book: "Book" },
          log: [{ start: "2024-09-08T23:00:00Z", end: "2024-09-09T02:00:00Z" }],
        } as Activity,
        entry("deep work", "00:00", "01:00"),
      ],
      getActivityDefinition("read")!,
      2024,
    );
    expect(dashboard.rows[0]).toMatchObject({
      minutes: 120,
      totalMinutes: 180,
    });
    expect(dashboard.groups[0]).toMatchObject({
      value: "Book",
      minutes: 120,
      totalMinutes: 180,
    });
    expect(
      dashboard.weeks.find(({ start }) => start === "2024-09-02"),
    ).toMatchObject({ minutes: 60 });
    expect(dashboard.weeks.find(({ start }) => start === day)).toMatchObject({
      minutes: 60,
      totalMinutes: 120,
    });
  });

  test("progress exposes credited time while retaining full time for pace and ETA", () => {
    const progress = calculateActivityMainKeyProgress({
      activities: [
        entry("read", "09:00", "12:00", {
          read: { book: "Book", "start-page": 1, "end-page": 60 },
        }),
        entry("deep work", "10:00", "12:00"),
      ],
      definition: getActivityDefinition("read")!,
      value: "Book",
      rangeMaximums: { pages: 120 },
    });
    expect(progress).toMatchObject({
      minutes: 180,
      countedMinutes: 60,
      minutesPerUnit: 3,
      estimatedMinutesRemaining: 180,
    });
  });

  test("formats discounted totals, including zero credit, and keeps other totals compact", () => {
    const format = (counted: number, total: number) =>
      formatActivityDuration({
        duration: window.moment.duration(counted, "minutes"),
        totalDuration: window.moment.duration(total, "minutes"),
      });
    expect(format(90, 150)).toBe("1h 30m (2h 30m)");
    expect(format(0, 60)).toBe("0m (1h)");
    expect(format(60, 60)).toBe("1h");
    expect(
      formatActivityDuration({
        duration: window.moment.duration(45, "minutes"),
      }),
    ).toBe("45m");
  });
});
