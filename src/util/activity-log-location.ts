import type { Activity, LogEntry } from "./activity-schema";

/** A row in a weekly activity file. Task IDs are optional metadata, never identity. */
export interface ActivityLogLocation {
  path: string;
  activityIndex: number;
  logEntryIndex: number;
}

export function getActivityLogEntries(path: string, activities: Activity[]) {
  return activities.flatMap((activity, activityIndex) =>
    (activity.log ?? []).map((log, logEntryIndex) => ({
      activity,
      log,
      activityLocation: { path, activityIndex, logEntryIndex },
    })),
  );
}

export function getActivityAtLogLocation(
  activities: Activity[],
  location: ActivityLogLocation,
  expected?: { activity: string; log: LogEntry },
) {
  const activity = activities[location.activityIndex];
  const log = activity?.log?.[location.logEntryIndex];
  if (
    !activity ||
    !log ||
    (expected &&
      (activity.activity !== expected.activity ||
        log.start !== expected.log.start ||
        log.end !== expected.log.end))
  )
    throw new Error(
      "The selected activity changed. Refresh and select it again.",
    );
  return { activity, log };
}
