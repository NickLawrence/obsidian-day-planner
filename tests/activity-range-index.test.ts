import { afterEach, describe, expect, test, vi } from "vitest";

import {
  calculateDailyActivityDisplayDurations,
  calculateWeeklyActivityDurations,
} from "../src/util/activity-log-summary";
import { createActivityRangeIndex } from "../src/util/activity-range-index";
import type { Activity } from "../src/util/props";

afterEach(() => vi.useRealTimers());

describe("calendar activity range index", () => {
  test("preserves totals for spanning logs, multiple logs, details and open clocks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const activities: Activity[] = [
      {
        activity: "reading",
        taskIds: [],
        details: { book: "Book" },
        log: [
          { start: "2025-01-01T10:00:00Z", end: "2025-01-01T11:00:00Z" },
          { start: "2026-09-27T23:00:00Z", end: "2026-09-29T02:00:00Z" },
          { start: "2026-10-01T10:00:00Z", end: "2026-10-01T11:00:00Z" },
        ],
      },
      {
        activity: "work",
        taskIds: [],
        log: [{ start: "2026-10-01T23:00:00Z" }],
      },
    ];
    const start = window.moment("2026-09-28").startOf("isoWeek");
    const end = start.clone().add(1, "week");
    const selected = createActivityRangeIndex(activities)(start, end);
    expect(selected[0].log).toHaveLength(2);
    expect(selected[0].details).toEqual(activities[0].details);
    expect(calculateWeeklyActivityDurations(selected, start)).toEqual(
      calculateWeeklyActivityDurations(activities, start),
    );
    for (let offset = 0; offset < 7; offset++) {
      const day = start.clone().add(offset, "day");
      expect(calculateDailyActivityDisplayDurations(selected, day)).toEqual(
        calculateDailyActivityDisplayDurations(activities, day),
      );
    }
    expect(activities[0].log).toHaveLength(3);
  });

  test("excludes non-overlapping, invalid and reversed entries", () => {
    const start = window.moment("2026-10-01T00:00:00Z");
    const end = start.clone().add(1, "day");
    const query = createActivityRangeIndex([
      {
        activity: "work",
        taskIds: [],
        log: [
          { start: "2026-09-30T23:00:00Z", end: start.toISOString() },
          { start: end.toISOString(), end: "2026-10-02T01:00:00Z" },
          { start: "invalid", end: end.toISOString() },
          { start: start.toISOString(), end: "invalid" },
          { start: "2026-10-01T12:00:00Z", end: start.toISOString() },
        ],
      },
    ]);
    expect(query(start, end)).toEqual([]);
  });

  test("uses the current time when querying an ongoing clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T23:00:00Z"));
    const query = createActivityRangeIndex([
      {
        activity: "work",
        taskIds: [],
        log: [{ start: "2026-09-30T22:00:00Z" }],
      },
    ]);
    const start = window.moment("2026-10-01T00:00:00Z");
    const end = start.clone().add(1, "day");
    expect(query(start, end)).toEqual([]);
    vi.setSystemTime(new Date("2026-10-01T01:00:00Z"));
    expect(query(start, end)).toHaveLength(1);
  });
});
