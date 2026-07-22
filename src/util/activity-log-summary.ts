import type { Duration, Moment } from "moment";

import {
  getActivityLabel,
  normalizeActivityName,
} from "./activity-definitions";
import type { Activity } from "./props";

export type ActivityDuration = {
  activity: string;
  activityKey: string;
  duration: Duration;
};

export function formatDuration(duration: Duration) {
  const totalMinutes = Math.round(duration.asMinutes());
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export function getWeekRangeFor(date: Moment) {
  const start = date.clone().startOf("isoWeek");
  const end = start.clone().add(1, "week");

  return { start, end };
}

export function calculateActivityDurationsForRange(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
  options?: {
    getLabel?: (activityName: string, activityEntry: Activity) => string;
  },
): ActivityDuration[] {
  const durationByNormalized = new Map<string, Duration>();
  const normalizedToLabel = new Map<string, string>();
  const seenInRange = new Set<string>();

  activities.forEach((activityEntry) => {
    const { activity, log } = activityEntry;
    const normalizedName = normalizeActivityName(activity);
    const label =
      normalizedToLabel.get(normalizedName) ??
      options?.getLabel?.(activity, activityEntry) ??
      getActivityLabel(activity);

    if (!normalizedToLabel.has(normalizedName)) {
      normalizedToLabel.set(normalizedName, label);
    }

    log?.forEach(({ start, end }) => {
      const startMoment = window.moment(start, window.moment.ISO_8601, true);

      if (!startMoment.isValid()) {
        return;
      }

      const endMoment = end
        ? window.moment(end, window.moment.ISO_8601, true)
        : window.moment();

      if (!end) {
        if (startMoment.isBefore(rangeEnd) && endMoment.isAfter(rangeStart)) {
          seenInRange.add(normalizedName);
        }
      }

      if (!endMoment.isValid()) {
        return;
      }

      const clampedStart = window.moment.max(startMoment, rangeStart);
      const clampedEnd = window.moment.min(endMoment, rangeEnd);

      if (!clampedEnd.isAfter(clampedStart)) {
        return;
      }

      seenInRange.add(normalizedName);

      const previousDuration =
        durationByNormalized.get(normalizedName) ?? window.moment.duration();
      const timeSpent = window.moment.duration(
        clampedEnd.diff(clampedStart),
        "milliseconds",
      );

      durationByNormalized.set(normalizedName, previousDuration.add(timeSpent));
    });
  });

  return [...normalizedToLabel.entries()]
    .filter(([normalized]) => seenInRange.has(normalized))
    .map(([normalized, label]) => ({
      activity: label,
      activityKey: normalized,
      duration:
        durationByNormalized.get(normalized) ?? window.moment.duration(),
    }))
    .sort((a, b) =>
      a.activity.localeCompare(b.activity, undefined, {
        sensitivity: "base",
      }),
    );
}

function getRecordedActivityDurationForRange(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
): Duration {
  const intervals: Array<{ start: Moment; end: Moment }> = [];

  activities.forEach(({ log }) => {
    log?.forEach(({ start, end }) => {
      const startMoment = window.moment(start, window.moment.ISO_8601, true);

      if (!startMoment.isValid()) {
        return;
      }

      const endMoment = end
        ? window.moment(end, window.moment.ISO_8601, true)
        : window.moment();

      if (!endMoment.isValid()) {
        return;
      }

      const clampedStart = window.moment.max(startMoment, rangeStart);
      const clampedEnd = window.moment.min(endMoment, rangeEnd);

      if (!clampedEnd.isAfter(clampedStart)) {
        return;
      }

      intervals.push({ start: clampedStart, end: clampedEnd });
    });
  });

  if (intervals.length === 0) {
    return window.moment.duration();
  }

  intervals.sort((a, b) => a.start.diff(b.start));

  let recordedMilliseconds = 0;
  let currentStart = intervals[0].start.clone();
  let currentEnd = intervals[0].end.clone();

  intervals.slice(1).forEach(({ start, end }) => {
    if (start.isAfter(currentEnd)) {
      recordedMilliseconds += currentEnd.diff(currentStart);
      currentStart = start.clone();
      currentEnd = end.clone();
      return;
    }

    if (end.isAfter(currentEnd)) {
      currentEnd = end.clone();
    }
  });

  recordedMilliseconds += currentEnd.diff(currentStart);

  return window.moment.duration(recordedMilliseconds, "milliseconds");
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
  const recordedDuration = getRecordedActivityDurationForRange(
    activities,
    rangeStart,
    rangeEnd,
  );

  return window.moment.duration(
    Math.max(
      rangeDuration.asMilliseconds() - recordedDuration.asMilliseconds(),
      0,
    ),
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

export function calculateWeeklyUnrecordedActivityDuration(
  activities: Activity[],
  dateInWeek: Moment,
): Duration {
  const { start: weekStart, end: weekEnd } = getWeekRangeFor(dateInWeek);

  return calculateUnrecordedActivityDurationForRange(
    activities,
    weekStart,
    weekEnd,
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
