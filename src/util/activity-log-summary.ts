import type { Duration, Moment } from "moment";

import {
  getActivityAttributeValues,
  getActivityDefinition,
  getActivityLabel,
  normalizeActivityName,
} from "./activity-definitions";
import type { Activity } from "./props";

export type ActivityDuration = {
  activity: string;
  activityKey: string;
  /** Time credited to this activity after resolving overlaps. */
  duration: Duration;
  /** Full elapsed time for this activity, including time credited elsewhere. */
  totalDuration?: Duration;
};

export type ActivityDisplayDuration = ActivityDuration & {
  emoji?: string;
  mainKeyValue?: string | number;
};

export function getWeekRangeFor(date: Moment) {
  const start = date.clone().startOf("isoWeek");
  const end = start.clone().add(1, "week");

  return { start, end };
}

type ActivityLog = NonNullable<Activity["log"]>[number];
const parsedLogs = new WeakMap<
  ActivityLog,
  {
    sourceStart: string;
    sourceEnd?: string;
    start: number;
    end?: number;
  }
>();

/** Reuse parsed timestamps while preserving updates to mutable log entries. */
export function getActivityLogTimes(log: ActivityLog) {
  const cached = parsedLogs.get(log);
  if (
    cached &&
    cached.sourceStart === log.start &&
    cached.sourceEnd === log.end
  )
    return cached;
  const parsed = {
    sourceStart: log.start,
    sourceEnd: log.end,
    start: window.moment(log.start, window.moment.ISO_8601, true).valueOf(),
    end: log.end
      ? window.moment(log.end, window.moment.ISO_8601, true).valueOf()
      : undefined,
  };
  parsedLogs.set(log, parsed);
  return parsed;
}

type ActivityLogInterval = {
  activity: Activity;
  logIndex: number;
  activityKey: string;
  priority: number;
  originalStart: number;
  start: number;
  end: number;
};

/** Split logs at every boundary, assigning each slice to exactly one log.
 * Ties favor the earliest start, then normalized activity name. Repeated logs
 * for the same activity never multiply its elapsed time.
 */
export function* activityTimeSlices(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
) {
  if (!rangeStart.isValid() || !rangeEnd.isValid()) return;
  const now = window.moment().valueOf();
  const limit = Math.min(rangeEnd.valueOf(), now);
  if (limit <= rangeStart.valueOf()) return;
  const events: Array<{
    time: number;
    interval: ActivityLogInterval;
    start: boolean;
  }> = [];
  for (const activity of activities) {
    const activityKey = normalizeActivityName(activity.activity);
    for (const [logIndex, log] of (activity.log ?? []).entries()) {
      const { start, end: loggedEnd } = getActivityLogTimes(log);
      const end = loggedEnd ?? now;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const interval: ActivityLogInterval = {
        activity,
        logIndex,
        activityKey,
        priority: getActivityDefinition(activity.activity)?.priority ?? 0,
        originalStart: start,
        start: Math.max(start, rangeStart.valueOf()),
        end: Math.min(end, limit),
      };
      if (interval.end <= interval.start) continue;
      events.push({ time: interval.start, interval, start: true });
      events.push({ time: interval.end, interval, start: false });
    }
  }
  events.sort((a, b) => a.time - b.time);
  const active = new Set<ActivityLogInterval>();
  let previous = events[0]?.time;
  for (let index = 0; index < events.length; ) {
    const time = events[index].time;
    if (time > previous && active.size > 0) {
      const logs = [...active];
      const winner = logs.reduce((best, candidate) => {
        const order =
          best.priority - candidate.priority ||
          candidate.originalStart - best.originalStart ||
          candidate.activityKey.localeCompare(best.activityKey);
        return order < 0 ? candidate : best;
      });
      yield { start: previous, end: time, winner, logs };
    }
    while (index < events.length && events[index].time === time) {
      const event = events[index++];
      if (event.start) active.add(event.interval);
      else active.delete(event.interval);
    }
    previous = time;
  }
}

export function calculateActivitySummaryForRange(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
  options?: {
    getLabel?: (activityName: string, activityEntry: Activity) => string;
    getGroupKey?: (activityEntry: Activity) => string;
    includeActivity?: (activityEntry: Activity) => boolean;
  },
) {
  const totals = new Map<
    string,
    {
      activity: string;
      activityKey: string;
      counted: number;
      total: number;
    }
  >();
  let recordedMilliseconds = 0;
  const groupKey = (entry: Activity) =>
    options?.getGroupKey?.(entry) ?? normalizeActivityName(entry.activity);
  for (const slice of activityTimeSlices(activities, rangeStart, rangeEnd)) {
    const milliseconds = slice.end - slice.start;
    recordedMilliseconds += milliseconds;
    const seen = new Set<string>();
    for (const { activity, activityKey } of slice.logs) {
      if (options?.includeActivity && !options.includeActivity(activity))
        continue;
      const key = groupKey(activity);
      if (seen.has(key)) continue;
      seen.add(key);
      const total = totals.get(key) ?? {
        activity:
          options?.getLabel?.(activity.activity, activity) ??
          getActivityLabel(activity.activity),
        activityKey,
        counted: 0,
        total: 0,
      };
      total.total += milliseconds;
      if (
        groupKey(slice.winner.activity) === key &&
        (!options?.includeActivity ||
          options.includeActivity(slice.winner.activity))
      ) {
        total.counted += milliseconds;
      }
      totals.set(key, total);
    }
  }
  const rows = [...totals.values()]
    .map(({ activity, activityKey, counted, total }) => ({
      activity,
      activityKey,
      duration: window.moment.duration(counted),
      totalDuration: window.moment.duration(total),
    }))
    .sort((a, b) =>
      a.activity.localeCompare(b.activity, undefined, { sensitivity: "base" }),
    );
  return {
    totals: rows,
    unrecordedTime: window.moment.duration(
      Math.max(0, rangeEnd.diff(rangeStart) - recordedMilliseconds),
    ),
  };
}

export function calculateActivityDurationsForRange(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
  options?: Parameters<typeof calculateActivitySummaryForRange>[3],
): ActivityDuration[] {
  return calculateActivitySummaryForRange(
    activities,
    rangeStart,
    rangeEnd,
    options,
  ).totals;
}

export function calculateUnrecordedActivityDurationForRange(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
): Duration {
  const rangeDuration = window.moment.duration(
    Math.max(rangeEnd.diff(rangeStart), 0),
    "milliseconds",
  );
  let recordedMilliseconds = 0;
  for (const { start, end } of activityTimeSlices(
    activities,
    rangeStart,
    rangeEnd,
  )) {
    recordedMilliseconds += end - start;
  }

  return window.moment.duration(
    Math.max(rangeDuration.asMilliseconds() - recordedMilliseconds, 0),
    "milliseconds",
  );
}

export function calculateWeeklyActivityDurations(
  activities: Activity[],
  dateInWeek: Moment,
): ActivityDuration[] {
  const { start: weekStart, end: weekEnd } = getWeekRangeFor(dateInWeek);

  return calculateActivityDurationsForRange(activities, weekStart, weekEnd);
}

export function calculateDailyActivityDurations(
  activities: Activity[],
  day: Moment,
): ActivityDuration[] {
  const dayStart = day.clone().startOf("day");
  const dayEnd = dayStart.clone().add(1, "day");

  return calculateActivityDurationsForRange(activities, dayStart, dayEnd);
}

/**
 * Produces calendar-friendly daily rows. Activities with a configured main key
 * are split by that value, while activities without one retain their normal
 * activity label.
 */
export function calculateDailyActivityDisplayDurations(
  activities: Activity[],
  day: Moment,
): ActivityDisplayDuration[] {
  function displayInfo(activity: Activity) {
    const definition = getActivityDefinition(activity.activity);
    const mainKey = definition?.attributes?.mainKey;
    const rawValue = mainKey
      ? getActivityAttributeValues(activity.activity, activity)[mainKey]
      : undefined;
    const mainKeyValue =
      typeof rawValue === "string" && rawValue.trim()
        ? rawValue.trim()
        : typeof rawValue === "number"
          ? rawValue
          : undefined;
    return {
      groupKey: `${normalizeActivityName(activity.activity)}\u0000${mainKeyValue ?? ""}`,
      label:
        mainKeyValue !== undefined
          ? String(mainKeyValue)
          : getActivityLabel(activity.activity),
      emoji: definition?.emoji,
      mainKeyValue,
    };
  }
  const infoByGroup = new Map(
    activities.map((activity) => {
      const info = displayInfo(activity);
      return [info.groupKey, info] as const;
    }),
  );
  const dayStart = day.clone().startOf("day");
  return calculateActivityDurationsForRange(
    activities,
    dayStart,
    dayStart.clone().add(1, "day"),
    {
      getGroupKey: (activity) => displayInfo(activity).groupKey,
      getLabel: (_, activity) => displayInfo(activity).groupKey,
    },
  )
    .map((total) => {
      const info = infoByGroup.get(total.activity)!;
      return {
        ...total,
        activity: info.label,
        emoji: info.emoji,
        mainKeyValue: info.mainKeyValue,
      };
    })
    .sort((a, b) =>
      a.activity.localeCompare(b.activity, undefined, { sensitivity: "base" }),
    );
}

export function calculateWeeklyUnrecordedActivityDuration(
  activities: Activity[],
  dateInWeek: Moment,
): Duration {
  const { start: weekStart, end: weekEnd } = getWeekRangeFor(dateInWeek);
  const elapsedEnd = window.moment.min(weekEnd, window.moment());
  if (!elapsedEnd.isAfter(weekStart)) return window.moment.duration(0);

  return calculateUnrecordedActivityDurationForRange(
    activities,
    weekStart,
    elapsedEnd,
  );
}

export function calculateDailyUnrecordedActivityDuration(
  activities: Activity[],
  day: Moment,
): Duration {
  const dayStart = day.clone().startOf("day");
  const dayEnd = dayStart.clone().add(1, "day");

  return calculateUnrecordedActivityDurationForRange(
    activities,
    dayStart,
    dayEnd,
  );
}
