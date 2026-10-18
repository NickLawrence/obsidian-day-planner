import type { Duration } from "moment";

import {
  getActivityDefinition,
  getActivityGroup,
} from "./activity-definitions";
import type { ActivityDuration } from "./activity-log-summary";
import { applyActivityColorVariant } from "./color";
import { formatActivityDuration, formatDuration } from "./duration";

export type WeeklyActivityPieSlice = {
  key: string;
  label: string;
  emoji: string;
  color: string;
  value: number;
  durationLabel: string;
};

/** Chart values use credited time only; full logged time is tooltip context. */
export function buildWeeklyActivityPieSlices(
  totals: ActivityDuration[],
  unrecordedTime: Duration,
): WeeklyActivityPieSlice[] {
  const slices = totals
    .filter(
      ({ duration }) =>
        Number.isFinite(duration.asMilliseconds()) &&
        duration.asMilliseconds() > 0,
    )
    .map((total) => {
      const definition = getActivityDefinition(total.activityKey);
      return {
        key: total.activityKey,
        label: definition?.label ?? total.activity,
        emoji: definition?.emoji ?? "•",
        color: applyActivityColorVariant(
          getActivityGroup(total.activityKey)?.color ?? "#808080",
          definition?.color,
        ),
        value: total.duration.asMilliseconds(),
        durationLabel: formatActivityDuration(total),
      };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const unrecorded = unrecordedTime.asMilliseconds();
  if (Number.isFinite(unrecorded) && unrecorded > 0) {
    slices.push({
      key: "__unrecorded__",
      label: "Unrecorded time",
      emoji: "◷",
      color: "#9ca3af",
      value: unrecorded,
      durationLabel: formatDuration(unrecordedTime),
    });
  }
  return slices;
}
