import { afterEach, describe, expect, test, vi } from "vitest";

import { cancelOpenClockByActivityIndex, clockOut } from "../src/util/props";

vi.mock("obsidian", async () => {
  const yaml = await import("js-yaml");

  return {
    stringifyYaml: yaml.dump,
    parseYaml: yaml.load,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("clockOut", () => {
  test("appends finish modal notes to existing activity notes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));

    const result = clockOut(
      {
        activities: [
          {
            activity: "work",
            notes: "Already had notes",
            log: [{ start: "2026-01-01T10:00:00Z" }],
          },
        ],
      },
      0,
      { notes: "Added on clock out" },
    );

    expect(result.activities?.[0].notes).toBe(
      "Already had notes\nAdded on clock out",
    );
  });
});

describe("cancelOpenClockByActivityIndex", () => {
  test("removes an open clock by index without needing task ids", () => {
    const result = cancelOpenClockByActivityIndex(
      {
        activities: [
          {
            activity: "work",
            taskIds: [],
            log: [
              { start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z" },
            ],
          },
          {
            activity: "focus",
            taskIds: [],
            log: [{ start: "2026-01-01T12:00:00Z" }],
          },
        ],
      },
      1,
    );

    expect(result.activities?.[1].log).toEqual([]);
  });
});
