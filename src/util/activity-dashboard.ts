import {
  normalizeActivityName,
  type ActivityDefinition,
} from "./activity-definitions";
import {
  activityTimeSlices,
  getActivityLogTimes,
} from "./activity-log-summary";
import type { Activity } from "./props";

export type ActivityDashboardRow = {
  start: number;
  end: number;
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
  rows: ActivityDashboardRow[];
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

type DashboardCalendar = Array<{
  start: string;
  end: string;
  month: string;
  dates: string[];
}>;

function createCalendar(year: number): DashboardCalendar {
  const firstWeek = window.moment(`${year}-01-04`).startOf("isoWeek");
  return Array.from({ length: 52 }, (_, index) => {
    const start = firstWeek.clone().add(index, "weeks");
    return {
      start: start.format("YYYY-MM-DD"),
      end: start.clone().add(6, "days").format("YYYY-MM-DD"),
      month: start.clone().add(3, "days").format("MMM"),
      dates: Array.from({ length: 7 }, (_, day) =>
        start.clone().add(day, "days").format("YYYY-MM-DD"),
      ),
    };
  });
}

function buildWeeks(
  timesByDay: Map<string, TimeTotal>,
  itemsByDay: Map<string, Map<string, TimeTotal>>,
  calendar: DashboardCalendar,
) {
  const weeks = calendar.map(({ dates, ...week }) => {
    const days = dates.map((date) => {
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
      ...week,
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

export type ActivityDashboard = {
  weeks: ActivityDashboardWeek[];
  rows: ActivityDashboardRow[];
  groups: ActivityDashboardGroup[];
};

type DashboardAccumulator = {
  definition: ActivityDefinition;
  rows: ActivityDashboardRow[];
  groups: Map<string, ActivityDashboardGroup>;
  groupTimes: Map<string, TimeTotal>;
  timesByDay: Map<string, TimeTotal>;
  itemsByDay: Map<string, Map<string, TimeTotal>>;
};

/** Resolve overlaps once for all frequency rows, instead of once per activity.
 * includeHistory=false limits work to the displayed year and omits log/group tables.
 */
export function buildActivityDashboards(
  activities: Activity[],
  definitions: ActivityDefinition[],
  year = window.moment().year(),
  options: { includeHistory?: boolean } = {},
): Map<string, ActivityDashboard> {
  const now = window.moment();
  const includeHistory = options.includeHistory !== false;
  const calendar = createCalendar(year);
  const rangeStart = includeHistory
    ? window.moment("0001-01-01")
    : window.moment(calendar[0].start);
  const rangeEnd = includeHistory
    ? now
    : window.moment.min(now, window.moment(calendar.at(-1)!.end).add(1, "day"));
  const accumulators = new Map<string, DashboardAccumulator>(
    definitions.map((definition) => [
      normalizeActivityName(definition.name),
      {
        definition,
        rows: [],
        groups: new Map(),
        groupTimes: new Map(),
        timesByDay: new Map(),
        itemsByDay: new Map(),
      },
    ]),
  );
  const info = new Map<
    Activity,
    {
      accumulator: DashboardAccumulator;
      mainValue: string;
      details: Record<string, unknown>;
    }
  >();
  for (const activity of activities) {
    const accumulator = accumulators.get(
      normalizeActivityName(activity.activity),
    );
    if (!accumulator) continue;
    const attributes = accumulator.definition.attributes;
    const candidate = attributes?.key ? activity[attributes.key] : undefined;
    const details =
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)
        : {};
    const value = attributes?.mainKey ? details[attributes.mainKey] : undefined;
    const mainValue =
      value == null || String(value).trim() === "" ? "(empty)" : String(value);
    info.set(activity, { accumulator, mainValue, details });
  }

  const countedByLog = new Map<Activity, Map<number, number>>();
  for (const slice of activityTimeSlices(activities, rangeStart, rangeEnd)) {
    const winner = slice.winner.activity.log?.[slice.winner.logIndex].end
      ? info.get(slice.winner.activity)
      : undefined;
    const minutes = (slice.end - slice.start) / 60_000;
    if (winner && includeHistory) {
      const logs =
        countedByLog.get(slice.winner.activity) ?? new Map<number, number>();
      logs.set(
        slice.winner.logIndex,
        (logs.get(slice.winner.logIndex) ?? 0) + minutes,
      );
      countedByLog.set(slice.winner.activity, logs);
    }
    const namesByActivity = new Map<DashboardAccumulator, Set<string>>();
    for (const { activity, logIndex } of slice.logs) {
      // Frequencies list completed logs; open clocks still compete for time.
      if (!activity.log?.[logIndex].end) continue;
      const entry = info.get(activity);
      if (!entry) continue;
      const names = namesByActivity.get(entry.accumulator) ?? new Set<string>();
      names.add(entry.mainValue);
      namesByActivity.set(entry.accumulator, names);
    }
    if (namesByActivity.size === 0) continue;
    const parts: Array<{ date: string; minutes: number }> = [];
    let cursor = window.moment(slice.start);
    while (cursor.valueOf() < slice.end) {
      const end = Math.min(
        cursor.clone().startOf("day").add(1, "day").valueOf(),
        slice.end,
      );
      parts.push({
        date: cursor.format("YYYY-MM-DD"),
        minutes: (end - cursor.valueOf()) / 60_000,
      });
      cursor = window.moment(end);
    }
    for (const [accumulator, names] of namesByActivity) {
      const credited = winner?.accumulator === accumulator;
      if (includeHistory)
        for (const name of names)
          addTime(
            accumulator.groupTimes,
            name,
            credited && winner?.mainValue === name ? minutes : 0,
            minutes,
          );
      for (const part of parts) {
        addTime(
          accumulator.timesByDay,
          part.date,
          credited ? part.minutes : 0,
          part.minutes,
        );
        if (!accumulator.definition.attributes?.mainKey) continue;
        const items =
          accumulator.itemsByDay.get(part.date) ?? new Map<string, TimeTotal>();
        for (const name of names)
          addTime(
            items,
            name,
            credited && winner?.mainValue === name ? part.minutes : 0,
            part.minutes,
          );
        accumulator.itemsByDay.set(part.date, items);
      }
    }
  }

  if (includeHistory)
    for (const [activity, { accumulator, mainValue, details }] of info) {
      const attributes = accumulator.definition.attributes;
      for (const [logIndex, log] of (activity.log ?? []).entries()) {
        const { start, end } = getActivityLogTimes(log);
        if (
          end === undefined ||
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          end <= start
        )
          continue;
        const totalMinutes =
          Math.max(0, Math.min(end, now.valueOf()) - start) / 60_000;
        if (totalMinutes === 0) continue;
        const minutes = countedByLog.get(activity)?.get(logIndex) ?? 0;
        const day = window.moment(start).format("YYYY-MM-DD");
        const rangeValues = (attributes?.ranges ?? []).map(
          ({ start: startKey, end: endKey }) => {
            const from = Number(details[startKey]);
            const until = Number(details[endKey]);
            return Number.isFinite(from) && Number.isFinite(until)
              ? until - from + 1
              : "";
          },
        );
        const row: ActivityDashboardRow = {
          start,
          end: Math.min(end, now.valueOf()),
          day,
          minutes,
          ...(totalMinutes > minutes ? { totalMinutes } : {}),
          notes: activity.notes ?? "",
          quality: typeof activity.quality === "number" ? activity.quality : "",
          startValues: (attributes?.start ?? []).map(
            ({ key }) => details[key] ?? "",
          ),
          endValues: (attributes?.end ?? []).map(
            ({ key }) => details[key] ?? "",
          ),
          rangeValues,
          rangeValuesPerHour: rangeValues.map((value) =>
            typeof value === "number" ? value / (totalMinutes / 60) : "-",
          ),
        };
        accumulator.rows.push(row);
        if (attributes?.mainKey) {
          const group = accumulator.groups.get(mainValue) ?? {
            value: mainValue,
            minutes: 0,
            earliest: day,
            latest: day,
            rows: [],
          };
          const time = accumulator.groupTimes.get(mainValue)!;
          group.minutes = time.minutes;
          if (time.totalMinutes > time.minutes)
            group.totalMinutes = time.totalMinutes;
          if (day < group.earliest) group.earliest = day;
          if (day > group.latest) group.latest = day;
          group.rows.push(row);
          accumulator.groups.set(mainValue, group);
        }
      }
    }
  return new Map(
    [...accumulators].map(([key, accumulator]) => [
      key,
      {
        weeks: buildWeeks(
          accumulator.timesByDay,
          accumulator.itemsByDay,
          calendar,
        ),
        rows: accumulator.rows.sort((a, b) => b.start - a.start),
        groups: [...accumulator.groups.values()]
          .map((group) => ({
            ...group,
            rows: group.rows.sort((a, b) => b.start - a.start),
          }))
          .sort((a, b) => b.rows[0].start - a.rows[0].start),
      },
    ]),
  );
}

export function buildActivityDashboard(
  activities: Activity[],
  definition: ActivityDefinition,
  year = window.moment().year(),
): ActivityDashboard {
  return buildActivityDashboards(activities, [definition], year).get(
    normalizeActivityName(definition.name),
  )!;
}
