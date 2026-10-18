import type { Moment } from "moment";
import { get, type Readable } from "svelte/store";

import type { PathToListProps } from "../redux/dataview/dataview-slice";

import {
  getActivityDefinitions,
  getActivityAttributeValues,
  type ActivityDefinition,
  getActivityDefinition,
  getActivityLabel,
  normalizeActivityName,
} from "./activity-definitions";
import {
  calculateActivityDurationsForRange,
  type ActivityDuration,
} from "./activity-log-summary";
import type { Activity } from "./props";

export type ActivityTotalsFilter = {
  activityName?: string;
  mainKey?: string;
  mainKeyValue?: string | number;
};

export type DayPlannerActivityApi = {
  getAllActivities: () => Activity[];
  getActivityDefinitions: () => ActivityDefinition[];
  getTotalsForRange: (
    rangeStart: Moment,
    rangeEnd: Moment,
    filter?: ActivityTotalsFilter,
  ) => ActivityDuration[];
};

const activitySnapshots = new WeakMap<PathToListProps, Activity[]>();

/** listProps is an immutable Redux snapshot; reuse its flattened activity view. */
export function getAllActivitiesFromListProps(listProps: PathToListProps) {
  const cached = activitySnapshots.get(listProps);
  if (cached) return cached;
  const activities = Object.values(listProps).flatMap((lineToProps) =>
    Object.values(lineToProps).flatMap(
      ({ parsed }) => (parsed.activities as Activity[]) ?? [],
    ),
  );
  activitySnapshots.set(listProps, activities);
  return activities;
}

export function filterActivitiesByMainKey(
  activities: Activity[],
  filter?: ActivityTotalsFilter,
) {
  if (!filter?.activityName && !filter?.mainKey) {
    return activities;
  }

  const normalizedName = filter.activityName
    ? normalizeActivityName(filter.activityName)
    : undefined;

  return activities.filter((activity) => {
    if (
      normalizedName &&
      normalizeActivityName(activity.activity) !== normalizedName
    ) {
      return false;
    }

    if (!filter.mainKey) {
      return true;
    }

    const definition = getActivityDefinition(activity.activity);
    const configuredMainKey = definition?.attributes?.mainKey;
    if (!configuredMainKey || configuredMainKey !== filter.mainKey) {
      return false;
    }

    if (typeof filter.mainKeyValue === "undefined") {
      return true;
    }

    const values = getActivityAttributeValues(activity.activity, activity);

    return values[filter.mainKey] === filter.mainKeyValue;
  });
}

export function getActivityTotalsForRange(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
  filter?: ActivityTotalsFilter,
) {
  const included = new Set(filterActivitiesByMainKey(activities, filter));
  return calculateActivityDurationsForRange(activities, rangeStart, rangeEnd, {
    includeActivity: (activity) => included.has(activity),
    getLabel: (activityName) => getActivityLabel(activityName),
  });
}

export function createDayPlannerActivityApi(
  listPropsStore: Readable<PathToListProps>,
): DayPlannerActivityApi {
  return {
    getAllActivities: () => getAllActivitiesFromListProps(get(listPropsStore)),
    getActivityDefinitions: () => getActivityDefinitions(),
    getTotalsForRange: (rangeStart, rangeEnd, filter) =>
      getActivityTotalsForRange(
        getAllActivitiesFromListProps(get(listPropsStore)),
        rangeStart,
        rangeEnd,
        filter,
      ),
  };
}
