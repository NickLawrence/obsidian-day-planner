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

export type ActivityDashboardItem = {
  name: string;
  minutes: number;
};

function sortedItems(items: Map<string, number>): ActivityDashboardItem[] {
  return [...items]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

export type ActivityDashboardDay = {
  date: string;
  items: ActivityDashboardItem[];
  minutes: number;
  intensity: number;
};

export type ActivityDashboardWeek = {
  start: string;
  end: string;
  month: string;
  minutes: number;
  intensity: number;
  days: ActivityDashboardDay[];
  items: ActivityDashboardItem[];
};

function buildWeeks(
  minutesByDay: Map<string, number>,
  itemsByDay: Map<string, Map<string, number>>,
  year: number,
) {
  // January 4 is always in the first ISO week assigned to a calendar year.
  const firstWeek = window.moment(`${year}-01-04`).startOf("isoWeek");
  const weeks = Array.from({ length: 52 }, (_, index) => {
    const start = firstWeek.clone().add(index, "weeks");
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = start.clone().add(dayIndex, "days").format("YYYY-MM-DD");
      return {
        date,
        minutes: minutesByDay.get(date) ?? 0,
        intensity: 0,
        items: sortedItems(itemsByDay.get(date) ?? new Map()),
      };
    });
    const weekItems = new Map<string, number>();
    for (const day of days) {
      for (const item of day.items)
        weekItems.set(
          item.name,
          (weekItems.get(item.name) ?? 0) + item.minutes,
        );
    }
    const minutes = days.reduce((total, day) => total + day.minutes, 0);

    return {
      start: start.format("YYYY-MM-DD"),
      end: start.clone().add(6, "days").format("YYYY-MM-DD"),
      // A week's Thursday determines its month, giving that month at least four days.
      month: start.clone().add(3, "days").format("MMM"),
      minutes,
      intensity: 0,
      days,
      items: sortedItems(weekItems),
    };
  });
  const maximum = Math.max(0, ...weeks.map(({ minutes }) => minutes));

  const dailyMaximum = Math.max(
    0,
    ...weeks.flatMap(({ days }) => days.map(({ minutes }) => minutes)),
  );

  return weeks.map((week) => ({
    ...week,
    intensity: maximum === 0 ? 0 : week.minutes / maximum,
    days: week.days.map((day) => ({
      ...day,
      intensity: dailyMaximum === 0 ? 0 : day.minutes / dailyMaximum,
    })),
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
  const minutesByDay = new Map<string, number>();
  const itemsByDay = new Map<string, Map<string, number>>();

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
      let segmentStart = start.clone();
      while (segmentStart.isBefore(end)) {
        const segmentEnd = window.moment.min(
          end,
          segmentStart.clone().startOf("day").add(1, "day"),
        );
        const date = segmentStart.format("YYYY-MM-DD");
        minutesByDay.set(
          date,
          (minutesByDay.get(date) ?? 0) +
            segmentEnd.diff(segmentStart) / 60_000,
        );
        if (attributes?.mainKey) {
          const items = itemsByDay.get(date) ?? new Map<string, number>();
          items.set(
            mainValue,
            (items.get(mainValue) ?? 0) +
              segmentEnd.diff(segmentStart) / 60_000,
          );
          itemsByDay.set(date, items);
        }
        segmentStart = segmentEnd;
      }
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
    weeks: buildWeeks(minutesByDay, itemsByDay, year),
    rows: rows.sort((a, b) => b.day.localeCompare(a.day)),
    groups: [...groups.values()].sort((a, b) => b.minutes - a.minutes),
  };
}
