import type { Moment } from "moment";

import { clockFormat, defaultDurationMinutes } from "../constants";
import type { LocalTask } from "../task-types";

import { getId } from "./id";

export type ClockMoments = [Moment, Moment];

export function createClockTimestamp() {
  return window.moment().format(clockFormat);
}

export function createClockTaskFromActivity(props: {
  activity: {
    title: string;
    taskId?: string;
    location: LocalTask["location"];
  };
  clockMoments: ClockMoments;
  tasksById?: Map<string, LocalTask>;
  defaultDurationMinutes?: number;
}): LocalTask {
  const {
    activity,
    clockMoments,
    tasksById,
    defaultDurationMinutes: durationFallback = defaultDurationMinutes,
  } = props;

  const [startTime, endTime] = clockMoments;
  let durationMinutes = endTime.diff(startTime, "minutes");

  if (durationMinutes < 0) {
    durationMinutes = durationFallback;
  }

  const linkedTask =
    activity.taskId && tasksById ? tasksById.get(activity.taskId) : undefined;

  if (linkedTask) {
    return {
      ...linkedTask,
      id: getId(),
      startTime,
      durationMinutes,
      isAllDayEvent: false,
      taskId: linkedTask.taskId,
    };
  }

  return {
    id: getId(),
    startTime,
    durationMinutes,
    isAllDayEvent: false,
    symbol: "-",
    status: " ",
    text: activity.title,
    lines: [],
    location: activity.location,
    taskId: activity.taskId,
  };
}
