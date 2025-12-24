import moment from "moment";
import { describe, expect, it } from "vitest";

import {
  extractActivityGoals,
  mergeActivityDurationsWithGoals,
} from "../src/util/weekly-activity-goals";

// Provide moment on the window object for the goal utilities
(globalThis as typeof globalThis & { moment: typeof moment }).moment = moment;
(window as typeof window & { moment: typeof moment }).moment = moment;

describe("extractActivityGoals", () => {
  it("extracts inline dataview goals under the heading regardless of level", () => {
    const markdown = `## Activity Goals\n[reading:: 3 hrs]\n[stretching::30 minutes]\n### Other heading\n[ignored:: 1h]`;

    const goals = extractActivityGoals(markdown);

    expect(goals).toHaveLength(2);
    expect(goals.map((it) => it.activity)).toEqual(["reading", "stretching"]);
    expect(goals[0].goal.asHours()).toBeCloseTo(3);
    expect(goals[1].goal.asMinutes()).toBeCloseTo(30);
  });

  it("stops at the next heading of the same or higher level", () => {
    const markdown = `# Activity Goals\n[reading:: 3 hrs]\n## Next section\n[reading:: 5 hrs]`;

    const goals = extractActivityGoals(markdown);

    expect(goals).toHaveLength(1);
    expect(goals[0].goal.asHours()).toBeCloseTo(3);
  });

  it("ignores invalid durations", () => {
    const markdown = `# Activity Goals\n[reading:: sometimes]\n[piano:: 1.5 hrs]`;

    const goals = extractActivityGoals(markdown);

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
