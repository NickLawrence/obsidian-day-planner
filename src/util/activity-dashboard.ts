import { clockFormat } from "../constants";

import {
  normalizeActivityName,
  type ActivityDefinition,
} from "./activity-definitions";
import { activityTimeSlices } from "./activity-log-summary";
import type { Activity } from "./props";

export type ActivityDashboardRow = {
  day: string;
  minutes: number;
  totalMinutes?: number;
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
  totalMinutes?: number;
  earliest: string;
  latest: string;
};

type TimeTotal = { minutes: number; totalMinutes: number };

export type ActivityDashboardItem = {
  name: string;
  minutes: number;
  totalMinutes?: number;
};

export type ActivityDashboardDay = {
  date: string;
  minutes: number;
  totalMinutes?: number;
  intensity: number;
  items: ActivityDashboardItem[];
};

function addTime(
  times: Map<string, TimeTotal>,
  key: string,
  minutes: number,
  totalMinutes: number,
) {
  const total = times.get(key) ?? { minutes: 0, totalMinutes: 0 };
  total.minutes += minutes;
  total.totalMinutes += totalMinutes;
  times.set(key, total);
}

function sortedItems(items: Map<string, TimeTotal>): ActivityDashboardItem[] {
  return [...items]
    .map(([name, { minutes, totalMinutes }]) => ({
      name,
      minutes,
      ...(totalMinutes > minutes ? { totalMinutes } : {}),
    }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

export type ActivityDashboardWeek = {
  start: string;
  end: string;
  month: string;
  minutes: number;
  totalMinutes?: number;
  intensity: number;
  days: ActivityDashboardDay[];
  items: ActivityDashboardItem[];
};

function buildWeeks(
  timesByDay: Map<string, TimeTotal>,
  itemsByDay: Map<string, Map<string, TimeTotal>>,
  year: number,
) {
  // January 4 is always in the first ISO week assigned to a calendar year.
  const firstWeek = window.moment(`${year}-01-04`).startOf("isoWeek");
  const weeks = Array.from({ length: 52 }, (_, index) => {
    const start = firstWeek.clone().add(index, "weeks");
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = start.clone().add(dayIndex, "days").format("YYYY-MM-DD");
      const total = timesByDay.get(date);
      const minutes = total?.minutes ?? 0;
      return {
        date,
        minutes,
        ...(total && total.totalMinutes > minutes
          ? { totalMinutes: total.totalMinutes }
          : {}),
        intensity: 0,
        items: sortedItems(itemsByDay.get(date) ?? new Map()),
      };
    });
    const weekItems = new Map<string, TimeTotal>();
    for (const day of days) {
      for (const item of day.items)
        addTime(
          weekItems,
          item.name,
          item.minutes,
          item.totalMinutes ?? item.minutes,
        );
    }
    const minutes = days.reduce((sum, day) => sum + day.minutes, 0);
    const totalMinutes = days.reduce(
      (sum, day) => sum + (day.totalMinutes ?? day.minutes),
      0,
    );
    return {
      start: start.format("YYYY-MM-DD"),
      end: start.clone().add(6, "days").format("YYYY-MM-DD"),
      // A week's Thursday determines its month, giving that month at least four days.
      month: start.clone().add(3, "days").format("MMM"),
      minutes,
      ...(totalMinutes > minutes ? { totalMinutes } : {}),
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

  const selectedKey = normalizeActivityName(definition.name);
  const matches = (activity: Activity) =>
    normalizeActivityName(activity.activity) === selectedKey;
  function mainValueFor(activity: Activity) {
    const details = attributes?.key ? activity[attributes.key] : undefined;
    const value =
      attributes?.mainKey && details && typeof details === "object"
        ? (details as Record<string, unknown>)[attributes.mainKey]
        : undefined;
    return value == null || String(value).trim() === ""
      ? "(empty)"
      : String(value);
  }
  const countedByLog = new Map<Activity, Map<number, number>>();
  const groupTimes = new Map<
    string,
    { minutes: number; totalMinutes: number }
  >();
  const timesByDay = new Map<string, TimeTotal>();
  const itemsByDay = new Map<string, Map<string, TimeTotal>>();
  for (const slice of activityTimeSlices(
    activities,
    window.moment("0001-01-01"),
    window.moment(),
  )) {
    // This dashboard lists completed logs; open logs still compete for time.
    const logs = slice.logs.filter(
      ({ activity, logIndex }) =>
        matches(activity) && activity.log?.[logIndex].end,
    );
    if (logs.length === 0) continue;
    const minutes = (slice.end - slice.start) / 60_000;
    const credited =
      matches(slice.winner.activity) &&
      Boolean(slice.winner.activity.log?.[slice.winner.logIndex].end);
    if (credited) {
      const byLog =
        countedByLog.get(slice.winner.activity) ?? new Map<number, number>();
      byLog.set(
        slice.winner.logIndex,
        (byLog.get(slice.winner.logIndex) ?? 0) + minutes,
      );
      countedByLog.set(slice.winner.activity, byLog);
    }
    const names = new Set(logs.map(({ activity }) => mainValueFor(activity)));
    const creditedName = credited
      ? mainValueFor(slice.winner.activity)
      : undefined;
    for (const value of names) {
      addTime(groupTimes, value, creditedName === value ? minutes : 0, minutes);
    }
    let cursor = window.moment(slice.start);
    while (cursor.valueOf() < slice.end) {
      const end = Math.min(
        cursor.clone().startOf("day").add(1, "day").valueOf(),
        slice.end,
      );
      const part = (end - cursor.valueOf()) / 60_000;
      const date = cursor.format("YYYY-MM-DD");
      addTime(timesByDay, date, credited ? part : 0, part);
      if (attributes?.mainKey) {
        const items = itemsByDay.get(date) ?? new Map<string, TimeTotal>();
        for (const name of names)
          addTime(items, name, creditedName === name ? part : 0, part);
        itemsByDay.set(date, items);
      }
      cursor = window.moment(end);
    }
  }

  for (const activity of activities) {
    if (
      normalizeActivityName(activity.activity) !==
      normalizeActivityName(definition.name)
    ) {
      continue;
    }

    const detailsCandidate = attributes?.key
      ? activity[attributes.key]
      : undefined;
    const details =
      detailsCandidate && typeof detailsCandidate === "object"
        ? (detailsCandidate as Record<string, unknown>)
        : {};
    const mainValue = mainValueFor(activity);

    for (const [logIndex, log] of (activity.log ?? []).entries()) {
      const start = parseClock(log.start);
      const end = parseClock(log.end);
      if (!start || !end || !end.isAfter(start)) continue;

      const totalMinutes = Math.max(
        0,
        window.moment.min(end, window.moment()).diff(start) / 60_000,
      );
      if (totalMinutes === 0) continue;
      const minutes = countedByLog.get(activity)?.get(logIndex) ?? 0;
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
        ...(totalMinutes > minutes ? { totalMinutes } : {}),
        notes: activity.notes ?? "",
        quality: typeof activity.quality === "number" ? activity.quality : "",
        startValues: startFields.map(({ key }) => details[key] ?? ""),
        endValues: endFields.map(({ key }) => details[key] ?? ""),
        rangeValues,
        rangeValuesPerHour: rangeValues.map((value) =>
          typeof value === "number" ? value / (totalMinutes / 60) : "-",
        ),
      });

      if (attributes?.mainKey) {
        const current = groups.get(mainValue) ?? {
          value: mainValue,
          minutes: 0,
          earliest: day,
          latest: day,
        };
        const total = groupTimes.get(mainValue)!;
        current.minutes = total.minutes;
        if (total.totalMinutes > total.minutes)
          current.totalMinutes = total.totalMinutes;
        if (day < current.earliest) current.earliest = day;
        if (day > current.latest) current.latest = day;
        groups.set(mainValue, current);
      }
    }
  }

  return {
    weeks: buildWeeks(timesByDay, itemsByDay, year),
    rows: rows.sort((a, b) => b.day.localeCompare(a.day)),
    groups: [...groups.values()].sort((a, b) => b.minutes - a.minutes),
  };
}
