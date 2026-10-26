import type { Duration, Moment } from "moment";

import {
  getActivityDefinition,
  getActivityGroup,
  type ActivityGroupDefinition,
} from "./activity-definitions";
import {
  calculateActivitySummaryForRange,
  type ActivityDuration,
} from "./activity-log-summary";
import { applyActivityColorVariant } from "./color";
import { formatActivityDuration, formatDuration } from "./duration";
import type { Activity } from "./props";

export type ActivityPieSlice = {
  key: string;
  label: string;
  emoji: string;
  color: string;
  value: number;
  durationLabel: string;
  group: ActivityGroupDefinition;
};

export type ActivityPieGroup = {
  key: string;
  label: string;
  color: string;
  value: number;
  slices: ActivityPieSlice[];
};

/** Keep group wedges adjacent and use the same order for the legend. */
export function groupActivityPieSlices(
  slices: ActivityPieSlice[],
): ActivityPieGroup[] {
  const groups = new Map<string, ActivityPieGroup>();
  for (const slice of slices) {
    const { name: key, label, color } = slice.group;
    let group = groups.get(key);
    if (!group) {
      group = { key, label, color, value: 0, slices: [] };
      groups.set(key, group);
    }
    group.value += slice.value;
    group.slices.push(slice);
  }
  for (const group of groups.values()) {
    group.slices.sort(
      (a, b) => b.value - a.value || a.label.localeCompare(b.label),
    );
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === "__unrecorded__") return 1;
    if (b.key === "__unrecorded__") return -1;
    return b.value - a.value || a.label.localeCompare(b.label);
  });
}

/** Chart values use credited time; full logged time stays in labels and tooltips. */
export function buildActivityPieSlices(
  totals: ActivityDuration[],
  unrecordedTime: Duration,
): ActivityPieSlice[] {
  const slices = totals
    .filter(
      ({ duration }) =>
        Number.isFinite(duration.asMilliseconds()) &&
        duration.asMilliseconds() > 0,
    )
    .map((total) => {
      const definition = getActivityDefinition(total.activityKey);
      const group = getActivityGroup(total.activityKey) ?? {
        name: "__other__",
        label: "Other activities",
        color: "#808080",
      };
      return {
        key: total.activityKey,
        label: definition?.label ?? total.activity,
        emoji: definition?.emoji ?? "•",
        color: applyActivityColorVariant(group.color, definition?.color),
        value: total.duration.asMilliseconds(),
        durationLabel: formatActivityDuration(total),
        group,
      };
    });

  const unrecorded = unrecordedTime.asMilliseconds();
  if (Number.isFinite(unrecorded) && unrecorded > 0) {
    slices.push({
      key: "__unrecorded__",
      label: "Unrecorded time",
      emoji: "◷",
      color: "#9ca3af",
      value: unrecorded,
      durationLabel: formatDuration(unrecordedTime),
      group: {
        name: "__unrecorded__",
        label: "Unrecorded time",
        color: "#9ca3af",
      },
    });
  }
  return groupActivityPieSlices(slices).flatMap((group) => group.slices);
}

/** Build a priority-adjusted chart for any half-open range, through now at most. */
export function calculateActivityPieForRange(
  activities: Activity[],
  rangeStart: Moment,
  rangeEnd: Moment,
): ActivityPieSlice[] {
  if (!rangeStart.isValid() || !rangeEnd.isValid()) return [];
  const elapsedEnd = window.moment.min(rangeEnd, window.moment());
  if (!elapsedEnd.isAfter(rangeStart)) return [];
  const { totals, unrecordedTime } = calculateActivitySummaryForRange(
    activities,
    rangeStart,
    elapsedEnd,
  );
  return buildActivityPieSlices(totals, unrecordedTime);
}
