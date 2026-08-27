import { clockFormat } from "../constants";

import {
  normalizeActivityName,
  type ActivityDefinition,
} from "./activity-definitions";
import type { Activity } from "./props";

export type ActivityDashboardRow = {
  day: string;
  minutes: number;
  notes: string;
  quality: number | "";
  startValues: unknown[];
  endValues: unknown[];
  rangeValues: Array<number | "">;
  rangeValuesPerHour: Array<number | "-">;
};

export type ActivityDashboardGroup = {
  value: string;
  minutes: number;
  earliest: string;
  latest: string;
};

function parseClock(timestamp?: string) {
  if (!timestamp) return null;

  const clock = window.moment(timestamp, clockFormat, true);
  if (clock.isValid()) return clock;

  const isoClock = window.moment(timestamp, window.moment.ISO_8601, true);
  return isoClock.isValid() ? isoClock : null;
}

export function buildActivityDashboard(
  activities: Activity[],
  definition: ActivityDefinition,
) {
  const attributes = definition.attributes;
  const startFields = attributes?.start ?? [];
  const endFields = attributes?.end ?? [];
  const ranges = attributes?.ranges ?? [];
  const groups = new Map<string, ActivityDashboardGroup>();
  const rows: ActivityDashboardRow[] = [];

  for (const activity of activities) {
    if (
      normalizeActivityName(activity.activity) !==
      normalizeActivityName(definition.name)
    ) {
      continue;
    }

    const activityValues = activity as unknown as Record<string, unknown>;
    const detailsCandidate = attributes?.key
      ? activityValues[attributes.key]
      : undefined;
    const details =
      detailsCandidate && typeof detailsCandidate === "object"
        ? (detailsCandidate as Record<string, unknown>)
        : {};
    const mainValueCandidate = attributes?.mainKey
      ? details[attributes.mainKey]
      : undefined;
    const mainValue =
      mainValueCandidate == null || String(mainValueCandidate).trim() === ""
        ? "(empty)"
        : String(mainValueCandidate);

    for (const log of activity.log ?? []) {
      const start = parseClock(log.start);
      const end = parseClock(log.end);
      if (!start || !end || !end.isAfter(start)) continue;

      const minutes = Math.round(
        window.moment.duration(end.diff(start)).asMinutes(),
      );
      const day = start.format("YYYY-MM-DD");
      const rangeValues = ranges.map(({ start: startKey, end: endKey }) => {
        const rangeStart = Number(details[startKey]);
        const rangeEnd = Number(details[endKey]);
        return Number.isFinite(rangeStart) && Number.isFinite(rangeEnd)
          ? rangeEnd - rangeStart + 1
          : "";
      });

      rows.push({
        day,
        minutes,
        notes: activity.notes ?? "",
        quality: typeof activity.quality === "number" ? activity.quality : "",
        startValues: startFields.map(({ key }) => details[key] ?? ""),
        endValues: endFields.map(({ key }) => details[key] ?? ""),
        rangeValues,
        rangeValuesPerHour: rangeValues.map((value) =>
          typeof value === "number" ? value / (minutes / 60) : "-",
        ),
      });

      if (attributes?.mainKey) {
        const current = groups.get(mainValue) ?? {
          value: mainValue,
          minutes: 0,
          earliest: day,
          latest: day,
        };
        current.minutes += minutes;
        if (day < current.earliest) current.earliest = day;
        if (day > current.latest) current.latest = day;
        groups.set(mainValue, current);
      }
    }
  }

  return {
    rows: rows.sort((a, b) => b.day.localeCompare(a.day)),
    groups: [...groups.values()].sort((a, b) => b.minutes - a.minutes),
  };
}
