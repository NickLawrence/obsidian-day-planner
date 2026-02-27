import { describe, expect, test, vi, afterEach } from "vitest";

import { upsertActivitiesBlock } from "../src/util/activities-file";
import { addOpenClock } from "../src/util/props";

vi.mock("obsidian", async () => {
  const yaml = await import("js-yaml");

  return {
    parseYaml: yaml.load,
    stringifyYaml: yaml.dump,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("upsertActivitiesBlock", () => {
  test("adds activities under a dedicated heading", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T10:00:00Z"));

    const result = upsertActivitiesBlock({
      fileText: "- [ ] Task\n",
      updateFn: (props) =>
        addOpenClock(props, {
          taskId: "task-123",
          activityName: "Task",
        }),
    });

    expect(result).toContain("# Activities");
    expect(result).toContain("taskIds:");
    expect(result).toContain("- task-123");
    expect(result).toContain("activity: task");
    expect(result).toContain("- [ ] Task");
    expect(result).not.toContain("text:");
    expect(result).toMatch(/start:\s*'?\d{4}-\d{2}-\d{2}/);
  });
});
