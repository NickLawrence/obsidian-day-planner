import moment from "moment";

import { defaultDurationMinutes } from "../constants";
import { addHorizontalPlacing } from "../overlap/overlap";

import { getActivityDisplayLabel } from "./activity-definitions";
import { getActivityQualityLabel } from "./activity-presentation";
import type { StoredActivity } from "./activity-repository";
import { parseActivityTimestamp } from "./activity-time";
import { getActivityBlockColors } from "./color";
import { formatDuration } from "./duration";

/** Serializable projection of the same activity logs, colors and overlap layout. */
export function buildActivityDayTimeline(
  entries: StoredActivity[],
  dayKey: string,
  now = Date.now(),
  dark = false,
) {
  const day = moment(dayKey, "YYYY-MM-DD", true).startOf("day");
  if (!day.isValid()) throw new Error("Invalid timeline day");
  const nextDay = day.clone().add(1, "day");
  const minutes = nextDay.diff(day, "minutes");
  const blocks = entries.flatMap(({ path, activityIndex, record }) =>
    (record.log ?? []).flatMap((log, logEntryIndex) => {
      const start = parseActivityTimestamp(log.start);
      const active = log.end === undefined;
      let end = active ? moment(now) : parseActivityTimestamp(log.end!);
      if (end.isBefore(start))
        end = start.clone().add(defaultDurationMinutes, "minutes");
      if (!start.isBefore(nextDay) || !end.isAfter(day)) return [];
      // Moment's browser ESM exposes these helpers on its default export.
      // eslint-disable-next-line import/no-named-as-default-member
      const clippedStart = moment.max(day, start);
      // eslint-disable-next-line import/no-named-as-default-member
      const clippedEnd = moment.min(nextDay, end);
      const colors = getActivityBlockColors(record.activity, dark);
      return [
        {
          id: JSON.stringify([path, activityIndex, logEntryIndex]),
          startTime: clippedStart,
          durationMinutes: clippedEnd.diff(clippedStart, "minutes"),
          durationLabel: formatDuration(
            // eslint-disable-next-line import/no-named-as-default-member
            moment.duration(
              clippedEnd.diff(clippedStart, "minutes"),
              "minutes",
            ),
          ),
          isAllDayEvent: false,
          startMinute: clippedStart.diff(day, "minutes", true),
          endMinute: clippedEnd.diff(day, "minutes", true),
          title: getActivityDisplayLabel(record.activity, record),
          notes: record.notes ?? "",
          quality: record.quality,
          qualityLabel: getActivityQualityLabel(record.quality),
          active,
          continuesBefore: start.isBefore(day),
          continuesAfter: end.isAfter(nextDay),
          timeLabel: `${start.format("HH:mm")} – ${active ? "now" : end.format("HH:mm")}`,
          background: colors?.background ?? (dark ? "#252525" : "#f5f5f5"),
          border: colors?.border ?? (dark ? "#777777" : "#b0b0b0"),
        },
      ];
    }),
  );
  const hours = Array.from({ length: Math.ceil(minutes / 60) }, (_, index) => ({
    startMinute: index * 60,
    endMinute: Math.min(minutes, (index + 1) * 60),
    label: day
      .clone()
      .add(index * 60, "minutes")
      .format("HH:mm"),
  }));
  const current = moment(now);
  return {
    day: dayKey,
    title: day.format("ddd, D MMM"),
    dark,
    minutes,
    hours,
    nowMinute: current.isSame(day, "day")
      ? current.diff(day, "minutes", true)
      : null,
    blocks: addHorizontalPlacing(blocks).map(
      ({ startTime: _startTime, isAllDayEvent: _allDay, ...block }) => block,
    ),
  };
}
