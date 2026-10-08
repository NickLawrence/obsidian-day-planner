import {
  getActivityAttributeFields,
  getActivityAttributeValues,
  getActivityDefinition,
  getActivitySuggestions,
  normalizeActivityName,
} from "./activity-definitions";
import type { Activity } from "./activity-schema";

export type ActivityNameSuggestion = {
  text: string;
  displayText?: string;
  activityName?: string;
  initialValues?: Record<string, string | number | undefined>;
};

export type ActivitySelection = {
  activityName: string;
  initialValues?: Record<string, string | number | undefined>;
};

function getActivityTimestamp(value?: string) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function getActivityRecencyScore(activity: Activity) {
  const log = activity.log ?? [];

  if (log.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return log.reduce((latest, entry) => {
    return Math.max(
      latest,
      getActivityTimestamp(entry.end),
      getActivityTimestamp(entry.start),
    );
  }, Number.NEGATIVE_INFINITY);
}

function getActivitiesByRecency(activities: Activity[]) {
  return activities
    .map((activity, index) => ({
      activity,
      recency: getActivityRecencyScore(activity),
      index,
    }))
    .sort((a, b) => {
      if (a.recency !== b.recency) {
        return b.recency - a.recency;
      }

      return b.index - a.index;
    })
    .map(({ activity }) => activity);
}

function getRecentMainKeyValues(activityName: string, activities: Activity[]) {
  const definition = getActivityDefinition(activityName);
  const mainKey = definition?.attributes?.mainKey;

  if (!mainKey) {
    return [];
  }

  const mainKeyField = getActivityAttributeFields(activityName, "start").find(
    ({ key }) => key === mainKey,
  );

  if (mainKeyField?.suggestHistory === false) {
    return [];
  }

  const normalizedActivityName = normalizeActivityName(activityName);
  const uniqueValues = new Set<string | number>();
  const values: Array<string | number> = [];

  const sortedActivities = getActivitiesByRecency(activities);

  for (const activity of sortedActivities) {
    if (normalizeActivityName(activity.activity) !== normalizedActivityName) {
      continue;
    }

    const attributeValues = getActivityAttributeValues(activityName, activity);
    const value = attributeValues[mainKey];

    if (
      (typeof value !== "string" && typeof value !== "number") ||
      uniqueValues.has(value)
    ) {
      continue;
    }

    uniqueValues.add(value);
    values.push(value);

    if (values.length === (definition.startSuggestionLimit ?? 5)) {
      break;
    }
  }

  return values;
}

function getSuggestedRangeStartValues(
  activityName: string,
  activities: Activity[],
  initialValues: Record<string, string | number | undefined>,
) {
  const definition = getActivityDefinition(activityName);
  const attributes = definition?.attributes;
  const mainKey = attributes?.mainKey;

  if (!attributes?.ranges?.length || !mainKey) {
    return initialValues;
  }

  const mainValue = initialValues[mainKey];
  const normalizedActivityName = normalizeActivityName(activityName);

  if (typeof mainValue !== "string" && typeof mainValue !== "number") {
    return initialValues;
  }

  const history = getActivitiesByRecency(activities).filter(
    (activity) =>
      normalizeActivityName(activity.activity) === normalizedActivityName,
  );

  const updates: Record<string, string | number | undefined> = {
    ...initialValues,
  };

  for (const range of attributes.ranges) {
    const historyEntry = history.find((activity) => {
      const values = getActivityAttributeValues(activityName, activity);

      return values[mainKey] === mainValue;
    });

    if (!historyEntry) {
      continue;
    }

    const values = getActivityAttributeValues(activityName, historyEntry);
    const rangeEnd = values[range.end];

    if (typeof rangeEnd !== "number") {
      continue;
    }

    updates[range.start] = rangeEnd + 1;
  }

  return updates;
}

export function getActivitySuggestionsWithHistory(activities: Activity[]) {
  return getActivitySuggestions().flatMap((definition) => {
    const baseLabel = definition.emoji
      ? `${definition.emoji} ${definition.label}`
      : definition.label;
    const baseSuggestion: ActivityNameSuggestion = {
      text: definition.name,
      displayText: baseLabel,
      activityName: definition.name,
    };

    const recentValues = getRecentMainKeyValues(definition.name, activities);
    const mainKey = getActivityDefinition(definition.name)?.attributes?.mainKey;

    if (recentValues.length === 0 || !mainKey) {
      return [baseSuggestion];
    }

    const valueSuggestions = recentValues.map((value) => {
      const initialValues = getSuggestedRangeStartValues(
        definition.name,
        activities,
        {
          [mainKey]: value,
        },
      );
      const startRangeKey = getActivityDefinition(definition.name)?.attributes
        ?.ranges?.[0]?.start;
      const startRangeValue = startRangeKey
        ? initialValues[startRangeKey]
        : undefined;
      const startRangeField = startRangeKey
        ? getActivityAttributeFields(definition.name, "start").find(
            ({ key }) => key === startRangeKey,
          )
        : undefined;
      const rangeSuffix =
        typeof startRangeValue === "number" ||
        typeof startRangeValue === "string"
          ? ` - ${startRangeField?.label ?? startRangeKey}: ${startRangeValue}`
          : "";

      return {
        text: `${definition.name} - ${value}`,
        displayText: `${baseLabel} - ${value}${rangeSuffix}`,
        activityName: definition.name,
        initialValues,
      } satisfies ActivityNameSuggestion;
    });

    return [baseSuggestion, ...valueSuggestions];
  });
}

export function filterActivitySuggestions(
  suggestions: ActivityNameSuggestion[],
  query: string,
) {
  const normalizedQuery = normalizeActivityName(query);
  const matches =
    normalizedQuery.length === 0
      ? suggestions
      : suggestions.filter(
          (suggestion) =>
            normalizeActivityName(
              suggestion.activityName ?? suggestion.text,
            ).includes(normalizedQuery) ||
            normalizeActivityName(
              suggestion.displayText ?? suggestion.text,
            ).includes(normalizedQuery),
        );
  return query.trim().length > 0
    ? [{ text: query, activityName: query }, ...matches]
    : matches;
}
