import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseActivityFile,
  serializeActivityWeeks,
  parseResourceFile,
  resourceOptions,
} from "../mobile/src/lib/activity-files";
import {
  getActivityDefinitions,
  getActivityAttributeFields,
  buildActivityAttributeUpdate,
} from "../src/util/activity-definitions";
import { propsSchema } from "../src/util/activity-schema";
import {
  getActivitySuggestionsWithHistory,
  filterActivitySuggestions,
} from "../src/util/activity-suggestions";
import {
  createActivityRecord,
  finishActivityRecord,
  getActivityFinishFields,
  parseActivityValues,
  buildActivityFinishUpdate,
} from "../src/util/activity-workflow";
import { startActivityLog, clockOut } from "../src/util/props";

describe("mobile activity compatibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 6, 10, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("shows the complete plugin catalogue in the same order", () => {
    expect(
      filterActivitySuggestions(getActivitySuggestionsWithHistory([]), "").map(
        ({ activityName }) => activityName,
      ),
    ).toEqual(getActivityDefinitions().map(({ name }) => name));
  });

  it.each(getActivityDefinitions().map(({ name }) => [name]))(
    "starts and finishes %s with the plugin's exact records",
    (name) => {
      const startFields = getActivityAttributeFields(name, "start");
      const values = parseActivityValues(
        startFields,
        Object.fromEntries(
          startFields.map((field) => [
            field.key,
            field.type === "number" ? String(field.min ?? 1) : "Example",
          ]),
        ),
      );
      const mobileStart = createActivityRecord(name, values);
      const pluginStart = propsSchema.parse(
        startActivityLog({}, name, buildActivityAttributeUpdate(name, values)),
      ).activities![0];
      expect(mobileStart).toEqual(pluginStart);
      const finishFields = getActivityFinishFields(name);
      expect(finishFields.slice(-2).map(({ key }) => key)).toEqual([
        "quality",
        "notes",
      ]);
      const endValues = parseActivityValues(
        finishFields,
        Object.fromEntries(
          finishFields.map((field) => [
            field.key,
            field.type === "number" ? "7" : "Finished notes",
          ]),
        ),
      );
      vi.advanceTimersByTime(300000);
      const mobileEnd = finishActivityRecord(mobileStart, endValues);
      const pluginEnd = propsSchema.parse(
        clockOut(
          { activities: [pluginStart] },
          0,
          buildActivityFinishUpdate(name, endValues),
        ),
      ).activities![0];
      expect(mobileEnd).toEqual(pluginEnd);
      const [{ contents }] = serializeActivityWeeks([
        { id: "test", record: mobileEnd },
      ]);
      expect(parseActivityFile(contents)).toEqual([pluginEnd]);
    },
  );

  it("keeps the typed activity first and normalizes history search", () => {
    const record = finishActivityRecord(
      createActivityRecord("read", { book: "Example book", "start-page": 1 }),
      { "end-page": 25 },
    );
    const suggestions = filterActivitySuggestions(
      getActivitySuggestionsWithHistory([record]),
      "  EXAMPLE   book  ",
    );
    expect(suggestions[0].activityName).toBe("  EXAMPLE   book  ");
    expect(suggestions[1]).toMatchObject({
      activityName: "read",
      initialValues: { book: "Example book", "start-page": 26 },
    });
  });

  it("honors TV's ten-item limit, other activities' five-item limit and movie history suppression", () => {
    const records = Array.from({ length: 12 }, (_, index) => [
      createActivityRecord("tv", { name: `Show ${index}`, episodes: "1" }),
      createActivityRecord("game", { name: `Game ${index}` }),
      createActivityRecord("movie", { name: `Movie ${index}` }),
    ]).flat();
    const suggestions = getActivitySuggestionsWithHistory(records);
    expect(
      suggestions.filter(({ activityName }) => activityName === "tv"),
    ).toHaveLength(11);
    expect(
      suggestions.filter(({ activityName }) => activityName === "game"),
    ).toHaveLength(6);
    expect(
      suggestions.filter(({ activityName }) => activityName === "movie"),
    ).toHaveLength(1);
  });

  it("uses identical required-field validation and leaves optional finish values absent", () => {
    expect(() =>
      parseActivityValues(getActivityAttributeFields("read", "start"), {
        book: "Book",
      }),
    ).toThrow("Start page is required.");
    expect(() =>
      parseActivityValues(getActivityFinishFields("read"), {}),
    ).toThrow("End page is required.");
    expect(() =>
      parseActivityValues(getActivityFinishFields("walk"), { quality: "11" }),
    ).toThrow("Quality (1-10) must be at most 10.");
    const values = parseActivityValues(getActivityFinishFields("walk"), {
      notes: "  ",
      quality: "",
    });
    expect(buildActivityFinishUpdate("walk", values)).toEqual({});
  });

  it("appends finish notes to inline notes and preserves start attributes and task links", () => {
    const start = {
      ...createActivityRecord("read", { book: "Book", "start-page": 1 }),
      notes: "Inline note",
      taskIds: ["task-1"],
      custom: { preserved: true },
    };
    const end = finishActivityRecord(start, {
      "end-page": 5,
      notes: "Finish note",
      quality: 8,
    });
    expect(end).toMatchObject({
      read: { book: "Book", "start-page": 1, "end-page": 5 },
      notes: "Inline note\nFinish note",
      taskIds: ["task-1"],
      custom: { preserved: true },
    });
    expect(
      parseActivityFile(
        serializeActivityWeeks([{ id: "read", record: end }])[0].contents,
      ),
    ).toEqual([end]);
  });

  it("exports by the earliest log's ISO week year, including New Year and multiple logs", () => {
    const record = {
      ...createActivityRecord("walk", {}),
      log: [
        { start: "2026-01-04 23:00:00", end: "2026-01-05 01:00:00" },
        { start: "2025-12-29 10:00:00", end: "2025-12-29 11:00:00" },
      ],
    };
    expect(serializeActivityWeeks([{ id: "walk", record }])[0].filename).toBe(
      "2026-W01.yaml",
    );
  });

  it("accepts plugin legacy YAML shapes and rejects malformed records before import", () => {
    const raw = "- activity: walk\n  log:\n    - start: 2026-10-06 10:00:00\n";
    expect(parseActivityFile(raw)[0]).toMatchObject({
      activity: "walk",
    });
    expect(
      parseActivityFile(
        "planner:\n  log:\n    - start: 2026-10-06 10:00:00\n",
      )[0].activity,
    ).toBe("Activity");
    expect(() =>
      parseActivityFile("activities:\n  - activity: read\n    log: []\n"),
    ).toThrow();
    expect(() =>
      parseActivityFile(
        "activities:\n  - activity: walk\n    log:\n      - start: definitely-invalid\n",
      ),
    ).toThrow();
  });

  it("suggests tagged resource names, removes completed resources and ignores code tags", () => {
    const resources = [
      parseResourceFile("Zulu.md", "---\ntags: [book]\n---\n"),
      parseResourceFile("Alpha.md", "#book"),
      parseResourceFile(
        "Finished.md",
        "---\ntag: '#book'\nstatus: COMPLETE\n---\n",
      ),
      parseResourceFile("Code.md", "```text\n#book\n```"),
    ];
    expect(
      resourceOptions(getActivityAttributeFields("read", "start"), resources),
    ).toEqual({ book: ["Alpha", "Zulu"] });
  });
});
