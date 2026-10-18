import type { Moment } from "moment";
import type { App } from "obsidian";

import type { ActivityDefinition } from "./activity-definitions";
import {
  getActivityAttributeFields,
  getActivityAttributeValues,
  normalizeActivityName,
} from "./activity-definitions";
import {
  activityTimeSlices,
  getActivityLogTimes,
} from "./activity-log-summary";
import { getResourceFilesForField } from "./activity-resources";
import type { Activity } from "./props";

export type ActivityMainKeyProgress = {
  value: string;
  minutes: number;
  countedMinutes?: number;
  filePath?: string;
  rangeKey?: string;
  current?: number;
  maximum?: number;
  percent?: number;
  minutesPerUnit?: number;
  estimatedMinutesRemaining?: number;
};

function createProgressLookup(
  activities: Activity[],
  definition: ActivityDefinition,
  now = window.moment(),
) {
  const recordsByValue = new Map<string, Activity[]>();
  const key = normalizeActivityName(definition.name);
  const mainKey = definition.attributes?.mainKey;
  for (const activity of activities) {
    if (!mainKey || normalizeActivityName(activity.activity) !== key) continue;
    const value = String(
      getActivityAttributeValues(definition.name, activity)[mainKey] ?? "",
    )
      .trim()
      .toLowerCase();
    const records = recordsByValue.get(value) ?? [];
    records.push(activity);
    recordsByValue.set(value, records);
  }
  let creditedByActivity: Map<Activity, number> | undefined;
  return (acceptedValues: Set<string>) => {
    const matching = [
      ...new Set(
        [...acceptedValues].flatMap((value) => recordsByValue.get(value) ?? []),
      ),
    ];
    if (!matching.length) return { matching, minutes: 0, counted: 0 };
    if (!creditedByActivity) {
      creditedByActivity = new Map();
      for (const { start, end, winner } of activityTimeSlices(
        activities,
        window.moment("0001-01-01"),
        now,
      )) {
        creditedByActivity.set(
          winner.activity,
          (creditedByActivity.get(winner.activity) ?? 0) + end - start,
        );
      }
    }
    const intervals = matching
      .flatMap((activity) =>
        (activity.log ?? []).flatMap((log) => {
          const { start, end } = getActivityLogTimes(log);
          const until = Math.min(end ?? now.valueOf(), now.valueOf());
          return Number.isFinite(start) &&
            Number.isFinite(until) &&
            until > start
            ? [{ start, end: until }]
            : [];
        }),
      )
      .sort((a, b) => a.start - b.start);
    let total = 0;
    let until = Number.NEGATIVE_INFINITY;
    for (const interval of intervals) {
      total += Math.max(0, interval.end - Math.max(interval.start, until));
      until = Math.max(until, interval.end);
    }
    return {
      matching,
      minutes: total / 60_000,
      counted:
        matching.reduce(
          (sum, activity) => sum + (creditedByActivity!.get(activity) ?? 0),
          0,
        ) / 60_000,
    };
  };
}

/** Summarize time, completion, pace, and ETA for one main-key value. */
export function calculateActivityMainKeyProgress(
  props: {
    activities: Activity[];
    definition: ActivityDefinition;
    value: string;
    aliases?: string[];
    rangeMaximums?: Record<string, unknown>;
  },
  lookup?: ReturnType<typeof createProgressLookup>,
): ActivityMainKeyProgress {
  const {
    activities,
    definition,
    value,
    aliases = [],
    rangeMaximums = {},
  } = props;
  const attributes = definition.attributes;
  const acceptedValues = new Set(
    [value, ...aliases].map((candidate) => candidate.trim().toLowerCase()),
  );
  const { matching, minutes, counted } = (
    lookup ?? createProgressLookup(activities, definition)
  )(acceptedValues);
  const time = {
    minutes,
    ...(counted < minutes ? { countedMinutes: counted } : {}),
  };
  const range = attributes?.ranges?.find((candidate) => {
    const maximum = Number(rangeMaximums[candidate.key]);
    return Number.isFinite(maximum) && maximum > 0;
  });

  if (!range) return { value, ...time };

  const maximum = Number(rangeMaximums[range.key]);
  let current = 0;
  let units = 0;

  for (const activity of matching) {
    const values = getActivityAttributeValues(definition.name, activity);
    const start = Number(values[range.start]);
    const end = Number(values[range.end]);

    if (Number.isFinite(end)) current = Math.max(current, end);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      units += end - start + 1;
    }
  }

  const minutesPerUnit = units > 0 ? minutes / units : undefined;
  const estimatedMinutesRemaining =
    minutesPerUnit === undefined
      ? undefined
      : Math.max(maximum - current, 0) * minutesPerUnit;

  return {
    value,
    ...time,
    rangeKey: range.key,
    current,
    maximum,
    percent: Math.min(Math.max((current / maximum) * 100, 0), 100),
    minutesPerUnit,
    estimatedMinutesRemaining,
  };
}

/** Build the dashboard list, mirroring the activity queue's in-progress rules. */
export function getInProgressMainKeys(
  app: App,
  activities: Activity[],
  definition: ActivityDefinition,
  now: Moment = window.moment(),
) {
  const mainKey = definition.attributes?.mainKey;
  if (!mainKey) return [];

  const field = getActivityAttributeFields(definition.name, "start").find(
    (candidate) => candidate.key === mainKey && candidate.resourceTag,
  );
  if (!field) return [];

  const resources = getResourceFilesForField(app, field);
  const knownNames = new Set(
    resources
      .flatMap(({ name, aliases }) => [name, ...aliases])
      .map((name) => name.trim().toLowerCase()),
  );
  const lookup = createProgressLookup(activities, definition, now);
  const inProgress = resources
    .filter(({ status }) => status === "in progress")
    .map((resource) => ({
      ...calculateActivityMainKeyProgress(
        {
          activities,
          definition,
          value: resource.name,
          aliases: resource.aliases,
          rangeMaximums: resource.frontmatter,
        },
        lookup,
      ),
      filePath: resource.file.path,
    }));
  const missingValues = new Set<string>();

  for (const activity of activities) {
    if (
      normalizeActivityName(activity.activity) !==
      normalizeActivityName(definition.name)
    ) {
      continue;
    }
    const candidate = getActivityAttributeValues(definition.name, activity)[
      mainKey
    ];
    if (typeof candidate !== "string" && typeof candidate !== "number") {
      continue;
    }
    const value = String(candidate).trim();
    const normalized = value.toLowerCase();
    if (value && !knownNames.has(normalized)) missingValues.add(value);
  }

  return [
    ...inProgress,
    ...[...missingValues].map((value) =>
      calculateActivityMainKeyProgress(
        { activities, definition, value },
        lookup,
      ),
    ),
  ].sort((a, b) => b.minutes - a.minutes || a.value.localeCompare(b.value));
}
