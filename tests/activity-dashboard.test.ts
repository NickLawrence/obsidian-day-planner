import type { App } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  buildActivityDashboard,
  buildActivityDashboards,
} from "../src/util/activity-dashboard";
import type { ActivityDefinition } from "../src/util/activity-definitions";
import {
  calculateActivityMainKeyProgress,
  getActivityDashboardEntries,
  getInProgressMainKeys,
} from "../src/util/activity-progress";
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
  it("keeps daily and item breakdowns consistent with priority-adjusted weekly totals", () => {
    const dashboards = buildActivityDashboards(
      [
        {
          activity: "read",
          read: { book: "Dune" },
          log: [{ start: "2026-08-24T23:30:00Z", end: "2026-08-25T01:30:00Z" }],
        },
        {
          activity: "read",
          read: { book: "Arrival" },
          log: [{ start: "2026-08-25T00:30:00Z", end: "2026-08-25T02:00:00Z" }],
        },
        {
          activity: "deep work",
          log: [{ start: "2026-08-25T00:00:00Z", end: "2026-08-25T01:00:00Z" }],
        },
      ] as Activity[],
      [
        readDefinition,
        { name: "deep work", label: "Deep Work", group: "work" },
      ],
      2026,
      { includeHistory: false },
    );
    const dashboard = dashboards.get("read")!;
    expect(
      dashboards
        .get("deep work")!
        .weeks.find(({ start }) => start === "2026-08-24")?.minutes,
    ).toBe(60);
    const week = dashboard.weeks.find(({ start }) => start === "2026-08-24")!;
    expect(week).toMatchObject({ minutes: 90, totalMinutes: 150 });
    expect(week.days[0]).toMatchObject({ minutes: 30 });
    expect(week.days[1]).toMatchObject({ minutes: 60, totalMinutes: 120 });
    expect(week.days[1].items).toEqual([
      { name: "Arrival", minutes: 30, totalMinutes: 90 },
      { name: "Dune", minutes: 30, totalMinutes: 90 },
    ]);
    expect(week.items).toEqual([
      { name: "Dune", minutes: 60, totalMinutes: 120 },
      { name: "Arrival", minutes: 30, totalMinutes: 90 },
    ]);
    expect(week.days.reduce((total, day) => total + day.minutes, 0)).toBe(
      week.minutes,
    );
    expect(week.items.reduce((total, item) => total + item.minutes, 0)).toBe(
      week.minutes,
    );
  });

  it("aggregates main-key tooltip breakdowns per day and week across midnight", () => {
    const dashboard = buildActivityDashboard(
      [
        {
          activity: "read",
          read: { book: "Dune" },
          log: [
            { start: "2026-08-24 10:00:00", end: "2026-08-24 10:30:00" },
            { start: "2026-08-24 23:30:00", end: "2026-08-25 00:30:00" },
          ],
        },
        {
          activity: "read",
          read: { book: "Arrival" },
          log: [{ start: "2026-08-24 11:00:00", end: "2026-08-24 11:15:00" }],
        },
        {
          activity: "read",
          log: [{ start: "2026-08-25 11:00:00", end: "2026-08-25 11:15:00" }],
        },
      ] as unknown as Activity[],
      readDefinition,
      2026,
    );
    const week = dashboard.weeks.find(({ start }) => start === "2026-08-24")!;
    expect(week.days[0].items).toEqual([
      { name: "Dune", minutes: 60 },
      { name: "Arrival", minutes: 15 },
    ]);
    expect(week.days[1].items).toEqual([
      { name: "Dune", minutes: 30 },
      { name: "(empty)", minutes: 15 },
    ]);
    expect(week.items).toEqual([
      { name: "Dune", minutes: 90 },
      { name: "(empty)", minutes: 15 },
      { name: "Arrival", minutes: 15 },
    ]);
    expect(week.items.reduce((total, item) => total + item.minutes, 0)).toBe(
      week.minutes,
    );
    expect(week.days[2].items).toEqual([]);
  });

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
    expect(week.days[0]).toMatchObject({
      date: "2026-08-24",
      minutes: 90,
      intensity: 1,
    });
    expect(week.days[1].minutes).toBe(30);
    expect(week.days[1].intensity).toBeCloseTo(1 / 3);
    expect(week.days[2]).toMatchObject({
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
    expect(sundayWeek.days[6]).toMatchObject({
      date: "2026-08-30",
      minutes: 30,
      intensity: 0.5,
    });
    expect(mondayWeek.days[0]).toMatchObject({
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
        rows: dashboard.rows,
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

  it("sorts groups and their logs by timestamp, including logs on the same day", () => {
    const activities = [
      {
        activity: "read",
        read: { book: "Older" },
        notes: "older",
        log: [{ start: "2026-08-24T22:00:00Z", end: "2026-08-25T04:00:00Z" }],
      },
      {
        activity: "read",
        read: { book: "Dune" },
        notes: "morning",
        log: [{ start: "2026-08-25T09:00:00Z", end: "2026-08-25T09:30:00Z" }],
      },
      {
        activity: "read",
        read: { book: "Newest" },
        notes: "newest",
        log: [{ start: "2026-08-25T20:00:00Z", end: "2026-08-25T20:15:00Z" }],
      },
      {
        activity: "read",
        read: { book: "Dune" },
        notes: "evening",
        log: [
          { start: "2026-08-25T18:00:00Z", end: "2026-08-25T18:30:00Z" },
          { start: "2026-08-25T19:00:00Z", end: "2026-08-25T19:30:00Z" },
        ],
      },
    ] as Activity[];
    const dashboard = buildActivityDashboard(activities, readDefinition, 2026);
    expect(dashboard.rows.map(({ notes }) => notes)).toEqual([
      "newest",
      "evening",
      "evening",
      "morning",
      "older",
    ]);
    expect(dashboard.groups.map(({ value }) => value)).toEqual([
      "Newest",
      "Dune",
      "Older",
    ]);
    expect(dashboard.groups[1].rows.map(({ start }) => start)).toEqual([
      Date.parse("2026-08-25T19:00:00Z"),
      Date.parse("2026-08-25T18:00:00Z"),
      Date.parse("2026-08-25T09:00:00Z"),
    ]);
    const ungrouped = buildActivityDashboard(activities, {
      ...readDefinition,
      attributes: undefined,
    });
    expect(ungrouped.groups).toEqual([]);
    expect(ungrouped.rows.map(({ start }) => start)).toEqual(
      dashboard.rows.map(({ start }) => start),
    );
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
  it("shares progress calculations while merging overlapping logs across resource aliases", () => {
    const file = { path: "Books/Dune.md", basename: "Dune", name: "Dune.md" };
    const app = {
      vault: { getMarkdownFiles: () => [file] },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            tags: ["book"],
            aliases: ["Dune alias"],
            status: "in progress",
          },
        }),
      },
    } as unknown as App;
    const progress = getInProgressMainKeys(
      app,
      [
        {
          activity: "read",
          read: { book: "Dune" },
          log: [{ start: "2026-08-25 09:00:00", end: "2026-08-25 11:00:00" }],
        },
        {
          activity: "read",
          read: { book: "Dune alias" },
          log: [{ start: "2026-08-25 10:00:00", end: "2026-08-25 12:00:00" }],
        },
        {
          activity: "deep work",
          log: [{ start: "2026-08-25 10:30:00", end: "2026-08-25 11:30:00" }],
        },
      ] as Activity[],
      readDefinition,
    );
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      value: "Dune",
      minutes: 180,
      countedMinutes: 120,
      filePath: file.path,
    });
  });

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

describe("getActivityDashboardEntries", () => {
  function resourceApp() {
    const resources = [
      {
        path: "Books/Dune.md",
        basename: "Dune",
        frontmatter: {
          tags: ["book"],
          aliases: ["Dune alias"],
          status: "complete",
          pages: 400,
          cover: "[[../Images/dune.png]]",
        },
      },
      {
        path: "Books/New.md",
        basename: "New",
        frontmatter: { tags: ["book"], status: "in progress", pages: 100 },
      },
      {
        path: "Books/Backlog.md",
        basename: "Backlog",
        frontmatter: { tags: ["book"], status: "backlog" },
      },
    ];
    return {
      vault: {
        getMarkdownFiles: () => resources,
        getResourcePath: (file: { path: string }) => `app://vault/${file.path}`,
      },
      metadataCache: {
        getFileCache: (file: { path: string }) =>
          resources.find(({ path }) => path === file.path),
        getFirstLinkpathDest: (link: string, source: string) =>
          link === "../Images/dune.png" && source === "Books/Dune.md"
            ? { path: "Images/dune.png" }
            : null,
      },
    } as unknown as App;
  }
  const definition = {
    ...readDefinition,
    attributes: {
      ...readDefinition.attributes!,
      start: [
        {
          key: "book",
          label: "Book",
          type: "text" as const,
          resourceTag: "book",
        },
      ],
    },
  };

  it("merges resource aliases, preserves historical and in-progress entries, covers, progress and overlapping totals", () => {
    const activities = [
      {
        activity: "read",
        read: { book: "Dune", "start-page": 1, "end-page": 50 },
        notes: "first",
        log: [{ start: "2026-08-25T09:00:00Z", end: "2026-08-25T11:00:00Z" }],
      },
      {
        activity: "read",
        read: { book: "Dune alias", "start-page": 51, "end-page": 100 },
        notes: "second",
        log: [{ start: "2026-08-25T10:00:00Z", end: "2026-08-25T12:00:00Z" }],
      },
      {
        activity: "deep work",
        log: [{ start: "2026-08-25T10:30:00Z", end: "2026-08-25T11:30:00Z" }],
      },
      {
        activity: "read",
        read: { book: "No page" },
        log: [{ start: "2026-08-26T09:00:00Z", end: "2026-08-26T09:30:00Z" }],
      },
      {
        activity: "read",
        log: [{ start: "2026-08-24T09:00:00Z", end: "2026-08-24T09:30:00Z" }],
      },
    ] as Activity[];
    const dashboard = buildActivityDashboard(activities, definition, 2026);
    const entries = getActivityDashboardEntries(
      resourceApp(),
      activities,
      definition,
      dashboard.groups,
    );
    expect(entries.map(({ value }) => value)).toEqual([
      "No page",
      "Dune",
      "(empty)",
      "New",
    ]);
    expect(entries[1]).toMatchObject({
      value: "Dune",
      minutes: 180,
      countedMinutes: 120,
      percent: 25,
      current: 100,
      maximum: 400,
      earliest: "2026-08-25",
      latest: "2026-08-25",
      inProgress: false,
      filePath: "Books/Dune.md",
      cover: "app://vault/Images/dune.png",
    });
    expect(entries[1].rows.map(({ notes }) => notes)).toEqual([
      "second",
      "first",
    ]);
    expect(entries[3]).toMatchObject({
      value: "New",
      inProgress: true,
      minutes: 0,
      percent: 0,
      rows: [],
    });
    expect(entries[0].cover).toBeUndefined();
  });

  it("keeps an unlinked main key with only an open clock visible", () => {
    const activities = [
      {
        activity: "read",
        read: { book: "Unlinked" },
        log: [{ start: "2026-08-25T09:00:00Z" }],
      },
    ] as Activity[];
    const now = window.moment("2026-08-25T10:00:00Z");
    const entries = getActivityDashboardEntries(
      resourceApp(),
      activities,
      definition,
      [],
      now,
    );
    expect(entries.find(({ value }) => value === "Unlinked")).toMatchObject({
      minutes: 60,
      rows: [],
    });
    expect(
      getActivityDashboardEntries(
        resourceApp(),
        activities,
        { ...definition, attributes: undefined },
        [],
        now,
      ),
    ).toEqual([]);
  });
});
