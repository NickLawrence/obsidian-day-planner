import chroma from "chroma-js";

import { getObsidianContext } from "../../context/obsidian-context";
import { currentTimeSignal } from "../../global-store/current-time";
import type { LocalTask, Task } from "../../task-types";
import {
  getActivityBlockColors,
  getTextColorWithEnoughContrast,
} from "../../util/color";
import { getRelationToNow } from "../../util/moment";
import * as t from "../../util/task-utils";
import { getOneLineSummary } from "../../util/task-utils";

interface UseColorProps {
  task: Task;
}

const defaultBorderColor = "var(--color-base-50)";
const baseBackgroundColor =
  "var(--background-primary, var(--background-secondary, #ffffff))";

type ActivityBlockTask = LocalTask & {
  clockActivity?: {
    activity: string;
  };
};

function getClockActivityName(task: Task) {
  return "text" in task
    ? (task as ActivityBlockTask).clockActivity?.activity
    : undefined;
}

export function useColor({ task }: UseColorProps) {
  const { settingsSignal, isDarkMode } = getObsidianContext();

  const relationToNow = $derived.by(() => {
    if (task.isAllDayEvent) {
      return getRelationToNow(
        currentTimeSignal.current,
        task.startTime.clone().startOf("day"),
        task.startTime.clone().endOf("day"),
      );
    }

    if (t.isWithTime(task)) {
      return getRelationToNow(
        currentTimeSignal.current,
        task.startTime,
        t.getEndTime(task),
      );
    }

    return "present";
  });

  const colorScale = $derived.by(() => {
    const { timelineStartColor, timelineEndColor } = settingsSignal.current;

    return chroma.scale([timelineStartColor, timelineEndColor]).mode("lab");
  });

  const colorOverride = $derived.by(() => {
    const { colorOverrides } = settingsSignal.current;

    return colorOverrides.find((override) =>
      getOneLineSummary(task).includes(override.text),
    );
  });

  const activityGroupColors = $derived.by(() => {
    const name = getClockActivityName(task);
    return name ? getActivityBlockColors(name, isDarkMode.current) : undefined;
  });

  const backgroundColor = $derived.by(() => {
    const { timelineColored, startHour } = settingsSignal.current;

    if (colorOverride) {
      return isDarkMode.current
        ? colorOverride?.darkModeColor
        : colorOverride?.color;
    }

    if (activityGroupColors) {
      return activityGroupColors.background;
    }

    if (timelineColored) {
      const scaleKey = (task.startTime.hour() - startHour) / (24 - startHour);

      return colorScale(scaleKey).hex();
    }

    if (relationToNow === "past") {
      return "var(--background-secondary)";
    }

    return baseBackgroundColor;
  });

  const borderColor = $derived.by(() => {
    if (activityGroupColors) {
      return activityGroupColors.border;
    }

    return relationToNow === "present" && !task.isAllDayEvent
      ? "var(--color-accent)"
      : defaultBorderColor;
  });

  const properContrastColors = $derived.by(() => {
    const { timelineColored } = settingsSignal.current;

    return (timelineColored && !activityGroupColors) || colorOverride
      ? getTextColorWithEnoughContrast(backgroundColor)
      : {
          normal: "inherit",
          muted: "inherit",
          faint: "inherit",
        };
  });

  return {
    get properContrastColors() {
      return properContrastColors;
    },
    get backgroundColor() {
      return backgroundColor;
    },
    get borderColor() {
      return borderColor;
    },
  };
}
