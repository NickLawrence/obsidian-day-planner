import { describe, expect, test } from "vitest";

import {
  calculateDailyActivityDurations,
  calculateWeeklyActivityDurations,
  formatDuration,
  getWeekRangeFor,
} from "../src/util/activity-log-summary";
import type { Activity } from "../src/util/props";

describe("calculateWeeklyActivityDurations", () => {
  test("aggregates durations per activity within the iso week", () => {
    const activities: Activity[] = [
      {
        activity: "activity: piano",
        log: [
          {
            start: "2024-09-09T10:00:00Z",
            end: "2024-09-09T11:30:00Z",
          },
          {
            start: "2024-09-15T23:00:00Z",
            end: "2024-09-16T01:00:00Z",
          },
        ],
      },
      {
        activity: "activity: reading",
        log: [
          {
            start: "2024-09-10T09:00:00Z",
            end: "2024-09-10T09:45:00Z",
          },
        ],
      },
    ];

    const totals = calculateWeeklyActivityDurations(
      activities,
      window.moment("2024-09-11"),
    );

    expect(totals.map((it) => it.activity)).toEqual([
      "activity: piano",
      "activity: reading",
    ]);
    expect(
      totals.find((it) => it.activity === "activity: piano")?.duration.asMinutes(),
    ).toBe(150);
    expect(
      totals.find((it) => it.activity === "activity: reading")?.duration.asMinutes(),
    ).toBe(45);
  });

  test("ignores entries outside the week or without an end time", () => {
    const activities: Activity[] = [
      {
        activity: "activity: piano",
        log: [
          {
            start: "2024-09-02T10:00:00Z",
            end: "2024-09-02T10:30:00Z",
          },
          {
            start: "2024-09-08T23:30:00Z",
            end: "2024-09-09T00:30:00Z",
          },
        ],
      },
      {
        activity: "activity: Reading",
        log: [
          {
            start: "2024-09-10T10:00:00Z",
            end: undefined,
          },
        ],
      },
    ];

    const totals = calculateWeeklyActivityDurations(
      activities,
      window.moment("2024-09-11"),
    );

    expect(totals.map((it) => it.activity)).toEqual([
      "activity: piano",
      "activity: Reading",
    ]);
    expect(
      totals.find((it) => it.activity === "activity: piano")?.duration.asMinutes(),
    ).toBe(30);
    expect(
      totals.find((it) => it.activity === "activity: Reading")?.duration.asMinutes(),
    ).toBe(0);
  });
});

describe("getWeekRangeFor", () => {
  test("returns a Monday to Sunday range for the given date", () => {
    const { start, end } = getWeekRangeFor(window.moment("2024-09-12"));

    expect(start.format("YYYY-MM-DD")).toBe("2024-09-09");
    expect(end.format("YYYY-MM-DD")).toBe("2024-09-16");
  });
});

describe("calculateDailyActivityDurations", () => {
  test("aggregates per-day durations and normalizes activity names", () => {
    const activities: Activity[] = [
      {
        activity: "Piano ",
        log: [
          {
            start: "2024-09-10T08:00:00Z",
            end: "2024-09-10T08:45:00Z",
          },
          {
            start: "2024-09-10T09:00:00Z",
            end: "2024-09-10T09:15:00Z",
          },
        ],
      },
      {
        activity: "piano",
        log: [
          {
            start: "2024-09-10T10:00:00Z",
            end: "2024-09-10T10:10:00Z",
          },
        ],
      },
      {
        activity: "Reading",
        log: [
          {
            start: "2024-09-10T11:00:00Z",
            end: "2024-09-10T11:30:00Z",
          },
        ],
      },
    ];

    const totals = calculateDailyActivityDurations(
      activities,
      window.moment("2024-09-10"),
    );

    expect(totals.map((it) => it.activity)).toEqual([
      "Piano",
      "Reading",
    ]);

    expect(
      totals.find((it) => it.activity === "Piano")?.duration.asMinutes(),
    ).toBe(70);
    expect(
      totals.find((it) => it.activity === "Reading")?.duration.asMinutes(),
    ).toBe(30);
  });
});

describe("formatDuration", () => {
  test("formats durations in hours and minutes", () => {
    expect(formatDuration(window.moment.duration(90, "minutes"))).toBe("1h 30m");
    expect(formatDuration(window.moment.duration(60, "minutes"))).toBe("1h");
    expect(formatDuration(window.moment.duration(45, "minutes"))).toBe("45m");
  });
});
