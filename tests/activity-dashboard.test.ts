import { describe, expect, it } from "vitest";

import { buildActivityDashboard } from "../src/util/activity-dashboard";
import type { ActivityDefinition } from "../src/util/activity-definitions";
import { calculateActivityMainKeyProgress } from "../src/util/activity-progress";
import type { Activity } from "../src/util/props";

const readDefinition: ActivityDefinition = {
  name: "read",
  label: "Read",
  group: "media",
  emoji: "📖",
  attributes: {
    key: "read",
    mainKey: "book",
    start: [
      { key: "book", label: "Book", type: "text" },
      { key: "start-page", label: "Start page", type: "number" },
    ],
    end: [{ key: "end-page", label: "End page", type: "number" }],
    ranges: [{ key: "pages", start: "start-page", end: "end-page" }],
  },
};

describe("buildActivityDashboard", () => {
  it("aggregates daily time and scales daily shading independently of weekly totals", () => {
    const dashboard = buildActivityDashboard(
      [
        {
          activity: "read",
          log: [
            { start: "2026-08-24 10:00:00", end: "2026-08-24 11:00:00" },
            { start: "2026-08-24 12:00:00", end: "2026-08-24 12:30:00" },
            { start: "2026-08-25 10:00:00", end: "2026-08-25 10:30:00" },
            { start: "2026-08-26 10:00:00" },
          ],
        },
        {
          activity: "piano",
          log: [{ start: "2026-08-26 10:00:00", end: "2026-08-26 12:00:00" }],
        },
      ] as Activity[],
      readDefinition,
      2026,
    );
    const week = dashboard.weeks.find(({ start }) => start === "2026-08-24")!;
    expect(week.days).toHaveLength(7);
    expect(week.days[0]).toEqual({
      date: "2026-08-24",
      minutes: 90,
      intensity: 1,
    });
    expect(week.days[1].minutes).toBe(30);
    expect(week.days[1].intensity).toBeCloseTo(1 / 3);
    expect(week.days[2]).toEqual({
      date: "2026-08-26",
      minutes: 0,
      intensity: 0,
    });
    expect(week.minutes).toBe(120);
    expect(week.days[6].date).toBe("2026-08-30");
  });

  it("splits overnight logs at midnight and across week boundaries", () => {
    const dashboard = buildActivityDashboard(
      [
        {
          activity: "read",
          log: [{ start: "2026-08-30 23:30:00", end: "2026-08-31 01:00:00" }],
        },
      ] as Activity[],
      readDefinition,
      2026,
    );
    const sundayWeek = dashboard.weeks.find(
      ({ start }) => start === "2026-08-24",
    )!;
    const mondayWeek = dashboard.weeks.find(
      ({ start }) => start === "2026-08-31",
    )!;
    expect(sundayWeek.days[6]).toEqual({
      date: "2026-08-30",
      minutes: 30,
      intensity: 0.5,
    });
    expect(mondayWeek.days[0]).toEqual({
      date: "2026-08-31",
      minutes: 60,
      intensity: 1,
    });
    expect(sundayWeek.minutes).toBe(30);
    expect(mondayWeek.minutes).toBe(60);
  });

  it("provides empty daily squares across the year boundary without invalid intensities", () => {
    const dashboard = buildActivityDashboard([], readDefinition, 2026);
    expect(dashboard.weeks[0].days[0].date).toBe("2025-12-29");
    expect(dashboard.weeks[0].days[6].date).toBe("2026-01-04");
    expect(dashboard.weeks.flatMap(({ days }) => days)).toHaveLength(364);
    expect(
      dashboard.weeks.every(({ days }) =>
        days.every(
          ({ minutes, intensity }) => minutes === 0 && intensity === 0,
        ),
      ),
    ).toBe(true);
  });

  it("creates log rows and aggregates closed logs by the main key", () => {
    const dashboard = buildActivityDashboard(
      [
        {
          activity: "Read",
          taskIds: [],
          notes: "A chapter",
          quality: 4,
          read: { book: "Dune", "start-page": 10, "end-page": 39 },
          log: [
            {
              start: "2026-08-25 10:00:00",
              end: "2026-08-25 11:30:00",
            },
            {
              start: "2026-08-26T10:00:00Z",
              end: "2026-08-26T10:30:00Z",
            },
            { start: "2026-08-27 10:00:00" },
          ],
        },
      ] as unknown as Activity[],
      readDefinition,
    );

    expect(dashboard.rows).toHaveLength(2);
    expect(dashboard.rows[0]).toMatchObject({
      day: "2026-08-26",
      minutes: 30,
      rangeValues: [30],
      rangeValuesPerHour: [60],
    });
    expect(dashboard.groups).toEqual([
      {
        value: "Dune",
        minutes: 120,
        earliest: "2026-08-25",
        latest: "2026-08-26",
      },
    ]);
    expect(dashboard.weeks).toHaveLength(52);
    expect(
      dashboard.weeks.find(({ start }) => start === "2026-08-24"),
    ).toMatchObject({
      month: "Aug",
      minutes: 120,
      intensity: 1,
    });
  });

  it("labels a week with the month containing at least four of its days", () => {
    const dashboard = buildActivityDashboard([], readDefinition, 2026);

    expect(dashboard.weeks[0]).toMatchObject({
      start: "2025-12-29",
      end: "2026-01-04",
      month: "Jan",
      minutes: 0,
      intensity: 0,
    });
    expect(dashboard.weeks).toHaveLength(52);
  });
});

describe("calculateActivityMainKeyProgress", () => {
  it("calculates completion, pace, and estimated remaining time", () => {
    const progress = calculateActivityMainKeyProgress({
      activities: [
        {
          activity: "Read",
          read: { book: "Dune", "start-page": 1, "end-page": 60 },
          log: [{ start: "2026-08-25 10:00:00", end: "2026-08-25 11:00:00" }],
        },
        {
          activity: "Read",
          read: { book: "Dune", "start-page": 61, "end-page": 100 },
          log: [{ start: "2026-08-26 10:00:00", end: "2026-08-26 11:00:00" }],
        },
      ] as unknown as Activity[],
      definition: readDefinition,
      value: "Dune",
      rangeMaximums: { pages: 400 },
    });

    expect(progress).toMatchObject({
      minutes: 120,
      rangeKey: "pages",
      current: 100,
      maximum: 400,
      percent: 25,
      minutesPerUnit: 1.2,
      estimatedMinutesRemaining: 360,
    });
  });

  it("returns time spent when no range maximum is available", () => {
    expect(
      calculateActivityMainKeyProgress({
        activities: [
          {
            activity: "Read",
            read: { book: "Dune", "start-page": 1, "end-page": 10 },
            log: [
              {
                start: "2026-08-25 10:00:00",
                end: "2026-08-25 10:30:00",
              },
            ],
          },
        ] as unknown as Activity[],
        definition: readDefinition,
        value: "Dune",
      }),
    ).toEqual({ value: "Dune", minutes: 30 });
  });
});
