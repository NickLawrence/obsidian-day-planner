import type { Moment } from "moment";

import type { Activity } from "./props";

/** Parse history once per data update, rather than once per calendar cell. */
export function createActivityRangeIndex(activities: Activity[]) {
  const indexed = activities.map((activity) => ({
    activity,
    entries: (activity.log ?? []).map((entry) => ({
      entry,
      start: window.moment(entry.start, window.moment.ISO_8601, true).valueOf(),
      end: entry.end
        ? window.moment(entry.end, window.moment.ISO_8601, true).valueOf()
        : undefined,
    })),
  }));

  return (start: Moment, end: Moment): Activity[] => {
    const from = start.valueOf();
    const to = end.valueOf();
    const now = window.moment().valueOf();
    const result: Activity[] = [];
    for (const { activity, entries } of indexed) {
      const log = entries
        .filter((entry) => {
          const until = entry.end ?? now;
          return entry.start < to && until > from && until > entry.start;
        })
        .map(({ entry }) => entry);
      if (log.length) result.push({ ...activity, log });
    }
    return result;
  };
}
