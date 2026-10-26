import { afterEach, describe, expect, test, vi } from "vitest";

import {
  calculateWeeklyActivityDurations,
  calculateWeeklyUnrecordedActivityDuration,
} from "../src/util/activity-log-summary";
import {
  buildActivityPieSlices,
  calculateActivityPieForRange,
  groupActivityPieSlices,
} from "../src/util/activity-pie";
import type { Activity } from "../src/util/props";

afterEach(() => vi.useRealTimers());

describe("activity pie", () => {
  test("keeps group slices adjacent and orders sections by credited group time", () => {
    const totals = [
      ["tv", 1],
      ["light work", 3],
      ["game", 2],
      ["exercise", 4],
      ["deep work", 3],
      ["read", 4],
    ].map(([activity, hours]) => ({
      activity: String(activity),
      activityKey: String(activity),
      duration: window.moment.duration(Number(hours), "hours"),
    }));
    const slices = buildActivityPieSlices(
      totals,
      window.moment.duration(100, "hours"),
    );
    expect(slices.map(({ key }) => key)).toEqual([
      "read",
      "game",
      "tv",
      "deep work",
      "light work",
      "exercise",
      "__unrecorded__",
    ]);
    const groups = groupActivityPieSlices(slices);
    expect(
      groups.map(({ key, label, value }) => ({
        key,
        label,
        hours: value / 3_600_000,
      })),
    ).toEqual([
      { key: "media", label: "Media", hours: 7 },
      { key: "work", label: "Work", hours: 6 },
      { key: "exercise", label: "Exercise", hours: 4 },
      { key: "__unrecorded__", label: "Unrecorded time", hours: 100 },
    ]);
    expect(groups.flatMap(({ slices }) => slices)).toEqual(slices);
    expect(
      buildActivityPieSlices(
        [...totals].reverse(),
        window.moment.duration(100, "hours"),
      ),
    ).toEqual(slices);
  });

  test("group totals use credited time and keep custom activities separate from unrecorded time", () => {
    const slices = buildActivityPieSlices(
      [
        {
          activity: "tv",
          activityKey: "tv",
          duration: window.moment.duration(1, "hour"),
          totalDuration: window.moment.duration(3, "hours"),
        },
        {
          activity: "read",
          activityKey: "read",
          duration: window.moment.duration(2, "hours"),
        },
        {
          activity: "Custom activity",
          activityKey: "custom activity",
          duration: window.moment.duration(1, "hour"),
        },
        {
          activity: "Another activity",
          activityKey: "another activity",
          duration: window.moment.duration(1, "hour"),
        },
        {
          activity: "game",
          activityKey: "game",
          duration: window.moment.duration(0),
        },
      ],
      window.moment.duration(1, "hour"),
    );
    const groups = groupActivityPieSlices(slices);
    expect(groups.map(({ key, value }) => [key, value / 3_600_000])).toEqual([
      ["media", 3],
      ["__other__", 2],
      ["__unrecorded__", 1],
    ]);
    expect(
      groups[0].slices.find(({ key }) => key === "tv")?.durationLabel,
    ).toBe("1h (3h)");
    expect(groups[1]).toMatchObject({
      label: "Other activities",
      color: "#808080",
    });
    expect(groups[1].slices).toHaveLength(2);
    expect(groups.reduce((sum, { value }) => sum + value, 0)).toBe(
      6 * 3_600_000,
    );
    expect(groupActivityPieSlices([])).toEqual([]);
  });

  test("clips overlapping logs to an arbitrary range with partial hours", () => {
    const activities: Activity[] = [
      {
        activity: "tv",
        taskIds: [],
        log: [{ start: "2024-09-09T09:00:00Z", end: "2024-09-09T12:00:00Z" }],
      },
      {
        activity: "deep work",
        taskIds: [],
        log: [{ start: "2024-09-09T10:00:00Z", end: "2024-09-09T11:00:00Z" }],
      },
    ];
    const start = window.moment("2024-09-09T09:30:00Z");
    const end = window.moment("2024-09-09T11:30:00Z");
    const slices = calculateActivityPieForRange(activities, start, end);
    expect(slices).toHaveLength(2);
    expect(slices.find(({ key }) => key === "tv")).toMatchObject({
      value: 3_600_000,
      durationLabel: "1h (2h)",
    });
    expect(slices.find(({ key }) => key === "deep work")?.value).toBe(
      3_600_000,
    );
    expect(slices.reduce((sum, { value }) => sum + value, 0)).toBe(
      end.diff(start),
    );
    expect(start.toISOString()).toBe("2024-09-09T09:30:00.000Z");
    expect(end.toISOString()).toBe("2024-09-09T11:30:00.000Z");
  });

  test("covers a complete calendar year, including leap day and clipped year boundaries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-10T12:00:00Z"));
    const slices = calculateActivityPieForRange(
      [
        {
          activity: "tv",
          taskIds: [],
          log: [{ start: "2023-12-31T23:00:00Z", end: "2024-01-01T02:00:00Z" }],
        },
        {
          activity: "deep work",
          taskIds: [],
          log: [
            { start: "2024-01-01T01:00:00Z", end: "2024-01-01T03:00:00Z" },
            { start: "2024-12-31T23:00:00Z", end: "2025-01-01T01:00:00Z" },
          ],
        },
        {
          activity: "social",
          taskIds: [],
          log: [{ start: "2025-01-01T00:00:00Z", end: "2025-01-02T00:00:00Z" }],
        },
      ],
      window.moment("2024-01-01T00:00:00Z"),
      window.moment("2025-01-01T00:00:00Z"),
    );
    expect(slices.find(({ key }) => key === "tv")?.value).toBe(3_600_000);
    expect(slices.find(({ key }) => key === "deep work")?.value).toBe(
      3 * 3_600_000,
    );
    expect(slices.find(({ key }) => key === "social")).toBeUndefined();
    expect(slices.find(({ key }) => key === "__unrecorded__")?.value).toBe(
      (366 * 24 - 4) * 3_600_000,
    );
    expect(slices.reduce((sum, { value }) => sum + value, 0)).toBe(
      366 * 24 * 3_600_000,
    );
  });

  test("limits the current year to elapsed time, including active clocks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-05-15T12:00:00Z"));
    const start = window.moment("2024-01-01T00:00:00Z");
    const slices = calculateActivityPieForRange(
      [
        {
          activity: "tv",
          taskIds: [],
          log: [{ start: "2024-05-15T09:00:00Z" }],
        },
        {
          activity: "deep work",
          taskIds: [],
          log: [{ start: "2024-05-15T10:00:00Z", end: "2024-05-15T13:00:00Z" }],
        },
        {
          activity: "social",
          taskIds: [],
          log: [{ start: "2024-05-15T13:00:00Z", end: "2024-05-15T14:00:00Z" }],
        },
      ],
      start,
      start.clone().add(1, "year"),
    );
    expect(slices.find(({ key }) => key === "tv")?.value).toBe(3_600_000);
    expect(slices.find(({ key }) => key === "deep work")?.value).toBe(
      2 * 3_600_000,
    );
    expect(slices.find(({ key }) => key === "social")).toBeUndefined();
    expect(slices.reduce((sum, { value }) => sum + value, 0)).toBe(
      window.moment().diff(start),
    );
  });

  test("returns no slices for future, invalid, empty, or reversed periods", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-09-09T12:00:00Z"));
    const now = window.moment();
    expect(
      calculateActivityPieForRange(
        [],
        now.clone().add(1, "day"),
        now.clone().add(2, "days"),
      ),
    ).toEqual([]);
    expect(
      calculateActivityPieForRange([], window.moment.invalid(), now),
    ).toEqual([]);
    expect(
      calculateActivityPieForRange([], now, window.moment.invalid()),
    ).toEqual([]);
    expect(calculateActivityPieForRange([], now, now)).toEqual([]);
    expect(
      calculateActivityPieForRange([], now, now.clone().subtract(1, "day")),
    ).toEqual([]);
  });

  test("partitions the elapsed week using credited time, including unrecorded time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-09-09T12:00:00Z"));
    const now = window.moment();
    const activities: Activity[] = [
      {
        activity: "tv",
        taskIds: [],
        log: [{ start: "2024-09-09T09:00:00Z", end: "2024-09-09T12:00:00Z" }],
      },
      {
        activity: "deep work",
        taskIds: [],
        log: [{ start: "2024-09-09T10:00:00Z", end: "2024-09-09T12:00:00Z" }],
      },
      {
        activity: "social",
        taskIds: [],
        log: [{ start: "2024-09-09T10:00:00Z", end: "2024-09-09T11:00:00Z" }],
      },
    ];
    const totals = calculateWeeklyActivityDurations(activities, now);
    const unrecorded = calculateWeeklyUnrecordedActivityDuration(
      activities,
      now,
    );
    const slices = buildActivityPieSlices(totals, unrecorded);

    expect(
      slices.map(({ key, value }) => ({ key, hours: value / 3_600_000 })),
    ).toEqual([
      { key: "deep work", hours: 2 },
      { key: "tv", hours: 1 },
      { key: "__unrecorded__", hours: 9 },
    ]);
    expect(slices.reduce((sum, { value }) => sum + value, 0)).toBe(
      now.diff(now.clone().startOf("isoWeek")),
    );
    expect(slices.find(({ key }) => key === "tv")).toMatchObject({
      emoji: "📺",
      durationLabel: "1h (3h)",
    });
    expect(slices.some(({ key }) => key === "social")).toBe(false);
  });

  test("uses activity group colors and activity-specific variants", () => {
    const slices = buildActivityPieSlices(
      ["light work", "deep work", "read"].map((activityKey) => ({
        activity: activityKey,
        activityKey,
        duration: window.moment.duration(1, "hour"),
      })),
      window.moment.duration(0),
    );
    expect(slices.find(({ key }) => key === "light work")).toMatchObject({
      color: "#808080",
      emoji: "🔧",
      label: "Light Work",
    });
    expect(slices.find(({ key }) => key === "deep work")?.color).not.toBe(
      "#808080",
    );
    expect(slices.find(({ key }) => key === "read")).toMatchObject({
      color: "#00bcd4",
      emoji: "📖",
    });
  });

  test("handles empty weeks, only unrecorded time, and custom activities", () => {
    expect(buildActivityPieSlices([], window.moment.duration(0))).toEqual([]);
    expect(
      buildActivityPieSlices([], window.moment.duration(1, "hour")),
    ).toMatchObject([{ key: "__unrecorded__", value: 3_600_000, emoji: "◷" }]);
    expect(
      buildActivityPieSlices(
        [
          {
            activity: "Custom activity",
            activityKey: "custom activity",
            duration: window.moment.duration(1, "hour"),
          },
        ],
        window.moment.duration(0),
      ),
    ).toMatchObject([
      {
        label: "Custom activity",
        color: "#808080",
        emoji: "•",
        value: 3_600_000,
      },
    ]);
  });
});
