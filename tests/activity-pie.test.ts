import { afterEach, describe, expect, test, vi } from "vitest";

import {
  calculateWeeklyActivityDurations,
  calculateWeeklyUnrecordedActivityDuration,
} from "../src/util/activity-log-summary";
import { buildWeeklyActivityPieSlices } from "../src/util/activity-pie";
import type { Activity } from "../src/util/props";

afterEach(() => vi.useRealTimers());

describe("weekly activity pie", () => {
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
    const slices = buildWeeklyActivityPieSlices(totals, unrecorded);

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
    const slices = buildWeeklyActivityPieSlices(
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
    expect(buildWeeklyActivityPieSlices([], window.moment.duration(0))).toEqual(
      [],
    );
    expect(
      buildWeeklyActivityPieSlices([], window.moment.duration(1, "hour")),
    ).toMatchObject([{ key: "__unrecorded__", value: 3_600_000, emoji: "◷" }]);
    expect(
      buildWeeklyActivityPieSlices(
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
