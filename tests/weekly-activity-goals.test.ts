import { Duration } from "luxon";
import moment from "moment";
import type { App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  extractActivityGoals,
  extractActivityPlanEntries,
  mergeActivityDurationsWithGoals,
  upsertActivityPlanEntryInMarkdown,
} from "../src/util/weekly-activity-goals";

// Provide moment on the window object for the goal utilities
(globalThis as typeof globalThis & { moment: typeof moment }).moment = moment;
(window as typeof window & { moment: typeof moment }).moment = moment;

function createDataviewApp(lists: unknown[]) {
  return {
    plugins: {
      plugins: {
        dataview: {
          api: {
            index: { initialized: true },
            page: () => ({ file: { lists } }),
            func: {
              meta: (link: unknown) =>
                link && typeof link === "object"
                  ? { subpath: (link as { subpath?: string }).subpath }
                  : {},
            },
          },
        },
      },
    },
  } as unknown as App;
}

const weeklyFile = { path: "Weekly/2026-W20.md" } as TFile;
const activityGoalsSection = { subpath: "Activity Goals" };
const otherSection = { subpath: "Other" };

describe("extractActivityGoals", () => {
  it("extracts Dataview list item goals under the Activity Goals heading", () => {
    const app = createDataviewApp([
      {
        fields: new Map<string, unknown>([
          ["activity", "reading"],
          ["goal", Duration.fromObject({ hours: 3 })],
        ]),
        section: activityGoalsSection,
      },
      {
        fields: new Map<string, unknown>([
          ["activity", "stretching"],
          ["goal", Duration.fromObject({ minutes: 30 })],
        ]),
        section: activityGoalsSection,
      },
      {
        fields: new Map<string, unknown>([
          ["activity", "ignored"],
          ["goal", Duration.fromObject({ hours: 1 })],
        ]),
        section: otherSection,
      },
    ]);

    const goals = extractActivityGoals(app, weeklyFile);

    expect(goals).toHaveLength(2);
    expect(goals.map((it) => it.activity)).toEqual(["reading", "stretching"]);
    expect(goals[0].goal.asHours()).toBeCloseTo(3);
    expect(goals[1].goal.asMinutes()).toBeCloseTo(30);
  });

  it("ignores estimates when extracting goals", () => {
    const app = createDataviewApp([
      {
        fields: new Map<string, unknown>([
          ["activity", "reading"],
          ["estimate", Duration.fromObject({ hours: 3 })],
        ]),
        section: activityGoalsSection,
      },
      {
        fields: new Map<string, unknown>([
          ["activity", "piano"],
          ["goal", Duration.fromObject({ hours: 1.5 })],
        ]),
        section: activityGoalsSection,
      },
    ]);

    const goals = extractActivityGoals(app, weeklyFile);

    expect(goals).toHaveLength(1);
    expect(goals[0].activity).toBe("piano");
    expect(goals[0].goal.asMinutes()).toBeCloseTo(90);
  });
});

describe("mergeActivityDurationsWithGoals", () => {
  it("attaches goals to matching activity totals", () => {
    const merged = mergeActivityDurationsWithGoals(
      [
        { activity: "Reading", duration: moment.duration(120, "minutes") },
        { activity: "Piano", duration: moment.duration(20, "minutes") },
      ],
      [
        { activity: "reading", goal: moment.duration(3, "hours") },
        { activity: "stretching", goal: moment.duration(30, "minutes") },
      ],
    );

    const reading = merged.find((it) => it.activity === "Reading");
    const piano = merged.find((it) => it.activity === "Piano");
    const stretching = merged.find((it) => it.activity === "stretching");

    expect(reading?.goal?.asHours()).toBeCloseTo(3);
    expect(piano?.goal).toBeUndefined();
    expect(stretching?.duration.asMinutes()).toBe(0);
  });
});

describe("activity plan entries", () => {
  it("extracts goals and estimates from Dataview list items", () => {
    const app = createDataviewApp([
      {
        fields: new Map<string, unknown>([
          ["activity", "piano"],
          ["goal", Duration.fromObject({ minutes: 180 })],
        ]),
        position: { start: { line: 1 } },
        section: activityGoalsSection,
      },
      {
        fields: new Map<string, unknown>([
          ["activity", "bed"],
          ["estimate", Duration.fromObject({ hours: 56 })],
        ]),
        position: { start: { line: 2 } },
        section: activityGoalsSection,
      },
      {
        fields: new Map<string, unknown>([
          ["activity", "ignored"],
          ["goal", Duration.fromObject({ hours: 1 })],
        ]),
        section: otherSection,
      },
    ]);

    const entries = extractActivityPlanEntries(app, weeklyFile);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      activity: "piano",
      kind: "goal",
      sourceLine: 1,
    });
    expect(entries[0].duration.asMinutes()).toBeCloseTo(180);
    expect(entries[1]).toMatchObject({
      activity: "bed",
      kind: "estimate",
      sourceLine: 2,
    });
    expect(entries[1].duration.asHours()).toBeCloseTo(56);
  });

  it("upserts an activity as a goal or estimate under Activity Goals", () => {
    const markdown = `Intro

# Activity Goals
- (activity:: piano) (goal:: 180 mins)

# Next`;

    const updatedGoal = upsertActivityPlanEntryInMarkdown(markdown, {
      activity: "piano",
      kind: "estimate",
      duration: moment.duration(4, "hours"),
      sourceLine: 3,
    });
    const insertedEstimate = upsertActivityPlanEntryInMarkdown(
      updatedGoal.markdown,
      {
        activity: "bed",
        kind: "estimate",
        duration: moment.duration(56, "hours"),
      },
    );

    expect(insertedEstimate.markdown).toContain(
      "- (activity:: piano) (estimate:: 240 mins)",
    );
    expect(insertedEstimate.markdown).toContain(
      "- (activity:: bed) (estimate:: 3360 mins)\n# Next",
    );
    expect(updatedGoal.lineIndex).toBe(3);
    expect(insertedEstimate.lineIndex).toBe(5);
  });
});
