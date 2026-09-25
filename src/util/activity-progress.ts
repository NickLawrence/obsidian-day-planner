import type { App } from "obsidian";

import type { ActivityDefinition } from "./activity-definitions";
import {
  getActivityAttributeFields,
  getActivityAttributeValues,
  normalizeActivityName,
} from "./activity-definitions";
import { getResourceFilesForField } from "./activity-resources";
import type { Activity } from "./props";

export type ActivityMainKeyProgress = {
  value: string;
  minutes: number;
  filePath?: string;
  rangeKey?: string;
  current?: number;
  maximum?: number;
  percent?: number;
  minutesPerUnit?: number;
  estimatedMinutesRemaining?: number;
};

function activityMinutes(activity: Activity) {
  return (activity.log ?? []).reduce((total, log) => {
    const start = window.moment(log.start);
    const end = window.moment(log.end);

    return start.isValid() && end.isValid() && end.isAfter(start)
      ? total + window.moment.duration(end.diff(start)).asMinutes()
      : total;
  }, 0);
}

/** Summarize time, completion, pace, and ETA for one main-key value. */
export function calculateActivityMainKeyProgress(props: {
  activities: Activity[];
  definition: ActivityDefinition;
  value: string;
  aliases?: string[];
  rangeMaximums?: Record<string, unknown>;
}): ActivityMainKeyProgress {
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
  const matching = activities.filter((activity) => {
    if (
      normalizeActivityName(activity.activity) !==
        normalizeActivityName(definition.name) ||
      !attributes?.mainKey
    ) {
      return false;
    }

    const candidate = getActivityAttributeValues(definition.name, activity)[
      attributes.mainKey
    ];
    return acceptedValues.has(
      String(candidate ?? "")
        .trim()
        .toLowerCase(),
    );
  });
  const minutes = matching.reduce(
    (total, activity) => total + activityMinutes(activity),
    0,
  );
  const range = attributes?.ranges?.find((candidate) => {
    const maximum = Number(rangeMaximums[candidate.key]);
    return Number.isFinite(maximum) && maximum > 0;
  });

  if (!range) return { value, minutes };

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
    minutes,
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
  const inProgress = resources
    .filter(({ status }) => status === "in progress")
    .map((resource) => ({
      ...calculateActivityMainKeyProgress({
        activities,
        definition,
        value: resource.name,
        aliases: resource.aliases,
        rangeMaximums: resource.frontmatter,
      }),
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
      calculateActivityMainKeyProgress({ activities, definition, value }),
    ),
  ].sort((a, b) => b.minutes - a.minutes || a.value.localeCompare(b.value));
}
