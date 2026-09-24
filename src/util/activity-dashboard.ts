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

export type ActivityDashboardWeek = {
  start: string;
  end: string;
  month: string;
  minutes: number;
  intensity: number;
};

function buildWeeks(rows: ActivityDashboardRow[], year: number) {
  // January 4 is always in the first ISO week assigned to a calendar year.
  const firstWeek = window.moment(`${year}-01-04`).startOf("isoWeek");
  const minutesByWeek = new Map<string, number>();

  for (const row of rows) {
    const week = window.moment(row.day).startOf("isoWeek").format("YYYY-MM-DD");
    minutesByWeek.set(week, (minutesByWeek.get(week) ?? 0) + row.minutes);
  }

  const weeks = Array.from({ length: 52 }, (_, index) => {
    const start = firstWeek.clone().add(index, "weeks");
    const minutes = minutesByWeek.get(start.format("YYYY-MM-DD")) ?? 0;

    return {
      start: start.format("YYYY-MM-DD"),
      end: start.clone().add(6, "days").format("YYYY-MM-DD"),
      // A week's Thursday determines its month, giving that month at least four days.
      month: start.clone().add(3, "days").format("MMM"),
      minutes,
      intensity: 0,
    };
  });
  const maximum = Math.max(0, ...weeks.map(({ minutes }) => minutes));

  return weeks.map((week) => ({
    ...week,
    intensity: maximum === 0 ? 0 : week.minutes / maximum,
  }));
}

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
  year = window.moment().year(),
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
    weeks: buildWeeks(rows, year),
    rows: rows.sort((a, b) => b.day.localeCompare(a.day)),
    groups: [...groups.values()].sort((a, b) => b.minutes - a.minutes),
  };
}
