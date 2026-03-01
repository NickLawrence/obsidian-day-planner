import type { Moment } from "moment";
import { get, type Readable } from "svelte/store";

import type { PathToListProps } from "../redux/dataview/dataview-slice";
import {
  getActivityAttributeValues,
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
  getTotalsForRange: (
    rangeStart: Moment,
    rangeEnd: Moment,
    filter?: ActivityTotalsFilter,
  ) => ActivityDuration[];
};

export function getAllActivitiesFromListProps(listProps: PathToListProps) {
  return Object.values(listProps).flatMap((lineToProps) =>
    Object.values(lineToProps).flatMap(
      ({ parsed }) => (parsed.activities as Activity[]) ?? [],
    ),
  );
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
  return calculateActivityDurationsForRange(
    filterActivitiesByMainKey(activities, filter),
    rangeStart,
    rangeEnd,
    {
      getLabel: (activityName) => getActivityLabel(activityName),
    },
  );
}

export function createDayPlannerActivityApi(
  listPropsStore: Readable<PathToListProps>,
): DayPlannerActivityApi {
  return {
    getAllActivities: () => getAllActivitiesFromListProps(get(listPropsStore)),
    getTotalsForRange: (rangeStart, rangeEnd, filter) =>
      getActivityTotalsForRange(
        getAllActivitiesFromListProps(get(listPropsStore)),
        rangeStart,
        rangeEnd,
        filter,
      ),
  };
}
