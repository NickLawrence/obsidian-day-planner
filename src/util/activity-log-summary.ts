import type { Duration, Moment } from "moment";

import { getActivityDisplayLabel, normalizeActivityName } from "./activity-definitions";
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

function calculateActivityDurationsForRange(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
): ActivityDuration[] {
  const durationByNormalized = new Map<string, Duration>();
  const normalizedToLabel = new Map<string, string>();
  const seenInRange = new Set<string>();

  activities.forEach((activityEntry) => {
    const { activity, log } = activityEntry;
    const normalizedName = normalizeActivityName(activity);
    const label =
      normalizedToLabel.get(normalizedName) ??
      getActivityDisplayLabel(activity, activityEntry as Record<string, unknown>);

    if (!normalizedToLabel.has(normalizedName)) {
      normalizedToLabel.set(normalizedName, label);
    }

    log?.forEach(({ start, end }) => {
      const startMoment = window.moment(
        start,
        window.moment.ISO_8601,
        true,
      );

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
