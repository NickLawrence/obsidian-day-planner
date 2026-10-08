import moment from "moment";
import { describe, expect, it } from "vitest";

import { activityYaml } from "../mobile/src/lib/activity-files";
import { addHorizontalPlacing } from "../src/overlap/overlap";
import {
  createActivityRecord,
  readStoredActivities,
} from "../src/shared/activity";
import { buildActivityDayTimeline } from "../src/shared/activity-timeline";
import { getActivityBlockColors } from "../src/util/color";

const day = "2026-10-07";
const now = moment(`${day} 14:30:00`).valueOf();
function timeline(
  records: ReturnType<typeof createActivityRecord>[],
  selectedDay = day,
) {
  return buildActivityDayTimeline(
    readStoredActivities(
      [
        [
          "_Planner/activities/2026/2026-W41.yaml",
          activityYaml.stringify({ activities: records }),
        ],
      ],
      activityYaml,
    ),
    selectedDay,
    now,
    true,
  );
}
function closed(name: string, start: string, end: string) {
  return { ...createActivityRecord(name, {}, start), log: [{ start, end }] };
}

describe("shared activity day timeline", () => {
  it("includes every hour and preserves empty gaps in the day", () => {
    const view = timeline([]);
    expect(view.hours.map(({ label }) => label)).toEqual(
      Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
    );
    expect(view.minutes).toBe(1440);
    expect(view.nowMinute).toBe(870);
    expect(view.blocks).toEqual([]);
  });

  it("matches plugin labels, colors, duration, quality and notes", () => {
    const record = createActivityRecord(
      "read",
      { book: "Shared book", "start-page": 1 },
      `${day} 09:30:00`,
    );
    record.log![0].end = `${day} 11:00:00`;
    record.quality = 8;
    record.notes = "Notes from Obsidian";
    const [block] = timeline([record]).blocks;
    expect(block).toMatchObject({
      title: "📖 Read - Shared book",
      startMinute: 570,
      endMinute: 660,
      durationLabel: "1h 30m",
      qualityLabel: "8 😄",
      notes: record.notes,
      active: false,
      ...getActivityBlockColors("read", true),
    });
  });

  it("keeps duplicate task IDs and all log entries, using the plugin's overlap algorithm", () => {
    const one = closed("walk", `${day} 10:00:00`, `${day} 11:00:00`);
    one.taskIds = ["same"];
    one.log!.push({ start: `${day} 16:00:00`, end: `${day} 17:00:00` });
    const two = {
      ...one,
      log: [{ start: `${day} 10:00:00`, end: `${day} 11:00:00` }],
    };
    const view = timeline([one, two]);
    expect(view.blocks).toHaveLength(3);
    expect(new Set(view.blocks.map(({ id }) => id)).size).toBe(3);
    const expected = addHorizontalPlacing(
      view.blocks.map((block) => ({
        ...block,
        startTime: moment(day).add(block.startMinute, "minutes"),
        isAllDayEvent: false,
      })),
    );
    expect(view.blocks.map(({ placing }) => placing)).toEqual(
      expected.map(({ placing }) => placing),
    );
    expect(view.blocks[0].placing.spanPercent).toBe(50);
    expect(view.blocks[2].placing.offsetPercent).toBe(50);
    expect(view.blocks[1].placing.spanPercent).toBe(100);
  });

  it("clips overnight logs and extends open activities to the current time", () => {
    const overnight = closed("sleep", "2026-10-06 23:00:00", `${day} 07:00:00`);
    const current = createActivityRecord("walk", {}, `${day} 14:00:00`);
    const nextNight = closed("sleep", `${day} 23:00:00`, "2026-10-08 07:00:00");
    const view = timeline([overnight, current, nextNight]);
    expect(view.blocks).toHaveLength(3);
    expect(view.blocks[0]).toMatchObject({
      startMinute: 0,
      endMinute: 420,
      continuesBefore: true,
      durationLabel: "7h",
    });
    expect(view.blocks[1]).toMatchObject({
      startMinute: 840,
      endMinute: 870,
      active: true,
    });
    expect(view.blocks[2]).toMatchObject({
      startMinute: 1380,
      endMinute: 1440,
      continuesAfter: true,
    });
  });

  it("finds later logs retained in an earlier weekly file and ignores other days", () => {
    const record = closed("walk", "2026-09-29 10:00:00", "2026-09-29 11:00:00");
    record.log!.push({ start: `${day} 08:00:00`, end: `${day} 08:45:00` });
    const rows = readStoredActivities(
      [
        [
          "_Planner/activities/2026/2026-W40.yaml",
          activityYaml.stringify([record]),
        ],
      ],
      activityYaml,
    );
    const view = buildActivityDayTimeline(rows, day, now);
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({ startMinute: 480, endMinute: 525 });
    expect(
      buildActivityDayTimeline(rows, "2026-10-09", now).nowMinute,
    ).toBeNull();
  });

  it("includes the complete local day on daylight-saving transitions", () => {
    for (const selectedDay of ["2026-03-08", "2026-11-01"]) {
      const midnight = moment(selectedDay);
      const next = midnight.clone().add(1, "day");
      const record = closed(
        "sleep",
        midnight.format("YYYY-MM-DD HH:mm:ss"),
        next.format("YYYY-MM-DD HH:mm:ss"),
      );
      const view = timeline([record], selectedDay);
      const dayMinutes = next.diff(midnight, "minutes");
      expect(view.minutes).toBe(dayMinutes);
      expect(view.hours).toHaveLength(Math.ceil(dayMinutes / 60));
      expect(view.blocks[0].endMinute).toBe(dayMinutes);
      expect(view.hours.at(-1)!.endMinute).toBe(dayMinutes);
    }
  });
});
