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
