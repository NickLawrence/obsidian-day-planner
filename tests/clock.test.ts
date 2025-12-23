import { describe, expect, test } from "vitest";

import { createClockTaskFromActivity } from "../src/util/clock";

describe("createClockTaskFromActivity", () => {
  test("prefers linked task details when taskId matches", () => {
    const start = window.moment("2025-01-01T10:00:00");
    const end = window.moment("2025-01-01T11:30:00");

    const linkedTask = {
      id: "linked",
      taskId: "task-1",
      text: "Linked task",
      symbol: "-",
      status: " ",
      durationMinutes: 30,
      startTime: start,
      isAllDayEvent: false,
      location: {
        path: "path/to/file.md",
        position: {
          start: { line: 1, col: 0, offset: 0 },
          end: { line: 1, col: 10, offset: 10 },
        },
      },
    };

    const task = createClockTaskFromActivity({
      activity: {
        title: "Activity title",
        taskId: "task-1",
        location: linkedTask.location,
      },
      clockMoments: [start, end],
      tasksById: new Map([["task-1", linkedTask]]),
      defaultDurationMinutes: 15,
    });

    expect(task.text).toBe("Linked task");
    expect(task.location).toEqual(linkedTask.location);
    expect(task.durationMinutes).toBe(90);
  });

  test("falls back to activity data when taskId is missing", () => {
    const start = window.moment("2025-01-01T09:00:00");
    const end = window.moment("2025-01-01T10:00:00");

    const task = createClockTaskFromActivity({
      activity: {
        title: "Activity title",
        location: {
          path: "log.md",
          position: {
            start: { line: 5, col: 0, offset: 0 },
            end: { line: 7, col: 0, offset: 0 },
          },
        },
      },
      clockMoments: [start, end],
      tasksById: new Map(),
      defaultDurationMinutes: 15,
    });

    expect(task.text).toBe("Activity title");
    expect(task.location?.path).toBe("log.md");
    expect(task.durationMinutes).toBe(60);
  });
});
